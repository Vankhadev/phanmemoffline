/**
 * Inventory API routes - read-only inventory reports.
 */
const express = require('express');
const router = express.Router();
const { getAll } = require('../db/database');
const { normalizeSearchText, parseKeywordList } = require('../utils/productSearch');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function parsePositiveInteger(value, fallback, max = Number.POSITIVE_INFINITY) {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function isInactiveAllFilter(value) {
  const normalized = normalizeSearchText(value);
  return !normalized || ['all', 'tat ca', 'tatca', 'toan bo', 'toanbo'].includes(normalized);
}

function normalizeIdValue(value) {
  const text = firstNonEmpty(value);
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : text;
}

function idEquals(left, right) {
  if (left === undefined || left === null || right === undefined || right === null) return false;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber === rightNumber;
  return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

function hasParentId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0;
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

function getCategoriesById() {
  return getAll('product_categories', category => category && category.active !== 0)
    .reduce((acc, category) => {
      acc[Number(category.id)] = serializeCategory(category);
      return acc;
    }, {});
}

function categorySearchFields(category) {
  if (!category) return [];
  return [
    category.id,
    category.name,
    category.group_name,
    category.group_key,
    ...parseKeywordList(category.keywords),
    ...parseKeywordList(category.aliases),
  ].filter(value => value !== undefined && value !== null && String(value).trim() !== '');
}

function resolveProductCategory(product, parent, categoriesById) {
  const categoryId = normalizeIdValue(product?.default_category_id) || normalizeIdValue(parent?.default_category_id);
  const categoryInfo = categoryId ? categoriesById[Number(categoryId)] || null : null;
  const categoryText = firstNonEmpty(product?.category, parent?.category, categoryInfo?.name);
  const categoryName = firstNonEmpty(categoryInfo?.name, categoryText);

  return {
    id: categoryId || null,
    name: categoryName,
    text: categoryText,
    info: categoryInfo,
  };
}

function getDefaultWarehouse() {
  const store = getAll('store_info')[0] || {};
  const id = normalizeIdValue(store.warehouse_id) || normalizeIdValue(store.store_id) || normalizeIdValue(store.id) || 1;
  const name = firstNonEmpty(store.warehouse_name, store.store_name, store.company_name, store.name, 'Kho mặc định');
  const code = firstNonEmpty(store.warehouse_code, store.store_code, store.code, 'default');
  return { id, name, code, source: store.id ? 'store_info' : 'fallback', is_default: true };
}

function resolveProductWarehouse(product, defaultWarehouse) {
  const id = normalizeIdValue(product?.warehouse_id)
    || normalizeIdValue(product?.warehouseId)
    || normalizeIdValue(product?.store_id)
    || normalizeIdValue(product?.storeId)
    || normalizeIdValue(product?.branch_id)
    || normalizeIdValue(product?.branchId)
    || normalizeIdValue(product?.location_id)
    || normalizeIdValue(product?.locationId)
    || normalizeIdValue(product?.kho_id)
    || normalizeIdValue(product?.khoId);
  const name = firstNonEmpty(
    product?.warehouse_name,
    product?.warehouseName,
    product?.store_name,
    product?.storeName,
    product?.branch_name,
    product?.branchName,
    product?.location_name,
    product?.locationName,
    product?.kho_name,
    product?.khoName,
    product?.warehouse,
    product?.kho,
  );
  const code = firstNonEmpty(
    product?.warehouse_code,
    product?.warehouseCode,
    product?.store_code,
    product?.storeCode,
    product?.branch_code,
    product?.branchCode,
    product?.location_code,
    product?.locationCode,
    product?.kho_code,
    product?.khoCode,
  );

  if (!id && !name && !code) return defaultWarehouse;
  return {
    id: id || defaultWarehouse.id || null,
    name: firstNonEmpty(name, code, defaultWarehouse.name),
    code: firstNonEmpty(code, id, defaultWarehouse.code),
    source: 'product',
    is_default: false,
  };
}

function normalizeInventoryReportQuery(query = {}) {
  const page = parsePositiveInteger(query.page, DEFAULT_PAGE);
  const limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const search = firstNonEmpty(query.search, query.q, query.keyword);
  const categoryId = normalizeIdValue(firstNonEmpty(query.category_id, query.categoryId, query.default_category_id, query.defaultCategoryId));
  const categoryText = firstNonEmpty(query.category, query.category_name, query.categoryName, query.danh_muc, query.danhMuc);
  const warehouseId = normalizeIdValue(firstNonEmpty(
    query.warehouse_id,
    query.warehouseId,
    query.store_id,
    query.storeId,
    query.branch_id,
    query.branchId,
    query.location_id,
    query.locationId,
    query.kho_id,
    query.khoId,
  ));
  const warehouseText = firstNonEmpty(query.warehouse, query.warehouse_name, query.warehouseName, query.store, query.branch, query.location, query.kho);
  const status = firstNonEmpty(query.status, query.stock_status, query.inventory_status, 'all').toLowerCase();
  const sort = firstNonEmpty(query.sort, 'product_name');
  const order = firstNonEmpty(query.order, query.direction, 'asc').toLowerCase();
  const lowStockThreshold = Math.max(0, Number.parseFloat(String(query.low_stock_threshold || query.lowStockThreshold || 5)) || 5);
  const includeInactive = ['1', 'true', 'yes'].includes(String(query.include_inactive || query.includeInactive || '').trim().toLowerCase());

  return {
    page,
    limit,
    search,
    categoryId,
    categoryText: isInactiveAllFilter(categoryText) ? '' : categoryText,
    warehouseId,
    warehouseText: isInactiveAllFilter(warehouseText) ? '' : warehouseText,
    status,
    sort,
    order,
    lowStockThreshold,
    includeInactive,
  };
}

function normalizeNegativeStockQuery(query = {}) {
  const page = parsePositiveInteger(query.page, DEFAULT_PAGE);
  const limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const search = firstNonEmpty(query.search, query.q, query.keyword);
  const categoryId = normalizeIdValue(firstNonEmpty(query.category_id, query.categoryId, query.default_category_id, query.defaultCategoryId));
  const categoryText = firstNonEmpty(query.category, query.category_name, query.categoryName, query.danh_muc, query.danhMuc);
  const warehouseId = normalizeIdValue(firstNonEmpty(
    query.warehouse_id,
    query.warehouseId,
    query.store_id,
    query.storeId,
    query.branch_id,
    query.branchId,
    query.location_id,
    query.locationId,
    query.kho_id,
    query.khoId,
  ));
  const warehouseText = firstNonEmpty(query.warehouse, query.warehouse_name, query.warehouseName, query.store, query.branch, query.location, query.kho);
  const sort = firstNonEmpty(query.sort, 'stock');
  const order = firstNonEmpty(query.order, query.direction, 'asc').toLowerCase();

  return {
    page,
    limit,
    search,
    categoryId,
    categoryText: isInactiveAllFilter(categoryText) ? '' : categoryText,
    warehouseId,
    warehouseText: isInactiveAllFilter(warehouseText) ? '' : warehouseText,
    sort,
    order,
  };
}

function productMatchesSearch(product, parent, category, search) {
  const normalizedSearch = normalizeSearchText(search);
  if (!normalizedSearch) return true;

  const fields = [
    product?.name,
    product?.sku,
    product?.code,
    product?.product_code,
    product?.barcode,
    product?.category,
    parent?.name,
    parent?.sku,
    parent?.code,
    parent?.product_code,
    parent?.barcode,
    parent?.category,
    ...categorySearchFields(category.info),
  ];
  const haystack = normalizeSearchText(fields.filter(Boolean).join(' '));
  if (!haystack) return false;

  const searchCompact = normalizedSearch.replace(/\s+/g, '');
  const haystackCompact = haystack.replace(/\s+/g, '');
  if (haystack.includes(normalizedSearch) || haystackCompact.includes(searchCompact)) return true;

  const tokens = normalizedSearch.split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every(token => haystack.includes(token) || haystackCompact.includes(token));
}

function productMatchesCategory(product, parent, category, query) {
  if (query.categoryId && idEquals(category.id, query.categoryId)) return true;
  if (query.categoryId && idEquals(product?.default_category_id, query.categoryId)) return true;
  if (query.categoryId && idEquals(parent?.default_category_id, query.categoryId)) return true;
  if (query.categoryId && !query.categoryText) return false;

  const normalizedCategory = normalizeSearchText(query.categoryText);
  if (!normalizedCategory) return true;

  const fields = [
    category.id,
    category.name,
    category.text,
    product?.category,
    parent?.category,
    ...categorySearchFields(category.info),
  ];
  const haystack = normalizeSearchText(fields.filter(Boolean).join(' '));
  const compactHaystack = haystack.replace(/\s+/g, '');
  const compactNeedle = normalizedCategory.replace(/\s+/g, '');
  return haystack.includes(normalizedCategory) || compactHaystack.includes(compactNeedle);
}

function productMatchesWarehouse(warehouse, query) {
  if (query.warehouseId && (
    idEquals(warehouse.id, query.warehouseId)
    || idEquals(warehouse.code, query.warehouseId)
  )) return true;
  if (query.warehouseId && !query.warehouseText) return false;

  const normalizedWarehouse = normalizeSearchText(query.warehouseText);
  if (!normalizedWarehouse) return true;

  const fields = [warehouse.id, warehouse.name, warehouse.code, warehouse.source].filter(Boolean).join(' ');
  const haystack = normalizeSearchText(fields);
  const compactHaystack = haystack.replace(/\s+/g, '');
  const compactNeedle = normalizedWarehouse.replace(/\s+/g, '');
  return haystack.includes(normalizedWarehouse) || compactHaystack.includes(compactNeedle);
}

function getProductCode(product) {
  return firstNonEmpty(product?.product_code, product?.code, product?.ma_san_pham, product?.ma_hang, product?.sku, product?.barcode);
}

function buildNegativeStockItem(product, parent, category, warehouse) {
  const stock = toNumber(product.stock, 0);
  const sku = firstNonEmpty(product.sku);
  const code = getProductCode(product);
  const parentSku = firstNonEmpty(parent?.sku);
  const parentName = firstNonEmpty(parent?.name);

  return {
    ...product,
    id: product.id,
    product_id: product.id,
    sku,
    product_sku: sku,
    code,
    product_code: code,
    name: firstNonEmpty(product.name),
    product_name: firstNonEmpty(product.name),
    parent_id: hasParentId(product.parent_id) ? Number(product.parent_id) : null,
    parent_sku: parentSku,
    parent_name: parentName,
    is_variant: hasParentId(product.parent_id),
    category: category.text,
    category_name: category.name,
    default_category_id: category.id,
    default_category: category.info,
    category_info: category.info,
    warehouse_id: warehouse.id,
    warehouse_name: warehouse.name,
    warehouse_code: warehouse.code,
    warehouse: warehouse.name,
    warehouse_info: warehouse,
    stock,
    on_hand: stock,
    inventory_quantity: stock,
    negative_quantity: Math.abs(stock),
    negative_stock_quantity: Math.abs(stock),
    import_price: toNumber(product.import_price, 0),
    wholesale_price: toNumber(product.wholesale_price, 0),
    retail_price: toNumber(product.retail_price, 0),
    vip_price: toNumber(product.vip_price, 0),
    unit: product.unit || parent?.unit || '',
    active: product.active === 0 ? 0 : 1,
    status: 'negative_stock',
    stock_status: 'negative_stock',
    inventory_status: 'negative_stock',
    updated_at: product.updated_at || null,
    created_at: product.created_at || null,
  };
}

function getProductCostPrice(product, parent = null) {
  return toNumber(
    product?.cost_price ?? product?.import_price ?? product?.purchase_price ?? product?.avg_cost_price ?? parent?.cost_price ?? parent?.import_price,
    0,
  );
}

function getInventoryStatus(stock, threshold) {
  if (stock < 0) return 'negative';
  if (stock === 0) return 'out';
  if (stock <= threshold) return 'low';
  return 'in_stock';
}

function getInventoryWarningLevel(status) {
  if (status === 'negative') return 'critical';
  if (status === 'out') return 'danger';
  if (status === 'low') return 'warning';
  return 'normal';
}

function buildInventoryReportItem(product, parent, category, warehouse, query) {
  const stock = toNumber(product.stock, 0);
  const costPrice = getProductCostPrice(product, parent);
  const inventoryValue = stock * costPrice;
  const status = getInventoryStatus(stock, query.lowStockThreshold);
  const sku = firstNonEmpty(product.sku);
  const code = getProductCode(product);
  return {
    id: product.id,
    product_id: product.id,
    product_code: code,
    code,
    sku,
    product_sku: sku,
    product_name: firstNonEmpty(product.name),
    name: firstNonEmpty(product.name),
    parent_id: hasParentId(product.parent_id) ? Number(product.parent_id) : null,
    parent_name: firstNonEmpty(parent?.name),
    parent_sku: firstNonEmpty(parent?.sku),
    is_variant: hasParentId(product.parent_id),
    stock,
    on_hand: stock,
    inventory_quantity: stock,
    cost_price: costPrice,
    import_price: toNumber(product.import_price, 0),
    inventory_value: Math.round(inventoryValue),
    retail_price: toNumber(product.retail_price, 0),
    wholesale_price: toNumber(product.wholesale_price, 0),
    category: category.text,
    category_name: category.name,
    default_category_id: category.id,
    category_info: category.info,
    warehouse_id: warehouse.id,
    warehouse_name: warehouse.name,
    warehouse_code: warehouse.code,
    warehouse: warehouse.name,
    warehouse_info: warehouse,
    low_stock_threshold: query.lowStockThreshold,
    status,
    stock_status: status,
    inventory_status: status,
    warning_level: getInventoryWarningLevel(status),
    active: product.active === 0 ? 0 : 1,
    unit: product.unit || parent?.unit || '',
    updated_at: product.updated_at || null,
    created_at: product.created_at || null,
  };
}

function inventoryStatusMatches(status, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'low') return status === 'low';
  if (filter === 'out') return status === 'out';
  if (filter === 'negative') return status === 'negative';
  if (filter === 'in_stock') return status === 'in_stock';
  return true;
}

function sortInventoryReportItems(items, query) {
  const sort = String(query.sort || 'product_name').trim().toLowerCase();
  const order = ['desc', 'descending', '-1'].includes(String(query.order || '').trim().toLowerCase()) ? 'desc' : 'asc';
  const direction = order === 'desc' ? -1 : 1;
  return items.sort((a, b) => {
    if (['stock', 'on_hand', 'inventory_quantity', 'cost_price', 'inventory_value', 'retail_price'].includes(sort)) {
      return direction * ((toNumber(a[sort], 0) - toNumber(b[sort], 0)) || compareText(a.product_name, b.product_name));
    }
    if (['sku', 'code', 'product_code'].includes(sort)) {
      return direction * (compareText(a.sku || a.code, b.sku || b.code) || compareText(a.product_name, b.product_name));
    }
    if (['category', 'category_name'].includes(sort)) {
      return direction * (compareText(a.category_name || a.category, b.category_name || b.category) || compareText(a.product_name, b.product_name));
    }
    if (['status', 'stock_status', 'inventory_status'].includes(sort)) {
      return direction * (compareText(a.status, b.status) || compareText(a.product_name, b.product_name));
    }
    return direction * (compareText(a.product_name, b.product_name) || compareText(a.sku, b.sku));
  });
}

function buildInventoryReportResponse(req) {
  const query = normalizeInventoryReportQuery(req.query || {});
  const categoriesById = getCategoriesById();
  const defaultWarehouse = getDefaultWarehouse();
  const products = getAll('products', product => product && (query.includeInactive || product.active !== 0));
  const parentIds = new Set(products.map(product => Number(product.parent_id)).filter(id => Number.isFinite(id) && id > 0));
  const parentById = new Map(getAll('products', product => product && parentIds.has(Number(product.id))).map(product => [Number(product.id), product]));

  const rows = products
    .map(product => {
      const parent = hasParentId(product.parent_id) ? parentById.get(Number(product.parent_id)) || null : null;
      const category = resolveProductCategory(product, parent, categoriesById);
      const warehouse = resolveProductWarehouse(product, defaultWarehouse);
      return { product, parent, category, warehouse };
    })
    .filter(row => productMatchesSearch(row.product, row.parent, row.category, query.search))
    .filter(row => productMatchesCategory(row.product, row.parent, row.category, query))
    .filter(row => productMatchesWarehouse(row.warehouse, query))
    .map(row => buildInventoryReportItem(row.product, row.parent, row.category, row.warehouse, query))
    .filter(item => inventoryStatusMatches(item.status, query.status));

  const sortedRows = sortInventoryReportItems(rows, query);
  const total = sortedRows.length;
  const offset = (query.page - 1) * query.limit;
  const items = sortedRows.slice(offset, offset + query.limit);
  const totalPages = total > 0 ? Math.ceil(total / query.limit) : 0;
  const summary = sortedRows.reduce((acc, item) => {
    acc.total_items += 1;
    acc.total_stock += item.stock;
    acc.total_inventory_value += item.inventory_value;
    if (item.status === 'low') acc.low_stock_count += 1;
    if (item.status === 'out') acc.out_of_stock_count += 1;
    if (item.status === 'negative') acc.negative_stock_count += 1;
    if (item.status === 'in_stock') acc.in_stock_count += 1;
    return acc;
  }, {
    total_items: 0,
    total_stock: 0,
    total_inventory_value: 0,
    low_stock_count: 0,
    out_of_stock_count: 0,
    negative_stock_count: 0,
    in_stock_count: 0,
  });

  return {
    ok: true,
    items,
    data: items,
    summary: {
      ...summary,
      total_stock: Math.round(summary.total_stock * 100) / 100,
      total_inventory_value: Math.round(summary.total_inventory_value),
    },
    total,
    page: query.page,
    limit: query.limit,
    total_pages: totalPages,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      total_pages: totalPages,
      has_next: query.page < totalPages,
      has_prev: query.page > 1 && total > 0,
    },
    filters: {
      search: query.search,
      category_id: query.categoryId,
      category: query.categoryText,
      warehouse_id: query.warehouseId,
      warehouse: query.warehouseText,
      status: query.status,
      low_stock_threshold: query.lowStockThreshold,
      include_inactive: query.includeInactive,
    },
    sort: { field: query.sort, order: query.order },
    generated_at: new Date().toISOString(),
    meta: {
      source_table: 'products',
      source_stock_field: 'stock',
      cost_price_fallback: 'cost_price/import_price/purchase_price/avg_cost_price',
      warehouse_fallback: defaultWarehouse,
    },
  };
}

