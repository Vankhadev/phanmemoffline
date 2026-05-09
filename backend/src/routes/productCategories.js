const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, now } = require('../db/database');
const { normalizeKey, parseKeywordList } = require('../utils/productSearch');

function serializeCategory(category) {
  return {
    ...category,
    keywords: parseKeywordList(category.keywords),
    aliases: parseKeywordList(category.aliases),
    active: category.active === 0 ? 0 : 1,
  };
}

function normalizePayload(body, existing = {}) {
  const name = String(body.name !== undefined ? body.name : existing.name || '').trim();
  const groupName = String(body.group_name !== undefined ? body.group_name : existing.group_name || name).trim();
  const groupKey = String(body.group_key !== undefined ? body.group_key : existing.group_key || groupName || name).trim();
  return {
    name,
    group_name: groupName,
    group_key: normalizeKey(groupKey),
    keywords: parseKeywordList(body.keywords !== undefined ? body.keywords : existing.keywords || []),
    aliases: parseKeywordList(body.aliases !== undefined ? body.aliases : existing.aliases || []),
    active: body.active !== undefined ? (Number(body.active) === 0 ? 0 : 1) : (existing.active === 0 ? 0 : 1),
  };
}

router.get('/', (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
    const rows = getAll('product_categories', c => includeInactive || c.active !== 0)
      .map(serializeCategory)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lấy danh mục sản phẩm', detail: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const payload = normalizePayload(req.body || {});
    if (!payload.name) return res.status(400).json({ error: 'Tên danh mục không được để trống' });

    const dup = getOne('product_categories', c => c.active !== 0 && normalizeKey(c.name) === normalizeKey(payload.name));
    if (dup) return res.status(400).json({ error: `Danh mục "${payload.name}" đã tồn tại` });

    const time = now();
    const id = insert('product_categories', { ...payload, created_at: time, updated_at: time });
    res.json({ ok: true, id, category: serializeCategory({ id, ...payload, created_at: time, updated_at: time }) });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi tạo danh mục sản phẩm', detail: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = getOne('product_categories', c => c.id === id);
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy danh mục' });

    const payload = normalizePayload(req.body || {}, existing);
    if (!payload.name) return res.status(400).json({ error: 'Tên danh mục không được để trống' });

    const dup = getOne('product_categories', c => c.id !== id && c.active !== 0 && normalizeKey(c.name) === normalizeKey(payload.name));
    if (dup) return res.status(400).json({ error: `Danh mục "${payload.name}" đã tồn tại` });

    update('product_categories', id, { ...payload, updated_at: now() });
    const updated = getOne('product_categories', c => c.id === id);
    res.json({ ok: true, category: serializeCategory(updated) });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi cập nhật danh mục sản phẩm', detail: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = getOne('product_categories', c => c.id === id);
    if (!existing) return res.status(404).json({ error: 'Không tìm thấy danh mục' });

    update('product_categories', id, { active: 0, updated_at: now() });
    res.json({ ok: true, message: 'Đã vô hiệu danh mục' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi xóa danh mục sản phẩm', detail: err.message });
  }
});

module.exports = router;
