# Bán Hàng Pos v3.1.1

## Cập nhật chính

- Sửa luồng thêm dịch vụ khác trong đơn hàng: không kiểm tra tồn kho cho dịch vụ, giữ đúng giá đã nhập và không gộp trùng dòng dịch vụ.
- Tối ưu trang tạo đơn: tìm sản phẩm theo yêu cầu, không tải toàn bộ danh mục khi mở trang.
- Sửa khởi động localhost: giới hạn thời gian chờ khôi phục phiên để không quay vô hạn khi backend chậm hoặc vừa khởi động lại.
- Cập nhật giao diện khối thanh toán và nhãn giá vốn/lợi nhuận.
- Thêm MCP chỉ đọc, dùng API có xác thực và không truy cập trực tiếp database.
- Thêm tool Python `scripts/toophanmem.py` để giám sát dữ liệu đơn hàng, sản phẩm, khách hàng, sổ quỹ và phát hiện chênh lệch số lượng hóa đơn.

## An toàn dữ liệu

- Tool giám sát chỉ báo cáo mặc định; không tự ghi đè database khi phát hiện thiếu hóa đơn.
- Khôi phục hoặc sửa encoding cần cờ xác nhận và tạo bản rollback trước khi ghi dữ liệu.
- Bộ cài không kèm database, backup, token phiên, journal hay log runtime.
