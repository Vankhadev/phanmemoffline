# Bán Hàng Pos v3.1.23 - Ghi chú phát hành

**Ngày phát hành:** 13/10/2026

---

### 🚀 Điểm nổi bật & Cải tiến

1. **Cảnh báo giá nhập cao hơn giá bán (bán lỗ) tại Quản lý sản phẩm (`Products.jsx`, `products.js`):**
   - **Tab lọc nhanh chuyên biệt `[ ⚠️ Giá nhập > Giá bán ]`**: Cho phép chủ cửa hàng lọc ngay các sản phẩm hoặc biến thể đang có giá bán thấp hơn giá vốn (ví dụ: nhập 200.000 ₫ nhưng bán 195.000 ₫).
   - **Tự động mở rộng danh sách biến thể con**: Khi chọn tab cảnh báo, hệ thống tự động bung các biến thể vi phạm để người dùng nhìn thấy ngay mà không cần bấm thủ công.
   - **Huy hiệu trực quan cạnh tên sản phẩm**: Hiển thị nhãn đỏ `⚠️ Giá nhập > Giá bán (Nhập X > Bán Y)` hoặc `[X] biến thể giá nhập > giá bán`.
   - **Đánh dấu đỏ nổi bật trên bảng dữ liệu**: Các cột giá bán bị thấp hơn giá nhập (Giá lẻ, Giá sỉ, Giá VIP) được tô nền đỏ viền đỏ kèm icon `⚠️` để nhận diện tức thì.
   - **Cảnh báo thời gian thực trong Form**: Hiển thị banner cảnh báo bán lỗ ngay khi mở hoặc chỉnh sửa trong hộp thoại Thêm/Sửa sản phẩm và Thêm/Sửa biến thể. Tự động biến mất ngay khi giá bán được chỉnh cao hơn giá vốn.

2. **Cập nhật & Chuẩn hóa thông tin cập nhật ứng dụng (`Settings.jsx`):**
   - Cập nhật số hiệu phiên bản bộ cài thủ công lên `v3.1.23` đồng bộ với hệ thống GitHub Releases.
   - Đảm bảo đường dẫn tải bộ cài 64-bit và 32-bit luôn trỏ về bản phát hành mới nhất.

---
