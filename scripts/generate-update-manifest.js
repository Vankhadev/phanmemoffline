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

function renderArtifactName(template, packageJson, version) {
  return String(template || 'BanHangOffline-Setup-v${version}.exe')
    .replace(/\$\{version\}/g, version)
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

async function main() {
  const packageJson = readJson(PACKAGE_PATH);
  const version = normalizeVersion(packageJson.version);
  if (!SEMVER_PATTERN.test(version)) fail(`Version trong package.json không hợp lệ: ${packageJson.version}`);

  const artifactTemplate = packageJson.build?.nsis?.artifactName || 'BanHangOffline-Setup-v${version}.exe';
  const artifactName = renderArtifactName(artifactTemplate, packageJson, version);
  const installerPath = process.env.KHA_UPDATE_INSTALLER
    ? path.resolve(ROOT_DIR, process.env.KHA_UPDATE_INSTALLER)
    : path.join(RELEASE_DIR, artifactName);

  if (!fs.existsSync(installerPath)) {
    fail(`Không tìm thấy installer: ${installerPath}. Hãy chạy npm run build hoặc truyền KHA_UPDATE_INSTALLER.`);
  }

  const stat = await fsp.stat(installerPath);
  if (!stat.isFile()) fail(`Installer không phải file hợp lệ: ${installerPath}`);

  const { assetBaseUrl } = resolveRepository(packageJson);
  const releaseTag = String(process.env.KHA_RELEASE_TAG || `v${version}`).trim();
  const sha256 = await sha256File(installerPath);
  const url = String(process.env.KHA_UPDATE_ASSET_URL || `${assetBaseUrl}/${releaseTag}/${encodeAssetName(path.basename(installerPath))}`).trim();
  const releaseNotes = String(process.env.KHA_RELEASE_NOTES || `- Cập nhật ứng dụng lên phiên bản ${version}.`).trim();
  const releaseDate = String(process.env.KHA_RELEASE_DATE || new Date().toISOString()).trim();

  const manifest = {
    version,
    url,
    sha256,
    releaseNotes,
    releaseDate,
    platform: String(process.env.KHA_UPDATE_PLATFORM || 'win32').trim(),
    arch: String(process.env.KHA_UPDATE_ARCH || 'x64').trim(),
    size: stat.size,
    mandatory: parseBoolean(process.env.KHA_UPDATE_MANDATORY, false),
    installerType: String(process.env.KHA_UPDATE_INSTALLER_TYPE || 'nsis').trim().toLowerCase(),
  };

  await fsp.mkdir(RELEASE_DIR, { recursive: true });
  await fsp.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log('[generate-update-manifest] Đã tạo manifest GitHub Release:');
  console.log(`  Version: ${manifest.version}`);
  console.log(`  Installer: ${installerPath}`);
  console.log(`  URL: ${manifest.url}`);
  console.log(`  SHA256: ${manifest.sha256}`);
  console.log(`  Size: ${manifest.size}`);
  console.log(`  Manifest: ${MANIFEST_PATH}`);
}

main().catch(err => fail(err.stack || err.message));
