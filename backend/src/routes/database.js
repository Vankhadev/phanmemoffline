const express = require('express');
const router = express.Router();
const {
  loadDB,
  setDBPath,
  writeDatabaseConfig,
  performDeepScan,
} = require('../db/database');

/**
 * POST /api/database/restore-scan
 *
 * Scans all drives/directories for database files, ranks them,
 * selects the one with the most records, writes the path to config.json,
 * updates runtime DB_PATH, reloads the database memory cache, and returns stats.
 */
router.post('/restore-scan', (req, res) => {
  try {
    console.log('[API DATABASE] Bắt đầu quét và khôi phục database tốt nhất...');
    const statsList = performDeepScan();

    if (statsList.length === 0) {
      return res.json({
        ok: false,
        message: 'Không tìm thấy file database hoặc backup nào.',
        productsCount: 0,
        customersCount: 0,
        invoicesCount: 0,
      });
    }

    const best = statsList[0];
    if (best.isEmpty) {
      return res.json({
        ok: false,
        message: 'Tất cả các database tìm thấy đều rỗng.',
        productsCount: 0,
        customersCount: 0,
        invoicesCount: 0,
      });
    }

    console.log(`[API DATABASE] Lựa chọn database tốt nhất: ${best.path}`);
    console.log(`[API DATABASE] Số sản phẩm: ${best.productsCount}, Số khách hàng: ${best.customersCount}, Số hóa đơn: ${best.invoicesCount}`);

    // Update config.json
    writeDatabaseConfig(best.path);

    // Update runtime DB_PATH
    setDBPath(best.path);

    // Force reload memory cache
    loadDB({ forceReload: true });

    // Run auth repair & self-healing on the newly loaded database
    try {
      const { ensureAuthSchema, repairUserAuthSystem } = require('../services/authRepairService');
      ensureAuthSchema();
      repairUserAuthSystem();
      console.log('[API DATABASE] Đã chạy tự sửa lỗi phân quyền/mật khẩu sau khi khôi phục.');
    } catch (repairErr) {
      console.error('[API DATABASE] Lỗi chạy auth repair sau restore:', repairErr.message);
    }

    res.json({
      ok: true,
      message: 'Khôi phục dữ liệu thành công!',
      path: best.path,
      productsCount: best.productsCount,
      customersCount: best.customersCount,
      invoicesCount: best.invoicesCount,
    });
  } catch (error) {
    console.error('[API DATABASE RESTORE SCAN ERROR]', error);
    res.status(500).json({
      ok: false,
      error: error.message,
      message: 'Có lỗi xảy ra trong quá trình khôi phục dữ liệu.',
    });
  }
});

module.exports = router;
