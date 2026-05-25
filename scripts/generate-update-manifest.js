#!/usr/bin/env node
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const RELEASE_DIR = path.resolve(ROOT_DIR, process.env.KHA_RELEASE_DIR || 'release');
const MANIFEST_PATH = path.join(RELEASE_DIR, 'update-manifest.json');
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DEFAULT_GITHUB_OWNER = 'Vankhadev';
const DEFAULT_GITHUB_REPO = 'phanmemoffline';
const DEFAULT_WINDOWS_ARCHS = ['x64', 'ia32'];
const SENSITIVE_QUERY_KEY_PATTERN = /^(token|access_token|auth|authorization|signature|x-amz-signature|x-amz-credential|x-amz-security-token)$/i;
const SENSITIVE_TEXT_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+\b/g,
  /\bgithub_pat_[A-Za-z0-9_]+\b/g,
  /\b(Bearer|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /([?&](?:token|access_token|auth|authorization|signature|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)=)[^&\s]+/gi,
];

function redactSensitiveText(value) {
  let text = String(value || '');
  for (const pattern of SENSITIVE_TEXT_PATTERNS) {
    text = text.replace(pattern, (match, prefix) => {
      if (typeof prefix !== 'string') return '[redacted]';
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
      if (SENSITIVE_QUERY_KEY_PATTERN.test(key)) parsed.searchParams.set(key, '[redacted]');
    }
    return redactSensitiveText(parsed.toString());
  } catch (_) {
    return redactSensitiveText(value);
  }
}

function fail(message) {
  console.error(`[generate-update-manifest] ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    fail(`Không đọc được JSON: ${filePath}. ${err.message}`);
  }
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

function normalizeArch(value) {
  const arch = String(value || '').trim().toLowerCase();
  if (arch === 'x86' || arch === 'win32') return 'ia32';
  if (arch === 'amd64') return 'x64';
  return arch;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseArchList(value) {
  return unique(String(value || '')
    .split(/[\s,;|]+/)
    .map(normalizeArch)
    .filter(Boolean));
}

function collectConfiguredWindowsArchs(packageJson) {
  const envArchs = parseArchList(process.env.KHA_UPDATE_ARCHS || process.env.KHA_WINDOWS_ARCHS || '');
  if (envArchs.length > 0) return envArchs;

  const archs = [];
  const targets = packageJson.build?.win?.target;
  const inspectTarget = (target) => {
    if (!target || typeof target !== 'object') return;
    if (Array.isArray(target.arch)) {
      for (const arch of target.arch) archs.push(normalizeArch(arch));
    }
  };

  if (Array.isArray(targets)) {
    for (const target of targets) inspectTarget(target);
  } else {
    inspectTarget(targets);
  }

  if (archs.length > 0) return unique(archs);

  const packageArchs = Array.isArray(packageJson.khaUpdate?.supportedWindowsArch)
    ? packageJson.khaUpdate.supportedWindowsArch.map(normalizeArch)
    : [];
  if (packageArchs.length > 0) return unique(packageArchs);

  return DEFAULT_WINDOWS_ARCHS;
}

function renderArtifactName(template, packageJson, version, arch) {
  return String(template || 'banhangoffline-setup-v${version}-${arch}.exe')
    .replace(/\$\{version\}/g, version)
    .replace(/\$\{arch\}/g, arch)
    .replace(/\$\{name\}/g, packageJson.name || 'app')
    .replace(/\$\{productName\}/g, packageJson.build?.productName || packageJson.name || 'app');
}

function resolveRepository(packageJson) {
  const envRepository = String(process.env.KHA_UPDATE_REPOSITORY || '').trim();
  const [envOwnerFromRepository, envRepoFromRepository] = envRepository.includes('/') ? envRepository.split('/', 2) : [];
  const updateConfig = packageJson.khaUpdate && typeof packageJson.khaUpdate === 'object' ? packageJson.khaUpdate : {};

  const owner = String(process.env.KHA_UPDATE_OWNER || envOwnerFromRepository || updateConfig.owner || DEFAULT_GITHUB_OWNER).trim();
  const repo = String(process.env.KHA_UPDATE_REPO || envRepoFromRepository || updateConfig.repo || DEFAULT_GITHUB_REPO).trim();
  const assetBaseUrl = String(
    process.env.KHA_UPDATE_ASSET_BASE_URL
      || updateConfig.assetBaseUrl
      || `https://github.com/${owner}/${repo}/releases/download`,
  ).trim().replace(/\/+$/, '');

  if (!owner || !repo) fail('Thiếu owner/repo GitHub. Cấu hình package.json:khaUpdate hoặc biến KHA_UPDATE_OWNER/KHA_UPDATE_REPO.');

  return { owner, repo, assetBaseUrl };
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

function encodeAssetName(fileName) {
  return fileName.split('/').map(part => encodeURIComponent(part)).join('/');
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'y'].includes(String(value).trim().toLowerCase());
}

function deriveInstallerPath({ packageJson, version, arch, artifactTemplate, explicitPath }) {
  if (explicitPath) return path.resolve(ROOT_DIR, explicitPath);
  const artifactName = renderArtifactName(artifactTemplate, packageJson, version, arch);
  return path.join(RELEASE_DIR, artifactName);
}

async function createInstallerEntry({ packageJson, version, arch, artifactTemplate, assetBaseUrl, releaseTag, releaseDate }) {
  const explicitPath = process.env[`KHA_UPDATE_INSTALLER_${arch.toUpperCase()}`] || '';
  const installerPath = deriveInstallerPath({ packageJson, version, arch, artifactTemplate, explicitPath });

  if (!fs.existsSync(installerPath)) {
    return {
      arch,
      missing: true,
      installerPath,
    };
  }

  const stat = await fsp.stat(installerPath);
  if (!stat.isFile()) fail(`Installer không phải file hợp lệ: ${installerPath}`);

  const fileName = path.basename(installerPath);
  const urlOverride = process.env[`KHA_UPDATE_ASSET_URL_${arch.toUpperCase()}`] || '';
  const url = String(urlOverride || `${assetBaseUrl}/${releaseTag}/${encodeAssetName(fileName)}`).trim();

  return {
    arch,
    platform: String(process.env.KHA_UPDATE_PLATFORM || 'win32').trim(),
    fileName,
    url,
    sha256: await sha256File(installerPath),
    size: stat.size,
    installerType: String(process.env.KHA_UPDATE_INSTALLER_TYPE || 'nsis').trim().toLowerCase(),
    releaseDate,
    missing: false,
    installerPath,
  };
}

function chooseDefaultInstaller(installers) {
  const preferredArch = normalizeArch(process.env.KHA_UPDATE_DEFAULT_ARCH || process.env.KHA_UPDATE_ARCH || 'x64');
  return installers.find(item => item.arch === preferredArch)
    || installers.find(item => item.arch === 'x64')
    || installers[0];
}

async function main() {
  const packageJson = readJson(PACKAGE_PATH);
  const version = normalizeVersion(packageJson.version);
  if (!SEMVER_PATTERN.test(version)) fail(`Version trong package.json không hợp lệ: ${packageJson.version}`);

  const artifactTemplate = packageJson.build?.nsis?.artifactName || 'banhangoffline-setup-v${version}-${arch}.exe';
  const archs = collectConfiguredWindowsArchs(packageJson);
  const { assetBaseUrl } = resolveRepository(packageJson);
  const releaseTag = String(process.env.KHA_RELEASE_TAG || `v${version}`).trim();
  const releaseNotes = String(process.env.KHA_RELEASE_NOTES || `- Cập nhật ứng dụng lên phiên bản ${version}.\n- Có bộ cài riêng cho Windows x64 và Windows 32-bit (ia32).`).trim();
  const releaseDate = String(process.env.KHA_RELEASE_DATE || new Date().toISOString()).trim();
  const allowMissingArch = parseBoolean(process.env.KHA_UPDATE_ALLOW_MISSING_ARCH, false);

  const installerResults = [];
  for (const arch of archs) {
    installerResults.push(await createInstallerEntry({ packageJson, version, arch, artifactTemplate, assetBaseUrl, releaseTag, releaseDate }));
  }

  const missing = installerResults.filter(item => item.missing);
  if (missing.length > 0 && !allowMissingArch) {
    fail(`Không tìm thấy installer cho kiến trúc: ${missing.map(item => `${item.arch} (${item.installerPath})`).join(', ')}. Hãy chạy npm run build:installer hoặc truyền KHA_UPDATE_ARCHS/KHA_UPDATE_INSTALLER_<ARCH>.`);
  }

  const installers = installerResults.filter(item => !item.missing);
  if (installers.length === 0) fail('Không tìm thấy installer nào để tạo manifest.');

  const defaultInstaller = chooseDefaultInstaller(installers);
  const installersByArch = installers.reduce((output, item) => {
    output[item.arch] = {
      platform: item.platform,
      arch: item.arch,
      fileName: item.fileName,
      url: item.url,
      sha256: item.sha256,
      size: item.size,
      installerType: item.installerType,
    };
    return output;
  }, {});

  const manifest = {
    version,
    url: defaultInstaller.url,
    sha256: defaultInstaller.sha256,
    releaseNotes,
    releaseDate,
    platform: defaultInstaller.platform,
    arch: defaultInstaller.arch,
    size: defaultInstaller.size,
    mandatory: parseBoolean(process.env.KHA_UPDATE_MANDATORY, false),
    installerType: defaultInstaller.installerType,
    supportedArch: installers.map(item => item.arch),
    installers: installersByArch,
  };

  await fsp.mkdir(RELEASE_DIR, { recursive: true });
  await fsp.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log('[generate-update-manifest] Đã tạo manifest GitHub Release:');
  console.log(`  Version: ${manifest.version}`);
  console.log(`  Default arch: ${manifest.arch}`);
  for (const installer of installers) {
    console.log(`  Installer ${installer.arch}: ${installer.installerPath}`);
    console.log(`    URL: ${sanitizeUrlForLog(installer.url)}`);
    console.log(`    SHA256: ${installer.sha256}`);
    console.log(`    Size: ${installer.size}`);
  }
  console.log(`  Manifest: ${MANIFEST_PATH}`);
}

main().catch(err => fail(err.stack || err.message));
