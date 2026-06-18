const fs = require('fs');
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
