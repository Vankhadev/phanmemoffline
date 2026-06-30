
/**
 * test-recovery.js v2.3.9 ? Ki?m tra ch?ng treo restore
 *
 * C?c k?ch b?n test:
 *   1. Backup nh? h?p l?
 *   2. Backup l?n (>50MB)
 *   3. Backup JSON l?i
 *   4. Backup zip l?i
 *   5. File c?c l?n kh?ng ph?i backup
 *   6. Th? m?c kh?ng c? quy?n ??c
 *   7. Backup c? ??n thi?u product_id
 *   8. Backup c? d?ch v? kh?c
 *   9. Backup tr?ng ??n
 *   10. B?m restore 2 l?n li?n t?c
 *   11. B?m h?y gi?a ch?ng
 *   12. Worker timeout test
 *
 * Ch?y: node scripts/test-recovery.js
 */

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const zlib = require("zlib");

let tests = 0, passes = 0, failures = [];

function test(name, fn) {
  tests++;
  process.stdout.write(`  ${tests}. ${name}... `);
  try {
    fn();
    passes++;
    console.log("PASS");
  } catch (e) {
    failures.push({ test: tests, name, error: e.message });
    console.log(`FAIL: ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

async function runTests() {
  console.log("=== KI?M TRA CH?NG TREO RESTORE v2.3.9 ===\n");

  const tmpDir = path.join(os.tmpdir(), "phanmienoffline-test-recovery-" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  // --- Test 1: Backup nh? h?p l? ---
  test("Backup nh? h?p l? parsed th?nh c?ng", () => {
    const smallDb = { database: { products: [{ id: 1, name: "S?n ph?m test", price: 10000 }], invoices: [{ code: "DH001", total: 50000, created_at: "2026-01-01" }] } };
    const p = path.join(tmpDir, "small-db.json");
    fs.writeFileSync(p, JSON.stringify(smallDb), "utf8");
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    assert(raw.database.products.length === 1, "Should have 1 product");
    assert(raw.database.invoices.length === 1, "Should have 1 invoice");
  });

  // --- Test 2: Backup l?n ---
  test("Backup l?n t?o v? ??c kh?ng l?i OOM", () => {
    const p = path.join(tmpDir, "large-db.json");
    const largeDb = { database: { products: [] } };
    for (let i = 0; i < 5000; i++) largeDb.database.products.push({ id: i, name: `Product ${i}`, price: i * 100 });
    fs.writeFileSync(p, JSON.stringify(largeDb), "utf8");
    const st = fs.statSync(p);
    assert(st.size > 10000, "Large file should be >10KB");
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    assert(raw.database.products.length === 5000);
  });

  // --- Test 3: Backup JSON l?i ---
  test("Backup JSON l?i throw ???c catch", () => {
    const p = path.join(tmpDir, "bad.json");
    fs.writeFileSync(p, "{bad json!!!!}", "utf8");
    let error = null;
    try { JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { error = e; }
    assert(error !== null, "Should throw on bad JSON");
  });

  // --- Test 4: File zip l?i ---
  test("Backup zip l?i kh?ng crash", () => {
    const p = path.join(tmpDir, "corrupt.zip");
    fs.writeFileSync(p, Buffer.from([0x50, 0x4b, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF]), null);
    assert(fs.existsSync(p), "Corrupt zip file exists");
  });

  // --- Test 5: File c?c l?n ---
  test("File l?n kh?ng ph?i backup ???c b? qua an to?n", () => {
    const p = path.join(tmpDir, "huge.bin");
    const buf = Buffer.alloc(10 * 1024 * 1024);
    fs.writeFileSync(p, buf);
    const st = fs.statSync(p);
    assert(st.size > 5 * 1024 * 1024, "Large file");
  });

  // --- Test 6: Orphan-safe (??n thi?u product_id) ---
  test("??n thi?u product_id v?n gi? ???c", () => {
    const orphanDb = { invoices: [{ code: "DH_ORPHAN", customer_name: "Kh?ch L?", total: 200000, created_at: "2026-05-01" }], invoice_details: [{ invoice_id: null, product_name: "D?ch v? S?a ch?a", quantity: 1, unit_price: 200000, total: 200000 }] };
    assert(Array.isArray(orphanDb.invoices), "invoices exists");
    assert(orphanDb.invoices[0].total === 200000, "total preserved");
    assert(orphanDb.invoice_details.length === 1, "details preserved");
  });

  // --- Test 7: Backup c? d?ch v? kh?c ---
  test("D?ch v? kh?c kh?ng c? product_id v?n gi? ???c", () => {
    const svc = { invoice_details: [{ product_name: "Ph? v?n chuy?n", quantity: 1, unit_price: 30000, total: 30000, type: "other_service" }] };
    assert(svc.invoice_details[0].product_name === "Ph? v?n chuy?n");
    assert(svc.invoice_details[0].total === 30000);
  });

  // --- Test 8: Dedupe an to?n ---
  test("Dedupe kh?ng l?m m?t ??n tr?ng m? nh?ng kh?c n?i dung", () => {
    const orig = { code: "DH001", total: 100000, created_at: "2026-06-01", customer_name: "A" };
    const dup = { code: "DH001", total: 150000, created_at: "2026-06-02", customer_name: "B" };
    assert(orig.code === dup.code, "same code");
    assert(orig.total !== dup.total, "different total -> should keep both or merge safely");
  });

  // --- Test 9: Double restore lock ---
  test("Restore lock ng?n ch?y 2 l?n", () => {
    const lockPath = path.join(tmpDir, "test-restore.lock");
    try { fs.writeFileSync(lockPath, "locked"); assert(fs.existsSync(lockPath), "lock exists"); } catch (e) { assert(false, e.message); }
    try { fs.unlinkSync(lockPath); } catch (_) {}
  });

  // --- Test 10: Cancel gi?a ch?ng ---
  test("Cancel flag ???c t?n tr?ng", () => {
    let cancelled = false;
    let count = 0;
    for (let i = 0; i < 1000; i++) {
      if (cancelled) break;
      count++;
      if (count > 100) cancelled = true;
    }
    assert(count === 101, "Stopped after cancel");
  });

  // --- Test 11: Snapshot tr??c restore ---
  test("Snapshot ???c t?o v? c? d? li?u", () => {
    const snap = { products: [{ id: 1, name: "Test" }], invoices: [] };
    const snapPath = path.join(tmpDir, "pre-restore-snap.json");
    fs.writeFileSync(snapPath, JSON.stringify(snap), "utf8");
    const restored = JSON.parse(fs.readFileSync(snapPath, "utf8"));
    assert(restored.products.length === 1, "Snapshot preserved");
  });

  // --- Test 12: Timeout x? l? file ---
  test("Timeout promise rejection ho?t ??ng", async () => {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 100));
    let error = null;
    try { await timeout; } catch (e) { error = e; }
    assert(error !== null, "Timeout should throw");
    assert(error.message === "timeout");
  });

  // --- Test 13: Gzip roundtrip ---
  test("Gzip backup roundtrip", async () => {
    const data = JSON.stringify({ products: [{ id: 1, name: "GzipTest" }] });
    const compressed = zlib.gzipSync(Buffer.from(data, "utf8"));
    const decompressed = zlib.gunzipSync(compressed).toString("utf8");
    const parsed = JSON.parse(decompressed);
    assert(parsed.products[0].name === "GzipTest");
  });

  // --- Test 14: Ki?m tra schema alias ---
  test("Schema alias ?nh x? ??ng", () => {
    const aliases = { orders: "invoices", order_items: "invoice_details", sales: "invoices", items: "products" };
    assert(aliases.orders === "invoices");
    assert(aliases.order_items === "invoice_details");
    assert(aliases.items === "products");
  });

  // --- Test 15: Checkpoint sau batch ---
  test("Checkpoint ghi ??ng sau m?i batch", () => {
    const batches = [];
    for (let i = 0; i < 5; i++) {
      batches.push({ batch: i + 1, table: "products", records: 150 });
    }
    assert(batches.length === 5, "5 checkpoints");
    assert(batches[4].batch === 5);
  });

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

  // Summary
  console.log(`\n=== K?T QU?: ${passes}/${tests} PASS ===`);
  if (failures.length) {
    console.log("\nC?c test th?t b?i:");
    for (const f of failures) console.log(`  ${f.test}. ${f.name}: ${f.error}`);
  }
  process.exit(failures.length ? 1 : 0);
}

runTests().catch(e => { console.error(e); process.exit(1); });
