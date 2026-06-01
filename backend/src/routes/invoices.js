/**
 * Invoices API routes
 * CRUD cho đơn hàng: tạo, sửa, xóa, xem
 * Status: pending → confirmed → completed | cancelled
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, remove, now, getNextSeq, normalizePaymentMethod, getActiveAccountId, withAtomicDbWrite } = require('../db/database');
const { resolveInvoiceDetailDisplayFields } = require('../utils/productDisplayName');
const {
  createInvoiceFromPayload,
  syncInvoiceAccounting,
  deductStock: deductInvoiceStock,
  restoreStock: restoreInvoiceStock,
  mergeDuplicateDetails: mergeInvoiceDetails,
  normalizeInvoiceDetail: normalizeInvoiceDetailService,
} = require('../services/invoiceCreationService');
const {
  getInvoiceDetailProductId,
  validateNegativeStockForDetails,
} = require('../utils/negativeStock');
const { resolveInvoicePrintTemplate } = require('../services/printTemplateService');

// ─────────────────────────────────────────────
// Helper: tạo mã đơn tự động HD000001
// ─────────────────────────────────────────────
function genInvoiceCode() {
  return `HD${String(getNextSeq('invoice_seq')).padStart(5, '0')}`;
}

// ─────────────────────────────────────────────
// Helper: trừ tồn kho cho product HOẶC variant
// ─────────────────────────────────────────────
function deductStock(productOrVariantId, quantity) {
  // ① Thử trừ biến thể trước (biến thể lưu trong bảng products với parent_id != null)
  const variant = getOne('products', v => Number(v.id) === Number(productOrVariantId) && v.parent_id != null);
  if (variant) {
    update('products', variant.id, {
      stock: (Number(variant.stock) || 0) - quantity,
    });
    return;
  }
  // ② Thử trừ sản phẩm cha (parent_id là null)
  const product = getOne('products', p => Number(p.id) === Number(productOrVariantId) && !p.parent_id);
  if (product) {
    update('products', product.id, {
      stock: (Number(product.stock) || 0) - quantity,
    });
    return;
  }
}

// ─────────────────────────────────────────────
// Helper: hoàn tồn kho cho product HOẶC variant
// ─────────────────────────────────────────────
function restoreStock(productOrVariantId, quantity) {
  // ① Thử hoàn biến thể trước
  const variant = getOne('products', v => v.id === productOrVariantId && v.parent_id != null);
  if (variant) {
    update('products', variant.id, {
      stock: (variant.stock || 0) + quantity,
    });
    return;
  }
  // ② Thử hoàn sản phẩm cha
  const product = getOne('products', p => p.id === productOrVariantId && !p.parent_id);
  if (product) {
    update('products', product.id, {
      stock: (product.stock || 0) + quantity,
    });
  }
}

// ─────────────────────────────────────────────
// Helper: lấy tồn kho thực tế (product hoặc variant)
// ─────────────────────────────────────────────
function getStock(productOrVariantId) {
  const variant = getOne('products', v => Number(v.id) === Number(productOrVariantId) && v.parent_id != null);
  if (variant) return { stock: Number(variant.stock) || 0, name: variant.name };
  const product = getOne('products', p => Number(p.id) === Number(productOrVariantId) && !p.parent_id);
  if (product) return { stock: Number(product.stock) || 0, name: product.name };
  return { stock: 0, name: `ID ${productOrVariantId}` };
}

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
    validateNegativeStockForDetails(newDetails, {
      restoredByProductId: collectProductQuantities(oldDetails),
    });
  } catch (error) {
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

function mergeDuplicateDetails(details) {
  return mergeInvoiceDetails(details);
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
    return { ...payload, template: template || null };
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

    const allDetails = getAll('invoice_details');
    const invoices = getAll('invoices')
      .filter(inv => Number(inv.customer_id) === customerId)
      .filter(inv => {
        if (status && status !== 'all') return inv.status === status;
        return inv.status !== 'cancelled';
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
          delivery_fee: Number(inv.delivery_fee) || 0,
          status: inv.status || '',
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
// GET /api/invoices
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, delivery, from, to } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 1000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const includeMeta = String(req.query.meta || '').trim() === '1';
    let rows = await Promise.resolve(getAll('invoices').map(inv => ({
      ...inv,
      customer_name: getOne('customers', c => Number(c.id) === Number(inv.customer_id))?.name || '',
      user_name: getOne('users', u => Number(u.id) === Number(inv.user_id))?.name || '',
      total: Number(inv.total) || 0,
      subtotal: Number(inv.subtotal) || 0,
      paid_amount: Number(inv.paid_amount) || 0,
      remaining_amount: Number(inv.remaining_amount) || 0,
      status: inv.status || 'pending',
      payment_method: inv.payment_method || 'cash',
      source: inv.source || inv.order_source || 'web',
    })));
    if (status) rows = rows.filter(r => r.status === status);
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
    res.status(500).json({ error: 'Lỗi khi lấy danh sách: ' + err.message });
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
    const inv = await Promise.resolve(getOne('invoices', i => Number(i.id) === Number(req.params.id)));
    if (!inv) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    const details = getAll('invoice_details', d => Number(d.invoice_id) === Number(inv.id))
      .map(detail => ({
        ...detail,
        ...resolveInvoiceDetailDisplayFields(detail, id => getOne('products', product => Number(product.id) === Number(id))),
      }));
    const customer = getOne('customers', c => Number(c.id) === Number(inv.customer_id));
    res.json({ ...inv, customer_name: customer?.name || '', details });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi: ' + err.message });
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
    res.status(status).json({ error: 'Lỗi khi tạo đơn: ' + err.message });
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
      if (inv.status === 'cancelled') {
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
        ...(paid_amount !== undefined && { paid_amount: +paid_amount || 0 }),
        ...(change_amount !== undefined && { change_amount: +change_amount || 0 }),
        ...(remaining_amount !== undefined && { remaining_amount: +remaining_amount || 0 }),
        ...(delivery_fee !== undefined && { delivery_fee: +delivery_fee || 0 }),
        ...(delivery_date !== undefined && { delivery_date: delivery_date || null }),
        ...(invoice_writer !== undefined && { invoice_writer }),
        ...(receiver_name !== undefined && { receiver_name }),
        ...(status !== undefined && { status: status || 'pending' }),
        ...(req.body.created_at && { created_at: req.body.created_at }),
      }, { skipSave: true });

      if (details !== undefined) {
        const safeDetails = mergeDuplicateDetails(details);
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
      syncInvoiceAccounting(updatedInvoice, { skipSave: true, previousCreatedAt, timestamp: now() });
      return { ok: true, invoice: updatedInvoice, details: updatedDetails };
    }));

    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: 'Lỗi khi sửa đơn: ' + err.message });
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
      const details = getAll('invoice_details', d => Number(d.invoice_id) === Number(inv.id));
      for (const d of details) {
        const stockProductId = getInvoiceDetailProductId(d);
        if (stockProductId) restoreInvoiceStock(stockProductId, +d.quantity || 0, { skipSave: true });
      }
      for (const detail of details) {
        remove('invoice_details', detail.id, { skipSave: true });
      }

      update('invoices', inv.id, { status: 'cancelled' }, { skipSave: true });
      const cancelledInvoice = getOne('invoices', i => Number(i.id) === Number(inv.id));
      syncInvoiceAccounting(cancelledInvoice, {
        skipSave: true,
        previousCreatedAt,
        timestamp: now(),
        voidReason: 'invoice_cancelled',
      });

      return { ok: true, invoice_id: inv.id, status: 'cancelled' };
    }));

    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: 'Lỗi khi hủy đơn: ' + err.message });
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
      if (inv.status === 'cancelled') {
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
      syncInvoiceAccounting(completedInvoice, { skipSave: true, previousCreatedAt, timestamp: now() });

      return { ok: true, invoice_id: inv.id, status: 'completed', message: 'Đơn đã được xác nhận' };
    }));

    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: 'Lỗi khi xác nhận đơn: ' + err.message });
  }
});

module.exports = router;
