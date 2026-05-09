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
    margin: { top: 7, right: 6, bottom: 7, left: 6 },
  },
];

export const DEFAULT_PRODUCT_LABEL_CONTENT = {
  showStoreName: true,
  showProductName: true,
  showBarcode: true,
  showPrice: true,
};

const FALLBACK_STORE_NAME = 'Cửa hàng';

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function toFiniteNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const normalized = String(value).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

function toPositiveInteger(value, fallback = 1) {
  const number = Math.floor(toFiniteNumber(value, fallback));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeBooleanFlag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  return fallback;
}

export function getProductLabelSizeConfig(value) {
  return PRODUCT_LABEL_SIZES.find(size => size.value === value) || PRODUCT_LABEL_SIZES[0];
}

export function getProductLabelPaperConfig(value) {
  return PRODUCT_LABEL_PAPERS.find(paper => paper.value === value) || PRODUCT_LABEL_PAPERS[0];
}

export function normalizeProductLabelItems(items = [], { defaultQuantity = 1 } = {}) {
  const sourceItems = Array.isArray(items) ? items : (items ? [items] : []);
  return sourceItems
    .map((rawItem, index) => {
      const item = rawItem && typeof rawItem === 'object' ? rawItem : { name: rawItem };
      const sku = firstNonEmpty(item.sku, item.maSP, item.barcode, item.code, item.product_code, item.productCode);
      const parentName = firstNonEmpty(item.parent_name, item.parentName, item.parent?.name, item.product_name_parent);
      const variantName = firstNonEmpty(item.variant_name, item.variantName);
      const baseName = firstNonEmpty(item.name, item.tenSP, item.product_name, variantName, item.title, sku);
      const shouldPrefixParent = parentName && variantName && !String(baseName).includes(parentName);
      const name = shouldPrefixParent ? `${parentName} / ${baseName}` : baseName;
      const price = toFiniteNumber(
        item.retail_price ?? item.price ?? item.giaBan ?? item.gia_ban ?? item.giaLe ?? item.gia_le ?? item.sale_price ?? item.wholesale_price,
        0
      );
      const quantity = toPositiveInteger(
        item.labelQuantity ?? item.label_quantity ?? item.printQuantity ?? item.print_quantity ?? item.soLuongNhap ?? item.quantity ?? item.soLuong ?? item.qty,
        defaultQuantity
      );

      return {
        id: item.id ?? item.product_id ?? item.variant_id ?? `${sku || name || 'label'}-${index}`,
        product_id: item.product_id ?? item.productId ?? item.id ?? null,
        variant_id: item.variant_id ?? item.variantId ?? null,
        name,
        sku,
        price,
        quantity,
        unit: firstNonEmpty(item.unit, item.donVi, item.dvt),
        raw: item,
      };
    })
    .filter(item => item.name || item.sku);
}

function expandLabelItems(items) {
  return items.flatMap(item => {
    const quantity = toPositiveInteger(item.quantity, 1);
    return Array.from({ length: quantity }, (_, copyIndex) => ({ ...item, copyIndex }));
  });
}

export function renderSkuBarcodeSvg(value, { height = 36 } = {}) {
  const sku = String(value || '').trim();
  if (!sku) {
    return '<div class="label-barcode-empty">Chưa có SKU</div>';
  }

  const modules = [
    { on: true, width: 2 },
    { on: false, width: 1 },
    { on: true, width: 1 },
    { on: false, width: 1 },
  ];

  Array.from(sku).forEach((char, charIndex) => {
    const code = char.charCodeAt(0);
    for (let bit = 7; bit >= 0; bit -= 1) {
      const on = ((code >> bit) & 1) === 1;
      modules.push({
        on,
        width: on && ((code + bit + charIndex) % 3 === 0) ? 2 : 1,
      });
    }
    modules.push({ on: false, width: 1 });
  });

  modules.push(
    { on: true, width: 1 },
    { on: false, width: 1 },
    { on: true, width: 2 }
  );

  const totalWidth = modules.reduce((sum, module) => sum + module.width, 0);
  let x = 0;
  const bars = modules.map((module, index) => {
    const currentX = x;
    x += module.width;
    if (!module.on) return '';
    return `<rect key="${index}" x="${currentX}" y="0" width="${module.width}" height="${height}" />`;
  }).join('');

  return `<svg class="label-barcode-svg" viewBox="0 0 ${totalWidth} ${height}" preserveAspectRatio="none" role="img" aria-label="Barcode ${escapeHtml(sku)}"><title>${escapeHtml(sku)}</title>${bars}</svg>`;
}

function normalizeContentOptions(options = {}) {
  return {
    showStoreName: normalizeBooleanFlag(options.showStoreName ?? options.storeName, DEFAULT_PRODUCT_LABEL_CONTENT.showStoreName),
    showProductName: normalizeBooleanFlag(options.showProductName ?? options.productName ?? options.showName, DEFAULT_PRODUCT_LABEL_CONTENT.showProductName),
    showBarcode: normalizeBooleanFlag(options.showBarcode ?? options.barcode ?? options.showSku, DEFAULT_PRODUCT_LABEL_CONTENT.showBarcode),
    showPrice: normalizeBooleanFlag(options.showPrice ?? options.price, DEFAULT_PRODUCT_LABEL_CONTENT.showPrice),
  };
}

