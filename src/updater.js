const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { fileURLToPath } = require('url');

const CHANNELS = Object.freeze({
  appInfo: 'kha:app:get-info',
  getState: 'kha:update:get-state',
  check: 'kha:update:check',
  download: 'kha:update:download',
  cancel: 'kha:update:cancel',
  install: 'kha:update:install',
  status: 'kha:update:status',
});

const CONFIG_FILE_NAMES = Object.freeze(['update-config.json', 'kha-update-config.json']);
const MANIFEST_ENV_KEYS = Object.freeze(['KHA_UPDATE_MANIFEST_URL', 'KHA_UPDATE_FEED_URL']);
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MANIFEST_TIMEOUT_MS = 15000;
const DB_FILE_NAME = 'phanmienoffline.db.json';
const DEFAULT_GITHUB_OWNER = 'Vankhadev';
const DEFAULT_GITHUB_REPO = 'phanmemoffline';
const DEFAULT_GITHUB_MANIFEST_URL = `https://github.com/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/releases/latest/download/update-manifest.json`;
const SENSITIVE_LOG_KEY_PATTERN = /(token|secret|password|authorization|cookie|api[-_]?key)/i;

function createPublicError(code, message, details) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

function success(payload = {}) {
  return { ok: true, ...payload };
}

function failure(error, state) {
  return {
    ok: false,
    error: {
      code: error?.code || 'UNKNOWN_ERROR',
      message: error?.message || 'Đã xảy ra lỗi không xác định.',
      ...(error?.details !== undefined ? { details: error.details } : {}),
    },
    ...(state ? { state } : {}),
  };
}

function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v/i, '');
}

function parseSemVer(version) {
  const normalized = normalizeVersion(version);
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(normalized);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
    build: match[5] || '',
    raw: normalized,
  };
}

function compareIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);

  if (leftNumeric && rightNumeric) {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (leftNumber !== rightNumber) return leftNumber > rightNumber ? 1 : -1;
    return 0;
  }

  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  if (left !== right) return left > right ? 1 : -1;
  return 0;
}

function comparePrerelease(left = '', right = '') {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  const leftParts = left.split('.');
  const rightParts = right.split('.');
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    if (leftParts[index] === undefined) return -1;
    if (rightParts[index] === undefined) return 1;
    const compared = compareIdentifiers(leftParts[index], rightParts[index]);
    if (compared !== 0) return compared;
  }

  return 0;
}

function compareVersions(leftVersion, rightVersion) {
  const left = parseSemVer(leftVersion);
  const right = parseSemVer(rightVersion);
  if (!left || !right) {
    throw createPublicError('INVALID_VERSION', `Phiên bản không hợp lệ: ${!left ? leftVersion : rightVersion}`);
  }

  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

function isSupportedUrl(value, { allowLocalPath = false } = {}) {
  if (!value || typeof value !== 'string') return false;
  if (allowLocalPath && path.isAbsolute(value)) return true;
  try {
    const parsed = new URL(value);
    return ['https:', 'http:', 'file:'].includes(parsed.protocol);
  } catch (_) {
    return false;
  }
}

function sanitizeFileName(value) {
  return String(value || 'update')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'update';
}

function formatTimestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
}

let packageConfigCache = null;

function getPackageConfig() {
  if (packageConfigCache) return packageConfigCache;
  try {
    packageConfigCache = require(path.join(__dirname, '..', 'package.json'));
  } catch (_) {
    packageConfigCache = {};
  }
  return packageConfigCache;
}

function cleanRepoPart(value, fallback) {
  const cleaned = String(value || fallback || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  return cleaned || fallback;
}

function buildGitHubLatestManifestUrl(owner = DEFAULT_GITHUB_OWNER, repo = DEFAULT_GITHUB_REPO) {
  return `https://github.com/${cleanRepoPart(owner, DEFAULT_GITHUB_OWNER)}/${cleanRepoPart(repo, DEFAULT_GITHUB_REPO)}/releases/latest/download/update-manifest.json`;
}

function resolveDefaultManifestUrl() {
  const packageConfig = getPackageConfig();
  const updateConfig = packageConfig.khaUpdate && typeof packageConfig.khaUpdate === 'object'
    ? packageConfig.khaUpdate
    : {};
  const packageManifestUrl = String(updateConfig.manifestUrl || '').trim();

  if (packageManifestUrl && isSupportedUrl(packageManifestUrl)) {
    return {
      manifestUrl: packageManifestUrl,
      source: 'default:package.khaUpdate.manifestUrl',
      configured: false,
      isDefault: true,
    };
  }

  return {
    manifestUrl: buildGitHubLatestManifestUrl(updateConfig.owner, updateConfig.repo),
    source: 'default:github-release',
    configured: false,
    isDefault: true,
  };
}

function safeParseUrl(value) {
  if (typeof value === 'string' && path.isAbsolute(value)) return null;
  try {
    return new URL(value);
  } catch (_) {
    return null;
  }
}

function sanitizeUrlForLog(value) {
  try {
    const parsed = new URL(value);
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_LOG_KEY_PATTERN.test(key)) parsed.searchParams.set(key, '[redacted]');
    }
    return parsed.toString();
  } catch (_) {
    return value;
  }
}

