const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  console.error(`[mobile-build] ${message}`);
  process.exit(1);
}

const apiBase = String(process.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

if (!apiBase) {
  fail('Set VITE_API_BASE_URL to the public HTTPS backend, for example https://api.example.com/api.');
}

let parsedApiBase;
try {
  parsedApiBase = new URL(apiBase);
} catch (_) {
  fail('VITE_API_BASE_URL must be an absolute URL.');
}

if (parsedApiBase.protocol !== 'https:' && process.env.ALLOW_HTTP_MOBILE_API !== '1') {
  fail('VITE_API_BASE_URL must use HTTPS. Set ALLOW_HTTP_MOBILE_API=1 only for temporary LAN testing.');
}

if (!/\/api$/i.test(parsedApiBase.pathname.replace(/\/+$/, ''))) {
  fail('VITE_API_BASE_URL must end with /api.');
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const publicDownloadsDir = path.resolve(process.cwd(), 'frontend', 'public', 'downloads');
const tempDownloadsDir = path.resolve(process.cwd(), '.tmp', 'mobile-public-downloads');
const mobileUpdateManifestPath = path.resolve(process.cwd(), 'frontend', 'public', 'mobile-update.json');

function readAndroidBuildVersion() {
  const buildGradlePath = path.resolve(process.cwd(), 'android', 'app', 'build.gradle');
  try {
    const text = fs.readFileSync(buildGradlePath, 'utf8');
    const versionName = text.match(/versionName\s+["']([^"']+)["']/)?.[1] || '';
    const versionCode = text.match(/versionCode\s+(\d+)/)?.[1] || '';
    return { versionName, versionCode };
  } catch (_) {
    return { versionName: '', versionCode: '' };
  }
}

function readJsonFile(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeMobileUpdateManifest({ version, versionCode, lanOrigin }) {
  const existing = readJsonFile(mobileUpdateManifestPath, {});
  const cacheKey = String(process.env.VITE_MOBILE_APK_CACHE_KEY || version.replace(/[^\d]+/g, '') || versionCode || Date.now()).trim();
  const manifest = {
    ...existing,
    platform: existing.platform || 'android',
    channel: existing.channel || 'stable',
    version,
    versionCode: Number(versionCode) || 0,
    title: `${mobileAppDisplayName} ${version}`,
    notes: existing.notes || 'Ban cap nhat Android moi cho ung dung Phan mem POS Offline.',
    apkUrl: `/downloads/phan-mem-pos-offline.apk?v=${cacheKey}`,
    downloadPageUrl: existing.downloadPageUrl || '/download.html',
    lanOrigin,
  };

  fs.mkdirSync(path.dirname(mobileUpdateManifestPath), { recursive: true });
  fs.writeFileSync(mobileUpdateManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

const androidBuildVersion = readAndroidBuildVersion();
const mobileAppDisplayName = String(process.env.VITE_MOBILE_APP_DISPLAY_NAME || 'Phần mềm POS Offline').trim();
const mobileAppVersion = String(process.env.VITE_MOBILE_APP_VERSION || androidBuildVersion.versionName || '2.0.2').trim();
const mobileAppVersionCode = String(process.env.VITE_MOBILE_APP_VERSION_CODE || androidBuildVersion.versionCode || '3').trim();
const mobileLanOrigin = String(process.env.VITE_MOBILE_LAN_ORIGIN || parsedApiBase.origin || '').trim().replace(/\/+$/, '');
writeMobileUpdateManifest({
  version: mobileAppVersion,
  versionCode: mobileAppVersionCode,
  lanOrigin: mobileLanOrigin,
});

function temporarilyMoveDownloadApks() {
  if (!fs.existsSync(publicDownloadsDir)) return [];
  fs.mkdirSync(tempDownloadsDir, { recursive: true });

  return fs.readdirSync(publicDownloadsDir)
    .filter(fileName => fileName.toLowerCase().endsWith('.apk'))
    .map(fileName => {
      const source = path.join(publicDownloadsDir, fileName);
      const target = path.join(tempDownloadsDir, `${Date.now()}-${fileName}`);
      fs.renameSync(source, target);
      return { source, target };
    });
}

function restoreMovedFiles(files = []) {
  for (const item of files) {
    if (!item?.source || !item?.target || !fs.existsSync(item.target)) continue;
    fs.mkdirSync(path.dirname(item.source), { recursive: true });
    fs.renameSync(item.target, item.source);
  }
}

const movedDownloadApks = temporarilyMoveDownloadApks();
let result;

try {
  result = spawnSync(npmCommand, ['--prefix', 'frontend', 'run', 'build'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITE_API_BASE_URL: apiBase,
      VITE_MOBILE_APP_DISPLAY_NAME: mobileAppDisplayName,
      VITE_MOBILE_APP_VERSION: mobileAppVersion,
      VITE_MOBILE_APP_VERSION_CODE: mobileAppVersionCode,
      VITE_MOBILE_LAN_ORIGIN: mobileLanOrigin,
    },
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
} finally {
  restoreMovedFiles(movedDownloadApks);
}

if (result.error) fail(result.error.message);
process.exit(result.status ?? 1);
