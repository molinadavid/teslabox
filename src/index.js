require('dotenv').config()

const config = require('./config')
const log = require('./log')
const aws = require('./aws')
const dropbox = require('./dropbox')
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
  dropbox.start,
  telegram.start,
  http.start,
  ping.start,
  queue.start,
  usb.start
], (err) => {
  if (err) {
    log.fatal(`[main] teslabox failed: ${err}`)
    return process.exit(1)
  }

  log.info(`[main] teslabox started`)
})

process.on('SIGINT', () => {
  log.info(`[main] teslabox stopped`)
  usb.umount(() => {
    process.exit(0)
  })
})

process.on('uncaughtException', (err) => {
  log.fatal(`[main] uncaught exception: ${err}`)
  console.error(err)
  process.exit(1)
})
