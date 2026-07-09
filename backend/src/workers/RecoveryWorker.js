/**
 * RecoveryWorker v2.3.9 - Khoi phuc du lieu chay trong worker thread rieng.
 * TUYET DOI KHONG chay tren main thread hoac renderer.
 */
"use strict";

const { parentPort } = require("worker_threads");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const crypto = require("crypto");

let DB_MODULE = null;
let cancelRequested = false;

const BACKUP_EXTENSIONS = [".json", ".db", ".sqlite", ".sqlite3", ".bak", ".backup", ".sql", ".zip", ".rar", ".7z", ".tar", ".gz", ".tar.gz"];
const ARCHIVE_EXTENSIONS = [".zip", ".rar", ".7z", ".tar", ".gz", ".tar.gz"];
const IMPORTANT_TABLES = ["invoices", "invoice_details", "products", "customers", "partners", "import_logs", "import_details"];

const TIMEOUT = {
  SCAN_DIR: 10000, READ_META: 5000, VERIFY_FILE: 30000,
  PROCESS_FILE: 120000, EXTRACT_ARCHIVE: 120000, IMPORT_BATCH: 30000,
  MAX_FILE_BYTES: 256 * 1024 * 1024, BATCH_SIZE_JSON: 150,
};

const PRIORITY_DIRS = new Set([
  "backup", "backups", "backup_du_lieu_phan_mem_no_del", "data", "database",
  "db", "restore", "phanmemoffline", "phanmienoffline", "pos", "sales",
  "app-data", "userdata", "user-data", "documents", "desktop", "downloads",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "$recycle.bin", "system volume information", "windows",
  "program files", "program files (x86)", "programdata", "temp", "tmp", "cache",
  "cache2", "cookies", ".cache", "i386", "amd64", "drivers", "driverstore",
  "winsxs", "assembly", "msocache", "recovery", "$windows.~bt", "$windows.~ws",
  "intel", "perflogs", "config.msi", "vendor", "dist", "build", "release",
]);

function hasValue(v) { return !(v === null || v === undefined || (typeof v === "string" && v.trim() === "")); }
function norm(v) { return String(v ?? "").trim().toLowerCase(); }
function money(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function safeClone(v) { return JSON.parse(JSON.stringify(v ?? {})); }
function hashObj(v) { try { return crypto.createHash("md5").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 16); } catch (_) { return String(v); } }
function yieldLoop() { return new Promise(r => setImmediate(r)); }
function isCandidate(f) { const l = String(f).toLowerCase(); return BACKUP_EXTENSIONS.some(e => l.endsWith(e)); }
function isArchive(f) { const l = String(f).toLowerCase(); return ARCHIVE_EXTENSIONS.some(e => l.endsWith(e)); }

class RealtimeLogger {
  constructor(fp) { this.fp = fp; this.s = null; }
  async _ens() { if (!this.s) { await fsp.mkdir(path.dirname(this.fp), { recursive: true }); this.s = fs.createWriteStream(this.fp, { flags: "a", encoding: "utf8" }); } }
  async add(m) { const ln = "[" + new Date().toLocaleString("vi-VN") + "] " + m + "\r\n"; try { await this._ens(); if (!this.s.write(ln)) await new Promise(r => this.s.once("drain", r)); } catch (_) {} }
  async close() { if (this.s) { await new Promise(r => { this.s.end(r); }); this.s = null; } }
}

function withTO(fn, ms, label, logger) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(async () => { const m = label + " timeout (" + ms + "ms)"; if (logger) await logger.add(m).catch(() => {}); reject(new Error(m)); }, ms);
    Promise.resolve().then(() => typeof fn === "function" ? fn() : fn).then(v => { clearTimeout(t); resolve(v); }).catch(e => { clearTimeout(t); reject(e); });
  });
}

function postProgress(d) { if (parentPort) parentPort.postMessage({ type: "progress", data: d }); }
function postResult(d) { if (parentPort) parentPort.postMessage({ type: "result", data: d }); }
function postError(e) { if (parentPort) parentPort.postMessage({ type: "error", data: { message: e.message, stack: e.stack } }); }

