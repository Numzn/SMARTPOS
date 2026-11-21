'use strict';

/**
 * Development launcher: starts the Vite dev server (hot module replacement) and
 * Electron pointed at it. In dev the renderer calls the backend directly via the
 * frontend's own VITE_API_URL (default http://localhost:4000), the same as the
 * browser dev flow, so start the backend first (`npm run backend` at the repo root).
 *
 * Run from desktop/:  npm run dev
 */
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const shell = process.platform === 'win32';
const devUrl = process.env.NUMZ_DEV_URL || 'http://localhost:5173';
const { port } = new URL(devUrl);

function waitForPort(p, timeoutMs = 60_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    (function attempt() {
      const s = net.connect(Number(p), '127.0.0.1');
      s.once('connect', () => {
        s.destroy();
        resolve();
      });
      s.once('error', () => {
        s.destroy();
        if (Date.now() - started > timeoutMs) reject(new Error(`Vite did not start on port ${p}`));
        else setTimeout(attempt, 500);
      });
    })();
  });
}

const vite = spawn('npm', ['run', 'dev', '--', '--port', String(port), '--strictPort'], {
  cwd: path.join(root, 'smart-pos-frontend'),
  stdio: 'inherit',
  shell,
});

let electron = null;
function shutdown(code = 0) {
  if (electron && !electron.killed) electron.kill();
  if (!vite.killed) vite.kill();
  process.exit(code);
}
vite.on('exit', (c) => shutdown(c || 0));
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

waitForPort(port)
  .then(() => {
    console.log(`[desktop] Vite is up, launching Electron against ${devUrl}`);
    electron = spawn(path.join(__dirname, '../node_modules/.bin/electron' + (shell ? '.cmd' : '')), ['.'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      shell,
      env: { ...process.env, NUMZ_DESKTOP_DEV: '1', NUMZ_DEV_URL: devUrl },
    });
    electron.on('exit', (c) => shutdown(c || 0));
  })
  .catch((e) => {
    console.error(e.message);
    shutdown(1);
  });
