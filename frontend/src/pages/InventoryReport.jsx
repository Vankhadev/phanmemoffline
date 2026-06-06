import { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Boxes,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Loader2,
  PackageX,
  RefreshCw,
  Search,
  WalletCards,
} from 'lucide-react';
import { getApiErrorMessage, inventoryApi } from '../utils/apiClient';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'in_stock', label: 'Còn hàng' },
  { value: 'low', label: 'Sắp hết hàng' },
  { value: 'out', label: 'Hết hàng' },
  { value: 'negative', label: 'Âm kho' },
];

const STATUS_META = {
  in_stock: { label: 'Còn hàng', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: CircleCheck },
  low: { label: 'Sắp hết hàng', className: 'border-amber-200 bg-amber-50 text-amber-700', icon: AlertTriangle },
  out: { label: 'Hết hàng', className: 'border-red-200 bg-red-50 text-red-700', icon: PackageX },
  negative: { label: 'Âm kho', className: 'border-rose-300 bg-rose-600 text-white', icon: AlertOctagon },
};

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function normalizeResponse(data = {}) {
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.data) ? data.data : [];
  const pagination = data?.pagination && typeof data.pagination === 'object' ? data.pagination : {};
  const total = Number(pagination.total ?? data.total ?? items.length) || 0;
  const limit = Number(pagination.limit ?? data.limit ?? PAGE_SIZE) || PAGE_SIZE;
  const page = Number(pagination.page ?? data.page ?? 1) || 1;
  const totalPages = Number(pagination.total_pages ?? data.total_pages ?? (total > 0 ? Math.ceil(total / limit) : 0)) || 0;
  return {
    items,
    summary: data?.summary || {},
    pagination: {
      page,
      limit,
      total,
      total_pages: totalPages,
      has_next: Boolean(pagination.has_next ?? page < totalPages),
      has_prev: Boolean(pagination.has_prev ?? page > 1),
    },
    generated_at: data?.generated_at || null,
  };
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.in_stock;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${meta.className}`}>
      <Icon size={13} /> {meta.label}
    </span>
  );
}

function SummaryCard({ icon: Icon, label, value, tone = 'blue', money = false }) {
  const tones = {
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-red-200 bg-red-50 text-red-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    violet: 'border-violet-200 bg-violet-50 text-violet-700',
  };
  return (
    <div className={`rounded-2xl border p-3.5 ${tones[tone] || tones.blue}`}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide opacity-80"><Icon size={15} /> {label}</div>
      <div className="mt-1.5 break-words text-xl font-extrabold">{money ? formatVND(value) : formatNumber(value)}</div>
    </div>
  );
}

export default function InventoryReport() {
  const [searchText, setSearchText] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('product_name');
  const [order, setOrder] = useState('asc');
  const [threshold, setThreshold] = useState(5);
  const [data, setData] = useState(() => normalizeResponse());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const rows = data.items;
  const summary = data.summary;
  const pagination = data.pagination;
  const querySignature = useMemo(
    () => JSON.stringify({ search: appliedSearch, status, page, sort, order, threshold }),
    [appliedSearch, order, page, sort, status, threshold],
  );

  async function loadReport({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError('');
    try {
      const response = await inventoryApi.report({
        search: appliedSearch,
        status,
        page,
        limit: PAGE_SIZE,
        sort,
        order,
        low_stock_threshold: threshold,
      });
      setData(normalizeResponse(response));
    } catch (requestError) {
      setData(normalizeResponse());
      setError(getApiErrorMessage(requestError?.data || requestError, requestError?.message || 'Không thể tải báo cáo tồn kho.'));
    } finally {
      setLoading(false);
    }
  }

  function applySearch(event) {
    event?.preventDefault();
    setPage(1);
    setAppliedSearch(searchText.trim());
  }

  function resetFilters() {
    setSearchText('');
    setAppliedSearch('');
    setStatus('all');
    setSort('product_name');
    setOrder('asc');
    setThreshold(5);
    setPage(1);
  }

  useEffect(() => {
    loadReport();
    // querySignature gom toàn bộ bộ lọc server-side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySignature]);

  return (
    <div className="min-w-0 space-y-4">
      <section className="overflow-hidden rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-600 via-amber-500 to-yellow-500 text-white shadow-lg">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl border border-white/20 bg-white/15 p-3"><Boxes size={27} /></div>
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.22em] text-orange-50/80">Kho hàng · Báo cáo</div>
              <h1 className="mt-1 text-2xl font-bold">Báo cáo tồn kho</h1>
              <p className="mt-1 max-w-3xl text-sm text-white/85">Theo dõi số lượng tồn, giá vốn, giá trị tồn kho và các cảnh báo sắp hết, hết hàng hoặc âm kho.</p>
            </div>
          </div>
          <button type="button" onClick={() => loadReport()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/15 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/25 disabled:opacity-60">
            <RefreshCw size={17} className={loading ? 'animate-spin' : ''} /> Làm mới
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <SummaryCard icon={Boxes} label="Mặt hàng" value={summary.total_items} tone="blue" />
        <SummaryCard icon={CircleCheck} label="Còn hàng" value={summary.in_stock_count} tone="emerald" />
        <SummaryCard icon={AlertTriangle} label="Sắp hết" value={summary.low_stock_count} tone="amber" />
        <SummaryCard icon={PackageX} label="Hết hàng" value={summary.out_of_stock_count} tone="red" />
        <SummaryCard icon={AlertOctagon} label="Âm kho" value={summary.negative_stock_count} tone="rose" />
        <SummaryCard icon={WalletCards} label="Giá trị tồn" value={summary.total_inventory_value} tone="violet" money />
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <form onSubmit={applySearch} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_180px_170px_120px_130px_auto]">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">Tìm sản phẩm</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input-field pl-9" value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="Tên, mã sản phẩm hoặc SKU..." />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">Trạng thái</label>
            <select className="input-field" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
              {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">Sắp xếp theo</label>
            <select className="input-field" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}>
              <option value="product_name">Tên sản phẩm</option>
              <option value="stock">Tồn kho</option>
              <option value="cost_price">Giá vốn</option>
              <option value="inventory_value">Giá trị tồn</option>
              <option value="status">Trạng thái</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">Thứ tự</label>
            <select className="input-field" value={order} onChange={event => { setOrder(event.target.value); setPage(1); }}>
              <option value="asc">Tăng dần</option>
              <option value="desc">Giảm dần</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">Ngưỡng sắp hết</label>
            <input type="number" min="0" step="1" className="input-field" value={threshold} onChange={event => { setThreshold(Math.max(0, Number(event.target.value) || 0)); setPage(1); }} />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" disabled={loading} className="btn-primary min-h-11 flex-1 xl:flex-none"><Search size={16} /> Lọc</button>
            <button type="button" onClick={resetFilters} disabled={loading} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50" title="Đặt lại bộ lọc"><RefreshCw size={16} /></button>
          </div>
        </form>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
          <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-blue-700">Tổng tồn: <strong>{formatNumber(summary.total_stock)}</strong></span>
          <span className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-amber-700">Ngưỡng cảnh báo: ≤ <strong>{threshold}</strong></span>
          {appliedSearch && <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1">Từ khóa: “{appliedSearch}”</span>}
          {data.generated_at && <span>Cập nhật: {new Date(data.generated_at).toLocaleString('vi-VN')}</span>}
        </div>
        {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-1 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-bold text-gray-800">Chi tiết tồn kho</h2>
            <p className="text-xs text-gray-500">Hiển thị {rows.length.toLocaleString('vi-VN')} / {pagination.total.toLocaleString('vi-VN')} dòng phù hợp.</p>
          </div>
          <div className="text-xs font-semibold text-gray-500">Trang {pagination.page}/{Math.max(1, pagination.total_pages)}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Mã / SKU</th>
                <th className="px-4 py-3 text-left">Tên sản phẩm</th>
                <th className="px-4 py-3 text-left">Kho / danh mục</th>
                <th className="px-4 py-3 text-right">Tồn kho</th>
                <th className="px-4 py-3 text-right">Giá vốn</th>
                <th className="px-4 py-3 text-right">Giá trị tồn</th>
                <th className="px-4 py-3 text-center">Cảnh báo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.id || row.product_id || index}-${row.sku || ''}`} className={`border-t border-gray-100 align-top ${row.status === 'negative' ? 'bg-rose-50/70 hover:bg-rose-100/70' : row.status === 'out' ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-gray-50'}`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-800">{row.product_code || row.code || '—'}</div>
                    <div className="mt-0.5 text-xs text-gray-400">SKU: {row.sku || row.product_sku || '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-gray-900">{row.product_name || row.name || 'Sản phẩm'}</div>
                    {row.is_variant && <div className="mt-0.5 text-xs text-blue-600">Biến thể của: {row.parent_name || 'Sản phẩm cha'}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <div>{row.warehouse_name || row.warehouse || 'Kho mặc định'}</div>
                    <div className="mt-0.5 text-xs text-gray-400">{row.category_name || row.category || 'Chưa phân loại'}</div>
                  </td>
                  <td className={`px-4 py-3 text-right text-base font-extrabold ${Number(row.stock) < 0 ? 'text-rose-700' : Number(row.stock) === 0 ? 'text-red-600' : Number(row.stock) <= threshold ? 'text-amber-700' : 'text-emerald-700'}`}>{formatNumber(row.stock)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{formatVND(row.cost_price ?? row.import_price)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${Number(row.inventory_value) < 0 ? 'text-rose-700' : 'text-gray-900'}`}>{formatVND(row.inventory_value)}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={row.status || row.stock_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 border-t border-gray-100 py-14 text-gray-500"><Loader2 size={30} className="animate-spin text-orange-500" /><span className="font-semibold">Đang tải báo cáo tồn kho...</span></div>
        ) : rows.length === 0 ? (
          <div className="border-t border-gray-100 px-4 py-14 text-center text-gray-400">
            <div className="mb-2 text-4xl opacity-30">📦</div>
            <div className="font-semibold text-gray-500">Không có sản phẩm phù hợp</div>
            <div className="mt-1 text-sm">Hãy đổi từ khóa, trạng thái hoặc ngưỡng cảnh báo.</div>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-gray-100 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-gray-500">Tổng <strong className="text-gray-700">{pagination.total.toLocaleString('vi-VN')}</strong> dòng</div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={loading || !pagination.has_prev} onClick={() => setPage(current => Math.max(1, current - 1))} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={16} /> Trước</button>
            <span className="min-w-20 text-center text-sm font-bold text-gray-700">{pagination.page}/{Math.max(1, pagination.total_pages)}</span>
            <button type="button" disabled={loading || !pagination.has_next} onClick={() => setPage(current => current + 1)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40">Sau <ChevronRight size={16} /></button>
          </div>
        </div>
      </section>
    </div>
  );
}
