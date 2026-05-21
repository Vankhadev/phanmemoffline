import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw, Settings2 } from 'lucide-react';
import {
  cloneInvoiceVisualConfig,
  createDefaultInvoiceVisualConfig,
  normalizeInvoiceVisualConfig,
} from '../utils/invoiceTemplateRenderer';

const ALIGN_OPTIONS = [
  { value: 'left', label: 'Trái' },
  { value: 'center', label: 'Giữa' },
  { value: 'right', label: 'Phải' },
  { value: 'right', label: 'trên' },
];

const SECTION_LABELS = {
  header: 'Đầu hóa đơn',
  invoiceInfo: 'Thông tin hóa đơn',
  customerInfo: 'Thông tin khách hàng',
  table: 'Bảng sản phẩm',
  totals: 'Tổng tiền / thanh toán',
  payment: 'QR thanh toán',
  footer: 'Chân hóa đơn',
};

function numberValue(value, fallback = 11) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cloneConfig(config) {
  return cloneInvoiceVisualConfig(config) || {};
}

function updateAtPath(source, path, value) {
  const next = cloneConfig(source);
  const keys = Array.isArray(path) ? path : String(path).split('.');
  let current = next;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      current[key] = value;
      return;
    }
    if (!current[key] || typeof current[key] !== 'object') current[key] = {};
    current = current[key];
  });
  return next;
}

function updateArrayItem(source, sectionKey, arrayKey, index, changes) {
  const next = cloneConfig(source);
  const section = next[sectionKey] || {};
  const items = Array.isArray(section[arrayKey]) ? [...section[arrayKey]] : [];
  items[index] = { ...(items[index] || {}), ...changes };
  next[sectionKey] = { ...section, [arrayKey]: items };
  return next;
}

function moveArrayItem(source, sectionKey, arrayKey, index, direction) {
  const next = cloneConfig(source);
  const section = next[sectionKey] || {};
  const items = Array.isArray(section[arrayKey]) ? [...section[arrayKey]] : [];
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= items.length) return source;
  const [item] = items.splice(index, 1);
  items.splice(targetIndex, 0, item);
  next[sectionKey] = { ...section, [arrayKey]: items };
  return next;
}

