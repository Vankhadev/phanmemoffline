export const NEGATIVE_STOCK_SETTINGS_STORAGE_KEY = 'kha_negative_stock_settings';
export const NEGATIVE_STOCK_SETTINGS_UPDATED_EVENT = 'kha-negative-stock-settings-updated';
export const NEGATIVE_STOCK_INPUT_PLACEHOLDER = 'Nhập số lượng xuất âm';

export function getRuntimeDefaultNegativeStockSettings() {
  return readCachedNegativeStockSettings() || DEFAULT_NEGATIVE_STOCK_SETTINGS;
}

export const DEFAULT_NEGATIVE_STOCK_LIMIT = 10;

export const DEFAULT_NEGATIVE_STOCK_SETTINGS = Object.freeze({
  enabled: false,
  negative_stock_enabled: false,
  limit: DEFAULT_NEGATIVE_STOCK_LIMIT,
  negative_stock_limit: DEFAULT_NEGATIVE_STOCK_LIMIT,
  minimumAllowedStock: 0,
  minimum_allowed_stock: 0,
  runtime_minimum_stock: 0,
  warningThreshold: 0,
  warning_threshold: 0,
});

// Legacy export giữ để tương thích import cũ; UI runtime nên dùng getRuntimeDefaultNegativeStockSettings().
export const NEGATIVE_STOCK_LIMIT = DEFAULT_NEGATIVE_STOCK_SETTINGS.minimumAllowedStock;
export const NEGATIVE_STOCK_WARNING_THRESHOLD = DEFAULT_NEGATIVE_STOCK_SETTINGS.warningThreshold;

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function hasNegativeStockSettingFields(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return [
    'negative_stock_enabled',
    'negativeStockEnabled',
    'allow_negative_stock',
    'allowNegativeStock',
    'negative_stock_limit',
    'negativeStockLimit',
    'minimum_allowed_stock',
    'runtime_minimum_stock',
    'minimumAllowedStock',
    'runtimeMinimumStock',
    'limit',
    'enabled',
  ].some(key => Object.prototype.hasOwnProperty.call(value, key));
}

function unwrapSettingsPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return {};
  if (hasNegativeStockSettingFields(payload)) return payload;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    if (hasNegativeStockSettingFields(payload.data)) return payload.data;
    if (hasNegativeStockSettingFields(payload.data.settings)) return payload.data.settings;
    if (hasNegativeStockSettingFields(payload.data.item)) return payload.data.item;
  }
  if (hasNegativeStockSettingFields(payload.inventory)) return payload.inventory;
  if (hasNegativeStockSettingFields(payload.negativeStock)) return payload.negativeStock;
  if (hasNegativeStockSettingFields(payload.settings)) return payload.settings;
  if (hasNegativeStockSettingFields(payload.item)) return payload.item;
  return payload;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on', 'enabled', 'active', 'bật', 'bat'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off', 'disabled', 'inactive', 'tắt', 'tat'].includes(normalized)) return false;
  return fallback;
}

function normalizeLimitQuantity(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.trunc(Math.abs(number)));
}

function normalizeMinimumStockValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function formatPlainNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('vi-VN');
}

export function toStockNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function parseStockInputNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(number) ? number : fallback;
}

export function roundStock(value) {
  const number = toStockNumber(value, 0);
  return Math.round((number + Number.EPSILON) * 10) / 10;
}

export function formatStockValue(value) {
  return `Tồn: ${roundStock(value).toLocaleString('vi-VN')}`;
}

