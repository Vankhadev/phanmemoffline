/**
 * Returns (Trả hàng) API routes
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, now, db, withAtomicDbWrite } = require('../db/database');
const { v4: uuidv4 } = require('uuid');
const {
  applyProductStockDeltaLocked,
  logNegativeStockLimitViolation,
  buildNegativeStockErrorResponse,
} = require('../utils/negativeStock');

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
  try {
    const result = withAtomicDbWrite(() => {
      const { partner_id, user_id, note, details } = req.body;
      const return_code = genReturnCode();
      const return_id = insert('return_logs', {
        return_code,
        partner_id: partner_id || null,
        user_id:   user_id   || null,
        note:      note      || '',
        created_at: now(),
      }, { skipSave: true });

      for (const d of (details || [])) {
        const quantity = +d.quantity || 1;
        insert('return_details', {
          return_id,
          product_id:   d.product_id   || null,
          product_name: d.product_name || '',
          sku:          d.sku        || '',
          quantity,
          unit_price:  +d.unit_price || 0,
          reason:      d.reason      || '',
          line_total:  quantity * (+d.unit_price || 0),
        }, { skipSave: true });
        // Trừ tồn kho khi trả hàng về nhà cung cấp theo policy xuất âm cấu hình động.
        if (d.product_id) {
          const p = getOne('products', pr => Number(pr.id) === Number(d.product_id));
          if (p) {
            applyProductStockDeltaLocked({
              productId: p.id,
              detail: { product_name: d.product_name || p.name, product_sku: d.sku || p.sku },
              delta: -quantity,
              quantity,
              operation: 'trả hàng nhà cung cấp',
              changes: { updated_at: now() },
              options: { skipSave: true },
              source: 'returns',
              meta: { return_id },
            });
          }
        }
      }

      return { ok: true, return_id, return_code };
    });

    res.json(result);
  } catch (err) {
    const status = err.status || err.statusCode || 500;
    logNegativeStockLimitViolation(err, { source: 'returns_create' });
    res.status(status).json(buildNegativeStockErrorResponse(err, 'Lỗi khi tạo phiếu trả hàng'));
  }
});

module.exports = router;