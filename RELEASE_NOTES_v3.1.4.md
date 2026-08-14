# Bán Hàng Pos v3.1.4

## Tạo đơn hàng

- Nút `Chọn nhanh` và `Thêm sản phẩm` tải toàn bộ sản phẩm đang có để lên đơn.
- Danh sách chọn nhanh chỉ gồm sản phẩm có thể bán: biến thể của sản phẩm cha có biến thể, hoặc sản phẩm cha không có biến thể.
- Không hiển thị đồng thời sản phẩm cha và các biến thể, tránh chọn nhầm hoặc lưu ID không đúng.
- Ô tìm kiếm vẫn dùng gợi ý/tìm kiếm sản phẩm cũ theo tên, SKU, mã vạch và tên sản phẩm cha.
- Dòng được chọn luôn dùng ID sản phẩm hoặc biến thể thực có trong database, tránh báo sản phẩm không tồn tại khi lưu.

## An toàn dữ liệu

- Không thay đổi dữ liệu, tồn kho, tài khoản, mật khẩu hoặc các logic nghiệp vụ khác.
