# Bán Hàng Pos v3.1.5

## Bảo vệ dữ liệu

- Bổ sung Data Guardian Admission Tool cho khôi phục database: backup phải có manifest, checksum SHA-256 và vượt kiểm tra integrity trước khi được dùng.
- Backup có điểm an toàn từ 70/100 trở lên mới được duyệt; backup không xác minh được bị cách ly metadata và không thể ghi đè dữ liệu.
- Khôi phục yêu cầu xác thực cục bộ một lần dùng, kiểm tra lại checksum ngay trước restore và tạo recovery point đã xác minh trước khi thực hiện.
- Snapshot realtime lưu đầy đủ dữ liệu liên quan đến bán hàng, kho, thanh toán, công nợ và audit; snapshot có checksum/manifest.
- Tăng độ bền ghi database bằng staged validation và flush dữ liệu trước khi thay thế file chính.
- Backup trước bảo trì/cập nhật được bắt buộc tạo mới và kiểm tra lại; update bị chặn nếu backup pre-update không hợp lệ.

## Ổn định nghiệp vụ

- Sửa đồng bộ tồn kho combo khi tạo, sửa và hủy đơn.
- Hóa đơn cũ dùng snapshot dòng hàng khi in, tránh hiển thị nhầm sản phẩm sau khi danh mục thay đổi.
- Đơn hủy được giữ lại để tra cứu và phục hồi, không tự biến mất theo thời gian.
- Tối ưu frontend bằng tải trang theo yêu cầu, giảm bundle khởi động.

## Lưu ý quản trị

- Data Guardian yêu cầu cấu hình mã cục bộ tối thiểu 12 ký tự qua biến môi trường `KHA_GUARDIAN_LOCAL_CODE` để cho phép khôi phục dữ liệu đã được duyệt.
