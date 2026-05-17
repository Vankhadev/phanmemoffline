const STORAGE_KEY = 'kha_license_activation_v1';

function safeParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch (_) {
    return null;
  }
}

function normalizeLicense(license) {
  if (!license || typeof license !== 'object') return null;
  return {
    id: license.id || null,
    key: license.key || license.license_key || '',
    status: license.status || '',
    validity_days: Number(license.validity_days) || 0,
    activated_at: license.activated_at || null,
    expires_at: license.expires_at || null,
    days_remaining: license.days_remaining ?? null,
    server_time: license.server_time || null,
    saved_at: new Date().toISOString(),
  };
}

export function getStoredLicense() {
  if (typeof window === 'undefined') return null;
  return normalizeLicense(safeParse(window.localStorage.getItem(STORAGE_KEY)));
}

export function saveStoredLicense(license) {
  if (typeof window === 'undefined') return null;
  const normalized = normalizeLicense(license);
  if (!normalized) return null;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearStoredLicense() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function isStoredLicenseStillValid(license = getStoredLicense()) {
  if (!license?.expires_at) return false;
  const expiresAt = new Date(license.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function getStoredLicenseDaysRemaining(license = getStoredLicense()) {
  if (!license?.expires_at) return 0;
  const expiresAt = new Date(license.expires_at).getTime();
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
}
