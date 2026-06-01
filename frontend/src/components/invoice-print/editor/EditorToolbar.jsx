import { Grid3X3, Loader2, Maximize2, RefreshCcw, Ruler, Save, Send, Trash2, Upload, ZoomIn, ZoomOut } from 'lucide-react';

function statusText(status, lastSavedAt) {
  if (status === 'saving') return 'Đang autosave...';
  if (status === 'dirty') return 'Có thay đổi chưa lưu';
  if (status === 'saved' && lastSavedAt) return `Đã autosave ${new Date(lastSavedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
  if (status === 'conflict') return 'Xung đột revision';
  if (status === 'error') return 'Autosave lỗi';
  return 'Sẵn sàng';
}

export default function EditorToolbar({
  template,
  settings,
  autosaveStatus,
  lastSavedAt,
  busy = '',
  canManage = true,
  onZoomChange,
  onToggleGrid,
  onToggleRuler,
  onToggleSnap,
  onFitZoom,
  onSaveDraft,
  onPublish,
  onDiscardDraft,
  onReload,
  onLogoChange,
  onRemoveLogo,
}) {
  const editor = settings?.editor || {};
  const zoom = Number(editor.zoom) || 1;

  return (
    <div className="invoice-editor-toolbar">
      <div className="invoice-editor-toolbar-main">
        <div>
          <h2>{template?.template_name || template?.name || 'Mẫu in hóa đơn'}</h2>
          <p>Revision {template?.revision || settings?.publish?.revision || 1} · {template?.has_draft ? 'Có draft' : 'Published'} · {statusText(autosaveStatus, lastSavedAt)}</p>
        </div>
      </div>
      <div className="invoice-editor-toolbar-actions">
        <button type="button" className={editor.showGrid !== false ? 'is-active' : ''} onClick={onToggleGrid}>
          <Grid3X3 size={15} /> Grid
        </button>
        <button type="button" className={editor.showRuler !== false ? 'is-active' : ''} onClick={onToggleRuler}>
          <Ruler size={15} /> Ruler
        </button>
        <button type="button" className={editor.snapEnabled !== false ? 'is-active' : ''} onClick={onToggleSnap}>
          Snap {editor.snapGridMm || 1}mm
        </button>
        <button type="button" onClick={onFitZoom} title="Fit A5 vào khung nhìn">
          <Maximize2 size={15} /> Fit
        </button>
        <button type="button" onClick={() => onZoomChange?.(Math.max(0.25, zoom - 0.1))}>
          <ZoomOut size={15} />
        </button>
        <span className="invoice-editor-zoom-pill">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => onZoomChange?.(Math.min(2.5, zoom + 0.1))}>
          <ZoomIn size={15} />
        </button>
        <label className={`invoice-editor-toolbar-upload ${!canManage || !template?.id || busy === 'logo' ? 'is-disabled' : ''}`}>
          <Upload size={15} /> Logo
          <input type="file" accept="image/*" onChange={onLogoChange} disabled={!canManage || !template?.id || busy === 'logo'} />
        </label>
        <button type="button" onClick={onRemoveLogo} disabled={!canManage || !template?.id || busy === 'logo'}>
          <Trash2 size={15} /> Xóa logo
        </button>
        <button type="button" onClick={onReload} disabled={busy === 'reload'}>
          <RefreshCcw size={15} className={busy === 'reload' ? 'animate-spin' : ''} /> Tải lại
        </button>
        <button type="button" onClick={onSaveDraft} disabled={!canManage || busy === 'draft'}>
          {busy === 'draft' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu draft
        </button>
        <button type="button" className="invoice-editor-toolbar-publish" onClick={onPublish} disabled={!canManage || !onPublish || busy === 'publish'}>
          {busy === 'publish' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Publish
        </button>
        <button type="button" className="invoice-editor-toolbar-danger" onClick={onDiscardDraft} disabled={!canManage || !template?.id || busy === 'discard'}>
          {busy === 'discard' ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Bỏ draft
        </button>
      </div>
    </div>
  );
}
