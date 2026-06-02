const express = require('express');
const multer = require('multer');
const { requirePermission } = require('../middleware/auth');
const {
  uploadPrintTemplateLogo,
  toPublicLogoUrl,
  deleteUploadedLogoFile,
  normalizeManagedLogoPath,
} = require('../middleware/printTemplateUpload');
const {
  listPrintTemplates,
  getPrintTemplateById,
  getDefaultPrintTemplate,
  getCurrentPrintTemplate,
  createPrintTemplate,
  updatePrintTemplate,
  autosavePrintTemplateDraft,
  publishPrintTemplateDraft,
  discardPrintTemplateDraft,
  setDefaultPrintTemplate,
  softDeletePrintTemplate,
  attachLogoToPrintTemplate,
  removeLogoFromPrintTemplate,
  countTemplatesUsingLogoPath,
  parseBooleanFlag,
} = require('../services/printTemplateService');
const {
  CONFIGURATION_ERROR_CODE,
  CONNECTION_ERROR_CODE,
  MODULE_ERROR_CODE,
  getPrintTemplatesMySqlStatus,
} = require('../db/printTemplatesMySql');
const { getSchemaReadyState } = require('../db/printTemplatesSchema');

const router = express.Router();
const canManagePrintTemplates = requirePermission('print_templates.manage');

function getAccountId(req) {
  return req.accountId || req.account?.id || req.user?.account_id || 1;
}

function getUserId(req) {
  return req.user?.id || null;
}

function getSafeStatus(error) {
  const status = Number(error?.status || error?.statusCode || 500);
  return status >= 400 && status <= 599 ? status : 500;
}

function toSafeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const allowedKeys = ['mysqlCode', 'errno', 'sqlState', 'missing', 'table', 'field', 'errors', 'expected_revision', 'current_revision'];
  const safe = {};
  for (const key of allowedKeys) {
    if (details[key] !== undefined) safe[key] = details[key];
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function sendError(res, error, fallbackMessage = 'Lỗi xử lý mẫu in hóa đơn') {
  const status = getSafeStatus(error);
  const isOperational = status < 500 || error?.expose === true;
  const message = isOperational ? (error?.message || fallbackMessage) : fallbackMessage;
  if (status >= 500) console.warn('[KHA PRINT TEMPLATES]', error?.code || 'PRINT_TEMPLATES_ERROR', error?.message || error);
  const details = toSafeDetails(error?.details);
  return res.status(status).type('application/json').json({
    ok: false,
    item: null,
    data: null,
    items: [],
    total: 0,
    error: message,
    message,
    code: error?.code || (status === 503 ? 'PRINT_TEMPLATES_MYSQL_UNAVAILABLE' : 'PRINT_TEMPLATES_ERROR'),
    ...(details ? { details } : {}),
  });
}

const READ_SAFE_MYSQL_ERROR_CODES = new Set([
  CONFIGURATION_ERROR_CODE,
  CONNECTION_ERROR_CODE,
  MODULE_ERROR_CODE,
]);

function isReadSafeMySqlUnavailable(error) {
  return getSafeStatus(error) === 503 && READ_SAFE_MYSQL_ERROR_CODES.has(error?.code);
}

function sendReadUnavailable(res, error, options = {}) {
  if (!isReadSafeMySqlUnavailable(error)) return false;
  const isCollection = options.collection === true;
  const message = error?.message || 'MySQL cho module mẫu in hóa đơn chưa sẵn sàng.';
  const payload = {
    ok: true,
    mysqlAvailable: false,
    degraded: true,
    source: 'mysql',
    code: error?.code || CONNECTION_ERROR_CODE,
    message,
    schemaReady: getSchemaReadyState(),
    mysql: getPrintTemplatesMySqlStatus(),
    ...(isCollection
      ? { items: [], data: [], total: 0 }
      : { item: null, data: null }),
  };
  console.warn('[KHA PRINT TEMPLATES]', payload.code, message);
  res.status(200).type('application/json').json(payload);
  return true;
}

function runLogoUpload(req, res) {
  return new Promise((resolve, reject) => {
    const upload = uploadPrintTemplateLogo.fields([
      { name: 'logo', maxCount: 1 },
      { name: 'file', maxCount: 1 },
      { name: 'asset', maxCount: 1 },
    ]);
    upload(req, res, error => {
      if (!error) {
        req.file = req.files?.logo?.[0] || req.files?.file?.[0] || req.files?.asset?.[0] || null;
        return resolve();
      }
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          error.status = 413;
          error.message = 'File logo vượt quá dung lượng cho phép.';
        } else {
          error.status = 400;
        }
      }
      return reject(error);
    });
  });
}