export function normalizeNegativeStockSettings(payload = {}) {
  const raw = unwrapSettingsPayload(payload);
  const rawMinimum = normalizeMinimumStockValue(firstDefined(
    raw.minimum_allowed_stock,
    raw.runtime_minimum_stock,
    raw.minimumAllowedStock,
    raw.runtimeMinimumStock,
    raw.min_stock,
    raw.minStock,
  ));

  const enabledRaw = firstDefined(
    raw.negative_stock_enabled,
    raw.negativeStockEnabled,
    raw.allow_negative_stock,
    raw.allowNegativeStock,
    raw.enabled,
    raw.active,
  );
  const inferredEnabled = rawMinimum !== null && rawMinimum < 0;
  const enabled = normalizeBoolean(enabledRaw, inferredEnabled);

  const limitRaw = firstDefined(
    raw.negative_stock_limit,
    raw.negativeStockLimit,
    raw.max_negative_stock,
    raw.maxNegativeStock,
    raw.negative_stock_max_quantity,
    raw.negativeStockMaxQuantity,
    raw.limit,
  );
  const inferredLimit = rawMinimum !== null && rawMinimum < 0 ? Math.abs(rawMinimum) : DEFAULT_NEGATIVE_STOCK_SETTINGS.limit;
  const limit = normalizeLimitQuantity(limitRaw, inferredLimit);
  const minimumAllowedStock = enabled ? -limit : 0;
  const warningThreshold = enabled && limit > 0
    ? -Math.max(1, Math.floor(limit * 0.8))
    : 0;

  return {
    enabled,
    active: enabled,
    negative_stock_enabled: enabled,
    negativeStockEnabled: enabled,
    limit,
    negative_stock_limit: limit,
    negativeStockLimit: limit,
    minimumAllowedStock,
    minimum_allowed_stock: minimumAllowedStock,
    runtime_minimum_stock: minimumAllowedStock,
    runtimeMinimumStock: minimumAllowedStock,
    warningThreshold,
    warning_threshold: warningThreshold,
  };
}

export function getNegativeStockAdminLimit(settings = getRuntimeDefaultNegativeStockSettings()) {
  return normalizeNegativeStockSettings(settings).limit;
}

export function getNegativeStockMinimumAllowed(settings = getRuntimeDefaultNegativeStockSettings()) {
  return normalizeNegativeStockSettings(settings).minimumAllowedStock;
}

export function getNegativeStockWarningThreshold(settings = getRuntimeDefaultNegativeStockSettings()) {
  return normalizeNegativeStockSettings(settings).warningThreshold;
}

export function getNegativeStockLimitLabel(settings = getRuntimeDefaultNegativeStockSettings()) {
  const normalized = normalizeNegativeStockSettings(settings);
  return normalized.enabled && normalized.limit > 0
    ? `-${formatPlainNumber(normalized.limit)}`
    : '0';
}

export function getNegativeStockAdminLimitLabel(settings = getRuntimeDefaultNegativeStockSettings()) {
  return formatPlainNumber(getNegativeStockAdminLimit(settings));
}

export function getNegativeStockCurrentLimitText(settings = getRuntimeDefaultNegativeStockSettings()) {
  const normalized = normalizeNegativeStockSettings(settings);
  return normalized.enabled
    ? `Giới hạn hiện tại: ${formatPlainNumber(normalized.limit)} (tồn tối thiểu ${getNegativeStockLimitLabel(normalized)})`
    : `Giới hạn hiện tại: ${formatPlainNumber(normalized.limit)}; xuất âm đang tắt nên tồn tối thiểu là 0`;
}

export function getNegativeStockNearLimitLabel(settings = getRuntimeDefaultNegativeStockSettings()) {
  const normalized = normalizeNegativeStockSettings(settings);
  if (!normalized.enabled || normalized.limit <= 0) return '';
  return `Gần ngưỡng ${getNegativeStockLimitLabel(normalized)}`;
}

export function getNegativeStockRuntimeSummary(settings = getRuntimeDefaultNegativeStockSettings()) {
  const normalized = normalizeNegativeStockSettings(settings);
  if (!normalized.enabled || normalized.limit <= 0) {
    return 'Xuất âm đang tắt; tồn tối thiểu runtime là 0.';
  }
  return `Cho phép âm tối đa ${formatPlainNumber(normalized.limit)}; tồn tối thiểu runtime là ${getNegativeStockLimitLabel(normalized)}.`;
}

export function getNegativeStockInputHelperText(settings = getRuntimeDefaultNegativeStockSettings()) {
  const normalized = normalizeNegativeStockSettings(settings);
  if (!normalized.enabled || normalized.limit <= 0) {
    return 'Xuất âm đang tắt; tồn kho nhỏ nhất là 0.';
  }
  return `Nhập số dương hoặc số âm; tồn kho nhỏ nhất là ${getNegativeStockLimitLabel(normalized)}.`;
}

export function getNegativeStockLimitMessage(settings = getRuntimeDefaultNegativeStockSettings()) {
  const normalized = normalizeNegativeStockSettings(settings);
  if (!normalized.enabled || normalized.limit <= 0) {
    return 'Xuất âm đang tắt; tồn kho không được nhỏ hơn 0';
  }
  return `Không được xuất âm vượt quá ${getNegativeStockLimitLabel(normalized)}`;
}

