import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  FileText,
  Italic,
  Loader2,
  RefreshCw,
  Save,
  Table,
  Type,
  Underline,
  X,
} from 'lucide-react';
import InvoiceTemplateRenderer from './InvoiceTemplateRenderer';
import mockInvoicePayload from './mockInvoicePayload';
import EditorCanvas from './editor/EditorCanvas';
import EditorToolbar from './editor/EditorToolbar';
import ElementPalette from './editor/ElementPalette';
import LayerPanel from './editor/LayerPanel';
import PropertiesPanel from './editor/PropertiesPanel';
import useTemplateEditorState from './editor/useTemplateEditorState';
import { buildEditorMeta, getEditorPaperDimensions } from './editor/templateSchemaAdapter';
import {
  DEFAULT_SAPO_TEMPLATE_CSS,
  DEFAULT_SAPO_TEMPLATE_HTML,
  SAPO_TEMPLATE_VARIABLE_GROUPS,
  isHtmlTemplateSource,
} from './htmlTemplateEngine';
import { getApiErrorMessage, invoicesApi, printTemplatesApi } from '../../utils/apiClient';

function normalizeApiItem(data) {
  if (!data) return null;
  if (data.item && typeof data.item === 'object' && !Array.isArray(data.item)) return data.item;
  if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    if (data.data.item && typeof data.data.item === 'object' && !Array.isArray(data.data.item)) return data.data.item;
    if (data.data.template && typeof data.data.template === 'object' && !Array.isArray(data.data.template)) return data.data.template;
    if (data.data.id || data.data.template_name || data.data.editor_document || data.data.layout_json) return data.data;
  }
  if (data.template && typeof data.template === 'object' && !Array.isArray(data.template)) return data.template;
  if (data.id || data.template_name || data.editor_document || data.layout_json) return data;
  return null;
}

function buildNotice(tone, message) {
  return { tone, message };
}

function getErrorMessage(error, fallback = 'Thao tác thất bại.') {
  return getApiErrorMessage(error?.data || error, error?.message || fallback);
}

function getInvoiceListItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function isRevisionConflict(error) {
  const code = error?.data?.code || error?.code || '';
  return Number(error?.status) === 409 || code === 'PRINT_TEMPLATE_REVISION_CONFLICT';
}

function buildConflictNotice(error, fallback = 'Mẫu in đã được cập nhật ? phi?n kh?c.') {
  const currentRevision = error?.data?.details?.current_revision || error?.data?.current_revision;
  const suffix = currentRevision ? ` Revision hiện tại trên server: ${currentRevision}.` : '';
  return `${getErrorMessage(error, fallback)}${suffix} Bấm “Tải lại” để lấy draft mới nhất trước khi tiếp tục.`;
}

const PX_PER_MM = 3.7795275591;
const SAPO_PAPER_OPTIONS = Object.freeze(['A4', 'A5', 'K80', 'K57']);

function normalizeSapoPaperSize(value) {
  const requested = String(value || '').trim().toUpperCase();
  if (requested === 'K58') return 'K57';
  return SAPO_PAPER_OPTIONS.includes(requested) ? requested : 'A4';
}

function normalizeSapoOrientation(value, paperSize = 'A4') {
  if (String(paperSize || '').toUpperCase().startsWith('K')) return 'portrait';
  return value === 'landscape' ? 'landscape' : 'portrait';
}

function buildSapoDraftFromTemplate(item = {}) {
  const paperSize = normalizeSapoPaperSize(item?.paper_size || item?.settings_json?.paperSize || item?.settings?.paperSize || 'A4');
  const orientation = normalizeSapoOrientation(item?.orientation || item?.settings_json?.orientation || item?.settings?.orientation, paperSize);
  const templateData = item?.template_data || item?.templateData || '';
  return {
    html: isHtmlTemplateSource(templateData) ? String(templateData) : DEFAULT_SAPO_TEMPLATE_HTML,
    css: String(item?.css_style || item?.css || DEFAULT_SAPO_TEMPLATE_CSS),
    paperSize,
    orientation,
  };
}

function getSapoPreviewZoom(paperSize) {
  const normalized = normalizeSapoPaperSize(paperSize);
  if (normalized === 'A4') return 0.5;
  if (normalized === 'A5') return 0.64;
  return 0.92;
}

function hasPreviewPayload(payload) {
  return Boolean(payload && typeof payload === 'object' && Object.keys(payload).length > 0);
}


