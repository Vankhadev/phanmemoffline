import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ElementFrame from './ElementFrame';
import {
  clampFrameToZone,
  getEditorPaperDimensions,
  getElementLabel,
  getTableStyleElement,
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

function getInvoiceCode(payload = {}) {
  return payload.invoice?.invoice_code || payload.invoice?.code || payload.metadata?.invoice_code || 'HD-000000';
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
  return template.logo?.url || template.logo_url || template.logo_url_resolved || template.header_logo || payload.store?.logo_url || '';
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
  const payment = payload.payment || {};
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
        <b>{store.name || template.shop_name || 'Cửa hàng'}</b>
        <span>{store.address || template.shop_address || 'Địa chỉ cửa hàng'}</span>
        <span>ĐT: {store.phone || template.shop_phone || '—'}</span>
      </div>
    );
  }

  if (element.type === 'invoiceTitle') {
    return (
      <div className="invoice-editor-preview-title" style={baseStyle}>
        <b>HÓA ĐƠN</b>
        <span>BÁN HÀNG</span>
        <small>{invoiceCode}</small>
      </div>
    );
  }

  if (element.type === 'customerInfo') {
    return (
      <div className="invoice-editor-preview-pairs" style={baseStyle}>
        <div><span>Khách:</span><b>{customer.name || 'Khách lẻ'}</b></div>
        <div><span>SĐT:</span><b>{customer.phone || '—'}</b></div>
        <div><span>Địa chỉ:</span><b>{customer.address || '—'}</b></div>
      </div>
    );
  }

  if (element.type === 'invoiceMeta') {
    return (
      <div className="invoice-editor-preview-pairs" style={baseStyle}>
        <div><span>Mã đơn:</span><b>{invoiceCode}</b></div>
        <div><span>Ngày:</span><b>{formatDate(invoice.created_at)}</b></div>
        <div><span>Thanh toán:</span><b>{payment.method_label || invoice.payment_method || '—'}</b></div>
      </div>
    );
  }

  if (element.type === 'paymentQr') {
    const qrImage = payment.qr_image || payment.qr || '';
    const qrSize = style.qrSizeMm || 13;
    return (
      <div className="invoice-editor-preview-qr" style={baseStyle}>
        <b>{style.showIcon === false ? '' : '▣ '}Thanh toán</b>
        {qrImage && isRenderableImage(qrImage)
          ? <img src={qrImage} alt="QR" style={{ width: `${qrSize}mm`, height: `${qrSize}mm` }} />
          : <span className="invoice-editor-qr-placeholder" style={{ width: `${qrSize}mm`, height: `${qrSize}mm` }}>QR</span>}
        <small>{payment.bank_name || 'Ngân hàng'} · {payment.bank_account || 'STK'}</small>
      </div>
    );
  }

  if (element.type === 'totals') {
    const paid = Number(totals.paid_amount ?? totals.paid ?? 0) || 0;
    const remaining = Number(totals.remaining_amount ?? totals.debt_amount ?? Math.max(0, (Number(totals.total) || 0) - paid)) || 0;
    return (
      <div className="invoice-editor-preview-totals" style={baseStyle}>
        <div><span>Tổng tiền hàng</span><b>{formatVND(totals.subtotal ?? totals.total)}</b></div>
        <div><span>Chiết khấu</span><b>{formatVND(totals.discount_amount)}</b></div>
        <div className="is-total"><span>Tổng tiền</span><b>{formatVND(totals.total ?? totals.grand_total)}</b></div>
        <div><span>Công nợ</span><b>{formatVND(remaining)}</b></div>
      </div>
    );
  }

  if (element.type === 'note') {
    return <div className="invoice-editor-preview-note" style={baseStyle}><b>Ghi chú:</b> {invoice.note || 'Không có ghi chú'}</div>;
  }

  if (element.type === 'signatures') {
    return (
      <div className="invoice-editor-preview-signatures" style={{ ...baseStyle, gap: style.signatureGapMm !== undefined ? `${style.signatureGapMm}mm` : undefined }}>
        <div><b>{signatures.buyer?.label || 'Người nhận'}</b><span>(Ký tên)</span></div>
        <div><b>{signatures.seller?.label || 'Người bán'}</b><span>(Ký tên)</span></div>
      </div>
    );
  }

  if (element.type === 'footerText') {
    return <div className="invoice-editor-preview-footer" style={baseStyle}>Cảm ơn quý khách! · In lúc {formatTime(payload.metadata?.printed_at || new Date().toISOString())}</div>;
  }

  if (element.type === 'line' || element.type === 'separator') {
    return <div className="invoice-editor-preview-line" style={{ borderTopColor: style.color || style.borderColor || '#cbd5e1', borderTopWidth: `${style.borderWidthMm || 0.25}mm`, opacity: style.opacity ?? 1 }} />;
  }

  if (element.type === 'rectangle') {
    return <div className="invoice-editor-preview-rect" style={baseStyle} />;
  }

  if (element.type === 'image') {
    return style.src && isRenderableImage(style.src)
      ? <img className="invoice-editor-preview-image" src={style.src} alt={getElementLabel(element)} style={{ ...baseStyle, objectFit: style.objectFit || 'contain' }} />
      : <div className="invoice-editor-preview-image-empty" style={baseStyle}>Ảnh</div>;
  }

  return <div className="invoice-editor-preview-custom-text" style={{ ...baseStyle, whiteSpace: 'pre-wrap' }}>{style.text || 'Text tùy chỉnh'}</div>;
}

