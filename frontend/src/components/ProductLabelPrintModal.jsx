import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Printer, X } from 'lucide-react';
import {
  DEFAULT_PRODUCT_LABEL_CONTENT,
  PRODUCT_LABEL_PAPERS,
  PRODUCT_LABEL_SIZES,
  normalizeProductLabelItems,
  printProductLabels,
} from '../utils/productLabelPrint';
import { isSilentPrintSupported } from '../utils/desktopPrint';
import { formatCurrency } from '../utils/invoiceTemplateRenderer';

function buildRowKey(item, index) {
  return String(item.id || item.variant_id || item.product_id || item.sku || item.name || index) + `-${index}`;
}

function toPositiveInteger(value, fallback = 1) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function getStoreName(store) {
  return store?.name || store?.store_name || store?.shop_name || store?.business_name || 'Cửa hàng';
}

export default function ProductLabelPrintModal({
  open,
  items = [],
  store = null,
  title = 'In tem sản phẩm',
  onClose,
  onSkip,
  onPrinted,
}) {
  const [rows, setRows] = useState([]);
  const [labelSize, setLabelSize] = useState(PRODUCT_LABEL_SIZES[0]?.value || '72x22');
  const [paperType, setPaperType] = useState(PRODUCT_LABEL_PAPERS[0]?.value || 'ROLL');
  const [content, setContent] = useState(DEFAULT_PRODUCT_LABEL_CONTENT);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const normalized = normalizeProductLabelItems(items, { defaultQuantity: 1 });
    setRows(normalized.map((item, index) => ({
      ...item,
      rowKey: buildRowKey(item, index),
      selected: Boolean(item.sku),
      quantity: toPositiveInteger(item.quantity, 1),
    })));
    setContent({ ...DEFAULT_PRODUCT_LABEL_CONTENT });
    setError('');
    setNotice('');
    setPrinting(false);
  }, [items, open]);

  const selectedRows = useMemo(() => rows.filter(row => row.selected), [rows]);
  const selectedLabelCount = useMemo(
    () => selectedRows.reduce((sum, row) => sum + toPositiveInteger(row.quantity, 1), 0),
    [selectedRows]
  );
  const hasAnyRow = rows.length > 0;
  const allSelected = hasAnyRow && rows.every(row => row.selected);
  const storeName = getStoreName(store);
  const silentPrintEnabled = isSilentPrintSupported();

  if (!open) return null;

  const updateRow = (rowKey, patch) => {
    setRows(prev => prev.map(row => row.rowKey === rowKey ? { ...row, ...patch } : row));
    setError('');
    setNotice('');
  };

  const toggleAll = () => {
    const nextSelected = !allSelected;
    setRows(prev => prev.map(row => ({ ...row, selected: nextSelected })));
    setError('');
    setNotice('');
  };

  const handleContentToggle = (key) => {
    setContent(prev => ({ ...prev, [key]: !prev[key] }));
    setError('');
    setNotice('');
  };

  const handleSkip = () => {
    setError('');
    setNotice('');
    onSkip?.();
    onClose?.();
  };

  const handleCancel = () => {
    setError('');
    setNotice('');
    onClose?.();
  };

  const validateBeforePrint = () => {
    if (selectedRows.length === 0) return 'Vui lòng chọn ít nhất một sản phẩm để in tem.';
    const invalidQuantity = selectedRows.find(row => toPositiveInteger(row.quantity, 0) <= 0);
    if (invalidQuantity) return `Số lượng tem của "${invalidQuantity.name || invalidQuantity.sku || 'sản phẩm'}" phải lớn hơn 0.`;
    const missingSku = selectedRows.find(row => !String(row.sku || '').trim());
    if (missingSku) return `Sản phẩm "${missingSku.name || 'chưa đặt tên'}" chưa có SKU/mã vạch. Vui lòng bỏ chọn hoặc bổ sung SKU trước khi in.`;
    return '';
  };

  const handlePrint = async () => {
    const validationError = validateBeforePrint();
    if (validationError) {
      setError(validationError);
      setNotice('');
      return;
    }

    setPrinting(true);
    setError('');
    setNotice('');

    try {
      const rendered = await printProductLabels(selectedRows.map(row => ({
        ...row,
        labelQuantity: toPositiveInteger(row.quantity, 1),
        quantity: toPositiveInteger(row.quantity, 1),
      })), {
        labelSize,
        paperType,
        content,
        store,
        storeName,
        title,
      });
      setNotice(rendered.silent
        ? `Đã gửi lệnh in trực tiếp ${rendered.labelCount} tem sản phẩm tới máy in mặc định.`
        : `Đã mở hộp thoại in ${rendered.labelCount} tem sản phẩm.`);
      onPrinted?.(rendered);
      onClose?.();
    } catch (err) {
      setError(err.message || 'Không thể in tem sản phẩm. Vui lòng thử lại.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b bg-blue-50 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-blue-900 flex items-center gap-2">
              <Printer size={20} /> {title || 'In tem sản phẩm'}
            </h2>
            <p className="text-xs text-blue-600 mt-1">
              {silentPrintEnabled
                ? `Chọn sản phẩm, số lượng tem, khổ in và loại giấy rồi bấm In tem để gửi lệnh in trực tiếp. Cửa hàng: ${storeName}`
                : `Chọn sản phẩm, số lượng tem, khổ in và loại giấy. Cửa hàng: ${storeName}`}
            </p>
          </div>
          <button type="button" onClick={handleCancel} className="text-gray-400 hover:text-gray-700 p-1 rounded-lg hover:bg-white/70" title="Đóng">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {(error || notice) && (
            <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
              {error ? <AlertCircle size={18} className="shrink-0 mt-0.5" /> : <CheckCircle size={18} className="shrink-0 mt-0.5" />}
              <div className="text-sm whitespace-pre-line">{error || notice}</div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-gray-800">Danh sách sản phẩm</h3>
                  <p className="text-xs text-gray-500">Đã chọn {selectedRows.length}/{rows.length} dòng · {selectedLabelCount} tem</p>
                </div>
                <button type="button" onClick={toggleAll} disabled={!hasAnyRow} className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-white disabled:opacity-50">
                  {allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                </button>
              </div>

              <div className="max-h-[48vh] overflow-auto divide-y divide-gray-100">
                {rows.length === 0 && (
                  <div className="p-8 text-center text-sm text-gray-400 border-2 border-dashed m-4 rounded-xl">
                    Chưa có sản phẩm nào để in tem.
                  </div>
                )}

                {rows.map(row => {
                  const missingSku = !String(row.sku || '').trim();
                  return (
                    <div key={row.rowKey} className={`p-3 flex items-center gap-3 ${row.selected ? 'bg-white' : 'bg-gray-50/70'}`}>
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={e => updateRow(row.rowKey, { selected: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        title="Chọn in tem"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-gray-900 truncate">{row.name || 'Sản phẩm chưa đặt tên'}</div>
                        <div className={`text-xs mt-0.5 ${missingSku ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                          SKU/barcode: {row.sku || 'Chưa có SKU'} · Giá: {formatCurrency(row.price)}
                        </div>
                      </div>
                      <div className="w-28">
                        <label className="text-[11px] text-gray-500 block mb-1 text-center">Số tem</label>
                        <input
                          type="number"
                          min="1"
                          value={row.quantity}
                          onChange={e => updateRow(row.rowKey, { quantity: toPositiveInteger(e.target.value, 1) })}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              <div className="border rounded-xl p-4 bg-white">
                <h3 className="text-sm font-bold text-gray-800 mb-3">Khổ tem</h3>
                <div className="space-y-2">
                  {PRODUCT_LABEL_SIZES.map(size => (
                    <label key={size.value} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer text-sm ${labelSize === size.value ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <input type="radio" name="product-label-size" value={size.value} checked={labelSize === size.value} onChange={() => setLabelSize(size.value)} />
                      <span>{size.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="border rounded-xl p-4 bg-white">
                <h3 className="text-sm font-bold text-gray-800 mb-3">Giấy in</h3>
                <select value={paperType} onChange={e => setPaperType(e.target.value)} className="input-field w-full text-sm">
                  {PRODUCT_LABEL_PAPERS.map(paper => (
                    <option key={paper.value} value={paper.value}>{paper.label}</option>
                  ))}
                </select>
                <p className="mt-2 text-[11px] text-gray-500">
                  Giấy cuộn sẽ in từng tem theo khổ đã chọn. Tomy A4/A5 sẽ dàn tem theo lưới giấy.
                </p>
              </div>

              <div className="border rounded-xl p-4 bg-white">
                <h3 className="text-sm font-bold text-gray-800 mb-3">Nội dung tem</h3>
                <div className="space-y-2 text-sm text-gray-700">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={content.showProductName} onChange={() => handleContentToggle('showProductName')} />
                    Tên sản phẩm
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={content.showBarcode} onChange={() => handleContentToggle('showBarcode')} />
                    Mã barcode/SKU
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={content.showPrice} onChange={() => handleContentToggle('showPrice')} />
                    Giá bán
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={content.showStoreName} onChange={() => handleContentToggle('showStoreName')} />
                    Tên cửa hàng
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t bg-gray-50 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <div className="text-xs text-gray-500">
            {silentPrintEnabled
              ? 'Trong ứng dụng Electron desktop, lệnh in sẽ được gửi trực tiếp tới máy in mặc định mà không hiện popup xác nhận.'
              : 'In thành công được hiểu là trình duyệt đã mở hộp thoại in. Việc máy in nhận lệnh phụ thuộc thiết bị/hệ điều hành.'}
          </div>
          <div className="flex gap-2 justify-end shrink-0">
            <button type="button" onClick={handleSkip} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-white text-sm font-medium">
              Không in tem
            </button>
            <button type="button" onClick={handleCancel} className="px-4 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium">
              Hủy
            </button>
            <button type="button" onClick={handlePrint} disabled={printing || !hasAnyRow} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-bold flex items-center gap-2">
              <Printer size={16} /> {printing ? 'Đang in...' : 'In tem'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
