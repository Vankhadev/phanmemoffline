/**
 * Dịch vụ tải đơn hàng về ổ đĩa theo từng khách hàng.
 *
 * Mỗi khách hàng sẽ có 1 tệp tin riêng, tên tệp tin được tự động sinh từ tên
 * khách hàng (vd: khách "Nguyễn Văn A" -> "Nguyen_Van_A.xlsx"). Bên trong mỗi tệp
 * là toàn bộ hóa đơn của khách đó, kèm theo từng món hàng chi tiết.
 *
 * Toàn bộ các tệp được nén lại thành 1 file ZIP duy nhất để người dùng tải về
 * một lần, sau đó tự giải nén ra ổ đĩa.
 */
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const {
  getAll,
  getOne,
  isCancelledInvoiceStatus,
  isInvoiceVisibleInActiveList,
} = require('../db/database');
const { resolveInvoiceDetailDisplayFields } = require('../utils/productDisplayName');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const TITLE_FONT = { bold: true, size: 13, color: { argb: 'FF1E293B' } };
const BORDER = {
  top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
};

/**
 * Chuẩn hóa chuỗi để dùng làm tên tệp trên Windows.
 * Loại bỏ ký tự cấm: \ / : * ? " < > |
 */
function sanitizeFileName(name, fallback = 'Khach_Hang') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');

  if (!cleaned) return fallback;

  // Giới hạn độ dài tên tệp cho Windows (255 ký tự)
  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
}

function toMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function derivePaymentStatus(invoice = {}) {
  if (isCancelledInvoiceStatus(invoice.status)) return 'cancelled';
  const total = toMoney(invoice.total ?? invoice.total_amount);
  const paid = toMoney(invoice.paid_amount);
  if (total <= 0) return paid > 0 ? 'paid' : 'unpaid';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

function paymentStatusText(status) {
  switch (status) {
    case 'paid': return 'Đã thanh toán';
    case 'partial': return 'Trả một phần';
    case 'unpaid': return 'Chưa thanh toán';
    case 'cancelled': return 'Đã hủy';
    default: return '';
  }
}

function paymentMethodText(method) {
  const key = String(method || '').trim().toLowerCase();
  switch (key) {
    case 'cash': return 'Tiền mặt';
    case 'card': return 'Thẻ';
    case 'transfer':
    case 'bank_transfer': return 'Chuyển khoản';
    case 'credit': return 'Công nợ';
    case 'cod': return 'COD';
    case 'momo': return 'MoMo';
    case 'vnpay': return 'VNPay';
    case 'mpos': return 'MPOS';
    default: return method ? String(method) : 'Không rõ';
  }
}

/**
 * Gom toàn bộ chi tiết hóa đơn theo invoice_id để tra cứu nhanh (O(n) thay vì O(n*m)).
 */
function groupDetailsByInvoice() {
  const map = new Map();
  const productsById = new Map();
  for (const product of getAll('products')) {
    productsById.set(Number(product.id), product);
  }
  const getProductById = id => productsById.get(Number(id)) || null;

  for (const detail of getAll('invoice_details')) {
    const invoiceId = Number(detail.invoice_id);
    if (!Number.isFinite(invoiceId)) continue;
    if (!map.has(invoiceId)) map.set(invoiceId, []);
    const display = resolveInvoiceDetailDisplayFields(detail, getProductById);
    map.get(invoiceId).push({
      ...detail,
      product_name: display.product_name || detail.product_name || detail.name || detail.combo_name || 'Sản phẩm',
      product_sku: display.product_sku || detail.product_sku || detail.sku || '',
      quantity: toMoney(detail.quantity),
      unit_price: toMoney(detail.unit_price),
      line_total: toMoney(detail.line_total ?? detail.total ?? 0),
    });
  }
  return map;
}

/**
 * Tạo nội dung Excel cho một khách hàng (toàn bộ hóa đơn của họ).
 */
async function buildCustomerWorkbook(customer, invoices, detailsByInvoice) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Bán Hàng Pos';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Đơn hàng', {
    views: [{ state: 'frozen', ySplit: 4 }],
  });

  const customerName = customer?.name || 'Khách lẻ';
  const customerPhone = customer?.phone || '';

  // Dòng 1: tên khách hàng
  const titleRow = sheet.addRow([`Khách hàng: ${customerName}`]);
  titleRow.getCell(1).font = TITLE_FONT;
  sheet.mergeCells('A1:H1');

  // Dòng 2: thông tin liên hệ + số đơn
  const infoRow = sheet.addRow([
    `Số điện thoại: ${customerPhone || '—'}`,
    '',
    '',
    '',
    '',
    '',
    '',
    `Tổng số đơn: ${invoices.length}`,
  ]);
  infoRow.getCell(1).font = { size: 10, color: { argb: 'FF6B7280' } };
  infoRow.getCell(8).font = { bold: true, size: 10, color: { argb: 'FF1E293B' } };
  infoRow.getCell(8).alignment = { horizontal: 'right' };

  // Dòng 3: trống
  sheet.addRow([]);

  // Dòng 4: tiêu đề cột
  const headers = [
    'STT', 'Ngày tạo', 'Mã đơn hàng', 'Sản phẩm', 'SL',
    'Đơn giá (VNĐ)', 'Thành tiền (VNĐ)', 'Tổng đơn (VNĐ)', 'Trạng thái',
  ];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.border = BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  headerRow.height = 24;

  let stt = 1;
  let grandTotal = 0;
  let lastInvoiceCode = null;
  let lastInvoiceTotal = 0;

  invoices.forEach(invoice => {
    const details = detailsByInvoice.get(Number(invoice.id)) || [];
    const itemsSummary = details.length > 0
      ? details.map(d => `${d.product_name} x${d.quantity}`).join(', ')
      : '—';
    const total = toMoney(invoice.total ?? invoice.total_amount);
    grandTotal += total;

    // Mỗi hóa đơn 1 dòng (gộp chi tiết sản phẩm vào cột "Sản phẩm")
    const row = sheet.addRow([
      stt,
      formatDateTime(invoice.created_at || invoice.invoice_date || invoice.date),
      invoice.invoice_code || invoice.client_order_id || '',
      itemsSummary,
      details.reduce((sum, d) => sum + toMoney(d.quantity), 0),
      details.length > 0 ? toMoney(details[0].unit_price) : 0,
      details.reduce((sum, d) => sum + toMoney(d.line_total), 0),
      total,
      paymentStatusText(derivePaymentStatus(invoice)),
    ]);

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(5).alignment = { horizontal: 'center' };
    row.getCell(6).numFmt = '#,##0';
    row.getCell(6).alignment = { horizontal: 'right' };
    row.getCell(7).numFmt = '#,##0';
    row.getCell(7).alignment = { horizontal: 'right' };
    row.getCell(8).numFmt = '#,##0';
    row.getCell(8).alignment = { horizontal: 'right' };
    row.getCell(8).font = { bold: true };
    row.getCell(9).alignment = { horizontal: 'center' };
    row.eachCell({ includeEmpty: true }, (cell) => { cell.border = BORDER; });

    stt += 1;
    lastInvoiceCode = invoice.invoice_code || '';
    lastInvoiceTotal = total;
  });

  if (invoices.length === 0) {
    const emptyRow = sheet.addRow(['Không có đơn hàng nào']);
    sheet.mergeCells(`A${emptyRow.number}:I${emptyRow.number}`);
    emptyRow.getCell(1).alignment = { horizontal: 'center' };
    emptyRow.getCell(1).font = { italic: true, color: { argb: 'FF9CA3AF' } };
  }

  // Dòng tổng cộng
  const totalRow = sheet.addRow([
    '', '', '', '', '',
    'Tổng cộng:',
    { formula: `SUM(H5:H${4 + invoices.length})`, result: grandTotal },
    '', '',
  ]);
  totalRow.getCell(6).font = { bold: true };
  totalRow.getCell(6).alignment = { horizontal: 'right' };
  totalRow.getCell(7).numFmt = '#,##0';
  totalRow.getCell(7).font = { bold: true };
  totalRow.getCell(7).alignment = { horizontal: 'right' };
  totalRow.eachCell({ includeEmpty: true }, (cell) => { cell.border = BORDER; });

  sheet.columns = [
    { width: 6 },
    { width: 18 },
    { width: 18 },
    { width: 46 },
    { width: 8 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
    { width: 16 },
  ];

  // Sheet thứ 2: chi tiết từng món hàng của từng hóa đơn
  const detailSheet = workbook.addWorksheet('Chi tiết sản phẩm');
  detailSheet.addRow(['Mã đơn hàng', 'Ngày tạo', 'Tên sản phẩm', 'Mã SKU', 'SL', 'Đơn giá (VNĐ)', 'Thành tiền (VNĐ)']);
  const detailHeader = detailSheet.getRow(1);
  detailHeader.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.border = BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  invoices.forEach(invoice => {
    const details = detailsByInvoice.get(Number(invoice.id)) || [];
    const invoiceDate = formatDateTime(invoice.created_at || invoice.invoice_date || invoice.date);
    const code = invoice.invoice_code || invoice.client_order_id || '';
    details.forEach(detail => {
      const r = detailSheet.addRow([
        code,
        invoiceDate,
        detail.product_name,
        detail.product_sku,
        detail.quantity,
        detail.unit_price,
        detail.line_total,
      ]);
      r.getCell(5).alignment = { horizontal: 'center' };
      r.getCell(6).numFmt = '#,##0';
      r.getCell(7).numFmt = '#,##0';
      r.eachCell({ includeEmpty: true }, (cell) => { cell.border = BORDER; });
    });
  });

  detailSheet.columns = [
    { width: 18 }, { width: 18 }, { width: 34 }, { width: 16 },
    { width: 8 }, { width: 16 }, { width: 18 },
  ];

  // Bỏ qua biến không dùng (giữ cho eslint không báo lỗi)
  void lastInvoiceCode;
  void lastInvoiceTotal;

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Gom đơn hàng theo khách hàng.
 * @param {object} options
 * @param {string[]} options.orderIds - danh sách id/mã đơn cần tải (rỗng = tất cả)
 * @param {string} options.scope - 'all' | 'selected'
 */
function groupOrdersByCustomer(options = {}) {
  const { orderIds = [], scope = 'all' } = options;

  const allDetails = groupDetailsByInvoice();
  const wanted = new Set(orderIds.map(id => String(id)));

  const invoices = getAll('invoices')
    .filter(inv => isInvoiceVisibleInActiveList(inv))
    .filter(inv => {
      if (scope !== 'selected' || wanted.size === 0) return true;
      return wanted.has(String(inv.id))
        || wanted.has(String(inv.invoice_code))
        || wanted.has(String(inv.client_order_id));
    })
    .sort((a, b) => {
      const at = new Date(a.created_at || 0).getTime();
      const bt = new Date(b.created_at || 0).getTime();
      return at - bt;
    });

  const groups = new Map();
  for (const invoice of invoices) {
    const customerId = Number(invoice.customer_id);
    const customer = customerId > 0
      ? getOne('customers', c => Number(c.id) === customerId)
      : null;

    const fallbackName = invoice.customer_name || invoice.receiver_name || 'Khach_Le';
    const key = customerId > 0 ? `customer:${customerId}` : `name:${fallbackName}`;

    if (!groups.has(key)) {
      groups.set(key, {
        customer: customer || { id: customerId || 0, name: fallbackName, phone: invoice.customer_phone || '' },
        customerName: customer?.name || fallbackName,
        phone: customer?.phone || invoice.customer_phone || '',
        invoices: [],
      });
    }
    groups.get(key).invoices.push(invoice);
  }

  return { groups, detailsByInvoice: allDetails };
}

/**
 * Tạo file ZIP chứa 1 tệp Excel cho mỗi khách hàng.
 * @returns {Promise<{buffer: Buffer, fileName: string, customerCount: number, invoiceCount: number}>}
 */
async function buildOrdersZipByCustomer(options = {}) {
  const { groups, detailsByInvoice } = groupOrdersByCustomer(options);

  const zip = new JSZip();
  const usedNames = new Map();
  let invoiceCount = 0;

  const entries = Array.from(groups.values()).sort((a, b) =>
    String(a.customerName).localeCompare(String(b.customerName), 'vi')
  );

  for (const entry of entries) {
    const baseName = sanitizeFileName(entry.customerName);
    const prefix = baseName.toLowerCase().startsWith('khách') ? '' : 'Khách hàng - ';
    const displayName = `${prefix}${baseName}`;
    // Tránh trùng tên khi 2 khách trùng tên -> thêm hậu tố _2, _3...
    const count = usedNames.get(displayName) || 0;
    usedNames.set(displayName, count + 1);
    const fileName = count === 0 ? `${displayName}.xlsx` : `${displayName}_${count + 1}.xlsx`;

    const buffer = await buildCustomerWorkbook(entry.customer, entry.invoices, detailsByInvoice);
    zip.file(fileName, buffer);
    invoiceCount += entry.invoices.length;
  }

  // File hướng dẫn đọc kèm theo
  zip.file('README.txt', [
    'BÁO CÁO ĐƠN HÀNG - BÁN HÀNG POS',
    '================================',
    `Ngày xuất: ${formatDateTime(new Date())}`,
    `Số khách hàng: ${groups.size}`,
    `Tổng số đơn hàng: ${invoiceCount}`,
    '',
    'Mỗi tệp .xlsx tương ứng với 1 khách hàng, tên tệp là tên khách hàng.',
    'Sheet "Đơn hàng" liệt kê toàn bộ đơn, sheet "Chi tiết sản phẩm" liệt kê từng món hàng.',
    '',
  ].join('\n'), { compression: 'DEFLATE' });

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const fileName = `Don_Hang_Theo_Khách_Hàng_${stamp}.zip`;

  return {
    buffer: zipBuffer,
    fileName,
    customerCount: groups.size,
    invoiceCount,
  };
}

function getCustomerOrdersSummary(options = {}) {
  const { groups } = groupOrdersByCustomer(options);
  const list = [];
  const usedNames = new Map();
  for (const entry of groups.values()) {
    const baseName = sanitizeFileName(entry.customerName);
    const prefix = baseName.toLowerCase().startsWith('khách') ? '' : 'Khách hàng - ';
    const displayName = `${prefix}${baseName}`;
    const count = usedNames.get(displayName) || 0;
    usedNames.set(displayName, count + 1);
    const fileName = count === 0 ? `${displayName}.xlsx` : `${displayName}_${count + 1}.xlsx`;

    list.push({
      customerName: entry.customerName,
      phone: entry.phone || '',
      fileName,
      invoiceCount: entry.invoices.length,
      totalAmount: entry.invoices.reduce((sum, inv) => sum + (Number(inv.total ?? inv.total_amount) || 0), 0),
    });
  }
  list.sort((a, b) => b.invoiceCount - a.invoiceCount);
  return {
    customerCount: list.length,
    invoiceCount: list.reduce((sum, item) => sum + item.invoiceCount, 0),
    customers: list,
  };
}

module.exports = {
  buildOrdersZipByCustomer,
  groupOrdersByCustomer,
  getCustomerOrdersSummary,
  sanitizeFileName,
};
