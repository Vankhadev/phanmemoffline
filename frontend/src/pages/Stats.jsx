import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronDown, ChevronRight, DollarSign, FileDown, HelpCircle, Package, TrendingUp } from 'lucide-react';
import HelpModal from '../components/HelpModal';
import { resolveApiUrl } from '../utils/apiClient';
import { globalSyncEmitter } from '../utils/eventEmitter';

const API = resolveApiUrl('');

function getLocalDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getPeriodRange(period) {
  const now = new Date();
  const today = getLocalDateKey(now);
  if (period === 'day') return { from: today, to: today };
  if (period === 'week') {
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 7);
    return { from: getLocalDateKey(fromDate), to: today };
  }
  if (period === 'month') {
    return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: today };
  }
  return { from: `${now.getFullYear()}-01-01`, to: today };
}

function toNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(toNumber(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(toNumber(value));
}

function formatDateLong(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey || '';
  return date.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDateShort(dateKey) {
  return String(dateKey || '').slice(5) || dateKey || '';
}

function escapeCsv(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildProfitGroups(report = {}) {
  const groups = new Map();
  const ensureGroup = (date) => {
    const key = date || '';
    if (!groups.has(key)) {
      groups.set(key, {
        date: key,
        orders: [],
        productRows: [],
        revenueBeforeTax: 0,
        costAmount: 0,
        estimatedProfit: 0,
      });
    }
    return groups.get(key);
  };

  (report.orders || []).forEach(order => {
    const group = ensureGroup(order.date);
    const normalizedOrder = {
      ...order,
      revenueBeforeTax: toNumber(order.revenueBeforeTax),
      costAmount: toNumber(order.costAmount),
      estimatedProfit: toNumber(order.estimatedProfit),
      products: Array.isArray(order.products) ? order.products : [],
    };
    group.orders.push(normalizedOrder);
    group.revenueBeforeTax += normalizedOrder.revenueBeforeTax;
    group.costAmount += normalizedOrder.costAmount;
    group.estimatedProfit += normalizedOrder.estimatedProfit;
  });

  (report.rows || []).forEach(row => {
    const group = ensureGroup(row.date);
    group.productRows.push({
      ...row,
      quantitySold: toNumber(row.quantitySold),
      revenueBeforeTax: toNumber(row.revenueBeforeTax),
      costAmount: toNumber(row.costAmount),
      estimatedProfit: toNumber(row.estimatedProfit),
    });
  });

  return groups;
}

export default function Stats() {
  const [summary, setSummary] = useState({ today: {}, month: {}, allTime: {} });
  const [dailyStats, setDailyStats] = useState([]);
  const [profitReport, setProfitReport] = useState(null);
  const [expandedDates, setExpandedDates] = useState({});
  const [period, setPeriod] = useState('month');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [monthExport, setMonthExport] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [showHelp, setShowHelp] = useState(false);

  const periodRange = useMemo(() => getPeriodRange(period), [period]);

  const profitGroups = useMemo(() => buildProfitGroups(profitReport || {}), [profitReport]);

  const chartData = useMemo(() => (
    dailyStats
      .slice()
      .sort((left, right) => String(left.stat_date || '').localeCompare(String(right.stat_date || '')))
  ), [dailyStats]);

  const dailyRows = useMemo(() => chartData.map(day => {
    const group = profitGroups.get(day.stat_date) || null;
    return {
      ...day,
      total_revenue: toNumber(day.total_revenue),
      total_orders: toNumber(day.total_orders),
      costAmount: group ? group.costAmount : 0,
      estimatedProfit: group ? group.estimatedProfit : 0,
      orders: group?.orders || [],
      productRows: group?.productRows || [],
    };
  }), [chartData, profitGroups]);

  const periodTotals = useMemo(() => dailyRows.reduce((acc, row) => {
    acc.orders += toNumber(row.total_orders);
    acc.revenue += toNumber(row.total_revenue);
    acc.cost += toNumber(row.costAmount);
    acc.profit += toNumber(row.estimatedProfit);
    return acc;
  }, { orders: 0, revenue: 0, cost: 0, profit: 0 }), [dailyRows]);

  const maxRevenue = Math.max(...chartData.map(d => toNumber(d.total_revenue)), 1);

  const fetchSummary = useCallback(async () => {
    const response = await fetch(`${API}/stats/summary`);
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Kh?ng th? t?i th?ng k? t?ng quan.');
    setSummary(data);
  }, []);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        from: periodRange.from,
        to: periodRange.to,
        period: 'custom',
        status: 'completed',
      });
      const [statsResponse, profitResponse] = await Promise.all([
        fetch(`${API}/stats?from=${periodRange.from}&to=${periodRange.to}`),
        fetch(`${API}/stats/product-report?${params.toString()}`),
      ]);
      const statsData = await statsResponse.json();
      const profitData = await profitResponse.json();
      if (!statsResponse.ok) throw new Error(statsData?.error || 'Kh?ng th? t?i b?o c?o doanh thu.');
      if (!profitResponse.ok) throw new Error(profitData?.error || 'Kh?ng th? t?i l?i nhu?n u?c t?nh.');

      const rows = Array.isArray(statsData) ? statsData : [];
      setDailyStats(rows);
      setProfitReport(profitData);
      setExpandedDates(() => {
        const next = {};
        if (period === 'day') {
          rows.forEach(row => {
            if (row.stat_date) next[row.stat_date] = true;
          });
        } else {
          const firstDateWithOrders = rows.find(row => toNumber(row.total_orders) > 0)?.stat_date || rows[0]?.stat_date;
          if (firstDateWithOrders) next[firstDateWithOrders] = true;
        }
        return next;
      });
    } catch (err) {
      setError(err?.message || 'Kh?ng th? t?i th?ng k?.');
      setDailyStats([]);
      setProfitReport(null);
    } finally {
      setLoading(false);
    }
  }, [period, periodRange.from, periodRange.to]);

  const refreshAll = useCallback(() => {
    fetchSummary().catch(() => {});
    fetchStats();
  }, [fetchStats, fetchSummary]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const handleSyncRefresh = () => {
      refreshAll();
      console.log('[SYNC] Stats refreshed');
    };

    const unsubCreated = globalSyncEmitter.on('ORDER_CREATED', handleSyncRefresh);
    const unsubUpdated = globalSyncEmitter.on('ORDER_UPDATED', handleSyncRefresh);
    const unsubDeleted = globalSyncEmitter.on('ORDER_DELETED', handleSyncRefresh);
    const unsubDebt = globalSyncEmitter.on('DEBT_UPDATED', handleSyncRefresh);
    const unsubProduct = globalSyncEmitter.on('PRODUCT_UPDATED', handleSyncRefresh);

    return () => {
      unsubCreated();
      unsubUpdated();
      unsubDeleted();
      unsubDebt();
      unsubProduct();
    };
  }, [refreshAll]);

  const toggleDate = (date) => {
    setExpandedDates(prev => ({ ...prev, [date]: !prev[date] }));
  };

  const exportRows = (rows, fileName, title) => {
    if (rows.length === 0) {
      alert('Kh?ng c? d? li?u d? xu?t.');
      return;
    }

    let csv = '\uFEFF';
    csv += `${title}\n`;
    csv += 'Ng?y,S? don,Doanh thu,Gi? v?n u?c t?nh,L?i nhu?n u?c t?nh\n';
    rows.forEach(row => {
      csv += [
        formatDateLong(row.stat_date),
        row.total_orders || 0,
        Math.round(row.total_revenue || 0),
        Math.round(row.costAmount || 0),
        Math.round(row.estimatedProfit || 0),
      ].map(escapeCsv).join(',') + '\n';
    });
    const total = rows.reduce((acc, row) => {
      acc.orders += toNumber(row.total_orders);
      acc.revenue += toNumber(row.total_revenue);
      acc.cost += toNumber(row.costAmount);
      acc.profit += toNumber(row.estimatedProfit);
      return acc;
    }, { orders: 0, revenue: 0, cost: 0, profit: 0 });
    csv += ['T?ng c?ng', total.orders, Math.round(total.revenue), Math.round(total.cost), Math.round(total.profit)].map(escapeCsv).join(',') + '\n';
    csv += `Ng?y xu?t,${escapeCsv(new Date().toLocaleString('vi-VN'))}\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportMonthlyReport = () => {
    const [year, month] = monthExport.split('-');
    const rows = dailyRows.filter(row => {
      const [rowYear, rowMonth] = String(row.stat_date || '').split('-');
      return rowYear === year && rowMonth === month;
    });
    exportRows(rows, `BaoCaoDoanhThu_LoiNhuan_${month}_${year}.csv`, `B?O C?O DOANH THU L?I NHU?N TH?NG ${month}/${year}`);
  };

  const exportCurrentRangeReport = () => {
    exportRows(dailyRows, `BaoCaoDoanhThu_LoiNhuan_${periodRange.from}_${periodRange.to}.csv`, `B?O C?O DOANH THU L?I NHU?N ${periodRange.from} - ${periodRange.to}`);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <TrendingUp className="text-green-600" size={24} /> Th?ng k? Doanh thu
        </h1>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowHelp(true)} className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700 hover:bg-green-100">
            <HelpCircle size={16} /> Hu?ng d?n
          </button>
          <div className="flex gap-2">
            {[['day', 'H?m nay'], ['week', 'Tu?n'], ['month', 'Th?ng'], ['year', 'Nam']].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                className={`rounded px-4 py-2 text-sm font-medium transition ${period === key ? 'btn-primary' : 'bg-gray-200 text-gray-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="card border-t-4 border-blue-500 text-center">
          <div className="mb-1 flex items-center justify-center gap-2 text-xs text-gray-500">
            <Calendar size={14} /> H?M NAY
          </div>
          <div className="text-2xl font-bold text-blue-600">{formatVND(summary.today?.total_revenue)}</div>
          <div className="mt-1 text-xs text-gray-400">{summary.today?.total_orders || 0} don</div>
        </div>
        <div className="card border-t-4 border-green-500 text-center">
          <div className="mb-1 flex items-center justify-center gap-2 text-xs text-gray-500">
            <Calendar size={14} /> TH?NG N?Y
          </div>
          <div className="text-2xl font-bold text-green-600">{formatVND(summary.month?.revenue)}</div>
          <div className="mt-1 text-xs text-gray-400">{summary.month?.orders || 0} don</div>
        </div>
        <div className="card border-t-4 border-purple-500 text-center">
          <div className="mb-1 flex items-center justify-center gap-2 text-xs text-gray-500">
            <TrendingUp size={14} /> T?NG QUAN
          </div>
          <div className="text-2xl font-bold text-purple-600">{formatVND(summary.allTime?.revenue)}</div>
          <div className="mt-1 text-xs text-gray-400">{summary.allTime?.orders || 0} don</div>
        </div>
        <div className="card border-t-4 border-emerald-500 text-center">
          <div className="mb-1 flex items-center justify-center gap-2 text-xs text-gray-500">
            <DollarSign size={14} /> L?I NHU?N U?C T?NH
          </div>
          <div className="text-2xl font-bold text-emerald-600">{formatVND(periodTotals.profit)}</div>
          <div className="mt-1 text-xs text-gray-400">{periodRange.from} - {periodRange.to}</div>
        </div>
      </div>

      <div className="card mb-4 border border-green-200 bg-gradient-to-r from-green-50 to-blue-50">
        <h3 className="mb-3 flex items-center gap-2 font-bold">
          <FileDown className="text-green-600" size={18} /> Xu?t b?o c?o Excel
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Ch?n th?ng</label>
            <input type="month" className="input-field" value={monthExport} onChange={event => setMonthExport(event.target.value)} />
          </div>
          <button type="button" onClick={exportMonthlyReport} className="btn-success flex items-center gap-1">
            <FileDown size={16} /> Xu?t Excel th?ng
          </button>
          <button type="button" onClick={exportCurrentRangeReport} className="flex items-center gap-1 rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-700">
            <FileDown size={16} /> tổng lợi nhận
          </button>
        </div>
      </div>

      {showHelp && (
        <HelpModal
          show={showHelp}
          onClose={() => setShowHelp(false)}
          title="Hu?ng d?n th?ng k? doanh thu"
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">C?ch d?c m?n h?nh</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Ch?n m?c th?i gian theo ng?y, tu?n, th?ng ho?c nam.</li>
                  <li>Xem c?c th? t?ng quan d? ki?m tra doanh thu v? l?i nhu?n.</li>
                  <li>D?ng n?t xu?t Excel d? t?i b?o c?o chi ti?t.</li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-gray-800 mb-2">Luu ?</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>B?o c?o t? l?m m?i khi d? li?u don h?ng thay d?i.</li>
                  <li>C? th? m? r?ng t?ng ng?y d? xem chi ti?t don h?ng.</li>
                </ul>
              </div>
            </div>
          }
        />
      )}

      {chartData.length > 0 && (
        <div className="card mb-4">
          <h3 className="mb-4 flex items-center gap-2 font-bold">
            <TrendingUp className="text-blue-600" size={18} /> Bi?u d? doanh thu
          </h3>
          <div className="flex h-48 items-end gap-1">
            {chartData.map((day, index) => (
              <div key={`${day.stat_date}-${index}`} className="group flex flex-1 flex-col items-center">
                <div className="relative w-full rounded-t bg-blue-400 transition group-hover:bg-blue-600" style={{ height: `${Math.max(2, (toNumber(day.total_revenue) / maxRevenue) * 100)}%` }}>
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black px-1 text-xs text-white opacity-0 group-hover:opacity-100">
                    {formatVND(day.total_revenue)}
                  </div>
                </div>
                <div className="mt-1 text-xs text-gray-400">{formatDateShort(day.stat_date)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="mb-4 flex items-center gap-2 font-bold">
          <Package className="text-gray-600" size={18} /> B?o c?o chi ti?t l?i nhu?n
        </h3>
        {error && <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {loading ? (
          <div className="py-8 text-center text-gray-400">?ang t?i...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-gray-600">
                  <th className="p-2 text-left">Ng?y</th>
                  <th className="p-2 text-right">S? don</th>
                  <th className="p-2 text-right">Doanh thu</th>
                  <th className="p-2 text-right">Gi? v?n u?c t?nh</th>
                  <th className="p-2 text-right">L?i nhu?n u?c t?nh</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((row, index) => {
                  const expanded = expandedDates[row.stat_date] === true;
                  return (
                    <FragmentRow
                      key={`${row.stat_date}-${index}`}
                      row={row}
                      expanded={expanded}
                      onToggle={() => toggleDate(row.stat_date)}
                    />
                  );
                })}
                {dailyRows.length === 0 && (
                  <tr><td colSpan={5} className="py-10 text-center text-gray-400">Chua c? d? li?u</td></tr>
                )}
                {dailyRows.length > 0 && (
                  <tr className="bg-emerald-50 font-bold text-emerald-700">
                    <td className="p-2">T?ng kho?ng dang xem</td>
                    <td className="p-2 text-right">{formatNumber(periodTotals.orders)}</td>
                    <td className="p-2 text-right">{formatVND(periodTotals.revenue)}</td>
                    <td className="p-2 text-right">{formatVND(periodTotals.cost)}</td>
                    <td className="p-2 text-right">{formatVND(periodTotals.profit)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FragmentRow({ row, expanded, onToggle }) {
  return (
    <>
      <tr className="border-b hover:bg-gray-50">
        <td className="p-2">
          <button type="button" onClick={onToggle} className="flex items-center gap-2 text-left font-medium text-gray-800">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {formatDateLong(row.stat_date)}
          </button>
        </td>
        <td className="p-2 text-right">{formatNumber(row.total_orders || 0)}</td>
        <td className="p-2 text-right font-semibold text-blue-600">{formatVND(row.total_revenue)}</td>
        <td className="p-2 text-right text-gray-600">{formatVND(row.costAmount)}</td>
        <td className="p-2 text-right font-bold text-green-600">{formatVND(row.estimatedProfit)}</td>
      </tr>
      {expanded && (
        <tr className="border-b bg-slate-50">
          <td colSpan={5} className="p-3">
            {row.orders.length === 0 ? (
              <div className="text-sm text-gray-500">Chua c? chi ti?t don h?ng cho ng?y n?y.</div>
            ) : (
              <div className="space-y-3">
                <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-gray-500">
                        <th className="px-3 py-2 text-left">M? don</th>
                        <th className="px-3 py-2 text-right">Doanh thu</th>
                        <th className="px-3 py-2 text-right">Gi? v?n</th>
                        <th className="px-3 py-2 text-right">L?i nhu?n</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.orders.map(order => (
                        <tr key={`${order.invoiceId}-${order.invoiceCode}`} className="border-t border-slate-100">
                          <td className="px-3 py-2 font-bold text-gray-800">{order.invoiceCode}</td>
                          <td className="px-3 py-2 text-right font-semibold text-blue-600">{formatVND(order.revenueBeforeTax)}</td>
                          <td className="px-3 py-2 text-right text-gray-600">{formatVND(order.costAmount)}</td>
                          <td className="px-3 py-2 text-right font-bold text-green-600">{formatVND(order.estimatedProfit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap justify-end gap-4 border-t border-slate-200 pt-2 text-sm font-bold text-emerald-700">
                  <span>T?ng {formatNumber(row.orders.length)} don</span>
                  <span>L?i nhu?n ng?y: {formatVND(row.estimatedProfit)}</span>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
