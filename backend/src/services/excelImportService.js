const {
  getAll,
  getOne,
  insert,
  update,
  remove,
  now,
  normalizePaymentMethod,
} = require('../db/database');
const { normalizeSearchText, parseKeywordList } = require('../utils/productSearch');

const MAX_IMPORT_ROWS = 5000;
const IMPORT_TYPES = Object.freeze(['products', 'customers', 'invoices']);
const ACTION_CREATE = 'create';
const ACTION_UPDATE = 'update';
const ACTION_ERROR = 'error';
const ACTION_DUPLICATE = 'duplicate';
const ACTION_SKIPPED = 'skipped';

const FIELD_ALIASES = Object.freeze({
  products: {
    row_type: ['Loại dòng', 'Loai dong', 'row_type', 'type', 'Loại', 'Loai'],
    sku: ['SKU', 'Mã SKU', 'Ma SKU', 'Mã sản phẩm', 'Ma san pham', 'Mã biến thể', 'Ma bien the', 'Product code', 'Variant code', 'sku'],
    parent_sku: ['Parent SKU', 'ParentSKU', 'parent_sku', 'SKU cha', 'Mã SKU cha', 'Ma SKU cha', 'Mã cha', 'Ma cha'],
    name: ['Tên sản phẩm', 'Ten san pham', 'Tên', 'Ten', 'Tên hàng', 'Ten hang', 'Tên biến thể', 'Ten bien the', 'Product name', 'Variant name', 'name'],
    barcode: ['Barcode', 'Mã vạch', 'Ma vach', 'barcode'],
    category: ['Danh mục', 'Danh muc', 'Danh mục text', 'Danh muc text', 'Category', 'Nhóm hàng', 'Nhom hang'],
    import_price: ['Giá nhập', 'Gia nhap', 'Giá vốn', 'Gia von', 'Cost', 'Cost price', 'import_price'],
    wholesale_price: ['Giá sỉ', 'Gia si', 'Giá buôn', 'Gia buon', 'Wholesale price', 'wholesale_price'],
    retail_price: ['Giá lẻ', 'Gia le', 'Giá bán', 'Gia ban', 'Đơn giá', 'Don gia', 'Price', 'Retail price', 'retail_price'],
    vip_price: ['Giá VIP', 'Gia VIP', 'VIP price', 'vip_price'],
    stock: ['Tồn kho', 'Ton kho', 'Số lượng tồn', 'So luong ton', 'Số lượng', 'So luong', 'Quantity', 'Qty', 'stock'],
    unit: ['Đơn vị', 'Don vi', 'ĐVT', 'DVT', 'Unit', 'unit'],
    option1: ['Option 1', 'Thuộc tính 1', 'Thuoc tinh 1', 'Màu', 'Mau', 'Color', 'option1'],
    option2: ['Option 2', 'Thuộc tính 2', 'Thuoc tinh 2', 'Size', 'Kích cỡ', 'Kich co', 'option2'],
    option3: ['Option 3', 'Thuộc tính 3', 'Thuoc tinh 3', 'Chất liệu', 'Chat lieu', 'option3'],
    default_category_id: ['Default category id', 'Default category ID', 'default_category_id', 'ID danh mục mặc định', 'Id danh muc mac dinh'],
    supplier_id: ['Supplier id', 'Supplier ID', 'supplier_id', 'Nhà cung cấp id', 'Nha cung cap id', 'NCC id', 'ncc_id'],
    description: ['Mô tả', 'Mo ta', 'Description', 'description'],
    image_url: ['Ảnh', 'Anh', 'Image URL', 'image_url', 'Hình ảnh', 'Hinh anh'],
    active: ['Hoạt động', 'Hoat dong', 'Trạng thái', 'Trang thai', 'Status', 'Active', 'Đang bán', 'Dang ban'],
  },
  customers: {
    customer_code: ['customer_code', 'Mã khách hàng', 'Ma khach hang', 'Mã KH', 'Ma KH', 'Code', 'Customer code'],
    name: ['name', 'Tên khách hàng', 'Ten khach hang', 'Họ tên', 'Ho ten', 'Khách hàng', 'Khach hang', 'Customer name'],
    phone: ['phone', 'Điện thoại', 'Dien thoai', 'SĐT', 'SDT', 'Số điện thoại', 'So dien thoai', 'Điện thoại di động'],
    email: ['email', 'mail', 'E-mail'],
    address: ['address', 'Địa chỉ', 'Dia chi'],
    note: ['note', 'Ghi chú', 'Ghi chu', 'Notes'],
    customer_type: ['customer_type', 'Loại khách', 'Loai khach', 'Nhóm khách', 'Nhom khach', 'Group', 'Type'],
    tax_code: ['tax_code', 'Mã số thuế', 'Ma so thue', 'MST', 'Tax code'],
  },
  invoices: {
    invoice_code: ['Mã đơn hàng', 'Ma don hang', 'Mã hóa đơn', 'Ma hoa don', 'invoice_code', 'order_code', 'Code', 'Order code', 'Số hóa đơn', 'So hoa don'],
    customer_code: ['Mã khách hàng', 'Ma khach hang', 'customer_code', 'Mã KH', 'Ma KH'],
    customer_name: ['Tên khách hàng', 'Ten khach hang', 'Khách hàng', 'Khach hang', 'customer_name', 'Customer'],
    customer_phone: ['SĐT', 'SDT', 'Số điện thoại', 'So dien thoai', 'customer_phone', 'Phone'],
    customer_email: ['Email khách hàng', 'Email khach hang', 'customer_email', 'Email'],
    customer_type: ['Loại khách', 'Loai khach', 'Nhóm khách', 'Nhom khach', 'customer_type', 'Customer group', 'Customer type'],
    product_sku: ['SKU', 'Mã sản phẩm', 'Ma san pham', 'Mã hàng', 'Ma hang', 'product_sku', 'Variant SKU'],
    product_name: ['Tên sản phẩm', 'Ten san pham', 'Sản phẩm', 'San pham', 'product_name', 'Item name'],
    quantity: ['Số lượng', 'So luong', 'SL', 'Qty', 'Quantity', 'quantity'],
    unit_price: ['Đơn giá', 'Don gia', 'Giá bán', 'Gia ban', 'Unit price', 'Price', 'unit_price'],
    discount_amount: ['Giảm giá dòng', 'Giam gia dong', 'Chiết khấu dòng', 'Chiet khau dong', 'Discount amount', 'discount_amount'],
    discount_percent: ['% giảm giá', '% giam gia', 'Chiết khấu %', 'Chiet khau %', 'Discount percent', 'discount_percent'],
    line_total: ['Thành tiền dòng', 'Thanh tien dong', 'Line total', 'line_total', 'Tổng dòng', 'Tong dong'],
    total: ['Tổng tiền', 'Tong tien', 'Total', 'total', 'Tổng đơn', 'Tong don'],
    paid_amount: ['Đã thanh toán', 'Da thanh toan', 'Paid', 'paid_amount', 'Tiền đã trả', 'Tien da tra'],
    payment_status: ['Trạng thái thanh toán', 'Trang thai thanh toan', 'Payment status', 'payment_status'],
    payment_method: ['Phương thức thanh toán', 'Phuong thuc thanh toan', 'Payment method', 'payment_method'],
    status: ['Trạng thái đơn', 'Trang thai don', 'Trạng thái', 'Trang thai', 'Status', 'status'],
    created_at: ['Thời gian tạo', 'Thoi gian tao', 'Ngày tạo', 'Ngay tao', 'Created at', 'created_at', 'Ngày bán', 'Ngay ban'],
    note: ['Ghi chú', 'Ghi chu', 'Note', 'note'],
  },
});

