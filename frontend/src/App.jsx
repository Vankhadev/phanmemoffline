import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate, } from 'react-router-dom';
import Home from './pages/Home';
import POS from './pages/POS';
import CreateOrder from './pages/CreateOrder';
import NhaCungCap from './pages/nhacungcap';
import Products from './pages/Products';
import Customers from './pages/Customers';
import Stats from './pages/Stats';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Register from './pages/Register';
import OrderList from './pages/OrderList';
import KhoHang from './pages/KhoHang';
import Nhaphang from './pages/nhaphang';
import Reports from './pages/Reports';
import CustomerOrderReport from './pages/CustomerOrderReport';
import ProductReport from './pages/ProductReport';
import CashBook from './pages/CashBook';
import Payroll from './pages/Payroll';
import PrintTemplates from './pages/PrintTemplates';
import SapoProductSync from './pages/SapoProductSync';
import {
  BadgeDollarSign,
  BarChart3,
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Home as HomeIcon,
  Menu,
  Package,
  PlusCircle,
  Printer,
  Settings as SettingsIcon,
  ShoppingCart,
  Sliders,
  Truck,
  Users,
  Wallet,
  Warehouse,
  X,
} from 'lucide-react';
import {
  API_BASE,
  AUTH_EXPIRED_EVENT,
  SYNC_UPDATED_EVENT,
  authApi,
  getApiErrorMessage,
  persistAuthenticatedPayload,
  persistAuthSnapshot,
  pullServerBootstrapData,
  pushPendingLocalData,
} from './utils/apiClient';
import { clearAuthSession, clearVolatileCache, getAuthToken, normalizePermissions } from './utils/authStorage';

export const API = API_BASE;

const ROUTE_ALIASES = {
  '/settings': '/cai-dat',
  '/admin': '/cai-dat',
  '/orders': '/danh-sach-don-hang',
  '/products': '/san-pham',
  '/customers': '/khach-hang',
};

const HOME_ROUTE = '/';
const LOGIN_REGISTER_ROUTE = '/dang-ky';
const DESKTOP_SIDEBAR_QUERY = '(min-width: 768px)';
const MOBILE_SIDEBAR_QUERY = '(max-width: 767px)';
const NAV_ICON_CLASS = 'h-5 w-5 shrink-0';
const NAV_CHILD_ICON_CLASS = 'h-4 w-4 shrink-0';
const SYNC_POLL_INTERVAL_MS = 15000;
const SYNC_POLL_BACKOFF_MAX_MS = 60000;

function matchesMediaQuery(query, fallback = false) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return fallback;
  return window.matchMedia(query).matches;
}

function isMobileSidebarViewport() {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') return window.matchMedia(MOBILE_SIDEBAR_QUERY).matches;
  return window.innerWidth < 768;
}

function NavMenuIcon({ icon: Icon, className = NAV_ICON_CLASS }) {
  if (!Icon) return null;
  return <Icon aria-hidden="true" className={className} strokeWidth={2} />;
}

function getInitials(name) {
  if (!name) return '👤';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[parts.length - 1][0] || parts[0][0]).toUpperCase();
}

