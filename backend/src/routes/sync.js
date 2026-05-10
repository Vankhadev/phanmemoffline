const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, remove, now, getSyncVersions } = require('../db/database');
const { requireAuth, requirePermission, publicSession } = require('../middleware/auth');
const { resolveInvoiceDetailDisplayFields } = require('../utils/productDisplayName');

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
  'print_templates',
  'cash_book',
  'return_logs',
  'return_details',
  'daily_stats',
];

const SIMPLE_PUSH_FIELDS = {
  partners: ['name', 'phone', 'tax_code', 'email', 'address', 'note', 'invoice_type', 'active', 'created_at', 'updated_at'],
  product_categories: ['name', 'group_name', 'group_key', 'keywords', 'aliases', 'color', 'sort_order', 'active', 'created_at', 'updated_at'],
  products: [
    'parent_id', 'sku', 'name', 'import_price', 'wholesale_price', 'retail_price', 'vip_price',
    'stock', 'unit', 'category', 'default_category_id', 'supplier_id', 'barcode', 'image_url',
    'description', 'option1', 'option2', 'option3', 'sapo_product_id', 'sapo_variant_id',
    'sapo_parent_product_id', 'sapo_status', 'sapo_updated_at', 'sapo_last_synced_at',
    'sync_source', 'active', 'created_at', 'updated_at',
  ],
  import_logs: [
    'import_code', 'partner_id', 'user_id', 'total', 'note', 'status', 'stock_status',
    'stock_applied', 'stock_rolled_back', 'stock_updated_at', 'stock_rolled_back_at',
    'payment_status', 'paid_amount', 'remaining_amount', 'deleted', 'cancel_reason',
    'cancelled_at', 'deleted_at', 'created_at', 'updated_at',
  ],
  import_details: ['import_id', 'product_id', 'variant_id', 'product_name', 'sku', 'quantity', 'import_price', 'retail_price', 'wholesale_price', 'line_total', 'created_at', 'updated_at'],
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
  return {
    ok: true,
    user: publicUser(req.user),
    account: publicAccount(req.account),
    permissions: req.permissions || [],
    session: publicSession(req.session),
    store_info: storeInfo,
    syncVersions: getSyncVersions(req.accountId),
    defaultRoute: req.user?.role === 'admin' ? '/settings' : '/',
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

function findByNaturalKey(table, payload = {}) {
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

  if (table === 'products') {
    const sku = String(payload.sku || '').trim();
    return sku ? getOne('products', row => row && row.active !== 0 && String(row.sku || '').trim() === sku) : null;
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

function upsertSimpleRowFromSync(table, payload, req) {
  if (!payload || typeof payload !== 'object') return null;
  const fields = SIMPLE_PUSH_FIELDS[table];
  if (!fields) return null;
  const row = pickAllowedFields(payload, fields);
  const existing = findByNaturalKey(table, payload);
  row.updated_at = row.updated_at || now();

  if (existing) {
    update(table, existing.id, row);
    return { id: existing.id, action: 'updated' };
  }

  const id = insert(table, {
    ...row,
    account_id: req.accountId,
    active: row.active === undefined ? 1 : row.active,
    created_at: row.created_at || now(),
  });
  return { id, action: 'created' };
}

function upsertImportFromSync(payload, req) {
  if (!payload || typeof payload !== 'object') return null;
  const details = Array.isArray(payload.details) ? payload.details : [];
  const importCode = String(payload.import_code || '').trim() || `SYNC-PN-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const existing = getOne('import_logs', row => String(row.import_code || '') === importCode);
  const logPayload = pickAllowedFields({ ...payload, import_code: importCode }, SIMPLE_PUSH_FIELDS.import_logs);
  logPayload.updated_at = logPayload.updated_at || now();

  let importId;
  let action;
  if (existing) {
    importId = existing.id;
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
    const detailPayload = pickAllowedFields({ ...detail, import_id: importId }, SIMPLE_PUSH_FIELDS.import_details);
    const id = insert('import_details', {
      ...detailPayload,
      account_id: req.accountId,
      import_id: importId,
      quantity: Number(detailPayload.quantity) || 0,
      import_price: Number(detailPayload.import_price) || 0,
      line_total: Number(detailPayload.line_total) || ((Number(detailPayload.quantity) || 0) * (Number(detailPayload.import_price) || 0)),
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

  const invoiceCode = payload.invoice_code || `SYNC-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const exists = getOne('invoices', invoice => invoice.invoice_code === invoiceCode);
  if (exists) return { id: exists.id, invoice_code: invoiceCode, action: 'skipped_existing' };

  const invoiceId = insert('invoices', {
    account_id: req.accountId,
    invoice_code: invoiceCode,
    customer_id: payload.customer_id || null,
    user_id: req.user.id,
    subtotal: Number(payload.subtotal) || 0,
    vat_percent: Number(payload.vat_percent) || 0,
    vat_amount: Number(payload.vat_amount) || 0,
    discount_amount: Number(payload.discount_amount) || 0,
    discount_percent: Number(payload.discount_percent) || 0,
    total: Number(payload.total) || 0,
    paid_amount: Number(payload.paid_amount) || 0,
    change_amount: Number(payload.change_amount) || 0,
    remaining_amount: Number(payload.remaining_amount) || 0,
    delivery_fee: Number(payload.delivery_fee) || 0,
    payment_method: payload.payment_method || 'cash',
    note: payload.note || 'Đơn đồng bộ từ thiết bị',
    invoice_writer: payload.invoice_writer || req.user.name || '',
    receiver_name: payload.receiver_name || '',
    delivery_date: payload.delivery_date || null,
    status: payload.status || 'pending',
    created_at: payload.created_at || now(),
    updated_at: now(),
  });

  for (const detail of details) {
    const displayFields = resolveInvoiceDetailDisplayFields(detail, id => getOne('products', product => Number(product.id) === Number(id)));
    insert('invoice_details', {
      account_id: req.accountId,
      invoice_id: invoiceId,
      type: detail.type || detail.item_type || (detail.combo_id ? 'combo' : 'product'),
      item_type: detail.item_type || detail.type || (detail.combo_id ? 'combo' : 'product'),
      combo_id: detail.combo_id || null,
      product_id: detail.product_id || null,
      variant_id: displayFields.variant_id || detail.variant_id || null,
      product_name: displayFields.product_name,
      product_sku: displayFields.product_sku,
      name: displayFields.name,
      sku: displayFields.sku,
      quantity: Number(detail.quantity) || 1,
      unit_price: Number(detail.unit_price) || 0,
      import_price: Number(detail.import_price) || 0,
      discount_amount: Number(detail.discount_amount) || 0,
      discount_percent: Number(detail.discount_percent) || 0,
      line_total: Number(detail.line_total) || ((Number(detail.quantity) || 1) * (Number(detail.unit_price) || 0)),
      created_at: detail.created_at || now(),
      updated_at: now(),
    });
  }

  return { id: invoiceId, invoice_code: invoiceCode, action: 'created_pending' };
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
    data[table] = cloneRows(getAll(table));
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

router.post('/sync/push', requireAuth, requirePermission('sync.write'), (req, res) => {
  const body = req.body || {};
  const pending = body.pending || body;
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
    const result = upsertCustomerFromSync(customer, req);
    if (result) customers.push(result);
  }

  for (const partner of partnerInputs) {
    const result = upsertSimpleRowFromSync('partners', partner, req);
    if (result) partners.push(result);
  }

  for (const category of categoryInputs) {
    const result = upsertSimpleRowFromSync('product_categories', category, req);
    if (result) product_categories.push(result);
  }

  for (const product of productInputs) {
    const result = upsertSimpleRowFromSync('products', product, req);
    if (result) products.push(result);
  }

  for (const imp of importInputs) {
    const result = upsertImportFromSync(imp, req);
    if (result) imports.push(result);
  }

  for (const importLog of importLogInputs) {
    const result = upsertSimpleRowFromSync('import_logs', importLog, req);
    if (result) import_logs.push(result);
  }

  for (const importDetail of importDetailInputs) {
    const result = upsertSimpleRowFromSync('import_details', importDetail, req);
    if (result) import_details.push(result);
  }

  for (const order of orderInputs) {
    const result = createPendingOrderFromSync(order, req);
    if (result) orders.push(result);
  }

  const supportedKeys = ['customers', 'orders', 'partners', 'products', 'product_categories', 'imports', 'import_logs', 'import_details'];
  const unsupported = Object.keys(pending).filter(key => !supportedKeys.includes(key));
  res.json({
    ok: true,
    accepted: { customers, orders, partners, products, product_categories, imports, import_logs, import_details },
    unsupported,
    message: unsupported.length > 0
      ? 'Server đã nhận các nhóm dữ liệu chính; các khóa chưa hỗ trợ được bỏ qua để tránh mất dữ liệu.'
      : 'Đồng bộ push dữ liệu chính hoàn tất.',
    syncVersions: getSyncVersions(req.accountId),
    serverTime: now(),
  });
});

module.exports = router;
