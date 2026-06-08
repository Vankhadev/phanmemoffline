import {
  BadgeDollarSign,
  Building2,
  FileText,
  GripVertical,
  Image,
  Minus,
  NotebookText,
  PenLine,
  ReceiptText,
  Square,
  Type,
  UserRound,
} from 'lucide-react';
import { ELEMENT_DEFINITIONS } from './templateSchemaAdapter';

const ELEMENT_ICONS = Object.freeze({
  logo: Image,
  storeInfo: Building2,
  invoiceTitle: ReceiptText,
  customerInfo: UserRound,
  invoiceMeta: FileText,
  totals: BadgeDollarSign,
  note: NotebookText,
  footerText: Type,
  signatures: PenLine,
  customText: Type,
  image: Image,
  line: Minus,
  rectangle: Square,
});

function groupDefinitions() {
  return ELEMENT_DEFINITIONS.reduce((groups, item) => {
    groups[item.group] = groups[item.group] || [];
    groups[item.group].push(item);
    return groups;
  }, {});
}

export default function ElementPalette({ onAddElement }) {
  const groups = groupDefinitions();

  return (
    <aside className="invoice-editor-panel invoice-editor-palette">
      <div className="invoice-editor-panel-heading">
        <div>
          <div className="invoice-editor-panel-title">Thành phần</div>
          <p className="invoice-editor-panel-help">Kéo vào trang hoặc bấm để thêm nhanh.</p>
        </div>
      </div>
      <div className="invoice-editor-palette-groups">
        {Object.entries(groups).map(([group, items]) => (
          <section key={group}>
            <h4>{group}</h4>
            <div className="invoice-editor-palette-grid">
              {items.map(item => {
                const Icon = ELEMENT_ICONS[item.type] || Type;
                return (
                  <button
                    key={item.type}
                    type="button"
                    draggable
                    data-editor-element-type={item.type}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('application/x-kha-invoice-element', item.type);
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => onAddElement?.(item.type)}
                    className="invoice-editor-palette-item"
                    title={`Thêm ${item.label}`}
                  >
                    <span className="invoice-editor-palette-icon"><Icon size={16} /></span>
                    <span className="invoice-editor-palette-label">{item.label}</span>
                    <GripVertical size={14} className="invoice-editor-palette-grip" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}
