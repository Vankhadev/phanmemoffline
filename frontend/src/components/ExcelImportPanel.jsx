import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, CheckCircle, Download, Eye, FileSpreadsheet, Loader2, PackageCheck, RefreshCw, UploadCloud } from 'lucide-react';
import { excelImportApi, getApiErrorMessage } from '../utils/apiClient';

import { getNegativeStockLimitLabel } from '../utils/negativeStock';
import useNegativeStockSettings from '../utils/useNegativeStockSettings';

const IMPORT_FIELDS = {
  products: [
    { key: 'row_type', label: 'Loại dòng' },
    { key: 'sku', label: 'SKU / M? sản phẩm', required: true },
    { key: 'parent_sku', label: 'Parent SKU' },
    { key: 'name', label: 'Tên sản phẩm / biến thể', required: true },
    { key: 'barcode', label: 'M? v?ch' },
    { key: 'category', label: 'Danh mục text' },
    { key: 'default_category_id', label: 'Default category id' },
    { key: 'supplier_id', label: 'Supplier id' },
    { key: 'import_price', label: 'Giá nhập' },
    { key: 'wholesale_price', label: 'Giá sỉ' },
    { key: 'retail_price', label: 'Giá lẻ' },
    { key: 'vip_price', label: 'Giá VIP' },
    { key: 'stock', label: 'Tồn kho' },
    { key: 'unit', label: 'Đơn vị' },
    { key: 'option1', label: 'Thuộc tính 1' },
    { key: 'option2', label: 'Thuộc tính 2' },
    { key: 'option3', label: 'Thuộc tính 3' },
    { key: 'description', label: 'Mô tả' },
    { key: 'image_url', label: 'Ảnh / Image URL' },
    { key: 'active', label: 'Trạng thái' },
  ],
  invoices: [
    { key: 'invoice_code', label: 'M? don/hóa đơn', required: true },
    { key: 'customer_code', label: 'M? khách hàng' },
    { key: 'customer_name', label: 'Tên khách hàng' },
    { key: 'customer_phone', label: 'SĐT khách' },
    { key: 'customer_email', label: 'Email khách' },
    { key: 'customer_type', label: 'Nhóm/loại khách' },
    { key: 'product_sku', label: 'SKU sản phẩm/biến thể', required: true },
    { key: 'product_name', label: 'Tên sản phẩm' },
    { key: 'quantity', label: 'Số lượng', required: true },
    { key: 'unit_price', label: 'Đơn giá' },
    { key: 'discount_amount', label: 'Giảm giá dòng' },
    { key: 'discount_percent', label: '% giảm giá' },
    { key: 'line_total', label: 'Thành tiền dòng' },
    { key: 'total', label: 'Tổng tiền đơn' },
    { key: 'paid_amount', label: 'D? thanh toán' },
    { key: 'payment_status', label: 'Trạng thái thanh toán' },
    { key: 'payment_method', label: 'Phương thức thanh toán' },
    { key: 'status', label: 'Trạng thái đơn' },
    { key: 'created_at', label: 'Thời gian tạo' },
    { key: 'note', label: 'Ghi chú' },
  ],
};

