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
const DEFAULT_UPDATE_CHANNEL = 'latest';
const DEFAULT_GITHUB_RELEASE_DOWNLOAD_BASE = `https://github.com/${DEFAULT_GITHUB_OWNER}/${DEFAULT_GITHUB_REPO}/releases/latest/download/`;
const SENSITIVE_LOG_KEY_PATTERN = /(token|secret|password|authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|x-amz-|signature)/i;
const SENSITIVE_QUERY_KEY_PATTERN = /^(token|access_token|auth|authorization|signature|x-amz-signature|x-amz-credential|x-amz-security-token)$/i;
const SENSITIVE_TEXT_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+\b/g,
  /\bgithub_pat_[A-Za-z0-9_]+\b/g,
  /\b(Bearer|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /(["']?(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
  /([?&](?:token|access_token|auth|authorization|signature|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)=)[^&\s]+/gi,
];
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
    error: sanitizeForPublic({
      code: error?.code || 'UNKNOWN_ERROR',
      message: error?.message || 'Đã xảy ra lỗi không xác định.',
      ...(error?.details !== undefined ? { details: error.details } : {}),
    }),
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

function normalizeChannel(value) {
  const channel = String(value || DEFAULT_UPDATE_CHANNEL)
    .trim()
    .replace(/\.yml$/i, '');
  return channel || DEFAULT_UPDATE_CHANNEL;
}

function getChannelFileName(channel) {
  return `${normalizeChannel(channel)}.yml`;
}

function ensureTrailingSlash(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.endsWith('/') ? text : `${text}/`;
}

function buildGitHubLatestDownloadBaseUrl(owner, repo) {
  return ensureTrailingSlash(`https://github.com/${owner}/${repo}/releases/latest/download/`);
}

function joinUrl(baseUrl, fileName) {
  const base = ensureTrailingSlash(baseUrl);
  try {
    return new URL(fileName, base).toString();
  } catch (_) {
    return `${base}${String(fileName || '').replace(/^\/+/, '')}`;
  }
}

function deriveBaseUrlFromFeedUrl(feedUrl) {
  const text = String(feedUrl || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text);
    const lastSlashIndex = parsed.pathname.lastIndexOf('/');
    parsed.pathname = lastSlashIndex >= 0 ? parsed.pathname.slice(0, lastSlashIndex + 1) : '/';
    parsed.search = '';
    parsed.hash = '';
    return ensureTrailingSlash(parsed.toString());
  } catch (_) {
    return ensureTrailingSlash(text.replace(/[^/\\]+(?:\?.*)?$/, ''));
  }
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
  const publishCandidates = getPublishCandidates(packageConfig);
  const githubPublish = publishCandidates.find(item => String(item?.provider || '').toLowerCase() === 'github') || {};
  const genericPublish = publishCandidates.find(item => String(item?.provider || '').toLowerCase() === 'generic') || {};
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
  const releaseType = String(githubPublish.releaseType || legacyConfig.releaseType || 'release').trim();
  const channel = normalizeChannel(process.env.KHA_UPDATE_CHANNEL || genericPublish.channel || githubPublish.channel || legacyConfig.channel || DEFAULT_UPDATE_CHANNEL);
  const channelFile = getChannelFileName(channel);
  const feedUrlOverride = String(
    process.env.KHA_UPDATE_LATEST_YML_URL
      || process.env.KHA_UPDATE_FEED_URL
      || legacyConfig.latestYmlUrl
      || legacyConfig.feedUrl
      || '',
  ).trim();
  const feedBaseUrlOverride = String(
    process.env.KHA_UPDATE_LATEST_YML_BASE_URL
      || process.env.KHA_UPDATE_FEED_BASE_URL
      || genericPublish.url
      || legacyConfig.latestYmlBaseUrl
      || legacyConfig.feedBaseUrl
      || '',
  ).trim();

  const defaultFeedBaseUrl = buildGitHubLatestDownloadBaseUrl(owner, repo) || DEFAULT_GITHUB_RELEASE_DOWNLOAD_BASE;
  const feedBaseUrl = ensureTrailingSlash(feedUrlOverride ? deriveBaseUrlFromFeedUrl(feedUrlOverride) : (feedBaseUrlOverride || defaultFeedBaseUrl));
  const feedUrl = feedUrlOverride || joinUrl(feedBaseUrl, channelFile);
  const source = feedUrlOverride
    ? (process.env.KHA_UPDATE_LATEST_YML_URL || process.env.KHA_UPDATE_FEED_URL ? 'env:latest-yml-url' : 'package.khaUpdate.latestYmlUrl')
    : feedBaseUrlOverride
      ? (genericPublish.provider ? 'package.build.publish.generic' : 'package/env latest-yml base url')
      : (githubPublish.provider ? 'package.build.publish.github-derived' : 'package.khaUpdate/default-github-latest-yml');

  return {
    provider: 'generic',
    upstreamProvider: githubPublish.provider ? 'github' : String(genericPublish.provider || legacyConfig.provider || 'github').trim().toLowerCase(),
    owner,
    repo,
    releaseType,
    channel,
    channelFile,
    feedBaseUrl,
    feedUrl,
    source,
    configured: Boolean(feedUrlOverride || feedBaseUrlOverride || githubPublish.provider || genericPublish.provider || legacyConfig.provider),
    usesAtomFeed: false,
  };
}

function redactSensitiveText(value) {
  let text = String(value || '');
  for (const pattern of SENSITIVE_TEXT_PATTERNS) {
    text = text.replace(pattern, (match, prefix) => {
      if (typeof prefix !== 'string') return '[redacted]';
      if (prefix.startsWith('?')) return `${prefix}[redacted]`;
      if (prefix.includes('=')) return `${prefix}[redacted]`;
      if (/^(Bearer|token)$/i.test(prefix)) return `${prefix} [redacted]`;
      return `${prefix}[redacted]`;
    });
  }
  return text;
}

function sanitizeUrlForLog(value) {
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = '[redacted]';
    if (parsed.password) parsed.password = '[redacted]';
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEY_PATTERN.test(key) || SENSITIVE_LOG_KEY_PATTERN.test(key)) parsed.searchParams.set(key, '[redacted]');
    }
    return redactSensitiveText(parsed.toString());
  } catch (_) {
    return redactSensitiveText(value);
  }
}

