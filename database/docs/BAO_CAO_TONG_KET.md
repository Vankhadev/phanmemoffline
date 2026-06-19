# BÁO CÁO NÂNG CẤP DATABASE — PRODUCTION ENTERPRISE
Phần mềm bán hàng offline | SQLite Enterprise Edition

## 1. HIỆN TRẠNG ĐÃ QUÉT

| Hạng mục | Kết quả thực tế |
|---|---|
| schema.sql | KHÔNG tồn tại |
| migrations/ | Chỉ có 1 file MySQL (`20260611_fix_order_sku_indexes.sql`) |
| models/ | KHÔNG tồn tại (không dùng ORM) |
| repositories/ | KHÔNG tồn tại |
| sqlite database | KHÔNG tồn tại |
| DB thực tế đang chạy | **JSON document store**: `phanmienoffline.db.json` (~9MB) |
| DB layer | `backend/src/db/database.js` (2703 dòng, tự viết) |
| Nhánh phụ | MySQL tùy chọn (`mysql2`, `*MySql.js`) |

Kết luận: phần mềm KHÔNG dùng SQLite. Toàn bộ dữ liệu nằm trong 1 file JSON,
phục vụ qua DB layer tự viết. Vì vậy không thể "sửa SQLite" — phải XÂY MỚI
schema SQLite Enterprise + script di trú JSON -> SQLite không phá dữ liệu cũ.

## 2. VẤN ĐỀ PHÁT HIỆN TRONG DỮ LIỆU THẬT

| Vấn đề | Chi tiết | Cách xử lý |
|---|---|---|
| SKU trùng | `PVN631` xuất hiện 2 lần | Tự thêm hậu tố `-DUP2`, GIỮ lại sản phẩm + ghi cảnh báo |
| barcode chứa text mô tả | 7 nhóm "barcode" thực ra là tên hàng | Bỏ UNIQUE trên barcode, chỉ index thường |
| cash amount = 0 | 4 giao dịch số tiền 0đ | Đổi CHECK sang `amount >= 0` để không mất |
| audit action tự do | `auth.login`, `sapo.config.create`... | Bỏ ràng buộc cứng cho cột action |
| Không có khóa ngoại | JSON không ràng buộc quan hệ | Thêm đầy đủ FOREIGN KEY trong SQLite |
| Không có index tối ưu | JSON quét tuyến tính | Thêm 63 index cho 100k KH / 1tr đơn / 500k SP |

## 3. KIẾN TRÚC MỚI (CHUẨN 3NF)

22 bảng + 6 view báo cáo + 7 trigger toàn vẹn.
Tách bảng chuẩn hóa: customer_ranks, categories, units (loại bỏ dữ liệu lặp).

Module: accounts, users, customer_ranks, customers, categories, units, products,
inventory_transactions, orders, order_items, debts, debt_payments,
cash_transactions, suppliers, purchase_orders, purchase_order_items,
return_orders, return_order_items, audit_logs, backup_history, schema_migrations.

## 4. KIỂM CHỨNG DI TRÚ DỮ LIỆU (KHÔNG MẤT DÒNG NÀO)

| Collection | JSON gốc | SQLite | Kết quả |
|---|---|---|---|
| products | 1298 | 1298 | OK |
| customers | 1 | 1 | OK |
| orders | 14 | 14 | OK |
| order_items | 15 | 15 | OK |
| cash_book | 13 | 13 | OK |
| audit_logs | 66 | 66 | OK |
| suppliers | 3 | 3 | OK |
| categories | 4 | 4 | OK |
| customer_ranks | 3 | 3 | OK |

skipped = 0 | FK violations = 0 | integrity_check = ok

## 5. TỐI ƯU HIỆU NĂNG SQLITE

- journal_mode = WAL (an toàn khi mất điện)
- synchronous = NORMAL (nhanh + an toàn với WAL)
- foreign_keys = ON
- busy_timeout = 5000ms
- temp_store = MEMORY, cache ~16MB
- Transaction batching trong toàn bộ script di trú
- 63 index phủ các báo cáo: doanh thu, lợi nhuận, công nợ, tồn kho, khách hàng

## 6. AN TOÀN KHI KHÁCH UPDATE VERSION

- Migration runner idempotent: chạy lại nhiều lần không lỗi, không mất dữ liệu
- Bảng schema_migrations theo dõi version đã áp dụng
- Mọi CREATE đều IF NOT EXISTS; mọi seed dùng ON CONFLICT DO NOTHING
- Script di trú KHÔNG xóa file JSON cũ (đọc-only nguồn)
- Mọi dòng lỗi đều hiện trong report.warnings thay vì bị bỏ âm thầm
