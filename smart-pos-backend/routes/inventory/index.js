const express = require('express');
const router = express.Router();

// Import subroutes
router.use('/', require('./core'));
router.use('/', require('./expiry'));
router.use('/', require('./adjustments'));

module.exports = router;
