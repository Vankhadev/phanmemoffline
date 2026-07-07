# Release v2.4.7

## Backend & Database hardening

- Mandatory pre-migration backup: backup_du_lieu_phan_mem_no_del/pre_migration/YYYY-MM-DD_HH-mm-ss/ + manifest.json (SHA256, counts).
- Relational compatibility layer: them 15 bang mirror (orders, order_items, imports, import_items, inventory_batches, suppliers, categories, payments, cash_ledger, schema_migrations, migration_quarantine...) KHONG xoa/doi ten bang legacy.
- Snapshot gia nhap/ban trong order_items (import_price_snapshot, sale_price_snapshot, product_name_snapshot). Don cu khong bi doi loi nhuan.
- Soft-delete toan bo (deleted_at, is_active, soft_delete_reason). Khong hard-delete don/san pham/khach hang/phieu nhap.
- Transaction (withAtomicDbWrite) + validation nghiem ngat (backend tu tinh tong tien, validate NaN/null/product_id/line_type).
- API moi: /api/db/status, /api/db/backup, /api/db/migrate, /api/db/migration-report.
- API mo rong (phan trang/search/filter): /api/expanded/orders, /suppliers, /products, /payments, /cash-ledger, /inventory-batches, /audit-logs, /invoice-templates.
- SQLite expression index cho order_code, created_at, customer_id, sku, invoice_code, product_id, reference_type... (json_extract).
- Migration idempotent + migration_quarantine cho record loi.
- Audit log (MIGRATE, BACKUP, DELETE_SOFT, RESTORE) + DATABASE_UPGRADE_REPORT.md.

Khong reset database, khong xoa du lieu cu.

## Files changed
- backend/src/db/database.js
- backend/src/db/sqliteEngine.js
- backend/src/routes/database.js
- backend/src/routes/expanded.js (moi)
- backend/src/server.js
- package.json, backend/package.json, frontend/package.json (2.4.7)
- DATABASE_UPGRADE_REPORT.md

## How to test
npm run dev:backend
curl http://127.0.0.1:7000/api/db/status
curl http://127.0.0.1:7000/api/expanded/orders?limit=20

Tag: v2.4.7