export default function PrintTemplateEditorModal({
  show,
  template,
  canManage = true,
  onClose,
  onSaved,
}) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [previewPayload, setPreviewPayload] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [editorMode, setEditorMode] = useState('canvas');
  const [sapoDraft, setSapoDraft] = useState(() => buildSapoDraftFromTemplate(template || {}));
  const [canvasInteracting, setCanvasInteracting] = useState(false);
  const htmlEditorRef = useRef(null);

  const editor = useTemplateEditorState(template || {});
  const activeTemplate = editor.template || template || {};
  const setEditorSettings = editor.setSettings;
  const setEditorDocument = editor.setDocument;
  const hasTemplateId = Boolean(activeTemplate?.id);

  const loadTemplateDetail = useCallback(async () => {
    if (!show || !template?.id) return null;
    setLoading(true);
    setNotice(null);
    try {
      const data = await printTemplatesApi.detail(template.id);
      const item = normalizeApiItem(data);
      editor.setTemplateFromServer(item || template);
      setSapoDraft(buildSapoDraftFromTemplate(item || template));
      return item;
    } catch (error) {
      setNotice(buildNotice('error', getErrorMessage(error, 'Không thể tải chi tiết mẫu in.')));
      return null;
    } finally {
      setLoading(false);
    }
  }, [editor.setTemplateFromServer, show, template]);

  const loadPreviewInvoice = useCallback(async (templateId = activeTemplate?.id) => {
    if (!show) return;
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const listData = await invoicesApi.list({ limit: 1, meta: 1 });
      const latest = getInvoiceListItems(listData)[0] || null;
      if (!latest) {
        setPreviewPayload({});
        setPreviewError('Chưa có hóa đơn thật để preview. Editor vẫn hiển thị realtime bằng dữ liệu rỗng an toàn; mẫu in vẫn load/lưu qua API thật /api/print-templates.');
        return;
      }
      const idOrCode = latest.invoice_code || latest.id;
      if (!idOrCode) {
        setPreviewPayload({});
        setPreviewError('Hóa don mới nh?t thi?u m?/ID d? g?i API preview. Editor v?n hiển thị realtime b?ng dữ liệu r?ng an to?n.');
        return;
      }
      const payload = await invoicesApi.printData(idOrCode, templateId ? { template_id: templateId } : {});
      if (!payload || !payload.invoice) {
        setPreviewPayload({});
        setPreviewError('API preview hóa đơn trả dữ liệu chưa đầy đủ. Editor vẫn hiển thị realtime bằng dữ liệu rỗng an toàn.');
        return;
      }
      setPreviewPayload(payload);
    } catch (error) {
      setPreviewPayload({});
      setPreviewError(`${getErrorMessage(error, 'Không thể tải hóa đơn thật để preview.')} Editor vẫn hiển thị realtime bằng dữ liệu rỗng an toàn.`);
    } finally {
      setPreviewLoading(false);
    }
  }, [activeTemplate?.id, show]);

  // Migration nh?: xóa c?c key autosave/draft c? trong localStorage/sessionStorage (n?u c?).
  useEffect(() => {
    if (!show) return;
    if (typeof window === 'undefined') return;
    try {
      const LEGACY_KEY_PATTERNS = [
        /^kha_print_template.*autosave/i,
        /^kha_print_template.*draft/i,
        /^print_template.*autosave/i,
        /^print_template.*draft/i,
        /^invoice_editor.*autosave/i,
        /^invoice_editor.*draft/i,
        /^template_editor.*autosave/i,
        /^template_editor.*draft/i,
      ];
      const cleanStorage = (storage) => {
        if (!storage) return;
        const toRemove = [];
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (key && LEGACY_KEY_PATTERNS.some(pattern => pattern.test(key))) toRemove.push(key);
        }
        toRemove.forEach(key => { try { storage.removeItem(key); } catch (_) {} });
      };
      cleanStorage(window.localStorage);
      cleanStorage(window.sessionStorage);
    } catch (_) { /* ignore */ }
  }, [show]);

  useEffect(() => {
    if (!show) return;
    let active = true;
    const load = async () => {
      const item = await loadTemplateDetail();
      if (!active) return;
      await loadPreviewInvoice(item?.id || template?.id);
    };
    load();
    return () => { active = false; };
  }, [loadPreviewInvoice, loadTemplateDetail, show, template?.id]);

  const previewTemplate = useMemo(() => ({
    ...activeTemplate,
    editor_document: {
      ...(activeTemplate.editor_document || {}),
      schema_version: 2,
      revision: editor.revision,
      has_draft: true,
      active: 'draft',
      draft: {
        schema_version: 2,
        source_schema_version: 2,
        migrated: false,
        layout_json: editor.document,
        settings_json: editor.settings,
      },
      published: activeTemplate.editor_document?.published || {
        schema_version: 2,
        layout_json: editor.document,
        settings_json: editor.settings,
      },
    },
    layout_json: editor.document,
    settings_json: editor.settings,
    layout_v2: editor.document,
    settings_v2: editor.settings,
    paper_size: editor.document.canvas?.pageSize || activeTemplate.paper_size || 'A5',
    orientation: editor.document.canvas?.orientation || activeTemplate.orientation || 'portrait',
    revision: editor.revision,
  }), [activeTemplate, editor.document, editor.revision, editor.settings]);
  const deferredPreviewTemplate = useDeferredValue(previewTemplate);

  const sapoPreviewTemplate = useMemo(() => {
    const paperSize = normalizeSapoPaperSize(sapoDraft.paperSize);
    const orientation = normalizeSapoOrientation(sapoDraft.orientation, paperSize);
    return {
      ...activeTemplate,
      template_data: sapoDraft.html,
      css_style: sapoDraft.css,
      paper_size: paperSize,
      orientation,
      settings_json: {
        ...(activeTemplate.settings_json || activeTemplate.settings || {}),
        paperSize,
        paper_size: paperSize,
        orientation,
        previewZoom: getSapoPreviewZoom(paperSize),
        scale: activeTemplate.print_scale || activeTemplate.settings_json?.scale || 1,
        paddingMm: paperSize === 'A4' ? 10 : 5,
        marginMm: 0,
        fontSize: 10,
        lineSpacing: 1.35,
      },
    };
  }, [activeTemplate, sapoDraft.css, sapoDraft.html, sapoDraft.orientation, sapoDraft.paperSize]);

  const sapoPreviewPayload = useMemo(
    () => (hasPreviewPayload(previewPayload) ? previewPayload : mockInvoicePayload),
    [previewPayload],
  );

  const markRevisionConflict = useCallback((error, fallback) => {
    const currentRevision = error?.data?.details?.current_revision || error?.data?.current_revision || null;
    const suffix = currentRevision ? ` Revision hiện tại tr?n server: ${currentRevision}.` : '';
    setNotice(buildNotice('error', `${getErrorMessage(error, fallback)}${suffix} B?m ?Tải lỗi? ?? l?y b?n mới nh?t tr??c khi tiếp tục.`));
  }, []);

  const handleFitZoom = useCallback(() => {
    const page = getEditorPaperDimensions(editor.document);
    const maxWidthPx = Math.max(420, window.innerWidth - 640);
    const maxHeightPx = Math.max(420, window.innerHeight - 220);
    const nextZoom = Math.max(0.25, Math.min(1.6, maxWidthPx / (page.width * PX_PER_MM), maxHeightPx / (page.height * PX_PER_MM)));
    setEditorSettings(current => ({ ...current, editor: { ...current.editor, zoom: Math.round(nextZoom * 100) / 100 } }));
  }, [editor.document, setEditorSettings]);

  const handleSave = useCallback(async () => {
    if (!activeTemplate?.id) {
      setNotice(buildNotice('error', 'M?u demo ch?a c? tr?n server. Hủy tạo mẫu in tr??c khi l?u.'));
      return null;
    }
    setBusy('save');
    setNotice(null);
    try {
      // L?u layout hiện tại v?o database/config ch?nh (không tạo draft).
      const payload = buildTemplatePayloadFromDocument(activeTemplate, editor.document, editor.settings);
      const data = await printTemplatesApi.update(activeTemplate.id, {
        layout_json: payload.layout_json,
        settings_json: payload.settings_json,
        paper_size: payload.paper_size,
        orientation: payload.orientation,
        template_type: activeTemplate.template_type || 'order',
        status: activeTemplate.status === 'archived' ? 'active' : activeTemplate.status || 'active',
        editor_meta_json: buildEditorMeta(editor.settings, { action: 'manual-save' }),
      });
      const item = normalizeApiItem(data);
      if (item) {
        // Ch? cập nhật metadata, KHÔNG g?i setTemplateFromServer ?? gi? canvas hiện tại.
        editor.setRevision(item.revision || editor.revision);
        editor.setTemplate(current => ({ ...current, ...item }));
        onSaved?.(item);
      }
      setNotice(buildNotice('success', '?? l?u mẫu in. Layout hiện tại ???c gi? nguy?n.'));
      return item;
    } catch (error) {
      if (isRevisionConflict(error)) {
        markRevisionConflict(error, 'Không th? l?u mẫu in: ?? ???c cập nhật ? phi?n kh?c.');
      } else {
        setNotice(buildNotice('error', getErrorMessage(error, 'Không th? l?u mẫu in.')));
      }
      return null;
    } finally {
      setBusy('');
    }
  }, [activeTemplate, editor, markRevisionConflict, onSaved]);

  const handlePublish = useCallback(async () => {
    if (!activeTemplate?.id) {
      setNotice(buildNotice('error', 'M?u demo chua c? tr?n server. Hủy tạo mẫu in tr?n server trước khi publish.'));
      return;
    }
    setBusy('publish');
    setNotice(null);
    try {
      const currentRevision = editor.revision;
      const data = await printTemplatesApi.publish(activeTemplate.id, {
        revision: currentRevision,
        layout_json: editor.document,
        settings_json: editor.settings,
        editor_meta_json: buildEditorMeta(editor.settings, { action: 'publish' }),
        status: 'active',
      });
      const item = normalizeApiItem(data);
      if (item) {
        editor.setRevision(item.revision || editor.revision);
        editor.setTemplate(current => ({ ...current, ...item }));
        onSaved?.(item);
      }
      setNotice(buildNotice('success', 'Đã publish mẫu in. Trang in hóa đơn sẽ dùng bản published mới.'));
    } catch (error) {
      if (isRevisionConflict(error)) {
        markRevisionConflict(error, 'Không th? publish v? mẫu in đã được cập nhật ? phi?n kh?c.');
      } else {
        setNotice(buildNotice('error', getErrorMessage(error, 'Không thể publish mẫu in.')));
      }
    } finally {
      setBusy('');
    }
  }, [activeTemplate?.id, editor, markRevisionConflict, onSaved]);

  const handleReload = useCallback(async () => {
    setBusy('reload');
    try {
      const item = await loadTemplateDetail();
      if (item) {
        onSaved?.(item);
      }
      await loadPreviewInvoice(item?.id || activeTemplate?.id);
    } finally {
      setBusy('');
    }
  }, [activeTemplate?.id, loadPreviewInvoice, loadTemplateDetail, onSaved]);

  const handleLogoChange = useCallback(async (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file || !activeTemplate?.id) return;
    setBusy('logo');
    setNotice(null);
    try {
      const data = await printTemplatesApi.uploadLogo(activeTemplate.id, file);
      const item = normalizeApiItem(data);
      if (item) {
        editor.setTemplate(current => ({ ...current, ...item }));
        editor.setRevision(item.revision || editor.revision);
        onSaved?.(item);
      }
      setNotice(buildNotice('success', 'D? upload logo. Layout logo v?n bind template.logo, không nh?ng binary v?o JSON.'));
    } catch (error) {
      setNotice(buildNotice('error', getErrorMessage(error, 'Không thể upload logo.')));
    } finally {
      setBusy('');
    }
  }, [activeTemplate?.id, editor, onSaved]);

  const handleRemoveLogo = useCallback(async () => {
    if (!activeTemplate?.id) return;
    setBusy('logo');
    setNotice(null);
    try {
      const data = await printTemplatesApi.removeLogo(activeTemplate.id);
      const item = normalizeApiItem(data);
      if (item) {
        editor.setTemplate(current => ({ ...current, ...item }));
        editor.setRevision(item.revision || editor.revision);
        onSaved?.(item);
      }
      setNotice(buildNotice('success', 'D? xóa logo mẫu in.'));
    } catch (error) {
      setNotice(buildNotice('error', getErrorMessage(error, 'Không thể xóa logo.')));
    } finally {
      setBusy('');
    }
  }, [activeTemplate?.id, editor, onSaved]);

  const hasEditableSelection = Boolean(editor.selectedId && editor.selectedId !== 'itemsTable');

  const handleDuplicateSelected = useCallback(() => {
    if (!hasEditableSelection) return;
    editor.duplicateElement(editor.selectedId);
  }, [editor, hasEditableSelection]);

  const handleDeleteSelected = useCallback(() => {
    if (!hasEditableSelection) return;
    editor.removeElement(editor.selectedId);
  }, [editor, hasEditableSelection]);

  const handleBringSelectedToFront = useCallback(() => {
    if (!hasEditableSelection) return;
    editor.bringElementToFront(editor.selectedId);
  }, [editor, hasEditableSelection]);

  const handleSendSelectedToBack = useCallback(() => {
    if (!hasEditableSelection) return;
    editor.sendElementToBack(editor.selectedId);
  }, [editor, hasEditableSelection]);

  const handleCanvasGestureStart = useCallback(() => {
    setCanvasInteracting(true);
    editor.beginHistory();
  }, [editor]);

  // PHẦN 9: không autosave sau kéo thả - vị trí chỉ lưu khi bấm Lưu (giữ nguyên vị trí)
  const handleCanvasGestureEnd = useCallback(() => {
    editor.endHistory();
    window.requestAnimationFrame(() => setCanvasInteracting(false));
  }, [editor]);

  useEffect(() => {
    if (!show || editorMode !== 'canvas') return undefined;

    const handleShortcut = (event) => {
      const target = event.target;
      const tagName = String(target?.tagName || '').toUpperCase();
      const isEditingField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName) || target?.isContentEditable;
      const key = String(event.key || '').toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;

      if (modifier && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }

      if (modifier && key === 'y') {
        event.preventDefault();
        editor.redo();
        return;
      }

      if (modifier && key === 'd' && hasEditableSelection) {
        event.preventDefault();
        handleDuplicateSelected();
        return;
      }

      if (!isEditingField && (key === 'delete' || key === 'backspace') && hasEditableSelection) {
        event.preventDefault();
        handleDeleteSelected();
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [editor, editorMode, handleDeleteSelected, handleDuplicateSelected, hasEditableSelection, show]);

  const insertIntoSapoHtml = useCallback((snippet) => {
    setSapoDraft(current => {
      const source = current.html || '';
      const textarea = htmlEditorRef.current;
      const start = textarea ? textarea.selectionStart : source.length;
      const end = textarea ? textarea.selectionEnd : source.length;
      const next = `${source.slice(0, start)}${snippet}${source.slice(end)}`;
      window.requestAnimationFrame(() => {
        if (!htmlEditorRef.current) return;
        const cursor = start + String(snippet).length;
        htmlEditorRef.current.focus();
        htmlEditorRef.current.setSelectionRange(cursor, cursor);
      });
      return { ...current, html: next };
    });
  }, []);

  const wrapSapoSelection = useCallback((before, after = '') => {
    setSapoDraft(current => {
      const source = current.html || '';
      const textarea = htmlEditorRef.current;
      const start = textarea ? textarea.selectionStart : source.length;
      const end = textarea ? textarea.selectionEnd : source.length;
      const selected = source.slice(start, end) || 'Nội dung';
      const replacement = `${before}${selected}${after}`;
      const next = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
      window.requestAnimationFrame(() => {
        if (!htmlEditorRef.current) return;
        const contentStart = start + before.length;
        htmlEditorRef.current.focus();
        htmlEditorRef.current.setSelectionRange(contentStart, contentStart + selected.length);
      });
      return { ...current, html: next };
    });
  }, []);

  const updateSapoPaperSize = useCallback((value) => {
    const paperSize = normalizeSapoPaperSize(value);
    setSapoDraft(current => ({
      ...current,
      paperSize,
      orientation: normalizeSapoOrientation(current.orientation, paperSize),
    }));
  }, []);

  const updateSapoOrientation = useCallback((value) => {
    setSapoDraft(current => ({
      ...current,
      orientation: normalizeSapoOrientation(value, current.paperSize),
    }));
  }, []);

  const handleUseDefaultSapoTemplate = useCallback(() => {
    setSapoDraft(current => ({
      ...current,
      html: DEFAULT_SAPO_TEMPLATE_HTML,
      css: DEFAULT_SAPO_TEMPLATE_CSS,
      paperSize: 'A4',
      orientation: 'portrait',
    }));
    setNotice(buildNotice('success', 'D? n?p m?u đơn hàng A4 mặc định.'));
  }, []);

  const handleSapoReload = useCallback(async () => {
    setBusy('sapo-reload');
    try {
      const item = await loadTemplateDetail();
      if (item) onSaved?.(item);
      await loadPreviewInvoice(item?.id || activeTemplate?.id);
    } finally {
      setBusy('');
    }
  }, [activeTemplate?.id, loadPreviewInvoice, loadTemplateDetail, onSaved]);

  const handleSapoSave = useCallback(async () => {
    if (!activeTemplate?.id) {
      setNotice(buildNotice('error', 'Cần lưu mẫu in trước khi chỉnh nội dung kiểu Sapo.'));
      return;
    }
    setBusy('sapo-save');
    setNotice(null);
    try {
      const paperSize = normalizeSapoPaperSize(sapoDraft.paperSize);
      const orientation = normalizeSapoOrientation(sapoDraft.orientation, paperSize);
      const data = await printTemplatesApi.update(activeTemplate.id, {
        template_data: sapoDraft.html,
        css_style: sapoDraft.css,
        paper_size: paperSize,
        orientation,
        template_type: activeTemplate.template_type || 'order',
        status: activeTemplate.status === 'archived' ? 'active' : activeTemplate.status || 'active',
      });
      const item = normalizeApiItem(data);
      if (item) {
        editor.setTemplateFromServer(item, { preferDraft: false });
        setSapoDraft(buildSapoDraftFromTemplate(item));
        onSaved?.(item);
      }
      setNotice(buildNotice('success', 'D? luu mẫu in ki?u Sapo. Trang in hóa đơn sử dụng b?n HTML mới.'));
    } catch (error) {
      setNotice(buildNotice('error', getErrorMessage(error, 'Không thể lưu mẫu in kiểu Sapo.')));
    } finally {
      setBusy('');
    }
  }, [activeTemplate, editor, onSaved, sapoDraft.css, sapoDraft.html, sapoDraft.orientation, sapoDraft.paperSize]);

  if (!show) return null;

  return (
    <div className="invoice-editor-modal" role="presentation">
      <div className="invoice-editor-shell" role="dialog" aria-modal="true" aria-labelledby="invoice-editor-title">
        <div className="invoice-editor-topbar">
          <div>
            <h1 id="invoice-editor-title">Chỉnh sửa mẫu in đơn hàng</h1>
            <p>{editorMode === 'sapo' ? 'So?n n?i dung mẫu in, chọn t? kh?a v? xem tr??c A4 theo dữ liệu hóa đơn th?t.' : 'K?o th?, resize, snap grid. B?m ?L?u? ?? l?u layout, b?m ?Publish? ?? định d?u b?n in.'}</p>
          </div>
          <div className="invoice-editor-topbar-actions">
            <div className="invoice-editor-mode-toggle" role="tablist" aria-label="Chế độ chỉnh sửa mẫu in">
              <button type="button" className={editorMode === 'sapo' ? 'is-active' : ''} onClick={() => setEditorMode('sapo')}>
                <Code2 size={15} /> Sapo
              </button>
              <button type="button" className={editorMode === 'canvas' ? 'is-active' : ''} onClick={() => setEditorMode('canvas')}>
                <Type size={15} /> Kéo thả
              </button>
            </div>
            {/* PHẦN 9: bỏ checkbox Tự động lưu - chỉ còn Lưu + Publish */}
            <button type="button" className="invoice-editor-close" onClick={onClose} disabled={busy === 'publish' || busy === 'sapo-save'}>
              <X size={20} />
            </button>
          </div>
        </div>

        {editorMode === 'canvas' ? (
          <EditorToolbar
            template={activeTemplate}
            settings={editor.settings}
            busy={busy}
            canManage={canManage}
            selectedId={editor.selectedId}
            canUndo={editor.canUndo}
            canRedo={editor.canRedo}
            onZoomChange={(zoom) => setEditorSettings(current => ({ ...current, editor: { ...current.editor, zoom } }))}
            onToggleGrid={() => setEditorSettings(current => ({ ...current, editor: { ...current.editor, showGrid: current.editor?.showGrid === false } }))}
            onToggleRuler={() => setEditorSettings(current => ({ ...current, editor: { ...current.editor, showRuler: current.editor?.showRuler === false } }))}
            onToggleSnap={() => setEditorSettings(current => ({ ...current, editor: { ...current.editor, snapEnabled: current.editor?.snapEnabled === false } }))}
            onFitZoom={handleFitZoom}
            onSave={handleSave}
            onPublish={handlePublish}
            onReload={handleReload}
            onLogoChange={handleLogoChange}
            onRemoveLogo={handleRemoveLogo}
            onUndo={editor.undo}
            onRedo={editor.redo}
            onDuplicateSelected={handleDuplicateSelected}
            onDeleteSelected={handleDeleteSelected}
            onBringToFront={handleBringSelectedToFront}
            onSendToBack={handleSendSelectedToBack}
          />
        ) : (
          <div className="invoice-sapo-toolbar">
            <div className="invoice-sapo-toolbar-group">
              <button type="button" title="Đậm" aria-label="Đậm" onClick={() => wrapSapoSelection('<strong>', '</strong>')}><Bold size={16} /></button>
              <button type="button" title="Nghiêng" aria-label="Nghiêng" onClick={() => wrapSapoSelection('<em>', '</em>')}><Italic size={16} /></button>
              <button type="button" title="Gạch chân" aria-label="Gạch chân" onClick={() => wrapSapoSelection('<u>', '</u>')}><Underline size={16} /></button>
              <button type="button" title="Tiêu đề" aria-label="Tiêu đề" onClick={() => wrapSapoSelection('<h2>', '</h2>')}><Type size={16} /></button>
              <button type="button" title="Căn trái" aria-label="Căn trái" onClick={() => wrapSapoSelection('<div style="text-align:left">', '</div>')}><AlignLeft size={16} /></button>
              <button type="button" title="Căn giữa" aria-label="Căn giữa" onClick={() => wrapSapoSelection('<div style="text-align:center">', '</div>')}><AlignCenter size={16} /></button>
              <button type="button" title="Căn phải" aria-label="Căn phải" onClick={() => wrapSapoSelection('<div style="text-align:right">', '</div>')}><AlignRight size={16} /></button>
              <button type="button" title="Chèn bảng hàng" aria-label="Chèn bảng hàng" onClick={() => insertIntoSapoHtml('\n{{items_table}}\n')}><Table size={16} /></button>
            </div>

            <div className="invoice-sapo-toolbar-group">
              <label>
                <span>Khổ giấy</span>
                <select value={sapoDraft.paperSize} onChange={event => updateSapoPaperSize(event.target.value)}>
                  {SAPO_PAPER_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label>
                <span>Hướng</span>
                <select value={sapoDraft.orientation} onChange={event => updateSapoOrientation(event.target.value)} disabled={String(sapoDraft.paperSize || '').startsWith('K')}>
                  <option value="portrait">Dọc</option>
                  <option value="landscape">Ngang</option>
                </select>
              </label>
            </div>

            <div className="invoice-sapo-toolbar-group invoice-sapo-toolbar-actions">
              <button type="button" onClick={handleUseDefaultSapoTemplate}><FileText size={16} /> Mẫu A4</button>
              <button type="button" onClick={handleSapoReload} disabled={busy === 'sapo-reload'}><RefreshCw size={16} className={busy === 'sapo-reload' ? 'animate-spin' : ''} /> Tải lại</button>
              <button type="button" className="invoice-sapo-save" onClick={handleSapoSave} disabled={!canManage || busy === 'sapo-save'}>
                {busy === 'sapo-save' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Lưu mẫu
              </button>
            </div>
          </div>
        )}

        {notice?.message && (
          <div className={`invoice-editor-notice invoice-editor-notice-${notice.tone}`}>
            {notice.tone === 'error' && <AlertTriangle size={16} />}
            <span>{notice.message}</span>
          </div>
        )}

        {loading ? (
          <div className="invoice-editor-loading">
            <Loader2 size={24} className="animate-spin" /> Đang tải editor document từ API template...
          </div>
        ) : editorMode === 'canvas' ? (
          <div className="invoice-editor-workspace">
            <div className="invoice-editor-left">
              <ElementPalette onAddElement={(type, options) => editor.addElement(type, options)} />
              <LayerPanel
                document={editor.document}
                selectedId={editor.selectedId}
                onSelect={editor.setSelectedId}
                onUpdateElement={editor.updateElement}
                onRemoveElement={editor.removeElement}
                onDuplicateElement={editor.duplicateElement}
                onBringToFront={editor.bringElementToFront}
                onSendToBack={editor.sendElementToBack}
              />
            </div>

            <div className="invoice-editor-center">
              {previewLoading && (
                <div className="invoice-editor-preview-source"><Loader2 size={14} className="animate-spin" /> Đang nạp hóa đơn thật để preview...</div>
              )}
              {previewError && <div className="invoice-editor-preview-source invoice-editor-preview-source-warning">{previewError}</div>}
              <EditorCanvas
                document={editor.document}
                settings={editor.settings}
                payload={previewPayload || {}}
                template={previewTemplate}
                selectedId={editor.selectedId}
                onSelect={editor.setSelectedId}
                onAddElement={editor.addElement}
                onUpdateElement={editor.updateElement}
                onUpdateTable={editor.updateTable}
                onBeginHistory={handleCanvasGestureStart}
                onEndHistory={handleCanvasGestureEnd}
                onSetDocument={setEditorDocument}
              />
            </div>

            <div className="invoice-editor-right">
              <PropertiesPanel
                document={editor.document}
                settings={editor.settings}
                selectedElement={editor.selectedElement}
                selectedId={editor.selectedId}
                onUpdateElement={editor.updateElement}
                onUpdateTable={editor.updateTable}
                onUpdateSettings={setEditorSettings}
                onSetDocument={setEditorDocument}
              />
              <section className="invoice-editor-render-preview">
                <div className="invoice-editor-panel-title">Preview renderer in thật</div>
                {canvasInteracting ? (
                  <div className="invoice-editor-empty-preview">Đang kéo thả, preview in thật sẽ cập nhật khi thả chuột.</div>
                ) : previewPayload !== null ? (
                  <div className="invoice-print-preview-frame invoice-editor-render-preview-frame">
                    <InvoiceTemplateRenderer payload={previewPayload} template={deferredPreviewTemplate} previewZoom={0.38} renderMode="editor-preview" />
                  </div>
                ) : (
                  <div className="invoice-editor-empty-preview">Chưa có dữ liệu hóa đơn để render preview.</div>
                )}
              </section>
            </div>
          </div>
        ) : (
          <div className="invoice-sapo-workspace">
            <aside className="invoice-sapo-variables">
              <div className="invoice-editor-panel-title">Từ khóa</div>
              <div className="invoice-sapo-variable-list">
                {SAPO_TEMPLATE_VARIABLE_GROUPS.map(group => (
                  <section key={group.group}>
                    <h4>{group.group}</h4>
                    <div>
                      {group.variables.map(variable => (
                        <button
                          key={`${group.group}-${variable.label}`}
                          type="button"
                          onClick={() => insertIntoSapoHtml(variable.token)}
                          title={variable.token}
                        >
                          <span>{variable.label}</span>
                          <code>{variable.token}</code>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </aside>

            <section className="invoice-sapo-editor-pane">
              <div className="invoice-sapo-editor-header">
                <span>Nội dung mẫu in</span>
                <code>{sapoDraft.html.length.toLocaleString('vi-VN')} ký tự</code>
              </div>
              <textarea
                ref={htmlEditorRef}
                className="invoice-sapo-code-textarea"
                value={sapoDraft.html}
                spellCheck={false}
                onChange={event => setSapoDraft(current => ({ ...current, html: event.target.value }))}
              />

              <div className="invoice-sapo-editor-header invoice-sapo-css-header">
                <span>CSS riêng</span>
                <code>{sapoDraft.css.length.toLocaleString('vi-VN')} ký tự</code>
              </div>
              <textarea
                className="invoice-sapo-css-textarea"
                value={sapoDraft.css}
                spellCheck={false}
                onChange={event => setSapoDraft(current => ({ ...current, css: event.target.value }))}
              />
            </section>

            <section className="invoice-sapo-preview-pane">
              {previewLoading && (
                <div className="invoice-editor-preview-source"><Loader2 size={14} className="animate-spin" /> Đang nạp hóa đơn thật để preview...</div>
              )}
              {previewError && <div className="invoice-editor-preview-source invoice-editor-preview-source-warning">{previewError}</div>}
              <div className="invoice-sapo-preview-meta">
                <span>Preview</span>
                <code>{sapoDraft.paperSize} ? {sapoDraft.orientation === 'landscape' ? 'Ngang' : 'D?c'}</code>
              </div>
              <div className="invoice-print-preview-frame invoice-sapo-preview-frame">
                <InvoiceTemplateRenderer
                  payload={sapoPreviewPayload}
                  template={sapoPreviewTemplate}
                  previewZoom={getSapoPreviewZoom(sapoDraft.paperSize)}
                  renderMode="editor-preview"
                />
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
