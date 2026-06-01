const { PAYROLL_NUMBER_FIELDS, PAYROLL_FIELD_LABELS, validatePayrollInput } = require('../services/payrollService');

function isBlank(value) {
  return String(value ?? '').trim() === '';
}

function validatePayrollId(req, res, next) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: 'ID bảng lương không hợp lệ' });
  }
  req.payrollId = id;
  return next();
}

function validatePayrollQuery(req, res, next) {
  try {
    const { month, year } = req.query;
    if (!isBlank(month)) {
      const parsedMonth = Number.parseInt(month, 10);
      if (!Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
        return res.status(400).json({ ok: false, error: 'Tháng lương phải từ 1 đến 12' });
      }
    }
    if (!isBlank(year)) {
      const parsedYear = Number.parseInt(year, 10);
      if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 3000) {
        return res.status(400).json({ ok: false, error: 'Năm lương không hợp lệ' });
      }
    }
    return next();
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message || 'Bộ lọc bảng lương không hợp lệ' });
  }
}

function validatePayrollPayload(req, res, next) {
  try {
    const body = req.body || {};
    const missingFields = [];
    if (isBlank(body.employee_name)) missingFields.push('Tên nhân viên');
    if (isBlank(body.daily_wage)) missingFields.push('Lương/ngày');
    if (isBlank(body.working_days)) missingFields.push('Số ngày đi làm');

    if (missingFields.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `Thiếu dữ liệu bắt buộc: ${missingFields.join(', ')}`,
        fields: missingFields,
      });
    }

    for (const field of PAYROLL_NUMBER_FIELDS) {
      if (isBlank(body[field])) continue;
      const number = Number(body[field]);
      if (!Number.isFinite(number)) {
        return res.status(400).json({ ok: false, error: `${PAYROLL_FIELD_LABELS[field] || field} phải là số hợp lệ`, field });
      }
      if (number < 0) {
        return res.status(400).json({ ok: false, error: `${PAYROLL_FIELD_LABELS[field] || field} không được âm`, field });
      }
    }

    req.validatedPayroll = validatePayrollInput(body);
    return next();
  } catch (error) {
    return res.status(error.status || 400).json({ ok: false, error: error.message || 'Dữ liệu bảng lương không hợp lệ' });
  }
}

module.exports = {
  validatePayrollId,
  validatePayrollQuery,
  validatePayrollPayload,
};
