const log = require('../log')

const Dropbox = require('dropbox-v2-api')
const fs = require("fs")

const settings = {
  accessToken: process.env.DROPBOX_ACCESS_TOKEN,
  folder: process.env.DROPBOX_FOLDER
}

// let client

exports.start = (cb) => {
  cb = cb || function () {}

  if (!settings.accessToken || !settings.folder) {
    log.warn(`[dropbox] client disabled because DROPBOX_ACCESS_TOKEN and/or DROPBOX_FOLDER is missing`)
    return cb()
  }

  cb()
}

exports.putObject = (OutFile, Key, cb) => {
  cb = cb || function () {}

  const client = new Dropbox.authenticate({ token: settings.accessToken })

  if (!client) {
    return cb()
  }

  const stream = client({
    resource: 'files/upload',
    parameters: {
        path: `/${settings.folder}/${Key}`,
        mode: 'add',
        autorename: false,
        mute: false,
        strict_conflict: false
    }
  }, (err, result, response) => {
    if (!err) log.info(`[dropbox] Upload success`)
    cb(err)
  })

  fs.createReadStream(OutFile).pipe(stream)
}