function safeString(value, max = 500) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

function hasValue(value) {
  return !(value === undefined || value === null || String(value).trim() === '');
}

function normalizeColumn(value) {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/g, '');
}

function normalizeSku(value) {
  return safeString(value, 160);
}

function normalizeSkuKey(value) {
  return normalizeSku(value).toLowerCase();
}

function normalizePhone(value) {
  return safeString(value, 80).replace(/[^0-9+]/g, '');
}

function normalizeEmail(value) {
  return safeString(value, 200).toLowerCase();
}

function normalizeCustomerCode(value) {
  return safeString(value, 120);
}

function normalizeCustomerCodeKey(value) {
  return normalizeCustomerCode(value).toLowerCase();
}

function normalizeInvoiceCode(value) {
  return safeString(value, 120).replace(/^#/, '');
}

function normalizeInvoiceCodeKey(value) {
  return normalizeInvoiceCode(value).toLowerCase();
}

function isMetadataColumn(key) {
  return ['__line', '_line', 'line', 'rowNumber', '__rowNum__'].includes(String(key));
}

function rowHasData(row) {
  if (!row || typeof row !== 'object') return false;
  return Object.entries(row).some(([key, value]) => !isMetadataColumn(key) && hasValue(value));
}

function getLine(row, index) {
  for (const key of ['__line', '_line', 'line', 'rowNumber']) {
    const value = Number(row?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const xlsxRow = Number(row?.__rowNum__);
  if (Number.isFinite(xlsxRow) && xlsxRow >= 0) return xlsxRow + 1;
  return index + 2;
}

function collectColumns(rows = []) {
  const seen = new Set();
  const columns = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      if (isMetadataColumn(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return columns;
}

function normalizeImportType(value) {
  const raw = safeString(value || 'products', 40).toLowerCase();
  if (['product', 'products', 'san_pham', 'sanpham', 'variants', 'bien_the', 'bienthe'].includes(raw)) return 'products';
  if (['customer', 'customers', 'khach_hang', 'khachhang'].includes(raw)) return 'customers';
  if (['invoice', 'invoices', 'order', 'orders', 'hoa_don', 'hoadon', 'don_hang', 'donhang'].includes(raw)) return 'invoices';
  return 'products';
}

function normalizeMode(value) {
  const mode = safeString(value || 'upsert', 40).toLowerCase();
  return ['upsert', 'create_only', 'update_only'].includes(mode) ? mode : 'upsert';
}

function getCell(row, type, field, mapping = {}) {
  const mappedColumn = mapping && typeof mapping === 'object' ? mapping[field] : '';
  if (mappedColumn && Object.prototype.hasOwnProperty.call(row, mappedColumn)) return row[mappedColumn];

  const aliases = FIELD_ALIASES[type]?.[field] || [];
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias];
  }

  const normalizedAliases = aliases.map(normalizeColumn);
  for (const [actualKey, value] of Object.entries(row || {})) {
    if (isMetadataColumn(actualKey)) continue;
    if (normalizedAliases.includes(normalizeColumn(actualKey))) return value;
  }
  return '';
}

function normalizeSingleNumericSeparator(raw, separator) {
  const parts = raw.split(separator);
  if (parts.length <= 1) return raw;
  if (parts.length > 2 && parts.slice(1).every(part => /^\d{3}$/.test(part))) return parts.join('');
  if (parts.length === 2) {
    const [left, right] = parts;
    if (/^\d{3}$/.test(right)) return `${left}${right}`;
    return `${left}.${right}`;
  }
  return raw.replace(new RegExp(`\\${separator}`, 'g'), '');
}

function parseNumber(value, fieldLabel, line, errors, options = {}) {
  if (!hasValue(value)) return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || (options.integer && !Number.isInteger(value))) {
      errors.push({ line, field: fieldLabel, message: `${fieldLabel} phải là ${options.integer ? 'số nguyên ' : ''}không âm` });
      return undefined;
    }
    return value;
  }

  let raw = safeString(value, 80).replace(/\u00a0/g, ' ').replace(/[−–—]/g, '-');
  if (!raw) return undefined;
  const negativeByParentheses = /^\(.*\)$/.test(raw);
  raw = raw.replace(/\s+/g, '').replace(/[^0-9,.-]/g, '');
  if (negativeByParentheses && !raw.startsWith('-')) raw = `-${raw}`;
  if (!raw || raw === '-') {
    errors.push({ line, field: fieldLabel, message: `${fieldLabel} sai định dạng số` });
    return undefined;
  }
  const minusCount = (raw.match(/-/g) || []).length;
  if (minusCount > 1 || (raw.includes('-') && !raw.startsWith('-'))) {
    errors.push({ line, field: fieldLabel, message: `${fieldLabel} sai định dạng số` });
    return undefined;
  }
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    raw = lastComma > lastDot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if (lastComma >= 0) {
    raw = normalizeSingleNumericSeparator(raw, ',');
  } else if (lastDot >= 0) {
    raw = normalizeSingleNumericSeparator(raw, '.');
  }
  raw = raw.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    errors.push({ line, field: fieldLabel, message: `${fieldLabel} sai định dạng số` });
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || (options.integer && !Number.isInteger(n))) {
    errors.push({ line, field: fieldLabel, message: `${fieldLabel} phải là ${options.integer ? 'số nguyên ' : ''}không âm` });
    return undefined;
  }
  return n;
}

function parseBoolean(value, fallback = undefined) {
  if (!hasValue(value)) return fallback;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value === 0 ? 0 : 1;
  const key = normalizeColumn(value);
  if (['1', 'true', 'yes', 'y', 'co', 'active', 'hoatdong', 'dangban', 'ban', 'on'].includes(key)) return 1;
  if (['0', 'false', 'no', 'n', 'khong', 'inactive', 'ngungban', 'tamngung', 'off'].includes(key)) return 0;
  return fallback;
}

function normalizeProductRowType(value, parentSku) {
  if (!hasValue(value)) return parentSku ? 'VARIANT' : 'PARENT';
  const key = normalizeColumn(value);
  if (['parent', 'p', 'cha', 'hangcha', 'sanpham', 'sanphamcha', 'main', 'goc'].includes(key)) return 'PARENT';
  if (['variant', 'v', 'bienthe', 'con', 'hangcon', 'sanphamcon', 'child', 'variation'].includes(key)) return 'VARIANT';
  return '';
}

function normalizeProductStatus(value) {
  const parsed = parseBoolean(value, undefined);
  if (parsed !== undefined) return parsed;
  if (!hasValue(value)) return undefined;
  const key = normalizeColumn(value);
  if (['draft', 'inactive', 'archived', 'hidden', 'tamngung', 'ngungban'].includes(key)) return 0;
  return 1;
}

function normalizeInvoiceStatus(value) {
  const key = normalizeColumn(value || 'pending');
  if (['completed', 'complete', 'paid', 'done', 'dahoanthanh', 'hoanthanh', 'dathanhtoan'].includes(key)) return 'completed';
  if (['confirmed', 'xacnhan', 'daxacnhan'].includes(key)) return 'confirmed';
  if (['cancelled', 'canceled', 'huy', 'dahuy'].includes(key)) return 'cancelled';
  return 'pending';
}

function normalizePaymentStatus(value, total, paidAmount) {
  const key = normalizeColumn(value || '');
  if (['paid', 'dathanhtoan', 'thanhcong', 'completed'].includes(key)) return 'paid';
  if (['partial', 'partiallypaid', 'thanhtoanmotphan'].includes(key)) return 'partial';
  if (paidAmount > 0 && paidAmount < total) return 'partial';
  if (total > 0 && paidAmount >= total) return 'paid';
  return 'unpaid';
}

