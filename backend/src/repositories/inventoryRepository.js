function createInventoryRepository(tx) {
  return {
    async applyMovement({ accountId, warehouseId, productId, delta, referenceType, referenceId, idempotencyKey }) {
      const existing = await tx.get('SELECT id FROM inventory_movements WHERE account_id=? AND idempotency_key=?', [accountId, idempotencyKey]);
      if (existing) throw new Error('Inventory movement idempotency key already exists');
      const balance = await tx.get('SELECT quantity FROM inventory_balances WHERE account_id=? AND warehouse_id=? AND product_id=?', [accountId, warehouseId, productId]);
      const nextQuantity = Number(balance?.quantity || 0) + Number(delta);
      const warehouse = await tx.get('SELECT allow_negative_stock FROM warehouses WHERE account_id=? AND id=?', [accountId, warehouseId]);
      if (!warehouse) throw new Error('Warehouse does not belong to account');
      if (!warehouse.allow_negative_stock && nextQuantity < 0) throw new Error('Insufficient stock');
      await tx.run('INSERT INTO inventory_movements(account_id,warehouse_id,product_id,quantity_delta,reference_type,reference_id,idempotency_key) VALUES(?,?,?,?,?,?,?)', [accountId, warehouseId, productId, delta, referenceType, referenceId, idempotencyKey]);
      await tx.run(`INSERT INTO inventory_balances(account_id,warehouse_id,product_id,quantity) VALUES(?,?,?,?)
        ON CONFLICT(account_id,warehouse_id,product_id) DO UPDATE SET quantity=excluded.quantity`, [accountId, warehouseId, productId, nextQuantity]);
      return nextQuantity;
    },
  };
}

module.exports = { createInventoryRepository };
