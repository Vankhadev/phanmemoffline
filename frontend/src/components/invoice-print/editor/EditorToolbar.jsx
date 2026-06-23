import {
  BringToFront,
  Copy,
  Grid3X3,
  Loader2,
  Maximize2,
  Redo2,
  RefreshCcw,
  Ruler,
  Save,
  Send,
  SendToBack,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

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
  selectedId = '',
  canUndo = false,
  canRedo = false,
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
  onUndo,
  onRedo,
  onDuplicateSelected,
  onDeleteSelected,
  onBringToFront,
  onSendToBack,
}) {
  const editor = settings?.editor || {};
  const zoom = Number(editor.zoom) || 1;
  const hasEditableSelection = Boolean(selectedId && selectedId !== 'itemsTable');

  return (
    <div className="invoice-editor-toolbar">
      <div className="invoice-editor-toolbar-main">
        <div>
          <h2>{template?.template_name || template?.name || 'Mẫu in hóa đơn'}</h2>
          <p>Revision {template?.revision || settings?.publish?.revision || 1} - {template?.has_draft ? 'Có draft' : 'Published'}</p>
        </div>
        <span className={`invoice-editor-save-status is-${autosaveStatus || 'idle'}`}>{statusText(autosaveStatus, lastSavedAt)}</span>
      </div>

      <div className="invoice-editor-toolbar-actions">
        <div className="invoice-editor-toolbar-group" aria-label="Lịch sử chỉnh sửa">
          <button type="button" title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác" onClick={onUndo} disabled={!canUndo}>
            <Undo2 size={16} />
          </button>
          <button type="button" title="Làm lại (Ctrl+Y)" aria-label="Làm lại" onClick={onRedo} disabled={!canRedo}>
            <Redo2 size={16} />
          </button>
        </div>

        <div className="invoice-editor-toolbar-group" aria-label="Thao tác thành phần">
          <button type="button" title="Nhân bản (Ctrl+D)" aria-label="Nhân bản" onClick={onDuplicateSelected} disabled={!hasEditableSelection}>
            <Copy size={16} />
          </button>
          <button type="button" title="Đưa lên trên" aria-label="Đưa lên trên" onClick={onBringToFront} disabled={!hasEditableSelection}>
            <BringToFront size={16} />
          </button>
          <button type="button" title="Đưa xuống dưới" aria-label="Đưa xuống dưới" onClick={onSendToBack} disabled={!hasEditableSelection}>
            <SendToBack size={16} />
          </button>
          <button type="button" className="invoice-editor-toolbar-delete" title="Xóa (Delete)" aria-label="Xóa thành phần" onClick={onDeleteSelected} disabled={!hasEditableSelection}>
            <Trash2 size={16} />
          </button>
        </div>

        <div className="invoice-editor-toolbar-group" aria-label="Hiển thị canvas">
          <button type="button" title="Bật/tắt lưới" aria-label="Lưới" className={editor.showGrid !== false ? 'is-active' : ''} onClick={onToggleGrid}>
            <Grid3X3 size={15} />
          </button>
          <button type="button" title="Bật/tắt thước" aria-label="Thước" className={editor.showRuler !== false ? 'is-active' : ''} onClick={onToggleRuler}>
            <Ruler size={15} />
          </button>
          <button type="button" className={editor.snapEnabled !== false ? 'is-active' : ''} onClick={onToggleSnap} title="Bật/tắt snap grid">
            Snap {editor.snapGridMm || 1}mm
          </button>
        </div>

        <div className="invoice-editor-toolbar-group" aria-label="Thu phóng">
          <button type="button" onClick={onFitZoom} title="Vừa trang">
            <Maximize2 size={15} />
          </button>
          <button type="button" title="Thu nhỏ" aria-label="Thu nhỏ" onClick={() => onZoomChange?.(Math.max(0.25, zoom - 0.1))}>
            <ZoomOut size={15} />
          </button>
          <span className="invoice-editor-zoom-pill">{Math.round(zoom * 100)}%</span>
          <button type="button" title="Phóng to" aria-label="Phóng to" onClick={() => onZoomChange?.(Math.min(2.5, zoom + 0.1))}>
            <ZoomIn size={15} />
          </button>
        </div>

        <div className="invoice-editor-toolbar-group" aria-label="Logo và dữ liệu">
          <label className={`invoice-editor-toolbar-upload ${!canManage || !template?.id || busy === 'logo' ? 'is-disabled' : ''}`} title="Tải logo">
            <Upload size={15} /> Logo
            <input type="file" accept="image/*" onChange={onLogoChange} disabled={!canManage || !template?.id || busy === 'logo'} />
          </label>
          <button type="button" onClick={onRemoveLogo} disabled={!canManage || !template?.id || busy === 'logo'} title="Xóa logo">
            <Trash2 size={15} />
          </button>
          <button type="button" onClick={onReload} disabled={busy === 'reload'} title="Tải lại từ server">
            <RefreshCcw size={15} className={busy === 'reload' ? 'animate-spin' : ''} />
          </button>
        </div>

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
