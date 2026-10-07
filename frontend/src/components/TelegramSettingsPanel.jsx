import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Send,
  Eye,
  EyeOff,
  Bot,
  Check,
  AlertCircle,
  AlertTriangle,
  HelpCircle,
  Copy,
  CheckCircle2,
  RefreshCw,
  PlusCircle,
  FileText,
  Box,
  Warehouse,
  Users,
  ShoppingCart,
  Truck,
  BarChart3,
  Wallet,
  Boxes,
  Calculator,
  Trophy,
  ShieldCheck,
  Zap,
  Info,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import { apiJson, getApiErrorMessage } from '../utils/apiClient';

const BOT_GROUPS = [
  {
    key: 'don_hang',
    title: '1. Nhóm Đơn Hàng',
    description: 'Theo dõi tạo mới và các cập nhật trong danh sách đơn hàng',
    badge: '2 Bot',
    headerColor: 'from-blue-600 to-indigo-600',
    bots: [
      {
        key: 'bot_create_order',
        name: 'Bot 1: Tạo đơn hàng',
        menuTitle: 'Tạo đơn hàng',
        icon: PlusCircle,
        color: 'emerald',
        badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        desc: 'Báo cáo tức thì khi có đơn hàng mới được tạo (Mã đơn, Khách hàng, Tổng tiền, Chi tiết SP, Nhân viên lập).',
        placeholder: 'Token bot tạo đơn (vd: 7123456789:AAH_xxx...)',
      },
      {
        key: 'bot_order_list',
        name: 'Bot 2: Danh sách đơn hàng',
        menuTitle: 'Danh sách đơn hàng',
        icon: FileText,
        color: 'blue',
        badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
        desc: 'Báo cáo khi chỉnh sửa đơn hàng, đổi trạng thái (Hoàn thành, Hủy), xóa đơn hoặc hoàn tiền.',
        placeholder: 'Token bot danh sách đơn (vd: 7123456789:AAH_xxx...)',
      },
    ],
  },
  {
    key: 'danh_muc',
    title: '2. Nhóm Danh Mục Nghiệp Vụ',
    description: 'Theo dõi dữ liệu sản phẩm, kho bãi, khách hàng, nhập hàng và đối tác',
    badge: '5 Bot',
    headerColor: 'from-purple-600 to-pink-600',
    bots: [
      {
        key: 'bot_products',
        name: 'Bot 3: Sản phẩm',
        menuTitle: 'Sản phẩm',
        icon: Box,
        color: 'purple',
        badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
        desc: 'Báo cáo khi thêm sản phẩm mới, cập nhật giá bán/giá vốn, chỉnh sửa thông tin hoặc xóa sản phẩm.',
        placeholder: 'Token bot sản phẩm (vd: 7123456789:AAH_xxx...)',
      },
      {
        key: 'bot_inventory',
        name: 'Bot 4: Kho hàng',
        menuTitle: 'Kho hàng',
        icon: Warehouse,
        color: 'amber',
        badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
        desc: 'Báo cáo biến động tồn kho, kiểm kho, cảnh báo sắp hết hàng hoặc trường hợp xuất âm kho.',
        placeholder: 'Token bot kho hàng (vd: 7123456789:AAH_xxx...)',
      },
      {
        key: 'bot_customers',
        name: 'Bot 5: Khách hàng',
        menuTitle: 'Khách hàng',
        icon: Users,
        color: 'teal',
        badgeColor: 'bg-teal-50 text-teal-700 border-teal-200',
        desc: 'Báo cáo khi tạo hồ sơ khách hàng mới, cập nhật số điện thoại, địa chỉ hoặc thay đổi công nợ.',
        placeholder: 'Token bot khách hàng (vd: 7123456789:AAH_xxx...)',
      },
      {
        key: 'bot_imports',
        name: 'Bot 6: Nhập hàng',
        menuTitle: 'Nhập hàng',
        icon: ShoppingCart,
        color: 'rose',
        badgeColor: 'bg-rose-50 text-rose-700 border-rose-200',
        desc: 'Báo cáo khi lập phiếu nhập hàng từ NCC, giá trị nhập kho, số tiền đã trả và công nợ nhà cung cấp.',
        placeholder: 'Token bot nhập hàng (vd: 7123456789:AAH_xxx...)',
      },
      {
        key: 'bot_partners',
        name: 'Bot 7: Đối Tác',
        menuTitle: 'Đối Tác (Nhà cung cấp)',
        icon: Truck,
        color: 'sky',
        badgeColor: 'bg-sky-50 text-sky-700 border-sky-200',
        desc: 'Báo cáo khi thêm đối tác/nhà cung cấp mới, cập nhật mã số thuế, thông tin liên hệ.',
        placeholder: 'Token bot đối tác (vd: 7123456789:AAH_xxx...)',
      },
    ],
  },
  {
    key: 'quan_ly',
    title: '3. Nhóm Quản Lý, Báo Cáo & Kế Toán',
    description: 'Theo dõi tài chính sổ quỹ, kế toán công nợ, thống kê doanh thu và báo cáo phân tích',
    badge: '6 Bot',
    headerColor: 'from-emerald-600 to-teal-600',
    bots: [
      {
        key: 'bot_stats',
        name: 'Bot 8: Thống kê',
        menuTitle: 'Thống kê',
        icon: BarChart3,
        color: 'violet',
        badgeColor: 'bg-violet-50 text-violet-700 border-violet-200',
        desc: 'Báo cáo doanh số kinh doanh, số lượng đơn, lợi nhuận gộp và giá trị trung bình mỗi đơn hàng.',
        placeholder: 'Token bot thống kê (vd: 7123456789:AAH_xxx...)',
      },
      {
        key: 'bot_cashbook',
        name: 'Bot 9: Sổ quỹ',
        menuTitle: 'Sổ quỹ',
        icon: Wallet,
        color: 'emerald',
        badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        desc: 'Báo cáo khi tạo phiếu thu tiền, phiếu chi tiền, biến động số dư quỹ tiền mặt hoặc ngân hàng.',
        placeholder: 'Token bot sổ quỹ (vd: 7123456789:AAH_xxx...)',
      },
      {
        key: 'bot_order_reports',
        name: 'Bot 10: Báo cáo theo đơn hàng',
        menuTitle: 'Báo cáo theo đơn hàng',
        icon: FileText,
        color: 'cyan',
        badgeColor: 'bg-cyan-50 text-cyan-700 border-cyan-200',
        desc: 'Báo cáo phân tích chuyên sâu hiệu quả đơn hàng, số đơn thành công, tỷ lệ hủy đơn.',
        placeholder: 'Token bot báo cáo đơn (vd: 7123456789:AAH_xxx...)',
      },
      {
        key: 'bot_product_reports',
        name: 'Bot 11: Báo cáo sản phẩm',
        menuTitle: 'Báo cáo sản phẩm',
        icon: Boxes,
        color: 'orange',
        badgeColor: 'bg-orange-50 text-orange-700 border-orange-200',
        desc: 'Báo cáo phân tích sản phẩm bán chạy nhất, sản phẩm tồn kho lâu ngày và tỷ trọng doanh thu.',
        placeholder: 'Token bot báo cáo SP (vd: 7123456789:AAH_xxx...)',
      },
      {
        key: 'bot_top_customers',
        name: 'Bot 12: Top khách hàng',
        menuTitle: 'Top khách hàng',
        icon: Trophy,
        color: 'amber',
        badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
        desc: 'Báo cáo bảng vàng xếp hạng khách hàng thân thiết, khách hàng VIP đem lại doanh thu cao nhất.',
        placeholder: 'Token bot top khách (vd: 7123456789:AAH_xxx...)',
      },
      {
        key: 'bot_accounting',
        name: 'Bot 13: Kế toán & Công nợ',
        menuTitle: 'Kế toán & Công nợ (AI)',
        icon: Calculator,
        color: 'indigo',
        badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        desc: 'Báo cáo công nợ doanh nghiệp, tuổi nợ khách hàng, cảnh báo nợ xấu và nhận định tài chính AI gửi về nhóm Telegram.',
        placeholder: 'Token bot kế toán (vd: 7123456789:AAH_xxx...)',
      },
    ],
  },
];

