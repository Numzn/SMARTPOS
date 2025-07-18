const express = require('express');
const router = express.Router();

// Import subroutes
router.use('/', require('./core'));
router.use('/', require('./expiry'));
// Add more subroutes as you split further (e.g., movements, settings, batches)

module.exports = router;