function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''), 'vi');
}

function sortNegativeStockItems(items, query) {
  const sort = String(query.sort || 'stock').trim().toLowerCase();
  const order = ['desc', 'descending', '-1'].includes(String(query.order || '').trim().toLowerCase()) ? 'desc' : 'asc';
  const direction = order === 'desc' ? -1 : 1;

  return items.sort((a, b) => {
    if (['name', 'product_name'].includes(sort)) {
      return direction * (compareText(a.name, b.name) || compareText(a.sku, b.sku));
    }
    if (['sku', 'code', 'product_code'].includes(sort)) {
      return direction * (compareText(a.sku || a.code, b.sku || b.code) || compareText(a.name, b.name));
    }
    if (['category', 'category_name'].includes(sort)) {
      return direction * (compareText(a.category_name || a.category, b.category_name || b.category) || compareText(a.name, b.name));
    }
    if (['warehouse', 'warehouse_name'].includes(sort)) {
      return direction * (compareText(a.warehouse_name, b.warehouse_name) || (a.stock - b.stock));
    }
    if (['updated_at', 'created_at'].includes(sort)) {
      const left = new Date(a[sort] || 0).getTime() || 0;
      const right = new Date(b[sort] || 0).getTime() || 0;
      return direction * (left - right || a.stock - b.stock);
    }

    // Default: sort from deepest negative stock to nearest zero.
    return direction * ((a.stock - b.stock) || compareText(a.name, b.name) || compareText(a.sku, b.sku));
  });
}

