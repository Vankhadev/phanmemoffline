/**
 * Returns (Trả hàng) API routes
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, now, db } = require('../db/database');
const { v4: uuidv4 } = require('uuid');

function genReturnCode() {
  const d = new Date();
  return `RT${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}-${uuidv4().slice(0, 6).toUpperCase()}`;
}

router.get('/', (req, res) => {
  const rows = getAll('return_logs').map(r => ({
    ...r,
    partner_name: getOne('partners', p => p.id === r.partner_id)?.name || '',
    user_name:   getOne('users',   u => u.id === r.user_id)?.name   || '',
  })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const r = getOne('return_logs', r => r.id === +req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const details = getAll('return_details', d => d.return_id === r.id);
  res.json({ ...r, details });
});

router.post('/', (req, res) => {
  const { partner_id, user_id, note, details } = req.body;
  const return_code = genReturnCode();
  const return_id = insert('return_logs', {
    return_code,
    partner_id: partner_id || null,
    user_id:   user_id   || null,
    note:      note      || '',
    created_at: now(),
  });

  for (const d of (details || [])) {
    insert('return_details', {
      return_id,
      product_id:   d.product_id   || null,
      product_name: d.product_name || '',
      sku:          d.sku        || '',
      quantity:     +d.quantity   || 1,
      unit_price:  +d.unit_price || 0,
      reason:      d.reason      || '',
      line_total:  (+d.quantity || 1) * (+d.unit_price || 0),
    });
    // Trừ tồn kho khi trả hàng
    if (d.product_id) {
      const p = getOne('products', pr => pr.id === d.product_id);
      if (p) update('products', p.id, { stock: Math.max(0, (p.stock || 0) - (+d.quantity || 1)) });
    }
  }

  res.json({ ok: true, return_id, return_code });
});

module.exports = router;