# Release Notes v2.3.8

## Sửa lỗi nghiêm trọng: khôi phục dữ liệu bị treo giao diện

- Sửa lỗi khi bấm **Khôi phục** ở `Cài đặt → Khôi phục DL` phần mềm bị treo/đứng (nguyên nhân v2.3.7: quét ổ đĩa, đọc file, giải nén, parse JSON/SQLite và merge toàn bộ chạy đồng bộ trên main thread, chặn Node.js event loop khiến giao diện không phản hồi).

## Khôi phục dữ liệu chạy nền an toàn (không treo)

- Toàn bộ quá trình quét ổ, đọc file, giải nén, parse và gộp dữ liệu chạy **nền**, chia nhỏ thành các chunk xen kẽ trả quyền cho event loop → giao diện vẫn phản hồi, không trắng màn hình, không bị treo.
- Thêm màn hình tiến trình chi tiết: ổ đang quét, số file backup tìm thấy, file đang xử lý, % tiến trình, checkpoint batch, số bản ghi khôi phục từng loại (đơn hàng, sản phẩm, khách hàng, nhập hàng, nhà cung cấp), số file lỗi/bỏ qua.
- Thêm **nút Hủy khôi phục** an toàn — dừng sau batch hiện tại, database không bị hỏng, log ghi rõ vị trí đã hủy.
- Không cho chạy 2 tiến trình khôi phục cùng lúc; nếu đang chạy thì báo "Đang có tiến trình khôi phục dữ liệu".
- Nút Khôi phục bị disable khi đang chạy để tránh bấm nhiều lần, hiện trạng thái "Đang khôi phục, vui lòng không tắt phần mềm".

## Chống treo khi gặp file lỗi

- Mỗi file backup xử lý trong try/catch riêng; file rỗng, sai định dạng, giải nén lỗi, JSON lỗi, SQLite lỗi đều được ghi log và **bỏ qua** — tuyệt đối không để 1 file lỗi làm treo hoặc dừng toàn bộ.
- Thêm **timeout 180 giây/file**; nếu xử lý quá lâu thì ghi log "file này xử lý quá lâu, đã bỏ qua", không treo.
- Giới hạn kích thước file (mặc định 256MB); file quá lớn bị bỏ qua, file lớn đọc theo **stream** để không tràn RAM.
- Không quét thư mục hệ thống không cần thiết (Windows, Program Files, AppData cache, Recycle Bin, System Volume Information, node_modules...).

## Không bỏ sót backup hợp lệ

- Vẫn quét các ổ C, D, E, F, USB nếu có quyền truy cập; tìm tất cả dạng backup: `.json`, `.db`, `.sqlite`, `.bak`, `.backup`, `.zip`, `.rar`, `.7z`, `.gz`, `.tar.gz`.
- Ưu tiên tìm trong các thư mục: `backup_du_lieu_phan_mem_no_del`, `backups`, `backup`, `data`, `app-data`, `userData`, Documents, Desktop, Downloads, ổ D/E/F.
- Sắp xếp backup từ **cũ đến mới** theo metadata/thời gian/tên file, import theo thứ tự cũ → mới để dữ liệu mới ghi bổ sung đúng.

## Gộp dữ liệu, không ghi đè mất đơn hàng

- Không replace toàn bộ database hiện tại; gộp từng bảng: đơn hàng, chi tiết đơn, sản phẩm, khách hàng, nhà cung cấp, nhập hàng, chi tiết nhập hàng, thu chi, mẫu in, cài đặt.
- Với đơn hàng tuyệt đối không mất đơn nào; nếu trùng mã nhưng dữ liệu khác thì giữ bản đầy đủ hơn / tạo mã nội bộ để không mất bản nào.
- Không bỏ qua đơn chỉ vì sản phẩm trong đơn hiện không còn tồn tại; dịch vụ khác/custom item vẫn được khôi phục (orphan-safe: `product_id` null vẫn hiển thị tên sản phẩm theo snapshot trong đơn, `customer_id` null vẫn hiển thị tên/số điện thoại).
- Chống trùng bằng key ổn định (orderCode + createdAt + total, product sku/name/barcode, customer phone/email/name, importCode + createdAt + supplier); bản trùng giống nhau không thêm lại, bản cùng mã nhưng thiếu dữ liệu thì backfill trường trống, không làm mất dữ liệu hiện tại.

## Tương thích nhiều schema cũ

- Viết normalize layer chuyển dữ liệu backup cũ về schema hiện tại trước khi import:
  - `orders` → `invoices`, `order_items` → `invoice_details`, `suppliers` → `partners`, `imports` → `import_logs`, `import_items` → `import_details`...
  - field: `customerName` → `customer_name`, `productName` → `product_name`, `totalAmount` → `total`, `createdAt`/`date` → `created_at`, `qty` → `quantity`, `unitPrice` → `unit_price`...

## Snapshot trước khôi phục + rollback

- Trước khi khôi phục bắt buộc tạo snapshot database hiện tại (`recovery_pre_restore_...` zip, nếu zip lỗi thì tự ghi snapshot JSON dự phòng `pre-restore-YYYYMMDD-HHmmss.json`).
- Nếu quá trình khôi phục lỗi nghiêm trọng (bảng bị giảm dữ liệu) thì tự động rollback về snapshot; không đụng/xóa file backup gốc.
- Có nút "Khôi phục lại bản trước restore" (rollback) trong giao diện.

## Chia nhỏ giao dịch + checkpoint

- Import chia batch (mặc định 200 bản ghi/batch), sau mỗi batch ghi checkpoint và lưu database → nếu đang xử lý mà tắt phần mềm, dữ liệu vẫn không hỏng.

## Log đầy đủ tiếng Việt

- Ghi file log `restore-log-YYYYMMDD-HHmmss.txt`: thời gian bắt đầu/kết thúc, danh sách ổ đã quét, số file tìm thấy, danh sách file đã xử lý, số bản ghi khôi phục từng loại, số bản ghi trùng đã bỏ qua, số bản ghi backfill, danh sách file lỗi + lỗi chi tiết.

## Tổng kết sau khôi phục

- Hiện tổng kết: số backup tìm thấy, số backup đã xử lý, số đơn hàng/sản phẩm/khách hàng/nhập hàng đã khôi phục, số bản ghi trùng, số file lỗi.
- Nếu còn file lỗi, có nút "Xem log lỗi"; không báo thành công giả nếu có lỗi nghiêm trọng.
- Sau restore reload lại dữ liệu, danh sách đơn hàng/sản phẩm/khách hàng/nhập hàng hiển thị đúng.

## Kiểm thử

- `scripts/test-recovery.js` mở rộng thành 10 kịch bản: backup nhỏ nhiều file, backup lớn, backup zip, backup lỗi/sai định dạng, đơn trùng, đơn thiếu product_id/dịch vụ khác, backup schema cũ, chạy lại lần 2 không nhân đôi, hủy an toàn không corrupt DB, sau restore số đơn không giảm.
- Tất cả test PASS (26/26 kiểm tra). Giao diện build thành công, backend syntax check thành công.

## Lưu ý

- Chỉ sửa đúng module backup/restore, migration dữ liệu, orphan-safe order restore và UI tiến trình khôi phục.
- Không sửa lan sang login/register, sản phẩm, đơn hàng, mẫu in nếu không liên quan.
- Không xóa backup cũ, không replace database hiện tại bằng backup.
- Mục tiêu: khôi phục được tối đa dữ liệu, không treo phần mềm, không bỏ sót đơn hàng.
