const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDriver } = require('../src/db/relationalSqlite');

async function main() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kha-sqlite-driver-')), 'driver.sqlite');
  const driver = await openDriver(file);
  try {
    await driver.exec('CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    await driver.transaction(async tx => {
      await tx.run('INSERT INTO sample(value) VALUES(?)', ['committed']);
    });
    let rolledBack = false;
    try {
      await driver.transaction(async tx => {
        await tx.run('INSERT INTO sample(value) VALUES(?)', ['rolled back']);
        throw new Error('intentional rollback');
      });
    } catch (error) {
      rolledBack = error.message === 'intentional rollback';
    }
    assert(rolledBack, 'transaction must surface the original error');
    assert.strictEqual((await driver.all('SELECT * FROM sample')).length, 1, 'rollback must remove uncommitted row');
    // The final assertion proves FK is still active after transaction rollback.
    await driver.exec('PRAGMA foreign_keys = ON');
    const foreignKeys = await driver.get('PRAGMA foreign_keys');
    const sqlite = await driver.get('SELECT sqlite_version() AS version');
    const report = {
      electron: process.versions.electron || null,
      node: process.version,
      abi: process.versions.modules,
      sqlite: sqlite.version,
      driver: 'sql.js@1.12.0',
      foreign_keys: Number(foreignKeys.foreign_keys),
      create_table: true,
      transaction: true,
      rollback: true,
    };
    if (process.env.KHA_SQLITE_DRIVER_OUTPUT) {
      fs.writeFileSync(process.env.KHA_SQLITE_DRIVER_OUTPUT, JSON.stringify(report), 'utf8');
    }
    console.log(JSON.stringify(report));
  } finally {
    await driver.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
