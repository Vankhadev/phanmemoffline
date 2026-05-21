import {
  cloneInvoiceVisualConfig,
  createDefaultInvoiceVisualConfig,
  inferPaperWidthMm,
} from './invoiceTemplateRenderer';

export const PRINT_TEMPLATE_TYPES = [
  { value: 'sale_invoice', label: 'Đơn bán hàng', description: 'Hóa đơn bán hàng sau khi thanh toán' },
  { value: 'temporary_bill', label: 'Phiếu tạm tính', description: 'Phiếu in trước thanh toán hoặc gửi khách kiểm tra' },
  { value: 'return_invoice', label: 'Đơn trả hàng', description: 'Phiếu trả/đổi hàng và hoàn tiền' },
];

export const PAPER_SIZE_OPTIONS = [
  { value: 'A3', label: 'A3', widthMm: 297, description: '297 × 420mm' },
  { value: 'A4', label: 'A4', widthMm: 210, description: '210 × 297mm' },
  { value: 'A5', label: 'A5', widthMm: 148, description: '148 × 210mm' },
  { value: 'A6', label: 'A6', widthMm: 105, description: '105 × 148mm' },
  { value: 'B5', label: 'B5', widthMm: 176, description: '176 × 250mm' },
  { value: 'Letter', label: 'Letter', widthMm: 216, description: '216 × 279mm' },
  { value: 'Legal', label: 'Legal', widthMm: 216, description: '216 × 356mm' },
  { value: 'K57', label: 'K57', widthMm: 57, description: 'Máy in bill 57mm' },
  { value: 'K80', label: 'K80', widthMm: 80, description: 'Máy in bill 80mm' },
  { value: '80mm', label: '80mm', widthMm: 80, description: 'Cuộn giấy 80mm phổ biến' },
];

const commonReceiptCss = `
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #111; font-family: Arial, sans-serif; font-size: 11px; }
.print-template { width: 100%; padding: 0; }
.store-header { text-align: center; border-bottom: 1px dashed #9ca3af; padding-bottom: 7px; margin-bottom: 8px; }
.store-logo { max-width: 25mm; max-height: 16mm; object-fit: contain; display: block; margin: 0 auto 4px; }
.store-name { font-size: 15px; font-weight: 700; text-transform: uppercase; }
.store-meta { font-size: 10px; line-height: 1.35; }
h1 { margin: 8px 0 6px; text-align: center; font-size: 15px; }
.invoice-meta { line-height: 1.45; margin-bottom: 6px; }
.items-table { width: 100%; border-collapse: collapse; margin-top: 6px; }
.items-table th, .items-table td { border-bottom: 1px dashed #d1d5db; padding: 4px 2px; vertical-align: top; }
.items-table th { font-size: 10px; text-align: left; }
.image-cell { width: 12mm; }
.product-image { width: 10mm; height: 10mm; object-fit: cover; border-radius: 2px; }
.text-center { text-align: center; }
.text-right { text-align: right; }
.totals { margin-top: 8px; border-top: 1px dashed #9ca3af; padding-top: 6px; }
.totals div { display: flex; justify-content: space-between; margin: 2px 0; gap: 8px; }
.grand-total { font-size: 13px; font-weight: 700; }
.payment-qr { text-align: center; margin: 8px 0; }
.qr-image { width: 28mm; height: 28mm; object-fit: contain; }
.qr-logo { max-width: 32mm; max-height: 8mm; object-fit: contain; display: block; margin: 2px auto 0; }
.note, .footer { text-align: center; font-size: 10px; margin-top: 6px; }
`;

