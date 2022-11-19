const _ = require('lodash')
const JSONdb = require('simple-json-db')
const path = require('path')

const settings = {
  carName: 'My Tesla',
  logLevel: 'warn',
  emailRecipients: [],
  telegramRecipients: [],
  dashcam: true,
  dashcamQuality: 'medium',
  dashcamDuration: 45,
  sentry: true,
  sentryQuality: 'high',
  sentryDuration: 30,
  stream: false,
  streamCopy: false,
  streamQuality: 'high',
  streamAngles: ['front']
}

let db

exports.start = (cb) => {
  cb = cb || function () {}

  db = new JSONdb(path.join(__dirname, '../../config.json'))

  // if never set, use defaults
  _.forEach(settings, (value, key) => {
    if (!db.has(key)) {
      exports.set(key, value)
    }
  })

  cb()
}

exports.get = (key) => {
  return db.get(key)
}

exports.set = (key, value) => {
  switch (key) {
    case 'logLevel':
      value = ['debug', 'info', 'warn', 'error', 'fatal'].includes(value) ? value : settings[key]
      break

    case 'emailRecipients':
    case 'telegramRecipients':
    case 'streamAngles':
      value = _.compact(_.isArray(value) ? value : _.split(value.toLowerCase(), /[\r\n, ]+/))
      if (!value.length) {
        value = settings[key]
      }
      break

    case 'sentryQuality':
    case 'dashcamQuality':
    case 'streamQuality':
      value = ['highest', 'high', 'medium', 'low', 'lowest'].includes(value) ? value : settings[key]
      break

    case 'dashcam':
    case 'sentry':
    case 'stream':
    case 'streamCopy':
      value = !!value
      break

    case 'sentryDuration':
    case 'dashcamDuration':
      value = Number(value) || settings[key]
      break

    case 'emailRecipients':
    case 'telegramRecipients':
    case 'streamAngles':
      value = _.compact(_.isArray(value) ? value : _.split(value.toLowerCase(), /[\r\n, ]+/))
      if (!value.length) {
        value = settings[key]
      }
      break

    default:
      value = value || settings[key]
  }

  return db.set(key, value)
}

exports.sync = () => {
  return db.sync()
}

exports.json = () => {
  return db.JSON()
}
