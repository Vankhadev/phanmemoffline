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
    this.status = options.status || 0;
    this.data = options.data;
    this.response = options.response;
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
  return `${protocol}//${host}:${configuredPort}`;
}

export function getApiBase() {
  return stripTrailingSlash(readEnvApiBase() || readElectronApiBase() || getBrowserLanApiBase() || '');
}

export function resolveApiUrl(input) {
  if (!input) return input;
  if (typeof input !== 'string') return input;
  if (/^https?:\/\//i.test(input) || input.startsWith('blob:') || input.startsWith('data:')) return input;
  if (!input.startsWith('/')) return input;
  const base = getApiBase();
  return base ? `${base}${input}` : input;
}

function buildHeaders(headers, { skipAuth = false, jsonBody = false } = {}) {
  const next = new Headers(headers || {});
  if (jsonBody && !next.has('Content-Type')) next.set('Content-Type', 'application/json');
  if (!skipAuth) {
    const token = getAuthToken();
    if (token && !next.has('Authorization')) next.set('Authorization', `Bearer ${token}`);
  }
  return next;
}

function dispatchAuthExpired(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail }));
}

export function handleUnauthorizedResponse(detail = {}) {
  clearAuthSession({ clearVolatile: true, includePending: true });
  dispatchAuthExpired(detail);
}

export async function readApiJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
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
  return typeof url === 'string' && (/\/users\/(login|register|bootstrap-admin)(\?|$)/i.test(url) || /\/license-keys\/status(\?|$)/i.test(url));
}

function isApiRequestUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url) && url.includes('/');
}

function buildInterceptedRequest(input, init = {}) {
  const url = typeof input === 'string' ? input : String(input?.url || '');
  const headers = buildHeaders(init.headers, {
    skipAuth: isPublicAuthEndpoint(url),
    jsonBody: init.body && !(init.body instanceof FormData) && !(init.body instanceof Blob) && !(init.body instanceof ArrayBuffer),
  });
  const requestInit = { ...init, headers };
  if (requestInit.body && headers.get('Content-Type') === 'application/json' && typeof requestInit.body !== 'string') {
    requestInit.body = JSON.stringify(requestInit.body);
  }
  return [input, requestInit];
}

export function installAuthenticatedFetch() {
  if (typeof window === 'undefined') return;
  if (window.__khaAuthenticatedFetchInstalled) return;
  const originalFetch = window.fetch?.bind(window);
  if (!originalFetch) return;
  const wrappedFetch = async (input, init = {}) => {
    const [nextInput, nextInit] = buildInterceptedRequest(input, init);
    return originalFetch(nextInput, nextInit);
  };
  window.fetch = wrappedFetch;
  window.__khaAuthenticatedFetchInstalled = true;
}

function getFetchImplementation() {
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') return window.fetch.bind(window);
  if (typeof fetch === 'function') return fetch.bind(globalThis);
  throw new Error('Fetch API is not available in this environment.');
}

export async function apiFetch(input, init = {}) {
  const fetchImpl = getFetchImplementation();
  const response = await fetchImpl(resolveApiUrl(input), {
    ...init,
    headers: buildHeaders(init.headers, {
      skipAuth: isPublicAuthEndpoint(typeof input === 'string' ? input : String(input?.url || '')),
      jsonBody: init.body && !(init.body instanceof FormData) && !(init.body instanceof Blob) && !(init.body instanceof ArrayBuffer),
    }),
  });
  if (response.status === 401) {
    throw new ApiError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', {
      status: 401,
      response,
      isAuthError: true,
    });
  }
  return response;
}

