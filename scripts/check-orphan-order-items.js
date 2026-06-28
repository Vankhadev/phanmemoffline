const fs = require('fs');
const path = require('path');

function resolveDbPath() {
  const candidates = [
    process.env.KHA_DB_PATH,
    process.env.DB_PATH,
    process.env.DATABASE_PATH,
    path.resolve(__dirname, '..', 'backend', 'data', 'phanmienoffline.db.json'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }
  throw new Error('Không tìm thấy database JSON');
}

const dbPath = resolveDbPath();
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const products = Array.isArray(db.products) ? db.products : [];
const productById = new Map(products.map(p => [String(p.id), p]));
const productNames = new Set(products.map(p => String(p.name || '').trim().toLowerCase()).filter(Boolean));
const details = Array.isArray(db.invoice_details) ? db.invoice_details : [];

const orphanRows = details.filter(detail => {
  const productId = detail.product_id == null ? null : String(detail.product_id);
  const productName = String(detail.product_name || detail.name || '').trim().toLowerCase();
  const linked = productId != null && productById.has(productId);
  const nameMatched = !productName || productNames.has(productName);
  return !linked || !nameMatched || detail.product_id == null;
}).map(detail => ({
  detail_id: detail.id ?? null,
  invoice_id: detail.invoice_id ?? null,
  product_id: detail.product_id ?? null,
  product_name: detail.product_name || detail.name || '',
  sku: detail.product_sku || detail.sku || '',
  item_type: detail.item_type || detail.type || 'product',
  note: detail.note || '',
  status: detail.product_id == null ? 'orphan/custom' : 'name-mismatch',
}));

console.log(JSON.stringify({
  dbPath,
  orphanCount: orphanRows.length,
  rows: orphanRows,
}, null, 2));