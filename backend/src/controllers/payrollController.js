const payrollService = require('../services/payrollService');

function sendPayrollError(res, error, action) {
  const status = error.status || 500;
  const message = error.message || 'Lỗi server bảng lương';
  console.error(`[PAYROLL API] ${action}:`, message);
  return res.status(status).json({
    ok: false,
    error: status >= 500 ? 'Lỗi server bảng lương' : message,
    detail: status >= 500 ? message : undefined,
  });
}

async function listPayrolls(req, res) {
  try {
    const rows = await payrollService.listPayrolls(req.query);
    return res.json(rows);
  } catch (error) {
    return sendPayrollError(res, error, 'listPayrolls');
  }
}

async function getPayrollSummary(req, res) {
  try {
    const summary = await payrollService.getPayrollSummary(req.query);
    return res.json(summary);
  } catch (error) {
    return sendPayrollError(res, error, 'getPayrollSummary');
  }
}

async function getPayrollById(req, res) {
  try {
    const payroll = await payrollService.getPayrollById(req.payrollId || req.params.id);
    return res.json(payroll);
  } catch (error) {
    return sendPayrollError(res, error, 'getPayrollById');
  }
}

async function createPayroll(req, res) {
  try {
    const payload = req.validatedPayroll || req.body;
    const result = await payrollService.createPayroll(payload);
    return res.status(201).json({ ok: true, ...result, message: 'Thêm bảng lương thành công' });
  } catch (error) {
    return sendPayrollError(res, error, 'createPayroll');
  }
}

async function updatePayroll(req, res) {
  try {
    const payload = req.validatedPayroll || req.body;
    const result = await payrollService.updatePayroll(req.payrollId || req.params.id, payload);
    return res.json({ ok: true, ...result, message: 'Cập nhật bảng lương thành công' });
  } catch (error) {
    return sendPayrollError(res, error, 'updatePayroll');
  }
}

async function deletePayroll(req, res) {
  try {
    const result = await payrollService.deletePayroll(req.payrollId || req.params.id);
    return res.json({ ok: true, ...result, message: 'Đã xóa bảng lương' });
  } catch (error) {
    return sendPayrollError(res, error, 'deletePayroll');
  }
}

module.exports = {
  listPayrolls,
  getPayrollSummary,
  getPayrollById,
  createPayroll,
  updatePayroll,
  deletePayroll,
};