function listDrives() {
  if (process.platform !== "win32") return ["/"];
  const r = []; for (let c = 67; c <= 90; c++) { const d = String.fromCharCode(c) + ":\\"; try { if (fs.existsSync(d)) r.push(d); } catch (_) {} } return r;
}

async function walkDirs(rootDir, onFile, options, logger) {
  const maxFiles = Math.max(1, Number(options.maxFiles) || 100000);
  const maxDepth = Number.isFinite(Number(options.maxDepth)) ? Number(options.maxDepth) : 15;
  const deepScan = options.deepScan === true;
  const st = options.state || { count: 0, dirsScanned: 0 };
  if (st.count >= maxFiles || maxDepth < 0 || cancelRequested) return;
  let items;
  try { items = await withTO(() => fsp.readdir(rootDir, { withFileTypes: true }), TIMEOUT.SCAN_DIR, "readdir " + rootDir, logger); }
  catch (_) { if (logger) await logger.add("  Bo qua thu muc khong doc duoc: " + rootDir); return; }
  st.dirsScanned += 1;
  items.sort((a, b) => (PRIORITY_DIRS.has(b.name.toLowerCase()) ? 1 : 0) - (PRIORITY_DIRS.has(a.name.toLowerCase()) ? 1 : 0));
  if (st.dirsScanned % 100 === 0) { await yieldLoop(); postProgress({ phase: "scan", scanningDir: rootDir, dirsScanned: st.dirsScanned, filesFound: st.count }); }
  for (const item of items) {
    if (cancelRequested || st.count >= maxFiles) break;
    const full = path.join(rootDir, item.name);
    if (item.isDirectory()) {
      const n = item.name.toLowerCase();
      if (SKIP_DIRS.has(n) || n.startsWith("$") || n.startsWith(".")) continue;
      if (!deepScan && maxDepth < 10 && !PRIORITY_DIRS.has(n) && !n.includes("backup") && !n.includes("phan") && !n.includes("pos") && !n.includes("sales") && !n.includes("data") && !n.includes("database")) continue;
      await walkDirs(full, onFile, { ...options, maxDepth: maxDepth - 1, state: st, deepScan }, logger);
    } else if (item.isFile()) {
      st.count += 1;
      if (isCandidate(full)) {
        try {
          const stat = await withTO(() => fsp.stat(full), TIMEOUT.READ_META, "stat " + full, logger);
          if (stat.size > (options.maxFileBytes || TIMEOUT.MAX_FILE_BYTES)) { if (logger) await logger.add("  Bo qua file qua lon: " + full); continue; }
          onFile({ path: path.resolve(full), size: stat.size, mtimeMs: stat.mtimeMs, createdMs: stat.birthtimeMs });
        } catch (_) {}
      }
      if (st.count % 200 === 0) await yieldLoop();
    }
  }
}

async function scanOnly(options, logger) {
  const drives = options.roots || listDrives();
  const found = [];
  for (const drive of drives) {
    if (cancelRequested) break;
    if (logger) await logger.add("Bat dau quet o " + drive);
    postProgress({ phase: "scan", scanningDrive: drive, filesFound: found.length });
    const roots = options.deepScan ? [drive] : getPriorityRoots(drive);
    for (const root of roots) {
      if (cancelRequested) break;
      await walkDirs(root, f => found.push(f), {
        maxFiles: options.maxFiles || 50000,
        maxDepth: options.deepScan ? 20 : 6,
        deepScan: options.deepScan,
        maxFileBytes: options.maxFileBytes,
      }, logger);
      await yieldLoop();
    }
  }
  // deduplicate
  const seen = new Map();
  for (const f of found) { const k = path.resolve(f.path).toLowerCase(); if (!seen.has(k) || f.mtimeMs > seen.get(k).mtimeMs) seen.set(k, f); }
  return Array.from(seen.values());
}

