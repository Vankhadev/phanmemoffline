import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  HelpCircle,
  Key,
  Layers,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  ShieldCheck,
  Sliders,
  Sparkles,
  Zap,
} from 'lucide-react';
import { accountingApi, getApiErrorMessage } from '../utils/apiClient';

const SUPPORTED_MODELS = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    tag: 'Khuyên dùng · Thế hệ mới 2026',
    desc: 'Phiên bản mới nhất của Google AI, thông minh vượt trội, hiểu ngữ cảnh nhạy bén, đàm thoại tự nhiên như ChatGPT/Gemini.',
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    tag: 'Siêu tốc & Thông minh',
    desc: 'Tốc độ phản hồi cực nhanh, hỗ trợ trò chuyện tự nhiên và trích xuất dữ liệu chuẩn xác.',
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    tag: 'Tiêu chuẩn ổn định',
    desc: 'Mô hình tiêu chuẩn toàn cầu của Google AI, tối ưu tốc độ và chi phí, vận hành mượt mà.',
    badgeColor: 'bg-teal-50 text-teal-700 border-teal-200',
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    tag: 'Tối ưu Pro · Chuyên sâu',
    desc: 'Mô hình suy luận cao cấp của Google AI, phân tích báo cáo tài chính phức tạp và giải đáp chuyên sâu.',
    badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    tag: 'Bản siêu nhẹ',
    desc: 'Tốc độ phản hồi tức thì, hoạt động mượt mà cho các tác vụ hỏi đáp nhanh.',
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  {
    id: 'gemini-flash-latest',
    name: 'Gemini Flash (Mới nhất)',
    tag: 'Tự động cập nhật',
    desc: 'Luôn sử dụng phiên bản Flash mới nhất do Google AI phát hành.',
    badgeColor: 'bg-slate-50 text-slate-700 border-slate-200',
  },
];

