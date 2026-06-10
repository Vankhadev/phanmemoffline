const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, remove, now, getSyncVersions, withAtomicDbWrite, generateNextDocumentCode } = require('../db/database');
const { requireAuth, requirePermission, requireAnyPermission, publicSession } = require('../middleware/auth');
const { createInvoiceFromPayload } = require('../services/invoiceCreationService');
const {
  assertProductStockValueWithinLimit,
  logNegativeStockTransition,
  logNegativeStockLimitViolation,
  buildNegativeStockErrorResponse,
} = require('../utils/negativeStock');

const PULL_TABLES = [
  'store_info',
  'products',
  'product_categories',
  'customers',
  'customer_types',
  'partners',
  'import_logs',
  'import_details',
  'invoices',
  'invoice_details',
  'combos',
  'combo_items',
  'cash_book',
  'accounting_transactions',
  'cash_fund',
  'bank_accounts',
  'customer_debts',
  'supplier_debts',
  'einvoice_in',
  'einvoice_out',
  'tax_reports',
  'revenue_reports',
  'profit_reports',
  'return_logs',
  'return_details',
  'daily_stats',
  'marketplace_shops',
  'marketplace_orders',
  'system_settings',
];

const SIMPLE_PUSH_FIELDS = {
  partners: ['name', 'phone', 'tax_code', 'email', 'address', 'note', 'invoice_type', 'active', 'created_at', 'updated_at'],
  product_categories: ['name', 'group_name', 'group_key', 'keywords', 'aliases', 'color', 'sort_order', 'active', 'created_at', 'updated_at'],
  products: [
    'parent_id', 'sku', 'name', 'import_price', 'wholesale_price', 'retail_price', 'vip_price',
    'stock', 'unit', 'category', 'default_category_id', 'supplier_id', 'barcode', 'image_url',
    'description', 'option1', 'option2', 'option3',
    'sync_source', 'active', 'created_at', 'updated_at',
  ],
  import_logs: [
    'import_code', 'partner_id', 'user_id', 'total', 'note', 'status', 'stock_status',
    'stock_applied', 'stock_rolled_back', 'stock_updated_at', 'stock_rolled_back_at',
    'payment_status', 'paid_amount', 'remaining_amount', 'deleted', 'cancel_reason',
    'cancelled_at', 'deleted_at', 'created_at', 'updated_at',
  ],
  import_details: ['import_id', 'product_id', 'variant_id', 'product_name', 'sku', 'quantity', 'import_price', 'retail_price', 'wholesale_price', 'discount_percent', 'discount_amount', 'tax_percent', 'tax_amount', 'vat_percent', 'vat_amount', 'line_subtotal', 'taxable_amount', 'line_total', 'created_at', 'updated_at'],
};

function publicUser(user) {
  return {
    id: user.id,
    account_id: user.account_id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    active: user.active === undefined ? 1 : user.active,
    created_at: user.created_at,
    updated_at: user.updated_at,
    last_login: user.last_login || null,
  };
}

function publicAccount(account) {
  return {
    id: account.id,
    slug: account.slug,
    name: account.name,
    plan: account.plan || 'local-server',
    active: account.active === undefined ? 1 : account.active,
    created_at: account.created_at,
    updated_at: account.updated_at,
  };
}

function cloneRows(rows) {
  return JSON.parse(JSON.stringify(rows || []));
}

function recentInvoices(limit = 200) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const invoices = getAll('invoices')
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, safeLimit)
    .map(invoice => ({
      ...invoice,
      customer_name: getOne('customers', customer => Number(customer.id) === Number(invoice.customer_id))?.name || '',
      user_name: getOne('users', user => Number(user.id) === Number(invoice.user_id))?.name || '',
    }));
  const invoiceIds = new Set(invoices.map(invoice => Number(invoice.id)));
  const invoiceDetails = getAll('invoice_details', detail => invoiceIds.has(Number(detail.invoice_id)));
  return { invoices, invoice_details: invoiceDetails };
}

function buildBootstrapPayload(req) {
  const storeInfo = getAll('store_info')[0] || {};
  const syncVersions = getSyncVersions(req.accountId);
  const defaultRoute = req.user?.role === 'admin' ? '/cai-dat' : '/';
  return {
    ok: true,
    user: publicUser(req.user),
    account: publicAccount(req.account),
    permissions: req.permissions || [],
    session: publicSession(req.session),
    store_info: storeInfo,
    syncVersions,
    defaultRoute,
    bootstrap: {
      defaultRoute,
      syncVersions,
    },
    serverTime: now(),
  };
}

