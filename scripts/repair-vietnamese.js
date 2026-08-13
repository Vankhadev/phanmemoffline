const fs = require('fs');
const path = require('path');
const pairs = [
  ...JSON.parse(fs.readFileSync(path.join(__dirname, 'vi-repairs.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(__dirname, 'vi-repairs-single.json'), 'utf8')),
  // Common fragments missing from the historical repair dictionaries.
  ...[
    ['?m', 'âm'], ['?n', 'đơn'], ['?on', 'đơn'], ['?on', 'Đơn'], ['?i', 'đi'], ['?i?n', 'điện'], ['?i?u', 'điều'],
    ['?a', 'đã'], ['?ang', 'đang'], ['?at', 'đặt'], ['?au', 'đầu'], ['?ay', 'đây'], ['?u', 'đủ'], ['?u?c', 'được'],
    ['b?n', 'bản'], ['b?n', 'bạn'], ['b?i', 'bởi'], ['b?o', 'bảo'], ['b?ng', 'bằng'], ['b?m', 'bấm'], ['b?n', 'bán'],
    ['c?n', 'cần'], ['c?ng', 'cộng'], ['c?u', 'cấu'], ['c?a', 'của'], ['c? th?', 'có thể'], ['c?ng', 'cũng'], ['c?i', 'cái'],
    ['ch?a', 'chưa'], ['ch?c', 'chức'], ['ch?nh', 'chính'], ['ch?n', 'chọn'], ['ch?y', 'chạy'], ['ch?u', 'chịu'], ['ch?ng', 'chứng'],
    ['d?c', 'đọc'], ['d?ng', 'dùng'], ['d?ng', 'đúng'], ['d?i', 'dài'], ['d?u', 'đầu'], ['d?y', 'đầy'], ['d?ng', 'dòng'],
    ['g?n', 'gần'], ['g?i', 'gọi'], ['g?m', 'gồm'], ['g?i', 'gửi'], ['g?c', 'gốc'], ['g?i', 'gói'],
    ['h?ng', 'hàng'], ['h?t', 'hết'], ['h?y', 'hủy'], ['h?n', 'hạn'], ['h?p', 'hợp'], ['h?i', 'hỏi'], ['h? tr?', 'hỗ trợ'], ['h?u', 'hầu'],
    ['k?', 'kỳ'], ['k?o', 'kéo'], ['k?o', 'kiểu'], ['k?ch', 'kích'], ['k?t', 'kết'], ['k?m', 'kiểm'], ['k?o', 'kho'], ['k?c', 'khác'],
    ['l?i', 'lỗi'], ['l?c', 'lọc'], ['l?u', 'lưu'], ['l?n', 'lớn'], ['l?m', 'làm'], ['l?y', 'lấy'], ['l?i', 'loại'], ['l?c', 'lúc'],
    ['m?', 'mã'], ['m?u', 'mẫu'], ['m?c', 'mức'], ['m?i', 'mới'], ['m?ng', 'mạng'], ['m?o', 'mẹo'], ['m? r?ng', 'mở rộng'],
    ['n?i', 'nội'], ['n?p', 'nộp'], ['n?u', 'nếu'], ['n?m', 'năm'], ['n?i', 'nơi'], ['n?o', 'nào'], ['n?ng', 'nặng'],
    ['ng?y', 'ngày'], ['ng??i', 'người'], ['ngu?i', 'người'], ['ngu?n', 'nguồn'], ['ngu?ng', 'ngưỡng'], ['ng?n', 'ngân'],
    ['nh?p', 'nhập'], ['nh?m', 'nhóm'], ['nh? cung cấp', 'nhà cung cấp'], ['nh?ng', 'những'], ['nh?n', 'nhân'], ['nh?ng', 'nhưng'], ['nh?i', 'nhiều'],
    ['ph?i', 'phải'], ['ph?m', 'phạm'], ['ph?n', 'phần'], ['ph?i', 'phí'], ['ph?c', 'phục'], ['ph?ng', 'phòng'], ['ph?i', 'phối'], ['ph?n', 'phân'],
    ['qu?n', 'quản'], ['qu?y', 'quỹ'], ['qu?n', 'quận'], ['qu?n', 'quyền'], ['qu? tr?nh', 'quá trình'], ['qu?ng', 'quảng'],
    ['s?n', 'sản'], ['s?ng', 'sống'], ['s?p', 'sắp'], ['s? du', 'số dư'], ['s? l??ng', 'số lượng'], ['s? li?u', 'số liệu'], ['s?ng', 'sử dụng'],
    ['t?n', 'tên'], ['t?n', 'tồn'], ['t?i', 'tải'], ['t?o', 'tạo'], ['t?y', 'tùy'], ['t?i', 'tối'], ['t?ng', 'tổng'], ['t?nh', 'tính'], ['t?m', 'tạm'],
    ['th?i', 'thời'], ['th?ng', 'tháng'], ['th?c', 'thực'], ['th?nh', 'thành'], ['th?m', 'thêm'], ['th?u', 'thiếu'], ['th?ng', 'thông'], ['th?y', 'thấy'],
    ['tr?ng', 'trống'], ['tr?ng', 'trạng'], ['tr?c', 'trước'], ['tr?n', 'trên'], ['tr? l?i', 'trở lại'], ['tr?c ti?p', 'trực tiếp'], ['tr?nh', 'trình'],
    ['v?', 'về'], ['v?i', 'với'], ['v?n', 'vẫn'], ['v?ng', 'vùng'], ['v?n', 'vận'], ['v?c', 'vực'], ['v?i', 'vui'], ['v?n', 'vốn'],
    ['x?y', 'xảy'], ['x?c', 'xác'], ['x?u', 'xuất'], ['x? lý', 'xử lý'], ['x?i', 'xóa'],
    ['gi?', 'giá'], ['gi?y', 'giấy'], ['gi?i', 'giới'], ['gi?m', 'giảm'], ['gi? tr?', 'giá trị'], ['gi?i h?n', 'giới hạn'],
    ['thu?', 'thuế'], ['ti?n', 'tiền'], ['ti?p', 'tiếp'], ['t? kh?a', 'từ khóa'], ['t? ng?y', 'từ ngày'], ['t?i đa', 'tối đa'],
    ['H?A ?ON', 'HÓA ĐƠN'], ['B?N H?NG', 'BÁN HÀNG'], ['T?NG C?NG', 'TỔNG CỘNG'], ['L?I NHU?N', 'LỢI NHUẬN'],
    ['�m', 'âm'], ['ph�p', 'phép'], ['\u0010ang', 'Đang'], ['\u0011?','đã'], ['\u0014', '—'],
  ],
];
pairs.sort((a, b) => String(b[0]).length - String(a[0]).length);
const ROOT = path.join(__dirname, '..', 'frontend', 'src');
const exts = new Set(['.js', '.jsx', '.ts', '.tsx', '.html', '.css']);
function walk(dir, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, files);
    else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) files.push(full);
  }
  return files;
}
const isWordChar = (c) => /[A-Za-z0-9_]/.test(c);
const looksLikeJsIdentifier = (tok) => /^[A-Za-z]+\?[A-Za-z]+$/.test(tok);
let totalFiles = 0, totalReplacements = 0;
const report = [];
for (const file of walk(ROOT)) {
  let text = fs.readFileSync(file, 'utf8');
  let fileCount = 0;
  for (const [bad, good] of pairs) {
    if (!bad || !good || bad === good) continue;
    if (!text.includes(bad)) continue;
    if (looksLikeJsIdentifier(bad)) continue;
    let out = '';
    let i = 0;
    while ((i = text.indexOf(bad, i)) !== -1) {
      const qIdx = bad.indexOf('?');
      const charAfterQuestionInText = text[i + qIdx + 1] || '';
      const afterBadChar = text[i + bad.length] || '';
      if (charAfterQuestionInText === '.' || charAfterQuestionInText === '(') {
        out += text.slice(0, i + bad.length); text = text.slice(i + bad.length); i = 0; continue;
      }
      const before = i > 0 ? text[i - 1] : '';
      if (isWordChar(before) && isWordChar(afterBadChar)) {
        out += text.slice(0, i + bad.length); text = text.slice(i + bad.length); i = 0; continue;
      }
      out += text.slice(0, i) + good; text = text.slice(i + bad.length); i = 0; fileCount++;
    }
    text = out + text;
  }
  if (fileCount > 0) {
    fs.writeFileSync(file, text, 'utf8');
    totalFiles++; totalReplacements += fileCount;
    report.push(`${path.relative(ROOT, file)}: ${fileCount}`);
  }
}
console.log(`=== repair-vietnamese.js ===\nFiles modified: ${totalFiles}\nTotal replacements: ${totalReplacements}`);
fs.writeFileSync(path.join(__dirname, 'repair-vietnamese-report.txt'), report.join('\n') + '\n', 'utf8');
