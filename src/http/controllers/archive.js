const archive = require('../../queue/archive')
const controllers = require('./')

const _ = require('lodash')

module.exports = (req, res, next) => {
  const archives = _.reverse(_.map(archive.list(), (row) => {
    return {
      created: controllers.formatDate(row.created),
      lat: row.lat,
      lon: row.lon,
      url: row.url,
      type: row.type,
      processed: controllers.formatDate(row.processed),
      taken: row.taken
    }
  }))

  const locals = {
    archives,
    hasArchives: !!archives.length
  }

  res.render('archive', locals, (err, result) => {
    if (!err) {
      res.locals.response = result
    }

    next(err)
  })
}
