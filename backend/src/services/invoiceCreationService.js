const {
  getOne,
  insert,
  update,
  upsertDailyStats,
  today,
  now,
  getNextSeq,
  normalizePaymentMethod,
  getActiveAccountId,
} = require('../db/database');
const { resolveInvoiceDetailDisplayFields } = require('../utils/productDisplayName');

const SAPO_INVOICE_METADATA_FIELDS = [
  'sapo_order_id',
  'sapo_order_number',
  'sapo_customer_id',
  'sapo_status',
  'sapo_payment_status',
  'sapo_fulfillment_status',
  'sapo_updated_at',
  'sapo_last_synced_at',
  'sync_source',
];

function createHttpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(value, maxLength = 200) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeClientOrderId(value) {
  return normalizeText(value, 200);
}

function normalizePayloadHash(value) {
  return normalizeText(value, 128).toLowerCase();
}

function resolvePayloadHash(payload = {}, options = {}) {
  return normalizePayloadHash(options.payloadHash || payload.payload_hash || payload.payloadHash || '');
}

function buildIdempotencyKey(accountId, clientOrderId, payloadHash, payload = {}, options = {}) {
  const explicitKey = normalizeText(options.idempotencyKey || payload.idempotency_key || payload.idempotencyKey || '', 500);
  if (explicitKey) return explicitKey;
  if (!clientOrderId || !payloadHash) return '';
  return `${accountId || 'account'}:${clientOrderId}:${payloadHash}`;
}

function createIdempotencyConflict(existing, clientOrderId, payloadHash, existingHash) {
  const err = createHttpError('client_order_id đã tồn tại với payload_hash khác', 409);
  err.code = 'IDEMPOTENCY_CONFLICT';
  err.details = {
    invoice_id: existing?.id || null,
    invoice_code: existing?.invoice_code || '',
    client_order_id: clientOrderId,
    payload_hash: payloadHash || '',
    existing_payload_hash: existingHash || '',
  };
  return err;
}

function genInvoiceCode() {
  return `HD${String(getNextSeq('invoice_seq')).padStart(5, '0')}`;
}

function isComboDetail(detail = {}) {
  return detail.type === 'combo' || detail.item_type === 'combo' || !!detail.combo_id;
}

function buildDetailKey(detail = {}, index = 0) {
  if (isComboDetail(detail)) return `combo:${detail.combo_id || detail.id || index}:${detail.unit_price || 0}`;
  return `product:${detail.product_id || detail.id || index}:${detail.unit_price || 0}`;
}

function normalizeInvoiceDetail(detail = {}, invoice_id) {
  const comboLine = isComboDetail(detail);
  const product_id = comboLine ? null : (detail.product_id || detail.variant_id || null);
  const combo_id = comboLine ? (detail.combo_id || null) : null;
  const displayFields = resolveInvoiceDetailDisplayFields(detail, id => getOne('products', p => Number(p.id) === Number(id)));
  const product_name = displayFields.product_name;
  const product_sku = displayFields.product_sku;
  const quantity = +detail.quantity || 1;
  const unit_price = +detail.unit_price || 0;
  const discount_amount = +detail.discount_amount || 0;

  let import_price = 0;
  if (product_id) {
    const prod = getOne('products', p => p.id == product_id);
    if (prod) import_price = prod.import_price || 0;
  }

  return {
    invoice_id,
    type: comboLine ? 'combo' : (detail.type || detail.item_type || 'product'),
    item_type: comboLine ? 'combo' : (detail.item_type || detail.type || 'product'),
    combo_id,
    product_id,
    variant_id: comboLine ? null : (displayFields.variant_id || detail.variant_id || null),
    parent_id: comboLine ? null : (detail.parent_id || null),
    parent_name: comboLine ? '' : (detail.parent_name || ''),
    variant_name: comboLine ? '' : (detail.variant_name || ''),
    product_name,
    product_sku,
    name: displayFields.name || product_name,
    sku: displayFields.sku || product_sku,
    quantity,
    unit_price,
    import_price,
    discount_amount,
    discount_percent: +detail.discount_percent || 0,
    line_total: +detail.line_total || (quantity * unit_price - discount_amount),
    sapo_line_item_id: detail.sapo_line_item_id || '',
    sapo_order_id: detail.sapo_order_id || '',
    sapo_product_id: detail.sapo_product_id || '',
    sapo_variant_id: detail.sapo_variant_id || '',
    sapo_sku: detail.sapo_sku || detail.product_sku || detail.sku || '',
    sapo_barcode: detail.sapo_barcode || '',
    created_at: detail.created_at || now(),
  };
}

