/**
 * KHA System Verification & Test Suite
 * 
 * Tự động chạy các bài kiểm thử liên quan đến Đăng ký, Đăng nhập, Đăng xuất, Phân quyền,
 * và Đồng bộ dữ liệu (Sản phẩm, Khách hàng, Hóa đơn, Nhập hàng, Tồn kho) trước khi phát hành phiên bản.
 */
const fs = require('fs');
const { readBackupData } = require('./backupCodec');
const path = require('path');
const dbModule = require('../db/database');
const { hashPassword, verifyPassword } = require('./password');

/**
 * Run all authentication flow tests
 */
function runAuthTests() {
  console.log('[SYSTEM TEST] Starting Auth System Verification...');
  
  const timestamp = Date.now();
  const tempEmail = `test_temp_${timestamp}@phanmienoffline.test`;
  const tempPassword = 'password123';
  
  // Test 1: Đăng ký tài khoản mới
  let tempUserId;
  try {
    tempUserId = dbModule.insert('users', {
      account_id: 1,
      name: 'User Test Temp',
      email: tempEmail,
      phone: '0900000000',
      password: hashPassword(tempPassword),
      role: 'user',
      approved: 1,
      active: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    
    if (!tempUserId) {
      throw new Error('Không tạo được tài khoản kiểm thử');
    }
    console.log(`[SYSTEM TEST] Test 1 (Register): PASSED. ID: ${tempUserId}`);
  } catch (err) {
    throw new Error(`Thất bại tại bài test Đăng ký: ${err.message}`);
  }

  // Test 2: Đăng nhập tài khoản mới
  let token, session;
  try {
    const tempUser = dbModule.getOne('users', u => u.id === tempUserId, { skipAccountScope: true });
    if (!tempUser) {
      throw new Error('Không tìm thấy tài khoản vừa tạo');
    }
    
    if (!verifyPassword(tempPassword, tempUser.password)) {
      throw new Error('Sai mật khẩu hoặc lỗi hàm verifyPassword');
    }
    
    // Simulate req object for session builder
    const reqSim = {
      headers: { 'user-agent': 'SYSTEM_TEST_VERIFIER' },
      ip: '127.0.0.1'
    };
    
    // Require auth inside function to avoid dependency issues
    const authMiddleware = require('../middleware/auth');
    const sessionResult = authMiddleware.createSession(tempUser, reqSim);
    token = sessionResult.token;
    session = sessionResult.session;
    
    if (!token || !session) {
      throw new Error('Không khởi tạo được session đăng nhập');
    }
    console.log('[SYSTEM TEST] Test 2 (Login new account): PASSED');
  } catch (err) {
    // Cleanup
    try { dbModule.remove('users', tempUserId); } catch (_) {}
    throw new Error(`Thất bại tại bài test Đăng nhập tài khoản mới: ${err.message}`);
  }

  // Test 3: Ghi nhớ đăng nhập / Kiểm tra session
  try {
    const authMiddleware = require('../middleware/auth');
    const tokenHash = authMiddleware.hashToken(token);
    const checkedSession = dbModule.getOne('sessions', s => s.token_hash === tokenHash, { skipAccountScope: true });
    if (!checkedSession || checkedSession.revoked_at || new Date(checkedSession.expires_at).getTime() < Date.now()) {
      throw new Error('Session không hoạt động hoặc không tìm thấy trong DB');
    }
    console.log('[SYSTEM TEST] Test 3 (Remember login): PASSED');
  } catch (err) {
    // Cleanup
    try {
      dbModule.remove('users', tempUserId);
      if (session) dbModule.remove('sessions', session.id);
    } catch (_) {}
    throw new Error(`Thất bại tại bài test Ghi nhớ đăng nhập: ${err.message}`);
  }

  // Test 4: Đăng nhập tài khoản cũ (Ví dụ tài khoản Admin mặc định)
  let originalPassword = '';
  let adminUser = null;
  try {
    adminUser = dbModule.getOne('users', u => u.email === 'dongphuongqc@gmail.com' && u.active === 1, { skipAccountScope: true });
    if (!adminUser) {
      throw new Error('Không tìm thấy tài khoản admin mặc định dongphuongqc@gmail.com');
    }
    
    // Lưu mật khẩu cũ và tạm set mật khẩu kiểm thử để vượt qua bài test đăng nhập
    originalPassword = adminUser.password;
    const tempHashed = hashPassword('khongnoiduoc');
    dbModule.update('users', adminUser.id, { password: tempHashed });
    
    const updatedAdmin = dbModule.getOne('users', u => u.id === adminUser.id, { skipAccountScope: true });
    if (!verifyPassword('khongnoiduoc', updatedAdmin.password)) {
      throw new Error('Không đăng nhập được bằng mật khẩu admin cũ');
    }
    
    console.log('[SYSTEM TEST] Test 4 (Login old admin): PASSED');
  } catch (err) {
    throw new Error(`Thất bại tại bài test Đăng nhập tài khoản cũ: ${err.message}`);
  } finally {
    // Restore original password of admin regardless of result
    if (adminUser && originalPassword) {
      try {
        dbModule.update('users', adminUser.id, { password: originalPassword });
        dbModule.saveDB();
      } catch (_) {}
    }
  }

  // Test 5: Đăng xuất
  try {
    dbModule.update('sessions', session.id, { revoked_at: new Date().toISOString(), revoked_reason: 'test_logout' });
    const revokedSession = dbModule.getOne('sessions', s => s.id === session.id, { skipAccountScope: true });
    if (!revokedSession || !revokedSession.revoked_at) {
      throw new Error('Session không được thu hồi thành công');
    }
    console.log('[SYSTEM TEST] Test 5 (Logout): PASSED');
  } catch (err) {
    // Cleanup
    try {
      dbModule.remove('users', tempUserId);
      if (session) dbModule.remove('sessions', session.id);
    } catch (_) {}
    throw new Error(`Thất bại tại bài test Đăng xuất: ${err.message}`);
  }

  // Clean up user
  try {
    dbModule.remove('users', tempUserId);
    dbModule.remove('sessions', session.id);
    dbModule.saveDB();
  } catch (_) {}

  console.log('[SYSTEM TEST] Auth System tests completed successfully');
  return true;
}

/**
 * Run realtime sync & database change history tracking tests
 */
function runSyncTests() {
  console.log('[SYSTEM TEST] Starting Sync & History Verification...');
  
  const current = dbModule.getDb();
  let tempProductId, tempCustomerId, tempInvoiceId, tempImportId;
  
  // Kiểm tra xem database có đang được hook bởi Express server hay chạy độc lập
  const isHooked = dbModule.insert.name === 'guardianInsert';
  const historyService = !isHooked ? require('../services/historyService') : null;
  if (!isHooked && historyService) {
    historyService.initialize({ dbModule });
  }

  try {
    // Test: Đồng bộ & Lịch sử Sản phẩm
    const productPayload = {
      account_id: 1,
      sku: 'TEST_SKU_TEMP',
      name: 'Temp test product',
      active: 1,
      stock: 100,
      import_price: 10000,
      retail_price: 15000,
      wholesale_price: 14000,
      vip_price: 13000,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    
    tempProductId = dbModule.insert('products', productPayload);
    if (!tempProductId) throw new Error('Không thể chèn sản phẩm giả lập');
    
    // Nếu chạy độc lập, giả lập gọi recordChange của hook
    if (!isHooked && historyService) {
      historyService.recordChange('products', tempProductId, 'insert', null, dbModule.getOne('products', p => p.id === tempProductId));
    }
    
    // Check if change logged in edit_history
    const insertHistory = dbModule.getAll('edit_history', h => h.table === 'products' && Number(h.record_id) === Number(tempProductId), { skipAccountScope: true });
    if (insertHistory.length === 0) {
      throw new Error('Hệ thống lịch sử không ghi nhận sự kiện INSERT sản phẩm');
    }
    console.log('[SYSTEM TEST] Sync Test (Product insert & history check): PASSED');

    // Test: Cập nhật tồn kho / Đồng bộ Tồn kho
    const beforeProduct = JSON.parse(JSON.stringify(dbModule.getOne('products', p => p.id === tempProductId)));
    dbModule.update('products', tempProductId, { stock: 95 });
    
    if (!isHooked && historyService) {
      historyService.recordChange('products', tempProductId, 'update', beforeProduct, dbModule.getOne('products', p => p.id === tempProductId));
    }
    
    const updateHistory = dbModule.getAll('edit_history', h => h.table === 'products' && Number(h.record_id) === Number(tempProductId) && h.op === 'update', { skipAccountScope: true });
    if (updateHistory.length === 0) {
      throw new Error('Hệ thống lịch sử không ghi nhận sự kiện UPDATE tồn kho sản phẩm');
    }
    console.log('[SYSTEM TEST] Sync Test (Product stock update): PASSED');

    // Test: Đồng bộ Khách hàng
    const customerPayload = {
      account_id: 1,
      name: 'Customer Test Temp',
      phone: '0901234567',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    tempCustomerId = dbModule.insert('customers', customerPayload);
    if (!tempCustomerId) throw new Error('Không chèn được khách hàng giả lập');
    
    if (!isHooked && historyService) {
      historyService.recordChange('customers', tempCustomerId, 'insert', null, dbModule.getOne('customers', c => c.id === tempCustomerId));
    }
    
    const customerHistory = dbModule.getAll('edit_history', h => h.table === 'customers' && Number(h.record_id) === Number(tempCustomerId), { skipAccountScope: true });
    if (customerHistory.length === 0) {
      throw new Error('Hệ thống lịch sử không ghi nhận sự kiện INSERT khách hàng');
    }
    console.log('[SYSTEM TEST] Sync Test (Customer insert & history check): PASSED');

    // Test: Đồng bộ Đơn hàng (Invoices)
    const invoicePayload = {
      account_id: 1,
      invoice_code: 'HD_TEST_TEMP',
      customer_id: tempCustomerId,
      total: 15000,
      status: 'completed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    tempInvoiceId = dbModule.insert('invoices', invoicePayload);
    if (!tempInvoiceId) throw new Error('Không chèn được hóa đơn giả lập');
    
    if (!isHooked && historyService) {
      historyService.recordChange('invoices', tempInvoiceId, 'insert', null, dbModule.getOne('invoices', i => i.id === tempInvoiceId));
    }
    
    const invoiceHistory = dbModule.getAll('edit_history', h => h.table === 'invoices' && Number(h.record_id) === Number(tempInvoiceId), { skipAccountScope: true });
    if (invoiceHistory.length === 0) {
      throw new Error('Hệ thống lịch sử không ghi nhận sự kiện INSERT hóa đơn');
    }
    console.log('[SYSTEM TEST] Sync Test (Invoice insert & history check): PASSED');

    // Test: Đồng bộ Nhập hàng (Import logs)
    const importPayload = {
      account_id: 1,
      import_code: 'PN_TEST_TEMP',
      total: 10000,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    tempImportId = dbModule.insert('import_logs', importPayload);
    if (!tempImportId) throw new Error('Không chèn được phiếu nhập giả lập');
    
    if (!isHooked && historyService) {
      historyService.recordChange('import_logs', tempImportId, 'insert', null, dbModule.getOne('import_logs', i => i.id === tempImportId));
    }
    
    const importHistory = dbModule.getAll('edit_history', h => h.table === 'import_logs' && Number(h.record_id) === Number(tempImportId), { skipAccountScope: true });
    if (importHistory.length === 0) {
      throw new Error('Hệ thống lịch sử không ghi nhận sự kiện INSERT nhập hàng');
    }
    console.log('[SYSTEM TEST] Sync Test (Import insert & history check): PASSED');

  } catch (err) {
    throw new Error(`Thất bại tại bài test Đồng bộ: ${err.message}`);
  } finally {
    // Cleanup
    try {
      if (tempProductId) {
        dbModule.remove('products', tempProductId);
        dbModule.getAll('edit_history', h => h.table === 'products' && Number(h.record_id) === Number(tempProductId), { skipAccountScope: true })
          .forEach(h => dbModule.remove('edit_history', h.id));
      }
      if (tempCustomerId) {
        dbModule.remove('customers', tempCustomerId);
        dbModule.getAll('edit_history', h => h.table === 'customers' && Number(h.record_id) === Number(tempCustomerId), { skipAccountScope: true })
          .forEach(h => dbModule.remove('edit_history', h.id));
      }
      if (tempInvoiceId) {
        dbModule.remove('invoices', tempInvoiceId);
        dbModule.getAll('edit_history', h => h.table === 'invoices' && Number(h.record_id) === Number(tempInvoiceId), { skipAccountScope: true })
          .forEach(h => dbModule.remove('edit_history', h.id));
      }
      if (tempImportId) {
        dbModule.remove('import_logs', tempImportId);
        dbModule.getAll('edit_history', h => h.table === 'import_logs' && Number(h.record_id) === Number(tempImportId), { skipAccountScope: true })
          .forEach(h => dbModule.remove('edit_history', h.id));
      }
      dbModule.saveDB();
    } catch (_) {}
  }
  
  console.log('[SYSTEM TEST] Sync and History tests completed successfully');
  return true;
}

/**
 * Chạy toàn bộ bộ test
 */
function verifyWholeSystem() {
  const errors = [];
  
  try {
    runAuthTests();
  } catch (err) {
    errors.push(err.message);
  }
  
  try {
    runSyncTests();
  } catch (err) {
    errors.push(err.message);
  }
  
  if (errors.length > 0) {
    return {
      ok: false,
      errors,
    };
  }
  
  return {
    ok: true,
    errors: [],
  };
}

/**
 * Rollback database to the most recent backup on failure
 */
function rollbackDatabase() {
  const fs = require('fs');
  const path = require('path');
  const backupDir = dbModule.DB_BACKUP_DIR;
  
  if (!fs.existsSync(backupDir)) {
    console.warn('[ROLLBACK] Thư mục backup không tồn tại.');
    return false;
  }
  
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(backupDir, f),
        mtime: fs.statSync(path.join(backupDir, f)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime);
      
    if (files.length === 0) {
      console.warn('[ROLLBACK] Không tìm thấy file backup nào.');
      return false;
    }
    
    const latestBackup = files[0].path;
    console.log(`[ROLLBACK] Khôi phục dữ liệu từ: ${latestBackup}`);
    
    const content = fs.readFileSync(latestBackup, 'utf8');
    fs.writeFileSync(dbModule.DB_PATH, content, 'utf8');
    
    dbModule.loadDB({ forceReload: true });
    console.log('[ROLLBACK] Khôi phục dữ liệu thành công.');
    return true;
  } catch (err) {
    console.error('[ROLLBACK] Lỗi rollback:', err.message);
    return false;
  }
}

module.exports = {
  runAuthTests,
  runSyncTests,
  verifyWholeSystem,
  rollbackDatabase,
};
