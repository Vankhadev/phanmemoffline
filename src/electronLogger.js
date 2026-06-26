/**
 * Electron file logger (PHẦN 13.3). Ghi log main process vào logs/electron.log.
 * KHÔNG log mật khẩu/token.
 */
const fs = require('fs');
const path = require('path');
const LOG_DIR = path.resolve(process.env.KHA_LOG_DIR || path.join(__dirname, '..', 'logs'));
const LOG_FILE = path.join(LOG_DIR, 'electron.log');
const MAX_LOG_BYTES = 10 * 1024 * 1024;
let initialized = false;
function ensureDir() { try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {} }
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
function write(level, msg, meta) {
  if (!initialized) { ensureDir(); initialized = true; }
  const ts = new Date().toISOString();
  let line = `[${ts}] [${level}] ${msg}`;
  if (meta && Object.keys(meta).length) { try { line += ' ' + JSON.stringify(meta); } catch (_) {} }
  if (level === 'error') console.error(line); else console.log(line);
  try { rotateIfNeeded(); fs.appendFileSync(LOG_FILE, line + '\n', 'utf8'); } catch (_) {}
}
module.exports = {
  info: (m, x) => write('info', m, x),
  warn: (m, x) => write('warn', m, x),
  error: (m, x) => write('error', m, x),
  LOG_FILE, LOG_DIR,
};
