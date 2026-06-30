## 2.4.3 - Sửa nút Quét file backup trước đăng nhập

### Sửa lỗi
- Sửa lỗi nút **Quét file backup** không hoạt động ở màn hình đăng nhập/đăng ký khi setupStatus lỗi.
- Tách chức năng quét backup khỏi setup/auth/login/register; không phụ thuộc `checkingSetup`, login loading, token hay trạng thái tài khoản.
- Cho phép quét backup khi chưa đăng nhập để cứu dữ liệu.
- Thêm log chẩn đoán khi bấm quét backup: click, electronAPI, scanBackupFiles, backend endpoint.
- Lỗi setupStatus chỉ ghi cảnh báo, không khóa chức năng khôi phục dữ liệu.
- Thêm public endpoint `GET /api/restore/scan` không yêu cầu token, không import dữ liệu ngay.
- Danh sách backup rỗng hiển thị an toàn, không crash.
## 2.4.1 - Sửa lỗi crash giao diện khôi phục

### Sửa lỗi
- Sửa lỗi `ReferenceError: restoreFiles is not defined` làm React app crash khi mở phần mềm.
- Khai báo đầy đủ state `restoreFiles` trong màn hình đăng nhập/khôi phục.
- Thêm biến an toàn `safeRestoreFiles` để danh sách backup rỗng/không phải mảng không làm crash render.
- Thêm `RestoreModuleErrorBoundary` bọc riêng khu vực khôi phục dữ liệu; nếu module restore lỗi chỉ hiện lỗi trong khu vực đó, không làm crash toàn app.
- Không tự động chạy restore khi mở app; chỉ quét khi người dùng bấm "Quét file backup", chỉ restore khi bấm "Bắt đầu khôi phục".
## 2.4.0 - Nâng version sau sửa lỗi build frontend

### Thay đổi
- Nâng version từ 2.3.9 lên 2.4.0.
- Fix lỗi JSON parse (BOM) trong frontend/package.json.
- Chuyển postcss.config.js sang postcss.config.cjs (CommonJS) để không xung đột ESM.
- Build frontend thành công, test 15/15 PASS.
## 2.3.9 - Sửa triệt để lỗi treo hệ thống khi khôi phục dữ liệu

### Sửa triệt để lỗi treo khi bấm Khôi phục dữ liệu
* Viết lại toàn bộ flow khôi phục dữ liệu theo hướng chống treo: tách riêng **Quét file backup** và **Bắt đầu khôi phục**.
* Không còn vừa quét vừa import cùng lúc; nút cũ `/api/database/restore-scan` nay chỉ quét backup để tránh tự động khôi phục ngoài ý muốn.
* Restore chạy bằng `backend/src/workers/RecoveryWorker.js` trong `worker_threads`, không chạy trong React, renderer, hoặc main backend event loop.
* Main process/backend chỉ điều phối qua `backend/src/services/RecoveryEngine.js`; UI chỉ nhận trạng thái/progress.

### Timeout, cancel, lock, checkpoint, log realtime
* Thêm timeout bắt buộc: quét thư mục 10s, đọc metadata 5s, kiểm tra file 30s, xử lý file 120s, giải nén 120s, import theo batch.
* Thêm nút hủy thật sự: gửi `cancel-request` vào worker, dừng sau batch hiện tại.
* Thêm restore lock để không cho chạy nhiều tiến trình restore chồng nhau.
* Ghi log realtime ra `logs/recovery/restore-log-YYYYMMDD_HHmmss.txt` bằng stream, không đợi xong mới ghi.
* Import database theo batch 150 record/lần; sau mỗi batch gửi progress về UI và yield event loop trong worker.

### Giới hạn vùng quét an toàn
* Mặc định chỉ quét các thư mục ưu tiên: database/userData, Documents, Desktop, Downloads, backup/backups/backup_du_lieu_phan_mem_no_del.
* Không quét sâu toàn bộ ổ C mặc định, bỏ qua node_modules, .git, Windows, Program Files, Temp/cache và thư mục hệ thống.
* Thêm chế độ riêng **Quét sâu toàn bộ ổ đĩa** kèm cảnh báo rõ ràng.

### An toàn dữ liệu
* Tạo snapshot database hiện tại trước restore, không replace database hiện tại bằng backup.
* File lỗi/JSON lỗi/zip lỗi/timeout bị ghi log và bỏ qua, không làm treo toàn bộ.
* Khôi phục đơn hàng theo hướng orphan-safe: không bỏ đơn vì thiếu product/customer; giữ snapshot tên sản phẩm, giá, số lượng, khách hàng.
* Dedupe đơn hàng an toàn hơn, ưu tiên không mất dữ liệu hơn là sợ trùng.

### File thay đổi chính
* `backend/src/services/RecoveryEngine.js` — viết lại thành coordinator dùng worker thread, lock, snapshot, rollback, API 2 bước.
* `backend/src/workers/RecoveryWorker.js` — worker riêng xử lý scan/verify/restore/parse/merge/extract.
* `backend/src/routes/recovery.js` — thêm `/scan-files`, `/restore-files`, `/deep-scan`, `/verify-files`.
* `backend/src/routes/database.js` — endpoint cũ `/restore-scan` chuyển thành scan-only.
* `frontend/src/pages/Login.jsx` — nút restore thành 2 bước: Quét file backup → Bắt đầu khôi phục.
* `frontend/src/pages/Settings.jsx` — màn hình debug restore 2 bước, có quét sâu riêng.
* `frontend/src/utils/apiClient.js` — thêm API recovery 2 bước.
# Changelog
## [2.3.8] - 2026-06-30

### Sửa lỗi nghiêm trọng
* Sửa lỗi bấm Khôi phục dữ liệu (Cài đặt → Khôi phục DL) bị treo/đứng giao diện ở v2.3.7.
* Nguyên nhân: quét ổ, đọc file, giải nén, parse và merge toàn bộ chạy đồng bộ trên main thread, chặn event loop.

### Khôi phục chạy nền an toàn
* Toàn bộ quá trình khôi phục chạy nền, chia chunk xen kẽ trả quyền event loop → giao diện vẫn phản hồi, không treo.
* Màn hình tiến trình chi tiết: ổ đang quét, số file tìm thấy, file đang xử lý, % tiến trình, checkpoint, số bản ghi khôi phục từng loại, số file lỗi.
* Nút Hủy khôi phục an toàn (dừng sau batch hiện tại, không corrupt DB); không cho chạy 2 restore cùng lúc; nút disable khi đang chạy.

### Chống treo & giới hạn an toàn
* Mỗi file backup try/catch riêng + timeout 180s/file; file lỗi/rỗng/sai định dạng bị bỏ qua, không dừng toàn bộ.
* Giới hạn file 256MB; file lớn đọc stream; không quét thư mục hệ thống (Windows, Program Files, AppData cache, Recycle Bin...).

### Không bỏ sót backup & gộp an toàn
* Quét C/D/E/F/USB, tìm .json/.db/.sqlite/.bak/.backup/.zip/.rar/.7z/.gz; ưu tiên thư mục backup/Documents/Desktop/Downloads.
* Sắp xếp cũ → mới; gộp từng bảng, không ghi đè database; chống trùng bằng key ổn định; backfill trường trống; giữ giá lịch sử đơn/nhập cũ.
* Orphan-safe: đơn thiếu product_id/dịch vụ khác vẫn hiển thị tên theo snapshot trong đơn; customer_id null vẫn hiện tên/SĐT.

### Tương thích schema cũ
* Normalize layer: orders→invoices, order_items→invoice_details, suppliers→partners, imports→import_logs; field customerName→customer_name, productName→product_name, totalAmount→total, createdAt/date→created_at, qty→quantity...

### Snapshot & rollback & log
* Tạo snapshot trước restore (zip, có JSON dự phòng nếu zip lỗi); rollback tự động nếu bảng bị giảm dữ liệu; không đụng backup gốc.
* Import chia batch + checkpoint; log tiếng Việt ra restore-log-YYYYMMDD-HHmmss.txt; tổng kết + nút xem log lỗi.

### Kiểm thử
* scripts/test-recovery.js: 10 kịch bản (nhỏ/lớn/zip/lỗi/trùng/thiếu productId/dịch vụ/schema cũ/chạy lại không nhân đôi/hủy an toàn/không giảm đơn). PASS 26/26.


## [2.3.6] - 2026-06-28

### Sửa lỗi
* Sửa lỗi không lưu được khi sửa đơn hàng ở màn Danh sách đơn hàng.
* Bỏ validate sai "dòng không tồn tại sau lưu" dựa theo product:<tên sản phẩm>.
* Xác định dòng chi tiết đơn theo order_item_id/id, không dùng tên sản phẩm làm khóa chính.
* Backend sửa chi tiết đơn theo id, không xoá toàn bộ rồi insert lại.
* Lưu giá snapshot trong order_items/invoice_details, không ghi đè bằng giá sản phẩm hiện tại.
* Sửa giá đơn từ 95.000 xuống 90.000, bấm Lưu, reload vẫn giữ 90.000.

### Hỗ trợ
* Sửa/lưu đơn có sản phẩm đã xoá khỏi kho, product_id null, dịch vụ khác/custom item.
* Không báo "sản phẩm không tồn tại trong phần mềm" với sản phẩm đã xoá/dịch vụ khác.

### Dữ liệu
* Thêm script backfill order_items snapshot cho DB JSON, backup tự động trước khi ghi.
* Giữ nguyên dữ liệu cũ, không tạo database mới, không xoá đơn/order_items cũ.
* Thêm migration SQL an toàn và script kiểm tra orphan/custom item.

### Kiểm tra
* Font tiếng Việt giữ nguyên, không mojibake.
* Backend syntax check thành công, frontend build thành công.
## v2.3.5 - 2026-06-27

### Sửa lỗi nghiêm trọng: sửa giá đơn hàng không lưu vĩnh viễn

