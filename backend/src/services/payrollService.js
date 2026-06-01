const { getAll, getOne, insert, update, now, withAtomicDbWrite } = require('../db/database');

const PAYROLL_NUMBER_FIELDS = [
  'daily_wage',
  'working_days',
  'leave_days',
  'advance_amount',
  'overtime_amount',
  'extra_bonus',
  'holiday_bonus',
  'tet_bonus',
];

const PAYROLL_FIELD_LABELS = {
  employee_name: 'Tên nhân viên',
  employee_phone: 'Số điện thoại',
  daily_wage: 'Lương/ngày',
  working_days: 'Số ngày đi làm',
  leave_days: 'Số ngày nghỉ',
  advance_amount: 'Tiền ứng trước',
  overtime_amount: 'Tiền tăng ca',
  extra_bonus: 'Tiền thưởng thêm',
  holiday_bonus: 'Thưởng lễ',
  tet_bonus: 'Thưởng Tết',
  month: 'Tháng lương',
  year: 'Năm lương',
};

function createHttpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isBlank(value) {
  return String(value ?? '').trim() === '';
}

function toNonNegativeNumber(value, fieldName) {
  const label = PAYROLL_FIELD_LABELS[fieldName] || fieldName;
  if (isBlank(value)) return 0;
  const number = Number(value);
  if (!Number.isFinite(number)) throw createHttpError(`${label} phải là số hợp lệ`, 400);
  if (number < 0) throw createHttpError(`${label} không được âm`, 400);
  return number;
}

function parseMonth(value) {
  const month = Number.parseInt(value, 10);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw createHttpError('Tháng lương phải từ 1 đến 12', 400);
  }
  return month;
}

function parseYear(value) {
  const year = Number.parseInt(value, 10);
  if (!Number.isInteger(year) || year < 1900 || year > 3000) {
    throw createHttpError('Năm lương không hợp lệ', 400);
  }
  return year;
}

