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
  const { name, email, phone, tax_code, bank_account, bank_name, address,
    invoice_width, invoice_logo, invoice_slogan, invoice_note, invoice_vietqr_logo } = req.body;
  const stores = getAll('store_info');
  if (stores[0]) {
    update('store_info', stores[0].id, {
      name, email, phone, tax_code, bank_account, bank_name, address,
      invoice_width, invoice_logo, invoice_slogan, invoice_note, invoice_vietqr_logo,
      updated_at: now(),
    });
  } else {
    insert('store_info', {
      name, email, phone, tax_code, bank_account, bank_name, address,
      invoice_width, invoice_logo, invoice_slogan, invoice_note, invoice_vietqr_logo,
      updated_at: now(),
    });
  }
  res.json({ ok: true });
});

module.exports = router;