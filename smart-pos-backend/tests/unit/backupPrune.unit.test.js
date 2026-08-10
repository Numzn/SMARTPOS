import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { pruneOldBackups } = require('../../lib/backup');

describe('REGRESSION: backup retention keeps only the newest N dumps', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartpos-backup-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeBackup(name, ageMs) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, 'x');
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(p, t, t);
  }

  it('deletes everything past the retention count, oldest first', () => {
    makeBackup('smartpos-a.sql.gz', 5000);
    makeBackup('smartpos-b.sql.gz', 4000);
    makeBackup('smartpos-c.sql.gz', 3000);
    makeBackup('smartpos-d.sql.gz', 2000);
    makeBackup('smartpos-e.sql.gz', 1000);

    const removed = pruneOldBackups(dir, 3);

    expect(removed.sort()).toEqual(['smartpos-a.sql.gz', 'smartpos-b.sql.gz']);
    expect(fs.readdirSync(dir).sort()).toEqual([
      'smartpos-c.sql.gz',
      'smartpos-d.sql.gz',
      'smartpos-e.sql.gz',
    ]);
  });

  it('ignores files that are not backup dumps', () => {
    makeBackup('smartpos-a.sql.gz', 1000);
    fs.writeFileSync(path.join(dir, 'README.txt'), 'not a backup');

    const removed = pruneOldBackups(dir, 1);

    expect(removed).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'README.txt'))).toBe(true);
  });

  it('removes nothing when under the retention limit', () => {
    makeBackup('smartpos-a.sql.gz', 1000);
    const removed = pruneOldBackups(dir, 7);
    expect(removed).toEqual([]);
  });
});
