export function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, match => (match === 'Đ' ? 'D' : 'd'))
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/(\d+)\s*(cm|mm|m|ml|l|kg|g)\b/g, '$1$2')
    .replace(/\b(cm|mm|m|ml|l|kg|g)\s+(\d+)\b/g, '$2$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function compactSearchText(value) {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

export function firstNonEmpty(...values) {
  const found = values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
  return found === undefined ? '' : String(found).trim();
}

function normalizedName(value) {
  return normalizeSearchText(value).replace(/\s+/g, ' ');
}

export function buildVariantDisplayName(item = {}, parent = null) {
  const parentName = firstNonEmpty(
    parent?.name,
    item?.parent_name,
    item?.parentName,
    item?.parent?.name,
    item?.product_parent_name,
  );
  const currentName = firstNonEmpty(
    item?.display_name,
    item?.displayName,
    item?.product_name,
    item?.productName,
    item?.name,
    item?.variant_name,
    item?.variantName,
  );
  const variantName = firstNonEmpty(
    item?.variant_name,
    item?.variantName,
    item?.variant?.name,
    item?.name,
    currentName,
  );

  if (!parentName) return currentName || variantName;
  if (!variantName) return currentName || parentName;

  const parentKey = normalizedName(parentName);
  const currentKey = normalizedName(currentName);
  const variantKey = normalizedName(variantName);

  if (currentName && parentKey && currentKey.includes(parentKey)) {
    if (!variantKey || currentKey.includes(variantKey) || variantKey.includes(parentKey)) return currentName;
  }
  if (variantKey && parentKey && variantKey.includes(parentKey)) return variantName;

  return `${parentName} - ${variantName}`;
}

export function getProductDisplayName(item = {}, parent = null) {
  const type = String(item?.type || item?.item_type || item?.product_type || '').trim().toLowerCase();
  if (type === 'combo' || item?.combo_id || item?.is_combo || item?.isCombo) {
    return firstNonEmpty(item?.product_name, item?.name, item?.combo_name, 'Combo');
  }
  if (type === 'service' || type === 'custom_service' || item?.is_service || item?.isService) {
    return firstNonEmpty(item?.product_name, item?.name, item?.service_name, 'Dịch vụ');
  }

  const isVariant = Boolean(
    parent
    || item?.is_variant
    || item?.parent_id
    || item?._parentId
    || item?.variant_id
    || item?.parent_name
    || item?.parent?.name
    || item?.variant_name
    || item?.variant?.name
  );

  if (isVariant) return buildVariantDisplayName(item, parent);
  return firstNonEmpty(item?.display_name, item?.displayName, item?.product_name, item?.productName, item?.name, item?.combo_name, item?.sku, 'Sản phẩm');
}

export function parseKeywordList(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[,;\n]/)
    .map(v => v.trim())
    .filter(Boolean);
}

export function categoryFields(category) {
  if (!category) return [];
  return [
    category.name,
    category.group_name,
    category.group_key,
    ...parseKeywordList(category.keywords),
    ...parseKeywordList(category.aliases),
  ].filter(Boolean);
}

export function getVariantIdentity(item = {}, fallbackIndex = 0) {
  return String(firstNonEmpty(
    item?.id,
    item?.variant_id,
    item?.variantId,
    item?.sku,
    item?.barcode,
    `${item?.parent_id || item?._parentId || 'variant'}-${fallbackIndex}`,
  ));
}

export function getProductVariants(product = {}) {
  const candidates = [
    product?.variants,
    product?.children,
    product?.child_products,
    product?.childProducts,
    product?.variant_items,
    product?.variantItems,
    product?.variant_products,
    product?.variantProducts,
    product?.items,
  ];
  const seen = new Set();
  const variants = [];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      if (!item || typeof item !== 'object') continue;
      const key = getVariantIdentity(item, variants.length);
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push(item);
    }
  }

  return variants;
}

export function findCategoryForProduct(product, categoriesById = {}) {
  if (!product) return null;
  const rawId = product.default_category_id;
  const id = rawId === null || rawId === undefined || rawId === '' ? null : Number(rawId);
  if (id && categoriesById[id]) return categoriesById[id];
  return product.default_category || product.category_info || null;
}

function getOptionText(item = {}) {
  return [item?.option1, item?.option2, item?.option3, item?.color, item?.size]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' / ');
}

export function getProductSku(item = {}, parent = null) {
  return firstNonEmpty(
    item?.sku,
    item?.product_sku,
    item?.productSku,
    item?.variant_sku,
    item?.variantSku,
    item?.barcode,
    item?.variant_id ? `VAR-${item.variant_id}` : '',
    parent?.sku ? `${parent.sku}-${getVariantIdentity(item)}` : '',
  );
}

