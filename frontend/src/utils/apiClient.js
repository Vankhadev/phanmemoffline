import {
  clearAuthSession,
  clearPendingLocalData,
  getAuthToken,
  getPendingLocalData,
  prepareForAuthenticatedPayload,
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

function readElectronApiBase() {
  try {
    if (typeof window === 'undefined') return '';
    return window.khaDesktop?.apiBase || window.electronAPI?.apiBase || '';
  } catch (_) {
    return '';
  }
}

function isLoopbackHost(hostname) {
  const value = String(hostname || '').trim().toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]';
}

function getBrowserLanApiBase() {
  if (typeof window === 'undefined' || !window.location) return '';
  const protocol = window.location.protocol || '';
  if (protocol !== 'http:') return '';

  const configuredHost = readEnvValue('VITE_BACKEND_HOST') || readEnvValue('VITE_API_HOST');
  const configuredPort = readEnvValue('VITE_BACKEND_PORT') || readEnvValue('VITE_API_PORT') || '3001';
  const currentHost = String(window.location.hostname || '').trim();
  const host = configuredHost || (isLoopbackHost(currentHost) ? '' : currentHost);
  if (!host) return '';
  return `${protocol}//${host}:${configuredPort}/api`;
}

function shouldUseDevApiProxyPath(pathname) {
  if (!pathname || !pathname.startsWith('/')) return false;
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;
  return /^\/(users|products|product-categories|customers|customer-types|invoices|invoice-details|returns|imports|excel-imports|store|stats|cash-book|cashbook|payrolls|partners|combos|print-templates|sapo|sync|mobile|features|updates|dashboard|license-keys)(\/|\?|$)/i.test(pathname);
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
  return stripTrailingSlash(readEnvApiBase() || readElectronApiBase() || getBrowserLanApiBase() || '');
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

export function getApiErrorMessage(data, fallback = 'Yêu cầu API thất bại.') {
  if (!data) return fallback;
  if (typeof data === 'string') return data || fallback;
  if (Array.isArray(data.errors) && data.errors.length) return data.errors.join(', ');
  return data.message || data.error || fallback;
}

function isPublicAuthEndpoint(url) {
  return typeof url === 'string' && (/\/users\/(login|register|bootstrap-status|bootstrap-admin)(\?|$)/i.test(url) || /\/license-keys\/status(\?|$)/i.test(url));
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
  window.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' ? input : String(input?.url || '');
    if (!isApiRequestUrl(rawUrl) && !String(rawUrl || '').startsWith('/')) return originalFetch(input, init);
    const [url, requestInit] = buildInterceptedRequest(input, init);
    return originalFetch(url, requestInit);
  };
  window.__vankhaFetchPatched = true;
}

function getFetchImplementation() {
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') return window.fetch.bind(window);
  if (typeof fetch === 'function') return fetch.bind(globalThis);
  throw new Error('Fetch is not available in this environment.');
}

