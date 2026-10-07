import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  CalendarDays,
  FileCheck2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  FileDown,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { accountingApi, getApiErrorMessage, SYNC_UPDATED_EVENT } from '../utils/apiClient';
import HelpModal from '../components/HelpModal';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toDateInput(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getDefaultRange() {
  const now = new Date();
  const month = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  return {
    period: 'month',
    month,
    from: toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDateInput(now),
  };
}

function getMonthRange(monthValue) {
  if (!monthValue || !/^\d{4}-\d{2}$/.test(monthValue)) return null;
  const [yearStr, monthStr] = monthValue.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  return {
    from: toDateInput(firstDay),
    to: toDateInput(lastDay),
  };
}

function resolveRange(filters) {
  if (filters.period === 'month') {
    const range = getMonthRange(filters.month);
    return range ? { valid: true, ...range } : { valid: false, message: 'Vui lòng chọn tháng hợp lệ.' };
  }
  if (!filters.from || !filters.to) return { valid: false, message: 'Vui lòng chọn đủ ngày bắt đầu và ngày kết thúc.' };
  if (filters.from > filters.to) return { valid: false, message: 'Ngày bắt đầu không được lớn hơn ngày kết thúc.' };
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
  if (!value) return '-';
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
        <div className="text-xs text-gray-500">{rows.length.toLocaleString('vi-VN')} chứng từ</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Ngày</th>
              <th className="px-4 py-3 text-left">Số hóa đơn / chứng từ</th>
              <th className="px-4 py-3 text-left">{isInput ? 'Nhà cung cấp' : 'Người mua'}</th>
              <th className="px-4 py-3 text-right">Giá trị chịu thuế</th>
              <th className="px-4 py-3 text-right">Thuế GTGT</th>
              <th className="px-4 py-3 text-right">Tổng tiền</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${type}-${row.source || ''}-${row.source_id || index}`} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="whitespace-nowrap px-4 py-3">{formatDate(row.invoice_date || row.date)}</td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-gray-800">{row.invoice_no || row.source_code || '-'}</div>
                  <div className="mt-0.5 text-xs text-gray-400">{row.source || 'Dữ liệu kế toán'}</div>
                </td>
                <td className="px-4 py-3 text-gray-600">{isInput ? (row.supplier_name || '-') : (row.buyer_name || '-')}</td>
                <td className="px-4 py-3 text-right">{formatVND(row.taxable_amount)}</td>
                <td className={`px-4 py-3 text-right font-bold ${isInput ? 'text-blue-700' : 'text-amber-700'}`}>{formatVND(row.vat_amount)}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-800">{formatVND(row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <div className="px-4 py-12 text-center text-sm text-gray-400">Không có chứng từ trong kỳ đã chọn.</div>
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
      setError(extractError(requestError, 'Không thể tải báo cáo thuế GTGT.'));
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
      setNotice(`Đã lưu snapshot báo cáo thuế từ ${formatDate(activeRange.from)} đến ${formatDate(activeRange.to)}.`);
      await loadReport(filters);
    } catch (requestError) {
      setError(extractError(requestError, 'Không thể tạo snapshot báo cáo thuế GTGT.'));
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

  const [currentYearNumber, currentMonthNumber] = useMemo(() => {
    if (filters.month && /^\d{4}-\d{2}$/.test(filters.month)) {
      const parts = filters.month.split('-');
      return [parts[0], parts[1]];
    }
    const now = new Date();
    return [String(now.getFullYear()), pad2(now.getMonth() + 1)];
  }, [filters.month]);

  const handleExportExcel = () => {
    if (!report) {
      alert('Vui lòng tải hoặc xem báo cáo thuế GTGT trước khi xuất Excel!');
      return;
    }

    const workbook = XLSX.utils.book_new();

    // Sheet 1: Tổng hợp thuế GTGT
    const payableVal = Number(report.vat_payable) || 0;
    const summaryData = [
      { 'CHỈ TIÊU BÁO CÁO': 'Kỳ báo cáo', 'GIÁ TRỊ': `${formatDate(activeRange.from)} - ${formatDate(activeRange.to)}`, 'GHI CHÚ': '' },
      { 'CHỈ TIÊU BÁO CÁO': 'Thời điểm lập báo cáo', 'GIÁ TRỊ': new Date().toLocaleString('vi-VN'), 'GHI CHÚ': '' },
      { 'CHỈ TIÊU BÁO CÁO': '1. Tổng doanh thu bán ra chịu thuế', 'GIÁ TRỊ': Number(report.output_taxable_amount) || 0, 'GHI CHÚ': 'VNĐ' },
      { 'CHỈ TIÊU BÁO CÁO': '2. Tổng thuế GTGT bán ra (Đầu ra)', 'GIÁ TRỊ': Number(report.total_output_vat) || 0, 'GHI CHÚ': 'VNĐ' },
      { 'CHỈ TIÊU BÁO CÁO': '3. Tổng giá trị hàng hóa mua vào chịu thuế', 'GIÁ TRỊ': Number(report.input_taxable_amount) || 0, 'GHI CHÚ': 'VNĐ' },
      { 'CHỈ TIÊU BÁO CÁO': '4. Tổng thuế GTGT mua vào (Đầu vào được khấu trừ)', 'GIÁ TRỊ': Number(report.total_input_vat) || 0, 'GHI CHÚ': 'VNĐ' },
      { 'CHỈ TIÊU BÁO CÁO': payableVal >= 0 ? '5. Số thuế GTGT phải nộp kỳ này' : '5. Số thuế GTGT còn được khấu trừ chuyển kỳ sau', 'GIÁ TRỊ': Math.abs(payableVal), 'GHI CHÚ': payableVal >= 0 ? 'Nộp ngân sách' : 'Còn khấu trừ' },
      { 'CHỈ TIÊU BÁO CÁO': 'Tổng số chứng từ bán ra (Đầu ra)', 'GIÁ TRỊ': outputRows.length, 'GHI CHÚ': 'Hóa đơn / đơn hàng' },
      { 'CHỈ TIÊU BÁO CÁO': 'Tổng số chứng từ mua vào (Đầu vào)', 'GIÁ TRỊ': inputRows.length, 'GHI CHÚ': 'Hóa đơn / phiếu nhập' },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 48 }, { wch: 25 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(workbook, wsSummary, 'Tổng hợp thuế GTGT');

    // Sheet 2: Bảng kê bán ra (Đầu ra)
    const outData = outputRows.map((row, idx) => ({
      'STT': idx + 1,
      'Ngày chứng từ': formatDate(row.invoice_date || row.date),
      'Số hóa đơn / Mã chứng từ': row.invoice_no || row.source_code || '',
      'Khách hàng / Người mua': row.buyer_name || 'Khách lẻ',
      'Nguồn phát sinh': row.source || 'Hóa đơn bán hàng',
      'Doanh thu chịu thuế (VNĐ)': Number(row.taxable_amount) || 0,
      'Thuế GTGT đầu ra (VNĐ)': Number(row.vat_amount) || 0,
      'Tổng thanh toán (VNĐ)': Number(row.total) || 0,
    }));
    if (outData.length > 0) {
      outData.push({
        'STT': '',
        'Ngày chứng từ': '',
        'Số hóa đơn / Mã chứng từ': '',
        'Khách hàng / Người mua': 'TỔNG CỘNG',
        'Nguồn phát sinh': '',
        'Doanh thu chịu thuế (VNĐ)': Number(report.output_taxable_amount) || 0,
        'Thuế GTGT đầu ra (VNĐ)': Number(report.total_output_vat) || 0,
        'Tổng thanh toán (VNĐ)': outData.reduce((s, r) => s + (Number(r['Tổng thanh toán (VNĐ)']) || 0), 0),
      });
    }
    const wsOut = XLSX.utils.json_to_sheet(outData);
    wsOut['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 24 }, { wch: 28 }, { wch: 20 }, { wch: 24 }, { wch: 22 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(workbook, wsOut, 'Bảng kê bán ra (Đầu ra)');

    // Sheet 3: Bảng kê mua vào (Đầu vào)
    const inData = inputRows.map((row, idx) => ({
      'STT': idx + 1,
      'Ngày chứng từ': formatDate(row.invoice_date || row.date),
      'Số hóa đơn / Phiếu nhập': row.invoice_no || row.source_code || '',
      'Nhà cung cấp': row.supplier_name || 'Nhà cung cấp',
      'Nguồn phát sinh': row.source || 'Phiếu nhập kho / HĐ đầu vào',
      'Giá trị chịu thuế (VNĐ)': Number(row.taxable_amount) || 0,
      'Thuế GTGT đầu vào (VNĐ)': Number(row.vat_amount) || 0,
      'Tổng thanh toán (VNĐ)': Number(row.total) || 0,
    }));
    if (inData.length > 0) {
      inData.push({
        'STT': '',
        'Ngày chứng từ': '',
        'Số hóa đơn / Phiếu nhập': '',
        'Nhà cung cấp': 'TỔNG CỘNG',
        'Nguồn phát sinh': '',
        'Giá trị chịu thuế (VNĐ)': Number(report.input_taxable_amount) || 0,
        'Thuế GTGT đầu vào (VNĐ)': Number(report.total_input_vat) || 0,
        'Tổng thanh toán (VNĐ)': inData.reduce((s, r) => s + (Number(r['Tổng thanh toán (VNĐ)']) || 0), 0),
      });
    }
    const wsIn = XLSX.utils.json_to_sheet(inData);
    wsIn['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 24 }, { wch: 28 }, { wch: 24 }, { wch: 24 }, { wch: 22 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(workbook, wsIn, 'Bảng kê mua vào (Đầu vào)');

    const fileDateStr = activeRange.valid ? `${activeRange.from}_den_${activeRange.to}` : 'KyBaoCao';
    const fileName = `BaoCao_ThueGTGT_${fileDateStr}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  return (
    <div className="min-w-0 space-y-4">
      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 text-white shadow-lg">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-3"><ShieldCheck size={26} className="text-blue-200" /></div>
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.22em] text-blue-200/80">Kế toán • Thuế GTGT</div>
              <h1 className="mt-1 text-2xl font-bold">Báo cáo thuế GTGT</h1>
              <p className="mt-1 max-w-3xl text-sm text-blue-100/75">Tổng hợp thuế đầu vào, thuế đầu ra và số thuế phải nộp từ hóa đơn, phiếu nhập và dữ liệu kế toán trong kỳ.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={loading || !report}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors shadow-sm"
              title="Xuất file Excel (.xlsx) gồm bảng kê bán ra, mua vào và tổng hợp thuế"
            >
              <FileDown size={17} />
              Xuất Excel
            </button>
            <button
              type="button"
              onClick={generateSnapshot}
              disabled={generating || loading || !activeRange.valid}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60 transition-colors shadow-sm"
            >
              {generating ? <Loader2 size={17} className="animate-spin" /> : <FileCheck2 size={17} />}
              {generating ? 'Đang lưu...' : 'Lưu snapshot kỳ này'}
            </button>
          </div>
        </div>
      </section>

      {showHelp && (
        <HelpModal
          show={showHelp}
          onClose={() => setShowHelp(false)}
          title="Hướng dẫn báo cáo thuế GTGT"
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">Quy trình sử dụng</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Chọn kỳ báo cáo theo tháng hoặc khoảng ngày.</li>
                  <li>Nhấn Xem báo cáo để nạp dữ liệu.</li>
                  <li>Dùng Lưu snapshot kỳ này để lưu trạng thái báo cáo.</li>
                  <li>Nhấn nút <b>Xuất Excel</b> để tải file bảng kê và tổng hợp thuế GTGT.</li>
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-gray-800 mb-2">Lưu ý</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Báo cáo dựa trên hóa đơn và phiếu nhập trong hệ thống.</li>
                </ul>
              </div>
            </div>
          }
        />
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[170px_minmax(180px,1fr)_minmax(180px,1fr)_auto]">
          <div>
            <label className="mb-1 block text-xs font-semibold text-gray-500">Loại kỳ</label>
            <select className="input-field" value={filters.period} onChange={event => setFilters(current => ({ ...current, period: event.target.value }))}>
              <option value="month">Theo tháng</option>
              <option value="custom">Khoảng ngày</option>
            </select>
          </div>
          {filters.period === 'month' ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">Tháng báo cáo</label>
                <select
                  className="input-field font-medium text-gray-800"
                  value={currentMonthNumber}
                  onChange={event => {
                    const nextM = event.target.value;
                    const nextMonthVal = `${currentYearNumber}-${nextM}`;
                    const nextFilters = { ...filters, month: nextMonthVal };
                    setFilters(nextFilters);
                    loadReport(nextFilters);
                  }}
                >
                  <option value="01">Tháng 1</option>
                  <option value="02">Tháng 2</option>
                  <option value="03">Tháng 3</option>
                  <option value="04">Tháng 4</option>
                  <option value="05">Tháng 5</option>
                  <option value="06">Tháng 6</option>
                  <option value="07">Tháng 7</option>
                  <option value="08">Tháng 8</option>
                  <option value="09">Tháng 9</option>
                  <option value="10">Tháng 10</option>
                  <option value="11">Tháng 11</option>
                  <option value="12">Tháng 12</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">Năm</label>
                <select
                  className="input-field font-medium text-gray-800"
                  value={currentYearNumber}
                  onChange={event => {
                    const nextY = event.target.value;
                    const nextMonthVal = `${nextY}-${currentMonthNumber}`;
                    const nextFilters = { ...filters, month: nextMonthVal };
                    setFilters(nextFilters);
                    loadReport(nextFilters);
                  }}
                >
                  {[2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030].map(y => (
                    <option key={y} value={String(y)}>
                      Năm {y}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">Từ ngày</label>
                <input type="date" className="input-field" value={filters.from} max={filters.to || undefined} onChange={event => setFilters(current => ({ ...current, from: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">Đến ngày</label>
                <input type="date" className="input-field" value={filters.to} min={filters.from || undefined} onChange={event => setFilters(current => ({ ...current, to: event.target.value }))} />
              </div>
            </>
          )}
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => loadReport()} disabled={loading || !activeRange.valid} className="btn-primary min-h-11 flex-1 xl:flex-none">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Xem báo cáo
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={loading || !report}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 text-sm font-semibold transition-colors shadow-sm"
              title="Xuất file Excel"
            >
              <FileDown size={16} />
              <span className="hidden sm:inline">Xuất Excel</span>
            </button>
            <button type="button" onClick={() => loadReport()} disabled={loading} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-50" title="Tải lại">
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
          <span className="font-semibold">Đang lập báo cáo thuế GTGT...</span>
        </div>
      ) : report ? (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard icon={TrendingDown} label="Thuế GTGT đầu vào" value={report.total_input_vat} description={`${inputRows.length} chứng từ đầu vào`} tone="blue" />
            <SummaryCard icon={TrendingUp} label="Thuế GTGT đầu ra" value={report.total_output_vat} description={`${outputRows.length} chứng từ đầu ra`} tone="amber" />
            <SummaryCard icon={ShieldCheck} label={payable >= 0 ? 'Thuế phải nộp' : 'Thuế còn được khấu trừ'} value={Math.abs(payable)} description="Thuế đầu ra trừ thuế đầu vào" tone={payable >= 0 ? 'red' : 'emerald'} />
            <SummaryCard icon={FileCheck2} label="Doanh thu chịu thuế" value={report.output_taxable_amount} description={`Đầu vào chịu thuế: ${formatVND(report.input_taxable_amount)}`} tone="emerald" />
          </section>
          <SourceTable title="Chi tiết thuế GTGT đầu ra" rows={outputRows} type="output" />
          <SourceTable title="Chi tiết thuế GTGT đầu vào" rows={inputRows} type="input" />
        </>
      ) : !error ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-16 text-center text-gray-400">Chọn kỳ và nhấn "Xem báo cáo" để tải dữ liệu.</div>
      ) : null}
    </div>
  );
}
