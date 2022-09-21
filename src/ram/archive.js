const log = require('../log')
const config = require('../config')
const ping = require('../ping')
const s3 = require('../aws/s3')
const ses = require('../aws/ses')
const telegram = require('../telegram')
const controllers = require('../http/controllers')

const _ = require('lodash')
const async = require('async')
const glob = require('glob')
const path = require('path')
const fs = require('fs')
const { exec } = require('child_process')

const interval = 10000
const expires = 7 * 86400

const ramDir = process.env.NODE_ENV === 'production' ? '/mnt/ram' : path.join(__dirname, '../../mnt/ram')
const bucket = process.env.AWS_S3_BUCKET

const archives = []

exports.start = (cb) => {
  cb = cb || function () {}

  async.forever((next) => {
    const isArchive = config.get('archive')
    if (!isArchive) {
      return setTimeout(next, interval)
    }

    glob(`${ramDir}/archive/*/event.json`, (err, result) => {
      if (err) {
        return setTimeout(next, interval)
      }

      const carName = config.get('carName')
      const archiveQuality = config.get('archiveQuality').toUpperCase()
      const archiveCompression = config.get('archiveCompression')
      const archiveSeconds = parseInt(config.get('archiveSeconds'), 10)
      const emailRecipients = _.split(config.get('emailRecipients'), ',')
      const telegramRecipients = _.split(config.get('telegramRecipients'), ',')

      async.eachSeries(result, (row, cb) => {
        const parts = row.split(/[\\/]/)
        const folder = _.nth(parts, -2)

        let event
        let destination

        async.series([
          (cb) => {
            fs.readFile(row, (err, result) => {
              if (!err) {
                try {
                  event = JSON.parse(result)
                  if (event.type === 'sentry') {
                    event.angle = ['3', '5'].includes(event.camera) ? 'left' : ['4', '6'].includes(event.camera) ? 'right' : event.camera === '7' ? 'back' : 'front'
                  } else {
                    event.type = 'dashcam'
                  }
                } catch (e) {
                  err = e
                }
              }

              cb(err)
            })
          },
          (cb) => {
            destination = row.replace('event.json', `${event.type}.mp4`)
            silentDestination = destination.replace('.mp4', `-silent.mp4`)

            fs.stat(destination, (err, result) => {
              if (err || !result) {
                exec(`tesla_dashcam --no-check_for_update --no-notification --exclude_subdirs --temp_dir ${path.join(ramDir, 'temp')} ${event.angle === 'back' ? '--swap_frontrear ' : ''} --layout WIDESCREEN --quality ${archiveQuality} --compression ${archiveCompression} --sentry_start_offset=-${Math.ceil(archiveSeconds / 2)} --sentry_end_offset=${archiveSeconds - Math.ceil(archiveSeconds / 2)} --start_offset=-${archiveSeconds} ${row.replace('event.json', '')} --timestamp_format="TeslaBox ${_.upperFirst(event.type)} %Y-%m-%d %X" --output ${destination}`, cb)
              } else {
                cb()
              }
            })
          },
          (cb) => {
            // add silent audio to make telegram video player consistent (thanks https://github.com/genadyo)
            exec(`ffmpeg -hide_banner -loglevel error -y -i ${destination} -f lavfi -i anullsrc -c:v copy -c:a aac -shortest ${silentDestination}`, cb)
          },
          (cb) => {
            if (!ping.isAlive()) {
              return cb()
            }

            fs.readFile(silentDestination, (err, result) => {
              if (err) {
                return cb(err)
              }

              const key = `${process.env.AWS_ACCESS_KEY_ID}/archive/${folder}/${event.type}.mp4`
              let url

              async.series([
                (cb) => {
                  s3.putObject(bucket, key.replace(`${event.type}.mp4`, 'event.json'), JSON.stringify(event), cb)
                },
                (cb) => {
                  s3.putObject(bucket, key, result, cb)
                },
                (cb) => {
                  s3.getSignedUrl(bucket, key, expires, (err, result) => {
                    if (!err && result) {
                      url = result
                    }

                    cb(err)
                  })
                },
                (cb) => {

                  async.parallel([
                    (cb) => {
                      if (!emailRecipients.length) {
                        return cb()
                      }

                      const subject = `${carName} ${_.upperFirst(event.type)} ${controllers.formatDate(event.adjustedTimestamp)}`
                      const text = `${url ? `[Download] <${url}> | ` : ''}[Map] <https://www.google.com/maps?q=${event.est_lat},${event.est_lon}>`
                      const html = `${url ? `
                      <video width="100%" controls>
                        <source type="video/mp4" src="${url}">
                      </video>
                      <br>
                      <a href="${url}" target="_blank">Download</a> | ` : ''}<a href="https://www.google.com/maps?q=${event.est_lat},${event.est_lon}" target="_blank">Map</a>`

                      ses.sendEmail(emailRecipients, subject, text, html, (err) => {
                        if (err) {
                          log.warn(`[ram/archive] email failed: ${err}`)
                        }

                        cb()
                      })
                    },
                    (cb) => {
                      if (!telegramRecipients.length) {
                        return cb()
                      }

                      const message = `${carName} ${_.upperFirst(event.type)} ${controllers.formatDate(event.adjustedTimestamp)}\n${url ? `[Download](${url}) | ` : ''}[Map](https://www.google.com/maps?q=${event.est_lat},${event.est_lon})`
                      telegram.sendVideo(telegramRecipients, url, message, true, (err) => {
                        if (err) {
                          log.warn(`[ram/archive] telegram failed: ${err}`)
                        }

                        cb()
                      })
                    }
                  ], cb)
                }
              ], (err) => {
                if (err) {
                  log.warn(`[ram/archive] failed: ${err}`)
                } else {
                  archives.push({
                    created: new Date(event.adjustedTimestamp),
                    lat: event.est_lat,
                    lon: event.est_lon,
                    type: event.type,
                    folder,
                    url,
                    processed: new Date()
                  })

                  log.debug(`[ram/archive] archived ${folder}`)
                }

                cb()
              })
            })
          }
        ], (err) => {
          if (err || _.find(archives, { folder })) {
            fs.rm(path.join(ramDir, 'archive', folder), { recursive: true }, (err) => {
              if (err) {
                log.warn(`[ram/archive] delete failed: ${err}`)
              }

              cb()
            })
          } else {
            cb()
          }
        })
      }, () => {
        setTimeout(next, interval)
      })
    })
  })

  cb()
}

exports.list = () => {
  return archives
}
