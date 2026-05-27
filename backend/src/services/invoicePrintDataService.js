const { getAll, getOne } = require('../db/database');
const { resolveInvoiceDetailDisplayFields } = require('../utils/productDisplayName');

const PAYMENT_METHOD_LABELS = {
  cash: 'Tiền mặt',
  bank: 'Chuyển khoản',
  debt: 'Công nợ',
};

const PAYMENT_STATUS_LABELS = {
  paid: 'Đã thanh toán',
  partial: 'Thanh toán một phần',
  unpaid: 'Chưa thanh toán',
};

function createHttpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeText(value, maxLength = 300) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, maxLength);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseObjectLike(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return parseObjectLike(JSON.parse(value));
    } catch (_) {
      return null;
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizePaymentMethod(method) {
  const raw = normalizeText(method, 50).toLowerCase();
  if (!raw) return 'cash';
  if (raw === 'cash' || raw === 'bank' || raw === 'debt') return raw;
  if (raw.includes('chuyển') || raw.includes('chuyen') || raw.includes('bank')) return 'bank';
  if (raw.includes('nợ') || raw.includes('no') || raw.includes('debt')) return 'debt';
  return 'cash';
}

function resolveCustomerTypeRecord(customerTypeValue = '') {
  const normalizedValue = normalizeText(customerTypeValue, 100);
  if (!normalizedValue) return null;
  return getOne('customer_types', item => item.active !== 0 && (
    String(item.id) === normalizedValue
    || String(item.name || '').trim().toLowerCase() === normalizedValue.toLowerCase()
  ));
}

function inferCustomerTier(customerTypeValue = '') {
  const normalizedValue = normalizeText(customerTypeValue, 100).toLowerCase();
  if (!normalizedValue) return '';
  if (normalizedValue.includes('vip')) return 'vip';
  if (
    normalizedValue.includes('wholesale')
    || normalizedValue.includes('sỉ')
    || normalizedValue.includes('si')
    || normalizedValue.includes('buôn')
    || normalizedValue.includes('buon')
  ) {
    return 'wholesale';
  }
  if (normalizedValue.includes('retail') || normalizedValue.includes('lẻ') || normalizedValue.includes('le')) {
    return 'retail';
  }
  return '';
}

function derivePaymentAmounts(invoice = {}) {
  const total = Math.max(0, toNumber(invoice.total, 0));
  const paidAmount = Math.max(0, toNumber(invoice.paid_amount, 0));
  const changeAmount = invoice.change_amount !== undefined && invoice.change_amount !== null && invoice.change_amount !== ''
    ? Math.max(0, toNumber(invoice.change_amount, 0))
    : Math.max(0, paidAmount - total);
  const remainingAmount = invoice.remaining_amount !== undefined && invoice.remaining_amount !== null && invoice.remaining_amount !== ''
    ? Math.max(0, toNumber(invoice.remaining_amount, 0))
    : Math.max(0, total - paidAmount);

  return {
    paid_amount: paidAmount,
    change_amount: changeAmount,
    remaining_amount: remainingAmount,
  };
}

function derivePaymentStatus(invoice = {}) {
  const total = Math.max(0, toNumber(invoice.total, 0));
  const paymentAmounts = derivePaymentAmounts(invoice);

  if (total <= 0) return 'paid';
  if (paymentAmounts.remaining_amount <= 0) return 'paid';
  if (paymentAmounts.paid_amount > 0 || paymentAmounts.change_amount > 0) return 'partial';
  return 'unpaid';
}

function inferSelectedPriceTier(unitPrice, referenceRecord = null, customerTypeValue = '') {
  if (!referenceRecord || typeof referenceRecord !== 'object') return '';

  const normalizedUnitPrice = toNumber(unitPrice, NaN);
  if (!Number.isFinite(normalizedUnitPrice)) return '';

  const candidates = [
    { tier: 'retail', value: referenceRecord.retail_price },
    { tier: 'wholesale', value: referenceRecord.wholesale_price },
    { tier: 'vip', value: referenceRecord.vip_price },
  ].filter(item => Number.isFinite(Number(item.value)));

  if (candidates.length === 0) return '';

  const exactMatches = candidates.filter(item => Math.abs(toNumber(item.value, 0) - normalizedUnitPrice) < 0.0001);
  if (exactMatches.length === 1) return exactMatches[0].tier;

  const hintedTier = inferCustomerTier(customerTypeValue);
  if (hintedTier && exactMatches.some(item => item.tier === hintedTier)) return hintedTier;

  return '';
}

function buildNormalizedCustomer(invoice = {}, customer = null) {
  const customerTypeRecord = resolveCustomerTypeRecord(customer?.customer_type || invoice.customer_type || '');
  const customerTypeName = customerTypeRecord?.name || normalizeText(customer?.customer_type || invoice.customer_type || '', 100) || 'Khách lẻ';

  return {
    id: customer?.id || invoice.customer_id || null,
    name: normalizeText(customer?.name || invoice.customer_name || 'Khách lẻ', 200) || 'Khách lẻ',
    phone: normalizeText(customer?.phone || invoice.customer_phone || '', 50),
    address: normalizeText(customer?.address || invoice.customer_address || '', 300),
    email: normalizeText(customer?.email || invoice.customer_email || '', 120),
    tax_code: normalizeText(customer?.tax_code || invoice.customer_tax_code || '', 80),
    customer_type_id: customerTypeRecord?.id || null,
    customer_type: customerTypeName,
    customer_type_name: customerTypeName,
    type: customerTypeName,
  };
}

function buildNormalizedUser(invoice = {}, user = null) {
  return {
    id: user?.id || invoice.user_id || null,
    name: normalizeText(user?.name || invoice.user_name || invoice.invoice_writer || '', 120),
    email: normalizeText(user?.email || '', 120),
  };
}

function buildStoreInfo(invoice = {}) {
  const currentStore = getAll('store_info')[0] || {};
  const snapshot = parseObjectLike(invoice.store_info_snapshot);
  return {
    snapshot,
    effective: {
      ...currentStore,
      ...(snapshot || {}),
    },
  };
}

function resolveReferenceRecord(detail = {}) {
  if (detail.combo_id) {
    return getOne('combos', combo => Number(combo.id) === Number(detail.combo_id));
  }
  const referenceId = detail.variant_id || detail.product_id;
  if (!referenceId) return null;
  return getOne('products', product => Number(product.id) === Number(referenceId));
}

function normalizePrintItem(detail = {}, customerTypeValue = '') {
  const displayFields = resolveInvoiceDetailDisplayFields(detail, id => getOne('products', product => Number(product.id) === Number(id)));
  const referenceRecord = resolveReferenceRecord(detail);
  const quantity = toNumber(detail.quantity, 0);
  const unitPrice = toNumber(detail.unit_price, 0);
  const discountAmount = toNumber(detail.discount_amount, 0);
  const lineTotal = detail.line_total !== undefined && detail.line_total !== null && detail.line_total !== ''
    ? toNumber(detail.line_total, quantity * unitPrice - discountAmount)
    : (quantity * unitPrice - discountAmount);
  const selectedPriceTier = inferSelectedPriceTier(unitPrice, referenceRecord, customerTypeValue);

  return {
    id: detail.id,
    detail_id: detail.id,
    type: detail.type || detail.item_type || (detail.combo_id ? 'combo' : 'product'),
    product_id: detail.product_id || null,
    variant_id: detail.variant_id || null,
    combo_id: detail.combo_id || null,
    product_name: displayFields.product_name || detail.product_name || detail.name || referenceRecord?.name || 'Sản phẩm',
    name: displayFields.product_name || detail.product_name || detail.name || referenceRecord?.name || 'Sản phẩm',
    sku: displayFields.product_sku || detail.product_sku || detail.sku || referenceRecord?.sku || '',
    product_sku: displayFields.product_sku || detail.product_sku || detail.sku || referenceRecord?.sku || '',
    unit: normalizeText(referenceRecord?.unit || detail.unit || detail.product_unit || '', 50),
    quantity,
    unit_price: unitPrice,
    discount_amount: discountAmount,
    discount_percent: toNumber(detail.discount_percent, 0),
    line_total: lineTotal,
    selected_price_tier: selectedPriceTier || null,
  };
}

function resolveInvoiceSelectedTier(items = []) {
  const uniqueTiers = Array.from(new Set(
    (items || [])
      .map(item => item.selected_price_tier)
      .filter(Boolean)
  ));
  return uniqueTiers.length === 1 ? uniqueTiers[0] : null;
}

function getInvoicePrintData(invoiceId) {
  const normalizedInvoiceId = Number(invoiceId);
  if (!Number.isFinite(normalizedInvoiceId) || normalizedInvoiceId <= 0) {
    throw createHttpError('Mã hóa đơn không hợp lệ', 400);
  }

  const invoice = getOne('invoices', row => Number(row.id) === normalizedInvoiceId);
  if (!invoice) throw createHttpError('Không tìm thấy hóa đơn', 404);

  const customer = invoice.customer_id
    ? getOne('customers', row => Number(row.id) === Number(invoice.customer_id))
    : null;
  const user = invoice.user_id
    ? getOne('users', row => Number(row.id) === Number(invoice.user_id))
    : null;
  const normalizedCustomer = buildNormalizedCustomer(invoice, customer);
  const normalizedUser = buildNormalizedUser(invoice, user);
  const storeInfo = buildStoreInfo(invoice);
  const paymentMethodRaw = normalizePaymentMethod(invoice.payment_method);
  const paymentStatus = derivePaymentStatus(invoice);
  const paymentAmounts = derivePaymentAmounts(invoice);
  const details = getAll('invoice_details', row => Number(row.invoice_id) === normalizedInvoiceId);
  const items = details.map(detail => normalizePrintItem(detail, normalizedCustomer.customer_type));
  const selectedPriceTier = resolveInvoiceSelectedTier(items);

  const invoicePayload = {
    id: invoice.id,
    invoice_id: invoice.id,
    invoice_code: normalizeText(invoice.invoice_code, 120),
    order_code: normalizeText(invoice.invoice_code, 120),
    created_at: invoice.created_at || '',
    status: normalizeText(invoice.status, 50),
    customer_id: invoice.customer_id || null,
    customer_name: normalizedCustomer.name,
    customer_phone: normalizedCustomer.phone,
    customer_address: normalizedCustomer.address,
    customer_email: normalizedCustomer.email,
    customer_tax_code: normalizedCustomer.tax_code,
    customer_type: normalizedCustomer.customer_type,
    customer_type_name: normalizedCustomer.customer_type_name,
    subtotal: toNumber(invoice.subtotal, 0),
    discount_amount: toNumber(invoice.discount_amount, 0),
    discount_percent: toNumber(invoice.discount_percent, 0),
    total: toNumber(invoice.total, 0),
    paid_amount: paymentAmounts.paid_amount,
    change_amount: paymentAmounts.change_amount,
    remaining_amount: paymentAmounts.remaining_amount,
    payment_method: paymentMethodRaw,
    payment_method_label: PAYMENT_METHOD_LABELS[paymentMethodRaw] || paymentMethodRaw,
    payment_status: paymentStatus,
    payment_status_label: PAYMENT_STATUS_LABELS[paymentStatus] || paymentStatus,
    note: normalizeText(invoice.note, 1000),
    invoice_writer: normalizeText(invoice.invoice_writer, 120) || normalizedUser.name,
    receiver_name: normalizeText(invoice.receiver_name, 120),
    user_id: normalizedUser.id,
    user_name: normalizedUser.name,
    user_email: normalizedUser.email,
    selected_price_tier: selectedPriceTier,
    selected_price_tier_hint: inferCustomerTier(normalizedCustomer.customer_type) || null,
    store_info_snapshot: storeInfo.snapshot,
  };

  return {
    ok: true,
    type: 'sale_invoice',
    invoice_id: invoice.id,
    invoice_code: invoicePayload.invoice_code,
    created_at: invoicePayload.created_at,
    status: invoicePayload.status,
    payment_status: invoicePayload.payment_status,
    payment_status_label: invoicePayload.payment_status_label,
    payment_method: invoicePayload.payment_method,
    payment_method_label: invoicePayload.payment_method_label,
    selected_price_tier: invoicePayload.selected_price_tier,
    selected_price_tier_hint: invoicePayload.selected_price_tier_hint,
    customer: normalizedCustomer,
    user: normalizedUser,
    store: storeInfo.effective,
    store_info_snapshot: storeInfo.snapshot,
    items,
    subtotal: invoicePayload.subtotal,
    discount_amount: invoicePayload.discount_amount,
    discount_percent: invoicePayload.discount_percent,
    total: invoicePayload.total,
    paid_amount: invoicePayload.paid_amount,
    change_amount: invoicePayload.change_amount,
    remaining_amount: invoicePayload.remaining_amount,
    note: invoicePayload.note,
    invoice_writer: invoicePayload.invoice_writer,
    receiver_name: invoicePayload.receiver_name,
    invoice: invoicePayload,
    totals: {
      subtotal: invoicePayload.subtotal,
      discount_amount: invoicePayload.discount_amount,
      discount_percent: invoicePayload.discount_percent,
      total: invoicePayload.total,
      paid_amount: invoicePayload.paid_amount,
      change_amount: invoicePayload.change_amount,
      remaining_amount: invoicePayload.remaining_amount,
    },
  };
}

module.exports = {
  getInvoicePrintData,
};
