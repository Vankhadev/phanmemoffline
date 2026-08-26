import { useEffect, useMemo, useState } from 'react';
import { Trophy, Loader, RefreshCw, Users } from 'lucide-react';
import { customersApi } from '../utils/apiClient';

const formatVND = value => `${Math.round(Number(value) || 0).toLocaleString('vi-VN')} đ`;

export default function TopCustomers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadCustomers = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await customersApi.list();
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || 'Không tải được dữ liệu khách hàng.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCustomers(); }, []);

  const topCustomers = useMemo(() => [...customers]
    .sort((a, b) => {
      const revenueDiff = (Number(b.total_revenue) || 0) - (Number(a.total_revenue) || 0);
      if (revenueDiff !== 0) return revenueDiff;
      return (Number(b.invoice_count) || 0) - (Number(a.invoice_count) || 0);
    })
    .slice(0, 200), [customers]);

  return (
    <div className="min-w-0 space-y-4">
      <section className="rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 p-5 text-white shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-amber-100"><Trophy size={22} /> Xếp hạng khách hàng</div>
            <h1 className="mt-2 text-2xl font-extrabold">Top 200 khách hàng</h1>
            <p className="mt-1 text-sm text-amber-50">Xếp theo doanh thu cao nhất từ các đơn hàng không bị hủy.</p>
          </div>
          <button type="button" onClick={loadCustomers} disabled={loading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25 disabled:opacity-60">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Làm mới
          </button>
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex min-h-64 items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white text-gray-500"><Loader size={20} className="animate-spin" /> Đang tải xếp hạng...</div>
      ) : topCustomers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-16 text-center text-gray-500"><Users className="mx-auto mb-3 text-gray-300" size={36} />Chưa có dữ liệu doanh thu khách hàng.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {topCustomers.map((customer, index) => {
            const rank = index + 1;
            const style = rank === 1 ? 'border-amber-300 bg-amber-50' : rank === 2 ? 'border-slate-300 bg-slate-50' : rank === 3 ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-white';
            return (
              <article key={customer.id} className={`rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${style}`}>
                <div className="flex items-center justify-between"><span className="inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-white px-2 text-lg font-extrabold text-amber-600 shadow-sm">#{rank}</span><Trophy size={18} className={rank <= 3 ? 'text-amber-500' : 'text-gray-300'} /></div>
                <h2 className="mt-4 truncate text-base font-bold text-gray-900" title={customer.name}>{customer.name || 'Khách hàng'}</h2>
                <p className="mt-1 truncate text-xs text-gray-500">{customer.phone || customer.email || 'Chưa có liên hệ'}</p>
                <p className="mt-4 text-xl font-extrabold text-emerald-700">{formatVND(customer.total_revenue)}</p>
                <p className="mt-1 text-xs text-gray-500">{Number(customer.invoice_count) || 0} đơn hàng</p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
