/**
 * Bot API routes - offline-safe local stub/settings
 * Không phụ thuộc internet. Lưu cài đặt bot vào JSON DB và trả kết quả kiểm tra tồn kho nội bộ.
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, now } = require('../db/database');

function defaultSettings() {
  return {
    id: 1,
    telegram_bot_token: '',
    telegram_chat_id: '',
    alert_low_stock: 5,
    alert_enabled: true,
    updated_at: now(),
  };
}

function getSettings() {
  let settings = getOne('bot_settings', s => s.id === 1) || getAll('bot_settings')[0];
  if (!settings) {
    const id = insert('bot_settings', defaultSettings());
    settings = getOne('bot_settings', s => s.id === id);
  }
  return {
    ...defaultSettings(),
    ...settings,
    alert_low_stock: Number(settings.alert_low_stock ?? 5) || 5,
    alert_enabled: settings.alert_enabled !== false,
  };
}

router.get('/settings', (req, res) => {
  try {
    res.json(getSettings());
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy cài đặt bot', detail: err.message });
  }
});

router.post('/settings', (req, res) => {
  try {
    const current = getSettings();
    const changes = {
      telegram_bot_token: req.body.telegram_bot_token || '',
      telegram_chat_id: req.body.telegram_chat_id || '',
      alert_low_stock: Number(req.body.alert_low_stock) || 5,
      alert_enabled: req.body.alert_enabled !== false,
      updated_at: now(),
    };
    update('bot_settings', current.id, changes);
    res.json({ ok: true, settings: { ...current, ...changes } });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lưu cài đặt bot', detail: err.message });
  }
});

router.post('/auto-check-stock', (req, res) => {
  try {
    const settings = getSettings();
    const threshold = Number(settings.alert_low_stock) || 5;
    const lowStock = getAll('products', p => p.active !== 0 && Number(p.stock || 0) <= threshold)
      .map(p => ({ id: p.id, sku: p.sku || '', name: p.name || '', stock: Number(p.stock || 0) }));

    if (settings.alert_enabled && lowStock.length > 0) {
      insert('bot_alerts', {
        type: 'low_stock',
        message: `Có ${lowStock.length} sản phẩm tồn kho thấp`,
        payload: lowStock,
        created_at: now(),
      });
    }

    res.json({ ok: true, offline: true, threshold, low_stock_count: lowStock.length, low_stock: lowStock });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi kiểm tra tồn kho', detail: err.message });
  }
});

module.exports = router;