function mergeDuplicateDetails(details) {
  if (!Array.isArray(details)) return [];
  const map = new Map();
  for (const d of details) {
    const key = buildDetailKey(d, map.size);
    if (map.has(key)) {
      const existing = map.get(key);
      existing.quantity += d.quantity || 0;
      existing.line_total += d.line_total || 0;
      existing.discount_amount += d.discount_amount || 0;
    } else {
      map.set(key, { ...d });
    }
  }
  return Array.from(map.values());
}

function deductStock(productOrVariantId, quantity) {
  const variant = getOne('products', v => Number(v.id) === Number(productOrVariantId) && v.parent_id != null);
  if (variant) {
    update('products', variant.id, {
      stock: Math.max(0, (variant.stock || 0) - quantity),
    });
    return;
  }

  const product = getOne('products', p => Number(p.id) === Number(productOrVariantId) && !p.parent_id);
  if (product) {
    update('products', product.id, {
      stock: Math.max(0, (product.stock || 0) - quantity),
    });
  }
}

function restoreStock(productOrVariantId, quantity) {
  const variant = getOne('products', v => Number(v.id) === Number(productOrVariantId) && v.parent_id != null);
  if (variant) {
    update('products', variant.id, {
      stock: (variant.stock || 0) + quantity,
    });
    return;
  }

  const product = getOne('products', p => Number(p.id) === Number(productOrVariantId) && !p.parent_id);
  if (product) {
    update('products', product.id, {
      stock: (product.stock || 0) + quantity,
    });
  }
}

function findExistingInvoiceByClientOrderId(clientOrderId, accountId = getActiveAccountId()) {
  if (!clientOrderId) return null;
  return getOne('invoices', invoice =>
    normalizeClientOrderId(invoice.client_order_id) === clientOrderId &&
    (!accountId || Number(invoice.account_id) === Number(accountId))
  );
}

function buildExistingInvoiceResult(existing, clientOrderId, payloadHash = '', idempotencyKey = '') {
  return {
    ok: true,
    idempotent: true,
    created: false,
    invoice_id: existing.id,
    invoice_code: existing.invoice_code,
    client_order_id: clientOrderId,
    payload_hash: normalizePayloadHash(existing.payload_hash) || payloadHash || '',
    idempotency_key: existing.idempotency_key || idempotencyKey || '',
    invoice: existing,
  };
}

function collectSapoInvoiceMetadata(payload = {}) {
  return SAPO_INVOICE_METADATA_FIELDS.reduce((acc, field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) acc[field] = payload[field] || '';
    return acc;
  }, {});
}

function buildCreatorMetadata(payload = {}, req = null, options = {}) {
  const session = req?.session || {};
  const user = req?.user || {};
  const device = payload.device && typeof payload.device === 'object' ? payload.device : {};
  const headerUserAgent = req?.headers?.['user-agent'] || '';
  const reqIp = req?.ip || req?.connection?.remoteAddress || '';
  const orderSource = normalizeText(payload.order_source || options.orderSource || payload.source || '', 80)
    || (req?.path && String(req.path).includes('/sync') ? 'sync' : 'direct');

  return {
    created_by_user_id: user.id || payload.created_by_user_id || payload.user_id || null,
    created_by_session_id: session.id || payload.created_by_session_id || null,
    created_by_device_id: normalizeText(session.device_id || payload.created_by_device_id || payload.device_id || payload.client_device_id || device.device_id || '', 200),
    created_by_device_name: normalizeText(session.device_name || payload.created_by_device_name || payload.device_name || device.device_name || '', 200),
    created_by_platform: normalizeText(session.platform || payload.created_by_platform || payload.platform || device.platform || '', 100),
    created_by_app_version: normalizeText(session.app_version || payload.created_by_app_version || payload.app_version || device.app_version || '', 100),
    created_by_user_agent: normalizeText(session.user_agent || payload.created_by_user_agent || payload.user_agent || device.user_agent || headerUserAgent || '', 500),
    created_by_ip: normalizeText(session.ip || payload.created_by_ip || reqIp || '', 100),
    order_source: orderSource,
  };
}

