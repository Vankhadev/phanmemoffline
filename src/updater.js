const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { dialog } = require('electron');
const { autoUpdater, CancellationToken } = require('electron-updater');

const CHANNELS = Object.freeze({
  appInfo: 'kha:app:get-info',
  getState: 'kha:update:get-state',
  check: 'kha:update:check',
  download: 'kha:update:download',
  cancel: 'kha:update:cancel',
  install: 'kha:update:install',
  status: 'kha:update:status',
});

const DB_FILE_NAME = 'phanmienoffline.db.json';
const DEFAULT_GITHUB_OWNER = 'Vankhadev';
const DEFAULT_GITHUB_REPO = 'phanmemoffline';
const SENSITIVE_LOG_KEY_PATTERN = /(token|secret|password|authorization|cookie|api[-_]?key)/i;
const STARTUP_CHECK_DELAY_MS = 3500;

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

function isTruthy(value) {
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value || '').trim().toLowerCase());
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
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

function getPublishCandidates(packageConfig) {
  const candidates = [];
  const rootPublish = packageConfig?.build?.publish;
  const winPublish = packageConfig?.build?.win?.publish;

  for (const value of [rootPublish, winPublish]) {
    if (Array.isArray(value)) candidates.push(...value);
    else if (value && typeof value === 'object') candidates.push(value);
  }

  return candidates;
}

function resolveElectronUpdaterFeed() {
  const packageConfig = getPackageConfig();
  const githubPublish = getPublishCandidates(packageConfig).find(item => String(item?.provider || '').toLowerCase() === 'github') || {};
  const legacyConfig = packageConfig.khaUpdate && typeof packageConfig.khaUpdate === 'object' ? packageConfig.khaUpdate : {};
  const repositoryOverride = String(process.env.KHA_UPDATE_REPOSITORY || process.env.KHA_ELECTRON_UPDATE_REPOSITORY || '').trim();
  const [ownerFromRepository, repoFromRepository] = repositoryOverride.includes('/') ? repositoryOverride.split('/', 2) : [];

  const owner = cleanRepoPart(
    process.env.KHA_UPDATE_OWNER
      || process.env.KHA_ELECTRON_UPDATE_OWNER
      || ownerFromRepository
      || githubPublish.owner
      || legacyConfig.owner,
    DEFAULT_GITHUB_OWNER,
  );
  const repo = cleanRepoPart(
    process.env.KHA_UPDATE_REPO
      || process.env.KHA_ELECTRON_UPDATE_REPO
      || repoFromRepository
      || githubPublish.repo
      || legacyConfig.repo,
    DEFAULT_GITHUB_REPO,
  );
  const provider = String(githubPublish.provider || legacyConfig.provider || 'github').trim().toLowerCase();
  const releaseType = String(githubPublish.releaseType || 'release').trim();
  const channel = String(process.env.KHA_UPDATE_CHANNEL || githubPublish.channel || '').trim();
  const feedUrl = `https://github.com/${owner}/${repo}/releases/latest/download/${channel || 'latest'}.yml`;

  return {
    provider,
    owner,
    repo,
    releaseType,
    channel,
    feedUrl,
    source: githubPublish.provider ? 'package.build.publish' : 'package.khaUpdate/default',
    configured: Boolean(githubPublish.provider || legacyConfig.provider),
  };
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

  function write(level, message, details) {
    const entry = {
      at: new Date().toISOString(),
      level,
      message: String(message || ''),
      ...(details !== undefined ? { details: sanitizeForLog(details) } : {}),
    };

    const consoleMessage = `[KHA Update] ${entry.message}`;
    if (level === 'error') console.error(consoleMessage, entry.details || '');
    else if (level === 'warn') console.warn(consoleMessage, entry.details || '');
    else console.log(consoleMessage, entry.details || '');

    void (async () => {
      try {
        await fsp.mkdir(logDir, { recursive: true });
        await fsp.appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
      } catch (_) {
        // Logging must never break the update flow.
      }
    })();
  }

  return {
    logPath,
    debug: (message, details) => write('debug', message, details),
    info: (message, details) => write('info', message, details),
    warn: (message, details) => write('warn', message, details),
    error: (message, details) => write('error', message, details),
  };
}

