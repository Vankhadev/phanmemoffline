import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import LiveSyncBadge from './components/LiveSyncBadge';
import KhoHang from './pages/KhoHang';
import Nhaphang from './pages/nhaphang';
import CustomerOrderReport from './pages/CustomerOrderReport';
import ProductReport from './pages/ProductReport';
import CashBook from './pages/CashBook';
import Payroll from './pages/Payroll';
import InvoicePrint from './pages/InvoicePrint';
import AccountingDashboard from './pages/AccountingDashboard';
import TaxReport from './pages/TaxReport';
import InventoryReport from './pages/InventoryReport';
import AccountingLogs from './pages/AccountingLogs';
import HelpModal from './components/HelpModal';
import {
  BadgeDollarSign,
  BarChart3,
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  FileClock,
  FileText,
  HelpCircle,
  Home as HomeIcon,
  LogOut,
  Menu,
  Package,
  PlusCircle,
  ReceiptText,
  Scale,
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

import {
  getMobileOfflineSessionPayload,
  isLocalMobileAuthToken,
} from './utils/mobileOfflineAuth';


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
const MOBILE_PINNED_ROUTES = new Set([HOME_ROUTE, '/tao-don-hang', '/danh-sach-don-hang']);
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
  if (!name) return 'KH';
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
  '/hoa-don-in': ['invoices.read'],
  '/kho-hang': ['products.read'],
  '/nha-cung-cap': ['partners.read'],
  '/nhap-hang': ['imports.read'],
  '/san-pham': ['products.read'],
  '/khach-hang': ['customers.read'],
  '/thong-ke': ['stats.read'],
  '/so-quy': ['cashbook.read'],
  '/ke-toan': ['accounting.read', 'revenue_reports.read'],
  '/ke-toan/bao-cao-thue': ['tax_reports.read'],
  '/ke-toan/bao-cao-ton-kho': ['inventory_reports.read'],
  '/ke-toan/nhat-ky': ['activity_logs.read'],
  '/bang-luong-nhan-vien': ['payrolls.read'],
  '/bao-cao-theo-don-hang': ['invoices.read'],
  '/bao-cao-theo-san-pham': ['stats.read'],

  '/cai-dat': ['settings.read', 'settings.manage', 'store.read', 'store.manage', 'users.read', 'users.manage', 'customers.read', 'customers.manage', 'updates.read', 'updates.manage', 'print_templates.read', 'print_templates.manage'],
};

function resolvePermissionRoute(route) {
  const safeRoute = normalizeRoutePath(route);
  if (Object.prototype.hasOwnProperty.call(ROUTE_PERMISSIONS, safeRoute)) return safeRoute;
  if (safeRoute.startsWith('/hoa-don-in/')) return '/hoa-don-in';
  return safeRoute;
}

function isKnownAppRoute(route) {
  return Object.prototype.hasOwnProperty.call(ROUTE_PERMISSIONS, resolvePermissionRoute(route));
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
  const permissionRoute = resolvePermissionRoute(route);
  if (!user || !isKnownAppRoute(permissionRoute)) return false;
  const required = ROUTE_PERMISSIONS[permissionRoute] || [];
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
        <div className="text-lg font-bold text-gray-800">Bán Hàng Pos</div>
        <div className="mt-2 text-sm text-gray-500">{message}</div>
      </div>
    </div>
  );
}



function isRouteActive(currentPath, route) {
  const path = normalizeRoutePath(currentPath);
  const target = normalizeRoutePath(route);
  if (target === HOME_ROUTE) return path === HOME_ROUTE;
  return path === target || path.startsWith(`${target}/`);
}

function getUserDisplayName(user = {}) {
  return String(
    user.full_name ||
    user.fullName ||
    user.name ||
    user.username ||
    user.email ||
    user.phone ||
    'Tài khoản'
  ).trim();
}

