# Bán Hàng Pos v3.1.20 - Ghi chú phát hành

**Ngày phát hành:** 10/10/2026

---

### 🚀 Tính năng mới nổi bật

1. **Bộ lọc thời gian nhanh cho Báo cáo Kế toán tổng hợp (`AccountingDashboard.jsx`):**
   - Bổ sung thanh nút chọn nhanh khoảng thời gian: **Hôm nay**, **Tuần này**, **Từ đầu tháng**, **Cả tháng này**, **Tháng trước** và **Tùy chỉnh**.
   - Khách hàng không cần phải chọn ngày thủ công từng ô khi muốn xem nhanh doanh số và lợi nhuận trong ngày hoặc tháng này.
   - Tối ưu giao diện hiển thị trên các màn hình nhỏ, di động và máy POS cảm ứng.

2. **Linh hoạt nghiệp vụ Công nợ bán hàng (`CreateOrder.jsx`):**
   - Không tự động bắt buộc cộng dồn nợ cũ vào tiền cần thanh toán của đơn hàng mới. Chủ cửa hàng có thể xem thông tin nợ cũ và tự quyết định nhập số tiền nợ cũ muốn thu cùng đơn, hoặc thu riêng rẽ.
   - Hiển thị thông báo hướng dẫn rõ ràng, trực quan.

3. **Tối ưu hóa hệ thống & Ổn định hóa đơn bán hàng:**
   - Hoàn thiện xử lý trạng thái hóa đơn (`pending`, `cho_thanh_toan`, `completed`) đồng bộ giữa SQLite và JSON database.
   - Sửa lỗi tham chiếu trong danh sách hóa đơn, đảm bảo hiển thị mượt mà và chính xác tuyệt đối.

---
