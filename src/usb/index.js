const log = require('../log')
const config = require('../config')
const queue = require('../queue')

const _ = require('lodash')
const async = require('async')
const chance = require('chance').Chance()
const checkDiskSpace = require('check-disk-space').default
const { exec } = require('child_process')
const fs = require('fs')
const glob = require('glob')
const path = require('path')
const p2c = require('promise-to-callback')

const settings = {
  interval: 3000,
  usedPercentWarning: 0.7,
  usedPercentDanger: 0.9,
  isProduction: process.env.NODE_ENV === 'production',
  usbDir: process.env.NODE_ENV === 'production' ? '/mnt/usb' : path.join(__dirname, '../../mnt/usb'),
  ramDir: process.env.NODE_ENV === 'production' ? '/mnt/ram' : path.join(__dirname, '../../mnt/ram'),
  debugFolder: false
}

let isMounted

exports.start = (cb) => {
  cb = cb || function () {}

  let isStarted
  const startTimestamp = +new Date()
  const files = []

  async.forever((next) => {
    const dashcamDuration = config.get('dashcamDuration')
    const isDashcam = config.get('dashcam') && dashcamDuration
    const sentryDuration = config.get('sentryDuration')
    const isSentry = config.get('sentry') && sentryDuration
    const isSentryEarlyWarning = config.get('sentryEarlyWarning')
    const isStream = config.get('stream')
    const streamAngles = config.get('streamAngles')

    let sentryEarlyWarningNotify

    async.series([
      mount,
      (cb) => {
        if (isStarted) {
          return cb()
        }

        isStarted = true
        getSpace((err, space) => {
          if (!err && space?.status !== 'success') {
            const carName = config.get('carName')
            const text = `${carName} storage ${result.status}: ${space.usedPercentFormatted}% used (${space.usedGb} of ${space.totalGb} GB)`
            queue.notify.push({
              id: 'storage',
              text
            })
          }

          cb(err)
        })
      },
      (cb) => {
        glob(`${settings.usbDir}/TeslaCam/**/+(event.json|*.mp4)`, (err, currentFiles) => {
          if (err) {
            return cb(err)
          }

          async.eachSeries(currentFiles, (currentFile, cb) => {
            const fileParts = currentFile.split(/[\\/]/)
            const filename = _.last(fileParts)
            const isRecent = fileParts.includes('RecentClips')
            const angle = filename.includes('-front') ? 'front' : filename.includes('-right') ? 'right' : filename.includes('-back') ? 'back' : filename.includes('-left') ? 'left' : undefined
            const folder = isRecent ? filename.split(`-${angle}`)[0] : _.nth(fileParts, -2)
            const dateParts = folder.split('_')
            const timestamp = +new Date(`${dateParts[0]} ${dateParts[1].replace(/-/g, ':')}`)

            if (_.find(files, { file: currentFile }) || (timestamp < startTimestamp && (!settings.debugFolder || folder !== settings.debugFolder))) {
              return cb()
            }

            async.series([
              (cb) => {
                if (isRecent && isStream && streamAngles.includes(angle)) {
                  copyTemp(currentFile, (err, tempFile) => {
                    if (!err) {
                      queue.stream.push({
                        id: `stream ${angle} ${folder}`,
                        folder,
                        angle,
                        file: tempFile,
                        timestamp
                      })
                    }

                    cb(err)
                  })
                } else {
                  cb()
                }
              },
              (cb) => {
                const eventType = currentFile.includes('SentryClips') ? 'sentry' : currentFile.includes('TrackClips') ? 'track' : 'dashcam'

                if (filename === 'event.json' && ((eventType !== 'sentry' && isDashcam) || (eventType === 'sentry' && (isSentry || isSentryEarlyWarning)))) {
                  fs.readFile(currentFile, (err, eventContents) => {
                    if (err) {
                      return cb(err)
                    }

                    let event

                    try {
                      event = JSON.parse(eventContents)
                      event.type = eventType
                    } catch (err) {
                      return cb(err)
                    }

                    event.angle = ['3', '5'].includes(event.camera) ? 'left' : ['4', '6'].includes(event.camera) ? 'right' : event.camera === '7' ? 'back' : 'front'

                    if (event.type === 'sentry') {
                      if (isSentryEarlyWarning && !sentryEarlyWarningNotify) {
                        sentryEarlyWarningNotify = {
                          id: `${event.type} early ${folder}`,
                          event,
                          isSentryEarlyWarning
                        }
                      }

                      if (!isSentry) {
                        return cb()
                      }
                    }

                    const archiveDuration = (event.type === 'sentry' ? sentryDuration : dashcamDuration) * 1000
                    const startEventTimestamp = event.type === 'sentry' ? +new Date(event.timestamp) - (archiveDuration * 0.4) : +new Date(event.timestamp) - archiveDuration
                    const endEventTimestamp = event.type === 'sentry' ? +new Date(event.timestamp) + (archiveDuration * 0.6) : +new Date(event.timestamp)

                    const frontFiles = _.orderBy(_.filter(files, (file) => {
                      return !file.isRecent && file.angle === 'front' && file.folder === folder && file.timestamp + 60000 >= startEventTimestamp && file.timestamp < endEventTimestamp
                    }), 'timestamp', 'desc')

                    if (!frontFiles.length) {
                      return cb()
                    }

                    const chapters = []
                    let remainingDuration = archiveDuration

                    async.someSeries(frontFiles, (frontFile, cb) => {
                      exec(`ffprobe -hide_banner -v quiet -show_entries format=duration -i ${frontFile.file}`, (err, stdout) => {
                        if (err || !stdout.includes('duration=')) {
                          return cb()
                        }

                        const fileDuration = stdout.split(/[=\n]/)[2] * 1000
                        if (!fileDuration) {
                          return cb()
                        }

                        const relatedFiles = _.reject(_.filter(files, { isRecent: false, timestamp: frontFile.timestamp }), { angle: undefined })
                        const tempFiles = []

                        async.eachSeries(relatedFiles, (relatedFile, cb) => {
                          copyTemp(relatedFile.file, (err, tempFile) => {
                            if (!err) {
                              tempFiles.push({
                                file: tempFile,
                                angle: relatedFile.angle
                              })
                            }

                            cb(err)
                          })
                        }, (err) => {
                          const start = frontFile.timestamp > startEventTimestamp ? 0 : startEventTimestamp - frontFile.timestamp
                          const duration = frontFile.timestamp + fileDuration > endEventTimestamp ? endEventTimestamp - frontFile.timestamp - start : fileDuration

                          chapters.push({
                            timestamp: frontFile.timestamp,
                            start,
                            duration,
                            files: tempFiles
                          })

                          remainingDuration -= duration

                          cb(err, remainingDuration <= 0)
                        })
                      })
                    }, (err) => {
                      if (!err) {
                        queue.archive.push({
                          id: `${event.type} ${folder}`,
                          folder,
                          event,
                          chapters
                        })
                      }

                      cb(err)
                    })
                  })
                } else {
                  cb()
                }
              }
            ], (err) => {
              if (!err) {
                files.push({
                  file: currentFile,
                  timestamp,
                  folder,
                  angle,
                  isRecent
                })
              }

              cb(err)
            })
          }, (err) => {
            if (!err && sentryEarlyWarningNotify) {
              queue.notify.push(sentryEarlyWarningNotify)
            }

            cb(err)
          })
        })
      }
    ], (err) => {
      unmount(() => {
        if (err) {
          log.warn(`[usb] failed: ${err}`)
        }

        setTimeout(next, settings.interval)
      })
    })
  })

  cb()
}

