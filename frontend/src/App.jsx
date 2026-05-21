﻿import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate, } from 'react-router-dom';
import Home from './pages/Home';
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
import CustomerOrderReport from './pages/CustomerOrderReport';
import ProductReport from './pages/ProductReport';
import CashBook from './pages/CashBook';
import Payroll from './pages/Payroll';
import PrintTemplates from './pages/PrintTemplates';
import {
  BadgeDollarSign,
  BarChart3,
  Box,
  Boxes,
  ClipboardList,
  FileText,
  Home as HomeIcon,
  Menu,
  Package,
  PlusCircle,
  Printer,
  Settings as SettingsIcon,
  ShieldCheck,
  ShoppingCart,
  Sliders,
  Truck,
  Users,
  Wallet,
  Warehouse,
  X,
} from 'lucide-react';
import {
  AUTH_EXPIRED_EVENT,
  SYNC_CHECK_REQUEST_EVENT,
  SYNC_UPDATED_EVENT,
  authApi,
  getApiErrorMessage,
  persistAuthenticatedPayload,
  persistAuthSnapshot,
  pullServerBootstrapData,
  pushPendingLocalData,
} from './utils/apiClient';
import { clearAuthSession, clearVolatileCache, getAuthToken, normalizePermissions } from './utils/authStorage';


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
const COMPACT_SIDEBAR_QUERY = '(max-width: 767px)';
const NAV_ICON_CLASS = 'h-5 w-5 shrink-0';
const NAV_CHILD_ICON_CLASS = 'h-4 w-4 shrink-0';
const SYNC_POLL_ACTIVE_INTERVAL_MS = 4000;
const SYNC_POLL_INITIAL_DELAY_MS = 1500;
const SYNC_POLL_IMMEDIATE_DELAY_MS = 250;
const SYNC_POLL_BACKGROUND_INTERVAL_MS = 30000;
const SYNC_POLL_OFFLINE_INTERVAL_MS = 30000;
const SYNC_POLL_BACKOFF_MAX_MS = 60000;

function matchesMediaQuery(query, fallback = false) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return fallback;
  return window.matchMedia(query).matches;
}

