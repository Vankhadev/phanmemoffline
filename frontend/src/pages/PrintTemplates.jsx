import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Code2,
  Copy,
  FileText,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Star,
  Trash2,
} from 'lucide-react';
import { resolveApiUrl } from '../utils/apiClient';
import InvoicePreview from '../components/InvoicePreview';
import InvoiceTemplateVisualEditor from '../components/InvoiceTemplateVisualEditor';

const API = resolveApiUrl('');
import {
  getDefaultTemplate,
  getFallbackTemplates,
  getPaperWidth,
  getTemplateTypeLabel,
  normalizeTemplateRecord,
  PAPER_SIZE_OPTIONS,
  PRINT_TEMPLATE_TYPES,
} from '../utils/defaultInvoiceTemplates';
import {
  cloneInvoiceVisualConfig,
  createDefaultInvoiceVisualConfig,
  normalizeInvoiceVisualConfig,
} from '../utils/invoiceTemplateRenderer';

const PLACEHOLDER_GROUPS = [
  {
    title: 'Cửa hàng',
    items: [
      { token: '{{store.name}}', label: 'Tên cửa hàng' },
      { token: '{{store.address}}', label: 'Địa chỉ' },
      { token: '{{store.phone}}', label: 'Số điện thoại' },
      { token: '{{store.email}}', label: 'Email cửa hàng' },
      { token: '{{store.tax_code}}', label: 'Mã số thuế' },
      { token: '{{store.invoice_footer_url}}', label: 'URL chân trang' },
      { token: '{{images.logo}}', label: 'Logo' },
    ],
  },
  {
    title: 'Hóa đơn',
    items: [
      { token: '{{invoice.code}}', label: 'Mã hóa đơn' },
      { token: '{{invoice.order_code}}', label: 'Mã đơn hàng' },
      { token: '{{invoice.created_at}}', label: 'Ngày giờ lập' },
      { token: '{{invoice.created_date}}', label: 'Ngày lập' },
      { token: '{{invoice.cashier}}', label: 'Thu ngân' },
      { token: '{{invoice.invoice_writer}}', label: 'Người viết hóa đơn' },
      { token: '{{invoice.receiver_name}}', label: 'Người nhận hàng' },
      { token: '{{items_rows}}', label: 'Dòng sản phẩm' },
      { token: '{{images.qr}}', label: 'QR thanh toán' },
    ],
  },
  {
    title: 'Khách hàng/Tổng tiền',
    items: [
      { token: '{{customer.name}}', label: 'Tên khách' },
      { token: '{{customer.phone}}', label: 'SĐT khách' },
      { token: '{{customer.email}}', label: 'Email khách' },
      { token: '{{customer.address}}', label: 'Địa chỉ khách' },
      { token: '{{totals.subtotal}}', label: 'Tạm tính' },
      { token: '{{totals.discount}}', label: 'Giảm giá' },
      { token: '{{totals.total}}', label: 'Tổng cộng' },
      { token: '{{totals.old_debt}}', label: 'Nợ cũ' },
      { token: '{{totals.total_amount}}', label: 'Thành tiền cuối' },
    ],
  },
  {
    title: 'Trả hàng',
    items: [
      { token: '{{return.code}}', label: 'Mã trả hàng' },
      { token: '{{return.created_at}}', label: 'Ngày trả' },
      { token: '{{return.total}}', label: 'Tổng hoàn/trừ' },
      { token: '{{partner.name}}', label: 'Khách/NCC' },
      { token: '{{partner.phone}}', label: 'SĐT đối tác' },
    ],
  },
];

function buildDraftFromTemplate(template, fallbackType = 'sale_invoice', fallbackPaperSize = '80mm') {
  const normalized = normalizeTemplateRecord(template, fallbackType, fallbackPaperSize);
  return {
    ...normalized,
    name: normalized.name || `Mẫu in ${getTemplateTypeLabel(normalized.type)} ${normalized.paper_size}`,
    width_mm: getPaperWidth(normalized.paper_size),
    config: cloneInvoiceVisualConfig(normalized.config),
  };
}

function ensureVisualConfig(template, type, paperSize, widthMm) {
  return normalizeInvoiceVisualConfig(template?.config, type, paperSize, widthMm)
    || createDefaultInvoiceVisualConfig(type, paperSize, widthMm);
}