export async function apiJson(input, init = {}, fallbackMessage = 'Yêu cầu API thất bại.') {
  const response = await apiFetch(input, init);
  const data = await readApiJson(response);
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

export const excelImportApi = {
  preview(payload = {}) {
    return apiJson('/excel-imports/preview', { method: 'POST', body: payload }, 'Không thể xem trước dữ liệu import.');
  },
  commit(payload = {}) {
    return apiJson('/excel-imports/commit', { method: 'POST', body: payload }, 'Không thể ghi dữ liệu import.');
  },
};

export const sapoApi = {
  saveSettings(payload = {}) { return apiJson('/sapo/settings', { method: 'POST', body: payload }, 'Không thể lưu cấu hình Sapo.'); },
  validate(payload = {}) { return apiJson('/sapo/validate', { method: 'POST', body: payload }, 'Không thể kiểm tra cấu hình Sapo.'); },
  analyze(payload = {}) { return apiJson('/sapo/analyze', { method: 'POST', body: payload }, 'Không thể phân tích Sapo.'); },
  previewProducts(payload = {}) { return apiJson('/sapo/preview/products', { method: 'POST', body: payload }, 'Không thể xem trước sản phẩm Sapo.'); },
  syncProducts(payload = {}) { return apiJson('/sapo/sync/products', { method: 'POST', body: payload }, 'Không thể đồng bộ sản phẩm Sapo.'); },
  previewCustomers(payload = {}) { return apiJson('/sapo/preview/customers', { method: 'POST', body: payload }, 'Không thể xem trước khách hàng Sapo.'); },
  syncCustomers(payload = {}) { return apiJson('/sapo/sync/customers', { method: 'POST', body: payload }, 'Không thể đồng bộ khách hàng Sapo.'); },
  previewInvoices(payload = {}) { return apiJson('/sapo/preview/invoices', { method: 'POST', body: payload }, 'Không thể xem trước hóa đơn Sapo.'); },
  syncInvoices(payload = {}) { return apiJson('/sapo/sync/invoices', { method: 'POST', body: payload }, 'Không thể đồng bộ hóa đơn Sapo.'); },
  syncAll(payload = {}) { return apiJson('/sapo/sync', { method: 'POST', body: payload }, 'Không thể đồng bộ Sapo.'); },
  importCustomersPreview(payload = {}) { return apiJson('/sapo/import/customers/preview', { method: 'POST', body: payload }, 'Không thể xem trước import khách hàng Sapo.'); },
  importCustomersCommit(payload = {}) { return apiJson('/sapo/import/customers/commit', { method: 'POST', body: payload }, 'Không thể ghi import khách hàng Sapo.'); },
};

export const customersApi = {
  list(params = {}) { const query = new URLSearchParams(params); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/customers${suffix}`, {}, 'Không thể tải danh sách khách hàng.'); },
  create(payload = {}) { return apiJson('/customers', { method: 'POST', body: payload }, 'Không thể tạo khách hàng.'); },
  update(id, payload = {}) { return apiJson(`/customers/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }, 'Không thể cập nhật khách hàng.'); },
  remove(id) { return apiJson(`/customers/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Không thể xóa khách hàng.'); },
  bulkRemove(ids = []) { return apiJson('/customers/bulk', { method: 'DELETE', body: { ids } }, 'Không thể xóa nhiều khách hàng.'); },
};

export const customerTypesApi = {
  list() { return apiJson('/customer-types', {}, 'Không thể tải loại khách hàng.'); },
  create(payload = {}) { return apiJson('/customer-types', { method: 'POST', body: payload }, 'Không thể tạo loại khách hàng.'); },
  update(id, payload = {}) { return apiJson(`/customer-types/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }, 'Không thể cập nhật loại khách hàng.'); },
  remove(id) { return apiJson(`/customer-types/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Không thể xóa loại khách hàng.'); },
};

export const authApi = {
  login({ email, password }) { return apiJson('/users/login', { method: 'POST', body: { email, password } }, 'Đăng nhập thất bại.'); },
  register(payload) { return apiJson('/users/register', { method: 'POST', body: payload }, 'Đăng ký thất bại.'); },
  bootstrapStatus() { return apiJson('/users/bootstrap-status', {}, 'Không thể tải trạng thái thiết lập tài khoản.'); },
  bootstrapAdmin(payload) { return apiJson('/users/bootstrap-admin', { method: 'POST', body: payload }, 'Thiết lập quản trị viên thất bại.'); },
};

export const usersApi = {
  list() { return apiJson('/users', {}, 'Không thể tải danh sách người dùng.'); },
  update(id, payload = {}) { return apiJson(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }, 'Không thể cập nhật người dùng.'); },
};

export const licenseApi = {
  status() { return apiJson('/license-keys/status', {}, 'Không thể tải trạng thái bản quyền.'); },
  activate(payload = {}) { return apiJson('/license-keys/activate', { method: 'POST', body: payload }, 'Không thể kích hoạt bản quyền.'); },
  list() { return apiJson('/license-keys', {}, 'Không thể tải danh sách key bản quyền.'); },
  detail(id) { return apiJson(`/license-keys/${encodeURIComponent(id)}`, {}, 'Không thể tải chi tiết key.'); },
  create(payload = {}) { return apiJson('/license-keys', { method: 'POST', body: payload }, 'Không thể tạo key.'); },
  update(id, payload = {}) { return apiJson(`/license-keys/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }, 'Không thể cập nhật key.'); },
  renew(id, payload = {}) { return apiJson(`/license-keys/${encodeURIComponent(id)}/renew`, { method: 'POST', body: payload }, 'Không thể gia hạn key.'); },
  disable(id, payload = {}) { return apiJson(`/license-keys/${encodeURIComponent(id)}/disable`, { method: 'POST', body: payload }, 'Không thể khóa key.'); },
  enable(id, payload = {}) { return apiJson(`/license-keys/${encodeURIComponent(id)}/enable`, { method: 'POST', body: payload }, 'Không thể mở khóa key.'); },
  remove(id) { return apiJson(`/license-keys/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Không thể xóa key.'); },
  listCustomers() { return apiJson('/license-keys/customers', {}, 'Không thể tải danh sách khách hàng bản quyền.'); },
  createCustomer(payload = {}) { return apiJson('/license-keys/customers', { method: 'POST', body: payload }, 'Không thể tạo khách hàng bản quyền.'); },
  updateCustomer(id, payload = {}) { return apiJson(`/license-keys/customers/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }, 'Không thể cập nhật khách hàng bản quyền.'); },
  customerDetail(id) { return apiJson(`/license-keys/customers/${encodeURIComponent(id)}`, {}, 'Không thể tải chi tiết khách hàng bản quyền.'); },
};