function upsertCustomerFromSync(payload, req) {
  if (!payload || typeof payload !== 'object') return null;
  const name = String(payload.name || '').trim();
  if (!name) return null;

  const phone = String(payload.phone || '').trim();
  const email = String(payload.email || '').trim();
  const existing = getOne('customers', customer =>
    customer.active !== 0 &&
    ((phone && String(customer.phone || '').trim() === phone) ||
      (email && String(customer.email || '').trim().toLowerCase() === email.toLowerCase()))
  );

  const row = {
    name,
    phone,
    email,
    tax_code: payload.tax_code || '',
    customer_type: payload.customer_type || 'Khách lẻ',
    invoice_type: payload.invoice_type || 'non_electronic',
    active: payload.active === 0 ? 0 : 1,
    updated_at: now(),
  };

  if (existing) {
    update('customers', existing.id, row);
    return { id: existing.id, action: 'updated' };
  }

  const id = insert('customers', { ...row, account_id: req.accountId, created_at: payload.created_at || now() });
  return { id, action: 'created' };
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isProductVariantPayload(payload = {}) {
  return Boolean(toOptionalNumber(payload.parent_id) || payload.is_variant || payload.item_type === 'variant' || payload.type === 'variant');
}

function findProductByNaturalKey(payload = {}) {
  const variantPayload = isProductVariantPayload(payload);
  if (payload.id !== undefined && payload.id !== null) {
    const byId = getOne('products', row => Number(row.id) === Number(payload.id));
    if (byId && Boolean(byId.parent_id) === variantPayload) return byId;
  }

  const sku = String(payload.sku || '').trim();
  if (!sku) return null;
  return getOne('products', row => row && row.active !== 0 && String(row.sku || '').trim() === sku && (variantPayload ? row.parent_id != null : !row.parent_id));
}

function findByNaturalKey(table, payload = {}) {
  if (table === 'products') return findProductByNaturalKey(payload);

  if (payload.id !== undefined && payload.id !== null) {
    const byId = getOne(table, row => Number(row.id) === Number(payload.id));
    if (byId) return byId;
  }

  if (table === 'partners') {
    const phone = String(payload.phone || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    const taxCode = String(payload.tax_code || '').trim();
    const name = String(payload.name || '').trim().toLowerCase();
    return getOne('partners', row => row && row.active !== 0 && (
      (phone && String(row.phone || '').trim() === phone) ||
      (email && String(row.email || '').trim().toLowerCase() === email) ||
      (taxCode && String(row.tax_code || '').trim() === taxCode) ||
      (name && String(row.name || '').trim().toLowerCase() === name)
    ));
  }

  if (table === 'product_categories') {
    const name = String(payload.name || '').trim().toLowerCase();
    const groupKey = String(payload.group_key || '').trim().toLowerCase();
    return getOne('product_categories', row => row && row.active !== 0 && (
      (groupKey && String(row.group_key || '').trim().toLowerCase() === groupKey) ||
      (name && String(row.name || '').trim().toLowerCase() === name)
    ));
  }

  if (table === 'import_logs') {
    const code = String(payload.import_code || '').trim();
    return code ? getOne('import_logs', row => String(row.import_code || '').trim() === code) : null;
  }

  return null;
}

function pickAllowedFields(payload = {}, fields = []) {
  return fields.reduce((acc, field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) acc[field] = payload[field];
    return acc;
  }, {});
}

function hasSyncNumberValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function firstFiniteSyncNumber(...values) {
  for (const value of values) {
    if (!hasSyncNumberValue(value)) continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return 0;
}

function toSyncMoney(...values) {
  return Math.max(0, firstFiniteSyncNumber(...values));
}

function toSyncPercent(...values) {
  return Math.min(100, Math.max(0, firstFiniteSyncNumber(...values)));
}

function normalizeImportDetailForSync(detailPayload = {}) {
  const row = { ...(detailPayload || {}) };
  const quantity = toSyncMoney(row.quantity, 0);
  const importPrice = toSyncMoney(row.import_price, 0);
  const lineSubtotal = quantity * importPrice;
  const discountPercent = toSyncPercent(row.discount_percent, 0);
  const discountAmount = hasSyncNumberValue(row.discount_amount)
    ? Math.min(lineSubtotal, toSyncMoney(row.discount_amount, 0))
    : lineSubtotal * discountPercent / 100;
  const taxableAmount = Math.max(0, lineSubtotal - discountAmount);
  const taxPercent = toSyncPercent(row.tax_percent, row.vat_percent, 0);
  const taxAmount = hasSyncNumberValue(row.tax_amount) || hasSyncNumberValue(row.vat_amount)
    ? toSyncMoney(row.tax_amount, row.vat_amount, 0)
    : taxableAmount * taxPercent / 100;

  return {
    ...row,
    quantity,
    import_price: importPrice,
    discount_percent: discountPercent,
    discount_amount: discountAmount,
    tax_percent: taxPercent,
    tax_amount: taxAmount,
    vat_percent: taxPercent,
    vat_amount: taxAmount,
    line_subtotal: lineSubtotal,
    taxable_amount: taxableAmount,
    line_total: taxableAmount + taxAmount,
  };
}

function upsertProductFromSync(payload, req) {
  if (!payload || typeof payload !== 'object') return null;
  const row = pickAllowedFields(payload, SIMPLE_PUSH_FIELDS.products);
  const existing = findProductByNaturalKey(payload);
  const variantPayload = isProductVariantPayload(payload);
  row.updated_at = row.updated_at || now();

  if (Object.prototype.hasOwnProperty.call(row, 'stock')) {
    const normalizedStock = Number(row.stock);
    row.stock = Number.isFinite(normalizedStock) ? normalizedStock : 0;
    assertProductStockValueWithinLimit({
      productId: existing?.id || payload.id || null,
      productName: row.name || existing?.name || row.sku || payload.sku || 'Sản phẩm',
      stock: row.stock,
      currentStock: existing?.id ? existing.stock : null,
      operation: 'đồng bộ tồn kho sản phẩm',
    });
  }

  if (existing) {
    if (existing.parent_id) row.parent_id = toOptionalNumber(row.parent_id) || existing.parent_id;
    else row.parent_id = null;
    row.sku = existing.sku || '';
    const updated = update('products', existing.id, row);
    if ((Number(updated?.stock) || 0) < 0) {
      logNegativeStockTransition({
        productId: updated.id,
        productName: updated.name || updated.sku || 'Sản phẩm',
        currentStock: Number(existing.stock) || 0,
        changeQuantity: (Number(updated.stock) || 0) - (Number(existing.stock) || 0),
        projectedStock: Number(updated.stock) || 0,
        operation: 'đồng bộ tồn kho sản phẩm',
        source: 'sync_products',
      });
    }
    return { id: existing.id, sku: updated.sku, action: 'updated' };
  }

  if (variantPayload) {
    const parentId = toOptionalNumber(row.parent_id || payload.parent_id);
    const parent = parentId ? getOne('products', product => Number(product.id) === parentId && !product.parent_id && product.active !== 0) : null;
    if (!parent) return { id: null, action: 'skipped', message: 'Bỏ qua biến thể đồng bộ vì không tìm thấy sản phẩm cha hợp lệ.' };
    row.parent_id = parent.id;
  } else {
    row.parent_id = null;
  }
  row.sku = generateNextDocumentCode('product', { skipSave: true });

  const id = insert('products', {
    ...row,
    account_id: req.accountId,
    active: row.active === undefined ? 1 : row.active,
    created_at: row.created_at || now(),
  });
  if ((Number(row.stock) || 0) < 0) {
    logNegativeStockTransition({
      productId: id,
      productName: row.name || row.sku || 'Sản phẩm',
      currentStock: null,
      projectedStock: Number(row.stock) || 0,
      operation: 'đồng bộ tồn kho sản phẩm',
      source: 'sync_products',
    });
  }
  return { id, sku: row.sku, action: 'created' };
}

function upsertSimpleRowFromSync(table, payload, req) {
  if (!payload || typeof payload !== 'object') return null;
  if (table === 'products') return upsertProductFromSync(payload, req);
  const fields = SIMPLE_PUSH_FIELDS[table];
  if (!fields) return null;
  const row = pickAllowedFields(payload, fields);
  if (table === 'import_details') Object.assign(row, normalizeImportDetailForSync(row));
  const existing = findByNaturalKey(table, payload);
  row.updated_at = row.updated_at || now();

  if (existing) {
    if (table === 'import_logs') row.import_code = existing.import_code;
    update(table, existing.id, row);
    return { id: existing.id, ...(table === 'import_logs' ? { import_code: existing.import_code } : {}), action: 'updated' };
  }
  if (table === 'import_logs') {
    row.import_code = generateNextDocumentCode('import', { skipSave: true });
  }

  const id = insert(table, {
    ...row,
    account_id: req.accountId,
    active: row.active === undefined ? 1 : row.active,
    created_at: row.created_at || now(),
  });
  return { id, ...(table === 'import_logs' ? { import_code: row.import_code } : {}), action: 'created' };
}

function upsertImportFromSync(payload, req) {
  if (!payload || typeof payload !== 'object') return null;
  const details = Array.isArray(payload.details) ? payload.details : [];
  const requestedImportCode = String(payload.import_code || '').trim();
  const existing = requestedImportCode
    ? getOne('import_logs', row => String(row.import_code || '').trim() === requestedImportCode)
    : null;
  const importCode = existing
    ? existing.import_code
    : generateNextDocumentCode('import', { skipSave: true });
  const logPayload = pickAllowedFields({ ...payload, import_code: importCode }, SIMPLE_PUSH_FIELDS.import_logs);
  logPayload.updated_at = logPayload.updated_at || now();

  let importId;
  let action;
  if (existing) {
    importId = existing.id;
    logPayload.import_code = existing.import_code;
    update('import_logs', importId, logPayload);
    action = 'updated';
    if (details.length > 0) {
      getAll('import_details', detail => Number(detail.import_id) === Number(importId)).forEach(detail => remove('import_details', detail.id));
    }
  } else {
    importId = insert('import_logs', {
      ...logPayload,
      account_id: req.accountId,
      import_code: importCode,
      status: logPayload.status || 'received',
      total: Number(logPayload.total) || 0,
      deleted: logPayload.deleted === true,
      created_at: logPayload.created_at || now(),
    });
    action = 'created';
  }

  const savedDetails = [];
  for (const detail of details) {
    const detailPayload = normalizeImportDetailForSync(
      pickAllowedFields({ ...detail, import_id: importId }, SIMPLE_PUSH_FIELDS.import_details)
    );
    const id = insert('import_details', {
      ...detailPayload,
      account_id: req.accountId,
      import_id: importId,
      created_at: detailPayload.created_at || now(),
    });
    savedDetails.push({ id, action: 'created' });
  }

  return { id: importId, import_code: importCode, action, details: savedDetails.length };
}

function createPendingOrderFromSync(payload, req) {
  if (!payload || typeof payload !== 'object') return null;
  const details = Array.isArray(payload.details) ? payload.details : [];
  if (details.length === 0) return null;

  try {
    const result = createInvoiceFromPayload({
      ...payload,
      user_id: req.user?.id || payload.user_id || null,
      note: payload.note || 'Đơn đồng bộ từ thiết bị',
    }, req, { orderSource: 'sync' });

    return {
      id: result.invoice_id,
      invoice_code: result.invoice_code,
      client_order_id: result.client_order_id || '',
      action: result.idempotent ? 'existing_idempotent' : 'created_pending',
      idempotent: result.idempotent === true,
    };
  } catch (err) {
    logNegativeStockLimitViolation(err, { source: 'sync_orders', client_order_id: payload.client_order_id || '' });
    const errorResponse = buildNegativeStockErrorResponse(err, 'Lỗi đồng bộ đơn hàng');
    return {
      id: null,
      invoice_code: payload.invoice_code || '',
      client_order_id: payload.client_order_id || '',
      action: 'error',
      error: errorResponse.error || err.message,
      message: errorResponse.message || errorResponse.error || err.message,
      detail: errorResponse.detail || err.message,
      details: errorResponse.details || undefined,
      code: errorResponse.code || err.code || 'SYNC_ORDER_ERROR',
    };
  }
}

router.get('/bootstrap/status', (req, res) => {
  const users = getAll('users', null, { skipAccountScope: true });
  const activeUsers = users.filter(user => user && user.active !== 0);
  res.json({
    ok: true,
    needsSetup: users.length === 0,
    hasAdmin: activeUsers.some(user => user.role === 'admin'),
    totalUsers: users.length,
    activeUsers: activeUsers.length,
    serverTime: now(),
  });
});

router.get('/bootstrap', requireAuth, requirePermission('sync.read'), (req, res) => {
  res.json(buildBootstrapPayload(req));
});

router.get('/sync/versions', requireAuth, requirePermission('sync.read'), (req, res) => {
  res.json({ ok: true, syncVersions: getSyncVersions(req.accountId), serverTime: now() });
});

router.post('/sync/pull', requireAuth, requirePermission('sync.read'), (req, res) => {
  const body = req.body || {};
  const hasExplicitTables = Array.isArray(body.tables) && body.tables.length > 0;
  const requestedTables = hasExplicitTables
    ? body.tables.filter(table => PULL_TABLES.includes(table))
    : PULL_TABLES;

  const data = {};
  for (const table of requestedTables) {
    if (table === 'invoices' || table === 'invoice_details') continue;
    let rows = getAll(table);
    if (['accounting_transactions', 'cash_fund', 'customer_debts', 'supplier_debts', 'einvoice_in', 'einvoice_out', 'tax_reports', 'revenue_reports', 'profit_reports'].includes(table)) {
      const limit = Math.min(Math.max(Number(body.accountingLimit || body.accounting_limit || 200) || 200, 1), 1000);
      rows = rows.slice().sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)).slice(0, limit);
    }
    data[table] = cloneRows(rows);
  }

  const wantsInvoices = !hasExplicitTables || requestedTables.includes('invoices') || requestedTables.includes('invoice_details');
  if (wantsInvoices) {
    const invoiceLimit = body.invoiceLimit || body.invoice_limit || 200;
    const invoiceData = recentInvoices(invoiceLimit);
    data.invoices = cloneRows(invoiceData.invoices);
    data.invoice_details = cloneRows(invoiceData.invoice_details);
  }

  res.json({
    ok: true,
    account_id: req.accountId,
    data,
    syncVersions: getSyncVersions(req.accountId),
    serverTime: now(),
  });
});

