const fs = require('fs');
const targets = ['G:/phanmienoffline/package.json', 'G:/phanmienoffline/backend/package.json'];
const knownGood = {
  'G:/phanmienoffline/package.json': { productName: 'Bán Hàng Pos', description: 'Bán Hàng Pos - Phần mềm bán hàng offline' },
  'G:/phanmienoffline/backend/package.json': { description: 'Backend for Bán Hàng Pos' },
};
for (const p of targets) {
  if (!fs.existsSync(p)) continue;
  let text = fs.readFileSync(p, 'utf8');
  text = text.replace(/"description":\s*"([^"]+)"/g, (mm, val) => {
    try { const f = Buffer.from(val, 'latin1').toString('utf8'); return '"description": "' + f + '"'; } catch (_) { return mm; }
  });
  text = text.replace(/"productName":\s*"([^"]+)"/g, (mm, val) => {
    try { const f = Buffer.from(val, 'latin1').toString('utf8'); return '"productName": "' + f + '"'; } catch (_) { return mm; }
  });
  const good = knownGood[p] || {};
  if (good.description) text = text.replace(/"description":\s*"[^"]*[\uFFFD][^"]*"/g, '"description": "' + good.description + '"');
  if (good.productName) text = text.replace(/"productName":\s*"[^"]*[\uFFFD][^"]*"/g, '"productName": "' + good.productName + '"');
  fs.writeFileSync(p, text, 'utf8');
  console.log('fixed', p);
}
