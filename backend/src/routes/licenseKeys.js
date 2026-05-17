const express = require('express');
const crypto = require('crypto');
const { getAll, getOne, insert, update, remove, now, auditLog } = require('../db/database');
const { requireAuth, requirePermission, requireAnyPermission } = require('../middleware/auth');

const router = express.Router();
const TABLE = 'license_keys';
const CUSTOMER_TABLE = 'license_customers';
const EVENT_TABLE = 'license_events';
const DEFAULT_PREFIX = 'KHA';
const DEFAULT_SOFTWARE_NAME = 'Phần mềm bán hàng offline';
const FEATURE_TABLE = 'feature_catalog';
const ENTITLEMENT_TABLE = 'feature_entitlements';

function normalizeKey(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function cleanText(value, max = 500) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

function parsePositiveInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function toIsoOrNull(value) {
  const parsed = parseDate(value);
  return parsed ? parsed.toISOString() : null;
}

function diffDaysCeil(fromIso, toIso) {
  const from = parseDate(fromIso) || new Date();
  const to = parseDate(toIso);
  if (!to) return null;
  return Math.max(0, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

function buildDurationDays(body = {}) {
  const explicitDays = parsePositiveInt(body.days || body.validity_days || body.duration_days, 0);
  if (explicitDays) return explicitDays;

  const months = parsePositiveInt(body.months, 0);
  if (months) return months * 30;

  const years = parsePositiveInt(body.years, 0);
  if (years) return years * 365;

  const durationType = cleanText(body.duration_type, 50).toLowerCase();
  const durationValue = parsePositiveInt(body.duration_value, 0);
  if (durationValue) {
    if (durationType === 'month' || durationType === 'months') return durationValue * 30;
    if (durationType === 'year' || durationType === 'years') return durationValue * 365;
    return durationValue;
  }

  return 30;
}

function generateLicenseKey(prefix = DEFAULT_PREFIX) {
  const safePrefix = cleanText(prefix || DEFAULT_PREFIX, 12).toUpperCase().replace(/[^A-Z0-9]/g, '') || DEFAULT_PREFIX;
  const chunks = [
    crypto.randomBytes(2).toString('hex'),
    crypto.randomBytes(2).toString('hex'),
    crypto.randomBytes(2).toString('hex'),
    crypto.randomBytes(2).toString('hex'),
  ].map(chunk => chunk.toUpperCase());
  return `${safePrefix}-${chunks.join('-')}`;
}

function uniqueGeneratedKey(prefix) {
  for (let i = 0; i < 20; i += 1) {
    const key = generateLicenseKey(prefix);
    if (!getOne(TABLE, row => normalizeKey(row.license_key) === normalizeKey(key), { skipAccountScope: true })) return key;
  }
  throw new Error('Không thể tạo key không trùng lặp. Vui lòng thử lại.');
}

function computeStatus(row, referenceTime = new Date()) {
  if (!row) return 'invalid';
  if (row.deleted_at) return 'deleted';
  if (row.disabled_at || row.active === 0 || row.status === 'disabled') return 'disabled';

  const nowMs = referenceTime.getTime();
  const availableUntil = parseDate(row.available_until);
  if (!row.activated_at && availableUntil && availableUntil.getTime() <= nowMs) return 'expired';

  const expiresAt = parseDate(row.expires_at);
  if (expiresAt && expiresAt.getTime() <= nowMs) return 'expired';
  if (row.activated_at) return 'active';
  return 'unused';
}

function getCustomerById(customerId) {
  const id = Number(customerId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return getOne(CUSTOMER_TABLE, row => Number(row.id) === id && row.active !== 0, { skipAccountScope: true });
}

function buildCustomerSnapshot(customer, body = {}) {
  return {
    customer_id: customer?.id || null,
    customer_name: cleanText(customer?.name || body.customer_name, 200),
    customer_phone: cleanText(customer?.phone || body.customer_phone || body.phone, 50),
    customer_zalo: cleanText(customer?.zalo || body.customer_zalo || body.zalo || customer?.phone || body.customer_phone || body.phone, 50),
    customer_email: cleanText(customer?.email || body.customer_email || body.email, 120),
  };
}

function serializeCustomer(row) {
  if (!row) return null;
  const keys = getAll(TABLE, item => Number(item.customer_id) === Number(row.id) && !item.deleted_at, { skipAccountScope: true }).map(serializeLicense);
  return {
    ...row,
    active: row.active !== 0,
    key_count: keys.length,
    active_key_count: keys.filter(item => item.status === 'active').length,
    expired_key_count: keys.filter(item => item.status === 'expired').length,
    disabled_key_count: keys.filter(item => item.status === 'disabled').length,
  };
}

function serializeEvent(row) {
  if (!row) return null;
  return {
    ...row,
    meta: row.meta && typeof row.meta === 'object' ? row.meta : {},
  };
}

function serializeLicense(row) {
  if (!row) return null;
  const serverTime = now();
  const status = computeStatus(row, new Date(serverTime));
  const customer = getCustomerById(row.customer_id);
  const daysRemaining = row.expires_at ? diffDaysCeil(serverTime, row.expires_at) : null;
  return {
    ...row,
    key: row.license_key,
    license_key: row.license_key,
    customer: customer ? serializeCustomerBase(customer) : null,
    customer_name: row.customer_name || customer?.name || '',
    customer_phone: row.customer_phone || customer?.phone || '',
    customer_zalo: row.customer_zalo || customer?.zalo || row.customer_phone || customer?.phone || '',
    customer_email: row.customer_email || customer?.email || '',
    software_name: row.software_name || DEFAULT_SOFTWARE_NAME,
    package_name: row.package_name || '',
    purchase_date: row.purchase_date || row.created_at || null,
    start_at: row.start_at || row.activated_at || null,
    validity_days: Number(row.validity_days) || 0,
    reusable: row.reusable === true || row.reusable === 1,
    active: row.active !== 0,
    status,
    days_remaining: daysRemaining,
    is_expiring_soon: Number.isFinite(daysRemaining) && daysRemaining > 0 && daysRemaining <= 7,
    server_time: serverTime,
  };
}

function serializeCustomerBase(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    phone: row.phone || '',
    zalo: row.zalo || row.phone || '',
    email: row.email || '',
    address: row.address || '',
    note: row.note || '',
    active: row.active !== 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function serializeFeature(row) {
  if (!row || row.active === 0 || row.deleted_at) return null;
  return {
    id: row.id,
    key: cleanText(row.feature_key || row.key || row.code, 100),
    feature_key: cleanText(row.feature_key || row.key || row.code, 100),
    name: cleanText(row.name, 200),
    description: cleanText(row.description, 1000),
    category: cleanText(row.category, 120),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    active: row.active !== 0,
  };
}

function getPublicEntitlements(licenseRow) {
  if (!licenseRow) return [];
  const licenseId = Number(licenseRow.id) || null;
  const customerId = Number(licenseRow.customer_id) || null;
  const activeFeatures = getAll(FEATURE_TABLE, row => row && row.active !== 0 && !row.deleted_at, { skipAccountScope: true });
  const featureById = new Map(activeFeatures.map(feature => [Number(feature.id), feature]));
  const matched = getAll(ENTITLEMENT_TABLE, row => {
    if (!row || row.active === 0 || row.enabled === 0 || row.deleted_at) return false;
    const feature = featureById.get(Number(row.feature_id));
    if (!feature) return false;
    const rowLicenseId = Number(row.license_key_id) || null;
    const rowCustomerId = Number(row.customer_id) || null;
    return (licenseId && rowLicenseId === licenseId) || (customerId && !rowLicenseId && rowCustomerId === customerId);
  }, { skipAccountScope: true });

  const byFeature = new Map();
  for (const entitlement of matched) {
    const feature = featureById.get(Number(entitlement.feature_id));
    const serialized = serializeFeature(feature);
    if (!serialized) continue;
    byFeature.set(serialized.feature_key, {
      ...serialized,
      enabled: true,
      scope: entitlement.license_key_id ? 'license_key' : 'customer',
      entitlement_id: entitlement.id,
      expires_at: entitlement.expires_at || null,
      limits: entitlement.limits && typeof entitlement.limits === 'object' ? entitlement.limits : {},
    });
  }
  return Array.from(byFeature.values()).sort((a, b) => a.feature_key.localeCompare(b.feature_key));
}

function publicLicense(row) {
  const item = serializeLicense(row);
  if (!item || item.deleted_at) return null;
  const features = getPublicEntitlements(item);
  return {
    id: item.id,
    key: item.license_key,
    status: item.status,
    validity_days: item.validity_days,
    activated_at: item.activated_at || null,
    expires_at: item.expires_at || null,
    days_remaining: item.days_remaining,
    device_id: item.device_id || '',
    device_name: item.device_name || '',
    features,
    entitlements: features,
    server_time: item.server_time,
  };
}

function addEvent({ licenseKeyId = null, customerId = null, action, message = '', userId = null, meta = {} }) {
  return insert(EVENT_TABLE, {
    license_key_id: licenseKeyId,
    customer_id: customerId,
    event_type: action,
    action,
    user_id: userId,
    message: cleanText(message, 1000),
    meta: meta && typeof meta === 'object' ? meta : {},
    created_at: now(),
  });
}

function findByKey(rawKey) {
  const key = normalizeKey(rawKey);
  return getOne(TABLE, row => !row.deleted_at && normalizeKey(row.license_key) === key, { skipAccountScope: true });
}

function getCurrentActiveKey() {
  const rows = getAll(TABLE, null, { skipAccountScope: true })
    .filter(row => row && !row.deleted_at && row.activated_at && computeStatus(row) === 'active')
    .sort((a, b) => new Date(b.activated_at || 0) - new Date(a.activated_at || 0));
  return rows[0] || null;
}

function validateCustomerPayload(body = {}, { partial = false } = {}) {
  const name = cleanText(body.name, 200);
  const phone = cleanText(body.phone, 50);
  const zalo = cleanText(body.zalo || body.phone, 50);
  const email = cleanText(body.email, 120);
  if (!partial || body.name !== undefined) {
    if (!name) return { error: 'Vui lòng nhập tên khách hàng.' };
  }
  if (!partial || body.phone !== undefined || body.zalo !== undefined) {
    if (!phone && !zalo) return { error: 'Vui lòng nhập số điện thoại hoặc Zalo.' };
  }
  return {
    value: {
      name,
      phone,
      zalo,
      email,
      address: cleanText(body.address, 300),
      note: cleanText(body.note, 1000),
    },
  };
}

function updateLicenseComputedFields(row, changes = {}) {
  const next = { ...row, ...changes };
  if (next.activated_at && !next.start_at) next.start_at = next.activated_at;
  if (next.activated_at && !next.expires_at) next.expires_at = addDays(new Date(next.activated_at), parsePositiveInt(next.validity_days, 30)).toISOString();
  return next;
}

router.get('/status', (_req, res) => {
  try {
    const current = getCurrentActiveKey();
    if (!current) {
      return res.json({ ok: true, activated: false, status: 'missing', license: null, server_time: now() });
    }
    return res.json({ ok: true, activated: true, status: computeStatus(current), license: publicLicense(current), server_time: now() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Không thể kiểm tra trạng thái key', detail: err.message });
  }
});

router.post('/activate', (req, res) => {
  try {
    const rawKey = req.body?.key || req.body?.license_key;
    const key = normalizeKey(rawKey);
    if (!key) return res.status(400).json({ ok: false, code: 'KEY_REQUIRED', error: 'Vui lòng nhập key bản quyền.' });

    const row = findByKey(key);
    if (!row) return res.status(404).json({ ok: false, code: 'KEY_NOT_FOUND', error: 'Key không tồn tại hoặc không chính xác.' });

    const status = computeStatus(row);
    if (status === 'disabled') return res.status(403).json({ ok: false, code: 'KEY_DISABLED', error: 'Key đã bị khóa.' });
    if (status === 'expired') return res.status(410).json({ ok: false, code: 'KEY_EXPIRED', error: 'Key đã hết hạn.' });
    if (row.activated_at && row.reusable !== true && row.reusable !== 1) {
      return res.status(409).json({ ok: false, code: 'KEY_ALREADY_USED', error: 'Key đã được sử dụng.' });
    }

    const activatedAt = row.activated_at || now();
    const validityDays = parsePositiveInt(row.validity_days, 30);
    const expiresAt = row.expires_at || addDays(new Date(activatedAt), validityDays).toISOString();
    const activationCount = (Number(row.activation_count) || 0) + (row.activated_at ? 0 : 1);

    update(TABLE, row.id, updateLicenseComputedFields(row, {
      status: 'active',
      activated_at: activatedAt,
      start_at: row.start_at || activatedAt,
      expires_at: expiresAt,
      activation_count: activationCount,
      device_id: cleanText(req.body?.device_id, 200),
      device_name: cleanText(req.body?.device_name, 200),
      last_checked_at: now(),
      updated_at: now(),
    }));

    addEvent({
      licenseKeyId: row.id,
      customerId: row.customer_id || null,
      action: row.activated_at ? 'check_activate_reused' : 'activated',
      message: row.activated_at ? 'Key được kiểm tra/kích hoạt lại.' : 'Key được kích hoạt lần đầu.',
      meta: { device_id: cleanText(req.body?.device_id, 200), device_name: cleanText(req.body?.device_name, 200) },
    });

    const updated = getOne(TABLE, item => item.id === row.id, { skipAccountScope: true });
    return res.json({ ok: true, activated: true, message: 'Kích hoạt phần mềm thành công.', license: publicLicense(updated), server_time: now() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Không thể kích hoạt key', detail: err.message });
  }
});

const canReadLicenses = requireAnyPermission(['licenses.read', 'licenses.manage']);
const canManageLicenses = requirePermission('licenses.manage');

router.use(requireAuth);

router.get('/', canReadLicenses, (_req, res) => {
  try {
    const keys = getAll(TABLE, row => !row.deleted_at, { skipAccountScope: true })
      .slice()
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .map(serializeLicense);
    return res.json({ ok: true, keys, items: keys, server_time: now() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Không thể tải danh sách key', detail: err.message });
  }
});

router.get('/customers', canReadLicenses, (_req, res) => {
  try {
    const customers = getAll(CUSTOMER_TABLE, row => row.active !== 0, { skipAccountScope: true })
      .slice()
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .map(serializeCustomer);
    return res.json({ ok: true, customers, items: customers, server_time: now() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Không thể tải danh sách khách hàng bản quyền', detail: err.message });
  }
});

router.post('/customers', canManageLicenses, (req, res) => {
  try {
    const validation = validateCustomerPayload(req.body || {});
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });
    const value = validation.value;
    const duplicate = getOne(CUSTOMER_TABLE, row => row.active !== 0 && ((value.phone && row.phone === value.phone) || (value.zalo && row.zalo === value.zalo) || (value.email && row.email && row.email.toLowerCase() === value.email.toLowerCase())), { skipAccountScope: true });
    if (duplicate) return res.status(409).json({ ok: false, error: 'Khách hàng đã tồn tại theo số điện thoại/Zalo/email.' });
    const createdAt = now();
    const id = insert(CUSTOMER_TABLE, { ...value, active: 1, created_by_user_id: req.user?.id || null, created_at: createdAt, updated_at: createdAt });
    addEvent({ customerId: id, action: 'customer_created', message: 'Tạo khách hàng bản quyền.', userId: req.user?.id || null });
    auditLog('license_customer_created', { userId: req.user?.id || null, customerId: id });
    const created = getOne(CUSTOMER_TABLE, row => Number(row.id) === Number(id), { skipAccountScope: true });
    return res.status(201).json({ ok: true, customer: serializeCustomer(created), item: serializeCustomer(created) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Không thể tạo khách hàng bản quyền', detail: err.message });
  }
});

router.get('/customers/:id', canReadLicenses, (req, res) => {
  try {
    const customer = getCustomerById(req.params.id);
    if (!customer) return res.status(404).json({ ok: false, error: 'Không tìm thấy khách hàng.' });
    const keys = getAll(TABLE, row => Number(row.customer_id) === Number(customer.id) && !row.deleted_at, { skipAccountScope: true }).map(serializeLicense);
    const events = getAll(EVENT_TABLE, row => Number(row.customer_id) === Number(customer.id), { skipAccountScope: true }).slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(serializeEvent);
    return res.json({ ok: true, customer: serializeCustomer(customer), keys, events, server_time: now() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Không thể tải chi tiết khách hàng', detail: err.message });
  }
});

router.put('/customers/:id', canManageLicenses, (req, res) => {
  try {
    const customer = getCustomerById(req.params.id);
    if (!customer) return res.status(404).json({ ok: false, error: 'Không tìm thấy khách hàng.' });
    const validation = validateCustomerPayload(req.body || {}, { partial: true });
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });
    const changes = Object.fromEntries(Object.entries(validation.value).filter(([, value]) => value !== ''));
    update(CUSTOMER_TABLE, customer.id, { ...changes, updated_at: now() });
    const updatedCustomer = getCustomerById(customer.id);
    const customerKeys = getAll(TABLE, row => Number(row.customer_id) === Number(customer.id), { skipAccountScope: true });
    for (const key of customerKeys) {
      update(TABLE, key.id, { ...buildCustomerSnapshot(updatedCustomer), updated_at: now() });
    }
    addEvent({ customerId: customer.id, action: 'customer_updated', message: 'Cập nhật khách hàng bản quyền.', userId: req.user?.id || null, meta: changes });
    auditLog('license_customer_updated', { userId: req.user?.id || null, customerId: customer.id, changes });
    return res.json({ ok: true, customer: serializeCustomer(updatedCustomer), item: serializeCustomer(updatedCustomer) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Không thể cập nhật khách hàng', detail: err.message });
  }
});

router.post('/', canManageLicenses, (req, res) => {
  try {
    const body = req.body || {};
    const requestedKey = normalizeKey(body.key || body.license_key);
    const licenseKey = requestedKey || uniqueGeneratedKey(body.prefix);
    if (getOne(TABLE, row => normalizeKey(row.license_key) === normalizeKey(licenseKey), { skipAccountScope: true })) {
      return res.status(409).json({ ok: false, error: 'Key đã tồn tại.' });
    }

    const customer = body.customer_id ? getCustomerById(body.customer_id) : null;
    if (body.customer_id && !customer) return res.status(404).json({ ok: false, error: 'Khách hàng không tồn tại.' });
    if (!customer && !cleanText(body.customer_name, 200)) return res.status(400).json({ ok: false, error: 'Vui lòng chọn hoặc nhập khách hàng cho key.' });

    const validityDays = buildDurationDays(body);
    if (!validityDays || validityDays <= 0) return res.status(400).json({ ok: false, error: 'Thời hạn key không hợp lệ.' });
    const createdAt = now();
    const availableUntil = body.available_until ? parseDate(body.available_until) : null;
    const purchaseDate = toIsoOrNull(body.purchase_date) || createdAt;
    const id = insert(TABLE, {
      license_key: licenseKey,
      ...buildCustomerSnapshot(customer, body),
      software_name: cleanText(body.software_name, 200) || DEFAULT_SOFTWARE_NAME,
      package_name: cleanText(body.package_name, 200),
      purchase_date: purchaseDate,
      validity_days: validityDays,
      status: 'unused',
      activated_at: null,
      start_at: null,
      expires_at: null,
      available_until: availableUntil ? availableUntil.toISOString() : null,
      reusable: body.reusable === true || body.reusable === 1,
      activation_count: 0,
      device_id: '',
      device_name: '',
      note: cleanText(body.note, 1000),
      active: 1,
      disabled_at: null,
      disabled_reason: '',
      deleted_at: null,
      deleted_by_user_id: null,
      created_by_user_id: req.user?.id || null,
      created_at: createdAt,
      updated_at: createdAt,
    });
    addEvent({ licenseKeyId: id, customerId: customer?.id || null, action: 'key_created', message: 'Tạo key bản quyền.', userId: req.user?.id || null, meta: { validity_days: validityDays } });
    auditLog('license_key_created', { userId: req.user?.id || null, licenseKeyId: id, customerId: customer?.id || null });
    const created = getOne(TABLE, row => row.id === id, { skipAccountScope: true });
    return res.status(201).json({ ok: true, key: serializeLicense(created), item: serializeLicense(created) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Không thể tạo key bản quyền', detail: err.message });
  }
});

router.get('/:id', canReadLicenses, (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const row = getOne(TABLE, item => Number(item.id) === id && !item.deleted_at, { skipAccountScope: true });
    if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy key.' });
    const events = getAll(EVENT_TABLE, item => Number(item.license_key_id) === Number(row.id), { skipAccountScope: true }).slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).map(serializeEvent);
    return res.json({ ok: true, key: serializeLicense(row), item: serializeLicense(row), events, server_time: now() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Không thể tải chi tiết key', detail: err.message });
  }
});

router.patch('/:id', canManageLicenses, (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const row = getOne(TABLE, item => Number(item.id) === id && !item.deleted_at, { skipAccountScope: true });
    if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy key.' });
    const body = req.body || {};
    const customer = body.customer_id ? getCustomerById(body.customer_id) : (row.customer_id ? getCustomerById(row.customer_id) : null);
    if (body.customer_id && !customer) return res.status(404).json({ ok: false, error: 'Khách hàng không tồn tại.' });
    const validityDays = body.validity_days || body.days || body.months || body.years || body.duration_value ? buildDurationDays(body) : row.validity_days;
    if (!validityDays || validityDays <= 0) return res.status(400).json({ ok: false, error: 'Thời hạn key không hợp lệ.' });
    const changes = updateLicenseComputedFields(row, {
      ...(body.customer_id !== undefined ? buildCustomerSnapshot(customer, body) : {}),
      software_name: body.software_name !== undefined ? cleanText(body.software_name, 200) || DEFAULT_SOFTWARE_NAME : row.software_name,
      package_name: body.package_name !== undefined ? cleanText(body.package_name, 200) : row.package_name,
      purchase_date: body.purchase_date !== undefined ? toIsoOrNull(body.purchase_date) : row.purchase_date,
      validity_days: validityDays,
      available_until: body.available_until !== undefined ? toIsoOrNull(body.available_until) : row.available_until,
      note: body.note !== undefined ? cleanText(body.note, 1000) : row.note,
      reusable: body.reusable !== undefined ? (body.reusable === true || body.reusable === 1) : row.reusable,
      updated_at: now(),
    });
    update(TABLE, row.id, changes);
    addEvent({ licenseKeyId: row.id, customerId: changes.customer_id || row.customer_id || null, action: 'key_updated', message: 'Cập nhật thông tin key.', userId: req.user?.id || null, meta: body });
    auditLog('license_key_updated', { userId: req.user?.id || null, licenseKeyId: row.id, changes: body });
    const updated = getOne(TABLE, item => item.id === row.id, { skipAccountScope: true });
    return res.json({ ok: true, key: serializeLicense(updated), item: serializeLicense(updated) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Không thể cập nhật key', detail: err.message });
  }
});

router.patch('/:id/renew', canManageLicenses, (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const row = getOne(TABLE, item => Number(item.id) === id && !item.deleted_at, { skipAccountScope: true });
    if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy key.' });
    const addDaysValue = buildDurationDays(req.body || {});
    if (!addDaysValue || addDaysValue <= 0) return res.status(400).json({ ok: false, error: 'Số ngày gia hạn không hợp lệ.' });
    const baseDate = parseDate(row.expires_at);
    const nowDate = new Date();
    const renewFrom = baseDate && baseDate.getTime() > nowDate.getTime() ? baseDate : nowDate;
    const expiresAt = addDays(renewFrom, addDaysValue).toISOString();
    update(TABLE, row.id, {
      validity_days: (Number(row.validity_days) || 0) + addDaysValue,
      expires_at: row.activated_at ? expiresAt : row.expires_at,
      active: 1,
      disabled_at: null,
      disabled_reason: '',
      status: row.activated_at ? 'active' : 'unused',
      note: req.body?.note !== undefined ? cleanText(req.body.note, 1000) : row.note,
      updated_at: now(),
    });
    addEvent({ licenseKeyId: row.id, customerId: row.customer_id || null, action: 'key_renewed', message: `Gia hạn thêm ${addDaysValue} ngày.`, userId: req.user?.id || null, meta: { add_days: addDaysValue, expires_at: expiresAt } });
    auditLog('license_key_renewed', { userId: req.user?.id || null, licenseKeyId: row.id, addDays: addDaysValue, expiresAt });
    const updated = getOne(TABLE, item => item.id === row.id, { skipAccountScope: true });
    return res.json({ ok: true, key: serializeLicense(updated), item: serializeLicense(updated) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Không thể gia hạn key', detail: err.message });
  }
});

router.patch('/:id/disable', canManageLicenses, (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const row = getOne(TABLE, item => Number(item.id) === id && !item.deleted_at, { skipAccountScope: true });
    if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy key.' });
    const reason = cleanText(req.body?.reason || req.body?.note, 1000);
    update(TABLE, row.id, { active: 0, status: 'disabled', disabled_at: now(), disabled_reason: reason, updated_at: now(), note: req.body?.note !== undefined ? cleanText(req.body.note, 1000) : row.note });
    addEvent({ licenseKeyId: row.id, customerId: row.customer_id || null, action: 'key_disabled', message: reason || 'Khóa/vô hiệu hóa key.', userId: req.user?.id || null });
    auditLog('license_key_disabled', { userId: req.user?.id || null, licenseKeyId: row.id, reason });
    const updated = getOne(TABLE, item => item.id === row.id, { skipAccountScope: true });
    return res.json({ ok: true, key: serializeLicense(updated), item: serializeLicense(updated) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Không thể khóa key', detail: err.message });
  }
});

router.patch('/:id/enable', canManageLicenses, (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const row = getOne(TABLE, item => Number(item.id) === id && !item.deleted_at, { skipAccountScope: true });
    if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy key.' });
    update(TABLE, row.id, { active: 1, status: row.activated_at ? 'active' : 'unused', disabled_at: null, disabled_reason: '', updated_at: now() });
    addEvent({ licenseKeyId: row.id, customerId: row.customer_id || null, action: 'key_enabled', message: cleanText(req.body?.note, 1000) || 'Mở khóa key.', userId: req.user?.id || null });
    auditLog('license_key_enabled', { userId: req.user?.id || null, licenseKeyId: row.id });
    const updated = getOne(TABLE, item => item.id === row.id, { skipAccountScope: true });
    return res.json({ ok: true, key: serializeLicense(updated), item: serializeLicense(updated) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Không thể mở khóa key', detail: err.message });
  }
});

router.delete('/:id', canManageLicenses, (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const row = getOne(TABLE, item => Number(item.id) === id && !item.deleted_at, { skipAccountScope: true });
    if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy key.' });
    if (row.activated_at || Number(row.activation_count) > 0) {
      update(TABLE, row.id, { deleted_at: now(), deleted_by_user_id: req.user?.id || null, active: 0, status: 'disabled', disabled_at: row.disabled_at || now(), updated_at: now() });
      addEvent({ licenseKeyId: row.id, customerId: row.customer_id || null, action: 'key_deleted_soft', message: 'Xóa mềm key đã từng kích hoạt.', userId: req.user?.id || null });
      auditLog('license_key_deleted_soft', { userId: req.user?.id || null, licenseKeyId: row.id });
      return res.json({ ok: true, deleted: true, soft: true });
    }
    addEvent({ licenseKeyId: row.id, customerId: row.customer_id || null, action: 'key_deleted', message: 'Xóa key chưa kích hoạt.', userId: req.user?.id || null });
    auditLog('license_key_deleted', { userId: req.user?.id || null, licenseKeyId: row.id });
    remove(TABLE, row.id);
    return res.json({ ok: true, deleted: true, soft: false });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Không thể xóa key', detail: err.message });
  }
});

module.exports = router;
