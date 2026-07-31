# Release v2.4.10

## Database safety and inventory integrity

- Refuse backup artifacts as the active `DB_PATH`.
- Do not auto-select, delete, or repoint to a scanned database during startup recovery.
- Create verified JSON backups with manifest, record counts, integrity status, file size, and SHA-256 checksum.
- Restore only verified backups through a staged file and rollback backup.
- Preserve manual SKU snapshots on invoice details.
- Add append-only inventory transaction records with invoice reference and revision metadata.
- Reject duplicate active SKUs during product, variant, and CSV import operations.

## Relational SQLite compatibility layer

- Add foundational relational schema with account-scoped composite foreign keys.
- Add transactional order creation and inventory movement repositories.
- Enforce immutable inventory movements and cash ledger rows.
- Add regression tests for account isolation, duplicate SKUs, inventory constraints, order totals, and rollback.
- Keep the existing JSON database as the current production source of truth; relational cutover is not enabled by this release.

## Verification

- `npm run test:data-safety`
- `npm run test:db-relations`
- `npm run test:sqlite-driver:node`
- `npm run test:sqlite-driver:electron`
- `npm run test:repeat-sku-orders`
- `npm run healthcheck`
- `npm --prefix frontend run build`

Tag: `v2.4.10`