function rowsFromBody(body = {}) {
  const rows = Array.isArray(body) ? body : body.rows;
  if (!Array.isArray(rows)) {
    const err = new Error('Body import phải là mảng rows hoặc object { rows: [...] }.');
    err.statusCode = 400;
    throw err;
  }
  const filtered = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row && typeof row === 'object' && rowHasData(row));
  if (filtered.length > MAX_IMPORT_ROWS) {
    const err = new Error(`Import tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần để tránh treo ứng dụng offline.`);
    err.statusCode = 413;
    throw err;
  }
  return filtered;
}

function createBaseSummary(totalRows = 0) {
  return {
    totalRows,
    validRows: 0,
    successRows: 0,
    errorRows: 0,
    skippedRows: 0,
    duplicateRows: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    createdParents: 0,
    updatedParents: 0,
    createdVariants: 0,
    updatedVariants: 0,
    createdInvoices: 0,
    updatedInvoices: 0,
  };
}

function finalizePreviewSummary(items, type) {
  const summary = createBaseSummary(items.length);
  for (const item of items) {
    const action = item.action || item.status;
    if (action === ACTION_ERROR) {
      summary.errorRows += 1;
      summary.errors += Array.isArray(item.errors) && item.errors.length > 0 ? item.errors.length : 1;
      continue;
    }
    if (action === ACTION_DUPLICATE) {
      summary.duplicateRows += 1;
      summary.skippedRows += 1;
      summary.skipped += 1;
      continue;
    }
    if (action === ACTION_SKIPPED) {
      summary.skippedRows += 1;
      summary.skipped += 1;
      continue;
    }
    summary.validRows += 1;
    if (action === ACTION_CREATE) summary.created += 1;
    if (action === ACTION_UPDATE) summary.updated += 1;
    if (type === 'products' && item.row_type === 'PARENT' && action === ACTION_CREATE) summary.createdParents += 1;
    if (type === 'products' && item.row_type === 'PARENT' && action === ACTION_UPDATE) summary.updatedParents += 1;
    if (type === 'products' && item.row_type === 'VARIANT' && action === ACTION_CREATE) summary.createdVariants += 1;
    if (type === 'products' && item.row_type === 'VARIANT' && action === ACTION_UPDATE) summary.updatedVariants += 1;
    if (type === 'invoices' && action === ACTION_CREATE) summary.createdInvoices += 1;
    if (type === 'invoices' && action === ACTION_UPDATE) summary.updatedInvoices += 1;
  }
  return summary;
}

function makeErrorItem(row, type, errors, extra = {}) {
  return {
    ...row,
    ...extra,
    resource: type,
    data_type: type,
    key: row.key || row.sku || row.invoice_code || row.customer_code || row.name || `row-${row.line}`,
    action: ACTION_ERROR,
    status: ACTION_ERROR,
    errors,
  };
}

function productIndexes(products = getAll('products')) {
  const parentsBySku = new Map();
  const variantsBySku = new Map();
  const variantsByParentAndName = new Map();
  for (const product of products) {
    const skuKey = normalizeSkuKey(product.sku);
    if (!product.parent_id) {
      if (skuKey && !parentsBySku.has(skuKey)) parentsBySku.set(skuKey, product);
      continue;
    }
    if (skuKey && !variantsBySku.has(skuKey)) variantsBySku.set(skuKey, product);
    const nameKey = normalizeSearchText(product.name);
    if (product.parent_id && nameKey) variantsByParentAndName.set(`${product.parent_id}::${nameKey}`, product);
  }
  return { products, parentsBySku, variantsBySku, variantsByParentAndName };
}

function activeCategories() {
  return getAll('product_categories', category => category.active !== 0);
}

function categoryTextValues(category = {}) {
  return [
    category.name,
    category.group_name,
    category.group_key,
    ...parseKeywordList(category.keywords),
    ...parseKeywordList(category.aliases),
  ].filter(Boolean);
}

function findCategoryByText(value) {
  const key = normalizeSearchText(value);
  if (!key) return null;
  return activeCategories().find(category => categoryTextValues(category).some(text => {
    const normalized = normalizeSearchText(text);
    return normalized && (normalized === key || normalized.includes(key) || key.includes(normalized));
  })) || null;
}

function resolveCategoryId(defaultCategoryId, categoryText, fallbackId = null) {
  if (defaultCategoryId !== undefined && defaultCategoryId !== null && defaultCategoryId !== '') {
    const id = Number(defaultCategoryId);
    if (Number.isInteger(id) && id > 0) {
      const existing = getOne('product_categories', category => Number(category.id) === id && category.active !== 0);
      if (existing) return id;
    }
  }
  const matched = findCategoryByText(categoryText);
  if (matched) return matched.id;
  return fallbackId || null;
}

function findSupplierById(id) {
  const supplierId = Number(id);
  if (!Number.isInteger(supplierId) || supplierId <= 0) return null;
  return getOne('partners', partner => Number(partner.id) === supplierId && partner.active !== 0);
}

function normalizeProductRow(raw, index, mapping) {
  const line = getLine(raw, index);
  const errors = [];
  const parentSku = normalizeSku(getCell(raw, 'products', 'parent_sku', mapping));
  const type = normalizeProductRowType(getCell(raw, 'products', 'row_type', mapping), parentSku);
  const row = {
    line,
    rowIndex: index,
    row_type: type,
    sku: normalizeSku(getCell(raw, 'products', 'sku', mapping)),
    parent_sku: parentSku,
    name: safeString(getCell(raw, 'products', 'name', mapping), 500),
    barcode: safeString(getCell(raw, 'products', 'barcode', mapping), 160),
    category: safeString(getCell(raw, 'products', 'category', mapping), 240),
    unit: safeString(getCell(raw, 'products', 'unit', mapping), 80),
    option1: safeString(getCell(raw, 'products', 'option1', mapping), 200),
    option2: safeString(getCell(raw, 'products', 'option2', mapping), 200),
    option3: safeString(getCell(raw, 'products', 'option3', mapping), 200),
    description: safeString(getCell(raw, 'products', 'description', mapping), 5000),
    image_url: safeString(getCell(raw, 'products', 'image_url', mapping), 1000),
    import_price: parseNumber(getCell(raw, 'products', 'import_price', mapping), 'Giá nhập', line, errors),
    wholesale_price: parseNumber(getCell(raw, 'products', 'wholesale_price', mapping), 'Giá sỉ', line, errors),
    retail_price: parseNumber(getCell(raw, 'products', 'retail_price', mapping), 'Giá lẻ', line, errors),
    vip_price: parseNumber(getCell(raw, 'products', 'vip_price', mapping), 'Giá VIP', line, errors),
    stock: parseNumber(getCell(raw, 'products', 'stock', mapping), 'Tồn kho', line, errors, { integer: true }),
    default_category_id: parseNumber(getCell(raw, 'products', 'default_category_id', mapping), 'Default category id', line, errors, { integer: true }),
    supplier_id: parseNumber(getCell(raw, 'products', 'supplier_id', mapping), 'Supplier id', line, errors, { integer: true }),
    active: normalizeProductStatus(getCell(raw, 'products', 'active', mapping)),
    raw,
  };
  row.key = row.row_type === 'VARIANT' ? `${row.parent_sku}::${row.sku || row.name}` : row.sku;

  if (!type) errors.push({ line, field: 'Loại dòng', message: 'Loại dòng chỉ nhận PARENT/VARIANT hoặc bỏ trống để tự suy luận.' });
  if (!row.sku) errors.push({ line, field: 'SKU', message: 'Thiếu SKU/mã sản phẩm hoặc mã biến thể.' });
  if (type === 'VARIANT' && !row.parent_sku) errors.push({ line, field: 'Parent SKU', message: 'Biến thể thiếu Parent SKU.' });
  if (type === 'PARENT' && row.parent_sku) errors.push({ line, field: 'Parent SKU', message: 'Dòng sản phẩm cha phải để trống Parent SKU.' });
  if (row.default_category_id !== undefined && !getOne('product_categories', category => Number(category.id) === Number(row.default_category_id) && category.active !== 0)) {
    errors.push({ line, field: 'Default category id', message: `Danh mục mặc định id ${row.default_category_id} không tồn tại hoặc đã bị khóa.` });
  }
  if (row.supplier_id !== undefined && !findSupplierById(row.supplier_id)) {
    errors.push({ line, field: 'Supplier id', message: `Nhà cung cấp id ${row.supplier_id} không tồn tại hoặc đã bị khóa.` });
  }
  return { row, errors };
}

