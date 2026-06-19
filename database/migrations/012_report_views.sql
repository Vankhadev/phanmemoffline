-- =====================================================================
-- 012_report_views.sql  |  View báo cáo (đọc nhanh, không trùng lặp dữ liệu)
-- =====================================================================

-- ---- Báo cáo doanh thu theo ngày ----
DROP VIEW IF EXISTS v_revenue_daily;
CREATE VIEW v_revenue_daily AS
SELECT
    o.account_id,
    date(o.created_at)                 AS report_date,
    COUNT(*)                           AS order_count,
    SUM(o.subtotal)                    AS total_subtotal,
    SUM(o.discount_amount)             AS total_discount,
    SUM(o.vat_amount)                  AS total_vat,
    SUM(o.total_amount)                AS total_revenue,
    SUM(o.paid_amount)                 AS total_paid,
    SUM(o.remaining_amount)            AS total_remaining
FROM orders o
WHERE o.order_status = 'completed'
GROUP BY o.account_id, date(o.created_at);

-- ---- Báo cáo lợi nhuận theo ngày (doanh thu - giá vốn) ----
DROP VIEW IF EXISTS v_profit_daily;
CREATE VIEW v_profit_daily AS
SELECT
    o.account_id,
    date(o.created_at)                                   AS report_date,
    SUM(oi.sale_price * oi.quantity - oi.discount_amount) AS revenue,
    SUM(oi.purchase_price * oi.quantity)                  AS cogs,
    SUM(oi.sale_price * oi.quantity - oi.discount_amount
        - oi.purchase_price * oi.quantity)               AS gross_profit
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.order_status = 'completed'
GROUP BY o.account_id, date(o.created_at);

-- ---- Báo cáo lợi nhuận theo sản phẩm ----
DROP VIEW IF EXISTS v_profit_by_product;
CREATE VIEW v_profit_by_product AS
SELECT
    o.account_id,
    oi.product_id,
    p.name                                                AS product_name,
    p.sku,
    SUM(oi.quantity)                                      AS qty_sold,
    SUM(oi.sale_price * oi.quantity - oi.discount_amount) AS revenue,
    SUM(oi.purchase_price * oi.quantity)                  AS cogs,
    SUM(oi.sale_price * oi.quantity - oi.discount_amount
        - oi.purchase_price * oi.quantity)               AS gross_profit
FROM order_items oi
JOIN orders o   ON o.id = oi.order_id AND o.order_status = 'completed'
LEFT JOIN products p ON p.id = oi.product_id
GROUP BY o.account_id, oi.product_id, p.name, p.sku;

-- ---- Báo cáo công nợ khách hàng ----
DROP VIEW IF EXISTS v_customer_debt;
CREATE VIEW v_customer_debt AS
SELECT
    d.account_id,
    d.customer_id,
    c.customer_code,
    c.full_name,
    c.phone,
    SUM(d.debt_amount)      AS total_debt,
    SUM(d.paid_amount)      AS total_paid,
    SUM(d.remaining_amount) AS total_remaining
FROM debts d
JOIN customers c ON c.id = d.customer_id
WHERE d.status IN ('open','partial')
GROUP BY d.account_id, d.customer_id, c.customer_code, c.full_name, c.phone;

-- ---- Báo cáo tồn kho (cảnh báo dưới định mức) ----
DROP VIEW IF EXISTS v_inventory_status;
CREATE VIEW v_inventory_status AS
SELECT
    p.account_id,
    p.id            AS product_id,
    p.sku,
    p.name,
    p.stock_quantity,
    p.minimum_stock,
    (p.stock_quantity * p.purchase_price) AS stock_value,
    CASE WHEN p.stock_quantity <= p.minimum_stock THEN 1 ELSE 0 END AS is_low_stock
FROM products p
WHERE p.status = 'active';

-- ---- Báo cáo khách hàng (tổng quan mua hàng) ----
DROP VIEW IF EXISTS v_customer_summary;
CREATE VIEW v_customer_summary AS
SELECT
    c.account_id,
    c.id            AS customer_id,
    c.customer_code,
    c.full_name,
    c.phone,
    c.total_spent,
    c.debt_amount,
    COUNT(o.id)           AS order_count,
    MAX(o.created_at)     AS last_order_at
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.order_status = 'completed'
GROUP BY c.account_id, c.id, c.customer_code, c.full_name, c.phone, c.total_spent, c.debt_amount;

INSERT INTO schema_migrations(version, description)
VALUES ('012', 'Report views: revenue, profit, debt, inventory, customer')
ON CONFLICT(version) DO NOTHING;
