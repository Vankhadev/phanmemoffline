import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ElementFrame from './ElementFrame';
import { resolveBackendAssetUrl } from '../../../utils/apiClient';
import {
  buildFlowElementTopOverrides,
  clampFrameToZone,
  getEditorPaperDimensions,
  getElementLabel,
  getFlowElementBaseTopMm,
  getFlowElementHeightMm,
  getItemsTablePageMetrics,
  PAGE_ZONE_ID,
  getTableStyleElement,
  isAutoBelowItemsElement,
  shouldFlowElementAfterItems,
  TABLE_STYLE_ELEMENT_ID,
  TABLE_COLUMN_LABELS,
} from './templateSchemaAdapter';

const PX_PER_MM = 3.7795275591;

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatQuantity(value) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(value) || 0);
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

function resolveAssetUrl(value) {
  const text = String(value || '').trim();
  return text ? resolveBackendAssetUrl(text) : '';
}

function isStyleEnabled(style = {}, key, fallback = true) {
  if (!Object.prototype.hasOwnProperty.call(style || {}, key)) return fallback;
  return style[key] !== false && style[key] !== 0 && style[key] !== '0' && style[key] !== 'false';
}

function getInvoiceCode(payload = {}) {
  return payload.invoice?.invoice_code || payload.invoice?.code || payload.metadata?.invoice_code || 'HD00001';
}

function getItemValue(item = {}, key, index = 0) {
  switch (key) {
    case 'no': return index + 1;
    case 'name': return item.name || item.product_name || item.productName || item.variant_name || 'Sản phẩm';
    case 'sku': return item.sku || item.product_sku || '—';
    case 'unit': return item.unit || item.unit_name || item.uom || '—';
    case 'qty':
    case 'quantity': return formatQuantity(item.quantity);
    case 'unitPrice': return formatVND(item.unit_price ?? item.price);
    case 'discount': {
      const amount = Number(item.discount_amount ?? item.discount ?? 0) || 0;
      const percent = Number(item.discount_percent ?? 0) || 0;
      if (amount > 0 && percent > 0) return `${formatVND(amount)} (${formatQuantity(percent)}%)`;
      if (amount > 0) return formatVND(amount);
      if (percent > 0) return `${formatQuantity(percent)}%`;
      return '—';
    }
    case 'lineTotal': return formatVND(item.line_total ?? item.total);
    case 'note': return item.note || '—';
    default: return '—';
  }
}

function buildLogoUrl(template = {}, payload = {}) {
  return resolveAssetUrl(template.logo?.url || template.logo_url || template.logo_url_resolved || template.header_logo || payload.store?.logo_url || '');
}

function formatFooterTemplate(text, payload = {}) {
  const printedAt = payload.metadata?.printed_at || new Date().toISOString();
  return String(text || 'Cảm ơn quý khách! · In lúc {time} {date}')
    .replace(/\{time\}/g, formatTime(printedAt))
    .replace(/\{date\}/g, formatDate(printedAt))
    .replace(/\{invoiceCode\}/g, getInvoiceCode(payload))
    .replace(/\{customerName\}/g, payload.customer?.name || 'Khách lẻ')
    .replace(/\{storeName\}/g, payload.store?.name || 'Cửa hàng');
}

function normalizeFontFamily(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'serif') return 'Georgia, Times New Roman, serif';
  if (key === 'mono' || key === 'monospace') return 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
}

function alignToJustify(value) {
  if (value === 'right') return 'flex-end';
  if (value === 'center') return 'center';
  return 'flex-start';
}

function clampToGrid(value, gridMm = 1, enabled = true) {
  const number = Number(value) || 0;
  if (!enabled) return Math.round(number * 1000) / 1000;
  const step = Math.max(0.1, Number(gridMm) || 1);
  return Math.round((number / step) * step * 1000) / 1000;
}

