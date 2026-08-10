/**
 * Runs a one-off database backup via pg_dump (see lib/backup.js), for cron
 * or manual invocation:
 *   node scripts/backup-database.js
 *   BACKUP_RETENTION=14 node scripts/backup-database.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { runDatabaseBackup } = require('../lib/backup');

const retention = parseInt(process.env.BACKUP_RETENTION || '7', 10);

runDatabaseBackup({ retention })
  .then(({ filename, size, durationMs, removed }) => {
    console.log(`Backup created: ${filename} (${size} bytes, ${durationMs}ms)`);
    if (removed.length) console.log(`Pruned ${removed.length} old backup(s): ${removed.join(', ')}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Backup failed:', err.message);
    process.exit(1);
  });
