const express = require('express');
const router = express.Router();
const {
  getAll,
  getOne,
  update,
  now,
  getAccountById,
  getDefaultAccount,
  getUserPermissions,
  getSyncVersions,
} = require('../db/database');
const { hashPassword, verifyPassword, isPasswordHash } = require('../utils/password');
const {
  createSession,
  publicSession,
  revokeSession,
  requireAuth,
  requirePermission,
  requireAdmin,
  logAuthEvent,
} = require('../middleware/auth');
const {
  getMobileDownloadUrls,
  createMobileInstallLink,
  resolveMobileInstallLink,
  publicInstallLink,
  registerOrUpdateMobileDevice,
  resolveRequestMobileDevice,
  touchMobileDeviceFromRequest,
  listMobileDevices,
  revokeMobileDevice,
  publicMobileDevice,
  processMobileInvoicePush,
  buildMobileSyncStatus,
} = require('../services/mobileSyncService');

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function normalizeIdentifier(value) {
  return String(value || '').toLowerCase().trim();
}

function isActiveUser(user) {
  return user && user.active !== 0;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    account_id: user.account_id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    approved: user.approved === undefined ? 1 : user.approved,
    active: user.active === undefined ? 1 : user.active,
    mobile_enabled: user.mobile_enabled === undefined ? true : user.mobile_enabled !== false && user.mobile_enabled !== 0,
    created_at: user.created_at,
    updated_at: user.updated_at,
    last_login: user.last_login || null,
    mobile_last_login_at: user.mobile_last_login_at || null,
  };
}

