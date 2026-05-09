/**
 * Print Templates API routes
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, saveDB, now, db, getActiveAccountId, touchSyncMetadata } = require('../db/database');

function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function normalizeType(value) {
  return normalizeText(value) || 'sale_invoice';
}

function normalizePaperSize(value) {
  return normalizeText(value) || '80mm';
}

function inferWidthMm(paperSize, fallback = 80) {
  const text = normalizePaperSize(paperSize).toLowerCase();
  if (text === 'a4') return 210;
  if (text === 'a5') return 148;
  const match = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return fallback;
  const width = Number(match[1].replace(',', '.'));
  return Number.isFinite(width) && width > 0 ? width : fallback;
}

function parseActive(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  const text = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', 'active'].includes(text)) return true;
  if (['false', 'no', 'n', 'inactive'].includes(text)) return false;
  return fallback;
}

function normalizeCode(value, fallbackName, fallbackId) {
  const raw = normalizeText(value) || normalizeText(fallbackName) || `template_${fallbackId || Date.now()}`;
  const code = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return code || `template_${fallbackId || Date.now()}`;
}

function isActiveTemplate(template) {
  return template && template.active !== false && template.active !== 0;
}

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) ? id : 0;
}

function findTemplateById(id, includeInactive = false) {
  return getOne('print_templates', template => template.id === id && (includeInactive || isActiveTemplate(template)));
}

function normalizeConfig(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'string') {
    try {
      return normalizeConfig(JSON.parse(value));
    } catch (_) {
      return null;
    }
  }
  if (typeof value !== 'object') return null;
  return JSON.parse(JSON.stringify(value));
}

function hasConfig(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validateCreate(body) {
  const name = normalizeText(body.name);
  const type = normalizeText(body.type);
  const paperSize = normalizeText(body.paper_size);
  const html = normalizeText(body.html);
  const config = normalizeConfig(body.config);
  const errors = [];

  if (!name) errors.push('Thiếu tên mẫu in');
  if (!type) errors.push('Thiếu loại mẫu in');
  if (!paperSize) errors.push('Thiếu khổ giấy');
  if (!html && !hasConfig(config)) errors.push('Thiếu nội dung HTML hoặc cấu hình trực quan');

  return errors;
}

function buildCreatePayload(body) {
  const paperSize = normalizePaperSize(body.paper_size);
  const widthMm = body.width_mm !== undefined && body.width_mm !== null && body.width_mm !== ''
    ? Number(body.width_mm)
    : inferWidthMm(paperSize);
  const timestamp = now();

  return {
    code: normalizeCode(body.code, body.name),
    name: normalizeText(body.name),
    type: normalizeType(body.type),
    paper_size: paperSize,
    width_mm: Number.isFinite(widthMm) && widthMm > 0 ? widthMm : inferWidthMm(paperSize),
    html: String(body.html || ''),
    css: body.css === undefined || body.css === null ? '' : String(body.css),
    config: normalizeConfig(body.config) || null,
    is_default: false,
    active: parseActive(body.active, true),
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function buildUpdatePayload(body, existing) {
  const changes = {};

  if (body.code !== undefined) changes.code = normalizeCode(body.code, body.name || existing.name, existing.id);
  if (body.name !== undefined) changes.name = normalizeText(body.name);
  if (body.type !== undefined) changes.type = normalizeType(body.type);
  if (body.paper_size !== undefined) changes.paper_size = normalizePaperSize(body.paper_size);
  if (body.width_mm !== undefined) {
    const width = Number(body.width_mm);
    changes.width_mm = Number.isFinite(width) && width > 0 ? width : inferWidthMm(changes.paper_size || existing.paper_size);
  } else if (body.paper_size !== undefined) {
    changes.width_mm = inferWidthMm(changes.paper_size || existing.paper_size, existing.width_mm || 80);
  }
  if (body.html !== undefined) changes.html = String(body.html || '');
  if (body.css !== undefined) changes.css = body.css === null ? '' : String(body.css);
  if (body.config !== undefined) changes.config = normalizeConfig(body.config);
  if (body.active !== undefined) changes.active = parseActive(body.active, existing.active !== false && existing.active !== 0);

  changes.updated_at = now();
  return changes;
}

function serializeTemplate(template) {
  if (!template) return null;
  return {
    ...template,
    config: normalizeConfig(template.config) || null,
    width_mm: Number(template.width_mm) || inferWidthMm(template.paper_size),
    is_default: template.is_default === true || template.is_default === 1,
    active: isActiveTemplate(template),
  };
}

// GET /api/print-templates?type=sale_invoice
router.get('/', (req, res) => {
  try {
    const type = normalizeText(req.query.type);
    const templates = getAll('print_templates', template => {
      if (!isActiveTemplate(template)) return false;
      return !type || template.type === type;
    })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'))
      .map(serializeTemplate);

    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lấy danh sách mẫu in', detail: err.message });
  }
});

// GET /api/print-templates/default?type=sale_invoice&paper_size=80mm
router.get('/default', (req, res) => {
  try {
    const type = normalizeText(req.query.type);
    const paperSize = normalizeText(req.query.paper_size);
    const activeTemplates = getAll('print_templates', isActiveTemplate);
    const sameType = type ? activeTemplates.filter(template => template.type === type) : activeTemplates;
    const samePaperSize = paperSize ? sameType.filter(template => template.paper_size === paperSize) : sameType;
    const template = samePaperSize.find(row => row.is_default === true || row.is_default === 1)
      || sameType.find(row => row.is_default === true || row.is_default === 1)
      || samePaperSize[0]
      || sameType[0]
      || activeTemplates[0]
      || null;

    if (!template) return res.status(404).json({ error: 'Không tìm thấy mẫu in mặc định' });
    res.json(serializeTemplate(template));
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lấy mẫu in mặc định', detail: err.message });
  }
});

// GET /api/print-templates/:id
router.get('/:id', (req, res) => {
  try {
    const id = parseId(req.params.id);
    const template = findTemplateById(id);
    if (!template) return res.status(404).json({ error: 'Không tìm thấy mẫu in' });
    res.json(serializeTemplate(template));
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lấy mẫu in', detail: err.message });
  }
});

// POST /api/print-templates
router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    const errors = validateCreate(body);
    if (errors.length > 0) return res.status(400).json({ ok: false, error: errors[0], errors });

    const payload = buildCreatePayload(body);
    const id = insert('print_templates', payload);
    const template = findTemplateById(id, true);
    res.status(201).json({ ok: true, template: serializeTemplate(template) });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Lỗi khi tạo mẫu in', detail: err.message });
  }
});

// PUT /api/print-templates/:id
router.put('/:id', (req, res) => {
  try {
    const id = parseId(req.params.id);
    const template = findTemplateById(id, true);
    if (!template) return res.status(404).json({ ok: false, error: 'Không tìm thấy mẫu in' });

    const changes = buildUpdatePayload(req.body || {}, template);
    if (changes.name !== undefined && !changes.name) return res.status(400).json({ ok: false, error: 'Tên mẫu in không được để trống' });
    if (changes.type !== undefined && !changes.type) return res.status(400).json({ ok: false, error: 'Loại mẫu in không được để trống' });
    if (changes.paper_size !== undefined && !changes.paper_size) return res.status(400).json({ ok: false, error: 'Khổ giấy không được để trống' });
    const nextHtml = changes.html !== undefined ? changes.html : template.html;
    const nextConfig = changes.config !== undefined ? changes.config : normalizeConfig(template.config);
    if (!normalizeText(nextHtml) && !hasConfig(nextConfig)) return res.status(400).json({ ok: false, error: 'Nội dung HTML hoặc cấu hình trực quan không được để trống' });

    update('print_templates', id, changes);
    const updated = findTemplateById(id, true);
    res.json({ ok: true, template: serializeTemplate(updated) });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Lỗi khi cập nhật mẫu in', detail: err.message });
  }
});

// PATCH /api/print-templates/:id/default
// Đặt mặc định theo cùng type + paper_size để mỗi khổ giấy có 1 mẫu mặc định riêng.
router.patch('/:id/default', (req, res) => {
  try {
    const id = parseId(req.params.id);
    const template = findTemplateById(id);
    if (!template) return res.status(404).json({ ok: false, error: 'Không tìm thấy mẫu in' });

    const timestamp = now();
    const accountId = getActiveAccountId();
    for (const row of db.print_templates) {
      if (Number(row.account_id) === Number(accountId) && row.type === template.type && row.paper_size === template.paper_size) {
        row.is_default = row.id === template.id;
        row.updated_at = timestamp;
        row.server_updated_at = timestamp;
        row.sync_version = (Number(row.sync_version) || 1) + 1;
      }
    }
    touchSyncMetadata('print_templates', accountId);
    saveDB();

    res.json({ ok: true, template: serializeTemplate(findTemplateById(id)) });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Lỗi khi đặt mẫu in mặc định', detail: err.message });
  }
});

// DELETE /api/print-templates/:id
router.delete('/:id', (req, res) => {
  try {
    const id = parseId(req.params.id);
    const template = findTemplateById(id, true);
    if (!template) return res.status(404).json({ ok: false, error: 'Không tìm thấy mẫu in' });

    update('print_templates', id, { active: false, is_default: false, updated_at: now() });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Lỗi khi xóa mẫu in', detail: err.message });
  }
});

module.exports = router;
