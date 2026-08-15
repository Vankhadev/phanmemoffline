# Bán Hàng Pos v3.1.6

## Sửa lỗi tạo đơn hàng

- Sửa lỗi sản phẩm đang có trong kho nhưng bị báo “không tồn tại trong hệ thống” khi lưu đơn.
- Nguyên nhân là cache tìm kiếm sản phẩm tạm thời bị làm mới sau khi chọn hàng, khiến frontend chặn sai trước khi gửi đơn.
- Đơn hàng hiện luôn gửi `product_id`/`variant_id` đã chọn đến backend để backend kiểm tra trực tiếp với database và tồn kho thực tế.
- Áp dụng cho tạo đơn mới và lưu chỉnh sửa đơn; không thay đổi, xóa hoặc chuyển đổi dữ liệu sản phẩm/đơn hàng hiện có.

## An toàn cập nhật

- Bản cập nhật tiếp tục tạo backup kiểm chứng trước thao tác quan trọng.
- Dữ liệu runtime, database, journal, backup và credential cục bộ không nằm trong bộ cài hoặc gói cập nhật.
