import { printHtmlSilently, isSilentPrintSupported } from './desktopPrint';
import { renderInvoiceTemplate, escapeHtml } from './invoiceTemplateRenderer';

export function writePrintWindowMessage(printWindow, { title = 'Chuẩn bị in hóa đơn', message = 'Đang tải dữ liệu in...', tone = 'info' } = {}) {
  if (!printWindow?.document) return;
  const color = tone === 'error' ? '#dc2626' : '#2563eb';
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>@page{size:A5 portrait;margin:0}*{box-sizing:border-box}html,body{width:148mm;min-height:210mm;margin:0;padding:0;background:#fff;color:#111827;display:block;overflow:visible;transform:none;zoom:1;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:Arial,sans-serif}.box{max-width:520px;margin:0;padding:16px;border:1px solid #e5e7eb;border-radius:0;background:#fff;box-shadow:none}h1{margin:0 0 10px;font-size:18px;color:${color}}p{margin:0;line-height:1.5;color:#4b5563}@media screen{body{background:#f8fafc;padding:16px}.box{border-radius:16px;box-shadow:0 10px 30px rgba(15,23,42,.12)}}@media print{@page{size:A5 portrait;margin:0}html,body{width:148mm!important;min-width:148mm!important;max-width:148mm!important;height:210mm!important;min-height:210mm!important;margin:0!important;padding:0!important;background:#fff!important;display:block!important;overflow:visible!important;position:static!important;inset:auto!important;top:0!important;left:0!important;right:auto!important;bottom:auto!important;transform:none!important;zoom:1!important}.box{margin:0!important;padding:10mm!important;max-width:148mm!important;width:148mm!important;min-height:210mm!important;border:0!important;box-shadow:none!important;border-radius:0!important;display:block!important;position:relative!important;top:0!important;left:0!important;transform:none!important;zoom:1!important}}</style></head><body><div class="box"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`);
  printWindow.document.close();
}

function appendPrintScript(documentHtml, { autoPrint = true, closeAfterPrint = true } = {}) {
  if (!autoPrint) return documentHtml;
  const closeScript = closeAfterPrint
    ? 'window.onafterprint=function(){setTimeout(function(){window.close();},250);};'
    : '';
  const script = `
<script>
window.addEventListener('load',function(){
  setTimeout(function(){
    try { window.focus(); window.print(); } catch (err) { console.error(err); }
  },250);
});
${closeScript}
<\/script>`;
  if (documentHtml.includes('</body>')) return documentHtml.replace('</body>', `${script}</body>`);
  return `${documentHtml}${script}`;
}

function ensurePrintableInput(data, template) {
  if (!data || typeof data !== 'object') throw new Error('Thiếu dữ liệu hóa đơn để in.');
  if (!template || typeof template !== 'object') throw new Error('Thiếu mẫu in hóa đơn.');
  if (!data.invoice && !data.items) throw new Error('Dữ liệu hóa đơn không hợp lệ.');
}

export function renderInvoicePrintDocument({ data, template, title = '' } = {}) {
  ensurePrintableInput(data, template);
  const effectiveTemplate = {
    ...template,
    name: title || template.name || 'Hóa đơn bán hàng',
  };
  const rendered = renderInvoiceTemplate(effectiveTemplate, {
    sampleData: data,
    type: effectiveTemplate.type || data.type || 'sale_invoice',
    paperSize: effectiveTemplate.paper_size || effectiveTemplate.paperSize,
    widthMm: effectiveTemplate.width_mm || effectiveTemplate.widthMm,
  });
  if (!rendered?.documentHtml || !String(rendered.documentHtml).trim()) {
    throw new Error('Không render được nội dung hóa đơn.');
  }
  return rendered;
}

export async function printInvoice({
  data,
  template,
  title = '',
  autoPrint = true,
  closeAfterPrint = true,
  targetWindow = null,
  printerName = '',
  copies = 1,
  layout = 'portrait',
  margins = 'default',
  printBackground = true,
  showHeadersFooters = false,
  pageMode = 'all',
} = {}) {
  const rendered = renderInvoicePrintDocument({ data, template, title });

  if (isSilentPrintSupported()) {
    const printResult = await printHtmlSilently({
      documentHtml: rendered.documentHtml,
      jobTitle: title || template?.name || 'Hóa đơn bán hàng',
      printerName,
      copies,
      layout,
      margins,
      printBackground,
      showHeadersFooters,
      pageMode,
      paperSize: rendered.paperSize || template?.paper_size || template?.paperSize,
      widthMm: rendered.widthMm || template?.width_mm || template?.widthMm,
      heightMm: rendered.paperSize === 'A3' ? 420
        : rendered.paperSize === 'A4' ? 297
        : rendered.paperSize === 'A5' ? 210
        : rendered.paperSize === 'A6' ? 148
        : rendered.paperSize === 'B5' ? 250
        : rendered.paperSize === 'Letter' ? 279.4
        : rendered.paperSize === 'Legal' ? 355.6
        : ((rendered.widthMm || template?.width_mm || template?.widthMm || 0) <= 90 ? 3276 : 0),
    });

    return {
      ...rendered,
      printResult,
      silent: true,
    };
  }

  const printWindow = targetWindow || window.open('', '_blank');
  if (!printWindow) throw new Error('Trình duyệt đã chặn cửa sổ in. Vui lòng cho phép popup và thử lại.');

  printWindow.document.open();
  printWindow.document.write(appendPrintScript(rendered.documentHtml, { autoPrint, closeAfterPrint }));
  printWindow.document.close();

  return {
    ...rendered,
    silent: false,
  };
}
