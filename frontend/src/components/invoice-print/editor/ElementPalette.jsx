import { ELEMENT_DEFINITIONS } from './templateSchemaAdapter';

function groupDefinitions() {
  return ELEMENT_DEFINITIONS.reduce((groups, item) => {
    if (item.type === 'rectangle') {
      groups[item.group] = groups[item.group] || [];
      groups[item.group].push(item);
      return groups;
    }
    groups[item.group] = groups[item.group] || [];
    groups[item.group].push(item);
    return groups;
  }, {});
}

export default function ElementPalette({ onAddElement }) {
  const groups = groupDefinitions();

  return (
    <aside className="invoice-editor-panel invoice-editor-palette">
      <div className="invoice-editor-panel-title">Thành phần</div>
      <p className="invoice-editor-panel-help">Kéo vào trang A5 hoặc bấm để thêm nhanh. Logo chỉ bind asset template.logo.</p>
      <div className="invoice-editor-palette-groups">
        {Object.entries(groups).map(([group, items]) => (
          <section key={group}>
            <h4>{group}</h4>
            <div className="invoice-editor-palette-grid">
              {items.map(item => (
                <button
                  key={item.type}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-kha-invoice-element', item.type);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onAddElement?.(item.type)}
                  className="invoice-editor-palette-item"
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}
