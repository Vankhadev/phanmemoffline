/**
 * File logger (PHẦN 13). Ghi log backend vào logs/app.log.
 * KHÔNG log mật khẩu/token. Tự xoay vòng khi file quá lớn.
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.resolve(process.env.KHA_LOG_DIR || path.join(__dirname, '..', '..', '..', 'logs'));
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const MAX_LOG_BYTES = 10 * 1024 * 1024; // 10MB
let initialized = false;

function ensureDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
}

function rotateIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_LOG_BYTES) {
      const rotated = LOG_FILE + '.' + new Date().toISOString().replace(/[:.]/g, '-') + '.bak';
      try { fs.renameSync(LOG_FILE, rotated); } catch (_) {}
    }
  } catch (_) {}
}

function format(level, msg, meta) {
  const ts = new Date().toISOString();
  let line = `[${ts}] [${level}] ${msg}`;
  if (meta && Object.keys(meta).length) {
    try { line += ' ' + JSON.stringify(meta); } catch (_) {}
  }
  return line;
}

function write(level, msg, meta) {
  if (!initialized) { ensureDir(); initialized = true; }
  const line = format(level, msg, meta);
  // In ra console luôn
  if (level === 'error') console.error(line);
  else console.log(line);
  try {
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (_) {}
}

module.exports = {
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
  debug: (msg, meta) => { if (process.env.KHA_LOG_DEBUG === '1') write('debug', msg, meta); },
  LOG_FILE,
  LOG_DIR,
};
