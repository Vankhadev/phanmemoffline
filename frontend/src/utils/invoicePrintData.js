import { formatCurrency, formatNumber } from './invoiceTemplateRenderer';

export const PAYMENT_LABELS = {
  cash: 'Tiền mặt',
  bank: 'Chuyển khoản',
  debt: 'Công nợ',
};

const BANK_MAP = {
  Vietcombank: 'VCB',
  VietinBank: 'CTG',
  TPBank: 'TPB',
  MBBank: 'MB',
  ACB: 'ACB',
  VPBank: 'VPB',
  Sacombank: 'SACBOM',
  Agribank: 'VBA',
  BIDV: 'BIDV',
  Techcombank: 'TCB',
  Default: 'ICB',
};

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePaymentMethod(method) {
  const value = String(method || '').trim().toLowerCase();
  if (value === 'cash' || value === 'bank' || value === 'debt') return value;
  if (value.includes('chuyển') || value.includes('chuyen') || value.includes('bank')) return 'bank';
  if (value.includes('nợ') || value.includes('no') || value.includes('debt')) return 'debt';
  return 'cash';
}

function formatDateTime(value) {
  if (!value) return new Date().toLocaleString('vi-VN', { hour12: false });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('vi-VN', { hour12: false });
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('vi-VN');
}

function normalizeStore(store = {}) {
  return {
    ...store,
    name: firstDefined(store.name, store.store_name, 'Cửa hàng'),
    address: firstDefined(store.address, ''),
    phone: firstDefined(store.phone, ''),
    email: firstDefined(store.email, ''),
    tax_code: firstDefined(store.tax_code, store.taxCode, ''),
    bank_account: firstDefined(store.bank_account, store.bankAccount, ''),
    bank_name: firstDefined(store.bank_name, store.bankName, ''),
    invoice_logo: firstDefined(store.invoice_logo, store.logo, ''),
    invoice_vietqr_logo: firstDefined(store.invoice_vietqr_logo, store.vietqr_logo, ''),
    invoice_note: firstDefined(store.invoice_note, ''),
    invoice_slogan: firstDefined(store.invoice_slogan, ''),
  };
}

export function buildInvoiceVietQRUrl(store = {}, amount = 0, invoiceCode = '') {
  const account = String(store.bank_account || '').replace(/\s/g, '');
  if (!account) return '';
  const bankCode = BANK_MAP[String(store.bank_name || '').trim()] || BANK_MAP.Default;
  const addInfo = encodeURIComponent(`Thanh toan don hang ${invoiceCode || ''}`.trim());
  const accountName = encodeURIComponent(store.name || '');
  return `https://img.vietqr.io/image/${bankCode}-${account}-compact2.png?amount=${Math.max(0, Math.round(toNumber(amount, 0)))}&addInfo=${addInfo}&accountName=${accountName}`;
}

function normalizeCustomer(invoice = {}, customer = {}) {
  const source = customer || {};
  return {
    ...source,
    id: firstDefined(source.id, invoice.customer_id, ''),
    name: firstDefined(source.name, invoice.customer_name, invoice.customer?.name, invoice.selectedCustomer?.name, 'Khách lẻ'),
    phone: firstDefined(source.phone, invoice.customer_phone, invoice.customer?.phone, invoice.selectedCustomer?.phone, ''),
    address: firstDefined(source.address, invoice.customer_address, invoice.customer?.address, invoice.selectedCustomer?.address, ''),
    email: firstDefined(source.email, invoice.customer_email, invoice.customer?.email, invoice.selectedCustomer?.email, ''),
    tax_code: firstDefined(source.tax_code, invoice.customer_tax_code, invoice.customer?.tax_code, invoice.selectedCustomer?.tax_code, ''),
  };
}

function normalizeUser(invoice = {}, user = {}) {
  const source = user || {};
  return {
    ...source,
    id: firstDefined(source.id, invoice.user_id, ''),
    name: firstDefined(source.name, invoice.user_name, invoice.cashier, invoice.invoice_writer, ''),
    email: firstDefined(source.email, ''),
  };
}

export function normalizeInvoicePrintItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => {
    const quantity = toNumber(firstDefined(item.quantity, item.qty), 1);
    const unitPrice = toNumber(firstDefined(item.unit_price, item.price_raw, item.price, item.sale_price), 0);
    const discountAmount = toNumber(firstDefined(item.discount_amount, item.line_discount, item.discount_raw), 0);
    const lineTotal = toNumber(firstDefined(item.line_total, item.total, item.amount), quantity * unitPrice - discountAmount);
    const sku = firstDefined(item.product_sku, item.sku, item.code, '');
    const name = firstDefined(item.product_name, item.name, item.combo_name, `Sản phẩm ${index + 1}`);

    return {
      ...item,
      id: firstDefined(item.id, item.product_id, item.combo_id, index + 1),
      sku,
      product_sku: sku,
      name,
      product_name: name,
      unit: firstDefined(item.unit, item.product_unit, ''),
      quantity_raw: quantity,
      quantity: formatNumber(quantity),
      unit_price: unitPrice,
      price_raw: unitPrice,
      price: formatCurrency(unitPrice),
      discount_raw: discountAmount,
      discount_amount: discountAmount,
      discount: formatCurrency(discountAmount),
      line_total_raw: lineTotal,
      line_total: formatCurrency(lineTotal),
      image_url: firstDefined(item.image_url, item.image, item.thumbnail, item.product_image, ''),
      reason: firstDefined(item.reason, ''),
    };
  });
}

function resolveItems(invoice = {}, explicitItems) {
  if (Array.isArray(explicitItems)) return explicitItems;
  if (Array.isArray(invoice.cart)) return invoice.cart;
  if (Array.isArray(invoice.details)) return invoice.details;
  if (Array.isArray(invoice.items)) return invoice.items;
  return [];
}

