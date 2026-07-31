# Migration And Rollback Plan

## Preconditions

1. Add a maintenance/write lock so no business mutation enters during cutover.
2. Capture the active JSON path from `KHA_DB_PATH` and copy the JSON database without changing it.
3. Copy any existing SQLite database together with `-wal` and `-shm` files.
4. Produce a manifest containing absolute paths, byte sizes, SHA-256 hashes, time, source collection counts, totals, stock, and debt aggregates.
5. Run all work against a new temporary SQLite file. Never overwrite the active JSON database or an existing SQLite file.

## Migration Procedure

1. Open the target using `sqlite3`, set `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=NORMAL`, and `busy_timeout=5000`.
2. Run `relational-001` idempotently and save its checksum in `schema_migrations`.
3. Load master records in dependency order: account/security, customer/supplier/categories/units, products, variants, warehouses.
4. Load draft/posted headers, then details, then append-only inventory/cash/accounting records with deterministic idempotency keys.
5. For every failure, write `migration_quarantine(source_table, source_id, account_id, reason, raw_payload, suggested_resolution)` in the same migration report. Do not discard a source row.
6. Run counts and financial/inventory/debt reconciliation against the frozen manifest.
7. Run `PRAGMA integrity_check` and `PRAGMA foreign_key_check`.
8. Refuse cutover for a critical quarantine item or any reconciliation/integrity failure.
9. On success, switch only backend configuration to the verified target SQLite path and mark JSON read-only archival. Do not retain JSON writes.

## Rollback

1. Enable maintenance mode and stop backend writes.
2. Preserve the failed target SQLite file, WAL/SHM, logs, migration report, and quarantine report for diagnosis.
3. Restore the exact verified JSON backup with its manifest, using a staging file plus checksum/parse validation then atomic rename.
4. Restart backend against the old JSON path only if relational cutover was not committed, or restore a verified prior SQLite backup if cutover had committed.
5. Reconcile count, total, inventory, and debt against the pre-cutover manifest before reopening writes.
6. Test this full restore process on a copy before production cutover.

## Mandatory Tests Before Cutover

- Re-run migration twice: no duplicate target rows or duplicate movements.
- Test numeric `123456`, manual `MA-HANG-CU-01`, and generated `SP000435` SKU.
- Test cross-account FKs, duplicate SKU/code, missing header, non-positive quantity, invalid total, overpayment, duplicate inventory movement, immutable ledger mutation, negative stock, and forbidden deletes.
- Test create/update/cancel order, create/update/cancel receipt, both return types, payment/debt allocations, backup and restore.
- Build frontend and run backend tests.
- Smoke test both packaged Windows x64 and ia32 artifacts on environments that match the delivered Electron version. Confirm database driver load, database creation, create/list/cancel order, import, backup, and restore.

## Current Completion State

The relational schema and an isolated transaction test have been added, but the deployed backend remains JSON-canonical. Migration transformers, all module repositories, cutover feature flag, full backup/restore target implementation, and Electron package tests are not yet complete. Cutover must not be enabled from this change alone.
