const express = require('express');
const router = express.Router();
const RecoveryEngine = require('../services/RecoveryEngine');
const dbModule = require('../db/database');

function ensureRecovery() {
  if (!RecoveryEngine.getStatus().initialized) RecoveryEngine.initialize({ dbModule });
}

/**
 * POST /api/database/restore-scan
 *
 * Giữ endpoint cũ nhưng đổi cơ chế sang MERGE an toàn:
 * - Không chọn 1 backup mới nhất để ghi đè DB hiện tại.
 * - Tạo backup pre-restore, quét/giải nén/merge nhiều backup từ cũ đến mới.
 * - Lỗi thì rollback trong RecoveryEngine.
 */
router.post('/restore-scan', async (req, res) => {
  ensureRecovery();
  try {
    if (RecoveryEngine.getStatus().running) {
      return res.json({ ok: false, running: true, message: 'Recovery đang chạy nền. Vui lòng đợi.' });
    }
    const result = await RecoveryEngine.runRecovery({});
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'Khôi phục thất bại, dữ liệu hiện tại đã được giữ nguyên.', error: error && error.message });
  }
});

module.exports = router;
