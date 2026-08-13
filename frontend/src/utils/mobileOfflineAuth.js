import { getAuthSnapshot, normalizePermissions } from './authStorage';
import { isNativeAppRuntime, MOBILE_APP_VERSION } from './mobileAppRuntime';

const OFFLINE_ACCOUNTS_KEY = 'kha.mobile.offlineAccounts';
const LAST_OFFLINE_EMAIL_KEY = 'kha.mobile.lastOfflineEmail';
const PASSWORD_HASH_PREFIX = 'sha256:';
export const LOCAL_MOBILE_TOKEN_PREFIX = 'local-mobile-';

const DEFAULT_MOBILE_ACCOUNT = {
  id: 'mobile-default-user',
  account_id: 'mobile-default-account',
  name: 'POS Offline',
  email: 'dongphuongqc@gmail.com',
  phone: '0904045075',
  role: 'user',
  password: 'khongnoiduoc',
};

const DEFAULT_MOBILE_PERMISSIONS = [
  'accounting.read',
  'activity_logs.read',
  'cashbook.read',
  'customers.manage',
  'customers.read',
  'imports.read',
  'inventory_reports.read',
  'invoices.manage',
  'invoices.read',
  'partners.read',
  'print_templates.manage',
  'print_templates.read',
  'products.read',
  'revenue_reports.read',
  'settings.manage',
  'settings.read',
  'stats.read',
  'store.manage',
  'store.read',
  'tax_reports.read',
  'updates.manage',
  'updates.read',
  'users.manage',
  'users.read',
];

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getStorage() {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage || null;
  } catch (_) {
    return null;
  }
}

function readJsonStorage(key, fallback) {
  try {
    const raw = getStorage()?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    getStorage()?.setItem(key, JSON.stringify(value));
  } catch (_) {
    // Ignore locked storage.
  }
}

function writeStorage(key, value) {
  try {
    getStorage()?.setItem(key, String(value));
  } catch (_) {
    // Ignore locked storage.
  }
}

function readStorage(key) {
  try {
    return getStorage()?.getItem(key) || '';
  } catch (_) {
    return '';
  }
}

function fallbackHash(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${PASSWORD_HASH_PREFIX}fallback-${(hash >>> 0).toString(16)}`;
}

async function hashPasswordForMobile(email, password) {
  const text = `pos-offline-mobile-v1:${normalizeEmail(email)}:${String(password || '')}`;
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const bytes = Array.from(new Uint8Array(buffer));
      return `${PASSWORD_HASH_PREFIX}${bytes.map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
    }
  } catch (_) {
    // Fall back below.
  }
  return fallbackHash(text);
}

function readOfflineAccounts() {
  const value = readJsonStorage(OFFLINE_ACCOUNTS_KEY, []);
  return Array.isArray(value) ? value : [];
}

function writeOfflineAccounts(accounts) {
  writeJsonStorage(OFFLINE_ACCOUNTS_KEY, Array.isArray(accounts) ? accounts : []);
}

function makeLocalToken(email) {
  const random = Math.random().toString(36).slice(2);
  return `${LOCAL_MOBILE_TOKEN_PREFIX}${Date.now().toString(36)}-${random}-${normalizeEmail(email).replace(/[^a-z0-9]+/g, '-')}`;
}

function buildUser(source = {}) {
  const user = source.user || source;
  const email = normalizeEmail(user.email || DEFAULT_MOBILE_ACCOUNT.email);
  return {
    id: user.id ?? email,
    account_id: user.account_id ?? DEFAULT_MOBILE_ACCOUNT.account_id,
    name: user.name || user.full_name || DEFAULT_MOBILE_ACCOUNT.name,
    email,
    phone: user.phone || DEFAULT_MOBILE_ACCOUNT.phone,
    role: user.role || DEFAULT_MOBILE_ACCOUNT.role,
    approved: user.approved === undefined ? 1 : user.approved,
    active: user.active === undefined ? 1 : user.active,
    created_at: user.created_at || null,
    updated_at: user.updated_at || null,
    last_login: new Date().toISOString(),
  };
}

function buildAccount(source = {}, user = {}) {
  const account = source.account || {};
  return {
    id: account.id ?? user.account_id ?? DEFAULT_MOBILE_ACCOUNT.account_id,
    slug: account.slug || 'pos-offline-mobile',
    name: account.name || 'Phan mem POS Offline',
    plan: account.plan || 'mobile-offline',
    active: account.active === undefined ? 1 : account.active,
    created_at: account.created_at || null,
    updated_at: account.updated_at || null,
  };
}

