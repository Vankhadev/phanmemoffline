import {
  clearAuthSession,
  getAuthToken,
  getPendingLocalData,
  prepareForAuthenticatedPayload,
  replacePendingLocalData,
  saveAuthSession,
} from './authStorage';
import { getProductDisplayName } from './productSearch';
import { attachClientOrderMetadata, ensureClientOrderId } from './clientOrderId';
import { emitGlobalSyncEvents } from './eventEmitter';

export const AUTH_EXPIRED_EVENT = 'vankha-auth:expired';
export const SYNC_UPDATED_EVENT = 'vankha-sync:updated';
export const SYNC_BROADCAST_REQUEST_EVENT = 'vankha-sync:broadcast-request';
export const SYNC_CHECK_REQUEST_EVENT = 'vankha-sync:check-now';
export const PRINT_TEMPLATE_UPDATED_EVENT = 'vankha-print-template:updated';

let localSyncVersions = {};

// Try to initialize from localStorage snapshot
try {
  if (typeof window !== 'undefined') {
    const snapshot = JSON.parse(window.localStorage.getItem('kha_auth_snapshot') || 'null');
    if (snapshot && snapshot.syncVersions) {
      localSyncVersions = snapshot.syncVersions;
    }
  }
} catch (_) {}

export function setLocalSyncVersions(versions) {
  localSyncVersions = { ...localSyncVersions, ...versions };
}

// Add the SYNC_UPDATED_EVENT listener to sync localSyncVersions
if (typeof window !== 'undefined') {
  window.addEventListener(SYNC_UPDATED_EVENT, (event) => {
    const detail = event.detail || {};
    if (detail.syncVersions) {
      setLocalSyncVersions(detail.syncVersions);
    } else if (detail.changedTables) {
      const nextVersions = { ...localSyncVersions };
      detail.changedTables.forEach(table => {
        nextVersions[table] = (nextVersions[table] || 0) + 1;
      });
      setLocalSyncVersions(nextVersions);
    }
  });
}

// Cache implementation
const apiCache = new Map();

export function clearApiCache() {
  apiCache.clear();
}

function getUrlPathname(input) {
  try {
    const rawUrl = typeof input === 'string' ? input : String(input?.url || '');
    const urlObj = new URL(rawUrl, 'http://dummy-base');
    return urlObj.pathname;
  } catch (_) {
    return '';
  }
}

function getDependentTables(pathname) {
  const tables = [];
  if (pathname.startsWith('/invoices')) {
    tables.push('invoices', 'invoice_details', 'products', 'customers');
  } else if (pathname.startsWith('/customers')) {
    tables.push('customers');
  } else if (pathname.startsWith('/products')) {
    tables.push('products', 'product_categories');
  } else if (pathname.startsWith('/imports')) {
    tables.push('import_logs', 'import_details', 'products');
  } else if (pathname.startsWith('/partners')) {
    tables.push('partners');
  } else if (pathname.startsWith('/cash-book') || pathname.startsWith('/cashbook')) {
    tables.push('cash_book');
  } else if (pathname.startsWith('/dashboard') || pathname.startsWith('/stats') || pathname.startsWith('/accounting')) {
    tables.push('invoices', 'invoice_details', 'products', 'customers', 'import_logs', 'daily_stats', 'cash_book');
  } else if (pathname.startsWith('/settings')) {
    tables.push('settings');
  } else if (pathname.startsWith('/print-templates')) {
    tables.push('print_templates');
  } else {
    tables.push('invoices', 'products', 'customers', 'cash_book');
  }
  return tables;
}

function normalizeChangedTables(value = []) {
  const list = Array.isArray(value) ? value : [value];
  return Array.from(new Set(list.map(item => String(item || '').trim()).filter(Boolean)));
}

export function requestSyncCheck(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SYNC_CHECK_REQUEST_EVENT, {
    detail: { reason: 'manual', ...detail },
  }));
}

export function requestCrossTabSyncUpdate(detail = {}) {
  if (typeof window === 'undefined') return;
  const changedTables = normalizeChangedTables(detail.changedTables || detail.tables || []);
  if (changedTables.length === 0) return;
  const normalizedDetail = {
    ...detail,
    changedTables,
    tables: changedTables,
    ts: Number(detail.ts) || Date.now(),
    sourceTabId: window.__vankhaTabId || 'same-tab',
    __crossTabSyncSkipBroadcast: false,
  };

  window.dispatchEvent(new CustomEvent(SYNC_UPDATED_EVENT, {
    detail: normalizedDetail,
  }));

  // Same-tab notifications: also emit on the global event emitter so pages that
  // subscribe via globalSyncEmitter (Customers, KhoHang, nhacungcap, reports...)
  // refresh immediately after a mutation in the current tab, without requiring
  // a manual reload (Ctrl+R).
  try {
    emitGlobalSyncEvents(changedTables, normalizedDetail.op || null, normalizedDetail);
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[SYNC] emitGlobalSyncEvents failed', err);
  }

  window.dispatchEvent(new CustomEvent(SYNC_BROADCAST_REQUEST_EVENT, {
    detail: normalizedDetail,
  }));
}

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message || 'Lỗi API');
    this.name = 'ApiError';
    this.status = options.status ?? 0;
    this.data = options.data;
    this.response = options.response;
    this.cause = options.cause;
    this.isAuthError = Boolean(options.isAuthError || this.status === 401);
  }
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function hasUnresolvedEnvToken(value) {
  return /(%[A-Z0-9_]+%|\$\{?[A-Z0-9_]+\}?)/i.test(String(value || ''));
}

function readEnvText(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text || hasUnresolvedEnvToken(text)) return fallback;
  return text;
}

function readPortValue(value, fallback = '') {
  const text = readEnvText(value);
  if (!/^\d+$/.test(text)) return fallback;
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback;
  return String(port);
}

const LOCAL_API_BASE_OVERRIDE_KEY = 'kha.localApiBaseOverride';
const MOBILE_LAN_API_BASE = 'http://192.168.1.19:5174/api';
const ENV_VALUES = {
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL || '',
  VITE_API_BASE: import.meta.env.VITE_API_BASE || '',
  VITE_BACKEND_HOST: import.meta.env.VITE_BACKEND_HOST || '',
  VITE_API_HOST: import.meta.env.VITE_API_HOST || '',
  VITE_BACKEND_PORT: import.meta.env.VITE_BACKEND_PORT || '',
  VITE_API_PORT: import.meta.env.VITE_API_PORT || '',
  VITE_DEBUG_AUTH: import.meta.env.VITE_DEBUG_AUTH || '',
  DEV: import.meta.env.DEV ? 'true' : 'false',
};

function readEnvApiBase() {
  const candidates = [ENV_VALUES.VITE_API_BASE_URL, ENV_VALUES.VITE_API_BASE];
  for (const candidate of candidates) {
    const value = stripTrailingSlash(readEnvText(candidate));
    if (!value) continue;
    if (/^https?:\/\//i.test(value) && !isHttpApiBase(value)) continue;
    if (/^https?:\/\//i.test(value) || value.startsWith('/')) return value;
  }
  return '';
}

function readEnvValue(name, fallback = '') {
  return ENV_VALUES[name] || fallback;
}

function isDebugApiEnabled() {
  return String(readEnvValue('VITE_DEBUG_AUTH', readEnvValue('DEV', 'false'))).trim().toLowerCase() === 'true';
}

let lastLoggedApiBaseSignature = '';

function debugApiLog(event, payload = {}) {
  if (!isDebugApiEnabled() || typeof console === 'undefined' || typeof console.info !== 'function') return;
  console.info(`[KHA AUTH API] ${event}`, payload);
}

function readElectronApiBase() {
  try {
    if (typeof window === 'undefined') return '';
    return window.khaDesktop?.apiBase || window.electronAPI?.apiBase || '';
  } catch (_) {
    return '';
  }
}

function readStorageValue(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    return window.localStorage.getItem(key) || '';
  } catch (_) {
    return '';
  }
}

function writeStorageValue(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch (_) {
    // Ignore storage write failures in private/locked-down browser contexts.
  }
}

function removeStorageValue(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(key);
  } catch (_) {
    // Ignore storage removal failures in private/locked-down browser contexts.
  }
}

