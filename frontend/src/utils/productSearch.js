export function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

export function findCategoryForProduct(product, categoriesById = {}) {
  if (!product) return null;
  const rawId = product.default_category_id;
  const id = rawId === null || rawId === undefined || rawId === '' ? null : Number(rawId);
  if (id && categoriesById[id]) return categoriesById[id];
  return product.default_category || product.category_info || null;
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

export function scoreProductMatch(item, query, parent = null, categoriesById = {}) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return { matched: true, score: 1, reason: 'empty' };

  const queryCompact = normalizedQuery.replace(/\s+/g, '');
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const fields = buildProductSearchFields(item, parent, categoriesById);
  const haystack = normalizeSearchText(fields);
  const haystackCompact = compactSearchText(fields);
  const name = normalizeSearchText(item?.name);
  const sku = normalizeSearchText(item?.sku);
  const category = findCategoryForProduct(item, categoriesById) || findCategoryForProduct(parent, categoriesById);
  const categoryText = normalizeSearchText(categoryFields(category).join(' '));
  const categoryCompact = compactSearchText(categoryFields(category).join(' '));

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

export function buildCategoriesById(categories = []) {
  return (categories || []).reduce((acc, category) => {
    if (category?.id !== undefined && category?.id !== null) acc[Number(category.id)] = category;
    return acc;
  }, {});
}

export function filterProductTree(products = [], query = '', options = {}) {
  const categoriesById = options.categoriesById || buildCategoriesById(options.categories || []);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return (products || []).map(p => ({
      ...p,
      _matchesParentSearch: true,
      _matchedVariantIds: (p.variants || []).map(v => v.id),
      _searchScore: 1,
    }));
  }

  return (products || [])
    .map(parent => {
      const parentScore = scoreProductMatch(parent, normalizedQuery, null, categoriesById);
      const matchedVariantScores = (parent.variants || [])
        .map(variant => ({ variant, result: scoreProductMatch(variant, normalizedQuery, parent, categoriesById) }))
        .filter(({ result }) => result.matched);
      const matchedVariantIds = parentScore.matched && options.includeAllVariantsOnParentMatch !== false
        ? (parent.variants || []).map(v => v.id)
        : matchedVariantScores.map(({ variant }) => variant.id);
      const maxVariantScore = matchedVariantScores.reduce((max, item) => Math.max(max, item.result.score), 0);
      return {
        ...parent,
        _matchesParentSearch: parentScore.matched,
        _matchedVariantIds: matchedVariantIds,
        _searchScore: Math.max(parentScore.score, maxVariantScore),
      };
    })
    .filter(parent => parent._matchesParentSearch || parent._matchedVariantIds.length > 0)
    .sort((a, b) => (b._searchScore || 0) - (a._searchScore || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
}

export function flattenProductTree(products = [], options = {}) {
  const rows = [];
  for (const parent of products || []) {
    rows.push({ ...parent, _isParent: true, parent: null });
    const variants = parent.variants || [];
    const visibleVariants = options.onlyMatchedVariants && !parent._matchesParentSearch
      ? variants.filter(v => parent._matchedVariantIds?.includes(v.id))
      : variants;
    for (const variant of visibleVariants) {
      rows.push({
        ...variant,
        _isParent: false,
        _parentId: parent.id,
        parent,
        default_category_id: variant.default_category_id || parent.default_category_id || null,
        default_category: variant.default_category || parent.default_category || null,
        category: variant.category || parent.category || '',
      });
    }
  }
  return rows;
}

export function searchFlatProducts(products = [], query = '', options = {}) {
  const tree = filterProductTree(products, query, options);
  const includeParents = options.includeParents !== false;
  const includeVariants = options.includeVariants !== false;
  const rows = [];
  for (const parent of tree) {
    if (includeParents) rows.push({ ...parent, is_variant: false, parent: null });
    const variants = parent.variants || [];
    const visibleVariants = !normalizeSearchText(query) || parent._matchesParentSearch
      ? variants
      : variants.filter(v => parent._matchedVariantIds?.includes(v.id));
    if (includeVariants) {
      for (const variant of visibleVariants) {
        rows.push({
          ...variant,
          is_variant: true,
          parent_id: parent.id,
          parent_name: parent.name,
          parent_sku: parent.sku,
          parent,
          default_category_id: variant.default_category_id || parent.default_category_id || null,
          default_category: variant.default_category || parent.default_category || null,
          category: variant.category || parent.category || '',
          _searchScore: Math.max(parent._searchScore || 0, scoreProductMatch(variant, query, parent, options.categoriesById || {}).score),
        });
      }
    }
  }
  return rows.sort((a, b) => (b._searchScore || 0) - (a._searchScore || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
}
