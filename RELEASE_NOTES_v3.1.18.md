# Bán Hàng Pos v3.1.18 - Ghi chú phát hành

**Ngày phát hành:** 26/09/2026

---

### 🚀 Tính năng mới nổi bật

1. **Bot Kho Hàng Telegram - Kiểm kho & Báo cáo tự động:**
   - Thêm nút "Báo cáo Telegram" trực quan tại trang Quản lý Kho Hàng (`/kho-hang`), cho phép xem trước nội dung và gửi báo cáo tồn kho tức thì về nhóm Telegram.
   - Thống kê chi tiết: Tổng dòng tồn kho, tổng số lượng hàng trong kho, tồn kho sản phẩm cha, tồn kho biến thể, số mặt hàng âm kho và số mặt hàng sắp hết.
   - Cảnh báo chi tiết các sản phẩm bị âm kho và sản phẩm còn ít kèm danh sách tên hàng, số lượng và khuyến nghị nhập hàng.
   - Cơ chế chia nhỏ tin nhắn (message chunking) tự động đảm bảo các tin nhắn luôn nằm trong giới hạn an toàn của Telegram (< 3.800 ký tự), không bao giờ bị nghẽn hay lỗi gửi.
   - Hỗ trợ bot lắng nghe và phản hồi trực tiếp các lệnh `/kiemkho`, `/tonkho`, `/kho` từ người dùng trong nhóm chat Telegram.

2. **Cơ chế Fallback thông minh đa Bot Telegram (`resolveBotConfig`):**
   - Chỉ cần người dùng cấu hình 1 token Bot Telegram bất kỳ (hoặc token mặc định), hệ thống sẽ tự động dùng token đó cho tất cả các bot và nghiệp vụ thông báo (Đơn mới, Sửa đơn, Hủy đơn, Nhập hàng, Sản phẩm mới, Kiểm kho, Sổ quỹ, Đăng nhập,...).
   - Người dùng không cần tạo đủ 12 bot riêng biệt nếu chỉ có nhu cầu nhận toàn bộ thông báo về chung 1 nhóm.

3. **Chỉnh sửa Thanh toán & Nợ cũ tức thì trong Xem Chi Tiết Đơn Hàng:**
   - Cho phép điều chỉnh trực tiếp số tiền Nợ Cũ (`old_debt`) và Đã Thu (`paid_amount`) ngay trong màn hình xem chi tiết đơn hàng tại Danh sách đơn hàng.
   - Bổ sung nút bấm nhanh "Trả đủ" để tự động điền toàn bộ số tiền khách cần thanh toán.
   - Các nút "Lưu thanh toán" và "Hoàn tác" an toàn, tự động tính lại Thành tiền cần thanh toán và Tiền thừa theo thời gian thực.
   - Tự động gửi thông báo Telegram chi tiết khi cập nhật trạng thái thanh toán và công nợ.

4. **Nâng cấp nội dung thông báo Telegram chuyên nghiệp:**
   - Tạo đơn mới: Hiển thị đầy đủ danh sách sản phẩm (tên, số lượng, thành tiền), tiền đơn, nợ cũ (+), đã thu và thành tiền cần thanh toán.
   - Danh sách đơn hàng: Icon trạng thái trực quan (🗑️ Hủy đơn, ✅ Thanh toán, 🖨️ In ấn, ✏️ Sửa đơn).
   - Hủy đơn hàng: Thông báo rõ lý do hủy và hoàn trả hàng hóa về kho.
   - In hóa đơn: Tự động gửi thông báo thao tác in nhanh hóa đơn hoặc mở xem/in hóa đơn A5.
   - Đồng bộ thiết bị: Tự động gửi thông báo chi tiết khi đơn hàng tạo từ ứng dụng di động ngoại tuyến được đồng bộ về máy chủ.

5. **Hoàn thiện in ấn hóa đơn A5:**
   - Cải tiến tính năng kết xuất và in ấn hóa đơn A5, tối ưu bố cục và lề in sắc nét, không bị tràn trang.

---