function getElementBaseStyle(element = {}) {
  const style = element.style || {};
  return {
    color: style.color || undefined,
    textAlign: style.align || undefined,
    fontFamily: normalizeFontFamily(style.fontFamily),
    fontSize: style.fontSizePt ? `${style.fontSizePt}pt` : undefined,
    lineHeight: style.lineHeight || undefined,
    fontWeight: style.bold ? 800 : undefined,
    opacity: style.opacity ?? undefined,
    padding: style.paddingMm !== undefined ? `${style.paddingMm}mm` : undefined,
    borderRadius: style.borderRadiusMm !== undefined ? `${style.borderRadiusMm}mm` : undefined,
    border: style.borderWidthMm ? `${style.borderWidthMm}mm solid ${style.borderColor || '#cbd5e1'}` : undefined,
    background: style.backgroundColor || undefined,
    gap: style.spacingMm !== undefined ? `${style.spacingMm}mm` : undefined,
  };
}

function ElementContent({ element, template, payload }) {
  const style = element.style || {};
  const store = payload.store || {};
  const invoice = payload.invoice || {};
  const customer = payload.customer || {};
  const totals = payload.totals || {};
  const signatures = payload.signatures || {};
  const logoUrl = buildLogoUrl(template, payload);
  const invoiceCode = getInvoiceCode(payload);
  const baseStyle = getElementBaseStyle(element);

  if (element.type === 'logo') {
    return (
      <div className="invoice-editor-preview-logo" style={{ ...baseStyle, justifyContent: alignToJustify(style.align) }}>
        {logoUrl && isRenderableImage(logoUrl) ? <img src={logoUrl} alt="Logo" style={{ objectFit: style.objectFit || 'contain' }} /> : <span>{String(store.name || 'POS').slice(0, 2).toUpperCase()}</span>}
      </div>
    );
  }

  if (element.type === 'storeInfo') {
    return (
      <div className="invoice-editor-preview-text" style={baseStyle}>
        {isStyleEnabled(style, 'showStoreName') && <b>{store.name || template.shop_name || 'Cửa hàng'}</b>}
        {isStyleEnabled(style, 'showStoreAddress') && <span>{store.address || template.shop_address || 'Địa chỉ cửa hàng'}</span>}
        {isStyleEnabled(style, 'showStorePhone') && <span>{style.storePhoneLabel || 'ĐT'}: {store.phone || template.shop_phone || '—'}</span>}
        {isStyleEnabled(style, 'showStoreEmail') && store.email && <span>Email: {store.email}</span>}
        {isStyleEnabled(style, 'showStoreTaxCode') && store.tax_code && <span>MST: {store.tax_code}</span>}
      </div>
    );
  }

  if (element.type === 'invoiceTitle') {
    return (
      <div className="invoice-editor-preview-title" style={baseStyle}>
        {isStyleEnabled(style, 'showTitle') && <b>{style.titleText || 'HÓA ĐƠN'}</b>}
        {isStyleEnabled(style, 'showSubtitle') && <span>{style.subtitleText || 'BÁN HÀNG'}</span>}
        {isStyleEnabled(style, 'showInvoiceCode') && <small>{invoiceCode}</small>}
      </div>
    );
  }

  if (element.type === 'customerInfo') {
    return (
      <div className="invoice-editor-preview-pairs" style={baseStyle}>
        {isStyleEnabled(style, 'showCustomerName') && <div><span>{style.customerNameLabel || 'Khách'}:</span><b>{customer.name || 'Khách lẻ'}</b></div>}
        {isStyleEnabled(style, 'showCustomerPhone') && <div><span>{style.customerPhoneLabel || 'SĐT'}:</span><b>{customer.phone || '—'}</b></div>}
        {isStyleEnabled(style, 'showCustomerAddress') && <div><span>{style.customerAddressLabel || 'Địa chỉ'}:</span><b>{customer.address || '—'}</b></div>}
        {isStyleEnabled(style, 'showCustomerTaxCode') && <div><span>{style.customerTaxCodeLabel || 'MST'}:</span><b>{customer.tax_code || '—'}</b></div>}
        {isStyleEnabled(style, 'showCustomerType', false) && <div><span>{style.customerTypeLabel || 'Loại khách'}:</span><b>{customer.customer_type || '—'}</b></div>}
      </div>
    );
  }

  if (element.type === 'invoiceMeta') {
    return (
      <div className="invoice-editor-preview-pairs" style={baseStyle}>
        {isStyleEnabled(style, 'showOrderCode') && <div><span>{style.orderCodeLabel || 'Mã đơn'}:</span><b>{invoiceCode}</b></div>}
        {isStyleEnabled(style, 'showOrderDate') && <div><span>{style.orderDateLabel || 'Ngày'}:</span><b>{formatDate(invoice.created_at)} {formatTime(invoice.created_at)}</b></div>}
        {isStyleEnabled(style, 'showSeller') && <div><span>{style.sellerLabelShort || 'NV'}:</span><b>{payload.metadata?.user_name || '—'}</b></div>}
        {isStyleEnabled(style, 'showOrderSource', false) && <div><span>{style.orderSourceLabel || 'Nguồn'}:</span><b>{invoice.source || '—'}</b></div>}
      </div>
    );
  }

  if (element.type === 'paymentQr') return null;

  if (element.type === 'totals') {
    const paid = Number(totals.paid_amount ?? totals.paid ?? 0) || 0;
    const remaining = Number(totals.remaining_amount ?? totals.debt_amount ?? Math.max(0, (Number(totals.total) || 0) - paid)) || 0;
    const showSubtotal = style.showSubtotal !== false;
    const showDiscount = style.showDiscount !== false;
    const showGrandTotal = style.showGrandTotal !== false;
    const showDebt = style.showDebt !== false;
    return (
      <div className="invoice-editor-preview-totals" style={baseStyle}>
        {showSubtotal && <div><span>Tổng tiền hàng</span><b>{formatVND(totals.subtotal ?? totals.total)}</b></div>}
        {showDiscount && <div><span>Chiết khấu</span><b>{formatVND(totals.discount_amount)}</b></div>}
        {showGrandTotal && <div className="is-total"><span>Tổng tiền</span><b>{formatVND(totals.total ?? totals.grand_total)}</b></div>}
        {showDebt && <div><span>Công nợ</span><b>{formatVND(remaining)}</b></div>}
      </div>
    );
  }

  if (element.type === 'note') {
    return <div className="invoice-editor-preview-note" style={baseStyle}><b>Ghi chú:</b> {invoice.note || 'Không có ghi chú'}</div>;
  }

  if (element.type === 'signatures') {
    return (
      <div className="invoice-editor-preview-signatures" style={{ ...baseStyle, gap: style.signatureGapMm !== undefined ? `${style.signatureGapMm}mm` : undefined }}>
        <div><b>{style.buyerLabel || signatures.buyer?.label || 'Khách hàng'}</b><span>{style.buyerHint || '(Ký và ghi rõ họ tên)'}</span></div>
        <div><b>{style.sellerLabel || signatures.seller?.label || 'Người bán'}</b><span>{style.sellerHint || '(Ký và ghi rõ họ tên)'}</span></div>
      </div>
    );
  }

  if (element.type === 'footerText') {
    return <div className="invoice-editor-preview-footer" style={baseStyle}>{formatFooterTemplate(style.text, payload)}</div>;
  }

  if (element.type === 'line' || element.type === 'separator') {
    return <div className="invoice-editor-preview-line" style={{ borderTopColor: style.color || style.borderColor || '#cbd5e1', borderTopWidth: `${style.borderWidthMm || 0.25}mm`, opacity: style.opacity ?? 1 }} />;
  }

  if (element.type === 'rectangle') {
    return <div className="invoice-editor-preview-rect" style={baseStyle} />;
  }

  if (element.type === 'image') {
    return style.src && isRenderableImage(style.src)
      ? <img className="invoice-editor-preview-image" src={resolveAssetUrl(style.src)} alt={getElementLabel(element)} style={{ ...baseStyle, objectFit: style.objectFit || 'contain' }} />
      : <div className="invoice-editor-preview-image-empty" style={baseStyle}>Ảnh</div>;
  }

  return <div className="invoice-editor-preview-custom-text" style={{ ...baseStyle, whiteSpace: 'pre-wrap' }}>{style.text || 'Text tùy chỉnh'}</div>;
}

