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

export const AUTH_EXPIRED_EVENT = 'vankha-auth:expired';
export const SYNC_UPDATED_EVENT = 'vankha-sync:updated';
export const SYNC_CHECK_REQUEST_EVENT = 'vankha-sync:check-now';

export function requestSyncCheck(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SYNC_CHECK_REQUEST_EVENT, {
    detail: { reason: 'manual', ...detail },
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

const LOCAL_API_BASE_OVERRIDE_KEY = 'kha.localApiBaseOverride';

function readEnvApiBase() {
  try {
    return import.meta?.env?.VITE_API_BASE_URL || import.meta?.env?.VITE_API_BASE || '';
  } catch (_) {
    return '';
  }
}

function readEnvValue(name, fallback = '') {
  try {
    return import.meta?.env?.[name] || fallback;
  } catch (_) {
    return fallback;
  }
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

function isLoopbackApiBase(value) {
  const parsed = parseUrl(value);
  return Boolean(parsed && isLoopbackHost(parsed.hostname));
}

function extractApiBaseFromUrl(value) {
  const parsed = parseUrl(value);
  if (!parsed) return '';
  const pathname = String(parsed.pathname || '');
  const apiMatch = pathname.match(/^(.*?\/api)(?:\/|$)/i);
  if (!apiMatch?.[1]) return '';
  return stripTrailingSlash(`${parsed.protocol}//${parsed.host}${apiMatch[1]}`);
}

function readLocalApiBaseOverride() {
  const stored = stripTrailingSlash(readStorageValue(LOCAL_API_BASE_OVERRIDE_KEY));
  if (!stored) return '';
  if (isLoopbackApiBase(stored)) return stored;
  removeStorageValue(LOCAL_API_BASE_OVERRIDE_KEY);
  return '';
}

function persistLocalApiBaseOverride(value) {
  const resolvedBase = stripTrailingSlash(extractApiBaseFromUrl(value) || value);
  if (!resolvedBase || !isLoopbackApiBase(resolvedBase)) return '';
  writeStorageValue(LOCAL_API_BASE_OVERRIDE_KEY, resolvedBase);
  return resolvedBase;
}

function clearLocalApiBaseOverride() {
  removeStorageValue(LOCAL_API_BASE_OVERRIDE_KEY);
}

function getConfiguredBackendConnection() {
  const host = String(readEnvValue('VITE_BACKEND_HOST') || readEnvValue('VITE_API_HOST') || '').trim();
  const port = String(readEnvValue('VITE_BACKEND_PORT') || readEnvValue('VITE_API_PORT') || '3001').trim() || '3001';
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
  const normalizedHost = String(host || '').trim();
  const normalizedPort = String(port || '').trim();
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

  const electronApiBase = stripTrailingSlash(readElectronApiBase());
  if (electronApiBase) return { base: electronApiBase, source: 'electron' };

  const localOverrideApiBase = readLocalApiBaseOverride();
  if (localOverrideApiBase) return { base: localOverrideApiBase, source: 'local-override' };

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
  return /^\/(users|products|product-categories|customers|customer-types|invoices|invoice-details|returns|imports|excel-imports|store|stats|cash-book|cashbook|payrolls|partners|combos|sync|features|updates|dashboard)(\/|\?|$)/i.test(pathname);
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

export function getApiErrorMessage(data, fallback = 'Yêu cầu API thất bại.') {
  if (!data) return fallback;
  if (typeof data === 'string') return data || fallback;
  const messages = collectApiErrorMessages(data.errors);
  if (messages.length) return messages.join(', ');
  return data.message || data.error || data.detail || (typeof data.details === 'string' ? data.details : '') || fallback;
}

function isPublicAuthEndpoint(url) {
  return typeof url === 'string' && /\/users\/(login|register|bootstrap-status|bootstrap-admin)(\?|$)/i.test(url);
}

function isApiRequestUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) && url.includes('/');
}

function buildInterceptedRequest(input, init = {}) {
  const url = resolveApiUrl(typeof input === 'string' ? input : String(input?.url || ''));
  const headers = buildHeaders(init.headers, {
    skipAuth: Boolean(init.skipAuth) || isPublicAuthEndpoint(url),
    jsonBody: init.body && !(init.body instanceof FormData) && !(init.body instanceof Blob) && !(init.body instanceof ArrayBuffer),
  });
  const requestInit = { ...init, headers };
  if (requestInit.body && headers.get('Content-Type') === 'application/json' && typeof requestInit.body !== 'string') {
    requestInit.body = JSON.stringify(requestInit.body);
  }
  return [typeof input === 'string' ? url : input, requestInit];
}

function shouldTreatAsExpiredSession(url, requestInit = {}) {
  if (requestInit.skipAuth) return false;
  const authorizationHeader = requestInit.headers instanceof Headers
    ? requestInit.headers.get('Authorization')
    : null;
  if (!authorizationHeader) return false;

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
  addPort('3001');
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

  throw buildApiNetworkError(url, originalError);
}

async function executeApiRequest(fetchImpl, url, requestInit) {
  try {
    return await fetchImpl(url, requestInit);
  } catch (error) {
    return fetchWithLoopbackRecovery(fetchImpl, url, requestInit, error);
  }
}

export async function apiFetch(input, init = {}) {
  const fetchImpl = getFetchImplementation();
  const [url, requestInit] = buildInterceptedRequest(input, init);
  const response = await executeApiRequest(fetchImpl, url, requestInit);
  if (response.status === 401 && shouldTreatAsExpiredSession(url, requestInit)) {
    handleUnauthorizedResponse({ status: response.status, url });
    throw new ApiError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', {
      status: response.status,
      response,
      isAuthError: true,
    });
  }
  return response;
}

