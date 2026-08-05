const rateLimit = require('express-rate-limit');

/**
 * Login has no cost to an attacker today — this caps guesses per IP so
 * credential-stuffing/brute-force against a known email isn't unlimited.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.', code: 'RATE_LIMITED' },
});

module.exports = { loginLimiter };
