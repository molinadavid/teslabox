const log = require('../log')
const config = require('../config')
const controllers = require('../http/controllers')
const stream = require('../ram/stream')

const _ = require('lodash')
const async = require('async')
const glob = require('glob')
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')

const interval = 3000

const files = []

exports.start = (cb) => {
  cb = cb || function () {}

  log.debug('[usb] started')

  const isProduction = process.env.NODE_ENV === 'production'
  const usbDir = isProduction ? '/mnt/usb' : path.join(__dirname, '../../mnt/usb')
  const ramDir = isProduction ? '/mnt/ram' : path.join(__dirname, '../../mnt/ram')

  fs.mkdirSync(path.join(ramDir, 'archive'), { recursive: true })
  fs.mkdirSync(path.join(ramDir, 'temp'), { recursive: true })
  fs.mkdirSync(path.join(ramDir, 'stream', 'out'), { recursive: true })

  const startFolder = controllers.formatDate().replace(' ', '_').replace(/:/g, '-')

  async.forever((next) => {
    const isArchive = !!config.get('archive')
    const archiveClips = !!config.get('archiveSeconds') ? (Math.ceil(config.get('archiveSeconds') / 60) + 1) * 4 : false
    const archiveDays = !!config.get('archiveDays') ? Number(config.get('archiveDays')) : false

    const isStream = !!config.get('stream')
    const streamAngles = _.compact(_.split(config.get('streamAngles'), ','))

    const isCopy = !!config.get('copy')
    const copyFolder = config.get('copyFolder')
    const copyAngles = _.compact(_.split(config.get('copyAngles'), ','))
    const copyDir = isCopy && copyFolder && copyAngles.length ? path.join(usbDir, copyFolder) : false

    async.series([
      (cb) => {
        isProduction ? exec(`mount ${usbDir} &> /dev/null`, cb) : cb()
      },
      (cb) => {
        if (!copyDir) {
          return cb()
        }

        fs.mkdir(copyDir, { recursive: true }, (err) => {
          err?.code === 'EEXIST' ? cb() : cb(err)
        })
      },
      (cb) => {
        glob(`${usbDir}/TeslaCam/**/+(event.json|*.mp4)`, (err, result) => {
          if (err) {
            return cb(err)
          }

          async.eachSeries(result, (row, cb) => {
            const parts = row.split(/[\\/]/)
            const file = _.last(parts)
            const folder = _.nth(parts, -2)

            if (files.includes(row) || file < startFolder) {
              return cb()
            }

            const angle = file.includes('-front') ? 'front' : file.includes('-back') ? 'back' : file.includes('-left') ? 'left' : 'right'

            files.push(row)

            if (row.includes('RecentClips') && file.endsWith('.mp4')) {
              async.series([
                (cb) => {
                  if (isStream && streamAngles.includes(angle) && !stream.isProcessing(angle)) {
                    const destination = path.join(ramDir, 'stream', `${angle}.mp4`)
                    log.debug(`[usb] streaming ${destination}`)
                    fs.copyFile(row, destination, cb)
                  } else {
                    cb()
                  }
                },
                (cb) => {
                  if (copyDir && copyAngles.includes(angle)) {
                    const destination = path.join(copyDir, file)
                    log.debug(`[usb] copying ${destination}`)
                    fs.copyFile(row, destination, cb)
                  } else {
                    cb()
                  }
                }
              ], cb)
            } else if (file === 'event.json') {
              async.series([
                (cb) => {
                  if (!isArchive || !archiveClips) {
                    return cb()
                  }

                  fs.readFile(row, (err, result) => {
                    if (err) {
                      return cb(err)
                    }

                    let event

                    try {
                      event = JSON.parse(result)
                    } catch (err) {
                      return cb(err)
                    }

                    event.type = row.includes('SentryClips') ? 'sentry' : row.includes('TrackClips') ? 'track' : 'dashcam'

                    const clips = _.filter(files, (file) => {
                      return file.includes(folder) && file.endsWith('.mp4')
                    }).sort().reverse().slice(0, archiveClips)

                    if (!clips.length) {
                      return cb()
                    }

                    // event.timestamp is skewed. extract it from clip instead
                    const arr = _.last(clips[0].split('/')).split(/[-_]/)
                    event.adjustedTimestamp = `${arr[0]}-${arr[1]}-${arr[2]}T${arr[3]}:${arr[4]}:${arr[5]}`

                    const destination = path.join(ramDir, 'archive', folder)

                    async.series([
                      (cb) => {
                        fs.mkdir(destination, { recursive: true }, (err) => {
                          err?.code === 'EEXIST' ? cb() : cb(err)
                        })
                      },
                      (cb) => {
                        fs.writeFile(path.join(destination, file), JSON.stringify(event), cb)
                      },
                      (cb) => {
                        log.debug(`[usb] archiving ${destination}`)
                        async.each(clips, (clip, cb) => {
                          const parts = clip.split(/[\\/]/)
                          const file = _.last(parts)
                          fs.copyFile(clip, path.join(destination, file), cb)
                        }, cb)
                      }
                    ], cb)
                  })
                },
                (cb) => {
                  if (archiveDays && Math.ceil((new Date() - new Date(folder.split('_')[0] + ' ' + folder.split('_')[1].replace(/-/g, ':'))) / 86400000) > archiveDays) {
                    const _folder = path.join(row, '..')
                    log.debug(`[usb] deleting ${_folder}`)
                    fs.rm(_folder, { recursive: true }, cb)
                  } else {
                    cb()
                  }
                }
              ], cb)
            } else {
              cb()
            }
          }, cb)
        })
      },
      (cb) => {
        isProduction ? exec(`umount ${usbDir} &> /dev/null`, cb) : cb()
      },
    ], (err) => {
      if (err) {
        log.warn(`[usb] failed: ${err}`)
      }

      setTimeout(next, interval)
    })
  })

  cb()
}
