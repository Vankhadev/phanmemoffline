/**
 * Non-destructive data repair for upgrades.
 * Repairs only records with an unambiguous source and creates a rollback
 * backup before the first write in a process.
 */
'use strict';

let completed = false;

function toPositiveMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function resolveDetailCost(detail, productsById) {
  const snapshot = [
    detail.cost_price_at_sale,
    detail.import_price,
    detail.purchase_price,
    detail.cost_price,
  ].map(toPositiveMoney).find(value => value > 0) || 0;
  if (snapshot > 0) return { value: snapshot, source: 'snapshot' };

  const product = productsById.get(Number(detail.variant_id))
    || productsById.get(Number(detail.product_id));
  const productCost = toPositiveMoney(product?.import_price ?? product?.cost_price ?? product?.purchase_price ?? product?.avg_cost_price);
  if (productCost > 0) return { value: productCost, source: 'product' };

  const parent = productsById.get(Number(detail.parent_id));
  const parentCost = toPositiveMoney(parent?.import_price ?? parent?.cost_price ?? parent?.purchase_price ?? parent?.avg_cost_price);
  return parentCost > 0 ? { value: parentCost, source: 'parent' } : null;
}

function repairOnStartup(options = {}) {
  if (completed) return { ok: true, skipped: true, reason: 'already_completed' };
  const dbModule = options.dbModule || require('../db/database');
  const productUpsertService = options.productUpsertService || require('./productUpsertService');
  const db = dbModule.getDb();
  const products = Array.isArray(db.products) ? db.products : [];
  const details = Array.isArray(db.invoice_details) ? db.invoice_details : [];
  const hiddenProducts = products.filter(product => product && product.merged === true && product.status === 'merged' && product.merged_into != null);
  const productsById = new Map(products.map(product => [Number(product.id), product]));
  const missingCostDetails = details.filter(detail => detail && toPositiveMoney(detail.cost_price_at_sale ?? detail.import_price ?? detail.purchase_price ?? detail.cost_price) === 0 && resolveDetailCost(detail, productsById));

  if (hiddenProducts.length === 0 && missingCostDetails.length === 0) {
    completed = true;
    return { ok: true, changed: false, restoredProducts: 0, repairedCosts: 0 };
  }

  const backup = dbModule.createDbBackup('pre-data-repair', { skipRetention: true });
  if (!backup) throw new Error('Cannot repair data without a verified rollback backup.');

  const result = dbModule.withAtomicDbWrite(() => {
    const productRestore = productUpsertService.restoreProductsHiddenByAutomaticMerge({ dbModule });
    let repairedCosts = 0;
    for (const detail of missingCostDetails) {
      const resolved = resolveDetailCost(detail, productsById);
      if (!resolved) continue;
      const quantity = Number(detail.quantity) || 0;
      const unitPrice = Number(detail.unit_price ?? detail.sale_price_at_sale ?? detail.price) || 0;
      dbModule.update('invoice_details', detail.id, {
        import_price: resolved.value,
        cost_price: resolved.value,
        cost_price_at_sale: resolved.value,
        profit_at_sale: (unitPrice - resolved.value) * quantity,
        cost_repaired_at: new Date().toISOString(),
        cost_repair_source: resolved.source,
      }, { skipSave: true });
      repairedCosts += 1;
    }
    return { ok: true, changed: true, restoredProducts: productRestore.restoredCount, repairedCosts };
  });
  completed = true;
  return { ...result, backup: backup.path };
}

module.exports = { repairOnStartup, resolveDetailCost };