router.post('/sync/push', requireAuth, requirePermission('sync.manage'), (req, res) => {
  const body = req.body || {};
  const pending = body.pending || body;
  const result = withAtomicDbWrite(() => {
    const customerInputs = Array.isArray(pending.customers) ? pending.customers : [];
    const orderInputs = Array.isArray(pending.orders) ? pending.orders : [];
    const partnerInputs = Array.isArray(pending.partners) ? pending.partners : [];
    const productInputs = Array.isArray(pending.products) ? pending.products : [];
    const categoryInputs = Array.isArray(pending.product_categories) ? pending.product_categories : [];
    const importInputs = Array.isArray(pending.imports) ? pending.imports : [];
    const importLogInputs = Array.isArray(pending.import_logs) ? pending.import_logs : [];
    const importDetailInputs = Array.isArray(pending.import_details) ? pending.import_details : [];

    const customers = [];
    const orders = [];
    const partners = [];
    const products = [];
    const product_categories = [];
    const imports = [];
    const import_logs = [];
    const import_details = [];

    for (const customer of customerInputs) {
      const rowResult = upsertCustomerFromSync(customer, req);
      if (rowResult) customers.push(rowResult);
    }

    for (const partner of partnerInputs) {
      const rowResult = upsertSimpleRowFromSync('partners', partner, req);
      if (rowResult) partners.push(rowResult);
    }

    for (const category of categoryInputs) {
      const rowResult = upsertSimpleRowFromSync('product_categories', category, req);
      if (rowResult) product_categories.push(rowResult);
    }

    for (const product of productInputs) {
      try {
        const rowResult = upsertSimpleRowFromSync('products', product, req);
        if (rowResult) products.push(rowResult);
      } catch (err) {
        logNegativeStockLimitViolation(err, { source: 'sync_products' });
        const errorResponse = buildNegativeStockErrorResponse(err, 'Lỗi đồng bộ tồn kho sản phẩm');
        products.push({
          id: product?.id || null,
          sku: product?.sku || '',
          action: 'error',
          error: errorResponse.error || err.message,
          message: errorResponse.message || errorResponse.error || err.message,
          detail: errorResponse.detail || err.message,
          details: errorResponse.details || undefined,
          code: errorResponse.code || err.code || 'SYNC_PRODUCT_ERROR',
        });
      }
    }

    for (const imp of importInputs) {
      const rowResult = upsertImportFromSync(imp, req);
      if (rowResult) imports.push(rowResult);
    }

    for (const importLog of importLogInputs) {
      const rowResult = upsertSimpleRowFromSync('import_logs', importLog, req);
      if (rowResult) import_logs.push(rowResult);
    }

    for (const importDetail of importDetailInputs) {
      const rowResult = upsertSimpleRowFromSync('import_details', importDetail, req);
      if (rowResult) import_details.push(rowResult);
    }

    for (const order of orderInputs) {
      const rowResult = createPendingOrderFromSync(order, req);
      if (rowResult) orders.push(rowResult);
    }

    const supportedKeys = ['customers', 'orders', 'partners', 'products', 'product_categories', 'imports', 'import_logs', 'import_details'];
    const unsupported = Object.keys(pending).filter(key => !supportedKeys.includes(key));
    return {
      ok: true,
      accepted: { customers, orders, partners, products, product_categories, imports, import_logs, import_details },
      unsupported,
      message: unsupported.length > 0
        ? 'Server đã nhận các nhóm dữ liệu chính; các khóa chưa hỗ trợ được bỏ qua để tránh mất dữ liệu.'
        : 'Đồng bộ push dữ liệu chính hoàn tất.',
      syncVersions: getSyncVersions(req.accountId),
      serverTime: now(),
    };
  });
  res.json(result);
});

module.exports = router;
