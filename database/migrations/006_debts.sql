-- =====================================================================
-- 006_debts.sql  |  Module Công nợ (3NF)
-- =====================================================================

CREATE TABLE IF NOT EXISTS debts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id       INTEGER NOT NULL,
    customer_id      INTEGER NOT NULL,
    order_id         INTEGER,
    debt_amount      REAL NOT NULL DEFAULT 0 CHECK (debt_amount >= 0),
    paid_amount      REAL NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    remaining_amount REAL NOT NULL DEFAULT 0 CHECK (remaining_amount >= 0),
    status           TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','partial','paid','written_off')),
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_debt_account FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_debt_customer FOREIGN KEY (customer_id)
        REFERENCES customers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_debt_order FOREIGN KEY (order_id)
        REFERENCES orders(id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS debt_payments (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id     INTEGER NOT NULL,
    debt_id        INTEGER NOT NULL,
    amount         REAL NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL DEFAULT 'cash'
                   CHECK (payment_method IN ('cash','bank','card','ewallet','other')),
    note           TEXT,
    created_by     INTEGER,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_dp_account FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_dp_debt FOREIGN KEY (debt_id)
        REFERENCES debts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_dp_user FOREIGN KEY (created_by)
        REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- Index hỗ trợ báo cáo công nợ
CREATE INDEX IF NOT EXISTS idx_debts_customer    ON debts(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_debts_account      ON debts(account_id, status);
CREATE INDEX IF NOT EXISTS idx_debts_order        ON debts(order_id);
CREATE INDEX IF NOT EXISTS idx_dp_debt            ON debt_payments(debt_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dp_account_date    ON debt_payments(account_id, created_at);

INSERT INTO schema_migrations(version, description)
VALUES ('006', 'Debts + debt_payments')
ON CONFLICT(version) DO NOTHING;
