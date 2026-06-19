const fs = require('fs');
const p = 'G:/phanmienoffline/phanmienoffline.db.json';
const data = JSON.parse(fs.readFileSync(p,'utf8'));
const customers = data.customers || [];
const summary = {
  total: customers.length,
  active0: customers.filter(c => c.active === 0).length,
  active1: customers.filter(c => c.active === 1).length,
  activeNumOther: customers.filter(c => typeof c.active === 'number' && c.active !== 0 && c.active !== 1).length,
  activeStr0: customers.filter(c => c.active === '0').length,
  activeStr1: customers.filter(c => c.active === '1').length,
  missingActive: customers.filter(c => c.active === undefined).length,
};
console.log(JSON.stringify(summary, null, 2));
const sample = customers.slice(0,5).map(c => ({id:c.id,name:c.name,active:c.active,deleted_at:c.deleted_at,customer_code:c.customer_code}));
console.log(JSON.stringify(sample, null, 2));
