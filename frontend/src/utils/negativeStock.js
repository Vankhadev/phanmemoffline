export const NEGATIVE_STOCK_LIMIT = -100;
export const NEGATIVE_STOCK_WARNING_THRESHOLD = -80;
export const NEGATIVE_STOCK_LIMIT_MESSAGE = `Không được xuất âm vượt quá ${NEGATIVE_STOCK_LIMIT}`;

export function toStockNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function roundStock(value) {
  const number = toStockNumber(value, 0);
  return Math.round((number + Number.EPSILON) * 10) / 10;
}

export function formatStockValue(value) {
  return `Tồn: ${roundStock(value).toLocaleString('vi-VN')}`;
}

export function isComboSaleLine(line = {}) {
  const type = String(line?.type || line?.item_type || '').trim().toLowerCase();
  return Boolean(type === 'combo' || line?.combo_id);
}

export function getSaleLineProductId(line = {}) {
  if (isComboSaleLine(line)) return null;
  const id = Number(line?.variant_id || line?.product_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function getSaleLineQuantity(line = {}) {
  const quantity = Number(line?.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

export function getStockDisplayMeta(value) {
  const stock = roundStock(value);
  const isNegative = stock < 0;
  const isBreached = stock < NEGATIVE_STOCK_LIMIT;
  const isNearLimit = stock <= NEGATIVE_STOCK_WARNING_THRESHOLD && stock >= NEGATIVE_STOCK_LIMIT;

  if (isBreached) {
    return {
      stock,
      label: 'Vượt ngưỡng',
      display: formatStockValue(stock),
      isNegative,
      isNearLimit: false,
      isBreached: true,
      textClass: 'text-red-700 font-bold',
      nameClass: 'text-red-700 font-semibold',
      badgeClass: 'bg-red-600 text-white border border-red-600',
      rowClass: 'bg-red-50/80',
      cardClass: 'bg-red-50 border-red-200',
    };
  }

  if (isNearLimit) {
    return {
      stock,
      label: 'Âm kho',
      extraLabel: 'Gần -100',
      display: formatStockValue(stock),
      isNegative,
      isNearLimit: true,
      isBreached: false,
      textClass: 'text-orange-700 font-bold',
      nameClass: 'text-orange-700 font-semibold',
      badgeClass: 'bg-orange-100 text-orange-800 border border-orange-200',
      rowClass: 'bg-orange-50/70',
      cardClass: 'bg-orange-50 border-orange-200',
    };
  }

  if (isNegative) {
    return {
      stock,
      label: 'Âm kho',
      display: formatStockValue(stock),
      isNegative,
      isNearLimit: false,
      isBreached: false,
      textClass: 'text-red-600 font-bold',
      nameClass: 'text-red-600 font-semibold',
      badgeClass: 'bg-red-100 text-red-700 border border-red-200',
      rowClass: 'bg-red-50/60',
      cardClass: 'bg-red-50 border-red-200',
    };
  }

  if (stock === 0) {
    return {
      stock,
      label: 'Tồn 0',
      display: formatStockValue(stock),
      isNegative: false,
      isNearLimit: false,
      isBreached: false,
      textClass: 'text-gray-600 font-semibold',
      nameClass: 'text-gray-800',
      badgeClass: 'bg-gray-100 text-gray-700 border border-gray-200',
      rowClass: '',
      cardClass: 'bg-white border-gray-200',
    };
  }

  if (stock < 5) {
    return {
      stock,
      label: 'Sắp hết',
      display: formatStockValue(stock),
      isNegative: false,
      isNearLimit: false,
      isBreached: false,
      textClass: 'text-red-600 font-semibold',
      nameClass: 'text-gray-800',
      badgeClass: 'bg-red-100 text-red-700 border border-red-200',
      rowClass: '',
      cardClass: 'bg-white border-gray-200',
    };
  }

  if (stock < 30) {
    return {
      stock,
      label: 'Còn ít',
      display: formatStockValue(stock),
      isNegative: false,
      isNearLimit: false,
      isBreached: false,
      textClass: 'text-yellow-700 font-semibold',
      nameClass: 'text-gray-800',
      badgeClass: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
      rowClass: '',
      cardClass: 'bg-white border-gray-200',
    };
  }

  return {
    stock,
    label: 'Còn hàng',
    display: formatStockValue(stock),
    isNegative: false,
    isNearLimit: false,
    isBreached: false,
    textClass: 'text-green-600 font-semibold',
    nameClass: 'text-gray-800',
    badgeClass: 'bg-green-100 text-green-700 border border-green-200',
    rowClass: '',
    cardClass: 'bg-white border-gray-200',
  };
}

function aggregateSaleLines(lines = []) {
  const quantities = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const productId = getSaleLineProductId(line);
    if (!productId) continue;
    const quantity = getSaleLineQuantity(line);
    if (quantity <= 0) continue;
    quantities.set(productId, roundStock((quantities.get(productId) || 0) + quantity));
  }
  return quantities;
}

function getFallbackLineStock(line = {}) {
  const candidates = [
    line.current_stock,
    line.currentStock,
    line.max_stock,
    line.stock,
    line.available_quantity,
    line.availableQuantity,
  ];
  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

export function buildSaleStockValidation(lines = [], options = {}) {
  const currentLines = Array.isArray(lines) ? lines : [];
  const baselineLines = Array.isArray(options.baselineLines) ? options.baselineLines : [];
  const getProductStockById = typeof options.getProductStockById === 'function' ? options.getProductStockById : null;
  const requestedByProductId = aggregateSaleLines(currentLines);
  const baselineByProductId = aggregateSaleLines(baselineLines);
  const stockByProductId = new Map();
  const lineKeysByProductId = new Map();

  const rememberLineKey = (productId, line, index) => {
    if (!lineKeysByProductId.has(productId)) lineKeysByProductId.set(productId, new Set());
    const key = typeof options.getLineKey === 'function'
      ? options.getLineKey(line, index)
      : (line?.id ?? `${productId}:${index}`);
    lineKeysByProductId.get(productId).add(String(key));
  };

  const rememberStock = (productId, line) => {
    if (!productId || stockByProductId.has(productId)) return;
    const externalStock = getProductStockById ? getProductStockById(productId, line) : undefined;
    const stock = Number.isFinite(Number(externalStock)) ? Number(externalStock) : getFallbackLineStock(line);
    if (Number.isFinite(Number(stock))) stockByProductId.set(productId, Number(stock));
  };

  currentLines.forEach((line, index) => {
    const productId = getSaleLineProductId(line);
    if (!productId) return;
    rememberLineKey(productId, line, index);
    rememberStock(productId, line);
  });

  baselineLines.forEach(line => {
    const productId = getSaleLineProductId(line);
    if (!productId) return;
    rememberStock(productId, line);
  });

  const productIds = new Set([
    ...requestedByProductId.keys(),
    ...baselineByProductId.keys(),
  ]);
  const productStates = new Map();
  const invalidProductIds = new Set();
  const invalidLineKeys = new Set();
  const errors = [];

  productIds.forEach(productId => {
    const currentStock = roundStock(stockByProductId.has(productId) ? stockByProductId.get(productId) : 0);
    const requestedQuantity = roundStock(requestedByProductId.get(productId) || 0);
    const baselineQuantity = roundStock(baselineByProductId.get(productId) || 0);
    const projectedStock = roundStock(currentStock + baselineQuantity - requestedQuantity);
    const invalid = projectedStock < NEGATIVE_STOCK_LIMIT;
    const nearLimit = projectedStock <= NEGATIVE_STOCK_WARNING_THRESHOLD && projectedStock >= NEGATIVE_STOCK_LIMIT;
    const state = {
      productId,
      currentStock,
      requestedQuantity,
      baselineQuantity,
      projectedStock,
      invalid,
      nearLimit,
      message: invalid
        ? `${NEGATIVE_STOCK_LIMIT_MESSAGE}. Dự kiến ${formatStockValue(projectedStock)}.`
        : '',
    };
    productStates.set(productId, state);

    if (invalid) {
      invalidProductIds.add(productId);
      errors.push(state);
      for (const key of lineKeysByProductId.get(productId) || []) invalidLineKeys.add(key);
    }
  });

  return {
    hasInvalid: errors.length > 0,
    errors,
    firstError: errors[0] || null,
    productStates,
    invalidProductIds,
    invalidLineKeys,
    summaryMessage: errors.length > 0
      ? `${NEGATIVE_STOCK_LIMIT_MESSAGE}. ${errors.length} sản phẩm vượt ngưỡng.`
      : '',
  };
}

export function getSaleStockStateForLine(validation, line = {}) {
  const productId = getSaleLineProductId(line);
  if (!productId || !validation?.productStates) return null;
  return validation.productStates.get(productId) || null;
}
