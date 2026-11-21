const express = require('express');
const router = express.Router();

// Import subroutes
router.use('/', require('./attendants'));
router.use('/', require('./pumps'));
router.use('/', require('./transactions'));

module.exports = router;
