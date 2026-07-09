const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DB = path.join(ROOT, 'backend', 'data', 'phanmienoffline.db.json');
const LOG_DIR = path.join(ROOT, 'logs');
const BACKUP_DIR = path.join(ROOT, 'backend', 'data', 'backup_du_lieu_phan_mem_no_del');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dbArgIdx = args.indexOf('--db');
const DB_PATH = dbArgIdx >= 0 && args[dbArgIdx + 1]
  ? path.resolve(args[dbArgIdx + 1])
  : DEFAULT_DB;

function stamp(d) {
  d = d || new Date();
  const p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function normalizeVietnamese(value) {
  if (value == null) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getProductKeys(product) {
  const keys = [];
  if (!product || typeof product !== 'object') return keys;

  const sku = product.sku != null ? product.sku : (product.product_sku != null ? product.product_sku : product.code);
  if (sku != null && String(sku).trim() !== '') {
    keys.push('sku:' + normalizeVietnamese(sku));
  }

  const barcode = product.barcode != null ? product.barcode : (product.bar_code != null ? product.bar_code : product.product_barcode);
  if (barcode != null && String(barcode).trim() !== '') {
    const nameNorm = normalizeVietnamese(product.name || product.product_name || '');
    const barNorm = normalizeVietnamese(barcode);
    if (barNorm && barNorm !== nameNorm) {
      keys.push('barcode:' + barNorm);
    }
  }

  const productCode = product.productCode != null ? product.productCode : product.product_code;
  if (productCode != null && String(productCode).trim() !== '') {
    keys.push('product_code:' + normalizeVietnamese(productCode));
  }

  const name = product.name != null ? product.name : product.product_name;
  if (name != null && String(name).trim() !== '') {
    const cat = product.category != null ? product.category : product.default_category_id;
    const nameKey = 'name:' + normalizeVietnamese(name) +
      (cat != null && String(cat).trim() ? '|' + normalizeVietnamese(cat) : '');
    keys.push(nameKey);
  }

  return keys;
}

function findDuplicateGroups(products) {
  const active = products.filter(function (p) {
    return p && p.active !== 0 && p.merged !== true && p.status !== 'merged';
  });
  const n = active.length;
  if (n === 0) return [];

  const parent = [];
  for (let i = 0; i < n; i++) parent[i] = i;

  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const keyToIndex = new Map();
  for (let i = 0; i < n; i++) {
    const keys = getProductKeys(active[i]);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      if (keyToIndex.has(key)) {
        union(i, keyToIndex.get(key));
      } else {
        keyToIndex.set(key, i);
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(active[i]);
  }

  return Array.from(groups.values()).filter(function (g) { return g.length >= 2; });
}

function selectPrimary(group) {
  return group.slice().sort(function (a, b) {
    const aDate = new Date(a.created_at || a.createdAt || 0).getTime() || Number.MAX_SAFE_INTEGER;
    const bDate = new Date(b.created_at || b.createdAt || 0).getTime() || Number.MAX_SAFE_INTEGER;
    if (aDate !== bDate) return aDate - bDate;

    const aStock = Number(a.stock || 0);
    const bStock = Number(b.stock || 0);
    if (bStock !== aStock) return bStock - aStock;

    const aImg = (a.image_url || a.image) ? 1 : 0;
    const bImg = (b.image_url || b.image) ? 1 : 0;
    if (bImg !== aImg) return bImg - aImg;

    return Number(a.id || 0) - Number(b.id || 0);
  })[0];
}

function mergeInto(primary, secondary) {
  function fillIfEmpty(field) {
    if ((primary[field] == null || primary[field] === '') && secondary[field] != null && secondary[field] !== '') {
      primary[field] = secondary[field];
    }
  }

  [
    'name', 'sku', 'barcode', 'productCode', 'product_code', 'code',
    'import_price', 'wholesale_price', 'retail_price', 'vip_price',
    'unit', 'category', 'default_category_id', 'supplier_id',
    'description', 'image_url', 'image', 'note',
    'option1', 'option2', 'option3', 'product_type', 'item_type', 'type',
    'is_service', 'sync_source', 'parent_id',
  ].forEach(fillIfEmpty);

  ['import_price', 'wholesale_price', 'retail_price', 'vip_price', 'price', 'cost'].forEach(function (pf) {
    const pVal = Number(primary[pf] || 0);
    const sVal = Number(secondary[pf] || 0);
    if (pVal === 0 && sVal > 0) primary[pf] = secondary[pf];
  });

  // Stock: cong don
  primary.stock = Number(primary.stock || 0) + Number(secondary.stock || 0);

  const pTime = new Date(primary.updated_at || primary.updatedAt || 0).getTime();
  const sTime = new Date(secondary.updated_at || secondary.updatedAt || 0).getTime();
  if (sTime > pTime) {
    primary.updated_at = secondary.updated_at || secondary.updatedAt;
  }

  return primary;
}

function rewireProductIds(db, fromId, toId) {
  const idNum = Number(fromId);
  const toNum = Number(toId);
  let rewired = 0;

  const tables = [
    { name: 'invoice_details', fields: ['product_id', 'variant_id'] },
    { name: 'order_items', fields: ['product_id', 'variant_id'] },
    { name: 'import_details', fields: ['product_id', 'variant_id'] },
    { name: 'import_items', fields: ['product_id', 'variant_id'] },
    { name: 'return_details', fields: ['product_id', 'variant_id'] },
    { name: 'combo_items', fields: ['product_id', 'variant_id'] },
    { name: 'inventory_batches', fields: ['product_id'] },
    { name: 'product_variants', fields: ['product_id', 'parent_id'] },
  ];

  for (let t = 0; t < tables.length; t++) {
    const table = tables[t];
    if (!Array.isArray(db[table.name])) continue;
    for (let r = 0; r < db[table.name].length; r++) {
      const row = db[table.name][r];
      if (!row || typeof row !== 'object') continue;
      for (let f = 0; f < table.fields.length; f++) {
        const field = table.fields[f];
        if (row[field] != null && Number(row[field]) === idNum) {
          row[field] = toNum;
          rewired++;
        }
      }
    }
  }

  if (Array.isArray(db.products)) {
    for (let i = 0; i < db.products.length; i++) {
      const p = db.products[i];
      if (p && p.parent_id != null && Number(p.parent_id) === idNum) {
        p.parent_id = toNum;
        rewired++;
      }
    }
  }

  return rewired;
}

function main() {
  console.log('===========================================================');
  console.log('  CLEANUP DUPLICATE PRODUCTS');
  console.log('  DB  :', DB_PATH);
  console.log('  Mode:', dryRun ? 'DRY-RUN' : 'APPLY');
  console.log('===========================================================');

  if (!fs.existsSync(DB_PATH)) {
    console.error('[ERROR] Khong tim thay database:', DB_PATH);
    process.exit(1);
  }

  const raw = fs.readFileSync(DB_PATH, 'utf8');
  let db;
  try {
    db = JSON.parse(raw);
  } catch (e) {
    console.error('[ERROR] Parse JSON that bai:', e.message);
    process.exit(1);
  }

  if (!Array.isArray(db.products)) {
    console.error('[ERROR] Database khong co bang products');
    process.exit(1);
  }

  const beforeCount = db.products.length;
  const beforeActive = db.products.filter(function (p) { return p && p.active !== 0; }).length;
  console.log('[INFO] Tong san pham: ' + beforeCount + ' (active: ' + beforeActive + ')');

  const ts = stamp();
  const backupPath = path.join(ensureDir(BACKUP_DIR), 'pre-duplicate-cleanup_' + ts + '.json');
  if (!dryRun) {
    fs.copyFileSync(DB_PATH, backupPath);
    console.log('[BACKUP] Da backup -> ' + backupPath);
    console.log('[BACKUP] SHA256: ' + sha256File(backupPath));
  } else {
    console.log('[BACKUP] (dry-run) Bo qua backup');
  }

  const groups = findDuplicateGroups(db.products);
  console.log('[INFO] Tim thay ' + groups.length + ' nhom san pham trung');

  if (groups.length === 0) {
    console.log('[OK] Khong co san pham trung. Thoat.');
    return;
  }

  const log = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    dbPath: DB_PATH,
    dryRun: dryRun,
    backupPath: dryRun ? null : backupPath,
    before: { total: beforeCount, active: beforeActive },
    groups: [],
    summary: {
      groupsProcessed: 0,
      productsMerged: 0,
      productsKept: 0,
      rewiredLinks: 0,
      stockMerged: 0,
    },
  };

  const nowIso = new Date().toISOString();

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const primary = selectPrimary(group);
    const secondaries = group.filter(function (p) { return p.id !== primary.id; });

    const groupLog = {
      key: getProductKeys(primary).join(' | '),
      primary: {
        id: primary.id,
        sku: primary.sku,
        name: primary.name,
        stock: primary.stock,
        barcode: primary.barcode,
      },
      merged: [],
      rewired: 0,
    };

    const stockBefore = Number(primary.stock || 0);

    for (let s = 0; s < secondaries.length; s++) {
      const sec = secondaries[s];
      const secStock = Number(sec.stock || 0);
      mergeInto(primary, sec);

      const rewired = rewireProductIds(db, sec.id, primary.id);
      groupLog.rewired += rewired;
      log.summary.rewiredLinks += rewired;

      sec.active = 0;
      sec.merged = true;
      sec.status = 'merged';
      sec.merged_into = primary.id;
      sec.merged_at = nowIso;
      sec.updated_at = nowIso;
      sec._merge_note = 'Merged into product #' + primary.id + ' by cleanup-duplicate-products';

      groupLog.merged.push({
        id: sec.id,
        sku: sec.sku,
        name: sec.name,
        stock: secStock,
        barcode: sec.barcode,
      });

      log.summary.productsMerged++;
    }

    primary.updated_at = nowIso;
    primary._deduped_at = nowIso;

    const stockAfter = Number(primary.stock || 0);
    groupLog.stockBefore = stockBefore;
    groupLog.stockAfter = stockAfter;
    log.summary.stockMerged += (stockAfter - stockBefore);
    log.summary.productsKept++;
    log.summary.groupsProcessed++;
    log.groups.push(groupLog);

    console.log(
      '  [MERGE] Keep #' + primary.id + ' "' + primary.name + '" ' +
      '(sku=' + primary.sku + ') <- merge ' + secondaries.map(function (x) { return '#' + x.id; }).join(', ') +
      ' | stock ' + stockBefore + ' -> ' + stockAfter + ' | rewired ' + groupLog.rewired
    );
  }

  const afterCount = db.products.length;
  const afterActive = db.products.filter(function (p) { return p && p.active !== 0; }).length;
  log.after = { total: afterCount, active: afterActive };

  const validation = {
    productCountUnchanged: afterCount === beforeCount,
    activeReduced: afterActive < beforeActive,
    noActiveDuplicateNames: true,
    noOrphanInvoiceDetails: true,
    noNegativeStockAnomaly: true,
    issues: [],
  };

  const activeNames = new Map();
  for (let i = 0; i < db.products.length; i++) {
    const p = db.products[i];
    if (!p || p.active === 0) continue;
    const key = normalizeVietnamese(p.name || '') + '|' + normalizeVietnamese(p.category || '');
    if (!key || key === '|') continue;
    if (activeNames.has(key)) {
      validation.noActiveDuplicateNames = false;
      validation.issues.push('Van con trung active: "' + p.name + '" (id=' + p.id + ' va id=' + activeNames.get(key) + ')');
    } else {
      activeNames.set(key, p.id);
    }
  }

  const productIds = new Set(db.products.map(function (p) { return Number(p.id); }));
  if (Array.isArray(db.invoice_details)) {
    for (let i = 0; i < db.invoice_details.length; i++) {
      const d = db.invoice_details[i];
      if (d && d.product_id != null && !productIds.has(Number(d.product_id))) {
        validation.noOrphanInvoiceDetails = false;
        validation.issues.push('invoice_details #' + d.id + ' tro product_id=' + d.product_id + ' khong ton tai');
      }
    }
  }

  for (let i = 0; i < db.products.length; i++) {
    const p = db.products[i];
    if (!p || p.active === 0) continue;
    const stock = Number(p.stock || 0);
    if (stock < -1000) {
      validation.noNegativeStockAnomaly = false;
      validation.issues.push('San pham #' + p.id + ' stock bat thuong: ' + stock);
    }
  }

  log.validation = validation;

  console.log('');
  console.log('[VALIDATION]');
  console.log('  total before/after : ' + beforeCount + ' -> ' + afterCount);
  console.log('  active before/after: ' + beforeActive + ' -> ' + afterActive);
  console.log('  noActiveDuplicateNames : ' + validation.noActiveDuplicateNames);
  console.log('  noOrphanInvoiceDetails : ' + validation.noOrphanInvoiceDetails);
  console.log('  noNegativeStockAnomaly : ' + validation.noNegativeStockAnomaly);
  if (validation.issues.length) {
    console.log('  ISSUES:');
    validation.issues.forEach(function (issue) { console.log('   - ' + issue); });
  }

  ensureDir(LOG_DIR);
  const logPath = path.join(LOG_DIR, 'duplicate-products-cleanup.json');
  const logPathTs = path.join(LOG_DIR, 'duplicate-products-cleanup_' + ts + '.json');

  if (!dryRun) {
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf8');
    fs.writeFileSync(logPathTs, JSON.stringify(log, null, 2), 'utf8');
    console.log('[LOG] -> ' + logPath);
    console.log('[LOG] -> ' + logPathTs);

    const tmpPath = DB_PATH + '.tmp-cleanup';
    fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmpPath, DB_PATH);
    console.log('[DB] Da ghi database: ' + DB_PATH);
  } else {
    console.log('[DRY-RUN] Khong ghi DB/log. Summary:');
    console.log(JSON.stringify(log.summary, null, 2));
  }

  console.log('');
  console.log('[SUMMARY]', JSON.stringify(log.summary, null, 2));
  console.log('===========================================================');
  console.log(dryRun ? '  DRY-RUN HOAN TAT' : '  CLEANUP HOAN TAT');
  console.log('===========================================================');
}

main();