- Sửa nguyên nhân gốc khi sửa đơn hàng: sale_price_at_sale cũ không còn lấn unit_price mới trong backend.
- Khi người dùng sửa giá trong Danh sách đơn hàng, frontend đồng bộ unit_price, sale_price_at_sale, line_total và profit_at_sale theo giá mới.
- Backend update đơn hàng lưu lại giá riêng của từng dòng trong invoice_details.unit_price, không lấy lại giá hiện tại từ bảng products.
- API GET chi tiết đơn hàng hiển thị giá từ dòng chi tiết đơn hàng đã lưu; chỉ dùng products để bổ sung tên/SKU khi cần.
- Sau khi lưu, frontend gọi lại API GET chi tiết đơn hàng bằng cache-bust và báo lỗi nếu database chưa trả về đúng giá vừa gửi.
- Backend tính lại subtotal, 	otal, emaining_amount, change_amount và 	otal_profit từ các dòng chi tiết đã lưu.
- Giữ tương thích dịch vụ khác và sản phẩm không có trong kho.

### Đã test trước khi release
1. Tạo đơn giá 95.000, sửa xuống 90.000, GET/reload vẫn là 90.000 — PASS.
2. Sửa tiếp lên 100.000, GET/reload vẫn là 100.000 — PASS.
3. Kiểm tra database: invoice_details.unit_price cập nhật đúng — PASS.
4. Dịch vụ khác giữ giá riêng sau khi lưu/reload — PASS.
5. Sản phẩm không có trong kho vẫn lưu được giá riêng — PASS.
6. Tổng tiền tính lại đúng theo giá mới — PASS.
7. Backend syntax check và frontend build — PASS.
## v2.3.4 - 2026-06-27

### Sửa lỗi Electron production không khởi động được backend nội bộ (ECONNREFUSED 127.0.0.1:7000)

Bản 2.3.4 kế thừa toàn bộ fix từ 2.3.3 (đã verify end-to-end trên bản cài thật) và phát hành làm bản stable mới:

- Sửa lỗi Electron production không khởi động được backend nội bộ.
- Sửa lỗi health check backend ECONNREFUSED 127.0.0.1:7000.
- Đảm bảo backend được đóng gói đúng trong installer (sửa pattern loại trừ `!**/release/**` và `!**/tmp/**` quá rộng gây thiếu bluebird/tmp; thêm transitive deps exceljs/unzipper).
- Đảm bảo app production mở lên tự start backend (sửa window-all-closed race).
- Thêm log backend production tại `userData/logs/backend.log` (backendEntry, port, stdout, stderr, exit code) để dễ kiểm tra lỗi.
- `resolveDBPath()`: KHA_DB_PATH (Electron production) có quyền cao nhất, không để config.json cũ override; bỏ qua deep scan + old-db migration khi envPath set để backend mở port nhanh.
- Tăng timeout health check backend lên 30 giây.
- Màn hình "Đang khởi động backend nội bộ..." thay vì trắng màn hình.
- Kiểm tra `fs.existsSync(backendEntry)` trước khi spawn backend, báo rõ nếu thiếu.
- Giữ auto-update tắt trong môi trường dev/localhost (không check/download/quitAndInstall; production chỉ check khi người dùng bấm "Kiểm tra cập nhật").
- Giữ lại toàn bộ chức năng đã khôi phục: login, register, sản phẩm, đơn hàng, dịch vụ khác trong sửa đơn, bật/tắt cột sửa đơn, mẫu in hóa đơn kéo thả, bật/tắt thông tin sản phẩm trong mẫu in, báo cáo/thống kê.
- Không reset database, không xóa dữ liệu.

### Đã test trước khi release
1. Frontend build: PASS
2. Backend dev: port 7000 healthy, không EADDRINUSE, không crash — PASS
3. Auto-update tắt trong dev/localhost — PASS
4. Electron-builder đóng gói backend đúng — PASS
5. Bản cài thật (win-unpacked): backend tự start port 7000, không ECONNREFUSED, login form "Bán Hàng Pos" hiện — PASS
## v2.3.3 - 2026-06-27

### Sửa lỗi nghiêm trọng: Electron production không khởi động được backend nội bộ (ECONNREFUSED 127.0.0.1:7000)

