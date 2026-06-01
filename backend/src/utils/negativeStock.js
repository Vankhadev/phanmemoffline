const { getOne, auditLog } = require('../db/database');
const { resolveInvoiceDetailDisplayFields } = require('./productDisplayName');

const FEATURE_TABLE = 'feature_catalog';
const NEGATIVE_STOCK_FEATURE_KEY = 'negative_stock_exports';
const NEGATIVE_STOCK_LIMIT = -100;
const NEGATIVE_STOCK_WARNING_THRESHOLD = -80;
const NEGATIVE_STOCK_LIMIT_MESSAGE = `Sản phẩm đã vượt mức xuất âm cho phép (${NEGATIVE_STOCK_LIMIT})`;

function normalizeFeatureKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toStockNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getNegativeStockFeature() {
  return getOne(
    FEATURE_TABLE,
    row => row
      && !row.deleted_at
      && normalizeFeatureKey(row.feature_key || row.key || row.code) === NEGATIVE_STOCK_FEATURE_KEY,
    { skipAccountScope: true },
  );
}

function isNegativeStockEnabled() {
  return true;
}

function getMinimumAllowedProductStock() {
  return NEGATIVE_STOCK_LIMIT;
}

function isComboDetail(detail = {}) {
  return detail.type === 'combo' || detail.item_type === 'combo' || !!detail.combo_id;
}

function getInvoiceDetailProductId(detail = {}) {
  if (isComboDetail(detail)) return null;
  return detail.product_id || detail.variant_id || null;
}

function collectRequestedProductQuantities(details = []) {
  const requiredByProductId = new Map();
  for (const detail of details || []) {
    const productId = Number(getInvoiceDetailProductId(detail));
    if (!Number.isFinite(productId) || productId <= 0) continue;
    const quantity = Math.max(0, Number(detail.quantity) || 0);
    if (quantity <= 0) continue;
    requiredByProductId.set(productId, (requiredByProductId.get(productId) || 0) + quantity);
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
  const parts = [];
  if (currentStock !== undefined && currentStock !== null) parts.push(`Tồn hiện tại: ${currentStock}`);
  if (exportQuantity !== undefined && Number(exportQuantity) > 0) parts.push(`số lượng xuất: ${exportQuantity}`);
  if (changeQuantity !== undefined && Number(changeQuantity) !== 0) parts.push(`thay đổi tồn kho: ${changeQuantity}`);
  if (projectedStock !== undefined && projectedStock !== null) parts.push(`tồn cuối dự kiến: ${projectedStock}`);
  parts.push(`giới hạn tối thiểu: ${minimumAllowedStock}`);

  return `${NEGATIVE_STOCK_LIMIT_MESSAGE}. Không thể ${operation} cho "${productName || 'Sản phẩm'}". ${parts.join(', ')}.`;
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
    negative_stock_enabled: true,
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
  const normalizedMinimum = toStockNumber(minimumAllowedStock, NEGATIVE_STOCK_LIMIT);

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
    negativeStockEnabled: true,
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
    const productId = Number(getInvoiceDetailProductId(detail));
    if (!Number.isFinite(productId) || productId <= 0 || detailByProductId.has(productId)) continue;
    detailByProductId.set(productId, detail);
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
    return auditLog(action, {
      ...(meta || {}),
      negative_stock_limit: NEGATIVE_STOCK_LIMIT,
      minimum_allowed_stock: getMinimumAllowedProductStock(),
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
    message: error?.message || NEGATIVE_STOCK_LIMIT_MESSAGE,
    code: error?.code || 'NEGATIVE_STOCK_LIMIT_EXCEEDED',
  }, options);
}

module.exports = {
  NEGATIVE_STOCK_FEATURE_KEY,
  NEGATIVE_STOCK_LIMIT,
  NEGATIVE_STOCK_WARNING_THRESHOLD,
  NEGATIVE_STOCK_LIMIT_MESSAGE,
  getNegativeStockFeature,
  isNegativeStockEnabled,
  getMinimumAllowedProductStock,
  toStockNumber,
  isComboDetail,
  getInvoiceDetailProductId,
  collectRequestedProductQuantities,
  assertProjectedProductStock,
  assertProductStockValueWithinLimit,
  assertCanApplyProductStockDelta,
  assertCanExportProductStock,
  validateNegativeStockForDetails,
  logStockAuditEvent,
  logNegativeStockTransition,
  logNegativeStockLimitViolation,
};