function getPriorityRoots(drive) {
  const roots = [drive];
  const userProfile = os.homedir();
  const candidates = [
    path.join(drive, "backup_du_lieu_phan_mem_no_del"),
    path.join(drive, "backup"), path.join(drive, "backups"),
  ];
  if (userProfile) {
    candidates.push(
      path.join(userProfile, "Documents"), path.join(userProfile, "Desktop"),
      path.join(userProfile, "Downloads"),
      path.join(userProfile, "AppData", "Roaming", "ban-hang-offline"),
      path.join(userProfile, "AppData", "Roaming", "phanmienoffline"),
      path.join(userProfile, "AppData", "Roaming", "Ban hang offline - Van kha mmo"),
    );
  }
  for (const p of candidates) { const n = path.resolve(p); if (n && n.startsWith(drive) && !roots.includes(n)) roots.push(n); }
  return roots;
}

// ---- READ / NORMALIZE / MERGE ----
async function readBackupFile(fp, size, logger) {
  const l = fp.toLowerCase(); if (l.endsWith(".sql")) throw new Error("Chua ho tro SQL dump");
  let raw;
  if ((size || 0) > 50 * 1024 * 1024) raw = await readFileStream(fp);
  else raw = await fsp.readFile(fp);
  if (l.endsWith(".gz") || (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b)) {
    const txt = await new Promise((r, j) => zlib.gunzip(raw, (e, d) => e ? j(e) : r(d.toString("utf8"))));
    return JSON.parse(txt);
  }
  return JSON.parse(raw.toString("utf8"));
}
function readFileStream(fp) {
  return new Promise((r, j) => {
    const s = fs.createReadStream(fp, { highWaterMark: 64 * 1024 }); const c = []; let t = 0; const M = TIMEOUT.MAX_FILE_BYTES;
    s.on("data", d => { t += d.length; if (t > M) { s.destroy(); j(new Error("File qua lon")); return; } c.push(d); });
    s.on("end", () => r(Buffer.concat(c))); s.on("error", j);
  });
}

const ALIAS_TABLES = {
  orders: "invoices", invoices: "invoices", sales: "invoices", receipts: "invoices", bills: "invoices",
  order_items: "invoice_details", invoice_items: "invoice_details", invoice_details: "invoice_details", sales_items: "invoice_details", order_lines: "invoice_details",
  products: "products", items: "products", goods: "products",
  customers: "customers", clients: "customers", customer: "customers",
  suppliers: "partners", partners: "partners", vendors: "partners",
  imports: "import_logs", purchase_orders: "import_logs", import_logs: "import_logs", purchases: "import_logs",
  import_items: "import_details", purchase_items: "import_details", import_details: "import_details", purchase_lines: "import_details",
  payments: "cash_book", expenses: "cash_book", cashbook: "cash_book", cash_book: "cash_book",
  ledger: "accounting_transactions", accounting_transactions: "accounting_transactions",
  debts: "customer_debts", customer_debts: "customer_debts", supplier_debts: "supplier_debts",
  settings: "system_settings", system_settings: "system_settings", print_templates: "print_templates",
  users: "users", categories: "product_categories", product_categories: "product_categories",
  service_items: "invoice_details", other_services: "invoice_details",
  logs: "audit_logs", audit_logs: "audit_logs",
};

