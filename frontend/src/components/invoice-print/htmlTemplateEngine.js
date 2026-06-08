function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatQuantity(value) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

function getPathValue(source, path) {
  const parts = String(path || '').split('.').filter(Boolean);
  let current = source;
  for (const part of parts) {
    if (current === null || current === undefined) return '';
    current = current[part];
  }
  return current ?? '';
}

function getItemName(item = {}) {
  return item.name || item.product_name || item.productName || item.variant_name || 'Sản phẩm';
}

function getItemUnit(item = {}) {
  return item.unit || item.unit_name || item.uom || item.product_unit || '';
}

function normalizeItem(item = {}, index = 0) {
  const quantity = Number(item.quantity ?? item.qty) || 0;
  const unitPrice = Number(item.unit_price ?? item.price) || 0;
  const discountAmount = Number(item.discount_amount ?? item.discount) || 0;
  const explicitLineTotal = Number(item.line_total ?? item.total ?? item.lineTotal);
  return {
    ...item,
    no: index + 1,
    name: getItemName(item),
    sku: item.sku || item.product_sku || '',
    unit: getItemUnit(item),
    quantity,
    quantity_text: formatQuantity(quantity),
    unit_price: unitPrice,
    unit_price_text: formatVND(unitPrice),
    discount_amount: discountAmount,
    discount_text: discountAmount ? formatVND(discountAmount) : '',
    line_total: Number.isFinite(explicitLineTotal) ? explicitLineTotal : Math.max(0, quantity * unitPrice - discountAmount),
  };
}

function normalizeData(data = {}) {
  const store = data.store || {};
  const customer = data.customer || {};
  const invoice = data.invoice || {};
  const totals = data.totals || {};
  const payment = data.payment || {};
  const metadata = data.metadata || {};
  const items = (Array.isArray(data.items) ? data.items : []).map(normalizeItem);
  const subtotal = Number(totals.subtotal) || items.reduce((sum, item) => sum + (Number(item.line_total) || 0), 0);
  const total = Number(totals.total ?? totals.grand_total ?? invoice.total) || subtotal;
  const paidAmount = Number(payment.paid_amount ?? totals.paid_amount ?? invoice.paid_amount) || 0;
  const remainingAmount = Number(payment.remaining_amount ?? totals.remaining_amount ?? invoice.remaining_amount) || Math.max(0, total - paidAmount);

  return {
    ...data,
    store,
    customer: {
      ...customer,
      name: customer.name || invoice.customer_name || 'Khách lẻ',
      phone: customer.phone || invoice.customer_phone || '',
      address: customer.address || invoice.customer_address || '',
      tax_code: customer.tax_code || invoice.customer_tax_code || '',
    },
    invoice: {
      ...invoice,
      code: invoice.invoice_code || invoice.code || invoice.id || '',
      created_at_text: formatDateTime(invoice.created_at || metadata.printed_at || new Date().toISOString()),
    },
    items,
    totals: {
      ...totals,
      subtotal,
      subtotal_text: formatVND(subtotal),
      total,
      total_text: formatVND(total),
      discount_amount_text: formatVND(totals.discount_amount || 0),
      vat_amount_text: formatVND(totals.vat_amount || 0),
      delivery_fee_text: formatVND(totals.delivery_fee || 0),
      paid_amount: paidAmount,
      paid_amount_text: formatVND(paidAmount),
      remaining_amount: remainingAmount,
      remaining_amount_text: formatVND(remainingAmount),
      change_amount_text: formatVND(totals.change_amount || 0),
    },
    payment: {
      ...payment,
      method_label: payment.method_label || payment.payment_method_label || invoice.payment_method || '',
    },
    metadata: {
      ...metadata,
      printed_at_text: formatDateTime(metadata.printed_at || new Date().toISOString()),
      user_name: metadata.user_name || metadata.created_by_user_name || invoice.user_name || invoice.invoice_writer || '',
    },
  };
}