function publicAccount(account) {
  if (!account) return null;
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

function findLoginUser(identifier) {
  const normalized = normalizeIdentifier(identifier);
  return getOne('users', user => {
    if (!isActiveUser(user)) return false;
    return normalizeEmail(user.email) === normalized || String(user.phone || '').trim().toLowerCase() === normalized;
  }, { skipAccountScope: true });
}

function buildLoginSessionDevice(body = {}) {
  const device = body.device && typeof body.device === 'object' ? body.device : {};
  const merged = { ...body, ...device };
  const deviceId = merged.device_id || merged.device_uid || merged.install_id || merged.client_device_id || '';
  return {
    ...merged,
    device_id: deviceId,
    device_uid: merged.device_uid || deviceId,
    device_name: merged.device_name || body.device_name || '',
    platform: merged.platform || body.platform || '',
    app_version: merged.app_version || body.app_version || '',
    push_token: merged.push_token || body.push_token || '',
    user_agent: merged.user_agent || body.user_agent || '',
  };
}

function buildAuthPayload({ token, user, account, session, device }) {
  const permissions = getUserPermissions(user);
  return {
    ok: true,
    token,
    user: publicUser(user),
    account: publicAccount(account || getAccountById(user.account_id)),
    permissions,
    session: publicSession(session),
    device: publicMobileDevice(device),
    syncVersions: getSyncVersions(user.account_id),
    bootstrap: {
      defaultRoute: user.role === 'admin' ? '/settings' : '/',
      syncVersions: getSyncVersions(user.account_id),
    },
    serverTime: now(),
  };
}

function requireMobileSessionDevice(req, res, next) {
  const device = touchMobileDeviceFromRequest(req);
  if (!device) {
    return res.status(403).json({ ok: false, error: 'Phiên mobile chưa đăng ký thiết bị' });
  }
  if (device.active === 0 || device.revoked_at) {
    return res.status(403).json({ ok: false, error: 'Thiết bị mobile đã bị thu hồi quyền truy cập' });
  }
  req.mobileDevice = device;
  return next();
}

function recentInvoices(limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
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

function activeCombos() {
  return getAll('combos', combo => !Object.prototype.hasOwnProperty.call(combo, 'active') || combo.active !== 0)
    .map(combo => ({
      ...combo,
      items: getAll('combo_items', item => Number(item.combo_id) === Number(combo.id)),
    }));
}

function activePrintTemplates() {
  return getAll('print_templates', template => template && template.active !== false && template.active !== 0);
}

function buildBootstrapPayload(req, options = {}) {
  const invoiceLimit = options.invoiceLimit || req.query.invoiceLimit || req.query.invoice_limit || 100;
  const invoiceData = recentInvoices(invoiceLimit);
  return {
    ok: true,
    user: publicUser(req.user),
    account: publicAccount(req.account),
    permissions: req.permissions || [],
    session: publicSession(req.session),
    device: publicMobileDevice(req.mobileDevice || resolveRequestMobileDevice(req)),
    store_info: getAll('store_info')[0] || {},
    products: getAll('products', product => product.active !== 0),
    customers: getAll('customers', customer => customer.active !== 0),
    customer_types: getAll('customer_types', type => type.active !== 0),
    combos: activeCombos(),
    print_templates: activePrintTemplates(),
    recent_invoices: invoiceData.invoices,
    recent_invoice_details: invoiceData.invoice_details,
    syncVersions: getSyncVersions(req.accountId),
    serverTime: now(),
  };
}

function buildPullPayload(req, body = {}) {
  const tables = Array.isArray(body.tables) ? body.tables : [];
  const allowed = {
    store_info: () => getAll('store_info'),
    products: () => getAll('products', product => product.active !== 0),
    customers: () => getAll('customers', customer => customer.active !== 0),
    customer_types: () => getAll('customer_types', type => type.active !== 0),
    combos: () => activeCombos(),
    combo_items: () => getAll('combo_items'),
    print_templates: () => activePrintTemplates(),
    invoices: () => recentInvoices(body.invoiceLimit || body.invoice_limit || 100).invoices,
    invoice_details: () => recentInvoices(body.invoiceLimit || body.invoice_limit || 100).invoice_details,
  };
  const requested = tables.length > 0 ? tables.filter(table => allowed[table]) : Object.keys(allowed);
  const data = {};
  for (const table of requested) data[table] = cloneRows(allowed[table]());
  return {
    ok: true,
    account_id: req.accountId,
    device: publicMobileDevice(req.mobileDevice),
    data,
    syncVersions: getSyncVersions(req.accountId),
    serverTime: now(),
  };
}

function extractPushOrders(body = {}) {
  if (body.action === 'create_invoice' || body.type === 'create_invoice' || body.invoice || body.order) {
    return { single: true, orders: [body] };
  }
  const pending = body.pending && typeof body.pending === 'object' ? body.pending : body;
  const orders = [];
  if (Array.isArray(pending.orders)) orders.push(...pending.orders);
  if (Array.isArray(pending.invoices)) orders.push(...pending.invoices);
  if (Array.isArray(body.orders) && body.orders !== pending.orders) orders.push(...body.orders);
  if (Array.isArray(body.invoices) && body.invoices !== pending.invoices) orders.push(...body.invoices);
  return { single: false, orders };
}

router.post('/auth/login', (req, res) => {
  try {
    const body = req.body || {};
    const identifier = body.email || body.identifier || body.phone;
    const password = body.password;
    if (!identifier || !password) {
      return res.status(400).json({ ok: false, error: 'Vui lòng nhập email/số điện thoại và mật khẩu' });
    }

    const user = findLoginUser(identifier);
    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ ok: false, error: 'Tài khoản hoặc mật khẩu không đúng' });
    }
    if (user.mobile_enabled === false || user.mobile_enabled === 0) {
      return res.status(403).json({ ok: false, error: 'Tài khoản chưa được bật quyền đăng nhập mobile' });
    }

    const passwordChanges = isPasswordHash(user.password) ? {} : { password: hashPassword(password) };
    const account = getAccountById(user.account_id) || getDefaultAccount();
    const sessionUser = { ...user, account_id: account.id };
    const sessionDevice = buildLoginSessionDevice(body);
    const { token, session } = createSession(sessionUser, req, { device: sessionDevice });
    let device;
    try {
      device = registerOrUpdateMobileDevice(req, sessionUser, session, { ...body, ...sessionDevice, device: sessionDevice });
    } catch (deviceErr) {
      revokeSession(session, 'mobile_device_registration_failed');
      throw deviceErr;
    }
    const lastLogin = now();
    update('users', user.id, {
      ...passwordChanges,
      session_token: null,
      last_login: lastLogin,
      mobile_last_login_at: lastLogin,
    });
    logAuthEvent('mobile.auth.login', req, { user_id: user.id, account_id: account.id, session_id: session.id, mobile_device_id: device?.id || null });

    res.json(buildAuthPayload({ token, user: { ...sessionUser, last_login: lastLogin, mobile_last_login_at: lastLogin }, account, session, device }));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

router.get('/install/:token', (req, res) => {
  try {
    const link = resolveMobileInstallLink(req.params.token);
    res.json({ ok: true, link: publicInstallLink(link), urls: getMobileDownloadUrls(), serverTime: now() });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

router.use(requireAuth);

router.post('/auth/logout', (req, res) => {
  revokeSession(req.session, 'mobile_logout');
  logAuthEvent('mobile.auth.logout', req, { user_id: req.user.id, account_id: req.accountId, session_id: req.session.id });
  res.json({ ok: true });
});

router.get('/install-links', requireAdmin, (req, res) => {
  const links = getAll('mobile_install_links', link => Number(link.account_id) === Number(req.accountId), { skipAccountScope: true })
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .map(publicInstallLink);
  res.json({ ok: true, links, urls: getMobileDownloadUrls(), serverTime: now() });
});

router.post('/install-links', requireAdmin, (req, res) => {
  try {
    const link = createMobileInstallLink(req, req.body || {});
    res.status(201).json({ ok: true, link: publicInstallLink(link), urls: getMobileDownloadUrls() });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

router.get('/devices', requireAdmin, (req, res) => {
  res.json({ ok: true, devices: listMobileDevices(req.accountId), serverTime: now() });
});

router.patch('/devices/:id/revoke', requireAdmin, (req, res) => {
  try {
    const result = revokeMobileDevice(req, req.params.id, req.body?.reason || 'admin_revoke');
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

router.patch('/devices/:id', requireAdmin, (req, res) => {
  try {
    if (req.body?.revoke === true || req.body?.active === 0 || req.body?.active === false) {
      const result = revokeMobileDevice(req, req.params.id, req.body?.reason || 'admin_revoke');
      return res.json({ ok: true, ...result });
    }
    return res.status(400).json({ ok: false, error: 'PATCH thiết bị hiện chỉ hỗ trợ revoke/active=false' });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

router.get('/bootstrap', requirePermission('sync.read'), requireMobileSessionDevice, (req, res) => {
  res.json(buildBootstrapPayload(req));
});

router.post('/sync/pull', requirePermission('sync.read'), requireMobileSessionDevice, (req, res) => {
  res.json(buildPullPayload(req, req.body || {}));
});

router.post('/sync/push', requirePermission('sync.write'), requireMobileSessionDevice, (req, res) => {
  const body = req.body || {};
  const { single, orders } = extractPushOrders(body);
  if (orders.length === 0) {
    return res.status(400).json({ ok: false, error: 'Chưa có hóa đơn mobile để push' });
  }

  if (single) {
    try {
      const result = processMobileInvoicePush(orders[0], req, { device: req.mobileDevice });
      return res.json({ ok: true, result, syncVersions: getSyncVersions(req.accountId), serverTime: now() });
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        status: err.mobile_sync_status || (err.status === 409 ? 'conflict' : 'failed'),
        error: err.message,
        details: err.details || null,
        event_id: err.mobile_event_id || null,
        payload_hash: err.payload_hash || '',
        idempotency_key: err.idempotency_key || '',
      });
    }
  }

  const results = [];
  for (const order of orders) {
    try {
      results.push(processMobileInvoicePush(order, req, { device: req.mobileDevice }));
    } catch (err) {
      results.push({
        ok: false,
        status: err.mobile_sync_status || (err.status === 409 ? 'conflict' : 'failed'),
        error: err.message,
        details: err.details || null,
        event_id: err.mobile_event_id || null,
        payload_hash: err.payload_hash || '',
        idempotency_key: err.idempotency_key || '',
      });
    }
  }

  const failed = results.filter(result => result.ok === false).length;
  return res.json({
    ok: failed === 0,
    accepted: { orders: results },
    failed,
    syncVersions: getSyncVersions(req.accountId),
    serverTime: now(),
  });
});

router.get('/sync/status', requirePermission('sync.read'), requireMobileSessionDevice, (req, res) => {
  res.json(buildMobileSyncStatus(req));
});

module.exports = router;
