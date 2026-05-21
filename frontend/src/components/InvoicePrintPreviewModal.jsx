import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  FileText,
  Printer,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { getPreviewFrameSize } from '../utils/invoiceTemplateRenderer';
import { printInvoice, renderInvoicePrintDocument, writePrintWindowMessage } from '../utils/printInvoice';

const PRINTER_OPTIONS = [
  'Canon LBP2900',
  'HP LaserJet Pro',
  'Microsoft Print to PDF',
];

const PAGE_OPTIONS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'first', label: 'Trang đầu tiên' },
  { value: 'custom', label: 'Tùy chỉnh' },
];

const LAYOUT_OPTIONS = [
  { value: 'portrait', label: 'Dọc' },
  { value: 'landscape', label: 'Ngang' },
];

const MARGIN_OPTIONS = [
  { value: 'default', label: 'Mặc định' },
  { value: 'narrow', label: 'Hẹp' },
  { value: 'wide', label: 'Rộng' },
];

function getPaperSizeLabel(rendered, template) {
  return rendered?.paperSize || template?.paper_size || template?.paperSize || 'A4';
}

function getWidthMmLabel(rendered, template) {
  return Number(rendered?.widthMm || template?.width_mm || template?.widthMm || 210) || 210;
}

function formatCopies(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 1) return 1;
  return Math.min(99, Math.round(numberValue));
}

