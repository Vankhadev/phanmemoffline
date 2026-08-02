/**
 * productUpsertService.js
 * Upsert san pham an toan + cleanup trung 1 lan sau update.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  normalizeProductKey,
  getProductIdentityKeys,
  findExistingProduct,
  mergeProductFields,
  selectPrimaryProduct,
  isActiveProduct,
  normalizeVietnamese,
  normalizeCodeKey,
  hasText,
} = require('../utils/productKey');

const CLEANUP_MIGRATION_ID = '20260709_duplicate_products_cleanup_v1';

function getDbModule() {
  return require('../db/database');
}

function nowIso() {
  return new Date().toISOString();
}

function getProducts(dbModule = getDbModule()) {
  return dbModule.getAll('products') || [];
}

function softDeleteMergedProduct(dbModule, product, primaryId, options = {}) {
  const skipSave = options.skipSave === true;
  return dbModule.update('products', product.id, {
    active: 0,
    merged: true,
    status: 'merged',
    merged_into: primaryId,
    merged_at: nowIso(),
    updated_at: nowIso(),
    _merge_note: 'Merged into product #' + primaryId + ' by productUpsertService',
  }, { skipSave });
}

function rewireProductIdsInDb(db, fromId, toId) {
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

  for (const table of tables) {
    if (!Array.isArray(db[table.name])) continue;
    for (const row of db[table.name]) {
      if (!row || typeof row !== 'object') continue;
      for (const field of table.fields) {
        if (row[field] != null && Number(row[field]) === idNum) {
          row[field] = toNum;
          rewired++;
        }
      }
    }
  }

  if (Array.isArray(db.products)) {
    for (const p of db.products) {
      if (p && p.parent_id != null && Number(p.parent_id) === idNum) {
        p.parent_id = toNum;
        rewired++;
      }
    }
  }
  return rewired;
}

/**
 * Upsert product:
 * - Tim san pham ton tai theo multi-key
 * - Neu co: merge field thieu / moi hon, KHONG insert moi
 * - Neu khong: insert
 */
function upsertProduct(product, options = {}) {
  const dbModule = options.dbModule || getDbModule();
  const skipSave = options.skipSave === true;
  const sumStock = options.sumStock === true;
  const preferIncoming = options.preferIncoming === true;
  const timestamp = options.timestamp || nowIso();
  const products = getProducts(dbModule);
  const existing = findExistingProduct(products, product, { onlyActive: true });

  if (existing) {
    const merged = { ...existing };
    if (preferIncoming) {
      // fill from existing into incoming first, then overwrite with incoming non-empty
      mergeProductFields(merged, product, { sumStock: false });
      for (const [k, v] of Object.entries(product || {})) {
        if (k === 'id') continue;
        if (hasText(v) || typeof v === 'number' || typeof v === 'boolean') {
          if (k === 'stock' && sumStock) {
            merged.stock = Number(existing.stock || 0) + Number(v || 0);
          } else if (k === 'stock' && !sumStock) {
            // keep existing stock unless incoming explicitly provided and preferIncoming
            merged.stock = Number(v);
          } else {
            merged[k] = v;
          }
        }
      }
    } else {
      mergeProductFields(merged, product, { sumStock });
    }
    merged.updated_at = timestamp;
    const updated = dbModule.update('products', existing.id, {
      ...merged,
      id: existing.id,
      created_at: existing.created_at || merged.created_at || timestamp,
      updated_at: timestamp,
    }, { skipSave });
    return { action: 'updated', product: updated || merged, existing: true };
  }

  const payload = {
    ...product,
    active: product.active === undefined ? 1 : product.active,
    created_at: product.created_at || timestamp,
    updated_at: timestamp,
  };
  delete payload.merged;
  delete payload.status;
  delete payload.merged_into;
  delete payload.merged_at;

  if (!hasText(payload.sku)) {
    try {
      payload.sku = dbModule.generateNextDocumentCode('product', { skipSave: true });
    } catch (_) {
      // keep empty if generator unavailable
    }
  }

  const id = dbModule.insert('products', payload, { skipSave });
  const created = dbModule.getOne('products', (p) => Number(p.id) === Number(id)) || { id, ...payload };
  return { action: 'created', product: created, existing: false };
}

function hasCleanupAlreadyRun(dbModule = getDbModule()) {
  try {
    const rows = dbModule.getAll('schema_migrations') || [];
    return rows.some((row) => row && (row.migration_id === CLEANUP_MIGRATION_ID || row.name === CLEANUP_MIGRATION_ID));
  } catch (_) {
    return false;
  }
}

