const log = require('../log')
const archive = require('./archive')
const stream = require('./stream')

const async = require('async')

exports.start = (cb) => {
  cb = cb || function () {}

  log.debug('[ram] started')

  async.parallel([
    archive.start,
    stream.start
  ], cb)
}