function buildProductPreview(rows, mapping = {}, mode = 'upsert') {
  const normalized = rows.map(({ row, index }) => normalizeProductRow(row, index, mapping));
  const indexes = productIndexes();
  const parentRowsInFile = new Map();
  const duplicateKeys = new Map();
  const items = [];

  for (const entry of normalized) {
    const row = entry.row;
    if (row.row_type === 'PARENT' && row.sku) {
      const key = normalizeSkuKey(row.sku);
      if (parentRowsInFile.has(key)) {
        entry.errors.push({ line: row.line, field: 'SKU', message: `SKU sản phẩm cha trùng trong file với dòng ${parentRowsInFile.get(key).line}.` });
      } else {
        parentRowsInFile.set(key, row);
      }
    }

    const duplicateKey = row.row_type === 'VARIANT'
      ? `variant::${normalizeSkuKey(row.parent_sku)}::${normalizeSkuKey(row.sku) || normalizeSearchText(row.name)}`
      : `parent::${normalizeSkuKey(row.sku)}`;
    if (row.sku && duplicateKeys.has(duplicateKey)) {
      entry.errors.push({ line: row.line, field: 'SKU', message: `Dòng trùng dữ liệu trong file với dòng ${duplicateKeys.get(duplicateKey)}.` });
    } else if (row.sku) {
      duplicateKeys.set(duplicateKey, row.line);
    }
  }

  for (const entry of normalized) {
    const row = entry.row;
    const errors = [...entry.errors];
    const warnings = [];
    let action = ACTION_ERROR;
    let existing = null;

    if (errors.length === 0 && row.row_type === 'PARENT') {
      const skuKey = normalizeSkuKey(row.sku);
      existing = indexes.parentsBySku.get(skuKey) || null;
      const skuAsVariant = indexes.variantsBySku.get(skuKey) || null;
      if (skuAsVariant && !existing) {
        errors.push({ line: row.line, field: 'SKU', message: `SKU "${row.sku}" đang thuộc biến thể, không import như sản phẩm cha để tránh ghi đè sai.` });
      } else if (existing) {
        action = mode === 'create_only' ? ACTION_DUPLICATE : ACTION_UPDATE;
      } else if (!row.name) {
        errors.push({ line: row.line, field: 'Tên sản phẩm', message: 'Sản phẩm cha mới cần có tên sản phẩm.' });
      } else {
        action = mode === 'update_only' ? ACTION_SKIPPED : ACTION_CREATE;
        if (action === ACTION_SKIPPED) warnings.push({ line: row.line, message: 'Bỏ qua vì mode chỉ cập nhật nhưng SKU chưa tồn tại.' });
      }
    }

    if (errors.length === 0 && row.row_type === 'VARIANT') {
      const parentKey = normalizeSkuKey(row.parent_sku);
      const parent = indexes.parentsBySku.get(parentKey) || parentRowsInFile.get(parentKey) || null;
      if (!parent) {
        errors.push({ line: row.line, field: 'Parent SKU', message: `Parent SKU "${row.parent_sku}" không tồn tại trong hệ thống hoặc cùng file.` });
      } else if (!parentRowsInFile.get(parentKey) && parent.active === 0) {
        errors.push({ line: row.line, field: 'Parent SKU', message: `Parent SKU "${row.parent_sku}" đang bị khóa.` });
      } else {
        const parentId = parent.id || null;
        const nameKey = normalizeSearchText(row.name);
        existing = indexes.variantsBySku.get(normalizeSkuKey(row.sku)) || (parentId && nameKey ? indexes.variantsByParentAndName.get(`${parentId}::${nameKey}`) : null) || null;
        if (existing) action = mode === 'create_only' ? ACTION_DUPLICATE : ACTION_UPDATE;
        else if (!row.name) errors.push({ line: row.line, field: 'Tên sản phẩm', message: 'Biến thể mới cần có tên biến thể.' });
        else {
          action = mode === 'update_only' ? ACTION_SKIPPED : ACTION_CREATE;
          if (action === ACTION_SKIPPED) warnings.push({ line: row.line, message: 'Bỏ qua vì mode chỉ cập nhật nhưng biến thể chưa tồn tại.' });
        }
      }
    }

    if (errors.length > 0) items.push(makeErrorItem(row, 'products', errors, { warnings }));
    else items.push({ ...row, resource: 'products', data_type: 'products', existing_id: existing?.id || null, action, status: action, warnings, errors: [] });
  }

  return { items, summary: finalizePreviewSummary(items, 'products'), warnings: [] };
}

function productPayloadFromRow(row, existing = {}, parent = null) {
  const payload = {};
  const categoryText = row.category !== undefined && row.category !== null && String(row.category).trim() !== ''
    ? row.category
    : (existing?.category !== undefined ? existing.category : (parent?.category || ''));

  if (row.sku) payload.sku = row.sku;
  if (row.name) payload.name = row.name;
  else if (!existing?.id) payload.name = row.sku || 'Sản phẩm';
  if (row.barcode) payload.barcode = row.barcode;
  if (row.description) payload.description = row.description;
  if (row.image_url) payload.image_url = row.image_url;
  payload.category = categoryText || '';
  payload.default_category_id = resolveCategoryId(row.default_category_id, categoryText, existing?.default_category_id || parent?.default_category_id || null);
  if (row.supplier_id !== undefined) payload.supplier_id = row.supplier_id || null;
  else if (existing?.supplier_id !== undefined) payload.supplier_id = existing.supplier_id || null;
  else if (parent?.supplier_id !== undefined) payload.supplier_id = parent.supplier_id || null;

  if (row.unit) payload.unit = row.unit;
  else if (!existing?.id) payload.unit = parent?.unit || 'cái';
  for (const field of ['option1', 'option2', 'option3']) if (row[field]) payload[field] = row[field];
  for (const field of ['import_price', 'wholesale_price', 'retail_price', 'vip_price', 'stock']) {
    if (row[field] !== undefined) payload[field] = row[field];
    else if (!existing?.id && field === 'stock') payload[field] = 0;
    else if (!existing?.id) payload[field] = parent?.[field] || 0;
  }
  if (row.active !== undefined) payload.active = row.active;
  else if (!existing?.id) payload.active = 1;
  payload.sync_source = existing?.sync_source || parent?.sync_source || 'excel_import';
  return payload;
}

