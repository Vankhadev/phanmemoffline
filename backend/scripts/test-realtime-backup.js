const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phanmienoffline-realtime-backup-'));
process.env.KHA_DB_PATH = path.join(tempRoot, 'data', 'phanmienoffline.db.json');
process.env.KHA_DB_BACKUP_DIR = path.join(tempRoot, 'backups');
process.env.KHA_SQLITE = '0';
process.env.KHA_SKIP_OLD_DB_MIGRATION = '1';

const db = require('../src/db/database');
const realtimeBackup = require('../src/services/realtimeBackup');

try {
  realtimeBackup.initialize({ dataDir: tempRoot, dbModule: db });
  const productId = db.insert('products', { sku: 'SNAPSHOT-1', name: 'Realtime snapshot item', stock: 3, active: 1 });
  realtimeBackup.onDataChange('products', 'insert', productId);
  const snapshot = realtimeBackup.forceSnapshot();
  assert(snapshot?.path && fs.existsSync(snapshot.path), 'full realtime snapshot must be created');
  assert(fs.existsSync(`${snapshot.path}.manifest.json`), 'snapshot manifest must be created');
  const content = JSON.parse(fs.readFileSync(snapshot.path, 'utf8'));
  assert(Array.isArray(content.products), 'snapshot must include products');
  assert(Array.isArray(content.invoices), 'snapshot must include all database tables');
  assert.strictEqual(content._meta.snapshot_type, 'full_database_recovery_point');
  realtimeBackup.shutdown();
  console.log('PASS realtime full backup regression tests');
} finally {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (_) {}
}
