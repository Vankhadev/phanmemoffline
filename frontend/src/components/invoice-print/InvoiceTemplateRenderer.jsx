import { forwardRef, useMemo } from 'react';
import { getPaperDimensions, normalizeTemplateSettings } from './templateDefaults';
import { getActiveEditorDocument, getTableStyleElement, TABLE_COLUMN_LABELS } from './editor/templateSchemaAdapter';
import { resolveBackendAssetUrl } from '../../utils/apiClient';

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatQuantity(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(number);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '—');
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '—');
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

function isRenderableImage(value) {
  return /^(data:image\/|https?:\/\/|blob:|file:|\/static\/|\.\/|\/)/i.test(String(value || '').trim());
}

function resolveAssetUrl(value) {
  const text = String(value || '').trim();
  return text ? resolveBackendAssetUrl(text) : '';
}

function isStyleEnabled(style = {}, key, fallback = true) {
  if (!Object.prototype.hasOwnProperty.call(style || {}, key)) return fallback;
  return style[key] !== false && style[key] !== 0 && style[key] !== '0' && style[key] !== 'false';
}

function getItemName(item = {}) {
  return item.name || item.product_name || item.productName || item.variant_name || 'Sản phẩm';
}

function getItemUnit(item = {}) {
  return item.unit || item.unit_name || item.uom || item.product_unit || '';
}

function getItemDiscount(item = {}) {
  const amount = Number(item.discount_amount ?? item.discount ?? 0) || 0;
  const percent = Number(item.discount_percent ?? 0) || 0;
  if (amount > 0 && percent > 0) return `${formatVND(amount)} (${formatQuantity(percent)}%)`;
  if (amount > 0) return formatVND(amount);
  if (percent > 0) return `${formatQuantity(percent)}%`;
  return '—';
}

function getItemValue(item = {}, key, index = 0) {
  switch (key) {
    case 'no': return index + 1;
    case 'name': return getItemName(item);
    case 'sku': return item.sku || item.product_sku || '—';
    case 'unit': return getItemUnit(item) || '—';
    case 'qty':
    case 'quantity': return formatQuantity(item.quantity);
    case 'unitPrice': return formatVND(item.unit_price ?? item.price);
    case 'discount': return getItemDiscount(item);
    case 'lineTotal': return formatVND(item.line_total ?? item.total);
    case 'note': return item.note || '—';
    default: return '—';
  }
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
}

