# Bán Hàng Pos v3.1.24 - Ghi chú phát hành

**Ngày phát hành:** 22/11/2026

---

### 🚀 Điểm nổi bật & Cải tiến

1. **Tải đơn hàng về ổ đĩa tự động phân loại theo từng khách hàng (`orderDownloadService.js`, `DownloadOrdersModal.jsx`, `OrderList.jsx`, `invoices.js`):**
   - **Nút "Tải đơn hàng" chuyên dụng tại Danh sách hóa đơn**: Bổ sung nút hành động nhanh giúp chủ cửa hàng tải và lưu trữ toàn bộ hóa đơn bán hàng về máy tính.
   - **Tự động tách riêng 1 file Excel cho từng khách hàng**: Tên file tự động chuẩn hóa theo tên khách hàng (vd: `Nguyen_Van_A.xlsx`), chứa thông tin tổng hợp hóa đơn và bảng chi tiết từng mặt hàng kèm số lượng, đơn giá, chiết khấu và thành tiền.
   - **Hỗ trợ 2 phương thức lưu tiện lợi**:
     + *Lưu trực tiếp vào thư mục*: Chọn thư mục trên máy tính qua File System Access API, hệ thống tự động giải nén và ghi từng file Excel vào thư mục đã chọn.
     + *Tải về gói nén ZIP*: Đóng gói toàn bộ file Excel của từng khách hàng vào 1 file ZIP duy nhất.
   - **Lựa chọn phạm vi linh hoạt**: Tải toàn bộ đơn hàng hiển thị hoặc chỉ tải các đơn hàng được đánh dấu chọn.

2. **Hệ thống Redis & In-Memory Cache hiệu năng cao (`redisCacheService.js`, `server.js`):**
   - **Bộ đệm thông minh**: Tối ưu tốc độ tải dữ liệu cho các màn hình có tần suất truy xuất cao: Danh sách khách hàng, Quản lý sản phẩm, Hóa đơn và Báo cáo thống kê.
   - **Tự động dự phòng RAM (Auto In-Memory Fallback)**: Hoàn toàn không phụ thuộc dịch vụ bên ngoài; khi máy tính không cài hoặc tắt Redis, hệ thống tự động chuyển sang bộ nhớ đệm RAM trong Node.js (tối đa 5000 mục, tự dọn dẹp theo TTL), đảm bảo phần mềm OFFLINE vận hành ổn định 100%.
   - **Làm mới dữ liệu tức thì (Cache Invalidation)**: Khi có thao tác thêm mới, chỉnh sửa hoặc xóa đơn hàng, sản phẩm, khách hàng, nhập kho... bộ nhớ đệm tự động được xóa và làm mới ngay lập tức.
   - **Công cụ quản trị cache**: Cung cấp API kiểm tra trạng thái cache và xóa thủ công `/api/cache/status`, `/api/cache/clear`.

3. **Tối ưu hóa kết nối di động & mạng nội bộ LAN (`QuickMobileConnectModal.jsx`, `apiClient.js`, `mobileAppRuntime.js`):**
   - **Tự động nhận diện IP LAN**: Khi truy cập từ điện thoại/tablet qua mạng WiFi nội bộ (`192.168.x.x`), trình duyệt tự động dùng IP máy chủ thực tế, loại bỏ hoàn toàn hiện tượng kẹt địa chỉ loopback 127.0.0.1.
   - **Nâng cấp mã QR kết nối nhanh**: Hộp thoại kết nối mobile hiển thị mã QR đồng bộ IP LAN chuẩn xác, giao diện hướng dẫn trực quan, dễ kết nối.
   - **Đồng bộ phiên bản v3.1.24**: Cập nhật số hiệu phiên bản đồng bộ từ root package, frontend, backend đến màn hình Cài đặt (`Settings.jsx`).

---
