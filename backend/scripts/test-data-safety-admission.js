const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phanmienoffline-admission-'));
process.env.KHA_DB_PATH = path.join(tempRoot, 'phanmienoffline.db.json');
process.env.KHA_DB_BACKUP_DIR = path.join(tempRoot, 'backups');
process.env.KHA_GUARDIAN_LOCAL_CODE = 'internal-test-code-2026';
process.env.KHA_SQLITE = '0';
process.env.KHA_SKIP_OLD_DB_MIGRATION = '1';

const db = require('../src/db/database');
const admission = require('../src/services/dataSafetyAdmissionService');
const localRequest = { socket: { remoteAddress: '127.0.0.1' } };
const actor = { userId: 1, accountId: 1 };

try {
  db.insert('products', { sku: 'SAFE-RESTORE', name: 'Protected item', stock: 2, active: 1 });
  const backup = db.createVerifiedDataProtectionPoint('admission-test', { skipRetention: true });
  const approved = admission.inspectBackup(db, backup.path, actor);
  assert.strictEqual(approved.approved, true, 'verified backup must meet the 70 safety threshold');
  assert(approved.safetyScore >= admission.MINIMUM_SAFETY_SCORE);
  const challenge = admission.createChallenge(db, approved.id, localRequest, actor);
  const grant = admission.confirmChallenge(db, challenge.id, process.env.KHA_GUARDIAN_LOCAL_CODE, localRequest, actor);
  const consumed = admission.consumeGrant(db, approved.id, grant.id, actor);
  assert.strictEqual(consumed.backupPath, backup.path, 'single-use grant must bind to its approved artifact');
  assert.throws(() => admission.consumeGrant(db, approved.id, grant.id, actor), /không hợp lệ|hết hạn/i, 'grant must not be reusable');

  const unverified = path.join(db.DB_BACKUP_DIR, 'unverified.json');
  fs.writeFileSync(unverified, JSON.stringify({ products: [] }), 'utf8');
  const blocked = admission.inspectBackup(db, unverified, actor);
  assert.strictEqual(blocked.approved, false, 'backup without a verified manifest must be quarantined');
  assert(blocked.quarantineId, 'blocked backup must receive a quarantine record');
  console.log('PASS Data Guardian admission regression tests');
} finally {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (_) {}
}
