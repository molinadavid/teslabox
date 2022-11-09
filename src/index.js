require('dotenv').config()

const config = require('./config')
const log = require('./log')
const aws = require('./aws')
const telegram = require('./telegram')
const http = require('./http')
const ping = require('./ping')
const queue = require('./queue')
const usb = require('./usb')

const async = require('async')

async.series([
  config.start,
  log.start,
  aws.start,
  telegram.start,
  http.start,
  ping.start,
  queue.start,
  usb.start
], (err) => {
  if (err) {
    log.error(`[main] teslabox failed: ${err}`)
    return process.exit(1)
  }

  log.info(`[main] teslabox started`)
})

process.on('uncaughtException', (err) => {
  log.fatal(`[main] uncaught exception: ${err}`)
  process.exit(1)
})
