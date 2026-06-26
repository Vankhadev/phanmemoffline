import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  CalendarDays,
  FileCheck2,
  HelpCircle,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { accountingApi, getApiErrorMessage, SYNC_UPDATED_EVENT } from '../utils/apiClient';
import HelpModal from '../components/HelpModal';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toDateInput(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getDefaultRange() {
  const today = new Date();
  return {
    period: 'month',
    month: `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`,
    from: toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: toDateInput(today),
  };
}

function getMonthRange(month) {
  const match = String(month || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  if (monthIndex < 1 || monthIndex > 12) return null;
  const lastDay = new Date(year, monthIndex, 0).getDate();
  return {
    from: `${year}-${pad2(monthIndex)}-01`,
    to: `${year}-${pad2(monthIndex)}-${pad2(lastDay)}`,
  };
}

function resolveRange(filters) {
  if (filters.period === 'month') {
    const range = getMonthRange(filters.month);
    return range ? { valid: true, ...range } : { valid: false, message: 'Vui lòng chọn th?ng hợp lệ.' };
  }
  if (!filters.from || !filters.to) return { valid: false, message: 'Vui lòng chọn d? ngày bắt đầu v? ngày kết thúc.' };
  if (filters.from > filters.to) return { valid: false, message: 'Ngày bắt đầu không được l?n hon ngày kết thúc.' };
  return { valid: true, from: filters.from, to: filters.to };
}

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return '?';
  const match = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('vi-VN');
}

function extractError(error, fallback) {
  return getApiErrorMessage(error?.data || error, error?.message || fallback);
}

function SummaryCard({ icon: Icon, label, value, description, tone }) {
  const tones = {
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    red: 'border-red-200 bg-red-50 text-red-700',
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone] || tones.blue}`}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide opacity-80">
        <Icon size={16} /> {label}
      </div>
      <div className="mt-2 break-words text-xl font-extrabold sm:text-2xl">{formatVND(value)}</div>
      <div className="mt-1 text-xs opacity-75">{description}</div>
    </div>
  );
}

function SourceTable({ title, rows, type }) {
  const isInput = type === 'input';
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-1 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-bold text-gray-800">{title}</div>
        <div className="text-xs text-gray-500">{rows.length.toLocaleString('vi-VN')} ch?ng t?</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Ngày</th>
              <th className="px-4 py-3 text-left">S? hóa đơn / ch?ng t?</th>
              <th className="px-4 py-3 text-left">{isInput ? 'Nh? cung cấp' : 'Ngu?i mua'}</th>
              <th className="px-4 py-3 text-right">Gi? tr? ch?u thu?</th>
              <th className="px-4 py-3 text-right">Thu? GTGT</th>
              <th className="px-4 py-3 text-right">Tổng ti?n</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${type}-${row.source || ''}-${row.source_id || index}`} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-3">{formatDate(row.invoice_date || row.date)}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-gray-800">{row.invoice_no || row.source_code || '?'}</div>
                  <div className="mt-0.5 text-xs text-gray-400">{row.source || 'Dữ liệu kế toán'}</div>
                </td>
                <td className="px-4 py-3 text-gray-600">{isInput ? (row.supplier_name || '?') : (row.buyer_name || '?')}</td>
                <td className="px-4 py-3 text-right">{formatVND(row.taxable_amount)}</td>
                <td className={`px-4 py-3 text-right font-bold ${isInput ? 'text-blue-700' : 'text-amber-700'}`}>{formatVND(row.vat_amount)}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-800">{formatVND(row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <div className="px-4 py-12 text-center text-sm text-gray-400">Không có ch?ng t? trong k? đã chọn.</div>
      )}
    </div>
  );
}

