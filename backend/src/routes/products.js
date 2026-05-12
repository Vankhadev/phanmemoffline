/**
 * Products API routes - CRUD đầy đủ + Variants + default categories + flexible search
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, replaceTable, now } = require('../db/database');
const { normalizeSearchText, parseKeywordList, searchFlatProducts } = require('../utils/productSearch');

function getCategories() {
  return getAll('product_categories', c => c.active !== 0);
}

function getCategoriesById() {
  return getCategories().reduce((acc, category) => {
    acc[Number(category.id)] = serializeCategory(category);
    return acc;
  }, {});
}

function serializeCategory(category) {
  if (!category) return null;
  return {
    ...category,
    keywords: parseKeywordList(category.keywords),
    aliases: parseKeywordList(category.aliases),
    active: category.active === 0 ? 0 : 1,
  };
}

function findCategoryByText(text) {
  const key = normalizeSearchText(text);
  if (!key) return null;
  return getCategories().find(category => {
    const values = [category.name, category.group_name, category.group_key, ...parseKeywordList(category.keywords), ...parseKeywordList(category.aliases)];
    return values.some(value => {
      const normalized = normalizeSearchText(value);
      return normalized && (normalized === key || normalized.includes(key) || key.includes(normalized));
    });
  }) || null;
}

function resolveDefaultCategoryId(value, categoryText, fallbackId = null) {
  const raw = value === undefined || value === null || value === '' ? null : Number(value);
  if (raw && getOne('product_categories', c => c.id === raw && c.active !== 0)) return raw;
  const matched = findCategoryByText(categoryText);
  if (matched) return matched.id;
  return fallbackId || null;
}

function enrichProduct(product, parent = null, categoriesById = getCategoriesById()) {
  if (!product) return product;
  const inheritedCategoryId = product.default_category_id || parent?.default_category_id || null;
  const category = inheritedCategoryId ? categoriesById[Number(inheritedCategoryId)] || null : null;
  return {
    ...product,
    default_category_id: inheritedCategoryId,
    default_category: category,
    category_info: category,
    category: product.category !== undefined && product.category !== null ? product.category : (parent?.category || ''),
  };
}

function activeParents() {
  return getAll('products', p => p.active !== 0 && !p.parent_id);
}

function activeVariants(parentId) {
  return getAll('products', v => v.active !== 0 && Number(v.parent_id) === Number(parentId));
}

function hasActiveVariants(parentId) {
  return activeVariants(parentId).length > 0;
}

function buildProductsTree() {
  const categoriesById = getCategoriesById();
  const all = getAll('products', p => p.active !== 0)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
  const variantsByParentId = new Map();
  const parents = [];

  for (const product of all) {
    if (!product.parent_id) {
      parents.push(product);
      continue;
    }

    const parentId = Number(product.parent_id);
    if (!variantsByParentId.has(parentId)) variantsByParentId.set(parentId, []);
    variantsByParentId.get(parentId).push(product);
  }

  return parents.map(parent => {
    const enrichedParent = enrichProduct(parent, null, categoriesById);
    const variants = variantsByParentId.get(Number(parent.id)) || [];
    return {
      ...enrichedParent,
      variants: variants.map(v => ({ ...enrichProduct(v, enrichedParent, categoriesById), is_variant: true })),
    };
  });
}

function productPayload(body, existing = {}, parent = null) {
  const categoryText = body.category !== undefined && body.category !== null
    ? String(body.category).trim()
    : (existing.category !== undefined ? existing.category : (parent?.category || ''));
  const defaultCategoryId = resolveDefaultCategoryId(
    body.default_category_id !== undefined ? body.default_category_id : existing.default_category_id,
    categoryText,
    parent?.default_category_id || null,
  );
  const payload = {
    sku: body.sku !== undefined && body.sku !== null ? String(body.sku).trim() : (existing.sku || ''),
    name: body.name !== undefined && body.name !== null ? String(body.name).trim() : (existing.name || ''),
    import_price: body.import_price !== null && body.import_price !== undefined ? parseFloat(body.import_price) || 0 : (existing.import_price || 0),
    wholesale_price: body.wholesale_price !== null && body.wholesale_price !== undefined ? parseFloat(body.wholesale_price) || 0 : (existing.wholesale_price || 0),
    retail_price: body.retail_price !== null && body.retail_price !== undefined ? parseFloat(body.retail_price) || 0 : (existing.retail_price || 0),
    vip_price: body.vip_price !== null && body.vip_price !== undefined ? parseFloat(body.vip_price) || 0 : (existing.vip_price || 0),
    stock: body.stock !== null && body.stock !== undefined ? parseInt(body.stock) || 0 : (existing.stock || 0),
    unit: body.unit ? String(body.unit).trim() : (existing.unit || parent?.unit || 'cái'),
    category: categoryText,
    default_category_id: defaultCategoryId,
    supplier_id: body.supplier_id !== undefined
      ? (body.supplier_id && body.supplier_id !== '' ? parseInt(body.supplier_id) : null)
      : (existing.supplier_id !== undefined ? existing.supplier_id : (parent?.supplier_id || null)),
  };

  const optionalFields = [
    'barcode', 'image_url', 'description', 'option1', 'option2', 'option3',
    'sapo_product_id', 'sapo_variant_id', 'sapo_parent_product_id', 'sapo_status',
    'sapo_updated_at', 'sapo_last_synced_at', 'sync_source',
  ];
  for (const field of optionalFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) payload[field] = body[field] || '';
    else if (Object.prototype.hasOwnProperty.call(existing, field)) payload[field] = existing[field];
    else if (parent && ['sapo_product_id', 'sapo_parent_product_id', 'sapo_status', 'sync_source'].includes(field) && Object.prototype.hasOwnProperty.call(parent, field)) payload[field] = parent[field] || '';
  }
  return payload;
}

const IMPORT_EXPECTED_COLUMNS = Object.freeze([
  'Loại dòng',
  'SKU',
  'Parent SKU',
  'Tên sản phẩm',
  'Tên cha',
  'Giá nhập',
  'Giá sỉ',
  'Giá lẻ',
  'Giá VIP',
  'Tồn kho',
  'Đơn vị',
  'Danh mục text',
  'Default category id',
  'Supplier id',
  'Hoạt động',
]);

const IMPORT_COLUMN_ALIASES = Object.freeze({
  row_type: ['Loại dòng', 'Loai dong', 'row_type', 'row type', 'type', 'Loại', 'Loai'],
  sku: ['SKU', 'Mã SKU', 'Ma SKU', 'Mã sản phẩm', 'Ma san pham', 'Product SKU', 'Product code', 'Mã hàng', 'Ma hang', 'sku'],
  parent_sku: ['Parent SKU', 'ParentSKU', 'parent_sku', 'parentSku', 'SKU cha', 'Mã SKU cha', 'Ma SKU cha', 'Mã cha', 'Ma cha', 'Parent code', 'SKU parent'],
  parent_name: ['Tên cha', 'Ten cha', 'Parent name', 'Tên sản phẩm cha', 'Ten san pham cha'],
  name: ['Tên sản phẩm', 'Ten san pham', 'Tên', 'Ten', 'Tên hàng', 'Ten hang', 'Tên mặt hàng', 'Ten mat hang', 'Product name', 'name'],
  import_price: ['Giá nhập', 'Gia nhap', 'Giá vốn', 'Gia von', 'Import price', 'Cost price', 'cost', 'import_price'],
  wholesale_price: ['Giá sỉ', 'Gia si', 'Giá buôn', 'Gia buon', 'Wholesale price', 'wholesale_price'],
  retail_price: ['Giá lẻ', 'Gia le', 'Giá bán', 'Gia ban', 'Đơn giá', 'Don gia', 'Retail price', 'Sale price', 'Price', 'retail_price'],
  vip_price: ['Giá VIP', 'Gia VIP', 'VIP price', 'vip_price'],
  stock: ['Tồn kho', 'Ton kho', 'SL hàng', 'SL hang', 'Số lượng', 'So luong', 'Số lượng tồn', 'So luong ton', 'Quantity', 'Qty', 'stock'],
  unit: ['Đơn vị', 'Don vi', 'ĐVT', 'DVT', 'Đơn vị tính', 'Don vi tinh', 'Unit', 'unit'],
  category: ['Danh mục text', 'Danh muc text', 'Danh mục', 'Danh muc', 'Category', 'Nhóm hàng', 'Nhom hang', 'category'],
  default_category_id: ['Default category id', 'Default category ID', 'default_category_id', 'defaultCategoryId', 'ID danh mục mặc định', 'Id danh muc mac dinh'],
  supplier_id: ['Supplier id', 'Supplier ID', 'supplier_id', 'supplierId', 'Nhà cung cấp id', 'Nha cung cap id', 'NCC id', 'ncc_id'],
  active: ['Hoạt động', 'Hoat dong', 'Active', 'active', 'Trạng thái', 'Trang thai', 'Status', 'status', 'Đang bán', 'Dang ban'],
});

function normalizeSku(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function normalizeSkuKey(value) {
  return normalizeSku(value).toLowerCase();
}

function findActiveParentBySku(sku) {
  const normalizedSku = normalizeSku(sku);
  if (!normalizedSku) return null;
  return getOne('products', p => p.active !== 0 && !p.parent_id && normalizeSku(p.sku) === normalizedSku);
}

function findSkuConflictOutsideParentFamily(sku, parentId = null) {
  const normalizedSku = normalizeSku(sku);
  if (!normalizedSku) return null;
  const numericParentId = Number(parentId);
  const hasParentId = Number.isFinite(numericParentId) && numericParentId > 0;

  return getOne('products', product => {
    if (!product || product.active === 0 || normalizeSku(product.sku) !== normalizedSku) return false;
    if (hasParentId && (Number(product.id) === numericParentId || Number(product.parent_id) === numericParentId)) return false;
    return true;
  });
}

function isPureNumericSku(value) {
  return /^\d+$/.test(normalizeSku(value));
}

function createVariantSkuGenerationError(parentSku) {
  const parentSkuText = normalizeSku(parentSku) || '(trống)';
  const err = new Error(`Không thể tự sinh SKU biến thể vì SKU cha "${parentSkuText}" không phải chuỗi số thuần`);
  err.statusCode = 400;
  return err;
}

function buildOccupiedSkuKeys(products = getAll('products'), excludeIds = []) {
  const excludedIds = new Set((excludeIds || [])
    .map(id => Number(id))
    .filter(id => Number.isFinite(id) && id > 0));

  return new Set((products || [])
    .filter(product => {
      const id = Number(product?.id);
      return !(Number.isFinite(id) && excludedIds.has(id));
    })
    .map(product => normalizeSkuKey(product?.sku))
    .filter(Boolean));
}

function generateSequentialVariantSkus(parentSku, count = 1, options = {}) {
  const parentSkuText = normalizeSku(parentSku);
  if (!isPureNumericSku(parentSkuText)) throw createVariantSkuGenerationError(parentSkuText);

  const total = Math.max(0, parseInt(count, 10) || 0);
  if (total === 0) return [];

  const occupiedSkuKeys = buildOccupiedSkuKeys(options.products || getAll('products'), options.excludeIds || []);
  const generatedSkus = [];
  const width = parentSkuText.length;
  let nextValue = BigInt(parentSkuText) + 1n;

  while (generatedSkus.length < total) {
    const rawCandidate = nextValue.toString();
    const candidate = rawCandidate.length < width ? rawCandidate.padStart(width, '0') : rawCandidate;
    const candidateKey = normalizeSkuKey(candidate);

    if (!occupiedSkuKeys.has(candidateKey)) {
      occupiedSkuKeys.add(candidateKey);
      generatedSkus.push(candidate);
    }

    nextValue += 1n;
  }

  return generatedSkus;
}

function generateNextVariantSku(parentSku, options = {}) {
  return generateSequentialVariantSkus(parentSku, 1, options)[0];
}

function reassignVariantSkusToParentSequence(parentId, parentSku, timestamp = now()) {
  const numericParentId = Number(parentId);
  if (!Number.isFinite(numericParentId) || numericParentId <= 0) return 0;

  const allProducts = getAll('products');
  const variants = allProducts
    .filter(variant => variant.active !== 0 && Number(variant.parent_id) === numericParentId)
    .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
  if (variants.length === 0 || !isPureNumericSku(parentSku)) return 0;

  const nextSkus = generateSequentialVariantSkus(parentSku, variants.length, {
    products: allProducts,
    excludeIds: variants.map(variant => variant.id),
  });
  let reassignedCount = 0;

  variants.forEach((variant, index) => {
    const nextSku = nextSkus[index];
    if (normalizeSku(variant.sku) === nextSku) return;
    update('products', variant.id, { sku: nextSku, updated_at: timestamp });
    reassignedCount++;
  });

  return reassignedCount;
}

function reassignVariantSkusInProductList(products, parentIds = null, timestamp = now()) {
  const productList = Array.isArray(products) ? products : [];
  const byId = new Map(productList.map(product => [Number(product.id), product]));
  const targetParentIds = parentIds
    ? [...parentIds].map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)
    : [...new Set(productList.map(product => Number(product?.parent_id)).filter(id => Number.isFinite(id) && id > 0))];
  let reassignedCount = 0;

  for (const parentId of targetParentIds) {
    const parent = byId.get(parentId);
    if (!parent || !isPureNumericSku(parent.sku)) continue;

    const variants = productList
      .filter(variant => variant.active !== 0 && Number(variant.parent_id) === parentId)
      .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
    if (variants.length === 0) continue;

    const nextSkus = generateSequentialVariantSkus(parent.sku, variants.length, {
      products: productList,
      excludeIds: variants.map(variant => variant.id),
    });

    variants.forEach((variant, index) => {
      const nextSku = nextSkus[index];
      if (normalizeSku(variant.sku) === nextSku) return;
      variant.sku = nextSku;
      variant.updated_at = timestamp;
      reassignedCount++;
    });
  }

  return reassignedCount;
}

function normalizeImportKey(value) {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function isImportMetadataKey(key) {
  return ['__line', '_line', 'line', 'rowNumber', '__rowNum__'].includes(String(key));
}

function getImportCell(row, keys) {
  if (!row || typeof row !== 'object') return '';
  let firstBlankValue;

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = row[key];
    if (hasImportValue(value)) return value;
    if (firstBlankValue === undefined) firstBlankValue = value;
  }

  const normalizedKeys = keys.map(key => normalizeImportKey(key));
  for (const [actualKey, value] of Object.entries(row)) {
    if (!normalizedKeys.includes(normalizeImportKey(actualKey))) continue;
    if (hasImportValue(value)) return value;
    if (firstBlankValue === undefined) firstBlankValue = value;
  }
  return firstBlankValue === undefined ? '' : firstBlankValue;
}

function hasImportValue(value) {
  return !(value === undefined || value === null || String(value).trim() === '');
}

function rowHasImportData(row) {
  if (!row || typeof row !== 'object') return false;
  return Object.entries(row).some(([key, value]) => !isImportMetadataKey(key) && hasImportValue(value));
}

function collectReceivedColumns(rows) {
  const received = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      if (isImportMetadataKey(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      received.push(key);
    }
  }
  return received;
}

function createImportSummary(extra = {}) {
  return {
    totalRows: 0,
    validRows: 0,
    createdParents: 0,
    updatedParents: 0,
    createdVariants: 0,
    updatedVariants: 0,
    errors: 0,
    ...extra,
  };
}

function normalizeSingleNumericSeparator(raw, separator) {
  const parts = raw.split(separator);
  if (parts.length <= 1) return raw;
  if (parts.length > 2 && parts.slice(1).every(part => /^\d{3}$/.test(part))) return parts.join('');
  if (parts.length === 2) {
    const [left, right] = parts;
    if (/^\d{3}$/.test(right)) return `${left}${right}`;
    return `${left}.${right}`;
  }
  return raw.replace(new RegExp(`\\${separator}`, 'g'), '');
}

function parseImportNumber(value, fieldLabel, line, errors) {
  if (!hasImportValue(value)) return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      errors.push({ line, field: fieldLabel, message: `${fieldLabel} phải là số không âm` });
      return undefined;
    }
    return value;
  }

  let raw = String(value)
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/[−–—]/g, '-');
  if (!raw) return undefined;

  const isParenthesesNegative = /^\(.*\)$/.test(raw);
  raw = raw.replace(/\s+/g, '').replace(/[^0-9,.-]/g, '');
  if (isParenthesesNegative && !raw.startsWith('-')) raw = `-${raw}`;

  if (!raw || raw === '-') {
    errors.push({ line, field: fieldLabel, message: `${fieldLabel} sai định dạng số` });
    return undefined;
  }

  const minusCount = (raw.match(/-/g) || []).length;
  if (minusCount > 1 || (raw.includes('-') && !raw.startsWith('-'))) {
    errors.push({ line, field: fieldLabel, message: `${fieldLabel} sai định dạng số` });
    return undefined;
  }

  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    raw = lastComma > lastDot
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (lastComma >= 0) {
    raw = normalizeSingleNumericSeparator(raw, ',');
  } else if (lastDot >= 0) {
    raw = normalizeSingleNumericSeparator(raw, '.');
  }
  raw = raw.replace(/,/g, '');

  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    errors.push({ line, field: fieldLabel, message: `${fieldLabel} sai định dạng số` });
    return undefined;
  }

  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    errors.push({ line, field: fieldLabel, message: `${fieldLabel} phải là số không âm` });
    return undefined;
  }
  return n;
}

function parseImportInteger(value, fieldLabel, line, errors) {
  const n = parseImportNumber(value, fieldLabel, line, errors);
  if (n === undefined) return undefined;
  if (!Number.isInteger(n)) {
    errors.push({ line, field: fieldLabel, message: `${fieldLabel} phải là số nguyên không âm` });
    return undefined;
  }
  return n;
}

function parseImportId(value, fieldLabel, line, errors, validator) {
  if (!hasImportValue(value)) return undefined;
  const id = parseImportInteger(value, fieldLabel, line, errors);
  if (id === undefined) return undefined;
  if (!Number.isSafeInteger(id) || id <= 0) {
    errors.push({ line, field: fieldLabel, message: `${fieldLabel} không hợp lệ` });
    return undefined;
  }
  if (validator && !validator(id)) {
    errors.push({ line, field: fieldLabel, message: `${fieldLabel} ${id} không tồn tại hoặc đã bị khóa` });
    return undefined;
  }
  return id;
}

function parseImportBoolean(value, fieldLabel, line, errors) {
  if (!hasImportValue(value)) return undefined;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') {
    if (value === 1) return 1;
    if (value === 0) return 0;
  }

  const key = normalizeImportKey(value);
  const activeValues = new Set(['1', 'true', 'yes', 'y', 'co', 'c', 'active', 'hoatdong', 'danghoatdong', 'dangban', 'ban', 'mo', 'bat', 'on']);
  const inactiveValues = new Set(['0', 'false', 'no', 'n', 'khong', 'k', 'inactive', 'khonghoatdong', 'ngunghoatdong', 'tamngung', 'ngungban', 'khoa', 'tat', 'off']);
  if (activeValues.has(key)) return 1;
  if (inactiveValues.has(key)) return 0;

  errors.push({ line, field: fieldLabel, message: `${fieldLabel} chỉ nhận Có/Không, 1/0, true/false hoặc để trống` });
  return undefined;
}

function getImportLine(row, index) {
  for (const key of ['__line', '_line', 'line', 'rowNumber']) {
    const value = Number(row?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const xlsxRowNumber = Number(row?.__rowNum__);
  if (Number.isFinite(xlsxRowNumber) && xlsxRowNumber >= 0) return xlsxRowNumber + 1;
  return index + 2;
}

function parseImportRowType(typeRaw, parentSku) {
  if (!hasImportValue(typeRaw)) return parentSku ? 'VARIANT' : 'PARENT';
  const key = normalizeImportKey(typeRaw);
  const parentTypes = new Set(['parent', 'p', 'cha', 'hangcha', 'sanpham', 'sanphamcha', 'productparent', 'parentproduct', 'main', 'goc', 'dongcha']);
  const variantTypes = new Set(['variant', 'v', 'bienthe', 'con', 'hangcon', 'sanphamcon', 'productvariant', 'variantproduct', 'child', 'variation', 'dongcon']);
  if (parentTypes.has(key)) return 'PARENT';
  if (variantTypes.has(key)) return 'VARIANT';
  return '';
}

function normalizeExcelImportRow(row, index, errors) {
  const line = getImportLine(row, index);
  const typeRaw = getImportCell(row, IMPORT_COLUMN_ALIASES.row_type);
  const parentSku = normalizeSku(getImportCell(row, IMPORT_COLUMN_ALIASES.parent_sku));
  const type = parseImportRowType(typeRaw, parentSku);
  const sku = normalizeSku(getImportCell(row, IMPORT_COLUMN_ALIASES.sku));
  const name = String(getImportCell(row, IMPORT_COLUMN_ALIASES.name) || '').trim();
  const parentName = String(getImportCell(row, IMPORT_COLUMN_ALIASES.parent_name) || '').trim();
  const category = String(getImportCell(row, IMPORT_COLUMN_ALIASES.category) || '').trim();
  const unit = String(getImportCell(row, IMPORT_COLUMN_ALIASES.unit) || '').trim();

  if (!type) errors.push({ line, field: 'Loại dòng', message: `Loại dòng "${typeRaw}" không hợp lệ, chỉ nhận PARENT/VARIANT hoặc bỏ trống để tự suy luận` });
  if (!sku) errors.push({ line, field: 'SKU', message: 'Thiếu SKU' });
  if (type === 'VARIANT' && !parentSku) errors.push({ line, field: 'Parent SKU', message: 'Variant thiếu Parent SKU' });
  if (type === 'PARENT' && parentSku) errors.push({ line, field: 'Parent SKU', message: 'Parent SKU phải để trống với dòng PARENT' });

  const numericErrors = [];
  const parsed = {
    line,
    rowIndex: index,
    type,
    sku,
    parentSku,
    parentName,
    name,
    import_price: parseImportNumber(getImportCell(row, IMPORT_COLUMN_ALIASES.import_price), 'Giá nhập', line, numericErrors),
    wholesale_price: parseImportNumber(getImportCell(row, IMPORT_COLUMN_ALIASES.wholesale_price), 'Giá sỉ', line, numericErrors),
    retail_price: parseImportNumber(getImportCell(row, IMPORT_COLUMN_ALIASES.retail_price), 'Giá lẻ', line, numericErrors),
    vip_price: parseImportNumber(getImportCell(row, IMPORT_COLUMN_ALIASES.vip_price), 'Giá VIP', line, numericErrors),
    stock: parseImportInteger(getImportCell(row, IMPORT_COLUMN_ALIASES.stock), 'Tồn kho', line, numericErrors),
    unit,
    category,
    default_category_id: parseImportId(getImportCell(row, IMPORT_COLUMN_ALIASES.default_category_id), 'Default category id', line, numericErrors, id => Boolean(getOne('product_categories', c => c.id === id && c.active !== 0))),
    supplier_id: parseImportId(getImportCell(row, IMPORT_COLUMN_ALIASES.supplier_id), 'Supplier id', line, numericErrors),
    active: parseImportBoolean(getImportCell(row, IMPORT_COLUMN_ALIASES.active), 'Hoạt động', line, numericErrors),
  };
  errors.push(...numericErrors);
  return parsed;
}

function buildExcelImportPayload(row, existing = {}, parent = null) {
  const body = { sku: row.sku };
  if (row.name) body.name = row.name;
  for (const field of ['import_price', 'wholesale_price', 'retail_price', 'vip_price', 'stock', 'default_category_id', 'supplier_id']) {
    if (row[field] !== undefined) body[field] = row[field];
  }
  if (row.unit) body.unit = row.unit;
  if (row.category) body.category = row.category;
  return productPayload(body, existing, parent);
}

function csvEscape(value) {
  let text = value === undefined || value === null ? '' : String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

// ─────────────────────────────────────────────
//  GET /api/products
//  → Danh sách sản phẩm cha; nếu có ?search trả flat search results
// ─────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const categoriesById = getCategoriesById();

    if (search) {
      const rows = searchFlatProducts(getAll('products', p => p.active !== 0), search, categoriesById)
        .slice(0, 100)
        .map(row => {
          const parent = row.parent ? enrichProduct(row.parent, null, categoriesById) : null;
          const enriched = enrichProduct(row, parent, categoriesById);
          delete enriched.parent;
          return { ...enriched, parent };
        });
      return res.json(rows);
    }

    const parents = activeParents()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'))
      .map(p => {
        const variants = activeVariants(p.id);
        const totalStock = variants.length > 0
          ? variants.reduce((s, v) => s + (v.stock || 0), 0)
          : (p.stock || 0);
        return { ...enrichProduct(p, null, categoriesById), stock: totalStock, variant_count: variants.length };
      });
    res.json(parents);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lấy danh sách sản phẩm', detail: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/products/search?q=...
//  → Search flat parent + variant, dùng chung cho ô tìm nhanh
// ─────────────────────────────────────────────
router.get('/search', (req, res) => {
  try {
    const q = String(req.query.q || req.query.search || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 100, 300);
    const categoriesById = getCategoriesById();
    const rows = searchFlatProducts(getAll('products', p => p.active !== 0), q, categoriesById)
      .slice(0, limit)
      .map(row => {
        const parent = row.parent ? enrichProduct(row.parent, null, categoriesById) : null;
        const enriched = enrichProduct(row, parent, categoriesById);
        delete enriched.parent;
        return { ...enriched, parent };
      });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi tìm kiếm sản phẩm', detail: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/products/all/with-variants
//  → Tất cả sản phẩm dạng tree, cha + biến thể con
// ─────────────────────────────────────────────
router.get('/all/with-variants', (req, res) => {
  try {
    res.json(buildProductsTree());
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lấy sản phẩm', detail: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/products/export
//  → Export tất cả sản phẩm ra CSV
// ─────────────────────────────────────────────
router.get('/export', (req, res) => {
  try {
    const products = getAll('products', p => p.active !== 0);
    const byId = new Map(products.map(product => [product.id, product]));
    const header = IMPORT_EXPECTED_COLUMNS;
    const orderedProducts = products.slice().sort((a, b) => {
      const parentA = a.parent_id ? byId.get(a.parent_id) || a : a;
      const parentB = b.parent_id ? byId.get(b.parent_id) || b : b;
      const groupCompare = String(parentA.name || parentA.sku || '').localeCompare(String(parentB.name || parentB.sku || ''), 'vi');
      if (groupCompare !== 0) return groupCompare;
      if (!a.parent_id && b.parent_id === a.id) return -1;
      if (!b.parent_id && a.parent_id === b.id) return 1;
      if (!a.parent_id && b.parent_id) return -1;
      if (a.parent_id && !b.parent_id) return 1;
      return String(a.name || a.sku || '').localeCompare(String(b.name || b.sku || ''), 'vi');
    });
    const rows = orderedProducts.map(product => {
      const parent = product.parent_id ? byId.get(product.parent_id) : null;
      const values = {
        'Loại dòng': product.parent_id ? 'VARIANT' : 'PARENT',
        SKU: product.sku || '',
        'Parent SKU': parent?.sku || '',
        'Tên sản phẩm': product.name || '',
        'Tên cha': parent?.name || '',
        'Giá nhập': product.import_price ?? '',
        'Giá sỉ': product.wholesale_price ?? '',
        'Giá lẻ': product.retail_price ?? '',
        'Giá VIP': product.vip_price ?? '',
        'Tồn kho': product.stock ?? '',
        'Đơn vị': product.unit || '',
        'Danh mục text': product.category || '',
        'Default category id': product.default_category_id ?? '',
        'Supplier id': product.supplier_id ?? '',
        'Hoạt động': product.active === 0 ? 'Không' : 'Có',
      };
      return header.map(column => csvEscape(values[column])).join(',');
    });
    const csv = [header.map(csvEscape).join(','), ...rows].join('\n');
    const filename = `products_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\ufeff' + csv);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi export CSV', detail: err.message });
  }
});

// ─────────────────────────────────────────────
//  POST /api/products/import-excel-rows
//  → Bulk import/upsert Excel rows: validate toàn bộ trước khi ghi, hỗ trợ parent + variant và đánh SKU variant theo chuỗi tăng dần khi SKU cha là số
// ─────────────────────────────────────────────
router.post('/import-excel-rows', (req, res) => {
  let receivedColumns = [];
  let summary = createImportSummary();

  try {
    const inputRows = Array.isArray(req.body) ? req.body : req.body?.rows;
    receivedColumns = collectReceivedColumns(Array.isArray(inputRows) ? inputRows : []);

    if (!Array.isArray(inputRows)) {
      return res.status(400).json({
        ok: false,
        error: 'Body import không hợp lệ',
        detail: 'Body phải là array rows hoặc object { rows: [...] } do frontend parse từ Excel gửi lên.',
        errors: [],
        expectedColumns: IMPORT_EXPECTED_COLUMNS,
        receivedColumns,
        summary,
      });
    }

    const rawRows = inputRows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row && typeof row === 'object' && rowHasImportData(row));
    summary = createImportSummary({ totalRows: rawRows.length });

    if (rawRows.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'File không có dòng dữ liệu',
        detail: 'Không tìm thấy dòng nào có dữ liệu sau khi bỏ qua dòng rỗng.',
        errors: [],
        expectedColumns: IMPORT_EXPECTED_COLUMNS,
        receivedColumns,
        summary,
      });
    }

    const errors = [];
    const rows = rawRows.map(({ row, index }) => normalizeExcelImportRow(row, index, errors));
    const parentSkuInFile = new Map();
    const variantNameInFileByParent = new Map();
    for (const row of rows) {
      if (!row.sku || !['PARENT', 'VARIANT'].includes(row.type)) continue;
      const skuKey = normalizeSkuKey(row.sku);
      if (row.type === 'PARENT') {
        if (parentSkuInFile.has(skuKey)) {
          const first = parentSkuInFile.get(skuKey);
          errors.push({ line: row.line, field: 'SKU', message: `SKU sản phẩm cha "${row.sku}" trùng trong file với dòng ${first.line}` });
        } else {
          parentSkuInFile.set(skuKey, row);
        }
        continue;
      }

      const parentKey = normalizeSkuKey(row.parentSku);
      const nameKey = normalizeSearchText(row.name);
      if (!parentKey || !nameKey) continue;
      const groupedKey = `${parentKey}::${nameKey}`;
      if (variantNameInFileByParent.has(groupedKey)) {
        const first = variantNameInFileByParent.get(groupedKey);
        errors.push({ line: row.line, field: 'Tên sản phẩm', message: `Biến thể "${row.name}" trùng tên trong cùng Parent SKU với dòng ${first.line}` });
      } else {
        variantNameInFileByParent.set(groupedKey, row);
      }
    }

    const allProducts = getAll('products');
    const existingParentsBySku = new Map(allProducts.filter(product => product.sku && !product.parent_id).map(product => [normalizeSkuKey(product.sku), product]));
    const existingVariantsBySku = new Map(allProducts.filter(product => product.sku && product.parent_id).map(product => [normalizeSkuKey(product.sku), product]));

    for (const row of rows) {
      if (!row.sku || !['PARENT', 'VARIANT'].includes(row.type)) continue;
      const skuKey = normalizeSkuKey(row.sku);

      if (row.type === 'PARENT') {
        const existingParent = existingParentsBySku.get(skuKey);
        const skuBelongsToVariantOnly = existingVariantsBySku.has(skuKey) && !existingParent;
        if (skuBelongsToVariantOnly) {
          errors.push({
            line: row.line,
            field: 'SKU',
            message: `SKU "${row.sku}" đang thuộc một biến thể không có sản phẩm cha cùng SKU, không thể import như PARENT`,
          });
        } else if (!existingParent && !row.name) {
          errors.push({ line: row.line, field: 'Tên sản phẩm', message: 'Thiếu Tên sản phẩm cho SKU sản phẩm cha mới' });
        }
        continue;
      }

      const parentKey = normalizeSkuKey(row.parentSku);
      if (!parentKey) continue;

      const parentInFile = parentSkuInFile.get(parentKey);
      const parentInDb = existingParentsBySku.get(parentKey);
      if (!parentInFile && !parentInDb) {
        errors.push({ line: row.line, field: 'Parent SKU', message: `Parent SKU "${row.parentSku}" không tồn tại trong DB hoặc cùng file` });
      } else if (parentInDb && parentInDb.active === 0) {
        errors.push({ line: row.line, field: 'Parent SKU', message: `Parent SKU "${row.parentSku}" đang bị khóa; hãy import thêm dòng PARENT tương ứng để kích hoạt lại` });
      }

      const legacyExistingVariant = skuKey !== parentKey ? existingVariantsBySku.get(skuKey) : null;
      if (!legacyExistingVariant && !row.name) {
        errors.push({ line: row.line, field: 'Tên sản phẩm', message: 'Thiếu Tên sản phẩm cho biến thể mới hoặc biến thể không còn định danh riêng bằng SKU' });
      }
    }

    if (errors.length > 0) {
      const errorLines = new Set(errors.map(error => error.line).filter(Boolean));
      summary = createImportSummary({
        totalRows: rawRows.length,
        validRows: Math.max(0, rawRows.length - errorLines.size),
        errors: errors.length,
      });
      return res.status(400).json({
        ok: false,
        error: `File có ${errors.length} lỗi, chưa ghi dữ liệu`,
        detail: 'Dữ liệu chưa được ghi vì import cần validate thành công toàn bộ để giữ quan hệ sản phẩm cha - biến thể.',
        errors,
        expectedColumns: IMPORT_EXPECTED_COLUMNS,
        receivedColumns,
        summary,
        results: summary,
      });
    }

    const nextProducts = getAll('products').map(product => ({ ...product }));
    let nextId = nextProducts.reduce((max, product) => Math.max(max, Number(product.id) || 0), 0) + 1;
    const parentBySku = new Map(nextProducts.filter(product => product.sku && !product.parent_id).map(product => [normalizeSkuKey(product.sku), product]));
    const variantByLegacySku = new Map(nextProducts.filter(product => product.sku && product.parent_id).map(product => [normalizeSkuKey(product.sku), product]));
    const byId = new Map(nextProducts.map(product => [product.id, product]));
    summary = createImportSummary({ totalRows: rawRows.length, validRows: rows.length });
    const timestamp = now();

    const parentRows = rows.filter(row => row.type === 'PARENT');
    const variantRows = rows.filter(row => row.type === 'VARIANT');

    const touchedParentIds = new Set();

    for (const row of parentRows) {
      const key = normalizeSkuKey(row.sku);
      const existing = parentBySku.get(key);
      const payload = buildExcelImportPayload(row, existing || {}, null);
      const rowActive = row.active === undefined ? 1 : row.active;
      if (existing) {
        Object.assign(existing, payload, { parent_id: null, active: rowActive, updated_at: timestamp });
        touchedParentIds.add(existing.id);
        summary.updatedParents++;
      } else {
        const created = {
          id: nextId++,
          ...payload,
          parent_id: null,
          active: rowActive,
          created_at: timestamp,
          updated_at: timestamp,
        };
        nextProducts.push(created);
        parentBySku.set(key, created);
        byId.set(created.id, created);
        touchedParentIds.add(created.id);
        summary.createdParents++;
      }
    }

    for (const row of variantRows) {
      const key = normalizeSkuKey(row.sku);
      const parentKey = normalizeSkuKey(row.parentSku);
      const parent = parentBySku.get(parentKey);
      if (!parent || parent.parent_id) {
        throw new Error(`Không thể liên kết variant SKU "${row.sku}" với Parent SKU "${row.parentSku}" sau validate`);
      }
      const nameKey = normalizeSearchText(row.name);
      const existingByLegacySku = key !== parentKey ? variantByLegacySku.get(key) : null;
      const existingByName = nameKey
        ? nextProducts.find(product => product.parent_id === parent.id && normalizeSearchText(product.name) === nameKey)
        : null;
      const existing = existingByLegacySku || existingByName || null;
      const currentParent = existing?.parent_id ? byId.get(existing.parent_id) : null;
      const payload = buildExcelImportPayload(row, existing || {}, parent || currentParent);
      const rowActive = row.active === undefined ? 1 : row.active;
      if (existing) {
        Object.assign(existing, payload, { parent_id: parent.id, active: rowActive, updated_at: timestamp });
        touchedParentIds.add(parent.id);
        summary.updatedVariants++;
      } else {
        const created = {
          id: nextId++,
          ...payload,
          parent_id: parent.id,
          active: rowActive,
          created_at: timestamp,
          updated_at: timestamp,
        };
        nextProducts.push(created);
        variantByLegacySku.set(key, created);
        byId.set(created.id, created);
        touchedParentIds.add(parent.id);
        summary.createdVariants++;
      }
    }

    summary.reassignedVariantSkus = 0;
    summary.syncedVariantSkus = 0;

    replaceTable('products', nextProducts);
    res.json({
      ok: true,
      error: null,
      detail: 'Dữ liệu đã được validate toàn bộ và ghi thành công, giữ đúng quan hệ sản phẩm cha - biến thể theo SKU.',
      errors: [],
      message: 'Import Excel thành công',
      expectedColumns: IMPORT_EXPECTED_COLUMNS,
      receivedColumns,
      summary,
      results: summary,
    });
  } catch (err) {
    console.error('[KHA IMPORT EXCEL] Unexpected error:', err);
    res.status(500).json({
      ok: false,
      error: 'Lỗi khi import Excel sản phẩm',
      detail: err.message,
      errors: [],
      expectedColumns: IMPORT_EXPECTED_COLUMNS,
      receivedColumns,
      summary,
    });
  }
});

// ─────────────────────────────────────────────
//  GET /api/products/:id
//  → Lấy 1 sản phẩm (cha hoặc variant)
// ─────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const product = getOne('products', p => p.id === id && p.active !== 0);
    if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

    const categoriesById = getCategoriesById();
    const parent = product.parent_id ? getOne('products', p => p.id === product.parent_id && p.active !== 0) : null;
    const enrichedProduct = enrichProduct(product, parent, categoriesById);

    let variants = [];
    if (!product.parent_id) {
      variants = activeVariants(id)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'))
        .map(v => enrichProduct(v, enrichedProduct, categoriesById));
    }

    res.json({ ...enrichedProduct, variants });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lấy sản phẩm', detail: err.message });
  }
});

// ─────────────────────────────────────────────
//  POST /api/products
//  → Tạo sản phẩm cha MỚI hoặc CẬP NHẬT nếu SKU đã tồn tại (upsert)
// ─────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { sku, name } = req.body;
    if (!sku) return res.status(400).json({ error: 'Mã SKU không được để trống' });
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Tên sản phẩm không được để trống' });

    const trimmedSku = normalizeSku(sku);
    const existing = findActiveParentBySku(trimmedSku);
    const skuConflict = findSkuConflictOutsideParentFamily(trimmedSku, existing?.id || null);
    if (skuConflict) return res.status(400).json({ error: `SKU "${trimmedSku}" đã được sử dụng bởi sản phẩm khác` });

    const nowTime = now();
    const finalData = {
      ...productPayload({ ...req.body, sku: trimmedSku }, existing || {}),
      parent_id: null,
      active: existing ? existing.active : 1,
      updated_at: nowTime,
    };

    if (existing) {
      const parentSkuChanged = normalizeSku(existing.sku) !== normalizeSku(finalData.sku);
      update('products', existing.id, finalData);
      const reassignedVariantSkus = parentSkuChanged ? reassignVariantSkusToParentSequence(existing.id, finalData.sku, nowTime) : 0;
      res.json({ ok: true, id: existing.id, message: 'Cập nhật sản phẩm thành công', action: 'updated', syncedVariants: reassignedVariantSkus, reassignedVariantSkus });
    } else {
      finalData.created_at = nowTime;
      const id = insert('products', finalData);
      res.json({ ok: true, id, message: 'Tạo sản phẩm thành công', action: 'created', syncedVariants: 0, reassignedVariantSkus: 0 });
    }
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lưu sản phẩm', detail: err.message });
  }
});

// ─────────────────────────────────────────────
//  PUT /api/products/:id
//  → Sửa sản phẩm cha hoặc variant
// ─────────────────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const product = getOne('products', p => p.id === id && p.active !== 0);
    if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

    const isVariant = product.parent_id != null;
    const parent = isVariant ? getOne('products', p => p.id === product.parent_id && p.active !== 0) : null;
    const parentHasVariants = !isVariant && hasActiveVariants(id);
    const requestBody = isVariant
      ? { ...req.body, sku: normalizeSku(product.sku) }
      : (parentHasVariants ? { ...req.body, sku: normalizeSku(product.sku) } : req.body);

    if (!isVariant && !parentHasVariants && req.body.sku !== undefined && req.body.sku !== null) {
      const nextSku = normalizeSku(req.body.sku);
      if (!nextSku) return res.status(400).json({ error: 'Mã SKU không được để trống' });
      if (nextSku !== (product.sku || '')) {
        const dup = findSkuConflictOutsideParentFamily(nextSku, id);
        if (dup) return res.status(400).json({ error: `SKU "${nextSku}" đã được sử dụng bởi sản phẩm khác` });
      }
    }

    const nowTime = now();
    const changes = {
      ...productPayload(requestBody, product, parent),
      updated_at: nowTime,
    };

    const parentSkuChanged = !isVariant && normalizeSku(product.sku) !== normalizeSku(changes.sku);
    update('products', id, changes);
    const reassignedVariantSkus = parentSkuChanged ? reassignVariantSkusToParentSequence(id, changes.sku, nowTime) : 0;
    res.json({ ok: true, message: 'Cập nhật sản phẩm thành công', syncedVariants: reassignedVariantSkus, reassignedVariantSkus });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi cập nhật sản phẩm', detail: err.message });
  }
});

// ─────────────────────────────────────────────
//  DELETE /api/products/:id
//  → Xóa sản phẩm (soft delete)
// ─────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const product = getOne('products', p => p.id === id && p.active !== 0);
    if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

    if (!product.parent_id) {
      const variants = getAll('products', v => v.parent_id === id);
      variants.forEach(v => update('products', v.id, { active: 0, updated_at: now() }));
    }

    update('products', id, { active: 0, updated_at: now() });
    res.json({ ok: true, message: product.parent_id ? 'Đã xóa biến thể' : 'Đã xóa sản phẩm và tất cả biến thể' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi xóa sản phẩm', detail: err.message });
  }
});

// ─────────────────────────────────────────────
//  GET /api/products/:parentId/variants
//  → Lấy danh sách variants của 1 sản phẩm cha
// ─────────────────────────────────────────────
router.get('/:parentId/variants', (req, res) => {
  try {
    const parentId = parseInt(req.params.parentId);
    const parent = getOne('products', p => p.id === parentId && p.active !== 0);
    if (!parent) return res.status(404).json({ error: 'Sản phẩm cha không tồn tại' });

    const categoriesById = getCategoriesById();
    const enrichedParent = enrichProduct(parent, null, categoriesById);
    const variants = activeVariants(parentId)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'))
      .map(v => enrichProduct(v, enrichedParent, categoriesById));

    res.json(variants);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lấy biến thể', detail: err.message });
  }
});

// ─────────────────────────────────────────────
//  POST /api/products/:parentId/variants
//  → Tạo biến thể mới cho sản phẩm cha
// ─────────────────────────────────────────────
router.post('/:parentId/variants', (req, res) => {
  try {
    const parentId = parseInt(req.params.parentId);
    const parent = getOne('products', p => p.id === parentId && p.active !== 0);
    if (!parent) return res.status(404).json({ error: 'Sản phẩm cha không tồn tại' });

    const { name } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Tên biến thể không được để trống' });

    const generatedSku = generateNextVariantSku(parent.sku);
    const payload = productPayload({ ...req.body, sku: generatedSku }, {}, parent);
    const nowTime = now();
    const id = insert('products', {
      ...payload,
      parent_id: parentId,
      active: 1,
      created_at: nowTime,
      updated_at: nowTime,
    });

    res.json({ ok: true, id, sku: payload.sku, message: 'Tạo biến thể thành công' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: 'Lỗi khi tạo biến thể', detail: err.message });
  }
});

// ─────────────────────────────────────────────
//  PUT /api/products/variants/:id
//  → Sửa biến thể
// ─────────────────────────────────────────────
router.put('/variants/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const variant = getOne('products', v => v.id === id && v.active !== 0 && v.parent_id != null);
    if (!variant) return res.status(404).json({ error: 'Không tìm thấy biến thể' });

    const parent = getOne('products', p => p.id === variant.parent_id && p.active !== 0);
    if (!parent) return res.status(400).json({ error: 'Không tìm thấy sản phẩm cha của biến thể' });

    const changes = {
      ...productPayload({ ...req.body, sku: normalizeSku(variant.sku) }, variant, parent),
      updated_at: now(),
    };

    update('products', id, changes);
    res.json({ ok: true, message: 'Cập nhật biến thể thành công' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi cập nhật biến thể', detail: err.message });
  }
});

// ─────────────────────────────────────────────
//  DELETE /api/products/variants/:id
//  → Xóa biến thể
// ─────────────────────────────────────────────
router.delete('/variants/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const variant = getOne('products', v => v.id === id && v.active !== 0 && v.parent_id != null);
    if (!variant) return res.status(404).json({ error: 'Không tìm thấy biến thể' });

    update('products', id, { active: 0, updated_at: now() });
    res.json({ ok: true, message: 'Đã xóa biến thể' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi xóa biến thể', detail: err.message });
  }
});

// ─────────────────────────────────────────────
//  POST /api/products/import
//  → Import sản phẩm từ CSV
// ─────────────────────────────────────────────
router.post('/import', (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'csv là bắt buộc' });

    const lines = csv.split('\n').map(l => l.trim()).filter(l => l && l !== '');
    if (lines.length < 2) return res.status(400).json({ error: 'CSV phải có header và ít nhất 1 dòng dữ liệu' });

    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
          else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      result.push(current.trim());
      return result;
    };

    const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[\s-]/g, '_'));
    const validFields = ['sku', 'name', 'import_price', 'wholesale_price', 'retail_price', 'vip_price', 'stock', 'unit', 'category', 'default_category_id', 'parent_id', 'supplier_id'];
    const colMap = {};
    header.forEach((h, i) => { if (validFields.includes(h)) colMap[h] = i; });

    const results = { created: 0, updated: 0, skipped: 0, errors: [] };

    for (let i = 1; i < lines.length; i++) {
      try {
        const vals = parseCSVLine(lines[i]);
        const base = {};
        for (const field of validFields) {
          if (colMap[field] !== undefined) base[field] = vals[colMap[field]];
        }
        const name = base.name || '';
        const sku = base.sku || '';
        if (!name) { results.skipped++; continue; }

        const parent = base.parent_id ? getOne('products', p => p.id === parseInt(base.parent_id) && p.active !== 0) : null;
        const payload = productPayload(base, {}, parent);
        payload.parent_id = base.parent_id ? parseInt(base.parent_id) || null : null;

        if (sku) {
          const existing = getOne('products', p => p.sku === sku && p.active !== 0);
          if (existing) {
            update('products', existing.id, { ...productPayload(base, existing, parent), updated_at: now() });
            results.updated++;
          } else {
            insert('products', { ...payload, active: 1, created_at: now(), updated_at: now() });
            results.created++;
          }
        } else {
          insert('products', { ...payload, sku: '', active: 1, created_at: now(), updated_at: now() });
          results.created++;
        }
      } catch (e) {
        results.errors.push(`Dòng ${i + 1}: ${e.message}`);
      }
    }

    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi import CSV', detail: err.message });
  }
});

module.exports = router;
