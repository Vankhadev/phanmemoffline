import { BringToFront, Copy, Eye, EyeOff, Lock, SendToBack, Trash2, Unlock } from 'lucide-react';
import { getElementLabel, TABLE_STYLE_ELEMENT_ID } from './templateSchemaAdapter';

export default function LayerPanel({
  document,
  selectedId,
  onSelect,
  onUpdateElement,
  onRemoveElement,
  onDuplicateElement,
  onBringToFront,
  onSendToBack,
}) {
  const layers = [
    { id: 'itemsTable', type: 'itemsTable', visible: true, locked: false, zIndex: 0, label: 'Khung sản phẩm / bảng hàng hóa' },
    ...[...(document.elements || [])]
      .filter(element => element.id !== TABLE_STYLE_ELEMENT_ID && element.type !== 'paymentQr')
      .sort((a, b) => (Number(b.zIndex) || 0) - (Number(a.zIndex) || 0))
      .map(element => ({ ...element, label: getElementLabel(element) })),
  ];

  return (
    <aside className="invoice-editor-panel invoice-editor-layers">
      <div className="invoice-editor-panel-heading">
        <div>
          <div className="invoice-editor-panel-title">Layers</div>
          <p className="invoice-editor-panel-help">{layers.length} thành phần trên trang</p>
        </div>
      </div>
      <div className="invoice-editor-layer-list">
        {layers.map(layer => {
          const isTable = layer.type === 'itemsTable';
          return (
            <div key={layer.id} data-editor-layer-id={layer.id} className={`invoice-editor-layer-row ${selectedId === layer.id ? 'is-active' : ''}`}>
              <button type="button" className="invoice-editor-layer-main" onClick={() => onSelect?.(layer.id)}>
                <span>{layer.label}</span>
                <small>{isTable ? 'structured' : layer.type}</small>
              </button>
              {!isTable && (
                <div className="invoice-editor-layer-actions">
                  <button type="button" title={layer.visible === false ? 'Hiện' : 'Ẩn'} onClick={() => onUpdateElement?.(layer.id, { visible: layer.visible === false })}>
                    {layer.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <button type="button" title={layer.locked ? 'Mở khóa' : 'Khóa'} onClick={() => onUpdateElement?.(layer.id, { locked: !layer.locked })}>
                    {layer.locked ? <Lock size={13} /> : <Unlock size={13} />}
                  </button>
                  <button type="button" title="Nhân bản" onClick={() => onDuplicateElement?.(layer.id)}>
                    <Copy size={13} />
                  </button>
                  <button type="button" title="Đưa lên trên" onClick={() => onBringToFront?.(layer.id)}>
                    <BringToFront size={13} />
                  </button>
                  <button type="button" title="Đưa xuống dưới" onClick={() => onSendToBack?.(layer.id)}>
                    <SendToBack size={13} />
                  </button>
                  <button type="button" title="Xóa" onClick={() => onRemoveElement?.(layer.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