function parseUrl(value) {
  try {
    const baseHref = typeof window !== 'undefined' && window.location?.href
      ? window.location.href
      : 'http://127.0.0.1';
    return new URL(String(value || ''), baseHref);
  } catch (_) {
    return null;
  }
}

function isLoopbackHost(hostname) {
  const value = String(hostname || '').trim().toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]';
}

function isNativeWebViewRuntime() {
  try {
    if (typeof window === 'undefined') return false;
    if (typeof window.Capacitor?.isNativePlatform === 'function') return window.Capacitor.isNativePlatform();
    const protocol = String(window.location?.protocol || '').trim().toLowerCase();
    const hostname = String(window.location?.hostname || '').trim().toLowerCase();
    const userAgent = String(window.navigator?.userAgent || '');
    return protocol === 'capacitor:'
      || (protocol === 'https:' && hostname === 'localhost')
      || /\bwv\b/i.test(userAgent);
  } catch (_) {
    return false;
  }
}

function isLoopbackApiBase(value) {
  const parsed = parseUrl(value);
  return Boolean(parsed && isLoopbackHost(parsed.hostname));
}

function isHttpApiBase(value) {
  const parsed = parseUrl(value);
  return Boolean(parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname);
}

function extractApiBaseFromUrl(value) {
  const parsed = parseUrl(value);
  if (!parsed) return '';
  const pathname = String(parsed.pathname || '');
  const apiMatch = pathname.match(/^(.*?\/api)(?:\/|$)/i);
  if (!apiMatch?.[1]) return '';
  return stripTrailingSlash(`${parsed.protocol}//${parsed.host}${apiMatch[1]}`);
}

export function normalizeApiBaseOverride(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return '';

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawValue)
    ? rawValue
    : `http://${rawValue}`;
  const extractedBase = extractApiBaseFromUrl(withProtocol) || withProtocol;
  const parsed = parseUrl(extractedBase);
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return '';

  const currentPath = stripTrailingSlash(parsed.pathname || '');
  parsed.pathname = /\/api$/i.test(currentPath)
    ? currentPath
    : `${currentPath === '/' || !currentPath ? '' : currentPath}/api`;
  parsed.search = '';
  parsed.hash = '';

  return stripTrailingSlash(parsed.toString());
}

function readLocalApiBaseOverride() {
  const stored = normalizeApiBaseOverride(readStorageValue(LOCAL_API_BASE_OVERRIDE_KEY));
  if (!stored) return '';
  const envApiBase = normalizeApiBaseOverride(readEnvApiBase());
  if (isLoopbackApiBase(stored) && (isNativeWebViewRuntime() || (envApiBase && !isLoopbackApiBase(envApiBase)))) {
    removeStorageValue(LOCAL_API_BASE_OVERRIDE_KEY);
    return '';
  }
  if (isHttpApiBase(stored)) return stored;
  removeStorageValue(LOCAL_API_BASE_OVERRIDE_KEY);
  return '';
}

export function persistLocalApiBaseOverride(value) {
  const resolvedBase = normalizeApiBaseOverride(value);
  if (!resolvedBase || !isHttpApiBase(resolvedBase)) return '';
  writeStorageValue(LOCAL_API_BASE_OVERRIDE_KEY, resolvedBase);
  lastLoggedApiBaseSignature = '';
  return resolvedBase;
}

export function clearLocalApiBaseOverride() {
  removeStorageValue(LOCAL_API_BASE_OVERRIDE_KEY);
  lastLoggedApiBaseSignature = '';
}

export function getLocalApiBaseOverride() {
  return readLocalApiBaseOverride();
}

function getConfiguredBackendConnection() {
  const host = readEnvText(readEnvValue('VITE_BACKEND_HOST')) || readEnvText(readEnvValue('VITE_API_HOST'));
  const port = readPortValue(readEnvValue('VITE_BACKEND_PORT'))
    || readPortValue(readEnvValue('VITE_API_PORT'))
    || '7000';
  return { host, port };
}

function getLocalOverrideConnection() {
  const parsed = parseUrl(readLocalApiBaseOverride());
  if (!parsed) return { base: '', host: '', port: '' };
  return {
    base: stripTrailingSlash(parsed.toString()),
    host: parsed.hostname,
    port: String(parsed.port || (parsed.protocol === 'https:' ? '443' : '80')).trim(),
  };
}

function buildHttpApiBase(host, port, protocol = 'http:') {
  const normalizedHost = readEnvText(host);
  const normalizedPort = readPortValue(port);
  if (!normalizedHost || !normalizedPort) return '';
  return `${protocol}//${normalizedHost}:${normalizedPort}/api`;
}

function getBrowserLanApiBase() {
  if (typeof window === 'undefined' || !window.location) return '';
  const locationProtocol = window.location.protocol || '';
  const currentHost = String(window.location.hostname || '').trim();
  const { host: configuredHost, port: configuredPort } = getConfiguredBackendConnection();

  if (locationProtocol === 'file:') {
    return buildHttpApiBase(configuredHost || '127.0.0.1', configuredPort, 'http:');
  }

  if (locationProtocol !== 'http:' && locationProtocol !== 'https:') return '';

  if (configuredHost) {
    const protocol = isLoopbackHost(configuredHost) ? 'http:' : locationProtocol;
    return buildHttpApiBase(configuredHost, configuredPort, protocol);
  }

  if (isLoopbackHost(currentHost)) {
    return buildHttpApiBase('127.0.0.1', configuredPort, 'http:');
  }

  return buildHttpApiBase(currentHost, configuredPort, locationProtocol);
}

function resolveApiBaseDetails() {
  const envApiBase = stripTrailingSlash(readEnvApiBase());
  if (envApiBase) return { base: envApiBase, source: 'env' };

  const localOverrideApiBase = readLocalApiBaseOverride();
  if (localOverrideApiBase) return { base: localOverrideApiBase, source: 'local-override' };

  if (isNativeWebViewRuntime()) {
    return { base: MOBILE_LAN_API_BASE, source: 'mobile-lan-fallback' };
  }

  const electronApiBase = stripTrailingSlash(readElectronApiBase());
  if (electronApiBase) return { base: electronApiBase, source: 'electron' };

  const browserApiBase = stripTrailingSlash(getBrowserLanApiBase());
  if (browserApiBase) return { base: browserApiBase, source: 'browser-fallback' };

  return { base: '', source: 'relative-proxy' };
}

function logResolvedApiBase(details) {
  const signature = `${details?.source || 'unknown'}:${details?.base || ''}`;
  if (!signature || signature === lastLoggedApiBaseSignature) return;
  lastLoggedApiBaseSignature = signature;
  const backend = getConfiguredBackendConnection();
  debugApiLog('Resolved API base', {
    source: details?.source || 'unknown',
    base: details?.base || '',
    origin: typeof window !== 'undefined' ? window.location?.origin || window.location?.href || '' : '',
    backendHost: backend.host || '(auto)',
    backendPort: backend.port,
  });
}

function shouldUseDevApiProxyPath(pathname) {
  if (!pathname || !pathname.startsWith('/')) return false;
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;
  return /^\/(users|products|product-categories|customers|customer-types|invoices|invoice-details|returns|imports|inventory|accounting|excel-imports|store|settings|stats|cash-book|cashbook|payrolls|partners|combos|sync|features|updates|print-templates|dashboard)(\/|\?|$)/i.test(pathname);
}

function normalizeDevApiProxyPath(input) {
  if (!input) return input;
  if (!input.startsWith('/')) return input;
  if (input.startsWith('/api/') || input === '/api') return input;
  if (shouldUseDevApiProxyPath(input)) return `/api${input}`;
  return input;
}