function calculatePayroll(row = {}) {
  const salaryMonth = Number(row.daily_wage || 0) * Number(row.working_days || 0);
  const totalBonus = Number(row.overtime_amount || 0)
    + Number(row.extra_bonus || 0)
    + Number(row.holiday_bonus || 0)
    + Number(row.tet_bonus || 0);
  const totalIncome = salaryMonth + totalBonus;
  const netSalary = totalIncome - Number(row.advance_amount || 0);

  return {
    ...row,
    salary_month: salaryMonth,
    total_bonus: totalBonus,
    total_income: totalIncome,
    net_salary: netSalary,
  };
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function validatePayrollInput(body = {}, options = {}) {
  const source = { ...(body || {}) };
  const employeeName = String(source.employee_name ?? '').trim();
  if (!employeeName) throw createHttpError('Tên nhân viên không được để trống', 400);
  if (isBlank(source.daily_wage)) throw createHttpError('Vui lòng nhập lương/ngày', 400);
  if (isBlank(source.working_days)) throw createHttpError('Vui lòng nhập số ngày đi làm', 400);

  const normalized = {
    employee_name: employeeName,
    employee_phone: String(source.employee_phone ?? '').trim(),
    note: String(source.note ?? '').trim(),
    month: parseMonth(source.month),
    year: parseYear(source.year),
    active: options.active ?? 1,
  };

  for (const field of PAYROLL_NUMBER_FIELDS) {
    normalized[field] = toNonNegativeNumber(source[field], field);
  }

  return calculatePayroll(normalized);
}

function buildPayrollPayload(body = {}, existing = null) {
  const source = existing ? { ...existing, ...body } : { ...body };
  return validatePayrollInput(source, { active: existing?.active ?? 1 });
}

function filterPayrolls(query = {}) {
  const searchText = normalizeSearch(query.search);
  const monthFilter = query.month ? parseMonth(query.month) : null;
  const yearFilter = query.year ? parseYear(query.year) : null;

  let rows = getAll('payrolls', row => row.active !== 0).map(calculatePayroll);

  if (monthFilter) rows = rows.filter(row => Number(row.month) === monthFilter);
  if (yearFilter) rows = rows.filter(row => Number(row.year) === yearFilter);
  if (searchText) {
    rows = rows.filter(row => {
      const name = normalizeSearch(row.employee_name);
      const phone = normalizeSearch(row.employee_phone);
      return name.includes(searchText) || phone.includes(searchText);
    });
  }

  return rows.sort((a, b) => Number(b.year) - Number(a.year)
    || Number(b.month) - Number(a.month)
    || String(a.employee_name || '').localeCompare(String(b.employee_name || ''), 'vi'));
}

function summarizePayrolls(rows = []) {
  return rows.reduce((summary, row) => {
    const calculated = calculatePayroll(row);
    summary.total_salary_month += Number(calculated.salary_month || 0);
    summary.total_advance_amount += Number(calculated.advance_amount || 0);
    summary.total_overtime_amount += Number(calculated.overtime_amount || 0);
    summary.total_extra_bonus += Number(calculated.extra_bonus || 0);
    summary.total_holiday_bonus += Number(calculated.holiday_bonus || 0);
    summary.total_tet_bonus += Number(calculated.tet_bonus || 0);
    summary.total_bonus += Number(calculated.total_bonus || 0);
    summary.total_income += Number(calculated.total_income || 0);
    summary.total_net_salary += Number(calculated.net_salary || 0);
    summary.count += 1;
    return summary;
  }, {
    count: 0,
    total_salary_month: 0,
    total_advance_amount: 0,
    total_overtime_amount: 0,
    total_extra_bonus: 0,
    total_holiday_bonus: 0,
    total_tet_bonus: 0,
    total_bonus: 0,
    total_income: 0,
    total_net_salary: 0,
  });
}

async function listPayrolls(query = {}) {
  return filterPayrolls(query);
}

async function getPayrollById(id) {
  const payrollId = Number.parseInt(id, 10);
  if (!Number.isInteger(payrollId) || payrollId <= 0) throw createHttpError('ID bảng lương không hợp lệ', 400);
  const payroll = getOne('payrolls', row => Number(row.id) === payrollId && row.active !== 0);
  if (!payroll) throw createHttpError('Không tìm thấy bảng lương', 404);
  return calculatePayroll(payroll);
}

async function createPayroll(body = {}) {
  return withAtomicDbWrite(() => {
    const payload = buildPayrollPayload(body);
    const timestamp = now();
    const id = insert('payrolls', {
      ...payload,
      active: 1,
      created_at: timestamp,
      updated_at: timestamp,
    }, { skipSave: true });
    const payroll = calculatePayroll(getOne('payrolls', row => Number(row.id) === Number(id)));
    return { id, payroll };
  });
}

async function updatePayroll(id, body = {}) {
  const payrollId = Number.parseInt(id, 10);
  if (!Number.isInteger(payrollId) || payrollId <= 0) throw createHttpError('ID bảng lương không hợp lệ', 400);

  return withAtomicDbWrite(() => {
    const existing = getOne('payrolls', row => Number(row.id) === payrollId && row.active !== 0);
    if (!existing) throw createHttpError('Không tìm thấy bảng lương', 404);
    const payload = buildPayrollPayload(body, existing);
    update('payrolls', payrollId, {
      ...payload,
      active: 1,
      updated_at: now(),
    }, { skipSave: true });
    const payroll = calculatePayroll(getOne('payrolls', row => Number(row.id) === payrollId));
    return { id: payrollId, payroll };
  });
}

async function deletePayroll(id) {
  const payrollId = Number.parseInt(id, 10);
  if (!Number.isInteger(payrollId) || payrollId <= 0) throw createHttpError('ID bảng lương không hợp lệ', 400);

  return withAtomicDbWrite(() => {
    const existing = getOne('payrolls', row => Number(row.id) === payrollId && row.active !== 0);
    if (!existing) throw createHttpError('Không tìm thấy bảng lương', 404);
    update('payrolls', payrollId, { active: 0, updated_at: now() }, { skipSave: true });
    return { id: payrollId };
  });
}

async function getPayrollSummary(query = {}) {
  return summarizePayrolls(filterPayrolls(query));
}

module.exports = {
  PAYROLL_NUMBER_FIELDS,
  PAYROLL_FIELD_LABELS,
  calculatePayroll,
  validatePayrollInput,
  buildPayrollPayload,
  listPayrolls,
  getPayrollById,
  createPayroll,
  updatePayroll,
  deletePayroll,
  getPayrollSummary,
};
