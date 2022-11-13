const archive = require('./archive')
const early = require('./early')
const notify = require('./notify')
const stream = require('./stream')

const async = require('async')

exports.start = (cb) => {
  cb = cb || function () {}

  async.parallel([
    archive.start,
    early.start,
    notify.start,
    stream.start
  ], cb)
}

exports.archive = archive
exports.early = early
exports.notify = notify
exports.stream = stream

