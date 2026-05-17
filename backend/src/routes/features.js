const express = require('express');
const {
  getAll,
  getOne,
  insert,
  update,
  remove,
  now,
  auditLog,
} = require('../db/database');
const { requireAuth, requirePermission, requireAnyPermission } = require('../middleware/auth');

const router = express.Router();

const FEATURE_TABLE = 'feature_catalog';
const ENTITLEMENT_TABLE = 'feature_entitlements';
const CUSTOMER_TABLE = 'license_customers';
const LICENSE_TABLE = 'license_keys';

const canReadFeatures = requireAnyPermission(['features.read', 'features.manage']);
const canManageFeatures = requirePermission('features.manage');

function cleanText(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseBooleanFlag(value, fallback = 1) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;
  const normalized = cleanText(value, 20).toLowerCase();
  if (['true', 'yes', 'y', 'on', 'active', 'enabled'].includes(normalized)) return 1;
  if (['false', 'no', 'n', 'off', 'inactive', 'disabled'].includes(normalized)) return 0;
  return fallback;
}

function normalizeFeatureKey(value) {
  return cleanText(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseJsonObject(value, fallback = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (_err) {
      return fallback;
    }
  }
  return fallback;
}

function parseIsoDateOrNull(value) {
  const raw = cleanText(value, 80);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function serializeFeature(row) {
  if (!row) return null;
  const featureKey = cleanText(row.feature_key || row.key || row.code, 100);
  return {
    id: row.id,
    feature_key: featureKey,
    key: featureKey,
    name: cleanText(row.name, 200),
    description: cleanText(row.description, 2000),
    category: cleanText(row.category, 120),
    active: row.active === undefined ? true : row.active !== 0,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    deleted_at: row.deleted_at || null,
  };
}

function serializeCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: cleanText(row.name || row.customer_name, 200),
    email: cleanText(row.email, 200),
    phone: cleanText(row.phone, 80),
    company: cleanText(row.company, 200),
    active: row.active === undefined ? true : row.active !== 0,
  };
}

function serializeLicense(row) {
  if (!row) return null;
  return {
    id: row.id,
    customer_id: row.customer_id || null,
    license_key: cleanText(row.license_key || row.key, 200),
    key: cleanText(row.license_key || row.key, 200),
    status: cleanText(row.status, 60),
    active: row.active === undefined ? true : row.active !== 0,
    expires_at: row.expires_at || null,
  };
}

function serializeEntitlement(row) {
  if (!row) return null;
  const feature = getOne(FEATURE_TABLE, item => Number(item.id) === Number(row.feature_id), { skipAccountScope: true });
  const customer = row.customer_id
    ? getOne(CUSTOMER_TABLE, item => Number(item.id) === Number(row.customer_id), { skipAccountScope: true })
    : null;
  const license = row.license_key_id
    ? getOne(LICENSE_TABLE, item => Number(item.id) === Number(row.license_key_id), { skipAccountScope: true })
    : null;

  return {
    id: row.id,
    feature_id: row.feature_id || null,
    feature: serializeFeature(feature),
    customer_id: row.customer_id || null,
    customer: serializeCustomer(customer),
    license_key_id: row.license_key_id || null,
    license_key: serializeLicense(license),
    enabled: row.enabled === undefined ? row.active !== 0 : row.enabled !== 0,
    active: row.active === undefined ? true : row.active !== 0,
    expires_at: row.expires_at || null,
    limits: row.limits && typeof row.limits === 'object' ? row.limits : {},
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    deleted_at: row.deleted_at || null,
  };
}

function findFeatureByIdOrKey(value) {
  const id = parseId(value);
  if (id) {
    return getOne(FEATURE_TABLE, row => Number(row.id) === id, { skipAccountScope: true });
  }
  const key = normalizeFeatureKey(value);
  if (!key) return null;
  return getOne(FEATURE_TABLE, row => cleanText(row.feature_key || row.key || row.code, 100).toLowerCase() === key, { skipAccountScope: true });
}

