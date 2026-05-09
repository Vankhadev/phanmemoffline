export const AUTH_TOKEN_KEY = 'kha_token';
export const AUTH_USER_KEY = 'kha_user';
export const AUTH_SNAPSHOT_KEY = 'kha_auth_snapshot';
export const PENDING_ORDERS_KEY = 'kha_pending_orders';
export const OFFLINE_CUSTOMERS_KEY = 'kha_offline_customers';
export const PRINT_TEMPLATE_SELECTION_KEY = 'kha_print_template';
export const COMBOS_UPDATED_AT_KEY = 'kha_combos_updated_at';
export const PRINT_TEMPLATE_CACHE_PREFIX = 'kha_print_template_default';

const AUTH_KEYS = [AUTH_TOKEN_KEY, AUTH_USER_KEY, AUTH_SNAPSHOT_KEY];
const PENDING_KEYS = [PENDING_ORDERS_KEY, OFFLINE_CUSTOMERS_KEY];
const TEMP_CACHE_KEYS = [PRINT_TEMPLATE_SELECTION_KEY, COMBOS_UPDATED_AT_KEY];

function getBrowserStorage(type = 'localStorage') {
  try {
    if (typeof window === 'undefined') return null;
    return window[type] || null;
  } catch (_) {
    return null;
  }
}

function safeParseJson(raw, fallback = null) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return '';
  }
}

function removeStorageKey(storage, key) {
  try {
    storage?.removeItem(key);
  } catch (_) {
    // Bỏ qua môi trường không hỗ trợ storage hoặc lỗi quota/security.
  }
}

function setStorageKey(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch (_) {
    // Bỏ qua môi trường không hỗ trợ storage hoặc lỗi quota/security.
  }
}

function getStorageKey(storage, key) {
  try {
    return storage?.getItem(key) || '';
  } catch (_) {
    return '';
  }
}

function listStorageKeys(storage) {
  if (!storage) return [];
  try {
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
    return keys;
  } catch (_) {
    return [];
  }
}

export function canUseLocalStorage() {
  return Boolean(getBrowserStorage('localStorage'));
}

export function getAuthToken() {
  return getStorageKey(getBrowserStorage('localStorage'), AUTH_TOKEN_KEY);
}

export function setAuthToken(token) {
  const storage = getBrowserStorage('localStorage');
  if (!storage) return;
  if (token) setStorageKey(storage, AUTH_TOKEN_KEY, String(token));
  else removeStorageKey(storage, AUTH_TOKEN_KEY);
}

export function getStoredUserSnapshot() {
  return safeParseJson(getStorageKey(getBrowserStorage('localStorage'), AUTH_USER_KEY), null);
}

export function getAuthSnapshot() {
  const storage = getBrowserStorage('localStorage');
  const snapshot = safeParseJson(getStorageKey(storage, AUTH_SNAPSHOT_KEY), null);
  if (snapshot && typeof snapshot === 'object') return snapshot;

  const legacyUser = getStoredUserSnapshot();
  return legacyUser ? { user: legacyUser } : null;
}

export function normalizePermissions(permissions) {
  return Array.isArray(permissions)
    ? Array.from(new Set(permissions.map(item => String(item || '').trim()).filter(Boolean))).sort()
    : [];
}

export function buildAuthSnapshot(payload = {}) {
  const bootstrap = payload.bootstrap && typeof payload.bootstrap === 'object' ? payload.bootstrap : {};
  return {
    user: payload.user || null,
    account: payload.account || null,
    permissions: normalizePermissions(payload.permissions),
    session: payload.session || null,
    syncVersions: payload.syncVersions || bootstrap.syncVersions || {},
    defaultRoute: payload.defaultRoute || bootstrap.defaultRoute || '/',
    savedAt: new Date().toISOString(),
  };
}

export function saveAuthSession(payload = {}) {
  const storage = getBrowserStorage('localStorage');
  if (!storage) return buildAuthSnapshot(payload);

  if (payload.token) setStorageKey(storage, AUTH_TOKEN_KEY, String(payload.token));
  if (payload.user) setStorageKey(storage, AUTH_USER_KEY, safeStringify(payload.user));

  const snapshot = buildAuthSnapshot(payload);
  setStorageKey(storage, AUTH_SNAPSHOT_KEY, safeStringify(snapshot));
  return snapshot;
}

