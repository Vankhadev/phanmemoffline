import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare,
  X,
  Send,
  Loader2,
  Sparkles,
  Bot,
  Trash2,
  Maximize2,
  Minimize2,
  Settings,
  Key,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Eye,
  EyeOff,
  Save,
  RefreshCw,
  Zap,
  Image as ImageIcon,
} from 'lucide-react';
import { accountingApi, getApiErrorMessage } from '../utils/apiClient';
import {
  loadStoredChatMessages,
  saveStoredChatMessages,
  clearStoredChatMessages,
  AI_CHAT_UPDATED_EVENT,
} from '../utils/aiChatStorage';

/**
 * Nén và đổi kích thước ảnh trước khi tải lên hoặc lưu lịch sử
 * Giúp gửi siêu nhanh, tiết kiệm bộ nhớ và tối ưu cho Gemini Vision OCR
 */
async function processAndCompressImage(file, maxWidth = 1280, maxHeight = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('Không tìm thấy file ảnh'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc file ảnh'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Không thể tải dữ liệu ảnh'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const approxSizeKb = Math.round((dataUrl.length * 3) / 4 / 1024);
        resolve({
          dataUrl,
          name: file.name || 'Ảnh chụp (Ctrl+V)',
          sizeKb: approxSizeKb,
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

const SUPPORTED_MODELS = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', tag: 'Khuyên dùng · Thế hệ mới 2026, thông minh & nhạy bén nhất' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', tag: 'Siêu tốc độ · Phản hồi cực nhanh' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', tag: 'Tiêu chuẩn ổn định · Phản hồi nhanh & chuẩn xác' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', tag: 'Mô hình Pro · Phân tích chuyên sâu' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', tag: 'Bản siêu nhẹ & ổn định' },
  { id: 'gemini-flash-latest', name: 'Gemini Flash (Mới nhất)', tag: 'Tự động cập nhật liên tục' },
];

/**
 * Hiển thị văn bản AI với định dạng Bảng (Table), Danh sách và Chữ đậm
 */
function FormattedAiContent({ content = '', onOpenSettings }) {
  if (!content) return null;

  // Kiểm tra nếu thông báo có liên quan đến việc cấu hình API Key
  const isKeyNotice = content.includes('Chưa cấu hình Google Gemini API Key') ||
    content.includes('Khóa API Key Google Gemini không hợp lệ') ||
    content.includes('API key not valid');

  const lines = String(content).split('\n');
  const elements = [];
  let tableBuffer = [];
  let inTable = false;

  const flushTable = (key) => {
    if (tableBuffer.length < 2) {
      elements.push(
        <div key={key} className="whitespace-pre-line my-1">
          {tableBuffer.join('\n')}
        </div>
      );
      tableBuffer = [];
      inTable = false;
      return;
    }

    const headerLine = tableBuffer[0];
    const dataLines = tableBuffer.slice(2);

    const headers = headerLine
      .split('|')
      .map(h => h.trim())
      .filter((h, idx, arr) => (idx > 0 && idx < arr.length - 1) || (h !== '' && arr.length <= 2));

    const rows = dataLines
      .map(line =>
        line
          .split('|')
          .map(cell => cell.trim())
          .filter((c, idx, arr) => (idx > 0 && idx < arr.length - 1) || (c !== '' && arr.length <= 2))
      )
      .filter(r => r.length > 0);

    elements.push(
      <div key={key} className="my-2.5 overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-xs">
        <table className="min-w-full text-xs divide-y divide-gray-200">
          <thead className="bg-indigo-50/70 font-bold text-gray-800">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="px-2.5 py-2 text-left whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-gray-700 font-medium">
            {rows.map((row, rIdx) => (
              <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                {row.map((cell, cIdx) => {
                  const isMoneyOrNum = /[\d.,]+\s*(đ|%)/i.test(cell) || /^\d+$/.test(cell);
                  const isRedStatus = /nợ xấu|quá hạn|nguy cơ|hết hàng/i.test(cell);
                  const isGreenStatus = /đã trả|trong hạn|hoàn thành|còn hàng/i.test(cell);

                  return (
                    <td
                      key={cIdx}
                      className={`px-2.5 py-1.5 whitespace-nowrap ${isMoneyOrNum ? 'font-mono text-right' : 'text-left'} ${isRedStatus ? 'text-rose-600 font-bold' : isGreenStatus ? 'text-emerald-600 font-semibold' : ''
                        }`}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

    tableBuffer = [];
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTableLine = line.trim().startsWith('|') && line.trim().endsWith('|');

    if (isTableLine) {
      inTable = true;
      tableBuffer.push(line);
    } else {
      if (inTable) {
        flushTable(`table-${i}`);
      }

      if (line.startsWith('### ')) {
        elements.push(
          <h4 key={i} className="font-bold text-gray-900 text-xs mt-3 mb-1 text-indigo-900 flex items-center gap-1.5">
            {renderInlineMarkdown(line.replace('### ', ''))}
          </h4>
        );
      } else if (line.startsWith('## ')) {
        elements.push(
          <h3 key={i} className="font-bold text-gray-900 text-sm mt-3 mb-1 text-indigo-950">
            {renderInlineMarkdown(line.replace('## ', ''))}
          </h3>
        );
      } else if (line.startsWith('• ') || line.startsWith('* ') || line.startsWith('- ')) {
        elements.push(
          <div key={i} className="flex items-start gap-1.5 text-xs text-gray-700 my-0.5 pl-1 leading-relaxed">
            <span className="text-indigo-500 font-bold shrink-0">•</span>
            <span className="flex-1">{renderInlineMarkdown(line.replace(/^[•*-]\s*/, ''))}</span>
          </div>
        );
      } else if (line.trim() === '') {
        elements.push(<div key={i} className="h-1.5" />);
      } else {
        elements.push(
          <p key={i} className="text-xs text-gray-700 my-1 leading-relaxed">
            {renderInlineMarkdown(line)}
          </p>
        );
      }
    }
  }

  if (inTable) {
    flushTable('table-end');
  }

  return (
    <div className="space-y-0.5">
      {elements}
      {isKeyNotice && onOpenSettings && (
        <div className="mt-2.5 pt-2 border-t border-indigo-100 flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs shadow-xs transition"
          >
            <Settings size={13} /> Cài đặt API Key ngay
          </button>
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-indigo-600 hover:underline inline-flex items-center gap-1"
          >
            Lấy key miễn phí <ExternalLink size={11} />
          </a>
        </div>
      )}
    </div>
  );
}

function renderInlineMarkdown(text) {
  if (!text) return '';
  const parts = text.split(/(\*\*.*?\*\*|`.*?`|\[.*?\]\(.*?\))/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-bold text-gray-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="font-mono bg-indigo-50 text-indigo-800 px-1 py-0.5 rounded text-[11px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
    if (linkMatch) {
      const [, label, url] = linkMatch;
      const isZalo = url.includes('zalo.me');
      return (
        <a
          key={index}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 font-semibold rounded-lg px-2 py-0.5 my-0.5 transition ${
            isZalo
              ? 'bg-blue-600 hover:bg-blue-700 text-white text-[11px] shadow-xs no-underline font-medium'
              : 'text-blue-600 hover:text-blue-800 underline'
          }`}
        >
          {label}
        </a>
      );
    }
    return part;
  });
}

/**
 * Modal cấu hình nhanh Google Gemini API Key trực tiếp trong Chat Widget
 */
function ApiKeySettingsModal({ isOpen, onClose, onSaved }) {
  const [config, setConfig] = useState(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setTestResult(null);
    setSaveSuccess(false);
    accountingApi.ai.getConfig()
      .then(res => {
        if (res && res.ok && res.config) {
          setConfig(res.config);
          setSelectedModel(res.config.model || 'gemini-3.8-flash');
        }
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, [isOpen]);

  const handleTest = async () => {
    const keyToTest = apiKeyInput.trim() || config?.apiKey || '';
    if (!keyToTest) {
      setTestResult({ ok: false, error: 'Vui lòng nhập API Key để kiểm tra kết nối.' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await accountingApi.ai.testConnection({ apiKey: keyToTest, model: selectedModel });
      setTestResult(res);
    } catch (err) {
      setTestResult({ ok: false, error: getApiErrorMessage(err, 'Kiểm tra kết nối thất bại.') });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      const payload = {
        model: selectedModel,
      };
      if (apiKeyInput.trim()) {
        payload.apiKey = apiKeyInput.trim();
      }
      const res = await accountingApi.ai.saveConfig(payload);
      if (res && res.ok) {
        setConfig(res.config);
        setApiKeyInput('');
        setSaveSuccess(true);
        if (onSaved) onSaved(res.config);
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch (err) {
      setTestResult({ ok: false, error: getApiErrorMessage(err, 'Lưu cấu hình thất bại.') });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white rounded-3xl overflow-hidden animate-in fade-in zoom-in-95">
      {/* Header Modal */}
      <div className="flex items-center justify-between border-b border-indigo-100 bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600/30 text-blue-300 border border-blue-400/30">
            <Key size={16} />
          </div>
          <div>
            <h4 className="font-bold text-xs text-white">Cài Đặt Google Gemini API Key</h4>
            <p className="text-[10px] text-indigo-200/70">Kích hoạt Chatbot AI thông minh như ChatGPT/Gemini</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-indigo-200/80 hover:bg-white/10 hover:text-white transition"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body Modal */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs text-gray-700">
        {loading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-indigo-600">
            <Loader2 size={18} className="animate-spin" /> Đang tải cấu hình...
          </div>
        ) : (
          <>
            {/* Trạng thái hiện tại */}
            <div className="rounded-xl border border-gray-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-gray-700">Trạng thái kết nối:</span>
                {config?.isConfigured ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                    <CheckCircle2 size={12} /> {config?.isBuiltinKey ? 'Đã tích hợp sẵn theo phần mềm' : 'Đã cấu hình'}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                    <AlertTriangle size={12} /> Chưa có API Key
                  </span>
                )}
              </div>
              {config?.maskedKey && (
                <div className="text-[11px] text-gray-500 font-mono">
                  {config?.isBuiltinKey ? 'Khóa mặc định hệ thống: ' : 'Khóa hiện tại: '}{config.maskedKey}
                </div>
              )}
              {config?.isBuiltinKey && (
                <div className="mt-1.5 text-[11px] text-emerald-700 font-medium bg-emerald-50/80 rounded-lg px-2 py-1 border border-emerald-200/60">
                  ✨ Khóa Gemini AI đã được tích hợp sẵn vào phần mềm. Khách chỉ cần cập nhật phiên bản mới là dùng được ngay!
                </div>
              )}
            </div>

            {/* Ô nhập API Key mới */}
            <div>
              <label className="block font-semibold text-gray-800 mb-1">
                Google Gemini API Key (Tùy chọn nếu muốn đổi):
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder={config?.isConfigured ? 'Đã có khóa tích hợp sẵn (chỉ nhập nếu muốn đổi key cá nhân)...' : 'Dán mã API Key vào đây...'}
                  className="input-field w-full pr-9 text-xs py-2 rounded-xl font-mono focus:ring-2 focus:ring-indigo-500/30"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Chưa có khóa? Lấy miễn phí tại{' '}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 font-medium hover:underline inline-flex items-center gap-0.5"
                >
                  Google AI Studio <ExternalLink size={10} />
                </a>
              </p>
            </div>

            {/* Chọn Model AI */}
            <div>
              <label className="block font-semibold text-gray-800 mb-1">
                Mô hình Google Gemini (Model):
              </label>
              <div className="space-y-1.5">
                {SUPPORTED_MODELS.map((m) => (
                  <label
                    key={m.id}
                    className={`flex items-start gap-2.5 p-2 rounded-xl border cursor-pointer transition ${selectedModel === m.id
                        ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500/30'
                        : 'border-gray-200 bg-white hover:bg-slate-50'
                      }`}
                  >
                    <input
                      type="radio"
                      name="geminiModel"
                      value={m.id}
                      checked={selectedModel === m.id}
                      onChange={() => setSelectedModel(m.id)}
                      className="mt-0.5 text-indigo-600"
                    />
                    <div className="flex-1">
                      <div className="font-bold text-gray-900 text-xs flex items-center justify-between">
                        <span>{m.name}</span>
                        {selectedModel === m.id && (
                          <span className="text-[10px] font-semibold text-indigo-600">Đang chọn</span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-0.5">{m.tag}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Thông báo kết quả kiểm tra */}
            {testResult && (
              <div
                className={`p-2.5 rounded-xl text-xs flex items-start gap-2 ${testResult.ok
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle size={15} className="text-rose-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-bold">{testResult.ok ? 'Kết nối thành công!' : 'Kết nối thất bại:'}</div>
                  <div className="text-[11px] mt-0.5">{testResult.message || testResult.error}</div>
                </div>
              </div>
            )}

            {saveSuccess && (
              <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs flex items-center gap-2">
                <CheckCircle2 size={15} className="text-emerald-600" />
                <span className="font-bold">Đã lưu cấu hình Google Gemini AI thành công!</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer Modal Actions */}
      <div className="border-t border-gray-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || saving || loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-100 text-gray-700 font-semibold text-xs transition disabled:opacity-50"
        >
          {testing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Kiểm tra kết nối
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || testing || loading}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs shadow-md shadow-indigo-600/20 transition disabled:opacity-50"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Lưu cấu hình
        </button>
      </div>
    </div>
  );
}

export default function FloatingAiChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState(() => loadStoredChatMessages());
  const [input, setInput] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [previewModalImage, setPreviewModalImage] = useState(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const chatScrollRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Đồng bộ lịch sử khi component khác cập nhật
  useEffect(() => {
    const handleSync = (event) => {
      const incoming = event?.detail?.messages;
      if (Array.isArray(incoming)) {
        setMessages(incoming);
      }
    };
    window.addEventListener(AI_CHAT_UPDATED_EVENT, handleSync);
    return () => window.removeEventListener(AI_CHAT_UPDATED_EVENT, handleSync);
  }, []);

  // Tự động cuộn xuống đáy khi có tin nhắn mới hoặc mở drawer
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (chatScrollRef.current) {
          chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
        inputRef.current?.focus();
      }, 150);
    }
  }, [isOpen, messages, loading, selectedImage]);

  // Xử lý sự kiện dán ảnh từ Clipboard (Ctrl + V)
  const handlePasteEvent = async (e) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // 1. Kiểm tra clipboard items
    if (clipboardData.items) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.type.indexOf('image') !== -1) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            try {
              const processed = await processAndCompressImage(file);
              setSelectedImage(processed);
            } catch (err) {
              console.error('Lỗi nén ảnh clipboard:', err);
            }
          }
          return;
        }
      }
    }

    // 2. Kiểm tra clipboard files
    if (clipboardData.files && clipboardData.files.length > 0) {
      const file = clipboardData.files[0];
      if (file.type.startsWith('image/')) {
        e.preventDefault();
        try {
          const processed = await processAndCompressImage(file);
          setSelectedImage(processed);
        } catch (err) {
          console.error('Lỗi nén ảnh clipboard file:', err);
        }
      }
    }
  };

  // Xử lý chọn ảnh từ file input
  const handleFileInputChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const processed = await processAndCompressImage(file);
      setSelectedImage(processed);
    } catch (err) {
      console.error('Lỗi đọc ảnh từ file:', err);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Xử lý kéo thả ảnh vào khung chat
  const handleDragOver = (e) => {
    e.preventDefault();
    if (e.dataTransfer?.types?.includes('Files')) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        try {
          const processed = await processAndCompressImage(file);
          setSelectedImage(processed);
        } catch (err) {
          console.error('Lỗi xử lý ảnh kéo thả:', err);
        }
      }
    }
  };

  // Gửi câu hỏi hoặc hình ảnh tới AI
  const handleSendMessage = async (textToSend = null) => {
    const q = (textToSend !== null ? textToSend : input).trim();
    const currentImg = selectedImage;

    // Phải có nội dung câu hỏi hoặc ảnh đính kèm
    if ((!q && !currentImg) || loading) return;

    const displayQuestion = q || (currentImg ? 'Hãy đọc và phân tích nội dung hình ảnh này giúp tôi.' : '');

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: displayQuestion,
      image: currentImg?.dataUrl || null,
      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    saveStoredChatMessages(nextMessages);
    setInput('');
    setSelectedImage(null);
    setLoading(true);

    try {
      const historyPayload = nextMessages
        .slice(-8)
        .map(m => ({ role: m.role, text: m.text }));

      const res = await accountingApi.ai.chat({
        question: displayQuestion,
        history: historyPayload,
        image: currentImg?.dataUrl || undefined,
      });

      if (res && res.ok && res.reply) {
        const aiMessage = {
          id: `ai-${Date.now()}`,
          role: 'model',
          text: res.reply,
          time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
          model: res.model_used,
        };
        const updated = [...nextMessages, aiMessage];
        setMessages(updated);
        saveStoredChatMessages(updated);
      } else {
        const errMessage = {
          id: `err-${Date.now()}`,
          role: 'model',
          text: `⚠️ ${res?.error || 'Không nhận được câu trả lời từ máy chủ AI.'}`,
          isError: true,
          time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        };
        const updated = [...nextMessages, errMessage];
        setMessages(updated);
        saveStoredChatMessages(updated);
      }
    } catch (err) {
      const errMessage = {
        id: `err-${Date.now()}`,
        role: 'model',
        text: `⚠️ ${getApiErrorMessage(err, 'Không thể kết nối đến Trợ lý AI.')}`,
        isError: true,
        time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      };
      const updated = [...nextMessages, errMessage];
      setMessages(updated);
      saveStoredChatMessages(updated);
    } finally {
      setLoading(false);
    }
  };

  // Xóa toàn bộ lịch sử trò chuyện
  const handleClearHistory = () => {
    if (window.confirm('Bạn có chắc muốn xóa sạch lịch sử trò chuyện với Trợ lý AI không?')) {
      const reset = clearStoredChatMessages();
      setMessages(reset);
    }
  };

  const SUGGESTION_CHIPS = [
    { label: '📷 Cách dán ảnh cho AI đọc', query: 'Làm thế nào để chụp hoặc dán (Ctrl+V) hình ảnh hóa đơn, biên lai để AI đọc và phân tích?' },
    { label: '📊 Doanh thu & Đơn hôm nay', query: 'Hôm nay cửa hàng bán được bao nhiêu đơn hàng và doanh thu bao nhiêu?' },
    { label: '📦 Hàng nào sắp hết / tồn kho ít?', query: 'Mặt hàng nào đang có nguy cơ hết hàng hoặc tồn kho thấp dưới 5 cái?' },
    { label: '🧾 Đơn hàng mới nhất gần đây', query: 'Cho tôi xem danh sách các đơn hàng mới nhất gần đây gồm mã đơn, khách, tổng tiền' },
    { label: '⚠️ Khách nào nợ nhiều nhất?', query: 'Khách hàng nào đang còn nợ nhiều nhất và tuổi nợ bao nhiêu ngày?' },
    { label: '💬 Tích hợp nhắn Zalo tự động', query: 'Phần mềm có thể tự động gửi tin nhắn nhắc nợ hoặc thông báo đơn hàng qua Zalo được không và các bước triển khai thế nào?' },
    { label: '💡 Mẹo tăng doanh số bán hàng', query: 'Gợi ý cho tôi các chiến lược và mẹo thực tế nhất để tăng doanh số bán hàng cho cửa hàng' },
    { label: '📢 Viết bài quảng cáo Zalo/Facebook', query: 'Hãy viết cho tôi 1 bài đăng quảng cáo bán hàng hấp dẫn, hài hước và thu hút trên Facebook/Zalo' },
    { label: '💰 Sổ quỹ tiền mặt hiện tại', query: 'Tình hình quỹ tiền mặt của cửa hàng hiện tại: tổng thu, tổng chi và số dư quỹ là bao nhiêu?' },
    { label: '🧾 Thuế GTGT tính thế nào?', query: 'Thuế GTGT của cửa hàng lấy dữ liệu từ đâu và tính thế nào?' },
    { label: '👨‍💻 Ai lập trình phần mềm này?', query: 'Ai code và lập trình ra phần mềm này?' },
  ];

  return (
    <>
      {/* 1. NÚT TRÒ CHUYỆN NỔI (FAB) */}
      {!isOpen && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center justify-center">
          <div className="absolute inset-0 -m-2 rounded-full border-2 border-blue-400/40 animate-ping opacity-30 pointer-events-none" />

          <button
            type="button"
            id="btn-floating-ai-assistant"
            onClick={() => setIsOpen(true)}
            className="group relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 via-blue-500 to-indigo-600 text-white shadow-2xl shadow-blue-600/50 ring-4 ring-blue-400/30 hover:scale-110 active:scale-95 transition-all duration-300"
            title="Mở Trợ lý AI Thông Minh (Gemini)"
            aria-label="Mở Trợ lý AI Thông Minh"
          >
            <MessageSquare className="h-6 w-6 stroke-[2.2] text-white transition-transform duration-200 group-hover:scale-110" />

            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-4 w-4 rounded-full border-2 border-white bg-emerald-500" />
            </span>
          </button>
        </div>
      )}

      {/* 2. CỬA SỔ TRỢ LÝ ẢO NỔI (FLOATING CHAT DRAWER) */}
      {isOpen && (
        <div
          onPaste={handlePasteEvent}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`fixed bottom-4 right-4 md:bottom-6 md:right-6 z-50 flex flex-col rounded-3xl bg-white shadow-2xl border border-blue-200/80 overflow-hidden transition-all duration-300 animate-in fade-in zoom-in-95 ${expanded
              ? 'w-[95vw] md:w-[700px] h-[92vh] max-h-[850px]'
              : 'w-[95vw] sm:w-[480px] h-[82vh] max-h-[640px]'
            }`}
        >
          {/* LỚP PHỦ KHI KÉO THẢ ẢNH VÀO KHUNG CHAT */}
          {isDraggingOver && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-indigo-950/85 backdrop-blur-xs text-white p-6 border-4 border-dashed border-indigo-400 rounded-3xl animate-in fade-in pointer-events-none">
              <ImageIcon size={52} className="animate-bounce mb-3 text-indigo-300" />
              <p className="font-bold text-base">Thả hình ảnh vào đây</p>
              <p className="text-xs text-indigo-200/80 mt-1">AI Gemini sẽ đọc hóa đơn, biên lai, chữ và số liệu trong ảnh</p>
            </div>
          )}

          {/* MODAL CÀI ĐẶT API KEY NHANH */}
          <ApiKeySettingsModal
            isOpen={showSettingsModal}
            onClose={() => setShowSettingsModal(false)}
            onSaved={() => {
              // Tự động thêm tin nhắn chào mừng hoặc thông báo đã lưu
            }}
          />

          {/* HEADER CỬA SỔ CHAT */}
          <div className="flex items-center justify-between border-b border-indigo-900/30 bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 px-4 py-3 text-white shadow-sm">
            <div className="flex items-center gap-3">
              <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-white shadow-md shadow-blue-500/30 ring-2 ring-blue-400/30">
                <Bot size={20} />
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-slate-900 bg-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-bold text-sm text-white">Trợ Lý AI Toàn Năng</h3>
                  <span className="rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                    Gemini AI
                  </span>
                </div>
                <p className="text-[11px] text-indigo-200/80">
                  Chatbot thông minh • Đọc ảnh &amp; Dữ liệu cửa hàng 24/7
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                className="rounded-lg p-1.5 text-indigo-200/80 hover:bg-white/10 hover:text-white transition"
                title="Cài đặt Google Gemini API Key"
              >
                <Settings size={16} />
              </button>
              <button
                type="button"
                onClick={handleClearHistory}
                className="rounded-lg p-1.5 text-indigo-200/80 hover:bg-white/10 hover:text-white transition"
                title="Xóa lịch sử chat"
              >
                <Trash2 size={16} />
              </button>
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="hidden sm:inline-flex rounded-lg p-1.5 text-indigo-200/80 hover:bg-white/10 hover:text-white transition"
                title={expanded ? 'Thu nhỏ' : 'Mở rộng'}
              >
                {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1.5 text-indigo-200/80 hover:bg-white/10 hover:text-white transition"
                title="Đóng cửa sổ"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* THANH GỢI Ý NHANH (QUICK CHIPS) */}
          <div className="flex gap-1.5 overflow-x-auto border-b border-gray-100 bg-slate-50/70 px-3 py-2 scrollbar-none">
            {SUGGESTION_CHIPS.map((chip, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendMessage(chip.query)}
                disabled={loading}
                className="inline-flex shrink-0 items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 transition disabled:opacity-50"
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* KHUNG NỘI DUNG CUỘN CHAT */}
          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-gradient-to-b from-slate-50/40 to-white"
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[92%] rounded-2xl px-4 py-2.5 text-xs shadow-xs ${msg.role === 'user'
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-br-xs font-medium'
                      : msg.isError
                        ? 'bg-rose-50 text-rose-800 border border-rose-200 rounded-bl-xs'
                        : 'bg-white text-gray-800 border border-gray-200/90 rounded-bl-xs shadow-xs'
                    }`}
                >
                  {/* HÌNH ẢNH ĐÍNH KÈM (NẾU CÓ) */}
                  {msg.image && (
                    <div className="mb-2 overflow-hidden rounded-xl border border-white/20 bg-black/10">
                      <img
                        src={msg.image}
                        alt="Hình ảnh đính kèm"
                        className="max-h-60 w-auto max-w-full rounded-xl object-contain cursor-pointer hover:opacity-90 transition"
                        onClick={() => setPreviewModalImage(msg.image)}
                        title="Bấm để xem ảnh phóng to"
                      />
                    </div>
                  )}

                  {msg.role === 'user' ? (
                    <div className="whitespace-pre-line text-sm">{msg.text}</div>
                  ) : (
                    <FormattedAiContent
                      content={msg.text}
                      onOpenSettings={() => setShowSettingsModal(true)}
                    />
                  )}
                </div>
                {msg.time && (
                  <span className="text-[10px] text-gray-400 mt-1 px-1">
                    {msg.time} {msg.model ? `• ${msg.model}` : ''}
                  </span>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2.5 rounded-2xl bg-indigo-50/70 border border-indigo-100 px-4 py-2.5 text-xs text-indigo-700 max-w-[85%]">
                <Loader2 size={15} className="animate-spin text-indigo-600 shrink-0" />
                <span>Trợ lý AI đang đọc hình ảnh, tra cứu số liệu và soạn câu trả lời...</span>
              </div>
            )}
          </div>

          {/* Ô NHẬP TIN NHẮN & ĐÍNH KÈM ẢNH */}
          <div className="border-t border-gray-200 bg-white p-3">
            {/* THẺ PREVIEW ẢNH NẾU ĐÃ CHỌN HOẶC DÁN (CTRL+V) */}
            {selectedImage && (
              <div className="mb-2.5 flex items-center justify-between rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-blue-50 p-2.5 shadow-xs animate-in fade-in slide-in-from-bottom-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={selectedImage.dataUrl}
                    alt="Ảnh đính kèm"
                    className="h-12 w-12 rounded-xl object-cover border border-indigo-300/80 shadow-xs cursor-pointer hover:opacity-90 transition shrink-0"
                    onClick={() => setPreviewModalImage(selectedImage.dataUrl)}
                    title="Bấm để xem ảnh to"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950 truncate">
                      <ImageIcon size={13} className="text-indigo-600 shrink-0" />
                      <span className="truncate">{selectedImage.name || 'Ảnh chụp (Ctrl+V)'}</span>
                    </div>
                    <p className="text-[11px] text-indigo-700/80 mt-0.5">
                      {selectedImage.sizeKb ? `${selectedImage.sizeKb} KB • ` : ''}Đã sẵn sàng • Bấm Gửi để AI đọc &amp; phân tích
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedImage(null)}
                  className="rounded-xl p-1.5 text-gray-400 hover:bg-white hover:text-rose-600 hover:shadow-xs transition shrink-0 ml-2"
                  title="Gỡ ảnh này"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* FORM GỬI CÂU HỎI & NÚT CHỌN ẢNH */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              {/* Nút chọn ảnh từ file */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileInputChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-slate-50 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-300 transition shadow-xs disabled:opacity-50"
                title="Tải ảnh lên từ máy tính (hoặc nhấn Ctrl+V để dán ảnh trực tiếp)"
              >
                <ImageIcon size={18} />
              </button>

              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPaste={handlePasteEvent}
                placeholder={
                  selectedImage
                    ? 'Nhập câu hỏi về ảnh này (hoặc bấm Gửi ngay)...'
                    : 'Hỏi AI hoặc nhấn Ctrl+V dán ảnh hóa đơn, biên lai, chụp màn hình...'
                }
                disabled={loading}
                className="input-field flex-1 text-xs py-2.5 px-3.5 rounded-xl font-normal focus:ring-2 focus:ring-indigo-500/30"
              />

              <button
                type="submit"
                disabled={loading || (!input.trim() && !selectedImage)}
                className="btn-primary inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl p-0 shadow-md shadow-indigo-600/20 disabled:opacity-50"
                title="Gửi câu hỏi"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </form>

            <div className="mt-1.5 flex items-center justify-between text-[10px] text-gray-400 px-1">
              <span className="flex items-center gap-1">
                <ImageIcon size={10} className="text-indigo-400" /> Dán ảnh (Ctrl+V) &amp; Kéo thả
              </span>
              <span className="flex items-center gap-1">
                <Sparkles size={10} className="text-indigo-500" /> Google Gemini Vision AI
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 3. LIGHTBOX PHÓNG TO XEM ẢNH FULL-SCREEN */}
      {previewModalImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-xs animate-in fade-in"
          onClick={() => setPreviewModalImage(null)}
        >
          <div
            className="relative max-h-[92vh] max-w-[92vw] overflow-hidden rounded-2xl bg-slate-900 p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewModalImage(null)}
              className="absolute top-4 right-4 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/90 transition shadow-md"
              title="Đóng xem ảnh"
            >
              <X size={18} />
            </button>
            <img
              src={previewModalImage}
              alt="Ảnh phóng to"
              className="max-h-[86vh] max-w-[90vw] object-contain rounded-xl"
            />
          </div>
        </div>
      )}
    </>
  );
}
