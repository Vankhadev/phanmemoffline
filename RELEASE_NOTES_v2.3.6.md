# Version 2.3.6

## v2.3.6 - 2026-06-28

### Sửa lỗi
* Sửa lỗi không lưu được khi sửa đơn hàng ở màn Danh sách đơn hàng.
* Bỏ hoàn toàn logic validate sai "dòng không tồn tại sau lưu" dựa theo product:<tên sản phẩm>.
* Khi sửa đơn, dòng chi tiết đơn hàng được xác định theo order_item_id/id, không dùng tên sản phẩm làm khóa chính.
* Backend lưu/sửa chi tiết đơn theo id dòng, không còn xoá toàn bộ dòng rồi insert lại, tránh làm mất liên kết dòng cũ.
* Dòng bị xoá khỏi đơn chỉ xoá theo id của chính dòng đó, không xoá nhầm dòng khác.
* Lưu giá snapshot trong order_items/invoice_details: sale_price, cost_price, line_total là giá riêng của dòng đơn tại thời điểm bán, không bị ghi đè bằng giá hiện tại của bảng products.
* Sửa giá trong đơn từ 95.000 xuống 90.000, bấm Lưu, reload lại trang vẫn giữ đúng 90.000.
* Tổng tiền, chiết khấu, VAT, lợi nhuận được tính lại theo giá mới của dòng đơn đã lưu.

### Hỗ trợ sản phẩm đặc biệt
* Sửa và lưu bình thường đơn có sản phẩm đã bị xoá khỏi kho.
* Sửa và lưu bình thường đơn có product_id null.
* Sửa và lưu bình thường đơn có dịch vụ khác / custom item.
* Không báo "sản phẩm không tồn tại trong phần mềm" khi sản phẩm đã bị xoá hoặc là dịch vụ khác.
* product_name trong đơn được giữ nguyên đúng tên tại thời điểm bán, không đổi theo bảng products.

### Cơ sở dữ liệu & an toàn dữ liệu
* Thêm script backfill order_items snapshot cho database JSON: scripts/backfill-order-items-snapshot-json.js.
* Backfill tự động backup toàn bộ file database JSON trước khi ghi, vào thư mục backups/json-backfill-orders/.
* Giữ nguyên dữ liệu cũ, không tạo database JSON mới rỗng, không xoá đơn hàng cũ, không xoá order_items cũ.
* Thêm lệnh: npm run backfill:orders:dry (chỉ kiểm tra) và npm run backfill:orders:apply (backup rồi ghi).
* Thêm migration SQL an toàn cho môi trường MySQL (nếu dùng): backend/migrations/20260628_fix_order_items_snapshot.sql.
* Thêm script kiểm tra orphan/custom item: scripts/check-orphan-order-items.js, các dòng này chỉ đánh dấu, không coi là lỗi.

### Đã kiểm tra trước khi release
1. Sửa giá sản phẩm từ 95.000 xuống 90.000, bấm Lưu, reload lại vẫn hiện 90.000.
2. Không còn popup lỗi "dòng không tồn tại nay sau lưu".
3. Không còn báo "sản phẩm không tồn tại trong phần mềm".
4. Đơn có sản phẩm đã xoá khỏi kho, product_id null, dịch vụ khác vẫn sửa và lưu được.
5. Backfill JSON dry-run + apply thành công, có backup đầy đủ.
6. Backend syntax check thành công, frontend build thành công.
7. Kiểm tra font tiếng Việt: giữ nguyên dấu tiếng Việt, không mojibake.