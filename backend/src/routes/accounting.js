const express = require('express');
const router = express.Router();
const {
  getAll,
  getOne,
  insert,
  update,
  remove,
  now,
  withAtomicDbWrite,
  isCompletedInvoiceStatus,
} = require('../db/database');
const { requirePermission, requireAnyPermission, requireAuth } = require('../middleware/auth');
const accountingService = require('../services/accountingService');
const debtAgingService = require('../services/debtAgingService');
const geminiAccountingService = require('../services/geminiAccountingService');
const { logActivity } = require('../services/accountingLogService');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parsePage(value) {
  const page = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(page) && page > 0 ? page : DEFAULT_PAGE;
}

function parseLimit(value) {
  const limit = Number.parseInt(String(value || ''), 10);
  return Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT));
}

function normalizeDate(value, fallback) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function inRangeByDate(row, from, to, ...fields) {
  const value = fields.map(field => row?.[field]).find(Boolean) || row?.created_at || '';
  const date = String(value || '').slice(0, 10);
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function paginate(rows, query = {}) {
  const page = parsePage(query.page);
  const limit = parseLimit(query.limit);
  const total = rows.length;
  const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
  const offset = (page - 1) * limit;
  return {
    items: rows.slice(offset, offset + limit),
    pagination: {
      page,
      limit,
      total,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1 && total > 0,
    },
  };
}

function sortByDateDesc(rows, ...fields) {
  return rows.sort((a, b) => {
    const left = fields.map(field => a?.[field]).find(Boolean) || a?.created_at || '';
    const right = fields.map(field => b?.[field]).find(Boolean) || b?.created_at || '';
    return new Date(right || 0) - new Date(left || 0) || Number(b.id || 0) - Number(a.id || 0);
  });
}

function readFilter(query = {}) {
  return {
    from: normalizeDate(query.from, '1970-01-01'),
    to: normalizeDate(query.to, '2099-12-31'),
    status: String(query.status || '').trim(),
    search: String(query.search || query.q || '').trim().toLowerCase(),
  };
}

function applySearch(rows, search, fields = []) {
  if (!search) return rows;
  return rows.filter(row => fields.some(field => String(row?.[field] || '').toLowerCase().includes(search)));
}

function publicTableList(table, req, options = {}) {
  const filter = readFilter(req.query || {});
  let rows = getAll(table, row => {
    if (!row) return false;
    if (filter.status && filter.status !== 'all' && String(row.status || '') !== filter.status) return false;
    return inRangeByDate(row, filter.from, filter.to, ...(options.dateFields || ['date', 'created_at']));
  });
  rows = applySearch(rows, filter.search, options.searchFields || ['source_code', 'invoice_no', 'note', 'status']);
  sortByDateDesc(rows, ...(options.dateFields || ['date', 'created_at']));
  const paged = paginate(rows, req.query || {});
  return {
    ok: true,
    ...paged,
    filters: filter,
    generated_at: now(),
  };
}

router.get('/tax-report', requirePermission('tax_reports.read'), (req, res) => {
  try {
    const from = normalizeDate(req.query.from, '1970-01-01');
    const to = normalizeDate(req.query.to, '2099-12-31');
    res.json({ ok: true, ...accountingService.calculateTaxReport({ from, to }) });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi tính báo cáo thuế', detail: error.message });
  }
});

router.post('/tax-reports/generate', requirePermission('tax_reports.manage'), (req, res) => {
  try {
    const result = withAtomicDbWrite(() => {
      const from = normalizeDate(req.body?.from || req.query.from, '1970-01-01');
      const to = normalizeDate(req.body?.to || req.query.to, '2099-12-31');
      const report = accountingService.calculateTaxReport({ from, to });
      const existing = getOne('tax_reports', row => row.period_from === from && row.period_to === to && row.status !== 'deleted');
      const payload = {
        account_id: req.accountId,
        period_from: from,
        period_to: to,
        generated_at: now(),
        generated_by: req.user?.id || null,
        status: req.body?.status || 'generated',
        summary: {
          total_input_vat: report.total_input_vat,
          total_output_vat: report.total_output_vat,
          vat_payable: report.vat_payable,
          input_taxable_amount: report.input_taxable_amount,
          output_taxable_amount: report.output_taxable_amount,
          input_count: report.input_sources.length,
          output_count: report.output_sources.length,
        },
        detail_rows: {
          input_sources: report.input_sources,
          output_sources: report.output_sources,
        },
        source_hash: `tax:${from}:${to}:${report.total_input_vat}:${report.total_output_vat}:${report.input_sources.length}:${report.output_sources.length}`,
        updated_at: now(),
      };
      let row;
      if (existing) row = update('tax_reports', existing.id, payload, { skipSave: true, accountId: req.accountId });
      else {
        const id = insert('tax_reports', { ...payload, created_at: now() }, { skipSave: true, accountId: req.accountId });
        row = getOne('tax_reports', item => Number(item.id) === Number(id));
      }
      logActivity(req, 'tax_report.generate', { type: 'tax_report', id: row.id, code: `${from}_${to}` }, null, row, `Tạo snapshot báo cáo thuế ${from} - ${to}`, { skipSave: true, accountId: req.accountId });
      return row;
    });
    res.json({ ok: true, report: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi tạo snapshot báo cáo thuế', detail: error.message });
  }
});

router.get('/tax-reports', requirePermission('tax_reports.read'), (req, res) => {
  try {
    res.json(publicTableList('tax_reports', req, { dateFields: ['period_to', 'generated_at'], searchFields: ['period_from', 'period_to', 'status'] }));
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi lấy danh sách báo cáo thuế', detail: error.message });
  }
});

router.get('/tax-reports/:id', requirePermission('tax_reports.read'), (req, res) => {
  const row = getOne('tax_reports', item => Number(item.id) === Number(req.params.id));
  if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy báo cáo thuế' });
  return res.json({ ok: true, report: row });
});

router.get('/summary/revenue-profit', requireAnyPermission(['revenue_reports.read', 'profit_reports.read', 'accounting.read']), (req, res) => {
  try {
    const from = normalizeDate(req.query.from, '1970-01-01');
    const to = normalizeDate(req.query.to, '2099-12-31');
    const invoices = getAll('invoices', invoice => {
      const date = String(invoice.created_at || invoice.updated_at || '').slice(0, 10);
      return date >= from && date <= to && isCompletedInvoiceStatus(invoice.status);
    });
    const details = getAll('invoice_details');
    let revenue = 0;
    let vat = 0;
    let cost = 0;
    for (const invoice of invoices) {
      revenue += accountingService.calculateInvoiceRevenue(invoice);
      vat += toNumber(invoice.vat_amount);
      cost += accountingService.calculateInvoiceCost(details.filter(detail => Number(detail.invoice_id) === Number(invoice.id)));
    }
    const canSeeProfit = req.user?.role === 'admin'
      || (Array.isArray(req.permissions) && (
        req.permissions.includes('profit_reports.read')
        || req.permissions.includes('accounting.read')
        || req.permissions.includes('accounting.manage')
      ));
    const summary = {
      invoice_count: invoices.length,
      total_revenue: Math.round(revenue),
    };
    if (canSeeProfit) {
      summary.total_vat = Math.round(vat);
      summary.total_cost = Math.round(cost);
      summary.total_profit = Math.round(revenue - cost);
    }
    res.json({
      ok: true,
      period: { from, to },
      summary,
      generated_at: now(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi tính tổng hợp doanh thu/lợi nhuận', detail: error.message });
  }
});

router.get('/cash-fund', requireAnyPermission(['accounting.read', 'cashbook.read']), (req, res) => {
  try {
    const payload = publicTableList('cash_fund', req, { dateFields: ['date', 'created_at'], searchFields: ['category', 'note', 'source_type', 'source_id', 'payment_method'] });
    const activeRows = getAll('cash_fund', row => row.active !== 0);
    payload.summary = {
      total_income: activeRows.filter(row => row.type === 'income').reduce((sum, row) => sum + toNumber(row.amount), 0),
      total_expense: activeRows.filter(row => row.type === 'expense').reduce((sum, row) => sum + toNumber(row.amount), 0),
    };
    payload.summary.balance = payload.summary.total_income - payload.summary.total_expense;
    res.json(payload);
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi lấy sổ quỹ kế toán', detail: error.message });
  }
});

router.get('/debts/customers', requirePermission('debts.read'), (req, res) => {
  try {
    res.json(publicTableList('customer_debts', req, { dateFields: ['debt_date', 'created_at'], searchFields: ['source_code', 'status', 'note'] }));
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi lấy công nợ khách hàng', detail: error.message });
  }
});

router.get('/debts/suppliers', requirePermission('debts.read'), (req, res) => {
  try {
    res.json(publicTableList('supplier_debts', req, { dateFields: ['debt_date', 'created_at'], searchFields: ['source_code', 'status', 'note'] }));
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi lấy công nợ nhà cung cấp', detail: error.message });
  }
});

// ============================================================
//  BÁO CÁO TUỔI NỢ (DEBT AGING) & CHẬM THANH TOÁN
// ============================================================

/**
 * GET /api/accounting/debts/aging
 * Phân tích tuổi nợ và khách hàng chậm thanh toán
 * Hỗ trợ bộ lọc period_type, year, month, quarter, from, to, status, aging_bucket, search, customer_id, page, limit
 */
router.get('/debts/aging', requireAnyPermission(['debts.read', 'accounting.read', 'accounting.manage']), (req, res) => {
  try {
    const report = debtAgingService.getDebtAgingAnalysis(req.query);
    res.json(report);
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi phân tích tuổi nợ và chậm thanh toán', detail: error.message });
  }
});

/**
 * GET /api/accounting/debts/aging/summary
 * Lấy nhanh các thẻ KPI tổng thể và phân bổ % tuổi nợ cho biểu đồ
 */
router.get('/debts/aging/summary', requireAnyPermission(['debts.read', 'accounting.read', 'accounting.manage']), (req, res) => {
  try {
    const report = debtAgingService.getDebtAgingAnalysis(req.query);
    res.json({
      ok: true,
      as_of_date: report.as_of_date,
      filter_period: report.filter_period,
      kpi_summary: report.kpi_summary,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi lấy tổng quan KPI công nợ', detail: error.message });
  }
});

/**
 * GET /api/accounting/debts/aging/ai-context
 * Trích xuất dữ liệu cô đọng và văn bản phân tích sẵn sàng cấp cho Gemini AI
 */
router.get('/debts/aging/ai-context', requireAnyPermission(['debts.read', 'accounting.read', 'accounting.manage']), (req, res) => {
  try {
    const report = debtAgingService.getDebtAgingAnalysis(req.query);
    res.json({
      ok: true,
      ai_summary_context: report.ai_summary_context,
      kpi_summary: report.kpi_summary,
      filter_period: report.filter_period,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi tạo ngữ cảnh AI phân tích công nợ', detail: error.message });
  }
});

/**
 * GET /api/accounting/debts/aging/customer/:customerId
 * Sổ chi tiết công nợ của 1 khách hàng cụ thể
 */
router.get('/debts/aging/customer/:customerId', requireAnyPermission(['debts.read', 'accounting.read', 'accounting.manage']), (req, res) => {
  try {
    const customerId = Number(req.params.customerId);
    const report = debtAgingService.getSingleCustomerDebtReport(customerId, req.query);
    res.json(report);
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi lấy chi tiết công nợ khách hàng', detail: error.message });
  }
});

/**
 * GET /api/accounting/debts/aging/export-excel
 * Xuất file Excel báo cáo tuổi nợ và khách chậm thanh toán chuẩn kế toán
 */
router.get('/debts/aging/export-excel', requireAnyPermission(['debts.read', 'accounting.read', 'accounting.manage']), (req, res) => {
  try {
    const { fromDate, toDate } = debtAgingService.resolveDateRange(req.query);
    const fileName = `Bao_cao_cong_no_tuoi_no_${fromDate}_den_${toDate}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const stream = debtAgingService.exportDebtAgingExcel(req.query);
    stream.pipe(res);
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi xuất file Excel báo cáo công nợ', detail: error.message });
  }
});

/**
 * POST /api/accounting/debts/aging/telegram-report
 * Gửi báo cáo tuổi nợ và cảnh báo nợ xấu về nhóm Telegram
 */
router.post('/debts/aging/telegram-report', requireAnyPermission(['debts.read', 'accounting.read', 'accounting.manage']), async (req, res) => {
  try {
    const { sendDebtAgingTelegramReport } = require('../services/debtTelegramAlertService');
    const queryOptions = { ...(req.query || {}), ...(req.body || {}) };
    const requester = req.user?.name || req.user?.username || 'Admin';
    const result = await sendDebtAgingTelegramReport(queryOptions, requester);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi gửi báo cáo công nợ về Telegram', detail: error.message });
  }
});

// ============================================================
//  TÍCH HỢP GOOGLE GEMINI AI - KẾ TOÁN & CÔNG NỢ (GIAI ĐOẠN 2)
// ============================================================

/**
 * GET /api/accounting/ai/config
 * Lấy cấu hình Gemini API (key đã được che để an toàn)
 */
router.get('/ai/config', requireAnyPermission(['accounting.manage', 'accounting.read', 'system.settings.read', 'settings.read', 'debts.read', 'invoices.read', 'dashboard.read', 'users.read']), (req, res) => {
  try {
    const config = geminiAccountingService.getGeminiConfig();
    res.json({ ok: true, config });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi lấy cấu hình Gemini AI', detail: error.message });
  }
});

/**
 * PUT /api/accounting/ai/config
 * Cập nhật cấu hình Gemini API Key và model
 */
router.put('/ai/config', requireAnyPermission(['accounting.manage', 'system.settings.manage', 'settings.manage', 'settings.read', 'accounting.read']), (req, res) => {
  try {
    const { apiKey, model, temperature } = req.body || {};
    const result = geminiAccountingService.saveGeminiConfig({ apiKey, model, temperature });
    logActivity(req, 'gemini_ai.update_config', { type: 'system_setting', key: 'gemini_accounting_config' }, null, result.config, 'Cập nhật cấu hình Gemini AI Kế toán', { skipSave: true, accountId: req.accountId });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi lưu cấu hình Gemini AI', detail: error.message });
  }
});

/**
 * POST /api/accounting/ai/test-connection
 * Kiểm tra kết nối tới Google Gemini API
 */
router.post('/ai/test-connection', requireAnyPermission(['accounting.manage', 'accounting.read', 'system.settings.manage', 'settings.manage', 'settings.read', 'debts.read']), async (req, res) => {
  try {
    const { apiKey, model } = req.body || {};
    const result = await geminiAccountingService.testGeminiConnection(apiKey, model);
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: geminiAccountingService.formatGeminiErrorMessage(error) });
  }
});

/**
 * POST /api/accounting/ai/analyze
 * Phân tích chuyên sâu sức khỏe tài chính & cảnh báo khách hàng nợ xấu
 */
router.post('/ai/analyze', requireAnyPermission(['debts.read', 'debts.manage', 'accounting.read', 'accounting.manage']), async (req, res) => {
  try {
    const queryOptions = { ...(req.query || {}), ...(req.body || {}) };
    const analysis = await geminiAccountingService.analyzeDebtHealth(queryOptions);
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ ok: false, error: geminiAccountingService.formatGeminiErrorMessage(error) });
  }
});

/**
 * POST /api/accounting/ai/chat
 * Trợ lý Kế toán AI hỏi đáp thông minh dựa trên số liệu thực tế
 */
router.post('/ai/chat', requireAnyPermission(['debts.read', 'debts.manage', 'accounting.read', 'accounting.manage', 'invoices.read', 'orders.read', 'reports.read', 'products.read', 'settings.read', 'users.read', 'dashboard.read']), async (req, res) => {
  try {
    const { question, queryOptions, history, model, image } = req.body || {};
    if ((!question || !String(question).trim()) && !image) {
      return res.status(400).json({ ok: false, error: 'Vui lòng nhập nội dung câu hỏi hoặc dán hình ảnh cần phân tích' });
    }
    const result = await geminiAccountingService.askDebtAssistant({ question, queryOptions, history, model, image });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: geminiAccountingService.formatGeminiErrorMessage(error) });
  }
});

/**
 * POST /api/accounting/ai/reminder-message
 * Tự động tạo tin nhắn nhắc nợ thông minh & khéo léo cho khách hàng
 */
router.post('/ai/reminder-message', requireAnyPermission(['debts.read', 'debts.manage', 'accounting.read', 'accounting.manage']), async (req, res) => {
  try {
    const { customer_id, customerId, invoice_id, invoiceId, style, customNotes, model } = req.body || {};
    const targetCustomerId = customer_id || customerId;
    const targetInvoiceId = invoice_id || invoiceId;
    if (!targetCustomerId) {
      return res.status(400).json({ ok: false, error: 'Vui lòng cung cấp customer_id cần nhắc nợ' });
    }
    const result = await geminiAccountingService.generateDebtReminderMessage({
      customerId: targetCustomerId,
      invoiceId: targetInvoiceId,
      style: style || 'professional',
      customNotes: customNotes || '',
      model,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: geminiAccountingService.formatGeminiErrorMessage(error) });
  }
});

function eInvoiceRoutes(kind, table, permissionEntity) {
  router.get(`/${kind}`, requirePermission('einvoices.read'), (req, res) => {
    try {
      res.json(publicTableList(table, req, { dateFields: ['invoice_date', 'created_at'], searchFields: ['invoice_no', 'symbol', 'supplier_name', 'buyer_name', 'supplier_tax_code', 'buyer_tax_code', 'status'] }));
    } catch (error) {
      res.status(500).json({ ok: false, error: `Lỗi khi lấy ${permissionEntity}`, detail: error.message });
    }
  });

  router.post(`/${kind}`, requirePermission('einvoices.manage'), (req, res) => {
    try {
      const result = withAtomicDbWrite(() => {
        const payload = {
          ...(req.body || {}),
          account_id: req.accountId,
          status: req.body?.status || 'valid',
          created_at: now(),
          updated_at: now(),
        };
        const id = insert(table, payload, { skipSave: true, accountId: req.accountId });
        const row = getOne(table, item => Number(item.id) === Number(id));
        logActivity(req, `${table}.create`, { type: table, id, code: row.invoice_no }, null, row, `Tạo ${permissionEntity} ${row.invoice_no || id}`, { skipSave: true, accountId: req.accountId });
        return row;
      });
      res.json({ ok: true, item: result });
    } catch (error) {
      res.status(500).json({ ok: false, error: `Lỗi khi tạo ${permissionEntity}`, detail: error.message });
    }
  });

  router.put(`/${kind}/:id`, requirePermission('einvoices.manage'), (req, res) => {
    try {
      const result = withAtomicDbWrite(() => {
        const before = getOne(table, item => Number(item.id) === Number(req.params.id));
        if (!before) return null;
        const row = update(table, before.id, { ...(req.body || {}), updated_at: now() }, { skipSave: true, accountId: req.accountId });
        logActivity(req, `${table}.update`, { type: table, id: row.id, code: row.invoice_no }, before, row, `Cập nhật ${permissionEntity} ${row.invoice_no || row.id}`, { skipSave: true, accountId: req.accountId });
        return row;
      });
      if (!result) return res.status(404).json({ ok: false, error: `Không tìm thấy ${permissionEntity}` });
      res.json({ ok: true, item: result });
    } catch (error) {
      res.status(500).json({ ok: false, error: `Lỗi khi cập nhật ${permissionEntity}`, detail: error.message });
    }
  });

  router.delete(`/${kind}/:id`, requirePermission('einvoices.manage'), (req, res) => {
    try {
      const result = withAtomicDbWrite(() => {
        const before = getOne(table, item => Number(item.id) === Number(req.params.id));
        if (!before) return null;
        const removed = remove(table, before.id, { skipSave: true, accountId: req.accountId });
        logActivity(req, `${table}.delete`, { type: table, id: before.id, code: before.invoice_no }, before, null, `Xóa ${permissionEntity} ${before.invoice_no || before.id}`, { skipSave: true, accountId: req.accountId });
        return removed;
      });
      if (!result) return res.status(404).json({ ok: false, error: `Không tìm thấy ${permissionEntity}` });
      res.json({ ok: true, deleted: true, item: result });
    } catch (error) {
      res.status(500).json({ ok: false, error: `Lỗi khi xóa ${permissionEntity}`, detail: error.message });
    }
  });
}

eInvoiceRoutes('einvoice-in', 'einvoice_in', 'hóa đơn điện tử đầu vào');
eInvoiceRoutes('einvoice-out', 'einvoice_out', 'hóa đơn điện tử đầu ra');

router.get('/bank-accounts', requirePermission('bank_accounts.read'), (req, res) => {
  try {
    res.json(publicTableList('bank_accounts', req, { dateFields: ['created_at'], searchFields: ['bank_name', 'bank_account_number', 'account_holder', 'status'] }));
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi lấy tài khoản ngân hàng', detail: error.message });
  }
});

router.post('/bank-accounts', requirePermission('bank_accounts.manage'), (req, res) => {
  try {
    const row = withAtomicDbWrite(() => {
      const id = insert('bank_accounts', {
        account_id: req.accountId,
        bank_name: req.body?.bank_name || '',
        bank_account_number: req.body?.bank_account_number || req.body?.account_number || '',
        account_holder: req.body?.account_holder || req.body?.holder || '',
        branch: req.body?.branch || '',
        note: req.body?.note || '',
        active: req.body?.active === 0 ? 0 : 1,
        created_at: now(),
        updated_at: now(),
      }, { skipSave: true, accountId: req.accountId });
      const created = getOne('bank_accounts', item => Number(item.id) === Number(id));
      logActivity(req, 'bank_account.create', { type: 'bank_account', id, code: created.bank_account_number }, null, created, `Tạo tài khoản ngân hàng ${created.bank_account_number || id}`, { skipSave: true, accountId: req.accountId });
      return created;
    });
    res.json({ ok: true, item: row });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi tạo tài khoản ngân hàng', detail: error.message });
  }
});

router.get('/logs', requirePermission('activity_logs.read'), (req, res) => {
  try {
    const filter = readFilter(req.query || {});
    let rows = getAll('accounting_logs', row => {
      if (!row) return false;
      if (filter.from && String(row.created_at || '').slice(0, 10) < filter.from) return false;
      if (filter.to && String(row.created_at || '').slice(0, 10) > filter.to) return false;
      if (req.query.action && String(row.action || '') !== String(req.query.action)) return false;
      if (req.query.entity_type && String(row.entity_type || '') !== String(req.query.entity_type)) return false;
      if (req.query.user_id && Number(row.user_id) !== Number(req.query.user_id)) return false;
      return true;
    });
    rows = applySearch(rows, filter.search, ['action', 'entity_type', 'entity_code', 'content', 'user_name']);
    sortByDateDesc(rows, 'created_at');
    const paged = paginate(rows, req.query || {});
    res.json({ ok: true, ...paged, filters: filter, generated_at: now() });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Lỗi khi lấy nhật ký hoạt động', detail: error.message });
  }
});

router.get('/logs/:id', requirePermission('activity_logs.read'), (req, res) => {
  const row = getOne('accounting_logs', item => Number(item.id) === Number(req.params.id));
  if (!row) return res.status(404).json({ ok: false, error: 'Không tìm thấy nhật ký hoạt động' });
  return res.json({ ok: true, log: row });
});

module.exports = router;

