-- =====================================================================
-- 009_returns.sql  |  Module Trả hàng (Returns)
-- =====================================================================

CREATE TABLE IF NOT EXISTS return_orders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id       INTEGER NOT NULL,
    return_code      TEXT NOT NULL,
    order_id         INTEGER,
    customer_id      INTEGER,
    user_id          INTEGER,
    total_amount     REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    refund_amount    REAL NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
    reason           TEXT,
    status           TEXT NOT NULL DEFAULT 'completed'
                     CHECK (status IN ('pending','completed','cancelled')),
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_ret_account  FOREIGN KEY (account_id)  REFERENCES accounts(id)  ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_ret_order    FOREIGN KEY (order_id)    REFERENCES orders(id)    ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_ret_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_ret_user     FOREIGN KEY (user_id)     REFERENCES users(id)     ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT uq_ret_account_code UNIQUE (account_id, return_code)
);

CREATE TABLE IF NOT EXISTS return_order_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    return_order_id INTEGER NOT NULL,
    product_id      INTEGER,
    quantity        REAL NOT NULL CHECK (quantity > 0),
    sale_price      REAL NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
    total_amount    REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_roi_return  FOREIGN KEY (return_order_id) REFERENCES return_orders(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_roi_product FOREIGN KEY (product_id)      REFERENCES products(id)      ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ret_account_date ON return_orders(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ret_order        ON return_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_ret_customer     ON return_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_roi_return       ON return_order_items(return_order_id);
CREATE INDEX IF NOT EXISTS idx_roi_product      ON return_order_items(product_id);

INSERT INTO schema_migrations(version, description)
VALUES ('009', 'Return orders + return_order_items')
ON CONFLICT(version) DO NOTHING;