function getStoreName(store, explicitName) {
  return firstNonEmpty(explicitName, store?.name, store?.store_name, store?.shop_name, store?.business_name, FALLBACK_STORE_NAME);
}

function getSheetMetric(paper) {
  const margin = paper.margin || { top: 0, right: 0, bottom: 0, left: 0 };
  const columns = Math.max(1, Number(paper.columns) || 1);
  const rows = Math.max(1, Number(paper.rows) || 1);
  const gapXmm = Math.max(0, Number(paper.gapXmm) || 0);
  const gapYmm = Math.max(0, Number(paper.gapYmm) || 0);
  const usableWidth = Math.max(10, paper.pageWidthMm - margin.left - margin.right - gapXmm * (columns - 1));
  const usableHeight = Math.max(10, paper.pageHeightMm - margin.top - margin.bottom - gapYmm * (rows - 1));
  return {
    margin,
    columns,
    rows,
    gapXmm,
    gapYmm,
    labelWidthMm: usableWidth / columns,
    labelHeightMm: usableHeight / rows,
    capacity: columns * rows,
  };
}

function chunkItems(items, size) {
  if (!size || size <= 0) return [items];
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function renderLabelItem(item, index, { content, storeName }) {
  const sku = String(item.sku || '').trim();
  return `
    <div class="product-label" data-label-index="${index + 1}">
      ${content.showStoreName ? `<div class="label-store">${escapeHtml(storeName)}</div>` : ''}
      ${content.showProductName ? `<div class="label-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>` : ''}
      ${content.showBarcode ? `<div class="label-barcode">${renderSkuBarcodeSvg(sku)}</div><div class="label-sku">${escapeHtml(sku)}</div>` : ''}
      ${content.showPrice ? `<div class="label-price">${escapeHtml(formatCurrency(item.price))}</div>` : ''}
    </div>
  `;
}

function buildPrintCss({ labelSize, paper, content }) {
  const isRoll = paper.kind === 'roll';
  const sheet = isRoll ? null : getSheetMetric(paper);
  const barcodeDisplay = content.showBarcode ? 'block' : 'none';

  if (isRoll) {
    return `
      @page { size: ${labelSize.widthMm}mm ${labelSize.heightMm}mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif; }
      .print-meta { display: none; }
      .label-sheet { margin: 0; padding: 0; }
      .product-label {
        width: ${labelSize.widthMm}mm;
        height: ${labelSize.heightMm}mm;
        padding: 1.1mm 1.8mm 0.9mm;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border: 0;
        break-after: page;
        page-break-after: always;
      }
      .product-label:last-child { break-after: auto; page-break-after: auto; }
      .label-store { max-width: 100%; font-size: 2.15mm; line-height: 1.05; font-weight: 700; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .label-name { max-width: 100%; font-size: ${labelSize.widthMm >= 100 ? '2.8mm' : '2.45mm'}; line-height: 1.05; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 0.35mm; }
      .label-barcode { display: ${barcodeDisplay}; width: 92%; height: 6.8mm; margin-top: 0.4mm; }
      .label-barcode-svg { width: 100%; height: 100%; fill: #111; display: block; }
      .label-barcode-empty { height: 100%; display: flex; align-items: center; justify-content: center; border: 0.25mm dashed #999; font-size: 2mm; color: #777; }
      .label-sku { max-width: 100%; font-size: 2.05mm; line-height: 1; letter-spacing: 0.2mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 0.25mm; }
      .label-price { font-size: ${labelSize.widthMm >= 100 ? '3.5mm' : '3.05mm'}; line-height: 1.05; font-weight: 800; margin-top: 0.35mm; }
      @media screen {
        body { background: #f3f4f6; padding: 12px; }
        .label-sheet { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
        .product-label { background: #fff; border: 1px dashed #cbd5e1; box-shadow: 0 1px 4px rgba(15,23,42,.12); break-after: auto; page-break-after: auto; }
      }
    `;
  }

  return `
    @page { size: ${paper.pageSize}; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif; }
    .print-meta { display: none; }
    .sheet-page {
      width: ${paper.pageWidthMm}mm;
      height: ${paper.pageHeightMm}mm;
      padding: ${sheet.margin.top}mm ${sheet.margin.right}mm ${sheet.margin.bottom}mm ${sheet.margin.left}mm;
      display: grid;
      grid-template-columns: repeat(${sheet.columns}, ${sheet.labelWidthMm}mm);
      grid-auto-rows: ${sheet.labelHeightMm}mm;
      gap: ${sheet.gapYmm}mm ${sheet.gapXmm}mm;
      align-content: start;
      justify-content: start;
      overflow: hidden;
      break-after: page;
      page-break-after: always;
    }
    .sheet-page:last-child { break-after: auto; page-break-after: auto; }
    .product-label {
      width: ${sheet.labelWidthMm}mm;
      height: ${sheet.labelHeightMm}mm;
      padding: ${sheet.labelHeightMm < 16 ? '0.45mm 0.8mm' : '0.7mm 1mm'};
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
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

export function printProductLabels(items = [], options = {}) {
  const rendered = renderProductLabelPrintDocument(items, options);
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

  return rendered;
}
