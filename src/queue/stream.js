const config = require('../config')
const log = require('../log')
const ping = require('../ping')
const aws = require('../aws')

const _ = require('lodash')
const async = require('async')
const chance = require('chance').Chance()
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const Queue = require('better-queue')

const settings = {
  preset: 'veryfast',
  qualityCrfs: {
    highest: 21,
    high: 23,
    medium: 26,
    low: 28,
    lowest: 30
  },
  iconFile: path.join(__dirname, '../assets/favicon.ico'),
  fontFile: process.env.NODE_ENV === 'production' ? path.join(__dirname, '../assets/FreeSans.ttf') : 'src/assets/FreeSans.ttf',
  fontColor: 'white',
  borderColor: 'black',
  concurrent: 1,
  maxRetries: 3,
  retryDelay: 10000,
  ramDir: process.env.NODE_ENV === 'production' ? '/mnt/ram' : path.join(__dirname, '../../mnt/ram')
}

let q
let streams = {}

exports.start = (cb) => {
  cb = cb || function () {}

  q = new Queue((input, cb) => {
    async.series([
      (cb) => {
        if (input.steps.includes('processed')) {
          return cb()
        }

        const crf = settings.qualityCrfs[input.streamQuality]

        let command
        switch (input.streamQuality) {
          case 'highest':
          case 'high':
            command = `ffmpeg -y -hide_banner -loglevel error -i ${settings.iconFile} -i ${input.tempFile} -filter_complex "[0]scale=18:18 [icon]; [1]scale=1024:768,drawtext=fontfile='${settings.fontFile}':fontcolor=${settings.fontColor}:fontsize=14:borderw=1:bordercolor=${settings.borderColor}@1.0:x=25:y=750:text='TeslaBox ${input.carName.replace(/'/g, '\\')} \(${_.upperFirst(input.angle)}\) %{pts\\:localtime\\:${input.timestamp}}' [video]; [video][icon]overlay=5:747" -preset ${settings.preset} -crf ${crf} ${input.file}`
            break

          case 'low':
          case 'lowest':
            command = `ffmpeg -y -hide_banner -loglevel error -i ${settings.iconFile} -i ${input.tempFile} -filter_complex "[0]scale=12:12 [icon]; [1]scale=320:240,drawtext=fontfile='${settings.fontFile}':fontcolor=${settings.fontColor}:fontsize=9:borderw=1:bordercolor=${settings.borderColor}@1.0:x=19:y=228:text='TeslaBox ${input.carName.replace(/'/g, '\\')} \(${_.upperFirst(input.angle)}\) %{pts\\:localtime\\:${input.timestamp}}' [video]; [video][icon]overlay=5:227" -preset ${settings.preset} -crf ${crf} ${input.file}`
            break

          default:
            command = `ffmpeg -y -hide_banner -loglevel error -i ${settings.iconFile} -i ${input.tempFile} -filter_complex "[0]scale=15:15 [icon]; [1]scale=640:480,drawtext=fontfile='${settings.fontFile}':fontcolor=${settings.fontColor}:fontsize=12:borderw=1:bordercolor=${settings.borderColor}@1.0:x=22:y=465:text='TeslaBox ${input.carName.replace(/'/g, '\\')} \(${_.upperFirst(input.angle)}\) %{pts\\:localtime\\:${input.timestamp}}' [video]; [video][icon]overlay=5:462" -preset ${settings.preset} -crf ${crf} ${input.file}`
        }

        log.debug(`[queue/stream] ${input.id} processing: ${command}`)

        exec(command, (err) => {
          if (!err) {
            input.steps.push('processed')
            fs.rm(input.tempFile, () => {})
          }

          cb(err)
        })
      },
      (cb) => {
        if (input.steps.includes('copied')) {
          return cb()
        }

        exec(`${input.isStreamCopy ? 'cp' : 'mv'} ${input.file} ${input.outFile}`, (err) => {
          if (!err) {
            input.steps.push('copied')
            streams[input.angle] = input.folder
          }

          cb(err)
        })
      },
      (cb) => {
        if (input.steps.includes('uploaded') || !input.isStreamCopy) {
          return cb()
        }

        if (!ping.isAlive()) {
          const err = 'no connection to upload'
          return cb(err)
        }

        fs.readFile(input.file, (err, fileContents) => {
          if (err) {
            return cb(err)
          }

          log.debug(`[queue/stream] ${input.id} uploading: ${input.outKey}`)

          aws.s3.putObject(input.outKey, fileContents, (err) => {
            if (!err) {
              input.steps.push('uploaded')
              fs.rm(input.file, () => {})
            }

            cb(err)
          })
        })
      }
    ], (err) => {
      if (err) {
        input.retries = (input.retries || 0) + 1
        log.warn(`[queue/stream] ${input.id} failed (${input.retries} of ${settings.maxRetries} retries): ${err}`)
      } else {
        log.info(`[queue/stream] ${input.id} streamed after ${+new Date() - input.startedAt}ms`)
      }

      // clean up silently
      if (!err || input.retries >= settings.maxRetries) {
        fs.rm(input.tempFile, () => {})
        fs.rm(input.file, () => {})
      }

      cb(err)
    })
  }, {
    concurrent: settings.concurrent,
    maxRetries: settings.maxRetries,
    retryDelay: settings.retryDelay
  })

  cb()
}

exports.push = (input) => {
  const carName = config.get('carName')

  _.assign(input, {
    carName,
    streamQuality: config.get('streamQuality'),
    isStreamCopy: config.get('streamCopy'),
    file: path.join(settings.ramDir, `${chance.hash()}.mp4`),
    outFile: path.join(settings.ramDir, `${input.angle}.mp4`),
    outKey: `${carName}/streams/${input.folder.split('_')[0]}/${input.folder}-${input.angle}.mp4`,
    startedAt: +new Date(),
    steps: []
  })

  q.push(input)
  log.debug(`[queue/stream] ${input.id} queued`)
}

exports.list = () => {
  return streams
}