function normalizeProvidedInvoiceCode(value) {
  const code = normalizeText(value, 120);
  if (!code) return '';
  if (/^(LOCAL_|OFFLINE_|SYNC-)/i.test(code)) return '';
  return code;
}

function resolveInvoiceCode(payload = {}, options = {}) {
  if (options.allowProvidedInvoiceCode) {
    const providedCode = normalizeProvidedInvoiceCode(payload.invoice_code);
    if (providedCode) return providedCode;
  }
  return genInvoiceCode();
}

function getDetailProductId(detail = {}) {
  if (isComboDetail(detail)) return null;
  return detail.product_id || detail.variant_id || null;
}

function validateStockForDetails(details = []) {
  const requiredByProductId = new Map();

  for (const detail of details) {
    const productId = getDetailProductId(detail);
    if (!productId) continue;
    const key = Number(productId);
    const quantity = Math.max(1, Number(detail.quantity) || 1);
    requiredByProductId.set(key, (requiredByProductId.get(key) || 0) + quantity);
  }

  for (const [productId, requiredQuantity] of requiredByProductId.entries()) {
    const prod = getOne('products', p => Number(p.id) === Number(productId));
    if (!prod) throw createHttpError(`Sản phẩm ID ${productId} không tồn tại`, 400);
    if ((Number(prod.stock) || 0) < requiredQuantity) {
      throw createHttpError(`Sản phẩm "${prod.name}" không đủ tồn kho! Còn: ${prod.stock || 0}, cần: ${requiredQuantity}`, 400);
    }
  }
}

function computeDetailLineTotal(detail = {}) {
  const quantity = +detail.quantity || 1;
  const unitPrice = +detail.unit_price || 0;
  const discountAmount = +detail.discount_amount || 0;
  const explicitLineTotal = Number(detail.line_total);
  return Number.isFinite(explicitLineTotal) ? explicitLineTotal : (quantity * unitPrice - discountAmount);
}

function buildInvoiceMoneyFields(payload = {}, details = []) {
  const computedSubtotal = details.reduce((sum, detail) => sum + computeDetailLineTotal(detail), 0);
  const subtotal = toNumber(payload.subtotal, computedSubtotal);
  const vat_percent = toNumber(payload.vat_percent, 0);
  const vat_amount = toNumber(payload.vat_amount, subtotal * vat_percent / 100);
  const discount_percent = toNumber(payload.discount_percent, 0);
  const discount_amount = toNumber(
    payload.discount_amount,
    discount_percent > 0 ? subtotal * discount_percent / 100 : 0,
  );
  const delivery_fee = toNumber(payload.delivery_fee, 0);
  const fallbackTotal = subtotal + vat_amount - discount_amount + delivery_fee;
  const total = toNumber(payload.total, fallbackTotal);
  const paid_amount = toNumber(payload.paid_amount, 0);
  const change_amount = toNumber(payload.change_amount, Math.max(0, paid_amount - total));
  const remaining_amount = toNumber(payload.remaining_amount, Math.max(0, total - paid_amount));

  return {
    subtotal,
    vat_percent,
    vat_amount,
    discount_amount,
    discount_percent,
    total,
    paid_amount,
    change_amount,
    remaining_amount,
    delivery_fee,
  };
}

function addCashBookIncome(invoice) {
  try {
    const existing = getOne('cash_book', c => c.reference_type === 'invoice' && Number(c.reference_id) === Number(invoice.id) && c.active !== 0);
    if (existing) return;

    const time = new Date().toISOString();
    insert('cash_book', {
      account_id: getActiveAccountId(),
      date: time.slice(0, 10),
      time: time.slice(11, 19),
      type: 'income',
      category: 'Doanh thu từ đơn hàng',
      amount: invoice.total || 0,
      note: `Hóa đơn ${invoice.invoice_code}`,
      reference_id: invoice.id,
      reference_type: 'invoice',
      active: true,
      created_at: time,
      updated_at: time,
    });
  } catch (err) {
    console.error('Lỗi tạo giao dịch sổ quỹ:', err.message);
  }
}

