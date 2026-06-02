/**
 * Stats API routes
 */
const express = require('express');
const router = express.Router();
const { getAll, today, normalizeDateKey, normalizeNumber, isCompletedInvoiceStatus } = require('../db/database');
const { getNegativeStockPolicy } = require('../utils/negativeStock');

function normalizeDailyStatsRow(row = {}) {
  return {
    ...row,
    stat_date: normalizeDateKey(row.stat_date || row.date || row.created_at),
    total_revenue: normalizeNumber(row.total_revenue ?? row.revenue, 0),
    total_orders: Math.max(0, Math.round(normalizeNumber(row.total_orders ?? row.orders, 0))),
  };
}

function getNormalizedDailyStatsRows() {
  return getAll('daily_stats')
    .map(normalizeDailyStatsRow)
    .filter(row => row.stat_date);
}

function serializeStockAlertProduct(product = {}) {
  return {
    id: product.id,
    sku: product.sku || '',
    name: product.name || product.product_name || `ID ${product.id}`,
    stock: Number(product.stock) || 0,
    parent_id: product.parent_id || null,
    active: product.active === 0 ? 0 : 1,
  };
}

function buildNegativeStockDashboardStats() {
  const policy = getNegativeStockPolicy();
  const products = getAll('products', product => product && product.active !== 0);
  const negativeProducts = products
    .map(serializeStockAlertProduct)
    .filter(product => product.stock < 0)
    .sort((a, b) => a.stock - b.stock || String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
  const nearLimitProducts = policy.enabled
    ? negativeProducts.filter(product => product.stock <= policy.warningThreshold && product.stock >= policy.minimumAllowedStock)
    : [];
  const breachedProducts = negativeProducts.filter(product => product.stock < policy.minimumAllowedStock);

  return {
    enabled: policy.enabled,
    negative_stock_enabled: policy.enabled,
    negative_stock_limit: policy.negative_stock_limit,
    minimum_allowed_stock: policy.minimumAllowedStock,
    warning_threshold: policy.warningThreshold,
    negative_count: negativeProducts.length,
    near_limit_count: nearLimitProducts.length,
    breached_count: breachedProducts.length,
    lowest_stock: negativeProducts.length > 0 ? negativeProducts[0].stock : 0,
    total_negative_stock: negativeProducts.reduce((sum, product) => sum + product.stock, 0),
    products: negativeProducts.slice(0, 20),
    near_limit_products: nearLimitProducts.slice(0, 20),
    breached_products: breachedProducts.slice(0, 20),
  };
}

router.get('/', (req, res) => {
  const { from = '1970-01-01', to = '2099-12-31' } = req.query;
  const rows = getNormalizedDailyStatsRows()
    .filter(r => r.stat_date >= from && r.stat_date <= to)
    .sort((a, b) => b.stat_date.localeCompare(a.stat_date));
  res.json(rows);
});

router.get('/summary', (req, res) => {
  const todayStr = today();
  const monthStr = `${todayStr.slice(0, 7)}-01`;
  const dailyStats = getNormalizedDailyStatsRows();

  const todayStats = dailyStats.find(s => s.stat_date === todayStr) || {
    stat_date: todayStr,
    total_revenue: 0,
    total_orders: 0,
  };
  const monthStats = dailyStats
    .filter(s => s.stat_date >= monthStr)
    .reduce((acc, s) => {
      acc.revenue += s.total_revenue || 0;
      acc.orders += s.total_orders || 0;
      return acc;
    }, { revenue: 0, orders: 0 });
  const allTime = dailyStats
    .reduce((acc, s) => {
      acc.revenue += s.total_revenue || 0;
      acc.orders += s.total_orders || 0;
      return acc;
    }, { revenue: 0, orders: 0 });

  const negativeStock = buildNegativeStockDashboardStats();

  res.json({
    today: todayStats,
    month: monthStats,
    allTime,
    stock: { negative_stock: negativeStock },
    negativeStock,
  });
});

router.get('/stock-alerts', (_req, res) => {
  res.json({ ok: true, negativeStock: buildNegativeStockDashboardStats() });
});

const PRODUCT_REPORT_TIMEZONE = 'Asia/Saigon';
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'da_huy', 'da huy', 'đã hủy', 'dã hủy', 'huy', 'hủy']);
const VALID_PRODUCT_REPORT_PERIODS = new Set(['day', 'month', 'year', 'custom']);

const productReportDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PRODUCT_REPORT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function normalizeVietnameseText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFC')
    .replace(/\s+/g, ' ');
}

function isCancelledStatus(status) {
  return CANCELLED_STATUSES.has(normalizeVietnameseText(status));
}