function normalizeReleaseNotes(releaseNotes) {
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') return item.note || item.notes || item.body || JSON.stringify(item);
        return String(item || '');
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return String(releaseNotes || '').trim();
}

function getPrimaryFileInfo(updateInfo) {
  if (Array.isArray(updateInfo?.files) && updateInfo.files.length > 0) return updateInfo.files[0];
  return null;
}

function normalizeUpdateInfo(updateInfo) {
  if (!updateInfo) return null;
  const primaryFile = getPrimaryFileInfo(updateInfo);
  const version = normalizeVersion(updateInfo.version);
  const size = Number(primaryFile?.size || updateInfo.size || 0) || 0;
  const sha512 = String(primaryFile?.sha512 || updateInfo.sha512 || '').trim();
  const updatePath = String(updateInfo.path || primaryFile?.url || '').trim();

  return {
    version,
    releaseName: String(updateInfo.releaseName || '').trim(),
    releaseNotes: normalizeReleaseNotes(updateInfo.releaseNotes),
    releaseDate: String(updateInfo.releaseDate || '').trim(),
    stagingPercentage: updateInfo.stagingPercentage,
    path: updatePath,
    url: updatePath,
    sha512,
    sha256: '',
    files: Array.isArray(updateInfo.files) ? updateInfo.files : [],
    size,
    mandatory: false,
    installerType: 'nsis',
    provider: 'github',
    updater: 'electron-updater',
  };
}