const FIELD_ALIASES = {
  invoices: { orderId: "id", invoiceId: "id", orderCode: "code", invoiceCode: "code", number: "code", customerName: "customer_name", customerPhone: "customer_phone", customerAddress: "customer_address", customerId: "customer_id", client_id: "customer_id", totalAmount: "total", grandTotal: "total", amount: "total", finalTotal: "total", subTotal: "subtotal", discountAmount: "discount", discountValue: "discount", paidAmount: "paid", remainingAmount: "remaining", changeAmount: "change", createdAt: "created_at", createdTime: "created_at", date: "created_at", orderDate: "created_at", time: "created_at", updatedAt: "updated_at", modifiedAt: "updated_at", statusName: "status", orderStatus: "status", invoiceStatus: "status", noteText: "note", description: "note", remark: "note", sellerId: "user_id", cashierId: "user_id", staffId: "user_id" },
  invoice_details: { itemId: "id", lineId: "id", invoiceId: "invoice_id", orderId: "invoice_id", orderCode: "invoice_id", productId: "product_id", sku: "product_sku", barcode: "product_barcode", productName: "product_name", name: "product_name", itemName: "product_name", title: "product_name", qty: "quantity", count: "quantity", unitPrice: "unit_price", pricePerUnit: "unit_price", sellPrice: "unit_price", salePrice: "sale_price_at_sale", lineTotal: "total", lineSubtotal: "total", amount: "total", capitalPrice: "cost", costPrice: "cost", importPrice: "cost", lineProfit: "profit", profitAmount: "profit" },
  products: { productCode: "code", code: "code", sku: "sku", barCode: "barcode", barcode: "barcode", productName: "name", title: "name", itemName: "name", salePrice: "price", price: "price", unitPrice: "price", importPrice: "cost", costPrice: "cost", capitalPrice: "cost", categoryName: "category", category: "category", catId: "category_id", inStock: "stock", qty: "stock", quantity: "stock", stockQty: "stock", createdAt: "created_at", createdTime: "created_at", date: "created_at", updatedAt: "updated_at", modifiedAt: "updated_at" },
  customers: { customerId: "id", name: "name", fullName: "name", customerName: "name", phone: "phone", tel: "phone", mobile: "phone", email: "email", mail: "email", address: "address", addr: "address", fullAddress: "address", createdAt: "created_at", createdTime: "created_at", date: "created_at", updatedAt: "updated_at", modifiedAt: "updated_at" },
  partners: { supplierId: "id", partnerId: "id", supplierName: "name", partnerName: "name", name: "name", phone: "phone", tel: "phone", email: "email", address: "address", createdAt: "created_at", date: "created_at", updatedAt: "updated_at" },
  import_logs: { importId: "id", importCode: "code", code: "code", number: "code", supplierId: "supplier_id", partnerId: "supplier_id", supplierName: "supplier_name", partnerName: "supplier_name", totalAmount: "total", grandTotal: "total", amount: "total", createdAt: "created_at", date: "created_at", importDate: "created_at", time: "created_at", updatedAt: "updated_at", modifiedAt: "updated_at" },
  import_details: { itemId: "id", lineId: "id", importId: "import_id", importCode: "import_id", productId: "product_id", productName: "product_name", name: "product_name", qty: "quantity", count: "quantity", unitPrice: "unit_price", price: "unit_price", cost: "cost", costPrice: "cost", lineTotal: "total", amount: "total" },
  print_templates: { id: "id", key: "key", name: "name", code: "code", content: "content", body: "content" },
};

function normalizeRow(table, row) { if (!row || typeof row !== "object") return row; const a = FIELD_ALIASES[table]; if (!a) return row; const o = {}; for (const [k, v] of Object.entries(row)) { const t = a[k] || k; if (!hasValue(o[t])) o[t] = v; } return o; }
function normalizeBackupData(data) { if (!data || typeof data !== "object") return null; const src = data.database ? data.database : data; const out = {}; for (const [k, t] of Object.entries(ALIAS_TABLES)) { if (Array.isArray(src[k])) { out[t] = out[t] || []; for (const r of src[k]) out[t].push(normalizeRow(t, r)); } } for (const t of Object.keys(DB_MODULE?.SCHEMA || {})) { if (Array.isArray(src[t])) { out[t] = out[t] || []; for (const r of src[t]) out[t].push(normalizeRow(t, r)); } } out.nextId = src.nextId || src.next_id || null; return Object.keys(out).some(k => Array.isArray(out[k]) && out[k].length) ? out : null; }

