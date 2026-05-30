import { printHtmlSilently, isSilentPrintSupported } from './desktopPrint';
import { escapeHtml, formatCurrency } from './invoiceTemplateRenderer';

export const PRODUCT_LABEL_SIZES = [
  { value: '72x22', label: '72x22 mm', widthMm: 72, heightMm: 22 },
  { value: '74x22', label: '74x22 mm', widthMm: 74, heightMm: 22 },
  { value: '110x22', label: '110x22 mm', widthMm: 110, heightMm: 22 },
];

export const PRODUCT_LABEL_PAPERS = [
  { value: 'ROLL', label: 'Cuộn theo khổ tem', kind: 'roll' },
  {
    value: 'TOMY_145',
    label: 'Tomy No.145 - 65 tem',
    kind: 'sheet',
    pageSize: 'A4',
    pageWidthMm: 210,
    pageHeightMm: 297,
    columns: 5,
    rows: 13,
    gapXmm: 1.2,
    gapYmm: 0.4,
    margin: { top: 9, right: 7, bottom: 9, left: 7 },
  },
  {
    value: 'TOMY_146',
    label: 'Tomy No.146 - 180 tem',
    kind: 'sheet',
    pageSize: 'A4',
    pageWidthMm: 210,
    pageHeightMm: 297,
    columns: 10,
    rows: 18,
    gapXmm: 0.8,
    gapYmm: 0.4,
    margin: { top: 8, right: 6, bottom: 8, left: 6 },
  },
  {
    value: 'TOMY_138',
    label: 'Tomy No.138 - 100 tem',
    kind: 'sheet',
    pageSize: 'A4',
    pageWidthMm: 210,
    pageHeightMm: 297,
    columns: 5,
    rows: 20,
    gapXmm: 1,
    gapYmm: 0.4,
    margin: { top: 8, right: 7, bottom: 8, left: 7 },
  },
  {
    value: 'TOMY_108',
    label: 'Tomy No.108 - 40 tem',
    kind: 'sheet',
    pageSize: 'A5',
    pageWidthMm: 148,
    pageHeightMm: 210,
    columns: 4,
    rows: 10,
    gapXmm: 1,
    gapYmm: 0.6,
    margin: { top: 7, right: 5, bottom: 7, left: 5 },
  },
];

export const DEFAULT_PRODUCT_LABEL_CONTENT = {
  showProductName: true,
  showBarcode: true,
  showPrice: true,
  showStoreName: true,
};

function toPositiveInteger(value, fallback = 1) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function escapeAttribute(value) {
  return escapeHtml(String(value || '')).replace(/"/g, '"');
}

function getStoreName(store, fallback = 'Cửa hàng') {
  return store?.name || store?.store_name || store?.shop_name || store?.business_name || fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return Boolean(value);
}

function normalizeContentOptions(content = {}) {
  return {
    showProductName: normalizeBoolean(content.showProductName, DEFAULT_PRODUCT_LABEL_CONTENT.showProductName),
    showBarcode: normalizeBoolean(content.showBarcode, DEFAULT_PRODUCT_LABEL_CONTENT.showBarcode),
    showPrice: normalizeBoolean(content.showPrice, DEFAULT_PRODUCT_LABEL_CONTENT.showPrice),
    showStoreName: normalizeBoolean(content.showStoreName, DEFAULT_PRODUCT_LABEL_CONTENT.showStoreName),
  };
}

export function normalizeProductLabelItems(items = [], options = {}) {
  const defaultQuantity = toPositiveInteger(options.defaultQuantity, 1);
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    ...item,
    id: item?.id || item?.variant_id || item?.product_id || `label-item-${index}`,
    name: String(item?.name || item?.product_name || item?.display_name || 'Sản phẩm').trim(),
    sku: String(item?.sku || item?.barcode || item?.product_sku || '').trim(),
    price: item?.price ?? item?.retail_price ?? item?.sale_price ?? item?.unit_price ?? 0,
    quantity: toPositiveInteger(item?.labelQuantity ?? item?.quantity, defaultQuantity),
  }));
}

