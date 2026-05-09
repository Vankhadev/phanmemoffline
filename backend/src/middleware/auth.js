const crypto = require('crypto');
const {
  getOne,
  getAll,
  insert,
  update,
  now,
  getAccountById,
  getUserPermissions,
  runWithRequestContext,
  auditLog,
} = require('../db/database');

const DEFAULT_SESSION_TTL_DAYS = Number(process.env.KHA_SESSION_TTL_DAYS || 30);
const TOKEN_SECRET = process.env.KHA_SESSION_SECRET || process.env.SESSION_SECRET || 'kha-local-session-secret';

function hashToken(token) {
  return crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(String(token || ''))
    .digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function isActiveUser(user) {
  return user && user.active !== 0;
}

function isSessionActive(session) {
  if (!session || session.revoked_at) return false;
  const expiresAt = session.expires_at ? new Date(session.expires_at).getTime() : 0;
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function publicSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    user_id: session.user_id,
    account_id: session.account_id,
    device_name: session.device_name || '',
    device_id: session.device_id || '',
    ip: session.ip || '',
    user_agent: session.user_agent || '',
    created_at: session.created_at,
    last_seen_at: session.last_seen_at,
    expires_at: session.expires_at,
    revoked_at: session.revoked_at || null,
  };
}

function buildDeviceMetadata(req, body = {}) {
  const userAgent = String(req.headers['user-agent'] || body.user_agent || '').slice(0, 500);
  return {
    device_id: body.device_id ? String(body.device_id).slice(0, 200) : '',
    device_name: body.device_name ? String(body.device_name).slice(0, 200) : '',
    platform: body.platform ? String(body.platform).slice(0, 100) : '',
    app_version: body.app_version ? String(body.app_version).slice(0, 100) : '',
    user_agent: userAgent,
    ip: req.ip || req.connection?.remoteAddress || '',
  };
}

function createSession(user, req, options = {}) {
  const token = generateToken();
  const createdAt = now();
  const ttlDays = Number(options.ttlDays || DEFAULT_SESSION_TTL_DAYS) || 30;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const metadata = buildDeviceMetadata(req, options.device || req.body || {});

  const sessionId = insert('sessions', {
    account_id: user.account_id,
    user_id: user.id,
    token_hash: hashToken(token),
    device_id: metadata.device_id,
    device_name: metadata.device_name,
    platform: metadata.platform,
    app_version: metadata.app_version,
    user_agent: metadata.user_agent,
    ip: metadata.ip,
    created_at: createdAt,
    last_seen_at: createdAt,
    expires_at: expiresAt,
    revoked_at: null,
  });

  const session = getOne('sessions', row => row.id === sessionId, { skipAccountScope: true });
  return { token, session };
}

function revokeSession(session, reason = 'logout') {
  if (!session || session.revoked_at) return;
  update('sessions', session.id, { revoked_at: now(), revoked_reason: reason });
}

function revokeAllUserSessions(userId, accountId, exceptSessionId = null, reason = 'logout_all') {
  const sessions = getAll('sessions', session =>
    Number(session.user_id) === Number(userId) &&
    Number(session.account_id) === Number(accountId) &&
    !session.revoked_at &&
    (!exceptSessionId || Number(session.id) !== Number(exceptSessionId))
  , { skipAccountScope: true });

  for (const session of sessions) {
    update('sessions', session.id, { revoked_at: now(), revoked_reason: reason });
  }

  return sessions.length;
}

function attachContext(req, res, next, authContext = {}) {
  const context = {
    userId: authContext.user?.id || null,
    accountId: authContext.account?.id || authContext.session?.account_id || null,
    sessionId: authContext.session?.id || null,
    ip: req.ip || req.connection?.remoteAddress || '',
    userAgent: req.headers['user-agent'] || '',
  };

  runWithRequestContext(context, () => next());
}