function commitProductRows(preview) {
  const timestamp = now();
  const committed = [];
  const summary = createBaseSummary(preview.items.length);
  const byRowKey = new Map(preview.items.map(item => [`${item.line}:${item.rowIndex}`, item]));
  const committable = preview.items.filter(item => [ACTION_CREATE, ACTION_UPDATE].includes(item.action));
  const parentItems = committable.filter(item => item.row_type === 'PARENT');
  const variantItems = committable.filter(item => item.row_type === 'VARIANT');

  for (const item of preview.items) {
    if (item.action === ACTION_ERROR) { summary.errorRows += 1; summary.errors += item.errors?.length || 1; }
    else if ([ACTION_DUPLICATE, ACTION_SKIPPED].includes(item.action)) { summary.skippedRows += 1; summary.skipped += 1; }
  }

  for (const item of parentItems) {
    const existing = getOne('products', p => !p.parent_id && normalizeSkuKey(p.sku) === normalizeSkuKey(item.sku));
    const payload = { ...productPayloadFromRow(item, existing || null), parent_id: null, updated_at: timestamp };
    if (existing) {
      update('products', existing.id, payload);
      item.local_id = existing.id;
      summary.updated += 1;
      summary.updatedParents += 1;
      committed.push({ ...item, action: ACTION_UPDATE, status: ACTION_UPDATE, local_id: existing.id });
    } else {
      const id = insert('products', { ...payload, active: payload.active === undefined ? 1 : payload.active, created_at: timestamp, updated_at: timestamp });
      item.local_id = id;
      summary.created += 1;
      summary.createdParents += 1;
      committed.push({ ...item, action: ACTION_CREATE, status: ACTION_CREATE, local_id: id });
    }
  }

  for (const item of variantItems) {
    const parent = getOne('products', p => !p.parent_id && normalizeSkuKey(p.sku) === normalizeSkuKey(item.parent_sku));
    if (!parent) {
      const failed = makeErrorItem(item, 'products', [{ line: item.line, field: 'Parent SKU', message: 'Không tìm thấy sản phẩm cha tại thời điểm ghi.' }]);
      byRowKey.set(`${item.line}:${item.rowIndex}`, failed);
      summary.errorRows += 1;
      summary.errors += 1;
      continue;
    }
    const existingBySku = getOne('products', p => p.parent_id && normalizeSkuKey(p.sku) === normalizeSkuKey(item.sku));
    const existingByName = item.name
      ? getOne('products', p => Number(p.parent_id) === Number(parent.id) && normalizeSearchText(p.name) === normalizeSearchText(item.name))
      : null;
    const existing = existingBySku || existingByName;
    const payload = { ...productPayloadFromRow(item, existing || null, parent), parent_id: parent.id, updated_at: timestamp };
    if (existing) {
      update('products', existing.id, payload);
      item.local_id = existing.id;
      summary.updated += 1;
      summary.updatedVariants += 1;
      committed.push({ ...item, action: ACTION_UPDATE, status: ACTION_UPDATE, local_id: existing.id });
    } else {
      const id = insert('products', { ...payload, active: payload.active === undefined ? 1 : payload.active, created_at: timestamp, updated_at: timestamp });
      item.local_id = id;
      summary.created += 1;
      summary.createdVariants += 1;
      committed.push({ ...item, action: ACTION_CREATE, status: ACTION_CREATE, local_id: id });
    }
  }

  summary.successRows = committed.length;
  summary.validRows = committed.length;
  return { summary, committed };
}

