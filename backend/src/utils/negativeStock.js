const { getAll, getOne, insert, update, auditLog, withAtomicDbWrite } = require('../db/database');
const { resolveInvoiceDetailDisplayFields } = require('./productDisplayName');
const {
  NEGATIVE_STOCK_FEATURE_KEY,
  DEFAULT_NEGATIVE_STOCK_LIMIT,
  findFeatureByKey,
  getNegativeStockSettings,
} = require('../services/settingsService');

function toStockNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

const productStockRowLocks = new Set();

function normalizeProductStockLockKey(productId) {
  const numericId = Number(productId);
  return Number.isFinite(numericId) && numericId > 0 ? String(numericId) : String(productId || '').trim();
}

function withProductStockRowLock(productId, callback) {
  const lockKey = normalizeProductStockLockKey(productId);
  if (!lockKey) return callback();

  if (productStockRowLocks.has(lockKey)) {
    const error = new Error(`Sản phẩm ID ${productId} đang được cập nhật tồn kho, vui lòng thử lại.`);
    error.status = 409;
    error.statusCode = 409;
    error.code = 'PRODUCT_STOCK_ROW_LOCKED';
    error.details = { product_id: productId };
    throw error;
  }

  productStockRowLocks.add(lockKey);
  try {
    return callback();
  } finally {
    productStockRowLocks.delete(lockKey);
  }
}

function getNegativeStockPolicy() {
  const settings = getNegativeStockSettings();
  const positiveLimit = Math.max(0, Math.trunc(toStockNumber(settings.negative_stock_limit, DEFAULT_NEGATIVE_STOCK_LIMIT)));
  const minimumAllowedStock = settings.negative_stock_enabled ? -positiveLimit : 0;
  const warningThreshold = settings.negative_stock_enabled && positiveLimit > 0
    ? -Math.max(1, Math.floor(positiveLimit * 0.8))
    : 0;

  return {
    enabled: Boolean(settings.negative_stock_enabled),
    negative_stock_enabled: Boolean(settings.negative_stock_enabled),
    negativeStockEnabled: Boolean(settings.negative_stock_enabled),
    positiveLimit,
    negative_stock_limit: positiveLimit,
    negativeStockLimit: positiveLimit,
    minimumAllowedStock,
    minimum_allowed_stock: minimumAllowedStock,
    runtime_minimum_stock: minimumAllowedStock,
    warningThreshold,
    warning_threshold: warningThreshold,
    feature_key: NEGATIVE_STOCK_FEATURE_KEY,
  };
}

function getNegativeStockFeature() {
  return findFeatureByKey(NEGATIVE_STOCK_FEATURE_KEY);
}

function isNegativeStockEnabled() {
  return getNegativeStockPolicy().enabled;
}

function getMinimumAllowedProductStock() {
  return getNegativeStockPolicy().minimumAllowedStock;
}

function getNegativeStockLimit() {
  return -getMinimumAllowedProductStock();
}

function getNegativeStockWarningThreshold() {
  return getNegativeStockPolicy().warningThreshold;
}

const NEGATIVE_STOCK_LIMIT_ERROR_MESSAGE = 'Số lượng xuất vượt quá giới hạn âm cho phép';

function getNegativeStockLimitMessage() {
  const policy = getNegativeStockPolicy();
  return `${NEGATIVE_STOCK_LIMIT_ERROR_MESSAGE} (tối thiểu ${policy.minimumAllowedStock})`;
}

function isComboDetail(detail = {}) {
  return detail.type === 'combo' || detail.item_type === 'combo' || !!detail.combo_id;
}

function getInvoiceDetailProductId(detail = {}) {
  if (isComboDetail(detail)) return null;
  return detail.product_id || detail.variant_id || null;
}

