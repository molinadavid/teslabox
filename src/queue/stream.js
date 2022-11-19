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
    highest: 20,
    high: 22,
    medium: 26,
    low: 30,
    lowest: 34
  },
  fps: 30,
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
    const isStream = config.get('stream')
    const isStreamCopy = config.get('streamCopy')
    if (!isStream && !isStreamCopy) {
      return cb()
    }

    const carName = config.get('carName')
    const streamQuality = config.get('streamQuality')
    const crf = settings.qualityCrfs[streamQuality]

    const folderParts = input.folder.split('_')
    const outFile = path.join(settings.ramDir, `${input.angle}.mp4`)

    input.tempFile = input.tempFile || path.join(settings.ramDir, `${chance.hash()}.mp4`)

    async.series([
      (cb) => {
        fs.stat(input.tempFile, (err, stats) => {
          if (!err && stats) {
            return cb()
          }

          const command = `ffmpeg -y -hide_banner -loglevel error -i ${settings.iconFile} -i ${input.file} -filter_complex "[0]scale=15:15 [icon]; [1]fps=${settings.fps},scale=640:480,drawtext=fontfile='${settings.fontFile}':fontcolor=${settings.fontColor}:fontsize=12:borderw=1:bordercolor=${settings.borderColor}@1.0:x=22:y=465:text='TeslaBox ${carName.replace(/'/g, '\\')} \(${_.upperFirst(input.angle)}\) %{pts\\:localtime\\:${input.timestamp}}' [video]; [video][icon]overlay=5:462" -preset ${settings.preset} -crf ${crf} ${input.tempFile}`

          log.debug(`[queue/stream] ${input.id} processing: ${command}`)

          exec(command, (err) => {
            if (!err) {
              fs.rm(input.file, () => {})
            }

            cb(err)
          })
        })
      },
      (cb) => {
        exec(`${isStreamCopy ? 'cp' : 'mv'} ${input.tempFile} ${outFile}`, cb)
      },
      (cb) => {
        streams[input.angle] = input.folder

        if (!isStreamCopy) {
          return cb()
        }

        if (!ping.isAlive()) {
          const err = 'no connection to upload'
          return cb(err)
        }

        fs.readFile(input.tempFile, (err, fileContents) => {
          if (err) {
            return cb(err)
          }

          outKey = `${carName}/streams/${folderParts[0]}/${input.folder}-${input.angle}.mp4`

          log.debug(`[queue/stream] ${input.id} uploading: ${outKey}`)

          aws.s3.putObject(outKey, fileContents, (err) => {
            err ? cb(err) : fs.rm(input.tempFile, cb)
          })
        })
      }
    ], (err) => {
      if (err) {
        input.retries = (input.retries || 0) + 1
        log.warn(`[queue/stream] ${input.id} failed (${input.retries} of ${settings.maxRetries} retries): ${err}`)
      } else {
        log.info(`[queue/stream] ${input.id} streamed after ${+new Date() - input.startAt}ms`)
      }

      // clean up silently
      if (!err || input.retries >= settings.maxRetries) {
        fs.rm(input.file, () => {})
        fs.rm(input.tempFile, () => {})
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
  input.startAt = +new Date()
  q.push(input)
  log.debug(`[queue/stream] ${input.id} queued`)
}

exports.list = () => {
  return streams
}