function apiBaseAlreadyContainsApiPath(base) {
  if (!base) return false;
  try {
    return stripTrailingSlash(new URL(base).pathname || '') === '/api';
  } catch (_) {
    return /\/api$/i.test(stripTrailingSlash(base));
  }
}

function normalizeRequestPathForBase(input, base) {
  if (!input || !input.startsWith('/')) return input;
  if (!base) return normalizeDevApiProxyPath(input);

  if (apiBaseAlreadyContainsApiPath(base)) {
    if (input === '/api') return '';
    if (input.startsWith('/api/')) return input.slice(4) || '/';
    return input;
  }

  return normalizeDevApiProxyPath(input);
}

export function getApiBase() {
  const resolved = resolveApiBaseDetails();
  logResolvedApiBase(resolved);
  return resolved.base;
}

export function resolveApiUrl(input) {
  if (input === '') return getApiBase() || '/api';
  if (!input) return input;
  if (typeof input !== 'string') return input;
  if (/^https?:\/\//i.test(input) || input.startsWith('blob:') || input.startsWith('data:')) return input;
  if (!input.startsWith('/')) return input;
  const base = getApiBase();
  const normalizedInput = normalizeRequestPathForBase(input, base);
  return base ? `${base}${normalizedInput}` : normalizedInput;
}

export function resolveBackendAssetUrl(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (/^(https?:\/\/|blob:|data:|file:)/i.test(value)) return value;
  if (!value.startsWith('/')) return value;

  const base = getApiBase();
  if (!base) return value;

  try {
    const url = new URL(base);
    const basePath = stripTrailingSlash((url.pathname || '').replace(/\/api\/?$/i, ''));
    url.pathname = `${basePath}/${value.replace(/^\/+/, '')}`.replace(/\/+/g, '/');
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (_error) {
    return value;
  }
}

function buildHeaders(headers, { skipAuth = false, jsonBody = false } = {}) {
  const result = new Headers(headers || {});
  if (jsonBody && !result.has('Content-Type')) result.set('Content-Type', 'application/json');
  if (!skipAuth) {
    const token = getAuthToken();
    if (token && !result.has('Authorization')) result.set('Authorization', `Bearer ${token}`);
  }
  return result;
}

function dispatchAuthExpired(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail }));
}

export function handleUnauthorizedResponse(detail = {}) {
  clearApiCache();
  clearAuthSession({ clearVolatile: true, includePending: true });
  dispatchAuthExpired(detail);
}

function responseHasNoBody(response) {
  if (!response) return true;
  if ([204, 205, 304].includes(response.status)) return true;
  return response.headers?.get('content-length') === '0';
}

function isJsonResponse(response) {
  const contentType = response?.headers?.get('content-type') || '';
  return /(^|\s|;|,)(application\/json|[^\s;,]+\+json)(\s|;|,|$)/i.test(contentType);
}

function looksLikeJsonText(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (value === 'null' || value === 'true' || value === 'false') return true;
  if (value.startsWith('{') || value.startsWith('[') || value.startsWith('"')) return true;
  return /^-?\d/.test(value);
}

export async function readApiJson(response, options = {}) {
  if (responseHasNoBody(response)) return null;
  const text = await response.text();
  const trimmedText = typeof text === 'string' ? text.trim() : '';
  if (!trimmedText) return null;

  const shouldParseJson = Boolean(options.forceJson) || isJsonResponse(response) || looksLikeJsonText(trimmedText);
  if (!shouldParseJson) return text;

  try {
    return JSON.parse(text);
  } catch (error) {
    if (options.throwOnInvalidJson) throw error;
    return text;
  }
}

function collectApiErrorMessages(errors = []) {
  if (!Array.isArray(errors)) return [];
  return errors
    .map(item => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        return String(item.message || item.error || item.detail || '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function readStructuredDetailMessage(details) {
  if (!details) return '';
  if (typeof details === 'string') return details.trim();
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    return String(details.message || details.error || details.detail || details.reason || '').trim();
  }
  return '';
}

function sanitizeApiErrorMessage(message, data = null, fallback = 'Yêu cầu API thất bại.') {
  const text = String(message || '').trim() || fallback;
  const code = String(data?.code || data?.error_code || '').trim();
  if (/^PRINT_TEMPLATE/i.test(code) && code && !text.includes(code)) {
    return `${text} (${code})`;
  }
  return text;
}

export function getApiErrorMessage(data, fallback = 'Yêu cầu API thất bại.') {
  if (!data) return fallback;
  if (typeof data === 'string') return sanitizeApiErrorMessage(data, null, fallback);
  const messages = collectApiErrorMessages(data.errors);
  if (messages.length) return sanitizeApiErrorMessage(messages.join(', '), data, fallback);
  const detailMessage = readStructuredDetailMessage(data.details);
  const message = data.message || data.error || data.detail || detailMessage || fallback;
  return sanitizeApiErrorMessage(message, data, fallback);
}

function isPublicAuthEndpoint(url) {
  return typeof url === 'string' && /\/users\/(login|register|bootstrap-status|bootstrap-admin)(\?|$)/i.test(url);
}

function isApiRequestUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) && url.includes('/');
}

function buildInterceptedRequest(input, init = {}) {
  const url = resolveApiUrl(typeof input === 'string' ? input : String(input?.url || ''));
  const { syncBroadcast: _syncBroadcast, ...fetchInit } = init || {};
  const headers = buildHeaders(init.headers, {
    skipAuth: Boolean(init.skipAuth) || isPublicAuthEndpoint(url),
    jsonBody: init.body && !(init.body instanceof FormData) && !(init.body instanceof Blob) && !(init.body instanceof ArrayBuffer),
  });

  // Trích xuất client updated_at từ body object trước khi chuyển sang dạng JSON string
  let clientUpdatedAt = null;
  if (init.body && typeof init.body === 'object' && !(init.body instanceof FormData) && !(init.body instanceof Blob) && !(init.body instanceof ArrayBuffer)) {
    if (init.body.updated_at) {
      clientUpdatedAt = init.body.updated_at;
    }
  }

  const requestInit = { ...fetchInit, headers };
  if (requestInit.body && headers.get('Content-Type') === 'application/json' && typeof requestInit.body !== 'string') {
    requestInit.body = JSON.stringify(requestInit.body);
  }

  // Thêm các headers đặc tả tab hiện tại và thời gian bản ghi gốc để phục vụ đồng bộ & phát hiện xung đột
  const clientTabId = (typeof window !== 'undefined' && window.__vankhaTabId) || '';
  if (clientTabId) {
    headers.set('X-Client-Tab-Id', clientTabId);
  }
  if (clientUpdatedAt) {
    headers.set('X-Client-Updated-At', String(clientUpdatedAt));
  }

  return [typeof input === 'string' ? url : input, requestInit];
}

