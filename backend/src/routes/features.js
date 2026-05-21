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
