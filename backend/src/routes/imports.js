/**
 * Imports API routes
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, remove, now, withAtomicDbWrite, generateNextDocumentCode } = require('../db/database');
const accountingService = require('../services/accountingService');
const { logActivity, logDataDeletion } = require('../services/accountingLogService');

function genImportCode() {
  return generateNextDocumentCode('import', { skipSave: true });
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function createRouteError(message, status = 400, code = '') {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  if (code) error.code = code;
  return error;
}

function normalizeImportCode(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeImportCodeKey(value) {
  return normalizeImportCode(value).toLowerCase();
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toMoney(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

function toPercent(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, n));
}

function sendImportError(res, err, fallback = 'Lỗi xử lý phiếu nhập') {
  if (err.code === 'DOCUMENT_CODE_DUPLICATE') {
    return res.status(409).json({
      error: 'Mã phiếu nhập đã tồn tại',
      detail: err.message || 'Mã phiếu nhập đã tồn tại, vui lòng nhập mã khác.',
      code: 'IMPORT_CODE_DUPLICATE',
    });
  }
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: fallback,
    detail: err.message || fallback,
    code: err.code || 'IMPORT_ROUTE_ERROR',
    ...(err.details ? { details: err.details } : {}),
  });
}

function normalizeImportStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (['draft', 'pending', 'created', 'cho_nhap', 'temporary'].includes(value)) return 'draft';
  if (['received', 'imported', 'done', 'completed', 'da_nhap'].includes(value)) return 'received';
  if (['cancelled', 'canceled', 'da_huy'].includes(value)) return 'cancelled';
  return 'received';
}

function normalizePaymentStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (['paid', 'da_thanh_toan', 'đã thanh toán', 'da thanh toan'].includes(value)) return 'paid';
  return 'unpaid';
}

function paymentAmounts(total, paymentStatus, paidAmount) {
  const normalizedTotal = Math.max(0, toNumber(total, 0));
  const normalizedStatus = normalizePaymentStatus(paymentStatus);
  const defaultPaid = normalizedStatus === 'paid' ? normalizedTotal : 0;
  const paid = Math.min(normalizedTotal, Math.max(0, toNumber(paidAmount, defaultPaid)));
  return {
    payment_status: normalizedStatus,
    paid_amount: normalizedStatus === 'paid' ? normalizedTotal : paid,
    remaining_amount: normalizedStatus === 'paid' ? 0 : Math.max(0, normalizedTotal - paid),
  };
}

function unpaidPaymentAmounts(total) {
  return paymentAmounts(total, 'unpaid', 0);
}

function detailPayload(importId, detail = {}) {
  const rawQuantity = Number(detail.quantity);
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) {
    throw createRouteError('Số lượng nhập phải lớn hơn 0', 400, 'IMPORT_DETAIL_INVALID_QUANTITY');
  }

  const quantity = rawQuantity;
  const importPrice = toMoney(detail.import_price, 0);
  const grossAmount = quantity * importPrice;
  const discountPercent = toPercent(detail.discount_percent ?? detail.discount ?? detail.chietKhau, 0);
  const explicitDiscountAmount = detail.discount_amount !== undefined ? toMoney(detail.discount_amount, 0) : null;
  const discountAmount = Math.min(grossAmount, explicitDiscountAmount !== null ? explicitDiscountAmount : (grossAmount * discountPercent / 100));
  const taxableAmount = Math.max(0, grossAmount - discountAmount);
  const taxPercent = toPercent(detail.tax_percent ?? detail.vat_percent ?? detail.thueGTGT, 0);
  const explicitTaxAmount = detail.tax_amount !== undefined || detail.vat_amount !== undefined
    ? toMoney(detail.tax_amount ?? detail.vat_amount, 0)
    : null;
  const taxAmount = explicitTaxAmount !== null ? explicitTaxAmount : taxableAmount * taxPercent / 100;
  const lineTotal = detail.line_total !== undefined
    ? toMoney(detail.line_total, 0)
    : taxableAmount + taxAmount;

  return {
    import_id: importId,
    product_id: toOptionalNumber(detail.product_id),
    variant_id: toOptionalNumber(detail.variant_id),
    product_name: detail.product_name || '',
    sku: detail.sku || '',
    quantity,
    import_price: importPrice,
    retail_price: toMoney(detail.retail_price, 0),
    wholesale_price: toMoney(detail.wholesale_price, 0),
    discount_percent: discountPercent,
    discount_amount: discountAmount,
    tax_percent: taxPercent,
    tax_amount: taxAmount,
    vat_percent: taxPercent,
    vat_amount: taxAmount,
    line_subtotal: grossAmount,
    taxable_amount: taxableAmount,
    line_total: lineTotal,
  };
}

function getStockProductId(detail) {
  return toOptionalNumber(detail.variant_id) || toOptionalNumber(detail.product_id);
}

function detailComparable(detail) {
  return {
    product_id: toOptionalNumber(detail.product_id),
    variant_id: toOptionalNumber(detail.variant_id),
    product_name: detail.product_name || '',
    sku: detail.sku || '',
    quantity: Math.max(0, toNumber(detail.quantity, 0)),
    import_price: toMoney(detail.import_price, 0),
    retail_price: toMoney(detail.retail_price, 0),
    wholesale_price: toMoney(detail.wholesale_price, 0),
    discount_percent: toPercent(detail.discount_percent, 0),
    discount_amount: toMoney(detail.discount_amount, 0),
    tax_percent: toPercent(detail.tax_percent ?? detail.vat_percent, 0),
    tax_amount: toMoney(detail.tax_amount ?? detail.vat_amount, 0),
    line_subtotal: toMoney(detail.line_subtotal, 0),
    taxable_amount: toMoney(detail.taxable_amount, 0),
    line_total: toMoney(detail.line_total, 0),
  };
}

function detailsEqual(oldDetails, newDetails) {
  const oldComparable = (oldDetails || []).map(detailComparable);
  const newComparable = (newDetails || []).map(detailComparable);
  return JSON.stringify(oldComparable) === JSON.stringify(newComparable);
}

function getImportStockDetailLabel(detail = {}, product = {}) {
  return detail.product_name || product.name || detail.sku || `ID ${product.id || detail.product_id || detail.variant_id || ''}`;
}

function validateImportStockDelta({ productId, detail = {}, delta = 0, operation = 'cập nhật tồn kho phiếu nhập' }) {
  const numericProductId = toOptionalNumber(productId);
  const product = numericProductId ? getOne('products', p => Number(p.id) === Number(numericProductId)) : null;
  if (!product) throw createRouteError(`Sản phẩm ID ${productId || ''} không tồn tại`, 400, 'IMPORT_PRODUCT_NOT_FOUND');

  const normalizedDelta = toNumber(delta, 0);
  const currentStock = toNumber(product.stock, 0);
  const projectedStock = currentStock + normalizedDelta;
  if (!Number.isFinite(projectedStock) || projectedStock < 0) {
    const label = getImportStockDetailLabel(detail, product);
    const error = createRouteError(`Tồn kho không đủ để ${operation} cho "${label}". Tồn hiện tại: ${currentStock}, thay đổi: ${normalizedDelta}, tồn dự kiến: ${projectedStock}.`, 400, 'IMPORT_STOCK_UNDERFLOW');
    error.details = { product_id: product.id, product_name: label, current_stock: currentStock, change_quantity: normalizedDelta, projected_stock: projectedStock, operation };
    throw error;
  }

  return { product, currentStock, projectedStock, delta: normalizedDelta };
}

function applyImportStockDelta({ productId, detail = {}, delta = 0, operation = 'cập nhật tồn kho phiếu nhập', changes = {} }) {
  const validation = validateImportStockDelta({ productId, detail, delta, operation });
  const updated = update('products', validation.product.id, { ...(changes || {}), stock: validation.projectedStock });
  return { updated, validation };
}

function aggregateStockQuantities(details) {
  const map = new Map();
  for (const detail of details || []) {
    const stockProductId = getStockProductId(detail);
    if (!stockProductId) continue;
    const quantity = Math.max(0, toNumber(detail.quantity, 0));
    if (quantity <= 0) continue;
    map.set(stockProductId, toNumber(map.get(stockProductId), 0) + quantity);
  }
  return map;
}

function replaceImportDetails(importId, details) {
  const oldDetails = getAll('import_details', d => d.import_id === importId);
  for (const oldDetail of oldDetails) {
    remove('import_details', oldDetail.id);
  }

  const savedDetails = [];
  for (const detail of (Array.isArray(details) ? details : [])) {
    const payload = detailPayload(importId, detail);
    insert('import_details', payload);
    savedDetails.push(payload);
  }
  return savedDetails;
}

function buildApplyStockOperations(details, operation = 'áp dụng phiếu nhập') {
  const grouped = new Map();
  for (const d of details || []) {
    const stockProductId = getStockProductId(d);
    if (!stockProductId) continue;
    const product = getOne('products', p => Number(p.id) === Number(stockProductId));
    if (!product) continue;

    const quantity = Math.max(0, toNumber(d.quantity, 0));
    if (quantity <= 0) continue;

    const key = Number(product.id);
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += quantity;
      existing.detail = d;
    } else {
      grouped.set(key, { product, detail: d, quantity });
    }
  }

  return Array.from(grouped.values()).map(item => ({
    ...item,
    validation: validateImportStockDelta({
      productId: item.product.id,
      detail: { product_name: item.detail.product_name || item.product.name, product_sku: item.detail.sku || item.product.sku },
      delta: item.quantity,
      operation,
    }),
  }));
}

function applyStockForImport(importLog, details) {
  if (!importLog || importLog.stock_applied === true || importLog.stock_rolled_back === true) {
    return { applied: false, items: [] };
  }

  const operations = buildApplyStockOperations(details, 'áp dụng phiếu nhập');
  const appliedItems = [];
  for (const operation of operations) {
    const d = operation.detail;
    const changes = { updated_at: now() };
    if (d.import_price) changes.import_price = Math.max(0, toNumber(d.import_price, 0));
    if (d.wholesale_price) changes.wholesale_price = Math.max(0, toNumber(d.wholesale_price, 0));
    if (d.retail_price) changes.retail_price = Math.max(0, toNumber(d.retail_price, 0));
    const { validation } = applyImportStockDelta({
      productId: operation.product.id,
      detail: { product_name: d.product_name || operation.product.name, product_sku: d.sku || operation.product.sku },
      delta: operation.quantity,
      operation: 'áp dụng phiếu nhập',
      changes,
    });
    appliedItems.push({ product_id: operation.product.id, quantity: operation.quantity, final_stock: validation.projectedStock });
  }

  const applied = appliedItems.length > 0;
  update('import_logs', importLog.id, {
    stock_applied: applied,
    stock_rolled_back: false,
    stock_status: applied ? 'imported' : 'no_product',
    stock_updated_at: applied ? now() : null,
    updated_at: now(),
  });

  return { applied, items: appliedItems };
}

function rollbackStockForImport(importLog, details) {
  if (!importLog || importLog.stock_applied !== true || importLog.stock_rolled_back === true) {
    return { rolledBack: false, items: [] };
  }

  const operations = [];
  const quantityByProductId = aggregateStockQuantities(details);
  for (const [productId, quantity] of quantityByProductId.entries()) {
    const product = getOne('products', p => Number(p.id) === Number(productId));
    if (!product) continue;

    const validation = validateImportStockDelta({
      productId: product.id,
      detail: { product_name: product.name, product_sku: product.sku },
      delta: -quantity,
      operation: 'rollback phiếu nhập',
    });
    operations.push({ product, quantity, validation });
  }

  const rolledBackItems = [];
  for (const operation of operations) {
    const { validation } = applyImportStockDelta({
      productId: operation.product.id,
      detail: { product_name: operation.product.name, product_sku: operation.product.sku },
      delta: -operation.quantity,
      operation: 'rollback phiếu nhập',
      changes: { updated_at: now() },
    });
    rolledBackItems.push({ product_id: operation.product.id, quantity: operation.quantity, final_stock: validation.projectedStock });
  }

  return { rolledBack: rolledBackItems.length > 0, items: rolledBackItems };
}

function applyStockDeltaForUpdatedDetails(importLog, oldDetails, newDetails) {
  if (!importLog || importLog.stock_applied !== true || importLog.stock_rolled_back === true) {
    return { applied: false, items: [] };
  }

  const oldMap = aggregateStockQuantities(oldDetails);
  const newMap = aggregateStockQuantities(newDetails);
  const productIds = new Set([...oldMap.keys(), ...newMap.keys()]);
  const changedItems = [];

  const operations = [];
  for (const productId of productIds) {
    const oldQuantity = toNumber(oldMap.get(productId), 0);
    const newQuantity = toNumber(newMap.get(productId), 0);
    const delta = newQuantity - oldQuantity;
    if (delta === 0) continue;

    const product = getOne('products', p => Number(p.id) === Number(productId));
    if (!product) continue;

    const validation = validateImportStockDelta({
      productId: product.id,
      detail: { product_name: product.name, product_sku: product.sku },
      delta,
      operation: 'cập nhật delta phiếu nhập',
    });
    operations.push({ product, oldQuantity, newQuantity, delta, validation });
  }

  for (const operation of operations) {
    const { validation } = applyImportStockDelta({
      productId: operation.product.id,
      detail: { product_name: operation.product.name, product_sku: operation.product.sku },
      delta: operation.delta,
      operation: 'cập nhật delta phiếu nhập',
      changes: { updated_at: now() },
    });
    changedItems.push({
      product_id: operation.product.id,
      old_quantity: operation.oldQuantity,
      new_quantity: operation.newQuantity,
      delta: operation.delta,
      final_stock: validation.projectedStock,
    });
  }

  if (changedItems.length > 0) {
    update('import_logs', importLog.id, {
      stock_status: 'imported',
      stock_updated_at: now(),
      updated_at: now(),
    });
  }

  return { applied: changedItems.length > 0, items: changedItems };
}

function upsertImportPaymentCashBook(importLog, amount, options = {}) {
  const normalizedAmount = Math.max(0, toNumber(amount, 0));
  if (!importLog || normalizedAmount <= 0) return null;

  const existing = getOne('cash_book', cb =>
    cb &&
    cb.active !== 0 &&
    cb.reference_type === 'import' &&
    Number(cb.reference_id) === Number(importLog.id)
  );

  const time = now();
  const date = options.date || time.slice(0, 10);
  const clock = options.time || time.slice(11, 19);
  const note = options.note || `Thanh toán phiếu nhập ${importLog.import_code || importLog.id}`;

  if (existing) {
    update('cash_book', existing.id, {
      date,
      time: clock,
      type: 'expense',
      category: options.category || existing.category || 'Thanh toán nhập hàng',
      amount: normalizedAmount,
      note,
      reference_id: importLog.id,
      reference_type: 'import',
      updated_at: time,
    });
    return { ...existing, amount: normalizedAmount, updated: true };
  }

  const id = insert('cash_book', {
    date,
    time: clock,
    type: 'expense',
    category: options.category || 'Thanh toán nhập hàng',
    amount: normalizedAmount,
    note,
    reference_id: importLog.id,
    reference_type: 'import',
    active: 1,
    created_at: time,
    updated_at: time,
  });
  return { id, amount: normalizedAmount, created: true };
}

function voidImportPaymentCashBook(importLog) {
  if (!importLog) return null;
  const existing = getOne('cash_book', cb =>
    cb &&
    cb.active !== 0 &&
    cb.reference_type === 'import' &&
    Number(cb.reference_id) === Number(importLog.id)
  );
  if (!existing) return null;
  update('cash_book', existing.id, {
    active: 0,
    note: `${existing.note || 'Thanh toán phiếu nhập'} (đã hủy do cập nhật phiếu nhập)`,
    updated_at: now(),
  });
  return { id: existing.id, voided: true };
}

function softDeleteImport(importLog, reason = 'deleted') {
  if (!importLog) return { ok: false, status: 404, error: 'Không tìm thấy phiếu nhập' };

  if (importLog.deleted === true) {
    return {
      ok: true,
      alreadyDeleted: true,
      deleted: true,
      rollback_stock: false,
      rollback_items: [],
      stock_applied: importLog.stock_applied === true,
      stock_rolled_back: importLog.stock_rolled_back === true,
      message: 'Phiếu nhập đã được xóa trước đó',
    };
  }

  const details = getAll('import_details', d => d.import_id === importLog.id);
  let rollbackResult;
  try {
    rollbackResult = rollbackStockForImport(importLog, details);
  } catch (error) {
    throw error;
  }
  const rolledBackAt = rollbackResult.rolledBack ? now() : (importLog.stock_rolled_back_at || null);

  update('import_logs', importLog.id, {
    status: 'cancelled',
    deleted: true,
    deleted_at: now(),
    payment_status: 'unpaid',
    paid_amount: 0,
    remaining_amount: Math.max(0, toNumber(importLog.total, 0)),
    stock_status: importLog.stock_applied === true
      ? (rollbackResult.rolledBack || importLog.stock_rolled_back === true ? 'rolled_back' : 'rollback_not_needed')
      : 'deleted_no_stock',
    stock_rolled_back: importLog.stock_applied === true ? true : false,
    stock_rolled_back_at: importLog.stock_applied === true ? rolledBackAt : null,
    cancel_reason: reason,
    cancelled_at: importLog.cancelled_at || now(),
    updated_at: now(),
  });

  const voidedPaymentEntry = voidImportPaymentCashBook(importLog);
  const deletedImport = getOne('import_logs', row => Number(row.id) === Number(importLog.id));
  const accountingReversal = accountingService.reverseImport(deletedImport || importLog, reason, { skipSave: true, timestamp: now(), details });

  return {
    ok: true,
    deleted: true,
    rollback_stock: rollbackResult.rolledBack,
    rollback_items: rollbackResult.items,
    payment_cash_book_voided: voidedPaymentEntry,
    accounting_reversal: accountingReversal,
    stock_applied: importLog.stock_applied === true,
    stock_rolled_back: importLog.stock_applied === true,
  };
}

function serializeImport(imp) {
  const details = getAll('import_details', d => d.import_id === imp.id);
  const total = toNumber(imp.total, 0);
  const paymentStatus = normalizePaymentStatus(imp.payment_status);
  const paidAmount = paymentStatus === 'paid' ? total : Math.max(0, toNumber(imp.paid_amount, 0));
  return {
    ...imp,
    status: normalizeImportStatus(imp.status),
    payment_status: paymentStatus,
    paid_amount: paidAmount,
    remaining_amount: paymentStatus === 'paid' ? 0 : Math.max(0, total - paidAmount),
    stock_status: imp.stock_status || (imp.stock_applied ? 'imported' : 'pending'),
    stock_applied: imp.stock_applied === true,
    stock_rolled_back: imp.stock_rolled_back === true,
    deleted: imp.deleted === true,
    partner_name: getOne('partners', p => p.id === imp.partner_id)?.name || '',
    user_name: getOne('users', u => u.id === imp.user_id)?.name || '',
    detail_count: details.length,
  };
}

function findImport(idOrCode) {
  const codeKey = normalizeImportCodeKey(idOrCode);
  return getOne('import_logs', i => (
    String(i.id) === String(idOrCode)
    || (codeKey && normalizeImportCodeKey(i.import_code) === codeKey)
  ));
}

router.get('/', (req, res) => {
  const rows = getAll('import_logs', imp => imp.deleted !== true)
    .map(serializeImport)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(rows);
});

router.get('/:idOrCode', (req, res) => {
  const idOrCode = req.params.idOrCode;
  const imp = findImport(idOrCode);
  if (!imp || imp.deleted === true) return res.status(404).json({ error: 'Không tìm thấy phiếu nhập' });
  const details = getAll('import_details', d => d.import_id === imp.id);
  res.json({ ...serializeImport(imp), details });
});

router.post('/', (req, res) => {
  try {
    const result = withAtomicDbWrite(() => {
      const {
        partner_id,
        user_id,
        total,
        note,
        details,
        status,
        import_code: requestedImportCode,
      } = req.body;

    const normalizedStatus = normalizeImportStatus(status);
    const normalizedTotal = Math.max(0, toNumber(total, 0));
    const payment = unpaidPaymentAmounts(normalizedTotal);
    const import_code = normalizeImportCode(requestedImportCode) || genImportCode();
    if (import_code.length > 64) {
      throw createRouteError('Mã phiếu nhập tối đa 64 ký tự', 400, 'IMPORT_CODE_TOO_LONG');
    }
    const createdAt = now();

    if (normalizedStatus === 'received') {
      buildApplyStockOperations(Array.isArray(details) ? details : [], 'áp dụng phiếu nhập');
    }

    const import_id = insert('import_logs', {
      import_code,
      partner_id: partner_id || null,
      user_id: user_id || null,
      total: normalizedTotal,
      note: note || '',
      status: normalizedStatus,
      stock_status: normalizedStatus === 'received' ? 'pending' : 'not_imported',
      stock_applied: false,
      stock_rolled_back: false,
      stock_updated_at: null,
      stock_rolled_back_at: null,
      payment_status: payment.payment_status,
      paid_amount: payment.paid_amount,
      remaining_amount: payment.remaining_amount,
      deleted: false,
      created_at: createdAt,
      updated_at: createdAt,
    });

    const savedDetails = [];
    for (const d of (Array.isArray(details) ? details : [])) {
      const payload = detailPayload(import_id, d);
      insert('import_details', payload);
      savedDetails.push(payload);
    }

    let stockResult = { applied: false, items: [] };
    if (normalizedStatus === 'received') {
      const importLog = getOne('import_logs', i => i.id === import_id);
      stockResult = applyStockForImport(importLog, savedDetails);
    }

    const savedImport = getOne('import_logs', i => i.id === import_id);
    const accountingResult = normalizedStatus === 'received'
      ? accountingService.postImportReceived(savedImport, savedDetails, { skipSave: true, timestamp: createdAt, userId: req.user?.id || savedImport.user_id || null })
      : null;
    logActivity(req, 'import.create', {
      type: 'import',
      id: import_id,
      code: import_code,
    }, null, { ...savedImport, details: savedDetails }, `Tạo phiếu nhập ${import_code}`, { skipSave: true, accountId: savedImport.account_id || req.accountId });
    return {
      ok: true,
      import_id,
      import_code,
      status: savedImport.status,
      payment_status: savedImport.payment_status,
      paid_amount: savedImport.paid_amount,
      remaining_amount: savedImport.remaining_amount,
      stock_applied: savedImport.stock_applied === true,
      stock_status: savedImport.stock_status,
      stock_items: stockResult.items,
      accounting: accountingResult,
    };
    });

    res.json(result);
  } catch (err) {
    sendImportError(res, err, 'Lỗi khi tạo phiếu nhập');
  }
});

router.put('/:idOrCode', (req, res) => {
  try {
    const result = withAtomicDbWrite(() => {
      const idOrCode = req.params.idOrCode;
      const importLog = findImport(idOrCode);
      if (!importLog || importLog.deleted === true) throw createRouteError('Không tìm thấy phiếu nhập', 404, 'IMPORT_NOT_FOUND');
      if (importLog.status === 'cancelled') throw createRouteError('Phiếu nhập đã hủy, không thể sửa', 400, 'IMPORT_ALREADY_CANCELLED');

    const oldDetails = getAll('import_details', d => d.import_id === importLog.id);
    const hasNewDetails = Array.isArray(req.body.details);
    const incomingDetails = hasNewDetails ? req.body.details.map(d => detailPayload(importLog.id, d)) : oldDetails;
    const itemsChanged = hasNewDetails && !detailsEqual(oldDetails, incomingDetails);

    const nextStatus = req.body.status !== undefined ? normalizeImportStatus(req.body.status) : normalizeImportStatus(importLog.status);
    const nextTotal = req.body.total !== undefined
      ? Math.max(0, toNumber(req.body.total, 0))
      : (itemsChanged ? incomingDetails.reduce((sum, d) => sum + toNumber(d.line_total, 0), 0) : Math.max(0, toNumber(importLog.total, 0)));
    const currentPaymentStatus = normalizePaymentStatus(importLog.payment_status);
    const totalChanged = Math.max(0, toNumber(importLog.total, 0)) !== nextTotal;
    const shouldResetPayment = currentPaymentStatus === 'unpaid' || itemsChanged || totalChanged;
    const nextPayment = shouldResetPayment
      ? unpaidPaymentAmounts(nextTotal)
      : paymentAmounts(nextTotal, 'paid', nextTotal);
    if (
      Object.prototype.hasOwnProperty.call(req.body, 'import_code')
      && normalizeImportCodeKey(req.body.import_code) !== normalizeImportCodeKey(importLog.import_code)
    ) {
      throw createRouteError('Mã phiếu nhập đã cấp không được thay đổi', 400, 'IMPORT_CODE_IMMUTABLE');
    }
    const nextImportCode = importLog.import_code;

    let stockResult = { applied: false, items: [], mode: 'none' };

    if (itemsChanged && importLog.stock_applied === true && importLog.stock_rolled_back !== true && nextStatus === 'received') {
      try {
        const deltaResult = applyStockDeltaForUpdatedDetails(importLog, oldDetails, incomingDetails);
        stockResult = { ...deltaResult, mode: 'delta' };
      } catch (error) {
        throw error;
      }
    }

    let savedDetails = oldDetails;
    if (itemsChanged) {
      savedDetails = replaceImportDetails(importLog.id, incomingDetails);
    }

    const changes = {
      import_code: nextImportCode,
      partner_id: req.body.partner_id !== undefined ? (req.body.partner_id || null) : importLog.partner_id,
      user_id: req.body.user_id !== undefined ? (req.body.user_id || null) : importLog.user_id,
      total: nextTotal,
      note: req.body.note !== undefined ? (req.body.note || '') : (importLog.note || ''),
      status: nextStatus,
      payment_status: nextPayment.payment_status,
      paid_amount: nextPayment.paid_amount,
      remaining_amount: nextPayment.remaining_amount,
      updated_at: now(),
    };

    if (nextStatus === 'received' && importLog.stock_applied !== true && importLog.stock_rolled_back !== true) {
      try {
        buildApplyStockOperations(savedDetails, 'áp dụng phiếu nhập');
      } catch (error) {
        throw error;
      }
      update('import_logs', importLog.id, changes);
      const refreshedBeforeStock = getOne('import_logs', i => i.id === importLog.id);
      const applyResult = applyStockForImport(refreshedBeforeStock, savedDetails);
      stockResult = { ...applyResult, mode: 'apply' };
    } else if (nextStatus === 'draft' && importLog.stock_applied === true && importLog.stock_rolled_back !== true) {
      let rollbackResult;
      try {
        rollbackResult = rollbackStockForImport(importLog, oldDetails);
      } catch (error) {
        throw error;
      }
      Object.assign(changes, {
        stock_status: rollbackResult.rolledBack ? 'rolled_back' : 'rollback_not_needed',
        stock_rolled_back: true,
        stock_rolled_back_at: rollbackResult.rolledBack ? now() : (importLog.stock_rolled_back_at || null),
      });
      update('import_logs', importLog.id, changes);
      stockResult = { ...rollbackResult, mode: 'rollback_to_draft' };
    } else {
      update('import_logs', importLog.id, changes);
    }

    let voidedPaymentEntry = null;
    if (currentPaymentStatus === 'paid' && shouldResetPayment) {
      voidedPaymentEntry = voidImportPaymentCashBook(importLog);
    }

    const savedImport = getOne('import_logs', i => i.id === importLog.id);
    const finalDetails = getAll('import_details', d => d.import_id === importLog.id);
    const accountingResult = normalizeImportStatus(savedImport.status) === 'received'
      ? accountingService.postImportReceived(savedImport, finalDetails, { skipSave: true, timestamp: now(), userId: req.user?.id || savedImport.user_id || null })
      : accountingService.reverseImport(savedImport, 'import_not_received', { skipSave: true, timestamp: now(), details: finalDetails, userId: req.user?.id || savedImport.user_id || null });
    logActivity(req, 'import.update', {
      type: 'import',
      id: savedImport.id,
      code: savedImport.import_code,
    }, importLog, { ...savedImport, details: finalDetails }, `Cập nhật phiếu nhập ${savedImport.import_code || savedImport.id}`, { skipSave: true, accountId: savedImport.account_id || req.accountId });
    return {
      ok: true,
      action: 'updated',
      import_id: savedImport.id,
      import_code: savedImport.import_code,
      status: savedImport.status,
      payment_status: savedImport.payment_status,
      paid_amount: savedImport.paid_amount,
      remaining_amount: savedImport.remaining_amount,
      stock_applied: savedImport.stock_applied === true,
      stock_rolled_back: savedImport.stock_rolled_back === true,
      stock_status: savedImport.stock_status,
      stock_delta: stockResult.items,
      stock_mode: stockResult.mode,
      payment_cash_book_voided: voidedPaymentEntry,
      details: finalDetails,
      accounting: accountingResult,
    };
    });

    res.json(result);
  } catch (err) {
    sendImportError(res, err, 'Lỗi khi cập nhật phiếu nhập');
  }
});

router.post('/:idOrCode/cancel', (req, res) => {
  try {
    const result = withAtomicDbWrite(() => {
      const idOrCode = req.params.idOrCode;
      const importLog = findImport(idOrCode);
      if (!importLog || importLog.deleted === true) throw createRouteError('Không tìm thấy phiếu nhập', 404, 'IMPORT_NOT_FOUND');

      if (importLog.status === 'cancelled') {
        return {
          ok: true,
          message: 'Phiếu nhập đã hủy trước đó',
          rollback_stock: false,
          stock_applied: importLog.stock_applied === true,
          stock_rolled_back: importLog.stock_rolled_back === true,
        };
      }

    const details = getAll('import_details', d => d.import_id === importLog.id);
    let rollbackResult;
    try {
      rollbackResult = rollbackStockForImport(importLog, details);
    } catch (error) {
      throw error;
    }
    const rolledBackAt = rollbackResult.rolledBack ? now() : (importLog.stock_rolled_back_at || null);

    const voidedPaymentEntry = voidImportPaymentCashBook(importLog);

    update('import_logs', importLog.id, {
      status: 'cancelled',
      payment_status: 'unpaid',
      paid_amount: 0,
      remaining_amount: Math.max(0, toNumber(importLog.total, 0)),
      stock_status: importLog.stock_applied === true
        ? (rollbackResult.rolledBack || importLog.stock_rolled_back === true ? 'rolled_back' : 'rollback_not_needed')
        : 'cancelled_no_stock',
      stock_rolled_back: importLog.stock_applied === true ? true : false,
      stock_rolled_back_at: importLog.stock_applied === true ? rolledBackAt : null,
      cancel_reason: req.body.lyDo || req.body.reason || '',
      cancelled_at: now(),
      updated_at: now(),
    });

    const cancelledImport = getOne('import_logs', row => Number(row.id) === Number(importLog.id));
    const accountingReversal = accountingService.reverseImport(cancelledImport || importLog, 'import_cancelled', { skipSave: true, timestamp: cancelledImport?.cancelled_at || now(), details, userId: req.user?.id || importLog.user_id || null });
    logActivity(req, 'import.cancel', {
      type: 'import',
      id: importLog.id,
      code: importLog.import_code,
    }, importLog, cancelledImport, `Hủy phiếu nhập ${importLog.import_code || importLog.id}`, { skipSave: true, accountId: importLog.account_id || req.accountId });

    return {
      ok: true,
      rollback_stock: rollbackResult.rolledBack,
      rollback_items: rollbackResult.items,
      payment_cash_book_voided: voidedPaymentEntry,
      accounting_reversal: accountingReversal,
      stock_applied: importLog.stock_applied === true,
      stock_rolled_back: importLog.stock_applied === true,
    };
    });

    res.json(result);
  } catch (err) {
    sendImportError(res, err, 'Lỗi khi hủy phiếu nhập');
  }
});

router.patch('/:idOrCode/payment', (req, res) => {
  try {
    const result = withAtomicDbWrite(() => {
      const idOrCode = req.params.idOrCode;
      const importLog = findImport(idOrCode);
      if (!importLog || importLog.deleted === true) throw createRouteError('Không tìm thấy phiếu nhập', 404, 'IMPORT_NOT_FOUND');
      if (normalizeImportStatus(importLog.status) === 'cancelled') throw createRouteError('Phiếu nhập đã hủy, không thể thanh toán', 400, 'IMPORT_ALREADY_CANCELLED');

    const total = Math.max(0, toNumber(importLog.total, 0));
    const alreadyPaid = normalizePaymentStatus(importLog.payment_status) === 'paid';
    const payment = paymentAmounts(total, 'paid', total);
    const cashBookEntry = upsertImportPaymentCashBook(importLog, total, {
      date: req.body?.date,
      time: req.body?.time,
      note: req.body?.note || `Thanh toán phiếu nhập ${importLog.import_code}`,
    });

    if (!alreadyPaid || toNumber(importLog.paid_amount, 0) !== payment.paid_amount || toNumber(importLog.remaining_amount, 0) !== 0) {
      update('import_logs', importLog.id, {
        payment_status: payment.payment_status,
        paid_amount: payment.paid_amount,
        remaining_amount: payment.remaining_amount,
        paid_at: importLog.paid_at || now(),
        updated_at: now(),
      });
    }

    const savedImport = getOne('import_logs', i => i.id === importLog.id);
    const accountingPayment = accountingService.postImportPayment(savedImport, {
      amount: payment.paid_amount,
      payment_method: req.body?.payment_method || savedImport.payment_method || 'cash',
      note: req.body?.note || `Thanh toán phiếu nhập ${importLog.import_code}`,
      cash_book_id: cashBookEntry?.id || null,
    }, { skipSave: true, timestamp: savedImport.paid_at || now(), userId: req.user?.id || savedImport.user_id || null });
    logActivity(req, alreadyPaid ? 'import.payment.already_paid' : 'import.payment', {
      type: 'import',
      id: savedImport.id,
      code: savedImport.import_code,
    }, importLog, savedImport, `Thanh toán phiếu nhập ${savedImport.import_code || savedImport.id}`, { skipSave: true, accountId: savedImport.account_id || req.accountId });
    return {
      ok: true,
      action: alreadyPaid ? 'already_paid' : 'paid',
      import_id: savedImport.id,
      import_code: savedImport.import_code,
      payment_status: savedImport.payment_status,
      paid_amount: savedImport.paid_amount,
      remaining_amount: savedImport.remaining_amount,
      cash_book_entry: cashBookEntry,
      accounting_payment: accountingPayment,
      stock_applied: savedImport.stock_applied === true,
      stock_rolled_back: savedImport.stock_rolled_back === true,
      stock_status: savedImport.stock_status,
    };
    });

    res.json(result);
  } catch (err) {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: 'Lỗi khi thanh toán phiếu nhập', detail: err.message, code: err.code });
  }
});

router.delete('/bulk', (req, res) => {
  try {
    const result = withAtomicDbWrite(() => {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      const codes = Array.isArray(req.body?.import_codes) ? req.body.import_codes : [];
      const targets = [...ids, ...codes].filter(v => v !== undefined && v !== null && String(v).trim() !== '');
      if (targets.length === 0) throw createRouteError('Danh sách phiếu nhập cần xóa là bắt buộc', 400, 'IMPORT_BULK_DELETE_EMPTY');

    const seen = new Set();
    const results = [];
    for (const target of targets) {
      const importLog = findImport(target);
      const uniqueKey = importLog ? String(importLog.id) : String(target);
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      const result = softDeleteImport(importLog, req.body?.reason || 'bulk deleted');
      if (result.ok && importLog) {
        logDataDeletion(req, { type: 'import', id: importLog.id, code: importLog.import_code }, importLog, { skipSave: true, accountId: importLog.account_id || req.accountId, content: `Xóa phiếu nhập ${importLog.import_code || importLog.id}` });
      }
      results.push({ target, import_id: importLog?.id || null, import_code: importLog?.import_code || null, ...result });
    }

    const deletedCount = results.filter(r => r.ok && r.deleted && !r.alreadyDeleted).length;
    const rollbackCount = results.filter(r => r.rollback_stock).length;
    const notFound = results.filter(r => !r.ok && r.status === 404).length;

    return { ok: true, deleted_count: deletedCount, rollback_count: rollbackCount, not_found: notFound, results };
    });

    res.json(result);
  } catch (err) {
    sendImportError(res, err, 'Lỗi khi xóa hàng loạt phiếu nhập');
  }
});

router.delete('/:idOrCode', (req, res) => {
  try {
    const result = withAtomicDbWrite(() => {
      const idOrCode = req.params.idOrCode;
      const importLog = findImport(idOrCode);
      const result = softDeleteImport(importLog, req.body?.lyDo || req.body?.reason || 'deleted');
      if (result.ok && importLog) {
        logDataDeletion(req, { type: 'import', id: importLog.id, code: importLog.import_code }, importLog, { skipSave: true, accountId: importLog.account_id || req.accountId, content: `Xóa phiếu nhập ${importLog.import_code || importLog.id}` });
      }
      return result;
    });
    if (!result.ok) return res.status(result.status || 500).json({ error: result.error || 'Không thể xóa phiếu nhập' });
    res.json(result);
  } catch (err) {
    sendImportError(res, err, 'Lỗi khi xóa phiếu nhập');
  }
});

module.exports = router;