function shouldTreatAsExpiredSession(url, requestInit = {}) {
  if (requestInit.skipAuth) return false;
  const authorizationHeader = requestInit.headers instanceof Headers
    ? requestInit.headers.get('Authorization')
    : null;
  if (!authorizationHeader) return false;
  if (/^Bearer\s+local-mobile-/i.test(authorizationHeader)) return false;

  try {
    const parsed = new URL(String(url), typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    const pathname = parsed.pathname || '';
    return pathname !== '/api/users/login'
      && pathname !== '/api/users/register'
      && pathname !== '/api/users/bootstrap-status'
      && pathname !== '/api/users/bootstrap-admin';
  } catch (_) {
    const normalized = String(url || '');
    return !normalized.includes('/users/login')
      && !normalized.includes('/users/register')
      && !normalized.includes('/users/bootstrap-status')
      && !normalized.includes('/users/bootstrap-admin');
  }
}

function normalizeApiPathForSync(url) {
  try {
    const parsed = new URL(String(url || ''), typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    const pathname = String(parsed.pathname || '');
    const apiIndex = pathname.toLowerCase().lastIndexOf('/api');
    const normalized = apiIndex >= 0 ? pathname.slice(apiIndex + 4) : pathname;
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  } catch (_) {
    const text = String(url || '').split('?')[0] || '';
    const apiMatch = text.match(/\/api(\/.*)?$/i);
    return apiMatch ? (apiMatch[1] || '/') : text;
  }
}

function getMutationMethod(init = {}) {
  return String(init?.method || 'GET').trim().toUpperCase();
}

function isMutationMethod(method) {
  return method && !['GET', 'HEAD', 'OPTIONS'].includes(method);
}

function inferChangedTablesFromRequest(url, init = {}) {
  const method = getMutationMethod(init);
  if (!isMutationMethod(method)) return [];
  const path = normalizeApiPathForSync(url).toLowerCase();
  if (!path || path === '/') return [];
  if (/^\/users\/(login|register|bootstrap-status|bootstrap-admin)(\/|$)/.test(path)) return [];

  const tables = new Set();
  const add = (...items) => items.forEach(item => {
    if (item) tables.add(item);
  });

  if (path.startsWith('/products/variants') || /^\/products(\/|$)/.test(path)) add('products');
  if (path.startsWith('/product-categories')) add('product_categories', 'products');
  if (path.startsWith('/combos')) add('combos', 'products');
  if (path.startsWith('/imports')) add('import_logs', 'import_details', 'products');
  if (path.startsWith('/invoices')) add('invoices', 'invoice_details', 'products');
  if (path.startsWith('/customers')) add('customers');
  if (path.startsWith('/customer-types')) add('customer_types', 'customers');
  if (path.startsWith('/partners')) add('partners');
  if (path.startsWith('/inventory')) add('products');
  if (path.startsWith('/excel-imports')) add('products', 'product_categories');
  if (path.startsWith('/settings/negative-stock')) add('settings');
  if (path.startsWith('/print-templates')) add('print_templates');
  if (path.startsWith('/users')) add('users');
  if (path.startsWith('/cash-book') || path.startsWith('/cashbook')) add('cash_book');
  if (path.startsWith('/accounting')) add('accounting');

  return Array.from(tables);
}

function notifyApiMutation(input, init = {}, data = null) {
  if (init?.syncBroadcast === false) return;
  const method = getMutationMethod(init);
  const changedTables = inferChangedTablesFromRequest(input, init);
  if (changedTables.length === 0) return;
  if (data && typeof data === 'object' && !Array.isArray(data) && data.ok === false) return;

  let op = 'update';
  if (method === 'POST') op = 'insert';
  else if (method === 'DELETE') op = 'delete';

  requestCrossTabSyncUpdate({
    reason: `api-${method.toLowerCase()}:${normalizeApiPathForSync(input)}`,
    changedTables,
    method,
    path: normalizeApiPathForSync(input),
    source: 'api-client',
    op,
  });
}

export function installAuthenticatedFetch() {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function' || window.__vankhaFetchPatched) return;
  const originalFetch = window.fetch.bind(window);
  window.__vankhaOriginalFetch = originalFetch;
  window.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : String(input?.url || '');
    if (!isApiRequestUrl(rawUrl) && !String(rawUrl || '').startsWith('/')) return originalFetch(input, init);
    const [url, requestInit] = buildInterceptedRequest(input, init);
    const response = await executeApiRequest(originalFetch, url, requestInit);
    if (response.status === 401 && shouldTreatAsExpiredSession(url, requestInit)) {
      handleUnauthorizedResponse({ status: response.status, url });
    }
    if (response.ok) notifyApiMutation(url, init);
    return response;
  };
  window.__vankhaFetchPatched = true;
}

function getFetchImplementation() {
  if (typeof window !== 'undefined') {
    if (typeof window.__vankhaOriginalFetch === 'function') return window.__vankhaOriginalFetch;
    if (typeof window.fetch === 'function') return window.fetch.bind(window);
  }
  if (typeof fetch === 'function') return fetch.bind(globalThis);
  throw new Error('Fetch is not available in this environment.');
}

function buildApiNetworkError(url, error) {
  const resolved = resolveApiBaseDetails();
  const endpoint = String(url || '').trim() || resolved.base || '/api';
  const message = `Không thể kết nối tới máy chủ API (${endpoint}). Kiểm tra backend local hoặc cấu hình VITE_API_BASE_URL/VITE_BACKEND_PORT.`;
  debugApiLog('API request failed before response', {
    url: endpoint,
    apiBase: resolved.base,
    source: resolved.source,
    error: error?.message || String(error || ''),
  });
  return new ApiError(message, {
    cause: error,
    data: {
      ok: false,
      code: 'NETWORK_ERROR',
      message,
      detail: error?.message || String(error || ''),
      url: endpoint,
      apiBase: resolved.base,
      apiBaseSource: resolved.source,
      isNetworkError: true,
    },
  });
}

function buildLoopbackRetryUrls(url) {
  const parsed = parseUrl(url);
  if (!parsed || !/^https?:$/i.test(parsed.protocol) || !isLoopbackHost(parsed.hostname)) return [];

  const configured = getConfiguredBackendConnection();
  const localOverride = getLocalOverrideConnection();
  const currentPort = String(parsed.port || (parsed.protocol === 'https:' ? '443' : '80')).trim();
  const retryHost = isLoopbackHost(localOverride.host)
    ? localOverride.host
    : (isLoopbackHost(configured.host) ? configured.host : parsed.hostname);
  const retryPorts = [];
  const addPort = (value) => {
    const port = String(value || '').trim();
    if (!port || retryPorts.includes(port)) return;
    retryPorts.push(port);
  };

  addPort(localOverride.port);
  addPort(configured.port);
  addPort(parsed.port);
  addPort('7000');
  addPort('7001');
  addPort('7002');
  addPort('7003');
  addPort('7004');
  addPort('7005');
  addPort('7010');
  addPort('7100');
  addPort('3101');

  return retryPorts
    .filter(port => port !== currentPort)
    .map(port => `${parsed.protocol}//${retryHost}:${port}${parsed.pathname || ''}${parsed.search || ''}`);
}

async function fetchWithLoopbackRecovery(fetchImpl, url, requestInit, originalError) {
  const localOverrideBase = readLocalApiBaseOverride();
  const originalBase = extractApiBaseFromUrl(url);
  if (localOverrideBase && originalBase === localOverrideBase) {
    clearLocalApiBaseOverride();
  }

  const retryUrls = buildLoopbackRetryUrls(url);
  for (const retryUrl of retryUrls) {
    debugApiLog('Retrying API request on alternate loopback port', {
      from: url,
      to: retryUrl,
      method: requestInit?.method || 'GET',
    });

    try {
      const response = await fetchImpl(retryUrl, requestInit);
      const discoveredApiBase = persistLocalApiBaseOverride(retryUrl);
      debugApiLog('Recovered API request on alternate loopback port', {
        from: url,
        to: retryUrl,
        discoveredApiBase,
      });
      return response;
    } catch (retryError) {
      debugApiLog('Alternate loopback retry failed', {
        from: url,
        to: retryUrl,
        error: retryError?.message || String(retryError || ''),
      });
    }
  }

  // KHA: tat ca port thu cong deu fail -> probe health chu dong tren danh sach port,
  // neu tim duoc backend dang song thi retry request len port do roi moi throw.
  try {
    const probedBase = await probeBackendHealth({ host: retryHostCandidates(url), signal: requestInit?.signal });
    if (probedBase) {
      const retryUrl = replaceApiBaseInUrl(url, probedBase);
      debugApiLog('Recovered API request via health probe', { from: url, to: retryUrl });
      const response = await fetchImpl(retryUrl, requestInit);
      persistLocalApiBaseOverride(probedBase);
      return response;
    }
  } catch (probeErr) {
    debugApiLog('Health probe failed', { error: probeErr?.message || String(probeErr) });
  }

  throw buildApiNetworkError(url, originalError);
}

// KHA: tra host loopback tu url de probe.
function retryHostCandidates(url) {
  const parsed = parseUrl(url);
  if (!parsed) return '127.0.0.1';
  return isLoopbackHost(parsed.hostname) ? parsed.hostname : '127.0.0.1';
}

// KHA: thay api base trong url bang base moi (giu path/search).
function replaceApiBaseInUrl(url, newApiBase) {
  const parsed = parseUrl(url);
  const baseParsed = parseUrl(newApiBase);
  if (!parsed || !baseParsed) return url;
  const pathname = String(parsed.pathname || '');
  const apiIdx = pathname.toLowerCase().lastIndexOf('/api');
  const tail = apiIdx >= 0 ? pathname.slice(apiIdx + 4) : pathname;
  const newPath = (String(baseParsed.pathname || '').replace(/\/api$/i, '')) + '/api' + (tail.startsWith('/') ? tail : `/${tail}`);
  return `${baseParsed.protocol}//${baseParsed.host}${newPath}${parsed.search || ''}`;
}

// KHA: probe health chu dong. Thu lan luot danh sach port, tra apiBase dau tien song.
// Luu vao localStorage 'kha_backend_base_url' de lan sau dung lai (nhung neu health fail thi probe lai).
const KHA_BACKEND_BASE_URL_KEY = 'kha_backend_base_url';
const PROBE_PORTS = ['7000', '7001', '7002', '7003', '7004', '7005', '7010', '7100'];
const PROBE_TIMEOUT_MS = 1200;

let probingPromise = null;

export async function probeBackendHealth({ host = '127.0.0.1', signal } = {}) {
  if (typeof window === 'undefined') return '';
  // Thu base da luu truoc (kha_backend_base_url) truoc.
  const stored = readStorageValue(KHA_BACKEND_BASE_URL_KEY);
  if (stored) {
    try {
      const data = await fetchJsonWithTimeout(`${stored}/health`, PROBE_TIMEOUT_MS, signal);
      if (data && data.ok === true && data.service === 'phanmienoffline-backend') {
        return stored;
      }
    } catch (_) {}
  }
  // Probe lan luot cac port.
  if (probingPromise) return probingPromise;
  probingPromise = (async () => {
    try {
      for (const port of PROBE_PORTS) {
        const base = `http://${host}:${port}/api`;
        try {
          const data = await fetchJsonWithTimeout(`${base}/health`, PROBE_TIMEOUT_MS, signal);
          if (data && data.ok === true && data.service === 'phanmienoffline-backend') {
            writeStorageValue(KHA_BACKEND_BASE_URL_KEY, base);
            debugApiLog('probeBackendHealth: found backend', { base });
            return base;
          }
        } catch (_) {}
      }
      return '';
    } finally {
      probingPromise = null;
    }
  })();
  return probingPromise;
}

async function fetchJsonWithTimeout(url, timeoutMs, signal) {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') throw new Error('no fetch');
  const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await window.fetch(url, { signal: signal || (controller ? controller.signal : undefined) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function executeApiRequest(fetchImpl, url, requestInit) {
  try {
    return await fetchImpl(url, requestInit);
  } catch (error) {
    return fetchWithLoopbackRecovery(fetchImpl, url, requestInit, error);
  }
}

// PHẦN 4.4: timeout mẻc đểnh cho mọi request API (tránh treo khi backend không phản hồi)
const DEFAULT_API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS) || 30000;

export async function apiFetch(input, init = {}) {
  const fetchImpl = getFetchImplementation();
  let signal = init && init.signal;
  let timer = null;
  if (!signal && typeof AbortController !== 'undefined' && DEFAULT_API_TIMEOUT_MS > 0) {
    const controller = new AbortController();
    signal = controller.signal;
    timer = setTimeout(() => controller.abort(), DEFAULT_API_TIMEOUT_MS);
  }
  const effectiveInit = signal ? { ...init, signal } : init;
  const [url, requestInit] = buildInterceptedRequest(input, effectiveInit);
  try {
    const response = await executeApiRequest(fetchImpl, url, requestInit);
    if (timer) clearTimeout(timer);
    if (response.status === 401 && shouldTreatAsExpiredSession(url, requestInit)) {
      handleUnauthorizedResponse({ status: response.status, url });
      throw new ApiError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', {
        status: response.status,
        response,
        isAuthError: true,
      });
    }
    return response;
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      throw new ApiError('Yêu cầu API quá thời gian (${DEFAULT_API_TIMEOUT_MS / 1000}s). Vui lòng kiểm tra backend và thử lại.', { timeout: true, cause: err });
    }
    throw err;
  }
}