async function cleanupLogoIfUnused(accountId, logoPath, excludeId = null) {
  const managedLogoPath = normalizeManagedLogoPath(logoPath);
  if (!managedLogoPath) return false;
  try {
    const usedCount = await countTemplatesUsingLogoPath({ accountId, logoPath: managedLogoPath, excludeId });
    if (usedCount <= 0) return deleteUploadedLogoFile(managedLogoPath);
  } catch (error) {
    console.warn(`[KHA PRINT TEMPLATE LOGO] Không thể kiểm tra logo cũ trước khi xóa: ${error.message}`);
  }
  return false;
}

router.get('/status', async (_req, res) => {
  const mysql = getPrintTemplatesMySqlStatus();
  res.json({
    ok: true,
    module: 'print_templates',
    mysql,
    schemaReady: getSchemaReadyState(),
  });
});

router.get('/', async (req, res) => {
  try {
    const items = await listPrintTemplates({
      accountId: getAccountId(req),
      includeDeleted: parseBooleanFlag(req.query.include_deleted, 0) === 1,
      status: req.query.status,
      q: req.query.q,
      userId: getUserId(req),
    });
    res.json({ ok: true, items, data: items, total: items.length });
  } catch (error) {
    if (sendReadUnavailable(res, error, { collection: true })) return;
    sendError(res, error, 'Lỗi lấy danh sách mẫu in hóa đơn');
  }
});

router.get('/default', async (req, res) => {
  try {
    const item = await getDefaultPrintTemplate({ accountId: getAccountId(req) });
    res.json({ ok: true, item, data: item });
  } catch (error) {
    if (sendReadUnavailable(res, error)) return;
    sendError(res, error, 'Lỗi lấy mẫu in hóa đơn mặc định');
  }
});

router.get('/current', async (req, res) => {
  try {
    const item = await getCurrentPrintTemplate({
      accountId: getAccountId(req),
      templateId: req.query.template_id || req.query.templateId || req.query.id,
    });
    res.json({ ok: true, item, data: item });
  } catch (error) {
    if (sendReadUnavailable(res, error)) return;
    sendError(res, error, 'Lỗi lấy mẫu in hóa đơn hiện hành');
  }
});

router.get('/active', async (req, res) => {
  try {
    const item = await getCurrentPrintTemplate({
      accountId: getAccountId(req),
      templateId: req.query.template_id || req.query.templateId || req.query.id,
    });
    res.json({ ok: true, item, data: item });
  } catch (error) {
    if (sendReadUnavailable(res, error)) return;
    sendError(res, error, 'Lỗi lấy mẫu in hóa đơn đang dùng');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const item = await getPrintTemplateById({ accountId: getAccountId(req), id: req.params.id });
    res.json({ ok: true, item, data: item });
  } catch (error) {
    if (sendReadUnavailable(res, error)) return;
    sendError(res, error, 'Lỗi lấy mẫu in hóa đơn');
  }
});

router.post('/', canManagePrintTemplates, async (req, res) => {
  try {
    const item = await createPrintTemplate({ accountId: getAccountId(req), userId: getUserId(req), body: req.body || {} });
    res.status(201).json({ ok: true, item, data: item });
  } catch (error) {
    sendError(res, error, 'Lỗi tạo mẫu in hóa đơn');
  }
});

router.put('/:id', canManagePrintTemplates, async (req, res) => {
  try {
    const item = await updatePrintTemplate({ accountId: getAccountId(req), userId: getUserId(req), id: req.params.id, body: req.body || {} });
    res.json({ ok: true, item, data: item });
  } catch (error) {
    sendError(res, error, 'Lỗi cập nhật mẫu in hóa đơn');
  }
});

router.patch('/:id/autosave', canManagePrintTemplates, async (req, res) => {
  try {
    const item = await autosavePrintTemplateDraft({ accountId: getAccountId(req), userId: getUserId(req), id: req.params.id, body: req.body || {} });
    res.json({ ok: true, item, data: item, revision: item.revision, has_draft: item.has_draft, last_autosaved_at: item.last_autosaved_at });
  } catch (error) {
    sendError(res, error, 'Lỗi autosave draft mẫu in hóa đơn');
  }
});