function getUserSubtitle(user = {}) {
  const role = String(user.role || '').trim();
  const email = String(user.email || '').trim();
  if (role && email) return `${role} · ${email}`;
  return role || email || 'Đang đăng nhập';
}

function MobileBottomNavigation({ items, currentPath, activePanel, onTogglePanel }) {
  if (!items.length) return null;

  return (
    <nav
      className="mobile-bottom-nav md:hidden no-print"
      aria-label="Điều hướng mobile"
      style={{ '--mobile-tab-count': items.length }}
    >
      {items.map(item => {
        const Icon = item.icon;
        const isPanelItem = item.type === 'panel';
        const isActive = isPanelItem ? activePanel === item.panel : isRouteActive(currentPath, item.to);
        const tabClass = `mobile-bottom-tab ${isActive ? 'mobile-bottom-tab-active' : ''} ${item.primary ? 'mobile-bottom-tab-primary' : ''}`;

        const content = (
          <>
            <span className="mobile-bottom-icon-wrap">
              {Icon && <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={2.2} />}
            </span>
            <span className="mobile-bottom-label">{item.label}</span>
          </>
        );

        if (isPanelItem) {
          return (
            <button
              key={item.panel}
              type="button"
              className={tabClass}
              aria-label={item.label}
              aria-expanded={isActive}
              aria-controls={`mobile-${item.panel}-sheet`}
              title={item.label}
              onClick={() => onTogglePanel(item.panel)}
            >
              {content}
            </button>
          );
        }

        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={tabClass}
            aria-current={isActive ? 'page' : undefined}
            aria-label={item.label}
            title={item.label}
          >
            {content}
          </NavLink>
        );
      })}
    </nav>
  );
}