const commonSheetCss = `
@page { size: A5; margin: 8mm; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #111; font-family: Arial, sans-serif; font-size: 12px; }
.print-template { width: 100%; padding: 0; }
.store-header { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #d1d5db; padding-bottom: 8px; margin-bottom: 10px; }
.store-logo { width: 22mm; height: 18mm; object-fit: contain; }
.store-name { font-size: 18px; font-weight: 700; text-transform: uppercase; }
.store-meta { font-size: 11px; line-height: 1.4; }
h1 { margin: 10px 0; text-align: center; font-size: 18px; }
.two-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin-bottom: 10px; }
.items-table { width: 100%; border-collapse: collapse; }
.items-table th, .items-table td { border: 1px solid #d1d5db; padding: 6px; vertical-align: top; }
.items-table th { background: #f3f4f6; }
.product-image { width: 12mm; height: 12mm; object-fit: cover; border-radius: 2px; }
.text-center { text-align: center; }
.text-right { text-align: right; }
.totals { margin-top: 10px; display: flex; justify-content: flex-end; }
.totals div { min-width: 58mm; display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
.signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 28mm; margin-top: 18mm; text-align: center; }
.signatures span { display: block; margin-top: 4px; font-size: 11px; color: #4b5563; }
`;

const saleA4InvoiceHtml = `
<div class="print-template sale-a4-html sale-invoice">
  <div class="sale-a4-brand-row">
    <div>
      <div class="sale-a4-store-name">{store_name}</div>
      <div class="sale-a4-store-meta">Địa chỉ: {store_address}</div>
      <div class="sale-a4-store-meta">ĐT: {store_phone} - MST: {store_tax_code}</div>
    </div>
    <div class="sale-a4-order-block">
      <span>Mã đơn hàng</span>
      <strong>{order_code}</strong>
    </div>
    <div class="sale-a4-title-block">
      <div>HOÁ ĐƠN</div>
      <div>BÁN HÀNG</div>
    </div>
  </div>

  <div class="sale-a4-customer">
    <div>
      <div><span>KHÁCH HÀNG:</span> <strong>{customer_name}</strong></div>
      <div><span>Địa chỉ:</span> {customer_address}</div>
    </div>
    <div>
      <div><span>Điện thoại:</span> {customer_phone}</div>
      <div><span>Email:</span> {customer_email}</div>
    </div>
  </div>

  <table class="items-table sale-a4-items">
    <thead>
      <tr>
        <th>STT</th>
        <th>Tên sản phẩm</th>
        <th>Đơn vị</th>
        <th>Số lượng</th>
        <th>Đơn giá</th>
        <th>Chiết khấu</th>
        <th>Thành tiền</th>
      </tr>
    </thead>
    <tbody>
      {{#items}}
      <tr>
        <td class="text-center">{index}</td>
        <td>{name}</td>
        <td class="text-center">{unit}</td>
        <td class="text-right">{quantity}</td>
        <td class="text-right">{price}</td>
        <td class="text-right">{discount}</td>
        <td class="text-right">{line_total}</td>
      </tr>
      {{/items}}
    </tbody>
  </table>

  <div class="sale-a4-totals">
    <div><span>THÀNH TIỀN</span><strong>{subtotal}</strong></div>
    <div><span>CHIẾT KHẤU</span><strong>{discount}</strong></div>
    <div><span>TỔNG</span><strong>{total}</strong></div>
    <div><span>NỢ CŨ</span><strong>{old_debt}</strong></div>
    <div><span>THÀNH TIỀN</span><strong>{total_amount}</strong></div>
  </div>

  <div class="sale-a4-signature-section">
    <div class="sale-a4-date-note">{store_name}, ngày {invoice_date}</div>
    <div class="sale-a4-signature"><strong>NGƯỜI NHẬN HÀNG.</strong><span>(Ký, ghi rõ họ tên)</span></div>
    <div class="sale-a4-signature"><strong>NGƯỜI VIẾT HÓA ĐƠN</strong><span>(Ký, ghi rõ họ tên)</span></div>
  </div>

  <div class="sale-a4-print-footer">
    <span>1/1</span>
  </div>
</div>`.trim();