function buildFeaturePayload(body = {}, { partial = false } = {}) {
  const rawKey = body.feature_key ?? body.key ?? body.code;
  const featureKey = normalizeFeatureKey(rawKey);
  const name = cleanText(body.name, 200);

  if (!partial && !featureKey) return { error: 'Vui lòng nhập mã tính năng.' };
  if (!partial && !name) return { error: 'Vui lòng nhập tên tính năng.' };
  if (rawKey !== undefined && !featureKey) return { error: 'Mã tính năng không hợp lệ.' };
  if (body.name !== undefined && !name) return { error: 'Tên tính năng không hợp lệ.' };

  const value = {};
  if (rawKey !== undefined) value.feature_key = featureKey;
  if (body.name !== undefined) value.name = name;
  if (body.description !== undefined) value.description = cleanText(body.description, 2000);
  if (body.category !== undefined) value.category = cleanText(body.category, 120);
  if (body.active !== undefined) value.active = parseBooleanFlag(body.active, 1);
  if (body.metadata !== undefined) value.metadata = parseJsonObject(body.metadata, {});

  return { value };
}

function buildEntitlementPayload(body = {}, { partial = false } = {}) {
  const feature = body.feature_id || body.feature_key || body.key
    ? findFeatureByIdOrKey(body.feature_id || body.feature_key || body.key)
    : null;
  const customerId = parseId(body.customer_id);
  const licenseKeyId = parseId(body.license_key_id || body.license_id);

  if (!partial && !feature) return { error: 'Vui lòng chọn tính năng hợp lệ.' };
  if (!partial && !customerId && !licenseKeyId) return { error: 'Vui lòng chọn khách hàng hoặc license key.' };
  if ((body.feature_id || body.feature_key || body.key) && !feature) return { error: 'Tính năng không tồn tại.' };
  if ((body.customer_id !== undefined) && !customerId) return { error: 'Khách hàng không hợp lệ.' };
  if ((body.license_key_id !== undefined || body.license_id !== undefined) && !licenseKeyId) return { error: 'License key không hợp lệ.' };

  const value = {};
  if (feature) value.feature_id = feature.id;
  if (body.customer_id !== undefined) value.customer_id = customerId;
  if (body.license_key_id !== undefined || body.license_id !== undefined) value.license_key_id = licenseKeyId;
  if (body.enabled !== undefined) {
    value.enabled = parseBooleanFlag(body.enabled, 1);
    value.active = value.enabled;
  }
  if (body.active !== undefined) value.active = parseBooleanFlag(body.active, 1);
  if (body.expires_at !== undefined) value.expires_at = parseIsoDateOrNull(body.expires_at);
  if (body.limits !== undefined) value.limits = parseJsonObject(body.limits, {});
  if (body.metadata !== undefined) value.metadata = parseJsonObject(body.metadata, {});

  return { value };
}

function findExistingEntitlement({ feature_id, customer_id = null, license_key_id = null }) {
  return getOne(ENTITLEMENT_TABLE, row => {
    if (!row || row.deleted_at) return false;
    if (Number(row.feature_id) !== Number(feature_id)) return false;
    const rowCustomerId = Number(row.customer_id) || null;
    const rowLicenseKeyId = Number(row.license_key_id) || null;
    return rowCustomerId === (Number(customer_id) || null) && rowLicenseKeyId === (Number(license_key_id) || null);
  }, { skipAccountScope: true });
}

router.use(requireAuth);

router.get('/', canReadFeatures, (req, res) => {
  const includeInactive = parseBooleanFlag(req.query.include_inactive, 0) === 1;
  const items = getAll(FEATURE_TABLE, row => row && !row.deleted_at && (includeInactive || row.active !== 0), { skipAccountScope: true })
    .map(serializeFeature)
    .sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.feature_key.localeCompare(b.feature_key));
  res.json({ ok: true, items, data: items });
});

router.post('/', canManageFeatures, (req, res) => {
  const parsed = buildFeaturePayload(req.body || {});
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  const duplicate = getOne(FEATURE_TABLE, row => !row.deleted_at && cleanText(row.feature_key, 100).toLowerCase() === parsed.value.feature_key, { skipAccountScope: true });
  if (duplicate) return res.status(409).json({ ok: false, error: 'Mã tính năng đã tồn tại.' });

  const id = insert(FEATURE_TABLE, {
    feature_key: parsed.value.feature_key,
    name: parsed.value.name,
    description: parsed.value.description || '',
    category: parsed.value.category || '',
    active: parsed.value.active === undefined ? 1 : parsed.value.active,
    metadata: parsed.value.metadata || {},
    created_at: now(),
    updated_at: now(),
  });
  auditLog('feature_created', { userId: req.user?.id || null, featureId: id, featureKey: parsed.value.feature_key });
  const item = serializeFeature(getOne(FEATURE_TABLE, row => Number(row.id) === Number(id), { skipAccountScope: true }));
  res.status(201).json({ ok: true, item, data: item });
});

