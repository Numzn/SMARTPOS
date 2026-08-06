/**
 * Minimal Express app for supertest-driven route tests — mounts just the
 * router under test with the same middleware wiring index.js uses, without
 * index.js's other side effects (app.listen, reconciliation timers, etc).
 */

const express = require('express');

function createTestApp(mountPath, router) {
  const app = express();
  app.use(express.json());
  app.use(mountPath, router);
  return app;
}

module.exports = { createTestApp };
