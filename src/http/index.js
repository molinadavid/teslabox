const controllers = require('./controllers')

const compression = require('compression')
const express = require('express')
const http = require('http')
const path = require('path')

const settings = {
  timeout: 60000,
  port: process.env.ADMIN_PORT ? Number(process.env.ADMIN_PORT) : 80,
  ramDir: process.env.NODE_ENV === 'production' ? '/mnt/ram' : path.join(__dirname, '../../mnt/ram')
}

let server

exports.start = (cb) => {
  cb = cb || function () {}

  const app = express()
  app.disable('x-powered-by')
  app.disable('etag')
  app.enable('case sensitive routing')
  app.enable('strict routing')
  app.set('trust proxy', 1)
  app.set('views', path.join(__dirname, './views'))
  app.set('view engine', 'hjs')
  app.use(express.urlencoded({ extended: true }))
  app.use(compression({ threshold: 100 }))

  const assetsDir = path.join(__dirname, '../assets')
  const staticParams = {
    fallthrough: true,
    lastModified: true,
    etag: false
  }

  app.use('/ram/', express.static(settings.ramDir, staticParams))
  app.get('/archive', controllers.archive)
  app.get('/stream', controllers.stream)
  app.get('/log', controllers.log)
  app.use('/', express.static(assetsDir, staticParams))
  app.all('/', controllers.home)
  app.use(controllers.response)
  app.use(controllers.error)

  server = http.createServer(app)
  server.timeout = settings.timeout
  server.keepAliveTimeout = settings.timeout
  server.listen(settings.port, '0.0.0.0', cb)
}

exports.end = (cb) => {
  cb = cb || function () {}

  server.close(() => cb())
}