function buildNegativeStockResponse(req) {
  const query = normalizeNegativeStockQuery(req.query || {});
  const categoriesById = getCategoriesById();
  const defaultWarehouse = getDefaultWarehouse();

  // JSON DB currently has no SQL engine; keep the stock<0 predicate inside the DB helper call
  // so later filtering/search/pagination only works on negative-stock product rows.
  const negativeProducts = getAll('products', product => (
    product
    && product.active !== 0
    && toNumber(product.stock, 0) < 0
  ));
  const parentIds = new Set(negativeProducts
    .map(product => Number(product.parent_id))
    .filter(id => Number.isFinite(id) && id > 0));
  const parentById = new Map(getAll('products', product => (
    product
    && product.active !== 0
    && parentIds.has(Number(product.id))
  )).map(product => [Number(product.id), product]));

  const rows = negativeProducts
    .map(product => {
      const parent = hasParentId(product.parent_id) ? parentById.get(Number(product.parent_id)) || null : null;
      const category = resolveProductCategory(product, parent, categoriesById);
      const warehouse = resolveProductWarehouse(product, defaultWarehouse);
      return { product, parent, category, warehouse };
    })
    .filter(row => productMatchesSearch(row.product, row.parent, row.category, query.search))
    .filter(row => productMatchesCategory(row.product, row.parent, row.category, query))
    .filter(row => productMatchesWarehouse(row.warehouse, query))
    .map(row => buildNegativeStockItem(row.product, row.parent, row.category, row.warehouse));

  const sortedRows = sortNegativeStockItems(rows, query);
  const total = sortedRows.length;
  const offset = (query.page - 1) * query.limit;
  const items = sortedRows.slice(offset, offset + query.limit);
  const totalPages = total > 0 ? Math.ceil(total / query.limit) : 0;

  return {
    ok: true,
    items,
    data: items,
    total,
    page: query.page,
    limit: query.limit,
    total_pages: totalPages,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      total_pages: totalPages,
      has_next: query.page < totalPages,
      has_prev: query.page > 1 && total > 0,
    },
    filters: {
      search: query.search,
      category_id: query.categoryId,
      category: query.categoryText,
      warehouse_id: query.warehouseId,
      warehouse: query.warehouseText,
    },
    sort: {
      field: query.sort || 'stock',
      order: query.order || 'asc',
      default: 'stock asc',
    },
    meta: {
      source_table: 'products',
      source_stock_field: 'stock',
      negative_stock_condition: 'stock < 0',
      generated_at: new Date().toISOString(),
      warehouse_fallback: defaultWarehouse,
    },
  };
}

router.get('/report', (req, res) => {
  try {
    res.json(buildInventoryReportResponse(req));
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'Lỗi khi lấy báo cáo tồn kho',
      message: 'Lỗi khi lấy báo cáo tồn kho',
      detail: err.message,
    });
  }
});

router.get('/negative-stock', (req, res) => {
  try {
    res.json(buildNegativeStockResponse(req));
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'Lỗi khi lấy danh sách âm kho',
      message: 'Lỗi khi lấy danh sách âm kho',
      detail: err.message,
    });
  }
});

module.exports = router;
