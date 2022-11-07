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

  usb.getSpace((err, result) => {
    if (err) {
      log.error(`[main] teslabox failed: ${err}`)
    } else {
      const message = `${result.usedPercentFormatted}% used (${result.usedGb} of ${result.totalGb} GB)`
      log[result.status === 'success' ? 'info' : 'warn'](`[main] teslabox started: ${message}`)

      if (result.status != 'success') {
        const carName = config.get('carName')
        const text = `${carName} storage ${result.status}: ${message}`
        queue.notify.push({
          id: 'storage',
          text
        })
      }
    }
  })
})

process.on('uncaughtException', (err) => {
  log.fatal(`[main] uncaught exception: ${err}`)
  process.exit(1)
})