function pk(prefix, values, fallback) { const v = values.find(hasValue); return v == null ? fallback : prefix + ":" + String(v); }
function normalizeViKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+/g, '');
}
function productIdentityKey(row) {
  const r = row || {};
  if (hasValue(r.id)) return 'product:id:' + String(r.id);
  if (hasValue(r.sku)) return 'product:sku:' + normalizeViKey(r.sku);
  if (hasValue(r.barcode) && normalizeViKey(r.barcode) !== normalizeViKey(r.name)) return 'product:barcode:' + normalizeViKey(r.barcode);
  if (hasValue(r.code) && normalizeViKey(r.code) !== normalizeViKey(r.name)) return 'product:code:' + normalizeViKey(r.code);
  if (hasValue(r.productCode)) return 'product:product_code:' + normalizeViKey(r.productCode);
  return 'product:name:' + normalizeViKey(r.category) + '|' + normalizeViKey(r.name);
}
function productMatchKeys(row) {
  const r = row || {};
  const keys = [];
  if (hasValue(r.id)) keys.push('product:id:' + String(r.id));
  if (hasValue(r.sku)) keys.push('product:sku:' + normalizeViKey(r.sku));
  if (hasValue(r.barcode) && normalizeViKey(r.barcode) !== normalizeViKey(r.name)) keys.push('product:barcode:' + normalizeViKey(r.barcode));
  if (hasValue(r.code) && normalizeViKey(r.code) !== normalizeViKey(r.name)) keys.push('product:code:' + normalizeViKey(r.code));
  if (hasValue(r.productCode)) keys.push('product:product_code:' + normalizeViKey(r.productCode));
  if (hasValue(r.name)) {
    keys.push('product:name:' + normalizeViKey(r.category) + '|' + normalizeViKey(r.name));
    // name-only only when no codes
    if (!hasValue(r.sku) && !hasValue(r.barcode) && !hasValue(r.code) && !hasValue(r.productCode)) {
      keys.push('product:name_only:' + normalizeViKey(r.name));
    }
  }
  return keys;
}
function buildKey(table, row, index) { const r = row || {}; if (table === "invoices") return pk("order", [r.id, r.code], "orderhash:" + norm(r.created_at) + "|" + norm(r.customer_name) + "|" + norm(r.customer_phone) + "|" + money(r.total)); if (table === "invoice_details") return pk("item", [r.id], "itemhash:" + (r.invoice_id || "") + "|" + norm(r.product_name) + "|" + r.quantity + "|" + r.unit_price + "|" + r.total + "|" + index + "|" + hashObj(r)); if (table === "products") return productIdentityKey(r); if (table === "customers") return pk("customer", [r.id, r.phone, r.email], "customerhash:" + norm(r.name) + "|" + norm(r.address)); if (table === "partners") return pk("supplier", [r.id, r.phone, r.email, r.name], "supplierhash:" + hashObj(r)); if (table === "import_logs") return pk("import", [r.id, r.code], "importhash:" + (r.supplier_id || norm(r.supplier_name)) + "|" + norm(r.created_at) + "|" + money(r.total)); if (table === "import_details") return pk("importitem", [r.id], "importitemhash:" + (r.import_id || "") + "|" + norm(r.product_name) + "|" + r.quantity + "|" + r.unit_price + "|" + index + "|" + hashObj(r)); if (table === "print_templates") return pk("template", [r.id, r.key, r.name, r.code], "templatehash:" + hashObj(r)); return pk(table, [r.id, r.code, r.key, r.uuid], table + "hash:" + hashObj(r)); }

function mergeFields(existing, incoming, table) {
  const historical = new Set(["invoices", "invoice_details", "import_logs", "import_details"]);
  const moneyFields = new Set(["price", "cost", "unit_price", "sale_price_at_sale", "total", "subtotal", "discount", "profit", "capital_price"]);
  let changed = false;
  for (const [k, v] of Object.entries(incoming || {})) { if (!hasValue(v)) continue; if (!hasValue(existing[k])) { existing[k] = v; changed = true; continue; } if (historical.has(table) && moneyFields.has(k)) continue; const inT = Date.parse(incoming.updated_at || incoming.updatedAt || 0); const exT = Date.parse(existing.updated_at || existing.updatedAt || 0); if (inT && exT && inT > exT && JSON.stringify(existing[k]) !== JSON.stringify(v)) { existing[k] = v; changed = true; } }
  return changed;
}

