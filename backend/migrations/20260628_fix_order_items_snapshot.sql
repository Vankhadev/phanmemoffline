-- Safe migration for order item snapshots.
-- Adds nullable snapshot-friendly columns without deleting data.

DELIMITER $$

DROP PROCEDURE IF EXISTS migrate_fix_order_items_snapshot $$

CREATE PROCEDURE migrate_fix_order_items_snapshot()
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'product_id'
    ) THEN
      ALTER TABLE `order_items` ADD COLUMN `product_id` BIGINT NULL AFTER `order_id`;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'product_name'
    ) THEN
      ALTER TABLE `order_items` ADD COLUMN `product_name` VARCHAR(255) NOT NULL DEFAULT '' AFTER `product_id`;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'sku'
    ) THEN
      ALTER TABLE `order_items` ADD COLUMN `sku` VARCHAR(100) NULL AFTER `product_name`;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'item_type'
    ) THEN
      ALTER TABLE `order_items` ADD COLUMN `item_type` VARCHAR(20) NOT NULL DEFAULT 'product' AFTER `sku`;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'sale_price'
    ) THEN
      ALTER TABLE `order_items` ADD COLUMN `sale_price` DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER `purchase_price`;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'cost_price'
    ) THEN
      ALTER TABLE `order_items` ADD COLUMN `cost_price` DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER `sale_price`;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'discount'
    ) THEN
      ALTER TABLE `order_items` ADD COLUMN `discount` DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER `cost_price`;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'vat_amount'
    ) THEN
      ALTER TABLE `order_items` ADD COLUMN `vat_amount` DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER `discount`;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'line_total'
    ) THEN
      ALTER TABLE `order_items` ADD COLUMN `line_total` DECIMAL(18,2) NOT NULL DEFAULT 0 AFTER `vat_amount`;
    END IF;
  END IF;
END $$

CALL migrate_fix_order_items_snapshot() $$

DROP PROCEDURE IF EXISTS migrate_fix_order_items_snapshot $$

DELIMITER ;