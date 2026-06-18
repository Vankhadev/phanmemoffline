import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { apiJson, resolveApiUrl } from '../utils/apiClient';
import { globalSyncEmitter } from '../utils/eventEmitter';
import { getAuthToken } from '../utils/authStorage';
import {
  Calendar,
  Download,
  FileText,
  Loader,
  RefreshCw,
  Search,
  Users,
  Eye,
  Printer,
  X,
  ShoppingCart,
  DollarSign,
  Package,
  Clock,
} from 'lucide-react';

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
  if (!value) return '—';
  const match = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN');
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || '—';
}

function safeSheetName(name) {
  const normalized = String(name || 'Bao cao').replace(/[\\/?*\[\]:]/g, ' ').trim();
  return (normalized || 'Bao cao').slice(0, 31);
}

function normalizeCustomerSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
}

function customerDisplayName(customer = {}) {
  return [customer.name, customer.phone].filter(Boolean).join(' - ') || 'Khách hàng';
}

function InvoiceDetailModal({ invoice, onClose }) {
  const printAreaRef = useRef(null);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!printAreaRef.current) return;
    setDownloading(true);
    try {
      const canvas = await html2canvas(printAreaRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a5',
      });
      const imgWidth = 148;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
      pdf.save(`HoaDon_${invoice.invoice_code || invoice.id}.pdf`);
    } catch (err) {
      console.error('Lỗi khi tải PDF:', err);
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    window.location.hash = `#/hoa-don-in/${encodeURIComponent(invoice.invoice_code || invoice.id)}?print=1`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[95vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-gray-950">Chi tiết đơn hàng</h3>
            <p className="text-xs text-gray-500">Mã đơn: {invoice.invoice_code}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        {/* Modal Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
          {/* Printable Area */}
          <div ref={printAreaRef} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm text-sm text-gray-800">
            {/* Invoice Header */}
            <div className="text-center pb-4 border-b border-dashed border-gray-200">
              <h2 className="text-xl font-bold text-gray-900 tracking-wide">HÓA ĐƠN BÁN HÀNG</h2>
              <p className="mt-1 text-xs text-gray-500">Mã: {invoice.invoice_code} · {formatDateTime(invoice.created_at)}</p>
            </div>

            {/* Invoice Meta */}
            <div className="grid grid-cols-2 gap-y-2 gap-x-4 py-4 text-xs border-b border-dashed border-gray-200">
              <div>
                <span className="text-gray-400">Khách hàng:</span>{' '}
                <span className="font-semibold text-gray-900">{invoice.customer_name || 'Khách lẻ'}</span>
              </div>
              <div>
                <span className="text-gray-400">Phương thức:</span>{' '}
                <span className="font-semibold text-gray-950">
                  {invoice.payment_method === 'cash' ? 'Tiền mặt' : invoice.payment_method === 'bank' ? 'Chuyển khoản' : 'Công nợ'}
                </span>
              </div>
              {invoice.customer_phone && (
                <div>
                  <span className="text-gray-400">Điện thoại:</span>{' '}
                  <span className="font-semibold text-gray-900">{invoice.customer_phone}</span>
                </div>
              )}
              <div>
                <span className="text-gray-400">Trạng thái:</span>{' '}
                <span className={`font-semibold ${invoice.status === 'completed' ? 'text-emerald-600' : invoice.status === 'cancelled' ? 'text-red-500' : 'text-amber-600'}`}>
                  {statusLabel(invoice.status)}
                </span>
              </div>
              {invoice.note && (
                <div className="col-span-2">
                  <span className="text-gray-400">Ghi chú:</span>{' '}
                  <span className="text-gray-700 italic">{invoice.note}</span>
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="py-4">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-500 font-semibold uppercase tracking-wider">
                    <th className="py-2">Sản phẩm</th>
                    <th className="py-2 text-right">SL</th>
                    <th className="py-2 text-right">Đơn giá</th>
                    <th className="py-2 text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.details?.map((detail, index) => (
                    <tr key={index} className="border-b border-gray-100">
                      <td className="py-2.5 font-medium text-gray-900">
                        {detail.product_name}
                        {detail.product_sku && <div className="text-[10px] text-gray-400 font-normal">SKU: {detail.product_sku}</div>}
                      </td>
                      <td className="py-2.5 text-right font-semibold text-gray-700">{detail.quantity}</td>
                      <td className="py-2.5 text-right text-gray-600">{formatVND(detail.unit_price)}</td>
                      <td className="py-2.5 text-right font-bold text-gray-900">{formatVND(detail.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Invoice Footer Summary */}
            <div className="pt-4 border-t border-dashed border-gray-200 text-xs space-y-1.5 ml-auto w-2/3">
              <div className="flex justify-between text-gray-500">
                <span>Tạm tính:</span>
                <span className="font-semibold text-gray-800">{formatVND(invoice.subtotal)}</span>
              </div>
              {invoice.discount_amount > 0 && (
                <div className="flex justify-between text-rose-600 font-medium">
                  <span>Giảm giá:</span>
                  <span>-{formatVND(invoice.discount_amount)}</span>
                </div>
              )}
              {invoice.vat_amount > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>Thuế (VAT):</span>
                  <span>+{formatVND(invoice.vat_amount)}</span>
                </div>
              )}
              {invoice.delivery_fee > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>Phí vận chuyển:</span>
                  <span>+{formatVND(invoice.delivery_fee)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold text-gray-900 border-t border-gray-100 pt-1.5">
                <span>Tổng cộng:</span>
                <span className="text-blue-700">{formatVND(invoice.total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-4">
          <button type="button" onClick={handleDownload} disabled={downloading} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {downloading ? <Loader size={15} className="animate-spin" /> : <Download size={15} />}
            Tải PDF
          </button>
          <button type="button" onClick={handlePrint} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            <Printer size={15} />
            In hóa đơn
          </button>
          <button type="button" onClick={onClose} className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800">
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CustomerOrderReport() {
  const defaultRange = useMemo(() => getDefaultRange(), []);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const customerSearchRef = useRef(null);

  const customerId = selectedCustomer ? String(selectedCustomer.id || '') : '';

  const loadCustomers = useCallback(async (searchQuery = '') => {
    setLoadingCustomers(true);
    setError('');
    try {
      const data = await apiJson(`/customers?q=${encodeURIComponent(searchQuery)}`, {}, 'Không tải được danh sách khách hàng');
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Không tải được danh sách khách hàng');
    } finally {
      setLoadingCustomers(false);
    }
  }, []);

  // Debounced typing effect
  useEffect(() => {
    const selectedName = selectedCustomer ? customerDisplayName(selectedCustomer) : '';
    if (selectedCustomer && customerSearch === selectedName) return;

    const timer = setTimeout(() => {
      loadCustomers(customerSearch);
    }, 200);

    return () => clearTimeout(timer);
  }, [customerSearch, selectedCustomer, loadCustomers]);

  const invoices = report?.invoices || [];
  const summary = report?.summary || { total_invoices: 0, total_amount: 0 };

  const reportStats = useMemo(() => {
    if (!report || invoices.length === 0) return null;
    let totalProducts = 0;
    for (const inv of invoices) {
      for (const d of inv.details || []) {
        totalProducts += Number(d.quantity) || 0;
      }
    }
    const sorted = [...invoices].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const latest = sorted[0];
    return {
      totalInvoices: invoices.length,
      totalAmount: summary.total_amount,
      totalProducts,
      latestCode: latest?.invoice_code || '—',
      latestDate: latest?.created_at || null,
    };
  }, [report, invoices, summary]);

  const canViewReport = customerId && from && to && !loadingReport;
  const canExport = invoices.length > 0 && !loadingReport;

  useEffect(() => {
    if (!selectedCustomer) return;
    setCustomerSearch(customerDisplayName(selectedCustomer));
  }, [selectedCustomer]);

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!customerSearchRef.current || customerSearchRef.current.contains(event.target)) return;
      setShowCustomerResults(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const selectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setCustomerSearch(customerDisplayName(customer));
    setShowCustomerResults(false);
    setError('');
  };

  const handleInputFocus = () => {
    setShowCustomerResults(true);
    loadCustomers('');
  };

  const fetchReport = useCallback(async () => {
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
      const data = await apiJson(`/invoices/reports/customer-orders?${params.toString()}`, {}, 'Không lập được báo cáo');
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err.message || 'Không lập được báo cáo');
    } finally {
      setLoadingReport(false);
    }
  }, [customerId, from, to]);

  useEffect(() => {
    const handleCustomerSync = () => {
      loadCustomers(customerSearch);
      console.log('[SYNC] CustomerOrderReport refreshed');
    };

    const handleReportSync = () => {
      if (customerId) {
        fetchReport();
        console.log('[SYNC] CustomerOrderReport refreshed');
      }
    };

    const unsubscribeCustomerCreated = globalSyncEmitter.on('CUSTOMER_CREATED', handleCustomerSync);
    const unsubscribeCustomerUpdated = globalSyncEmitter.on('CUSTOMER_UPDATED', handleCustomerSync);
    const unsubscribeOrderCreated = globalSyncEmitter.on('ORDER_CREATED', handleReportSync);
    const unsubscribeOrderUpdated = globalSyncEmitter.on('ORDER_UPDATED', handleReportSync);
    const unsubscribeOrderDeleted = globalSyncEmitter.on('ORDER_DELETED', handleReportSync);

    return () => {
      unsubscribeCustomerCreated();
      unsubscribeCustomerUpdated();
      unsubscribeOrderCreated();
      unsubscribeOrderUpdated();
      unsubscribeOrderDeleted();
    };
  }, [loadCustomers, fetchReport, customerId, customerSearch]);

  const exportExcel = async () => {
    if (!canExport) return;

    setLoadingReport(true);
    setError('');
    try {
      const params = new URLSearchParams({ customer_id: customerId, from, to });
      const exportUrl = resolveApiUrl(`/invoices/reports/customer-orders/export?${params.toString()}`);
      
      const response = await fetch(exportUrl, {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Không tải được báo cáo Excel.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      const contentDisposition = response.headers.get('Content-Disposition');
      let fileName = `BaoCaoCongNo_${report?.customer?.name || selectedCustomer?.name || 'KhachHang'}_${from}_den_${to}.xlsx`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
        if (match?.[1]) {
          fileName = decodeURIComponent(match[1].replace(/['"]/g, ''));
        }
      }

      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Lỗi khi tải file báo cáo Excel');
    } finally {
      setLoadingReport(false);
    }
  };

  const handlePrintRow = (invoice) => {
    window.location.hash = `#/hoa-don-in/${encodeURIComponent(invoice.invoice_code || invoice.id)}?print=1`;
  };

  const handleDownloadRowPdf = async (invoice) => {
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'fixed';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '-9999px';
    tempDiv.style.width = '148mm';
    tempDiv.style.background = '#ffffff';
    tempDiv.style.padding = '20px';
    tempDiv.style.fontFamily = 'system-ui, sans-serif';
    
    tempDiv.innerHTML = `
      <div style="text-align: center; padding-bottom: 15px; border-bottom: 1px dashed #e2e8f0;">
        <h2 style="margin: 0; font-size: 18px; color: #1a202c;">HÓA ĐƠN BÁN HÀNG</h2>
        <p style="margin: 5px 0 0; font-size: 11px; color: #718096;">Mã: ${invoice.invoice_code} · ${formatDateTime(invoice.created_at)}</p>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 15px 0; font-size: 11px; border-bottom: 1px dashed #e2e8f0; color: #2d3748;">
        <div><strong>Khách hàng:</strong> ${invoice.customer_name || 'Khách lẻ'}</div>
        <div><strong>Phương thức:</strong> ${invoice.payment_method === 'cash' ? 'Tiền mặt' : invoice.payment_method === 'bank' ? 'Chuyển khoản' : 'Công nợ'}</div>
        <div><strong>Trạng thái:</strong> ${statusLabel(invoice.status)}</div>
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 15px;">
        <thead>
          <tr style="border-bottom: 1px solid #cbd5e0; text-align: left; color: #718096;">
            <th style="padding: 6px 0;">Sản phẩm</th>
            <th style="padding: 6px 0; text-align: right;">SL</th>
            <th style="padding: 6px 0; text-align: right;">Đơn giá</th>
            <th style="padding: 6px 0; text-align: right;">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          ${invoice.details?.map(d => `
            <tr style="border-bottom: 1px solid #edf2f7;">
              <td style="padding: 8px 0; color: #1a202c;">${d.product_name}</td>
              <td style="padding: 8px 0; text-align: right; color: #4a5568;">${d.quantity}</td>
              <td style="padding: 8px 0; text-align: right; color: #4a5568;">${formatVND(d.unit_price)}</td>
              <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #1a202c;">${formatVND(d.line_total)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top: 15px; border-top: 1px dashed #e2e8f0; padding-top: 10px; font-size: 11px; margin-left: auto; width: 60%; text-align: right; color: #4a5568;">
        <div style="margin-bottom: 4px;">Tạm tính: <strong>${formatVND(invoice.subtotal)}</strong></div>
        ${invoice.discount_amount > 0 ? `<div style="margin-bottom: 4px; color: #e53e3e;">Giảm giá: -${formatVND(invoice.discount_amount)}</div>` : ''}
        ${invoice.vat_amount > 0 ? `<div style="margin-bottom: 4px;">VAT: +${formatVND(invoice.vat_amount)}</div>` : ''}
        <div style="font-size: 13px; font-weight: bold; color: #2b6cb0; margin-top: 6px;">Tổng cộng: ${formatVND(invoice.total)}</div>
      </div>
    `;
    
    document.body.appendChild(tempDiv);
    try {
      const canvas = await html2canvas(tempDiv, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a5',
      });
      const imgWidth = 148;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
      pdf.save(`HoaDon_${invoice.invoice_code || invoice.id}.pdf`);
    } catch (err) {
      console.error('Không thể xuất PDF:', err);
    } finally {
      document.body.removeChild(tempDiv);
    }
  };

  return (
    <div className="space-y-6 min-w-0">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-blue-900 via-slate-900 to-purple-900 px-5 py-5 text-white rounded-t-2xl">
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

        <div className="p-5 bg-gray-50 border-t border-white/10 rounded-b-2xl">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(240px,1fr)_180px_180px_auto]">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-500">Khách hàng</label>
              <div ref={customerSearchRef} className="relative">
                <div className="flex min-w-0 gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Users size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      className="input-field w-full pl-9 pr-8"
                      value={customerSearch}
                      onChange={event => {
                        const val = event.target.value;
                        setCustomerSearch(val);
                        if (!val) {
                          setSelectedCustomer(null);
                        } else {
                          const selectedName = selectedCustomer ? customerDisplayName(selectedCustomer) : '';
                          if (val !== selectedName) {
                            setSelectedCustomer(null);
                          }
                        }
                        setShowCustomerResults(true);
                      }}
                      onFocus={handleInputFocus}
                      onClick={handleInputFocus}
                      placeholder={loadingCustomers ? 'Đang tải khách hàng...' : 'Tìm tên, SĐT, email, mã KH...'}
                    />
                    {customerSearch && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerSearch('');
                          setSelectedCustomer(null);
                          setReport(null);
                          setError('');
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                </div>

                {showCustomerResults && (
                  <div className="absolute right-0 left-0 z-30 mt-2 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-2xl">
                    <div className="border-b border-gray-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Danh sách gợi ý (A-Z)
                    </div>
                    {loadingCustomers && customers.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-gray-400 flex items-center gap-2">
                        <Loader size={12} className="animate-spin text-blue-500" /> Đang tải gợi ý...
                      </div>
                    ) : customers.length > 0 ? (
                      customers.map(customer => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => selectCustomer(customer)}
                          className={`block w-full px-3 py-2 text-left transition hover:bg-blue-50 ${Number(customer.id) === Number(customerId) ? 'bg-blue-50' : 'bg-white'}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="truncate text-sm font-semibold text-gray-800">{customer.name || 'Khách hàng'}</div>
                            <div className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                              {customer.invoice_count || 0} đơn
                            </div>
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-gray-500">
                            {[customer.customer_code ? `Mã: ${customer.customer_code}` : '', customer.phone, customer.email].filter(Boolean).join(' · ') || 'Chưa có thông tin liên hệ'}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-3 text-sm text-gray-400">Không tìm thấy khách hàng phù hợp</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-500">Từ ngày</label>
              <div className="relative">
                <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="date" className="input-field w-full pl-9" value={from} onChange={e => setFrom(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-500">Đến ngày</label>
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
                  setSelectedCustomer(null);
                  setCustomerSearch('');
                  setShowCustomerResults(false);
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

          {error && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>
      </div>

      {selectedCustomer && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 shadow-sm">
          <div>
            <span className="block text-xs font-semibold text-blue-500 uppercase tracking-wider">Khách hàng</span>
            <span className="mt-1 block font-bold text-gray-900">{selectedCustomer.name}</span>
            <span className="mt-0.5 block text-xs text-gray-500">{[selectedCustomer.phone, selectedCustomer.email].filter(Boolean).join(' · ') || 'Chưa có SĐT/Email'}</span>
          </div>
          <div>
            <span className="block text-xs font-semibold text-blue-500 uppercase tracking-wider">Mã / Nhóm khách</span>
            <span className="mt-1 block font-bold text-gray-900">{selectedCustomer.customer_code || '—'}</span>
            <span className="mt-0.5 block text-xs text-gray-500">{selectedCustomer.customer_type_name || 'Khách lẻ'}</span>
          </div>
          <div>
            <span className="block text-xs font-semibold text-blue-500 uppercase tracking-wider">Ngày tham gia</span>
            <span className="mt-1 block font-bold text-gray-900">{formatDateOnly(selectedCustomer.created_at)}</span>
            <span className="mt-0.5 block text-xs text-gray-500">Lịch sử hệ thống</span>
          </div>
          <div>
            <span className="block text-xs font-semibold text-blue-500 uppercase tracking-wider">Doanh thu trọn đời</span>
            <span className="mt-1 block font-bold text-blue-700">{formatVND(selectedCustomer.total_revenue || 0)}</span>
            <span className="mt-0.5 block text-xs text-emerald-600 font-semibold">{selectedCustomer.invoice_count || 0} đơn hàng thành công</span>
          </div>
        </div>
      )}

      {reportStats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3.5 text-blue-700 shadow-sm flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-blue-100 p-2"><ShoppingCart size={17} /></div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider opacity-85">Số đơn hàng</div>
              <div className="mt-1 text-xl font-extrabold">{reportStats.totalInvoices}</div>
              <div className="text-[10px] opacity-75">Trong kỳ lọc</div>
            </div>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3.5 text-emerald-700 shadow-sm flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-emerald-100 p-2"><DollarSign size={17} /></div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider opacity-85">Tổng tiền mua</div>
              <div className="mt-1 text-xl font-extrabold">{formatVND(reportStats.totalAmount)}</div>
              <div className="text-[10px] opacity-75">Không tính đơn hủy</div>
            </div>
          </div>
          <div className="rounded-2xl border border-purple-100 bg-purple-50 px-4 py-3.5 text-purple-700 shadow-sm flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-purple-100 p-2"><Package size={17} /></div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider opacity-85">Số sản phẩm</div>
              <div className="mt-1 text-xl font-extrabold">{reportStats.totalProducts}</div>
              <div className="text-[10px] opacity-75">Tổng lượng hàng nhập</div>
            </div>
          </div>
          <div className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3.5 text-orange-700 shadow-sm flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-orange-100 p-2"><ShoppingCart size={17} /></div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider opacity-85">Đơn gần nhất</div>
              <div className="mt-1 text-lg font-extrabold truncate max-w-[120px]">{reportStats.latestCode}</div>
              <div className="text-[10px] opacity-75">Mã chứng từ cuối</div>
            </div>
          </div>
          <div className="rounded-2xl border border-pink-100 bg-pink-50 px-4 py-3.5 text-pink-750 shadow-sm flex items-start gap-3 col-span-2 sm:col-span-1">
            <div className="mt-0.5 rounded-lg bg-pink-100 p-2"><Clock size={17} className="text-pink-600" /></div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider opacity-85 text-pink-700">Ngày mua cuối</div>
              <div className="mt-1 text-base font-extrabold text-pink-700">{reportStats.latestDate ? formatDateTime(reportStats.latestDate) : '—'}</div>
              <div className="text-[10px] text-pink-600 opacity-75">Thời gian thanh toán</div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-gray-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-bold text-gray-800">Danh sách hóa đơn mua hàng</h2>
            <p className="text-xs text-gray-500">Hiển thị chi tiết sản phẩm, đơn giá, số lượng và tổng tiền của từng hóa đơn.</p>
          </div>
          {report && (
            <div className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">
              {summary.total_invoices || 0} hóa đơn · {formatVND(summary.total_amount)}
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 text-left w-32">Mã đơn</th>
                <th className="px-4 py-3 text-left w-44">Ngày bán</th>
                <th className="px-4 py-3 text-left">Sản phẩm & chi tiết</th>
                <th className="px-4 py-3 text-right w-40">Tổng cộng</th>
                <th className="px-4 py-3 text-left w-36">Trạng thái</th>
                <th className="px-4 py-3 text-center w-48 no-print">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(invoice => (
                <tr key={invoice.id || invoice.invoice_code} className="border-t border-gray-100 align-top hover:bg-gray-50/50 transition">
                  <td className="px-4 py-3 font-semibold text-blue-700">{invoice.invoice_code || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{formatDateTime(invoice.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="space-y-1.5">
                      {invoice.details && invoice.details.length > 0 ? (
                        invoice.details.map((detail, index) => (
                          <div key={index} className="flex flex-col text-xs bg-gray-50 rounded-lg p-2 border border-gray-100/70">
                            <div className="font-semibold text-gray-900">{detail.product_name || 'Sản phẩm'}</div>
                            <div className="mt-0.5 text-gray-500 flex flex-wrap items-center gap-1.5">
                              <span>Số lượng: <strong className="text-gray-800">{detail.quantity}</strong></span>
                              <span>·</span>
                              <span>Đơn giá: <strong className="text-gray-800">{formatVND(detail.unit_price)}</strong></span>
                              <span>·</span>
                              <span>Thành tiền: <strong className="text-blue-600 font-semibold">{formatVND(detail.line_total)}</strong></span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-gray-400 italic">Không có chi tiết hàng hóa</div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-extrabold text-gray-900">{formatVND(invoice.total)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                      invoice.status === 'completed' 
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                        : invoice.status === 'cancelled' 
                          ? 'bg-red-50 text-red-700 border border-red-200' 
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}>
                      {statusLabel(invoice.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center no-print">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(invoice)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                        title="Xem chi tiết"
                      >
                        <Eye size={12} /> Xem
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePrintRow(invoice)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                        title="In đơn"
                      >
                        <Printer size={12} /> In
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadRowPdf(invoice)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                        title="Tải PDF"
                      >
                        <Download size={12} /> PDF
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {invoices.length > 0 && (
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                  <td className="px-4 py-3" colSpan={3}>Tổng cộng tất cả các đơn trong kỳ</td>
                  <td className="px-4 py-3 text-right text-blue-700 text-base font-extrabold">{formatVND(summary.total_amount)}</td>
                  <td className="px-4 py-3" colSpan={2}></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loadingReport ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-400">
            <Loader size={32} className="animate-spin text-blue-400" />
            <div className="font-semibold text-gray-600">Đang thống kê dữ liệu đơn hàng...</div>
          </div>
        ) : report && invoices.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mb-3 text-5xl opacity-20">🧾</div>
            <div className="font-semibold text-gray-600">Không tìm thấy đơn hàng trong khoảng thời gian đã chọn</div>
            <div className="mt-1 text-sm text-gray-400">Hãy điều chỉnh lại khoảng thời gian lọc hoặc chọn khách hàng khác.</div>
          </div>
        ) : !report ? (
          <div className="py-16 text-center">
            <div className="mb-3 text-5xl opacity-20">📊</div>
            <div className="font-semibold text-gray-600">Chưa có dữ liệu báo cáo</div>
            <div className="mt-1 text-sm text-gray-400 font-medium">Nhập thông tin khách hàng và chọn khoảng thời gian để tạo báo cáo chi tiết.</div>
          </div>
        ) : null}
      </div>

      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </div>
  );
}