export async function apiJson(input, init = {}, fallbackMessage = 'Yêu cầu API thất bại.') {
  const method = String(init?.method || 'GET').trim().toUpperCase();
  const rawUrl = typeof input === 'string' ? input : String(input?.url || '');

  if (method === 'GET') {
    const pathname = getUrlPathname(rawUrl);
    const bypassCache = pathname.includes('/users/') || pathname.includes('/bootstrap-status');
    if (!bypassCache) {
      const cacheKey = rawUrl;
      const cached = apiCache.get(cacheKey);
      if (cached) {
        const dependentTables = getDependentTables(pathname);
        let isCacheValid = true;
        for (const table of dependentTables) {
          const currentVer = localSyncVersions[table] || 0;
          const cachedVer = cached.versions[table] || 0;
          if (currentVer !== cachedVer) {
            isCacheValid = false;
            break;
          }
        }
        if (isCacheValid) {
          return cached.data;
        }
      }
    }
  }

  const response = await apiFetch(input, init);
  let data;

  try {
    data = await readApiJson(response, {
      forceJson: response.ok,
      throwOnInvalidJson: response.ok,
    });
  } catch (error) {
    throw new ApiError('Phản hồi API không phải JSON hợp lệ.', {
      status: response.status,
      response,
      cause: error,
    });
  }

  if (!response.ok) {
    const message = getApiErrorMessage(data, fallbackMessage);
    throw new ApiError(message, {
      status: response.status,
      data,
      response,
    });
  }

  if (method === 'GET') {
    const pathname = getUrlPathname(rawUrl);
    const bypassCache = pathname.includes('/users/') || pathname.includes('/bootstrap-status');
    if (!bypassCache) {
      const dependentTables = getDependentTables(pathname);
      const versions = {};
      dependentTables.forEach(table => {
        versions[table] = localSyncVersions[table] || 0;
      });
      apiCache.set(rawUrl, {
        data,
        versions,
      });
    }
  }

  notifyApiMutation(input, init, data);
  return data;
}

export function assertApiSuccess(data, fallbackMessage = 'Yêu cầu API thất bại.') {
  if (!data || Array.isArray(data) || typeof data !== 'object') return data;
  if (Object.prototype.hasOwnProperty.call(data, 'ok') && data.ok === false) {
    throw new ApiError(getApiErrorMessage(data, fallbackMessage), {
      status: 200,
      data,
    });
  }
  return data;
}

export async function apiJsonChecked(input, init = {}, fallbackMessage = 'Yêu cầu API thất bại.') {
  const data = await apiJson(input, init, fallbackMessage);
  return assertApiSuccess(data, fallbackMessage);
}

function isOptionalEndpointError(error) {
  return error instanceof ApiError && [404, 405, 501].includes(Number(error.status));
}

async function apiJsonOptional(input, init = {}, options = {}) {
  try {
    return await apiJson(input, init, options.fallbackMessage || 'Yêu cầu API thất bại.');
  } catch (error) {
    if (!isOptionalEndpointError(error)) throw error;
    if (typeof options.fallback === 'function') return options.fallback(error);
    return options.fallback ?? null;
  }
}

function buildQuerySuffix(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (typeof value === 'boolean') query.set(key, value ? '1' : '0');
    else query.set(key, String(value));
  });
  return query.toString() ? `?${query.toString()}` : '';
}