function getPageTableFrame(document = {}, itemCount = 0, items = []) {
  const table = document.table || {};
  const zone = (document.zones || []).find(item => item.id === table.zoneId) || (document.zones || [])[0] || { frame: { x: 0, y: 0, w: 100, h: 30 } };
  const frame = table.frame || { x: 0, y: 0, w: zone.frame?.w || 100, h: 32 };
  const metrics = getItemsTablePageMetrics(document, itemCount, items);
  return {
    zone,
    frame,
    pageFrame: {
      x: metrics.x,
      y: metrics.y,
      w: metrics.w,
      h: metrics.h,
    },
  };
}

function TablePreview({ document, payload, selected, zoom, snapEnabled, snapGridMm, snapTargets, guides, pageZone, onSelect, onUpdateTable, onGuideChange, onBeginHistory, onEndHistory }) {
  const table = document.table || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const { zone, frame, pageFrame } = getPageTableFrame(document, items.length, items);
  const showSku = tableStyle.showSku === true;
  const columns = (Array.isArray(table.columns) && table.columns.length ? table.columns : []).filter(column => showSku || column.key !== 'sku');
  const page = getEditorPaperDimensions(document);
  const tableStyleElement = getTableStyleElement(document) || {};
  const tableStyle = tableStyleElement.style || {};

  return (
    <ElementFrame
      element={{ id: 'itemsTable', type: 'itemsTable', frame: pageFrame, visible: true, locked: false, zIndex: 0 }}
      zone={{ id: 'page', frame: { x: 0, y: 0, w: page.width, h: page.height } }}
      zoom={zoom}
      selected={selected}
      snapEnabled={snapEnabled}
      snapGridMm={snapGridMm}
      snapTargets={snapTargets}
      onGuideChange={onGuideChange}
      onGestureStart={onBeginHistory}
      onGestureEnd={onEndHistory}
      onSelect={onSelect}
      onFrameChange={(nextPageFrame) => {
        const targetZone = pageZone || zone;
        onUpdateTable?.({
          zoneId: targetZone.id,
          frame: clampFrameToZone({
            x: nextPageFrame.x - Number(targetZone.frame?.x || 0),
            y: nextPageFrame.y - Number(targetZone.frame?.y || 0),
            w: nextPageFrame.w,
            h: nextPageFrame.h,
          }, targetZone, { minW: 12, minH: 8 }),
        });
      }}
    >
      <div
        className={`invoice-editor-table-frame ${selected ? 'is-selected' : ''}`}
        style={{
          '--editor-table-border-width': `${tableStyle.tableBorder === false ? 0 : (tableStyle.borderWidthMm ?? 0.2)}mm`,
          '--editor-table-border-color': tableStyle.borderColor || '#cbd5e1',
          '--editor-table-header-bg': tableStyle.headerBackgroundColor || '#e2e8f0',
          '--editor-table-header-color': tableStyle.headerColor || '#0f172a',
          '--editor-table-padding': `${tableStyle.paddingMm ?? 0.8}mm`,
          '--editor-table-font-size': `${tableStyle.fontSizePt ?? 7.4}pt`,
          '--editor-table-header-font-size': `${tableStyle.headerFontSizePt ?? 7.2}pt`,
          '--editor-table-line-height': tableStyle.lineHeight ?? 1.15,
        }}
      >
        {selected && <div className="invoice-editor-element-label">Khung sản phẩm</div>}
        <table>
          <colgroup>
            {columns.map((column, index) => <col key={`${column.key}-${index}`} style={{ width: `${column.widthMm}mm` }} />)}
          </colgroup>
          <thead>
            <tr>{columns.map((column, index) => <th key={`${column.key}-${index}`} style={{ width: `${column.widthMm}mm`, textAlign: column.align }}>{column.label || TABLE_COLUMN_LABELS[column.key] || column.key}</th>)}</tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id || index}>{columns.map((column, columnIndex) => <td key={`${column.key}-${columnIndex}`} style={{ textAlign: column.align }}>{getItemValue(item, column.key, index)}</td>)}</tr>
            ))}
            {items.length === 0 && <tr><td colSpan={Math.max(1, columns.length)}>Chưa có dữ liệu hóa đơn thật để preview.</td></tr>}
          </tbody>
        </table>
        {selected && guides?.x?.length === 0 && guides?.y?.length === 0 && <span className="invoice-editor-table-size-pill">{Math.round(frame.w || pageFrame.w)}×{Math.round(pageFrame.h)}mm</span>}
      </div>
    </ElementFrame>
  );
}