export function getProductLabelSizeConfig(value) {
  return PRODUCT_LABEL_SIZES.find(size => size.value === value) || PRODUCT_LABEL_SIZES[0];
}

export function getProductLabelPaperConfig(value) {
  return PRODUCT_LABEL_PAPERS.find(paper => paper.value === value) || PRODUCT_LABEL_PAPERS[0];
}

function expandLabelItems(items = []) {
  return items.flatMap((item) => {
    const quantity = toPositiveInteger(item.quantity, 1);
    return Array.from({ length: quantity }, (_, index) => ({
      ...item,
      _copyIndex: index + 1,
    }));
  });
}

function chunkItems(items = [], chunkSize = 1) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const safeChunkSize = Math.max(1, Math.floor(chunkSize) || 1);
  const result = [];
  for (let index = 0; index < items.length; index += safeChunkSize) {
    result.push(items.slice(index, index + safeChunkSize));
  }
  return result;
}

function getSheetMetric(paper = {}) {
  const columns = Math.max(1, Math.floor(paper.columns) || 1);
  const rows = Math.max(1, Math.floor(paper.rows) || 1);
  const pageWidthMm = toFiniteNumber(paper.pageWidthMm, 210);
  const pageHeightMm = toFiniteNumber(paper.pageHeightMm, 297);
  const gapXmm = Math.max(0, toFiniteNumber(paper.gapXmm, 0));
  const gapYmm = Math.max(0, toFiniteNumber(paper.gapYmm, 0));
  const margin = {
    top: Math.max(0, toFiniteNumber(paper.margin?.top, 0)),
    right: Math.max(0, toFiniteNumber(paper.margin?.right, 0)),
    bottom: Math.max(0, toFiniteNumber(paper.margin?.bottom, 0)),
    left: Math.max(0, toFiniteNumber(paper.margin?.left, 0)),
  };

  const usableWidth = Math.max(10, pageWidthMm - margin.left - margin.right - gapXmm * (columns - 1));
  const usableHeight = Math.max(10, pageHeightMm - margin.top - margin.bottom - gapYmm * (rows - 1));

  return {
    ...paper,
    pageWidthMm,
    pageHeightMm,
    columns,
    rows,
    gapXmm,
    gapYmm,
    margin,
    labelWidthMm: usableWidth / columns,
    labelHeightMm: usableHeight / rows,
    capacity: columns * rows,
  };
}

function renderBarcodeSvg(text = '') {
  const value = String(text || '').trim();
  if (!value) {
    return '<div class="label-barcode-empty">No SKU</div>';
  }

  const bars = value.split('').map((char, index) => {
    const code = char.charCodeAt(0);
    const width = 1 + (code % 3);
    const x = 2 + index * 3;
    return `<rect x="${x}" y="2" width="${width}" height="36" rx="0.4"></rect>`;
  }).join('');

  return `<svg class="label-barcode-svg" viewBox="0 0 ${Math.max(48, value.length * 3 + 4)} 40" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" aria-label="Barcode ${escapeAttribute(value)}">${bars}</svg>`;
}

function renderLabelItem(item, index, context) {
  const { content, storeName } = context;
  const productName = escapeHtml(item.name || 'Sản phẩm');
  const sku = escapeHtml(item.sku || '');
  const price = formatCurrency(item.price || 0);

  return `
    <article class="product-label" data-index="${index + 1}">
      ${content.showStoreName ? `<div class="label-store">${escapeHtml(storeName)}</div>` : ''}
      ${content.showProductName ? `<div class="label-name">${productName}</div>` : ''}
      ${content.showBarcode ? `<div class="label-barcode">${renderBarcodeSvg(item.sku)}</div>` : ''}
      ${content.showBarcode ? `<div class="label-sku">${sku || '&nbsp;'}</div>` : ''}
      ${content.showPrice ? `<div class="label-price">${escapeHtml(price)}</div>` : ''}
    </article>
  `.trim();
}

