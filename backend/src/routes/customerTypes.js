/**
 * Customer Types API routes
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, now } = require('../db/database');

// Lấy danh sách loại khách
router.get('/', (req, res) => {
  res.json(getAll('customer_types', t => t.active !== 0).sort((a, b) => a.id - b.id));
});

// Thêm loại khách mới
router.post('/', (req, res) => {
  const { name, color } = req.body || {};
  const normalizedName = String(name || '').trim();
  if (!normalizedName) return res.status(400).json({ ok: false, error: 'Thiếu tên loại khách' });
  const duplicate = getOne('customer_types', item => item.active !== 0 && String(item.name || '').trim().toLowerCase() === normalizedName.toLowerCase());
  if (duplicate) return res.status(409).json({ ok: false, error: 'Tên loại khách đã tồn tại' });
  const id = insert('customer_types', { name: normalizedName, color: color || '#3b82f6', active: 1, created_at: now(), updated_at: now() });
  res.json({ id, ok: true });
});

// Sửa loại khách
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const current = getOne('customer_types', item => Number(item.id) === id && item.active !== 0);
  if (!current) return res.status(404).json({ ok: false, error: 'Không tìm thấy loại khách' });
  const { name, color } = req.body || {};
  const normalizedName = String(name || '').trim();
  if (!normalizedName) return res.status(400).json({ ok: false, error: 'Thiếu tên loại khách' });
  const duplicate = getOne('customer_types', item => item.active !== 0 && Number(item.id) !== id && String(item.name || '').trim().toLowerCase() === normalizedName.toLowerCase());
  if (duplicate) return res.status(409).json({ ok: false, error: 'Tên loại khách đã tồn tại' });
  update('customer_types', id, { name: normalizedName, color: color || '#3b82f6', updated_at: now() });
  res.json({ ok: true });
});

// Xóa loại khách
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const current = getOne('customer_types', item => Number(item.id) === id && item.active !== 0);
  if (!current) return res.status(404).json({ ok: false, error: 'Không tìm thấy loại khách' });
  update('customer_types', id, { active: 0, updated_at: now() });
  res.json({ ok: true });
});

module.exports = router;