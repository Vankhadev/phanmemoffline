import { apiFetch } from './apiClient';
import { getDefaultTemplate, normalizeTemplateRecord } from './defaultInvoiceTemplates';

const CACHE_PREFIX = 'kha_print_template_default';
const CACHE_VERSION = 1;

function canUseLocalStorage() {
  try {
    return typeof window !== 'undefined' && Boolean(window.localStorage);
  } catch (_) {
    return false;
  }
}

function getCacheKey(type = 'sale_invoice', paperSize = '') {
  const typeKey = String(type || 'sale_invoice').trim() || 'sale_invoice';
  const paperKey = String(paperSize || 'default').trim() || 'default';
  return `${CACHE_PREFIX}_${typeKey}_${paperKey}`;
}

function normalizeApiBase(apiBase = '') {
  return String(apiBase || '').replace(/\/+$/, '');
}

function withSource(template, source) {
  return template ? { ...template, _source: source } : template;
}

function parseCachedPayload(raw, fallbackType, fallbackPaperSize) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const record = parsed?.template || parsed;
    if (!record || typeof record !== 'object') return null;
    return normalizeTemplateRecord(record, fallbackType, fallbackPaperSize);
  } catch (_) {
    return null;
  }
}

function getCachedTemplate(type = 'sale_invoice', paperSize = '') {
  if (!canUseLocalStorage()) return null;
  const exact = parseCachedPayload(localStorage.getItem(getCacheKey(type, paperSize)), type, paperSize || '80mm');
  if (exact) return withSource(exact, 'cache');
  if (paperSize) {
    const generic = parseCachedPayload(localStorage.getItem(getCacheKey(type, '')), type, paperSize || '80mm');
    if (generic) return withSource(generic, 'cache');
  }
  return null;
}

function cacheTemplate(template, type = 'sale_invoice', paperSize = '') {
  if (!template || !canUseLocalStorage()) return;
  try {
    const normalized = normalizeTemplateRecord(template, type, paperSize || template.paper_size || '80mm');
    const payload = {
      version: CACHE_VERSION,
      cached_at: new Date().toISOString(),
      type: normalized.type || type,
      paper_size: normalized.paper_size || paperSize || '',
      template: normalized,
    };
    localStorage.setItem(getCacheKey(type, paperSize), JSON.stringify(payload));
    if (paperSize) localStorage.setItem(getCacheKey(type, ''), JSON.stringify(payload));
  } catch (_) {
    // Bỏ qua lỗi quota hoặc môi trường không hỗ trợ localStorage.
  }
}

async function fetchJsonWithTimeout(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await apiFetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildDefaultTemplateUrl(apiBase, type, paperSize) {
  const base = normalizeApiBase(apiBase);
  if (!base) return '';
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (paperSize) params.set('paper_size', paperSize);
  const query = params.toString();
  return `${base}/print-templates/default${query ? `?${query}` : ''}`;
}

export function getLocalFallbackPrintTemplate(type = 'sale_invoice', paperSize = 'A4') {
  return withSource(normalizeTemplateRecord(getDefaultTemplate(type, paperSize), type, paperSize), 'fallback');
}

export function getCachedDefaultPrintTemplate(type = 'sale_invoice', paperSize = '') {
  return getCachedTemplate(type, paperSize);
}

export async function getDefaultPrintTemplate({
  apiBase = '',
  type = 'sale_invoice',
  paperSize = '',
  fallbackPaperSize = '',
  timeoutMs = 6000,
  allowCache = true,
} = {}) {
  const normalizedType = String(type || 'sale_invoice').trim() || 'sale_invoice';
  const normalizedPaperSize = String(paperSize || '').trim();
  const defaultFallbackSize = normalizedType === 'sale_invoice' ? 'A4' : '80mm';
  const fallbackSize = normalizedPaperSize || String(fallbackPaperSize || defaultFallbackSize).trim() || defaultFallbackSize;
  const url = buildDefaultTemplateUrl(apiBase, normalizedType, normalizedPaperSize);

  if (url) {
    try {
      const data = await fetchJsonWithTimeout(url, timeoutMs);
      const record = data?.template || data;
      const template = normalizeTemplateRecord(record, normalizedType, fallbackSize);
      if (normalizedPaperSize && String(template.paper_size || '') !== normalizedPaperSize) {
        throw new Error(`API returned ${template.paper_size || 'unknown'} instead of requested ${normalizedPaperSize}`);
      }
      cacheTemplate(template, normalizedType, normalizedPaperSize);
      return withSource(template, 'api');
    } catch (_) {
      // Tiếp tục dùng cache hoặc fallback local khi API lỗi/offline.
    }
  }

  if (allowCache) {
    const cached = getCachedTemplate(normalizedType, normalizedPaperSize);
    if (cached && (!normalizedPaperSize || String(cached.paper_size || '') === normalizedPaperSize)) return cached;
  }

  return getLocalFallbackPrintTemplate(normalizedType, fallbackSize);
}