function formatFooterTemplate(text, data) {
  const metadata = data.metadata || {};
  const invoice = data.invoice || {};
  const printedAt = metadata.printed_at || new Date().toISOString();
  return String(text || 'Cảm ơn quý khách! · In lúc {time} {date}')
    .replace(/\{time\}/g, formatTime(printedAt))
    .replace(/\{date\}/g, formatDate(printedAt))
    .replace(/\{invoiceCode\}/g, invoice.invoice_code || invoice.code || invoice.id || '')
    .replace(/\{customerName\}/g, data.customer?.name || 'Khách lẻ')
    .replace(/\{storeName\}/g, data.store?.name || 'Cửa hàng');
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function toMoneyNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function mergeStore(payloadStore = {}, template = {}, settings = {}, logoPreviewUrl = '') {
  const store = safeObject(payloadStore);
  return {
    ...store,
    name: firstNonEmpty(store.name, store.store_name, store.company_name, settings.storeName, template.shop_name, 'Cửa hàng'),
    address: firstNonEmpty(store.address, store.store_address, settings.storeAddress, template.shop_address),
    phone: firstNonEmpty(store.phone, store.hotline, store.tel, settings.storePhone, template.shop_phone),
    email: firstNonEmpty(store.email),
    tax_code: firstNonEmpty(store.tax_code, store.mst),
    logo_url: resolveAssetUrl(logoPreviewUrl || store.logo_url || store.logo || store.logo_base64 || template.logo?.url || template.logo_url || template.logo_url_resolved || template.header_logo || ''),
  };
}

function normalizePrintItem(item = {}, index = 0) {
  const quantity = toMoneyNumber(item.quantity ?? item.qty, 0);
  const unitPrice = toMoneyNumber(item.unit_price ?? item.price, 0);
  const discountAmount = toMoneyNumber(item.discount_amount ?? item.discount, 0);
  const explicitLineTotal = Number(item.line_total ?? item.total ?? item.lineTotal);
  return {
    ...item,
    id: item.id || item.product_id || item.variant_id || item.combo_id || `item-${index}`,
    no: item.no || index + 1,
    sku: firstNonEmpty(item.sku, item.product_sku, item.variant_sku),
    name: firstNonEmpty(item.name, item.product_name, item.productName, item.variant_name, item.combo_name, item.sku, 'Sản phẩm'),
    unit: firstNonEmpty(item.unit, item.unit_name, item.uom, item.product_unit),
    quantity,
    unit_price: unitPrice,
    discount_amount: discountAmount,
    discount_percent: toMoneyNumber(item.discount_percent, 0),
    line_total: Number.isFinite(explicitLineTotal) ? explicitLineTotal : Math.max(0, quantity * unitPrice - discountAmount),
    note: firstNonEmpty(item.note),
  };
}

function normalizePayload(payload = {}, template = {}, settings = {}, logoPreviewUrl = '') {
  const source = safeObject(payload);
  const invoice = safeObject(source.invoice);
  const metadata = safeObject(source.metadata);
  const customer = safeObject(source.customer);
  const totalsSource = safeObject(source.totals);
  const paymentSource = safeObject(source.payment);
  const createdAt = invoice.created_at || invoice.createdAt || source.created_at || metadata.created_at || metadata.printed_at || new Date().toISOString();
  const items = (safeArray(source.items).length ? safeArray(source.items) : safeArray(source.details)).map(normalizePrintItem);
  const subtotal = Number.isFinite(Number(totalsSource.subtotal))
    ? toMoneyNumber(totalsSource.subtotal)
    : items.reduce((sum, item) => sum + toMoneyNumber(item.line_total), 0);
  const total = toMoneyNumber(totalsSource.total ?? totalsSource.grand_total ?? invoice.total, subtotal);
  const paidAmount = toMoneyNumber(paymentSource.paid_amount ?? totalsSource.paid_amount ?? invoice.paid_amount, 0);
  const remainingAmount = toMoneyNumber(paymentSource.remaining_amount ?? totalsSource.remaining_amount ?? invoice.remaining_amount, Math.max(0, total - paidAmount));
  const changeAmount = toMoneyNumber(paymentSource.change_amount ?? totalsSource.change_amount ?? invoice.change_amount, Math.max(0, paidAmount - total));
  const userName = firstNonEmpty(metadata.user_name, metadata.created_by_user_name, invoice.user_name, invoice.invoice_writer, invoice.created_by_name);

  return {
    store: mergeStore(source.store, template, settings, logoPreviewUrl),
    customer: {
      ...customer,
      name: firstNonEmpty(customer.name, invoice.customer_name, 'Khách lẻ'),
      phone: firstNonEmpty(customer.phone, invoice.customer_phone),
      address: firstNonEmpty(customer.address, invoice.customer_address),
      tax_code: firstNonEmpty(customer.tax_code, invoice.customer_tax_code),
    },
    invoice: { ...invoice, created_at: createdAt, note: firstNonEmpty(invoice.note, source.note) },
    items,
    totals: {
      ...totalsSource,
      subtotal,
      total,
      vat_percent: toMoneyNumber(totalsSource.vat_percent ?? invoice.vat_percent, 0),
      vat_amount: toMoneyNumber(totalsSource.vat_amount ?? invoice.vat_amount, 0),
      discount_percent: toMoneyNumber(totalsSource.discount_percent ?? invoice.discount_percent, 0),
      discount_amount: toMoneyNumber(totalsSource.discount_amount ?? invoice.discount_amount, 0),
      delivery_fee: toMoneyNumber(totalsSource.delivery_fee ?? invoice.delivery_fee, 0),
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      change_amount: changeAmount,
    },
    payment: {
      ...paymentSource,
      paid_amount: paidAmount,
      remaining_amount: remainingAmount,
      change_amount: changeAmount,
      method_label: firstNonEmpty(paymentSource.method_label, paymentSource.payment_method_label, invoice.payment_method),
    },
    signatures: safeObject(source.signatures),
    metadata: { ...metadata, user_name: userName },
  };
}

function InfoPair({ label, value, strong = false }) {
  if (!value && value !== 0) return null;
  return (
    <div className="invoice-template-info-pair">
      <span>{label}</span>
      <b className={strong ? 'invoice-template-strong' : ''}>{value}</b>
    </div>
  );
}

function MoneyLine({ label, value, highlight = false, negative = false, hiddenWhenZero = false }) {
  const amount = Number(value) || 0;
  if (hiddenWhenZero && amount === 0) return null;
  return (
    <div className={`invoice-template-money-line ${highlight ? 'invoice-template-money-total' : ''}`}>
      <span>{label}</span>
      <b>{negative && amount > 0 ? '-' : ''}{formatVND(amount)}</b>
    </div>
  );
}

function getInvoiceTotalAmount(totals = {}) {
  return Number(totals.total ?? totals.grand_total ?? totals.subtotal ?? totals.total_before_discount ?? 0) || 0;
}

function getOldDebtAmount(totals = {}, customer = {}, invoice = {}) {
  return Number(
    totals.old_debt
    ?? totals.previous_debt
    ?? totals.previous_debt_amount
    ?? totals.customer_old_debt
    ?? totals.opening_debt
    ?? customer.old_debt
    ?? customer.previous_debt
    ?? invoice.old_debt
    ?? 0,
  ) || 0;
}

function getPayableAmount(totals = {}, customer = {}, invoice = {}) {
  const total = getInvoiceTotalAmount(totals);
  const oldDebt = getOldDebtAmount(totals, customer, invoice);
  return Number(totals.payable_amount ?? totals.amount_due ?? totals.final_amount ?? totals.total_payable ?? invoice.payable_amount ?? (total + oldDebt)) || 0;
}

function getCssFontFamily(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'serif') return 'Georgia, Times New Roman, serif';
  if (key === 'mono' || key === 'monospace') return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
}

