import { useEffect, useMemo, useState } from 'react';
import { API } from '../App';
import { Calculator, Edit2, Filter, Loader, Plus, RefreshCcw, Search, Trash2, Wallet, X } from 'lucide-react';

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
  const totalIncome = salaryMonth
    + toNumber(source.extra_bonus)
    + toNumber(source.overtime_amount);
  const netSalary = totalIncome - toNumber(source.advance_amount);

  return { salaryMonth, totalIncome, netSalary };
}

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));
}

async function parseJsonResponse(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!contentType.toLowerCase().includes('application/json')) {
    const preview = text.trim().slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(`${fallbackMessage}. Máy chủ không trả JSON từ ${response.url}. Kiểm tra API /api/payrolls đã được mount/proxy đúng. Nội dung nhận được: ${preview || 'trống'}`);
  }

  try {
    return text ? JSON.parse(text) : null;
  } catch (err) {
    throw new Error(`${fallbackMessage}. JSON trả về không hợp lệ: ${err.message}`);
  }
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
  const [showForm, setShowForm] = useState(false);
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
    acc.total_bonus += toNumber(row.overtime_amount) + toNumber(row.extra_bonus);
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

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const buildQuery = () => {
    const params = new URLSearchParams();
    if (filters.search.trim()) params.append('search', filters.search.trim());
    if (filters.month) params.append('month', filters.month);
    if (filters.year) params.append('year', filters.year);
    return params.toString();
  };

  const fetchPayrolls = async () => {
    setLoading(true);
    setError('');
    try {
      const query = buildQuery();
      const [listRes, summaryRes] = await Promise.all([
        fetch(`${API}/payrolls${query ? `?${query}` : ''}`),
        fetch(`${API}/payrolls/summary${query ? `?${query}` : ''}`),
      ]);

      const listData = await parseJsonResponse(listRes, 'Không tải được danh sách bảng lương');
      const summaryData = await parseJsonResponse(summaryRes, 'Không tải được tổng hợp bảng lương');

      if (!listRes.ok) throw new Error(listData.error || 'Không tải được danh sách bảng lương');
      if (!summaryRes.ok) throw new Error(summaryData.error || 'Không tải được tổng hợp bảng lương');

      setPayrolls(Array.isArray(listData) ? listData : []);
      setSummary(summaryData);
    } catch (err) {
      setPayrolls([]);
      setSummary(null);
      setError(err.message || 'Lỗi kết nối khi tải bảng lương');
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
    if (!form.employee_name.trim()) return 'Vui lòng nhập tên nhân viên';
    const month = Number.parseInt(form.month, 10);
    if (!Number.isInteger(month) || month < 1 || month > 12) return 'Tháng lương phải từ 1 đến 12';
    const year = Number.parseInt(form.year, 10);
    if (!Number.isInteger(year) || year < 1900 || year > 3000) return 'Năm lương không hợp lệ';
    for (const field of numberFields) {
      const value = toNumber(form[field]);
      if (value < 0) return 'Số tiền và số ngày không được âm';
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
      const url = editing ? `${API}/payrolls/${editing.id}` : `${API}/payrolls`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const data = await parseJsonResponse(res, 'Không lưu được bảng lương');
      if (!res.ok || !data.ok) throw new Error(data.error || 'Không lưu được bảng lương');

      setShowForm(false);
      setNotice(editing ? 'Đã cập nhật bảng lương thành công' : 'Đã thêm bảng lương thành công');
      await fetchPayrolls();
    } catch (err) {
      setError(err.message || 'Lỗi kết nối khi lưu bảng lương');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (payroll) => {
    if (!confirm(`Xóa bảng lương của ${payroll.employee_name}?`)) return;
    setError('');
    try {
      const res = await fetch(`${API}/payrolls/${payroll.id}`, { method: 'DELETE' });
      const data = await parseJsonResponse(res, 'Không xóa được bảng lương');
      if (!res.ok || !data.ok) throw new Error(data.error || 'Không xóa được bảng lương');

      setNotice('Đã xóa bảng lương thành công');
      await fetchPayrolls();
    } catch (err) {
      setError(err.message || 'Lỗi kết nối khi xóa bảng lương');
    }
  };

  const clearFilters = async () => {
    const defaultFilters = { search: '', month: currentMonth, year: currentYear };
    setFilters(defaultFilters);
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ month: String(defaultFilters.month), year: String(defaultFilters.year) }).toString();
      const [listRes, summaryRes] = await Promise.all([
        fetch(`${API}/payrolls?${query}`),
        fetch(`${API}/payrolls/summary?${query}`),
      ]);
      const listData = await parseJsonResponse(listRes, 'Không tải được danh sách bảng lương');
      const summaryData = await parseJsonResponse(summaryRes, 'Không tải được tổng hợp bảng lương');
      if (!listRes.ok) throw new Error(listData.error || 'Không tải được danh sách bảng lương');
      if (!summaryRes.ok) throw new Error(summaryData.error || 'Không tải được tổng hợp bảng lương');
      setPayrolls(Array.isArray(listData) ? listData : []);
      setSummary(summaryData);
    } catch (err) {
      setPayrolls([]);
      setSummary(null);
      setError(err.message || 'Lỗi kết nối khi tải bảng lương');
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
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Wallet className="text-blue-600" size={24} /> Bảng lương nhân viên
        </h1>
        <button onClick={openAdd} className="btn-primary flex items-center gap-1">
          <Plus size={16} /> Thêm bảng lương
        </button>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-4 py-3 text-sm">
          ✅ {notice}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          ⚠️ {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <div className="card border-t-4 border-blue-500">
          <div className="text-xs text-gray-500 mb-1">TỔNG LƯƠNG THÁNG</div>
          <div className="text-xl font-bold text-blue-600">{formatVND(totals.total_salary_month)}</div>
        </div>
        <div className="card border-t-4 border-orange-500">
          <div className="text-xs text-gray-500 mb-1">TỔNG TIỀN ỨNG</div>
          <div className="text-xl font-bold text-orange-600">{formatVND(totals.total_advance_amount)}</div>
        </div>
        <div className="card border-t-4 border-purple-500">
          <div className="text-xs text-gray-500 mb-1">TỔNG THƯỞNG THÊM / TĂNG CA</div>
          <div className="text-xl font-bold text-purple-600">{formatVND(totals.total_bonus)}</div>
        </div>
        <div className="card border-t-4 border-emerald-500">
          <div className="text-xs text-gray-500 mb-1">TỔNG LƯƠNG</div>
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
                placeholder="Tên nhân viên hoặc số điện thoại..."
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
            <label className="text-xs text-gray-500 block mb-1">Năm</label>
            <input type="number" className="input-field w-28" min="1900" max="3000" value={filters.year} onChange={e => setFilters(prev => ({ ...prev, year: e.target.value }))} />
          </div>
          <button onClick={fetchPayrolls} className="px-4 py-2 bg-blue-600 text-white rounded text-sm flex items-center gap-1">
            <Filter size={14} /> Lọc
          </button>
          <button onClick={clearFilters} className="px-4 py-2 bg-gray-200 text-gray-700 hover:bg-gray-300 rounded text-sm flex items-center gap-1">
            <RefreshCcw size={14} /> Mặc định
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[1650px]">
          <thead>
            <tr className="bg-gray-100 text-gray-600">
              <th className="p-2 text-left">Kỳ lương</th>
              <th className="p-2 text-left">Tên nhân viên</th>
              <th className="p-2 text-left">Số điện thoại</th>
              <th className="p-2 text-right">Lương/ngày</th>
              <th className="p-2 text-right">Ngày làm</th>
              <th className="p-2 text-right">Ngày nghỉ</th>
              <th className="p-2 text-right">Lương tháng</th>
              <th className="p-2 text-right">Ứng trước</th>
              <th className="p-2 text-right">Tăng ca</th>
              <th className="p-2 text-right">Thưởng thêm</th>
              <th className="p-2 text-right">Thưởng lễ</th>
              <th className="p-2 text-right">Thưởng Tết</th>
              <th className="p-2 text-right">Tổng thu nhập</th>
              <th className="p-2 text-right">Thực nhận</th>
              <th className="p-2 text-left">Ghi chú</th>
              <th className="p-2 text-center">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={16} className="text-center text-gray-400 py-10"><Loader size={16} className="inline animate-spin mr-2" />Đang tải bảng lương...</td></tr>
            ) : payrolls.length === 0 ? (
              <tr><td colSpan={16} className="text-center text-gray-400 py-10">Chưa có bảng lương phù hợp</td></tr>
            ) : payrolls.map(row => (
              <tr key={row.id} className="border-b hover:bg-gray-50">
                <td className="p-2 font-medium">{String(row.month).padStart(2, '0')}/{row.year}</td>
                <td className="p-2 font-semibold text-gray-800">{row.employee_name}</td>
                <td className="p-2 text-gray-600">{row.employee_phone || '—'}</td>
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
                <td className="p-2 text-gray-500 max-w-[220px] truncate" title={row.note || ''}>{row.note || '—'}</td>
                <td className="p-2 text-center whitespace-nowrap">
                  <button onClick={() => openEdit(row)} className="text-blue-600 hover:text-blue-800 text-xs mr-3 inline-flex items-center gap-1">
                    <Edit2 size={12} /> Sửa
                  </button>
                  <button onClick={() => handleDelete(row)} className="text-red-500 hover:text-red-700 text-xs inline-flex items-center gap-1">
                    <Trash2 size={12} /> Xóa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {payrolls.length > 0 && (
            <tfoot>
              <tr className="bg-blue-50 text-gray-800 font-bold border-t-2 border-blue-200">
                <td colSpan={6} className="p-2 text-right">Tổng cộng ({totals.count} bảng lương)</td>
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
                  <label className="text-xs text-gray-500 block mb-1">Tên nhân viên <span className="text-red-500">*</span></label>
                  <input className="input-field w-full" value={form.employee_name} onChange={e => updateForm('employee_name', e.target.value)} placeholder="VD: Nguyễn Văn A" autoFocus />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Số điện thoại</label>
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
                  <label className="text-xs text-gray-500 block mb-1">Năm <span className="text-red-500">*</span></label>
                  <input type="number" min="1900" max="3000" className="input-field w-full" value={form.year} onChange={e => updateForm('year', e.target.value)} />
                </div>
                {renderNumberInput('working_days', 'Số ngày đi làm', '0', '0.5')}
                {renderNumberInput('leave_days', 'Số ngày nghỉ', '0', '0.5')}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {renderNumberInput('daily_wage', 'Lương 1 ngày công')}
                {renderNumberInput('advance_amount', 'Tiền ứng trước')}
                {renderNumberInput('overtime_amount', 'Tiền tăng ca')}
                {renderNumberInput('extra_bonus', 'Tiền thưởng thêm')}
                {renderNumberInput('holiday_bonus', 'Thưởng lễ')}
                {renderNumberInput('tet_bonus', 'Thưởng Tết')}
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">Ghi chú</label>
                <textarea className="input-field w-full" rows={3} value={form.note} onChange={e => updateForm('note', e.target.value)} placeholder="Ghi chú thêm nếu cần..." />
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                Thưởng lễ và Thưởng Tết được lưu/hiển thị riêng để theo dõi, không cộng vào Tổng thu nhập. Nếu cần tính vào lương, nhập chung vào Tiền thưởng thêm.
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <div className="flex items-center gap-2 text-blue-800 font-semibold mb-3">
                  <Calculator size={18} /> Tự động tính lương
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="bg-white rounded-lg p-3 border">
                    <div className="text-xs text-gray-500">Lương tháng</div>
                    <div className="text-lg font-bold text-blue-600">{formatVND(preview.salaryMonth)}</div>
                    <div className="text-xs text-gray-400">Lương/ngày × ngày làm</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 border">
                    <div className="text-xs text-gray-500">Tổng thu nhập</div>
                    <div className="text-lg font-bold text-purple-600">{formatVND(preview.totalIncome)}</div>
                    <div className="text-xs text-gray-400">Lương tháng + thưởng thêm + tăng ca</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 border">
                    <div className="text-xs text-gray-500">Lương thực nhận</div>
                    <div className="text-lg font-bold text-emerald-600">{formatVND(preview.netSalary)}</div>
                    <div className="text-xs text-gray-400">Tổng thu nhập - ứng trước</div>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving} className="btn-success flex-1 disabled:opacity-50">
                  💾 {saving ? 'Đang lưu...' : 'Lưu bảng lương'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-danger flex-1">Hủy</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
