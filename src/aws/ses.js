const log = require('../log')

const AWS = require('aws-sdk')

const settings = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_DEFAULT_REGION
}

let client

const connect = () => {
  return new AWS.SESV2({
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey
    },
    region: settings.region
  })
}

exports.start = (cb) => {
  cb = cb || function () {}

  if (!settings.accessKeyId || !settings.secretAccessKey || !settings.region) {
    log.warn(`[aws/ses] client disabled because AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and/or AWS_DEFAULT_REGION is missing`)
    return cb()
  }

  client = connect()
  cb()
}

exports.sendEmail = (ToAddresses, subject, text, html, cb) => {
  cb = cb || function () {}

  if (!client) {
    return cb()
  }

  const params = {
    FromEmailAddress: ToAddresses[0],
    Destination: {
      ToAddresses
    },
    Content: {
      Simple: {
        Body: {}
      }
    }
  }

  if (subject) {
    params.Content.Simple.Subject = {
      Charset: 'UTF-8',
      Data: subject
    }
  }

  if (text) {
    params.Content.Simple.Body.Text = {
      Charset: 'UTF-8',
      Data: text
    }
  }

  if (html) {
    params.Content.Simple.Body.Html = {
      Charset: 'UTF-8',
      Data: html
    }
  }

  client.sendEmail(params, (err) => {
    if (err) {
      client = connect()
    }

    cb(err)
  })
}
