'use strict';

/**
 * Builds the existing React app EXACTLY as the Docker web image does
 * (VITE_API_URL=/api, same-origin), into desktop/app-dist, and vendors the
 * receipt engine. No frontend source is forked or duplicated.
 *
 * Run from desktop/:  npm run build:renderer
 * Requires the repository's frontend dependencies (npm ci at the repo root).
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '../..');
const outDir = path.resolve(__dirname, '../app-dist');
const shell = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell, ...opts });
  if (r.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(r.status || 1);
  }
}

run('npm', ['run', 'build', '-w', '@smartpos/receipt-engine'], { cwd: root });
run('node', [path.join(__dirname, 'prepare-vendor.js')], { cwd: path.resolve(__dirname, '..') });

fs.rmSync(outDir, { recursive: true, force: true });
run('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
  cwd: path.join(root, 'smart-pos-frontend'),
  env: { ...process.env, VITE_API_URL: '/api' },
});

if (!fs.existsSync(path.join(outDir, 'index.html'))) {
  console.error('Renderer build did not produce index.html');
  process.exit(1);
}
console.log(`Renderer ready: ${outDir}`);