function sanitizeForPublic(value) {
  return sanitizeForLog(value);
}

function sanitizeForLog(value, key = '') {
  if (SENSITIVE_LOG_KEY_PATTERN.test(String(key))) return '[redacted]';
  if (value instanceof Error) {
    return {
      name: value.name,
      code: value.code,
      statusCode: value.statusCode,
      message: sanitizeForLog(value.message, 'message'),
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
    provider: 'generic-github-latest-yml',
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

function getHttpStatusCode(err) {
  const candidates = [
    err?.statusCode,
    err?.status,
    err?.response?.statusCode,
    err?.response?.status,
    err?.cause?.statusCode,
    err?.cause?.status,
  ];

  for (const value of candidates) {
    const statusCode = Number(value);
    if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599) return statusCode;
  }

  const message = String(err?.message || err || '');
  const match = /\b(401|403|404|429|500|502|503|504)\b/.exec(message);
  return match ? Number(match[1]) : 0;
}

function getUpdateRuntimeDiagnostics(app) {
  const resourcesPath = String(process.resourcesPath || '').trim();
  const appUpdateYmlPath = resourcesPath ? path.join(resourcesPath, 'app-update.yml') : '';
  return {
    isPackaged: Boolean(app.isPackaged),
    defaultApp: Boolean(process.defaultApp),
    execPath: process.execPath,
    resourcesPath,
    appUpdateYmlPath,
    appUpdateYmlExists: appUpdateYmlPath ? fs.existsSync(appUpdateYmlPath) : false,
    portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR ? '[set]' : '',
    portableExecutableFile: process.env.PORTABLE_EXECUTABLE_FILE ? '[set]' : '',
  };
}

function classifyUpdaterError(err, context = {}) {
  const updaterCode = String(err?.code || '').trim();
  const rawMessage = String(err?.message || err || 'electron-updater báo lỗi không xác định.').trim();
  const originalMessage = sanitizeForLog(rawMessage || 'electron-updater báo lỗi không xác định.');
  const lowerMessage = rawMessage.toLowerCase();
  const httpStatusCode = getHttpStatusCode(err);
  const phase = String(context.phase || 'unknown');
  let code = updaterCode || context.fallbackCode || 'ELECTRON_UPDATER_ERROR';
  let message = originalMessage || 'electron-updater báo lỗi không xác định.';
  let hint = '';

  if (httpStatusCode === 429 || /rate limit|too many requests|secondary rate/.test(lowerMessage)) {
    code = 'UPDATE_FEED_RATE_LIMITED';
    message = 'GitHub đang giới hạn tần suất truy cập metadata hoặc asset cập nhật.';
    hint = 'Thử lại sau, kiểm tra mạng/proxy. Không hard-code token vào app khách chỉ để né rate limit; nếu cần hãy dùng kênh update public ổn định.';
  } else if (/releases\.atom/.test(lowerMessage)) {
    code = 'UPDATE_GITHUB_ATOM_FEED_NOT_AVAILABLE';
    message = 'Endpoint GitHub releases.atom không khả dụng hoặc không phù hợp cho repo/update feed này. Ứng dụng cần đọc trực tiếp latest.yml public thay vì phụ thuộc Atom feed.';
    hint = 'Bản mới đã cấu hình generic latest.yml. Nếu lỗi này vẫn xuất hiện, máy đang chạy bản cũ hoặc app-update.yml/provider vẫn là github thay vì generic.';
  } else if (httpStatusCode === 401 || httpStatusCode === 403 || /unauthorized|forbidden|bad credentials|requires authentication/.test(lowerMessage)) {
    code = 'UPDATE_FEED_UNAUTHORIZED_OR_PRIVATE';
    message = 'Không có quyền truy cập GitHub Release cập nhật. Repo/release có thể private, token sai/thiếu quyền, hoặc asset/feed yêu cầu xác thực.';
    hint = 'Máy khách Electron không được nhúng GitHub token. Hãy dùng release/feed public hoặc kênh update public riêng; nếu publish bằng CI, kiểm tra token chỉ nằm trong GitHub Actions secrets.';
  } else if (httpStatusCode === 404 || updaterCode === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' || /not found|unable to find latest version|cannot find .*latest\.yml|cannot find latest\.yml|channel .* update info/.test(lowerMessage)) {
    if (phase === 'download') {
      code = 'UPDATE_ASSET_NOT_ACCESSIBLE_OR_PRIVATE';
      message = 'Không tải được installer/blockmap từ GitHub Release. Asset có thể thiếu, tên file không khớp latest.yml, repo private trả 404, hoặc URL asset sai.';
      hint = 'Kiểm tra asset installer, .blockmap và latest.yml trong release latest; thử mở URL tải bằng trình duyệt ẩn danh không đăng nhập GitHub.';
    } else if (updaterCode === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' || /latest\.yml|channel .* update info/.test(lowerMessage)) {
      code = 'UPDATE_FEED_METADATA_NOT_FOUND';
      message = 'Không tìm thấy latest.yml trong GitHub Release latest. electron-updater cần asset latest.yml public để phát hiện bản mới.';
      hint = 'Kiểm tra release latest có asset latest.yml, version/path/sha512 hợp lệ, release không phải draft/prerelease ngoài kênh production và URL /releases/latest/download/latest.yml trả 200 khi mở ẩn danh.';
    } else {
      code = 'UPDATE_REPOSITORY_NOT_ACCESSIBLE';
      message = 'Không truy cập được GitHub Release latest của repo cập nhật. Repo có thể private, owner/repo sai, URL feed sai, hoặc chưa có production release public/latest.';
      hint = 'Mở releases/latest và latest.yml bằng trình duyệt ẩn danh. Nếu trả 404, client Electron không thể tự cập nhật từ feed đó.';
    }
  } else if (updaterCode === 'ERR_UPDATER_ASSET_NOT_FOUND') {
    code = 'UPDATE_ASSET_NOT_ACCESSIBLE_OR_PRIVATE';
    message = 'latest.yml trỏ tới asset không tồn tại trong GitHub Release hoặc tên asset không khớp.';
    hint = 'Upload lại installer .exe và .exe.blockmap đúng tên trong latest.yml, hoặc build lại release bằng electron-builder.';
  } else if (updaterCode === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' || /no published versions/.test(lowerMessage)) {
    code = 'UPDATE_RELEASE_NOT_PUBLISHED';
    message = 'GitHub chưa có production release đã publish để chọn làm latest.';
    hint = 'Đảm bảo release không ở draft, không bị đánh dấu prerelease nếu app không bật allowPrerelease, và make_latest=true khi publish.';
  } else if (/net::|enotfound|econnreset|econnrefused|etimedout|network|timeout|timed out|certificate|tls/.test(lowerMessage)) {
    code = 'UPDATE_NETWORK_ERROR';
    message = 'Không kết nối được tới GitHub Releases để kiểm tra hoặc tải cập nhật.';
    hint = 'Kiểm tra Internet, DNS, proxy/firewall, chứng chỉ TLS và thử mở URL latest.yml ngoài trình duyệt.';
  } else if (!updaterCode && context.fallbackCode) {
    code = context.fallbackCode;
  }

  return {
    code,
    message,
    details: sanitizeForLog({
      phase,
      updaterCode,
      httpStatusCode: httpStatusCode || undefined,
      originalMessage,
      feedUrl: context.feedUrl,
      feedBaseUrl: context.feedBaseUrl,
      owner: context.owner,
      repo: context.repo,
      releaseType: context.releaseType,
      usesAtomFeed: Boolean(context.usesAtomFeed),
      hint,
    }),
  };
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
    feedUpstreamProvider: feed.upstreamProvider,
    feedOwner: feed.owner,
    feedRepo: feed.repo,
    feedBaseUrl: feed.feedBaseUrl,
    feedUrl: feed.feedUrl,
    feedSource: feed.source,
    feedUsesAtomFeed: feed.usesAtomFeed,
    manifestUrl: feed.feedUrl,
    manifestSource: feed.source,
    manifestUrlConfigured: feed.configured,
    manifestUrlDefault: !feed.configured,
    defaultManifestUrl: joinUrl(buildGitHubLatestDownloadBaseUrl(feed.owner, feed.repo), getChannelFileName(feed.channel)),
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
      feedUpstreamProvider: state.feedUpstreamProvider,
      feedOwner: state.feedOwner,
      feedRepo: state.feedRepo,
      feedBaseUrl: sanitizeForPublic(state.feedBaseUrl),
      feedUrl: sanitizeForPublic(state.feedUrl),
      feedSource: state.feedSource,
      feedUsesAtomFeed: state.feedUsesAtomFeed,
      manifestUrl: sanitizeForPublic(state.manifestUrl),
      manifestSource: state.manifestSource,
      manifestUrlConfigured: state.manifestUrlConfigured,
      manifestUrlDefault: state.manifestUrlDefault,
      defaultManifestUrl: sanitizeForPublic(state.defaultManifestUrl),
      updateLogPath: state.updateLogPath,
      status: state.status,
      updateAvailable: state.updateAvailable,
      updateInfo: sanitizeForPublic(state.updateInfo),
      progress: state.progress,
      downloadedFile: sanitizeForPublic(state.downloadedFile),
      downloadedSha256: state.downloadedSha256,
      downloadedSha512: state.downloadedSha512,
      backupPath: sanitizeForPublic(state.backupPath),
      lastCheckedAt: state.lastCheckedAt,
      lastError: sanitizeForPublic(state.lastError),
      devUpdateForced: state.devUpdateForced,
      runtimeDiagnostics: sanitizeForPublic(getUpdateRuntimeDiagnostics(app)),
    };
  }

  function setClassifiedError(err, context = {}) {
    const classified = classifyUpdaterError(err, {
      feedUrl: state.feedUrl,
      feedBaseUrl: state.feedBaseUrl,
      owner: feed.owner,
      repo: feed.repo,
      releaseType: feed.releaseType,
      usesAtomFeed: feed.usesAtomFeed,
      ...context,
    });
    state.lastError = classified;
    return classified;
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
      provider: 'generic',
      url: feed.feedBaseUrl,
      ...(feed.channel && feed.channel !== DEFAULT_UPDATE_CHANNEL ? { channel: feed.channel } : {}),
    });

    logger.info('Đã cấu hình electron-updater đọc trực tiếp GitHub Release latest.yml, không phụ thuộc releases.atom', {
      provider: feed.provider,
      upstreamProvider: feed.upstreamProvider,
      owner: feed.owner,
      repo: feed.repo,
      feedBaseUrl: feed.feedBaseUrl,
      feedUrl: feed.feedUrl,
      channel: feed.channel,
      channelFile: feed.channelFile,
      appVersion: state.currentVersion,
      isPackaged: app.isPackaged,
      devUpdateForced: state.devUpdateForced,
      autoDownload: autoUpdater.autoDownload,
      autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
      runtimeDiagnostics: getUpdateRuntimeDiagnostics(app),
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
      state.lastError = sanitizeForPublic({ code: err.code || 'INSTALL_FAILED', message: err.message, details: err.details });
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

      const previousStatus = state.status;
      state.status = 'error';
      state.lastError = setClassifiedError(err, {
        phase: previousStatus === 'downloading' || currentDownloadPromise ? 'download' : 'check',
        fallbackCode: 'ELECTRON_UPDATER_ERROR',
      });
      logger.error('electron-updater báo lỗi, ứng dụng tiếp tục chạy', {
        classified: state.lastError,
        error: err,
      });
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
        state.lastError = sanitizeForPublic({ code: err.code, message: err.message });
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
        state.lastError = setClassifiedError(err, { phase: 'check', fallbackCode: 'CHECK_FAILED' });
        logger.error('Kiểm tra cập nhật thất bại, ứng dụng tiếp tục chạy', {
          classified: state.lastError,
          error: err,
        });
        if (!silent) emit('error', { error: state.lastError }, { silent: false });
        return failure(state.lastError, getPublicState());
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
      state.lastError = setClassifiedError(err, { phase: 'download', fallbackCode: 'DOWNLOAD_FAILED' });
      logger.error('Tải cập nhật thất bại, ứng dụng tiếp tục chạy', {
        classified: state.lastError,
        error: err,
      });
      emit('error', { error: state.lastError }, { silent });
      return failure(state.lastError, getPublicState());
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
        state.lastError = setClassifiedError(err, { phase: 'startup-check', fallbackCode: 'STARTUP_CHECK_FAILED' });
        logger.error('Startup update check lỗi ngoài luồng xử lý chính', {
          classified: state.lastError,
          error: err,
        });
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

