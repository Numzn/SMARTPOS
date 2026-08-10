const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const auditService = require('../services/auditService');

const DEFAULT_BACKUP_DIR = path.join(__dirname, '..', 'backups');
const DEFAULT_RETENTION = 7;

function backupDir() {
  return process.env.BACKUP_DIR || DEFAULT_BACKUP_DIR;
}

function timestampedFilename() {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  return `smartpos-${iso}.sql.gz`;
}

/**
 * Runs `pg_dump` against DATABASE_URL, gzips the output, and prunes backups
 * beyond the retention count. Requires the `postgresql-client` package
 * (pg_dump) to be present on the host/image — the runtime Docker image
 * installs it for this reason.
 */
function runDatabaseBackup({ retention = DEFAULT_RETENTION, actor } = {}) {
  return new Promise((resolve, reject) => {
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      reject(new Error('DATABASE_URL is not set'));
      return;
    }

    const filename = timestampedFilename();
    const filePath = path.join(dir, filename);
    const startedAt = Date.now();

    const dump = execFile('pg_dump', ['--dbname', databaseUrl, '--no-owner', '--no-privileges'], {
      maxBuffer: 1024 * 1024 * 1024,
      encoding: 'buffer',
    });

    const zlib = require('zlib');
    const gzip = zlib.createGzip();
    const out = fs.createWriteStream(filePath);
    let stderr = '';
    dump.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    dump.stdout.pipe(gzip).pipe(out);

    dump.on('error', (err) => {
      reject(new Error(`pg_dump failed to start: ${err.message}`));
    });

    out.on('finish', () => {
      dump.once('close', (code) => {
        if (code !== 0) {
          fs.unlink(filePath, () => {});
          const message = `pg_dump exited with code ${code}: ${stderr.trim()}`;
          auditService.safeLog(auditService.eventTypes.BACKUP_CREATE, {
            userId: actor?.userId,
            userRole: actor?.userRole,
            entityType: 'BACKUP',
            action: 'BACKUP_CREATE',
            success: false,
            errorMessage: message,
            description: 'Database backup failed',
          });
          reject(new Error(message));
          return;
        }

        const { size } = fs.statSync(filePath);
        const durationMs = Date.now() - startedAt;
        const removed = pruneOldBackups(dir, retention);

        auditService.safeLog(auditService.eventTypes.BACKUP_CREATE, {
          userId: actor?.userId,
          userRole: actor?.userRole,
          entityType: 'BACKUP',
          action: 'BACKUP_CREATE',
          description: `Database backup created (${filename}, ${size} bytes, ${durationMs}ms)`,
          metadata: { filename, size, durationMs, removed },
        });

        resolve({ filename, filePath, size, durationMs, removed });
      });
    });

    out.on('error', (err) => reject(err));
  });
}

/** Keeps only the newest `retention` backups in `dir`, deleting the rest. */
function pruneOldBackups(dir, retention) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('smartpos-') && f.endsWith('.sql.gz'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const toRemove = files.slice(retention);
  for (const f of toRemove) {
    fs.unlinkSync(path.join(dir, f.name));
  }
  return toRemove.map((f) => f.name);
}

module.exports = { runDatabaseBackup, pruneOldBackups, backupDir };
