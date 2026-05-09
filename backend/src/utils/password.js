const crypto = require('crypto');

const HASH_ALGORITHM = 'sha256';
const HASH_PREFIX = 'pbkdf2_sha256';
const HASH_ITERATIONS = 120000;
const HASH_KEY_LENGTH = 32;

function isPasswordHash(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('$');
  return parts.length === 4 && parts[0] === HASH_PREFIX && /^\d+$/.test(parts[1]) && parts[2] && parts[3];
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(String(password), salt, HASH_ITERATIONS, HASH_KEY_LENGTH, HASH_ALGORITHM)
    .toString('hex');
  return `${HASH_PREFIX}$${HASH_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedPassword) {
  if (!isPasswordHash(storedPassword)) {
    return String(storedPassword || '') === String(password || '');
  }

  const [, iterationsText, salt, expectedHash] = storedPassword.split('$');
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const actual = crypto
    .pbkdf2Sync(String(password), salt, iterations, HASH_KEY_LENGTH, HASH_ALGORITHM)
    .toString('hex');

  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

module.exports = {
  hashPassword,
  verifyPassword,
  isPasswordHash,
};