function normalizeProgress(progress) {
  const total = Number(progress?.total) || 0;
  const transferred = Number(progress?.transferred) || 0;
  const percent = Math.max(0, Math.min(100, Number(progress?.percent) || (total ? (transferred / total) * 100 : 0)));
  return {
    bytesPerSecond: Number(progress?.bytesPerSecond) || 0,
    percent,
    transferred,
    total,
  };
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (!bytes) return 'không rõ dung lượng';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
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

function isCancellationError(err) {
  return err?.name === 'CancellationError'
    || err?.message === 'cancelled'
    || err?.code === 'ERR_UPDATER_CANCELLED'
    || err?.code === 'DOWNLOAD_CANCELLED';
}

function isDevUpdaterForced() {
  return isTruthy(process.env.KHA_FORCE_AUTO_UPDATE)
    || isTruthy(process.env.KHA_ENABLE_ELECTRON_UPDATER)
    || isTruthy(process.env.ELECTRON_FORCE_AUTO_UPDATE)
    || isTruthy(process.env.ELECTRON_ENABLE_UPDATER);
}

function createUpdateManager({ app, getMainWindow }) {
  const logger = createUpdateLogger(app);
  const feed = resolveElectronUpdaterFeed();
  let startupCheckScheduled = false;
  let updaterConfigured = false;
  let listenersRegistered = false;
  let currentCheckPromise = null;
  let currentDownloadPromise = null;
  let currentDownloadToken = null;
  let currentDownloadSilent = false;
  let installInProgress = false;
  let promptInProgress = false;
  let downloadedDialogShownForVersion = '';
  let activeCheckOptions = { silent: true, source: 'init', autoDownload: false };

  const state = {
    currentVersion: app.getVersion(),
    updateEngine: 'electron-updater',
    feedProvider: feed.provider,
    feedOwner: feed.owner,
    feedRepo: feed.repo,
    feedUrl: feed.feedUrl,
    feedSource: feed.source,
    manifestUrl: feed.feedUrl,
    manifestSource: feed.source,
    manifestUrlConfigured: feed.configured,
    manifestUrlDefault: true,
    defaultManifestUrl: feed.feedUrl,
    updateLogPath: logger.logPath,
    status: 'idle',
    updateAvailable: false,
    updateInfo: null,
    progress: null,
    downloadedFile: '',
    downloadedSha256: '',
    downloadedSha512: '',
    backupPath: '',
    lastCheckedAt: '',
    lastError: null,
    devUpdateForced: isDevUpdaterForced(),
  };

  function getPublicState() {
    return {
      currentVersion: state.currentVersion,
      updateEngine: state.updateEngine,
      feedProvider: state.feedProvider,
      feedOwner: state.feedOwner,
      feedRepo: state.feedRepo,
      feedUrl: state.feedUrl,
      feedSource: state.feedSource,
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
      downloadedSha512: state.downloadedSha512,
      backupPath: state.backupPath,
      lastCheckedAt: state.lastCheckedAt,
      lastError: state.lastError,
      devUpdateForced: state.devUpdateForced,
    };
  }

  function emit(type, payload = {}, { silent = false } = {}) {
    const publicPayload = {
      type,
      state: getPublicState(),
      ...payload,
      at: new Date().toISOString(),
    };

    const shouldNotifyRenderer = !silent || [
      'update-available',
      'downloading',
      'download-progress',
      'downloaded',
      'installing',
      'install-deferred',
    ].includes(type);
    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (shouldNotifyRenderer && win && !win.isDestroyed() && win.webContents) {
      win.webContents.send(CHANNELS.status, publicPayload);
    }

    return publicPayload;
  }

  function configureUpdater() {
    if (updaterConfigured) return;
    updaterConfigured = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.forceDevUpdateConfig = state.devUpdateForced;
    autoUpdater.logger = {
      info: message => logger.info('electron-updater: thông tin', { message }),
      warn: message => logger.warn('electron-updater: cảnh báo', { message }),
      error: message => logger.error('electron-updater: lỗi', { message }),
      debug: message => logger.debug('electron-updater: debug', { message }),
    };
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: feed.owner,
      repo: feed.repo,
      releaseType: feed.releaseType,
      ...(feed.channel ? { channel: feed.channel } : {}),
    });

    logger.info('Đã cấu hình electron-updater cho GitHub Releases', {
      owner: feed.owner,
      repo: feed.repo,
      feedUrl: feed.feedUrl,
      appVersion: state.currentVersion,
      isPackaged: app.isPackaged,
      devUpdateForced: state.devUpdateForced,
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
    });
  }

  async function installUpdate(options = {}) {
    if (installInProgress) {
      const err = createPublicError('INSTALL_IN_PROGRESS', 'Ứng dụng đang chuẩn bị cài đặt bản cập nhật.');
      return failure(err, getPublicState());
    }

    try {
      installInProgress = true;
      if (state.status !== 'downloaded' || !state.updateInfo) {
        throw createPublicError('UPDATE_NOT_DOWNLOADED', 'Chưa có bản cập nhật đã tải xong để cài đặt.');
      }

      logger.info('Người dùng đồng ý cài đặt bản cập nhật', {
        source: options.source || 'manual',
        version: state.updateInfo.version,
        downloadedFile: state.downloadedFile,
      });

      if (state.downloadedFile && !(await pathExists(state.downloadedFile))) {
        logger.warn('File cập nhật không còn thấy ở đường dẫn sự kiện, vẫn để electron-updater xử lý cache nội bộ', {
          downloadedFile: state.downloadedFile,
        });
      }

      const backup = await backupDatabase(app, state.updateInfo.version);
      state.backupPath = backup.backupPath;
      logger.info(
        backup.skipped
          ? 'Bỏ qua backup database trước cập nhật vì chưa có file dữ liệu runtime'
          : 'Đã backup database trước khi cài đặt cập nhật',
        backup,
      );

      state.status = 'installing';
      state.lastError = null;
      emit('installing', {
        message: 'Đang khởi động cài đặt bản cập nhật...',
        backup,
        updateInfo: state.updateInfo,
      }, { silent: false });

      logger.info('Gọi electron-updater quitAndInstall sau khi người dùng xác nhận', {
        isSilent: false,
        isForceRunAfter: true,
      });
      autoUpdater.quitAndInstall(false, true);
      return success({ installing: true, backupPath: state.backupPath, state: getPublicState() });
    } catch (err) {
      installInProgress = false;
      state.status = 'error';
      state.lastError = { code: err.code || 'INSTALL_FAILED', message: err.message, details: err.details };
      logger.error('Cài đặt cập nhật thất bại, ứng dụng tiếp tục chạy', err);
      emit('error', { error: state.lastError }, { silent: false });
      return failure(err, getPublicState());
    }
  }

  async function promptToInstallDownloadedUpdate(updateInfo, downloadedFile) {
    const normalizedInfo = normalizeUpdateInfo(updateInfo) || state.updateInfo;
    if (!normalizedInfo || promptInProgress) return;
    if (downloadedDialogShownForVersion === normalizedInfo.version) return;

    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (!win || win.isDestroyed()) {
      logger.warn('Không hiển thị được hộp thoại cập nhật vì cửa sổ chính chưa sẵn sàng', {
        version: normalizedInfo.version,
        downloadedFile,
      });
      return;
    }

    promptInProgress = true;
    downloadedDialogShownForVersion = normalizedInfo.version;
    try {
      logger.info('Hiển thị hộp thoại hỏi người dùng có cập nhật ngay hay để sau', {
        version: normalizedInfo.version,
        downloadedFile,
      });
      const releaseNotes = normalizedInfo.releaseNotes ? `\n\nGhi chú phát hành:\n${normalizedInfo.releaseNotes}` : '';
      const detail = [
        `Phiên bản hiện tại: ${state.currentVersion}`,
        `Phiên bản mới: ${normalizedInfo.version}`,
        `Dung lượng: ${formatBytes(normalizedInfo.size)}`,
        'Ứng dụng chỉ cài đặt/restart khi bạn chọn “Cập nhật ngay”. Nếu chọn “Để sau”, ứng dụng tiếp tục chạy bình thường.',
        releaseNotes,
      ].filter(Boolean).join('\n');

      const result = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Bản cập nhật đã sẵn sàng',
        message: `Đã tải xong bản cập nhật ${normalizedInfo.version}.`,
        detail,
        buttons: ['Cập nhật ngay', 'Để sau'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        normalizeAccessKeys: true,
      });

      if (result.response === 0) {
        await installUpdate({ source: 'downloaded-dialog' });
        return;
      }

      logger.info('Người dùng chọn để sau, không cài đặt hoặc restart ứng dụng', {
        version: normalizedInfo.version,
      });
      state.status = 'downloaded';
      emit('install-deferred', {
        message: 'Người dùng chọn để sau. Ứng dụng tiếp tục chạy bình thường.',
        updateInfo: normalizedInfo,
      }, { silent: false });
    } catch (err) {
      logger.error('Không xử lý được hộp thoại cập nhật, ứng dụng tiếp tục chạy', err);
      state.status = 'downloaded';
    } finally {
      promptInProgress = false;
    }
  }

  function registerUpdaterEvents() {
    if (listenersRegistered) return;
    listenersRegistered = true;

    autoUpdater.on('checking-for-update', () => {
      state.status = 'checking';
      state.progress = null;
      state.lastError = null;
      logger.info('Đang kiểm tra bản cập nhật qua electron-updater', {
        source: activeCheckOptions.source,
        silent: activeCheckOptions.silent,
        feedUrl: state.feedUrl,
      });
      emit('checking', { message: 'Đang kiểm tra bản cập nhật...' }, { silent: activeCheckOptions.silent });
    });

    autoUpdater.on('update-not-available', updateInfo => {
      const normalizedInfo = normalizeUpdateInfo(updateInfo);
      state.status = 'no-update';
      state.updateAvailable = false;
      state.updateInfo = normalizedInfo;
      state.progress = null;
      state.downloadedFile = '';
      state.downloadedSha256 = '';
      state.downloadedSha512 = '';
      state.lastCheckedAt = new Date().toISOString();
      state.lastError = null;
      logger.info('Không có bản cập nhật mới', {
        currentVersion: state.currentVersion,
        latestVersion: normalizedInfo?.version,
      });
      emit('no-update', {
        message: 'Ứng dụng đang ở phiên bản mới nhất.',
        updateInfo: normalizedInfo,
      }, { silent: activeCheckOptions.silent });
    });

    autoUpdater.on('update-available', updateInfo => {
      const normalizedInfo = normalizeUpdateInfo(updateInfo);
      state.status = 'update-available';
      state.updateAvailable = true;
      state.updateInfo = normalizedInfo;
      state.progress = null;
      state.downloadedFile = '';
      state.downloadedSha256 = '';
      state.downloadedSha512 = normalizedInfo?.sha512 || '';
      state.lastCheckedAt = new Date().toISOString();
      state.lastError = null;
      logger.info('Có bản cập nhật mới trên GitHub Releases', {
        currentVersion: state.currentVersion,
        updateInfo: normalizedInfo,
      });
      emit('update-available', {
        message: normalizedInfo?.version ? `Có bản cập nhật ${normalizedInfo.version}.` : 'Có bản cập nhật mới.',
        updateInfo: normalizedInfo,
      }, { silent: false });
    });

    autoUpdater.on('download-progress', progress => {
      state.status = 'downloading';
      state.progress = normalizeProgress(progress);
      state.lastError = null;
      emit('download-progress', {
        message: 'Đang tải bản cập nhật...',
        progress: state.progress,
        updateInfo: state.updateInfo,
      }, { silent: currentDownloadSilent });
    });

    autoUpdater.on('update-downloaded', updateInfo => {
      const normalizedInfo = normalizeUpdateInfo(updateInfo);
      state.status = 'downloaded';
      state.updateAvailable = true;
      state.updateInfo = normalizedInfo;
      state.progress = { ...(state.progress || {}), percent: 100 };
      state.downloadedFile = String(updateInfo?.downloadedFile || '').trim();
      state.downloadedSha512 = normalizedInfo?.sha512 || state.downloadedSha512 || '';
      state.downloadedSha256 = '';
      state.lastError = null;
      logger.info('Đã tải xong bản cập nhật, chờ người dùng xác nhận cài đặt', {
        version: normalizedInfo?.version,
        downloadedFile: state.downloadedFile,
        sha512: state.downloadedSha512,
      });
      emit('downloaded', {
        message: 'Đã tải xong bản cập nhật. Chờ người dùng chọn cập nhật ngay hoặc để sau.',
        updateInfo: normalizedInfo,
        downloadedFile: state.downloadedFile,
      }, { silent: false });
      void promptToInstallDownloadedUpdate(updateInfo, state.downloadedFile);
    });

    autoUpdater.on('update-cancelled', updateInfo => {
      const normalizedInfo = normalizeUpdateInfo(updateInfo);
      state.status = 'cancelled';
      state.progress = null;
      state.lastError = null;
      logger.warn('Đã hủy tải bản cập nhật', { updateInfo: normalizedInfo });
      emit('cancelled', {
        message: 'Đã hủy tải cập nhật theo yêu cầu người dùng.',
        updateInfo: normalizedInfo,
      }, { silent: false });
    });

    autoUpdater.on('error', err => {
      if (isCancellationError(err)) {
        state.status = 'cancelled';
        state.lastError = null;
        logger.warn('Luồng tải cập nhật đã bị hủy', err);
        emit('cancelled', { message: 'Đã hủy tải cập nhật.' }, { silent: currentDownloadSilent });
        return;
      }

      state.status = 'error';
      state.lastError = {
        code: err?.code || 'ELECTRON_UPDATER_ERROR',
        message: err?.message || 'electron-updater báo lỗi không xác định.',
      };
      logger.error('electron-updater báo lỗi, ứng dụng tiếp tục chạy', err);
      emit('error', { error: state.lastError }, { silent: activeCheckOptions.silent || currentDownloadSilent });
    });
  }

  function ensureUpdaterReady() {
    configureUpdater();
    registerUpdaterEvents();
  }

  function updatesAllowed() {
    return app.isPackaged || state.devUpdateForced;
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

  async function getState() {
    return success({ state: getPublicState() });
  }

  async function checkForUpdates(options = {}) {
    ensureUpdaterReady();
    const silent = Boolean(options.silent);
    const source = String(options.source || (options.manual ? 'manual' : (silent ? 'silent' : 'manual')));
    const autoDownload = Boolean(options.autoDownload);

    if (!updatesAllowed()) {
      const err = createPublicError(
        'DEV_UPDATER_DISABLED',
        'Auto-update bị tắt khi chạy development/unpacked. Đặt KHA_ENABLE_ELECTRON_UPDATER=1 nếu cần test có chủ đích.',
      );
      logger.info('Bỏ qua kiểm tra cập nhật vì ứng dụng chưa đóng gói production', {
        isPackaged: app.isPackaged,
        devUpdateForced: state.devUpdateForced,
        source,
      });
      if (!silent) {
        state.status = 'error';
        state.lastError = { code: err.code, message: err.message };
        emit('error', { error: state.lastError }, { silent: false });
        return failure(err, getPublicState());
      }
      return success({ skipped: true, reason: 'development-mode', state: getPublicState() });
    }

    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (!app.isReady() || !win || win.isDestroyed()) {
      const err = createPublicError('WINDOW_NOT_READY', 'Chỉ kiểm tra cập nhật sau khi app ready và cửa sổ chính đã sẵn sàng.');
      logger.warn('Bỏ qua kiểm tra cập nhật vì app/window chưa sẵn sàng', {
        appReady: app.isReady(),
        hasWindow: Boolean(win),
        source,
      });
      if (!silent) return failure(err, getPublicState());
      return success({ skipped: true, reason: 'window-not-ready', state: getPublicState() });
    }

    if (currentCheckPromise) {
      logger.warn('Bỏ qua yêu cầu kiểm tra cập nhật trùng lặp vì một lượt check đang chạy', { source });
      return currentCheckPromise;
    }

    activeCheckOptions = { silent, source, autoDownload };
    currentCheckPromise = (async () => {
      try {
        state.status = 'checking';
        state.progress = null;
        state.lastError = null;
        logger.info('Bắt đầu kiểm tra cập nhật', {
          source,
          silent,
          autoDownload,
          feedUrl: state.feedUrl,
          currentVersion: state.currentVersion,
        });

        const result = await autoUpdater.checkForUpdates();
        if (!result) {
          logger.warn('electron-updater không active, không kiểm tra cập nhật', {
            isPackaged: app.isPackaged,
            devUpdateForced: state.devUpdateForced,
          });
          return success({ skipped: true, reason: 'updater-inactive', state: getPublicState() });
        }

        const normalizedInfo = normalizeUpdateInfo(result.updateInfo);
        state.lastCheckedAt = new Date().toISOString();

        if (!result.isUpdateAvailable) {
          state.status = 'no-update';
          state.updateAvailable = false;
          state.updateInfo = normalizedInfo;
          return success({
            updateAvailable: false,
            updateInfo: normalizedInfo,
            state: getPublicState(),
          });
        }

        state.status = 'update-available';
        state.updateAvailable = true;
        state.updateInfo = normalizedInfo;

        const response = success({
          updateAvailable: true,
          updateInfo: normalizedInfo,
          state: getPublicState(),
        });

        if (autoDownload && !state.downloadedFile && !currentDownloadPromise) {
          logger.info('Startup check thấy bản mới, tự bắt đầu tải cập nhật nhưng chưa cài đặt', {
            version: normalizedInfo?.version,
          });
          void downloadUpdate({ source: 'startup-auto-download', silent: false }).catch(err => {
            logger.error('Tự tải cập nhật sau startup check thất bại', err);
          });
        }

        return response;
      } catch (err) {
        state.status = 'error';
        state.lastError = { code: err.code || 'CHECK_FAILED', message: err.message, details: err.details };
        logger.error('Kiểm tra cập nhật thất bại, ứng dụng tiếp tục chạy', err);
        if (!silent) emit('error', { error: state.lastError }, { silent: false });
        return failure(err, getPublicState());
      } finally {
        currentCheckPromise = null;
        activeCheckOptions = { silent: true, source: 'idle', autoDownload: false };
      }
    })();

    return currentCheckPromise;
  }

  async function downloadUpdate(options = {}) {
    ensureUpdaterReady();
    const silent = Boolean(options.silent);
    const source = String(options.source || 'manual');

    if (!updatesAllowed()) {
      const err = createPublicError(
        'DEV_UPDATER_DISABLED',
        'Auto-update bị tắt khi chạy development/unpacked. Đặt KHA_ENABLE_ELECTRON_UPDATER=1 nếu cần test có chủ đích.',
      );
      return failure(err, getPublicState());
    }

    if (currentDownloadPromise) {
      logger.warn('Bỏ qua yêu cầu tải cập nhật trùng lặp vì một lượt tải đang chạy', { source });
      return failure(createPublicError('DOWNLOAD_IN_PROGRESS', 'Một lượt tải cập nhật đang chạy.'), getPublicState());
    }

    if (state.status === 'downloaded' && state.updateInfo) {
      logger.info('Bản cập nhật đã tải sẵn, không tải lại', {
        source,
        version: state.updateInfo.version,
        downloadedFile: state.downloadedFile,
      });
      return success({
        downloadedFile: state.downloadedFile,
        updateInfo: state.updateInfo,
        state: getPublicState(),
      });
    }

    try {
      if (!state.updateAvailable || !state.updateInfo) {
        const checked = await checkForUpdates({ silent: false, source: 'download-precheck', autoDownload: false });
        if (!checked.ok) return checked;
        if (!checked.updateAvailable) {
          return failure(createPublicError('UPDATE_NOT_AVAILABLE', 'Không có bản cập nhật mới để tải.'), getPublicState());
        }
      }

      currentDownloadSilent = silent;
      currentDownloadToken = new CancellationToken();
      state.status = 'downloading';
      state.progress = { bytesPerSecond: 0, percent: 0, transferred: 0, total: state.updateInfo?.size || 0 };
      state.lastError = null;
      logger.info('Bắt đầu tải bản cập nhật bằng electron-updater', {
        source,
        version: state.updateInfo?.version,
        feedUrl: state.feedUrl,
      });
      emit('downloading', {
        message: 'Đang tải bản cập nhật...',
        progress: state.progress,
        updateInfo: state.updateInfo,
      }, { silent });

      currentDownloadPromise = autoUpdater.downloadUpdate(currentDownloadToken);
      const downloadedFiles = await currentDownloadPromise;
      const downloadedFile = Array.isArray(downloadedFiles) ? String(downloadedFiles[0] || '') : '';

      if (state.status !== 'downloaded') {
        state.status = 'downloaded';
        state.progress = { ...(state.progress || {}), percent: 100 };
        state.downloadedFile = downloadedFile;
        state.downloadedSha512 = state.updateInfo?.sha512 || state.downloadedSha512 || '';
        state.lastError = null;
        emit('downloaded', {
          message: 'Đã tải xong bản cập nhật. Chờ người dùng chọn cập nhật ngay hoặc để sau.',
          updateInfo: state.updateInfo,
          downloadedFile,
        }, { silent: false });
        void promptToInstallDownloadedUpdate(state.updateInfo, downloadedFile);
      }

      logger.info('Tải cập nhật hoàn tất', {
        source,
        version: state.updateInfo?.version,
        downloadedFiles,
      });
      return success({
        downloadedFile: state.downloadedFile || downloadedFile,
        downloadedFiles,
        updateInfo: state.updateInfo,
        state: getPublicState(),
      });
    } catch (err) {
      if (isCancellationError(err)) {
        state.status = 'cancelled';
        state.progress = null;
        state.lastError = null;
        logger.warn('Tải cập nhật đã bị hủy theo yêu cầu', err);
        emit('cancelled', { message: 'Đã hủy tải cập nhật theo yêu cầu người dùng.' }, { silent: false });
        return success({ cancelled: true, state: getPublicState() });
      }

      state.status = 'error';
      state.lastError = { code: err.code || 'DOWNLOAD_FAILED', message: err.message, details: err.details };
      logger.error('Tải cập nhật thất bại, ứng dụng tiếp tục chạy', err);
      emit('error', { error: state.lastError }, { silent });
      return failure(err, getPublicState());
    } finally {
      if (currentDownloadToken && typeof currentDownloadToken.dispose === 'function') currentDownloadToken.dispose();
      currentDownloadToken = null;
      currentDownloadPromise = null;
      currentDownloadSilent = false;
    }
  }

  async function cancelDownload() {
    if (!currentDownloadToken || typeof currentDownloadToken.cancel !== 'function') {
      logger.warn('Bỏ qua yêu cầu hủy tải vì không có lượt tải nào đang chạy');
      return failure(createPublicError('NO_DOWNLOAD_IN_PROGRESS', 'Không có lượt tải cập nhật nào đang chạy.'), getPublicState());
    }

    logger.info('Người dùng yêu cầu hủy tải cập nhật');
    currentDownloadToken.cancel();
    state.status = 'cancelled';
    state.progress = null;
    state.lastError = null;
    emit('cancelled', { message: 'Đã hủy tải cập nhật theo yêu cầu người dùng.' }, { silent: false });
    return success({ cancelled: true, state: getPublicState() });
  }

  function registerIpc(ipcMain) {
    ensureUpdaterReady();
    ipcMain.handle(CHANNELS.appInfo, () => getAppInfo());
    ipcMain.handle(CHANNELS.getState, () => getState());
    ipcMain.handle(CHANNELS.check, (_event, options) => checkForUpdates(options || {}));
    ipcMain.handle(CHANNELS.download, () => downloadUpdate({ source: 'manual' }));
    ipcMain.handle(CHANNELS.cancel, () => cancelDownload());
    ipcMain.handle(CHANNELS.install, () => installUpdate({ source: 'manual' }));
  }

  function scheduleStartupCheck(delayMs = STARTUP_CHECK_DELAY_MS) {
    if (startupCheckScheduled) return;
    startupCheckScheduled = true;

    if (!updatesAllowed()) {
      logger.info('Không tự kiểm tra cập nhật khi chạy development/unpacked', {
        isPackaged: app.isPackaged,
        devUpdateForced: state.devUpdateForced,
      });
      return;
    }

    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (!app.isReady() || !win || win.isDestroyed()) {
      logger.warn('Không lên lịch kiểm tra cập nhật vì app/window chưa sẵn sàng', {
        appReady: app.isReady(),
        hasWindow: Boolean(win),
      });
      startupCheckScheduled = false;
      return;
    }

    ensureUpdaterReady();
    logger.info('Lên lịch kiểm tra cập nhật sau khi app ready và cửa sổ chính đã hiển thị', { delayMs });
    setTimeout(() => {
      checkForUpdates({ silent: true, source: 'startup', autoDownload: true }).catch(err => {
        state.status = 'error';
        state.lastError = { code: err.code || 'STARTUP_CHECK_FAILED', message: err.message };
        logger.error('Startup update check lỗi ngoài luồng xử lý chính', err);
      });
    }, delayMs);
  }

  ensureUpdaterReady();

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
