import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import {
  compactOrderColumns,
  defaultOrderColumns,
  normalizeOrderColumnSettings,
  orderColumnOptions,
} from '../utils/orderColumnSettings';

export default function OrderColumnCustomizer({ visibleColumns, onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const columns = normalizeOrderColumnSettings(visibleColumns);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const applyColumns = (nextColumns) => onChange?.(normalizeOrderColumnSettings(nextColumns));

  return (
    <div ref={rootRef} className={`relative inline-flex ${className}`.trim()}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
      >
        <Settings size={14} /> Tùy chỉnh cột
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-72 rounded-xl border border-gray-200 bg-white p-3 text-sm shadow-xl">
          <div className="mb-2 font-bold text-gray-800">Cột hiển thị</div>
          <div className="space-y-2">
            {orderColumnOptions.map(option => (
              <label key={option.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={columns[option.key]}
                  onChange={event => applyColumns({ ...columns, [option.key]: event.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                />
                <span className="text-gray-700">{option.label}</span>
              </label>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 border-t border-gray-100 pt-3 sm:grid-cols-3">
            <button type="button" onClick={() => applyColumns(defaultOrderColumns)} className="rounded-lg bg-blue-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Bật tất cả</button>
            <button type="button" onClick={() => applyColumns(compactOrderColumns)} className="rounded-lg bg-gray-100 px-2 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-200">Tắt cột không cần</button>
            <button type="button" onClick={() => applyColumns(defaultOrderColumns)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">Khôi phục mặc định</button>
          </div>
        </div>
      )}
    </div>
  );
}
