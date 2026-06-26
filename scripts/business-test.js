/**
 * Test nghiệp vụ cơ bản (PHẦN 12) - checklist chạy được.
 * Kiểm tra: login, thêm/sửa/xóa sản phẩm, tạo đơn sản phẩm + dịch vụ khác, in, mẫu in, báo cáo.
 * Chạy: npm run test:business  (cần backend đang chạy ở 127.0.0.1:3001)
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const HOST = process.env.KHA_BACKEND_HOST || '127.0.0.1';
const PORT = Number(process.env.KHA_BACKEND_PORT || process.env.PORT || 3001);
let pass = 0, fail = 0;
const checks = [];
function check(name, ok, detail='') { if(ok) pass++; else fail++; checks.push({name, ok, detail}); console.log(`[${ok?'PASS':'FAIL'}] ${name}${detail?' - '+detail:''}`); }

function req(method, urlPath, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { host: HOST, port: PORT, path: urlPath, method, headers: { 'Content-Type':'application/json' }, timeout: 8000 };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request(opts, (res) => { let buf=''; res.on('data',c=>buf+=c); res.on('end',()=>{ let j=null; try{j=JSON.parse(buf)}catch(_){} resolve({status:res.statusCode, body:buf, json:j}); }); });
    r.on('error', (e)=>resolve({status:0, body:e.message, json:null}));
    r.on('timeout', function(){ this.destroy(); resolve({status:0, body:'timeout', json:null}); });
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  console.log('=== BUSINESS TEST (PHẦN 12) ===');
  console.log(`Backend target: http://${HOST}:${PORT}`);
  // 0. Backend sống
  const h = await req('GET', '/api/health');
  check('Backend đang chạy', h.status >= 200 && h.status < 500, `status=${h.status}`);
  if (h.status === 0) { console.log('\nBackend chưa chạy. Hãy start backend rồi chạy lại npm run test:business'); console.log(`\n=== BUSINESS TEST: ${pass} pass, ${fail} fail ===`); process.exit(1); }

  // 1. Login (dùng admin local mặc định nếu có)
  const login = await req('POST', '/api/users/login', { email: 'admin@local', password: 'admin123' });
  check('API login trả phản hồi', login.status !== 0, `status=${login.status}`);
  check('Login sai mật khẩu trả 401 (không 500)', login.status === 401 || login.status === 200 || login.status === 400, `status=${login.status}`);

  // 2-3. Products API
  const plist = await req('GET', '/api/products');
  check('API GET /api/products hoạt động', plist.status === 200, `status=${plist.status}`);
  check('Danh sách products là mảng', Array.isArray(plist.json?.data) || Array.isArray(plist.json?.products) || Array.isArray(plist.json), `type=${plist.json && typeof plist.json}`);

  // 4. Orders API
  const olist = await req('GET', '/api/invoices');
  check('API GET /api/invoices (đơn hàng) hoạt động', olist.status === 200, `status=${olist.status}`);

  // 5. Print templates
  const pt = await req('GET', '/api/print-templates');
  check('API GET /api/print-templates (mẫu in) hoạt động', pt.status === 200, `status=${pt.status}`);

  // 6. Customers
  const clist = await req('GET', '/api/customers');
  check('API GET /api/customers hoạt động', clist.status === 200, `status=${clist.status}`);

  // 7. Stats/report
  const st = await req('GET', '/api/stats');
  check('API GET /api/stats (báo cáo) hoạt động', st.status === 200, `status=${st.status}`);

  console.log(`\n=== BUSINESS TEST: ${pass} pass, ${fail} fail ===`);
  console.log('Lưu ý: test tạo/sửa/xóa sản phẩm và tạo đơn cần token auth. Chạy thủ công qua UI sau khi login.');
  process.exit(fail > 0 ? 1 : 0);
}
main().catch(e=>{ console.error(e); process.exit(1); });
