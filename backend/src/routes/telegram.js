const express = require('express');
const router = express.Router();
const {
  BOT_DEFINITIONS,
  getTelegramSettings,
  saveTelegramSettings,
  testSingleBot,
  testAllBots,
  notifyTelegram,
} = require('../services/telegramService');

/**
 * GET /api/telegram/settings
 * Lấy cấu hình 12 bot telegram và thông tin group ID
 */
router.get('/settings', (req, res) => {
  try {
    const settings = getTelegramSettings();
    res.json({
      ok: true,
      settings,
      botDefinitions: BOT_DEFINITIONS,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || 'Lỗi khi tải cấu hình Telegram.',
    });
  }
});

/**
 * PUT /api/telegram/settings
 * Lưu cấu hình 12 bot telegram và group ID
 */
router.put('/settings', (req, res) => {
  try {
    const updated = saveTelegramSettings(req.body || {});
    res.json({
      ok: true,
      message: 'Đã lưu cấu hình 12 Bot Telegram thành công.',
      settings: updated,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || 'Lỗi khi lưu cấu hình Telegram.',
    });
  }
});

/**
 * POST /api/telegram/test-bot
 * Kiểm tra kết nối 1 bot cụ thể
 */
router.post('/test-bot', async (req, res) => {
  try {
    const { botKey, token, groupId } = req.body || {};
    if (!botKey) {
      return res.status(400).json({ ok: false, error: 'Thiếu mã bot (botKey).' });
    }
    const result = await testSingleBot(botKey, token, groupId);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || 'Lỗi khi kiểm tra kết nối bot Telegram.',
    });
  }
});

/**
 * POST /api/telegram/test-all
 * Kiểm tra kết nối tất cả các bot đã nhập token
 */
router.post('/test-all', async (req, res) => {
  try {
    const { groupId } = req.body || {};
    const result = await testAllBots(groupId);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || 'Lỗi khi kiểm tra kết nối toàn bộ bot Telegram.',
    });
  }
});

/**
 * POST /api/telegram/send-report
 * Gửi báo cáo tức thì từ các trang Thống kê, Báo cáo đơn, Báo cáo SP, Top KH
 */
router.post('/send-report', (req, res) => {
  try {
    const { botKey, eventType = 'Báo cáo nhanh', data = {} } = req.body || {};
    if (!botKey) {
      return res.status(400).json({ ok: false, error: 'Thiếu mã bot (botKey).' });
    }
    notifyTelegram(botKey, eventType, data);
    res.json({
      ok: true,
      message: 'Đã đưa yêu cầu gửi báo cáo vào hàng đợi gửi Telegram.',
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || 'Lỗi khi gửi báo cáo qua Telegram.',
    });
  }
});

module.exports = router;