function SectionCard({ title, description, enabled, onToggle, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b bg-slate-50 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Settings2 size={16} className="text-blue-600" /> {title}
          </h3>
          {description && <p className="text-xs text-gray-500 mt-1">{description}</p>}
        </div>
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 ${enabled ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}
          >
            {enabled ? <Eye size={14} /> : <EyeOff size={14} />}
            {enabled ? 'Đang hiện' : 'Đang ẩn'}
          </button>
        )}
      </div>
      {enabled === false ? (
        <div className="p-4 text-sm text-gray-500">Mục này đang bị ẩn trên mẫu in.</div>
      ) : (
        <div className="p-4 space-y-4">{children}</div>
      )}
    </section>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
      <input
        type="checkbox"
        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        checked={checked !== false}
        onChange={e => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function SelectAlign({ value, onChange }) {
  return (
    <select className="input-field text-sm" value={value || 'left'} onChange={e => onChange(e.target.value)}>
      {ALIGN_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

function FieldEditor({ field, index, onChange, showMove, onMove, isFirst, isLast, includeWidth }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 bg-slate-50 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Toggle checked={field.visible} onChange={visible => onChange({ visible })} label={field.key || `Trường ${index + 1}`} />
        {showMove && (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onMove(-1)} disabled={isFirst} className="p-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-40">
              <ArrowUp size={14} />
            </button>
            <button type="button" onClick={() => onMove(1)} disabled={isLast} className="p-1.5 rounded border bg-white hover:bg-gray-50 disabled:opacity-40">
              <ArrowDown size={14} />
            </button>
          </div>
        )}
      </div>
      <div className={`grid grid-cols-1 ${includeWidth ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-3`}>
        <label className="text-xs font-semibold text-gray-600 space-y-1">
          <span>Nhãn</span>
          <input className="input-field text-sm" value={field.label || ''} onChange={e => onChange({ label: e.target.value })} />
        </label>
        <label className="text-xs font-semibold text-gray-600 space-y-1">
          <span>Căn lề</span>
          <SelectAlign value={field.align || 'left'} onChange={align => onChange({ align })} />
        </label>
        <label className="text-xs font-semibold text-gray-600 space-y-1">
          <span>Cỡ chữ</span>
          <input
            type="number"
            min="7"
            max="48"
            className="input-field text-sm"
            value={numberValue(field.fontSize, 11)}
            onChange={e => onChange({ fontSize: numberValue(e.target.value, 11) })}
          />
        </label>
        {includeWidth && (
          <label className="text-xs font-semibold text-gray-600 space-y-1">
            <span>Độ rộng cột</span>
            <input className="input-field text-sm" value={field.width || ''} onChange={e => onChange({ width: e.target.value })} placeholder="VD: 20%" />
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-4">
        <Toggle checked={field.bold !== false ? field.bold : false} onChange={bold => onChange({ bold })} label="In đậm cả dòng" />
        {'boldValue' in field && <Toggle checked={field.boldValue} onChange={boldValue => onChange({ boldValue })} label="In đậm giá trị" />}
      </div>
    </div>
  );
}

function FieldsSection({ config, sectionKey, arrayKey = 'fields', onChange, includeWidth = false, moveable = false }) {
  const section = config[sectionKey] || {};
  const fields = Array.isArray(section[arrayKey]) ? section[arrayKey] : [];

  return (
    <div className="space-y-3">
      {fields.map((field, index) => (
        <FieldEditor
          key={`${field.key}-${index}`}
          field={field}
          index={index}
          includeWidth={includeWidth}
          showMove={moveable}
          isFirst={index === 0}
          isLast={index === fields.length - 1}
          onMove={direction => onChange(moveArrayItem(config, sectionKey, arrayKey, index, direction))}
          onChange={changes => onChange(updateArrayItem(config, sectionKey, arrayKey, index, changes))}
        />
      ))}
    </div>
  );
}

function FooterLinesEditor({ config, onChange }) {
  const footer = config.footer || {};
  const lines = Array.isArray(footer.lines) ? footer.lines : [];

  const updateLine = (index, changes) => {
    const next = cloneConfig(config);
    const nextFooter = next.footer || {};
    const nextLines = Array.isArray(nextFooter.lines) ? [...nextFooter.lines] : [];
    nextLines[index] = { ...(nextLines[index] || {}), ...changes };
    next.footer = { ...nextFooter, lines: nextLines };
    onChange(next);
  };

  const addLine = () => {
    const next = cloneConfig(config);
    const nextFooter = next.footer || {};
    next.footer = {
      ...nextFooter,
      lines: [...(Array.isArray(nextFooter.lines) ? nextFooter.lines : []), { text: 'Nội dung chân hóa đơn', visible: true, fontSize: footer.fontSize || 10, bold: false }],
    };
    onChange(next);
  };

  const removeLine = (index) => {
    const next = cloneConfig(config);
    const nextFooter = next.footer || {};
    const nextLines = Array.isArray(nextFooter.lines) ? [...nextFooter.lines] : [];
    nextLines.splice(index, 1);
    next.footer = { ...nextFooter, lines: nextLines };
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {lines.map((line, index) => (
        <div key={index} className="rounded-lg border border-gray-200 p-3 bg-slate-50 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Toggle checked={line.visible} onChange={visible => updateLine(index, { visible })} label={`Dòng ${index + 1}`} />
            <button type="button" onClick={() => removeLine(index)} className="px-2 py-1 rounded border bg-white hover:bg-red-50 hover:text-red-700 text-xs">Xóa dòng</button>
          </div>
          <textarea
            className="input-field text-sm min-h-[70px]"
            value={line.text || ''}
            onChange={e => updateLine(index, { text: e.target.value })}
            placeholder="Có thể dùng {{store.invoice_note}}, {{store.invoice_slogan}}"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-gray-600 space-y-1">
              <span>Cỡ chữ</span>
              <input type="number" min="7" max="48" className="input-field text-sm" value={numberValue(line.fontSize, footer.fontSize || 10)} onChange={e => updateLine(index, { fontSize: numberValue(e.target.value, footer.fontSize || 10) })} />
            </label>
            <div className="flex items-end">
              <Toggle checked={line.bold} onChange={bold => updateLine(index, { bold })} label="In đậm" />
            </div>
          </div>
        </div>
      ))}
      <button type="button" onClick={addLine} className="px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium">
        Thêm dòng chân hóa đơn
      </button>
    </div>
  );
}

export default function InvoiceTemplateVisualEditor({ config, type = 'sale_invoice', paperSize = '80mm', widthMm = 80, onChange, onCancel, onRestore }) {
  const normalizedConfig = normalizeInvoiceVisualConfig(config, type, paperSize, widthMm)
    || createDefaultInvoiceVisualConfig(type, paperSize, widthMm);

  const emit = (nextConfig) => onChange?.(normalizeInvoiceVisualConfig(nextConfig, type, paperSize, widthMm) || nextConfig);
  const update = (path, value) => emit(updateAtPath(normalizedConfig, path, value));
  const toggleSection = sectionKey => update(`${sectionKey}.visible`, normalizedConfig[sectionKey]?.visible === false);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-blue-900">Chỉnh sửa trực quan mẫu in</h2>
          <p className="text-sm text-blue-700 mt-1">
            Chỉnh tiêu đề, trường hiển thị, nhãn, căn lề, cỡ chữ, độ rộng/thứ tự cột và chân hóa đơn. Preview bên phải cập nhật realtime.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onRestore?.()} className="px-3 py-2 rounded-lg border border-blue-200 bg-white hover:bg-blue-100 text-blue-700 text-sm font-medium flex items-center gap-2">
            <RotateCcw size={15} /> Khôi phục mẫu mặc định
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-sm font-medium">
              Hủy thay đổi
            </button>
          )}
        </div>
      </div>

      <SectionCard title="Bố cục chung" description="Áp dụng cho toàn bộ mẫu in." enabled>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-xs font-semibold text-gray-600 space-y-1">
            <span>Font chữ</span>
            <input className="input-field text-sm" value={normalizedConfig.layout?.fontFamily || ''} onChange={e => update('layout.fontFamily', e.target.value)} />
          </label>
          <label className="text-xs font-semibold text-gray-600 space-y-1">
            <span>Cỡ chữ nền</span>
            <input type="number" min="7" max="48" className="input-field text-sm" value={numberValue(normalizedConfig.layout?.baseFontSize, 11)} onChange={e => update('layout.baseFontSize', numberValue(e.target.value, 11))} />
          </label>
          <label className="text-xs font-semibold text-gray-600 space-y-1">
            <span>Lề trong (mm)</span>
            <input type="number" min="0" max="30" className="input-field text-sm" value={numberValue(normalizedConfig.layout?.paddingMm, 4)} onChange={e => update('layout.paddingMm', numberValue(e.target.value, 4))} />
          </label>
          <label className="text-xs font-semibold text-gray-600 space-y-1">
            <span>Kiểu đường kẻ</span>
            <select className="input-field text-sm" value={normalizedConfig.layout?.borderStyle || 'dashed'} onChange={e => update('layout.borderStyle', e.target.value)}>
              <option value="dashed">Nét đứt</option>
              <option value="solid">Nét liền</option>
              <option value="dotted">Chấm</option>
              <option value="none">Không kẻ</option>
            </select>
          </label>
        </div>
      </SectionCard>

      <SectionCard title={SECTION_LABELS.header} description="Logo, tên cửa hàng, tiêu đề và phụ đề hóa đơn." enabled={normalizedConfig.header?.visible !== false} onToggle={() => toggleSection('header')}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-gray-600 space-y-1">
            <span>Tiêu đề</span>
            <input className="input-field text-sm" value={normalizedConfig.header?.title || ''} onChange={e => update('header.title', e.target.value)} />
          </label>
          <label className="text-xs font-semibold text-gray-600 space-y-1">
            <span>Phụ đề</span>
            <input className="input-field text-sm" value={normalizedConfig.header?.subtitle || ''} onChange={e => update('header.subtitle', e.target.value)} />
          </label>
          <label className="text-xs font-semibold text-gray-600 space-y-1">
            <span>Căn tiêu đề</span>
            <SelectAlign value={normalizedConfig.header?.align || 'center'} onChange={align => update('header.align', align)} />
          </label>
          <label className="text-xs font-semibold text-gray-600 space-y-1">
            <span>Cỡ chữ tiêu đề</span>
            <input type="number" min="7" max="48" className="input-field text-sm" value={numberValue(normalizedConfig.header?.titleFontSize, 15)} onChange={e => update('header.titleFontSize', numberValue(e.target.value, 15))} />
          </label>
        </div>
        <Toggle checked={normalizedConfig.header?.showLogo} onChange={showLogo => update('header.showLogo', showLogo)} label="Hiện logo cửa hàng" />
        <FieldsSection config={normalizedConfig} sectionKey="header" onChange={emit} />
      </SectionCard>

      <SectionCard title={SECTION_LABELS.invoiceInfo} description="Số hóa đơn, ngày giờ, thu ngân." enabled={normalizedConfig.invoiceInfo?.visible !== false} onToggle={() => toggleSection('invoiceInfo')}>
        <FieldsSection config={normalizedConfig} sectionKey="invoiceInfo" onChange={emit} />
      </SectionCard>

      <SectionCard title={SECTION_LABELS.customerInfo} description="Thông tin khách hàng hoặc đối tác." enabled={normalizedConfig.customerInfo?.visible !== false} onToggle={() => toggleSection('customerInfo')}>
        <FieldsSection config={normalizedConfig} sectionKey="customerInfo" onChange={emit} />
      </SectionCard>

      <SectionCard title={SECTION_LABELS.table} description="Bật/tắt cột, đổi nhãn, cỡ chữ, độ rộng và thứ tự cột sản phẩm." enabled={normalizedConfig.table?.visible !== false} onToggle={() => toggleSection('table')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs font-semibold text-gray-600 space-y-1">
            <span>Cỡ chữ tiêu đề cột</span>
            <input type="number" min="7" max="48" className="input-field text-sm" value={numberValue(normalizedConfig.table?.headerFontSize, 10)} onChange={e => update('table.headerFontSize', numberValue(e.target.value, 10))} />
          </label>
          <label className="text-xs font-semibold text-gray-600 space-y-1">
            <span>Cỡ chữ dòng hàng</span>
            <input type="number" min="7" max="48" className="input-field text-sm" value={numberValue(normalizedConfig.table?.fontSize, 10)} onChange={e => update('table.fontSize', numberValue(e.target.value, 10))} />
          </label>
          <div className="flex items-end">
            <Toggle checked={normalizedConfig.table?.showSku} onChange={showSku => update('table.showSku', showSku)} label="Hiện mã sản phẩm dưới tên" />
          </div>
        </div>
        <FieldsSection config={normalizedConfig} sectionKey="table" arrayKey="columns" includeWidth moveable onChange={emit} />
      </SectionCard>

      <SectionCard title={SECTION_LABELS.totals} description="Tạm tính, giảm giá, hình thức thanh toán, tổng tiền, tiền khách đưa, tiền thừa và ghi chú." enabled={normalizedConfig.totals?.visible !== false} onToggle={() => toggleSection('totals')}>
        <FieldsSection config={normalizedConfig} sectionKey="totals" onChange={emit} />
      </SectionCard>

      <SectionCard title={SECTION_LABELS.payment} description="QR thanh toán trong preview/in thử." enabled={normalizedConfig.payment?.visible !== false} onToggle={() => toggleSection('payment')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs font-semibold text-gray-600 space-y-1">
            <span>Nhãn QR</span>
            <input className="input-field text-sm" value={normalizedConfig.payment?.label || ''} onChange={e => update('payment.label', e.target.value)} />
          </label>
          <label className="text-xs font-semibold text-gray-600 space-y-1">
            <span>Kích thước QR (mm)</span>
            <input type="number" min="12" max="80" className="input-field text-sm" value={numberValue(normalizedConfig.payment?.qrSizeMm, 28)} onChange={e => update('payment.qrSizeMm', numberValue(e.target.value, 28))} />
          </label>
          <label className="text-xs font-semibold text-gray-600 space-y-1">
            <span>Căn QR</span>
            <SelectAlign value={normalizedConfig.payment?.align || 'center'} onChange={align => update('payment.align', align)} />
          </label>
        </div>
        <div className="flex flex-wrap gap-4">
          <Toggle checked={normalizedConfig.payment?.showQr} onChange={showQr => update('payment.showQr', showQr)} label="Hiện QR" />
          <Toggle checked={normalizedConfig.payment?.showQrLogo} onChange={showQrLogo => update('payment.showQrLogo', showQrLogo)} label="Hiện logo QR" />
        </div>
      </SectionCard>

      <SectionCard title={SECTION_LABELS.footer} description="Nội dung chân hóa đơn, lời cảm ơn, ghi chú cửa hàng." enabled={normalizedConfig.footer?.visible !== false} onToggle={() => toggleSection('footer')}>
        <label className="text-xs font-semibold text-gray-600 space-y-1 block max-w-xs">
          <span>Căn chân hóa đơn</span>
          <SelectAlign value={normalizedConfig.footer?.align || 'center'} onChange={align => update('footer.align', align)} />
        </label>
        <FooterLinesEditor config={normalizedConfig} onChange={emit} />
      </SectionCard>
    </div>
  );
}
