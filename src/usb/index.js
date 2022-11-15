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
  const startTimestamp = Math.round(+new Date() / 1000)
  const files = []

  async.forever((next) => {
    const dashcamDuration = config.get('dashcamDuration')
    const isDashcam = config.get('dashcam') && dashcamDuration
    const sentryDuration = config.get('sentryDuration')
    const isSentry = config.get('sentry') && sentryDuration
    const isSentryEarlyWarning = config.get('sentryEarlyWarning')
    const isStream = config.get('stream') || config.get('streamCopy')
    const streamAngles = config.get('streamAngles')

    async.series([
      (cb) => {
        if (isStarted) {
          return cb()
        }

        glob(`${settings.ramDir}/*`, (err, tempFiles) => {
          if (err) {
            return cb(err)
          }

          _.each(tempFiles, (tempFile) => {
            fs.rm(tempFile, () => cb)
          })

          cb()
        })
      },
      mount,
      (cb) => {
        if (isStarted) {
          return cb()
        }

        isStarted = true
        getSpace((err, space) => {
          if (!err && space?.status !== 'success') {
            const carName = config.get('carName')
            const text = `${carName} storage ${space.status}: ${space.usedPercentFormatted}% used (${space.usedGb} of ${space.totalGb} GB)`
            queue.notify.push({
              id: 'storage',
              text
            })
          }

          cb(err)
        })
      },
      (cb) => {
        glob(`${settings.usbDir}/TeslaCam/RecentClips/*.mp4`, (err, currentFiles) => {
          if (err) {
            return cb(err)
          }

          async.eachSeries(currentFiles, (currentFile, cb) => {
            const fileParts = currentFile.split(/[\\/]/)
            const filename = _.last(fileParts)
            const angle = getAngle(filename)
            const folder = filename.split(`-${angle}`)[0]
            const dateParts = folder.split('_')
            const timestamp = Math.round(+new Date(`${dateParts[0]} ${dateParts[1].replace(/-/g, ':')}`) / 1000)
            if (timestamp < startTimestamp || _.find(files, { type: 'stream', file: currentFile })) {
              return cb()
            }

            files.push({
              type: 'stream',
              file: currentFile
            })

            if (!isStream || !angle || !streamAngles.includes(angle)) {
              return cb()
            }

            copyTemp(currentFile, (err, tempFile) => {
              if (!err) {
                queue.stream.push({
                  id: currentFile,
                  folder,
                  file: tempFile,
                  angle,
                  timestamp
                })
              }

              cb(err)
            })
          }, cb)
        })
      },
      (cb) => {
        glob(`${settings.usbDir}/TeslaCam/**/event.json`, (err, currentFiles) => {
          if (err) {
            return cb(err)
          }

          async.eachSeries(currentFiles, (currentFile, cb) => {
            const fileParts = currentFile.split(/[\\/]/)
            const folder = _.nth(fileParts, -2)
            const dateParts = folder.split('_')
            const timestamp = Math.round(+new Date(`${dateParts[0]} ${dateParts[1].replace(/-/g, ':')}`) / 1000)
            const eventType = fileParts.includes('SentryClips') ? 'sentry' : fileParts.includes('TrackClips') ? 'track' : 'dashcam'
            if ((timestamp < startTimestamp && (!settings.debugFolder || folder !== settings.debugFolder)) || _.find(files, { type: eventType, file: currentFile })) {
              return cb()
            }

            files.push({
              type: eventType,
              file: currentFile
            })

            if ((eventType !== 'sentry' && !isDashcam) || (eventType === 'sentry' && !isSentry && !isSentryEarlyWarning)) {
              return cb()
            }

            fs.readFile(currentFile, (err, eventContents) => {
              if (err) {
                return cb(err)
              }

              let event

              try {
                event = JSON.parse(eventContents)
                event.timestamp = Math.round(+new Date(event.timestamp) / 1000)
                event.type = eventType
              } catch (err) {
                return cb(err)
              }

              event.angle = ['3', '5'].includes(event.camera) ? 'left' : ['4', '6'].includes(event.camera) ? 'right' : event.camera === '7' ? 'back' : 'front'

              const archiveDuration = event.type === 'sentry' ? sentryDuration : dashcamDuration
              const startEventTimestamp = event.timestamp - Math.round(archiveDuration * (event.type === 'sentry' ? 0.4 : 0.9))
              const endEventTimestamp = event.timestamp + Math.round(archiveDuration * (event.type === 'sentry' ? 0.6 : 0.1))

              const tempFiles = []

              glob(`${path.join(currentFile, '..')}/*.mp4`, (err, videoFiles) => {
                if (err) {
                  return cb(err)
                }

                async.eachSeries(videoFiles.reverse(), (videoFile, cb) => {
                  const fileParts = videoFile.split(/[\\/]/)
                  const filename = _.last(fileParts)
                  const angle = getAngle(filename)
                  const dateParts = filename.split(`-${angle}`)[0].split('_')
                  const timestamp = Math.round(+new Date(`${dateParts[0]} ${dateParts[1].replace(/-/g, ':')}`) / 1000)
                  if (timestamp + 60 < startEventTimestamp || timestamp > endEventTimestamp) {
                    return cb()
                  }

                  let fileDuration = (_.find(tempFiles, { timestamp }) || {}).duration

                  async.series([
                    (cb) => {
                      if (fileDuration) {
                        return cb()
                      }

                      exec(`ffprobe -hide_banner -v quiet -show_entries format=duration -i ${videoFile}`, (err, stdout) => {
                        if (!err && stdout.includes('duration=')) {
                          fileDuration = Math.ceil(stdout.split('duration=')[1].split('\n')[0])
                        }

                        cb(err)
                      })
                    },
                    (cb) => {
                      if (event.type === 'sentry' && isSentryEarlyWarning && angle === event.angle && timestamp < event.timestamp && timestamp + fileDuration >= event.timestamp) {
                        copyTemp(videoFile, (err, tempFile) => {
                          if (!err) {
                            const start = event.timestamp - timestamp

                            queue.early.push({
                              id: currentFile,
                              folder,
                              event,
                              timestamp,
                              start,
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
                      if (((event.type !== 'sentry' && isDashcam) || (event.type === 'sentry' && isSentry) && timestamp + fileDuration > startEventTimestamp && timestamp < endEventTimestamp)) {
                        copyTemp(videoFile, (err, tempFile) => {
                          if (!err) {
                            const start = timestamp > startEventTimestamp ? 0 : startEventTimestamp - timestamp
                            const duration = timestamp + fileDuration > endEventTimestamp ? endEventTimestamp - timestamp - start : fileDuration

                            tempFiles.push({
                              file: tempFile,
                              angle,
                              timestamp,
                              start,
                              duration
                            })
                          }

                          cb(err)
                        })
                      } else {
                        cb()
                      }
                    }
                  ], cb)
                }, (err) => {
                  if (!err && ((event.type !== 'sentry' && isDashcam) || (event.type === 'sentry' && isSentry))) {
                    queue.archive.push({
                      id: currentFile,
                      folder,
                      event,
                      tempFiles
                    })
                  }

                  cb(err)
                })
              })
            })
          }, cb)
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

const getAngle = (filename) => {
  return filename.includes('-front') ? 'front' : filename.includes('-right') ? 'right' : filename.includes('-back') ? 'back' : filename.includes('-left') ? 'left' : undefined
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