function normalizeRoutePath(route, fallback = HOME_ROUTE) {
  const rawRoute = String(route || fallback).trim() || fallback;
  const [pathOnly] = rawRoute.split(/[?#]/);
  const requested = ROUTE_ALIASES[pathOnly] || pathOnly;
  const safeRoute = requested.startsWith('/') ? requested : `/${requested}`;
  return ROUTE_ALIASES[safeRoute] || safeRoute;
}

function getCurrentHashRoute() {
  if (typeof window === 'undefined') return HOME_ROUTE;
  const rawHash = String(window.location.hash || '').trim();
  if (!rawHash || rawHash === '#') return HOME_ROUTE;
  const routeFromHash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  return normalizeRoutePath(routeFromHash || HOME_ROUTE);
}

const ROUTE_PERMISSIONS = {
  [HOME_ROUTE]: [],
  '/pos': ['invoices.manage'],
  '/tao-don-hang': ['invoices.manage'],
  '/danh-sach-don-hang': ['invoices.read'],
  '/kho-hang': ['products.read'],
  '/nha-cung-cap': ['partners.read'],
  '/nhap-hang': ['imports.read'],
  '/san-pham': ['products.read'],
  '/khach-hang': ['customers.read'],
  '/thong-ke': ['stats.read'],
  '/so-quy': ['cashbook.read'],
  '/bang-luong-nhan-vien': ['payrolls.read'],
  '/bao-cao-thu-e': ['stats.read'],
  '/bao-cao-theo-don-hang': ['invoices.read'],
  '/bao-cao-theo-san-pham': ['stats.read'],
  '/cai-dat': ['settings.read', 'store.read', 'users.read'],
  '/mau-in': ['print_templates.read'],
  '/dong-bo-san-pham': ['products.manage'],
};

function isKnownAppRoute(route) {
  return Object.prototype.hasOwnProperty.call(ROUTE_PERMISSIONS, route);
}

function normalizeDefaultRoute(route, user, permissions) {
  const safeRoute = normalizeRoutePath(route);
  return canAccessRoute(safeRoute, user, permissions) ? safeRoute : firstAccessibleRoute(user, permissions);
}

function getRestoredSessionRoute(defaultRoute, user, permissions) {
  const currentRoute = getCurrentHashRoute();
  if (isKnownAppRoute(currentRoute) && canAccessRoute(currentRoute, user, permissions)) return currentRoute;
  return normalizeDefaultRoute(defaultRoute, user, permissions);
}

function isAdminUser(user) {
  return String(user?.role || '').trim().toLowerCase() === 'admin';
}

function hasAnyPermission(user, permissions, required = []) {
  if (!required || required.length === 0) return true;
  if (isAdminUser(user)) return true;

  const permissionSet = new Set(normalizePermissions(permissions));
  return required.some(permission => permissionSet.has(permission));
}

function canAccessRoute(route, user, permissions) {
  if (!user || !isKnownAppRoute(route)) return false;
  const required = ROUTE_PERMISSIONS[route] || [];
  return hasAnyPermission(user, permissions, required);
}

function firstAccessibleRoute(user, permissions) {
  return Object.keys(ROUTE_PERMISSIONS).find(route => canAccessRoute(route, user, permissions)) || HOME_ROUTE;
}

function extractStore(payload = {}) {
  if (payload.store_info && typeof payload.store_info === 'object') return payload.store_info;
  if (payload.store && typeof payload.store === 'object') return payload.store;
  const rows = payload.data?.store_info;
  if (Array.isArray(rows)) return rows[0] || null;
  return null;
}

function getSyncVersionNumber(value) {
  if (value && typeof value === 'object') return Number(value.version) || 0;
  return Number(value) || 0;
}

function collectChangedSyncTables(previous = {}, next = {}) {
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
  return Array.from(keys).filter(key => getSyncVersionNumber(previous?.[key]) !== getSyncVersionNumber(next?.[key]));
}

function dispatchSyncUpdated(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SYNC_UPDATED_EVENT, { detail }));
}

function buildSessionState(payload = {}) {
  const bootstrap = payload.bootstrap && typeof payload.bootstrap === 'object' ? payload.bootstrap : {};
  return {
    user: payload.user || null,
    account: payload.account || null,
    permissions: normalizePermissions(payload.permissions),
    session: payload.session || null,
    syncVersions: payload.syncVersions || bootstrap.syncVersions || {},
    bootstrap: {
      ...bootstrap,
      defaultRoute: payload.defaultRoute || bootstrap.defaultRoute || HOME_ROUTE,
      serverTime: payload.serverTime || bootstrap.serverTime || null,
    },
  };
}

