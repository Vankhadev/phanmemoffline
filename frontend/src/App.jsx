import { useCallback, useEffect, useMemo, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
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
import { ClipboardList, ChevronDown, ChevronRight } from 'lucide-react';
import {
  API_BASE,
  AUTH_EXPIRED_EVENT,
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

  const toggleMenu = (key) => {
    setOpenMenus(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const canAccess = (route) => canAccessRoute(route, user, permissions);
  const canAccessAny = (routes = []) => routes.some(route => canAccess(route));

  const navGroups = useMemo(() => {
    const groups = [
      { to: HOME_ROUTE, label: 'Trang chủ', icon: '🏠' },
      {
        key: 'don_hang',
        label: 'Đơn hàng',
        icon: <ClipboardList size={18} />,
        items: [
          { to: '/tao-don-hang', label: 'Tạo đơn hàng' },
          { to: '/danh-sach-don-hang', label: 'Danh sách đơn hàng' },
        ],
      },
      {
        key: 'danh_muc',
        label: 'Danh mục',
        icon: '📦',
        items: [
          { to: '/san-pham', label: 'Sản phẩm' },
          { to: '/kho-hang', label: 'Kho hàng' },
          { to: '/khach-hang', label: 'Khách hàng' },
          { to: '/nhap-hang', label: 'Nhập hàng' },
          { to: '/nha-cung-cap', label: 'Nhà cung cấp' },
        ],
      },
      {
        key: 'quan_ly',
        label: 'Quản lý',
        icon: '⚙️',
        items: [
          { to: '/thong-ke', label: 'Thống kê' },
          { to: '/so-quy', label: 'Sổ quỹ' },
          { to: '/bao-cao-thu-e', label: 'Báo cáo doanh thu' },
          { to: '/bao-cao-theo-don-hang', label: 'Báo cáo theo đơn hàng' },
          { to: '/bao-cao-theo-san-pham', label: 'Báo cáo sản phẩm' },
          { to: '/bang-luong-nhan-vien', label: 'Bảng lương nhân viên' },
          { to: '/cai-dat', label: 'Cài đặt' },
          { to: '/mau-in', label: 'Mẫu in' },
          { to: '/dong-bo-san-pham', label: 'Đồng bộ Sapo' },
        ],
      },
    ];

    return groups
      .map(group => group.items ? { ...group, items: group.items.filter(item => canAccess(item.to)) } : group)
      .filter(group => group.items ? group.items.length > 0 : canAccess(group.to));
  }, [permissions, user]);

  useEffect(() => {
    setOpenMenus(prev => {
      const next = { ...prev };
      for (const group of navGroups) {
        if (group.items?.some(item => item.to === location.pathname)) next[group.key] = true;
      }
      return next;
    });
  }, [location.pathname, navGroups]);

  // Get initials from name
  const getInitials = (name) => {
    if (!name) return '👤';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[parts.length - 1][0] || parts[0][0]).toUpperCase();
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-56' : 'w-16'} bg-gray-900 text-white flex flex-col transition-all duration-200`}>
        <div className="p-3 border-b border-gray-700">
          <div className="flex items-center justify-between">
            {sidebarOpen && (
              <div>
                <div className="text-xs text-gray-400 font-bold">{store.name || account?.name || 'Bán hàng offline'}</div>
                <div className="text-xs text-blue-400">{desktopVersion ? `Version ${desktopVersion}` : 'Version 1.1.9'}</div>
              </div>
            )}
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-400 hover:text-white text-lg">☰</button>
          </div>
        </div>

        <nav className="flex-1 py-2 overflow-y-auto">
          {navGroups.map(group =>
            group.items ? (
              <div key={group.key}>
                <button
                  onClick={() => toggleMenu(group.key)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-700 transition ${group.items.some(i => location.pathname === i.to)
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300'
                    }`}>
                  <span className="text-base">{group.icon}</span>
                  {sidebarOpen && (
                    <>
                      <span className="flex-1 text-left">{group.label}</span>
                      <span className="text-xs">
                        {openMenus[group.key] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                    </>
                  )}
                </button>
                {openMenus[group.key] && sidebarOpen && group.items.map(item => (
                  <NavLink key={item.to} to={item.to}
                    className={({ isActive }) => `flex items-center gap-3 px-4 py-2.5 pl-10 text-sm hover:bg-gray-700 transition ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300'
                      }`}>
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            ) : (
              <NavLink key={group.to} to={group.to}
                className={({ isActive }) => `flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-700 transition ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300'}`}>
                <span className="text-base">{group.icon}</span>
                {sidebarOpen && <span>{group.label}</span>}
              </NavLink>
            )
          )}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold shrink-0">
              {getInitials(user?.name)}
            </div>
            {sidebarOpen && (
              <div className="text-xs overflow-hidden">
                <div className="font-medium text-white truncate">{user?.name}</div>
                <div className="text-gray-400 capitalize">{isAdmin ? 'admin' : user?.role || 'user'}</div>
              </div>
            )}
          </div>
          <button onClick={onLogout}
            className="w-full text-xs text-red-400 hover:text-red-300 border border-red-500 rounded px-2 py-1 text-center">
            {sidebarOpen ? 'Đăng xuất' : '⬅'}
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm">
          <div className="text-lg font-bold text-gray-800">{store.name || account?.name || 'Bán hàng offline'}</div>
          <div className="text-sm text-gray-500">
            {store.phone}{store.phone && store.email ? ' · ' : ''}{store.email}
          </div>
        </div>
        {updateToast && (
          <div className={`mx-4 mt-4 rounded-xl border px-4 py-3 flex items-start justify-between gap-3 ${updateToast.tone === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
            <div>
              <div className="font-semibold text-sm">{updateToast.title}</div>
              <div className="text-sm mt-1">{updateToast.message}</div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => navigate('/cai-dat')} className="px-3 py-1.5 rounded-lg bg-white/80 border text-xs font-medium hover:bg-white">Mở cài đặt</button>
              <button onClick={() => setUpdateToast(null)} className="px-2 py-1 text-xs opacity-70 hover:opacity-100">Đóng</button>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-auto p-4">
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [initializing, setInitializing] = useState(true);
  const [bootstrapStatus, setBootstrapStatus] = useState(null);
  const [redirectPath, setRedirectPath] = useState('');

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
