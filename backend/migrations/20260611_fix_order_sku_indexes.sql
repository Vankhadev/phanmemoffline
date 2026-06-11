-- Safe migration for SQL deployments that may have inherited a wrong UNIQUE
-- constraint on order SKU columns. Product SKU is unique only in products.
-- Order/invoice item SKU columns must be repeatable.

DELIMITER $$

DROP PROCEDURE IF EXISTS migrate_fix_order_sku_indexes $$

CREATE PROCEDURE migrate_fix_order_sku_indexes()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE table_name_to_fix VARCHAR(64);
  DECLARE index_name_to_drop VARCHAR(64);

  DECLARE unique_sku_indexes CURSOR FOR
    SELECT DISTINCT s.TABLE_NAME, s.INDEX_NAME
    FROM information_schema.STATISTICS s
    WHERE s.TABLE_SCHEMA = DATABASE()
      AND s.TABLE_NAME IN ('orders', 'order_items', 'invoices', 'invoice_details')
      AND s.COLUMN_NAME IN ('sku', 'product_sku')
      AND s.NON_UNIQUE = 0
      AND s.INDEX_NAME <> 'PRIMARY';

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN unique_sku_indexes;

  drop_unique_loop: LOOP
    FETCH unique_sku_indexes INTO table_name_to_fix, index_name_to_drop;
    IF done = 1 THEN
      LEAVE drop_unique_loop;
    END IF;

    SET @drop_sql = CONCAT(
      'ALTER TABLE `', REPLACE(table_name_to_fix, '`', '``'),
      '` DROP INDEX `', REPLACE(index_name_to_drop, '`', '``'), '`'
    );
    PREPARE drop_stmt FROM @drop_sql;
    EXECUTE drop_stmt;
    DEALLOCATE PREPARE drop_stmt;
  END LOOP;

  CLOSE unique_sku_indexes;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'sku'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_orders_sku'
  ) THEN
    ALTER TABLE `orders` ADD INDEX `idx_orders_sku` (`sku`);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'sku'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND INDEX_NAME = 'idx_invoices_sku'
  ) THEN
    ALTER TABLE `invoices` ADD INDEX `idx_invoices_sku` (`sku`);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'sku'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND INDEX_NAME = 'idx_order_items_sku'
  ) THEN
    ALTER TABLE `order_items` ADD INDEX `idx_order_items_sku` (`sku`);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'product_sku'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_items' AND INDEX_NAME = 'idx_order_items_product_sku'
  ) THEN
    ALTER TABLE `order_items` ADD INDEX `idx_order_items_product_sku` (`product_sku`);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_details' AND COLUMN_NAME = 'sku'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_details' AND INDEX_NAME = 'idx_invoice_details_sku'
  ) THEN
    ALTER TABLE `invoice_details` ADD INDEX `idx_invoice_details_sku` (`sku`);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_details' AND COLUMN_NAME = 'product_sku'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_details' AND INDEX_NAME = 'idx_invoice_details_product_sku'
  ) THEN
    ALTER TABLE `invoice_details` ADD INDEX `idx_invoice_details_product_sku` (`product_sku`);
  END IF;
END $$

CALL migrate_fix_order_sku_indexes() $$

DROP PROCEDURE IF EXISTS migrate_fix_order_sku_indexes $$

DELIMITER ;