function isCompactSidebarViewport() {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') return window.matchMedia(COMPACT_SIDEBAR_QUERY).matches;
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
  '/bao-cao-theo-don-hang': ['invoices.read'],
  '/bao-cao-theo-san-pham': ['stats.read'],
  '/cai-dat': ['settings.read', 'settings.manage', 'store.read', 'store.manage', 'users.read', 'users.manage', 'customers.read', 'customers.manage', 'updates.read', 'updates.manage'],
  '/mau-in': ['print_templates.read'],
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

function ProtectedRoute({ user, permissions, path, children }) {
  if (!user) return <Navigate to={LOGIN_REGISTER_ROUTE} replace />;
  if (!canAccessRoute(path, user, permissions)) {
    const accessibleRoute = firstAccessibleRoute(user, permissions);
    // Tránh redirect loop: nếu không có route nào accessible, giữ nguyên route hiện tại
    if (accessibleRoute === HOME_ROUTE && !canAccessRoute(HOME_ROUTE, user, permissions)) {
      return <div className="flex items-center justify-center min-h-screen"><div className="text-center p-6 bg-white rounded-lg shadow-lg"><h2 className="text-xl font-bold text-gray-800 mb-2">Không có quyền truy cập</h2><p className="text-gray-600">Vui lòng liên hệ quản trị viên.</p></div></div>;
    }
    return <Navigate to={accessibleRoute} replace />;
  }
  return children;
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

function AppLayout({
  authState,
  store,
  onStoreChange,
  sidebarOpen,
  setSidebarOpen,
  onLogout,
  redirectPath,
  onRedirected,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [openMenus, setOpenMenus] = useState({ don_hang: true });
  const [updateToast, setUpdateToast] = useState(null);
  const [updateToastVisible, setUpdateToastVisible] = useState(false);
  const [compactSidebarVisible, setCompactSidebarVisible] = useState(() => isCompactSidebarViewport());
  const [compactSidebarAnimating, setCompactSidebarAnimating] = useState(false);
  const user = authState.user;
  const permissions = authState.permissions;
  const canAccess = useCallback((route) => canAccessRoute(route, user, permissions), [permissions, user]);
  const canAccessAny = useCallback((routes = []) => routes.some(route => canAccess(route)), [canAccess]);

  useEffect(() => {
    if (redirectPath && canAccess(redirectPath)) {
      navigate(redirectPath, { replace: true });
      onRedirected?.();
    }
  }, [canAccess, navigate, onRedirected, redirectPath]);

  useEffect(() => {
    const handleUpdateToast = (event) => {
      const detail = event?.detail || {};
      if (!detail?.available) return;
      setUpdateToast(detail);
      setUpdateToastVisible(true);
    };
    window.addEventListener('kha-update-available', handleUpdateToast);
    return () => window.removeEventListener('kha-update-available', handleUpdateToast);
  }, []);

  useEffect(() => {
    const handleResize = () => setCompactSidebarVisible(isCompactSidebarViewport());
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
          { to: '/nha-cung-cap', label: 'Đối Tác', icon: Truck },
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
          { to: '/mau-in', label: 'Hóa đơn', icon: Printer },
        ],
      },
    ];

    return groups.filter(group => !group.items || group.items.some(item => canAccess(item.to)) || canAccess(group.to));
  }, [canAccess]);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="flex min-h-screen">
        <aside className={`${sidebarOpen ? 'w-72' : 'w-0'} transition-all duration-300 ease-in-out`}>
          <nav className="p-4">
            {navGroups.map(group => (
              <div key={group.key || group.to} className="mb-4">
                <div className="flex items-center gap-2 text-gray-700 font-semibold mb-2">
                  {group.icon && <NavMenuIcon icon={group.icon} className={NAV_ICON_CLASS} />}
                  <span>{group.label}</span>
                </div>
                {group.items?.filter(item => canAccess(item.to)).map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                        isActive
                          ? 'bg-blue-500 text-white'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`
                    }
                  >
                    {item.icon && <NavMenuIcon icon={item.icon} className={NAV_CHILD_ICON_CLASS} />}
                    <span className="text-sm">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
        </aside>
        <div className="app-main-scroll flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-auto p-3 sm:p-4">
          <Routes>
            <Route path={HOME_ROUTE} element={<Home user={user} store={store} />} />
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
            <Route path="/bao-cao-theo-don-hang" element={<ProtectedRoute user={user} permissions={permissions} path="/bao-cao-theo-don-hang"><CustomerOrderReport /></ProtectedRoute>} />
            <Route path="/bao-cao-theo-san-pham" element={<ProtectedRoute user={user} permissions={permissions} path="/bao-cao-theo-san-pham"><ProductReport /></ProtectedRoute>} />
            <Route path="/cai-dat" element={<ProtectedRoute user={user} permissions={permissions} path="/cai-dat"><Settings store={store} onStoreChange={onStoreChange} permissions={permissions} /></ProtectedRoute>} />
            <Route path="/mau-in" element={<ProtectedRoute user={user} permissions={permissions} path="/mau-in"><PrintTemplates store={store} /></ProtectedRoute>} />
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

function DesktopApp() {
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
        let payload = await authApi.profile();

        if (!mounted) return;
        // Profile đã trả về đầy đủ user + permissions + syncVersions
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
    let nextDelay = SYNC_POLL_ACTIVE_INTERVAL_MS;
    let consecutiveFailures = 0;

    const isAppOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
    const isAppVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const getBaseDelay = () => {
      if (!isAppOnline()) return SYNC_POLL_OFFLINE_INTERVAL_MS;
      if (!isAppVisible()) return SYNC_POLL_BACKGROUND_INTERVAL_MS;
      return SYNC_POLL_ACTIVE_INTERVAL_MS;
    };

    const clearScheduledPoll = () => {
      if (timer) window.clearTimeout(timer);
      timer = null;
    };

    const schedule = (delay = nextDelay) => {
      if (stopped) return;
      clearScheduledPoll();
      const safeDelay = Math.max(0, Number(delay) || 0);
      timer = window.setTimeout(pollVersions, safeDelay);
    };

    const requestImmediatePoll = () => {
      if (stopped || !getAuthToken()) return;
      if (!isAppOnline()) {
        nextDelay = SYNC_POLL_OFFLINE_INTERVAL_MS;
        schedule(nextDelay);
        return;
      }
      consecutiveFailures = 0;
      nextDelay = isAppVisible() ? SYNC_POLL_ACTIVE_INTERVAL_MS : SYNC_POLL_BACKGROUND_INTERVAL_MS;
      schedule(isAppVisible() ? SYNC_POLL_IMMEDIATE_DELAY_MS : SYNC_POLL_BACKGROUND_INTERVAL_MS);
    };

    async function pollVersions() {
      if (stopped) return;

      if (!getAuthToken()) {
        nextDelay = SYNC_POLL_BACKGROUND_INTERVAL_MS;
        schedule(nextDelay);
        return;
      }

      if (!isAppOnline()) {
        nextDelay = SYNC_POLL_OFFLINE_INTERVAL_MS;
        schedule(nextDelay);
        return;
      }

      if (syncPollingRef.current) {
        schedule(Math.min(getBaseDelay(), 1000));
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

        consecutiveFailures = 0;
        nextDelay = getBaseDelay();
      } catch (err) {
        console.warn('Không thể polling phiên bản đồng bộ:', err);
        consecutiveFailures += 1;
        nextDelay = Math.min(getBaseDelay() * (2 ** consecutiveFailures), SYNC_POLL_BACKOFF_MAX_MS);
      } finally {
        syncPollingRef.current = false;
        schedule(nextDelay);
      }
    }

    const handleOnline = () => requestImmediatePoll();
    const handleOffline = () => {
      nextDelay = SYNC_POLL_OFFLINE_INTERVAL_MS;
      schedule(nextDelay);
    };
    const handleFocus = () => {
      if (isAppVisible()) requestImmediatePoll();
    };
    const handleVisibilityChange = () => {
      if (isAppVisible()) requestImmediatePoll();
      else {
        nextDelay = getBaseDelay();
        schedule(nextDelay);
      }
    };

    schedule(SYNC_POLL_INITIAL_DELAY_MS);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('kha-order-created', requestImmediatePoll);
    window.addEventListener(SYNC_CHECK_REQUEST_EVENT, requestImmediatePoll);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopped = true;
      clearScheduledPoll();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('kha-order-created', requestImmediatePoll);
      window.removeEventListener(SYNC_CHECK_REQUEST_EVENT, requestImmediatePoll);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
    return <FullScreenLoading message="Đang Loading Lại Trang ..." />;
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
          store={store}
          onStoreChange={setStore}
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

export default function App() {
  return <DesktopApp />;
}
