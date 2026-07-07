const express = require('express');
const router = express.Router();
const {
  getById,
  getByForeignKey,
  getPaginated,
} = require('../db/database');

// ====================== ORDERS (compatibility relational view) ======================
router.get('/orders', (req, res) => {
  try {
    const { limit = 50, offset = 0, sortBy = 'created_at', sortDir = 'desc', status, customerId, search } = req.query;
    const filter = (row) => {
      if (row.deleted_at) return false;
      if (status && row.status !== status) return false;
      if (customerId && Number(row.customer_id) !== Number(customerId)) return false;
      if (search) {
        const term = String(search).toLowerCase();
        return (row.order_code || '').toLowerCase().includes(term) ||
               (row.customer_name_snapshot || '').toLowerCase().includes(term);
      }
      return true;
    };
    const result = getPaginated('orders', filter, { limit: +limit, offset: +offset, sortBy, sortDir });
    res.json({ success: true, ok: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, code: 'ORDERS_LIST_FAILED', message: 'Loi lay danh sach don hang: ' + err.message });
  }
});

router.get('/orders/:id', (req, res) => {
  try {
    const order = getById('orders', req.params.id);
    if (!order) return res.status(404).json({ success: false, ok: false, code: 'ORDER_NOT_FOUND', message: 'Khong tim thay don hang' });
    const items = getByForeignKey('order_items', 'order_id', order.id);
    res.json({ success: true, ok: true, order, items });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, code: 'ORDER_DETAIL_FAILED', message: err.message });
  }
});

// ====================== SUPPLIERS ======================
router.get('/suppliers', (req, res) => {
  try {
    const { limit = 50, offset = 0, search } = req.query;
    const filter = (row) => {
      if (row.deleted_at) return false;
      if (!search) return true;
      const term = String(search).toLowerCase();
      return (row.name || '').toLowerCase().includes(term) || (row.phone || '').includes(term);
    };
    const result = getPaginated('suppliers', filter, { limit: +limit, offset: +offset, sortBy: 'name', sortDir: 'asc' });
    res.json({ success: true, ok: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, code: 'SUPPLIERS_LIST_FAILED', message: 'Loi lay danh sach nha cung cap: ' + err.message });
  }
});

router.get('/suppliers/:id', (req, res) => {
  try {
    const supplier = getById('suppliers', req.params.id);
    if (!supplier) return res.status(404).json({ success: false, ok: false, code: 'SUPPLIER_NOT_FOUND', message: 'Khong tim thay nha cung cap' });
    res.json({ success: true, ok: true, supplier });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, code: 'SUPPLIER_DETAIL_FAILED', message: err.message });
  }
});

// ====================== INVOICE TEMPLATES (relational mirror) ======================
router.get('/invoice-templates', (req, res) => {
  try {
    const { limit = 50, offset = 0, isActive } = req.query;
    const filter = (row) => {
      if (isActive !== undefined) return row.is_active === (isActive === 'true');
      return true;
    };
    const result = getPaginated('invoice_templates', filter, { limit: +limit, offset: +offset, sortBy: 'name', sortDir: 'asc' });
    res.json({ success: true, ok: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, code: 'INVOICE_TEMPLATES_LIST_FAILED', message: 'Loi lay danh sach mau in: ' + err.message });
  }
});

// ====================== AUDIT LOGS ======================
router.get('/audit-logs', (req, res) => {
  try {
    const { limit = 50, offset = 0, entityType, action } = req.query;
    const filter = (row) => {
      if (entityType && (row.entity_type !== entityType && row.meta?.entity_type !== entityType)) return false;
      if (action && row.action !== action) return false;
      return true;
    };
    const result = getPaginated('audit_logs', filter, { limit: +limit, offset: +offset, sortBy: 'created_at', sortDir: 'desc' });
    res.json({ success: true, ok: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, code: 'AUDIT_LOGS_LIST_FAILED', message: 'Loi lay audit log: ' + err.message });
  }
});

// ====================== PRODUCTS (optimized search) ======================
router.get('/products', (req, res) => {
  try {
    const { limit = 50, offset = 0, search, categoryId, isActive } = req.query;
    const filter = (row) => {
      if (row.deleted_at) return false;
      if (isActive !== undefined && row.is_active !== (isActive === 'true')) return false;
      if (categoryId && Number(row.category_id || row.rel_category_id) !== Number(categoryId)) return false;
      if (!search) return true;
      const term = String(search).toLowerCase();
      return (row.name || '').toLowerCase().includes(term) ||
             (row.sku || '').toLowerCase().includes(term) ||
             (row.internal_code || '').toLowerCase().includes(term) ||
             (row.barcode || '').includes(term);
    };
    const result = getPaginated('products', filter, { limit: +limit, offset: +offset, sortBy: 'name', sortDir: 'asc' });
    res.json({ success: true, ok: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, code: 'PRODUCTS_LIST_FAILED', message: 'Loi lay danh sach san pham: ' + err.message });
  }
});

router.get('/products/:id', (req, res) => {
  try {
    const product = getById('products', req.params.id);
    if (!product) return res.status(404).json({ success: false, ok: false, code: 'PRODUCT_NOT_FOUND', message: 'Khong tim thay san pham' });
    res.json({ success: true, ok: true, product });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, code: 'PRODUCT_DETAIL_FAILED', message: err.message });
  }
});

// ====================== PAYMENTS ======================
router.get('/payments', (req, res) => {
  try {
    const { limit = 50, offset = 0, orderId } = req.query;
    const filter = (row) => {
      if (orderId && Number(row.order_id) !== Number(orderId)) return false;
      return true;
    };
    const result = getPaginated('payments', filter, { limit: +limit, offset: +offset, sortBy: 'paid_at', sortDir: 'desc' });
    res.json({ success: true, ok: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, code: 'PAYMENTS_LIST_FAILED', message: 'Loi lay danh sach thanh toan: ' + err.message });
  }
});

// ====================== CASH LEDGER ======================
router.get('/cash-ledger', (req, res) => {
  try {
    const { limit = 50, offset = 0, referenceType } = req.query;
    const filter = (row) => {
      if (referenceType && row.reference_type !== referenceType) return false;
      return true;
    };
    const result = getPaginated('cash_ledger', filter, { limit: +limit, offset: +offset, sortBy: 'created_at', sortDir: 'desc' });
    res.json({ success: true, ok: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, code: 'CASH_LEDGER_LIST_FAILED', message: 'Loi lay so quy: ' + err.message });
  }
});

// ====================== INVENTORY BATCHES ======================
router.get('/inventory-batches', (req, res) => {
  try {
    const { limit = 50, offset = 0, productId } = req.query;
    const filter = (row) => {
      if (productId && Number(row.product_id) !== Number(productId)) return false;
      return true;
    };
    const result = getPaginated('inventory_batches', filter, { limit: +limit, offset: +offset, sortBy: 'imported_at', sortDir: 'desc' });
    res.json({ success: true, ok: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, ok: false, code: 'INVENTORY_BATCHES_LIST_FAILED', message: 'Loi lay lot nhap hang: ' + err.message });
  }
});

module.exports = router;