function StoreLogo({ store, visible, widthMm, heightMm, style = {} }) {
  if (!visible) return null;
  const logo = String(store.logo_url || '').trim();
  return (
    <div
      className="invoice-template-logo"
      style={{
        width: `${widthMm}mm`,
        height: `${heightMm}mm`,
        flexBasis: `${widthMm}mm`,
        borderRadius: style.borderRadiusMm !== undefined ? `${style.borderRadiusMm}mm` : undefined,
        opacity: style.opacity ?? undefined,
        padding: style.paddingMm !== undefined ? `${style.paddingMm}mm` : undefined,
        borderWidth: style.borderWidthMm !== undefined ? `${style.borderWidthMm}mm` : undefined,
        borderColor: style.borderColor || undefined,
        background: style.backgroundColor || undefined,
        '--invoice-logo-object-fit': style.objectFit || 'contain',
      }}
    >
      {logo && isRenderableImage(logo) ? (
        <img src={logo} alt="Logo cửa hàng" crossOrigin="anonymous" />
      ) : (
        <span>{String(store.name || 'POS').slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  );
}

function PaymentQr() {
  return null;
}

function getElementCssStyle(element = {}, extra = {}) {
  const style = element.style || {};
  return {
    color: style.color || undefined,
    textAlign: style.align || undefined,
    fontSize: style.fontSizePt ? `${style.fontSizePt}pt` : undefined,
    lineHeight: style.lineHeight || undefined,
    fontWeight: style.bold ? 800 : undefined,
    fontFamily: style.fontFamily ? getCssFontFamily(style.fontFamily) : undefined,
    opacity: style.opacity ?? undefined,
    padding: style.paddingMm !== undefined ? `${style.paddingMm}mm` : undefined,
    borderRadius: style.borderRadiusMm !== undefined ? `${style.borderRadiusMm}mm` : undefined,
    border: style.borderWidthMm ? `${style.borderWidthMm}mm solid ${style.borderColor || '#cbd5e1'}` : undefined,
    background: style.backgroundColor || undefined,
    objectFit: style.objectFit || undefined,
    gap: style.spacingMm !== undefined ? `${style.spacingMm}mm` : undefined,
    boxSizing: 'border-box',
    ...extra,
  };
}

function V2Element({ element, data, template }) {
  const style = element.style || {};
  const store = data.store;
  const invoice = data.invoice;
  const customer = data.customer;
  const totals = data.totals;
  const signatures = data.signatures;
  const metadata = data.metadata;
  const invoiceCode = invoice.invoice_code || invoice.code || invoice.id || '—';

  if (element.type === 'logo') {
    return <StoreLogo store={store} visible={element.visible !== false} widthMm={element.frame.w} heightMm={element.frame.h} style={style} />;
  }

  if (element.type === 'storeInfo') {
    return (
      <div className="invoice-template-v2-text-block" style={getElementCssStyle(element)}>
        {isStyleEnabled(style, 'showStoreName') && <h2>{store.name || template.shop_name || 'Cửa hàng'}</h2>}
        {isStyleEnabled(style, 'showStoreAddress') && store.address && <p>{store.address}</p>}
        {isStyleEnabled(style, 'showStorePhone') && store.phone && <p>{style.storePhoneLabel || 'ĐT'}: {store.phone}</p>}
        {isStyleEnabled(style, 'showStoreEmail') && store.email && <p>Email: {store.email}</p>}
        {isStyleEnabled(style, 'showStoreTaxCode') && store.tax_code && <p>MST: {store.tax_code}</p>}
      </div>
    );
  }

  if (element.type === 'invoiceTitle') {
    return (
      <div className="invoice-template-v2-title" style={getElementCssStyle(element)}>
        {isStyleEnabled(style, 'showTitle') && <h1>{style.titleText || 'HÓA ĐƠN'}</h1>}
        {isStyleEnabled(style, 'showSubtitle') && <h2>{style.subtitleText || 'BÁN HÀNG'}</h2>}
        {isStyleEnabled(style, 'showInvoiceCode') && <div>{invoiceCode}</div>}
      </div>
    );
  }

  if (element.type === 'customerInfo') {
    return (
      <div className="invoice-template-v2-pairs" style={getElementCssStyle(element)}>
        {isStyleEnabled(style, 'showCustomerName') && <InfoPair label={style.customerNameLabel || 'Khách'} value={customer.name || 'Khách lẻ'} strong />}
        {isStyleEnabled(style, 'showCustomerPhone') && <InfoPair label={style.customerPhoneLabel || 'SĐT'} value={customer.phone} />}
        {isStyleEnabled(style, 'showCustomerAddress') && <InfoPair label={style.customerAddressLabel || 'Địa chỉ'} value={customer.address} />}
        {isStyleEnabled(style, 'showCustomerTaxCode') && <InfoPair label={style.customerTaxCodeLabel || 'MST'} value={customer.tax_code} />}
        {isStyleEnabled(style, 'showCustomerType', false) && <InfoPair label={style.customerTypeLabel || 'Loại khách'} value={customer.customer_type} />}
      </div>
    );
  }

  if (element.type === 'invoiceMeta') {
    return (
      <div className="invoice-template-v2-pairs" style={getElementCssStyle(element)}>
        {isStyleEnabled(style, 'showOrderCode') && <InfoPair label={style.orderCodeLabel || 'Mã đơn'} value={invoiceCode} strong />}
        {isStyleEnabled(style, 'showOrderDate') && <InfoPair label={style.orderDateLabel || 'Ngày'} value={formatDateTime(invoice.created_at)} />}
        {isStyleEnabled(style, 'showSeller') && <InfoPair label={style.sellerLabelShort || 'NV'} value={metadata.user_name} />}
        {isStyleEnabled(style, 'showOrderSource', false) && <InfoPair label={style.orderSourceLabel || 'Nguồn'} value={invoice.source} />}
      </div>
    );
  }

  if (element.type === 'paymentQr') return null;

  if (element.type === 'totals') {
    const paidAmount = Number(totals.paid_amount ?? totals.paid ?? 0) || 0;
    const remainingAmount = Number(totals.remaining_amount ?? totals.debt_amount ?? Math.max(0, (Number(totals.total) || 0) - paidAmount)) || 0;
    return (
      <div className="invoice-template-v2-totals" style={getElementCssStyle(element)}>
        <MoneyLine label="Tổng tiền hàng" value={totals.subtotal ?? totals.total_before_discount ?? totals.total} />
        <MoneyLine label={`VAT (${Number(totals.vat_percent) || 0}%)`} value={totals.vat_amount} hiddenWhenZero />
        <MoneyLine label="Chiết khấu" value={totals.discount_amount} negative hiddenWhenZero />
        <MoneyLine label="Phí giao hàng" value={totals.delivery_fee} hiddenWhenZero />
        <MoneyLine label="Tổng tiền" value={totals.total ?? totals.grand_total} highlight />
        <MoneyLine label="Đã thanh toán" value={paidAmount} hiddenWhenZero />
        <MoneyLine label="Công nợ" value={remainingAmount} hiddenWhenZero />
        <MoneyLine label="Tiền thừa" value={totals.change_amount} hiddenWhenZero />
      </div>
    );
  }

  if (element.type === 'note') {
    if (!invoice.note) return null;
    return <div className="invoice-template-v2-note" style={getElementCssStyle(element)}><b>Ghi chú:</b> {invoice.note}</div>;
  }

  if (element.type === 'signatures') {
    return (
      <div className="invoice-template-v2-signatures" style={getElementCssStyle(element, { '--invoice-signature-gap': `${style.signatureGapMm || 10}mm`, '--invoice-signature-blank': `${style.blankHeightMm || 10}mm` })}>
        <div>
          <h3>{style.buyerLabel || signatures.buyer?.label || 'Khách hàng'}</h3>
          <p>{style.buyerHint || '(Ký và ghi rõ họ tên)'}</p>
          <b>{signatures.buyer?.name || customer.name || ''}</b>
        </div>
        <div>
          <h3>{style.sellerLabel || signatures.seller?.label || 'Người bán'}</h3>
          <p>{style.sellerHint || '(Ký và ghi rõ họ tên)'}</p>
          <b>{signatures.seller?.name || metadata.user_name || ''}</b>
        </div>
      </div>
    );
  }

  if (element.type === 'footerText') {
    return <div className="invoice-template-v2-footer-text" style={getElementCssStyle(element)}>{formatFooterTemplate(style.text, data)}</div>;
  }

  if (element.type === 'line' || element.type === 'separator') {
    return <div className="invoice-template-v2-line" style={{ borderTop: `${style.borderWidthMm || 0.25}mm solid ${style.color || style.borderColor || '#cbd5e1'}`, opacity: style.opacity ?? 1 }} />;
  }

  if (element.type === 'rectangle') {
    return <div className="invoice-template-v2-rectangle" style={getElementCssStyle(element)} />;
  }

  if (element.type === 'image') {
    return style.src && isRenderableImage(style.src)
      ? <img className="invoice-template-v2-image" src={resolveAssetUrl(style.src)} alt="Ảnh" crossOrigin="anonymous" style={getElementCssStyle(element)} />
      : null;
  }

  return <div className="invoice-template-v2-custom-text" style={getElementCssStyle(element)}>{style.text || ''}</div>;
}

function V2ItemsTable({ document, data }) {
  const table = document.table || {};
  const zonesById = new Map((document.zones || []).map(zone => [zone.id, zone]));
  const zone = zonesById.get(table.zoneId) || (document.zones || [])[0] || { frame: { x: 0, y: 0, w: 100 } };
  const frame = table.frame || { x: 0, y: 0, w: zone.frame?.w || 100 };
  const tableStyleElement = getTableStyleElement(document) || {};
  const tableStyle = tableStyleElement.style || {};
  const columns = Array.isArray(table.columns) && table.columns.length ? table.columns : [];
  const items = data.items || [];

  return (
    <section
      className="invoice-template-v2-table-wrap"
      style={{
        '--invoice-v2-table-left': `${Number(zone.frame?.x || 0) + Number(frame.x || 0)}mm`,
        '--invoice-v2-table-top': `${Number(zone.frame?.y || 0) + Number(frame.y || 0)}mm`,
        left: `${Number(zone.frame?.x || 0) + Number(frame.x || 0)}mm`,
        top: `${Number(zone.frame?.y || 0) + Number(frame.y || 0)}mm`,
        width: `${Number(frame.w || zone.frame?.w || 100)}mm`,
        '--invoice-v2-table-border-width': `${tableStyle.tableBorder === false ? 0 : (tableStyle.borderWidthMm ?? 0.22)}mm`,
        '--invoice-v2-table-border-color': tableStyle.borderColor || document.theme?.borderColor || '#cbd5e1',
        '--invoice-v2-table-header-bg': tableStyle.headerBackgroundColor || '#e2e8f0',
        '--invoice-v2-table-header-color': tableStyle.headerColor || '#0f172a',
        '--invoice-v2-table-padding': `${tableStyle.paddingMm ?? 1.35}mm`,
        '--invoice-v2-table-font-size': `${tableStyle.fontSizePt ?? 8.2}pt`,
        '--invoice-v2-table-header-font-size': `${tableStyle.headerFontSizePt ?? 7.6}pt`,
        '--invoice-v2-table-line-height': tableStyle.lineHeight ?? 1.18,
      }}
    >
      <table className="invoice-template-v2-table">
        <colgroup>
          {columns.map(column => <col key={column.key} style={{ width: `${column.widthMm}mm` }} />)}
        </colgroup>
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column.key} style={{ width: `${column.widthMm}mm`, textAlign: column.align }}>
                {column.label || TABLE_COLUMN_LABELS[column.key] || column.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={`${item.id || item.product_id || item.sku || 'item'}-${index}`}>
              {columns.map(column => (
                <td key={column.key} style={{ textAlign: column.align }}>
                  <div className={column.key === 'name' ? 'invoice-template-item-name' : ''}>{getItemValue(item, column.key, index)}</div>
                  {column.key === 'name' && (item.sku || item.note) && (
                    <div className="invoice-template-item-meta">
                      {item.sku && <span>SKU: {item.sku}</span>}
                      {item.note && <span>{item.note}</span>}
                    </div>
                  )}
                </td>
              ))}
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={Math.max(1, columns.length)} className="invoice-template-empty-row">Không có sản phẩm trong hóa đơn.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function V2Renderer({ refProp, payload, template, settingsOverride = {}, logoPreviewUrl, className, printScale, previewZoom, renderMode }) {
  const preferDraft = renderMode === 'editor-preview' || renderMode === 'draft-preview' || renderMode === 'draft';
  const active = useMemo(() => getActiveEditorDocument(template, { preferDraft }), [preferDraft, template]);
  const document = active.document;
  const page = getPaperDimensions(settingsOverride.paperSize || settingsOverride.paper_size || document.canvas.pageSize, settingsOverride.orientation || document.canvas.orientation);
  const editorZoom = Number(active.settings?.editor?.zoom) || 1;
  const scale = Number.isFinite(Number(printScale)) ? Number(printScale) : 1;
  const zoom = Number.isFinite(Number(previewZoom)) ? Number(previewZoom) : editorZoom;
  const previewScale = renderMode === 'print' ? 1 : zoom;
  const normalized = useMemo(() => normalizePayload(payload, template, {}, logoPreviewUrl), [logoPreviewUrl, payload, template]);
  const zonesById = useMemo(() => new Map((document.zones || []).map(zone => [zone.id, zone])), [document.zones]);
  const elements = useMemo(() => [...(document.elements || [])]
    .filter(element => element.visible !== false && element.id !== '__itemsTableStyle' && element.type !== 'paymentQr')
    .sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0)), [document.elements]);
  const contentHeightMm = useMemo(() => {
    const elementBottom = elements.reduce((max, element) => {
      const zone = zonesById.get(element.zoneId) || { frame: { y: 0 } };
      const frame = element.frame || {};
      return Math.max(max, Number(zone.frame?.y || 0) + Number(frame.y || 0) + Number(frame.h || 0));
    }, page.height);
    const table = document.table || {};
    const tableZone = zonesById.get(table.zoneId) || { frame: { y: 0 } };
    const tableFrame = table.frame || {};
    const tableStyle = getTableStyleElement(document)?.style || {};
    const estimatedRowMm = Math.max(4.8, (Number(tableStyle.fontSizePt) || 8.2) * 0.48 * (Number(tableStyle.lineHeight) || 1.18) + (Number(tableStyle.paddingMm ?? 1.35) * 2));
    const estimatedTableMm = 7 + Math.max(1, normalized.items.length) * estimatedRowMm;
    const tableBottom = Number(tableZone.frame?.y || 0) + Number(tableFrame.y || 0) + (tableFrame.h === 'auto' ? estimatedTableMm : Math.max(Number(tableFrame.h) || 0, estimatedTableMm));
    return Math.ceil(Math.max(page.height, elementBottom, tableBottom + 6));
  }, [document, elements, normalized.items.length, page.height, zonesById]);

  return (
    <article
      ref={refProp}
      className={`invoice-paper invoice-print invoice-print-${page.paperSize.toLowerCase()} invoice-print-${page.orientation} invoice-print-v2 ${className}`.trim()}
      style={{
        '--invoice-page-width': `${page.width}mm`,
        '--invoice-page-height': `${page.height}mm`,
        '--invoice-content-height': `${contentHeightMm}mm`,
        '--invoice-physical-page-height': `${page.height}mm`,
        '--invoice-paper-padding': '0mm',
        '--invoice-paper-margin': '0mm',
        '--invoice-font-size': '9pt',
        '--invoice-line-height': 1.3,
        '--invoice-print-scale': scale,
        '--invoice-preview-scale': previewScale,
        '--invoice-theme-primary': document.theme?.primaryColor || '#111827',
        '--invoice-theme-muted': document.theme?.mutedColor || '#64748b',
        '--invoice-theme-border': document.theme?.borderColor || '#cbd5e1',
      }}
      data-paper-size={page.paperSize}
      data-orientation={page.orientation}
      data-template-schema="2"
    >
      <div className="invoice-print-inner invoice-template-v2-document">
        {elements.map(element => {
          const zone = zonesById.get(element.zoneId) || { frame: { x: 0, y: 0 } };
          const frame = element.frame || {};
          return (
            <section
              key={element.id}
              className={`invoice-template-v2-element invoice-template-v2-element-${element.type}`}
              style={{
                left: `${Number(zone.frame?.x || 0) + Number(frame.x || 0)}mm`,
                top: `${Number(zone.frame?.y || 0) + Number(frame.y || 0)}mm`,
                width: `${Number(frame.w || 1)}mm`,
                minHeight: `${Number(frame.h || 1)}mm`,
                maxHeight: element.type === 'logo' || element.type === 'image' || element.type === 'rectangle' || element.type === 'line' ? `${Number(frame.h || 1)}mm` : undefined,
                overflow: element.type === 'logo' || element.type === 'image' || element.type === 'rectangle' || element.type === 'line' ? 'hidden' : 'visible',
                zIndex: Number(element.zIndex) || 0,
              }}
            >
              <V2Element element={element} data={normalized} template={template} />
            </section>
          );
        })}
        <V2ItemsTable document={document} data={normalized} />
      </div>
    </article>
  );
}

function LegacyRenderer({ refProp, payload, template, settingsOverride, logoPreviewUrl, className, printScale, previewZoom, renderMode }) {
  const templateSource = template || {};
  const settings = useMemo(
    () => normalizeTemplateSettings({
      ...templateSource,
      settings_json: {
        ...(templateSource.settings_json || templateSource.settings || {}),
        ...settingsOverride,
      },
      paper_size: settingsOverride.paperSize || settingsOverride.paper_size || templateSource.paper_size,
      orientation: settingsOverride.orientation || templateSource.orientation,
    }),
    [settingsOverride, templateSource],
  );

  const normalized = useMemo(
    () => normalizePayload(payload, templateSource, settings, logoPreviewUrl),
    [payload, templateSource, settings, logoPreviewUrl],
  );

  const page = getPaperDimensions(settings.paperSize, settings.orientation);
  const scale = Number.isFinite(Number(printScale)) ? Number(printScale) : settings.scale;
  const zoom = Number.isFinite(Number(previewZoom)) ? Number(previewZoom) : settings.previewZoom;
  const previewScale = renderMode === 'print' ? 1 : zoom;
  const store = normalized.store;
  const invoice = normalized.invoice;
  const customer = normalized.customer;
  const items = normalized.items;
  const totals = normalized.totals;
  const signatures = normalized.signatures;
  const metadata = normalized.metadata;
  const lineHeight = settings.lineSpacing;
  const tableBorderWidth = settings.tableBorder ? settings.tableBorderWidthMm : 0;
  const invoiceTotalAmount = getInvoiceTotalAmount(totals);
  const oldDebtAmount = getOldDebtAmount(totals, customer, invoice);
  const payableAmount = getPayableAmount(totals, customer, invoice);
  const printedAt = metadata.printed_at || new Date().toISOString();

  return (
    <article
      ref={refProp}
      className={`invoice-paper invoice-print invoice-print-${page.paperSize.toLowerCase()} invoice-print-${page.orientation} ${className}`.trim()}
      style={{
        '--invoice-page-width': `${page.width}mm`,
        '--invoice-page-height': `${page.height}mm`,
        '--invoice-paper-padding': `${settings.paddingMm}mm`,
        '--invoice-paper-margin': `${settings.marginMm}mm`,
        '--invoice-font-size': `${settings.fontSize}pt`,
        '--invoice-line-height': lineHeight,
        '--invoice-print-scale': scale,
        '--invoice-preview-scale': previewScale,
        '--invoice-table-width': `${settings.tableWidthPercent}%`,
        '--invoice-table-border-width': `${tableBorderWidth}mm`,
      }}
      data-paper-size={page.paperSize}
      data-orientation={page.orientation}
    >
      <div className="invoice-print-inner">
        <header className="invoice-template-header">
          <div className="invoice-template-store-row">
            <StoreLogo store={store} visible={settings.showLogo} widthMm={settings.headerLogoWidthMm} heightMm={settings.headerLogoHeightMm} />
            <div className="invoice-template-store-text">
              <h2>{store.name || 'Cửa hàng'}</h2>
              {store.address && <p>{store.address}</p>}
              {store.phone && <p>ĐT: {store.phone}</p>}
            </div>
          </div>
          <div className="invoice-template-title-block">
            <h1>HÓA ĐƠN BÁN HÀNG</h1>
          </div>
          <section className="invoice-template-meta-grid">
            <InfoPair label="Mã đơn" value={invoice.invoice_code || invoice.code || invoice.id || '—'} strong />
            <InfoPair label="Ngày giờ" value={formatDateTime(invoice.created_at)} />
            <InfoPair label="Khách hàng" value={customer.name || 'Khách lẻ'} strong />
            <InfoPair label="SĐT" value={customer.phone || '—'} />
            <div className="invoice-template-meta-address">
              <InfoPair label="Địa chỉ" value={customer.address || '—'} />
            </div>
          </section>
        </header>

        <section className="invoice-template-table-wrap">
          <table className="invoice-template-table">
            <thead>
              <tr>
                <th className="invoice-template-col-no">STT</th>
                <th className="invoice-template-col-name">Tên sản phẩm</th>
                <th className="invoice-template-col-unit">Đơn vị</th>
                <th className="invoice-template-col-qty">Số lượng</th>
                <th className="invoice-template-col-price">Đơn giá</th>
                <th className="invoice-template-col-discount">Chiết khấu</th>
                <th className="invoice-template-col-total">Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${item.id || item.product_id || item.sku || 'item'}-${index}`}>
                  <td className="invoice-template-col-no">{index + 1}</td>
                  <td className="invoice-template-col-name">
                    <div className="invoice-template-item-name">{getItemName(item)}</div>
                    {(item.sku || item.note) && (
                      <div className="invoice-template-item-meta">
                        {item.sku && <span>SKU: {item.sku}</span>}
                        {item.note && <span>{item.note}</span>}
                      </div>
                    )}
                  </td>
                  <td className="invoice-template-col-unit">{getItemUnit(item) || '—'}</td>
                  <td className="invoice-template-col-qty">{formatQuantity(item.quantity)}</td>
                  <td className="invoice-template-col-price">{formatVND(item.unit_price ?? item.price)}</td>
                  <td className="invoice-template-col-discount">{getItemDiscount(item)}</td>
                  <td className="invoice-template-col-total">{formatVND(item.line_total ?? item.total)}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="invoice-template-empty-row">Không có sản phẩm trong hóa đơn.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {settings.showNote && invoice.note && (
          <section className="invoice-template-note">
            <b>Ghi chú:</b> {invoice.note}
          </section>
        )}

        <footer className="invoice-template-footer-block">
          <div className="invoice-template-footer-totals">
            <MoneyLine label="Tổng tiền hàng" value={totals.subtotal ?? invoiceTotalAmount} />
            <MoneyLine label="Giảm giá" value={totals.discount_amount} negative hiddenWhenZero />
            <MoneyLine label="Khách thanh toán" value={totals.paid_amount} hiddenWhenZero />
            <MoneyLine label="Tiền thừa" value={totals.change_amount} hiddenWhenZero />
            <MoneyLine label="Còn nợ" value={totals.remaining_amount} hiddenWhenZero />
            {oldDebtAmount > 0 && <MoneyLine label="Nợ cũ" value={oldDebtAmount} />}
            <MoneyLine label="Thành tiền" value={payableAmount} highlight />
          </div>

          {settings.showSignature && (
            <div className="invoice-template-signatures">
              <div>
                <h3>{signatures.buyer?.label || 'Người nhận hàng'}</h3>
                <p>(Ký và ghi rõ họ tên)</p>
                <b>{signatures.buyer?.name || customer.name || ''}</b>
              </div>
              <div>
                <h3>{signatures.seller?.label || 'Người viết hóa đơn'}</h3>
                <p>(Ký và ghi rõ họ tên)</p>
                <b>{signatures.seller?.name || metadata.user_name || ''}</b>
              </div>
            </div>
          )}

          <div className="invoice-template-footer-note">
            <span>Cảm ơn quý khách!</span>
            <span>In lúc: {formatTime(printedAt)} {formatDate(printedAt)}</span>
          </div>
        </footer>
      </div>
    </article>
  );
}

function hasEditorDocument(template = {}) {
  if (template?.editor_document?.published?.layout_json || template?.editor_document?.draft?.layout_json) return true;
  if (template?.layout_v2 || Number(template?.template_schema_version || template?.schema_version) >= 2) return true;
  return Number(template?.layout_json?.schema_version || template?.layout?.schema_version) === 2;
}

const InvoiceTemplateRenderer = forwardRef(function InvoiceTemplateRenderer({
  payload = {},
  template = null,
  settingsOverride = {},
  logoPreviewUrl = '',
  className = '',
  printScale = null,
  previewZoom = null,
  renderMode = 'preview',
}, ref) {
  const templateSource = template || {};
  const shouldUseEditorRenderer = hasEditorDocument(templateSource);
  if (shouldUseEditorRenderer) {
    return (
      <V2Renderer
        refProp={ref}
        payload={payload}
        template={templateSource}
        settingsOverride={settingsOverride}
        logoPreviewUrl={logoPreviewUrl}
        className={className}
        printScale={printScale}
        previewZoom={previewZoom}
        renderMode={renderMode}
      />
    );
  }

  return (
    <LegacyRenderer
      refProp={ref}
      payload={payload}
      template={templateSource}
      settingsOverride={settingsOverride}
      logoPreviewUrl={logoPreviewUrl}
      className={className}
      printScale={printScale}
      previewZoom={previewZoom}
      renderMode={renderMode}
    />
  );
});

export function buildInvoicePageStyle(template = {}, settingsOverride = {}) {
  const settings = normalizeTemplateSettings({
    ...template,
    settings_json: {
      ...(template?.settings_json || template?.settings || {}),
      ...settingsOverride,
    },
    paper_size: settingsOverride.paperSize || settingsOverride.paper_size || template?.paper_size,
    orientation: settingsOverride.orientation || template?.orientation,
  });
  const page = getPaperDimensions(settings.paperSize, settings.orientation);
  const pageSize = page.paperSize.startsWith('K') ? `${page.width}mm ${page.height}mm` : `${page.paperSize} ${page.orientation}`;
  const safePadding = page.paperSize.startsWith('K') ? Math.min(settings.paddingMm, 3) : Math.min(settings.paddingMm, page.paperSize === 'A5' ? 5 : 10);
  const minHeightRule = page.paperSize.startsWith('K') ? 'auto' : `${page.height}mm`;
  return `
    @page { size: ${pageSize}; margin: 0; }
    @media print {
      html,
      body,
      #root {
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
        overflow: visible !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      #root > div,
      #root > div > div,
      .app-main-scroll,
      .invoice-print-page,
      .invoice-preview-shell,
      .invoice-print-preview-frame {
        display: block !important;
        width: auto !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        background: #fff !important;
        box-shadow: none !important;
      }
      #root aside,
      #root nav,
      .no-print,
      .invoice-print-toolbar,
      .invoice-alert,
      .invoice-state-card,
      .invoice-toolbar-actions,
      .invoice-control-group,
      button {
        display: none !important;
      }
      .invoice-paper,
      .invoice-print {
        width: ${page.width}mm !important;
        min-width: ${page.width}mm !important;
        max-width: ${page.width}mm !important;
        height: ${page.paperSize.startsWith('K') ? 'auto' : `${page.height}mm`} !important;
        min-height: ${minHeightRule} !important;
        max-height: none !important;
        margin: 0 auto !important;
        border: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        overflow: visible !important;
        transform: none !important;
        background: #fff !important;
      }
      .invoice-print-inner {
        width: ${page.width}mm !important;
        min-height: ${minHeightRule} !important;
        transform: scale(var(--invoice-print-scale, 1)) !important;
        transform-origin: top center !important;
        padding: ${safePadding}mm !important;
        overflow: visible !important;
        background: #fff !important;
        box-sizing: border-box !important;
      }
    }
  `;
}

export default InvoiceTemplateRenderer;
