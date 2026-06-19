-- =====================================================================
-- 004_inventory.sql  |  Module Kho - Sổ cái tồn kho (immutable ledger)
-- =====================================================================

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id       INTEGER NOT NULL,
    product_id       INTEGER NOT NULL,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('IMPORT','EXPORT','ADJUSTMENT')),
    quantity         REAL NOT NULL,
    before_stock     REAL NOT NULL,
    after_stock      REAL NOT NULL,
    reference_type   TEXT,   -- 'ORDER' | 'PURCHASE_ORDER' | 'RETURN' | 'MANUAL'
    reference_id     INTEGER,
    note             TEXT,
    created_by       INTEGER,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_inv_account FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_inv_product FOREIGN KEY (product_id)
        REFERENCES products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_inv_user FOREIGN KEY (created_by)
        REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- Index hỗ trợ truy vấn thẻ kho theo sản phẩm + báo cáo tồn kho theo thời gian
CREATE INDEX IF NOT EXISTS idx_inv_product      ON inventory_transactions(product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inv_account_date ON inventory_transactions(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inv_reference    ON inventory_transactions(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_inv_type         ON inventory_transactions(transaction_type);

INSERT INTO schema_migrations(version, description)
VALUES ('004', 'Inventory transactions ledger')
ON CONFLICT(version) DO NOTHING;
