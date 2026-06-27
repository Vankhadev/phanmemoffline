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