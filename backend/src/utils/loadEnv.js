const fs = require('fs');
const path = require('path');

let hasLoadedEnv = false;
let loadedEnvFiles = [];

function uniqueTruthyPaths(paths = []) {
  const seen = new Set();
  const result = [];

  for (const candidate of paths) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;
    const resolved = path.resolve(raw);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }

  return result;
}

function buildCandidateEnvPaths() {
  const backendEnvPath = path.resolve(__dirname, '..', '..', '.env');
  return uniqueTruthyPaths([
    process.env.KHA_ENV_FILE,
    process.env.ENV_FILE,
    process.env.DOTENV_CONFIG_PATH,
    backendEnvPath,
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '..', '..', '.env'),
  ]);
}

function loadEnv(options = {}) {
  const force = options.force === true;
  if (hasLoadedEnv && !force) {
    return { ok: true, loaded: loadedEnvFiles.length > 0, files: [...loadedEnvFiles] };
  }

  hasLoadedEnv = true;
  if (force) loadedEnvFiles = [];

  let dotenv = null;
  try {
    dotenv = require('dotenv');
  } catch (error) {
    return { ok: false, loaded: false, files: [], error: error.message };
  }

  const loadedNow = [];
  for (const envPath of buildCandidateEnvPaths()) {
    try {
      if (!fs.existsSync(envPath)) continue;
      dotenv.config({ path: envPath, override: options.override === true });
      loadedNow.push(envPath);
    } catch (error) {
      if (options.logErrors === true) {
        console.warn(`[KHA ENV] Không thể đọc file .env ${envPath}: ${error.message}`);
      }
    }
  }

  loadedEnvFiles = uniqueTruthyPaths([...loadedEnvFiles, ...loadedNow]);
  return { ok: true, loaded: loadedEnvFiles.length > 0, files: [...loadedEnvFiles] };
}

function getLoadedEnvFiles() {
  return [...loadedEnvFiles];
}

module.exports = {
  buildCandidateEnvPaths,
  getLoadedEnvFiles,
  loadEnv,
};
