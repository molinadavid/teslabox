const config = require('../config')
const log = require('../log')
const ping = require('../ping')
const s3 = require('../aws/s3')

const _ = require('lodash')
const async = require('async')
const chance = require('chance').Chance()
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const Queue = require('better-queue')

const settings = {
  scaleWidth: 640,
  scaleHeight: 480,
  preset: 'veryfast',
  qualityCrfs: {
    highest: 18,
    high: 20,
    medium: 24,
    low: 28,
    lowest: 32
  },
  iconFile: path.join(__dirname, '../assets/favicon.ico'),
  fontFile: path.join(__dirname, '../assets/FreeSans.ttf'),
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
    const carName = config.get('carName')
    const isStreamCopy = config.get('streamCopy')
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

          const timestamp = new Date(`${folderParts[0]} ${folderParts[1].replace(/-/g, ':')}`).getTime() / 1000
          const command = `ffmpeg -y -hide_banner -loglevel error -i ${settings.iconFile} -i ${input.file} -filter_complex "[0]scale=w=15:h=15 [icon]; [1]scale=w=${settings.scaleWidth}:h=${settings.scaleHeight},drawtext=fontfile='${settings.fontFile}':fontcolor=${settings.fontColor}:fontsize=12:borderw=1:bordercolor=${settings.borderColor}@1.0:x=24:y=(h-(text_h)-5):text='TeslaBox ${carName.replace(/'/g, '\\')} \(${_.upperFirst(input.angle)}\) %{pts\\:localtime\\:${timestamp}}' [video]; [video][icon]overlay=x=6:y=${settings.scaleHeight-19}" -preset ${settings.preset} -crf ${crf} ${input.tempFile}`
          exec(command, (err) => {
            err ? cb(err) : fs.rm(input.file, cb)
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

          const outKey = `${carName}/streams/${folderParts[0]}/${input.folder}-${input.angle}.mp4`

          s3.putObject(outKey, fileContents, (err) => {
            err ? cb(err) : fs.rm(input.tempFile, cb)
          })
        })
      }
    ], (err) => {
      if (err) {
        input.retries = (input.retries || 0) + 1
        log.warn(`[queue/stream] ${input.id} failed (${input.retries} of ${settings.maxRetries} retries): ${err}`)
      } else {
        log.info(`[queue/stream] ${input.id} streamed`)
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
  q.push(input)
}

exports.list = () => {
  return streams
}
