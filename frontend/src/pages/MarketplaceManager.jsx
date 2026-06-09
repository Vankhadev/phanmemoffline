import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Edit3,
  Link2,
  Loader,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShoppingBag,
  Store,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { SYNC_UPDATED_EVENT, marketplacesApi } from '../utils/apiClient';

const PLATFORMS = [
  {
    key: 'tiktok',
    name: 'TikTok',
    short: 'TT',
    connectLabel: 'Kết nối gian TikTok',
    brandClass: 'bg-black text-white',
    badgeClass: 'bg-slate-900 text-white',
  },
  {
    key: 'shopee',
    name: 'Shopee',
    short: 'S',
    connectLabel: 'Kết nối gian Shopee',
    brandClass: 'bg-[#f0442d] text-white',
    badgeClass: 'bg-orange-50 text-orange-700',
  },
  {
    key: 'lazada',
    name: 'Lazada',
    short: 'Laz',
    connectLabel: 'Kết nối gian Lazada',
    brandClass: 'bg-[#10108f] text-white',
    badgeClass: 'bg-indigo-50 text-indigo-700',
  },
  {
    key: 'tiki',
    name: 'Tiki',
    short: 'TIKI',
    connectLabel: 'Kết nối gian Tiki',
    brandClass: 'bg-[#1ea7f2] text-white',
    badgeClass: 'bg-sky-50 text-sky-700',
  },
];

const ORDER_STATUS_OPTIONS = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'new', label: 'Mới lấy đơn' },
  { value: 'picked', label: 'Đã lấy hàng' },
  { value: 'in_transit', label: 'Đang trung chuyển' },
  { value: 'delivered', label: 'Đã giao' },
  { value: 'returned', label: 'Hoàn trả hàng' },
  { value: 'cancelled', label: 'Đã hủy' },
];

const STATUS_META = {
  new: { label: 'Mới lấy đơn', className: 'bg-blue-50 text-blue-700' },
  picked: { label: 'Đã lấy hàng', className: 'bg-cyan-50 text-cyan-700' },
  in_transit: { label: 'Đang trung chuyển', className: 'bg-violet-50 text-violet-700' },
  delivered: { label: 'Đã giao', className: 'bg-emerald-50 text-emerald-700' },
  returned: { label: 'Hoàn trả hàng', className: 'bg-amber-50 text-amber-700' },
  cancelled: { label: 'Đã hủy', className: 'bg-rose-50 text-rose-700' },
};

const EMPTY_SHOP_DRAFT = {
  shop_name: '',
  shop_code: '',
  seller_id: '',
  app_key: '',
  access_token: '',
  refresh_token: '',
};

const EMPTY_ORDER_DRAFT = {
  platform: 'tiktok',
  shop_id: '',
  order_code: '',
  customer_name: '',
  phone: '',
  total: '',
  status: 'new',
  order_date: new Date().toISOString().slice(0, 10),
  picked_at: '',
  transit_at: '',
  delivered_at: '',
  returned_at: '',
  note: '',
};

function getPlatformMeta(platform) {
  return PLATFORMS.find(item => item.key === platform) || PLATFORMS[0];
}

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function PlatformBadge({ platform }) {
  const meta = getPlatformMeta(platform);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${meta.badgeClass}`}>
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-[10px]">{meta.short}</span>
      {meta.name}
    </span>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.new;
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${meta.className}`}>{meta.label}</span>;
}