function buildPrintCss(context) {
  const { labelSize, paper, content } = context;
  const barcodeDisplay = content.showBarcode ? 'block' : 'none';

  if (paper.kind === 'roll') {
    return `
      @page { size: ${labelSize.widthMm}mm ${labelSize.heightMm}mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; width: ${labelSize.widthMm}mm; min-width: ${labelSize.widthMm}mm; min-height: ${labelSize.heightMm}mm; background: #fff; }
      body { color: #111827; font-family: Arial, Helvetica, sans-serif; display: block; overflow: visible; transform: none; zoom: 1; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-meta { display: none; }
      .roll-page { width: ${labelSize.widthMm}mm; margin: 0; display: grid; grid-template-columns: 1fr; position: relative; top: 0; left: 0; transform: none; zoom: 1; }
      .product-label {
        width: ${labelSize.widthMm}mm;
        height: ${labelSize.heightMm}mm;
        padding: 1.2mm 1.6mm;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border: 0;
      }
      .label-store { max-width: 100%; font-size: 2.15mm; line-height: 1.05; font-weight: 700; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .label-name { max-width: 100%; font-size: ${labelSize.widthMm >= 100 ? '2.8mm' : '2.45mm'}; line-height: 1.05; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 0.35mm; }
      .label-barcode { display: ${barcodeDisplay}; width: 92%; height: 6.8mm; margin-top: 0.4mm; }
      .label-barcode-svg { width: 100%; height: 100%; fill: #111; display: block; }
      .label-barcode-empty { height: 100%; display: flex; align-items: center; justify-content: center; border: 0.25mm dashed #999; font-size: 1.7mm; color: #777; }
      .label-sku { max-width: 100%; font-size: 2.05mm; line-height: 1; letter-spacing: 0.2mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 0.25mm; }
      .label-price { font-size: ${labelSize.widthMm >= 100 ? '3.5mm' : '3.05mm'}; line-height: 1.05; font-weight: 800; margin-top: 0.35mm; }
      @media screen {
        body { background: #f3f4f6; padding: 12px; }
        .roll-page { background: #fff; margin: 0 auto; box-shadow: 0 8px 24px rgba(15,23,42,.14); }
        .product-label { outline: 1px dashed #d1d5db; outline-offset: -1px; }
      }
      @media print {
        @page { size: ${labelSize.widthMm}mm ${labelSize.heightMm}mm; margin: 0; }
        html, body { width: ${labelSize.widthMm}mm !important; min-width: ${labelSize.widthMm}mm !important; min-height: ${labelSize.heightMm}mm !important; margin: 0 !important; padding: 0 !important; display: block !important; overflow: visible !important; transform: none !important; zoom: 1 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .roll-page { width: ${labelSize.widthMm}mm !important; margin: 0 !important; display: grid !important; justify-content: start !important; align-content: start !important; position: relative !important; top: 0 !important; left: 0 !important; transform: none !important; zoom: 1 !important; }
      }
    `;
  }

  const sheet = getSheetMetric(paper);
  const normalizedSheetPageSize = String(sheet.pageSize || '').trim().toUpperCase();
  const sheetPageSizeCss = normalizedSheetPageSize === 'A5'
    ? 'A5 portrait'
    : normalizedSheetPageSize === 'A4'
      ? 'A4 portrait'
      : `${sheet.pageWidthMm}mm ${sheet.pageHeightMm}mm`;
  return `
    @page { size: ${sheetPageSizeCss}; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: ${sheet.pageWidthMm}mm; min-width: ${sheet.pageWidthMm}mm; min-height: ${sheet.pageHeightMm}mm; background: #fff; }
    body { color: #111827; font-family: Arial, Helvetica, sans-serif; display: block; overflow: visible; transform: none; zoom: 1; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .print-meta { display: none; }
    .sheet-page {
      display: grid;
      grid-template-columns: repeat(${sheet.columns}, ${sheet.labelWidthMm}mm);
      grid-auto-rows: ${sheet.labelHeightMm}mm;
      gap: ${sheet.gapYmm}mm ${sheet.gapXmm}mm;
      width: ${sheet.pageWidthMm}mm;
      min-height: ${sheet.pageHeightMm}mm;
      margin: 0;
      padding: ${sheet.margin.top}mm ${sheet.margin.right}mm ${sheet.margin.bottom}mm ${sheet.margin.left}mm;
      justify-content: start;
      align-content: start;
      position: relative;
      top: 0;
      left: 0;
      transform: none;
      zoom: 1;
      page-break-after: always;
      break-after: page;
    }
    .sheet-page:last-child { page-break-after: auto; break-after: auto; }
    .product-label {
      width: ${sheet.labelWidthMm}mm;
      height: ${sheet.labelHeightMm}mm;
      padding: ${sheet.labelHeightMm < 16 ? '0.45mm 0.8mm' : '0.7mm 1mm'};
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border: 0;
    }
    .label-store { max-width: 100%; font-size: ${sheet.labelHeightMm < 16 ? '1.4mm' : '1.8mm'}; line-height: 1; font-weight: 700; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .label-name { max-width: 100%; font-size: ${sheet.labelHeightMm < 16 ? '1.55mm' : '2mm'}; line-height: 1.05; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 0.25mm; }
    .label-barcode { display: ${barcodeDisplay}; width: 94%; height: ${Math.max(4, Math.min(7.2, sheet.labelHeightMm * 0.32)).toFixed(2)}mm; margin-top: 0.25mm; }
    .label-barcode-svg { width: 100%; height: 100%; fill: #111; display: block; }
    .label-barcode-empty { height: 100%; display: flex; align-items: center; justify-content: center; border: 0.2mm dashed #999; font-size: 1.5mm; color: #777; }
    .label-sku { max-width: 100%; font-size: ${sheet.labelHeightMm < 16 ? '1.35mm' : '1.65mm'}; line-height: 1; letter-spacing: 0.12mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 0.2mm; }
    .label-price { font-size: ${sheet.labelHeightMm < 16 ? '1.75mm' : '2.35mm'}; line-height: 1.05; font-weight: 800; margin-top: 0.25mm; }
    @media screen {
      body { background: #f3f4f6; padding: 12px; }
      .sheet-page { background: #fff; margin: 0 auto 16px; box-shadow: 0 8px 24px rgba(15,23,42,.14); }
      .product-label { outline: 1px dashed #d1d5db; outline-offset: -1px; }
    }
    @media print {
      @page { size: ${sheetPageSizeCss}; margin: 0; }
      html, body { width: ${sheet.pageWidthMm}mm !important; min-width: ${sheet.pageWidthMm}mm !important; min-height: ${sheet.pageHeightMm}mm !important; margin: 0 !important; padding: 0 !important; display: block !important; overflow: visible !important; transform: none !important; zoom: 1 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .sheet-page { width: ${sheet.pageWidthMm}mm !important; min-height: ${sheet.pageHeightMm}mm !important; margin: 0 !important; padding: ${sheet.margin.top}mm ${sheet.margin.right}mm ${sheet.margin.bottom}mm ${sheet.margin.left}mm !important; display: grid !important; justify-content: start !important; align-content: start !important; position: relative !important; top: 0 !important; left: 0 !important; transform: none !important; zoom: 1 !important; box-shadow: none !important; }
    }
  `;
}

