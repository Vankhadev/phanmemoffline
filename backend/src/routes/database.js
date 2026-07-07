const express = require("express");
const router = express.Router();
const RecoveryEngine = require("../services/RecoveryEngine");
const dbModule = require("../db/database");

function ensureRecovery() {
  if (!RecoveryEngine.getStatus().initialized) RecoveryEngine.initialize({ dbModule });
}

function sendOk(res, payload = {}) {
  return res.json({ success: true, ok: true, ...payload });
}

function sendError(res, error, code = 'DATABASE_ERROR', status = 500) {
  return res.status(status).json({
    success: false,
    ok: false,
    code,
    message: error && error.message ? error.message : 'Thao tác cơ sở dữ liệu thất bại.',
    details: error && error.stack ? { stack: error.stack } : undefined,
  });
}

router.get('/status', (_req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const dbPath = dbModule.DB_PATH;
    const stat = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null;
    return sendOk(res, {
      database_type: 'json-file-with-optional-sqlite-write-through',
      framework: 'nodejs-express',
      database_path: dbPath,
      database_file: path.basename(dbPath || ''),
      exists: Boolean(stat),
      size: stat ? stat.size : 0,
      counts: dbModule.getBusinessRecordCounts(),
      migration_report: dbModule.buildMigrationReport(),
    });
  } catch (error) {
    return sendError(res, error, 'DB_STATUS_FAILED');
  }
});

router.post('/backup', (_req, res) => {
  try {
    const backup = dbModule.createMandatoryPreMigrationBackup('manual-api-backup');
    dbModule.auditLog('BACKUP', { backup_path: backup.path, reason: 'manual-api-backup' });
    return sendOk(res, { backup });
  } catch (error) {
    return sendError(res, error, 'DB_BACKUP_FAILED');
  }
});

router.post('/migrate', (_req, res) => {
  try {
    const result = dbModule.runRelationalCompatibilityMigration({ force: true });
    return sendOk(res, { result, report: dbModule.buildMigrationReport() });
  } catch (error) {
    return sendError(res, error, 'DB_MIGRATION_FAILED');
  }
});

router.get('/migration-report', (_req, res) => {
  try {
    return sendOk(res, { report: dbModule.buildMigrationReport() });
  } catch (error) {
    return sendError(res, error, 'DB_MIGRATION_REPORT_FAILED');
  }
});

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
