const { getOne } = require('../db/database');
const { resolveInvoiceDetailDisplayFields } = require('./productDisplayName');

const FEATURE_TABLE = 'feature_catalog';
const NEGATIVE_STOCK_FEATURE_KEY = 'negative_stock_exports';
const NEGATIVE_STOCK_LIMIT = -10;

function normalizeFeatureKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
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
  const feature = getNegativeStockFeature();
  return Boolean(feature && feature.active !== 0);
}

function getMinimumAllowedProductStock() {
  return isNegativeStockEnabled() ? NEGATIVE_STOCK_LIMIT : 0;
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
    currentStock: Number(product.stock) || 0,
    name: displayFields.product_name || detail.product_name || detail.name || product.name || `ID ${numericProductId}`,
  };
}

function buildNegativeStockErrorMessage({
  productName,
  currentStock,
  exportQuantity,
  projectedStock,
  minimumAllowedStock,
  negativeStockEnabled,
}) {
  const policyDescription = negativeStockEnabled
    ? `Xuất âm đang bật nhưng tồn kho không được thấp hơn ${minimumAllowedStock}.`
    : 'Xuất âm đang tắt nên không được xuất vượt tồn kho hiện có.';

  return `Không thể xuất sản phẩm "${productName}". Tồn hiện tại: ${currentStock}, số lượng xuất: ${exportQuantity}, tồn dự kiến: ${projectedStock}, giới hạn tối thiểu: ${minimumAllowedStock}. ${policyDescription}`;
}

function createStockValidationError({
  productId,
  productName,
  currentStock,
  exportQuantity,
  projectedStock,
  minimumAllowedStock,
  negativeStockEnabled,
}) {
  const error = new Error(buildNegativeStockErrorMessage({
    productName,
    currentStock,
    exportQuantity,
    projectedStock,
    minimumAllowedStock,
    negativeStockEnabled,
  }));
  error.status = 400;
  error.code = negativeStockEnabled ? 'NEGATIVE_STOCK_LIMIT_EXCEEDED' : 'INSUFFICIENT_STOCK';
  error.details = {
    product_id: productId,
    product_name: productName,
    current_stock: currentStock,
    export_quantity: exportQuantity,
    projected_stock: projectedStock,
    minimum_allowed_stock: minimumAllowedStock,
    negative_stock_enabled: negativeStockEnabled,
  };
  return error;
}

function assertCanExportProductStock({ productId, detail = {}, requiredQuantity = 0, restoredQuantity = 0 }) {
  const snapshot = getProductStockSnapshot(productId, detail);
  if (!snapshot) {
    const error = new Error(`Sản phẩm ID ${productId} không tồn tại`);
    error.status = 400;
    error.code = 'PRODUCT_NOT_FOUND';
    throw error;
  }

  const negativeStockEnabled = isNegativeStockEnabled();
  const minimumAllowedStock = negativeStockEnabled ? NEGATIVE_STOCK_LIMIT : 0;
  const exportQuantity = Math.max(0, Number(requiredQuantity) || 0);
  const availableStock = snapshot.currentStock + (Number(restoredQuantity) || 0);
  const projectedStock = availableStock - exportQuantity;

  if (projectedStock < minimumAllowedStock) {
    throw createStockValidationError({
      productId: snapshot.productId,
      productName: snapshot.name,
      currentStock: snapshot.currentStock,
      exportQuantity,
      projectedStock,
      minimumAllowedStock,
      negativeStockEnabled,
    });
  }

  return {
    productId: snapshot.productId,
    productName: snapshot.name,
    currentStock: snapshot.currentStock,
    exportQuantity,
    projectedStock,
    minimumAllowedStock,
    negativeStockEnabled,
  };
}

function validateNegativeStockForDetails(details = [], options = {}) {
  const restoredByProductId = options.restoredByProductId instanceof Map
    ? options.restoredByProductId
    : new Map();
  const requiredByProductId = collectRequestedProductQuantities(details);
  const detailByProductId = new Map();

  for (const detail of details || []) {
    const productId = Number(getInvoiceDetailProductId(detail));
    if (!Number.isFinite(productId) || productId <= 0 || detailByProductId.has(productId)) continue;
    detailByProductId.set(productId, detail);
  }

  for (const [productId, requiredQuantity] of requiredByProductId.entries()) {
    assertCanExportProductStock({
      productId,
      detail: detailByProductId.get(productId) || {},
      requiredQuantity,
      restoredQuantity: restoredByProductId.get(productId) || 0,
    });
  }
}

module.exports = {
  NEGATIVE_STOCK_FEATURE_KEY,
  NEGATIVE_STOCK_LIMIT,
  getNegativeStockFeature,
  isNegativeStockEnabled,
  getMinimumAllowedProductStock,
  isComboDetail,
  getInvoiceDetailProductId,
  collectRequestedProductQuantities,
  assertCanExportProductStock,
  validateNegativeStockForDetails,
};