function buildScreenGuide(navGroups, currentPath) {
  const path = normalizeRoutePath(currentPath);
  const routeGuide = {
    '/': [
      'Xem nhanh doanh thu, đơn hàng, khách hàng và các cảnh báo ngay trên trang chủ.',
      'Chọn đúng menu bên trái để vào màn hình cần thao tác.',
      'Bấm nút Hướng dẫn ở góc phải để xem cách dùng của màn hình hiện tại.',
    ],
    '/tao-don-hang': [
      'Chọn khách hàng hoặc tạo khách hàng mới nếu chưa có.',
      'Tìm sản phẩm bằng ô tìm kiếm, rồi bấm Thêm để đưa vào đơn.',
      'Nhập số lượng, kiểm tra đơn giá, thành tiền và tổng đơn.',
      'Áp dụng giảm giá, phí vận chuyển hoặc công nợ nếu cần.',
      'Kiểm tra thanh toán, lưu đơn và in hóa đơn sau khi hoàn tất.',
    ],
    '/san-pham': [
      'Bấm Thêm để tạo sản phẩm mới.',
      'Điền tên, SKU, danh mục, giá nhập, giá bán và tồn ban đầu.',
      'Bấm Sửa để cập nhật thông tin sản phẩm khi có thay đổi.',
      'Dùng Import Excel để thêm nhiều sản phẩm cùng lúc.',
      'Dùng Export Excel để tải danh sách ra file kiểm tra.',
    ],
    '/khach-hang': [
      'Bấm Thêm để tạo hồ sơ khách hàng mới.',
      'Nhập tên, số điện thoại, email và địa chỉ nếu có.',
      'Bấm Sửa để cập nhật thông tin khi khách đổi liên hệ.',
      'M? lịch sử mua h?ng d? xem các don d? ph?t sinh.',
    ],
    '/kho-hang': [
      'Xem tồn kho theo kho hoặc theo nhóm hàng.',
      'Dùng tìm kiếm d? kiểm tra nhanh m?, t?n ho?c SKU.',
      'Theo dõi cảnh báo sắp hết hàng, hết hàng và âm kho.',
      'Dùng kiểm kê để đối chiếu số liệu thực tế với hệ thống.',
    ],
    '/thong-ke': [
      'Chọn khoảng thời gian cần xem báo cáo.',
      'Đọc biểu đồ để nắm doanh thu, lợi nhuận và xu hướng bán hàng.',
      'Mở từng khối thống kê để xem chi tiết khi cần đối soát.',
    ],
    '/cai-dat': [
      'Dùng các tab cài đặt để cấu hình cửa hàng, người dùng và hệ thống.',
      'Kiểm tra mẫu in, backup và restore trước khi phát hành.',
      'Lưu thay đổi sau khi chỉnh để hệ thống áp dụng ngay.',
    ],
    '/so-quy': [
      'Chọn loại thu hoặc chi trước khi tạo giao dịch mới.',
      'Nhập số tiền, nội dung và ngày phát sinh giao dịch.',
      'Kiểm tra số dư sau khi lưu để tránh lệch quỹ.',
      'Dùng bộ lọc để xem lại lịch sử theo khoảng ngày mong muốn.',
    ],
    '/nhap-hang': [
      'Chọn nh? cung cấp v? m? phiếu nhập n?u c?n.',
      'Thêm từng sản phẩm vào phiếu, nhập số lượng và giá nhập.',
      'Kiểm tra tổng tiền, chiết khấu và trạng thái thanh toán.',
      'Bấm lưu để cập nhật tồn kho hoặc lưu tạm khi chưa hoàn tất.',
    ],
    '/nha-cung-cap': [
      'Bấm Thêm để tạo nhà cung cấp mới.',
      'Điền tên, điện thoại, email, thuế và địa chỉ liên hệ.',
      'Bấm Sửa để cập nhật thông tin đối tác khi có thay đổi.',
      'Kiểm tra công nợ và lịch sử nhập hàng của nhà cung cấp.',
    ],
    '/danh-sach-don-hang': [
      'Dùng bộ lọc d? t?m don theo m?, khách hàng, trạng thái ho?c thời gian.',
      'Bấm Xem để mở chi tiết từng đơn hàng.',
      'Bấm In để in hóa đơn hoặc bấm PDF để lưu file.',
      'Kiểm tra trạng thái đơn trước khi thực hiện thao tác tiếp theo.',
    ],
    '/ke-toan': [
      'Chọn khoảng ngày để xem tổng doanh thu, số hóa đơn, giá vốn và lợi nhuận.',
      'Bấm vào thẻ báo cáo để mở báo cáo thuế, tồn kho hoặc nhật ký.',
      'So sánh số liệu giữa các kỳ để phát hiện chênh lệch sớm.',
      'Mở từng báo cáo chi tiết để đối chiếu theo hóa đơn, sản phẩm hoặc giao dịch.',
    ],
    '/ke-toan/bao-cao-thue': [
      'Chọn tháng hoặc khoảng thời gian cần lập báo cáo thuế.',
      'Bấm Xem báo cáo để hệ thống nạp dữ liệu đầu ra và đầu vào.',
      'Kiểm tra số thuế phải nộp trước khi chốt kỳ.',
      'Lưu snapshot nếu cần giữ lại trạng thái báo cáo hiện tại.',
    ],
    '/ke-toan/bao-cao-ton-kho': [
      'Chọn kỳ báo cáo và ngưỡng cảnh báo tồn kho.',
      'Kiểm tra các mặt hàng sắp hết, hết hàng hoặc âm kho.',
      'Dùng sắp xếp và lọc để tập trung vào nhóm cần xử lý trước.',
      'Đối chiếu giá vốn, số lượng và giá trị tồn kho theo từng mặt hàng.',
    ],
    '/ke-toan/nhat-ky': [
      'Chọn khoảng ngày để tra cứu nhật ký thay đổi.',
      'Nhập action hoặc từ khóa nếu muốn lọc sâu hơn.',
      'Bấm Xem ở từng dòng để mở dữ liệu trước và sau khi thay đổi.',
      'Dùng phân trang để xem các log cũ hơn mà không cần tải lại trang.',
    ],
    '/bang-luong-nhan-vien': [
      'Chọn tháng cần xem bảng lương.',
      'Kiểm tra doanh thu, hoa hồng, thưởng và trạng thái chi trả.',
      'Cập nhật trạng thái d? thanh toán khi ho?n tốt chi tr?.',
      'Xuất file nếu cần lưu hoặc gửi cho kế toán.',
    ],
    '/bao-cao-theo-don-hang': [
      'Chọn khách hàng và khoảng thời gian cần xem.',
      'Bấm tạo báo cáo để hệ thống thống kê toàn bộ đơn của khách đó.',
      'Xem tổng doanh thu, số đơn, tổng sản phẩm và đơn gần nhất.',
      'Bấm Xem chi tiết hoặc in/PDF khi cần đối chiếu.',
    ],
    '/bao-cao-theo-san-pham': [
      'Chọn kỳ báo cáo và trạng thái đơn hàng cần tính.',
      'Bấm Tạo báo cáo để thống kê doanh thu theo sản phẩm.',
      'Kiểm tra số lượng bán, tồn kho và biến động theo từng mặt hàng.',
      'Xuất Excel nếu cần gửi báo cáo cho quản lý.',
    ],
  };
  const matchedRoute = Object.keys(routeGuide).find(route => path === route || path.startsWith(`${route}/`)) || path;
  const readableRouteName = matchedRoute === HOME_ROUTE
    ? 'Trang chủ'
    : matchedRoute
      .replace(/^\//, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());

  return {
    title: `Hướng dẫn ${readableRouteName}`,
    steps: routeGuide[matchedRoute] || [
      'Bấm nút Hướng dẫn ở góc phải để xem các bước của màn hình này.',
      'Dùng đúng nút thao tác trên màn hình để hoàn tất công việc.',
    ],
  };
}

function MobileActionSheet({ activePanel, moreGroups, user, currentPath, onClose, onLogout }) {
  if (!activePanel) return null;

  const isAccountPanel = activePanel === 'account';
  const displayName = getUserDisplayName(user);
  const subtitle = getUserSubtitle(user);
  const accountTools = (
    <div className="mobile-account-panel mobile-account-panel-compact">
      <div className="mobile-account-summary">
        <div className="mobile-account-avatar">{getInitials(displayName)}</div>
        <div className="min-w-0">
          <div className="mobile-account-name">{displayName}</div>
          <div className="mobile-account-subtitle">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>{subtitle}</span>
          </div>
        </div>
      </div>
      <button type="button" className="mobile-logout-btn" onClick={() => { onClose(); onLogout?.(); }}>
        <LogOut aria-hidden="true" className="h-5 w-5" />
        <span>Đăng xuất</span>
      </button>
    </div>
  );

  return (
    <>
      <button
        type="button"
        className="mobile-sheet-backdrop md:hidden no-print"
        aria-label="Đóng menu"
        onClick={onClose}
      />
      <section
        id={`mobile-${activePanel}-sheet`}
        className="mobile-bottom-sheet md:hidden no-print"
        role="dialog"
        aria-modal="true"
        aria-label={isAccountPanel ? 'Tài khoản' : 'Chức năng'}
      >
        <div className="mobile-sheet-header">
          <div className="min-w-0">
            <h2>{isAccountPanel ? 'Tài khoản' : 'Khác'}</h2>
            <p>{isAccountPanel ? 'Thông tin đăng nhập' : 'Tài khoản và các chức năng còn lại'}</p>
          </div>
          <button type="button" className="mobile-sheet-close" aria-label="Đóng menu" onClick={onClose}>
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        {isAccountPanel ? (
          accountTools
        ) : (
          <div className="mobile-sheet-scroll">
            {moreGroups.length === 0 ? (
              <div className="mobile-sheet-empty">Không có chức năng khác.</div>
            ) : (
              moreGroups.map(group => (
                <div key={group.key || group.label} className="mobile-sheet-group">
                  <div className="mobile-sheet-group-title">
                    {group.icon && <NavMenuIcon icon={group.icon} className="h-4 w-4 shrink-0" />}
                    <span>{group.label}</span>
                  </div>
                  <div className="mobile-sheet-grid">
                    {group.items.map(item => {
                      const active = isRouteActive(currentPath, item.to);
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={`mobile-sheet-route ${active ? 'mobile-sheet-route-active' : ''}`}
                          aria-current={active ? 'page' : undefined}
                          onClick={onClose}
                        >
                          {item.icon && <NavMenuIcon icon={item.icon} className="h-5 w-5 shrink-0" />}
                          <span>{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
            {accountTools}
          </div>
        )}
      </section>
    </>
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
  const [openMenus, setOpenMenus] = useState(() => ({
    don_hang: location.pathname.startsWith('/tao-don-hang') || location.pathname.startsWith('/danh-sach-don-hang'),
    danh_muc: location.pathname.startsWith('/san-pham') || location.pathname.startsWith('/kho-hang') || location.pathname.startsWith('/khach-hang') || location.pathname.startsWith('/nhap-hang') || location.pathname.startsWith('/nha-cung-cap'),
    quan_ly: location.pathname.startsWith('/thong-ke') || location.pathname.startsWith('/so-quy') || location.pathname.startsWith('/bao-cao-theo-don-hang') || location.pathname.startsWith('/bao-cao-theo-san-pham') || location.pathname.startsWith('/bang-luong-nhan-vien') || location.pathname.startsWith('/cai-dat'),
  }));
  const [updateToast, setUpdateToast] = useState(null);
  const [updateToastVisible, setUpdateToastVisible] = useState(false);
  const [upgradeToast, setUpgradeToast] = useState(null);
  const [compactSidebarVisible, setCompactSidebarVisible] = useState(() => isCompactSidebarViewport());
  const [compactSidebarAnimating, setCompactSidebarAnimating] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(null);
  const [showScreenGuide, setShowScreenGuide] = useState(false);
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
    if (typeof window !== 'undefined' && window.khaDesktop?.onShortcutUpdated) {
      const unsubscribe = window.khaDesktop.onShortcutUpdated((payload) => {
        if (payload?.success) {
          setUpgradeToast(payload.message);
        }
      });
      return unsubscribe;
    }
    return undefined;
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const isCompact = isCompactSidebarViewport();
      setCompactSidebarVisible(isCompact);
      setSidebarOpen?.(!isCompact);
      if (!isCompact) setMobilePanel(null);
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [setSidebarOpen]);

  useEffect(() => {
    setMobilePanel(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobilePanel) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setMobilePanel(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobilePanel]);

  useEffect(() => {
    setOpenMenus(prev => {
      const next = { ...prev };
      let changed = false;
      const autoOpenMatchers = {
        don_hang: ['/tao-don-hang', '/danh-sach-don-hang'],
        danh_muc: ['/san-pham', '/kho-hang', '/khach-hang', '/nhap-hang', '/nha-cung-cap'],
        quan_ly: ['/thong-ke', '/so-quy', '/bao-cao-theo-don-hang', '/bao-cao-theo-san-pham', '/bang-luong-nhan-vien', '/cai-dat'],
      };

      Object.entries(autoOpenMatchers).forEach(([key, routes]) => {
        if (routes.some(route => location.pathname.startsWith(route)) && !prev[key]) {
          next[key] = true;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [location.pathname]);

  const toggleMenuGroup = useCallback((groupKey) => {
    setOpenMenus(prev => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  }, []);

  const toggleMobilePanel = useCallback((panel) => {
    setMobilePanel(current => current === panel ? null : panel);
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
        ],
      },
    ];

    return groups.filter(group => !group.items || group.items.some(item => canAccess(item.to)) || (group.to && canAccess(group.to)));
  }, [canAccess]);

  const mobileMoreGroups = useMemo(() => {
    return navGroups
      .map(group => {
        if (group.items) {
          const items = group.items.filter(item => canAccess(item.to) && !MOBILE_PINNED_ROUTES.has(item.to));
          return items.length ? { ...group, items } : null;
        }

        if (!group.to || MOBILE_PINNED_ROUTES.has(group.to) || !canAccess(group.to)) return null;
        return {
          key: group.key || group.to,
          label: 'Chức năng', 
          icon: group.icon,
          items: [group],
        };
      })
      .filter(Boolean);
  }, [canAccess, navGroups]);

  const mobileNavItems = useMemo(() => {
    return [
      { type: 'route', to: HOME_ROUTE, label: 'Trang chủ', icon: HomeIcon },
      { type: 'route', to: '/tao-don-hang', label: 'Tạo đơn', icon: PlusCircle, primary: true },
      { type: 'route', to: '/danh-sach-don-hang', label: 'Danh sách đơn', icon: ClipboardList },
      { type: 'panel', panel: 'more', label: 'Khác', icon: Menu },
    ].filter(item => item.type !== 'route' || canAccess(item.to));
  }, [canAccess, mobileMoreGroups.length]);

  const screenGuide = useMemo(() => buildScreenGuide(navGroups, location.pathname), [location.pathname, navGroups]);

  return (
    <div className="mobile-app-shell h-screen overflow-hidden bg-gray-100">
      <div className="flex h-full min-h-0">
        <aside
          className={`${sidebarOpen ? 'w-72' : 'w-0'} sticky top-0 z-20 hidden h-screen shrink-0 overflow-hidden border-r border-gray-200 bg-white transition-all duration-300 ease-in-out md:block`}
        >
          <nav className="flex h-full flex-col overflow-y-auto px-4 py-5">
            <div className="flex items-center gap-3 mb-6 px-3">
               <img src="/icons/app-icon.svg" alt="POS Logo" className="h-9 w-9 rounded-xl object-cover shadow-sm" />
              <div className="font-bold text-gray-800 text-lg leading-tight">Bán Hàng Pos</div>
            </div>
            {navGroups.map(group => {
              const accessibleItems = group.items?.filter(item => canAccess(item.to)) || [];

              if (accessibleItems.length === 0) {
                if (!group.to) return null;
                return (
                  <NavLink
                    key={group.key || group.to}
                    to={group.to}
                    className={({ isActive }) =>
                      `mb-4 flex items-center gap-2 rounded-xl px-3 py-2.5 font-semibold transition-colors ${
                        isActive
                          ? 'bg-blue-500 text-white shadow-sm'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`
                    }
                  >
                    {group.icon && <NavMenuIcon icon={group.icon} className={NAV_ICON_CLASS} />}
                    <span className="truncate">{group.label}</span>
                  </NavLink>
                );
              }

              const isOpen = Boolean(openMenus[group.key]);
              const hasActiveChild = accessibleItems.some(item => location.pathname === item.to);

              return (
                <div key={group.key || group.to} className="mb-4">
                  <button
                    type="button"
                    onClick={() => toggleMenuGroup(group.key)}
                    className={`mb-2 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left font-semibold transition-colors ${
                      hasActiveChild
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    aria-expanded={isOpen}
                    aria-controls={`nav-group-${group.key}`}
                  >
                    {group.icon && <NavMenuIcon icon={group.icon} className={NAV_ICON_CLASS} />}
                    <span className="min-w-0 flex-1 truncate">{group.label}</span>
                    {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  </button>
                  <div id={`nav-group-${group.key}`} className={isOpen ? 'space-y-1' : 'hidden'}>
                    {accessibleItems.map(item => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                          `flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                            isActive
                              ? 'bg-blue-500 text-white shadow-sm'
                              : 'text-gray-600 hover:bg-gray-100'
                          }`
                        }
                      >
                        {item.icon && <NavMenuIcon icon={item.icon} className={NAV_CHILD_ICON_CLASS} />}
                        <span className="min-w-0 truncate">{item.label}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              );
            })}
          </nav>
        </aside>
        <div className="app-main-scroll flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-auto p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-end gap-3 no-print">
            <LiveSyncBadge
              tables={['invoices', 'invoice_details', 'customers', 'customer_types', 'partners', 'products', 'product_categories', 'combos', 'import_logs', 'import_details', 'cash_book', 'accounting']}
              className="hidden sm:inline-flex"
            />
            <button
              type="button"
              onClick={() => setShowScreenGuide(true)}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
            >
              <HelpCircle size={16} /> Hướng dẫn
            </button>
          </div>
          <Routes>
            <Route path={HOME_ROUTE} element={<Home user={user} store={store} />} />
            <Route path="/tao-don-hang" element={<ProtectedRoute user={user} permissions={permissions} path="/tao-don-hang"><CreateOrder user={user} store={store} /></ProtectedRoute>} />
            <Route path="/danh-sach-don-hang" element={<ProtectedRoute user={user} permissions={permissions} path="/danh-sach-don-hang"><OrderList store={store} /></ProtectedRoute>} />
            <Route path="/hoa-don-in/:idOrCode" element={<ProtectedRoute user={user} permissions={permissions} path="/hoa-don-in"><InvoicePrint /></ProtectedRoute>} />
            <Route path="/kho-hang" element={<ProtectedRoute user={user} permissions={permissions} path="/kho-hang"><KhoHang /></ProtectedRoute>} />
            <Route path="/nha-cung-cap" element={<ProtectedRoute user={user} permissions={permissions} path="/nha-cung-cap"><NhaCungCap /></ProtectedRoute>} />
            <Route path="/nhap-hang" element={<ProtectedRoute user={user} permissions={permissions} path="/nhap-hang"><Nhaphang store={store} /></ProtectedRoute>} />
            <Route path="/san-pham" element={<ProtectedRoute user={user} permissions={permissions} path="/san-pham"><Products store={store} /></ProtectedRoute>} />
            <Route path="/khach-hang" element={<ProtectedRoute user={user} permissions={permissions} path="/khach-hang"><Customers /></ProtectedRoute>} />
            <Route path="/thong-ke" element={<ProtectedRoute user={user} permissions={permissions} path="/thong-ke"><Stats /></ProtectedRoute>} />
            <Route path="/so-quy" element={<ProtectedRoute user={user} permissions={permissions} path="/so-quy"><CashBook /></ProtectedRoute>} />
            <Route path="/ke-toan" element={<ProtectedRoute user={user} permissions={permissions} path="/ke-toan"><AccountingDashboard user={user} /></ProtectedRoute>} />
            <Route path="/ke-toan/bao-cao-thue" element={<ProtectedRoute user={user} permissions={permissions} path="/ke-toan/bao-cao-thue"><TaxReport /></ProtectedRoute>} />
            <Route path="/ke-toan/bao-cao-ton-kho" element={<ProtectedRoute user={user} permissions={permissions} path="/ke-toan/bao-cao-ton-kho"><InventoryReport /></ProtectedRoute>} />
            <Route path="/ke-toan/nhat-ky" element={<ProtectedRoute user={user} permissions={permissions} path="/ke-toan/nhat-ky"><AccountingLogs /></ProtectedRoute>} />
            <Route path="/bang-luong-nhan-vien" element={<ProtectedRoute user={user} permissions={permissions} path="/bang-luong-nhan-vien"><Payroll /></ProtectedRoute>} />
            <Route path="/bao-cao-theo-don-hang" element={<ProtectedRoute user={user} permissions={permissions} path="/bao-cao-theo-don-hang"><CustomerOrderReport /></ProtectedRoute>} />
            <Route path="/bao-cao-theo-san-pham" element={<ProtectedRoute user={user} permissions={permissions} path="/bao-cao-theo-san-pham"><ProductReport /></ProtectedRoute>} />

            <Route path="/cai-dat" element={<ProtectedRoute user={user} permissions={permissions} path="/cai-dat"><Settings store={store} onStoreChange={onStoreChange} permissions={permissions} user={user} /></ProtectedRoute>} />
            <Route path={LOGIN_REGISTER_ROUTE} element={<Navigate to={firstAccessibleRoute(user, permissions)} replace />} />
            {Object.entries(ROUTE_ALIASES).map(([from, to]) => (
              <Route key={from} path={from} element={<Navigate to={canAccess(to) ? to : firstAccessibleRoute(user, permissions)} replace />} />
            ))}
            <Route path="*" element={<Navigate to={canAccessAny(Object.keys(ROUTE_PERMISSIONS)) ? firstAccessibleRoute(user, permissions) : HOME_ROUTE} replace />} />
          </Routes>
        </div>
      </div>
      <MobileActionSheet
        activePanel={mobilePanel}
        moreGroups={mobileMoreGroups}
        user={user}
        currentPath={location.pathname}
        onClose={() => setMobilePanel(null)}
        onLogout={onLogout}
      />
      <MobileBottomNavigation
        items={mobileNavItems}
        currentPath={location.pathname}
        activePanel={mobilePanel}
        onTogglePanel={toggleMobilePanel}
      />
      {showScreenGuide && (
        <HelpModal
          show={showScreenGuide}
          title={screenGuide.title}
          onClose={() => setShowScreenGuide(false)}
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="mb-2 font-bold text-gray-800">Các bước chính</h3>
                <ol className="list-decimal space-y-1 pl-5">
                  {screenGuide.steps.map(step => <li key={step}>{step}</li>)}
                </ol>
              </div>
            </div>
          }
        />
      )}
      {upgradeToast && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 max-w-md w-full animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Thông báo cập nhật</h3>
            <div className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap mb-5">{upgradeToast}</div>
            <button
              type="button"
              onClick={() => setUpgradeToast(null)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded-xl transition-colors"
            >
              Đồng ý
            </button>
          </div>
        </div>
      )}
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
    const localOnly = Boolean(payload.localOnly || payload.offline || payload.session?.localOnly || payload.bootstrap?.localOnly);
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

    if (sync && !localOnly) {
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
    return { ...sessionState, defaultRoute, redirectRoute, identityChanged, localOnly };
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

      if (isLocalMobileAuthToken(token)) {
        const offlinePayload = getMobileOfflineSessionPayload();
        if (offlinePayload) {
          await applyServerPayload(offlinePayload, { persistMode: 'snapshot', redirect: true, sync: false });
          setBootstrapStatus({ ok: true, needsSetup: false, localOnly: true });
          if (mounted) setInitializing(false);
          return;
        }
      }

      try {
        let payload = await authApi.profile();

        if (!mounted) return;
        // Profile d? tr? v? đầy đủ user + permissions + syncVersions
        await applyServerPayload(payload, { persistMode: 'snapshot', redirect: true, sync: true });
        setBootstrapStatus(null);
      } catch (err) {
        const offlinePayload = getMobileOfflineSessionPayload();
        if (offlinePayload) {
          await applyServerPayload(offlinePayload, { persistMode: 'snapshot', redirect: true, sync: false });
          setBootstrapStatus({ ok: true, needsSetup: false, localOnly: true });
          return;
        }
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
    if (authState.session?.localOnly || authState.bootstrap?.localOnly) return undefined;

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
        // Nếu token d? hết hạn, apiClient d? cleanup v? ph?t s? ki?n 401.
      }
    }
    clearAuthSession({ clearVolatile: true, includePending: true });
    resetAuthState();
    await loadBootstrapStatus();
  }, [loadBootstrapStatus, resetAuthState]);

  if (initializing) {
    return <FullScreenLoading message="Đang tải lại trang ..." />;
  }

  return (
    <>
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
    </>
  );
}

export default function App() {
  return <DesktopApp />;
}