function getVariableValue(key, context) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return '';

  const aliases = {
    'invoice.invoice_code': 'invoice.code',
    'order.code': 'invoice.code',
    'order.created_at': 'invoice.created_at_text',
    'order.note': 'invoice.note',
    'staff.name': 'metadata.user_name',
    'printed_at': 'metadata.printed_at_text',
    'customer.tax_code': 'customer.tax_code',
  };

  const path = aliases[normalizedKey] || normalizedKey;
  const value = getPathValue(context, path);
  if (path.endsWith('_text')) return value;
  if (/amount|price|total|fee|debt|paid|remaining|change/i.test(path) && typeof value === 'number') return formatVND(value);
  if (/created_at|printed_at|updated_at|date/i.test(path) && value) return formatDateTime(value);
  return value;
}

function renderItemsTable(data) {
  const rows = data.items.length
    ? data.items.map(item => `
      <tr>
        <td class="text-center">${escapeHtml(item.no)}</td>
        <td>
          <strong>${escapeHtml(item.name)}</strong>
          ${item.sku ? `<div class="muted">SKU: ${escapeHtml(item.sku)}</div>` : ''}
        </td>
        <td class="text-center">${escapeHtml(item.unit)}</td>
        <td class="text-center">${escapeHtml(item.quantity_text)}</td>
        <td class="text-right">${escapeHtml(item.unit_price_text)}</td>
        <td class="text-right">${escapeHtml(item.discount_text)}</td>
        <td class="text-right">${escapeHtml(formatVND(item.line_total))}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="7" class="text-center muted">Không có sản phẩm.</td></tr>';

  return `
    <table class="sapo-items-table">
      <thead>
        <tr>
          <th>STT</th>
          <th>Tên sản phẩm</th>
          <th>Đơn vị</th>
          <th>SL</th>
          <th>Đơn giá</th>
          <th>CK</th>
          <th>Thành tiền</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderTokenBlock(source, context) {
  return String(source || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    if (key === 'items_table' || key === 'order.items_table') return renderItemsTable(context);
    return escapeHtml(getVariableValue(key, context));
  });
}

export function sanitizeTemplateHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?>[\s\S]*?<\/embed>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, '')
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');
}

export function sanitizeTemplateCss(value) {
  return String(value || '')
    .replace(/@import[^;]+;/gi, '')
    .replace(/javascript:/gi, '')
    .slice(0, 120000);
}

