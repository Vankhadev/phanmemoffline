/**
 * Service Kế toán: Phân tích Tuổi nợ (Debt Aging), Khách chậm thanh toán & Báo cáo công nợ doanh nghiệp
 * Giai đoạn 1: Backend Kế toán Deterministic & Phân tích số liệu theo Ngày / Tháng / Năm / Quý
 */

const {
  getAll,
  getOne,
  now,
  isCancelledInvoiceStatus,
  isInvoiceVisibleInActiveList,
  isCompletedInvoiceStatus,
} = require('../db/database');

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toMoney(value, fallback = 0) {
  return Math.max(0, Math.round(toNumber(value, fallback)));
}

/**
 * Chuẩn hóa khoảng thời gian dựa trên các tham số:
 * period_type: 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'custom'
 * year, month, quarter, from, to
 */
function resolveDateRange(query = {}) {
  const today = new Date();
  const yearNow = today.getFullYear();
  const monthNow = today.getMonth(); // 0-indexed

  let fromDate = '';
  let toDate = '';

  const periodType = String(query.period_type || '').trim().toLowerCase();

  if (query.year) {
    const y = Number(query.year) || yearNow;
    if (query.month) {
      const m = Math.max(1, Math.min(12, Number(query.month)));
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0);
      fromDate = start.toISOString().slice(0, 10);
      toDate = end.toISOString().slice(0, 10);
    } else if (query.quarter) {
      const q = Math.max(1, Math.min(4, Number(query.quarter)));
      const start = new Date(y, (q - 1) * 3, 1);
      const end = new Date(y, q * 3, 0);
      fromDate = start.toISOString().slice(0, 10);
      toDate = end.toISOString().slice(0, 10);
    } else {
      fromDate = `${y}-01-01`;
      toDate = `${y}-12-31`;
    }
  } else if (periodType === 'today') {
    const todayStr = today.toISOString().slice(0, 10);
    fromDate = todayStr;
    toDate = todayStr;
  } else if (periodType === 'yesterday') {
    const yest = new Date(today.getTime() - 86400000);
    const yestStr = yest.toISOString().slice(0, 10);
    fromDate = yestStr;
    toDate = yestStr;
  } else if (periodType === 'this_week') {
    const dayOfWeek = today.getDay(); // 0 is Sunday
    const distanceToMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(today.getTime() - distanceToMonday * 86400000);
    const sunday = new Date(monday.getTime() + 6 * 86400000);
    fromDate = monday.toISOString().slice(0, 10);
    toDate = sunday.toISOString().slice(0, 10);
  } else if (periodType === 'this_month') {
    const start = new Date(yearNow, monthNow, 1);
    const end = new Date(yearNow, monthNow + 1, 0);
    fromDate = start.toISOString().slice(0, 10);
    toDate = end.toISOString().slice(0, 10);
  } else if (periodType === 'last_month') {
    const start = new Date(yearNow, monthNow - 1, 1);
    const end = new Date(yearNow, monthNow, 0);
    fromDate = start.toISOString().slice(0, 10);
    toDate = end.toISOString().slice(0, 10);
  } else if (periodType === 'this_quarter') {
    const currentQ = Math.floor(monthNow / 3) + 1;
    const start = new Date(yearNow, (currentQ - 1) * 3, 1);
    const end = new Date(yearNow, currentQ * 3, 0);
    fromDate = start.toISOString().slice(0, 10);
    toDate = end.toISOString().slice(0, 10);
  } else if (periodType === 'this_year') {
    fromDate = `${yearNow}-01-01`;
    toDate = `${yearNow}-12-31`;
  } else if (query.from || query.to) {
    fromDate = String(query.from || '1970-01-01').trim().slice(0, 10);
    toDate = String(query.to || '2099-12-31').trim().slice(0, 10);
  } else {
    // Mặc định: Không giới hạn ngày để xem toàn bộ công nợ lũy kế hiện tại
    fromDate = '1970-01-01';
    toDate = '2099-12-31';
  }

  return { fromDate, toDate, periodType: periodType || (query.from ? 'custom' : 'all') };
}

/**
 * Tính số ngày giữa 2 mốc thời gian
 */
