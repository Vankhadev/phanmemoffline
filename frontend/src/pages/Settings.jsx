import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle,
  Edit2,
  HelpCircle,
  Loader2,
  Package,
  Plus,
  Settings2,
  Store,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import HelpModal from '../components/HelpModal';
import { apiJson, customerTypesApi, featuresApi, getApiErrorMessage, usersApi } from '../utils/apiClient';

const INITIAL_STORE_FORM = Object.freeze({
  name: '',
  email: '',
  phone: '',
  tax_code: '',
  bank_account: '',
  bank_name: '',
  address: '',
  invoice_width: '80',
  invoice_logo: '',
  invoice_note: '',
  invoice_slogan: '',
  invoice_vietqr_logo: '',
});

const INITIAL_EMP_FORM = Object.freeze({
  name: '',
  email: '',
  phone: '',
  password: '',
});

const INITIAL_TYPE_FORM = Object.freeze({
  name: '',
  color: '#3b82f6',
});

const NEGATIVE_STOCK_FEATURE_KEY = 'negative_stock_exports';
const NEGATIVE_STOCK_LIMIT = -10;
const NEGATIVE_STOCK_FEATURE_NAME = 'Xuất âm tồn kho';
const NEGATIVE_STOCK_FEATURE_DESCRIPTION = 'Bật để cho phép xuất vượt tồn kho đến giới hạn cố định trong code.';
const NEGATIVE_STOCK_FEATURE_CATEGORY = 'Kho hàng';
const RELEASE_VERSION = '1.3.7';
const RELEASE_DOWNLOAD_BASE_URL = 'https://github.com/Vankhadev/phanmemoffline/releases/latest/download/';
const WINDOWS_INSTALLERS = Object.freeze([
  {
    arch: 'x64',
    label: 'Windows 64-bit (x64)',
    fileName: `banhangoffline-setup-v${RELEASE_VERSION}-x64.exe`,
    recommendedFor: 'Hầu hết máy tính Windows 10/11 hiện nay.',
  },
  {
    arch: 'ia32',
    label: 'Windows 32-bit (ia32)',
    fileName: `banhangoffline-setup-v${RELEASE_VERSION}-ia32.exe`,
    recommendedFor: 'Máy Windows 32-bit hoặc máy báo không chạy được bản x64.',
  },
]);

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (!bytes) return 'Không rõ dung lượng';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildReleaseDownloadUrl(fileName) {
  return `${RELEASE_DOWNLOAD_BASE_URL}${encodeURIComponent(fileName)}`;
}

function normalizeRuntimeArch(value) {
  const arch = String(value || '').trim().toLowerCase();
  if (arch === 'x86' || arch === 'win32') return 'ia32';
  if (arch === 'amd64') return 'x64';
  return arch;
}

function getRecommendedInstaller(runtimeArch) {
  const arch = normalizeRuntimeArch(runtimeArch);
  if (arch === 'ia32') return WINDOWS_INSTALLERS.find(item => item.arch === 'ia32');
  return WINDOWS_INSTALLERS.find(item => item.arch === 'x64') || WINDOWS_INSTALLERS[0];
}

function getUpdateStatusLabel(status) {
  const labels = {
    idle: 'Sẵn sàng',
    checking: 'Đang kiểm tra...',
    'no-update': 'Không có bản mới',
    'update-available': 'Có bản cập nhật',
    downloading: 'Đang tải cập nhật...',
    downloaded: 'Đã tải xong',
    installing: 'Đang cập nhật...',
    cancelled: 'Đã hủy tải',
    error: 'Có lỗi',
  };
  return labels[status] || 'Chưa kiểm tra';
}

function getUpdateErrorMessage(error) {
  if (!error) return '';
  const messages = {
    MANIFEST_URL_MISSING: 'Chưa xác định được URL cập nhật. Mặc định ứng dụng dùng GitHub Releases latest.yml.',
    CONFIG_INVALID: 'File cấu hình cập nhật không hợp lệ.',
    URL_INVALID: 'URL cập nhật hoặc installer không hợp lệ.',
    DEV_UPDATER_DISABLED: 'Auto-update bị tắt khi chạy development/unpacked. Hãy test trên bản đã cài bằng NSIS hoặc bật KHA_ENABLE_ELECTRON_UPDATER=1 có chủ đích.',
    WINDOW_NOT_READY: 'Chỉ kiểm tra cập nhật sau khi cửa sổ chính đã sẵn sàng.',
    ELECTRON_UPDATER_ERROR: 'electron-updater báo lỗi trong quá trình kiểm tra/tải cập nhật.',
    CHECK_FAILED: 'Kiểm tra cập nhật thất bại.',
    UPDATE_GITHUB_ATOM_FEED_NOT_AVAILABLE: 'Endpoint GitHub releases.atom không phù hợp hoặc không khả dụng. Bản mới sẽ đọc trực tiếp latest.yml public thay vì phụ thuộc Atom feed.',
    UPDATE_REPOSITORY_NOT_ACCESSIBLE: 'Không truy cập được GitHub Releases/latest. Repo có thể private, owner/repo sai, URL feed sai hoặc chưa có release latest public.',
    UPDATE_FEED_UNAUTHORIZED_OR_PRIVATE: 'GitHub Release/feed yêu cầu xác thực, token sai/thiếu quyền hoặc repo đang private. Client Electron không được nhúng token nên không thể tự cập nhật từ asset private.',
    UPDATE_FEED_METADATA_NOT_FOUND: 'Không tìm thấy latest.yml trong GitHub Release latest hoặc release latest không public.',
    UPDATE_METADATA_INVALID: 'Metadata cập nhật trên GitHub Release không hợp lệ hoặc rỗng.',
    UPDATE_RUNTIME_ARCH_UNSUPPORTED: 'Máy Windows hiện tại chưa có bộ cài phù hợp. Hãy tải đúng bản x64 hoặc ia32 từ GitHub Release.',
    UPDATE_METADATA_MISSING_RUNTIME_INSTALLER: 'GitHub Release chưa có installer riêng cho kiến trúc máy này. Cần upload asset có hậu tố -x64.exe hoặc -ia32.exe và cập nhật latest.yml.',
    UPDATE_METADATA_SELECTED_INSTALLER_MISMATCH: 'Metadata cập nhật đang chọn installer không khớp kiến trúc máy. Không tải để tránh lỗi Windows không chạy được ứng dụng.',
    UPDATE_ASSET_NOT_ACCESSIBLE_OR_PRIVATE: 'Không tải được installer/blockmap. Asset có thể thiếu, tên không khớp latest.yml hoặc repo private trả 404.',
    UPDATE_RELEASE_NOT_PUBLISHED: 'Chưa có production release đã publish để electron-updater chọn làm latest.',
    UPDATE_FEED_RATE_LIMITED: 'GitHub đang giới hạn truy cập feed cập nhật, vui lòng thử lại sau.',
    UPDATE_NETWORK_ERROR: 'Không kết nối được tới GitHub Releases. Vui lòng kiểm tra Internet, DNS, proxy/firewall.',
    NETWORK_ERROR: 'Không thể kết nối tới máy chủ cập nhật. Vui lòng kiểm tra mạng.',
    NETWORK_TIMEOUT: 'Kết nối tới máy chủ cập nhật quá thời gian chờ.',
    MANIFEST_HTTP_ERROR: 'Máy chủ không trả metadata cập nhật hợp lệ.',
    MANIFEST_INVALID_JSON: 'Metadata cập nhật không phải JSON/YAML hợp lệ.',
    MANIFEST_INVALID: 'Metadata cập nhật thiếu hoặc sai cấu trúc.',
    MANIFEST_INVALID_VERSION: 'Metadata thiếu version SemVer hợp lệ.',
    MANIFEST_INVALID_URL: 'Metadata thiếu URL gói cập nhật hợp lệ.',
    MANIFEST_INVALID_SHA256: 'Metadata thiếu checksum hợp lệ.',
    MANIFEST_INVALID_RELEASE_DATE: 'Metadata thiếu releaseDate.',
    UPDATE_NOT_AVAILABLE: 'Không có bản cập nhật mới để tải.',
    DOWNLOAD_IN_PROGRESS: 'Một lượt tải cập nhật đang chạy.',
    DOWNLOAD_HTTP_ERROR: 'Không tải được gói cập nhật từ máy chủ.',
    DOWNLOAD_FAILED: 'Tải gói cập nhật thất bại.',
    DOWNLOAD_CANCELLED: 'Người dùng đã hủy tải cập nhật.',
    CHECKSUM_MISMATCH: 'Checksum không khớp. Gói cập nhật đã bị xóa và sẽ không được chạy.',
    INSTALLER_NOT_DOWNLOADED: 'Chưa tải gói cập nhật.',
    UPDATE_NOT_DOWNLOADED: 'Chưa có bản cập nhật đã tải xong để cài đặt.',
    INSTALLER_NOT_FOUND: 'Không tìm thấy installer đã tải. Vui lòng tải lại.',
    INSTALL_IN_PROGRESS: 'Ứng dụng đang chuẩn bị cài đặt bản cập nhật.',
    SPAWN_INSTALLER_FAILED: 'Không thể chạy installer cập nhật.',
  };
  return messages[error.code] || error.message || 'Đã xảy ra lỗi cập nhật.';
}

