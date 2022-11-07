const stream = require('../../queue/stream')

const _ = require('lodash')

module.exports = (req, res, next) => {
  const streams = stream.list()

  const locals = {
    streams
  }

  if (typeof req.query.json !== 'undefined') {
    res.locals.response = JSON.stringify(locals)
    return next()
  }

  res.render('stream', locals, (err, result) => {
    if (!err) {
      res.locals.response = result
    }

    next(err)
  })
}
