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
} from 'lucide-react';
import QRCode from 'qrcode';
import { apiJson } from '../utils/apiClient';

function AndroidIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9996.4482.9996.9993.0001.5511-.4485.9997-.9996.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1523-.5676.416.416 0 00-.5676.1523l-2.0223 3.503C15.5902 8.4123 13.8533 8.0833 12 8.0833s-3.5902.329-5.1366.8666L4.8411 5.4469a.416.416 0 00-.5676-.1523.416.416 0 00-.1523.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.7778h24c-.3432-4.1189-2.6889-7.5911-6.1185-9.4564" />
    </svg>
  );
}

export default function QuickMobileConnectModal({ isOpen, onClose }) {
  const [networkInfo, setNetworkInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    apiJson('/api/mobile/network-info')
      .then(res => {
        if (res && res.ok) {
          setNetworkInfo(res);
          const activeUrl = res.customMobileUrl?.trim() || res.defaultMobileUrl || `http://${res.primaryIp || '127.0.0.1'}:5174`;
          QRCode.toDataURL(activeUrl, {
            width: 280,
            margin: 2,
            color: { dark: '#0f172a', light: '#ffffff' },
            errorCorrectionLevel: 'M',
          }).then(url => setQrDataUrl(url));
        }
      })
      .catch(err => console.error('[QR MODAL] Lỗi:', err))
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const activeUrl = networkInfo?.customMobileUrl?.trim()
    || networkInfo?.defaultMobileUrl
    || `http://${networkInfo?.primaryIp || '127.0.0.1'}:5174`;

  const handleCopy = () => {
    navigator.clipboard.writeText(activeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-gray-100">
        {/* CLOSE BUTTON */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition"
        >
          <X size={18} />
        </button>

        {/* HEADER */}
        <div className="flex items-center gap-3 border-b pb-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-500/20">
            <Smartphone size={22} />
          </div>
          <div>
            <h3 className="font-bold text-base text-gray-800">Kết Nối Điện Thoại POS</h3>
            <p className="text-xs text-gray-500">Quét mã QR để mở app trên iPhone hoặc Android</p>
          </div>
        </div>

        {/* BODY */}
        <div className="py-4 space-y-4 text-center">
          {loading ? (
            <div className="flex h-56 items-center justify-center text-gray-400">
              <Loader2 size={32} className="animate-spin text-purple-600" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center">
              <div className="rounded-2xl border-2 border-purple-200 bg-white p-2.5 shadow-md">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="QR Code" className="h-52 w-52 rounded-xl object-contain" />
                ) : (
                  <div className="flex h-52 w-52 items-center justify-center text-gray-300">
                    <QrCode size={48} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* URL & COPY */}
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2 text-left">
            <input
              type="text"
              readOnly
              value={activeUrl}
              className="flex-1 bg-transparent px-2 font-mono text-xs text-gray-800 outline-none select-all truncate"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100 transition"
            >
              {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
              {copied ? 'Đã chép' : 'Sao chép'}
            </button>
          </div>

          {/* HƯỚNG DẪN NHANH */}
          <div className="grid grid-cols-2 gap-2 text-left text-[11px] text-gray-600 pt-1">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-2.5">
              <div className="flex items-center gap-1.5 font-bold text-gray-800 mb-1">
                <Apple size={14} /> iPhone (iOS)
              </div>
              <p>Mở Safari quét QR ➔ Bấm nút <b>Chia sẻ</b> ➔ Chọn <b>"Thêm vào MH chính"</b>.</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-2.5">
              <div className="flex items-center gap-1.5 font-bold text-gray-800 mb-1">
                <AndroidIcon size={14} className="text-emerald-600" /> Android
              </div>
              <p>Mở Chrome quét QR ➔ Bấm menu 3 chấm ➔ Chọn <b>"Tạo lối tắt"</b> (hoặc Cài đặt).</p>
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div className="border-t pt-3 flex items-center justify-between">
          <span className="text-[11px] text-gray-400 flex items-center gap-1">
            <Wifi size={12} className="text-blue-500" /> Cùng mạng WiFi với máy tính
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-gray-100 px-4 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-200 transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
