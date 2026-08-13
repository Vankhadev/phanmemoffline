const fs = require('fs');
const p = 'G:/phanmienoffline/frontend/src/App.jsx';
let cv = fs.readFileSync(p, 'utf8');
const pages = ['CreateOrder','OrderList','InvoicePrint','KhoHang','NhaCungCap','Nhaphang','Products','Customers','Stats','CashBook','AccountingDashboard','TaxReport','InventoryReport','AccountingLogs','CustomerOrderReport','ProductReport','Settings'];
let count = 0;
for (const pg of pages) {
  // match <Page ... /> self-closing tag (not already wrapped)
  const re = new RegExp('<(\\/?)' + pg + '(\\b[^>]*?)\\/>', 'g');
  let local = 0;
  cv = cv.replace(re, (m, slash, attrs) => {
    // skip if already inside ErrorBoundary (we check by seeing if preceding is <ErrorBoundary>)
    local++;
    return '<ErrorBoundary><' + pg + attrs + '/></ErrorBoundary>';
  });
  count += local;
}
fs.writeFileSync(p, cv, 'utf8');
console.log('page tags wrapped:', count);
