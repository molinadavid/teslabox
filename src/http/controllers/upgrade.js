const log = require('../../log')

const { exec } = require('child_process')
const path = require('path')

module.exports = (req, res, next) => {
  const command = `sh ${path.join(__dirname, '../../../upgrade.sh')}`

  log.debug(`[http] upgrading: ${command}`)
  exec(command, (err, stdout) => {
    if (err) {
      log.error(`[http] teslabox upgrade failed: ${err}`)
    } else {
      res.location('/')
      log.info(`[http] teslabox upgraded`)
    }

    next(err)
  })
}
