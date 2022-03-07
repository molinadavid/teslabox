const controllers = require('../controllers')

const express = require('express')
const router = express.Router()

router.get('/archive', controllers.archive)
router.get('/stream', controllers.stream)
router.all('/login', controllers.login)
router.get('/logout', controllers.logout)
router.get('/log', controllers.log)
router.all('/', controllers.home)

module.exports = router
