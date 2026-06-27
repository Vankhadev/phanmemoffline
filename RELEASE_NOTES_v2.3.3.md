# Version 2.3.3

## v2.3.3 - 2026-06-27

- Sửa lỗi Electron production không khởi động được backend nội bộ (ECONNREFUSED 127.0.0.1:7000).
- Sửa health check backend production.
- Ghi log backend khi khởi động ra userData/logs/backend.log.
- Đảm bảo backend được đóng gói đúng trong installer; đường dẫn KHA_DB_PATH có quyền cao nhất (không để config.json cũ override).
- Hiển thị màn hình "Đang khởi động backend nội bộ..." thay vì trắng màn hình.
- Tăng timeout health check backend lên 30 giây.
- Giữ nguyên dữ liệu và chức năng hiện có (login/register, sản phẩm, đơn hàng, báo cáo, mẫu in hóa đơn, in silent, Data Guardian).
- Không reset database, không xóa dữ liệu.

### Nguyên nhân gốc (đã sửa)
config.json cũ trỏ DB tới backup ở ổ E:\, lấn ưu tiên KHA_DB_PATH do Electron set. Khi backup đó rỗng/thiếu, backend tự quét toàn bộ ổ C:\D:\E:\F:\ parse JSON lớn -> không kịp mở port 7000 -> ECONNREFUSED. Đã sửa resolveDBPath() ưu tiên env, bỏ deep scan khi khởi động ở chế độ Electron production.

### Log khi gặp lỗi
- Backend: `%APPDATA%\Bán Hàng Pos\logs\backend.log`
- Electron: `%APPDATA%\Bán Hàng Pos\logs\electron.log`