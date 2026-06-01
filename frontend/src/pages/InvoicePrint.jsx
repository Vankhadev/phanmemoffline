import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { ArrowLeft, Download, Loader, Printer, RefreshCw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { getApiErrorMessage, invoicesApi } from '../utils/apiClient';

const PRINT_SETTINGS_KEY = 'kha.invoicePrintA5.settings';
const SCALE_PRESETS = [0.8, 0.9, 1, 1.1, 1.2];
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.4;
const SCALE_STEP = 0.1;

const PAGE_DIMENSIONS = {
  portrait: { width: 148, height: 210, label: 'Dọc A5' },
  landscape: { width: 210, height: 148, label: 'Ngang A5' },
};

function clamp(value, min, max) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return min;
  return Math.min(max, Math.max(min, numericValue));
}

function normalizeScale(value) {
  return Math.round(clamp(value, MIN_SCALE, MAX_SCALE) * 100) / 100;
}

function readPrintSettings() {
  if (typeof window === 'undefined') return { scale: 1, orientation: 'portrait' };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PRINT_SETTINGS_KEY) || '{}');
    return {
      scale: normalizeScale(parsed.scale || 1),
      orientation: parsed.orientation === 'landscape' ? 'landscape' : 'portrait',
    };
  } catch (_error) {
    return { scale: 1, orientation: 'portrait' };
  }
}

