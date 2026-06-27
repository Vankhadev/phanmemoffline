/**
 * Invoices API routes
 * CRUD cho đơn hàng: tạo, sửa, xóa, xem
 * Status: pending → confirmed → completed | cancelled
 */
const express = require('express');
const router = express.Router();
const {
  getAll,
  getOne,
  insert,
  update,
  remove,
  now,
  normalizePaymentMethod,
  getActiveAccountId,
  withAtomicDbWrite,
  isCancelledInvoiceStatus,
  isInvoiceVisibleInActiveList,
  deleteExpiredCancelledInvoices,
} = require('../db/database');
const { resolveInvoiceDetailDisplayFields } = require('../utils/productDisplayName');
const {
  createInvoiceFromPayload,
  syncInvoiceAccounting,
  deductStock: deductInvoiceStock,
  restoreStock: restoreInvoiceStock,
  normalizeInvoiceDetail: normalizeInvoiceDetailService,
  prepareInvoiceDetailsForPersistence,
} = require('../services/invoiceCreationService');
const {
  getInvoiceDetailProductId,
  validateNegativeStockForDetails,
  logNegativeStockLimitViolation,
  buildNegativeStockErrorResponse,
} = require('../utils/negativeStock');
const { resolveInvoicePrintTemplate } = require('../services/printTemplateService');
const { logActivity } = require('../services/accountingLogService');
const { exportCustomerDebtReport } = require('../services/customerDebtReportService');

// ─────────────────────────────────────────────
// Helper: hợp nhất chi tiết trùng product_id (chống duplicate)
// ─────────────────────────────────────────────
function isComboDetail(detail = {}) {
  return detail.type === 'combo' || detail.item_type === 'combo' || !!detail.combo_id;
}

function collectProductQuantities(details = []) {
  const map = new Map();
  for (const detail of details || []) {
    const productId = Number(getInvoiceDetailProductId(detail));
    if (!Number.isFinite(productId) || productId <= 0) continue;
    const quantity = Math.max(0, Number(detail.quantity) || 0);
    if (quantity <= 0) continue;
    map.set(productId, (map.get(productId) || 0) + quantity);
  }
  return map;
}

function validateStockForInvoiceEditDetails(newDetails = [], oldDetails = []) {
  try {
    return validateNegativeStockForDetails(newDetails, {
      restoredByProductId: collectProductQuantities(oldDetails),
    });
  } catch (error) {
    logNegativeStockLimitViolation(error, { source: 'invoice_edit', operation: 'validate_invoice_edit_details' }, { skipSave: true });
    if (error?.status) throw error;
    const err = new Error(error?.message || 'Không thể kiểm tra tồn kho trước khi cập nhật đơn hàng');
    err.status = 400;
    throw err;
  }
}

function buildDetailKey(detail = {}, index = 0) {
  if (isComboDetail(detail)) return `combo:${detail.combo_id || detail.id || index}:${detail.unit_price || 0}`;
  return `product:${detail.product_id || detail.id || index}:${detail.unit_price || 0}`;
}

function normalizeInvoiceDetail(detail = {}, invoice_id) {
  return normalizeInvoiceDetailService(detail, invoice_id);
}

function cleanupExpiredCancelledInvoicesForList() {
  const result = deleteExpiredCancelledInvoices();
  if (result.deletedCount > 0) {
    console.log(`[KHA INVOICE CLEANUP] Đã xóa ${result.deletedCount} đơn hủy quá 24 giờ khi tải danh sách`);
  }
  return result;
}

function invoiceMatchesStatus(invoice = {}, status = '') {
  const normalizedStatus = String(status || '').trim();
  if (!normalizedStatus || normalizedStatus === 'all') return true;
  if (normalizedStatus === 'cancelled') return isCancelledInvoiceStatus(invoice.status);
  return invoice.status === normalizedStatus;
}