export function getRuntimeNegativeStockLimitLabel() {
  return getNegativeStockLimitLabel(getRuntimeDefaultNegativeStockSettings());
}

export function getRuntimeNegativeStockNearLimitLabel() {
  return getNegativeStockNearLimitLabel(getRuntimeDefaultNegativeStockSettings());
}

export const NEGATIVE_STOCK_LIMIT_MESSAGE = getNegativeStockLimitMessage(DEFAULT_NEGATIVE_STOCK_SETTINGS);

export function getNegativeStockInputError(value, settingsOrMinimum = getRuntimeDefaultNegativeStockSettings()) {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  const number = parseStockInputNumber(value, NaN);
  if (!Number.isFinite(number)) return 'Số lượng xuất âm không hợp lệ.';

  const normalized = typeof settingsOrMinimum === 'number'
    ? { ...DEFAULT_NEGATIVE_STOCK_SETTINGS, minimumAllowedStock: Number(settingsOrMinimum), minimum_allowed_stock: Number(settingsOrMinimum), runtime_minimum_stock: Number(settingsOrMinimum), enabled: Number(settingsOrMinimum) < 0, negative_stock_enabled: Number(settingsOrMinimum) < 0, limit: Math.max(0, Math.abs(Number(settingsOrMinimum) || 0)), negative_stock_limit: Math.max(0, Math.abs(Number(settingsOrMinimum) || 0)) }
    : normalizeNegativeStockSettings(settingsOrMinimum);
  const minimumAllowedStock = Number(normalized.minimumAllowedStock);

  if (number < minimumAllowedStock) {
    return `${getNegativeStockLimitMessage(normalized)}. Giá trị nhỏ nhất là ${formatPlainNumber(minimumAllowedStock)}.`;
  }
  return '';
}

export function isNegativeStockInputInvalid(value, settingsOrMinimum = getRuntimeDefaultNegativeStockSettings()) {
  return Boolean(getNegativeStockInputError(value, settingsOrMinimum));
}

