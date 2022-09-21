const controllers = require('./controllers')
const routes = require('./routes')

const compression = require('compression')
const express = require('express')
const favicon = require('serve-favicon')
const cookieParser = require('cookie-parser')
const http = require('http')
const path = require('path')

const timeout = 60

let server

const adminPort = process.env.ADMIN_PORT ? parseInt(process.env.ADMIN_PORT, 10) : 80
const adminPassword = process.env.ADMIN_PASSWORD

exports.start = (cb) => {
  cb = cb || function () {}

  if (!adminPassword) {
    return cb()
  }

  const app = express()

  app.disable('x-powered-by')
  app.disable('etag')
  app.enable('case sensitive routing')
  app.enable('strict routing')
  app.set('trust proxy', 1)

  app.use(compression({
    threshold: 100
  }))

  const isProduction = process.env.NODE_ENV === 'production'
  const assetsDir = path.join(__dirname, '../assets')
  const ramDir = isProduction ? '/mnt/ram' : path.join(__dirname, '../../mnt/ram')

  app.use(favicon(path.join(assetsDir, 'favicon.ico')))

  const params = {
    fallthrough: false,
    lastModified: true,
    etag: true
  }

  app.use('/assets/', express.static(assetsDir, params))

  app.use(cookieParser(null, {
    httpOnly: true,
    sameSite: true
  }))

  app.use(controllers.auth)
  app.use('/ram/', express.static(ramDir, params))

  app.set('views', path.join(__dirname, './views'))
  app.set('view engine', 'hjs')
  app.use(express.urlencoded({ extended: true }))

  app.use(routes)
  app.use(controllers.response)
  app.use(controllers.error)

  server = http.createServer(app)
  server.timeout = timeout
  server.keepAliveTimeout = timeout
  server.listen(adminPort, '0.0.0.0', cb)
}

exports.end = (cb) => {
  cb = cb || function () {}

  server.close(() => cb())
}