// ─────────────────────────────────────────────
// Helper: báo cáo đơn hàng theo khách hàng/khoảng ngày
// ─────────────────────────────────────────────
function parseLocalDateBoundary(value, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function parseInvoiceDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDetailName(detail = {}) {
  const displayFields = resolveInvoiceDetailDisplayFields(detail, id => getOne('products', product => Number(product.id) === Number(id)));
  return displayFields.product_name || detail.product_name || detail.name || detail.combo_name || detail.sku || detail.product_sku || 'Sản phẩm';
}

function buildItemsSummary(details = []) {
  if (!Array.isArray(details) || details.length === 0) return '';
  return details
    .map(detail => `${formatDetailName(detail)} x${Number(detail.quantity) || 0}`)
    .join('; ');
}

function toMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function derivePaymentStatus(invoice = {}) {
  if (isCancelledInvoiceStatus(invoice.status)) return 'cancelled';
  const total = toMoney(invoice.total);
  const paid = toMoney(invoice.paid_amount);
  if (total <= 0) return paid > 0 ? 'paid' : 'unpaid';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function parseObjectMaybe(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function normalizeLookupText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeInvoiceCodeLookup(value) {
  const compact = normalizeLookupText(value).replace(/[\s_-]+/g, '');
  if (/^dh\d+$/i.test(compact)) return `hd${compact.slice(2)}`;
  return compact;
}

function normalizeImageValue(value) {
  const text = firstNonEmpty(value);
  if (!text) return '';
  if (/^(data:image\/|https?:\/\/|blob:|file:)/i.test(text)) return text;
  if (/^[a-z0-9+/=\r\n]+$/i.test(text) && text.length > 80) return `data:image/png;base64,${text.replace(/\s+/g, '')}`;
  return text;
}

function buildStorePrintInfo(store = {}) {
  return {
    id: store.id || null,
    name: firstNonEmpty(store.name, store.store_name, store.company_name, 'Cửa hàng'),
    company_name: firstNonEmpty(store.company_name, store.name),
    address: firstNonEmpty(store.address, store.store_address),
    phone: firstNonEmpty(store.phone, store.hotline, store.tel),
    email: firstNonEmpty(store.email),
    tax_code: firstNonEmpty(store.tax_code, store.mst),
    logo_url: normalizeImageValue(firstNonEmpty(store.logo_url, store.logo, store.logo_base64, store.logo_data_url)),
    bank_name: firstNonEmpty(store.bank_name, store.bank, store.bank_branch),
    bank_account: firstNonEmpty(store.bank_account, store.account_number, store.bank_account_number),
    bank_account_name: firstNonEmpty(store.bank_account_name, store.account_name, store.name),
    payment_qr_url: normalizeImageValue(firstNonEmpty(store.payment_qr_url, store.payment_qr, store.qr_code, store.qr_image, store.bank_qr_url)),
  };
}

function buildCustomerPrintInfo(invoice = {}, customer = {}) {
  return {
    id: customer?.id || invoice.customer_id || null,
    name: firstNonEmpty(customer?.name, invoice.customer_name, 'Khách lẻ'),
    phone: firstNonEmpty(customer?.phone, invoice.customer_phone),
    email: firstNonEmpty(customer?.email, invoice.customer_email),
    address: firstNonEmpty(customer?.address, invoice.customer_address),
    tax_code: firstNonEmpty(customer?.tax_code, invoice.customer_tax_code),
    customer_type: firstNonEmpty(customer?.customer_type),
  };
}

function buildPaymentPrintInfo(invoice = {}, store = {}) {
  const method = normalizePaymentMethod(invoice.payment_method || 'cash') || 'cash';
  const labels = { cash: 'Tiền mặt', bank: 'Chuyển khoản', debt: 'Công nợ' };
  const bankName = firstNonEmpty(invoice.bank_name, invoice.payment_bank_name, store.bank_name);
  const bankAccount = firstNonEmpty(invoice.bank_account, invoice.payment_bank_account, store.bank_account);
  const accountName = firstNonEmpty(invoice.bank_account_name, invoice.payment_account_name, store.bank_account_name, store.name);
  const qrText = firstNonEmpty(
    invoice.payment_qr_text,
    invoice.qr_text,
    bankAccount ? `${bankName ? `${bankName} - ` : ''}${bankAccount}${accountName ? ` - ${accountName}` : ''}` : ''
  );

  return {
    method,
    method_label: labels[method] || method || 'Tiền mặt',
    paid_amount: toMoney(invoice.paid_amount),
    change_amount: toMoney(invoice.change_amount),
    remaining_amount: toMoney(invoice.remaining_amount),
    bank_name: bankName,
    bank_account: bankAccount,
    bank_account_name: accountName,
    qr_image: normalizeImageValue(firstNonEmpty(invoice.payment_qr_url, invoice.payment_qr, invoice.qr_code, invoice.qr_image, store.payment_qr_url)),
    qr_text: qrText,
    transfer_content: firstNonEmpty(invoice.transfer_content, invoice.invoice_code ? `Thanh toan ${invoice.invoice_code}` : ''),
  };
}

function buildPrintItem(detail = {}, index = 0, productsById = new Map()) {
  const displayFields = resolveInvoiceDetailDisplayFields(detail, id => productsById.get(Number(id)) || null);
  const quantity = toMoney(detail.quantity) || 0;
  const unitPrice = toMoney(detail.unit_price);
  const discountAmount = toMoney(detail.discount_amount);
  const lineTotal = Number.isFinite(Number(detail.line_total))
    ? toMoney(detail.line_total)
    : Math.max(0, quantity * unitPrice - discountAmount);

  return {
    id: detail.id || null,
    no: index + 1,
    type: detail.type || detail.item_type || (detail.combo_id ? 'combo' : 'product'),
    product_id: detail.product_id || null,
    variant_id: detail.variant_id || null,
    combo_id: detail.combo_id || null,
    sku: firstNonEmpty(detail.product_sku, detail.sku, displayFields.product_sku),
    name: firstNonEmpty(displayFields.product_name, detail.product_name, detail.name, detail.combo_name, detail.sku, detail.product_sku, 'Sản phẩm'),
    unit: firstNonEmpty(detail.unit, detail.product_unit, detail.unit_name),
    quantity,
    unit_price: unitPrice,
    discount_percent: toMoney(detail.discount_percent),
    discount_amount: discountAmount,
    line_total: lineTotal,
    note: firstNonEmpty(detail.note),
  };
}

function parsePrintTemplateQueryId(query = {}) {
  const raw = query.template_id ?? query.templateId ?? query.print_template_id ?? query.printTemplateId;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function resolvePrintTemplateAccountId(req, payload = {}) {
  const candidates = [
    req?.accountId,
    req?.account?.id,
    req?.user?.account_id,
    payload?.metadata?.account_id,
    getActiveAccountId(),
  ];
  for (const candidate of candidates) {
    const id = Number(candidate);
    if (Number.isInteger(id) && id > 0) return id;
  }
  return 1;
}

async function attachPrintTemplateToPayload(payload, req) {
  if (!payload) return payload;
  try {
    const template = await resolveInvoicePrintTemplate({
      accountId: resolvePrintTemplateAccountId(req, payload),
      templateId: parsePrintTemplateQueryId(req?.query || {}),
    });
    return {
      ...payload,
      template: template || null,
      metadata: {
        ...payload.metadata,
        print_template: template ? {
          id: template.id,
          code: template.code,
          schema_version: template.schema_version || template.template_schema_version || 1,
          revision: template.revision || null,
          published_at: template.published_at || null,
          source: 'mysql',
        } : null,
      },
    };
  } catch (error) {
    console.warn(`[KHA INVOICE PRINT] Không thể tải mẫu in hóa đơn từ MySQL, tiếp tục dùng layout in hiện tại: ${error.message}`);
    return {
      ...payload,
      template: null,
      metadata: {
        ...payload.metadata,
        print_template_error: {
          code: error.code || 'PRINT_TEMPLATE_UNAVAILABLE',
          message: 'Không thể tải mẫu in hóa đơn từ MySQL; backend đã dùng luồng in hiện tại.',
        },
      },
    };
  }
}

function findInvoiceForPrint(idOrCode) {
  const raw = String(idOrCode || '').trim();
  const numericId = Number(raw);
  const lookup = normalizeLookupText(raw);
  const codeLookup = normalizeInvoiceCodeLookup(raw);

  return getAll('invoices').find(invoice => {
    if (!invoice) return false;
    if (Number.isFinite(numericId) && Number(invoice.id) === numericId) return true;
    if (normalizeLookupText(invoice.invoice_code) === lookup) return true;
    if (normalizeInvoiceCodeLookup(invoice.invoice_code) === codeLookup) return true;
    if (invoice.client_order_id && normalizeLookupText(invoice.client_order_id) === lookup) return true;
    return false;
  }) || null;
}

function buildInvoicePrintPayload(idOrCode) {
  const invoice = findInvoiceForPrint(idOrCode);
  if (!invoice) return null;

  const productsById = new Map(getAll('products').map(product => [Number(product.id), product]));
  const details = getAll('invoice_details', detail => Number(detail.invoice_id) === Number(invoice.id))
    .map((detail, index) => buildPrintItem(detail, index, productsById));
  const customer = getOne('customers', c => Number(c.id) === Number(invoice.customer_id));
  const user = getOne('users', u => Number(u.id) === Number(invoice.user_id));
  const currentStore = getAll('store_info')[0] || {};
  const storeSnapshot = parseObjectMaybe(invoice.store_info_snapshot);
  const store = buildStorePrintInfo({ ...currentStore, ...storeSnapshot });
  const customerInfo = buildCustomerPrintInfo(invoice, customer || {});
  const subtotal = Number.isFinite(Number(invoice.subtotal))
    ? toMoney(invoice.subtotal)
    : details.reduce((sum, item) => sum + item.line_total, 0);
  const totals = {
    subtotal,
    vat_percent: toMoney(invoice.vat_percent),
    vat_amount: toMoney(invoice.vat_amount),
    discount_percent: toMoney(invoice.discount_percent),
    discount_amount: toMoney(invoice.discount_amount),
    delivery_fee: toMoney(invoice.delivery_fee),
    total: Number.isFinite(Number(invoice.total)) ? toMoney(invoice.total) : subtotal,
    paid_amount: toMoney(invoice.paid_amount),
    change_amount: toMoney(invoice.change_amount),
    remaining_amount: toMoney(invoice.remaining_amount),
  };
  const payment = buildPaymentPrintInfo(invoice, store);

  return {
    invoice: {
      id: invoice.id,
      invoice_code: invoice.invoice_code,
      client_order_id: invoice.client_order_id || '',
      created_at: invoice.created_at || null,
      updated_at: invoice.updated_at || null,
      delivery_date: invoice.delivery_date || null,
      status: invoice.status || 'pending',
      payment_method: invoice.payment_method || 'cash',
      note: invoice.note || '',
      source: invoice.source || invoice.order_source || invoice.sync_source || '',
    },
    store,
    customer: customerInfo,
    items: details,
    totals,
    payment,
    template: null,
    signatures: {
      seller: {
        label: 'Bên giao hàng',
        name: firstNonEmpty(invoice.invoice_writer, user?.name),
      },
      buyer: {
        label: 'Khách hàng / Người nhận',
        name: firstNonEmpty(invoice.receiver_name, customerInfo.name),
      },
    },
    metadata: {
      invoice_id: invoice.id,
      invoice_code: invoice.invoice_code,
      client_order_id: invoice.client_order_id || '',
      user_id: invoice.user_id || null,
      user_name: user?.name || '',
      account_id: invoice.account_id || null,
      idempotency_key: invoice.idempotency_key || '',
      payload_hash: invoice.payload_hash || '',
      sync_status: invoice.sync_status || '',
      synced_at: invoice.synced_at || null,
      sync_device_id: invoice.sync_device_id || null,
      store_info_snapshot: storeSnapshot,
      printed_at: now(),
    },
  };
}

// ─────────────────────────────────────────────
// GET /api/invoices/reports/customer-orders
// Báo cáo read-only theo khách hàng và khoảng ngày local
// ─────────────────────────────────────────────
router.get('/reports/customer-orders', (req, res) => {
  try {
    const { customer_id, from, to, status } = req.query;
    const customerId = Number(customer_id);

    if (!Number.isFinite(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'Thiếu hoặc sai customer_id' });
    }

    const fromDate = parseLocalDateBoundary(from, false);
    const toDate = parseLocalDateBoundary(to, true);
    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'Khoảng ngày không hợp lệ. Vui lòng dùng định dạng YYYY-MM-DD.' });
    }
    if (fromDate > toDate) {
      return res.status(400).json({ error: 'Ngày bắt đầu không được lớn hơn ngày kết thúc' });
    }

    const customer = getOne('customers', c => Number(c.id) === customerId && c.active !== 0);
    if (!customer) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });

    cleanupExpiredCancelledInvoicesForList();
    const allDetails = getAll('invoice_details');
    const invoices = getAll('invoices')
      .filter(inv => isInvoiceVisibleInActiveList(inv))
      .filter(inv => Number(inv.customer_id) === customerId)
      .filter(inv => {
        if (status && status !== 'all') return invoiceMatchesStatus(inv, status);
        return !isCancelledInvoiceStatus(inv.status);
      })
      .filter(inv => {
        const createdAt = parseInvoiceDate(inv.created_at);
        return createdAt && createdAt >= fromDate && createdAt <= toDate;
      })
      .sort((a, b) => parseInvoiceDate(a.created_at) - parseInvoiceDate(b.created_at))
      .map(inv => {
        const details = allDetails
          .filter(detail => Number(detail.invoice_id) === Number(inv.id))
          .map(detail => ({
            id: detail.id,
            type: detail.type || detail.item_type || (detail.combo_id ? 'combo' : 'product'),
            product_id: detail.product_id || null,
            combo_id: detail.combo_id || null,
            product_name: formatDetailName(detail),
            product_sku: detail.product_sku || detail.sku || '',
            quantity: Number(detail.quantity) || 0,
            unit_price: Number(detail.unit_price) || 0,
            line_total: Number(detail.line_total) || 0,
          }));

        return {
          id: inv.id,
          invoice_code: inv.invoice_code,
          created_at: inv.created_at,
          customer_id: inv.customer_id,
          customer_name: customer.name || '',
          items_summary: buildItemsSummary(details),
          details,
          subtotal: Number(inv.subtotal) || 0,
          vat_amount: Number(inv.vat_amount) || 0,
          discount_amount: Number(inv.discount_amount) || 0,
          total: Number(inv.total) || 0,
          paid_amount: Number(inv.paid_amount) || 0,
          change_amount: Number(inv.change_amount) || 0,
          remaining_amount: Number(inv.remaining_amount) || 0,
          payment_status: derivePaymentStatus(inv),
          delivery_fee: Number(inv.delivery_fee) || 0,
          status: inv.status || '',
          cancelled_at: inv.cancelled_at || null,
          payment_method: inv.payment_method || '',
          note: inv.note || '',
        };
      });

    const totalAmount = invoices.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);

    res.json({
      filters: {
        customer_id: customerId,
        from,
        to,
        status: status || 'exclude_cancelled',
        from_local: fromDate.toLocaleString('sv-SE'),
        to_local: toDate.toLocaleString('sv-SE'),
      },
      customer: {
        id: customer.id,
        name: customer.name || '',
        phone: customer.phone || '',
        email: customer.email || '',
        customer_type: customer.customer_type || '',
      },
      invoices,
      summary: {
        total_invoices: invoices.length,
        total_amount: totalAmount,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lập báo cáo đơn hàng theo khách hàng: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/invoices/reports/customer-orders/export
// Xuất báo cáo đơn hàng Excel dạng stream
// ─────────────────────────────────────────────
router.get('/reports/customer-orders/export', async (req, res) => {
  try {
    const { customer_id, from, to } = req.query;
    const customerId = Number(customer_id);

    if (!Number.isFinite(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'Thiếu hoặc sai customer_id' });
    }

    const fromDate = parseLocalDateBoundary(from, false);
    const toDate = parseLocalDateBoundary(to, true);
    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'Khoảng ngày không hợp lệ. Vui lòng dùng định dạng YYYY-MM-DD.' });
    }
    if (fromDate > toDate) {
      return res.status(400).json({ error: 'Ngày bắt đầu không được lớn hơn ngày kết thúc' });
    }

    const customer = getOne('customers', c => Number(c.id) === customerId && c.active !== 0);
    if (!customer) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });

    const customerName = customer.name || 'KhachHang';
    const nowTime = new Date();
    const yyyymmdd = nowTime.getFullYear() + String(nowTime.getMonth() + 1).padStart(2, '0') + String(nowTime.getDate()).padStart(2, '0');
    const safeCustomerName = customerName.replace(/[/\\?%*:|"<>. ]/g, '_');
    const fileName = `BaoCaoCongNo_${safeCustomerName}_${yyyymmdd}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);

    const excelStream = exportCustomerDebtReport(customerId, from, to);
    excelStream.on('error', (err) => {
      console.error('Lỗi khi stream Excel:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Lỗi ghi file Excel: ' + err.message });
      }
    });
    excelStream.pipe(res);
  } catch (err) {
    console.error('Lỗi xuất báo cáo Excel:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Lỗi xuất báo cáo Excel: ' + err.message });
    }
  }
});

// ─────────────────────────────────────────────
// GET /api/invoices
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, delivery, from, to } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 1000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const includeMeta = String(req.query.meta || '').trim() === '1';
    cleanupExpiredCancelledInvoicesForList();
    let rows = await Promise.resolve(getAll('invoices')
      .filter(inv => isInvoiceVisibleInActiveList(inv))
      .map(inv => ({
        ...inv,
        customer_name: getOne('customers', c => Number(c.id) === Number(inv.customer_id))?.name || '',
        user_name: getOne('users', u => Number(u.id) === Number(inv.user_id))?.name || '',
        total: Number(inv.total) || 0,
        subtotal: Number(inv.subtotal) || 0,
        paid_amount: Number(inv.paid_amount) || 0,
        remaining_amount: Number(inv.remaining_amount) || 0,
        payment_status: derivePaymentStatus(inv),
        status: inv.status || 'pending',
        cancelled_at: inv.cancelled_at || null,
        payment_method: inv.payment_method || 'cash',
        source: inv.source || inv.order_source || 'web',
      })));
    if (status && status !== 'all') rows = rows.filter(r => invoiceMatchesStatus(r, status));
    if (delivery === 'pending') rows = rows.filter(r => !r.delivery_date);
    if (delivery === 'done') rows = rows.filter(r => !!r.delivery_date);
    if (from) rows = rows.filter(r => r.created_at && r.created_at >= from);
    if (to) rows = rows.filter(r => r.created_at && r.created_at.slice(0, 10) <= to);
    rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const total = rows.length;
    const pagedRows = limit > 0 ? rows.slice(offset, offset + limit) : rows;
    if (includeMeta) return res.json({ ok: true, items: pagedRows, total, limit: limit || total, offset });
    res.json(pagedRows);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Lỗi khi lấy danh sách: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/invoices/:idOrCode/print
// Dữ liệu in hóa đơn A5 lấy từ DB hiện có, không dùng dữ liệu mẫu.
// ─────────────────────────────────────────────
router.get('/:idOrCode/print', async (req, res) => {
  try {
    const payload = await Promise.resolve(buildInvoicePrintPayload(req.params.idOrCode));
    if (!payload) return res.status(404).json({ ok: false, error: 'Không tìm thấy hóa đơn để in' });
    const payloadWithTemplate = await attachPrintTemplateToPayload(payload, req);
    res.json({ ok: true, ...payloadWithTemplate });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Lỗi khi lấy dữ liệu in hóa đơn: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/invoices/:id
// ─────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    cleanupExpiredCancelledInvoicesForList();
    const inv = await Promise.resolve(getOne('invoices', i => Number(i.id) === Number(req.params.id)));
    if (!inv || !isInvoiceVisibleInActiveList(inv)) return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn hàng' });
    const details = getAll('invoice_details', d => Number(d.invoice_id) === Number(inv.id))
      .map(detail => ({
        ...detail,
        ...resolveInvoiceDetailDisplayFields(detail, id => getOne('products', product => Number(product.id) === Number(id))),
      }));
    const customer = getOne('customers', c => Number(c.id) === Number(inv.customer_id));
    res.json({ ok: true, ...inv, payment_status: derivePaymentStatus(inv), customer_name: customer?.name || '', details });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Lỗi: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/invoices → Tạo đơn hàng mới
// ─────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const result = await Promise.resolve(createInvoiceFromPayload(req.body, req, { orderSource: 'direct' }));

    res.json({
      ok: true,
      invoice_id: result.invoice_id,
      invoice_code: result.invoice_code,
      client_order_id: result.client_order_id || '',
      idempotent: result.idempotent === true,
      existing: result.idempotent === true,
      invoice: result.invoice || null,
    });
  } catch (err) {
    const status = err.status || 500;
    logNegativeStockLimitViolation(err, { source: 'invoice_create' });
    res.status(status).json(buildNegativeStockErrorResponse(err, 'Lỗi khi tạo đơn'));
  }
});

// ─────────────────────────────────────────────
// PUT /api/invoices/:id → Sửa đơn hàng (admin)
// ─────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const result = await Promise.resolve(withAtomicDbWrite(() => {
      const inv = getOne('invoices', i => Number(i.id) === Number(req.params.id));
      if (!inv) {
        const err = new Error('Không tìm thấy đơn hàng');
        err.status = 404;
        throw err;
      }
      if (isCancelledInvoiceStatus(inv.status)) {
        const err = new Error('Không thể sửa đơn đã hủy');
        err.status = 400;
        throw err;
      }

      const previousCreatedAt = inv.created_at;
      const {
        customer_id, payment_method, note,
        subtotal, vat_percent, vat_amount,
        discount_amount, discount_percent,
        total, delivery_date, status,
        paid_amount, change_amount, remaining_amount, delivery_fee,
        invoice_writer, receiver_name,
        details,
      } = req.body;


      update('invoices', inv.id, {
        ...(customer_id !== undefined && { customer_id: customer_id || null }),
        ...(payment_method && { payment_method: normalizePaymentMethod(payment_method) }),
        ...(note !== undefined && { note }),
        ...(subtotal !== undefined && { subtotal: +subtotal }),
        ...(vat_percent !== undefined && { vat_percent: +vat_percent }),
        ...(vat_amount !== undefined && { vat_amount }),
        ...(discount_amount !== undefined && { discount_amount }),
        ...(discount_percent !== undefined && { discount_percent }),
        ...(total !== undefined && { total: +total }),
        ...(paid_amount !== undefined && { paid_amount: Math.max(0, +paid_amount || 0) }),
        ...(change_amount !== undefined && { change_amount: Math.max(0, +change_amount || 0) }),
        ...(remaining_amount !== undefined && { remaining_amount: Math.max(0, +remaining_amount || 0) }),
        ...(delivery_fee !== undefined && { delivery_fee: +delivery_fee || 0 }),
        ...(delivery_date !== undefined && { delivery_date: delivery_date || null }),
        ...(invoice_writer !== undefined && { invoice_writer }),
        ...(receiver_name !== undefined && { receiver_name }),
        ...(status !== undefined && { status: status || 'pending' }),
        ...(req.body.created_at && { created_at: req.body.created_at }),
      }, { skipSave: true });

      if (details !== undefined) {
        const safeDetails = prepareInvoiceDetailsForPersistence(details, { allowUnlinkedOnMissingProduct: true });
        const oldDetails = getAll('invoice_details', d => Number(d.invoice_id) === Number(inv.id));
        validateStockForInvoiceEditDetails(safeDetails, oldDetails);
        for (const d of oldDetails) {
          const stockProductId = getInvoiceDetailProductId(d);
          if (stockProductId) restoreInvoiceStock(stockProductId, +d.quantity || 0, { skipSave: true });
        }
        for (const detail of oldDetails) {
          remove('invoice_details', detail.id, { skipSave: true });
        }
        for (const d of (safeDetails || [])) {
          const detailRow = normalizeInvoiceDetail(d, inv.id);
          insert('invoice_details', detailRow, { skipSave: true });
          const stockProductId = getInvoiceDetailProductId(detailRow);
          if (stockProductId) deductInvoiceStock(stockProductId, +detailRow.quantity || 1, { skipSave: true });
        }
      }

      const updatedInvoice = getOne('invoices', i => Number(i.id) === Number(inv.id));
      const updatedDetails = getAll('invoice_details', d => Number(d.invoice_id) === Number(inv.id))
        .map(detail => ({
          ...detail,
          ...resolveInvoiceDetailDisplayFields(detail, id => getOne('products', product => Number(product.id) === Number(id))),
        }));
      // Tính lại tổng tiền từ các dòng chi tiết THỰC TẾ đã lưu vào database (không tin tưởng
      // subtotal/total do client gửi) để đảm bảo tổng luôn khớp giá dòng. Giá dòng đã được
      // normalize với unit_price mới, nên subtotal/profit tính theo giá mới.
      const persistedSubtotal = updatedDetails.reduce((sum, d) => sum + (Number(d.line_total) || 0), 0);
      const persistedProfit = updatedDetails.reduce((sum, d) => sum + (Number(d.profit_at_sale) || 0), 0);
      const vatPct = Math.max(0, Number(updatedInvoice.vat_percent) || 0);
      const persistedVatAmount = persistedSubtotal * vatPct / 100;
      const persistedDiscountAmount = Number(updatedInvoice.discount_percent) > 0
        ? persistedSubtotal * Number(updatedInvoice.discount_percent) / 100
        : Math.max(0, Number(updatedInvoice.discount_amount) || 0);
      const persistedDeliveryFee = Math.max(0, Number(updatedInvoice.delivery_fee) || 0);
      const persistedTotal = Math.max(0, persistedSubtotal + persistedVatAmount - persistedDiscountAmount + persistedDeliveryFee);
      const persistedPaid = Math.max(0, Number(updatedInvoice.paid_amount) || 0);
      update('invoices', updatedInvoice.id, {
        subtotal: persistedSubtotal,
        vat_amount: persistedVatAmount,
        discount_amount: persistedDiscountAmount,
        total: persistedTotal,
        remaining_amount: Math.max(0, persistedTotal - persistedPaid),
        change_amount: Math.max(0, persistedPaid - persistedTotal),
        total_profit: persistedProfit,
      }, { skipSave: true });
      const recalculatedInvoice = getOne('invoices', i => Number(i.id) === Number(inv.id));
      syncInvoiceAccounting(recalculatedInvoice, { skipSave: true, previousCreatedAt, timestamp: now(), userId: req.user?.id || recalculatedInvoice.user_id || null });
      logActivity(req, 'invoice.update', {
        type: 'invoice',
        id: recalculatedInvoice.id,
        code: recalculatedInvoice.invoice_code,
      }, inv, recalculatedInvoice, `Cập nhật đơn hàng ${recalculatedInvoice.invoice_code || recalculatedInvoice.id}`, { skipSave: true, accountId: recalculatedInvoice.account_id || req.accountId });
      return { ok: true, invoice: recalculatedInvoice, details: updatedDetails };
    }));

    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    logNegativeStockLimitViolation(err, { source: 'invoice_update', invoice_id: req.params.id });
    res.status(status).json(buildNegativeStockErrorResponse(err, 'Lỗi khi sửa đơn'));
  }
});

// ─────────────────────────────────────────────
// DELETE /api/invoices/:id → Hủy đơn hàng (admin)
// ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const result = await Promise.resolve(withAtomicDbWrite(() => {
      const inv = getOne('invoices', i => Number(i.id) === Number(req.params.id));
      if (!inv) {
        const err = new Error('Không tìm thấy đơn hàng');
        err.status = 404;
        throw err;
      }

      const previousCreatedAt = inv.created_at;
      const cancelledAt = inv.cancelled_at || now();

      if (isCancelledInvoiceStatus(inv.status)) {
        const cancelledInvoice = update('invoices', inv.id, {
          status: 'cancelled',
          cancelled_at: cancelledAt,
        }, { skipSave: true }) || inv;
        return {
          ok: true,
          invoice_id: inv.id,
          status: cancelledInvoice.status || 'cancelled',
          cancelled_at: cancelledInvoice.cancelled_at || cancelledAt,
          already_cancelled: true,
        };
      }

      const details = getAll('invoice_details', d => Number(d.invoice_id) === Number(inv.id));
      for (const d of details) {
        const stockProductId = getInvoiceDetailProductId(d);
        if (stockProductId) restoreInvoiceStock(stockProductId, +d.quantity || 0, { skipSave: true });
      }

      update('invoices', inv.id, { status: 'cancelled', cancelled_at: cancelledAt }, { skipSave: true });
      const cancelledInvoice = getOne('invoices', i => Number(i.id) === Number(inv.id));
      syncInvoiceAccounting(cancelledInvoice, {
        skipSave: true,
        previousCreatedAt,
        timestamp: cancelledAt,
        voidReason: 'invoice_cancelled',
        userId: req.user?.id || cancelledInvoice.user_id || null,
      });
      logActivity(req, 'invoice.cancel', {
        type: 'invoice',
        id: cancelledInvoice.id,
        code: cancelledInvoice.invoice_code,
      }, inv, cancelledInvoice, `Hủy đơn hàng ${cancelledInvoice.invoice_code || cancelledInvoice.id}`, { skipSave: true, accountId: cancelledInvoice.account_id || req.accountId });

      return { ok: true, invoice_id: inv.id, status: 'cancelled', cancelled_at: cancelledInvoice.cancelled_at || cancelledAt };
    }));

    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ ok: false, error: 'Lỗi khi hủy đơn: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/invoices/:id/confirm
// ─────────────────────────────────────────────
router.patch('/:id/confirm', async (req, res) => {
  try {
    const result = await Promise.resolve(withAtomicDbWrite(() => {
      const inv = getOne('invoices', i => Number(i.id) === Number(req.params.id));
      if (!inv) {
        const err = new Error('Không tìm thấy đơn hàng');
        err.status = 404;
        throw err;
      }
      if (isCancelledInvoiceStatus(inv.status)) {
        const err = new Error('Không thể xác nhận đơn đã hủy');
        err.status = 400;
        throw err;
      }
      if (inv.status === 'completed') {
        const err = new Error('Đơn đã được xác nhận trước đó');
        err.status = 400;
        throw err;
      }

      const previousCreatedAt = inv.created_at;
      update('invoices', inv.id, { status: 'completed' }, { skipSave: true });
      const completedInvoice = getOne('invoices', i => Number(i.id) === Number(inv.id));
      syncInvoiceAccounting(completedInvoice, { skipSave: true, previousCreatedAt, timestamp: now(), userId: req.user?.id || completedInvoice.user_id || null });
      logActivity(req, 'invoice.confirm', {
        type: 'invoice',
        id: completedInvoice.id,
        code: completedInvoice.invoice_code,
      }, inv, completedInvoice, `Xác nhận hoàn thành đơn hàng ${completedInvoice.invoice_code || completedInvoice.id}`, { skipSave: true, accountId: completedInvoice.account_id || req.accountId });

      return { ok: true, invoice_id: inv.id, status: 'completed', message: 'Đơn đã được xác nhận' };
    }));

    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ ok: false, error: 'Lỗi khi xác nhận đơn: ' + err.message });
  }
});

module.exports = Object.assign(router, { exportCustomerDebtReport });