function FullScreenLoading({ message = 'Đang khởi tạo ứng dụng...' }) {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl px-8 py-7 text-center max-w-sm w-full">
        <div className="mx-auto mb-4 h-10 w-10 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" />
        <div className="text-lg font-bold text-gray-800">Phần Mềm Bán Hàng</div>
        <div className="mt-2 text-sm text-gray-500">{message}</div>
      </div>
    </div>
  );
}

function ProtectedRoute({ user, permissions, path, children }) {
  return canAccessRoute(path, user, permissions) ? children : <Navigate to={firstAccessibleRoute(user, permissions)} replace />;
}

// Inner layout that uses useLocation/useNavigate
function AppLayout({
  authState,
  store,
  sidebarOpen,
  setSidebarOpen,
  onLogout,
  redirectPath,
  onRedirected,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [openMenus, setOpenMenus] = useState({ don_hang: true });
  const [desktopVersion, setDesktopVersion] = useState('');
  const [updateToast, setUpdateToast] = useState(null);
  const { user, account, permissions } = authState;
  const isAdmin = isAdminUser(user);

  useEffect(() => {
    if (!redirectPath) return;
    if (location.pathname !== redirectPath) navigate(redirectPath, { replace: true });
    onRedirected?.();
  }, [location.pathname, navigate, onRedirected, redirectPath]);

  useEffect(() => {
    if (!window.khaDesktop?.isElectron) return undefined;
    let mounted = true;
    window.khaDesktop.getAppInfo?.().then(result => {
      if (mounted && result?.ok && result.app?.version) setDesktopVersion(result.app.version);
    }).catch(() => {});

    const unsubscribe = window.khaDesktop.updates?.onStatus?.(payload => {
      if (payload?.type === 'update-available') {
        const version = payload.updateInfo?.version || payload.state?.updateInfo?.version;
        setUpdateToast({
          tone: 'info',
          title: version ? `Có bản cập nhật ${version}` : 'Có bản cập nhật mới',
          message: 'Vào Cài đặt > Cập nhật để xem ghi chú phát hành, tải và cài đặt an toàn.',
        });
      }
      if (payload?.type === 'downloaded') {
        setUpdateToast({
          tone: 'success',
          title: 'Đã tải xong bản cập nhật',
          message: 'Bản cập nhật đã được electron-updater xác thực. Có thể chọn Cập nhật ngay hoặc để sau.',
        });
      }
    });

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const handleSidebarToggle = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, [setSidebarOpen]);

  const closeMobileSidebar = useCallback(() => {
    if (isMobileSidebarViewport()) setSidebarOpen(false);
  }, [setSidebarOpen]);

  const toggleMenu = useCallback((key) => {
    setOpenMenus(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const canAccess = useCallback((route) => canAccessRoute(route, user, permissions), [permissions, user]);
  const canAccessAny = useCallback((routes = []) => routes.some(route => canAccess(route)), [canAccess]);

  const navGroups = useMemo(() => {
    const groups = [
      { to: HOME_ROUTE, label: 'Trang chủ', icon: HomeIcon },
      {
        key: 'don_hang',
        label: 'Đơn hàng',
        icon: ClipboardList,
        items: [
          { to: '/tao-don-hang', label: 'Tạo đơn hàng', icon: PlusCircle },
          { to: '/danh-sach-don-hang', label: 'Danh sách đơn hàng', icon: FileText },
        ],
      },
      {
        key: 'danh_muc',
        label: 'Danh mục',
        icon: Package,
        items: [
          { to: '/san-pham', label: 'Sản phẩm', icon: Box },
          { to: '/kho-hang', label: 'Kho hàng', icon: Warehouse },
          { to: '/khach-hang', label: 'Khách hàng', icon: Users },
          { to: '/nhap-hang', label: 'Nhập hàng', icon: ShoppingCart },
          { to: '/nha-cung-cap', label: 'Nhà cung cấp', icon: Truck },
        ],
      },
      {
        key: 'quan_ly',
        label: 'Quản lý',
        icon: Sliders,
        items: [
          { to: '/thong-ke', label: 'Thống kê', icon: BarChart3 },
          { to: '/so-quy', label: 'Sổ quỹ', icon: Wallet },
          { to: '/bao-cao-theo-don-hang', label: 'Báo cáo theo đơn hàng', icon: FileText },
          { to: '/bao-cao-theo-san-pham', label: 'Báo cáo sản phẩm', icon: Boxes },
          { to: '/bang-luong-nhan-vien', label: 'Bảng lương nhân viên', icon: BadgeDollarSign },
          { to: '/cai-dat', label: 'Cài đặt', icon: SettingsIcon },
          { to: '/mau-in', label: 'Mẫu in', icon: Printer },
        ],
      },
    ];

    return groups
      .map(group => group.items ? { ...group, items: group.items.filter(item => canAccess(item.to)) } : group)
      .filter(group => group.items ? group.items.length > 0 : canAccess(group.to));
  }, [canAccess]);

  useEffect(() => {
    setOpenMenus(prev => {
      let changed = false;
      const next = { ...prev };
      for (const group of navGroups) {
        if (group.items?.some(item => item.to === location.pathname) && !next[group.key]) {
          next[group.key] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [location.pathname, navGroups]);

  useEffect(() => {
    if (!sidebarOpen || !isMobileSidebarViewport()) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [setSidebarOpen, sidebarOpen]);

  const storeDisplayName = store.name || account?.name || 'Bán hàng offline';
  const storeContact = [store.phone, store.email].filter(Boolean).join(' · ');

  return (
    <div className="flex h-screen h-[100dvh] min-w-0 bg-gray-100 overflow-hidden">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Đóng menu"
          className="fixed inset-0 z-30 bg-black/45 md:hidden"
          onClick={closeMobileSidebar}
        />
      )}

      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'translate-x-0 md:w-60' : '-translate-x-full md:translate-x-0 md:w-16'} fixed inset-y-0 left-0 z-40 flex w-72 max-w-[86vw] transform-gpu flex-col bg-gray-900 text-white shadow-2xl transition-transform duration-150 ease-out motion-reduce:transition-none md:relative md:z-auto md:max-w-none md:shrink-0 md:shadow-none md:transition-[width] md:duration-150`}>
        <div className="border-b border-gray-700 p-3">
          <div className="flex min-h-11 items-center justify-between gap-2">
            {sidebarOpen ? (
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-gray-300">{storeDisplayName}</div>
                <div className="truncate text-xs text-blue-400">{desktopVersion ? `Version ${desktopVersion}` : 'Version 1.2.1'}</div>
              </div>
            ) : (
              <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white md:flex">
                <HomeIcon aria-hidden="true" className="h-5 w-5" />
              </div>
            )}
            <button
              type="button"
              onClick={handleSidebarToggle}
              aria-label={sidebarOpen ? 'Thu gọn hoặc đóng menu' : 'Mở menu'}
              aria-expanded={sidebarOpen}
              className="inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl text-gray-300 outline-none hover:bg-gray-800 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-400 active:bg-gray-700"
            >
              {sidebarOpen ? <X aria-hidden="true" className="h-5 w-5 md:hidden" /> : null}
              <Menu aria-hidden="true" className={`${sidebarOpen ? 'hidden md:block' : 'block'} h-5 w-5`} />
            </button>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto overscroll-contain px-2 py-2">
          {navGroups.map(group => {
            const groupActive = group.items?.some(item => location.pathname === item.to);

            return group.items ? (
              <div key={group.key}>
                <button
                  type="button"
                  onClick={() => toggleMenu(group.key)}
                  title={!sidebarOpen ? group.label : undefined}
                  aria-expanded={!!openMenus[group.key]}
                  className={`flex min-h-11 w-full touch-manipulation items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium outline-none hover:bg-gray-800 focus-visible:ring-2 focus-visible:ring-blue-400 active:bg-gray-700 ${groupActive ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-300'}`}
                >
                  <NavMenuIcon icon={group.icon} />
                  {sidebarOpen && (
                    <>
                      <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                      {openMenus[group.key] ? <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />}
                    </>
                  )}
                </button>
                {openMenus[group.key] && sidebarOpen && group.items.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={closeMobileSidebar}
                    className={({ isActive }) => `mt-1 flex min-h-11 touch-manipulation items-center gap-3 rounded-xl px-3 py-2.5 pl-9 text-sm outline-none hover:bg-gray-800 focus-visible:ring-2 focus-visible:ring-blue-400 active:bg-gray-700 ${isActive ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-300'}`}
                  >
                    <NavMenuIcon icon={item.icon} className={NAV_CHILD_ICON_CLASS} />
                    <span className="min-w-0 truncate">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            ) : (
              <NavLink
                key={group.to}
                to={group.to}
                onClick={closeMobileSidebar}
                title={!sidebarOpen ? group.label : undefined}
                className={({ isActive }) => `flex min-h-11 touch-manipulation items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium outline-none hover:bg-gray-800 focus-visible:ring-2 focus-visible:ring-blue-400 active:bg-gray-700 ${isActive ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-300'}`}
              >
                <NavMenuIcon icon={group.icon} />
                {sidebarOpen && <span className="min-w-0 truncate">{group.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-gray-700 p-3">
          <div className={`mb-2 flex items-center gap-2 ${sidebarOpen ? '' : 'md:justify-center'}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold">
              {getInitials(user?.name)}
            </div>
            {sidebarOpen && (
              <div className="min-w-0 text-xs">
                <div className="truncate font-medium text-white">{user?.name}</div>
                <div className="truncate capitalize text-gray-400">{isAdmin ? 'admin' : user?.role || 'user'}</div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="min-h-10 w-full touch-manipulation rounded-lg border border-red-500 px-2 py-2 text-center text-xs font-medium text-red-300 outline-none hover:bg-red-950/40 hover:text-red-200 focus-visible:ring-2 focus-visible:ring-red-400 active:bg-red-900/40"
          >
            {sidebarOpen ? 'Đăng xuất' : '⬅'}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b bg-white px-3 py-2.5 shadow-sm sm:px-6 sm:py-3">
          <button
            type="button"
            onClick={handleSidebarToggle}
            aria-label="Mở menu"
            className="inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl border border-gray-200 text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500 active:bg-gray-100 md:hidden"
          >
            <Menu aria-hidden="true" className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-bold text-gray-800 sm:text-lg">{storeDisplayName}</div>
            {storeContact && <div className="truncate text-xs text-gray-500 sm:hidden">{storeContact}</div>}
          </div>
          <div className="hidden shrink-0 text-sm text-gray-500 sm:block">
            {storeContact}
          </div>
        </div>
        {updateToast && (
          <div className={`mx-3 mt-3 flex flex-col gap-3 rounded-xl border px-4 py-3 sm:mx-4 sm:mt-4 sm:flex-row sm:items-start sm:justify-between ${updateToast.tone === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
            <div className="min-w-0">
              <div className="text-sm font-semibold">{updateToast.title}</div>
              <div className="mt-1 text-sm">{updateToast.message}</div>
            </div>
            <div className="flex w-full shrink-0 justify-end gap-2 sm:w-auto">
              <button type="button" onClick={() => navigate('/cai-dat')} className="min-h-10 rounded-lg border bg-white/80 px-3 py-2 text-xs font-medium hover:bg-white active:bg-gray-50">Mở cài đặt</button>
              <button type="button" onClick={() => setUpdateToast(null)} className="min-h-10 px-3 py-2 text-xs opacity-70 hover:opacity-100 active:opacity-100">Đóng</button>
            </div>
          </div>
        )}
        <div className="app-main-scroll flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-auto p-3 sm:p-4">
          <Routes>
            <Route path={HOME_ROUTE} element={<Home user={user} store={store} />} />
            <Route path="/pos" element={<ProtectedRoute user={user} permissions={permissions} path="/pos"><POS user={user} store={store} /></ProtectedRoute>} />
            <Route path="/tao-don-hang" element={<ProtectedRoute user={user} permissions={permissions} path="/tao-don-hang"><CreateOrder user={user} store={store} /></ProtectedRoute>} />
            <Route path="/danh-sach-don-hang" element={<ProtectedRoute user={user} permissions={permissions} path="/danh-sach-don-hang"><OrderList store={store} /></ProtectedRoute>} />
            <Route path="/kho-hang" element={<ProtectedRoute user={user} permissions={permissions} path="/kho-hang"><KhoHang /></ProtectedRoute>} />
            <Route path="/nha-cung-cap" element={<ProtectedRoute user={user} permissions={permissions} path="/nha-cung-cap"><NhaCungCap /></ProtectedRoute>} />
            <Route path="/nhap-hang" element={<ProtectedRoute user={user} permissions={permissions} path="/nhap-hang"><Nhaphang store={store} /></ProtectedRoute>} />
            <Route path="/san-pham" element={<ProtectedRoute user={user} permissions={permissions} path="/san-pham"><Products store={store} /></ProtectedRoute>} />
            <Route path="/khach-hang" element={<ProtectedRoute user={user} permissions={permissions} path="/khach-hang"><Customers /></ProtectedRoute>} />
            <Route path="/thong-ke" element={<ProtectedRoute user={user} permissions={permissions} path="/thong-ke"><Stats /></ProtectedRoute>} />
            <Route path="/so-quy" element={<ProtectedRoute user={user} permissions={permissions} path="/so-quy"><CashBook /></ProtectedRoute>} />
            <Route path="/bang-luong-nhan-vien" element={<ProtectedRoute user={user} permissions={permissions} path="/bang-luong-nhan-vien"><Payroll /></ProtectedRoute>} />
            <Route path="/bao-cao-thu-e" element={<ProtectedRoute user={user} permissions={permissions} path="/bao-cao-thu-e"><Reports /></ProtectedRoute>} />
            <Route path="/bao-cao-theo-don-hang" element={<ProtectedRoute user={user} permissions={permissions} path="/bao-cao-theo-don-hang"><CustomerOrderReport /></ProtectedRoute>} />
            <Route path="/bao-cao-theo-san-pham" element={<ProtectedRoute user={user} permissions={permissions} path="/bao-cao-theo-san-pham"><ProductReport /></ProtectedRoute>} />
            <Route path="/cai-dat" element={<ProtectedRoute user={user} permissions={permissions} path="/cai-dat"><Settings store={store} /></ProtectedRoute>} />
            <Route path="/mau-in" element={<ProtectedRoute user={user} permissions={permissions} path="/mau-in"><PrintTemplates store={store} /></ProtectedRoute>} />
            <Route path="/dong-bo-san-pham" element={<ProtectedRoute user={user} permissions={permissions} path="/dong-bo-san-pham"><SapoProductSync /></ProtectedRoute>} />
            <Route path={LOGIN_REGISTER_ROUTE} element={<Navigate to={firstAccessibleRoute(user, permissions)} replace />} />
            {Object.entries(ROUTE_ALIASES).map(([from, to]) => (
              <Route key={from} path={from} element={<Navigate to={canAccess(to) ? to : firstAccessibleRoute(user, permissions)} replace />} />
            ))}
            <Route path="*" element={<Navigate to={canAccessAny(Object.keys(ROUTE_PERMISSIONS)) ? firstAccessibleRoute(user, permissions) : HOME_ROUTE} replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

const emptyAuthState = {
  user: null,
  account: null,
  permissions: [],
  session: null,
  syncVersions: {},
  bootstrap: {},
};

export default function App() {
  const [authState, setAuthState] = useState(emptyAuthState);
  const [store, setStore] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(() => matchesMediaQuery(DESKTOP_SIDEBAR_QUERY, true));
  const [initializing, setInitializing] = useState(true);
  const [bootstrapStatus, setBootstrapStatus] = useState(null);
  const [redirectPath, setRedirectPath] = useState('');
  const syncVersionsRef = useRef({});
  const syncPollingRef = useRef(false);

  useEffect(() => {
    syncVersionsRef.current = authState.syncVersions || {};
  }, [authState.syncVersions]);

  const resetAuthState = useCallback(() => {
    setAuthState(emptyAuthState);
    setStore({});
    setRedirectPath('');
  }, []);

  const loadBootstrapStatus = useCallback(async () => {
    try {
      const status = await authApi.bootstrapStatus();
      setBootstrapStatus(status);
      return status;
    } catch (err) {
      const fallback = { ok: false, needsSetup: false, message: getApiErrorMessage(err?.data, err?.message || 'Không thể kiểm tra trạng thái hệ thống.') };
      setBootstrapStatus(fallback);
      return fallback;
    }
  }, []);

  const applyServerPayload = useCallback(async (payload, { persistMode = 'snapshot', redirect = true, sync = true } = {}) => {
    if (!payload?.user) throw new Error('Server không trả thông tin tài khoản hợp lệ.');

    const sessionState = buildSessionState(payload);
    const identityChanged = persistMode === 'session'
      ? persistAuthenticatedPayload(payload).identityChanged
      : false;

    if (persistMode === 'snapshot') {
      persistAuthSnapshot(payload);
      clearVolatileCache({ includePending: false });
    }

    setAuthState(sessionState);
    const payloadStore = extractStore(payload);
    if (payloadStore) setStore(payloadStore);

    if (sync) {
      if (!identityChanged) {
        pushPendingLocalData().catch(err => {
          console.warn('Không thể đồng bộ dữ liệu pending cục bộ:', err);
        });
      }

      pullServerBootstrapData().then(data => {
        const pulledStore = extractStore(data);
        if (pulledStore) setStore(pulledStore);
        if (data?.syncVersions) {
          setAuthState(current => ({ ...current, syncVersions: data.syncVersions }));
          persistAuthSnapshot({ ...sessionState, syncVersions: data.syncVersions });
        }
      }).catch(err => {
        console.warn('Không thể kéo dữ liệu đồng bộ từ server:', err);
      });
    }

    const defaultRoute = normalizeDefaultRoute(sessionState.bootstrap?.defaultRoute || payload.defaultRoute, sessionState.user, sessionState.permissions);
    const redirectRoute = persistMode === 'snapshot'
      ? getRestoredSessionRoute(defaultRoute, sessionState.user, sessionState.permissions)
      : defaultRoute;
    if (redirect) setRedirectPath(redirectRoute);
    return { ...sessionState, defaultRoute, redirectRoute, identityChanged };
  }, []);

  useEffect(() => {
    let mounted = true;

    const initializeSession = async () => {
      setInitializing(true);
      const token = getAuthToken();

      if (!token) {
        clearAuthSession({ clearVolatile: true, includePending: false });
        resetAuthState();
        await loadBootstrapStatus();
        if (mounted) setInitializing(false);
        return;
      }

      try {
        let payload;
        try {
          payload = await authApi.bootstrap();
        } catch (bootstrapErr) {
          if (bootstrapErr?.status === 403) {
            payload = await authApi.profile();
          } else {
            throw bootstrapErr;
          }
        }

        if (!mounted) return;
        await applyServerPayload(payload, { persistMode: 'snapshot', redirect: true, sync: true });
        setBootstrapStatus(null);
      } catch (err) {
        clearAuthSession({ clearVolatile: true, includePending: true });
        resetAuthState();
        await loadBootstrapStatus();
      } finally {
        if (mounted) setInitializing(false);
      }
    };

    initializeSession();

    const onAuthExpired = () => {
      clearAuthSession({ clearVolatile: true, includePending: true });
      resetAuthState();
      loadBootstrapStatus();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);

    return () => {
      mounted = false;
      window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
    };
  }, [applyServerPayload, loadBootstrapStatus, resetAuthState]);

  useEffect(() => {
    if (!authState.user) return undefined;

    let stopped = false;
    let timer = null;
    let nextDelay = SYNC_POLL_INTERVAL_MS;

    const schedule = (delay = nextDelay) => {
      if (stopped) return;
      timer = window.setTimeout(pollVersions, delay);
    };

    const pollVersions = async () => {
      if (stopped || syncPollingRef.current || !getAuthToken()) {
        schedule(nextDelay);
        return;
      }

      syncPollingRef.current = true;
      try {
        const versionPayload = await authApi.syncVersions();
        const nextVersions = versionPayload?.syncVersions || {};
        const changedTables = collectChangedSyncTables(syncVersionsRef.current, nextVersions);

        if (changedTables.length > 0) {
          const pulled = await pullServerBootstrapData({ tables: changedTables, invoiceLimit: 200 });
          const effectiveVersions = pulled?.syncVersions || nextVersions;
          const pulledStore = extractStore(pulled);
          if (pulledStore) setStore(pulledStore);

          setAuthState(current => {
            const nextState = { ...current, syncVersions: effectiveVersions };
            persistAuthSnapshot(nextState);
            return nextState;
          });
          syncVersionsRef.current = effectiveVersions;
          dispatchSyncUpdated({
            changedTables,
            data: pulled?.data || {},
            syncVersions: effectiveVersions,
            serverTime: pulled?.serverTime || versionPayload?.serverTime || null,
          });
        } else {
          syncVersionsRef.current = nextVersions;
        }

        nextDelay = SYNC_POLL_INTERVAL_MS;
      } catch (err) {
        console.warn('Không thể polling phiên bản đồng bộ:', err);
        nextDelay = Math.min(nextDelay * 2, SYNC_POLL_BACKOFF_MAX_MS);
      } finally {
        syncPollingRef.current = false;
        schedule(nextDelay);
      }
    };

    schedule(5000);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [authState.user]);

  const handleAuthenticated = useCallback(async (payload) => {
    const result = await applyServerPayload(payload, { persistMode: 'session', redirect: true, sync: true });
    setBootstrapStatus(null);
    return result;
  }, [applyServerPayload]);

  const handleLogout = useCallback(async () => {
    const token = getAuthToken();
    if (token) {
      try {
        await authApi.logout();
      } catch (_) {
        // Nếu token đã hết hạn, apiClient đã cleanup và phát sự kiện 401.
      }
    }
    clearAuthSession({ clearVolatile: true, includePending: true });
    resetAuthState();
    await loadBootstrapStatus();
  }, [loadBootstrapStatus, resetAuthState]);

  if (initializing) {
    return <FullScreenLoading message="Đang khôi phục phiên từ server..." />;
  }

  return (
    <HashRouter>
      {!authState.user ? (
        <Routes>
          <Route path={LOGIN_REGISTER_ROUTE} element={<Register onLogin={handleAuthenticated} bootstrapStatus={bootstrapStatus} />} />
          <Route path="*" element={<Login onLogin={handleAuthenticated} bootstrapStatus={bootstrapStatus} onBootstrapStatus={setBootstrapStatus} />} />
        </Routes>
      ) : (
        <AppLayout
          authState={authState}
          user={authState.user}
          store={store}
          setStore={setStore}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          onLogout={handleLogout}
          redirectPath={redirectPath}
          onRedirected={() => setRedirectPath('')}
        />
      )}
    </HashRouter>
  );
}
