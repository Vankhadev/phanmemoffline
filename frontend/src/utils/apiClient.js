import {
  clearAuthSession,
  clearPendingLocalData,
  getAuthToken,
  getPendingLocalData,
  prepareForAuthenticatedPayload,
  saveAuthSession,
} from './authStorage';
import { getProductDisplayName } from './productSearch';

export const AUTH_EXPIRED_EVENT = 'kha-auth:expired';

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

function readElectronApiBase() {
  try {
    if (typeof window === 'undefined') return '';
    return window.khaDesktop?.apiBase || window.electronAPI?.apiBase || '';
  } catch (_) {
    return '';
  }
}

export function getApiBase() {
  const electronApiBase = readElectronApiBase();
  if (electronApiBase) return stripTrailingSlash(electronApiBase);

  const envApiBase = readEnvApiBase();
  if (envApiBase) return stripTrailingSlash(envApiBase);

  return '/api';
}

export const API_BASE = getApiBase();
export const API = API_BASE;

function getCurrentApiBase() {
  return stripTrailingSlash(getApiBase() || API_BASE || '/api');
}

function isAbsoluteUrl(value) {
  return /^[a-z][a-z\d+.-]*:/i.test(value) || String(value || '').startsWith('//');
}

export function resolveApiUrl(input) {
  if (input instanceof URL) return input.toString();
  const value = String(input || '');
  const base = getCurrentApiBase();
  if (!value) return base;
  if (isAbsoluteUrl(value)) return value;
  if (value.startsWith('/api/')) {
    return isAbsoluteUrl(base) ? `${base}${value.slice('/api'.length)}` : value;
  }

  const path = value.startsWith('/') ? value : `/${value}`;
  return `${base}${path}`;
}

function hasBody(value) {
  return value !== undefined && value !== null;
}

function isPlainObjectBody(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof FormData !== 'undefined' && value instanceof FormData) return false;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return false;
  if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) return false;
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return false;
  return true;
}

function buildHeaders(headers, { skipAuth = false, jsonBody = false } = {}) {
  const next = new Headers(headers || {});

  if (jsonBody && !next.has('Content-Type')) {
    next.set('Content-Type', 'application/json');
  }

  if (!skipAuth && !next.has('Authorization')) {
    const token = getAuthToken();
    if (token) next.set('Authorization', `Bearer ${token}`);
  }

  return next;
}

let unauthorizedInProgress = false;
let originalFetchRef = null;
let fetchInterceptorInstalled = false;

function dispatchAuthExpired(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail }));
}

export function handleUnauthorizedResponse(detail = {}) {
  if (unauthorizedInProgress) return;
  unauthorizedInProgress = true;
  try {
    clearAuthSession({ clearVolatile: true, includePending: true });
    dispatchAuthExpired({ reason: 'unauthorized', ...detail });
  } finally {
    window.setTimeout?.(() => {
      unauthorizedInProgress = false;
    }, 0);
  }
}

export async function readApiJson(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (_) {
    return { ok: false, message: 'Phản hồi từ server không hợp lệ.' };
  }
}

export function getApiErrorMessage(data, fallback = 'Yêu cầu API thất bại.') {
  return data?.message || data?.error || data?.detail || fallback;
}

function getFetchUrl(input) {
  try {
    if (input instanceof Request) return input.url;
    if (input instanceof URL) return input.toString();
    return String(input || '');
  } catch (_) {
    return '';
  }
}

function normalizeUrlForMatch(value) {
  try {
    return new URL(value, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  } catch (_) {
    return null;
  }
}

function isPublicAuthEndpoint(url) {
  const parsed = normalizeUrlForMatch(url);
  if (!parsed) return false;
  return [
    '/api/bootstrap/status',
    '/api/users/bootstrap-status',
    '/api/users/bootstrap-admin',
    '/api/users/login',
    '/api/users/register',
  ].some(path => parsed.pathname.endsWith(path));
}

function isApiRequestUrl(url) {
  const apiBase = getCurrentApiBase();
  const parsedUrl = normalizeUrlForMatch(url);
  const parsedBase = normalizeUrlForMatch(apiBase);
  if (!parsedUrl) return false;

  if (parsedBase && isAbsoluteUrl(apiBase)) {
    return parsedUrl.origin === parsedBase.origin && parsedUrl.pathname.startsWith(parsedBase.pathname.replace(/\/$/, ''));
  }

  const basePath = String(apiBase || '/api').startsWith('/') ? String(apiBase || '/api') : '/api';
  const normalizedBasePath = basePath.replace(/\/$/, '');
  return parsedUrl.pathname === normalizedBasePath || parsedUrl.pathname.startsWith(`${normalizedBasePath}/`);
}

function buildInterceptedRequest(input, init = {}) {
  if (input instanceof Request) {
    const headers = new Headers(init.headers || input.headers || {});
    const token = getAuthToken();
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    return [input, { ...init, headers }];
  }

  const headers = new Headers(init.headers || {});
  const token = getAuthToken();
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  return [input, { ...init, headers }];
}

export function installAuthenticatedFetch() {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function' || fetchInterceptorInstalled) return;

  originalFetchRef = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = getFetchUrl(input);
    const shouldAttachAuth = isApiRequestUrl(url) && !isPublicAuthEndpoint(url);
    const [nextInput, nextInit] = shouldAttachAuth ? buildInterceptedRequest(input, init) : [input, init];
    const response = await originalFetchRef(nextInput, nextInit);

    if (shouldAttachAuth && response.status === 401) {
      handleUnauthorizedResponse({ url, status: response.status });
    }

    return response;
  };
  fetchInterceptorInstalled = true;
}

