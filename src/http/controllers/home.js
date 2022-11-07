const config = require('../../config')
const controllers = require('./')
const usb = require('../../usb')
const package = require('../../../package.json')

const _ = require('lodash')

module.exports = (req, res, next) => {
  if (req.method === 'POST') {
    config.set('carName', req.body.carName)
    config.set('logLevel', req.body.logLevel)
    config.set('emailRecipients', req.body.emailRecipients)
    config.set('telegramRecipients', req.body.telegramRecipients)
    config.set('dashcam', req.body.dashcam === 'on')
    config.set('dashcamQuality', req.body.dashcamQuality)
    config.set('dashcamDuration', req.body.dashcamDuration)
    config.set('sentry', req.body.sentry === 'on')
    config.set('sentryEarlyWarning', req.body.sentryEarlyWarning === 'on')
    config.set('sentryQuality', req.body.sentryQuality)
    config.set('sentryDuration', req.body.sentryDuration)
    config.set('stream', req.body.stream === 'on')
    config.set('streamCopy', req.body.streamCopy === 'on')
    config.set('streamQuality', req.body.streamQuality)
    config.set('streamAngles', req.body.streamAngles)

    res.location('/')
    return next()
  }

  const logLevel = config.get('logLevel')
  const dashcamQuality = config.get('dashcamQuality')
  const sentryQuality = config.get('sentryQuality')
  const streamQuality = config.get('streamQuality')
  const streamAngles = config.get('streamAngles')

  const locals = {
    carName: config.get('carName'),
    logLevelDebug: logLevel === 'debug',
    logLevelInfo: logLevel === 'info',
    logLevelWarn: logLevel === 'warn',
    logLevelError: logLevel === 'error',
    logLevelFatal: logLevel === 'fatal',
    emailRecipients: config.get('emailRecipients').join(', '),
    telegramRecipients: config.get('telegramRecipients').join(', '),
    dashcam: config.get('dashcam'),
    dashcamQualityHighest: dashcamQuality === 'highest',
    dashcamQualityHigh: dashcamQuality === 'high',
    dashcamQualityMedium: dashcamQuality === 'medium',
    dashcamQualityLow: dashcamQuality === 'low',
    dashcamQualityLowest: dashcamQuality === 'lowest',
    dashcamDuration: config.get('dashcamDuration'),
    sentry: config.get('sentry'),
    sentryEarlyWarning: !!config.get('sentryEarlyWarning'),
    sentryQualityHighest: sentryQuality === 'highest',
    sentryQualityHigh: sentryQuality === 'high',
    sentryQualityMedium: sentryQuality === 'medium',
    sentryQualityLow: sentryQuality === 'low',
    sentryQualityLowest: sentryQuality === 'lowest',
    sentryDuration: config.get('sentryDuration'),
    stream: config.get('stream'),
    streamCopy: config.get('streamCopy'),
    streamQualityHighest: streamQuality === 'highest',
    streamQualityHigh: streamQuality === 'high',
    streamQualityMedium: streamQuality === 'medium',
    streamQualityLow: streamQuality === 'low',
    streamQualityLowest: streamQuality === 'lowest',
    streamAnglesFront: streamAngles.includes('front'),
    streamAnglesRight: streamAngles.includes('right'),
    streamAnglesBack: streamAngles.includes('back'),
    streamAnglesLeft: streamAngles.includes('left'),
    time: controllers.formatDate(),
    userIp: req.ip,
    userAgent: req.get('User-Agent'),
    version: package.version
  }

  usb.getSpace((err, space) => {
    if (!err && space) {
      space.isSuccess = space.status === 'success'
      space.class = space.status === 'danger' ? 'bg-danger' : space.status === 'warning' ? 'bg-warning text-black' : 'bg-success'
      locals.space = space
    }

    res.render('home', locals, (err, result) => {
      if (!err) {
        res.locals.response = result
      }

      next(err)
    })
  })
}
