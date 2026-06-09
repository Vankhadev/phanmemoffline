import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Search, Plus, X, Save, Package, Tag, FileText, AlertCircle, CheckCircle, Building, Trash2, CreditCard, RotateCcw } from 'lucide-react';
import { SYNC_UPDATED_EVENT, apiJson, apiJsonChecked, resolveApiUrl } from '../utils/apiClient';
import { broadcastSyncUpdate } from '../utils/crossTabSync';
import { buildCategoriesById, categoryFields, getProductDisplayName, normalizeSearchText, searchFlatProducts } from '../utils/productSearch';
import QuantityStepper from '../components/QuantityStepper';

const API = resolveApiUrl('');

const SUPPLIER_CHANGE_CONFIRM_MESSAGE = 'Đổi nhà cung cấp sẽ xóa danh sách sản phẩm hiện tại. Bạn có muốn tiếp tục?';
const PRODUCT_SEARCH_LIMIT = 80;
const IMPORT_PICKER_QUANTITY_STEP = 1;

const hasImportValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';

const normalizeComparableId = (value) => (hasImportValue(value) ? String(value).trim() : '');

const isSameId = (left, right) => {
  const normalizedLeft = normalizeComparableId(left);
  const normalizedRight = normalizeComparableId(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

const firstImportValue = (...values) => values.find(hasImportValue);

const getFirstFiniteNumber = (...values) => {
  for (const value of values) {
    if (!hasImportValue(value)) continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return 0;
};

const toPayloadNumberId = (value) => {
  if (!hasImportValue(value)) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 && numberValue < 1000000000 ? numberValue : null;
};

const getSupplierRecordId = (supplier) => firstImportValue(supplier?.id, supplier?.maNCC, supplier?.supplier_id);

const getProductSupplierId = (product, parent = null) => {
  const ownSupplierId = firstImportValue(product?.supplier_id, product?.supplierId, product?.supplier?.id);
  if (hasImportValue(ownSupplierId)) return ownSupplierId;

  const parentProduct = parent || product?.parent || null;
  return firstImportValue(parentProduct?.supplier_id, parentProduct?.supplierId, parentProduct?.supplier?.id) || null;
};

const normalizeImportSearchText = (value) => normalizeSearchText(value).trim();

const compactImportSearchText = (value) => normalizeImportSearchText(value).replace(/\s+/g, '');

const normalizeImportCategoryKey = (value) => compactImportSearchText(value);

const parseImportTextList = (value) => {
  if (Array.isArray(value)) return value.flatMap(parseImportTextList);
  if (value && typeof value === 'object') {
    return [
      value.name,
      value.group_name,
      value.group_key,
      value.category,
      value.label,
      value.text,
      ...parseImportTextList(value.keywords),
      ...parseImportTextList(value.aliases),
    ].filter(hasImportValue).map(String);
  }
  return String(value || '')
    .split(/[,;\n|]+/)
    .map(item => item.trim())
    .filter(Boolean);
};

const isMeaningfulCategoryText = (value) => normalizeImportSearchText(value).length >= 3;

const IMPORT_PRODUCT_NAME_STOP_TOKENS = new Set([
  'san', 'pham', 'hang', 'loai', 'mau', 'size', 'kich', 'thuoc', 'cai', 'cay', 'bo', 'cap', 'hop', 'bich', 'goi',
  'lon', 'nho', 'dai', 'ngan', 'cao', 'thap', 'tron', 'vuong', 'cm', 'mm', 'met', 'kg', 'gam', 'dien', 'pin',
  'khong', 'can', 'co', 'va', 'voi', 'cho', 'cua', 'de', 'trong', 'ngoai', 'nhap', 'ban', 'gia', 'new', 'old'
]);

const textContainsWholeCategoryToken = (text, token) => {
  const normalizedText = normalizeImportSearchText(text);
  const normalizedToken = normalizeImportSearchText(token);
  if (!normalizedText || !normalizedToken || normalizedToken.length < 3) return false;
  return normalizedText.split(/\s+/).includes(normalizedToken);
};

const textContainsAllMeaningfulTokens = (text, tokenText) => {
  const normalizedText = normalizeImportSearchText(text);
  const normalizedTokenText = normalizeImportSearchText(tokenText);
  if (!normalizedText || !normalizedTokenText) return false;

  const textTokens = new Set(normalizedText.split(/\s+/).filter(Boolean));
  const requiredTokens = normalizedTokenText
    .split(/\s+/)
    .filter(token => token.length >= 3 && !IMPORT_PRODUCT_NAME_STOP_TOKENS.has(token));

  return requiredTokens.length > 0 && requiredTokens.every(token => textTokens.has(token));
};

const areCategoryTextsCompatible = (left, right) => {
  const normalizedLeft = normalizeImportSearchText(left);
  const normalizedRight = normalizeImportSearchText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (compactImportSearchText(normalizedLeft) === compactImportSearchText(normalizedRight)) return true;
  return textContainsWholeCategoryToken(normalizedLeft, normalizedRight) ||
    textContainsWholeCategoryToken(normalizedRight, normalizedLeft) ||
    textContainsAllMeaningfulTokens(normalizedLeft, normalizedRight) ||
    textContainsAllMeaningfulTokens(normalizedRight, normalizedLeft);
};

const getCategoryIdCandidate = (product, parent = null) => firstImportValue(
  product?.default_category_id,
  product?.category_id,
  product?.category?.id,
  product?.default_category?.id,
  product?.category_info?.id,
  parent?.default_category_id,
  parent?.category_id,
  parent?.category?.id,
  parent?.default_category?.id,
  parent?.category_info?.id,
);

const getCategoryObjectCandidate = (product, parent = null, categoriesById = {}) => {
  const categoryId = getCategoryIdCandidate(product, parent);
  if (hasImportValue(categoryId) && categoriesById[Number(categoryId)]) return categoriesById[Number(categoryId)];

  return [product?.default_category, product?.category_info, product?.category, parent?.default_category, parent?.category_info, parent?.category]
    .find(category => category && typeof category === 'object') || null;
};

const addCategoryRecordToScope = (scope, category) => {
  if (!category) return;
  const categoryId = firstImportValue(category.id, category.category_id, category.default_category_id);
  if (hasImportValue(categoryId)) scope.categoryIds.add(normalizeComparableId(categoryId));

  const groupValues = [category.group_key, category.group_name, category.group, category.parent_group].filter(hasImportValue);
  groupValues.forEach(value => {
    const normalized = normalizeImportCategoryKey(value);
    if (normalized) scope.groupKeys.add(normalized);
  });

  categoryFields(category).forEach(value => {
    const normalized = normalizeImportSearchText(value);
    if (isMeaningfulCategoryText(normalized)) scope.categoryTexts.add(normalized);
  });
};

const getProductCategoryMatchers = (product, parent = null, categoriesById = {}) => {
  const matchers = {
    categoryIds: new Set(),
    categoryTexts: new Set(),
    groupKeys: new Set(),
  };

  const categoryId = getCategoryIdCandidate(product, parent);
  if (hasImportValue(categoryId)) matchers.categoryIds.add(normalizeComparableId(categoryId));

  const categoryRecord = getCategoryObjectCandidate(product, parent, categoriesById);
  if (categoryRecord) {
    const categoryScope = { categoryIds: matchers.categoryIds, categoryTexts: matchers.categoryTexts, groupKeys: matchers.groupKeys };
    addCategoryRecordToScope(categoryScope, categoryRecord);
  }

  [product?.category, product?.default_category?.name, product?.category_info?.name, parent?.category, parent?.default_category?.name, parent?.category_info?.name]
    .filter(value => hasImportValue(value) && typeof value !== 'object')
    .forEach(value => {
      const normalized = normalizeImportSearchText(value);
      if (isMeaningfulCategoryText(normalized)) matchers.categoryTexts.add(normalized);
    });

  return matchers;
};

const collectProductCategoryIntoScope = (scope, product, parent = null, categoriesById = {}) => {
  const matchers = getProductCategoryMatchers(product, parent, categoriesById);
  matchers.categoryIds.forEach(value => scope.categoryIds.add(value));
  matchers.categoryTexts.forEach(value => scope.categoryTexts.add(value));
  matchers.groupKeys.forEach(value => scope.groupKeys.add(value));
};

const createSupplierScope = (supplier = null) => ({
  supplierId: normalizeComparableId(getSupplierRecordId(supplier)),
  categoryIds: new Set(),
  categoryTexts: new Set(),
  groupKeys: new Set(),
  productNameTokens: new Set(),
  directProductCount: 0,
  importHistoryCount: 0,
  explicitHintCount: 0,
});

const getSupplierCategoryHintValues = (supplier = {}, includeLooseHints = false) => {
  const strictFields = [
    'category', 'categories', 'default_category', 'default_category_id', 'product_category', 'product_categories',
    'group', 'groups', 'group_name', 'group_key', 'product_group', 'product_groups',
    'supplied_category', 'supplied_categories', 'supplied_group', 'supplied_groups', 'supplied_items', 'items', 'item_groups',
  ];
  const looseFields = includeLooseHints ? ['note', 'description', 'name', 'tenNCC'] : [];

  return [...strictFields, ...looseFields]
    .flatMap(field => parseImportTextList(supplier?.[field]))
    .filter(Boolean);
};

const addSupplierHintToScope = (scope, hint, categoriesById = {}, allowRawHintText = false) => {
  if (!hasImportValue(hint)) return false;
  const normalizedHint = normalizeImportSearchText(hint);
  if (!normalizedHint) return false;

  const numericHint = Number(hint);
  if (Number.isFinite(numericHint) && categoriesById[numericHint]) {
    addCategoryRecordToScope(scope, categoriesById[numericHint]);
    scope.explicitHintCount += 1;
    return true;
  }

  let matchedCatalogCategory = false;
  Object.values(categoriesById || {}).forEach(category => {
    const categoryMatches = categoryFields(category).some(value => areCategoryTextsCompatible(normalizedHint, value));
    if (!categoryMatches) return;
    addCategoryRecordToScope(scope, category);
    matchedCatalogCategory = true;
  });

  if (matchedCatalogCategory || allowRawHintText) {
    if (isMeaningfulCategoryText(normalizedHint)) scope.categoryTexts.add(normalizedHint);
    scope.explicitHintCount += 1;
    return true;
  }

  return false;
};

const extractProductNameScopeTokens = (value) => normalizeImportSearchText(value)
  .split(/\s+/)
  .filter(token => token.length >= 3 && /[a-z]/.test(token) && !IMPORT_PRODUCT_NAME_STOP_TOKENS.has(token));

const addProductNameHintToScope = (scope, name, categoriesById = {}) => {
  if (!hasImportValue(name)) return;
  const matchedCategory = addSupplierHintToScope(scope, name, categoriesById, false);
  if (matchedCategory) return;

  extractProductNameScopeTokens(name).forEach(token => scope.productNameTokens.add(token));
};

const getProductNameHintValues = (product, parent = null) => [
  product?.name,
  product?.tenSP,
  product?.product_name,
  product?.label,
  product?.text,
  parent?.name,
  parent?.tenSP,
  parent?.product_name,
  product?.parent_name,
].filter(hasImportValue);

const collectProductNameIntoScope = (scope, product, parent = null, categoriesById = {}) => {
  getProductNameHintValues(product, parent).forEach(value => addProductNameHintToScope(scope, value, categoriesById));
};

const getImportOrderSupplierId = (order = {}) => firstImportValue(
  order.partner_id,
  order.partnerId,
  order.supplier_id,
  order.supplierId,
  order.nhaCungCap?.id,
  order.nhaCungCap?.maNCC,
  order.supplier?.id,
);

const getImportOrderDetails = (order = {}) => {
  if (Array.isArray(order.chiTiet)) return order.chiTiet;
  if (Array.isArray(order.details)) return order.details;
  if (Array.isArray(order.items)) return order.items;
  return [];
};

const findProductInTreeByImportDetail = (detail = {}, productTree = []) => {
  const productId = firstImportValue(detail.product_id, detail.productId, detail.id);
  const variantId = firstImportValue(detail.variant_id, detail.variantId);
  const sku = firstImportValue(detail.sku, detail.maSP, detail.product_sku);

  for (const parent of productTree || []) {
    if (hasImportValue(productId) && isSameId(parent?.id, productId)) return { product: parent, parent: null };
    if (hasImportValue(sku) && String(parent?.sku || '').trim() === String(sku).trim()) return { product: parent, parent: null };

    for (const variant of Array.isArray(parent?.variants) ? parent.variants : []) {
      if (hasImportValue(variantId) && isSameId(variant?.id, variantId)) return { product: variant, parent };
      if (!hasImportValue(variantId) && hasImportValue(productId) && isSameId(variant?.id, productId)) return { product: variant, parent };
      if (hasImportValue(sku) && String(variant?.sku || '').trim() === String(sku).trim()) return { product: variant, parent };
    }
  }

  return { product: null, parent: null };
};

const collectImportHistoryIntoScope = (scope, importHistory = [], productTree = [], categoriesById = {}) => {
  if (!hasImportValue(scope?.supplierId)) return;

  (importHistory || []).forEach(order => {
    if (!isSameId(getImportOrderSupplierId(order), scope.supplierId)) return;

    getImportOrderDetails(order).forEach(detail => {
      const { product, parent } = findProductInTreeByImportDetail(detail, productTree);
      scope.importHistoryCount += 1;

      if (product) {
        collectProductCategoryIntoScope(scope, product, parent, categoriesById);
        collectProductNameIntoScope(scope, product, parent, categoriesById);
      }

      getProductNameHintValues(detail, null).forEach(value => addProductNameHintToScope(scope, value, categoriesById));
    });
  });
};

const buildSupplierProductScope = (supplier = null, productTree = [], categoriesById = {}, options = {}) => {
  const scope = createSupplierScope(supplier);
  if (!hasImportValue(scope.supplierId)) return scope;

  (productTree || []).forEach(parent => {
    if (isSameId(getProductSupplierId(parent), scope.supplierId)) {
      scope.directProductCount += 1;
      collectProductCategoryIntoScope(scope, parent, null, categoriesById);
      collectProductNameIntoScope(scope, parent, null, categoriesById);
    }

    (Array.isArray(parent?.variants) ? parent.variants : []).forEach(variant => {
      if (!isSameId(getProductSupplierId(variant, parent), scope.supplierId)) return;
      scope.directProductCount += 1;
      collectProductCategoryIntoScope(scope, variant, parent, categoriesById);
      collectProductNameIntoScope(scope, variant, parent, categoriesById);
    });
  });

  collectImportHistoryIntoScope(scope, options.importHistory || [], productTree, categoriesById);

  getSupplierCategoryHintValues(supplier, true).forEach(hint => {
    addSupplierHintToScope(
      scope,
      hint,
      categoriesById,
      scope.directProductCount === 0 && scope.importHistoryCount === 0 && Object.keys(categoriesById || {}).length === 0
    );
  });

  return scope;
};

const supplierScopeHasCategoryConstraints = (scope) => Boolean(
  scope && (scope.categoryIds.size > 0 || scope.categoryTexts.size > 0 || scope.groupKeys.size > 0 || scope.productNameTokens.size > 0)
);

const productMatchesSupplierCategoryScope = (product, parent = null, supplierScope = null, categoriesById = {}) => {
  if (!supplierScopeHasCategoryConstraints(supplierScope)) return false;

  const matchers = getProductCategoryMatchers(product, parent, categoriesById);
  for (const categoryId of matchers.categoryIds) {
    if (supplierScope.categoryIds.has(categoryId)) return true;
  }
  for (const groupKey of matchers.groupKeys) {
    if (supplierScope.groupKeys.has(groupKey)) return true;
  }
  for (const productCategoryText of matchers.categoryTexts) {
    for (const supplierCategoryText of supplierScope.categoryTexts) {
      if (areCategoryTextsCompatible(productCategoryText, supplierCategoryText)) return true;
    }
  }

  for (const productNameText of getProductNameHintValues(product, parent)) {
    for (const supplierCategoryText of supplierScope.categoryTexts) {
      if (areCategoryTextsCompatible(productNameText, supplierCategoryText)) return true;
    }

    for (const supplierNameToken of supplierScope.productNameTokens) {
      if (textContainsWholeCategoryToken(productNameText, supplierNameToken)) return true;
    }
  }

  return false;
};

const isImportProductAllowedForSupplier = (product, supplier, options = {}, parentOverride = null) => {
  const supplierId = getSupplierRecordId(supplier);
  if (!hasImportValue(supplierId)) return false;

  const parent = parentOverride || product?.parent || findParentProductInTree(product, options.productTree || []);
  const productSupplierId = getProductSupplierId(product, parent);
  if (hasImportValue(productSupplierId)) return isSameId(productSupplierId, supplierId);

  const supplierScope = options.supplierScope || buildSupplierProductScope(supplier, options.productTree || [], options.categoriesById || {});
  return productMatchesSupplierCategoryScope(product, parent, supplierScope, options.categoriesById || {});
};

const getImportRowKey = (product = {}) => {
  const variantId = firstImportValue(product.variant_id, product.variantId, product.is_variant ? product.id : null);
  if (hasImportValue(variantId)) return `variant:${normalizeComparableId(variantId)}`;

  const productId = firstImportValue(product.product_id, product.productId, !product.variant_id && !product.is_variant ? product.id : null);
  if (hasImportValue(productId)) return `product:${normalizeComparableId(productId)}`;

  const sku = firstImportValue(product.maSP, product.sku);
  if (hasImportValue(sku)) return `sku:${String(sku).trim().toLowerCase()}`;

  return '';
};

const productMatchesImportSearchQuery = (product = {}, query = '') => {
  const normalizedQuery = normalizeImportSearchText(query);
  if (!normalizedQuery) return true;

  const queryCompact = compactImportSearchText(query);
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const nameText = normalizeImportSearchText([
    product?.name,
    product?.tenSP,
    product?.product_name,
    product?.label,
    product?.parent_name,
    product?.parent?.name,
  ].filter(hasImportValue).join(' '));
  const nameCompact = compactImportSearchText(nameText);
  const skuText = normalizeImportSearchText(firstImportValue(product?.sku, product?.maSP, product?.parent_sku) || '');
  const skuCompact = compactImportSearchText(skuText);

  return nameText.includes(normalizedQuery) ||
    nameCompact.includes(queryCompact) ||
    queryTokens.every(token => nameText.includes(token)) ||
    skuText.includes(normalizedQuery) ||
    skuCompact.includes(queryCompact);
};

const isImportVariantProduct = (product = {}, parent = null) => Boolean(
  parent
  || product?.is_variant
  || product?.parent_id
  || product?._parentId
  || product?.parentId
  || product?.variant_id
  || product?.parent_name
  || product?.parent?.name
  || product?.variant_name
  || product?.variant?.name
);

const importProductHasVariants = (product = {}) => (
  Array.isArray(product?.variants) && product.variants.length > 0
);

const shouldShowImportSearchProduct = (product = {}) => !(
  !isImportVariantProduct(product) && importProductHasVariants(product)
);

const normalizeImportSearchProduct = (product = {}, productTree = []) => {
  const parent = product?.parent || findParentProductInTree(product, productTree);
  const isVariant = isImportVariantProduct(product, parent);
  const displayName = isVariant
    ? getProductDisplayName(product, parent)
    : firstImportValue(product?.display_name, product?.displayName, product?.product_name, product?.productName, product?.name, product?.tenSP, product?.label, product?.sku);

  if (!isVariant) {
    return {
      ...product,
      name: displayName || product?.name || '',
      tenSP: firstImportValue(product?.tenSP, displayName) || '',
      display_name: displayName || product?.display_name || '',
    };
  }

  return {
    ...product,
    is_variant: true,
    parent: parent || product?.parent || null,
    parent_id: firstImportValue(product?.parent_id, product?._parentId, product?.parentId, parent?.id, product?.product_id) || null,
    parent_name: firstImportValue(product?.parent_name, parent?.name) || '',
    name: displayName || product?.name || '',
    tenSP: displayName || product?.tenSP || product?.name || '',
    display_name: displayName || product?.display_name || '',
  };
};

const prepareImportSearchResults = (rows = [], query = '', productTree = []) => (
  (rows || [])
    .map(product => normalizeImportSearchProduct(product, productTree))
    .filter(shouldShowImportSearchProduct)
    .filter(product => productMatchesImportSearchQuery(product, query))
    .slice(0, PRODUCT_SEARCH_LIMIT)
);

const filterProductTreeBySupplier = (productTree = [], supplier = null, options = {}) => {
  const supplierId = getSupplierRecordId(supplier);
  if (!hasImportValue(supplierId)) return [];

  const categoriesById = options.categoriesById || {};
  const supplierScope = options.supplierScope || buildSupplierProductScope(supplier, productTree, categoriesById);

  return (productTree || []).reduce((acc, parent) => {
    const variants = Array.isArray(parent?.variants) ? parent.variants : [];
    const parentMatchesSupplier = isImportProductAllowedForSupplier(parent, supplier, { productTree, categoriesById, supplierScope }, null);
    const supplierVariants = variants.filter(variant => isImportProductAllowedForSupplier(variant, supplier, { productTree, categoriesById, supplierScope }, parent));

    if (parentMatchesSupplier || supplierVariants.length > 0) {
      acc.push({
        ...parent,
        variants: supplierVariants,
        _matchesSelectedSupplier: parentMatchesSupplier,
        _supplierFilteredVariantIds: supplierVariants.map(variant => variant.id),
      });
    }

    return acc;
  }, []);
};

const filterFlatProductsBySupplier = (rows = [], supplier = null, options = {}) => (
  (rows || []).filter(product => isImportProductAllowedForSupplier(product, supplier, options, product?.parent || null))
);

const findParentProductInTree = (product, productTree = []) => {
  if (product?.parent) return product.parent;
  const parentId = firstImportValue(product?.parent_id, product?._parentId, product?.parentId);
  if (!hasImportValue(parentId)) return null;
  return (productTree || []).find(parent => isSameId(parent?.id, parentId)) || null;
};

const getProductAvailableQuantity = (product = {}) => {
  if (Array.isArray(product?.variants) && product.variants.length > 0) {
    return product.variants.reduce((sum, variant) => sum + getFirstFiniteNumber(
      variant?.stock,
      variant?.quantity,
      variant?.soLuong,
      variant?.so_luong,
      variant?.tonKho,
      variant?.ton_kho,
      variant?.available_quantity,
      0
    ), 0);
  }

  return getFirstFiniteNumber(
    product?.stock,
    product?.quantity,
    product?.soLuong,
    product?.so_luong,
    product?.tonKho,
    product?.ton_kho,
    product?.available_quantity,
    0
  );
};

const mapProductForImport = (searchProduct = {}, fullProduct = {}, productTree = []) => {
  const source = { ...searchProduct, ...fullProduct };
  const parent = source.parent || searchProduct.parent || fullProduct.parent || findParentProductInTree(source, productTree) || findParentProductInTree(searchProduct, productTree);
  const isVariant = isImportVariantProduct(source, parent) || isImportVariantProduct(searchProduct, searchProduct.parent || parent) || isImportVariantProduct(fullProduct, fullProduct.parent || parent);
  const productId = isVariant
    ? firstImportValue(source.parent_id, searchProduct.parent_id, source._parentId, searchProduct._parentId, parent?.id, source.product_id)
    : firstImportValue(source.product_id, source.id, searchProduct.id);
  const variantId = isVariant
    ? firstImportValue(source.variant_id, source.id, searchProduct.variant_id, searchProduct.id)
    : firstImportValue(source.variant_id);
  const sku = firstImportValue(source.sku, searchProduct.sku, source.maSP, searchProduct.maSP);
  const displayName = isVariant ? getProductDisplayName({ ...source, ...searchProduct }, parent) : '';
  const name = isVariant
    ? firstImportValue(displayName, searchProduct.tenSP, searchProduct.display_name, searchProduct.name, source.tenSP, source.name)
    : firstImportValue(source.name, searchProduct.name, source.tenSP, searchProduct.tenSP);
  const unit = firstImportValue(source.unit, searchProduct.unit, source.donVi, searchProduct.donVi) || 'cái';
  const importPrice = Math.max(0, getFirstFiniteNumber(source.import_price, searchProduct.import_price, source.giaNhap, searchProduct.giaNhap, source.retail_price, searchProduct.retail_price));
  const retailPrice = Math.max(0, getFirstFiniteNumber(source.retail_price, searchProduct.retail_price, source.giaBan, searchProduct.giaBan, source.price, searchProduct.price));
  const wholesalePrice = Math.max(0, getFirstFiniteNumber(source.wholesale_price, searchProduct.wholesale_price));
  const normalizedProduct = {
    id: productId || (!isVariant ? firstImportValue(source.id, searchProduct.id) : null),
    product_id: productId || null,
    variant_id: variantId || null,
    parent_id: parent?.id || source.parent_id || searchProduct.parent_id || null,
    parent_name: parent?.name || source.parent_name || searchProduct.parent_name || '',
    maSP: sku || '',
    tenSP: name || '',
    donVi: unit,
    giaNhap: importPrice,
    import_price: importPrice,
    retail_price: retailPrice,
    wholesale_price: wholesalePrice,
    default_category_id: firstImportValue(source.default_category_id, searchProduct.default_category_id, parent?.default_category_id) || null,
    default_category: source.default_category || searchProduct.default_category || parent?.default_category || null,
    supplier_id: getProductSupplierId(source, parent),
    stock: getProductAvailableQuantity(source),
    hinhAnh: firstImportValue(source.hinhAnh, searchProduct.hinhAnh, source.image_url, searchProduct.image_url, source.image, searchProduct.image) || '',
    ...(source.category && { category: source.category }),
  };

  return {
    ...normalizedProduct,
    row_key: getImportRowKey(normalizedProduct),
  };
};

const normalizePaymentStatusValue = (status) => {
  const value = String(status || '').trim().toLowerCase();
  return ['paid', 'da_thanh_toan', 'đã thanh toán', 'da thanh toan'].includes(value) ? 'paid' : 'unpaid';
};

const toNonNegativeMoney = (value, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : fallback;
};

const formatVND = (value) => {
  const numberValue = Number(value);
  const safeValue = Number.isFinite(numberValue) ? Math.max(0, numberValue) : 0;
  return `${Math.round(safeValue).toLocaleString('vi-VN')}đ`;
};

const clampImportPercent = (value) => {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.min(100, Math.max(0, numberValue));
};

const parseImportQuantity = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const normalizeImportQuantity = (value, fallback = 1) => {
  const quantity = parseImportQuantity(value, fallback);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : fallback;
};

const getImportQuantityInputError = (value) => {
  const quantity = parseImportQuantity(value, NaN);
  if (!Number.isFinite(quantity)) return 'Số lượng phải là số hợp lệ';
  if (quantity <= 0) return 'Số lượng nhập phải lớn hơn 0';
  return '';
};

const isValidImportQuantityInput = (value) => !getImportQuantityInputError(value);

const calculateImportLineAmounts = (giaNhap, soLuong, chietKhau = 0, thueGTGT = 0) => {
  const price = Math.max(0, getFirstFiniteNumber(giaNhap, 0));
  const quantity = Math.max(0, parseImportQuantity(soLuong, 0));
  const discountPercent = clampImportPercent(chietKhau);
  const taxPercent = clampImportPercent(thueGTGT);
  const grossAmount = price * quantity;
  const discountAmount = grossAmount * (discountPercent / 100);
  const afterDiscount = Math.max(0, grossAmount - discountAmount);
  const taxAmount = afterDiscount * (taxPercent / 100);
  const lineTotal = afterDiscount + taxAmount;

  return {
    price,
    quantity,
    discountPercent,
    taxPercent,
    grossAmount,
    discountAmount,
    afterDiscount,
    taxAmount,
    lineTotal,
  };
};

const resolvePaymentAmounts = ({ total, status, paidAmount, remainingAmount, forceUnpaidFull = false }) => {
  const normalizedTotal = toNonNegativeMoney(total, 0);
  if (forceUnpaidFull) {
    return {
      payment_status: 'unpaid',
      paid_amount: 0,
      remaining_amount: normalizedTotal,
    };
  }

  const normalizedStatus = normalizePaymentStatusValue(status);
  if (normalizedStatus === 'paid') {
    return {
      payment_status: 'paid',
      paid_amount: normalizedTotal,
      remaining_amount: 0,
    };
  }

  const paid = Math.min(normalizedTotal, toNonNegativeMoney(paidAmount, 0));
  const remaining = hasImportValue(remainingAmount)
    ? Math.min(normalizedTotal, toNonNegativeMoney(remainingAmount, Math.max(0, normalizedTotal - paid)))
    : Math.max(0, normalizedTotal - paid);

  return {
    payment_status: 'unpaid',
    paid_amount: paid,
    remaining_amount: remaining,
  };
};

const buildPaymentDetailSignature = (items = []) => JSON.stringify((Array.isArray(items) ? items : []).map(item => ({
  product_id: normalizeComparableId(firstImportValue(item.product_id, item.productId, item.id)),
  variant_id: normalizeComparableId(firstImportValue(item.variant_id, item.variantId)),
  sku: String(firstImportValue(item.maSP, item.sku) || '').trim(),
  quantity: getFirstFiniteNumber(item.soLuongNhap, item.soLuong, item.quantity),
  import_price: getFirstFiniteNumber(item.giaNhap, item.import_price),
  discount: getFirstFiniteNumber(item.chietKhau, item.discount, item.discount_percent),
  tax: getFirstFiniteNumber(item.thueGTGT, item.tax_percent, item.vat_percent),
  line_total: getFirstFiniteNumber(item.thanhTien, item.line_total),
})));

const Nhaphang = ({ store }) => {
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [supplierSearchQuery, setSupplierSearchQuery] = useState('');
  const [showSupplierResults, setShowSupplierResults] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [editingProductIndex, setEditingProductIndex] = useState(null);
  const [importPickerSelections, setImportPickerSelections] = useState([]);
  const [note, setNote] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('unpaid');
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [filteredSuppliers, setFilteredSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [stockToast, setStockToast] = useState(null);
  const [currentOrder, setCurrentOrder] = useState(null);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [orderHistory, setOrderHistory] = useState([]);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState([]);
  const [showAllSuppliers, setShowAllSuppliers] = useState(false); // Thêm state để hiển thị full khi focus
  const searchInputRef = useRef(null);
  const productSearchContainerRef = useRef(null);
  const searchResultsRef = useRef(null);
  const supplierSearchContainerRef = useRef(null);
  const supplierInputRef = useRef(null);
  const supplierResultsRef = useRef(null);

  const categoriesById = useMemo(() => buildCategoriesById(categories), [categories]);
  const selectedSupplierId = getSupplierRecordId(selectedSupplier);
  const getScopedProductSearchResults = useCallback((query = '') => {
    const trimmedQuery = query.trim();
    const scopedProductTree = selectedSupplier
      ? filterProductTreeBySupplier(allProducts, selectedSupplier, {
        categoriesById,
        importHistory: orderHistory,
      })
      : allProducts;
    const localResults = searchFlatProducts(scopedProductTree, trimmedQuery, {
      categoriesById,
      includeParents: true,
      includeVariants: true,
    });

    return prepareImportSearchResults(localResults, trimmedQuery, scopedProductTree);
  }, [allProducts, categoriesById, orderHistory, selectedSupplier]);

  useEffect(() => {
    if (!stockToast) return undefined;
    const timer = setTimeout(() => setStockToast(null), 3400);
    return () => clearTimeout(timer);
  }, [stockToast]);

  const showStockLimitToast = useCallback((message) => {
    setStockToast({ id: Date.now(), message });
  }, []);

  // Fetch suppliers/products/categories from API
  useEffect(() => {
    fetchSuppliers();
    fetchAllProducts();
    fetchCategories();
    fetchImportHistory();
  }, []);

  const fetchSuppliers = async () => {
    try {
      const res = await fetch(`${API}/partners`);
      if (res.ok) {
        const data = await res.json().catch(() => []);
        setSuppliers(Array.isArray(data) ? data : []);
      } else {
        console.error('Failed to fetch suppliers');
        setSuppliers([]);
      }
    } catch (err) {
      console.error('Lỗi tải nhà cung cấp:', err);
      setSuppliers([]);
    }
  };

  const fetchAllProducts = async () => {
    try {
      const res = await fetch(`${API}/products/all/with-variants`);
      if (res.ok) {
        const data = await res.json().catch(() => []);
        setAllProducts(Array.isArray(data) ? data : []);
      } else {
        setAllProducts([]);
      }
    } catch (err) {
      console.error('Lỗi tải danh sách sản phẩm:', err);
      setAllProducts([]);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${API}/product-categories`);
      if (res.ok) {
        const data = await res.json().catch(() => []);
        setCategories(Array.isArray(data) ? data : []);
      } else {
        setCategories([]);
      }
    } catch (err) {
      console.error('Lỗi tải danh mục sản phẩm:', err);
      setCategories([]);
    }
  };

  const fetchImportHistory = async () => {
    try {
      const res = await fetch(`${API}/imports`);
      if (res.ok) {
        const data = await res.json();
        setOrderHistory((Array.isArray(data) ? data : []).map(mapImportToOrder));
      }
    } catch (err) {
      console.error('Lỗi tải lịch sử nhập hàng:', err);
    }
  };

  // Debounced search for products
  const debounceTimeoutRef = useRef(null);

  useEffect(() => {
    const onSyncUpdated = (event) => {
      const changedTables = event.detail?.changedTables || [];
      if (changedTables.some(table => ['products', 'imports', 'import_details', 'invoice_details', 'invoices'].includes(table))) {
        fetchAllProducts();
        fetchImportHistory();
      }
      if (changedTables.includes('product_categories')) fetchCategories();
    };

    window.addEventListener(SYNC_UPDATED_EVENT, onSyncUpdated);
    return () => window.removeEventListener(SYNC_UPDATED_EVENT, onSyncUpdated);
  }, []);

  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    const trimmedQuery = searchQuery.trim();

    if (!showSearchResults && !trimmedQuery) {
      setFilteredProducts([]);
      setLoading(false);
      return () => {
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
        }
      };
    }

    if (!trimmedQuery) {
      setFilteredProducts(getScopedProductSearchResults(''));
      setLoading(false);
      return () => {
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
        }
      };
    }

    setLoading(true);
    debounceTimeoutRef.current = setTimeout(async () => {
      try {
        const localResults = getScopedProductSearchResults(trimmedQuery);

        if (localResults.length > 0 || allProducts.length > 0) {
          setFilteredProducts(localResults);
        } else {
          const response = await fetch(`${API}/products/search?q=${encodeURIComponent(trimmedQuery)}&limit=${PRODUCT_SEARCH_LIMIT}`);
          const results = await response.json();
          setFilteredProducts(prepareImportSearchResults(results || [], trimmedQuery, allProducts));
        }
      } catch (err) {
        console.error('Lỗi tìm kiếm sản phẩm:', err);
        try {
          const response = await fetch(`${API}/products?search=${encodeURIComponent(trimmedQuery)}`);
          const results = await response.json();
          setFilteredProducts(prepareImportSearchResults(results || [], trimmedQuery, allProducts));
        } catch (_) {
          setFilteredProducts([]);
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [searchQuery, showSearchResults, getScopedProductSearchResults, allProducts.length]);

  // Filter suppliers when search query changes
  useEffect(() => {
    if (supplierSearchQuery.trim()) {
      const filtered = suppliers.filter(s =>
        s.name.toLowerCase().includes(supplierSearchQuery.toLowerCase()) ||
        (s.id && s.id.toString().includes(supplierSearchQuery.toLowerCase())) ||
        (s.phone && s.phone.includes(supplierSearchQuery)) ||
        (s.tax_code && s.tax_code.includes(supplierSearchQuery))
      );
      setFilteredSuppliers(filtered);
    } else {
      setFilteredSuppliers(suppliers);
    }
  }, [supplierSearchQuery, suppliers]);

  // Close search results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        searchResultsRef.current &&
        !searchResultsRef.current.contains(event.target) &&
        productSearchContainerRef.current &&
        !productSearchContainerRef.current.contains(event.target)
      ) {
        setShowSearchResults(false);
      }
      if (
        supplierResultsRef.current &&
        !supplierResultsRef.current.contains(event.target) &&
        supplierSearchContainerRef.current &&
        !supplierSearchContainerRef.current.contains(event.target)
      ) {
        setShowSupplierResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Validation
  const validateProduct = (product) => {
    const errors = [];
    const importPrice = hasImportValue(product.giaNhap)
      ? Number(product.giaNhap)
      : getFirstFiniteNumber(product.import_price, product.retail_price, 0);
    const discount = Number(product.chietKhau || 0);
    const taxPercent = Number(product.thueGTGT ?? product.tax_percent ?? product.vat_percent ?? 0);

    if (!product.tenSP) errors.push('Tên sản phẩm là bắt buộc');
    if (!product.donVi) errors.push('Đơn vị là bắt buộc');
    if (!getImportRowKey(product)) errors.push('Dòng sản phẩm thiếu product_id, variant_id hoặc SKU hợp lệ');
    const quantityError = getImportQuantityInputError(product.soLuongNhap);
    if (quantityError) errors.push(quantityError);
    if (!Number.isFinite(importPrice) || importPrice < 0) {
      errors.push('Giá nhập phải lớn hơn hoặc bằng 0');
    }
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      errors.push('Chiết khấu phải từ 0-100%');
    }
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
      errors.push('Thuế GTGT phải từ 0-100%');
    }
    return errors;
  };

  // Validate entire order
  const validateOrder = () => {
    const errors = [];
    if (!selectedSupplier) {
      errors.push('Vui lòng chọn nhà cung cấp');
    }
    if (products.length === 0) {
      errors.push('Vui lòng thêm ít nhất một sản phẩm');
    }

    products.forEach((product, index) => {
      const productErrors = validateProduct(product);
      if (productErrors.length > 0) {
        errors.push(`Sản phẩm #${index + 1} (${product.tenSP || product.maSP || 'chưa rõ'}): ${productErrors.join(', ')}`);
      }
    });

    return errors;
  };

  // Calculate thanhTien for a product
  const calculateThanhTien = (giaNhap, soLuong, chietKhau, thueGTGT = 0) => (
    calculateImportLineAmounts(giaNhap, soLuong, chietKhau, thueGTGT).lineTotal
  );

  const normalizeEditableImportQuantity = (value, fallback = 1) => normalizeImportQuantity(value, fallback);

  const resetProductSearchState = (options = {}) => {
    const {
      keepSearchQuery = false,
      keepSearchResults = false
    } = options;

    setSelectedProduct(null);
    setEditingProductIndex(null);

    if (!keepSearchQuery) {
      setSearchQuery('');
    }

    if (!keepSearchResults) {
      setFilteredProducts([]);
      setShowSearchResults(false);
    }
  };

  const openProductSearch = useCallback((rowIndex = null) => {
    const normalizedIndex = Number.isInteger(rowIndex) ? rowIndex : null;
    setEditingProductIndex(normalizedIndex);
    setSelectedProduct(null);
    setSearchQuery('');
    setFilteredProducts(getScopedProductSearchResults(''));
    setShowSearchResults(true);
    setError(null);
    setSuccess(null);

    window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);
  }, [getScopedProductSearchResults]);

  const handleStartAddProduct = () => {
    if (!selectedSupplier) {
      showSupplierRequiredHint();
      return;
    }
    openProductSearch(null);
  };

  const handleEditProductRow = (index) => {
    if (!selectedSupplier) {
      showSupplierRequiredHint();
      return;
    }
    openProductSearch(index);
  };

  const prepareSupplierChange = (nextSupplier = null) => {
    const nextSupplierId = getSupplierRecordId(nextSupplier);
    if (selectedSupplier && nextSupplierId && isSameId(selectedSupplierId, nextSupplierId)) return true;

    if ((products.length > 0 || importPickerSelections.length > 0) && !window.confirm(SUPPLIER_CHANGE_CONFIRM_MESSAGE)) {
      return false;
    }

    setProducts([]);
    setImportPickerSelections([]);
    resetProductSearchState();
    setPaymentStatus('unpaid');
    return true;
  };

  const normalizeSupplierForForm = (supplier = {}) => ({
    ...supplier,
    id: firstImportValue(supplier.id, supplier.maNCC, supplier.supplier_id),
    maNCC: firstImportValue(supplier.id, supplier.maNCC, supplier.supplier_id) || '',
    tenNCC: supplier.name || supplier.tenNCC || '',
    name: supplier.name || supplier.tenNCC || '',
    diaChi: supplier.address || supplier.diaChi || '',
    address: supplier.address || supplier.diaChi || '',
    sdt: supplier.phone || supplier.sdt || '',
    phone: supplier.phone || supplier.sdt || '',
    email: supplier.email || ''
  });

  const showSupplierRequiredHint = () => {
    setError('Vui lòng chọn nhà cung cấp trước khi thêm hoặc lưu phiếu nhập.');
    setTimeout(() => setError(null), 3000);
  };

  const buildSelectedProductDraft = (mappedProduct) => {
    const isEditingExistingRow = editingProductIndex !== null && products[editingProductIndex];
    const sourceRow = isEditingExistingRow ? products[editingProductIndex] : null;
    const quantity = isEditingExistingRow ? normalizeEditableImportQuantity(sourceRow.soLuongNhap, 1) : 1;
    const discount = isEditingExistingRow ? clampImportPercent(sourceRow.chietKhau) : 0;
    const taxPercent = isEditingExistingRow ? clampImportPercent(sourceRow.thueGTGT ?? sourceRow.tax_percent ?? sourceRow.vat_percent) : 0;
    const importPrice = Math.max(0, getFirstFiniteNumber(mappedProduct.giaNhap, mappedProduct.import_price, mappedProduct.retail_price));
    const lineAmounts = calculateImportLineAmounts(importPrice, quantity, discount, taxPercent);

    return {
      ...mappedProduct,
      soLuongNhap: quantity,
      chietKhau: discount,
      thueGTGT: taxPercent,
      giaNhap: importPrice,
      import_price: importPrice,
      tienSauChietKhau: lineAmounts.afterDiscount,
      thueGTGTAmount: lineAmounts.taxAmount,
      thanhTien: lineAmounts.lineTotal
    };
  };

  const buildImportProductDraftFromSearch = async (product) => {
    let fullProduct = product;
    try {
      if (product?.id) {
        const productRes = await fetch(`${API}/products/${product.id}`);
        fullProduct = productRes.ok ? await productRes.json() : product;
      }
    } catch (_) {
      fullProduct = product;
    }
    return buildSelectedProductDraft(mapProductForImport(product, fullProduct, allProducts));
  };

  const buildNormalizedImportProductLine = (product, quantityOverride = null) => {
    const quantitySource = quantityOverride ?? product.soLuongNhap;
    const importPrice = Math.max(0, getFirstFiniteNumber(product.giaNhap, product.import_price, product.retail_price));
    const quantityToAdd = normalizeImportQuantity(quantitySource, 0);
    const nextDiscount = clampImportPercent(product.chietKhau);
    const nextTaxPercent = clampImportPercent(product.thueGTGT ?? product.tax_percent ?? product.vat_percent);
    const lineAmounts = calculateImportLineAmounts(importPrice, quantityToAdd, nextDiscount, nextTaxPercent);
    return {
      ...product,
      row_key: getImportRowKey(product),
      giaNhap: importPrice,
      import_price: importPrice,
      soLuongNhap: quantityToAdd,
      chietKhau: nextDiscount,
      thueGTGT: nextTaxPercent,
      tienSauChietKhau: lineAmounts.afterDiscount,
      thueGTGTAmount: lineAmounts.taxAmount,
      thanhTien: lineAmounts.lineTotal
    };
  };

  const mergeImportProductLines = (currentProducts, normalizedProduct, options = {}) => {
    const rowKey = normalizedProduct.row_key || getImportRowKey(normalizedProduct);
    const quantityToAdd = normalizeImportQuantity(normalizedProduct.soLuongNhap, 0);
    const skipIndex = Number.isInteger(options.skipIndex) ? options.skipIndex : null;
    const duplicateIndex = currentProducts.findIndex((product, index) => getImportRowKey(product) === rowKey && (skipIndex === null || index !== skipIndex));

    if (duplicateIndex >= 0) {
      return currentProducts.map((product, index) => {
        if (index !== duplicateIndex) return product;
        const nextQuantity = normalizeImportQuantity(product.soLuongNhap, 0) + quantityToAdd;
        const nextPrice = Math.max(0, getFirstFiniteNumber(product.giaNhap, product.import_price, normalizedProduct.giaNhap));
        const mergedDiscount = clampImportPercent(product.chietKhau);
        const mergedTaxPercent = clampImportPercent(product.thueGTGT ?? product.tax_percent ?? product.vat_percent);
        const mergedLine = calculateImportLineAmounts(nextPrice, nextQuantity, mergedDiscount, mergedTaxPercent);
        return {
          ...product,
          soLuongNhap: nextQuantity,
          giaNhap: nextPrice,
          import_price: nextPrice,
          chietKhau: mergedDiscount,
          thueGTGT: mergedTaxPercent,
          tienSauChietKhau: mergedLine.afterDiscount,
          thueGTGTAmount: mergedLine.taxAmount,
          thanhTien: mergedLine.lineTotal
        };
      });
    }

    if (skipIndex !== null && currentProducts[skipIndex]) {
      return currentProducts.map((product, index) => index === skipIndex ? normalizedProduct : product);
    }

    return [...currentProducts, normalizedProduct];
  };

  const applyImportProductQuantityDelta = (currentProducts, selection, quantityDelta) => {
    if (!Number.isFinite(quantityDelta) || quantityDelta === 0) return currentProducts;
    if (quantityDelta > 0) {
      return mergeImportProductLines(currentProducts, buildNormalizedImportProductLine(selection.product, quantityDelta));
    }

    const rowKey = getImportRowKey(selection.product);
    const rowIndex = currentProducts.findIndex(product => getImportRowKey(product) === rowKey);
    if (rowIndex < 0) return currentProducts;
    const subtractQuantity = Math.abs(quantityDelta);
    return currentProducts.map((product, index) => {
      if (index !== rowIndex) return product;
      const nextQuantity = Math.max(0.0001, normalizeImportQuantity(product.soLuongNhap, 0) - subtractQuantity);
      const nextPrice = Math.max(0, getFirstFiniteNumber(product.giaNhap, product.import_price, selection.product.giaNhap));
      const nextDiscount = clampImportPercent(product.chietKhau);
      const nextTaxPercent = clampImportPercent(product.thueGTGT ?? product.tax_percent ?? product.vat_percent);
      const nextLine = calculateImportLineAmounts(nextPrice, nextQuantity, nextDiscount, nextTaxPercent);
      return {
        ...product,
        soLuongNhap: nextQuantity,
        giaNhap: nextPrice,
        import_price: nextPrice,
        chietKhau: nextDiscount,
        thueGTGT: nextTaxPercent,
        tienSauChietKhau: nextLine.afterDiscount,
        thueGTGTAmount: nextLine.taxAmount,
        thanhTien: nextLine.lineTotal,
      };
    });
  };

  const getImportPickerKey = (product = {}) => getImportRowKey(product) || `product:${product.id || product.sku || product.maSP || Math.random()}`;

  const handleAddImportPickerSelection = async (product) => {
    if (!selectedSupplier) {
      showSupplierRequiredHint();
      return;
    }
    try {
      setLoading(true);
      const draft = await buildImportProductDraftFromSearch(product);
      const key = getImportPickerKey(draft);
      setImportPickerSelections(prev => {
        if (prev.some(selection => selection.key === key)) return prev;
        return [...prev, { key, product: draft, quantity: 1, appliedQuantity: 0, name: draft.tenSP, sku: draft.maSP }];
      });
      setError(null);
    } finally {
      setLoading(false);
    }
  };

  const updateImportPickerQuantity = (key, value) => {
    const text = String(value ?? '').replace(',', '.');
    if (text !== '' && !/^\d*(?:\.\d*)?$/.test(text)) return;
    setImportPickerSelections(prev => prev.map(selection => (
      selection.key === key ? { ...selection, quantity: text } : selection
    )));
  };

  const stepImportPickerQuantity = (key, direction) => {
    setImportPickerSelections(prev => prev.map(selection => {
      if (selection.key !== key) return selection;
      const current = parseImportQuantity(selection.quantity, 1);
      return { ...selection, quantity: normalizeImportQuantity(current + direction * IMPORT_PICKER_QUANTITY_STEP, 1) };
    }));
  };

  const removeImportPickerSelection = (key) => {
    setImportPickerSelections(prev => prev.filter(selection => selection.key !== key));
  };

  const importPickerHasQuantityError = importPickerSelections.some(selection => !isValidImportQuantityInput(selection.quantity));
  const importPickerTotalQuantity = importPickerSelections.reduce((sum, selection) => (
    sum + (isValidImportQuantityInput(selection.quantity) ? parseImportQuantity(selection.quantity, 0) : 0)
  ), 0);

  const finishImportPickerSelection = () => {
    if (importPickerSelections.length === 0 || importPickerHasQuantityError) return;
    const normalizedSelections = importPickerSelections.map(selection => ({
      ...selection,
      quantity: normalizeImportQuantity(selection.quantity, 1),
      appliedQuantity: Number(selection.appliedQuantity) || 0,
    }));
    const changes = normalizedSelections
      .map(selection => ({
        selection,
        quantityDelta: normalizeImportQuantity(selection.quantity, 1) - (Number(selection.appliedQuantity) || 0),
      }))
      .filter(item => item.quantityDelta !== 0);

    if (changes.length > 0) {
      setPaymentStatus('unpaid');
      setProducts(prev => changes.reduce((nextProducts, change) => applyImportProductQuantityDelta(nextProducts, change.selection, change.quantityDelta), prev));
    }
    setImportPickerSelections(normalizedSelections.map(selection => ({ ...selection, appliedQuantity: selection.quantity })));
    setShowSearchResults(false);
    setSelectedProduct(null);
    setEditingProductIndex(null);
    setError(null);
    setSuccess(changes.length > 0 ? `Đã cập nhật ${changes.length} dòng sản phẩm vào phiếu nhập.` : 'Danh sách chọn tạm đã được giữ nguyên, không cộng trùng sản phẩm.');
    setTimeout(() => setSuccess(null), 3000);
  };

  const renderImportPickerSelections = () => (
    <div className="rounded-xl border border-blue-200 bg-white shadow-sm">
      <div className="border-b border-blue-100 bg-blue-50 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-blue-800">Sản phẩm đã chọn</div>
            <div className="text-[11px] text-blue-600">Tổng {importPickerSelections.length.toLocaleString('vi-VN')} dòng · {importPickerTotalQuantity.toLocaleString('vi-VN')} sản phẩm</div>
          </div>
          <button
            type="button"
            onClick={finishImportPickerSelection}
            disabled={importPickerSelections.length === 0 || importPickerHasQuantityError || saving}
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Chọn xong
          </button>
        </div>
        {importPickerHasQuantityError && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-700">Số lượng phải là số dương, không nhập chữ hoặc số âm.</div>}
      </div>
      <div className="max-h-72 overflow-y-auto p-2 space-y-2 scroll-smooth">
        {importPickerSelections.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-400">Bấm nút + màu xanh ngay cạnh tên sản phẩm để đưa vào danh sách tạm.</div>
        ) : importPickerSelections.map(selection => {
          const price = Math.max(0, getFirstFiniteNumber(selection.product.giaNhap, selection.product.import_price, selection.product.retail_price));
          const quantity = isValidImportQuantityInput(selection.quantity) ? parseImportQuantity(selection.quantity, 0) : 0;
          return (
            <div key={selection.key} className="rounded-lg border border-gray-200 bg-white p-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-gray-800" title={selection.name}>{selection.name}</div>
                  <div className="mt-0.5 text-[10px] text-gray-400">Mã: {selection.sku || 'N/A'} · {formatVND(price)}</div>
                </div>
                <button type="button" onClick={() => removeImportPickerSelection(selection.key)} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Bỏ khỏi danh sách chọn tạm"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <QuantityStepper
                  value={selection.quantity}
                  min={1}
                  step={IMPORT_PICKER_QUANTITY_STEP}
                  onChange={(value) => updateImportPickerQuantity(selection.key, value)}
                  onDecrease={() => stepImportPickerQuantity(selection.key, -1)}
                  onIncrease={() => stepImportPickerQuantity(selection.key, 1)}
                  inputClassName={!isValidImportQuantityInput(selection.quantity) ? 'bg-red-50 text-red-700' : ''}
                />
                <div className="text-right text-xs font-bold text-green-700">{formatVND(quantity * price)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // Handle product selection from search
  const handleSelectProduct = async (product) => {
    try {
      setLoading(true);
      const draft = await buildImportProductDraftFromSearch(product);
      setSelectedProduct(draft);
      setShowSearchResults(false);
      setError(null);
    } catch (err) {
      const mappedProduct = mapProductForImport(product, product, allProducts);
      setSelectedProduct(buildSelectedProductDraft(mappedProduct));
      setShowSearchResults(false);
      setError(null);
    } finally {
      setLoading(false);
    }
  };

  // Handle supplier selection from search
  const handleSelectSupplier = (supplier) => {
    if (!prepareSupplierChange(supplier)) {
      setShowSupplierResults(false);
      setShowAllSuppliers(false);
      return;
    }

    setSelectedSupplier(normalizeSupplierForForm(supplier));
    setShowSupplierResults(false);
    setShowAllSuppliers(false);
    setSupplierSearchQuery('');
    setError(null);
  };

  const handleClearSupplier = () => {
    if (!prepareSupplierChange(null)) return;
    setSelectedSupplier(null);
    setSupplierSearchQuery('');
    setShowSupplierResults(false);
    setShowAllSuppliers(false);
    setError(null);
  };

  // Add product to list
  const handleAddProduct = (options = {}) => {
    const {
      keepSearching = false
    } = options;

    if (!selectedSupplier) {
      showSupplierRequiredHint();
      return;
    }

    if (!selectedProduct) {
      setError('Vui lòng chọn sản phẩm!');
      setTimeout(() => setError(null), 3000);
      return;
    }

    const productErrors = validateProduct(selectedProduct);
    if (productErrors.length > 0) {
      setError(productErrors.join(', '));
      setTimeout(() => setError(null), 3000);
      return;
    }

    const importPrice = Math.max(0, getFirstFiniteNumber(selectedProduct.giaNhap, selectedProduct.import_price, selectedProduct.retail_price));
    const quantityToAdd = normalizeImportQuantity(selectedProduct.soLuongNhap, 0);
    const nextDiscount = clampImportPercent(selectedProduct.chietKhau);
    const nextTaxPercent = clampImportPercent(selectedProduct.thueGTGT ?? selectedProduct.tax_percent ?? selectedProduct.vat_percent);
    const lineAmounts = calculateImportLineAmounts(importPrice, quantityToAdd, nextDiscount, nextTaxPercent);
    const normalizedProduct = {
      ...selectedProduct,
      row_key: getImportRowKey(selectedProduct),
      giaNhap: importPrice,
      import_price: importPrice,
      soLuongNhap: quantityToAdd,
      chietKhau: nextDiscount,
      thueGTGT: nextTaxPercent,
      tienSauChietKhau: lineAmounts.afterDiscount,
      thueGTGTAmount: lineAmounts.taxAmount,
      thanhTien: lineAmounts.lineTotal
    };

    const rowKey = normalizedProduct.row_key;
    const isEditingExistingRow = editingProductIndex !== null && products[editingProductIndex];
    const duplicateIndex = products.findIndex((product, index) => getImportRowKey(product) === rowKey && (!isEditingExistingRow || index !== editingProductIndex));

    if (isEditingExistingRow && duplicateIndex >= 0) {
      const duplicateName = products[duplicateIndex]?.tenSP || normalizedProduct.tenSP || normalizedProduct.maSP;
      setSuccess(null);
      setError(`Sản phẩm ${duplicateName} đã có ở dòng #${duplicateIndex + 1}. Vui lòng sửa số lượng ở dòng đó hoặc chọn sản phẩm khác.`);
      setTimeout(() => setError(null), 4000);
      return;
    }

    setPaymentStatus('unpaid');
    if (isEditingExistingRow) {
      setProducts(prev => prev.map((product, index) => (
        index === editingProductIndex ? normalizedProduct : product
      )));
      setSuccess('Đã cập nhật sản phẩm cho dòng đang chọn.');
      setTimeout(() => setSuccess(null), 3000);
    } else if (duplicateIndex >= 0) {
      const duplicateName = products[duplicateIndex]?.tenSP || normalizedProduct.tenSP || normalizedProduct.maSP;
      setProducts(prev => prev.map((product, index) => {
        if (index !== duplicateIndex) return product;
        const nextQuantity = normalizeImportQuantity(product.soLuongNhap, 0) + quantityToAdd;
        const nextPrice = Math.max(0, getFirstFiniteNumber(product.giaNhap, product.import_price, normalizedProduct.giaNhap));
        const mergedDiscount = clampImportPercent(product.chietKhau);
        const mergedTaxPercent = clampImportPercent(product.thueGTGT ?? product.tax_percent ?? product.vat_percent);
        const mergedLine = calculateImportLineAmounts(nextPrice, nextQuantity, mergedDiscount, mergedTaxPercent);
        return {
          ...product,
          soLuongNhap: nextQuantity,
          giaNhap: nextPrice,
          import_price: nextPrice,
          chietKhau: mergedDiscount,
          thueGTGT: mergedTaxPercent,
          tienSauChietKhau: mergedLine.afterDiscount,
          thueGTGTAmount: mergedLine.taxAmount,
          thanhTien: mergedLine.lineTotal
        };
      }));
      setSuccess(`Đã gộp thêm ${quantityToAdd} vào dòng ${duplicateName}.`);
      setTimeout(() => setSuccess(null), 3000);
    } else {
      setProducts(prev => [...prev, normalizedProduct]);
      setSuccess(null);
    }

    if (keepSearching) {
      setSelectedProduct(null);
      setEditingProductIndex(null);
      setSearchQuery('');
      setFilteredProducts(getScopedProductSearchResults(''));
      setShowSearchResults(true);
      window.setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select?.();
      }, 0);
    } else {
      resetProductSearchState();
    }

    setError(null);
  };

  // Update product in list
  const handleUpdateProduct = (index, field, value) => {
    setProducts(prev => prev.map((item, itemIndex) => {
      if (itemIndex !== index) return item;

      const product = { ...item };
      const numericValue = Number(value);
      const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
      if (field === 'soLuongNhap') {
        const quantityError = getImportQuantityInputError(value);
        if (quantityError) showStockLimitToast(quantityError);
        product.soLuongNhap = value;
      } else if (field === 'chietKhau' || field === 'thueGTGT') {
        product[field] = clampImportPercent(safeValue);
      } else if (field === 'giaNhap') {
        product[field] = Math.max(0, safeValue);
        product.import_price = Math.max(0, safeValue);
      } else {
        product[field] = value;
      }

      const nextPrice = Math.max(0, getFirstFiniteNumber(product.giaNhap, product.import_price, product.retail_price));
      const nextQuantity = parseImportQuantity(product.soLuongNhap, 0);
      const nextDiscount = clampImportPercent(product.chietKhau);
      const nextTaxPercent = clampImportPercent(product.thueGTGT ?? product.tax_percent ?? product.vat_percent);
      const lineAmounts = calculateImportLineAmounts(nextPrice, nextQuantity, nextDiscount, nextTaxPercent);
      product.chietKhau = nextDiscount;
      product.thueGTGT = nextTaxPercent;
      product.tienSauChietKhau = lineAmounts.afterDiscount;
      product.thueGTGTAmount = lineAmounts.taxAmount;
      product.thanhTien = lineAmounts.lineTotal;
      return product;
    }));
  };

  // Remove product from list
  const handleRemoveProduct = (index) => {
    setProducts(prev => prev.filter((_, i) => i !== index));
    if (editingProductIndex === index) resetProductSearchState();
    if (editingProductIndex !== null && editingProductIndex > index) setEditingProductIndex(editingProductIndex - 1);
  };

  // Calculate total
  const totalAmount = useMemo(() => {
    return products.reduce((sum, p) => {
      const lineAmounts = calculateImportLineAmounts(p.giaNhap ?? p.import_price, p.soLuongNhap, p.chietKhau, p.thueGTGT ?? p.tax_percent ?? p.vat_percent);
      return sum + lineAmounts.lineTotal;
    }, 0);
  }, [products]);

  // Calculate total quantity, discount and tax
  const totalStats = useMemo(() => {
    return products.reduce((acc, p) => {
      const lineAmounts = calculateImportLineAmounts(p.giaNhap ?? p.import_price, p.soLuongNhap, p.chietKhau, p.thueGTGT ?? p.tax_percent ?? p.vat_percent);
      return {
        quantity: acc.quantity + lineAmounts.quantity,
        subtotal: acc.subtotal + lineAmounts.grossAmount,
        discountValue: acc.discountValue + lineAmounts.discountAmount,
        taxableValue: acc.taxableValue + lineAmounts.afterDiscount,
        taxValue: acc.taxValue + lineAmounts.taxAmount,
      };
    }, { quantity: 0, subtotal: 0, discountValue: 0, taxableValue: 0, taxValue: 0 });
  }, [products]);

  const selectedProductQuantityError = selectedProduct ? getImportQuantityInputError(selectedProduct.soLuongNhap) : '';
  const selectedProductLinePreview = useMemo(() => (
    selectedProduct
      ? calculateImportLineAmounts(
        selectedProduct.giaNhap ?? selectedProduct.import_price,
        selectedProduct.soLuongNhap,
        selectedProduct.chietKhau,
        selectedProduct.thueGTGT ?? selectedProduct.tax_percent ?? selectedProduct.vat_percent
      )
      : null
  ), [selectedProduct]);
  const productsQuantityError = useMemo(() => {
    const invalid = products.find(product => getImportQuantityInputError(product.soLuongNhap));
    return invalid ? getImportQuantityInputError(invalid.soLuongNhap) : '';
  }, [products]);
  const hasQuantityError = Boolean(productsQuantityError);

  const currentOrderDetailSignature = useMemo(
    () => buildPaymentDetailSignature(currentOrder?.chiTiet || []),
    [currentOrder?.chiTiet]
  );
  const formDetailSignature = useMemo(() => buildPaymentDetailSignature(products), [products]);
  const hasUnsavedPaymentAffectingChanges = useMemo(() => {
    if (!isEditingOrder || !currentOrder) return false;
    return Math.round(toNonNegativeMoney(currentOrder.tongTien, 0)) !== Math.round(toNonNegativeMoney(totalAmount, 0)) ||
      currentOrderDetailSignature !== formDetailSignature;
  }, [currentOrder, currentOrderDetailSignature, formDetailSignature, isEditingOrder, totalAmount]);

  const paymentSummary = useMemo(() => resolvePaymentAmounts({
    total: totalAmount,
    status: hasUnsavedPaymentAffectingChanges ? 'unpaid' : paymentStatus,
    paidAmount: currentOrder?.paid_amount,
    remainingAmount: currentOrder?.remaining_amount,
    forceUnpaidFull: hasUnsavedPaymentAffectingChanges,
  }), [currentOrder?.paid_amount, currentOrder?.remaining_amount, hasUnsavedPaymentAffectingChanges, paymentStatus, totalAmount]);

  useEffect(() => {
    if (!isEditingOrder || !currentOrder) return;
    const savedPaymentStatus = normalizePaymentStatusValue(currentOrder.payment_status);
    const currentPaymentStatus = normalizePaymentStatusValue(paymentStatus);

    if (hasUnsavedPaymentAffectingChanges) {
      if (currentPaymentStatus === 'paid') setPaymentStatus('unpaid');
      return;
    }

    if (currentPaymentStatus !== savedPaymentStatus) {
      setPaymentStatus(savedPaymentStatus);
    }
  }, [currentOrder, hasUnsavedPaymentAffectingChanges, isEditingOrder, paymentStatus]);

  const editingImportKey = currentOrder?.maDonHang || currentOrder?.id || null;
  const historySelectionKeys = useMemo(() => orderHistory.map(order => String(order.maDonHang || order.id)), [orderHistory]);
  const isAllHistorySelected = orderHistory.length > 0 && selectedHistoryIds.length === historySelectionKeys.length;

  const getPaymentLabel = (status) => normalizePaymentStatusValue(status) === 'paid' ? 'Đã thanh toán' : 'Chưa thanh toán';

  const getPaymentBadgeClass = (status) => normalizePaymentStatusValue(status) === 'paid'
    ? 'bg-green-100 text-green-700 border-green-200'
    : 'bg-orange-100 text-orange-700 border-orange-200';

  const mapImportToOrder = (imp) => {
    const details = Array.isArray(imp.details) ? imp.details : [];
    const status = imp.status || 'draft';
    const total = toNonNegativeMoney(imp.total, 0);
    const payment = resolvePaymentAmounts({
      total,
      status: imp.payment_status,
      paidAmount: imp.paid_amount,
      remainingAmount: imp.remaining_amount,
    });
    return {
      id: imp.id,
      maDonHang: imp.import_code,
      ngayLap: imp.created_at || imp.updated_at || new Date().toISOString(),
      nguoiNhap: imp.user_name || 'Người dùng',
      nhaCungCap: {
        id: imp.partner_id,
        maNCC: imp.partner_id,
        tenNCC: imp.partner_name || '—',
        diaChi: '',
        sdt: '',
        email: '',
      },
      chiTiet: details.map((d) => {
        const quantity = Math.max(0, Number(d.quantity) || 0);
        const importPrice = Math.max(0, Number(d.import_price) || 0);
        const discountPercent = clampImportPercent(d.discount_percent ?? d.discount);
        const taxPercent = clampImportPercent(d.tax_percent ?? d.vat_percent ?? d.thueGTGT);
        const lineAmounts = calculateImportLineAmounts(importPrice, quantity, discountPercent, taxPercent);
        return {
          maSP: d.sku || '',
          tenSP: d.product_name || '',
          soLuong: quantity,
          donVi: d.unit || 'cái',
          giaNhap: importPrice,
          retail_price: +d.retail_price || 0,
          wholesale_price: +d.wholesale_price || 0,
          chietKhau: discountPercent,
          thueGTGT: taxPercent,
          tienSauChietKhau: getFirstFiniteNumber(d.taxable_amount, lineAmounts.afterDiscount),
          thueGTGTAmount: getFirstFiniteNumber(d.tax_amount, d.vat_amount, lineAmounts.taxAmount),
          thanhTien: getFirstFiniteNumber(d.line_total, lineAmounts.lineTotal),
          product_id: d.product_id || null,
          variant_id: d.variant_id || null,
        };
      }),
      soSanPham: imp.detail_count || details.length,
      tongTien: total,
      tongSoLuong: details.reduce((sum, d) => sum + (+d.quantity || 0), 0),
      tongChietKhau: 0,
      ghiChu: imp.note || '',
      tags: [],
      trangThai: status === 'received' ? 'da_nhap' : status === 'cancelled' ? 'da_huy' : 'cho_nhap',
      payment_status: payment.payment_status,
      paid_amount: payment.paid_amount,
      remaining_amount: payment.remaining_amount,
      stock_applied: imp.stock_applied === true,
      stock_rolled_back: imp.stock_rolled_back === true,
      stock_status: imp.stock_status || '',
      cancelled_at: imp.cancelled_at || null,
    };
  };

  // Add tag
  const handleAddTag = (e) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      const newTag = tagInput.trim();
      if (!tags.includes(newTag)) {
        setTags([...tags, newTag]);
      }
      setTagInput('');
    }
  };

  // Remove tag
  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  // Generate order number for new frontend-created draft code; backend keeps this code on update.
  const generateOrderNumber = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `NH-${year}${month}-${random}`;
  };

  const buildImportPayload = (status, importCode) => ({
    ...(importCode ? { import_code: importCode } : {}),
    partner_id: selectedSupplier?.id || null,
    user_id: null,
    total: totalAmount,
    note: note || '',
    status,
    payment_status: paymentSummary.payment_status,
    paid_amount: paymentSummary.paid_amount,
    remaining_amount: paymentSummary.remaining_amount,
    details: products.map(p => {
      const lineAmounts = calculateImportLineAmounts(p.giaNhap ?? p.import_price, p.soLuongNhap, p.chietKhau, p.thueGTGT ?? p.tax_percent ?? p.vat_percent);
      return {
        product_id: toPayloadNumberId(p.product_id || p.id),
        variant_id: toPayloadNumberId(p.variant_id),
        product_name: p.tenSP || '',
        sku: p.maSP || '',
        quantity: lineAmounts.quantity,
        import_price: lineAmounts.price,
        retail_price: Math.max(0, getFirstFiniteNumber(p.retail_price)),
        wholesale_price: Math.max(0, getFirstFiniteNumber(p.wholesale_price)),
        discount_percent: lineAmounts.discountPercent,
        discount_amount: lineAmounts.discountAmount,
        tax_percent: lineAmounts.taxPercent,
        tax_amount: lineAmounts.taxAmount,
        vat_percent: lineAmounts.taxPercent,
        vat_amount: lineAmounts.taxAmount,
        line_subtotal: lineAmounts.grossAmount,
        taxable_amount: lineAmounts.afterDiscount,
        line_total: lineAmounts.lineTotal,
      };
    }),
  });

  const buildLocalOrderData = (status, importCode, result = {}) => ({
    id: result.import_id || currentOrder?.id || Date.now(),
    maDonHang: result.import_code || importCode,
    ngayLap: currentOrder?.ngayLap || new Date().toISOString(),
    nguoiNhap: currentOrder?.nguoiNhap || 'Người dùng',
    nhaCungCap: {
      id: selectedSupplier.id,
      maNCC: selectedSupplier.maNCC,
      tenNCC: selectedSupplier.tenNCC,
      diaChi: selectedSupplier.diaChi,
      sdt: selectedSupplier.sdt,
      email: selectedSupplier.email
    },
    chiTiet: products.map(p => {
      const lineAmounts = calculateImportLineAmounts(p.giaNhap ?? p.import_price, p.soLuongNhap, p.chietKhau, p.thueGTGT ?? p.tax_percent ?? p.vat_percent);
      return {
        maSP: p.maSP,
        tenSP: p.tenSP,
        soLuong: lineAmounts.quantity,
        donVi: p.donVi,
        giaNhap: lineAmounts.price,
        chietKhau: lineAmounts.discountPercent,
        thueGTGT: lineAmounts.taxPercent,
        tienSauChietKhau: lineAmounts.afterDiscount,
        thueGTGTAmount: lineAmounts.taxAmount,
        thanhTien: lineAmounts.lineTotal,
        product_id: p.product_id || p.id || null,
        variant_id: p.variant_id || null,
        retail_price: p.retail_price || 0,
        wholesale_price: p.wholesale_price || 0,
        row_key: getImportRowKey(p),
      };
    }),
    tongTien: totalAmount,
    tongSoLuong: totalStats.quantity,
    tongChietKhau: totalStats.discountValue,
    ghiChu: note,
    tags,
    trangThai: status === 'received' ? 'da_nhap' : 'cho_nhap',
    nguonNhap: currentOrder ? 'cap_nhat' : 'nhap_moi',
    payment_status: normalizePaymentStatusValue(result.payment_status || paymentSummary.payment_status),
    paid_amount: toNonNegativeMoney(result.paid_amount, paymentSummary.paid_amount),
    remaining_amount: toNonNegativeMoney(result.remaining_amount, paymentSummary.remaining_amount),
    stock_applied: result.stock_applied === true,
    stock_rolled_back: result.stock_rolled_back === true,
    stock_status: result.stock_status || (status === 'received' ? 'imported' : 'not_imported'),
  });

  const submitImportOrder = async (status) => {
    const errors = validateOrder();
    if (errors.length > 0) {
      if (productsQuantityError) showStockLimitToast(productsQuantityError);
      setError(errors.join('\n'));
      setTimeout(() => setError(null), 5000);
      return;
    }

    const isEditing = Boolean(isEditingOrder && editingImportKey);
    const nextImportCode = isEditing ? currentOrder.maDonHang : generateOrderNumber();
    const confirmMessage = isEditing
      ? `Cập nhật phiếu nhập ${nextImportCode}? Hệ thống sẽ sửa đúng phiếu hiện tại, không tạo phiếu/mã mới.`
      : status === 'received'
        ? 'Tạo và nhập hàng? Hành động này sẽ cập nhật số lượng tồn kho.'
        : 'Tạo đơn hàng (chưa nhập)? Đơn hàng sẽ được lưu vào hệ thống.';
    if (!window.confirm(confirmMessage)) return;

    setSaving(true);
    setError(null);

    try {
      const endpoint = isEditing ? `${API}/imports/${encodeURIComponent(editingImportKey)}` : `${API}/imports`;
      const result = await apiJsonChecked(endpoint, {
        method: isEditing ? 'PUT' : 'POST',
        body: buildImportPayload(status, nextImportCode),
      }, isEditing ? 'Không thể cập nhật phiếu nhập.' : 'Không thể tạo phiếu nhập.');
      const savedOrder = buildLocalOrderData(status, nextImportCode, result);
      setOrderHistory(prev => [savedOrder, ...prev.filter(o => o.maDonHang !== savedOrder.maDonHang && o.id !== savedOrder.id)]);

      setSuccess(
        isEditing
          ? `Phiếu ${savedOrder.maDonHang} đã được cập nhật. Trạng thái thanh toán: ${getPaymentLabel(savedOrder.payment_status)}.`
          : `Đơn hàng ${savedOrder.maDonHang} đã được tạo${status === 'received' ? ', nhập kho thành công' : ' và lưu tạm'}; thanh toán: ${getPaymentLabel(savedOrder.payment_status)}.`
      );
      setCurrentOrder(savedOrder);
      setIsEditingOrder(true);
      setPaymentStatus(savedOrder.payment_status || 'unpaid');
      setImportPickerSelections([]);
      setTimeout(() => {
        if (status === 'received' || result.stock_delta?.length > 0 || result.stock_mode) {
          window.dispatchEvent(new Event('kha-order-created'));
          broadcastSyncUpdate({
            reason: isEditing ? 'import-updated' : 'import-created',
            changedTables: ['imports', 'import_details', 'products'],
          });
          fetchAllProducts();
        } else {
          broadcastSyncUpdate({
            reason: isEditing ? 'import-draft-updated' : 'import-draft-created',
            changedTables: ['imports', 'import_details'],
          });
        }
        fetchImportHistory();
      }, 1200);
    } catch (err) {
      console.error('Error saving import order:', err);
      setError(err.message || 'Không thể lưu phiếu nhập. Vui lòng thử lại sau.');
    } finally {
      setSaving(false);
    }
  };

  const getCurrentImportStatus = () => currentOrder?.trangThai === 'da_nhap' ? 'received' : 'draft';

  // Create new draft, or update existing import while preserving its current stock status.
  const handleCreateOnly = async () => submitImportOrder(isEditingOrder ? getCurrentImportStatus() : 'draft');

  // Create and receive new order; for existing draft this can be used to receive stock once.
  const handleCreateAndReceive = async () => submitImportOrder('received');

  // Exit/Reset
  const handleExit = () => {
    if (products.length > 0 || note || tags.length > 0) {
      const confirmExit = window.confirm('Bạn có chắc chắn muốn thoát? Dữ liệu chưa lưu sẽ bị mất.');
      if (!confirmExit) return;
    }
    handleReset();
  };

  const handleOpenReturns = () => {
    setError(null);
    setSuccess('Chức năng hoàn trả hàng chưa được cấu hình trên giao diện. Vui lòng kiểm tra luồng hoàn trả hiện có hoặc cấu hình route hoàn trả.');
  };

  // Reset form
  const handleReset = () => {
    setProducts([]);
    setSelectedProduct(null);
    setEditingProductIndex(null);
    setImportPickerSelections([]);
    setSelectedSupplier(null);
    setSearchQuery('');
    setFilteredProducts([]);
    setSupplierSearchQuery('');
    setShowSearchResults(false);
    setShowSupplierResults(false);
    setNote('');
    setPaymentStatus('unpaid');
    setTags([]);
    setTagInput('');
    setError(null);
    setSuccess(null);
    setCurrentOrder(null);
    setIsEditingOrder(false);
  };

  // Load existing order for viewing/editing. edit=true enables PUT on save.
  const handleLoadOrder = async (order, edit = false) => {
    try {
      setSaving(true);
      setError(null);
      const fullOrder = mapImportToOrder(
        await apiJson(`${API}/imports/${encodeURIComponent(order.maDonHang || order.id)}`, {}, 'Không thể tải chi tiết phiếu nhập.')
      );
      setCurrentOrder(fullOrder);
      setIsEditingOrder(edit);
      setImportPickerSelections([]);
      setProducts((fullOrder.chiTiet || []).map((item) => {
        const row = {
          ...item,
          soLuongNhap: item.soLuong,
          chietKhau: clampImportPercent(item.chietKhau),
          thueGTGT: clampImportPercent(item.thueGTGT ?? item.tax_percent ?? item.vat_percent),
          tienSauChietKhau: item.tienSauChietKhau || 0,
          thueGTGTAmount: item.thueGTGTAmount || item.tax_amount || item.vat_amount || 0,
          thanhTien: item.thanhTien,
          giaNhap: item.giaNhap,
          import_price: item.giaNhap,
          retail_price: item.retail_price || 0,
          wholesale_price: item.wholesale_price || 0,
          donVi: item.donVi,
          tenSP: item.tenSP,
          maSP: item.maSP,
          id: item.product_id || item.id || null,
          product_id: item.product_id || null,
          variant_id: item.variant_id || null,
        };
        const lineAmounts = calculateImportLineAmounts(row.giaNhap, row.soLuongNhap, row.chietKhau, row.thueGTGT);
        return {
          ...row,
          tienSauChietKhau: row.tienSauChietKhau || lineAmounts.afterDiscount,
          thueGTGTAmount: row.thueGTGTAmount || lineAmounts.taxAmount,
          thanhTien: row.thanhTien || lineAmounts.lineTotal,
          row_key: getImportRowKey(row),
        };
      }));
      setNote(fullOrder.ghiChu || '');
      setPaymentStatus(fullOrder.payment_status || 'unpaid');
      setTags(fullOrder.tags || []);
      if (fullOrder.nhaCungCap) {
        setSelectedSupplier(fullOrder.nhaCungCap);
        setSupplierSearchQuery(fullOrder.nhaCungCap.tenNCC);
      } else {
        setSelectedSupplier(null);
        setSupplierSearchQuery('');
      }
      setSelectedProduct(null);
      setEditingProductIndex(null);
      setSearchQuery('');
      setFilteredProducts([]);
      setShowSearchResults(false);
      setSuccess(edit ? `Đang sửa phiếu ${fullOrder.maDonHang}. Khi lưu sẽ gọi API cập nhật, không tạo phiếu mới.` : `Đã tải phiếu ${fullOrder.maDonHang} để xem.`);
    } catch (err) {
      console.error('Error loading import order:', err);
      setError('Không thể tải chi tiết phiếu nhập.');
    } finally {
      setSaving(false);
    }
  };

  // Cancel order and let backend rollback stock exactly once if this import already applied stock
  const handleCancelOrder = async (order) => {
    const reason = prompt('Nhập lý do hủy đơn (không bắt buộc):', '');
    if (reason === null) return; // User cancelled

    const confirmCancel = window.confirm(
      `Hủy đơn hàng ${order.maDonHang}?\n\n` +
      'Nếu phiếu này đã nhập kho, hệ thống sẽ tự động trừ lại đúng số lượng đã cộng và chỉ rollback một lần.\n' +
      'Nếu phiếu chưa từng nhập kho, tồn kho sẽ không bị thay đổi.\n\n' +
      `Lý do: ${reason || 'Không có'}\n\n` +
      'Bạn có chắc chắn?'
    );

    if (!confirmCancel) return;

    try {
      setSaving(true);
      setError(null);

      const result = await apiJsonChecked(`${API}/imports/${order.maDonHang}/cancel`, {
        method: 'POST',
        body: { lyDo: reason, rollbackStock: true }
      }, 'Không thể hủy đơn hàng');
      setSuccess(`Đơn hàng ${order.maDonHang} đã được hủy${result.rollback_stock ? ' và đã rollback tồn kho' : ''}.`);

      // Remove from local history if present
      if (currentOrder?.maDonHang === order.maDonHang) {
        handleReset();
      }

      // Refresh order list if displayed
      setOrderHistory(prev => prev.map(o =>
        o.maDonHang === order.maDonHang
          ? {
            ...o,
            trangThai: 'da_huy',
            payment_status: 'unpaid',
            paid_amount: 0,
            remaining_amount: o.tongTien || 0,
            ngayHuy: new Date().toISOString(),
            stock_rolled_back: result.stock_rolled_back === true,
            stock_status: result.rollback_stock ? 'rolled_back' : o.stock_status,
          }
          : o
      ));
      fetchAllProducts();

    } catch (err) {
      console.error('Error cancelling order:', err);
      setError('Không thể hủy đơn hàng. Vui lòng thử lại sau.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOrder = async (order) => {
    const confirmDelete = window.confirm(
      `Xóa phiếu nhập ${order.maDonHang}?\n\n` +
      'Nếu phiếu đã nhập kho, backend sẽ rollback tồn kho đúng một lần trước khi ẩn khỏi danh sách.\n' +
      'Thao tác này không tạo phiếu mới và không rollback lặp nếu gọi lại.'
    );
    if (!confirmDelete) return;

    try {
      setSaving(true);
      setError(null);
      const response = await fetch(`${API}/imports/${encodeURIComponent(order.maDonHang || order.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'deleted from import UI' }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Không thể xóa phiếu nhập');
      }
      const result = await response.json();
      setOrderHistory(prev => prev.filter(o => o.maDonHang !== order.maDonHang && o.id !== order.id));
      if (currentOrder?.maDonHang === order.maDonHang || currentOrder?.id === order.id) {
        handleReset();
      }
      setSuccess(`Phiếu ${order.maDonHang} đã được xóa${result.rollback_stock ? ' và đã rollback tồn kho' : ''}.`);
      fetchAllProducts();
    } catch (err) {
      console.error('Error deleting import order:', err);
      setError(err.message || 'Không thể xóa phiếu nhập. Vui lòng thử lại sau.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleHistoryRow = (order) => {
    const key = String(order.maDonHang || order.id);
    setSelectedHistoryIds(prev => prev.includes(key) ? prev.filter(id => id !== key) : [...prev, key]);
  };

  const handleToggleAllHistory = () => {
    setSelectedHistoryIds(isAllHistorySelected ? [] : historySelectionKeys);
  };

  const handleDeleteSelectedOrders = async () => {
    if (selectedHistoryIds.length === 0) return;
    const confirmDelete = window.confirm(
      `Xóa ${selectedHistoryIds.length} phiếu nhập đã chọn?\n\n` +
      'Backend sẽ rollback tồn kho đúng một lần cho từng phiếu đã nhập kho và bỏ qua rollback lặp.'
    );
    if (!confirmDelete) return;

    try {
      setSaving(true);
      setError(null);
      const response = await fetch(`${API}/imports/bulk`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_codes: selectedHistoryIds, reason: 'bulk deleted from import UI' }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Không thể xóa hàng loạt phiếu nhập');
      }
      const result = await response.json();
      setOrderHistory(prev => prev.filter(o => !selectedHistoryIds.includes(String(o.maDonHang || o.id))));
      if (currentOrder && selectedHistoryIds.includes(String(currentOrder.maDonHang || currentOrder.id))) {
        handleReset();
      }
      setSelectedHistoryIds([]);
      setSuccess(`Đã xóa ${result.deleted_count || 0} phiếu nhập${result.rollback_count ? `, rollback tồn kho ${result.rollback_count} phiếu` : ''}.`);
      fetchAllProducts();
    } catch (err) {
      console.error('Error bulk deleting import orders:', err);
      setError(err.message || 'Không thể xóa hàng loạt phiếu nhập. Vui lòng thử lại sau.');
    } finally {
      setSaving(false);
    }
  };

  const handlePayCurrentOrder = async () => {
    if (!editingImportKey) {
      setError('Vui lòng tạo hoặc chọn phiếu nhập trước khi thanh toán.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    if (hasUnsavedPaymentAffectingChanges) {
      setError('Phiếu nhập đang có thay đổi sản phẩm hoặc tổng tiền chưa lưu. Vui lòng cập nhật phiếu trước khi thanh toán để tránh sai công nợ.');
      setTimeout(() => setError(null), 5000);
      return;
    }
    if (paymentSummary.payment_status === 'paid') {
      setSuccess('Phiếu nhập hiện tại đã được thanh toán.');
      setTimeout(() => setSuccess(null), 3000);
      return;
    }

    const confirmPay = window.confirm(
      `Thanh toán phiếu nhập ${currentOrder?.maDonHang || editingImportKey}?\n\n` +
      'Thao tác này chỉ cập nhật phiếu hiện tại sang đã thanh toán và ghi nhận sổ quỹ/công nợ liên quan, không tạo phiếu mới và không thay đổi tồn kho.'
    );
    if (!confirmPay) return;

    try {
      setSaving(true);
      setError(null);
      const response = await fetch(`${API}/imports/${encodeURIComponent(editingImportKey)}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: `Thanh toán phiếu nhập ${currentOrder?.maDonHang || editingImportKey}` }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Không thể thanh toán phiếu nhập');
      }
      const result = await response.json();
      const paidStatus = normalizePaymentStatusValue(result.payment_status || 'paid');
      setPaymentStatus(paidStatus);
      setCurrentOrder(prev => {
        if (!prev) return prev;
        const nextPayment = resolvePaymentAmounts({
          total: prev.tongTien || totalAmount,
          status: paidStatus,
          paidAmount: result.paid_amount,
          remainingAmount: result.remaining_amount,
        });
        return {
          ...prev,
          payment_status: nextPayment.payment_status,
          paid_amount: nextPayment.paid_amount,
          remaining_amount: nextPayment.remaining_amount,
        };
      });
      setOrderHistory(prev => prev.map(order => {
        const targetKeys = [editingImportKey, result.import_code, result.import_id]
          .filter(hasImportValue)
          .map(value => String(value));
        const orderKeys = [order.maDonHang, order.id]
          .filter(hasImportValue)
          .map(value => String(value));
        const isTargetOrder = orderKeys.some(key => targetKeys.includes(key));
        if (!isTargetOrder) return order;
        const nextPayment = resolvePaymentAmounts({
          total: order.tongTien,
          status: paidStatus,
          paidAmount: result.paid_amount,
          remainingAmount: result.remaining_amount,
        });
        return { ...order, ...nextPayment };
      }));
      fetchImportHistory();
      setSuccess(`Phiếu ${result.import_code || editingImportKey} đã được thanh toán, không tạo phiếu mới và không đổi tồn kho.`);
    } catch (err) {
      console.error('Error paying import order:', err);
      setError(err.message || 'Không thể thanh toán phiếu nhập. Vui lòng thử lại sau.');
    } finally {
      setSaving(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl + Enter to add product and keep searching for the next one
      if (e.ctrlKey && e.key === 'Enter' && selectedProduct) {
        e.preventDefault();
        handleAddProduct({ keepSearching: true });
      }
      // Enter to add product, Shift+Enter to add and continue searching
      if (e.key === 'Enter' && selectedProduct && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        handleAddProduct({ keepSearching: e.shiftKey });
      }
      // Escape to close search
      if (e.key === 'Escape') {
        if (showSearchResults) setShowSearchResults(false);
        if (showSupplierResults) setShowSupplierResults(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProduct, showSearchResults, showSupplierResults]);

  const isPaymentButtonDisabled = saving || !editingImportKey || paymentSummary.payment_status === 'paid' || hasUnsavedPaymentAffectingChanges;

  return (
    <div className="sapo-screen sapo-import-page min-w-0">
      {stockToast && (
        <div className="toast-stack">
          <div className="toast-card border-red-200 bg-red-50 text-red-700">
            ⚠️ {stockToast.message}
          </div>
        </div>
      )}
      {/* Header khu vực nhập hàng */}
      <div className="sapo-topbar">
        <button
          type="button"
          onClick={handleExit}
          disabled={saving}
          className="sapo-page-title inline-flex items-center gap-2 disabled:opacity-60"
        >
          <span className="text-xl leading-none text-gray-400">‹</span>
          Quay lại danh sách đơn nhập
          {currentOrder && <span className="text-xs font-medium text-gray-400">{isEditingOrder ? 'Đang sửa' : 'Đang xem'} {currentOrder.maDonHang}</span>}
        </button>
        <div className="sapo-actions">
          <button type="button" onClick={handleOpenReturns} disabled={saving} className="sapo-btn">
            <RotateCcw className="w-4 h-4" />
            Hoàn trả hàng
          </button>
          <button onClick={handleExit} disabled={saving} className="sapo-btn">
            Thoát
          </button>
          <button
            onClick={handleCreateOnly}
            disabled={saving || products.length === 0 || !selectedSupplier || hasQuantityError}
            className="sapo-btn"
          >
            {isEditingOrder ? 'Cập nhật phiếu' : 'Tạo & chưa nhập'}
          </button>
          <button
            onClick={handleCreateAndReceive}
            disabled={saving || products.length === 0 || !selectedSupplier || hasQuantityError}
            className="sapo-btn sapo-btn-primary"
          >
            {isEditingOrder ? 'Cập nhật & nhập hàng' : 'Tạo & nhập hàng'}
          </button>
        </div>
      </div>

      <div className="sapo-shell">
        {/* Alerts */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-400 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-700 whitespace-pre-line">{error}</div>
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border-l-4 border-green-400 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-green-700">{success}</div>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* Left Column - Input Form */}
          <div className="min-w-0 space-y-4">
            {/* Supplier & Product Search Card */}
            <div className="sapo-card">
              <div className="sapo-card-header">
                <h2>Thông tin nhà cung cấp</h2>
              </div>
              <div className="p-4 space-y-4">
                {/* Supplier Search */}
                <div className="relative" ref={supplierSearchContainerRef}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Building className="inline w-4 h-4 mr-1" />
                    Nhà cung cấp
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      ref={supplierInputRef}
                      value={supplierSearchQuery}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        if (selectedSupplier && !prepareSupplierChange(null)) {
                          setSupplierSearchQuery(selectedSupplier.tenNCC || '');
                          return;
                        }
                        setSupplierSearchQuery(nextValue);
                        setShowAllSuppliers(false); // Khi gõ thì chuyển sang mode search
                        setSelectedSupplier(null);
                        setError(null);
                      }}
                      onFocus={() => {
                        setShowSupplierResults(true);
                        setShowAllSuppliers(true); // Hiển thị full khi focus
                      }}
                      placeholder="Tìm theo tên, SĐT, mã nhà cung cấp... (F4)"
                      className="input-field w-full pl-10 pr-4 text-sm"
                      disabled={saving}
                    />
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />

                    {/* Loading indicator */}
                    {loading && (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}

                    {/* Supplier Dropdown */}
                    {showSupplierResults && (
                      <div
                        ref={supplierResultsRef}
                        className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto"
                      >
                        {/* Show filtered results if typing or show all if focus without typing */}
                        {(supplierSearchQuery || showAllSuppliers) ? (
                          loading && supplierSearchQuery ? (
                            <div className="p-3 text-center text-sm text-gray-500">Đang tìm kiếm...</div>
                          ) : filteredSuppliers.length > 0 ? (
                            filteredSuppliers.map(supplier => (
                              <div
                                key={supplier.id}
                                onClick={() => handleSelectSupplier(supplier)}
                                className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-medium text-gray-900 text-sm">{supplier.name}</span>
                                  <span className="text-xs text-gray-500">({supplier.id || supplier.maNCC || 'N/A'})</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-0.5">
                                  {supplier.address || '—'}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="p-3 text-sm text-gray-500 text-center">Không tìm thấy</div>
                          )
                        ) : (
                          // Show all suppliers when dropdown opens without typing
                          suppliers.map(supplier => (
                            <div
                              key={supplier.id}
                              onClick={() => handleSelectSupplier(supplier)}
                              className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-gray-900 text-sm">{supplier.name}</span>
                                <span className="text-xs text-gray-500">({supplier.id || supplier.maNCC || 'N/A'})</span>
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {supplier.address || '—'}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Selected Supplier Badge */}
                  {selectedSupplier && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-100 text-green-700 rounded-md text-sm">
                        <Building className="w-3 h-3" />
                        {selectedSupplier.tenNCC}
                      </span>
                      <button
                        onClick={handleClearSupplier}
                        className="text-gray-400 hover:text-gray-600"
                        disabled={saving}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Product Search */}
                <div className="relative border-t border-gray-100 pt-4" ref={productSearchContainerRef}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      <Search className="inline w-4 h-4 mr-1" />
                      Thông tin sản phẩm <span className="text-red-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleStartAddProduct}
                      disabled={saving || !selectedSupplier}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Thêm sản phẩm
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setShowSearchResults(true);
                        setSelectedProduct(null);
                        setError(null);
                      }}
                      onFocus={() => {
                        if (!selectedSupplier) {
                          showSupplierRequiredHint();
                          return;
                        }
                        setFilteredProducts(getScopedProductSearchResults(searchQuery));
                        setShowSearchResults(true);
                      }}
                      placeholder={selectedSupplier ? 'Tìm theo tên, mã SKU, hoặc quét mã Barcode...(F3)' : 'Chọn nhà cung cấp trước khi thêm sản phẩm...'}
                      className="input-field w-full pl-10 pr-4 text-sm disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
                      aria-disabled={saving || !selectedSupplier}
                      disabled={saving || !selectedSupplier}
                    />
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />

                    {/* Loading indicator */}
                    {loading && (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}

                    {/* Product Dropdown */}
                    {showSearchResults && (
                      <div
                        ref={searchResultsRef}
                        className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg p-2"
                      >
                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                          <div className="max-h-72 overflow-y-auto scroll-smooth rounded-lg border border-gray-100 bg-white">
                            {loading ? (
                              <div className="p-3 text-center text-sm text-gray-500">Đang tìm kiếm...</div>
                            ) : filteredProducts.length > 0 ? (
                              filteredProducts.map(product => {
                                // Map price from API field
                                const price = product.retail_price || product.import_price || product.giaNhap || 0;
                                const isVariant = isImportVariantProduct(product, product.parent || null);
                                const name = isVariant ? getProductDisplayName(product, product.parent || null) : (product.name || product.tenSP || '');
                                const sku = product.sku || product.maSP || '';
                                const unit = product.unit || product.donVi || 'cái';
                                const categoryName = product.default_category?.name || product.category || '';
                                const parentName = !isVariant ? (product.parent_name || product.parent?.name || '') : '';
                                const availableQuantity = getProductAvailableQuantity(product);
                                return (
                                  <div
                                    key={`${product.is_variant ? 'v' : 'p'}-${product.id}`}
                                    onClick={() => editingProductIndex !== null ? handleSelectProduct(product) : handleAddImportPickerSelection(product)}
                                    className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="font-medium text-gray-900 text-sm min-w-0 flex items-center gap-2">
                                        <span className="truncate">{name}{parentName ? <span className="text-xs text-gray-400"> · {parentName}</span> : null}</span>
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            editingProductIndex !== null ? handleSelectProduct(product) : handleAddImportPickerSelection(product);
                                          }}
                                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow hover:bg-emerald-700"
                                          title="Thêm sản phẩm vào danh sách tạm"
                                        >
                                          <Plus className="w-3.5 h-3.5" />
                                        </button>
                                      </span>
                                      <span className="text-xs text-gray-500 shrink-0">({sku})</span>
                                    </div>
                                    <div className="flex items-center justify-between mt-1 gap-3">
                                      <span className="text-xs text-gray-500">
                                        Đơn vị: {unit}{categoryName ? ` · ${categoryName}` : ''} · Số lượng: {availableQuantity.toLocaleString('vi-VN')}
                                      </span>
                                      <span className="text-sm font-medium text-blue-600 whitespace-nowrap">
                                        {formatVND(price)}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              <div className="p-3 text-sm text-gray-500 text-center">
                                {searchQuery.trim() ? 'Không có sản phẩm phù hợp' : 'Chưa có sản phẩm trong hệ thống'}
                              </div>
                            )}
                          </div>
                          {renderImportPickerSelections()}
                        </div>
                      </div>
                    )}
                  </div>
                  {!selectedSupplier && (
                    <p className="mt-2 text-xs text-amber-600">Chọn nhà cung cấp trước để thêm nhiều sản phẩm vào phiếu nhập.</p>
                  )}
                  {selectedSupplier && (
                    <p className="mt-2 text-xs text-gray-500">Đã chọn nhà cung cấp: {selectedSupplier.tenNCC}. Bấm nút + cạnh tên để chọn nhiều sản phẩm, sau đó bấm Chọn xong để thêm vào phiếu nhập.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Selected Product Card */}
            {selectedProduct && (
              <div className={`bg-white rounded-lg border shadow-sm ${selectedProductQuantityError ? 'border-red-300 ring-1 ring-red-200' : 'border-gray-200'}`}>
                <div className="p-4 border-b border-gray-200 bg-blue-50 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-blue-900 flex items-center gap-2">
                      <Package className="w-4 h-4 shrink-0" />
                      {editingProductIndex !== null ? `Cập nhật dòng #${editingProductIndex + 1}` : 'Thêm sản phẩm vào phiếu'}
                    </h2>
                    <p className="text-sm text-blue-700 mt-0.5 truncate" title={selectedProduct.tenSP}>{selectedProduct.tenSP} · Mã: {selectedProduct.maSP || 'N/A'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetProductSearchState}
                    disabled={saving}
                    className="text-blue-600 hover:text-blue-800 disabled:text-blue-300 p-1"
                    title="Hủy chọn sản phẩm"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <label className="block min-w-0">
                      <span className="block text-xs font-medium text-gray-600 mb-1">Số lượng</span>
                      <input
                        type="number"
                        min="0.0001"
                        step="1"
                        value={selectedProduct.soLuongNhap ?? ''}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          const nextLine = calculateImportLineAmounts(
                            selectedProduct.giaNhap ?? selectedProduct.import_price,
                            nextValue,
                            selectedProduct.chietKhau,
                            selectedProduct.thueGTGT ?? selectedProduct.tax_percent ?? selectedProduct.vat_percent
                          );
                          setSelectedProduct({
                            ...selectedProduct,
                            soLuongNhap: nextValue,
                            tienSauChietKhau: nextLine.afterDiscount,
                            thueGTGTAmount: nextLine.taxAmount,
                            thanhTien: nextLine.lineTotal
                          });
                        }}
                        className={`min-h-10 w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${selectedProductQuantityError ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-300'}`}
                        disabled={saving}
                      />
                      {selectedProductQuantityError && <span className="mt-1 block text-xs font-medium text-red-600">{selectedProductQuantityError}</span>}
                    </label>
                    <label className="block min-w-0">
                      <span className="block text-xs font-medium text-gray-600 mb-1">Giá nhập</span>
                      <input
                        type="number"
                        min="0"
                        step="1000"
                        value={selectedProduct.giaNhap ?? selectedProduct.import_price ?? 0}
                        onChange={(e) => {
                          const nextPrice = Math.max(0, Number(e.target.value) || 0);
                          const nextLine = calculateImportLineAmounts(nextPrice, selectedProduct.soLuongNhap, selectedProduct.chietKhau, selectedProduct.thueGTGT);
                          setSelectedProduct({
                            ...selectedProduct,
                            giaNhap: nextPrice,
                            import_price: nextPrice,
                            tienSauChietKhau: nextLine.afterDiscount,
                            thueGTGTAmount: nextLine.taxAmount,
                            thanhTien: nextLine.lineTotal
                          });
                        }}
                        className="min-h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={saving}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="block text-xs font-medium text-gray-600 mb-1">Chiết khấu (%)</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={selectedProduct.chietKhau ?? 0}
                        onChange={(e) => {
                          const nextDiscount = clampImportPercent(e.target.value);
                          const nextLine = calculateImportLineAmounts(selectedProduct.giaNhap ?? selectedProduct.import_price, selectedProduct.soLuongNhap, nextDiscount, selectedProduct.thueGTGT);
                          setSelectedProduct({
                            ...selectedProduct,
                            chietKhau: nextDiscount,
                            tienSauChietKhau: nextLine.afterDiscount,
                            thueGTGTAmount: nextLine.taxAmount,
                            thanhTien: nextLine.lineTotal
                          });
                        }}
                        className="min-h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={saving}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="block text-xs font-medium text-gray-600 mb-1">Thuế GTGT (%)</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={selectedProduct.thueGTGT ?? 0}
                        onChange={(e) => {
                          const nextTaxPercent = clampImportPercent(e.target.value);
                          const nextLine = calculateImportLineAmounts(selectedProduct.giaNhap ?? selectedProduct.import_price, selectedProduct.soLuongNhap, selectedProduct.chietKhau, nextTaxPercent);
                          setSelectedProduct({
                            ...selectedProduct,
                            thueGTGT: nextTaxPercent,
                            tienSauChietKhau: nextLine.afterDiscount,
                            thueGTGTAmount: nextLine.taxAmount,
                            thanhTien: nextLine.lineTotal
                          });
                        }}
                        className="min-h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={saving}
                      />
                    </label>
                  </div>

                  {selectedProductLinePreview && (
                    <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                      <div><div className="text-xs text-gray-500">Tiền hàng</div><div className="font-semibold text-gray-900">{formatVND(selectedProductLinePreview.grossAmount)}</div></div>
                      <div><div className="text-xs text-gray-500">Sau chiết khấu</div><div className="font-semibold text-gray-900">{formatVND(selectedProductLinePreview.afterDiscount)}</div></div>
                      <div><div className="text-xs text-gray-500">Thuế GTGT</div><div className="font-semibold text-gray-900">{formatVND(selectedProductLinePreview.taxAmount)}</div></div>
                      <div><div className="text-xs text-gray-500">Thành tiền</div><div className="text-lg font-bold text-green-600">{formatVND(selectedProductLinePreview.lineTotal)}</div></div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button onClick={() => handleAddProduct({ keepSearching: false })} disabled={saving || Boolean(selectedProductQuantityError)} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-md flex items-center justify-center gap-2 text-sm">
                      <Plus className="w-4 h-4" />
                      {editingProductIndex !== null ? 'Cập nhật dòng sản phẩm' : 'Thêm vào danh sách'}
                    </button>
                    <button onClick={() => handleAddProduct({ keepSearching: true })} disabled={saving || Boolean(selectedProductQuantityError)} className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-medium py-2 px-4 rounded-md flex items-center justify-center gap-2 text-sm" title="Thêm sản phẩm và giữ nguyên ô tìm kiếm để nhập tiếp">
                      <Search className="w-4 h-4" />
                      Thêm và tìm tiếp
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Product List Table */}
            {(
              <div className="sapo-card min-w-0">
                <div className="sapo-card-header flex-wrap">
                  <h2>Thông tin sản phẩm</h2>
                  <button type="button" onClick={handleStartAddProduct} disabled={saving || !selectedSupplier} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"><Plus className="w-4 h-4" />Thêm sản phẩm</button>
                </div>
                <div className="w-full max-w-full overflow-x-auto">
                  <table className="w-full min-w-[960px]">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-12">STT</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-16">Ảnh</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider min-w-[240px]">Tên sản phẩm</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">Đơn vị</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-32">Số lượng</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-36">Giá nhập</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-32">Chiết khấu</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-32">Thuế GTGT</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-36">Thành tiền</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-16">Xóa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {products.map((product, index) => {
                        const lineAmounts = calculateImportLineAmounts(product.giaNhap ?? product.import_price, product.soLuongNhap, product.chietKhau, product.thueGTGT ?? product.tax_percent ?? product.vat_percent);
                        const rowQuantityError = getImportQuantityInputError(product.soLuongNhap);
                        return (
                          <tr key={`${getImportRowKey(product) || 'row'}-${index}`} className={`hover:bg-gray-50 ${editingProductIndex === index ? 'bg-blue-50' : rowQuantityError ? 'bg-red-50/50' : ''}`}>
                            <td className="px-4 py-3 text-sm text-gray-600 align-top">{index + 1}</td>
                            <td className="px-4 py-3 text-center align-top">
                              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded bg-gray-100 text-gray-300">
                                <Package className="w-5 h-5" />
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm font-medium text-gray-900 align-top"><div className="min-w-0"><div className="truncate" title={product.tenSP}>{product.tenSP}</div><div className="mt-1 text-xs text-gray-500 truncate" title={product.maSP || ''}>Mã: {product.maSP || 'N/A'}</div><button type="button" onClick={() => handleEditProductRow(index)} disabled={saving} className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:text-blue-300">Đổi sản phẩm</button></div></td>
                            <td className="px-4 py-3 text-sm text-gray-600 align-top">{product.donVi || product.unit || 'cái'}</td>
                            <td className="px-4 py-3 align-top"><input type="number" min="0.0001" step="1" value={product.soLuongNhap ?? ''} onChange={(e) => handleUpdateProduct(index, 'soLuongNhap', e.target.value)} className={`min-h-10 w-full rounded-md border px-2 py-2 text-right text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${rowQuantityError ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-300'}`} disabled={saving} />{rowQuantityError && <div className="mt-1 text-[11px] font-medium text-red-600">{rowQuantityError}</div>}</td>
                            <td className="px-4 py-3 align-top"><input type="number" min="0" step="1000" value={lineAmounts.price} onChange={(e) => handleUpdateProduct(index, 'giaNhap', e.target.value)} className="min-h-10 w-full rounded-md border border-gray-300 px-2 py-2 text-right text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500" disabled={saving} /></td>
                            <td className="px-4 py-3 align-top"><div className="flex items-center gap-1"><input type="number" min="0" max="100" step="0.1" value={lineAmounts.discountPercent} onChange={(e) => handleUpdateProduct(index, 'chietKhau', e.target.value)} className="min-h-10 w-full rounded-md border border-gray-300 px-2 py-2 text-right text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500" disabled={saving} /><span className="text-xs text-gray-500">%</span></div></td>
                            <td className="px-4 py-3 align-top"><div className="flex items-center gap-1"><input type="number" min="0" max="100" step="0.1" value={lineAmounts.taxPercent} onChange={(e) => handleUpdateProduct(index, 'thueGTGT', e.target.value)} className="min-h-10 w-full rounded-md border border-gray-300 px-2 py-2 text-right text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500" disabled={saving} /><span className="text-xs text-gray-500">%</span></div></td>
                            <td className="px-4 py-3 text-sm font-semibold text-green-600 text-right align-top"><div>{formatVND(lineAmounts.lineTotal)}</div><div className="mt-1 text-[11px] font-normal text-gray-500">Thuế: {formatVND(lineAmounts.taxAmount)}</div></td>
                            <td className="px-4 py-3 text-center align-top"><button type="button" onClick={() => handleRemoveProduct(index)} disabled={saving} className="text-gray-400 hover:text-red-600 disabled:text-gray-300 transition-colors p-1" title="Xóa dòng"><X className="w-4 h-4" /></button></td>
                          </tr>
                        );
                      })}
                      {products.length === 0 && (
                        <tr>
                          <td colSpan="10" className="px-4 py-16 text-center text-sm text-gray-400">
                            <div className="sticky left-0 flex w-[520px] max-w-[calc(100vw-4rem)] flex-col items-center">
                              <Package className="mb-3 h-12 w-12 text-gray-200" />
                              <div className="mb-4">Đơn hàng nhập của bạn chưa có sản phẩm nào</div>
                              <button type="button" onClick={handleStartAddProduct} disabled={saving || !selectedSupplier} className="sapo-btn">
                                Thêm sản phẩm
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t border-gray-200"><tr><td colSpan="5" className="px-4 py-3 text-right text-sm text-gray-600">Tổng ({totalStats.quantity.toLocaleString('vi-VN')} sản phẩm)</td><td colSpan="3" className="px-4 py-3 text-right text-sm text-gray-600"><div>Chiết khấu: <span className="font-medium">{formatVND(totalStats.discountValue)}</span></div><div>Thuế GTGT: <span className="font-medium">{formatVND(totalStats.taxValue)}</span></div></td><td className="px-4 py-3 text-right"><div className="text-lg font-bold text-green-600">{formatVND(totalAmount)}</div></td><td></td></tr></tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* Notes & Tags Card */}
            <div className="sapo-card">
              <div className="sapo-card-header">
                <h2>Ghi chú đơn</h2>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <FileText className="w-4 h-4 text-gray-400" />
                    Ghi chú đơn
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows="3"
                    placeholder="Nhập ghi chú..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm resize-none"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <Tag className="w-4 h-4 text-gray-400" />
                    Tags
                  </label>
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    placeholder="Nhấn Enter để thêm tag..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm mb-2"
                    disabled={saving}
                  />
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 rounded-md text-sm"
                        >
                          {tag}
                          <button
                            onClick={() => handleRemoveTag(tag)}
                            disabled={saving}
                            className="hover:text-blue-900 disabled:text-blue-400"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>

          {/* Right Column - Summary Card */}
          <div className="min-w-0">
            <div className="sapo-card lg:sticky lg:top-20">
              <div className="sapo-card-header">
                <h2>Thông tin đơn nhập hàng</h2>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Chi nhánh</label>
                  <input className="input-field w-full bg-gray-50" value={store?.name || 'Chi nhánh mặc định'} readOnly />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Nhân viên</label>
                  <input className="input-field w-full bg-gray-50" value={currentOrder?.nguoiNhap || 'Người dùng'} readOnly />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Ngày hẹn giao</label>
                  <input className="input-field w-full" type="date" disabled={saving} />
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100"><span className="text-sm text-gray-600">Sản phẩm</span><span className="text-sm font-semibold text-gray-900">{products.length}</span></div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100"><span className="text-sm text-gray-600">Tổng số lượng</span><span className="text-sm font-semibold text-gray-900">{totalStats.quantity.toLocaleString('vi-VN')}</span></div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100"><span className="text-sm text-gray-600">Tiền hàng</span><span className="text-sm font-semibold text-gray-900">{formatVND(totalStats.subtotal)}</span></div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100"><span className="text-sm text-gray-600">Tổng chiết khấu</span><span className="text-sm font-semibold text-red-600">-{formatVND(totalStats.discountValue)}</span></div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100"><span className="text-sm text-gray-600">Tiền sau chiết khấu</span><span className="text-sm font-semibold text-gray-900">{formatVND(totalStats.taxableValue)}</span></div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100"><span className="text-sm text-gray-600">Thuế GTGT</span><span className="text-sm font-semibold text-gray-900">{formatVND(totalStats.taxValue)}</span></div>
                <div className="pt-2"><div className="flex items-center justify-between"><span className="text-base font-semibold text-gray-900">Tổng thanh toán</span></div><div className="text-2xl font-bold text-green-600 mt-1 break-words">{formatVND(totalAmount)}</div></div>

                {/* Payment Status */}
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase">Thanh toán</h3>
                    <span className={`inline-flex px-2.5 py-1 rounded-full border text-xs font-medium ${getPaymentBadgeClass(paymentSummary.payment_status)}`}>
                      {getPaymentLabel(paymentSummary.payment_status)}
                    </span>
                  </div>
                  <button
                    onClick={handlePayCurrentOrder}
                    disabled={isPaymentButtonDisabled}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-md flex items-center justify-center gap-2 text-sm shadow-sm"
                  >
                    <CreditCard className="w-4 h-4" />
                    {paymentSummary.payment_status === 'paid' ? 'Đã thanh toán' : 'Thanh toán'}
                  </button>
                  <p className={`mt-2 text-xs ${hasUnsavedPaymentAffectingChanges ? 'text-orange-600' : 'text-gray-500'}`}>
                    {hasUnsavedPaymentAffectingChanges
                      ? 'Phiếu đã đổi sản phẩm hoặc tổng tiền; hãy cập nhật phiếu trước khi thanh toán lại để công nợ chính xác.'
                      : editingImportKey
                      ? 'Nút này chỉ cập nhật phiếu hiện tại, không tạo phiếu mới và không thay đổi tồn kho.'
                      : 'Cần tạo hoặc chọn phiếu nhập trước khi thanh toán.'}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-50 rounded-md p-2">
                      <div className="text-gray-500">Đã trả</div>
                      <div className="font-semibold text-gray-900">{formatVND(paymentSummary.paid_amount)}</div>
                    </div>
                    <div className="bg-gray-50 rounded-md p-2">
                      <div className="text-gray-500">Còn phải trả</div>
                      <div className="font-semibold text-gray-900">{formatVND(paymentSummary.remaining_amount)}</div>
                    </div>
                  </div>
                </div>

                {/* Supplier Info Summary */}
                {selectedSupplier && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Nhà cung cấp</h3>
                    <div className="bg-gray-50 rounded-md p-3">
                      <p className="text-sm font-medium text-gray-900">{selectedSupplier.tenNCC}</p>
                      <p className="text-xs text-gray-600 mt-1">Mã: {selectedSupplier.maNCC}</p>
                      <p className="text-xs text-gray-600">{selectedSupplier.diaChi}</p>
                    </div>
                  </div>
                )}

                {/* Quick Actions */}
                <div className="pt-4 space-y-2">
                  {(!isEditingOrder || currentOrder?.trangThai === 'cho_nhap') && (
                    <button
                      onClick={handleCreateAndReceive}
                      disabled={saving || products.length === 0 || !selectedSupplier || hasQuantityError}
                      className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium py-2.5 px-4 rounded-md flex items-center justify-center gap-2 text-sm shadow-sm"
                    >
                      <Package className="w-4 h-4" />
                      {isEditingOrder ? 'Cập nhật & Nhập hàng' : 'Tạo & Nhập hàng'}
                    </button>
                  )}
                  <button
                    onClick={handleCreateOnly}
                    disabled={saving || products.length === 0 || !selectedSupplier || hasQuantityError}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 px-4 rounded-md flex items-center justify-center gap-2 text-sm shadow-sm"
                  >
                    <Save className="w-4 h-4" />
                    {isEditingOrder ? 'Cập nhật phiếu' : 'Tạo & Lưu tạm'}
                  </button>
                </div>

                {(!selectedSupplier || products.length === 0) && (
                  <p className="text-xs text-gray-500 text-center">
                    {!selectedSupplier ? 'Vui lòng chọn nhà cung cấp' : 'Vui lòng thêm sản phẩm'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Order History */}
        {orderHistory.length > 0 && (
          <div className="mt-6 min-w-0 overflow-hidden bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="p-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Lịch sử đơn nhập hàng
              </h2>
              <button
                onClick={handleDeleteSelectedOrders}
                disabled={saving || selectedHistoryIds.length === 0}
                className="inline-flex shrink-0 items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                Xóa đã chọn ({selectedHistoryIds.length})
              </button>
            </div>
            <div className="w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[1280px] text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="w-12 px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
                      <input
                        type="checkbox"
                        checked={isAllHistorySelected}
                        onChange={handleToggleAllHistory}
                        disabled={saving || orderHistory.length === 0}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                    <th className="w-16 px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">STT</th>
                    <th className="min-w-[120px] px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Mã đơn</th>
                    <th className="min-w-[110px] px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Ngày lập</th>
                    <th className="min-w-[110px] px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Sản phẩm</th>
                    <th className="min-w-[90px] px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Số lượng</th>
                    <th className="min-w-[130px] px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Tổng tiền</th>
                    <th className="min-w-[180px] px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Nhà cung cấp</th>
                    <th className="min-w-[150px] px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Thanh toán</th>
                    <th className="min-w-[120px] px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Trạng thái</th>
                    <th className="min-w-[120px] px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {orderHistory.map((order, index) => (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedHistoryIds.includes(String(order.maDonHang || order.id))}
                          onChange={() => handleToggleHistoryRow(order)}
                          disabled={saving}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{index + 1}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{order.maDonHang}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {new Date(order.ngayLap).toLocaleDateString('vi-VN')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                        {order.soSanPham || order.chiTiet?.length || 0} sản phẩm
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 text-center whitespace-nowrap">
                        {(order.tongSoLuong || 0).toLocaleString('vi-VN')}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-green-600 text-right whitespace-nowrap">
                        {formatVND(order.tongTien)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 text-center">
                        <div className="max-w-[180px] truncate" title={order.nhaCungCap?.tenNCC || order.nhaCungCap?.name || '—'}>
                          {order.nhaCungCap?.tenNCC || order.nhaCungCap?.name || '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2.5 py-1 rounded-full border text-xs font-medium ${getPaymentBadgeClass(order.payment_status)}`}>
                          {getPaymentLabel(order.payment_status)}
                        </span>
                        {Number(order.remaining_amount || 0) > 0 && (
                          <div className="mt-1 text-[11px] text-gray-500">
                            Còn {formatVND(order.remaining_amount)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                          order.trangThai === 'da_nhap'
                            ? 'bg-green-100 text-green-700'
                            : order.trangThai === 'cho_nhap'
                            ? 'bg-yellow-100 text-yellow-700'
                            : order.trangThai === 'da_huy'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}>
                          {order.trangThai === 'da_nhap' ? 'Đã nhập' :
                           order.trangThai === 'cho_nhap' ? 'Chờ nhập' :
                           order.trangThai === 'da_huy' ? 'Đã hủy' : order.trangThai}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center gap-2 whitespace-nowrap">
                          {order.trangThai !== 'da_huy' && (
                            <>
                              <button
                                onClick={() => handleLoadOrder(order, true)}
                                disabled={saving}
                                className="text-emerald-600 hover:text-emerald-800 text-sm font-medium disabled:text-emerald-300"
                              >
                                Sửa
                              </button>
                              <button
                                onClick={() => handleCancelOrder(order)}
                                disabled={saving}
                                className="text-orange-600 hover:text-orange-800 text-sm font-medium disabled:text-orange-300"
                              >
                                Hủy
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleDeleteOrder(order)}
                            disabled={saving}
                            className="text-red-600 hover:text-red-800 text-sm font-medium disabled:text-red-300"
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {orderHistory.length > 0 && (
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                <p className="text-xs text-gray-500">
                  Lưu ý: Khi hủy phiếu đã nhập kho, backend sẽ tự động rollback tồn kho đúng một lần; phiếu lưu tạm chưa nhập kho sẽ không đổi tồn kho.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
};

export default Nhaphang;
