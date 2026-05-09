/**
 * Imports API routes
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, remove, now } = require('../db/database');
const { v4: uuidv4 } = require('uuid');

function genImportCode() {
  const d = new Date();
  return `PN${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}-${uuidv4().slice(0, 6).toUpperCase()}`;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

function detailPayload(importId, detail) {
  const quantity = Math.max(0, toNumber(detail.quantity, 1));
  const importPrice = Math.max(0, toNumber(detail.import_price, 0));
  const lineTotal = detail.line_total !== undefined
    ? Math.max(0, toNumber(detail.line_total, 0))
    : quantity * importPrice;

  return {
    import_id: importId,
    product_id: toOptionalNumber(detail.product_id),
    variant_id: toOptionalNumber(detail.variant_id),
    product_name: detail.product_name || '',
    sku: detail.sku || '',
    quantity,
    import_price: importPrice,
    retail_price: Math.max(0, toNumber(detail.retail_price, 0)),
    wholesale_price: Math.max(0, toNumber(detail.wholesale_price, 0)),
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
    import_price: Math.max(0, toNumber(detail.import_price, 0)),
    retail_price: Math.max(0, toNumber(detail.retail_price, 0)),
    wholesale_price: Math.max(0, toNumber(detail.wholesale_price, 0)),
    line_total: Math.max(0, toNumber(detail.line_total, 0)),
  };
}

function detailsEqual(oldDetails, newDetails) {
  const oldComparable = (oldDetails || []).map(detailComparable);
  const newComparable = (newDetails || []).map(detailComparable);
  return JSON.stringify(oldComparable) === JSON.stringify(newComparable);
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

function applyStockForImport(importLog, details) {
  if (!importLog || importLog.stock_applied === true || importLog.stock_rolled_back === true) {
    return { applied: false, items: [] };
  }

  const appliedItems = [];
  for (const d of details || []) {
    const stockProductId = getStockProductId(d);
    if (!stockProductId) continue;
    const product = getOne('products', p => Number(p.id) === Number(stockProductId));
    if (!product) continue;

    const quantity = Math.max(0, toNumber(d.quantity, 0));
    if (quantity <= 0) continue;

    const changes = { stock: toNumber(product.stock, 0) + quantity, updated_at: now() };
    if (d.import_price) changes.import_price = Math.max(0, toNumber(d.import_price, 0));
    if (d.wholesale_price) changes.wholesale_price = Math.max(0, toNumber(d.wholesale_price, 0));
    if (d.retail_price) changes.retail_price = Math.max(0, toNumber(d.retail_price, 0));
    update('products', product.id, changes);
    appliedItems.push({ product_id: product.id, quantity });
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

  const rolledBackItems = [];
  for (const d of details || []) {
    const stockProductId = getStockProductId(d);
    if (!stockProductId) continue;
    const product = getOne('products', p => Number(p.id) === Number(stockProductId));
    if (!product) continue;

    const quantity = Math.max(0, toNumber(d.quantity, 0));
    if (quantity <= 0) continue;

    update('products', product.id, {
      stock: toNumber(product.stock, 0) - quantity,
      updated_at: now(),
    });
    rolledBackItems.push({ product_id: product.id, quantity });
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

  for (const productId of productIds) {
    const oldQuantity = toNumber(oldMap.get(productId), 0);
    const newQuantity = toNumber(newMap.get(productId), 0);
    const delta = newQuantity - oldQuantity;
    if (delta === 0) continue;

    const product = getOne('products', p => Number(p.id) === Number(productId));
    if (!product) continue;

    update('products', product.id, {
      stock: toNumber(product.stock, 0) + delta,
      updated_at: now(),
    });
    changedItems.push({ product_id: product.id, old_quantity: oldQuantity, new_quantity: newQuantity, delta });
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
  const rollbackResult = rollbackStockForImport(importLog, details);
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

  return {
    ok: true,
    deleted: true,
    rollback_stock: rollbackResult.rolledBack,
    rollback_items: rollbackResult.items,
    payment_cash_book_voided: voidedPaymentEntry,
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
  return getOne('import_logs', i => String(i.id) === String(idOrCode) || String(i.import_code) === String(idOrCode));
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
    const {
      partner_id,
      user_id,
      total,
      note,
      details,
      import_code: requestedCode,
      status,
    } = req.body;

    const normalizedStatus = normalizeImportStatus(status);
    const normalizedTotal = Math.max(0, toNumber(total, 0));
    const payment = unpaidPaymentAmounts(normalizedTotal);
    const import_code = requestedCode || genImportCode();
    const createdAt = now();

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
    res.json({
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
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi tạo phiếu nhập', detail: err.message });
  }
});

router.put('/:idOrCode', (req, res) => {
  try {
    const idOrCode = req.params.idOrCode;
    const importLog = findImport(idOrCode);
    if (!importLog || importLog.deleted === true) return res.status(404).json({ error: 'Không tìm thấy phiếu nhập' });
    if (importLog.status === 'cancelled') return res.status(400).json({ error: 'Phiếu nhập đã hủy, không thể sửa' });

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

    let stockResult = { applied: false, items: [], mode: 'none' };

    if (itemsChanged && importLog.stock_applied === true && importLog.stock_rolled_back !== true && nextStatus === 'received') {
      const deltaResult = applyStockDeltaForUpdatedDetails(importLog, oldDetails, incomingDetails);
      stockResult = { ...deltaResult, mode: 'delta' };
    }

    let savedDetails = oldDetails;
    if (itemsChanged) {
      savedDetails = replaceImportDetails(importLog.id, incomingDetails);
    }

    const changes = {
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
      update('import_logs', importLog.id, changes);
      const refreshedBeforeStock = getOne('import_logs', i => i.id === importLog.id);
      const applyResult = applyStockForImport(refreshedBeforeStock, savedDetails);
      stockResult = { ...applyResult, mode: 'apply' };
    } else if (nextStatus === 'draft' && importLog.stock_applied === true && importLog.stock_rolled_back !== true) {
      const rollbackResult = rollbackStockForImport(importLog, oldDetails);
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
    res.json({
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
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi cập nhật phiếu nhập', detail: err.message });
  }
});

router.post('/:idOrCode/cancel', (req, res) => {
  try {
    const idOrCode = req.params.idOrCode;
    const importLog = findImport(idOrCode);
    if (!importLog || importLog.deleted === true) return res.status(404).json({ error: 'Không tìm thấy phiếu nhập' });

    if (importLog.status === 'cancelled') {
      return res.json({
        ok: true,
        message: 'Phiếu nhập đã hủy trước đó',
        rollback_stock: false,
        stock_applied: importLog.stock_applied === true,
        stock_rolled_back: importLog.stock_rolled_back === true,
      });
    }

    const details = getAll('import_details', d => d.import_id === importLog.id);
    const rollbackResult = rollbackStockForImport(importLog, details);
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

    res.json({
      ok: true,
      rollback_stock: rollbackResult.rolledBack,
      rollback_items: rollbackResult.items,
      payment_cash_book_voided: voidedPaymentEntry,
      stock_applied: importLog.stock_applied === true,
      stock_rolled_back: importLog.stock_applied === true,
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi hủy phiếu nhập', detail: err.message });
  }
});

router.patch('/:idOrCode/payment', (req, res) => {
  try {
    const idOrCode = req.params.idOrCode;
    const importLog = findImport(idOrCode);
    if (!importLog || importLog.deleted === true) return res.status(404).json({ error: 'Không tìm thấy phiếu nhập' });
    if (normalizeImportStatus(importLog.status) === 'cancelled') return res.status(400).json({ error: 'Phiếu nhập đã hủy, không thể thanh toán' });

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
    res.json({
      ok: true,
      action: alreadyPaid ? 'already_paid' : 'paid',
      import_id: savedImport.id,
      import_code: savedImport.import_code,
      payment_status: savedImport.payment_status,
      paid_amount: savedImport.paid_amount,
      remaining_amount: savedImport.remaining_amount,
      cash_book_entry: cashBookEntry,
      stock_applied: savedImport.stock_applied === true,
      stock_rolled_back: savedImport.stock_rolled_back === true,
      stock_status: savedImport.stock_status,
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi thanh toán phiếu nhập', detail: err.message });
  }
});

router.delete('/bulk', (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const codes = Array.isArray(req.body?.import_codes) ? req.body.import_codes : [];
    const targets = [...ids, ...codes].filter(v => v !== undefined && v !== null && String(v).trim() !== '');
    if (targets.length === 0) return res.status(400).json({ error: 'Danh sách phiếu nhập cần xóa là bắt buộc' });

    const seen = new Set();
    const results = [];
    for (const target of targets) {
      const importLog = findImport(target);
      const uniqueKey = importLog ? String(importLog.id) : String(target);
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      const result = softDeleteImport(importLog, req.body?.reason || 'bulk deleted');
      results.push({ target, import_id: importLog?.id || null, import_code: importLog?.import_code || null, ...result });
    }

    const deletedCount = results.filter(r => r.ok && r.deleted && !r.alreadyDeleted).length;
    const rollbackCount = results.filter(r => r.rollback_stock).length;
    const notFound = results.filter(r => !r.ok && r.status === 404).length;

    res.json({ ok: true, deleted_count: deletedCount, rollback_count: rollbackCount, not_found: notFound, results });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi xóa hàng loạt phiếu nhập', detail: err.message });
  }
});

router.delete('/:idOrCode', (req, res) => {
  try {
    const idOrCode = req.params.idOrCode;
    const importLog = findImport(idOrCode);
    const result = softDeleteImport(importLog, req.body?.lyDo || req.body?.reason || 'deleted');
    if (!result.ok) return res.status(result.status || 500).json({ error: result.error || 'Không thể xóa phiếu nhập' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi xóa phiếu nhập', detail: err.message });
  }
});

module.exports = router;
