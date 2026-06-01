import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import InvoiceTemplateRenderer from './InvoiceTemplateRenderer';
import EditorCanvas from './editor/EditorCanvas';
import EditorToolbar from './editor/EditorToolbar';
import ElementPalette from './editor/ElementPalette';
import LayerPanel from './editor/LayerPanel';
import PropertiesPanel from './editor/PropertiesPanel';
import useTemplateAutosave from './editor/useTemplateAutosave';
import useTemplateEditorState from './editor/useTemplateEditorState';
import { buildEditorMeta, getEditorPaperDimensions } from './editor/templateSchemaAdapter';
import { getApiErrorMessage, invoicesApi, printTemplatesApi } from '../../utils/apiClient';

function normalizeApiItem(data) {
  return data?.item || data?.data || data || null;
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

function buildConflictNotice(error, fallback = 'Mẫu in đã được cập nhật ở phiên khác.') {
  const currentRevision = error?.data?.details?.current_revision || error?.data?.current_revision;
  const suffix = currentRevision ? ` Revision hiện tại trên server: ${currentRevision}.` : '';
  return `${getErrorMessage(error, fallback)}${suffix} Bấm “Tải lại” để lấy draft mới nhất trước khi tiếp tục.`;
}

const PX_PER_MM = 3.7795275591;

function makeAutosaveBaselineKey(item = {}, fallback = {}) {
  return `${item?.id || fallback?.id || 'template'}:${item?.revision || fallback?.revision || 1}:${item?.updated_at || item?.last_autosaved_at || item?.published_at || Date.now()}`;
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
  const [autosaveBaselineKey, setAutosaveBaselineKey] = useState('initial');

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
      setAutosaveBaselineKey(makeAutosaveBaselineKey(item, template));
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
        setPreviewPayload(null);
        setPreviewError('Chưa có hóa đơn thật để preview. Editor vẫn lưu layout, trang in sẽ dùng dữ liệu thật khi có hóa đơn.');
        return;
      }
      const idOrCode = latest.invoice_code || latest.id;
      const payload = await invoicesApi.printData(idOrCode, templateId ? { template_id: templateId } : {});
      setPreviewPayload(payload);
    } catch (error) {
      setPreviewPayload(null);
      setPreviewError(getErrorMessage(error, 'Không thể tải hóa đơn thật để preview.'));
    } finally {
      setPreviewLoading(false);
    }
  }, [activeTemplate?.id, show]);

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

  const autosave = useTemplateAutosave({
    templateId: activeTemplate?.id,
    enabled: show && canManage && hasTemplateId && !loading,
    document: editor.document,
    settings: editor.settings,
    revision: editor.revision,
    baselineKey: autosaveBaselineKey,
    onSaved: (item) => {
      if (!item) return;
      editor.setRevision(item.revision || editor.revision);
      editor.setTemplate(current => ({ ...current, ...item }));
      onSaved?.(item);
    },
    onConflict: (conflict) => {
      setNotice(buildNotice('error', `${conflict.message} Bấm “Tải lại” để lấy draft mới nhất trước khi tiếp tục.`));
    },
    onError: (error) => {
      setNotice(buildNotice('error', getErrorMessage(error, 'Autosave mẫu in thất bại.')));
    },
  });

  const hasConflict = autosave.status === 'conflict';

  const markRevisionConflict = useCallback((error, fallback) => {
    const conflict = {
      message: buildConflictNotice(error, fallback),
      currentRevision: error?.data?.details?.current_revision || error?.data?.current_revision || null,
      expectedRevision: error?.data?.details?.expected_revision || error?.data?.expected_revision || editor.revision,
    };
    autosave.markConflict(conflict);
    setNotice(buildNotice('error', conflict.message));
  }, [autosave, editor.revision]);

  const handleFitZoom = useCallback(() => {
    const page = getEditorPaperDimensions(editor.document);
    const maxWidthPx = Math.max(420, window.innerWidth - 640);
    const maxHeightPx = Math.max(420, window.innerHeight - 220);
    const nextZoom = Math.max(0.25, Math.min(1.6, maxWidthPx / (page.width * PX_PER_MM), maxHeightPx / (page.height * PX_PER_MM)));
    setEditorSettings(current => ({ ...current, editor: { ...current.editor, zoom: Math.round(nextZoom * 100) / 100 } }));
  }, [editor.document, setEditorSettings]);

  const saveDraftNow = useCallback(async () => {
    if (!activeTemplate?.id) return null;
    setBusy('draft');
    setNotice(null);
    try {
      const data = await printTemplatesApi.autosave(activeTemplate.id, {
        revision: editor.revision,
        layout_json: editor.document,
        settings_json: editor.settings,
        editor_meta_json: buildEditorMeta(editor.settings, { action: 'manual-save' }),
      });
      const item = normalizeApiItem(data);
      if (item) {
        editor.setTemplateFromServer(item, { preferDraft: true });
        setAutosaveBaselineKey(makeAutosaveBaselineKey(item, activeTemplate));
        autosave.markSaved(item);
        onSaved?.(item);
      }
      setNotice(buildNotice('success', 'Đã lưu draft mẫu in.'));
      return item;
    } catch (error) {
      if (isRevisionConflict(error)) {
        markRevisionConflict(error, 'Không thể lưu draft vì mẫu in đã được cập nhật ở phiên khác.');
      } else {
        setNotice(buildNotice('error', getErrorMessage(error, 'Không thể lưu draft mẫu in.')));
      }
      return null;
    } finally {
      setBusy('');
    }
  }, [activeTemplate?.id, autosave, editor, markRevisionConflict, onSaved]);

  const handlePublish = useCallback(async () => {
    if (!activeTemplate?.id) return;
    setBusy('publish');
    setNotice(null);
    try {
      const data = await printTemplatesApi.publish(activeTemplate.id, {
        revision: editor.revision,
        layout_json: editor.document,
        settings_json: editor.settings,
        editor_meta_json: buildEditorMeta(editor.settings, { action: 'publish' }),
        status: 'active',
      });
      const item = normalizeApiItem(data);
      if (item) {
        editor.setTemplateFromServer(item, { preferDraft: false });
        setAutosaveBaselineKey(makeAutosaveBaselineKey(item, activeTemplate));
        autosave.markSaved(item);
        onSaved?.(item);
      }
      setNotice(buildNotice('success', 'Đã publish mẫu in. Trang in hóa đơn sẽ dùng bản published mới.'));
    } catch (error) {
      if (isRevisionConflict(error)) {
        markRevisionConflict(error, 'Không thể publish vì mẫu in đã được cập nhật ở phiên khác.');
      } else {
        setNotice(buildNotice('error', getErrorMessage(error, 'Không thể publish mẫu in.')));
      }
    } finally {
      setBusy('');
    }
  }, [activeTemplate?.id, autosave, editor, markRevisionConflict, onSaved]);

  const handleDiscardDraft = useCallback(async () => {
    if (!activeTemplate?.id) return;
    if (!window.confirm('Bỏ draft hiện tại và quay về bản published?')) return;
    setBusy('discard');
    setNotice(null);
    try {
      const data = await printTemplatesApi.discardDraft(activeTemplate.id, { revision: editor.revision });
      const item = normalizeApiItem(data);
      if (item) {
        editor.setTemplateFromServer(item, { preferDraft: false });
        setAutosaveBaselineKey(makeAutosaveBaselineKey(item, activeTemplate));
        autosave.resetAutosave(item.revision || editor.revision);
        onSaved?.(item);
      }
      setNotice(buildNotice('success', 'Đã bỏ draft và khôi phục bản published.'));
    } catch (error) {
      if (isRevisionConflict(error)) {
        markRevisionConflict(error, 'Không thể bỏ draft vì mẫu in đã được cập nhật ở phiên khác.');
      } else {
        setNotice(buildNotice('error', getErrorMessage(error, 'Không thể bỏ draft mẫu in.')));
      }
    } finally {
      setBusy('');
    }
  }, [activeTemplate?.id, autosave, editor, markRevisionConflict, onSaved]);

  const handleReload = useCallback(async () => {
    setBusy('reload');
    try {
      const item = await loadTemplateDetail();
      if (item) {
        autosave.resetAutosave(item.revision || editor.revision);
        onSaved?.(item);
      }
      await loadPreviewInvoice(item?.id || activeTemplate?.id);
    } finally {
      setBusy('');
    }
  }, [activeTemplate?.id, autosave, editor.revision, loadPreviewInvoice, loadTemplateDetail, onSaved]);

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
      setNotice(buildNotice('success', 'Đã upload logo. Layout logo vẫn bind template.logo, không nhúng binary vào JSON.'));
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
      setNotice(buildNotice('success', 'Đã xóa logo mẫu in.'));
    } catch (error) {
      setNotice(buildNotice('error', getErrorMessage(error, 'Không thể xóa logo.')));
    } finally {
      setBusy('');
    }
  }, [activeTemplate?.id, editor, onSaved]);

  if (!show) return null;

  return (
    <div className="invoice-editor-modal" role="presentation">
      <div className="invoice-editor-shell" role="dialog" aria-modal="true" aria-labelledby="invoice-editor-title">
        <div className="invoice-editor-topbar">
          <div>
            <h1 id="invoice-editor-title">Editor mẫu in hóa đơn kiểu Canva</h1>
            <p>Kéo thả, resize, snap grid, autosave draft theo revision và publish sang layout in thật.</p>
          </div>
          <button type="button" className="invoice-editor-close" onClick={onClose} disabled={busy === 'publish'}>
            <X size={20} />
          </button>
        </div>

        <EditorToolbar
          template={activeTemplate}
          settings={editor.settings}
          autosaveStatus={autosave.status}
          lastSavedAt={autosave.lastSavedAt}
          busy={busy}
          canManage={canManage}
          onZoomChange={(zoom) => setEditorSettings(current => ({ ...current, editor: { ...current.editor, zoom } }))}
          onToggleGrid={() => setEditorSettings(current => ({ ...current, editor: { ...current.editor, showGrid: current.editor?.showGrid === false } }))}
          onToggleRuler={() => setEditorSettings(current => ({ ...current, editor: { ...current.editor, showRuler: current.editor?.showRuler === false } }))}
          onToggleSnap={() => setEditorSettings(current => ({ ...current, editor: { ...current.editor, snapEnabled: current.editor?.snapEnabled === false } }))}
          onFitZoom={handleFitZoom}
          onSaveDraft={saveDraftNow}
          onPublish={hasConflict ? undefined : handlePublish}
          onDiscardDraft={handleDiscardDraft}
          onReload={handleReload}
          onLogoChange={handleLogoChange}
          onRemoveLogo={handleRemoveLogo}
        />

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
        ) : (
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
                {previewPayload ? (
                  <div className="invoice-print-preview-frame invoice-editor-render-preview-frame">
                    <InvoiceTemplateRenderer payload={previewPayload} template={previewTemplate} previewZoom={0.38} renderMode="editor-preview" />
                  </div>
                ) : (
                  <div className="invoice-editor-empty-preview">Chưa có hóa đơn thật để render preview.</div>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
