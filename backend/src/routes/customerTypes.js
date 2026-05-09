/**
 * Customer Types API routes
 */
const express = require('express');
const router = express.Router();
const { getAll, insert, update } = require('../db/database');

// Lấy danh sách loại khách
router.get('/', (req, res) => {
  res.json(getAll('customer_types', t => t.active !== 0).sort((a, b) => a.id - b.id));
});

// Thêm loại khách mới
router.post('/', (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Thiếu tên loại khách' });
  const id = insert('customer_types', { name, color: color || '#3b82f6', active: 1 });
  res.json({ id, ok: true });
});

// Sửa loại khách
router.put('/:id', (req, res) => {
  const { name, color } = req.body;
  update('customer_types', +req.params.id, { name, color: color || '#3b82f6' });
  res.json({ ok: true });
});

// Xóa loại khách
router.delete('/:id', (req, res) => {
  update('customer_types', +req.params.id, { active: 0 });
  res.json({ ok: true });
});

module.exports = router;