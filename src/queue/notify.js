const config = require('../config')
const log = require('../log')
const ping = require('../ping')
const ses = require('../aws/ses')
const telegram = require('../telegram')

const _ = require('lodash')
const async = require('async')
const Queue = require('better-queue')

const settings = {
  appUrl: 'https://ownership.tesla.com/en_us/get-app',
  concurrent: 1,
  maxRetries: 3,
  retryDelay: 10000
}

let q

exports.start = (cb) => {
  cb = cb || function () {}

  q = new Queue((input, cb) => {
    const carName = config.get('carName')
    const emailRecipients = config.get('emailRecipients')
    const telegramRecipients = config.get('telegramRecipients')

    async.series([
      (cb) => {
        if (!ping.isAlive()) {
          const err = 'no connection to notify'
          return cb(err)
        }

        cb()
      },
      (cb) => {
        if (!emailRecipients.length || input.emailedAt) {
          return cb()
        }

        let subject = input.subject || input.text
        if (!subject) {
          subject = `TeslaBox ${carName} ${_.upperFirst(input.event.type)}`
          if (input.event.type === 'sentry') {
            subject += ` (${_.upperFirst(input.event.angle)})`
            if (input.isSentryEarlyWarning) {
              subject += ' - Early Warning'
            }
          }
        }

        let text = input.text || input.subject
        if (!text) {
          text = `Map: <https://www.google.com/maps?q=${input.event.est_lat},${input.event.est_lon}>`
          text += `\nApp: <${settings.appUrl}>`
          if (input.photoUrl) {
            text += `\nPhoto: <${input.photoUrl}>`
          }
          if (input.videoUrl) {
            text += `\nVideo: <${input.videoUrl}>`
          }
        }

        let html = input.html || input.text || input.subject
        if (!html) {
          if (input.photoUrl) {
            html += `<img src="${input.photoUrl}"><br><br>`
          }

          html = `<a href="https://www.google.com/maps?q=${input.event.est_lat},${input.event.est_lon}" target="_blank">Map</a>`
          html += ` | <a href="${settings.appUrl}" target="_blank">App</a>`
          if (input.videoUrl) {
            html += ` | <a href="${input.videoUrl}" target="_blank">Download</a>`
          }
        }

        ses.sendEmail(emailRecipients, subject, text, html, (err) => {
          if (!err) {
            input.emailedAt = new Date()
            log.debug(`[queue/notify] ${input.id} emailed ${emailRecipients.join(',')}`)
          }

          cb(err)
        })
      },
      (cb) => {
        if (!telegramRecipients.length || input.telegramedAt) {
          return cb()
        }

        let text = input.text || input.subject
        if (!text) {
          text = `${carName} ${_.upperFirst(input.event.type)}`
          if (input.event.type === 'sentry') {
            text += ` (${_.upperFirst(input.event.angle)})`
            if (input.isSentryEarlyWarning) {
              text += ' - Early Warning'
            }
          }
          text += `\n[Map](https://www.google.com/maps?q=${input.event.est_lat},${input.event.est_lon})`
          text += ` | [App](${settings.appUrl})`
        }

        if (input.photoUrl) {
          text += ` | [Photo](${input.photoUrl})`

          telegram.sendPhoto(telegramRecipients, input.photoUrl, text, (err) => {
            if (!err) {
              input.telegramedAt = new Date()
              log.debug(`[queue/notify] ${input.id} telegramed photo ${telegramRecipients.join(',')}`)
            }

            cb(err)
          })
        } else if (input.videoUrl) {
          text += ` | [Video](${input.videoUrl})`

          telegram.sendVideo(telegramRecipients, input.videoUrl, text, (err) => {
            if (!err) {
              input.telegramedAt = new Date()
              log.debug(`[queue/notify] ${input.id} telegramed video ${telegramRecipients.join(',')}`)
            }

            cb(err)
          })
        } else {
          telegram.sendMessage(telegramRecipients, text, (err) => {
            if (!err) {
              input.telegramedAt = new Date()
              log.debug(`[queue/notify] ${input.id} telegramed message ${telegramRecipients.join(',')}`)
            }

            cb(err)
          })
        }
      }
    ], (err) => {
      if (err) {
        input.retries = (input.retries || 0) + 1
        log.warn(`[queue/notify] ${input.id} failed (${input.retries} of ${settings.maxRetries} retries): ${err}`)
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
  log.debug(`[queue/notify] ${input.id} queued`)
}

exports.list = () => {
  return streams
}
