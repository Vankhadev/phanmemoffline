# Legacy JSON To Relational Mapping

## Mapping Rules

1. Read one frozen JSON snapshot only. Do not migrate from the optional `coll_*` SQLite mirror.
2. Record source identity in a mapping table before/with each target upsert: `(source_table, source_id)` must be unique.
3. Preserve raw JSON and error reason in `migration_quarantine`; never silently skip or silently rewrite a row.
4. Never generate a replacement SKU/code without storing source value, target value, and explicit reason.
5. A migration is idempotent only if rerunning it creates neither duplicate rows nor extra ledger movements.

## Core Mapping

| Legacy JSON | Relational canonical target | Notes |
|---|---|---|
| `accounts` | `accounts` | Preserve active state; no cascade delete. |
| `users`, `sessions`, roles/permissions | matching security tables | Preserve password hashes; invalidate malformed sessions rather than recreate secrets. |
| `customers`, `customer_types` | `customers`, `customer_types`, `customer_addresses` | Missing/invalid type is quarantined or set null only if optional. |
| `partners` | `suppliers` | Map supplier uses first; do not assume all partners are suppliers without source usage analysis. |
| `product_categories` | `product_categories` | Legacy parent mapping must remain inside the same account. |
| parent `products` | `products` | `sku_normalized = trim(upper(sku))`; no `SP` prefix is added. |
| variant `products` (`parent_id`) | `product_variants` | Parent must be mapped first; orphan parent is quarantine-critical. |
| `combos`, `combo_items` | matching tables | Require exactly product or variant for a component. |
| `invoices` | `orders` | `invoice_code -> order_code`; old `DH` remains searchable, new codes use `HD`. |
| `invoice_details` | `order_items` | `product_id` nullable; snapshots required. Missing snapshots are quarantine-critical. |
| `import_logs` | `purchase_receipts` | `import_code -> receipt_code`; old `PN` searchable, new code `NP`. |
| `import_details` | `purchase_receipt_items` | Product/variant can be null only with retained snapshots. |
| `return_logs`, `return_details` | future typed returns | Must classify sale vs purchase return before migration. |
| `cash_book` | `cash_ledger` | Direction/reference must be normalized without double counting. |
| `customer_debts`, `supplier_debts` | matching debts | Reconcile to order/receipt totals; do not infer paid event history missing from source. |
| `inventory_transactions` + `products.stock` | `inventory_movements` + balances | Select one audited movement reconstruction plan; never both import current stock and replay historical movements without opening-balance rules. |
| reports/einvoice/payroll/excel/marketplace/settings/backup/sync | matching future relational tables | Preserve metadata first; attach business FKs only when deterministic. |

## Quarantine Conditions

- Duplicate case-insensitive SKU or document code in an account.
- Cross-account parent, product, customer, supplier, user, or document reference.
- Missing parent for a variant, detail header, or required snapshot.
- Unparseable quantity, price, total, or timestamp.
- A line total inconsistent with the documented rounding rule.
- Orphaned historical product references are retained with nullable FK plus snapshots, but still recorded for review.

Any unresolved collision affecting product identity, order identity, stock, money, or debt is a cutover blocker.