function normalizeCustomerTypeKey(value) {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function customerIndexes(customers = getAll('customers')) {
  const activeCustomers = customers.filter(customer => customer && customer.active !== 0);
  const byType = new Map();
  for (const customer of activeCustomers) {
    const typeKey = normalizeCustomerTypeKey(customer.customer_type);
    if (!typeKey) continue;
    if (!byType.has(typeKey)) byType.set(typeKey, []);
    byType.get(typeKey).push(customer);
  }
  return {
    customers: activeCustomers,
    byCode: new Map(activeCustomers.filter(c => c.customer_code).map(c => [normalizeCustomerCodeKey(c.customer_code), c])),
    byPhone: new Map(activeCustomers.filter(c => c.phone).map(c => [normalizePhone(c.phone), c])),
    byEmail: new Map(activeCustomers.filter(c => c.email).map(c => [normalizeEmail(c.email), c])),
    byName: new Map(activeCustomers.filter(c => c.name).map(c => [normalizeSearchText(c.name), c])),
    byType,
  };
}

function findCustomerMatch(row, indexes = customerIndexes()) {
  return indexes.byCode.get(normalizeCustomerCodeKey(row.customer_code))
    || indexes.byPhone.get(normalizePhone(row.phone))
    || indexes.byEmail.get(normalizeEmail(row.email))
    || indexes.byName.get(normalizeSearchText(row.name))
    || null;
}

function customerTypeMatches(customer, expectedType) {
  const expected = normalizeCustomerTypeKey(expectedType);
  if (!expected) return true;
  const actual = normalizeCustomerTypeKey(customer?.customer_type);
  const name = normalizeCustomerTypeKey(customer?.name);
  return actual === expected || name === expected || (actual && expected && (actual.includes(expected) || expected.includes(actual)));
}

function resolveInvoiceCustomer(line, indexes = customerIndexes()) {
  const expectedType = line.customer_type || '';
  const codeKey = normalizeCustomerCodeKey(line.customer_code);
  let customer = null;
  let matchReason = '';

  if (codeKey) {
    customer = indexes.byCode.get(codeKey) || null;
    matchReason = 'customer_code';
    if (!customer) {
      return { customer: null, error: { line: line.line, field: 'Mã khách hàng', message: `Mã khách hàng "${line.customer_code}" không tồn tại hoặc đã bị khóa.` } };
    }
  } else {
    customer = findCustomerMatch({ name: line.customer_name, phone: line.customer_phone, email: line.customer_email }, indexes);
    matchReason = customer ? (line.customer_phone ? 'phone' : line.customer_email ? 'email' : 'name') : '';
  }

  if (!customer && expectedType) {
    const candidates = indexes.byType.get(normalizeCustomerTypeKey(expectedType)) || [];
    if (candidates.length === 1) {
      customer = candidates[0];
      matchReason = 'customer_type';
    } else if (candidates.length > 1) {
      return { customer: null, error: { line: line.line, field: 'Nhóm khách', message: `Nhóm khách "${expectedType}" khớp nhiều khách hàng; vui lòng nhập mã khách hàng rõ ràng.` } };
    }
  }

  if (!customer && (line.customer_name || line.customer_phone || line.customer_email || expectedType)) {
    return { customer: null, error: { line: line.line, field: 'Khách hàng', message: 'Không tìm thấy khách hàng phù hợp theo mã/tên/SĐT/email/nhóm. Hệ thống không tự tạo khách khi import hóa đơn để tránh import nhầm.' } };
  }

  if (customer && expectedType && !customerTypeMatches(customer, expectedType)) {
    return { customer: null, error: { line: line.line, field: 'Nhóm khách', message: `Khách hàng "${customer.name}" không thuộc nhóm/loại "${expectedType}".` } };
  }

  return { customer, matchReason };
}

function normalizeCustomerRow(raw, index, mapping) {
  const line = getLine(raw, index);
  const row = {
    line,
    rowIndex: index,
    customer_code: normalizeCustomerCode(getCell(raw, 'customers', 'customer_code', mapping)),
    name: safeString(getCell(raw, 'customers', 'name', mapping), 300),
    phone: normalizePhone(getCell(raw, 'customers', 'phone', mapping)),
    email: normalizeEmail(getCell(raw, 'customers', 'email', mapping)),
    address: safeString(getCell(raw, 'customers', 'address', mapping), 500),
    note: safeString(getCell(raw, 'customers', 'note', mapping), 1000),
    customer_type: safeString(getCell(raw, 'customers', 'customer_type', mapping), 100) || 'Khách lẻ',
    tax_code: safeString(getCell(raw, 'customers', 'tax_code', mapping), 80),
    raw,
  };
  row.key = row.customer_code || row.phone || row.email || row.name || `row-${line}`;
  const errors = [];
  if (!row.name) errors.push({ line, field: 'Tên khách hàng', message: 'Thiếu tên khách hàng.' });
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push({ line, field: 'Email', message: 'Email không hợp lệ.' });
  if (row.phone && row.phone.replace(/[^0-9]/g, '').length < 8) errors.push({ line, field: 'Số điện thoại', message: 'Số điện thoại quá ngắn.' });
  return { row, errors };
}

function buildCustomerPreview(rows, mapping = {}, mode = 'upsert') {
  const indexes = customerIndexes();
  const seen = new Map();
  const items = rows.map(({ row: raw, index }) => {
    const { row, errors } = normalizeCustomerRow(raw, index, mapping);
    const duplicateKey = [normalizeCustomerCodeKey(row.customer_code), normalizePhone(row.phone), normalizeEmail(row.email), normalizeSearchText(row.name)].find(Boolean);
    if (duplicateKey && seen.has(duplicateKey)) errors.push({ line: row.line, field: 'Dữ liệu', message: `Trùng khách hàng trong file với dòng ${seen.get(duplicateKey)}.` });
    else if (duplicateKey) seen.set(duplicateKey, row.line);
    if (errors.length > 0) return makeErrorItem(row, 'customers', errors);
    const existing = findCustomerMatch(row, indexes);
    let action;
    const warnings = [];
    if (existing) action = mode === 'create_only' ? ACTION_DUPLICATE : ACTION_UPDATE;
    else {
      action = mode === 'update_only' ? ACTION_SKIPPED : ACTION_CREATE;
      if (action === ACTION_SKIPPED) warnings.push({ line: row.line, message: 'Bỏ qua vì mode chỉ cập nhật nhưng khách hàng chưa tồn tại.' });
    }
    return { ...row, resource: 'customers', data_type: 'customers', existing_id: existing?.id || null, action, status: action, warnings, errors: [] };
  });
  return { items, summary: finalizePreviewSummary(items, 'customers'), warnings: [] };
}

function commitCustomerRows(preview) {
  const summary = createBaseSummary(preview.items.length);
  const committed = [];
  for (const item of preview.items) {
    if (item.action === ACTION_ERROR) { summary.errorRows += 1; summary.errors += item.errors?.length || 1; continue; }
    if (![ACTION_CREATE, ACTION_UPDATE].includes(item.action)) { summary.skippedRows += 1; summary.skipped += 1; continue; }
    const existing = findCustomerMatch(item);
    const payload = {
      name: item.name,
      phone: item.phone || '',
      email: item.email || '',
      tax_code: item.tax_code || '',
      customer_type: item.customer_type || 'Khách lẻ',
      invoice_type: 'non_electronic',
      address: item.address || '',
      note: item.note || '',
      customer_code: item.customer_code || '',
      sync_source: existing?.sync_source || 'excel_import',
    };
    if (existing) {
      update('customers', existing.id, payload);
      summary.updated += 1;
      committed.push({ ...item, local_id: existing.id, action: ACTION_UPDATE, status: ACTION_UPDATE });
    } else {
      const id = insert('customers', { ...payload, active: 1, created_at: now() });
      summary.created += 1;
      committed.push({ ...item, local_id: id, action: ACTION_CREATE, status: ACTION_CREATE });
    }
  }
  summary.successRows = committed.length;
  summary.validRows = committed.length;
  return { summary, committed };
}

function resolveProductForInvoiceLine(line) {
  const skuKey = normalizeSkuKey(line.product_sku);
  if (skuKey) {
    const bySku = getOne('products', product => product.active !== 0 && normalizeSkuKey(product.sku) === skuKey);
    if (bySku) return bySku;
  }
  const nameKey = normalizeSearchText(line.product_name);
  if (nameKey) return getOne('products', product => product.active !== 0 && normalizeSearchText(product.name) === nameKey);
  return null;
}

function normalizeInvoiceLine(raw, index, mapping) {
  const line = getLine(raw, index);
  const errors = [];
  const quantity = parseNumber(getCell(raw, 'invoices', 'quantity', mapping), 'Số lượng', line, errors);
  const unitPrice = parseNumber(getCell(raw, 'invoices', 'unit_price', mapping), 'Đơn giá', line, errors);
  const discountAmount = parseNumber(getCell(raw, 'invoices', 'discount_amount', mapping), 'Giảm giá dòng', line, errors);
  const discountPercent = parseNumber(getCell(raw, 'invoices', 'discount_percent', mapping), '% giảm giá', line, errors);
  const lineTotal = parseNumber(getCell(raw, 'invoices', 'line_total', mapping), 'Thành tiền dòng', line, errors);
  const total = parseNumber(getCell(raw, 'invoices', 'total', mapping), 'Tổng tiền', line, errors);
  const paidAmount = parseNumber(getCell(raw, 'invoices', 'paid_amount', mapping), 'Đã thanh toán', line, errors);
  const row = {
    line,
    rowIndex: index,
    invoice_code: normalizeInvoiceCode(getCell(raw, 'invoices', 'invoice_code', mapping)),
    customer_code: normalizeCustomerCode(getCell(raw, 'invoices', 'customer_code', mapping)),
    customer_name: safeString(getCell(raw, 'invoices', 'customer_name', mapping), 300),
    customer_phone: normalizePhone(getCell(raw, 'invoices', 'customer_phone', mapping)),
    customer_email: normalizeEmail(getCell(raw, 'invoices', 'customer_email', mapping)),
    customer_type: safeString(getCell(raw, 'invoices', 'customer_type', mapping), 100),
    product_sku: normalizeSku(getCell(raw, 'invoices', 'product_sku', mapping)),
    product_name: safeString(getCell(raw, 'invoices', 'product_name', mapping), 500),
    quantity: quantity === undefined ? 1 : quantity,
    unit_price: unitPrice === undefined ? 0 : unitPrice,
    discount_amount: discountAmount === undefined ? 0 : discountAmount,
    discount_percent: discountPercent === undefined ? 0 : Math.min(100, discountPercent),
    line_total: lineTotal,
    total,
    paid_amount: paidAmount,
    payment_status: safeString(getCell(raw, 'invoices', 'payment_status', mapping), 80),
    payment_method: safeString(getCell(raw, 'invoices', 'payment_method', mapping), 80),
    status: safeString(getCell(raw, 'invoices', 'status', mapping), 80),
    created_at: safeString(getCell(raw, 'invoices', 'created_at', mapping), 120),
    note: safeString(getCell(raw, 'invoices', 'note', mapping), 1000),
    raw,
  };
  row.key = row.invoice_code || `row-${line}`;
  if (!row.invoice_code) errors.push({ line, field: 'Mã đơn hàng', message: 'Thiếu mã đơn hàng/hóa đơn.' });
  if (!row.product_sku && !row.product_name) errors.push({ line, field: 'Sản phẩm', message: 'Thiếu SKU hoặc tên sản phẩm trong dòng đơn.' });
  if (!Number.isFinite(row.quantity) || row.quantity <= 0) errors.push({ line, field: 'Số lượng', message: 'Số lượng phải lớn hơn 0.' });
  return { row, errors };
}

function buildInvoicePreview(rows, mapping = {}, mode = 'upsert') {
  const normalized = rows.map(({ row, index }) => normalizeInvoiceLine(row, index, mapping));
  const items = [];
  const existingInvoices = new Map(getAll('invoices').filter(inv => inv.invoice_code).map(inv => [normalizeInvoiceCodeKey(inv.invoice_code), inv]));
  const seenInvoiceCodes = new Set();

  for (const entry of normalized) {
    const row = entry.row;
    const errors = [...entry.errors];
    const warnings = [];
    const product = resolveProductForInvoiceLine(row);
    if (!product && (row.product_sku || row.product_name)) {
      errors.push({ line: row.line, field: 'Sản phẩm', message: `Không tìm thấy sản phẩm/biến thể local khớp SKU/tên "${row.product_sku || row.product_name}".` });
    }
    const customerResult = resolveInvoiceCustomer(row);
    if (customerResult.error) errors.push(customerResult.error);
    const existing = existingInvoices.get(normalizeInvoiceCodeKey(row.invoice_code));
    let action = ACTION_ERROR;
    if (errors.length === 0) {
      if (existing) {
        if (mode === 'update_only') action = ACTION_UPDATE;
        else {
          action = ACTION_DUPLICATE;
          warnings.push({ line: row.line, message: 'Mã đơn hàng đã tồn tại; hệ thống bỏ qua ở mode hiện tại để tránh ghi đè đơn cũ ngoài ý muốn.' });
        }
      } else if (mode === 'update_only') {
        action = ACTION_SKIPPED;
        warnings.push({ line: row.line, message: 'Bỏ qua vì mode chỉ cập nhật nhưng mã đơn hàng chưa tồn tại.' });
      } else {
        action = ACTION_CREATE;
      }
    }
    seenInvoiceCodes.add(normalizeInvoiceCodeKey(row.invoice_code));
    if (errors.length > 0) items.push(makeErrorItem(row, 'invoices', errors, { warnings, product_id: product?.id || null, customer_id: customerResult.customer?.id || null, customer_match_reason: customerResult.matchReason || '' }));
    else items.push({ ...row, resource: 'invoices', data_type: 'invoices', product_id: product?.parent_id ? product.parent_id : (product?.id || null), variant_id: product?.parent_id ? product.id : null, customer_id: customerResult.customer?.id || null, customer_match_reason: customerResult.matchReason || '', existing_id: existing?.id || null, action, status: action, warnings, errors: [] });
  }

  const summary = finalizePreviewSummary(items, 'invoices');
  summary.invoiceCount = seenInvoiceCodes.size;
  return { items, summary, warnings: [] };
}

function resolveCommittedInvoiceCustomer(firstLine) {
  if (firstLine.customer_id) return firstLine.customer_id;
  return resolveInvoiceCustomer(firstLine).customer?.id || null;
}

function normalizeDateString(value) {
  if (!hasValue(value)) return now();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return now();
  return date.toISOString();
}

function commitInvoiceRows(preview) {
  const summary = createBaseSummary(preview.items.length);
  const committed = [];
  const validItems = [];
  for (const item of preview.items) {
    if (item.action === ACTION_ERROR) { summary.errorRows += 1; summary.errors += item.errors?.length || 1; continue; }
    if (![ACTION_CREATE, ACTION_UPDATE].includes(item.action)) { summary.skippedRows += 1; summary.skipped += 1; continue; }
    validItems.push(item);
  }

  const grouped = new Map();
  for (const item of validItems) {
    const key = normalizeInvoiceCodeKey(item.invoice_code);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }

  for (const lines of grouped.values()) {
    const first = lines[0];
    const existing = getOne('invoices', inv => normalizeInvoiceCodeKey(inv.invoice_code) === normalizeInvoiceCodeKey(first.invoice_code));
    const action = existing ? ACTION_UPDATE : ACTION_CREATE;
    const subtotal = lines.reduce((sum, line) => {
      const quantity = Number(line.quantity) || 0;
      const unitPrice = Number(line.unit_price) || 0;
      const rawLineTotal = Number(line.line_total);
      const discountAmount = Number(line.discount_amount) || 0;
      const discountPercent = Number(line.discount_percent) || 0;
      const calculated = Math.max(0, quantity * unitPrice - discountAmount - (quantity * unitPrice * discountPercent / 100));
      return sum + (Number.isFinite(rawLineTotal) && rawLineTotal >= 0 ? rawLineTotal : calculated);
    }, 0);
    const fileTotal = Number(first.total);
    if (Number.isFinite(fileTotal) && Math.abs(fileTotal - subtotal) > 1) {
      first.warnings = [...(first.warnings || []), { line: first.line, message: `Tổng tiền trong file (${fileTotal}) khác tổng chi tiết (${subtotal}); hệ thống dùng tổng chi tiết để an toàn.` }];
    }
    const total = subtotal;
    const paidAmount = Number.isFinite(Number(first.paid_amount)) ? Math.min(total, Math.max(0, Number(first.paid_amount))) : 0;
    const paymentStatus = normalizePaymentStatus(first.payment_status, total, paidAmount);
    const customerId = resolveCommittedInvoiceCustomer(first);
    const invoicePayload = {
      invoice_code: first.invoice_code,
      customer_id: customerId,
      user_id: null,
      subtotal,
      vat_percent: 0,
      vat_amount: 0,
      discount_amount: 0,
      discount_percent: 0,
      total,
      paid_amount: paymentStatus === 'paid' ? total : paidAmount,
      change_amount: 0,
      remaining_amount: paymentStatus === 'paid' ? 0 : Math.max(0, total - paidAmount),
      delivery_fee: 0,
      payment_method: normalizePaymentMethod(first.payment_method || (paymentStatus === 'paid' ? 'cash' : 'debt')),
      note: first.note || 'Import từ Excel; không tự trừ tồn kho để tránh thay đổi dữ liệu cũ ngoài ý muốn.',
      invoice_writer: '',
      receiver_name: first.customer_name || '',
      delivery_date: null,
      status: normalizeInvoiceStatus(first.status || (paymentStatus === 'paid' ? 'completed' : 'pending')),
      sync_source: 'excel_import',
      created_at: normalizeDateString(first.created_at),
      updated_at: now(),
    };

    let invoiceId;
    if (existing) {
      invoiceId = existing.id;
      update('invoices', existing.id, { ...invoicePayload, created_at: existing.created_at || invoicePayload.created_at });
      for (const old of getAll('invoice_details', detail => Number(detail.invoice_id) === Number(existing.id))) remove('invoice_details', old.id);
      summary.updated += lines.length;
      summary.updatedInvoices += 1;
    } else {
      invoiceId = insert('invoices', invoicePayload);
      summary.created += lines.length;
      summary.createdInvoices += 1;
    }

    for (const line of lines) {
      const quantity = Number(line.quantity) || 1;
      const unitPrice = Number(line.unit_price) || 0;
      const discountAmount = Number(line.discount_amount) || 0;
      const discountPercent = Number(line.discount_percent) || 0;
      const calculatedLineTotal = Math.max(0, quantity * unitPrice - discountAmount - (quantity * unitPrice * discountPercent / 100));
      const lineTotal = Number.isFinite(Number(line.line_total)) ? Number(line.line_total) : calculatedLineTotal;
      insert('invoice_details', {
        invoice_id: invoiceId,
        type: 'product',
        item_type: 'product',
        combo_id: null,
        product_id: line.product_id || null,
        variant_id: line.variant_id || null,
        product_name: line.product_name || line.product_sku || 'Sản phẩm Excel',
        product_sku: line.product_sku || '',
        name: line.product_name || line.product_sku || 'Sản phẩm Excel',
        sku: line.product_sku || '',
        quantity,
        unit_price: unitPrice,
        import_price: 0,
        discount_amount: discountAmount,
        discount_percent: discountPercent,
        line_total: lineTotal,
        created_at: now(),
      });
      committed.push({ ...line, invoice_id: invoiceId, action, status: action });
    }
  }

  summary.successRows = committed.length;
  summary.validRows = committed.length;
  return { summary, committed };
}

function buildPreview(type, rows, mapping, mode) {
  if (type === 'customers') return buildCustomerPreview(rows, mapping, mode);
  if (type === 'invoices') return buildInvoicePreview(rows, mapping, mode);
  return buildProductPreview(rows, mapping, mode);
}

function previewImport(body = {}) {
  const type = normalizeImportType(body.dataType || body.type || body.resource);
  const mode = normalizeMode(body.mode);
  const rows = rowsFromBody(body);
  const mapping = body.mapping && typeof body.mapping === 'object' ? body.mapping : {};
  const receivedColumns = Array.isArray(body.receivedColumns) ? body.receivedColumns : collectColumns(rows.map(item => item.row));
  const preview = buildPreview(type, rows, mapping, mode);
  return {
    ok: preview.summary.errorRows === 0,
    resource: type,
    resources: [type],
    dataType: type,
    mode,
    fileName: safeString(body.fileName || body.file_name, 260),
    sheetName: safeString(body.sheetName || body.sheet_name, 120),
    summary: preview.summary,
    items: preview.items,
    results: preview.items,
    errors: preview.items.flatMap(item => Array.isArray(item.errors) ? item.errors : []),
    warnings: preview.items.flatMap(item => Array.isArray(item.warnings) ? item.warnings : []),
    receivedColumns,
    expectedColumns: Object.keys(FIELD_ALIASES[type] || {}),
    progress: { totalRows: preview.summary.totalRows, validRows: preview.summary.validRows },
  };
}

function parseJsonField(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function insertHistoryDetail(runId, item, row) {
  return insert('excel_import_details', {
    run_id: runId,
    row_index: item.rowIndex,
    line: item.line,
    data_key: item.key || item.sku || item.invoice_code || item.customer_code || item.name || '',
    action: item.action || '',
    status: item.status || item.action || '',
    message: item.message || '',
    row_json: JSON.stringify(row || item.raw || {}),
    errors_json: JSON.stringify(item.errors || []),
    warnings_json: JSON.stringify(item.warnings || []),
    created_at: now(),
    updated_at: now(),
  });
}

function publicHistoryRun(run, includeDetails = false) {
  const summary = parseJsonField(run.summary_json, {});
  const errors = parseJsonField(run.errors_json, []);
  const warnings = parseJsonField(run.warnings_json, []);
  const details = includeDetails ? getAll('excel_import_details', detail => Number(detail.run_id) === Number(run.id)).map(detail => ({
    ...detail,
    row: parseJsonField(detail.row_json, {}),
    errors: parseJsonField(detail.errors_json, []),
    warnings: parseJsonField(detail.warnings_json, []),
  })) : undefined;
  return {
    ...run,
    summary,
    errors,
    warnings,
    ...(includeDetails ? { details, items: details, results: details } : {}),
  };
}

function commitImport(body = {}, req = null) {
  const type = normalizeImportType(body.dataType || body.type || body.resource);
  const mode = normalizeMode(body.mode);
  const rows = rowsFromBody(body);
  const mapping = body.mapping && typeof body.mapping === 'object' ? body.mapping : {};
  const receivedColumns = Array.isArray(body.receivedColumns) ? body.receivedColumns : collectColumns(rows.map(item => item.row));
  const preview = buildPreview(type, rows, mapping, mode);
  const fileName = safeString(body.fileName || body.file_name || 'excel-import.xlsx', 260);
  const sheetName = safeString(body.sheetName || body.sheet_name || '', 120);

  const runId = insert('excel_import_runs', {
    file_name: fileName,
    sheet_name: sheetName,
    data_type: type,
    mode,
    status: 'running',
    total_rows: preview.summary.totalRows,
    success_rows: 0,
    error_rows: preview.summary.errorRows,
    skipped_rows: preview.summary.skippedRows + preview.summary.duplicateRows,
    user_id: req?.user?.id || null,
    user_name: req?.user?.name || req?.user?.email || '',
    summary_json: JSON.stringify(preview.summary),
    errors_json: JSON.stringify(preview.items.flatMap(item => item.errors || [])),
    warnings_json: JSON.stringify(preview.items.flatMap(item => item.warnings || [])),
    created_at: now(),
    updated_at: now(),
  });

  let commitResult;
  if (type === 'customers') commitResult = commitCustomerRows(preview);
  else if (type === 'invoices') commitResult = commitInvoiceRows(preview);
  else commitResult = commitProductRows(preview);

  const finalItems = preview.items.map(item => {
    const committed = commitResult.committed.find(row => Number(row.line) === Number(item.line) && Number(row.rowIndex) === Number(item.rowIndex));
    return committed || item;
  });

  for (const item of finalItems) {
    const sourceRow = rows.find(row => Number(row.index) === Number(item.rowIndex))?.row || item.raw || {};
    insertHistoryDetail(runId, item, sourceRow);
  }

  const finalSummary = {
    ...preview.summary,
    ...commitResult.summary,
    totalRows: preview.summary.totalRows,
    errorRows: commitResult.summary.errorRows || 0,
    skippedRows: commitResult.summary.skippedRows || 0,
  };
  finalSummary.errors = commitResult.summary.errors || 0;
  finalSummary.successRows = commitResult.summary.successRows || 0;
  finalSummary.validRows = commitResult.summary.validRows || 0;

  const status = finalSummary.successRows > 0
    ? (finalSummary.errors > 0 || finalSummary.skippedRows > 0 ? 'partial' : 'success')
    : (finalSummary.errors > 0 ? 'failed' : 'skipped');
  const errors = finalItems.flatMap(item => item.errors || []);
  const warnings = finalItems.flatMap(item => item.warnings || []);

  update('excel_import_runs', runId, {
    status,
    success_rows: finalSummary.successRows,
    error_rows: finalSummary.errorRows,
    skipped_rows: finalSummary.skippedRows,
    summary_json: JSON.stringify(finalSummary),
    errors_json: JSON.stringify(errors),
    warnings_json: JSON.stringify(warnings),
    updated_at: now(),
  });

  return {
    ok: status !== 'failed',
    partial: status === 'partial',
    resource: type,
    resources: [type],
    dataType: type,
    mode,
    run_id: runId,
    fileName,
    sheetName,
    status,
    summary: finalSummary,
    items: finalItems,
    results: finalItems,
    errors,
    warnings,
    receivedColumns,
    progress: { totalRows: finalSummary.totalRows, validRows: finalSummary.validRows },
    message: status === 'success'
      ? 'Import Excel hoàn tất.'
      : status === 'partial'
        ? 'Import Excel hoàn tất một phần; chỉ các dòng hợp lệ được ghi.'
        : 'Không có dòng hợp lệ nào được ghi.',
  };
}

function listHistory(limit = 50) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  return getAll('excel_import_runs')
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, safeLimit)
    .map(run => publicHistoryRun(run, false));
}

function historyDetail(id) {
  const run = getOne('excel_import_runs', item => Number(item.id) === Number(id));
  if (!run) {
    const err = new Error('Không tìm thấy lịch sử import Excel.');
    err.statusCode = 404;
    throw err;
  }
  return publicHistoryRun(run, true);
}

module.exports = {
  IMPORT_TYPES,
  previewImport,
  commitImport,
  listHistory,
  historyDetail,
};
