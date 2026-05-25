#!/usr/bin/env node
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(ROOT_DIR, 'package.json');
const RELEASE_DIR = path.resolve(ROOT_DIR, process.env.KHA_RELEASE_DIR || 'release');
const LATEST_YML_PATH = path.join(RELEASE_DIR, process.env.KHA_LATEST_YML_FILE || 'latest.yml');
const DEFAULT_WINDOWS_ARCHS = ['x64', 'ia32'];
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function fail(message) {
  console.error(`[generate-latest-yml] ${message}`);
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

async function sha512FileBase64(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

function yamlQuote(value) {
  const text = String(value || '');
  return `'${text.replace(/'/g, "''")}'`;
}

async function createFileEntry({ packageJson, version, arch, artifactTemplate }) {
  const explicitPath = process.env[`KHA_UPDATE_INSTALLER_${arch.toUpperCase()}`] || '';
  const installerPath = explicitPath
    ? path.resolve(ROOT_DIR, explicitPath)
    : path.join(RELEASE_DIR, renderArtifactName(artifactTemplate, packageJson, version, arch));

  if (!fs.existsSync(installerPath)) {
    return {
      arch,
      missing: true,
      installerPath,
    };
  }

  const stat = await fsp.stat(installerPath);
  if (!stat.isFile()) fail(`Installer không phải file hợp lệ: ${installerPath}`);

  return {
    arch,
    fileName: path.basename(installerPath),
    size: stat.size,
    sha512: await sha512FileBase64(installerPath),
    missing: false,
    installerPath,
  };
}

function chooseDefaultEntry(entries) {
  const preferredArch = normalizeArch(process.env.KHA_UPDATE_DEFAULT_ARCH || process.env.KHA_UPDATE_ARCH || 'x64');
  return entries.find(item => item.arch === preferredArch)
    || entries.find(item => item.arch === 'x64')
    || entries[0];
}

async function main() {
  const packageJson = readJson(PACKAGE_PATH);
  const version = normalizeVersion(packageJson.version);
  if (!SEMVER_PATTERN.test(version)) fail(`Version trong package.json không hợp lệ: ${packageJson.version}`);

  const artifactTemplate = packageJson.build?.nsis?.artifactName || 'banhangoffline-setup-v${version}-${arch}.exe';
  const archs = collectConfiguredWindowsArchs(packageJson);
  const allowMissingArch = ['1', 'true', 'yes', 'y'].includes(String(process.env.KHA_UPDATE_ALLOW_MISSING_ARCH || '').trim().toLowerCase());
  const releaseDate = String(process.env.KHA_RELEASE_DATE || new Date().toISOString()).trim();

  const results = [];
  for (const arch of archs) {
    results.push(await createFileEntry({ packageJson, version, arch, artifactTemplate }));
  }

  const missing = results.filter(item => item.missing);
  if (missing.length > 0 && !allowMissingArch) {
    fail(`Không tìm thấy installer cho kiến trúc: ${missing.map(item => `${item.arch} (${item.installerPath})`).join(', ')}. Hãy chạy npm run build:installer hoặc truyền KHA_UPDATE_ARCHS/KHA_UPDATE_INSTALLER_<ARCH>.`);
  }

  const entries = results.filter(item => !item.missing);
  if (entries.length === 0) fail('Không tìm thấy installer nào để tạo latest.yml.');

  const defaultEntry = chooseDefaultEntry(entries);
  const lines = [
    `version: ${version}`,
    'files:',
  ];

  for (const entry of entries) {
    lines.push(`  - url: ${entry.fileName}`);
    lines.push(`    sha512: ${entry.sha512}`);
    lines.push(`    size: ${entry.size}`);
  }

  lines.push(`path: ${defaultEntry.fileName}`);
  lines.push(`sha512: ${defaultEntry.sha512}`);
  lines.push(`releaseDate: ${yamlQuote(releaseDate)}`);
  lines.push('');

  await fsp.mkdir(RELEASE_DIR, { recursive: true });
  await fsp.writeFile(LATEST_YML_PATH, `${lines.join('\n')}`, 'utf8');

  console.log('[generate-latest-yml] Đã tạo latest.yml:');
  console.log(`  Version: ${version}`);
  console.log(`  Default: ${defaultEntry.fileName}`);
  for (const entry of entries) {
    console.log(`  ${entry.arch}: ${entry.fileName} (${entry.size} bytes)`);
  }
  console.log(`  Output: ${LATEST_YML_PATH}`);
}

main().catch(err => fail(err.stack || err.message));
