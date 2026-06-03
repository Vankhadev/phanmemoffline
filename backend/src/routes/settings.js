const express = require('express');
const { requirePermission } = require('../middleware/auth');
const {
  getNegativeStockSettingsAsync,
  updateNegativeStockSettingsAsync,
} = require('../services/settingsService');

const router = express.Router();
const canManageSettings = requirePermission('settings.manage');

function getAccountId(req) {
  return req.accountId || req.account?.id || req.user?.account_id || 1;
}

function serializeSettingsPayload(settings) {
  return {
    ok: true,
    negative_stock_enabled: settings.negative_stock_enabled,
    negativeStockEnabled: settings.negative_stock_enabled,
    negative_stock_limit: settings.negative_stock_limit,
    negativeStockLimit: settings.negative_stock_limit,
    minimum_allowed_stock: settings.minimum_allowed_stock,
    minimumAllowedStock: settings.minimum_allowed_stock,
    runtime_minimum_stock: settings.runtime_minimum_stock,
    inventory: {
      negative_stock_enabled: settings.negative_stock_enabled,
      negative_stock_limit: settings.negative_stock_limit,
      minimum_allowed_stock: settings.minimum_allowed_stock,
    },
    negativeStock: {
      enabled: settings.negative_stock_enabled,
      limit: settings.negative_stock_limit,
      minimum_allowed_stock: settings.minimum_allowed_stock,
    },
    source: settings.source || 'json',
    mysql: settings.mysql || undefined,
    feature_key: settings.feature_key,
    feature: settings.feature,
    settings: settings.settings,
    data: {
      negative_stock_enabled: settings.negative_stock_enabled,
      negative_stock_limit: settings.negative_stock_limit,
      minimum_allowed_stock: settings.minimum_allowed_stock,
    },
  };
}

async function handleGetNegativeStockSettings(req, res) {
  try {
    const settings = await getNegativeStockSettingsAsync({ accountId: getAccountId(req) });
    res.json(serializeSettingsPayload(settings));
  } catch (error) {
    res.status(error.status || error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Không thể tải thiết lập hệ thống.',
      message: error.message || 'Không thể tải thiết lập hệ thống.',
      code: error.code || 'SETTINGS_READ_ERROR',
      details: error.details || undefined,
    });
  }
}

async function handleUpdateNegativeStockSettings(req, res) {
  try {
    const result = await updateNegativeStockSettingsAsync(req.body || {}, {
      accountId: getAccountId(req),
      userId: req.user?.id || null,
      source: req.path === '/negative-stock' ? 'settings_negative_stock_api' : 'settings_api',
    });
    res.json({
      ...serializeSettingsPayload(result.after),
      before: {
        negative_stock_enabled: result.before.negative_stock_enabled,
        negative_stock_limit: result.before.negative_stock_limit,
        minimum_allowed_stock: result.before.minimum_allowed_stock,
      },
      changes: result.changes,
      updated: Object.keys(result.changes || {}).length > 0,
    });
  } catch (error) {
    res.status(error.status || error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Không thể cập nhật thiết lập hệ thống.',
      message: error.message || 'Không thể cập nhật thiết lập hệ thống.',
      code: error.code || 'SETTINGS_UPDATE_ERROR',
      details: error.details || undefined,
    });
  }
}

router.get('/', handleGetNegativeStockSettings);
router.put('/', canManageSettings, handleUpdateNegativeStockSettings);
router.get('/negative-stock', handleGetNegativeStockSettings);
router.put('/negative-stock', canManageSettings, handleUpdateNegativeStockSettings);

module.exports = router;
