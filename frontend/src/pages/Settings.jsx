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
  { value: 'admin', label: 'Admin', description: 'To?n quy?n hệ thống v? k? to?n.' },
  { value: 'accountant', label: 'K? to?n', description: '??y d? module k? to?n, thu?, tồn kho, c?ng n? v? nh?t k?.' },
  { value: 'cashier', label: 'Thu ng?n', description: 'Ch? xem doanh thu trong module k? to?n.' },
  { value: 'employee', label: 'Nh?n vi?n', description: 'Kh?ng c? quy?n module k? to?n.' },
  { value: 'user', label: 'User cu', description: 'Vai tr? legacy du?c gi? tuong th?ch.' },
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

const NEGATIVE_STOCK_FEATURE_NAME = 'Xu?t ?m tồn kho';
const NEGATIVE_STOCK_FEATURE_DESCRIPTION = 'Admin c? th? ch?nh s? lu?ng t?n ?m t?i da tr?c ti?p t? giao di?n.';
const RELEASE_VERSION = '1.3.8';
const RELEASE_DOWNLOAD_BASE_URL = 'https://github.com/Vankhadev/phanmemoffline/releases/latest/download/';
const WINDOWS_INSTALLERS = Object.freeze([
  {
    arch: 'x64',
    label: 'Windows 64-bit (x64)',
    fileName: `banhangoffline-setup-v${RELEASE_VERSION}-x64.exe`,
    recommendedFor: 'H?u h?t m?y t?nh Windows 10/11 hi?n nay.',
  },
  {
    arch: 'ia32',
    label: 'Windows 32-bit (ia32)',
    fileName: `banhangoffline-setup-v${RELEASE_VERSION}-ia32.exe`,
    recommendedFor: 'M?y Windows 32-bit ho?c m?y b?o kh?ng ch?y du?c b?n x64.',
  },
]);

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (!bytes) return 'Kh?ng r? dung lu?ng';
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
    idle: 'S?n s?ng',
    checking: 'đang ki?m tra...',
    'no-update': 'Kh?ng c? b?n m?i',
    'update-available': 'C? b?n cập nhật',
    downloading: 'đang t?i cập nhật...',
    downloaded: '?? t?i xong',
    installing: 'đang cập nhật...',
    cancelled: '?? h?y t?i',
    error: 'C? l?i',
  };
  return labels[status] || 'Chua ki?m tra';
}

function getUpdateErrorMessage(error) {
  if (!error) return '';
  const messages = {
    MANIFEST_URL_MISSING: 'Chua x?c d?nh du?c URL cập nhật. M?c d?nh ứng dụng d?ng GitHub Releases latest.yml.',
    CONFIG_INVALID: 'File c?u h?nh cập nhật kh?ng h?p l?.',
    URL_INVALID: 'URL cập nhật ho?c installer kh?ng h?p l?.',
    DEV_UPDATER_DISABLED: 'Auto-update b? t?t khi ch?y development/unpacked. H?y test tr?n b?n d? c?i b?ng NSIS ho?c b?t KHA_ENABLE_ELECTRON_UPDATER=1 c? ch? d?ch.',
    WINDOW_NOT_READY: 'Ch? ki?m tra cập nhật sau khi c?a s? ch?nh d? s?n s?ng.',
    ELECTRON_UPDATER_ERROR: 'electron-updater b?o l?i trong qu? tr?nh ki?m tra/t?i cập nhật.',
    CHECK_FAILED: 'Ki?m tra cập nhật th?t b?i.',
    UPDATE_GITHUB_ATOM_FEED_NOT_AVAILABLE: 'Endpoint GitHub releases.atom kh?ng ph? h?p ho?c kh?ng kh? d?ng. B?n m?i s? d?c tr?c ti?p latest.yml public thay v? ph? thu?c Atom feed.',
    UPDATE_REPOSITORY_NOT_ACCESSIBLE: 'Kh?ng truy c?p du?c GitHub Releases/latest. Repo c? th? private, owner/repo sai, URL feed sai ho?c chua c? release latest public.',
    UPDATE_FEED_UNAUTHORIZED_OR_PRIVATE: 'GitHub Release/feed y?u c?u xác thực, token sai/thi?u quy?n ho?c repo dang private. Client Electron kh?ng du?c nh?ng token n?n kh?ng th? t? cập nhật t? asset private.',
    UPDATE_FEED_METADATA_NOT_FOUND: 'Kh?ng t?m th?y latest.yml trong GitHub Release latest ho?c release latest kh?ng public.',
    UPDATE_METADATA_INVALID: 'Metadata cập nhật tr?n GitHub Release kh?ng h?p l? ho?c r?ng.',
    UPDATE_RUNTIME_ARCH_UNSUPPORTED: 'M?y Windows hi?n t?i chua c? b? c?i ph? h?p. H?y t?i d?ng b?n x64 ho?c ia32 t? GitHub Release.',
    UPDATE_METADATA_MISSING_RUNTIME_INSTALLER: 'GitHub Release chua c? installer ri?ng cho ki?n tr?c m?y n?y. C?n upload asset cấu hình t? -x64.exe ho?c -ia32.exe v? cập nhật latest.yml.',
    UPDATE_METADATA_SELECTED_INSTALLER_MISMATCH: 'Metadata cập nhật dang ch?n installer kh?ng kh?p ki?n tr?c m?y. Kh?ng t?i d? tr?nh l?i Windows kh?ng ch?y du?c ứng dụng.',
    UPDATE_ASSET_NOT_ACCESSIBLE_OR_PRIVATE: 'Kh?ng t?i du?c installer/blockmap. Asset c? th? thi?u, t?n kh?ng kh?p latest.yml ho?c repo private tr? 404.',
    UPDATE_RELEASE_NOT_PUBLISHED: 'Chua c? production release d? publish d? electron-updater ch?n l?m latest.',
    UPDATE_FEED_RATE_LIMITED: 'GitHub dang gi?i h?n truy c?p feed cập nhật, vui l?ng th? l?i sau.',
    UPDATE_NETWORK_ERROR: 'Kh?ng kết nối du?c t?i GitHub Releases. Vui l?ng ki?m tra Internet, DNS, proxy/firewall.',
    NETWORK_ERROR: 'Kh?ng th? kết nối t?i m?y ch? cập nhật. Vui l?ng ki?m tra m?ng.',
    NETWORK_TIMEOUT: 'K?t n?i t?i m?y ch? cập nhật qu? th?i gian ch?.',
    MANIFEST_HTTP_ERROR: 'M?y ch? kh?ng tr? metadata cập nhật h?p l?.',
    MANIFEST_INVALID_JSON: 'Metadata cập nhật kh?ng ph?i JSON/YAML h?p l?.',
    MANIFEST_INVALID: 'Metadata cập nhật thi?u ho?c sai c?u tr?c.',
    MANIFEST_INVALID_VERSION: 'Metadata thi?u version SemVer h?p l?.',
    MANIFEST_INVALID_URL: 'Metadata thi?u URL g?i cập nhật h?p l?.',
    MANIFEST_INVALID_SHA256: 'Metadata thi?u checksum h?p l?.',
    MANIFEST_INVALID_RELEASE_DATE: 'Metadata thi?u releaseDate.',
    UPDATE_NOT_AVAILABLE: 'Kh?ng c? b?n cập nhật m?i d? t?i.',
    DOWNLOAD_IN_PROGRESS: 'M?t lu?t t?i cập nhật dang ch?y.',
    DOWNLOAD_HTTP_ERROR: 'Kh?ng t?i du?c g?i cập nhật t? m?y ch?.',
    DOWNLOAD_FAILED: 'T?i g?i cập nhật th?t b?i.',
    DOWNLOAD_CANCELLED: 'Ngu?i d?ng d? h?y t?i cập nhật.',
    CHECKSUM_MISMATCH: 'Checksum kh?ng kh?p. G?i cập nhật d? b? x?a v? s? kh?ng du?c ch?y.',
    INSTALLER_NOT_DOWNLOADED: 'Chua t?i g?i cập nhật.',
    UPDATE_NOT_DOWNLOADED: 'Chua c? b?n cập nhật d? t?i xong d? c?i d?t.',
    INSTALLER_NOT_FOUND: 'Kh?ng t?m th?y installer d? t?i. Vui l?ng t?i l?i.',
    INSTALL_IN_PROGRESS: 'ứng dụng dang chu?n b? c?i d?t b?n cập nhật.',
    SPAWN_INSTALLER_FAILED: 'Kh?ng th? ch?y installer cập nhật.',
  };
  return messages[error.code] || error.message || '?? x?y ra l?i cập nhật.';
}

