import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';
import { getEditorPaperDimensions, getElementLabel, getTableStyleElement, PAGE_ZONE_ID, TABLE_COLUMN_LABELS, TABLE_STYLE_ELEMENT_ID } from './templateSchemaAdapter';

function NumberField({ label, value, min, max, step = 0.5, suffix = 'mm', disabled = false, onChange }) {
  return (
    <label className="invoice-editor-prop-field">
      <span>{label}</span>
      <div>
        <input type="number" value={value ?? ''} min={min} max={max} step={step} disabled={disabled} onChange={event => onChange?.(event.target.value === '' ? '' : Number(event.target.value))} />
        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  );
}

function TextField({ label, value, onChange, multiline = false }) {
  return (
    <label className="invoice-editor-prop-field invoice-editor-prop-field-full">
      <span>{label}</span>
      {multiline ? (
        <textarea rows={3} value={value || ''} onChange={event => onChange?.(event.target.value)} />
      ) : (
        <input type="text" value={value || ''} onChange={event => onChange?.(event.target.value)} />
      )}
    </label>
  );
}

function SelectField({ label, value, options = [], onChange }) {
  return (
    <label className="invoice-editor-prop-field">
      <span>{label}</span>
      <select value={value || ''} onChange={event => onChange?.(event.target.value)}>
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function ColorField({ label, value, onChange, allowTransparent = false }) {
  const color = /^#(?:[0-9a-f]{3}){1,2}$/i.test(String(value || '')) ? value : '#111827';
  return (
    <label className="invoice-editor-prop-field">
      <span>{label}</span>
      <div>
        <input type="color" value={color} onChange={event => onChange?.(event.target.value)} />
        <small>{value || (allowTransparent ? 'none' : '#111827')}</small>
      </div>
    </label>
  );
}

function ToggleField({ label, checked, onChange }) {
  return (
    <button type="button" className={`invoice-editor-prop-toggle ${checked ? 'is-on' : ''}`} onClick={() => onChange?.(!checked)}>
      <span>{label}</span>
      <b>{checked ? 'ON' : 'OFF'}</b>
    </button>
  );
}

function AlignField({ value, onChange }) {
  const items = [
    { value: 'left', icon: <AlignLeft size={14} />, label: 'Trái' },
    { value: 'center', icon: <AlignCenter size={14} />, label: 'Giữa' },
    { value: 'right', icon: <AlignRight size={14} />, label: 'Phải' },
  ];
  return (
    <div className="invoice-editor-align-field">
      {items.map(item => (
        <button key={item.value} type="button" className={value === item.value ? 'is-active' : ''} onClick={() => onChange?.(item.value)} title={item.label}>
          {item.icon}
        </button>
      ))}
    </div>
  );
}

const FONT_OPTIONS = [
  { value: 'system', label: 'System Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
];

const OBJECT_FIT_OPTIONS = [
  { value: 'contain', label: 'Contain' },
  { value: 'cover', label: 'Cover' },
  { value: 'fill', label: 'Fill' },
];

const PAPER_SIZE_OPTIONS = [
  { value: 'A4', label: 'A4' },
  { value: 'A5', label: 'A5' },
  { value: 'K80', label: 'K80' },
  { value: 'K57', label: 'K57' },
];

const ORIENTATION_OPTIONS = [
  { value: 'portrait', label: 'Dọc' },
  { value: 'landscape', label: 'Ngang' },
];

const FONT_WEIGHT_OPTIONS = [
  { value: '400', label: '400' },
  { value: '500', label: '500' },
  { value: '600', label: '600' },
  { value: '700', label: '700' },
  { value: '800', label: '800' },
  { value: '900', label: '900' },
];

function AlignPresetButtons({ onAlign }) {
  return (
    <div className="invoice-editor-align-presets">
      <button type="button" onClick={() => onAlign?.('left')}>Trái</button>
      <button type="button" onClick={() => onAlign?.('center')}>Giữa</button>
      <button type="button" onClick={() => onAlign?.('right')}>Phải</button>
      <button type="button" onClick={() => onAlign?.('top')}>Trên</button>
      <button type="button" onClick={() => onAlign?.('middle')}>Dọc giữa</button>
      <button type="button" onClick={() => onAlign?.('bottom')}>Dưới</button>
    </div>
  );
}

function buildAlignedFrame(frame = {}, page = {}, mode = 'left') {
  const width = Number(frame.w) || 1;
  const height = frame.h === 'auto' ? 0 : (Number(frame.h) || 1);
  const next = { ...frame };
  if (mode === 'left') next.x = 0;
  if (mode === 'center') next.x = Math.max(0, (Number(page.width) - width) / 2);
  if (mode === 'right') next.x = Math.max(0, Number(page.width) - width);
  if (mode === 'top') next.y = 0;
  if (mode === 'middle' && height > 0) next.y = Math.max(0, (Number(page.height) - height) / 2);
  if (mode === 'bottom' && height > 0) next.y = Math.max(0, Number(page.height) - height);
  return next;
}

function TableProperties({ document, onUpdateTable, onUpdateElement }) {
  const table = document.table || {};
  const frame = table.frame || {};
  const page = getEditorPaperDimensions(document);
  const styleElement = getTableStyleElement(document) || {};
  const style = styleElement.style || {};
  const columns = Array.isArray(table.columns) ? table.columns : [];
  const totalWidth = columns.reduce((sum, column) => sum + (Number(column.widthMm) || 0), 0);

  const updateStyle = (patch) => {
    if (!styleElement.id) return;
    onUpdateElement?.(styleElement.id, { style: { ...style, ...patch } });
  };

  const updateFrame = (patch) => {
    onUpdateTable?.({ frame: { ...frame, ...patch } });
  };

  return (
    <div className="invoice-editor-properties-content">
      <section>
        <h4>Khung sản phẩm</h4>
        <AlignPresetButtons onAlign={mode => onUpdateTable?.({ zoneId: PAGE_ZONE_ID, frame: buildAlignedFrame(frame, page, mode) })} />
        <div className="invoice-editor-prop-grid">
          <NumberField label="X" value={frame.x || 0} onChange={value => updateFrame({ x: Number(value) || 0 })} />
          <NumberField label="Y" value={frame.y || 0} onChange={value => updateFrame({ y: Number(value) || 0 })} />
          <NumberField label="Width" value={frame.w || 0} min={10} onChange={value => updateFrame({ w: Number(value) || 10 })} />
          <NumberField label="Height" value={frame.h === 'auto' ? '' : (frame.h || 32)} min={8} onChange={value => updateFrame({ h: Number(value) || 8 })} />
          <NumberField label="Padding" value={style.paddingMm ?? 1.35} min={0} max={5} step={0.1} onChange={value => updateStyle({ paddingMm: Number(value) || 0 })} />
          <NumberField label="Row gap" value={style.rowGapMm ?? 0} min={0} max={4} step={0.1} onChange={value => updateStyle({ rowGapMm: Number(value) || 0 })} />
          <NumberField label="Font" value={style.fontSizePt ?? 8.2} min={5} max={14} step={0.25} suffix="pt" onChange={value => updateStyle({ fontSizePt: Number(value) || 8 })} />
          <NumberField label="Header font" value={style.headerFontSizePt ?? 7.6} min={5} max={14} step={0.25} suffix="pt" onChange={value => updateStyle({ headerFontSizePt: Number(value) || 7.5 })} />
          <SelectField label="Đậm chữ" value={String(style.fontWeight || 400)} options={FONT_WEIGHT_OPTIONS} onChange={value => updateStyle({ fontWeight: Number(value) || 400 })} />
          <SelectField label="Đậm header" value={String(style.headerFontWeight || 900)} options={FONT_WEIGHT_OPTIONS} onChange={value => updateStyle({ headerFontWeight: Number(value) || 900 })} />
          <NumberField label="Border" value={style.borderWidthMm ?? 0.22} min={0} max={1} step={0.05} onChange={value => updateStyle({ borderWidthMm: Number(value) || 0 })} />
          <NumberField label="Line height" value={style.lineHeight ?? 1.18} min={1} max={2} step={0.05} suffix="x" onChange={value => updateStyle({ lineHeight: Number(value) || 1.18 })} />
          <ColorField label="Màu viền" value={style.borderColor || '#cbd5e1'} onChange={value => updateStyle({ borderColor: value })} />
          <ColorField label="Header BG" value={style.headerBackgroundColor || '#e2e8f0'} onChange={value => updateStyle({ headerBackgroundColor: value })} />
          <ColorField label="Header text" value={style.headerColor || '#0f172a'} onChange={value => updateStyle({ headerColor: value })} />
        </div>
        <ToggleField label="Auto height theo số dòng" checked={frame.h === 'auto'} onChange={value => updateFrame({ h: value ? 'auto' : 32 })} />
        <ToggleField label="Border bảng" checked={style.tableBorder !== false} onChange={value => updateStyle({ tableBorder: value, borderWidthMm: value ? (style.borderWidthMm ?? 0.22) : 0 })} />
        <ToggleField label="Header repeat khi in" checked={table.headerRepeat !== false} onChange={value => onUpdateTable?.({ headerRepeat: value })} />
        <ToggleField label="Cho phép qua trang" checked={table.allowPageBreak !== false} onChange={value => onUpdateTable?.({ allowPageBreak: value })} />
        <ToggleField label="Hiện SKU" checked={style.showSku === true} onChange={value => updateStyle({ showSku: value })} />
      </section>
      <section>
        <h4>Độ rộng cột ({Math.round(totalWidth * 10) / 10}mm)</h4>
        <div className="invoice-editor-table-columns">
          {columns.map((column, index) => (
            <div key={`${column.key}-${index}`} className="invoice-editor-table-column-row">
              <input value={column.label || TABLE_COLUMN_LABELS[column.key] || column.key} onChange={event => {
                const nextColumns = [...columns];
                nextColumns[index] = { ...column, label: event.target.value };
                onUpdateTable?.({ columns: nextColumns });
              }} />
              <input type="number" min="4" max="120" step="0.5" value={column.widthMm} onChange={event => {
                const nextColumns = [...columns];
                nextColumns[index] = { ...column, widthMm: Number(event.target.value) || 4 };
                onUpdateTable?.({ columns: nextColumns });
              }} />
              <select value={column.align || 'left'} onChange={event => {
                const nextColumns = [...columns];
                nextColumns[index] = { ...column, align: event.target.value };
                onUpdateTable?.({ columns: nextColumns });
              }}>
                <option value="left">Trái</option>
                <option value="center">Giữa</option>
                <option value="right">Phải</option>
              </select>
            </div>
          ))}
        </div>
        <p className="invoice-editor-prop-note">Tên sản phẩm tự xuống dòng, không ép nowrap để hạn chế vỡ layout A5.</p>
      </section>
    </div>
  );
}

export default function PropertiesPanel({
  document,
  settings,
  selectedElement,
  selectedId,
  onUpdateElement,
  onUpdateTable,
  onUpdateSettings,
  onSetDocument,
}) {
  const editor = settings?.editor || {};
  const page = getEditorPaperDimensions(document);
  const paperSize = document.canvas?.pageSize || 'A5';
  const isTable = selectedId === 'itemsTable' || selectedElement?.type === 'itemsTable';
  const element = !isTable && selectedElement && selectedElement.id !== TABLE_STYLE_ELEMENT_ID ? selectedElement : null;
  const isTotalsAuto = element?.type === 'totals' && element.style?.autoBelowItems !== false;

  const updateElementStyle = (patch) => {
    if (!element) return;
    onUpdateElement?.(element.id, { style: { ...element.style, ...patch } });
  };

  const updateCanvas = (patch) => {
    const nextPaperSize = patch.pageSize || document.canvas?.pageSize || 'A5';
    onSetDocument?.({
      ...document,
      canvas: {
        ...document.canvas,
        ...patch,
        orientation: String(nextPaperSize).startsWith('K') ? 'portrait' : (patch.orientation || document.canvas?.orientation || 'portrait'),
      },
    });
  };

  return (
    <aside className="invoice-editor-panel invoice-editor-properties">
      <div className="invoice-editor-panel-title">Thuộc tính</div>
      <section className="invoice-editor-properties-section">
        <h4>Canvas</h4>
        <div className="invoice-editor-prop-grid">
          <SelectField label="Khổ giấy" value={paperSize} options={PAPER_SIZE_OPTIONS} onChange={value => updateCanvas({ pageSize: value })} />
          <SelectField label="Hướng" value={document.canvas?.orientation || 'portrait'} options={ORIENTATION_OPTIONS} onChange={value => updateCanvas({ orientation: value })} />
          <NumberField label="Safe" value={document.canvas?.safePaddingMm ?? 8} min={0} max={30} step={0.5} onChange={value => updateCanvas({ safePaddingMm: Number(value) || 0 })} />
          <NumberField label="Grid" value={editor.snapGridMm ?? 1} min={0.1} max={10} step={0.1} onChange={value => onUpdateSettings?.(current => ({ ...current, editor: { ...current.editor, snapGridMm: Number(value) || 1 } }))} />
        </div>
        <ToggleField label="Hiện ruler" checked={editor.showRuler !== false} onChange={value => onUpdateSettings?.(current => ({ ...current, editor: { ...current.editor, showRuler: value } }))} />
        <ToggleField label="Hiện safe area" checked={editor.showSafeArea !== false} onChange={value => onUpdateSettings?.(current => ({ ...current, editor: { ...current.editor, showSafeArea: value } }))} />
      </section>

      {isTable ? (
        <TableProperties document={document} onUpdateTable={onUpdateTable} onUpdateElement={onUpdateElement} />
      ) : element ? (
        <div className="invoice-editor-properties-content">
          <section>
            <h4>{getElementLabel(element)}</h4>
            <AlignPresetButtons onAlign={mode => onUpdateElement?.(element.id, { zoneId: PAGE_ZONE_ID, frame: buildAlignedFrame(element.frame || {}, page, mode) })} />
            <div className="invoice-editor-prop-grid">
              <NumberField label="X" value={element.frame?.x || 0} onChange={value => onUpdateElement?.(element.id, { frame: { ...element.frame, x: Number(value) || 0 } })} />
              <NumberField label={isTotalsAuto ? 'Y (auto)' : 'Y'} value={element.frame?.y || 0} disabled={isTotalsAuto} onChange={value => onUpdateElement?.(element.id, { frame: { ...element.frame, y: Number(value) || 0 } })} />
              <NumberField label="Width" value={element.frame?.w || 0} min={1} onChange={value => onUpdateElement?.(element.id, { frame: { ...element.frame, w: Number(value) || 1 } })} />
              <NumberField label="Height" value={element.frame?.h || 0} min={0.5} onChange={value => onUpdateElement?.(element.id, { frame: { ...element.frame, h: Number(value) || 1 } })} />
            </div>
            <ToggleField label="Hiển thị" checked={element.visible !== false} onChange={value => onUpdateElement?.(element.id, { visible: value })} />
            <ToggleField label="Khóa vị trí" checked={element.locked === true} onChange={value => onUpdateElement?.(element.id, { locked: value })} />
          </section>
          <section>
            <h4>Typography & style</h4>
            <div className="invoice-editor-prop-grid">
              <NumberField label="Font" value={element.style?.fontSizePt ?? ''} min={5} max={24} step={0.25} suffix="pt" onChange={value => updateElementStyle({ fontSizePt: Number(value) || undefined })} />
              <NumberField label="Line" value={element.style?.lineHeight ?? ''} min={0.8} max={3} step={0.05} suffix="x" onChange={value => updateElementStyle({ lineHeight: Number(value) || undefined })} />
              <NumberField label="Opacity" value={element.style?.opacity ?? 1} min={0} max={1} step={0.05} suffix="" onChange={value => updateElementStyle({ opacity: Number(value) })} />
              <NumberField label="Padding" value={element.style?.paddingMm ?? 0} min={0} max={8} step={0.1} onChange={value => updateElementStyle({ paddingMm: Number(value) || 0 })} />
              <NumberField label="Spacing" value={element.style?.spacingMm ?? 0} min={0} max={8} step={0.1} onChange={value => updateElementStyle({ spacingMm: Number(value) || 0 })} />
              <NumberField label="Radius" value={element.style?.borderRadiusMm ?? 0} min={0} max={20} step={0.1} onChange={value => updateElementStyle({ borderRadiusMm: Number(value) || 0 })} />
              <NumberField label="Border" value={element.style?.borderWidthMm ?? 0} min={0} max={2} step={0.05} onChange={value => updateElementStyle({ borderWidthMm: Number(value) || 0 })} />
              <SelectField label="Font family" value={element.style?.fontFamily || 'system'} options={FONT_OPTIONS} onChange={value => updateElementStyle({ fontFamily: value })} />
              <ColorField label="Text" value={element.style?.color || '#111827'} onChange={value => updateElementStyle({ color: value })} />
              <ColorField label="Border" value={element.style?.borderColor || '#cbd5e1'} onChange={value => updateElementStyle({ borderColor: value })} />
              <ColorField label="Background" value={element.style?.backgroundColor || '#ffffff'} allowTransparent onChange={value => updateElementStyle({ backgroundColor: value })} />
            </div>
            <AlignField value={element.style?.align || 'left'} onChange={value => updateElementStyle({ align: value })} />
            <ToggleField label="Bold" checked={element.style?.bold === true} onChange={value => updateElementStyle({ bold: value })} />
          </section>
          {element.type === 'totals' && (
            <section>
              <h4>Tự động theo đơn hàng</h4>
              <ToggleField label="Nằm dưới danh sách sản phẩm" checked={isTotalsAuto} onChange={value => updateElementStyle({ autoBelowItems: value })} />
              <div className="invoice-editor-prop-grid">
                <NumberField label="Cách bảng" value={element.style?.autoGapMm ?? 3} min={0} max={30} step={0.5} disabled={!isTotalsAuto} onChange={value => updateElementStyle({ autoGapMm: Number(value) || 0 })} />
              </div>
              <p className="invoice-editor-prop-note">Khi bật, khối tổng tiền tự chạy xuống dưới chân bảng sản phẩm theo số dòng của đơn hàng; kéo ngang vẫn dùng X/Width, vị trí Y do hệ thống tính.</p>
            </section>
          )}
          {element.type === 'totals' && (
            <section>
              <h4>Dòng hiển thị</h4>
              <ToggleField label="Tổng tiền hàng" checked={element.style?.showSubtotal !== false} onChange={value => updateElementStyle({ showSubtotal: value })} />
              <ToggleField label="Chiết khấu" checked={element.style?.showDiscount !== false} onChange={value => updateElementStyle({ showDiscount: value })} />
              <ToggleField label="Tổng tiền" checked={element.style?.showGrandTotal !== false} onChange={value => updateElementStyle({ showGrandTotal: value })} />
              <ToggleField label="Công nợ" checked={element.style?.showDebt !== false} onChange={value => updateElementStyle({ showDebt: value })} />
              <p className="invoice-editor-prop-note">Tắt dòng nào thì dòng đó ẩn khỏi khung thiết kế và bản in hóa đơn.</p>
            </section>
          )}
          {element.type === 'storeInfo' && (
            <section>
              <h4>Thông tin cửa hàng</h4>
              <div className="invoice-editor-prop-grid">
                <TextField label="Nhãn SĐT" value={element.style?.storePhoneLabel || ''} onChange={value => updateElementStyle({ storePhoneLabel: value })} />
              </div>
              <ToggleField label="Hiện tên cửa hàng" checked={element.style?.showStoreName !== false} onChange={value => updateElementStyle({ showStoreName: value })} />
              <ToggleField label="Hiện địa chỉ" checked={element.style?.showStoreAddress !== false} onChange={value => updateElementStyle({ showStoreAddress: value })} />
              <ToggleField label="Hiện số điện thoại" checked={element.style?.showStorePhone !== false} onChange={value => updateElementStyle({ showStorePhone: value })} />
              <ToggleField label="Hiện email" checked={element.style?.showStoreEmail !== false} onChange={value => updateElementStyle({ showStoreEmail: value })} />
              <ToggleField label="Hiện mã số thuế" checked={element.style?.showStoreTaxCode !== false} onChange={value => updateElementStyle({ showStoreTaxCode: value })} />
            </section>
          )}
          {element.type === 'invoiceTitle' && (
            <section>
              <h4>Tiêu đề hóa đơn</h4>
              <TextField label="Tiêu đề" value={element.style?.titleText || ''} onChange={value => updateElementStyle({ titleText: value })} />
              <TextField label="Tiêu đề phụ" value={element.style?.subtitleText || ''} onChange={value => updateElementStyle({ subtitleText: value })} />
              <ToggleField label="Hiện tiêu đề" checked={element.style?.showTitle !== false} onChange={value => updateElementStyle({ showTitle: value })} />
              <ToggleField label="Hiện tiêu đề phụ" checked={element.style?.showSubtitle !== false} onChange={value => updateElementStyle({ showSubtitle: value })} />
              <ToggleField label="Hiện mã hóa đơn" checked={element.style?.showInvoiceCode !== false} onChange={value => updateElementStyle({ showInvoiceCode: value })} />
            </section>
          )}
          {element.type === 'customerInfo' && (
            <section>
              <h4>Thông tin khách hàng</h4>
              <div className="invoice-editor-prop-grid">
                <TextField label="Nhãn tên" value={element.style?.customerNameLabel || ''} onChange={value => updateElementStyle({ customerNameLabel: value })} />
                <TextField label="Nhãn SĐT" value={element.style?.customerPhoneLabel || ''} onChange={value => updateElementStyle({ customerPhoneLabel: value })} />
                <TextField label="Nhãn địa chỉ" value={element.style?.customerAddressLabel || ''} onChange={value => updateElementStyle({ customerAddressLabel: value })} />
                <TextField label="Nhãn MST" value={element.style?.customerTaxCodeLabel || ''} onChange={value => updateElementStyle({ customerTaxCodeLabel: value })} />
              </div>
              <ToggleField label="Hiện tên khách" checked={element.style?.showCustomerName !== false} onChange={value => updateElementStyle({ showCustomerName: value })} />
              <ToggleField label="Hiện SĐT" checked={element.style?.showCustomerPhone !== false} onChange={value => updateElementStyle({ showCustomerPhone: value })} />
              <ToggleField label="Hiện địa chỉ" checked={element.style?.showCustomerAddress !== false} onChange={value => updateElementStyle({ showCustomerAddress: value })} />
              <ToggleField label="Hiện MST" checked={element.style?.showCustomerTaxCode !== false} onChange={value => updateElementStyle({ showCustomerTaxCode: value })} />
              <ToggleField label="Hiện loại khách" checked={element.style?.showCustomerType === true} onChange={value => updateElementStyle({ showCustomerType: value })} />
            </section>
          )}
          {element.type === 'invoiceMeta' && (
            <section>
              <h4>Thông tin đơn hàng</h4>
              <div className="invoice-editor-prop-grid">
                <TextField label="Nhãn mã đơn" value={element.style?.orderCodeLabel || ''} onChange={value => updateElementStyle({ orderCodeLabel: value })} />
                <TextField label="Nhãn ngày" value={element.style?.orderDateLabel || ''} onChange={value => updateElementStyle({ orderDateLabel: value })} />
                <TextField label="Nhãn nhân viên" value={element.style?.sellerLabelShort || ''} onChange={value => updateElementStyle({ sellerLabelShort: value })} />
              </div>
              <ToggleField label="Hiện mã đơn" checked={element.style?.showOrderCode !== false} onChange={value => updateElementStyle({ showOrderCode: value })} />
              <ToggleField label="Hiện ngày giờ" checked={element.style?.showOrderDate !== false} onChange={value => updateElementStyle({ showOrderDate: value })} />
              <ToggleField label="Hiện nhân viên" checked={element.style?.showSeller !== false} onChange={value => updateElementStyle({ showSeller: value })} />
              <ToggleField label="Hiện nguồn đơn" checked={element.style?.showOrderSource === true} onChange={value => updateElementStyle({ showOrderSource: value })} />
            </section>
          )}
          {(element.type === 'customText' || element.type === 'text' || element.type === 'footerText') && (
            <section>
              <h4>{element.type === 'footerText' ? 'Footer hóa đơn' : 'Nội dung'}</h4>
              <TextField label="Text" multiline value={element.style?.text || ''} onChange={value => updateElementStyle({ text: value })} />
              {element.type === 'footerText' && <p className="invoice-editor-prop-note">Có thể dùng biến {'{time}'}, {'{date}'}, {'{invoiceCode}'}, {'{customerName}'}, {'{storeName}'}.</p>}
            </section>
          )}
          {(element.type === 'image' || element.type === 'logo') && (
            <section>
              <h4>{element.type === 'logo' ? 'Logo hóa đơn' : 'Ảnh'}</h4>
              {element.type === 'image' && <TextField label="URL ảnh" value={element.style?.src || ''} onChange={value => updateElementStyle({ src: value })} />}
              <SelectField label="Object fit" value={element.style?.objectFit || 'contain'} options={OBJECT_FIT_OPTIONS} onChange={value => updateElementStyle({ objectFit: value })} />
              {element.type === 'logo' && <p className="invoice-editor-prop-note">Logo lấy từ API upload field logo và bind template.logo; không nhúng binary vào layout JSON.</p>}
            </section>
          )}
          {element.type === 'signatures' && (
            <section>
              <h4>Chữ ký / con dấu</h4>
              <div className="invoice-editor-prop-grid">
                <TextField label="Nhãn bên khách" value={element.style?.buyerLabel || ''} onChange={value => updateElementStyle({ buyerLabel: value })} />
                <TextField label="Nhãn bên bán" value={element.style?.sellerLabel || ''} onChange={value => updateElementStyle({ sellerLabel: value })} />
                <TextField label="Gợi ý ký khách" value={element.style?.buyerHint || ''} onChange={value => updateElementStyle({ buyerHint: value })} />
                <TextField label="Gợi ý ký bán" value={element.style?.sellerHint || ''} onChange={value => updateElementStyle({ sellerHint: value })} />
                <NumberField label="Khoảng cách" value={element.style?.signatureGapMm ?? 10} min={0} max={40} step={0.5} onChange={value => updateElementStyle({ signatureGapMm: Number(value) || 0 })} />
                <NumberField label="Khoảng trống ký" value={element.style?.blankHeightMm ?? 10} min={0} max={40} step={0.5} onChange={value => updateElementStyle({ blankHeightMm: Number(value) || 0 })} />
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="invoice-editor-empty-props">Chọn một thành phần hoặc bảng sản phẩm để chỉnh thuộc tính.</div>
      )}
    </aside>
  );
}
