const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MINIMUM_SAFETY_SCORE = 70;
const ADMISSION_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const GRANT_TTL_MS = 2 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 3;

const admissions = new Map();
const challenges = new Map();
const grants = new Map();

function opaqueId(prefix) {
  return `${prefix}_${crypto.randomBytes(18).toString('base64url')}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function timingSafeEquals(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isLocalRequest(req) {
  const address = String(req?.socket?.remoteAddress || req?.ip || '').replace(/^::ffff:/, '');
  return address === '127.0.0.1' || address === '::1';
}

function getStateDir(dbModule) {
  return path.join(path.dirname(dbModule.DB_PATH), 'data-guardian');
}

function getCodeFile(dbModule) {
  return path.join(getStateDir(dbModule), '.local-approval-code');
}

function getQuarantineDir(dbModule) {
  return path.join(getStateDir(dbModule), 'quarantine');
}

function getLocalCodeDigest(dbModule) {
  const codeFile = getCodeFile(dbModule);
  try {
    const existing = fs.readFileSync(codeFile, 'utf8').trim();
    if (/^[a-f0-9]{64}$/i.test(existing)) return existing;
  } catch (_) {}

  // Provisioning is explicit. A missing code must block recovery rather than
  // silently create an unknown or predictable bypass credential.
  const configuredCode = String(process.env.KHA_GUARDIAN_LOCAL_CODE || '').trim();
  if (configuredCode.length < 12) {
    throw Object.assign(new Error('Chưa cấu hình mã bảo vệ cục bộ tối thiểu 12 ký tự.'), { statusCode: 503 });
  }
  const codeHash = digest(configuredCode);
  fs.mkdirSync(path.dirname(codeFile), { recursive: true });
  fs.writeFileSync(codeFile, `${codeHash}\n`, { encoding: 'utf8', mode: 0o600 });
  return codeHash;
}

function pruneExpired() {
  const now = Date.now();
  for (const store of [admissions, challenges, grants]) {
    for (const [id, item] of store) if (item.expiresAt <= now || item.used) store.delete(id);
  }
}

function isInsideDirectory(filePath, directory) {
  const resolvedPath = path.resolve(String(filePath || ''));
  const resolvedDirectory = path.resolve(directory);
  return resolvedPath.startsWith(`${resolvedDirectory}${path.sep}`);
}

function quarantine(dbModule, admission) {
  const id = opaqueId('quarantine');
  const destination = path.join(getQuarantineDir(dbModule), `${id}.json`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify({
    id,
    createdAt: new Date().toISOString(),
    source: path.basename(admission.backupPath),
    sha256: admission.sha256,
    score: admission.safetyScore,
    reasons: admission.reasons,
  }, null, 2), { encoding: 'utf8', mode: 0o600 });
  return id;
}

function inspectBackup(dbModule, backupPath, actor = {}) {
  pruneExpired();
  if (!dbModule?.DB_BACKUP_DIR || !backupPath) throw Object.assign(new Error('Thiếu backup hoặc Data Guardian chưa sẵn sàng.'), { statusCode: 400 });
  if (!isInsideDirectory(backupPath, dbModule.DB_BACKUP_DIR)) {
    throw Object.assign(new Error('Chỉ chấp nhận backup trong thư mục bảo vệ của phần mềm.'), { statusCode: 403 });
  }

  const resolvedPath = path.resolve(backupPath);
  const reasons = [];
  let verified;
  try {
    verified = dbModule.readVerifiedBackup(resolvedPath, { requireManifest: true });
  } catch (error) {
    reasons.push(`VERIFY_FAILED:${error.message}`);
  }

  let score = 0;
  if (verified) {
    score += 35; // manifest + checksum + file bounds
    score += 30; // schema and relationship validation
    const counts = verified.validation.counts || {};
    const businessRecords = ['products', 'customers', 'invoices', 'invoice_details', 'import_logs']
      .reduce((sum, table) => sum + (Number(counts[table]) || 0), 0);
    if (businessRecords > 0) score += 20;
    else reasons.push('NO_BUSINESS_RECORDS');
    if (verified.manifest?.schema_version) score += 10;
    if (verified.manifest?.created_at) score += 5;
  }
  score = Math.max(0, Math.min(100, score));

  const admission = {
    id: opaqueId('admission'),
    operation: 'restore_database',
    backupPath: resolvedPath,
    sha256: verified?.manifest?.sha256 || '',
    size: verified?.size || 0,
    safetyScore: score,
    threshold: MINIMUM_SAFETY_SCORE,
    approved: Boolean(verified && score >= MINIMUM_SAFETY_SCORE),
    reasons,
    actor: { userId: actor.userId || null, accountId: actor.accountId || null },
    createdAt: Date.now(),
    expiresAt: Date.now() + ADMISSION_TTL_MS,
  };
  if (!admission.approved) admission.quarantineId = quarantine(dbModule, admission);
  admissions.set(admission.id, admission);
  return admission;
}

function createChallenge(dbModule, admissionId, req, actor = {}) {
  pruneExpired();
  const admission = admissions.get(admissionId);
  if (!admission || !admission.approved) throw Object.assign(new Error('Backup chưa được duyệt an toàn.'), { statusCode: 403 });
  if (!isLocalRequest(req)) throw Object.assign(new Error('Mã bảo vệ chỉ được xác nhận trên máy cục bộ.'), { statusCode: 403 });
  if (admission.actor.userId !== actor.userId || admission.actor.accountId !== actor.accountId) {
    throw Object.assign(new Error('Phiên quản trị không khớp với yêu cầu kiểm duyệt.'), { statusCode: 403 });
  }
  const challenge = {
    id: opaqueId('challenge'), admissionId, userId: actor.userId, accountId: actor.accountId,
    attempts: 0, expiresAt: Date.now() + CHALLENGE_TTL_MS,
  };
  challenges.set(challenge.id, challenge);
  getLocalCodeDigest(dbModule);
  return challenge;
}

function confirmChallenge(dbModule, challengeId, localCode, req, actor = {}) {
  pruneExpired();
  const challenge = challenges.get(challengeId);
  if (!challenge || !isLocalRequest(req)) throw Object.assign(new Error('Xác thực cục bộ không hợp lệ hoặc đã hết hạn.'), { statusCode: 403 });
  if (challenge.userId !== actor.userId || challenge.accountId !== actor.accountId) throw Object.assign(new Error('Phiên quản trị không khớp.'), { statusCode: 403 });
  challenge.attempts += 1;
  if (challenge.attempts > MAX_CODE_ATTEMPTS) {
    challenges.delete(challengeId);
    throw Object.assign(new Error('Đã vượt quá số lần xác thực cho phép.'), { statusCode: 429 });
  }
  if (!timingSafeEquals(digest(localCode), getLocalCodeDigest(dbModule))) {
    throw Object.assign(new Error('Mã bảo vệ không hợp lệ.'), { statusCode: 403 });
  }
  challenges.delete(challengeId);
  const grant = { id: opaqueId('grant'), admissionId: challenge.admissionId, userId: actor.userId, accountId: actor.accountId, used: false, expiresAt: Date.now() + GRANT_TTL_MS };
  grants.set(grant.id, grant);
  return grant;
}

function consumeGrant(dbModule, admissionId, grantId, actor = {}) {
  pruneExpired();
  const admission = admissions.get(admissionId);
  const grant = grants.get(grantId);
  if (!admission?.approved || !grant || grant.used || grant.admissionId !== admissionId || grant.userId !== actor.userId || grant.accountId !== actor.accountId) {
    throw Object.assign(new Error('Ủy quyền khôi phục không hợp lệ hoặc đã hết hạn.'), { statusCode: 403 });
  }
  // Detect replacement after inspection (TOCTOU) before the file is restored.
  const current = fs.statSync(admission.backupPath);
  if (current.size !== admission.size || dbModule.readVerifiedBackup(admission.backupPath, { requireManifest: true }).manifest.sha256 !== admission.sha256) {
    throw Object.assign(new Error('Backup đã thay đổi sau kiểm duyệt và bị chặn.'), { statusCode: 409 });
  }
  grant.used = true;
  return admission;
}

module.exports = { MINIMUM_SAFETY_SCORE, inspectBackup, createChallenge, confirmChallenge, consumeGrant };
