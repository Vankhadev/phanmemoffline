const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveDbPath() {
  // 1) Doc config.json cua backend
  const configPath = path.join(ROOT, 'backend', 'data', 'config.json');
  let configDbPath = null;
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg && cfg.database_path) configDbPath = path.resolve(cfg.database_path);
    } catch (_) {}
  }

  // 2) Env (Electron production)
  const envDbPath = process.env.KHA_DB_PATH || process.env.DB_PATH || process.env.DATABASE_PATH || null;

  // 3) Default project
  const defaultDbPath = path.join(ROOT, 'backend', 'data', 'phanmienoffline.db.json');

  // 4) Quet cac file nghi ngo
  const candidates = [];
  const pushCandidate = (label, p) => {
    if (!p) return;
    try {
      if (!fs.existsSync(p)) return;
      const stat = fs.statSync(p);
      if (!stat.isFile() || stat.size < 100) return;
      candidates.push({ label, path: path.resolve(p), size: stat.size, mtimeMs: stat.mtimeMs });
    } catch (_) {}
  };
  pushCandidate('config.database_path', configDbPath);
  pushCandidate('env KHA_DB_PATH', envDbPath);
  pushCandidate('default project db', defaultDbPath);

  // Chi quet thu muc backend/data nhe, KHONG quet lan sang backup o E:\ de tranh treo.
  const scanDir = path.join(ROOT, 'backend', 'data');
  try {
    const entries = fs.readdirSync(scanDir);
    for (const name of entries) {
      if (/database\.json$/i.test(name)) {
        pushCandidate('scan backend/data', path.join(scanDir, name));
      }
    }
  } catch (_) {}

  // Loc trung path
  const seen = new Set();
  const uniq = candidates.filter(c => {
    const key = path.resolve(c.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (uniq.length === 0) {
    throw new Error('Khong tim thay file DB JSON nao. Kiem tra lai config.json / env KHA_DB_PATH.');
  }

  // Chon file dang duoc app dung: uu tien config.database_path, sau do env, sau do default, sau do file lon nhat co invoices.
  function hasRealData(p) {
    try {
      const db = JSON.parse(fs.readFileSync(p, 'utf8'));
      return Array.isArray(db.invoices) && db.invoices.length > 0 && Array.isArray(db.invoice_details);
    } catch (_) { return false; }
  }
  const realData = uniq.filter(c => hasRealData(c.path));
  const pool = realData.length > 0 ? realData : uniq;

  const preferred = pool.find(c => c.label === 'config.database_path')
    || pool.find(c => c.label === 'env KHA_DB_PATH')
    || pool.find(c => c.label === 'default project db')
    || pool.sort((a, b) => (b.size - a.size) || (b.mtimeMs - a.mtimeMs))[0];

  return { chosen: preferred, all: uniq };
}

function detectItemType(detail, productById) {
  const combo = detail.type === 'combo' || detail.item_type === 'combo' || Boolean(detail.combo_id);
  if (combo) return 'combo';
  const service = detail.type === 'service' || detail.item_type === 'service'
    || detail.type === 'custom_service' || detail.item_type === 'custom_service'
    || detail.is_service || detail.isService;
  if (service) return 'service';

  const pid = detail.product_id ?? detail.variant_id ?? null;
  const productExists = pid != null && productById.has(String(pid));
  if (!productExists) {
    // Dong co product_name nhung khong match product -> custom/service tuy tinh chat
    const name = String(detail.product_name || detail.name || '').trim().toLowerCase();
    if (name.includes('dịch vụ') || name.includes('dich vu') || name.includes('service')) return 'service';
    return 'custom';
  }
  return detail.item_type || detail.type || 'product';
}

function normalizeDetail(detail, ctx) {
  const { productById, nextIdRef } = ctx;

  const rawId = detail.order_item_id ?? detail.id ?? null;
  let id = rawId == null ? null : Number(rawId);
  if (id == null || !Number.isFinite(id)) {
    id = (nextIdRef.value | 0) + 1;
    nextIdRef.value = id;
    ctx.stats.addedIdCount += 1;
  } else {
    // Giu nguyen id cu, cap nhat nextId cho khong trung
    if (id > (nextIdRef.value | 0)) nextIdRef.value = id;
  }

  const order_id = detail.invoice_id ?? detail.order_id ?? null;
  const productIdRaw = detail.product_id ?? detail.variant_id ?? null;
  const product = productIdRaw != null ? productById.get(String(productIdRaw)) : null;

  // product_id: giu nguyen neu match, null neu khong match (orphan/custom)
  let product_id = null;
  if (product) {
    product_id = Number(product.id);
  } else if (productIdRaw != null) {
    // Khong match -> null (orphan/custom), KHONG ghi de
    product_id = null;
  } else {
    product_id = null;
  }

  const product_name = String(detail.product_name || detail.name || '').trim();
  const sku = String(detail.product_sku || detail.sku || '').trim();

  const quantity = toNumber(detail.quantity, 1);
  const unit_price = toNumber(detail.unit_price ?? detail.sale_price ?? detail.sale_price_at_sale ?? detail.price, 0);
  if (unit_price <= 0) ctx.stats.missingPriceCount += 1;

  // cost_price: lay tu dong don cu, KHONG lay tu products
  const cost_price = toNumber(
    detail.cost_price ?? detail.cost_price_at_sale ?? detail.import_price ?? detail.purchase_price,
    0,
  );

  const discount = toNumber(detail.discount ?? detail.discount_amount, 0);
  const vat_amount = toNumber(detail.vat_amount ?? detail.tax_amount ?? detail.vat ?? detail.tax, 0);
  const vat_percent = toNumber(detail.vat_percent ?? detail.tax_percent ?? detail.tax_rate, 0);

  // line_total: uu tien gia tri cu, neu khong co thi tinh lai
  const explicitLineTotal = Number(detail.line_total ?? detail.total_amount ?? detail.total);
  let line_total;
  if (Number.isFinite(explicitLineTotal)) {
    line_total = Math.max(0, explicitLineTotal);
  } else {
    line_total = Math.max(0, quantity * unit_price - discount + vat_amount);
    ctx.stats.recalculatedLineTotalCount += 1;
  }

  const item_type = detectItemType(detail, productById);
  if (product_id == null) {
    ctx.stats.nullProductIdCount += 1;
    ctx.stats.orphanCount += 1;
  }

  // Snapshot day du, giu nguyen cac truong cu khong thuoc snapshot
  return {
    ...detail,
    id,
    order_item_id: id,
    invoice_id: order_id,
    order_id,
    product_id,
    product_name,
    sku,
    quantity,
    unit_price,
    sale_price: unit_price,
    price: unit_price,
    cost_price,
    cost_price_at_sale: cost_price,
    sale_price_at_sale: unit_price,
    discount,
    discount_amount: discount,
    vat_amount,
    vat_percent,
    tax_amount: vat_amount,
    tax_percent: vat_percent,
    line_total,
    item_type,
    type: detail.type || item_type,
    note: detail.note || '',
  };
}

function main() {
  const mode = process.argv.includes('--apply') ? 'apply'
    : process.argv.includes('--dry-run') ? 'dry-run'
    : 'dry-run';

  const { chosen, all } = resolveDbPath();
  if (all.length > 1) {
    console.log('Phat hien nhieu file DB JSON nghi ngo:');
    all.forEach((c, i) => console.log(`  [${i + 1}] ${c.label}: ${c.path} (${c.size} bytes)`));
    console.log(`=> Chon file dang dung: ${chosen.path}`);
  } else {
    console.log(`File DB JSON dang dung: ${chosen.path}`);
  }

  const dbPath = chosen.path;
  const raw = fs.readFileSync(dbPath, 'utf8');
  const db = JSON.parse(raw);

  const products = Array.isArray(db.products) ? db.products : [];
  const productById = new Map(products.map(p => [String(p.id), p]));
  const invoices = Array.isArray(db.invoices) ? db.invoices : [];
  const details = Array.isArray(db.invoice_details) ? db.invoice_details : [];

  const nextIdRef = { value: Number((db.nextId && db.nextId.invoice_details) || 0) || 0 };
  const stats = {
    invoiceCount: invoices.length,
    detailCount: details.length,
    addedIdCount: 0,
    nullProductIdCount: 0,
    orphanCount: 0,
    missingPriceCount: 0,
    recalculatedLineTotalCount: 0,
  };

  const ctx = { productById, nextIdRef, stats };
  const normalized = details.map(d => normalizeDetail(d, ctx));

  // Cap nhat nextId.invoice_details cho khong trung
  if (!db.nextId || typeof db.nextId !== 'object') db.nextId = {};
  db.nextId.invoice_details = (nextIdRef.value | 0) + 1;
  db.invoice_details = normalized;

  const report = {
    mode,
    dbPath,
    backupPath: null,
    updatedPath: null,
    ...stats,
    nextInvoiceDetailsId: db.nextId.invoice_details,
    changed: stats.addedIdCount > 0 || stats.recalculatedLineTotalCount > 0 || normalized.some((d, i) => JSON.stringify(d) !== JSON.stringify(details[i])),
  };

  if (mode === 'apply') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '-');
    const backupDir = path.join(ROOT, 'backups', 'json-backfill-orders');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `database-before-order-items-backfill-${stamp}.json`);
    fs.copyFileSync(dbPath, backupPath);
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
    report.backupPath = backupPath;
    report.updatedPath = dbPath;
  }

  console.log(JSON.stringify(report, null, 2));
  if (mode === 'dry-run') {
    console.log('\n(Dry-run) KHONG ghi file. Chay lai voi --apply de backup roi ghi thay doi.');
  } else {
    console.log('\n(Apply) Da backup va ghi vao file DB JSON that.');
  }
}

main();
