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

    if (guardian?.realtimeBackup) {
      result.snapshots = guardian.realtimeBackup.listSnapshots(20);
    }

    res.json(result);
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

    // Trigger scheduled backup
    if (guardian?.backupScheduler) {
      const backup = guardian.backupScheduler.backupEmergency();
      results.backups.push({ tier: 'emergency', ...backup });
    }

    // Also trigger realtime snapshot
    if (guardian?.realtimeBackup) {
      const snapshot = guardian.realtimeBackup.forceSnapshot();
      if (snapshot) results.backups.push({ tier: 'realtime', ...snapshot });
    }

    // Also trigger the existing DB backup
    if (guardian?.dbModule && typeof guardian.dbModule.createDbBackup === 'function') {
      const dbBackup = guardian.dbModule.createDbBackup('manual-api');
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

    // Restore from specific backup
    if (guardian?.dbModule) {
      const fs = require('fs');
      if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ ok: false, error: 'Backup file không tồn tại' });
      }

      // Create emergency backup before restore
      if (guardian.backupScheduler) {
        guardian.backupScheduler.backupEmergency();
      }

      // Take integrity snapshot before
      let beforeSnapshot = null;
      if (guardian.integrityChecker) {
        beforeSnapshot = guardian.integrityChecker.takeSnapshot(guardian.dbModule);
      }

      // Perform restore
      guardian.dbModule.setDBPath(backupPath);
      guardian.dbModule.writeDatabaseConfig(backupPath);
      guardian.dbModule.loadDB({ forceReload: true });

      res.json({
        ok: true,
        message: `Đã khôi phục database từ: ${backupPath}`,
        path: backupPath,
      });
    } else {
      res.status(500).json({ ok: false, error: 'Database module không khả dụng' });
    }
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
