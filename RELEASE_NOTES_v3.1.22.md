# Bán Hàng Pos v3.1.22 - Ghi chú phát hành

**Ngày phát hành:** 13/10/2026

---

### 🚀 Điểm nổi bật & Cải tiến

1. **Thanh tab và cảnh báo giá nhập tăng tại Quản lý sản phẩm (`Products.jsx`):**
   - Thêm thanh tab trạng thái trên cùng: **Tất cả**, **⚠️ Giá nhập tăng** (màu cam nổi bật kèm số lượng), **Còn hàng**, **Hết hàng**, **Âm kho**.
   - Khi bấm tab **⚠️ Giá nhập tăng**, hệ thống lọc riêng các sản phẩm/biến thể có giá nhập tăng và tự động bung các biến thể con bị tăng giá.
   - Hiển thị huy hiệu trực quan cạnh tên sản phẩm: `⚠️ Giá nhập tăng (giá cũ ➔ giá mới)` hoặc `X biến thể tăng giá nhập`.
   - Cột **Giá nhập** hiển thị mũi tên đỏ `▲` và giá nhập cũ gạch ngang để chủ cửa hàng dễ dàng so sánh biến động chi phí.
   - Thêm nút hành động nhanh **✓ Đã chỉnh giá** ngay trên từng dòng sản phẩm và biến thể để tắt cảnh báo tức thì khi đã điều chỉnh xong giá bán.
   - Hiển thị khung cảnh báo chi tiết và checkbox `Đã cập nhật lại giá bán (Tắt cảnh báo giá tăng sau khi lưu)` trong cả form Sửa sản phẩm và Sửa biến thể.

2. **Tự động bắt tăng giá nhập từ Nhập hàng & Import Excel (`imports.js`, `excelImportService.js`):**
   - Tự động so sánh giá nhập mới với giá nhập cũ: Nếu phát hiện giá nhập mới cao hơn giá vốn trước đó, tự động lưu `prev_import_price` và bật cờ cảnh báo `import_price_increased`.
   - Cung cấp API `POST /api/products/:id/dismiss-price-alert` để tắt cảnh báo an toàn.
   - Tích hợp đồng bộ đầy đủ qua `sync.js`.

---