const IMPORT_ALIASES = {
  products: {
    row_type: ['loai dong', 'row_type', 'type', 'loại dòng', 'loại'],
    sku: ['sku', 'ma sku', 'ma san pham', 'ma bien the', 'product code', 'variant code', 'm? sku', 'm? sản phẩm', 'm? biến thể'],
    parent_sku: ['parent sku', 'parent_sku', 'sku cha', 'ma sku cha', 'ma cha', 'sku parent', 'm? sku cha', 'm? cha'],
    name: ['name', 'ten san pham', 'ten bien the', 'ten hang', 'product name', 'variant name', 'tên sản phẩm', 'tên biến thể', 'tên hàng'],
    barcode: ['barcode', 'ma vach', 'm? v?ch'],
    category: ['category', 'danh muc', 'danh muc text', 'nhom hang', 'danh mục', 'nhóm hàng'],
    default_category_id: ['default category id', 'default_category_id', 'id danh muc mac dinh', 'id danh mục mặc định'],
    supplier_id: ['supplier id', 'supplier_id', 'nha cung cap id', 'ncc id', 'nhà cung cấp id'],
    import_price: ['import_price', 'gia nhap', 'gia von', 'cost', 'cost price', 'giá nhập', 'giá vốn'],
    wholesale_price: ['wholesale_price', 'gia si', 'gia buon', 'wholesale price', 'giá sỉ', 'giá buôn'],
    retail_price: ['retail_price', 'gia le', 'gia ban', 'don gia', 'price', 'giá lẻ', 'giá bán', 'đơn giá'],
    vip_price: ['vip_price', 'gia vip', 'vip price', 'giá vip'],
    stock: ['stock', 'ton kho', 'so luong ton', 'so luong', 'quantity', 'qty', 'tồn kho', 'số lượng tồn', 'số lượng'],
    unit: ['unit', 'don vi', 'dvt', 'đơn vị', 'đvt'],
    option1: ['option1', 'option 1', 'thuoc tinh 1', 'mau', 'color', 'thuộc tính 1', 'màu'],
    option2: ['option2', 'option 2', 'thuoc tinh 2', 'size', 'kich co', 'thuộc tính 2', 'kích cỡ'],
    option3: ['option3', 'option 3', 'thuoc tinh 3', 'chat lieu', 'thuộc tính 3', 'chất liệu'],
    description: ['description', 'mo ta', 'mô tả'],
    image_url: ['image url', 'image_url', 'anh', 'ảnh', 'hinh anh', 'hình ảnh'],
    active: ['active', 'hoat dong', 'trang thai', 'status', 'dang ban', 'hoạt động', 'trạng thái', 'đang bán'],
  },
  invoices: {
    invoice_code: ['invoice_code', 'order_code', 'ma don hang', 'ma hoa don', 'code', 'order code', 'm? đơn hàng', 'm? hóa đơn'],
    customer_code: ['customer_code', 'ma khach hang', 'ma kh', 'm? khách hàng', 'm? kh'],
    customer_name: ['customer_name', 'ten khach hang', 'khach hang', 'customer', 'tên khách hàng', 'khách hàng'],
    customer_phone: ['customer_phone', 'sdt', 'so dien thoai', 'phone', 'sđt', 'số điện thoại'],
    customer_email: ['customer_email', 'email khach hang', 'email khách hàng', 'email'],
    customer_type: ['customer_type', 'loai khach', 'nhom khach', 'group', 'type', 'loại khách', 'nhóm khách'],
    product_sku: ['product_sku', 'sku', 'ma san pham', 'ma hang', 'variant sku', 'm? sản phẩm', 'm? h?ng'],
    product_name: ['product_name', 'ten san pham', 'san pham', 'item name', 'tên sản phẩm', 'sản phẩm'],
    quantity: ['quantity', 'qty', 'so luong', 'sl', 'số lượng'],
    unit_price: ['unit_price', 'don gia', 'gia ban', 'price', 'đơn giá', 'giá bán'],
    discount_amount: ['discount_amount', 'giam gia dong', 'chiet khau dong', 'giảm giá dòng', 'chiết khấu dòng'],
    discount_percent: ['discount_percent', 'giam gia %', 'chiet khau %', '% giảm giá', '% chiết khấu'],
    line_total: ['line_total', 'thanh tien dong', 'tong dong', 'line total', 'thành tiền dòng', 'tổng dòng'],
    total: ['total', 'tong tien', 'tong don', 'tổng tiền', 'tổng đơn'],
    paid_amount: ['paid_amount', 'da thanh toan', 'paid', 'd? thanh toán'],
    payment_status: ['payment_status', 'trang thai thanh toan', 'payment status', 'trạng thái thanh toán'],
    payment_method: ['payment_method', 'phuong thuc thanh toan', 'payment method', 'phương thức thanh toán'],
    status: ['status', 'trang thai don', 'trang thai', 'trạng thái đơn', 'trạng thái'],
    created_at: ['created_at', 'thoi gian tao', 'ngay tao', 'ngay ban', 'created at', 'thời gian tạo', 'ngày tạo', 'ngày bán'],
    note: ['note', 'ghi chu', 'ghi chú'],
  },
};