function diffDays(fromDate, toDate = new Date()) {
  const d1 = new Date(fromDate);
  const d2 = new Date(toDate);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 0;
  const diffMs = d2.getTime() - d1.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Phân loại nhóm tuổi nợ (Aging Bucket) theo chuẩn kế toán doanh nghiệp
 */
function getAgingBucket(debtDays) {
  const days = Math.max(0, Number(debtDays) || 0);
  if (days <= 15) return '0_15';
  if (days <= 30) return '16_30';
  if (days <= 60) return '31_60';
  return 'over_60';
}

function getAgingBucketLabel(bucket) {
  switch (bucket) {
    case '0_15': return '0 - 15 ngày (Trong hạn)';
    case '16_30': return '16 - 30 ngày (Quá hạn nhẹ)';
    case '31_60': return '31 - 60 ngày (Chậm thanh toán)';
    case 'over_60': return 'Trên 60 ngày (Rủi ro nợ)';
    default: return 'Không xác định';
  }
}

/**
 * Đánh giá mức độ rủi ro thu hồi nợ (Risk Level)
 */
function calculateRiskLevel(maxDebtDays, remainingDebt) {
  if (remainingDebt <= 0) return 'none';
  if (maxDebtDays > 60 || (maxDebtDays > 45 && remainingDebt >= 10000000)) return 'critical'; // Rất nguy hiểm
  if (maxDebtDays > 30 || remainingDebt >= 20000000) return 'high'; // Rủi ro cao
  if (maxDebtDays > 15) return 'medium'; // Rủi ro trung bình
  return 'low'; // Rủi ro thấp (trong hạn)
}

/**
 * Quét toàn bộ hóa đơn và tính toán công nợ chi tiết từng đơn và từng khách hàng
 */
function getDebtAgingAnalysis(options = {}) {
  const { fromDate, toDate, periodType } = resolveDateRange(options);
  const asOfDate = options.as_of_date ? new Date(options.as_of_date) : new Date();
  const search = String(options.search || options.q || '').trim().toLowerCase();
  const statusFilter = String(options.status || '').trim().toLowerCase(); // 'all' | 'overdue' | 'partial' | 'unpaid' | 'bad_debt'
  const bucketFilter = String(options.aging_bucket || '').trim().toLowerCase(); // '0_15' | '16_30' | '31_60' | 'over_60'
  const customerIdFilter = options.customer_id ? Number(options.customer_id) : null;

  const customersList = getAll('customers');
  const customersMap = new Map();
  customersList.forEach(c => {
    if (c && c.id) customersMap.set(Number(c.id), c);
  });

  // Khách lẻ mặc định
  const defaultRetailCustomer = {
    id: 1,
    name: 'Khách lẻ',
    phone: '',
    address: '',
    customer_code: 'KH0001',
  };

  const rawInvoices = getAll('invoices');

  // Lọc các hóa đơn hợp lệ (bỏ qua đơn bị hủy hoàn toàn)
  const validInvoices = rawInvoices.filter(inv => {
    if (!inv || !inv.id) return false;
    if (isCancelledInvoiceStatus(inv.status)) return false;
    if (!isInvoiceVisibleInActiveList(inv)) return false;
    return true;
  });

  const invoiceRows = [];
  const customerSummaryMap = new Map();

  for (const inv of validInvoices) {
    const invDateStr = String(inv.created_at || '').slice(0, 10);
    // Kiểm tra phạm vi ngày nếu có lọc ngày tạo đơn
    const inDateRange = (!fromDate || invDateStr >= fromDate) && (!toDate || invDateStr <= toDate);

    const total = toMoney(inv.total ?? inv.total_amount);
    let remaining = toMoney(inv.remaining_amount);
    let paid = toMoney(inv.paid_amount);

    // Chuẩn hóa số tiền: nếu còn nợ chưa khớp với tổng - đã trả
    if (remaining === 0 && paid === 0 && total > 0) {
      if (inv.status === 'completed' || inv.payment_status === 'paid') {
        paid = total;
        remaining = 0;
      } else {
        remaining = total;
      }
    } else if (remaining === 0 && paid > 0 && paid < total) {
      remaining = Math.max(0, total - paid);
    } else if (remaining > 0 && paid === 0 && remaining < total) {
      paid = Math.max(0, total - remaining);
    }

    const cId = inv.customer_id ? Number(inv.customer_id) : 1;
    const customerObj = customersMap.get(cId) || (cId === 1 ? defaultRetailCustomer : { id: cId, name: `Khách hàng #${cId}`, phone: '' });

    // Lọc theo customerIdFilter nếu có
    if (customerIdFilter && cId !== customerIdFilter) continue;

    // Tính toán số ngày nợ và ngày trễ hạn
    const invDate = new Date(inv.created_at || asOfDate);
    const debtAgeDays = diffDays(invDate, asOfDate);

    // Tính số ngày quá hạn (Days past due)
    let daysOverdue = 0;
    if (inv.due_date) {
      const dueDate = new Date(inv.due_date);
      daysOverdue = diffDays(dueDate, asOfDate);
      if (asOfDate < dueDate) daysOverdue = 0; // Chưa tới hạn
    } else {
      // Nếu không có due_date, coi ngày nợ > 0 là phát sinh nợ
      daysOverdue = debtAgeDays;
    }

    const agingBucket = getAgingBucket(debtAgeDays);

    // Xác định trạng thái thanh toán & công nợ
    let paymentStatus = 'paid';
    if (remaining > 0) {
      if (debtAgeDays > 60) {
        paymentStatus = 'bad_debt';
      } else if (daysOverdue > 15 || debtAgeDays > 15) {
        paymentStatus = 'overdue';
      } else if (paid > 0) {
        paymentStatus = 'partial';
      } else {
        paymentStatus = 'unpaid';
      }
    }

    const paymentProgressPercent = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 100;

    const row = {
      invoice_id: inv.id,
      invoice_code: inv.invoice_code || `HD${String(inv.id).padStart(5, '0')}`,
      customer_id: cId,
      customer_name: customerObj.name || 'Khách lẻ',
      customer_phone: customerObj.phone || '',
      customer_address: customerObj.address || '',
      invoice_date: invDateStr,
      created_at: inv.created_at,
      due_date: inv.due_date ? String(inv.due_date).slice(0, 10) : null,
      total_amount: total,
      paid_amount: paid,
      remaining_amount: remaining,
      payment_progress_percent: paymentProgressPercent,
      debt_age_days: debtAgeDays,
      days_overdue: daysOverdue,
      aging_bucket: agingBucket,
      aging_bucket_label: getAgingBucketLabel(agingBucket),
      payment_status: paymentStatus,
      is_overdue: remaining > 0 && daysOverdue > 15,
      is_partial: remaining > 0 && paid > 0,
      is_unpaid: remaining > 0 && paid === 0,
      note: inv.note || '',
      in_date_range: inDateRange,
    };

    // Chỉ đưa vào danh sách nếu đơn có nợ hoặc nằm trong kỳ lọc
    if (remaining > 0 || inDateRange) {
      // Lọc search
      if (search) {
        const matchSearch = String(row.invoice_code).toLowerCase().includes(search)
          || String(row.customer_name).toLowerCase().includes(search)
          || String(row.customer_phone).toLowerCase().includes(search);
        if (!matchSearch) continue;
      }

      // Lọc status
      if (statusFilter && statusFilter !== 'all') {
        if (statusFilter === 'overdue' && !row.is_overdue && paymentStatus !== 'bad_debt') continue;
        if (statusFilter === 'partial' && !row.is_partial) continue;
        if (statusFilter === 'unpaid' && !row.is_unpaid) continue;
        if (statusFilter === 'bad_debt' && paymentStatus !== 'bad_debt') continue;
        if (statusFilter === 'paid' && remaining > 0) continue;
      }

      // Lọc aging bucket
      if (bucketFilter && bucketFilter !== 'all' && row.aging_bucket !== bucketFilter) {
        continue;
      }

      invoiceRows.push(row);
    }

    // Tổng hợp theo khách hàng (chỉ tính các đơn còn nợ > 0 hoặc phát sinh trong kỳ)
    if (!customerSummaryMap.has(cId)) {
      customerSummaryMap.set(cId, {
        customer_id: cId,
        customer_code: customerObj.code || customerObj.customer_code || `KH${String(cId).padStart(4, '0')}`,
        customer_name: customerObj.name || 'Khách lẻ',
        customer_phone: customerObj.phone || '',
        customer_address: customerObj.address || '',
        total_invoices_count: 0,
        unpaid_invoices_count: 0,
        total_purchased_amount: 0,
        total_paid_amount: 0,
        total_remaining_debt: 0,
        aging_0_15: 0,
        aging_16_30: 0,
        aging_31_60: 0,
        aging_over_60: 0,
        max_debt_days: 0,
        oldest_invoice_date: null,
        overdue_invoices_count: 0,
        invoices: [],
      });
    }

    const cSummary = customerSummaryMap.get(cId);
    if (inDateRange) {
      cSummary.total_invoices_count += 1;
      cSummary.total_purchased_amount += total;
      cSummary.total_paid_amount += paid;
    }

    if (remaining > 0) {
      cSummary.unpaid_invoices_count += 1;
      cSummary.total_remaining_debt += remaining;

      if (row.is_overdue) cSummary.overdue_invoices_count += 1;

      // Phân bổ nợ theo từng cột tuổi nợ
      if (agingBucket === '0_15') cSummary.aging_0_15 += remaining;
      else if (agingBucket === '16_30') cSummary.aging_16_30 += remaining;
      else if (agingBucket === '31_60') cSummary.aging_31_60 += remaining;
      else if (agingBucket === 'over_60') cSummary.aging_over_60 += remaining;

      if (debtAgeDays > cSummary.max_debt_days) {
        cSummary.max_debt_days = debtAgeDays;
        cSummary.oldest_invoice_date = invDateStr;
      }

      cSummary.invoices.push(row);
    }
  }

  // Chuyển summary sang danh sách khách hàng và bổ sung trường đánh giá
  let customerList = Array.from(customerSummaryMap.values())
    .map(c => {
      const paymentProgress = c.total_purchased_amount > 0
        ? Math.min(100, Math.round((c.total_paid_amount / c.total_purchased_amount) * 100))
        : 100;

      const riskLevel = calculateRiskLevel(c.max_debt_days, c.total_remaining_debt);

      return {
        ...c,
        payment_progress_percent: paymentProgress,
        risk_level: riskLevel,
        has_overdue: c.overdue_invoices_count > 0 || c.max_debt_days > 15,
      };
    })
    // Mặc định ưu tiên khách có nợ lớn nhất và trễ hạn lâu nhất lên đầu
    .sort((a, b) => b.total_remaining_debt - a.total_remaining_debt || b.max_debt_days - a.max_debt_days);

  // Lọc khách hàng theo search hoặc status nếu có
  if (search) {
    customerList = customerList.filter(c =>
      c.customer_name.toLowerCase().includes(search)
      || c.customer_phone.toLowerCase().includes(search)
      || c.customer_code.toLowerCase().includes(search)
    );
  }

  if (statusFilter && statusFilter !== 'all') {
    if (statusFilter === 'overdue') {
      customerList = customerList.filter(c => c.has_overdue);
    } else if (statusFilter === 'bad_debt') {
      customerList = customerList.filter(c => c.risk_level === 'critical');
    } else if (statusFilter === 'unpaid') {
      customerList = customerList.filter(c => c.total_remaining_debt > 0 && c.total_paid_amount === 0);
    } else if (statusFilter === 'partial') {
      customerList = customerList.filter(c => c.total_remaining_debt > 0 && c.total_paid_amount > 0);
    }
  }

  if (bucketFilter && bucketFilter !== 'all') {
    customerList = customerList.filter(c => {
      if (bucketFilter === '0_15') return c.aging_0_15 > 0;
      if (bucketFilter === '16_30') return c.aging_16_30 > 0;
      if (bucketFilter === '31_60') return c.aging_31_60 > 0;
      if (bucketFilter === 'over_60') return c.aging_over_60 > 0;
      return true;
    });
  }

  // Sắp xếp danh sách hóa đơn theo ngày nợ giảm dần
  invoiceRows.sort((a, b) => b.debt_age_days - a.debt_age_days || b.remaining_amount - a.remaining_amount);

  // Tính toán các chỉ số KPI Tài chính toàn hệ thống (Executive Summary)
  const totalReceivable = customerList.reduce((sum, c) => sum + c.total_remaining_debt, 0);
  const totalAging0_15 = customerList.reduce((sum, c) => sum + c.aging_0_15, 0);
  const totalAging16_30 = customerList.reduce((sum, c) => sum + c.aging_16_30, 0);
  const totalAging31_60 = customerList.reduce((sum, c) => sum + c.aging_31_60, 0);
  const totalAgingOver60 = customerList.reduce((sum, c) => sum + c.aging_over_60, 0);

  const totalOverdueAmount = totalAging16_30 + totalAging31_60 + totalAgingOver60;
  const overdueCustomerCount = customerList.filter(c => c.has_overdue && c.total_remaining_debt > 0).length;
  const debtorCustomerCount = customerList.filter(c => c.total_remaining_debt > 0).length;

  const kpiSummary = {
    total_receivable: totalReceivable,
    total_overdue: totalOverdueAmount,
    overdue_percentage: totalReceivable > 0 ? Math.round((totalOverdueAmount / totalReceivable) * 100) : 0,
    total_in_term: totalAging0_15,
    bad_debt_risk_amount: totalAgingOver60,
    debtor_customer_count: debtorCustomerCount,
    overdue_customer_count: overdueCustomerCount,
    total_unpaid_invoices: customerList.reduce((sum, c) => sum + c.unpaid_invoices_count, 0),
    aging_breakdown: {
      bucket_0_15: {
        amount: totalAging0_15,
        percentage: totalReceivable > 0 ? Math.round((totalAging0_15 / totalReceivable) * 100) : 0,
        label: '0 - 15 ngày (Trong hạn)',
      },
      bucket_16_30: {
        amount: totalAging16_30,
        percentage: totalReceivable > 0 ? Math.round((totalAging16_30 / totalReceivable) * 100) : 0,
        label: '16 - 30 ngày (Quá hạn nhẹ)',
      },
      bucket_31_60: {
        amount: totalAging31_60,
        percentage: totalReceivable > 0 ? Math.round((totalAging31_60 / totalReceivable) * 100) : 0,
        label: '31 - 60 ngày (Cần nhắc nợ)',
      },
      bucket_over_60: {
        amount: totalAgingOver60,
        percentage: totalReceivable > 0 ? Math.round((totalAgingOver60 / totalReceivable) * 100) : 0,
        label: 'Trên 60 ngày (Rủi ro nợ xấu)',
      },
    },
  };

  // Tạo ngữ cảnh cô đọng sẵn cho AI Gemini (AI Context Block)
  const topDebtors = customerList.slice(0, 5).map(c => ({
    name: c.customer_name,
    phone: c.customer_phone,
    debt: c.total_remaining_debt,
    max_days: c.max_debt_days,
    risk: c.risk_level,
  }));

  const aiSummaryContext = {
    generated_at: now(),
    period: { fromDate, toDate, periodType },
    overview: `Tổng nợ phải thu: ${totalReceivable.toLocaleString('vi-VN')} đ. Trong đó nợ quá hạn: ${totalOverdueAmount.toLocaleString('vi-VN')} đ (${kpiSummary.overdue_percentage}%). Số khách nợ: ${debtorCustomerCount} (có ${overdueCustomerCount} khách quá hạn).`,
    aging_summary: `Trong hạn (0-15 ngày): ${totalAging0_15.toLocaleString('vi-VN')} đ; Quá hạn 16-30 ngày: ${totalAging16_30.toLocaleString('vi-VN')} đ; Quá hạn 31-60 ngày: ${totalAging31_60.toLocaleString('vi-VN')} đ; Nợ xấu >60 ngày: ${totalAgingOver60.toLocaleString('vi-VN')} đ.`,
    top_5_debtors: topDebtors,
  };

  // Phân trang nếu được yêu cầu
  const page = options.page ? Math.max(1, Number(options.page) || 1) : null;
  const limit = options.limit ? Math.min(200, Math.max(1, Number(options.limit) || 50)) : null;

  let paginatedCustomers = customerList;
  let customerPagination = null;
  if (page && limit) {
    const total = customerList.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    paginatedCustomers = customerList.slice(offset, offset + limit);
    customerPagination = { page, limit, total, total_pages: totalPages };
  }

  let paginatedInvoices = invoiceRows;
  let invoicePagination = null;
  if (page && limit) {
    const total = invoiceRows.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    paginatedInvoices = invoiceRows.slice(offset, offset + limit);
    invoicePagination = { page, limit, total, total_pages: totalPages };
  }

  return {
    ok: true,
    as_of_date: asOfDate.toISOString(),
    filter_period: {
      from: fromDate,
      to: toDate,
      period_type: periodType,
    },
    kpi_summary: kpiSummary,
    customer_summary: paginatedCustomers,
    customer_pagination: customerPagination,
    invoice_details: paginatedInvoices,
    invoice_pagination: invoicePagination,
    ai_summary_context: aiSummaryContext,
  };
}

/**
 * Trích xuất chi tiết công nợ cho 1 khách hàng cụ thể
 */
function getSingleCustomerDebtReport(customerId, options = {}) {
  const result = getDebtAgingAnalysis({ ...options, customer_id: customerId });
  const customer = (result.customer_summary || []).find(c => Number(c.customer_id) === Number(customerId)) || null;
  const invoices = (result.invoice_details || []).filter(inv => Number(inv.customer_id) === Number(customerId));

  return {
    ok: true,
    customer,
    invoices,
    as_of_date: result.as_of_date,
    filter_period: result.filter_period,
  };
}

/**
 * Xuất file Excel Báo cáo Tuổi nợ & Khách chậm thanh toán tiêu chuẩn
 * @param {object} options Các bộ lọc (from, to, period_type, status, aging_bucket...)
 * @returns {PassThrough} Stream ghi file Excel .xlsx
 */
function exportDebtAgingExcel(options = {}) {
  const ExcelJS = require('exceljs');
  const { PassThrough } = require('stream');
  const stream = new PassThrough();

  process.nextTick(async () => {
    try {
      const report = getDebtAgingAnalysis({ ...options, page: null, limit: null });
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Bán Hàng Pos - Kế toán AI';
      workbook.created = new Date();

      const borderStyle = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };

      const headerFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E3A8A' }, // Navy blue tiêu chuẩn kế toán
      };

      const headerFont = {
        name: 'Segoe UI',
        size: 11,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };

      // ==========================================
      // SHEET 1: TỔNG HỢP CÔNG NỢ THEO KHÁCH HÀNG
      // ==========================================
      const ws1 = workbook.addWorksheet('Tổng hợp công nợ KH');
      ws1.views = [{ showGridLines: true }];

      // Tiêu đề báo cáo
      ws1.mergeCells('A1:M1');
      const titleCell1 = ws1.getCell('A1');
      titleCell1.value = 'BÁO CÁO PHÂN TÍCH TUỔI NỢ & CHẬM THANH TOÁN';
      titleCell1.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FF1E3A8A' } };
      titleCell1.alignment = { horizontal: 'center', vertical: 'middle' };
      ws1.getRow(1).height = 32;

      ws1.mergeCells('A2:M2');
      const subTitle1 = ws1.getCell('A2');
      subTitle1.value = `Kỳ báo cáo: Từ ngày ${report.filter_period.from} đến ngày ${report.filter_period.to} | Ngày lập: ${now().slice(0, 10)}`;
      subTitle1.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF64748B' } };
      subTitle1.alignment = { horizontal: 'center', vertical: 'middle' };
      ws1.getRow(2).height = 20;

      // Header row
      const headers1 = [
        'STT',
        'Mã KH',
        'Tên khách hàng',
        'Số điện thoại',
        'Tổng mua',
        'Đã thanh toán',
        'Còn nợ',
        '0 - 15 ngày',
        '16 - 30 ngày',
        '31 - 60 ngày',
        '> 60 ngày (Nợ xấu)',
        'Tuổi nợ lớn nhất (ngày)',
        'Mức độ rủi ro',
      ];

      const headerRow1 = ws1.addRow(headers1);
      headerRow1.height = 28;
      headerRow1.eachCell((cell) => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = borderStyle;
      });

      // Data rows
      let rowIndex = 1;
      let sumPurchased = 0;
      let sumPaid = 0;
      let sumDebt = 0;
      let sumAging0 = 0;
      let sumAging16 = 0;
      let sumAging31 = 0;
      let sumAgingOver60 = 0;

      (report.customer_summary || []).forEach(c => {
        sumPurchased += c.total_purchased_amount;
        sumPaid += c.total_paid_amount;
        sumDebt += c.total_remaining_debt;
        sumAging0 += c.aging_0_15;
        sumAging16 += c.aging_16_30;
        sumAging31 += c.aging_31_60;
        sumAgingOver60 += c.aging_over_60;

        const row = ws1.addRow([
          rowIndex++,
          c.customer_code,
          c.customer_name,
          c.customer_phone,
          c.total_purchased_amount,
          c.total_paid_amount,
          c.total_remaining_debt,
          c.aging_0_15,
          c.aging_16_30,
          c.aging_31_60,
          c.aging_over_60,
          c.max_debt_days,
          c.risk_level === 'critical' ? 'Rất cao (Nợ xấu)' : (c.risk_level === 'high' ? 'Cao' : (c.risk_level === 'medium' ? 'Trung bình' : 'Thấp')),
        ]);

        row.height = 22;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.border = borderStyle;
          cell.font = { name: 'Segoe UI', size: 10 };
          // Format tiền tệ cho các cột 5 -> 11
          if (colNumber >= 5 && colNumber <= 11) {
            cell.numFmt = '#,##0';
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          } else if (colNumber === 1 || colNumber === 12 || colNumber === 13) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else {
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          }
        });
      });

      // Dòng Tổng Cộng
      const totalRow1 = ws1.addRow([
        'TỔNG',
        '',
        `Tổng cộng (${report.customer_summary.length} khách)`,
        '',
        sumPurchased,
        sumPaid,
        sumDebt,
        sumAging0,
        sumAging16,
        sumAging31,
        sumAgingOver60,
        '',
        '',
      ]);
      totalRow1.height = 26;
      totalRow1.eachCell((cell, colNumber) => {
        cell.font = { name: 'Segoe UI', size: 10, bold: true };
        cell.border = borderStyle;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        if (colNumber >= 5 && colNumber <= 11) {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });

      // Auto-fit độ rộng cột
      ws1.columns = [
        { width: 6 },
        { width: 12 },
        { width: 28 },
        { width: 15 },
        { width: 16 },
        { width: 16 },
        { width: 16 },
        { width: 15 },
        { width: 15 },
        { width: 15 },
        { width: 18 },
        { width: 18 },
        { width: 16 },
      ];

      // ==========================================
      // SHEET 2: CHI TIẾT TỪNG HÓA ĐƠN NỢ
      // ==========================================
      const ws2 = workbook.addWorksheet('Chi tiết hóa đơn nợ');
      ws2.views = [{ showGridLines: true }];

      ws2.mergeCells('A1:M1');
      const titleCell2 = ws2.getCell('A1');
      titleCell2.value = 'CHI TIẾT HÓA ĐƠN CÔNG NỢ & QUÁ HẠN THANH TOÁN';
      titleCell2.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FF1E3A8A' } };
      titleCell2.alignment = { horizontal: 'center', vertical: 'middle' };
      ws2.getRow(1).height = 32;

      const headers2 = [
        'STT',
        'Mã hóa đơn',
        'Ngày mua',
        'Hạn thanh toán',
        'Tên khách hàng',
        'Số điện thoại',
        'Tổng tiền',
        'Đã thanh toán',
        'Còn nợ',
        'Tuổi nợ (ngày)',
        'Quá hạn (ngày)',
        'Nhóm tuổi nợ',
        'Trạng thái',
      ];

      const headerRow2 = ws2.addRow(headers2);
      headerRow2.height = 28;
      headerRow2.eachCell((cell) => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = borderStyle;
      });

      let invIndex = 1;
      (report.invoice_details || []).forEach(inv => {
        const row = ws2.addRow([
          invIndex++,
          inv.invoice_code,
          inv.invoice_date,
          inv.due_date || 'Không có',
          inv.customer_name,
          inv.customer_phone,
          inv.total_amount,
          inv.paid_amount,
          inv.remaining_amount,
          inv.debt_age_days,
          inv.days_overdue,
          inv.aging_bucket_label,
          inv.payment_status === 'bad_debt' ? 'Rủi ro nợ xấu' : (inv.is_overdue ? 'Quá hạn' : (inv.is_partial ? 'Đang trả dở' : 'Chưa trả')),
        ]);

        row.height = 20;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.border = borderStyle;
          cell.font = { name: 'Segoe UI', size: 10 };
          if (colNumber >= 7 && colNumber <= 9) {
            cell.numFmt = '#,##0';
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          } else if (colNumber === 1 || colNumber === 3 || colNumber === 4 || colNumber === 10 || colNumber === 11 || colNumber === 13) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          } else {
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          }
        });
      });

      ws2.columns = [
        { width: 6 },
        { width: 14 },
        { width: 13 },
        { width: 14 },
        { width: 26 },
        { width: 15 },
        { width: 16 },
        { width: 16 },
        { width: 16 },
        { width: 14 },
        { width: 14 },
        { width: 24 },
        { width: 16 },
      ];

      await workbook.xlsx.write(stream);
      stream.end();
    } catch (err) {
      stream.destroy(err);
    }
  });

  return stream;
}

module.exports = {
  getDebtAgingAnalysis,
  getSingleCustomerDebtReport,
  exportDebtAgingExcel,
  resolveDateRange,
  getAgingBucket,
  getAgingBucketLabel,
};

