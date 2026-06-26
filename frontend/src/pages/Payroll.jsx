import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiJson, apiJsonChecked } from '../utils/apiClient';
import HelpModal from '../components/HelpModal';
import { Calculator, Edit2, Filter, HelpCircle, Loader, Plus, RefreshCcw, Search, Trash2, Wallet, X } from 'lucide-react';

const currentDate = new Date();
const currentMonth = currentDate.getMonth() + 1;
const currentYear = currentDate.getFullYear();

const emptyForm = {
  employee_name: '',
  employee_phone: '',
  daily_wage: '',
  working_days: '',
  leave_days: '',
  advance_amount: '',
  overtime_amount: '',
  extra_bonus: '',
  holiday_bonus: '',
  tet_bonus: '',
  note: '',
  month: currentMonth,
  year: currentYear,
};

const moneyFields = ['daily_wage', 'advance_amount', 'overtime_amount', 'extra_bonus', 'holiday_bonus', 'tet_bonus'];
const numberFields = ['working_days', 'leave_days', ...moneyFields];

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function calculatePreview(source) {
  const salaryMonth = toNumber(source.daily_wage) * toNumber(source.working_days);
  const totalBonus = toNumber(source.overtime_amount)
    + toNumber(source.extra_bonus)
    + toNumber(source.holiday_bonus)
    + toNumber(source.tet_bonus);
  const totalIncome = salaryMonth + totalBonus;
  const netSalary = totalIncome - toNumber(source.advance_amount);

  return { salaryMonth, totalBonus, totalIncome, netSalary };
}

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function isBlank(value) {
  return String(value ?? '').trim() === '';
}

function isValidNumberInput(value) {
  if (isBlank(value)) return true;
  return Number.isFinite(Number(value));
}

function buildPayrollRecord(payload, id) {
  const preview = calculatePreview(payload);
  return {
    ...payload,
    id,
    salary_month: preview.salaryMonth,
    total_bonus: preview.totalBonus,
    total_income: preview.totalIncome,
    net_salary: preview.netSalary,
    active: 1,
  };
}

function normalizePayrollForForm(payroll) {
  return {
    employee_name: payroll.employee_name || '',
    employee_phone: payroll.employee_phone || '',
    daily_wage: payroll.daily_wage ?? '',
    working_days: payroll.working_days ?? '',
    leave_days: payroll.leave_days ?? '',
    advance_amount: payroll.advance_amount ?? '',
    overtime_amount: payroll.overtime_amount ?? '',
    extra_bonus: payroll.extra_bonus ?? '',
    holiday_bonus: payroll.holiday_bonus ?? '',
    tet_bonus: payroll.tet_bonus ?? '',
    note: payroll.note || '',
    month: payroll.month || currentMonth,
    year: payroll.year || currentYear,
  };
}

