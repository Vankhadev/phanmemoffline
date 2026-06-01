/**
 * Store API routes
 */
const express = require('express');
const router = express.Router();
const { getAll, update, insert, now } = require('../db/database');

router.get('/', (req, res) => {
  const s = getAll('store_info')[0] || {};
  res.json(s);
});

router.put('/', (req, res) => {
  const { name, email, phone, tax_code, bank_account, bank_name, address } = req.body;
  const stores = getAll('store_info');
  const payload = {
    name,
    email,
    phone,
    tax_code,
    bank_account,
    bank_name,
    address,
    updated_at: now(),
  };
  if (stores[0]) {
    update('store_info', stores[0].id, payload);
  } else {
    insert('store_info', payload);
  }
  res.json({ ok: true });
});

module.exports = router;