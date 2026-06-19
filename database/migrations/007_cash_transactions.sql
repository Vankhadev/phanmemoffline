-- =====================================================================
-- 007_cash_transactions.sql  |  Module Thu chi (Sổ quỹ)
-- =====================================================================

CREATE TABLE IF NOT EXISTS cash_transactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id       INTEGER NOT NULL,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('INCOME','EXPENSE')),
    amount           REAL NOT NULL CHECK (amount >= 0),  -- cho ph?p 0 ?? kh?ng m?t giao d?ch c?
    category         TEXT,
    description      TEXT,
    reference_type   TEXT,   -- 'ORDER','PURCHASE_ORDER','DEBT_PAYMENT','MANUAL'...
    reference_id     INTEGER,
    created_by       INTEGER,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_cash_account FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_cash_user FOREIGN KEY (created_by)
        REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- Index hỗ trợ báo cáo thu chi / dòng tiền
CREATE INDEX IF NOT EXISTS idx_cash_account_date ON cash_transactions(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cash_type_date    ON cash_transactions(transaction_type, created_at);
CREATE INDEX IF NOT EXISTS idx_cash_reference    ON cash_transactions(reference_type, reference_id);

INSERT INTO schema_migrations(version, description)
VALUES ('007', 'Cash transactions (income/expense ledger)')
ON CONFLICT(version) DO NOTHING;