export default function Payroll() {
  const [payrolls, setPayrolls] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [toast, setToast] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [filters, setFilters] = useState({
    search: '',
    month: currentMonth,
    year: currentYear,
  });

  const preview = useMemo(() => calculatePreview(form), [form]);

  const localSummary = useMemo(() => payrolls.reduce((acc, row) => {
    acc.count += 1;
    acc.total_salary_month += toNumber(row.salary_month);
    acc.total_advance_amount += toNumber(row.advance_amount);
    acc.total_overtime_amount += toNumber(row.overtime_amount);
    acc.total_extra_bonus += toNumber(row.extra_bonus);
    acc.total_holiday_bonus += toNumber(row.holiday_bonus);
    acc.total_tet_bonus += toNumber(row.tet_bonus);
    acc.total_bonus += toNumber(row.overtime_amount) + toNumber(row.extra_bonus) + toNumber(row.holiday_bonus) + toNumber(row.tet_bonus);
    acc.total_income += toNumber(row.total_income);
    acc.total_net_salary += toNumber(row.net_salary);
    return acc;
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
  }), [payrolls]);

  const totals = summary || localSummary;

  useEffect(() => {
    fetchPayrolls();
  }, []);

  const showToast = useCallback((type, message) => {
    setToast({ type, message, id: Date.now() });
    if (type === 'success') {
      setNotice(message);
      setError('');
    }
    if (type === 'error') {
      setError(message);
      setNotice('');
    }
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const buildQuery = (sourceFilters = filters) => {
    const params = new URLSearchParams();
    if (sourceFilters.search.trim()) params.append('search', sourceFilters.search.trim());
    if (sourceFilters.month) params.append('month', sourceFilters.month);
    if (sourceFilters.year) params.append('year', sourceFilters.year);
    return params.toString();
  };

  const sortPayrollRows = (rows = []) => rows.slice().sort((a, b) => Number(b.year) - Number(a.year) || Number(b.month) - Number(a.month) || String(a.employee_name || '').localeCompare(String(b.employee_name || ''), 'vi'));

  const fetchPayrolls = async (sourceFilters = filters) => {
    setLoading(true);
    setError('');
    try {
      const query = buildQuery(sourceFilters);
      const [listData, summaryData] = await Promise.all([
        apiJson(`/payrolls${query ? `?${query}` : ''}`, {}, 'Không tải được danh sách bảng lương'),
        apiJson(`/payrolls/summary${query ? `?${query}` : ''}`, {}, 'Không tải được tổng hợp bảng lương'),
      ]);

      setPayrolls(Array.isArray(listData) ? sortPayrollRows(listData) : []);
      setSummary(summaryData || null);
    } catch (err) {
      setPayrolls([]);
      setSummary(null);
      setError(err.message || 'Lỗi kết nối khi t?i bảng lương');
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ ...emptyForm, month: filters.month || currentMonth, year: filters.year || currentYear });
    setError('');
    setShowForm(true);
  };

  const openEdit = (payroll) => {
    setEditing(payroll);
    setForm(normalizePayrollForForm(payroll));
    setError('');
    setShowForm(true);
  };

  const updateForm = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const validateForm = () => {
    if (!form.employee_name.trim()) return 'Vui lượng nhập t?n nhân viên';
    const month = Number.parseInt(form.month, 10);
    if (!Number.isInteger(month) || month < 1 || month > 12) return 'Tháng luong ph?i t? 1 d?n 12';
    const year = Number.parseInt(form.year, 10);
    if (!Number.isInteger(year) || year < 1900 || year > 3000) return 'Nam luong không hợp l?';

    const labels = {
      daily_wage: 'Luong/ngày',
      working_days: 'S? ngày di l?m',
      leave_days: 'S? ngày ngh?',
      advance_amount: 'Tiền ?ng tru?c',
      overtime_amount: 'Tiền tang ca',
      extra_bonus: 'Tiền thu?ng thêm',
      holiday_bonus: 'Thu?ng l?',
      tet_bonus: 'Thu?ng Tốt',
    };

    if (isBlank(form.daily_wage)) return 'Vui lượng nhập luong/ngày';
    if (isBlank(form.working_days)) return 'Vui lượng nhập s? ngày di l?m';
    if (!isValidNumberInput(form.daily_wage)) return 'Luong/ngày ph?i l? s? hợp lệ';
    if (!isValidNumberInput(form.working_days)) return 'S? ngày di l?m ph?i l? s? hợp lệ';

    for (const field of numberFields) {
      if (!isValidNumberInput(form[field])) return `${labels[field] || field} ph?i l? s? hợp lệ`;
      const value = toNumber(form[field]);
      if (value < 0) return `${labels[field] || field} không được ?m`;
    }
    return '';
  };

  const buildPayload = () => ({
    employee_name: form.employee_name.trim(),
    employee_phone: form.employee_phone.trim(),
    daily_wage: toNumber(form.daily_wage),
    working_days: toNumber(form.working_days),
    leave_days: toNumber(form.leave_days),
    advance_amount: toNumber(form.advance_amount),
    overtime_amount: toNumber(form.overtime_amount),
    extra_bonus: toNumber(form.extra_bonus),
    holiday_bonus: toNumber(form.holiday_bonus),
    tet_bonus: toNumber(form.tet_bonus),
    note: form.note.trim(),
    month: Number.parseInt(form.month, 10),
    year: Number.parseInt(form.year, 10),
  });

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing ? `/payrolls/${editing.id}` : '/payrolls';
      const payload = buildPayload();
      const data = await apiJsonChecked(url, {
        method,
        body: payload,
      }, 'Không luu được bảng lương');
      const savedPayroll = data?.payroll || data?.record || buildPayrollRecord(payload, data?.id || editing?.id);

      const nextFilters = {
        search: '',
        month: savedPayroll.month || payload.month || currentMonth,
        year: savedPayroll.year || payload.year || currentYear,
      };
      setFilters(nextFilters);
      setPayrolls(prev => {
        const withoutOld = prev.filter(row => Number(row.id) !== Number(savedPayroll.id));
        const mergedRows = editing ? [...withoutOld, savedPayroll] : [savedPayroll, ...withoutOld];
        return sortPayrollRows(mergedRows.filter(row => Number(row.month) === Number(nextFilters.month) && Number(row.year) === Number(nextFilters.year)));
      });
      setSummary(null);
      setShowForm(false);
      setEditing(null);
      setForm({ ...emptyForm, month: nextFilters.month, year: nextFilters.year });
      showToast('success', editing ? '?? cập nhật bảng lương thành công' : '?? thêm bảng lương thành công');
      fetchPayrolls(nextFilters).catch(() => {});
    } catch (err) {
      showToast('error', err.message || 'Lỗi server khi luu bảng lương');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (payroll) => {
    if (!confirm(`Xóa bảng lương của ${payroll.employee_name}?`)) return;
    setError('');
    try {
      await apiJsonChecked(`/payrolls/${payroll.id}`, { method: 'DELETE' }, 'Không xóa được bảng lương');

      setPayrolls(prev => prev.filter(row => Number(row.id) !== Number(payroll.id)));
      setSummary(null);
      showToast('success', '?? xóa bảng lương thành công');
      fetchPayrolls().catch(() => {});
    } catch (err) {
      showToast('error', err.message || 'Lỗi server khi xóa bảng lương');
    }
  };

  const clearFilters = async () => {
    const defaultFilters = { search: '', month: currentMonth, year: currentYear };
    setFilters(defaultFilters);
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ month: String(defaultFilters.month), year: String(defaultFilters.year) }).toString();
      const [listData, summaryData] = await Promise.all([
        apiJson(`/payrolls?${query}`, {}, 'Không tải được danh sách bảng lương'),
        apiJson(`/payrolls/summary?${query}`, {}, 'Không tải được tổng hợp bảng lương'),
      ]);
      setPayrolls(Array.isArray(listData) ? sortPayrollRows(listData) : []);
      setSummary(summaryData || null);
    } catch (err) {
      setPayrolls([]);
      setSummary(null);
      setError(err.message || 'Lỗi kết nối khi t?i bảng lương');
    } finally {
      setLoading(false);
    }
  };

  const renderNumberInput = (field, label, placeholder = '0', step = '1000') => (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <input
        type="number"
        min="0"
        step={step}
        className="input-field w-full"
        value={form[field]}
        onChange={e => updateForm(field, e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Wallet className="text-blue-600" size={24} /> Bằng luong nhân viên
        </h1>
        <button onClick={openAdd} className="btn-primary flex items-center gap-1">
          <Plus size={16} /> Thêm bảng lương
        </button>
      </div>

      {showHelp && (
        <HelpModal
          show={showHelp}
          onClose={() => setShowHelp(false)}
          title="Hướng dẫn bảng lương nhân viên"
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">Quy tr?nh sử dụng</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Nhân Thêm bảng lương d? tạo k? luong mới.</li>
                  <li>Nhập ngày l?m, ngày ngh?, thu?ng v? t?m ?ng.</li>
                  <li>Lực theo th?ng ho?c nam d? xem danh sách d? luu.</li>
                  <li>Dùng n?t Sửa ho?c Xóa tr?n tứng dụng khi c?n ch?nh.</li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-gray-800 mb-2">Luu ?</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Tổng luong v? th?c nhân được t?nh tự động t? dữ liệu nh?p.</li>
                </ul>
              </div>
            </div>
          }
        />
      )}

      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-3 text-sm">
          ? {notice}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          ?? {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <div className="card border-t-4 border-blue-500">
          <div className="text-xs text-gray-500 mb-1">T?NG LUONG TH?NG</div>
          <div className="text-xl font-bold text-blue-600">{formatVND(totals.total_salary_month)}</div>
        </div>
        <div className="card border-t-4 border-orange-500">
          <div className="text-xs text-gray-500 mb-1">T?NG TI?N ?NG</div>
          <div className="text-xl font-bold text-orange-600">{formatVND(totals.total_advance_amount)}</div>
        </div>
        <div className="card border-t-4 border-purple-500">
          <div className="text-xs text-gray-500 mb-1">T?NG THU?NG TH?M / TANG CA</div>
          <div className="text-xl font-bold text-purple-600">{formatVND(totals.total_bonus)}</div>
        </div>
        <div className="card border-t-4 border-emerald-500">
          <div className="text-xs text-gray-500 mb-1">T?NG LUONG</div>
          <div className="text-xl font-bold text-emerald-600">{formatVND(totals.total_net_salary)}</div>
        </div>
      </div>

      <div className="card mb-4 bg-gray-50">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs text-gray-500 block mb-1">Tìm kiếm</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <input
                className="input-field pl-9"
                value={filters.search}
                onChange={e => setFilters(prev => ({ ...prev, search: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') fetchPayrolls(); }}
                placeholder="Tồn nhân viên ho?c s? điện thoại..."
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Tháng</label>
            <select className="input-field w-28" value={filters.month} onChange={e => setFilters(prev => ({ ...prev, month: e.target.value }))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(month => <option key={month} value={month}>Tháng {month}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Nam</label>
            <input type="number" className="input-field w-28" min="1900" max="3000" value={filters.year} onChange={e => setFilters(prev => ({ ...prev, year: e.target.value }))} />
          </div>
          <button onClick={fetchPayrolls} className="px-4 py-2 bg-blue-600 text-white rounded text-sm flex items-center gap-1">
            <Filter size={14} /> Lực
          </button>
          <button onClick={clearFilters} className="px-4 py-2 bg-gray-200 text-gray-700 hover:bg-gray-300 rounded text-sm flex items-center gap-1">
            <RefreshCcw size={14} /> Mặc định
          </button>
        </div>
      </div>

      <div className="system-table-scroll card p-0">
        <table className="system-table payroll-table text-sm">
          <colgroup>
            <col style={{ width: '7%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '8%' }} />
          </colgroup>
          <thead>
            <tr>
              <th className="p-2 text-left">K? luong</th>
              <th className="p-2 text-left">Tồn nhân viên</th>
              <th className="p-2 text-left">S? điện thoại</th>
              <th className="p-2 text-right">Luong/ngày</th>
              <th className="p-2 text-right">Ngày l?m</th>
              <th className="p-2 text-right">Ngày ngh?</th>
              <th className="p-2 text-right">Luong th?ng</th>
              <th className="p-2 text-right">?ng tru?c</th>
              <th className="p-2 text-right">Tang ca</th>
              <th className="p-2 text-right">Thu?ng thêm</th>
              <th className="p-2 text-right">Thu?ng l?</th>
              <th className="p-2 text-right">Thu?ng Tốt</th>
              <th className="p-2 text-right">Tổng thu nh?p</th>
              <th className="p-2 text-right">Th?c nhân</th>
              <th className="p-2 text-left">Ghi ch?</th>
              <th className="p-2 text-center">H?nh d?ng</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={16} className="text-center text-gray-400 py-10"><Loader size={16} className="inline animate-spin mr-2" />đang t?i bảng lương...</td></tr>
            ) : payrolls.length === 0 ? (
              <tr><td colSpan={16} className="text-center text-gray-400 py-10">Chua c? bảng lương phù hợp</td></tr>
            ) : payrolls.map(row => (
              <tr key={`${row.id}-${row.month}-${row.year}`} className="border-b hover:bg-gray-50">
                <td className="p-2 font-medium">{String(row.month).padStart(2, '0')}/{row.year}</td>
                <td className="p-2 font-semibold text-gray-800">{row.employee_name}</td>
                <td className="p-2 text-gray-600">{row.employee_phone || '?'}</td>
                <td className="p-2 text-right">{formatVND(row.daily_wage)}</td>
                <td className="p-2 text-right">{row.working_days}</td>
                <td className="p-2 text-right">{row.leave_days}</td>
                <td className="p-2 text-right font-semibold text-blue-600">{formatVND(row.salary_month)}</td>
                <td className="p-2 text-right text-orange-600">{formatVND(row.advance_amount)}</td>
                <td className="p-2 text-right">{formatVND(row.overtime_amount)}</td>
                <td className="p-2 text-right">{formatVND(row.extra_bonus)}</td>
                <td className="p-2 text-right">{formatVND(row.holiday_bonus)}</td>
                <td className="p-2 text-right">{formatVND(row.tet_bonus)}</td>
                <td className="p-2 text-right font-semibold text-purple-600">{formatVND(row.total_income)}</td>
                <td className="p-2 text-right font-bold text-emerald-600">{formatVND(row.net_salary)}</td>
                <td className="p-2 text-gray-500 max-w-[220px] truncate" title={row.note || ''}>{row.note || '?'}</td>
                <td className="p-2 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button onClick={() => openEdit(row)} className="order-table-action-btn border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100">
                      <Edit2 size={12} /> Sửa
                    </button>
                    <button onClick={() => handleDelete(row)} className="order-table-action-btn border border-red-200 bg-red-50 text-red-600 hover:bg-red-100">
                      <Trash2 size={12} /> Xóa
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {payrolls.length > 0 && (
            <tfoot>
              <tr className="bg-blue-50 text-gray-800 font-bold border-t-2 border-blue-200">
                <td colSpan={6} className="p-2 text-right">Tổng c?ng ({totals.count} bảng lương)</td>
                <td className="p-2 text-right text-blue-700">{formatVND(totals.total_salary_month)}</td>
                <td className="p-2 text-right text-orange-700">{formatVND(totals.total_advance_amount)}</td>
                <td className="p-2 text-right">{formatVND(totals.total_overtime_amount)}</td>
                <td className="p-2 text-right">{formatVND(totals.total_extra_bonus)}</td>
                <td className="p-2 text-right">{formatVND(totals.total_holiday_bonus)}</td>
                <td className="p-2 text-right">{formatVND(totals.total_tet_bonus)}</td>
                <td className="p-2 text-right text-purple-700">{formatVND(totals.total_income)}</td>
                <td className="p-2 text-right text-emerald-700">{formatVND(totals.total_net_salary)}</td>
                <td colSpan={2} className="p-2"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-[920px] max-w-full max-h-[92vh] overflow-auto">
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-xl">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Wallet size={20} className="text-blue-600" /> {editing ? 'Sửa bảng lương' : 'Thêm bảng lương nhân viên'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Tồn nhân viên <span className="text-red-500">*</span></label>
                  <input className="input-field w-full" value={form.employee_name} onChange={e => updateForm('employee_name', e.target.value)} placeholder="VD: Nguy?n Van A" autoFocus />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">S? điện thoại</label>
                  <input className="input-field w-full" value={form.employee_phone} onChange={e => updateForm('employee_phone', e.target.value)} placeholder="VD: 09xxxxxxxx" />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Tháng <span className="text-red-500">*</span></label>
                  <select className="input-field w-full" value={form.month} onChange={e => updateForm('month', e.target.value)}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(month => <option key={month} value={month}>Tháng {month}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Nam <span className="text-red-500">*</span></label>
                  <input type="number" min="1900" max="3000" className="input-field w-full" value={form.year} onChange={e => updateForm('year', e.target.value)} />
                </div>
                {renderNumberInput('working_days', 'S? ngày di l?m', '0', '0.5')}
                {renderNumberInput('leave_days', 'S? ngày ngh?', '0', '0.5')}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {renderNumberInput('daily_wage', 'Luong 1 ngày c?ng')}
                {renderNumberInput('advance_amount', 'Tiền ?ng tru?c')}
                {renderNumberInput('overtime_amount', 'Tiền tang ca')}
                {renderNumberInput('extra_bonus', 'Tiền thu?ng thêm')}
                {renderNumberInput('holiday_bonus', 'Thu?ng l?')}
                {renderNumberInput('tet_bonus', 'Thu?ng Tốt')}
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">Ghi ch?</label>
                <textarea className="input-field w-full" rows={3} value={form.note} onChange={e => updateForm('note', e.target.value)} placeholder="Ghi ch? thêm n?u c?n..." />
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                Tổng thu nh?p được t?nh t? luong th?ng, tang ca, thu?ng thêm, thu?ng l? v? thu?ng Tốt; th?c nhân tr? ti?n ?ng tru?c.
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <div className="flex items-center gap-2 text-blue-800 font-semibold mb-3">
                  <Calculator size={18} /> Tự động t?nh luong
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="bg-white rounded-lg p-3 border">
                    <div className="text-xs text-gray-500">Luong th?ng</div>
                    <div className="text-lg font-bold text-blue-600">{formatVND(preview.salaryMonth)}</div>
                    <div className="text-xs text-gray-400">Luong/ngày ? ngày l?m</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 border">
                    <div className="text-xs text-gray-500">Tổng thu nh?p</div>
                    <div className="text-lg font-bold text-purple-600">{formatVND(preview.totalIncome)}</div>
                    <div className="text-xs text-gray-400">Luong th?ng + tang ca + c?c kho?n thu?ng</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 border">
                    <div className="text-xs text-gray-500">Luong th?c nhân</div>
                    <div className="text-lg font-bold text-emerald-600">{formatVND(preview.netSalary)}</div>
                    <div className="text-xs text-gray-400">Tổng thu nh?p - ?ng tru?c</div>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving} className="btn-success flex-1 disabled:opacity-50">
                   {saving ? 'đang luu...' : 'Luu bảng lương'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-danger flex-1">Hủy</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-stack">
          <div className={`toast-card ${toast.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {toast.type === 'success' ? '?' : '??'} {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}
