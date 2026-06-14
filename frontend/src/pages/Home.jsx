import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, BarChart3, Calendar, FileText, HelpCircle, Layers, Package, PackageSearch, ShoppingCart, Store, TrendingUp } from 'lucide-react';
import { ApiError, apiJsonChecked } from '../utils/apiClient';
import { globalSyncEmitter } from '../utils/eventEmitter';
import HelpModal from '../components/HelpModal';
import { formatStockValue, getNegativeStockLimitLabel, getNegativeStockNearLimitLabel, getStockDisplayMeta } from '../utils/negativeStock';
import useNegativeStockSettings from '../utils/useNegativeStockSettings';

const EMPTY_STATS = {
  todayRevenue: 0,
  todayOrders: 0,
  paidOrders: 0,
  totalProducts: 0,
  outOfStock: 0,
  lowStock: 0,
  negativeStockCount: 0,
  negativeStockNearLimitCount: 0,
  negativeStockBreachedCount: 0,
  lowestNegativeStock: 0,
  negativeStockProducts: [],
};

const SUMMARY_SYNC_TABLES = ['invoices', 'invoice_details', 'products', 'daily_stats', 'import_logs', 'import_details'];

function normalizeNegativeStockProduct(product = {}) {
  const stock = Number(product.stock ?? product.current_stock ?? product.currentStock ?? 0);
  return {
    ...product,
    id: product.id ?? product.product_id ?? product.variant_id ?? '',
    sku: product.sku || product.product_sku || product.variant_sku || '',
    name: product.name || product.product_name || product.variant_name || product.sku || 'Sản phẩm',
    stock: Number.isFinite(stock) ? stock : 0,
  };
}

function hasNegativeStockFields(data = {}) {
  const summary = data?.summary || {};
  return Boolean(
    data?.negativeStock
    || data?.negative_stock
    || data?.stock?.negative_stock
    || data?.stock?.negativeStock
    || summary.negativeStock
    || summary.negative_stock
    || summary.negativeStockCount !== undefined
    || summary.negative_stock_count !== undefined
    || data?.negativeStockCount !== undefined
    || data?.negative_stock_count !== undefined
  );
}

function extractNegativeStockStats(data = {}, negativeStockSettings = undefined) {
  const summary = data?.summary || {};
  const negativeStock = data?.negativeStock
    || data?.negative_stock
    || data?.stock?.negative_stock
    || data?.stock?.negativeStock
    || summary.negativeStock
    || summary.negative_stock
    || {};
  const productCandidates = [
    negativeStock.products,
    negativeStock.negative_products,
    negativeStock.items,
    summary.negativeStockProducts,
    summary.negative_stock_products,
    data?.negativeStockProducts,
    data?.negative_stock_products,
    data?.lowStock,
  ].find(Array.isArray) || [];
  const products = productCandidates
    .map(normalizeNegativeStockProduct)
    .filter(product => product.stock < 0);
  const nearLimitProducts = products.filter(product => getStockDisplayMeta(product.stock, negativeStockSettings).isNearLimit);
  const breachedProducts = products.filter(product => getStockDisplayMeta(product.stock, negativeStockSettings).isBreached);
  const lowestStock = products.length > 0 ? Math.min(...products.map(product => product.stock)) : 0;

  return {
    count: Number(
      negativeStock.negative_count
      ?? negativeStock.negativeCount
      ?? summary.negativeStockCount
      ?? summary.negative_stock_count
      ?? data?.negativeStockCount
      ?? data?.negative_stock_count
      ?? products.length
    ) || 0,
    nearLimitCount: Number(
      negativeStock.near_limit_count
      ?? negativeStock.nearLimitCount
      ?? summary.negativeStockNearLimitCount
      ?? summary.negative_stock_near_limit_count
      ?? data?.negativeStockNearLimitCount
      ?? data?.negative_stock_near_limit_count
      ?? nearLimitProducts.length
    ) || 0,
    breachedCount: Number(
      negativeStock.breached_count
      ?? negativeStock.breachedCount
      ?? summary.negativeStockBreachedCount
      ?? summary.negative_stock_breached_count
      ?? data?.negativeStockBreachedCount
      ?? data?.negative_stock_breached_count
      ?? breachedProducts.length
    ) || 0,
    lowestStock: Number(
      negativeStock.lowest_stock
      ?? negativeStock.lowestStock
      ?? summary.lowestNegativeStock
      ?? summary.lowest_negative_stock
      ?? data?.lowestNegativeStock
      ?? data?.lowest_negative_stock
      ?? lowestStock
    ) || 0,
    products,
  };
}

