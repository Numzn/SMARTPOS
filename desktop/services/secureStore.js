'use strict';

const path = require('path');
const { SECURE_STORE_KEYS, MAX_SECURE_VALUE_BYTES } = require('../config/constants');

/**
 * OS-backed secret storage (Electron `safeStorage`: DPAPI on Windows, Keychain
 * on macOS, libsecret/kwallet on Linux). Values are encrypted before they touch
 * disk.
 *
 * Deliberately NO plaintext fallback: if the OS cannot encrypt, set() fails and
 * the renderer keeps the token in memory only (the user signs in again next
 * launch). Silently writing a token in clear text would defeat the purpose.
 *
 * Only keys in SECURE_STORE_KEYS are accepted, so a compromised renderer cannot
 * use this as a general-purpose encrypted file store.
 */
function createSecureStore({ safeStorage, fs, dir }) {
  const file = path.join(dir, 'secure.json');

  function assertKey(key) {
    if (!SECURE_STORE_KEYS.includes(key)) throw new Error('Unknown secure storage key.');
  }

  function readAll() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeAll(obj) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function isAvailable() {
    try {
      return safeStorage.isEncryptionAvailable() === true;
    } catch {
      return false;
    }
  }

  function get(key) {
    assertKey(key);
    if (!isAvailable()) return null;
    const entry = readAll()[key];
    if (typeof entry !== 'string') return null;
    try {
      return safeStorage.decryptString(Buffer.from(entry, 'base64'));
    } catch {
      // Corrupt entry or profile moved to another OS account: forget it.
      remove(key);
      return null;
    }
  }

  function set(key, value) {
    assertKey(key);
    if (typeof value !== 'string' || value.length === 0) throw new Error('Value must be a non-empty string.');
    if (Buffer.byteLength(value, 'utf8') > MAX_SECURE_VALUE_BYTES) throw new Error('Value is too large.');
    if (!isAvailable()) throw new Error('Secure storage is not available on this computer.');
    const all = readAll();
    all[key] = safeStorage.encryptString(value).toString('base64');
    writeAll(all);
    return true;
  }

  function remove(key) {
    assertKey(key);
    const all = readAll();
    if (key in all) {
      delete all[key];
      writeAll(all);
    }
    return true;
  }

  return { get, set, delete: remove, isAvailable, file };
}

module.exports = { createSecureStore };