function getErrorMessage(error, fallback = 'Có lỗi xảy ra') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.error || error.detail || error.message || fallback;
}

export default function PrintTemplates({ store }) {
  const [templateType, setTemplateType] = useState('sale_invoice');
  const [templates, setTemplates] = useState(() => getFallbackTemplates('sale_invoice'));
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState(() => getDefaultTemplate('sale_invoice', 'A4'));
  const [editorTab, setEditorTab] = useState('visual');
  const [isVisualEditing, setIsVisualEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [loadedFromFallback, setLoadedFromFallback] = useState(false);

  const selectedTemplate = useMemo(
    () => templates.find(template => String(template.id) === String(selectedId)) || null,
    [selectedId, templates]
  );

  const isExistingApiTemplate = Boolean(draft?.id) && !draft?.is_fallback && !String(draft.id).startsWith('local-');

  const showMessage = useCallback((type, text) => {
    setMessage({ type, text });
    window.clearTimeout(window.__printTemplateMessageTimer);
    window.__printTemplateMessageTimer = window.setTimeout(() => setMessage(null), 4500);
  }, []);

  const applyTemplateToDraft = useCallback((template) => {
    const nextDraft = buildDraftFromTemplate(template, templateType, template?.paper_size || '80mm');
    setDraft(nextDraft);
    setSelectedId(String(nextDraft.id || ''));
    setIsVisualEditing(false);
  }, [templateType]);

  const loadTemplates = useCallback(async (type = templateType) => {
    setLoading(true);
    try {
      const response = await fetch(`${API}/print-templates?type=${encodeURIComponent(type)}`);
      const data = await response.json().catch(() => []);
      if (!response.ok) throw new Error(getErrorMessage(data, 'Không tải được danh sách mẫu in'));

      const apiTemplates = Array.isArray(data)
        ? data.map(template => normalizeTemplateRecord(template, type)).filter(template => template.active)
        : [];
      const nextTemplates = apiTemplates.length > 0 ? apiTemplates : getFallbackTemplates(type);
      setTemplates(nextTemplates);
      setLoadedFromFallback(apiTemplates.length === 0);
      const defaultTemplate = nextTemplates.find(template => template.is_default) || nextTemplates[0] || getDefaultTemplate(type, type === 'sale_invoice' ? 'A4' : '80mm');
      setDraft(buildDraftFromTemplate(defaultTemplate, type, defaultTemplate.paper_size));
      setSelectedId(String(defaultTemplate.id || ''));
      if (apiTemplates.length === 0) {
        showMessage('info', 'Chưa có mẫu in từ API/DB, đang dùng mẫu mặc định frontend để chỉnh sửa.');
      }
    } catch (err) {
      const fallbackTemplates = getFallbackTemplates(type);
      const fallback = fallbackTemplates[0] || getDefaultTemplate(type, type === 'sale_invoice' ? 'A4' : '80mm');
      setTemplates(fallbackTemplates);
      setDraft(buildDraftFromTemplate(fallback, type, fallback.paper_size));
      setSelectedId(String(fallback.id || ''));
      setLoadedFromFallback(true);
      showMessage('error', `Không kết nối được API mẫu in. Đang dùng fallback frontend. ${getErrorMessage(err, '')}`);
    } finally {
      setLoading(false);
    }
  }, [showMessage, templateType]);

  useEffect(() => {
    loadTemplates(templateType);
  }, [templateType, loadTemplates]);

  const updateDraft = (changes) => {
    setDraft(prev => {
      const next = { ...prev, ...changes };
      if (changes.paper_size) {
        next.width_mm = getPaperWidth(changes.paper_size);
        if (next.config) {
          next.config = normalizeInvoiceVisualConfig(next.config, next.type || templateType, changes.paper_size, next.width_mm)
            || createDefaultInvoiceVisualConfig(next.type || templateType, changes.paper_size, next.width_mm);
          next.config.layout = { ...(next.config.layout || {}), paperSize: changes.paper_size, widthMm: next.width_mm };
        }
      }
      return next;
    });
  };

  const openVisualEditor = () => {
    setDraft(prev => {
      const paperSize = prev.paper_size || '80mm';
      const widthMm = prev.width_mm || getPaperWidth(paperSize);
      return {
        ...prev,
        config: ensureVisualConfig(prev, templateType, paperSize, widthMm),
      };
    });
    setEditorTab('visual');
    setIsVisualEditing(true);
  };

  const handleTypeChange = (type) => {
    setTemplateType(type);
    setSelectedId('');
    setDraft(getDefaultTemplate(type, type === 'sale_invoice' ? 'A4' : (draft.paper_size || '80mm')));
    setIsVisualEditing(false);
  };

  const handleSelectTemplate = (id) => {
    const template = templates.find(item => String(item.id) === String(id));
    if (template) applyTemplateToDraft(template);
  };

  const handleUseDefault = () => {
    const defaultTemplate = getDefaultTemplate(templateType, templateType === 'sale_invoice' ? 'A4' : (draft.paper_size || '80mm'));
    setDraft(defaultTemplate);
    setSelectedId(String(defaultTemplate.id));
    setIsVisualEditing(true);
    setEditorTab('visual');
    showMessage('info', 'Đã nạp mẫu mặc định frontend. Có thể lưu làm mặc định để đưa vào DB.');
  };

  const handleNewDraft = () => {
    const base = getDefaultTemplate(templateType, templateType === 'sale_invoice' ? 'A4' : (draft.paper_size || '80mm'));
    const next = {
      ...base,
      id: '',
      code: '',
      name: `Mẫu mới - ${getTemplateTypeLabel(templateType)} ${draft.paper_size || '80mm'}`,
      is_default: false,
      is_fallback: false,
    };
    setDraft(next);
    setSelectedId('');
    setIsVisualEditing(true);
    setEditorTab('visual');
    showMessage('info', 'Đã tạo bản nháp mới từ mẫu mặc định.');
  };

  const insertPlaceholder = (token) => {
    const field = editorTab === 'css' ? 'css' : 'html';
    updateDraft({ [field]: `${draft[field] || ''}${draft[field] ? '\n' : ''}${token}` });
  };

  const buildPayload = (source = draft) => ({
    code: source.code || undefined,
    name: source.name,
    type: templateType,
    paper_size: source.paper_size,
    width_mm: source.width_mm || getPaperWidth(source.paper_size),
    html: source.html,
    css: source.css,
    config: cloneInvoiceVisualConfig(source.config),
    active: true,
  });

  const validateDraft = () => {
    if (!draft.name?.trim()) return 'Vui lòng nhập tên mẫu in.';
    if (!draft.paper_size?.trim()) return 'Vui lòng chọn khổ giấy.';
    if (!draft.html?.trim() && !draft.config) return 'Vui lòng nhập HTML hoặc bật cấu hình trực quan.';
    return '';
  };

  const persistTemplate = async (sourceDraft = draft) => {
    const payload = buildPayload(sourceDraft);
    const sourceIsExistingApiTemplate = Boolean(sourceDraft?.id) && !sourceDraft?.is_fallback && !String(sourceDraft.id).startsWith('local-');
    if (sourceIsExistingApiTemplate) {
      const response = await fetch(`${API}/print-templates/${sourceDraft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(getErrorMessage(data, 'Không cập nhật được mẫu in'));
      return normalizeTemplateRecord(data.template || data, templateType);
    }

    const response = await fetch(`${API}/print-templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(getErrorMessage(data, 'Không lưu được mẫu in'));
    return normalizeTemplateRecord(data.template || data, templateType);
  };

  const upsertSavedTemplateState = (savedTemplate) => {
    setLoadedFromFallback(false);
    setTemplates(prev => {
      const withoutFallbackSameId = prev.filter(template => String(template.id) !== String(savedTemplate.id) && !template.is_fallback);
      const existing = withoutFallbackSameId.some(template => String(template.id) === String(savedTemplate.id));
      const next = existing
        ? withoutFallbackSameId.map(template => String(template.id) === String(savedTemplate.id) ? savedTemplate : template)
        : [...withoutFallbackSameId, savedTemplate];
      return next.sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'));
    });
    setDraft(buildDraftFromTemplate(savedTemplate, templateType, savedTemplate.paper_size));
    setSelectedId(String(savedTemplate.id));
  };

  const saveNewTemplate = async () => {
    const validation = validateDraft();
    if (validation) {
      showMessage('error', validation);
      return;
    }
    setSaving(true);
    try {
      const savedTemplate = await persistTemplate({ ...draft, id: '' });
      upsertSavedTemplateState(savedTemplate);
      setIsVisualEditing(false);
      showMessage('success', 'Đã lưu mẫu in mới.');
    } catch (err) {
      showMessage('error', getErrorMessage(err, 'Không lưu được mẫu in mới'));
    } finally {
      setSaving(false);
    }
  };

  const updateTemplate = async () => {
    if (!isExistingApiTemplate) {
      showMessage('error', 'Mẫu fallback/bản nháp chưa có ID trong DB. Hãy bấm Lưu mới trước.');
      return;
    }
    const validation = validateDraft();
    if (validation) {
      showMessage('error', validation);
      return;
    }
    setSaving(true);
    try {
      const savedTemplate = await persistTemplate(draft);
      upsertSavedTemplateState(savedTemplate);
      setIsVisualEditing(false);
      showMessage('success', 'Đã cập nhật mẫu in.');
    } catch (err) {
      showMessage('error', getErrorMessage(err, 'Không cập nhật được mẫu in'));
    } finally {
      setSaving(false);
    }
  };

  const saveAsDefaultTemplate = async () => {
    const validation = validateDraft();
    if (validation) {
      showMessage('error', validation);
      return;
    }
    setSaving(true);
    try {
      const preparedDraft = {
        ...draft,
        config: ensureVisualConfig(draft, templateType, draft.paper_size || '80mm', draft.width_mm || getPaperWidth(draft.paper_size)),
      };
      const savedTemplate = await persistTemplate(preparedDraft);
      const response = await fetch(`${API}/print-templates/${savedTemplate.id}/default`, { method: 'PATCH' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(getErrorMessage(data, 'Không đặt được mẫu mặc định'));
      const defaultTemplate = normalizeTemplateRecord(data.template || { ...savedTemplate, is_default: true }, templateType);
      upsertSavedTemplateState({ ...defaultTemplate, is_default: true });
      setTemplates(prev => prev.map(template => ({
        ...template,
        is_default: template.type === defaultTemplate.type && template.paper_size === defaultTemplate.paper_size
          ? String(template.id) === String(defaultTemplate.id)
          : template.is_default,
      })));
      setDraft(prev => ({ ...prev, is_default: true }));
      setIsVisualEditing(false);
      showMessage('success', 'Đã lưu cấu hình trực quan và đặt làm mẫu mặc định.');
    } catch (err) {
      showMessage('error', getErrorMessage(err, 'Không lưu được mẫu mặc định'));
    } finally {
      setSaving(false);
    }
  };

  const setDefaultTemplate = async () => {
    if (!isExistingApiTemplate) {
      showMessage('error', 'Chỉ có thể đặt mặc định cho mẫu đã lưu trong DB.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`${API}/print-templates/${draft.id}/default`, { method: 'PATCH' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(getErrorMessage(data, 'Không đặt được mẫu mặc định'));
      const savedTemplate = normalizeTemplateRecord(data.template || { ...draft, is_default: true }, templateType);
      setTemplates(prev => prev.map(template => ({
        ...template,
        is_default: template.type === savedTemplate.type && template.paper_size === savedTemplate.paper_size
          ? String(template.id) === String(savedTemplate.id)
          : template.is_default,
      })));
      setDraft(prev => ({ ...prev, is_default: true }));
      showMessage('success', 'Đã đặt mẫu này làm mặc định cho loại và khổ giấy hiện tại.');
    } catch (err) {
      showMessage('error', getErrorMessage(err, 'Không đặt được mẫu mặc định'));
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = async () => {
    if (!isExistingApiTemplate) {
      showMessage('error', 'Mẫu fallback/bản nháp chưa có trong DB nên không cần xóa.');
      return;
    }
    if (!confirm(`Xóa mềm mẫu in "${draft.name}"?`)) return;
    setSaving(true);
    try {
      const response = await fetch(`${API}/print-templates/${draft.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(getErrorMessage(data, 'Không xóa được mẫu in'));
      const remaining = templates.filter(template => String(template.id) !== String(draft.id));
      const nextTemplates = remaining.length > 0 ? remaining : getFallbackTemplates(templateType);
      const nextDraft = nextTemplates[0] || getDefaultTemplate(templateType, templateType === 'sale_invoice' ? 'A4' : '80mm');
      setTemplates(nextTemplates);
      setDraft(buildDraftFromTemplate(nextDraft, templateType, nextDraft.paper_size));
      setSelectedId(String(nextDraft.id || ''));
      setLoadedFromFallback(nextTemplates.some(template => template.is_fallback));
      showMessage('success', 'Đã xóa mềm mẫu in.');
    } catch (err) {
      showMessage('error', getErrorMessage(err, 'Không xóa được mẫu in'));
    } finally {
      setSaving(false);
    }
  };

  const cancelVisualChanges = () => {
    if (selectedTemplate) {
      setDraft(buildDraftFromTemplate(selectedTemplate, templateType, selectedTemplate.paper_size));
      setSelectedId(String(selectedTemplate.id || ''));
    } else {
      const fallback = getDefaultTemplate(templateType, templateType === 'sale_invoice' ? 'A4' : (draft.paper_size || '80mm'));
      setDraft(fallback);
      setSelectedId(String(fallback.id));
    }
    setIsVisualEditing(false);
    showMessage('info', 'Đã hủy thay đổi và nạp lại mẫu đang chọn.');
  };

  const restoreInitialDefault = () => {
    const defaultTemplate = getDefaultTemplate(templateType, templateType === 'sale_invoice' ? 'A4' : (draft.paper_size || '80mm'));
    setDraft(prev => ({
      ...prev,
      html: defaultTemplate.html,
      css: defaultTemplate.css,
      config: cloneInvoiceVisualConfig(defaultTemplate.config),
      paper_size: defaultTemplate.paper_size,
      width_mm: defaultTemplate.width_mm,
    }));
    setEditorTab('visual');
    setIsVisualEditing(true);
    showMessage('info', 'Đã khôi phục cấu hình mẫu mặc định ban đầu ở bản nháp.');
  };

  const updateVisualConfig = (nextConfig) => {
    updateDraft({ config: cloneInvoiceVisualConfig(nextConfig) });
  };

  const copyPlaceholder = async (token) => {
    try {
      await navigator.clipboard.writeText(token);
      showMessage('success', `Đã copy ${token}`);
    } catch (_) {
      insertPlaceholder(token);
      showMessage('info', `Không copy được clipboard, đã chèn ${token} vào editor.`);
    }
  };

  return (
    <div className="max-w-[1800px] mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-blue-100 text-blue-700">
            <FileText size={28} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Quản lý mẫu in hóa đơn</h1>
            <p className="text-sm text-gray-500">
              Chọn mẫu, bấm Sửa để chỉnh trực quan, xem trước mẫu in và in thử trước khi lưu mặc định.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => loadTemplates(templateType)}
          disabled={loading || saving}
          className="px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium flex items-center gap-2 disabled:opacity-60"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Tải lại
        </button>
      </div>

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm flex items-start gap-2 border ${message.type === 'success'
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : message.type === 'error'
            ? 'bg-red-50 text-red-700 border-red-200'
            : 'bg-blue-50 text-blue-700 border-blue-200'
          }`}
        >
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{message.text}</span>
        </div>
      )}

      {loadedFromFallback && (
        <div className="rounded-xl px-4 py-3 text-sm bg-amber-50 text-amber-800 border border-amber-200 flex items-start gap-2">
          <AlertCircle size={18} />
          <span>Đang dùng mẫu im Bấm <strong>Lưu làm mặc định</strong> hoặc <strong>Lưu mới</strong> để tạo mẫu thật qua API.</span>
        </div>
      )}

      <div className="grid grid-cols-1 2xl:grid-cols-[minmax(560px,760px)_1fr] gap-4 items-start">
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border p-4 space-y-4">
            <div>
              <label className="text-sm font-semibold text-gray-700">Loại mẫu hóa đơn</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
                {PRINT_TEMPLATE_TYPES.map(type => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => handleTypeChange(type.value)}
                    className={`text-left rounded-xl border p-3 transition ${templateType === type.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}`}
                  >
                    <div className="font-semibold text-sm">{type.label}</div>
                    <div className="text-xs opacity-80 mt-1">{type.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-semibold text-gray-700">Mẫu hiện có</label>
                <select
                  className="input-field mt-1"
                  value={selectedId}
                  onChange={e => handleSelectTemplate(e.target.value)}
                >
                  <option value="">-- Bản nháp mới --</option>
                  {templates.map(template => (
                    <option key={template.id} value={template.id}>
                      {template.name} · {template.paper_size}{template.is_default ? ' · mặc định' : ''}{template.is_fallback ? ' · fallback' : ''}
                    </option>
                  ))}
                </select>
                {selectedTemplate && (
                  <p className="text-xs text-gray-500 mt-1">
                    {selectedTemplate.is_fallback ? 'Mẫu frontend fallback' : `ID ${selectedTemplate.id}`} · {selectedTemplate.code || 'chưa có mã'}
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-700">Khổ giấy</label>
                <select
                  className="input-field mt-1"
                  value={draft.paper_size || '80mm'}
                  onChange={e => updateDraft({ paper_size: e.target.value })}
                >
                  {PAPER_SIZE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label} - {option.description}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">Rộng {draft.width_mm || getPaperWidth(draft.paper_size)}mm, preview tự căn theo khổ giấy.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-4">
              <div>
                <label className="text-sm font-semibold text-gray-700">Tên mẫu</label>
                <input
                  className="input-field mt-1"
                  value={draft.name || ''}
                  onChange={e => updateDraft({ name: e.target.value })}
                  placeholder="VD: Hóa đơn bán hàng 80mm"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-700">Mã mẫu</label>
                <input
                  className="input-field mt-1"
                  value={draft.code || ''}
                  onChange={e => updateDraft({ code: e.target.value })}
                  placeholder="Tự sinh nếu trống"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={openVisualEditor} className="btn-primary flex items-center gap-2 text-sm">
                <Pencil size={16} /> Sửa
              </button>
              <button type="button" onClick={saveAsDefaultTemplate} disabled={saving} className="btn-success flex items-center gap-2 text-sm disabled:opacity-60">
                <Star size={16} /> Lưu làm mặc định
              </button>
              <button type="button" onClick={cancelVisualChanges} disabled={saving} className="px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium flex items-center gap-2 disabled:opacity-60">
                <RotateCcw size={16} /> Hủy thay đổi
              </button>
              <button type="button" onClick={restoreInitialDefault} className="px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium flex items-center gap-2">
                <Copy size={16} /> Khôi phục mẫu mặc định
              </button>
              <button type="button" onClick={handleNewDraft} className="px-3 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium flex items-center gap-2">
                <Plus size={16} /> Mẫu mới
              </button>
              <button type="button" onClick={handleUseDefault} className="px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium flex items-center gap-2">
                <Copy size={16} /> Dùng mẫu mặc định
              </button>
              <button type="button" onClick={saveNewTemplate} disabled={saving} className="px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-sm font-medium flex items-center gap-2 disabled:opacity-60">
                <Plus size={16} /> Lưu mới
              </button>
              <button type="button" onClick={updateTemplate} disabled={saving || !isExistingApiTemplate} className="px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium flex items-center gap-2 disabled:opacity-60">
                <Save size={16} /> Cập nhật
              </button>
              <button type="button" onClick={setDefaultTemplate} disabled={saving || !isExistingApiTemplate} className="px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm font-medium flex items-center gap-2 disabled:opacity-60">
                <Star size={16} /> Chỉ đặt mặc định
              </button>
              <button type="button" onClick={deleteTemplate} disabled={saving || !isExistingApiTemplate} className="btn-danger flex items-center gap-2 text-sm disabled:opacity-60">
                <Trash2 size={16} /> Xóa mềm
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="border-b bg-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-gray-800">Editor mẫu in</h2>
                <p className="text-xs text-gray-500">Luồng chính là chỉnh trực quan; HTML/CSS nâng cao vẫn được giữ và sanitize khi preview.</p>
              </div>
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setEditorTab('visual')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 ${editorTab === 'visual' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  <Pencil size={15} /> Trực quan
                </button>
                <button
                  type="button"
                  onClick={() => setEditorTab('html')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 ${editorTab === 'html' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  <Code2 size={15} /> HTML
                </button>
                <button
                  type="button"
                  onClick={() => setEditorTab('css')}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 ${editorTab === 'css' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  <Palette size={15} /> CSS
                </button>
              </div>
            </div>

            <div className="p-4">
              {editorTab === 'visual' ? (
                isVisualEditing ? (
                  <InvoiceTemplateVisualEditor
                    config={draft.config}
                    type={templateType}
                    paperSize={draft.paper_size || '80mm'}
                    widthMm={draft.width_mm || getPaperWidth(draft.paper_size)}
                    onChange={updateVisualConfig}
                    onCancel={cancelVisualChanges}
                    onRestore={restoreInitialDefault}
                  />
                ) : (
                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-800">
                    <div className="font-bold text-blue-900 mb-1">Chế độ chỉnh sửa trực quan</div>
                    <p>Bấm <strong>Sửa</strong> để mở panel chỉnh tiêu đề, trường hiển thị, nhãn, căn lề, cỡ chữ, độ rộng/thứ tự cột và chân hóa đơn.</p>
                    <button type="button" onClick={openVisualEditor} className="btn-primary mt-3 inline-flex items-center gap-2 text-sm">
                      <Pencil size={16} /> Sửa mẫu trực quan
                    </button>
                  </div>
                )
              ) : editorTab === 'html' ? (
                <textarea
                  className="input-field font-mono text-xs min-h-[420px] leading-relaxed"
                  value={draft.html || ''}
                  onChange={e => updateDraft({ html: e.target.value })}
                  spellCheck={false}
                />
              ) : (
                <textarea
                  className="input-field font-mono text-xs min-h-[420px] leading-relaxed"
                  value={draft.css || ''}
                  onChange={e => updateDraft({ css: e.target.value })}
                  spellCheck={false}
                />
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-4">
            <h2 className="font-bold text-gray-800 mb-3">Chèn nhanh placeholder</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {PLACEHOLDER_GROUPS.map(group => (
                <div key={group.title} className="rounded-xl border border-gray-200 p-3">
                  <div className="font-semibold text-sm text-gray-700 mb-2">{group.title}</div>
                  <div className="flex flex-wrap gap-2">
                    {group.items.map(item => (
                      <button
                        key={item.token}
                        type="button"
                        title={item.label}
                        onClick={() => insertPlaceholder(item.token)}
                        onDoubleClick={() => copyPlaceholder(item.token)}
                        className="px-2 py-1 rounded-lg bg-gray-100 hover:bg-blue-50 hover:text-blue-700 text-xs font-mono border border-gray-200"
                      >
                        {item.token}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-3">Bấm để chèn vào editor hiện tại; bấm đúp để copy nếu trình duyệt hỗ trợ clipboard.</p>
          </div>
        </div>

        <div className="2xl:sticky 2xl:top-4 space-y-4">
          <InvoicePreview template={{ ...draft, type: templateType }} store={store} type={templateType} />
          <div className="bg-white rounded-xl shadow-sm border p-4 text-sm text-gray-600">
            <div className="font-bold text-gray-800 mb-2">Gợi ý cấu trúc bảng</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Khi mẫu có cấu hình trực quan, preview/in thử sinh HTML/CSS từ cấu hình đó.</li>
              <li>Nếu không có cấu hình trực quan, HTML/CSS cũ vẫn hoạt động với <code className="font-mono bg-gray-100 px-1 rounded">{'{{items_rows}}'}</code> hoặc <code className="font-mono bg-gray-100 px-1 rounded">{'{{#items}}...{{/items}}'}</code>.</li>
              <li>Các placeholder ảnh như <code className="font-mono bg-gray-100 px-1 rounded">{'{{images.logo}}'}</code>, <code className="font-mono bg-gray-100 px-1 rounded">{'{{images.qr}}'}</code> render bằng dữ liệu mẫu để kiểm tra bố cục.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