function writePrintSettings(settings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(settings));
  } catch (_error) {
    // Bỏ qua nếu trình duyệt khóa localStorage.
  }
}

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatQuantity(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(number);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sanitizeFileName(value) {
  return String(value || 'hoa-don')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'hoa-don';
}

function isRenderableImage(value) {
  return /^(data:image\/|https?:\/\/|blob:|file:)/i.test(String(value || '').trim());
}

function getErrorMessage(error, fallback) {
  return getApiErrorMessage(error?.data, error?.message || fallback);
}

function InfoLine({ label, value, strong = false }) {
  if (!value) return null;
  return (
    <div className="invoice-info-line">
      <span>{label}</span>
      <b className={strong ? 'invoice-strong' : ''}>{value}</b>
    </div>
  );
}

function MoneyLine({ label, value, highlight = false, negative = false }) {
  if (!value && value !== 0) return null;
  const amount = Number(value) || 0;
  if (!highlight && amount === 0 && negative) return null;
  return (
    <div className={`invoice-money-line ${highlight ? 'invoice-money-total' : ''}`}>
      <span>{label}</span>
      <b>{negative && amount > 0 ? '-' : ''}{formatVND(amount)}</b>
    </div>
  );
}

export default function InvoicePrint() {
  const navigate = useNavigate();
  const { idOrCode = '' } = useParams();
  const [searchParams] = useSearchParams();
  const autoPrint = searchParams.get('print') === '1';
  const printRef = useRef(null);
  const autoPrintedRef = useRef(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [printError, setPrintError] = useState('');
  const [settings, setSettings] = useState(() => readPrintSettings());

  const page = PAGE_DIMENSIONS[settings.orientation] || PAGE_DIMENSIONS.portrait;
  const invoiceCode = data?.invoice?.invoice_code || idOrCode || 'hoa-don';
  const scalePercent = Math.round(settings.scale * 100);

  useEffect(() => {
    writePrintSettings(settings);
  }, [settings]);

  const loadInvoice = useCallback(async () => {
    if (!idOrCode) {
      setError('Thiếu mã hoặc ID hóa đơn.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    setPrintError('');
    try {
      const payload = await invoicesApi.printData(idOrCode);
      setData(payload);
    } catch (err) {
      setData(null);
      setError(getErrorMessage(err, 'Không thể tải dữ liệu hóa đơn.'));
    } finally {
      setLoading(false);
    }
  }, [idOrCode]);

  useEffect(() => {
    autoPrintedRef.current = false;
    loadInvoice();
  }, [loadInvoice]);

  const pageStyle = useMemo(() => `
    @page { size: A5 ${settings.orientation}; margin: 0; }
    html, body {
      width: ${page.width}mm !important;
      min-height: ${page.height}mm !important;
      height: auto !important;
      margin: 0 auto !important;
      padding: 0 !important;
      background: #fff !important;
      overflow: visible !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .invoice-a5-sheet {
      width: ${page.width}mm !important;
      min-height: ${page.height}mm !important;
      margin: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      overflow: visible !important;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .invoice-sheet-inner {
      transform-origin: top left !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
  `, [page.height, page.width, settings.orientation]);

  const handlePrintInvoice = useReactToPrint({
    contentRef: printRef,
    documentTitle: () => `Hoa_don_${sanitizeFileName(invoiceCode)}`,
    pageStyle,
    onPrintError: (_location, err) => {
      setPrintError(err?.message || 'Không thể mở hộp thoại in.');
    },
  });

  useEffect(() => {
    if (!autoPrint || !data || loading || autoPrintedRef.current) return undefined;
    autoPrintedRef.current = true;
    const timer = window.setTimeout(() => handlePrintInvoice(), 350);
    return () => window.clearTimeout(timer);
  }, [autoPrint, data, handlePrintInvoice, loading]);

  const setScale = useCallback((nextScale) => {
    setSettings(prev => ({ ...prev, scale: normalizeScale(nextScale) }));
  }, []);

  const adjustScale = useCallback((delta) => {
    setSettings(prev => ({ ...prev, scale: normalizeScale(prev.scale + delta) }));
  }, []);

  const resetScale = useCallback(() => {
    setSettings(prev => ({ ...prev, scale: 1 }));
  }, []);

  const toggleOrientation = useCallback(() => {
    setSettings(prev => ({ ...prev, orientation: prev.orientation === 'portrait' ? 'landscape' : 'portrait' }));
  }, []);

  const handleDownloadPdf = useCallback(async () => {
    const element = printRef.current;
    if (!element || !data) return;

    setPdfLoading(true);
    setPrintError('');
    try {
      const canvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: Math.max(2, Math.min(3, window.devicePixelRatio || 2)),
        useCORS: true,
        allowTaint: false,
        logging: false,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight,
      });

      const pdf = new jsPDF({ orientation: settings.orientation, unit: 'mm', format: 'a5', compress: true });
      const imgData = canvas.toDataURL('image/png', 1);
      const pdfWidth = page.width;
      const pdfHeight = page.height;
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pdfHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage('a5', settings.orientation);
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight, undefined, 'FAST');
        heightLeft -= pdfHeight;
      }

      pdf.save(`Hoa_don_${sanitizeFileName(invoiceCode)}.pdf`);
    } catch (err) {
      setPrintError(err?.message || 'Không thể tải PDF hóa đơn.');
    } finally {
      setPdfLoading(false);
    }
  }, [data, invoiceCode, page.height, page.width, settings.orientation]);

  const store = data?.store || {};
  const customer = data?.customer || {};
  const invoice = data?.invoice || {};
  const items = data?.items || [];
  const totals = data?.totals || {};
  const payment = data?.payment || {};
  const signatures = data?.signatures || {};
  const metadata = data?.metadata || {};
  const logoVisible = isRenderableImage(store.logo_url);
  const qrVisible = isRenderableImage(payment.qr_image);

  return (
    <div className="invoice-print-page">
      <div className="invoice-print-toolbar no-print">
        <div className="invoice-toolbar-left">
          <button type="button" onClick={() => navigate(-1)} className="invoice-toolbar-btn invoice-toolbar-btn-light">
            <ArrowLeft size={16} /> Quay lại
          </button>
          <div>
            <h1>In hóa đơn A5</h1>
            <p>{invoiceCode ? `Mã/ID: ${invoiceCode}` : 'Preview gọi dữ liệu thật từ API backend'}</p>
          </div>
        </div>

        <div className="invoice-toolbar-actions">
          <label className="invoice-control-group">
            <span>Scale</span>
            <select
              value={SCALE_PRESETS.includes(settings.scale) ? String(settings.scale) : 'custom'}
              onChange={event => {
                if (event.target.value !== 'custom') setScale(Number(event.target.value));
              }}
            >
              {SCALE_PRESETS.map(scale => (
                <option key={scale} value={scale}>{Math.round(scale * 100)}%</option>
              ))}
              <option value="custom">Tùy chỉnh</option>
            </select>
          </label>
          <label className="invoice-control-group invoice-control-number">
            <span>%</span>
            <input
              type="number"
              min={Math.round(MIN_SCALE * 100)}
              max={Math.round(MAX_SCALE * 100)}
              step="5"
              value={scalePercent}
              onChange={event => setScale(Number(event.target.value) / 100)}
            />
          </label>
          <button type="button" onClick={() => adjustScale(-SCALE_STEP)} className="invoice-toolbar-btn invoice-toolbar-btn-light" title="Thu nhỏ">
            <ZoomOut size={16} /> Thu nhỏ
          </button>
          <button type="button" onClick={() => adjustScale(SCALE_STEP)} className="invoice-toolbar-btn invoice-toolbar-btn-light" title="Phóng to">
            <ZoomIn size={16} /> Phóng to
          </button>
          <button type="button" onClick={resetScale} className="invoice-toolbar-btn invoice-toolbar-btn-light">
            Reset 100%
          </button>
          <button type="button" onClick={toggleOrientation} className="invoice-toolbar-btn invoice-toolbar-btn-light">
            <RotateCw size={16} /> {page.label}
          </button>
          <button type="button" onClick={loadInvoice} disabled={loading} className="invoice-toolbar-btn invoice-toolbar-btn-light">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Tải lại
          </button>
          <button type="button" onClick={handleDownloadPdf} disabled={!data || pdfLoading} className="invoice-toolbar-btn invoice-toolbar-btn-secondary">
            {pdfLoading ? <Loader size={16} className="animate-spin" /> : <Download size={16} />} Tải PDF
          </button>
          <button type="button" onClick={handlePrintInvoice} disabled={!data} className="invoice-toolbar-btn invoice-toolbar-btn-primary">
            <Printer size={16} /> In nhanh
          </button>
        </div>
      </div>

      {printError && <div className="invoice-alert no-print">{printError}</div>}

      {loading ? (
        <div className="invoice-state-card no-print">
          <Loader size={28} className="animate-spin text-blue-500" />
          <div>
            <b>Đang tải dữ liệu hóa đơn...</b>
            <p>Preview chỉ hiển thị sau khi API backend trả dữ liệu thật.</p>
          </div>
        </div>
      ) : error ? (
        <div className="invoice-state-card no-print invoice-state-error">
          <b>Không thể mở hóa đơn</b>
          <p>{error}</p>
          <button type="button" onClick={loadInvoice} className="invoice-toolbar-btn invoice-toolbar-btn-primary">
            <RefreshCw size={16} /> Thử lại
          </button>
        </div>
      ) : (
        <main className="invoice-preview-shell">
          <article
            ref={printRef}
            className={`invoice-a5-sheet invoice-a5-${settings.orientation}`}
            style={{
              '--invoice-scale': settings.scale,
              '--invoice-page-width': `${page.width}mm`,
              '--invoice-page-height': `${page.height}mm`,
              width: `${page.width * settings.scale}mm`,
              minHeight: `${page.height * settings.scale}mm`,
            }}
          >
            <div className="invoice-sheet-inner">
              <header className="invoice-header">
                <div className="invoice-store-block">
                  <div className="invoice-logo-box">
                    {logoVisible ? (
                      <img src={store.logo_url} alt="Logo cửa hàng" crossOrigin="anonymous" />
                    ) : (
                      <span>{String(store.name || 'POS').slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="invoice-store-text">
                    <h2>{store.name || 'Cửa hàng'}</h2>
                    {store.address && <p>{store.address}</p>}
                    <div className="invoice-store-meta">
                      {store.phone && <span>ĐT: {store.phone}</span>}
                      {store.email && <span>Email: {store.email}</span>}
                      {store.tax_code && <span>MST: {store.tax_code}</span>}
                    </div>
                  </div>
                </div>
                <div className="invoice-title-block">
                  <h1>HÓA ĐƠN BÁN HÀNG</h1>
                  <div className="invoice-code">{invoice.invoice_code || '—'}</div>
                  <div className="invoice-date">Ngày lập: {formatDateTime(invoice.created_at)}</div>
                </div>
              </header>

              <section className="invoice-info-grid">
                <div className="invoice-info-card">
                  <h3>Thông tin khách hàng</h3>
                  <InfoLine label="Tên khách" value={customer.name || 'Khách lẻ'} strong />
                  <InfoLine label="Điện thoại" value={customer.phone} />
                  <InfoLine label="Địa chỉ" value={customer.address} />
                  <InfoLine label="Mã số thuế" value={customer.tax_code} />
                </div>
                <div className="invoice-info-card">
                  <h3>Thông tin đơn hàng</h3>
                  <InfoLine label="Thanh toán" value={payment.method_label || invoice.payment_method} strong />
                  <InfoLine label="Trạng thái" value={invoice.status} />
                  <InfoLine label="Ngày giao" value={invoice.delivery_date} />
                  <InfoLine label="Người tạo" value={metadata.user_name} />
                </div>
              </section>

              <section className="invoice-items-section">
                <table className="invoice-items-table">
                  <thead>
                    <tr>
                      <th className="invoice-col-no">STT</th>
                      <th>Tên sản phẩm</th>
                      <th className="invoice-col-qty">SL</th>
                      <th className="invoice-col-money">Đơn giá</th>
                      <th className="invoice-col-money">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => (
                      <tr key={`${item.id || item.product_id || item.sku || 'item'}-${index}`}>
                        <td className="invoice-col-no">{index + 1}</td>
                        <td>
                          <div className="invoice-item-name">{item.name || 'Sản phẩm'}</div>
                          {(item.sku || item.unit || item.note) && (
                            <div className="invoice-item-meta">
                              {item.sku && <span>SKU: {item.sku}</span>}
                              {item.unit && <span>ĐVT: {item.unit}</span>}
                              {item.note && <span>{item.note}</span>}
                            </div>
                          )}
                        </td>
                        <td className="invoice-col-qty">{formatQuantity(item.quantity)}</td>
                        <td className="invoice-col-money">{formatVND(item.unit_price)}</td>
                        <td className="invoice-col-money invoice-line-total">{formatVND(item.line_total)}</td>
                      </tr>
                    ))}
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={5} className="invoice-empty-row">Không có sản phẩm trong hóa đơn.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>

              <section className="invoice-summary-grid">
                <div className="invoice-payment-card">
                  <h3>Thanh toán / QR</h3>
                  {qrVisible ? (
                    <img className="invoice-qr-image" src={payment.qr_image} alt="QR thanh toán" crossOrigin="anonymous" />
                  ) : payment.qr_image ? (
                    <div className="invoice-qr-text">{payment.qr_image}</div>
                  ) : (
                    <div className="invoice-qr-placeholder">Không có QR thanh toán</div>
                  )}
                  <div className="invoice-bank-info">
                    {payment.bank_name && <div>Ngân hàng: <b>{payment.bank_name}</b></div>}
                    {payment.bank_account && <div>STK: <b>{payment.bank_account}</b></div>}
                    {payment.bank_account_name && <div>Chủ TK: <b>{payment.bank_account_name}</b></div>}
                    {payment.transfer_content && <div>Nội dung CK: <b>{payment.transfer_content}</b></div>}
                    {payment.qr_text && <div className="invoice-qr-note">{payment.qr_text}</div>}
                  </div>
                </div>

                <div className="invoice-totals-card">
                  <MoneyLine label="Tổng tiền hàng" value={totals.subtotal} />
                  {Number(totals.vat_amount) > 0 && <MoneyLine label={`VAT (${Number(totals.vat_percent) || 0}%)`} value={totals.vat_amount} />}
                  {Number(totals.discount_amount) > 0 && <MoneyLine label="Giảm giá" value={totals.discount_amount} negative />}
                  {Number(totals.delivery_fee) > 0 && <MoneyLine label="Phí giao hàng" value={totals.delivery_fee} />}
                  <MoneyLine label="Thành tiền" value={totals.total} highlight />
                  {Number(totals.paid_amount) > 0 && <MoneyLine label="Đã thanh toán" value={totals.paid_amount} />}
                  {Number(totals.remaining_amount) > 0 && <MoneyLine label="Còn phải trả" value={totals.remaining_amount} />}
                  {Number(totals.change_amount) > 0 && <MoneyLine label="Tiền thừa" value={totals.change_amount} />}
                </div>
              </section>

              {invoice.note && (
                <section className="invoice-note-box">
                  <b>Ghi chú:</b> {invoice.note}
                </section>
              )}

              <section className="invoice-signatures">
                <div>
                  <h3>{signatures.buyer?.label || 'Khách hàng'}</h3>
                  <p>(Ký và ghi rõ họ tên)</p>
                  <b>{signatures.buyer?.name || ''}</b>
                </div>
                <div>
                  <h3>{signatures.seller?.label || 'Người bán'}</h3>
                  <p>(Ký và ghi rõ họ tên)</p>
                  <b>{signatures.seller?.name || ''}</b>
                </div>
              </section>

              <footer className="invoice-footer">
                <span>Cảm ơn quý khách!</span>
                <span>In lúc: {formatDateTime(metadata.printed_at || new Date().toISOString())}</span>
              </footer>
            </div>
          </article>
        </main>
      )}
    </div>
  );
}