const TEMPLATE_ROWS = {
  products: [
    {
      'Loại dòng': 'PARENT',
      'SKU': 'SP00001',
      'Parent SKU': '',
      'Tên sản phẩm': 'Áo thun cotton',
      'M? v?ch': '',
      'Danh mục text': 'Áo thun',
      'Default category id': '',
      'Supplier id': '',
      'Giá nhập': 80000,
      'Giá sỉ': 110000,
      'Giá lẻ': 150000,
      'Giá VIP': 130000,
      'Tồn kho': -5,
      'Đơn vị': 'cái',
      'Thuộc tính 1': '',
      'Thuộc tính 2': '',
      'Thuộc tính 3': '',
      'Mô tả': 'Sản phẩm cha, Parent SKU để trống; ví dụ tồn âm trong ngưỡng cho phép',
      'Ảnh': '',
      'Trạng thái': 'Có',
    },
    {
      'Loại dòng': 'VARIANT',
      'SKU': 'SP00002',
      'Parent SKU': 'SP00001',
      'Tên sản phẩm': 'Màu đỏ / Size S',
      'M? v?ch': '',
      'Danh mục text': 'Áo thun',
      'Default category id': '',
      'Supplier id': '',
      'Giá nhập': 80000,
      'Giá sỉ': 110000,
      'Giá lẻ': 150000,
      'Giá VIP': 130000,
      'Tồn kho': 12,
      'Đơn vị': 'cái',
      'Thuộc tính 1': 'Đỏ',
      'Thuộc tính 2': 'S',
      'Thuộc tính 3': '',
      'Mô tả': 'Biến thể phải có Parent SKU khớp sản phẩm cha',
      'Ảnh': '',
      'Trạng thái': 'Có',
    },
  ],
  invoices: [
    {
      'M? đơn hàng': 'HDIMPORT001',
      'M? khách hàng': 'KHLE001',
      'Tên khách hàng': 'Khách lẻ',
      'SĐT khách': '',
      'Email khách': '',
      'Nhóm khách': 'Khách lẻ',
      'SKU': 'SP00002',
      'Tên sản phẩm': 'Áo thun cotton - Màu đỏ / Size S',
      'Số lượng': 2,
      'Đơn giá': 150000,
      'Giảm giá dòng': 0,
      '% giảm giá': 0,
      'Thành tiền dòng': 300000,
      'Tổng tiền': 300000,
      'D? thanh toán': 300000,
      'Trạng thái thanh toán': 'paid',
      'Phương thức thanh toán': 'cash',
      'Trạng thái đơn': 'completed',
      'Thời gian tạo': '2026-05-10 09:00:00',
      'Ghi ch?': 'Một don c? th? c? nhi?u d?ng c?ng m? đơn hàng',
    },
    {
      'M? đơn hàng': 'HDIMPORT002',
      'M? khách hàng': 'KHSI001',
      'Tên khách hàng': 'Khách sỉ',
      'SĐT khách': '',
      'Email khách': '',
      'Nhóm khách': 'Khách sỉ',
      'SKU': 'SP00002',
      'Tên sản phẩm': 'Áo thun cotton - Màu đỏ / Size S',
      'Số lượng': 1,
      'Đơn giá': 110000,
      'Giảm giá dòng': 0,
      '% giảm giá': 0,
      'Thành tiền dòng': 110000,
      'Tổng tiền': 110000,
      'D? thanh toán': 0,
      'Trạng thái thanh toán': 'unpaid',
      'Phương thức thanh toán': 'debt',
      'Trạng thái đơn': 'pending',
      'Thời gian tạo': '2026-05-10 10:00:00',
      'Ghi ch?': 'M? kh?ch ph?i t?n t?i v? kh?p nh?m kh?ch',
    },
  ],
};

function buildGuideRows(dataType, negativeStockLimitLabel = '0') {
  const guideRows = {
    products: [
      ['Cột', 'Bắt buộc', 'Ghi chú'],
      ['Loại dòng', 'Khuyến nghị', 'PARENT cho sản phẩm cha, VARIANT cho biến thể; có Parent SKU thì backend suy luận là VARIANT.'],
      ['SKU', 'C?', 'SKU/m? sản phẩm ho?c SKU biến thể, không được tr?ng sai loại.'],
      ['Parent SKU', 'C? v?i VARIANT', 'Phải kh?p SKU sản phẩm cha trong file ho?c d? c? trong hệ thống.'],
      ['Tên sản phẩm', 'Có với bản ghi mới', 'Tên sản phẩm cha hoặc tên biến thể.'],
      ['Giá/Tồn kho', 'Không', `Giá nhập số không âm; tồn kho có thể âm đến ${negativeStockLimitLabel} (ví dụ -5, -20) và phải là số nguyên; thấp hơn ngưỡng sẽ bị backend chặn.`],
      ['Danh mục text / Default category id', 'Không', 'Khớp danh mục hiện có theo tên/từ khóa hoặc id.'],
      ['Supplier id', 'Không', 'Nếu nhập thì id nhà cung cấp phải tồn tại.'],
    ],
    invoices: [
      ['Cột', 'Bắt buộc', 'Ghi chú'],
      ['M? đơn hàng', 'C?', 'Các d?ng c?ng m? don sẽ được gom th?nh một don nhi?u sản phẩm.'],
      ['M? khách hàng / Tồn / SDT / Email / Nh?m kh?ch', 'N?n c? m? khách hàng', 'Khách ph?i t?n t?i; n?u c? nh?m kh?ch th? ph?i kh?p loại kh?ch d? tr?nh import nh?m kh?ch l?/kh?ch s?.'],
      ['SKU hoặc Tên sản phẩm', 'Có', 'Sản phẩm/biến thể phải tồn tại trong hệ thống.'],
      ['Số lượng', 'Có', `Số lượng bán phải lớn hơn 0; có thể bán khi tồn hiện tại 0/âm nếu tồn dự kiến không nhỏ hơn ${negativeStockLimitLabel}. Backend sẽ chặn nếu vượt ngưỡng.`],
      ['Đơn giá / Giảm giá / Thành tiền', 'Không', 'Nếu tổng tiền file khác tổng chi tiết, hệ thống ưu tiên tính lại từ chi tiết.'],
      ['Trạng thái thanh toán / Phương thức / Trạng thái đơn', 'Không', 'Hỗ trợ paid/unpaid/partial, cash/bank/debt, pending/completed/cancelled.'],
    ],
  };
  return guideRows[dataType] || [];
}

