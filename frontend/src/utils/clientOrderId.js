const CLIENT_DEVICE_ID_KEY = 'kha_client_device_id';

function safeRandomPart(length = 10) {
  try {
    const bytes = new Uint8Array(Math.ceil(length / 2));
    window.crypto?.getRandomValues(bytes);
    const value = Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, length);
    if (value) return value.toUpperCase();
  } catch (_) {
    // Fallback bên dưới cho môi trường không có crypto.
  }
  return Math.random().toString(36).slice(2, 2 + length).toUpperCase();
}

function safeStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (_) {
    return null;
  }
}

function readEnvVersion() {
  try {
    return import.meta?.env?.VITE_APP_VERSION || import.meta?.env?.VITE_VERSION || '';
  } catch (_) {
    return '';
  }
}

export function getClientDeviceId() {
  const storage = safeStorage();
  const existing = storage?.getItem(CLIENT_DEVICE_ID_KEY);
  if (existing) return existing;

  const id = `DEV-${Date.now().toString(36).toUpperCase()}-${safeRandomPart(8)}`;
  try {
    storage?.setItem(CLIENT_DEVICE_ID_KEY, id);
  } catch (_) {
    // Bỏ qua lỗi quota/security; vẫn trả id cho request hiện tại.
  }
  return id;
}

export function getClientDeviceMetadata() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const platform = nav.userAgentData?.platform || nav.platform || '';
  const deviceName = platform || 'Browser';

  return {
    device_id: getClientDeviceId(),
    device_name: deviceName,
    platform,
    app_version: readEnvVersion(),
    user_agent: nav.userAgent || '',
  };
}

export function generateClientOrderId() {
  const devicePart = getClientDeviceId().replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase() || 'DEVICE';
  const timePart = Date.now().toString(36).toUpperCase();
  return `KHA-${timePart}-${devicePart}-${safeRandomPart(8)}`;
}

export function getExistingClientOrderId(order = {}) {
  return String(
    order.client_order_id ||
    order.clientOrderId ||
    order.order_uuid ||
    order.local_order_id ||
    order.payload?.client_order_id ||
    order.payload?.clientOrderId ||
    ''
  ).trim();
}

export function ensureClientOrderId(order = {}) {
  const existing = getExistingClientOrderId(order);
  if (existing) return existing;

  const stableLegacyKey = String(order.invoice_code || order.payload?.invoice_code || order.id || '').trim();
  if (stableLegacyKey) {
    const normalized = stableLegacyKey.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80).toUpperCase();
    if (normalized) return `KHA-LEGACY-${normalized}`;
  }

  return generateClientOrderId();
}

export function attachClientOrderMetadata(payload = {}, source = null) {
  const client_order_id = ensureClientOrderId(source || payload);
  return {
    ...payload,
    ...getClientDeviceMetadata(),
    client_order_id,
  };
}
