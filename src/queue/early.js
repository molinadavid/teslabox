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
  duration: 5,
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

exports.start = (cb) => {
  cb = cb || function () {}

  const params = {
    concurrent: settings.concurrent,
    maxRetries: settings.maxRetries,
    retryDelay: settings.retryDelay
  }

  q = new Queue((input, cb) => {
    const carName = config.get('carName')
    const isSentry = config.get('sentry')

    const folderParts = input.folder.split('_')

    async.series([
      (cb) => {
        input.outFile = input.outFile || path.join(settings.ramDir, `${chance.hash()}.gif`)
        fs.stat(input.outFile, (err, stats) => {
          if (!err && stats) {
            return cb()
          }
        })

        const start = Math.max(input.event.timestamp - input.timestamp - Math.round(settings.duration * 0.4), 0)
        const duration = Math.round(settings.duration * 0.6)
        const timestamp = input.timestamp + start
        let command = `ffmpeg -y -hide_banner -loglevel error -i ${settings.iconFile} -ss ${start} -t ${duration} -i ${input.file} -filter_complex "[0]scale=15:15 [icon]; [1]fps=5,scale=640:480:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse,drawtext=fontfile='${settings.fontFile}':fontcolor=${settings.fontColor}:fontsize=12:borderw=1:bordercolor=${settings.borderColor}@1.0:x=22:y=465:text='TeslaBox ${carName.replace(/'/g, '\\')} Sentry (${_.upperFirst(input.event.angle)}) %{pts\\:localtime\\:${timestamp}}' [image]; [image][icon]overlay=5:462" -loop 0 ${input.outFile}`

        log.debug(`[queue/early] ${input.id} processing: ${command}`)

        exec(command, (err) => {
          if (!err) {
            fs.rm(input.file, () => {})
          }

          cb(err)
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

          input.outKey = `${carName}/shorts/${folderParts[0]}/${input.folder}-${input.event.type}.gif`
          input.videoKey = `${carName}/archives/${folderParts[0]}/${input.folder}-${input.event.type}.mp4`

          log.debug(`[queue/early] ${input.id} uploading: ${input.outKey}`)
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
            input.shortUrl = url
          }

          cb(err)
        })
      },
      (cb) => {
        if (!isSentry) {
          return cb()
        }

        aws.s3.getSignedUrl(input.videoKey, settings.signedExpirySeconds, (err, url) => {
          if (!err) {
            input.videoUrl = url
          }

          cb(err)
        })
      }
    ], (err) => {
      if (!err) {
        log.info(`[queue/early] ${input.id} sent`)

        queue.notify.push({
          id: input.id,
          event: input.event,
          shortUrl: input.shortUrl,
          videoUrl: input.videoUrl,
          isSentryEarlyWarning: true
        })
      }

      // clean up silentlyrs
      if (!err || input.retries >= settings.maxRetries) {
        fs.rm(input.file, () => {})
        fs.rm(input.outFile, () => {})
      }

      cb(err)
    })
  }, params)

  cb()
}

exports.push = (input) => {
  q.push(input)
  log.debug(`[queue/early] ${input.id} queued`)
}