const ACTION_META = {
  create: 'bg-green-100 text-green-700 border-green-200',
  update: 'bg-amber-100 text-amber-700 border-amber-200',
  duplicate: 'bg-orange-100 text-orange-700 border-orange-200',
  skipped: 'bg-gray-100 text-gray-600 border-gray-200',
  error: 'bg-red-100 text-red-700 border-red-200',
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeColumn(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
}

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value) || 0);
}

function getAction(item) {
  return String(item?.action || item?.status || '').trim() || 'skipped';
}

function actionLabel(action) {
  if (action === 'create') return 'Tạo mới';
  if (action === 'update') return 'Cập nhật';
  if (action === 'duplicate') return 'Trùng';
  if (action === 'error') return 'Lỗi';
  if (action === 'skipped') return 'Bỏ qua';
  return action || '—';
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasExcelValue(value) {
  return !(value === undefined || value === null || String(value).trim() === '');
}

function isMetadataColumn(key) {
  return ['__line', '_line', 'line', 'rowNumber', '__rowNum__'].includes(String(key));
}

function autoMapColumns(columns = [], dataType = 'products') {
  const mapping = {};
  const fields = IMPORT_FIELDS[dataType] || IMPORT_FIELDS.products;
  const aliasesByField = IMPORT_ALIASES[dataType] || IMPORT_ALIASES.products;
  fields.forEach(field => {
    const aliases = aliasesByField[field.key] || [];
    const normalizedAliases = aliases.map(normalizeColumn);
    const direct = columns.find(column => normalizedAliases.includes(normalizeColumn(column)));
    if (direct) mapping[field.key] = direct;
  });
  return mapping;
}

function parseWorksheetRows(workbook, sheetName) {
  const worksheet = workbook?.Sheets?.[sheetName];
  if (!worksheet || !worksheet['!ref']) return { rows: [], columns: [] };
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false, blankrows: false });
  const normalizedRows = rows.map((row, index) => ({ ...row, __line: Number(row?.__rowNum__) >= 0 ? Number(row.__rowNum__) + 1 : index + 2 }))
    .filter(row => Object.entries(row).some(([key, value]) => !isMetadataColumn(key) && hasExcelValue(value)));
  const columns = [];
  const seen = new Set();
  normalizedRows.forEach(row => {
    Object.keys(row || {}).forEach(column => {
      if (isMetadataColumn(column) || seen.has(column)) return;
      seen.add(column);
      columns.push(column);
    });
  });
  return { rows: normalizedRows, columns };
}

function buildWorkbook(dataType, rows = TEMPLATE_ROWS[dataType] || [], columns = [], options = {}) {
  const header = columns.length > 0 ? columns : Object.keys(rows[0] || {});
  const ws = XLSX.utils.json_to_sheet(rows, { header });
  ws['!cols'] = header.map(column => ({ wch: Math.max(14, Math.min(34, String(column).length + 6)) }));
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: Math.max(header.length - 1, 0) } }),
  };
  const guide = XLSX.utils.aoa_to_sheet(buildGuideRows(dataType, options.negativeStockLimitLabel || '0'));
  guide['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 100 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, dataType === 'invoices' ? 'Hóa đơn' : 'Sản phẩm');
  XLSX.utils.book_append_sheet(wb, guide, 'Hướng dẫn');
  return wb;
}

function getTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function issueText(item) {
  return [
    ...safeArray(item?.errors).map(error => `${error?.field ? `${error.field}: ` : ''}${error?.message || error}`),
    ...safeArray(item?.warnings).map(warning => warning?.message || warning),
  ].filter(Boolean).join('; ');
}

