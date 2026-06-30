const express = require("express");
const router = express.Router();
const RecoveryEngine = require("../services/RecoveryEngine");

function ensureInit() {
  if (!RecoveryEngine.getStatus().initialized) {
    RecoveryEngine.initialize({ dbModule: require("../db/database") });
  }
}

/** GET /api/restore/scan - Public endpoint, không yêu cầu token/đăng nhập */
router.get("/scan", async (_req, res) => {
  ensureInit();
  try {
    const result = await RecoveryEngine.scanBackupFiles({});
    if (result.ok) {
      res.json({
        success: true,
        files: (result.files || []).map(f => ({
          path: f.path,
          name: require("path").basename(f.path),
          size: f.size || 0,
          modifiedAt: f.mtimeMs ? new Date(f.mtimeMs).toISOString() : null,
        })),
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message || "Không thể quét file backup",
        errorCode: "RESTORE_SCAN_FAILED",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Lỗi hệ thống khi quét backup: " + (error && error.message),
      errorCode: "RESTORE_SCAN_ERROR",
    });
  }
});

module.exports = router;