export async function apiJson(input, init = {}, fallbackMessage = 'Yêu cầu API thất bại.') {
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
  printData(idOrCode) { return apiJsonChecked(`/invoices/${encodeURIComponent(idOrCode)}/print`, {}, 'Không thể tải dữ liệu in hóa đơn.'); },
  create(payload = {}) { return apiJsonChecked('/invoices', { method: 'POST', body: payload }, 'Không thể tạo đơn hàng.'); },
  update(id, payload = {}) { return apiJsonChecked(`/invoices/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }, 'Không thể cập nhật đơn hàng.'); },
  remove(id) { return apiJsonChecked(`/invoices/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Không thể hủy đơn hàng.'); },
  confirm(id) { return apiJsonChecked(`/invoices/${encodeURIComponent(id)}/confirm`, { method: 'PATCH' }, 'Không thể xác nhận thanh toán.'); },
};

export const authApi = {
  login({ email, password }) { return apiJson('/users/login', { method: 'POST', body: { email, password } }, 'Đăng nhập thất bại.'); },
  register(payload) { return apiJson('/users/register', { method: 'POST', body: payload }, 'Đăng ký thất bại.'); },
  bootstrapStatus() { return apiJson('/users/bootstrap-status', {}, 'Không thể tải trạng thái thiết lập tài khoản.'); },
  bootstrapAdmin(payload) { return apiJson('/users/bootstrap-admin', { method: 'POST', body: payload }, 'Thiết lập quản trị viên thất bại.'); },
  profile() { return apiJson('/users/profile', {}, 'Không thể tải thông tin tài khoản.'); },
  logout() { return apiJson('/users/logout', { method: 'POST' }, 'Không thể đăng xuất.'); },
  logoutAll() { return apiJson('/users/logout-all', { method: 'POST' }, 'Không thể đăng xuất mọi phiên.'); },
  syncVersions() { return apiJson('/sync/versions', {}, 'Không thể lấy phiên bản đồng bộ.'); },
  syncPull(payload = {}) { return apiJson('/sync/pull', { method: 'POST', body: payload }, 'Không thể kéo dữ liệu đồng bộ.'); },
  syncPush(payload = {}) { return apiJson('/sync/push', { method: 'POST', body: payload }, 'Không thể đẩy dữ liệu đồng bộ.'); },
};

export const usersApi = {
  list() { return apiJson('/users', {}, 'Không thể tải danh sách người dùng.'); },
  update(id, payload = {}) { return apiJson(`/users/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }, 'Không thể cập nhật người dùng.'); },
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
