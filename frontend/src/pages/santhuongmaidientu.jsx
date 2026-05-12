import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Link2,
  PackageCheck,
  RefreshCw,
  Settings,
  ShieldCheck,
  Store,
  Unlink,
  WalletCards,
  Wrench,
} from 'lucide-react';

const VIEW_STATES = {
  NORMAL: 'normal',
  LOADING: 'loading',
  EMPTY: 'empty',
  ERROR: 'error',
};

const TIKTOK_SHOP_AUTH_URL = import.meta.env.VITE_TIKTOK_SHOP_AUTH_URL;

const PLATFORM_CONFIGS = [
  {
    id: 'tiktok-shop',
    name: 'TikTok Shop',
    shortName: 'TT',
    accentClass: 'from-gray-950 to-pink-600',
    badgeClass: 'bg-pink-50 text-pink-700 border-pink-100',
    description: 'Theo dõi đơn hàng, tồn kho và hiệu suất bán hàng trên TikTok Shop.',
    defaultShop: {
      shopName: 'PM Offline - TikTok Mall',
      shopCode: 'TTS-PMO-1024',
      connected: true,
      lastSync: '2026-05-12T03:25:00+07:00',
      syncStatus: 'Đồng bộ thành công',
      syncTone: 'success',
      metrics: {
        orders: 48,
        revenue: 18200000,
        products: 126,
      },
    },
  },
  {
    id: 'shopee',
    name: 'Shopee',
    shortName: 'SP',
    accentClass: 'from-orange-500 to-red-500',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-100',
    description: 'Quản lý kết nối gian hàng, trạng thái đồng bộ sản phẩm và đơn Shopee.',
    defaultShop: {
      shopName: 'Phần Mềm Offline Store',
      shopCode: 'SPE-PMO-2405',
      connected: true,
      lastSync: '2026-05-12T02:48:00+07:00',
      syncStatus: 'Đang chờ kiểm tra tồn kho',
      syncTone: 'warning',
      metrics: {
        orders: 72,
        revenue: 25950000,
        products: 212,
      },
    },
  },
  {
    id: 'lazada',
    name: 'Lazada',
    shortName: 'LZ',
    accentClass: 'from-blue-700 to-violet-600',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-100',
    description: 'Chuẩn bị kết nối và kiểm soát thông tin gian hàng Lazada tập trung.',
    defaultShop: {
      shopName: 'Chưa liên kết gian hàng',
      shopCode: '—',
      connected: false,
      lastSync: null,
      syncStatus: 'Chưa kết nối',
      syncTone: 'neutral',
      metrics: {
        orders: 0,
        revenue: 0,
        products: 0,
      },
    },
  },
];

const TODO_ITEMS = [
  {
    id: 'verify-products',
    title: 'Rà soát sản phẩm chưa khớp mã SKU',
    detail: '18 sản phẩm cần kiểm tra trước khi bật đồng bộ tự động.',
    tone: 'warning',
  },
  {
    id: 'sync-orders',
    title: 'Kiểm tra đơn hàng mới trong ngày',
    detail: 'Ưu tiên các đơn đang chờ xác nhận từ TikTok Shop và Shopee.',
    tone: 'success',
  },
  {
    id: 'connect-lazada',
    title: 'Hoàn tất kết nối gian hàng Lazada',
    detail: 'Chuẩn bị mã gian hàng và quyền truy cập để cấu hình.',
    tone: 'neutral',
  },
];

const STATE_OPTIONS = [
  { value: VIEW_STATES.NORMAL, label: 'Dữ liệu mẫu' },
  { value: VIEW_STATES.LOADING, label: 'Loading' },
  { value: VIEW_STATES.EMPTY, label: 'Empty' },
  { value: VIEW_STATES.ERROR, label: 'Error' },
];

function formatCurrency(value) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDateTime(value) {
  if (!value) return 'Chưa có dữ liệu';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa có dữ liệu';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createInitialPlatforms() {
  return PLATFORM_CONFIGS.map(platform => ({
    ...platform,
    shop: { ...platform.defaultShop, metrics: { ...platform.defaultShop.metrics } },
  }));
}

function getSyncToneClasses(tone) {
  const tones = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    warning: 'bg-amber-50 text-amber-700 border-amber-100',
    neutral: 'bg-gray-50 text-gray-600 border-gray-100',
    error: 'bg-red-50 text-red-700 border-red-100',
  };
  return tones[tone] || tones.neutral;
}

