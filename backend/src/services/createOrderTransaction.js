const { transaction } = require('../db/relationalSqlite');
const { createOrderRepository } = require('../repositories/orderRepository');
const { createInventoryRepository } = require('../repositories/inventoryRepository');

function money(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }
function normalizeSku(value) { return String(value || '').trim().toLocaleUpperCase('en-US'); }

async function createOrderTransaction(db, payload, context = {}) {
  const accountId = Number(context.accountId || payload.account_id);
  const warehouseId = Number(context.warehouseId || payload.warehouse_id);
  if (!Number.isInteger(accountId) || accountId <= 0) throw new Error('account_id is required');
  if (!Number.isInteger(warehouseId) || warehouseId <= 0) throw new Error('warehouse_id is required');
  if (!Array.isArray(payload.items) || payload.items.length === 0) throw new Error('Completed order requires at least one item');
  return transaction(db, async tx => {
    const orders = createOrderRepository(tx);
    const inventory = createInventoryRepository(tx);
    const existing = await orders.findByIdempotency(accountId, payload.idempotency_key);
    if (existing) return { idempotent: true, order: existing };
    const items = payload.items.map(item => {
      const quantity = Number(item.quantity);
      const unitPrice = money(item.unit_price);
      const discountAmount = money(item.discount_amount);
      const lineTotal = quantity * unitPrice - discountAmount;
      if (!(quantity > 0) || lineTotal < 0 || (item.line_total != null && Number(item.line_total) !== lineTotal)) throw new Error('Invalid order item quantity or total');
      const sku = String(item.product_sku_snapshot || item.sku || '').trim();
      const name = String(item.product_name_snapshot || item.name || '').trim();
      if (!sku || !name) throw new Error('Order item snapshots are required');
      return { ...item, quantity, unitPrice, discountAmount, lineTotal, sku, name, purchasePrice: money(item.purchase_price_snapshot) };
    });
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const discountAmount = money(payload.discount_amount) || items.reduce((sum, item) => sum + item.discountAmount, 0);
    const vatAmount = money(payload.vat_amount);
    const deliveryFee = money(payload.delivery_fee);
    const totalAmount = subtotal - discountAmount + vatAmount + deliveryFee;
    const paidAmount = money(payload.paid_amount);
    if (paidAmount > totalAmount) throw new Error('paid_amount cannot exceed total_amount');
    const createdAt = payload.created_at || new Date().toISOString();
    const created = await orders.create({ accountId, orderCode: String(payload.order_code || '').trim(), customerId: payload.customer_id, createdBy: context.userId || payload.created_by, status: 'draft', paymentStatus: paidAmount === totalAmount ? 'paid' : paidAmount ? 'partial' : 'unpaid', subtotal, discountAmount, vatAmount, deliveryFee, totalAmount, paidAmount, remainingAmount: totalAmount - paidAmount, paymentMethod: payload.payment_method, note: payload.note, idempotencyKey: payload.idempotency_key, clientOrderId: payload.client_order_id, createdAt });
    const orderId = created.lastID;
    for (const item of items) {
      await orders.addItem({ accountId, orderId, productId: item.product_id, variantId: item.variant_id, sku: item.sku, name: item.name, unit: item.unit_snapshot, quantity: item.quantity, purchasePrice: item.purchasePrice, unitPrice: item.unitPrice, discountAmount: item.discountAmount, lineTotal: item.lineTotal });
      if (item.product_id) await inventory.applyMovement({ accountId, warehouseId, productId: item.product_id, delta: -item.quantity, referenceType: 'order', referenceId: orderId, idempotencyKey: `order:${orderId}:product:${item.product_id}` });
    }
    await tx.run("UPDATE orders SET status='completed', updated_at=? WHERE account_id=? AND id=?", [createdAt, accountId, orderId]);
    await orders.addStatusHistory({ accountId, orderId, newStatus: 'completed', userId: context.userId, reason: 'createOrderTransaction' });
    await tx.run('INSERT INTO audit_logs(account_id,user_id,action,entity_type,entity_id,payload) VALUES(?,?,?,?,?,?)', [accountId, context.userId || null, 'order.create', 'orders', String(orderId), JSON.stringify({ order_code: payload.order_code, sku_keys: items.map(item => normalizeSku(item.sku)) })]);
    return { idempotent: false, orderId, totalAmount, remainingAmount: totalAmount - paidAmount };
  });
}

module.exports = { createOrderTransaction };
