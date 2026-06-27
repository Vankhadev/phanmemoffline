# Version 2.3.5

## v2.3.5 - 2026-06-27

* Sửa lỗi nghiêm trọng: sửa giá sản phẩm trong đơn hàng không lưu vĩnh viễn.
* Giá đơn hàng sau khi sửa được lưu vào invoice_details.unit_price, không lấy lại từ giá hiện tại của sản phẩm trong kho.
* Sau khi bấm Lưu, hệ thống gọi lại API chi tiết đơn hàng để xác minh giá đã cập nhật thật trong database.
* Nếu database chưa trả đúng giá mới, hệ thống báo: "Lưu thất bại: giá đơn hàng chưa được cập nhật vào database".
* Tổng tiền, công nợ và lợi nhuận được tính lại theo giá mới.
* Giữ hoạt động bình thường cho dịch vụ khác và sản phẩm không có trong kho.

### Đã test trước khi release
1. Tạo đơn giá 95.000, sửa xuống 90.000, reload vẫn hiển thị 90.000.
2. Sửa tiếp lên 100.000, reload vẫn hiển thị 100.000.
3. Kiểm tra trực tiếp database: invoice_details.unit_price đúng giá mới.
4. Dịch vụ khác và sản phẩm ngoài kho vẫn lưu giá đúng.
5. Frontend build thành công; backend syntax check thành công.