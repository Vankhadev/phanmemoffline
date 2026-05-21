#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword } = require('../src/utils/password');

function parseArgs(argv = []) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = String(argv[index] || '');
    if (!current.startsWith('--')) continue;
    const trimmed = current.slice(2);
    if (!trimmed) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex >= 0) {
      const key = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);
      result[key] = value;
      continue;
    }

    const next = argv[index + 1];
    if (next !== undefined && !String(next).startsWith('--')) {
      result[trimmed] = String(next);
      index += 1;
      continue;
    }

    result[trimmed] = true;
  }
  return result;
}

function resolveDbPath(args = {}) {
  const candidate = args.db || process.env.KHA_DB_PATH || process.env.DB_PATH || process.env.DATABASE_PATH;
  if (candidate) return path.resolve(candidate);
  return path.resolve(__dirname, '..', 'data', 'phanmienoffline.db.json');
}

function now() {
  return new Date().toISOString();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase() === 'admin' ? 'admin' : 'user';
}

function ensureArray(target, key) {
  if (!Array.isArray(target[key])) target[key] = [];
}

function ensureObject(target, key) {
  if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
}

function ensureDefaultAccount(db) {
  ensureArray(db, 'accounts');
  ensureObject(db, 'nextId');
  if (!Number.isInteger(Number(db.nextId.accounts)) || Number(db.nextId.accounts) <= 0) db.nextId.accounts = 1;

  let account = db.accounts.find(item => item && item.slug === 'default' && !item.deleted_at)
    || db.accounts.find(item => item && !item.deleted_at)
    || null;

  if (account) return account;

  const timestamp = now();
  const id = Number(db.nextId.accounts) || 1;
  db.nextId.accounts = id + 1;
  account = {
    id,
    slug: 'default',
    name: 'Tài khoản mặc định',
    status: 'active',
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.accounts.push(account);
  return account;
}

function ensureNextId(db, table, fallback = 1) {
  ensureObject(db, 'nextId');
  const current = Number(db.nextId[table]);
  if (Number.isInteger(current) && current > 0) return current;
  db.nextId[table] = fallback;
  return fallback;
}

function computeNextId(rows = [], fallback = 1) {
  const maxId = rows.reduce((max, item) => Math.max(max, Number(item && item.id) || 0), 0);
  return Math.max(fallback, maxId + 1);
}

function generatePassword(length = 18) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=';
  const bytes = crypto.randomBytes(Math.max(16, length * 2));
  let password = '';
  for (let index = 0; index < bytes.length && password.length < length; index += 1) {
    password += alphabet[bytes[index] % alphabet.length];
  }
  return password;
}

function loadDb(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = raw.trim() ? JSON.parse(raw) : {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Database JSON không hợp lệ.');
  }
  return parsed;
}

function saveDb(filePath, db) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
}

function revokeUserSessions(db, userId, timestamp) {
  ensureArray(db, 'sessions');
  let revoked = 0;
  db.sessions = db.sessions.map(session => {
    if (Number(session && session.user_id) !== Number(userId)) return session;
    revoked += 1;
    return {
      ...session,
      revoked_at: timestamp,
      updated_at: timestamp,
    };
  });
  return revoked;
}

function resetLocalAdmin(options = {}) {
  const dbPath = resolveDbPath(options.args);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Không tìm thấy database tại ${dbPath}`);
  }

  const db = loadDb(dbPath);
  ensureArray(db, 'users');
  ensureArray(db, 'sessions');
  ensureObject(db, 'nextId');

  const account = ensureDefaultAccount(db);
  const timestamp = now();
  const requestedEmail = normalizeEmail(options.email || 'admin.local@example.com');
  const requestedPassword = String(options.password || generatePassword()).trim();
  const requestedName = String(options.name || 'Local Admin').trim() || 'Local Admin';
  const requestedPhone = String(options.phone || '0900000000').trim() || '0900000000';

  if (requestedPassword.length < 6) {
    throw new Error('Mật khẩu phải có ít nhất 6 ký tự.');
  }

  const adminCandidates = db.users.filter(user => user && normalizeRole(user.role) === 'admin');
  let user = db.users.find(item => normalizeEmail(item && item.email) === requestedEmail)
    || adminCandidates.find(item => item && item.active !== 0)
    || adminCandidates[0]
    || null;

  const action = user ? 'updated' : 'created';
  let userId = Number(user && user.id) || 0;

  if (!user) {
    const nextId = Math.max(ensureNextId(db, 'users', 1), computeNextId(db.users, 1));
    userId = nextId;
    db.nextId.users = nextId + 1;
    user = {
      id: userId,
      account_id: account.id,
      name: requestedName,
      email: requestedEmail,
      phone: requestedPhone,
      password: hashPassword(requestedPassword),
      role: 'admin',
      approved: 1,
      active: 1,
      created_at: timestamp,
      updated_at: timestamp,
      session_token: null,
      last_login: null,
    };
    db.users.push(user);
  } else {
    user.account_id = user.account_id == null ? account.id : user.account_id;
    user.name = requestedName;
    user.email = requestedEmail;
    user.phone = requestedPhone;
    user.password = hashPassword(requestedPassword);
    user.role = 'admin';
    user.approved = 1;
    user.active = 1;
    user.updated_at = timestamp;
    user.session_token = null;
    userId = Number(user.id) || userId;
  }

  const revokedSessions = revokeUserSessions(db, userId, timestamp);
  db.nextId.users = Math.max(ensureNextId(db, 'users', 1), computeNextId(db.users, 1));
  db.nextId.sessions = Math.max(ensureNextId(db, 'sessions', 1), computeNextId(db.sessions, 1));
  saveDb(dbPath, db);

  return {
    action,
    dbPath,
    email: requestedEmail,
    password: requestedPassword,
    name: requestedName,
    phone: requestedPhone,
    userId,
    accountId: account.id,
    revokedSessions,
  };
}

function printUsage() {
  console.log('Usage: node backend/scripts/reset-local-admin.js --yes [--email admin@example.com] [--password Admin@123456] [--name "Local Admin"] [--phone 0900000000] [--db path-to-db.json]');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    process.exit(0);
  }

  if (args.yes !== true) {
    console.error('[KHA DEV AUTH] Từ chối chạy vì thiếu cờ xác nhận --yes.');
    printUsage();
    process.exit(1);
  }

  const result = resetLocalAdmin({
    args,
    email: args.email,
    password: args.password,
    name: args.name,
    phone: args.phone,
  });

  console.log('[KHA DEV AUTH] Local admin đã được cập nhật thành công.');
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (error) {
  console.error('[KHA DEV AUTH] Reset local admin thất bại:', error && error.message ? error.message : error);
  process.exit(1);
}
