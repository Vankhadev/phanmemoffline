const {
  getAll,
  getOne,
  insert,
  update,
  now,
  normalizeDateKey,
  normalizePaymentMethod,
  getActiveAccountId,
  isCompletedInvoiceStatus,
} = require('../db/database');

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toMoney(value, fallback = 0) {
  return Math.max(0, toNumber(value, fallback));
}

function roundMoney(value) {
  return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
}

function normalizeTimestamp(value, fallback = now()) {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function sourceId(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function sameSource(row, sourceType, id) {
  return row && String(row.source_type || '') === String(sourceType || '') && String(row.source_id) === String(id);
}

function getActor(options = {}) {
  return options.userId || options.createdBy || options.req?.user?.id || null;
}

function getAccountId(source = {}, options = {}) {
  return options.accountId || options.req?.accountId || source.account_id || getActiveAccountId();
}

function writeOptions(options = {}) {
  return {
    skipSave: options.skipSave === true,
    accountId: options.accountId || undefined,
  };
}

function upsertAccountingTransaction(payload = {}, options = {}) {
  const accountId = payload.account_id || getAccountId(payload, options);
  const key = String(payload.idempotency_key || `${payload.source_type}:${payload.source_id}:${payload.source_action}:${payload.account_code || ''}`);
  const existing = getOne('accounting_transactions', row => row && row.idempotency_key === key);
  const timestamp = normalizeTimestamp(payload.updated_at || options.timestamp);
  const normalized = {
    account_id: accountId,
    transaction_date: payload.transaction_date || normalizeDateKey(payload.posted_at || timestamp) || timestamp.slice(0, 10),
    posted_at: normalizeTimestamp(payload.posted_at || timestamp),
    source_type: payload.source_type || '',
    source_id: sourceId(payload.source_id),
    source_code: payload.source_code || '',
    source_action: payload.source_action || '',
    direction: payload.direction || (toMoney(payload.debit_amount) > 0 ? 'debit' : 'credit'),
    account_code: payload.account_code || '',
    account_name: payload.account_name || '',
    debit_amount: roundMoney(payload.debit_amount),
    credit_amount: roundMoney(payload.credit_amount),
    amount: roundMoney(payload.amount !== undefined ? payload.amount : Math.max(toMoney(payload.debit_amount), toMoney(payload.credit_amount))),
    currency: payload.currency || 'VND',
    description: payload.description || '',
    customer_id: payload.customer_id || null,
    partner_id: payload.partner_id || null,
    tax_report_id: payload.tax_report_id || null,
    revenue_report_id: payload.revenue_report_id || null,
    profit_report_id: payload.profit_report_id || null,
    idempotency_key: key,
    reversal_of_id: payload.reversal_of_id || null,
    status: payload.status || 'posted',
    created_by: payload.created_by || getActor(options),
    updated_at: timestamp,
  };

  if (existing) {
    return update('accounting_transactions', existing.id, normalized, writeOptions({ ...options, accountId }));
  }
  const id = insert('accounting_transactions', {
    ...normalized,
    created_at: normalizeTimestamp(payload.created_at || timestamp),
  }, writeOptions({ ...options, accountId }));
  return getOne('accounting_transactions', row => Number(row.id) === Number(id));
}

function upsertCashFundFromSource(source = {}, options = {}) {
  const sourceType = options.sourceType || source.source_type || '';
  const id = options.sourceId || source.source_id || source.id;
  const accountId = getAccountId(source, options);
  const timestamp = normalizeTimestamp(options.timestamp || source.updated_at || source.created_at);
  const existing = getOne('cash_fund', row => sameSource(row, sourceType, id) && String(row.source_action || '') === String(options.sourceAction || 'payment'));
  const amount = roundMoney(options.amount);
  const active = options.active === false || amount <= 0 ? 0 : 1;
  const method = normalizePaymentMethod(options.paymentMethod || source.payment_method || 'cash') || 'cash';
  const payload = {
    account_id: accountId,
    date: options.date || normalizeDateKey(timestamp) || timestamp.slice(0, 10),
    time: options.time || timestamp.slice(11, 19),
    fund_type: options.fundType || (method === 'bank' || method === 'transfer' ? 'bank' : 'cash'),
    bank_account_id: options.bankAccountId || source.bank_account_id || null,
    type: options.type === 'expense' ? 'expense' : 'income',
    category: options.category || '',
    amount,
    payment_method: method,
    note: options.note || '',
    source_type: sourceType,
    source_id: sourceId(id),
    source_action: options.sourceAction || 'payment',
    cash_book_id: options.cashBookId || null,
    active,
    voided_at: active ? null : (options.voidedAt || timestamp),
    void_reason: active ? '' : (options.voidReason || 'source_reversed'),
    created_by: getActor(options),
    updated_at: timestamp,
  };

  if (existing) return update('cash_fund', existing.id, payload, writeOptions({ ...options, accountId }));
  const rowId = insert('cash_fund', { ...payload, created_at: timestamp }, writeOptions({ ...options, accountId }));
  return getOne('cash_fund', row => Number(row.id) === Number(rowId));
}

function voidCashFundBySource(sourceType, id, options = {}) {
  const timestamp = normalizeTimestamp(options.timestamp);
  const rows = getAll('cash_fund', row => sameSource(row, sourceType, id) && row.active !== 0);
  return rows.map(row => update('cash_fund', row.id, {
    active: 0,
    voided_at: timestamp,
    void_reason: options.reason || 'source_reversed',
    updated_at: timestamp,
  }, writeOptions(options)));
}

function upsertCustomerDebtFromInvoice(invoice = {}, options = {}) {
  if (!invoice.id) return null;
  const accountId = getAccountId(invoice, options);
  const timestamp = normalizeTimestamp(options.timestamp || invoice.updated_at || invoice.created_at);
  const total = toMoney(invoice.total);
  // Clamp remaining vao [0, total] de khong bao gio sinh cong no am.
  const remaining = isCompletedInvoiceStatus(invoice.status)
    ? Math.min(Math.max(0, toMoney(invoice.remaining_amount)), Math.max(0, total))
    : 0;
  const paid = Math.max(0, total - remaining);
  const existing = getOne('customer_debts', row => Number(row.invoice_id) === Number(invoice.id));
  const payload = {
    account_id: accountId,
    customer_id: invoice.customer_id || null,
    invoice_id: invoice.id,
    debt_date: normalizeDateKey(invoice.created_at || timestamp) || timestamp.slice(0, 10),
    source_code: invoice.invoice_code || '',
    opening_amount: 0,
    increase_amount: roundMoney(total),
    decrease_amount: roundMoney(paid),
    remaining_amount: roundMoney(remaining),
    status: remaining > 0 ? (paid > 0 ? 'partial' : 'unpaid') : (isCompletedInvoiceStatus(invoice.status) ? 'paid' : 'reversed'),
    due_date: invoice.due_date || null,
    note: options.note || `Công nợ hóa đơn ${invoice.invoice_code || invoice.id}`,
    updated_at: timestamp,
  };
  if (existing) return update('customer_debts', existing.id, payload, writeOptions({ ...options, accountId }));
  const id = insert('customer_debts', { ...payload, created_at: timestamp }, writeOptions({ ...options, accountId }));
  return getOne('customer_debts', row => Number(row.id) === Number(id));
}

function upsertSupplierDebtFromImport(importLog = {}, options = {}) {
  if (!importLog.id) return null;
  const accountId = getAccountId(importLog, options);
  const timestamp = normalizeTimestamp(options.timestamp || importLog.updated_at || importLog.created_at);
  const active = String(importLog.status || '').toLowerCase() === 'received' && importLog.deleted !== true;
  const total = toMoney(importLog.total);
  const paid = active ? Math.min(total, toMoney(importLog.paid_amount)) : 0;
  const remaining = active ? Math.max(0, toNumber(importLog.remaining_amount, total - paid)) : 0;
  const existing = getOne('supplier_debts', row => Number(row.import_id) === Number(importLog.id));
  const payload = {
    account_id: accountId,
    partner_id: importLog.partner_id || null,
    import_id: importLog.id,
    debt_date: normalizeDateKey(importLog.created_at || timestamp) || timestamp.slice(0, 10),
    source_code: importLog.import_code || '',
    opening_amount: 0,
    increase_amount: roundMoney(total),
    decrease_amount: roundMoney(active ? total - remaining : 0),
    remaining_amount: roundMoney(remaining),
    status: !active ? 'reversed' : (remaining > 0 ? (paid > 0 ? 'partial' : 'unpaid') : 'paid'),
    due_date: importLog.due_date || null,
    note: options.note || `Công nợ phiếu nhập ${importLog.import_code || importLog.id}`,
    updated_at: timestamp,
  };
  if (existing) return update('supplier_debts', existing.id, payload, writeOptions({ ...options, accountId }));
  const id = insert('supplier_debts', { ...payload, created_at: timestamp }, writeOptions({ ...options, accountId }));
  return getOne('supplier_debts', row => Number(row.id) === Number(id));
}

function upsertEinvoiceOut(invoice = {}, options = {}) {
  if (!invoice.id) return null;
  const accountId = getAccountId(invoice, options);
  const timestamp = normalizeTimestamp(options.timestamp || invoice.updated_at || invoice.created_at);
  const customer = invoice.customer_id ? getOne('customers', row => Number(row.id) === Number(invoice.customer_id)) : null;
  const existing = getOne('einvoice_out', row => row.source_type === 'invoice' && Number(row.source_id) === Number(invoice.id));
  const payload = {
    account_id: accountId,
    invoice_no: invoice.einvoice_no || invoice.invoice_no || invoice.invoice_code || '',
    symbol: invoice.einvoice_symbol || invoice.symbol || '',
    template_code: invoice.einvoice_template_code || invoice.template_code || '',
    invoice_date: normalizeDateKey(invoice.invoice_date || invoice.created_at || timestamp) || timestamp.slice(0, 10),
    buyer_tax_code: invoice.buyer_tax_code || invoice.customer_tax_code || customer?.tax_code || '',
    buyer_name: invoice.buyer_name || invoice.customer_name || customer?.name || '',
    customer_id: invoice.customer_id || null,
    invoice_id: invoice.id,
    subtotal: roundMoney(invoice.subtotal),
    vat_rate: toNumber(invoice.vat_percent, 0),
    vat_amount: roundMoney(invoice.vat_amount),
    total: roundMoney(invoice.total),
    xml_hash: invoice.xml_hash || invoice.einvoice_xml_hash || '',
    raw_xml: invoice.raw_xml || invoice.einvoice_raw_xml || '',
    source_type: 'invoice',
    source_id: invoice.id,
    status: isCompletedInvoiceStatus(invoice.status) ? 'issued' : 'cancelled',
    updated_at: timestamp,
  };
  if (existing) return update('einvoice_out', existing.id, payload, writeOptions({ ...options, accountId }));
  const id = insert('einvoice_out', { ...payload, created_at: timestamp }, writeOptions({ ...options, accountId }));
  return getOne('einvoice_out', row => Number(row.id) === Number(id));
}

function summarizeImportDetails(details = []) {
  return (details || []).reduce((summary, detail) => {
    summary.subtotal += toMoney(detail.taxable_amount, toMoney(detail.line_subtotal, toMoney(detail.quantity) * toMoney(detail.import_price)));
    summary.vat += toMoney(detail.vat_amount, toMoney(detail.tax_amount));
    summary.total += toMoney(detail.line_total, toMoney(detail.taxable_amount) + toMoney(detail.vat_amount, detail.tax_amount));
    return summary;
  }, { subtotal: 0, vat: 0, total: 0 });
}

function upsertEinvoiceIn(importLog = {}, details = [], options = {}) {
  if (!importLog.id) return null;
  const accountId = getAccountId(importLog, options);
  const timestamp = normalizeTimestamp(options.timestamp || importLog.updated_at || importLog.created_at);
  const partner = importLog.partner_id ? getOne('partners', row => Number(row.id) === Number(importLog.partner_id)) : null;
  const summary = summarizeImportDetails(details);
  const active = String(importLog.status || '').toLowerCase() === 'received' && importLog.deleted !== true;
  const existing = getOne('einvoice_in', row => row.source_type === 'import' && Number(row.source_id) === Number(importLog.id));
  const payload = {
    account_id: accountId,
    invoice_no: importLog.einvoice_no || importLog.invoice_no || importLog.import_code || '',
    symbol: importLog.einvoice_symbol || importLog.symbol || '',
    template_code: importLog.einvoice_template_code || importLog.template_code || '',
    invoice_date: normalizeDateKey(importLog.invoice_date || importLog.created_at || timestamp) || timestamp.slice(0, 10),
    supplier_tax_code: importLog.supplier_tax_code || partner?.tax_code || '',
    supplier_name: importLog.supplier_name || partner?.name || '',
    partner_id: importLog.partner_id || null,
    import_id: importLog.id,
    subtotal: roundMoney(summary.subtotal),
    vat_rate: details.length === 1 ? toNumber(details[0]?.vat_percent ?? details[0]?.tax_percent, 0) : null,
    vat_amount: roundMoney(summary.vat),
    total: roundMoney(importLog.total || summary.total),
    xml_hash: importLog.xml_hash || importLog.einvoice_xml_hash || '',
    raw_xml: importLog.raw_xml || importLog.einvoice_raw_xml || '',
    source_type: 'import',
    source_id: importLog.id,
    status: active ? 'valid' : 'cancelled',
    updated_at: timestamp,
  };
  if (existing) return update('einvoice_in', existing.id, payload, writeOptions({ ...options, accountId }));
  const id = insert('einvoice_in', { ...payload, created_at: timestamp }, writeOptions({ ...options, accountId }));
  return getOne('einvoice_in', row => Number(row.id) === Number(id));
}

function calculateInvoiceCost(details = []) {
  return roundMoney((details || []).reduce((sum, detail) => {
    const cost = [
      detail.cost_price_at_sale,
      detail.import_price,
      detail.cost_price,
      detail.purchase_price,
    ].map(value => toMoney(value, 0)).find(value => value > 0) || 0;
    return sum + toMoney(detail.quantity) * cost;
  }, 0));
}

function calculateInvoiceRevenue(invoice = {}) {
  const total = toMoney(invoice.total);
  const vat = toMoney(invoice.vat_amount);
  const subtotal = toMoney(invoice.subtotal);
  const discount = toMoney(invoice.discount_amount);
  const deliveryFee = toMoney(invoice.delivery_fee);
  const hasSubtotal = invoice.subtotal !== undefined && invoice.subtotal !== null && String(invoice.subtotal).trim() !== '';
  const baseRevenue = hasSubtotal ? subtotal : Math.max(0, total - vat);
  const revenue = baseRevenue + deliveryFee - discount;
  return roundMoney(Math.max(0, revenue));
}

function buildInvoiceTransactions(invoice, details, options = {}) {
  const timestamp = normalizeTimestamp(options.timestamp || invoice.updated_at || invoice.created_at);
  const revenue = calculateInvoiceRevenue(invoice);
  const vat = roundMoney(invoice.vat_amount);
  const total = roundMoney(invoice.total);
  const remaining = Math.min(total, toMoney(invoice.remaining_amount));
  const paid = roundMoney(Math.max(0, total - remaining));
  const cost = calculateInvoiceCost(details);
  const paymentMethod = normalizePaymentMethod(invoice.payment_method || 'cash') || 'cash';
  const cashAccount = paymentMethod === 'bank' || paymentMethod === 'transfer' ? ['112', 'Tiền gửi ngân hàng'] : ['111', 'Tiền mặt'];
  const common = {
    account_id: getAccountId(invoice, options),
    source_type: 'invoice',
    source_id: invoice.id,
    source_code: invoice.invoice_code || '',
    transaction_date: normalizeDateKey(invoice.created_at || timestamp),
    posted_at: timestamp,
    customer_id: invoice.customer_id || null,
    created_by: getActor(options) || invoice.user_id || null,
  };
  const rows = [];
  if (paid > 0) rows.push({ ...common, source_action: 'payment_received', account_code: cashAccount[0], account_name: cashAccount[1], debit_amount: paid, credit_amount: 0, description: `Thu tiền hóa đơn ${invoice.invoice_code || invoice.id}` });
  if (remaining > 0) rows.push({ ...common, source_action: 'customer_receivable', account_code: '131', account_name: 'Phải thu khách hàng', debit_amount: remaining, credit_amount: 0, description: `Ghi nhận công nợ hóa đơn ${invoice.invoice_code || invoice.id}` });
  if (revenue > 0) rows.push({ ...common, source_action: 'sales_revenue', account_code: '511', account_name: 'Doanh thu bán hàng', debit_amount: 0, credit_amount: revenue, description: `Doanh thu hóa đơn ${invoice.invoice_code || invoice.id}` });
  if (vat > 0) rows.push({ ...common, source_action: 'output_vat', account_code: '3331', account_name: 'Thuế GTGT phải nộp', debit_amount: 0, credit_amount: vat, description: `VAT đầu ra hóa đơn ${invoice.invoice_code || invoice.id}` });
  if (cost > 0) {
    rows.push({ ...common, source_action: 'cost_of_goods_sold', account_code: '632', account_name: 'Giá vốn hàng bán', debit_amount: cost, credit_amount: 0, description: `Giá vốn hóa đơn ${invoice.invoice_code || invoice.id}` });
    rows.push({ ...common, source_action: 'inventory_out', account_code: '156', account_name: 'Hàng hóa', debit_amount: 0, credit_amount: cost, description: `Xuất giá vốn hóa đơn ${invoice.invoice_code || invoice.id}` });
  }
  return { rows, revenue, vat, total, paid, remaining, cost, profit: roundMoney(revenue - cost) };
}

function rebuildOperationalReportsForDate(date, options = {}) {
  const period = normalizeDateKey(date);
  if (!period) return null;
  const accountId = options.accountId || getActiveAccountId();
  const completed = getAll('invoices', invoice => isCompletedInvoiceStatus(invoice.status) && normalizeDateKey(invoice.created_at || invoice.updated_at) === period);
  const details = getAll('invoice_details');
  let revenue = 0;
  let vat = 0;
  let cost = 0;
  for (const invoice of completed) {
    revenue += calculateInvoiceRevenue(invoice);
    vat += toMoney(invoice.vat_amount);
    cost += calculateInvoiceCost(details.filter(detail => Number(detail.invoice_id) === Number(invoice.id)));
  }
  const timestamp = normalizeTimestamp(options.timestamp);
  const summary = { revenue: roundMoney(revenue), vat: roundMoney(vat), cost: roundMoney(cost), profit: roundMoney(revenue - cost), invoice_count: completed.length };
  const specs = [
    ['revenue_reports', { total_revenue: summary.revenue, total_vat: summary.vat, invoice_count: summary.invoice_count }],
    ['profit_reports', { total_revenue: summary.revenue, total_cost: summary.cost, total_profit: summary.profit, invoice_count: summary.invoice_count }],
  ];
  const result = {};
  for (const [table, reportSummary] of specs) {
    const existing = getOne(table, row => row.period_from === period && row.period_to === period && row.status === 'auto');
    const payload = {
      account_id: accountId,
      period_from: period,
      period_to: period,
      generated_at: timestamp,
      generated_by: getActor(options),
      status: 'auto',
      summary: reportSummary,
      detail_rows: [],
      source_hash: `invoice-daily:${period}:${completed.length}:${summary.revenue}:${summary.cost}`,
      updated_at: timestamp,
    };
    if (existing) result[table] = update(table, existing.id, payload, writeOptions({ ...options, accountId }));
    else {
      const id = insert(table, { ...payload, created_at: timestamp }, writeOptions({ ...options, accountId }));
      result[table] = getOne(table, row => Number(row.id) === Number(id));
    }
  }
  return { ...result, summary };
}

function postInvoiceCompleted(invoice = {}, details = [], options = {}) {
  if (!invoice.id || !isCompletedInvoiceStatus(invoice.status)) return null;
  const timestamp = normalizeTimestamp(options.timestamp || invoice.updated_at || invoice.created_at);
  const calculated = buildInvoiceTransactions(invoice, details, { ...options, timestamp });
  const transactions = calculated.rows.map(row => upsertAccountingTransaction({
    ...row,
    idempotency_key: `invoice:${invoice.id}:completed:${row.source_action}:${row.account_code}`,
    status: 'posted',
  }, { ...options, timestamp }));
  const cashFund = upsertCashFundFromSource(invoice, {
    ...options,
    timestamp,
    sourceType: 'invoice',
    sourceId: invoice.id,
    sourceAction: 'payment_received',
    type: 'income',
    amount: calculated.paid,
    paymentMethod: invoice.payment_method,
    category: 'Doanh thu bán hàng',
    note: `Thu tiền hóa đơn ${invoice.invoice_code || invoice.id}`,
  });
  const debt = upsertCustomerDebtFromInvoice(invoice, { ...options, timestamp });
  const einvoice = upsertEinvoiceOut(invoice, { ...options, timestamp });
  const reports = rebuildOperationalReportsForDate(invoice.created_at || timestamp, { ...options, timestamp, accountId: getAccountId(invoice, options) });
  const updatedInvoice = update('invoices', invoice.id, {
    accounting_status: 'posted',
    posted_at: invoice.posted_at || timestamp,
    reversed_at: null,
    accounting_profit: calculated.profit,
    accounting_cost: calculated.cost,
  }, writeOptions(options));
  return { invoice: updatedInvoice, transactions, cash_fund: cashFund, customer_debt: debt, einvoice_out: einvoice, reports, summary: calculated };
}

function reverseTransactionsForSource(sourceType, id, options = {}) {
  const timestamp = normalizeTimestamp(options.timestamp);
  const originals = getAll('accounting_transactions', row => sameSource(row, sourceType, id) && !row.reversal_of_id && row.status !== 'reversed');
  const reversals = [];
  for (const original of originals) {
    const reversal = upsertAccountingTransaction({
      ...original,
      id: undefined,
      source_action: `reverse_${original.source_action}`,
      debit_amount: original.credit_amount,
      credit_amount: original.debit_amount,
      direction: toMoney(original.credit_amount) > 0 ? 'debit' : 'credit',
      description: `${options.reason || 'Đảo chứng từ'}: ${original.description || original.source_code || id}`,
      idempotency_key: `${sourceType}:${id}:reverse:${original.id}`,
      reversal_of_id: original.id,
      status: 'posted',
      posted_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    }, options);
    update('accounting_transactions', original.id, { status: 'reversed', reversed_at: timestamp, updated_at: timestamp }, writeOptions(options));
    reversals.push(reversal);
  }
  return reversals;
}

function reverseInvoice(invoice = {}, reason = 'invoice_cancelled', options = {}) {
  if (!invoice.id) return null;
  const timestamp = normalizeTimestamp(options.timestamp || invoice.cancelled_at || invoice.updated_at);
  const reversals = reverseTransactionsForSource('invoice', invoice.id, { ...options, timestamp, reason });
  const cashFund = voidCashFundBySource('invoice', invoice.id, { ...options, timestamp, reason });
  const debt = upsertCustomerDebtFromInvoice({ ...invoice, status: 'cancelled', remaining_amount: 0 }, { ...options, timestamp, note: reason });
  const einvoice = upsertEinvoiceOut({ ...invoice, status: 'cancelled' }, { ...options, timestamp });
  const reports = rebuildOperationalReportsForDate(invoice.created_at || timestamp, { ...options, timestamp, accountId: getAccountId(invoice, options) });
  const updatedInvoice = update('invoices', invoice.id, { accounting_status: 'reversed', reversed_at: timestamp }, writeOptions(options));
  return { invoice: updatedInvoice, reversals, cash_fund: cashFund, customer_debt: debt, einvoice_out: einvoice, reports };
}

function buildImportTransactions(importLog, details, options = {}) {
  const timestamp = normalizeTimestamp(options.timestamp || importLog.updated_at || importLog.created_at);
  const summary = summarizeImportDetails(details);
  const subtotal = roundMoney(summary.subtotal);
  const vat = roundMoney(summary.vat);
  const total = roundMoney(importLog.total || summary.total || subtotal + vat);
  const common = {
    account_id: getAccountId(importLog, options),
    source_type: 'import',
    source_id: importLog.id,
    source_code: importLog.import_code || '',
    transaction_date: normalizeDateKey(importLog.created_at || timestamp),
    posted_at: timestamp,
    partner_id: importLog.partner_id || null,
    created_by: getActor(options) || importLog.user_id || null,
  };
  const rows = [];
  if (subtotal > 0) rows.push({ ...common, source_action: 'inventory_received', account_code: '156', account_name: 'Hàng hóa', debit_amount: subtotal, credit_amount: 0, description: `Nhập hàng ${importLog.import_code || importLog.id}` });
  if (vat > 0) rows.push({ ...common, source_action: 'input_vat', account_code: '1331', account_name: 'Thuế GTGT được khấu trừ', debit_amount: vat, credit_amount: 0, description: `VAT đầu vào ${importLog.import_code || importLog.id}` });
  if (total > 0) rows.push({ ...common, source_action: 'supplier_payable', account_code: '331', account_name: 'Phải trả người bán', debit_amount: 0, credit_amount: total, description: `Phải trả phiếu nhập ${importLog.import_code || importLog.id}` });
  return { rows, subtotal, vat, total };
}

function postImportReceived(importLog = {}, details = [], options = {}) {
  if (!importLog.id || String(importLog.status || '').toLowerCase() !== 'received' || importLog.deleted === true) return null;
  const timestamp = normalizeTimestamp(options.timestamp || importLog.updated_at || importLog.created_at);
  const calculated = buildImportTransactions(importLog, details, { ...options, timestamp });
  const transactions = calculated.rows.map(row => upsertAccountingTransaction({
    ...row,
    idempotency_key: `import:${importLog.id}:received:${row.source_action}:${row.account_code}`,
    status: 'posted',
  }, { ...options, timestamp }));
  const debt = upsertSupplierDebtFromImport(importLog, { ...options, timestamp });
  const einvoice = upsertEinvoiceIn(importLog, details, { ...options, timestamp });
  const updatedImport = update('import_logs', importLog.id, {
    accounting_status: 'posted',
    posted_at: importLog.posted_at || timestamp,
    reversed_at: null,
    accounting_cost: calculated.subtotal,
    accounting_input_vat: calculated.vat,
  }, writeOptions(options));
  return { import_log: updatedImport, transactions, supplier_debt: debt, einvoice_in: einvoice, summary: calculated };
}

function postImportPayment(importLog = {}, payment = {}, options = {}) {
  if (!importLog.id) return null;
  const timestamp = normalizeTimestamp(options.timestamp || payment.paid_at || importLog.paid_at || importLog.updated_at);
  const amount = roundMoney(payment.amount !== undefined ? payment.amount : importLog.paid_amount);
  const method = normalizePaymentMethod(payment.payment_method || importLog.payment_method || 'cash') || 'cash';
  const cashAccount = method === 'bank' || method === 'transfer' ? ['112', 'Tiền gửi ngân hàng'] : ['111', 'Tiền mặt'];
  const common = {
    account_id: getAccountId(importLog, options),
    source_type: 'import',
    source_id: importLog.id,
    source_code: importLog.import_code || '',
    transaction_date: normalizeDateKey(timestamp),
    posted_at: timestamp,
    partner_id: importLog.partner_id || null,
    created_by: getActor(options) || importLog.user_id || null,
  };
  const transactions = amount > 0 ? [
    upsertAccountingTransaction({ ...common, source_action: 'supplier_payment', account_code: '331', account_name: 'Phải trả người bán', debit_amount: amount, credit_amount: 0, description: `Thanh toán phiếu nhập ${importLog.import_code || importLog.id}`, idempotency_key: `import:${importLog.id}:payment:supplier:331` }, options),
    upsertAccountingTransaction({ ...common, source_action: 'cash_payment', account_code: cashAccount[0], account_name: cashAccount[1], debit_amount: 0, credit_amount: amount, description: `Chi tiền phiếu nhập ${importLog.import_code || importLog.id}`, idempotency_key: `import:${importLog.id}:payment:cash:${cashAccount[0]}` }, options),
  ] : [];
  const cashFund = upsertCashFundFromSource(importLog, {
    ...options,
    timestamp,
    sourceType: 'import',
    sourceId: importLog.id,
    sourceAction: 'supplier_payment',
    type: 'expense',
    amount,
    paymentMethod: method,
    category: 'Thanh toán nhập hàng',
    note: payment.note || `Thanh toán phiếu nhập ${importLog.import_code || importLog.id}`,
    cashBookId: payment.cash_book_id || null,
  });
  const debt = upsertSupplierDebtFromImport(importLog, { ...options, timestamp });
  return { transactions, cash_fund: cashFund, supplier_debt: debt };
}

function reverseImport(importLog = {}, reason = 'import_cancelled', options = {}) {
  if (!importLog.id) return null;
  const timestamp = normalizeTimestamp(options.timestamp || importLog.cancelled_at || importLog.updated_at);
  const reversals = reverseTransactionsForSource('import', importLog.id, { ...options, timestamp, reason });
  const cashFund = voidCashFundBySource('import', importLog.id, { ...options, timestamp, reason });
  const debt = upsertSupplierDebtFromImport({ ...importLog, status: 'cancelled', deleted: true, remaining_amount: 0, paid_amount: 0 }, { ...options, timestamp, note: reason });
  const details = options.details || getAll('import_details', row => Number(row.import_id) === Number(importLog.id));
  const einvoice = upsertEinvoiceIn({ ...importLog, status: 'cancelled', deleted: true }, details, { ...options, timestamp });
  const updatedImport = update('import_logs', importLog.id, { accounting_status: 'reversed', reversed_at: timestamp }, writeOptions(options));
  return { import_log: updatedImport, reversals, cash_fund: cashFund, supplier_debt: debt, einvoice_in: einvoice };
}

function calculateTaxReport({ from = '1970-01-01', to = '2099-12-31' } = {}) {
  const within = value => {
    const date = normalizeDateKey(value);
    return Boolean(date && date >= from && date <= to);
  };
  const validInputInvoices = getAll('einvoice_in', row => row.status !== 'cancelled' && within(row.invoice_date || row.created_at));
  const validOutputInvoices = getAll('einvoice_out', row => row.status !== 'cancelled' && within(row.invoice_date || row.created_at));
  const inputImportIds = new Set(validInputInvoices.map(row => Number(row.import_id || row.source_id)).filter(Number.isFinite));
  const outputInvoiceIds = new Set(validOutputInvoices.map(row => Number(row.invoice_id || row.source_id)).filter(Number.isFinite));
  const inputRows = validInputInvoices.map(row => ({ source: 'einvoice_in', source_id: row.id, import_id: row.import_id || row.source_id || null, invoice_no: row.invoice_no || '', invoice_date: row.invoice_date, supplier_name: row.supplier_name || '', taxable_amount: roundMoney(row.subtotal), vat_amount: roundMoney(row.vat_amount), total: roundMoney(row.total) }));
  const outputRows = validOutputInvoices.map(row => ({ source: 'einvoice_out', source_id: row.id, invoice_id: row.invoice_id || row.source_id || null, invoice_no: row.invoice_no || '', invoice_date: row.invoice_date, buyer_name: row.buyer_name || '', taxable_amount: roundMoney(row.subtotal), vat_amount: roundMoney(row.vat_amount), total: roundMoney(row.total) }));

  const importDetails = getAll('import_details');
  for (const importLog of getAll('import_logs', row => String(row.status || '').toLowerCase() === 'received' && row.deleted !== true && within(row.created_at))) {
    if (inputImportIds.has(Number(importLog.id))) continue;
    const details = importDetails.filter(detail => Number(detail.import_id) === Number(importLog.id));
    const summary = summarizeImportDetails(details);
    inputRows.push({ source: 'import_fallback', source_id: importLog.id, import_id: importLog.id, invoice_no: importLog.import_code || '', invoice_date: normalizeDateKey(importLog.created_at), supplier_name: getOne('partners', row => Number(row.id) === Number(importLog.partner_id))?.name || '', taxable_amount: roundMoney(summary.subtotal), vat_amount: roundMoney(summary.vat), total: roundMoney(importLog.total || summary.total) });
  }

  for (const invoice of getAll('invoices', row => isCompletedInvoiceStatus(row.status) && within(row.created_at))) {
    if (outputInvoiceIds.has(Number(invoice.id))) continue;
    outputRows.push({ source: 'invoice_fallback', source_id: invoice.id, invoice_id: invoice.id, invoice_no: invoice.invoice_code || '', invoice_date: normalizeDateKey(invoice.created_at), buyer_name: getOne('customers', row => Number(row.id) === Number(invoice.customer_id))?.name || '', taxable_amount: roundMoney(invoice.subtotal), vat_amount: roundMoney(invoice.vat_amount), total: roundMoney(invoice.total) });
  }

  const totalInputVat = roundMoney(inputRows.reduce((sum, row) => sum + toMoney(row.vat_amount), 0));
  const totalOutputVat = roundMoney(outputRows.reduce((sum, row) => sum + toMoney(row.vat_amount), 0));
  return {
    period: { from, to },
    total_input_vat: totalInputVat,
    total_output_vat: totalOutputVat,
    vat_payable: roundMoney(totalOutputVat - totalInputVat),
    input_taxable_amount: roundMoney(inputRows.reduce((sum, row) => sum + toMoney(row.taxable_amount), 0)),
    output_taxable_amount: roundMoney(outputRows.reduce((sum, row) => sum + toMoney(row.taxable_amount), 0)),
    input_sources: inputRows,
    output_sources: outputRows,
    generated_at: now(),
  };
}

module.exports = {
  upsertAccountingTransaction,
  upsertCashFundFromSource,
  upsertCustomerDebtFromInvoice,
  upsertSupplierDebtFromImport,
  upsertEinvoiceIn,
  upsertEinvoiceOut,
  postInvoiceCompleted,
  reverseInvoice,
  postImportReceived,
  postImportPayment,
  reverseImport,
  reverseTransactionsForSource,
  calculateTaxReport,
  rebuildOperationalReportsForDate,
  summarizeImportDetails,
  calculateInvoiceCost,
  roundMoney,
};
