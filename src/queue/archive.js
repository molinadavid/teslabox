const config = require('../config')
const log = require('../log')
const ping = require('../ping')
const queue = require('./')
const aws = require('../aws')

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
  fontFile: path.join(__dirname, '../assets/FreeSans.ttf'),
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
    const archiveQuality = config.get(input.event.type === 'sentry' ? 'sentryQuality' : 'dashcamQuality')
    const crf = settings.qualityCrfs[archiveQuality]

    async.eachSeries(input.chapters, (chapter, cb) => {
      chapter.tempFile = chapter.tempFile || path.join(settings.ramDir, `${chance.hash()}.mp4`)
      fs.stat(chapter.tempFile, (err, stats) => {
        if (!err && stats) {
          return cb()
        }

        const frontFile = _.find(chapter.files, { angle: 'front' }).file
        const rightFile = _.find(chapter.files, { angle: 'right' }).file
        const backFile = _.find(chapter.files, { angle: 'back' }).file
        const leftFile = _.find(chapter.files, { angle: 'left' }).file
        const timestamp = Math.round((chapter.timestamp + chapter.start) / 1000)
        const start = chapter.start / 1000
        const duration = chapter.duration / 1000

        let command = `ffmpeg -y -hide_banner -loglevel error -i ${settings.iconFile} -ss ${start} -t ${duration} -i ${frontFile} -ss ${start} -t ${duration} -i ${rightFile} -ss ${start} -t ${duration} -i ${backFile} -ss ${start} -t ${duration} -i ${leftFile} -filter_complex "[0]scale=18:18 [icon]; `

        switch (input.event.angle) {
          case 'front':
            command += `[1]scale=1440:1080,pad=1920:1080 [front]; [2]scale=480:360 [right]; [3]scale=480:360,hflip [back]; [4]scale=480:360 [left]; [front][back] overlay=1440:0 [fb]; [fb][left] overlay=1440:360 [fbl]; [fbl][right] overlay=1440:720`
            break

          case 'right':
            command += `[1]scale=480:360 [front]; [2]scale=1440:1080,pad=1920:1080 [right]; [3]scale=480:360,hflip [back]; [4]scale=480:360 [left]; [right][left] overlay=1440:0 [rl]; [rl][front] overlay=1440:360 [rlf]; [rlf][back] overlay=1440:720`
            break

          case 'back':
            command += `[1]scale=480:360 [front]; [2]scale=480:360 [right]; [3]scale=1440:1080,pad=1920:1080 [back]; [4]scale=480:360 [left]; [back][front] overlay=1440:0 [bf]; [bf][left] overlay=1440:360 [bfl]; [bfl][right] overlay=1440:720`
            break

          case 'left':
            command += `[1]scale=480:360 [front]; [2]scale=480:360 [right]; [3]scale=480:360,hflip [back]; [4]scale=1440:1080,pad=1920:1080 [left]; [left][right] overlay=1440:0 [lr]; [lr][front] overlay=1440:360 [lrf]; [lrf][back] overlay=1440:720`
            break
        }

        command += ` [all]; [all]drawtext=fontfile='${settings.fontFile}':fontcolor=${settings.fontColor}:fontsize=17:borderw=1:bordercolor=${settings.borderColor}@1.0:x=29:y=1058:text='TeslaBox ${carName.replace(/'/g, '\\')} ${_.upperFirst(input.event.type)}${input.event.type === 'sentry' ? ` (${_.upperFirst(input.event.angle)})` : ''} %{pts\\:localtime\\:${timestamp}}' [video]; [video][icon]overlay=6:1057" -preset ${settings.preset} -crf ${crf} ${chapter.tempFile}`

        log.debug(`[queue/archive] ${input.id} merging: ${command}`)
        exec(command, (err) => {
          if (!err) {
            // clean up silently
            fs.rm(frontFile, () => {})
            fs.rm(rightFile, () => {})
            fs.rm(backFile, () => {})
            fs.rm(leftFile, () => {})
          }

          cb(err)
        })
      })
    }, (err) => {
      if (err) {
        input.retries = (input.retries || 0) + 1
        log.warn(`[queue/archive] ${input.id} failed (${input.retries} of ${settings.maxRetries} retries): ${err}`)
      }

      async.series([
        (cb) => {
          if (err) {
            return cb(err)
          }

          input.chaptersFile = input.chaptersFile || path.join(settings.ramDir, `${chance.hash()}.txt`)
          fs.stat(input.chaptersFile, (err, stats) => {
            if (!err && stats) {
              return cb()
            }

            const contents = _.map(input.chapters, (chapter) => {
              return `file '${chapter.tempFile}'`
            }).reverse().join('\n')

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
              err ? cb(err) : fs.rm(input.chaptersFile, cb)
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
              err ? cb(err) : fs.rm(input.concatFile, cb)
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
              err ? cb(err) : fs.rm(input.outFile, cb)
            })
          })
        },
        (cb) => {
          aws.s3.getSignedUrl(input.outKey, settings.signedExpirySeconds, (err, url) => {
            if (!err) {
              input.url = url
            }

            cb(err)
          })
        }
      ], (err) => {
        if (!err) {
          log.info(`[queue/archive] ${input.id} archived`)

          archives.push({
            type: input.event.type,
            created: +new Date(input.event.timestamp),
            processed: +new Date(),
            lat: input.event.est_lat,
            lon: input.event.est_lon,
            url: input.url
          })

          log.debug(`[queue/archive] queued notification ${input.id}`)

          queue.notify.push({
            id: input.id,
            event: input.event,
            url: input.url
          })
        }

        // clean up silently
        if (!err || input.retries >= settings.maxRetries) {
          fs.rm(input.chaptersFile, () => {})
          fs.rm(input.concatFile, () => {})
          fs.rm(input.outFile, () => {})
          _.each(input.chapters, (chapter) => {
            fs.rm(chapter.tempFile, () => {})
            _.each(['front', 'right', 'back', 'left'], (angle) => {
              fs.rm(_.find(chapter.files, { angle }).file, () => {})
            })
          })
        }

        cb(err)
      })
    })
  }, params)

  cb()
}

exports.push = (input) => {
  q.push(input)
}

exports.list = () => {
  return archives
}
