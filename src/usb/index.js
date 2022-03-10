const log = require('../log')
const config = require('../config')
const controllers = require('../http/controllers')

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

  const isProduction = process.env.NODE_ENV === 'production'
  const usbDir = isProduction ? '/mnt/usb' : path.join(__dirname, '../../mnt/usb')
  const ramDir = isProduction ? '/mnt/ram' : path.join(__dirname, '../../mnt/ram')

  _.each(['stream/out', 'archive', 'temp'], (key) => {
    fs.mkdirSync(`${ramDir}/${key}`, { recursive: true })
  })

  const startFolder = controllers.formatDate().replace(' ', '_').replace(/:/g, '-')

  async.forever((next) => {
    const isStream = config.get('stream')
    const isArchive = config.get('archive')
    const archiveClips = (Math.ceil(config.get('archiveSeconds') / 60) + 1) * 4

    async.series([
      (cb) => {
        if (!isProduction) {
          return cb()
        }

        exec(`mount ${usbDir} &> /dev/null`, cb)
      },
      (cb) => {
        glob(`${usbDir}/**/+(event.json|*.mp4)`, (err, result) => {
          if (err) {
            return cb(err)
          }

          async.eachSeries(result, (row, cb) => {
            const parts = row.split(/[\\/]/)
            const file = _.last(parts)
            const folder = _.nth(parts, -2)
            const rootFolder = _.nth(parts, -3)

            if (files.includes(row)) {
              return cb()
            }

            const angle = file.includes('-front') ? 'front' : file.includes('-back') ? 'back' : file.includes('-left') ? 'left' : 'right'

            files.push(row)

            if (isStream && row.includes('RecentClips') && file.endsWith('.mp4') && file > startFolder) {
              fs.copyFile(row, `${ramDir}/stream/${angle}.mp4`, cb)
              log.debug(`streaming ${rootFolder}/${file}`)
            } else if (isArchive && file === 'event.json' && folder > startFolder) {
              try {
                fs.readFile(row, (err, result) => {
                  let event

                  try {
                    event = JSON.parse(result)
                  } catch (e) {
                    err = e
                  }

                  if (err) {
                    return cb(err)
                  }

                  event.type = row.includes('SentryClips') ? 'sentry' : row.includes('TrackClips') ? 'track' : 'dashcam'

                  const clips = _.filter(files, (file) => {
                    return file.includes(`/${rootFolder}/${folder}/`) && file.endsWith('.mp4')
                  }).sort().reverse().slice(0, archiveClips)

                  if (!clips.length) {
                    return cb()
                  }

                  // event.timestamp is skewed. extract it from clip instead
                  const arr = _.last(clips[0].split('/')).split(/[-_]/)
                  event.adjustedTimestamp = `${arr[0]}-${arr[1]}-${arr[2]}T${arr[3]}:${arr[4]}:${arr[5]}`

                  const copyFolder = `${ramDir}/archive/${folder}`

                  async.series([
                    (cb) => {
                      fs.mkdir(copyFolder, { recursive: true }, cb)
                    },
                    (cb) => {
                      fs.writeFile(`${copyFolder}/${file}`, JSON.stringify(event), cb)
                    },
                    (cb) => {
                      async.each(clips, (clip, cb) => {
                        const parts = clip.split(/[\\/]/)
                        const file = _.last(parts)
                        fs.copyFile(clip, `${copyFolder}/${file}`, cb)
                      }, cb)
                    },
                    (cb) => {
                      log.debug(`archiving ${rootFolder}/${folder}`)
                      cb()
                    }
                  ], cb)
                })
              } catch (err) {
                cb(err)
              }
            } else {
              cb()
            }
          }, cb)
        })
      },
      (cb) => {
        if (!isProduction) {
          return cb()
        }

        exec(`unmount ${usbDir} &> /dev/null`, cb)
      },
    ], (err) => {
      if (err) {
        log.warn(`usb failed: ${err}`)
      }

      setTimeout(next, interval)
    })
  })

  cb()
}
