module.exports = (req, res, next) => {
  res.clearCookie('hash')
  res.location('/login')
  next()
}