function getPageTableFrame(document = {}) {
  const table = document.table || {};
  const zone = (document.zones || []).find(item => item.id === table.zoneId) || (document.zones || [])[0] || { frame: { x: 0, y: 0, w: 100, h: 30 } };
  const frame = table.frame || { x: 0, y: 0, w: zone.frame?.w || 100, h: 32 };
  return {
    zone,
    frame,
    pageFrame: {
      x: Number(zone.frame?.x || 0) + Number(frame.x || 0),
      y: Number(zone.frame?.y || 0) + Number(frame.y || 0),
      w: Number(frame.w || zone.frame?.w || 100),
      h: Number(frame.h) || 32,
    },
  };
}

function TablePreview({ document, payload, selected, zoom, snapEnabled, snapGridMm, snapTargets, guides, onSelect, onUpdateTable, onGuideChange }) {
  const table = document.table || {};
  const { zone, frame, pageFrame } = getPageTableFrame(document);
  const items = Array.isArray(payload.items) ? payload.items.slice(0, 5) : [];
  const columns = Array.isArray(table.columns) && table.columns.length ? table.columns : [];
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
      onSelect={onSelect}
      onFrameChange={(nextPageFrame) => {
        onUpdateTable?.({
          frame: clampFrameToZone({
            x: nextPageFrame.x - Number(zone.frame?.x || 0),
            y: nextPageFrame.y - Number(zone.frame?.y || 0),
            w: nextPageFrame.w,
            h: nextPageFrame.h,
          }, zone, { minW: 12, minH: 8 }),
        });
      }}
    >
      <div
        className={`invoice-editor-table-frame ${selected ? 'is-selected' : ''}`}
        style={{
          '--editor-table-border-width': `${tableStyle.borderWidthMm ?? 0.2}mm`,
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

function buildSnapTargets(document = {}, page = {}, selectedId = '') {
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

  const tableFrame = getPageTableFrame(document).pageFrame;
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
  const pageHeightPx = page.height * PX_PER_MM * zoom;
  const [guides, setGuides] = useState({ x: [], y: [] });

  const zones = useMemo(() => Array.isArray(document.zones) ? document.zones : [], [document.zones]);
  const zonesById = useMemo(() => new Map(zones.map(zone => [zone.id, zone])), [zones]);
  const visibleElements = useMemo(() => [...(document.elements || [])]
    .filter(element => element.id !== TABLE_STYLE_ELEMENT_ID && element.visible !== false)
    .sort((a, b) => (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0)), [document.elements]);
  const snapTargets = useMemo(() => buildSnapTargets(document, page, selectedId), [document, page, selectedId]);
  const rulerXTicks = useMemo(() => buildRulerTicks(page.width, zoom, 'x'), [page.width, zoom]);
  const rulerYTicks = useMemo(() => buildRulerTicks(page.height, zoom, 'y'), [page.height, zoom]);

  const findZoneAt = useCallback((xMm, yMm) => {
    return zones.find(zone => {
      const frame = zone.frame || {};
      return xMm >= frame.x && yMm >= frame.y && xMm <= frame.x + frame.w && yMm <= frame.y + frame.h;
    }) || zones[0];
  }, [zones]);

  const handleDrop = useCallback((event) => {
    const type = event.dataTransfer.getData('application/x-kha-invoice-element');
    if (!type || !pageRef.current) return;
    event.preventDefault();
    const rect = pageRef.current.getBoundingClientRect();
    const xMm = (event.clientX - rect.left) / (PX_PER_MM * zoom);
    const yMm = (event.clientY - rect.top) / (PX_PER_MM * zoom);
    const zone = findZoneAt(xMm, yMm);
    if (!zone) return;
    onAddElement?.(type, {
      zoneId: zone.id,
      frame: {
        x: Math.max(0, clampToGrid(xMm - zone.frame.x, snapGridMm, snapEnabled)),
        y: Math.max(0, clampToGrid(yMm - zone.frame.y, snapGridMm, snapEnabled)),
      },
    });
  }, [findZoneAt, onAddElement, snapEnabled, snapGridMm, zoom]);

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
          {zones.map(zone => (
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
            onSelect={onSelect}
            onUpdateTable={onUpdateTable}
            onGuideChange={setGuides}
          />
          {visibleElements.map(element => {
            const zone = zonesById.get(element.zoneId);
            if (!zone) return null;
            const pageFrame = {
              ...element.frame,
              x: Number(zone.frame.x || 0) + Number(element.frame.x || 0),
              y: Number(zone.frame.y || 0) + Number(element.frame.y || 0),
            };
            const pageZone = { ...zone, frame: { x: 0, y: 0, w: page.width, h: page.height } };
            return (
              <ElementFrame
                key={element.id}
                element={{ ...element, frame: pageFrame }}
                zone={pageZone}
                zoom={zoom}
                selected={selectedId === element.id}
                snapEnabled={snapEnabled}
                snapGridMm={snapGridMm}
                snapTargets={snapTargets}
                onGuideChange={setGuides}
                onSelect={onSelect}
                onFrameChange={(nextPageFrame) => {
                  const localFrame = {
                    ...nextPageFrame,
                    x: nextPageFrame.x - Number(zone.frame.x || 0),
                    y: nextPageFrame.y - Number(zone.frame.y || 0),
                  };
                  onUpdateElement?.(element.id, { frame: clampFrameToZone(localFrame, zone, { minW: element.type === 'line' ? 2 : 3, minH: element.type === 'line' ? 0.5 : 3 }) });
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
