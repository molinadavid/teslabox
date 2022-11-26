const config = require('../config')
const log = require('../log')
const ping = require('../ping')
const aws = require('../aws')
const queue = require('../queue')

const _ = require('lodash')
const async = require('async')
const chance = require('chance').Chance()
const { exec } = require('child_process')
const fs = require('fs')
const path = require('path')
const Queue = require('better-queue')

const settings = {
  preset: 'veryfast',
  qualityCrfs: {
    highest: 19,
    high: 23,
    medium: 28,
    low: 33,
    lowest: 36
  },
  iconFile: path.join(__dirname, '../assets/favicon.ico'),
  fontFile: process.env.NODE_ENV === 'production' ? path.join(__dirname, '../assets/FreeSans.ttf') : 'src/assets/FreeSans.ttf',
  fontColor: 'white',
  borderColor: 'black',
  signedExpirySeconds: 7 * 24 * 60 * 60,
  concurrent: 1,
  maxRetries: 3,
  retryDelay: 10000,
  ramDir: process.env.NODE_ENV === 'production' ? '/mnt/ram' : path.join(__dirname, '../../mnt/ram')
}

let q
let archives = []

exports.start = (cb) => {
  cb = cb || function () {}

  const params = {
    concurrent: settings.concurrent,
    maxRetries: settings.maxRetries,
    retryDelay: settings.retryDelay
  }

  q = new Queue((input, cb) => {
    const carName = config.get('carName')
    const isNotify = config.get('emailRecipients').length || config.get('telegramRecipients').length
    const notifications = isNotify ? config.get('notifications') : []
    const archiveQuality = config.get(input.event.type === 'sentry' ? 'sentryQuality' : 'dashcamQuality')
    const crf = settings.qualityCrfs[archiveQuality]

    const timestamps = _.uniq(_.map(input.tempFiles, 'timestamp')).sort()

    async.series([
      (cb) => {
        async.eachSeries(timestamps, (timestamp, cb) => {
          input.files = input.files || {}
          input.files[timestamp] = input.files[timestamp] || path.join(settings.ramDir, `${chance.hash()}.mp4`)
          fs.stat(input.files[timestamp], (err, stats) => {
            if (!err && stats) {
              return cb()
            }

            const front = _.find(input.tempFiles, { timestamp, angle: 'front' })
            const right = _.find(input.tempFiles, { timestamp, angle: 'right' })
            const back = _.find(input.tempFiles, { timestamp, angle: 'back' })
            const left = _.find(input.tempFiles, { timestamp, angle: 'left' })

            if (!front || !right || !back || !left) {
              const err = 'Missing files'
              return cb(err)
            }

            const timestampSeconds = timestamp + front.start

            let command = `ffmpeg -y -hide_banner -loglevel error -i ${settings.iconFile} -ss ${front.start} -t ${front.duration} -i ${front.file} -ss ${right.start} -t ${right.duration} -i ${right.file} -ss ${back.start} -t ${back.duration} -i ${back.file} -ss ${left.start} -t ${left.duration} -i ${left.file} -filter_complex "[0]scale=25:25 [icon]; `

            switch (input.event.angle) {
              case 'front':
                command += `[1]scale=1440:1080,pad=1920:1080 [front]; [2]scale=480:360 [right]; [3]scale=480:360 [back]; [4]scale=480:360 [left]; [front][back] overlay=1440:0 [fb]; [fb][left] overlay=1440:360 [fbl]; [fbl][right] overlay=1440:720`
                break

              case 'right':
                command += `[1]scale=480:360 [front]; [2]scale=1440:1080,pad=1920:1080 [right]; [3]scale=480:360 [back]; [4]scale=480:360 [left]; [right][left] overlay=1440:0 [rl]; [rl][front] overlay=1440:360 [rlf]; [rlf][back] overlay=1440:720`
                break

              case 'back':
                command += `[1]scale=480:360 [front]; [2]scale=480:360 [right]; [3]scale=1440:1080,pad=1920:1080 [back]; [4]scale=480:360 [left]; [back][front] overlay=1440:0 [bf]; [bf][left] overlay=1440:360 [bfl]; [bfl][right] overlay=1440:720`
                break

              case 'left':
                command += `[1]scale=480:360 [front]; [2]scale=480:360 [right]; [3]scale=480:360 [back]; [4]scale=1440:1080,pad=1920:1080 [left]; [left][right] overlay=1440:0 [lr]; [lr][front] overlay=1440:360 [lrf]; [lrf][back] overlay=1440:720`
                break
            }

            command += ` [all]; [all]drawtext=fontfile='${settings.fontFile}':fontcolor=${settings.fontColor}:fontsize=25:borderw=1:bordercolor=${settings.borderColor}@1.0:x=38:y=1050:text='TeslaBox ${carName.replace(/'/g, '\\')} ${_.upperFirst(input.event.type)}${input.event.type === 'sentry' ? ` (${_.upperFirst(input.event.angle)})` : ''} %{pts\\:localtime\\:${timestampSeconds}}' [video]; [video][icon]overlay=8:1048" -preset ${settings.preset} -crf ${crf} ${input.files[timestamp]}`

            log.debug(`[queue/archive] ${input.id} merging: ${command}`)
            exec(command, (err) => {
              if (!err) {
                // clean up silently
                fs.rm(front.file, () => {})
                fs.rm(right.file, () => {})
                fs.rm(back.file, () => {})
                fs.rm(left.file, () => {})
              }

              cb(err)
            })
          })
        }, cb)
      },
      (cb) => {
        input.chaptersFile = input.chaptersFile || path.join(settings.ramDir, `${chance.hash()}.txt`)
        fs.stat(input.chaptersFile, (err, stats) => {
          if (!err && stats) {
            return cb()
          }

          const contents = _.map(timestamps, (timestamp) => {
            return `file '${input.files[timestamp]}'`
          }).join('\n')

          fs.writeFile(input.chaptersFile, contents, cb)
        })
      },
      (cb) => {
        input.concatFile = input.concatFile || path.join(settings.ramDir, `${chance.hash()}.mp4`)
        fs.stat(input.concatFile, (err, stats) => {
          if (!err && stats) {
            return cb()
          }

          const command = `ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i ${input.chaptersFile} -c copy ${input.concatFile}`

          log.debug(`[queue/archive] ${input.id} concating: ${command}`)
          exec(command, (err) => {
            if (!err) {
              _.each(_.values(input.files), (file) => {
                fs.rm(file, () => {})
              })

              fs.rm(input.chaptersFile, () => {})
            }

            cb(err)
          })
        })
      },
      (cb) => {
        input.outFile = input.outFile || path.join(settings.ramDir, `${chance.hash()}.mp4`)
        fs.stat(input.outFile, (err, stats) => {
          if (!err && stats) {
            return cb()
          }

          const command = `ffmpeg -y -hide_banner -loglevel error -i ${input.concatFile} -f lavfi -i anullsrc -c:v copy -c:a aac -shortest ${input.outFile}`

          log.debug(`[queue/archive] ${input.id} silencing: ${command}`)
          exec(command, (err) => {
            if (!err) {
              fs.rm(input.concatFile, () => {})
            }

            cb(err)
          })
        })
      },
      (cb) => {
        if (!ping.isAlive()) {
          const err = 'no connection to upload'
          return cb(err)
        }

        fs.readFile(input.outFile, (err, fileContents) => {
          if (err) {
            return cb(err)
          }

          const folderParts = input.folder.split('_')
          input.outKey = `${carName}/archives/${folderParts[0]}/${input.folder}-${input.event.type}.mp4`

          log.debug(`[queue/archive] ${input.id} uploading: ${input.outKey}`)
          aws.s3.putObject(input.outKey, fileContents, (err) => {
            if (!err) {
              fs.rm(input.outFile, () => {})
            }

            cb(err)
          })
        })
      },
      (cb) => {
        aws.s3.getSignedUrl(input.outKey, settings.signedExpirySeconds, (err, url) => {
          if (!err) {
            input.videoUrl = url
          }

          cb(err)
        })
      }
    ], (err) => {
      if (err) {
        input.retries = (input.retries || 0) + 1
        log.warn(`[queue/archive] ${input.id} failed (${input.retries} of ${settings.maxRetries} retries): ${err}`)
      } else {
        archives.push({
          type: input.event.type,
          created: input.event.timestamp * 1000,
          processed: +new Date(),
          lat: input.event.est_lat,
          lon: input.event.est_lon,
          url: input.videoUrl,
          taken: +new Date() - input.startAt
        })

        if (notifications.includes('fullVideo')) {
          queue.notify.push({
            id: input.id,
            event: input.event,
            videoUrl: input.videoUrl
          })
        }

        log.info(`[queue/archive] ${input.id} archived after ${+new Date() - input.startAt}ms`)
      }

      // clean up silently
      if (!err || input.retries >= settings.maxRetries) {
        _.each(input.tempFiles, (file) => {
          fs.rm(file.file, () => {})
        })

        _.each(_.values(input.files), (file) => {
          fs.rm(file, () => {})
        })

        if (input.chaptersFile) {
          fs.rm(input.chaptersFile, () => {})
        }

        if (input.concatFile) {
          fs.rm(input.concatFile, () => {})
        }

        if (input.outFile) {
          fs.rm(input.outFile, () => {})
        }
      }

      cb(err)
    })
  }, params)

  cb()
}

exports.push = (input) => {
  input.startAt = +new Date()
  q.push(input)
  log.debug(`[queue/archive] ${input.id} queued`)
}

exports.list = () => {
  return archives
}
