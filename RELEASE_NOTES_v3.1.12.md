# Bán Hàng Pos v3.1.12

## Sửa báo cáo thống kê

- Báo cáo ưu tiên lấy tên khách hàng từ `customer_id` liên kết với danh sách khách hàng.
- Bổ sung fallback cho các trường tên khách hàng đã có trong dữ liệu đơn hàng.
- Hiển thị số điện thoại khách hàng trong chi tiết đơn nếu có.
- Giảm trường hợp đơn hàng hợp lệ bị hiển thị nhầm là `Khách lẻ`.

## Lưu ý dữ liệu

- Các đơn cũ không lưu `customer_id` hoặc tên khách hàng cần mở sửa đơn, chọn lại khách hàng và cập nhật để liên kết được khôi phục.

## Kiểm tra

- Frontend và backend được kiểm tra trước khi phát hành.
