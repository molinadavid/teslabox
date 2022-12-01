const log = require('../../log')

const { exec } = require('child_process')
const path = require('path')

module.exports = (req, res, next) => {
  const command = `sh ${path.join(__dirname, '../../../upgrade.sh')}`

  log.debug(`[http] upgrading: ${command}`)
  exec(command, (err, stdout) => {
    if (!err) {
      log.info(`[http] teslabox upgraded`)
    }

    console.log(err, stdout)
    res.location('/')
    next(err)
  })
}
