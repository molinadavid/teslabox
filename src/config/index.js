const JSONdb = require('simple-json-db')
const path = require('path')

let db

exports.start = (cb) => {
  cb = cb || function () {}

  db = new JSONdb(path.join(__dirname, '../../config.json'))

  // for performance reasons, disable this feature on every run
  db.set('stream', false)

  cb()
}

exports.get = (key) => {
  return db.get(key)
}

exports.set = (key, value) => {
  return db.set(key, value)
}

exports.sync = () => {
  return db.sync()
}

exports.json = () => {
  return db.JSON()
}
