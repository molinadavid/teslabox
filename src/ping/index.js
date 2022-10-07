const log = require('../log')

const _ = require('lodash')
const async = require('async')
const ping = require('ping')

const interval = 10000
const timeout = 5
const hosts = [
  '1.1.1.1',
  '1.0.0.1',
  '8.8.8.8',
  '8.8.4.4',
  '9.9.9.9',
  '149.112.112.112',
  '208.67.222.222',
  '208.67.220.220'
]

let isAlive

exports.start = (cb) => {
  cb = cb || function () {}

  log.debug('[ping] started')

  async.forever((next) => {
    async.someSeries(_.shuffle(hosts), (host, cb) => {
      ping.sys.probe(host, (result) => {
        if (result) {
          return cb(null, true)
        }

        log.debug(`[ping] ${host} failed`)
        cb()
      }, { timeout })
    }, (err, result) => {
      if (result) {
        if (typeof isAlive === 'undefined') {
          log.info('[ping] connection established')
        } else if (!isAlive) {
          log.warn('[ping] connection re-established')
        }
      } else if (isAlive) {
        log.warn('[ping] connection lost')
      }

      isAlive = result

      setTimeout(next, interval)
    })
  })

  cb()
}

exports.isAlive = () => {
  return isAlive
}
