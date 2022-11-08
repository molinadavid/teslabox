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
  ramDir: process.env.NODE_ENV === 'production' ? '/mnt/ram' : path.join(__dirname, '../../mnt/ram')
}

const files = []

exports.start = (cb) => {
  cb = cb || function () {}

  const startTimestamp = +new Date()

  async.forever((next) => {
    const isDashcam = config.get('dashcam')
    const dashcamDuration = config.get('dashcamDuration')
    const isSentry = config.get('sentry')
    const isSentryEarlyWarning = config.get('sentryEarlyWarning')
    const sentryDuration = config.get('sentryDuration')
    const isStream = config.get('stream')
    const streamAngles = config.get('streamAngles')

    let sentryEarlyWarningNotify

    async.series([
      (cb) => {
        settings.isProduction ? exec(`mount ${settings.usbDir} &> /dev/null`, cb) : cb()
      },
      (cb) => {
        glob(`${settings.usbDir}/TeslaCam/**/+(event.json|*.mp4)`, (err, currentFiles) => {
          if (err) {
            return cb(err)
          }

          async.eachSeries(currentFiles, (currentFile, cb) => {
            const fileParts = currentFile.split(/[\\/]/)
            const filename = _.last(fileParts)
            const angle = filename.includes('-front') ? 'front' : filename.includes('-right') ? 'right' : filename.includes('-back') ? 'back' : filename.includes('-left') ? 'left' : undefined
            const folder = angle ? filename.split(`-${angle}`)[0] : _.nth(fileParts, -2)
            const dateParts = folder.split('_')
            const timestamp = +new Date(`${dateParts[0]} ${dateParts[1].replace(/-/g, ':')}`)
            const isRecent = fileParts.includes('RecentClips')

            if (timestamp < startTimestamp || _.find(files, { file: currentFile })) {
              return cb()
            }

            async.series([
              (cb) => {
                if (isRecent && isStream && streamAngles.includes(angle)) {
                  copyTemp(currentFile, (err, tempFile) => {
                    if (!err) {
                      log.debug(`[usb] queued stream ${filename}`)

                      queue.stream.push({
                        id: `stream ${angle} ${folder}`,
                        angle,
                        folder,
                        file: tempFile
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

                if (filename === 'event.json' && ((eventType !== 'sentry' && isDashcam && dashcamDuration) || (eventType === 'sentry' && isSentry && sentryDuration))) {
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

                    if (event.type === 'sentry' && isSentryEarlyWarning) {
                      sentryEarlyWarningNotify = {
                        id: `early ${folder}`,
                        event,
                        isSentryEarlyWarning
                      }
                    }

                    const archiveDuration = (eventType === 'sentry' ? sentryDuration : dashcamDuration) * 1000
                    const startEventTimestamp = event.type === 'sentry' ? +new Date(event.timestamp) - (archiveDuration * 0.4) : +new Date(event.timestamp) - archiveDuration
                    const endEventTimestamp = event.type === 'sentry' ? +new Date(event.timestamp) + (archiveDuration * 0.6) : +new Date(event.timestamp)

                    const frontFiles = _.orderBy(_.filter(files, (file) => {
                      return file.angle === 'front' && !file.isRecent && file.timestamp + 60000 >= startEventTimestamp && file.timestamp < endEventTimestamp
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

                        const relatedFiles = _.reject(_.filter(files, { timestamp: frontFile.timestamp, isRecent: false }), { angle: undefined })
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
                        log.debug(`[usb] queued archive ${event.type} ${folder}`)

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

                if (sentryEarlyWarningNotify) {
                  queue.notify.push(sentryEarlyWarningNotify)
                }
              }

              cb(err)
            })
          }, cb)
        })
      },
      (cb) => {
        settings.isProduction ? exec(`umount ${settings.usbDir} &> /dev/null`, cb) : cb()
      },
    ], (err) => {
      if (err) {
        log.warn(`[usb] failed: ${err}`)
      }

      setTimeout(next, settings.interval)
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

exports.getSpace = (cb) => {
  cb = cb || function () {}

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
}
