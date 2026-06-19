-- =====================================================================
-- 001_init.sql  |  Nền tảng & cấu hình hiệu năng SQLite (Enterprise)
-- Idempotent: chạy lại nhiều lần không lỗi, không mất dữ liệu.
-- =====================================================================

-- --- PRAGMA hiệu năng & an toàn dữ liệu (chống mất điện) ---
PRAGMA journal_mode = WAL;        -- Write-Ahead Logging: đọc/ghi song song, an toàn khi mất điện
PRAGMA synchronous = NORMAL;      -- An toàn cao với WAL, nhanh hơn FULL
PRAGMA foreign_keys = ON;         -- Bắt buộc ràng buộc khóa ngoại
PRAGMA temp_store = MEMORY;       -- Bảng tạm nằm trong RAM
PRAGMA cache_size = -16000;       -- ~16MB page cache
PRAGMA busy_timeout = 5000;       -- Chờ 5s khi DB bị khóa thay vì lỗi ngay
PRAGMA wal_autocheckpoint = 1000; -- Checkpoint WAL định kỳ

-- --- Bảng quản lý phiên bản migration (không mất dữ liệu cũ) ---
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
    checksum    TEXT,
    description TEXT
);

-- --- Tài khoản (multi-tenant gốc của hệ thống) ---
CREATE TABLE IF NOT EXISTS accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT NOT NULL,
    name        TEXT NOT NULL,
    plan        TEXT NOT NULL DEFAULT 'free',
    active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT uq_accounts_slug UNIQUE (slug)
);

-- --- Người dùng / nhân viên ---
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    INTEGER NOT NULL,
    name          TEXT NOT NULL,
    email         TEXT,
    phone         TEXT,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'staff'
                  CHECK (role IN ('owner','admin','manager','staff','cashier','viewer')),
    approved      INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0,1)),
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    last_login    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_users_account FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT uq_users_account_email UNIQUE (account_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_account   ON users(account_id);
CREATE INDEX IF NOT EXISTS idx_users_phone     ON users(phone);

INSERT INTO schema_migrations(version, description)
VALUES ('001', 'Init: pragmas, schema_migrations, accounts, users')
ON CONFLICT(version) DO NOTHING;
