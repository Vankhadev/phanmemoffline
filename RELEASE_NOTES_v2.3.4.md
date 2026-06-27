# Version 2.3.4

## v2.3.4 - 2026-06-27

* Sửa lỗi Electron production không khởi động được backend nội bộ.
* Sửa lỗi health check backend ECONNREFUSED 127.0.0.1:7000.
* Đảm bảo backend được đóng gói đúng trong installer.
* Thêm log backend production để dễ kiểm tra lỗi (userData/logs/backend.log).
* Giữ auto-update tắt trong môi trường dev/localhost.
* Giữ lại các chức năng đã khôi phục: login, register, sản phẩm, đơn hàng, dịch vụ khác, mẫu in hóa đơn, báo cáo.

### Đã test trước khi release
1. Frontend build thành công.
2. Backend dev: port 7000 healthy, không EADDRINUSE, không crash.
3. Auto-update tắt trong dev/localhost.
4. Bản cài thật: backend tự start port 7000, login form hiện, đăng nhập được.