const stripTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

export const MOBILE_UPDATE_EVENT = 'kha-mobile-update:available';
export const MOBILE_APP_DISPLAY_NAME = String(import.meta.env.VITE_MOBILE_APP_DISPLAY_NAME || 'Bán Hàng Pos').trim();
export const MOBILE_APP_VERSION = String(import.meta.env.VITE_MOBILE_APP_VERSION || '2.0.2').trim();
export const MOBILE_APP_VERSION_CODE = Number(import.meta.env.VITE_MOBILE_APP_VERSION_CODE || 3);
export const MOBILE_LAN_ORIGIN = stripTrailingSlash(import.meta.env.VITE_MOBILE_LAN_ORIGIN || 'http://192.168.1.19:5174');
export const MOBILE_DOWNLOAD_PAGE_URL = `${MOBILE_LAN_ORIGIN}/download.html`;
export const MOBILE_UPDATE_MANIFEST_URL = `${MOBILE_LAN_ORIGIN}/mobile-update.json`;
export const MOBILE_UPDATE_API_URL = `${MOBILE_LAN_ORIGIN}/api/updates/check`;
export const MOBILE_LOCAL_DATA_SCHEMA = String(
  import.meta.env.VITE_MOBILE_LOCAL_DATA_SCHEMA
    || `com.vankhammo.banhangwifi:${MOBILE_APP_VERSION_CODE}:${MOBILE_APP_VERSION}`
).trim();

const MOBILE_INSTALL_SCHEMA_KEY = 'kha.mobile.installSchema';
const MOBILE_LAST_RESET_KEY = 'kha.mobile.lastResetAt';
const MOBILE_UPDATE_DISMISSED_KEY = 'kha.mobile.dismissedUpdate';
const MOBILE_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

let updateCheckerInstalled = false;
let lastNativeUpdate = null;
let lastDispatchedUpdateToken = '';

