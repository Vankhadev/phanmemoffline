/**
 * Cash Book API routes
 * Sổ quỹ: ghi nhận thu chi
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, now } = require('../db/database');

// ─────────────────────────────────────────────
// GET /api/cash-book
// → Danh sách giao dịch (có filter theo loại, ngày)
// ─────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const { type, from, to } = req.query;
    let rows = getAll('cash_book', cb => cb.active !== 0);

    if (type) rows = rows.filter(r => r.type === type);
    if (from) rows = rows.filter(r => r.date >= from);
    if (to) rows = rows.filter(r => r.date <= to);

    rows.sort((a, b) => new Date(b.date + 'T' + (b.time || '00:00:00')) - new Date(a.date + 'T' + (a.time || '00:00:00')));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lấy sổ quỹ', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/cash-book/summary
// → Tổng hợp thu chi theo khoảng thời gian
// ─────────────────────────────────────────────
router.get('/summary', (req, res) => {
  try {
    const { from = '1970-01-01', to = '2099-12-31' } = req.query;
    const rows = getAll('cash_book', cb =>
      cb.active !== 0 && cb.date >= from && cb.date <= to
    );

    const totalIncome = rows.filter(r => r.type === 'income').reduce((s, r) => s + (r.amount || 0), 0);
    const totalExpense = rows.filter(r => r.type === 'expense').reduce((s, r) => s + (r.amount || 0), 0);
    const balance = totalIncome - totalExpense;

    res.json({
      period: { from, to },
      total_income: totalIncome,
      total_expense: totalExpense,
      balance,
      transaction_count: rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi tính tổng hợp', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/cash-book
// → Thêm giao dịch thu/chi mới
// ─────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { date, time, type, category, amount, note, reference_id, reference_type } = req.body;

    if (!date || !type || amount === undefined) {
      return res.status(400).json({ error: 'Ngày, loại và số tiền là bắt buộc' });
    }
    if (type !== 'income' && type !== 'expense') {
      return res.status(400).json({ error: 'Loại phải là income hoặc expense' });
    }

    const id = insert('cash_book', {
      date: date,
      time: time || '00:00:00',
      type: type,
      category: category || '',
      amount: parseFloat(amount) || 0,
      note: note || '',
      reference_id: reference_id || null,
      reference_type: reference_type || '',
      active: 1,
      created_at: now(),
      updated_at: now(),
    });

    res.json({ ok: true, id, message: 'Thêm giao dịch thành công' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi thêm giao dịch', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// PUT /api/cash-book/:id
// → Sửa giao dịch
// ─────────────────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const record = getOne('cash_book', r => r.id === id && r.active !== 0);
    if (!record) return res.status(404).json({ error: 'Không tìm thấy giao dịch' });

    const { date, time, type, category, amount, note, reference_id, reference_type } = req.body;

    if (type && type !== 'income' && type !== 'expense') {
      return res.status(400).json({ error: 'Loại phải là income hoặc expense' });
    }

    const changes = {
      date: date || record.date,
      time: time !== undefined ? time : record.time,
      type: type || record.type,
      category: category !== undefined ? category : record.category,
      amount: amount !== undefined ? parseFloat(amount) : record.amount,
      note: note !== undefined ? note : record.note,
      reference_id: reference_id !== undefined ? reference_id : record.reference_id,
      reference_type: reference_type !== undefined ? reference_type : record.reference_type,
      updated_at: now(),
    };

    update('cash_book', id, changes);
    res.json({ ok: true, message: 'Cập nhật giao dịch thành công' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi cập nhật', detail: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/cash-book/:id
// → Xóa giao dịch (soft delete)
// ─────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const record = getOne('cash_book', r => r.id === id && r.active !== 0);
    if (!record) return res.status(404).json({ error: 'Không tìm thấy giao dịch' });

    update('cash_book', id, { active: 0, updated_at: now() });
    res.json({ ok: true, message: 'Đã xóa giao dịch' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi xóa', detail: err.message });
  }
});

module.exports = router;
