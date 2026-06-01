const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const PRINT_TEMPLATE_UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'data', 'uploads', 'print-templates');
const PUBLIC_PRINT_TEMPLATE_UPLOAD_PATH = '/static/print-templates';
const DEFAULT_LOGO_MAX_SIZE_BYTES = 2 * 1024 * 1024;
const LOGO_MAX_SIZE_BYTES = Math.max(
  1,
  Number(process.env.KHA_PRINT_TEMPLATE_LOGO_MAX_BYTES || process.env.PRINT_TEMPLATE_LOGO_MAX_BYTES || DEFAULT_LOGO_MAX_SIZE_BYTES) || DEFAULT_LOGO_MAX_SIZE_BYTES
);

const ALLOWED_IMAGE_MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/bmp', '.bmp'],
  ['image/x-icon', '.ico'],
  ['image/vnd.microsoft.icon', '.ico'],
]);

function ensureUploadDir() {
  fs.mkdirSync(PRINT_TEMPLATE_UPLOAD_DIR, { recursive: true });
}

function getExtensionForMime(mimeType) {
  return ALLOWED_IMAGE_MIME_EXTENSIONS.get(String(mimeType || '').toLowerCase()) || '';
}

function createUploadError(message, code = 'PRINT_TEMPLATE_LOGO_UPLOAD_ERROR') {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  error.expose = true;
  return error;
}

function normalizeManagedLogoPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withoutQuery = raw.split('?')[0].split('#')[0];
  const normalizedSlashes = withoutQuery.replace(/\\/g, '/');
  const publicPrefix = `${PUBLIC_PRINT_TEMPLATE_UPLOAD_PATH}/`;
  const candidate = normalizedSlashes.startsWith(publicPrefix)
    ? normalizedSlashes.slice(publicPrefix.length)
    : normalizedSlashes;
  const baseName = path.basename(candidate);
  if (!baseName || baseName === '.' || baseName === '..') return '';
  if (!/^[a-zA-Z0-9._-]+$/.test(baseName)) return '';
  return baseName;
}

function resolveManagedLogoFilePath(value) {
  const fileName = normalizeManagedLogoPath(value);
  if (!fileName) return '';
  const fullPath = path.resolve(PRINT_TEMPLATE_UPLOAD_DIR, fileName);
  const uploadRoot = `${path.resolve(PRINT_TEMPLATE_UPLOAD_DIR)}${path.sep}`;
  if (!fullPath.startsWith(uploadRoot)) return '';
  return fullPath;
}

function toPublicLogoUrl(value) {
  const fileName = normalizeManagedLogoPath(value);
  return fileName ? `${PUBLIC_PRINT_TEMPLATE_UPLOAD_PATH}/${fileName}` : '';
}

function deleteUploadedLogoFile(value) {
  const filePath = resolveManagedLogoFilePath(value);
  if (!filePath) return false;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (error) {
    console.warn(`[KHA PRINT TEMPLATE LOGO] Không thể xóa file logo ${path.basename(filePath)}: ${error.message}`);
  }
  return false;
}

const storage = multer.diskStorage({
  destination(_req, _file, callback) {
    try {
      ensureUploadDir();
      callback(null, PRINT_TEMPLATE_UPLOAD_DIR);
    } catch (error) {
      callback(error);
    }
  },
  filename(_req, file, callback) {
    const extension = getExtensionForMime(file.mimetype);
    if (!extension) return callback(createUploadError('Chỉ chấp nhận file ảnh logo định dạng JPG, PNG, GIF, WEBP, BMP hoặc ICO.', 'PRINT_TEMPLATE_LOGO_INVALID_TYPE'));
    const random = crypto.randomBytes(12).toString('hex');
    callback(null, `logo-${Date.now()}-${random}${extension}`);
  },
});

function imageFileFilter(_req, file, callback) {
  if (!getExtensionForMime(file.mimetype)) {
    return callback(createUploadError('Chỉ chấp nhận file ảnh logo định dạng JPG, PNG, GIF, WEBP, BMP hoặc ICO.', 'PRINT_TEMPLATE_LOGO_INVALID_TYPE'));
  }
  return callback(null, true);
}

const uploadPrintTemplateLogo = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: LOGO_MAX_SIZE_BYTES,
    files: 1,
  },
});

module.exports = {
  PRINT_TEMPLATE_UPLOAD_DIR,
  PUBLIC_PRINT_TEMPLATE_UPLOAD_PATH,
  LOGO_MAX_SIZE_BYTES,
  ensureUploadDir,
  uploadPrintTemplateLogo,
  normalizeManagedLogoPath,
  resolveManagedLogoFilePath,
  toPublicLogoUrl,
  deleteUploadedLogoFile,
};
