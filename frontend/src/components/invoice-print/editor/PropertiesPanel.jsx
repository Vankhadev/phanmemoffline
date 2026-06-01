import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';
import { getElementLabel, getTableStyleElement, TABLE_COLUMN_LABELS, TABLE_STYLE_ELEMENT_ID } from './templateSchemaAdapter';

function NumberField({ label, value, min, max, step = 0.5, suffix = 'mm', onChange }) {
  return (
    <label className="invoice-editor-prop-field">
      <span>{label}</span>
      <div>
        <input type="number" value={value ?? ''} min={min} max={max} step={step} onChange={event => onChange?.(event.target.value === '' ? '' : Number(event.target.value))} />
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

function TableProperties({ document, onUpdateTable, onUpdateElement }) {
  const table = document.table || {};
  const frame = table.frame || {};
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
        <div className="invoice-editor-prop-grid">
          <NumberField label="X" value={frame.x || 0} onChange={value => updateFrame({ x: Number(value) || 0 })} />
          <NumberField label="Y" value={frame.y || 0} onChange={value => updateFrame({ y: Number(value) || 0 })} />
          <NumberField label="Width" value={frame.w || 0} min={10} onChange={value => updateFrame({ w: Number(value) || 10 })} />
          <NumberField label="Height" value={frame.h === 'auto' ? '' : (frame.h || 32)} min={8} onChange={value => updateFrame({ h: Number(value) || 8 })} />
          <NumberField label="Padding" value={style.paddingMm ?? 1.35} min={0} max={5} step={0.1} onChange={value => updateStyle({ paddingMm: Number(value) || 0 })} />
          <NumberField label="Row gap" value={style.rowGapMm ?? 0} min={0} max={4} step={0.1} onChange={value => updateStyle({ rowGapMm: Number(value) || 0 })} />
          <NumberField label="Font" value={style.fontSizePt ?? 8.2} min={5} max={14} step={0.25} suffix="pt" onChange={value => updateStyle({ fontSizePt: Number(value) || 8 })} />
          <NumberField label="Header font" value={style.headerFontSizePt ?? 7.6} min={5} max={14} step={0.25} suffix="pt" onChange={value => updateStyle({ headerFontSizePt: Number(value) || 7.5 })} />
          <NumberField label="Border" value={style.borderWidthMm ?? 0.22} min={0} max={1} step={0.05} onChange={value => updateStyle({ borderWidthMm: Number(value) || 0 })} />
          <NumberField label="Line height" value={style.lineHeight ?? 1.18} min={1} max={2} step={0.05} suffix="x" onChange={value => updateStyle({ lineHeight: Number(value) || 1.18 })} />
          <ColorField label="Màu viền" value={style.borderColor || '#cbd5e1'} onChange={value => updateStyle({ borderColor: value })} />
          <ColorField label="Header BG" value={style.headerBackgroundColor || '#e2e8f0'} onChange={value => updateStyle({ headerBackgroundColor: value })} />
          <ColorField label="Header text" value={style.headerColor || '#0f172a'} onChange={value => updateStyle({ headerColor: value })} />
        </div>
        <ToggleField label="Auto height theo số dòng" checked={frame.h === 'auto'} onChange={value => updateFrame({ h: value ? 'auto' : 32 })} />
        <ToggleField label="Header repeat khi in" checked={table.headerRepeat !== false} onChange={value => onUpdateTable?.({ headerRepeat: value })} />
        <ToggleField label="Cho phép qua trang" checked={table.allowPageBreak !== false} onChange={value => onUpdateTable?.({ allowPageBreak: value })} />
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
  const isTable = selectedId === 'itemsTable' || selectedElement?.type === 'itemsTable';
  const element = !isTable && selectedElement && selectedElement.id !== TABLE_STYLE_ELEMENT_ID ? selectedElement : null;

  const updateElementStyle = (patch) => {
    if (!element) return;
    onUpdateElement?.(element.id, { style: { ...element.style, ...patch } });
  };

  return (
    <aside className="invoice-editor-panel invoice-editor-properties">
      <div className="invoice-editor-panel-title">Thuộc tính</div>
      <section className="invoice-editor-properties-section">
        <h4>Canvas</h4>
        <div className="invoice-editor-prop-grid">
          <NumberField label="Safe" value={document.canvas?.safePaddingMm ?? 8} min={0} max={30} step={0.5} onChange={value => onSetDocument?.({ ...document, canvas: { ...document.canvas, safePaddingMm: Number(value) || 0 } })} />
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
            <div className="invoice-editor-prop-grid">
              <NumberField label="X" value={element.frame?.x || 0} onChange={value => onUpdateElement?.(element.id, { frame: { ...element.frame, x: Number(value) || 0 } })} />
              <NumberField label="Y" value={element.frame?.y || 0} onChange={value => onUpdateElement?.(element.id, { frame: { ...element.frame, y: Number(value) || 0 } })} />
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
          {(element.type === 'customText' || element.type === 'text' || element.type === 'footerText') && (
            <section>
              <h4>Nội dung</h4>
              <TextField label="Text" multiline value={element.style?.text || ''} onChange={value => updateElementStyle({ text: value })} />
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
          {element.type === 'paymentQr' && (
            <section>
              <h4>QR / ngân hàng</h4>
              <NumberField label="QR size" value={element.style?.qrSizeMm ?? 17} min={8} max={40} step={0.5} onChange={value => updateElementStyle({ qrSizeMm: Number(value) || 17 })} />
              <ToggleField label="Hiện icon" checked={element.style?.showIcon !== false} onChange={value => updateElementStyle({ showIcon: value })} />
              <SelectField label="Icon" value={element.style?.icon || 'qr'} options={[{ value: 'qr', label: 'QR' }, { value: 'bank', label: 'Ngân hàng' }, { value: 'none', label: 'Không icon' }]} onChange={value => updateElementStyle({ icon: value, showIcon: value !== 'none' })} />
            </section>
          )}
          {element.type === 'signatures' && (
            <section>
              <h4>Chữ ký / con dấu</h4>
              <NumberField label="Khoảng cách" value={element.style?.signatureGapMm ?? 10} min={0} max={40} step={0.5} onChange={value => updateElementStyle({ signatureGapMm: Number(value) || 0 })} />
              <NumberField label="Khoảng trống ký" value={element.style?.blankHeightMm ?? 10} min={0} max={40} step={0.5} onChange={value => updateElementStyle({ blankHeightMm: Number(value) || 0 })} />
            </section>
          )}
        </div>
      ) : (
        <div className="invoice-editor-empty-props">Chọn một thành phần hoặc bảng sản phẩm để chỉnh thuộc tính.</div>
      )}
    </aside>
  );
}
