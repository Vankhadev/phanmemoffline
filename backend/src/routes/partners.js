/**
 * Partners API routes (Nhà cung cấp)
 */
const express = require('express');
const router = express.Router();
const { getAll, insert, update, now } = require('../db/database');

// Lấy danh sách NCC
router.get('/', (req, res) => {
  const all = getAll('partners');
  // Nếu có trường active thì lọc, không thì trả tất cả
  const active = all.filter(p => p.active === undefined || p.active === 1);
  res.json(active.sort((a, b) => a.name.localeCompare(b.name)));
});

// Thêm NCC mới
router.post('/', (req, res) => {
  const { name, phone, tax_code, email, address, note, invoice_type } = req.body;
  if (!name) return res.status(400).json({ error: 'Thiếu tên nhà cung cấp' });
  const id = insert('partners', {
    name,
    phone: phone || '',
    tax_code: tax_code || '',
    email: email || '',
    address: address || '',
    note: note || '',
    invoice_type: invoice_type || 'non_electronic', // 'electronic' | 'non_electronic'
    active: 1,
    created_at: now(),
  });
  res.json({ id, ok: true });
});

// Sửa NCC
router.put('/:id', (req, res) => {
  const { name, phone, tax_code, email, address, note, invoice_type } = req.body;
  update('partners', +req.params.id, {
    name, phone: phone || '', tax_code: tax_code || '', email: email || '',
    address: address || '', note: note || '',
    invoice_type: invoice_type || undefined
  });
  res.json({ ok: true });
});

// Xóa NCC (soft delete)
router.delete('/:id', (req, res) => {
  update('partners', +req.params.id, { active: 0 });
  res.json({ ok: true });
});

module.exports = router;