export async function apiFetch(input, init = {}) {
  const fetchImpl = getFetchImplementation();
  const [url, requestInit] = buildInterceptedRequest(input, init);
  const response = await fetchImpl(url, requestInit);
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

const MOBILE_ADMIN_UNAVAILABLE_MESSAGE = 'Tính năng quản trị mobile chưa được backend hiện tại hỗ trợ.';
const DEFAULT_LICENSE_STATUS = {
  ok: true,
  licensed: false,
  status: 'not_configured',
  message: 'Chưa cấu hình giấy phép cho bản cài đặt này.',
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

export const sapoApi = {
  listImports(params = {}) { const query = new URLSearchParams(params); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/sapo/imports${suffix}`, {}, 'Không thể tải danh sách import Sapo.'); },
  createImport(payload = {}) { return apiJson('/sapo/imports', { method: 'POST', body: payload }, 'Không thể tạo import Sapo.'); },
  getImport(id) { return apiJson(`/sapo/imports/${encodeURIComponent(id)}`, {}, 'Không thể tải import Sapo.'); },
  commitImport(id, payload = {}) { return apiJson(`/sapo/imports/${encodeURIComponent(id)}/commit`, { method: 'POST', body: payload }, 'Không thể ghi import Sapo.'); },
  listCustomers(params = {}) { const query = new URLSearchParams(params); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/sapo/customers${suffix}`, {}, 'Không thể tải khách hàng Sapo.'); },
  importCustomersStart(payload = {}) { return apiJson('/sapo/import/customers', { method: 'POST', body: payload }, 'Không thể bắt đầu import khách hàng Sapo.'); },
  importCustomersCommit(payload = {}) { return apiJson('/sapo/import/customers/commit', { method: 'POST', body: payload }, 'Không thể ghi import khách hàng Sapo.'); },
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
  check(params = {}) { const query = new URLSearchParams(); if (params.platform) query.set('platform', params.platform); if (params.channel) query.set('channel', params.channel); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/updates/check${suffix}`, {}, 'Không thể kiểm tra bản cập nhật.'); },
  detail(id) { return apiJson(`/updates/${encodeURIComponent(id)}`, {}, 'Không thể tải chi tiết bản cập nhật.'); },
  create(payload = {}) { return apiJson('/updates', { method: 'POST', body: payload }, 'Không thể tạo bản cập nhật.'); },
  update(id, payload = {}) { return apiJson(`/updates/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }, 'Không thể cập nhật bản cập nhật.'); },
  publish(id) { return apiJson(`/updates/${encodeURIComponent(id)}/publish`, { method: 'PATCH' }, 'Không thể phát hành bản cập nhật.'); },
  unpublish(id) { return apiJson(`/updates/${encodeURIComponent(id)}/unpublish`, { method: 'PATCH' }, 'Không thể hủy phát hành bản cập nhật.'); },
  remove(id, params = {}) { const query = new URLSearchParams(); if (params.hard) query.set('hard', '1'); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/updates/${encodeURIComponent(id)}${suffix}`, { method: 'DELETE' }, 'Không thể xóa bản cập nhật.'); },
};


export const mobileAdminApi = {
  listDevices() {
    return apiJsonOptional('/mobile/devices', {}, {
      fallbackMessage: 'Không thể tải danh sách thiết bị mobile.',
      fallback: () => ({ ok: true, unsupported: true, items: [], devices: [], message: MOBILE_ADMIN_UNAVAILABLE_MESSAGE }),
    });
  },
  createInstallLink(payload = {}) {
    return apiJsonOptional('/mobile/install-links', { method: 'POST', body: payload }, {
      fallbackMessage: 'Không thể tạo link cài đặt mobile.',
      fallback: () => ({ ok: false, unsupported: true, token: '', url: '', installLink: null, message: MOBILE_ADMIN_UNAVAILABLE_MESSAGE }),
    });
  },
  resolveInstallLink(token) {
    return apiJsonOptional(`/mobile/install/${encodeURIComponent(token)}`, {}, {
      fallbackMessage: 'Không thể giải mã link cài đặt mobile.',
      fallback: () => ({ ok: false, unsupported: true, token: String(token || ''), installLink: null, message: MOBILE_ADMIN_UNAVAILABLE_MESSAGE }),
    });
  },
  revokeDevice(id, payload = {}) {
    return apiJsonOptional(`/mobile/devices/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: payload }, {
      fallbackMessage: 'Không thể thu hồi thiết bị mobile.',
      fallback: () => ({ ok: false, unsupported: true, revoked: false, message: MOBILE_ADMIN_UNAVAILABLE_MESSAGE }),
    });
  },
  updateDevice(id, payload = {}) {
    return apiJsonOptional(`/mobile/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }, {
      fallbackMessage: 'Không thể cập nhật thiết bị mobile.',
      fallback: () => ({ ok: false, unsupported: true, device: null, message: MOBILE_ADMIN_UNAVAILABLE_MESSAGE }),
    });
  },
  syncStatus() {
    return apiJsonOptional('/mobile/sync/status', {}, {
      fallbackMessage: 'Không thể tải trạng thái đồng bộ mobile.',
      fallback: () => ({ ok: true, unsupported: true, devices: [], summary: { total: 0, active: 0, revoked: 0 }, message: MOBILE_ADMIN_UNAVAILABLE_MESSAGE }),
    });
  },
};

export const licenseApi = {
  status() {
    return apiJsonOptional('/license-keys/status', { skipAuth: true }, {
      fallbackMessage: 'Không thể tải trạng thái giấy phép.',
      fallback: () => ({ ...DEFAULT_LICENSE_STATUS }),
    });
  },
};

async function readOptionalLicenseStatus() {
  try {
    const data = await licenseApi.status();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data;
  } catch (_) {
    return null;
  }
}

export function persistAuthSnapshot(payload = {}) {
  return saveAuthSession(payload);
}

export function persistAuthenticatedPayload(payload = {}) {
  return prepareForAuthenticatedPayload(payload);
}

export async function pullServerBootstrapData(options = {}) {
  const syncPayload = options && typeof options === 'object' ? options : {};
  const [sync, license] = await Promise.all([
    authApi.syncPull(syncPayload),
    readOptionalLicenseStatus(),
  ]);

  return {
    ...(sync && typeof sync === 'object' ? sync : {}),
    license,
  };
}

export async function pushPendingLocalData() {
  const pending = getPendingLocalData();
  const result = {
    orders: [],
    customers: [],
  };

  for (const order of pending.orders) {
    const normalized = normalizePendingOrder(order);
    if (normalized) result.orders.push(normalized);
  }

  result.customers = Array.isArray(pending.customers) ? pending.customers : [];

  const hasPendingData = result.orders.length > 0 || result.customers.length > 0;
  if (!hasPendingData) {
    return { ...result, response: null };
  }

  const response = await authApi.syncPush({ pending: result });
  clearPendingLocalData();
  return { ...result, response };
}

function normalizePendingOrder(order) {
  const payload = order?.payload && typeof order.payload === 'object' ? order.payload : order;
  if (!payload || typeof payload !== 'object') return null;

  const cart = Array.isArray(order?.cart) ? order.cart : [];
  const details = Array.isArray(payload.details) && payload.details.length > 0
    ? payload.details
    : cart.map(item => {
        const productName = getProductDisplayName(item);
        return {
          type: item.type || item.item_type || 'product',
          item_type: item.item_type || item.type || 'product',
          combo_id: item.combo_id || null,
          product_id: item.product_id || null,
          variant_id: item.variant_id || null,
          parent_id: item.parent_id || null,
          parent_name: item.parent_name || '',
          variant_name: item.variant_name || '',
          product_name: productName || item.product_name || item.name || '',
          product_sku: item.product_sku || item.sku || '',
          name: productName || item.name || item.product_name || '',
          sku: item.sku || item.product_sku || '',
          quantity: Number(item.quantity) || 1,
          unit_price: Number(item.unit_price) || 0,
          discount_amount: Number(item.discount_amount) || 0,
          discount_percent: Number(item.discount_percent) || 0,
          line_total: Number(item.line_total) || 0,
        };
      });

  if (!Array.isArray(details) || details.length === 0) return null;

  const clientOrderId = ensureClientOrderId(order || payload);
  return attachClientOrderMetadata({
    ...payload,
    client_order_id: clientOrderId,
    client_order_status: payload.client_order_status || 'pending',
    details,
  });
}