function markCleanupRun(dbModule = getDbModule(), meta = {}) {
  try {
    const existing = (dbModule.getAll('schema_migrations') || []).find(
      (row) => row && (row.migration_id === CLEANUP_MIGRATION_ID || row.name === CLEANUP_MIGRATION_ID)
    );
    if (existing) {
      dbModule.update('schema_migrations', existing.id, {
        status: 'completed',
        completed_at: nowIso(),
        meta_json: JSON.stringify(meta || {}),
        updated_at: nowIso(),
      }, { skipSave: true });
      return;
    }
    dbModule.insert('schema_migrations', {
      migration_id: CLEANUP_MIGRATION_ID,
      name: CLEANUP_MIGRATION_ID,
      status: 'completed',
      completed_at: nowIso(),
      meta_json: JSON.stringify(meta || {}),
      created_at: nowIso(),
      updated_at: nowIso(),
    }, { skipSave: true });
  } catch (err) {
    console.warn('[PRODUCT CLEANUP] Khong ghi duoc schema_migrations:', err.message);
  }
}

function writeCleanupLog(report) {
  try {
    const logDir = path.resolve(process.cwd(), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'duplicate-products-cleanup.json');
    fs.writeFileSync(logPath, JSON.stringify(report, null, 2), 'utf8');
    return logPath;
  } catch (err) {
    console.warn('[PRODUCT CLEANUP] Khong ghi duoc log:', err.message);
    return null;
  }
}

/**
 * Cleanup trung san pham 1 lan. Neu da chay thi bo qua.
 */
function cleanupDuplicateProductsOnce(options = {}) {
  const dbModule = options.dbModule || getDbModule();
  const force = options.force === true;

  if (!force && hasCleanupAlreadyRun(dbModule)) {
    return { ok: true, skipped: true, reason: 'already_ran', migration_id: CLEANUP_MIGRATION_ID };
  }

  return dbModule.withAtomicDbWrite(() => {
    const db = dbModule.getDb();
    const products = Array.isArray(db.products) ? db.products : [];
    const beforeTotal = products.length;
    const beforeActive = products.filter(isActiveProduct).length;

    // Union-find multi-key grouping
    const active = products.filter(isActiveProduct);
    const n = active.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    const keyToIndex = new Map();
    for (let i = 0; i < n; i++) {
      const keys = getProductIdentityKeys(active[i], { includeId: false, includeName: true, scopeParent: true });
      for (const key of keys) {
        // name_only chi group neu ca 2 khong co sku/barcode/code
        if (key.startsWith('name_only:')) {
          const hasCode = hasText(active[i].sku) || hasText(active[i].barcode) || hasText(active[i].product_code) || hasText(active[i].productCode);
          if (hasCode) continue;
        }
        if (keyToIndex.has(key)) union(i, keyToIndex.get(key));
        else keyToIndex.set(key, i);
      }
    }

    const groupsMap = new Map();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      if (!groupsMap.has(root)) groupsMap.set(root, []);
      groupsMap.get(root).push(active[i]);
    }
    const groups = Array.from(groupsMap.values()).filter((g) => g.length >= 2);

    const report = {
      version: '1.0',
      timestamp: nowIso(),
      migration_id: CLEANUP_MIGRATION_ID,
      before: { total: beforeTotal, active: beforeActive },
      groups: [],
      summary: {
        groupsProcessed: 0,
        productsMerged: 0,
        productsKept: 0,
        rewiredLinks: 0,
        stockMerged: 0,
      },
    };

    for (const group of groups) {
      const primary = selectPrimaryProduct(group);
      const secondaries = group.filter((p) => Number(p.id) !== Number(primary.id));
      const stockBefore = Number(primary.stock || 0);
      const groupLog = {
        primary: { id: primary.id, sku: primary.sku, name: primary.name, stock: primary.stock },
        merged: [],
        rewired: 0,
      };

      for (const sec of secondaries) {
        mergeProductFields(primary, sec, { sumStock: true });
        const rewired = rewireProductIdsInDb(db, sec.id, primary.id);
        groupLog.rewired += rewired;
        report.summary.rewiredLinks += rewired;

        sec.active = 0;
        sec.merged = true;
        sec.status = 'merged';
        sec.merged_into = primary.id;
        sec.merged_at = nowIso();
        sec.updated_at = nowIso();
        sec._merge_note = 'Merged into product #' + primary.id + ' by productUpsertService';

        groupLog.merged.push({ id: sec.id, sku: sec.sku, name: sec.name, stock: sec.stock });
        report.summary.productsMerged++;
      }

      primary.updated_at = nowIso();
      primary._deduped_at = nowIso();
      const stockAfter = Number(primary.stock || 0);
      groupLog.stockBefore = stockBefore;
      groupLog.stockAfter = stockAfter;
      report.summary.stockMerged += (stockAfter - stockBefore);
      report.summary.productsKept++;
      report.summary.groupsProcessed++;
      report.groups.push(groupLog);
    }

    const afterActive = products.filter(isActiveProduct).length;
    report.after = { total: products.length, active: afterActive };
    report.validation = validateProductsIntegrity(db);

    markCleanupRun(dbModule, report.summary);
    const logPath = writeCleanupLog(report);
    report.logPath = logPath;

    console.log(
      '[PRODUCT CLEANUP] groups=' + report.summary.groupsProcessed +
      ' merged=' + report.summary.productsMerged +
      ' active ' + beforeActive + '->' + afterActive
    );

    return { ok: true, skipped: false, report };
  });
}