const copyTemp = (source, cb) => {
  cb = cb || function () {}

  const destination = path.join(settings.ramDir, `${chance.hash()}.mp4`)
  fs.copyFile(source, destination, (err) => {
    cb(err, destination)
  })
}

const mount = (cb) => {
  cb = cb || function () {}

  if (!settings.isProduction || isMounted) {
    return cb()
  }

  exec(`mount ${settings.usbDir} &> /dev/null`, () => {
    isMounted = true
    cb()
  })
}

const unmount = (cb) => {
  cb = cb || function () {}

  if (!settings.isProduction || !isMounted) {
    return cb()
  }

  exec(`umount ${settings.usbDir} &> /dev/null`, () => {
    isMounted = false
    cb()
  })
}

const getSpace = (cb) => {
  cb = cb || function () {}

  mount(() => {
    p2c(checkDiskSpace(settings.usbDir))((err, space) => {
      if (!err && space) {
        space = {
          total: space.size,
          free: space.free,
          used: space.size - space.free,
          totalGb: Math.round(space.size / 1024 / 1024 / 1024),
          freeGb: Math.round(space.free / 1024 / 1024 / 1024),
          usedGb: Math.round((space.size - space.free) / 1024 / 1024 / 1024)
        }

        space.usedPercent = space.used / space.total
        space.usedPercentFormatted = Math.ceil(space.usedPercent * 100)
        space.status = space.usedPercent > settings.usedPercentDanger ? 'danger' : space.usedPercent > settings.usedPercentWarning ? 'warning' : 'success'
      }

      cb(err, space)
    })
  })
}

exports.getSpace = getSpace
