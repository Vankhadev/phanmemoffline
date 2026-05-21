import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Search, Plus, X, Save, Package, Tag, FileText, LogOut, AlertCircle, CheckCircle, Building, Trash2, CreditCard, RotateCcw } from 'lucide-react';
import ProductLabelPrintModal from '../components/ProductLabelPrintModal';
import { SYNC_UPDATED_EVENT, apiJson, apiJsonChecked, resolveApiUrl } from '../utils/apiClient';
import { broadcastSyncUpdate } from '../utils/crossTabSync';
import { buildCategoriesById, categoryFields, getProductDisplayName, normalizeSearchText, searchFlatProducts } from '../utils/productSearch';

const API = resolveApiUrl('');

const SUPPLIER_CHANGE_CONFIRM_MESSAGE = 'Đổi nhà cung cấp sẽ xóa danh sách sản phẩm hiện tại. Bạn có muốn tiếp tục?';
const PRODUCT_SEARCH_LIMIT = 80;

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
  discount: getFirstFiniteNumber(item.chietKhau, item.discount),
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
  const [currentOrder, setCurrentOrder] = useState(null);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [orderHistory, setOrderHistory] = useState([]);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState([]);
  const [showAllSuppliers, setShowAllSuppliers] = useState(false); // Thêm state để hiển thị full khi focus
  const [labelPrintModal, setLabelPrintModal] = useState({ open: false, items: [], sourceCode: '' });
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
    const quantity = Number(product.soLuongNhap);
    const importPrice = hasImportValue(product.giaNhap)
      ? Number(product.giaNhap)
      : getFirstFiniteNumber(product.import_price, product.retail_price, 0);
    const discount = Number(product.chietKhau || 0);

    if (!product.tenSP) errors.push('Tên sản phẩm là bắt buộc');
    if (!product.donVi) errors.push('Đơn vị là bắt buộc');
    if (!getImportRowKey(product)) errors.push('Dòng sản phẩm thiếu product_id, variant_id hoặc SKU hợp lệ');
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push('Số lượng nhập phải lớn hơn 0');
    }
    if (!Number.isFinite(importPrice) || importPrice < 0) {
      errors.push('Giá nhập phải lớn hơn hoặc bằng 0');
    }
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      errors.push('Chiết khấu phải từ 0-100%');
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
  const calculateThanhTien = (giaNhap, soLuong, chietKhau) => {
    const price = Math.max(0, Number(giaNhap) || 0);
    const quantity = Math.max(0, Number(soLuong) || 0);
    const discount = Math.min(100, Math.max(0, Number(chietKhau) || 0));
    const thanhTien = price * quantity;
    return thanhTien - (thanhTien * (discount / 100));
  };

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

    if (products.length > 0 && !window.confirm(SUPPLIER_CHANGE_CONFIRM_MESSAGE)) {
      return false;
    }

    setProducts([]);
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
    const duplicatedRow = !isEditingExistingRow
      ? products.find(item => getImportRowKey(item) === getImportRowKey(mappedProduct))
      : null;
    const quantity = isEditingExistingRow ? Math.max(1, Number(sourceRow.soLuongNhap) || 1) : 1;
    const discount = isEditingExistingRow
      ? Math.min(100, Math.max(0, Number(sourceRow.chietKhau) || 0))
      : Math.min(100, Math.max(0, Number(duplicatedRow?.chietKhau) || 0));
    const importPrice = isEditingExistingRow
      ? Math.max(0, getFirstFiniteNumber(sourceRow?.giaNhap, sourceRow?.import_price, mappedProduct.giaNhap, mappedProduct.import_price, mappedProduct.retail_price))
      : Math.max(0, getFirstFiniteNumber(duplicatedRow?.giaNhap, duplicatedRow?.import_price, mappedProduct.giaNhap, mappedProduct.import_price, mappedProduct.retail_price));

    return {
      ...mappedProduct,
      donVi: sourceRow?.donVi || duplicatedRow?.donVi || mappedProduct.donVi || 'cái',
      soLuongNhap: quantity,
      chietKhau: discount,
      giaNhap: importPrice,
      import_price: importPrice,
      thanhTien: calculateThanhTien(importPrice, quantity, discount)
    };
  };

  // Handle product selection from search
  const handleSelectProduct = async (product) => {
    try {
      setLoading(true);
      let fullProduct = product;
      if (product?.id) {
        const productRes = await fetch(`${API}/products/${product.id}`);
        fullProduct = productRes.ok ? await productRes.json() : product;
      }

      const mappedProduct = mapProductForImport(product, fullProduct, allProducts);
      setSelectedProduct(buildSelectedProductDraft(mappedProduct));
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
    const quantityToAdd = Math.max(0, Number(selectedProduct.soLuongNhap) || 0);
    const nextDiscount = Math.min(100, Math.max(0, Number(selectedProduct.chietKhau) || 0));
    const normalizedProduct = {
      ...selectedProduct,
      row_key: getImportRowKey(selectedProduct),
      giaNhap: importPrice,
      import_price: importPrice,
      soLuongNhap: quantityToAdd,
      chietKhau: nextDiscount,
      thanhTien: calculateThanhTien(importPrice, quantityToAdd, nextDiscount)
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
        const nextQuantity = (Number(product.soLuongNhap) || 0) + quantityToAdd;
        const nextPrice = Math.max(0, getFirstFiniteNumber(product.giaNhap, product.import_price, normalizedProduct.giaNhap));
        const mergedDiscount = Math.min(100, Math.max(0, Number(product.chietKhau) || 0));
        return {
          ...product,
          soLuongNhap: nextQuantity,
          giaNhap: nextPrice,
          import_price: nextPrice,
          chietKhau: mergedDiscount,
          thanhTien: calculateThanhTien(nextPrice, nextQuantity, mergedDiscount)
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
        product.soLuongNhap = Math.max(1, safeValue || 1);
      } else if (field === 'giaNhap') {
        const nextPrice = Math.max(0, safeValue);
        product.giaNhap = nextPrice;
        product.import_price = nextPrice;
      } else if (field === 'chietKhau') {
        product.chietKhau = Math.min(100, Math.max(0, safeValue));
      } else {
        product[field] = value;
      }

      const nextPrice = Math.max(0, getFirstFiniteNumber(product.giaNhap, product.import_price, product.retail_price));
      const nextQuantity = Math.max(1, Number(product.soLuongNhap) || 1);
      const nextDiscount = Math.min(100, Math.max(0, Number(product.chietKhau) || 0));
      product.soLuongNhap = nextQuantity;
      product.giaNhap = nextPrice;
      product.import_price = nextPrice;
      product.chietKhau = nextDiscount;
      product.thanhTien = calculateThanhTien(nextPrice, nextQuantity, nextDiscount);
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
    return products.reduce((sum, p) => sum + p.thanhTien, 0);
  }, [products]);

  // Calculate total quantity and discount
  const totalStats = useMemo(() => {
    return products.reduce((acc, p) => {
      const quantity = Number(p.soLuongNhap) || 0;
      const importPrice = Math.max(0, getFirstFiniteNumber(p.giaNhap, p.import_price, p.retail_price));
      const discount = Math.min(100, Math.max(0, Number(p.chietKhau) || 0));
      return {
        quantity: acc.quantity + quantity,
        discountValue: acc.discountValue + (importPrice * quantity * (discount / 100))
      };
    }, { quantity: 0, discountValue: 0 });
  }, [products]);

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

  const grossAmount = useMemo(() => totalAmount + totalStats.discountValue, [totalAmount, totalStats.discountValue]);

  const selectedProductExistingIndex = useMemo(() => {
    if (!selectedProduct || editingProductIndex !== null) return -1;
    const rowKey = getImportRowKey(selectedProduct);
    if (!rowKey) return -1;
    return products.findIndex(product => getImportRowKey(product) === rowKey);
  }, [editingProductIndex, products, selectedProduct]);

  const selectedProductExistingRow = selectedProductExistingIndex >= 0
    ? products[selectedProductExistingIndex]
    : null;

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
      chiTiet: details.map((d, index) => ({
        maSP: d.sku || '',
        tenSP: d.product_name || '',
        soLuong: +d.quantity || 0,
        donVi: d.unit || 'cái',
        giaNhap: +d.import_price || 0,
        retail_price: +d.retail_price || 0,
        wholesale_price: +d.wholesale_price || 0,
        chietKhau: 0,
        thanhTien: +d.line_total || 0,
        product_id: d.product_id || null,
        variant_id: d.variant_id || null,
      })),
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
    details: products.map(p => ({
      product_id: toPayloadNumberId(p.product_id || p.id),
      variant_id: toPayloadNumberId(p.variant_id),
      product_name: p.tenSP || '',
      sku: p.maSP || '',
      quantity: Number(p.soLuongNhap) || 1,
      import_price: Math.max(0, getFirstFiniteNumber(p.giaNhap, p.import_price)),
      retail_price: Math.max(0, getFirstFiniteNumber(p.retail_price)),
      wholesale_price: Math.max(0, getFirstFiniteNumber(p.wholesale_price)),
      line_total: Math.max(0, Number(p.thanhTien) || 0),
    })),
  });

  const buildImportLabelItems = (sourceProducts = []) => sourceProducts.map(p => ({
    id: p.variant_id || p.product_id || p.id || p.maSP,
    product_id: p.product_id || p.id || null,
    variant_id: p.variant_id || null,
    name: p.tenSP || p.product_name || p.name || '',
    sku: p.maSP || p.sku || '',
    retail_price: p.retail_price || p.giaBan || p.price || 0,
    quantity: p.soLuongNhap || p.quantity || p.soLuong || 1,
    unit: p.donVi || p.unit || 'cái',
  })).filter(item => item.name || item.sku);

  const closeLabelPrintModal = () => {
    setLabelPrintModal({ open: false, items: [], sourceCode: '' });
  };

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
    chiTiet: products.map(p => ({
      maSP: p.maSP,
      tenSP: p.tenSP,
      soLuong: p.soLuongNhap,
      donVi: p.donVi,
      giaNhap: p.giaNhap,
      chietKhau: p.chietKhau,
      thanhTien: p.thanhTien,
      product_id: p.product_id || p.id || null,
      variant_id: p.variant_id || null,
      retail_price: p.retail_price || 0,
      wholesale_price: p.wholesale_price || 0,
      row_key: getImportRowKey(p),
    })),
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
      setError(errors.join('\n'));
      setTimeout(() => setError(null), 5000);
      return;
    }

    const isEditing = Boolean(isEditingOrder && editingImportKey);
    const nextImportCode = isEditing ? currentOrder.maDonHang : generateOrderNumber();
    const submittedProductsSnapshot = products.map(product => ({ ...product }));
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
      if (status === 'received' || savedOrder.trangThai === 'da_nhap' || result.stock_applied === true || result.stock_delta?.length > 0 || result.stock_mode) {
        const labelItems = buildImportLabelItems(submittedProductsSnapshot);
        if (labelItems.length > 0) {
          setLabelPrintModal({ open: true, items: labelItems, sourceCode: savedOrder.maDonHang });
        }
      }
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
      setProducts((fullOrder.chiTiet || []).map((item) => {
        const row = {
          ...item,
          soLuongNhap: item.soLuong,
          chietKhau: item.chietKhau || 0,
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
        return { ...row, row_key: getImportRowKey(row) };
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
    <div className="min-h-full w-full min-w-0 bg-slate-100">
      {/* Header khu vực nhập hàng */}
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-[1680px] px-4 sm:px-6 xl:px-8">
          <div className="flex min-w-0 flex-col gap-4 py-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-sm">
                <Package className="h-6 w-6 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Nhập hàng</h1>
                  <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                    {products.length > 0 ? `${products.length} dòng hàng đang thao tác` : 'Sẵn sàng tạo phiếu nhập'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  Tối ưu cho thao tác nhập hàng liên tục: chọn nhà cung cấp, thêm nhiều sản phẩm, chỉnh nhanh số lượng và giá nhập ngay trên cùng một màn hình.
                </p>
                {currentOrder && (
                  <p className="mt-1 text-xs text-slate-500">
                    {isEditingOrder ? 'Đang sửa' : 'Đang xem'} phiếu {currentOrder.maDonHang}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                  <div className="text-slate-500">Tổng SL</div>
                  <div className="text-sm font-semibold text-slate-900">{totalStats.quantity.toLocaleString('vi-VN')}</div>
                </div>
                <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
                  <div className="text-slate-500">Tạm tính</div>
                  <div className="text-sm font-semibold text-emerald-600">{totalAmount.toLocaleString('vi-VN')}đ</div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleOpenReturns}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" />
                Hoàn trả hàng
              </button>
              <button
                onClick={handleExit}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" />
                Thoát
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1680px] px-4 py-6 sm:px-6 xl:px-8">
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
        <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_430px] 2xl:grid-cols-[minmax(0,1fr)_460px]">
          {/* Left Column - Input Form */}
          <div className="min-w-0 space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dòng sản phẩm</div>
                <div className="mt-2 text-3xl font-semibold text-slate-900">{products.length}</div>
                <p className="mt-1 text-xs text-slate-500">Danh sách đang giữ nguyên khi tiếp tục thêm sản phẩm mới.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tổng số lượng</div>
                <div className="mt-2 text-3xl font-semibold text-slate-900">{totalStats.quantity.toLocaleString('vi-VN')}</div>
                <p className="mt-1 text-xs text-slate-500">Cập nhật tức thời theo mỗi thay đổi số lượng.</p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Tổng thanh toán</div>
                <div className="mt-2 text-3xl font-semibold text-emerald-700">{totalAmount.toLocaleString('vi-VN')}đ</div>
                <p className="mt-1 text-xs text-emerald-700/80">Đã trừ chiết khấu trên từng dòng hàng.</p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Trạng thái phiếu</div>
                <div className="mt-2 text-lg font-semibold text-amber-800">
                  {currentOrder ? `${isEditingOrder ? 'Đang sửa' : 'Đang xem'} ${currentOrder.maDonHang}` : 'Phiếu nhập mới'}
                </div>
                <p className="mt-1 text-xs text-amber-700/80">Luồng nhập hàng ưu tiên thao tác nhanh trên desktop.</p>
              </div>
            </div>

            {/* Supplier & Product Search Card */}
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-blue-50 px-5 py-4">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                      <Search className="h-5 w-5 text-blue-600" />
                      Tìm kiếm & chuẩn bị phiếu nhập
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Chọn nhà cung cấp trước, sau đó tiếp tục tìm và thêm nhiều sản phẩm liên tiếp mà không làm mất dữ liệu đã nhập trong danh sách.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1.5 font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                      {editingProductIndex !== null ? `Đang thay sản phẩm cho dòng #${editingProductIndex + 1}` : 'Chế độ thêm sản phẩm liên tục'}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                      Enter thêm nhanh · Shift/Ctrl + Enter thêm & tìm tiếp
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 p-5 2xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
                <div className="space-y-5">
                  {/* Supplier Search */}
                  <div className="relative rounded-2xl border border-slate-200 bg-slate-50/70 p-4" ref={supplierSearchContainerRef}>
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                          <Building className="h-4 w-4 text-slate-500" />
                          Nhà cung cấp
                        </label>
                        <p className="mt-1 text-xs text-slate-500">Nhà cung cấp là điều kiện để lọc sản phẩm phù hợp và giữ phiếu nhập nhất quán.</p>
                      </div>
                      {selectedSupplier && (
                        <button
                          type="button"
                          onClick={handleClearSupplier}
                          className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={saving}
                        >
                          <X className="h-3.5 w-3.5" />
                          Bỏ chọn NCC
                        </button>
                      )}
                    </div>
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
                          setShowAllSuppliers(false);
                          setSelectedSupplier(null);
                          setError(null);
                        }}
                        onFocus={() => {
                          setShowSupplierResults(true);
                          setShowAllSuppliers(true);
                        }}
                        placeholder="Tìm theo tên, mã, điện thoại hoặc mã số thuế nhà cung cấp..."
                        className="w-full rounded-2xl border border-slate-300 bg-white py-3.5 pl-11 pr-4 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                        disabled={saving}
                      />
                      <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      {loading && (
                        <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
                        </div>
                      )}
                      {showSupplierResults && (
                        <div
                          ref={supplierResultsRef}
                          className="absolute z-10 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-200/60"
                        >
                          {(supplierSearchQuery || showAllSuppliers) ? (
                            loading && supplierSearchQuery ? (
                              <div className="p-4 text-center text-sm text-slate-500">Đang tìm kiếm...</div>
                            ) : filteredSuppliers.length > 0 ? (
                              filteredSuppliers.map(supplier => (
                                <div
                                  key={supplier.id}
                                  onClick={() => handleSelectSupplier(supplier)}
                                  className="cursor-pointer border-b border-slate-100 px-4 py-3 transition hover:bg-blue-50 last:border-b-0"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm font-semibold text-slate-900">{supplier.name}</span>
                                    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">{supplier.id || supplier.maNCC || 'N/A'}</span>
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">{supplier.address || 'Chưa có địa chỉ'}</div>
                                </div>
                              ))
                            ) : (
                              <div className="p-4 text-center text-sm text-slate-500">Không tìm thấy nhà cung cấp</div>
                            )
                          ) : (
                            suppliers.map(supplier => (
                              <div
                                key={supplier.id}
                                onClick={() => handleSelectSupplier(supplier)}
                                className="cursor-pointer border-b border-slate-100 px-4 py-3 transition hover:bg-blue-50 last:border-b-0"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-sm font-semibold text-slate-900">{supplier.name}</span>
                                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">{supplier.id || supplier.maNCC || 'N/A'}</span>
                                </div>
                                <div className="mt-1 text-xs text-slate-500">{supplier.address || 'Chưa có địa chỉ'}</div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    {selectedSupplier && (
                      <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                              <Building className="h-4 w-4" />
                              {selectedSupplier.tenNCC}
                            </div>
                            <div className="mt-1 text-xs text-emerald-700">Mã NCC: {selectedSupplier.maNCC || '—'}</div>
                            <div className="mt-1 text-xs text-emerald-700">{selectedSupplier.diaChi || 'Chưa có địa chỉ nhà cung cấp'}</div>
                          </div>
                          <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                            Đã khóa phạm vi tìm kiếm theo NCC
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Product Search */}
                  <div className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" ref={productSearchContainerRef}>
                    <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                          <Search className="h-4 w-4 text-slate-500" />
                          Sản phẩm <span className="text-rose-500">*</span>
                        </label>
                        <p className="mt-1 text-xs text-slate-500">
                          Sau khi thêm xong một sản phẩm, chỉ cần quay lại ô này để tiếp tục chọn sản phẩm tiếp theo. Danh sách hiện tại luôn được giữ nguyên.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleStartAddProduct}
                        disabled={saving || !selectedSupplier}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                      >
                        <Plus className="h-4 w-4" />
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
                          if (editingProductIndex !== null) {
                            setSelectedProduct(null);
                          }
                          setError(null);
                        }}
                        onFocus={() => {
                          if (!selectedSupplier) {
                            showSupplierRequiredHint();
                            return;
                          }
                          if (editingProductIndex === null) {
                            setEditingProductIndex(null);
                          }
                          setFilteredProducts(getScopedProductSearchResults(searchQuery));
                          setShowSearchResults(true);
                        }}
                        placeholder={selectedSupplier ? 'Tìm theo tên, mã SKU hoặc để trống để hiện toàn bộ sản phẩm phù hợp...' : 'Chọn nhà cung cấp trước khi thêm sản phẩm...'}
                        className="w-full rounded-2xl border border-slate-300 bg-white py-3.5 pl-11 pr-4 text-sm text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                        aria-disabled={saving || !selectedSupplier}
                        disabled={saving || !selectedSupplier}
                      />
                      <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      {loading && (
                        <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
                        </div>
                      )}

                      {showSearchResults && (
                        <div
                          ref={searchResultsRef}
                          className="absolute z-10 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-200/60"
                        >
                          {loading ? (
                            <div className="p-4 text-center text-sm text-slate-500">Đang tìm kiếm...</div>
                          ) : filteredProducts.length > 0 ? (
                            filteredProducts.map(product => {
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
                                  onClick={() => handleSelectProduct(product)}
                                  className="cursor-pointer border-b border-slate-100 px-4 py-3 transition hover:bg-blue-50 last:border-b-0"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold text-slate-900">
                                        {name}
                                        {parentName ? <span className="text-xs font-normal text-slate-400"> · {parentName}</span> : null}
                                      </div>
                                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                                        <span className="rounded-full bg-slate-100 px-2 py-1">SKU: {sku || 'N/A'}</span>
                                        <span className="rounded-full bg-slate-100 px-2 py-1">Đơn vị: {unit}</span>
                                        {categoryName ? <span className="rounded-full bg-slate-100 px-2 py-1">{categoryName}</span> : null}
                                        <span className="rounded-full bg-slate-100 px-2 py-1">Tồn: {availableQuantity.toLocaleString('vi-VN')}</span>
                                      </div>
                                    </div>
                                    <span className="whitespace-nowrap text-sm font-semibold text-blue-600">
                                      {price.toLocaleString('vi-VN')}đ
                                    </span>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="p-4 text-center text-sm text-slate-500">
                              {searchQuery.trim() ? 'Không có sản phẩm phù hợp' : 'Chưa có sản phẩm trong hệ thống'}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {!selectedSupplier && (
                      <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        Chọn nhà cung cấp trước để mở tìm kiếm sản phẩm và thêm nhiều dòng hàng liên tiếp.
                      </p>
                    )}
                    {selectedSupplier && (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span className="rounded-full bg-slate-100 px-3 py-1.5">Nhà cung cấp: {selectedSupplier.tenNCC}</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1.5">Số dòng hiện có: {products.length}</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1.5">Thêm liên tục không ghi đè dữ liệu cũ</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <FileText className="h-4 w-4 text-slate-500" />
                      Trạng thái thao tác hiện tại
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                        <div className="text-xs uppercase tracking-wide text-slate-500">Nhà cung cấp</div>
                        <div className="mt-2 text-sm font-semibold text-slate-900">{selectedSupplier?.tenNCC || 'Chưa chọn nhà cung cấp'}</div>
                        <div className="mt-1 text-xs text-slate-500">{selectedSupplier ? `Mã: ${selectedSupplier.maNCC || '—'}` : 'Cần chọn NCC trước khi nhập hàng.'}</div>
                      </div>
                      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                        <div className="text-xs uppercase tracking-wide text-slate-500">Sản phẩm đang soạn</div>
                        <div className="mt-2 text-sm font-semibold text-slate-900">{selectedProduct?.tenSP || 'Chưa chọn sản phẩm'}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {selectedProduct
                            ? (editingProductIndex !== null ? `Đang sửa dòng #${editingProductIndex + 1}` : 'Sẵn sàng thêm vào danh sách')
                            : 'Tìm kiếm để chọn sản phẩm và nhập số lượng, giá nhập.'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                    <div className="text-sm font-semibold text-blue-900">Mẹo nhập hàng nhanh</div>
                    <ul className="mt-3 space-y-2 text-xs leading-5 text-blue-800">
                      <li>• Sau khi thêm xong một dòng, bấm <span className="font-semibold">Thêm và tìm tiếp</span> để quay lại ô tìm kiếm ngay.</li>
                      <li>• Nếu chọn lại sản phẩm đã có, hệ thống giữ một dòng duy nhất và ưu tiên cộng dồn số lượng thay vì tạo trùng.</li>
                      <li>• Giá nhập và chiết khấu cũ của sản phẩm đã có sẽ được ưu tiên giữ lại để tránh mất dữ liệu.</li>
                      <li>• Danh sách bên dưới cập nhật tức thời mỗi khi đổi số lượng, giá nhập hoặc xóa dòng hàng.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Selected Product Card */}
            {selectedProduct && (
              <div className="overflow-hidden rounded-3xl border border-blue-200 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-blue-100 bg-gradient-to-r from-blue-50 via-white to-emerald-50 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                        <Package className="h-5 w-5 text-blue-600" />
                        {editingProductIndex !== null ? `Cập nhật dòng #${editingProductIndex + 1}` : 'Sản phẩm đang chuẩn bị thêm'}
                      </h2>
                      <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                        {selectedProduct.maSP || 'Chưa có SKU'}
                      </span>
                      {selectedProductExistingRow && (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                          Đã có ở dòng #{selectedProductExistingIndex + 1} — sẽ cộng dồn khi thêm
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{selectedProduct.tenSP}</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetProductSearchState}
                    disabled={saving}
                    className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Hủy chọn sản phẩm"
                  >
                    <X className="h-4 w-4" />
                    Bỏ chọn
                  </button>
                </div>

                <div className="grid gap-5 p-5 2xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Số lượng nhập</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={selectedProduct.soLuongNhap}
                        onChange={(e) => {
                          const nextQuantity = Math.max(1, Number(e.target.value) || 1);
                          const nextPrice = Math.max(0, getFirstFiniteNumber(selectedProduct.giaNhap, selectedProduct.import_price, selectedProduct.retail_price));
                          setSelectedProduct({
                            ...selectedProduct,
                            soLuongNhap: nextQuantity,
                            thanhTien: calculateThanhTien(nextPrice, nextQuantity, selectedProduct.chietKhau)
                          });
                        }}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                        disabled={saving}
                      />
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Đơn vị</label>
                      <input
                        type="text"
                        value={selectedProduct.donVi}
                        disabled
                        className="w-full rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-base text-slate-600"
                      />
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Giá nhập</label>
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={selectedProduct.giaNhap ?? selectedProduct.retail_price ?? selectedProduct.import_price ?? 0}
                        onChange={(e) => {
                          const nextPrice = Math.max(0, Number(e.target.value) || 0);
                          setSelectedProduct({
                            ...selectedProduct,
                            giaNhap: nextPrice,
                            import_price: nextPrice,
                            thanhTien: calculateThanhTien(
                              nextPrice,
                              selectedProduct.soLuongNhap,
                              selectedProduct.chietKhau
                            )
                          });
                        }}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                        disabled={saving}
                      />
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Chiết khấu (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={selectedProduct.chietKhau}
                        onChange={(e) => {
                          const nextDiscount = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                          const nextPrice = Math.max(0, getFirstFiniteNumber(selectedProduct.giaNhap, selectedProduct.import_price, selectedProduct.retail_price));
                          setSelectedProduct({
                            ...selectedProduct,
                            chietKhau: nextDiscount,
                            thanhTien: calculateThanhTien(
                              nextPrice,
                              selectedProduct.soLuongNhap,
                              nextDiscount
                            )
                          });
                        }}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                        disabled={saving}
                      />
                    </div>
                  </div>

                  <div className="space-y-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Thành tiền tạm tính</div>
                      <div className="mt-2 text-3xl font-semibold text-emerald-700">{selectedProduct.thanhTien.toLocaleString('vi-VN')}đ</div>
                    </div>
                    <div className="grid gap-2 text-xs text-emerald-800 sm:grid-cols-2 2xl:grid-cols-1">
                      <div className="rounded-2xl bg-white/80 px-3 py-2 ring-1 ring-emerald-200">SL: {Number(selectedProduct.soLuongNhap || 0).toLocaleString('vi-VN')}</div>
                      <div className="rounded-2xl bg-white/80 px-3 py-2 ring-1 ring-emerald-200">Giá nhập: {Math.max(0, Number(selectedProduct.giaNhap) || 0).toLocaleString('vi-VN')}đ</div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px]">
                    <button
                      onClick={() => handleAddProduct({ keepSearching: false })}
                      disabled={saving}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                    >
                      <Plus className="h-4 w-4" />
                      {editingProductIndex !== null ? 'Cập nhật dòng sản phẩm' : 'Thêm vào danh sách'}
                    </button>
                    <button
                      onClick={() => handleAddProduct({ keepSearching: true })}
                      disabled={saving}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-400"
                      title="Thêm sản phẩm và giữ nguyên ô tìm kiếm để nhập tiếp"
                    >
                      <Search className="h-4 w-4" />
                      Thêm và tìm tiếp
                    </button>
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
                      Sau khi thêm, bạn có thể quay lại ô tìm kiếm để thêm sản phẩm tiếp theo mà không mất dữ liệu các dòng đã có.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Product List Table */}
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-emerald-50 px-5 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                      <FileText className="h-5 w-5 text-slate-700" />
                      Danh sách sản phẩm nhập
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">Hiển thị tập trung toàn bộ sản phẩm đã chọn để chỉnh nhanh số lượng, giá nhập, chiết khấu và thành tiền.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleStartAddProduct}
                      disabled={saving || !selectedSupplier}
                      className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                      <Plus className="h-4 w-4" />
                      Thêm sản phẩm mới
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Dòng hàng hiện có</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">{products.length}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tổng số lượng</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">{totalStats.quantity.toLocaleString('vi-VN')}</div>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Tổng tiền phải trả</div>
                  <div className="mt-2 text-2xl font-semibold text-emerald-700">{totalAmount.toLocaleString('vi-VN')}đ</div>
                </div>
              </div>

              {products.length > 0 ? (
                <>
                  <div className="block border-b border-slate-200 bg-white px-5 py-4 xl:hidden">
                    <div className="space-y-3">
                      {products.map((product, index) => {
                        const displayPrice = Math.max(0, getFirstFiniteNumber(product.giaNhap, product.import_price, product.retail_price));
                        return (
                          <div key={`${getImportRowKey(product) || 'row-mobile'}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-900">#{index + 1} · {product.tenSP}</div>
                                <div className="mt-1 text-xs text-slate-500">SKU: {product.maSP || 'N/A'} · Đơn vị: {product.donVi || 'cái'}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveProduct(index)}
                                disabled={saving}
                                className="rounded-xl p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:text-slate-300"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3">
                              <div>
                                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Số lượng</label>
                                <input
                                  type="number"
                                  min="1"
                                  value={product.soLuongNhap}
                                  onChange={(e) => handleUpdateProduct(index, 'soLuongNhap', e.target.value)}
                                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                                  disabled={saving}
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Giá nhập</label>
                                <input
                                  type="number"
                                  min="0"
                                  value={displayPrice}
                                  onChange={(e) => handleUpdateProduct(index, 'giaNhap', e.target.value)}
                                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                                  disabled={saving}
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Chiết khấu (%)</label>
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.1"
                                  value={product.chietKhau}
                                  onChange={(e) => handleUpdateProduct(index, 'chietKhau', e.target.value)}
                                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                                  disabled={saving}
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Thành tiền</label>
                                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                                  {product.thanhTien.toLocaleString('vi-VN')}đ
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-3">
                              <button
                                type="button"
                                onClick={() => handleEditProductRow(index)}
                                disabled={saving}
                                className="text-xs font-medium text-blue-600 transition hover:text-blue-800 disabled:cursor-not-allowed disabled:text-blue-300"
                              >
                                Đổi sản phẩm
                              </button>
                              <span className="text-xs text-slate-500">Dòng này sẽ được giữ nguyên khi thêm sản phẩm khác.</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="hidden w-full max-w-full overflow-x-auto xl:block">
                    <div className="max-h-[62vh] overflow-auto">
                      <table className="w-full min-w-[1180px]">
                        <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                          <tr className="border-b border-slate-200">
                            <th className="w-14 px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">STT</th>
                            <th className="w-20 px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Ảnh</th>
                            <th className="min-w-[320px] px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Sản phẩm</th>
                            <th className="w-36 px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Số lượng</th>
                            <th className="w-44 px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Giá nhập</th>
                            <th className="w-36 px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Chiết khấu</th>
                            <th className="w-44 px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Thành tiền</th>
                            <th className="w-28 px-4 py-4 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 bg-white">
                          {products.map((product, index) => {
                            const displayPrice = Math.max(0, getFirstFiniteNumber(product.giaNhap, product.import_price, product.retail_price));
                            return (
                              <tr
                                key={`${getImportRowKey(product) || 'row'}-${index}`}
                                className={`align-top transition hover:bg-slate-50 ${editingProductIndex === index ? 'bg-blue-50/70' : ''}`}
                              >
                                <td className="px-4 py-4 text-sm font-medium text-slate-500">{index + 1}</td>
                                <td className="px-4 py-4">
                                  <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                                    {product.hinhAnh ? (
                                      <img src={product.hinhAnh} alt={product.tenSP} className="h-full w-full object-cover" />
                                    ) : (
                                      <Package className="h-6 w-6 text-slate-400" />
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-slate-900">{product.tenSP}</div>
                                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                                      <span className="rounded-full bg-slate-100 px-2.5 py-1">SKU: {product.maSP || 'N/A'}</span>
                                      <span className="rounded-full bg-slate-100 px-2.5 py-1">Đơn vị: {product.donVi || 'cái'}</span>
                                      {product.parent_name ? <span className="rounded-full bg-slate-100 px-2.5 py-1">Nhóm: {product.parent_name}</span> : null}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-4">
                                  <input
                                    type="number"
                                    min="1"
                                    value={product.soLuongNhap}
                                    onChange={(e) => handleUpdateProduct(index, 'soLuongNhap', e.target.value)}
                                    className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-right text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                                    disabled={saving}
                                  />
                                </td>
                                <td className="px-4 py-4">
                                  <input
                                    type="number"
                                    min="0"
                                    value={displayPrice}
                                    onChange={(e) => handleUpdateProduct(index, 'giaNhap', e.target.value)}
                                    className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-right text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                                    disabled={saving}
                                  />
                                </td>
                                <td className="px-4 py-4">
                                  <div className="flex items-center justify-end gap-2">
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      step="0.1"
                                      value={product.chietKhau}
                                      onChange={(e) => handleUpdateProduct(index, 'chietKhau', e.target.value)}
                                      className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-right text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                                      disabled={saving}
                                    />
                                    <span className="text-xs text-slate-500">%</span>
                                  </div>
                                </td>
                                <td className="px-4 py-4 text-right">
                                  <div className="text-base font-semibold text-emerald-600">{product.thanhTien.toLocaleString('vi-VN')}đ</div>
                                </td>
                                <td className="px-4 py-4">
                                  <div className="flex flex-col items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleEditProductRow(index)}
                                      disabled={saving}
                                      className="text-xs font-medium text-blue-600 transition hover:text-blue-800 disabled:cursor-not-allowed disabled:text-blue-300"
                                    >
                                      Đổi sản phẩm
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveProduct(index)}
                                      disabled={saving}
                                      className="rounded-xl p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:text-slate-300"
                                      title="Xóa dòng"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="sticky bottom-0 bg-slate-50">
                          <tr className="border-t border-slate-200">
                            <td colSpan="3" className="px-4 py-4 text-sm text-slate-600">
                              <span className="font-semibold text-slate-900">{products.length}</span> dòng hàng đang hiển thị · Dữ liệu cũ được giữ nguyên khi tiếp tục thêm dòng mới.
                            </td>
                            <td className="px-4 py-4 text-right text-sm text-slate-600">
                              <span className="font-medium">{totalStats.quantity.toLocaleString('vi-VN')}</span>
                            </td>
                            <td className="px-4 py-4 text-right text-sm text-slate-600">
                              Tạm tính: <span className="font-medium">{grossAmount.toLocaleString('vi-VN')}đ</span>
                            </td>
                            <td className="px-4 py-4 text-right text-sm text-slate-600">
                              CK: <span className="font-medium">{totalStats.discountValue.toLocaleString('vi-VN')}đ</span>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <div className="text-xl font-bold text-emerald-600">{totalAmount.toLocaleString('vi-VN')}đ</div>
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </>
              ) : (
                <div className="px-5 py-10 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
                    <Package className="h-7 w-7 text-slate-400" />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-slate-900">Chưa có sản phẩm nào trong phiếu nhập</h3>
                  <p className="mt-2 text-sm text-slate-500">Bắt đầu bằng cách chọn nhà cung cấp, tìm sản phẩm rồi thêm liên tiếp vào danh sách bên trên.</p>
                  <button
                    type="button"
                    onClick={handleStartAddProduct}
                    disabled={saving || !selectedSupplier}
                    className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    <Plus className="h-4 w-4" />
                    Thêm sản phẩm đầu tiên
                  </button>
                </div>
              )}
            </div>

            {/* Notes & Tags Card */}
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                  <FileText className="h-5 w-5 text-slate-700" />
                  Thông tin bổ sung
                </h2>
              </div>
              <div className="grid gap-6 p-5 lg:grid-cols-2">
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <FileText className="h-4 w-4 text-slate-400" />
                    Ghi chú đơn
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows="4"
                    placeholder="Nhập ghi chú cho phiếu nhập, điều kiện giao hàng, công nợ hoặc lưu ý nội bộ..."
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 resize-none"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Tag className="h-4 w-4 text-slate-400" />
                    Tags
                  </label>
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    placeholder="Nhấn Enter để thêm tag cho phiếu nhập..."
                    className="mb-3 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                    disabled={saving}
                  />
                  {tags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1.5 text-sm font-medium text-blue-700"
                        >
                          {tag}
                          <button
                            onClick={() => handleRemoveTag(tag)}
                            disabled={saving}
                            className="transition hover:text-blue-900 disabled:text-blue-400"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                      Chưa có tag nào. Có thể dùng tag để nhóm phiếu nhập theo chiến dịch, đợt hàng hoặc nhà kho.
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>

          {/* Right Column - Summary Card */}
          <div className="min-w-0">
            <div className="space-y-4 xl:sticky xl:top-24">
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-emerald-50 px-5 py-4">
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                    <svg className="h-5 w-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Tổng quan phiếu nhập
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">Theo dõi số lượng, công nợ và thao tác lưu phiếu ngay tại sidebar.</p>
                </div>

                <div className="space-y-5 p-5">
                  <div className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-slate-900">Tổng thanh toán</span>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getPaymentBadgeClass(paymentSummary.payment_status)}`}>
                        {getPaymentLabel(paymentSummary.payment_status)}
                      </span>
                    </div>
                    <div className="mt-3 text-3xl font-semibold text-emerald-700">{totalAmount.toLocaleString('vi-VN')}đ</div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-2xl bg-white px-3 py-3 ring-1 ring-emerald-200">
                        <div className="text-slate-500">Tạm tính</div>
                        <div className="mt-1 font-semibold text-slate-900">{grossAmount.toLocaleString('vi-VN')}đ</div>
                      </div>
                      <div className="rounded-2xl bg-white px-3 py-3 ring-1 ring-emerald-200">
                        <div className="text-slate-500">Chiết khấu</div>
                        <div className="mt-1 font-semibold text-rose-600">-{totalStats.discountValue.toLocaleString('vi-VN')}đ</div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Dòng sản phẩm</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{products.length}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-wide text-slate-500">Tổng số lượng</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900">{totalStats.quantity.toLocaleString('vi-VN')}</div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Thanh toán</h3>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getPaymentBadgeClass(paymentSummary.payment_status)}`}>
                        {getPaymentLabel(paymentSummary.payment_status)}
                      </span>
                    </div>
                    <button
                      onClick={handlePayCurrentOrder}
                      disabled={isPaymentButtonDisabled}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
                    >
                      <CreditCard className="h-4 w-4" />
                      {paymentSummary.payment_status === 'paid' ? 'Đã thanh toán' : 'Thanh toán phiếu nhập'}
                    </button>
                    <p className={`mt-3 text-xs leading-5 ${hasUnsavedPaymentAffectingChanges ? 'text-orange-600' : 'text-slate-500'}`}>
                      {hasUnsavedPaymentAffectingChanges
                        ? 'Phiếu đang có thay đổi sản phẩm hoặc tổng tiền chưa lưu. Hãy cập nhật phiếu trước khi thanh toán để giữ công nợ chính xác.'
                        : editingImportKey
                        ? 'Nút này chỉ cập nhật trạng thái thanh toán của phiếu hiện tại, không tạo phiếu mới và không thay đổi tồn kho.'
                        : 'Cần tạo hoặc chọn phiếu nhập trước khi thanh toán.'}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-2xl bg-white px-3 py-3 ring-1 ring-slate-200">
                        <div className="text-slate-500">Đã trả</div>
                        <div className="mt-1 font-semibold text-slate-900">{paymentSummary.paid_amount.toLocaleString('vi-VN')}đ</div>
                      </div>
                      <div className="rounded-2xl bg-white px-3 py-3 ring-1 ring-slate-200">
                        <div className="text-slate-500">Còn phải trả</div>
                        <div className="mt-1 font-semibold text-slate-900">{paymentSummary.remaining_amount.toLocaleString('vi-VN')}đ</div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nhà cung cấp</h3>
                    {selectedSupplier ? (
                      <div className="mt-3 rounded-2xl bg-slate-50 p-4">
                        <p className="text-sm font-semibold text-slate-900">{selectedSupplier.tenNCC}</p>
                        <p className="mt-1 text-xs text-slate-500">Mã: {selectedSupplier.maNCC || '—'}</p>
                        <p className="mt-1 text-xs text-slate-500">{selectedSupplier.diaChi || 'Chưa có địa chỉ'}</p>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                        Chưa chọn nhà cung cấp.
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    {(!isEditingOrder || currentOrder?.trangThai === 'cho_nhap') && (
                      <button
                        onClick={handleCreateAndReceive}
                        disabled={saving || products.length === 0 || !selectedSupplier}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-green-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-400"
                      >
                        <Package className="h-4 w-4" />
                        {isEditingOrder ? 'Cập nhật & Nhập hàng' : 'Tạo & Nhập hàng'}
                      </button>
                    )}
                    <button
                      onClick={handleCreateOnly}
                      disabled={saving || products.length === 0 || !selectedSupplier}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                    >
                      <Save className="h-4 w-4" />
                      {isEditingOrder ? 'Cập nhật phiếu' : 'Tạo & Lưu tạm'}
                    </button>
                  </div>

                  {(!selectedSupplier || products.length === 0) && (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center text-xs text-slate-500">
                      {!selectedSupplier ? 'Vui lòng chọn nhà cung cấp để bắt đầu phiếu nhập.' : 'Vui lòng thêm ít nhất một sản phẩm vào danh sách nhập.'}
                    </div>
                  )}
                </div>
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
                        {order.tongTien.toLocaleString('vi-VN')}đ
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
                            Còn {Number(order.remaining_amount || 0).toLocaleString('vi-VN')}đ
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

      <ProductLabelPrintModal
        open={labelPrintModal.open}
        items={labelPrintModal.items}
        store={store}
        title="In tem sản phẩm"
        onClose={closeLabelPrintModal}
        onSkip={() => {
          setSuccess(labelPrintModal.sourceCode ? `Phiếu ${labelPrintModal.sourceCode} đã lưu; đã bỏ qua in tem sản phẩm.` : 'Đã bỏ qua in tem sản phẩm.');
        }}
        onPrinted={(rendered) => {
          setSuccess(
            rendered?.silent
              ? (labelPrintModal.sourceCode ? `Phiếu ${labelPrintModal.sourceCode} đã lưu; đã gửi lệnh in trực tiếp ${rendered.labelCount} tem sản phẩm.` : `Đã gửi lệnh in trực tiếp ${rendered.labelCount} tem sản phẩm.`)
              : (labelPrintModal.sourceCode ? `Phiếu ${labelPrintModal.sourceCode} đã lưu; đã mở hộp thoại in ${rendered.labelCount} tem sản phẩm.` : `Đã mở hộp thoại in ${rendered.labelCount} tem sản phẩm.`)
          );
        }}
      />
    </div>
  );
};

export default Nhaphang;