// KHA FIX product multi-key merge
async function mergeDataset(current, incoming, report, logger, options) {
  const restored = report.restoredCounts; const skipped = report.skippedDuplicates;
  const bs = options.batchSize || TIMEOUT.BATCH_SIZE_JSON;
  for (const table of Object.keys(DB_MODULE?.SCHEMA || {})) {
    if (!Array.isArray(incoming[table])) continue; if (!Array.isArray(current[table])) current[table] = [];
    const index = new Map();
    const registerRow = (row, idx) => {
      if (table === 'products') {
        for (const k of productMatchKeys(row)) index.set(k, { row, idx });
      } else {
        index.set(buildKey(table, row, idx), { row, idx });
      }
    };
    current[table].forEach((row, i) => registerRow(row, i));
    const rows = incoming[table]; const totalBatches = Math.ceil(rows.length / bs);
    for (let bi = 0; bi < rows.length; bi += bs) {
      if (cancelRequested) { if (logger) await logger.add("Da huy o bang " + table + ", batch " + (Math.floor(bi / bs) + 1)); report.cancelled = true; return; }
      const batch = rows.slice(bi, bi + bs); const bn = Math.floor(bi / bs) + 1;
      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        if (!row || typeof row !== "object") continue;
        let ex = null;
        if (table === 'products') {
          const keys = productMatchKeys(row);
          for (const k of keys) {
            if (index.has(k)) { ex = index.get(k); break; }
          }
        } else {
          const key = buildKey(table, row, bi + j);
          ex = index.get(key);
        }
        if (ex) {
          const ch = mergeFields(ex.row, row, table);
          // products: do not sum stock on restore merge to avoid double counting historical snapshots
          if (ch) restored[table + "_merged"] = (restored[table + "_merged"] || 0) + 1;
          else skipped[table] = (skipped[table] || 0) + 1;
          if (table === 'products') registerRow(ex.row, ex.idx);
        } else {
          current[table].push(safeClone(row));
          const idx = current[table].length - 1;
          registerRow(current[table][idx], idx);
          restored[table] = (restored[table] || 0) + 1;
        }
      }
      await yieldLoop();
      postProgress({ phase: "merge", table, batch: bn, totalBatches, restored: { ...restored }, skipped: { ...skipped } });
      if (logger) await logger.add("  Merge " + table + ": batch " + bn + "/" + totalBatches + " | +" + (restored[table] || 0) + " moi, " + (skipped[table] || 0) + " trung");
    }
  }
}

// ---- EXTRACT ----
async function extractArchive(fp, tempRoot, logger) {
  const td = path.join(tempRoot, "extract-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
  await fsp.mkdir(td, { recursive: true });
  const sz = [process.env.KHA_7ZIP_PATH, "C:\\Program Files\\7-Zip\\7z.exe", "C:\\Program Files (x86)\\7-Zip\\7z.exe"].find(p => { try { return p && fs.existsSync(p); } catch (_) { return false; } });
  try {
    if (logger) await logger.add("Dang giai nen: " + fp);
    if (sz) { await execFileTO(sz, ["x", "-y", "-o" + td, fp], TIMEOUT.EXTRACT_ARCHIVE); }
    else if (fp.toLowerCase().endsWith(".zip")) { await execFileTO("powershell", ["-NoProfile", "-Command", "Expand-Archive -LiteralPath '" + fp.replace(/'/g, "''") + "' -DestinationPath '" + td.replace(/'/g, "''") + "' -Force"], TIMEOUT.EXTRACT_ARCHIVE); }
    else if (fp.toLowerCase().endsWith(".gz") && !fp.toLowerCase().endsWith(".tar.gz")) { const raw = await fsp.readFile(fp); const d = await new Promise((r, j) => zlib.gunzip(raw, (e, d) => e ? j(e) : r(d.toString("utf8")))); await fsp.writeFile(path.join(td, path.basename(fp).replace(/\.gz$/i, "")), d, "utf8"); }
    else { throw new Error("Khong co cong cu giai nen cho: " + fp); }
    const nested = []; await _walkExtracted(td, f => nested.push({ path: f.path, extractedFrom: fp, mtimeMs: f.mtimeMs, size: f.size }));
    return { tempDir: td, files: nested };
  } catch (e) {
    if (logger) await logger.add("Loi giai nen " + fp + ": " + e.message);
    try { await fsp.rm(td, { recursive: true, force: true }); } catch (_) {}
    throw e;
  }
}
function execFileTO(cmd, args, timeoutMs) { return new Promise((r, j) => { const { execFile } = require("child_process"); const c = execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (e, so, se) => { if (e) { if (e.killed) j(new Error("Timeout " + timeoutMs / 1000 + "s")); else j(new Error(se || e.message)); return; } r(); }); }); }
async function _walkExtracted(dir, onFile) { let items; try { items = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return; } for (const item of items) { const f = path.join(dir, item.name); if (item.isDirectory()) await _walkExtracted(f, onFile); else if (item.isFile()) { try { const st = await fsp.stat(f); onFile({ path: f, mtimeMs: st.mtimeMs, size: st.size }); } catch (_) {} } } }

