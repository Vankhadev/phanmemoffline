// =====================================================================
// sqliteEngine.js  |  Lop luu tru ben (durable) bang SQLite cho backend offline
// ---------------------------------------------------------------------
// Muc tieu:
//  - Chong mat du lieu khi cup dien  -> WAL + ghi tung dong (per-row), khong ghi de ca file.
//  - Chay on dinh o quy mo lon       -> moi collection 1 bang, index theo id + account_id.
//  - KHONG dap vo backend dang chay  -> giu nguyen mo hinh in-memory cho doc (getAll/getOne),
//                                        SQLite chi lam nguon luu tru ben phia sau (write-through).
//  - An toan & dao nguoc duoc        -> chi bat khi KHA_SQLITE=1; JSON van duoc giu lam snapshot.
//
// Mo hinh luu tru: document-store. Moi collection JSON -> 1 bang SQLite:
//   coll_<table>(id INTEGER PRIMARY KEY, account_id INTEGER, data TEXT, updated_at TEXT)
// Toan bo cot nghiep vu nam trong "data" (JSON). Cach nay phu hop voi 37 collection
// co shape khac nhau cua DB hien tai ma khong phai viet lai 2700 dong + 281 cho doc.
// =====================================================================
let DatabaseSync = null;
try { ({ DatabaseSync } = require("node:sqlite")); } catch (_) { /* Node < 22.5 */ }

let db = null;
let dbPath = null;
let txDepth = 0;

function isAvailable() { return !!DatabaseSync; }
function isOpen() { return !!db; }

function open(filePath) {
  if (!DatabaseSync) throw new Error("node:sqlite khong kha dung (can Node >= 22.5)");
  dbPath = filePath;
  db = new DatabaseSync(filePath);
  // PRAGMA an toan + hieu nang. FK=OFF vi day la document-store, toan ven do tang app dam bao.
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("PRAGMA temp_store = MEMORY;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA wal_autocheckpoint = 1000;");
  db.exec("CREATE TABLE IF NOT EXISTS kha_meta (k TEXT PRIMARY KEY, v TEXT);");
  return db;
}

function close() {
  if (db) { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch (_) {} db.close(); db = null; }
}

function safeName(table) {
  if (!/^[A-Za-z0-9_]+$/.test(String(table))) throw new Error("Ten bang khong hop le: " + table);
  return String(table);
}

const _ensured = new Set();
const _fieldIndexed = new Set();

function ensureFieldIndex(table, field) {
  if (!db) return;
  const t = safeName(table);
  if (!/^[A-Za-z0-9_]+$/.test(String(field))) throw new Error("Ten field khong hop le: " + field);
  const key = t + "." + field;
  if (_fieldIndexed.has(key)) return;
  ensureCollection(t);
  const idxName = "idx_coll_" + t + "_f_" + field;
  db.exec('CREATE INDEX IF NOT EXISTS "' + idxName + '" ON "coll_' + t + '"(json_extract(data, \'$.' + field + '\'));');
  _fieldIndexed.add(key);
}
function ensureCollection(table) {
  const t = safeName(table);
  if (_ensured.has(t)) return;
  db.exec('CREATE TABLE IF NOT EXISTS "coll_' + t + '" (id INTEGER PRIMARY KEY, account_id INTEGER, data TEXT NOT NULL, updated_at TEXT);');
  db.exec('CREATE INDEX IF NOT EXISTS "idx_coll_' + t + '_acct" ON "coll_' + t + '"(account_id);');
  _ensured.add(t);
}

function upsertRow(table, row) {
  if (!db || !row || row.id == null) return;
  const t = safeName(table);
  ensureCollection(t);
  const stmt = db.prepare('INSERT INTO "coll_' + t + '"(id, account_id, data, updated_at) VALUES (?,?,?,?)\n    ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id, data=excluded.data, updated_at=excluded.updated_at');
  stmt.run(Number(row.id), row.account_id != null ? Number(row.account_id) : null, JSON.stringify(row), row.updated_at || row.created_at || new Date().toISOString());
}

function deleteRow(table, id) {
  if (!db || id == null) return;
  const t = safeName(table);
  ensureCollection(t);
  db.prepare('DELETE FROM "coll_' + t + '" WHERE id = ?').run(Number(id));
}

function replaceCollection(table, rows) {
  if (!db) return;
  const t = safeName(table);
  ensureCollection(t);
  begin();
  try {
    db.exec('DELETE FROM "coll_' + t + '"');
    const list = Array.isArray(rows) ? rows : [];
    for (const r of list) { if (r && r.id != null) upsertRow(t, r); }
    commit();
  } catch (e) { rollback(); throw e; }
}

function setMeta(key, value) {
  if (!db) return;
  db.prepare("INSERT INTO kha_meta(k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(String(key), JSON.stringify(value));
}
function getMeta(key) {
  if (!db) return undefined;
  const r = db.prepare("SELECT v FROM kha_meta WHERE k = ?").get(String(key));
  if (!r) return undefined;
  try { return JSON.parse(r.v); } catch (_) { return undefined; }
}

function listCollections() {
  if (!db) return [];
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'coll_%'").all()
    .map(r => r.name.replace(/^coll_/, ""));
}

function loadCollection(table) {
  if (!db) return [];
  const t = safeName(table);
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get("coll_" + t);
  if (!exists) return [];
  const out = [];
  for (const r of db.prepare('SELECT data FROM "coll_' + t + '" ORDER BY id').all()) {
    try { out.push(JSON.parse(r.data)); } catch (_) {}
  }
  return out;
}

function countCollection(table) {
  if (!db) return 0;
  const t = safeName(table);
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get("coll_" + t);
  if (!exists) return 0;
  return db.prepare('SELECT COUNT(*) c FROM "coll_' + t + '"').get().c;
}

// --- Transaction long khop voi withAtomicDbWrite cua database.js ---
function begin() { if (!db) return; if (txDepth === 0) db.exec("BEGIN"); txDepth++; }
function commit() { if (!db) return; if (txDepth > 0) { txDepth--; if (txDepth === 0) db.exec("COMMIT"); } }
function rollback() { if (!db) return; if (txDepth > 0) { db.exec("ROLLBACK"); txDepth = 0; } }

function checkpoint() { if (db) { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch (_) {} } }

module.exports = {
  isAvailable, isOpen, open, close, ensureCollection,
  upsertRow, deleteRow, replaceCollection, replaceTable: replaceCollection, ensureFieldIndex,
  setMeta, getMeta, listCollections, loadCollection, countCollection,
  begin, commit, rollback, checkpoint,
  get path() { return dbPath; },
};
