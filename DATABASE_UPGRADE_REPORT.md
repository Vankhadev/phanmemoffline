# DATABASE_UPGRADE_REPORT.md

## 1. Tổng quan

Backend hiện tại là **Node.js + Express**. Cơ sở dữ liệu chính hiện tại là **JSON file database** với cơ chế **SQLite write-through tùy chọn** đã có sẵn trong `backend/src/db/database.js`.

Nâng cấp lần này được thực hiện theo nguyên tắc **không phá vỡ dữ liệu cũ**:

- Không xóa database cũ.
- Không reset dữ liệu.
- Không tạo database rỗng thay thế database đang dùng.
- Không đổi tên/xóa field legacy đang được frontend sử dụng.
- Chỉ thêm bảng compatibility/mirror để chuẩn hóa quan hệ và phục vụ migration/report.

## 2. Database trước khi nâng cấp

Database được backend tự chọn theo resolver hiện có:

```text
E:\backup_du_lieu_phan_mem_no_del\database\kha-backup-DiygX4\database.json
```

Loại database:

```text
json-file-with-optional-sqlite-write-through
```

Số liệu nghiệp vụ trước migration:

| Loại dữ liệu | Số lượng |
|---|---:|
| Sản phẩm | 1302 |
| Khách hàng | 5 |
| Đơn hàng / hóa đơn | 1055 |
| Phiếu nhập | 11 |
| Nhà cung cấp / đối tác | 4 |
| Mẫu in | 14 |

## 3. Backup trước migration

Migration đã tạo backup bắt buộc trước khi ghi dữ liệu:

```text
E:\backup_du_lieu_phan_mem_no_del\database\kha-backup-DiygX4\backup_du_lieu_phan_mem_no_del\pre_migration\2026-07-07_05-37-24
```

Ngoài ra backend vẫn giữ cơ chế backup zip hiện có trước migration.

Backup manifest gồm:

- Thời gian backup.
- Đường dẫn database.
- Danh sách file được copy.
- Dung lượng từng file.
- SHA256 checksum từng file.
- Snapshot schema hiện tại.
- Số lượng dữ liệu nghiệp vụ chính.

Nếu backup bắt buộc thất bại, migration sẽ dừng và không ghi dữ liệu.

## 4. Bảng/collection đã thêm

Các bảng compatibility được thêm theo hướng additive, không thay thế bảng legacy:

- `categories`
- `suppliers`
- `product_variants`
- `inventory_batches`
- `imports`
- `import_items`
- `orders`
- `order_items`
- `payments`
- `cash_ledger`
- `app_settings`
- `invoice_templates`
- `backup_files`
- `restore_jobs`
- `schema_migrations`
- `migration_quarantine`

Các bảng này được thêm vào:

- `SCHEMA`
- `INITIAL_NEXT_ID`
- `ACCOUNT_SCOPED_TABLES`
- `SYNC_TRACKED_TABLES`

## 5. Field/logic đã thêm

### Sản phẩm

Migration bổ sung an toàn trên dữ liệu sản phẩm legacy:

- `deleted_at` nếu chưa có.
- `is_active` nếu chưa có.
- `version` nếu chưa có.
- `internal_code` nếu chưa có.
- `rel_category_id` để map sang bảng `categories` mới khi có category legacy.

### Đơn hàng / order_items

`orders` được mirror từ `invoices` với các snapshot:

- `order_code`
- `customer_id`
- `customer_name_snapshot`
- `customer_phone_snapshot`
- `status`
- `subtotal`
- `discount_total`
- `tax_total`
- `total_amount`
- `paid_amount`
- `debt_amount`
- `profit_amount`
- `note`
- `deleted_at`

`order_items` được mirror từ `invoice_details` với các snapshot:

- `product_name_snapshot`
- `product_sku_snapshot`
- `unit_name_snapshot`
- `quantity`
- `import_price_snapshot`
- `sale_price_snapshot`
- `discount_amount`
- `tax_rate`
- `tax_amount`
- `line_total`
- `profit_amount`
- `cost_source`

Các dòng thiếu hoặc sai `product_id` không bị xóa; chúng được chuyển sang `line_type = CUSTOM` nếu không xác định được sản phẩm.

## 6. Quan hệ dữ liệu đã tạo ở mức compatibility

Do backend hiện tại dùng JSON database, không có foreign key vật lý như SQL. Migration tạo quan hệ logic bằng các trường ID mirror:

- `products.rel_category_id -> categories.id`
- `imports.supplier_id -> suppliers/source partner id`
- `import_items.import_id -> imports.id`
- `import_items.product_id -> products.id`
- `inventory_batches.product_id -> products.id`
- `inventory_batches.import_item_id -> import_items.id`
- `orders.customer_id -> customers.id` nullable
- `order_items.order_id -> orders.id`
- `order_items.product_id -> products.id` nullable
- `payments.order_id -> orders.id`
- `cash_ledger.reference_type + reference_id` giữ reference nghiệp vụ rõ ràng