function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function localDateKey(value = new Date()) {
  if (typeof value === 'string') {
    const directMatch = value.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (directMatch && isValidDateKey(directMatch[1])) return directMatch[1];
  }

  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isNaN(date.getTime())) {
    const parts = productReportDateFormatter.formatToParts(date).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  const fallbackMatch = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return fallbackMatch ? `${fallbackMatch[1]}-${fallbackMatch[2]}-${fallbackMatch[3]}` : '';
}

function normalizePeriod(period) {
  const normalized = String(period || 'custom').trim().toLowerCase();
  return VALID_PRODUCT_REPORT_PERIODS.has(normalized) ? normalized : 'custom';
}

function normalizeStatusFilter(status) {
  const normalized = normalizeVietnameseText(status || 'completed');
  return normalized || 'completed';
}

function buildProductReportRange(query = {}) {
  const period = normalizePeriod(query.period);
  const todayKey = localDateKey(new Date());
  const [currentYear, currentMonth] = todayKey.split('-').map(Number);
  let from = String(query.from || '').slice(0, 10);
  let to = String(query.to || '').slice(0, 10);

  if (period === 'day') {
    const selectedDay = String(query.date || from || to || todayKey).slice(0, 10);
    from = selectedDay;
    to = selectedDay;
  } else if (period === 'month') {
    const selectedMonth = String(query.month || (from && from.slice(0, 7)) || `${currentYear}-${String(currentMonth).padStart(2, '0')}`);
    const [year, month] = selectedMonth.split('-').map(Number);
    if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
      from = `${year}-${String(month).padStart(2, '0')}-01`;
      to = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
    }
  } else if (period === 'year') {
    const selectedYear = Number(query.year || (from && from.slice(0, 4)) || currentYear);
    if (Number.isInteger(selectedYear) && selectedYear >= 1900 && selectedYear <= 9999) {
      from = `${selectedYear}-01-01`;
      to = `${selectedYear}-12-31`;
    }
  } else {
    if (!from && !to) {
      from = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
      to = todayKey;
    } else if (from && !to) {
      to = from;
    } else if (!from && to) {
      from = to;
    }
  }

  if (!isValidDateKey(from) || !isValidDateKey(to)) {
    const error = new Error('Khoảng ngày không hợp lệ. Vui lòng dùng định dạng YYYY-MM-DD.');
    error.statusCode = 400;
    throw error;
  }

  if (from > to) {
    const error = new Error('Ngày bắt đầu không được lớn hơn ngày kết thúc.');
    error.statusCode = 400;
    throw error;
  }

  return { from, to, period };
}

function includeInvoiceByStatus(invoice, statusFilter) {
  const invoiceStatus = normalizeStatusFilter(invoice?.status);
  if (isCancelledStatus(invoiceStatus)) return false;
  if (statusFilter === 'all' || statusFilter === 'exclude_cancelled') return true;
  return invoiceStatus === statusFilter;
}

function getDetailProductName(detail = {}, productsById = new Map()) {
  const product = productsById.get(Number(detail.variant_id)) || productsById.get(Number(detail.product_id));
  return detail.product_name || detail.name || detail.combo_name || product?.name || detail.product_sku || detail.sku || 'Sản phẩm';
}

function getDetailSku(detail = {}, productsById = new Map()) {
  const product = productsById.get(Number(detail.variant_id)) || productsById.get(Number(detail.product_id));
  if (detail.product_sku || detail.sku || product?.sku) return detail.product_sku || detail.sku || product.sku;
  if (detail.combo_id) return `COMBO-${detail.combo_id}`;
  if (detail.variant_id) return `VAR-${detail.variant_id}`;
  if (detail.product_id) return `SP-${detail.product_id}`;
  return '';
}

