# Bán Hàng Pos v3.1.7

## Tìm kiếm sản phẩm và lên đơn

- Tìm sản phẩm theo tên cha, tên biến thể, kích thước, màu sắc, SKU, barcode và thuộc tính.
- Tìm tên sản phẩm cha sẽ hiển thị các biến thể con có thể bán.
- Chuẩn hóa cách nhập kích thước/trọng lượng như `25cm`, `2t5` và `2 t 5`.
- Khi sửa đơn, cho phép cập nhật số tiền khách đã thanh toán và tự tính công nợ còn lại.
- Ô tiền thanh toán tự định dạng dấu chấm hàng nghìn, ví dụ `3000000` hiển thị `3.000.000`.

## Giao diện và ổn định

- Thêm nút hamburger để đóng/mở menu desktop.
- Chỉ kết nối đồng bộ realtime sau khi đăng nhập thành công, tránh vòng lặp `401` ở màn hình login.
- Giữ nguyên dữ liệu runtime, database, backup và thông tin đăng nhập cục bộ ngoài bộ cài.