export function isHtmlTemplateSource(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^[{[]/.test(text)) {
    try {
      JSON.parse(text);
      return false;
    } catch (_error) {
      // A template may begin with {{store.name}} or another token.
    }
  }
  return /<\/?[a-z][\s\S]*>/i.test(text) || /\{\{\s*[#/a-zA-Z0-9_.-]+\s*\}\}/.test(text);
}

export function renderHtmlTemplate(source, payload = {}) {
  const data = normalizeData(payload);
  const withLoops = String(source || '').replace(/\{\{#items\}\}([\s\S]*?)\{\{\/items\}\}/g, (_match, block) => (
    data.items.length
      ? data.items.map((item, index) => renderTokenBlock(block, { ...data, item, index })).join('')
      : ''
  ));
  return sanitizeTemplateHtml(renderTokenBlock(withLoops, data));
}

export const SAPO_TEMPLATE_VARIABLE_GROUPS = Object.freeze([
  {
    group: 'Cửa hàng',
    variables: [
      { label: 'Tên cửa hàng', token: '{{store.name}}' },
      { label: 'Địa chỉ', token: '{{store.address}}' },
      { label: 'Số điện thoại', token: '{{store.phone}}' },
      { label: 'Mã số thuế', token: '{{store.tax_code}}' },
    ],
  },
  {
    group: 'Đơn hàng',
    variables: [
      { label: 'Mã đơn', token: '{{invoice.code}}' },
      { label: 'Ngày tạo', token: '{{invoice.created_at_text}}' },
      { label: 'Nhân viên', token: '{{metadata.user_name}}' },
      { label: 'Ghi chú', token: '{{invoice.note}}' },
    ],
  },
  {
    group: 'Khách hàng',
    variables: [
      { label: 'Tên khách', token: '{{customer.name}}' },
      { label: 'SĐT khách', token: '{{customer.phone}}' },
      { label: 'Địa chỉ khách', token: '{{customer.address}}' },
      { label: 'MST khách', token: '{{customer.tax_code}}' },
    ],
  },
  {
    group: 'Thanh toán',
    variables: [
      { label: 'Tổng hàng', token: '{{totals.subtotal_text}}' },
      { label: 'Giảm giá', token: '{{totals.discount_amount_text}}' },
      { label: 'Phải trả', token: '{{totals.total_text}}' },
      { label: 'Đã trả', token: '{{totals.paid_amount_text}}' },
      { label: 'Còn nợ', token: '{{totals.remaining_amount_text}}' },
    ],
  },
  {
    group: 'Bảng hàng',
    variables: [
      { label: 'Bảng tự động', token: '{{items_table}}' },
      { label: 'Dòng lặp', token: '{{#items}}\n<tr><td>{{item.no}}</td><td>{{item.name}}</td><td>{{item.quantity_text}}</td><td>{{item.line_total}}</td></tr>\n{{/items}}' },
    ],
  },
]);

export const DEFAULT_SAPO_TEMPLATE_HTML = `
<section class="sapo-print-form">
  <header class="sapo-header">
    <div>
      <h2>{{store.name}}</h2>
      <p>{{store.address}}</p>
      <p>Điện thoại: {{store.phone}}</p>
    </div>
    <div class="sapo-title">
      <h1>HÓA ĐƠN BÁN HÀNG</h1>
      <p>Mã đơn: <strong>{{invoice.code}}</strong></p>
      <p>Ngày: {{invoice.created_at_text}}</p>
    </div>
  </header>

  <section class="sapo-customer">
    <div><span>Khách hàng:</span> <strong>{{customer.name}}</strong></div>
    <div><span>Số điện thoại:</span> {{customer.phone}}</div>
    <div><span>Địa chỉ:</span> {{customer.address}}</div>
    <div><span>Nhân viên:</span> {{metadata.user_name}}</div>
  </section>

  {{items_table}}

  <section class="sapo-summary">
    <div><span>Tổng tiền hàng</span><strong>{{totals.subtotal_text}}</strong></div>
    <div><span>Giảm giá</span><strong>{{totals.discount_amount_text}}</strong></div>
    <div><span>Phí giao hàng</span><strong>{{totals.delivery_fee_text}}</strong></div>
    <div class="grand-total"><span>Khách phải trả</span><strong>{{totals.total_text}}</strong></div>
    <div><span>Khách đã trả</span><strong>{{totals.paid_amount_text}}</strong></div>
    <div><span>Còn nợ</span><strong>{{totals.remaining_amount_text}}</strong></div>
  </section>

  <section class="sapo-note">
    <strong>Ghi chú:</strong> {{invoice.note}}
  </section>

  <footer class="sapo-footer">
    <div>
      <strong>Khách hàng</strong>
      <span>(Ký và ghi rõ họ tên)</span>
    </div>
    <div>
      <strong>Người bán</strong>
      <span>(Ký và ghi rõ họ tên)</span>
    </div>
  </footer>
</section>
`.trim();

export const DEFAULT_SAPO_TEMPLATE_CSS = `
.sapo-print-form {
  color: #111827;
  font-size: 12px;
  line-height: 1.35;
}

.sapo-header {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 16px;
  align-items: start;
  border-bottom: 2px solid #111827;
  padding-bottom: 10px;
}

.sapo-header h2,
.sapo-title h1 {
  margin: 0 0 5px;
  font-size: 18px;
}

.sapo-header p,
.sapo-title p {
  margin: 2px 0;
}

.sapo-title {
  text-align: right;
}

.sapo-title h1 {
  font-size: 22px;
}

.sapo-customer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 18px;
  margin: 12px 0;
}

.sapo-customer span,
.muted {
  color: #64748b;
}

.sapo-items-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.sapo-items-table th,
.sapo-items-table td {
  border: 1px solid #111827;
  padding: 6px;
  vertical-align: top;
  word-break: normal;
  overflow-wrap: anywhere;
}

.sapo-items-table th {
  background: #f3f4f6;
  font-weight: 700;
}

.text-center {
  text-align: center;
}

.text-right {
  text-align: right;
}

.sapo-summary {
  width: 42%;
  margin: 12px 0 0 auto;
}

.sapo-summary div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #e5e7eb;
  padding: 4px 0;
}

.sapo-summary .grand-total {
  border-bottom: 2px solid #111827;
  font-size: 14px;
}

.sapo-note {
  margin-top: 14px;
  min-height: 28px;
}

.sapo-footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  margin-top: 34px;
  text-align: center;
}

.sapo-footer span {
  display: block;
  margin-top: 4px;
  color: #64748b;
}
`.trim();
