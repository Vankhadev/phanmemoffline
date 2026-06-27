const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const {
  loadDB,
  setDBPath,
  writeDatabaseConfig,
  performDeepScan,
  createDbBackup,
  DB_PATH,
} = require('../db/database');

/**
 * POST /api/database/restore-scan
 *
 * Quét các ổ đĩa/thư mục tìm file database/backup, xếp hạng,
 * chọn file có nhiều bản ghi nhất, tạo backup an toàn của DB hiện tại,
 * ghi đường dẫn vào config.json, cập nhật DB_PATH runtime, nạp lại cache
 * và trả về thống kê.
 *
 * Bảo vệ dữ liệu:
 *  - Bắt buộc tạo backup an toàn DB hiện tại TRƯỚC khi đổi config/DB_PATH.
 *  - Nếu backup an toàn thất bại => KHÔNG restore, giữ nguyên DB hiện tại.
 *  - Nếu restore thất bại => khôi phục lại config/DB_PATH cũ, giữ nguyên DB.
 *  - Báo lỗi rõ nguyên nhân: không có backup / file không hợp lệ / không có quyền đọc / backend.
 */
router.post('/restore-scan', (req, res) => {
  const previousDbPath = DB_PATH;
  console.log('[API DATABASE] Bắt đầu quét và khôi phục database tốt nhất...');

  try {
    const statsList = performDeepScan();

    if (statsList.length === 0) {
      return res.json({
        ok: false,
        message: 'Không tìm thấy file backup để khôi phục.',
        productsCount: 0,
        customersCount: 0,
        invoicesCount: 0,
      });
    }

    const best = statsList[0];
    if (best.isEmpty) {
      return res.json({
        ok: false,
        message: 'Không tìm thấy file backup chứa dữ liệu để khôi phục.',
        productsCount: 0,
        customersCount: 0,
        invoicesCount: 0,
      });
    }

    // Verify file tốt nhất thực sự đọc được + hợp lệ (phân biệt lỗi quyền đọc / file hỏng)
    try {
      fs.accessSync(best.path, fs.constants.R_OK);
    } catch (accessErr) {
      return res.status(500).json({
        ok: false,
        message: 'Không có quyền đọc file backup.',
        error: accessErr && accessErr.message,
        path: best.path,
      });
    }

    let verifyData = null;
    try {
      const raw = fs.readFileSync(best.path, 'utf8');
      verifyData = raw.trim() ? JSON.parse(raw) : null;
    } catch (parseErr) {
      return res.status(500).json({
        ok: false,
        message: 'File backup không hợp lệ.',
        error: parseErr && parseErr.message,
        path: best.path,
      });
    }

    if (!verifyData || typeof verifyData !== 'object') {
      return res.status(500).json({
        ok: false,
        message: 'File backup không hợp lệ.',
        path: best.path,
      });
    }

    console.log('[API DATABASE] Lựa chọn database tốt nhất:', best.path);
    console.log(`[API DATABASE] Số sản phẩm: ${best.productsCount}, Số khách hàng: ${best.customersCount}, Số hóa đơn: ${best.invoicesCount}`);

    // Tạo backup an toàn của DB hiện tại TRƯỚC khi đổi config/restore.
    let safetyBackup = null;
    try {
      safetyBackup = createDbBackup('pre-restore-scan', { skipRetention: false });
    } catch (backupErr) {
      console.error('[API DATABASE] Lỗi tạo backup an toàn trước restore:', backupErr && backupErr.message);
    }

    if (!safetyBackup) {
      // Không ghi đè DB hiện tại khi chưa có backup an toàn.
      return res.status(500).json({
        ok: false,
        message: 'Khôi phục thất bại, dữ liệu hiện tại đã được giữ nguyên. Không tạo được backup an toàn trước khi khôi phục.',
      });
    }

    console.log('[API DATABASE] Đã tạo backup an toàn:', safetyBackup.path);

    // Update config.json
    let configWritten = true;
    try {
      writeDatabaseConfig(best.path);
    } catch (cfgErr) {
      configWritten = false;
      console.error('[API DATABASE] Lỗi ghi config khi restore:', cfgErr && cfgErr.message);
    }

    if (!configWritten) {
      // Restore thất bại, giữ nguyên DB hiện tại (config không đổi).
      return res.status(500).json({
        ok: false,
        message: 'Khôi phục thất bại, dữ liệu hiện tại đã được giữ nguyên. Không ghi được file cấu hình.',
        safetyBackupPath: safetyBackup.path,
      });
    }

    // Update runtime DB_PATH
    let pathUpdated = true;
    try {
      setDBPath(best.path);
    } catch (pathErr) {
      pathUpdated = false;
      console.error('[API DATABASE] Lỗi cập nhật DB_PATH khi restore:', pathErr && pathErr.message);
    }

    if (!pathUpdated) {
      // Quay lại config cũ để giữ nguyên DB hiện tại.
      try { writeDatabaseConfig(previousDbPath); } catch (_) {}
      return res.status(500).json({
        ok: false,
        message: 'Khôi phục thất bại, dữ liệu hiện tại đã được giữ nguyên. Không cập nhật được đường dẫn database runtime.',
        safetyBackupPath: safetyBackup.path,
      });
    }

    // Force reload memory cache
    let reloaded = true;
    try {
      loadDB({ forceReload: true });
    } catch (loadErr) {
      reloaded = false;
      console.error('[API DATABASE] Lỗi nạp lại DB sau restore:', loadErr && loadErr.message);
    }

    if (!reloaded) {
      // Quay lại DB cũ.
      try { setDBPath(previousDbPath); } catch (_) {}
      try { writeDatabaseConfig(previousDbPath); } catch (_) {}
      try { loadDB({ forceReload: true }); } catch (_) {}
      return res.status(500).json({
        ok: false,
        message: 'Khôi phục thất bại, dữ liệu hiện tại đã được giữ nguyên. Không nạp lại được database đã khôi phục.',
        safetyBackupPath: safetyBackup.path,
      });
    }

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
      safetyBackupPath: safetyBackup.path,
    });
  } catch (error) {
    console.error('[API DATABASE RESTORE SCAN ERROR]', error);
    // Đảm bảo không để DB ở trạng thái nửa vời.
    try { setDBPath(previousDbPath); } catch (_) {}
    try { writeDatabaseConfig(previousDbPath); } catch (_) {}
    try { loadDB({ forceReload: true }); } catch (_) {}
    res.status(500).json({
      ok: false,
      error: error && error.message,
      message: 'Khôi phục thất bại, dữ liệu hiện tại đã được giữ nguyên.',
    });
  }
});

module.exports = router;