function getManifestSourceLabel(updateState) {
  if (!updateState) return 'Chưa nạp cấu hình cập nhật';
  if (updateState.updateEngine === 'electron-updater') {
    if (updateState.feedProvider === 'generic') {
      return updateState.feedSource === 'package.build.publish.generic'
        ? 'GitHub Release latest.yml trực tiếp (package.json build.publish generic)'
        : 'GitHub Release latest.yml trực tiếp';
    }
    return updateState.feedSource === 'package.build.publish'
      ? 'GitHub Releases/electron-updater (package.json build.publish)'
      : 'GitHub Releases/electron-updater';
  }
  if (updateState.manifestUrlDefault) return 'GitHub Release mặc định';
  if (updateState.manifestUrlConfigured) return `Override nội bộ: ${updateState.manifestSource || 'env/config file'}`;
  return updateState.manifestSource || 'GitHub Release mặc định';
}

function formatUpdateErrorDetails(details) {
  if (!details) return '';
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch (_) {
    return String(details);
  }
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function normalizeHexColor(value, fallback = '#3b82f6') {
  const normalized = String(value || '').trim();
  return /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(normalized) ? normalized : fallback;
}

function normalizeStorePayload(payload = {}) {
  return {
    ...INITIAL_STORE_FORM,
    name: String(payload?.name || ''),
    email: String(payload?.email || ''),
    phone: String(payload?.phone || ''),
    tax_code: String(payload?.tax_code || ''),
    bank_account: String(payload?.bank_account || ''),
    bank_name: String(payload?.bank_name || ''),
    address: String(payload?.address || ''),
    invoice_width: String(payload?.invoice_width || '80'),
    invoice_logo: String(payload?.invoice_logo || ''),
    invoice_note: String(payload?.invoice_note || ''),
    invoice_slogan: String(payload?.invoice_slogan || ''),
    invoice_vietqr_logo: String(payload?.invoice_vietqr_logo || ''),
  };
}

function normalizeEmployeeForm(payload = {}) {
  return {
    ...INITIAL_EMP_FORM,
    name: String(payload?.name || ''),
    email: String(payload?.email || ''),
    phone: String(payload?.phone || ''),
    password: '',
  };
}

function normalizeTypeForm(payload = {}) {
  return {
    ...INITIAL_TYPE_FORM,
    name: String(payload?.name || ''),
    color: normalizeHexColor(payload?.color),
  };
}

function sanitizeStorePayload(form = {}) {
  const normalized = normalizeStorePayload(form);
  return {
    ...normalized,
    name: normalized.name.trim(),
    email: normalized.email.trim(),
    phone: normalized.phone.trim(),
    tax_code: normalized.tax_code.trim(),
    bank_account: normalized.bank_account.trim(),
    bank_name: normalized.bank_name.trim(),
    address: normalized.address.trim(),
    invoice_width: String(normalized.invoice_width || '80').trim() || '80',
    invoice_logo: normalized.invoice_logo.trim(),
    invoice_note: normalized.invoice_note.trim(),
    invoice_slogan: normalized.invoice_slogan.trim(),
    invoice_vietqr_logo: normalized.invoice_vietqr_logo.trim(),
  };
}

function sanitizeEmployeePayload(form = {}) {
  const normalized = normalizeEmployeeForm(form);
  const payload = {
    name: normalized.name.trim(),
    email: normalized.email.trim().toLowerCase(),
    phone: normalized.phone.trim(),
  };
  if (normalized.password) payload.password = normalized.password;
  return payload;
}

function sanitizeTypePayload(form = {}) {
  const normalized = normalizeTypeForm(form);
  return {
    name: normalized.name.trim(),
    color: normalizeHexColor(normalized.color),
  };
}

function normalizeNegativeStockFeature(feature = null) {
  const featureKey = String(feature?.feature_key || feature?.key || NEGATIVE_STOCK_FEATURE_KEY).trim() || NEGATIVE_STOCK_FEATURE_KEY;
  return {
    id: feature?.id || null,
    feature_key: featureKey,
    key: featureKey,
    name: String(feature?.name || NEGATIVE_STOCK_FEATURE_NAME),
    description: String(feature?.description || NEGATIVE_STOCK_FEATURE_DESCRIPTION),
    category: String(feature?.category || NEGATIVE_STOCK_FEATURE_CATEGORY),
    active: feature?.active === true || feature?.active === 1 || feature?.active === '1',
    exists: Boolean(feature?.id),
  };
}

function SectionNotice({ notice }) {
  if (!notice?.message) return null;

  const toneClass = notice.tone === 'success'
    ? 'border-green-200 bg-green-50 text-green-700'
    : notice.tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-blue-200 bg-blue-50 text-blue-700';

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${toneClass}`}>
      {notice.message}
    </div>
  );
}

function InputField({ id, label, className = '', ...props }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <input id={id} className="input-field w-full mt-1" {...props} />
    </div>
  );
}

function TextareaField({ id, label, className = '', rows = 3, ...props }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <textarea id={id} rows={rows} className="input-field w-full mt-1 resize-y" {...props} />
    </div>
  );
}

function hasAnyPermission(permissionSet, required = []) {
  if (!required.length) return true;
  return required.some(permission => permissionSet.has(permission));
}

export default function Settings({ store, onStoreChange, permissions = [] }) {
  const mountedRef = useRef(true);
  const noticeTimersRef = useRef({});
  const hasExplicitPermissions = Array.isArray(permissions) && permissions.length > 0;
  const permissionSet = useMemo(
    () => new Set(
      hasExplicitPermissions
        ? permissions.map(permission => String(permission || '').trim()).filter(Boolean)
        : []
    ),
    [hasExplicitPermissions, permissions],
  );
  const canAccessSection = useCallback(
    (required = []) => !hasExplicitPermissions || hasAnyPermission(permissionSet, required),
    [hasExplicitPermissions, permissionSet],
  );
  const canViewStore = canAccessSection(['store.read', 'store.manage']);
  const canManageStore = canAccessSection(['store.manage']);
  const canViewEmployees = canAccessSection(['users.read', 'users.manage']);
  const canManageEmployees = canAccessSection(['users.manage']);
  const canViewCustomerTypes = canAccessSection(['customers.read', 'customers.manage']);
  const canManageCustomerTypes = canAccessSection(['customers.manage']);
  const canViewNegativeStock = canAccessSection(['features.read', 'features.manage']);
  const canManageNegativeStock = canAccessSection(['features.manage']);
  const canViewUpdates = canAccessSection(['updates.read', 'updates.manage', 'settings.read', 'settings.manage']);

  const [tab, setTab] = useState('store');
  const [showHelp, setShowHelp] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [pageNotice, setPageNotice] = useState(null);

  const [storeForm, setStoreForm] = useState(() => normalizeStorePayload(store));
  const [storeDirty, setStoreDirty] = useState(false);
  const [storeSaving, setStoreSaving] = useState(false);
  const [storeNotice, setStoreNotice] = useState(null);

  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [employeesNotice, setEmployeesNotice] = useState(null);
  const [showEmpModal, setShowEmpModal] = useState(false);
  const [empEdit, setEmpEdit] = useState(null);
  const [empForm, setEmpForm] = useState(() => normalizeEmployeeForm());
  const [empSaving, setEmpSaving] = useState(false);
  const [empNotice, setEmpNotice] = useState(null);

  const [customerTypes, setCustomerTypes] = useState([]);
  const [customerTypesLoading, setCustomerTypesLoading] = useState(false);
  const [customerTypesNotice, setCustomerTypesNotice] = useState(null);
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [typeEdit, setTypeEdit] = useState(null);
  const [typeForm, setTypeForm] = useState(() => normalizeTypeForm());
  const [typeSaving, setTypeSaving] = useState(false);
  const [typeNotice, setTypeNotice] = useState(null);

  const [negativeStockFeature, setNegativeStockFeature] = useState(() => normalizeNegativeStockFeature());
  const [negativeStockSaving, setNegativeStockSaving] = useState(false);
  const [negativeStockNotice, setNegativeStockNotice] = useState(null);

  const [appInfo, setAppInfo] = useState(null);
  const [updateState, setUpdateState] = useState(null);
  const [updateBusy, setUpdateBusy] = useState('');
  const [updateResult, setUpdateResult] = useState(null);
  const [updateNotice, setUpdateNotice] = useState('');

  const getErrorMessage = useCallback(
    (error, fallback = 'Thao tác thất bại.') => getApiErrorMessage(error?.data || error, error?.message || fallback),
    [],
  );

  const setTimedNotice = useCallback((key, setter, notice, timeoutMs = 0) => {
    if (noticeTimersRef.current[key]) {
      window.clearTimeout(noticeTimersRef.current[key]);
      delete noticeTimersRef.current[key];
    }

    setter(notice);

    if (timeoutMs > 0) {
      noticeTimersRef.current[key] = window.setTimeout(() => {
        delete noticeTimersRef.current[key];
        if (mountedRef.current) setter(null);
      }, timeoutMs);
    }
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      Object.values(noticeTimersRef.current).forEach(timerId => window.clearTimeout(timerId));
      noticeTimersRef.current = {};
    };
  }, []);

  const loadStore = useCallback(async () => {
    const data = await apiJson('/store', {}, 'Không thể tải thông tin cửa hàng.');
    const nextStore = normalizeStorePayload(data);
    if (!mountedRef.current) return nextStore;
    setStoreForm(nextStore);
    setStoreDirty(false);
    onStoreChange?.(nextStore);
    return nextStore;
  }, [onStoreChange]);

  const loadEmployees = useCallback(async () => {
    if (mountedRef.current) setEmployeesLoading(true);
    try {
      const data = await usersApi.list();
      if (mountedRef.current) setEmployees(Array.isArray(data) ? data : []);
      return data;
    } finally {
      if (mountedRef.current) setEmployeesLoading(false);
    }
  }, []);

  const loadCustomerTypes = useCallback(async () => {
    if (mountedRef.current) setCustomerTypesLoading(true);
    try {
      const data = await customerTypesApi.list();
      if (mountedRef.current) setCustomerTypes(Array.isArray(data) ? data : []);
      return data;
    } finally {
      if (mountedRef.current) setCustomerTypesLoading(false);
    }
  }, []);

  const loadNegativeStockFeature = useCallback(async () => {
    try {
      const data = await featuresApi.detail(NEGATIVE_STOCK_FEATURE_KEY);
      const feature = normalizeNegativeStockFeature(data?.item || data?.data || data);
      if (mountedRef.current) setNegativeStockFeature(feature);
      return feature;
    } catch (error) {
      if (error?.status === 404) {
        const fallbackFeature = normalizeNegativeStockFeature();
        if (mountedRef.current) setNegativeStockFeature(fallbackFeature);
        return fallbackFeature;
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    if (storeDirty) return;
    setStoreForm(current => ({ ...current, ...normalizeStorePayload(store) }));
  }, [store, storeDirty]);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      if (mountedRef.current) setInitialLoading(true);
      const sections = [
        ...(canViewStore ? [{ label: 'cửa hàng', promise: loadStore() }] : []),
        ...(canViewEmployees ? [{ label: 'nhân viên', promise: loadEmployees() }] : []),
        ...(canViewCustomerTypes ? [{ label: 'loại khách hàng', promise: loadCustomerTypes() }] : []),
        ...(canViewNegativeStock ? [{ label: 'xuất âm tồn kho', promise: loadNegativeStockFeature() }] : []),
      ];

      if (sections.length === 0) {
        setInitialLoading(false);
        return;
      }

      const results = await Promise.allSettled(sections.map(section => section.promise));
      if (cancelled || !mountedRef.current) return;

      const failures = results
        .map((result, index) => {
          if (result.status !== 'rejected') return '';
          return `${sections[index].label}: ${getErrorMessage(result.reason, `Không thể tải ${sections[index].label}.`)}`;
        })
        .filter(Boolean);

      if (failures.length > 0) {
        setTimedNotice('page', setPageNotice, {
          tone: 'error',
          message: `Một số dữ liệu cài đặt chưa tải được. ${failures.join(' | ')}`,
        }, 8000);
      }

      setInitialLoading(false);
    };

    initialize();

    return () => {
      cancelled = true;
    };
  }, [canViewCustomerTypes, canViewEmployees, canViewNegativeStock, canViewStore, getErrorMessage, loadCustomerTypes, loadEmployees, loadNegativeStockFeature, loadStore, setTimedNotice]);

  useEffect(() => {
    if (!window.khaDesktop?.isElectron) return undefined;

    let active = true;
    const desktop = window.khaDesktop;

    desktop.getAppInfo?.()
      ?.then(result => {
        if (!active || !result?.ok) return;
        setAppInfo(result.app || null);
        if (result.state) setUpdateState(result.state);
      })
      .catch(() => {});

    desktop.updates?.getState?.()
      ?.then(result => {
        if (!active || !result?.ok) return;
        setUpdateState(result.state || null);
      })
      .catch(() => {});

    const unsubscribe = desktop.updates?.onStatus?.(payload => {
      if (!active) return;
      setUpdateState(payload?.state || null);
      if (payload?.type === 'update-available') {
        const version = payload.updateInfo?.version || payload.state?.updateInfo?.version;
        setUpdateNotice(version ? `Có bản cập nhật ${version}.` : 'Có bản cập nhật mới.');
      }
      if (payload?.type === 'downloaded') setUpdateNotice('Đã tải và xác thực gói cập nhật. Chọn Cập nhật ngay hoặc Để sau.');
      if (payload?.type === 'install-deferred') setUpdateNotice('Đã chọn để sau. Ứng dụng tiếp tục chạy bình thường.');
      if (payload?.type === 'cancelled') setUpdateNotice('Đã hủy tải cập nhật.');
      if (payload?.type === 'error') setUpdateNotice(getUpdateErrorMessage(payload.error || payload.state?.lastError));
    });

    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const closeEmpModal = useCallback(() => {
    setShowEmpModal(false);
    setEmpEdit(null);
    setEmpForm(normalizeEmployeeForm());
    setEmpNotice(null);
  }, []);

  const closeTypeModal = useCallback(() => {
    setShowTypeModal(false);
    setTypeEdit(null);
    setTypeForm(normalizeTypeForm());
    setTypeNotice(null);
  }, []);

  const updateStoreField = useCallback((field, value) => {
    setStoreDirty(true);
    setStoreForm(current => ({ ...current, [field]: value }));
  }, []);

  const handleSaveStore = async () => {
    const payload = sanitizeStorePayload(storeForm);
    if (payload.email && !isValidEmail(payload.email)) {
      setTimedNotice('store', setStoreNotice, {
        tone: 'error',
        message: 'Email cửa hàng không hợp lệ.',
      }, 5000);
      return;
    }

    setStoreSaving(true);
    setStoreNotice(null);
    try {
      const data = await apiJson('/store', {
        method: 'PUT',
        body: payload,
      }, 'Không thể lưu thông tin cửa hàng.');

      if (data?.ok) {
        setStoreForm(payload);
        setStoreDirty(false);
        onStoreChange?.(payload);
        setTimedNotice('store', setStoreNotice, {
          tone: 'success',
          message: 'Đã lưu thông tin cửa hàng.',
        }, 3000);
      }
    } catch (error) {
      setTimedNotice('store', setStoreNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Không thể lưu thông tin cửa hàng.'),
      });
    } finally {
      if (mountedRef.current) setStoreSaving(false);
    }
  };

  const openAddEmp = () => {
    setEmpEdit(null);
    setEmpForm(normalizeEmployeeForm());
    setEmpNotice(null);
    setShowEmpModal(true);
  };

  const openEditEmp = (employee) => {
    setEmpEdit(employee);
    setEmpForm(normalizeEmployeeForm(employee));
    setEmpNotice(null);
    setShowEmpModal(true);
  };

  const handleDeleteEmp = async (id) => {
    if (!window.confirm('Xóa nhân viên này?')) return;

    setEmployeesNotice(null);
    try {
      const data = await apiJson(`/users/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }, 'Không thể xóa nhân viên.');
      await loadEmployees();
      setTimedNotice('employees', setEmployeesNotice, {
        tone: 'success',
        message: data?.message || 'Đã xóa nhân viên.',
      }, 3000);
    } catch (error) {
      setTimedNotice('employees', setEmployeesNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Không thể xóa nhân viên.'),
      });
    }
  };

  const handleSaveEmp = async () => {
    const payload = sanitizeEmployeePayload(empForm);
    const isCreating = !empEdit;

    if (!payload.name || !payload.email || !payload.phone) {
      setEmpNotice({ tone: 'error', message: 'Vui lòng điền đầy đủ họ tên, email và số điện thoại.' });
      return;
    }
    if (!isValidEmail(payload.email)) {
      setEmpNotice({ tone: 'error', message: 'Email nhân viên không hợp lệ.' });
      return;
    }
    if (isCreating && !payload.password) {
      setEmpNotice({ tone: 'error', message: 'Vui lòng nhập mật khẩu cho nhân viên mới.' });
      return;
    }
    if (payload.password && String(payload.password).length < 6) {
      setEmpNotice({ tone: 'error', message: 'Mật khẩu phải có ít nhất 6 ký tự.' });
      return;
    }

    setEmpSaving(true);
    setEmpNotice(null);
    try {
      if (empEdit) {
        await usersApi.update(empEdit.id, payload);
      } else {
        await apiJson('/users/register', {
          method: 'POST',
          body: payload,
        }, 'Không thể tạo nhân viên mới.');
      }

      await loadEmployees();
      closeEmpModal();
      setTimedNotice('employees', setEmployeesNotice, {
        tone: 'success',
        message: empEdit ? 'Đã cập nhật nhân viên.' : 'Đã thêm nhân viên mới.',
      }, 3000);
    } catch (error) {
      setEmpNotice({
        tone: 'error',
        message: getErrorMessage(error, empEdit ? 'Không thể cập nhật nhân viên.' : 'Không thể tạo nhân viên mới.'),
      });
    } finally {
      if (mountedRef.current) setEmpSaving(false);
    }
  };

  const openAddType = () => {
    setTypeEdit(null);
    setTypeForm(normalizeTypeForm());
    setTypeNotice(null);
    setShowTypeModal(true);
  };

  const openEditType = (type) => {
    setTypeEdit(type);
    setTypeForm(normalizeTypeForm(type));
    setTypeNotice(null);
    setShowTypeModal(true);
  };

  const handleSaveType = async () => {
    const payload = sanitizeTypePayload(typeForm);
    if (!payload.name) {
      setTypeNotice({ tone: 'error', message: 'Vui lòng nhập tên loại khách hàng.' });
      return;
    }

    setTypeSaving(true);
    setTypeNotice(null);
    try {
      if (typeEdit) await customerTypesApi.update(typeEdit.id, payload);
      else await customerTypesApi.create(payload);

      await loadCustomerTypes();
      closeTypeModal();
      setTimedNotice('customer-types', setCustomerTypesNotice, {
        tone: 'success',
        message: typeEdit ? 'Đã cập nhật loại khách hàng.' : 'Đã thêm loại khách hàng mới.',
      }, 3000);
    } catch (error) {
      setTypeNotice({
        tone: 'error',
        message: getErrorMessage(error, typeEdit ? 'Không thể cập nhật loại khách hàng.' : 'Không thể tạo loại khách hàng.'),
      });
    } finally {
      if (mountedRef.current) setTypeSaving(false);
    }
  };

  const handleDeleteType = async (id) => {
    if (!window.confirm('Xóa loại khách này?')) return;

    setCustomerTypesNotice(null);
    try {
      await customerTypesApi.remove(id);
      await loadCustomerTypes();
      setTimedNotice('customer-types', setCustomerTypesNotice, {
        tone: 'success',
        message: 'Đã xóa loại khách hàng.',
      }, 3000);
    } catch (error) {
      setTimedNotice('customer-types', setCustomerTypesNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Không thể xóa loại khách hàng.'),
      });
    }
  };

  const handleToggleNegativeStock = async () => {
    const nextEnabled = !negativeStockFeature.active;
    const payload = {
      feature_key: NEGATIVE_STOCK_FEATURE_KEY,
      name: NEGATIVE_STOCK_FEATURE_NAME,
      description: NEGATIVE_STOCK_FEATURE_DESCRIPTION,
      category: NEGATIVE_STOCK_FEATURE_CATEGORY,
      active: nextEnabled,
      metadata: {},
    };

    setNegativeStockSaving(true);
    setNegativeStockNotice(null);
    try {
      let data;
      if (negativeStockFeature.id) {
        data = await featuresApi.update(negativeStockFeature.id, payload);
      } else {
        try {
          data = await featuresApi.create(payload);
        } catch (error) {
          if (error?.status !== 409) throw error;
          data = await featuresApi.update(NEGATIVE_STOCK_FEATURE_KEY, payload);
        }
      }

      const savedFeature = normalizeNegativeStockFeature(data?.item || data?.data || data);
      setNegativeStockFeature(savedFeature);
      setTimedNotice('negative-stock', setNegativeStockNotice, {
        tone: 'success',
        message: nextEnabled ? 'Đã bật cho phép xuất âm tồn kho.' : 'Đã tắt cho phép xuất âm tồn kho.',
      }, 3000);
    } catch (error) {
      setTimedNotice('negative-stock', setNegativeStockNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Không thể lưu cấu hình xuất âm tồn kho.'),
      });
    } finally {
      if (mountedRef.current) setNegativeStockSaving(false);
    }
  };

  const runUpdateAction = async (busyKey, action) => {
    if (!window.khaDesktop?.updates) {
      setUpdateNotice('Tính năng cập nhật chỉ khả dụng trong ứng dụng Electron Windows.');
      return null;
    }

    setUpdateBusy(busyKey);
    setUpdateResult(null);
    try {
      const result = await action(window.khaDesktop.updates);
      setUpdateResult(result);
      if (result?.state) setUpdateState(result.state);

      if (!result?.ok) {
        setUpdateNotice(getUpdateErrorMessage(result?.error));
      } else if (busyKey === 'checking') {
        setUpdateNotice(result.updateAvailable ? `Có bản cập nhật ${result.updateInfo?.version}.` : 'Ứng dụng đang ở phiên bản mới nhất.');
      } else if (busyKey === 'downloading') {
        setUpdateNotice('Đã tải và xác thực gói cập nhật. Chọn Cập nhật ngay hoặc Để sau.');
      } else if (busyKey === 'installing') {
        setUpdateNotice('Đang cài đặt cập nhật. Ứng dụng sẽ restart theo electron-updater.');
      }
      return result;
    } catch (error) {
      const nextError = {
        code: error?.code || 'UNKNOWN_ERROR',
        message: error?.message || 'Đã xảy ra lỗi cập nhật.',
      };
      setUpdateResult({ ok: false, error: nextError });
      setUpdateNotice(getUpdateErrorMessage(nextError));
      return null;
    } finally {
      if (mountedRef.current) setUpdateBusy('');
    }
  };

  const handleCheckUpdate = () => runUpdateAction('checking', updates => updates.check({ manual: true }));
  const handleDownloadUpdate = () => runUpdateAction('downloading', updates => updates.download());
  const handleCancelUpdate = () => runUpdateAction('cancelling', updates => updates.cancel());
  const handleInstallUpdate = () => {
    if (!window.confirm('Ứng dụng sẽ tạo backup database rồi cài đặt và khởi động lại. Tiếp tục?')) return null;
    return runUpdateAction('installing', updates => updates.install());
  };

  const handleOpenInstallerDownload = async (installer) => {
    const url = buildReleaseDownloadUrl(installer.fileName);
    setUpdateNotice(`Đang kiểm tra link tải ${installer.label} trước khi mở trình duyệt...`);

    try {
      let verified = null;
      if (window.khaDesktop?.verifyDownloadUrl) {
        verified = await window.khaDesktop.verifyDownloadUrl(url);
        if (!verified?.ok) throw new Error(verified?.error?.message || 'Link tải không vượt qua kiểm tra an toàn.');
      }

      const detail = verified?.contentLength
        ? `HTTP ${verified.statusCode}, ${formatBytes(verified.contentLength)}, ${verified.contentType || 'Content-Type không rõ'}`
        : 'Đã kiểm tra định dạng tên file và HTTP.';
      setUpdateNotice(`Link tải ${installer.label} hợp lệ (${detail}). Đang mở trình duyệt mặc định. Nếu SmartScreen/antivirus cảnh báo, chỉ tiếp tục khi file đúng tên ${installer.fileName} và URL thuộc github.com/Vankhadev/phanmemoffline.`);

      if (window.khaDesktop?.openExternal) {
        const opened = await window.khaDesktop.openExternal(url);
        if (!opened?.ok) throw new Error(opened?.error?.message || 'Không mở được link tải bằng trình duyệt mặc định.');
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      setUpdateNotice(`Không mở link tải vì kiểm tra thất bại: ${error?.message || 'không rõ'}. Hãy kiểm tra mạng, GitHub Release public và đảm bảo không tải nhầm file rỗng/trang HTML. URL: ${url}`);
    }
  };

  const tabs = useMemo(() => {
    const nextTabs = [];
    if (canViewStore) nextTabs.push({ key: 'store', label: 'Cửa hàng', icon: <Store size={16} /> });
    if (canViewEmployees) nextTabs.push({ key: 'employees', label: 'Nhân viên', icon: <Users size={16} /> });
    if (canViewCustomerTypes) nextTabs.push({ key: 'customer-types', label: 'Loại khách', icon: <Tag size={16} /> });
    if (canViewNegativeStock) nextTabs.push({ key: 'negative-stock', label: 'Xuất âm', icon: <Package size={16} /> });
    if (canViewUpdates) nextTabs.push({ key: 'updates', label: 'Cập nhật', icon: <Settings2 size={16} /> });
    return nextTabs;
  }, [canViewCustomerTypes, canViewEmployees, canViewNegativeStock, canViewStore, canViewUpdates]);

  useEffect(() => {
    if (!tabs.length) return;
    if (tabs.some(item => item.key === tab)) return;
    setTab(tabs[0].key);
  }, [tab, tabs]);

  const desktopAvailable = Boolean(window.khaDesktop?.isElectron && window.khaDesktop?.updates);
  const runtimeCompatibility = updateState?.runtimeCompatibility || appInfo?.runtimeCompatibility || null;
  const runtimeArch = normalizeRuntimeArch(runtimeCompatibility?.arch || appInfo?.arch || window.khaDesktop?.arch || '');
  const recommendedInstaller = getRecommendedInstaller(runtimeArch);
  const currentVersion = appInfo?.version || updateState?.currentVersion || 'Không rõ';
  const updateInfo = updateState?.updateInfo || null;
  const progress = updateState?.progress || null;
  const progressPercent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
  const hasUpdate = Boolean(updateState?.updateAvailable && updateInfo);
  const downloaded = Boolean(updateState?.status === 'downloaded' || updateState?.downloadedFile);
  const updateError = updateState?.lastError || (updateResult?.ok === false ? updateResult.error : null);
  const manifestUrl = updateState?.manifestUrl || updateState?.defaultManifestUrl || '';
  const manifestSourceLabel = getManifestSourceLabel(updateState);
  const updateLogPath = updateState?.updateLogPath || '';
  const runtimeDiagnostics = updateState?.runtimeDiagnostics || null;

  return (
    <div className="max-w-6xl">
      <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-100 rounded-xl">
            <Settings2 className="text-blue-600" size={28} />
          </div>
          <div>
            <h1 className="text-xl font-bold">Cài đặt hệ thống</h1>
            <p className="text-sm text-gray-500">
              Quản lý cửa hàng, nhân viên, loại khách hàng, xuất âm tồn kho và cập nhật ứng dụng.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowHelp(true)}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <HelpCircle size={16} /> Hướng dẫn
        </button>
      </div>

      <div className="mb-6">
        <SectionNotice notice={pageNotice} />
      </div>

      <div className="flex flex-wrap gap-2 mb-6 rounded-xl border bg-white p-2 shadow-sm">
        {tabs.map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${tab === item.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {initialLoading ? (
        <div className="card flex min-h-[260px] items-center justify-center">
          <div className="flex items-center gap-3 text-gray-600">
            <Loader2 size={20} className="animate-spin" />
            <span>Đang tải dữ liệu cài đặt...</span>
          </div>
        </div>
      ) : null}

      {!initialLoading && tab === 'store' && (
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <Store size={18} />
            <h2 className="font-bold">Thông tin cửa hàng</h2>
          </div>

          <SectionNotice notice={storeNotice} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <InputField
              id="store-name"
              label="Tên cửa hàng"
              value={storeForm.name}
              onChange={event => updateStoreField('name', event.target.value)}
              placeholder="Ví dụ: Cửa hàng Vạn Kha"
            />
            <InputField
              id="store-phone"
              label="Số điện thoại"
              value={storeForm.phone}
              onChange={event => updateStoreField('phone', event.target.value)}
              placeholder="0987..."
            />
            <InputField
              id="store-email"
              label="Email"
              type="email"
              value={storeForm.email}
              onChange={event => updateStoreField('email', event.target.value)}
              placeholder="contact@example.com"
            />
            <InputField
              id="store-tax-code"
              label="Mã số thuế"
              value={storeForm.tax_code}
              onChange={event => updateStoreField('tax_code', event.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSaveStore}
              disabled={storeSaving || !canManageStore}
              className="btn-success inline-flex min-h-10 items-center gap-2 disabled:opacity-60"
            >
              {storeSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              {storeSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
            <span className="text-xs text-gray-500">
              Các thay đổi này ảnh hưởng trực tiếp đến thông tin hiển thị trên hóa đơn và các trang dùng dữ liệu cửa hàng.
            </span>
          </div>
        </div>
      )}

      {!initialLoading && tab === 'employees' && (
        <div className="card space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="font-bold flex items-center gap-2">
              <Users size={18} /> Nhân viên ({employees.length})
            </h2>
            {canManageEmployees && (
              <button
                type="button"
                onClick={openAddEmp}
                className="btn-primary inline-flex min-h-10 items-center gap-2 text-sm"
              >
                <Plus size={14} /> Thêm nhân viên mới
              </button>
            )}
          </div>

          <SectionNotice notice={employeesNotice} />

          {employeesLoading ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
              <div className="inline-flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                Đang tải danh sách nhân viên...
              </div>
            </div>
          ) : employees.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
              Chưa có nhân viên nào.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-3 text-left">Họ tên</th>
                    <th className="px-3 py-3 text-left">Email</th>
                    <th className="px-3 py-3 text-left">SĐT</th>
                    <th className="px-3 py-3 text-left">Vai trò</th>
                    <th className="px-3 py-3 text-left">Đăng nhập gần nhất</th>
                    <th className="px-3 py-3 text-center">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(employee => (
                    <tr key={employee.id} className="border-t hover:bg-gray-50">
                      <td className="px-3 py-3 font-medium text-gray-800">{employee.name || '—'}</td>
                      <td className="px-3 py-3 text-gray-600">{employee.email || '—'}</td>
                      <td className="px-3 py-3">{employee.phone || '—'}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${employee.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                          {employee.role === 'admin' ? 'Admin' : 'Nhân viên'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-gray-600">{formatDateTime(employee.last_login)}</td>
                      <td className="px-3 py-3">
                        {canManageEmployees ? (
                          <div className="flex flex-wrap justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => openEditEmp(employee)}
                              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
                            >
                              <Edit2 size={12} /> Sửa
                            </button>
                            {employee.role !== 'admin' && (
                              <button
                                type="button"
                                onClick={() => handleDeleteEmp(employee.id)}
                                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-100"
                              >
                                <Trash2 size={12} /> Xóa
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="block text-center text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!initialLoading && tab === 'customer-types' && (
        <div className="card space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="font-bold flex items-center gap-2">
              <Tag size={18} /> Loại khách hàng ({customerTypes.length})
            </h2>
            {canManageCustomerTypes && (
              <button
                type="button"
                onClick={openAddType}
                className="btn-primary inline-flex min-h-10 items-center gap-2 text-sm"
              >
                <Plus size={14} /> Thêm loại khách
              </button>
            )}
          </div>

          <SectionNotice notice={customerTypesNotice} />

          {customerTypesLoading ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
              <div className="inline-flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                Đang tải loại khách hàng...
              </div>
            </div>
          ) : customerTypes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
              Chưa có loại khách hàng nào.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {customerTypes.map(type => (
                <div
                  key={type.id}
                  className="flex items-center justify-between rounded-xl border bg-white p-4"
                  style={{ borderLeftColor: type.color || '#3b82f6', borderLeftWidth: 4 }}
                >
                  <div>
                    <div className="font-semibold text-sm text-gray-800">{type.name}</div>
                    <div className="text-xs text-gray-400">#{type.id}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canManageCustomerTypes ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditType(type)}
                          className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-700 hover:bg-blue-100"
                          title="Sửa loại khách"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteType(type.id)}
                          className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-600 hover:bg-red-100"
                          title="Xóa loại khách"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!initialLoading && tab === 'negative-stock' && (
        <div className="card space-y-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-bold flex items-center gap-2">
                <Package size={18} /> Xuất âm tồn kho
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Quản lý việc cho phép xuất vượt tồn kho hiện có. Giới hạn âm là cố định trong code và không chỉnh sửa từ giao diện này.
              </p>
            </div>
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${negativeStockFeature.active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
              <span className={`h-2 w-2 rounded-full ${negativeStockFeature.active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              {negativeStockFeature.active ? 'Đang bật' : 'Đang tắt'}
            </span>
          </div>

          <SectionNotice notice={negativeStockNotice} />

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <div className="font-semibold text-gray-800">Cho phép xuất âm tồn kho sản phẩm</div>
                <p className="text-sm text-gray-600">
                  Khi bật, hệ thống cho phép xuất vượt tồn kho hiện có nhưng không được thấp hơn <strong>{NEGATIVE_STOCK_LIMIT}</strong>. Khi tắt, hệ thống chặn mọi trường hợp làm tồn kho nhỏ hơn <strong>0</strong>.
                </p>
                <p className="text-xs text-gray-500">
                  Giới hạn âm là hằng số cố định trong code để đảm bảo kiểm soát nghiệp vụ nhất quán giữa frontend và backend.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={negativeStockFeature.active}
                aria-label={negativeStockFeature.active ? 'Tắt cho phép xuất âm tồn kho' : 'Bật cho phép xuất âm tồn kho'}
                aria-busy={negativeStockSaving}
                onClick={handleToggleNegativeStock}
                disabled={negativeStockSaving || !canManageNegativeStock}
                className={`inline-flex min-h-14 w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left shadow-sm transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 md:w-[280px] ${negativeStockFeature.active ? 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'} disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      {negativeStockFeature.active ? 'Đang bật' : 'Đang tắt'}
                    </span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${negativeStockFeature.active ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`}>
                      {negativeStockFeature.active ? 'ON' : 'OFF'}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs font-medium opacity-80">
                    {negativeStockSaving ? 'Đang lưu thay đổi...' : 'Chạm để bật/tắt nhanh'}
                  </span>
                </span>

                <span className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors duration-200 ease-out ${negativeStockFeature.active ? 'bg-emerald-500' : 'bg-slate-300'} ${negativeStockSaving ? 'opacity-90' : ''}`}>
                  <span className={`h-6 w-6 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-all duration-200 ease-out ${negativeStockFeature.active ? 'translate-x-6' : 'translate-x-0'} ${negativeStockSaving ? 'scale-95' : ''}`} />
                  {negativeStockSaving && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <Loader2 size={14} className="animate-spin text-white/90" />
                    </span>
                  )}
                </span>
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            <div className="font-semibold">Nguyên tắc áp dụng</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Khi tắt: backend không cho xuất nếu tồn dự kiến nhỏ hơn 0.</li>
              <li>Khi bật: backend cho phép tồn sau xuất giảm tối đa đến {NEGATIVE_STOCK_LIMIT}.</li>
              <li>Nếu vượt giới hạn, backend trả lỗi rõ tên sản phẩm, tồn hiện tại, số lượng xuất và giới hạn tối thiểu.</li>
              <li>Giao diện này chỉ bật/tắt tính năng, không cho chỉnh sửa mức giới hạn âm.</li>
            </ul>
          </div>

          {!canManageNegativeStock && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Tài khoản hiện tại chỉ có quyền xem trạng thái xuất âm tồn kho và không thể thay đổi cấu hình này.
            </div>
          )}
        </div>
      )}

      {!initialLoading && tab === 'updates' && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="font-bold flex items-center gap-2">
                  <Settings2 size={18} /> Cập nhật ứng dụng
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Ứng dụng Electron có thể tự kiểm tra, tự tải và chỉ cài đặt khi bạn xác nhận cập nhật.
                </p>
              </div>
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${updateState?.status === 'error' ? 'bg-red-100 text-red-700' : hasUpdate ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                {getUpdateStatusLabel(updateState?.status)}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
              <div className="rounded-xl border bg-gray-50 p-4">
                <div className="text-gray-500">Phiên bản hiện tại</div>
                <div className="mt-1 text-2xl font-bold text-gray-800">{currentVersion}</div>
                <div className="mt-2 text-xs text-gray-500">
                  Nền tảng: {appInfo?.platform || window.khaDesktop?.platform || 'web'} · Kiến trúc: {appInfo?.arch || 'unknown'}
                </div>
              </div>
              <div className="rounded-xl border bg-gray-50 p-4">
                <div className="text-gray-500">Feed cập nhật</div>
                <div className="mt-1 break-all font-medium text-gray-800">{manifestUrl || 'Chưa nạp URL feed'}</div>
                <div className="mt-2 text-xs text-gray-500">Nguồn: {manifestSourceLabel}</div>
                {updateState?.manifestUrlDefault && (
                  <div className="mt-2 inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                    Đang dùng GitHub Release feed mặc định
                  </div>
                )}
              </div>
            </div>

            {updateLogPath && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                <div className="font-semibold text-gray-700">Log cập nhật</div>
                <div className="mt-1 break-all">{updateLogPath}</div>
                <div className="mt-1">Log này dùng để debug check/download/cài đặt và không chứa token hay mật khẩu.</div>
              </div>
            )}

            {runtimeDiagnostics && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                <div className="font-semibold text-gray-700">Chẩn đoán runtime updater</div>
                <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2">
                  <div>Đã đóng gói: {runtimeDiagnostics.isPackaged ? 'Có' : 'Không'}</div>
                  <div>app-update.yml: {runtimeDiagnostics.appUpdateYmlExists ? 'Có' : 'Không thấy'}</div>
                  <div>Kiến trúc runtime: {runtimeArch || 'unknown'}</div>
                  <div>Tương thích: {runtimeCompatibility?.supported === false ? 'Không' : 'Có'}</div>
                  <div className="break-all md:col-span-2">Đường dẫn app-update.yml: {runtimeDiagnostics.appUpdateYmlPath || 'Không xác định'}</div>
                </div>
              </div>
            )}

            {runtimeCompatibility && (
              <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${runtimeCompatibility.supported === false ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                <div className="font-semibold">Tương thích máy Windows</div>
                <div className="mt-1">{runtimeCompatibility.message}</div>
                <div className="mt-1 text-xs">Bộ cài khuyến nghị: {recommendedInstaller?.label || 'Windows x64'}.</div>
              </div>
            )}

            {!desktopAvailable && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Tính năng cập nhật chỉ hoạt động trong ứng dụng Electron đã cài trên Windows. Khi chạy frontend web độc lập, API cập nhật sẽ không khả dụng.
              </div>
            )}

            {updateNotice && (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                {updateNotice}
              </div>
            )}

            {updateError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <div className="font-semibold">Không thể hoàn tất thao tác cập nhật</div>
                <div>{getUpdateErrorMessage(updateError)}</div>
                {updateError.details && (
                  <pre className="mt-2 whitespace-pre-wrap rounded bg-white/70 p-2 text-xs">
                    {formatUpdateErrorDetails(updateError.details)}
                  </pre>
                )}
              </div>
            )}

            {hasUpdate && (
              <div className="mt-4 rounded-xl border bg-white p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-sm text-gray-500">Bản mới</div>
                    <div className="text-xl font-bold text-green-700">{updateInfo.version}</div>
                  </div>
                  <div className="text-xs text-gray-500 md:text-right">
                    <div>Ngày phát hành: {formatDateTime(updateInfo.releaseDate)}</div>
                    <div>Dung lượng: {formatBytes(updateInfo.size)}</div>
                    {updateInfo.mandatory && <div className="font-semibold text-red-600">Bản cập nhật bắt buộc</div>}
                  </div>
                </div>
                <div className="mt-3 text-sm">
                  <div className="mb-1 font-semibold text-gray-700">Ghi chú phát hành</div>
                  <pre className="whitespace-pre-wrap rounded-lg border bg-gray-50 p-3 text-sm text-gray-700">
                    {updateInfo.releaseNotes || 'Không có ghi chú phát hành.'}
                  </pre>
                </div>
                <div className="mt-3 break-all text-xs text-gray-500">
                  <div>Installer/feed path: {updateInfo.url || updateInfo.path || 'Theo latest.yml'}</div>
                  {updateInfo.sha512 ? <div>SHA512: {updateInfo.sha512}</div> : updateInfo.sha256 ? <div>SHA256: {updateInfo.sha256}</div> : null}
                </div>
              </div>
            )}

            {updateState?.status === 'no-update' && updateState?.lastCheckedAt && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                Ứng dụng đang ở phiên bản mới nhất. Lần kiểm tra: {formatDateTime(updateState.lastCheckedAt)}.
              </div>
            )}

            {updateState?.status === 'downloading' && (
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>Tiến trình tải</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full bg-blue-600 transition-all" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {formatBytes(progress?.transferred)} / {formatBytes(progress?.total)}
                </div>
              </div>
            )}

            {downloaded && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                electron-updater đã tải và xác thực gói cập nhật thành công. Khi bấm Cập nhật ngay, ứng dụng sẽ sao lưu database trước khi cài đặt và khởi động lại.
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCheckUpdate}
                disabled={!desktopAvailable || updateBusy === 'checking' || updateState?.status === 'downloading'}
                className="btn-primary disabled:opacity-60"
              >
                {updateBusy === 'checking' ? 'Đang kiểm tra...' : 'Kiểm tra cập nhật'}
              </button>
              <button
                type="button"
                onClick={handleDownloadUpdate}
                disabled={!desktopAvailable || !hasUpdate || downloaded || updateState?.status === 'downloading'}
                className="btn-success disabled:opacity-60"
              >
                {updateBusy === 'downloading' ? 'Đang tải...' : 'Tải bản cập nhật'}
              </button>
              {updateState?.status === 'downloading' && (
                <button
                  type="button"
                  onClick={handleCancelUpdate}
                  disabled={updateBusy === 'cancelling'}
                  className="btn-danger disabled:opacity-60"
                >
                  {updateBusy === 'cancelling' ? 'Đang hủy...' : 'Hủy tải'}
                </button>
              )}
              <button
                type="button"
                onClick={handleInstallUpdate}
                disabled={!desktopAvailable || !downloaded || updateBusy === 'installing'}
                className="btn-danger disabled:opacity-60"
              >
                {updateBusy === 'installing' ? 'Đang cập nhật...' : 'Cập nhật ngay'}
              </button>
            </div>
          </div>

          <div className="card border-emerald-100 bg-emerald-50 text-sm text-emerald-800">
            <h3 className="mb-3 font-bold">Tải bộ cài thủ công đúng kiến trúc</h3>
            <div className="mb-3 rounded-lg border border-emerald-200 bg-white/70 px-3 py-2 text-xs">
              Luôn tải từ GitHub Release chính thức và chọn đúng file có hậu tố kiến trúc. Nếu Windows báo “Ứng dụng này không thể chạy trên PC của bạn”, hãy thử bản ia32 cho Windows 32-bit hoặc kiểm tra máy có hỗ trợ x64 không.
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {WINDOWS_INSTALLERS.map(installer => {
                const recommended = installer.arch === recommendedInstaller?.arch;
                const url = buildReleaseDownloadUrl(installer.fileName);
                return (
                  <div key={installer.arch} className="rounded-xl border border-emerald-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold text-gray-800">{installer.label}</div>
                      {recommended && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Khuyến nghị cho máy này</span>}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{installer.recommendedFor}</div>
                    <div className="mt-2 break-all rounded bg-gray-50 p-2 text-xs text-gray-600">{installer.fileName}</div>
                    <button
                      type="button"
                      onClick={() => handleOpenInstallerDownload(installer)}
                      className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      Tải {installer.arch}
                    </button>
                    <div className="mt-2 break-all text-[11px] text-gray-500">{url}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card border-blue-100 bg-blue-50 text-sm text-blue-800">
            <h3 className="mb-2 font-bold">Ghi chú update feed</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>Mặc định app dùng provider generic để đọc trực tiếp latest.yml từ GitHub Release latest.</li>
              <li>Release production cần có installer x64 và ia32, mỗi file .exe có .exe.blockmap tương ứng và tên asset rõ kiến trúc.</li>
              <li>latest.yml và update-manifest.json phải cùng version, URL, sha256/sha512 và size với asset đã upload.</li>
              <li>Khi repo hoặc release asset đang private, client Electron không thể tự cập nhật nếu không có feed public phù hợp.</li>
              <li>Trước khi cài đặt, ứng dụng sẽ sao lưu file database trong thư mục userData/backups.</li>
            </ul>
          </div>
        </div>
      )}

      {showEmpModal && canManageEmployees && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="employee-modal-title">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="employee-modal-title" className="text-lg font-bold">
                {empEdit ? 'Sửa nhân viên' : 'Thêm nhân viên'}
              </h2>
              <button type="button" onClick={closeEmpModal} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <SectionNotice notice={empNotice} />

              <div className="space-y-3">
                <InputField
                  id="emp-name"
                  label="Họ tên"
                  value={empForm.name}
                  onChange={event => setEmpForm(current => ({ ...current, name: event.target.value }))}
                />
                <InputField
                  id="emp-email"
                  label="Email"
                  type="email"
                  value={empForm.email}
                  onChange={event => setEmpForm(current => ({ ...current, email: event.target.value }))}
                />
                <InputField
                  id="emp-phone"
                  label="Số điện thoại"
                  value={empForm.phone}
                  onChange={event => setEmpForm(current => ({ ...current, phone: event.target.value }))}
                />
                <InputField
                  id="emp-password"
                  label={empEdit ? 'Mật khẩu mới (để trống nếu không đổi)' : 'Mật khẩu'}
                  type="password"
                  autoComplete="new-password"
                  value={empForm.password}
                  onChange={event => setEmpForm(current => ({ ...current, password: event.target.value }))}
                />
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                Server tự động gán quyền: tài khoản đầu tiên là ADMIN, các tài khoản sau là USER. Client không gửi role khi tạo mới.
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleSaveEmp}
                disabled={empSaving}
                className="btn-success flex-1 disabled:opacity-60"
              >
                {empSaving ? 'Đang lưu...' : 'Lưu'}
              </button>
              <button type="button" onClick={closeEmpModal} disabled={empSaving} className="btn-danger flex-1 disabled:opacity-60">
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {showTypeModal && canManageCustomerTypes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="customer-type-modal-title">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="customer-type-modal-title" className="text-lg font-bold">
                {typeEdit ? 'Sửa loại khách' : 'Thêm loại khách'}
              </h2>
              <button type="button" onClick={closeTypeModal} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <SectionNotice notice={typeNotice} />
              <InputField
                id="customer-type-name"
                label="Tên loại khách"
                value={typeForm.name}
                onChange={event => setTypeForm(current => ({ ...current, name: event.target.value }))}
                placeholder="Ví dụ: Khách VIP"
              />

              <div>
                <label htmlFor="customer-type-color" className="text-sm font-medium text-gray-700">
                  Màu sắc
                </label>
                <div className="mt-1 flex items-center gap-3">
                  <input
                    id="customer-type-color"
                    type="color"
                    className="h-10 w-12 cursor-pointer rounded border"
                    value={typeForm.color}
                    onChange={event => setTypeForm(current => ({ ...current, color: normalizeHexColor(event.target.value) }))}
                  />
                  <span className="text-sm text-gray-500">{typeForm.color}</span>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleSaveType}
                disabled={typeSaving}
                className="btn-success flex-1 disabled:opacity-60"
              >
                {typeSaving ? 'Đang lưu...' : 'Lưu'}
              </button>
              <button type="button" onClick={closeTypeModal} disabled={typeSaving} className="btn-danger flex-1 disabled:opacity-60">
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      <HelpModal
        show={showHelp}
        title="Hướng dẫn sử dụng Cài đặt hệ thống"
        onClose={() => setShowHelp(false)}
        content={(
          <div className="space-y-4 text-sm text-gray-700">
            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tổng quan</h3>
              <p>
                Trang Cài đặt cho phép cấu hình thông tin cửa hàng, quản lý nhân viên, loại khách hàng, bật/tắt xuất âm tồn kho và cập nhật ứng dụng Electron.
              </p>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Cửa hàng</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Cập nhật tên cửa hàng, địa chỉ, số điện thoại, email, mã số thuế và thông tin ngân hàng.</li>
                <li>Phần logo, ghi chú và slogan ảnh hưởng trực tiếp tới nội dung in hóa đơn.</li>
                <li>Sau khi chỉnh sửa, nhấn <strong>Lưu thay đổi</strong> để ghi xuống backend.</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Nhân viên</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Thêm, sửa hoặc vô hiệu tài khoản nhân viên.</li>
                <li>Tài khoản đầu tiên luôn là ADMIN; các tài khoản tạo sau sẽ là USER do server tự gán.</li>
                <li>Khi sửa nhân viên, có thể để trống mật khẩu nếu không muốn đổi.</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Loại khách</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Tạo và chỉnh màu cho từng nhóm khách hàng.</li>
                <li>Xóa loại khách là thao tác soft-delete trên backend.</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Xuất âm</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Dùng để bật/tắt cho phép xuất âm tồn kho sản phẩm.</li>
                <li>Khi bật, hệ thống cho xuất vượt tồn nhưng không thấp hơn giới hạn cố định {NEGATIVE_STOCK_LIMIT}.</li>
                <li>Khi tắt, mọi thao tác làm tồn kho nhỏ hơn 0 sẽ bị backend từ chối.</li>
                <li>Người dùng không chỉnh sửa giới hạn âm từ giao diện, chỉ xem mô tả và trạng thái bật/tắt.</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Cập nhật</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Chỉ hoạt động khi chạy bản Electron đã đóng gói.</li>
                <li>App chỉ cài đặt sau khi người dùng xác nhận và sẽ sao lưu database trước khi cập nhật.</li>
                <li>Khi cần debug, có thể xem đường dẫn file update.log được hiển thị trong trang.</li>
              </ul>
            </div>
          </div>
        )}
      />
    </div>
  );
}