// ─────────────────────────────────────────────
// GET /api/stats/product-report
// Báo cáo thống kê bán hàng theo sản phẩm trong khoảng ngày local Asia/Saigon
// Query: from, to (YYYY-MM-DD), period=day|month|year|custom, status=completed mặc định
// ─────────────────────────────────────────────
router.get('/product-report', (req, res) => {
  try {
    const { from, to, period } = buildProductReportRange(req.query);
    const statusFilter = normalizeStatusFilter(req.query.status || 'completed');

    const invoices = getAll('invoices')
      .filter(inv => inv && inv.created_at)
      .filter(inv => includeInvoiceByStatus(inv, statusFilter))
      .filter(inv => {
        const dateKey = localDateKey(inv.created_at);
        return dateKey && dateKey >= from && dateKey <= to;
      });

    const invoiceIds = new Set(invoices.map(inv => Number(inv.id)));
    const detailsByInvoice = new Map();
    for (const detail of getAll('invoice_details')) {
      const invoiceId = Number(detail?.invoice_id);
      if (!invoiceIds.has(invoiceId)) continue;
      if (!detailsByInvoice.has(invoiceId)) detailsByInvoice.set(invoiceId, []);
      detailsByInvoice.get(invoiceId).push(detail || {});
    }

    const productsById = new Map(getAll('products').map(product => [Number(product.id), product]));
    const rowMap = new Map();
    let totalQuantity = 0;
    let totalGrossAmount = 0;
    let totalProductDiscount = 0;
    let totalAllocatedDiscount = 0;
    let totalTaxAmount = 0;
    let totalNetAmount = 0;

    for (const invoice of invoices) {
      const invoiceId = Number(invoice.id);
      const dateKey = localDateKey(invoice.created_at);
      const details = detailsByInvoice.get(invoiceId) || [];
      const invoiceSubtotal = toNumber(invoice.subtotal);
      const invoiceDiscount = toNumber(invoice.discount_amount);
      const invoiceVat = toNumber(invoice.vat_amount);

      for (const detail of details) {
        const quantity = toNumber(detail.quantity);
        const unitPrice = toNumber(detail.unit_price);
        const grossAmount = quantity * unitPrice;
        const productDiscount = toNumber(detail.discount_amount);
        const lineTotal = toNumber(detail.line_total, grossAmount - productDiscount);
        const ratio = invoiceSubtotal > 0 && lineTotal > 0 ? lineTotal / invoiceSubtotal : 0;
        const allocatedDiscount = invoiceDiscount * ratio;
        const taxAmount = invoiceVat * ratio;
        const netAmount = grossAmount - productDiscount - allocatedDiscount + taxAmount;
        const productName = getDetailProductName(detail, productsById);
        const sku = getDetailSku(detail, productsById);
        const type = detail.type || detail.item_type || (detail.combo_id ? 'combo' : 'product');
        const rowKey = [dateKey, type, detail.product_id || '', detail.variant_id || '', detail.combo_id || '', sku, productName].join('|');

        if (!rowMap.has(rowKey)) {
          rowMap.set(rowKey, {
            date: dateKey,
            productName,
            sku,
            type,
            productId: detail.product_id || null,
            variantId: detail.variant_id || null,
            comboId: detail.combo_id || null,
            quantitySold: 0,
            grossAmount: 0,
            productDiscount: 0,
            allocatedDiscount: 0,
            taxAmount: 0,
            netAmount: 0,
            orderCount: 0,
            _invoiceIds: new Set(),
          });
        }

        const row = rowMap.get(rowKey);
        row.quantitySold += quantity;
        row.grossAmount += grossAmount;
        row.productDiscount += productDiscount;
        row.allocatedDiscount += allocatedDiscount;
        row.taxAmount += taxAmount;
        row.netAmount += netAmount;
        row._invoiceIds.add(invoiceId);

        totalQuantity += quantity;
        totalGrossAmount += grossAmount;
        totalProductDiscount += productDiscount;
        totalAllocatedDiscount += allocatedDiscount;
        totalTaxAmount += taxAmount;
        totalNetAmount += netAmount;
      }
    }

    const rows = Array.from(rowMap.values())
      .map(row => ({
        ...row,
        quantitySold: roundMoney(row.quantitySold),
        grossAmount: roundMoney(row.grossAmount),
        productDiscount: roundMoney(row.productDiscount),
        allocatedDiscount: roundMoney(row.allocatedDiscount),
        taxAmount: roundMoney(row.taxAmount),
        netAmount: roundMoney(row.netAmount),
        orderCount: row._invoiceIds.size,
        _invoiceIds: undefined,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.productName.localeCompare(b.productName, 'vi') || String(a.sku || '').localeCompare(String(b.sku || ''), 'vi'));

    res.json({
      metadata: {
        from,
        to,
        period,
        generatedAt: new Date().toISOString(),
        status: statusFilter,
        timezone: PRODUCT_REPORT_TIMEZONE,
      },
      filters: {
        from,
        to,
        period,
        status: statusFilter,
        timezone: PRODUCT_REPORT_TIMEZONE,
      },
      summary: {
        orderCount: invoices.length,
        totalQuantity: roundMoney(totalQuantity),
        totalRevenue: roundMoney(invoices.reduce((sum, inv) => sum + toNumber(inv.total), 0)),
        grossAmount: roundMoney(totalGrossAmount),
        productDiscount: roundMoney(totalProductDiscount),
        allocatedDiscount: roundMoney(totalAllocatedDiscount),
        taxAmount: roundMoney(totalTaxAmount),
        netAmount: roundMoney(totalNetAmount),
      },
      rows,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: 'Lỗi khi lập báo cáo sản phẩm: ' + err.message });
  }
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
      isCompletedInvoiceStatus(inv.status) &&
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