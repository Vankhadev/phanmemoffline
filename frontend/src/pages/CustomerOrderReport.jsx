import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { resolveApiUrl } from '../utils/apiClient';
import { Calendar, Download, FileText, Loader, RefreshCw, Search, Users } from 'lucide-react';

const API = resolveApiUrl('');

const STATUS_LABELS = {
  pending: 'Chờ xác nhận',
  processing: 'Đang xử lý',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
};

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toDateInputValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getDefaultRange() {
  const now = new Date();
  return {
    from: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDateInputValue(now),
  };
}

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value) || 0);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateOnly(value) {
  if (!value) return '';
  const [year, month, day] = String(value).split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || '—';
}

function safeSheetName(name) {
  const normalized = String(name || 'Bao cao').replace(/[\\/?*\[\]:]/g, ' ').trim();
  return (normalized || 'Bao cao').slice(0, 31);
}

export default function CustomerOrderReport() {
  const defaultRange = useMemo(() => getDefaultRange(), []);
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadCustomers = async () => {
      setLoadingCustomers(true);
      setError('');
      try {
        const res = await fetch(`${API}/customers`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Không tải được danh sách khách hàng');
        setCustomers(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err.message || 'Không tải được danh sách khách hàng');
      } finally {
        setLoadingCustomers(false);
      }
    };

    loadCustomers();
  }, []);

  const selectedCustomer = customers.find(customer => Number(customer.id) === Number(customerId));
  const invoices = report?.invoices || [];
  const summary = report?.summary || { total_invoices: 0, total_amount: 0 };

  const canViewReport = customerId && from && to && !loadingReport;
  const canExport = invoices.length > 0 && !loadingReport;

  const fetchReport = async () => {
    if (!customerId) {
      setError('Vui lòng chọn khách hàng để xem báo cáo.');
      return;
    }
    if (!from || !to) {
      setError('Vui lòng chọn đầy đủ ngày bắt đầu và ngày kết thúc.');
      return;
    }
    if (from > to) {
      setError('Ngày bắt đầu không được lớn hơn ngày kết thúc.');
      return;
    }

    setLoadingReport(true);
    setError('');
    try {
      const params = new URLSearchParams({ customer_id: customerId, from, to });
      const res = await fetch(`${API}/invoices/reports/customer-orders?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không lập được báo cáo');
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err.message || 'Không lập được báo cáo');
    } finally {
      setLoadingReport(false);
    }
  };

  const exportExcel = () => {
    if (!canExport) return;

    const customerName = report?.customer?.name || selectedCustomer?.name || 'Khach hang';
    const rows = invoices.map((invoice, index) => ({
      STT: index + 1,
      'Mã hóa đơn': invoice.invoice_code || '',
      'Ngày bán': formatDateTime(invoice.created_at),
      'Tên khách hàng': invoice.customer_name || customerName,
      'Tóm tắt sản phẩm': invoice.items_summary || '',
      'Tổng tiền': Number(invoice.total) || 0,
      'Trạng thái': statusLabel(invoice.status),
      'Thanh toán': invoice.payment_method || '',
      'Ghi chú': invoice.note || '',
    }));

    rows.push({
      STT: '',
      'Mã hóa đơn': 'TỔNG CỘNG',
      'Ngày bán': '',
      'Tên khách hàng': `Tổng số đơn: ${summary.total_invoices || invoices.length}`,
      'Tóm tắt sản phẩm': '',
      'Tổng tiền': Number(summary.total_amount) || 0,
      'Trạng thái': '',
      'Thanh toán': '',
      'Ghi chú': '',
    });

    const summaryRows = [
      { 'Chỉ tiêu': 'Khách hàng', 'Giá trị': customerName },
      { 'Chỉ tiêu': 'Từ ngày', 'Giá trị': formatDateOnly(report?.filters?.from || from) },
      { 'Chỉ tiêu': 'Đến ngày', 'Giá trị': formatDateOnly(report?.filters?.to || to) },
      { 'Chỉ tiêu': 'Tổng số hóa đơn', 'Giá trị': summary.total_invoices || invoices.length },
      { 'Chỉ tiêu': 'Tổng tiền', 'Giá trị': Number(summary.total_amount) || 0 },
      { 'Chỉ tiêu': 'Xuất lúc', 'Giá trị': new Date().toLocaleString('vi-VN') },
    ];

    const workbook = XLSX.utils.book_new();
    const orderSheet = XLSX.utils.json_to_sheet(rows);
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    orderSheet['!cols'] = [
      { wch: 6 },
      { wch: 16 },
      { wch: 20 },
      { wch: 28 },
      { wch: 50 },
      { wch: 16 },
      { wch: 16 },
      { wch: 14 },
      { wch: 24 },
    ];
    summarySheet['!cols'] = [{ wch: 24 }, { wch: 32 }];

    XLSX.utils.book_append_sheet(workbook, orderSheet, safeSheetName('Danh sach don hang'));
    XLSX.utils.book_append_sheet(workbook, summarySheet, safeSheetName('Tong hop'));
    XLSX.writeFile(workbook, `BaoCaoDonHang_${customerName}_${from}_den_${to}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-blue-900 via-slate-900 to-purple-900 px-5 py-5 text-white">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-11 w-11 rounded-2xl bg-white/10 flex items-center justify-center border border-white/10">
                  <FileText size={22} className="text-blue-200" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.25em] text-blue-200/80">Customer Orders Report</div>
                  <h1 className="text-2xl font-bold">Báo cáo đơn hàng theo khách hàng</h1>
                </div>
              </div>
              <p className="text-sm text-blue-100/80 max-w-3xl">
                Chọn khách hàng và khoảng ngày để xem đầy đủ hóa đơn bán hàng trong kỳ. Khoảng ngày được tính từ 00:00 ngày bắt đầu đến 23:59:59 ngày kết thúc theo ngày local.
              </p>
            </div>

            <button
              onClick={exportExcel}
              disabled={!canExport}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/60"
            >
              <Download size={16} /> Xuất Excel
            </button>
          </div>
        </div>

        <div className="p-5 bg-gray-50 border-t border-white/10">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(240px,1fr)_180px_180px_auto]">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Khách hàng</label>
              <div className="relative">
                <Users size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <select
                  className="input-field w-full pl-9"
                  value={customerId}
                  onChange={e => setCustomerId(e.target.value)}
                  disabled={loadingCustomers}
                >
                  <option value="">-- Chọn khách hàng --</option>
                  {customers.map(customer => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}{customer.phone ? ` (${customer.phone})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Từ ngày</label>
              <div className="relative">
                <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="date" className="input-field w-full pl-9" value={from} onChange={e => setFrom(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Đến ngày</label>
              <div className="relative">
                <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="date" className="input-field w-full pl-9" value={to} onChange={e => setTo(e.target.value)} />
              </div>
            </div>

            <div className="flex items-end gap-2">
              <button
                onClick={fetchReport}
                disabled={!canViewReport}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 xl:w-auto"
              >
                {loadingReport ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
                Xem báo cáo
              </button>
              <button
                onClick={() => {
                  setReport(null);
                  setError('');
                  setFrom(defaultRange.from);
                  setTo(defaultRange.to);
                }}
                className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-gray-500 hover:bg-gray-100"
                title="Đặt lại bộ lọc"
              >
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          {loadingCustomers && (
            <div className="mt-3 text-sm text-gray-400">Đang tải danh sách khách hàng...</div>
          )}
          {error && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>
      </div>

      {report && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-blue-700">
            <div className="text-xs font-medium opacity-80">Khách hàng</div>
            <div className="mt-1 text-lg font-bold">{report.customer?.name || selectedCustomer?.name || '—'}</div>
            <div className="mt-1 text-xs opacity-80">{report.customer?.phone || selectedCustomer?.phone || 'Chưa có số điện thoại'}</div>
          </div>
          <div className="rounded-2xl border border-purple-100 bg-purple-50 px-4 py-3 text-purple-700">
            <div className="text-xs font-medium opacity-80">Tổng số hóa đơn</div>
            <div className="mt-1 text-2xl font-bold">{summary.total_invoices || 0}</div>
            <div className="mt-1 text-xs opacity-80">Từ {formatDateOnly(report.filters?.from)} đến {formatDateOnly(report.filters?.to)}</div>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-emerald-700">
            <div className="text-xs font-medium opacity-80">Tổng tiền trong kỳ</div>
            <div className="mt-1 text-2xl font-bold">{formatVND(summary.total_amount)}</div>
            <div className="mt-1 text-xs opacity-80">Không tính hóa đơn đã hủy theo mặc định</div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-gray-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-bold text-gray-800">Danh sách hóa đơn</h2>
            <p className="text-sm text-gray-500">Hiển thị từng đơn, tóm tắt sản phẩm, tổng tiền và trạng thái.</p>
          </div>
          {report && (
            <div className="text-sm font-medium text-gray-600">
              {summary.total_invoices || 0} hóa đơn · {formatVND(summary.total_amount)}
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 text-left">Mã đơn/hóa đơn</th>
                <th className="px-4 py-3 text-left">Ngày bán</th>
                <th className="px-4 py-3 text-left">Tên khách hàng</th>
                <th className="px-4 py-3 text-left"> sản phẩm</th>
                <th className="px-4 py-3 text-right">Tổng tiền</th>
                <th className="px-4 py-3 text-left">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(invoice => (
                <tr key={invoice.id || invoice.invoice_code} className="border-t border-gray-100 align-top hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-blue-700">{invoice.invoice_code || '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{formatDateTime(invoice.created_at)}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{invoice.customer_name || report.customer?.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {invoice.items_summary ? (
                      <span>{invoice.items_summary}</span>
                    ) : (
                      <span className="text-gray-400">Không có dữ liệu sản phẩm</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">{formatVND(invoice.total)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                      {statusLabel(invoice.status)}
                    </span>
                  </td>
                </tr>
              ))}
              {invoices.length > 0 && (
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                  <td className="px-4 py-3" colSpan={3}>Tổng cộng</td>
                  <td className="px-4 py-3 text-gray-600">Tổng số hóa đơn: {summary.total_invoices || invoices.length}</td>
                  <td className="px-4 py-3 text-right text-blue-700">{formatVND(summary.total_amount)}</td>
                  <td className="px-4 py-3"></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loadingReport ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-400">
            <Loader size={32} className="animate-spin text-blue-400" />
            <div className="font-medium text-gray-600">Đang lập báo cáo...</div>
          </div>
        ) : report && invoices.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mb-3 text-5xl opacity-20">🧾</div>
            <div className="font-semibold text-gray-600">Không có hóa đơn trong khoảng thời gian đã chọn</div>
            <div className="mt-1 text-sm text-gray-400">Vui lòng kiểm tra lại khách hàng hoặc khoảng ngày.</div>
          </div>
        ) : !report ? (
          <div className="py-16 text-center">
            <div className="mb-3 text-5xl opacity-20">📊</div>
            <div className="font-semibold text-gray-600">Chưa có dữ liệu báo cáo</div>
            <div className="mt-1 text-sm text-gray-400">Chọn khách hàng và khoảng ngày rồi nhấn “Xem báo cáo”.</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
