/**
 * migrate.js — SQLite Enterprise migration runner
 * Usage: node migrate.js [--db <path>] [--dry-run]
 * Requires Node.js >= 22 (node:sqlite built-in)
 */
"use strict";
const { DatabaseSync } = require("node:sqlite");
const fs   = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");
const DEFAULT_DB     = path.resolve(__dirname, "..", "..", "data", "phanmienoffline_enterprise.db");

function parseArgs() {
  const args = process.argv.slice(2);
  let dbPath = DEFAULT_DB, dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--db"       && args[i+1]) { dbPath = path.resolve(args[++i]); }
    if (args[i] === "--dry-run") { dryRun = true; }
  }
  return { dbPath, dryRun };
}

function getMigrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith(".sql"))
    .sort();
}

function getAppliedVersions(db) {
  try {
    return new Set(
      db.prepare("SELECT version FROM schema_migrations").all().map(r => r.version)
    );
  } catch (_) {
    return new Set();
  }
}

function applyMigration(db, file, dryRun) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
  // PRAGMA configuration must be applied before the transaction. A failure to
  // enable foreign keys is unsafe and must stop the migration.
  const pragmaLines  = sql.split("\n").filter(l => l.trim().toUpperCase().startsWith("PRAGMA"));
  const nonPragma    = sql.split("\n").filter(l => !l.trim().toUpperCase().startsWith("PRAGMA")).join("\n");

  if (dryRun) {
    console.log(`[DRY-RUN] Would apply: ${file}`);
    return;
  }

  // Áp dụng PRAGMA ngoài transaction
  for (const pLine of pragmaLines) {
    const stmt = pLine.replace(/;.*$/, "").trim();
    if (!stmt) continue;
    db.exec(stmt + ";");
    if (/^PRAGMA\s+foreign_keys\s*=\s*ON$/i.test(stmt)) {
      const enabled = db.prepare('PRAGMA foreign_keys').get()?.foreign_keys;
      if (Number(enabled) !== 1) throw new Error('Không thể bật PRAGMA foreign_keys');
    }
  }

  // Áp dụng phần còn lại trong transaction
  db.exec("BEGIN");
  try {
    db.exec(nonPragma);
    db.exec("COMMIT");
    console.log(`  ✓ Applied: ${file}`);
  } catch (err) {
    db.exec("ROLLBACK");
    throw new Error(`Migration ${file} failed: ${err.message}`);
  }
}

function main() {
  const { dbPath, dryRun } = parseArgs();

  // Tạo thư mục DB nếu chưa có
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  console.log(`\n SQLite Enterprise Migration Runner`);
  console.log(`  DB     : ${dbPath}`);
  console.log(`  DryRun : ${dryRun}`);
  console.log(`  Dir    : ${MIGRATIONS_DIR}\n`);

  const db = new DatabaseSync(dbPath);

  try {
    // Bootstrap schema_migrations nếu chưa tồn tại
    db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    );
    `);
    db.exec('PRAGMA foreign_keys = ON;');
    if (Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys) !== 1) {
      throw new Error('SQLite không thể bật foreign key enforcement');
    }

    const files   = getMigrationFiles();
    const applied = getAppliedVersions(db);

    let count = 0;
    for (const file of files) {
    // Lấy version từ prefix số (001, 002, ...)
      const version = file.split("_")[0];
      if (applied.has(version)) {
        console.log(`  - Skip : ${file} (already applied)`);
        continue;
      }
      applyMigration(db, file, dryRun);
      count++;
    }

    if (count === 0) {
    console.log("  Nothing to migrate — database is up to date.\n");
    } else {
    console.log(`\n  Done: ${count} migration(s) applied.\n`);
    }

    // Verify
    if (!dryRun) {
    console.log("  Running integrity checks...");
    const ic = db.prepare("PRAGMA integrity_check").all();
    const ok = ic.length === 1 && ic[0].integrity_check === "ok";
    console.log(`  integrity_check : ${ok ? "OK" : JSON.stringify(ic)}`);

    db.exec("PRAGMA foreign_keys = ON;");
    const fk = db.prepare("PRAGMA foreign_key_check").all();
      console.log(`  foreign_key_check: ${fk.length === 0 ? "OK (0 violations)" : JSON.stringify(fk)}`);
      if (!ok || fk.length > 0) throw new Error('Integrity hoặc foreign key check thất bại sau migration');

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    console.log(`  Tables created   : ${tables.map(r=>r.name).join(", ")}\n`);
    }
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
}
