/**
 * Payrolls API routes
 * Bảng lương nhân viên: CRUD, lọc và tổng hợp lương theo tháng/năm.
 */
const express = require('express');
const router = express.Router();
const { getAll, getOne, insert, update, now } = require('../db/database');

const MONEY_AND_DAY_FIELDS = [
  'daily_wage',
  'working_days',
  'leave_days',
  'advance_amount',
  'overtime_amount',
  'extra_bonus',
  'holiday_bonus',
  'tet_bonus',
];

function toNonNegativeNumber(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) {
    throw new Error(`${fieldName} phải là số hợp lệ`);
  }
  if (number < 0) {
    throw new Error(`${fieldName} không được âm`);
  }
  return number;
}

function parseMonth(value) {
  const month = Number.parseInt(value, 10);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Tháng lương phải từ 1 đến 12');
  }
  return month;
}

function parseYear(value) {
  const year = Number.parseInt(value, 10);
  if (!Number.isInteger(year) || year < 1900 || year > 3000) {
    throw new Error('Năm lương không hợp lệ');
  }
  return year;
}

function calculatePayroll(row) {
  const salaryMonth = Number(row.daily_wage || 0) * Number(row.working_days || 0);
  const totalIncome = salaryMonth
    + Number(row.extra_bonus || 0)
    + Number(row.overtime_amount || 0);
  const netSalary = totalIncome - Number(row.advance_amount || 0);

  return {
    ...row,
    salary_month: salaryMonth,
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

function buildPayrollPayload(body, existing = {}) {
  const source = { ...existing, ...body };
  const employeeName = String(source.employee_name ?? '').trim();

  if (!employeeName) {
    throw new Error('Tên nhân viên không được để trống');
  }

  const payload = {
    employee_name: employeeName,
    employee_phone: String(source.employee_phone ?? '').trim(),
    note: String(source.note ?? '').trim(),
    month: parseMonth(source.month),
    year: parseYear(source.year),
    active: existing.active !== undefined ? existing.active : 1,
  };

  for (const field of MONEY_AND_DAY_FIELDS) {
    payload[field] = toNonNegativeNumber(source[field], field);
  }

  return calculatePayroll(payload);
}

function filterPayrolls(query) {
  const { search, month, year } = query;
  const searchText = normalizeSearch(search);
  const monthFilter = month ? Number.parseInt(month, 10) : null;
  const yearFilter = year ? Number.parseInt(year, 10) : null;

  let rows = getAll('payrolls', r => r.active !== 0).map(calculatePayroll);

  if (monthFilter) rows = rows.filter(r => Number(r.month) === monthFilter);
  if (yearFilter) rows = rows.filter(r => Number(r.year) === yearFilter);
  if (searchText) {
    rows = rows.filter(r => {
      const name = normalizeSearch(r.employee_name);
      const phone = normalizeSearch(r.employee_phone);
      return name.includes(searchText) || phone.includes(searchText);
    });
  }

  return rows.sort((a, b) => {
    if (Number(b.year) !== Number(a.year)) return Number(b.year) - Number(a.year);
    if (Number(b.month) !== Number(a.month)) return Number(b.month) - Number(a.month);
    return String(a.employee_name || '').localeCompare(String(b.employee_name || ''), 'vi');
  });
}

function summarize(rows) {
  return rows.reduce((summary, row) => {
    summary.total_salary_month += Number(row.salary_month || 0);
    summary.total_advance_amount += Number(row.advance_amount || 0);
    summary.total_overtime_amount += Number(row.overtime_amount || 0);
    summary.total_extra_bonus += Number(row.extra_bonus || 0);
    summary.total_holiday_bonus += Number(row.holiday_bonus || 0);
    summary.total_tet_bonus += Number(row.tet_bonus || 0);
    summary.total_bonus += Number(row.overtime_amount || 0)
      + Number(row.extra_bonus || 0);
    summary.total_income += Number(row.total_income || 0);
    summary.total_net_salary += Number(row.net_salary || 0);
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

router.get('/', (req, res) => {
  try {
    res.json(filterPayrolls(req.query));
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lấy bảng lương', detail: err.message });
  }
});

router.get('/summary', (req, res) => {
  try {
    const rows = filterPayrolls(req.query);
    res.json(summarize(rows));
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi tổng hợp bảng lương', detail: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const record = getOne('payrolls', r => r.id === id && r.active !== 0);
    if (!record) return res.status(404).json({ error: 'Không tìm thấy bảng lương' });
    res.json(calculatePayroll(record));
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi lấy bảng lương', detail: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const payload = buildPayrollPayload(req.body);
    const timestamp = now();
    const id = insert('payrolls', {
      ...payload,
      active: 1,
      created_at: timestamp,
      updated_at: timestamp,
    });
    res.json({ ok: true, id, message: 'Thêm bảng lương thành công' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const record = getOne('payrolls', r => r.id === id && r.active !== 0);
    if (!record) return res.status(404).json({ error: 'Không tìm thấy bảng lương' });

    const payload = buildPayrollPayload(req.body, record);
    update('payrolls', id, {
      ...payload,
      active: 1,
      updated_at: now(),
    });
    res.json({ ok: true, message: 'Cập nhật bảng lương thành công' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const record = getOne('payrolls', r => r.id === id && r.active !== 0);
    if (!record) return res.status(404).json({ error: 'Không tìm thấy bảng lương' });

    update('payrolls', id, { active: 0, updated_at: now() });
    res.json({ ok: true, message: 'Đã xóa bảng lương' });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi khi xóa bảng lương', detail: err.message });
  }
});

module.exports = router;