const saleA4LegacyCss = `
.sale-a4-html { min-height: 277mm; display: flex; flex-direction: column; color: #111; font-family: Arial, Roboto, Helvetica, sans-serif; font-size: 12px; line-height: 1.32; }
.sale-a4-html .sale-a4-brand-row { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(42mm, 0.7fr) minmax(48mm, 0.85fr); gap: 10mm; align-items: start; border-bottom: 1.5px solid #111; padding-bottom: 5mm; margin-bottom: 5mm; }
.sale-a4-html .sale-a4-store-name { font-size: 19px; font-weight: 700; line-height: 1.2; margin-bottom: 2mm; }
.sale-a4-html .sale-a4-store-meta { font-size: 11px; color: #333; }
.sale-a4-html .sale-a4-order-block span { display: block; margin-bottom: 1mm; color: #333; }
.sale-a4-html .sale-a4-order-block strong { display: block; font-size: 17px; }
.sale-a4-html .sale-a4-title-block { text-align: right; font-size: 24px; line-height: 1.08; font-weight: 800; letter-spacing: 0.04em; }
.sale-a4-html .sale-a4-customer { display: grid; grid-template-columns: minmax(0, 1fr) minmax(58mm, 0.72fr); gap: 10mm; margin: 0 0 5mm; }
.sale-a4-html .sale-a4-customer div { margin: 1.2mm 0; }
.sale-a4-html .sale-a4-customer span { font-weight: 700; }
.sale-a4-html .sale-a4-items { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 2mm; }
.sale-a4-html .sale-a4-items th, .sale-a4-html .sale-a4-items td { border: 1px solid #9ca3af; padding: 4px 6px; vertical-align: top; word-break: break-word; }
.sale-a4-html .sale-a4-items th { font-weight: 700; text-align: center; }
.sale-a4-html .sale-a4-totals { width: 76mm; margin: 4mm 0 0 auto; break-inside: avoid; page-break-inside: avoid; }
.sale-a4-html .sale-a4-totals div { display: grid; grid-template-columns: 1fr 34mm; gap: 8mm; padding: 1.2mm 0; border-bottom: 1px solid #e5e7eb; }
.sale-a4-html .sale-a4-totals span, .sale-a4-html .sale-a4-totals strong { font-weight: 700; }
.sale-a4-html .sale-a4-totals strong { text-align: right; }
.sale-a4-html .sale-a4-signature-section { display: grid; grid-template-columns: minmax(0, 1fr) minmax(44mm, 0.72fr) minmax(44mm, 0.72fr); gap: 8mm; align-items: start; margin-top: auto; padding-top: 11mm; break-inside: avoid; page-break-inside: avoid; }
.sale-a4-html .sale-a4-signature { min-height: 31mm; text-align: center; }
.sale-a4-html .sale-a4-signature span { display: block; margin-top: 1mm; font-size: 10px; color: #4b5563; }
.sale-a4-html .sale-a4-print-footer { margin-top: 6mm; padding-top: 2mm; border-top: 1px solid #d1d5db; display: flex; justify-content: flex-end; font-size: 10px; color: #374151; }
@media print { .sale-a4-html tr, .sale-a4-html .sale-a4-totals, .sale-a4-html .sale-a4-signature-section { break-inside: avoid; page-break-inside: avoid; } }
`.trim();

