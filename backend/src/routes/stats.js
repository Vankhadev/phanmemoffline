/**
 * Stats API routes
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne } = require('../db/database');

router.get('/', (req, res) => {
  const { from = '1970-01-01', to = '2099-12-31' } = req.query;
  const rows = getAll('daily_stats')
    .filter(r => r.stat_date >= from && r.stat_date <= to)
    .sort((a, b) => b.stat_date.localeCompare(a.stat_date));
  res.json(rows);
});

router.get('/summary', (req, res) => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthStr = new Date().getFullYear() + '-' + (new Date().getMonth() + 1).toString().padStart(2, '0') + '-01';

  const todayStats = getOne('daily_stats', s => s.stat_date === todayStr) || { total_revenue: 0, total_orders: 0 };
  const monthStats = getAll('daily_stats')
    .filter(s => s.stat_date >= monthStr)
    .reduce((acc, s) => {
      acc.revenue += s.total_revenue || 0;
      acc.orders  += s.total_orders  || 0;
      return acc;
    }, { revenue: 0, orders: 0 });
  const allTime = getAll('daily_stats')
    .reduce((acc, s) => {
      acc.revenue += s.total_revenue || 0;
      acc.orders  += s.total_orders  || 0;
      return acc;
    }, { revenue: 0, orders: 0 });

  res.json({ today: todayStats, month: monthStats, allTime });
});

// ─────────────────────────────────────────────
// GET /api/stats/tax-report
// Báo cáo thuế: doanh thu chịu thuế, thuế GTGT, lợi nhuận
// Query: from, to (YYYY-MM-DD)
// ─────────────────────────────────────────────
router.get('/tax-report', (req, res) => {
  try {
    const { from = '1970-01-01', to = '2099-12-31' } = req.query;
    // Chuyển thành full timestamp để so sánh chính xác
    const fromDate = from + 'T00:00:00.000Z';
    const toDate = to + 'T23:59:59.999Z';

    // Lấy tất cả hóa đơn trong khoảng thời gian (chỉ lấy đơn completed)
    const invoices = getAll('invoices', inv =>
      inv.status === 'completed' &&
      inv.created_at &&
      inv.created_at >= fromDate &&
      inv.created_at <= toDate
    );

    let total_taxable_revenue = 0;   // Doanh thu chịu thuế (subtotal)
    let total_vat = 0;               // Thuế GTGT (vat_amount)
    let total_profit = 0;            // Lợi nhuận (doanh thu bán - giá nhập)

    // Duyệt từng hóa đơn để tính lợi nhuận từ chi tiết
    for (const inv of invoices) {
      // Doanh thu chịu thuế = subtotal (đã bao gồm VAT hay chưa tùy cấu hình)
      // Thông thường: subtotal là tổng tiền hàng chưa VAT
      total_taxable_revenue += inv.subtotal || 0;
      total_vat += inv.vat_amount || 0;

      // Tính lợi nhuận từ chi tiết hóa đơn
      const details = getAll('invoice_details', d => d.invoice_id === inv.id);
      for (const d of details) {
        const quantity = d.quantity || 0;
        const unit_price = d.unit_price || 0;
        const import_price = d.import_price || 0;
        const line_profit = (unit_price - import_price) * quantity;
        total_profit += line_profit;
      }
    }

    res.json({
      period: { from, to },
      total_taxable_revenue: Math.round(total_taxable_revenue),
      total_vat: Math.round(total_vat),
      total_profit: Math.round(total_profit),
      invoice_count: invoices.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi tính báo cáo thuế: ' + err.message });
  }
});

module.exports = router;