function getIdentityParts(source = {}) {
  const user = source.user || source;
  const account = source.account || {};
  return {
    userId: user?.id !== undefined && user?.id !== null ? String(user.id) : '',
    email: String(user?.email || '').trim().toLowerCase(),
    accountId: (account?.id ?? user?.account_id) !== undefined && (account?.id ?? user?.account_id) !== null
      ? String(account?.id ?? user?.account_id)
      : '',
  };
}

export function hasDifferentAuthIdentity(nextPayload = {}) {
  const previous = getAuthSnapshot();
  if (!previous?.user) return false;

  const previousIdentity = getIdentityParts(previous);
  const nextIdentity = getIdentityParts(nextPayload);

  if (previousIdentity.userId && nextIdentity.userId && previousIdentity.userId !== nextIdentity.userId) return true;
  if (previousIdentity.email && nextIdentity.email && previousIdentity.email !== nextIdentity.email) return true;
  if (previousIdentity.accountId && nextIdentity.accountId && previousIdentity.accountId !== nextIdentity.accountId) return true;

  return false;
}

export function clearStorageKeysByPrefix(prefix) {
  const storage = getBrowserStorage('localStorage');
  if (!storage || !prefix) return [];

  const removed = [];
  for (const key of listStorageKeys(storage)) {
    if (key.startsWith(prefix)) {
      removeStorageKey(storage, key);
      removed.push(key);
    }
  }
  return removed;
}

export function clearSessionStorageCache() {
  const storage = getBrowserStorage('sessionStorage');
  if (!storage) return [];

  const removed = [];
  for (const key of listStorageKeys(storage)) {
    if (key.startsWith('kha_')) {
      removeStorageKey(storage, key);
      removed.push(key);
    }
  }
  return removed;
}

export function clearPendingLocalData() {
  const storage = getBrowserStorage('localStorage');
  if (!storage) return [];

  const removed = [];
  for (const key of PENDING_KEYS) {
    removeStorageKey(storage, key);
    removed.push(key);
  }
  return removed;
}

export function getPendingLocalData() {
  const storage = getBrowserStorage('localStorage');
  const orders = safeParseJson(getStorageKey(storage, PENDING_ORDERS_KEY), []);
  const customers = safeParseJson(getStorageKey(storage, OFFLINE_CUSTOMERS_KEY), []);

  return {
    orders: Array.isArray(orders) ? orders : [],
    customers: Array.isArray(customers) ? customers : [],
  };
}

export function clearVolatileCache({ includePending = true } = {}) {
  const storage = getBrowserStorage('localStorage');
  if (!storage) return [];

  const removed = [];
  const keys = includePending ? [...PENDING_KEYS, ...TEMP_CACHE_KEYS] : [...TEMP_CACHE_KEYS];
  for (const key of keys) {
    removeStorageKey(storage, key);
    removed.push(key);
  }

  removed.push(...clearStorageKeysByPrefix(PRINT_TEMPLATE_CACHE_PREFIX));
  return Array.from(new Set(removed));
}

export function clearAuthSession({ clearVolatile = false, includePending = true } = {}) {
  const storage = getBrowserStorage('localStorage');
  const removed = [];

  if (storage) {
    for (const key of AUTH_KEYS) {
      removeStorageKey(storage, key);
      removed.push(key);
    }
  }

  removed.push(...clearSessionStorageCache());
  if (clearVolatile) removed.push(...clearVolatileCache({ includePending }));

  return Array.from(new Set(removed));
}

export function prepareForAuthenticatedPayload(payload = {}) {
  const identityChanged = hasDifferentAuthIdentity(payload);

  clearAuthSession({ clearVolatile: identityChanged, includePending: true });
  if (!identityChanged) clearVolatileCache({ includePending: false });

  const snapshot = saveAuthSession(payload);
  return { snapshot, identityChanged };
}
