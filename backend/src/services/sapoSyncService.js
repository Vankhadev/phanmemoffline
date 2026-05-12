const { URL } = require('url');
const http = require('http');
const https = require('https');
const {
  getAll,
  getOne,
  insert,
  update,
  replaceTable,
  now,
  auditLog,
  normalizePaymentMethod,
} = require('../db/database');
const { normalizeSearchText, normalizeKey, parseKeywordList } = require('../utils/productSearch');

const DEFAULT_API_VERSION = '2024-04';
const DEFAULT_PREVIEW_LIMIT = 50;
const MAX_PREVIEW_LIMIT = 250;
const DEFAULT_ANALYZE_MAX_PAGES = 20;
const HARD_MAX_ANALYZE_MAX_PAGES = 100;
const SAPO_REQUEST_TIMEOUT_MS = 15000;
const SAPO_SYNC_SOURCE = 'sapo';
const SENSITIVE_MASK = '••••••••';
const SAPO_RESOURCES = Object.freeze({
  products: { path: '/admin/products.json', key: 'products', label: 'sản phẩm' },
  customers: { path: '/admin/customers.json', key: 'customers', label: 'khách hàng' },
  invoices: { path: '/admin/orders.json', key: 'orders', label: 'hóa đơn/đơn hàng' },
});
const RESOURCE_ORDER = Object.freeze(['products', 'customers', 'invoices']);

function createAppError(message, statusCode = 400, code = 'SAPO_REQUEST_ERROR', detail = null) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (detail !== null && detail !== undefined) err.detail = detail;
  return err;
}

