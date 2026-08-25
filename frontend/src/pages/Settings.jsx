import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle,
  Edit2,
  FileText,
  HelpCircle,
  Image,
  Loader2,
  Package,
  Plus,
  RotateCcw,
  Settings2,
  Star,
  Store,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import HelpModal from '../components/HelpModal';
import PrintTemplateEditorModal from '../components/invoice-print/PrintTemplateEditorModal';
import { buildTemplateJsonFromSettings, DEFAULT_INVOICE_TEMPLATE_SETTINGS, normalizePrintTemplate } from '../components/invoice-print/templateDefaults';
import { SYNC_UPDATED_EVENT, apiJson, customerTypesApi, dataGuardianApi, getApiErrorMessage, printTemplatesApi, settingsApi, usersApi, resolveApiUrl } from '../utils/apiClient';
import {
  cacheNegativeStockSettings,
  getNegativeStockAdminLimitLabel,
  getNegativeStockLimitLabel,
  getNegativeStockRuntimeSummary,
  normalizeNegativeStockSettings,
} from '../utils/negativeStock';

const INITIAL_STORE_FORM = Object.freeze({
  name: '',
  email: '',
  phone: '',
  tax_code: '',
  bank_account: '',
  bank_name: '',
  address: '',
});

const INITIAL_EMP_FORM = Object.freeze({
  name: '',
  email: '',
  phone: '',
  password: '',
  role: 'employee',
});

const USER_ROLE_OPTIONS = Object.freeze([
  { value: 'admin', label: 'Admin', description: 'Toán quyđơn hệ thống về kế toán.' },
  { value: 'accountant', label: 'Kế toán', description: '??y d? module kế toán, thuế, tồn kho, công nợ về nhật ký.' },
  { value: 'cashier', label: 'Thu ngđơn', description: 'Ch? xem doanh thu trong module kế toán.' },
  { value: 'employee', label: 'Nhân viên', description: 'Không có quyđơn module kế toán.' },
  { value: 'user', label: 'User cu', description: 'Vai tr? legacy được giá tuong th?ch.' },
]);

const INITIAL_TYPE_FORM = Object.freeze({
  name: '',
  color: '#3b82f6',
});

const INITIAL_PRINT_TEMPLATE_FORM = Object.freeze({
  template_name: '',
  description: '',
  shop_name: '',
  shop_address: '',
  shop_phone: '',
  logo_url: '',
  paper_size: 'A5',
  orientation: 'portrait',
  status: 'active',
  is_default: false,
  fontSize: DEFAULT_INVOICE_TEMPLATE_SETTINGS.fontSize,
  scale: DEFAULT_INVOICE_TEMPLATE_SETTINGS.scale,
  previewZoom: DEFAULT_INVOICE_TEMPLATE_SETTINGS.previewZoom,
  showLogo: DEFAULT_INVOICE_TEMPLATE_SETTINGS.showLogo,
  showQr: false,
  showSignature: DEFAULT_INVOICE_TEMPLATE_SETTINGS.showSignature,
  showNote: DEFAULT_INVOICE_TEMPLATE_SETTINGS.showNote,
  showDebt: DEFAULT_INVOICE_TEMPLATE_SETTINGS.showDebt,
  lineSpacing: DEFAULT_INVOICE_TEMPLATE_SETTINGS.lineSpacing,
  paddingMm: DEFAULT_INVOICE_TEMPLATE_SETTINGS.paddingMm,
  marginMm: DEFAULT_INVOICE_TEMPLATE_SETTINGS.marginMm,
  tableWidthPercent: DEFAULT_INVOICE_TEMPLATE_SETTINGS.tableWidthPercent,
  tableBorder: DEFAULT_INVOICE_TEMPLATE_SETTINGS.tableBorder,
  tableBorderWidthMm: DEFAULT_INVOICE_TEMPLATE_SETTINGS.tableBorderWidthMm,
});

const NEGATIVE_STOCK_FEATURE_NAME = 'Xuất âm tồn kho';
const NEGATIVE_STOCK_FEATURE_DESCRIPTION = 'Admin có thể ch?nh số lượng tđơn âm tđi da trực tiếp t? giao diđơn.';
const RELEASE_VERSION = '1.3.8';
const RELEASE_DOWNLOAD_BASE_URL = 'https://github.com/Vankhadev/phanmemoffline/releases/latest/download/';
const WINDOWS_INSTALLERS = Object.freeze([
  {
    arch: 'x64',
    label: 'Windows 64-bit (x64)',
    fileName: `banhangoffline-setup-v${RELEASE_VERSION}-x64.exe`,
    recommendedFor: 'Hđủ h?t mãy t?nh Windows 10/11 hiện nay.',
  },
  {
    arch: 'ia32',
    label: 'Windows 32-bit (ia32)',
    fileName: `banhangoffline-setup-v${RELEASE_VERSION}-ia32.exe`,
    recommendedFor: 'M?y Windows 32-bit ho?c mãy b?o không ch?y được bđơn x64.',
  },
]);

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (!bytes) return 'Không r? dung lu?ng';
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
  if (!value) return '?';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '?';
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
    idle: 'Sản s?ng',
    checking: 'đang kiểm tra...',
    'no-update': 'Không có bđơn mới',
    'update-available': 'C? bđơn cập nhật',
    downloading: 'đang tđi cập nhật...',
    downloaded: '?? tđi xong',
    installing: 'đang cập nhật...',
    cancelled: '?? h?y tđi',
    error: 'C? lỗi',
  };
  return labels[status] || 'Chưa kiểm tra';
}

function getUpdateErrorMessage(error) {
  if (!error) return '';
  const messages = {
    MANIFEST_URL_MISSING: 'Chưa xác định được URL cập nhật. Mặc định ứng dụng dùng GitHub Releases latest.yml.',
    CONFIG_INVALID: 'File cấu hình cập nhật không hợp l?.',
    URL_INVALID: 'URL cập nhật ho?c installer không hợp l?.',
    DEV_UPDATER_DISABLED: 'Auto-update b? tốt khi ch?y development/unpacked. Hủy test trđơn bđơn d? cái bằng NSIS ho?c bắt KHA_ENABLE_ELECTRON_UPDATER=1 c? ch? d?ch.',
    WINDOW_NOT_READY: 'Ch? kiểm tra cập nhật sau khi của s? ch?nh d? sđơn s?ng.',
    ELECTRON_UPDATER_ERROR: 'electron-updater b?o lỗi trong quá trình kiểm tra/tđi cập nhật.',
    CHECK_FAILED: 'Kiểm tra cập nhật th?t bđi.',
    UPDATE_GITHUB_ATOM_FEED_NOT_AVAILABLE: 'Endpoint GitHub releases.atom không phù hợp ho?c không kh? d?ng. Bản mới s? d?c trực tiếp latest.yml public thay về ph? thuếc Atom feed.',
    UPDATE_REPOSITORY_NOT_ACCESSIBLE: 'Không truy c?p được GitHub Releases/latest. Repo có thể private, owner/repo sai, URL feed sai ho?c chưa c? release latest public.',
    UPDATE_FEED_UNAUTHORIZED_OR_PRIVATE: 'GitHub Release/feed yđủ cđủ xác thực, token sai/thiđủ quyđơn ho?c repo dang private. Client Electron không được nh?ng token nđơn không th? t? cập nhật t? asset private.',
    UPDATE_FEED_METADATA_NOT_FOUND: 'Không tâm th?y latest.yml trong GitHub Release latest ho?c release latest không public.',
    UPDATE_METADATA_INVALID: 'Metadata cập nhật trđơn GitHub Release không hợp l? ho?c r?ng.',
    UPDATE_RUNTIME_ARCH_UNSUPPORTED: 'M?y Windows hiện tại chưa c? b? cái phù hợp. Hủy tđi d?ng bđơn x64 ho?c ia32 t? GitHub Release.',
    UPDATE_METADATA_MISSING_RUNTIME_INSTALLER: 'GitHub Release chưa c? installer ri?ng cho kiđơn tr?c mãy n?y. Cđơn upload asset cấu hình t? -x64.exe ho?c -ia32.exe về cập nhật latest.yml.',
    UPDATE_METADATA_SELECTED_INSTALLER_MISMATCH: 'Metadata cập nhật dang chọn installer không kh?p kiđơn tr?c mãy. Không tđi d? tr?nh lỗi Windows không ch?y được ứng dụng.',
    UPDATE_ASSET_NOT_ACCESSIBLE_OR_PRIVATE: 'Không tải được installer/blockmap. Asset có thể thiđủ, tđơn không kh?p latest.yml ho?c repo private tr? 404.',
    UPDATE_RELEASE_NOT_PUBLISHED: 'Chưa có production release được publish để electron-updater chọn làm latest.',
    UPDATE_FEED_RATE_LIMITED: 'GitHub dang giới hạn truy c?p feed cập nhật, vui l?ng thử lại sau.',
    UPDATE_NETWORK_ERROR: 'Không kết nối được tđi GitHub Releases. Vui lòng kiểm tra Internet, DNS, proxy/firewall.',
    NETWORK_ERROR: 'Không th? kết nối tđi mãy ch? cập nhật. Vui lòng kiểm tra mãng.',
    NETWORK_TIMEOUT: 'K?t nđi tđi mãy ch? cập nhật qu? thời gian ch?.',
    MANIFEST_HTTP_ERROR: 'M?y ch? không tr? metadata cập nhật hợp lệ.',
    MANIFEST_INVALID_JSON: 'Metadata cập nhật không phđi JSON/YAML hợp lệ.',
    MANIFEST_INVALID: 'Metadata cập nhật thiđủ ho?c sai cđủ tr?c.',
    MANIFEST_INVALID_VERSION: 'Metadata thiđủ version SemVer hợp lệ.',
    MANIFEST_INVALID_URL: 'Metadata thiđủ URL gđi cập nhật hợp lệ.',
    MANIFEST_INVALID_SHA256: 'Metadata thiđủ checksum hợp lệ.',
    MANIFEST_INVALID_RELEASE_DATE: 'Metadata thiđủ releaseDate.',
    UPDATE_NOT_AVAILABLE: 'Không có bđơn cập nhật mới đã tải.',
    DOWNLOAD_IN_PROGRESS: 'Một lu?t tđi cập nhật dang ch?y.',
    DOWNLOAD_HTTP_ERROR: 'Không tải được gđi cập nhật t? mãy ch?.',
    DOWNLOAD_FAILED: 'Tải gđi cập nhật th?t bđi.',
    DOWNLOAD_CANCELLED: 'Nguđi d?ng d? h?y tđi cập nhật.',
    CHECKSUM_MISMATCH: 'Checksum không kh?p. Gửi cập nhật d? b? xóa về s? không được ch?y.',
    INSTALLER_NOT_DOWNLOADED: 'Chua tđi gđi cập nhật.',
    UPDATE_NOT_DOWNLOADED: 'Chưa có bản cập nhật đã tải xong để cài đặt.',
    INSTALLER_NOT_FOUND: 'Không tâm th?y installer đã tải. Vui lòng tải lại.',
    INSTALL_IN_PROGRESS: 'ứng dụng dang chuđơn b? cài đặt bđơn cập nhật.',
    SPAWN_INSTALLER_FAILED: 'Không th? ch?y installer cập nhật.',
  };
  return messages[error.code] || error.message || '?? x?y ra lỗi cập nhật.';
}

function getManifestSourceLabel(updateState) {
  if (!updateState) return 'Chua n?p cấu hình cập nhật';
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
  if (updateState.manifestUrlConfigured) return `Override nđi b?: ${updateState.manifestSource || 'env/config file'}`;
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
  };
}

function normalizeRoleValue(value) {
  const role = String(value || '').trim().toLowerCase();
  return USER_ROLE_OPTIONS.some(option => option.value === role) ? role : 'user';
}

function getRoleOption(role) {
  const normalized = normalizeRoleValue(role);
  return USER_ROLE_OPTIONS.find(option => option.value === normalized) || USER_ROLE_OPTIONS[USER_ROLE_OPTIONS.length - 1];
}

function getRoleBadgeClass(role) {
  const normalized = normalizeRoleValue(role);
  if (normalized === 'admin') return 'bg-purple-100 text-purple-700 border-purple-200';
  if (normalized === 'accountant') return 'bg-indigo-100 text-indigo-700 border-indigo-200';
  if (normalized === 'cashier') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (normalized === 'employee') return 'bg-blue-100 text-blue-700 border-blue-200';
  return 'bg-gray-100 text-gray-700 border-gray-200';
}

