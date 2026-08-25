function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, match => (match === 'Đ' ? 'D' : 'd'))
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/(\d+)\s*t\s*(\d+)/g, '$1t$2')
    .toLowerCase()
    .replace(/(\d+)\s*(cm|mm|m|ml|l|kg|g)\b/g, '$1$2')
    .replace(/\b(cm|mm|m|ml|l|kg|g)\s+(\d+)\b/g, '$2$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactSearchText(value) {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function normalizeKey(value) {
  return normalizeSearchText(value).replace(/\s+/g, '_');
}

function parseKeywordList(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[,;\n]/)
    .map(v => v.trim())
    .filter(Boolean);
}

function categoryFields(category) {
  if (!category) return [];
  return [
    category.name,
    category.group_name,
    category.group_key,
    ...parseKeywordList(category.keywords),
    ...parseKeywordList(category.aliases),
  ].filter(Boolean);
}

function findCategoryForProduct(product, categoriesById = {}) {
  if (!product) return null;
  const id = product.default_category_id == null || product.default_category_id === '' ? null : Number(product.default_category_id);
  if (id && categoriesById[id]) return categoriesById[id];
  return product.default_category || product.category_info || null;
}

function buildProductSearchFields(item, parent, categoriesById = {}) {
  const category = findCategoryForProduct(item, categoriesById) || findCategoryForProduct(parent, categoriesById);
  const parentCategory = findCategoryForProduct(parent, categoriesById);
  return [
    parent && parent.name,
    parent && parent.sku,
    parent && parent.category,
    parent && parent.unit,
    ...categoryFields(parentCategory),
    item && item.name,
    item && item.sku,
    item && item.category,
    item && item.unit,
    item && item.color,
    item && item.size,
    item && item.attributes,
    ...categoryFields(category),
  ].filter(Boolean).join(' ');
}

function scoreProductMatch(item, query, parent, categoriesById = {}) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return { matched: true, score: 1, reason: 'empty' };

  const queryCompact = normalizedQuery.replace(/\s+/g, '');
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const fields = buildProductSearchFields(item, parent, categoriesById);
  const haystack = normalizeSearchText(fields);
  const haystackCompact = compactSearchText(fields);
  const name = normalizeSearchText(item && item.name);
  const sku = normalizeSearchText(item && item.sku);
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

  return { matched: score > 0 && (tokens.length === 0 || tokenHits === tokens.length || haystack.includes(normalizedQuery) || haystackCompact.includes(queryCompact)), score, reason: score > 0 ? 'matched' : 'none' };
}

function searchFlatProducts(products, query, categoriesById = {}) {
  const rows = [];
  const active = (products || []).filter(p => p && p.active !== 0);
  const parents = active.filter(p => !p.parent_id);
  const byParent = new Map();
  active.filter(p => p.parent_id).forEach(v => {
    if (!byParent.has(v.parent_id)) byParent.set(v.parent_id, []);
    byParent.get(v.parent_id).push(v);
  });

  for (const parent of parents) {
    const parentScore = scoreProductMatch(parent, query, null, categoriesById);
    if (parentScore.matched) rows.push({ ...parent, is_variant: false, parent: null, _searchScore: parentScore.score });
    for (const variant of byParent.get(parent.id) || []) {
      const variantScore = scoreProductMatch(variant, query, parent, categoriesById);
      if (variantScore.matched || parentScore.matched) {
        rows.push({
          ...variant,
          is_variant: true,
          parent_id: parent.id,
          parent_name: parent.name,
          parent_sku: parent.sku,
          parent,
          default_category_id: variant.default_category_id || parent.default_category_id || null,
          _searchScore: Math.max(variantScore.score, parentScore.score - 25),
        });
      }
    }
  }

  return rows.sort((a, b) => (b._searchScore || 0) - (a._searchScore || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
}

module.exports = {
  normalizeSearchText,
  compactSearchText,
  normalizeKey,
  parseKeywordList,
  categoryFields,
  findCategoryForProduct,
  buildProductSearchFields,
  scoreProductMatch,
  searchFlatProducts,
};
