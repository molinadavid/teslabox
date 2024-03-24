const dropbox = require('./dropbox')

const async = require('async')

exports.start = (cb) => {
  cb = cb || function () {}

  async.parallel([
    dropbox.start
  ], cb)
}

exports.dropbox = dropbox