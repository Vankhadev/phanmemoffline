const crypto = require('crypto');
const {
  getAll,
  getOne,
  insert,
  update,
  now,
  getSyncVersions,
} = require('../db/database');
const {
  createInvoiceFromPayload,
  normalizeClientOrderId,
} = require('./invoiceCreationService');

const DEFAULT_ANDROID_URL = 'https://example.com/phanmienoffline-mobile/android.apk';
const DEFAULT_IOS_URL = 'https://example.com/phanmienoffline-mobile/ios';
const HASH_IGNORED_FIELDS = new Set([
  'id',
  'invoice_id',
  'invoice_code',
  'payload_hash',
  'payloadHash',
  'idempotency_key',
  'idempotencyKey',
  'mobile_sync_status',
  'mobile_synced_at',
  'mobile_device_id',
  'store_info_snapshot',
  'server_updated_at',
  'sync_version',
  'device',
  'device_id',
  'device_uid',
  'client_device_id',
  'install_id',
  'device_name',
  'platform',
  'app_version',
  'push_token',
  'user_agent',
  'ip',
  'created_by_session_id',
  'created_by_device_id',
  'created_by_device_name',
  'created_by_platform',
  'created_by_app_version',
  'created_by_user_agent',
  'created_by_ip',
]);

function createHttpError(message, status = 400, code = '') {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function normalizeText(value, maxLength = 500) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, maxLength);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function stableCanonicalize(value) {
  if (Array.isArray(value)) return value.map(item => stableCanonicalize(item));
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value)
    .filter(key => value[key] !== undefined && !HASH_IGNORED_FIELDS.has(key))
    .sort()
    .reduce((acc, key) => {
      acc[key] = stableCanonicalize(value[key]);
      return acc;
    }, {});
}

