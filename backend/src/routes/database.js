const express = require("express");
const router = express.Router();
const RecoveryEngine = require("../services/RecoveryEngine");
const dbModule = require("../db/database");

function ensureRecovery() {
  if (!RecoveryEngine.getStatus().initialized) RecoveryEngine.initialize({ dbModule });
}

/**
 * POST /api/database/restore-scan
 *
 * Endpoint cu duoc giu tuong thich nhung KHONG con khoi phuc ngay.
 * v2.3.9: Chi quet file backup va tra danh sach. Muon import phai goi
 * /api/recovery/restore-files voi danh sach file da xac nhan.
 */
router.post("/restore-scan", async (req, res) => {
  ensureRecovery();
  try {
    const result = await RecoveryEngine.scanBackupFiles(req.body || {});
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Quet backup that bai.", error: error && error.message });
  }
});

module.exports = router;