function toSafeString(value, maxLength = 500) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, maxLength);
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeInteger(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on', 'co', 'có'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off', 'khong', 'không'].includes(text)) return false;
  return fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function stripHtml(value) {
  return toSafeString(value, 5000)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJsonField(value, fallback = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function stringifyJsonField(value, fallback = {}) {
  try {
    return JSON.stringify(value === undefined ? fallback : value);
  } catch (_) {
    return JSON.stringify(fallback);
  }
}

function redactToken(token) {
  const text = String(token || '').trim();
  if (!text) return '';
  if (text.length <= 8) return SENSITIVE_MASK;
  return `${text.slice(0, 4)}${SENSITIVE_MASK}${text.slice(-4)}`;
}

function normalizePhone(value) {
  return toSafeString(value, 80).replace(/[^0-9+]/g, '');
}

function normalizeEmail(value) {
  return toSafeString(value, 200).toLowerCase();
}

function normalizeSku(value) {
  return toSafeString(value, 120);
}

function normalizeSkuKey(value) {
  return normalizeSku(value).toLowerCase();
}

function normalizeBarcode(value) {
  return toSafeString(value, 120);
}

function normalizeBarcodeKey(value) {
  return normalizeBarcode(value).toLowerCase();
}

function normalizeCustomerCode(value) {
  return toSafeString(value, 120);
}

function normalizeCustomerCodeKey(value) {
  return normalizeCustomerCode(value).toLowerCase();
}

function normalizeInvoiceCodeKey(value) {
  return toSafeString(value, 120).replace(/^#/, '').toLowerCase();
}

function normalizeOptionSignature(value = {}) {
  const parts = [value.option1, value.option2, value.option3]
    .map(part => normalizeSearchText(part || ''))
    .filter(Boolean);
  return parts.join('|');
}

function normalizeShopInput(input) {
  let value = toSafeString(input, 300).replace(/\s+/g, '');
  if (!value) return { ok: false, message: 'Vui lòng nhập link cửa hàng Sapo.' };

  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    return { ok: false, message: 'Link Sapo không hợp lệ.' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, message: 'Link Sapo phải dùng http hoặc https.' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
    return { ok: false, message: 'Link Sapo phải là domain cửa hàng thật, không dùng localhost.' };
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';

  return {
    ok: true,
    shop: hostname,
    baseUrl: stripTrailingSlash(`${parsed.protocol}//${parsed.host}`),
  };
}

function buildSapoApiUrl(settings, resourcePath = '/admin/products.json', query = {}) {
  const baseUrl = stripTrailingSlash(settings.base_url || settings.baseUrl);
  if (!baseUrl) throw createAppError('Chưa cấu hình link Sapo.', 400, 'SAPO_MISSING_SETTINGS');

  const cleanResourcePath = String(resourcePath || '/admin/products.json').startsWith('/')
    ? String(resourcePath || '/admin/products.json')
    : `/${resourcePath}`;
  const url = new URL(`${baseUrl}${cleanResourcePath}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url;
}

function requestJson(url, { method = 'GET', headers = {}, body, timeoutMs = SAPO_REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = url instanceof URL ? url : new URL(String(url));
    const transport = parsed.protocol === 'http:' ? http : https;
    const payload = body === undefined || body === null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const requestHeaders = { ...headers };
    if (payload && !requestHeaders['Content-Type']) requestHeaders['Content-Type'] = 'application/json';
    if (payload && !requestHeaders['Content-Length']) requestHeaders['Content-Length'] = Buffer.byteLength(payload);

    const req = transport.request(parsed, { method, headers: requestHeaders, timeout: timeoutMs }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data = {};
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch (_) {
            data = { raw };
          }
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = data?.errors || data?.error || data?.message || `Sapo API trả HTTP ${res.statusCode}`;
          const err = new Error(typeof message === 'string' ? message : JSON.stringify(message));
          err.statusCode = res.statusCode;
          err.code = 'SAPO_UPSTREAM_HTTP';
          err.data = data;
          reject(err);
          return;
        }

        resolve({ statusCode: res.statusCode, headers: res.headers, data });
      });
    });

    req.on('timeout', () => req.destroy(Object.assign(new Error('Kết nối Sapo quá thời gian chờ.'), { code: 'SAPO_TIMEOUT' })));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function getSettingsRow() {
  return getOne('sapo_settings', row => row && row.active !== 0) || null;
}

function defaultSyncOptions() {
  return {
    createMissingCategories: true,
    createMissingCustomers: true,
    updateExistingProducts: true,
    updateExistingCustomers: true,
    updateExistingInvoices: false,
    syncImages: true,
    syncDescriptions: true,
    inventoryPolicy: 'overwrite',
    invoiceStockPolicy: 'keep',
    allowUnresolvedInvoiceLines: false,
    priceMapping: {
      retail_price: 'price',
      wholesale_price: 'price',
      vip_price: 'price',
      import_price: 'cost',
    },
  };
}

function publicSettings(row = getSettingsRow()) {
  if (!row) {
    return {
      configured: false,
      shop: '',
      base_url: '',
      api_version: DEFAULT_API_VERSION,
      has_token: false,
      token_preview: '',
      last_connected_at: null,
      last_preview_at: null,
      last_sync_at: null,
      options: defaultSyncOptions(),
    };
  }

  return {
    configured: Boolean(row.base_url && row.access_token),
    id: row.id,
    shop: row.shop || '',
    base_url: row.base_url || '',
    api_version: row.api_version || DEFAULT_API_VERSION,
    has_token: Boolean(row.access_token),
    token_preview: redactToken(row.access_token),
    last_connected_at: row.last_connected_at || null,
    last_preview_at: row.last_preview_at || null,
    last_sync_at: row.last_sync_at || null,
    updated_at: row.updated_at || null,
    options: { ...defaultSyncOptions(), ...parseJsonField(row.options, {}) },
  };
}

function normalizeSettingsPayload(body = {}, existing = null) {
  const shopInput = body.storeUrl || body.store_url || body.baseUrl || body.base_url || body.shop || existing?.base_url || '';
  const normalizedShop = normalizeShopInput(shopInput);
  if (!normalizedShop.ok) throw createAppError(normalizedShop.message, 400, 'SAPO_INVALID_SHOP');

  const clearToken = normalizeBoolean(body.clearToken || body.clear_token, false);
  const incomingToken = toSafeString(body.accessToken || body.access_token || body.token, 2000);
  const canReuseExistingToken = Boolean(
    existing?.access_token
    && existing?.base_url
    && stripTrailingSlash(existing.base_url).toLowerCase() === stripTrailingSlash(normalizedShop.baseUrl).toLowerCase()
  );
  const accessToken = clearToken ? '' : (incomingToken || (canReuseExistingToken ? existing.access_token : ''));
  if (!accessToken) {
    throw createAppError('Vui lòng nhập access token/API token Sapo. Token không được hard-code trong ứng dụng.', 400, 'SAPO_MISSING_TOKEN');
  }

  const options = {
    ...defaultSyncOptions(),
    ...parseJsonField(existing?.options, {}),
    ...(body.options && typeof body.options === 'object' ? body.options : {}),
  };
  options.createMissingCategories = normalizeBoolean(options.createMissingCategories, true);
  options.createMissingCustomers = normalizeBoolean(options.createMissingCustomers, true);
  options.updateExistingProducts = normalizeBoolean(options.updateExistingProducts, true);
  options.updateExistingCustomers = normalizeBoolean(options.updateExistingCustomers, true);
  options.updateExistingInvoices = normalizeBoolean(options.updateExistingInvoices, false);
  options.syncImages = normalizeBoolean(options.syncImages, true);
  options.syncDescriptions = normalizeBoolean(options.syncDescriptions, true);
  options.allowUnresolvedInvoiceLines = normalizeBoolean(options.allowUnresolvedInvoiceLines, false);
  options.inventoryPolicy = ['overwrite', 'keep'].includes(String(options.inventoryPolicy || '').trim()) ? options.inventoryPolicy : 'overwrite';
  options.invoiceStockPolicy = ['keep', 'deduct'].includes(String(options.invoiceStockPolicy || '').trim()) ? options.invoiceStockPolicy : 'keep';
  options.priceMapping = { ...defaultSyncOptions().priceMapping, ...(options.priceMapping || {}) };

  return {
    shop: normalizedShop.shop,
    base_url: normalizedShop.baseUrl,
    access_token: accessToken,
    api_version: toSafeString(body.apiVersion || body.api_version || existing?.api_version || DEFAULT_API_VERSION, 40) || DEFAULT_API_VERSION,
    options: stringifyJsonField(options),
    active: 1,
  };
}

function saveSettings(body = {}, req = null) {
  const existing = getSettingsRow();
  const payload = normalizeSettingsPayload(body, existing);
  const timestamp = now();

  if (existing) {
    update('sapo_settings', existing.id, { ...payload, updated_at: timestamp });
    safeAudit('sapo.config.update', req, { shop: payload.shop, base_url: payload.base_url, has_token: Boolean(payload.access_token) });
    return publicSettings(getSettingsRow());
  }

  const id = insert('sapo_settings', { ...payload, created_at: timestamp, updated_at: timestamp });
  safeAudit('sapo.config.create', req, { shop: payload.shop, base_url: payload.base_url, has_token: Boolean(payload.access_token) });
  return publicSettings(getOne('sapo_settings', row => row.id === id));
}

function resolveEffectiveSettings(body = {}) {
  const existing = getSettingsRow();
  if (body && Object.keys(body).some(key => ['shop', 'storeUrl', 'store_url', 'baseUrl', 'base_url', 'accessToken', 'access_token', 'token'].includes(key))) {
    return normalizeSettingsPayload(body, existing);
  }
  if (!existing?.base_url || !existing?.access_token) {
    throw createAppError('Chưa cấu hình link/token Sapo.', 400, 'SAPO_MISSING_SETTINGS');
  }
  return existing;
}

function getSapoHeaders(settings) {
  return {
    Accept: 'application/json',
    'User-Agent': 'phanmienoffline-sapo-sync/1.2.3',
    'X-Sapo-Access-Token': settings.access_token,
  };
}

function normalizeResourceName(resource) {
  const value = String(resource || '').trim().toLowerCase();
  if (['orders', 'order', 'hoa_don', 'hoadon', 'invoices', 'invoice'].includes(value)) return 'invoices';
  if (['customers', 'customer', 'khach_hang', 'khachhang'].includes(value)) return 'customers';
  return 'products';
}

function normalizeGroups(groups) {
  let input = groups;
  if (typeof input === 'string') input = input.split(',').map(item => item.trim()).filter(Boolean);
  if (!Array.isArray(input) || input.length === 0) input = RESOURCE_ORDER;
  const result = Array.from(new Set(input.map(normalizeResourceName)));
  return RESOURCE_ORDER.filter(resource => result.includes(resource));
}

function extractRowsFromSapoResponse(data, resourceName) {
  const config = SAPO_RESOURCES[resourceName] || SAPO_RESOURCES.products;
  if (Array.isArray(data?.[config.key])) return data[config.key];
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}

function normalizeSapoUpstreamError(err, resourceName) {
  const resource = normalizeResourceName(resourceName);
  const config = SAPO_RESOURCES[resource] || SAPO_RESOURCES.products;
  const upstreamStatusCode = Number(err?.statusCode || err?.status || 0) || null;
  const statusCode = upstreamStatusCode === 401 || upstreamStatusCode === 403
    ? 400
    : (upstreamStatusCode >= 400 && upstreamStatusCode < 500 ? upstreamStatusCode : 502);
  const upstreamCode = err?.code === 'SAPO_TIMEOUT' ? 'SAPO_TIMEOUT' : (err?.code || 'SAPO_UPSTREAM_ERROR');
  const code = upstreamStatusCode === 401
    ? 'SAPO_UPSTREAM_UNAUTHORIZED'
    : upstreamStatusCode === 403
      ? 'SAPO_UPSTREAM_FORBIDDEN'
      : upstreamCode;
  const message = err?.message || 'Không kết nối được Sapo.';
  const wrapped = createAppError(`Không thể tải ${config.label} từ Sapo: ${message}`, statusCode, code);
  wrapped.upstream = true;
  wrapped.upstreamStatus = upstreamStatusCode;
  wrapped.resource = resource;
  wrapped.data = err?.data;
  return wrapped;
}

async function fetchSapoResource(settings, resourceName, options = {}) {
  const resource = normalizeResourceName(resourceName);
  const config = SAPO_RESOURCES[resource] || SAPO_RESOURCES.products;
  const limit = Math.min(Math.max(normalizeInteger(options.limit, DEFAULT_PREVIEW_LIMIT), 1), MAX_PREVIEW_LIMIT);
  const page = Math.max(normalizeInteger(options.page, 1), 1);
  const query = toSafeString(options.query || options.search, 120);
  const sinceId = toSafeString(options.since_id || options.sinceId, 80);
  const status = toSafeString(options.status, 80);
  const updatedAtMin = toSafeString(options.updated_at_min || options.updatedAtMin, 80);
  const updatedAtMax = toSafeString(options.updated_at_max || options.updatedAtMax, 80);

  const apiQuery = { limit, page };
  if (query) apiQuery.query = query;
  if (sinceId) apiQuery.since_id = sinceId;
  if (status) apiQuery.status = status;
  if (updatedAtMin) apiQuery.updated_at_min = updatedAtMin;
  if (updatedAtMax) apiQuery.updated_at_max = updatedAtMax;

  try {
    const url = buildSapoApiUrl(settings, config.path, apiQuery);
    const response = await requestJson(url, { headers: getSapoHeaders(settings) });
    const rows = extractRowsFromSapoResponse(response.data, resource);
    return {
      ok: true,
      resource,
      rows,
      page,
      limit,
      query,
      count: rows.length,
      link: response.headers?.link || '',
    };
  } catch (err) {
    throw normalizeSapoUpstreamError(err, resource);
  }
}

async function fetchAllSapoResource(settings, resourceName, options = {}) {
  const resource = normalizeResourceName(resourceName);
  const maxPages = Math.min(Math.max(normalizeInteger(options.maxPages || options.max_pages, DEFAULT_ANALYZE_MAX_PAGES), 1), HARD_MAX_ANALYZE_MAX_PAGES);
  const limit = Math.min(Math.max(normalizeInteger(options.limit, MAX_PREVIEW_LIMIT), 1), MAX_PREVIEW_LIMIT);
  const rows = [];
  let lastPage = 0;
  const progress = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const fetched = await fetchSapoResource(settings, resource, { ...options, page, limit });
    lastPage = page;
    rows.push(...fetched.rows);
    progress.push({ page, count: fetched.rows.length, total: rows.length });
    if (fetched.rows.length < limit) break;
  }
  return { ok: true, resource, rows, page: lastPage, limit, count: rows.length, maxPages, progress };
}

async function fetchSapoProducts(settings, options = {}) {
  const fetched = await fetchSapoResource(settings, 'products', options);
  return {
    products: fetched.rows,
    page: fetched.page,
    limit: fetched.limit,
    query: fetched.query,
    count: fetched.count,
    link: fetched.link,
  };
}

async function validateConnection(body = {}, req = null) {
  const settings = resolveEffectiveSettings(body);
  const fetched = await fetchSapoProducts(settings, { limit: 1, page: 1 });
  const existing = getSettingsRow();
  if (existing && settings.base_url === existing.base_url && settings.access_token === existing.access_token) {
    update('sapo_settings', existing.id, { last_connected_at: now(), updated_at: now() });
  }
  safeAudit('sapo.validate', req, { shop: settings.shop, product_sample_count: fetched.count });
  return {
    ok: true,
    resource: 'connection',
    resources: [],
    summary: { sample_count: fetched.count },
    items: [],
    results: [],
    warnings: [],
    errors: [],
    progress: { products_sample: fetched.count },
    message: 'Kết nối Sapo thành công.',
    shop: settings.shop,
    base_url: settings.base_url,
    sample_count: fetched.count,
    settings: publicSettings(getSettingsRow() || settings),
  };
}

function getSapoProductId(product) {
  return toSafeString(product?.id || product?.admin_graphql_api_id || product?.product_id, 80);
}

function getSapoVariantId(variant) {
  return toSafeString(variant?.id || variant?.variant_id || variant?.admin_graphql_api_id, 80);
}

function pickProductImage(product, variant = null) {
  if (variant?.image_url || variant?.image?.src) return variant.image_url || variant.image.src;
  if (product?.image?.src) return product.image.src;
  if (Array.isArray(product?.images) && product.images.length > 0) {
    const variantImageId = variant?.image_id;
    const matched = variantImageId ? product.images.find(image => String(image.id) === String(variantImageId)) : null;
    return matched?.src || product.images[0]?.src || '';
  }
  return '';
}

function getVariantDisplayName(variant, index = 0) {
  const candidates = [variant?.title, variant?.name, [variant?.option1, variant?.option2, variant?.option3].filter(Boolean).join(' / ')];
  const text = candidates.map(item => toSafeString(item, 200)).find(item => item && !/^default title$/i.test(item));
  return text || `Biến thể ${index + 1}`;
}

function getVariantCost(variant = {}) {
  return normalizeNumber(variant.cost || variant.inventory_cost || variant.import_price || variant.cost_price || variant.original_price, 0);
}

function normalizeSapoProduct(product = {}) {
  const productId = getSapoProductId(product);
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const firstVariant = variants[0] || {};
  const title = toSafeString(product?.name || product?.title, 500) || `Sapo product ${productId}`;
  const categoryText = toSafeString(product?.product_type || product?.category || product?.vendor || product?.tags, 300);
  const description = stripHtml(product?.body_html || product?.description || '');
  const sku = normalizeSku(product?.sku || product?.barcode || (productId ? `SAPO-${productId}` : ''));
  const barcode = normalizeBarcode(product?.barcode || firstVariant?.barcode);
  const imageUrl = toSafeString(pickProductImage(product, firstVariant), 1200);
  const status = toSafeString(product?.status || product?.published_status || product?.published_scope || '', 80);
  const sapoUpdatedAt = toSafeString(product?.updated_at || product?.modified_on || product?.created_at, 80);

  const normalizedVariants = variants.map((variant, index) => ({
    sapo_product_id: productId,
    sapo_parent_product_id: productId,
    sapo_variant_id: getSapoVariantId(variant),
    sku: normalizeSku(variant?.sku || variant?.barcode || (sku ? `${sku}-${index + 1}` : '')),
    barcode: normalizeBarcode(variant?.barcode),
    name: getVariantDisplayName(variant, index),
    import_price: getVariantCost(variant),
    wholesale_price: normalizeNumber(variant?.wholesale_price || variant?.price, 0),
    retail_price: normalizeNumber(variant?.price || variant?.retail_price, 0),
    vip_price: normalizeNumber(variant?.compare_at_price || variant?.price, 0),
    stock: normalizeInteger(variant?.inventory_quantity ?? variant?.stock ?? variant?.quantity, 0),
    unit: toSafeString(variant?.unit || product?.unit || 'cái', 80) || 'cái',
    image_url: toSafeString(pickProductImage(product, variant), 1200),
    option1: toSafeString(variant?.option1, 200),
    option2: toSafeString(variant?.option2, 200),
    option3: toSafeString(variant?.option3, 200),
    status,
    sapo_status: status,
    sapo_updated_at: sapoUpdatedAt,
    raw: variant,
  }));

  return {
    sapo_product_id: productId,
    sapo_variant_id: variants.length === 1 ? getSapoVariantId(firstVariant) : '',
    sapo_parent_product_id: '',
    sku,
    barcode,
    name: title,
    import_price: getVariantCost(firstVariant) || normalizeNumber(product?.import_price || product?.cost, 0),
    wholesale_price: normalizeNumber(firstVariant?.wholesale_price || firstVariant?.price || product?.wholesale_price, 0),
    retail_price: normalizeNumber(firstVariant?.price || product?.price || product?.retail_price, 0),
    vip_price: normalizeNumber(firstVariant?.compare_at_price || firstVariant?.price || product?.vip_price, 0),
    stock: normalizeInteger(firstVariant?.inventory_quantity ?? product?.stock ?? product?.quantity, 0),
    unit: toSafeString(product?.unit || firstVariant?.unit || 'cái', 80) || 'cái',
    category: categoryText,
    vendor: toSafeString(product?.vendor, 300),
    description,
    image_url: imageUrl,
    option1: toSafeString(firstVariant?.option1 || product?.option1, 200),
    option2: toSafeString(firstVariant?.option2 || product?.option2, 200),
    option3: toSafeString(firstVariant?.option3 || product?.option3, 200),
    status,
    sapo_status: status,
    sapo_updated_at: sapoUpdatedAt,
    variants: normalizedVariants,
    raw: product,
  };
}

function buildCategoriesByKey(categories) {
  const map = new Map();
  for (const category of categories || []) {
    if (!category || category.active === 0) continue;
    const values = [category.name, category.group_name, category.group_key, ...parseKeywordList(category.keywords), ...parseKeywordList(category.aliases)];
    for (const value of values) {
      const key = normalizeKey(value);
      if (key && !map.has(key)) map.set(key, category);
    }
  }
  return map;
}

function resolveCategoryId(categoryText, categoryState) {
  const text = toSafeString(categoryText, 300);
  if (!text) return null;
  const exactKey = normalizeKey(text);
  if (categoryState.byKey.has(exactKey)) return categoryState.byKey.get(exactKey).id;

  const normalizedText = normalizeSearchText(text);
  const matched = categoryState.categories.find(category => {
    const values = [category.name, category.group_name, category.group_key, ...parseKeywordList(category.keywords), ...parseKeywordList(category.aliases)];
    return values.some(value => {
      const normalized = normalizeSearchText(value);
      return normalized && (normalized === normalizedText || normalized.includes(normalizedText) || normalizedText.includes(normalized));
    });
  });
  if (matched) return matched.id;

  if (!categoryState.createMissing) return null;
  const timestamp = now();
  const id = insert('product_categories', {
    name: text,
    group_name: text,
    group_key: normalizeKey(text),
    keywords: [text],
    aliases: [],
    active: 1,
    created_at: timestamp,
    updated_at: timestamp,
  });
  const created = getOne('product_categories', category => category.id === id);
  if (created) {
    categoryState.categories.push(created);
    categoryState.byKey.set(normalizeKey(text), created);
  }
  return id;
}

function mapPush(map, key, value) {
  const cleanKey = toSafeString(key, 300);
  if (!cleanKey) return;
  if (!map.has(cleanKey)) map.set(cleanKey, []);
  map.get(cleanKey).push(value);
}

function getNextRowId(rows) {
  return rows.reduce((max, row) => Math.max(max, normalizeInteger(row?.id, 0)), 0) + 1;
}

function buildExistingIndexes(products) {
  const indexes = {
    products,
    bySapoProductId: new Map(),
    bySapoProductIdParent: new Map(),
    bySapoVariantId: new Map(),
    bySku: new Map(),
    byParentSku: new Map(),
    byBarcode: new Map(),
    byParentBarcode: new Map(),
    byRootName: new Map(),
    byParentAndName: new Map(),
    byParentOptionSignature: new Map(),
    byProductOptionSignature: new Map(),
    byProductAndName: new Map(),
  };

  products.forEach((product, index) => {
    if (!product || product.active === 0) return;
    if (product.sapo_product_id) {
      mapPush(indexes.bySapoProductId, String(product.sapo_product_id), index);
      if (!product.parent_id) mapPush(indexes.bySapoProductIdParent, String(product.sapo_product_id), index);
    }
    if (product.sapo_variant_id) mapPush(indexes.bySapoVariantId, String(product.sapo_variant_id), index);
    const skuKey = normalizeSkuKey(product.sku);
    if (skuKey) {
      mapPush(indexes.bySku, skuKey, index);
      if (!product.parent_id) mapPush(indexes.byParentSku, skuKey, index);
    }
    const barcodeKey = normalizeBarcodeKey(product.barcode);
    if (barcodeKey) {
      mapPush(indexes.byBarcode, barcodeKey, index);
      if (!product.parent_id) mapPush(indexes.byParentBarcode, barcodeKey, index);
    }
    const nameKey = normalizeSearchText(product.name);
    if (nameKey && !product.parent_id) mapPush(indexes.byRootName, nameKey, index);
    if (product.parent_id && nameKey) mapPush(indexes.byParentAndName, `${product.parent_id}::${nameKey}`, index);
    const optionSignature = normalizeOptionSignature(product);
    if (product.parent_id && optionSignature) mapPush(indexes.byParentOptionSignature, `${product.parent_id}::${optionSignature}`, index);
    if (product.sapo_product_id && optionSignature) mapPush(indexes.byProductOptionSignature, `${product.sapo_product_id}::${optionSignature}`, index);
    if (product.sapo_product_id && nameKey) mapPush(indexes.byProductAndName, `${product.sapo_product_id}::${nameKey}`, index);
  });

  return indexes;
}

function resolveIndexCandidate(indexes, map, key, reason, filterFn = null) {
  const cleanKey = toSafeString(key, 300);
  if (!cleanKey || !map.has(cleanKey)) return null;
  const candidates = (map.get(cleanKey) || [])
    .filter(index => index >= 0 && indexes.products[index] && indexes.products[index].active !== 0)
    .filter(index => !filterFn || filterFn(indexes.products[index], index));
  const unique = Array.from(new Set(candidates));
  if (unique.length === 1) return { status: 'existing', index: unique[0], reason };
  if (unique.length > 1) return { status: 'conflict', index: -1, reason, conflicts: unique.map(index => indexes.products[index]?.id).filter(Boolean) };
  return null;
}

function findParentProductMatch(mapped, indexes) {
  const productId = mapped.sapo_product_id;
  const variantId = mapped.sapo_variant_id;
  const skuKey = normalizeSkuKey(mapped.sku);
  const barcodeKey = normalizeBarcodeKey(mapped.barcode);
  const nameKey = normalizeSearchText(mapped.name);

  return resolveIndexCandidate(indexes, indexes.bySapoProductIdParent, productId, 'sapo_product_id')
    || resolveIndexCandidate(indexes, indexes.bySapoVariantId, variantId, 'sapo_variant_id', product => !product.parent_id)
    || resolveIndexCandidate(indexes, indexes.byParentSku, skuKey, 'sku')
    || resolveIndexCandidate(indexes, indexes.byParentBarcode, barcodeKey, 'barcode')
    || resolveIndexCandidate(indexes, indexes.byRootName, nameKey, 'name')
    || { status: 'new', index: -1, reason: '' };
}

function findVariantProductMatch(variant, indexes, parentId = null) {
  const variantId = variant.sapo_variant_id;
  const skuKey = normalizeSkuKey(variant.sku);
  const barcodeKey = normalizeBarcodeKey(variant.barcode);
  const nameKey = normalizeSearchText(variant.name);
  const optionSignature = normalizeOptionSignature(variant);
  const sameParentVariant = product => !parentId || (product.parent_id && Number(product.parent_id) === Number(parentId));

  return resolveIndexCandidate(indexes, indexes.bySapoVariantId, variantId, 'sapo_variant_id', product => !parentId || Number(product.id) !== Number(parentId))
    || resolveIndexCandidate(indexes, indexes.bySku, skuKey, 'sku', sameParentVariant)
    || resolveIndexCandidate(indexes, indexes.byBarcode, barcodeKey, 'barcode', sameParentVariant)
    || (parentId ? resolveIndexCandidate(indexes, indexes.byParentOptionSignature, `${parentId}::${optionSignature}`, 'parent_option_signature') : null)
    || (parentId ? resolveIndexCandidate(indexes, indexes.byParentAndName, `${parentId}::${nameKey}`, 'parent_name') : null)
    || resolveIndexCandidate(indexes, indexes.byProductOptionSignature, `${variant.sapo_product_id}::${optionSignature}`, 'sapo_product_option_signature')
    || resolveIndexCandidate(indexes, indexes.byProductAndName, `${variant.sapo_product_id}::${nameKey}`, 'sapo_product_name')
    || { status: 'new', index: -1, reason: '' };
}

function diffFields(existing = {}, mapped = {}, fields = []) {
  return fields.filter(field => String(existing[field] ?? '').trim() !== String(mapped[field] ?? '').trim());
}

function createStatusSummary(items = []) {
  const summary = {
    total: items.length,
    create: 0,
    new: 0,
    update: 0,
    existing: 0,
    unchanged: 0,
    conflict: 0,
    duplicate: 0,
    error: 0,
    errors: 0,
    skipped: 0,
    blocked: 0,
  };
  for (const item of items) {
    const action = item?.action || item?.status || 'create';
    if (summary[action] !== undefined) summary[action] += 1;
    if (action === 'create') summary.new += 1;
    if (action === 'error') summary.errors += 1;
  }
  return summary;
}

function previewMappedProduct(mapped, indexes) {
  const parentMatch = findParentProductMatch(mapped, indexes);
  const existing = parentMatch.index >= 0 ? indexes.products[parentMatch.index] : null;
  const parentDiffFields = existing
    ? ['barcode', 'name', 'retail_price', 'import_price', 'stock', 'unit', 'category', 'image_url', 'description', 'option1', 'option2', 'option3', 'sapo_status', 'sapo_updated_at']
    : ['sku', 'barcode', 'name', 'retail_price', 'import_price', 'stock', 'unit', 'category', 'image_url', 'description', 'option1', 'option2', 'option3', 'sapo_status', 'sapo_updated_at'];
  const changedFields = existing ? diffFields(existing, mapped, parentDiffFields) : [];
  const parentAction = parentMatch.status === 'conflict'
    ? 'conflict'
    : (existing ? (changedFields.length > 0 ? 'update' : 'existing') : 'create');

  const parentIdForVariantPreview = existing?.id || `sapo:${mapped.sapo_product_id || mapped.sku}`;
  const variants = safeArray(mapped.variants).map((variant, index) => {
    const variantMatch = findVariantProductMatch(variant, indexes, existing?.id || null);
    const existingVariant = variantMatch.index >= 0 ? indexes.products[variantMatch.index] : null;
    const variantChangedFields = existingVariant ? diffFields(existingVariant, variant, [
      'sku', 'barcode', 'name', 'retail_price', 'import_price', 'stock', 'unit', 'image_url', 'option1', 'option2', 'option3', 'sapo_updated_at',
    ]) : [];
    const action = variantMatch.status === 'conflict'
      ? 'conflict'
      : (existingVariant ? (variantChangedFields.length > 0 ? 'update' : 'existing') : 'create');
    return {
      resource: 'products',
      parent_key: parentIdForVariantPreview,
      sapo_product_id: variant.sapo_product_id,
      sapo_variant_id: variant.sapo_variant_id,
      sku: variant.sku || `${mapped.sku}-${index + 1}`,
      barcode: variant.barcode || '',
      name: variant.name,
      retail_price: variant.retail_price,
      stock: variant.stock,
      existing_product_id: existingVariant?.id || null,
      match_reason: variantMatch.reason || '',
      conflicts: variantMatch.conflicts || [],
      changed_fields: variantChangedFields,
      action,
      status: action,
    };
  });

  return {
    resource: 'products',
    sapo_product_id: mapped.sapo_product_id,
    sapo_variant_id: mapped.sapo_variant_id || '',
    sku: mapped.sku,
    barcode: mapped.barcode || '',
    name: mapped.name,
    category: mapped.category,
    image_url: mapped.image_url,
    retail_price: mapped.retail_price,
    stock: mapped.variants.length > 1 ? mapped.variants.reduce((sum, variant) => sum + normalizeInteger(variant.stock, 0), 0) : mapped.stock,
    variant_count: mapped.variants.length,
    existing_product_id: existing?.id || null,
    match_reason: parentMatch.reason || '',
    conflicts: parentMatch.conflicts || [],
    changed_fields: changedFields,
    action: parentAction,
    status: parentAction,
    variants,
  };
}

async function previewProducts(body = {}, req = null) {
  const settings = resolveEffectiveSettings(body);
  const fetched = await fetchSapoProducts(settings, body);
  const mappedProducts = fetched.products.map(normalizeSapoProduct);
  const products = getAll('products');
  const indexes = buildExistingIndexes(products);
  const items = mappedProducts.map(mapped => previewMappedProduct(mapped, indexes));
  const warnings = [];
  const errors = [];

  touchPreviewSettings(settings);
  safeAudit('sapo.preview.products', req, { shop: settings.shop, count: items.length, query: fetched.query });

  return {
    ok: true,
    resource: 'products',
    resources: ['products'],
    page: fetched.page,
    limit: fetched.limit,
    query: fetched.query,
    count: items.length,
    summary: createStatusSummary(items),
    items,
    results: items,
    warnings,
    errors,
    progress: { page: fetched.page, limit: fetched.limit, fetched: fetched.count },
    settings: publicSettings(getSettingsRow() || settings),
  };
}

function createLocalProductPayload(mapped, extras = {}) {
  const timestamp = extras.timestamp || now();
  return {
    sku: normalizeSku(mapped.sku),
    name: mapped.name,
    import_price: normalizeNumber(mapped.import_price, 0),
    wholesale_price: normalizeNumber(mapped.wholesale_price, 0),
    retail_price: normalizeNumber(mapped.retail_price, 0),
    vip_price: normalizeNumber(mapped.vip_price, 0),
    stock: normalizeInteger(mapped.stock, 0),
    unit: mapped.unit || 'cái',
    category: mapped.category || '',
    default_category_id: extras.default_category_id || null,
    supplier_id: null,
    barcode: mapped.barcode || '',
    image_url: extras.syncImages === false ? '' : (mapped.image_url || ''),
    description: extras.syncDescriptions === false ? '' : (mapped.description || ''),
    option1: mapped.option1 || '',
    option2: mapped.option2 || '',
    option3: mapped.option3 || '',
    sapo_product_id: mapped.sapo_product_id || '',
    sapo_variant_id: mapped.sapo_variant_id || '',
    sapo_parent_product_id: mapped.sapo_parent_product_id || '',
    sapo_status: mapped.sapo_status || mapped.status || '',
    sapo_updated_at: mapped.sapo_updated_at || '',
    sapo_last_synced_at: timestamp,
    sync_source: SAPO_SYNC_SOURCE,
    active: 1,
  };
}

function applyProductUpdate(target, mapped, extras = {}) {
  const keepStock = extras.inventoryPolicy === 'keep';
  const syncImages = extras.syncImages !== false;
  const syncDescriptions = extras.syncDescriptions !== false;
  const timestamp = extras.timestamp || now();
  if (!extras.preserveSku) target.sku = normalizeSku(mapped.sku) || target.sku || '';
  target.name = mapped.name || target.name || '';
  target.import_price = normalizeNumber(mapped.import_price, target.import_price || 0);
  target.wholesale_price = normalizeNumber(mapped.wholesale_price, target.wholesale_price || 0);
  target.retail_price = normalizeNumber(mapped.retail_price, target.retail_price || 0);
  target.vip_price = normalizeNumber(mapped.vip_price, target.vip_price || 0);
  if (!keepStock) target.stock = normalizeInteger(mapped.stock, target.stock || 0);
  target.unit = mapped.unit || target.unit || 'cái';
  target.category = mapped.category || target.category || '';
  if (extras.default_category_id !== undefined) target.default_category_id = extras.default_category_id;
  if (mapped.barcode !== undefined) target.barcode = mapped.barcode || target.barcode || '';
  if (syncImages && mapped.image_url !== undefined) target.image_url = mapped.image_url || target.image_url || '';
  if (syncDescriptions && mapped.description !== undefined) target.description = mapped.description || target.description || '';
  for (const field of ['option1', 'option2', 'option3']) {
    if (mapped[field] !== undefined) target[field] = mapped[field] || '';
  }
  target.sapo_product_id = mapped.sapo_product_id || target.sapo_product_id || '';
  target.sapo_variant_id = mapped.sapo_variant_id || target.sapo_variant_id || '';
  target.sapo_parent_product_id = mapped.sapo_parent_product_id || target.sapo_parent_product_id || '';
  target.sapo_status = mapped.sapo_status || mapped.status || target.sapo_status || '';
  target.sapo_updated_at = mapped.sapo_updated_at || target.sapo_updated_at || '';
  target.sapo_last_synced_at = timestamp;
  target.sync_source = SAPO_SYNC_SOURCE;
  target.active = 1;
  target.updated_at = timestamp;
}

function makeUniqueSku(baseSku, products, excludeIndex = -1) {
  const cleanBase = normalizeSku(baseSku) || `SAPO-${Date.now()}`;
  const occupied = new Set(products
    .map((product, index) => (index === excludeIndex ? '' : normalizeSkuKey(product?.sku)))
    .filter(Boolean));
  if (!occupied.has(cleanBase.toLowerCase())) return cleanBase;

  for (let index = 1; index <= 9999; index += 1) {
    const candidate = `${cleanBase}-${index}`;
    if (!occupied.has(candidate.toLowerCase())) return candidate;
  }
  return `${cleanBase}-${Date.now()}`;
}

function syncMappedProducts(mappedProducts, options = {}) {
  const products = getAll('products').map(product => ({ ...product }));
  let nextId = getNextRowId(products);
  const timestamp = now();
  const summary = {
    total: mappedProducts.length,
    createdParents: 0,
    updatedParents: 0,
    existingParents: 0,
    createdVariants: 0,
    updatedVariants: 0,
    existingVariants: 0,
    skipped: 0,
    conflicts: 0,
    errors: 0,
    blocked: 0,
  };
  const results = [];
  const errors = [];
  const warnings = [];
  const categoryState = {
    createMissing: options.createMissingCategories !== false,
    categories: getAll('product_categories', category => category.active !== 0),
    byKey: buildCategoriesByKey(getAll('product_categories', category => category.active !== 0)),
  };

  const selectIds = new Set((options.selectedProductIds || options.selectedIds || [])
    .map(id => String(id).trim())
    .filter(Boolean));
  const selectVariantIds = new Set((options.selectedVariantIds || options.variantIds || options.selectedVariants || [])
    .map(id => String(id).trim())
    .filter(Boolean));
  const hasExplicitSelection = selectIds.size > 0 || selectVariantIds.size > 0;
  const syncAll = options.syncAll === true || !hasExplicitSelection;

  for (const mapped of mappedProducts) {
    const mappedProductId = String(mapped.sapo_product_id || '').trim();
    const mappedVariantIds = safeArray(mapped.variants)
      .map(variant => String(variant?.sapo_variant_id || variant?.variant_id || variant?.key || variant?.sku || '').trim())
      .filter(Boolean);
    const hasSelectedVariant = mappedVariantIds.some(id => selectVariantIds.has(id));

    if (!syncAll && !selectIds.has(mappedProductId) && !hasSelectedVariant) {
      summary.skipped += 1;
      results.push({ resource: 'products', key: mapped.sapo_product_id || mapped.sku, action: 'skipped', status: 'skipped', message: 'Không nằm trong danh sách chọn.' });
      continue;
    }

    try {
      let indexes = buildExistingIndexes(products);
      const parentMatch = findParentProductMatch(mapped, indexes);
      if (parentMatch.status === 'conflict') {
        summary.conflicts += 1;
        results.push({ resource: 'products', key: mapped.sapo_product_id || mapped.sku, action: 'conflict', status: 'conflict', conflicts: parentMatch.conflicts, message: 'Sản phẩm cha match nhiều dòng local.' });
        continue;
      }

      const defaultCategoryId = resolveCategoryId(mapped.category, categoryState);
      let parentIndex = parentMatch.index;
      const parentPayload = createLocalProductPayload(mapped, {
        timestamp,
        default_category_id: defaultCategoryId,
        syncImages: options.syncImages,
        syncDescriptions: options.syncDescriptions,
      });
      parentPayload.parent_id = null;
      parentPayload.stock = mapped.variants.length > 1 ? 0 : normalizeInteger(mapped.stock, 0);

      let parent;
      let parentAction = 'create';
      if (parentIndex >= 0) {
        parent = products[parentIndex];
        if (options.updateExistingProducts === false) {
          summary.skipped += 1;
          parentAction = 'skipped';
        } else {
          parentPayload.sku = parent.sku || '';
          applyProductUpdate(parent, parentPayload, {
            timestamp,
            default_category_id: defaultCategoryId,
            inventoryPolicy: options.inventoryPolicy,
            syncImages: options.syncImages,
            syncDescriptions: options.syncDescriptions,
            preserveSku: true,
          });
          parent.parent_id = null;
          summary.updatedParents += 1;
          parentAction = 'update';
        }
      } else {
        parentPayload.id = nextId++;
        parentPayload.sku = makeUniqueSku(parentPayload.sku, products);
        parentPayload.created_at = timestamp;
        parentPayload.updated_at = timestamp;
        products.push(parentPayload);
        parent = parentPayload;
        parentIndex = products.length - 1;
        summary.createdParents += 1;
      }

      const productResult = {
        resource: 'products',
        key: mapped.sapo_product_id || mapped.sku,
        local_id: parent?.id || null,
        sapo_product_id: mapped.sapo_product_id,
        sku: parent?.sku || mapped.sku,
        action: parentAction,
        status: parentAction,
        variants: [],
      };
      results.push(productResult);
      if (!parent || parentAction === 'skipped') continue;

      const shouldCreateVariantRows = mapped.variants.length > 1
        || (mapped.variants.length === 1 && (
          String(mapped.variants[0]?.sapo_variant_id || '') !== String(mapped.sapo_variant_id || '')
          || normalizeSkuKey(mapped.variants[0]?.sku) !== normalizeSkuKey(parent.sku)
          || normalizeSearchText(mapped.variants[0]?.name) !== normalizeSearchText(parent.name)
        ));

      if (!shouldCreateVariantRows) {
        if (mapped.variants.length === 1) {
          parent.sapo_variant_id = mapped.variants[0].sapo_variant_id || parent.sapo_variant_id || '';
          parent.option1 = mapped.variants[0].option1 || parent.option1 || '';
          parent.option2 = mapped.variants[0].option2 || parent.option2 || '';
          parent.option3 = mapped.variants[0].option3 || parent.option3 || '';
        }
        continue;
      }

      for (const [variantIndexInSapo, variant] of mapped.variants.entries()) {
        const variantMapped = {
          ...variant,
          sapo_product_id: mapped.sapo_product_id,
          sapo_parent_product_id: mapped.sapo_product_id,
          category: mapped.category,
          description: mapped.description,
          status: mapped.status,
          sapo_status: mapped.sapo_status,
          sapo_updated_at: mapped.sapo_updated_at,
        };
        const variantSelectionId = String(variantMapped.sapo_variant_id || variantMapped.variant_id || variantMapped.key || variantMapped.sku || '').trim();
        if (!syncAll && selectVariantIds.size > 0 && !selectVariantIds.has(variantSelectionId)) {
          continue;
        }

        indexes = buildExistingIndexes(products);
        const variantMatch = findVariantProductMatch(variantMapped, indexes, parent.id);
        if (variantMatch.status === 'conflict') {
          summary.conflicts += 1;
          const conflictResult = { resource: 'products', key: variantMapped.sapo_variant_id || variantMapped.sku, action: 'conflict', status: 'conflict', conflicts: variantMatch.conflicts, message: 'Biến thể match nhiều dòng local.' };
          productResult.variants.push(conflictResult);
          continue;
        }

        let variantIndex = variantMatch.index;
        const variantPayload = createLocalProductPayload({
          ...variantMapped,
          sku: variantMapped.sku || `${parent.sku}-${variantIndexInSapo + 1}`,
        }, {
          timestamp,
          default_category_id: defaultCategoryId,
          syncImages: options.syncImages,
          syncDescriptions: options.syncDescriptions,
        });
        variantPayload.parent_id = parent.id;

        if (variantIndex >= 0) {
          const target = products[variantIndex];
          variantPayload.sku = makeUniqueSku(variantPayload.sku || target.sku, products, variantIndex);
          applyProductUpdate(target, variantPayload, {
            timestamp,
            default_category_id: defaultCategoryId,
            inventoryPolicy: options.inventoryPolicy,
            syncImages: options.syncImages,
            syncDescriptions: options.syncDescriptions,
          });
          target.parent_id = parent.id;
          summary.updatedVariants += 1;
          productResult.variants.push({ resource: 'products', local_id: target.id, key: variantMapped.sapo_variant_id || variantMapped.sku, action: 'update', status: 'update' });
        } else {
          variantPayload.id = nextId++;
          variantPayload.sku = makeUniqueSku(variantPayload.sku, products);
          variantPayload.created_at = timestamp;
          variantPayload.updated_at = timestamp;
          products.push(variantPayload);
          summary.createdVariants += 1;
          productResult.variants.push({ resource: 'products', local_id: variantPayload.id, key: variantMapped.sapo_variant_id || variantMapped.sku, action: 'create', status: 'create' });
        }
      }
    } catch (err) {
      summary.errors += 1;
      const error = { resource: 'products', sapo_product_id: mapped.sapo_product_id, sku: mapped.sku, name: mapped.name, message: err.message };
      errors.push(error);
      results.push({ ...error, action: 'error', status: 'error' });
    }
  }

  replaceTable('products', products);
  return { summary, results, warnings, errors };
}

function getSapoCustomerId(customer) {
  return toSafeString(customer?.id || customer?.customer_id || customer?.admin_graphql_api_id, 80);
}

function normalizeSapoCustomer(customer = {}) {
  const defaultAddress = Array.isArray(customer.addresses) ? customer.addresses[0] || {} : (customer.default_address || customer.address || {});
  const name = toSafeString(customer.name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || customer.full_name || customer.email || customer.phone, 300);
  return {
    sapo_customer_id: getSapoCustomerId(customer),
    customer_code: normalizeCustomerCode(customer.customer_code || customer.code || customer.customer_number || customer.id),
    name: name || 'Khách hàng Sapo',
    phone: normalizePhone(customer.phone || defaultAddress.phone || customer.mobile),
    email: normalizeEmail(customer.email),
    tax_code: toSafeString(customer.tax_code || customer.tax_number || customer.tax_number_identification || '', 80),
    address: toSafeString(defaultAddress.address1 || defaultAddress.address || customer.address || '', 500),
    note: toSafeString(customer.note || '', 1000),
    customer_type: toSafeString(customer.customer_type || customer.group_name || customer.tags || 'Khách lẻ', 100) || 'Khách lẻ',
    sapo_updated_at: toSafeString(customer.updated_at || customer.modified_on || customer.created_at, 80),
    raw: customer,
  };
}

function buildCustomerIndexes(customers) {
  const indexes = { customers, bySapoId: new Map(), byCode: new Map(), byPhone: new Map(), byEmail: new Map() };
  customers.forEach((customer, index) => {
    if (!customer || customer.active === 0) return;
    if (customer.sapo_customer_id) mapPush(indexes.bySapoId, String(customer.sapo_customer_id), index);
    const code = normalizeCustomerCodeKey(customer.customer_code);
    const phone = normalizePhone(customer.phone);
    const email = normalizeEmail(customer.email);
    if (code) mapPush(indexes.byCode, code, index);
    if (phone) mapPush(indexes.byPhone, phone, index);
    if (email) mapPush(indexes.byEmail, email, index);
  });
  return indexes;
}

function resolveCustomerCandidates(indexes, map, key, reason) {
  const cleanKey = toSafeString(key, 300);
  if (!cleanKey || !map.has(cleanKey)) return [];
  return (map.get(cleanKey) || []).map(index => ({ index, reason })).filter(item => indexes.customers[item.index] && indexes.customers[item.index].active !== 0);
}

function findCustomerMatch(mapped, indexes) {
  const criteria = [
    resolveCustomerCandidates(indexes, indexes.bySapoId, mapped.sapo_customer_id, 'sapo_customer_id'),
    resolveCustomerCandidates(indexes, indexes.byCode, normalizeCustomerCodeKey(mapped.customer_code), 'customer_code'),
    resolveCustomerCandidates(indexes, indexes.byPhone, normalizePhone(mapped.phone), 'phone'),
    resolveCustomerCandidates(indexes, indexes.byEmail, normalizeEmail(mapped.email), 'email'),
  ];
  const nonEmpty = criteria.filter(group => group.length > 0);
  for (const group of nonEmpty) {
    const unique = Array.from(new Set(group.map(item => item.index)));
    if (unique.length > 1) {
      return { status: 'conflict', index: -1, reason: group[0]?.reason || '', conflicts: unique.map(index => indexes.customers[index]?.id).filter(Boolean) };
    }
  }
  const candidates = nonEmpty.flat();
  if (candidates.length === 0) return { status: 'new', index: -1, reason: '', conflicts: [] };
  const uniqueIndexes = Array.from(new Set(candidates.map(item => item.index)));
  if (uniqueIndexes.length > 1) {
    return { status: 'conflict', index: -1, reason: 'multiple_keys', conflicts: uniqueIndexes.map(index => indexes.customers[index]?.id).filter(Boolean) };
  }
  const index = uniqueIndexes[0];
  const reason = candidates.find(item => item.index === index)?.reason || '';
  return { status: 'existing', index, reason, conflicts: [] };
}

function analyzeCustomers(mappedCustomers = []) {
  const customers = getAll('customers');
  const indexes = buildCustomerIndexes(customers);
  const items = mappedCustomers.map(mapped => {
    const match = findCustomerMatch(mapped, indexes);
    const existing = match.index >= 0 ? customers[match.index] : null;
    const changedFields = existing ? diffFields(existing, mapped, ['name', 'phone', 'email', 'tax_code', 'customer_code', 'address', 'customer_type']) : [];
    const action = match.status === 'conflict'
      ? 'conflict'
      : (existing ? (changedFields.length > 0 ? 'update' : 'existing') : 'create');
    return {
      resource: 'customers',
      sapo_customer_id: mapped.sapo_customer_id,
      customer_code: mapped.customer_code,
      key: mapped.sapo_customer_id || mapped.customer_code || mapped.phone || mapped.email || mapped.name,
      name: mapped.name,
      phone: mapped.phone,
      email: mapped.email,
      existing_id: existing?.id || null,
      match_reason: match.reason,
      conflicts: match.conflicts || [],
      changed_fields: changedFields,
      action,
      status: action,
    };
  });
  return { items, summary: createStatusSummary(items) };
}

async function previewCustomers(body = {}, req = null) {
  const settings = resolveEffectiveSettings(body);
  const fetched = await fetchSapoResource(settings, 'customers', body);
  const mappedCustomers = fetched.rows.map(normalizeSapoCustomer);
  const analysis = analyzeCustomers(mappedCustomers);
  touchPreviewSettings(settings);
  safeAudit('sapo.preview.customers', req, { shop: settings.shop, count: analysis.items.length, query: fetched.query });
  return {
    ok: true,
    resource: 'customers',
    resources: ['customers'],
    page: fetched.page,
    limit: fetched.limit,
    query: fetched.query,
    count: analysis.items.length,
    summary: analysis.summary,
    items: analysis.items,
    results: analysis.items,
    warnings: [],
    errors: [],
    progress: { page: fetched.page, limit: fetched.limit, fetched: fetched.count },
    settings: publicSettings(getSettingsRow() || settings),
  };
}

function createLocalCustomerPayload(mapped, extras = {}) {
  const timestamp = extras.timestamp || now();
  return {
    name: mapped.name || 'Khách hàng Sapo',
    phone: normalizePhone(mapped.phone),
    email: normalizeEmail(mapped.email),
    tax_code: mapped.tax_code || '',
    customer_code: normalizeCustomerCode(mapped.customer_code),
    customer_type: mapped.customer_type || 'Khách lẻ',
    invoice_type: mapped.invoice_type || 'non_electronic',
    address: mapped.address || '',
    note: mapped.note || '',
    sapo_customer_id: mapped.sapo_customer_id || '',
    sapo_updated_at: mapped.sapo_updated_at || '',
    sapo_last_synced_at: timestamp,
    sync_source: SAPO_SYNC_SOURCE,
    active: 1,
  };
}

function applyCustomerUpdate(target, mapped, extras = {}) {
  const timestamp = extras.timestamp || now();
  if (mapped.name) target.name = mapped.name;
  if (mapped.phone !== undefined) target.phone = normalizePhone(mapped.phone);
  if (mapped.email !== undefined) target.email = normalizeEmail(mapped.email);
  if (mapped.tax_code !== undefined) target.tax_code = mapped.tax_code || target.tax_code || '';
  if (mapped.customer_code !== undefined) target.customer_code = normalizeCustomerCode(mapped.customer_code) || target.customer_code || '';
  if (mapped.customer_type !== undefined) target.customer_type = mapped.customer_type || target.customer_type || 'Khách lẻ';
  if (mapped.invoice_type !== undefined) target.invoice_type = mapped.invoice_type || target.invoice_type || 'non_electronic';
  if (mapped.address !== undefined) target.address = mapped.address || target.address || '';
  if (mapped.note !== undefined) target.note = mapped.note || target.note || '';
  target.sapo_customer_id = mapped.sapo_customer_id || target.sapo_customer_id || '';
  target.sapo_updated_at = mapped.sapo_updated_at || target.sapo_updated_at || '';
  target.sapo_last_synced_at = timestamp;
  target.sync_source = mapped.sync_source || target.sync_source || (mapped.sapo_customer_id ? SAPO_SYNC_SOURCE : '');
  target.active = 1;
  target.updated_at = timestamp;
}

function syncMappedCustomers(mappedCustomers, options = {}) {
  const customers = getAll('customers').map(customer => ({ ...customer }));
  let nextId = getNextRowId(customers);
  const timestamp = now();
  const summary = { total: mappedCustomers.length, created: 0, updated: 0, existing: 0, skipped: 0, conflicts: 0, errors: 0 };
  const results = [];
  const errors = [];
  const warnings = [];
  const selectIds = new Set((options.selectedCustomerIds || options.selectedIds || [])
    .map(id => String(id))
    .filter(Boolean));
  const syncAll = selectIds.size === 0 || options.syncAll === true;

  for (const mapped of mappedCustomers) {
    if (!syncAll && !selectIds.has(String(mapped.sapo_customer_id))) {
      summary.skipped += 1;
      results.push({ resource: 'customers', key: mapped.sapo_customer_id || mapped.phone || mapped.email, action: 'skipped', status: 'skipped' });
      continue;
    }
    try {
      const indexes = buildCustomerIndexes(customers);
      const match = findCustomerMatch(mapped, indexes);
      if (match.status === 'conflict') {
        summary.conflicts += 1;
        results.push({ resource: 'customers', key: mapped.sapo_customer_id || mapped.customer_code || mapped.phone || mapped.email, action: 'conflict', status: 'conflict', conflicts: match.conflicts, message: 'Khách hàng match mơ hồ nhiều dòng local.' });
        continue;
      }
      const existing = match.index >= 0 ? customers[match.index] : null;
      if (existing) {
        if (options.updateExistingCustomers === false) {
          summary.skipped += 1;
          results.push({ resource: 'customers', local_id: existing.id, key: mapped.sapo_customer_id || mapped.customer_code || mapped.phone || mapped.email, action: 'skipped', status: 'skipped' });
        } else {
          applyCustomerUpdate(existing, mapped, { timestamp });
          summary.updated += 1;
          results.push({ resource: 'customers', local_id: existing.id, key: mapped.sapo_customer_id || mapped.customer_code || mapped.phone || mapped.email, action: 'update', status: 'update', match_reason: match.reason });
        }
      } else {
        const created = { id: nextId++, ...createLocalCustomerPayload(mapped, { timestamp }), created_at: timestamp, updated_at: timestamp };
        customers.push(created);
        summary.created += 1;
        results.push({ resource: 'customers', local_id: created.id, key: mapped.sapo_customer_id || mapped.customer_code || mapped.phone || mapped.email, action: 'create', status: 'create' });
      }
    } catch (err) {
      summary.errors += 1;
      const error = { resource: 'customers', key: mapped.sapo_customer_id || mapped.phone || mapped.email, message: err.message };
      errors.push(error);
      results.push({ ...error, action: 'error', status: 'error' });
    }
  }

  replaceTable('customers', customers);
  return { summary, results, warnings, errors };
}

function getSapoInvoiceId(order) {
  return toSafeString(order?.id || order?.order_id || order?.admin_graphql_api_id, 80);
}

function normalizeInvoiceCode(order = {}) {
  return toSafeString(order.order_number || order.name || order.code || order.invoice_code || (order.id ? `SAPO-${order.id}` : ''), 120).replace(/^#/, '') || `SAPO-${Date.now()}`;
}

function normalizeSapoPaymentMethod(order = {}) {
  const value = toSafeString(order.gateway || order.payment_gateway_names?.[0] || order.payment_method || order.financial_status, 100).toLowerCase();
  if (/bank|transfer|chuyen|qr|vietqr/.test(value)) return 'bank';
  if (/debt|cod|pending|cong/.test(value)) return 'debt';
  return 'cash';
}

function normalizeSapoInvoiceStatus(order = {}) {
  const cancelled = order.cancelled_at || String(order.cancel_reason || '').trim();
  if (cancelled) return 'cancelled';
  const financial = toSafeString(order.financial_status, 80).toLowerCase();
  const fulfillment = toSafeString(order.fulfillment_status, 80).toLowerCase();
  if (financial === 'paid' || fulfillment === 'fulfilled' || fulfillment === 'shipped') return 'completed';
  return 'pending';
}

function normalizeSapoInvoice(order = {}) {
  const rawItems = Array.isArray(order.line_items) ? order.line_items : (Array.isArray(order.details) ? order.details : []);
  const customer = order.customer || (order.customer_id ? { id: order.customer_id, name: order.customer_name || '', phone: order.phone || '', email: order.email || '' } : {});
  const orderId = getSapoInvoiceId(order);
  const details = rawItems.map((item, index) => ({
    sapo_line_item_id: toSafeString(item.id || item.line_item_id, 80),
    sapo_order_id: orderId,
    sapo_product_id: toSafeString(item.product_id, 80),
    sapo_variant_id: toSafeString(item.variant_id, 80),
    sapo_sku: normalizeSku(item.sku || item.product_sku || item.variant_sku),
    sapo_barcode: normalizeBarcode(item.barcode || item.variant_barcode || item.product_barcode),
    sku: normalizeSku(item.sku || item.product_sku || item.variant_sku),
    barcode: normalizeBarcode(item.barcode || item.variant_barcode || item.product_barcode),
    name: toSafeString(item.name || item.title || item.product_name || `Sản phẩm ${index + 1}`, 500),
    quantity: normalizeNumber(item.quantity, 1),
    unit_price: normalizeNumber(item.price || item.unit_price, 0),
    discount_amount: normalizeNumber(item.total_discount || item.discount_amount, 0),
    line_total: normalizeNumber(item.total || item.line_total, (normalizeNumber(item.quantity, 1) * normalizeNumber(item.price || item.unit_price, 0))),
    raw: item,
  }));
  return {
    sapo_order_id: orderId,
    sapo_order_number: toSafeString(order.order_number || order.name || order.code || order.invoice_code, 120).replace(/^#/, ''),
    invoice_code: normalizeInvoiceCode(order),
    sapo_customer_id: toSafeString(order.customer_id || customer?.id, 80),
    customer: normalizeSapoCustomer(customer),
    subtotal: normalizeNumber(order.subtotal_price || order.subtotal, 0),
    discount_amount: normalizeNumber(order.total_discounts || order.discount_amount, 0),
    total: normalizeNumber(order.total_price || order.total, 0),
    paid_amount: normalizeNumber(order.total_price || order.paid_amount || order.total, 0),
    remaining_amount: normalizeNumber(order.outstanding_balance || order.remaining_amount, 0),
    delivery_fee: normalizeNumber(order.total_shipping_price_set?.shop_money?.amount || order.shipping_fee || order.delivery_fee, 0),
    payment_method: normalizeSapoPaymentMethod(order),
    status: normalizeSapoInvoiceStatus(order),
    sapo_status: toSafeString(order.status || order.order_status || normalizeSapoInvoiceStatus(order), 80),
    sapo_payment_status: toSafeString(order.financial_status || order.payment_status, 80),
    sapo_fulfillment_status: toSafeString(order.fulfillment_status, 80),
    note: toSafeString(order.note || order.cancel_reason || '', 1000),
    created_at: toSafeString(order.created_at || order.processed_at || now(), 80),
    sapo_updated_at: toSafeString(order.updated_at || order.modified_on || order.created_at, 80),
    details,
    raw: order,
  };
}

function buildInvoiceIndexes(invoices) {
  const indexes = { invoices, bySapoId: new Map(), byCode: new Map(), byOrderNumber: new Map() };
  invoices.forEach((invoice, index) => {
    if (!invoice) return;
    if (invoice.sapo_order_id) mapPush(indexes.bySapoId, String(invoice.sapo_order_id), index);
    const code = normalizeInvoiceCodeKey(invoice.invoice_code);
    const orderNumber = normalizeInvoiceCodeKey(invoice.sapo_order_number);
    if (code) mapPush(indexes.byCode, code, index);
    if (orderNumber) mapPush(indexes.byOrderNumber, orderNumber, index);
  });
  return indexes;
}

function resolveInvoiceCandidate(indexes, map, key, reason) {
  const cleanKey = toSafeString(key, 300);
  if (!cleanKey || !map.has(cleanKey)) return null;
  const candidates = Array.from(new Set((map.get(cleanKey) || []).filter(index => indexes.invoices[index])));
  if (candidates.length === 1) return { status: 'existing', index: candidates[0], reason };
  if (candidates.length > 1) return { status: 'conflict', index: -1, reason, conflicts: candidates.map(index => indexes.invoices[index]?.id).filter(Boolean) };
  return null;
}

function findInvoiceMatch(mapped, indexes) {
  return resolveInvoiceCandidate(indexes, indexes.bySapoId, mapped.sapo_order_id, 'sapo_order_id')
    || resolveInvoiceCandidate(indexes, indexes.byOrderNumber, normalizeInvoiceCodeKey(mapped.sapo_order_number), 'sapo_order_number')
    || resolveInvoiceCandidate(indexes, indexes.byCode, normalizeInvoiceCodeKey(mapped.invoice_code), 'invoice_code')
    || { status: 'new', index: -1, reason: '', conflicts: [] };
}

function buildProductLookup(products = getAll('products')) {
  const lookup = { bySapoProductId: new Map(), bySapoVariantId: new Map(), bySku: new Map(), byBarcode: new Map() };
  for (const product of products) {
    if (!product || product.active === 0) continue;
    if (product.sapo_product_id) mapPush(lookup.bySapoProductId, String(product.sapo_product_id), product);
    if (product.sapo_variant_id) mapPush(lookup.bySapoVariantId, String(product.sapo_variant_id), product);
    const sku = normalizeSkuKey(product.sku);
    const barcode = normalizeBarcodeKey(product.barcode);
    if (sku) mapPush(lookup.bySku, sku, product);
    if (barcode) mapPush(lookup.byBarcode, barcode, product);
  }
  return lookup;
}

function resolveProductFromLookup(map, key, reason) {
  const cleanKey = toSafeString(key, 300);
  if (!cleanKey || !map.has(cleanKey)) return null;
  const candidates = (map.get(cleanKey) || []).filter(product => product && product.active !== 0);
  const unique = Array.from(new Map(candidates.map(product => [Number(product.id), product])).values());
  if (unique.length === 1) return { product: unique[0], reason };
  if (unique.length > 1) return { product: null, reason, conflict: true, conflicts: unique.map(product => product.id) };
  return null;
}

function resolveProductForInvoiceLine(line, productLookup) {
  return resolveProductFromLookup(productLookup.bySapoVariantId, String(line.sapo_variant_id || ''), 'sapo_variant_id')
    || resolveProductFromLookup(productLookup.bySapoProductId, String(line.sapo_product_id || ''), 'sapo_product_id')
    || resolveProductFromLookup(productLookup.bySku, normalizeSkuKey(line.sku || line.sapo_sku), 'sku')
    || resolveProductFromLookup(productLookup.byBarcode, normalizeBarcodeKey(line.barcode || line.sapo_barcode), 'barcode')
    || { product: null, reason: '', conflict: false, conflicts: [] };
}

function analyzeInvoices(mappedInvoices = []) {
  const invoices = getAll('invoices');
  const invoiceIndexes = buildInvoiceIndexes(invoices);
  const customerIndexes = buildCustomerIndexes(getAll('customers'));
  const productLookup = buildProductLookup();
  const items = mappedInvoices.map(mapped => {
    const match = findInvoiceMatch(mapped, invoiceIndexes);
    const existing = match.index >= 0 ? invoices[match.index] : null;
    const customerMatch = findCustomerMatch(mapped.customer, customerIndexes);
    const lineResolutions = mapped.details.map(line => resolveProductForInvoiceLine(line, productLookup));
    const unresolvedLines = lineResolutions.filter(resolution => !resolution.product && !resolution.conflict).length;
    const conflictingLines = lineResolutions.filter(resolution => resolution.conflict).length;
    const changedFields = existing ? diffFields(existing, mapped, ['total', 'status', 'payment_method', 'remaining_amount', 'sapo_status', 'sapo_payment_status', 'sapo_fulfillment_status']) : [];
    let action = existing ? (changedFields.length > 0 ? 'update' : 'existing') : 'create';
    if (match.status === 'conflict' || customerMatch.status === 'conflict' || conflictingLines > 0) action = 'conflict';
    else if (!existing && unresolvedLines > 0) action = 'blocked';
    return {
      resource: 'invoices',
      sapo_order_id: mapped.sapo_order_id,
      sapo_order_number: mapped.sapo_order_number,
      key: mapped.sapo_order_id || mapped.invoice_code,
      invoice_code: mapped.invoice_code,
      customer_name: mapped.customer?.name || '',
      total: mapped.total,
      status: mapped.status,
      line_count: mapped.details.length,
      unresolved_lines: unresolvedLines,
      conflicting_lines: conflictingLines,
      existing_id: existing?.id || null,
      match_reason: match.reason,
      conflicts: match.conflicts || [],
      customer_existing_id: customerMatch.index >= 0 ? customerIndexes.customers[customerMatch.index]?.id : null,
      customer_match_reason: customerMatch.reason || '',
      customer_conflicts: customerMatch.conflicts || [],
      changed_fields: changedFields,
      action,
      status: action,
      warnings: unresolvedLines > 0 ? [`${unresolvedLines} dòng hàng chưa tìm được sản phẩm local.`] : [],
    };
  });
  return { items, summary: createStatusSummary(items) };
}

async function previewInvoices(body = {}, req = null) {
  const settings = resolveEffectiveSettings(body);
  const fetched = await fetchSapoResource(settings, 'invoices', body);
  const mappedInvoices = fetched.rows.map(normalizeSapoInvoice);
  const analysis = analyzeInvoices(mappedInvoices);
  touchPreviewSettings(settings);
  safeAudit('sapo.preview.invoices', req, { shop: settings.shop, count: analysis.items.length, query: fetched.query });
  return {
    ok: true,
    resource: 'invoices',
    resources: ['invoices'],
    page: fetched.page,
    limit: fetched.limit,
    query: fetched.query,
    count: analysis.items.length,
    summary: analysis.summary,
    items: analysis.items,
    results: analysis.items,
    warnings: analysis.items.flatMap(item => item.warnings || []),
    errors: [],
    progress: { page: fetched.page, limit: fetched.limit, fetched: fetched.count },
    settings: publicSettings(getSettingsRow() || settings),
  };
}

function createInvoicePayload(mapped, extras = {}) {
  const timestamp = extras.timestamp || now();
  return {
    invoice_code: mapped.invoice_code,
    customer_id: extras.customer_id || null,
    user_id: null,
    subtotal: normalizeNumber(mapped.subtotal, 0),
    vat_percent: 0,
    vat_amount: 0,
    discount_amount: normalizeNumber(mapped.discount_amount, 0),
    discount_percent: 0,
    total: normalizeNumber(mapped.total, 0),
    paid_amount: normalizeNumber(mapped.paid_amount, 0),
    change_amount: 0,
    remaining_amount: normalizeNumber(mapped.remaining_amount, 0),
    delivery_fee: normalizeNumber(mapped.delivery_fee, 0),
    payment_method: normalizePaymentMethod(mapped.payment_method),
    note: mapped.note || '',
    invoice_writer: 'Sapo',
    receiver_name: mapped.customer?.name || '',
    delivery_date: null,
    status: mapped.status || 'pending',
    sapo_order_id: mapped.sapo_order_id || '',
    sapo_order_number: mapped.sapo_order_number || mapped.invoice_code || '',
    sapo_customer_id: mapped.sapo_customer_id || mapped.customer?.sapo_customer_id || '',
    sapo_status: mapped.sapo_status || mapped.status || '',
    sapo_payment_status: mapped.sapo_payment_status || '',
    sapo_fulfillment_status: mapped.sapo_fulfillment_status || '',
    sapo_updated_at: mapped.sapo_updated_at || '',
    sapo_last_synced_at: timestamp,
    sync_source: SAPO_SYNC_SOURCE,
    created_at: mapped.created_at || timestamp,
    updated_at: timestamp,
  };
}

function applyInvoiceUpdate(target, mapped, extras = {}) {
  const payload = createInvoicePayload(mapped, extras);
  Object.assign(target, {
    ...payload,
    invoice_code: target.invoice_code || payload.invoice_code,
    created_at: target.created_at || payload.created_at,
  });
}

function createInvoiceDetailPayload(line, invoiceId, resolvedProduct = null) {
  const quantity = normalizeNumber(line.quantity, 1);
  const unitPrice = normalizeNumber(line.unit_price, 0);
  const discountAmount = normalizeNumber(line.discount_amount, 0);
  const productId = resolvedProduct?.id || null;
  return {
    invoice_id: invoiceId,
    type: 'product',
    item_type: 'product',
    combo_id: null,
    product_id: productId,
    variant_id: resolvedProduct?.parent_id ? resolvedProduct.id : null,
    product_name: resolvedProduct?.name || line.name || 'Sản phẩm Sapo',
    product_sku: resolvedProduct?.sku || line.sku || line.sapo_sku || '',
    name: resolvedProduct?.name || line.name || 'Sản phẩm Sapo',
    sku: resolvedProduct?.sku || line.sku || line.sapo_sku || '',
    quantity,
    unit_price: unitPrice,
    import_price: normalizeNumber(resolvedProduct?.import_price, 0),
    discount_amount: discountAmount,
    discount_percent: 0,
    line_total: normalizeNumber(line.line_total, quantity * unitPrice - discountAmount),
    sapo_line_item_id: line.sapo_line_item_id || '',
    sapo_order_id: line.sapo_order_id || '',
    sapo_product_id: line.sapo_product_id || '',
    sapo_variant_id: line.sapo_variant_id || '',
    sapo_sku: line.sapo_sku || line.sku || '',
    sapo_barcode: line.sapo_barcode || line.barcode || '',
    created_at: now(),
  };
}

function ensureCustomerForInvoice(mappedCustomer, customers, options, warnings, timestamp) {
  const hasIdentity = Boolean(mappedCustomer?.sapo_customer_id || mappedCustomer?.phone || mappedCustomer?.email || mappedCustomer?.customer_code);
  const hasRealName = Boolean(mappedCustomer?.name && mappedCustomer.name !== 'Khách hàng Sapo');
  if (!mappedCustomer || (!hasIdentity && !hasRealName)) {
    warnings.push('Hóa đơn không có thông tin khách hàng Sapo; customer_id để trống.');
    return { customer_id: null, changed: false };
  }
  let indexes = buildCustomerIndexes(customers);
  const match = findCustomerMatch(mappedCustomer, indexes);
  if (match.status === 'conflict') {
    warnings.push(`Khách hàng ${mappedCustomer.name || mappedCustomer.phone || mappedCustomer.email} match mơ hồ; customer_id để trống.`);
    return { customer_id: null, changed: false };
  }
  if (match.index >= 0) return { customer_id: customers[match.index].id, changed: false };
  if (options.createMissingCustomers === false) {
    warnings.push(`Chưa tìm thấy khách hàng ${mappedCustomer.name || mappedCustomer.phone || mappedCustomer.email}; customer_id để trống.`);
    return { customer_id: null, changed: false };
  }
  const created = {
    id: getNextRowId(customers),
    ...createLocalCustomerPayload(mappedCustomer, { timestamp }),
    created_at: timestamp,
    updated_at: timestamp,
  };
  customers.push(created);
  return { customer_id: created.id, changed: true };
}

function syncMappedInvoices(mappedInvoices, options = {}) {
  const invoices = getAll('invoices').map(invoice => ({ ...invoice }));
  let invoiceDetails = getAll('invoice_details').map(detail => ({ ...detail }));
  const customers = getAll('customers').map(customer => ({ ...customer }));
  let customersChanged = false;
  let nextInvoiceId = getNextRowId(invoices);
  let nextDetailId = getNextRowId(invoiceDetails);
  const timestamp = now();
  const summary = { total: mappedInvoices.length, created: 0, updated: 0, existing: 0, skipped: 0, blocked: 0, conflicts: 0, errors: 0, warnings: 0 };
  const results = [];
  const warnings = [];
  const errors = [];
  const selectIds = new Set((options.selectedInvoiceIds || options.selectedOrderIds || options.selectedIds || [])
    .map(id => String(id))
    .filter(Boolean));
  const syncAll = selectIds.size === 0 || options.syncAll === true;

  for (const mapped of mappedInvoices) {
    const key = mapped.sapo_order_id || mapped.invoice_code;
    if (!syncAll && !selectIds.has(String(mapped.sapo_order_id))) {
      summary.skipped += 1;
      results.push({ resource: 'invoices', key, action: 'skipped', status: 'skipped' });
      continue;
    }

    try {
      const invoiceIndexes = buildInvoiceIndexes(invoices);
      const match = findInvoiceMatch(mapped, invoiceIndexes);
      if (match.status === 'conflict') {
        summary.conflicts += 1;
        results.push({ resource: 'invoices', key, action: 'conflict', status: 'conflict', conflicts: match.conflicts, message: 'Hóa đơn match nhiều dòng local.' });
        continue;
      }

      const productLookup = buildProductLookup();
      const lineResolutions = mapped.details.map(line => ({ line, resolution: resolveProductForInvoiceLine(line, productLookup) }));
      const unresolved = lineResolutions.filter(item => !item.resolution.product && !item.resolution.conflict);
      const conflicted = lineResolutions.filter(item => item.resolution.conflict);
      if (conflicted.length > 0) {
        summary.conflicts += 1;
        results.push({ resource: 'invoices', key, action: 'conflict', status: 'conflict', message: `${conflicted.length} dòng hàng match nhiều sản phẩm local.`, lines: conflicted.map(item => item.line.name) });
        continue;
      }
      if (unresolved.length > 0 && options.allowUnresolvedInvoiceLines !== true) {
        summary.blocked += 1;
        const message = `${unresolved.length} dòng hàng chưa tìm được sản phẩm/biến thể local; bỏ qua hóa đơn để tránh dữ liệu thiếu dependency.`;
        warnings.push({ resource: 'invoices', key, message, unresolved_lines: unresolved.map(item => ({ name: item.line.name, sku: item.line.sku, sapo_product_id: item.line.sapo_product_id, sapo_variant_id: item.line.sapo_variant_id })) });
        results.push({ resource: 'invoices', key, action: 'blocked', status: 'blocked', message, unresolved_lines: unresolved.length });
        continue;
      }

      const perInvoiceWarnings = [];
      const customerResult = ensureCustomerForInvoice(mapped.customer, customers, options, perInvoiceWarnings, timestamp);
      if (customerResult.changed) customersChanged = true;
      if (perInvoiceWarnings.length > 0) {
        summary.warnings += perInvoiceWarnings.length;
        warnings.push(...perInvoiceWarnings.map(message => ({ resource: 'invoices', key, message })));
      }

      const existing = match.index >= 0 ? invoices[match.index] : null;
      if (existing) {
        if (options.updateExistingInvoices !== true) {
          summary.skipped += 1;
          results.push({ resource: 'invoices', local_id: existing.id, key, action: 'skipped', status: 'skipped', message: 'Hóa đơn đã tồn tại; updateExistingInvoices đang tắt.' });
          continue;
        }
        applyInvoiceUpdate(existing, mapped, { timestamp, customer_id: customerResult.customer_id });
        invoiceDetails = invoiceDetails.filter(detail => Number(detail.invoice_id) !== Number(existing.id));
        for (const item of lineResolutions) {
          const detail = { id: nextDetailId++, ...createInvoiceDetailPayload(item.line, existing.id, item.resolution.product) };
          invoiceDetails.push(detail);
        }
        summary.updated += 1;
        results.push({ resource: 'invoices', local_id: existing.id, key, action: 'update', status: 'update', details: lineResolutions.length, stock_policy: options.invoiceStockPolicy || 'keep' });
      } else {
        const created = { id: nextInvoiceId++, ...createInvoicePayload(mapped, { timestamp, customer_id: customerResult.customer_id }) };
        invoices.push(created);
        for (const item of lineResolutions) {
          const detail = { id: nextDetailId++, ...createInvoiceDetailPayload(item.line, created.id, item.resolution.product) };
          invoiceDetails.push(detail);
        }
        summary.created += 1;
        results.push({ resource: 'invoices', local_id: created.id, key, action: 'create', status: 'create', details: lineResolutions.length, stock_policy: options.invoiceStockPolicy || 'keep' });
      }
    } catch (err) {
      summary.errors += 1;
      const error = { resource: 'invoices', key, message: err.message };
      errors.push(error);
      results.push({ ...error, action: 'error', status: 'error' });
    }
  }

  if (customersChanged) replaceTable('customers', customers);
  replaceTable('invoices', invoices);
  replaceTable('invoice_details', invoiceDetails);
  return { summary, results, warnings, errors };
}

function shouldFetchAllForSync(body = {}) {
  if (body.maxPages !== undefined || body.max_pages !== undefined || body.allPages !== undefined || body.all_pages !== undefined || body.fetchAll !== undefined || body.fetch_all !== undefined) {
    return normalizeBoolean(body.allPages ?? body.all_pages ?? body.fetchAll ?? body.fetch_all, true);
  }
  return normalizeBoolean(body.syncAll || body.sync_all, false);
}

async function fetchRowsForResourceSync(settings, resource, body = {}) {
  if (shouldFetchAllForSync(body)) return fetchAllSapoResource(settings, resource, body);
  const fetched = await fetchSapoResource(settings, resource, body);
  return { ok: true, resource, rows: fetched.rows, page: fetched.page, limit: fetched.limit, count: fetched.count, maxPages: 1, progress: [{ page: fetched.page, count: fetched.count, total: fetched.count }] };
}

function mergeOptions(settings, body = {}) {
  const settingsOptions = { ...defaultSyncOptions(), ...parseJsonField(settings.options, {}) };
  return {
    ...settingsOptions,
    ...(body.options && typeof body.options === 'object' ? body.options : {}),
    selectedProductIds: Array.isArray(body.selectedProductIds) ? body.selectedProductIds : (Array.isArray(body.selectedIds) ? body.selectedIds : []),
    selectedVariantIds: Array.isArray(body.selectedVariantIds) ? body.selectedVariantIds : (Array.isArray(body.variantIds) ? body.variantIds : []),
    selectedCustomerIds: Array.isArray(body.selectedCustomerIds) ? body.selectedCustomerIds : (Array.isArray(body.selectedIds) ? body.selectedIds : []),
    selectedInvoiceIds: Array.isArray(body.selectedInvoiceIds) ? body.selectedInvoiceIds : (Array.isArray(body.selectedOrderIds) ? body.selectedOrderIds : (Array.isArray(body.selectedIds) ? body.selectedIds : [])),
    syncAll: normalizeBoolean(body.syncAll || body.sync_all, false),
  };
}

async function syncProducts(body = {}, req = null) {
  const settings = resolveEffectiveSettings(body);
  const options = mergeOptions(settings, body);
  const fetched = await fetchRowsForResourceSync(settings, 'products', body);
  const mappedProducts = fetched.rows.map(normalizeSapoProduct);
  const result = syncMappedProducts(mappedProducts, options);
  const runId = recordSyncRun({
    resource: 'products',
    resources: ['products'],
    mode: 'sync',
    phase: 'commit',
    status: result.summary.errors > 0 || result.summary.conflicts > 0 || result.summary.blocked > 0 ? 'partial' : 'success',
    shop: settings.shop,
    base_url: settings.base_url,
    total: result.summary.total,
    summary: result.summary,
    warnings: result.warnings,
    errors: result.errors,
    progress: { products: { fetched: fetched.count, page: fetched.page, limit: fetched.limit, maxPages: fetched.maxPages } },
  });

  touchSyncSettings(settings);
  safeAudit('sapo.sync.products', req, { shop: settings.shop, run_id: runId, summary: result.summary });

  return buildSyncResponse({
    resource: 'products',
    resources: ['products'],
    runId,
    fetched,
    result,
    message: result.summary.errors > 0 || result.summary.conflicts > 0 || result.summary.blocked > 0
      ? 'Đồng bộ sản phẩm Sapo hoàn tất một phần, có lỗi/cảnh báo cần xem lại.'
      : 'Đồng bộ sản phẩm Sapo hoàn tất.',
    settings,
  });
}

async function syncCustomers(body = {}, req = null) {
  const settings = resolveEffectiveSettings(body);
  const options = mergeOptions(settings, body);
  const fetched = await fetchRowsForResourceSync(settings, 'customers', body);
  const mappedCustomers = fetched.rows.map(normalizeSapoCustomer);
  const result = syncMappedCustomers(mappedCustomers, options);
  const runId = recordSyncRun({
    resource: 'customers',
    resources: ['customers'],
    mode: 'sync',
    phase: 'commit',
    status: result.summary.errors > 0 || result.summary.conflicts > 0 ? 'partial' : 'success',
    shop: settings.shop,
    base_url: settings.base_url,
    total: result.summary.total,
    summary: result.summary,
    warnings: result.warnings,
    errors: result.errors,
    progress: { customers: { fetched: fetched.count, page: fetched.page, limit: fetched.limit, maxPages: fetched.maxPages } },
  });

  touchSyncSettings(settings);
  safeAudit('sapo.sync.customers', req, { shop: settings.shop, run_id: runId, summary: result.summary });

  return buildSyncResponse({
    resource: 'customers',
    resources: ['customers'],
    runId,
    fetched,
    result,
    message: result.summary.errors > 0 || result.summary.conflicts > 0
      ? 'Đồng bộ khách hàng Sapo hoàn tất một phần, có lỗi/cảnh báo cần xem lại.'
      : 'Đồng bộ khách hàng Sapo hoàn tất.',
    settings,
  });
}

async function syncInvoices(body = {}, req = null) {
  const settings = resolveEffectiveSettings(body);
  const options = mergeOptions(settings, body);
  const fetched = await fetchRowsForResourceSync(settings, 'invoices', body);
  const mappedInvoices = fetched.rows.map(normalizeSapoInvoice);
  const result = syncMappedInvoices(mappedInvoices, options);
  const runId = recordSyncRun({
    resource: 'invoices',
    resources: ['invoices'],
    mode: 'sync',
    phase: 'commit',
    status: result.summary.errors > 0 || result.summary.conflicts > 0 || result.summary.blocked > 0 ? 'partial' : 'success',
    shop: settings.shop,
    base_url: settings.base_url,
    total: result.summary.total,
    summary: result.summary,
    warnings: result.warnings,
    errors: result.errors,
    progress: { invoices: { fetched: fetched.count, page: fetched.page, limit: fetched.limit, maxPages: fetched.maxPages } },
  });

  touchSyncSettings(settings);
  safeAudit('sapo.sync.invoices', req, { shop: settings.shop, run_id: runId, summary: result.summary });

  return buildSyncResponse({
    resource: 'invoices',
    resources: ['invoices'],
    runId,
    fetched,
    result,
    message: result.summary.errors > 0 || result.summary.conflicts > 0 || result.summary.blocked > 0
      ? 'Đồng bộ hóa đơn Sapo hoàn tất một phần, có lỗi/cảnh báo cần xem lại.'
      : 'Đồng bộ hóa đơn Sapo hoàn tất.',
    settings,
  });
}

function buildSyncResponse({ resource, resources, runId, fetched, result, message, settings }) {
  const hasPartial = (result.summary.errors || 0) > 0
    || (result.summary.conflicts || 0) > 0
    || (result.summary.blocked || 0) > 0;
  return {
    ok: true,
    partial: hasPartial,
    resource,
    resources,
    run_id: runId,
    page: fetched.page,
    limit: fetched.limit,
    count: fetched.count,
    summary: result.summary,
    items: result.results,
    results: result.results,
    warnings: result.warnings,
    errors: result.errors,
    progress: { [resource]: { fetched: fetched.count, page: fetched.page, limit: fetched.limit, maxPages: fetched.maxPages } },
    message,
    settings: publicSettings(getSettingsRow() || settings),
  };
}

async function analyzeSapoData(body = {}, req = null) {
  const settings = resolveEffectiveSettings(body);
  const groups = normalizeGroups(body.resources || body.groups || body.resource);
  const analysis = {};
  const fetched = {};
  const warnings = [];
  const errors = [];
  const progress = {};

  for (const resource of groups) {
    try {
      const resourceData = await fetchAllSapoResource(settings, resource, body);
      fetched[resource] = { count: resourceData.count, page: resourceData.page, limit: resourceData.limit, maxPages: resourceData.maxPages };
      progress[resource] = resourceData.progress;
      if (resource === 'products') analysis.products = analyzeProducts(resourceData.rows.map(normalizeSapoProduct));
      if (resource === 'customers') analysis.customers = analyzeCustomers(resourceData.rows.map(normalizeSapoCustomer));
      if (resource === 'invoices') analysis.invoices = analyzeInvoices(resourceData.rows.map(normalizeSapoInvoice));
    } catch (err) {
      errors.push({ resource, code: err.code || 'SAPO_ANALYZE_ERROR', message: err.message });
      analysis[resource] = { items: [], summary: createStatusSummary([]) };
      fetched[resource] = { count: 0, error: err.message };
    }
  }

  touchPreviewSettings(settings);
  safeAudit('sapo.analyze', req, { shop: settings.shop, groups, fetched, errors: errors.length });
  const summary = Object.fromEntries(Object.entries(analysis).map(([resource, value]) => [resource, value.summary]));
  const runId = recordSyncRun({
    resource: groups.length === 1 ? groups[0] : 'all',
    resources: groups,
    mode: 'analyze',
    phase: 'preview',
    status: errors.length > 0 ? 'partial' : 'success',
    shop: settings.shop,
    base_url: settings.base_url,
    total: Object.values(fetched).reduce((sum, item) => sum + normalizeInteger(item.count, 0), 0),
    summary,
    warnings,
    errors,
    progress,
  });
  return {
    ok: errors.length === 0,
    partial: errors.length > 0,
    resource: groups.length === 1 ? groups[0] : 'all',
    resources: groups,
    groups,
    run_id: runId,
    fetched,
    summary,
    analysis,
    items: analysis,
    results: analysis,
    warnings,
    errors,
    progress,
    settings: publicSettings(getSettingsRow() || settings),
    serverTime: now(),
  };
}

function analyzeProducts(mappedProducts = []) {
  const products = getAll('products');
  const indexes = buildExistingIndexes(products);
  const items = mappedProducts.map(mapped => previewMappedProduct(mapped, indexes));
  return { items, summary: createStatusSummary(items) };
}

async function syncSapoData(body = {}, req = null) {
  const settings = resolveEffectiveSettings(body);
  const groups = normalizeGroups(body.resources || body.groups || body.resource);
  const options = mergeOptions(settings, { ...body, syncAll: true });
  const resultsByResource = {};
  const summary = {};
  const warnings = [];
  const errors = [];
  const progress = {};
  const fetched = {};

  for (const resource of groups) {
    try {
      const resourceData = await fetchAllSapoResource(settings, resource, body);
      fetched[resource] = { count: resourceData.count, page: resourceData.page, limit: resourceData.limit, maxPages: resourceData.maxPages };
      progress[resource] = resourceData.progress;
      let result;
      if (resource === 'products') result = syncMappedProducts(resourceData.rows.map(normalizeSapoProduct), options);
      if (resource === 'customers') result = syncMappedCustomers(resourceData.rows.map(normalizeSapoCustomer), options);
      if (resource === 'invoices') result = syncMappedInvoices(resourceData.rows.map(normalizeSapoInvoice), options);
      resultsByResource[resource] = result;
      summary[resource] = result.summary;
      warnings.push(...safeArray(result.warnings).map(warning => (typeof warning === 'string' ? { resource, message: warning } : { resource, ...warning })));
      errors.push(...safeArray(result.errors).map(error => ({ resource, ...error })));
    } catch (err) {
      const error = { resource, code: err.code || 'SAPO_SYNC_ERROR', message: err.message };
      errors.push(error);
      summary[resource] = { total: 0, errors: 1 };
      resultsByResource[resource] = { summary: summary[resource], results: [], warnings: [], errors: [error] };
      fetched[resource] = { count: 0, error: err.message };
    }
  }

  touchSyncSettings(settings);
  const total = Object.values(fetched).reduce((sum, item) => sum + normalizeInteger(item.count, 0), 0);
  const hasPartial = errors.length > 0 || warnings.some(warning => warning && warning.status === 'blocked')
    || Object.values(summary).some(item => (item?.errors || 0) > 0 || (item?.conflicts || 0) > 0 || (item?.blocked || 0) > 0);
  const runId = recordSyncRun({
    resource: groups.length === 1 ? groups[0] : 'all',
    resources: groups,
    mode: 'sync',
    phase: 'commit',
    status: hasPartial ? 'partial' : 'success',
    shop: settings.shop,
    base_url: settings.base_url,
    total,
    summary,
    warnings,
    errors,
    progress,
  });
  safeAudit('sapo.sync.all', req, { shop: settings.shop, run_id: runId, groups, summary, errors: errors.length });

  return {
    ok: true,
    partial: hasPartial,
    resource: groups.length === 1 ? groups[0] : 'all',
    resources: groups,
    groups,
    run_id: runId,
    fetched,
    summary,
    items: resultsByResource,
    results: resultsByResource,
    warnings,
    errors,
    progress,
    message: hasPartial ? 'Đồng bộ Sapo hoàn tất một phần, có lỗi/cảnh báo cần xem lại.' : 'Đồng bộ dữ liệu Sapo hoàn tất.',
    settings: publicSettings(getSettingsRow() || settings),
    serverTime: now(),
  };
}

const CUSTOMER_IMPORT_ALIASES = Object.freeze({
  customer_code: ['customer_code', 'Mã khách hàng', 'Ma khach hang', 'Mã KH', 'Ma KH', 'code'],
  name: ['name', 'Tên khách hàng', 'Ten khach hang', 'Họ tên', 'Ho ten', 'Khách hàng', 'Khach hang'],
  phone: ['phone', 'Điện thoại', 'Dien thoai', 'SĐT', 'SDT', 'Số điện thoại', 'So dien thoai'],
  email: ['email', 'Email'],
  address: ['address', 'Địa chỉ', 'Dia chi'],
  note: ['note', 'Ghi chú', 'Ghi chu'],
  customer_type: ['customer_type', 'Nhóm khách', 'Nhom khach', 'Loại khách', 'Loai khach'],
  tax_code: ['tax_code', 'Mã số thuế', 'Ma so thue', 'MST'],
});

function normalizeImportKey(value) {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function hasImportValue(value) {
  return !(value === undefined || value === null || String(value).trim() === '');
}

function isImportMetadataKey(key) {
  return ['__line', '_line', 'line', 'rowNumber', '__rowNum__'].includes(String(key));
}

function getCustomerImportLine(row, index) {
  for (const key of ['__line', '_line', 'line', 'rowNumber']) {
    const value = Number(row?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const xlsxRowNumber = Number(row?.__rowNum__);
  if (Number.isFinite(xlsxRowNumber) && xlsxRowNumber >= 0) return xlsxRowNumber + 1;
  return index + 2;
}

function getImportCell(row, aliases, mappingKey, mapping = {}) {
  if (!row || typeof row !== 'object') return '';
  const mappedColumn = mapping[mappingKey];
  const keys = [mappedColumn, ...aliases].filter(Boolean);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key) && hasImportValue(row[key])) return row[key];
  }
  const normalizedKeys = keys.map(normalizeImportKey);
  for (const [actualKey, value] of Object.entries(row)) {
    if (isImportMetadataKey(actualKey)) continue;
    if (normalizedKeys.includes(normalizeImportKey(actualKey)) && hasImportValue(value)) return value;
  }
  return '';
}

function rowHasCustomerImportData(row) {
  if (!row || typeof row !== 'object') return false;
  return Object.entries(row).some(([key, value]) => !isImportMetadataKey(key) && hasImportValue(value));
}

function normalizeCustomerImportRow(row, index, mapping = {}) {
  const line = getCustomerImportLine(row, index);
  const normalized = { line, rowIndex: index };
  for (const field of Object.keys(CUSTOMER_IMPORT_ALIASES)) {
    normalized[field] = toSafeString(getImportCell(row, CUSTOMER_IMPORT_ALIASES[field], field, mapping), field === 'note' || field === 'address' ? 1000 : 300);
  }
  normalized.phone = normalizePhone(normalized.phone);
  normalized.email = normalizeEmail(normalized.email);
  normalized.customer_code = normalizeCustomerCode(normalized.customer_code);
  normalized.customer_type = normalized.customer_type || 'Khách lẻ';
  return normalized;
}

function validateCustomerImportRow(row) {
  const errors = [];
  if (!row.name) errors.push({ line: row.line, field: 'name', message: 'Thiếu tên khách hàng' });
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push({ line: row.line, field: 'email', message: 'Email không hợp lệ' });
  if (row.phone && row.phone.replace(/[^0-9]/g, '').length < 8) errors.push({ line: row.line, field: 'phone', message: 'Số điện thoại quá ngắn' });
  if (!row.customer_code && !row.phone && !row.email && !row.name) errors.push({ line: row.line, field: 'identity', message: 'Thiếu dữ liệu định danh khách hàng' });
  return errors;
}

function collectCustomerImportReceivedColumns(rows) {
  const received = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      if (isImportMetadataKey(key) || seen.has(key)) continue;
      seen.add(key);
      received.push(key);
    }
  }
  return received;
}

function buildCustomerImportPreview(rowsInput, mapping = {}) {
  const inputRows = Array.isArray(rowsInput) ? rowsInput : [];
  const rawRows = inputRows.map((row, index) => ({ row, index })).filter(({ row }) => rowHasCustomerImportData(row));
  const rows = rawRows.map(({ row, index }) => normalizeCustomerImportRow(row, index, mapping));
  const fileKeys = { code: new Map(), phone: new Map(), email: new Map() };
  const customers = getAll('customers');
  const indexes = buildCustomerIndexes(customers);
  const items = [];

  for (const row of rows) {
    const validationErrors = validateCustomerImportRow(row);
    const duplicateMessages = [];
    const keys = [
      ['code', normalizeCustomerCodeKey(row.customer_code), 'customer_code'],
      ['phone', normalizePhone(row.phone), 'phone'],
      ['email', normalizeEmail(row.email), 'email'],
    ];
    for (const [bucket, key, field] of keys) {
      if (!key) continue;
      if (fileKeys[bucket].has(key)) {
        duplicateMessages.push({ line: row.line, field, message: `Trùng ${field} trong file với dòng ${fileKeys[bucket].get(key).line}` });
      } else {
        fileKeys[bucket].set(key, row);
      }
    }

    const match = findCustomerMatch({ ...row, sapo_customer_id: '' }, indexes);
    const existing = match.index >= 0 ? customers[match.index] : null;
    let action = existing ? 'update' : 'create';
    if (match.status === 'conflict') {
      duplicateMessages.push({ line: row.line, field: 'identity', message: `Trùng nhiều khách trong DB: ${match.conflicts.join(', ')}` });
    }
    if (validationErrors.length > 0) action = 'error';
    else if (duplicateMessages.length > 0) action = 'duplicate';

    items.push({
      resource: 'customers',
      line: row.line,
      rowIndex: row.rowIndex,
      customer_code: row.customer_code,
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      note: row.note,
      customer_type: row.customer_type,
      tax_code: row.tax_code,
      existing_id: existing?.id || null,
      match_reason: match.reason || '',
      conflicts: match.conflicts || [],
      action,
      status: action,
      errors: [...validationErrors, ...duplicateMessages],
    });
  }

  return {
    rows,
    items,
    summary: createStatusSummary(items),
    errors: items.flatMap(item => item.errors || []),
  };
}

function previewCustomerImportRows(body = {}, req = null) {
  const rows = Array.isArray(body) ? body : body.rows;
  if (!Array.isArray(rows)) throw createAppError('Body phải là array rows hoặc object { rows: [...] }.', 400, 'SAPO_IMPORT_INVALID_BODY');
  const mapping = body.mapping && typeof body.mapping === 'object' ? body.mapping : {};
  const preview = buildCustomerImportPreview(rows, mapping);
  safeAudit('sapo.import.customers.preview', req, { rows: preview.items.length, errors: preview.errors.length });
  return {
    ok: preview.errors.length === 0,
    resource: 'customers',
    resources: ['customers'],
    mode: 'preview',
    summary: preview.summary,
    items: preview.items,
    results: preview.items,
    warnings: [],
    errors: preview.errors,
    progress: { totalRows: preview.items.length, validRows: preview.items.filter(item => !['error', 'duplicate'].includes(item.action)).length },
    receivedColumns: collectCustomerImportReceivedColumns(rows),
    expectedFields: Object.keys(CUSTOMER_IMPORT_ALIASES),
  };
}

function commitCustomerImportRows(body = {}, req = null) {
  const rows = Array.isArray(body) ? body : body.rows;
  if (!Array.isArray(rows)) throw createAppError('Body phải là array rows hoặc object { rows: [...] }.', 400, 'SAPO_IMPORT_INVALID_BODY');
  const mapping = body.mapping && typeof body.mapping === 'object' ? body.mapping : {};
  const mode = ['create_only', 'update_only', 'upsert'].includes(String(body.mode || '').trim()) ? String(body.mode).trim() : 'upsert';
  const preview = buildCustomerImportPreview(rows, mapping);
  const customers = getAll('customers').map(customer => ({ ...customer }));
  let nextId = getNextRowId(customers);
  const timestamp = now();
  const results = [];
  const summary = { total: preview.items.length, created: 0, updated: 0, skipped: 0, duplicates: 0, errors: 0 };
  const previewRowsByIndex = new Map(preview.rows.map(row => [row.rowIndex, row]));

  for (const item of preview.items) {
    const row = previewRowsByIndex.get(item.rowIndex);
    if (!row) {
      summary.errors += 1;
      results.push({ ...item, action: 'error', status: 'error', message: 'Không tìm thấy dữ liệu dòng import.' });
      continue;
    }

    if (item.action === 'error') {
      summary.errors += 1;
      results.push({ ...item, action: 'error', status: 'error', message: 'Dữ liệu dòng không hợp lệ.', errors: item.errors || [] });
      continue;
    }

    if (item.action === 'duplicate') {
      summary.duplicates += 1;
      results.push({ ...item, action: 'duplicate', status: 'duplicate', message: 'Dòng bị trùng trong file hoặc trùng nhiều bản ghi DB, đã bỏ qua.' });
      continue;
    }

    const indexes = buildCustomerIndexes(customers);
    const match = findCustomerMatch({ ...row, sapo_customer_id: '' }, indexes);
    if (match.status === 'conflict') {
      summary.duplicates += 1;
      results.push({ ...item, action: 'duplicate', status: 'duplicate', message: `Trùng nhiều khách trong DB: ${match.conflicts.join(', ')}` });
      continue;
    }

    const existing = match.index >= 0 ? customers[match.index] : null;
    if (existing && mode === 'create_only') {
      summary.skipped += 1;
      results.push({ ...item, local_id: existing.id, action: 'skipped', status: 'skipped', message: 'create_only bỏ qua khách đã tồn tại.' });
      continue;
    }
    if (!existing && mode === 'update_only') {
      summary.skipped += 1;
      results.push({ ...item, action: 'skipped', status: 'skipped', message: 'update_only bỏ qua khách chưa tồn tại.' });
      continue;
    }

    if (existing) {
      applyCustomerUpdate(existing, { ...row, sync_source: existing.sync_source || '' }, { timestamp });
      existing.sync_source = existing.sync_source || '';
      summary.updated += 1;
      results.push({ ...item, local_id: existing.id, action: 'update', status: 'update', match_reason: match.reason });
    } else {
      const created = {
        id: nextId++,
        ...createLocalCustomerPayload({ ...row, sapo_customer_id: '', sapo_updated_at: '', sync_source: '' }, { timestamp }),
        sync_source: '',
        created_at: timestamp,
        updated_at: timestamp,
      };
      customers.push(created);
      summary.created += 1;
      results.push({ ...item, local_id: created.id, action: 'create', status: 'create' });
    }
  }

  replaceTable('customers', customers);
  const runId = recordSyncRun({
    resource: 'customers',
    resources: ['customers'],
    mode: `excel_${mode}`,
    phase: 'commit',
    status: summary.errors > 0 || summary.duplicates > 0 ? 'partial' : 'success',
    shop: '',
    base_url: '',
    total: summary.total,
    summary,
    warnings: [],
    errors: [],
    progress: { totalRows: summary.total, committedRows: summary.created + summary.updated, skippedRows: summary.skipped, duplicateRows: summary.duplicates },
  });
  safeAudit('sapo.import.customers.commit', req, { run_id: runId, mode, summary });

  return {
    ok: summary.errors === 0,
    partial: summary.errors > 0 || summary.duplicates > 0 || summary.skipped > 0,
    resource: 'customers',
    resources: ['customers'],
    mode,
    run_id: runId,
    summary,
    items: results,
    results,
    warnings: [],
    errors: [],
    progress: { totalRows: summary.total, committedRows: summary.created + summary.updated, skippedRows: summary.skipped, duplicateRows: summary.duplicates },
    message: 'Import khách hàng từ Excel JSON rows hoàn tất.',
    receivedColumns: collectCustomerImportReceivedColumns(rows),
    expectedFields: Object.keys(CUSTOMER_IMPORT_ALIASES),
  };
}

function touchPreviewSettings(settings) {
  const existing = getSettingsRow();
  if (existing && settings.base_url === existing.base_url && settings.access_token === existing.access_token) {
    update('sapo_settings', existing.id, { last_preview_at: now(), updated_at: now() });
  }
}

function touchSyncSettings(settings) {
  const existing = getSettingsRow();
  if (existing && settings.base_url === existing.base_url && settings.access_token === existing.access_token) {
    update('sapo_settings', existing.id, { last_sync_at: now(), updated_at: now() });
  }
}

function recordSyncRun({ resource = '', resources = [], mode = 'sync', phase = 'commit', status, shop, base_url, total, summary, warnings = [], errors = [], progress = {} }) {
  const timestamp = now();
  return insert('sapo_sync_runs', {
    resource: resource || (resources.length === 1 ? resources[0] : 'all'),
    resources,
    mode,
    phase,
    status,
    shop: shop || '',
    base_url: base_url || '',
    total: normalizeInteger(total, 0),
    progress,
    progress_json: stringifyJsonField(progress, {}),
    summary,
    summary_json: stringifyJsonField(summary, {}),
    warnings,
    warnings_json: stringifyJsonField(warnings, []),
    errors,
    errors_json: stringifyJsonField(errors, []),
    created_at: timestamp,
    updated_at: timestamp,
  });
}

function getRuns(limit = 20) {
  const safeLimit = Math.min(Math.max(normalizeInteger(limit, 20), 1), 100);
  return getAll('sapo_sync_runs')
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, safeLimit)
    .map(run => ({
      id: run.id,
      resource: run.resource || '',
      resources: Array.isArray(run.resources) ? run.resources : parseJsonField(run.resources_json, []),
      mode: run.mode || '',
      phase: run.phase || '',
      status: run.status,
      shop: run.shop,
      base_url: run.base_url,
      total: run.total,
      progress: run.progress || parseJsonField(run.progress_json, {}),
      summary: run.summary || parseJsonField(run.summary_json, {}),
      warnings: Array.isArray(run.warnings) ? run.warnings.slice(0, 20) : parseJsonField(run.warnings_json, []).slice(0, 20),
      errors: Array.isArray(run.errors) ? run.errors.slice(0, 20) : parseJsonField(run.errors_json, []).slice(0, 20),
      created_at: run.created_at,
      updated_at: run.updated_at,
    }));
}

function safeAudit(action, req, meta = {}) {
  try {
    auditLog(action, {
      user_id: req?.user?.id || null,
      account_id: req?.accountId || req?.user?.account_id || null,
      ip: req?.ip || req?.connection?.remoteAddress || '',
      user_agent: req?.headers?.['user-agent'] || '',
      meta,
    });
  } catch (err) {
    console.warn('[KHA SAPO] audit log failed:', err.message);
  }
}

module.exports = {
  DEFAULT_API_VERSION,
  publicSettings,
  saveSettings,
  validateConnection,
  fetchSapoResource,
  fetchAllSapoResource,
  previewProducts,
  previewCustomers,
  previewInvoices,
  analyzeSapoData,
  syncSapoData,
  syncProducts,
  syncCustomers,
  syncInvoices,
  previewCustomerImportRows,
  commitCustomerImportRows,
  getRuns,
  normalizeShopInput,
  normalizeSapoProduct,
  normalizeSapoCustomer,
  normalizeSapoInvoice,
  redactToken,
};
