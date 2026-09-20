import React, { useState, useEffect, useCallback } from 'react';
import {
  Smartphone,
  QrCode,
  Download,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Zap,
  Info,
  Globe,
  Wifi,
  Apple,
  CheckCircle2,
  AlertCircle,
  Share2,
  PlusSquare,
  HelpCircle,
  Loader2,
} from 'lucide-react';
import QRCode from 'qrcode';
import { apiJson, getApiErrorMessage } from '../utils/apiClient';

function AndroidIcon({ size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9996.4482.9996.9993.0001.5511-.4485.9997-.9996.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1523-.5676.416.416 0 00-.5676.1523l-2.0223 3.503C15.5902 8.4123 13.8533 8.0833 12 8.0833s-3.5902.329-5.1366.8666L4.8411 5.4469a.416.416 0 00-.5676-.1523.416.416 0 00-.1523.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.7778h24c-.3432-4.1189-2.6889-7.5911-6.1185-9.4564" />
    </svg>
  );
}

export default function MobileAppDownloadPanel() {
  const [networkInfo, setNetworkInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrMode, setQrMode] = useState('app'); // 'app' | 'apk'
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [notice, setNotice] = useState(null);

  // Form cấu hình Domain / Link tùy chỉnh
  const [customMobileUrl, setCustomMobileUrl] = useState('');
  const [customApkUrl, setCustomApkUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Lấy thông tin mạng LAN từ Backend
  const loadNetworkInfo = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiJson('/api/mobile/network-info');
      if (res && res.ok) {
        setNetworkInfo(res);
        setCustomMobileUrl(res.customMobileUrl || '');
        setCustomApkUrl(res.customApkUrl || '');
      }
    } catch (err) {
      setNotice({
        tone: 'error',
        message: getApiErrorMessage(err, 'Không thể lấy thông tin mạng máy chủ.'),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNetworkInfo();
  }, [loadNetworkInfo]);

  // URL thực tế để tạo QR Code
  const activeUrl = qrMode === 'app'
    ? (customMobileUrl.trim() || networkInfo?.defaultMobileUrl || `http://${networkInfo?.primaryIp || '127.0.0.1'}:5174`)
    : (customApkUrl.trim() || networkInfo?.apkDownloadUrl || `${networkInfo?.defaultMobileUrl || ''}/downloads/banhangpos-mobile.apk`);

  // Tạo QR Code khi activeUrl thay đổi
  useEffect(() => {
    if (!activeUrl) return;
    QRCode.toDataURL(activeUrl, {
      width: 320,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then(url => setQrDataUrl(url))
      .catch(err => console.error('[QR] Lỗi tạo QR Code:', err));
  }, [activeUrl]);

  // Sao chép liên kết vào Clipboard
  const handleCopyLink = () => {
    if (!activeUrl) return;
    navigator.clipboard.writeText(activeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Tải ảnh QR Code về máy
  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `qrcode-${qrMode === 'app' ? 'pos-mobile' : 'apk-download'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Lưu cấu hình URL tùy chỉnh
  const handleSaveConfig = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await apiJson('/api/mobile/network-info', {
        method: 'PUT',
        body: {
          customMobileUrl,
          customApkUrl,
        },
      });
      if (res && res.ok) {
        setNotice({
          tone: 'success',
          message: 'Đã lưu cấu hình kết nối di động thành công!',
        });
        loadNetworkInfo();
      }
    } catch (err) {
      setNotice({
        tone: 'error',
        message: getApiErrorMessage(err, 'Lưu cấu hình thất bại.'),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="card flex min-h-[320px] flex-col items-center justify-center gap-3 text-gray-500">
        <Loader2 size={32} className="animate-spin text-purple-600" />
        <span className="text-sm font-medium">Đang phát hiện địa chỉ mạng và tạo mã QR kết nối...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* BANNER HEADER */}
      <div className="card border-purple-100 bg-gradient-to-r from-purple-50/70 via-indigo-50/40 to-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-500/20">
              <Smartphone size={28} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-gray-800">Tải & Kết Nối Ứng Dụng Di Động</h2>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                  Hỗ trợ iPhone & Android
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-600">
                Quét mã QR để mở app và bán hàng trực tiếp trên điện thoại cùng mạng WiFi, cài đặt ra màn hình chính trong 3 giây.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadNetworkInfo}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
            >
              <RefreshCw size={16} /> Làm mới IP
            </button>
          </div>
        </div>

        {notice && (
          <div className={`mt-4 rounded-xl border p-4 text-sm ${notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
            <div className="flex items-center gap-2 font-semibold">
              {notice.tone === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              <span>{notice.message}</span>
            </div>
          </div>
        )}
      </div>

      {/* MAIN CONTENT GRID */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* CỘT TRÁI: KHỐI MÃ QR CODE KẾT NỐI (5 Cột) */}
        <div className="xl:col-span-5 space-y-4">
          <div className="card space-y-5 p-6 shadow-sm border-gray-200 text-center">
            {/* TABS CHỌN CHẾ ĐỘ QR */}
            <div className="inline-flex rounded-xl bg-gray-100 p-1 w-full">
              <button
                type="button"
                onClick={() => setQrMode('app')}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${qrMode === 'app' ? 'bg-white text-purple-700 shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
              >
                📱 Quét Mở App (PWA)
              </button>
              <button
                type="button"
                onClick={() => setQrMode('apk')}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${qrMode === 'apk' ? 'bg-white text-purple-700 shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
              >
                🤖 Quét Tải file APK
              </button>
            </div>

            {/* HỘP HIỂN THỊ MÃ QR CODE */}
            <div className="flex flex-col items-center justify-center">
              <div className="relative rounded-3xl border-4 border-purple-100 bg-white p-3 shadow-lg transition-transform hover:scale-[1.02]">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="QR Code kết nối POS Di Động"
                    className="h-60 w-60 rounded-2xl object-contain sm:h-64 sm:w-64"
                  />
                ) : (
                  <div className="flex h-60 w-60 items-center justify-center rounded-2xl bg-gray-50 text-gray-400">
                    <QrCode size={64} className="animate-pulse" />
                  </div>
                )}
                <div className="absolute inset-x-0 -bottom-3 flex justify-center">
                  <span className="rounded-full bg-purple-600 px-3 py-1 text-[11px] font-bold text-white shadow-md">
                    {qrMode === 'app' ? 'Mở App Bán Hàng' : 'Tải File Cài Đặt APK'}
                  </span>
                </div>
              </div>
            </div>

            {/* ĐƯỜNG DẪN KẾT NỐI & NÚT COPY */}
            <div className="pt-2 space-y-2">
              <div className="text-xs font-semibold text-gray-500">Đường dẫn kết nối thiết bị:</div>
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/80 p-2 text-left">
                <input
                  type="text"
                  readOnly
                  value={activeUrl}
                  className="flex-1 bg-transparent px-2 font-mono text-xs text-gray-800 outline-none select-all truncate"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100 transition shrink-0"
                >
                  {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  {copied ? 'Đã sao chép' : 'Sao chép'}
                </button>
              </div>

              <div className="flex justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleDownloadQr}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3.5 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100"
                >
                  <Download size={14} /> Tải ảnh QR
                </button>
                <a
                  href={activeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  <ExternalLink size={14} /> Mở thử trong tab mới
                </a>
              </div>
            </div>

            {/* THÔNG TIN MẠNG NỘI BỘ */}
            <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5 text-left text-xs text-gray-600 space-y-1">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 font-semibold text-gray-700">
                  <Wifi size={14} className="text-blue-600" /> IP máy tính nội bộ:
                </span>
                <span className="font-mono font-bold text-gray-800">{networkInfo?.primaryIp || '127.0.0.1'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Cổng Frontend / Web POS:</span>
                <span className="font-mono">{networkInfo?.frontendPort || 5174}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Cổng Backend API:</span>
                <span className="font-mono">{networkInfo?.backendPort || 7000}</span>
              </div>
            </div>
          </div>
        </div>

        {/* CỘT PHẢI: HƯỚNG DẪN CÀI ĐẶT IPHONE & ANDROID (7 Cột) */}
        <div className="xl:col-span-7 space-y-5">
          {/* CARD 1: DÀNH CHO IPHONE (iOS) */}
          <div className="card space-y-4 p-5 shadow-sm border-gray-200">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-black text-white">
                  <Apple size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-gray-800">Dành cho iPhone / iPad (iOS)</h3>
                  <p className="text-xs text-gray-500">Cài đặt PWA tức thì ra màn hình chính, không cần App Store</p>
                </div>
              </div>
              <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
                Safari PWA
              </span>
            </div>

            <div className="space-y-3 text-xs text-gray-700">
              <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">1</span>
                <div>
                  <div className="font-semibold text-gray-800">Mở Safari và quét mã QR</div>
                  <p className="text-gray-600 mt-0.5">
                    Bật camera iPhone quét mã QR ở bên trái (hoặc nhập đường dẫn vào trình duyệt <b>Safari</b>).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">2</span>
                <div>
                  <div className="font-semibold text-gray-800 flex items-center gap-1.5">
                    <span>Bấm nút Chia sẻ</span>
                    <Share2 size={13} className="text-blue-600" />
                  </div>
                  <p className="text-gray-600 mt-0.5">
                    Ở thanh điều hướng dưới cùng của Safari, bấm biểu tượng <b>Chia sẻ</b> (hình ô vuông có mũi tên chỉ lên).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">3</span>
                <div>
                  <div className="font-semibold text-gray-800 flex items-center gap-1.5">
                    <span>Chọn "Thêm vào Màn hình chính"</span>
                    <PlusSquare size={13} className="text-purple-600" />
                  </div>
                  <p className="text-gray-600 mt-0.5">
                    Cuộn xuống và chọn <b>"Thêm vào Màn hình chính" (Add to Home Screen)</b> ➔ Nhấn <b>Thêm</b> ở góc trên cùng.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              <span>
                <b>Hoàn tất:</b> Icon "Bán Hàng Pos" sẽ xuất hiện trên màn hình iPhone, bấm mở sẽ chạy <b>toàn màn hình</b> như ứng dụng tải từ App Store!
              </span>
            </div>
          </div>

          {/* CARD 2: DÀNH CHO ANDROID */}
          <div className="card space-y-4 p-5 shadow-sm border-gray-200">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white">
                  <AndroidIcon size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-gray-800">Dành cho Điện thoại Android</h3>
                  <p className="text-xs text-gray-500">Linh hoạt chọn cài PWA Chrome hoặc Tải trực tiếp file APK</p>
                </div>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                PWA / File APK
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 space-y-2">
                <div className="font-bold text-gray-800 flex items-center gap-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] text-white">A</span>
                  Cách 1: Ghim ra màn hình chính (Khuyên dùng)
                </div>
                <p className="text-gray-700">
                  Mở <b>Google Chrome</b> quét mã QR. Bấm menu 3 chấm ➔ Chọn <b>"Cài đặt và tạo lối tắt"</b> ➔ Bấm dòng thứ 2: <b>"Tạo lối tắt" (Lối tắt sẽ mở trong Chrome)</b>.
                </p>
                <div className="rounded-lg border border-emerald-300 bg-white p-2 text-[11px] text-emerald-800 font-medium">
                  👉 <b>Mẹo:</b> Khi bấm "Tạo lối tắt", biểu tượng ứng dụng sẽ lập tức xuất hiện trên màn hình chính điện thoại, mở lên dùng toàn màn hình và hoạt động cả khi mất mạng!
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3.5 space-y-2">
                <div className="font-bold text-gray-800 flex items-center gap-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] text-white">B</span>
                  Cách 2: Cài qua File APK
                </div>
                <p className="text-gray-600">
                  Tải trực tiếp file <code>.apk</code> về điện thoại để cài đặt mà không cần Google Play Store.
                </p>
                <div className="pt-1">
                  <a
                    href={networkInfo?.apkDownloadUrl || '#'}
                    download
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 transition"
                  >
                    <Download size={13} /> Tải file APK Android
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* CARD 3: CẤU HÌNH TÊN MIỀN TỪ XA (ADVANCED CONFIG) */}
          <div className="card p-5 shadow-sm border-gray-200 space-y-3">
            <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowAdvanced(!showAdvanced)}>
              <div className="flex items-center gap-2">
                <Globe size={18} className="text-indigo-600" />
                <span className="font-bold text-sm text-gray-800">Cấu hình Tên miền từ xa / Cloudflare Tunnel</span>
              </div>
              <button type="button" className="text-xs font-semibold text-indigo-600 hover:underline">
                {showAdvanced ? 'Thu gọn' : 'Tùy chỉnh URL'}
              </button>
            </div>

            {showAdvanced && (
              <div className="space-y-3 pt-2 text-xs">
                <p className="text-gray-600">
                  Nếu bạn dùng <b>Cloudflare Tunnel, Ngrok</b> hoặc có <b>Tên miền riêng (Domain HTTPS)</b> để nhân viên đi giao hàng bán hàng từ xa qua 4G/5G, hãy nhập URL vào đây. Mã QR sẽ tự động đổi sang tên miền này:
                </p>

                <div>
                  <label htmlFor="custom-mobile-url" className="block font-semibold text-gray-700 mb-1">
                    URL Tên miền POS di động (HTTPS / Domain):
                  </label>
                  <input
                    id="custom-mobile-url"
                    type="text"
                    value={customMobileUrl}
                    onChange={e => setCustomMobileUrl(e.target.value)}
                    placeholder="Ví dụ: https://pos.cuahangcuaban.com hoặc https://xxx.trycloudflare.com"
                    className="input-field w-full font-mono text-xs"
                  />
                </div>

                <div>
                  <label htmlFor="custom-apk-url" className="block font-semibold text-gray-700 mb-1">
                    URL Tải file APK trực tiếp (Tùy chọn):
                  </label>
                  <input
                    id="custom-apk-url"
                    type="text"
                    value={customApkUrl}
                    onChange={e => setCustomApkUrl(e.target.value)}
                    placeholder="Ví dụ: https://github.com/Vankhadev/phanmemoffline/releases/latest/download/app-release.apk"
                    className="input-field w-full font-mono text-xs"
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={handleSaveConfig}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {saving ? 'Đang lưu...' : 'Lưu URL tùy chỉnh'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
