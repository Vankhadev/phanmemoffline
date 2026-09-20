import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Wifi,
  WifiOff,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Server,
  Loader2,
  X,
  Clock,
  FileText,
  ArrowRight,
  Info,
} from 'lucide-react';
import {
  getPendingOrders,
  syncPendingOrders,
  checkServerReachable,
  PENDING_ORDERS_CHANGED_EVENT,
  SYNC_STATUS_CHANGED_EVENT,
} from '../utils/offlineSyncManager';

export default function OfflineSyncBadge({ className = '', compact = false }) {
  const [pendingOrders, setPendingOrders] = useState(() => getPendingOrders());
  const [isSyncing, setIsSyncing] = useState(false);
  const [isServerOnline, setIsServerOnline] = useState(true);
  const [syncProgress, setSyncProgress] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState(null);

  // Lắng nghe sự kiện thay đổi pending orders và sync status
  useEffect(() => {
    const handlePendingChanged = (e) => {
      const orders = e.detail?.orders || getPendingOrders();
      setPendingOrders(orders);
    };

    const handleSyncStatus = (e) => {
      if (typeof e.detail?.isSyncing === 'boolean') {
        setIsSyncing(e.detail.isSyncing);
      }
      if (typeof e.detail?.isServerOnline === 'boolean') {
        setIsServerOnline(e.detail.isServerOnline);
      }
    };

    const handleAutoSyncToast = (e) => {
      showToast(e.detail?.message || 'Đã tự động đồng bộ đơn lên PC!', 'success');
    };

    window.addEventListener(PENDING_ORDERS_CHANGED_EVENT, handlePendingChanged);
    window.addEventListener(SYNC_STATUS_CHANGED_EVENT, handleSyncStatus);
    window.addEventListener('kha-auto-sync-notification', handleAutoSyncToast);

    // Kiểm tra kết nối máy chủ ban đầu
    checkServerReachable(2000).then(online => setIsServerOnline(online));

    return () => {
      window.removeEventListener(PENDING_ORDERS_CHANGED_EVENT, handlePendingChanged);
      window.removeEventListener(SYNC_STATUS_CHANGED_EVENT, handleSyncStatus);
      window.removeEventListener('kha-auto-sync-notification', handleAutoSyncToast);
    };
  }, []);

  const showToast = (message, type = 'info') => {
    setFeedbackToast({ message, type, id: Date.now() });
    setTimeout(() => {
      setFeedbackToast(null);
    }, 4500);
  };

  const handleManualSync = async (e) => {
    if (e) e.stopPropagation();
    if (isSyncing) return;

    if (pendingOrders.length === 0) {
      // Kiểm tra lại kết nối
      const online = await checkServerReachable(2000);
      showToast(
        online
          ? '🟢 Máy chủ PC đang kết nối ổn định. Hiện không có đơn nào cần đồng bộ.'
          : '⚠️ Điện thoại đang ngoài quán / chưa kết nối Wi-Fi quán.',
        online ? 'info' : 'warning'
      );
      return;
    }

    setSyncProgress({ current: 1, total: pendingOrders.length });
    const result = await syncPendingOrders({
      onProgress: (p) => setSyncProgress(p),
      force: false,
    });

    setSyncProgress(null);

    if (result.success && result.count > 0) {
      showToast(`🎉 Đã đồng bộ thành công ${result.count} đơn hàng lên máy tính chủ PC!`, 'success');
      setShowModal(false);
    } else if (result.reason === 'unreachable') {
      setShowModal(true);
      showToast(
        `⚠️ Chưa kết nối được máy chủ PC. ${pendingOrders.length} đơn hàng vẫn lưu an toàn trên máy!`,
        'warning'
      );
    } else if (result.count > 0) {
      showToast(
        `Đã đồng bộ ${result.count} đơn, còn ${result.errors?.length || 0} đơn gặp sự cố kiểm tra.`,
        'warning'
      );
    }
  };

  const pendingCount = pendingOrders.length;

  return (
    <>
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        {pendingCount > 0 ? (
          // CÓ ĐƠN CHỜ ĐỒNG BỘ: Nút màu Cam/Hổ phách rực rỡ (Phương án 2)
          <button
            type="button"
            onClick={handleManualSync}
            disabled={isSyncing}
            className="group relative inline-flex min-h-9 sm:min-h-10 items-center gap-2 rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-bold text-white shadow-md shadow-orange-500/25 hover:from-amber-600 hover:to-orange-700 active:scale-95 transition-all duration-200"
            title="Nhấn để đồng bộ toàn bộ đơn hàng ngoại tuyến lên máy chủ PC"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-200 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
            </span>

            <RefreshCw
              size={15}
              className={`text-white shrink-0 ${isSyncing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`}
            />

            <span className="whitespace-nowrap">
              {isSyncing ? (
                syncProgress ? (
                  `Đang đồng bộ (${syncProgress.current}/${syncProgress.total})...`
                ) : (
                  'Đang đồng bộ...'
                )
              ) : (
                <>
                  <span className="hidden sm:inline">Đồng bộ dữ liệu</span>
                  <span className="sm:hidden">Đồng bộ</span>
                </>
              )}
            </span>

            <span className="inline-flex items-center justify-center rounded-full bg-white text-orange-600 font-extrabold text-[11px] h-5 min-w-5 px-1.5 shadow-xs">
              {pendingCount}
            </span>

            <span
              onClick={(e) => {
                e.stopPropagation();
                setShowModal(true);
              }}
              className="hidden sm:inline-block ml-0.5 text-amber-100 hover:text-white underline text-[11px] font-medium"
              title="Xem danh sách đơn"
            >
              (Xem)
            </span>
          </button>
        ) : (
          // KHÔNG CÓ ĐƠN CHỜ: Huy hiệu trạng thái kết nối máy chủ gọn gàng
          <button
            type="button"
            onClick={() => checkServerReachable(1500).then(online => {
              showToast(
                online
                  ? '🟢 Đã kết nối máy tính chủ PC (192.168.1.8) sẵn sàng!'
                  : '📡 Chưa kết nối Wi-Fi quán. Các đơn mới tạo sẽ tự động lưu vào máy (Offline).',
                online ? 'success' : 'warning'
              );
            })}
            className={`inline-flex min-h-8 sm:min-h-9 items-center gap-1.5 rounded-full px-2.5 sm:px-3 py-1 text-xs font-semibold transition border ${
              isServerOnline
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'
            }`}
            title={
              isServerOnline
                ? 'Máy chủ PC trực tuyến - Bấm để kiểm tra lại'
                : 'Đang ngoài quán (4G) - Đơn hàng sẽ lưu vào máy an toàn'
            }
          >
            {isServerOnline ? (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <Server size={13} className="text-emerald-600 shrink-0" />
                <span className={compact ? 'hidden' : 'hidden sm:inline'}>Máy chủ OK</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                <WifiOff size={13} className="text-amber-600 shrink-0" />
                <span className={compact ? 'hidden' : 'hidden sm:inline'}>Offline (Lưu máy)</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* TOAST THÔNG BÁO NHANH */}
      {feedbackToast && (
        <div className="fixed bottom-16 right-4 z-50 max-w-sm rounded-xl border border-gray-200 bg-white p-3.5 shadow-xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-3 dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-start gap-2.5">
            {feedbackToast.type === 'success' ? (
              <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
            ) : feedbackToast.type === 'warning' ? (
              <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
            ) : (
              <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 text-xs sm:text-sm font-medium text-gray-800 dark:text-gray-200">
              {feedbackToast.message}
            </div>
            <button
              onClick={() => setFeedbackToast(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* MODAL CHI TIẾT ĐƠN HÀNG CHỜ ĐỒNG BỘ */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900 border border-gray-200 dark:border-slate-800 max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            {/* Header Modal */}
            <div className="flex items-center justify-between border-b pb-3 border-gray-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
                  <RefreshCw size={20} className={isSyncing ? 'animate-spin' : ''} />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">
                    Đồng Bộ Đơn Hàng Ngoại Tuyến
                  </h3>
                  <p className="text-xs text-gray-500">
                    Hiện có <span className="font-bold text-orange-600">{pendingCount} đơn hàng</span> đang chờ đồng bộ
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            {/* Trạng thái kết nối máy chủ */}
            <div className="my-3 rounded-xl p-3 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-gray-700 dark:text-gray-300">Trạng thái máy chủ PC:</span>
                <span className={`inline-flex items-center gap-1 font-bold ${isServerOnline ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {isServerOnline ? (
                    <>
                      <CheckCircle2 size={14} /> Đang kết nối (192.168.1.8)
                    </>
                  ) : (
                    <>
                      <WifiOff size={14} /> Chưa kết nối Wi-Fi quán
                    </>
                  )}
                </span>
              </div>
              <p className="text-gray-500 text-xs leading-relaxed">
                {isServerOnline
                  ? 'Máy tính chủ PC đã sẵn sàng. Bạn có thể nhấn nút "Đồng bộ ngay" để đẩy tất cả đơn hàng lên máy chủ.'
                  : '⚠️ Điện thoại đang ngoài quán (4G). Toàn bộ đơn hàng vẫn được lưu an toàn 100% trong bộ nhớ máy. Khi về cửa hàng và kết nối Wi-Fi quán, dữ liệu sẽ tự động đồng bộ.'}
              </p>
            </div>

            {/* Danh sách các đơn chờ */}
            <div className="flex-1 overflow-y-auto space-y-2 py-1 pr-1">
              {pendingOrders.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">
                  <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-2" />
                  Không có đơn hàng nào đang chờ đồng bộ.
                </div>
              ) : (
                pendingOrders.map((order, idx) => (
                  <div
                    key={order.client_order_id || order.invoice_code || idx}
                    className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/70 p-3 text-xs sm:text-sm dark:border-slate-800 dark:bg-slate-800/40"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 dark:text-white">
                          {order.invoice_code || 'Đơn offline'}
                        </span>
                        <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700">
                          Chờ đẩy lên PC
                        </span>
                      </div>
                      <div className="text-gray-500 text-xs mt-0.5 truncate">
                        Khách: {order.customer_name || 'Khách lẻ'} • {order.cart?.length || 0} món
                      </div>
                      <div className="text-gray-400 text-[11px] flex items-center gap-1 mt-0.5">
                        <Clock size={11} />
                        {new Date(order.created_at).toLocaleTimeString('vi-VN')} {new Date(order.created_at).toLocaleDateString('vi-VN')}
                      </div>
                      {order.last_sync_error && (
                        <div className="text-red-500 text-[11px] mt-1 font-medium">
                          ⚠️ Lần thử trước: {order.last_sync_error}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-blue-600 text-sm">
                        {(Number(order.total) || 0).toLocaleString('vi-VN')} đ
                      </div>
                      <div className="text-[11px] text-gray-400">
                        {order.payment_method === 'bank' ? 'Chuyển khoản' : 'Tiền mặt'}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer hành động */}
            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-1 text-[11px] text-gray-500">
                <ShieldCheck size={14} className="text-emerald-500 shrink-0" />
                <span>Không mất mát dữ liệu</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-gray-200 px-3.5 py-2 text-xs sm:text-sm font-semibold text-gray-700 hover:bg-gray-100 dark:border-slate-700 dark:text-gray-300"
                >
                  Đóng
                </button>
                {pendingCount > 0 && (
                  <button
                    type="button"
                    onClick={handleManualSync}
                    disabled={isSyncing}
                    className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-xs sm:text-sm font-bold text-white shadow-md hover:bg-orange-600 active:scale-95 transition disabled:opacity-50"
                  >
                    {isSyncing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Đang đồng bộ...
                      </>
                    ) : (
                      <>
                        <RefreshCw size={16} />
                        Đồng bộ tất cả ngay
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