router.get('/entitlements', canReadFeatures, (req, res) => {
  const featureId = parseId(req.query.feature_id);
  const customerId = parseId(req.query.customer_id);
  const licenseKeyId = parseId(req.query.license_key_id || req.query.license_id);
  const includeInactive = parseBooleanFlag(req.query.include_inactive, 0) === 1;
  const items = getAll(ENTITLEMENT_TABLE, row => {
    if (!row || row.deleted_at) return false;
    if (!includeInactive && row.active === 0) return false;
    if (featureId && Number(row.feature_id) !== featureId) return false;
    if (customerId && Number(row.customer_id) !== customerId) return false;
    if (licenseKeyId && Number(row.license_key_id) !== licenseKeyId) return false;
    return true;
  }, { skipAccountScope: true }).map(serializeEntitlement);
  res.json({ ok: true, items, data: items });
});

router.post('/entitlements', canManageFeatures, (req, res) => {
  const parsed = buildEntitlementPayload(req.body || {});
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  const payload = {
    feature_id: parsed.value.feature_id,
    customer_id: parsed.value.customer_id || null,
    license_key_id: parsed.value.license_key_id || null,
    enabled: parsed.value.enabled === undefined ? 1 : parsed.value.enabled,
    active: parsed.value.active === undefined ? (parsed.value.enabled === 0 ? 0 : 1) : parsed.value.active,
    expires_at: parsed.value.expires_at || null,
    limits: parsed.value.limits || {},
    metadata: parsed.value.metadata || {},
  };

  const existing = findExistingEntitlement(payload);
  if (existing) {
    update(ENTITLEMENT_TABLE, existing.id, { ...payload, updated_at: now(), deleted_at: null });
    auditLog('feature_entitlement_updated', { userId: req.user?.id || null, entitlementId: existing.id, featureId: payload.feature_id });
    const item = serializeEntitlement(getOne(ENTITLEMENT_TABLE, row => Number(row.id) === Number(existing.id), { skipAccountScope: true }));
    return res.json({ ok: true, item, data: item });
  }

  const id = insert(ENTITLEMENT_TABLE, { ...payload, created_at: now(), updated_at: now() });
  auditLog('feature_entitlement_created', { userId: req.user?.id || null, entitlementId: id, featureId: payload.feature_id });
  const item = serializeEntitlement(getOne(ENTITLEMENT_TABLE, row => Number(row.id) === Number(id), { skipAccountScope: true }));
  return res.status(201).json({ ok: true, item, data: item });
});

router.post('/entitlements/bulk-enable', canManageFeatures, (req, res) => {
  const feature = findFeatureByIdOrKey(req.body?.feature_id || req.body?.feature_key || req.body?.key);
  if (!feature || feature.deleted_at || feature.active === 0) {
    return res.status(400).json({ ok: false, error: 'Vui lòng chọn tính năng đang hoạt động.' });
  }

  const onlyActiveCustomers = parseBooleanFlag(req.body?.only_active_customers, 1) === 1;
  const expiresAt = req.body?.expires_at !== undefined ? parseIsoDateOrNull(req.body.expires_at) : null;
  const limits = parseJsonObject(req.body?.limits, {});
  const metadata = parseJsonObject(req.body?.metadata, {});
  let created = 0;
  let updated = 0;

  const customers = getAll(CUSTOMER_TABLE, row => row && !row.deleted_at && (!onlyActiveCustomers || row.active !== 0), { skipAccountScope: true });
  for (const customer of customers) {
    const existing = findExistingEntitlement({ feature_id: feature.id, customer_id: customer.id, license_key_id: null });
    if (existing) {
      update(ENTITLEMENT_TABLE, existing.id, {
        enabled: 1,
        active: 1,
        expires_at: expiresAt,
        limits,
        metadata,
        updated_at: now(),
        deleted_at: null,
      });
      updated += 1;
    } else {
      insert(ENTITLEMENT_TABLE, {
        feature_id: feature.id,
        customer_id: customer.id,
        license_key_id: null,
        enabled: 1,
        active: 1,
        expires_at: expiresAt,
        limits,
        metadata,
        created_at: now(),
        updated_at: now(),
      });
      created += 1;
    }
  }

  auditLog('feature_bulk_enabled', { userId: req.user?.id || null, featureId: feature.id, created, updated });
  res.json({ ok: true, created, updated, total: created + updated });
});