export default function TaxReport() {
  const defaults = useMemo(() => getDefaultRange(), []);
  const [filters, setFilters] = useState(defaults);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const activeRange = useMemo(() => resolveRange(filters), [filters]);
  const inputRows = Array.isArray(report?.input_sources) ? report.input_sources : [];
  const outputRows = Array.isArray(report?.output_sources) ? report.output_sources : [];
  const payable = Number(report?.vat_payable) || 0;

  const loadReport = useCallback(async (nextFilters = filters) => {
    const range = resolveRange(nextFilters);
    if (!range.valid) {
      setError(range.message);
      return false;
    }
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const data = await accountingApi.taxReport({ from: range.from, to: range.to });
      setReport(data || null);
      setLastUpdated(new Date());
      return true;
    } catch (requestError) {
      setReport(null);
      setError(extractError(requestError, 'Không thử lại báo cáo thu? GTGT.'));
      return false;
    } finally {
      setLoading(false);
    }
  }, [filters]);

  async function generateSnapshot() {
    if (!activeRange.valid) {
      setError(activeRange.message);
      return;
    }
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      await accountingApi.generateTaxReport({ from: activeRange.from, to: activeRange.to });
      setNotice(`?? luu snapshot báo cáo thu? t? ${formatDate(activeRange.from)} d?n ${formatDate(activeRange.to)}.`);
      await loadReport(filters);
    } catch (requestError) {
      setError(extractError(requestError, 'Không th? tạo snapshot báo cáo thu? GTGT.'));
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    loadReport(defaults);
  }, [loadReport, defaults]);

  useEffect(() => {
    const handleSync = (event) => {
      const { changedTables } = event.detail || {};
      if (
        Array.isArray(changedTables) &&
        changedTables.some(t =>
          ['invoices', 'invoice_details', 'import_logs', 'import_details'].includes(t)
        )
      ) {
        loadReport();
      }
    };
    window.addEventListener(SYNC_UPDATED_EVENT, handleSync);
    return () => {
      window.removeEventListener(SYNC_UPDATED_EVENT, handleSync);
    };
  }, [loadReport]);

  return (
    <div className="min-w-0 space-y-4">
      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 text-white shadow-lg">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-3"><ShieldCheck size={26} className="text-blue-200" /></div>
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.22em] text-blue-200/80">Kế toán ? Thu? GTGT</div>
              <h1 className="mt-1 text-2xl font-bold">Báo cáo thu? GTGT</h1>
              <p className="mt-1 max-w-3xl text-sm text-blue-100/75">Tổng hợp thu? d?u v?o, thu? d?u ra v? s? thu? ph?i n?p t? hóa đơn, phiếu nhập v? dữ liệu kế toán trong k?.</p>
            </div>
          </div>
          <button type="button" onClick={generateSnapshot} disabled={generating || loading || !activeRange.valid} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60">
            {generating ? <Loader2 size={17} className="animate-spin" /> : <FileCheck2 size={17} />}
            {generating ? 'đang luu...' : 'Luu snapshot k? n?y'}
          </button>
        </div>
      </section>

      {showHelp && (
        <HelpModal
          show={showHelp}
          onClose={() => setShowHelp(false)}
          title="Hướng dẫn báo cáo thu? GTGT"
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">Quy tr?nh sử dụng</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Chọn k? báo cáo theo th?ng ho?c kho?ng ngày.</li>
                  <li>Nhân Xem báo cáo d? n?p dữ liệu.</li>
                  <li>Dùng Luu snapshot k? n?y d? luu trạng thái báo cáo.</li>
                  <li>Kiểm tra b?ng d?u v?o v? d?u ra trước khi k?t xu?t.</li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-gray-800 mb-2">Luu ?</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Báo cáo d?a tr?n hóa đơn v? phiếu nhập trong hệ thống.</li>
                </ul>
              </div>
            </div>
          }
        />
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[170px_minmax(180px,1fr)_minmax(180px,1fr)_auto]">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">Loại k?</label>
            <select className="input-field" value={filters.period} onChange={event => setFilters(current => ({ ...current, period: event.target.value }))}>
              <option value="month">Theo th?ng</option>
              <option value="custom">Kho?ng ngày</option>
            </select>
          </div>
          {filters.period === 'month' ? (
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-gray-500">Tháng báo cáo</label>
              <input type="month" className="input-field" value={filters.month} onChange={event => setFilters(current => ({ ...current, month: event.target.value }))} />
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">T? ngày</label>
                <input type="date" className="input-field" value={filters.from} max={filters.to || undefined} onChange={event => setFilters(current => ({ ...current, from: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">??n ngày</label>
                <input type="date" className="input-field" value={filters.to} min={filters.from || undefined} onChange={event => setFilters(current => ({ ...current, to: event.target.value }))} />
              </div>
            </>
          )}
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => loadReport()} disabled={loading || !activeRange.valid} className="btn-primary min-h-11 flex-1 xl:flex-none">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Xem báo cáo
            </button>
            <button type="button" onClick={() => loadReport()} disabled={loading} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-50" title="Tải lỗi">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-blue-700"><CalendarDays size={13} /> {activeRange.valid ? `${formatDate(activeRange.from)} - ${formatDate(activeRange.to)}` : activeRange.message}</span>
          {lastUpdated && <span>Cập nhật: {lastUpdated.toLocaleString('vi-VN')}</span>}
        </div>
        {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}
        {notice && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</div>}
      </section>

      {loading && !report ? (
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border border-gray-200 bg-white text-gray-500">
          <Loader2 size={32} className="animate-spin text-blue-500" />
          <span className="font-semibold">đang l?p báo cáo thu? GTGT...</span>
        </div>
      ) : report ? (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard icon={TrendingDown} label="Thu? GTGT d?u v?o" value={report.total_input_vat} description={`${inputRows.length} ch?ng t? d?u v?o`} tone="blue" />
            <SummaryCard icon={TrendingUp} label="Thu? GTGT d?u ra" value={report.total_output_vat} description={`${outputRows.length} ch?ng t? d?u ra`} tone="amber" />
            <SummaryCard icon={ShieldCheck} label={payable >= 0 ? 'Thu? ph?i n?p' : 'Thu? c?n được kh?u tr?'} value={Math.abs(payable)} description="Thu? d?u ra tr? thu? d?u v?o" tone={payable >= 0 ? 'red' : 'emerald'} />
            <SummaryCard icon={FileCheck2} label="Doanh thu ch?u thu?" value={report.output_taxable_amount} description={`??u v?o ch?u thu?: ${formatVND(report.input_taxable_amount)}`} tone="emerald" />
          </section>
          <SourceTable title="Chi tiết thu? GTGT d?u ra" rows={outputRows} type="output" />
          <SourceTable title="Chi tiết thu? GTGT d?u v?o" rows={inputRows} type="input" />
        </>
      ) : !error ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-16 text-center text-gray-400">Chọn k? v? nhân ?Xem báo cáo? đã tải dữ liệu.</div>
      ) : null}
    </div>
  );
}