export const DEFAULT_PRINT_TEMPLATES = [
  {
    id: 'fallback-sale_invoice-A4',
    code: 'sale_invoice_a4_frontend',
    name: 'Mẫu mặc định - Đơn bán hàng A4',
    type: 'sale_invoice',
    paper_size: 'A4',
    width_mm: 210,
    is_default: true,
    is_fallback: true,
    active: true,
    html: saleA4InvoiceHtml,
    css: saleA4LegacyCss,
    config: createDefaultInvoiceVisualConfig('sale_invoice', 'A4', 210),
  },
  {
    id: 'fallback-sale_invoice-80mm',
    code: 'sale_invoice_80mm_frontend',
    name: 'Mẫu mặc định - Đơn bán hàng 80mm',
    type: 'sale_invoice',
    paper_size: '80mm',
    width_mm: 80,
    is_default: false,
    is_fallback: true,
    active: true,
    html: `
<div class="print-template sale-invoice">
  <div class="store-header">
    <img class="store-logo" src="{{images.logo}}" alt="Logo cửa hàng" />
    <div class="store-name">{{store.name}}</div>
    <div class="store-meta">{{store.address}}</div>
    <div class="store-meta">ĐT: {{store.phone}} - MST: {{store.tax_code}}</div>
  </div>

  <h1>HÓA ĐƠN BÁN HÀNG</h1>
  <div class="invoice-meta">
    <div>Số: <strong>{{invoice.code}}</strong></div>
    <div>Ngày: {{invoice.created_at}}</div>
    <div>Khách hàng: {{customer.name}}</div>
    <div>Điện thoại: {{customer.phone}}</div>
  </div>

  <table class="items-table">
    <thead>
      <tr><th>#</th><th>Ảnh</th><th>Sản phẩm</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr>
    </thead>
    <tbody>{{items_rows}}</tbody>
  </table>

  <div class="totals">
    <div><span>Tạm tính</span><strong>{{totals.subtotal}}</strong></div>
    <div><span>Giảm giá</span><strong>{{totals.discount}}</strong></div>
    <div><span>Phí giao hàng</span><strong>{{totals.delivery_fee}}</strong></div>
    <div><span>Hình thức TT</span><strong>{{invoice.payment_method}}</strong></div>
    <div class="grand-total"><span>Tổng cộng</span><strong>{{totals.total}}</strong></div>
    <div><span>Tiền khách đưa</span><strong>{{totals.paid}}</strong></div>
    <div><span>Tiền thừa</span><strong>{{totals.change}}</strong></div>
    <div><span>Còn phải trả</span><strong>{{totals.remaining}}</strong></div>
    <div><span>Ghi chú</span><strong>{{invoice.note}}</strong></div>
  </div>

  <div class="payment-qr">
    <img class="qr-image" src="{{images.qr}}" alt="QR thanh toán" />
  </div>
  <div class="note">{{store.invoice_note}}</div>
  <div class="footer">{{store.invoice_slogan}}</div>
</div>`.trim(),
    css: commonReceiptCss.trim(),
    config: createDefaultInvoiceVisualConfig('sale_invoice', '80mm', 80),
  },
  {
    id: 'fallback-temporary_bill-80mm',
    code: 'temporary_bill_80mm_frontend',
    name: 'Mẫu mặc định - Phiếu tạm tính 80mm',
    type: 'temporary_bill',
    paper_size: '80mm',
    width_mm: 80,
    is_default: true,
    is_fallback: true,
    active: true,
    html: `
<div class="print-template temporary-bill">
  <div class="store-header">
    <div class="store-name">{{store.name}}</div>
    <div class="store-meta">{{store.address}}</div>
    <div class="store-meta">ĐT: {{store.phone}}</div>
  </div>

  <h1>PHIẾU TẠM TÍNH</h1>
  <div class="invoice-meta">
    <div>Mã phiếu: <strong>{{invoice.code}}</strong></div>
    <div>Ngày: {{invoice.created_at}}</div>
    <div>Khách hàng: {{customer.name}}</div>
  </div>

  <table class="items-table">
    <thead>
      <tr><th>#</th><th>Ảnh</th><th>Mặt hàng</th><th>SL</th><th>Giá</th><th>Tiền</th></tr>
    </thead>
    <tbody>{{items_rows}}</tbody>
  </table>

  <div class="totals">
    <div class="grand-total"><span>Tổng tạm tính</span><strong>{{totals.total}}</strong></div>
  </div>
  <div class="note">Phiếu chưa phải hóa đơn thanh toán</div>
</div>`.trim(),
    css: commonReceiptCss.trim(),
    config: createDefaultInvoiceVisualConfig('temporary_bill', '80mm', 80),
  },
  {
    id: 'fallback-return_invoice-A5',
    code: 'return_invoice_a5_frontend',
    name: 'Mẫu mặc định - Đơn trả hàng A5',
    type: 'return_invoice',
    paper_size: 'A5',
    width_mm: 148,
    is_default: true,
    is_fallback: true,
    active: true,
    html: `
<div class="print-template return-invoice">
  <div class="store-header">
    <img class="store-logo" src="{{images.logo}}" alt="Logo cửa hàng" />
    <div>
      <div class="store-name">{{store.name}}</div>
      <div class="store-meta">{{store.address}}</div>
      <div class="store-meta">ĐT: {{store.phone}} - MST: {{store.tax_code}}</div>
    </div>
  </div>

  <h1>PHIẾU TRẢ HÀNG</h1>
  <div class="invoice-meta two-cols">
    <div>Số phiếu: <strong>{{return.code}}</strong></div>
    <div>Ngày: {{return.created_at}}</div>
    <div>Khách hàng/NCC: {{partner.name}}</div>
    <div>Điện thoại: {{partner.phone}}</div>
  </div>

  <table class="items-table">
    <thead>
      <tr><th>#</th><th>Ảnh</th><th>Sản phẩm</th><th>SL trả</th><th>Đơn giá</th><th>Thành tiền</th><th>Lý do</th></tr>
    </thead>
    <tbody>{{items_rows}}</tbody>
  </table>

  <div class="totals">
    <div><span>Tổng tiền hoàn/trừ</span><strong>{{return.total}}</strong></div>
  </div>

  <div class="signatures">
    <div><strong>Người lập phiếu</strong><span>Ký, ghi rõ họ tên</span></div>
    <div><strong>Người nhận</strong><span>Ký, ghi rõ họ tên</span></div>
  </div>
</div>`.trim(),
    css: commonSheetCss.trim(),
    config: createDefaultInvoiceVisualConfig('return_invoice', 'A5', 148),
  },
];

