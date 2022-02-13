const stream = require('../../ram/stream')
const controllers = require('./')

const _ = require('lodash')

module.exports = (req, res, next) => {
  const streams = stream.list()

  const locals = {
    front: _.get(streams, 'front.created', false),
    back: _.get(streams, 'back.created', false),
    left: _.get(streams, 'left.created', false),
    right: _.get(streams, 'right.created', false)
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