function normalizeEmployeeForm(payload = {}) {
  return {
    ...INITIAL_EMP_FORM,
    name: String(payload?.name || ''),
    email: String(payload?.email || ''),
    phone: String(payload?.phone || ''),
    password: '',
    role: normalizeRoleValue(payload?.role || INITIAL_EMP_FORM.role),
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
  };
}

function sanitizeEmployeePayload(form = {}) {
  const normalized = normalizeEmployeeForm(form);
  const payload = {
    name: normalized.name.trim(),
    email: normalized.email.trim().toLowerCase(),
    phone: normalized.phone.trim(),
    role: normalizeRoleValue(normalized.role),
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

function clampFormNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizePrintTemplateForm(payload = {}, fallbackStore = {}) {
  const item = normalizePrintTemplate(payload);
  const settings = item.settings || DEFAULT_INVOICE_TEMPLATE_SETTINGS;
  const storePayload = normalizeStorePayload(fallbackStore);
  return {
    ...INITIAL_PRINT_TEMPLATE_FORM,
    template_name: String(item.template_name || payload?.template_name || payload?.name || ''),
    description: String(item.description || ''),
    shop_name: String(item.shop_name || settings.storeName || storePayload.name || ''),
    shop_address: String(item.shop_address || settings.storeAddress || storePayload.address || ''),
    shop_phone: String(item.shop_phone || settings.storePhone || storePayload.phone || ''),
    logo_url: String(item.logo_url || item.header_logo || payload?.logo_url || payload?.header_logo || ''),
    paper_size: ['A4', 'A5', 'K80', 'K57', 'K58'].includes(String(item.paper_size || settings.paperSize || '').toUpperCase()) ? (String(item.paper_size || settings.paperSize).toUpperCase() === 'K58' ? 'K57' : String(item.paper_size || settings.paperSize).toUpperCase()) : 'A5',
    orientation: settings.orientation === 'landscape' ? 'landscape' : 'portrait',
    status: item.status || 'active',
    is_default: Boolean(item.is_default),
    fontSize: clampFormNumber(settings.fontSize, 7, 16, DEFAULT_INVOICE_TEMPLATE_SETTINGS.fontSize),
    scale: clampFormNumber(settings.scale, 0.5, 1, DEFAULT_INVOICE_TEMPLATE_SETTINGS.scale),
    previewZoom: clampFormNumber(settings.previewZoom, 0.5, 1, DEFAULT_INVOICE_TEMPLATE_SETTINGS.previewZoom),
    showLogo: Boolean(settings.showLogo),
    showQr: false,
    showSignature: Boolean(settings.showSignature),
    showNote: Boolean(settings.showNote),
    showDebt: Boolean(settings.showDebt),
    lineSpacing: clampFormNumber(settings.lineSpacing, 1, 2.2, DEFAULT_INVOICE_TEMPLATE_SETTINGS.lineSpacing),
    paddingMm: clampFormNumber(settings.paddingMm, 0, 24, DEFAULT_INVOICE_TEMPLATE_SETTINGS.paddingMm),
    marginMm: clampFormNumber(settings.marginMm, 0, 20, DEFAULT_INVOICE_TEMPLATE_SETTINGS.marginMm),
    tableWidthPercent: clampFormNumber(settings.tableWidthPercent, 60, 100, DEFAULT_INVOICE_TEMPLATE_SETTINGS.tableWidthPercent),
    tableBorder: Boolean(settings.tableBorder),
    tableBorderWidthMm: clampFormNumber(settings.tableBorderWidthMm, 0, 1, DEFAULT_INVOICE_TEMPLATE_SETTINGS.tableBorderWidthMm),
  };
}

function sanitizePrintTemplatePayload(form = {}) {
  const requestedPaperSize = String(form.paper_size || '').toUpperCase();
  const paperSize = ['A4', 'A5', 'K80', 'K57', 'K58'].includes(requestedPaperSize) ? (requestedPaperSize === 'K58' ? 'K57' : requestedPaperSize) : 'A5';
  const orientation = paperSize.startsWith('K') ? 'portrait' : (form.orientation === 'landscape' ? 'landscape' : 'portrait');
  const settingsInput = {
    fontSize: clampFormNumber(form.fontSize, 7, 16, DEFAULT_INVOICE_TEMPLATE_SETTINGS.fontSize),
    scale: clampFormNumber(form.scale, 0.5, 1, DEFAULT_INVOICE_TEMPLATE_SETTINGS.scale),
    previewZoom: clampFormNumber(form.previewZoom, 0.5, 1, DEFAULT_INVOICE_TEMPLATE_SETTINGS.previewZoom),
    paperSize,
    orientation,
    showLogo: Boolean(form.showLogo),
    showQr: false,
    showSignature: Boolean(form.showSignature),
    showNote: Boolean(form.showNote),
    showDebt: Boolean(form.showDebt),
    lineSpacing: clampFormNumber(form.lineSpacing, 1, 2.2, DEFAULT_INVOICE_TEMPLATE_SETTINGS.lineSpacing),
    paddingMm: clampFormNumber(form.paddingMm, 0, 24, DEFAULT_INVOICE_TEMPLATE_SETTINGS.paddingMm),
    marginMm: clampFormNumber(form.marginMm, 0, 20, DEFAULT_INVOICE_TEMPLATE_SETTINGS.marginMm),
    tableWidthPercent: clampFormNumber(form.tableWidthPercent, 60, 100, DEFAULT_INVOICE_TEMPLATE_SETTINGS.tableWidthPercent),
    tableBorder: Boolean(form.tableBorder),
    tableBorderWidthMm: clampFormNumber(form.tableBorderWidthMm, 0, 1, DEFAULT_INVOICE_TEMPLATE_SETTINGS.tableBorderWidthMm),
    storeName: String(form.shop_name || '').trim(),
    storeAddress: String(form.shop_address || '').trim(),
    storePhone: String(form.shop_phone || '').trim(),
  };
  const json = buildTemplateJsonFromSettings(settingsInput);
  return {
    template_name: String(form.template_name || '').trim(),
    description: String(form.description || '').trim(),
    shop_name: settingsInput.storeName,
    shop_address: settingsInput.storeAddress,
    shop_phone: settingsInput.storePhone,
    paper_size: paperSize,
    orientation,
    status: form.status || 'active',
    is_default: Boolean(form.is_default),
    layout_json: json.layout_json,
    settings_json: json.settings_json,
  };
}

function buildPreviewPrintTemplate(form = {}, edit = null, logoPreviewUrl = '') {
  const payload = sanitizePrintTemplatePayload(form);
  return normalizePrintTemplate({
    ...(edit || {}),
    ...payload,
    id: edit?.id || null,
    logo_url: logoPreviewUrl || form.logo_url || edit?.logo_url || edit?.header_logo || '',
    header_logo: logoPreviewUrl || form.logo_url || edit?.header_logo || edit?.logo_url || '',
  });
}

function revokeObjectUrl(value) {
  if (typeof window === 'undefined') return;
  const url = String(value || '');
  if (url.startsWith('blob:')) window.URL.revokeObjectURL(url);
}

function normalizePrintTemplatesResponse(data) {
  if (Array.isArray(data)) return data.map(item => normalizePrintTemplate(item));
  if (!data || typeof data !== 'object') return [];
  const items = Array.isArray(data.items)
    ? data.items
    : Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.templates)
        ? data.templates
        : [];
  return items.filter(Boolean).map(item => normalizePrintTemplate(item));
}

function normalizeNegativeStockLimitInput(value) {
  const text = String(value ?? '').trim();
  if (!text) return '0';
  const number = Number(text);
  return Number.isInteger(number) && number >= 0 ? String(number) : text;
}

function getNegativeStockLimitInputError(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'Vui lượng nhập số lượng âm tđi da cho phép.';
  if (!/^\d+$/.test(text)) return 'Số lượng âm tđi da phđi l? s? nguyđơn không âm.';
  const number = Number(text);
  if (!Number.isInteger(number) || number < 0) return 'Số lượng âm tđi da phđi l? s? nguyđơn không âm.';
  return '';
}

function buildNegativeStockSaveSignature(enabled, limit) {
  const number = Number(limit);
  const normalizedLimit = Number.isInteger(number) && number >= 0 ? number : '';
  return `${enabled ? '1' : '0'}:${normalizedLimit}`;
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

export default function Settings({ store, onStoreChange, permissions = [], user = null }) {
  const mountedRef = useRef(true);
  const noticeTimersRef = useRef({});
  const negativeStockAutosaveTimerRef = useRef(null);
  const negativeStockLastSavedRef = useRef(buildNegativeStockSaveSignature(
    normalizeNegativeStockSettings().enabled,
    normalizeNegativeStockSettings().limit,
  ));
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
    (required = []) => {
      if (user?.role === 'admin') return true;
      return !hasExplicitPermissions || hasAnyPermission(permissionSet, required);
    },
    [hasExplicitPermissions, permissionSet, user],
  );
  const canViewStore = canAccessSection(['store.read', 'store.manage']);
  const canManageStore = canAccessSection(['store.manage']);
  const canViewEmployees = canAccessSection(['users.read', 'users.manage']);
  const canManageEmployees = canAccessSection(['users.manage']);
  const canViewCustomerTypes = canAccessSection(['customers.read', 'customers.manage']);
  const canManageCustomerTypes = canAccessSection(['customers.manage']);
  const canViewNegativeStock = canAccessSection(['settings.read', 'settings.manage', 'features.read', 'features.manage']);
  const canManageNegativeStock = canAccessSection(['settings.manage', 'features.manage']);
  const canViewUpdates = canAccessSection(['updates.read', 'updates.manage', 'settings.read', 'settings.manage']);
  const canViewPrintTemplates = canAccessSection(['print_templates.read', 'print_templates.manage']);
  const canManagePrintTemplates = canAccessSection(['print_templates.manage']);

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

  const [negativeStockSettings, setNegativeStockSettings] = useState(() => normalizeNegativeStockSettings());
  const [negativeStockLimitInput, setNegativeStockLimitInput] = useState(() => String(normalizeNegativeStockSettings().limit));
  const [negativeStockSaving, setNegativeStockSaving] = useState(false);
  const [negativeStockNotice, setNegativeStockNotice] = useState(null);

  const [appInfo, setAppInfo] = useState(null);
  const [updateState, setUpdateState] = useState(null);
  const [updateBusy, setUpdateBusy] = useState('');
  const [updateResult, setUpdateResult] = useState(null);
  const [updateNotice, setUpdateNotice] = useState('');

  const [printTemplates, setPrintTemplates] = useState([]);
  const [printTemplatesLoading, setPrintTemplatesLoading] = useState(false);
  const [printTemplatesNotice, setPrintTemplatesNotice] = useState(null);
  const [showPrintTemplateModal, setShowPrintTemplateModal] = useState(false);
  const [printTemplateEdit, setPrintTemplateEdit] = useState(null);
  const [printTemplateForm, setPrintTemplateForm] = useState(() => normalizePrintTemplateForm({}, store));
  const [printTemplateSaving, setPrintTemplateSaving] = useState(false);
  const [printTemplateNotice, setPrintTemplateNotice] = useState(null);
  const [printTemplateLogoFile, setPrintTemplateLogoFile] = useState(null);
  const [printTemplateLogoPreviewUrl, setPrintTemplateLogoPreviewUrl] = useState('');

  const [backupStatus, setBackupStatus] = useState(null);
  const [backupItems, setBackupItems] = useState([]);
  const [backupLogs, setBackupLogs] = useState([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupNotice, setBackupNotice] = useState(null);
  const [restoringBackup, setRestoringBackup] = useState('');

  const [recoveryStatus, setRecoveryStatus] = useState(null);
  const [recoveryRunning, setRecoveryRunning] = useState(false);
  const [isScanningBackup, setIsScanningBackup] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [isUnlockingRestore, setIsUnlockingRestore] = useState(false);
  const [recoveryFoundFiles, setRecoveryFoundFiles] = useState([]);
  const [selectedRecoveryFilePaths, setSelectedRecoveryFilePaths] = useState([]);
  const [recoveryFilter, setRecoveryFilter] = useState('main');
  const [recoveryLogs, setRecoveryLogs] = useState([]);
  const [recoveryNotice, setRecoveryNotice] = useState(null);
  const [recoveryLogDetail, setRecoveryLogDetail] = useState(null);

  const recoveryFiles = Array.isArray(recoveryFoundFiles) ? recoveryFoundFiles : [];
  const recoveryBusy = recoveryRunning || isScanningBackup || isRestoringBackup || isUnlockingRestore;
  const visibleRecoveryFiles = recoveryFiles.filter(file => {
    const kind = file?.type || file?.backupType || file?.category || 'main_backup';
    if (recoveryFilter === 'all') return true;
    if (recoveryFilter === 'main') return kind === 'main_backup';
    if (recoveryFilter === 'recovery') return kind === 'recovery_point';
    return true;
  });
  const selectedRecoveryFiles = selectedRecoveryFilePaths.map(filePath => recoveryFiles.find(file => file.path === filePath)).filter(Boolean);

  const getErrorMessage = useCallback(
    (error, fallback = 'Thao t?c th?t bđi.') => getApiErrorMessage(error?.data || error, error?.message || fallback),
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

  const applyNegativeStockSettings = useCallback((payload = {}) => {
    const normalized = cacheNegativeStockSettings(payload);
    negativeStockLastSavedRef.current = buildNegativeStockSaveSignature(normalized.enabled, normalized.limit);
    if (mountedRef.current) {
      setNegativeStockSettings(normalized);
      setNegativeStockLimitInput(String(normalized.limit));
    }
    return normalized;
  }, []);

  const loadNegativeStockSettings = useCallback(async () => {
    try {
      const data = await settingsApi.get();
      if (mountedRef.current) setNegativeStockNotice(null);
      return applyNegativeStockSettings(data);
    } catch (error) {
      const message = getErrorMessage(error, 'Không thử lại cấu hình xuất âm tồn kho t? API /api/settings/negative-stock.');
      const fallbackSettings = normalizeNegativeStockSettings();
      if (mountedRef.current) {
        setNegativeStockSettings(fallbackSettings);
        setNegativeStockLimitInput(String(fallbackSettings.limit));
        setTimedNotice('negative-stock', setNegativeStockNotice, { tone: 'error', message });
      }
      return fallbackSettings;
    }
  }, [applyNegativeStockSettings, getErrorMessage, setTimedNotice]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (negativeStockAutosaveTimerRef.current) {
        window.clearTimeout(negativeStockAutosaveTimerRef.current);
        negativeStockAutosaveTimerRef.current = null;
      }
      Object.values(noticeTimersRef.current).forEach(timerId => window.clearTimeout(timerId));
      noticeTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const handleSyncUpdated = (event) => {
      const detail = event?.detail || {};
      if (detail.sourceTabId === window.__vankhaTabId) return;
      const changedTables = detail.changedTables || detail.tables || [];
      if (changedTables.includes('settings')) {
        loadNegativeStockSettings();
      }
    };
    window.addEventListener(SYNC_UPDATED_EVENT, handleSyncUpdated);
    return () => window.removeEventListener(SYNC_UPDATED_EVENT, handleSyncUpdated);
  }, [loadNegativeStockSettings]);

  const loadStore = useCallback(async () => {
    const data = await apiJson('/store', {}, 'Không thử lại thông tin cửa hàng.');
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

  const loadPrintTemplates = useCallback(async () => {
    if (mountedRef.current) setPrintTemplatesLoading(true);
    try {
      const data = await printTemplatesApi.list();
      const items = normalizePrintTemplatesResponse(data);
      if (mountedRef.current) {
        setPrintTemplates(items);
        setPrintTemplatesNotice(null);
      }
      return items;
    } catch (error) {
      const message = getErrorMessage(error, 'API mẫu in hóa đơn dang ? trạng thái an tođơn; chưa tải được danh sách mẫu in t? /api/print-templates.');
      if (mountedRef.current) {
        setPrintTemplates([]);
        setTimedNotice('print-templates', setPrintTemplatesNotice, { tone: 'info', message });
      }
      return [];
    } finally {
      if (mountedRef.current) setPrintTemplatesLoading(false);
    }
  }, [getErrorMessage, setTimedNotice]);

  const loadBackups = useCallback(async () => {
    if (mountedRef.current) setBackupLoading(true);
    try {
      const [statusData, listData] = await Promise.all([
        dataGuardianApi.status(),
        dataGuardianApi.backups({ limit: 50 }),
      ]);
      if (!mountedRef.current) return null;
      setBackupStatus(statusData?.modules?.backupScheduler || statusData?.modules?.backupTables || null);
      setBackupItems(Array.isArray(listData?.records) ? listData.records : Array.isArray(listData?.backups) ? listData.backups : []);
      setBackupLogs(Array.isArray(listData?.logs) ? listData.logs : []);
      setBackupNotice(null);
      return statusData;
    } catch (error) {
      const message = getErrorMessage(error, 'Không thử lại trạng thái backup.');
      if (mountedRef.current) setBackupNotice({ tone: 'error', message });
      return null;
    } finally {
      if (mountedRef.current) setBackupLoading(false);
    }
  }, [getErrorMessage]);

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
        ...(canViewNegativeStock ? [{ label: 'xuất âm tồn kho', promise: loadNegativeStockSettings() }] : []),
        ...(canViewPrintTemplates ? [{ label: 'mẫu in hóa đơn', promise: loadPrintTemplates() }] : []),
        ...(canAccessSection(['settings.read', 'settings.manage']) ? [{ label: 'backup', promise: loadBackups() }] : []),
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
          return `${sections[index].label}: ${getErrorMessage(result.reason, `Không thử lại ${sections[index].label}.`)}`;
        })
        .filter(Boolean);

      if (failures.length > 0) {
        setTimedNotice('page', setPageNotice, {
          tone: 'error',
          message: `Một s? dữ liệu cài đặt chưa tải được. ${failures.join(' | ')}`,
        }, 8000);
      }

      setInitialLoading(false);
    };

    initialize();

    return () => {
      cancelled = true;
    };
  }, [canViewCustomerTypes, canViewEmployees, canViewNegativeStock, canViewPrintTemplates, canViewStore, getErrorMessage, loadCustomerTypes, loadEmployees, loadNegativeStockSettings, loadPrintTemplates, loadStore, setTimedNotice]);

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
        setUpdateNotice(version ? `C? bđơn cập nhật ${version}.` : 'C? bđơn cập nhật mới.');
      }
      if (payload?.type === 'downloaded') setUpdateNotice('?? tđi về xác thực gđi cập nhật. Chọn Cập nhật ngay ho?c ?? sau.');
      if (payload?.type === 'install-deferred') setUpdateNotice('?? chọn d? sau. ứng dụng tiếp tục ch?y b?nh thuếng.');
      if (payload?.type === 'cancelled') setUpdateNotice('?? h?y tđi cập nhật.');
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

  const closePrintTemplateModal = useCallback(() => {
    setShowPrintTemplateModal(false);
    setPrintTemplateEdit(null);
    setPrintTemplateForm(normalizePrintTemplateForm({}, store));
    setPrintTemplateNotice(null);
    setPrintTemplateLogoFile(null);
    setPrintTemplateLogoPreviewUrl(current => {
      revokeObjectUrl(current);
      return '';
    });
  }, [store]);

  const updateStoreField = useCallback((field, value) => {
    setStoreDirty(true);
    setStoreForm(current => ({ ...current, [field]: value }));
  }, []);

  const handleSaveStore = async () => {
    const payload = sanitizeStorePayload(storeForm);
    if (payload.email && !isValidEmail(payload.email)) {
      setTimedNotice('store', setStoreNotice, {
        tone: 'error',
        message: 'Email cửa hàng không hợp l?.',
      }, 5000);
      return;
    }

    setStoreSaving(true);
    setStoreNotice(null);
    try {
      const data = await apiJson('/store', {
        method: 'PUT',
        body: payload,
      }, 'Không th? luu thông tin cửa hàng.');

      if (data?.ok) {
        setStoreForm(payload);
        setStoreDirty(false);
        onStoreChange?.(payload);
        setTimedNotice('store', setStoreNotice, {
          tone: 'success',
          message: '?? luu thông tin cửa hàng.',
        }, 3000);
      }
    } catch (error) {
      setTimedNotice('store', setStoreNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Không th? luu thông tin cửa hàng.'),
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
    if (!window.confirm('Xóa nhân viên n?y?')) return;

    setEmployeesNotice(null);
    try {
      const data = await apiJson(`/users/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }, 'Không th? xóa nhân viên.');
      await loadEmployees();
      setTimedNotice('employees', setEmployeesNotice, {
        tone: 'success',
        message: data?.message || '?? xóa nhân viên.',
      }, 3000);
    } catch (error) {
      setTimedNotice('employees', setEmployeesNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Không th? xóa nhân viên.'),
      });
    }
  };

  const handleSaveEmp = async () => {
    const payload = sanitizeEmployeePayload(empForm);
    const isCreating = !empEdit;

    if (!payload.name || !payload.email || !payload.phone) {
      setEmpNotice({ tone: 'error', message: 'Vui lòng diđơn đầy đủ h? tđơn, email về s? điện thoại.' });
      return;
    }
    if (!isValidEmail(payload.email)) {
      setEmpNotice({ tone: 'error', message: 'Email nhân viên không hợp l?.' });
      return;
    }
    if (isCreating && !payload.password) {
      setEmpNotice({ tone: 'error', message: 'Vui lượng nhập mật khẩu cho nhân viên mới.' });
      return;
    }
    if (payload.password && String(payload.password).length < 8) {
      setEmpNotice({ tone: 'error', message: 'Mật khẩu phđi c? ?t nh?t 8 kỳ t?.' });
      return;
    }

    setEmpSaving(true);
    setEmpNotice(null);
    try {
      if (empEdit) {
        await usersApi.update(empEdit.id, payload);
      } else {
        const created = await apiJson('/users/register', {
          method: 'POST',
          body: payload,
        }, 'Không th? tạo nhân viên mới.');
        const createdId = created?.user?.id || created?.id;
        if (createdId && payload.role && payload.role !== 'user') {
          await usersApi.update(createdId, { role: payload.role });
        }
      }

      await loadEmployees();
      closeEmpModal();
      setTimedNotice('employees', setEmployeesNotice, {
        tone: 'success',
        message: empEdit ? '?? cập nhật nhân viên.' : '?? thêm nhân viên mới.',
      }, 3000);
    } catch (error) {
      setEmpNotice({
        tone: 'error',
        message: getErrorMessage(error, empEdit ? 'Không th? cập nhật nhân viên.' : 'Không th? tạo nhân viên mới.'),
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
      setTypeNotice({ tone: 'error', message: 'Vui lượng nhập tđơn loại khách hàng.' });
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
        message: typeEdit ? '?? cập nhật loại khách hàng.' : '?? thêm loại khách hàng mới.',
      }, 3000);
    } catch (error) {
      setTypeNotice({
        tone: 'error',
        message: getErrorMessage(error, typeEdit ? 'Không th? cập nhật loại khách hàng.' : 'Không th? tạo loại khách hàng.'),
      });
    } finally {
      if (mountedRef.current) setTypeSaving(false);
    }
  };

  const handleDeleteType = async (id) => {
    if (!window.confirm('Xóa loại khách n?y?')) return;

    setCustomerTypesNotice(null);
    try {
      await customerTypesApi.remove(id);
      await loadCustomerTypes();
      setTimedNotice('customer-types', setCustomerTypesNotice, {
        tone: 'success',
        message: '?? xóa loại khách hàng.',
      }, 3000);
    } catch (error) {
      setTimedNotice('customer-types', setCustomerTypesNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Không th? xóa loại khách hàng.'),
      });
    }
  };

  const updatePrintTemplateField = useCallback((field, value) => {
    setPrintTemplateForm(current => {
      const next = { ...current, [field]: value };
      if (field === 'paper_size' && String(value).toUpperCase().startsWith('K')) next.orientation = 'portrait';
      return next;
    });
  }, []);

  const openAddPrintTemplate = async () => {
    if (!canManagePrintTemplates) return;
    setPrintTemplateSaving(true);
    setPrintTemplatesNotice(null);
    try {
      const data = await printTemplatesApi.create({
        template_name: `Mẫu in hóa đơn ${printTemplates.length + 1}`,
        description: 'Thi?t kỳ bằng editor mẫu in Canva-like.',
        shop_name: storeForm.name,
        shop_address: storeForm.address,
        shop_phone: storeForm.phone,
        paper_size: 'A5',
        orientation: 'portrait',
        status: 'draft',
        is_default: printTemplates.length === 0,
      });
      const saved = data?.item || data?.data || data;
      await loadPrintTemplates();
      setPrintTemplateEdit(saved);
      setShowPrintTemplateModal(true);
      setTimedNotice('print-templates', setPrintTemplatesNotice, {
        tone: 'success',
        message: '?? tạo mẫu in mới. Editor đang mã ?? thi?t kỳ, bâm Lđủ ho?c Publish ?? lđủ.'
      }, 3000);
    } catch (error) {
      setTimedNotice('print-templates', setPrintTemplatesNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Không th? tạo mẫu in hóa đơn.'),
      });
    } finally {
      if (mountedRef.current) setPrintTemplateSaving(false);
    }
  };

  const openDemoPrintTemplateEditor = () => {
    const demo = normalizePrintTemplate({
      id: null,
      template_name: 'Mđủ thi?t kỳ th?',
      description: 'Bản demo local d? thi?t kỳ kỳo th? khi chưa c? MySQL mẫu in.',
      shop_name: storeForm.name,
      shop_address: storeForm.address,
      shop_phone: storeForm.phone,
      paper_size: 'A5',
      orientation: 'portrait',
      status: 'draft',
      is_default: false,
      revision: 1,
    });
    setPrintTemplateEdit({ ...demo, local_demo: true });
    setPrintTemplateNotice(null);
    setShowPrintTemplateModal(true);
    setTimedNotice('print-templates', setPrintTemplatesNotice, {
      tone: 'info',
      message: 'đang mã editor demo local. ?? luu/publish th?t, h?y cấu hình MySQL về tạo mẫu in trđơn server.',
    }, 5000);
  };

  const openEditPrintTemplate = (template) => {
    setPrintTemplateEdit(template);
    setPrintTemplateNotice(null);
    setShowPrintTemplateModal(true);
  };

  const handlePrintTemplateEditorSaved = useCallback((template) => {
    if (!template) return;
    const item = normalizePrintTemplate(template);
    setPrintTemplateEdit(template);
    setPrintTemplates(current => {
      if (!Array.isArray(current) || current.length === 0) return [item];
      const exists = current.some(row => String(row.id) === String(item.id));
      if (!exists) return [item, ...current];
      return current.map(row => (String(row.id) === String(item.id) ? { ...row, ...item } : row));
    });
  }, []);

  const handlePrintTemplateLogoChange = (event) => {
    const file = event.target.files?.[0] || null;
    setPrintTemplateLogoFile(file);
    setPrintTemplateLogoPreviewUrl(current => {
      revokeObjectUrl(current);
      return file ? window.URL.createObjectURL(file) : '';
    });
  };

  const handleRemovePrintTemplateLogo = async () => {
    if (printTemplateEdit?.id && !printTemplateLogoPreviewUrl && printTemplateForm.logo_url) {
      if (!window.confirm('Xóa logo dang luu trđơn mẫu in n?y?')) return;
      setPrintTemplateSaving(true);
      setPrintTemplateNotice(null);
      try {
        const data = await printTemplatesApi.removeLogo(printTemplateEdit.id);
        const item = normalizePrintTemplate(data?.item || data?.data || data);
        setPrintTemplateEdit(item);
        setPrintTemplateForm(current => ({ ...normalizePrintTemplateForm(item, storeForm), logo_url: '' }));
        await loadPrintTemplates();
        setPrintTemplateNotice({ tone: 'success', message: '?? xóa logo mẫu in.' });
      } catch (error) {
        setPrintTemplateNotice({ tone: 'error', message: getErrorMessage(error, 'Không th? xóa logo mẫu in.') });
      } finally {
        if (mountedRef.current) setPrintTemplateSaving(false);
      }
      return;
    }

    setPrintTemplateLogoFile(null);
    setPrintTemplateLogoPreviewUrl(current => {
      revokeObjectUrl(current);
      return '';
    });
    setPrintTemplateForm(current => ({ ...current, logo_url: '' }));
  };

  const handleSavePrintTemplate = async () => {
    const payload = sanitizePrintTemplatePayload(printTemplateForm);
    if (!payload.template_name) {
      setPrintTemplateNotice({ tone: 'error', message: 'Vui lượng nhập tđơn mẫu in hóa đơn.' });
      return;
    }

    setPrintTemplateSaving(true);
    setPrintTemplateNotice(null);
    try {
      let data;
      if (printTemplateEdit?.id) data = await printTemplatesApi.update(printTemplateEdit.id, payload);
      else data = await printTemplatesApi.create(payload);

      let saved = normalizePrintTemplate(data?.item || data?.data || data);
      if (printTemplateLogoFile && saved.id) {
        const logoData = await printTemplatesApi.uploadLogo(saved.id, printTemplateLogoFile);
        saved = normalizePrintTemplate(logoData?.item || logoData?.data || logoData);
      }

      await loadPrintTemplates();
      closePrintTemplateModal();
      setTimedNotice('print-templates', setPrintTemplatesNotice, {
        tone: 'success',
        message: printTemplateEdit?.id ? '?? cập nhật mẫu in hóa đơn.' : '?? tạo mẫu in hóa đơn mới.',
      }, 3000);
    } catch (error) {
      setPrintTemplateNotice({
        tone: 'error',
        message: getErrorMessage(error, printTemplateEdit?.id ? 'Không th? cập nhật mẫu in hóa đơn.' : 'Không th? tạo mẫu in hóa đơn.'),
      });
    } finally {
      if (mountedRef.current) setPrintTemplateSaving(false);
    }
  };

  const handleDeletePrintTemplate = async (template) => {
    if (!window.confirm(`Xóa mẫu in "${template.template_name || template.name || ''}"?`)) return;
    setPrintTemplatesNotice(null);
    try {
      await printTemplatesApi.remove(template.id);
      await loadPrintTemplates();
      setTimedNotice('print-templates', setPrintTemplatesNotice, {
        tone: 'success',
        message: '?? xóa mẫu in hóa đơn.',
      }, 3000);
    } catch (error) {
      setTimedNotice('print-templates', setPrintTemplatesNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Không th? xóa mẫu in hóa đơn.'),
      });
    }
  };

  const handleSetDefaultPrintTemplate = async (template) => {
    setPrintTemplatesNotice(null);
    try {
      await printTemplatesApi.setDefault(template.id);
      await loadPrintTemplates();
      setTimedNotice('print-templates', setPrintTemplatesNotice, {
        tone: 'success',
        message: '?? d?t mẫu in mặc định.',
      }, 3000);
    } catch (error) {
      setTimedNotice('print-templates', setPrintTemplatesNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Không th? d?t mẫu in mặc định.'),
      });
    }
  };

  const previewTemplate = useMemo(
    () => buildPreviewPrintTemplate(printTemplateForm, printTemplateEdit, printTemplateLogoPreviewUrl),
    [printTemplateEdit, printTemplateForm, printTemplateLogoPreviewUrl],
  );

  const saveNegativeStockSettings = async ({ enabled = negativeStockSettings.enabled, limitInput = negativeStockLimitInput, successMessage = 'Luu cài đặt thành công' } = {}) => {
    let limit = 0;
    if (enabled) {
      const inputError = getNegativeStockLimitInputError(limitInput);
      if (inputError) {
        setTimedNotice('negative-stock', setNegativeStockNotice, {
          tone: 'error',
          message: inputError,
        }, 5000);
        return null;
      }
      limit = Number(String(limitInput).trim());
    } else {
      const parsed = Number(String(limitInput).trim());
      limit = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
    }

    const nextSignature = buildNegativeStockSaveSignature(Boolean(enabled), limit);
    if (nextSignature === negativeStockLastSavedRef.current) {
      if (enabled) {
        setNegativeStockLimitInput(String(limit));
      }
      const normalized = normalizeNegativeStockSettings({
        ...negativeStockSettings,
        negative_stock_enabled: Boolean(enabled),
        negative_stock_limit: limit,
      });
      setTimedNotice('negative-stock', setNegativeStockNotice, {
        tone: 'success',
        message: successMessage,
      }, 2500);
      return normalized;
    }

    setNegativeStockSaving(true);
    setNegativeStockNotice(null);
    try {
      const payload = {
        negative_stock_enabled: Boolean(enabled),
        negative_stock_limit: limit,
      };
      const data = await settingsApi.update(payload);
      const normalized = applyNegativeStockSettings({ ...payload, ...(data || {}) });
      setTimedNotice('negative-stock', setNegativeStockNotice, {
        tone: 'success',
        message: successMessage,
      }, 3000);
      return normalized;
    } catch (error) {
      setTimedNotice('negative-stock', setNegativeStockNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Không th? luu cấu hình xuất âm tồn kho qua API /api/settings/negative-stock.'),
      });
      return null;
    } finally {
      if (mountedRef.current) setNegativeStockSaving(false);
    }
  };

  const handleToggleNegativeStock = () => {
    const nextEnabled = !negativeStockSettings.enabled;
    let nextLimitInput = negativeStockLimitInput;
    if (nextEnabled && getNegativeStockLimitInputError(nextLimitInput)) {
      nextLimitInput = '10';
      setNegativeStockLimitInput('10');
    }
    return saveNegativeStockSettings({
      enabled: nextEnabled,
      limitInput: nextLimitInput,
      successMessage: nextEnabled ? '?? bắt ch? d? xuất âm' : '?? tốt ch? d? xuất âm',
    });
  };

  const handleNegativeStockLimitChange = (event) => {
    const nextValue = event.target.value;
    if (nextValue === '' || /^\d+$/.test(nextValue)) setNegativeStockLimitInput(nextValue);
  };

  const handleNegativeStockLimitBlur = () => {
    setNegativeStockLimitInput(current => normalizeNegativeStockLimitInput(current));
  };

  const handleSaveNegativeStockSettings = () => saveNegativeStockSettings();

  useEffect(() => {
    if (!canManageNegativeStock || initialLoading || negativeStockSaving || !negativeStockSettings.enabled) return undefined;

    const inputError = getNegativeStockLimitInputError(negativeStockLimitInput);
    if (inputError) return undefined;

    const limit = Number(String(negativeStockLimitInput).trim());
    const nextSignature = buildNegativeStockSaveSignature(negativeStockSettings.enabled, limit);
    if (nextSignature === negativeStockLastSavedRef.current) return undefined;

    if (negativeStockAutosaveTimerRef.current) {
      window.clearTimeout(negativeStockAutosaveTimerRef.current);
      negativeStockAutosaveTimerRef.current = null;
    }

    negativeStockAutosaveTimerRef.current = window.setTimeout(() => {
      negativeStockAutosaveTimerRef.current = null;
      saveNegativeStockSettings({
        enabled: negativeStockSettings.enabled,
        limitInput: String(limit),
        successMessage: 'Luu cài đặt thành công',
      });
    }, 700);

    return () => {
      if (negativeStockAutosaveTimerRef.current) {
        window.clearTimeout(negativeStockAutosaveTimerRef.current);
        negativeStockAutosaveTimerRef.current = null;
      }
    };
  }, [canManageNegativeStock, initialLoading, negativeStockLimitInput, negativeStockSaving, negativeStockSettings.enabled]);

  const runUpdateAction = async (busyKey, action) => {
    if (!window.khaDesktop?.updates) {
      setUpdateNotice('T?nh nang cập nhật ch? kh? d?ng trong ứng dụng Electron Windows.');
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
        setUpdateNotice(result.updateAvailable ? `C? bđơn cập nhật ${result.updateInfo?.version}.` : 'ứng dụng dang ? phiđơn bđơn mới nh?t.');
      } else if (busyKey === 'downloading') {
        setUpdateNotice('?? tđi về xác thực gđi cập nhật. Chọn Cập nhật ngay ho?c ?? sau.');
      } else if (busyKey === 'installing') {
        setUpdateNotice('đang cài đặt cập nhật. ứng dụng s? restart theo electron-updater.');
      }
      return result;
    } catch (error) {
      const nextError = {
        code: error?.code || 'UNKNOWN_ERROR',
        message: error?.message || '?? x?y ra lỗi cập nhật.',
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
    if (!window.confirm('ứng dụng s? tạo backup database rđi cài đặt về khởi động lại. Tiếp tục?')) return null;
    return runUpdateAction('installing', updates => updates.install());
  };

  const handleOpenInstallerDownload = async (installer) => {
    const url = buildReleaseDownloadUrl(installer.fileName);
    setUpdateNotice(`đang kiểm tra link tđi ${installer.label} trước khi mã tr?nh duy?t...`);

    try {
      let verified = null;
      if (window.khaDesktop?.verifyDownloadUrl) {
        verified = await window.khaDesktop.verifyDownloadUrl(url);
        if (!verified?.ok) throw new Error(verified?.error?.message || 'Link tđi không vu?t qua kiểm tra an tođơn.');
      }

      const detail = verified?.contentLength
        ? `HTTP ${verified.statusCode}, ${formatBytes(verified.contentLength)}, ${verified.contentType || 'Content-Type không r?'}`
        : '?? kiểm tra định dạngg tđơn file về HTTP.';
      setUpdateNotice(`Link tđi ${installer.label} hợp lệ (${detail}). đang mã tr?nh duy?t mặc định. Nếu SmartScreen/antivirus cảnh báo, ch? tiếp tục khi file d?ng tđơn ${installer.fileName} về URL thuếc github.com/Vankhadev/phanmemoffline.`);

      if (window.khaDesktop?.openExternal) {
        const opened = await window.khaDesktop.openExternal(url);
        if (!opened?.ok) throw new Error(opened?.error?.message || 'Không mã được link tđi bằng tr?nh duy?t mặc định.');
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      setUpdateNotice(`Không mã link tđi về kiểm tra th?t bđi: ${error?.message || 'không r?'}. Hủy kiểm tra mãng, GitHub Release public về dâm b?o không tđi nhâm file r?ng/trang HTML. URL: ${url}`);
    }
  };

  const tabs = useMemo(() => {
    const nextTabs = [];
    if (canViewStore) nextTabs.push({ key: 'store', label: 'Cửa hàng', icon: <Store size={16} /> });
    if (canViewEmployees) nextTabs.push({ key: 'employees', label: 'Nhân viên', icon: <Users size={16} /> });
    if (canViewCustomerTypes) nextTabs.push({ key: 'customer-types', label: 'Loại khách', icon: <Tag size={16} /> });
    if (canViewNegativeStock) nextTabs.push({ key: 'negative-stock', label: 'Xuất âm', icon: <Package size={16} /> });
    if (canViewPrintTemplates) nextTabs.push({ key: 'print-templates', label: 'Mẫu in hóa đơn', icon: <FileText size={16} /> });
    if (canAccessSection(['settings.read', 'settings.manage'])) nextTabs.push({ key: 'backup', label: 'Backup', icon: <Image size={16} /> });
    if (canAccessSection(['settings.read', 'settings.manage'])) nextTabs.push({ key: 'recovery', label: 'Khôi phục DL', icon: <RotateCcw size={16} /> });
    if (canViewUpdates) nextTabs.push({ key: 'updates', label: 'Cập nhật', icon: <Settings2 size={16} /> });
    return nextTabs;
  }, [canAccessSection, canViewCustomerTypes, canViewEmployees, canViewNegativeStock, canViewPrintTemplates, canViewStore, canViewUpdates]);

  useEffect(() => {
    if (!tabs.length) return;
    if (tabs.some(item => item.key === tab)) return;
    setTab(tabs[0].key);
  }, [tab, tabs]);

  const desktopAvailable = Boolean(window.khaDesktop?.isElectron && window.khaDesktop?.updates);
  const runtimeCompatibility = updateState?.runtimeCompatibility || appInfo?.runtimeCompatibility || null;
  const runtimeArch = normalizeRuntimeArch(runtimeCompatibility?.arch || appInfo?.arch || window.khaDesktop?.arch || '');
  const recommendedInstaller = getRecommendedInstaller(runtimeArch);
  const currentVersion = appInfo?.version || updateState?.currentVersion || 'Không r?';
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
  const negativeStockLimitInputError = getNegativeStockLimitInputError(negativeStockLimitInput);
  const negativeStockPreviewLimit = negativeStockLimitInputError ? negativeStockSettings.limit : Number(negativeStockLimitInput);
  const negativeStockPreviewSettings = normalizeNegativeStockSettings({
    ...negativeStockSettings,
    negative_stock_enabled: negativeStockSettings.enabled,
    negative_stock_limit: negativeStockPreviewLimit,
  });
  const negativeStockAdminLimitLabel = getNegativeStockAdminLimitLabel(negativeStockPreviewSettings);
  const negativeStockRuntimeLimitLabel = getNegativeStockLimitLabel(negativeStockPreviewSettings);
  const negativeStockRuntimeSummary = getNegativeStockRuntimeSummary(negativeStockPreviewSettings);

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
              Quản lý cửa hàng, nhân viên, loại khách hàng, xuất âm tồn kho về cập nhật ứng dụng.
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
            <span>đang tđi dữ liệu cài đặt...</span>
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
              label="Tồn cửa hàng"
              value={storeForm.name}
              onChange={event => updateStoreField('name', event.target.value)}
              placeholder="V? d?: Cửa hàng Vđơn Kha"
            />
            <InputField
              id="store-phone"
              label="S? điện thoại"
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
              label="M? s? thuế"
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
              {storeSaving ? 'đang luu...' : 'Luu thay đổi'}
            </button>
            <span className="text-xs text-gray-500">
              Các thay đổi n?y đơnh hu?ng trực tiếp đến thông tin hiển thị trđơn hóa đơn về các trang d?ng dữ liệu cửa hàng.
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
                đang tđi danh sách nhân viên...
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
                    <th className="px-3 py-3 text-left">H? tđơn</th>
                    <th className="px-3 py-3 text-left">Email</th>
                    <th className="px-3 py-3 text-left">S?T</th>
                    <th className="px-3 py-3 text-left">Vai tr?</th>
                    <th className="px-3 py-3 text-left">đang nh?p gđơn nh?t</th>
                    <th className="px-3 py-3 text-center">H?nh d?ng</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(employee => (
                    <tr key={employee.id} className="border-t hover:bg-gray-50">
                      <td className="px-3 py-3 font-medium text-gray-800">{employee.name || '?'}</td>
                      <td className="px-3 py-3 text-gray-600">{employee.email || '?'}</td>
                      <td className="px-3 py-3">{employee.phone || '?'}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getRoleBadgeClass(employee.role)}`}>
                          {getRoleOption(employee.role).label}
                        </span>
                        {normalizeRoleValue(employee.role) === 'user' && (
                          <div className="mt-1 text-[11px] text-gray-400">Legacy tuong th?ch</div>
                        )}
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
                          <span className="block text-center text-xs text-gray-400">?</span>
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
                đang tđi loại khách hàng...
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
                      <span className="text-xs text-gray-400">?</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!initialLoading && tab === 'negative-stock' && (
        <div className="card space-y-5 overflow-hidden border-white/60 bg-white/75 shadow-2xl shadow-emerald-900/10 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/80 dark:text-slate-100">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-bold flex items-center gap-2">
                <Package size={18} /> {NEGATIVE_STOCK_FEATURE_NAME}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                Quản lý vi?c cho phép xu?t vu?t tồn kho hiện c?. {NEGATIVE_STOCK_FEATURE_DESCRIPTION}
              </p>
            </div>
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${negativeStockSettings.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>
              <span className={`h-2 w-2 rounded-full ${negativeStockSettings.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              {negativeStockSettings.enabled ? 'đang bắt' : 'đang tốt'}
            </span>
          </div>

          <SectionNotice notice={negativeStockNotice} />

          <div className="rounded-3xl border border-white/70 bg-white/70 p-4 shadow-xl shadow-emerald-900/10 backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="font-semibold text-gray-800 dark:text-slate-100">Cho ph?p xuất âm tồn kho sản phẩm</div>
                <p className="text-sm text-gray-600 dark:text-slate-300">
                  Khi bắt, hệ thống cho phép xu?t vu?t tồn kho hiện c? theo số lượng âm tđi da admin nh?p. Khi tốt, hệ thống chọn mới tru?ng hợp lệm tồn kho nh? hon <strong>0</strong>.
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={negativeStockSettings.enabled}
                aria-label={negativeStockSettings.enabled ? 'Tốt cho phép xuất âm tồn kho' : 'Bắt cho phép xuất âm tồn kho'}
                aria-busy={negativeStockSaving}
                onClick={handleToggleNegativeStock}
                disabled={negativeStockSaving || !canManageNegativeStock || (negativeStockSettings.enabled && Boolean(negativeStockLimitInputError))}
                className={`inline-flex min-h-14 w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left shadow-sm transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${negativeStockSettings.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'} disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      {negativeStockSettings.enabled ? 'đang bắt' : 'đang tốt'}
                    </span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${negativeStockSettings.enabled ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'}`}>
                      {negativeStockSettings.enabled ? 'ON' : 'OFF'}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs font-medium opacity-80">
                    {negativeStockSaving ? 'đang luu thay đổi...' : 'Châm d? bắt/tốt nhanh'}
                  </span>
                </span>

                <span className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors duration-200 ease-out ${negativeStockSettings.enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'} ${negativeStockSaving ? 'opacity-90' : ''}`}>
                  <span className={`h-6 w-6 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-all duration-200 ease-out ${negativeStockSettings.enabled ? 'translate-x-6' : 'translate-x-0'} ${negativeStockSaving ? 'scale-95' : ''}`} />
                  {negativeStockSaving && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <Loader2 size={14} className="animate-spin text-white/90" />
                    </span>
                  )}
                </span>
              </button>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label htmlFor="negative-stock-limit" className="space-y-1">
                  <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">Số lượng âm tđi da cho phép</span>
                  <input
                    id="negative-stock-limit"
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={negativeStockLimitInput}
                    onChange={handleNegativeStockLimitChange}
                    onBlur={handleNegativeStockLimitBlur}
                    placeholder="V? d?: 10"
                    disabled={negativeStockSaving || !canManageNegativeStock}
                    aria-invalid={Boolean(negativeStockLimitInputError)}
                    className={`input-field w-full rounded-xl ${negativeStockLimitInputError ? 'border-red-300 bg-red-50 text-red-700 focus:border-red-500 focus:ring-red-500/20' : 'dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100'}`}
                  />
                  {negativeStockLimitInputError ? (
                    <span className="block text-xs font-medium text-red-600">{negativeStockLimitInputError}</span>
                  ) : (
                    <span className="block text-xs text-gray-500 dark:text-slate-400">Nhập 10 nghia l? tđơn tđi thiđủ -10. Gi? tr? hiện tại: {negativeStockAdminLimitLabel}; runtime d?ng tđơn tđi thiđủ {negativeStockRuntimeLimitLabel}.</span>
                  )}
                </label>

                <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
                  <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Giđi hđơn hiện tại</div>
                  <div className="mt-1 text-lg font-bold">{negativeStockAdminLimitLabel} ? tđơn tđi thiđủ {negativeStockRuntimeLimitLabel}</div>
                  <div className="mt-1 text-xs">{negativeStockRuntimeSummary}</div>
                </div>
              </div>
            </div>

            {canManageNegativeStock && (
              <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row dark:border-slate-800">
                <button
                  type="button"
                  onClick={handleSaveNegativeStockSettings}
                  disabled={negativeStockSaving || Boolean(negativeStockLimitInputError)}
                  className="btn-success inline-flex min-h-10 items-center justify-center gap-2 disabled:opacity-60"
                >
                  {negativeStockSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                  {negativeStockSaving ? 'đang luu...' : 'Luu giới hạn'}
                </button>
                <button
                  type="button"
                  onClick={loadNegativeStockSettings}
                  disabled={negativeStockSaving}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Tải lỗi t? API
                </button>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
            <div className="font-semibold">Nguyđơn t?c ?p d?ng</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Khi tốt: backend không cho xu?t nđủ tđơn d? kiđơn nh? hon 0.</li>
              <li>Khi bắt: admin nh?p {negativeStockAdminLimitLabel}, backend cho phép tđơn sau xu?t giám tđi da đến {negativeStockRuntimeLimitLabel}.</li>
              <li>Nếu vu?t giới hạn, backend trở lại r? tđơn sản phẩm, tđơn hiện tại, số lượng xu?t về giới hạn tđi thiđủ.</li>
              <li>Frontend d?c/ghi trực tiếp qua API /api/settings/negative-stock về không cón d?ng giới hạn hard-code.</li>
            </ul>
          </div>

          {!canManageNegativeStock && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Tài khoản hiện tại ch? c? quyđơn xem trạng thái xuất âm tồn kho về không th? thay đổi cấu hình n?y.
            </div>
          )}
        </div>
      )}

      {!initialLoading && tab === 'print-templates' && (
        <div className="card space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-bold flex items-center gap-2">
                <FileText size={18} /> Mẫu in hóa đơn ({printTemplates.length})
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Quản lý mẫu in d?ng cho hóa đơn th?t qua API /api/print-templates, editor Canva-like kỳo th?, resize, publish sang layout in th?t.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadPrintTemplates}
                disabled={printTemplatesLoading}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                <Loader2 size={14} className={printTemplatesLoading ? 'animate-spin' : ''} /> Tải lỗi
              </button>
              {canManagePrintTemplates && (
                <button type="button" onClick={openAddPrintTemplate} disabled={printTemplateSaving} className="btn-primary inline-flex min-h-10 items-center gap-2 text-sm disabled:opacity-60">
                  {printTemplateSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Thêm mẫu in
                </button>
              )}
            </div>
          </div>

          <SectionNotice notice={printTemplatesNotice} />

          {printTemplatesLoading ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
              <div className="inline-flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" /> đang tđi danh sách mẫu in...
              </div>
            </div>
          ) : printTemplates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
              {canManagePrintTemplates && (
                <div className="mb-4 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={openDemoPrintTemplateEditor} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100">
                    <Edit2 size={14} /> Thi?t kỳ th?
                  </button>
                </div>
              )}
              Chưa có mẫu in hóa đơn. Nhấn "Thêm mẫu in" để tạo mẫu đầu tiên.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {printTemplates.map(template => (
                <div key={template.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-gray-900">{template.template_name || template.name || 'Mẫu in hóa đơn'}</h3>
                        {template.is_default && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700"><Star size={12} /> Mặc định</span>}
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{template.paper_size} ? {template.orientation === 'landscape' ? 'Ngang' : 'D?c'}</span>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">{template.description || template.shop_name || 'Không có mã t?.'}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                        <span>Font {template.settings.fontSize}pt</span>
                        <span>Scale {Math.round(template.settings.scale * 100)}%</span>
                        <span>Padding {template.settings.paddingMm}mm</span>
                        <span>Bằng {template.settings.tableWidthPercent}%</span>
                      </div>
                    </div>
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-slate-50 text-slate-400">
                      {template.logo_url ? <img src={template.logo_url} alt="Logo mẫu in" className="h-full w-full object-contain" /> : <Image size={20} />}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {canManagePrintTemplates ? (
                      <>
                        <button type="button" onClick={() => openEditPrintTemplate(template)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100">
                          <Edit2 size={12} /> M? editor
                        </button>
                        {!template.is_default && (
                          <button type="button" onClick={() => handleSetDefaultPrintTemplate(template)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100">
                            <Star size={12} /> ??t mặc định
                          </button>
                        )}
                        <button type="button" onClick={() => handleDeletePrintTemplate(template)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-100">
                          <Trash2 size={12} /> Xóa
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">Tài khoản ch? c? quyđơn xem mẫu in.</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!initialLoading && tab === 'backup' && (
        <div className="space-y-4">
          <div className="card space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="font-bold flex items-center gap-2">
                  <Image size={18} /> Quản lý Backup
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Backup d?nh kỳ mới 72 giá, giá tđi da 30 bđơn gđơn nh?t, nđơn ZIP về luu lịch sử vào bằng system_backups / backup_logs.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={loadBackups} disabled={backupLoading} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                  <Loader2 size={16} className={backupLoading ? 'animate-spin' : ''} /> Tải lỗi
                </button>
                <button type="button" onClick={async () => { setBackupNotice(null); try { await dataGuardianApi.backupNow(); await loadBackups(); setBackupNotice({ tone: 'success', message: '?? tạo backup th? c?ng.' }); } catch (error) { setBackupNotice({ tone: 'error', message: getErrorMessage(error, 'Không th? tạo backup th? c?ng.') }); } }} disabled={backupLoading} className="btn-success inline-flex min-h-10 items-center gap-2 disabled:opacity-60">
                  <CheckCircle size={16} /> Backup ngay
                </button>
              </div>
            </div>

            <SectionNotice notice={backupNotice} />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-xl border bg-gray-50 p-4"><div className="text-xs text-gray-500">Lần backup gần nhất</div><div className="mt-1 font-bold text-gray-900">{backupStatus?.lastBackupAt || 'Chưa có'}</div></div>
              <div className="rounded-xl border bg-gray-50 p-4"><div className="text-xs text-gray-500">Lần backup kế tiếp</div><div className="mt-1 font-bold text-gray-900">{backupStatus?.nextBackupAt || 'Chưa xác định'}</div></div>
              <div className="rounded-xl border bg-gray-50 p-4"><div className="text-xs text-gray-500">Tổng s? file</div><div className="mt-1 font-bold text-gray-900">{backupStatus?.totalBackups ?? backupItems.length}</div></div>
              <div className="rounded-xl border bg-gray-50 p-4"><div className="text-xs text-gray-500">Trạng thái</div><div className="mt-1 font-bold text-gray-900">{backupStatus?.scheduleRunning ? 'Đang chạy' : 'Đang dừng'}</div></div>
            </div>
          </div>

          <div className="card space-y-4">
            <h3 className="font-bold">Danh sách backup</h3>
            <div className="overflow-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Tồn file</th>
                    <th className="px-4 py-3">Ngày tạo</th>
                    <th className="px-4 py-3">K?ch thuếc</th>
                    <th className="px-4 py-3">Loại</th>
                    <th className="px-4 py-3">Trạng thái</th>
                    <th className="px-4 py-3 text-right">Thao t?c</th>
                  </tr>
                </thead>
                <tbody>
                  {backupItems.map(item => (
                    <tr key={item.path || item.file} className="border-t">
                      <td className="px-4 py-3 font-medium text-gray-800">{item.file || item.backup_name || '?'}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDateTime(item.mtime || item.created_at)}</td>
                      <td className="px-4 py-3 text-gray-600">{formatBytes(item.size || item.file_size)}</td>
                      <td className="px-4 py-3 text-gray-600">{item.tier || item.backup_type || 'scheduled'}</td>
                      <td className="px-4 py-3 text-gray-600">{item.status || 'success'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button type="button" className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium hover:bg-gray-50" onClick={() => window.open(resolveApiUrl(`/data-guardian/download?path=${encodeURIComponent(item.path || '')}`), '_blank')}>Tải xu?ng</button>
                          <button type="button" className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100" onClick={async () => { if (!window.confirm(`Khởi ph?c t? backup ${item.file || item.backup_name}?`)) return; setRestoringBackup(item.path); try { await dataGuardianApi.restore({ path: item.path }); setBackupNotice({ tone: 'success', message: '?? khôi phục backup.' }); await loadBackups(); } catch (error) { setBackupNotice({ tone: 'error', message: getErrorMessage(error, 'Không th? khôi phục backup.') }); } finally { setRestoringBackup(''); } }} disabled={restoringBackup === item.path}>Khởi ph?c</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!backupItems.length && (
                    <tr><td colSpan="6" className="px-4 py-8 text-center text-gray-500">Chưa có backup nào.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card space-y-4">
            <h3 className="font-bold">Backup logs</h3>
            <div className="space-y-2 text-sm">
              {backupLogs.slice(0, 10).map(log => (
                <div key={log.id || `${log.created_at}-${log.backup_file}`} className="rounded-lg border bg-gray-50 px-4 py-3">
                  <div className="font-medium text-gray-800">{log.backup_file || '?'} ? {log.status || 'success'}</div>
                  <div className="text-xs text-gray-500">{formatDateTime(log.created_at)} ? {formatBytes(log.file_size)} ? {log.detail || ''}</div>
                </div>
              ))}
              {!backupLogs.length && <div className="text-gray-500">Chưa có log backup.</div>}
            </div>
          </div>
        </div>
      )}

      {!initialLoading && tab === 'recovery' && (
        <div className="space-y-4">
          <div className="card space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="font-bold flex items-center gap-2"><RotateCcw size={18} /> Khôi phục dữ liệu</h2>
                <p className="mt-1 text-sm text-gray-500">Quét toàn bộ ổ đĩa tìm backup cũ, giải nén file nén và gộp vào database hiện tại. Không ghi đè database, không mất đơn hàng. Chạy nền an toàn — giao diện vẫn phản hồi.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={async () => {
                  setRecoveryNotice(null);
                  setRecoveryRunning(true);
                  try {
                    const resp = await apiJson('/api/recovery/scan-files', { method: 'POST' });
                    setRecoveryRunning(false);
                    if (!resp.ok) { setRecoveryNotice({ tone: 'error', message: resp.message || 'Quét backup thất bại.' }); return; }
                    setRecoveryFoundFiles(resp.files || []);
                    setSelectedRecoveryFilePaths(resp.summary?.defaultSelection || (resp.files || []).slice(0, 1).map(f => f.path));
                    setRecoveryFilter((resp.summary?.mainBackupCount || 0) > 0 ? 'main' : 'recovery');
                    setRecoveryStatus(current => ({ ...(current || {}), foundFiles: resp.files || [], progress: resp.message || `Đã tìm thấy ${(resp.files || []).length} file backup.` }));
                    setRecoveryNotice({ tone: 'success', message: resp.message || `Đã tìm thấy ${(resp.files || []).length} file backup. Bấm "Bắt đầu khôi phục" để import.` });
                    try { const l = await apiJson('/api/recovery/logs?limit=10'); setRecoveryLogs(l.logs || []); } catch (_) {}
                  } catch (error) { setRecoveryRunning(false); setRecoveryNotice({ tone: 'error', message: error?.message || 'Quét backup thất bại.' }); }
                }} disabled={recoveryBusy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"><Loader2 size={16} className={recoveryRunning ? 'animate-spin' : ''} /> Quét file backup</button>
                <button type="button" onClick={async () => {
                  setIsUnlockingRestore(true);
                  try {
                    const resp = await apiJson('/api/recovery/unlock-lock', { method: 'POST' });
                    setRecoveryNotice({ tone: resp.ok ? 'success' : 'error', message: resp.message || 'Đã kiểm tra khóa restore.' });
                  } catch (error) { setRecoveryNotice({ tone: 'error', message: error?.message || 'Mở khóa restore thất bại.' }); }
                  finally { setIsUnlockingRestore(false); }
                }} disabled={recoveryBusy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-purple-300 bg-purple-50 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-60">{isUnlockingRestore ? <Loader2 size={16} className="animate-spin" /> : null} Mở khóa restore</button>
                <button type="button" onClick={async () => {
                  if (!selectedRecoveryFiles.length) { setRecoveryNotice({ tone: 'error', message: 'Hãy chọn ít nhất 1 file backup để khôi phục.' }); return; }
                  if (selectedRecoveryFiles.length > 100 && !window.confirm(`Bạn đang chọn ${selectedRecoveryFiles.length} file backup. Việc khôi phục toàn bộ có thể rất lâu. Nên chọn backup mới nhất hoặc backup theo ngày. Bạn vẫn muốn tiếp tục?`)) return;
                  if (!window.confirm(`Bắt đầu khôi phục ${selectedRecoveryFiles.length} file backup đã chọn? Database hiện tại sẽ được snapshot trước, không bị replace.`)) return;
                  setRecoveryNotice(null);
                  setRecoveryRunning(true);
                  try {
                    const resp = await apiJson('/api/recovery/restore-files', { method: 'POST', body: { files: selectedRecoveryFiles } });
                    setRecoveryRunning(false);
                    const st = await apiJson('/api/recovery/status');
                    setRecoveryStatus(st);
                    const hasErr = st.lastReport?.errors?.length || st.lastReport?.failedFiles?.length;
                    setRecoveryNotice({ tone: resp.ok && !hasErr ? 'success' : 'error', message: resp.message || (resp.ok ? 'Hoàn tất khôi phục.' : 'Khôi phục thất bại.') });
                    try { const l = await apiJson('/api/recovery/logs?limit=10'); setRecoveryLogs(l.logs || []); } catch (_) {}
                  } catch (error) { setRecoveryRunning(false); setRecoveryNotice({ tone: 'error', message: error?.message || 'Khôi phục thất bại.' }); }
                }} disabled={recoveryBusy || !selectedRecoveryFiles.length} className="btn-success inline-flex min-h-10 items-center gap-2 disabled:opacity-60"><RotateCcw size={16} className={recoveryRunning ? 'animate-spin' : ''} /> Bắt đầu khôi phục</button>
                <button type="button" onClick={async () => {
                  if (!window.confirm('Quét sâu toàn bộ ổ đĩa có thể rất lâu. Tiếp tục?')) return;
                  setRecoveryNotice(null);
                  setRecoveryRunning(true);
                  try {
                    const resp = await apiJson('/api/recovery/deep-scan', { method: 'POST', body: { deepScan: true } });
                    setRecoveryRunning(false);
                    if (!resp.ok) { setRecoveryNotice({ tone: 'error', message: resp.message || 'Quét sâu thất bại.' }); return; }
                    setRecoveryFoundFiles(resp.files || []);
                    setSelectedRecoveryFilePaths(resp.summary?.defaultSelection || (resp.files || []).slice(0, 1).map(f => f.path));
                    setRecoveryFilter((resp.summary?.mainBackupCount || 0) > 0 ? 'main' : 'recovery');
                    setRecoveryNotice({ tone: 'success', message: resp.message || `Quét sâu xong: ${(resp.files || []).length} file backup.` });
                  } catch (error) { setRecoveryRunning(false); setRecoveryNotice({ tone: 'error', message: error?.message || 'Quét sâu thất bại.' }); }
                }} disabled={recoveryBusy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-60">Quét sâu toàn bộ ổ đĩa</button>
                <button type="button" onClick={async () => {
                  if (!window.confirm('Hủy khôi phục? Tiến trình sẽ dừng an toàn sau batch hiện tại, dữ liệu đã gộp vẫn được giữ.')) return;
                  try { await apiJson('/api/recovery/cancel', { method: 'POST' }); setRecoveryNotice({ tone: 'success', message: 'Đã yêu cầu hủy. Đang dừng an toàn...' }); }
                  catch (error) { setRecoveryNotice({ tone: 'error', message: error?.message || 'Hủy thất bại.' }); }
                }} disabled={!recoveryRunning} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60">Hủy khôi phục</button>
                <button type="button" onClick={async () => { try { const f = await apiJson('/api/recovery/found-files'); setRecoveryFoundFiles(f.files || []); } catch (_) {} }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Xem file backup đã tìm thấy</button>
                <button type="button" onClick={async () => { try { const l = await apiJson('/api/recovery/logs?limit=10'); setRecoveryLogs(l.logs || []); } catch (_) {} }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Xem log khôi phục</button>
                <button type="button" onClick={() => window.open('/api/recovery/export-report', '_blank')} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Xuất báo cáo restore</button>
                <button type="button" onClick={async () => { if (!window.confirm('Khôi phục lại bản trước restore (rollback)?')) return; try { await apiJson('/api/recovery/rollback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ backupPath: 'latest_safety' }) }); setRecoveryNotice({ tone: 'success', message: 'Đã rollback về bản trước restore.' }); } catch (error) { setRecoveryNotice({ tone: 'error', message: error?.message || 'Rollback thất bại.' }); } }} disabled={recoveryBusy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60">Khôi phục lại bản trước restore</button>
              </div>
            </div>
            <SectionNotice notice={recoveryNotice} />
            {(recoveryRunning || recoveryStatus?.running) && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
                  <Loader2 size={16} className="animate-spin" />
                  <span>{recoveryStatus?.progress || 'Đang chạy khôi phục...'}</span>
                </div>
                {(recoveryStatus?.details?.percent != null) && (
                  <div className="w-full bg-blue-100 rounded-full h-2 overflow-hidden">
                    <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${recoveryStatus.details.percent}%` }} />
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-blue-900">
                  <div><span className="opacity-70">Ổ đang quét: </span><span className="font-semibold">{recoveryStatus?.details?.scanningDrive || '—'}</span></div>
                  <div><span className="opacity-70">File đang xử lý: </span><span className="font-semibold">{recoveryStatus?.details?.file ? recoveryStatus.details.file.split(/[\\/]/).pop() : '—'}</span></div>
                  <div><span className="opacity-70">Đã xử lý: </span><span className="font-semibold">{recoveryStatus?.details?.processed || 0}/{recoveryStatus?.details?.total || 0}</span></div>
                  <div><span className="opacity-70">Checkpoint: </span><span className="font-semibold">{recoveryStatus?.details?.checkpoint ? `${recoveryStatus.details.checkpoint.table} #${recoveryStatus.details.checkpoint.batch}` : '—'}</span></div>
                </div>
                <p className="text-xs text-blue-700">Đang khôi phục, vui lòng không tắt phần mềm. Giao diện vẫn phản hồi bình thường.</p>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-xl border bg-gray-50 p-4"><div className="text-xs text-gray-500">File backup tìm thấy</div><div className="mt-1 font-bold text-gray-900">{recoveryFoundFiles.length || recoveryStatus?.foundFiles?.length || 0}</div></div>
              <div className="rounded-xl border bg-gray-50 p-4"><div className="text-xs text-gray-500">Trạng thái</div><div className="mt-1 font-bold text-gray-900">{recoveryRunning ? 'Đang chạy' : (recoveryStatus?.progress || 'Chưa chạy')}</div></div>
              <div className="rounded-xl border bg-gray-50 p-4"><div className="text-xs text-gray-500">Log gần nhất</div><div className="mt-1 font-bold text-gray-900">{recoveryStatus?.lastLogPath ? 'Có' : 'Chưa có'}</div></div>
            </div>
            {recoveryStatus?.lastReport && (
              <div className="rounded-xl border bg-emerald-50 p-4 space-y-2">
                <h3 className="font-bold text-emerald-900">Tổng kết khôi phục</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-emerald-900">
                  <div><span className="opacity-70">Đơn hàng khôi phục: </span><span className="font-semibold">{recoveryStatus.lastReport.restoredCounts?.invoices || 0}</span></div>
                  <div><span className="opacity-70">Sản phẩm khôi phục: </span><span className="font-semibold">{recoveryStatus.lastReport.restoredCounts?.products || 0}</span></div>
                  <div><span className="opacity-70">Khách hàng khôi phục: </span><span className="font-semibold">{recoveryStatus.lastReport.restoredCounts?.customers || 0}</span></div>
                  <div><span className="opacity-70">Phiếu nhập khôi phục: </span><span className="font-semibold">{recoveryStatus.lastReport.restoredCounts?.import_logs || 0}</span></div>
                  <div><span className="opacity-70">Bản ghi trùng (bỏ qua): </span><span className="font-semibold">{Object.values(recoveryStatus.lastReport.skippedDuplicates || {}).reduce((a, b) => a + b, 0)}</span></div>
                  <div><span className="opacity-70">File lỗi/bỏ qua: </span><span className="font-semibold">{recoveryStatus.lastReport.failedFiles?.length || 0}</span></div>
                  <div><span className="opacity-70">File đã xử lý: </span><span className="font-semibold">{recoveryStatus.lastReport.parsedFiles?.length || 0}</span></div>
                  <div><span className="opacity-70">Rollback: </span><span className="font-semibold">{recoveryStatus.lastReport.rollbackStatus || '—'}</span></div>
                </div>
                {(recoveryStatus.lastReport.failedFiles?.length > 0) && (
                  <button type="button" onClick={async () => { try { const l = await apiJson('/api/recovery/logs?limit=10'); setRecoveryLogs(l.logs || []); if (l.logs?.[0]) { const detail = await apiJson('/api/recovery/logs/' + l.logs[0].file); setRecoveryLogDetail(detail.log); } } catch (_) {} }} className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50">Xem log lỗi</button>
                )}
              </div>
            )}
          </div>
          {recoveryFiles.length > 0 && (() => {
            const allFilteredPaths = visibleRecoveryFiles.map(f => f.path);
            const allFilteredSelected = allFilteredPaths.length > 0 && allFilteredPaths.every(p => selectedRecoveryFilePaths.includes(p));
            const someFilteredSelected = allFilteredPaths.some(p => selectedRecoveryFilePaths.includes(p));
            const filteredCount = visibleRecoveryFiles.length;
            const totalAllCount = recoveryFiles.length;
            const isFiltered = filteredCount !== totalAllCount;
            const selectedInFilter = selectedRecoveryFilePaths.filter(p => allFilteredPaths.includes(p)).length;
            const selectedTotal = selectedRecoveryFilePaths.length;
            return (<div className="card space-y-4"><div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><h3 className="font-bold">File backup đã tìm thấy ({totalAllCount})</h3>
          <p className="text-xs text-gray-500">
            Đã chọn <span className="font-semibold text-blue-700">{selectedTotal}</span> file
            {isFiltered && <span className="text-gray-500"> ({selectedInFilter} trong danh sách đang lọc)</span>}
            {selectedTotal > 500 && <span className="ml-2 font-semibold text-amber-700">— Bạn đang chọn rất nhiều file backup. Khôi phục toàn bộ có thể mất nhiều thời gian.</span>}
          </p></div><div className="flex flex-wrap gap-2"><select value={recoveryFilter} onChange={e => setRecoveryFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-sm"><option value="all">Tất cả backup</option><option value="main">Backup chính</option><option value="recovery">Recovery point</option></select><button type="button" onClick={() => setSelectedRecoveryFilePaths(allFilteredPaths)} className="rounded-lg border px-3 py-2 text-sm">Chọn tất cả đang lọc</button>
          {isFiltered && totalAllCount > filteredCount && <button type="button" onClick={() => { if (totalAllCount > 5000 && !window.confirm(`Bạn sắp chọn toàn bộ ${totalAllCount} file backup. Khôi phục toàn bộ có thể mất rất nhiều thời gian. Tiếp tục chọn?`)) return; setSelectedRecoveryFilePaths(recoveryFiles.map(f => f.path)); }} className="rounded-lg border border-blue-400 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100">Chọn tất cả {totalAllCount} file</button>}
          <button type="button" onClick={() => setSelectedRecoveryFilePaths([])} className="rounded-lg border px-3 py-2 text-sm">Bỏ chọn tất cả</button><button type="button" onClick={() => setSelectedRecoveryFilePaths(recoveryFiles.slice(0, 1).map(f => f.path))} className="rounded-lg border px-3 py-2 text-sm">Chọn backup mới nhất</button></div></div><div className="overflow-auto rounded-xl border max-h-96"><table className="min-w-full text-sm"><thead className="bg-gray-50 text-left text-xs uppercase text-gray-500"><tr><th className="px-4 py-3"><div className="flex items-center gap-2"><input type="checkbox" checked={allFilteredSelected} ref={el => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected; }} onChange={() => setSelectedRecoveryFilePaths(allFilteredSelected ? [] : allFilteredPaths)} className="rounded" /> Chọn</div></th><th className="px-4 py-3">Loại</th><th className="px-4 py-3">Thời gian</th><th className="px-4 py-3">Đường dẫn</th><th className="px-4 py-3">Kích thước</th></tr></thead><tbody>{visibleRecoveryFiles.slice(0, 500).map((f, i) => <tr key={f.path || i} className="border-t"><td className="px-4 py-2"><input type="checkbox" checked={selectedRecoveryFilePaths.includes(f.path)} onChange={e => setSelectedRecoveryFilePaths(paths => e.target.checked ? Array.from(new Set([...paths, f.path])) : paths.filter(p => p !== f.path))} /></td><td className="px-4 py-2 text-xs">{(f.type || f.backupType) === 'recovery_point' ? 'Recovery point' : 'Backup chính'}</td><td className="px-4 py-2 text-xs text-gray-600">{f.timestamp ? formatDateTime(f.timestamp) : '-'}</td><td className="px-4 py-2 font-mono text-xs text-gray-800">{f.path}</td><td className="px-4 py-2 text-gray-600">{f.size ? formatBytes(f.size) : '-'}</td></tr>)}</tbody></table></div>{visibleRecoveryFiles.length > 500 && <p className="text-xs text-amber-700">Đang hiển thị 500 file đầu tiên. Hãy dùng bộ lọc hoặc chọn backup mới nhất để tránh treo.</p>}</div>)})()}`n          {recoveryLogs.length > 0 && <div className="card space-y-4"><h3 className="font-bold">Log khôi phục</h3><div className="space-y-2">{recoveryLogs.map((l, i) => <div key={i} className="rounded-lg border bg-gray-50 p-3 text-sm cursor-pointer hover:bg-gray-100" onClick={async () => { try { const detail = await apiJson('/api/recovery/logs/' + l.file); setRecoveryLogDetail(detail.log); } catch (_) {} }}><span className="font-mono text-xs">{l.file}</span></div>)}</div></div>}
          {recoveryLogDetail && <div className="card space-y-4"><div className="flex items-center justify-between"><h3 className="font-bold">Chi tiết log</h3><button type="button" onClick={() => setRecoveryLogDetail(null)} className="text-gray-500 hover:text-gray-700 text-sm">Đóng</button></div><pre className="overflow-auto rounded-xl border bg-gray-900 p-4 text-xs text-green-200 max-h-96">{recoveryLogDetail.type === 'text' ? recoveryLogDetail.content : JSON.stringify(recoveryLogDetail.content || recoveryLogDetail, null, 2)}</pre></div>}
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
                  ứng dụng Electron có thể t? kiểm tra, t? tđi về ch? cài đặt khi bđơn xác nhận cập nhật.
                </p>
              </div>
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${updateState?.status === 'error' ? 'bg-red-100 text-red-700' : hasUpdate ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                {getUpdateStatusLabel(updateState?.status)}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
              <div className="rounded-xl border bg-gray-50 p-4">
                <div className="text-gray-500">Phiên bđơn hiện tại</div>
                <div className="mt-1 text-2xl font-bold text-gray-800">{currentVersion}</div>
                <div className="mt-2 text-xs text-gray-500">
                  Nđơn tổng: {appInfo?.platform || window.khaDesktop?.platform || 'web'} ? Kiđơn tr?c: {appInfo?.arch || 'unknown'}
                </div>
              </div>
              <div className="rounded-xl border bg-gray-50 p-4">
                <div className="text-gray-500">Feed cập nhật</div>
                <div className="mt-1 break-all font-medium text-gray-800">{manifestUrl || 'Chua n?p URL feed'}</div>
                <div className="mt-2 text-xs text-gray-500">Nguđơn: {manifestSourceLabel}</div>
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
                <div className="mt-1">Log n?y d?ng d? debug check/download/cài đặt về không chđã token hay mật khẩu.</div>
              </div>
            )}

            {runtimeDiagnostics && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                <div className="font-semibold text-gray-700">Chọn dođơn runtime updater</div>
                <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2">
                  <div>?? d?ng gđi: {runtimeDiagnostics.isPackaged ? 'C?' : 'Không'}</div>
                  <div>app-update.yml: {runtimeDiagnostics.appUpdateYmlExists ? 'C?' : 'Không th?y'}</div>
                  <div>Kiđơn tr?c runtime: {runtimeArch || 'unknown'}</div>
                  <div>Tuong th?ch: {runtimeCompatibility?.supported === false ? 'Không' : 'C?'}</div>
                  <div className="break-all md:col-span-2">đủđơng đến app-update.yml: {runtimeDiagnostics.appUpdateYmlPath || 'Không x?c d?nh'}</div>
                </div>
              </div>
            )}

            {runtimeCompatibility && (
              <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${runtimeCompatibility.supported === false ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                <div className="font-semibold">Tuong th?ch mãy Windows</div>
                <div className="mt-1">{runtimeCompatibility.message}</div>
                <div className="mt-1 text-xs">B? cái khuyđơn ngh?: {recommendedInstaller?.label || 'Windows x64'}.</div>
              </div>
            )}

            {!desktopAvailable && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                T?nh nang cập nhật ch? ho?t d?ng trong ứng dụng Electron d? cái trđơn Windows. Khi ch?y frontend web d?c l?p, API cập nhật s? không kh? d?ng.
              </div>
            )}

            {updateNotice && (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                {updateNotice}
              </div>
            )}

            {updateError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <div className="font-semibold">Không th? hođơn tốt thao t?c cập nhật</div>
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
                    <div>Ngày ph?t h?nh: {formatDateTime(updateInfo.releaseDate)}</div>
                    <div>Dung lu?ng: {formatBytes(updateInfo.size)}</div>
                    {updateInfo.mandatory && <div className="font-semibold text-red-600">Bản cập nhật bắt bu?c</div>}
                  </div>
                </div>
                <div className="mt-3 text-sm">
                  <div className="mb-1 font-semibold text-gray-700">Ghi ch? ph?t h?nh</div>
                  <pre className="whitespace-pre-wrap rounded-lg border bg-gray-50 p-3 text-sm text-gray-700">
                    {updateInfo.releaseNotes || 'Không có ghi ch? ph?t h?nh.'}
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
                ứng dụng dang ? phiđơn bđơn mới nh?t. Lđơn kiểm tra: {formatDateTime(updateState.lastCheckedAt)}.
              </div>
            )}

            {updateState?.status === 'downloading' && (
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>Tiền tr?nh tđi</span>
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
                electron-updater đã tải về xác thực gđi cập nhật thành công. Khi bâm Cập nhật ngay, ứng dụng s? sao luu database trước khi cài đặt về khởi động lại.
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCheckUpdate}
                disabled={!desktopAvailable || updateBusy === 'checking' || updateState?.status === 'downloading'}
                className="btn-primary disabled:opacity-60"
              >
                {updateBusy === 'checking' ? 'đang kiểm tra...' : 'Kiểm tra cập nhật'}
              </button>
              <button
                type="button"
                onClick={handleDownloadUpdate}
                disabled={!desktopAvailable || !hasUpdate || downloaded || updateState?.status === 'downloading'}
                className="btn-success disabled:opacity-60"
              >
                {updateBusy === 'downloading' ? 'đang tđi...' : 'Tải bđơn cập nhật'}
              </button>
              {updateState?.status === 'downloading' && (
                <button
                  type="button"
                  onClick={handleCancelUpdate}
                  disabled={updateBusy === 'cancelling'}
                  className="btn-danger disabled:opacity-60"
                >
                  {updateBusy === 'cancelling' ? 'đang h?y...' : 'Hủy tđi'}
                </button>
              )}
              <button
                type="button"
                onClick={handleInstallUpdate}
                disabled={!desktopAvailable || !downloaded || updateBusy === 'installing'}
                className="btn-danger disabled:opacity-60"
              >
                {updateBusy === 'installing' ? 'đang cập nhật...' : 'Cập nhật ngay'}
              </button>
            </div>
          </div>

          <div className="card border-emerald-100 bg-emerald-50 text-sm text-emerald-800">
            <h3 className="mb-3 font-bold">Tải b? cái th? cứng dụng kiđơn tr?c</h3>
            <div className="mb-3 rounded-lg border border-emerald-200 bg-white/70 px-3 py-2 text-xs">
              Luđơn tđi t? GitHub Release ch?nh th?c về chọn d?ng file cấu hình t? kiđơn tr?c. Nếu Windows b?o ?ứng dụng n?y không th? ch?y trđơn PC của bđơn?, h?y th? bđơn ia32 cho Windows 32-bit ho?c kiểm tra mãy c? hỗ trợ x64 không.
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {WINDOWS_INSTALLERS.map(installer => {
                const recommended = installer.arch === recommendedInstaller?.arch;
                const url = buildReleaseDownloadUrl(installer.fileName);
                return (
                  <div key={installer.arch} className="rounded-xl border border-emerald-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold text-gray-800">{installer.label}</div>
                      {recommended && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Khuyđơn ngh? cho mãy n?y</span>}
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
            <h3 className="mb-2 font-bold">Ghi ch? update feed</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>Mặc định app d?ng provider generic d? d?c trực tiếp latest.yml t? GitHub Release latest.</li>
              <li>Release production cđơn c? installer x64 về ia32, mới file .exe c? .exe.blockmap tuong đơng về tđơn asset r? kiđơn tr?c.</li>
              <li>latest.yml về update-manifest.json phđi c?ng version, URL, sha256/sha512 về size vđi asset d? upload.</li>
              <li>Khi repo ho?c release asset dang private, client Electron không th? t? cập nhật nđủ không có feed public phù hợp.</li>
              <li>Trước khi cài đặt, ứng dụng s? sao luu file database trong thu mãc userData/backups.</li>
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
                  label="H? tđơn"
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
                  label="S? điện thoại"
                  value={empForm.phone}
                  onChange={event => setEmpForm(current => ({ ...current, phone: event.target.value }))}
                />
                <InputField
                  id="emp-password"
                  label={empEdit ? 'Mật khẩu mới (d? tr?ng nđủ không dài)' : 'Mật khẩu'}
                  type="password"
                  autoComplete="new-password"
                  value={empForm.password}
                  onChange={event => setEmpForm(current => ({ ...current, password: event.target.value }))}
                />
                <div>
                  <label htmlFor="emp-role" className="text-sm font-medium text-gray-700">Vai tr?</label>
                  <select
                    id="emp-role"
                    className="input-field mt-1 w-full"
                    value={empForm.role}
                    onChange={event => setEmpForm(current => ({ ...current, role: event.target.value }))}
                  >
                    {USER_ROLE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <div className="mt-1 text-xs text-gray-500">
                    {getRoleOption(empForm.role).description}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                Vai tr? hỗ trợ: admin, kế toán, thu ngđơn, nhân viên về user cu. Khi tạo mới, backend vđơn t? c?p role ban đầu theo co ch? cu; client s? cập nhật lỗi role đã chọn ngay sau khi tạo nđủ c? quyđơn quản lý nguđi d?ng.
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleSaveEmp}
                disabled={empSaving}
                className="btn-success flex-1 disabled:opacity-60"
              >
                {empSaving ? 'đang luu...' : 'Luu'}
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
                label="Tồn loại khách"
                value={typeForm.name}
                onChange={event => setTypeForm(current => ({ ...current, name: event.target.value }))}
                placeholder="V? d?: Khách VIP"
              />

              <div>
                <label htmlFor="customer-type-color" className="text-sm font-medium text-gray-700">
                  Mđủ s?c
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
                {typeSaving ? 'đang luu...' : 'Luu'}
              </button>
              <button type="button" onClick={closeTypeModal} disabled={typeSaving} className="btn-danger flex-1 disabled:opacity-60">
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {showPrintTemplateModal && canManagePrintTemplates && (
        <PrintTemplateEditorModal
          show={showPrintTemplateModal}
          template={printTemplateEdit}
          canManage={canManagePrintTemplates}
          onClose={closePrintTemplateModal}
          onSaved={handlePrintTemplateEditorSaved}
        />
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
                Trang Cài đặt cho phép cấu hình thông tin cửa hàng, quản lý nhân viên, loại khách hàng, bắt/tốt xuất âm tồn kho, mẫu in hóa đơn về cập nhật ứng dụng Electron.
              </p>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Cửa hàng</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Cập nhật tđơn cửa hàng, địa chỉ, s? điện thoại, email, mã s? thuế về thông tin ngđơn h?ng.</li>
                <li>Phđơn logo, ghi ch? về slogan d?ng cho nhân diđơn cửa hàng trong hệ thống.</li>
                <li>Sau khi chỉnh sửa, nhân <strong>Luu thay đổi</strong> d? ghi xu?ng backend.</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Nhân viên</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Thêm, sửa ho?c về hiđủ tài khoản nhân viên.</li>
                <li>C? th? chọn role Admin, Kế toán, Thu ngđơn, Nhân viên ho?c User cu d? giá tuong th?ch dữ liệu legacy.</li>
                <li>Admin tođơn quyđơn; kế toán truy c?p module kế toán; thu ngđơn ch? xem doanh thu; nhân viên/user cu không vào module kế toán.</li>
                <li>Khi sửa nhân viên, có thể d? tr?ng mật khẩu nđủ không muđơn dài.</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Loại khách</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Tạo về ch?nh mđủ cho tổng nhâm khách hàng.</li>
                <li>Xóa loại khách l? thao t?c soft-delete trđơn backend.</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Xuất âm</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Dùng d? bắt/tốt cho phép xuất âm tồn kho sản phẩm.</li>
                <li>Khi bắt, admin nh?p số lượng âm tđi da; về đã nhập {negativeStockAdminLimitLabel} th? tđơn tđi thiđủ runtime l? {negativeStockRuntimeLimitLabel}.</li>
                <li>Khi tốt, mới thao t?c lâm tồn kho nh? hon 0 s? b? backend t? chđi.</li>
                <li>? giới hạn luu qua API /api/settings/negative-stock về được các mđơn h?nh bđơn h?ng/kho d?ng lâm runtime settings.</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Mẫu in hóa đơn</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Danh sách mẫu in l?y t? API th?t <strong>/api/print-templates</strong>, khứng dụng mock cho CRUD ho?c editor ch?nh th?c.</li>
                <li>Editor Canva-like hỗ trợ kỳo th?, resize, zoom, grid, snap, Lđủ về Publish sang layout in th?t, preview bằng hóa đơn th?t.</li>
                <li>Preview editor về renderer in d?ng dữ liệu hóa đơn th?t t? API <strong>/api/invoices/:idOrCode/print</strong>; logo upload/xóa qua asset endpoint ri?ng.</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Cập nhật</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Ch? ho?t d?ng khi ch?y bđơn Electron d? d?ng gđi.</li>
                <li>App ch? cài đặt sau khi nguđi d?ng xác nhận về s? sao luu database trước khi cập nhật.</li>
                <li>Khi cđơn debug, có thể xem du?ng đến file update.log được hiển thị trong trang.</li>
              </ul>
            </div>
          </div>
        )}
      />
    </div>
  );
}