function getFetchImplementation() {
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') return window.fetch.bind(window);
  if (typeof fetch === 'function') return fetch;
  return null;
}

export async function apiFetch(input, init = {}) {
  const {
    skipAuth = false,
    auth,
    handleUnauthorized = true,
    body,
    headers,
    ...rest
  } = init || {};

  const effectiveSkipAuth = skipAuth || auth === false;
  const jsonBody = isPlainObjectBody(body);
  const nextBody = jsonBody ? JSON.stringify(body) : body;
  const fetchImpl = getFetchImplementation();
  if (!fetchImpl) throw new ApiError('Môi trường không hỗ trợ fetch.', { status: 0 });

  const response = await fetchImpl(resolveApiUrl(input), {
    ...rest,
    body: nextBody,
    headers: buildHeaders(headers, { skipAuth: effectiveSkipAuth, jsonBody: hasBody(nextBody) && jsonBody }),
  });

  if (response.status === 401 && !effectiveSkipAuth && handleUnauthorized) {
    handleUnauthorizedResponse({ url: resolveApiUrl(input), status: response.status });
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

  if (!response.ok || data?.ok === false) {
    throw new ApiError(getApiErrorMessage(data, fallbackMessage), {
      status: response.status,
      data,
      response,
    });
  }

  return data;
}

export const authApi = {
  bootstrapStatus() {
    return apiJson('/bootstrap/status', { skipAuth: true, handleUnauthorized: false }, 'Không thể kiểm tra trạng thái thiết lập hệ thống.');
  },

  login({ email, password }) {
    return apiJson('/users/login', {
      method: 'POST',
      skipAuth: true,
      handleUnauthorized: false,
      body: { email, password },
    }, 'Đăng nhập thất bại.');
  },

  register(payload) {
    return apiJson('/users/register', {
      method: 'POST',
      skipAuth: true,
      handleUnauthorized: false,
      body: payload,
    }, 'Không thể đăng ký tài khoản.');
  },

  bootstrapAdmin(payload) {
    return apiJson('/users/bootstrap-admin', {
      method: 'POST',
      skipAuth: true,
      handleUnauthorized: false,
      body: payload,
    }, 'Không thể tạo tài khoản quản trị viên đầu tiên.');
  },

  profile() {
    return apiJson('/users/profile', {}, 'Không thể khôi phục phiên đăng nhập.');
  },

  bootstrap() {
    return apiJson('/bootstrap', {}, 'Không thể tải bootstrap phiên đăng nhập.');
  },

  syncVersions() {
    return apiJson('/sync/versions', {}, 'Không thể tải phiên bản đồng bộ.');
  },

  syncPull(payload = {}) {
    return apiJson('/sync/pull', {
      method: 'POST',
      body: payload,
    }, 'Không thể kéo dữ liệu đồng bộ từ server.');
  },

  syncPush(payload = {}) {
    return apiJson('/sync/push', {
      method: 'POST',
      body: payload,
    }, 'Không thể đẩy dữ liệu cục bộ lên server.');
  },

  logout() {
    return apiJson('/users/logout', { method: 'POST' }, 'Không thể đăng xuất phiên trên server.');
  },
};

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

  return {
    ...payload,
    invoice_code: payload.invoice_code || order?.invoice_code || `LOCAL_${order?.id || Date.now()}`,
    subtotal: Number(payload.subtotal ?? order?.subtotal) || 0,
    vat_percent: Number(payload.vat_percent ?? order?.vatPercent) || 0,
    vat_amount: Number(payload.vat_amount ?? order?.vatAmount) || 0,
    discount_amount: Number(payload.discount_amount ?? order?.discountAmount) || 0,
    total: Number(payload.total ?? order?.total) || 0,
    payment_method: payload.payment_method || order?.payment_method || order?.paymentMethod || 'cash',
    note: payload.note || order?.note || 'Đơn cục bộ được đồng bộ sau đăng nhập',
    delivery_date: payload.delivery_date || order?.delivery_date || null,
    created_at: payload.created_at || order?.created_at || new Date().toISOString(),
    details,
  };
}

function normalizePendingCustomer(customer) {
  if (!customer || typeof customer !== 'object') return null;
  const name = String(customer.name || '').trim();
  if (!name) return null;
  return {
    name,
    phone: customer.phone || '',
    email: customer.email || '',
    tax_code: customer.tax_code || '',
    customer_type: customer.customer_type || 'Khách lẻ',
    invoice_type: customer.invoice_type || 'non_electronic',
    created_at: customer.created_at || new Date().toISOString(),
  };
}

export async function pushPendingLocalData() {
  const pending = getPendingLocalData();
  const orders = pending.orders.map(normalizePendingOrder).filter(Boolean);
  const customers = pending.customers.map(normalizePendingCustomer).filter(Boolean);

  if (orders.length === 0 && customers.length === 0) {
    return { ok: true, skipped: true, pushed: { orders: 0, customers: 0 } };
  }

  const result = await authApi.syncPush({ pending: { orders, customers } });
  if (result?.ok) clearPendingLocalData();
  return {
    ...result,
    pushed: { orders: orders.length, customers: customers.length },
  };
}

export async function pullServerBootstrapData(payload = {}) {
  return authApi.syncPull({ invoiceLimit: 200, ...payload });
}

export function persistAuthenticatedPayload(payload = {}) {
  return prepareForAuthenticatedPayload(payload);
}

export function persistAuthSnapshot(payload = {}) {
  return saveAuthSession(payload);
}
