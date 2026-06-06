import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Banknote,
  BookOpenCheck,
  CalendarDays,
  FileClock,
  Landmark,
  Loader2,
  ReceiptText,
  RefreshCw,
  Scale,
  TrendingUp,
  UsersRound,
  Warehouse,
} from 'lucide-react';
import { accountingApi, getApiErrorMessage } from '../utils/apiClient';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toDateInput(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getDefaultRange() {
  const now = new Date();
  return {
    from: toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDateInput(now),
  };
}

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
}

const ACCOUNTING_LINKS = [
  { to: '/ke-toan/bao-cao-thue', label: 'Báo cáo thuế GTGT', description: 'Thuế đầu vào, đầu ra và phải nộp', icon: ReceiptText, tone: 'blue' },
  { to: '/ke-toan/bao-cao-ton-kho', label: 'Báo cáo tồn kho', description: 'Giá vốn, giá trị tồn và cảnh báo kho', icon: Warehouse, tone: 'amber' },
  { to: '/ke-toan/nhat-ky', label: 'Nhật ký hoạt động', description: 'Tra cứu thay đổi nghiệp vụ kế toán', icon: FileClock, tone: 'violet' },
];

const PREPARED_FEATURES = [
  { label: 'Quỹ kế toán', description: 'Tổng hợp thu, chi và số dư quỹ', icon: Landmark },
  { label: 'Công nợ', description: 'Khách hàng và nhà cung cấp', icon: UsersRound },
  { label: 'Hóa đơn điện tử', description: 'Hóa đơn đầu vào và đầu ra', icon: BookOpenCheck },
  { label: 'Tài khoản ngân hàng', description: 'Danh mục tài khoản nhận/chi', icon: Banknote },
];

function toneClasses(tone) {
  const tones = {
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    violet: 'border-violet-200 bg-violet-50 text-violet-700',
  };
  return tones[tone] || tones.blue;
}

export default function AccountingDashboard({ user }) {
  const defaults = useMemo(() => getDefaultRange(), []);
  const [filters, setFilters] = useState(defaults);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const role = String(user?.role || '').trim().toLowerCase();
  const isCashier = role === 'cashier';

  async function loadSummary() {
    if (!filters.from || !filters.to || filters.from > filters.to) {
      setError('Khoảng ngày không hợp lệ.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await accountingApi.revenueProfit(filters);
      setSummary(data?.summary || {});
    } catch (requestError) {
      setSummary(null);
      setError(getApiErrorMessage(requestError?.data || requestError, requestError?.message || 'Không thể tải tổng hợp doanh thu.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
    // Tải kỳ mặc định khi mở dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-w-0 space-y-4">
      <section className="overflow-hidden rounded-2xl border border-emerald-900 bg-gradient-to-r from-emerald-950 via-teal-900 to-slate-900 text-white shadow-lg">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-3"><Scale size={27} className="text-emerald-200" /></div>
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-200/80">Module kế toán</div>
              <h1 className="mt-1 text-2xl font-bold">{isCashier ? 'Báo cáo doanh thu' : 'Tổng quan kế toán'}</h1>
              <p className="mt-1 max-w-3xl text-sm text-emerald-100/75">{isCashier ? 'Tài khoản thu ngân chỉ được xem tổng hợp doanh thu theo kỳ.' : 'Điểm truy cập nhanh đến báo cáo thuế, tồn kho, nhật ký và các dữ liệu kế toán cốt lõi.'}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[180px_180px_auto]">
          <div><label className="mb-1 block text-xs font-semibold text-gray-500">Từ ngày</label><input type="date" className="input-field" value={filters.from} max={filters.to || undefined} onChange={event => setFilters(current => ({ ...current, from: event.target.value }))} /></div>
          <div><label className="mb-1 block text-xs font-semibold text-gray-500">Đến ngày</label><input type="date" className="input-field" value={filters.to} min={filters.from || undefined} onChange={event => setFilters(current => ({ ...current, to: event.target.value }))} /></div>
          <div className="flex items-end"><button type="button" onClick={loadSummary} disabled={loading} className="btn-primary min-h-11 w-full sm:w-auto">{loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Xem tổng hợp</button></div>
        </div>
        <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"><CalendarDays size={13} /> {filters.from} - {filters.to}</div>
        {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}
      </section>

      <section className={`grid grid-cols-1 gap-3 ${isCashier ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-4'}`}>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide"><TrendingUp size={16} /> Tổng doanh thu</div><div className="mt-2 text-2xl font-extrabold">{loading ? '...' : formatVND(summary?.total_revenue)}</div></div>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-700"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide"><ReceiptText size={16} /> Số hóa đơn</div><div className="mt-2 text-2xl font-extrabold">{loading ? '...' : formatNumber(summary?.invoice_count)}</div></div>
        {!isCashier && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-700"><div className="text-xs font-bold uppercase tracking-wide">Tổng giá vốn</div><div className="mt-2 text-2xl font-extrabold">{loading ? '...' : formatVND(summary?.total_cost)}</div></div>}
        {!isCashier && <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-violet-700"><div className="text-xs font-bold uppercase tracking-wide">Lợi nhuận</div><div className="mt-2 text-2xl font-extrabold">{loading ? '...' : formatVND(summary?.total_profit)}</div></div>}
      </section>

      {!isCashier && (
        <>
          <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {ACCOUNTING_LINKS.map(item => {
              const Icon = item.icon;
              return <Link key={item.to} to={item.to} className={`group rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${toneClasses(item.tone)}`}><div className="flex items-start justify-between gap-3"><div className="rounded-xl bg-white/70 p-2"><Icon size={21} /></div><ArrowRight size={17} className="transition group-hover:translate-x-1" /></div><div className="mt-3 font-bold">{item.label}</div><div className="mt-1 text-sm opacity-75">{item.description}</div></Link>;
            })}
          </section>
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"><h2 className="font-bold text-gray-800">API kế toán đã sẵn sàng</h2><p className="mt-1 text-sm text-gray-500">Các nhóm dưới đây đã được chuẩn bị helper tích hợp; phạm vi hiện tại chưa triển khai CRUD đầy đủ.</p><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{PREPARED_FEATURES.map(item => { const Icon = item.icon; return <div key={item.label} className="rounded-xl border border-gray-200 bg-gray-50 p-3"><Icon size={18} className="text-gray-500" /><div className="mt-2 text-sm font-bold text-gray-700">{item.label}</div><div className="mt-1 text-xs text-gray-500">{item.description}</div></div>; })}</div></section>
        </>
      )}
    </div>
  );
}