function cloneTemplate(template) {
  return {
    ...template,
    html: template.html || '',
    css: template.css || '',
    config: cloneInvoiceVisualConfig(template.config),
  };
}

export function getPaperWidth(paperSize) {
  const option = PAPER_SIZE_OPTIONS.find(item => item.value === paperSize);
  return option?.widthMm || inferPaperWidthMm(paperSize, 80);
}

export function getTemplateTypeLabel(type) {
  return PRINT_TEMPLATE_TYPES.find(item => item.value === type)?.label || type || 'Mẫu in';
}

export function getFallbackTemplates(type) {
  const filtered = DEFAULT_PRINT_TEMPLATES.filter(template => !type || template.type === type).map(cloneTemplate);
  if (filtered.length > 0) return filtered;
  return DEFAULT_PRINT_TEMPLATES.map(cloneTemplate);
}

export function getDefaultTemplate(type = 'sale_invoice', paperSize = 'A4') {
  const exact = DEFAULT_PRINT_TEMPLATES.find(template => template.type === type && template.paper_size === paperSize);
  const sameType = DEFAULT_PRINT_TEMPLATES.find(template => template.type === type);
  const base = exact || sameType || DEFAULT_PRINT_TEMPLATES[0];
  const cloned = cloneTemplate(base);
  const widthMm = getPaperWidth(paperSize);
  const isDifferentPaperFallback = !exact && cloned.paper_size && cloned.paper_size !== paperSize;
  return {
    ...cloned,
    id: `fallback-${type}-${paperSize}`,
    name: `Mẫu mặc định - ${getTemplateTypeLabel(type)} ${paperSize}`,
    type,
    paper_size: paperSize,
    width_mm: widthMm,
    html: isDifferentPaperFallback ? '' : cloned.html,
    css: isDifferentPaperFallback ? '' : cloned.css,
    config: createDefaultInvoiceVisualConfig(type, paperSize, widthMm),
    is_default: false,
    is_fallback: true,
  };
}

export function normalizeTemplateRecord(template, fallbackType = 'sale_invoice', fallbackPaperSize = '80mm') {
  const paperSize = template?.paper_size || template?.paperSize || fallbackPaperSize;
  return {
    id: template?.id || `local-${Date.now()}`,
    code: template?.code || '',
    name: template?.name || `Mẫu in ${paperSize}`,
    type: template?.type || fallbackType,
    paper_size: paperSize,
    width_mm: Number(template?.width_mm || template?.widthMm) || getPaperWidth(paperSize),
    html: template?.html || '',
    css: template?.css || '',
    config: cloneInvoiceVisualConfig(template?.config || template?.visual_config || template?.visualConfig),
    is_default: template?.is_default === true || template?.is_default === 1,
    active: template?.active !== false && template?.active !== 0,
    is_fallback: template?.is_fallback === true,
    created_at: template?.created_at || '',
    updated_at: template?.updated_at || '',
  };
}
