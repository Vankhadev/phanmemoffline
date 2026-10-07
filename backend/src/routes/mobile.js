const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { getDb, withAtomicDbWrite, now } = require('../db/database');
const { requireAuth, requireAnyPermission } = require('../middleware/auth');

const MOBILE_CONFIG_SETTING_KEY = 'mobile_app_config';

/**
 * Danh sách các thư mục có thể chứa file cài đặt APK
 * Hỗ trợ cả môi trường phát triển (dev repo) và Electron production (resources, userData, backend/data)
 */
function getCandidateDownloadDirs() {
  const dirs = [
    // 1. backend/downloads
    path.resolve(__dirname, '..', '..', 'downloads'),
    // 2. dataDir/downloads (userData trong Electron hoặc backend/data)
    path.resolve(process.env.DATA_DIR || path.resolve(__dirname, '..', '..', 'data'), 'downloads'),
    // 3. resources/downloads (Packaged Electron extraResources)
    process.resourcesPath ? path.join(process.resourcesPath, 'downloads') : null,
    // 4. resources/frontend/dist/downloads
    process.resourcesPath ? path.join(process.resourcesPath, 'frontend', 'dist', 'downloads') : null,
    // 5. frontend/dist/downloads (Compiled build)
    path.resolve(__dirname, '..', '..', '..', 'frontend', 'dist', 'downloads'),
    // 6. frontend/public/downloads (Dev source)
    path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'downloads'),
    // 7. Custom env path
    process.env.KHA_DOWNLOADS_DIR || null,
  ].filter(Boolean);

  return Array.from(new Set(dirs));
}

/**
 * Kiểm tra file APK có sẵn trên máy hay không
 * Ưu tiên banhangpos-mobile.apk, sau đó đến file .apk bất kỳ
 */
function checkApkFileExists() {
  const dirs = getCandidateDownloadDirs();
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      let apkFile = files.find(f => f.toLowerCase() === 'banhangpos-mobile.apk');
      if (!apkFile) {
        apkFile = files.find(f => f.toLowerCase().endsWith('.apk'));
      }
      if (apkFile) {
        const fullPath = path.join(dir, apkFile);
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && stat.size > 0) {
          return {
            available: true,
            fileName: apkFile,
            size: stat.size,
            path: `/downloads/${apkFile}`,
            fullPath,
          };
        }
      }
    } catch (_) {}
  }
  return { available: false, fileName: '', size: 0, path: '' };
}

/**
 * Quét toàn bộ card mạng để tìm các địa chỉ IPv4 không phải loopback (127.0.0.1)
 */
function getLocalNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({
          interface: name,
          ip: iface.address,
          netmask: iface.netmask,
          mac: iface.mac,
        });
      }
    }
  }

  // Sắp xếp ưu tiên địa chỉ 192.168.x.x, 10.x.x.x thông dụng của router WiFi
  addresses.sort((a, b) => {
    const isAPrivate = a.ip.startsWith('192.168.') || a.ip.startsWith('10.');
    const isBPrivate = b.ip.startsWith('192.168.') || b.ip.startsWith('10.');
    if (isAPrivate && !isBPrivate) return -1;
    if (!isAPrivate && isBPrivate) return 1;
    return 0;
  });

  return addresses;
}

function getMobileConfigFromDb() {
  try {
    const db = getDb();
    const row = (db.system_settings || []).find(
      s => s && (s.key === MOBILE_CONFIG_SETTING_KEY || s.setting_key === MOBILE_CONFIG_SETTING_KEY) && !s.deleted_at
    );
    if (row && row.value) {
      return typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    }
  } catch (err) {
    console.warn('[MOBILE] Lỗi đọc mobile_app_config:', err.message);
  }
  return {};
}

/**
 * Kiểm tra một cổng TCP có đang mở và lắng nghe hay không
 */
function isPortActive(port, host = '127.0.0.1', timeoutMs = 250) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let isConnected = false;
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      isConnected = true;
      socket.destroy();
    });
    socket.once('timeout', () => socket.destroy());
    socket.once('error', () => {});
    socket.once('close', () => resolve(isConnected));
    try {
      socket.connect(port, host);
    } catch (_) {
      resolve(false);
    }
  });
}

