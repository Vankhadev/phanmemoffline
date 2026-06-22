// Per-customer remembered prices. Stored locally so suggestions survive reload
// without requiring a backend round-trip. Suggestions ONLY surface the price the
// same customer paid last time for the exact same priceType (retail/wholesale/
// vip/consignment), so they cannot leak a retail price into a wholesale order.

const STORAGE_KEY = 'kha_customer_price_memory_v1';
const MAX_CUSTOMERS = 400;
const MAX_PRODUCTS_PER_CUSTOMER = 400;

function safeStorage() {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage || null;
  } catch (_) {
    return null;
  }
}

function readAll() {
  const storage = safeStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeAll(data) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) {
    // Storage quota or private mode: ignore silently.
  }
}

export function getCustomerKey(customer) {
  if (!customer) return '__walk_in__';
  const id = customer.id ?? customer.customer_id ?? customer.customerId;
  if (id !== undefined && id !== null && String(id).trim() !== '') return `id:${String(id).trim()}`;
  const phone = String(customer.phone || '').trim();
  if (phone) return `phone:${phone}`;
  const email = String(customer.email || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  return '__walk_in__';
}

export function getProductKey(line = {}) {
  if (!line || typeof line !== 'object') return '';
  if (line.combo_id) return `combo:${line.combo_id}`;
  const variantId = line.variant_id || line.variantId;
  if (variantId) return `variant:${variantId}`;
  const productId = line.product_id || line.productId;
  if (productId) return `product:${productId}`;
  const sku = String(line.product_sku || line.sku || '').trim();
  if (sku) return `sku:${sku.toLowerCase()}`;
  // Free service line: no stable key.
  return '';
}

export function normalizePriceTypeKey(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'wholesale' || key === 'vip' || key === 'consignment') return key;
  return 'retail';
}

function pruneCustomer(map) {
  const entries = Object.entries(map);
  if (entries.length <= MAX_PRODUCTS_PER_CUSTOMER) return map;
  entries.sort((a, b) => (Number(b[1]?.ts) || 0) - (Number(a[1]?.ts) || 0));
  return Object.fromEntries(entries.slice(0, MAX_PRODUCTS_PER_CUSTOMER));
}

function pruneAll(data) {
  const customers = Object.entries(data);
  if (customers.length <= MAX_CUSTOMERS) return data;
  customers.sort((a, b) => {
    const aLatest = Math.max(0, ...Object.values(a[1] || {}).map(entry => Number(entry?.ts) || 0));
    const bLatest = Math.max(0, ...Object.values(b[1] || {}).map(entry => Number(entry?.ts) || 0));
    return bLatest - aLatest;
  });
  return Object.fromEntries(customers.slice(0, MAX_CUSTOMERS));
}

/**
 * Record one line. Stores under (customerKey, priceType:productKey) so a single
 * customer can have separate memories per priceType – which is mostly defensive
 * because a customer usually keeps the same priceType, but it guarantees no
 * accidental crossover when an operator temporarily switches modes.
 */
export function recordLinePrice(customerKey, line, priceType) {
  if (!customerKey || !line) return;
  const productKey = getProductKey(line);
  if (!productKey) return;
  const unitPrice = Number(line.unit_price ?? line.unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return;
  const type = normalizePriceTypeKey(priceType);

  const data = readAll();
  const customerMap = data[customerKey] && typeof data[customerKey] === 'object' ? { ...data[customerKey] } : {};
  customerMap[`${type}:${productKey}`] = {
    unit_price: unitPrice,
    priceType: type,
    productKey,
    name: line.product_name || line.name || '',
    ts: Date.now(),
  };
  data[customerKey] = pruneCustomer(customerMap);
  writeAll(pruneAll(data));
}

export function recordCartPrices(customer, cart = [], priceType) {
  if (!Array.isArray(cart) || cart.length === 0) return;
  const customerKey = getCustomerKey(customer);
  cart.forEach(line => recordLinePrice(customerKey, line, priceType));
}

export function lookupRememberedPrice(customer, line, priceType) {
  const customerKey = getCustomerKey(customer);
  if (!customerKey) return null;
  const productKey = getProductKey(line);
  if (!productKey) return null;
  const type = normalizePriceTypeKey(priceType);
  const data = readAll();
  const customerMap = data[customerKey];
  if (!customerMap || typeof customerMap !== 'object') return null;
  const entry = customerMap[`${type}:${productKey}`];
  if (!entry || typeof entry !== 'object') return null;
  const unitPrice = Number(entry.unit_price);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;
  return {
    unitPrice,
    priceType: type,
    productKey,
    name: entry.name || '',
    ts: Number(entry.ts) || 0,
  };
}

export function clearCustomerMemory(customerKey) {
  if (!customerKey) return;
  const data = readAll();
  if (!data[customerKey]) return;
  delete data[customerKey];
  writeAll(data);
}

export const __TEST__ = { STORAGE_KEY };