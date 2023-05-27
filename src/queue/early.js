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
  maxRetries: Infinity,
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
    async.series([
      (cb) => {
        if (input.steps.includes('processed')) {
          return cb()
        }

        const start = Math.max(input.event.timestamp - input.timestamp - 2, 0)
        const duration = Math.round(settings.duration)
        const timestamp = input.timestamp + start
        let command = `ffmpeg -y -hide_banner -loglevel error -i ${settings.iconFile} -ss ${start} -t ${duration} -i ${input.file} -filter_complex "[0]scale=15:15 [icon]; [1]fps=5,scale=640:480:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse,drawtext=fontfile='${settings.fontFile}':fontcolor=${settings.fontColor}:fontsize=12:borderw=1:bordercolor=${settings.borderColor}@1.0:x=22:y=465:text='TeslaBox ${input.carName.replace(/'/g, '\\')} ${_.upperFirst(input.event.type)}${input.event.type === 'sentry' ? ` (${_.upperFirst(input.event.angle)})` : ''} %{pts\\:localtime\\:${timestamp}}' [image]; [image][icon]overlay=5:462" -loop 0 ${input.outFile}`

        log.debug(`[queue/early] ${input.id} processing: ${command}`)
        exec(command, (err) => {
          if (!err) {
            input.steps.push('processed')
            fs.rm(input.file, () => {})
          }

          cb(err)
        })
      },
      (cb) => {
        if (input.steps.includes('uploaded')) {
          return cb()
        }

        if (!ping.isAlive()) {
          const err = 'no connection to upload'
          return cb(err)
        }

        fs.readFile(input.outFile, (err, fileContents) => {
          if (err) {
            return cb(err)
          }

          log.debug(`[queue/early] ${input.id} uploading: ${input.outKey}`)
          aws.s3.putObject(input.outKey, fileContents, (err) => {
            if (!err) {
              input.steps.push('uploaded')
              fs.rm(input.outFile, () => {})
            }

            cb(err)
          })
        })
      },
      (cb) => {
        if (input.steps.includes('signed')) {
          return cb()
        }

        async.parallel([
          (cb) => {
            aws.s3.getSignedUrl(input.outKey, settings.signedExpirySeconds, (err, url) => {
              if (!err) {
                input.shortUrl = url
              }

              cb(err)
            })
          },
          (cb) => {
            aws.s3.getSignedUrl(input.videoKey, settings.signedExpirySeconds, (err, url) => {
              if (!err) {
                input.videoUrl = url
              }

              cb(err)
            })
          }
        ], (err) => {
          if (!err) {
            input.steps.push('signed')
          }

          cb(err)
        })
      }
    ], (err) => {
      if (!err || !input.steps.includes('processed')) {
        fs.rm(input.file, () => {})
        fs.rm(input.outFile, () => {})

        if (err) {
          log.error(`[queue/early] ${input.id} failed: ${err}`)
          q.cancel(input.id)
        } else {
          log.info(`[queue/early] ${input.id} sent after ${+new Date() - input.startedAt}ms`)

          queue.notify.push({
            id: input.id,
            event: input.event,
            shortUrl: input.shortUrl,
            videoUrl: input.videoUrl
          })
        }
      }

      cb(err)
    })
  }, params)

  cb()
}

exports.push = (input) => {
  const carName = config.get('carName')

  _.assign(input, {
    carName,
    outFile: path.join(settings.ramDir, `${chance.hash()}.gif`),
    outKey: `${carName}/shorts/${input.folder.split('_')[0]}/${input.folder}-${input.event.type}.gif`,
    videoKey: `${carName}/archives/${input.folder.split('_')[0]}/${input.folder}-${input.event.type}.mp4`,
    startedAt: +new Date(),
    steps: []
  })

  q.push(input)
  log.debug(`[queue/early] ${input.id} queued`)
}
