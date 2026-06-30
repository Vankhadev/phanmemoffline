/**
 * Recovery Routes v2.3.9
 * Tach thanh 2 buoc: scan va restore
 */
const express = require("express");
const router = express.Router();
const RecoveryEngine = require("../services/RecoveryEngine");

function ensureInit() {
  if (!RecoveryEngine.getStatus().initialized) {
    RecoveryEngine.initialize({ dbModule: require("../db/database") });
  }
}

// BUOC 1: Quet file backup (chi tim file, KHONG import)
router.post("/scan-files", async (req, res) => {
  ensureInit();
  try {
    const options = req.body || {};
    const result = await RecoveryEngine.scanBackupFiles(options);
    res.json(result);
  } catch (error) {
    res.json({ ok: false, message: "Lỗi quét backup: " + (error && error.message) });
  }
});

// BUOC 2: Khoi phuc backup (import tu danh sach file da quet)
router.post("/restore-files", async (req, res) => {
  ensureInit();
  try {
    const { files, batchSize, deepScan } = req.body || {};
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.json({ ok: false, message: "Vui lòng chọn ít nhất 1 file backup để khôi phục." });
    }
    const result = await RecoveryEngine.restoreBackups({ files, batchSize, deepScan });
    res.json(result);
  } catch (error) {
    res.json({ ok: false, message: "Lỗi khôi phục: " + (error && error.message) });
  }
});

// (OLD) Bat dau quet + khoi phuc toan bo backup (chay nen) - tich hop 2 buoc
router.post("/scan-and-restore", async (req, res) => {
  ensureInit();
  try {
    const result = await RecoveryEngine.runRecovery(req.body || {});
    res.json(result);
  } catch (error) {
    res.json({ ok: false, message: "Loi khoi phuc: " + (error && error.message) });
  }
});

// Quet sau toan bo o dia (che do nang cao)
router.post("/deep-scan", async (req, res) => {
  ensureInit();
  try {
    const result = await RecoveryEngine.deepScanAllDrives(req.body || {});
    res.json(result);
  } catch (error) {
    res.json({ ok: false, message: "Lỗi quét sâu: " + (error && error.message) });
  }
});

// Kiem tra tinh hop le cua cac file backup
router.post("/verify-files", async (req, res) => {
  ensureInit();
  try {
    const { files } = req.body || {};
    const result = await RecoveryEngine.verifyBackupFiles(files || []);
    res.json(result);
  } catch (error) {
    res.json({ ok: false, message: "Lỗi kiểm tra: " + (error && error.message) });
  }
});

// Huy khoi phuc an toan
router.post("/cancel", (req, res) => {
  ensureInit();
  res.json(RecoveryEngine.cancelRecovery());
});

// Trang thai tien trinh
router.get("/status", (req, res) => {
  ensureInit();
  res.json({ ok: true, ...RecoveryEngine.getStatus() });
});

// File backup da tim thay
router.get("/found-files", (req, res) => {
  ensureInit();
  const s = RecoveryEngine.getStatus();
  res.json({ ok: true, files: s.foundFiles || [], total: (s.foundFiles || []).length });
});

// Logs
router.get("/logs", (req, res) => {
  ensureInit();
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  res.json({ ok: true, logs: RecoveryEngine.getLogs(limit) });
});

router.get("/logs/:file", (req, res) => {
  ensureInit();
  try {
    const log = RecoveryEngine.readLog(req.params.file);
    res.json({ ok: true, log });
  } catch (e) {
    res.status(404).json({ ok: false, message: "Không tìm thấy log." });
  }
});

// Xuat bao cao
router.post("/export-report", (req, res) => {
  ensureInit();
  const report = RecoveryEngine.getStatus().lastReport;
  if (!report) return res.json({ ok: false, message: "Chưa có báo cáo. Hãy chạy khôi phục trước." });
  res.setHeader("Content-Disposition", "attachment; filename=\"recovery-report.json\"");
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(report, null, 2));
});

// Rollback ve ban truoc restore
router.post("/rollback", (req, res) => {
  ensureInit();
  const { backupPath } = req.body || {};
  if (!backupPath) return res.status(400).json({ ok: false, message: "Thiếu đường dẫn backup rollback." });
  try {
    const safetyBackup = RecoveryEngine.getStatus().lastReport?.safetyBackup;
    if (backupPath === "latest_safety" && safetyBackup) {
      RecoveryEngine.rollbackToPreRestore(safetyBackup.path);
      return res.json({ ok: true, message: "Đã rollback về bản trước restore." });
    }
    RecoveryEngine.rollbackToPreRestore(backupPath);
    res.json({ ok: true, message: "Đã rollback thành công." });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Rollback thất bại: " + e.message });
  }
});


// Mở khóa restore (dọn stale lock thủ công)
function handleUnlockRestore(req, res) {
  ensureInit();
  const results = RecoveryEngine.forceUnlock();
  const removed = results.filter(r => String(r.status || '').includes('removed')).length;
  const active = results.filter(r => r.status === 'active').length;
  const message = active > 0
    ? 'Đang có tiến trình khôi phục thật sự đang chạy.'
    : removed > 0
      ? 'Đã mở khóa restore.'
      : 'Không có tiến trình restore đang khóa.';
  res.json({ ok: true, success: true, results, message });
}
router.post("/unlock", handleUnlockRestore);
router.post("/unlock-lock", handleUnlockRestore);

module.exports = router;
