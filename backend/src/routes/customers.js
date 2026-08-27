/**
 * Customers API routes
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, now } = require('../db/database');

function normalizeCustomerRow(row = {}) {
  return {
    ...row,
    active: row.active === undefined || row.active === null ? 1 : Number(row.active) === 0 ? 0 : 1,
  };
}

router.get('/', (req, res) => {
  try {
    const q = String(req.query.q || req.query.search || '').trim().toLowerCase();
    let customers = getAll('customers', c => Number(c.active) !== 0);

    if (q) {
      customers = customers.filter(c => {
        if (!c._searchableText) {
          c._searchableText = [
            c.name,
            c.phone,
            c.email,
            c.customer_code,
            c.tax_code
          ].filter(Boolean).join(' ').toLowerCase();
        }
        return c._searchableText.includes(q);
      });
    }

    // Sort A-Z by name
    customers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));

    // Return all customers by default so newly-added customers are never hidden
    // after the list grows beyond the old 100-row default. A limit can still be
    // supplied explicitly by search/dropdown screens that need a smaller payload.
    const hasExplicitLimit = Object.prototype.hasOwnProperty.call(req.query, 'limit');
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = hasExplicitLimit && Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 10000)
      : null;
    const pagedCustomers = limit ? customers.slice(0, limit) : customers;

    const types = getAll('customer_types', t => t.active !== 0);
    const invoices = getAll('invoices');
    
    // Efficiently calculate overall stats in O(invoices) time
    const invoiceCountMap = new Map();
    const invoiceRevenueMap = new Map();
    const invoiceDebtMap = new Map();
    const normalizeCustomerName = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const invoiceByCustomerName = new Map();
    for (const inv of invoices) {
      if (inv.status === 'cancelled') continue;
      const cid = Number(inv.customer_id);
      const name = normalizeCustomerName(inv.customer_name || inv.customerName || inv.receiver_name || inv.buyer_name);
      const revenue = Number(inv.total ?? inv.total_amount) || 0;
      const debt = Math.max(0, Number(inv.remaining_amount) || 0);
      if (cid) {
        invoiceCountMap.set(cid, (invoiceCountMap.get(cid) || 0) + 1);
        invoiceRevenueMap.set(cid, (invoiceRevenueMap.get(cid) || 0) + revenue);
        invoiceDebtMap.set(cid, (invoiceDebtMap.get(cid) || 0) + debt);
      } else if (name && name !== 'khách lẻ') {
        const current = invoiceByCustomerName.get(name) || { count: 0, revenue: 0, debt: 0 };
        invoiceByCustomerName.set(name, { count: current.count + 1, revenue: current.revenue + revenue, debt: current.debt + debt });
      }
    }

    const result = pagedCustomers.map(c => {
      const ct = types.find(t => String(t.id) === String(c.customer_type) || t.name?.toLowerCase() === String(c.customer_type || '').toLowerCase());
      return {
        ...c,
        customer_type_name: ct ? ct.name : c.customer_type || 'Khách lẻ',
        invoice_count: invoiceCountMap.get(Number(c.id)) || invoiceByCustomerName.get(normalizeCustomerName(c.name))?.count || 0,
        total_revenue: invoiceRevenueMap.get(Number(c.id)) || invoiceByCustomerName.get(normalizeCustomerName(c.name))?.revenue || 0,
        total_debt: invoiceDebtMap.get(Number(c.id)) || invoiceByCustomerName.get(normalizeCustomerName(c.name))?.debt || 0,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi tải danh sách khách hàng: ' + err.message });
  }
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
    active: 1,
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
  const updatedPayload = normalizeCustomerRow({
    name, phone: phone || '', email: email || '',
    tax_code: tax_code || '', customer_type: typeName,
    invoice_type: invoice_type || undefined,
    ...(address !== undefined && { address: address || '' }),
    ...(note !== undefined && { note: note || '' }),
    ...(Object.prototype.hasOwnProperty.call(req.body, 'customer_code') && { customer_code: req.body.customer_code || '' }),
    ...(Object.prototype.hasOwnProperty.call(req.body, 'active') && { active: req.body.active }),
  });
  update('customers', +req.params.id, updatedPayload);
  const updated = getOne('customers', row => Number(row.id) === Number(req.params.id), { skipAccountScope: true });
  res.json({ ok: true, item: normalizeCustomerRow(updated || { id: +req.params.id, ...updatedPayload }) });
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
