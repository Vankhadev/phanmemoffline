import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Filter,
  HelpCircle,
  Info,
  Key,
  Layers,
  Loader2,
  MessageCircle,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  User,
  Users,
  X,
} from 'lucide-react';
import { accountingApi, getApiErrorMessage, SYNC_UPDATED_EVENT } from '../utils/apiClient';
import {
  loadStoredChatMessages,
  saveStoredChatMessages,
  clearStoredChatMessages,
  AI_CHAT_UPDATED_EVENT,
} from '../utils/aiChatStorage';

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

const PERIOD_PRESETS = [
  { key: 'this_month', label: 'Tháng này' },
  { key: 'last_month', label: 'Tháng trước' },
  { key: 'this_quarter', label: 'Quý này' },
  { key: 'this_year', label: 'Năm nay' },
  { key: 'today', label: 'Hôm nay' },
  { key: 'all_time', label: 'Toàn bộ' },
  { key: 'custom', label: 'Tùy chỉnh' },
];

export default function DebtAgingReport({ user }) {
  // State Bộ lọc
  const [periodType, setPeriodType] = useState('this_month');
  const [dateRange, setDateRange] = useState(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: formatDateISO(from), to: formatDateISO(now) };
  });
  const [statusFilter, setStatusFilter] = useState('all');
  const [bucketFilter, setBucketFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Dữ liệu chính
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Chế độ xem: 'customers' (Tổng hợp khách hàng) hoặc 'invoices' (Chi tiết hóa đơn)
  const [viewMode, setViewMode] = useState('customers');

  // Phân trang
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  // AI Assistant Panel & Trạng thái
  const [showAiDrawer, setShowAiDrawer] = useState(false);
  const [aiActiveTab, setAiActiveTab] = useState('analyze'); // 'analyze' | 'chat'
  const [aiConfig, setAiConfig] = useState(null);
  const [aiConfigLoading, setAiConfigLoading] = useState(false);
  const [showAiConfigModal, setShowAiConfigModal] = useState(false);

  // Phân tích sức khỏe tài chính AI
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [analyzingAi, setAnalyzingAi] = useState(false);

  // Hỏi đáp AI Chat (Lưu trữ bền vững)
  const [chatMessages, setChatMessages] = useState(() => loadStoredChatMessages());
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatScrollRef = useRef(null);

  useEffect(() => {
    const handleSync = (event) => {
      const incoming = event?.detail?.messages;
      if (Array.isArray(incoming)) setChatMessages(incoming);
    };
    window.addEventListener(AI_CHAT_UPDATED_EVENT, handleSync);
    return () => window.removeEventListener(AI_CHAT_UPDATED_EVENT, handleSync);
  }, []);

  // Modal Soạn tin nhắn nhắc nợ
  const [reminderModal, setReminderModal] = useState(null); // { customer, invoice, message, loading, style, notes, copied }

  // Modal Chi tiết công nợ 1 khách hàng
  const [customerDetailModal, setCustomerDetailModal] = useState(null);
  const [customerDetailLoading, setCustomerDetailLoading] = useState(false);

  // Load cấu hình Gemini AI
  const loadAiConfig = useCallback(async () => {
    setAiConfigLoading(true);
    try {
      const res = await accountingApi.ai.getConfig();
      if (res && res.config) setAiConfig(res.config);
    } catch (_) {
      // Ignored
    } finally {
      setAiConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAiConfig();
  }, [loadAiConfig]);

  // Load báo cáo tuổi nợ
  const loadReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {
        period_type: periodType,
        status: statusFilter,
        aging_bucket: bucketFilter,
        search: searchTerm,
        page: currentPage,
        limit: pageSize,
      };
      if (periodType === 'custom') {
        params.from = dateRange.from;
        params.to = dateRange.to;
      }
      const data = await accountingApi.debtAging(params);
      if (data && data.ok) {
        setReportData(data);
      } else {
        setError(data?.error || 'Không thể tải báo cáo công nợ.');
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Lỗi khi kết nối đến máy chủ lấy báo cáo công nợ.'));
    } finally {
      setLoading(false);
    }
  }, [periodType, dateRange, statusFilter, bucketFilter, searchTerm, currentPage]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  // Lắng nghe cập nhật đơn hàng thời gian thực
  useEffect(() => {
    const onSync = (e) => {
      const tables = e.detail?.changedTables || [];
      if (tables.some(t => ['invoices', 'invoice_details', 'customers', 'customer_debts'].includes(t))) {
        loadReport();
      }
    };
    window.addEventListener(SYNC_UPDATED_EVENT, onSync);
    return () => window.removeEventListener(SYNC_UPDATED_EVENT, onSync);
  }, [loadReport]);

  // Xử lý chọn kỳ nhanh
  const handleSelectPreset = (key) => {
    setPeriodType(key);
    setCurrentPage(1);
    const now = new Date();
    if (key === 'today') {
      const iso = formatDateISO(now);
      setDateRange({ from: iso, to: iso });
    } else if (key === 'this_month') {
      setDateRange({ from: formatDateISO(new Date(now.getFullYear(), now.getMonth(), 1)), to: formatDateISO(now) });
    } else if (key === 'last_month') {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      setDateRange({ from: formatDateISO(from), to: formatDateISO(to) });
    } else if (key === 'this_year') {
      setDateRange({ from: formatDateISO(new Date(now.getFullYear(), 0, 1)), to: formatDateISO(now) });
    }
  };

  // Xuất file Excel Báo cáo Tuổi nợ & Công nợ
  const handleExportExcel = () => {
    const params = {
      period_type: periodType,
      status: statusFilter,
      aging_bucket: bucketFilter,
      search: searchTerm,
    };
    if (periodType === 'custom') {
      params.from = dateRange.from;
      params.to = dateRange.to;
    }
    const query = new URLSearchParams(params).toString();
    const url = `/api/accounting/debts/aging/export-excel?${query}`;
    window.open(url, '_blank');
  };

  // Gửi báo cáo công nợ & nợ xấu về Telegram
  const [sendingTelegram, setSendingTelegram] = useState(false);
  const handleSendTelegram = async () => {
    setSendingTelegram(true);
    try {
      const params = {
        period_type: periodType,
        status: statusFilter,
        aging_bucket: bucketFilter,
        search: searchTerm,
      };
      if (periodType === 'custom') {
        params.from = dateRange.from;
        params.to = dateRange.to;
      }
      const res = await accountingApi.sendDebtAgingTelegramReport(params);
      if (res && res.ok) {
        alert('✅ ' + (res.message || 'Đã gửi báo cáo công nợ về Telegram thành công!'));
      } else {
        alert('❌ ' + (res?.error || 'Không thể gửi báo cáo về Telegram.'));
      }
    } catch (err) {
      alert('❌ ' + getApiErrorMessage(err, 'Lỗi khi gửi báo cáo về Telegram.'));
    } finally {
      setSendingTelegram(false);
    }
  };

  // Chạy AI phân tích nợ xấu
  const handleRunAiAnalysis = async () => {
    if (!aiConfig?.isConfigured) {
      setShowAiConfigModal(true);
      return;
    }
    setAnalyzingAi(true);
    try {
      const queryOptions = {
        period_type: periodType,
        from: dateRange.from,
        to: dateRange.to,
      };
      const res = await accountingApi.ai.analyze(queryOptions);
      if (res && res.ok) {
        setAiAnalysis(res);
      } else {
        alert(res?.error || 'Lỗi khi gọi AI phân tích.');
      }
    } catch (err) {
      alert(getApiErrorMessage(err, 'Không thể phân tích tài chính bằng AI. Vui lòng kiểm tra API Key.'));
    } finally {
      setAnalyzingAi(false);
    }
  };

  // Gửi câu hỏi chat AI
  const handleSendChatMessage = async (presetQuestion = null) => {
    const q = (presetQuestion || chatInput || '').trim();
    if (!q) return;
    if (!aiConfig?.isConfigured) {
      setShowAiConfigModal(true);
      return;
    }

    const nextUserMsg = { id: `user-${Date.now()}`, role: 'user', text: q, time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) };
    const updatedMessages = [...chatMessages, nextUserMsg];
    setChatMessages(updatedMessages);
    saveStoredChatMessages(updatedMessages);
    setChatInput('');
    setChatLoading(true);

    try {
      const history = updatedMessages.slice(-8).map(m => ({ role: m.role, text: m.text }));
      const res = await accountingApi.ai.chat({
        question: q,
        queryOptions: { period_type: periodType, from: dateRange.from, to: dateRange.to },
        history,
      });

      if (res && res.ok && res.reply) {
        const nextList = [
          ...updatedMessages,
          { id: `ai-${Date.now()}`, role: 'model', text: res.reply, time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) },
        ];
        setChatMessages(nextList);
        saveStoredChatMessages(nextList);
      } else {
        const nextList = [
          ...updatedMessages,
          { id: `err-${Date.now()}`, role: 'model', text: '⚠️ ' + (res?.error || 'Không nhận được phản hồi từ AI.'), isError: true },
        ];
        setChatMessages(nextList);
        saveStoredChatMessages(nextList);
      }
    } catch (err) {
      const nextList = [
        ...updatedMessages,
        { id: `err-${Date.now()}`, role: 'model', text: '⚠️ Lỗi: ' + getApiErrorMessage(err, 'Lỗi kết nối Trợ lý AI.'), isError: true },
      ];
      setChatMessages(nextList);
      saveStoredChatMessages(nextList);
    } finally {
      setChatLoading(false);
      setTimeout(() => {
        if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }, 100);
    }
  };

  // Xóa toàn bộ lịch sử trò chuyện
  const handleClearChatHistory = () => {
    if (window.confirm('Bạn có chắc muốn xóa lịch sử trò chuyện với Trợ lý AI không?')) {
      const reset = clearStoredChatMessages();
      setChatMessages(reset);
    }
  };

  // Mở modal soạn tin nhắn nhắc nợ cho khách
  const handleOpenReminderModal = async (customer, invoice = null) => {
    if (!aiConfig?.isConfigured) {
      setShowAiConfigModal(true);
      return;
    }

    setReminderModal({
      customer,
      invoice,
      style: customer.max_debt_days > 30 ? 'firm' : 'professional',
      notes: '',
      message: '',
      loading: true,
      copied: false,
    });

    try {
      const res = await accountingApi.ai.reminderMessage({
        customer_id: customer.customer_id,
        invoice_id: invoice ? invoice.invoice_id : undefined,
        style: customer.max_debt_days > 30 ? 'firm' : 'professional',
      });
      if (res && res.ok) {
        setReminderModal(prev => prev ? ({ ...prev, message: res.message, loading: false }) : null);
      } else {
        setReminderModal(prev => prev ? ({ ...prev, message: 'Lỗi: ' + (res?.error || 'Không tạo được tin nhắn'), loading: false }) : null);
      }
    } catch (err) {
      setReminderModal(prev => prev ? ({ ...prev, message: 'Lỗi: ' + getApiErrorMessage(err), loading: false }) : null);
    }
  };

  // Tạo lại tin nhắn nhắc nợ với style hoặc ghi chú mới
  const handleRegenerateReminder = async (newStyle, newNotes) => {
    if (!reminderModal?.customer) return;
    setReminderModal(prev => ({ ...prev, loading: true, style: newStyle, notes: newNotes }));
    try {
      const res = await accountingApi.ai.reminderMessage({
        customer_id: reminderModal.customer.customer_id,
        invoice_id: reminderModal.invoice ? reminderModal.invoice.invoice_id : undefined,
        style: newStyle,
        customNotes: newNotes,
      });
      if (res && res.ok) {
        setReminderModal(prev => prev ? ({ ...prev, message: res.message, loading: false, copied: false }) : null);
      }
    } catch (err) {
      alert(getApiErrorMessage(err, 'Lỗi khi tạo lại tin nhắn nhắc nợ.'));
      setReminderModal(prev => prev ? ({ ...prev, loading: false }) : null);
    }
  };

  // Copy tin nhắn vào clipboard
  const handleCopyReminder = () => {
    if (!reminderModal?.message) return;
    navigator.clipboard.writeText(reminderModal.message).then(() => {
      setReminderModal(prev => prev ? ({ ...prev, copied: true }) : null);
      setTimeout(() => {
        setReminderModal(prev => prev ? ({ ...prev, copied: false }) : null);
      }, 2500);
    });
  };

  // Mở sổ chi tiết công nợ 1 khách hàng
  const handleOpenCustomerDetail = async (customerId) => {
    setCustomerDetailLoading(true);
    setCustomerDetailModal({ customerId, data: null });
    try {
      const res = await accountingApi.customerDebtAging(customerId);
      if (res && res.ok) {
        setCustomerDetailModal({ customerId, data: res });
      }
    } catch (err) {
      alert(getApiErrorMessage(err, 'Lỗi khi tải chi tiết khách hàng.'));
      setCustomerDetailModal(null);
    } finally {
      setCustomerDetailLoading(false);
    }
  };

  const kpi = reportData?.kpi_summary;
  const customers = reportData?.customer_summary || [];
  const invoices = reportData?.invoice_details || [];
  const breakdown = kpi?.aging_breakdown;

  // Lọc danh sách khách hàng cục bộ
  const filteredCustomers = useMemo(() => {
    if (!customers) return [];
    return customers.filter(c => {
      if (statusFilter === 'overdue' && c.overdue_invoices_count === 0) return false;
      if (bucketFilter === 'bucket_0_15' && c.bucket_0_15 <= 0) return false;
      if (bucketFilter === 'bucket_16_30' && c.bucket_16_30 <= 0) return false;
      if (bucketFilter === 'bucket_31_60' && c.bucket_31_60 <= 0) return false;
      if (bucketFilter === 'bucket_over_60' && c.bucket_over_60 <= 0) return false;
      return true;
    });
  }, [customers, statusFilter, bucketFilter]);

  return (
    <div className="min-w-0 space-y-5 pb-12">
      {/* 1. Header Banner & Actions */}
      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 text-white shadow-xl">
        <div className="flex flex-col gap-4 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl border border-indigo-400/20 bg-indigo-500/10 p-3.5 shadow-inner">
              <Sparkles size={30} className="text-indigo-300 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-indigo-500/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-indigo-300">
                  Chuẩn Doanh Nghiệp & AI Ready
                </span>
                {aiConfig?.isConfigured ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                    <CheckCircle2 size={12} /> Gemini {aiConfig.model}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAiConfigModal(true)}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/30 transition"
                  >
                    <Key size={12} /> Chưa cấu hình API Key
                  </button>
                )}
              </div>
              <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-white">
                Báo cáo Tuổi nợ & Chậm thanh toán
              </h1>
              <p className="mt-1 text-sm text-slate-300/80">
                Phân tích 4 nhóm tuổi nợ, khoanh vùng nợ xấu, tự động tạo tin nhắn đòi nợ Zalo và trợ lý kế toán AI theo thời gian thực.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-600/20 px-4 py-2.5 text-sm font-semibold text-emerald-200 hover:bg-emerald-600/30 shadow-sm transition"
              title="Xuất file Excel 2 sheet chuẩn kế toán doanh nghiệp"
            >
              <FileSpreadsheet size={16} /> Xuất Excel Công Nợ
            </button>
            <button
              type="button"
              onClick={handleSendTelegram}
              disabled={sendingTelegram}
              className="inline-flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-600/20 px-4 py-2.5 text-sm font-semibold text-sky-200 hover:bg-sky-600/30 shadow-sm transition disabled:opacity-60"
              title="Gửi tóm tắt công nợ & tuổi nợ về nhóm Telegram của cửa hàng"
            >
              {sendingTelegram ? <Loader2 size={16} className="animate-spin text-sky-300" /> : <Send size={16} />}
              {sendingTelegram ? 'Đang gửi...' : 'Gửi Telegram'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAiDrawer(true);
                if (!aiAnalysis) handleRunAiAnalysis();
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg hover:from-indigo-600 hover:to-purple-700 transition"
            >
              <Bot size={17} /> Trợ lý Kế toán AI
            </button>
            <button
              type="button"
              onClick={() => setShowAiConfigModal(true)}
              className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 p-2.5 text-slate-300 hover:bg-slate-700 hover:text-white transition"
              title="Cài đặt Google Gemini API Key"
            >
              <Key size={17} />
            </button>
          </div>
        </div>

        {/* Quick Period Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto border-t border-slate-800/80 bg-slate-900/60 px-6 py-2 text-xs">
          <span className="font-semibold text-slate-400 mr-2 flex items-center gap-1">
            <Calendar size={13} /> Kỳ báo cáo:
          </span>
          {PERIOD_PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => handleSelectPreset(p.key)}
              className={`rounded-lg px-3 py-1 font-medium transition ${
                periodType === p.key
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {/* 2. Filter Bar */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 items-end">
          {periodType === 'custom' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Từ ngày</label>
                <input
                  type="date"
                  value={dateRange.from}
                  onChange={e => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                  className="input-field w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Đến ngày</label>
                <input
                  type="date"
                  value={dateRange.to}
                  onChange={e => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                  className="input-field w-full text-sm"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Trạng thái nợ</label>
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }}
              className="input-field w-full text-sm"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="overdue">Chỉ khách quá hạn (Chậm trả)</option>
              <option value="within_due">Nợ trong hạn</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Nhóm tuổi nợ</label>
            <select
              value={bucketFilter}
              onChange={e => { setBucketFilter(e.target.value); setCurrentPage(1); }}
              className="input-field w-full text-sm"
            >
              <option value="all">Tất cả nhóm tuổi nợ</option>
              <option value="bucket_0_15">0 - 15 ngày (Trong hạn)</option>
              <option value="bucket_16_30">16 - 30 ngày (Quá hạn nhẹ)</option>
              <option value="bucket_31_60">31 - 60 ngày (Cần nhắc nợ)</option>
              <option value="bucket_over_60">&gt; 60 ngày (Nguy cơ nợ xấu)</option>
            </select>
          </div>

          <div className="relative">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Tìm khách hàng / SĐT</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Nhập tên hoặc SĐT..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="input-field w-full pl-8 text-sm"
              />
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={loadReport}
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-1.5 text-sm py-2.5"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Làm mới
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle size={16} /> {error}
          </div>
        )}
      </section>

      {/* 3. KPI Cards Summary */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Tổng nợ phải thu */}
        <div className="relative overflow-hidden rounded-2xl border border-blue-200/80 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-blue-700">
            <span>Tổng công nợ phải thu</span>
            <Users size={18} className="text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-black text-blue-950">
            {loading ? '...' : formatVND(kpi?.total_receivable)}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-blue-600/90 font-medium">
            <span>{kpi?.debtor_customer_count || 0} khách hàng còn nợ</span>
            <span>·</span>
            <span>{kpi?.unpaid_invoices_count || 0} đơn chưa thanh toán</span>
          </div>
        </div>

        {/* Nợ quá hạn (Chậm thanh toán) */}
        <div className="relative overflow-hidden rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-amber-700">
            <span>Nợ quá hạn (Chậm thanh toán)</span>
            <Clock size={18} className="text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-black text-amber-950">
            {loading ? '...' : formatVND(kpi?.total_overdue)}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-amber-700 font-semibold">
            <span className="rounded-full bg-amber-100 px-2 py-0.5">
              Chiếm {kpi?.overdue_percentage || 0}% tổng nợ
            </span>
            <span>({kpi?.overdue_customer_count || 0} khách quá hạn)</span>
          </div>
        </div>

        {/* Rủi ro nợ xấu > 60 ngày */}
        <div className="relative overflow-hidden rounded-2xl border border-rose-200/80 bg-gradient-to-br from-rose-50 to-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-rose-700">
            <span>Nguy cơ nợ xấu (&gt; 60 ngày)</span>
            <ShieldAlert size={18} className="text-rose-500" />
          </div>
          <div className="mt-2 text-2xl font-black text-rose-950">
            {loading ? '...' : formatVND(kpi?.bad_debt_risk_amount)}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-rose-700 font-semibold">
            <span className="rounded-full bg-rose-100 px-2 py-0.5">
              Chiếm {kpi?.bad_debt_percentage || 0}%
            </span>
            <span>Cần có biện pháp thu hồi gấp</span>
          </div>
        </div>

        {/* Nợ trong hạn an toàn */}
        <div className="relative overflow-hidden rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-emerald-700">
            <span>Nợ trong hạn (0 - 15 ngày)</span>
            <CheckCircle2 size={18} className="text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-950">
            {loading ? '...' : formatVND(breakdown?.bucket_0_15?.amount)}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-emerald-700 font-semibold">
            <span className="rounded-full bg-emerald-100 px-2 py-0.5">
              Tỷ lệ {breakdown?.bucket_0_15?.percentage || 0}%
            </span>
            <span>Dòng tiền quay vòng tốt</span>
          </div>
        </div>
      </section>

      {/* 4. Thanh Phân Bổ 4 Nhóm Tuổi Nợ (Aging Distribution Bar) */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="font-bold text-gray-900 text-base">Phân Bổ Tuổi Nợ Khách Hàng (Chuẩn Kế Toán)</h2>
            <p className="text-xs text-gray-500">Bấm vào từng nhóm bên dưới để lọc nhanh danh sách khách hàng tương ứng.</p>
          </div>
          <div className="text-xs font-semibold text-gray-600 bg-gray-100 px-3 py-1 rounded-full self-start">
            Tổng cộng: {formatVND(kpi?.total_receivable)}
          </div>
        </div>

        {/* Thanh Progress Đa Màu */}
        <div className="h-4 w-full overflow-hidden rounded-full bg-gray-100 flex shadow-inner">
          <div
            style={{ width: `${breakdown?.bucket_0_15?.percentage || 0}%` }}
            className="bg-emerald-500 transition-all duration-500"
            title={`0 - 15 ngày: ${breakdown?.bucket_0_15?.percentage}%`}
          />
          <div
            style={{ width: `${breakdown?.bucket_16_30?.percentage || 0}%` }}
            className="bg-amber-400 transition-all duration-500"
            title={`16 - 30 ngày: ${breakdown?.bucket_16_30?.percentage}%`}
          />
          <div
            style={{ width: `${breakdown?.bucket_31_60?.percentage || 0}%` }}
            className="bg-orange-500 transition-all duration-500"
            title={`31 - 60 ngày: ${breakdown?.bucket_31_60?.percentage}%`}
          />
          <div
            style={{ width: `${breakdown?.bucket_over_60?.percentage || 0}%` }}
            className="bg-rose-600 transition-all duration-500"
            title={`Trên 60 ngày: ${breakdown?.bucket_over_60?.percentage}%`}
          />
        </div>

        {/* 4 Nhóm Cards */}
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {/* Nhóm 1: 0 - 15 ngày */}
          <button
            type="button"
            onClick={() => setBucketFilter(bucketFilter === 'bucket_0_15' ? 'all' : 'bucket_0_15')}
            className={`rounded-xl border p-3 text-left transition ${
              bucketFilter === 'bucket_0_15'
                ? 'border-emerald-500 bg-emerald-50/80 ring-2 ring-emerald-500/30'
                : 'border-gray-200 bg-gray-50/50 hover:bg-emerald-50/40'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              0 - 15 NGÀY (TRONG HẠN)
            </div>
            <div className="mt-1 text-base font-extrabold text-gray-900">
              {formatVND(breakdown?.bucket_0_15?.amount)}
            </div>
            <div className="text-xs text-gray-500">
              {breakdown?.bucket_0_15?.percentage || 0}% tổng nợ
            </div>
          </button>

          {/* Nhóm 2: 16 - 30 ngày */}
          <button
            type="button"
            onClick={() => setBucketFilter(bucketFilter === 'bucket_16_30' ? 'all' : 'bucket_16_30')}
            className={`rounded-xl border p-3 text-left transition ${
              bucketFilter === 'bucket_16_30'
                ? 'border-amber-500 bg-amber-50/80 ring-2 ring-amber-500/30'
                : 'border-gray-200 bg-gray-50/50 hover:bg-amber-50/40'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              16 - 30 NGÀY (QUÁ HẠN NHẸ)
            </div>
            <div className="mt-1 text-base font-extrabold text-gray-900">
              {formatVND(breakdown?.bucket_16_30?.amount)}
            </div>
            <div className="text-xs text-gray-500">
              {breakdown?.bucket_16_30?.percentage || 0}% tổng nợ
            </div>
          </button>

          {/* Nhóm 3: 31 - 60 ngày */}
          <button
            type="button"
            onClick={() => setBucketFilter(bucketFilter === 'bucket_31_60' ? 'all' : 'bucket_31_60')}
            className={`rounded-xl border p-3 text-left transition ${
              bucketFilter === 'bucket_31_60'
                ? 'border-orange-500 bg-orange-50/80 ring-2 ring-orange-500/30'
                : 'border-gray-200 bg-gray-50/50 hover:bg-orange-50/40'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-orange-700">
              <span className="h-2 w-2 rounded-full bg-orange-500" />
              31 - 60 NGÀY (CẦN NHẮC NỢ)
            </div>
            <div className="mt-1 text-base font-extrabold text-gray-900">
              {formatVND(breakdown?.bucket_31_60?.amount)}
            </div>
            <div className="text-xs text-gray-500">
              {breakdown?.bucket_31_60?.percentage || 0}% tổng nợ
            </div>
          </button>

          {/* Nhóm 4: > 60 ngày */}
          <button
            type="button"
            onClick={() => setBucketFilter(bucketFilter === 'bucket_over_60' ? 'all' : 'bucket_over_60')}
            className={`rounded-xl border p-3 text-left transition ${
              bucketFilter === 'bucket_over_60'
                ? 'border-rose-500 bg-rose-50/80 ring-2 ring-rose-500/30'
                : 'border-gray-200 bg-gray-50/50 hover:bg-rose-50/40'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-rose-700">
              <span className="h-2 w-2 rounded-full bg-rose-600" />
              &gt; 60 NGÀY (RỦI RO NỢ XẤU)
            </div>
            <div className="mt-1 text-base font-extrabold text-gray-900">
              {formatVND(breakdown?.bucket_over_60?.amount)}
            </div>
            <div className="text-xs text-gray-500">
              {breakdown?.bucket_over_60?.percentage || 0}% tổng nợ
            </div>
          </button>
        </div>
      </section>

      {/* 5. Main Table Tabs & Content */}
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* Tab Navigation */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 pt-3">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setViewMode('customers')}
              className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
                viewMode === 'customers'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <Users size={16} />
              Tổng Hợp Theo Khách Hàng ({filteredCustomers.length})
            </button>
            <button
              type="button"
              onClick={() => setViewMode('invoices')}
              className={`pb-3 text-sm font-bold transition border-b-2 flex items-center gap-2 ${
                viewMode === 'invoices'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              <FileText size={16} />
              Chi Tiết Hóa Đơn Nợ ({invoices.length})
            </button>
          </div>
          <div className="text-xs text-gray-400 pb-2 hidden sm:block">
            Mẫu biểu chuẩn kế toán doanh nghiệp
          </div>
        </div>

        {/* Tab 1: Tổng hợp khách hàng */}
        {viewMode === 'customers' && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm divide-y divide-gray-200">
              <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wider text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-center w-12">STT</th>
                  <th className="px-4 py-3 text-left">Khách hàng</th>
                  <th className="px-4 py-3 text-right">Tổng còn nợ</th>
                  <th className="px-4 py-3 text-right text-emerald-700">0 - 15 ngày</th>
                  <th className="px-4 py-3 text-right text-amber-700">16 - 30 ngày</th>
                  <th className="px-4 py-3 text-right text-orange-700">31 - 60 ngày</th>
                  <th className="px-4 py-3 text-right text-rose-700">&gt; 60 ngày</th>
                  <th className="px-4 py-3 text-center">Tuổi nợ max</th>
                  <th className="px-4 py-3 text-center">Rủi ro</th>
                  <th className="px-4 py-3 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 size={18} className="animate-spin text-indigo-600" />
                        Đang trích xuất dữ liệu tuổi nợ...
                      </div>
                    </td>
                  </tr>
                ) : filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                      Không có khách hàng nào còn nợ trong kỳ được chọn.
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((c, idx) => {
                    const riskBadge = {
                      critical: 'bg-rose-100 text-rose-700 border-rose-200',
                      high: 'bg-orange-100 text-orange-700 border-orange-200',
                      medium: 'bg-amber-100 text-amber-700 border-amber-200',
                      low: 'bg-emerald-100 text-emerald-700 border-emerald-200',
                    }[c.risk_level] || 'bg-gray-100 text-gray-700';

                    const riskLabel = {
                      critical: 'Rất cao',
                      high: 'Cao',
                      medium: 'Trung bình',
                      low: 'Thấp',
                    }[c.risk_level] || 'Bình thường';

                    return (
                      <tr key={c.customer_id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-center text-gray-400 font-medium">
                          {idx + 1}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-gray-900">{c.customer_name}</div>
                          {c.customer_phone && (
                            <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                              <Phone size={11} /> {c.customer_phone}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-extrabold text-blue-900">
                          {formatVND(c.total_remaining_debt)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-emerald-700">
                          {c.bucket_0_15 > 0 ? formatVND(c.bucket_0_15) : '-'}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-amber-700">
                          {c.bucket_16_30 > 0 ? formatVND(c.bucket_16_30) : '-'}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-orange-700">
                          {c.bucket_31_60 > 0 ? formatVND(c.bucket_31_60) : '-'}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-rose-700">
                          {c.bucket_over_60 > 0 ? formatVND(c.bucket_over_60) : '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="font-bold text-gray-800">{c.max_debt_days}</span> ngày
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold ${riskBadge}`}>
                            {riskLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenCustomerDetail(c.customer_id)}
                              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-indigo-600 transition"
                              title="Xem sổ chi tiết hóa đơn của khách"
                            >
                              Sổ chi tiết
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenReminderModal(c)}
                              className="rounded-lg bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-600 hover:text-white transition flex items-center gap-1"
                              title="Tự động soạn tin nhắn nhắc nợ Zalo/SMS bằng AI"
                            >
                              <Sparkles size={12} /> Nhắc nợ
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: Chi tiết từng hóa đơn nợ */}
        {viewMode === 'invoices' && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm divide-y divide-gray-200">
              <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wider text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left">Mã hóa đơn</th>
                  <th className="px-4 py-3 text-left">Ngày mua</th>
                  <th className="px-4 py-3 text-left">Khách hàng</th>
                  <th className="px-4 py-3 text-right">Tổng tiền</th>
                  <th className="px-4 py-3 text-right">Đã trả</th>
                  <th className="px-4 py-3 text-right">Còn nợ</th>
                  <th className="px-4 py-3 text-center">Tuổi nợ</th>
                  <th className="px-4 py-3 text-center">Quá hạn</th>
                  <th className="px-4 py-3 text-center">Trạng thái</th>
                  <th className="px-4 py-3 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 size={18} className="animate-spin text-indigo-600" />
                        Đang nạp danh sách hóa đơn nợ...
                      </div>
                    </td>
                  </tr>
                ) : invoices.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                      Không có hóa đơn nợ nào trong khoảng lọc này.
                    </td>
                  </tr>
                ) : (
                  invoices.map((inv) => {
                    const statusTag = {
                      overdue: 'bg-rose-100 text-rose-700',
                      within_due: 'bg-emerald-100 text-emerald-700',
                      paid: 'bg-gray-100 text-gray-600',
                    }[inv.aging_status] || 'bg-amber-100 text-amber-700';

                    const statusText = {
                      overdue: 'Quá hạn',
                      within_due: 'Trong hạn',
                      paid: 'Đã thanh toán',
                    }[inv.aging_status] || 'Chưa trả';

                    return (
                      <tr key={inv.invoice_id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 font-mono font-bold text-indigo-600">
                          {inv.invoice_code}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {inv.invoice_date}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-gray-900">{inv.customer_name}</div>
                          {inv.customer_phone && (
                            <div className="text-xs text-gray-500">{inv.customer_phone}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-700">
                          {formatVND(inv.total_amount)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          {formatVND(inv.paid_amount)}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-rose-700">
                          {formatVND(inv.remaining_amount)}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-gray-700">
                          {inv.debt_age_days} ngày
                        </td>
                        <td className="px-4 py-3 text-center">
                          {inv.days_overdue > 0 ? (
                            <span className="font-bold text-rose-600">+{inv.days_overdue} ngày</span>
                          ) : (
                            <span className="text-emerald-600 text-xs font-semibold">Đúng hạn</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold ${statusTag}`}>
                            {statusText}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              const foundCust = customers.find(c => c.customer_id === inv.customer_id) || {
                                customer_id: inv.customer_id,
                                customer_name: inv.customer_name,
                                customer_phone: inv.customer_phone,
                                total_remaining_debt: inv.remaining_amount,
                                max_debt_days: inv.debt_age_days,
                              };
                              handleOpenReminderModal(foundCust, inv);
                            }}
                            className="rounded-lg bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-600 hover:text-white transition"
                          >
                            Nhắc đơn này
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ============================================================ */}
      {/* 6. DRAWER TRỢ LÝ KẾ TOÁN AI (PANEL BÊN PHẢI)                  */}
      {/* ============================================================ */}
      {showAiDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm transition-opacity">
          <div className="h-full w-full max-w-2xl bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 bg-gradient-to-r from-slate-900 to-indigo-950 text-white">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-indigo-500/20 p-2 text-indigo-300">
                  <Bot size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-base flex items-center gap-2">
                    Trợ Lý AI Thông Minh
                    <span className="rounded-full bg-indigo-500/30 px-2 py-0.5 text-[10px] font-semibold text-indigo-200 uppercase">
                      Gemini AI
                    </span>
                  </h3>
                  <p className="text-xs text-indigo-200/70">
                    Hỏi đáp đa năng như ChatGPT/Gemini &amp; Phân tích số liệu thực tế
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAiDrawer(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white transition"
              >
                <X size={20} />
              </button>
            </div>

            {/* Sub-tabs AI */}
            <div className="flex border-b border-gray-200 bg-gray-50 px-5">
              <button
                type="button"
                onClick={() => setAiActiveTab('analyze')}
                className={`py-3 px-4 text-xs font-bold border-b-2 flex items-center gap-2 transition ${
                  aiActiveTab === 'analyze'
                    ? 'border-indigo-600 text-indigo-600 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                <Sparkles size={15} /> 1. Báo Cáo Sức Khỏe & Cảnh Báo Nợ Xấu
              </button>
              <button
                type="button"
                onClick={() => setAiActiveTab('chat')}
                className={`py-3 px-4 text-xs font-bold border-b-2 flex items-center gap-2 transition ${
                  aiActiveTab === 'chat'
                    ? 'border-indigo-600 text-indigo-600 bg-white'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                <MessageSquare size={15} /> 2. Hỏi Đáp Trợ Lý AI
              </button>
            </div>

            {/* Nội dung Tab AI */}
            <div className="flex-1 overflow-y-auto p-5">
              {aiActiveTab === 'analyze' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-gray-900 text-sm">Nhận định & Giải pháp thu hồi dòng tiền</h4>
                      <p className="text-xs text-gray-500">Dựa trên dữ liệu kỳ: {reportData?.filter_period?.from} đến {reportData?.filter_period?.to}</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRunAiAnalysis}
                      disabled={analyzingAi}
                      className="btn-primary flex items-center gap-1.5 text-xs py-2 px-3"
                    >
                      {analyzingAi ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      Phân tích lại
                    </button>
                  </div>

                  {analyzingAi ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                      <Loader2 size={36} className="animate-spin text-indigo-600" />
                      <div className="font-bold text-gray-800">Trợ lý AI đang đọc số liệu kế toán...</div>
                      <p className="text-xs text-gray-500 max-w-xs">
                        Đang phân tích tỷ lệ quá hạn, lọc danh sách rủi ro và xây dựng 3 bước hành động khẩn cấp.
                      </p>
                    </div>
                  ) : aiAnalysis ? (
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-3">
                      <div className="flex items-center justify-between text-xs text-indigo-800 font-semibold border-b border-indigo-100 pb-2">
                        <span>Mô hình: {aiAnalysis.model_used}</span>
                        <span>Thời gian: {new Date(aiAnalysis.generated_at).toLocaleTimeString('vi-VN')}</span>
                      </div>
                      <div className="prose prose-sm max-w-none text-gray-800 whitespace-pre-line leading-relaxed font-sans text-sm">
                        {aiAnalysis.analysis}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center space-y-3">
                      <Bot size={40} className="mx-auto text-gray-400" />
                      <div className="font-bold text-gray-700">Chưa có phân tích sức khỏe tài chính</div>
                      <p className="text-xs text-gray-500 max-w-sm mx-auto">
                        Bấm nút bên dưới để trợ lý Google Gemini quét toàn bộ các khoản nợ và đưa ra đề xuất cho bạn.
                      </p>
                      <button
                        type="button"
                        onClick={handleRunAiAnalysis}
                        className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-2"
                      >
                        <Sparkles size={14} /> Chạy phân tích AI ngay
                      </button>
                    </div>
                  )}
                </div>
              )}

              {aiActiveTab === 'chat' && (
                <div className="flex flex-col h-full">
                  {/* Action Bar for Chat */}
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-100">
                    <span className="text-[11px] text-gray-400">Lịch sử chat được lưu tự động trên máy</span>
                    <button
                      type="button"
                      onClick={handleClearChatHistory}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-rose-600 transition"
                      title="Xóa toàn bộ lịch sử chat"
                    >
                      <Trash2 size={12} /> Xóa lịch sử
                    </button>
                  </div>

                  {/* Chat Message List */}
                  <div ref={chatScrollRef} className="flex-1 space-y-3 overflow-y-auto pr-1 min-h-[360px]">
                    {chatMessages.length === 0 ? (
                      <div className="text-center py-8 space-y-3">
                        <Bot size={36} className="mx-auto text-indigo-400" />
                        <div className="font-bold text-gray-800 text-sm">Chào bạn! Tôi là Trợ lý Kế toán ảo.</div>
                        <p className="text-xs text-gray-500 max-w-xs mx-auto">
                          Bạn có thể hỏi tôi bất kỳ điều gì về công nợ, khách hàng chậm thanh toán hoặc giải pháp thu hồi tiền:
                        </p>
                        <div className="flex flex-col gap-1.5 max-w-sm mx-auto text-left pt-2">
                          <button
                            type="button"
                            onClick={() => handleSendChatMessage('trích xuất dữ liệu hóa đơn')}
                            className="text-xs font-semibold rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-indigo-800 hover:bg-indigo-100 transition"
                          >
                            👉 📊 Trích xuất dữ liệu chi tiết từng hóa đơn
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSendChatMessage('Khách hàng nào đang có nợ quá hạn lớn nhất?')}
                            className="text-xs rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition"
                          >
                            👉 Khách hàng nào đang có nợ quá hạn lớn nhất?
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSendChatMessage('Tỷ lệ nợ quá hạn của quán hiện tại có nguy hiểm không?')}
                            className="text-xs rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition"
                          >
                            👉 Tỷ lệ nợ quá hạn của quán hiện tại có nguy hiểm không?
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSendChatMessage('Gợi ý cho tôi kế hoạch đòi nợ tuần này để dòng tiền an toàn?')}
                            className="text-xs rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition"
                          >
                            👉 Gợi ý kế hoạch đòi nợ tuần này để dòng tiền an toàn?
                          </button>
                        </div>
                      </div>
                    ) : (
                      chatMessages.map((msg, i) => (
                        <div
                          key={i}
                          className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                        >
                          <div
                            className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                              msg.role === 'user'
                                ? 'bg-indigo-600 text-white rounded-br-none'
                                : msg.isError
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : 'bg-gray-100 text-gray-800 rounded-bl-none border border-gray-200 whitespace-pre-line'
                            }`}
                          >
                            {msg.text}
                          </div>
                          {msg.time && (
                            <span className="text-[10px] text-gray-400 mt-1 px-1">{msg.time}</span>
                          )}
                        </div>
                      ))
                    )}
                    {chatLoading && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 italic">
                        <Loader2 size={14} className="animate-spin text-indigo-600" />
                        Trợ lý AI đang tra cứu số liệu và soạn câu trả lời...
                      </div>
                    )}
                  </div>

                  {/* Chat Input */}
                  <div className="mt-4 border-t border-gray-200 pt-3">
                    <form
                      onSubmit={e => {
                        e.preventDefault();
                        handleSendChatMessage();
                      }}
                      className="flex gap-2"
                    >
                      <input
                        type="text"
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        placeholder="Hỏi về nợ xấu, khách chậm thanh toán..."
                        disabled={chatLoading}
                        className="input-field flex-1 text-sm"
                      />
                      <button
                        type="submit"
                        disabled={chatLoading || !chatInput.trim()}
                        className="btn-primary px-4 flex items-center justify-center disabled:opacity-50"
                      >
                        <Send size={16} />
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 7. MODAL SOẠN TIN NHẮN NHẮC NỢ KHÉO LÉO                    */}
      {/* ============================================================ */}
      {reminderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl overflow-hidden border border-gray-200 animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 bg-gradient-to-r from-slate-900 to-indigo-900 text-white">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-indigo-500/20 p-2 text-indigo-300">
                  <MessageCircle size={22} />
                </div>
                <div>
                  <h3 className="font-bold text-base">Soạn Tin Nhắn Nhắc Nợ Thông Minh</h3>
                  <p className="text-xs text-indigo-200/80">
                    Khách: {reminderModal.customer?.customer_name} ({reminderModal.customer?.customer_phone || 'Không có SĐT'})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReminderModal(null)}
                className="text-gray-400 hover:text-white transition"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Chọn Phong Cách */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">
                  Phong cách tin nhắn:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleRegenerateReminder('gentle', reminderModal.notes)}
                    className={`rounded-xl border p-2.5 text-xs font-bold text-center transition ${
                      reminderModal.style === 'gentle'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-500/20'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    🌸 Nhẹ nhàng, lịch sự
                    <div className="text-[10px] font-normal text-gray-500 mt-0.5">Khách quen, nợ mới</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRegenerateReminder('professional', reminderModal.notes)}
                    className={`rounded-xl border p-2.5 text-xs font-bold text-center transition ${
                      reminderModal.style === 'professional'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-500/20'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    👔 Chuẩn mực kế toán
                    <div className="text-[10px] font-normal text-gray-500 mt-0.5">Rõ ràng mã đơn & STK</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRegenerateReminder('firm', reminderModal.notes)}
                    className={`rounded-xl border p-2.5 text-xs font-bold text-center transition ${
                      reminderModal.style === 'firm'
                        ? 'border-rose-600 bg-rose-50 text-rose-700 ring-2 ring-rose-500/20'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    ⚠️ Dứt khoát, hẹn ngày
                    <div className="text-[10px] font-normal text-gray-500 mt-0.5">Nợ lâu quá 30 ngày</div>
                  </button>
                </div>
              </div>

              {/* Ghi chú thêm từ chủ quán */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Ghi chú riêng cho AI (tùy chọn):
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={reminderModal.notes}
                    onChange={e => setReminderModal(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="VD: Nhắc hẹn trả trước ngày 15, giảm 2% nếu trả ngay..."
                    className="input-field text-xs flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => handleRegenerateReminder(reminderModal.style, reminderModal.notes)}
                    disabled={reminderModal.loading}
                    className="btn-secondary text-xs px-3"
                  >
                    Cập nhật
                  </button>
                </div>
              </div>

              {/* Khung nội dung tin nhắn */}
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-gray-600 mb-1.5">
                  <span>Nội dung tin nhắn (Đã bao gồm STK shop):</span>
                  {reminderModal.loading && (
                    <span className="flex items-center gap-1 text-indigo-600">
                      <Loader2 size={12} className="animate-spin" /> Đang soạn bằng Gemini...
                    </span>
                  )}
                </div>
                <textarea
                  rows={8}
                  value={reminderModal.message}
                  onChange={e => setReminderModal(prev => ({ ...prev, message: e.target.value }))}
                  className="input-field w-full text-sm font-sans p-3 leading-relaxed"
                  placeholder="Nội dung tin nhắn..."
                />
              </div>

              {/* Nút hành động */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100">
                <div className="text-xs text-gray-500">
                  Số tiền nợ: <strong className="text-rose-600">{formatVND(reminderModal.customer?.total_remaining_debt)}</strong>
                </div>
                <div className="flex gap-2">
                  {reminderModal.customer?.customer_phone && (
                    <a
                      href={`https://zalo.me/${reminderModal.customer.customer_phone.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 transition"
                    >
                      <ExternalLink size={13} /> Mở Zalo
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={handleCopyReminder}
                    className="btn-primary inline-flex items-center gap-1.5 text-xs px-4 py-2"
                  >
                    {reminderModal.copied ? <Check size={14} /> : <Copy size={14} />}
                    {reminderModal.copied ? 'Đã sao chép!' : '1-Click Sao chép tin nhắn'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 8. MODAL SỔ CHI TIẾT CÔNG NỢ 1 KHÁCH HÀNG                   */}
      {/* ============================================================ */}
      {customerDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl overflow-hidden border border-gray-200 animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 bg-slate-900 text-white">
              <div>
                <h3 className="font-bold text-base">
                  Sổ Chi Tiết Công Nợ - {customerDetailModal.data?.customer?.customer_name || 'Khách hàng'}
                </h3>
                <p className="text-xs text-slate-300">
                  Tổng còn nợ: {formatVND(customerDetailModal.data?.customer?.total_remaining_debt)} · SĐT: {customerDetailModal.data?.customer?.customer_phone || 'n/a'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCustomerDetailModal(null)}
                className="text-gray-400 hover:text-white transition"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {customerDetailLoading ? (
                <div className="py-12 text-center text-gray-500">
                  <Loader2 size={24} className="animate-spin mx-auto text-indigo-600 mb-2" />
                  Đang tải hóa đơn...
                </div>
              ) : customerDetailModal.data?.invoices?.length === 0 ? (
                <div className="py-12 text-center text-gray-400">
                  Khách hàng này hiện không còn hóa đơn nợ nào.
                </div>
              ) : (
                <table className="min-w-full text-sm divide-y divide-gray-200">
                  <thead className="bg-gray-50 text-xs font-bold text-gray-600 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Mã hóa đơn</th>
                      <th className="px-3 py-2 text-left">Ngày mua</th>
                      <th className="px-3 py-2 text-right">Tổng tiền</th>
                      <th className="px-3 py-2 text-right">Đã trả</th>
                      <th className="px-3 py-2 text-right">Còn nợ</th>
                      <th className="px-3 py-2 text-center">Tuổi nợ</th>
                      <th className="px-3 py-2 text-center">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {customerDetailModal.data?.invoices?.map((inv) => (
                      <tr key={inv.invoice_id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono font-bold text-indigo-600">{inv.invoice_code}</td>
                        <td className="px-3 py-2 text-gray-600">{inv.invoice_date}</td>
                        <td className="px-3 py-2 text-right">{formatVND(inv.total_amount)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{formatVND(inv.paid_amount)}</td>
                        <td className="px-3 py-2 text-right font-bold text-rose-700">{formatVND(inv.remaining_amount)}</td>
                        <td className="px-3 py-2 text-center font-medium">{inv.debt_age_days} ngày</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                            inv.aging_status === 'overdue' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {inv.aging_status === 'overdue' ? 'Quá hạn' : 'Trong hạn'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="border-t border-gray-200 px-6 py-3 bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={() => setCustomerDetailModal(null)}
                className="btn-secondary text-xs px-4 py-2"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 9. MODAL CẤU HÌNH GEMINI API KEY NHANH                       */}
      {/* ============================================================ */}
      {showAiConfigModal && (
        <GeminiConfigModal
          currentConfig={aiConfig}
          onClose={() => setShowAiConfigModal(false)}
          onSaved={(newCfg) => {
            setAiConfig(newCfg);
            setShowAiConfigModal(false);
          }}
        />
      )}
    </div>
  );
}

// Modal Cấu hình Gemini Key
function GeminiConfigModal({ currentConfig, onClose, onSaved }) {
  const [apiKey, setApiKey] = useState(currentConfig?.apiKey || '');
  const [model, setModel] = useState(currentConfig?.model || 'gemini-3.5-flash-lite');
  const [temperature, setTemperature] = useState(currentConfig?.temperature ?? 0.2);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleTestConnection = async () => {
    if (!apiKey) {
      alert('Vui lòng nhập API Key để kiểm tra.');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await accountingApi.ai.testConnection({ apiKey, model });
      setTestResult(res);
    } catch (err) {
      setTestResult({ ok: false, error: getApiErrorMessage(err, 'Kiểm tra kết nối thất bại.') });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await accountingApi.ai.saveConfig({ apiKey, model, temperature: Number(temperature) });
      if (res && res.ok) {
        onSaved(res.config);
      } else {
        alert(res?.error || 'Lỗi khi lưu cấu hình.');
      }
    } catch (err) {
      alert(getApiErrorMessage(err, 'Lỗi lưu cấu hình Gemini AI.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden border border-gray-200 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <Key size={20} className="text-indigo-400" />
            <h3 className="font-bold text-base">Cấu hình Google Gemini AI Key</h3>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
              Google Gemini API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Nhập AIzaSy..."
              className="input-field w-full font-mono text-sm"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Lấy API Key miễn phí tại:{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-600 underline font-semibold"
              >
                Google AI Studio (aistudio.google.com)
              </a>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                Model AI
              </label>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className="input-field w-full text-sm"
              >
                <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite (Khuyên dùng · Siêu tốc & Ổn định nhất)</option>
                <option value="gemini-flash-lite-latest">Gemini Flash Lite (Mới nhất · Tối ưu hạn mức)</option>
                <option value="gemini-3.8-flash">Gemini 3.8 Flash (Thế hệ mới nhất 2026)</option>
                <option value="gemini-3.6-flash">Gemini 3.6 Flash (Tối ưu Pro)</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (Bản tiêu chuẩn)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                Độ sáng tạo (Temperature: {temperature})
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value))}
                className="w-full mt-2"
              />
            </div>
          </div>

          {/* Test connection result */}
          {testResult && (
            <div
              className={`rounded-xl border p-3 text-xs ${
                testResult.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <div className="font-bold flex items-center gap-1.5">
                {testResult.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                {testResult.ok ? 'Kết nối thành công!' : 'Kết nối thất bại:'}
              </div>
              <div className="mt-1">{testResult.sampleReply || testResult.error}</div>
            </div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing || !apiKey}
              className="btn-secondary text-xs px-3.5 py-2 flex items-center gap-1.5"
            >
              {testing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Kiểm tra kết nối
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn-secondary text-xs px-3.5 py-2">
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn-primary text-xs px-4 py-2 flex items-center gap-1.5"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Lưu cấu hình
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