function parseTimestampFromName(file) { const s = path.basename(file); const m = s.match(/(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)[T _-]?([0-2]\d)?[-_]?([0-5]\d)?[-_]?([0-5]\d)?/); if (!m) return null; const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)); return Number.isFinite(d.getTime()) ? d.getTime() : null; }
function sortBackups(files) { return files.sort((a, b) => (parseTimestampFromName(a.path) || a.createdMs || a.mtimeMs || 0) - (parseTimestampFromName(b.path) || b.createdMs || b.mtimeMs || 0)); }

// ---- VERIFY ----
async function verifyBackup(fp, size, logger) {
  try { const data = await withTO(() => readBackupFile(fp, size, logger), TIMEOUT.VERIFY_FILE, "verify " + fp, logger); const n = normalizeBackupData(data); if (!n) return { ok: false, reason: "Khong co du lieu phu hop" }; const counts = {}; for (const t of IMPORTANT_TABLES) counts[t] = Array.isArray(n[t]) ? n[t].length : 0; return { ok: true, counts, totalRecords: Object.values(counts).reduce((a, b) => a + b, 0) }; } catch (e) { return { ok: false, reason: e.message }; }
}

// ---- MAIN WORKER ----
parentPort.on("message", async (msg) => {
  try {
    switch (msg.type) {
      case "init": { DB_MODULE = msg.data; postResult({ ok: true, init: "Worker ready" }); break; }
      case "scan-request": {
        cancelRequested = false; const opts = msg.data || {}; const lp = opts.logPath || path.join(opts.tempDir || os.tmpdir(), "restore-log-" + Date.now().toString(36) + ".txt"); const logger = new RealtimeLogger(lp);
        try { await logger.add("========== BAT DAU QUET FILE BACKUP =========="); const files = await scanOnly(opts, logger); await logger.add("Quet xong: tim thay " + files.length + " file"); await logger.add("========== KET THUC QUET =========="); await logger.close(); postResult({ ok: true, files, logPath: lp }); }
        catch (e) { await logger.add("LOI QUET: " + e.message); await logger.close(); postError(e); }
        break;
      }
      case "verify-request": {
        cancelRequested = false; const fl = msg.data.files || []; const lp = msg.data.logPath || path.join(msg.data.tempDir || os.tmpdir(), "verify-log-" + Date.now().toString(36) + ".txt"); const logger = new RealtimeLogger(lp);
        try { await logger.add("========== BAT DAU KIEM TRA BACKUP =========="); const results = []; for (const f of fl) { if (cancelRequested) break; await logger.add("Kiem tra: " + f.path); const r = await verifyBackup(f.path, f.size, logger); results.push({ path: f.path, ...r, size: f.size, mtimeMs: f.mtimeMs }); postProgress({ phase: "verify", currentFile: f.path, verified: results.length, total: fl.length }); await yieldLoop(); } await logger.add("Kiem tra xong: " + results.filter(r => r.ok).length + "/" + results.length + " hop le"); await logger.add("========== KET THUC KIEM TRA =========="); await logger.close(); postResult({ ok: true, results, logPath: lp }); }
        catch (e) { await logger.add("LOI KIEM TRA: " + e.message); await logger.close(); postError(e); }
        break;
      }
      case "restore-request": {
        cancelRequested = false; const opts = msg.data || {}; const td = opts.tempDir || os.tmpdir(); const lp = opts.logPath || path.join(td, "restore-log-" + Date.now().toString(36) + ".txt"); const logger = new RealtimeLogger(lp);
        const report = { startedAt: new Date().toISOString(), finishedAt: null, backupFilesFound: [], archiveFilesExtracted: [], parsedFiles: [], failedFiles: [], restoredCounts: {}, skippedDuplicates: {}, warnings: [], errors: [], cancelled: false, checkpoint: null };
        try {
          await logger.add("========== BAT DAU KHOI PHUC DU LIEU (v2.3.9) ==========");
          let files = opts.files || [];
          if (files.length === 0) { await logger.add("Buoc 1: Quet file backup"); files = await scanOnly(opts, logger); }
          report.backupFilesFound = files.map(f => ({ path: f.path, size: f.size || null, mtimeMs: f.mtimeMs || null }));
          await logger.add("Tim thay " + files.length + " file backup.");
          await logger.add("Buoc 2: Giai nen file nen");
          postProgress({ phase: "extract", totalFiles: files.length });
          const pf = [];
          for (const f of files) { if (cancelRequested) break; if (isArchive(f.path)) { try { const r = await withTO(() => extractArchive(f.path, td, logger), TIMEOUT.EXTRACT_ARCHIVE, "extract " + f.path, logger); pf.push(...r.files); report.archiveFilesExtracted.push({ path: f.path, tempDir: r.tempDir }); } catch (e) { report.failedFiles.push({ path: f.path, error: e.message }); await logger.add("Loi giai nen " + f.path + " -> da bo qua"); } } else pf.push(f); }
          const dbPl = opts.dbPath ? path.resolve(opts.dbPath).toLowerCase() : "";
          const allFiles = sortBackups(pf.filter(f => { const p = path.resolve(f.path).toLowerCase(); return !(dbPl && p === dbPl); }));
          await logger.add("Sau loc & sap xep: " + allFiles.length + " file (cu -> moi)");
          await logger.add("Buoc 3: Parse va merge du lieu");
          postProgress({ phase: "snapshot", message: "Yeu cau snapshot" });
          const current = opts.currentDb || {}; let processed = 0;
          for (let i = 0; i < allFiles.length; i++) { if (cancelRequested) { await logger.add("Da nhan yeu cau huy"); report.cancelled = true; break; } const f = allFiles[i]; if (isArchive(f.path)) continue; processed++; const pct = allFiles.length ? Math.round(processed / allFiles.length * 100) : 100; postProgress({ phase: "process", file: f.path, fileName: path.basename(f.path), processed, total: allFiles.length, percent: pct, restored: { ...report.restoredCounts }, skipped: { ...report.skippedDuplicates } }); await logger.add("--- Xu ly file " + processed + "/" + allFiles.length + ": " + f.path + " ---"); try { const parsed = await withTO(() => readBackupFile(f.path, f.size, logger), TIMEOUT.PROCESS_FILE, "process " + f.path, logger); const normalized = normalizeBackupData(parsed); if (!normalized) { report.failedFiles.push({ path: f.path, error: "Khong co du lieu phu hop" }); await logger.add("  Bo qua"); continue; } const counts = {}; for (const t of IMPORTANT_TABLES) counts[t] = Array.isArray(normalized[t]) ? normalized[t].length : 0; report.parsedFiles.push({ path: f.path, counts }); await logger.add("  Du lieu hop le: " + JSON.stringify(counts)); await mergeDataset(current, normalized, report, logger, opts); } catch (e) { report.failedFiles.push({ path: f.path, error: e.message }); await logger.add("  LOI: " + e.message); } await yieldLoop(); }
          await logger.add("========== KET THUC KHOI PHUC =========="); report.finishedAt = new Date().toISOString(); await logger.close();
          postResult({ ok: !report.cancelled, report, current, logPath: lp, message: report.cancelled ? "Da huy an toan" : "Da xu ly " + report.parsedFiles.length + "/" + allFiles.length + " file. Khoi phuc " + (report.restoredCounts.invoices || 0) + " don, " + (report.restoredCounts.products || 0) + " sp, " + (report.restoredCounts.customers || 0) + " kh." });
        } catch (e) { report.errors.push(e.message); await logger.add("LOI NGHIEM TRONG: " + e.message); report.finishedAt = new Date().toISOString(); await logger.close(); postError(e); }
        break;
      }
      case "cancel-request": { cancelRequested = true; postResult({ ok: true, message: "Da yeu cau huy" }); break; }
      case "ping": { postResult({ ok: true, pong: true }); break; }
      case "shutdown": { cancelRequested = true; postResult({ ok: true, shutdown: true }); process.exit(0); break; }
    }
  } catch (e) { postError(e); }
});
if (parentPort) parentPort.postMessage({ type: "ready" });
