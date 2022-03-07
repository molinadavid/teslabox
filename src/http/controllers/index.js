const log = require('../../log')

const _ = require('lodash')
const crypto = require('crypto')

const adminPassword = process.env.ADMIN_PASSWORD
const publicPassword = process.env.PUBLIC_PASSWORD

exports.home = require('./home')
exports.log = require('./log')
exports.archive = require('./archive')
exports.stream = require('./stream')
exports.login = require('./login')
exports.logout = require('./logout')

exports.formatAngle = (angle) => {
  return {
    front: 'up',
    back: 'down',
    left: 'left',
    right: 'right'
  }[angle]
}

exports.formatDate = (date) => {
  const dt = date ? new Date(date) : new Date()
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().substr(0, 19).replace('T', ' ')
}

exports.auth = (req, res, next) => {
  const ua = req.get('User-Agent')
  const adminHash = adminPassword && ua ? crypto.createHash('sha256').update(`${ua}:${adminPassword}`).digest('base64') : false
  const publicHash = publicPassword && ua ? crypto.createHash('sha256').update(`${ua}:${publicPassword}`).digest('base64') : false

  if (req.cookies.hash === adminHash) {
    res.locals.user = 'admin'
  } else if (req.cookies.hash === publicHash) {
    res.locals.user = 'public'
    if (!['/stream', '/stream?json'].includes(req.url) && !req.url.startsWith('/ram/stream')) {
      res.location('/stream')
    }
  } else if (!['/login', '/logout'].includes(req.url)) {
    res.status(401)
    res.location('/login')
  }

  next()
}

exports.response = (req, res, next) => {
  const location = res.get('location')

  if (location) {
    res.redirect(location)
  } else if (_.has(res.locals, 'response')) {
    res.send(res.locals.response).end()
  } else {
    return next({})
  }

  next()
}

exports.error = (err, req, res, next) => {
  if (_.isObject(err)) {
    log.error(`${req.method} ${req.url} failed: ${err.message}`)
    res.statusCode = 500
    res.locals.response = res.locals.response || 'Server Error. <a href="/">Try again?</a>'
  } else {
    log.warn(`${req.method} ${req.url} failed${err ? `: ${err}` : ''}`)
    res.statusCode = 400
    res.locals.response = res.locals.response || 'Client Error. <a href="/">Try again?</a>'
  }

  res.send(res.locals.response).end()
  next()
}
