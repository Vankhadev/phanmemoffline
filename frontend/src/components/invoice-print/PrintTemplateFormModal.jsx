import { Image, Loader2, Upload, X } from 'lucide-react';
import InvoiceTemplateRenderer from './InvoiceTemplateRenderer';

function ToggleField({ label, description = '', checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${checked ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'} dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{description}</span>}
      </span>
      <span className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${checked ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
        <span className={`h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </span>
    </button>
  );
}

function ModalInput({ id, label, className = '', ...props }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</label>
      <input
        id={id}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        {...props}
      />
    </div>
  );
}

function ModalSelect({ id, label, className = '', children, ...props }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</label>
      <select
        id={id}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

function NumberInput({ id, label, suffix = '', className = '', ...props }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</label>
      <div className="mt-1 flex rounded-lg border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/25 dark:border-slate-700 dark:bg-slate-900">
        <input
          id={id}
          type="number"
          className="min-w-0 flex-1 rounded-lg bg-transparent px-3 py-2 text-sm text-slate-900 outline-none dark:text-slate-100"
          {...props}
        />
        {suffix && <span className="inline-flex items-center px-3 text-xs font-semibold text-slate-500 dark:text-slate-400">{suffix}</span>}
      </div>
    </div>
  );
}

export default function PrintTemplateFormModal({
  show,
  form,
  edit,
  saving,
  notice,
  logoFile,
  logoPreviewUrl,
  previewTemplate,
  previewPayload = null,
  canManage = true,
  onClose,
  onSave,
  onFieldChange,
  onLogoChange,
  onRemoveLogo,
}) {
  if (!show) return null;

  const logoVisibleUrl = logoPreviewUrl || form.logo_url || previewTemplate?.logo_url || '';
  const updateNumber = (field) => (event) => onFieldChange(field, event.target.value === '' ? '' : Number(event.target.value));
  const updateText = (field) => (event) => onFieldChange(field, event.target.value);
  const updateBool = (field) => (value) => onFieldChange(field, value);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/55 p-2 sm:p-4" role="presentation">
      <div className="flex max-h-[calc(100vh-1rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-white text-slate-900 shadow-2xl dark:bg-slate-950 dark:text-slate-100 sm:max-h-[calc(100vh-2rem)]" role="dialog" aria-modal="true" aria-labelledby="print-template-modal-title">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-5">
          <div>
            <h2 id="print-template-modal-title" className="text-lg font-bold">
              {edit?.id ? 'Sửa mẫu in hóa đơn' : 'Thêm mẫu in hóa đơn'}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Chỉnh cấu hình bên trái, preview hóa đơn mẫu cập nhật realtime bên phải.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60 dark:hover:bg-slate-900 dark:hover:text-slate-200">
            <X size={20} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(380px,0.95fr)_minmax(0,1.35fr)]">
          <form className="min-h-0 overflow-y-auto border-r border-slate-200 p-4 dark:border-slate-800 sm:p-5" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
            <div className="space-y-5">
              {notice?.message && (
                <div className={`rounded-xl border px-4 py-3 text-sm ${notice.tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                  {notice.message}
                </div>
              )}

              <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <h3 className="font-bold text-slate-900 dark:text-slate-100">Thông tin mẫu</h3>
                <ModalInput id="print-template-name" label="Tên mẫu in" value={form.template_name} onChange={updateText('template_name')} placeholder="Ví dụ: Mẫu A5 mặc định" />
                <ModalInput id="print-template-description" label="Mô tả" value={form.description} onChange={updateText('description')} placeholder="Dùng cho bán hàng tại quầy" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ModalSelect id="print-template-status" label="Trạng thái" value={form.status} onChange={updateText('status')}>
                    <option value="active">Đang dùng</option>
                    <option value="draft">Nháp</option>
                    <option value="archived">Lưu trữ</option>
                  </ModalSelect>
                  <ToggleField label="Đặt mặc định" description="Áp dụng cho API in nếu không chọn template_id." checked={Boolean(form.is_default)} onChange={updateBool('is_default')} />
                </div>
              </section>

              <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                <h3 className="font-bold text-slate-900 dark:text-slate-100">Thương hiệu & logo</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[96px_1fr]">
                  <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900">
                    {logoVisibleUrl ? <img src={logoVisibleUrl} alt="Logo preview" className="h-full w-full object-contain" /> : <Image size={26} />}
                  </div>
                  <div className="space-y-2">
                    <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
                      <Upload size={14} /> Chọn logo
                      <input type="file" accept="image/*" className="hidden" onChange={onLogoChange} />
                    </label>
                    <button type="button" onClick={onRemoveLogo} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                      Xóa logo
                    </button>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{logoFile ? logoFile.name : form.logo_url ? 'ang d?ng logo ? l?u' : 'Ch?a chọn logo'}</div>
                  </div>
                </div>
                <ModalInput id="print-shop-name" label="Tên cửa hàng" value={form.shop_name} onChange={updateText('shop_name')} />
                <ModalInput id="print-shop-address" label="Địa chỉ" value={form.shop_address} onChange={updateText('shop_address')} />
                <ModalInput id="print-shop-phone" label="Số điện thoại" value={form.shop_phone} onChange={updateText('shop_phone')} />
              </section>

              <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <h3 className="font-bold text-slate-900 dark:text-slate-100">Khổ giấy & bố cục</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ModalSelect id="print-paper-size" label="Khổ giấy" value={form.paper_size} onChange={updateText('paper_size')}>
                    <option value="A5">A5</option>
                    <option value="A4">A4</option>
                    <option value="K80">K80</option>
                    <option value="K57">K57</option>
                  </ModalSelect>
                  <ModalSelect id="print-orientation" label="Hướng in" value={form.orientation} onChange={updateText('orientation')} disabled={String(form.paper_size || '').toUpperCase().startsWith('K')}>
                    <option value="portrait">Dọc</option>
                    <option value="landscape">Ngang</option>
                  </ModalSelect>
                  <NumberInput id="print-font-size" label="Font size" min="7" max="16" step="0.5" suffix="pt" value={form.fontSize} onChange={updateNumber('fontSize')} />
                  <NumberInput id="print-scale" label="Scale in" min="50" max="100" step="5" suffix="%" value={Math.round(Number(form.scale || 1) * 100)} onChange={event => onFieldChange('scale', (Number(event.target.value) || 100) / 100)} />
                  <NumberInput id="print-preview-zoom" label="Zoom preview" min="50" max="100" step="5" suffix="%" value={Math.round(Number(form.previewZoom || 1) * 100)} onChange={event => onFieldChange('previewZoom', (Number(event.target.value) || 100) / 100)} />
                  <NumberInput id="print-line-spacing" label="Khoảng cách dòng" min="1" max="2.2" step="0.05" suffix="x" value={form.lineSpacing} onChange={updateNumber('lineSpacing')} />
                  <NumberInput id="print-padding" label="Padding" min="0" max="24" step="0.5" suffix="mm" value={form.paddingMm} onChange={updateNumber('paddingMm')} />
                  <NumberInput id="print-margin" label="Margin" min="0" max="20" step="0.5" suffix="mm" value={form.marginMm} onChange={updateNumber('marginMm')} />
                  <NumberInput id="print-table-width" label="Width table" min="60" max="100" step="1" suffix="%" value={form.tableWidthPercent} onChange={updateNumber('tableWidthPercent')} />
                  <NumberInput id="print-border-width" label="Border table" min="0" max="1" step="0.05" suffix="mm" value={form.tableBorderWidthMm} onChange={updateNumber('tableBorderWidthMm')} disabled={!form.tableBorder} />
                </div>
              </section>

              <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                <h3 className="font-bold text-slate-900 dark:text-slate-100">Bật/tắt thành phần</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ToggleField label="Logo" description="Hiện logo cửa hàng" checked={Boolean(form.showLogo)} onChange={updateBool('showLogo')} />
                  <ToggleField label="Chữ ký" description="Người nhận/người viết hóa đơn" checked={Boolean(form.showSignature)} onChange={updateBool('showSignature')} />
                  <ToggleField label="Ghi chú" description="Hiện ghi chú hóa đơn" checked={Boolean(form.showNote)} onChange={updateBool('showNote')} />
                  <ToggleField label="Công nợ" description="Hiện số còn phải trả" checked={Boolean(form.showDebt)} onChange={updateBool('showDebt')} />
                  <ToggleField label="Border table" description="Đường viền bảng sản phẩm" checked={Boolean(form.tableBorder)} onChange={updateBool('tableBorder')} />
                </div>
              </section>
            </div>
          </form>

          <section className="min-h-0 overflow-auto bg-slate-100 p-3 dark:bg-slate-900 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600 dark:text-slate-300">
              <div className="font-semibold">Preview realtime</div>
              <div>{form.paper_size} ? {form.orientation === 'landscape' ? 'Ngang' : 'D?c'} ? {Math.round(Number(form.previewZoom || 1) * 100)}%</div>
            </div>
            <div className="invoice-print-preview-frame min-h-full justify-start lg:justify-center">
              {previewPayload ? (
                <InvoiceTemplateRenderer payload={previewPayload} template={previewTemplate} logoPreviewUrl={logoPreviewUrl} />
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 p-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-400">
                  Component legacy này chỉ render preview khi được truyền dữ liệu hóa đơn thật qua previewPayload.
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800 sm:flex-row sm:justify-end sm:px-5">
          <button type="button" onClick={onClose} disabled={saving} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
            Hủy
          </button>
          <button type="button" onClick={onSave} disabled={saving || !canManage} className="btn-success min-h-10 disabled:opacity-60">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {saving ? 'Đang lưu...' : 'Lưu mẫu in'}
          </button>
        </div>
      </div>
    </div>
  );
}
