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
  ramDir: process.env.NODE_ENV === 'production' ? '/mnt/ram' : path.join(__dirname, '../../mnt/ram'),
  cinematicFrames: 24,
  cinematicDuration: 1
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
    const crf = settings.qualityCrfs[input.archiveQuality]

    const timestamps = _.uniq(_.map(input.tempFiles, 'timestamp')).sort()

    async.series([
      (cb) => {
        if (input.steps.includes('processed')) {
          return cb()
        }

        async.eachSeries(timestamps, (timestamp, cb) => {
          if (input.steps.includes(`processed-${timestamp}`)) {
            return cb()
          }

          const front = _.find(input.tempFiles, { timestamp, angle: 'front' })
          const right = _.find(input.tempFiles, { timestamp, angle: 'right' })
          const back = _.find(input.tempFiles, { timestamp, angle: 'back' })
          const left = _.find(input.tempFiles, { timestamp, angle: 'left' })

          if (!front || !right || !back || !left) {
            const err = 'missing files'
            return cb(err)
          }

          const timestampSeconds = timestamp + front.start

          input.files[timestamp] = input.files[timestamp] || path.join(settings.ramDir, `${chance.hash()}.mp4`)

          if (input.isSentryCinematic) {
            const seconds = []
            const files = { front, right, back, left }
            async.eachOfSeries(files, (file, angle, cb) => {
              input.files[`${timestamp}-${file.angle}`] = input.files[`${timestamp}-${angle}`] || path.join(settings.ramDir, `${chance.hash()}.log`)

              const crop = {
                front: '1280:680:0:280',
                right: '1060:640:60:320',
                back: '940:530:170:170',
                left: '1060:640:160:320'
              }[angle]

              const command = `ffmpeg -y -hide_banner -loglevel error -ss ${file.start} -t ${file.duration} -i ${file.file} -vf select='not(mod(n\\,${settings.cinematicFrames}))',crop=${crop},select='gte(scene\\,0)',metadata=print:file=${input.files[`${timestamp}-${file.angle}`]} -an -f null -`

              log.debug(`[queue/archive] ${input.id} processing: ${command}`)
              exec(command, (err) => {
                if (err) {
                  return cb(err)
                }

                fs.readFile(input.files[`${timestamp}-${file.angle}`], 'utf8', (err, data) => {
                  if (!err) {
                    const lines = data.split('\n')
                    let second
                    _.each(lines, (line) => {
                      if (line.includes(':')) {
                        second = _.min([_.round(_.last(line.split(':'))) + file.start, 59])
                      } else {
                        const score = Number(_.last(line.split('=') || 0))
                        const previousSecond = _.find(seconds, { second, angle })
                        if (previousSecond) {
                          previousSecond.score =_.max([previousSecond.score, score])
                        } else {
                          const isEvent = file.angle === input.event.angle && timestamp + second === input.event.timestamp
                          seconds.push({ second, angle, score, isEvent })
                        }
                      }
                    })
                  }

                  cb(err)
                })
              })
            }, (err) => {
              if (err) {
                return cb(err)
              }

              let start
              let duration = 0

              const orderedSeconds = _.orderBy(seconds, ['second', 'isEvent', 'score'], ['asc', 'desc', 'desc'])
              const uniqueSeconds = _.uniqBy(_.map(orderedSeconds, 'second'))
              const scenes = []

              _.each(uniqueSeconds, (uniqueSecond) => {
                const second = _.find(orderedSeconds, { second: uniqueSecond })
                const nextSecond = _.find(orderedSeconds, { second: uniqueSecond + 1 }) || {}
                start = start || second.second
                input.lastAngle = input.lastAngle || second.angle

                if (input.lastAngle === second.angle || (!second.isEvent && (second.angle !== nextSecond.angle || duration < settings.cinematicDuration))) {
                  duration++
                } else {
                  scenes.push({ angle: input.lastAngle, start, duration })
                  start = second.second
                  input.lastAngle = second.angle
                  duration = 0
                }

              })

              if (duration) {
                scenes.push({ angle: input.lastAngle, start, duration })
              }

              let command = `ffmpeg -y -hide_banner -loglevel error -i ${settings.iconFile}`
              _.each(scenes, (scene) => {
                command += ` -ss ${scene.start} -t ${scene.duration} -i ${files[scene.angle].file}`
              })

              command += ` -filter_complex "[0]scale=25:25 [icon]; `

              for (let i = 0; i < scenes.length; i++) {
                command += `[${i + 1}]`
              }

              command += `concat=n=${scenes.length}:v=1 [all]; [all]drawtext=fontfile='${settings.fontFile}':fontcolor=${settings.fontColor}:fontsize=25:borderw=1:bordercolor=${settings.borderColor}@1.0:x=38:y=930:text='TeslaBox ${input.carName.replace(/'/g, '\\')} ${_.upperFirst(input.event.type)} %{pts\\:localtime\\:${timestampSeconds}}' [video]; [video][icon]overlay=8:928" -preset ${settings.preset} -crf ${crf} -r 24 ${input.files[timestamp]}`

              log.debug(`[queue/archive] ${input.id} processing: ${command}`)
              exec(command, (err) => {
                if (!err) {
                  input.steps.push(`processed-${timestamp}`)
                  _.each(['front', 'right', 'back', 'left'], (angle) => {
                    const file = input.files[`${timestamp}-${angle}`]
                    fs.rm(file, () => {})
                  })
                }

                cb(err)
              })
            })
          } else {
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

            command += ` [all]; [all]drawtext=fontfile='${settings.fontFile}':fontcolor=${settings.fontColor}:fontsize=25:borderw=1:bordercolor=${settings.borderColor}@1.0:x=38:y=1050:text='TeslaBox ${input.carName.replace(/'/g, '\\')} ${_.upperFirst(input.event.type)}${input.event.type === 'sentry' ? ` (${_.upperFirst(input.event.angle)})` : ''} %{pts\\:localtime\\:${timestampSeconds}}' [video]; [video][icon]overlay=8:1048" -preset ${settings.preset} -crf ${crf} ${input.files[timestamp]}`

            log.debug(`[queue/archive] ${input.id} processing: ${command}`)
            exec(command, (err) => {
              if (!err) {
                input.steps.push(`processed-${timestamp}`)
                fs.rm(front.file, () => {})
                fs.rm(right.file, () => {})
                fs.rm(back.file, () => {})
                fs.rm(left.file, () => {})
              }

              cb(err)
            })
          }
        }, (err) => {
          if (!err) {
            input.steps.push('processed')
          }

          cb(err)
        })
      },
      (cb) => {
        if (input.steps.includes('chaptered')) {
          return cb()
        }

        const contents = _.map(timestamps, (timestamp) => {
          return `file '${input.files[timestamp]}'`
        }).join('\n')

        fs.writeFile(input.chaptersFile, contents, (err) => {
          if (!err) {
            input.steps.push('chaptered')
          }

          cb(err)
        })
      },
      (cb) => {
        if (input.steps.includes('concated')) {
          return cb()
        }

        const command = `ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i ${input.chaptersFile} -c copy ${input.concatFile}`

        log.debug(`[queue/archive] ${input.id} concating: ${command}`)
        exec(command, (err) => {
          if (!err) {
            input.steps.push('concated')
            _.each(_.values(input.files), (file) => {
              fs.rm(file, () => {})
            })

            fs.rm(input.chaptersFile, () => {})
          }

          cb(err)
        })
      },
      (cb) => {
        if (input.steps.includes('silenced')) {
          return cb()
        }

        const command = `ffmpeg -y -hide_banner -loglevel error -i ${input.concatFile} -f lavfi -i anullsrc -c:v copy -c:a aac -shortest ${input.outFile}`

        log.debug(`[queue/archive] ${input.id} silencing: ${command}`)
        exec(command, (err) => {
          if (!err) {
            input.steps.push('silenced')
            fs.rm(input.concatFile, () => {})
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

          log.debug(`[queue/archive] ${input.id} uploading: ${input.outKey}`)
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
          cb()
        }

        aws.s3.getSignedUrl(input.outKey, settings.signedExpirySeconds, (err, url) => {
          if (!err) {
            input.steps.push('signed')
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
          taken: +new Date() - input.startedAt
        })

        if (input.notifications.includes('fullVideo')) {
          queue.notify.push({
            id: input.id,
            event: input.event,
            videoUrl: input.videoUrl
          })
        }

        log.info(`[queue/archive] ${input.id} archived after ${+new Date() - input.startedAt}ms`)
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
  const carName = config.get('carName')

  _.assign(input, {
    carName,
    notifications: config.get('emailRecipients').length || config.get('telegramRecipients').length ? config.get('notifications') : [],
    archiveQuality: config.get(input.event.type === 'sentry' ? 'sentryQuality' : 'dashcamQuality'),
    chaptersFile: path.join(settings.ramDir, `${chance.hash()}.txt`),
    concatFile: path.join(settings.ramDir, `${chance.hash()}.mp4`),
    outFile: path.join(settings.ramDir, `${chance.hash()}.mp4`),
    outKey: `${carName}/archives/${input.folder.split('_')[0]}/${input.folder}-${input.event.type}.mp4`,
    isSentryCinematic: input.event.type === 'sentry' && config.get('sentryCinematic'),
    files: {},
    startedAt: +new Date(),
    steps: []
  })

  q.push(input)
  log.debug(`[queue/archive] ${input.id} queued`)
}

exports.list = () => {
  return archives
}
