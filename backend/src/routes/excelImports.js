const express = require('express');
const router = express.Router();
const excelImportService = require('../services/excelImportService');

function sendError(res, err, fallback = 'Thao tác import Excel thất bại.') {
  const status = Number(err?.statusCode || err?.status || 500);
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  const message = err?.message || fallback;
  res.status(safeStatus).json({
    ok: false,
    error: message,
    message,
    code: err?.code || 'EXCEL_IMPORT_ERROR',
    errors: Array.isArray(err?.errors) ? err.errors : [{ message }],
    warnings: [],
    summary: { totalRows: 0, validRows: 0, successRows: 0, errorRows: 1, skippedRows: 0, errors: 1 },
    items: [],
    results: [],
  });
}

router.post('/preview', (req, res) => {
  try {
    res.json(excelImportService.previewImport(req.body || {}, req));
  } catch (err) {
    sendError(res, err, 'Không thể preview import Excel.');
  }
});

router.post('/commit', (req, res) => {
  try {
    res.json(excelImportService.commitImport(req.body || {}, req));
  } catch (err) {
    sendError(res, err, 'Không thể commit import Excel.');
  }
});

router.get('/history', (req, res) => {
  try {
    const runs = excelImportService.listHistory(req.query.limit);
    res.json({ ok: true, resource: 'excel_import_history', resources: ['excel_import_history'], summary: { total: runs.length }, items: runs, results: runs, runs, warnings: [], errors: [] });
  } catch (err) {
    sendError(res, err, 'Không thể tải lịch sử import Excel.');
  }
});

router.get('/history/:id', (req, res) => {
  try {
    const run = excelImportService.historyDetail(req.params.id);
    res.json({ ok: true, resource: 'excel_import_history', resources: ['excel_import_history'], item: run, run, items: run.details || [], results: run.details || [], summary: run.summary || {}, warnings: run.warnings || [], errors: run.errors || [] });
  } catch (err) {
    sendError(res, err, 'Không thể tải chi tiết lịch sử import Excel.');
  }
});

module.exports = router;