export const accountingApi = {
  taxReport(params = {}) { return apiJsonChecked(`/accounting/tax-report${buildQuerySuffix(params)}`, {}, 'Không thể tải báo cáo thuế GTGT.'); },
  generateTaxReport(payload = {}) { return apiJsonChecked('/accounting/tax-reports/generate', { method: 'POST', body: payload }, 'Không thể tạo snapshot báo cáo thuế GTGT.'); },
  taxReports(params = {}) { return apiJsonChecked(`/accounting/tax-reports${buildQuerySuffix(params)}`, {}, 'Không thể tải lịch sử báo cáo thuế.'); },
  taxReportDetail(id) { return apiJsonChecked(`/accounting/tax-reports/${encodeURIComponent(id)}`, {}, 'Không thể tải chi tiết báo cáo thuế.'); },
  revenueProfit(params = {}) { return apiJsonChecked(`/accounting/summary/revenue-profit${buildQuerySuffix(params)}`, {}, 'Không thể tải tổng hợp doanh thu/lợi nhuận.'); },
  cashFund(params = {}) { return apiJsonChecked(`/accounting/cash-fund${buildQuerySuffix(params)}`, {}, 'Không thể tải quỹ kế toán.'); },
  customerDebts(params = {}) { return apiJsonChecked(`/accounting/debts/customers${buildQuerySuffix(params)}`, {}, 'Không thể tải công nợ khách hàng.'); },
  supplierDebts(params = {}) { return apiJsonChecked(`/accounting/debts/suppliers${buildQuerySuffix(params)}`, {}, 'Không thể tải công nợ nhà cung cấp.'); },
  einvoiceIn: {
    list(params = {}) { return apiJsonChecked(`/accounting/einvoice-in${buildQuerySuffix(params)}`, {}, 'Không thể tải hóa đơn điện tử đầu vào.'); },
    create(payload = {}) { return apiJsonChecked('/accounting/einvoice-in', { method: 'POST', body: payload }, 'Không thể tạo hóa đơn điện tử đầu vào.'); },
    update(id, payload = {}) { return apiJsonChecked(`/accounting/einvoice-in/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }, 'Không thể cập nhật hóa đơn điện tử đầu vào.'); },
    remove(id) { return apiJsonChecked(`/accounting/einvoice-in/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Không thể xóa hóa đơn điện tử đầu vào.'); },
  },
  einvoiceOut: {
    list(params = {}) { return apiJsonChecked(`/accounting/einvoice-out${buildQuerySuffix(params)}`, {}, 'Không thể tải hóa đơn điện tử đầu ra.'); },
    create(payload = {}) { return apiJsonChecked('/accounting/einvoice-out', { method: 'POST', body: payload }, 'Không thể tạo hóa đơn điện tử đầu ra.'); },
    update(id, payload = {}) { return apiJsonChecked(`/accounting/einvoice-out/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }, 'Không thể cập nhật hóa đơn điện tử đầu ra.'); },
    remove(id) { return apiJsonChecked(`/accounting/einvoice-out/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Không thể xóa hóa đơn điện tử đầu ra.'); },
  },
  bankAccounts(params = {}) { return apiJsonChecked(`/accounting/bank-accounts${buildQuerySuffix(params)}`, {}, 'Không thể tải tài khoản ngân hàng.'); },
  createBankAccount(payload = {}) { return apiJsonChecked('/accounting/bank-accounts', { method: 'POST', body: payload }, 'Không thể tạo tài khoản ngân hàng.'); },
  logs(params = {}) { return apiJsonChecked(`/accounting/logs${buildQuerySuffix(params)}`, {}, 'Không thể tải nhật ký hoạt động.'); },
  logDetail(id) { return apiJsonChecked(`/accounting/logs/${encodeURIComponent(id)}`, {}, 'Không thể tải chi tiết nhật ký hoạt động.'); },
};

export const inventoryApi = {
  report(params = {}) { return apiJsonChecked(`/inventory/report${buildQuerySuffix(params)}`, {}, 'Không thể tải báo cáo tồn kho.'); },
  negativeStock(params = {}) { return apiJsonChecked(`/inventory/negative-stock${buildQuerySuffix(params)}`, {}, 'Không thể tải danh sách âm kho.'); },
};

export const excelImportApi = {
  preview(payload = {}) { return apiJson('/excel-imports/preview', { method: 'POST', body: payload }, 'Không thể preview import Excel.'); },
  commit(payloadOrId = {}, legacyPayload = {}) {
    if (payloadOrId && typeof payloadOrId === 'object' && !Array.isArray(payloadOrId)) {
      return apiJson('/excel-imports/commit', { method: 'POST', body: payloadOrId }, 'Không thể ghi import Excel.');
    }
    return apiJson(`/excel-imports/${encodeURIComponent(payloadOrId)}/commit`, { method: 'POST', body: legacyPayload }, 'Không thể ghi import Excel.');
  },
  history(params = {}) { const query = new URLSearchParams(params); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/excel-imports/history${suffix}`, {}, 'Không thể tải lịch sử import Excel.'); },
  detail(id) { return apiJson(`/excel-imports/history/${encodeURIComponent(id)}`, {}, 'Không thể tải chi tiết import Excel.'); },
  list(params = {}) { return this.history(params); },
};

export const customersApi = {
  list(params = {}) { const query = new URLSearchParams(params); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/customers${suffix}`, {}, 'Không thể tải danh sách khách hàng.'); },
  create(payload = {}) { return apiJson('/customers', { method: 'POST', body: payload }, 'Không thể tạo khách hàng.'); },
  update(id, payload = {}) { return apiJson(`/customers/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }, 'Không thể cập nhật khách hàng.'); },
  remove(id) { return apiJson(`/customers/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Không thể xóa khách hàng.'); },
  bulkRemove(ids = []) { return apiJson('/customers/bulk', { method: 'DELETE', body: { ids } }, 'Không thể xóa nhiều khách hàng.'); },
};

export const customerTypesApi = {
  list() { return apiJson('/customer-types', {}, 'Không thể tải loại khách hàng.'); },
  create(payload = {}) { return apiJson('/customer-types', { method: 'POST', body: payload }, 'Không thể tạo loại khách hàng.'); },
  update(id, payload = {}) { return apiJson(`/customer-types/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }, 'Không thể cập nhật loại khách hàng.'); },
  remove(id) { return apiJson(`/customer-types/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Không thể xóa loại khách hàng.'); },
};

export const invoicesApi = {
  list(params = {}) {
    const query = new URLSearchParams(params);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiJson(`/invoices${suffix}`, {}, 'Không thể tải danh sách đơn hàng.');
  },
  detail(id) { return apiJson(`/invoices/${encodeURIComponent(id)}`, {}, 'Không thể tải chi tiết đơn hàng.'); },
  printData(idOrCode, params = {}) {
    const query = new URLSearchParams();
    const templateId = params.template_id ?? params.templateId;
    if (templateId !== undefined && templateId !== null && String(templateId).trim()) query.set('template_id', String(templateId).trim());
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiJsonChecked(`/invoices/${encodeURIComponent(idOrCode)}/print${suffix}`, {}, 'Không thể tải dữ liệu in hóa đơn.');
  },
  create(payload = {}) { return apiJsonChecked('/invoices', { method: 'POST', body: payload }, 'Không thể tạo đơn hàng.'); },
  update(id, payload = {}) { return apiJsonChecked(`/invoices/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }, 'Không thể cập nhật đơn hàng.'); },
  remove(id) { return apiJsonChecked(`/invoices/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Không thể hủy đơn hàng.'); },
  confirm(id) { return apiJsonChecked(`/invoices/${encodeURIComponent(id)}/confirm`, { method: 'PATCH' }, 'Không thể xác nhận thanh toán.'); },
};


function unwrapPrintTemplateItem(data) {
  if (!data) return null;
  if (data.item && typeof data.item === 'object' && !Array.isArray(data.item)) return data.item;
  if (data.template && typeof data.template === 'object' && !Array.isArray(data.template)) return data.template;
  if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    if (data.data.item && typeof data.data.item === 'object' && !Array.isArray(data.data.item)) return data.data.item;
    if (data.data.template && typeof data.data.template === 'object' && !Array.isArray(data.data.template)) return data.data.template;
    if (data.data.id || data.data.template_name || data.data.editor_document || data.data.layout_json) return data.data;
  }
  if (data.id || data.template_name || data.editor_document || data.layout_json) return data;
  return null;
}

function dispatchPrintTemplateUpdated(action, data = null, extra = {}) {
  if (typeof window === 'undefined') return;
  const item = unwrapPrintTemplateItem(data);
  window.dispatchEvent(new CustomEvent(PRINT_TEMPLATE_UPDATED_EVENT, {
    detail: {
      action,
      templateId: item?.id || extra.templateId || extra.id || null,
      template: item,
      response: data,
      ...extra,
    },
  }));
}

async function apiTemplateMutation(action, requestPromise, extra = {}) {
  const data = await requestPromise;
  dispatchPrintTemplateUpdated(action, data, extra);
  return data;
}

export const printTemplatesApi = {
  list(params = {}) {
    const query = new URLSearchParams();
    if (params.includeDeleted) query.set('include_deleted', '1');
    if (params.status) query.set('status', params.status);
    if (params.q) query.set('q', params.q);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiJsonChecked(`/print-templates${suffix}`, {}, 'Không thể tải danh sách mẫu in hóa đơn.');
  },
  default() { return apiJsonChecked('/print-templates/default', {}, 'Không thể tải mẫu in hóa đơn mặc định.'); },
  current(params = {}) {
    const query = new URLSearchParams();
    const templateId = params.template_id ?? params.templateId ?? params.id;
    if (templateId !== undefined && templateId !== null && String(templateId).trim()) query.set('template_id', String(templateId).trim());
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiJsonChecked(`/print-templates/current${suffix}`, {}, 'Không thể tải mẫu in hóa đơn hiện hành.');
  },
  active(params = {}) {
    const query = new URLSearchParams();
    const templateId = params.template_id ?? params.templateId ?? params.id;
    if (templateId !== undefined && templateId !== null && String(templateId).trim()) query.set('template_id', String(templateId).trim());
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiJsonChecked(`/print-templates/active${suffix}`, {}, 'Không thể tải mẫu in hóa đơn đang dùng.');
  },
  detail(id) { return apiJsonChecked(`/print-templates/${encodeURIComponent(id)}`, {}, 'Không thể tải chi tiết mẫu in hóa đơn.'); },
  create(payload = {}) { return apiTemplateMutation('create', apiJsonChecked('/print-templates', { method: 'POST', body: payload }, 'Không thể tạo mẫu in hóa đơn.')); },
  update(id, payload = {}) { return apiTemplateMutation('update', apiJsonChecked(`/print-templates/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }, 'Không thể cập nhật mẫu in hóa đơn.'), { templateId: id }); },
  autosave(id, payload = {}) { return apiTemplateMutation('autosave', apiJsonChecked(`/print-templates/${encodeURIComponent(id)}/autosave`, { method: 'PATCH', body: payload }, 'Không thể autosave mẫu in hóa đơn.'), { templateId: id }); },
  publish(id, payload = {}) { return apiTemplateMutation('publish', apiJsonChecked(`/print-templates/${encodeURIComponent(id)}/publish`, { method: 'POST', body: payload }, 'Không thể publish mẫu in hóa đơn.'), { templateId: id }); },
  discardDraft(id, payload = {}) { return apiTemplateMutation('discard-draft', apiJsonChecked(`/print-templates/${encodeURIComponent(id)}/discard-draft`, { method: 'POST', body: payload }, 'Không thể hủy draft mẫu in hóa đơn.'), { templateId: id }); },
  remove(id) { return apiTemplateMutation('remove', apiJsonChecked(`/print-templates/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Không thể xóa mẫu in hóa đơn.'), { templateId: id }); },
  setDefault(id) { return apiTemplateMutation('set-default', apiJsonChecked(`/print-templates/${encodeURIComponent(id)}/set-default`, { method: 'POST' }, 'Không thể đặt mẫu in hóa đơn mặc định.'), { templateId: id }); },
  uploadLogo(id, file) {
    const formData = new FormData();
    formData.append('logo', file);
    return apiTemplateMutation('upload-logo', apiJsonChecked(`/print-templates/${encodeURIComponent(id)}/logo`, { method: 'POST', body: formData }, 'Không thể upload logo mẫu in hóa đơn.'), { templateId: id });
  },
  removeLogo(id) { return apiTemplateMutation('remove-logo', apiJsonChecked(`/print-templates/${encodeURIComponent(id)}/logo`, { method: 'DELETE' }, 'Không thể xóa logo mẫu in hóa đơn.'), { templateId: id }); },
};

export const authApi = {
  login(payload = {}) {
    const { email, password, ...metadata } = payload || {};
    return apiJson('/users/login', { method: 'POST', body: { email, password, ...metadata } }, 'Đăng nhập thất bại.');
  },
  register(payload) { return apiJson('/users/register', { method: 'POST', body: payload }, 'Đăng ký thất bại.'); },
  bootstrapStatus() { return apiJson('/users/bootstrap-status', {}, 'Không thể tải trạng thái thiết lập tài khoản.'); },
  bootstrapAdmin(payload) { return apiJson('/users/bootstrap-admin', { method: 'POST', body: payload }, 'Thiết lập quản trị viên thất bại.'); },
  profile() { return apiJson('/users/profile', {}, 'Không thể tải thông tin tài khoản.'); },
  logout() { return apiJson('/users/logout', { method: 'POST' }, 'Không thể đăng xuất.'); },
  logoutAll() { return apiJson('/users/logout-all', { method: 'POST' }, 'Không thể đăng xuất mọi phiên.'); },
  syncVersions() { return apiJson('/sync/versions', {}, 'Không thể lấy phiên bản đồng bộ.'); },
  syncPull(payload = {}) { return apiJson('/sync/pull', { method: 'POST', body: payload }, 'Không thể kéo dữ liệu đồng bộ.'); },
  syncPush(payload = {}) { return apiJson('/sync/push', { method: 'POST', body: payload }, 'Không thể đẩy dữ liệu đồng bộ.'); },
  restoreScan() { return apiJson('/database/restore-scan', { method: 'POST' }, 'Không thể khôi phục dữ liệu.'); },
};

export const dataGuardianApi = {
  status() { return apiJson('/data-guardian/status', {}, 'Không thể tải trạng thái backup.'); },
  backups(params = {}) {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiJson(`/data-guardian/backups${suffix}`, {}, 'Không thể tải danh sách backup.');
  },
  backupNow() { return apiJson('/data-guardian/backup-now', { method: 'POST' }, 'Không thể tạo backup thủ công.'); },
  restore(payload = {}) { return apiJson('/data-guardian/restore', { method: 'POST', body: payload }, 'Không thể khôi phục dữ liệu.'); },
  download(path) {
    const query = new URLSearchParams({ path: String(path || '') });
    return apiJson(`/data-guardian/download?${query.toString()}`, {}, 'Không thể tải file backup.');
  },
};

export const usersApi = {
  list() { return apiJson('/users', {}, 'Không thể tải danh sách người dùng.'); },
  update(id, payload = {}) { return apiJson(`/users/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }, 'Không thể cập nhật người dùng.'); },
};

export const settingsApi = {
  get() { return apiJsonChecked('/settings/negative-stock', {}, 'Không thể tải cài đặt xuất âm tồn kho.'); },
  update(payload = {}) { return apiJsonChecked('/settings/negative-stock', { method: 'PUT', body: payload }, 'Không thể lưu cài đặt xuất âm tồn kho.'); },
};

export const featuresApi = {
  list(params = {}) { const query = new URLSearchParams(); if (params.includeInactive) query.set('include_inactive', '1'); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/features${suffix}`, {}, 'Không thể tải danh sách tính năng.'); },
  detail(id) { return apiJson(`/features/${encodeURIComponent(id)}`, {}, 'Không thể tải chi tiết tính năng.'); },
  create(payload = {}) { return apiJson('/features', { method: 'POST', body: payload }, 'Không thể tạo tính năng.'); },
  update(id, payload = {}) { return apiJson(`/features/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }, 'Không thể cập nhật tính năng.'); },
  remove(id, params = {}) { const query = new URLSearchParams(); if (params.hard) query.set('hard', '1'); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/features/${encodeURIComponent(id)}${suffix}`, { method: 'DELETE' }, 'Không thể xóa tính năng.'); },
};

export const updatesApi = {
  list(params = {}) { const query = new URLSearchParams(); if (params.includeInactive) query.set('include_inactive', '1'); if (params.platform) query.set('platform', params.platform); if (params.channel) query.set('channel', params.channel); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/updates${suffix}`, {}, 'Không thể tải danh sách bản cập nhật.'); },
  latest(params = {}) { const query = new URLSearchParams(); if (params.platform) query.set('platform', params.platform); if (params.channel) query.set('channel', params.channel); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/updates/latest${suffix}`, {}, 'Không thể tải bản cập nhật mới nhất.'); },
  check(params = {}) { const query = new URLSearchParams(); if (params.platform) query.set('platform', params.platform); if (params.channel) query.set('channel', params.channel); const currentVersion = params.version ?? params.current_version ?? params.currentVersion; if (currentVersion !== undefined && currentVersion !== null && String(currentVersion).trim()) { query.set('version', String(currentVersion).trim()); query.set('current_version', String(currentVersion).trim()); } const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/updates/check${suffix}`, {}, 'Không thể kiểm tra bản cập nhật.'); },
  detail(id) { return apiJson(`/updates/${encodeURIComponent(id)}`, {}, 'Không thể tải chi tiết bản cập nhật.'); },
  create(payload = {}) { return apiJson('/updates', { method: 'POST', body: payload }, 'Không thể tạo bản cập nhật.'); },
  update(id, payload = {}) { return apiJson(`/updates/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }, 'Không thể cập nhật bản cập nhật.'); },
  publish(id) { return apiJson(`/updates/${encodeURIComponent(id)}/publish`, { method: 'PATCH' }, 'Không thể phát hành bản cập nhật.'); },
  unpublish(id) { return apiJson(`/updates/${encodeURIComponent(id)}/unpublish`, { method: 'PATCH' }, 'Không thể hủy phát hành bản cập nhật.'); },
  remove(id, params = {}) { const query = new URLSearchParams(); if (params.hard) query.set('hard', '1'); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/updates/${encodeURIComponent(id)}${suffix}`, { method: 'DELETE' }, 'Không thể xóa bản cập nhật.'); },
};


export function persistAuthSnapshot(payload = {}) {
  return saveAuthSession(payload);
}

export function persistAuthenticatedPayload(payload = {}) {
  return prepareForAuthenticatedPayload(payload);
}

export async function pullServerBootstrapData(options = {}) {
  const syncPayload = options && typeof options === 'object' ? options : {};
  const sync = await authApi.syncPull(syncPayload);

  return {
    ...(sync && typeof sync === 'object' ? sync : {}),
  };
}

export async function pushPendingLocalData() {
  const pending = getPendingLocalData();
  const pendingOrders = Array.isArray(pending.orders) ? pending.orders : [];
  const pendingCustomers = Array.isArray(pending.customers) ? pending.customers : [];
  const normalizedOrderPairs = [];
  const result = {
    orders: [],
    customers: pendingCustomers,
  };

  for (const order of pendingOrders) {
    const normalized = normalizePendingOrder(order);
    if (normalized) {
      normalizedOrderPairs.push({ original: order, normalized });
      result.orders.push(normalized);
    }
  }

  const hasPendingData = result.orders.length > 0 || result.customers.length > 0;
  if (!hasPendingData) {
    return { ...result, response: null, retained: { orders: pendingOrders, customers: pendingCustomers } };
  }

  const response = await authApi.syncPush({ pending: result });
  const retained = buildRetainedPendingLocalData({
    pendingOrders,
    pendingCustomers,
    normalizedOrderPairs,
    response,
  });
  replacePendingLocalData(retained);
  return { ...result, response, retained };
}

function normalizeAction(value) {
  return String(value || '').trim().toLowerCase();
}

function isSuccessfulOrderSyncResult(item = {}) {
  if (!item || typeof item !== 'object') return false;
  const action = normalizeAction(item.action);
  if (action === 'created_pending') return Boolean(item.id || item.invoice_code);
  if (action === 'existing_idempotent') return Boolean(item.id || item.invoice_code || item.idempotent === true);
  return item.idempotent === true && Boolean(item.id || item.invoice_code || item.client_order_id);
}

function isSuccessfulCustomerSyncResult(item = {}) {
  if (!item || typeof item !== 'object') return false;
  const action = normalizeAction(item.action);
  return Boolean(item.id) && (action === 'created' || action === 'updated');
}

function buildSuccessfulClientOrderIdSet(response = {}) {
  const acceptedOrders = Array.isArray(response?.accepted?.orders) ? response.accepted.orders : [];
  return new Set(acceptedOrders
    .filter(isSuccessfulOrderSyncResult)
    .map(item => String(item.client_order_id || '').trim())
    .filter(Boolean));
}

function buildRetainedOrders({ pendingOrders = [], normalizedOrderPairs = [], response = {} } = {}) {
  if (!response || response.ok === false) return pendingOrders;
  const successfulClientOrderIds = buildSuccessfulClientOrderIdSet(response);
  if (!successfulClientOrderIds.size) return pendingOrders;

  const successfulOriginalOrders = new Set();
  for (const pair of normalizedOrderPairs) {
    const clientOrderId = String(pair?.normalized?.client_order_id || '').trim();
    if (clientOrderId && successfulClientOrderIds.has(clientOrderId)) successfulOriginalOrders.add(pair.original);
  }

  return pendingOrders.filter(order => !successfulOriginalOrders.has(order));
}

function buildRetainedCustomers({ pendingCustomers = [], response = {} } = {}) {
  if (!response || response.ok === false) return pendingCustomers;
  const acceptedCustomers = Array.isArray(response?.accepted?.customers) ? response.accepted.customers : [];

  if (acceptedCustomers.length !== pendingCustomers.length) return pendingCustomers;

  return pendingCustomers.filter((_, index) => !isSuccessfulCustomerSyncResult(acceptedCustomers[index]));
}

function buildRetainedPendingLocalData({ pendingOrders = [], pendingCustomers = [], normalizedOrderPairs = [], response = {} } = {}) {
  return {
    orders: buildRetainedOrders({ pendingOrders, normalizedOrderPairs, response }),
    customers: buildRetainedCustomers({ pendingCustomers, response }),
  };
}

function normalizePendingOrder(order) {
  const payload = order?.payload && typeof order.payload === 'object' ? order.payload : order;
  if (!payload || typeof payload !== 'object') return null;

  const cart = Array.isArray(order?.cart) ? order.cart : [];
  const details = Array.isArray(payload.details) && payload.details.length > 0
    ? payload.details
    : cart.reduce((list, item) => {
        const source = item && typeof item === 'object' ? item : null;
        if (!source) return list;

        const productName = getProductDisplayName(source);
        list.push({
          type: source.type || source.item_type || 'product',
          item_type: source.item_type || source.type || 'product',
          combo_id: source.combo_id || null,
          product_id: source.product_id || null,
          variant_id: source.variant_id || null,
          parent_id: source.parent_id || null,
          parent_name: source.parent_name || '',
          variant_name: source.variant_name || '',
          product_name: productName || source.product_name || source.name || '',
          product_sku: source.product_sku || source.sku || '',
          name: productName || source.name || source.product_name || '',
          sku: source.sku || source.product_sku || '',
          quantity: Number(source.quantity) || 1,
          unit_price: Number(source.unit_price) || 0,
          discount_amount: Number(source.discount_amount) || 0,
          discount_percent: Number(source.discount_percent) || 0,
          line_total: Number(source.line_total) || 0,
        });
        return list;
      }, []);

  if (!Array.isArray(details) || details.length === 0) return null;

  const clientOrderId = ensureClientOrderId(order || payload);
  return attachClientOrderMetadata({
    ...payload,
    client_order_id: clientOrderId,
    client_order_status: payload.client_order_status || 'pending',
    details,
  });
}