router.get('/entitlements/:id', canReadFeatures, (req, res) => {
  const id = parseId(req.params.id);
  const row = id ? getOne(ENTITLEMENT_TABLE, item => Number(item.id) === id && !item.deleted_at, { skipAccountScope: true }) : null;
  if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy quyền tính năng.' });
  const item = serializeEntitlement(row);
  res.json({ ok: true, item, data: item });
});

router.patch('/entitlements/:id', canManageFeatures, (req, res) => {
  const id = parseId(req.params.id);
  const row = id ? getOne(ENTITLEMENT_TABLE, item => Number(item.id) === id && !item.deleted_at, { skipAccountScope: true }) : null;
  if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy quyền tính năng.' });

  const parsed = buildEntitlementPayload(req.body || {}, { partial: true });
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  update(ENTITLEMENT_TABLE, row.id, { ...parsed.value, updated_at: now() });
  auditLog('feature_entitlement_updated', { userId: req.user?.id || null, entitlementId: row.id, changes: parsed.value });
  const item = serializeEntitlement(getOne(ENTITLEMENT_TABLE, itemRow => Number(itemRow.id) === Number(row.id), { skipAccountScope: true }));
  res.json({ ok: true, item, data: item });
});

router.delete('/entitlements/:id', canManageFeatures, (req, res) => {
  const id = parseId(req.params.id);
  const row = id ? getOne(ENTITLEMENT_TABLE, item => Number(item.id) === id && !item.deleted_at, { skipAccountScope: true }) : null;
  if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy quyền tính năng.' });

  update(ENTITLEMENT_TABLE, row.id, { enabled: 0, active: 0, deleted_at: now(), updated_at: now() });
  auditLog('feature_entitlement_deleted_soft', { userId: req.user?.id || null, entitlementId: row.id });
  res.json({ ok: true });
});

router.get('/:id', canReadFeatures, (req, res) => {
  const feature = findFeatureByIdOrKey(req.params.id);
  if (!feature || feature.deleted_at) return res.status(404).json({ ok: false, error: 'Không tìm thấy tính năng.' });
  const item = serializeFeature(feature);
  res.json({ ok: true, item, data: item });
});

router.patch('/:id', canManageFeatures, (req, res) => {
  const feature = findFeatureByIdOrKey(req.params.id);
  if (!feature || feature.deleted_at) return res.status(404).json({ ok: false, error: 'Không tìm thấy tính năng.' });

  const parsed = buildFeaturePayload(req.body || {}, { partial: true });
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  if (parsed.value.feature_key && parsed.value.feature_key !== cleanText(feature.feature_key, 100).toLowerCase()) {
    const duplicate = getOne(FEATURE_TABLE, row => !row.deleted_at && Number(row.id) !== Number(feature.id) && cleanText(row.feature_key, 100).toLowerCase() === parsed.value.feature_key, { skipAccountScope: true });
    if (duplicate) return res.status(409).json({ ok: false, error: 'Mã tính năng đã tồn tại.' });
  }

  update(FEATURE_TABLE, feature.id, { ...parsed.value, updated_at: now() });
  auditLog('feature_updated', { userId: req.user?.id || null, featureId: feature.id, changes: parsed.value });
  const item = serializeFeature(getOne(FEATURE_TABLE, row => Number(row.id) === Number(feature.id), { skipAccountScope: true }));
  res.json({ ok: true, item, data: item });
});

router.delete('/:id', canManageFeatures, (req, res) => {
  const feature = findFeatureByIdOrKey(req.params.id);
  if (!feature || feature.deleted_at) return res.status(404).json({ ok: false, error: 'Không tìm thấy tính năng.' });

  const hard = parseBooleanFlag(req.query.hard, 0) === 1;
  if (hard) {
    remove(FEATURE_TABLE, feature.id);
    auditLog('feature_deleted', { userId: req.user?.id || null, featureId: feature.id });
  } else {
    update(FEATURE_TABLE, feature.id, { active: 0, deleted_at: now(), updated_at: now() });
    auditLog('feature_deleted_soft', { userId: req.user?.id || null, featureId: feature.id });
  }
  res.json({ ok: true });
});

module.exports = router;
