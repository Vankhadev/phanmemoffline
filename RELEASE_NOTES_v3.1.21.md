# Bán Hàng Pos v3.1.21 - Ghi chú phát hành

**Ngày phát hành:** 13/10/2026

---

### 🚀 Điểm nổi bật & Cải tiến

1. **Khắc phục lỗi mất nút Thanh toán tại Danh sách đơn hàng (`OrderList.jsx`):**
   - Đơn hàng chưa thanh toán hoặc thanh toán một phần luôn hiển thị đầy đủ 6 nút thao tác: **Xem**, **Sửa**, **In A5**, **In nhanh**, **Thanh toán**, **Hủy**.
   - Sau khi bấm xác nhận thanh toán (đơn đã thu đủ tiền), nút **Thanh toán** tự động ẩn đi, giữ lại 5 nút thao tác tiêu chuẩn.
   - Hoạt động đồng bộ, mượt mà trên cả giao diện bảng máy tính và giao diện thẻ trên di động/máy tính bảng.

2. **Chuẩn hóa trạng thái đơn hàng khi tạo mới (`invoiceCreationService.js`, `CreateOrder.jsx`):**
   - Đơn hàng mới tạo khi chưa thu tiền được gán đúng trạng thái `pending` (Chờ xác nhận), xuất hiện chính xác ở tab **Chờ xác nhận** với nút Thanh toán sẵn sàng.
   - Cập nhật API xác nhận đơn hàng (`/api/invoices/:id/confirm`) cho phép thu tiền và hoàn tất đơn an toàn.

---
