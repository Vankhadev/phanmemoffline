/*
 * Canonical SQLite driver for Electron 28. sql.js is pure-WASM so it loads
 * identically on Node 18 / Electron x64 or ia32 with zero native rebuild.
 * The driver auto-persists after every write operation so the database file
 * always reflects the latest committed state.
 *
 * NOTE: sql.js resets connection-level pragmas when another pragma changes.
 * That means `PRAGMA foreign_keys = ON` MUST be the last pragma executed at
 * startup; any subsequent PRAGMA (journal_mode, busy_timeout) will turn FK off
 * again. The driver re-enables FK after schema transactions for safety.
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

// ── Bind parameters without calling .bind(params) which may throw in sql.js ──
function bindAll(stmt, params = []) {
  if (params.length) stmt.bind(params);
  return stmt;
}

// ── sql.js API surface ──
class SqliteDriver {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.SQL = null;
    this.db = null;
    this.transactionDepth = 0;
  }

  async open() {
    if (this.db) return this;
    this.SQL = await initSqlJs({ locateFile: f => require.resolve(`sql.js/dist/${f}`) });
    const raw = fs.existsSync(this.filePath) ? fs.readFileSync(this.filePath) : null;
    this.db = raw?.length ? new this.SQL.Database(raw) : new this.SQL.Database();

    // ORDER MATTERS in sql.js: each PRAGMA can reset others.
    // We enable FK LAST and verify immediately.
    await this.exec('PRAGMA journal_mode = WAL');
    await this.exec('PRAGMA synchronous = FULL');
    await this.exec('PRAGMA busy_timeout = 5000');
    await this.exec('PRAGMA foreign_keys = ON');

    if (Number((await this.get('PRAGMA foreign_keys'))?.foreign_keys) !== 1) {
      await this.close();
      throw new Error('SQLite refused PRAGMA foreign_keys = ON');
    }
    return this;
  }

  ensureOpen() {
    if (!this.db) throw new Error('SQLite connection is not open');
  }

  /* Persists current db memory → disk atomically via rename. */
  persist() {
    const tmpPath = `${this.filePath}.${Date.now()}.tmp`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    try {
      fs.writeFileSync(tmpPath, Buffer.from(this.db.export()));
      fs.renameSync(tmpPath, this.filePath);
    } catch (e) {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      throw e;
    }
  }

  prepare(sql) { this.ensureOpen(); return this.db.prepare(sql); }

  run(sql, params = []) {
    const stmt = this.prepare(sql);
    try {
      bindAll(stmt, params);
      while (stmt.step()) {}
    } finally { stmt.free(); }
    const rows = this.db.exec('SELECT changes(), last_insert_rowid()');
    const ch = Number(rows[0]?.values[0][0] ?? 0);
    const id = Number(rows[0]?.values[0][1] ?? 0);
    if (!this.transactionDepth && !/^\s*(SELECT|PRAGMA)/i.test(sql)) {
      this.persist();
      // sql.js/export can clear this connection pragma. Restore it after the
      // write is persisted so direct repository writes retain FK checks.
      this.db.exec('PRAGMA foreign_keys = ON');
    }
    return { lastID: id, changes: ch };
  }

  rows(sql, params = []) {
    const stmt = this.prepare(sql);
    try {
      bindAll(stmt, params);
      const result = [];
      while (stmt.step()) result.push(stmt.getAsObject());
      return result;
    } finally { stmt.free(); }
  }

  get(sql, params = []) { return this.rows(sql, params)[0] || null; }
  all(sql, params = []) { return this.rows(sql, params); }

  exec(sql) {
    this.ensureOpen();
    this.db.exec(sql);
    if (!this.transactionDepth && !/^\s*(SELECT|PRAGMA)/i.test(sql)) this.persist();
  }

  async transaction(callback) {
    this.ensureOpen();
    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth += 1;
    try {
      const result = await callback(this);
      this.db.exec('COMMIT');
      this.transactionDepth -= 1;
      this.persist();
      // Re-enable FK after persist since sql.js/export can reset connection
      // pragmas. This must be the final operation after every transaction.
      this.db.exec('PRAGMA foreign_keys = ON');
      return result;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch (_) { err.rollbackError = err; }
      this.transactionDepth = Math.max(0, this.transactionDepth - 1);
      throw err;
    }
  }

  async backup(destination) {
    this.ensureOpen();
    this.db.exec('PRAGMA wal_checkpoint(FULL)');
    const tmp = `${path.resolve(destination)}.tmp`;
    try {
      fs.writeFileSync(tmp, Buffer.from(this.db.export()));
      fs.renameSync(tmp, path.resolve(destination));
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) {}
      throw e;
    }
  }

  async integrityCheck() { return this.all('PRAGMA integrity_check'); }
  async foreignKeyCheck() { return this.all('PRAGMA foreign_key_check'); }

  async close() {
    if (!this.db) return;
    this.persist();
    this.db.close();
    this.db = null;
    if (this.SQL) { this.SQL.HEAPU8 = null; this.SQL = null; }
  }
}

async function openDriver(filePath) { return new SqliteDriver(filePath).open(); }
function run(driver, sql, params) { return driver.run(sql, params); }
function get(driver, sql, params) { return driver.get(sql, params); }
function all(driver, sql, params) { return driver.all(sql, params); }
function exec(driver, sql) { return driver.exec(sql); }
function transaction(driver, callback) { return driver.transaction(callback); }
function close(driver) { return driver.close(); }

module.exports = { SqliteDriver, openDriver, run, get, all, exec, transaction, close };