function resolveAuth(req) {
  const token = getBearerToken(req);
  if (!token) return { error: 'Chưa đăng nhập', status: 401 };

  const tokenHash = hashToken(token);
  const session = getOne('sessions', row => row.token_hash === tokenHash, { skipAccountScope: true });
  if (!isSessionActive(session)) return { error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn', status: 401 };

  const user = getOne('users', row => Number(row.id) === Number(session.user_id) && isActiveUser(row), { skipAccountScope: true });
  if (!user) return { error: 'Tài khoản không tồn tại hoặc đã bị khóa', status: 401 };

  const account = getAccountById(session.account_id || user.account_id);
  if (!account) return { error: 'Tài khoản cửa hàng không tồn tại hoặc đã bị khóa', status: 401 };

  const permissions = getUserPermissions(user);
  return { token, session, user, account, permissions };
}

function requireAuth(req, res, next) {
  const auth = resolveAuth(req);
  if (auth.error) return res.status(auth.status || 401).json({ ok: false, error: auth.error, message: auth.error });

  req.authToken = auth.token;
  req.session = auth.session;
  req.user = auth.user;
  req.account = auth.account;
  req.accountId = auth.account.id;
  req.permissions = auth.permissions;

  update('sessions', auth.session.id, { last_seen_at: now() });
  return attachContext(req, res, next, auth);
}

function optionalAuth(req, res, next) {
  const auth = resolveAuth(req);
  if (auth.error) return attachContext(req, res, next);

  req.authToken = auth.token;
  req.session = auth.session;
  req.user = auth.user;
  req.account = auth.account;
  req.accountId = auth.account.id;
  req.permissions = auth.permissions;
  update('sessions', auth.session.id, { last_seen_at: now() });
  return attachContext(req, res, next, auth);
}

function hasPermission(req, permissionKey) {
  if (!permissionKey) return true;
  if (req.user?.role === 'admin') return true;
  return Array.isArray(req.permissions) && req.permissions.includes(permissionKey);
}

function isWriteRequest(req) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase());
}

function permissionMatchesRequest(req, permissionKey, permissionKeys = []) {
  if (!permissionKey) return true;
  if (isWriteRequest(req) && permissionKey.endsWith('.read')) {
    const managePermission = `${permissionKey.slice(0, -5)}.manage`;
    if (permissionKeys.includes(managePermission)) return hasPermission(req, managePermission);
  }
  return hasPermission(req, permissionKey);
}

function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, () => requirePermission(permissionKey)(req, res, next));
    if (!permissionMatchesRequest(req, permissionKey)) {
      return res.status(403).json({ ok: false, error: 'Không có quyền truy cập', permission: permissionKey });
    }
    return next();
  };
}

function requireAnyPermission(permissionKeys = []) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, () => requireAnyPermission(permissionKeys)(req, res, next));
    if (req.user.role === 'admin' || permissionKeys.some(permission => permissionMatchesRequest(req, permission, permissionKeys))) return next();
    return res.status(403).json({ ok: false, error: 'Không có quyền truy cập', permissions: permissionKeys });
  };
}

function requireAdmin(req, res, next) {
  const check = () => {
    if (req.user?.role !== 'admin') return res.status(403).json({ ok: false, error: 'Chỉ admin mới có quyền' });
    return next();
  };
  if (!req.user) return requireAuth(req, res, check);
  return check();
}

function authContext(req, res, next) {
  return attachContext(req, res, next);
}

function logAuthEvent(action, req, meta = {}) {
  try {
    auditLog(action, {
      user_id: meta.user_id || req.user?.id || null,
      account_id: meta.account_id || req.accountId || req.user?.account_id || null,
      ip: req.ip || req.connection?.remoteAddress || '',
      user_agent: req.headers['user-agent'] || '',
      meta,
    });
  } catch (err) {
    console.warn('[KHA AUTH] audit log failed:', err.message);
  }
}

module.exports = {
  hashToken,
  generateToken,
  getBearerToken,
  createSession,
  publicSession,
  revokeSession,
  revokeAllUserSessions,
  requireAuth,
  optionalAuth,
  requirePermission,
  requireAnyPermission,
  requireAdmin,
  authContext,
  hasPermission,
  logAuthEvent,
};
