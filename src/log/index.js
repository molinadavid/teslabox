const config = require('../config')

const settings = {
  maxLogs: 1000
}

const levels = ['debug', 'info', 'warn', 'error', 'fatal']

let logs = []

const log = (level, message) => {
  const minLogLevel = levels.indexOf(config.get('logLevel'))
  const logLevel = levels.indexOf(level)

  if (logLevel < minLogLevel) {
    return false
  }

  const row = {
    created: new Date(),
    level,
    message
  }

  const output = ['warn', 'error', 'fatal'].includes(level) ? 'error' : 'log'
  console[output](`${level.toUpperCase()} ${message}`)

  logs.push(row)
  logs = logs.slice(-settings.maxLogs)
}

exports.start = (cb) => {
  cb = cb || function () {}

  cb()
}

exports.debug = (message) => {
  log('debug', message)
}

exports.info = (message) => {
  log('info', message)
}

exports.warn = (message) => {
  log('warn', message)
}

exports.error = (message) => {
  log('error', message)
}

exports.fatal = (message) => {
  log('fatal', message)
}

exports.list = () => {
  return logs
}
