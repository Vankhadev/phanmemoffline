/**
 * Combos API routes
 */
const express = require('express');
const router = express.Router();
const { getAll, insert, update, remove, now } = require('../db/database');

function toOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeComboItem(item = {}, combo_id) {
  const variant_id = toOptionalNumber(item.variant_id);
  const product_id = toOptionalNumber(item.product_id || item.parent_id);
  const parent_id = toOptionalNumber(item.parent_id) || (variant_id ? product_id : null);
  const item_type = variant_id ? 'variant' : (String(item.item_type || 'product').trim() || 'product');
  const name = String(item.name || '').trim();
  const parentName = String(item.parent_name || '').trim();
  const productName = String(item.product_name || (variant_id ? parentName : name)).trim();
  const variantName = String(item.variant_name || (variant_id ? name : '')).trim();
  const displayName = name || (variant_id ? variantName : productName);

  return {
    combo_id,
    item_type,
    product_id,
    variant_id,
    parent_id,
    name: displayName,
    parent_name: parentName || (variant_id ? productName : ''),
    product_name: productName || displayName,
    variant_name: variantName,
    sku: String(item.sku || '').trim(),
    quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
    unit_price: Math.max(0, toNumber(item.unit_price, 0)),
    retail_price: Math.max(0, toNumber(item.retail_price, item.unit_price || 0)),
    wholesale_price: Math.max(0, toNumber(item.wholesale_price, 0)),
    stock: toNumber(item.stock, 0),
    created_at: now(),
  };
}

function replaceComboItems(combo_id, items = []) {
  for (const item of (Array.isArray(items) ? items : [])) {
    insert('combo_items', normalizeComboItem(item, combo_id));
  }
}

// GET all combos
router.get('/', (req, res) => {
  const combos = getAll('combos', c => !c.hasOwnProperty('active') || c.active !== 0).map(c => ({
    ...c,
    items: getAll('combo_items', ci => ci.combo_id === c.id),
  }));
  res.json(combos);
});

// GET single combo
router.get('/:id', (req, res) => {
  const combo = getAll('combos', c => c.id === +req.params.id && (!c.hasOwnProperty('active') || c.active !== 0))[0];
  if (!combo) return res.status(404).json({ error: 'Không tìm thấy combo' });
  const items = getAll('combo_items', ci => ci.combo_id === combo.id);
  res.json({ ...combo, items });
});

// POST create combo
router.post('/', (req, res) => {
  const { name, sku, retail_price, wholesale_price, vip_price, items } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Tên combo không được để trống' });

  const combo_id = insert('combos', {
    name: name.trim(),
    sku: sku || '',
    retail_price: +retail_price || 0,
    wholesale_price: +wholesale_price || 0,
    vip_price: +vip_price || 0,
    active: 1,
    created_at: now(),
    updated_at: now(),
  });

  replaceComboItems(combo_id, items);

  res.json({ ok: true, combo_id });
});

// PUT update combo
router.put('/:id', (req, res) => {
  const combo = getAll('combos', c => c.id === +req.params.id && (!c.hasOwnProperty('active') || c.active !== 0))[0];
  if (!combo) return res.status(404).json({ error: 'Không tìm thấy combo' });

  const { name, sku, retail_price, wholesale_price, vip_price, items } = req.body;

  update('combos', combo.id, {
    ...(name !== undefined && { name: name.trim() }),
    ...(sku !== undefined && { sku }),
    ...(retail_price !== undefined && { retail_price: +retail_price }),
    ...(wholesale_price !== undefined && { wholesale_price: +wholesale_price }),
    ...(vip_price !== undefined && { vip_price: +vip_price }),
    updated_at: now(),
  });

  if (items !== undefined) {
    // Replace scoped items for this combo only.
    for (const item of getAll('combo_items', ci => ci.combo_id === combo.id)) {
      remove('combo_items', item.id);
    }
    replaceComboItems(combo.id, items);
  }

  res.json({ ok: true });
});

// DELETE (soft delete) combo
router.delete('/:id', (req, res) => {
  const combo = getAll('combos', c => c.id === +req.params.id)[0];
  if (!combo) return res.status(404).json({ error: 'Không tìm thấy combo' });
  update('combos', combo.id, { active: 0 });
  res.json({ ok: true });
});

module.exports = router;
