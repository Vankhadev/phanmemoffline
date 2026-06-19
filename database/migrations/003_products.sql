-- =====================================================================
-- 003_products.sql  |  Module Sản phẩm (3NF)
-- =====================================================================

-- Nhóm/Danh mục sản phẩm
CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL,
    name        TEXT NOT NULL,
    parent_id   INTEGER,
    active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_cat_account FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_cat_parent FOREIGN KEY (parent_id)
        REFERENCES categories(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT uq_cat_account_name UNIQUE (account_id, name)
);

-- Đơn vị tính (tách bảng để chuẩn 3NF)
CREATE TABLE IF NOT EXISTS units (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL,
    name        TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_unit_account FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT uq_unit_account_name UNIQUE (account_id, name)
);

-- Sản phẩm
CREATE TABLE IF NOT EXISTS products (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id     INTEGER NOT NULL,
    sku            TEXT NOT NULL,
    barcode        TEXT,
    name           TEXT NOT NULL,
    category_id    INTEGER,
    unit_id        INTEGER,
    purchase_price REAL NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
    sale_price     REAL NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
    stock_quantity REAL NOT NULL DEFAULT 0,
    minimum_stock  REAL NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
    status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','inactive','discontinued')),
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT fk_prod_account FOREIGN KEY (account_id)
        REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_prod_category FOREIGN KEY (category_id)
        REFERENCES categories(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_prod_unit FOREIGN KEY (unit_id)
        REFERENCES units(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT uq_prod_account_sku UNIQUE (account_id, sku)
);

-- Index theo yêu cầu + hỗ trợ tìm kiếm/báo cáo tồn kho
CREATE INDEX IF NOT EXISTS idx_products_sku        ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_name       ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_account    ON products(account_id);
CREATE INDEX IF NOT EXISTS idx_products_category   ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_low_stock  ON products(account_id, stock_quantity);
-- Barcode: index thường (KHÔNG unique) để không bao giờ mất sản phẩm khi
-- dữ liệu cũ dùng cột này như mô tả tự do. Trùng barcode chỉ là cảnh báo nghiệp vụ.
CREATE INDEX IF NOT EXISTS idx_products_account_barcode
    ON products(account_id, barcode);

INSERT INTO schema_migrations(version, description)
VALUES ('003', 'Products + categories + units')
ON CONFLICT(version) DO NOTHING;