function addFrameSnapPoints(points, frame = {}) {
  const x = Number(frame.x) || 0;
  const y = Number(frame.y) || 0;
  const w = Number(frame.w) || 0;
  const h = Number(frame.h) || 0;
  points.x.push(x, x + w / 2, x + w);
  points.y.push(y, y + h / 2, y + h);
}

function buildSnapTargets(document = {}, page = {}, selectedId = '', itemCount = 0, items = []) {
  const points = {
    enabled: true,
    x: [0, page.width / 2, page.width],
    y: [0, page.height / 2, page.height],
  };
  const safe = Number(document.canvas?.safePaddingMm) || 0;
  if (safe > 0) {
    points.x.push(safe, page.width - safe);
    points.y.push(safe, page.height - safe);
  }

  for (const zone of document.zones || []) addFrameSnapPoints(points, zone.frame || {});

  const tableFrame = getPageTableFrame(document, itemCount, items).pageFrame;
  if (selectedId !== 'itemsTable') addFrameSnapPoints(points, tableFrame);

  const zonesById = new Map((document.zones || []).map(zone => [zone.id, zone]));
  for (const element of document.elements || []) {
    if (!element || element.id === TABLE_STYLE_ELEMENT_ID || element.id === selectedId || element.visible === false) continue;
    const zone = zonesById.get(element.zoneId);
    if (!zone) continue;
    addFrameSnapPoints(points, {
      ...element.frame,
      x: Number(zone.frame?.x || 0) + Number(element.frame?.x || 0),
      y: Number(zone.frame?.y || 0) + Number(element.frame?.y || 0),
    });
  }

  points.x = [...new Set(points.x.map(value => Math.round((Number(value) || 0) * 1000) / 1000))];
  points.y = [...new Set(points.y.map(value => Math.round((Number(value) || 0) * 1000) / 1000))];
  return points;
}

