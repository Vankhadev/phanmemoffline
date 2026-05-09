/**
 * Invoices API routes
 * CRUD cho đơn hàng: tạo, sửa, xóa, xem
 * Status: pending → confirmed → completed | cancelled
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, remove, upsertDailyStats, today, now, getNextSeq, normalizePaymentMethod, getActiveAccountId } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

// ─────────────────────────────────────────────
// Helper: tạo mã đơn tự động HD000001
// ─────────────────────────────────────────────
function genInvoiceCode() {
  return `HD${String(getNextSeq('invoice_seq')).padStart(5, '0')}`;
}

// ─────────────────────────────────────────────
// Helper: trừ tồn kho cho product HOẶC variant
// ─────────────────────────────────────────────
function deductStock(productOrVariantId, quantity) {
  // ① Thử trừ biến thể trước (biến thể lưu trong bảng products với parent_id != null)
  const variant = getOne('products', v => v.id === productOrVariantId && v.parent_id != null);
  if (variant) {
    update('products', variant.id, {
      stock: Math.max(0, (variant.stock || 0) - quantity),
    });
    return;
  }
  // ② Thử trừ sản phẩm cha (parent_id là null)
  const product = getOne('products', p => p.id === productOrVariantId && !p.parent_id);
  if (product) {
    update('products', product.id, {
      stock: Math.max(0, (product.stock || 0) - quantity),
    });
    return;
  }
}

// ─────────────────────────────────────────────
// Helper: hoàn tồn kho cho product HOẶC variant
// ─────────────────────────────────────────────
function restoreStock(productOrVariantId, quantity) {
  // ① Thử hoàn biến thể trước
  const variant = getOne('products', v => v.id === productOrVariantId && v.parent_id != null);
  if (variant) {
    update('products', variant.id, {
      stock: (variant.stock || 0) + quantity,
    });
    return;
  }
  // ② Thử hoàn sản phẩm cha
  const product = getOne('products', p => p.id === productOrVariantId && !p.parent_id);
  if (product) {
    update('products', product.id, {
      stock: (product.stock || 0) + quantity,
    });
  }
}

// ─────────────────────────────────────────────
// Helper: lấy tồn kho thực tế (product hoặc variant)
// ─────────────────────────────────────────────
function getStock(productOrVariantId) {
  const variant = getOne('products', v => v.id === productOrVariantId && v.parent_id != null);
  if (variant) return { stock: variant.stock || 0, name: variant.name };
  const product = getOne('products', p => p.id === productOrVariantId && !p.parent_id);
  if (product) return { stock: product.stock || 0, name: product.name };
  return { stock: 0, name: `ID ${productOrVariantId}` };
}

// ─────────────────────────────────────────────
// Helper: hợp nhất chi tiết trùng product_id (chống duplicate)
// ─────────────────────────────────────────────
function isComboDetail(detail = {}) {
  return detail.type === 'combo' || detail.item_type === 'combo' || !!detail.combo_id;
}

function buildDetailKey(detail = {}, index = 0) {
  if (isComboDetail(detail)) return `combo:${detail.combo_id || detail.id || index}:${detail.unit_price || 0}`;
  return `product:${detail.product_id || detail.id || index}:${detail.unit_price || 0}`;
}

function normalizeInvoiceDetail(detail = {}, invoice_id) {
  const comboLine = isComboDetail(detail);
  const product_id = comboLine ? null : (detail.product_id || null);
  const combo_id = comboLine ? (detail.combo_id || null) : null;
  const product_name = detail.product_name || detail.name || '';
  const product_sku = detail.product_sku || detail.sku || '';
  const quantity = +detail.quantity || 1;
  const unit_price = +detail.unit_price || 0;
  const discount_amount = detail.discount_amount || 0;

  let import_price = 0;
  if (product_id) {
    const prod = getOne('products', p => p.id == product_id);
    if (prod) import_price = prod.import_price || 0;
  }

  return {
    invoice_id,
    type: comboLine ? 'combo' : (detail.type || detail.item_type || 'product'),
    item_type: comboLine ? 'combo' : (detail.item_type || detail.type || 'product'),
    combo_id,
    product_id,
    variant_id: comboLine ? null : (detail.variant_id || null),
    product_name,
    product_sku,
    name: detail.name || product_name,
    sku: detail.sku || product_sku,
    quantity,
    unit_price,
    import_price,
    discount_amount,
    discount_percent: detail.discount_percent || 0,
    line_total: +detail.line_total || (quantity * unit_price - discount_amount),
    created_at: now(),
  };
}

function mergeDuplicateDetails(details) {
  if (!Array.isArray(details)) return [];
  const map = new Map();
  for (const d of details) {
    const key = buildDetailKey(d, map.size);
    if (map.has(key)) {
      const existing = map.get(key);
      existing.quantity += d.quantity || 0;
      existing.line_total += d.line_total || 0;
      existing.discount_amount += d.discount_amount || 0;
      // Giữ nguyên unit_price, discount_percent của dòng đầu (coi như áp dụng cho tổng số lượng)
    } else {
      map.set(key, { ...d });
    }
  }
  return Array.from(map.values());
}

// ─────────────────────────────────────────────
// Helper: báo cáo đơn hàng theo khách hàng/khoảng ngày
// ─────────────────────────────────────────────
function parseLocalDateBoundary(value, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function parseInvoiceDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDetailName(detail = {}) {
  return detail.product_name || detail.name || detail.combo_name || detail.sku || detail.product_sku || 'Sản phẩm';
}

function buildItemsSummary(details = []) {
  if (!Array.isArray(details) || details.length === 0) return '';
  return details
    .map(detail => `${formatDetailName(detail)} x${Number(detail.quantity) || 0}`)
    .join('; ');
}

// ─────────────────────────────────────────────
// GET /api/invoices/reports/customer-orders
// Báo cáo read-only theo khách hàng và khoảng ngày local
// ─────────────────────────────────────────────
router.get('/reports/customer-orders', (req, res) => {
  try {
    const { customer_id, from, to, status } = req.query;
    const customerId = Number(customer_id);

    if (!Number.isFinite(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'Thiếu hoặc sai customer_id' });
    }

    const fromDate = parseLocalDateBoundary(from, false);
    const toDate = parseLocalDateBoundary(to, true);
    if (!fromDate || !toDate) {
      return res.status(400).json({ error: 'Khoảng ngày không hợp lệ. Vui lòng dùng định dạng YYYY-MM-DD.' });
    }
    if (fromDate > toDate) {
      return res.status(400).json({ error: 'Ngày bắt đầu không được lớn hơn ngày kết thúc' });
    }

    const customer = getOne('customers', c => Number(c.id) === customerId && c.active !== 0);
    if (!customer) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });

    const allDetails = getAll('invoice_details');
    const invoices = getAll('invoices')
      .filter(inv => Number(inv.customer_id) === customerId)
      .filter(inv => {
        if (status && status !== 'all') return inv.status === status;
        return inv.status !== 'cancelled';
      })
      .filter(inv => {
        const createdAt = parseInvoiceDate(inv.created_at);
        return createdAt && createdAt >= fromDate && createdAt <= toDate;
      })
      .sort((a, b) => parseInvoiceDate(a.created_at) - parseInvoiceDate(b.created_at))
      .map(inv => {
        const details = allDetails
          .filter(detail => Number(detail.invoice_id) === Number(inv.id))
          .map(detail => ({
            id: detail.id,
            type: detail.type || detail.item_type || (detail.combo_id ? 'combo' : 'product'),
            product_id: detail.product_id || null,
            combo_id: detail.combo_id || null,
            product_name: formatDetailName(detail),
            product_sku: detail.product_sku || detail.sku || '',
            quantity: Number(detail.quantity) || 0,
            unit_price: Number(detail.unit_price) || 0,
            line_total: Number(detail.line_total) || 0,
          }));

        return {
          id: inv.id,
          invoice_code: inv.invoice_code,
          created_at: inv.created_at,
          customer_id: inv.customer_id,
          customer_name: customer.name || '',
          items_summary: buildItemsSummary(details),
          details,
          subtotal: Number(inv.subtotal) || 0,
          vat_amount: Number(inv.vat_amount) || 0,
          discount_amount: Number(inv.discount_amount) || 0,
          total: Number(inv.total) || 0,
          paid_amount: Number(inv.paid_amount) || 0,
          change_amount: Number(inv.change_amount) || 0,
          remaining_amount: Number(inv.remaining_amount) || 0,
          delivery_fee: Number(inv.delivery_fee) || 0,
          status: inv.status || '',
          payment_method: inv.payment_method || '',
          note: inv.note || '',
        };
      });

    const totalAmount = invoices.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);

    res.json({
      filters: {
        customer_id: customerId,
        from,
        to,
        status: status || 'exclude_cancelled',
        from_local: fromDate.toLocaleString('sv-SE'),
        to_local: toDate.toLocaleString('sv-SE'),
      },
      customer: {
        id: customer.id,
        name: customer.name || '',
        phone: customer.phone || '',
        email: customer.email || '',
        customer_type: customer.customer_type || '',
      },
      invoices,
      summary: {
        total_invoices: invoices.length,
        total_amount: totalAmount,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lập báo cáo đơn hàng theo khách hàng: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/invoices
// ─────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const { status, delivery, from, to } = req.query;
    let rows = getAll('invoices').map(inv => ({
      ...inv,
      customer_name: getOne('customers', c => c.id === inv.customer_id)?.name || '',
      user_name: getOne('users', u => u.id === inv.user_id)?.name || '',
    }));
    if (status) rows = rows.filter(r => r.status === status);
    if (delivery === 'pending') rows = rows.filter(r => !r.delivery_date);
    if (delivery === 'done') rows = rows.filter(r => !!r.delivery_date);
    if (from) rows = rows.filter(r => r.created_at && r.created_at >= from);
    if (to) rows = rows.filter(r => r.created_at && r.created_at.slice(0, 10) <= to);
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lấy danh sách: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/invoices/:id
// ─────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const inv = getOne('invoices', i => i.id === +req.params.id);
    if (!inv) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    const details = getAll('invoice_details', d => d.invoice_id === inv.id);
    const customer = getOne('customers', c => c.id === inv.customer_id);
    res.json({ ...inv, customer_name: customer?.name || '', details });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/invoices → Tạo đơn hàng mới
// ─────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const {
      customer_id, user_id,
      subtotal, vat_percent, vat_amount,
      discount_amount, discount_percent,
      total, payment_method, note,
      paid_amount, change_amount, remaining_amount, delivery_fee,
      invoice_writer, receiver_name,
      delivery_date,
      details,
    } = req.body;

    // ── Kiểm tra tồn kho trước khi tạo đơn (dùng helper nhận diện product/variant) ──
    for (const d of (details || [])) {
      if (isComboDetail(d)) continue;
      if (d.product_id) {
        const prod = getOne('products', p => p.id == d.product_id);
        if (!prod) {
          res.status(400).json({ error: `Sản phẩm ID ${d.product_id} không tồn tại` });
          return;
        }
        if ((prod.stock || 0) < (d.quantity || 1)) {
          res.status(400).json({ error: `Sản phẩm "${prod.name}" không đủ tồn kho! Còn: ${prod.stock || 0}, cần: ${d.quantity || 1}` });
          return;
        }
      }
    }

    const invoice_code = genInvoiceCode();
    const invoice_id = insert('invoices', {
      invoice_code,
      customer_id: customer_id || null,
      user_id: user_id || null,
      subtotal: +subtotal || 0,
      vat_percent: +vat_percent || 0,
      vat_amount: vat_amount || 0,
      discount_amount: discount_amount || 0,
      discount_percent: discount_percent || 0,
      total: +total || 0,
      paid_amount: +paid_amount || 0,
      change_amount: +change_amount || 0,
      remaining_amount: +remaining_amount || 0,
      delivery_fee: +delivery_fee || 0,
      payment_method: normalizePaymentMethod(payment_method),
      note: note || '',
      invoice_writer: invoice_writer || '',
      receiver_name: receiver_name || '',
      delivery_date: delivery_date || null,
      status: req.body.status || 'pending',
      created_at: now(),
    });

    // Lưu chi tiết + trừ tồn kho sản phẩm lẻ; combo là dòng bán hàng riêng, không trừ kho ở đây
    for (const d of (details || [])) {
      const detailRow = normalizeInvoiceDetail(d, invoice_id);
      insert('invoice_details', detailRow);
      if (!isComboDetail(d) && d.product_id) deductStock(d.product_id, +d.quantity || 1);
    }

    // Cập nhật thống kê ngày
    upsertDailyStats(today(), +total || 0);
    // Trigger bot tồn kho (async)
    triggerBotStockCheck(req).catch(() => { });
    // Tạo giao dịch thu vào sổ quỹ nếu đơn hoàn tất
    if (req.body.status === 'completed') {
      addCashBookIncome({ id: invoice_id, invoice_code, total });
    }

    res.json({ ok: true, invoice_id, invoice_code });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi tạo đơn: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// PUT /api/invoices/:id → Sửa đơn hàng (admin)
// ─────────────────────────────────────────────
router.put('/:id', requireAdmin, (req, res) => {
  try {
    const inv = getOne('invoices', i => i.id === +req.params.id);
    if (!inv) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    if (inv.status === 'cancelled') return res.status(400).json({ error: 'Không thể sửa đơn đã hủy' });

    const {
      customer_id, payment_method, note,
      subtotal, vat_percent, vat_amount,
      discount_amount, discount_percent,
      total, delivery_date,
      paid_amount, change_amount, remaining_amount, delivery_fee,
      invoice_writer, receiver_name,
      details,
    } = req.body;

    // Cập nhật thông tin đơn hàng
    update('invoices', inv.id, {
      ...(customer_id !== undefined && { customer_id: customer_id || null }),
      ...(payment_method && { payment_method: normalizePaymentMethod(payment_method) }),
      ...(note !== undefined && { note }),
      ...(subtotal !== undefined && { subtotal: +subtotal }),
      ...(vat_percent !== undefined && { vat_percent: +vat_percent }),
      ...(vat_amount !== undefined && { vat_amount }),
      ...(discount_amount !== undefined && { discount_amount }),
      ...(discount_percent !== undefined && { discount_percent }),
      ...(total !== undefined && { total: +total }),
      ...(paid_amount !== undefined && { paid_amount: +paid_amount || 0 }),
      ...(change_amount !== undefined && { change_amount: +change_amount || 0 }),
      ...(remaining_amount !== undefined && { remaining_amount: +remaining_amount || 0 }),
      ...(delivery_fee !== undefined && { delivery_fee: +delivery_fee || 0 }),
      ...(delivery_date !== undefined && { delivery_date: delivery_date || null }),
      ...(invoice_writer !== undefined && { invoice_writer }),
      ...(receiver_name !== undefined && { receiver_name }),
      ...(req.body.created_at && { created_at: req.body.created_at }),
    });

    // Cập nhật chi tiết sản phẩm (nếu có thay đổi)
    if (details !== undefined) {
      // Hợp nhất các sản phẩm trùng ID để tránh trừ kho nhiều lần
      const safeDetails = mergeDuplicateDetails(details);

      // ① Hoàn kho cho chi tiết cũ (dùng helper nhận diện product/variant)
      const oldDetails = getAll('invoice_details', d => d.invoice_id === inv.id);
      for (const d of oldDetails) {
        if (d.product_id) restoreStock(d.product_id, +d.quantity || 0);
      }
      // ② Xóa chi tiết cũ trong account hiện tại
      for (const detail of oldDetails) {
        remove('invoice_details', detail.id);
      }
      // ③ Thêm chi tiết mới + trừ kho
      for (const d of (safeDetails || [])) {
        const detailRow = normalizeInvoiceDetail(d, inv.id);
        insert('invoice_details', detailRow);
        // Trừ tồn kho sản phẩm lẻ; combo là dòng bán hàng riêng, không trừ kho ở đây
        if (!isComboDetail(d) && d.product_id) deductStock(d.product_id, +d.quantity || 1);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi sửa đơn: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/invoices/:id → Hủy đơn hàng (admin)
// ─────────────────────────────────────────────
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    const inv = getOne('invoices', i => i.id === +req.params.id);
    if (!inv) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    // ① Hoàn kho cho tất cả sản phẩm trong đơn (dùng helper nhận diện product/variant)
    const details = getAll('invoice_details', d => d.invoice_id === inv.id);
    for (const d of details) {
      if (d.product_id) restoreStock(d.product_id, +d.quantity || 0);
    }

    // ② Xóa chi tiết trong account hiện tại
    for (const detail of details) {
      remove('invoice_details', detail.id);
    }

    // ③ Đánh dấu đơn là đã hủy
    update('invoices', inv.id, { status: 'cancelled' });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi hủy đơn: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/invoices/:id/confirm
// ─────────────────────────────────────────────
router.patch('/:id/confirm', requireAdmin, (req, res) => {
  try {
    const inv = getOne('invoices', i => i.id === +req.params.id);
    if (!inv) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    if (inv.status === 'cancelled') return res.status(400).json({ error: 'Không thể xác nhận đơn đã hủy' });
    if (inv.status === 'completed') return res.status(400).json({ error: 'Đơn đã được xác nhận trước đó' });
    update('invoices', inv.id, { status: 'completed' });
    // Tạo giao dịch thu vào sổ quỹ khi xác nhận đơn hàng
    addCashBookIncome({ id: inv.id, invoice_code: inv.invoice_code, total: inv.total });
    res.json({ ok: true, message: 'Đơn đã được xác nhận' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi xác nhận đơn: ' + err.message });
  }
});

// ─────────────────────────────────────────────
// Bot: kiểm tra tồn kho sau khi tạo/sửa đơn
// ─────────────────────────────────────────────
async function triggerBotStockCheck(req) {
  const target = `${req.protocol}://${req.get('host')}/api/bot/auto-check-stock`;
  await globalThis.fetch(target, { method: 'POST' });
}

// ─────────────────────────────────────────────
// Helper: tạo giao dịch thu vào sổ quỹ
// ─────────────────────────────────────────────
function addCashBookIncome(invoice) {
  try {
    const existing = getOne('cash_book', c => c.reference_type === 'invoice' && Number(c.reference_id) === Number(invoice.id) && c.active !== 0);
    if (existing) return;

    const time = new Date().toISOString();
    insert('cash_book', {
      account_id: getActiveAccountId(),
      date: time.slice(0, 10),
      time: time.slice(11, 19),
      type: 'income',
      category: 'Doanh thu từ đơn hàng',
      amount: invoice.total || 0,
      note: `Hóa đơn ${invoice.invoice_code}`,
      reference_id: invoice.id,
      reference_type: 'invoice',
      active: true,
      created_at: time,
      updated_at: time,
    });
  } catch (err) {
    console.error('Lỗi tạo giao dịch sổ quỹ:', err.message);
  }
}

module.exports = router;