function sanitizeForLog(value, key = '') {
  if (SENSITIVE_LOG_KEY_PATTERN.test(String(key))) return '[redacted]';
  if (value instanceof Error) {
    return {
      name: value.name,
      code: value.code,
      message: value.message,
      details: sanitizeForLog(value.details, 'details'),
    };
  }
  if (typeof value === 'string') {
    const sanitized = sanitizeUrlForLog(value);
    return sanitized.length > 2000 ? `${sanitized.slice(0, 2000)}…[truncated]` : sanitized;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeForLog(item));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      output[childKey] = sanitizeForLog(childValue, childKey);
    }
    return output;
  }
  return value;
}

function createUpdateLogger(app) {
  const logDir = path.join(app.getPath('userData'), 'logs');
  const logPath = path.join(logDir, 'update.log');

  async function write(level, message, details) {
    try {
      await fsp.mkdir(logDir, { recursive: true });
      const entry = {
        at: new Date().toISOString(),
        level,
        message,
        ...(details !== undefined ? { details: sanitizeForLog(details) } : {}),
      };
      await fsp.appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (_) {
      // Logging must never break the update flow.
    }
  }

  return {
    logPath,
    debug: (message, details) => write('debug', message, details),
    info: (message, details) => write('info', message, details),
    warn: (message, details) => write('warn', message, details),
    error: (message, details) => write('error', message, details),
  };
}

function getConfigSearchPaths(app) {
  const userData = app.getPath('userData');
  const candidates = [];

  for (const fileName of CONFIG_FILE_NAMES) {
    candidates.push(path.join(userData, fileName));
  }

  if (process.resourcesPath) {
    for (const fileName of CONFIG_FILE_NAMES) {
      candidates.push(path.join(process.resourcesPath, fileName));
    }
  }

  if (!app.isPackaged) {
    for (const fileName of CONFIG_FILE_NAMES) {
      candidates.push(path.join(process.cwd(), fileName));
    }
  }

  return candidates;
}

async function readManifestUrlFromConfigFile(filePath) {
  if (!(await pathExists(filePath))) return '';
  const raw = await fsp.readFile(filePath, 'utf8');
  const config = JSON.parse(raw);
  return String(config.manifestUrl || config.updateManifestUrl || config.updateFeedUrl || '').trim();
}

async function resolveManifestUrl(app) {
  for (const envKey of MANIFEST_ENV_KEYS) {
    const envValue = String(process.env[envKey] || '').trim();
    if (envValue) {
      return { manifestUrl: envValue, source: `env:${envKey}`, configured: true, isDefault: false };
    }
  }

  for (const filePath of getConfigSearchPaths(app)) {
    try {
      const manifestUrl = await readManifestUrlFromConfigFile(filePath);
      if (manifestUrl) {
        return { manifestUrl, source: filePath, configured: true, isDefault: false };
      }
    } catch (err) {
      throw createPublicError('CONFIG_INVALID', `File cấu hình cập nhật không hợp lệ: ${filePath}`, err.message);
    }
  }

  return resolveDefaultManifestUrl();
}

function withTimeout(ms, timeoutMessage) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(createPublicError('TIMEOUT', timeoutMessage)), ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

async function readLocalText(urlOrPath) {
  let filePath = urlOrPath;
  const parsed = safeParseUrl(urlOrPath);
  if (parsed?.protocol === 'file:') filePath = fileURLToPath(parsed);

  if (!path.isAbsolute(filePath)) {
    throw createPublicError('URL_INVALID', 'Manifest local phải là đường dẫn tuyệt đối hoặc file URL.');
  }

  return fsp.readFile(filePath, 'utf8');
}

async function readRemoteText(urlString, timeoutMs = DEFAULT_MANIFEST_TIMEOUT_MS) {
  const timeout = withTimeout(timeoutMs, 'Quá thời gian tải manifest cập nhật.');
  try {
    const response = await fetch(urlString, {
      signal: timeout.signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      throw createPublicError('MANIFEST_HTTP_ERROR', `Không tải được manifest cập nhật (HTTP ${response.status}).`);
    }

    return await response.text();
  } catch (err) {
    if (err?.code) throw err;
    if (err?.name === 'AbortError') {
      throw createPublicError('NETWORK_TIMEOUT', 'Quá thời gian kết nối tới manifest cập nhật.');
    }
    throw createPublicError('NETWORK_ERROR', 'Không thể kết nối tới manifest cập nhật. Vui lòng kiểm tra mạng hoặc URL cấu hình.', err.message);
  } finally {
    timeout.cancel();
  }
}

async function readManifest(manifestUrl) {
  if (!isSupportedUrl(manifestUrl, { allowLocalPath: true })) {
    throw createPublicError('URL_INVALID', 'URL manifest cập nhật không hợp lệ. Chỉ hỗ trợ https, http, file URL hoặc đường dẫn local tuyệt đối.');
  }

  let raw;
  const parsed = safeParseUrl(manifestUrl);

  if (!parsed || parsed.protocol === 'file:') {
    raw = await readLocalText(manifestUrl);
  } else {
    raw = await readRemoteText(manifestUrl);
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw createPublicError('MANIFEST_INVALID_JSON', 'Manifest cập nhật không phải JSON hợp lệ.', err.message);
  }
}

function normalizeReleaseNotes(releaseNotes) {
  if (Array.isArray(releaseNotes)) return releaseNotes.map(item => String(item)).join('\n');
  return String(releaseNotes || '').trim();
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw createPublicError('MANIFEST_INVALID', 'Manifest cập nhật phải là một JSON object.');
  }

  const version = normalizeVersion(manifest.version);
  if (!parseSemVer(version)) {
    throw createPublicError('MANIFEST_INVALID_VERSION', 'Manifest thiếu version SemVer hợp lệ.');
  }

  const url = String(manifest.url || '').trim();
  if (!isSupportedUrl(url, { allowLocalPath: true })) {
    throw createPublicError('MANIFEST_INVALID_URL', 'Manifest thiếu URL installer hợp lệ.');
  }

  const sha256 = String(manifest.sha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw createPublicError('MANIFEST_INVALID_SHA256', 'Manifest thiếu SHA256 hợp lệ cho installer.');
  }

  const releaseDate = String(manifest.releaseDate || '').trim();
  if (!releaseDate) {
    throw createPublicError('MANIFEST_INVALID_RELEASE_DATE', 'Manifest thiếu releaseDate.');
  }

  return {
    version,
    url,
    sha256,
    releaseNotes: normalizeReleaseNotes(manifest.releaseNotes),
    releaseDate,
    platform: manifest.platform ? String(manifest.platform).trim() : '',
    arch: manifest.arch ? String(manifest.arch).trim() : '',
    size: Number.isFinite(Number(manifest.size)) ? Number(manifest.size) : 0,
    mandatory: Boolean(manifest.mandatory),
    installerType: String(manifest.installerType || 'nsis').trim().toLowerCase(),
  };
}

function isManifestForCurrentRuntime(updateInfo) {
  const platformOk = !updateInfo.platform || updateInfo.platform === process.platform;
  const archOk = !updateInfo.arch || updateInfo.arch === process.arch;
  return platformOk && archOk;
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function unlinkQuietly(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch (_) {
    // Ignore cleanup errors.
  }
}

async function pipeLocalFileWithProgress(sourcePath, destinationPath, onProgress, cancelToken) {
  const stat = await fsp.stat(sourcePath);
  const total = stat.size;
  let transferred = 0;

  await new Promise((resolve, reject) => {
    const reader = fs.createReadStream(sourcePath);
    const writer = fs.createWriteStream(destinationPath, { flags: 'w' });

    cancelToken.cancel = () => {
      cancelToken.cancelled = true;
      reader.destroy(createPublicError('DOWNLOAD_CANCELLED', 'Người dùng đã hủy tải cập nhật.'));
      writer.destroy();
    };

    reader.on('data', chunk => {
      transferred += chunk.length;
      onProgress({ transferred, total, percent: total ? Math.round((transferred / total) * 100) : 0 });
    });
    reader.on('error', reject);
    writer.on('error', reject);
    writer.on('finish', resolve);
    reader.pipe(writer);
  });

  return { transferred, total };
}

async function downloadRemoteFile(urlString, destinationPath, onProgress, cancelToken, timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(createPublicError('NETWORK_TIMEOUT', 'Quá thời gian tải installer cập nhật.')), timeoutMs);
  cancelToken.cancel = () => {
    cancelToken.cancelled = true;
    controller.abort(createPublicError('DOWNLOAD_CANCELLED', 'Người dùng đã hủy tải cập nhật.'));
  };

  let writer;
  try {
    const response = await fetch(urlString, {
      signal: controller.signal,
      headers: {
        Accept: 'application/octet-stream',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      throw createPublicError('DOWNLOAD_HTTP_ERROR', `Không tải được installer cập nhật (HTTP ${response.status}).`);
    }

    const total = Number(response.headers.get('content-length')) || 0;
    let transferred = 0;
    writer = fs.createWriteStream(destinationPath, { flags: 'w' });

    if (!response.body) {
      throw createPublicError('DOWNLOAD_FAILED', 'Phản hồi tải installer không có dữ liệu.');
    }

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (cancelToken.cancelled) throw createPublicError('DOWNLOAD_CANCELLED', 'Người dùng đã hủy tải cập nhật.');
      const chunk = Buffer.from(value);
      transferred += chunk.length;
      if (!writer.write(chunk)) {
        await new Promise(resolve => writer.once('drain', resolve));
      }
      onProgress({ transferred, total, percent: total ? Math.round((transferred / total) * 100) : 0 });
    }

    await new Promise((resolve, reject) => {
      writer.end(err => (err ? reject(err) : resolve()));
    });

    return { transferred, total };
  } catch (err) {
    if (err?.code) throw err;
    if (err?.name === 'AbortError') {
      throw cancelToken.cancelled
        ? createPublicError('DOWNLOAD_CANCELLED', 'Người dùng đã hủy tải cập nhật.')
        : createPublicError('NETWORK_TIMEOUT', 'Quá thời gian tải installer cập nhật.');
    }
    throw createPublicError('DOWNLOAD_FAILED', 'Tải installer cập nhật thất bại.', err.message);
  } finally {
    clearTimeout(timer);
    if (writer && !writer.closed) writer.destroy();
  }
}

function getLocalFilePath(urlOrPath) {
  if (typeof urlOrPath === 'string' && path.isAbsolute(urlOrPath)) return urlOrPath;
  const parsed = safeParseUrl(urlOrPath);
  if (parsed?.protocol === 'file:') return fileURLToPath(parsed);
  return '';
}

async function copyOrDownloadInstaller(updateInfo, destinationPath, onProgress, cancelToken) {
  const localPath = getLocalFilePath(updateInfo.url);
  if (localPath) {
    return pipeLocalFileWithProgress(localPath, destinationPath, onProgress, cancelToken);
  }
  return downloadRemoteFile(updateInfo.url, destinationPath, onProgress, cancelToken);
}

async function backupDatabase(app, targetVersion) {
  const userData = app.getPath('userData');
  const dbPath = path.join(userData, DB_FILE_NAME);
  if (!(await pathExists(dbPath))) return { dbPath, backupPath: '', skipped: true };

  const backupDir = path.join(userData, 'backups');
  await fsp.mkdir(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `${DB_FILE_NAME}.backup.${formatTimestampForFile()}.pre-update-${sanitizeFileName(targetVersion)}.json`,
  );
  await fsp.copyFile(dbPath, backupPath);
  return { dbPath, backupPath, skipped: false };
}

function createUpdateManager({ app, getMainWindow }) {
  let currentDownload = null;
  let startupCheckScheduled = false;
  const logger = createUpdateLogger(app);
  const initialDefaultManifest = resolveDefaultManifestUrl();

  void logger.info('Update manager initialized', {
    currentVersion: app.getVersion(),
    defaultManifestUrl: initialDefaultManifest.manifestUrl,
    logPath: logger.logPath,
  });

  const state = {
    currentVersion: app.getVersion(),
    manifestUrl: '',
    manifestSource: '',
    manifestUrlConfigured: false,
    manifestUrlDefault: false,
    defaultManifestUrl: initialDefaultManifest.manifestUrl,
    updateLogPath: logger.logPath,
    status: 'idle',
    updateAvailable: false,
    updateInfo: null,
    progress: null,
    downloadedFile: '',
    downloadedSha256: '',
    backupPath: '',
    lastCheckedAt: '',
    lastError: null,
  };

  function getPublicState() {
    return {
      currentVersion: state.currentVersion,
      manifestUrl: state.manifestUrl,
      manifestSource: state.manifestSource,
      manifestUrlConfigured: state.manifestUrlConfigured,
      manifestUrlDefault: state.manifestUrlDefault,
      defaultManifestUrl: state.defaultManifestUrl,
      updateLogPath: state.updateLogPath,
      status: state.status,
      updateAvailable: state.updateAvailable,
      updateInfo: state.updateInfo,
      progress: state.progress,
      downloadedFile: state.downloadedFile,
      downloadedSha256: state.downloadedSha256,
      backupPath: state.backupPath,
      lastCheckedAt: state.lastCheckedAt,
      lastError: state.lastError,
    };
  }

  function emit(type, payload = {}, { silent = false } = {}) {
    const publicPayload = {
      type,
      state: getPublicState(),
      ...payload,
      at: new Date().toISOString(),
    };

    const shouldNotifyRenderer = !silent || type === 'update-available' || type === 'downloaded';
    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (shouldNotifyRenderer && win && !win.isDestroyed() && win.webContents) {
      win.webContents.send(CHANNELS.status, publicPayload);
    }

    return publicPayload;
  }

  async function refreshConfig() {
    const resolved = await resolveManifestUrl(app);
    const defaultManifest = resolveDefaultManifestUrl();
    state.manifestUrl = resolved.manifestUrl;
    state.manifestSource = resolved.source;
    state.manifestUrlConfigured = Boolean(resolved.configured);
    state.manifestUrlDefault = Boolean(resolved.isDefault);
    state.defaultManifestUrl = defaultManifest.manifestUrl;
    state.updateLogPath = logger.logPath;
    await logger.debug('Resolved update manifest source', {
      manifestUrl: state.manifestUrl,
      source: state.manifestSource,
      configured: state.manifestUrlConfigured,
      isDefault: state.manifestUrlDefault,
    });
    return resolved;
  }

  async function getState() {
    try {
      await refreshConfig();
    } catch (err) {
      state.lastError = { code: err.code || 'CONFIG_INVALID', message: err.message };
      await logger.warn('Cannot refresh update config for renderer state', err);
    }
    return success({ state: getPublicState() });
  }

  function getAppInfo() {
    return success({
      app: {
        name: app.getName(),
        version: app.getVersion(),
        isPackaged: app.isPackaged,
        platform: process.platform,
        arch: process.arch,
      },
      state: getPublicState(),
    });
  }

  async function checkForUpdates(options = {}) {
    const silent = Boolean(options.silent);
    const checkSource = String(options.source || (silent ? 'silent' : 'manual'));
    try {
      state.status = 'checking';
      state.progress = null;
      state.lastError = null;
      await logger.info('Checking for updates', {
        currentVersion: state.currentVersion,
        source: checkSource,
        silent,
      });
      await refreshConfig();
      await logger.info('Using update manifest', {
        manifestUrl: state.manifestUrl,
        manifestSource: state.manifestSource,
        manifestUrlConfigured: state.manifestUrlConfigured,
        manifestUrlDefault: state.manifestUrlDefault,
      });
      emit('checking', { message: 'Đang kiểm tra bản cập nhật...' }, { silent });

      if (!state.manifestUrl) {
        throw createPublicError('MANIFEST_URL_MISSING', 'Chưa cấu hình URL manifest cập nhật.');
      }

      await logger.debug('Fetching update manifest', { manifestUrl: state.manifestUrl });
      const manifest = await readManifest(state.manifestUrl);
      await logger.debug('Update manifest fetched', {
        version: manifest?.version,
        url: manifest?.url,
        platform: manifest?.platform,
        arch: manifest?.arch,
        size: manifest?.size,
      });
      const updateInfo = validateManifest(manifest);
      await logger.info('Update manifest validated', {
        version: updateInfo.version,
        url: updateInfo.url,
        sha256: updateInfo.sha256,
        platform: updateInfo.platform,
        arch: updateInfo.arch,
        size: updateInfo.size,
        installerType: updateInfo.installerType,
      });
      state.lastCheckedAt = new Date().toISOString();

      if (!isManifestForCurrentRuntime(updateInfo)) {
        await logger.info('Update manifest ignored because platform or arch does not match current runtime', {
          manifestPlatform: updateInfo.platform,
          manifestArch: updateInfo.arch,
          currentPlatform: process.platform,
          currentArch: process.arch,
        });
        state.status = 'no-update';
        state.updateAvailable = false;
        state.updateInfo = null;
        state.downloadedFile = '';
        state.downloadedSha256 = '';
        return success({
          updateAvailable: false,
          reason: 'platform-or-arch-mismatch',
          updateInfo,
          state: getPublicState(),
          event: emit('no-update', { message: 'Manifest không dành cho nền tảng/kiến trúc hiện tại.', updateInfo }, { silent }),
        });
      }

      const compared = compareVersions(updateInfo.version, state.currentVersion);
      if (compared <= 0) {
        await logger.info('No update available after version comparison', {
          manifestVersion: updateInfo.version,
          currentVersion: state.currentVersion,
          compared,
        });
        state.status = 'no-update';
        state.updateAvailable = false;
        state.updateInfo = updateInfo;
        state.downloadedFile = '';
        state.downloadedSha256 = '';
        return success({
          updateAvailable: false,
          updateInfo,
          state: getPublicState(),
          event: emit('no-update', { message: 'Ứng dụng đang ở phiên bản mới nhất.', updateInfo }, { silent }),
        });
      }

      await logger.info('Update available', {
        manifestVersion: updateInfo.version,
        currentVersion: state.currentVersion,
        url: updateInfo.url,
      });
      state.status = 'update-available';
      state.updateAvailable = true;
      state.updateInfo = updateInfo;
      state.downloadedFile = '';
      state.downloadedSha256 = '';

      return success({
        updateAvailable: true,
        updateInfo,
        state: getPublicState(),
        event: emit('update-available', { message: `Có bản cập nhật ${updateInfo.version}.`, updateInfo }, { silent }),
      });
    } catch (err) {
      state.status = 'error';
      state.lastError = { code: err.code || 'CHECK_FAILED', message: err.message, details: err.details };
      await logger.error('Update check failed', err);
      if (!silent) emit('error', { error: state.lastError }, { silent: false });
      return failure(err, getPublicState());
    }
  }

  async function downloadUpdate() {
    if (currentDownload) {
      await logger.warn('Download request ignored because another download is already running');
      return failure(createPublicError('DOWNLOAD_IN_PROGRESS', 'Một lượt tải cập nhật đang chạy.'), getPublicState());
    }

    let tempPath = '';

    try {
      if (!state.updateInfo || !state.updateAvailable) {
        const checked = await checkForUpdates({ silent: false });
        if (!checked.ok) return checked;
        if (!checked.updateAvailable) {
          return failure(createPublicError('UPDATE_NOT_AVAILABLE', 'Không có bản cập nhật mới để tải.'), getPublicState());
        }
      }

      const updateInfo = state.updateInfo;
      await logger.info('Starting update download', {
        version: updateInfo.version,
        url: updateInfo.url,
        expectedSha256: updateInfo.sha256,
        expectedSize: updateInfo.size,
      });
      state.status = 'downloading';
      state.progress = { transferred: 0, total: updateInfo.size || 0, percent: 0 };
      state.downloadedFile = '';
      state.downloadedSha256 = '';
      state.lastError = null;

      const cacheDir = path.join(app.getPath('userData'), 'update-cache');
      await fsp.mkdir(cacheDir, { recursive: true });
      const localSourcePath = getLocalFilePath(updateInfo.url);
      let installerExtension = '.bin';
      if (process.platform === 'win32') {
        installerExtension = '.exe';
      } else if (localSourcePath) {
        installerExtension = path.extname(localSourcePath) || '.bin';
      } else {
        installerExtension = path.extname(new URL(updateInfo.url).pathname) || '.bin';
      }
      const baseName = sanitizeFileName(`${app.getName()}-${updateInfo.version}-${updateInfo.sha256.slice(0, 8)}`);
      const finalPath = path.join(cacheDir, `${baseName}${installerExtension}`);
      tempPath = `${finalPath}.download`;
      await unlinkQuietly(tempPath);
      await unlinkQuietly(finalPath);

      await logger.debug('Prepared update cache paths', {
        cacheDir,
        localSourcePath,
        tempPath,
        finalPath,
      });

      const cancelToken = { cancelled: false, cancel: null };
      currentDownload = cancelToken;
      emit('downloading', { progress: state.progress, updateInfo }, { silent: false });

      let lastLoggedProgressBucket = -1;
      const onProgress = progress => {
        state.progress = progress;
        const percent = Number(progress?.percent) || 0;
        const bucket = Math.floor(percent / 25) * 25;
        if (bucket !== lastLoggedProgressBucket || percent >= 100) {
          lastLoggedProgressBucket = bucket;
          void logger.debug('Update download progress', progress);
        }
        emit('download-progress', { progress, updateInfo }, { silent: false });
      };

      await logger.debug(localSourcePath ? 'Copying local update installer' : 'Downloading remote update installer', {
        source: localSourcePath || updateInfo.url,
        destination: tempPath,
      });
      const transferResult = await copyOrDownloadInstaller(updateInfo, tempPath, onProgress, cancelToken);
      await logger.info('Installer transfer completed', transferResult);
      if (cancelToken.cancelled) throw createPublicError('DOWNLOAD_CANCELLED', 'Người dùng đã hủy tải cập nhật.');

      await logger.debug('Verifying downloaded installer SHA256', {
        filePath: tempPath,
        expectedSha256: updateInfo.sha256,
      });
      const actualSha256 = await sha256File(tempPath);
      if (actualSha256.toLowerCase() !== updateInfo.sha256.toLowerCase()) {
        await logger.error('Installer SHA256 mismatch after download', {
          expected: updateInfo.sha256,
          actual: actualSha256,
          filePath: tempPath,
        });
        await unlinkQuietly(tempPath);
        await unlinkQuietly(finalPath);
        throw createPublicError('CHECKSUM_MISMATCH', 'Checksum SHA256 không khớp. Installer đã bị xóa và sẽ không được chạy.', { expected: updateInfo.sha256, actual: actualSha256 });
      }

      await logger.info('Installer SHA256 verified', {
        filePath: tempPath,
        sha256: actualSha256,
      });
      await fsp.rename(tempPath, finalPath);
      await logger.info('Installer stored in update cache', { finalPath });
      state.status = 'downloaded';
      state.progress = { ...(state.progress || {}), percent: 100 };
      state.downloadedFile = finalPath;
      state.downloadedSha256 = actualSha256;

      return success({
        downloadedFile: finalPath,
        sha256: actualSha256,
        updateInfo,
        state: getPublicState(),
        event: emit('downloaded', { message: 'Đã tải và xác thực installer cập nhật.', updateInfo, downloadedFile: finalPath }, { silent: false }),
      });
    } catch (err) {
      const isCancelled = err?.code === 'DOWNLOAD_CANCELLED';
      state.status = isCancelled ? 'cancelled' : 'error';
      state.lastError = { code: err.code || 'DOWNLOAD_FAILED', message: err.message, details: err.details };
      await logger[isCancelled ? 'warn' : 'error'](isCancelled ? 'Update download cancelled' : 'Update download failed', err);
      if (typeof tempPath === 'string') await unlinkQuietly(tempPath);
      emit(isCancelled ? 'cancelled' : 'error', { error: state.lastError }, { silent: false });
      return failure(err, getPublicState());
    } finally {
      currentDownload = null;
    }
  }

  async function cancelDownload() {
    if (!currentDownload || typeof currentDownload.cancel !== 'function') {
      await logger.warn('Cancel update request ignored because no download is running');
      return failure(createPublicError('NO_DOWNLOAD_IN_PROGRESS', 'Không có lượt tải cập nhật nào đang chạy.'), getPublicState());
    }
    await logger.info('Cancelling update download by user request');
    currentDownload.cancel();
    state.status = 'cancelled';
    state.lastError = null;
    emit('cancelled', { message: 'Đã hủy tải cập nhật theo yêu cầu người dùng.' }, { silent: false });
    return success({ cancelled: true, state: getPublicState() });
  }

  async function installUpdate() {
    try {
      await logger.info('Preparing update installation', {
        downloadedFile: state.downloadedFile,
        updateVersion: state.updateInfo?.version,
      });
      if (!state.downloadedFile) {
        throw createPublicError('INSTALLER_NOT_DOWNLOADED', 'Chưa có installer đã tải để cài đặt.');
      }
      if (!(await pathExists(state.downloadedFile))) {
        throw createPublicError('INSTALLER_NOT_FOUND', 'Không tìm thấy installer đã tải. Vui lòng tải lại bản cập nhật.');
      }
      if (!state.updateInfo) {
        throw createPublicError('UPDATE_INFO_MISSING', 'Thiếu thông tin bản cập nhật. Vui lòng kiểm tra cập nhật lại.');
      }

      await logger.debug('Verifying downloaded installer before install', {
        downloadedFile: state.downloadedFile,
        expectedSha256: state.updateInfo.sha256,
      });
      const actualSha256 = await sha256File(state.downloadedFile);
      if (actualSha256.toLowerCase() !== state.updateInfo.sha256.toLowerCase()) {
        await logger.error('Installer SHA256 mismatch before install', {
          expected: state.updateInfo.sha256,
          actual: actualSha256,
          downloadedFile: state.downloadedFile,
        });
        await unlinkQuietly(state.downloadedFile);
        state.downloadedFile = '';
        state.downloadedSha256 = '';
        throw createPublicError('CHECKSUM_MISMATCH', 'Checksum SHA256 không khớp trước khi cài đặt. Installer đã bị xóa.', { expected: state.updateInfo.sha256, actual: actualSha256 });
      }
      await logger.info('Downloaded installer SHA256 verified before install', {
        downloadedFile: state.downloadedFile,
        sha256: actualSha256,
      });

      await logger.debug('Backing up database before update install', {
        targetVersion: state.updateInfo.version,
      });
      const backup = await backupDatabase(app, state.updateInfo.version);
      await logger.info(backup.skipped ? 'Database backup skipped because database file does not exist' : 'Database backup completed before update install', backup);
      state.backupPath = backup.backupPath;
      state.status = 'installing';
      emit('installing', { message: 'Đang mở bộ cài cập nhật...', backup }, { silent: false });

      await logger.info('Spawning update installer', {
        installer: state.downloadedFile,
        args: [],
      });
      await new Promise((resolve, reject) => {
        let settled = false;
        const child = spawn(state.downloadedFile, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });

        child.once('error', err => {
          if (settled) return;
          settled = true;
          reject(createPublicError('SPAWN_INSTALLER_FAILED', 'Không thể chạy installer cập nhật.', err.message));
        });

        child.once('spawn', () => {
          if (settled) return;
          settled = true;
          void logger.info('Update installer process spawned', {
            installer: state.downloadedFile,
            pid: child.pid,
          });
          child.unref();
          resolve();
        });
      });

      await logger.info('Installer spawned successfully; scheduling application quit');
      setTimeout(() => app.quit(), 250);
      return success({ installing: true, backupPath: state.backupPath, state: getPublicState() });
    } catch (err) {
      state.status = 'error';
      state.lastError = { code: err.code || 'INSTALL_FAILED', message: err.message, details: err.details };
      await logger.error('Update install failed', err);
      emit('error', { error: state.lastError }, { silent: false });
      return failure(err, getPublicState());
    }
  }

  function registerIpc(ipcMain) {
    ipcMain.handle(CHANNELS.appInfo, () => getAppInfo());
    ipcMain.handle(CHANNELS.getState, () => getState());
    ipcMain.handle(CHANNELS.check, (_event, options) => checkForUpdates(options || {}));
    ipcMain.handle(CHANNELS.download, () => downloadUpdate());
    ipcMain.handle(CHANNELS.cancel, () => cancelDownload());
    ipcMain.handle(CHANNELS.install, () => installUpdate());
  }

  function scheduleStartupCheck(delayMs = 3500) {
    if (startupCheckScheduled) return;
    startupCheckScheduled = true;
    void logger.info('Scheduling startup update check', { delayMs });
    setTimeout(() => {
      checkForUpdates({ silent: true, source: 'startup' }).catch(err => {
        state.status = 'error';
        state.lastError = { code: err.code || 'STARTUP_CHECK_FAILED', message: err.message };
        void logger.error('Startup update check failed outside normal flow', err);
      });
    }, delayMs);
  }

  return {
    CHANNELS,
    registerIpc,
    getAppInfo,
    getState,
    checkForUpdates,
    downloadUpdate,
    cancelDownload,
    installUpdate,
    scheduleStartupCheck,
    compareVersions,
    sha256File,
  };
}

module.exports = {
  CHANNELS,
  createUpdateManager,
  compareVersions,
  parseSemVer,
  sha256File,
};
