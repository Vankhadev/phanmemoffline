const http = require('http');
const express = require('express');
const accountingRoutes = require('../src/routes/accounting');

// Mock auth middleware for testing
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = { id: 1, name: 'Admin Test', role: 'admin' };
  req.permissions = ['debts.read', 'accounting.read', 'accounting.manage'];
  req.accountId = 1;
  next();
});

app.use('/api/accounting', accountingRoutes);

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, headers: res.headers });
        }
      });
    }).on('error', reject);
  });
}

function getBinary(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, buffer: Buffer.concat(chunks), headers: res.headers });
      });
    }).on('error', reject);
  });
}

async function runTests() {
  const server = app.listen(7991, '127.0.0.1', async () => {
    console.log('[TEST] Accounting debt test server listening on port 7991\n');
    let passed = 0;

    try {
      // 1. Full aging report
      const res1 = await getJson('http://127.0.0.1:7991/api/accounting/debts/aging');
      console.log('1. GET /api/accounting/debts/aging:');
      console.log('   Status:', res1.status);
      console.log('   OK:', res1.data.ok);
      console.log('   Total Receivable:', res1.data.kpi_summary?.total_receivable?.toLocaleString('vi-VN'), 'đ');
      console.log('   Total Overdue:', res1.data.kpi_summary?.total_overdue?.toLocaleString('vi-VN'), 'đ');
      console.log('   Customer count:', res1.data.customer_summary?.length);
      console.log('   Invoices count:', res1.data.invoice_details?.length);
      if (res1.status === 200 && res1.data.ok) passed++;

      // 2. Summary KPI cards
      const res2 = await getJson('http://127.0.0.1:7991/api/accounting/debts/aging/summary');
      console.log('\n2. GET /api/accounting/debts/aging/summary:');
      console.log('   Status:', res2.status);
      console.log('   Aging Breakdown:', Object.keys(res2.data.kpi_summary?.aging_breakdown || {}));
      console.log('   Overdue Percentage:', res2.data.kpi_summary?.overdue_percentage, '%');
      if (res2.status === 200 && res2.data.ok) passed++;

      // 3. AI Context
      const res3 = await getJson('http://127.0.0.1:7991/api/accounting/debts/aging/ai-context');
      console.log('\n3. GET /api/accounting/debts/aging/ai-context:');
      console.log('   Status:', res3.status);
      console.log('   AI Overview:', res3.data.ai_summary_context?.overview);
      console.log('   Top 5 Debtors count:', res3.data.ai_summary_context?.top_5_debtors?.length);
      if (res3.status === 200 && res3.data.ok) passed++;

      // 4. Single Customer Debt Report
      const res4 = await getJson('http://127.0.0.1:7991/api/accounting/debts/aging/customer/1');
      console.log('\n4. GET /api/accounting/debts/aging/customer/1:');
      console.log('   Status:', res4.status);
      console.log('   Customer Name:', res4.data.customer?.customer_name);
      console.log('   Customer Debt:', res4.data.customer?.total_remaining_debt?.toLocaleString('vi-VN'), 'đ');
      console.log('   Unpaid Invoices:', res4.data.invoices?.length);
      if (res4.status === 200 && res4.data.ok) passed++;

      // 5. Excel Export
      const res5 = await getBinary('http://127.0.0.1:7991/api/accounting/debts/aging/export-excel');
      console.log('\n5. GET /api/accounting/debts/aging/export-excel:');
      console.log('   Status:', res5.status);
      console.log('   Content-Type:', res5.headers['content-type']);
      console.log('   Content-Disposition:', res5.headers['content-disposition']);
      console.log('   File Size:', res5.buffer.length, 'bytes');
      console.log('   Is Valid Zip/XLSX (PK):', res5.buffer.slice(0, 2).toString() === 'PK');
      if (res5.status === 200 && res5.buffer.slice(0, 2).toString() === 'PK') passed++;

      // 6. Filter by Status (overdue) and Aging Bucket (over_60)
      const res6 = await getJson('http://127.0.0.1:7991/api/accounting/debts/aging?status=overdue&aging_bucket=over_60');
      console.log('\n6. GET /api/accounting/debts/aging?status=overdue&aging_bucket=over_60:');
      console.log('   Status:', res6.status);
      console.log('   Filtered Invoices count:', res6.data.invoice_details?.length);
      if (res6.status === 200 && res6.data.ok) passed++;

      console.log(`\n========================================`);
      console.log(`TEST RESULT: ${passed}/6 PASSED SUCCESSFULLY!`);
      console.log(`========================================`);
    } catch (err) {
      console.error('Test execution error:', err);
    } finally {
      server.close();
      process.exit(passed === 6 ? 0 : 1);
    }
  });
}

runTests();
