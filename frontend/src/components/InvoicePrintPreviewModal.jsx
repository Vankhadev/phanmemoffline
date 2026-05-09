import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Printer, RefreshCw, X } from 'lucide-react';
import { getPreviewFrameSize } from '../utils/invoiceTemplateRenderer';
import { printInvoice, renderInvoicePrintDocument, writePrintWindowMessage } from '../utils/printInvoice';

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

  useEffect(() => {
    if (!open) return;
    setPrinting(false);
    setPrintStatus('');
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

  const handleConfirmPrint = () => {
    if (!data || !template || renderError || loading) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setPrintStatus('Trình duyệt đã chặn cửa sổ in. Vui lòng cho phép popup và thử lại.');
      return;
    }

    setPrinting(true);
    setPrintStatus('Đang mở hộp thoại in...');
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
      setPrintStatus('Đã gửi nội dung sang hộp thoại in của trình duyệt.');
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[94vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Printer size={20} className="text-blue-600" /> {title}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {subtitle || 'Kiểm tra nội dung phiếu trước khi xác nhận in.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="px-3 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-medium flex items-center gap-2"
              >
                <ArrowLeft size={16} /> Quay lại
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-medium flex items-center gap-2"
            >
              <X size={16} /> Đóng
            </button>
            <button
              type="button"
              onClick={handleConfirmPrint}
              disabled={loading || Boolean(renderError) || printing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-bold flex items-center gap-2"
            >
              <Printer size={16} /> {printing ? 'Đang in...' : 'In'}
            </button>
          </div>
        </div>

        {(loading || renderError || printStatus) && (
          <div className="px-5 pt-4 space-y-2">
            {loading && (
              <div className="px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm flex items-center gap-2">
                <RefreshCw size={16} className="animate-spin" /> Đang tải mẫu in và dựng bản xem trước...
              </div>
            )}
            {renderError && (
              <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm flex items-center gap-2">
                <AlertCircle size={16} /> {renderError}
              </div>
            )}
            {printStatus && !renderError && (
              <div className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm flex items-center gap-2">
                <Printer size={16} /> {printStatus}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-auto bg-slate-200 p-4">
          {rendered ? (
            <div className="mx-auto" style={{ width: `${frameSize.width}px`, maxWidth: '100%' }}>
              <iframe
                title="invoice-print-preview"
                srcDoc={rendered.documentHtml}
                sandbox="allow-same-origin"
                className="bg-white border border-slate-300 rounded-lg shadow-xl"
                style={{
                  width: `${frameSize.width}px`,
                  maxWidth: '100%',
                  minHeight: `${frameSize.minHeight}px`,
                }}
              />
            </div>
          ) : (
            <div className="min-h-[420px] flex items-center justify-center text-slate-500 text-sm">
              {loading ? 'Đang chuẩn bị bản xem trước...' : 'Chưa có nội dung xem trước.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
