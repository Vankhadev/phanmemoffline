const ExcelJS = require('exceljs');
const { PassThrough } = require('stream');
const {
  getAll,
  getOne,
  isCancelledInvoiceStatus,
  isInvoiceVisibleInActiveList,
} = require('../db/database');

function parseInvoiceDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseLocalDateBoundary(value, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/**
 * Xuất báo cáo đơn hàng (công nợ) của khách hàng theo khoảng thời gian ra Excel (dạng stream)
 * @param {number|string} customerId
 * @param {string} fromDate - định dạng YYYY-MM-DD
 * @param {string} toDate - định dạng YYYY-MM-DD
 * @returns {Readable} PassThrough stream
 */
function exportCustomerDebtReport(customerId, fromDate, toDate) {
  const stream = new PassThrough();

  process.nextTick(async () => {
    try {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: stream,
        useStyles: true,
        useSharedStrings: true,
      });

      const worksheet = workbook.addWorksheet('Báo cáo công nợ');

      // 1. Lấy thông tin khách hàng
      const customer = getOne('customers', c => Number(c.id) === Number(customerId) && c.active !== 0);
      const customerName = customer ? (customer.name || '') : 'Khách hàng';

      // 2. Lấy danh sách hóa đơn trong kỳ lọc
      const fromBoundary = parseLocalDateBoundary(fromDate, false);
      const toBoundary = parseLocalDateBoundary(toDate, true);

      const invoices = getAll('invoices')
        .filter(inv => isInvoiceVisibleInActiveList(inv))
        .filter(inv => Number(inv.customer_id) === Number(customerId))
        .filter(inv => !isCancelledInvoiceStatus(inv.status))
        .filter(inv => {
          const createdAt = parseInvoiceDate(inv.created_at);
          return createdAt && createdAt >= fromBoundary && createdAt <= toBoundary;
        })
        .sort((a, b) => parseInvoiceDate(a.created_at) - parseInvoiceDate(b.created_at));

      // Thiết lập style viền ô
      const borderStyle = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };

      const defaultFont = { name: 'Times New Roman', size: 12 };
      const boldFont = { name: 'Times New Roman', size: 12, bold: true };
      const italicFont = { name: 'Times New Roman', size: 12, italic: true };

      // Dòng 1: Tên khách hàng: [Tên khách hàng]
      const titleRow = worksheet.addRow([`Tên khách hàng: ${customerName}`]);
      titleRow.getCell(1).font = boldFont;
      titleRow.commit();

      // Dòng 2: Dòng trống
      const blankRow = worksheet.addRow([]);
      blankRow.commit();

      // Dòng 3: Tiêu đề cột
      const headers = ['STT', 'Thời gian', 'Hóa đơn', 'Tiền còn phải trả'];
      const headerRow = worksheet.addRow(headers);
      headerRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = boldFont;
        cell.border = borderStyle;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      headerRow.commit();

      // Theo dõi độ rộng các cột (khởi tạo từ độ dài header, bắt đầu từ dòng 3 trở đi)
      const colWidths = [8, 15, 15, 20];

      if (invoices.length === 0) {
        // Dòng 4: Không có dữ liệu
        const noDataRow = worksheet.addRow(['Không có dữ liệu trong khoảng thời gian đã chọn']);
        worksheet.mergeCells('A4:D4');
        noDataRow.getCell(1).font = italicFont;
        noDataRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        for (let i = 1; i <= 4; i++) {
          noDataRow.getCell(i).border = borderStyle;
        }
        noDataRow.commit();
      } else {
        let stt = 1;
        let totalAmount = 0;

        for (const invoice of invoices) {
          const rawDate = parseInvoiceDate(invoice.created_at);
          const dateVal = rawDate ? new Date(rawDate) : '';
          const remAmt = Number(invoice.remaining_amount) || 0;
          totalAmount += remAmt;

          const rowData = [
            stt,
            dateVal,
            invoice.invoice_code || '',
            remAmt,
          ];

          const r = worksheet.addRow(rowData);
          r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
          r.getCell(2).numFmt = 'dd/mm/yyyy';
          r.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
          r.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
          r.getCell(4).numFmt = '#,##0';
          r.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };

          r.eachCell({ includeEmpty: true }, (cell) => {
            cell.font = defaultFont;
            cell.border = borderStyle;
          });
          r.commit();

          // Cập nhật độ rộng tối ưu (không lấy ô tiêu đề dòng 1)
          colWidths[0] = Math.max(colWidths[0], String(stt).length + 4);
          colWidths[1] = Math.max(colWidths[1], 14); // dd/mm/yyyy
          colWidths[2] = Math.max(colWidths[2], String(invoice.invoice_code || '').length + 4);
          colWidths[3] = Math.max(colWidths[3], remAmt.toLocaleString('vi-VN').length + 5);

          stt++;
        }

        // Dòng tổng cộng
        const lastRowIndex = 3 + invoices.length; // Headers ở dòng 3
        const totalRow = worksheet.addRow([
          '',
          '',
          'Tổng cộng:',
          { formula: `SUM(D4:D${lastRowIndex})`, result: totalAmount },
        ]);

        totalRow.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
        totalRow.getCell(4).numFmt = '#,##0';
        totalRow.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };

        totalRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.font = boldFont;
          cell.border = borderStyle;
        });
        totalRow.commit();

        colWidths[3] = Math.max(colWidths[3], totalAmount.toLocaleString('vi-VN').length + 5);
      }

      // Cấu hình chiều rộng cột tự động
      worksheet.columns = colWidths.map(w => ({ width: w }));

      await worksheet.commit();
      await workbook.commit();
    } catch (err) {
      stream.destroy(err);
    }
  });

  return stream;
}

module.exports = {
  exportCustomerDebtReport,
};
