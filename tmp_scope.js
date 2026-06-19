const fs = require('fs');
const data = JSON.parse(fs.readFileSync('G:/phanmienoffline/phanmienoffline.db.json','utf8'));
const customers = data.customers || [];
console.log(customers.map(c => ({id:c.id,name:c.name,active:c.active,account_id:c.account_id,customer_code:c.customer_code})));
const invoices = data.invoices || [];
console.log('invoice account ids sample', Array.from(new Set(invoices.slice(0,50).map(i=>i.account_id))).slice(0,10));
