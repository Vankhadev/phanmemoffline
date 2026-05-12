import { useCallback, useEffect, useMemo, useState } from 'react';

const INSTALL_DISMISS_KEY = 'kha-pwa-install-dismissed-at';
const INSTALL_DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getNavigatorStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true;
}

function getIosSafari() {
  if (typeof navigator === 'undefined') return false;
  const userAgent = String(navigator.userAgent || navigator.vendor || '').toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /safari/.test(userAgent) && !/crios|fxios|edgios|opr|chrome|android/.test(userAgent);
  return isIos && isSafari;
}

function isInstallDismissed() {
  if (typeof window === 'undefined') return false;
  try {
    const dismissedAt = Number(window.localStorage.getItem(INSTALL_DISMISS_KEY) || 0);
    return dismissedAt > 0 && Date.now() - dismissedAt < INSTALL_DISMISS_TTL_MS;
  } catch (_) {
    return false;
  }
}

function markInstallDismissed() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
  } catch (_) {
    // Bỏ qua nếu trình duyệt chặn localStorage.
  }
}

export default function PwaInstallPrompt() {
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installDismissed, setInstallDismissed] = useState(() => isInstallDismissed());
  const [isStandalone, setIsStandalone] = useState(() => getNavigatorStandalone());
  const [installMessage, setInstallMessage] = useState('');
  const isIosSafari = useMemo(() => getIosSafari(), []);
  const isElectron = typeof window !== 'undefined' && window.khaDesktop?.isElectron;

  useEffect(() => {
    const updateOnlineState = () => setIsOnline(typeof navigator === 'undefined' || navigator.onLine !== false);
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
    };
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
      setInstallDismissed(isInstallDismissed());
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      setInstallMessage('Ứng dụng đã được cài đặt trên thiết bị.');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const installMode = useMemo(() => {
    if (isElectron || isStandalone || installDismissed) return 'none';
    if (deferredPrompt) return 'native';
    if (isIosSafari) return 'ios';
    return 'none';
  }, [deferredPrompt, installDismissed, isElectron, isIosSafari, isStandalone]);

  const handleInstallClick = useCallback(async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      if (choice?.outcome === 'accepted') {
        setInstallMessage('Đang cài ứng dụng. Sau khi hoàn tất, hãy mở từ màn hình chính.');
      } else {
        markInstallDismissed();
        setInstallDismissed(true);
        setInstallMessage('Bạn có thể cài ứng dụng sau từ nút cài đặt của trình duyệt.');
      }
    } catch (_) {
      setInstallMessage('Không thể mở hộp thoại cài đặt lúc này. Vui lòng thử từ menu trình duyệt.');
    }
  }, [deferredPrompt]);

  const handleDismissInstall = useCallback(() => {
    markInstallDismissed();
    setInstallDismissed(true);
    setDeferredPrompt(null);
    setInstallMessage('');
  }, []);

  const showInstallCard = installMode !== 'none';
  const showFullCard = showInstallCard || !isOnline || installMessage;
  const statusClass = isOnline ? 'bg-emerald-500' : 'bg-red-500';
  const statusText = isOnline ? 'Online' : 'Offline';

  return (
    <div
      className="pointer-events-none fixed inset-x-3 z-[60] flex justify-end sm:left-auto sm:max-w-md"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
    >
      <div className={`pointer-events-auto border shadow-xl ${showFullCard ? 'w-full rounded-2xl bg-white/95 p-3 text-gray-800 backdrop-blur sm:w-96' : 'rounded-full bg-white/90 px-3 py-2 text-gray-700 backdrop-blur'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusClass}`} aria-hidden="true" />
            <span>{statusText}</span>
            {!showFullCard && <span className="text-xs font-normal text-gray-500">· PWA sẵn sàng</span>}
          </div>
          {showInstallCard && (
            <button
              type="button"
              onClick={handleDismissInstall}
              className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Ẩn hướng dẫn cài đặt"
            >
              Đóng
            </button>
          )}
        </div>

        {showFullCard && (
          <div className="mt-2 space-y-2 text-sm leading-relaxed text-gray-600">
            {!isOnline && (
              <p>
                Đang mất kết nối. App shell vẫn có thể mở từ cache sau lần tải thành công; dữ liệu/API cần backend nội bộ sẽ đồng bộ lại khi online theo cơ chế hiện có.
              </p>
            )}

            {installMessage && <p>{installMessage}</p>}

            {installMode === 'native' && (
              <div className="flex flex-col gap-2 rounded-xl bg-blue-50 p-3 text-blue-800">
                <div className="font-semibold">Cài ứng dụng để mở nhanh trên màn hình chính</div>
                <p className="text-xs text-blue-700">Phù hợp Android/Chrome/Edge. Ứng dụng chạy dạng standalone và vẫn mở được khung giao diện khi mạng nội bộ chập chờn.</p>
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="min-h-10 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:bg-blue-800"
                >
                  Cài ứng dụng
                </button>
              </div>
            )}

            {installMode === 'ios' && (
              <div className="rounded-xl bg-blue-50 p-3 text-blue-800">
                <div className="font-semibold">Cài trên iPhone/iPad</div>
                <p className="mt-1 text-xs text-blue-700">Mở bằng Safari, chạm nút Chia sẻ, chọn “Thêm vào Màn hình chính”, rồi mở ứng dụng từ icon vừa tạo.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
