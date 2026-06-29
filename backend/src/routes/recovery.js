const express = require('express');
const router = express.Router();
const RecoveryEngine = require('../services/RecoveryEngine');
const { createDbBackup } = require('../db/database');

function ensureInit() {
  if (!RecoveryEngine.getStatus().initialized) {
    RecoveryEngine.initialize({ dbModule: require('../db/database') });
  }
}

router.post('/scan-and-restore', (req, res) => {
  ensureInit();
  if (RecoveryEngine.getStatus().running) {
    return res.json({ ok: false, running: true, message: 'Recovery đang chạy nền. Vui lòng đợi.' });
  }
  res.json({ ok: true, message: 'Bắt đầu quét và khôi phục toàn bộ backup...', started: true });
  RecoveryEngine.startBackgroundRecovery({ delayMs: 500 });
});

router.get('/status', (req, res) => {
  ensureInit();
  res.json({ ok: true, ...RecoveryEngine.getStatus() });
});

router.get('/found-files', (req, res) => {
  ensureInit();
  res.json({ ok: true, files: RecoveryEngine.getStatus().foundFiles || [], total: (RecoveryEngine.getStatus().foundFiles || []).length });
});

router.get('/logs', (req, res) => {
  ensureInit();
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  res.json({ ok: true, logs: RecoveryEngine.getLogs(limit) });
});

router.get('/logs/:file', (req, res) => {
  ensureInit();
  try {
    const log = RecoveryEngine.readLog(req.params.file);
    res.json({ ok: true, log });
  } catch (e) {
    res.status(404).json({ ok: false, message: 'Không tìm thấy log.' });
  }
});

router.post('/export-report', (req, res) => {
  ensureInit();
  const report = RecoveryEngine.getStatus().lastReport;
  if (!report) return res.json({ ok: false, message: 'Chưa có báo cáo. Hãy chạy khôi phục trước.' });
  res.setHeader('Content-Disposition', 'attachment; filename="recovery-report.json"');
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(report, null, 2));
});

router.post('/rollback', (req, res) => {
  ensureInit();
  const { backupPath } = req.body || {};
  if (!backupPath) return res.status(400).json({ ok: false, message: 'Thiếu đường dẫn backup rollback.' });
  try {
    const safetyBackup = RecoveryEngine.getStatus().lastReport?.safetyBackup;
    if (backupPath === 'latest_safety' && safetyBackup) {
      const result = RecoveryEngine.rollbackToPreRestore(safetyBackup.path);
      return res.json({ ok: true, message: 'Đã rollback về bản trước restore.' });
    }
    const result = RecoveryEngine.rollbackToPreRestore(backupPath);
    res.json({ ok: true, message: 'Đã rollback thành công.' });
  } catch (e) {
    res.status(500).json({ ok: false, message: 'Rollback thất bại: ' + e.message });
  }
});

module.exports = router;
