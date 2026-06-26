/**
 * Healthcheck toàn diện (PHẦN 11). Chạy: npm run healthcheck
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) pass++; else fail++;
  console.log(`[${status}] ${name}${detail ? ' - ' + detail : ''}`);
}
try {
  const db = require(path.join(ROOT, 'backend/src/db/database'));
  const data = db.getDb();
  check('Backend DB module load', true, db.DB_PATH ? path.basename(db.DB_PATH) : '');
  check('Có bảng users', Array.isArray(data.users), `users=${(data.users||[]).length}`);
  check('Có bảng products', Array.isArray(data.products), `products=${(data.products||[]).length}`);
  check('Có bảng customers', Array.isArray(data.customers), `customers=${(data.customers||[]).length}`);
  check('Có bảng orders/invoices', Array.isArray(data.invoices), `invoices=${(data.invoices||[]).length}`);
  check('Có bảng order_items/invoice_details', Array.isArray(data.invoice_details), `details=${(data.invoice_details||[]).length}`);
  check('Có bảng print_templates', Array.isArray(data.print_templates), `templates=${(data.print_templates||[]).length}`);
} catch (e) { check('Backend DB module load', false, e.message); }
for (const rf of ['users.js','products.js','invoices.js','printTemplates.js']) {
  check(`API route file: ${rf}`, fs.existsSync(path.join(ROOT,'backend/src/routes',rf)));
}
try {
  const users = fs.readFileSync(path.join(ROOT,'backend/src/routes/users.js'),'utf8');
  check('API login tồn tại', /\/login|post.*login|authLogin/i.test(users));
  const products = fs.readFileSync(path.join(ROOT,'backend/src/routes/products.js'),'utf8');
  check('API products tồn tại', /router\.(get|post|put|delete)/i.test(products));
  const invoices = fs.readFileSync(path.join(ROOT,'backend/src/routes/invoices.js'),'utf8');
  check('API orders/invoices tồn tại', /router\.(get|post|put|delete)/i.test(invoices));
  const pt = fs.readFileSync(path.join(ROOT,'backend/src/routes/printTemplates.js'),'utf8');
  check('API print-template tồn tại', /router\.(get|post|put|delete)/i.test(pt));
} catch (e) { check('API route content scan', false, e.message); }
console.log('\n--- Frontend build ---');
try {
  const r = spawnSync(process.platform==='win32'?'npm.cmd':'npm', ['run','build'], { cwd: path.join(ROOT,'frontend'), encoding:'utf8', timeout:240000, shell:true, windowsHide:true });
  const out = (r.stdout||'')+(r.stderr||'');
  const built = r.status===0 && /built in/i.test(out);
  check('Frontend build pass', built, built?'':String(out).split('\n').filter(Boolean).slice(-3).join(' | '));
} catch (e) { check('Frontend build pass', false, e.message); }
try {
  const distDir = path.join(ROOT,'frontend/dist');
  check('Frontend dist/index.html tồn tại', fs.existsSync(distDir) && fs.existsSync(path.join(distDir,'index.html')));
} catch (e) { check('Frontend dist tồn tại', false, e.message); }
try {
  const html = fs.readFileSync(path.join(ROOT,'frontend/index.html'),'utf8');
  check('index.html có meta charset UTF-8', /charset=["']?UTF-8/i.test(html));
} catch (e) { check('index.html charset', false, e.message); }
console.log(`\n=== HEALTHCHECK: ${pass} pass, ${fail} fail ===`);
process.exit(fail > 0 ? 1 : 0);