export function normalizeInventoryVariant(variant = {}, parent = null, fallbackIndex = 0) {
  const optionText = getOptionText(variant);
  const name = firstNonEmpty(
    getProductDisplayName(variant, parent),
    variant?.display_name,
    variant?.displayName,
    variant?.variant_name,
    variant?.variantName,
    variant?.product_name,
    variant?.productName,
    optionText,
    getProductSku(variant, parent),
    parent?.name ? `${parent.name} - Biến thể ${fallbackIndex + 1}` : `Biến thể ${fallbackIndex + 1}`,
  );

  return {
    ...variant,
    id: variant?.id ?? variant?.variant_id ?? variant?.variantId ?? getVariantIdentity(variant, fallbackIndex),
    name,
    sku: getProductSku(variant, parent),
    import_price: variant?.import_price ?? variant?.cost ?? variant?.cost_price ?? variant?.inventory_cost ?? variant?.original_price ?? 0,
    retail_price: variant?.retail_price ?? variant?.price ?? variant?.sale_price ?? variant?.selling_price ?? 0,
    wholesale_price: variant?.wholesale_price ?? variant?.wholesalePrice ?? variant?.price ?? 0,
    vip_price: variant?.vip_price ?? variant?.vipPrice ?? variant?.compare_at_price ?? variant?.price ?? 0,
    stock: Number(variant?.stock ?? variant?.quantity ?? variant?.inventory_quantity ?? variant?.qty ?? 0) || 0,
    option_text: optionText,
  };
}

export function normalizeProductTree(products = []) {
  const input = Array.isArray(products) ? products : [];
  const byId = new Map(input.map(item => [Number(item?.id), item]).filter(([id]) => Number.isFinite(id) && id > 0));
  const parents = [];
  const variantsByParentId = new Map();

  for (const item of input) {
    const parentId = Number(item?.parent_id ?? item?.parentId ?? item?._parentId);
    const isVariant = Number.isFinite(parentId) && parentId > 0;
    if (isVariant) {
      if (!variantsByParentId.has(parentId)) variantsByParentId.set(parentId, []);
      variantsByParentId.get(parentId).push(item);
    } else {
      parents.push(item);
    }
  }

  return parents.map(parent => {
    const nested = getProductVariants(parent);
    const rowChildren = variantsByParentId.get(Number(parent?.id)) || [];
    const variants = [];
    const seen = new Set();
    [...nested, ...rowChildren].forEach((variant, index) => {
      const normalized = normalizeInventoryVariant(variant, parent, index);
      const key = getVariantIdentity(normalized, index);
      if (seen.has(key)) return;
      seen.add(key);
      variants.push({
        ...normalized,
        parent_id: normalized.parent_id || parent.id,
        parent_name: normalized.parent_name || parent.name,
        parent_sku: normalized.parent_sku || parent.sku,
        is_variant: true,
      });
    });
    return {
      ...parent,
      name: firstNonEmpty(parent?.display_name, parent?.displayName, parent?.product_name, parent?.productName, parent?.name, parent?.sku, 'Sản phẩm'),
      sku: getProductSku(parent),
      variants,
      children: variants,
      child_products: variants,
      variant_count: variants.length,
    };
  });
}

export function buildProductSearchFields(item, parent = null, categoriesById = {}) {
  const category = findCategoryForProduct(item, categoriesById) || findCategoryForProduct(parent, categoriesById);
  const parentCategory = findCategoryForProduct(parent, categoriesById);
  return [
    parent?.name,
    parent?.sku,
    parent?.category,
    parent?.unit,
    ...categoryFields(parentCategory),
    item?.name,
    item?.sku,
    item?.category,
    item?.unit,
    item?.color,
    item?.size,
    item?.attributes,
    ...categoryFields(category),
  ].filter(Boolean).join(' ');
}

function prepareSearchQuery(query) {
  const normalizedQuery = normalizeSearchText(query);
  return {
    normalizedQuery,
    queryCompact: normalizedQuery.replace(/\s+/g, ''),
    tokens: normalizedQuery.split(/\s+/).filter(Boolean),
  };
}

function createSearchContext(categoriesById = {}) {
  return {
    categoriesById,
    categoryFieldCache: new WeakMap(),
    productDataCache: new WeakMap(),
  };
}

function getCachedCategoryFields(category, context) {
  if (!category || typeof category !== 'object') return [];
  if (!context?.categoryFieldCache) return categoryFields(category);
  const cached = context.categoryFieldCache.get(category);
  if (cached) return cached;
  const fields = categoryFields(category);
  context.categoryFieldCache.set(category, fields);
  return fields;
}

function getProductSearchCacheKey(item, parent) {
  const parentKey = parent ? (parent.id ?? parent.sku ?? parent.name ?? 'parent') : 'root';
  return [
    parentKey,
    item?.default_category_id ?? '',
    parent?.default_category_id ?? '',
    item?.category ?? '',
    parent?.category ?? '',
  ].join('|');
}

