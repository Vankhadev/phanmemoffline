const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, now, getSyncVersions } = require('../db/database');
const { requireAuth, requirePermission, publicSession } = require('../middleware/auth');
const { resolveInvoiceDetailDisplayFields } = require('../utils/productDisplayName');

const PULL_TABLES = [
  'store_info',
  'products',
  'product_categories',
  'customers',
  'customer_types',
  'partners',
  'combos',
  'combo_items',
  'print_templates',
];

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
    .slice(0, safeLimit);
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
  const requestedTables = Array.isArray(body.tables) && body.tables.length > 0
    ? body.tables.filter(table => PULL_TABLES.includes(table))
    : PULL_TABLES;

  const data = {};
  for (const table of requestedTables) {
    data[table] = cloneRows(getAll(table));
  }

  const invoiceLimit = body.invoiceLimit || body.invoice_limit || 200;
  const invoiceData = recentInvoices(invoiceLimit);
  data.invoices = cloneRows(invoiceData.invoices);
  data.invoice_details = cloneRows(invoiceData.invoice_details);

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

  const customers = [];
  const orders = [];
  for (const customer of customerInputs) {
    const result = upsertCustomerFromSync(customer, req);
    if (result) customers.push(result);
  }

  for (const order of orderInputs) {
    const result = createPendingOrderFromSync(order, req);
    if (result) orders.push(result);
  }

  const unsupported = Object.keys(pending).filter(key => !['customers', 'orders'].includes(key));
  res.json({
    ok: true,
    accepted: { customers, orders },
    unsupported,
    message: unsupported.length > 0
      ? 'Server đã nhận customers/orders tối thiểu; các loại dữ liệu khác chưa được ghi để tránh mất dữ liệu.'
      : 'Đồng bộ push tối thiểu hoàn tất.',
    syncVersions: getSyncVersions(req.accountId),
    serverTime: now(),
  });
});

module.exports = router;
