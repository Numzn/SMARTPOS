'use strict';

/**
 * Copies the built receipt engine into desktop/vendor/ so the packaged app does
 * not depend on npm workspaces or symlinks. The CJS build is self-contained
 * (no runtime requires), which is verified here.
 */
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '../../packages/receipt-engine/dist/index.cjs');
const destDir = path.resolve(__dirname, '../vendor/receipt-engine');

if (!fs.existsSync(src)) {
  console.error(
    'packages/receipt-engine/dist/index.cjs not found.\n' +
      'Build it first:  npm run build -w @smartpos/receipt-engine   (from the repository root)'
  );
  process.exit(1);
}

const code = fs.readFileSync(src, 'utf8');
if (/\brequire\(/.test(code)) {
  console.error('receipt-engine index.cjs now has runtime require() calls; vendoring it alone is no longer safe.');
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, 'index.cjs'));
console.log(`Vendored receipt engine -> ${path.relative(process.cwd(), destDir)}/index.cjs`);