function PlatformLogo({ platform }) {
  return (
    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${platform.accentClass} text-sm font-bold text-white shadow-sm`}>
      {platform.shortName}
    </div>
  );
}

function StatusPill({ connected }) {
  return connected ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
      Đã kết nối
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-gray-100 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600">
      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
      Chưa kết nối
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center shadow-sm">
      <Store className="mx-auto h-12 w-12 text-gray-300" aria-hidden="true" />
      <h2 className="mt-4 text-lg font-semibold text-gray-800">Chưa có gian hàng nào được liên kết</h2>
      <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-600">
        Hãy chọn một nền tảng bên dưới để bắt đầu cấu hình kết nối và theo dõi đồng bộ tập trung.
      </p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="rounded-xl border border-red-100 bg-red-50 p-6 shadow-sm" role="alert">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <AlertCircle className="h-6 w-6 shrink-0 text-red-600" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold text-red-800">Không thể hiển thị dữ liệu mô phỏng</h2>
          <p className="mt-1 text-sm text-red-700">
            Trạng thái lỗi nội bộ được dùng để kiểm tra giao diện. Không có yêu cầu mạng nào được thực hiện.
          </p>
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" aria-busy="true" aria-live="polite">
      {[1, 2, 3].map(item => (
        <div key={item} className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 animate-pulse rounded-2xl bg-gray-100" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-48 animate-pulse rounded bg-gray-100" />
            </div>
          </div>
          <div className="mt-6 space-y-3">
            <div className="h-3 animate-pulse rounded bg-gray-100" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-gray-100" />
            <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SanThuongMaiDienTu({ store }) {
  const navigate = useNavigate();
  const [viewState, setViewState] = useState(VIEW_STATES.NORMAL);
  const [platforms, setPlatforms] = useState(createInitialPlatforms);
  const [selectedPlatformId, setSelectedPlatformId] = useState('tiktok-shop');
  const [connectionNotice, setConnectionNotice] = useState(null);

  const visiblePlatforms = viewState === VIEW_STATES.EMPTY ? [] : platforms;
  const connectedPlatforms = visiblePlatforms.filter(platform => platform.shop.connected);

  const summaryCards = useMemo(() => {
    const totals = connectedPlatforms.reduce(
      (acc, platform) => {
        acc.orders += platform.shop.metrics.orders;
        acc.revenue += platform.shop.metrics.revenue;
        acc.products += platform.shop.metrics.products;
        return acc;
      },
      { orders: 0, revenue: 0, products: 0 },
    );

    return [
      {
        title: 'Nền tảng đã kết nối',
        value: `${connectedPlatforms.length}/${PLATFORM_CONFIGS.length}`,
        description: 'TikTok Shop, Shopee, Lazada',
        icon: Link2,
        color: 'text-blue-600 bg-blue-50',
      },
      {
        title: 'Đơn hàng hôm nay',
        value: totals.orders.toLocaleString('vi-VN'),
        description: 'Tổng từ các gian hàng mẫu',
        icon: PackageCheck,
        color: 'text-emerald-600 bg-emerald-50',
      },
      {
        title: 'Doanh thu ghi nhận',
        value: formatCurrency(totals.revenue),
        description: 'Chỉ dùng dữ liệu mô phỏng',
        icon: WalletCards,
        color: 'text-amber-600 bg-amber-50',
      },
      {
        title: 'Sản phẩm đang theo dõi',
        value: totals.products.toLocaleString('vi-VN'),
        description: 'Sẵn sàng đối soát tồn kho',
        icon: BarChart3,
        color: 'text-violet-600 bg-violet-50',
      },
    ];
  }, [connectedPlatforms]);

  const selectedPlatform = platforms.find(platform => platform.id === selectedPlatformId) || platforms[0];

  const updatePlatformConnection = (platformId, connected) => {
    setPlatforms(current => current.map(platform => {
      if (platform.id !== platformId) return platform;

      const defaultShop = platform.defaultShop;
      return {
        ...platform,
        shop: connected
          ? {
              ...defaultShop,
              metrics: { ...defaultShop.metrics },
              connected: true,
              lastSync: new Date().toISOString(),
              syncStatus: 'Đã kết nối và chờ đồng bộ tiếp theo',
              syncTone: 'success',
            }
          : {
              shopName: 'Chưa liên kết gian hàng',
              shopCode: '—',
              connected: false,
              lastSync: null,
              syncStatus: 'Đã ngắt kết nối',
              syncTone: 'neutral',
              metrics: { orders: 0, revenue: 0, products: 0 },
            },
      };
    }));
  };

  const handleConnectPlatform = (platform) => {
    if (platform.id === 'tiktok-shop') {
      if (!TIKTOK_SHOP_AUTH_URL) {
        setConnectionNotice({
          tone: 'warning',
          message: 'Chưa cấu hình URL liên kết TikTok Shop. Vui lòng thiết lập VITE_TIKTOK_SHOP_AUTH_URL trước khi kết nối.',
        });
        return;
      }

      window.location.assign(TIKTOK_SHOP_AUTH_URL);
      return;
    }

    setConnectionNotice(null);
    updatePlatformConnection(platform.id, true);
  };

  const handleConfigure = (platformId) => {
    setSelectedPlatformId(platformId);
    navigate('/cai-dat', {
      state: { from: '/san-thuong-mai-dien-tu', platformId },
    });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-5 shadow-sm md:p-6" aria-labelledby="marketplace-title">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white px-3 py-1 text-xs font-semibold text-blue-700 shadow-sm">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Quản lý kết nối đa sàn
            </div>
            <h1 id="marketplace-title" className="mt-4 text-2xl font-bold text-gray-900 md:text-3xl">
              Sàn thương mại điện tử
            </h1>
            <p className="mt-2 text-sm leading-6 text-gray-600 md:text-base">
              Theo dõi trạng thái kết nối, đồng bộ gian hàng và số liệu vận hành cho {store?.name || 'cửa hàng'} trên TikTok Shop, Shopee và Lazada bằng dữ liệu mẫu tại máy.
            </p>
          </div>

          <div className="rounded-xl border border-white bg-white/80 p-4 shadow-sm backdrop-blur lg:min-w-72">
            <label htmlFor="mock-state" className="text-sm font-semibold text-gray-800">
              Chế độ hiển thị dữ liệu
            </label>
            <select
              id="mock-state"
              className="input-field mt-2 bg-white focus:ring-2 focus:ring-blue-500"
              value={viewState}
              onChange={event => setViewState(event.target.value)}
              aria-label="Chọn trạng thái dữ liệu mô phỏng"
            >
              {STATE_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-gray-500">Các trạng thái này chỉ dùng local state, không gọi API.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="summary-title">
        <h2 id="summary-title" className="sr-only">Báo cáo nhanh</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map(card => {
            const Icon = card.icon;
            return (
              <article key={card.title} className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-500">{card.title}</p>
                    <p className="mt-2 text-2xl font-bold text-gray-900">{card.value}</p>
                  </div>
                  <div className={`rounded-xl p-3 ${card.color}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                </div>
                <p className="mt-3 text-sm text-gray-500">{card.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      {viewState === VIEW_STATES.LOADING && <LoadingState />}
      {viewState === VIEW_STATES.ERROR && <ErrorState />}
      {viewState === VIEW_STATES.EMPTY && <EmptyState />}

      {viewState === VIEW_STATES.NORMAL && (
        <>
          {connectionNotice && (
            <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 p-4 text-amber-800" role="alert">
              <div className="flex gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <p className="text-sm font-medium">{connectionNotice.message}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <section className="xl:col-span-2" aria-labelledby="platforms-title">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 id="platforms-title" className="text-xl font-bold text-gray-900">Nền tảng kết nối</h2>
                  <p className="text-sm text-gray-600">Quản lý nhanh trạng thái từng sàn và thao tác cấu hình.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {visiblePlatforms.map(platform => (
                  <article key={platform.id} className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex gap-3">
                        <PlatformLogo platform={platform} />
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-gray-900">{platform.name}</h3>
                            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${platform.badgeClass}`}>Sàn TMDT</span>
                          </div>
                          <p className="mt-1 text-sm leading-6 text-gray-600">{platform.description}</p>
                        </div>
                      </div>
                      <StatusPill connected={platform.shop.connected} />
                    </div>

                    <dl className="mt-5 grid grid-cols-1 gap-3 rounded-xl bg-gray-50 p-4 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-gray-500">Tên shop</dt>
                        <dd className="mt-1 font-semibold text-gray-900">{platform.shop.shopName}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Mã shop</dt>
                        <dd className="mt-1 font-semibold text-gray-900">{platform.shop.shopCode}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Lần đồng bộ gần nhất</dt>
                        <dd className="mt-1 font-semibold text-gray-900">{formatDateTime(platform.shop.lastSync)}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Trạng thái đồng bộ</dt>
                        <dd className={`mt-1 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getSyncToneClasses(platform.shop.syncTone)}`}>
                          {platform.shop.syncStatus}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-5 grid grid-cols-3 gap-2 text-center text-sm">
                      <div className="rounded-lg border border-gray-100 p-3">
                        <p className="font-bold text-gray-900">{platform.shop.metrics.orders}</p>
                        <p className="text-xs text-gray-500">Đơn</p>
                      </div>
                      <div className="rounded-lg border border-gray-100 p-3">
                        <p className="font-bold text-gray-900">{platform.shop.metrics.products}</p>
                        <p className="text-xs text-gray-500">SP</p>
                      </div>
                      <div className="rounded-lg border border-gray-100 p-3">
                        <p className="font-bold text-gray-900">{formatCurrency(platform.shop.metrics.revenue)}</p>
                        <p className="text-xs text-gray-500">Doanh thu</p>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <button
                        type="button"
                        className="btn-success inline-flex min-h-11 items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={platform.shop.connected}
                        onClick={() => handleConnectPlatform(platform)}
                        aria-label={`Kết nối ${platform.name}`}
                      >
                        <Link2 className="h-4 w-4" aria-hidden="true" />
                        Kết nối
                      </button>
                      <button
                        type="button"
                        className="btn-danger inline-flex min-h-11 items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!platform.shop.connected}
                        onClick={() => updatePlatformConnection(platform.id, false)}
                        aria-label={`Ngắt kết nối ${platform.name}`}
                      >
                        <Unlink className="h-4 w-4" aria-hidden="true" />
                        Ngắt
                      </button>
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded bg-white px-4 py-2 font-medium text-gray-700 ring-1 ring-inset ring-gray-200 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                        onClick={() => handleConfigure(platform.id)}
                        aria-label={`Cấu hình ${platform.name}`}
                      >
                        <Settings className="h-4 w-4" aria-hidden="true" />
                        Cấu hình
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <aside className="space-y-6" aria-label="Việc cần làm và công cụ kết nối">
              <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm" aria-labelledby="todo-title">
                <h2 id="todo-title" className="text-lg font-bold text-gray-900">Cần làm hôm nay</h2>
                <div className="mt-4 space-y-3">
                  {TODO_ITEMS.map(item => (
                    <article key={item.id} className="rounded-lg border border-gray-100 p-4">
                      <div className="flex gap-3">
                        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.tone === 'warning' ? 'bg-amber-500' : item.tone === 'success' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                        <div>
                          <h3 className="font-semibold text-gray-900">{item.title}</h3>
                          <p className="mt-1 text-sm leading-6 text-gray-600">{item.detail}</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-blue-100 bg-blue-50 p-5 shadow-sm" aria-labelledby="tools-title">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-white p-3 text-blue-600 shadow-sm">
                    <Wrench className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 id="tools-title" className="text-lg font-bold text-gray-900">Công cụ & nhắc kết nối</h2>
                    <p className="text-sm text-gray-600">Ưu tiên hoàn tất cấu hình các sàn chưa liên kết.</p>
                  </div>
                </div>
                <div className="mt-4 space-y-3 text-sm text-gray-700">
                  <p className="flex items-start gap-2">
                    <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                    Đặt lịch đối soát tồn kho sau khi kết nối thành công.
                  </p>
                  <p className="flex items-start gap-2">
                    <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                    Kiểm tra quyền truy cập gian hàng trước khi bấm kết nối.
                  </p>
                </div>
              </section>
            </aside>
          </div>

          <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm" aria-labelledby="connections-title">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="connections-title" className="text-xl font-bold text-gray-900">Bảng kết nối gian hàng</h2>
                <p className="text-sm text-gray-600">Tổng hợp shop đã liên kết, mã shop và trạng thái đồng bộ gần nhất.</p>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                Đang chọn: <span className="font-semibold text-gray-900">{selectedPlatform?.name}</span>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                    <th scope="col" className="py-3 pr-4 font-semibold">Nền tảng</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Tên shop</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Mã shop</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Kết nối</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Đồng bộ gần nhất</th>
                    <th scope="col" className="pl-4 py-3 font-semibold">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visiblePlatforms.map(platform => (
                    <tr key={platform.id} className="align-top">
                      <td className="py-4 pr-4">
                        <div className="flex items-center gap-3">
                          <PlatformLogo platform={platform} />
                          <span className="font-semibold text-gray-900">{platform.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-gray-700">{platform.shop.shopName}</td>
                      <td className="px-4 py-4 font-mono text-xs text-gray-700">{platform.shop.shopCode}</td>
                      <td className="px-4 py-4"><StatusPill connected={platform.shop.connected} /></td>
                      <td className="px-4 py-4 text-gray-700">{formatDateTime(platform.shop.lastSync)}</td>
                      <td className="pl-4 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getSyncToneClasses(platform.shop.syncTone)}`}>
                          {platform.shop.syncStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
