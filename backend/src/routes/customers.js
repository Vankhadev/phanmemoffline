/**
 * Customers API routes
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, now } = require('../db/database');

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
  const { name, phone, email, tax_code, customer_type, invoice_type, address, note } = req.body;
  if (!name) return res.status(400).json({ error: 'Thiếu tên khách hàng' });
  // Lưu customer_type dưới dạng tên (string)
  const types = getAll('customer_types', t => t.active !== 0);
  const ct = types.find(t => String(t.id) === String(customer_type));
  const typeName = ct ? ct.name : (customer_type || 'Khách lẻ');
  const id = insert('customers', {
    name, phone: phone || '', email: email || '',
    tax_code: tax_code || '', customer_type: typeName,
    invoice_type: invoice_type || 'non_electronic', // 'electronic' | 'non_electronic'
    address: address || '',
    note: note || '',
    customer_code: req.body.customer_code || '',
    created_at: now(),
  });
  res.json({ id, ok: true });
});

router.put('/:id', (req, res) => {
  const { name, phone, email, tax_code, customer_type, invoice_type, address, note } = req.body;
  if (!name) return res.status(400).json({ error: 'Thiếu tên khách hàng' });
  const types = getAll('customer_types', t => t.active !== 0);
  const ct = types.find(t => String(t.id) === String(customer_type));
  const typeName = ct ? ct.name : (customer_type || 'Khách lẻ');
  update('customers', +req.params.id, {
    name, phone: phone || '', email: email || '',
    tax_code: tax_code || '', customer_type: typeName,
    invoice_type: invoice_type || undefined,
    ...(address !== undefined && { address: address || '' }),
    ...(note !== undefined && { note: note || '' }),
    ...(Object.prototype.hasOwnProperty.call(req.body, 'customer_code') && { customer_code: req.body.customer_code || '' }),
  });
  res.json({ ok: true });
});

function parseCustomerId(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getCustomerInvoiceCount(id) {
  return getAll('invoices', inv => Number(inv.customer_id) === Number(id)).length;
}

function softDeleteCustomerById(id) {
  const customer = getOne('customers', c => Number(c.id) === Number(id));
  if (!customer) {
    return {
      id,
      ok: false,
      status: 404,
      deleted: false,
      skipped: true,
      reason: 'not_found',
      message: 'Không tìm thấy khách hàng',
    };
  }

  const invoiceCount = getCustomerInvoiceCount(id);
  if (customer.active === 0) {
    return {
      id,
      ok: true,
      deleted: false,
      already_deleted: true,
      reason: 'already_deleted',
      invoice_count: invoiceCount,
      relation_preserved: invoiceCount > 0,
      message: 'Khách hàng đã được xóa trước đó',
    };
  }

  update('customers', id, { active: 0 });
  return {
    id,
    ok: true,
    deleted: true,
    already_deleted: false,
    invoice_count: invoiceCount,
    relation_preserved: invoiceCount > 0,
    message: invoiceCount > 0
      ? 'Đã xóa mềm khách hàng; dữ liệu đơn hàng liên quan được giữ nguyên'
      : 'Đã xóa mềm khách hàng',
  };
}

router.delete('/bulk', (req, res) => {
  try {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (rawIds.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Danh sách id khách hàng cần xóa là bắt buộc',
        requested_count: 0,
        valid_count: 0,
        invalid_ids: [],
        duplicate_ids: [],
        results: [],
      });
    }

    const seen = new Set();
    const ids = [];
    const invalidIds = [];
    const duplicateIds = [];

    rawIds.forEach(rawId => {
      const id = parseCustomerId(rawId);
      if (!id) {
        invalidIds.push(rawId);
        return;
      }
      if (seen.has(id)) {
        duplicateIds.push(id);
        return;
      }
      seen.add(id);
      ids.push(id);
    });

    if (ids.length === 0) {
      return res.json({
        ok: true,
        requested_count: rawIds.length,
        valid_count: 0,
        invalid_count: invalidIds.length,
        duplicate_count: duplicateIds.length,
        deleted_count: 0,
        already_deleted_count: 0,
        not_found_count: 0,
        preserved_relation_count: 0,
        invalid_ids: invalidIds,
        duplicate_ids: duplicateIds,
        results: [],
        message: 'Không có id khách hàng hợp lệ để xóa; các id không hợp lệ đã được bỏ qua.',
      });
    }

    const results = ids.map(softDeleteCustomerById);
    const deletedCount = results.filter(result => result.deleted).length;
    const alreadyDeletedCount = results.filter(result => result.already_deleted).length;
    const notFoundCount = results.filter(result => result.reason === 'not_found').length;
    const preservedRelationCount = results.filter(result => result.relation_preserved).length;

    res.json({
      ok: true,
      requested_count: rawIds.length,
      valid_count: ids.length,
      invalid_count: invalidIds.length,
      duplicate_count: duplicateIds.length,
      deleted_count: deletedCount,
      already_deleted_count: alreadyDeletedCount,
      not_found_count: notFoundCount,
      preserved_relation_count: preservedRelationCount,
      invalid_ids: invalidIds,
      duplicate_ids: duplicateIds,
      results,
      message: `Đã xóa ${deletedCount} khách hàng. Bỏ qua ${invalidIds.length + duplicateIds.length + notFoundCount + alreadyDeletedCount} mục không cần xóa.`,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Lỗi khi xóa hàng loạt khách hàng', detail: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const id = parseCustomerId(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'Id khách hàng không hợp lệ' });

    const result = softDeleteCustomerById(id);
    if (!result.ok) return res.status(result.status || 500).json({ ok: false, error: result.message || 'Không thể xóa khách hàng', result });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Lỗi khi xóa khách hàng', detail: err.message });
  }
});

module.exports = router;