import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  QrCode,
  X,
  Copy,
  Check,
  ExternalLink,
  Wifi,
  Apple,
  Download,
  Loader2,
  Share2,
  PlusSquare,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import QRCode from 'qrcode';
import { apiJson } from '../utils/apiClient';

function AndroidIcon({ size = 18, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9996.4482.9996.9993.0001.5511-.4485.9997-.9996.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1523-.5676.416.416 0 00-.5676.1523l-2.0223 3.503C15.5902 8.4123 13.8533 8.0833 12 8.0833s-3.5902.329-5.1366.8666L4.8411 5.4469a.416.416 0 00-.5676-.1523.416.416 0 00-.1523.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.7778h24c-.3432-4.1189-2.6889-7.5911-6.1185-9.4564" />
    </svg>
  );
}

export default function QuickMobileConnectModal({ isOpen, onClose }) {
  const [networkInfo, setNetworkInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('iphone'); // 'iphone' | 'android'
  const [qrIphoneUrl, setQrIphoneUrl] = useState('');
  const [qrAndroidUrl, setQrAndroidUrl] = useState('');
  const [copiedType, setCopiedType] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    apiJson('/api/mobile/network-info')
      .then(res => {
        if (res && res.ok) {
          setNetworkInfo(res);
          const activePort = res.webPort || res.frontendPort || res.backendPort || 7000;
          const baseUrl = res.customMobileUrl?.trim() || res.defaultMobileUrl || `http://${res.primaryIp || '127.0.0.1'}:${activePort}`;
          const apkUrl = res.customApkUrl?.trim() || res.apkDownloadUrl || `${baseUrl}/downloads/banhangpos-mobile.apk`;

          // Tạo QR cho iPhone (mở web app PWA)
          QRCode.toDataURL(baseUrl, {
            width: 260,
            margin: 2,
            color: { dark: '#0f172a', light: '#ffffff' },
            errorCorrectionLevel: 'M',
          }).then(url => setQrIphoneUrl(url)).catch(() => {});

          // Tạo QR cho Android (mở link tải APK hoặc app)
          QRCode.toDataURL(apkUrl, {
            width: 260,
            margin: 2,
            color: { dark: '#064e3b', light: '#ffffff' },
            errorCorrectionLevel: 'M',
          }).then(url => setQrAndroidUrl(url)).catch(() => {});
        }
      })
      .catch(err => console.error('[QR MODAL] Lỗi:', err))
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const activePort = networkInfo?.webPort || networkInfo?.frontendPort || networkInfo?.backendPort || 7000;
  const iphoneUrl = networkInfo?.customMobileUrl?.trim()
    || networkInfo?.defaultMobileUrl
    || `http://${networkInfo?.primaryIp || '127.0.0.1'}:${activePort}`;

  const androidApkUrl = networkInfo?.customApkUrl?.trim()
    || networkInfo?.apkDownloadUrl
    || `${iphoneUrl}/downloads/banhangpos-mobile.apk`;

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-3xl bg-white shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[92vh]">
        {/* HEADER */}
        <div className="bg-gradient-to-r from-purple-700 via-indigo-700 to-blue-700 px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-xs">
              <Smartphone size={24} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base">Tải Phần Mềm Về Điện Thoại</h3>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                  Offline LAN
                </span>
              </div>
              <p className="text-xs text-purple-100 mt-0.5">
                Tạo sẵn 2 link tải cho iPhone và Android — Ấn link để tải và đăng nhập bằng tài khoản đã có
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* TABS CHỌN DÒNG MÁY */}
        <div className="flex border-b border-gray-100 bg-gray-50/70 p-2 gap-2">
          <button
            type="button"
            onClick={() => setTab('iphone')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-bold text-xs transition ${tab === 'iphone' ? 'bg-black text-white shadow-md' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <Apple size={17} />
            <span>1. Dòng máy iPhone (iOS)</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('android')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-bold text-xs transition ${tab === 'android' ? 'bg-emerald-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            <AndroidIcon size={17} />
            <span>2. Dòng máy Android</span>
          </button>
        </div>

        {/* BODY CONTENT */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs text-gray-700">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <Loader2 size={32} className="animate-spin text-purple-600" />
              <span className="font-medium">Đang phát hiện kết nối mạng nội bộ...</span>
            </div>
          ) : tab === 'iphone' ? (
            /* TAB 1: IPHONE (iOS) */
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* LINK DÀNH CHO IPHONE */}
              <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gray-800 flex items-center gap-1.5">
                    <Apple size={15} /> Link tải / mở ứng dụng cho iPhone:
                  </span>
                  <span className="text-[11px] font-semibold text-blue-600">Safari PWA</span>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white p-2">
                  <input
                    type="text"
                    readOnly
                    value={iphoneUrl}
                    className="flex-1 bg-transparent px-2 font-mono text-xs text-gray-800 outline-none select-all truncate font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(iphoneUrl, 'iphone')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 transition shrink-0"
                  >
                    {copiedType === 'iphone' ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                    {copiedType === 'iphone' ? 'Đã sao chép' : 'Sao chép link'}
                  </button>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <a
                    href={iphoneUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3.5 py-1.5 font-semibold text-gray-700 hover:bg-gray-50 transition"
                  >
                    <ExternalLink size={13} /> Mở thử link trong trình duyệt
                  </a>
                </div>
              </div>

              {/* QR CODE & HƯỚNG DẪN IPHONE */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                <div className="sm:col-span-5 flex flex-col items-center justify-center p-3 rounded-2xl border border-gray-200 bg-white shadow-xs">
                  {qrIphoneUrl ? (
                    <img src={qrIphoneUrl} alt="QR iPhone" className="h-44 w-44 rounded-xl object-contain" />
                  ) : (
                    <div className="h-44 w-44 flex items-center justify-center bg-gray-50 text-gray-300">
                      <QrCode size={40} />
                    </div>
                  )}
                  <span className="mt-2 text-[11px] font-semibold text-gray-500">Quét bằng Camera iPhone</span>
                </div>

                <div className="sm:col-span-7 space-y-2.5">
                  <div className="font-bold text-gray-800 text-sm">3 bước cài ứng dụng lên iPhone:</div>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2.5 rounded-xl border border-gray-100 bg-gray-50 p-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-[10px] font-bold text-white">1</span>
                      <div>
                        <span className="font-semibold text-gray-800">Quét QR hoặc ấn vào Link</span>
                        <p className="text-gray-500 text-[11px]">Mở liên kết bằng trình duyệt <b>Safari</b> trên iPhone.</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 rounded-xl border border-gray-100 bg-gray-50 p-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-[10px] font-bold text-white">2</span>
                      <div>
                        <span className="font-semibold text-gray-800 flex items-center gap-1">
                          Bấm nút Chia sẻ <Share2 size={12} className="text-blue-600" />
                        </span>
                        <p className="text-gray-500 text-[11px]">Bấm nút Chia sẻ ở thanh dưới cùng Safari ➔ Chọn <b>"Thêm vào MH chính"</b> (Add to Home Screen).</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 rounded-xl border border-gray-100 bg-gray-50 p-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-[10px] font-bold text-white">3</span>
                      <div>
                        <span className="font-semibold text-gray-800">Đăng nhập tài khoản đã có</span>
                        <p className="text-gray-500 text-[11px]">Icon app sẽ xuất hiện trên màn hình iPhone, mở lên và đăng nhập bằng tài khoản bạn đang dùng.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* TAB 2: ANDROID */
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* LINK DÀNH CHO ANDROID */}
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-gray-800 flex items-center gap-1.5">
                    <AndroidIcon size={16} className="text-emerald-600" /> Link tải trực tiếp file cài đặt APK cho Android:
                  </span>
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                    File .APK
                  </span>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-white p-2">
                  <input
                    type="text"
                    readOnly
                    value={androidApkUrl}
                    className="flex-1 bg-transparent px-2 font-mono text-xs text-gray-800 outline-none select-all truncate font-semibold"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(androidApkUrl, 'android-apk')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 transition shrink-0"
                  >
                    {copiedType === 'android-apk' ? <Check size={13} className="text-emerald-300" /> : <Copy size={13} />}
                    {copiedType === 'android-apk' ? 'Đã chép' : 'Sao chép link APK'}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <a
                    href={androidApkUrl}
                    download="banhangpos-mobile.apk"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition"
                  >
                    <Download size={14} /> Tải phần mềm về máy Android (.APK)
                  </a>

                  <a
                    href={iphoneUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3.5 py-2 font-semibold text-emerald-800 hover:bg-emerald-50 transition"
                  >
                    <ExternalLink size={13} /> Mở Web App trên Chrome
                  </a>
                </div>
              </div>

              {/* QR CODE & HƯỚNG DẪN ANDROID */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                <div className="sm:col-span-5 flex flex-col items-center justify-center p-3 rounded-2xl border border-emerald-200 bg-white shadow-xs">
                  {qrAndroidUrl ? (
                    <img src={qrAndroidUrl} alt="QR Android" className="h-44 w-44 rounded-xl object-contain" />
                  ) : (
                    <div className="h-44 w-44 flex items-center justify-center bg-gray-50 text-gray-300">
                      <QrCode size={40} />
                    </div>
                  )}
                  <span className="mt-2 text-[11px] font-semibold text-emerald-700">Quét để tải file APK về Android</span>
                </div>

                <div className="sm:col-span-7 space-y-2.5">
                  <div className="font-bold text-gray-800 text-sm">2 cách cài trên điện thoại Android:</div>
                  <div className="space-y-2">
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-2.5">
                      <span className="font-bold text-emerald-900 block">Cách 1: Cài đặt qua file APK (Trực tiếp)</span>
                      <p className="text-gray-600 text-[11px] mt-0.5">
                        Bấm nút <b>"Tải phần mềm về máy Android"</b> ở trên ➔ Mở tệp vừa tải ➔ Bấm <b>Cài đặt</b>.
                      </p>
                    </div>

                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-2.5">
                      <span className="font-bold text-gray-800 block">Cách 2: Ghim PWA ra màn hình Chrome</span>
                      <p className="text-gray-600 text-[11px] mt-0.5">
                        Mở liên kết bằng Chrome ➔ Menu 3 chấm ➔ Chọn <b>"Cài đặt ứng dụng"</b> (hoặc "Tạo lối tắt").
                      </p>
                    </div>

                    <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-2 text-[11px] text-blue-800 font-medium flex items-center gap-1.5">
                      <CheckCircle2 size={14} className="text-blue-600 shrink-0" />
                      <span>Sau khi mở app, <b>đăng nhập bằng tài khoản và mật khẩu đã có</b> của bạn.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div className="border-t border-gray-100 bg-gray-50/80 px-6 py-3.5 flex items-center justify-between">
          <div className="text-[11px] text-gray-500 flex items-center gap-1.5">
            <Wifi size={13} className="text-blue-600" />
            <span>Điện thoại cần kết nối <b>chung mạng WiFi</b> với máy tính máy chủ POS ({networkInfo?.primaryIp || '127.0.0.1'}).</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-gray-200 hover:bg-gray-300 px-4 py-1.5 text-xs font-semibold text-gray-700 transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