function renderLabelPages(expandedItems, context) {
  const { paper } = context;
  if (paper.kind === 'roll') {
    return `<section class="label-sheet roll-page">${expandedItems.map((item, index) => renderLabelItem(item, index, context)).join('')}</section>`;
  }

  const sheet = getSheetMetric(paper);
  return chunkItems(expandedItems, sheet.capacity)
    .map((chunk, pageIndex) => `<section class="label-sheet sheet-page" data-page-index="${pageIndex + 1}">${chunk.map((item, itemIndex) => renderLabelItem(item, pageIndex * sheet.capacity + itemIndex, context)).join('')}</section>`)
    .join('');
}

function appendAutoPrintScript(documentHtml, { autoPrint = true, closeAfterPrint = true } = {}) {
  if (!autoPrint) return documentHtml;
  const closeScript = closeAfterPrint
    ? 'window.onafterprint=function(){setTimeout(function(){window.close();},350);};'
    : '';
  const script = `
<script>
window.addEventListener('load',function(){
  setTimeout(function(){
    try { window.focus(); window.print(); } catch (err) { console.error('Không thể mở hộp thoại in tem sản phẩm:', err); }
  },250);
});
${closeScript}
<\/script>`;
  if (documentHtml.includes('</body>')) return documentHtml.replace('</body>', `${script}</body>`);
  return `${documentHtml}${script}`;
}

