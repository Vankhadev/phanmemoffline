-- =====================================================================
-- 002_customers.sql  |  Module Khách hàng (3NF)
-- =====================================================================

-- Hạng khách hàng (tách bảng để chuẩn 3NF: rank không phụ thuộc trực tiếp KH)
CREATE TABLE IF NOT EXISTS customer_ranks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    INTEGER NOT NULL,
    name          TEXT NOT NULL,
    color         TEXT,
    min_spent     REAL NOT NULL DEFAULT 0 CHECK (min_spent >= 0),
    discount_rate REAL NOT NULL DEFAULT 0 CHECK (discount_rate >= 0 AND discount_rate <= 100),
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_rank_account FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT uq_rank_account_name UNIQUE (account_id, name)
);

-- Khách hàng
CREATE TABLE IF NOT EXISTS customers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    INTEGER NOT NULL,
    customer_code TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    phone         TEXT,
    email         TEXT,
    address       TEXT,
    note          TEXT,
    debt_amount   REAL NOT NULL DEFAULT 0 CHECK (debt_amount >= 0),
    total_spent   REAL NOT NULL DEFAULT 0 CHECK (total_spent >= 0),
    rank_id       INTEGER,
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','inactive','blocked')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_cust_account FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_cust_rank FOREIGN KEY (rank_id)
        REFERENCES customer_ranks(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT uq_cust_account_code UNIQUE (account_id, customer_code)
);

-- Index theo yêu cầu + hỗ trợ báo cáo khách hàng
CREATE INDEX IF NOT EXISTS idx_customers_phone   ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_code     ON customers(customer_code);
CREATE INDEX IF NOT EXISTS idx_customers_account  ON customers(account_id);
CREATE INDEX IF NOT EXISTS idx_customers_rank     ON customers(rank_id);
CREATE INDEX IF NOT EXISTS idx_customers_name     ON customers(full_name);
-- Chống trùng SĐT trong cùng tài khoản (chỉ áp dụng khi phone không rỗng)
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_account_phone
    ON customers(account_id, phone) WHERE phone IS NOT NULL AND phone <> '';

INSERT INTO schema_migrations(version, description)
VALUES ('002', 'Customers + customer_ranks')
ON CONFLICT(version) DO NOTHING;