export const featuresApi = {
  list(params = {}) { const query = new URLSearchParams(); if (params.includeInactive) query.set('include_inactive', '1'); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/features${suffix}`, {}, 'Không thể tải danh sách tính năng.'); },
  detail(id) { return apiJson(`/features/${encodeURIComponent(id)}`, {}, 'Không thể tải chi tiết tính năng.'); },
  create(payload = {}) { return apiJson('/features', { method: 'POST', body: payload }, 'Không thể tạo tính năng.'); },
  update(id, payload = {}) { return apiJson(`/features/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }, 'Không thể cập nhật tính năng.'); },
  remove(id, params = {}) { const query = new URLSearchParams(); if (params.hard) query.set('hard', '1'); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/features/${encodeURIComponent(id)}${suffix}`, { method: 'DELETE' }, 'Không thể xóa tính năng.'); },
  listEntitlements(params = {}) { const query = new URLSearchParams(); if (params.featureId) query.set('feature_id', params.featureId); if (params.customerId) query.set('customer_id', params.customerId); if (params.licenseKeyId) query.set('license_key_id', params.licenseKeyId); if (params.includeInactive) query.set('include_inactive', '1'); const suffix = query.toString() ? `?${query.toString()}` : ''; return apiJson(`/features/entitlements${suffix}`, {}, 'Không thể tải danh sách quyền tính năng.'); },
  detailEntitlement(id) { return apiJson(`/features/entitlements/${encodeURIComponent(id)}`, {}, 'Không thể tải chi tiết quyền tính năng.'); },
  createEntitlement(payload = {}) { return apiJson('/features/entitlements', { method: 'POST', body: payload }, 'Không thể tạo quyền tính năng.'); },
  updateEntitlement(id, payload = {}) { return apiJson(`/features/entitlements/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }, 'Không thể cập nhật quyền tính năng.'); },
  removeEntitlement(id) { return apiJson(`/features/entitlements/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Không thể xóa quyền tính năng.'); },
  bulkEnableEntitlements(payload = {}) { return apiJson('/features/entitlements/bulk-enable', { method: 'POST', body: payload }, 'Không thể bật hàng loạt quyền tính năng.'); },
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
  listDevices() { return apiJson('/mobile/devices', {}, 'Không thể tải danh sách thiết bị mobile.'); },
  createInstallLink(payload = {}) { return apiJson('/mobile/install-links', { method: 'POST', body: payload }, 'Không thể tạo link cài đặt mobile.'); },
  resolveInstallLink(token) { return apiJson(`/mobile/install/${encodeURIComponent(token)}`, {}, 'Không thể giải mã link cài đặt mobile.'); },
  revokeDevice(id, payload = {}) { return apiJson(`/mobile/devices/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: payload }, 'Không thể thu hồi thiết bị mobile.'); },
  updateDevice(id, payload = {}) { return apiJson(`/mobile/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload }, 'Không thể cập nhật thiết bị mobile.'); },
  syncStatus() { return apiJson('/mobile/sync/status', {}, 'Không thể tải trạng thái đồng bộ mobile.'); },
};

export function persistAuthSnapshot(payload = {}) {
  return saveAuthSession(payload);
}

export function persistAuthenticatedPayload(payload = {}) {
  return prepareForAuthenticatedPayload(payload);
}

export async function pullServerBootstrapData() {
  const [status, license] = await Promise.allSettled([
    authApi.bootstrapStatus(),
    licenseApi.status(),
  ]);

  return {
    auth: status.status === 'fulfilled' ? status.value : null,
    license: license.status === 'fulfilled' ? license.value : null,
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

  clearPendingLocalData();
  return result;
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
