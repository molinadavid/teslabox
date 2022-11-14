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
  slipage: 250,
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

    async.series([
      (cb) => {
        input.outFile = input.outFile || path.join(settings.ramDir, `${chance.hash()}.jpg`)
        fs.stat(input.outFile, (err, stats) => {
          if (!err && stats) {
            return cb()
          }
        })

        const timestampSeconds = Math.round((input.event.timestamp - settings.slipage) / 1000)
        const start = Math.max(Math.round((input.event.timestamp - input.timestamp - settings.slipage) / 1000), 0)
        let command = `ffmpeg -y -hide_banner -loglevel error -i ${settings.iconFile} -ss ${start} -i ${input.file} -filter_complex "[0]scale=25:25 [icon]; [1]scale=1440:1080,drawtext=fontfile='${settings.fontFile}':fontcolor=${settings.fontColor}:fontsize=25:borderw=1:bordercolor=${settings.borderColor}@1.0:x=38:y=1050:text='TeslaBox ${carName.replace(/'/g, '\\')} Sentry (${_.upperFirst(input.event.angle)}) %{pts\\:localtime\\:${timestampSeconds}}' [image]; [image][icon]overlay=8:1048" -vframes 1 ${input.outFile}`

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

          const folderParts = input.folder.split('_')
          input.outKey = `${carName}/photos/${folderParts[0]}/${input.folder}-${input.event.type}.jpg`

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
            input.photoUrl = url
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
          photoUrl: input.photoUrl,
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
