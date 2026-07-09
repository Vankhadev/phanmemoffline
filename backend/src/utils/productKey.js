/**
 * productKey.js — Xac dinh danh tinh san pham duy nhat.
 * Dung cho upsert, dedupe, cleanup trung san pham.
 */

function hasText(value) {
  return !(value === undefined || value === null || String(value).trim() === '');
}

/**
 * Chuan hoa chuoi tieng Viet: bo dau, normalize Unicode, trim whitespace thua.
 */
function normalizeVietnamese(value) {
  if (value == null) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCodeKey(value) {
  return normalizeVietnamese(value).replace(/\s+/g, '');
}

function isActiveProduct(product) {
  if (!product || typeof product !== 'object') return false;
  if (product.active === 0 || product.active === false) return false;
  if (product.merged === true || product.status === 'merged' || product.status === 'deleted') return false;
  if (product.deleted === true || product.deleted_at) return false;
  return true;
}

function getSku(product) {
  return product?.sku ?? product?.product_sku ?? product?.code ?? '';
}

function getBarcode(product) {
  return product?.barcode ?? product?.bar_code ?? product?.product_barcode ?? '';
}

function getProductCode(product) {
  return product?.productCode ?? product?.product_code ?? '';
}

function getName(product) {
  return product?.name ?? product?.product_name ?? product?.title ?? '';
}

function getCategory(product) {
  if (hasText(product?.category)) return product.category;
  if (product?.default_category_id != null && product.default_category_id !== '') return product.default_category_id;
  if (product?.category_id != null && product.category_id !== '') return product.category_id;
  return '';
}

function getParentScope(product) {
  const parentId = product?.parent_id;
  if (parentId == null || parentId === '' || Number(parentId) === 0) return 'parent';
  return 'variant:' + String(parentId);
}

/**
 * Tao key duy nhat uu tien cho san pham.
 * Format: "type:value"
 */
function normalizeProductKey(product) {
  if (!product || typeof product !== 'object') return null;

  const oldId = product.old_id ?? product.legacy_id ?? product.original_id ?? product._id;
  if (hasText(oldId)) return 'old_id:' + String(oldId).trim();

  const sku = getSku(product);
  if (hasText(sku)) return 'sku:' + normalizeCodeKey(sku);

  const barcode = getBarcode(product);
  if (hasText(barcode)) {
    const barNorm = normalizeCodeKey(barcode);
    const nameNorm = normalizeVietnamese(getName(product));
    if (barNorm && barNorm !== nameNorm.replace(/\s+/g, '')) return 'barcode:' + barNorm;
  }

  const productCode = getProductCode(product);
  if (hasText(productCode)) return 'product_code:' + normalizeCodeKey(productCode);

  const name = getName(product);
  if (hasText(name)) {
    const cat = getCategory(product);
    const normName = normalizeVietnamese(name);
    const normCat = normalizeVietnamese(cat);
    return 'name:' + (normCat ? normCat + '|' + normName : normName);
  }

  return null;
}

/**
 * Tra ve tat ca identity keys de match san pham (multi-key).
 * Dung cho upsert/restore de tranh insert trung khi SKU khac ma ten giong.
 */
function getProductIdentityKeys(product, options = {}) {
  const keys = [];
  if (!product || typeof product !== 'object') return keys;
  const includeName = options.includeName !== false;
  const scopeParent = options.scopeParent !== false;

  if (hasText(product.id) && options.includeId !== false) {
    keys.push('id:' + String(product.id).trim());
  }

  const oldId = product.old_id ?? product.legacy_id ?? product.original_id ?? product._id;
  if (hasText(oldId)) keys.push('old_id:' + String(oldId).trim());

  const sku = getSku(product);
  if (hasText(sku)) keys.push('sku:' + normalizeCodeKey(sku));

  const barcode = getBarcode(product);
  if (hasText(barcode)) {
    const barNorm = normalizeCodeKey(barcode);
    const nameNorm = normalizeVietnamese(getName(product)).replace(/\s+/g, '');
    if (barNorm && barNorm !== nameNorm) keys.push('barcode:' + barNorm);
  }

  const productCode = getProductCode(product);
  if (hasText(productCode)) keys.push('product_code:' + normalizeCodeKey(productCode));

  if (includeName) {
    const name = getName(product);
    if (hasText(name)) {
      const cat = getCategory(product);
      const normName = normalizeVietnamese(name);
      const normCat = normalizeVietnamese(cat);
      const nameKey = 'name:' + (normCat ? normCat + '|' + normName : normName);
      keys.push(nameKey);
      // Them key name-only de bat trung ten du category khac/rong
      keys.push('name_only:' + normName);
      if (scopeParent) {
        keys.push('scoped_name:' + getParentScope(product) + '|' + normName);
      }
    }
  }

  return Array.from(new Set(keys.filter(Boolean)));
}

function findDuplicateProducts(products) {
  if (!Array.isArray(products)) return new Map();
  const activeProducts = products.filter(isActiveProduct);
  const byKey = new Map();

  for (const product of activeProducts) {
    const keys = getProductIdentityKeys(product, { includeId: false });
    // Dung primary key de group chinh, nhung multi-key se xu ly o cleanup script
    const key = normalizeProductKey(product) || keys[0];
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(product);
  }

  const duplicates = new Map();
  for (const [key, group] of byKey) {
    if (group.length >= 2) duplicates.set(key, group);
  }
  return duplicates;
}

function selectPrimaryProduct(duplicates) {
  if (!Array.isArray(duplicates) || duplicates.length === 0) return null;
  if (duplicates.length === 1) return duplicates[0];

  return [...duplicates].sort((a, b) => {
    const aDate = new Date(a.created_at || a.createdAt || 0).getTime() || Number.MAX_SAFE_INTEGER;
    const bDate = new Date(b.created_at || b.createdAt || 0).getTime() || Number.MAX_SAFE_INTEGER;
    if (aDate !== bDate) return aDate - bDate;

    const aStock = Number(a.stock || a.quantity || 0);
    const bStock = Number(b.stock || b.quantity || 0);
    if (bStock !== aStock) return bStock - aStock;

    const aImg = (a.image_url || a.image) ? 1 : 0;
    const bImg = (b.image_url || b.image) ? 1 : 0;
    if (bImg !== aImg) return bImg - aImg;

    return Number(a.id || 0) - Number(b.id || 0);
  })[0];
}

function mergeProductFields(primary, secondary, options = {}) {
  if (!primary || !secondary) return primary;
  const sumStock = options.sumStock === true;

  const fillIfEmpty = (field) => {
    if ((primary[field] == null || primary[field] === '') && secondary[field] != null && secondary[field] !== '') {
      primary[field] = secondary[field];
    }
  };

  [
    'name', 'sku', 'barcode', 'productCode', 'product_code', 'code',
    'import_price', 'wholesale_price', 'retail_price', 'vip_price', 'price', 'cost',
    'unit', 'category', 'default_category_id', 'supplier_id',
    'description', 'image_url', 'image', 'note',
    'option1', 'option2', 'option3', 'product_type', 'item_type', 'type',
    'is_service', 'sync_source', 'parent_id',
  ].forEach(fillIfEmpty);

  for (const pf of ['import_price', 'wholesale_price', 'retail_price', 'vip_price', 'price', 'cost']) {
    const pVal = Number(primary[pf] || 0);
    const sVal = Number(secondary[pf] || 0);
    if (pVal === 0 && sVal > 0) primary[pf] = secondary[pf];
  }

  if (sumStock) {
    primary.stock = Number(primary.stock || 0) + Number(secondary.stock || 0);
  } else if ((primary.stock == null || primary.stock === '') && secondary.stock != null) {
    primary.stock = secondary.stock;
  }

  const pTime = new Date(primary.updated_at || primary.updatedAt || 0).getTime();
  const sTime = new Date(secondary.updated_at || secondary.updatedAt || 0).getTime();
  if (sTime > pTime) {
    primary.updated_at = secondary.updated_at || secondary.updatedAt;
  }

  return primary;
}

/**
 * Tim san pham da ton tai bang multi-key identity.
 * uu tien: id > old_id > sku > barcode > product_code > scoped_name > name_only
 */
function findExistingProduct(products, candidate, options = {}) {
  if (!Array.isArray(products) || !candidate) return null;
  const onlyActive = options.onlyActive !== false;
  const list = onlyActive ? products.filter(isActiveProduct) : products.filter(Boolean);
  if (!list.length) return null;

  const candidateKeys = getProductIdentityKeys(candidate, {
    includeId: true,
    includeName: true,
    scopeParent: true,
  });
  if (!candidateKeys.length) return null;

  const keySet = new Set(candidateKeys);
  const priority = [
    (p) => keySet.has('id:' + String(p.id)),
    (p) => {
      const oldId = p.old_id ?? p.legacy_id ?? p.original_id ?? p._id;
      return hasText(oldId) && keySet.has('old_id:' + String(oldId).trim());
    },
    (p) => {
      const sku = getSku(p);
      return hasText(sku) && keySet.has('sku:' + normalizeCodeKey(sku));
    },
    (p) => {
      const barcode = getBarcode(p);
      return hasText(barcode) && keySet.has('barcode:' + normalizeCodeKey(barcode));
    },
    (p) => {
      const code = getProductCode(p);
      return hasText(code) && keySet.has('product_code:' + normalizeCodeKey(code));
    },
    (p) => {
      const name = getName(p);
      if (!hasText(name)) return false;
      return keySet.has('scoped_name:' + getParentScope(p) + '|' + normalizeVietnamese(name));
    },
    (p) => {
      // Chi match name_only neu candidate KHONG co sku/barcode/code
      const candidateHasCode = hasText(getSku(candidate)) || hasText(getBarcode(candidate)) || hasText(getProductCode(candidate));
      if (candidateHasCode) return false;
      const name = getName(p);
      return hasText(name) && keySet.has('name_only:' + normalizeVietnamese(name));
    },
  ];

  for (const matcher of priority) {
    const found = list.find(matcher);
    if (found) return found;
  }
  return null;
}

module.exports = {
  hasText,
  normalizeVietnamese,
  normalizeCodeKey,
  isActiveProduct,
  normalizeProductKey,
  getProductIdentityKeys,
  findDuplicateProducts,
  selectPrimaryProduct,
  mergeProductFields,
  findExistingProduct,
};
