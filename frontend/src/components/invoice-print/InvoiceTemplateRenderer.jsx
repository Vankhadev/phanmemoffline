import { forwardRef, useMemo } from 'react';
import { getPaperDimensions, normalizeTemplateSettings } from './templateDefaults';

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
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function isRenderableImage(value) {
  return /^(data:image\/|https?:\/\/|blob:|file:|\/static\/|\.\/|\/)/i.test(String(value || '').trim());
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

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function mergeStore(payloadStore = {}, template = {}, settings = {}, logoPreviewUrl = '') {
  const store = safeObject(payloadStore);
  return {
    ...store,
    name: settings.storeName || template.shop_name || store.name || 'Cửa hàng',
    address: settings.storeAddress || template.shop_address || store.address || '',
    phone: settings.storePhone || template.shop_phone || store.phone || '',
    logo_url: logoPreviewUrl || template.logo_url || template.logo_url_resolved || template.header_logo || store.logo_url || '',
  };
}

function normalizePayload(payload = {}, template = {}, settings = {}, logoPreviewUrl = '') {
  const source = safeObject(payload);
  const invoice = safeObject(source.invoice);
  const metadata = safeObject(source.metadata);
  const createdAt = invoice.created_at || invoice.createdAt || source.created_at || metadata.printed_at || new Date().toISOString();
  return {
    store: mergeStore(source.store, template, settings, logoPreviewUrl),
    customer: safeObject(source.customer),
    invoice: { ...invoice, created_at: createdAt },
    items: Array.isArray(source.items) ? source.items : Array.isArray(source.details) ? source.details : [],
    totals: safeObject(source.totals),
    payment: safeObject(source.payment),
    signatures: safeObject(source.signatures),
    metadata,
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

function StoreLogo({ store, visible, widthMm, heightMm }) {
  if (!visible) return null;
  const logo = String(store.logo_url || '').trim();
  return (
    <div
      className="invoice-template-logo"
      style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, flexBasis: `${widthMm}mm` }}
    >
      {logo && isRenderableImage(logo) ? (
        <img src={logo} alt="Logo cửa hàng" crossOrigin="anonymous" />
      ) : (
        <span>{String(store.name || 'POS').slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  );
}

function PaymentQr({ payment, visible }) {
  if (!visible) return null;
  const qrImage = String(payment.qr_image || payment.qr || '').trim();
  return (
    <div className="invoice-template-qr-block">
      <div className="invoice-template-section-title">QR thanh toán</div>
      {qrImage && isRenderableImage(qrImage) ? (
        <img className="invoice-template-qr" src={qrImage} alt="QR thanh toán" crossOrigin="anonymous" />
      ) : qrImage ? (
        <div className="invoice-template-qr-text">{qrImage}</div>
      ) : (
        <div className="invoice-template-qr-placeholder">QR thanh toán</div>
      )}
      <div className="invoice-template-bank-info">
        {payment.bank_name && <div>NH: <b>{payment.bank_name}</b></div>}
        {payment.bank_account && <div>STK: <b>{payment.bank_account}</b></div>}
        {payment.bank_account_name && <div>Chủ TK: <b>{payment.bank_account_name}</b></div>}
        {payment.transfer_content && <div>Nội dung: <b>{payment.transfer_content}</b></div>}
        {payment.qr_text && <div>{payment.qr_text}</div>}
      </div>
    </div>
  );
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
  const payment = normalized.payment;
  const signatures = normalized.signatures;
  const metadata = normalized.metadata;
  const lineHeight = settings.lineSpacing;
  const tableBorderWidth = settings.tableBorder ? settings.tableBorderWidthMm : 0;
  const paidAmount = Number(totals.paid_amount ?? totals.paid ?? 0) || 0;
  const remainingAmount = Number(totals.remaining_amount ?? totals.debt_amount ?? Math.max(0, (Number(totals.total) || 0) - paidAmount)) || 0;

  return (
    <article
      ref={ref}
      className={`invoice-print invoice-print-${page.paperSize.toLowerCase()} invoice-print-${page.orientation} ${className}`.trim()}
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
          <section className="invoice-template-header-left">
            <div className="invoice-template-date-box">
              <span>Giờ: <b>{formatTime(invoice.created_at)}</b></span>
              <span>Ngày: <b>{formatDate(invoice.created_at)}</b></span>
            </div>
            <div className="invoice-template-store-row">
              <StoreLogo store={store} visible={settings.showLogo} widthMm={settings.headerLogoWidthMm} heightMm={settings.headerLogoHeightMm} />
              <div className="invoice-template-store-text">
                <h2>{store.name || 'Cửa hàng'}</h2>
                {store.address && <p>{store.address}</p>}
                {store.phone && <p>ĐT: {store.phone}</p>}
              </div>
            </div>
          </section>

          <section className="invoice-template-header-center">
            <div className="invoice-template-section-title">Chi tiết đơn hàng</div>
            <InfoPair label="Mã đơn" value={invoice.invoice_code || invoice.code || invoice.id || '—'} strong />
            <InfoPair label="Khách" value={customer.name || 'Khách lẻ'} strong />
            <InfoPair label="SĐT" value={customer.phone} />
            <InfoPair label="Địa chỉ" value={customer.address} />
            <InfoPair label="Thanh toán" value={payment.method_label || invoice.payment_method} />
          </section>

          <section className="invoice-template-header-right">
            <h1>HÓA ĐƠN</h1>
            <h2>BÁN HÀNG</h2>
            <div className="invoice-template-code-pill">{invoice.invoice_code || invoice.code || '—'}</div>
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

        <section className="invoice-template-summary-row">
          <PaymentQr payment={payment} visible={settings.showQr} />
          <div className="invoice-template-totals">
            <MoneyLine label="Tổng tiền hàng" value={totals.subtotal ?? totals.total_before_discount ?? totals.total} />
            <MoneyLine label={`VAT (${Number(totals.vat_percent) || 0}%)`} value={totals.vat_amount} hiddenWhenZero />
            <MoneyLine label="Chiết khấu" value={totals.discount_amount} negative hiddenWhenZero />
            <MoneyLine label="Phí giao hàng" value={totals.delivery_fee} hiddenWhenZero />
            <MoneyLine label="Tổng tiền" value={totals.total ?? totals.grand_total} highlight />
            <MoneyLine label="Đã thanh toán" value={paidAmount} hiddenWhenZero />
            {settings.showDebt && <MoneyLine label="Công nợ" value={remainingAmount} hiddenWhenZero />}
            <MoneyLine label="Tiền thừa" value={totals.change_amount} hiddenWhenZero />
          </div>
        </section>

        {settings.showNote && invoice.note && (
          <section className="invoice-template-note">
            <b>Ghi chú:</b> {invoice.note}
          </section>
        )}

        {settings.showSignature && (
          <footer className="invoice-template-signatures">
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
          </footer>
        )}

        <div className="invoice-template-footer-note">
          <span>Cảm ơn quý khách!</span>
          <span>In lúc: {formatTime(metadata.printed_at || new Date().toISOString())} {formatDate(metadata.printed_at || new Date().toISOString())}</span>
        </div>
      </div>
    </article>
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
  return `
    @page { size: ${page.paperSize === 'K80' ? `${page.width}mm auto` : `${page.paperSize} ${page.orientation}`}; margin: 0; }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      overflow: visible !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .invoice-print {
      width: ${page.width}mm !important;
      min-height: ${page.height}mm !important;
      margin: 0 auto !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      overflow: visible !important;
      transform: none !important;
    }
    .invoice-print-inner {
      width: ${page.width}mm !important;
      min-height: ${page.height}mm !important;
      transform: none !important;
      padding: ${settings.paddingMm}mm !important;
    }
  `;
}

export default InvoiceTemplateRenderer;