function getComboDetailId(detail = {}) {
  const id = Number(detail.combo_id || detail.comboId || detail.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function getComboComponentProductId(component = {}) {
  const id = Number(component.variant_id || component.variantId || component.product_id || component.productId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function getComboComponentQuantity(component = {}) {
  const quantity = Number(component.quantity ?? component.qty ?? component.quantity_in_combo ?? component.combo_quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function buildComboComponentDetail(comboDetail = {}, component = {}, productId = null) {
  const comboName = comboDetail.product_name || comboDetail.name || comboDetail.combo_name || 'Combo';
  return {
    ...component,
    product_id: productId || component.product_id || component.variant_id || null,
    variant_id: component.variant_id || null,
    product_name: component.product_name || component.name || component.parent_name || component.variant_name || component.sku || `Thành phần combo ${comboName}`,
    name: component.name || component.product_name || component.variant_name || component.parent_name || `Thành phần combo ${comboName}`,
    product_sku: component.product_sku || component.sku || '',
    sku: component.sku || component.product_sku || '',
    combo_id: comboDetail.combo_id || comboDetail.comboId || comboDetail.id || null,
    combo_name: comboName,
    type: 'product',
    item_type: component.item_type === 'variant' ? 'variant' : 'product',
  };
}

function getComboStockTargets(detail = {}) {
  const comboId = getComboDetailId(detail);
  if (!comboId) return [];
  const comboQuantity = Math.max(0, Number(detail.quantity) || 0);
  if (comboQuantity <= 0) return [];

  return getAll('combo_items', item => Number(item.combo_id) === Number(comboId))
    .map(component => {
      const productId = getComboComponentProductId(component);
      if (!productId) return null;
      const quantity = getComboComponentQuantity(component) * comboQuantity;
      if (!Number.isFinite(quantity) || quantity <= 0) return null;
      return {
        productId,
        quantity,
        detail: buildComboComponentDetail(detail, component, productId),
        sourceDetail: detail,
        comboId,
      };
    })
    .filter(Boolean);
}

function getStockTargetsForInvoiceDetail(detail = {}) {
  if (isComboDetail(detail)) return getComboStockTargets(detail);

  const productId = Number(getInvoiceDetailProductId(detail));
  if (!Number.isFinite(productId) || productId <= 0) return [];
  const quantity = Math.max(0, Number(detail.quantity) || 0);
  if (quantity <= 0) return [];
  return [{ productId, quantity, detail, sourceDetail: detail, comboId: null }];
}

function collectRequestedProductQuantities(details = []) {
  const requiredByProductId = new Map();
  for (const detail of details || []) {
    for (const target of getStockTargetsForInvoiceDetail(detail)) {
      const productId = Number(target.productId);
      if (!Number.isFinite(productId) || productId <= 0) continue;
      const quantity = Math.max(0, Number(target.quantity) || 0);
      if (quantity <= 0) continue;
      requiredByProductId.set(productId, (requiredByProductId.get(productId) || 0) + quantity);
    }
  }
  return requiredByProductId;
}

function getProductStockSnapshot(productId, detail = {}) {
  const numericProductId = Number(productId);
  const product = getOne('products', row => Number(row.id) === numericProductId);
  if (!product) return null;

  const displayFields = resolveInvoiceDetailDisplayFields(
    detail,
    id => getOne('products', row => Number(row.id) === Number(id)),
  );

  return {
    product,
    productId: numericProductId,
    currentStock: toStockNumber(product.stock, 0),
    name: displayFields.product_name || detail.product_name || detail.name || product.name || `ID ${numericProductId}`,
  };
}

function buildNegativeStockErrorMessage({
  productName,
  currentStock,
  exportQuantity,
  changeQuantity,
  projectedStock,
  minimumAllowedStock = getMinimumAllowedProductStock(),
  operation = 'cập nhật tồn kho',
}) {
  const policy = getNegativeStockPolicy();
  const parts = [];
  if (currentStock !== undefined && currentStock !== null) parts.push(`Tồn hiện tại: ${currentStock}`);
  if (exportQuantity !== undefined && Number(exportQuantity) > 0) parts.push(`số lượng xuất: ${exportQuantity}`);
  if (changeQuantity !== undefined && Number(changeQuantity) !== 0) parts.push(`thay đổi tồn kho: ${changeQuantity}`);
  if (projectedStock !== undefined && projectedStock !== null) parts.push(`tồn cuối dự kiến: ${projectedStock}`);
  parts.push(`số lượng âm cho phép: ${policy.negative_stock_limit}`);
  parts.push(`giới hạn tối thiểu: ${minimumAllowedStock}`);

  return `${getNegativeStockLimitMessage()}. Không thể ${operation} cho "${productName || 'Sản phẩm'}". ${parts.join(', ')}.`;
}

function createStockValidationError({
  productId,
  productName,
  currentStock,
  exportQuantity,
  changeQuantity,
  projectedStock,
  minimumAllowedStock = getMinimumAllowedProductStock(),
  operation,
}) {
  const policy = getNegativeStockPolicy();
  const error = new Error(buildNegativeStockErrorMessage({
    productName,
    currentStock,
    exportQuantity,
    changeQuantity,
    projectedStock,
    minimumAllowedStock,
    operation,
  }));
  error.status = 400;
  error.statusCode = 400;
  error.code = 'NEGATIVE_STOCK_LIMIT_EXCEEDED';
  error.details = {
    product_id: productId,
    product_name: productName,
    current_stock: currentStock,
    export_quantity: exportQuantity,
    change_quantity: changeQuantity,
    projected_stock: projectedStock,
    final_stock: projectedStock,
    minimum_allowed_stock: minimumAllowedStock,
    negative_stock_enabled: policy.enabled,
    negative_stock_limit: policy.negative_stock_limit,
    operation: operation || 'stock_update',
  };
  return error;
}

function assertProjectedProductStock({
  productId,
  productName,
  currentStock,
  exportQuantity,
  changeQuantity,
  delta,
  projectedStock,
  minimumAllowedStock = getMinimumAllowedProductStock(),
  operation = 'cập nhật tồn kho',
}) {
  const policy = getNegativeStockPolicy();
  const hasCurrentStock = currentStock !== undefined && currentStock !== null;
  const normalizedCurrentStock = hasCurrentStock ? toStockNumber(currentStock, 0) : null;
  const normalizedDelta = delta !== undefined ? toStockNumber(delta, 0) : undefined;
  const normalizedProjectedStock = projectedStock !== undefined && projectedStock !== null
    ? toStockNumber(projectedStock, 0)
    : toStockNumber((normalizedCurrentStock || 0) + (normalizedDelta || 0), 0);
  const normalizedChangeQuantity = changeQuantity !== undefined
    ? toStockNumber(changeQuantity, 0)
    : (hasCurrentStock ? normalizedProjectedStock - normalizedCurrentStock : normalizedDelta);
  const normalizedExportQuantity = exportQuantity !== undefined
    ? Math.max(0, toStockNumber(exportQuantity, 0))
    : (normalizedChangeQuantity < 0 ? Math.abs(normalizedChangeQuantity) : undefined);
  const normalizedMinimum = toStockNumber(minimumAllowedStock, policy.minimumAllowedStock);

  if (normalizedProjectedStock < normalizedMinimum) {
    throw createStockValidationError({
      productId,
      productName,
      currentStock: normalizedCurrentStock,
      exportQuantity: normalizedExportQuantity,
      changeQuantity: normalizedChangeQuantity,
      projectedStock: normalizedProjectedStock,
      minimumAllowedStock: normalizedMinimum,
      operation,
    });
  }

  return {
    productId,
    productName,
    currentStock: normalizedCurrentStock,
    exportQuantity: normalizedExportQuantity,
    changeQuantity: normalizedChangeQuantity,
    projectedStock: normalizedProjectedStock,
    minimumAllowedStock: normalizedMinimum,
    negativeStockEnabled: policy.enabled,
    negative_stock_enabled: policy.enabled,
    negative_stock_limit: policy.negative_stock_limit,
    operation,
  };
}

function assertProductStockValueWithinLimit({
  productId,
  productName,
  stock,
  currentStock = null,
  operation = 'cập nhật tồn kho sản phẩm',
}) {
  const normalizedStock = toStockNumber(stock, 0);
  return assertProjectedProductStock({
    productId,
    productName,
    currentStock,
    projectedStock: normalizedStock,
    changeQuantity: currentStock !== undefined && currentStock !== null ? normalizedStock - toStockNumber(currentStock, 0) : undefined,
    operation,
  });
}

function assertCanApplyProductStockDelta({ productId, detail = {}, delta = 0, quantity, operation = 'cập nhật tồn kho' }) {
  const snapshot = getProductStockSnapshot(productId, detail);
  if (!snapshot) {
    const error = new Error(`Sản phẩm ID ${productId} không tồn tại`);
    error.status = 400;
    error.statusCode = 400;
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }

  const normalizedDelta = toStockNumber(delta, 0);
  const projectedStock = snapshot.currentStock + normalizedDelta;
  return assertProjectedProductStock({
    productId: snapshot.productId,
    productName: snapshot.name,
    currentStock: snapshot.currentStock,
    exportQuantity: normalizedDelta < 0 ? Math.abs(normalizedDelta) : (quantity !== undefined ? Math.max(0, toStockNumber(quantity, 0)) : undefined),
    changeQuantity: normalizedDelta,
    projectedStock,
    operation,
  });
}

function applyProductStockDeltaLocked({
  productId,
  detail = {},
  delta = 0,
  quantity,
  operation = 'cập nhật tồn kho',
  changes = {},
  options = {},
  source = '',
  meta = {},
}) {
  // Cơ chế phù hợp với JSON DB offline: mọi lần trừ/cộng tồn đều chạy trong
  // transaction `withAtomicDbWrite` và giữ row-lock in-process theo product id.
  // Vì backend Node xử lý synchronous trong một process, lock này ngăn re-entrant
  // write cùng sản phẩm; transaction rollback snapshot nếu validate/update lỗi.
  return withAtomicDbWrite(() => withProductStockRowLock(productId, () => {
    const validation = assertCanApplyProductStockDelta({ productId, detail, delta, quantity, operation });
    const updated = update('products', validation.productId, {
      ...(changes || {}),
      stock: validation.projectedStock,
    }, { skipSave: options.skipSave === true });
    // Append-only stock ledger: product.stock is the current balance, while this
    // row preserves the business reference and before/after audit trail.
    const referenceType = String(meta.reference_type || meta.referenceType || source || 'manual').trim();
    const referenceId = meta.reference_id ?? meta.referenceId ?? null;
    const revision = Number(meta.revision || 1) || 1;
    const transactionType = delta < 0 ? 'sale_out' : 'stock_in';
    const duplicate = referenceId == null ? null : getOne('inventory_transactions', row =>
      Number(row.product_id) === Number(validation.productId)
      && row.reference_type === referenceType
      && String(row.reference_id) === String(referenceId)
      && row.transaction_type === transactionType
      && Number(row.revision || 1) === revision
    );
    if (!duplicate) {
      insert('inventory_transactions', {
        product_id: validation.productId,
        transaction_type: transactionType,
        reference_type: referenceType,
        reference_id: referenceId,
        revision,
        quantity_change: validation.changeQuantity,
        stock_before: validation.currentStock,
        stock_after: validation.projectedStock,
        note: operation,
        created_at: new Date().toISOString(),
      }, { skipSave: options.skipSave === true });
    }
    logNegativeStockTransition({ ...validation, ...(meta || {}), source }, { skipSave: options.skipSave === true });
    return { updated, validation };
  }));
}

function assertCanExportProductStock({ productId, detail = {}, requiredQuantity = 0, restoredQuantity = 0 }) {
  const snapshot = getProductStockSnapshot(productId, detail);
  if (!snapshot) {
    const error = new Error(`Sản phẩm ID ${productId} không tồn tại`);
    error.status = 400;
    error.statusCode = 400;
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }

  const exportQuantity = Math.max(0, Number(requiredQuantity) || 0);
  const availableStock = snapshot.currentStock + (Number(restoredQuantity) || 0);
  const projectedStock = availableStock - exportQuantity;

  return assertProjectedProductStock({
    productId: snapshot.productId,
    productName: snapshot.name,
    currentStock: snapshot.currentStock,
    exportQuantity,
    changeQuantity: -exportQuantity,
    projectedStock,
    operation: 'xuất kho',
  });
}

function validateNegativeStockForDetails(details = [], options = {}) {
  const restoredByProductId = options.restoredByProductId instanceof Map
    ? options.restoredByProductId
    : new Map();
  const requiredByProductId = collectRequestedProductQuantities(details);
  const detailByProductId = new Map();
  const validations = [];

  for (const detail of details || []) {
    for (const target of getStockTargetsForInvoiceDetail(detail)) {
      const productId = Number(target.productId);
      if (!Number.isFinite(productId) || productId <= 0 || detailByProductId.has(productId)) continue;
      detailByProductId.set(productId, target.detail || detail);
    }
  }

  for (const [productId, requiredQuantity] of requiredByProductId.entries()) {
    validations.push(assertCanExportProductStock({
      productId,
      detail: detailByProductId.get(productId) || {},
      requiredQuantity,
      restoredQuantity: restoredByProductId.get(productId) || 0,
    }));
  }

  return validations;
}

function logStockAuditEvent(action, meta = {}, options = {}) {
  try {
    const policy = getNegativeStockPolicy();
    return auditLog(action, {
      ...(meta || {}),
      negative_stock_enabled: policy.enabled,
      negative_stock_limit: policy.negative_stock_limit,
      minimum_allowed_stock: policy.minimumAllowedStock,
    }, { skipSave: options.skipSave === true });
  } catch (_error) {
    return null;
  }
}

function logNegativeStockTransition(event = {}, options = {}) {
  const projectedStock = toStockNumber(event.projectedStock ?? event.projected_stock ?? event.final_stock, 0);
  if (projectedStock >= 0) return null;
  return logStockAuditEvent('stock.negative_stock_applied', {
    product_id: event.productId ?? event.product_id ?? null,
    product_name: event.productName ?? event.product_name ?? '',
    current_stock: event.currentStock ?? event.current_stock ?? null,
    change_quantity: event.changeQuantity ?? event.change_quantity ?? null,
    export_quantity: event.exportQuantity ?? event.export_quantity ?? null,
    projected_stock: projectedStock,
    final_stock: projectedStock,
    operation: event.operation || 'stock_update',
    source: event.source || '',
    reference_id: event.reference_id || event.invoice_id || event.import_id || event.return_id || null,
  }, options);
}

function logNegativeStockLimitViolation(error, meta = {}, options = {}) {
  const details = error?.details || {};
  const projectedStock = details.projected_stock ?? details.final_stock;
  const shouldLog = error?.code === 'NEGATIVE_STOCK_LIMIT_EXCEEDED'
    || (projectedStock !== undefined && toStockNumber(projectedStock, 0) < getMinimumAllowedProductStock());
  if (!shouldLog) return null;

  return logStockAuditEvent('stock.negative_stock_limit_blocked', {
    ...details,
    ...(meta || {}),
    message: error?.message || getNegativeStockLimitMessage(),
    code: error?.code || 'NEGATIVE_STOCK_LIMIT_EXCEEDED',
  }, options);
}

function isNegativeStockLimitError(error) {
  if (!error) return false;
  const details = error.details || {};
  const projectedStock = details.projected_stock ?? details.final_stock ?? details.projectedStock;
  return error.code === 'NEGATIVE_STOCK_LIMIT_EXCEEDED'
    || (projectedStock !== undefined && toStockNumber(projectedStock, 0) < getMinimumAllowedProductStock());
}

function buildNegativeStockErrorResponse(error, fallback = 'Lỗi kiểm tra tồn kho') {
  if (isNegativeStockLimitError(error)) {
    return {
      ok: false,
      error: NEGATIVE_STOCK_LIMIT_ERROR_MESSAGE,
      message: NEGATIVE_STOCK_LIMIT_ERROR_MESSAGE,
      detail: error?.message || getNegativeStockLimitMessage(),
      code: error?.code || 'NEGATIVE_STOCK_LIMIT_EXCEEDED',
      details: error?.details || undefined,
    };
  }

  return {
    ok: false,
    error: fallback,
    message: error?.message || fallback,
    detail: error?.message || fallback,
    code: error?.code || undefined,
    details: error?.details || undefined,
  };
}

module.exports = {
  NEGATIVE_STOCK_FEATURE_KEY,
  get NEGATIVE_STOCK_LIMIT() { return getMinimumAllowedProductStock(); },
  get NEGATIVE_STOCK_WARNING_THRESHOLD() { return getNegativeStockWarningThreshold(); },
  NEGATIVE_STOCK_LIMIT_MESSAGE: NEGATIVE_STOCK_LIMIT_ERROR_MESSAGE,
  NEGATIVE_STOCK_LIMIT_ERROR_MESSAGE,
  getNegativeStockFeature,
  getNegativeStockPolicy,
  getNegativeStockLimit,
  getNegativeStockWarningThreshold,
  getNegativeStockLimitMessage,
  isNegativeStockEnabled,
  getMinimumAllowedProductStock,
  toStockNumber,
  isComboDetail,
  getInvoiceDetailProductId,
  collectRequestedProductQuantities,
  getStockTargetsForInvoiceDetail,
  assertProjectedProductStock,
  assertProductStockValueWithinLimit,
  assertCanApplyProductStockDelta,
  assertCanExportProductStock,
  withProductStockRowLock,
  applyProductStockDeltaLocked,
  validateNegativeStockForDetails,
  logStockAuditEvent,
  logNegativeStockTransition,
  logNegativeStockLimitViolation,
  isNegativeStockLimitError,
  buildNegativeStockErrorResponse,
};
