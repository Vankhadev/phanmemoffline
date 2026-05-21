const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const canonicalSvgPath = path.join(rootDir, 'frontend', 'public', 'icons', 'app-icon.svg');
const buildDir = path.join(rootDir, 'build');
const buildIconsDir = path.join(buildDir, 'icons');

const copyJobs = [
  {
    from: canonicalSvgPath,
    to: path.join(buildDir, 'icon.svg'),
    description: 'canonical SVG -> build/icon.svg',
  },
  {
    from: canonicalSvgPath,
    to: path.join(buildIconsDir, 'app-icon.svg'),
    description: 'canonical SVG -> build/icons/app-icon.svg',
  },
  {
    from: path.join(buildDir, 'icon.png'),
    to: path.join(buildIconsDir, 'app-icon.png'),
    description: 'desktop PNG -> build/icons/app-icon.png',
  },
  {
    from: path.join(buildDir, 'icon@2x.png'),
    to: path.join(buildIconsDir, 'app-icon@2x.png'),
    description: 'desktop 2x PNG -> build/icons/app-icon@2x.png',
  },
  {
    from: path.join(buildDir, 'icon.ico'),
    to: path.join(buildIconsDir, 'app-icon.ico'),
    description: 'desktop ICO -> build/icons/app-icon.ico',
  },
  {
    from: path.join(buildDir, 'icon.icns'),
    to: path.join(buildIconsDir, 'app-icon.icns'),
    description: 'desktop ICNS -> build/icons/app-icon.icns',
  },
];

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required icon asset: ${path.relative(rootDir, filePath)}`);
  }
}

function copyFileIfNeeded(fromPath, toPath) {
  const sourceBuffer = fs.readFileSync(fromPath);
  const targetExists = fs.existsSync(toPath);
  const targetBuffer = targetExists ? fs.readFileSync(toPath) : null;

  if (targetExists && Buffer.compare(sourceBuffer, targetBuffer) === 0) {
    return 'unchanged';
  }

  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  fs.writeFileSync(toPath, sourceBuffer);
  return targetExists ? 'updated' : 'created';
}

function syncDesktopIconAssets() {
  ensureFileExists(canonicalSvgPath);

  const results = copyJobs.map((job) => {
    ensureFileExists(job.from);
    const status = copyFileIfNeeded(job.from, job.to);
    return { ...job, status };
  });

  console.log('[desktop-icon] Canonical source:', path.relative(rootDir, canonicalSvgPath));
  for (const result of results) {
    console.log(`[desktop-icon] ${result.status.toUpperCase()}: ${result.description}`);
  }
}

try {
  syncDesktopIconAssets();
} catch (error) {
  console.error('[desktop-icon] Sync failed:', error.message);
  process.exitCode = 1;
}