**Nguyên nhân gốc (đã tái hiện):**
- Khi Electron production spawn backend, nó truyền `KHA_DB_PATH` trỏ tới `%APPDATA%\Bán Hàng Pos\phanmienoffline.db.json`.
- Nhưng `resolveDBPath()` trong `backend/src/db/database.js` lại để `config.json` (file cũ tại `%APPDATA%\Ban hang offline - Van kha mmo\config.json`, trỏ tới `E:\backup_du_lieu_phan_mem_no_del\...`) **lấn ưu tiên** so với `KHA_DB_PATH`.
- Khi DB do config.json trỏ tới bị thiếu/rỗng (máy mới, cài lại, hoặc backup bị xóa), backend tự động chạy `performDeepScan()` quét toàn bộ ổ đĩa `C:\,D:\,E:\,F:\` và parse hàng chục file JSON lớn để "chọn database tốt nhất".
- Quá trình quét này mất nhiều phút -> backend không kịp mở cổng 7000 -> Electron health check timeout -> báo **"Không thể chạy backend / Backend did not become healthy at http://127.0.0.1:7000/api/health / ECONNREFUSED 127.0.0.1:7000"**.

**Đã sửa:**
1. `backend/src/db/database.js` — `resolveDBPath()`: khi Electron đã set `KHA_DB_PATH` (production), biến env này có quyền cao nhất, **không** để `config.json` override. Nếu DB rỗng/thiếu thì tạo DB trống tại đúng path Electron chỉ định và **bỏ qua deep scan toàn ổ đĩa khi khởi động** (nút "Khôi phục dữ liệu" trong app vẫn chạy scan theo yêu cầu người dùng). Deep scan chỉ giữ cho chế độ chạy backend độc lập (npm start).
2. `src/main.js` — ghi log backend production đầy đủ ra `userData/logs/backend.log` (backendEntry, cwd, port, host, stdout, stderr, exit code). Khi báo lỗi "Không thể chạy backend", hộp thoại hiện kèm đường dẫn file log để xem nguyên nhân thật.
3. `src/main.js` — kiểm tra file backend nội bộ tồn tại trước khi spawn, báo rõ nếu thiếu.
4. `src/main.js` — tăng timeout health check backend lên 30 giây (trước đó có thể báo lỗi quá sớm).
5. `src/main.js` — hiển thị màn hình **"Đang khởi động backend nội bộ..."** thay vì trắng màn hình / quit ngay khi backend chưa sẵn sàng.
6. Giữ nguyên mọi chức năng: login/register, sản phẩm, đơn hàng, báo cáo, mẫu in hóa đơn, in silent, Data Guardian, backup.
7. **Không reset database, không xóa dữ liệu, không đổi key nghiệp vụ.**

### Cách xem log khi gặp lỗi backend
- Log backend: `%APPDATA%\Bán Hàng Pos\logs\backend.log`
- Log electron: `logs/electron.log` (cùng thư mục app dev) / `%APPDATA%\Bán Hàng Pos\logs\electron.log`

### Lưu ý nâng cấp
- Bản 2.3.2 đã lỗi production (backend không start). Bản 2.3.3 sửa lỗi này.
- Người dùng đang ở 2.2.8 (hoặc cũ hơn) khi auto-update lên 2.3.3 sẽ dùng lại DB hiện tại (config.json không còn override KHA_DB_PATH nữa).
## v2.3.2 - 2026-06-27

- S?a l?i Register.jsx sai JSX closing tag (?? kh?i ph?c ? 2.3.1, gi? ?n ??nh).
- Kh?i ph?c form login/register, c? toggle hi?n/?n m?t kh?u.
- T?t auto-update trong m?i tr??ng dev/localhost (log `[AUTO_UPDATE] Disabled in development mode`).
- S?a c? ch? backend port tr?nh EADDRINUSE (portManager t? ch?n 7000 -> 7001 -> ... -> 7100).
- Frontend t? probe /api/health tr?n c?c port ?? nh?n ??ng backend ?ang ch?y.
- S?a n?t mojibake ti?ng Vi?t c?n s?t trong src/main.js v? package.json (shortcutName).
- Gi? l?i c?c ch?c n?ng ?? kh?i ph?c: s?n ph?m, ??n h?ng, d?ch v? kh?c, m?u in h?a ??n, b?o c?o.
- formatCurrencyVND d?ng Intl.NumberFormat('vi-VN'), kh?ng d?ng parseFloat tr?c ti?p v?i ti?n Vi?t Nam.
- C?i thi?n ki?m tra build tr??c khi ph?t h?nh (healthcheck 18/18 pass).

## v2.3.1 - 2026-06-27

- Khôi phục form đăng nhập.
- Tắt auto-update trong môi trường dev/localhost.
- Sửa cơ chế backend port tránh lỗi EADDRINUSE.
- Giữ lại các chức năng đã khôi phục: sản phẩm, đơn hàng, dịch vụ khác, mẫu in hóa đơn, báo cáo.
- Cải thiện xử lý lỗi giao diện và định dạng tiền Việt Nam.

## v2.3.0 - 2026-06-27 (Production-stable hardening)

### Mục tiêu
Nâng cấp ổn định toàn bộ dự án theo hướng production-stable: tránh sửa lỗi này phát sinh lỗi khác, dùng lâu dài, không mất dữ liệu, không crash trắng màn hình.

### Lỗi gốc đã phát hiện và sửa
1. **Migrate DB không backup trước** → có thể mất dữ liệu khi migrate hỏng. Đã thêm backup tự động trước migrate (chỉ khi có dữ liệu thực); nếu backup fail thì HỶ migrate để bảo vệ dữ liệu.
2. **Mojibake tiếng Việt** (dấu bị thay bằng '?', và cp1252/latin1 double-encode `Ã¡, áº, Ä`) trong toàn frontend → hiển thị sai. Đã sửa bằng từ điển an toàn (không đụng optional chaining `x?.y`, không đổi key API/DB).
3. **package.json productName/description bị mojibake** (`BÃ¡n HÃ ng Pos`) → Đã sửa thành `Bán Hàng Pos`.
4. **apiClient không có timeout** → request treo khi backend chết. Đã thêm timeout 30s (AbortController) + message rõ.
5. **Message lỗi API** chưa rõ khi backend chết → đã có "Không thể kết nối tới máy chủ API... Kiểm tra backend".
6. **Lỗi 1 trang crash toàn app** → đã bọc ErrorBoundary quanh mỗi route, có nút tải lại.
7. **Mẫu in còn autosave/draft/checkbox "Tự động lưu"** → đã bỏ, chỉ còn Lưu + Publish, vị trí kéo thả giữ nguyên (commit bởi thread song song + verify).
8. **Toggle ẩn/hiện block/cột mẫu in** → đã có (commit thread song song).
9. **Backend/Electron không log file** → đã thêm logs/app.log (backend) + logs/electron.log (electron), handler unhandledRejection/uncaughtException, KHÔNG log password/token.
10. **Không có healthcheck/test nghiệp vụ** → đã thêm `npm run healthcheck` + `npm run test:business`.

### File đã sửa (chính)
- backend/src/db/database.js — backup trước migrate
- backend/src/server.js — file logger + error handler
- backend/src/utils/fileLogger.js (mới) — logger logs/app.log
- src/electronLogger.js (mới) — logger logs/electron.log
- src/main.js — hook electron logger + error handler
- frontend/src/utils/apiClient.js — timeout 30s + message
- frontend/src/App.jsx — ErrorBoundary per route
- frontend/src/components/invoice-print/editor/EditorToolbar.jsx — chỉ Lưu + Publish
- frontend/src/components/invoice-print/PrintTemplateEditorModal.jsx — bỏ autosave
- frontend/src/index.css — font Inter/Segoe UI
- frontend/src/** — sửa mojibake tiếng Việt (~2200 chuỗi)
- package.json, backend/package.json — fix productName/description + thêm scripts
- scripts/healthcheck.js (mới), scripts/business-test.js (mới), scripts/repair-vietnamese.js (mới), scripts/repair-mojibake-latin1.js (mới), scripts/vi-repairs.json (mới)

### Database có thay đổi gì không
- KHÔNG tạo database mới, KHÔNG xóa dữ liệu cũ, KHÔNG đổi key nghiệp vụ (product_id, order_id, client_order_id, cost_price, sell_price...).
- Migration chỉ dùng ALTER/normalize an toàn, có DEFAULT. Backup tự động trước migrate.
- Snapshot giá vốn (cost_price_at_sale) đã có từ v2.1.2, giữ nguyên.

### Backup nằm ở đâu
- Source + DB backup trước hardening: `G:\phanmienoffline\BACKUP_PREHARDENING_20260626-235638\` (571MB, có backend/frontend/src/scripts/database/data + phanmienoffline.db.json)
- Backup DB tự động (mỗi 3 ngày + trước migrate): `<DB_dir>\backup_du_lieu_phan_mem_no_del\phanmienoffline-db-*.zip`
- Git: toàn bộ thay đổi đã commit trên branch `fix-restore-working-functions` (có thể git revert từng commit).

### Script healthcheck chạy thế nào
`npm run healthcheck` — kiểm tra: backend DB load, bảng users/products/customers/invoices/invoice_details/print_templates, API route files, API login/products/orders/print-templates, frontend build pass, dist/index.html, meta charset UTF-8. Kết quả: 18 PASS, 0 FAIL.

`npm run test:business` — kiểm tra API runtime (cần backend đang chạy): /api/health, login, products, invoices, print-templates, customers, stats.

### Checklist test đã pass
- [x] npm run build (frontend) pass
- [x] npm run healthcheck pass (18/18)
- [x] Backend load DB được (1033 đơn, 1307 sản phẩm, 8 user)
- [x] Backup trước migrate chạy
- [x] index.html charset UTF-8
- [x] Font tiếng Việt đúng
- [x] apiClient có timeout
- [x] ErrorBoundary per route
- [x] Mẫu in chỉ Lưu + Publish
- [ ] test:business (cần start backend thủ công)

### Cách rollback nếu bản mới lỗi
1. **Rollback git** (nhanh nhất): `git revert <commit-hash>` cho từng commit hardening, hoặc `git checkout 0bdf896` (trước hardening) — nhưng giữ commit 6820c9c/c02b2b8 (mẫu in đã ổn).
2. **Rollback source từ backup**: copy `BACKUP_PREHARDENING_20260626-235638\{backend,frontend,src,scripts}` đè lên working tree.
3. **Rollback database**: file DB hiện tại không bị hardening đụng (chỉ đọc). Nếu cần, restore từ `backup_du_lieu_phan_mem_no_del\phanmienoffline-db-<timestamp>-pre-migration.zip` (giải nén, copy database.json đè DB_PATH trong backend/data/config.json).
4. **Không có thay đổi schema phá vỡ** — mọi bản mới tương thích dữ liệu cũ.

## v2.1.2 - 2026-06-23

### Fixed
- Sửa lỗi giá vốn của đơn hàng cũ bị thay đổi khi nhập hàng mới.
- Sửa lỗi lợi nhuận bị tính sai khi cập nhật giá nhập sản phẩm.
- Sửa lỗi báo cáo doanh thu và lợi nhuận lấy giá vốn hiện tại thay vì giá vốn tại thời điểm bán.
- Sửa lỗi đơn hàng lịch sử bị ảnh hưởng khi cập nhật giá sản phẩm.

### Improved
- Lưu cố định giá vốn tại thời điểm bán (cost_price_at_sale).
- Lưu cố định giá bán tại thời điểm bán (sale_price_at_sale).
- Đơn hàng cũ giữ nguyên dữ liệu lịch sử.
- Đơn hàng mới sử dụng giá nhập mới nhất.
- Cải thiện độ chính xác báo cáo doanh thu và lợi nhuận.

## v1.9.5 - 2026-06-21

### Fixed
- Sửa luồng sửa đơn hàng trong Danh sách đơn hàng: chọn khách hàng bằng ô tìm kiếm + gợi ý thay vì xổ toàn bộ danh sách.
- Hoàn thiện hệ thống hướng dẫn theo từng màn hình và các vá lỗi giao diện liên quan.
- Tổng hợp các lỗi đã fix trong đợt phát hành sau 1.9.3.

## v1.9.3 - 2026-06-20

### Fixed
- [Add release notes here]


## v1.9.2 - 2026-06-20

### Fixed

- Fix app icon: include app-icon.ico in packaged Electron app.
- Add fallback favicon for Windows tab to ensure proper icon display.

# Changelog

## v1.7.9 - 2026-06-15

### Fixed

- Táº¡o Ä‘Æ¡n hÃ ng: TÃ¬m kiáº¿m khÃ¡ch hÃ ng bá» dáº¥u tiáº¿ng Viá»‡t vÃ  khÃ´ng phÃ¢n biá»‡t hoa/thÆ°á»ng. GÃµ má»™t kÃ½ tá»± báº¥t ká»³ (vÃ­ dá»¥ "c") sáº½ liá»‡t kÃª má»i khÃ¡ch hÃ ng cÃ³ chá»©a kÃ½ tá»± Ä‘Ã³ trong tÃªn, mÃ£ KH, email, loáº¡i, Ä‘á»‹a chá»‰ hoáº·c mÃ£ sá»‘ thuáº¿; sá»‘ Ä‘iá»‡n thoáº¡i váº«n tÃ¬m theo cÃ¡c chá»¯ sá»‘.
- Nháº­p hÃ ng: Bá» rÃ ng buá»™c nhÃ  cung cáº¥p khi chá»n sáº£n pháº©m. Má»™t sáº£n pháº©m dÃ¹ gáº¯n NCC A váº«n cÃ³ thá»ƒ nháº­p tá»« báº¥t ká»³ NCC B/C/M/R/Y nÃ o; sáº£n pháº©m chÆ°a gáº¯n NCC cÅ©ng nháº­p Ä‘Æ°á»£c vá»›i má»i NCC. KhÃ´ng cÃ²n yÃªu cáº§u khá»›p NCC má»›i hiá»‡n sáº£n pháº©m trong danh sÃ¡ch chá»n.

## v1.7.8 - 2026-06-14

### Fixed

- Äá»“ng bá»™ dá»¯ liá»‡u Ä‘a tab: XÃ¢y dá»±ng há»‡ thá»‘ng sá»± kiá»‡n toÃ n cá»¥c (Global Event System), cÆ¡ cháº¿ cache GET API thÃ´ng minh á»Ÿ client giÃºp Ä‘á»“ng bá»™ tá»©c thÃ¬ (<500ms) cÃ¡c hÃ nh Ä‘á»™ng táº¡o/sá»­a/xÃ³a Ä‘Æ¡n hÃ ng, nháº­p hÃ ng, khÃ¡ch hÃ ng, cÃ´ng ná»£ trÃªn toÃ n bá»™ cÃ¡c tab mÃ  khÃ´ng cáº§n reload á»©ng dá»¥ng.

## v1.7.7 - 2026-06-13

### Fixed

- BÃ¡o cÃ¡o Ä‘Æ¡n hÃ ng theo khÃ¡ch hÃ ng: Äá»‹nh dáº¡ng láº¡i tá»‡p xuáº¥t Excel theo bá»‘ cá»¥c tinh giáº£n chá»‰ gá»“m 3 cá»™t (STT, hÃ³a Ä‘Æ¡n, tiá»n), bá»• sung tiÃªu Ä‘á» tÃªn khÃ¡ch hÃ ng vÃ  tá»•ng káº¿t tá»•ng tiá»n.

## v1.7.6 - 2026-06-13

### Fixed

- BÃ¡o cÃ¡o Ä‘Æ¡n hÃ ng theo khÃ¡ch hÃ ng: Sá»­a lá»—i danh sÃ¡ch gá»£i Ã½ khÃ¡ch hÃ ng bá»‹ che khuáº¥t/khÃ´ng hiá»ƒn thá»‹ khi phÃ³ng to hoáº·c thu nhá» mÃ n hÃ¬nh.

## v1.7.5 - 2026-06-13

### Fixed

- BÃ¡o cÃ¡o Ä‘Æ¡n hÃ ng theo khÃ¡ch hÃ ng: Cáº£i thiá»‡n tÃ¬m kiáº¿m gá»£i Ã½ tÃªn khÃ¡ch hÃ ng, hiá»ƒn thá»‹ danh sÃ¡ch táº¥t cáº£ khÃ¡ch hÃ ng.
- Sá»­a Ä‘Æ¡n hÃ ng: Cáº­p nháº­t giÃ¡ sáº£n pháº©m thÃªm má»›i vÃ  sáº£n pháº©m trong giá» hÃ ng theo Ä‘Ãºng nhÃ³m/loáº¡i giÃ¡ cá»§a khÃ¡ch hÃ ng (Sá»‰, VIP, Láº»).

## v1.7.4 - 2026-06-13

### Fixed

- Sá»­a lá»—i khÃ´ng gÃµ Ä‘Æ°á»£c dáº¥u cÃ¡ch (phÃ­m Space) táº¡i Ã´ nháº­p dá»‹ch vá»¥ khÃ¡c á»Ÿ mÃ n hÃ¬nh táº¡o Ä‘Æ¡n hÃ ng.

## v1.7.3 - 2026-06-13

### Fixed

- Sá»­a lá»—i tráº¯ng mÃ n hÃ¬nh vÃ  `ReferenceError: Cannot access variable before initialization` trong `Settings` vÃ  `ProductReport` do Temporal Dead Zone (TDZ).

## v1.7.2 - 2026-06-13

### Thay doi chinh

- Äá»“ng bá»™ dá»¯ liá»‡u realtime giá»¯a cÃ¡c tab (Realtime Multi Tab Sync).
- Há»‡ thá»‘ng backup Ä‘a táº§ng vÃ  tá»± khÃ´i phá»¥c sau máº¥t Ä‘iá»‡n.
- NÃ¢ng cáº¥p há»‡ thá»‘ng bÃ¡o cÃ¡o vÃ  báº£o trÃ¬ tá»± Ä‘á»™ng 15h.

## v1.6.7 - 2026-06-12

### Thay doi chinh

- Xac nhan luong tao don khong con bao loi "Ma SKU da ton tai".
- SKU san pham tiep tuc duoc phep lap lai tren nhieu don hang; chi kiem tra ton tai trong danh muc san pham.
- Bo sung kiem tra lai bang 1000 don cung mot SKU de dam bao khong phat sinh duplicate SKU.

### Phat hanh

- Dong bo version 1.6.4 cho ung dung desktop, frontend, backend va lockfile.
- Tao tag GitHub `v1.6.4` va release GitHub theo workflow hien tai.

## v1.6.3 - 2026-06-11

### Thay doi chinh

- Sua luong tao don de SKU chi duoc kiem tra trong danh muc san pham, khong chan SKU da tung xuat hien trong hoa don hoac dong hoa don.
- Cho phep mot SKU xuat hien trong nhieu don hang; giu `invoice_code` la ma duy nhat cua tung don.
- Chuan hoa thong bao SKU khong ton tai va bo sung migration SQL xoa UNIQUE INDEX sai tren SKU cua bang don hang, thay bang INDEX thuong.
- Bo sung test hoi quy tao 1000 don hang cung mot SKU va xac nhan tat ca don deu tao thanh cong.

### Phat hanh

- Dong bo version 1.6.3 cho ung dung desktop, frontend, backend va cac lockfile.
- Tao tag GitHub `v1.6.3`; GitHub Actions se build/publish cac goi phat hanh theo workflow hien tai.

## v1.6.0 - 2026-06-10

### Thay doi chinh

- Chuan hoa sinh ma chung tu toan he thong: don ban hang `HD`, phieu nhap `PN`, san pham `SP`; moi loai dung bo dem rieng va chan trung ma o lop backend.
- Cho phep nhap tay ma phieu nhap nha cung cap khi tao phieu nhap; neu de trong he thong tu sinh ma `PN`, ma da cap khong duoc doi va khong tai su dung.
- Bo sung dong dich vu khac trong man hinh tao don, cho nhap ten dich vu, so luong, don gia, chiet khau va tinh thanh tien truc tiep trong bang.
- Khi bam vao o tim san pham o trang tao don, hien ngay danh sach san pham de chon nhanh ke ca khi chua nhap tu khoa.
- Dong bo hien thi ten san pham/combo/dich vu va cac luong import/export lien quan den ma san pham.

### Phat hanh

- Dong bo version phat hanh 1.6.0 cho ung dung desktop, frontend, backend va cac lockfile tuong ung.
- Tao tag GitHub `v1.6.0`; GitHub Actions se build/publish installer Windows x64 va ia32 kem latest.yml/update-manifest.json.

## v1.5.9 - 2026-06-10

### Thay doi chinh

- Chan trung ma phieu nhap va ma don hang; bo sung migration tu dong sua cac ma hoa don bi lap trong du lieu cu va dong bo lai bo dem `invoice_seq`.
- Cai thien bao cao theo don hang: tim/goi y khach hang bang o tim kiem, chon khach tu dropdown va xu ly loi API an toan hon.
- Sua cau hinh API frontend/development proxy de bo qua placeholder env chua duoc resolve nhu `%KHA_BACKEND_PORT%` va fallback ve backend local `3001`.
- Dong bo cac thay doi ung dung/mobile hien co, icon va cau hinh build phuc vu phat hanh.

### Phat hanh

- Dong bo version phat hanh 1.5.9 cho ung dung desktop, frontend, backend va cac lockfile tuong ung.
- Tao tag GitHub `v1.5.9`; GitHub Actions se build/publish installer Windows x64 va ia32 kem latest.yml/update-manifest.json.

## v1.5.7 - 2026-06-09

### Thay doi chinh

- Phat hanh lai ban cap nhat sau khi sua quy trinh release de GitHub Actions build va upload day du installer/metadata truoc khi nguoi dung tai ve.
- Giu nguyen cac cap nhat cua v1.5.6: quan ly san TMDT, dong bo tab, bao cao loi nhuan, mau in hoa don va lich chon khoang ngay bao cao san pham.

### Phat hanh

- Dong bo version phat hanh 1.5.7 cho ung dung desktop, frontend, backend va cac lockfile tuong ung.
- Tao tag GitHub `v1.5.7`; GitHub Actions se build/publish installer Windows x64 va ia32 kem latest.yml/update-manifest.json.

## v1.5.4 - 2026-06-09

### Thay Ä‘á»•i chÃ­nh

- Thiáº¿t káº¿ láº¡i luá»“ng thÃªm sáº£n pháº©m trong trang nháº­p hÃ ng: khi báº¥m ThÃªm sáº£n pháº©m/Chá»n nhiá»u sáº½ má»Ÿ modal chá»n sáº£n pháº©m giá»‘ng trang táº¡o Ä‘Æ¡n hÃ ng.
- Modal nháº­p hÃ ng há»— trá»£ tÃ¬m kiáº¿m sáº£n pháº©m, áº£nh/placeholder, thÃ´ng tin tá»“n kho, nÃºt cá»™ng nhanh vÃ  chá»‰nh sá»‘ lÆ°á»£ng trá»±c tiáº¿p báº±ng nÃºt +/- hoáº·c Ã´ nháº­p.
- Khi báº¥m Chá»n xong, danh sÃ¡ch Ä‘Ã£ chá»n Ä‘Æ°á»£c Ä‘Æ°a xuá»‘ng báº£ng nháº­p hÃ ng, tá»± gá»™p sáº£n pháº©m trÃ¹ng vÃ  váº«n cho chá»‰nh sá»‘ lÆ°á»£ng, giÃ¡ nháº­p, chiáº¿t kháº¥u, thuáº¿ trong báº£ng.

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.5.4 cho á»©ng dá»¥ng desktop, frontend, backend vÃ  cÃ¡c lockfile tÆ°Æ¡ng á»©ng.
- Táº¡o tag GitHub `v1.5.4`; GitHub Actions sáº½ build/publish installer Windows x64 vÃ  ia32 kÃ¨m latest.yml/update-manifest.json.

## v1.5.3 - 2026-06-09

### Thay Ä‘á»•i chÃ­nh

- Thiáº¿t káº¿ láº¡i trang nháº­p hÃ ng theo bá»‘ cá»¥c Sapo: tÃ¡ch thÃ´ng tin nhÃ  cung cáº¥p vÃ  thÃ´ng tin Ä‘Æ¡n, Ä‘Æ°a báº£ng sáº£n pháº©m ra toÃ n chiá»u rá»™ng, bá»• sung thanh tÃ¬m nhanh/chá»n nhiá»u vÃ  khu ghi chÃº, thanh toÃ¡n phÃ­a dÆ°á»›i.
- Bá»• sung cÃ´ng táº¯c ON/OFF cho tá»«ng dÃ²ng trong khá»‘i tá»•ng tiá»n cá»§a máº«u hÃ³a Ä‘Æ¡n, gá»“m Tá»•ng tiá»n hÃ ng, Chiáº¿t kháº¥u, Tá»•ng tiá»n vÃ  CÃ´ng ná»£; tráº¡ng thÃ¡i Ã¡p dá»¥ng Ä‘á»“ng thá»i cho canvas thiáº¿t káº¿ vÃ  báº£n in tháº­t.
- Tá»‘i Æ°u trÃ¬nh chá»‰nh sá»­a máº«u in: kÃ©o/resize cáº­p nháº­t cá»¥c bá»™ theo khung hÃ¬nh, chá»‰ ghi layout khi tháº£ chuá»™t, táº¡m dá»«ng preview in tháº­t trong lÃºc kÃ©o vÃ  giá»¯ á»•n Ä‘á»‹nh vá»‹ trÃ­ khá»‘i tá»•ng tiá»n tá»± Ä‘á»™ng.

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.5.3 cho á»©ng dá»¥ng desktop, frontend, backend vÃ  cÃ¡c lockfile tÆ°Æ¡ng á»©ng.
- Táº¡o tag GitHub `v1.5.3`; GitHub Actions sáº½ build/publish installer Windows x64 vÃ  ia32 kÃ¨m latest.yml/update-manifest.json.

## v1.5.2 - 2026-06-09

### Thay Ä‘á»•i chÃ­nh

- Cáº£i thiá»‡n máº«u in hÃ³a Ä‘Æ¡n: tá»•ng tiá»n cÃ³ thá»ƒ tá»± bÃ¡m dÆ°á»›i báº£ng sáº£n pháº©m theo Ä‘á»™ dÃ i Ä‘Æ¡n hÃ ng vÃ  pháº§n chá»¯ kÃ½ chá»‰ cÃ²n nhÃ£n KhÃ¡ch hÃ ng/NgÆ°á»i bÃ¡n kÃ¨m dÃ²ng kÃ½ tÃªn.
- Thiáº¿t káº¿ láº¡i popup chá»n nhanh sáº£n pháº©m theo phong cÃ¡ch Sapo: tÃ¬m kiáº¿m, áº£nh/placeholder, tá»“n kho/cÃ³ thá»ƒ bÃ¡n, nÃºt cá»™ng/trá»« sá»‘ lÆ°á»£ng vÃ  nÃºt Chá»n xong.
- LÃ m má»›i giao diá»‡n táº¡o Ä‘Æ¡n hÃ ng theo bá»‘ cá»¥c Sapo vá»›i topbar hÃ nh Ä‘á»™ng, tháº» thÃ´ng tin khÃ¡ch hÃ ng, thÃ´ng tin bá»• sung, báº£ng sáº£n pháº©m cÃ³ cá»™t áº£nh vÃ  khu tá»•ng tiá»n.
- LÃ m má»›i giao diá»‡n nháº­p hÃ ng theo bá»‘ cá»¥c Sapo vá»›i topbar phÃ¡t hÃ nh phiáº¿u, tháº» nhÃ  cung cáº¥p, thÃ´ng tin Ä‘Æ¡n nháº­p hÃ ng, báº£ng sáº£n pháº©m cÃ³ cá»™t áº£nh/Ä‘Æ¡n vá»‹ vÃ  empty-state rÃµ rÃ ng.

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.5.2 cho á»©ng dá»¥ng desktop, frontend, backend vÃ  cÃ¡c lockfile tÆ°Æ¡ng á»©ng.
- Táº¡o tag GitHub `v1.5.2`; GitHub Actions sáº½ build/publish installer Windows x64 vÃ  ia32 kÃ¨m latest.yml/update-manifest.json.

## v1.5.1 - 2026-06-09

### Thay Ä‘á»•i chÃ­nh

- Bá»• sung trÃ¬nh chá»‰nh sá»­a máº«u in hÃ³a Ä‘Æ¡n kiá»ƒu kÃ©o tháº£/Sapo: resize khung, cÄƒn chá»‰nh báº±ng ruler/snap grid, autosave draft vÃ  publish layout in tháº­t.
- ThÃªm fallback máº«u in local khi thiáº¿u cáº¥u hÃ¬nh MySQL cho module máº«u in, giÃºp trang cÃ i Ä‘áº·t vÃ  trang in váº«n thao tÃ¡c Ä‘Æ°á»£c.
- Cáº£i thiá»‡n luá»“ng táº¡o Ä‘Æ¡n: chá»n nhanh sáº£n pháº©m qua danh sÃ¡ch táº¡m, báº¥m "ThÃªm vÃ o Ä‘Æ¡n" rá»“i chá»‰nh sá»‘ lÆ°á»£ng, giÃ¡, chiáº¿t kháº¥u trong báº£ng Ä‘Æ¡n hÃ ng.
- ThÃªm lá»±a chá»n in táº¡m tÃ­nh/in hÃ³a Ä‘Æ¡n, chá»n kiá»ƒu mÃ¡y in, khá»• K80/K57/A5/A4 vÃ  scale ná»™i dung trÆ°á»›c khi má»Ÿ há»™p thoáº¡i in.
- Cho phÃ©p chá»‰nh kÃ­ch thÆ°á»›c khung báº£ng sáº£n pháº©m trong máº«u in vÃ  chá»‰nh Ä‘á»™ Ä‘áº­m font ná»™i dung/header cá»§a báº£ng.

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.5.1 cho á»©ng dá»¥ng desktop, frontend, backend vÃ  cÃ¡c lockfile tÆ°Æ¡ng á»©ng.
- Táº¡o tag GitHub `v1.5.1` cho báº£n release nÃ y.

## v1.5.0 - 2026-06-06

### Thay Ä‘á»•i chÃ­nh

- Bá»• sung ná»n táº£ng module káº¿ toÃ¡n: schema JSON cho ledger, quá»¹ káº¿ toÃ¡n, tÃ i khoáº£n ngÃ¢n hÃ ng, cÃ´ng ná»£, hÃ³a Ä‘Æ¡n Ä‘iá»‡n tá»­, snapshot bÃ¡o cÃ¡o vÃ  nháº­t kÃ½ hoáº¡t Ä‘á»™ng.
- ThÃªm API/page káº¿ toÃ¡n cho tá»•ng quan doanh thu/lá»£i nhuáº­n, bÃ¡o cÃ¡o thuáº¿ GTGT, bÃ¡o cÃ¡o tá»“n kho vÃ  nháº­t kÃ½ hoáº¡t Ä‘á»™ng; há»— trá»£ phÃ¢n quyá»n má»›i cho káº¿ toÃ¡n, thu ngÃ¢n, nhÃ¢n viÃªn.
- Káº¿t ná»‘i luá»“ng bÃ¡n hÃ ng/nháº­p hÃ ng vá»›i káº¿ toÃ¡n: ghi bÃºt toÃ¡n, quá»¹, cÃ´ng ná»£, hÃ³a Ä‘Æ¡n Ä‘iá»‡n tá»­, Ä‘áº£o bÃºt toÃ¡n khi há»§y vÃ  log thao tÃ¡c nghiá»‡p vá»¥.
- Cáº£i thiá»‡n kiá»ƒm soÃ¡t tá»“n kho vÃ  thao tÃ¡c chá»n sá»‘ lÆ°á»£ng: bÃ¡o cÃ¡o tá»“n kho cÃ³ cáº£nh bÃ¡o sáº¯p háº¿t/háº¿t/Ã¢m kho, order/import picker dÃ¹ng QuantityStepper vÃ  kiá»ƒm tra Ã¢m kho.

### Váº­n hÃ nh vÃ  dá»¯ liá»‡u

- Táº¡o backup database JSON trÆ°á»›c migration káº¿ toÃ¡n vÃ  backup Ä‘á»‹nh ká»³/startup vá»›i retention cáº¥u hÃ¬nh Ä‘Æ°á»£c; tá»± dá»n Ä‘Æ¡n Ä‘Ã£ há»§y quÃ¡ 24 giá» khi táº£i danh sÃ¡ch hoáº·c theo lá»‹ch.
- Má»Ÿ rá»™ng sync metadata/pull cÃ³ giá»›i háº¡n cho cÃ¡c báº£ng káº¿ toÃ¡n má»›i Ä‘á»ƒ trÃ¡nh kÃ©o payload quÃ¡ lá»›n.

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.5.0 cho á»©ng dá»¥ng desktop, frontend, backend vÃ  cÃ¡c lockfile tÆ°Æ¡ng á»©ng.
- Cáº­p nháº­t tÃ i liá»‡u release, hÆ°á»›ng dáº«n táº£i/cÃ i Ä‘áº·t vÃ  manifest vÃ­ dá»¥ theo tag v1.5.0.
- GitHub Actions sáº½ build/publish installer Windows x64 vÃ  ia32 kÃ¨m latest.yml/update-manifest.json tá»« artifact thá»±c táº¿ sau khi push tag.

### LÆ°u Ã½ quan trá»ng

- Windows 10/11 64-bit nÃªn dÃ¹ng `banhangoffline-setup-v1.5.0-x64.exe`.
- Windows 32-bit hoáº·c mÃ¡y bÃ¡o â€œá»¨ng dá»¥ng nÃ y khÃ´ng thá»ƒ cháº¡y trÃªn PC cá»§a báº¡nâ€ nÃªn dÃ¹ng `banhangoffline-setup-v1.5.0-ia32.exe`.
- Chá»‰ táº£i bá»™ cÃ i tá»« GitHub Release chÃ­nh thá»©c cá»§a repo `Vankhadev/phanmemoffline`; khÃ´ng cháº¡y file náº¿u tÃªn, nguá»“n táº£i, SHA256 hoáº·c kÃ­ch thÆ°á»›c khÃ´ng khá»›p manifest phÃ¡t hÃ nh.
- NÃªn backup dá»¯ liá»‡u runtime trÆ°á»›c khi cáº­p nháº­t/cÃ i Ä‘áº·t phiÃªn báº£n má»›i, Ä‘áº·c biá»‡t vÃ¬ báº£n nÃ y cÃ³ migration schema káº¿ toÃ¡n vÃ  tá»± táº¡o backup trÆ°á»›c migration.
- Metadata production generated latest.yml/update-manifest.json chá»‰ sinh láº¡i tá»« installer thá»±c táº¿, khÃ´ng chá»‰nh tay trÆ°á»›c publish.

## v1.4.9 - 2026-06-03

### Thay Ä‘á»•i chÃ­nh

- Bá»• sung API tá»“n kho backend vÃ  route inventory Ä‘á»ƒ phá»¥c vá»¥ nghiá»‡p vá»¥ kho hÃ ng.
- Cáº£i thiá»‡n luá»“ng nháº­p hÃ ng, Ä‘á»“ng bá»™ vÃ  Ä‘iá»u chá»‰nh tá»“n kho giá»¯a backend vÃ  frontend.
- Cáº­p nháº­t giao diá»‡n kho hÃ ng/nháº­p hÃ ng Ä‘á»ƒ thao tÃ¡c tá»“n kho á»•n Ä‘á»‹nh hÆ¡n trong báº£n phÃ¡t hÃ nh nÃ y.

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.4.9 cho á»©ng dá»¥ng desktop, frontend, backend vÃ  cÃ¡c lockfile tÆ°Æ¡ng á»©ng.
- Cáº­p nháº­t tÃ i liá»‡u release, hÆ°á»›ng dáº«n táº£i/cÃ i Ä‘áº·t vÃ  manifest vÃ­ dá»¥ theo tag v1.4.9.
- GitHub Actions tiáº¿p tá»¥c build/publish installer Windows x64 vÃ  ia32 kÃ¨m latest.yml/update-manifest.json tá»« artifact thá»±c táº¿ sau khi push tag.

### LÆ°u Ã½ quan trá»ng

- Windows 10/11 64-bit nÃªn dÃ¹ng `banhangoffline-setup-v1.4.9-x64.exe`.
- Windows 32-bit hoáº·c mÃ¡y bÃ¡o â€œá»¨ng dá»¥ng nÃ y khÃ´ng thá»ƒ cháº¡y trÃªn PC cá»§a báº¡nâ€ nÃªn dÃ¹ng `banhangoffline-setup-v1.4.9-ia32.exe`.
- Chá»‰ táº£i bá»™ cÃ i tá»« GitHub Release chÃ­nh thá»©c cá»§a repo `Vankhadev/phanmemoffline`; khÃ´ng cháº¡y file náº¿u tÃªn, nguá»“n táº£i, SHA256 hoáº·c kÃ­ch thÆ°á»›c khÃ´ng khá»›p manifest phÃ¡t hÃ nh.
- NÃªn backup dá»¯ liá»‡u runtime trÆ°á»›c khi cáº­p nháº­t/cÃ i Ä‘áº·t phiÃªn báº£n má»›i.

## v1.4.8 - 2026-06-03

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.4.8 cho á»©ng dá»¥ng desktop, frontend, backend vÃ  cÃ¡c lockfile tÆ°Æ¡ng á»©ng.
- Cáº­p nháº­t tÃ i liá»‡u release, hÆ°á»›ng dáº«n táº£i/cÃ i Ä‘áº·t vÃ  manifest vÃ­ dá»¥ theo tag v1.4.8.
- GitHub Actions tiáº¿p tá»¥c build/publish installer Windows x64 vÃ  ia32 kÃ¨m latest.yml/update-manifest.json tá»« artifact thá»±c táº¿ sau khi push tag.

### LÆ°u Ã½ quan trá»ng

- Windows 10/11 64-bit nÃªn dÃ¹ng `banhangoffline-setup-v1.4.8-x64.exe`.
- Windows 32-bit hoáº·c mÃ¡y bÃ¡o â€œá»¨ng dá»¥ng nÃ y khÃ´ng thá»ƒ cháº¡y trÃªn PC cá»§a báº¡nâ€ nÃªn dÃ¹ng `banhangoffline-setup-v1.4.8-ia32.exe`.
- Chá»‰ táº£i bá»™ cÃ i tá»« GitHub Release chÃ­nh thá»©c cá»§a repo `Vankhadev/phanmemoffline`; khÃ´ng cháº¡y file náº¿u tÃªn, nguá»“n táº£i, SHA256 hoáº·c kÃ­ch thÆ°á»›c khÃ´ng khá»›p manifest phÃ¡t hÃ nh.
- NÃªn backup dá»¯ liá»‡u runtime trÆ°á»›c khi cáº­p nháº­t/cÃ i Ä‘áº·t phiÃªn báº£n má»›i.


## v1.4.7 - 2026-06-03

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.4.7 cho á»©ng dá»¥ng desktop, frontend, backend vÃ  cÃ¡c lockfile tÆ°Æ¡ng á»©ng.
- Cáº­p nháº­t tÃ i liá»‡u release, hÆ°á»›ng dáº«n táº£i/cÃ i Ä‘áº·t vÃ  manifest vÃ­ dá»¥ theo tag v1.4.7.
- GitHub Actions tiáº¿p tá»¥c build/publish installer Windows x64 vÃ  ia32 kÃ¨m latest.yml/update-manifest.json tá»« artifact thá»±c táº¿ sau khi push tag.

### LÆ°u Ã½ quan trá»ng

- Windows 10/11 64-bit nÃªn dÃ¹ng `banhangoffline-setup-v1.4.7-x64.exe`.
- Windows 32-bit hoáº·c mÃ¡y bÃ¡o â€œá»¨ng dá»¥ng nÃ y khÃ´ng thá»ƒ cháº¡y trÃªn PC cá»§a báº¡nâ€ nÃªn dÃ¹ng `banhangoffline-setup-v1.4.7-ia32.exe`.
- Chá»‰ táº£i bá»™ cÃ i tá»« GitHub Release chÃ­nh thá»©c cá»§a repo `Vankhadev/phanmemoffline`; khÃ´ng cháº¡y file náº¿u tÃªn, nguá»“n táº£i, SHA256 hoáº·c kÃ­ch thÆ°á»›c khÃ´ng khá»›p manifest phÃ¡t hÃ nh.
- NÃªn backup dá»¯ liá»‡u runtime trÆ°á»›c khi cáº­p nháº­t/cÃ i Ä‘áº·t phiÃªn báº£n má»›i.

## v1.4.6 - 2026-06-02

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.4.6 cho á»©ng dá»¥ng desktop, frontend, backend vÃ  cÃ¡c lockfile tÆ°Æ¡ng á»©ng.
- Cáº­p nháº­t tÃ i liá»‡u release, hÆ°á»›ng dáº«n táº£i/cÃ i Ä‘áº·t vÃ  manifest vÃ­ dá»¥ theo tag v1.4.6.
- Giá»¯ nguyÃªn metadata production generated cho tá»›i khi cÃ³ installer v1.4.6 thá»±c táº¿ Ä‘á»ƒ sinh láº¡i SHA/size an toÃ n.

### LÆ°u Ã½ quan trá»ng

- Windows 10/11 64-bit nÃªn dÃ¹ng `banhangoffline-setup-v1.4.6-x64.exe`.
- Windows 32-bit hoáº·c mÃ¡y bÃ¡o â€œá»¨ng dá»¥ng nÃ y khÃ´ng thá»ƒ cháº¡y trÃªn PC cá»§a báº¡nâ€ nÃªn dÃ¹ng `banhangoffline-setup-v1.4.6-ia32.exe`.
- Chá»‰ táº£i bá»™ cÃ i tá»« GitHub Release chÃ­nh thá»©c cá»§a repo `Vankhadev/phanmemoffline`; khÃ´ng cháº¡y file náº¿u tÃªn, nguá»“n táº£i, SHA256 hoáº·c kÃ­ch thÆ°á»›c khÃ´ng khá»›p manifest phÃ¡t hÃ nh.
- NÃªn backup dá»¯ liá»‡u runtime trÆ°á»›c khi cáº­p nháº­t/cÃ i Ä‘áº·t phiÃªn báº£n má»›i.

## v1.4.4 - 2026-06-02

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.4.4 cho á»©ng dá»¥ng desktop, frontend, backend vÃ  cÃ¡c lockfile tÆ°Æ¡ng á»©ng.
- Cáº­p nháº­t tÃ i liá»‡u release, hÆ°á»›ng dáº«n táº£i/cÃ i Ä‘áº·t vÃ  manifest vÃ­ dá»¥ theo tag v1.4.4.
- Giá»¯ nguyÃªn metadata production generated cho tá»›i khi cÃ³ installer v1.4.4 thá»±c táº¿ Ä‘á»ƒ sinh láº¡i SHA/size an toÃ n.

### LÆ°u Ã½ quan trá»ng

- Windows 10/11 64-bit nÃªn dÃ¹ng `banhangoffline-setup-v1.4.4-x64.exe`.
- Windows 32-bit hoáº·c mÃ¡y bÃ¡o â€œá»¨ng dá»¥ng nÃ y khÃ´ng thá»ƒ cháº¡y trÃªn PC cá»§a báº¡nâ€ nÃªn dÃ¹ng `banhangoffline-setup-v1.4.4-ia32.exe`.
- Chá»‰ táº£i bá»™ cÃ i tá»« GitHub Release chÃ­nh thá»©c cá»§a repo `Vankhadev/phanmemoffline`; khÃ´ng cháº¡y file náº¿u tÃªn, nguá»“n táº£i, SHA256 hoáº·c kÃ­ch thÆ°á»›c khÃ´ng khá»›p manifest phÃ¡t hÃ nh.
- NÃªn backup dá»¯ liá»‡u runtime trÆ°á»›c khi cáº­p nháº­t/cÃ i Ä‘áº·t phiÃªn báº£n má»›i.

## v1.4.3 - 2026-06-02

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.4.3 cho á»©ng dá»¥ng desktop, frontend, backend vÃ  cÃ¡c lockfile tÆ°Æ¡ng á»©ng.
- Cáº­p nháº­t changelog, tÃ i liá»‡u release, hÆ°á»›ng dáº«n táº£i/cÃ i Ä‘áº·t vÃ  manifest vÃ­ dá»¥ theo tag v1.4.3.
- Giá»¯ nguyÃªn metadata production generated cho tá»›i khi cÃ³ installer v1.4.3 thá»±c táº¿ Ä‘á»ƒ sinh láº¡i SHA/size an toÃ n.

### LÆ°u Ã½ quan trá»ng

- Windows 10/11 64-bit nÃªn dÃ¹ng `banhangoffline-setup-v1.4.3-x64.exe`.
- Windows 32-bit hoáº·c mÃ¡y bÃ¡o â€œá»¨ng dá»¥ng nÃ y khÃ´ng thá»ƒ cháº¡y trÃªn PC cá»§a báº¡nâ€ nÃªn dÃ¹ng `banhangoffline-setup-v1.4.3-ia32.exe`.
- Chá»‰ táº£i bá»™ cÃ i tá»« GitHub Release chÃ­nh thá»©c cá»§a repo `Vankhadev/phanmemoffline`; khÃ´ng cháº¡y file náº¿u tÃªn, nguá»“n táº£i, SHA256 hoáº·c kÃ­ch thÆ°á»›c khÃ´ng khá»›p manifest phÃ¡t hÃ nh.
- NÃªn backup dá»¯ liá»‡u runtime trÆ°á»›c khi cáº­p nháº­t/cÃ i Ä‘áº·t phiÃªn báº£n má»›i.

## v1.4.2 - 2026-06-01

### TÃ­nh nÄƒng vÃ  cáº£i tiáº¿n

- Bá»• sung module quáº£n lÃ½ máº«u in hÃ³a Ä‘Æ¡n vá»›i API backend, schema MySQL, upload asset an toÃ n vÃ  service CRUD/kÃ­ch hoáº¡t máº«u in.
- Cáº­p nháº­t frontend quáº£n lÃ½ máº«u in hÃ³a Ä‘Æ¡n gá»“m danh sÃ¡ch máº«u, form cáº¥u hÃ¬nh, xem trÆ°á»›c renderer vÃ  dá»¯ liá»‡u máº«u Ä‘á»ƒ kiá»ƒm tra bá»‘ cá»¥c.
- Káº¿t ná»‘i Ä‘iá»u hÆ°á»›ng, thiáº¿t láº­p, API client vÃ  dá»¯ liá»‡u in hÃ³a Ä‘Æ¡n Ä‘á»ƒ module máº«u in má»›i hoáº¡t Ä‘á»™ng á»•n Ä‘á»‹nh trong luá»“ng hiá»‡n táº¡i.

### QA vÃ  build

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.4.2 cho á»©ng dá»¥ng desktop, frontend, backend vÃ  cÃ¡c lockfile tÆ°Æ¡ng á»©ng.
- Kiá»ƒm tra cÃº phÃ¡p cÃ¡c file backend quan trá»ng má»›i/sá»­a báº±ng node --check.
- Kiá»ƒm tra kháº£ nÄƒng resolve driver mysql2/promise trong backend cho module máº«u in hÃ³a Ä‘Æ¡n.
- Build frontend production Ä‘á»ƒ xÃ¡c nháº­n bundle Vite há»£p lá»‡ trÆ°á»›c khi táº¡o tag phÃ¡t hÃ nh.

### LÆ°u Ã½ quan trá»ng

- Windows 10/11 64-bit nÃªn dÃ¹ng `banhangoffline-setup-v1.4.2-x64.exe`.
- Windows 32-bit hoáº·c mÃ¡y bÃ¡o â€œá»¨ng dá»¥ng nÃ y khÃ´ng thá»ƒ cháº¡y trÃªn PC cá»§a báº¡nâ€ nÃªn dÃ¹ng `banhangoffline-setup-v1.4.2-ia32.exe`.
- Chá»‰ táº£i bá»™ cÃ i tá»« GitHub Release chÃ­nh thá»©c cá»§a repo `Vankhadev/phanmemoffline`; khÃ´ng cháº¡y file náº¿u tÃªn, nguá»“n táº£i, SHA256 hoáº·c kÃ­ch thÆ°á»›c khÃ´ng khá»›p manifest phÃ¡t hÃ nh.
- NÃªn backup dá»¯ liá»‡u runtime trÆ°á»›c khi cáº­p nháº­t/cÃ i Ä‘áº·t phiÃªn báº£n má»›i.

## v1.4.0 - 2026-06-01

### TÃ­nh nÄƒng vÃ  cáº£i tiáº¿n

- Chuáº©n hÃ³a luá»“ng in hÃ³a Ä‘Æ¡n báº±ng trang in riÃªng theo mÃ£/ID Ä‘Æ¡n hÃ ng, há»— trá»£ má»Ÿ nhanh báº£n in tá»« táº¡o Ä‘Æ¡n vÃ  danh sÃ¡ch Ä‘Æ¡n hÃ ng.
- Cáº£i thiá»‡n danh sÃ¡ch Ä‘Æ¡n hÃ ng vá»›i dá»¯ liá»‡u tá»« API, nhÃ£n nguá»“n Ä‘Æ¡n, gá»™p dÃ²ng hÃ ng á»•n Ä‘á»‹nh hÆ¡n vÃ  xá»­ lÃ½ Ä‘Æ¡n offline rÃµ rÃ ng hÆ¡n.
- Bá»• sung láº¡i nghiá»‡p vá»¥ báº£ng lÆ°Æ¡ng nhÃ¢n viÃªn theo service/controller riÃªng, validation Ä‘áº§u vÃ o, tá»•ng há»£p lÆ°Æ¡ng vÃ  thao tÃ¡c thÃªm/sá»­a/xÃ³a má»m.
- Tinh gá»n module in legacy, bá» cÃ¡c route/component máº«u in cÅ© vÃ  cáº­p nháº­t dependency in/xuáº¥t file phÃ¹ há»£p frontend hiá»‡n táº¡i.

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.4.0 cho á»©ng dá»¥ng desktop, frontend, backend vÃ  cÃ¡c lockfile tÆ°Æ¡ng á»©ng.
- Cáº­p nháº­t tÃ i liá»‡u phÃ¡t hÃ nh, hÆ°á»›ng dáº«n táº£i/cÃ i Ä‘áº·t vÃ  manifest vÃ­ dá»¥ theo tag v1.4.0.
- GitHub Actions tiáº¿p tá»¥c build/publish installer Windows x64 vÃ  ia32 kÃ¨m latest.yml vÃ  update-manifest.json tá»« artifact thá»±c táº¿.

### LÆ°u Ã½ quan trá»ng

- Windows 10/11 64-bit nÃªn dÃ¹ng `banhangoffline-setup-v1.4.0-x64.exe`.
- Windows 32-bit hoáº·c mÃ¡y bÃ¡o â€œá»¨ng dá»¥ng nÃ y khÃ´ng thá»ƒ cháº¡y trÃªn PC cá»§a báº¡nâ€ nÃªn dÃ¹ng `banhangoffline-setup-v1.4.0-ia32.exe`.
- Chá»‰ táº£i bá»™ cÃ i tá»« GitHub Release chÃ­nh thá»©c cá»§a repo `Vankhadev/phanmemoffline`; khÃ´ng cháº¡y file náº¿u tÃªn, nguá»“n táº£i, SHA256 hoáº·c kÃ­ch thÆ°á»›c khÃ´ng khá»›p manifest phÃ¡t hÃ nh.
- NÃªn backup dá»¯ liá»‡u runtime trÆ°á»›c khi cáº­p nháº­t/cÃ i Ä‘áº·t phiÃªn báº£n má»›i.

## v1.3.9 - 2026-05-30

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.3.9 cho á»©ng dá»¥ng desktop, frontend, backend, lockfile vÃ  metadata cáº­p nháº­t Windows.
- Chuáº©n hÃ³a tÃ i liá»‡u release vÃ  hÆ°á»›ng dáº«n táº£i/cáº­p nháº­t theo tag v1.3.9.
- KhÃ´ng Ä‘Æ°a cÃ¡c thay Ä‘á»•i chÆ°a commit ngoÃ i pháº¡m vi release vÃ o commit phÃ¡t hÃ nh.

### LÆ°u Ã½ quan trá»ng

- Windows 10/11 64-bit nÃªn dÃ¹ng `banhangoffline-setup-v1.3.9-x64.exe`.
- Windows 32-bit hoáº·c mÃ¡y bÃ¡o â€œá»¨ng dá»¥ng nÃ y khÃ´ng thá»ƒ cháº¡y trÃªn PC cá»§a báº¡nâ€ nÃªn dÃ¹ng `banhangoffline-setup-v1.3.9-ia32.exe`.
- Chá»‰ táº£i bá»™ cÃ i tá»« GitHub Release chÃ­nh thá»©c cá»§a repo `Vankhadev/phanmemoffline`; khÃ´ng cháº¡y file náº¿u tÃªn, nguá»“n táº£i, SHA256 hoáº·c kÃ­ch thÆ°á»›c khÃ´ng khá»›p manifest phÃ¡t hÃ nh.
- NÃªn backup dá»¯ liá»‡u runtime trÆ°á»›c khi cáº­p nháº­t/cÃ i Ä‘áº·t phiÃªn báº£n má»›i.

## v1.3.8 - 2026-05-30

### Báº£ng phÃ¡t hÃ nh chÃ­nh thá»©c

| Háº¡ng má»¥c | Ná»™i dung |
| --- | --- |
| PhiÃªn báº£n | 1.3.8 |
| NgÃ y phÃ¡t hÃ nh | 2026-05-30 |
| Tráº¡ng thÃ¡i | Sáºµn sÃ ng cÃ´ng bá»‘ cho ngÆ°á»i dÃ¹ng Windows x64 vÃ  ia32 |
| Tá»•ng quan | Báº£n 1.3.8 táº­p trung á»•n Ä‘á»‹nh tráº£i nghiá»‡m in hÃ³a Ä‘Æ¡n A5, in tem sáº£n pháº©m vÃ  Ä‘á»“ng bá»™ metadata phÃ¡t hÃ nh Windows. |

### Ghi chÃº thay Ä‘á»•i tá»•ng quan

- Cáº£i thiá»‡n Ä‘á»™ chÃ­nh xÃ¡c khá»• giáº¥y, lá» vÃ  vá»‹ trÃ­ trang khi in hÃ³a Ä‘Æ¡n A5 trong cá»­a sá»• in cÅ©ng nhÆ° silent print.
- Chuáº©n hÃ³a luá»“ng in tem sáº£n pháº©m cho cáº£ dáº¡ng cuá»™n vÃ  dáº¡ng tá» A4/A5 Ä‘á»ƒ mÃ u in, vÃ¹ng in vÃ  cÄƒn trang nháº¥t quÃ¡n hÆ¡n.
- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.3.8 cho á»©ng dá»¥ng desktop, frontend, backend, metadata auto-update vÃ  tÃ i liá»‡u Ä‘i kÃ¨m.

### TÃ­nh nÄƒng má»›i

- ThÃªm demo hÃ³a Ä‘Æ¡n A5 Ä‘á»™c láº­p Ä‘á»ƒ kiá»ƒm tra nhanh layout, iframe in vÃ  tráº¡ng thÃ¡i nÃºt in trÆ°á»›c khi phÃ¡t hÃ nh.
- Bá»• sung Ä‘Ã¡nh dáº¥u trang A5 báº±ng lá»›p print-page trong renderer máº«u hÃ³a Ä‘Æ¡n Ä‘á»ƒ há»‡ thá»‘ng in nháº­n diá»‡n Ä‘Ãºng vÃ¹ng trang.
- HoÃ n thiá»‡n ghi chÃº phÃ¡t hÃ nh vÃ  metadata cho bá»™ cÃ i Windows x64/ia32 cá»§a phiÃªn báº£n 1.3.8.

### Lá»—i Ä‘Ã£ sá»­a

- Sá»­a tÃ¬nh tráº¡ng in hÃ³a Ä‘Æ¡n A5 bá»‹ lá»‡ch lá», sai zoom hoáº·c khÃ´ng cÄƒn tá»« gÃ³c trÃªn trÃ¡i trong cá»­a sá»• in vÃ  silent print.
- Giáº£m lá»—i vá»¡ bá»‘ cá»¥c báº£ng, hÃ¬nh áº£nh hoáº·c ná»™i dung hÃ³a Ä‘Æ¡n khi renderer máº«u in gáº·p dá»¯ liá»‡u dÃ i.
- Sá»­a Ä‘á»™ khÃ´ng nháº¥t quÃ¡n vá» khá»• giáº¥y, lá» vÃ  mÃ u in giá»¯a in tem dáº¡ng cuá»™n vá»›i in tem dáº¡ng tá» A4/A5.

### Cáº£i tiáº¿n hiá»‡u nÄƒng

- Tá»‘i Æ°u CSS print theo Ä‘Ãºng khá»• 148mm x 210mm vÃ  vÃ¹ng in thá»±c táº¿ Ä‘á»ƒ trÃ¬nh in dá»±ng trang á»•n Ä‘á»‹nh hÆ¡n.
- Ãp dá»¥ng guard bá»‘ cá»¥c cho báº£ng/hÃ¬nh áº£nh nháº±m giáº£m reflow vÃ  háº¡n cháº¿ pháº£i cÄƒn chá»‰nh thá»§ cÃ´ng trÆ°á»›c khi in.
- Chuáº©n hÃ³a metadata auto-update Ä‘á»ƒ quy trÃ¬nh kiá»ƒm tra phiÃªn báº£n, kÃ­ch thÆ°á»›c vÃ  hash installer cho x64/ia32 rÃµ rÃ ng hÆ¡n.

### LÆ°u Ã½ quan trá»ng

- Windows 10/11 64-bit nÃªn dÃ¹ng `banhangoffline-setup-v1.3.8-x64.exe`.
- Windows 32-bit hoáº·c mÃ¡y bÃ¡o â€œá»¨ng dá»¥ng nÃ y khÃ´ng thá»ƒ cháº¡y trÃªn PC cá»§a báº¡nâ€ nÃªn dÃ¹ng `banhangoffline-setup-v1.3.8-ia32.exe`.
- Chá»‰ táº£i bá»™ cÃ i tá»« GitHub Release chÃ­nh thá»©c cá»§a repo `Vankhadev/phanmemoffline`; khÃ´ng cháº¡y file náº¿u tÃªn, nguá»“n táº£i, SHA256 hoáº·c kÃ­ch thÆ°á»›c khÃ´ng khá»›p manifest phÃ¡t hÃ nh.
- NÃªn backup dá»¯ liá»‡u runtime trÆ°á»›c khi cáº­p nháº­t/cÃ i Ä‘áº·t phiÃªn báº£n má»›i.

## v1.3.7 - 2026-05-27

### Cáº£i thiá»‡n in hÃ³a Ä‘Æ¡n

- ThÃªm API backend `/api/invoices/:id/print-data` Ä‘á»ƒ chuáº©n hÃ³a dá»¯ liá»‡u in hÃ³a Ä‘Æ¡n A5 cho hÃ³a Ä‘Æ¡n online, bao gá»“m khÃ¡ch hÃ ng, ngÆ°á»i láº­p, chi tiáº¿t hÃ ng vÃ  tráº¡ng thÃ¡i thanh toÃ¡n.
- Cáº­p nháº­t mÃ n `OrderList` Ä‘á»ƒ Æ°u tiÃªn táº£i dá»¯ liá»‡u in tá»« server cho hÃ³a Ä‘Æ¡n Ä‘Ã£ lÆ°u vÃ  tá»± fallback vá» dá»¯ liá»‡u local/offline khi cáº§n.
- Tinh chá»‰nh renderer máº«u in vÃ  silent print Electron Ä‘á»ƒ báº£n xem trÆ°á»›c/in A5 giá»¯ Ä‘Ãºng kÃ­ch thÆ°á»›c trang, lá» vÃ  zoom.

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.3.7 cho á»©ng dá»¥ng desktop, metadata auto-update vÃ  tÃ i liá»‡u Ä‘i kÃ¨m.

## v1.3.6 - 2026-05-27

### PhÃ¡t hÃ nh

- Äá»“ng bá»™ version phÃ¡t hÃ nh 1.3.6 cho á»©ng dá»¥ng desktop, metadata auto-update vÃ  tÃ i liá»‡u Ä‘i kÃ¨m.
- KhÃ´ng thay Ä‘á»•i tÃ­nh nÄƒng; báº£n nÃ y táº­p trung chuáº©n hÃ³a metadata release vÃ  hÆ°á»›ng dáº«n táº£i/cáº­p nháº­t.

## v1.3.5 - 2026-05-25

### Sá»­a lá»—i phÃ¡t hÃ nh Windows

- Táº¡o installer riÃªng cho Windows 64-bit (`x64`) vÃ  Windows 32-bit (`ia32`) vá»›i tÃªn asset rÃµ kiáº¿n trÃºc.
- Sinh láº¡i `latest.yml` vÃ  `update-manifest.json` tá»« installer thá»±c Ä‘á»ƒ trÃ¡nh version/hash/size lá»‡ch release.
- ThÃªm kiá»ƒm tra local/remote báº±ng PowerShell cho HTTP 200, Content-Type, kÃ­ch thÆ°á»›c, header MZ/PE vÃ  SHA256.
- Cáº­p nháº­t mÃ n cáº­p nháº­t trong á»©ng dá»¥ng Ä‘á»ƒ hiá»ƒn thá»‹ kiáº¿n trÃºc runtime, bá»™ cÃ i khuyáº¿n nghá»‹ vÃ  cáº£nh bÃ¡o náº¿u mÃ¡y khÃ´ng tÆ°Æ¡ng thÃ­ch.
- Cháº·n má»Ÿ link táº£i thá»§ cÃ´ng náº¿u URL tráº£ HTML, HTTP lá»—i, tÃªn file khÃ´ng Ä‘Ãºng kiáº¿n trÃºc hoáº·c file quÃ¡ nhá».
- Cáº­p nháº­t workflow GitHub Actions Ä‘á»ƒ build/publish Ä‘á»§ asset x64/ia32 vÃ  verify public release.

### HÆ°á»›ng dáº«n ngÆ°á»i dÃ¹ng

- Windows 10/11 thÃ´ng thÆ°á»ng: dÃ¹ng `banhangoffline-setup-v1.3.5-x64.exe`.
- Windows 32-bit hoáº·c mÃ¡y bÃ¡o â€œá»¨ng dá»¥ng nÃ y khÃ´ng thá»ƒ cháº¡y trÃªn PC cá»§a báº¡nâ€: dÃ¹ng `banhangoffline-setup-v1.3.5-ia32.exe`.
- Chá»‰ táº£i tá»« GitHub Release chÃ­nh thá»©c cá»§a repo `Vankhadev/phanmemoffline`.


## 2026-06-29 - Sửa cơ chế khôi phục dữ liệu tự động

- Thêm `RecoveryEngine` cho backend: tự tạo backup trước restore, quét backup, giải nén file nén, parse dữ liệu và merge vào database hiện tại thay vì ghi đè bằng 1 file backup mới nhất.
- Hỗ trợ chống trùng cho đơn hàng, chi tiết đơn, sản phẩm, khách hàng, nhà cung cấp, phiếu nhập, chi tiết nhập và các bảng cấu hình/mẫu in theo khóa nghiệp vụ + hash fallback.
- Bổ sung cơ chế merge field an toàn: không ghi đè dữ liệu tốt bằng null/rỗng; dữ liệu lịch sử giữ nguyên giá bán/giá nhập/lợi nhuận, chỉ bổ sung field thiếu.
- Thêm rollback nếu restore lỗi hoặc validation sau restore phát hiện bảng quan trọng bị giảm số lượng.
- Tạo log chi tiết tại `logs/recovery/recovery_YYYYMMDD_HHmmss.json` gồm file tìm thấy, file giải nén, file lỗi, số lượng restore/bỏ qua và trạng thái rollback.
- Thêm API `/api/recovery/*` và chuyển endpoint cũ `/api/database/restore-scan` sang cơ chế merge an toàn.
- Tích hợp chạy recovery nền khi backend mở app (`KHA_RECOVERY_AUTO_ON_START=0` để tắt nếu cần) để không làm treo giao diện.
- Thêm tab `Cài đặt → Khôi phục DL` với các nút quét/khôi phục, xem file backup, xem log, xuất báo cáo và rollback bản trước restore.
- Thêm script test `scripts/test-recovery.js` kiểm tra merge nhiều backup, đơn trùng, đơn thiếu, productId không tồn tại, null/rỗng và không nhân đôi khi chạy lại.

## v2.3.7 - 2026-06-29

- Nâng version ứng dụng lên 2.3.7.
- Đóng gói thay đổi RecoveryEngine, giao diện Khôi phục DL, API recovery và test khôi phục dữ liệu.




