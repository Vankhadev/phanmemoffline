/**
 * Customers API routes
 */
const express = require('express');
const router = express.Router();
const { getAll, insert, update, now } = require('../db/database');

router.get('/', (req, res) => {
  // Join customer_type name, chỉ lấy khách hàng active
  const customers = getAll('customers', c => c.active !== 0).sort((a, b) => a.name.localeCompare(b.name));
  const types = getAll('customer_types', t => t.active !== 0);
  const result = customers.map(c => {
    const ct = types.find(t => String(t.id) === String(c.customer_type) || t.name?.toLowerCase() === String(c.customer_type || '').toLowerCase());
    return { ...c, customer_type_name: ct ? ct.name : c.customer_type || 'Khách lẻ' };
  });
  res.json(result);
});

router.post('/', (req, res) => {
  const { name, phone, email, tax_code, customer_type, invoice_type } = req.body;
  if (!name) return res.status(400).json({ error: 'Thiếu tên khách hàng' });
  // Lưu customer_type dưới dạng tên (string)
  const types = getAll('customer_types', t => t.active !== 0);
  const ct = types.find(t => String(t.id) === String(customer_type));
  const typeName = ct ? ct.name : (customer_type || 'Khách lẻ');
  const id = insert('customers', {
    name, phone: phone || '', email: email || '',
    tax_code: tax_code || '', customer_type: typeName,
    invoice_type: invoice_type || 'non_electronic', // 'electronic' | 'non_electronic'
    created_at: now(),
  });
  res.json({ id, ok: true });
});

router.put('/:id', (req, res) => {
  const { name, phone, email, tax_code, customer_type, invoice_type } = req.body;
  if (!name) return res.status(400).json({ error: 'Thiếu tên khách hàng' });
  const types = getAll('customer_types', t => t.active !== 0);
  const ct = types.find(t => String(t.id) === String(customer_type));
  const typeName = ct ? ct.name : (customer_type || 'Khách lẻ');
  update('customers', +req.params.id, {
    name, phone: phone || '', email: email || '',
    tax_code: tax_code || '', customer_type: typeName,
    invoice_type: invoice_type || undefined
  });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  update('customers', +req.params.id, { active: 0 });
  res.json({ ok: true });
});

module.exports = router;