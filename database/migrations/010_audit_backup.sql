-- =====================================================================
-- 010_audit_backup.sql  |  Audit Log + Backup History
-- =====================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL,
    user_id     INTEGER,
    action      TEXT NOT NULL,   -- log m?: 'CREATE','UPDATE','DELETE','PAYMENT','auth.login',... kh?ng r?ng bu?c c?ng
    module      TEXT NOT NULL,
    record_id   INTEGER,
    old_data    TEXT,   -- JSON snapshot trước thay đổi
    new_data    TEXT,   -- JSON snapshot sau thay đổi
    ip          TEXT,
    user_agent  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_audit_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_audit_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_account_date ON audit_logs(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_module       ON audit_logs(module, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_user         ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action       ON audit_logs(action);

CREATE TABLE IF NOT EXISTS backup_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER,
    file_name   TEXT NOT NULL,
    file_size   INTEGER NOT NULL DEFAULT 0 CHECK (file_size >= 0),
    backup_date TEXT NOT NULL DEFAULT (datetime('now')),
    status      TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','failed','running')),
    note        TEXT,
    CONSTRAINT fk_backup_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_date ON backup_history(backup_date);

INSERT INTO schema_migrations(version, description)
VALUES ('010', 'Audit logs + backup history')
ON CONFLICT(version) DO NOTHING;
