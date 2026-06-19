-- =====================================================================
-- 005_orders.sql  |  Module Hóa đơn bán hàng (3NF)
-- =====================================================================

CREATE TABLE IF NOT EXISTS orders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id       INTEGER NOT NULL,
    order_code       TEXT NOT NULL,
    customer_id      INTEGER,
    user_id          INTEGER,
    subtotal         REAL NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount_amount  REAL NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    vat_amount       REAL NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
    total_amount     REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    paid_amount      REAL NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    remaining_amount REAL NOT NULL DEFAULT 0,
    payment_status   TEXT NOT NULL DEFAULT 'unpaid'
                     CHECK (payment_status IN ('unpaid','partial','paid','refunded')),
    order_status     TEXT NOT NULL DEFAULT 'completed'
                     CHECK (order_status IN ('draft','pending','completed','cancelled','returned')),
    note             TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_order_account FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_order_customer FOREIGN KEY (customer_id)
        REFERENCES customers(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_order_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT uq_order_account_code UNIQUE (account_id, order_code)
);

CREATE TABLE IF NOT EXISTS order_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id        INTEGER NOT NULL,
    product_id      INTEGER,
    quantity        REAL NOT NULL CHECK (quantity > 0),
    purchase_price  REAL NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
    sale_price      REAL NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
    discount_amount REAL NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    total_amount    REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_oi_order FOREIGN KEY (order_id)
        REFERENCES orders(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_oi_product FOREIGN KEY (product_id)
        REFERENCES products(id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- Index hỗ trợ báo cáo doanh thu/lợi nhuận + tra cứu hóa đơn
CREATE INDEX IF NOT EXISTS idx_orders_account_date ON orders(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer     ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_pay_status   ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_user         ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_oi_order            ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_oi_product          ON order_items(product_id);

INSERT INTO schema_migrations(version, description)
VALUES ('005', 'Orders + order_items')
ON CONFLICT(version) DO NOTHING;
