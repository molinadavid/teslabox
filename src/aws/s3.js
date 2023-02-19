const log = require('../log')

const { S3 } = require('@aws-sdk/client-s3')

const settings = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_DEFAULT_REGION,
  bucket: process.env.AWS_S3_BUCKET
}

let client

exports.start = (cb) => {
  cb = cb || function () {}

  if (!settings.accessKeyId || !settings.secretAccessKey || !settings.region || !settings.bucket) {
    log.warn(`[aws/s3] client disabled because AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION and/or AWS_S3_BUCKET is missing`)
    return cb()
  }

  client = new S3({
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey
    },
    region: settings.region
  })

  cb()
}

exports.putObject = (Key, Body, cb) => {
  cb = cb || function () {}

  if (!client) {
    return cb()
  }

  client.putObject({
    Bucket: settings.bucket,
    Key,
    Body
  }, cb)
}

exports.getSignedUrl = (Key, Expires, cb) => {
  cb = cb || function () {}

  if (!client) {
    return cb()
  }

  client.getSignedUrl('getObject', {
    Bucket: settings.bucket,
    Key,
    Expires
  }, cb)
}
