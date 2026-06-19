-- =====================================================================
-- 008_suppliers_purchasing.sql  |  Nhà cung cấp + Nhập hàng (3NF)
-- =====================================================================

CREATE TABLE IF NOT EXISTS suppliers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    INTEGER NOT NULL,
    supplier_code TEXT NOT NULL,
    name          TEXT NOT NULL,
    phone         TEXT,
    email         TEXT,
    address       TEXT,
    note          TEXT,
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','inactive')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_sup_account FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT uq_sup_account_code UNIQUE (account_id, supplier_code)
);
CREATE INDEX IF NOT EXISTS idx_suppliers_account ON suppliers(account_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_phone   ON suppliers(phone);
CREATE INDEX IF NOT EXISTS idx_suppliers_name    ON suppliers(name);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL,
    po_code         TEXT NOT NULL,
    supplier_id     INTEGER,
    user_id         INTEGER,
    subtotal        REAL NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount_amount REAL NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    total_amount    REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    paid_amount     REAL NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    status          TEXT NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('draft','pending','completed','cancelled')),
    note            TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_po_account FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id)
        REFERENCES suppliers(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_po_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT uq_po_account_code UNIQUE (account_id, po_code)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_order_id INTEGER NOT NULL,
    product_id        INTEGER,
    quantity          REAL NOT NULL CHECK (quantity > 0),
    cost_price        REAL NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    total_amount      REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_poi_po FOREIGN KEY (purchase_order_id)
        REFERENCES purchase_orders(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_poi_product FOREIGN KEY (product_id)
        REFERENCES products(id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_po_account_date ON purchase_orders(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_po_supplier     ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status       ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_poi_po          ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_poi_product     ON purchase_order_items(product_id);

INSERT INTO schema_migrations(version, description)
VALUES ('008', 'Suppliers + purchase_orders + purchase_order_items')
ON CONFLICT(version) DO NOTHING;
