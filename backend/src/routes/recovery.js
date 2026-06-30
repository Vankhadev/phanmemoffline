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
    res.json({ ok: false, message: "Loi quet backup: " + (error && error.message) });
  }
});

// BUOC 2: Khoi phuc backup (import tu danh sach file da quet)
router.post("/restore-files", async (req, res) => {
  ensureInit();
  try {
    const { files, batchSize, deepScan } = req.body || {};
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.json({ ok: false, message: "Vui long chon it nhat 1 file backup de khoi phuc." });
    }
    const result = await RecoveryEngine.restoreBackups({ files, batchSize, deepScan });
    res.json(result);
  } catch (error) {
    res.json({ ok: false, message: "Loi khoi phuc: " + (error && error.message) });
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
    res.json({ ok: false, message: "Loi quet sau: " + (error && error.message) });
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
    res.json({ ok: false, message: "Loi kiem tra: " + (error && error.message) });
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
    res.status(404).json({ ok: false, message: "Khong tim thay log." });
  }
});

// Xuat bao cao
router.post("/export-report", (req, res) => {
  ensureInit();
  const report = RecoveryEngine.getStatus().lastReport;
  if (!report) return res.json({ ok: false, message: "Chua co bao cao. Hay chay khoi phuc truoc." });
  res.setHeader("Content-Disposition", "attachment; filename=\"recovery-report.json\"");
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(report, null, 2));
});

// Rollback ve ban truoc restore
router.post("/rollback", (req, res) => {
  ensureInit();
  const { backupPath } = req.body || {};
  if (!backupPath) return res.status(400).json({ ok: false, message: "Thieu duong dan backup rollback." });
  try {
    const safetyBackup = RecoveryEngine.getStatus().lastReport?.safetyBackup;
    if (backupPath === "latest_safety" && safetyBackup) {
      RecoveryEngine.rollbackToPreRestore(safetyBackup.path);
      return res.json({ ok: true, message: "Da rollback ve ban truoc restore." });
    }
    RecoveryEngine.rollbackToPreRestore(backupPath);
    res.json({ ok: true, message: "Da rollback thanh cong." });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Rollback that bai: " + e.message });
  }
});


// M? kh?a restore (d?n stale lock th? c?ng)
router.post("/unlock", (req, res) => {
  ensureInit();
  const results = RecoveryEngine.forceUnlock();
  res.json({ ok: true, results, message: "?? ki?m tra v? d?n kh?a restore." });
});

module.exports = router;
