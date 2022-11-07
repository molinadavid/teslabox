const archive = require('./archive')
const stream = require('./stream')
const notify = require('./notify')

const async = require('async')

exports.start = (cb) => {
  cb = cb || function () {}

  async.parallel([
    archive.start,
    stream.start,
    notify.start
  ], cb)
}

exports.archive = archive
exports.stream = stream
exports.notify = notify
