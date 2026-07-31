# Release v2.4.11

## Other services in order editing

- Add **Thêm dịch vụ khác** to the order edit dialog.
- Allow a service line to be entered without an inventory product.
- Preserve service name, quantity, price, discount, and `custom_service` metadata.
- Service lines have no `product_id` or `variant_id` and never affect stock validation or stock movement.
- Recalculate subtotal, VAT, total, remaining amount, and change immediately after adding a service.
- Preserve service lines in both online and offline order updates.

## Verification

- Frontend production build passed.
- Legacy SKU invoice edit regression test passed.
- JavaScript syntax checks passed.

Tag: `v2.4.11`