export function createInvoicePrintData({
  store = {},
  invoice = {},
  customer = null,
  user = null,
  items = undefined,
  type = 'sale_invoice',
} = {}) {
  const normalizedStore = normalizeStore(store || {});
  const printItems = normalizeInvoicePrintItems(resolveItems(invoice, items));
  const subtotalRaw = toNumber(firstDefined(invoice.subtotal, invoice.sub_total), printItems.reduce((sum, item) => sum + toNumber(item.line_total_raw, 0), 0));
  const vatAmountRaw = toNumber(firstDefined(invoice.vat_amount, invoice.vatAmount), 0);
  const discountRaw = toNumber(firstDefined(invoice.discount_amount, invoice.discountAmount), 0);
  const deliveryFeeRaw = toNumber(firstDefined(invoice.delivery_fee, invoice.deliveryFee), 0);
  const totalRaw = toNumber(firstDefined(invoice.total, invoice.grand_total, invoice.grandTotal), subtotalRaw + vatAmountRaw - discountRaw + deliveryFeeRaw);
  const paymentMethod = normalizePaymentMethod(firstDefined(invoice.payment_method, invoice.paymentMethod));
  const hasPaidAmount = firstDefined(invoice.paid_amount, invoice.paidAmount, invoice.paid) !== undefined;
  const paidRaw = hasPaidAmount
    ? toNumber(firstDefined(invoice.paid_amount, invoice.paidAmount, invoice.paid), 0)
    : (paymentMethod === 'debt' ? 0 : totalRaw);
  const changeRaw = firstDefined(invoice.change_amount, invoice.changeAmount, invoice.change) !== undefined
    ? toNumber(firstDefined(invoice.change_amount, invoice.changeAmount, invoice.change), 0)
    : Math.max(0, paidRaw - totalRaw);
  const remainingRaw = firstDefined(invoice.remaining_amount, invoice.remainingAmount, invoice.remaining) !== undefined
    ? toNumber(firstDefined(invoice.remaining_amount, invoice.remainingAmount, invoice.remaining), 0)
    : Math.max(0, totalRaw - paidRaw);
  const invoiceCode = firstDefined(invoice.invoice_code, invoice.code, invoice.order_code, invoice.id ? `HD-${invoice.id}` : 'Hóa đơn');
  const normalizedCustomer = normalizeCustomer(invoice, customer || invoice.customer || invoice.selectedCustomer || {});
  const normalizedUser = normalizeUser(invoice, user || invoice.user || {});
  const qrUrl = firstDefined(
    invoice.qr_url,
    invoice.qrUrl,
    paymentMethod === 'bank' ? buildInvoiceVietQRUrl(normalizedStore, totalRaw, invoiceCode) : ''
  );

  const invoiceData = {
    ...invoice,
    code: invoiceCode,
    invoice_code: invoiceCode,
    created_at: formatDateTime(firstDefined(invoice.created_at, invoice.createdAt, invoice.date)),
    created_date: formatDate(firstDefined(invoice.created_at, invoice.createdAt, invoice.date)),
    delivery_date: invoice.delivery_date ? formatDate(invoice.delivery_date) : '',
    cashier: firstDefined(invoice.cashier, normalizedUser.name, invoice.invoice_writer, ''),
    payment_method: PAYMENT_LABELS[paymentMethod] || paymentMethod,
    payment_method_raw: paymentMethod,
    subtotal: formatCurrency(subtotalRaw),
    vat: formatCurrency(vatAmountRaw),
    vat_amount: formatCurrency(vatAmountRaw),
    vat_percent: toNumber(firstDefined(invoice.vat_percent, invoice.vatPercent), 0),
    discount: formatCurrency(discountRaw),
    discount_amount: formatCurrency(discountRaw),
    delivery_fee: formatCurrency(deliveryFeeRaw),
    total: formatCurrency(totalRaw),
    paid: formatCurrency(paidRaw),
    paid_amount: formatCurrency(paidRaw),
    change: formatCurrency(changeRaw),
    change_amount: formatCurrency(changeRaw),
    remaining: formatCurrency(remainingRaw),
    remaining_amount: formatCurrency(remainingRaw),
    note: firstDefined(invoice.note, ''),
    invoice_writer: firstDefined(invoice.invoice_writer, normalizedUser.name, ''),
    receiver_name: firstDefined(invoice.receiver_name, ''),
    qr_url: qrUrl,
  };

  const totals = {
    subtotal: formatCurrency(subtotalRaw),
    vat: formatCurrency(vatAmountRaw),
    vat_amount: formatCurrency(vatAmountRaw),
    discount: formatCurrency(discountRaw),
    delivery_fee: formatCurrency(deliveryFeeRaw),
    total: formatCurrency(totalRaw),
    paid: formatCurrency(paidRaw),
    paid_amount: formatCurrency(paidRaw),
    change: formatCurrency(changeRaw),
    change_amount: formatCurrency(changeRaw),
    remaining: formatCurrency(remainingRaw),
    remaining_amount: formatCurrency(remainingRaw),
    subtotal_raw: subtotalRaw,
    vat_amount_raw: vatAmountRaw,
    discount_raw: discountRaw,
    delivery_fee_raw: deliveryFeeRaw,
    total_raw: totalRaw,
    paid_raw: paidRaw,
    change_raw: changeRaw,
    remaining_raw: remainingRaw,
  };

  return {
    type,
    store: normalizedStore,
    invoice: invoiceData,
    customer: normalizedCustomer,
    user: normalizedUser,
    totals,
    items: printItems,
    images: {
      logo: firstDefined(normalizedStore.invoice_logo, ''),
      qr: qrUrl || '',
      placeholder: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
    },
  };
}
