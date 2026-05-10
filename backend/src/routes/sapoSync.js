const express = require('express');
const router = express.Router();
const sapoSyncService = require('../services/sapoSyncService');

function normalizeErrorList(err, fallbackMessage) {
  if (Array.isArray(err?.errors)) return err.errors;
  return [{ code: err?.code || 'SAPO_ERROR', message: err?.message || fallbackMessage }];
}

function sendError(res, err, fallbackMessage = 'Thao tác Sapo thất bại.') {
  const status = Number(err?.statusCode || err?.status || 500);
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  const message = err?.message || fallbackMessage;
  res.status(safeStatus).json({
    ok: false,
    resource: err?.resource || null,
    resources: err?.resources || [],
    summary: err?.summary || {},
    items: [],
    results: [],
    warnings: Array.isArray(err?.warnings) ? err.warnings : [],
    errors: normalizeErrorList(err, fallbackMessage),
    progress: err?.progress || {},
    error: message,
    message,
    code: err?.code || (safeStatus >= 500 ? 'SAPO_INTERNAL_ERROR' : 'SAPO_REQUEST_ERROR'),
    detail: err?.detail || (safeStatus >= 500 ? fallbackMessage : message),
  });
}

function sendResult(res, result) {
  res.json({
    ok: result?.ok !== false,
    warnings: [],
    errors: [],
    ...result,
  });
}

router.get('/settings', (req, res) => {
  try {
    res.json({ ok: true, resource: 'settings', resources: [], summary: {}, items: [], results: [], warnings: [], errors: [], progress: {}, settings: sapoSyncService.publicSettings() });
  } catch (err) {
    sendError(res, err, 'Không thể tải cấu hình Sapo.');
  }
});

router.put('/settings', (req, res) => {
  try {
    const settings = sapoSyncService.saveSettings(req.body || {}, req);
    res.json({ ok: true, resource: 'settings', resources: [], summary: {}, items: [], results: [], warnings: [], errors: [], progress: {}, settings, message: 'Đã lưu cấu hình Sapo.' });
  } catch (err) {
    sendError(res, err, 'Không thể lưu cấu hình Sapo.');
  }
});

router.post('/validate', async (req, res) => {
  try {
    const result = await sapoSyncService.validateConnection(req.body || {}, req);
    sendResult(res, result);
  } catch (err) {
    sendError(res, err, 'Không thể kiểm tra kết nối Sapo.');
  }
});

router.post('/analyze', async (req, res) => {
  try {
    const result = await sapoSyncService.analyzeSapoData(req.body || {}, req);
    sendResult(res, result);
  } catch (err) {
    sendError(res, err, 'Không thể phân tích dữ liệu Sapo.');
  }
});

router.post('/preview/products', async (req, res) => {
  try {
    const result = await sapoSyncService.previewProducts(req.body || {}, req);
    sendResult(res, result);
  } catch (err) {
    sendError(res, err, 'Không thể xem trước sản phẩm Sapo.');
  }
});

router.post('/preview/customers', async (req, res) => {
  try {
    const result = await sapoSyncService.previewCustomers(req.body || {}, req);
    sendResult(res, result);
  } catch (err) {
    sendError(res, err, 'Không thể xem trước khách hàng Sapo.');
  }
});

router.post('/preview/invoices', async (req, res) => {
  try {
    const result = await sapoSyncService.previewInvoices(req.body || {}, req);
    sendResult(res, result);
  } catch (err) {
    sendError(res, err, 'Không thể xem trước hóa đơn Sapo.');
  }
});

router.post('/sync/products', async (req, res) => {
  try {
    const result = await sapoSyncService.syncProducts(req.body || {}, req);
    sendResult(res, result);
  } catch (err) {
    sendError(res, err, 'Không thể đồng bộ sản phẩm Sapo.');
  }
});

router.post('/sync/customers', async (req, res) => {
  try {
    const result = await sapoSyncService.syncCustomers(req.body || {}, req);
    sendResult(res, result);
  } catch (err) {
    sendError(res, err, 'Không thể đồng bộ khách hàng Sapo.');
  }
});

router.post('/sync/invoices', async (req, res) => {
  try {
    const result = await sapoSyncService.syncInvoices(req.body || {}, req);
    sendResult(res, result);
  } catch (err) {
    sendError(res, err, 'Không thể đồng bộ hóa đơn Sapo.');
  }
});

router.post('/sync', async (req, res) => {
  try {
    const result = await sapoSyncService.syncSapoData(req.body || {}, req);
    sendResult(res, result);
  } catch (err) {
    sendError(res, err, 'Không thể đồng bộ dữ liệu Sapo.');
  }
});

router.post('/import/customers/preview', (req, res) => {
  try {
    const result = sapoSyncService.previewCustomerImportRows(req.body || {}, req);
    sendResult(res, result);
  } catch (err) {
    sendError(res, err, 'Không thể preview import khách hàng từ Excel.');
  }
});

router.post('/import/customers/commit', (req, res) => {
  try {
    const result = sapoSyncService.commitCustomerImportRows(req.body || {}, req);
    sendResult(res, result);
  } catch (err) {
    sendError(res, err, 'Không thể import khách hàng từ Excel.');
  }
});

router.post('/customers/import/preview', (req, res) => {
  try {
    const result = sapoSyncService.previewCustomerImportRows(req.body || {}, req);
    sendResult(res, result);
  } catch (err) {
    sendError(res, err, 'Không thể preview import khách hàng từ Excel.');
  }
});

router.post('/customers/import/commit', (req, res) => {
  try {
    const result = sapoSyncService.commitCustomerImportRows(req.body || {}, req);
    sendResult(res, result);
  } catch (err) {
    sendError(res, err, 'Không thể import khách hàng từ Excel.');
  }
});

router.get('/runs', (req, res) => {
  try {
    const runs = sapoSyncService.getRuns(req.query.limit);
    res.json({ ok: true, resource: 'runs', resources: [], summary: { total: runs.length }, items: runs, results: runs, runs, warnings: [], errors: [], progress: {} });
  } catch (err) {
    sendError(res, err, 'Không thể tải lịch sử đồng bộ Sapo.');
  }
});

router.get('/placeholders', (_req, res) => {
  res.json({
    ok: true,
    resource: 'placeholders',
    resources: ['products', 'customers', 'invoices'],
    summary: {},
    items: [],
    results: [],
    warnings: [],
    errors: [],
    progress: {},
    placeholders: {
      products: {
        status: 'available',
        message: 'Có thể phân tích và đồng bộ sản phẩm Sapo theo Sapo product ID, variant ID, SKU, barcode, tên/option để tránh trùng.',
      },
      customers: {
        status: 'available',
        message: 'Có thể phân tích và đồng bộ khách hàng Sapo theo sapo_customer_id, customer_code, phone hoặc email để tránh trùng.',
      },
      orders: {
        status: 'available',
        message: 'Có thể phân tích và đồng bộ hóa đơn Sapo theo sapo_order_id hoặc mã hóa đơn; mặc định giữ tồn kho offline khi import đơn từ Sapo.',
      },
      excel_customers: {
        status: 'available',
        message: 'Frontend parse Excel và gửi JSON rows; backend preview/commit với mode create_only, update_only hoặc upsert.',
      },
    },
  });
});

module.exports = router;
