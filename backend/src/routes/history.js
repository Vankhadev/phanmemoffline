/**
 * KHA History & Restore API Routes
 */
const express = require('express');
const router = express.Router();
const { getAll } = require('../db/database');
const historyService = require('../services/historyService');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/history/:table/:recordId
 * Lấy danh sách lịch sử thay đổi của một bản ghi cụ thể
 */
router.get('/:table/:recordId', requireAuth, (req, res) => {
  try {
    const { table, recordId } = req.params;
    const history = getAll('edit_history', h => h.table === table && Number(h.record_id) === Number(recordId), { skipAccountScope: true })
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lấy lịch sử thay đổi', detail: err.message });
  }
});

/**
 * POST /api/history/restore/:historyId
 * Khôi phục bản ghi về một phiên bản lịch sử cụ thể
 */
router.post('/restore/:historyId', requireAuth, (req, res) => {
  try {
    const { historyId } = req.params;
    const context = {
      userId: req.user?.id || null,
      userName: req.user?.name || 'Hệ thống',
    };
    
    historyService.restoreVersion(historyId, context);
    res.json({ ok: true, message: 'Khôi phục bản ghi thành công' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi khôi phục bản ghi', detail: err.message });
  }
});

module.exports = router;