function buildProductSearchData(item = {}, parent = null, context = createSearchContext()) {
  const categoriesById = context.categoriesById || {};
  const canCache = item && typeof item === 'object' && context.productDataCache;
  const cacheKey = getProductSearchCacheKey(item, parent);

  if (canCache) {
    const itemCache = context.productDataCache.get(item);
    const cached = itemCache?.get(cacheKey);
    if (cached) return cached;
  }

  const category = findCategoryForProduct(item, categoriesById) || findCategoryForProduct(parent, categoriesById);
  const parentCategory = findCategoryForProduct(parent, categoriesById);
  const categoryFieldsText = getCachedCategoryFields(category, context).join(' ');
  const fields = [
    parent?.name,
    parent?.sku,
    parent?.category,
    parent?.unit,
    ...getCachedCategoryFields(parentCategory, context),
    item?.name,
    item?.sku,
    item?.category,
    item?.unit,
    item?.color,
    item?.size,
    item?.attributes,
    ...getCachedCategoryFields(category, context),
  ].filter(Boolean).join(' ');
  const haystack = normalizeSearchText(fields);
  const categoryText = normalizeSearchText(categoryFieldsText);
  const data = {
    haystack,
    haystackCompact: haystack.replace(/\s+/g, ''),
    name: normalizeSearchText(item?.name),
    sku: normalizeSearchText(item?.sku),
    categoryText,
    categoryCompact: categoryText.replace(/\s+/g, ''),
  };

  if (canCache) {
    const itemCache = context.productDataCache.get(item) || new Map();
    itemCache.set(cacheKey, data);
    context.productDataCache.set(item, itemCache);
  }

  return data;
}

function scorePreparedProductMatch(item, preparedQuery, parent = null, context = createSearchContext()) {
  const { normalizedQuery, queryCompact, tokens } = preparedQuery;
  if (!normalizedQuery) return { matched: true, score: 1, reason: 'empty' };

  const { haystack, haystackCompact, name, sku, categoryText, categoryCompact } = buildProductSearchData(item, parent, context);

  let score = 0;
  if (name === normalizedQuery || sku === normalizedQuery) score += 1000;
  if (categoryText === normalizedQuery || categoryCompact === queryCompact) score += 850;
  if (name.startsWith(normalizedQuery)) score += 650;
  if (haystack.includes(normalizedQuery)) score += 420;
  if (haystackCompact.includes(queryCompact)) score += 380;
  if (categoryText.includes(normalizedQuery) || categoryCompact.includes(queryCompact)) score += 360;

  let tokenHits = 0;
  for (const token of tokens) {
    const tokenCompact = token.replace(/\s+/g, '');
    if (haystack.includes(token) || haystackCompact.includes(tokenCompact)) {
      tokenHits += 1;
      score += categoryText.includes(token) ? 85 : 55;
      if (name.includes(token)) score += 35;
    }
  }

  if (tokens.length > 0 && tokenHits === tokens.length) score += 180;
  if (tokens.length > 1) {
    const ordered = tokens.every((token, idx) => idx === 0 || haystack.indexOf(tokens[idx - 1]) <= haystack.indexOf(token));
    if (ordered && tokenHits === tokens.length) score += 40;
  }

  return {
    matched: score > 0 && (tokens.length === 0 || tokenHits === tokens.length || haystack.includes(normalizedQuery) || haystackCompact.includes(queryCompact)),
    score,
    reason: score > 0 ? 'matched' : 'none',
  };
}

export function scoreProductMatch(item, query, parent = null, categoriesById = {}) {
  const context = createSearchContext(categoriesById);
  return scorePreparedProductMatch(item, prepareSearchQuery(query), parent, context);
}

export function buildCategoriesById(categories = []) {
  return (categories || []).reduce((acc, category) => {
    if (category?.id !== undefined && category?.id !== null) acc[Number(category.id)] = category;
    return acc;
  }, {});
}