/**
 * GET /api/mobile/network-info
 * Cung cấp thông tin địa chỉ IP LAN, cổng, URL mở App và link tải APK
 */
router.get('/network-info', async (req, res) => {
  try {
    const addresses = getLocalNetworkAddresses();
    const primaryIp = addresses.length > 0 ? addresses[0].ip : '127.0.0.1';

    const backendPort = Number(process.env.PORT || process.env.KHA_BACKEND_PORT || 7000);
    const configuredFrontendPort = Number(process.env.VITE_FRONTEND_PORT || process.env.FRONTEND_PORT || 5174);

    // Kiểm tra xem Vite dev server có đang chạy trên cổng configuredFrontendPort không.
    // Nếu trong Electron đóng gói (production), Vite KHÔNG chạy, nên webPort chính là backendPort (7000).
    const isViteActive = await isPortActive(configuredFrontendPort, '127.0.0.1', 200);
    const webPort = isViteActive ? configuredFrontendPort : backendPort;

    const savedConfig = getMobileConfigFromDb();
    const defaultMobileUrl = `http://${primaryIp}:${webPort}`;
    const effectiveMobileUrl = savedConfig.customMobileUrl?.trim() || defaultMobileUrl;

    const apkInfo = checkApkFileExists();
    const defaultApkUrl = apkInfo.available
      ? `http://${primaryIp}:${webPort}${apkInfo.path}`
      : (savedConfig.customApkUrl?.trim() || `http://${primaryIp}:${webPort}/downloads/banhangpos-mobile.apk`);

    res.json({
      ok: true,
      primaryIp,
      addresses,
      webPort,
      frontendPort: webPort,
      backendPort,
      isDevServer: isViteActive,
      defaultMobileUrl,
      customMobileUrl: savedConfig.customMobileUrl || '',
      effectiveMobileUrl,
      customApkUrl: savedConfig.customApkUrl || '',
      apkInfo,
      apkDownloadUrl: savedConfig.customApkUrl?.trim() || defaultApkUrl,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || 'Lỗi khi lấy thông tin mạng máy chủ.',
    });
  }
});

/**
 * PUT /api/mobile/network-info
 * Lưu cấu hình URL tên miền tùy chỉnh (Domain/Cloudflare Tunnel) và link APK
 */
router.put('/network-info', requireAuth, requireAnyPermission(['settings.manage', 'settings.read']), (req, res) => {
  try {
    const { customMobileUrl, customApkUrl } = req.body || {};
    const current = getMobileConfigFromDb();

    const next = {
      ...current,
      customMobileUrl: String(customMobileUrl || '').trim(),
      customApkUrl: String(customApkUrl || '').trim(),
      updated_at: now(),
    };

    withAtomicDbWrite(() => {
      const db = getDb();
      db.system_settings = db.system_settings || [];
      const existing = db.system_settings.find(
        s => s && (s.key === MOBILE_CONFIG_SETTING_KEY || s.setting_key === MOBILE_CONFIG_SETTING_KEY) && !s.deleted_at
      );
      const jsonStr = JSON.stringify(next);

      if (existing) {
        existing.value = jsonStr;
        existing.updated_at = now();
      } else {
        const id = (db.nextId && db.nextId.system_settings) ? db.nextId.system_settings++ : db.system_settings.length + 1;
        db.system_settings.push({
          id,
          key: MOBILE_CONFIG_SETTING_KEY,
          value: jsonStr,
          value_type: 'json',
          category: 'mobile',
          description: 'Cấu hình URL kết nối ứng dụng di động và link tải APK',
          created_at: now(),
          updated_at: now(),
        });
      }
    });

    res.json({
      ok: true,
      message: 'Đã lưu cấu hình kết nối di động thành công.',
      config: next,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || 'Lỗi khi lưu cấu hình di động.',
    });
  }
});

module.exports = router;
module.exports.getCandidateDownloadDirs = getCandidateDownloadDirs;
module.exports.checkApkFileExists = checkApkFileExists;

