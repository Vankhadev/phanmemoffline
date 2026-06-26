import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileClock,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import { accountingApi, getApiErrorMessage, SYNC_UPDATED_EVENT } from '../utils/apiClient';
import HelpModal from '../components/HelpModal';

const PAGE_SIZE = 30;

function toDateInput(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getDefaultFilters() {
  const today = new Date();
  return {
    from: toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: toDateInput(today),
    action: '',
    search: '',
  };
}

function normalizeResponse(data = {}) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const pagination = data?.pagination || {};
  const total = Number(pagination.total ?? items.length) || 0;
  const limit = Number(pagination.limit ?? PAGE_SIZE) || PAGE_SIZE;
  const page = Number(pagination.page ?? 1) || 1;
  const totalPages = Number(pagination.total_pages ?? (total ? Math.ceil(total / limit) : 0)) || 0;
  return {
    items,
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

function formatDateTime(value) {
  if (!value) return '?';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function actionTone(action) {
  const normalized = String(action || '').toLowerCase();
  if (normalized.includes('delete') || normalized.includes('cancel') || normalized.includes('reverse')) return 'border-red-200 bg-red-50 text-red-700';
  if (normalized.includes('create') || normalized.includes('generate') || normalized.includes('completed')) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (normalized.includes('update') || normalized.includes('edit')) return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-gray-200 bg-gray-50 text-gray-700';
}

function DetailModal({ log, loading, error, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="accounting-log-detail-title">
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-gray-100 bg-white px-5 py-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-blue-600">Chi tiết nhật ký</div>
            <h2 id="accounting-log-detail-title" className="mt-1 text-lg font-bold text-gray-900">{log?.content || 'Nhật ký ho?t d?ng'}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700" aria-label="??ng"><X size={18} /></button>
        </div>
        <div className="space-y-4 p-5">
          {loading ? (
            <div className="flex min-h-44 items-center justify-center gap-2 text-gray-500"><Loader2 size={22} className="animate-spin" /> đang t?i chi tiết...</div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : log ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><div className="text-xs text-gray-500">Ngu?i thực hiện</div><div className="mt-1 font-bold text-gray-800">{log.user_name || `Ngu?i d?ng #${log.user_id || '?'}`}</div></div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><div className="text-xs text-gray-500">Thời gian</div><div className="mt-1 font-bold text-gray-800">{formatDateTime(log.created_at)}</div></div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><div className="text-xs text-gray-500">Action</div><div className="mt-1 break-all font-mono text-sm font-bold text-gray-800">{log.action || '?'}</div></div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3"><div className="text-xs text-gray-500">Entity</div><div className="mt-1 font-bold text-gray-800">{log.entity_type || '?'} {log.entity_code ? `? ${log.entity_code}` : ''}</div></div>
              </div>
              <div><div className="mb-1 text-sm font-bold text-gray-700">N?i dung</div><div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">{log.content || '?'}</div></div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div><div className="mb-1 text-sm font-bold text-gray-700">Dữ liệu tru?c</div><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-xs text-slate-200">{JSON.stringify(log.before, null, 2) || 'null'}</pre></div>
                <div><div className="mb-1 text-sm font-bold text-gray-700">Dữ liệu sau</div><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-3 text-xs text-slate-200">{JSON.stringify(log.after, null, 2) || 'null'}</pre></div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function AccountingLogs() {
  const defaults = useMemo(() => getDefaultFilters(), []);
  const [draft, setDraft] = useState(defaults);
  const [filters, setFilters] = useState(defaults);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(() => normalizeResponse());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedLog, setSelectedLog] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const actionOptions = useMemo(() => Array.from(new Set(data.items.map(row => row.action).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'vi')), [data.items]);
  const querySignature = useMemo(() => JSON.stringify({ ...filters, page }), [filters, page]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await accountingApi.logs({ ...filters, page, limit: PAGE_SIZE });
      setData(normalizeResponse(response));
    } catch (requestError) {
      setData(normalizeResponse());
      setError(getApiErrorMessage(requestError?.data || requestError, requestError?.message || 'Không thử lại nhật ký ho?t d?ng.'));
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  function applyFilters(event) {
    event?.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setError('Ngày bắt đầu không được l?n hon ngày kết thúc.');
      return;
    }
    setPage(1);
    setFilters({ ...draft, search: draft.search.trim() });
  }

  function resetFilters() {
    setDraft(defaults);
    setFilters(defaults);
    setPage(1);
  }

  async function openDetail(row) {
    setSelectedLog(row);
    setDetailLoading(true);
    setDetailError('');
    try {
      const response = await accountingApi.logDetail(row.id);
      setSelectedLog(response?.log || row);
    } catch (requestError) {
      setDetailError(getApiErrorMessage(requestError?.data || requestError, requestError?.message || 'Không thử lại chi tiết nhật ký.'));
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    const handleSync = () => {
      loadLogs();
    };
    window.addEventListener(SYNC_UPDATED_EVENT, handleSync);
    return () => {
      window.removeEventListener(SYNC_UPDATED_EVENT, handleSync);
    };
  }, [loadLogs]);

  return (
    <div className="min-w-0 space-y-4">
      <section className="overflow-hidden rounded-2xl border border-indigo-900 bg-gradient-to-r from-indigo-950 via-slate-900 to-purple-950 text-white shadow-lg">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-3"><FileClock size={27} className="text-indigo-200" /></div>
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-200/80">Kế toán ? Kiểm so?t</div>
              <h1 className="mt-1 text-2xl font-bold">Nhật ký ho?t d?ng</h1>
              <p className="mt-1 max-w-3xl text-sm text-indigo-100/75">Tra c?u ngu?i thực hiện, thời gian, hình dạng, dài tu?ng v? n?i dung thay đổi của nghi?p v? kế toán.</p>
            </div>
          </div>
          <button type="button" onClick={loadLogs} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/20 disabled:opacity-60"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /> L?m mới</button>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <form onSubmit={applyFilters} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[150px_150px_210px_minmax(240px,1fr)_auto]">
          <div><label className="mb-1 block text-xs font-semibold text-gray-500">T? ngày</label><input type="date" className="input-field" value={draft.from} max={draft.to || undefined} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} /></div>
          <div><label className="mb-1 block text-xs font-semibold text-gray-500">??n ngày</label><input type="date" className="input-field" value={draft.to} min={draft.from || undefined} onChange={event => setDraft(current => ({ ...current, to: event.target.value }))} /></div>
          <div><label className="mb-1 block text-xs font-semibold text-gray-500">Action</label><input list="accounting-log-actions" className="input-field" value={draft.action} onChange={event => setDraft(current => ({ ...current, action: event.target.value }))} placeholder="Tất cả action" /><datalist id="accounting-log-actions">{actionOptions.map(action => <option key={action} value={action} />)}</datalist></div>
          <div><label className="mb-1 block text-xs font-semibold text-gray-500">Tìm kiếm</label><div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input className="input-field pl-9" value={draft.search} onChange={event => setDraft(current => ({ ...current, search: event.target.value }))} placeholder="N?i dung, ngu?i thực hiện, entity, m?..." /></div></div>
          <div className="flex items-end gap-2"><button type="submit" disabled={loading} className="btn-primary min-h-11 flex-1 xl:flex-none"><Filter size={16} /> Lực</button><button type="button" onClick={resetFilters} disabled={loading} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50" title="??t lỗi"><RefreshCw size={16} /></button></div>
        </form>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-700"><CalendarDays size={13} /> {filters.from || 'T? d?u'} - {filters.to || 'Hiện tại'}</span>
          <span>{data.pagination.total.toLocaleString('vi-VN')} nhật ký</span>
          {data.generated_at && <span>Truy v?n l?c: {formatDateTime(data.generated_at)}</span>}
        </div>
        {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3 text-left">Thời gian</th><th className="px-4 py-3 text-left">Ngu?i thực hiện</th><th className="px-4 py-3 text-left">Action</th><th className="px-4 py-3 text-left">Entity</th><th className="px-4 py-3 text-left">N?i dung</th><th className="px-4 py-3 text-center">Chi tiết</th></tr></thead>
            <tbody>
              {data.items.map((row, index) => (
                <tr key={row.id || index} className="border-t border-gray-100 align-top hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-700">{formatDateTime(row.created_at)}</td>
                  <td className="px-4 py-3"><div className="flex items-center gap-2 font-semibold text-gray-800"><UserRound size={15} className="text-gray-400" /> {row.user_name || `User #${row.user_id || '?'}`}</div>{row.ip && <div className="mt-0.5 text-xs text-gray-400">IP: {row.ip}</div>}</td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 font-mono text-xs font-bold ${actionTone(row.action)}`}>{row.action || '?'}</span></td>
                  <td className="px-4 py-3"><div className="font-semibold text-gray-700">{row.entity_type || '?'}</div><div className="mt-0.5 text-xs text-gray-400">{row.entity_code || (row.entity_id ? `#${row.entity_id}` : '?')}</div></td>
                  <td className="max-w-md px-4 py-3 text-gray-600"><div className="line-clamp-3">{row.content || '?'}</div></td>
                  <td className="px-4 py-3 text-center"><button type="button" onClick={() => openDetail(row)} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100">Xem</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading ? <div className="flex min-h-44 items-center justify-center gap-2 border-t border-gray-100 text-gray-500"><Loader2 size={24} className="animate-spin text-indigo-500" /> đang t?i nhật ký...</div> : data.items.length === 0 ? <div className="border-t border-gray-100 px-4 py-14 text-center text-gray-400"><div className="mb-2 text-4xl opacity-30">??</div><div className="font-semibold text-gray-500">Không có nhật ký phù hợp</div></div> : null}
        <div className="flex flex-col gap-3 border-t border-gray-100 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="text-sm text-gray-500">Trang <strong>{data.pagination.page}</strong>/{Math.max(1, data.pagination.total_pages)}</div><div className="flex items-center gap-2"><button type="button" disabled={loading || !data.pagination.has_prev} onClick={() => setPage(current => Math.max(1, current - 1))} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-600 disabled:opacity-40"><ChevronLeft size={16} /> Trước</button><button type="button" disabled={loading || !data.pagination.has_next} onClick={() => setPage(current => current + 1)} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-600 disabled:opacity-40">Sau <ChevronRight size={16} /></button></div></div>
      </section>

      {selectedLog && <DetailModal log={selectedLog} loading={detailLoading} error={detailError} onClose={() => { setSelectedLog(null); setDetailError(''); }} />}
    </div>
  );
}