/**
 * Restore products that were hidden by the old automatic merge migration.
 * This is deliberately one-way and non-destructive: it only clears the
 * merge marker when the target still exists. It never rewires or deletes rows.
 */
function restoreProductsHiddenByAutomaticMerge(options = {}) {
  const dbModule = options.dbModule || getDbModule();
  const timestamp = nowIso();
  return dbModule.withAtomicDbWrite(() => {
    const db = dbModule.getDb();
    const products = Array.isArray(db.products) ? db.products : [];
    const candidates = products.filter(product => product
      && product.merged === true
      && product.status === 'merged'
      && product.merged_into != null
      && product._merge_note === 'Merged into product #' + product.merged_into + ' by productUpsertService');
    const restored = [];
    for (const product of candidates) {
      const target = products.find(item => Number(item?.id) === Number(product.merged_into));
      if (!target) continue;
      const updated = dbModule.update('products', product.id, {
        active: 1,
        deleted: false,
        deleted_at: null,
        merged: false,
        status: 'active',
        restored_from_merge: true,
        restored_at: timestamp,
        updated_at: timestamp,
      }, { skipSave: true });
      if (updated) restored.push({ id: product.id, merged_into: target.id });
    }
    return { ok: true, restored, restoredCount: restored.length, checked: candidates.length };
  });
}

function validateProductsIntegrity(db) {
  const products = Array.isArray(db.products) ? db.products : [];
  const active = products.filter(isActiveProduct);
  const issues = [];
  const nameMap = new Map();

  for (const p of active) {
    const key = normalizeVietnamese(p.name || '') + '|' + normalizeVietnamese(p.category || '');
    if (!key || key === '|') continue;
    // Chi canh bao name trung khi ca 2 deu khong co sku khac nhau co y
    if (nameMap.has(key)) {
      const other = nameMap.get(key);
      const sameSku = hasText(p.sku) && hasText(other.sku) && normalizeCodeKey(p.sku) === normalizeCodeKey(other.sku);
      const bothNoSku = !hasText(p.sku) && !hasText(other.sku);
      if (sameSku || bothNoSku) {
        issues.push('Active duplicate name/sku: "' + p.name + '" ids=' + other.id + ',' + p.id);
      }
    } else {
      nameMap.set(key, p);
    }
  }

  const productIds = new Set(products.map((p) => Number(p.id)));
  if (Array.isArray(db.invoice_details)) {
    for (const d of db.invoice_details) {
      if (d && d.product_id != null && !productIds.has(Number(d.product_id))) {
        issues.push('Orphan invoice_details product_id=' + d.product_id);
      }
    }
  }

  let negativeAnomaly = 0;
  for (const p of active) {
    if (Number(p.stock || 0) < -1000) {
      negativeAnomaly++;
      issues.push('Suspicious stock product #' + p.id + '=' + p.stock);
    }
  }

  return {
    ok: issues.length === 0,
    activeCount: active.length,
    totalCount: products.length,
    negativeAnomaly,
    issues,
  };
}

function listActiveProductsOnly(products) {
  return (Array.isArray(products) ? products : []).filter(isActiveProduct);
}

module.exports = {
  CLEANUP_MIGRATION_ID,
  normalizeProductKey,
  upsertProduct,
  findExistingProduct,
  cleanupDuplicateProductsOnce,
  restoreProductsHiddenByAutomaticMerge,
  hasCleanupAlreadyRun,
  validateProductsIntegrity,
  listActiveProductsOnly,
  isActiveProduct,
  rewireProductIdsInDb,
  mergeProductFields,
};
