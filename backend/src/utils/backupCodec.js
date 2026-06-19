const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const zlib = require('zlib');

function isCompressedBackupPath(filePath = '') {
  return String(filePath || '').toLowerCase().endsWith('.gz');
}

function stringifyBackupData(data) {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

function encodeBackupData(data) {
  const json = Buffer.from(stringifyBackupData(data), 'utf8');
  return zlib.gzipSync(json, { level: zlib.constants.Z_BEST_COMPRESSION });
}

function readBackupData(filePath) {
  if (String(filePath || '').toLowerCase().endsWith('.zip')) {
    const tempDir = fs.mkdtempSync(path.join(path.dirname(filePath), 'kha-restore-'));
    try {
      const cmd = `Expand-Archive -Path '${String(filePath).replace(/'/g, "''")}' -DestinationPath '${tempDir.replace(/'/g, "''")}' -Force`;
      const result = spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
      if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || 'Expand-Archive failed');
      }
      const jsonPath = path.join(tempDir, 'database.json');
      if (!fs.existsSync(jsonPath)) {
        throw new Error('database.json missing from backup zip');
      }
      return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } finally {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
  const raw = fs.readFileSync(filePath);
  const content = isCompressedBackupPath(filePath) || (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b)
    ? zlib.gunzipSync(raw).toString('utf8')
    : raw.toString('utf8');
  return JSON.parse(content);
}

module.exports = {
  encodeBackupData,
  isCompressedBackupPath,
  readBackupData,
};