export default function GeminiAccountingSettingsPanel() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState(null); // { type: 'success' | 'error', message }
  const [testResult, setTestResult] = useState(null);

  // Form states
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [temperature, setTemperature] = useState(0.7);

  // Load cấu hình hiện tại từ backend
  const loadConfig = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await accountingApi.ai.getConfig();
      if (res && res.ok && res.config) {
        setConfig(res.config);
        setSelectedModel(res.config.model || 'gemini-3.5-flash-lite');
        setTemperature(res.config.temperature ?? 0.2);
        // Nếu đã có key thì để trống input (hiển thị masked placeholder)
        setApiKeyInput('');
      }
    } catch (err) {
      setNotice({
        type: 'error',
        message: getApiErrorMessage(err, 'Không thể tải cấu hình Google Gemini AI.'),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Kiểm tra kết nối tới Google Gemini
  const handleTestConnection = async () => {
    const keyToTest = apiKeyInput.trim() || config?.apiKey;
    if (!keyToTest) {
      setNotice({
        type: 'error',
        message: 'Vui lòng nhập Google Gemini API Key trước khi kiểm tra kết nối.',
      });
      return;
    }

    setTesting(true);
    setTestResult(null);
    setNotice(null);

    try {
      const res = await accountingApi.ai.testConnection({
        apiKey: keyToTest,
        model: selectedModel,
      });

      if (res && res.ok) {
        setTestResult(res);
        setNotice({
          type: 'success',
          message: `Kết nối thành công tới ${res.model}! Google Gemini phản hồi: "${res.sampleReply}"`,
        });
      } else {
        setNotice({
          type: 'error',
          message: res?.error || 'Kiểm tra kết nối thất bại.',
        });
      }
    } catch (err) {
      setNotice({
        type: 'error',
        message: getApiErrorMessage(err, 'Không thể kết nối tới máy chủ Google Gemini. Vui lòng kiểm tra lại API Key.'),
      });
    } finally {
      setTesting(false);
    }
  };

  // Lưu cấu hình
  const handleSaveConfig = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    setNotice(null);

    try {
      const payload = {
        model: selectedModel,
        temperature: Number(temperature),
      };
      if (apiKeyInput.trim()) {
        payload.apiKey = apiKeyInput.trim();
      }

      const res = await accountingApi.ai.saveConfig(payload);
      if (res && res.ok) {
        setConfig(res.config);
        setApiKeyInput('');
        setNotice({
          type: 'success',
          message: 'Đã lưu cấu hình Google Gemini AI thành công! Hệ thống sẵn sàng phân tích công nợ.',
        });
      } else {
        setNotice({
          type: 'error',
          message: res?.error || 'Lỗi khi lưu cấu hình.',
        });
      }
    } catch (err) {
      setNotice({
        type: 'error',
        message: getApiErrorMessage(err, 'Lỗi lưu cấu hình Gemini AI.'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Banner */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white shadow-md">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl border border-indigo-400/30 bg-indigo-500/20 p-3.5 shadow-inner">
              <Sparkles size={28} className="text-indigo-300 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-indigo-500/30 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-indigo-300">
                  Google Gemini AI Engine
                </span>
                {config?.isConfigured ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                    <CheckCircle2 size={12} /> {config?.isBuiltinKey ? 'Đã tích hợp sẵn bản quyền' : 'Đã kích hoạt'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                    <AlertCircle size={12} /> Chưa nhập Key
                  </span>
                )}
              </div>
              <h2 className="mt-1.5 text-xl font-bold">Cấu hình Trí Tuệ Nhân Tạo Google Gemini AI (Chatbot Đa Năng)</h2>
              <p className="mt-1 max-w-2xl text-xs text-indigo-200/80 leading-relaxed">
                Tích hợp Google Gemini API Key để kích hoạt Chatbot AI toàn năng như ChatGPT/Gemini: Hỏi đáp tự do mọi chủ đề,
                tra cứu số liệu cửa hàng thời gian thực (doanh thu, đơn hàng, tồn kho, công nợ, sổ quỹ) và tư vấn kinh doanh 24/7.
              </p>
            </div>
          </div>

          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-2.5 text-xs font-bold text-white shadow hover:from-indigo-600 hover:to-purple-700 transition self-start md:self-center"
          >
            <Key size={14} /> Lấy API Key miễn phí <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {/* Notice Message */}
      {notice && (
        <div
          className={`flex items-start gap-3 rounded-xl border p-4 text-sm font-medium ${
            notice.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {notice.type === 'success' ? (
            <CheckCircle2 size={18} className="shrink-0 text-emerald-600 mt-0.5" />
          ) : (
            <AlertTriangle size={18} className="shrink-0 text-red-600 mt-0.5" />
          )}
          <div className="flex-1">{notice.message}</div>
        </div>
      )}

      {loading ? (
        <div className="card flex min-h-[220px] items-center justify-center">
          <div className="flex items-center gap-3 text-gray-500 text-sm">
            <Loader2 size={18} className="animate-spin text-indigo-600" />
            Đang tải cấu hình AI...
          </div>
        </div>
      ) : (
        <form onSubmit={handleSaveConfig} className="space-y-6">
          {/* 2. Cấu hình API Key */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <Key size={18} className="text-indigo-600" />
                <h3 className="font-bold text-gray-900 text-base">Khóa API Google Gemini</h3>
              </div>
              {config?.maskedKey && (
                <span className="text-xs text-gray-500 font-mono">
                  {config?.isBuiltinKey ? 'Khóa tích hợp sẵn: ' : 'Đang dùng: '}<strong>{config.maskedKey}</strong>
                </span>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
                Google Gemini API Key (Tùy chọn nếu muốn đổi)
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={e => setApiKeyInput(e.target.value)}
                  placeholder={config?.isConfigured ? '•••••••••••••••••••••••••••••••• (Đã có khóa tích hợp sẵn, để trống nếu không muốn đổi key)' : 'Nhập API key...'}
                  className="input-field w-full font-mono text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  title={showKey ? 'Ẩn' : 'Hiện'}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {config?.isBuiltinKey ? (
                <div className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 flex items-center gap-2">
                  <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
                  <span>Phần mềm đã tích hợp sẵn khóa bản quyền Google Gemini. Khách chỉ cần cập nhật phiên bản mới là sử dụng được ngay mà không cần lấy hay nhập key.</span>
                </div>
              ) : (
                <p className="mt-1.5 text-xs text-gray-500">
                  Key được lưu trữ an toàn trong cơ sở dữ liệu nội bộ của hệ thống và chỉ gọi trực tiếp tới máy chủ Google Generative Language.
                </p>
              )}
            </div>
          </div>

          {/* 3. Lựa chọn Model & Temperature */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
              <Sliders size={18} className="text-indigo-600" />
              <h3 className="font-bold text-gray-900 text-base">Lựa chọn Mô hình (Model) & Độ chính xác</h3>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-3">
                Chọn Model AI phục vụ Kế toán:
              </label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {SUPPORTED_MODELS.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedModel(m.id)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      selectedModel === m.id
                        ? 'border-indigo-600 bg-indigo-50/70 shadow-sm ring-2 ring-indigo-500/20'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-gray-900 text-sm">{m.name}</div>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${m.badgeColor}`}>
                        {m.tag}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-gray-500 leading-relaxed">{m.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-700">
                  Độ sáng tạo câu trả lời (Temperature: {temperature})
                </label>
                <span className="text-xs text-gray-500">
                  {temperature <= 0.2 ? 'Chuẩn mực kế toán (Độ chính xác cao nhất)' : 'Linh hoạt hơn'}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg cursor-pointer accent-indigo-600"
              />
              <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                <span>0.0 (Chính xác số liệu 100%)</span>
                <span>0.2 (Khuyên dùng cho Kế toán)</span>
                <span>1.0 (Sáng tạo)</span>
              </div>
            </div>
          </div>

          {/* 4. Hành động Kiểm tra kết nối & Lưu */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing || (!apiKeyInput.trim() && !config?.isConfigured)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 shadow-sm transition"
            >
              {testing ? <Loader2 size={16} className="animate-spin text-indigo-600" /> : <RefreshCw size={16} />}
              {testing ? 'Đang kiểm tra kết nối...' : 'Kiểm tra kết nối AI'}
            </button>

            <button
              type="submit"
              disabled={saving}
              className="btn-primary inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-bold shadow-md disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? 'Đang lưu...' : 'Lưu cấu hình Gemini AI'}
            </button>
          </div>

          {/* 5. Hướng dẫn lấy API Key */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5 space-y-2 text-xs text-blue-900">
            <div className="flex items-center gap-2 font-bold text-sm text-blue-950">
              <HelpCircle size={16} className="text-blue-600" /> Hướng dẫn lấy Google Gemini API Key miễn phí trong 1 phút:
            </div>
            <ol className="list-decimal pl-5 space-y-1 text-blue-800 leading-relaxed">
              <li>Truy cập trang Google AI Studio tại địa chỉ: <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="font-bold underline text-blue-900">aistudio.google.com/app/apikey</a></li>
              <li>Đăng nhập bằng tài khoản Google (Gmail) của bạn.</li>
              <li>Bấm nút <strong>"Create API key"</strong> và chọn hoặc tạo mới một Google Cloud Project (hoàn toàn miễn phí).</li>
              <li>Sao chép chuỗi mã API Key (bắt đầu bằng <code>AIzaSy...</code>), dán vào ô bên trên và bấm <strong>"Kiểm tra kết nối AI"</strong> rồi <strong>"Lưu cấu hình"</strong>.</li>
            </ol>
          </div>
        </form>
      )}
    </div>
  );
}