function getStorage(type = 'localStorage') {
  try {
    if (typeof window === 'undefined') return null;
    return window[type] || null;
  } catch (_) {
    return null;
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

function clearStorage(storage) {
  if (!storage) return;
  try {
    storage.clear();
    return;
  } catch (_) {
    // Fall back to key-by-key removal below.
  }

  for (const key of listStorageKeys(storage)) {
    try {
      storage.removeItem(key);
    } catch (_) {
      // Ignore locked storage keys.
    }
  }
}

function writeStorageValue(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch (_) {
    // Ignore storage write failures.
  }
}

function readStorageValue(storage, key) {
  try {
    return storage?.getItem(key) || '';
  } catch (_) {
    return '';
  }
}

export function isNativeAppRuntime() {
  try {
    if (typeof window === 'undefined') return false;
    if (typeof window.Capacitor?.isNativePlatform === 'function') {
      return window.Capacitor.isNativePlatform();
    }

    const protocol = String(window.location?.protocol || '').toLowerCase();
    const hostname = String(window.location?.hostname || '').toLowerCase();
    const userAgent = String(window.navigator?.userAgent || '');
    return protocol === 'capacitor:'
      || (protocol === 'https:' && hostname === 'localhost')
      || /\bwv\b/i.test(userAgent);
  } catch (_) {
    return false;
  }
}

export function resetNativeLocalDataForCurrentVersion() {
  if (!isNativeAppRuntime()) return { reset: false, reason: 'not-native' };

  const localStorage = getStorage('localStorage');
  const sessionStorage = getStorage('sessionStorage');
  const previousSchema = readStorageValue(localStorage, MOBILE_INSTALL_SCHEMA_KEY);

  if (previousSchema === MOBILE_LOCAL_DATA_SCHEMA) {
    return { reset: false, reason: 'same-version', schema: previousSchema };
  }

  clearStorage(localStorage);
  clearStorage(sessionStorage);
  writeStorageValue(localStorage, MOBILE_INSTALL_SCHEMA_KEY, MOBILE_LOCAL_DATA_SCHEMA);
  writeStorageValue(localStorage, MOBILE_LAST_RESET_KEY, new Date().toISOString());

  return {
    reset: true,
    reason: previousSchema ? 'version-changed' : 'first-run',
    previousSchema,
    schema: MOBILE_LOCAL_DATA_SCHEMA,
  };
}

export async function clearNativeWebCaches() {
  if (!isNativeAppRuntime() || typeof window === 'undefined') return false;

  const jobs = [];

  if ('serviceWorker' in navigator) {
    jobs.push(
      navigator.serviceWorker.getRegistrations?.()
        .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
        .catch(() => null)
    );
  }

  if ('caches' in window) {
    jobs.push(
      window.caches.keys()
        .then(keys => Promise.all(keys.map(key => window.caches.delete(key))))
        .catch(() => null)
    );
  }

  await Promise.all(jobs);
  return jobs.length > 0;
}

function compareVersions(left, right) {
  const leftParts = String(left || '').replace(/^v/i, '').split(/[.-]/).map(part => Number.parseInt(part, 10));
  const rightParts = String(right || '').replace(/^v/i, '').split(/[.-]/).map(part => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightValue = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function asAbsoluteLanUrl(value, fallback = '') {
  const raw = String(value || '').trim();
  const safeFallback = String(fallback || '').trim();
  if (!raw) return safeFallback;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${MOBILE_LAN_ORIGIN}${raw}`;
  return raw;
}

function getUpdateVersionCode(item = {}) {
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  return Number(
    item.versionCode
      ?? item.version_code
      ?? item.androidVersionCode
      ?? item.android_version_code
      ?? metadata.versionCode
      ?? metadata.version_code
      ?? 0
  ) || 0;
}

function normalizeUpdateItem(rawItem, source) {
  const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
  const version = String(item.version || item.versionName || item.version_name || '').trim();
  const versionCode = getUpdateVersionCode(item);
  const downloadPageUrl = asAbsoluteLanUrl(item.downloadPageUrl || item.download_page_url, MOBILE_DOWNLOAD_PAGE_URL);
  const apkUrl = asAbsoluteLanUrl(
    item.apkUrl || item.apk_url || item.download_url || item.installer_url || item.url,
    downloadPageUrl
  );
  const title = String(item.title || item.name || MOBILE_APP_DISPLAY_NAME).trim();
  const notes = String(item.notes || item.message || item.description || '').trim();

  if (!version && !versionCode) return null;

  const newerByCode = versionCode > 0 && MOBILE_APP_VERSION_CODE > 0
    ? versionCode > MOBILE_APP_VERSION_CODE
    : false;
  const newerByVersion = version
    ? compareVersions(version, MOBILE_APP_VERSION) > 0
    : false;

  return {
    available: newerByCode || newerByVersion,
    source,
    platform: 'android',
    title,
    version,
    versionCode,
    currentVersion: MOBILE_APP_VERSION,
    currentVersionCode: MOBILE_APP_VERSION_CODE,
    notes,
    apkUrl,
    downloadUrl: apkUrl,
    downloadPageUrl,
    mandatory: Boolean(item.mandatory),
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function readUpdateFromApi() {
  const query = new URLSearchParams({
    platform: 'android',
    channel: 'stable',
    version: MOBILE_APP_VERSION,
    current_version: MOBILE_APP_VERSION,
  });
  const data = await fetchJson(`${MOBILE_UPDATE_API_URL}?${query.toString()}`);
  if (data?.update_available === false) return null;
  return normalizeUpdateItem(data?.item || data?.update || data?.latest || data?.data || data, 'api');
}

async function readUpdateFromManifest() {
  const data = await fetchJson(`${MOBILE_UPDATE_MANIFEST_URL}?t=${Date.now()}`);
  return normalizeUpdateItem(data?.item || data?.update || data?.latest || data, 'manifest');
}

function getUpdateToken(detail = {}) {
  return `${detail.versionCode || 0}:${detail.version || ''}:${detail.downloadUrl || detail.downloadPageUrl || ''}`;
}

function isUpdateDismissed(detail = {}) {
  const token = getUpdateToken(detail);
  if (!token) return false;
  return readStorageValue(getStorage('localStorage'), MOBILE_UPDATE_DISMISSED_KEY) === token;
}

function selectLatestUpdate(items = []) {
  return items
    .filter(item => item?.available)
    .sort((left, right) => {
      const codeDiff = (right.versionCode || 0) - (left.versionCode || 0);
      if (codeDiff !== 0) return codeDiff;
      return compareVersions(right.version, left.version);
    })[0] || null;
}

function dispatchNativeUpdate(detail) {
  if (!detail?.available || isUpdateDismissed(detail) || typeof window === 'undefined') return;

  const token = getUpdateToken(detail);
  if (token === lastDispatchedUpdateToken) return;
  lastDispatchedUpdateToken = token;
  lastNativeUpdate = detail;

  window.dispatchEvent(new CustomEvent(MOBILE_UPDATE_EVENT, { detail }));
  window.dispatchEvent(new CustomEvent('kha-update-available', {
    detail: {
      ...detail,
      source: `mobile-${detail.source || 'unknown'}`,
    },
  }));
}

export function getLatestNativeAppUpdate() {
  return lastNativeUpdate;
}

export function dismissNativeAppUpdate(detail = lastNativeUpdate) {
  const token = getUpdateToken(detail || {});
  if (!token) return;
  writeStorageValue(getStorage('localStorage'), MOBILE_UPDATE_DISMISSED_KEY, token);
}

export function openMobileDownloadUrl(detailOrUrl = lastNativeUpdate) {
  if (typeof window === 'undefined') return false;
  const url = typeof detailOrUrl === 'string'
    ? detailOrUrl
    : detailOrUrl?.downloadPageUrl || detailOrUrl?.downloadUrl || detailOrUrl?.apkUrl || MOBILE_DOWNLOAD_PAGE_URL;
  if (!url) return false;

  try {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (opened) return true;
  } catch (_) {
    // Fall back to same-window navigation below.
  }

  window.location.href = url;
  return true;
}

export async function checkNativeAppUpdate({ dispatch = true } = {}) {
  if (!isNativeAppRuntime()) return null;

  const candidates = await Promise.all([
    readUpdateFromApi().catch(() => null),
    readUpdateFromManifest().catch(() => null),
  ]);
  const latest = selectLatestUpdate(candidates);
  if (!latest) return null;

  lastNativeUpdate = latest;
  if (dispatch) dispatchNativeUpdate(latest);
  return latest;
}

export function installNativeUpdateChecker() {
  if (!isNativeAppRuntime() || updateCheckerInstalled || typeof window === 'undefined') return false;
  updateCheckerInstalled = true;

  const run = () => {
    checkNativeAppUpdate({ dispatch: true }).catch(() => {});
  };

  window.setTimeout(run, 3000);
  window.setInterval(run, MOBILE_UPDATE_CHECK_INTERVAL_MS);
  window.addEventListener('focus', run);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
  });

  return true;
}

export function installNativeRuntimeGuards() {
  const resetResult = resetNativeLocalDataForCurrentVersion();
  clearNativeWebCaches().catch(() => {});
  installNativeUpdateChecker();
  return resetResult;
}