function MarketplaceManager() {
  const [activeSection, setActiveSection] = useState('settings');
  const [shops, setShops] = useState([]);
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [shopFilter, setShopFilter] = useState('all');
  const [orderFilters, setOrderFilters] = useState({ platform: '', status: '', search: '' });
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState('tiktok');
  const [shopDraft, setShopDraft] = useState(EMPTY_SHOP_DRAFT);
  const [editingShop, setEditingShop] = useState(null);
  const [savingShop, setSavingShop] = useState(false);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [orderDraft, setOrderDraft] = useState(EMPTY_ORDER_DRAFT);
  const [savingOrder, setSavingOrder] = useState(false);

  const filteredShops = useMemo(() => {
    if (shopFilter === 'all') return shops;
    return shops.filter(shop => shop.platform === shopFilter);
  }, [shopFilter, shops]);

  const shopCounts = useMemo(() => {
    return PLATFORMS.reduce((acc, platform) => {
      acc[platform.key] = shops.filter(shop => shop.platform === platform.key).length;
      return acc;
    }, { all: shops.length });
  }, [shops]);

  const shopsBySelectedOrderPlatform = useMemo(() => {
    return shops.filter(shop => shop.platform === orderDraft.platform);
  }, [orderDraft.platform, shops]);

  async function loadData(nextFilters = orderFilters) {
    setLoading(true);
    setError('');
    try {
      const [shopsData, ordersData] = await Promise.all([
        marketplacesApi.shops(),
        marketplacesApi.orders(nextFilters),
      ]);
      setShops(Array.isArray(shopsData.items) ? shopsData.items : []);
      setOrders(Array.isArray(ordersData.items) ? ordersData.items : []);
      setSummary(ordersData.summary || null);
    } catch (err) {
      setError(err.message || 'Không tải được dữ liệu sàn thương mại điện tử.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    const handleSyncUpdated = event => {
      const tables = event?.detail?.changedTables || event?.detail?.tables || [];
      if (tables.includes('marketplace_shops') || tables.includes('marketplace_orders')) loadData();
    };
    window.addEventListener(SYNC_UPDATED_EVENT, handleSyncUpdated);
    return () => window.removeEventListener(SYNC_UPDATED_EVENT, handleSyncUpdated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateOrderFilter(field, value) {
    setOrderFilters(prev => ({ ...prev, [field]: value }));
  }

  async function applyOrderFilters() {
    await loadData(orderFilters);
  }

  function openConnectModal(platform = 'tiktok', shop = null) {
    const meta = getPlatformMeta(shop?.platform || platform);
    setSelectedPlatform(meta.key);
    setEditingShop(shop);
    setShopDraft(shop ? {
      shop_name: shop.shop_name || '',
      shop_code: shop.shop_code || '',
      seller_id: shop.seller_id || '',
      app_key: '',
      access_token: '',
      refresh_token: '',
    } : {
      ...EMPTY_SHOP_DRAFT,
      shop_name: `Gian hàng ${meta.name}`,
    });
    setNotice('');
    setError('');
    setConnectModalOpen(true);
  }

  function choosePlatform(platform) {
    const meta = getPlatformMeta(platform);
    setSelectedPlatform(meta.key);
    setEditingShop(null);
    setShopDraft({ ...EMPTY_SHOP_DRAFT, shop_name: `Gian hàng ${meta.name}` });
  }

  async function saveShop() {
    setSavingShop(true);
    setError('');
    try {
      const payload = { platform: selectedPlatform, ...shopDraft };
      if (editingShop) await marketplacesApi.updateShop(editingShop.id, payload);
      else await marketplacesApi.createShop(payload);
      setConnectModalOpen(false);
      setNotice(editingShop ? 'Đã cập nhật liên kết gian hàng.' : 'Đã tạo liên kết gian hàng mới.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Không lưu được gian hàng.');
    } finally {
      setSavingShop(false);
    }
  }

  async function removeShop(shop) {
    if (!shop?.id) return;
    setError('');
    try {
      await marketplacesApi.removeShop(shop.id);
      setNotice(`Đã xóa liên kết ${shop.shop_name}.`);
      await loadData();
    } catch (err) {
      setError(err.message || 'Không xóa được gian hàng.');
    }
  }

  async function syncOrders(platform = '') {
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      const data = await marketplacesApi.sync({ platform: platform || orderFilters.platform || undefined });
      setNotice(data.message || `Đã đồng bộ ${data.synced_count || 0} đơn hàng sàn.`);
      await loadData(orderFilters);
      setActiveSection('orders');
    } catch (err) {
      setError(err.message || 'Không đồng bộ được đơn hàng sàn.');
    } finally {
      setSyncing(false);
    }
  }

  function openOrderModal(order = null) {
    setEditingOrder(order);
    setError('');
    if (order) {
      setOrderDraft({
        platform: order.platform || 'tiktok',
        shop_id: order.shop_id || '',
        order_code: order.order_code || '',
        customer_name: order.customer_name || '',
        phone: order.phone || '',
        total: order.total || '',
        status: order.status || 'new',
        order_date: order.order_date || new Date().toISOString().slice(0, 10),
        picked_at: order.picked_at || '',
        transit_at: order.transit_at || '',
        delivered_at: order.delivered_at || '',
        returned_at: order.returned_at || '',
        note: order.note || '',
      });
    } else {
      const platform = orderFilters.platform || shops[0]?.platform || 'tiktok';
      setOrderDraft({
        ...EMPTY_ORDER_DRAFT,
        platform,
        shop_id: shops.find(shop => shop.platform === platform)?.id || '',
      });
    }
    setOrderModalOpen(true);
  }

  async function saveOrder() {
    setSavingOrder(true);
    setError('');
    try {
      if (editingOrder) await marketplacesApi.updateOrder(editingOrder.id, orderDraft);
      else await marketplacesApi.createOrder(orderDraft);
      setOrderModalOpen(false);
      setNotice(editingOrder ? 'Đã cập nhật đơn hàng sàn.' : 'Đã thêm đơn hàng sàn.');
      await loadData(orderFilters);
    } catch (err) {
      setError(err.message || 'Không lưu được đơn hàng sàn.');
    } finally {
      setSavingOrder(false);
    }
  }

  async function removeOrder(order) {
    if (!order?.id) return;
    setError('');
    try {
      await marketplacesApi.removeOrder(order.id);
      setNotice(`Đã xóa đơn ${order.order_code}.`);
      await loadData(orderFilters);
    } catch (err) {
      setError(err.message || 'Không xóa được đơn hàng sàn.');
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
                <Store size={15} />
                Sàn thương mại điện tử
              </div>
              <h1 className="mt-1 text-2xl font-bold text-slate-900">Quản lý kết nối gian hàng</h1>
              <p className="mt-1 text-sm text-slate-500">Theo dõi gian hàng và trạng thái đơn từ TikTok, Shopee, Lazada, Tiki.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openConnectModal('tiktok')}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700"
              >
                <Plus size={16} />
                Kết nối gian hàng mới
              </button>
              <button
                type="button"
                onClick={() => syncOrders()}
                disabled={syncing || shops.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {syncing ? <Loader size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                Đồng bộ đơn hàng
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveSection('settings')}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${activeSection === 'settings' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              Cấu hình chung
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('orders')}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${activeSection === 'orders' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              Đơn hàng sàn
            </button>
          </div>
        </div>

        {(notice || error) && (
          <div className="space-y-2 px-5 pt-4">
            {notice && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                {notice}
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                {error}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Link2 size={15} /> Gian hàng</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{summary?.shop_count ?? shops.length}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><ShoppingBag size={15} /> Đơn sàn</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{summary?.order_count ?? orders.length}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Truck size={15} /> Đang xử lý</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{summary?.pending_count ?? 0}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><PackageCheck size={15} /> Hoàn trả</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{summary?.returned_count ?? 0}</div>
          </div>
        </div>
      </div>

      {activeSection === 'settings' && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {[{ key: 'all', name: 'Tất cả gian hàng' }, ...PLATFORMS].map(platform => (
                <button
                  key={platform.key}
                  type="button"
                  onClick={() => setShopFilter(platform.key)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold ${shopFilter === platform.key ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {platform.key !== 'all' && <span className="text-xs">{getPlatformMeta(platform.key).short}</span>}
                  {platform.name}
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">{shopCounts[platform.key] || 0}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => openConnectModal('tiktok')}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700"
            >
              <Plus size={16} />
              Kết nối gian hàng mới
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Gian hàng</th>
                  <th className="px-4 py-3 text-left">Sàn</th>
                  <th className="px-4 py-3 text-left">Ngày kết nối</th>
                  <th className="px-4 py-3 text-left">Lần đồng bộ</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={5}>Đang tải dữ liệu...</td></tr>
                ) : filteredShops.length === 0 ? (
                  <tr>
                    <td className="px-4 py-10 text-center text-slate-500" colSpan={5}>
                      Chưa có gian hàng nào. Bấm “Kết nối gian hàng mới” để thêm TikTok, Shopee, Lazada hoặc Tiki.
                    </td>
                  </tr>
                ) : filteredShops.map(shop => (
                  <tr key={shop.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{shop.shop_name}</div>
                      <div className="text-xs text-slate-500">{shop.shop_code || shop.seller_id || 'Chưa nhập mã gian hàng'}</div>
                    </td>
                    <td className="px-4 py-3"><PlatformBadge platform={shop.platform} /></td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(shop.connected_at)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(shop.last_sync_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => syncOrders(shop.platform)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" title="Đồng bộ đơn">
                          <RefreshCw size={16} />
                        </button>
                        <button type="button" onClick={() => openConnectModal(shop.platform, shop)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" title="Sửa liên kết">
                          <Settings size={16} />
                        </button>
                        <button type="button" onClick={() => removeShop(shop)} className="rounded-lg border border-rose-200 p-2 text-rose-500 hover:bg-rose-50" title="Xóa liên kết">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSection === 'orders' && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[180px_190px_1fr_auto_auto]">
              <select
                className="input-field w-full"
                value={orderFilters.platform}
                onChange={event => updateOrderFilter('platform', event.target.value)}
              >
                <option value="">Tất cả sàn</option>
                {PLATFORMS.map(platform => <option key={platform.key} value={platform.key}>{platform.name}</option>)}
              </select>
              <select
                className="input-field w-full"
                value={orderFilters.status}
                onChange={event => updateOrderFilter('status', event.target.value)}
              >
                {ORDER_STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="input-field w-full pl-9"
                  value={orderFilters.search}
                  onChange={event => updateOrderFilter('search', event.target.value)}
                  placeholder="Tìm mã đơn, khách hàng, gian hàng"
                />
              </div>
              <button type="button" onClick={applyOrderFilters} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
                <Search size={16} />
                Lọc
              </button>
              <button type="button" onClick={() => openOrderModal()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700">
                <Plus size={16} />
                Thêm đơn sàn
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Sàn</th>
                  <th className="px-4 py-3 text-left">Mã đơn hàng</th>
                  <th className="px-4 py-3 text-left">Ngày lấy đơn</th>
                  <th className="px-4 py-3 text-left">Ngày trung chuyển</th>
                  <th className="px-4 py-3 text-left">Ngày giao</th>
                  <th className="px-4 py-3 text-left">Ngày hoàn trả hàng</th>
                  <th className="px-4 py-3 text-right">Tổng tiền</th>
                  <th className="px-4 py-3 text-left">Trạng thái</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={9}>Đang tải đơn hàng sàn...</td></tr>
                ) : orders.length === 0 ? (
                  <tr><td className="px-4 py-10 text-center text-slate-500" colSpan={9}>Chưa có đơn hàng sàn. Có thể thêm thủ công hoặc bấm “Đồng bộ đơn hàng”.</td></tr>
                ) : orders.map(order => (
                  <tr key={order.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <PlatformBadge platform={order.platform} />
                      <div className="mt-1 text-xs text-slate-500">{order.shop_name || 'Chưa gắn gian hàng'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{order.order_code}</div>
                      <div className="text-xs text-slate-500">{order.customer_name || 'Khách sàn'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(order.order_date)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(order.transit_at)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(order.delivered_at)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(order.returned_at)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatVND(order.total)}</td>
                    <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => openOrderModal(order)} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" title="Sửa đơn">
                          <Edit3 size={16} />
                        </button>
                        <button type="button" onClick={() => removeOrder(order)} className="rounded-lg border border-rose-200 p-2 text-rose-500 hover:bg-rose-50" title="Xóa đơn">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {connectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">Kết nối gian hàng trên sàn</h2>
              <button type="button" onClick={() => setConnectModalOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-[1fr_300px]">
              <div className="space-y-3">
                {PLATFORMS.map(platform => (
                  <div key={platform.key} className="grid grid-cols-[1fr_190px] gap-3">
                    <button
                      type="button"
                      onClick={() => choosePlatform(platform.key)}
                      className={`flex min-h-[64px] items-center gap-4 rounded-lg px-5 text-left text-base font-bold shadow-sm ${platform.brandClass} ${selectedPlatform === platform.key ? 'ring-2 ring-sky-400 ring-offset-2' : ''}`}
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15 text-lg">{platform.short}</span>
                      {platform.connectLabel}
                    </button>
                    <button
                      type="button"
                      onClick={() => choosePlatform(platform.key)}
                      className="inline-flex min-h-[64px] items-center justify-center gap-2 rounded-lg border border-cyan-700/60 bg-white px-4 text-sm font-bold text-cyan-700 hover:bg-cyan-50"
                    >
                      Tạo gian mới
                      {platform.key === 'lazada' && <ChevronDown size={16} />}
                    </button>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-bold text-slate-900">{editingShop ? 'Sửa liên kết' : 'Thông tin gian hàng'}</div>
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Sàn</label>
                    <PlatformBadge platform={selectedPlatform} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Tên gian hàng</label>
                    <input className="input-field w-full" value={shopDraft.shop_name} onChange={event => setShopDraft(prev => ({ ...prev, shop_name: event.target.value }))} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Mã gian hàng</label>
                    <input className="input-field w-full" value={shopDraft.shop_code} onChange={event => setShopDraft(prev => ({ ...prev, shop_code: event.target.value }))} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">Seller ID</label>
                    <input className="input-field w-full" value={shopDraft.seller_id} onChange={event => setShopDraft(prev => ({ ...prev, seller_id: event.target.value }))} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500">App key / token</label>
                    <input className="input-field w-full" value={shopDraft.access_token} onChange={event => setShopDraft(prev => ({ ...prev, access_token: event.target.value }))} placeholder="Nhập token khi có API chính thức" />
                  </div>
                  <button
                    type="button"
                    onClick={saveShop}
                    disabled={savingShop || !shopDraft.shop_name.trim()}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {savingShop ? <Loader size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    {editingShop ? 'Lưu thay đổi' : 'Lưu liên kết'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {orderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">{editingOrder ? 'Sửa đơn hàng sàn' : 'Thêm đơn hàng sàn'}</h2>
              <button type="button" onClick={() => setOrderModalOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Sàn</label>
                <select className="input-field w-full" value={orderDraft.platform} onChange={event => setOrderDraft(prev => ({ ...prev, platform: event.target.value, shop_id: shops.find(shop => shop.platform === event.target.value)?.id || '' }))}>
                  {PLATFORMS.map(platform => <option key={platform.key} value={platform.key}>{platform.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Gian hàng</label>
                <select className="input-field w-full" value={orderDraft.shop_id} onChange={event => setOrderDraft(prev => ({ ...prev, shop_id: event.target.value }))}>
                  <option value="">Chưa gắn gian hàng</option>
                  {shopsBySelectedOrderPlatform.map(shop => <option key={shop.id} value={shop.id}>{shop.shop_name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Mã đơn hàng</label>
                <input className="input-field w-full" value={orderDraft.order_code} onChange={event => setOrderDraft(prev => ({ ...prev, order_code: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Khách hàng</label>
                <input className="input-field w-full" value={orderDraft.customer_name} onChange={event => setOrderDraft(prev => ({ ...prev, customer_name: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Số điện thoại</label>
                <input className="input-field w-full" value={orderDraft.phone} onChange={event => setOrderDraft(prev => ({ ...prev, phone: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Tổng tiền</label>
                <input type="number" min="0" className="input-field w-full" value={orderDraft.total} onChange={event => setOrderDraft(prev => ({ ...prev, total: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">Trạng thái</label>
                <select className="input-field w-full" value={orderDraft.status} onChange={event => setOrderDraft(prev => ({ ...prev, status: event.target.value }))}>
                  {ORDER_STATUS_OPTIONS.filter(option => option.value).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              {[
                ['order_date', 'Ngày lấy đơn'],
                ['picked_at', 'Ngày lấy hàng'],
                ['transit_at', 'Ngày trung chuyển'],
                ['delivered_at', 'Ngày giao'],
                ['returned_at', 'Ngày hoàn trả hàng'],
              ].map(([field, label]) => (
                <div key={field}>
                  <label className="mb-1 flex items-center gap-1 text-xs font-semibold text-slate-500"><CalendarDays size={13} /> {label}</label>
                  <input type="date" className="input-field w-full" value={orderDraft[field]} onChange={event => setOrderDraft(prev => ({ ...prev, [field]: event.target.value }))} />
                </div>
              ))}
              <div className="md:col-span-3">
                <label className="mb-1 block text-xs font-semibold text-slate-500">Ghi chú</label>
                <textarea className="input-field min-h-[76px] w-full" value={orderDraft.note} onChange={event => setOrderDraft(prev => ({ ...prev, note: event.target.value }))} />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setOrderModalOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                Hủy
              </button>
              <button
                type="button"
                onClick={saveOrder}
                disabled={savingOrder || !orderDraft.order_code.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {savingOrder ? <Loader size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Lưu đơn hàng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MarketplaceManager;
