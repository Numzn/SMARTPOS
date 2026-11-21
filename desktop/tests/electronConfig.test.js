import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

/**
 * Source-level regression guards for the Electron security configuration.
 * These do not replace the real launch smoke test; they stop a risky flag from
 * being introduced unnoticed.
 */
describe('main process security configuration', () => {
  const main = read('main.js');

  it('creates the window with secure web preferences', () => {
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/sandbox:\s*true/);
    expect(main).toMatch(/webSecurity:\s*true/);
    expect(main).toMatch(/allowRunningInsecureContent:\s*false/);
  });

  it('never enables dangerous options anywhere in the main process code', () => {
    const files = ['main.js', 'preload.js', ...fs.readdirSync(path.join(root, 'services')).map((f) => `services/${f}`), ...fs.readdirSync(path.join(root, 'ipc')).map((f) => `ipc/${f}`)];
    const dangerous = [
      /nodeIntegration:\s*true/,
      /contextIsolation:\s*false/,
      /sandbox:\s*false/,
      /webSecurity:\s*false/,
      /allowRunningInsecureContent:\s*true/,
      /enableRemoteModule/,
      /nodeIntegrationInSubFrames:\s*true/,
      /\bwebviewTag:\s*true/,
      /bypassCSP:\s*true/,
      /\beval\(/,
      /new Function\(/,
      /require\(['"]child_process['"]\)/,
    ];
    for (const f of files) {
      const src = read(f);
      for (const re of dangerous) expect(`${f}: ${re.test(src)}`).toBe(`${f}: false`);
    }
  });

  it('forces the global sandbox on in packaged builds', () => {
    expect(main).toMatch(/if \(app\.isPackaged\) app\.enableSandbox\(\)/);
  });

  it('opens DevTools only in development', () => {
    expect(main).toMatch(/devTools:\s*isDev/);
  });

  it('blocks new windows, foreign navigation and webviews', () => {
    expect(main).toMatch(/setWindowOpenHandler/);
    expect(main).toMatch(/action:\s*'deny'/);
    expect(main).toMatch(/will-navigate/);
    expect(main).toMatch(/will-attach-webview/);
  });

  it('denies all permission prompts', () => {
    expect(main).toMatch(/setPermissionRequestHandler\(.*cb\(false\)/);
    expect(main).toMatch(/setPermissionCheckHandler\(\(\)\s*=>\s*false\)/);
  });

  it('only loads local bundled content in production, never a remote site', () => {
    const loads = [...main.matchAll(/loadURL\(([^)]*)\)/g)].map((m) => m[1]);
    for (const l of loads) expect(l).not.toMatch(/https?:\/\//);
  });
});

describe('packaging does not ship secrets or dev material', () => {
  const builder = read('electron-builder.yml');

  it('excludes env files, source maps and tests from the package', () => {
    expect(builder).toContain('"!**/.env*"');
    expect(builder).toContain('"!**/*.map"');
    expect(builder).toContain('"!**/*.test.js"');
  });

  it('never auto-publishes', () => {
    expect(builder).toMatch(/publish:\s*null/);
  });

  it('keeps user data on uninstall (config and logs survive upgrades)', () => {
    expect(builder).toMatch(/deleteAppDataOnUninstall:\s*false/);
  });

  it('contains no credentials or signing secrets in the shipped source', () => {
    const shipped = ['main.js', 'preload.js', 'electron-builder.yml', 'config/defaults.json', 'package.json'];
    const walk = (dir) =>
      fs.readdirSync(path.join(root, dir)).flatMap((f) => {
        const rel = `${dir}/${f}`;
        return fs.statSync(path.join(root, rel)).isDirectory() ? walk(rel) : [rel];
      });
    const all = [...shipped, ...walk('services'), ...walk('ipc'), ...walk('renderer'), ...walk('config')];
    const secretPatterns = [/CSC_KEY_PASSWORD\s*[:=]\s*\S+/, /JWT_SECRET\s*[:=]\s*\S+/, /VSDC_PASSWORD\s*[:=]\s*\S+/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /password\s*[:=]\s*['"][^'"]+['"]/i];
    for (const f of all) {
      const src = read(f);
      for (const re of secretPatterns) expect(`${f}: ${re.test(src)}`).toBe(`${f}: false`);
    }
  });

  it('ships no default server address (customers or ops must set one)', () => {
    const d = JSON.parse(read('config/defaults.json'));
    expect(d.backendUrl).toBe('');
    expect(d.updateUrl).toBe('');
  });
});
