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
const { verifyReleaseReadiness } = require('../utils/systemVerification');

const TABLE = 'update_releases';

const canReadUpdates = requireAnyPermission(['updates.read', 'updates.manage']);
const canManageUpdates = requirePermission('updates.manage');

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
  if (['true', 'yes', 'y', 'on', 'active', 'enabled', 'published'].includes(normalized)) return 1;
  if (['false', 'no', 'n', 'off', 'inactive', 'disabled', 'draft'].includes(normalized)) return 0;
  return fallback;
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

function parseList(value) {
  if (Array.isArray(value)) {
    return value.map(item => cleanText(item, 1000)).filter(Boolean);
  }
  const raw = cleanText(value, 5000);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(item => cleanText(item, 1000)).filter(Boolean);
  } catch (_err) {
    // Fall through to line/comma split.
  }
  return raw.split(/\r?\n|,/).map(item => cleanText(item, 1000)).filter(Boolean);
}

function parseIsoDateOrNull(value) {
  const raw = cleanText(value, 80);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizePlatform(value) {
  const raw = cleanText(value, 60).toLowerCase();
  if (!raw || raw === 'all' || raw === '*') return 'all';
  return raw.replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'all';
}

function normalizeChannel(value) {
  const raw = cleanText(value, 60).toLowerCase();
  if (!raw) return 'stable';
  return raw.replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'stable';
}

function compareVersions(left, right) {
  const a = cleanText(left, 80).replace(/^v/i, '').split(/[.-]/).map(part => Number.parseInt(part, 10));
  const b = cleanText(right, 80).replace(/^v/i, '').split(/[.-]/).map(part => Number.parseInt(part, 10));
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const av = Number.isFinite(a[i]) ? a[i] : 0;
    const bv = Number.isFinite(b[i]) ? b[i] : 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function serializeRelease(row, { publicOnly = false } = {}) {
  if (!row) return null;
  const item = {
    id: row.id,
    version: cleanText(row.version, 80),
    title: cleanText(row.title, 200),
    notes: cleanText(row.notes, 10000),
    changelog: Array.isArray(row.changelog) ? row.changelog.map(item => cleanText(item, 1000)).filter(Boolean) : parseList(row.changelog),
    platform: normalizePlatform(row.platform),
    channel: normalizeChannel(row.channel),
    download_url: cleanText(row.download_url || row.url, 2000),
    installer_url: cleanText(row.installer_url, 2000),
    checksum: cleanText(row.checksum || row.sha512 || row.sha256, 512),
    sha512: cleanText(row.sha512 || row.checksum, 512),
    size: Number(row.size) || 0,
    minimum_version: cleanText(row.minimum_version || row.min_version, 80),
    mandatory: row.mandatory === undefined ? false : row.mandatory !== 0,
    published: row.published === undefined ? row.active !== 0 : row.published !== 0,
    active: row.active === undefined ? true : row.active !== 0,
    published_at: row.published_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
  if (!publicOnly) {
    item.metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    item.deleted_at = row.deleted_at || null;
  }
  return item;
}

function isReleasePublic(row) {
  return row && !row.deleted_at && row.active !== 0 && row.published !== 0;
}

function findLatestRelease({ platform = 'all', channel = 'stable' } = {}) {
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedChannel = normalizeChannel(channel);
  const candidates = getAll(TABLE, row => {
    if (!isReleasePublic(row)) return false;
    const rowPlatform = normalizePlatform(row.platform);
    const rowChannel = normalizeChannel(row.channel);
    return (rowPlatform === 'all' || rowPlatform === normalizedPlatform) && rowChannel === normalizedChannel;
  }, { skipAccountScope: true });

  return candidates.sort((a, b) => {
    const byVersion = compareVersions(b.version, a.version);
    if (byVersion !== 0) return byVersion;
    return String(b.published_at || b.updated_at || b.created_at || '').localeCompare(String(a.published_at || a.updated_at || a.created_at || ''));
  })[0] || null;
}

function buildReleasePayload(body = {}, { partial = false } = {}) {
  const version = cleanText(body.version, 80);
  const title = cleanText(body.title, 200);
  const downloadUrl = cleanText(body.download_url || body.url, 2000);

  if (!partial && !version) return { error: 'Vui lòng nhập phiên bản cập nhật.' };
  if (body.version !== undefined && !version) return { error: 'Phiên bản cập nhật không hợp lệ.' };
  if (!partial && !title) return { error: 'Vui lòng nhập tiêu đề bản cập nhật.' };
  if (body.title !== undefined && !title) return { error: 'Tiêu đề bản cập nhật không hợp lệ.' };
  if (!partial && !downloadUrl) return { error: 'Vui lòng nhập đường dẫn tải bản cập nhật.' };
  if ((body.download_url !== undefined || body.url !== undefined) && !downloadUrl) return { error: 'Đường dẫn tải bản cập nhật không hợp lệ.' };

  const value = {};
  if (body.version !== undefined) value.version = version;
  if (body.title !== undefined) value.title = title;
  if (body.notes !== undefined) value.notes = cleanText(body.notes, 10000);
  if (body.changelog !== undefined) value.changelog = parseList(body.changelog);
  if (body.platform !== undefined) value.platform = normalizePlatform(body.platform);
  if (body.channel !== undefined) value.channel = normalizeChannel(body.channel);
  if (body.download_url !== undefined || body.url !== undefined) value.download_url = downloadUrl;
  if (body.installer_url !== undefined) value.installer_url = cleanText(body.installer_url, 2000);
  if (body.checksum !== undefined || body.sha512 !== undefined || body.sha256 !== undefined) {
    value.checksum = cleanText(body.checksum || body.sha512 || body.sha256, 512);
    value.sha512 = cleanText(body.sha512 || body.checksum, 512);
  }
  if (body.size !== undefined) value.size = Math.max(0, Number(body.size) || 0);
  if (body.minimum_version !== undefined || body.min_version !== undefined) value.minimum_version = cleanText(body.minimum_version || body.min_version, 80);
  if (body.mandatory !== undefined) value.mandatory = parseBooleanFlag(body.mandatory, 0);
  if (body.published !== undefined) {
    value.published = parseBooleanFlag(body.published, 1);
    value.active = value.published;
    if (value.published === 1 && !body.published_at) value.published_at = now();
  }
  if (body.active !== undefined) value.active = parseBooleanFlag(body.active, 1);
  if (body.published_at !== undefined) value.published_at = parseIsoDateOrNull(body.published_at);
  if (body.metadata !== undefined) value.metadata = parseJsonObject(body.metadata, {});

  return { value };
}

router.get('/latest', (req, res) => {
  const latest = findLatestRelease({ platform: req.query.platform, channel: req.query.channel });
  if (!latest) return res.status(404).json({ ok: false, error: 'Chưa có bản cập nhật phù hợp.' });
  const item = serializeRelease(latest, { publicOnly: true });
  return res.json({ ok: true, item, data: item, update: item, latest: item });
});

router.get('/check', (req, res) => {
  const latest = findLatestRelease({ platform: req.query.platform, channel: req.query.channel });
  if (!latest) return res.json({ ok: true, update_available: false, item: null, data: null });
  const currentVersion = cleanText(req.query.version || req.query.current_version, 80);
  const item = serializeRelease(latest, { publicOnly: true });
  const updateAvailable = currentVersion ? compareVersions(item.version, currentVersion) > 0 : true;
  return res.json({ ok: true, update_available: updateAvailable, item, data: item, update: item, latest: item });
});

router.use(requireAuth);

router.get('/', canReadUpdates, (req, res) => {
  const includeInactive = parseBooleanFlag(req.query.include_inactive, 0) === 1;
  const platform = req.query.platform !== undefined ? normalizePlatform(req.query.platform) : null;
  const channel = req.query.channel !== undefined ? normalizeChannel(req.query.channel) : null;
  const items = getAll(TABLE, row => {
    if (!row || row.deleted_at) return false;
    if (!includeInactive && row.active === 0) return false;
    if (platform && normalizePlatform(row.platform) !== platform) return false;
    if (channel && normalizeChannel(row.channel) !== channel) return false;
    return true;
  }, { skipAccountScope: true })
    .map(row => serializeRelease(row))
    .sort((a, b) => compareVersions(b.version, a.version) || String(b.published_at || b.updated_at || '').localeCompare(String(a.published_at || a.updated_at || '')));
  res.json({ ok: true, items, data: items });
});

router.post('/', canManageUpdates, (req, res) => {
  const parsed = buildReleasePayload(req.body || {});
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  const publishFlag = parsed.value.published === undefined ? 1 : parsed.value.published;
  if (publishFlag === 1) {
    const testResult = verifyReleaseReadiness();
    if (!testResult.ok) {
      const adminAlertService = require('../services/adminAlertService');
      adminAlertService.sendEmergencyAlert('updates', 'PHÁT HÀNH THẤT BẠI: Lỗi kiểm tra tự động trước khi tạo bản cập nhật mới.', {
        errorDetail: testResult.errors.join('\n')
      });
      return res.status(400).json({ ok: false, error: 'Không thể tạo bản phát hành: Lỗi hệ thống tự động kiểm tra trước khi publish.', details: testResult.errors });
    }
  }

  const platform = parsed.value.platform || 'all';
  const channel = parsed.value.channel || 'stable';
  const duplicate = getOne(TABLE, row => !row.deleted_at
    && cleanText(row.version, 80) === parsed.value.version
    && normalizePlatform(row.platform) === platform
    && normalizeChannel(row.channel) === channel, { skipAccountScope: true });
  if (duplicate) return res.status(409).json({ ok: false, error: 'Phiên bản cập nhật đã tồn tại cho nền tảng/kênh này.' });

  const id = insert(TABLE, {
    version: parsed.value.version,
    title: parsed.value.title,
    notes: parsed.value.notes || '',
    changelog: parsed.value.changelog || [],
    platform,
    channel,
    download_url: parsed.value.download_url,
    installer_url: parsed.value.installer_url || '',
    checksum: parsed.value.checksum || '',
    sha512: parsed.value.sha512 || parsed.value.checksum || '',
    size: parsed.value.size || 0,
    minimum_version: parsed.value.minimum_version || '',
    mandatory: parsed.value.mandatory || 0,
    published: publishFlag,
    active: parsed.value.active === undefined ? publishFlag : parsed.value.active,
    published_at: parsed.value.published_at || (publishFlag ? now() : null),
    metadata: parsed.value.metadata || {},
    created_at: now(),
    updated_at: now(),
  });
  auditLog('update_release_created', { userId: req.user?.id || null, releaseId: id, version: parsed.value.version });
  const item = serializeRelease(getOne(TABLE, row => Number(row.id) === Number(id), { skipAccountScope: true }));
  res.status(201).json({ ok: true, item, data: item });
});

router.get('/:id', canReadUpdates, (req, res) => {
  const id = parseId(req.params.id);
  const row = id ? getOne(TABLE, item => Number(item.id) === id && !item.deleted_at, { skipAccountScope: true }) : null;
  if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy bản cập nhật.' });
  const item = serializeRelease(row);
  res.json({ ok: true, item, data: item });
});

router.patch('/:id', canManageUpdates, (req, res) => {
  const id = parseId(req.params.id);
  const row = id ? getOne(TABLE, item => Number(item.id) === id && !item.deleted_at, { skipAccountScope: true }) : null;
  if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy bản cập nhật.' });

  const parsed = buildReleasePayload(req.body || {}, { partial: true });
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  if (parsed.value.published === 1 || parsed.value.active === 1) {
    const testResult = verifyReleaseReadiness();
    if (!testResult.ok) {
      const adminAlertService = require('../services/adminAlertService');
      adminAlertService.sendEmergencyAlert('updates', 'PHÁT HÀNH THẤT BẠI: Lỗi kiểm tra tự động trước khi cập nhật bản cập nhật.', {
        errorDetail: testResult.errors.join('\n')
      });
      return res.status(400).json({ ok: false, error: 'Không thể cập nhật bản phát hành: Lỗi hệ thống tự động kiểm tra trước khi publish.', details: testResult.errors });
    }
  }

  const nextVersion = parsed.value.version || row.version;
  const nextPlatform = parsed.value.platform || normalizePlatform(row.platform);
  const nextChannel = parsed.value.channel || normalizeChannel(row.channel);
  const duplicate = getOne(TABLE, item => !item.deleted_at
    && Number(item.id) !== Number(row.id)
    && cleanText(item.version, 80) === nextVersion
    && normalizePlatform(item.platform) === nextPlatform
    && normalizeChannel(item.channel) === nextChannel, { skipAccountScope: true });
  if (duplicate) return res.status(409).json({ ok: false, error: 'Phiên bản cập nhật đã tồn tại cho nền tảng/kênh này.' });

  update(TABLE, row.id, { ...parsed.value, updated_at: now() });
  auditLog('update_release_updated', { userId: req.user?.id || null, releaseId: row.id, changes: parsed.value });
  const item = serializeRelease(getOne(TABLE, itemRow => Number(itemRow.id) === Number(row.id), { skipAccountScope: true }));
  res.json({ ok: true, item, data: item });
});

router.patch('/:id/publish', canManageUpdates, (req, res) => {
  const id = parseId(req.params.id);
  const row = id ? getOne(TABLE, item => Number(item.id) === id && !item.deleted_at, { skipAccountScope: true }) : null;
  if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy bản cập nhật.' });

  const testResult = verifyReleaseReadiness();
  if (!testResult.ok) {
    const adminAlertService = require('../services/adminAlertService');
    adminAlertService.sendEmergencyAlert('updates', 'PHÁT HÀNH THẤT BẠI: Lỗi kiểm tra tự động trước khi xuất bản cập nhật.', {
      errorDetail: testResult.errors.join('\n')
    });
    return res.status(400).json({ ok: false, error: 'Không thể xuất bản: Lỗi hệ thống tự động kiểm tra trước khi publish.', details: testResult.errors });
  }

  update(TABLE, row.id, { published: 1, active: 1, published_at: row.published_at || now(), updated_at: now() });
  auditLog('update_release_published', { userId: req.user?.id || null, releaseId: row.id });
  const item = serializeRelease(getOne(TABLE, itemRow => Number(itemRow.id) === Number(row.id), { skipAccountScope: true }));
  res.json({ ok: true, item, data: item });
});

router.patch('/:id/unpublish', canManageUpdates, (req, res) => {
  const id = parseId(req.params.id);
  const row = id ? getOne(TABLE, item => Number(item.id) === id && !item.deleted_at, { skipAccountScope: true }) : null;
  if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy bản cập nhật.' });

  update(TABLE, row.id, { published: 0, active: 0, updated_at: now() });
  auditLog('update_release_unpublished', { userId: req.user?.id || null, releaseId: row.id });
  const item = serializeRelease(getOne(TABLE, itemRow => Number(itemRow.id) === Number(row.id), { skipAccountScope: true }));
  res.json({ ok: true, item, data: item });
});

router.delete('/:id', canManageUpdates, (req, res) => {
  const id = parseId(req.params.id);
  const row = id ? getOne(TABLE, item => Number(item.id) === id && !item.deleted_at, { skipAccountScope: true }) : null;
  if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy bản cập nhật.' });

  const hard = parseBooleanFlag(req.query.hard, 0) === 1;
  if (hard) {
    remove(TABLE, row.id);
    auditLog('update_release_deleted', { userId: req.user?.id || null, releaseId: row.id });
  } else {
    update(TABLE, row.id, { published: 0, active: 0, deleted_at: now(), updated_at: now() });
    auditLog('update_release_deleted_soft', { userId: req.user?.id || null, releaseId: row.id });
  }
  res.json({ ok: true });
});

module.exports = router;
