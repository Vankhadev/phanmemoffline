function createOrderRepository(tx) {
  return {
    create(order) {
      return tx.run(`INSERT INTO orders (account_id,order_code,customer_id,created_by,status,payment_status,subtotal,discount_amount,vat_amount,delivery_fee,total_amount,paid_amount,remaining_amount,payment_method,note,idempotency_key,client_order_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        order.accountId, order.orderCode, order.customerId || null, order.createdBy || null,
        order.status, order.paymentStatus, order.subtotal, order.discountAmount, order.vatAmount,
        order.deliveryFee, order.totalAmount, order.paidAmount, order.remainingAmount,
        order.paymentMethod || null, order.note || '', order.idempotencyKey || null,
        order.clientOrderId || null, order.createdAt, order.createdAt,
      ]);
    },
    addItem(item) {
      return tx.run(`INSERT INTO order_items (account_id,order_id,product_id,variant_id,product_sku_snapshot,product_name_snapshot,unit_snapshot,quantity,purchase_price_snapshot,unit_price,discount_amount,line_total)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
        item.accountId, item.orderId, item.productId || null, item.variantId || null,
        item.sku, item.name, item.unit || '', item.quantity, item.purchasePrice,
        item.unitPrice, item.discountAmount, item.lineTotal,
      ]);
    },
    addStatusHistory(change) {
      return tx.run('INSERT INTO order_status_history(account_id,order_id,old_status,new_status,changed_by,reason) VALUES(?,?,?,?,?,?)', [change.accountId, change.orderId, change.oldStatus || null, change.newStatus, change.userId || null, change.reason || null]);
    },
    findByIdempotency(accountId, key) {
      return key ? tx.get('SELECT * FROM orders WHERE account_id=? AND idempotency_key=?', [accountId, key]) : Promise.resolve(null);
    },
  };
}

module.exports = { createOrderRepository };
