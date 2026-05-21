import { useMemo, useState } from 'react';
import { Eye, Printer, RefreshCw } from 'lucide-react';
import { isSilentPrintSupported, printHtmlSilently } from '../utils/desktopPrint';
import {
  createSampleInvoiceData,
  getPreviewFrameSize,
  renderInvoiceTemplate,
} from '../utils/invoiceTemplateRenderer';

export default function InvoicePreview({ template, store, type = 'sale_invoice', className = '' }) {
  const [printStatus, setPrintStatus] = useState('');

  const sampleData = useMemo(() => createSampleInvoiceData(type, {
    store: {
      ...(store || {}),
      name: store?.name || 'vankha',
      phone: store?.phone || '0901 234 567',
      email: store?.email || 'shop@example.local',
      address: store?.address || '123 Đường Hoa Mai, Quận 1, TP.HCM',
      tax_code: store?.tax_code || '0312345678',
      invoice_logo: store?.invoice_logo || undefined,
      invoice_note: store?.invoice_note || undefined,
      invoice_slogan: store?.invoice_slogan || undefined,
      invoice_vietqr_logo: store?.invoice_vietqr_logo || undefined,
    },
  }), [store, type]);

  const rendered = useMemo(() => renderInvoiceTemplate(template, {
    sampleData,
    type,
    paperSize: template?.paper_size,
    widthMm: template?.width_mm,
  }), [sampleData, template, type]);

  const frameSize = useMemo(
    () => getPreviewFrameSize(rendered.paperSize, rendered.widthMm),
    [rendered.paperSize, rendered.widthMm]
  );

  const handlePrint = async () => {
    if (isSilentPrintSupported()) {
      setPrintStatus('Đang gửi lệnh in thử trực tiếp...');
      try {
        await printHtmlSilently({
          documentHtml: rendered.documentHtml,
          jobTitle: template?.name || 'In thử mẫu hóa đơn',
          paperSize: rendered.paperSize,
          widthMm: rendered.widthMm,
          heightMm: rendered.paperSize === 'A3' ? 420
            : rendered.paperSize === 'A4' ? 297
            : rendered.paperSize === 'A5' ? 210
            : rendered.paperSize === 'A6' ? 148
            : rendered.paperSize === 'B5' ? 250
            : rendered.paperSize === 'Letter' ? 279.4
            : rendered.paperSize === 'Legal' ? 355.6
            : (rendered.widthMm <= 90 ? 3276 : 0),
        });
        setPrintStatus('Đã gửi lệnh in thử trực tiếp tới máy in mặc định.');
        return;
      } catch (err) {
        setPrintStatus(`Không thể in thử: ${err.message}`);
        return;
      }
    }

    setPrintStatus('Đang mở cửa sổ in...');
    const printWindow = window.open('', '_blank', 'width=960,height=720');
    if (!printWindow) {
      setPrintStatus('Trình duyệt đang chặn popup in. Vui lòng cho phép popup cho ứng dụng.');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(rendered.documentHtml);
    printWindow.document.close();
    printWindow.focus();

    const runPrint = () => {
      try {
        printWindow.print();
        setPrintStatus('Đã gửi nội dung preview sang hộp thoại in.');
      } catch (err) {
        setPrintStatus(`Không thể in thử: ${err.message}`);
      }
    };

    if (printWindow.document.readyState === 'complete') {
      setTimeout(runPrint, 250);
    } else {
      printWindow.onload = () => setTimeout(runPrint, 250);
    }
  };

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${className}`}>
      <div className="px-4 py-3 border-b bg-slate-50 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-800 flex items-center gap-2">
            <Eye size={18} className="text-blue-600" /> Xem trước realtime
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Khổ {rendered.paperSize} · rộng {rendered.widthMm}mm · dữ liệu mẫu có logo, QR và ảnh sản phẩm
          </p>
        </div>
        <button
          type="button"
          onClick={handlePrint}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          <Printer size={16} /> In thử
        </button>
      </div>

      {printStatus && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 text-xs flex items-center gap-2">
          <RefreshCw size={14} /> {printStatus}
        </div>
      )}

      <div className="bg-slate-100 p-4 overflow-auto">
        <div className="mx-auto" style={{ width: `${frameSize.width}px`, maxWidth: '100%' }}>
          <iframe
            key={`${template?.id || 'draft'}-${rendered.paperSize}-${rendered.widthMm}-${rendered.html.length}-${rendered.css.length}`}
            title="invoice-template-preview"
            srcDoc={rendered.documentHtml}
            sandbox="allow-same-origin"
            className="bg-white border border-slate-300 rounded-lg shadow-inner"
            style={{
              width: `${frameSize.width}px`,
              maxWidth: '100%',
              minHeight: `${frameSize.minHeight}px`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
