module.exports = (req, res, next) => {
  const params = {
    httpOnly: true,
    secure: true,
    sameSite: true
  }

  res.clearCookie('hash', params)
  res.location('/login')
  next()
}