function getManifestSourceLabel(updateState) {
  if (!updateState) return 'Chua n?p c?u h?nh cập nhật';
  if (updateState.updateEngine === 'electron-updater') {
    if (updateState.feedProvider === 'generic') {
      return updateState.feedSource === 'package.build.publish.generic'
        ? 'GitHub Release latest.yml tr?c ti?p (package.json build.publish generic)'
        : 'GitHub Release latest.yml tr?c ti?p';
    }
    return updateState.feedSource === 'package.build.publish'
      ? 'GitHub Releases/electron-updater (package.json build.publish)'
      : 'GitHub Releases/electron-updater';
  }
  if (updateState.manifestUrlDefault) return 'GitHub Release m?c d?nh';
  if (updateState.manifestUrlConfigured) return `Override n?i b?: ${updateState.manifestSource || 'env/config file'}`;
  return updateState.manifestSource || 'GitHub Release m?c d?nh';
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
  if (!text) return 'Vui l?ng nh?p s? lu?ng ?m t?i da cho ph?p.';
  if (!/^\d+$/.test(text)) return 'S? lu?ng ?m t?i da ph?i l? s? nguy?n kh?ng ?m.';
  const number = Number(text);
  if (!Number.isInteger(number) || number < 0) return 'S? lu?ng ?m t?i da ph?i l? s? nguy?n kh?ng ?m.';
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

  const getErrorMessage = useCallback(
    (error, fallback = 'Thao t?c th?t b?i.') => getApiErrorMessage(error?.data || error, error?.message || fallback),
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
      const message = getErrorMessage(error, 'Kh?ng th? t?i c?u h?nh xu?t ?m tồn kho t? API /api/settings/negative-stock.');
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
    const data = await apiJson('/store', {}, 'Kh?ng th? t?i th?ng tin c?a h?ng.');
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
      const message = getErrorMessage(error, 'API mẫu in h?a don dang ? tr?ng th?i an to?n; chua t?i du?c danh s?ch mẫu in t? /api/print-templates.');
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
      const message = getErrorMessage(error, 'Kh?ng th? t?i tr?ng th?i backup.');
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
        ...(canViewStore ? [{ label: 'c?a h?ng', promise: loadStore() }] : []),
        ...(canViewEmployees ? [{ label: 'nh?n vi?n', promise: loadEmployees() }] : []),
        ...(canViewCustomerTypes ? [{ label: 'lo?i kh?ch h?ng', promise: loadCustomerTypes() }] : []),
        ...(canViewNegativeStock ? [{ label: 'xu?t ?m tồn kho', promise: loadNegativeStockSettings() }] : []),
        ...(canViewPrintTemplates ? [{ label: 'mẫu in h?a don', promise: loadPrintTemplates() }] : []),
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
          return `${sections[index].label}: ${getErrorMessage(result.reason, `Kh?ng th? t?i ${sections[index].label}.`)}`;
        })
        .filter(Boolean);

      if (failures.length > 0) {
        setTimedNotice('page', setPageNotice, {
          tone: 'error',
          message: `M?t s? dữ liệu c?i d?t chua t?i du?c. ${failures.join(' | ')}`,
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
        setUpdateNotice(version ? `C? b?n cập nhật ${version}.` : 'C? b?n cập nhật m?i.');
      }
      if (payload?.type === 'downloaded') setUpdateNotice('?? t?i v? xác thực g?i cập nhật. Ch?n Cập nhật ngay ho?c ?? sau.');
      if (payload?.type === 'install-deferred') setUpdateNotice('?? ch?n d? sau. ứng dụng tiếp tục ch?y b?nh thu?ng.');
      if (payload?.type === 'cancelled') setUpdateNotice('?? h?y t?i cập nhật.');
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
        message: 'Email c?a h?ng kh?ng h?p l?.',
      }, 5000);
      return;
    }

    setStoreSaving(true);
    setStoreNotice(null);
    try {
      const data = await apiJson('/store', {
        method: 'PUT',
        body: payload,
      }, 'Kh?ng th? luu th?ng tin c?a h?ng.');

      if (data?.ok) {
        setStoreForm(payload);
        setStoreDirty(false);
        onStoreChange?.(payload);
        setTimedNotice('store', setStoreNotice, {
          tone: 'success',
          message: '?? luu th?ng tin c?a h?ng.',
        }, 3000);
      }
    } catch (error) {
      setTimedNotice('store', setStoreNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Kh?ng th? luu th?ng tin c?a h?ng.'),
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
    if (!window.confirm('X?a nh?n vi?n n?y?')) return;

    setEmployeesNotice(null);
    try {
      const data = await apiJson(`/users/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }, 'Kh?ng th? x?a nh?n vi?n.');
      await loadEmployees();
      setTimedNotice('employees', setEmployeesNotice, {
        tone: 'success',
        message: data?.message || '?? x?a nh?n vi?n.',
      }, 3000);
    } catch (error) {
      setTimedNotice('employees', setEmployeesNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Kh?ng th? x?a nh?n vi?n.'),
      });
    }
  };

  const handleSaveEmp = async () => {
    const payload = sanitizeEmployeePayload(empForm);
    const isCreating = !empEdit;

    if (!payload.name || !payload.email || !payload.phone) {
      setEmpNotice({ tone: 'error', message: 'Vui l?ng di?n d?y d? h? t?n, email v? s? di?n tho?i.' });
      return;
    }
    if (!isValidEmail(payload.email)) {
      setEmpNotice({ tone: 'error', message: 'Email nh?n vi?n kh?ng h?p l?.' });
      return;
    }
    if (isCreating && !payload.password) {
      setEmpNotice({ tone: 'error', message: 'Vui l?ng nh?p m?t kh?u cho nh?n vi?n m?i.' });
      return;
    }
    if (payload.password && String(payload.password).length < 8) {
      setEmpNotice({ tone: 'error', message: 'M?t kh?u ph?i c? ?t nh?t 8 k? t?.' });
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
        }, 'Kh?ng th? t?o nh?n vi?n m?i.');
        const createdId = created?.user?.id || created?.id;
        if (createdId && payload.role && payload.role !== 'user') {
          await usersApi.update(createdId, { role: payload.role });
        }
      }

      await loadEmployees();
      closeEmpModal();
      setTimedNotice('employees', setEmployeesNotice, {
        tone: 'success',
        message: empEdit ? '?? cập nhật nh?n vi?n.' : '?? th?m nh?n vi?n m?i.',
      }, 3000);
    } catch (error) {
      setEmpNotice({
        tone: 'error',
        message: getErrorMessage(error, empEdit ? 'Kh?ng th? cập nhật nh?n vi?n.' : 'Kh?ng th? t?o nh?n vi?n m?i.'),
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
      setTypeNotice({ tone: 'error', message: 'Vui l?ng nh?p t?n lo?i kh?ch h?ng.' });
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
        message: typeEdit ? '?? cập nhật lo?i kh?ch h?ng.' : '?? th?m lo?i kh?ch h?ng m?i.',
      }, 3000);
    } catch (error) {
      setTypeNotice({
        tone: 'error',
        message: getErrorMessage(error, typeEdit ? 'Kh?ng th? cập nhật lo?i kh?ch h?ng.' : 'Kh?ng th? t?o lo?i kh?ch h?ng.'),
      });
    } finally {
      if (mountedRef.current) setTypeSaving(false);
    }
  };

  const handleDeleteType = async (id) => {
    if (!window.confirm('X?a lo?i kh?ch n?y?')) return;

    setCustomerTypesNotice(null);
    try {
      await customerTypesApi.remove(id);
      await loadCustomerTypes();
      setTimedNotice('customer-types', setCustomerTypesNotice, {
        tone: 'success',
        message: '?? x?a lo?i kh?ch h?ng.',
      }, 3000);
    } catch (error) {
      setTimedNotice('customer-types', setCustomerTypesNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Kh?ng th? x?a lo?i kh?ch h?ng.'),
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
        template_name: `M?u in h?a don ${printTemplates.length + 1}`,
        description: 'Thi?t k? b?ng editor mẫu in Canva-like.',
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
        message: '?? t?o m?u in m?i. Editor ?ang m? ?? thi?t k?, b?m L?u ho?c Publish ?? l?u.'
      }, 3000);
    } catch (error) {
      setTimedNotice('print-templates', setPrintTemplatesNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Kh?ng th? t?o mẫu in h?a don.'),
      });
    } finally {
      if (mountedRef.current) setPrintTemplateSaving(false);
    }
  };

  const openDemoPrintTemplateEditor = () => {
    const demo = normalizePrintTemplate({
      id: null,
      template_name: 'M?u thi?t k? th?',
      description: 'B?n demo local d? thi?t k? k?o th? khi chua c? MySQL mẫu in.',
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
      message: 'đang m? editor demo local. ?? luu/publish th?t, h?y c?u h?nh MySQL v? t?o mẫu in tr?n server.',
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
      if (!window.confirm('X?a logo dang luu tr?n mẫu in n?y?')) return;
      setPrintTemplateSaving(true);
      setPrintTemplateNotice(null);
      try {
        const data = await printTemplatesApi.removeLogo(printTemplateEdit.id);
        const item = normalizePrintTemplate(data?.item || data?.data || data);
        setPrintTemplateEdit(item);
        setPrintTemplateForm(current => ({ ...normalizePrintTemplateForm(item, storeForm), logo_url: '' }));
        await loadPrintTemplates();
        setPrintTemplateNotice({ tone: 'success', message: '?? x?a logo mẫu in.' });
      } catch (error) {
        setPrintTemplateNotice({ tone: 'error', message: getErrorMessage(error, 'Kh?ng th? x?a logo mẫu in.') });
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
      setPrintTemplateNotice({ tone: 'error', message: 'Vui l?ng nh?p t?n mẫu in h?a don.' });
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
        message: printTemplateEdit?.id ? '?? cập nhật mẫu in h?a don.' : '?? t?o mẫu in h?a don m?i.',
      }, 3000);
    } catch (error) {
      setPrintTemplateNotice({
        tone: 'error',
        message: getErrorMessage(error, printTemplateEdit?.id ? 'Kh?ng th? cập nhật mẫu in h?a don.' : 'Kh?ng th? t?o mẫu in h?a don.'),
      });
    } finally {
      if (mountedRef.current) setPrintTemplateSaving(false);
    }
  };

  const handleDeletePrintTemplate = async (template) => {
    if (!window.confirm(`X?a mẫu in "${template.template_name || template.name || ''}"?`)) return;
    setPrintTemplatesNotice(null);
    try {
      await printTemplatesApi.remove(template.id);
      await loadPrintTemplates();
      setTimedNotice('print-templates', setPrintTemplatesNotice, {
        tone: 'success',
        message: '?? x?a mẫu in h?a don.',
      }, 3000);
    } catch (error) {
      setTimedNotice('print-templates', setPrintTemplatesNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Kh?ng th? x?a mẫu in h?a don.'),
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
        message: '?? d?t mẫu in m?c d?nh.',
      }, 3000);
    } catch (error) {
      setTimedNotice('print-templates', setPrintTemplatesNotice, {
        tone: 'error',
        message: getErrorMessage(error, 'Kh?ng th? d?t mẫu in m?c d?nh.'),
      });
    }
  };

  const previewTemplate = useMemo(
    () => buildPreviewPrintTemplate(printTemplateForm, printTemplateEdit, printTemplateLogoPreviewUrl),
    [printTemplateEdit, printTemplateForm, printTemplateLogoPreviewUrl],
  );

  const saveNegativeStockSettings = async ({ enabled = negativeStockSettings.enabled, limitInput = negativeStockLimitInput, successMessage = 'Luu c?i d?t th?nh c?ng' } = {}) => {
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
        message: getErrorMessage(error, 'Kh?ng th? luu c?u h?nh xu?t ?m tồn kho qua API /api/settings/negative-stock.'),
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
      successMessage: nextEnabled ? '?? b?t ch? d? xu?t ?m' : '?? t?t ch? d? xu?t ?m',
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
        successMessage: 'Luu c?i d?t th?nh c?ng',
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
        setUpdateNotice(result.updateAvailable ? `C? b?n cập nhật ${result.updateInfo?.version}.` : 'ứng dụng dang ? phi?n b?n m?i nh?t.');
      } else if (busyKey === 'downloading') {
        setUpdateNotice('?? t?i v? xác thực g?i cập nhật. Ch?n Cập nhật ngay ho?c ?? sau.');
      } else if (busyKey === 'installing') {
        setUpdateNotice('đang c?i d?t cập nhật. ứng dụng s? restart theo electron-updater.');
      }
      return result;
    } catch (error) {
      const nextError = {
        code: error?.code || 'UNKNOWN_ERROR',
        message: error?.message || '?? x?y ra l?i cập nhật.',
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
    if (!window.confirm('ứng dụng s? t?o backup database r?i c?i d?t v? kh?i d?ng l?i. Ti?p t?c?')) return null;
    return runUpdateAction('installing', updates => updates.install());
  };

  const handleOpenInstallerDownload = async (installer) => {
    const url = buildReleaseDownloadUrl(installer.fileName);
    setUpdateNotice(`đang ki?m tra link t?i ${installer.label} tru?c khi m? tr?nh duy?t...`);

    try {
      let verified = null;
      if (window.khaDesktop?.verifyDownloadUrl) {
        verified = await window.khaDesktop.verifyDownloadUrl(url);
        if (!verified?.ok) throw new Error(verified?.error?.message || 'Link t?i kh?ng vu?t qua ki?m tra an to?n.');
      }

      const detail = verified?.contentLength
        ? `HTTP ${verified.statusCode}, ${formatBytes(verified.contentLength)}, ${verified.contentType || 'Content-Type kh?ng r?'}`
        : '?? ki?m tra d?nh d?ng t?n file v? HTTP.';
      setUpdateNotice(`Link t?i ${installer.label} h?p l? (${detail}). đang m? tr?nh duy?t m?c d?nh. N?u SmartScreen/antivirus c?nh b?o, ch? tiếp tục khi file d?ng t?n ${installer.fileName} v? URL thu?c github.com/Vankhadev/phanmemoffline.`);

      if (window.khaDesktop?.openExternal) {
        const opened = await window.khaDesktop.openExternal(url);
        if (!opened?.ok) throw new Error(opened?.error?.message || 'Kh?ng m? du?c link t?i b?ng tr?nh duy?t m?c d?nh.');
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      setUpdateNotice(`Kh?ng m? link t?i v? ki?m tra th?t b?i: ${error?.message || 'kh?ng r?'}. H?y ki?m tra m?ng, GitHub Release public v? d?m b?o kh?ng t?i nh?m file r?ng/trang HTML. URL: ${url}`);
    }
  };

  const tabs = useMemo(() => {
    const nextTabs = [];
    if (canViewStore) nextTabs.push({ key: 'store', label: 'C?a h?ng', icon: <Store size={16} /> });
    if (canViewEmployees) nextTabs.push({ key: 'employees', label: 'Nh?n vi?n', icon: <Users size={16} /> });
    if (canViewCustomerTypes) nextTabs.push({ key: 'customer-types', label: 'Lo?i kh?ch', icon: <Tag size={16} /> });
    if (canViewNegativeStock) nextTabs.push({ key: 'negative-stock', label: 'Xu?t ?m', icon: <Package size={16} /> });
    if (canViewPrintTemplates) nextTabs.push({ key: 'print-templates', label: 'M?u in h?a don', icon: <FileText size={16} /> });
    if (canAccessSection(['settings.read', 'settings.manage'])) nextTabs.push({ key: 'backup', label: 'Backup', icon: <Image size={16} /> });
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
  const currentVersion = appInfo?.version || updateState?.currentVersion || 'Kh?ng r?';
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
            <h1 className="text-xl font-bold">C?i d?t hệ thống</h1>
            <p className="text-sm text-gray-500">
              Qu?n l? c?a h?ng, nh?n vi?n, lo?i kh?ch h?ng, xu?t ?m tồn kho v? cập nhật ứng dụng.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowHelp(true)}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <HelpCircle size={16} /> Hu?ng d?n
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
            <span>đang t?i dữ liệu c?i d?t...</span>
          </div>
        </div>
      ) : null}

      {!initialLoading && tab === 'store' && (
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <Store size={18} />
            <h2 className="font-bold">Th?ng tin c?a h?ng</h2>
          </div>

          <SectionNotice notice={storeNotice} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <InputField
              id="store-name"
              label="T?n c?a h?ng"
              value={storeForm.name}
              onChange={event => updateStoreField('name', event.target.value)}
              placeholder="V? d?: C?a h?ng V?n Kha"
            />
            <InputField
              id="store-phone"
              label="S? di?n tho?i"
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
              label="M? s? thu?"
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
              {storeSaving ? 'đang luu...' : 'Luu thay d?i'}
            </button>
            <span className="text-xs text-gray-500">
              C?c thay d?i n?y ?nh hu?ng tr?c ti?p d?n th?ng tin hi?n th? tr?n h?a don v? c?c trang d?ng dữ liệu c?a h?ng.
            </span>
          </div>
        </div>
      )}

      {!initialLoading && tab === 'employees' && (
        <div className="card space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="font-bold flex items-center gap-2">
              <Users size={18} /> Nh?n vi?n ({employees.length})
            </h2>
            {canManageEmployees && (
              <button
                type="button"
                onClick={openAddEmp}
                className="btn-primary inline-flex min-h-10 items-center gap-2 text-sm"
              >
                <Plus size={14} /> Th?m nh?n vi?n m?i
              </button>
            )}
          </div>

          <SectionNotice notice={employeesNotice} />

          {employeesLoading ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
              <div className="inline-flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                đang t?i danh s?ch nh?n vi?n...
              </div>
            </div>
          ) : employees.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
              Chua c? nh?n vi?n n?o.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-3 text-left">H? t?n</th>
                    <th className="px-3 py-3 text-left">Email</th>
                    <th className="px-3 py-3 text-left">S?T</th>
                    <th className="px-3 py-3 text-left">Vai tr?</th>
                    <th className="px-3 py-3 text-left">đang nh?p g?n nh?t</th>
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
                              <Edit2 size={12} /> S?a
                            </button>
                            {employee.role !== 'admin' && (
                              <button
                                type="button"
                                onClick={() => handleDeleteEmp(employee.id)}
                                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-100"
                              >
                                <Trash2 size={12} /> X?a
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
              <Tag size={18} /> Lo?i kh?ch h?ng ({customerTypes.length})
            </h2>
            {canManageCustomerTypes && (
              <button
                type="button"
                onClick={openAddType}
                className="btn-primary inline-flex min-h-10 items-center gap-2 text-sm"
              >
                <Plus size={14} /> Th?m lo?i kh?ch
              </button>
            )}
          </div>

          <SectionNotice notice={customerTypesNotice} />

          {customerTypesLoading ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
              <div className="inline-flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                đang t?i lo?i kh?ch h?ng...
              </div>
            </div>
          ) : customerTypes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
              Chua c? lo?i kh?ch h?ng n?o.
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
                          title="S?a lo?i kh?ch"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteType(type.id)}
                          className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-600 hover:bg-red-100"
                          title="X?a lo?i kh?ch"
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
                Qu?n l? vi?c cho ph?p xu?t vu?t tồn kho hi?n c?. {NEGATIVE_STOCK_FEATURE_DESCRIPTION}
              </p>
            </div>
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${negativeStockSettings.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>
              <span className={`h-2 w-2 rounded-full ${negativeStockSettings.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              {negativeStockSettings.enabled ? 'đang b?t' : 'đang t?t'}
            </span>
          </div>

          <SectionNotice notice={negativeStockNotice} />

          <div className="rounded-3xl border border-white/70 bg-white/70 p-4 shadow-xl shadow-emerald-900/10 backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="font-semibold text-gray-800 dark:text-slate-100">Cho ph?p xu?t ?m tồn kho s?n ph?m</div>
                <p className="text-sm text-gray-600 dark:text-slate-300">
                  Khi b?t, hệ thống cho ph?p xu?t vu?t tồn kho hi?n c? theo s? lu?ng ?m t?i da admin nh?p. Khi t?t, hệ thống ch?n m?i tru?ng h?p l?m tồn kho nh? hon <strong>0</strong>.
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={negativeStockSettings.enabled}
                aria-label={negativeStockSettings.enabled ? 'T?t cho ph?p xu?t ?m tồn kho' : 'B?t cho ph?p xu?t ?m tồn kho'}
                aria-busy={negativeStockSaving}
                onClick={handleToggleNegativeStock}
                disabled={negativeStockSaving || !canManageNegativeStock || (negativeStockSettings.enabled && Boolean(negativeStockLimitInputError))}
                className={`inline-flex min-h-14 w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left shadow-sm transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${negativeStockSettings.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'} disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">
                      {negativeStockSettings.enabled ? 'đang b?t' : 'đang t?t'}
                    </span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${negativeStockSettings.enabled ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'}`}>
                      {negativeStockSettings.enabled ? 'ON' : 'OFF'}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs font-medium opacity-80">
                    {negativeStockSaving ? 'đang luu thay d?i...' : 'Ch?m d? b?t/t?t nhanh'}
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
                  <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">S? lu?ng ?m t?i da cho ph?p</span>
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
                    <span className="block text-xs text-gray-500 dark:text-slate-400">Nh?p 10 nghia l? t?n t?i thi?u -10. Gi? tr? hi?n t?i: {negativeStockAdminLimitLabel}; runtime d?ng t?n t?i thi?u {negativeStockRuntimeLimitLabel}.</span>
                  )}
                </label>

                <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
                  <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Gi?i h?n hi?n t?i</div>
                  <div className="mt-1 text-lg font-bold">{negativeStockAdminLimitLabel} ? t?n t?i thi?u {negativeStockRuntimeLimitLabel}</div>
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
                  {negativeStockSaving ? 'đang luu...' : 'Luu gi?i h?n'}
                </button>
                <button
                  type="button"
                  onClick={loadNegativeStockSettings}
                  disabled={negativeStockSaving}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  T?i l?i t? API
                </button>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
            <div className="font-semibold">Nguy?n t?c ?p d?ng</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Khi t?t: backend kh?ng cho xu?t n?u t?n d? ki?n nh? hon 0.</li>
              <li>Khi b?t: admin nh?p {negativeStockAdminLimitLabel}, backend cho ph?p t?n sau xu?t gi?m t?i da d?n {negativeStockRuntimeLimitLabel}.</li>
              <li>N?u vu?t gi?i h?n, backend trở lại r? t?n s?n ph?m, t?n hi?n t?i, s? lu?ng xu?t v? gi?i h?n t?i thi?u.</li>
              <li>Frontend d?c/ghi tr?c ti?p qua API /api/settings/negative-stock v? kh?ng c?n d?ng gi?i h?n hard-code.</li>
            </ul>
          </div>

          {!canManageNegativeStock && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              T?i kho?n hi?n t?i ch? c? quy?n xem tr?ng th?i xu?t ?m tồn kho v? kh?ng th? thay d?i c?u h?nh n?y.
            </div>
          )}
        </div>
      )}

      {!initialLoading && tab === 'print-templates' && (
        <div className="card space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="font-bold flex items-center gap-2">
                <FileText size={18} /> M?u in h?a don ({printTemplates.length})
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Qu?n l? m?u in d?ng cho h?a ??n th?t qua API /api/print-templates, editor Canva-like k?o th?, resize, publish sang layout in th?t.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadPrintTemplates}
                disabled={printTemplatesLoading}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                <Loader2 size={14} className={printTemplatesLoading ? 'animate-spin' : ''} /> T?i l?i
              </button>
              {canManagePrintTemplates && (
                <button type="button" onClick={openAddPrintTemplate} disabled={printTemplateSaving} className="btn-primary inline-flex min-h-10 items-center gap-2 text-sm disabled:opacity-60">
                  {printTemplateSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Th?m mẫu in
                </button>
              )}
            </div>
          </div>

          <SectionNotice notice={printTemplatesNotice} />

          {printTemplatesLoading ? (
            <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
              <div className="inline-flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" /> đang t?i danh s?ch mẫu in...
              </div>
            </div>
          ) : printTemplates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
              {canManagePrintTemplates && (
                <div className="mb-4 flex flex-wrap justify-center gap-2">
                  <button type="button" onClick={openDemoPrintTemplateEditor} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100">
                    <Edit2 size={14} /> Thi?t k? th?
                  </button>
                </div>
              )}
              Chua c? mẫu in h?a don. Nh?n ?Th?m mẫu in? d? t?o m?u d?u ti?n.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {printTemplates.map(template => (
                <div key={template.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-gray-900">{template.template_name || template.name || 'M?u in h?a don'}</h3>
                        {template.is_default && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700"><Star size={12} /> M?c d?nh</span>}
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{template.paper_size} ? {template.orientation === 'landscape' ? 'Ngang' : 'D?c'}</span>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">{template.description || template.shop_name || 'Kh?ng c? m? t?.'}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                        <span>Font {template.settings.fontSize}pt</span>
                        <span>Scale {Math.round(template.settings.scale * 100)}%</span>
                        <span>Padding {template.settings.paddingMm}mm</span>
                        <span>B?ng {template.settings.tableWidthPercent}%</span>
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
                            <Star size={12} /> ??t m?c d?nh
                          </button>
                        )}
                        <button type="button" onClick={() => handleDeletePrintTemplate(template)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-100">
                          <Trash2 size={12} /> X?a
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">T?i kho?n ch? c? quy?n xem mẫu in.</span>
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
                  <Image size={18} /> Qu?n l? Backup
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Backup d?nh k? m?i 72 gi?, gi? t?i da 30 b?n g?n nh?t, n?n ZIP v? luu lịch sử v?o b?ng system_backups / backup_logs.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={loadBackups} disabled={backupLoading} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                  <Loader2 size={16} className={backupLoading ? 'animate-spin' : ''} /> T?i l?i
                </button>
                <button type="button" onClick={async () => { setBackupNotice(null); try { await dataGuardianApi.backupNow(); await loadBackups(); setBackupNotice({ tone: 'success', message: '?? t?o backup th? c?ng.' }); } catch (error) { setBackupNotice({ tone: 'error', message: getErrorMessage(error, 'Kh?ng th? t?o backup th? c?ng.') }); } }} disabled={backupLoading} className="btn-success inline-flex min-h-10 items-center gap-2 disabled:opacity-60">
                  <CheckCircle size={16} /> Backup ngay
                </button>
              </div>
            </div>

            <SectionNotice notice={backupNotice} />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="rounded-xl border bg-gray-50 p-4"><div className="text-xs text-gray-500">L?n backup g?n nh?t</div><div className="mt-1 font-bold text-gray-900">{backupStatus?.lastBackupAt || 'Chua c?'}</div></div>
              <div className="rounded-xl border bg-gray-50 p-4"><div className="text-xs text-gray-500">L?n backup k? ti?p</div><div className="mt-1 font-bold text-gray-900">{backupStatus?.nextBackupAt || 'Chua x?c d?nh'}</div></div>
              <div className="rounded-xl border bg-gray-50 p-4"><div className="text-xs text-gray-500">T?ng s? file</div><div className="mt-1 font-bold text-gray-900">{backupStatus?.totalBackups ?? backupItems.length}</div></div>
              <div className="rounded-xl border bg-gray-50 p-4"><div className="text-xs text-gray-500">Tr?ng th?i</div><div className="mt-1 font-bold text-gray-900">{backupStatus?.scheduleRunning ? 'đang ch?y' : 'đang d?ng'}</div></div>
            </div>
          </div>

          <div className="card space-y-4">
            <h3 className="font-bold">Danh s?ch backup</h3>
            <div className="overflow-auto rounded-xl border">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">T?n file</th>
                    <th className="px-4 py-3">Ng?y t?o</th>
                    <th className="px-4 py-3">K?ch thu?c</th>
                    <th className="px-4 py-3">Lo?i</th>
                    <th className="px-4 py-3">Tr?ng th?i</th>
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
                          <button type="button" className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium hover:bg-gray-50" onClick={() => window.open(resolveApiUrl(`/data-guardian/download?path=${encodeURIComponent(item.path || '')}`), '_blank')}>T?i xu?ng</button>
                          <button type="button" className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100" onClick={async () => { if (!window.confirm(`Kh?i ph?c t? backup ${item.file || item.backup_name}?`)) return; setRestoringBackup(item.path); try { await dataGuardianApi.restore({ path: item.path }); setBackupNotice({ tone: 'success', message: '?? kh?i ph?c backup.' }); await loadBackups(); } catch (error) { setBackupNotice({ tone: 'error', message: getErrorMessage(error, 'Kh?ng th? kh?i ph?c backup.') }); } finally { setRestoringBackup(''); } }} disabled={restoringBackup === item.path}>Kh?i ph?c</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!backupItems.length && (
                    <tr><td colSpan="6" className="px-4 py-8 text-center text-gray-500">Chua c? backup n?o.</td></tr>
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
              {!backupLogs.length && <div className="text-gray-500">Chua c? log backup.</div>}
            </div>
          </div>
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
                  ứng dụng Electron c? th? t? ki?m tra, t? t?i v? ch? c?i d?t khi b?n x?c nh?n cập nhật.
                </p>
              </div>
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${updateState?.status === 'error' ? 'bg-red-100 text-red-700' : hasUpdate ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                {getUpdateStatusLabel(updateState?.status)}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
              <div className="rounded-xl border bg-gray-50 p-4">
                <div className="text-gray-500">Phi?n b?n hi?n t?i</div>
                <div className="mt-1 text-2xl font-bold text-gray-800">{currentVersion}</div>
                <div className="mt-2 text-xs text-gray-500">
                  N?n t?ng: {appInfo?.platform || window.khaDesktop?.platform || 'web'} ? Ki?n tr?c: {appInfo?.arch || 'unknown'}
                </div>
              </div>
              <div className="rounded-xl border bg-gray-50 p-4">
                <div className="text-gray-500">Feed cập nhật</div>
                <div className="mt-1 break-all font-medium text-gray-800">{manifestUrl || 'Chua n?p URL feed'}</div>
                <div className="mt-2 text-xs text-gray-500">Ngu?n: {manifestSourceLabel}</div>
                {updateState?.manifestUrlDefault && (
                  <div className="mt-2 inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                    đang d?ng GitHub Release feed m?c d?nh
                  </div>
                )}
              </div>
            </div>

            {updateLogPath && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                <div className="font-semibold text-gray-700">Log cập nhật</div>
                <div className="mt-1 break-all">{updateLogPath}</div>
                <div className="mt-1">Log n?y d?ng d? debug check/download/c?i d?t v? kh?ng ch?a token hay m?t kh?u.</div>
              </div>
            )}

            {runtimeDiagnostics && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                <div className="font-semibold text-gray-700">Ch?n do?n runtime updater</div>
                <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2">
                  <div>?? d?ng g?i: {runtimeDiagnostics.isPackaged ? 'C?' : 'Kh?ng'}</div>
                  <div>app-update.yml: {runtimeDiagnostics.appUpdateYmlExists ? 'C?' : 'Kh?ng th?y'}</div>
                  <div>Ki?n tr?c runtime: {runtimeArch || 'unknown'}</div>
                  <div>Tuong th?ch: {runtimeCompatibility?.supported === false ? 'Kh?ng' : 'C?'}</div>
                  <div className="break-all md:col-span-2">?u?ng d?n app-update.yml: {runtimeDiagnostics.appUpdateYmlPath || 'Kh?ng x?c d?nh'}</div>
                </div>
              </div>
            )}

            {runtimeCompatibility && (
              <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${runtimeCompatibility.supported === false ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                <div className="font-semibold">Tuong th?ch m?y Windows</div>
                <div className="mt-1">{runtimeCompatibility.message}</div>
                <div className="mt-1 text-xs">B? c?i khuy?n ngh?: {recommendedInstaller?.label || 'Windows x64'}.</div>
              </div>
            )}

            {!desktopAvailable && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                T?nh nang cập nhật ch? ho?t d?ng trong ứng dụng Electron d? c?i tr?n Windows. Khi ch?y frontend web d?c l?p, API cập nhật s? kh?ng kh? d?ng.
              </div>
            )}

            {updateNotice && (
              <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                {updateNotice}
              </div>
            )}

            {updateError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <div className="font-semibold">Kh?ng th? ho?n t?t thao t?c cập nhật</div>
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
                    <div className="text-sm text-gray-500">B?n m?i</div>
                    <div className="text-xl font-bold text-green-700">{updateInfo.version}</div>
                  </div>
                  <div className="text-xs text-gray-500 md:text-right">
                    <div>Ng?y ph?t h?nh: {formatDateTime(updateInfo.releaseDate)}</div>
                    <div>Dung lu?ng: {formatBytes(updateInfo.size)}</div>
                    {updateInfo.mandatory && <div className="font-semibold text-red-600">B?n cập nhật b?t bu?c</div>}
                  </div>
                </div>
                <div className="mt-3 text-sm">
                  <div className="mb-1 font-semibold text-gray-700">Ghi ch? ph?t h?nh</div>
                  <pre className="whitespace-pre-wrap rounded-lg border bg-gray-50 p-3 text-sm text-gray-700">
                    {updateInfo.releaseNotes || 'Kh?ng c? ghi ch? ph?t h?nh.'}
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
                ứng dụng dang ? phi?n b?n m?i nh?t. L?n ki?m tra: {formatDateTime(updateState.lastCheckedAt)}.
              </div>
            )}

            {updateState?.status === 'downloading' && (
              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span>Ti?n tr?nh t?i</span>
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
                electron-updater d? t?i v? xác thực g?i cập nhật th?nh c?ng. Khi b?m Cập nhật ngay, ứng dụng s? sao luu database tru?c khi c?i d?t v? kh?i d?ng l?i.
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCheckUpdate}
                disabled={!desktopAvailable || updateBusy === 'checking' || updateState?.status === 'downloading'}
                className="btn-primary disabled:opacity-60"
              >
                {updateBusy === 'checking' ? 'đang ki?m tra...' : 'Ki?m tra cập nhật'}
              </button>
              <button
                type="button"
                onClick={handleDownloadUpdate}
                disabled={!desktopAvailable || !hasUpdate || downloaded || updateState?.status === 'downloading'}
                className="btn-success disabled:opacity-60"
              >
                {updateBusy === 'downloading' ? 'đang t?i...' : 'T?i b?n cập nhật'}
              </button>
              {updateState?.status === 'downloading' && (
                <button
                  type="button"
                  onClick={handleCancelUpdate}
                  disabled={updateBusy === 'cancelling'}
                  className="btn-danger disabled:opacity-60"
                >
                  {updateBusy === 'cancelling' ? 'đang h?y...' : 'H?y t?i'}
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
            <h3 className="mb-3 font-bold">T?i b? c?i th? cứng dụng ki?n tr?c</h3>
            <div className="mb-3 rounded-lg border border-emerald-200 bg-white/70 px-3 py-2 text-xs">
              Lu?n t?i t? GitHub Release ch?nh th?c v? ch?n d?ng file cấu hình t? ki?n tr?c. N?u Windows b?o ?ứng dụng n?y kh?ng th? ch?y tr?n PC c?a b?n?, h?y th? b?n ia32 cho Windows 32-bit ho?c ki?m tra m?y c? h? tr? x64 kh?ng.
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {WINDOWS_INSTALLERS.map(installer => {
                const recommended = installer.arch === recommendedInstaller?.arch;
                const url = buildReleaseDownloadUrl(installer.fileName);
                return (
                  <div key={installer.arch} className="rounded-xl border border-emerald-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold text-gray-800">{installer.label}</div>
                      {recommended && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Khuy?n ngh? cho m?y n?y</span>}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{installer.recommendedFor}</div>
                    <div className="mt-2 break-all rounded bg-gray-50 p-2 text-xs text-gray-600">{installer.fileName}</div>
                    <button
                      type="button"
                      onClick={() => handleOpenInstallerDownload(installer)}
                      className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      T?i {installer.arch}
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
              <li>M?c d?nh app d?ng provider generic d? d?c tr?c ti?p latest.yml t? GitHub Release latest.</li>
              <li>Release production c?n c? installer x64 v? ia32, m?i file .exe c? .exe.blockmap tuong ?ng v? t?n asset r? ki?n tr?c.</li>
              <li>latest.yml v? update-manifest.json ph?i c?ng version, URL, sha256/sha512 v? size v?i asset d? upload.</li>
              <li>Khi repo ho?c release asset dang private, client Electron kh?ng th? t? cập nhật n?u kh?ng c? feed public ph? h?p.</li>
              <li>Tru?c khi c?i d?t, ứng dụng s? sao luu file database trong thu m?c userData/backups.</li>
            </ul>
          </div>
        </div>
      )}

      {showEmpModal && canManageEmployees && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="employee-modal-title">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="employee-modal-title" className="text-lg font-bold">
                {empEdit ? 'S?a nh?n vi?n' : 'Th?m nh?n vi?n'}
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
                  label="H? t?n"
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
                  label="S? di?n tho?i"
                  value={empForm.phone}
                  onChange={event => setEmpForm(current => ({ ...current, phone: event.target.value }))}
                />
                <InputField
                  id="emp-password"
                  label={empEdit ? 'M?t kh?u m?i (d? tr?ng n?u kh?ng d?i)' : 'M?t kh?u'}
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
                Vai tr? h? tr?: admin, k? to?n, thu ng?n, nh?n vi?n v? user cu. Khi t?o m?i, backend v?n t? c?p role ban d?u theo co ch? cu; client s? cập nhật l?i role d? ch?n ngay sau khi t?o n?u c? quy?n qu?n l? ngu?i d?ng.
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
                H?y
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
                {typeEdit ? 'S?a lo?i kh?ch' : 'Th?m lo?i kh?ch'}
              </h2>
              <button type="button" onClick={closeTypeModal} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <SectionNotice notice={typeNotice} />
              <InputField
                id="customer-type-name"
                label="T?n lo?i kh?ch"
                value={typeForm.name}
                onChange={event => setTypeForm(current => ({ ...current, name: event.target.value }))}
                placeholder="V? d?: Kh?ch VIP"
              />

              <div>
                <label htmlFor="customer-type-color" className="text-sm font-medium text-gray-700">
                  M?u s?c
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
                H?y
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
        title="Hu?ng d?n s? d?ng C?i d?t hệ thống"
        onClose={() => setShowHelp(false)}
        content={(
          <div className="space-y-4 text-sm text-gray-700">
            <div>
              <h3 className="mb-2 font-bold text-gray-800">T?ng quan</h3>
              <p>
                Trang C?i d?t cho ph?p c?u h?nh th?ng tin c?a h?ng, qu?n l? nh?n vi?n, lo?i kh?ch h?ng, b?t/t?t xu?t ?m tồn kho, mẫu in h?a don v? cập nhật ứng dụng Electron.
              </p>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab C?a h?ng</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Cập nhật t?n c?a h?ng, d?a ch?, s? di?n tho?i, email, m? s? thu? v? th?ng tin ng?n h?ng.</li>
                <li>Ph?n logo, ghi ch? v? slogan d?ng cho nh?n di?n c?a h?ng trong hệ thống.</li>
                <li>Sau khi chỉnh sửa, nh?n <strong>Luu thay d?i</strong> d? ghi xu?ng backend.</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Nh?n vi?n</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Th?m, s?a ho?c v? hi?u tài khoản nh?n vi?n.</li>
                <li>C? th? ch?n role Admin, K? to?n, Thu ng?n, Nh?n vi?n ho?c User cu d? gi? tuong th?ch dữ liệu legacy.</li>
                <li>Admin to?n quy?n; k? to?n truy c?p module k? to?n; thu ng?n ch? xem doanh thu; nh?n vi?n/user cu kh?ng v?o module k? to?n.</li>
                <li>Khi s?a nh?n vi?n, c? th? d? tr?ng m?t kh?u n?u kh?ng mu?n d?i.</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Lo?i kh?ch</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>T?o v? ch?nh m?u cho t?ng nh?m kh?ch h?ng.</li>
                <li>X?a lo?i kh?ch l? thao t?c soft-delete tr?n backend.</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Xu?t ?m</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>D?ng d? b?t/t?t cho ph?p xu?t ?m tồn kho s?n ph?m.</li>
                <li>Khi b?t, admin nh?p s? lu?ng ?m t?i da; v? d? nh?p {negativeStockAdminLimitLabel} th? t?n t?i thi?u runtime l? {negativeStockRuntimeLimitLabel}.</li>
                <li>Khi t?t, m?i thao t?c l?m tồn kho nh? hon 0 s? b? backend t? ch?i.</li>
                <li>? gi?i h?n luu qua API /api/settings/negative-stock v? du?c c?c m?n h?nh b?n h?ng/kho d?ng l?m runtime settings.</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab M?u in h?a don</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Danh s?ch mẫu in l?y t? API th?t <strong>/api/print-templates</strong>, khứng dụng mock cho CRUD ho?c editor ch?nh th?c.</li>
                <li>Editor Canva-like h? tr? k?o th?, resize, zoom, grid, snap, L?u v? Publish sang layout in th?t, preview b?ng h?a ??n th?t.</li>
                <li>Preview editor v? renderer in d?ng dữ liệu h?a don th?t t? API <strong>/api/invoices/:idOrCode/print</strong>; logo upload/x?a qua asset endpoint ri?ng.</li>
              </ul>
            </div>

            <div>
              <h3 className="mb-2 font-bold text-gray-800">Tab Cập nhật</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>Ch? ho?t d?ng khi ch?y b?n Electron d? d?ng g?i.</li>
                <li>App ch? c?i d?t sau khi ngu?i d?ng x?c nh?n v? s? sao luu database tru?c khi cập nhật.</li>
                <li>Khi c?n debug, c? th? xem du?ng d?n file update.log du?c hi?n th? trong trang.</li>
              </ul>
            </div>
          </div>
        )}
      />
    </div>
  );
}
