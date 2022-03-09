const crypto = require('crypto')

module.exports = (req, res, next) => {
  if (req.method === 'POST') {
    const expires = req.body.remember ? new Date(Date.now() + 30 * 86400 * 1000) : 0
    const value = crypto.createHash('sha256').update(`${req.get('User-Agent')}:${req.body.password}`).digest('base64')
    res.cookie('hash', value, { expires })
    res.location('/')
    return next()
  }

  res.render('login', {}, (err, result) => {
    if (!err) {
      res.locals.response = result
    }

    next(err)
  })
}
