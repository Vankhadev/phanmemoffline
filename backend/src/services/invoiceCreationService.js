const {
  getOne,
  getAll,
  insert,
  update,
  rebuildDailyStatsForDates,
  now,
  generateNextDocumentCode,
  normalizePaymentMethod,
  getActiveAccountId,
  normalizeDateKey,
  isCompletedInvoiceStatus,
  isCancelledInvoiceStatus,
  withAtomicDbWrite,
} = require('../db/database');
const { resolveInvoiceDetailDisplayFields } = require('../utils/productDisplayName');
const {
  getInvoiceDetailProductId,
  validateNegativeStockForDetails,
  applyProductStockDeltaLocked,
  logNegativeStockLimitViolation,
} = require('../utils/negativeStock');
const accountingService = require('./accountingService');
const { logActivity } = require('./accountingLogService');

function createHttpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.statusCode = status;
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

function genInvoiceCode(options = {}) {
  return generateNextDocumentCode('invoice', options);
}

function isComboDetail(detail = {}) {
  return detail.type === 'combo' || detail.item_type === 'combo' || !!detail.combo_id;
}

function isServiceDetail(detail = {}) {
  return detail.type === 'service'
    || detail.item_type === 'service'
    || detail.type === 'custom_service'
    || detail.item_type === 'custom_service'
    || detail.is_service
    || detail.isService;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function normalizeSkuKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getDetailSku(detail = {}) {
  return firstNonEmpty(detail.product_sku, detail.sku, detail.variant_sku, detail.productSku);
}

function getActiveProductById(productId) {
  const id = Number(productId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return getOne('products', product => Number(product.id) === id && product.active !== 0);
}

function getActiveProductBySku(sku) {
  const skuKey = normalizeSkuKey(sku);
  if (!skuKey) return null;
  return getOne('products', product => product.active !== 0 && normalizeSkuKey(product.sku) === skuKey);
}

function createProductNotFoundError(detail = {}, index = 0) {
  const sku = getDetailSku(detail);
  const productId = detail.variant_id || detail.product_id || null;
  const line = index + 1;
  const message = sku
    ? `SKU không tồn tại trong hệ thống: ${sku}`
    : `Sản phẩm ở dòng ${line} không tồn tại trong hệ thống`;
  const err = createHttpError(message, 400);
  err.code = 'PRODUCT_SKU_NOT_FOUND';
  err.details = {
    line,
    sku,
    product_id: detail.product_id || null,
    variant_id: detail.variant_id || null,
    requested_product_id: productId,
    product_name: detail.product_name || detail.name || '',
  };
  return err;
}

function resolveInvoiceSaleDetailProduct(detail = {}, index = 0) {
  if (isComboDetail(detail) || isServiceDetail(detail)) return { ...(detail || {}) };

  const sku = getDetailSku(detail);
  const requestedProductId = detail.variant_id || detail.product_id || null;
  const productBySku = getActiveProductBySku(sku);
  const productById = getActiveProductById(requestedProductId);
  if (sku && !productBySku) throw createProductNotFoundError(detail, index);
  const product = productBySku || productById;
  if (!product) throw createProductNotFoundError(detail, index);

  const parent = product.parent_id ? getActiveProductById(product.parent_id) : null;
  const isVariant = Boolean(product.parent_id);
  const productName = firstNonEmpty(detail.product_name, detail.name, product.name, sku, 'Sản phẩm');

  return {
    ...(detail || {}),
    product_id: product.id,
    variant_id: isVariant ? product.id : null,
    parent_id: isVariant ? (product.parent_id || null) : null,
    parent_name: isVariant ? firstNonEmpty(detail.parent_name, parent && parent.name) : '',
    variant_name: isVariant ? firstNonEmpty(detail.variant_name, product.name) : '',
    product_name: productName,
    name: firstNonEmpty(detail.name, productName),
    product_sku: product.sku || sku,
    sku: product.sku || sku,
  };
}

function buildDetailKey(detail = {}, index = 0) {
  if (isComboDetail(detail)) return `combo:${detail.combo_id || detail.id || index}:${detail.unit_price || 0}`;
  return `product:${detail.product_id || detail.variant_id || detail.id || index}:${detail.unit_price || 0}`;
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

function prepareInvoiceDetailsForPersistence(details = []) {
  if (!Array.isArray(details)) return [];
  return mergeDuplicateDetails(details.map((detail, index) => resolveInvoiceSaleDetailProduct(detail, index)));
}

function deductStock(productOrVariantId, quantity, options = {}) {
  const writeOptions = options.skipSave === true ? { skipSave: true } : {};
  const normalizedQuantity = Math.max(0, Number(quantity) || 0);
  if (normalizedQuantity <= 0) return null;

  const variant = getOne('products', v => Number(v.id) === Number(productOrVariantId) && v.parent_id != null);
  if (variant) {
    return applyProductStockDeltaLocked({
      productId: variant.id,
      detail: { product_name: variant.name, product_sku: variant.sku },
      delta: -normalizedQuantity,
      quantity: normalizedQuantity,
      operation: 'xuất kho hóa đơn',
      options: writeOptions,
      source: options.source || 'invoice',
    }).updated;
  }

  const product = getOne('products', p => Number(p.id) === Number(productOrVariantId) && !p.parent_id);
  if (product) {
    return applyProductStockDeltaLocked({
      productId: product.id,
      detail: { product_name: product.name, product_sku: product.sku },
      delta: -normalizedQuantity,
      quantity: normalizedQuantity,
      operation: 'xuất kho hóa đơn',
      options: writeOptions,
      source: options.source || 'invoice',
    }).updated;
  }
  return null;
}

function restoreStock(productOrVariantId, quantity, options = {}) {
  const writeOptions = options.skipSave === true ? { skipSave: true } : {};
  const variant = getOne('products', v => Number(v.id) === Number(productOrVariantId) && v.parent_id != null);
  if (variant) {
    update('products', variant.id, {
      stock: (variant.stock || 0) + quantity,
    }, writeOptions);
    return;
  }

  const product = getOne('products', p => Number(p.id) === Number(productOrVariantId) && !p.parent_id);
  if (product) {
    update('products', product.id, {
      stock: (product.stock || 0) + quantity,
    }, writeOptions);
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

function resolveInvoiceCode(payload = {}, options = {}) {
  return genInvoiceCode(options);
}

function getDetailProductId(detail = {}) {
  return getInvoiceDetailProductId(detail);
}

function validateStockForDetails(details = [], options = {}) {
  try {
    return validateNegativeStockForDetails(details, options);
  } catch (error) {
    logNegativeStockLimitViolation(error, { source: options.source || 'invoice_service', operation: 'validate_invoice_details' }, { skipSave: true });
    if (error?.status) throw error;
    throw createHttpError(error?.message || 'Không thể kiểm tra tồn kho trước khi xuất hàng', 400);
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

function resolveEventTimestamp(value, fallback = now()) {
  const parsed = new Date(value || fallback);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function addCashBookIncome(invoice, options = {}) {
  try {
    const skipSave = options.skipSave === true;
    const accountId = invoice?.account_id || getActiveAccountId();
    const time = resolveEventTimestamp(options.timestamp || invoice?.created_at, now());
    const date = normalizeDateKey(invoice?.created_at || time) || time.slice(0, 10);
    const existing = getOne('cash_book', c => c.reference_type === 'invoice' && Number(c.reference_id) === Number(invoice.id) && c.active !== 0);

    const payload = {
      account_id: accountId,
      date,
      time: time.slice(11, 19),
      type: 'income',
      category: 'Doanh thu từ đơn hàng',
      amount: Number(invoice?.total) || 0,
      payment_method: normalizePaymentMethod(invoice?.payment_method),
      note: `Hóa đơn ${invoice?.invoice_code || invoice?.id || ''}`.trim(),
      reference_id: invoice.id,
      reference_type: 'invoice',
      active: true,
      updated_at: time,
    };

    if (existing) {
      return update('cash_book', existing.id, payload, { skipSave });
    }

    const id = insert('cash_book', {
      ...payload,
      created_at: time,
    }, { skipSave, accountId });
    return getOne('cash_book', cb => Number(cb.id) === Number(id));
  } catch (err) {
    console.error('Lỗi tạo/cập nhật giao dịch sổ quỹ:', err.message);
    if (options.rethrowOnError === true) throw err;
    return null;
  }
}

function voidCashBookIncome(invoiceId, options = {}) {
  try {
    const skipSave = options.skipSave === true;
    const time = resolveEventTimestamp(options.timestamp, now());
    const existing = getOne('cash_book', c => c.reference_type === 'invoice' && Number(c.reference_id) === Number(invoiceId) && c.active !== 0);
    if (!existing) return null;
    return update('cash_book', existing.id, {
      active: 0,
      voided_at: time,
      void_reason: options.reason || 'invoice_not_completed',
      updated_at: time,
    }, { skipSave });
  } catch (err) {
    console.error('Lỗi vô hiệu giao dịch sổ quỹ:', err.message);
    if (options.rethrowOnError === true) throw err;
    return null;
  }
}

function syncInvoiceAccounting(invoice, options = {}) {
  if (!invoice || invoice.id == null) return null;
  const skipSave = options.skipSave === true;
  const affectedDates = Array.from(new Set([
    options.previousCreatedAt,
    invoice.created_at,
  ].map(value => normalizeDateKey(value)).filter(Boolean)));
  const details = getAll('invoice_details', detail => Number(detail.invoice_id) === Number(invoice.id));

  if (isCompletedInvoiceStatus(invoice.status)) {
    addCashBookIncome(invoice, { ...options, rethrowOnError: true });
    accountingService.postInvoiceCompleted(invoice, details, {
      ...options,
      timestamp: options.timestamp || invoice.updated_at || invoice.created_at,
      userId: options.userId || invoice.user_id || null,
    });
  } else {
    voidCashBookIncome(invoice.id, {
      skipSave,
      timestamp: options.timestamp,
      reason: options.voidReason || 'invoice_not_completed',
      rethrowOnError: true,
    });
    if (isCancelledInvoiceStatus(invoice.status)) {
      accountingService.reverseInvoice(invoice, options.voidReason || 'invoice_cancelled', {
        ...options,
        timestamp: options.timestamp || invoice.cancelled_at || invoice.updated_at,
        userId: options.userId || invoice.user_id || null,
      });
    }
  }

  if (affectedDates.length > 0) {
    rebuildDailyStatsForDates(affectedDates, { skipSave });
  }

  return invoice;
}

function createInvoiceFromPayload(payload = {}, req = null, options = {}) {
  if (!payload || typeof payload !== 'object') throw createHttpError('Payload tạo đơn không hợp lệ', 400);
  const details = Array.isArray(payload.details) ? payload.details : [];
  if (details.length === 0) throw createHttpError('Đơn hàng chưa có sản phẩm', 400);

  const safeDetails = prepareInvoiceDetailsForPersistence(details);
  if (safeDetails.length === 0) throw createHttpError('Đơn hàng chưa có sản phẩm', 400);

  const accountId = req?.accountId || req?.account?.id || payload.account_id || getActiveAccountId();
  const client_order_id = normalizeClientOrderId(payload.client_order_id || payload.clientOrderId || payload.order_uuid || payload.local_order_id || '');
  const payload_hash = resolvePayloadHash(payload, options);
  if (options.requirePayloadHash && !payload_hash) {
    throw createHttpError('Thiếu payload_hash cho yêu cầu idempotency đồng bộ', 400);
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

  const money = buildInvoiceMoneyFields(payload, safeDetails);
  const creatorMetadata = buildCreatorMetadata(payload, req, options);
  const status = payload.status || options.defaultStatus || 'pending';
  const invoiceCreatedAt = payload.created_at || now();

  const runCreation = () => {
    // Validate tồn kho ngay trong transaction cập nhật tồn để tránh dùng snapshot tồn kho cũ.
    // Mỗi lần trừ tồn bên dưới tiếp tục kiểm tra lại bằng row-lock in-process trong applyProductStockDeltaLocked.
    validateStockForDetails(safeDetails, { source: options.orderSource || 'invoice_service' });
    const invoice_code = resolveInvoiceCode(payload, { ...options, skipSave: true });
    const sync_status = payload.sync_status || (payload_hash ? 'applied' : '');
    const synced_at = payload.synced_at || (payload_hash ? now() : null);
    const sync_device_id = payload.sync_device_id || null;
    const invoice_id = insert('invoices', {
      account_id: accountId,
      invoice_code,
      client_order_id,
      payload_hash,
      sync_status,
      synced_at,
      sync_device_id,
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
      stock_effect_status: 'deducted_on_create',
      stock_effect_source: 'legacy_create_invoice_flow',
      accounting_status: isCompletedInvoiceStatus(status) ? 'pending' : 'not_posted',
      posted_at: null,
      reversed_at: null,
      ...creatorMetadata,
      source: normalizeText(payload.source || creatorMetadata.order_source || '', 80),
      created_at: invoiceCreatedAt,
    }, { skipSave: true, accountId });

    for (const detail of safeDetails) {
      const detailRow = normalizeInvoiceDetail(detail, invoice_id);
      insert('invoice_details', detailRow, { skipSave: true, accountId });
      const productId = getDetailProductId(detailRow);
      if (productId) deductStock(productId, +detailRow.quantity || 1, { skipSave: true, source: creatorMetadata.order_source || 'invoice' });
    }

    const invoice = getOne('invoices', invoiceRow => Number(invoiceRow.id) === Number(invoice_id));
    syncInvoiceAccounting(invoice, { skipSave: true, timestamp: invoiceCreatedAt, userId: req?.user?.id || invoice?.user_id || null });
    logActivity(req, 'invoice.create', {
      type: 'invoice',
      id: invoice_id,
      code: invoice_code,
    }, null, invoice, `Tạo đơn hàng ${invoice_code}`, { skipSave: true, accountId });

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
  };

  return options.skipAtomic === true ? runCreation() : withAtomicDbWrite(runCreation);
}

module.exports = {
  addCashBookIncome,
  voidCashBookIncome,
  syncInvoiceAccounting,
  createInvoiceFromPayload,
  deductStock,
  restoreStock,
  isComboDetail,
  isServiceDetail,
  normalizeInvoiceDetail,
  mergeDuplicateDetails,
  prepareInvoiceDetailsForPersistence,
  normalizeClientOrderId,
  normalizePayloadHash,
};
