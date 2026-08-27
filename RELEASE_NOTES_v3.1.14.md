# Bán Hàng Pos v3.1.14

## Thống kê doanh thu

- Biểu đồ doanh thu dạng cột theo từng ngày.
- Dữ liệu biểu đồ được tổng hợp trực tiếp từ hóa đơn, không phụ thuộc riêng vào bảng thống kê cũ.
- Tooltip hiển thị doanh thu và số đơn của từng ngày.
- Loại trừ đơn đã hủy.

## Top khách hàng

- Sửa tính số đơn và doanh thu cho khách hàng khi hóa đơn thiếu `customer_id` nhưng có tên khách.
- Hỗ trợ dữ liệu `total` và `total_amount`.

## Giao diện

- Bỏ khối Truy cập nhanh khỏi Trang chủ và hướng dẫn Trang chủ.
- Mẫu hóa đơn hỗ trợ bật/tắt riêng từng dòng tổng tiền, công nợ, thanh toán và tiền thừa.

## Kiểm tra

- Frontend build thành công bằng Vite.
- Backend kiểm tra cú pháp thành công.