export default function TelegramSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingAll, setTestingAll] = useState(false);
  const [testingBot, setTestingBot] = useState({});
  const [testResults, setTestResults] = useState({});
  const [notice, setNotice] = useState(null);
  const [showGuide, setShowGuide] = useState(false);
  const [visibleTokens, setVisibleTokens] = useState({});

  const [form, setForm] = useState({
    enabled: false,
    group_id: '',
    bots: {},
  });

  // Tải cấu hình từ Backend API
  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiJson('/api/telegram/settings');
      if (res && res.settings) {
        setForm({
          enabled: Boolean(res.settings.enabled),
          group_id: String(res.settings.group_id || '').trim(),
          bots: res.settings.bots || {},
        });
      }
    } catch (err) {
      setNotice({
        tone: 'error',
        message: getApiErrorMessage(err, 'Không thể tải cấu hình Telegram từ máy chủ.'),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Cập nhật trường trong Form
  const handleUpdateField = (field, value) => {
    setForm(current => ({
      ...current,
      [field]: value,
    }));
  };

  const handleUpdateBotToken = (botKey, token) => {
    setForm(current => ({
      ...current,
      bots: {
        ...current.bots,
        [botKey]: {
          ...(current.bots[botKey] || {}),
          token,
        },
      },
    }));
  };

  const handleToggleBot = (botKey) => {
    setForm(current => {
      const isEnabled = current.bots[botKey]?.enabled !== false;
      return {
        ...current,
        bots: {
          ...current.bots,
          [botKey]: {
            ...(current.bots[botKey] || {}),
            enabled: !isEnabled,
          },
        },
      };
    });
  };

  const toggleTokenVisibility = (botKey) => {
    setVisibleTokens(prev => ({
      ...prev,
      [botKey]: !prev[botKey],
    }));
  };

  // Lưu cấu hình
  const handleSave = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await apiJson('/api/telegram/settings', {
        method: 'PUT',
        body: form,
      });
      if (res && res.ok) {
        setNotice({
          tone: 'success',
          message: 'Đã lưu cấu hình 12 Bot Telegram thành công!',
        });
        if (res.settings) {
          setForm({
            enabled: Boolean(res.settings.enabled),
            group_id: String(res.settings.group_id || '').trim(),
            bots: res.settings.bots || {},
          });
        }
      }
    } catch (err) {
      setNotice({
        tone: 'error',
        message: getApiErrorMessage(err, 'Lưu cấu hình Telegram thất bại.'),
      });
    } finally {
      setSaving(false);
    }
  };

  // Test 1 bot đơn lẻ
  const handleTestBot = async (botKey, botName) => {
    const token = form.bots[botKey]?.token;
    const groupId = form.group_id;

    if (!token) {
      setTestResults(prev => ({
        ...prev,
        [botKey]: { ok: false, error: 'Vui lòng nhập Token trước khi thử!' },
      }));
      return;
    }
    if (!groupId) {
      setTestResults(prev => ({
        ...prev,
        [botKey]: { ok: false, error: 'Chưa nhập ID Nhóm Telegram!' },
      }));
      return;
    }

    setTestingBot(prev => ({ ...prev, [botKey]: true }));
    try {
      const res = await apiJson('/api/telegram/test-bot', {
        method: 'POST',
        body: { botKey, token, groupId },
      });
      setTestResults(prev => ({
        ...prev,
        [botKey]: {
          ok: res.ok,
          message: res.ok ? '✅ Gửi thành công vào nhóm!' : `❌ Lỗi: ${res.error || 'Thất bại'}`,
        },
      }));
    } catch (err) {
      setTestResults(prev => ({
        ...prev,
        [botKey]: {
          ok: false,
          error: `❌ Lỗi kết nối: ${err.message || 'Không gửi được'}`,
        },
      }));
    } finally {
      setTestingBot(prev => ({ ...prev, [botKey]: false }));
    }
  };

  // Test toàn bộ 12 bot
  const handleTestAll = async () => {
    if (!form.group_id) {
      setNotice({
        tone: 'error',
        message: 'Vui lòng nhập ID Nhóm Telegram trước khi kiểm tra toàn bộ bot.',
      });
      return;
    }

    setTestingAll(true);
    setNotice(null);
    try {
      const res = await apiJson('/api/telegram/test-all', {
        method: 'POST',
        body: { groupId: form.group_id },
      });

      if (res && res.results) {
        const newResults = {};
        for (const item of res.results) {
          newResults[item.botKey] = {
            ok: item.ok,
            message: item.ok ? '✅ Gửi thành công!' : item.skipped ? '⚠️ Chưa nhập token' : `❌ ${item.error}`,
          };
        }
        setTestResults(newResults);
        setNotice({
          tone: res.ok ? 'success' : 'info',
          message: res.summary || 'Đã kiểm tra kết nối các bot Telegram.',
        });
      }
    } catch (err) {
      setNotice({
        tone: 'error',
        message: getApiErrorMessage(err, 'Lỗi khi kiểm tra kết nối các bot.'),
      });
    } finally {
      setTestingAll(false);
    }
  };

  const totalBotsCount = useMemo(() => {
    return BOT_GROUPS.reduce((acc, g) => acc + (g.bots?.length || 0), 0);
  }, []);

  const configuredCount = useMemo(() => {
    let count = 0;
    for (const group of BOT_GROUPS) {
      for (const bot of group.bots) {
        if (form.bots[bot.key]?.token?.trim()) count++;
      }
    }
    return count;
  }, [form.bots]);

  if (loading) {
    return (
      <div className="card flex min-h-[300px] flex-col items-center justify-center gap-3 text-gray-500">
        <Loader2 size={32} className="animate-spin text-blue-600" />
        <span className="text-sm font-medium">Đang tải dữ liệu cấu hình {totalBotsCount} Bot Telegram...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* HEADER SECTION */}
      <div className="card border-blue-100 bg-gradient-to-r from-blue-50/70 via-indigo-50/40 to-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-sky-500 text-white shadow-md shadow-blue-500/20">
              <Send size={24} className="-ml-0.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-gray-800">Cấu hình {totalBotsCount} Bot Telegram Báo Cáo</h2>
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                  {configuredCount}/{totalBotsCount} bot đã nhập token
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-600">
                {totalBotsCount} con bot độc lập báo cáo từng nghiệp vụ (khớp menu) cùng gửi dữ liệu về chung <b>1 Nhóm Telegram</b>.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowGuide(!showGuide)}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
            >
              <HelpCircle size={16} className="text-blue-600" />
              Hướng dẫn cài đặt
              {showGuide ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="btn-success inline-flex min-h-10 items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold shadow-md shadow-emerald-600/20 disabled:opacity-60"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
            </button>
          </div>
        </div>

        {/* NOTICE ALERT */}
        {notice && (
          <div className={`mt-4 rounded-xl border p-4 text-sm ${notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : notice.tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
            <div className="flex items-center gap-2 font-semibold">
              {notice.tone === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              <span>{notice.message}</span>
            </div>
          </div>
        )}

        {/* STEP-BY-STEP GUIDE */}
        {showGuide && (
          <div className="mt-5 rounded-2xl border border-blue-200 bg-white p-5 text-sm text-gray-700 shadow-sm">
            <div className="flex items-center gap-2 font-bold text-blue-800 mb-3">
              <Info size={18} />
              Quy trình 4 bước thiết lập 12 Bot Telegram & ID Nhóm
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5">
                <div className="flex items-center gap-2 font-semibold text-gray-800">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">1</span>
                  Tạo Nhóm Telegram
                </div>
                <p className="mt-2 text-xs text-gray-600 leading-relaxed">
                  Mở Telegram, bấm tạo <b>New Group</b> (Nhóm mới), đặt tên ví dụ: <i>"Báo Cáo POS Bán Hàng"</i>.
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5">
                <div className="flex items-center gap-2 font-semibold text-gray-800">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">2</span>
                  Tạo 12 Bot & Lấy Token
                </div>
                <p className="mt-2 text-xs text-gray-600 leading-relaxed">
                  Chat với <code>@BotFather</code> trên Telegram, gõ lệnh <code>/newbot</code> để tạo 12 bot tương ứng và copy mã <b>HTTP API Token</b> dán vào 12 ô bên dưới.
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5">
                <div className="flex items-center gap-2 font-semibold text-gray-800">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">3</span>
                  Thêm Bot vào Nhóm
                </div>
                <p className="mt-2 text-xs text-gray-600 leading-relaxed">
                  Thêm cả 12 bot vào Nhóm vừa tạo. Cấp quyền <b>Admin</b> hoặc cho phép bot gửi tin nhắn trong nhóm.
                </p>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5">
                <div className="flex items-center gap-2 font-semibold text-gray-800">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs text-white">4</span>
                  Lấy ID Nhóm (Group ID)
                </div>
                <p className="mt-2 text-xs text-gray-600 leading-relaxed">
                  Thêm bot <code>@userinfobot</code> hoặc <code>@getmyid_bot</code> vào nhóm. Bot sẽ hiển thị Chat ID số âm (vd: <code>-1001234567890</code>). Dán vào ô ID Nhóm bên dưới.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* GLOBAL SWITCH & GROUP ID INPUT */}
      <div className="card space-y-5 p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b pb-5">
          <div>
            <div className="flex items-center gap-3">
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={e => handleUpdateField('enabled', e.target.checked)}
                  className="peer sr-only"
                />
                <div className="peer h-7 w-12 rounded-full bg-gray-200 after:absolute after:left-[3px] after:top-[3px] after:h-5.5 after:w-5.5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-emerald-600 peer-checked:after:translate-x-5 peer-checked:after:border-white peer-focus:outline-none"></div>
              </label>
              <div>
                <span className="text-base font-bold text-gray-800">
                  {form.enabled ? '🟢 Đang kích hoạt toàn bộ hệ thống Bot' : '⚪ Đang tắt hệ thống Bot Telegram'}
                </span>
                <p className="text-xs text-gray-500">
                  {form.enabled
                    ? 'Hệ thống tự động phát thông báo khi phát sinh giao dịch hoặc thay đổi dữ liệu.'
                    : 'Tạm dừng tất cả thông báo gửi qua Telegram. Dữ liệu bán hàng offline vẫn hoạt động bình thường.'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTestAll}
              disabled={testingAll || !form.group_id}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100 disabled:opacity-50"
            >
              {testingAll ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {testingAll ? `Đang kiểm tra ${totalBotsCount} Bot...` : `Kiểm tra tất cả ${totalBotsCount} Bot`}
            </button>
          </div>
        </div>

        {/* GROUP ID INPUT */}
        <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <label htmlFor="telegram-group-id" className="block text-sm font-bold text-gray-800">
                1. Ô Nhập ID Nhóm Telegram (Group Chat ID dùng chung cho cả {totalBotsCount} Bot)
              </label>
              <p className="text-xs text-gray-500 mt-0.5">
                Tất cả {totalBotsCount} Bot sẽ cùng gửi báo cáo thay đổi vào nhóm này. Định dạng thường là dãy số âm bắt đầu bằng <code>-100</code>.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-800 shadow-xs">
              <ShieldCheck size={14} className="text-blue-600" />
              1 Nhóm dùng chung
            </span>
          </div>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <input
                id="telegram-group-id"
                type="text"
                value={form.group_id}
                onChange={e => handleUpdateField('group_id', e.target.value)}
                placeholder="Ví dụ: -1001234567890 hoặc @ten_nhom_cong_khai"
                className="input-field w-full pl-10 font-mono text-sm font-medium tracking-wide placeholder:font-sans"
              />
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                <Users size={18} />
              </div>
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
              Lưu ID Nhóm
            </button>
          </div>
        </div>
      </div>

      {/* 12 BOT TOKENS ORGANIZED BY MENU MODULES */}
      <div className="space-y-8">
        {BOT_GROUPS.map(group => (
          <div key={group.key} className="space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                  <span>{group.title}</span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
                    {group.badge}
                  </span>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">{group.description}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {group.bots.map(bot => {
                const IconComponent = bot.icon;
                const botState = form.bots[bot.key] || {};
                const isEnabled = botState.enabled !== false;
                const tokenValue = botState.token || '';
                const isTesting = testingBot[bot.key];
                const testResult = testResults[bot.key];
                const isVisible = visibleTokens[bot.key];

                return (
                  <div
                    key={bot.key}
                    className={`flex flex-col justify-between rounded-2xl border bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md ${isEnabled ? 'border-gray-200' : 'border-gray-200 bg-gray-50/60 opacity-75'}`}
                  >
                    <div>
                      {/* CARD TOP ROW */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${bot.badgeColor}`}>
                            <IconComponent size={20} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-sm text-gray-800">{bot.name}</h4>
                            </div>
                            <span className="text-xs font-medium text-gray-500">
                              Chức năng: <b>{bot.menuTitle}</b>
                            </span>
                          </div>
                        </div>

                        {/* TOGGLE SWITCH FOR THIS BOT */}
                        <label className="relative inline-flex cursor-pointer items-center" title={isEnabled ? 'Tắt bot này' : 'Bật bot này'}>
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={() => handleToggleBot(bot.key)}
                            className="peer sr-only"
                          />
                          <div className="peer h-6 w-10 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-4 peer-checked:after:border-white peer-focus:outline-none"></div>
                        </label>
                      </div>

                      {/* DESCRIPTION */}
                      <p className="mt-2.5 text-xs text-gray-600 leading-relaxed min-h-[32px]">
                        {bot.desc}
                      </p>

                      {/* TOKEN INPUT FIELD */}
                      <div className="mt-3">
                        <label htmlFor={`bot-token-${bot.key}`} className="block text-xs font-semibold text-gray-700 mb-1">
                          Token Bot Telegram:
                        </label>
                        <div className="relative">
                          <input
                            id={`bot-token-${bot.key}`}
                            type={isVisible ? 'text' : 'password'}
                            value={tokenValue}
                            onChange={e => handleUpdateBotToken(bot.key, e.target.value)}
                            placeholder={bot.placeholder}
                            disabled={!isEnabled}
                            className="input-field w-full pr-10 font-mono text-xs disabled:bg-gray-100 disabled:text-gray-400"
                          />
                          <button
                            type="button"
                            onClick={() => toggleTokenVisibility(bot.key)}
                            className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                            title={isVisible ? 'Ẩn token' : 'Hiện token'}
                          >
                            {isVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* CARD FOOTER WITH TEST BUTTON & STATUS */}
                    <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {testResult ? (
                          <span className={`text-xs font-medium truncate block ${testResult.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {testResult.message || testResult.error}
                          </span>
                        ) : tokenValue ? (
                          <span className="text-[11px] text-gray-400">Đã nhập token</span>
                        ) : (
                          <span className="text-[11px] text-amber-600">Chưa nhập token</span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleTestBot(bot.key, bot.name)}
                        disabled={isTesting || !isEnabled || !tokenValue || !form.group_id}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                        title="Gửi tin nhắn mẫu từ bot này vào nhóm"
                      >
                        {isTesting ? <Loader2 size={13} className="animate-spin text-blue-600" /> : <Send size={13} className="text-blue-600" />}
                        {isTesting ? 'Đang gửi...' : 'Gửi thử nghiệm'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* BOTTOM ACTION BAR */}
      <div className="card sticky bottom-4 z-20 flex flex-col gap-3 rounded-2xl border-blue-200 bg-white/95 p-4 shadow-xl backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Zap size={18} className="text-amber-500 shrink-0" />
          <span>Hệ thống {totalBotsCount} Bot Telegram sẵn sàng hoạt động tự động khi bạn bấm Lưu.</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={loadSettings}
            disabled={loading || saving}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw size={16} /> Hoàn tác
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-success inline-flex min-h-10 items-center gap-2 rounded-xl px-6 py-2 text-sm font-semibold shadow-md shadow-emerald-600/20 disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {saving ? 'Đang lưu...' : `Lưu cấu hình ${totalBotsCount} Bot`}
          </button>
        </div>
      </div>
    </div>
  );
}