export function filterProductTree(products = [], query = '', options = {}) {
  const productList = products || [];
  const preparedQuery = prepareSearchQuery(query);
  const { normalizedQuery } = preparedQuery;
  if (!normalizedQuery) return productList;

  const categoriesById = options.categoriesById || buildCategoriesById(options.categories || []);
  const context = createSearchContext(categoriesById);
  const includeAllVariantsOnParentMatch = options.includeAllVariantsOnParentMatch !== false;
  const filteredParents = [];

  for (const parent of productList) {
    const parentScore = scorePreparedProductMatch(parent, preparedQuery, null, context);
    const variants = getProductVariants(parent);
    const matchedVariantIds = [];
    const matchedVariantIdSet = new Set();
    const variantSearchScores = new Map();
    let maxVariantScore = 0;

    for (const variant of variants) {
      const result = scorePreparedProductMatch(variant, preparedQuery, parent, context);
      if (result.matched) {
        const variantId = getVariantIdentity(variant, matchedVariantIds.length);
        matchedVariantIds.push(variantId);
        matchedVariantIdSet.add(variantId);
        variantSearchScores.set(variantId, result.score);
        if (result.score > maxVariantScore) maxVariantScore = result.score;
      }
    }

    const visibleMatchedVariantIds = parentScore.matched && includeAllVariantsOnParentMatch
      ? variants.map((v, index) => getVariantIdentity(v, index))
      : matchedVariantIds;

    if (parentScore.matched || visibleMatchedVariantIds.length > 0) {
      filteredParents.push({
        ...parent,
        _matchesParentSearch: parentScore.matched,
        _matchedVariantIds: visibleMatchedVariantIds,
        _matchedVariantIdSet: parentScore.matched && includeAllVariantsOnParentMatch ? new Set(visibleMatchedVariantIds) : matchedVariantIdSet,
        _variantSearchScores: variantSearchScores,
        _searchScore: Math.max(parentScore.score, maxVariantScore),
      });
    }
  }

  return filteredParents.sort((a, b) => (b._searchScore || 0) - (a._searchScore || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
}

export function flattenProductTree(products = [], options = {}) {
  const rows = [];
  for (const parent of products || []) {
    rows.push({ ...parent, _isParent: true, parent: null });
    const variants = getProductVariants(parent);
    const visibleVariants = options.onlyMatchedVariants && !parent._matchesParentSearch
      ? variants.filter((v, index) => parent._matchedVariantIds?.includes(getVariantIdentity(v, index)))
      : variants;
    for (const variant of visibleVariants) {
      const normalizedVariant = normalizeInventoryVariant(variant, parent, rows.length);
      rows.push({
        ...normalizedVariant,
        _isParent: false,
        _parentId: parent.id,
        parent,
        parent_id: normalizedVariant.parent_id || parent.id,
        parent_name: normalizedVariant.parent_name || parent.name,
        parent_sku: normalizedVariant.parent_sku || parent.sku,
        default_category_id: normalizedVariant.default_category_id || parent.default_category_id || null,
        default_category: normalizedVariant.default_category || parent.default_category || null,
        category: normalizedVariant.category || parent.category || '',
      });
    }
  }
  return rows;
}

export function searchFlatProducts(products = [], query = '', options = {}) {
  const preparedQuery = prepareSearchQuery(query);
  const { normalizedQuery } = preparedQuery;
  const tree = filterProductTree(products, normalizedQuery, options);
  const includeParents = options.includeParents !== false;
  const includeVariants = options.includeVariants !== false;
  const limit = Number(options.limit || 0);
  const canStopEarly = limit > 0 && !normalizedQuery && options.skipSortForEmptyQuery === true;
  const rows = [];

  const pushRow = (row) => {
    if (canStopEarly && rows.length >= limit) return false;
    rows.push(row);
    return !(canStopEarly && rows.length >= limit);
  };

  for (const parent of tree) {
    const parentSearchScore = parent._searchScore || (normalizedQuery ? 0 : 1);
    if (includeParents) {
      const shouldContinue = pushRow({ ...parent, is_variant: false, parent: null, _searchScore: parentSearchScore });
      if (!shouldContinue) break;
    }

    const variants = getProductVariants(parent);
    const visibleVariants = !normalizedQuery || parent._matchesParentSearch
      ? variants
      : variants.filter((v, index) => parent._matchedVariantIdSet?.has(getVariantIdentity(v, index)) || parent._matchedVariantIds?.includes(getVariantIdentity(v, index)));

    if (includeVariants) {
      for (const variant of visibleVariants) {
        const variantSearchScore = normalizedQuery
          ? Math.max(parentSearchScore, parent._variantSearchScores?.get(variant.id) || 0)
          : parentSearchScore;
        const shouldContinue = pushRow({
          ...variant,
          is_variant: true,
          parent_id: parent.id,
          parent_name: parent.name,
          parent_sku: parent.sku,
          parent,
          default_category_id: variant.default_category_id || parent.default_category_id || null,
          default_category: variant.default_category || parent.default_category || null,
          category: variant.category || parent.category || '',
          _searchScore: variantSearchScore,
        });
        if (!shouldContinue) break;
      }
      if (canStopEarly && rows.length >= limit) break;
    }
  }

  const sortedRows = canStopEarly
    ? rows
    : rows.sort((a, b) => (b._searchScore || 0) - (a._searchScore || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
  return limit > 0 ? sortedRows.slice(0, limit) : sortedRows;
}