export default function InvoicePrintPreviewModal({
  open,
  data,
  template,
  title = 'Xem trước phiếu in',
  subtitle = '',
  loading = false,
  error = '',
  onBack,
  onClose,
  onPrinted,
}) {
  const [printing, setPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState('');
  const [copies, setCopies] = useState(1);
  const [selectedPrinter, setSelectedPrinter] = useState(PRINTER_OPTIONS[0]);
  const [pageMode, setPageMode] = useState('all');
  const [layout, setLayout] = useState('portrait');
  const [margins, setMargins] = useState('default');
  const [scalePercent, setScalePercent] = useState(100);
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [printBackground, setPrintBackground] = useState(true);
  const [showHeadersFooters, setShowHeadersFooters] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPrinting(false);
    setPrintStatus('');
    setCopies(1);
    setPageMode('all');
    setLayout('portrait');
    setMargins('default');
    setScalePercent(100);
    setShowAdvanced(true);
    setPrintBackground(true);
    setShowHeadersFooters(false);
    setSelectedPrinter(PRINTER_OPTIONS[0]);
  }, [open, title, template]);

  const renderResult = useMemo(() => {
    if (!open || loading || error || !data || !template) return { rendered: null, error: '' };
    try {
      return {
        rendered: renderInvoicePrintDocument({ data, template, title }),
        error: '',
      };
    } catch (err) {
      return {
        rendered: null,
        error: err.message || 'Không thể dựng nội dung xem trước.',
      };
    }
  }, [data, error, loading, open, template, title]);

  const rendered = renderResult.rendered;
  const renderError = error || renderResult.error;

  const frameSize = useMemo(() => {
    if (!rendered) return { width: 820, minHeight: 560 };
    return getPreviewFrameSize(rendered.paperSize, rendered.widthMm);
  }, [rendered]);

  const previewScale = Math.max(0.6, Math.min(1.4, scalePercent / 100));
  const scaledFrameWidth = Math.max(320, Math.round(frameSize.width * previewScale));
  const scaledFrameHeight = Math.max(420, Math.round(frameSize.minHeight * previewScale));
  const effectivePaperSize = getPaperSizeLabel(rendered, template);
  const effectiveWidthMm = getWidthMmLabel(rendered, template);
  const itemCount = Array.isArray(data?.items) ? data.items.length : 0;

  const handleConfirmPrint = () => {
    if (!data || !template || renderError || loading) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setPrintStatus('Trình duyệt đã chặn cửa sổ in. Vui lòng cho phép popup và thử lại.');
      return;
    }

    setPrinting(true);
    setPrintStatus(`Đang gửi lệnh in tới ${selectedPrinter}...`);
    try {
      writePrintWindowMessage(printWindow, {
        title: 'Đang chuẩn bị in',
        message: 'Đang dựng nội dung phiếu in từ bản xem trước...',
      });
      const printed = printInvoice({
        data,
        template,
        title,
        targetWindow: printWindow,
      });
      setPrintStatus(`Đã gửi nội dung sang hộp thoại in (${formatCopies(copies)} bản).`);
      onPrinted?.(printed);
    } catch (err) {
      writePrintWindowMessage(printWindow, {
        title: 'Không thể in',
        message: err.message || 'Không thể render nội dung in. Vui lòng thử lại.',
        tone: 'error',
      });
      setPrintStatus(err.message || 'Không thể in.');
    } finally {
      setPrinting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/70 backdrop-blur-sm">
      <div className="flex h-full w-full items-stretch justify-center p-0 lg:p-4">
        <div className="flex h-full w-full max-w-[1600px] overflow-hidden bg-white shadow-2xl lg:rounded-[2rem] border border-slate-200">
          <div className="flex min-w-0 flex-1 flex-col bg-[#eef2f7]">
            <div className="border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:px-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-slate-900">
                    <Printer size={18} className="text-blue-600" />
                    <h2 className="truncate text-base font-bold lg:text-lg">{title}</h2>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 lg:text-sm">
                    {subtitle || 'Xem trước hóa đơn trước khi mở hộp thoại in của hệ điều hành.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {onBack && (
                    <button
                      type="button"
                      onClick={onBack}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      <ArrowLeft size={16} /> Quay lại
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                  >
                    <X size={16} /> Đóng
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmPrint}
                    disabled={loading || Boolean(renderError) || printing}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    <Printer size={16} /> {printing ? 'Đang in...' : 'In ngay'}
                  </button>
                </div>
              </div>

              {(loading || renderError || printStatus) && (
                <div className="mt-3 space-y-2">
                  {loading && (
                    <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-700">
                      <RefreshCw size={16} className="animate-spin" /> Đang tải mẫu in và dựng bản xem trước...
                    </div>
                  )}
                  {renderError && (
                    <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                      <AlertCircle size={16} /> {renderError}
                    </div>
                  )}
                  {printStatus && !renderError && (
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      <CheckCircle2 size={16} /> {printStatus}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-slate-200 bg-[#edf1f6] lg:border-b-0 lg:border-r">
                <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:px-6">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Bản xem trước</div>
                    <div className="mt-1 text-sm font-semibold text-slate-700">
                      {effectivePaperSize} · {effectiveWidthMm}mm · {itemCount} dòng hàng
                    </div>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                    Thu phóng {scalePercent}%
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
                  {rendered ? (
                    <div className="mx-auto flex min-h-full min-w-fit items-start justify-center">
                      <div
                        className="rounded-[1.75rem] border border-slate-300 bg-white p-4 shadow-[0_28px_80px_rgba(15,23,42,0.16)]"
                        style={{ width: `${scaledFrameWidth + 32}px` }}
                      >
                        <div className="mb-3 flex items-center justify-between text-[11px] text-slate-400">
                          <span>{title}</span>
                          <span>Preview</span>
                        </div>
                        <iframe
                          title="invoice-print-preview"
                          srcDoc={rendered.documentHtml}
                          sandbox="allow-same-origin"
                          className="block rounded-xl border border-slate-200 bg-white shadow-inner"
                          style={{
                            width: `${scaledFrameWidth}px`,
                            minHeight: `${scaledFrameHeight}px`,
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-[420px] items-center justify-center rounded-[1.5rem] border border-dashed border-slate-300 bg-white/80 text-sm text-slate-500">
                      {loading ? 'Đang chuẩn bị bản xem trước...' : 'Chưa có nội dung xem trước.'}
                    </div>
                  )}
                </div>
              </div>

              <aside className="w-full shrink-0 bg-white lg:w-[430px] xl:w-[470px]">
                <div className="flex h-full flex-col">
                  <div className="border-b border-slate-200 px-4 py-4 lg:px-5">
                    <div className="flex items-center gap-2 text-slate-900">
                      <Settings2 size={18} className="text-slate-600" />
                      <h3 className="text-base font-bold">Thiết lập in</h3>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Mô phỏng giao diện thiết lập in để người dùng kiểm tra nội dung trước khi mở hộp thoại in hệ điều hành.
                    </p>
                  </div>

                  <div className="min-h-0 flex-1 space-y-5 overflow-auto px-4 py-4 lg:px-5">
                    <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Máy in</div>
                          <div className="mt-1 text-sm font-semibold text-slate-700">Sẵn sàng in</div>
                        </div>
                        <div className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">1 tác vụ</div>
                      </div>

                      <label className="block text-sm">
                        <span className="mb-1.5 block text-xs font-medium text-slate-500">Máy in đích</span>
                        <div className="relative">
                          <select
                            value={selectedPrinter}
                            onChange={(event) => setSelectedPrinter(event.target.value)}
                            className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-10 text-sm text-slate-700 outline-none transition focus:border-blue-400"
                          >
                            {PRINTER_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                          </select>
                          <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        </div>
                      </label>

                      <div className="grid grid-cols-2 gap-3">
                        <label className="block text-sm">
                          <span className="mb-1.5 block text-xs font-medium text-slate-500">Trang</span>
                          <div className="relative">
                            <select
                              value={pageMode}
                              onChange={(event) => setPageMode(event.target.value)}
                              className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-10 text-sm text-slate-700 outline-none transition focus:border-blue-400"
                            >
                              {PAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                            <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          </div>
                        </label>
                        <label className="block text-sm">
                          <span className="mb-1.5 block text-xs font-medium text-slate-500">Bản sao</span>
                          <input
                            type="number"
                            min="1"
                            max="99"
                            value={copies}
                            onChange={(event) => setCopies(formatCopies(event.target.value))}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-400"
                          />
                        </label>
                      </div>
                    </section>

                    <section className="rounded-2xl border border-slate-200 bg-white p-4">
                      <button
                        type="button"
                        onClick={() => setShowAdvanced(prev => !prev)}
                        className="flex w-full items-center justify-between gap-3 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <SlidersHorizontal size={17} className="text-slate-500" />
                          <div>
                            <div className="text-sm font-semibold text-slate-800">Chế độ cài đặt khác</div>
                            <div className="text-xs text-slate-500">Tỷ lệ, lề, bố cục và nền in</div>
                          </div>
                        </div>
                        <ChevronDown size={18} className={`text-slate-400 transition ${showAdvanced ? 'rotate-180' : ''}`} />
                      </button>

                      {showAdvanced && (
                        <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                          <div className="grid grid-cols-2 gap-3">
                            <label className="block text-sm">
                              <span className="mb-1.5 block text-xs font-medium text-slate-500">Khổ giấy</span>
                              <input
                                type="text"
                                value={effectivePaperSize}
                                readOnly
                                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none"
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1.5 block text-xs font-medium text-slate-500">Số trang mỗi mặt</span>
                              <input
                                type="text"
                                value="1"
                                readOnly
                                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 outline-none"
                              />
                            </label>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <label className="block text-sm">
                              <span className="mb-1.5 block text-xs font-medium text-slate-500">Bố cục</span>
                              <div className="relative">
                                <select
                                  value={layout}
                                  onChange={(event) => setLayout(event.target.value)}
                                  className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-10 text-sm text-slate-700 outline-none transition focus:border-blue-400"
                                >
                                  {LAYOUT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                                <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                              </div>
                            </label>
                            <label className="block text-sm">
                              <span className="mb-1.5 block text-xs font-medium text-slate-500">Lề</span>
                              <div className="relative">
                                <select
                                  value={margins}
                                  onChange={(event) => setMargins(event.target.value)}
                                  className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-10 text-sm text-slate-700 outline-none transition focus:border-blue-400"
                                >
                                  {MARGIN_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                                <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                              </div>
                            </label>
                          </div>

                          <label className="block text-sm">
                            <span className="mb-1.5 block text-xs font-medium text-slate-500">Tỷ lệ thu phóng</span>
                            <div className="space-y-2">
                              <input
                                type="range"
                                min="70"
                                max="140"
                                step="5"
                                value={scalePercent}
                                onChange={(event) => setScalePercent(Number(event.target.value) || 100)}
                                className="w-full accent-blue-600"
                              />
                              <div className="flex items-center justify-between text-[11px] text-slate-400">
                                <span>70%</span>
                                <span className="font-semibold text-slate-600">{scalePercent}%</span>
                                <span>140%</span>
                              </div>
                            </div>
                          </label>

                          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                            <label className="flex items-start gap-3 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={printBackground}
                                onChange={(event) => setPrintBackground(event.target.checked)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span>
                                <span className="block font-medium">In nền đồ họa</span>
                                <span className="block text-xs text-slate-500">Giữ màu nền, logo và các khối nhấn của hóa đơn.</span>
                              </span>
                            </label>
                            <label className="flex items-start gap-3 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={showHeadersFooters}
                                onChange={(event) => setShowHeadersFooters(event.target.checked)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span>
                                <span className="block font-medium">Hiện đầu trang và chân trang</span>
                                <span className="block text-xs text-slate-500">Tùy chọn mô phỏng; hộp thoại in hệ thống có thể ghi đè thiết lập này.</span>
                              </span>
                            </label>
                          </div>
                        </div>
                      )}
                    </section>

                    <section className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center gap-2 text-slate-800">
                        <FileText size={17} className="text-slate-500" />
                        <div className="text-sm font-semibold">Tóm tắt đơn in</div>
                      </div>
                      <div className="mt-4 space-y-3 text-sm text-slate-700">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-slate-400">Mã đơn</div>
                            <div className="mt-1 font-semibold text-slate-800">{data?.invoice?.invoice_code || data?.invoice?.code || '—'}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-slate-400">Khách hàng</div>
                            <div className="mt-1 font-semibold text-slate-800">{data?.customer?.name || 'Khách lẻ'}</div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-slate-400">Số mặt hàng</div>
                            <div className="mt-1 font-semibold text-slate-800">{itemCount}</div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-wide text-slate-400">Tổng thanh toán</div>
                            <div className="mt-1 font-semibold text-blue-700">{data?.totals?.total || data?.invoice?.total || '—'}</div>
                          </div>
                        </div>
                        <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-3 text-xs text-blue-700">
                          Sau khi bấm <strong>In ngay</strong>, ứng dụng sẽ mở hộp thoại in mặc định của trình duyệt/hệ điều hành. Các mục trong panel này giúp người dùng kiểm tra nhanh trước khi gửi lệnh in.
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