function createInvoiceFromPayload(payload = {}, req = null, options = {}) {
  if (!payload || typeof payload !== 'object') throw createHttpError('Payload tạo đơn không hợp lệ', 400);
  const details = Array.isArray(payload.details) ? payload.details : [];
  if (details.length === 0) throw createHttpError('Đơn hàng chưa có sản phẩm', 400);

  const accountId = req?.accountId || req?.account?.id || payload.account_id || getActiveAccountId();
  const client_order_id = normalizeClientOrderId(payload.client_order_id || payload.clientOrderId || payload.order_uuid || payload.local_order_id || '');
  const payload_hash = resolvePayloadHash(payload, options);
  if (options.requirePayloadHash && !payload_hash) {
    throw createHttpError('Thiếu payload_hash cho yêu cầu idempotency mobile', 400);
  }
  const idempotency_key = buildIdempotencyKey(accountId, client_order_id, payload_hash, payload, options);

  const existing = findExistingInvoiceByClientOrderId(client_order_id, accountId);
  if (existing) {
    const existingHash = normalizePayloadHash(existing.payload_hash);
    if (payload_hash && existingHash && payload_hash !== existingHash) {
      throw createIdempotencyConflict(existing, client_order_id, payload_hash, existingHash);
    }
    return buildExistingInvoiceResult(existing, client_order_id, payload_hash, idempotency_key);
  }

  validateStockForDetails(details);

  const money = buildInvoiceMoneyFields(payload, details);
  const invoice_code = resolveInvoiceCode(payload, options);
  const creatorMetadata = buildCreatorMetadata(payload, req, options);
  const sapoInvoiceMetadata = collectSapoInvoiceMetadata(payload);
  const status = payload.status || options.defaultStatus || 'pending';
  const invoiceCreatedAt = payload.created_at || now();

  const invoice_id = insert('invoices', {
    account_id: accountId,
    invoice_code,
    client_order_id,
    payload_hash,
    mobile_sync_status: payload.mobile_sync_status || (payload_hash ? 'applied' : ''),
    mobile_synced_at: payload.mobile_synced_at || (payload_hash ? now() : null),
    mobile_device_id: payload.mobile_device_id || null,
    store_info_snapshot: payload.store_info_snapshot || null,
    idempotency_key,
    client_created_at: payload.client_created_at || null,
    customer_id: payload.customer_id || null,
    user_id: payload.user_id || req?.user?.id || null,
    ...money,
    payment_method: normalizePaymentMethod(payload.payment_method),
    note: payload.note || '',
    invoice_writer: payload.invoice_writer || req?.user?.name || '',
    receiver_name: payload.receiver_name || '',
    delivery_date: payload.delivery_date || null,
    status,
    ...creatorMetadata,
    source: normalizeText(payload.source || creatorMetadata.order_source || '', 80),
    ...sapoInvoiceMetadata,
    created_at: invoiceCreatedAt,
  });

  for (const detail of details) {
    const detailRow = normalizeInvoiceDetail(detail, invoice_id);
    insert('invoice_details', detailRow);
    const productId = getDetailProductId(detail);
    if (productId) deductStock(productId, +detail.quantity || 1);
  }

  upsertDailyStats(today(), money.total);
  if (status === 'completed') addCashBookIncome({ id: invoice_id, invoice_code, total: money.total });

  const invoice = getOne('invoices', invoiceRow => Number(invoiceRow.id) === Number(invoice_id));
  return {
    ok: true,
    idempotent: false,
    created: true,
    invoice_id,
    invoice_code,
    client_order_id,
    payload_hash,
    idempotency_key,
    invoice,
  };
}

module.exports = {
  addCashBookIncome,
  createInvoiceFromPayload,
  deductStock,
  restoreStock,
  isComboDetail,
  normalizeInvoiceDetail,
  mergeDuplicateDetails,
  normalizeClientOrderId,
  normalizePayloadHash,
};
