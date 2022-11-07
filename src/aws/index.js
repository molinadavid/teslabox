const s3 = require('./s3')
const ses = require('./ses')

const async = require('async')

exports.start = (cb) => {
  cb = cb || function () {}

  async.parallel([
    s3.start,
    ses.start
  ], cb)
}

exports.s3 = s3
exports.ses = ses
