export const ORDER_VISIBLE_COLUMNS_STORAGE_KEY = 'order_edit_visible_columns';
export const ORDER_APPLY_COLUMNS_TO_PRINT_STORAGE_KEY = 'order_edit_apply_columns_to_print';

export const defaultOrderColumns = {
  stt: true,
  productName: true,
  unit: true,
  quantity: true,
  unitPrice: true,
  discount: true,
  lineTotal: true,
};

export const orderColumnOptions = [
  { key: 'stt', label: 'Hiện STT' },
  { key: 'productName', label: 'Hiện Tên sản phẩm' },
  { key: 'unit', label: 'Hiện Đơn vị' },
  { key: 'quantity', label: 'Hiện Số lượng' },
  { key: 'unitPrice', label: 'Hiện Đơn giá' },
  { key: 'discount', label: 'Hiện Chiết khấu' },
  { key: 'lineTotal', label: 'Hiện Thành tiền' },
];

export const compactOrderColumns = {
  ...defaultOrderColumns,
  stt: false,
  unit: false,
  discount: false,
};

export function normalizeOrderColumnSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...defaultOrderColumns };
  return Object.keys(defaultOrderColumns).reduce((columns, key) => {
    columns[key] = Object.prototype.hasOwnProperty.call(value, key) ? value[key] !== false : defaultOrderColumns[key];
    return columns;
  }, {});
}

export function loadOrderColumnSettings() {
  if (typeof window === 'undefined') return { ...defaultOrderColumns };
  try {
    const saved = window.localStorage.getItem(ORDER_VISIBLE_COLUMNS_STORAGE_KEY);
    if (!saved) return { ...defaultOrderColumns };
    return normalizeOrderColumnSettings(JSON.parse(saved));
  } catch (_error) {
    return { ...defaultOrderColumns };
  }
}

export function saveOrderColumnSettings(columns) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ORDER_VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(normalizeOrderColumnSettings(columns)));
  } catch (_error) {
    // Bỏ qua nếu trình duyệt không cho ghi localStorage.
  }
}

export function loadApplyOrderColumnsToPrint() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(ORDER_APPLY_COLUMNS_TO_PRINT_STORAGE_KEY) === '1';
  } catch (_error) {
    return false;
  }
}

export function saveApplyOrderColumnsToPrint(value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ORDER_APPLY_COLUMNS_TO_PRINT_STORAGE_KEY, value ? '1' : '0');
  } catch (_error) {
    // Bỏ qua nếu trình duyệt không cho ghi localStorage.
  }
}

export function countVisibleOrderColumns(columns) {
  const normalized = normalizeOrderColumnSettings(columns);
  return Object.values(normalized).filter(Boolean).length;
}
