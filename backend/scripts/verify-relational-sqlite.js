const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDriver, run, all, close } = require('../src/db/relationalSqlite');
const { migrate } = require('../src/db/relationalMigrations');
const { createOrderTransaction } = require('../src/services/createOrderTransaction');

async function expectRejected(work, message) {
  let rejected = false;
  try { await work(); } catch (_) { rejected = true; }
  assert(rejected, message);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kha-relational-'));
  const file = path.join(dir, 'test.sqlite');
  const db = await openDriver(file);
  try {
    const first = await migrate(db);
    const second = await migrate(db);
    assert.strictEqual(first.integrity[0].integrity_check, 'ok');
    assert.strictEqual(second.foreignKeys.length, 0);
    await run(db, "INSERT INTO accounts(id,name,slug) VALUES(1,'A','a'),(2,'B','b')");
    await run(db, "INSERT INTO users(id,account_id,name) VALUES(1,1,'User A'),(2,2,'User B')");
    await run(db, "INSERT INTO customers(id,account_id,name) VALUES(1,1,'Customer A'),(2,2,'Customer B')");
    await run(db, "INSERT INTO products(id,account_id,sku,sku_normalized,name) VALUES(1,1,'123456','123456','Numeric'),(2,1,'MA-HANG-CU-01','MA-HANG-CU-01','Manual'),(3,1,'SP000435','SP000435','Generated'),(4,2,'B-1','B-1','Other account')");
    await run(db, "INSERT INTO warehouses(id,account_id,name,allow_negative_stock) VALUES(1,1,'Main',0)");
    await run(db, 'INSERT INTO inventory_balances(account_id,warehouse_id,product_id,quantity) VALUES(1,1,1,200),(1,1,2,200),(1,1,3,200)');
    await createOrderTransaction(db, { order_code: 'HD000001', idempotency_key: 'first-order', items: [
      { product_id: 1, sku: '123456', name: 'Numeric', quantity: 1, unit_price: 100, line_total: 100 },
      { product_id: 2, sku: 'MA-HANG-CU-01', name: 'Manual', quantity: 1, unit_price: 100, line_total: 100 },
      { product_id: 3, sku: 'SP000435', name: 'Generated', quantity: 1, unit_price: 100, line_total: 100 },
    ] }, { accountId: 1, warehouseId: 1, userId: 1 });
    const order = (await all(db, 'SELECT * FROM orders'))[0];
    assert.strictEqual(order.status, 'completed');
    assert.strictEqual(order.total_amount, 300);
    assert.strictEqual((await all(db, 'SELECT * FROM order_items')).length, 3);
    assert.strictEqual((await all(db, 'SELECT * FROM inventory_movements')).length, 3);
    await expectRejected(() => run(db, "INSERT INTO products(account_id,sku,sku_normalized,name) VALUES(1,'123456','123456','duplicate')"), 'SKU must be case-insensitively unique');
    await expectRejected(() => run(db, "INSERT INTO order_items(account_id,order_id,product_id,product_sku_snapshot,product_name_snapshot,quantity,unit_price,line_total) VALUES(2,1,4,'B-1','Other',1,1,1)"), 'Cross-account order item must fail');
    await expectRejected(() => run(db, 'UPDATE inventory_movements SET quantity_delta=1 WHERE id=1'), 'Inventory movements must be immutable');
    await expectRejected(() => run(db, "INSERT INTO orders(account_id,order_code,status,total_amount,paid_amount,remaining_amount) VALUES(1,'HD000002','completed',10,0,10)"), 'Completed order without item must be rejected by service');
    assert.strictEqual((await all(db, 'PRAGMA foreign_key_check')).length, 0);
    assert.strictEqual((await all(db, 'PRAGMA integrity_check'))[0].integrity_check, 'ok');
    console.log(JSON.stringify({ ok: true, database: file }));
  } finally {
    await close(db);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