export default function ExcelImportPanel({
  dataType = 'products',
  title,
  description,
  onCommitted,
  onClose,
  defaultMode = 'upsert',
  negativeStockSettings: negativeStockSettingsProp,
}) {
  const [excel, setExcel] = useState({
    fileName: '',
    workbook: null,
    sheets: [],
    selectedSheet: '',
    rows: [],
    columns: [],
    mapping: {},
    previewItems: [],
    previewSummary: null,
    previewErrors: [],
    previewWarnings: [],
    commitResult: null,
    mode: defaultMode,
  });
  const [selected, setSelected] = useState([]);
  const [filter, setFilter] = useState({ query: '', action: 'all', issuesOnly: false });
  const [status, setStatus] = useState({ tone: 'info', message: '' });
  const [busyKey, setBusyKey] = useState('');
  const inputRef = useRef(null);

  const { settings: loadedNegativeStockSettings } = useNegativeStockSettings({ load: !negativeStockSettingsProp });
  const negativeStockSettings = negativeStockSettingsProp || loadedNegativeStockSettings;
  const negativeStockLimitLabel = getNegativeStockLimitLabel(negativeStockSettings);
  const fields = IMPORT_FIELDS[dataType] || IMPORT_FIELDS.products;
  const filteredItems = useMemo(() => {
    const query = normalizeText(filter.query);
    return excel.previewItems.filter(item => {
      const action = getAction(item);
      if (filter.action !== 'all' && action !== filter.action) return false;
      if (filter.issuesOnly && !['error', 'duplicate', 'skipped'].includes(action) && safeArray(item.warnings).length === 0) return false;
      if (!query) return true;
      const haystack = normalizeText([
        item.name,
        item.sku,
        item.parent_sku,
        item.invoice_code,
        item.customer_code,
        item.customer_name,
        item.customer_type,
        item.product_sku,
        item.product_name,
        item.phone,
        item.email,
        issueText(item),
      ].join(' '));
      return haystack.includes(query);
    });
  }, [excel.previewItems, filter]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every(item => selectedSet.has(`import:${item.line}:${item.rowIndex}`));

  const setError = (err, fallback) => setStatus({ tone: 'error', message: getApiErrorMessage(err?.data || err, err?.message || fallback) });

  const runAction = async (key, action) => {
    setBusyKey(key);
    try {
      return await action();
    } catch (err) {
      setError(err, 'Thao tác import thất bại.');
      return null;
    } finally {
      setBusyKey('');
    }
  };

  const handleFile = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const extension = String(file.name || '').split('.').pop()?.toLowerCase();
      if (!['xlsx', 'xls', 'csv'].includes(extension)) {
        throw new Error('Chỉ hỗ trợ file .xlsx, .xls hoặc .csv.');
      }
      const buffer = await file.arrayBuffer();
      if (!buffer || buffer.byteLength === 0) {
        throw new Error('File rỗng hoặc không đọc được dữ liệu.');
      }
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false, dense: false });
      const sheets = workbook.SheetNames || [];
      if (sheets.length === 0) {
        throw new Error('File Excel không có sheet dữ liệu hợp lệ.');
      }
      const preferredSheet = dataType === 'invoices' ? 'Hóa đơn' : 'Sản phẩm';
      const selectedSheet = sheets.includes(preferredSheet) ? preferredSheet : (sheets[0] || '');
      const parsed = parseWorksheetRows(workbook, selectedSheet);
      if (parsed.rows.length === 0) {
        throw new Error(`Sheet "${selectedSheet}" không có dòng dữ liệu hợp lệ.`);
      }
      setExcel(prev => ({
        ...prev,
        fileName: file.name,
        workbook,
        sheets,
        selectedSheet,
        rows: parsed.rows,
        columns: parsed.columns,
        mapping: autoMapColumns(parsed.columns, dataType),
        previewItems: [],
        previewSummary: null,
        previewErrors: [],
        previewWarnings: [],
        commitResult: null,
      }));
      setSelected([]);
      setStatus({ tone: 'success', message: `Đã đọc file ${file.name}: ${formatNumber(parsed.rows.length)} dòng, ${formatNumber(parsed.columns.length)} cột.` });
    } catch (err) {
      const message = err?.message || 'Không thể đọc file Excel.';
      setStatus({ tone: 'error', message: `Không thể đọc file Excel: ${message}` });
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleSheet = sheetName => {
    if (!excel.workbook) return;
    const parsed = parseWorksheetRows(excel.workbook, sheetName);
    setExcel(prev => ({
      ...prev,
      selectedSheet: sheetName,
      rows: parsed.rows,
      columns: parsed.columns,
      mapping: autoMapColumns(parsed.columns, dataType),
      previewItems: [],
      previewSummary: null,
      previewErrors: [],
      previewWarnings: [],
      commitResult: null,
    }));
    setSelected([]);
  };

  const downloadTemplate = (format = 'xlsx') => {
    const rows = TEMPLATE_ROWS[dataType] || [];
    const columns = Object.keys(rows[0] || {});
    const baseName = dataType === 'invoices' ? 'mau_import_hoa_don' : 'mau_import_san_pham';
    if (format === 'csv') {
      const ws = XLSX.utils.json_to_sheet(rows, { header: columns });
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}_${getTimestamp()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    XLSX.writeFile(buildWorkbook(dataType, rows, columns, { negativeStockLimitLabel }), `${baseName}_${getTimestamp()}.xlsx`);
  };

  const previewImport = () => runAction('preview', async () => {
    if (excel.rows.length === 0) {
      setStatus({ tone: 'error', message: 'Vui lòng chọn file Excel/CSV có dữ liệu trước khi preview.' });
      return null;
    }
    const data = await excelImportApi.preview({ rows: excel.rows, mapping: excel.mapping, dataType, mode: excel.mode, fileName: excel.fileName, sheetName: excel.selectedSheet, receivedColumns: excel.columns });
    const items = Array.isArray(data.items) ? data.items : safeArray(data.results);
    setExcel(prev => ({
      ...prev,
      previewItems: items,
      previewSummary: data.summary || null,
      previewErrors: safeArray(data.errors),
      previewWarnings: safeArray(data.warnings),
      commitResult: null,
    }));
    const selectable = items
      .filter(item => !['error', 'duplicate'].includes(getAction(item)))
      .map(item => `import:${item.line}:${item.rowIndex}`);
    setSelected(selectable);
    setStatus({ tone: data.ok === false ? 'warning' : 'success', message: `Preview hoàn tất: ${formatNumber(items.length)} dòng, ${formatNumber(safeArray(data.errors).length)} lỗi, ${formatNumber(safeArray(data.warnings).length)} cảnh báo.` });
    return data;
  });

  const commitImport = () => runAction('commit', async () => {
    if (selected.length === 0) {
      setStatus({ tone: 'error', message: 'Vui lòng chọn ít nhất một dòng hợp lệ để import.' });
      return null;
    }
    if (!window.confirm(`Import ${selected.length} d?ng đã chọn? Backend s? validate lỗi trước khi ghi dữ liệu.`)) return null;
    const selectedIds = new Set(selected);
    const selectedRows = excel.previewItems
      .filter(item => selectedIds.has(`import:${item.line}:${item.rowIndex}`))
      .map(item => excel.rows[item.rowIndex])
      .filter(Boolean);
    const data = await excelImportApi.commit({ rows: selectedRows, mapping: excel.mapping, dataType, mode: excel.mode, fileName: excel.fileName, sheetName: excel.selectedSheet, receivedColumns: excel.columns });
    const items = Array.isArray(data.items) ? data.items : safeArray(data.results);
    setExcel(prev => ({
      ...prev,
      commitResult: data,
      previewItems: items.length > 0 ? items : prev.previewItems,
      previewSummary: data.summary || prev.previewSummary,
      previewErrors: safeArray(data.errors),
      previewWarnings: safeArray(data.warnings),
    }));
    setSelected([]);
    setStatus({ tone: data.partial ? 'warning' : 'success', message: data.message || 'Import hoàn tất.' });
    await onCommitted?.(data);
    return data;
  });

  const toggleAll = () => {
    const ids = filteredItems.map(item => `import:${item.line}:${item.rowIndex}`);
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => (allFilteredSelected ? next.delete(id) : next.add(id)));
      return Array.from(next);
    });
  };

  const toggleRow = id => setSelected(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  const summary = excel.previewSummary || {};
  const busy = key => busyKey === key;
  const statusClass = status.tone === 'success'
    ? 'border-green-200 bg-green-50 text-green-800'
    : status.tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : status.tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-blue-200 bg-blue-50 text-blue-800';

  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4 space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="font-bold flex items-center gap-2"><UploadCloud size={18} className="text-blue-600" /> {title || `Import ${dataType === 'invoices' ? 'h?a ?n/?n h?ng' : 'sản phẩm'} t? Excel/CSV`}</h3>
          <p className="text-xs text-gray-600 mt-1">{description || 'Frontend parse file bằng xlsx rồi gửi JSON rows cho backend preview/commit, không upload binary.'}</p>
          <p className="mt-1 text-[11px] font-medium text-orange-700">
            Nghiệp vụ âm kho: hệ thống cho phép tồn âm đến {negativeStockLimitLabel}; hóa đơn/import bị chặn nếu tồn dự kiến thấp hơn ngưỡng này.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => downloadTemplate('xlsx')} className="px-3 py-2 rounded-lg border border-blue-300 bg-white text-blue-700 hover:bg-blue-50 text-xs font-medium flex items-center gap-1.5"><Download size={14} /> Tải mẫu Excel</button>
          <button type="button" onClick={() => downloadTemplate('csv')} className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-xs font-medium flex items-center gap-1.5"><Download size={14} /> Tải mẫu CSV</button>
          {onClose && <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 text-xs">Đóng</button>}
        </div>
      </div>

      {status.message && (
        <div className={`rounded-xl border px-3 py-2 text-sm flex items-start gap-2 ${statusClass}`}>
          {status.tone === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          <div className="flex-1 whitespace-pre-line">{status.message}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px_180px] gap-3 items-end">
        <label className="text-xs text-gray-600">
          Chọn file Excel/CSV
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="input-field mt-1 w-full bg-white text-sm" onChange={handleFile} />
        </label>
        <label className="text-xs text-gray-600">
          Sheet
          <select className="input-field mt-1 w-full bg-white text-sm" value={excel.selectedSheet} onChange={event => handleSheet(event.target.value)} disabled={excel.sheets.length === 0}>
            {excel.sheets.length === 0 ? <option value="">Chưa chọn file</option> : excel.sheets.map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600">
          Mode commit
          <select className="input-field mt-1 w-full bg-white text-sm" value={excel.mode} onChange={event => setExcel(prev => ({ ...prev, mode: event.target.value, previewItems: [], previewSummary: null, commitResult: null }))}>
            <option value="upsert">Upsert</option>
            <option value="create_only">Chỉ tạo mới</option>
            <option value="update_only">Chỉ cập nhật</option>
          </select>
        </label>
      </div>

      {excel.columns.length > 0 && (
        <div className="rounded-xl border bg-white p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="font-semibold text-sm">Mapping cột ({excel.columns.length} cột)</div>
            <button type="button" onClick={() => setExcel(prev => ({ ...prev, mapping: autoMapColumns(prev.columns, dataType) }))} className="text-xs px-2 py-1 rounded border hover:bg-gray-50">Tự map lại</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {fields.map(field => (
              <label key={field.key} className="text-xs text-gray-600">
                {field.label}{field.required ? <span className="text-red-500"> *</span> : ''}
                <select className="input-field w-full mt-1 text-sm" value={excel.mapping[field.key] || ''} onChange={event => setExcel(prev => ({ ...prev, mapping: { ...prev.mapping, [field.key]: event.target.value } }))}>
                  <option value="">Không map</option>
                  {excel.columns.map(column => <option key={`${field.key}-${column}`} value={column}>{column}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={previewImport} disabled={busyKey !== ''} className="btn-primary flex items-center gap-1.5 disabled:opacity-60">
          {busy('preview') ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />} Preview import
        </button>
        <button type="button" onClick={commitImport} disabled={busyKey !== '' || selected.length === 0} className="btn-success flex items-center gap-1.5 disabled:opacity-60">
          {busy('commit') ? <Loader2 size={15} className="animate-spin" /> : <PackageCheck size={15} />} Commit d?ng đã chọn ({selected.length})
        </button>
        <button type="button" onClick={() => { setExcel(prev => ({ ...prev, previewItems: [], previewSummary: null, previewErrors: [], previewWarnings: [], commitResult: null })); setSelected([]); }} className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50 text-sm flex items-center gap-1.5">
          <RefreshCw size={15} /> Reset preview
        </button>
        <div className="text-xs text-gray-600">D? d?c {formatNumber(excel.rows.length)} d?ng, {formatNumber(excel.columns.length)} c?t.</div>
      </div>

      {excel.previewSummary && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 text-sm">
          {[
            ['Tổng dòng', summary.totalRows],
            ['Hợp lệ', summary.validRows],
            ['Thành công', summary.successRows],
            ['Tạo mới', summary.created],
            ['Cập nhật', summary.updated],
            ['Bỏ qua', summary.skippedRows ?? summary.skipped],
            ['Lỗi', summary.errorRows ?? summary.errors],
            ['Số đơn', summary.invoiceCount],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-white px-3 py-2">
              <div className="text-[11px] text-gray-500">{label}</div>
              <div className="font-bold text-lg">{formatNumber(value || 0)}</div>
            </div>
          ))}
        </div>
      )}

      {(excel.previewErrors.length > 0 || excel.previewWarnings.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-sm">
          {excel.previewErrors.length > 0 && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700"><div className="font-semibold mb-1">Lỗi</div><ul className="list-disc pl-5 max-h-32 overflow-auto space-y-1">{excel.previewErrors.slice(0, 30).map((error, index) => <li key={index}>{error?.line ? `Dùng ${error.line}: ` : ''}{error?.field ? `${error.field}: ` : ''}{error?.message || String(error)}</li>)}</ul></div>}
          {excel.previewWarnings.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800"><div className="font-semibold mb-1">Cảnh báo</div><ul className="list-disc pl-5 max-h-32 overflow-auto space-y-1">{excel.previewWarnings.slice(0, 30).map((warning, index) => <li key={index}>{warning?.line ? `Dùng ${warning.line}: ` : ''}{warning?.message || String(warning)}</li>)}</ul></div>}
        </div>
      )}

      {excel.commitResult?.run_id && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Import run #{excel.commitResult.run_id}: tạo mới {formatNumber(excel.commitResult.summary?.created)}, cập nhật {formatNumber(excel.commitResult.summary?.updated)}, lỗi {formatNumber(excel.commitResult.summary?.errors)}, bỏ qua {formatNumber(excel.commitResult.summary?.skippedRows ?? excel.commitResult.summary?.skipped)}.
        </div>
      )}

      {excel.previewItems.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <input className="input-field flex-1 text-sm bg-white" placeholder="Lực d?ng import, m?, SKU, khách hàng, lỗi..." value={filter.query} onChange={event => setFilter(prev => ({ ...prev, query: event.target.value }))} />
            <select className="input-field text-sm bg-white lg:w-44" value={filter.action} onChange={event => setFilter(prev => ({ ...prev, action: event.target.value }))}>
              {['all', 'create', 'update', 'duplicate', 'error', 'skipped'].map(action => <option key={action} value={action}>{action === 'all' ? 'Tất cả status' : actionLabel(action)}</option>)}
            </select>
            <label className="inline-flex items-center gap-2 text-sm px-3 py-2 border rounded-lg bg-white"><input type="checkbox" checked={filter.issuesOnly} onChange={event => setFilter(prev => ({ ...prev, issuesOnly: event.target.checked }))} /> Chỉ dòng lỗi/cảnh báo</label>
          </div>
          <button type="button" onClick={toggleAll} className="px-3 py-1.5 border rounded-lg hover:bg-gray-50 inline-flex items-center gap-2 text-sm bg-white">
            <input type="checkbox" readOnly checked={allFilteredSelected} /> {allFilteredSelected ? 'Bỏ chọn dòng đang lọc' : 'Chọn dòng đang lọc'} ({selected.length}/{filteredItems.length})
          </button>
          <div className="border rounded-xl overflow-x-auto bg-white">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="bg-gray-100 text-xs text-gray-600">
                <tr>
                  <th className="p-2 text-left w-12">Chọn</th>
                  <th className="p-2 text-left">Dòng</th>
                  <th className="p-2 text-left">Dữ liệu chính</th>
                  <th className="p-2 text-left">M? / SKU</th>
                  <th className="p-2 text-left">Khách hàng</th>
                  <th className="p-2 text-left">SL / Tổng</th>
                  <th className="p-2 text-left">Lỗi / cảnh báo</th>
                  <th className="p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map(item => {
                  const id = `import:${item.line}:${item.rowIndex}`;
                  const action = getAction(item);
                  const primary = item.invoice_code || item.name || item.product_name || item.customer_name || item.key || '—';
                  const code = item.sku || item.product_sku || item.customer_code || item.parent_sku || item.key || '—';
                  const customer = item.customer_name || item.customer_code || item.customer_type || item.phone || item.email || '—';
                  const amount = item.quantity !== undefined ? `SL ${item.quantity}` : (item.total !== undefined ? formatVND(item.total) : (item.stock !== undefined ? `Tồn ${item.stock}` : '—'));
                  return (
                    <tr key={id} className={`border-t hover:bg-blue-50 ${action === 'error' ? 'bg-red-50/50' : ''}`}>
                      <td className="p-2"><input type="checkbox" checked={selectedSet.has(id)} onChange={() => toggleRow(id)} disabled={action === 'error' || action === 'duplicate'} /></td>
                      <td className="p-2 font-mono text-xs">{item.line}</td>
                      <td className="p-2"><div className="font-semibold">{primary}</div><div className="text-xs text-gray-500">Local #{item.existing_id || item.local_id || item.customer_id || '—'}</div></td>
                      <td className="p-2 text-xs"><div>{code}</div><div className="text-gray-500">Parent: {item.parent_sku || '—'}</div></td>
                      <td className="p-2 text-xs"><div>{customer}</div><div className="text-gray-500">Match: {item.customer_match_reason || '—'}</div></td>
                      <td className="p-2 text-xs font-medium">{amount}</td>
                      <td className="p-2 text-xs text-red-600 max-w-sm">{issueText(item) || '—'}</td>
                      <td className="p-2"><span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${ACTION_META[action] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>{actionLabel(action)}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredItems.length === 0 && <div className="py-8 text-center text-gray-400 text-sm">Không có dòng preview phù hợp.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
