/**
 * KHA Data Guardian - API Routes
 * 
 * REST API endpoints cho hệ thống bảo vệ dữ liệu.
 * 
 * GET  /api/data-guardian/status       - Trạng thái tổng quan
 * GET  /api/data-guardian/backups      - Danh sách backup
 * GET  /api/data-guardian/alerts       - Lịch sử cảnh báo
 * GET  /api/data-guardian/health       - Health check chi tiết
 * POST /api/data-guardian/backup-now   - Trigger backup thủ công
 * POST /api/data-guardian/restore      - Khôi phục từ backup
 * GET  /api/data-guardian/disk-status  - Trạng thái ổ đĩa
 * GET  /api/data-guardian/journal      - Trạng thái transaction journal
 * POST /api/data-guardian/maintenance  - Trigger bảo trì thủ công
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

let guardian = null;

/**
 * Set the guardian services reference.
 * Called from server.js after all services are initialized.
 */
function setGuardianServices(services) {
  guardian = services;
}

// GET /api/data-guardian/status
router.get('/status', (_req, res) => {
  try {
    const status = {
      ok: true,
      service: 'kha-data-guardian',
      timestamp: new Date().toISOString(),
      modules: {},
    };

    if (guardian) {
      if (guardian.transactionJournal) status.modules.journal = guardian.transactionJournal.getStatus();
      if (guardian.realtimeBackup) status.modules.realtimeBackup = guardian.realtimeBackup.getStatus();
      if (guardian.backupScheduler) status.modules.backupScheduler = guardian.backupScheduler.getStatus();
      if (guardian.dbModule) {
        status.modules.backupTables = {
          system_backups: guardian.dbModule.getBackupRecords ? guardian.dbModule.getBackupRecords(5) : [],
          backup_logs: guardian.dbModule.getBackupLogs ? guardian.dbModule.getBackupLogs(5) : [],
        };
      }
      if (guardian.diskHealthMonitor) status.modules.diskHealth = guardian.diskHealthMonitor.getStatus();
      if (guardian.powerLossRecovery) status.modules.powerRecovery = guardian.powerLossRecovery.getStatus();
      if (guardian.databaseAutoRecovery) status.modules.dbRecovery = guardian.databaseAutoRecovery.getStatus();
      if (guardian.maintenanceService) status.modules.maintenance = guardian.maintenanceService.getStatus();
      if (guardian.selfHealing) status.modules.selfHealing = guardian.selfHealing.getStatus();
      if (guardian.integrityChecker) status.modules.integrity = guardian.integrityChecker.getStatus();
      if (guardian.adminAlertService) status.modules.alerts = guardian.adminAlertService.getAlertStats();
      if (guardian.safetyRules) status.modules.safety = guardian.safetyRules.getStatus();
    }

    res.json(status);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/data-guardian/backups
router.get('/backups', (_req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(_req.query.limit) || 50));
    const result = { ok: true, backups: [] };

    if (guardian?.backupScheduler) {
      result.backups = guardian.backupScheduler.listAllBackups(limit);
    }

    if (guardian?.dbModule?.getBackupRecords) {
      result.records = guardian.dbModule.getBackupRecords(limit);
    }

    if (guardian?.dbModule?.getBackupLogs) {
      result.logs = guardian.dbModule.getBackupLogs(Math.min(200, limit * 2));
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/data-guardian/download
router.get('/download', (_req, res) => {
  try {
    const filePath = String(_req.query.path || '').trim();
    if (!filePath) return res.status(400).json({ ok: false, error: 'Thiếu path backup' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'Backup file không tồn tại' });
    return res.download(filePath, path.basename(filePath));
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/data-guardian/alerts
router.get('/alerts', (_req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(_req.query.limit) || 50));
    const result = { ok: true, alerts: [], stats: null };

    if (guardian?.adminAlertService) {
      result.alerts = guardian.adminAlertService.getAlertHistory(limit);
      result.stats = guardian.adminAlertService.getAlertStats();
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/data-guardian/health
router.get('/health', (_req, res) => {
  try {
    const result = {
      ok: true,
      timestamp: new Date().toISOString(),
      selfHealing: null,
      integrity: null,
      diskHealth: null,
      systemResources: {
        heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        uptimeHours: (process.uptime() / 3600).toFixed(1),
      },
    };

    if (guardian?.selfHealing) {
      result.selfHealing = guardian.selfHealing.getStatus();
    }
    if (guardian?.integrityChecker && guardian?.dbModule) {
      result.integrity = guardian.integrityChecker.quickHealthCheck(guardian.dbModule);
    }
    if (guardian?.diskHealthMonitor) {
      result.diskHealth = guardian.diskHealthMonitor.getStatus();
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/data-guardian/backup-now
router.post('/backup-now', (_req, res) => {
  try {
    const results = { ok: true, backups: [] };

    if (guardian?.backupScheduler) {
      const backup = guardian.backupScheduler.backupNow('manual-api');
      results.backups.push({ tier: 'scheduled', ...backup });
    }

    if (guardian?.dbModule && typeof guardian.dbModule.createDbBackup === 'function') {
      const dbBackup = guardian.dbModule.createDbBackup('manual-api', { retentionCount: 30 });
      if (dbBackup) results.backups.push({ tier: 'database', ...dbBackup });
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/data-guardian/restore
router.post('/restore', (req, res) => {
  try {
    const { path: backupPath, tier } = req.body || {};

    // If no specific path, use auto recovery
    if (!backupPath) {
      if (guardian?.databaseAutoRecovery && guardian?.dbModule) {
        const result = guardian.databaseAutoRecovery.runStartupCheck(guardian.dbModule);
        return res.json(result);
      }
      return res.status(400).json({ ok: false, error: 'Thiếu path backup hoặc database module' });
    }

    if (!guardian?.dbModule) {
      return res.status(500).json({ ok: false, error: 'Database module không khả dụng' });
    }

    const fs = require('fs');
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ ok: false, error: 'Backup file không tồn tại' });
    }

    if (guardian.backupScheduler) guardian.backupScheduler.backupEmergency();

    let result = null;
    if (guardian.backupScheduler?.restoreBackup) {
      result = guardian.backupScheduler.restoreBackup(backupPath);
    } else {
      const { readBackupData } = require('../utils/backupCodec');
      const data = readBackupData(backupPath);
      const db = guardian.dbModule.getDb();
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) db[key] = data[key];
      }
      if (data.nextId) db.nextId = { ...(db.nextId || {}), ...data.nextId };
      guardian.dbModule.saveDB();
      result = { ok: true };
    }

    res.json({ ok: true, message: `Đã khôi phục database từ: ${backupPath}`, path: backupPath, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/data-guardian/disk-status
router.get('/disk-status', (_req, res) => {
  try {
    if (guardian?.diskHealthMonitor) {
      const health = guardian.diskHealthMonitor.performHealthCheck();
      res.json({ ok: true, ...health });
    } else {
      res.json({ ok: false, message: 'Disk health monitor chưa khởi tạo' });
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/data-guardian/journal
router.get('/journal', (_req, res) => {
  try {
    if (guardian?.transactionJournal) {
      res.json({ ok: true, ...guardian.transactionJournal.getStatus() });
    } else {
      res.json({ ok: false, message: 'Transaction journal chưa khởi tạo' });
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/data-guardian/maintenance
router.post('/maintenance', async (_req, res) => {
  try {
    if (guardian?.maintenanceService) {
      const result = await guardian.maintenanceService.runMaintenance();
      res.json({ ok: true, ...result });
    } else {
      res.json({ ok: false, message: 'Maintenance service chưa khởi tạo' });
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/data-guardian/safety
router.get('/safety', (_req, res) => {
  try {
    if (guardian?.safetyRules) {
      res.json({ ok: true, ...guardian.safetyRules.getStatus() });
    } else {
      res.json({ ok: false, message: 'Safety rules chưa khởi tạo' });
    }
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

module.exports = router;
module.exports.setGuardianServices = setGuardianServices;
