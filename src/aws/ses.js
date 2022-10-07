const log = require('../log')

const AWS = require('aws-sdk')

let client

const accessKeyId = process.env.AWS_ACCESS_KEY_ID
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
const region = process.env.AWS_DEFAULT_REGION

exports.start = (cb) => {
  cb = cb || function () {}

  log.debug('[aws/ses] started')

  if (!accessKeyId || !secretAccessKey || !region) {
    log.warn(`[aws/ses] email is disabled because AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and/or AWS_DEFAULT_REGION is missing`)
    return cb()
  }

  client = new AWS.SESV2({
    credentials: {
      accessKeyId,
      secretAccessKey
    },
    region
  })

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

  client.sendEmail(params, cb)
}