function buildMobileOfflinePayload(source = {}, reason = 'offline-login') {
  const user = buildUser(source);
  const account = buildAccount(source, user);
  const permissions = normalizePermissions(
    Array.isArray(source.permissions) && source.permissions.length > 0
      ? source.permissions
      : DEFAULT_MOBILE_PERMISSIONS
  );
  const defaultRoute = source.defaultRoute || source.bootstrap?.defaultRoute || '/';

  return {
    ok: true,
    localOnly: true,
    offline: true,
    reason,
    token: source.token || makeLocalToken(user.email),
    user,
    account,
    permissions,
    session: {
      id: `mobile-local-${user.id || user.email}`,
      localOnly: true,
      offline: true,
      created_at: new Date().toISOString(),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'mobile-offline',
    },
    syncVersions: source.syncVersions || {},
    defaultRoute,
    bootstrap: {
      defaultRoute,
      syncVersions: source.syncVersions || {},
      localOnly: true,
      offline: true,
    },
    serverTime: new Date().toISOString(),
    message: 'Dang nhap cuc bo tren dien thoai.',
    mobileAppVersion: MOBILE_APP_VERSION,
  };
}

function findStoredAccount(email) {
  const normalizedEmail = normalizeEmail(email);
  return readOfflineAccounts().find(account => normalizeEmail(account.email) === normalizedEmail) || null;
}

function defaultAccountMatches(email, password) {
  return normalizeEmail(email) === normalizeEmail(DEFAULT_MOBILE_ACCOUNT.email)
    && String(password || '') === DEFAULT_MOBILE_ACCOUNT.password;
}

export function isLocalMobileAuthToken(token) {
  return String(token || '').startsWith(LOCAL_MOBILE_TOKEN_PREFIX);
}

export async function rememberMobileOfflineAccount({ email, password, payload } = {}) {
  if (!isNativeAppRuntime() || !email || !password || !payload?.user) return null;

  const normalizedEmail = normalizeEmail(email);
  const passwordHash = await hashPasswordForMobile(normalizedEmail, password);
  const user = buildUser(payload);
  const account = buildAccount(payload, user);
  const record = {
    email: normalizedEmail,
    passwordHash,
    user,
    account,
    permissions: normalizePermissions(payload.permissions || []),
    defaultRoute: payload.defaultRoute || payload.bootstrap?.defaultRoute || '/',
    syncVersions: payload.syncVersions || payload.bootstrap?.syncVersions || {},
    savedAt: new Date().toISOString(),
  };
  const accounts = readOfflineAccounts().filter(item => normalizeEmail(item.email) !== normalizedEmail);
  accounts.push(record);
  writeOfflineAccounts(accounts);
  writeStorage(LAST_OFFLINE_EMAIL_KEY, normalizedEmail);
  return record;
}

export async function authenticateMobileOfflineAccount(email, password) {
  if (!isNativeAppRuntime()) return null;

  const normalizedEmail = normalizeEmail(email);
  const stored = findStoredAccount(normalizedEmail);
  if (stored?.passwordHash) {
    const inputHash = await hashPasswordForMobile(normalizedEmail, password);
    if (inputHash === stored.passwordHash) {
      writeStorage(LAST_OFFLINE_EMAIL_KEY, normalizedEmail);
      return buildMobileOfflinePayload(stored, 'stored-mobile-account');
    }
  }

  if (defaultAccountMatches(normalizedEmail, password)) {
    writeStorage(LAST_OFFLINE_EMAIL_KEY, normalizedEmail);
    return buildMobileOfflinePayload({
      user: DEFAULT_MOBILE_ACCOUNT,
      account: {
        id: DEFAULT_MOBILE_ACCOUNT.account_id,
        slug: 'pos-offline-mobile',
        name: 'Phan mem POS Offline',
        plan: 'mobile-offline',
      },
      permissions: DEFAULT_MOBILE_PERMISSIONS,
      defaultRoute: '/',
    }, 'default-mobile-account');
  }

  return null;
}

export function getMobileOfflineSessionPayload() {
  if (!isNativeAppRuntime()) return null;

  const snapshot = getAuthSnapshot();
  if (snapshot?.user) {
    return buildMobileOfflinePayload({
      user: snapshot.user,
      account: snapshot.account,
      permissions: snapshot.permissions,
      defaultRoute: snapshot.defaultRoute || snapshot.bootstrap?.defaultRoute || '/',
      syncVersions: snapshot.syncVersions || {},
    }, 'cached-mobile-session');
  }

  const lastEmail = readStorage(LAST_OFFLINE_EMAIL_KEY);
  const stored = lastEmail ? findStoredAccount(lastEmail) : null;
  return stored ? buildMobileOfflinePayload(stored, 'stored-mobile-session') : null;
}
