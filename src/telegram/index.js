const log = require('../log')

const _ = require('lodash')
const async = require('async')
const { TelegramClient } = require('messaging-api-telegram')
const p2c = require('promise-to-callback')

const settings = {
  accessToken: process.env.TELEGRAM_ACCESS_TOKEN
}

let client

exports.start = (cb) => {
  cb = cb || function () {}

  if (!settings.accessToken) {
    log.warn('[telegram] disabled because TELEGRAM_ACCESS_TOKEN is missing')
    return cb()
  }

  client = new TelegramClient({
    accessToken: settings.accessToken
  })

  cb()
}

exports.sendMessage = (recipients, text, cb) => {
  cb = cb || function () {}

  if (!client) {
    return cb()
  }

  const params = {
    parse_mode: 'Markdown'
  }

  async.each(recipients, (recipient, cb) => {
    p2c(client.sendMessage(recipient, text, params))(cb)
  }, cb)
}

exports.sendAnimation = (recipients, animationUrl, caption, cb) => {
  cb = cb || function () {}

  if (!client) {
    return cb()
  }

  const params = {
    caption,
    parse_mode: 'Markdown'
  }

  async.each(recipients, (recipient, cb) => {
    p2c(client.sendAnimation(recipient, animationUrl, params))(cb)
  }, cb)
}

exports.sendVideo = (recipients, videoUrl, caption, cb) => {
  cb = cb || function () {}

  if (!client) {
    return cb()
  }

  const params = {
    caption,
    supports_streaming: true,
    parse_mode: 'Markdown'
  }

  async.each(recipients, (recipient, cb) => {
    p2c(client.sendVideo(recipient, videoUrl, params))(cb)
  }, cb)
}
