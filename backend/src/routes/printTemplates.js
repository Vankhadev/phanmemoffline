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
  createPrintTemplate,
  updatePrintTemplate,
  setDefaultPrintTemplate,
  softDeletePrintTemplate,
  attachLogoToPrintTemplate,
  removeLogoFromPrintTemplate,
  countTemplatesUsingLogoPath,
  parseBooleanFlag,
} = require('../services/printTemplateService');

const router = express.Router();
const canManagePrintTemplates = requirePermission('print_templates.manage');

function getAccountId(req) {
  return req.accountId || req.account?.id || req.user?.account_id || 1;
}

function getUserId(req) {
  return req.user?.id || null;
}

function sendError(res, error, fallbackMessage = 'Lỗi xử lý mẫu in hóa đơn') {
  const status = error?.status || 500;
  const isOperational = status < 500 || error?.expose === true;
  const message = isOperational ? error.message : fallbackMessage;
  if (status >= 500) console.warn('[KHA PRINT TEMPLATES]', error?.message || error);
  return res.status(status).json({
    ok: false,
    error: message,
    message,
    code: error?.code || (status === 503 ? 'PRINT_TEMPLATES_MYSQL_UNAVAILABLE' : 'PRINT_TEMPLATES_ERROR'),
  });
}

function runLogoUpload(req, res) {
  return new Promise((resolve, reject) => {
    const upload = uploadPrintTemplateLogo.single('logo');
    upload(req, res, error => {
      if (!error) return resolve();
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

router.get('/', async (req, res) => {
  try {
    const items = await listPrintTemplates({
      accountId: getAccountId(req),
      includeDeleted: parseBooleanFlag(req.query.include_deleted, 0) === 1,
      status: req.query.status,
      q: req.query.q,
    });
    res.json({ ok: true, items, data: items, total: items.length });
  } catch (error) {
    sendError(res, error, 'Lỗi lấy danh sách mẫu in hóa đơn');
  }
});

router.get('/default', async (req, res) => {
  try {
    const item = await getDefaultPrintTemplate({ accountId: getAccountId(req) });
    res.json({ ok: true, item, data: item });
  } catch (error) {
    sendError(res, error, 'Lỗi lấy mẫu in hóa đơn mặc định');
  }
});

router.get('/:id', async (req, res) => {
  try {
    const item = await getPrintTemplateById({ accountId: getAccountId(req), id: req.params.id });
    res.json({ ok: true, item, data: item });
  } catch (error) {
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
    if (!req.file) return res.status(400).json({ ok: false, error: 'Vui lòng chọn file logo để upload.', code: 'PRINT_TEMPLATE_LOGO_REQUIRED' });

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
    res.json({ ok: true, item: result.item, data: result.item, logo_url: publicUrl });
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
