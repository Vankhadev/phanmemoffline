const express = require('express');
const payrollController = require('../controllers/payrollController');
const {
  validatePayrollId,
  validatePayrollPayload,
  validatePayrollQuery,
} = require('../middleware/payrollValidation');

const router = express.Router();

router.get('/', validatePayrollQuery, payrollController.listPayrolls);
router.get('/summary', validatePayrollQuery, payrollController.getPayrollSummary);
router.get('/:id', validatePayrollId, payrollController.getPayrollById);
router.post('/', validatePayrollPayload, payrollController.createPayroll);
router.put('/:id', validatePayrollId, validatePayrollPayload, payrollController.updatePayroll);
router.delete('/:id', validatePayrollId, payrollController.deletePayroll);

module.exports = router;
