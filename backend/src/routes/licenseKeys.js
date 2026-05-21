const express = require('express');
const router = express.Router();
const { now } = require('../db/database');

function buildPublicLicenseStatus() {
  return {
    ok: true,
    licensed: false,
    status: 'not_configured',
    message: 'Chưa cấu hình giấy phép cho bản cài đặt này.',
    features: [],
    expires_at: null,
    issued_to: null,
    serverTime: now(),
  };
}

router.get('/status', (_req, res) => {
  res.json(buildPublicLicenseStatus());
});

module.exports = router;