router.post('/:id/autosave', canManagePrintTemplates, async (req, res) => {
  try {
    const item = await autosavePrintTemplateDraft({ accountId: getAccountId(req), userId: getUserId(req), id: req.params.id, body: req.body || {} });
    res.json({ ok: true, item, data: item, revision: item.revision, has_draft: item.has_draft, last_autosaved_at: item.last_autosaved_at });
  } catch (error) {
    sendError(res, error, 'Lỗi autosave draft mẫu in hóa đơn');
  }
});

router.post('/:id/publish', canManagePrintTemplates, async (req, res) => {
  try {
    const item = await publishPrintTemplateDraft({ accountId: getAccountId(req), userId: getUserId(req), id: req.params.id, body: req.body || {} });
    res.json({ ok: true, item, data: item, revision: item.revision, has_draft: item.has_draft, published_at: item.published_at });
  } catch (error) {
    sendError(res, error, 'Lỗi publish mẫu in hóa đơn');
  }
});

router.post('/:id/discard-draft', canManagePrintTemplates, async (req, res) => {
  try {
    const item = await discardPrintTemplateDraft({ accountId: getAccountId(req), userId: getUserId(req), id: req.params.id, body: req.body || {} });
    res.json({ ok: true, item, data: item, revision: item.revision, has_draft: item.has_draft });
  } catch (error) {
    sendError(res, error, 'Lỗi hủy draft mẫu in hóa đơn');
  }
});

router.delete('/:id', canManagePrintTemplates, async (req, res) => {
  try {
    const result = await softDeletePrintTemplate({ accountId: getAccountId(req), userId: getUserId(req), id: req.params.id });
    await cleanupLogoIfUnused(getAccountId(req), result.previousLogoPath, req.params.id);
    res.json({ ok: true, item: result.item, data: result.item });
  } catch (error) {
    sendError(res, error, 'Lỗi xóa mẫu in hóa đơn');
  }
});

router.post('/:id/set-default', canManagePrintTemplates, async (req, res) => {
  try {
    const item = await setDefaultPrintTemplate({ accountId: getAccountId(req), userId: getUserId(req), id: req.params.id });
    res.json({ ok: true, item, data: item });
  } catch (error) {
    sendError(res, error, 'Lỗi đặt mẫu in hóa đơn mặc định');
  }
});

router.post('/:id/logo', canManagePrintTemplates, async (req, res) => {
  let uploadedLogoPath = '';
  try {
    await runLogoUpload(req, res);
    if (!req.file) return res.status(400).type('application/json').json({ ok: false, item: null, data: null, error: 'Vui lòng chọn file logo để upload.', message: 'Vui lòng chọn file logo để upload.', code: 'PRINT_TEMPLATE_LOGO_REQUIRED' });

    uploadedLogoPath = req.file.filename;
    const publicUrl = toPublicLogoUrl(uploadedLogoPath);
    const result = await attachLogoToPrintTemplate({
      accountId: getAccountId(req),
      userId: getUserId(req),
      id: req.params.id,
      headerLogo: publicUrl,
      logoUrl: publicUrl,
      logoPath: uploadedLogoPath,
      logoMime: req.file.mimetype,
      logoSize: req.file.size,
    });

    await cleanupLogoIfUnused(getAccountId(req), result.previousLogoPath, req.params.id);
    res.json({
      ok: true,
      item: result.item,
      data: result.item,
      logo_url: publicUrl,
      logo_path: uploadedLogoPath,
      logo: result.item.logo,
      revision: result.item.revision,
    });
  } catch (error) {
    if (uploadedLogoPath) deleteUploadedLogoFile(uploadedLogoPath);
    sendError(res, error, 'Lỗi upload logo mẫu in hóa đơn');
  }
});

router.delete('/:id/logo', canManagePrintTemplates, async (req, res) => {
  try {
    const result = await removeLogoFromPrintTemplate({ accountId: getAccountId(req), userId: getUserId(req), id: req.params.id });
    await cleanupLogoIfUnused(getAccountId(req), result.previousLogoPath, req.params.id);
    res.json({ ok: true, item: result.item, data: result.item });
  } catch (error) {
    sendError(res, error, 'Lỗi xóa logo mẫu in hóa đơn');
  }
});

module.exports = router;