export default function Home({ user, store = {} }) {
  const [stats, setStats] = useState(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [statsMessage, setStatsMessage] = useState('');
  const [statsMessageTone, setStatsMessageTone] = useState('info');
  const { settings: negativeStockSettings } = useNegativeStockSettings();
  const negativeStockLimitLabel = useMemo(() => getNegativeStockLimitLabel(negativeStockSettings), [negativeStockSettings]);
  const negativeStockNearLimitLabel = useMemo(() => getNegativeStockNearLimitLabel(negativeStockSettings), [negativeStockSettings]);

  const formatVND = useCallback((value) => {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0,
    }).format(Number(value) || 0);
  }, []);

  const fetchStats = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setStatsMessage('');
    setStatsMessageTone('info');

    try {
      const data = await apiJsonChecked('/dashboard/summary', {}, 'Không thể tải thống kê trang chủ.');
      let negativeStockSource = data;
      if (!hasNegativeStockFields(data)) {
        try {
          negativeStockSource = await apiJsonChecked('/stats/summary', {}, 'Không thể tải thống kê âm kho.');
        } catch (_) {
          negativeStockSource = data;
        }
      }
      const summary = data?.summary || data || {};
      const negativeStockInfo = extractNegativeStockStats(negativeStockSource, negativeStockSettings);

      setStats({
        todayRevenue: Number(summary.todayRevenue) || 0,
        todayOrders: Number(summary.todayOrders) || 0,
        paidOrders: Number(summary.paidOrders) || 0,
        totalProducts: Number(summary.totalProducts) || 0,
        outOfStock: Number(summary.outOfStock) || 0,
        lowStock: Number(summary.lowStock) || 0,
        negativeStockCount: negativeStockInfo.count,
        negativeStockNearLimitCount: negativeStockInfo.nearLimitCount,
        negativeStockBreachedCount: negativeStockInfo.breachedCount,
        lowestNegativeStock: negativeStockInfo.lowestStock,
        negativeStockProducts: negativeStockInfo.products,
      });
    } catch (error) {
      setStats(EMPTY_STATS);

      if (error instanceof ApiError && Number(error.status) === 403) {
        setStatsMessage('Tài khoản hiện tại chưa được cấp quyền xem thống kê. Trang chủ vẫn hiển thị đầy đủ các khu vực còn lại.');
        setStatsMessageTone('warning');
      } else {
        setStatsMessage('Không thể tải thống kê lúc này. Dữ liệu sẽ tự đồng bộ lại khi kết nối ổn định.');
        setStatsMessageTone('info');
      }
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [negativeStockSettings]);

  useEffect(() => {
    fetchStats();

    const handleSyncRefresh = () => {
      fetchStats(false);
      console.log('[SYNC] Dashboard refreshed');
    };

    const unsubscribeCreated = globalSyncEmitter.on('ORDER_CREATED', handleSyncRefresh);
    const unsubscribeDeleted = globalSyncEmitter.on('ORDER_DELETED', handleSyncRefresh);

    return () => {
      unsubscribeCreated();
      unsubscribeDeleted();
    };
  }, [fetchStats]);

  const statCards = useMemo(() => ([
    {
      title: 'Doanh thu hôm nay',
      value: formatVND(stats.todayRevenue),
      sub: 'Đã gồm các đơn hoàn tất trong ngày',
      icon: BarChart3,
      textColor: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      title: 'Đơn hàng hôm nay',
      value: stats.todayOrders.toLocaleString('vi-VN'),
      sub: `${stats.paidOrders.toLocaleString('vi-VN')} đã thanh toán`,
      icon: ShoppingCart,
      textColor: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      title: 'Tổng sản phẩm',
      value: stats.totalProducts.toLocaleString('vi-VN'),
      sub: `${stats.outOfStock.toLocaleString('vi-VN')} sản phẩm tồn 0`,
      icon: Package,
      textColor: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      title: 'Cảnh báo tồn kho',
      value: (stats.outOfStock + stats.lowStock + stats.negativeStockCount).toLocaleString('vi-VN'),
      sub: `${stats.lowStock.toLocaleString('vi-VN')} sắp hết · ${stats.negativeStockCount.toLocaleString('vi-VN')} âm kho`,
      icon: AlertCircle,
      textColor: 'text-red-600',
      bgColor: 'bg-red-50',
    },
    {
      title: 'Âm kho',
      value: stats.negativeStockCount.toLocaleString('vi-VN'),
      sub: stats.negativeStockCount > 0
        ? `${stats.negativeStockNearLimitCount.toLocaleString('vi-VN')} ${negativeStockNearLimitLabel || `gần ${negativeStockLimitLabel}`} · thấp nhất ${formatStockValue(stats.lowestNegativeStock)}`
        : `Không có sản phẩm âm kho; ngưỡng ${negativeStockLimitLabel}`,
      icon: AlertCircle,
      textColor: stats.negativeStockNearLimitCount > 0 ? 'text-orange-600' : 'text-red-600',
      bgColor: stats.negativeStockNearLimitCount > 0 ? 'bg-orange-50' : 'bg-red-50',
    },
  ]), [formatVND, negativeStockLimitLabel, negativeStockNearLimitLabel, stats.lowStock, stats.lowestNegativeStock, stats.negativeStockCount, stats.negativeStockNearLimitCount, stats.outOfStock, stats.paidOrders, stats.todayOrders, stats.todayRevenue, stats.totalProducts]);

  const quickActions = useMemo(() => ([
    {
      to: '/san-pham',
      label: 'Quản lý sản phẩm',
      icon: Layers,
      borderClass: 'border-purple-100 hover:border-purple-500 hover:bg-purple-50',
      iconWrapClass: 'bg-purple-100 group-hover:bg-purple-500',
      iconClass: 'text-purple-600 group-hover:text-white',
    },
    {
      to: '/danh-sach-don-hang',
      label: 'Đơn hàng',
      icon: ShoppingCart,
      borderClass: 'border-green-100 hover:border-green-500 hover:bg-green-50',
      iconWrapClass: 'bg-green-100 group-hover:bg-green-500',
      iconClass: 'text-green-600 group-hover:text-white',
    },
    {
      to: '/thong-ke',
      label: 'Thống kê',
      icon: TrendingUp,
      borderClass: 'border-orange-100 hover:border-orange-500 hover:bg-orange-50',
      iconWrapClass: 'bg-orange-100 group-hover:bg-orange-500',
      iconClass: 'text-orange-600 group-hover:text-white',
    },
    {
      to: '/bao-cao-theo-don-hang',
      label: 'Báo cáo đơn hàng',
      icon: FileText,
      borderClass: 'border-red-100 hover:border-red-500 hover:bg-red-50',
      iconWrapClass: 'bg-red-100 group-hover:bg-red-500',
      iconClass: 'text-red-600 group-hover:text-white',
    },
    {
      to: '/kho-hang',
      label: 'Kho hàng',
      icon: Package,
      borderClass: 'border-blue-100 hover:border-blue-500 hover:bg-blue-50',
      iconWrapClass: 'bg-blue-100 group-hover:bg-blue-500',
      iconClass: 'text-blue-600 group-hover:text-white',
    },
    {
      to: '/nha-cung-cap',
      label: 'Nhà cung cấp',
      icon: Store,
      borderClass: 'border-pink-100 hover:border-pink-500 hover:bg-pink-50',
      iconWrapClass: 'bg-pink-100 group-hover:bg-pink-500',
      iconClass: 'text-pink-600 group-hover:text-white',
    },
    {
      to: '/bao-cao-theo-san-pham',
      label: 'Báo cáo sản phẩm',
      icon: PackageSearch,
      borderClass: 'border-yellow-100 hover:border-yellow-500 hover:bg-yellow-50',
      iconWrapClass: 'bg-yellow-100 group-hover:bg-yellow-500',
      iconClass: 'text-yellow-600 group-hover:text-white',
    },
  ]), []);

  const todayLabel = useMemo(() => {
    return new Date().toLocaleDateString('vi-VN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }, []);

  const statsMessageClass = statsMessageTone === 'warning'
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-blue-200 bg-blue-50 text-blue-800';

  return (
    <div className="min-w-0 space-y-6">
      <div className="rounded-2xl border border-gray-100 bg-white px-5 py-5 shadow-sm sm:px-6 sm:py-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-800">Trang chủ</h1>
              {store?.name ? (
                <span className="inline-flex max-w-full items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  {store.name}
                </span>
              ) : null}
            </div>
            <p className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
              <Calendar size={16} />
              <span className="capitalize">{todayLabel}</span>
            </p>
            <p className="max-w-3xl text-sm leading-6 text-gray-500">
              Theo dõi nhanh doanh thu, tồn kho và truy cập các khu vực làm việc quan trọng từ một màn hình tổng quan thống nhất.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center xl:justify-end">
            <button
              type="button"
              onClick={() => setShowHelp(true)}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
            >
              <HelpCircle size={14} /> Hướng dẫn
            </button>
            <div className="rounded-2xl bg-gray-50 px-4 py-3 text-left sm:min-w-[220px] sm:text-right">
              <div className="text-sm text-gray-500">Xin chào</div>
              <div className="truncate text-base font-semibold text-gray-800">{user?.name || 'Người dùng'}</div>
              <div className="truncate text-xs text-gray-400">{user?.email || store?.phone || 'Đang làm việc trên hệ thống bán hàng'}</div>
            </div>
          </div>
        </div>
      </div>

      {statsMessage ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${statsMessageClass}`}>
          {statsMessage}
        </div>
      ) : null}

      {stats.negativeStockCount > 0 ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${stats.negativeStockNearLimitCount > 0 ? 'border-orange-200 bg-orange-50 text-orange-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
          <div className="font-bold">⚠️ Có {stats.negativeStockCount.toLocaleString('vi-VN')} sản phẩm đang âm kho</div>
          <div className="mt-1 text-xs">
            {stats.negativeStockNearLimitCount.toLocaleString('vi-VN')} sản phẩm {negativeStockNearLimitLabel || `gần ngưỡng ${negativeStockLimitLabel}`}; thấp nhất {formatStockValue(stats.lowestNegativeStock)}.
          </div>
          {stats.negativeStockProducts.length > 0 ? (
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {stats.negativeStockProducts.slice(0, 6).map((product, index) => {
                const stockMeta = getStockDisplayMeta(product.stock, negativeStockSettings);
                return (
                  <div key={`${product.id || product.sku || product.name}-${index}`} className={`rounded-xl border px-3 py-2 ${stockMeta.isNearLimit ? 'border-orange-200 bg-white/70' : 'border-red-200 bg-white/70'}`}>
                    <div className={`truncate text-xs font-semibold ${stockMeta.nameClass}`}>{product.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-gray-500">SKU: {product.sku || '—'}</span>
                      <span className={stockMeta.textClass}>{stockMeta.display}</span>
                      <span className={`rounded-full px-2 py-0.5 font-bold ${stockMeta.badgeClass}`}>Âm kho</span>
                      {stockMeta.isNearLimit ? <span className="rounded-full border border-orange-200 bg-orange-100 px-2 py-0.5 font-bold text-orange-800">{stockMeta.extraLabel || negativeStockNearLimitLabel || `Gần ${negativeStockLimitLabel}`}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-blue-500" />
          <h2 className="text-lg font-bold text-gray-800">Tổng quan trong ngày</h2>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={`home-stat-skeleton-${index}`} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-3">
                    <div className="h-4 w-28 animate-pulse rounded bg-gray-100" />
                    <div className="h-8 w-36 animate-pulse rounded bg-gray-200" />
                    <div className="h-3 w-24 animate-pulse rounded bg-gray-100" />
                  </div>
                  <div className="h-12 w-12 animate-pulse rounded-xl bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {statCards.map(card => {
              const Icon = card.icon;

              return (
                <div
                  key={card.title}
                  className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-500">{card.title}</p>
                      <p className={`mt-2 break-words text-3xl font-bold leading-tight ${card.textColor}`}>
                        {card.value}
                      </p>
                      {card.sub ? (
                        <p className="mt-2 text-xs text-gray-400">{card.sub}</p>
                      ) : null}
                    </div>
                    <div className={`rounded-xl p-3 ${card.bgColor}`}>
                      <Icon size={24} className={card.textColor} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-800">
          <TrendingUp size={20} className="text-blue-500" />
          Truy cập nhanh
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {quickActions.map(action => {
            const Icon = action.icon;

            return (
              <Link
                key={action.to}
                to={action.to}
                className={`group flex min-h-[132px] flex-col items-center justify-center gap-3 rounded-xl border-2 p-4 text-center transition ${action.borderClass}`}
              >
                <div className={`flex h-12 w-12 items-center justify-center rounded-full transition ${action.iconWrapClass}`}>
                  <Icon size={24} className={action.iconClass} />
                </div>
                <span className="text-sm font-medium leading-5 text-gray-700">{action.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {showHelp && (
        <HelpModal
          title="Hướng dẫn sử dụng Trang chủ"
          onClose={() => setShowHelp(false)}
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="mb-2 font-bold text-gray-800">📊 Thống kê nhanh</h3>
                <p>4 thẻ thống kê hiển thị thông tin quan trọng nhất:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li><strong>Doanh thu hôm nay:</strong> Tổng tiền từ các đơn hàng đã thanh toán trong ngày</li>
                  <li><strong>Đơn hàng hôm nay:</strong> Số lượng đơn tạo trong ngày và số đã thanh toán</li>
                  <li><strong>Tổng sản phẩm:</strong> Tổng số sản phẩm trong kho, cả sản phẩm cha và biến thể</li>
                  <li><strong>Cảnh báo tồn kho:</strong> Số lượng sản phẩm tồn 0, sắp hết hoặc đang âm kho</li>
                  <li><strong>Âm kho:</strong> Sản phẩm có tồn âm, cảnh báo gần ngưỡng {negativeStockLimitLabel}</li>
                </ul>
              </div>

              <div>
                <h3 className="mb-2 font-bold text-gray-800">🚀 Truy cập nhanh</h3>
                <p>7 nút truy cập nhanh đến các chức năng chính:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li><strong>Quản lý sản phẩm:</strong> Thêm, sửa, xóa sản phẩm và biến thể</li>
                  <li><strong>Đơn hàng:</strong> Xem danh sách đơn hàng, lọc và xử lý trạng thái</li>
                  <li><strong>Thống kê:</strong> Xem biểu đồ doanh thu theo ngày/tuần/tháng</li>
                  <li><strong>Báo cáo đơn hàng:</strong> Xem báo cáo theo đơn hàng</li>
                  <li><strong>Kho hàng:</strong> Theo dõi tồn kho và cảnh báo hàng hóa</li>
                  <li><strong>Nhà cung cấp:</strong> Quản lý thông tin nhà cung cấp</li>
                  <li><strong>Báo cáo sản phẩm:</strong> Xem báo cáo theo sản phẩm</li>
                </ul>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <h3 className="mb-2 font-bold text-blue-800">💡 Mẹo</h3>
                <ul className="list-disc space-y-1 pl-5 text-blue-700">
                  <li>Kiểm tra trang chủ mỗi ngày để nắm bắt tình hình kinh doanh</li>
                  <li>Click vào các số liệu để xem chi tiết khi tài khoản có quyền truy cập</li>
                  <li>Dữ liệu sẽ tự cập nhật sau khi tạo đơn hoặc khi hệ thống đồng bộ thay đổi</li>
                </ul>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
