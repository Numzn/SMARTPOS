'use strict';

const path = require('path');

/**
 * Minimal rotating file logger. Never log request headers, bodies or tokens:
 * callers pass short, non-sensitive messages only. As a backstop, anything that
 * looks like a bearer token or JWT is masked before it reaches the disk.
 */
const MAX_BYTES = 2 * 1024 * 1024;

function redact(text) {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt-redacted]');
}

function createLogger({ dir, fs, console: out = console, now = () => new Date() }) {
  const file = path.join(dir, 'main.log');

  function write(level, message) {
    const line = `${now().toISOString()} ${level} ${redact(message)}\n`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      try {
        if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
      } catch {
        /* no log yet */
      }
      fs.appendFileSync(file, line, { mode: 0o600 });
    } catch {
      /* logging must never take the app down */
    }
    (level === 'ERROR' ? out.error : out.log)(line.trimEnd());
  }

  return {
    file,
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
  };
}

module.exports = { createLogger, redact };