function buildRulerTicks(lengthMm, zoom, axis = 'x') {
  const ticks = [];
  const step = 5;
  for (let value = 0; value <= lengthMm; value += step) {
    const major = value % 10 === 0;
    ticks.push({ value, major, style: axis === 'x' ? { left: `${value * PX_PER_MM * zoom}px` } : { top: `${value * PX_PER_MM * zoom}px` } });
  }
  return ticks;
}

export default function EditorCanvas({
  document,
  settings,
  payload = {},
  template = {},
  selectedId,
  onSelect,
  onAddElement,
  onUpdateElement,
  onUpdateTable,
  onBeginHistory,
  onEndHistory,
}) {
  const pageRef = useRef(null);
  const page = getEditorPaperDimensions(document);
  const editor = settings?.editor || {};
  const zoom = Number(editor.zoom) || 1;
  const showGrid = editor.showGrid !== false;
  const showRuler = editor.showRuler !== false;
  const showSafeArea = editor.showSafeArea !== false;
  const snapEnabled = editor.snapEnabled !== false;
  const snapGridMm = Number(editor.snapGridMm) || document.canvas?.snapGridMm || 1;
  const pageWidthPx = page.width * PX_PER_MM * zoom;
  const [guides, setGuides] = useState({ x: [], y: [] });

  const zones = useMemo(() => Array.isArray(document.zones) ? document.zones : [], [document.zones]);
  const zonesById = useMemo(() => new Map(zones.map(zone => [zone.id, zone])), [zones]);
  const pageZone = zonesById.get(PAGE_ZONE_ID) || { id: PAGE_ZONE_ID, frame: { x: 0, y: 0, w: page.width, h: page.height } };
  const guideZones = useMemo(() => zones.filter(zone => zone.id !== PAGE_ZONE_ID), [zones]);
  const visibleElements = useMemo(() => [...(document.elements || [])]
    .filter(element => element.id !== TABLE_STYLE_ELEMENT_ID && element.type !== 'paymentQr' && element.visible !== false)
    .sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0)), [document.elements]);
  const itemCountForAutoLayout = Array.isArray(payload.items) ? payload.items.length : 0;
  const itemsForAutoLayout = useMemo(() => (Array.isArray(payload.items) ? payload.items : []), [payload.items]);
  const itemsTableMetrics = useMemo(
    () => getItemsTablePageMetrics(document, itemCountForAutoLayout, itemsForAutoLayout),
    [document, itemCountForAutoLayout, itemsForAutoLayout],
  );
  const flowElementIds = useMemo(() => new Set(
    visibleElements
      .filter(element => shouldFlowElementAfterItems(element, zonesById, itemsTableMetrics.y))
      .map(element => element.id),
  ), [itemsTableMetrics.y, visibleElements, zonesById]);
  const elementTopOverridesMm = useMemo(() => buildFlowElementTopOverrides({
    elements: visibleElements,
    zonesById,
    tableTopMm: itemsTableMetrics.y,
    tableBottomMm: itemsTableMetrics.bottom,
    pageHeightMm: page.height,
    safePaddingMm: Number(document.canvas?.safePaddingMm ?? 5) || 0,
  }), [document.canvas?.safePaddingMm, itemsTableMetrics.bottom, itemsTableMetrics.y, page.height, visibleElements, zonesById]);
  const contentHeightMm = useMemo(() => {
    const elementBottom = visibleElements.reduce((max, element) => {
      const topMm = elementTopOverridesMm.has(element.id)
        ? elementTopOverridesMm.get(element.id)
        : getFlowElementBaseTopMm(element, zonesById);
      return Math.max(max, topMm + getFlowElementHeightMm(element));
    }, itemsTableMetrics.bottom);
    return Math.ceil(Math.max(page.height, elementBottom + 3) / page.height) * page.height;
  }, [elementTopOverridesMm, itemsTableMetrics.bottom, page.height, visibleElements, zonesById]);
  const pageHeightPx = contentHeightMm * PX_PER_MM * zoom;
  const physicalPageHeightPx = page.height * PX_PER_MM * zoom;
  const editorPageCount = Math.max(1, Math.ceil(contentHeightMm / page.height));
  const snapTargets = useMemo(() => buildSnapTargets(document, page, selectedId, itemCountForAutoLayout, itemsForAutoLayout), [document, itemCountForAutoLayout, itemsForAutoLayout, page, selectedId]);
  const rulerXTicks = useMemo(() => buildRulerTicks(page.width, zoom, 'x'), [page.width, zoom]);
  const rulerYTicks = useMemo(() => buildRulerTicks(contentHeightMm, zoom, 'y'), [contentHeightMm, zoom]);

  const handleDrop = useCallback((event) => {
    const type = event.dataTransfer.getData('application/x-kha-invoice-element');
    if (!type || !pageRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const rect = pageRef.current.getBoundingClientRect();
    const xMm = (event.clientX - rect.left) / (PX_PER_MM * zoom);
    const yMm = (event.clientY - rect.top) / (PX_PER_MM * zoom);
    onAddElement?.(type, {
      zoneId: PAGE_ZONE_ID,
      frame: {
        x: Math.max(0, clampToGrid(xMm, snapGridMm, snapEnabled)),
        y: Math.max(0, clampToGrid(yMm, snapGridMm, snapEnabled)),
      },
    });
  }, [onAddElement, snapEnabled, snapGridMm, zoom]);

  useEffect(() => {
    const handler = (event) => {
      if (!selectedId || selectedId === 'itemsTable' || event.target?.tagName === 'INPUT' || event.target?.tagName === 'TEXTAREA' || event.target?.tagName === 'SELECT') return;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const element = (document.elements || []).find(item => item.id === selectedId);
      if (!element || element.locked) return;
      event.preventDefault();
      const step = event.shiftKey ? 1 : 0.5;
      const delta = {
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
      }[event.key];
      const zone = zonesById.get(element.zoneId);
      onUpdateElement?.(element.id, { frame: clampFrameToZone({ ...element.frame, x: Number(element.frame.x || 0) + delta.x, y: Number(element.frame.y || 0) + delta.y }, zone) });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [document.elements, onUpdateElement, selectedId, zonesById]);

  return (
    <section className="invoice-editor-canvas-shell">
      {showRuler && (
        <div className="invoice-editor-ruler-wrap" style={{ paddingLeft: '28px' }}>
          <div className="invoice-editor-ruler-corner" />
          <div className="invoice-editor-ruler invoice-editor-ruler-top" style={{ width: `${pageWidthPx}px` }}>
            {rulerXTicks.map(tick => <span key={tick.value} className={tick.major ? 'is-major' : ''} style={tick.style}>{tick.major ? tick.value : ''}</span>)}
          </div>
        </div>
      )}
      <div className={`invoice-editor-stage-scroll ${showRuler ? 'has-ruler' : ''}`}>
        {showRuler && (
          <div className="invoice-editor-ruler invoice-editor-ruler-left" style={{ height: `${pageHeightPx}px` }}>
            {rulerYTicks.map(tick => <span key={tick.value} className={tick.major ? 'is-major' : ''} style={tick.style}>{tick.major ? tick.value : ''}</span>)}
          </div>
        )}
        <div
          ref={pageRef}
          className={`invoice-editor-page ${showGrid ? 'show-grid' : ''}`}
          style={{
            width: `${pageWidthPx}px`,
            minWidth: `${pageWidthPx}px`,
            height: `${pageHeightPx}px`,
            '--editor-grid-size': `${PX_PER_MM * zoom * snapGridMm}px`,
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          onClick={() => onSelect?.('')}
        >
          {showSafeArea && (
            <div
              className="invoice-editor-safe-area"
              style={{
                left: `${(Number(document.canvas?.safePaddingMm) || 0) * PX_PER_MM * zoom}px`,
                top: `${(Number(document.canvas?.safePaddingMm) || 0) * PX_PER_MM * zoom}px`,
                right: `${(Number(document.canvas?.safePaddingMm) || 0) * PX_PER_MM * zoom}px`,
                bottom: `${(Number(document.canvas?.safePaddingMm) || 0) * PX_PER_MM * zoom}px`,
              }}
            />
          )}
          {editorPageCount > 1 && Array.from({ length: editorPageCount - 1 }).map((_, index) => (
            <div
              key={`page-break-${index}`}
              className="invoice-editor-page-break"
              style={{ top: `${(index + 1) * physicalPageHeightPx}px` }}
            >
              <span>Trang {index + 2}</span>
            </div>
          ))}
          {guideZones.map(zone => (
            <div
              key={zone.id}
              className={`invoice-editor-zone invoice-editor-zone-${zone.type}`}
              style={{
                left: `${zone.frame.x * PX_PER_MM * zoom}px`,
                top: `${zone.frame.y * PX_PER_MM * zoom}px`,
                width: `${zone.frame.w * PX_PER_MM * zoom}px`,
                height: `${zone.frame.h * PX_PER_MM * zoom}px`,
              }}
            >
              <span>{zone.id}</span>
            </div>
          ))}
          {guides.x.map(value => (
            <div key={`x-${value}`} className="invoice-editor-alignment-guide invoice-editor-alignment-guide-x" style={{ left: `${value * PX_PER_MM * zoom}px` }} />
          ))}
          {guides.y.map(value => (
            <div key={`y-${value}`} className="invoice-editor-alignment-guide invoice-editor-alignment-guide-y" style={{ top: `${value * PX_PER_MM * zoom}px` }} />
          ))}
          <TablePreview
            document={document}
            payload={payload}
            selected={selectedId === 'itemsTable'}
            zoom={zoom}
            snapEnabled={snapEnabled}
            snapGridMm={snapGridMm}
            snapTargets={snapTargets}
            guides={guides}
            pageZone={pageZone}
            onSelect={onSelect}
            onUpdateTable={onUpdateTable}
            onGuideChange={setGuides}
            onBeginHistory={onBeginHistory}
            onEndHistory={onEndHistory}
          />
          {visibleElements.map(element => {
            const zone = zonesById.get(element.zoneId);
            if (!zone) return null;
            const isAutoBelowItems = isAutoBelowItemsElement(element);
            const baseTopMm = getFlowElementBaseTopMm(element, zonesById);
            const topMm = elementTopOverridesMm.has(element.id)
              ? elementTopOverridesMm.get(element.id)
              : baseTopMm;
            const isFlowShifted = flowElementIds.has(element.id) && Math.abs(topMm - baseTopMm) > 0.001;
            const pageFrame = {
              ...element.frame,
              x: Number(zone.frame.x || 0) + Number(element.frame.x || 0),
              y: topMm,
            };
            const interactionZone = { ...zone, frame: { x: 0, y: 0, w: page.width, h: contentHeightMm } };
            const lockY = isAutoBelowItems || isFlowShifted;
            return (
              <ElementFrame
                key={element.id}
                element={{ ...element, frame: pageFrame }}
                zone={interactionZone}
                zoom={zoom}
                selected={selectedId === element.id}
                snapEnabled={snapEnabled}
                snapGridMm={snapGridMm}
                snapTargets={snapTargets}
                lockY={lockY}
                onGuideChange={setGuides}
                onGestureStart={onBeginHistory}
                onGestureEnd={onEndHistory}
                onSelect={onSelect}
                onFrameChange={(nextPageFrame) => {
                  const targetZone = interactionZone;
                  const localFrame = {
                    ...nextPageFrame,
                    x: nextPageFrame.x - Number(targetZone.frame.x || 0),
                    y: lockY ? Number(element.frame?.y || 0) : nextPageFrame.y - Number(targetZone.frame.y || 0),
                  };
                  onUpdateElement?.(element.id, {
                    zoneId: targetZone.id,
                    frame: clampFrameToZone(localFrame, targetZone, { minW: element.type === 'line' ? 2 : 3, minH: element.type === 'line' ? 0.5 : 3 }),
                  });
                }}
              >
                <ElementContent element={element} template={template} payload={payload} />
              </ElementFrame>
            );
          })}
        </div>
      </div>
      <div className="invoice-editor-canvas-footer">
        <span>{page.paperSize} {page.orientation === 'landscape' ? 'ngang' : 'dọc'} · {page.width}×{page.height}mm · zoom {Math.round(zoom * 100)}%</span>
        <span>Snap grid {snapEnabled ? `${snapGridMm}mm + alignment` : 'OFF'} · Arrow 0.5mm · Shift+Arrow 1mm</span>
      </div>
    </section>
  );
}