export function getStockDisplayMeta(value, settings = getRuntimeDefaultNegativeStockSettings()) {
  const config = normalizeNegativeStockSettings(settings);
  const stock = roundStock(value);
  const isNegative = stock < 0;
  const isBreached = stock < config.minimumAllowedStock;
  const isNearLimit = Boolean(
    config.enabled
    && config.limit > 0
    && stock <= config.warningThreshold
    && stock >= config.minimumAllowedStock
  );
  const nearLimitLabel = getNegativeStockNearLimitLabel(config);

  if (isBreached) {
    return {
      stock,
      label: 'Vượt giới hạn',
      extraLabel: `Dưới mức ${getNegativeStockLimitLabel(config)}`,
      display: formatStockValue(stock),
      isNegative,
      isNearLimit: false,
      isBreached: true,
      minimumAllowedStock: config.minimumAllowedStock,
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
      label: 'âm kho',
      extraLabel: nearLimitLabel,
      display: formatStockValue(stock),
      isNegative,
      isNearLimit: true,
      isBreached: false,
      minimumAllowedStock: config.minimumAllowedStock,
      textClass: 'text-red-700 font-bold',
      nameClass: 'text-red-700 font-semibold',
      badgeClass: 'bg-red-100 text-red-700 border border-red-200',
      extraBadgeClass: 'bg-orange-100 text-orange-800 border border-orange-200',
      rowClass: 'bg-red-50/70',
      cardClass: 'bg-red-50 border-red-200',
    };
  }

  if (isNegative) {
    return {
      stock,
      label: 'âm kho',
      display: formatStockValue(stock),
      isNegative,
      isNearLimit: false,
      isBreached: false,
      minimumAllowedStock: config.minimumAllowedStock,
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
      minimumAllowedStock: config.minimumAllowedStock,
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
      minimumAllowedStock: config.minimumAllowedStock,
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
      minimumAllowedStock: config.minimumAllowedStock,
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
    minimumAllowedStock: config.minimumAllowedStock,
    textClass: 'text-green-600 font-semibold',
    nameClass: 'text-gray-800',
    badgeClass: 'bg-green-100 text-green-700 border border-green-200',
    rowClass: '',
    cardClass: 'bg-white border-gray-200',
  };
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

function getComboSaleLineComponents(line = {}) {
  const candidateLists = [
    line?.items,
    line?.combo_items,
    line?.details,
    line?.metadata?.items,
    line?.metadata?.combo_items,
  ];
  return candidateLists.find(Array.isArray) || [];
}

function getComboComponentProductId(component = {}) {
  const id = Number(component?.variant_id || component?.variantId || component?.product_id || component?.productId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function getComboComponentQuantity(component = {}) {
  const quantity = Number(component?.quantity ?? component?.qty ?? component?.quantity_in_combo ?? component?.combo_quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

export function getSaleLineStockTargets(line = {}) {
  const lineQuantity = getSaleLineQuantity(line);
  if (lineQuantity <= 0) return [];

  if (isComboSaleLine(line)) {
    return getComboSaleLineComponents(line)
      .map(component => {
        const productId = getComboComponentProductId(component);
        if (!productId) return null;
        return {
          productId,
          quantity: roundStock(getComboComponentQuantity(component) * lineQuantity),
          line,
          component,
        };
      })
      .filter(target => target && target.quantity > 0);
  }

  const productId = getSaleLineProductId(line);
  return productId ? [{ productId, quantity: lineQuantity, line, component: null }] : [];
}

function aggregateSaleLines(lines = []) {
  const quantities = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    for (const target of getSaleLineStockTargets(line)) {
      const productId = Number(target.productId);
      if (!productId) continue;
      const quantity = Number(target.quantity) || 0;
      if (quantity <= 0) continue;
      quantities.set(productId, roundStock((quantities.get(productId) || 0) + quantity));
    }
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
  const settings = normalizeNegativeStockSettings(options.settings || options.negativeStockSettings || options.config || getRuntimeDefaultNegativeStockSettings());
  const minimumAllowedStock = settings.minimumAllowedStock;
  const warningThreshold = settings.warningThreshold;
  const limitMessage = getNegativeStockLimitMessage(settings);
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
    getSaleLineStockTargets(line).forEach(target => {
      const productId = Number(target.productId);
      if (!productId) return;
      rememberLineKey(productId, line, index);
      rememberStock(productId, target.component || line);
    });
  });

  baselineLines.forEach(line => {
    getSaleLineStockTargets(line).forEach(target => {
      const productId = Number(target.productId);
      if (!productId) return;
      rememberStock(productId, target.component || line);
    });
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
    const invalid = projectedStock < minimumAllowedStock;
    const nearLimit = Boolean(settings.enabled && settings.limit > 0 && projectedStock <= warningThreshold && projectedStock >= minimumAllowedStock);
    const state = {
      productId,
      currentStock,
      requestedQuantity,
      baselineQuantity,
      projectedStock,
      invalid,
      nearLimit,
      minimumAllowedStock,
      warningThreshold,
      settings,
      message: invalid
        ? `${limitMessage}. Dự kiến ${formatStockValue(projectedStock)}.`
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
    settings,
    minimumAllowedStock,
    warningThreshold,
    limitMessage,
    summaryMessage: errors.length > 0
      ? `${limitMessage}. ${errors.length} sản phẩm vượt ngưỡng.`
      : '',
  };
}

export function getSaleStockStateForLine(validation, line = {}) {
  if (!validation?.productStates) return null;
  const targets = getSaleLineStockTargets(line);
  for (const target of targets) {
    const productId = Number(target.productId);
    if (!productId) continue;
    const state = validation.productStates.get(productId);
    if (state?.invalid) return state;
  }
  for (const target of targets) {
    const productId = Number(target.productId);
    if (!productId) continue;
    const state = validation.productStates.get(productId);
    if (state) return state;
  }
  return null;
}

export function readCachedNegativeStockSettings() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(NEGATIVE_STOCK_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    return normalizeNegativeStockSettings(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}

export function cacheNegativeStockSettings(settings, options = {}) {
  const normalized = normalizeNegativeStockSettings(settings);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(NEGATIVE_STOCK_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch (_) {
    // Ignore storage errors in locked-down browser contexts.
  }

  if (options.notify !== false && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NEGATIVE_STOCK_SETTINGS_UPDATED_EVENT, {
      detail: { settings: normalized },
    }));
  }
  return normalized;
}
