# Current Database Audit

## Scope

This audit was performed from source code and local dependency inspection on 2026-07-18. No customer database was migrated, restored, or altered. Therefore packaged Electron x64/ia32 operation has not been verified on a clean Windows machine.

## Runtime Source Of Truth

The production backend currently uses the JSON file configured by `KHA_DB_PATH` as its business source of truth.

- `src/main.js` starts Electron's backend with `KHA_DB_PATH=<userData>/phanmienoffline.db.json`.
- `backend/src/db/database.js` loads that JSON file into memory and `getAll`, `getOne`, `insert`, `update`, and `remove` operate on arrays in that in-memory object.
- `saveDB()` atomically replaces the JSON file. `withAtomicDbWrite()` is an in-memory snapshot plus JSON-file write, not a relational database transaction.
- `/api/database/status` explicitly reports `json-file-with-optional-sqlite-write-through` in `backend/src/routes/database.js`.

## SQLite Status

SQLite is not a relational source of truth today.

- `backend/src/db/sqliteEngine.js` stores one `coll_<collection>` table per JSON collection and serializes every business record into a `data TEXT` JSON blob.
- It sets `PRAGMA foreign_keys = OFF` and catches write errors in the JSON layer, then continues. It cannot enforce business relations or guarantee no split-brain state.
- It uses `node:sqlite`, which needs Node 22.5+. Electron is pinned to 28.2.2, whose embedded Node runtime is Node 18; `node:sqlite` is therefore not a packaging-safe choice.
- Existing SQL files in `database/migrations/` and `backend/migrations/` have no startup migration runner. They are not executed when the backend starts.

The backend dependency list had no supported SQLite native driver before this work. `sqlite3@5.1.7` was selected for the target path because it provides prebuilt Windows x64 and ia32 binaries for its supported Node ABI range; the packaged Electron smoke test still must validate the exact Electron ABI artifact.

## Canonical Legacy Flows

| Domain | Actual write/read collections | Evidence |
|---|---|---|
| Sale invoice/order | `invoices`, `invoice_details` | `invoiceCreationService.js`, `routes/invoices.js` |
| Import receipt | `import_logs`, `import_details` | `routes/imports.js` |
| Product and variant | `products`; `parent_id` models variant | `routes/products.js` |
| Supplier | `partners` | `routes/partners.js`, `routes/imports.js` |
| Return | `return_logs`, `return_details` | `routes/returns.js` |
| Cash | `cash_book` | `invoiceCreationService.js`, `routes/cashbook.js` |
| Inventory | mutable `products.stock`, optional `inventory_transactions` | `negativeStock.js`, `routes/imports.js` |

`orders`/`order_items`, `imports`/`import_items`, `suppliers`, `payments`, `cash_ledger`, and `migration_quarantine` are compatibility/mirror collections listed in `database.js`. They are not the canonical collections used by the current invoice/import routes.

## Existing Safety Gaps

- JSON and SQLite mirror both receive writes; errors from mirror writes are swallowed.
- Foreign-key and account-boundary enforcement is application-level and incomplete.
- The same invoice/import business action updates headers, details, stock, accounting and cash through JSON mutation rather than DB constraints.
- Import and invoice details may be physically replaced during edit.
- Existing `inventory_transactions` and `cash_book` are mutable legacy records, not immutable ledgers.
- The current route layer directly coordinates multiple collections.

## Existing Data Collections

`SCHEMA` in `backend/src/db/database.js` defines the current data inventory: accounts/security; settings/store; customers/products/partners/combos; legacy invoices/imports/returns; cash/accounting/debt/report/e-invoice/payroll; Excel/marketplace/print/sync/update; and compatibility collections. No legacy collection may be dropped until an explicit mapping and reconciliation has passed.

## Verification Performed

- Local development Node is `v24.14.0`, so its support for `node:sqlite` does not prove Electron 28 support.
- `npm --prefix backend run test:relational-sqlite` passed for the newly added relational target schema.
- No live JSON data, Electron package, x64 executable, ia32 executable, backup artifact, or restore artifact was modified or validated.
