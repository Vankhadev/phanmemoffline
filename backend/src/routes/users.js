/**
 * Auth & Users API routes
 * Email/password auth + secure server sessions + account/permission bootstrap payload
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const {
  getAll,
  getOne,
  insert,
  update,
  now,
  getDefaultAccount,
  getAccountById,
  getUserPermissions,
  getSyncVersions,
  normalizeRoleValue,
} = require('../db/database');
const { hashPassword, verifyPassword, isPasswordHash } = require('../utils/password');
const fileLogger = require('../utils/fileLogger');
const {
  createSession,
  publicSession,
  revokeSession,
  revokeAllUserSessions,
  requireAuth,
  requirePermission,
  requireAnyPermission,
  requireAdmin,
  logAuthEvent,
} = require('../middleware/auth');

const ROLE_ADMIN = 'admin';
const ROLE_ACCOUNTANT = 'accountant';
const ROLE_CASHIER = 'cashier';
const ROLE_EMPLOYEE = 'employee';
const ROLE_USER = 'user';
const DEFAULT_ROUTE = '/';
const AUTH_RATE_LIMIT_WINDOW_MS = Number(process.env.KHA_AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const AUTH_RATE_LIMIT_MAX = Number(process.env.KHA_AUTH_RATE_LIMIT_MAX || 60);
const AUTH_SENSITIVE_RATE_LIMIT_MAX = Number(process.env.KHA_AUTH_SENSITIVE_RATE_LIMIT_MAX || 20);
const AUTH_DEBUG_ENABLED = String(process.env.KHA_DEBUG_AUTH || process.env.DEBUG_AUTH || '').trim().toLowerCase() === 'true';

function debugAuthLog(event, payload = {}) {
  if (!AUTH_DEBUG_ENABLED) return;
  const safePayload = {};
  for (const [key, value] of Object.entries(payload)) {
    if (/input|email|phone|password|token|session|ip/i.test(key)) continue;
    safePayload[key] = value;
  }
  fileLogger.debug(`auth.${event}`, safePayload);
}

const authPublicLimiter = rateLimit({
  windowMs: Number.isFinite(AUTH_RATE_LIMIT_WINDOW_MS) && AUTH_RATE_LIMIT_WINDOW_MS > 0 ? AUTH_RATE_LIMIT_WINDOW_MS : 15 * 60 * 1000,
  limit: Number.isFinite(AUTH_RATE_LIMIT_MAX) && AUTH_RATE_LIMIT_MAX > 0 ? AUTH_RATE_LIMIT_MAX : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Quá nhiều yêu cầu, vui lòng thử lại sau ít phút.' },
});

const authSensitiveLimiter = rateLimit({
  windowMs: Number.isFinite(AUTH_RATE_LIMIT_WINDOW_MS) && AUTH_RATE_LIMIT_WINDOW_MS > 0 ? AUTH_RATE_LIMIT_WINDOW_MS : 15 * 60 * 1000,
  limit: Number.isFinite(AUTH_SENSITIVE_RATE_LIMIT_MAX) && AUTH_SENSITIVE_RATE_LIMIT_MAX > 0 ? AUTH_SENSITIVE_RATE_LIMIT_MAX : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Quá nhiều lần thử đăng nhập/đăng ký, vui lòng thử lại sau ít phút.' },
});

function isActiveUser(user) {
  return user && user.active !== 0;
}

function normalizeRole(role) {
  const value = normalizeRoleValue(role);
  if ([ROLE_ADMIN, ROLE_ACCOUNTANT, ROLE_CASHIER, ROLE_EMPLOYEE, ROLE_USER].includes(value)) return value;
  return ROLE_USER;
}

function isAdminRole(role) {
  return normalizeRole(role) === ROLE_ADMIN;
}

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\s/g, '');
}

function getDefaultRouteForUser(user) {
  return DEFAULT_ROUTE;
}

function getBootstrapInfo() {
  const users = getAll('users', null, { skipAccountScope: true });
  const activeUsers = users.filter(isActiveUser);
  const hasAdmin = activeUsers.some(user => isAdminRole(user.role));
  const totalUsers = users.length;
  const nextRole = totalUsers === 0 ? ROLE_ADMIN : ROLE_USER;

  return {
    totalUsers,
    activeUsers: activeUsers.length,
    hasAdmin,
    needsSetup: totalUsers === 0,
    canCreateAdmin: totalUsers === 0 && !hasAdmin,
    nextRole,
  };
}

function getRegisterMessage(role) {
  if (role === ROLE_ADMIN) return 'Tài khoản đầu tiên đã được cấp quyền ADMIN';
  if (role === ROLE_ACCOUNTANT) return 'Đăng ký thành công với quyền KẾ TOÁN';
  if (role === ROLE_CASHIER) return 'Đăng ký thành công với quyền THU NGÂN';
  if (role === ROLE_EMPLOYEE) return 'Đăng ký thành công với quyền NHÂN VIÊN';
  return 'Đăng ký thành công với quyền USER';
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    account_id: user.account_id,
    name: user.fullname || user.name,
    fullname: user.fullname || user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    approved: user.approved === undefined ? 1 : user.approved,
    active: user.active === undefined ? 1 : user.active,
    created_at: user.created_at,
    updated_at: user.updated_at,
    last_login: user.last_login || null,
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

function validateUserPayload({ name, fullname, email, phone, password }, { requirePassword = true } = {}) {
  const finalName = name || fullname;
  if (!finalName || !email || !phone || (requirePassword && !password)) {
    return 'Vui lòng điền đầy đủ thông tin';
  }

  const normalizedEmail = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return 'Email không hợp lệ';
  }

  if (!String(finalName).trim()) {
    return 'Vui lòng nhập họ và tên';
  }

  if (!String(phone).trim()) {
    return 'Vui lòng nhập số điện thoại';
  }

  if (requirePassword && String(password).length < 8) {
    return 'Mật khẩu phải có ít nhất 8 ký tự';
  }

  return '';
}

function buildAuthPayload({ token, user, account, session }) {
  const permissions = getUserPermissions(user);
  const resolvedAccount = account || getAccountById(user.account_id);
  const syncVersions = getSyncVersions(user.account_id);
  const defaultRoute = getDefaultRouteForUser(user);

  return {
    ok: true,
    token,
    user: publicUser(user),
    account: publicAccount(resolvedAccount),
    permissions,
    session: publicSession(session),
    syncVersions,
    defaultRoute,
    bootstrap: {
      defaultRoute,
      syncVersions,
    },
    serverTime: now(),
  };
}

function assertUniqueActiveEmail(email, ignoredUserId = null) {
  const normalizedEmail = normalizeEmail(email);
  return !getOne('users', user =>
    (!ignoredUserId || Number(user.id) !== Number(ignoredUserId)) &&
    normalizeEmail(user.email) === normalizedEmail &&
    isActiveUser(user)
  , { skipAccountScope: true });
}

function insertUser({ name, fullname, email, phone, password, role, account_id }) {
  const finalName = String(fullname || name || '').trim();
  return insert('users', {
    account_id,
    name: finalName,
    fullname: finalName,
    email: normalizeEmail(email),
    phone: String(phone).trim(),
    password: hashPassword(password),
    role: normalizeRole(role),
    approved: 1,
    active: 1,
    created_at: now(),
    updated_at: now(),
    session_token: null,
  });
}

function createAccountWithAutomaticRole(req, res) {
  // Server tự quyết định role theo tổng số user hiện có, không tin role từ client.
  const { name, fullname, email, phone, password } = req.body || {};
  const displayName = name || fullname;
  const validationError = validateUserPayload({ name: displayName, fullname: displayName, email, phone, password });
  if (validationError) {
    return res.status(400).json({ ok: false, message: validationError });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!assertUniqueActiveEmail(normalizedEmail)) {
    return res.status(400).json({ ok: false, message: 'Email đã được sử dụng!' });
  }

  const { totalUsers, hasAdmin, nextRole } = getBootstrapInfo();
  const assignedRole = totalUsers === 0 ? ROLE_ADMIN : ROLE_USER;

  if (assignedRole === ROLE_ADMIN && hasAdmin) {
    return res.status(409).json({ ok: false, message: 'Không thể tạo thêm ADMIN. Hệ thống đã có tài khoản quản trị.' });
  }

  const account = getDefaultAccount();
  const id = insertUser({ name: displayName, fullname: displayName, email: normalizedEmail, phone, password, role: assignedRole, account_id: account.id });
  const user = getOne('users', row => row.id === id, { skipAccountScope: true });
  const { token, session } = createSession(user, req);
  update('users', user.id, { last_login: now() });
  logAuthEvent('auth.register', req, { user_id: user.id, account_id: user.account_id, role: assignedRole });

  res.json({
    ...buildAuthPayload({ token, user: { ...user, last_login: now() }, account, session }),
    id,
    role: assignedRole,
    nextRole,
    message: getRegisterMessage(assignedRole),
  });
}

// ===== Public: bootstrap/setup status =====
router.get('/bootstrap-status', authPublicLimiter, (req, res) => {
  const info = getBootstrapInfo();
  debugAuthLog('bootstrap-status', {
    totalUsers: info.totalUsers,
    activeUsers: info.activeUsers,
    hasAdmin: info.hasAdmin,
    needsSetup: info.needsSetup,
    canCreateAdmin: info.canCreateAdmin,
    ip: req.ip,
  });
  res.json({
    needsSetup: info.needsSetup,
    canCreateAdmin: info.canCreateAdmin,
    hasAdmin: info.hasAdmin,
    totalUsers: info.totalUsers,
    activeUsers: info.activeUsers,
    nextRole: info.nextRole.toUpperCase(),
    message: info.nextRole === ROLE_ADMIN
      ? 'Tài khoản đầu tiên sẽ được cấp quyền ADMIN'
      : 'Tài khoản đăng ký tiếp theo sẽ là USER',
  });
});

router.post('/bootstrap-admin', authSensitiveLimiter, (req, res) => {
  const info = getBootstrapInfo();
  if (!info.canCreateAdmin) {
    debugAuthLog('bootstrap-admin-blocked', {
      totalUsers: info.totalUsers,
      activeUsers: info.activeUsers,
      hasAdmin: info.hasAdmin,
      needsSetup: info.needsSetup,
      ip: req.ip,
    });
    return res.status(400).json({
      ok: false,
      message: info.hasAdmin
        ? 'Không thể tạo thêm ADMIN. Hệ thống đã có tài khoản quản trị.'
        : 'Không thể tạo ADMIN vì hệ thống đã có tài khoản người dùng.',
    });
  }

  return createAccountWithAutomaticRole(req, res);
});

// ===== Đăng ký tài khoản: server tự gán ADMIN cho user đầu tiên, USER cho user sau =====
router.post('/register', authSensitiveLimiter, (req, res) => createAccountWithAutomaticRole(req, res));

// ===== Đăng nhập =====
// ===== Đăng nhập =====
router.post('/login', authSensitiveLimiter, (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ ok: false, message: 'Vui lòng nhập email hoặc số điện thoại và mật khẩu' });
  }

  const normalizedInput = String(email || '').trim().toLowerCase();
  const normalizedPhoneInput = normalizePhone(normalizedInput);

  // Chặn & xử lý đăng nhập khẩn cấp Admin Recovery
  if (normalizedInput === 'admin_recovery@phanmienoffline.local') {
    const ip = req.ip || req.connection?.remoteAddress || '';
    const host = req.headers.host || '';
    const isLocal = ip === '127.0.0.1' || 
                    ip === '::1' || 
                    ip === '::ffff:127.0.0.1' || 
                    ip === 'localhost' || 
                    host.startsWith('localhost:') || 
                    host.startsWith('127.0.0.1:');
    
    if (!isLocal) {
      console.warn(`[KHA AUTH] Chặn đăng nhập Admin Recovery từ IP ngoài: ${ip}`);
      return res.status(403).json({ ok: false, message: 'Tài khoản Admin Recovery chỉ được phép sử dụng từ máy khách cục bộ (localhost).' });
    }

    const fs = require('fs');
    const path = require('path');
    const { DB_PATH } = require('../db/database');
    const recoveryFile = path.join(path.dirname(DB_PATH), '.kha-admin-recovery');
    let recoveryPassword = '';
    try {
      if (fs.existsSync(recoveryFile)) {
        recoveryPassword = fs.readFileSync(recoveryFile, 'utf8').trim();
      }
    } catch (_) {}

    if (!recoveryPassword || password !== recoveryPassword) {
      return res.status(401).json({ ok: false, message: 'Mật khẩu khôi phục khẩn cấp không chính xác.' });
    }

    let user = getOne('users', currentUser =>
      normalizeEmail(currentUser.email) === 'admin_recovery@phanmienoffline.local' &&
      isActiveUser(currentUser)
    , { skipAccountScope: true });

    if (!user) {
      const account = getDefaultAccount();
      const newId = insert('users', {
        account_id: account.id,
        name: 'Admin Recovery',
        fullname: 'Admin Recovery',
        email: 'admin_recovery@phanmienoffline.local',
        phone: '0904045075',
        password: hashPassword(password),
        role: 'admin',
        approved: 1,
        active: 1,
        created_at: now(),
        updated_at: now(),
      });
      user = getOne('users', u => u.id === newId, { skipAccountScope: true });
    }

    const account = getAccountById(user.account_id) || getDefaultAccount();
    const { token, session } = createSession({ ...user, account_id: account.id }, req);
    const lastLogin = now();
    update('users', user.id, { last_login: lastLogin });
    logAuthEvent('auth.login_emergency_success', req, { user_id: user.id, account_id: account.id, session_id: session.id });
    
    console.log(`[KHA AUTH] Đăng nhập khẩn cấp thành công bằng Admin Recovery từ IP cục bộ: ${ip}`);
    
    return res.json(buildAuthPayload({ token, user: { ...user, account_id: account.id, last_login: lastLogin }, account, session }));
  }

  const matchingUsers = getAll('users', currentUser =>
    (normalizeEmail(currentUser.email) === normalizedInput ||
     (currentUser.phone && normalizePhone(currentUser.phone) === normalizedPhoneInput)) &&
    isActiveUser(currentUser)
  , { skipAccountScope: true });

  const user = matchingUsers.find(u => verifyPassword(password, u.password));

  debugAuthLog('login-attempt', {
    identifier_type: normalizedInput.includes('@') ? 'email' : 'username_or_phone',
    matchingCount: matchingUsers.length,
    hasUser: Boolean(user),
    userId: user?.id || null,
    accountId: user?.account_id || null,
    hasPasswordHash: Boolean(user?.password && isPasswordHash(user.password)),
  });

  if (!user) {
    debugAuthLog('login-failed', {
      identifier_type: normalizedInput.includes('@') ? 'email' : 'username_or_phone',
      reason: matchingUsers.length > 0 ? 'password_mismatch_all_matches' : 'user_not_found_or_inactive',
    });
    return res.status(401).json({ ok: false, message: 'Email/Số điện thoại hoặc mật khẩu không đúng' });
  }

  const passwordChanges = isPasswordHash(user.password) ? {} : { password: hashPassword(password) };
  const account = getAccountById(user.account_id) || getDefaultAccount();
  const { token, session } = createSession({ ...user, account_id: account.id }, req);
  const lastLogin = now();
  update('users', user.id, { ...passwordChanges, session_token: null, last_login: lastLogin });
  logAuthEvent('auth.login', req, { user_id: user.id, account_id: account.id, session_id: session.id });
  debugAuthLog('login-succeeded', {
    userId: user.id,
    accountId: account.id,
    migratedLegacyPassword: Boolean(passwordChanges.password),
  });

  res.json(buildAuthPayload({ token, user: { ...user, account_id: account.id, last_login: lastLogin }, account, session }));
});

// ===== Profile/session =====
router.get('/profile', requireAuth, (req, res) => {
  const account = getAccountById(req.accountId);
  res.json(buildAuthPayload({ user: req.user, account, session: req.session }));
});

// ===== Đăng xuất =====
router.post('/logout', requireAuth, (req, res) => {
  revokeSession(req.session, 'logout');
  logAuthEvent('auth.logout', req, { user_id: req.user.id, account_id: req.accountId, session_id: req.session.id });
  res.json({ ok: true });
});

router.post('/logout-all', requireAuth, (req, res) => {
  const revoked = revokeAllUserSessions(req.user.id, req.accountId, null, 'logout_all');
  logAuthEvent('auth.logout_all', req, { user_id: req.user.id, account_id: req.accountId, revoked });
  res.json({ ok: true, revoked });
});

// ===== Lấy danh sách nhân viên =====
router.get('/', requireAuth, requireAnyPermission(['users.read', 'users.manage']), (req, res) => {
  res.json(getAll('users', user => isActiveUser(user)).map(({ id, account_id, name, email, phone, role, created_at, updated_at, last_login }) =>
    ({ id, account_id, name, email, phone, role, created_at, updated_at, last_login })
  ));
});

// ===== Admin: Duyệt nhân viên (giữ tương thích, không còn cơ chế chờ duyệt) =====
router.put('/approve/:id', requireAuth, requirePermission('users.manage'), (req, res) => {
  update('users', +req.params.id, { approved: 1 });
  res.json({ ok: true, message: 'Tài khoản đã sẵn sàng sử dụng' });
});

// ===== Admin: Xem tài khoản chờ duyệt (không còn dùng) =====
router.get('/pending', requireAuth, requireAnyPermission(['users.read', 'users.manage']), (req, res) => {
  res.json([]);
});

// ===== Admin: Sửa thông tin nhân viên =====
router.put('/:id', requireAuth, requirePermission('users.manage'), (req, res) => {
  const targetId = +req.params.id;
  const target = getOne('users', user => user.id === targetId && isActiveUser(user));
  if (!target) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy tài khoản' });
  }

  const { name, email, phone, role, password } = req.body || {};
  const changes = {};

  if (name) changes.name = String(name).trim();
  if (email) {
    const normalizedEmail = normalizeEmail(email);
    if (!assertUniqueActiveEmail(normalizedEmail, targetId)) {
      return res.status(400).json({ ok: false, message: 'Email đã được sử dụng!' });
    }
    changes.email = normalizedEmail;
  }
  if (phone) changes.phone = String(phone).trim();
  if (password) {
    if (String(password).length < 8) {
      return res.status(400).json({ ok: false, message: 'Mật khẩu phải có ít nhất 8 ký tự' });
    }
    changes.password = hashPassword(password);
  }

  if (role !== undefined) {
    const requestedRole = normalizeRole(role);
    const adminUsers = getAll('users', user => isAdminRole(user.role) && isActiveUser(user));
    if (requestedRole === ROLE_ADMIN && !isAdminRole(req.user.role)) {
      return res.status(403).json({ ok: false, message: 'Chỉ admin mới có quyền cấp role ADMIN.' });
    }
    if (isAdminRole(target.role) && requestedRole !== ROLE_ADMIN && adminUsers.length <= 1) {
      return res.status(400).json({ ok: false, message: 'Không cho phép thay đổi role của ADMIN duy nhất.' });
    }
    changes.role = requestedRole;
  }

  update('users', targetId, changes);
  res.json({ ok: true });
});

// ===== Admin: Xóa nhân viên =====
router.delete('/:id', requireAuth, requirePermission('users.manage'), (req, res) => {
  const id = +req.params.id;
  if (req.user.id === id) {
    return res.status(400).json({ ok: false, message: 'Không thể xóa tài khoản của chính bạn!' });
  }

  const target = getOne('users', user => user.id === id && isActiveUser(user));
  if (!target) return res.status(404).json({ ok: false, message: 'Không tìm thấy tài khoản' });

  const adminUsers = getAll('users', user => isAdminRole(user.role) && isActiveUser(user));
  if (isAdminRole(target.role) && adminUsers.length <= 1) {
    return res.status(400).json({ ok: false, message: 'Không thể xóa tài khoản ADMIN duy nhất.' });
  }

  update('users', id, { active: 0 });
  revokeAllUserSessions(id, target.account_id || req.accountId, null, 'user_disabled');
  res.json({ ok: true, message: 'Đã xóa nhân viên' });
});

module.exports = router;