function computeInvoicePayloadHash(payload = {}) {
  const canonical = JSON.stringify(stableCanonicalize(payload || {}));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function buildIdempotencyKey(accountId, clientOrderId, payloadHash) {
  return `${accountId || 'account'}:${clientOrderId}:${payloadHash}`;
}

function getMobileDownloadUrls() {
  return {
    android_url: normalizeText(process.env.KHA_MOBILE_ANDROID_URL || process.env.MOBILE_ANDROID_URL || DEFAULT_ANDROID_URL, 1200),
    ios_url: normalizeText(process.env.KHA_MOBILE_IOS_URL || process.env.MOBILE_IOS_URL || DEFAULT_IOS_URL, 1200),
    defaults: {
      android_url: DEFAULT_ANDROID_URL,
      ios_url: DEFAULT_IOS_URL,
    },
  };
}

function publicInstallLink(link) {
  if (!link) return null;
  return {
    id: link.id,
    token: link.token,
    account_id: link.account_id,
    android_url: link.android_url,
    ios_url: link.ios_url,
    expires_at: link.expires_at,
    active: link.active === undefined ? 1 : link.active,
    used_count: toNumber(link.used_count, 0),
    last_resolved_at: link.last_resolved_at || null,
    created_by_user_id: link.created_by_user_id || null,
    created_at: link.created_at,
    updated_at: link.updated_at,
  };
}

function createMobileInstallLink(req, body = {}) {
  const urls = getMobileDownloadUrls();
  const ttlDays = Math.max(1, Math.min(90, Number(body.expires_days || body.ttl_days || 7) || 7));
  const createdAt = now();
  const expiresAt = body.expires_at || new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const token = crypto.randomBytes(24).toString('base64url');
  const id = insert('mobile_install_links', {
    account_id: req.accountId,
    token,
    created_by_user_id: req.user?.id || null,
    android_url: normalizeText(body.android_url || urls.android_url, 1200),
    ios_url: normalizeText(body.ios_url || urls.ios_url, 1200),
    expires_at: expiresAt,
    active: 1,
    used_count: 0,
    last_resolved_at: null,
    created_at: createdAt,
    updated_at: createdAt,
  });
  return getOne('mobile_install_links', link => Number(link.id) === Number(id));
}

function isInstallLinkExpired(link, at = Date.now()) {
  if (!link?.expires_at) return false;
  const expiresAt = new Date(link.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= at;
}

function resolveMobileInstallLink(token) {
  const normalizedToken = normalizeText(token, 300);
  if (!normalizedToken) throw createHttpError('Thiếu token cài đặt mobile', 400);

  const link = getOne('mobile_install_links', row => row.token === normalizedToken, { skipAccountScope: true });
  if (!link || link.active === 0) throw createHttpError('Link cài đặt không tồn tại hoặc đã bị tắt', 404);
  if (isInstallLinkExpired(link)) {
    update('mobile_install_links', link.id, { active: 0, updated_at: now() });
    throw createHttpError('Link cài đặt đã hết hạn', 410);
  }

  update('mobile_install_links', link.id, {
    used_count: toNumber(link.used_count, 0) + 1,
    last_resolved_at: now(),
    updated_at: now(),
  });
  return getOne('mobile_install_links', row => Number(row.id) === Number(link.id), { skipAccountScope: true });
}

function getDeviceInput(req, body = {}) {
  const device = body.device && typeof body.device === 'object' ? body.device : {};
  return {
    ...device,
    device_uid: device.device_uid || body.device_uid || body.device_id || body.install_id || body.client_device_id || req?.session?.device_id || '',
    device_id: device.device_id || body.device_id || body.install_id || body.client_device_id || req?.session?.device_id || '',
    device_name: device.device_name || body.device_name || req?.session?.device_name || '',
    platform: device.platform || body.platform || req?.session?.platform || '',
    app_version: device.app_version || body.app_version || req?.session?.app_version || '',
    push_token: device.push_token || body.push_token || '',
    user_agent: device.user_agent || body.user_agent || req?.headers?.['user-agent'] || req?.session?.user_agent || '',
    ip: body.ip || req?.ip || req?.connection?.remoteAddress || req?.session?.ip || '',
  };
}

function normalizeDeviceUid(input = {}, fallback = '') {
  return normalizeText(input.device_uid || input.device_id || input.install_id || input.client_device_id || fallback, 200);
}

function findMobileDevice(accountId, deviceUid) {
  const normalizedUid = normalizeText(deviceUid, 200);
  if (!accountId || !normalizedUid) return null;
  return getOne('mobile_devices', device =>
    Number(device.account_id) === Number(accountId) &&
    normalizeText(device.device_uid || device.device_id, 200) === normalizedUid
  , { skipAccountScope: true });
}

function publicMobileDevice(device) {
  if (!device) return null;
  return {
    id: device.id,
    account_id: device.account_id,
    user_id: device.user_id || null,
    device_uid: device.device_uid || device.device_id || '',
    device_name: device.device_name || '',
    platform: device.platform || '',
    app_version: device.app_version || '',
    active: device.active === undefined ? 1 : device.active,
    first_seen_at: device.first_seen_at || device.created_at || null,
    last_seen_at: device.last_seen_at || null,
    last_login_at: device.last_login_at || null,
    revoked_at: device.revoked_at || null,
    revoked_by_user_id: device.revoked_by_user_id || null,
    revoked_reason: device.revoked_reason || '',
    created_at: device.created_at,
    updated_at: device.updated_at,
  };
}

function registerOrUpdateMobileDevice(req, user, session, body = {}, options = {}) {
  const accountId = user?.account_id || req?.accountId || session?.account_id;
  const input = getDeviceInput(req, body);
  const deviceUid = normalizeDeviceUid(input, session?.device_id || (session?.id ? `session-${session.id}` : ''));
  if (!accountId || !deviceUid) throw createHttpError('Không xác định được thiết bị mobile', 400);

  const existing = findMobileDevice(accountId, deviceUid);
  if (existing && existing.active === 0 && !options.allowRevoked) {
    throw createHttpError('Thiết bị mobile đã bị thu hồi quyền truy cập', 403, 'MOBILE_DEVICE_REVOKED');
  }

  const timestamp = now();
  const payload = {
    account_id: accountId,
    user_id: user?.id || existing?.user_id || null,
    device_uid: deviceUid,
    device_name: normalizeText(input.device_name, 200),
    platform: normalizeText(input.platform, 100),
    app_version: normalizeText(input.app_version, 100),
    user_agent: normalizeText(input.user_agent, 500),
    ip: normalizeText(input.ip, 100),
    push_token: normalizeText(input.push_token, 500),
    active: 1,
    last_seen_at: timestamp,
    last_login_at: timestamp,
    updated_at: timestamp,
  };

  if (existing) {
    update('mobile_devices', existing.id, payload);
    return getOne('mobile_devices', row => Number(row.id) === Number(existing.id), { skipAccountScope: true });
  }

  const id = insert('mobile_devices', {
    ...payload,
    first_seen_at: timestamp,
    created_at: timestamp,
    revoked_at: null,
    revoked_by_user_id: null,
    revoked_reason: '',
  });
  return getOne('mobile_devices', row => Number(row.id) === Number(id), { skipAccountScope: true });
}

function resolveRequestMobileDevice(req) {
  const accountId = req?.accountId || req?.account?.id || req?.session?.account_id;
  const input = getDeviceInput(req, req?.body || {});
  const deviceUid = normalizeDeviceUid(input, req?.session?.device_id || '');
  return findMobileDevice(accountId, deviceUid);
}

function touchMobileDeviceFromRequest(req) {
  const device = resolveRequestMobileDevice(req);
  if (!device || device.active === 0) return device;
  update('mobile_devices', device.id, {
    user_id: req.user?.id || device.user_id || null,
    last_seen_at: now(),
    updated_at: now(),
  });
  return getOne('mobile_devices', row => Number(row.id) === Number(device.id), { skipAccountScope: true });
}

function listMobileDevices(accountId) {
  return getAll('mobile_devices', device => !accountId || Number(device.account_id) === Number(accountId), { skipAccountScope: true })
    .slice()
    .sort((a, b) => new Date(b.last_seen_at || b.updated_at || 0) - new Date(a.last_seen_at || a.updated_at || 0))
    .map(publicMobileDevice);
}

function revokeMobileDevice(req, deviceId, reason = 'admin_revoke') {
  const id = Number(deviceId);
  if (!Number.isFinite(id) || id <= 0) throw createHttpError('ID thiết bị không hợp lệ', 400);
  const device = getOne('mobile_devices', row => Number(row.id) === id && Number(row.account_id) === Number(req.accountId), { skipAccountScope: true });
  if (!device) throw createHttpError('Không tìm thấy thiết bị mobile', 404);

  const timestamp = now();
  update('mobile_devices', device.id, {
    active: 0,
    revoked_at: timestamp,
    revoked_by_user_id: req.user?.id || null,
    revoked_reason: normalizeText(reason, 300) || 'admin_revoke',
    updated_at: timestamp,
  });

  const deviceUid = normalizeText(device.device_uid || device.device_id, 200);
  let revokedSessions = 0;
  for (const session of getAll('sessions', row =>
    Number(row.account_id) === Number(req.accountId) &&
    !row.revoked_at &&
    deviceUid && normalizeText(row.device_id, 200) === deviceUid
  , { skipAccountScope: true })) {
    update('sessions', session.id, { revoked_at: timestamp, revoked_reason: 'mobile_device_revoked' });
    revokedSessions += 1;
  }

  return {
    device: publicMobileDevice(getOne('mobile_devices', row => Number(row.id) === id, { skipAccountScope: true })),
    revoked_sessions: revokedSessions,
  };
}

function getStoreInfoSnapshot() {
  const store = getAll('store_info')[0] || {};
  return clone(store);
}

function buildPayloadSummary(payload = {}) {
  const details = Array.isArray(payload.details) ? payload.details : [];
  return {
    client_order_id: normalizeClientOrderId(payload.client_order_id || payload.clientOrderId || payload.order_uuid || payload.local_order_id || ''),
    total: toNumber(payload.total, 0),
    details_count: details.length,
    customer_id: payload.customer_id || null,
    client_created_at: payload.client_created_at || payload.created_at || null,
  };
}

function beginMobileSyncEvent(req, eventPayload = {}) {
  const timestamp = now();
  const idempotencyKey = normalizeText(eventPayload.idempotency_key, 500);
  const existing = idempotencyKey
    ? getOne('mobile_sync_events', event =>
      event.event_type === (eventPayload.event_type || 'create_invoice') &&
      event.idempotency_key === idempotencyKey &&
      Number(event.account_id) === Number(req.accountId)
    , { skipAccountScope: true })
    : null;

  if (existing) {
    update('mobile_sync_events', existing.id, {
      status: 'received',
      attempts: toNumber(existing.attempts, 0) + 1,
      last_error: '',
      received_at: existing.received_at || timestamp,
      last_received_at: timestamp,
      updated_at: timestamp,
    });
    return getOne('mobile_sync_events', event => Number(event.id) === Number(existing.id), { skipAccountScope: true });
  }

  const id = insert('mobile_sync_events', {
    account_id: req.accountId,
    user_id: req.user?.id || null,
    session_id: req.session?.id || null,
    mobile_device_id: eventPayload.mobile_device_id || null,
    event_type: eventPayload.event_type || 'create_invoice',
    action: eventPayload.action || 'create_invoice',
    status: 'received',
    attempts: 1,
    client_order_id: eventPayload.client_order_id || '',
    payload_hash: eventPayload.payload_hash || '',
    idempotency_key: idempotencyKey,
    invoice_id: null,
    invoice_code: '',
    payload_summary: eventPayload.payload_summary || null,
    last_error: '',
    received_at: timestamp,
    last_received_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return getOne('mobile_sync_events', event => Number(event.id) === Number(id), { skipAccountScope: true });
}

function updateMobileSyncEvent(event, changes = {}) {
  if (!event?.id) return null;
  update('mobile_sync_events', event.id, {
    ...changes,
    updated_at: now(),
  });
  return getOne('mobile_sync_events', row => Number(row.id) === Number(event.id), { skipAccountScope: true });
}

function extractInvoicePayload(input = {}) {
  if (input.invoice && typeof input.invoice === 'object') return input.invoice;
  if (input.order && typeof input.order === 'object') return input.order;
  if (input.payload && typeof input.payload === 'object') return input.payload;
  return input;
}

function processMobileInvoicePush(input = {}, req, options = {}) {
  const payload = extractInvoicePayload(input);
  if (!payload || typeof payload !== 'object') throw createHttpError('Payload hóa đơn mobile không hợp lệ', 400);

  const clientOrderId = normalizeClientOrderId(payload.client_order_id || payload.clientOrderId || payload.order_uuid || payload.local_order_id || input.client_order_id || '');
  if (!clientOrderId) throw createHttpError('Thiếu client_order_id cho hóa đơn mobile', 400, 'MISSING_CLIENT_ORDER_ID');

  const payloadHash = computeInvoicePayloadHash({ ...payload, client_order_id: clientOrderId });
  const idempotencyKey = buildIdempotencyKey(req.accountId, clientOrderId, payloadHash);
  const device = options.device || req.mobileDevice || resolveRequestMobileDevice(req);
  const event = beginMobileSyncEvent(req, {
    event_type: 'create_invoice',
    action: 'create_invoice',
    mobile_device_id: device?.id || null,
    client_order_id: clientOrderId,
    payload_hash: payloadHash,
    idempotency_key: idempotencyKey,
    payload_summary: buildPayloadSummary({ ...payload, client_order_id: clientOrderId }),
  });

  try {
    const syncedAt = now();
    const result = createInvoiceFromPayload({
      ...payload,
      client_order_id: clientOrderId,
      payload_hash: payloadHash,
      idempotency_key: idempotencyKey,
      mobile_sync_status: 'applied',
      mobile_synced_at: syncedAt,
      mobile_device_id: device?.id || null,
      store_info_snapshot: getStoreInfoSnapshot(),
      client_created_at: payload.client_created_at || payload.created_at || null,
      order_source: 'mobile',
      source: 'mobile',
      user_id: payload.user_id || req.user?.id || null,
    }, req, {
      orderSource: 'mobile',
      payloadHash,
      idempotencyKey,
      requirePayloadHash: true,
      defaultStatus: payload.status || 'pending',
      allowProvidedInvoiceCode: false,
    });

    const status = result.idempotent ? 'idempotent' : 'applied';
    updateMobileSyncEvent(event, {
      status,
      invoice_id: result.invoice_id || null,
      invoice_code: result.invoice_code || '',
      applied_at: syncedAt,
      last_error: '',
    });

    return {
      ok: true,
      status,
      action: result.idempotent ? 'idempotent_existing' : 'created',
      invoice_id: result.invoice_id,
      invoice_code: result.invoice_code,
      client_order_id: clientOrderId,
      payload_hash: payloadHash,
      idempotency_key: idempotencyKey,
      event_id: event?.id || null,
    };
  } catch (err) {
    const status = err.status === 409 || err.code === 'IDEMPOTENCY_CONFLICT' ? 'conflict' : (err.retryable ? 'retry_later' : 'failed');
    updateMobileSyncEvent(event, {
      status,
      last_error: err.message,
      conflict_invoice_id: err.details?.invoice_id || null,
      conflict_invoice_code: err.details?.invoice_code || '',
    });
    err.mobile_sync_status = status;
    err.mobile_event_id = event?.id || null;
    err.payload_hash = payloadHash;
    err.idempotency_key = idempotencyKey;
    throw err;
  }
}

function getRecentMobileEvents(req, limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const deviceId = req.mobileDevice?.id || null;
  return getAll('mobile_sync_events', event =>
    Number(event.account_id) === Number(req.accountId) &&
    (!deviceId || Number(event.mobile_device_id) === Number(deviceId))
  , { skipAccountScope: true })
    .slice()
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
    .slice(0, safeLimit);
}

function buildMobileSyncStatus(req) {
  const events = getRecentMobileEvents(req, 50);
  const counts = events.reduce((acc, event) => {
    const status = event.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  return {
    ok: true,
    account_id: req.accountId,
    device: publicMobileDevice(req.mobileDevice || resolveRequestMobileDevice(req)),
    syncVersions: getSyncVersions(req.accountId),
    events,
    counts,
    serverTime: now(),
  };
}

function reconcileMobileServerState(options = {}) {
  const timestamp = now();
  const nowMs = Date.now();
  const staleMinutes = Math.max(5, Number(options.staleMinutes || process.env.KHA_MOBILE_SYNC_STALE_MINUTES || 15) || 15);
  const staleCutoff = nowMs - staleMinutes * 60 * 1000;
  let expiredLinks = 0;
  let staleEvents = 0;

  for (const link of getAll('mobile_install_links', row => row && row.active !== 0, { skipAccountScope: true })) {
    if (isInstallLinkExpired(link, nowMs)) {
      update('mobile_install_links', link.id, { active: 0, updated_at: timestamp });
      expiredLinks += 1;
    }
  }

  for (const event of getAll('mobile_sync_events', row => row && row.status === 'received', { skipAccountScope: true })) {
    const updatedAt = new Date(event.updated_at || event.received_at || event.created_at || 0).getTime();
    if (Number.isFinite(updatedAt) && updatedAt < staleCutoff) {
      update('mobile_sync_events', event.id, {
        status: 'retry_later',
        last_error: `Server chưa hoàn tất xử lý sau ${staleMinutes} phút`,
        updated_at: timestamp,
      });
      staleEvents += 1;
    }
  }

  return { ok: true, expiredLinks, staleEvents, serverTime: timestamp };
}

module.exports = {
  computeInvoicePayloadHash,
  stableCanonicalize,
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
  getRecentMobileEvents,
  reconcileMobileServerState,
};