export function renderProductLabelPrintDocument(items = [], options = {}) {
  const normalizedItems = normalizeProductLabelItems(items, { defaultQuantity: options.defaultQuantity || 1 })
    .filter(item => toPositiveInteger(item.quantity, 1) > 0);

  if (normalizedItems.length === 0) {
    throw new Error('Chưa có sản phẩm nào để in tem.');
  }

  const missingSkuItems = normalizedItems.filter(item => !String(item.sku || '').trim());
  if (missingSkuItems.length > 0) {
    throw new Error(`Có ${missingSkuItems.length} sản phẩm chưa có SKU/mã vạch. Vui lòng bổ sung SKU trước khi in.`);
  }

  const labelSize = getProductLabelSizeConfig(options.labelSize || options.label_size || '72x22');
  const paper = getProductLabelPaperConfig(options.paperType || options.paper_type || options.paper || 'ROLL');
  const content = normalizeContentOptions(options.content || options.contentOptions || {});
  const storeName = getStoreName(options.store, options.storeName);
  const expandedItems = expandLabelItems(normalizedItems);
  const title = options.title || 'In tem sản phẩm';
  const context = { labelSize, paper, content, storeName };
  const styles = buildPrintCss(context);
  const body = renderLabelPages(expandedItems, context);

  const documentHtml = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${styles}</style>
</head>
<body>
  <div class="print-meta">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(paper.label)} · ${escapeHtml(labelSize.label)} · ${expandedItems.length} tem</p>
  </div>
  ${body}
</body>
</html>`;

  return {
    documentHtml,
    items: normalizedItems,
    labelCount: expandedItems.length,
    labelSize,
    paper,
    content,
  };
}

export async function printProductLabels(items = [], options = {}) {
  const rendered = renderProductLabelPrintDocument(items, options);

  if (isSilentPrintSupported()) {
    const printResult = await printHtmlSilently({
      documentHtml: rendered.documentHtml,
      jobTitle: options.title || 'In tem sản phẩm',
      printerName: options.printerName || options.printer_name || '',
      copies: 1,
      layout: 'portrait',
      margins: 'none',
      printBackground: true,
      showHeadersFooters: false,
      pageMode: 'all',
      paperSize: rendered.paper?.pageSize || `${rendered.labelSize.widthMm}x${rendered.labelSize.heightMm}`,
      widthMm: rendered.paper?.kind === 'roll' ? rendered.labelSize.widthMm : rendered.paper?.pageWidthMm || rendered.labelSize.widthMm,
      heightMm: rendered.paper?.kind === 'roll' ? rendered.labelSize.heightMm : rendered.paper?.pageHeightMm || rendered.labelSize.heightMm,
    });

    return {
      ...rendered,
      printResult,
      silent: true,
    };
  }

  const printWindow = options.targetWindow || window.open('', '_blank');
  if (!printWindow) {
    throw new Error('Trình duyệt đã chặn cửa sổ in tem. Vui lòng cho phép popup và thử lại.');
  }

  printWindow.document.open();
  printWindow.document.write(appendAutoPrintScript(rendered.documentHtml, {
    autoPrint: options.autoPrint !== false,
    closeAfterPrint: options.closeAfterPrint !== false,
  }));
  printWindow.document.close();

  return {
    ...rendered,
    silent: false,
  };
}
