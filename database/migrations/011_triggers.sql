-- =====================================================================
-- 011_triggers.sql  |  Triggers đảm bảo toàn vẹn & tự động hóa
-- Idempotent: DROP trước khi CREATE.
-- =====================================================================

-- ---- updated_at tự động ----
DROP TRIGGER IF EXISTS trg_customers_updated;
CREATE TRIGGER trg_customers_updated AFTER UPDATE ON customers
BEGIN
    UPDATE customers SET updated_at = datetime('now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_products_updated;
CREATE TRIGGER trg_products_updated AFTER UPDATE ON products
BEGIN
    UPDATE products SET updated_at = datetime('now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_orders_updated;
CREATE TRIGGER trg_orders_updated AFTER UPDATE ON orders
BEGIN
    UPDATE orders SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ---- Đồng bộ tồn kho từ sổ cái kho (single source of truth) ----
DROP TRIGGER IF EXISTS trg_inv_after_insert;
CREATE TRIGGER trg_inv_after_insert AFTER INSERT ON inventory_transactions
BEGIN
    UPDATE products
       SET stock_quantity = NEW.after_stock,
           updated_at = datetime('now')
     WHERE id = NEW.product_id;
END;

-- ---- Tự tính remaining_amount + payment_status cho hóa đơn ----
DROP TRIGGER IF EXISTS trg_order_payment_calc;
CREATE TRIGGER trg_order_payment_calc
AFTER UPDATE OF paid_amount, total_amount ON orders
FOR EACH ROW
BEGIN
    UPDATE orders
       SET remaining_amount = NEW.total_amount - NEW.paid_amount,
           payment_status = CASE
               WHEN NEW.paid_amount <= 0 THEN 'unpaid'
               WHEN NEW.paid_amount < NEW.total_amount THEN 'partial'
               ELSE 'paid'
           END
     WHERE id = NEW.id;
END;

-- ---- Đồng bộ công nợ khi có thanh toán ----
DROP TRIGGER IF EXISTS trg_debt_payment_after_insert;
CREATE TRIGGER trg_debt_payment_after_insert AFTER INSERT ON debt_payments
BEGIN
    UPDATE debts
       SET paid_amount = paid_amount + NEW.amount,
           remaining_amount = MAX(debt_amount - (paid_amount + NEW.amount), 0),
           status = CASE
               WHEN (paid_amount + NEW.amount) >= debt_amount THEN 'paid'
               WHEN (paid_amount + NEW.amount) > 0 THEN 'partial'
               ELSE 'open'
           END,
           updated_at = datetime('now')
     WHERE id = NEW.debt_id;
END;

-- ---- Chặn thanh toán vượt công nợ còn lại (toàn vẹn tài chính) ----
DROP TRIGGER IF EXISTS trg_debt_payment_guard;
CREATE TRIGGER trg_debt_payment_guard BEFORE INSERT ON debt_payments
FOR EACH ROW
WHEN NEW.amount > (SELECT remaining_amount FROM debts WHERE id = NEW.debt_id)
BEGIN
    SELECT RAISE(ABORT, 'Số tiền thanh toán vượt quá công nợ còn lại');
END;

INSERT INTO schema_migrations(version, description)
VALUES ('011', 'Triggers: updated_at, stock sync, payment calc, debt sync, guards')
ON CONFLICT(version) DO NOTHING;
