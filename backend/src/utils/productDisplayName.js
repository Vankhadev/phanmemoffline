function firstNonEmpty(...values) {
  const found = values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
  return found === undefined ? '' : String(found).trim();
}

function normalizeDisplayKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildVariantDisplayName(item = {}, parent = null) {
  const parentName = firstNonEmpty(
    parent && parent.name,
    item.parent_name,
    item.parentName,
    item.parent && item.parent.name,
    item.product_parent_name,
  );
  const currentName = firstNonEmpty(
    item.display_name,
    item.displayName,
    item.product_name,
    item.productName,
    item.name,
    item.variant_name,
    item.variantName,
  );
  const variantName = firstNonEmpty(
    item.variant_name,
    item.variantName,
    item.variant && item.variant.name,
    item.name,
    currentName,
  );

  if (!parentName) return currentName || variantName;
  if (!variantName) return currentName || parentName;

  const parentKey = normalizeDisplayKey(parentName);
  const currentKey = normalizeDisplayKey(currentName);
  const variantKey = normalizeDisplayKey(variantName);

  if (currentName && parentKey && currentKey.includes(parentKey)) {
    if (!variantKey || currentKey.includes(variantKey) || variantKey.includes(parentKey)) return currentName;
  }
  if (variantKey && parentKey && variantKey.includes(parentKey)) return variantName;

  return `${parentName} - ${variantName}`;
}

function getProductDisplayName(item = {}, parent = null) {
  const type = String(item.type || item.item_type || item.product_type || '').trim().toLowerCase();
  if (type === 'combo' || item.combo_id || item.is_combo || item.isCombo) {
    return firstNonEmpty(item.product_name, item.name, item.combo_name, 'Combo');
  }
  if (type === 'service' || type === 'custom_service' || item.is_service || item.isService) {
    return firstNonEmpty(item.product_name, item.name, item.service_name, 'Dịch vụ');
  }

  const isVariant = Boolean(
    parent
    || item.is_variant
    || item.parent_id
    || item._parentId
    || item.variant_id
    || item.parent_name
    || (item.parent && item.parent.name)
    || item.variant_name
    || (item.variant && item.variant.name)
  );

  if (isVariant) return buildVariantDisplayName(item, parent);
  return firstNonEmpty(item.display_name, item.displayName, item.product_name, item.productName, item.name, item.combo_name, item.sku, 'Sản phẩm');
}

function resolveInvoiceDetailDisplayFields(detail = {}, getProductById = () => null) {
  const comboLine = detail.type === 'combo' || detail.item_type === 'combo' || Boolean(detail.combo_id);
  if (comboLine) {
    const comboName = firstNonEmpty(detail.product_name, detail.name, detail.combo_name, 'Combo');
    const comboSku = firstNonEmpty(detail.product_sku, detail.sku, detail.combo_sku, '');
    return { product_name: comboName, name: comboName, product_sku: comboSku, sku: comboSku, variant_id: null };
  }

  const serviceLine = detail.type === 'service'
    || detail.item_type === 'service'
    || detail.type === 'custom_service'
    || detail.item_type === 'custom_service'
    || detail.is_service
    || detail.isService;
  if (serviceLine) {
    const serviceName = firstNonEmpty(detail.product_name, detail.name, detail.service_name, 'Dịch vụ');
    return { product_name: serviceName, name: serviceName, product_sku: '', sku: '', variant_id: null };
  }

  const productId = firstNonEmpty(detail.product_id, detail.productId);
  const variantId = firstNonEmpty(detail.variant_id, '');
  const lookupId = variantId || productId;
  const product = lookupId ? (getProductById(lookupId) || null) : null;
  const parent = product && product.parent_id ? (getProductById(product.parent_id) || null) : null;
  const isVariant = Boolean(variantId || (product && product.parent_id) || detail.parent_id || detail.parent_name || detail.variant_name);

  const itemForName = {
    ...(product || {}),
    ...detail,
    is_variant: isVariant || detail.is_variant,
    parent_id: (product && product.parent_id) || detail.parent_id || detail.parentId || null,
    parent_name: firstNonEmpty(detail.parent_name, detail.parentName, parent && parent.name),
    product_name: firstNonEmpty(detail.product_name, detail.name, product && product.name),
    name: firstNonEmpty(detail.variant_name, detail.variantName, product && product.name, detail.name, detail.product_name),
  };
  const productName = getProductDisplayName(itemForName, parent);
  const productSku = firstNonEmpty(detail.product_sku, detail.sku, product && product.sku, '');

  return {
    product_name: productName,
    name: productName,
    product_sku: productSku,
    sku: productSku,
    variant_id: isVariant ? (variantId || (product && product.id) || null) : null,
  };
}

module.exports = {
  buildVariantDisplayName,
  getProductDisplayName,
  resolveInvoiceDetailDisplayFields,
};