## 7. Kết quả sau migration

Số liệu nghiệp vụ sau migration:

| Loại dữ liệu | Số lượng |
|---|---:|
| Sản phẩm | 1302 |
| Khách hàng | 5 |
| Đơn hàng / hóa đơn | 1055 |
| Phiếu nhập | 11 |
| Nhà cung cấp / đối tác | 4 |
| Mẫu in | 14 |

Số liệu compatibility tables:

| Bảng | Số lượng |
|---|---:|
| categories | 4 |
| suppliers | 4 |
| orders | 1048 |
| order_items | 1052 |
| imports | 11 |
| import_items | 11 |
| inventory_batches | 11 |
| payments | 14 |
| cash_ledger | 1 |
| invoice_templates | 14 |
| app_settings | 4 |
| backup_files | 77 |
| restore_jobs | 0 |
| schema_migrations | 1 |
| migration_quarantine | 4 |

Migration id:

```text
20260707_relational_compatibility_v1
```

Trạng thái:

```text
success
```

## 8. Dữ liệu đưa vào quarantine

Có 4 record được đưa vào `migration_quarantine` để admin xử lý sau:

| Entity | ID | Lý do |
|---|---:|---|
| invoice_detail | 1023 | missing_product_name_snapshot |
| invoice_detail | 1023 | missing_import_price_snapshot |
| invoice_detail | 2001 | missing_import_price_snapshot |
| invoice_detail | 835379 | missing_import_price_snapshot |

Không record nào bị xóa.

## 9. API đã chuẩn hóa / thêm alias

Đã thêm các endpoint database chuẩn:

- `GET /api/db/status`
- `POST /api/db/backup`
- `POST /api/db/migrate`
- `GET /api/db/migration-report`

Giữ tương thích endpoint cũ:

- `/api/database/*`

Thêm alias route nghiệp vụ:

- `/api/orders` trỏ tới invoices routes hiện có.
- `/api/suppliers` trỏ tới partners routes hiện có.
- `/api/invoice-templates` trỏ tới print template routes hiện có nếu mount tương ứng khả dụng trong server file.

## 10. Transaction / rollback

Migration chạy trong `withAtomicDbWrite()`:

- Nếu có lỗi trong quá trình ghi, database memory state được rollback.
- SQLite write-through nếu bật cũng được begin/commit/rollback theo cơ chế hiện có.
- File JSON chỉ save khi toàn bộ callback thành công.

## 11. Audit log

Migration ghi audit action:

```text
MIGRATE
```

Backup API ghi audit action:

```text
BACKUP
```

Nếu auto migration compatibility lỗi ở startup, backend không chết; lỗi được log và cố gắng ghi audit `MIGRATE_FAILED`.

## 12. Cách rollback

Rollback thủ công an toàn:

1. Dừng backend/app.
2. Lấy file database trong thư mục backup pre-migration:

```text
E:\backup_du_lieu_phan_mem_no_del\database\kha-backup-DiygX4\backup_du_lieu_phan_mem_no_del\pre_migration\2026-07-07_05-37-24\database.json
```

3. Copy đè lại database chính:

```text
E:\backup_du_lieu_phan_mem_no_del\database\kha-backup-DiygX4\database.json
```

4. Khởi động lại backend.
5. Kiểm tra `GET /api/db/status`.

## 13. Cách chạy backend

Từ thư mục gốc project:

```bash
npm run dev:backend
```

Hoặc từ thư mục backend:

```bash
npm start
```

## 14. Cách kiểm tra API health

```bash
curl http://127.0.0.1:PORT/api/health
curl http://127.0.0.1:PORT/api/db/status
curl http://127.0.0.1:PORT/api/db/migration-report
```

Thay `PORT` bằng port backend thực tế.

## 15. Test đã chạy

| Test | Kết quả |
|---|---|
| Syntax check `backend/src/db/database.js` | Pass |
| Syntax check `backend/src/routes/database.js` | Pass |
| Syntax check `backend/src/server.js` | Pass |
| Chạy migration trên DB thực tế | Pass |
| Backup trước migration | Pass |
| Re-run migration lần 2 không tăng duplicate counts | Pass |
| Count sản phẩm/khách hàng/đơn hàng/nhập hàng không giảm | Pass |
| Quarantine dữ liệu lỗi thay vì xóa | Pass |

## 16. Ghi chú quan trọng

- Project hiện tại chưa được chuyển sang relational SQL thuần vì việc đó sẽ thay đổi lớn toàn bộ API/frontend và có rủi ro mất khả năng đọc dữ liệu cũ.
- Nâng cấp hiện tại là bước hardening an toàn: thêm compatibility relational layer, manifest backup, migration report, quarantine và API chuẩn.
- Không sửa frontend để che lỗi backend.
- Không tạo mock data.
- Không xóa dữ liệu cũ.
