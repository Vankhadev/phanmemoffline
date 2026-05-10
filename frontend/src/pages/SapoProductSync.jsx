import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock3,
  Database,
  Eye,
  FileSpreadsheet,
  History,
  Info,
  KeyRound,
  Link2,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  Settings2,
  ShoppingBag,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import { sapoApi } from '../utils/apiClient';

const RESOURCE_KEYS = ['products', 'customers', 'invoices'];

const RESOURCE_META = {
  products: {
    label: 'Sản phẩm và biến thể',
    shortLabel: 'Sản phẩm',
    icon: ShoppingBag,
    empty: 'Chưa có dữ liệu preview sản phẩm.',
    idFields: ['sapo_product_id', 'key', 'sku'],
  },
  customers: {
    label: 'Khách hàng',
    shortLabel: 'Khách hàng',
    icon: Users,
    empty: 'Chưa có dữ liệu preview khách hàng.',
    idFields: ['sapo_customer_id', 'customer_code', 'key', 'phone', 'email'],
  },
  invoices: {
    label: 'Hóa đơn/đơn hàng',
    shortLabel: 'Hóa đơn',
    icon: FileSpreadsheet,
    empty: 'Chưa có dữ liệu preview hóa đơn.',
    idFields: ['sapo_order_id', 'key', 'invoice_code', 'sapo_order_number'],
  },
};

const DEFAULT_OPTIONS = {
  createMissingCategories: true,
  updateExistingProducts: true,
  syncImages: true,
  syncDescriptions: true,
  inventoryPolicy: 'overwrite',
  updateExistingCustomers: true,
  createMissingCustomers: true,
  updateExistingInvoices: false,
  allowUnresolvedInvoiceLines: false,
  invoiceStockPolicy: 'keep',
};

const EMPTY_RESOURCE_STATE = {
  products: { items: [], summary: null, warnings: [], errors: [], progress: null, result: null, runId: null },
  customers: { items: [], summary: null, warnings: [], errors: [], progress: null, result: null, runId: null },
  invoices: { items: [], summary: null, warnings: [], errors: [], progress: null, result: null, runId: null },
};

const ACTION_META = {
  create: { label: 'Tạo mới', badge: 'bg-green-100 text-green-700 border-green-200' },
  new: { label: 'Dữ liệu mới', badge: 'bg-green-100 text-green-700 border-green-200' },
  update: { label: 'Cần cập nhật', badge: 'bg-amber-100 text-amber-700 border-amber-200' },
  existing: { label: 'Đã tồn tại', badge: 'bg-blue-100 text-blue-700 border-blue-200' },
  conflict: { label: 'Conflict', badge: 'bg-red-100 text-red-700 border-red-200' },
  blocked: { label: 'Blocked', badge: 'bg-purple-100 text-purple-700 border-purple-200' },
  error: { label: 'Lỗi', badge: 'bg-red-100 text-red-700 border-red-200' },
  skipped: { label: 'Bỏ qua', badge: 'bg-gray-100 text-gray-600 border-gray-200' },
  duplicate: { label: 'Trùng', badge: 'bg-orange-100 text-orange-700 border-orange-200' },
};

const SUMMARY_CARDS = [
  { key: 'total', label: 'Tổng', tone: 'border-gray-200 bg-gray-50 text-gray-800' },
  { key: 'new', label: 'Mới', tone: 'border-green-200 bg-green-50 text-green-800', action: 'create' },
  { key: 'update', label: 'Cần cập nhật', tone: 'border-amber-200 bg-amber-50 text-amber-800', action: 'update' },
  { key: 'existing', label: 'Đã tồn tại', tone: 'border-blue-200 bg-blue-50 text-blue-800', action: 'existing' },
  { key: 'conflicts', label: 'Conflict', tone: 'border-red-200 bg-red-50 text-red-800', action: 'conflict' },
  { key: 'blocked', label: 'Blocked', tone: 'border-purple-200 bg-purple-50 text-purple-800', action: 'blocked' },
  { key: 'errors', label: 'Lỗi', tone: 'border-red-200 bg-red-50 text-red-800', action: 'error' },
  { key: 'skipped', label: 'Bỏ qua', tone: 'border-gray-200 bg-gray-50 text-gray-700', action: 'skipped' },
];

const IMPORT_FIELDS = [
  { key: 'customer_code', label: 'Mã khách hàng' },
  { key: 'name', label: 'Tên khách hàng', required: true },
  { key: 'phone', label: 'Số điện thoại' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Địa chỉ' },
  { key: 'note', label: 'Ghi chú' },
  { key: 'customer_type', label: 'Loại khách' },
  { key: 'tax_code', label: 'Mã số thuế' },
];

const IMPORT_ALIASES = {
  customer_code: ['customer_code', 'ma khach hang', 'ma kh', 'code', 'customer code', 'mã khách hàng', 'mã kh'],
  name: ['name', 'ten khach hang', 'ho ten', 'khach hang', 'customer name', 'full name', 'tên khách hàng', 'họ tên', 'khách hàng'],
  phone: ['phone', 'dien thoai', 'sdt', 'so dien thoai', 'mobile', 'tel', 'điện thoại', 'sđt', 'số điện thoại'],
  email: ['email', 'mail', 'e-mail'],
  address: ['address', 'dia chi', 'địa chỉ'],
  note: ['note', 'ghi chu', 'notes', 'ghi chú'],
  customer_type: ['customer_type', 'loai khach', 'nhom khach', 'group', 'type', 'loại khách', 'nhóm khách'],
  tax_code: ['tax_code', 'ma so thue', 'mst', 'tax code', 'tax number', 'mã số thuế'],
};

function safeArray(value) {
  if (Array.isArray(value)) return value;
  return [];
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)));
}

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value) || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value) || 0);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('vi-VN');
}

function getErrorMessage(err, fallback = 'Thao tác thất bại.') {
  if (Array.isArray(err?.data?.errors) && err.data.errors.length > 0) {
    const first = err.data.errors.find(Boolean);
    if (typeof first === 'string') return first;
    if (first?.message) return first.message;
  }
  return err?.data?.message || err?.data?.error || err?.message || fallback;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .trim();
}

function normalizeColumn(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function buildInitialConfig(settings = {}) {
  return {
    storeUrl: settings.base_url || settings.shop || '',
    accessToken: '',
    apiVersion: settings.api_version || settings.apiVersion || '2024-04',
  };
}

function buildInitialFilters() {
  return {
    products: { query: '', action: 'all', issuesOnly: false },
    customers: { query: '', action: 'all', issuesOnly: false },
    invoices: { query: '', action: 'all', issuesOnly: false },
    import: { query: '', action: 'all', issuesOnly: false },
  };
}

function extractResourceItems(data, resource) {
  if (Array.isArray(data?.analysis?.[resource]?.items)) return data.analysis[resource].items;
  if (Array.isArray(data?.items?.[resource]?.results)) return data.items[resource].results;
  if (Array.isArray(data?.items?.[resource]?.items)) return data.items[resource].items;
  if (Array.isArray(data?.results?.[resource]?.results)) return data.results[resource].results;
  if (Array.isArray(data?.results?.[resource]?.items)) return data.results[resource].items;
  if (data?.resource === resource && Array.isArray(data?.items)) return data.items;
  if (data?.resource === resource && Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function extractResourceSummary(data, resource) {
  if (data?.analysis?.[resource]?.summary && typeof data.analysis[resource].summary === 'object') return data.analysis[resource].summary;
  if (data?.summary?.[resource] && typeof data.summary[resource] === 'object') return data.summary[resource];
  if (data?.resource === resource && data?.summary && typeof data.summary === 'object') return data.summary;
  if (data?.summary && typeof data.summary === 'object' && !RESOURCE_KEYS.some(key => data.summary[key])) return data.summary;
  return null;
}

function extractProgress(data, resource) {
  if (data?.progress?.[resource]) return data.progress[resource];
  return data?.progress || null;
}

function getAction(item) {
  return String(item?.action || item?.status || '').trim() || 'existing';
}

function getBadgeMeta(action) {
  return ACTION_META[action] || { label: action || 'Không rõ', badge: 'bg-gray-100 text-gray-600 border-gray-200' };
}

function getSummaryValue(summary = {}, key, resource = '') {
  if (!summary || typeof summary !== 'object') return 0;
  if (key === 'total') return Number(summary.total ?? summary.count ?? 0) || 0;
  if (key === 'new') {
    return Number(summary.new ?? summary.create ?? summary.created ?? 0)
      + Number(resource === 'products' ? (summary.createdParents ?? 0) + (summary.createdVariants ?? 0) : 0);
  }
  if (key === 'update') {
    return Number(summary.update ?? summary.updated ?? 0)
      + Number(resource === 'products' ? (summary.updatedParents ?? 0) + (summary.updatedVariants ?? 0) : 0);
  }
  if (key === 'existing') {
    return Number(summary.existing ?? 0)
      + Number(resource === 'products' ? (summary.existingParents ?? 0) + (summary.existingVariants ?? 0) : 0);
  }
  if (key === 'conflicts') return Number(summary.conflicts ?? summary.conflict ?? 0) || 0;
  if (key === 'blocked') return Number(summary.blocked ?? 0) || 0;
  if (key === 'errors') return Number(summary.errors ?? summary.error ?? 0) || 0;
  if (key === 'skipped') return Number(summary.skipped ?? 0) || 0;
  return Number(summary[key] ?? 0) || 0;
}

function computeSummaryFromItems(items = []) {
  const summary = { total: items.length, create: 0, new: 0, update: 0, existing: 0, conflicts: 0, blocked: 0, errors: 0, skipped: 0, duplicate: 0 };
  for (const item of items) {
    const action = getAction(item);
    if (action === 'create') {
      summary.create += 1;
      summary.new += 1;
    } else if (action === 'conflict') summary.conflicts += 1;
    else if (action === 'error') summary.errors += 1;
    else if (summary[action] !== undefined) summary[action] += 1;
  }
  return summary;
}

function itemMatchesFilter(item, filter = {}) {
  const action = getAction(item);
  if (filter.action && filter.action !== 'all' && action !== filter.action) return false;
  if (filter.issuesOnly && !['conflict', 'blocked', 'error', 'duplicate'].includes(action)) return false;
  const query = normalizeText(filter.query);
  if (!query) return true;
  const haystack = normalizeText([
    item?.name,
    item?.sku,
    item?.barcode,
    item?.customer_code,
    item?.phone,
    item?.email,
    item?.invoice_code,
    item?.sapo_order_number,
    item?.customer_name,
    item?.key,
    item?.message,
    safeArray(item?.warnings).join(' '),
    safeArray(item?.errors).map(error => error?.message || error).join(' '),
  ].join(' '));
  return haystack.includes(query);
}

function getItemStableKey(item, resource, index = 0) {
  const fields = RESOURCE_META[resource]?.idFields || ['id', 'key'];
  for (const field of fields) {
    if (item?.[field]) return String(item[field]);
  }
  return String(item?.id || item?.line || item?.rowIndex || index);
}

function getSelectionApiId(item, resource, index = 0) {
  if (resource === 'products') return String(item?.sapo_product_id || item?.key || item?.sku || index || '').trim();
  if (resource === 'customers') return String(item?.sapo_customer_id || item?.customer_code || item?.key || item?.phone || item?.email || index || '').trim();
  if (resource === 'invoices') return String(item?.sapo_order_id || item?.key || item?.invoice_code || item?.sapo_order_number || index || '').trim();
  return String(item?.id || item?.key || index || '').trim();
}

function normalizeProductGroups(items = []) {
  return safeArray(items).map((item, index) => {
    const parentKey = getItemStableKey(item, 'products', index);
    const parentId = `p:${parentKey}`;
    const parentApiId = getSelectionApiId(item, 'products', index);
    const children = safeArray(item?.variants).map((variant, variantIndex) => {
      const variantKey = String(variant?.sapo_variant_id || variant?.key || variant?.sku || variant?.name || variantIndex);
      return {
        ...variant,
        __id: `v:${parentKey}:${variantKey}`,
        __kind: 'variant',
        __parentId: parentId,
        __parentApiId: parentApiId,
        __parentName: item?.name || '',
        __variantApiId: String(variant?.sapo_variant_id || variant?.variant_id || variant?.key || variant?.sku || '').trim(),
      };
    });
    return {
      ...item,
      __id: parentId,
      __kind: 'parent',
      __apiId: parentApiId,
      children,
    };
  });
}

function getVisibleProductRowIds(groups = []) {
  return groups.flatMap(group => [group.__id, ...group.children.map(child => child.__id)]);
}

function filterProductGroups(groups = [], filter = {}) {
  return groups
    .map(group => {
      const groupMatches = itemMatchesFilter(group, filter);
      const children = group.children.filter(child => itemMatchesFilter(child, filter) || groupMatches);
      if (groupMatches || children.length > 0) return { ...group, children: groupMatches ? group.children : children };
      return null;
    })
    .filter(Boolean);
}

function autoMapColumns(columns = []) {
  const mapping = {};
  for (const field of IMPORT_FIELDS) {
    const aliases = IMPORT_ALIASES[field.key] || [];
    const normalizedAliases = aliases.map(normalizeColumn);
    const direct = columns.find(column => normalizedAliases.includes(normalizeColumn(column)));
    if (direct) mapping[field.key] = direct;
  }
  return mapping;
}

function parseWorksheetRows(workbook, sheetName) {
  const worksheet = workbook?.Sheets?.[sheetName];
  if (!worksheet) return { rows: [], columns: [] };
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });
  const normalizedRows = rows.map((row, index) => ({ ...row, __line: index + 2 }));
  const columns = [];
  const seen = new Set();
  for (const row of normalizedRows) {
    Object.keys(row).forEach(column => {
      if (column === '__line' || seen.has(column)) return;
      seen.add(column);
      columns.push(column);
    });
  }
  return { rows: normalizedRows, columns };
}

function IndeterminateCheckbox({ indeterminate = false, className = '', ...props }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" className={className} {...props} />;
}

function StatusBanner({ status, onClose }) {
  if (!status?.message) return null;
  const className = status.tone === 'success'
    ? 'bg-green-50 border-green-200 text-green-800'
    : status.tone === 'warning'
      ? 'bg-amber-50 border-amber-200 text-amber-800'
      : status.tone === 'error'
        ? 'bg-red-50 border-red-200 text-red-700'
        : 'bg-blue-50 border-blue-200 text-blue-800';
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm flex items-start gap-2 ${className}`}>
      {status.tone === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
      <div className="flex-1 whitespace-pre-line">{status.message}</div>
      {onClose && <button onClick={onClose} className="opacity-70 hover:opacity-100"><X size={16} /></button>}
    </div>
  );
}

function ActionBadge({ action }) {
  const meta = getBadgeMeta(action);
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.badge}`}>{meta.label}</span>;
}

function BusyButton({ busy, disabled, children, className = '', ...props }) {
  return (
    <button disabled={busy || disabled} className={`${className} disabled:opacity-60 disabled:cursor-not-allowed`} {...props}>
      {busy ? <span className="inline-flex items-center gap-1.5"><Loader2 size={15} className="animate-spin" /> Đang chạy...</span> : children}
    </button>
  );
}

function SummaryGrid({ resource, summary, onOpen }) {
  const safeSummary = summary || {};
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
      {SUMMARY_CARDS.map(card => {
        const value = getSummaryValue(safeSummary, card.key, resource);
        return (
          <button
            key={`${resource}-${card.key}`}
            type="button"
            onClick={() => onOpen?.(card)}
            className={`rounded-xl border p-3 text-left hover:shadow-sm transition ${card.tone}`}
          >
            <div className="text-[11px] font-medium opacity-75">{card.label}</div>
            <div className="text-xl font-bold leading-tight">{formatNumber(value)}</div>
          </button>
        );
      })}
    </div>
  );
}

function ProgressBox({ data }) {
  if (!data) return null;
  const entries = Array.isArray(data)
    ? data.map((item, index) => [`Trang ${item.page || index + 1}`, item])
    : Object.entries(data);
  if (entries.length === 0) return null;
  return (
    <div className="rounded-xl border bg-slate-50 p-3 text-xs text-slate-700 space-y-1">
      <div className="font-semibold flex items-center gap-1"><Clock3 size={13} /> Tiến trình</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {entries.slice(0, 6).map(([key, value]) => (
          <div key={String(key)} className="rounded-lg bg-white border px-2 py-1">
            <span className="font-medium">{String(key)}:</span>{' '}
            {typeof value === 'object' ? Object.entries(value || {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : v}`).join(', ') : String(value)}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultMessages({ warnings = [], errors = [] }) {
  const normalizedWarnings = safeArray(warnings);
  const normalizedErrors = safeArray(errors);
  if (normalizedWarnings.length === 0 && normalizedErrors.length === 0) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-sm">
      {normalizedWarnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
          <div className="font-semibold mb-1">Cảnh báo</div>
          <ul className="list-disc pl-5 space-y-1 max-h-28 overflow-auto">
            {normalizedWarnings.slice(0, 20).map((warning, index) => <li key={index}>{warning?.message || String(warning)}</li>)}
          </ul>
        </div>
      )}
      {normalizedErrors.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
          <div className="font-semibold mb-1">Lỗi</div>
          <ul className="list-disc pl-5 space-y-1 max-h-28 overflow-auto">
            {normalizedErrors.slice(0, 20).map((error, index) => <li key={index}>{error?.message || String(error)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function FiltersBar({ filter, onChange, placeholder = 'Tìm kiếm/lọc nhanh...', actions = ['all', 'create', 'update', 'existing', 'conflict', 'blocked', 'error', 'skipped'] }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-2">
      <div className="relative flex-1">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="input-field w-full pl-9 text-sm"
          placeholder={placeholder}
          value={filter.query}
          onChange={event => onChange({ ...filter, query: event.target.value })}
        />
      </div>
      <select className="input-field text-sm md:w-44" value={filter.action} onChange={event => onChange({ ...filter, action: event.target.value })}>
        {actions.map(action => <option key={action} value={action}>{action === 'all' ? 'Tất cả action/status' : getBadgeMeta(action).label}</option>)}
      </select>
      <label className="inline-flex items-center gap-2 text-sm px-3 py-2 border rounded-lg bg-white">
        <input type="checkbox" checked={filter.issuesOnly} onChange={event => onChange({ ...filter, issuesOnly: event.target.checked })} />
        Chỉ lỗi/conflict/blocked
      </label>
    </div>
  );
}

function ActionModal({ modal, onClose, selectedCount, onSyncAll, onSyncSelected, onSyncCurrent, busy }) {
  if (!modal) return null;
  const item = modal.item || null;
  const action = item ? getAction(item) : modal.action;
  const isProblem = ['conflict', 'blocked', 'error', 'duplicate'].includes(action);
  const canSyncResource = RESOURCE_KEYS.includes(modal.resource);
  const errors = safeArray(item?.errors);
  const warnings = safeArray(item?.warnings);
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b flex items-start justify-between gap-3 bg-slate-50">
          <div>
            <div className="text-lg font-bold flex items-center gap-2">
              <Info size={19} className="text-blue-600" /> {modal.title || 'Chi tiết đồng bộ'}
            </div>
            <div className="text-xs text-gray-500 mt-1">Resource: {RESOURCE_META[modal.resource]?.label || modal.resource}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>

        <div className="p-5 overflow-auto space-y-4 text-sm">
          {action && <ActionBadge action={action} />}
          {isProblem && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800 flex gap-2">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Dòng này cần xem lại trước khi đồng bộ.</div>
                <div className="mt-1">Conflict/blocked/error có thể do trùng dữ liệu local, thiếu sản phẩm/khách hàng phụ thuộc hoặc dữ liệu file không hợp lệ.</div>
              </div>
            </div>
          )}

          {item ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                ['Tên/Mã', item.name || item.customer_name || item.invoice_code || item.key || '—'],
                ['SKU/SĐT/Email', item.sku || item.phone || item.email || item.sapo_order_number || '—'],
                ['ID Sapo', item.sapo_product_id || item.sapo_variant_id || item.sapo_customer_id || item.sapo_order_id || '—'],
                ['ID local', item.existing_product_id || item.existing_id || item.local_id || '—'],
                ['Lý do match', item.match_reason || item.customer_match_reason || '—'],
                ['Trường thay đổi', safeArray(item.changed_fields).join(', ') || '—'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border bg-gray-50 px-3 py-2">
                  <div className="text-xs text-gray-500">{label}</div>
                  <div className="font-medium break-words">{String(value)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border bg-gray-50 p-4 text-gray-700">
              {modal.description || 'Bạn có thể đồng bộ toàn bộ dữ liệu, chỉ đồng bộ các mục đang chọn hoặc đóng hộp thoại để lọc/chọn lại.'}
            </div>
          )}

          {(safeArray(item?.conflicts).length > 0 || safeArray(item?.customer_conflicts).length > 0) && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
              <div className="font-semibold">Conflict local</div>
              <div className="mt-1">{[...safeArray(item?.conflicts), ...safeArray(item?.customer_conflicts)].join(', ')}</div>
            </div>
          )}

          {item?.message && <div className="rounded-xl border bg-gray-50 p-3">{item.message}</div>}
          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
              <div className="font-semibold">Cảnh báo</div>
              <ul className="list-disc pl-5 mt-1 space-y-1">{warnings.map((warning, index) => <li key={index}>{warning?.message || String(warning)}</li>)}</ul>
            </div>
          )}
          {errors.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">
              <div className="font-semibold">Lỗi dòng</div>
              <ul className="list-disc pl-5 mt-1 space-y-1">{errors.map((error, index) => <li key={index}>{error?.message || String(error)}</li>)}</ul>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t bg-gray-50 flex flex-wrap justify-end gap-2">
          {canSyncResource && <BusyButton busy={busy === 'all'} onClick={onSyncAll} className="btn-danger">Cập nhật/đồng bộ tất cả</BusyButton>}
          {canSyncResource && <BusyButton busy={busy === 'selected'} disabled={selectedCount === 0} onClick={onSyncSelected} className="btn-success">Đồng bộ mục đã chọn ({selectedCount})</BusyButton>}
          {canSyncResource && item && <BusyButton busy={busy === 'current'} onClick={onSyncCurrent} className="btn-primary">Đồng bộ dòng hiện tại</BusyButton>}
          <button onClick={onClose} className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-100">Bỏ qua/đóng</button>
        </div>
      </div>
    </div>
  );
}

export default function SapoProductSync() {
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(RESOURCE_KEYS.includes(requestedTab) ? requestedTab : 'products');
  const [settings, setSettings] = useState(null);
  const [config, setConfig] = useState(buildInitialConfig());
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [resourceData, setResourceData] = useState(EMPTY_RESOURCE_STATE);
  const [selected, setSelected] = useState({ products: [], customers: [], invoices: [], import: [] });
  const [runs, setRuns] = useState([]);
  const [status, setStatus] = useState({ tone: 'info', message: '' });
  const [busyMap, setBusyMap] = useState({});
  const [remoteQuery, setRemoteQuery] = useState('');
  const [limit, setLimit] = useState(50);
  const [maxPages, setMaxPages] = useState(5);
  const [resourceFilters, setResourceFilters] = useState(buildInitialFilters);
  const [expandedProducts, setExpandedProducts] = useState({});
  const [modal, setModal] = useState(null);
  const [modalBusy, setModalBusy] = useState('');
  const [enabledResources, setEnabledResources] = useState({ products: true, customers: true, invoices: true });
  const [excel, setExcel] = useState({
    fileName: '',
    workbook: null,
    sheets: [],
    selectedSheet: '',
    rows: [],
    columns: [],
    mapping: {},
    previewItems: [],
    previewSummary: null,
    previewErrors: [],
    previewWarnings: [],
    commitResult: null,
    mode: 'upsert',
  });

  const configured = Boolean(settings?.configured);
  const activeResourceState = resourceData[activeTab] || EMPTY_RESOURCE_STATE[activeTab];
  const productGroups = useMemo(() => normalizeProductGroups(resourceData.products.items), [resourceData.products.items]);
  const filteredProductGroups = useMemo(() => filterProductGroups(productGroups, resourceFilters.products), [productGroups, resourceFilters.products]);
  const filteredCustomers = useMemo(() => safeArray(resourceData.customers.items).filter(item => itemMatchesFilter(item, resourceFilters.customers)), [resourceData.customers.items, resourceFilters.customers]);
  const filteredInvoices = useMemo(() => safeArray(resourceData.invoices.items).filter(item => itemMatchesFilter(item, resourceFilters.invoices)), [resourceData.invoices.items, resourceFilters.invoices]);
  const filteredImportItems = useMemo(() => safeArray(excel.previewItems).filter(item => itemMatchesFilter(item, resourceFilters.import)), [excel.previewItems, resourceFilters.import]);

  const selectedSet = useMemo(() => ({
    products: new Set(selected.products),
    customers: new Set(selected.customers),
    invoices: new Set(selected.invoices),
    import: new Set(selected.import),
  }), [selected]);

  const isBusy = key => Boolean(busyMap[key]);
  const showStatus = (tone, message) => setStatus({ tone, message });
  const setOption = (key, value) => setOptions(prev => ({ ...prev, [key]: value }));
  const setFilter = (key, filter) => setResourceFilters(prev => ({ ...prev, [key]: filter }));

  const runAction = async (key, action) => {
    setBusyMap(prev => ({ ...prev, [key]: true }));
    try {
      return await action();
    } catch (err) {
      showStatus('error', getErrorMessage(err));
      return null;
    } finally {
      setBusyMap(prev => ({ ...prev, [key]: false }));
    }
  };

  const buildRequestPayload = () => ({
    storeUrl: config.storeUrl,
    shop: config.storeUrl,
    ...(config.accessToken ? { accessToken: config.accessToken } : {}),
    apiVersion: config.apiVersion,
    options,
  });

  const loadSettings = async () => {
    try {
      const data = await sapoApi.getSettings();
      setSettings(data.settings || null);
      setConfig(buildInitialConfig(data.settings || {}));
      setOptions({ ...DEFAULT_OPTIONS, ...(data.settings?.options || {}) });
    } catch (err) {
      showStatus('error', getErrorMessage(err, 'Không tải được cấu hình Sapo.'));
    }
  };

  const loadRuns = async () => {
    try {
      const data = await sapoApi.getRuns({ limit: 20 });
      const items = Array.isArray(data.runs) ? data.runs : (Array.isArray(data.items) ? data.items : []);
      setRuns(items);
    } catch (_) {
      // Lịch sử không bắt buộc cho thao tác chính.
    }
  };

  useEffect(() => {
    loadSettings();
    loadRuns();
  }, []);

  useEffect(() => {
    if (searchParams.get('import') === '1') setActiveTab('customers');
  }, [searchParams]);

  const updateResourceFromResponse = (resource, data) => {
    const items = extractResourceItems(data, resource);
    const summary = extractResourceSummary(data, resource) || computeSummaryFromItems(items);
    setResourceData(prev => ({
      ...prev,
      [resource]: {
        items,
        summary,
        warnings: safeArray(data?.warnings),
        errors: safeArray(data?.errors),
        progress: extractProgress(data, resource),
        result: data,
        runId: data?.run_id || data?.runId || null,
      },
    }));
    if (data?.settings) setSettings(data.settings);
    if (resource === 'products') {
      const groups = normalizeProductGroups(items);
      setExpandedProducts(prev => {
        const next = { ...prev };
        groups.slice(0, 20).forEach(group => { if (next[group.__id] === undefined) next[group.__id] = true; });
        return next;
      });
      setSelected(prev => ({ ...prev, products: getVisibleProductRowIds(groups) }));
    } else {
      setSelected(prev => ({ ...prev, [resource]: items.map((item, index) => `${resource}:${getItemStableKey(item, resource, index)}`) }));
    }
  };

  const handleSaveSettings = () => runAction('save', async () => {
    const data = await sapoApi.saveSettings(buildRequestPayload());
    setSettings(data.settings || null);
    setConfig(buildInitialConfig(data.settings || {}));
    showStatus('success', data.message || 'Đã lưu cấu hình Sapo.');
    return data;
  });

  const handleValidate = () => runAction('validate', async () => {
    const data = await sapoApi.validate(buildRequestPayload());
    if (data.settings) setSettings(data.settings);
    showStatus('success', data.message || 'Kết nối Sapo thành công.');
    return data;
  });

  const selectedResourceList = () => RESOURCE_KEYS.filter(resource => enabledResources[resource]);

  const handleAnalyze = () => runAction('analyze', async () => {
    const resources = selectedResourceList();
    const data = await sapoApi.analyze({
      ...buildRequestPayload(),
      resources,
      query: remoteQuery,
      limit,
      maxPages,
      allPages: true,
      fetchAll: true,
    });
    resources.forEach(resource => updateResourceFromResponse(resource, data));
    await loadRuns();
    showStatus(data.partial ? 'warning' : 'success', `Đã phân tích ${resources.map(resource => RESOURCE_META[resource].shortLabel).join(', ')}. Run #${data.run_id || '—'}`);
    return data;
  });

  const handlePreviewResource = (resource = activeTab) => runAction(`preview:${resource}`, async () => {
    const payload = { ...buildRequestPayload(), query: remoteQuery, limit, page: 1 };
    const apiCall = resource === 'products'
      ? sapoApi.previewProducts
      : resource === 'customers'
        ? sapoApi.previewCustomers
        : sapoApi.previewInvoices;
    const data = await apiCall(payload);
    updateResourceFromResponse(resource, data);
    showStatus('success', `Đã tải preview ${formatNumber(extractResourceItems(data, resource).length)} ${RESOURCE_META[resource].shortLabel.toLowerCase()} từ Sapo.`);
    return data;
  });

  const buildProductSelectionPayload = (mode = 'selected', item = null) => {
    if (mode === 'all') return { selectedProductIds: [], selectedVariantIds: [], syncAll: true };
    const rowIds = new Set();
    if (mode === 'current' && item) {
      rowIds.add(item.__id);
      if (item.__kind === 'parent') item.children?.forEach(child => rowIds.add(child.__id));
    } else {
      selected.products.forEach(id => rowIds.add(id));
    }

    const selectedProductIds = [];
    const selectedVariantIds = [];
    for (const group of productGroups) {
      const groupSelected = rowIds.has(group.__id);
      const selectedChildren = group.children.filter(child => rowIds.has(child.__id));
      if (groupSelected || selectedChildren.length > 0) selectedProductIds.push(group.__apiId);
      selectedChildren.forEach(child => selectedVariantIds.push(child.__variantApiId));
    }
    return { selectedProductIds: uniqueStrings(selectedProductIds), selectedVariantIds: uniqueStrings(selectedVariantIds), syncAll: false };
  };

  const buildFlatSelectionPayload = (resource, mode = 'selected', item = null) => {
    if (mode === 'all') return { selectedIds: [], syncAll: true };
    const items = safeArray(resourceData[resource]?.items);
    const ids = mode === 'current' && item
      ? [getSelectionApiId(item, resource)]
      : items
        .filter((row, index) => selected[resource].includes(`${resource}:${getItemStableKey(row, resource, index)}`))
        .map((row, index) => getSelectionApiId(row, resource, index));
    if (resource === 'customers') return { selectedCustomerIds: uniqueStrings(ids), selectedIds: uniqueStrings(ids), syncAll: false };
    if (resource === 'invoices') return { selectedInvoiceIds: uniqueStrings(ids), selectedOrderIds: uniqueStrings(ids), selectedIds: uniqueStrings(ids), syncAll: false };
    return { selectedIds: uniqueStrings(ids), syncAll: false };
  };

  const handleSyncResource = async (resource, mode = 'selected', item = null, modalKey = '') => {
    const selectedCount = resource === 'products' ? selected.products.length : selected[resource].length;
    if (mode === 'selected' && selectedCount === 0) {
      showStatus('error', `Vui lòng chọn ít nhất một ${RESOURCE_META[resource].shortLabel.toLowerCase()} để đồng bộ.`);
      return null;
    }

    if (modalKey) setModalBusy(modalKey);
    const result = await runAction(`sync:${resource}:${mode}`, async () => {
      const selectionPayload = resource === 'products' ? buildProductSelectionPayload(mode, item) : buildFlatSelectionPayload(resource, mode, item);
      const payload = {
        ...buildRequestPayload(),
        query: remoteQuery,
        limit,
        page: 1,
        maxPages,
        allPages: mode === 'all',
        fetchAll: mode === 'all',
        ...selectionPayload,
      };
      const apiCall = resource === 'products'
        ? sapoApi.syncProducts
        : resource === 'customers'
          ? sapoApi.syncCustomers
          : sapoApi.syncInvoices;
      const data = await apiCall(payload);
      updateResourceFromResponse(resource, data);
      await loadRuns();
      showStatus(data.partial ? 'warning' : 'success', `${data.message || 'Đồng bộ hoàn tất.'}${data.run_id ? ` Run #${data.run_id}.` : ''}`);
      return data;
    });
    if (modalKey) setModalBusy('');
    return result;
  };

  const handleSyncAllResources = () => runAction('syncAll', async () => {
    const resources = selectedResourceList();
    const data = await sapoApi.syncAll({
      ...buildRequestPayload(),
      resources,
      query: remoteQuery,
      limit,
      maxPages,
      allPages: true,
      fetchAll: true,
      syncAll: true,
    });
    resources.forEach(resource => updateResourceFromResponse(resource, data));
    await loadRuns();
    showStatus(data.partial ? 'warning' : 'success', `${data.message || 'Đồng bộ Sapo hoàn tất.'}${data.run_id ? ` Run #${data.run_id}.` : ''}`);
    return data;
  });

  const toggleEnabledResource = resource => setEnabledResources(prev => ({ ...prev, [resource]: !prev[resource] }));

  const toggleProductRow = (id, checked) => {
    setSelected(prev => {
      const set = new Set(prev.products);
      if (checked) set.add(id); else set.delete(id);
      return { ...prev, products: Array.from(set) };
    });
  };

  const toggleProductParent = (group, checked) => {
    const ids = [group.__id, ...group.children.map(child => child.__id)];
    setSelected(prev => {
      const set = new Set(prev.products);
      ids.forEach(id => checked ? set.add(id) : set.delete(id));
      return { ...prev, products: Array.from(set) };
    });
  };

  const toggleAllProducts = () => {
    const visibleIds = getVisibleProductRowIds(filteredProductGroups);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedSet.products.has(id));
    setSelected(prev => {
      const set = new Set(prev.products);
      visibleIds.forEach(id => allSelected ? set.delete(id) : set.add(id));
      return { ...prev, products: Array.from(set) };
    });
  };

  const toggleFlatRow = (resource, id) => {
    setSelected(prev => {
      const set = new Set(prev[resource]);
      if (set.has(id)) set.delete(id); else set.add(id);
      return { ...prev, [resource]: Array.from(set) };
    });
  };

  const toggleAllFlat = (resource, items) => {
    const ids = items.map((item, index) => `${resource}:${getItemStableKey(item, resource, index)}`);
    const allSelected = ids.length > 0 && ids.every(id => selectedSet[resource].has(id));
    setSelected(prev => {
      const set = new Set(prev[resource]);
      ids.forEach(id => allSelected ? set.delete(id) : set.add(id));
      return { ...prev, [resource]: Array.from(set) };
    });
  };

  const openSummaryModal = (resource, card) => {
    setModal({
      resource,
      action: card.action || '',
      title: `${RESOURCE_META[resource].label} · ${card.label}`,
      description: `Có ${formatNumber(getSummaryValue(resourceData[resource]?.summary, card.key, resource))} mục thuộc nhóm ${card.label.toLowerCase()}.`,
    });
  };

  const openRowModal = (resource, item) => {
    setModal({
      resource,
      item,
      action: getAction(item),
      title: item?.name || item?.customer_name || item?.invoice_code || item?.key || 'Chi tiết dòng',
    });
  };

  const handleExcelFile = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheets = workbook.SheetNames || [];
      const selectedSheet = sheets[0] || '';
      const parsed = parseWorksheetRows(workbook, selectedSheet);
      setExcel(prev => ({
        ...prev,
        fileName: file.name,
        workbook,
        sheets,
        selectedSheet,
        rows: parsed.rows,
        columns: parsed.columns,
        mapping: autoMapColumns(parsed.columns),
        previewItems: [],
        previewSummary: null,
        previewErrors: [],
        previewWarnings: [],
        commitResult: null,
      }));
      setSelected(prev => ({ ...prev, import: [] }));
      showStatus('success', `Đã đọc file Excel ${file.name} với ${formatNumber(parsed.rows.length)} dòng dữ liệu.`);
    } catch (err) {
      showStatus('error', `Không thể đọc file Excel: ${err.message}`);
    }
  };

  const handleSelectSheet = sheetName => {
    if (!excel.workbook) return;
    const parsed = parseWorksheetRows(excel.workbook, sheetName);
    setExcel(prev => ({
      ...prev,
      selectedSheet: sheetName,
      rows: parsed.rows,
      columns: parsed.columns,
      mapping: autoMapColumns(parsed.columns),
      previewItems: [],
      previewSummary: null,
      previewErrors: [],
      previewWarnings: [],
      commitResult: null,
    }));
    setSelected(prev => ({ ...prev, import: [] }));
  };

  const handleImportPreview = () => runAction('importPreview', async () => {
    if (excel.rows.length === 0) {
      showStatus('error', 'Vui lòng chọn file Excel có dữ liệu trước khi preview.');
      return null;
    }
    const data = await sapoApi.importCustomersPreview({ rows: excel.rows, mapping: excel.mapping });
    const items = Array.isArray(data.items) ? data.items : safeArray(data.results);
    setExcel(prev => ({
      ...prev,
      previewItems: items,
      previewSummary: data.summary || computeSummaryFromItems(items),
      previewErrors: safeArray(data.errors),
      previewWarnings: safeArray(data.warnings),
      commitResult: null,
    }));
    const selectable = items
      .filter(item => !['error', 'duplicate'].includes(getAction(item)))
      .map(item => `import:${item.line}:${item.rowIndex}`);
    setSelected(prev => ({ ...prev, import: selectable }));
    showStatus(data.ok === false ? 'warning' : 'success', `Preview import Excel hoàn tất: ${formatNumber(items.length)} dòng, ${formatNumber(safeArray(data.errors).length)} lỗi.`);
    return data;
  });

  const toggleAllImport = () => {
    const ids = filteredImportItems.map(item => `import:${item.line}:${item.rowIndex}`);
    const allSelected = ids.length > 0 && ids.every(id => selectedSet.import.has(id));
    setSelected(prev => {
      const set = new Set(prev.import);
      ids.forEach(id => allSelected ? set.delete(id) : set.add(id));
      return { ...prev, import: Array.from(set) };
    });
  };

  const commitSelectedImport = () => runAction('importCommit', async () => {
    if (selected.import.length === 0) {
      showStatus('error', 'Vui lòng chọn ít nhất một dòng preview để import.');
      return null;
    }
    const selectedIds = new Set(selected.import);
    const selectedItems = excel.previewItems.filter(item => selectedIds.has(`import:${item.line}:${item.rowIndex}`));
    const selectedRows = selectedItems
      .map(item => excel.rows[item.rowIndex])
      .filter(Boolean);
    if (selectedRows.length === 0) {
      showStatus('error', 'Không tìm thấy dữ liệu Excel tương ứng với các dòng đã chọn.');
      return null;
    }
    const data = await sapoApi.importCustomersCommit({ rows: selectedRows, mapping: excel.mapping, mode: excel.mode });
    const items = Array.isArray(data.items) ? data.items : safeArray(data.results);
    setExcel(prev => ({
      ...prev,
      commitResult: data,
      previewItems: items.length > 0 ? items : prev.previewItems,
      previewSummary: data.summary || prev.previewSummary,
      previewErrors: safeArray(data.errors),
      previewWarnings: safeArray(data.warnings),
    }));
    await loadRuns();
    showStatus(data.partial ? 'warning' : 'success', `${data.message || 'Import khách hàng hoàn tất.'}${data.run_id ? ` Run #${data.run_id}.` : ''}`);
    return data;
  });

  const selectedCountForModal = modal?.resource === 'products' ? selected.products.length : selected[modal?.resource]?.length || 0;

  const renderSettingsPanel = () => (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      <div className="xl:col-span-2 card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-bold flex items-center gap-2"><Link2 size={18} /> Cấu hình kết nối Sapo</h2>
          <span className={`text-xs px-3 py-1 rounded-full font-semibold ${configured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{configured ? 'Đã cấu hình' : 'Chưa cấu hình'}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600">Link cửa hàng Sapo</label>
            <input className="input-field w-full mt-1" placeholder="https://ten-shop.mysapo.net" value={config.storeUrl} onChange={event => setConfig(prev => ({ ...prev, storeUrl: event.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">API version</label>
            <input className="input-field w-full mt-1" placeholder="2024-04" value={config.apiVersion} onChange={event => setConfig(prev => ({ ...prev, apiVersion: event.target.value }))} />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-gray-600 flex items-center gap-1"><KeyRound size={13} /> Access token/API token</label>
            <input
              className="input-field w-full mt-1"
              type="password"
              placeholder={settings?.has_token ? `Đang lưu token ${settings.token_preview || 'đã che'}. Để trống nếu không đổi.` : 'Nhập token từ Sapo Admin/App riêng của cửa hàng'}
              value={config.accessToken}
              onChange={event => setConfig(prev => ({ ...prev, accessToken: event.target.value }))}
            />
            <div className="text-xs text-gray-500 mt-1">Frontend không hiển thị raw token từ settings; nếu backend trả token đã che thì chỉ dùng placeholder.</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={options.createMissingCategories} onChange={event => setOption('createMissingCategories', event.target.checked)} /> Tự tạo danh mục thiếu</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={options.updateExistingProducts} onChange={event => setOption('updateExistingProducts', event.target.checked)} /> Cập nhật sản phẩm đã tồn tại</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={options.syncImages} onChange={event => setOption('syncImages', event.target.checked)} /> Đồng bộ ảnh sản phẩm</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={options.syncDescriptions} onChange={event => setOption('syncDescriptions', event.target.checked)} /> Đồng bộ mô tả</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={options.updateExistingCustomers} onChange={event => setOption('updateExistingCustomers', event.target.checked)} /> Cập nhật khách đã tồn tại</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={options.createMissingCustomers} onChange={event => setOption('createMissingCustomers', event.target.checked)} /> Tạo khách thiếu cho hóa đơn</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={options.updateExistingInvoices} onChange={event => setOption('updateExistingInvoices', event.target.checked)} /> Cho phép cập nhật hóa đơn cũ</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={options.allowUnresolvedInvoiceLines} onChange={event => setOption('allowUnresolvedInvoiceLines', event.target.checked)} /> Cho phép hóa đơn thiếu sản phẩm</label>
          <label className="flex items-center gap-2">
            Tồn kho
            <select className="input-field" value={options.inventoryPolicy} onChange={event => setOption('inventoryPolicy', event.target.value)}>
              <option value="overwrite">Ghi đè từ Sapo</option>
              <option value="keep">Giữ offline</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_120px] gap-2 pt-1">
          <input className="input-field text-sm" placeholder="Từ khóa fetch từ Sapo (tùy backend hỗ trợ)" value={remoteQuery} onChange={event => setRemoteQuery(event.target.value)} />
          <select className="input-field text-sm" value={limit} onChange={event => setLimit(Number(event.target.value) || 50)}>
            <option value={25}>25 dòng</option>
            <option value={50}>50 dòng</option>
            <option value={100}>100 dòng</option>
            <option value={200}>200 dòng</option>
          </select>
          <select className="input-field text-sm" value={maxPages} onChange={event => setMaxPages(Number(event.target.value) || 5)}>
            <option value={1}>1 trang</option>
            <option value={5}>5 trang</option>
            <option value={10}>10 trang</option>
            <option value={20}>20 trang</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <BusyButton busy={isBusy('save')} onClick={handleSaveSettings} className="btn-success">Lưu cấu hình</BusyButton>
          <BusyButton busy={isBusy('validate')} onClick={handleValidate} className="btn-primary">Kiểm tra kết nối</BusyButton>
          <BusyButton busy={isBusy('analyze')} onClick={handleAnalyze} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium">Kiểm tra dữ liệu/analyze</BusyButton>
          <BusyButton busy={isBusy('syncAll')} onClick={handleSyncAllResources} className="btn-danger">Đồng bộ tổng</BusyButton>
        </div>
      </div>

      <div className="card text-sm space-y-3">
        <h2 className="font-bold flex items-center gap-2"><Settings2 size={18} /> Thông tin cấu hình</h2>
        <div><span className="text-gray-500">Shop:</span> <span className="font-medium break-all">{settings?.shop || '—'}</span></div>
        <div><span className="text-gray-500">Base URL:</span> <span className="font-medium break-all">{settings?.base_url || '—'}</span></div>
        <div><span className="text-gray-500">Token:</span> <span className="font-medium">{settings?.has_token ? (settings.token_preview || 'Đã lưu') : 'Chưa lưu'}</span></div>
        <div><span className="text-gray-500">Kết nối cuối:</span> {formatDateTime(settings?.last_connected_at)}</div>
        <div><span className="text-gray-500">Preview cuối:</span> {formatDateTime(settings?.last_preview_at)}</div>
        <div><span className="text-gray-500">Sync cuối:</span> {formatDateTime(settings?.last_sync_at)}</div>
        <div className="rounded-lg bg-blue-50 border border-blue-100 text-blue-800 p-3 text-xs">
          Đồng bộ hỗ trợ sản phẩm/biến thể, khách hàng và hóa đơn. Hóa đơn có dependency sản phẩm/khách hàng sẽ báo blocked/conflict nếu chưa thể import an toàn.
        </div>
        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-500 uppercase">Resource cho analyze/sync tổng</div>
          {RESOURCE_KEYS.map(resource => (
            <label key={resource} className="flex items-center gap-2">
              <input type="checkbox" checked={enabledResources[resource]} onChange={() => toggleEnabledResource(resource)} /> {RESOURCE_META[resource].label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  const renderGlobalSummary = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {RESOURCE_KEYS.map(resource => {
        const meta = RESOURCE_META[resource];
        const Icon = meta.icon;
        const state = resourceData[resource];
        return (
          <div key={resource} className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => setActiveTab(resource)} className="font-bold flex items-center gap-2 hover:text-blue-700"><Icon size={18} /> {meta.shortLabel}</button>
              {state.runId && <span className="text-xs rounded-full bg-gray-100 px-2 py-1">Run #{state.runId}</span>}
            </div>
            <SummaryGrid resource={resource} summary={state.summary} onOpen={card => openSummaryModal(resource, card)} />
          </div>
        );
      })}
    </div>
  );

  const renderProductTable = () => {
    const visibleIds = getVisibleProductRowIds(filteredProductGroups);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedSet.products.has(id));
    const someSelected = visibleIds.some(id => selectedSet.products.has(id));
    return (
      <div className="space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <FiltersBar filter={resourceFilters.products} onChange={filter => setFilter('products', filter)} placeholder="Lọc sản phẩm, SKU, barcode, lỗi..." />
          <div className="flex flex-wrap gap-2 shrink-0">
            <BusyButton busy={isBusy('preview:products')} onClick={() => handlePreviewResource('products')} className="btn-primary"><Eye size={15} /> Preview</BusyButton>
            <BusyButton busy={isBusy('sync:products:selected')} disabled={selected.products.length === 0} onClick={() => handleSyncResource('products', 'selected')} className="btn-success"><PackageCheck size={15} /> Đồng bộ đã chọn</BusyButton>
            <BusyButton busy={isBusy('sync:products:all')} onClick={() => handleSyncResource('products', 'all')} className="btn-danger"><PackageCheck size={15} /> Đồng bộ tất cả</BusyButton>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 text-sm">
          <button onClick={toggleAllProducts} className="px-3 py-1.5 border rounded-lg hover:bg-gray-50 inline-flex items-center gap-2">
            <IndeterminateCheckbox readOnly checked={allSelected} indeterminate={!allSelected && someSelected} />
            {allSelected ? 'Bỏ chọn dữ liệu đang lọc' : 'Chọn dữ liệu đang lọc'} ({selected.products.length}/{visibleIds.length})
          </button>
          <div className="text-xs text-gray-500">Chọn biến thể sẽ gửi kèm mã sản phẩm cha để giữ tương thích backend hiện tại.</div>
        </div>

        <SummaryGrid resource="products" summary={resourceData.products.summary} onOpen={card => openSummaryModal('products', card)} />
        <ProgressBox data={resourceData.products.progress} />
        <ResultMessages warnings={resourceData.products.warnings} errors={resourceData.products.errors} />

        <div className="border rounded-xl overflow-hidden">
          <div className="grid grid-cols-[42px_34px_1.5fr_0.8fr_0.55fr_0.75fr_0.9fr] bg-gray-100 text-xs font-semibold text-gray-600 px-3 py-2 gap-2">
            <div>Chọn</div>
            <div />
            <div>Sản phẩm / biến thể</div>
            <div>SKU / barcode</div>
            <div>Tồn</div>
            <div>Giá lẻ</div>
            <div>Trạng thái</div>
          </div>
          {filteredProductGroups.length === 0 && <div className="py-10 text-center text-gray-400 text-sm">{RESOURCE_META.products.empty}</div>}
          {filteredProductGroups.map(group => {
            const childIds = group.children.map(child => child.__id);
            const childSelectedCount = childIds.filter(id => selectedSet.products.has(id)).length;
            const parentChecked = selectedSet.products.has(group.__id) || (childIds.length > 0 && childSelectedCount === childIds.length);
            const parentIndeterminate = !parentChecked && childSelectedCount > 0;
            const expanded = expandedProducts[group.__id] !== false;
            return (
              <div key={group.__id}>
                <div onClick={() => openRowModal('products', group)} className="grid grid-cols-[42px_34px_1.5fr_0.8fr_0.55fr_0.75fr_0.9fr] px-3 py-3 gap-2 border-t text-sm items-center hover:bg-blue-50 cursor-pointer">
                  <div onClick={event => event.stopPropagation()}>
                    <IndeterminateCheckbox checked={parentChecked} indeterminate={parentIndeterminate} onChange={event => toggleProductParent(group, event.target.checked)} />
                  </div>
                  <button onClick={event => { event.stopPropagation(); setExpandedProducts(prev => ({ ...prev, [group.__id]: !expanded })); }} className="text-gray-500 hover:text-gray-800">
                    {group.children.length > 0 ? (expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : null}
                  </button>
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-800 truncate">{group.name || 'Sản phẩm Sapo'}</div>
                    <div className="text-xs text-gray-500 truncate">{group.category || 'Chưa có danh mục'} · {group.variant_count ?? group.children.length} biến thể · Sapo #{group.sapo_product_id || '—'}</div>
                  </div>
                  <div className="text-xs break-all"><div>{group.sku || '—'}</div><div className="text-gray-400">{group.barcode || ''}</div></div>
                  <div className="font-semibold">{group.stock ?? 0}</div>
                  <div className="text-green-700 font-medium">{formatVND(group.retail_price)}</div>
                  <div><ActionBadge action={getAction(group)} /></div>
                </div>
                {expanded && group.children.map(child => (
                  <div key={child.__id} onClick={() => openRowModal('products', child)} className="grid grid-cols-[42px_34px_1.5fr_0.8fr_0.55fr_0.75fr_0.9fr] px-3 py-2 gap-2 border-t text-sm items-center bg-gray-50 hover:bg-blue-50 cursor-pointer">
                    <div onClick={event => event.stopPropagation()}><input type="checkbox" checked={selectedSet.products.has(child.__id)} onChange={event => toggleProductRow(child.__id, event.target.checked)} /></div>
                    <div className="text-gray-300">└</div>
                    <div className="min-w-0 pl-2">
                      <div className="font-medium text-gray-700 truncate">{child.name || child.__parentName || 'Biến thể'}</div>
                      <div className="text-xs text-gray-500 truncate">Variant #{child.sapo_variant_id || '—'} · Parent #{child.__parentApiId || '—'}</div>
                    </div>
                    <div className="text-xs break-all"><div>{child.sku || '—'}</div><div className="text-gray-400">{child.barcode || ''}</div></div>
                    <div className="font-semibold">{child.stock ?? 0}</div>
                    <div className="text-green-700 font-medium">{formatVND(child.retail_price)}</div>
                    <div><ActionBadge action={getAction(child)} /></div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderFlatResourceTable = resource => {
    const items = resource === 'customers' ? filteredCustomers : filteredInvoices;
    const allSelected = items.length > 0 && items.every((item, index) => selectedSet[resource].has(`${resource}:${getItemStableKey(item, resource, index)}`));
    const someSelected = items.some((item, index) => selectedSet[resource].has(`${resource}:${getItemStableKey(item, resource, index)}`));
    return (
      <div className="space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <FiltersBar filter={resourceFilters[resource]} onChange={filter => setFilter(resource, filter)} placeholder={resource === 'customers' ? 'Lọc tên, mã, SĐT, email, lỗi...' : 'Lọc mã hóa đơn, khách hàng, trạng thái, lỗi...'} />
          <div className="flex flex-wrap gap-2 shrink-0">
            <BusyButton busy={isBusy(`preview:${resource}`)} onClick={() => handlePreviewResource(resource)} className="btn-primary"><Eye size={15} /> Preview</BusyButton>
            <BusyButton busy={isBusy(`sync:${resource}:selected`)} disabled={selected[resource].length === 0} onClick={() => handleSyncResource(resource, 'selected')} className="btn-success"><PackageCheck size={15} /> Đồng bộ đã chọn</BusyButton>
            <BusyButton busy={isBusy(`sync:${resource}:all`)} onClick={() => handleSyncResource(resource, 'all')} className="btn-danger"><PackageCheck size={15} /> Đồng bộ tất cả</BusyButton>
          </div>
        </div>

        <button onClick={() => toggleAllFlat(resource, items)} className="px-3 py-1.5 border rounded-lg hover:bg-gray-50 inline-flex items-center gap-2 text-sm">
          <IndeterminateCheckbox readOnly checked={allSelected} indeterminate={!allSelected && someSelected} />
          {allSelected ? 'Bỏ chọn dữ liệu đang lọc' : 'Chọn dữ liệu đang lọc'} ({selected[resource].length}/{items.length})
        </button>

        <SummaryGrid resource={resource} summary={resourceData[resource].summary} onOpen={card => openSummaryModal(resource, card)} />
        <ProgressBox data={resourceData[resource].progress} />
        <ResultMessages warnings={resourceData[resource].warnings} errors={resourceData[resource].errors} />

        <div className="border rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-100 text-xs text-gray-600">
              <tr>
                <th className="p-2 text-left w-12">Chọn</th>
                <th className="p-2 text-left">{resource === 'customers' ? 'Khách hàng' : 'Hóa đơn'}</th>
                <th className="p-2 text-left">{resource === 'customers' ? 'Liên hệ' : 'Khách hàng'}</th>
                <th className="p-2 text-left">{resource === 'customers' ? 'Mã/Sapo ID' : 'Tổng tiền'}</th>
                <th className="p-2 text-left">Match/Dependency</th>
                <th className="p-2 text-left">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const rowId = `${resource}:${getItemStableKey(item, resource, index)}`;
                return (
                  <tr key={rowId} onClick={() => openRowModal(resource, item)} className="border-t hover:bg-blue-50 cursor-pointer">
                    <td className="p-2" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selectedSet[resource].has(rowId)} onChange={() => toggleFlatRow(resource, rowId)} /></td>
                    <td className="p-2">
                      <div className="font-semibold text-gray-800">{resource === 'customers' ? (item.name || 'Khách hàng Sapo') : (item.invoice_code || item.sapo_order_number || item.key || 'Hóa đơn Sapo')}</div>
                      <div className="text-xs text-gray-500">{resource === 'customers' ? (item.customer_code || 'Chưa có mã') : `Sapo #${item.sapo_order_id || '—'} · ${item.line_count ?? 0} dòng`}</div>
                    </td>
                    <td className="p-2 text-xs">
                      {resource === 'customers' ? (
                        <div><div>{item.phone || '—'}</div><div className="text-gray-500">{item.email || ''}</div></div>
                      ) : (
                        <div><div>{item.customer_name || '—'}</div><div className="text-gray-500">KH local #{item.customer_existing_id || '—'}</div></div>
                      )}
                    </td>
                    <td className="p-2">
                      {resource === 'customers' ? <div className="text-xs">Sapo #{item.sapo_customer_id || '—'}<br />Local #{item.existing_id || '—'}</div> : <span className="font-semibold text-green-700">{formatVND(item.total)}</span>}
                    </td>
                    <td className="p-2 text-xs text-gray-600">
                      {resource === 'customers' ? (item.match_reason || '—') : (
                        <div>Thiếu SP: {item.unresolved_lines || 0}<br />Conflict SP: {item.conflicting_lines || 0}</div>
                      )}
                    </td>
                    <td className="p-2"><ActionBadge action={getAction(item)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {items.length === 0 && <div className="py-10 text-center text-gray-400 text-sm">{RESOURCE_META[resource].empty}</div>}
        </div>
      </div>
    );
  };

  const renderImportWizard = () => {
    const allSelected = filteredImportItems.length > 0 && filteredImportItems.every(item => selectedSet.import.has(`import:${item.line}:${item.rowIndex}`));
    const someSelected = filteredImportItems.some(item => selectedSet.import.has(`import:${item.line}:${item.rowIndex}`));
    return (
      <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/40 p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold flex items-center gap-2"><UploadCloud size={18} className="text-blue-600" /> Import khách hàng từ Excel</h3>
            <p className="text-xs text-gray-600 mt-1">Frontend parse file bằng xlsx rồi gửi JSON rows cho backend preview/commit; không upload binary.</p>
          </div>
          {excel.fileName && <span className="text-xs px-2 py-1 rounded-full bg-white border">{excel.fileName}</span>}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px_180px] gap-3 items-end">
          <div>
            <label className="text-xs text-gray-600 block mb-1">Chọn file Excel</label>
            <input type="file" accept=".xlsx,.xls,.csv" className="input-field w-full text-sm bg-white" onChange={handleExcelFile} />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Sheet</label>
            <select className="input-field w-full text-sm bg-white" value={excel.selectedSheet} onChange={event => handleSelectSheet(event.target.value)} disabled={excel.sheets.length === 0}>
              {excel.sheets.length === 0 ? <option value="">Chưa chọn file</option> : excel.sheets.map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">Mode commit</label>
            <select className="input-field w-full text-sm bg-white" value={excel.mode} onChange={event => setExcel(prev => ({ ...prev, mode: event.target.value }))}>
              <option value="upsert">Upsert</option>
              <option value="create_only">Chỉ tạo mới</option>
              <option value="update_only">Chỉ cập nhật</option>
            </select>
          </div>
        </div>

        {excel.columns.length > 0 && (
          <div className="rounded-xl border bg-white p-3">
            <div className="font-semibold text-sm mb-2">Mapping cột</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {IMPORT_FIELDS.map(field => (
                <label key={field.key} className="text-xs text-gray-600">
                  {field.label}{field.required ? <span className="text-red-500"> *</span> : ''}
                  <select className="input-field w-full mt-1 text-sm" value={excel.mapping[field.key] || ''} onChange={event => setExcel(prev => ({ ...prev, mapping: { ...prev.mapping, [field.key]: event.target.value } }))}>
                    <option value="">Không map</option>
                    {excel.columns.map(column => <option key={`${field.key}-${column}`} value={column}>{column}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <BusyButton busy={isBusy('importPreview')} onClick={handleImportPreview} className="btn-primary"><Eye size={15} /> Preview import</BusyButton>
          <BusyButton busy={isBusy('importCommit')} disabled={selected.import.length === 0} onClick={commitSelectedImport} className="btn-success"><PackageCheck size={15} /> Commit dòng đã chọn ({selected.import.length})</BusyButton>
          <div className="text-xs text-gray-600">Đã đọc {formatNumber(excel.rows.length)} dòng, {formatNumber(excel.columns.length)} cột.</div>
        </div>

        {excel.previewSummary && <SummaryGrid resource="customers" summary={excel.previewSummary} onOpen={() => {}} />}
        <ResultMessages warnings={excel.previewWarnings} errors={excel.previewErrors} />
        {excel.commitResult?.run_id && <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-green-800 text-sm">Import đã commit với run #{excel.commitResult.run_id}. Created: {excel.commitResult.summary?.created || 0}, Updated: {excel.commitResult.summary?.updated || 0}, Skipped: {excel.commitResult.summary?.skipped || 0}.</div>}

        {excel.previewItems.length > 0 && (
          <div className="space-y-3">
            <FiltersBar filter={resourceFilters.import} onChange={filter => setFilter('import', filter)} placeholder="Lọc dòng import, tên, SĐT, email, lỗi..." actions={['all', 'create', 'update', 'duplicate', 'error', 'skipped']} />
            <button onClick={toggleAllImport} className="px-3 py-1.5 border rounded-lg hover:bg-gray-50 inline-flex items-center gap-2 text-sm bg-white">
              <IndeterminateCheckbox readOnly checked={allSelected} indeterminate={!allSelected && someSelected} />
              {allSelected ? 'Bỏ chọn dòng đang lọc' : 'Chọn dòng đang lọc'} ({selected.import.length}/{filteredImportItems.length})
            </button>
            <div className="border rounded-xl overflow-x-auto bg-white">
              <table className="w-full text-sm min-w-[980px]">
                <thead className="bg-gray-100 text-xs text-gray-600">
                  <tr>
                    <th className="p-2 text-left w-12">Chọn</th>
                    <th className="p-2 text-left">Dòng</th>
                    <th className="p-2 text-left">Khách hàng</th>
                    <th className="p-2 text-left">Liên hệ</th>
                    <th className="p-2 text-left">Mã/MST/Loại</th>
                    <th className="p-2 text-left">Lỗi/duplicate</th>
                    <th className="p-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredImportItems.map(item => {
                    const id = `import:${item.line}:${item.rowIndex}`;
                    return (
                      <tr key={id} className="border-t hover:bg-blue-50">
                        <td className="p-2"><input type="checkbox" checked={selectedSet.import.has(id)} onChange={() => toggleFlatRow('import', id)} /></td>
                        <td className="p-2 font-mono text-xs">{item.line}</td>
                        <td className="p-2"><div className="font-semibold">{item.name || '—'}</div><div className="text-xs text-gray-500">Local #{item.existing_id || '—'} · {item.match_reason || '—'}</div></td>
                        <td className="p-2 text-xs"><div>{item.phone || '—'}</div><div className="text-gray-500">{item.email || ''}</div></td>
                        <td className="p-2 text-xs"><div>{item.customer_code || '—'}</div><div>{item.tax_code || ''}</div><div className="text-gray-500">{item.customer_type || ''}</div></td>
                        <td className="p-2 text-xs text-red-600 max-w-xs">{safeArray(item.errors).map(error => error?.message || String(error)).join('; ') || '—'}</td>
                        <td className="p-2"><ActionBadge action={getAction(item)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderHistory = () => (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold flex items-center gap-2"><History size={18} /> Lịch sử đồng bộ gần đây</h2>
        <BusyButton busy={isBusy('runs')} onClick={() => runAction('runs', loadRuns)} className="px-3 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"><RefreshCw size={15} /> Làm mới</BusyButton>
      </div>
      {runs.length === 0 && <div className="text-sm text-gray-400">Chưa có lượt đồng bộ nào.</div>}
      {runs.map(run => (
        <button key={run.id} onClick={() => setModal({ resource: run.resource || 'products', title: `Run #${run.id}`, item: { ...run, key: `Run #${run.id}`, name: `${run.mode || 'sync'} · ${safeArray(run.resources).join(', ') || run.resource}`, message: `Status: ${run.status}`, warnings: run.warnings, errors: run.errors, action: run.status === 'success' ? 'existing' : 'error' } })} className="w-full text-left border rounded-xl px-4 py-3 text-sm flex items-start justify-between gap-3 hover:bg-gray-50">
          <div>
            <div className="font-semibold">#{run.id} · {safeArray(run.resources).join(', ') || run.resource || 'Sapo'} · {formatDateTime(run.created_at)}</div>
            <div className="text-gray-500 mt-1">Mode {run.mode || '—'}, phase {run.phase || '—'}, tổng {run.total ?? 0}</div>
            <div className="text-xs text-gray-400 mt-1 break-all">{run.shop || run.base_url || ''}</div>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-semibold ${run.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{run.status}</span>
        </button>
      ))}
    </div>
  );

  const renderActiveTab = () => {
    if (activeTab === 'products') return renderProductTable();
    if (activeTab === 'customers') return <>{renderFlatResourceTable('customers')}{renderImportWizard()}</>;
    if (activeTab === 'invoices') return renderFlatResourceTable('invoices');
    if (activeTab === 'history') return renderHistory();
    return null;
  };

  return (
    <div className="max-w-7xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-gray-900">
            <Database className="text-blue-600" size={26} /> Đồng bộ dữ liệu Sapo
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Màn hình đồng bộ đa resource cho sản phẩm/biến thể, khách hàng, hóa đơn và import khách hàng Excel vào dữ liệu offline.
          </p>
        </div>
        <button onClick={() => { loadSettings(); loadRuns(); }} className="px-3 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-1.5">
          <RefreshCw size={15} /> Làm mới
        </button>
      </div>

      <StatusBanner status={status} onClose={() => setStatus({ tone: 'info', message: '' })} />
      {renderSettingsPanel()}
      {renderGlobalSummary()}

      <div className="card space-y-4">
        <div className="flex flex-wrap gap-2 border-b pb-3">
          {[...RESOURCE_KEYS, 'history'].map(tab => {
            const meta = tab === 'history' ? { label: 'Lịch sử', icon: History } : RESOURCE_META[tab];
            const Icon = meta.icon;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                <Icon size={16} /> {meta.label}
              </button>
            );
          })}
        </div>
        {activeTab !== 'history' && (
          <div className="rounded-xl border bg-slate-50 p-3 text-xs text-slate-700 flex flex-wrap items-center gap-3">
            <span className="font-semibold">Tab hiện tại:</span>
            <span>{RESOURCE_META[activeTab]?.label}</span>
            {activeResourceState.runId && <span>Run #{activeResourceState.runId}</span>}
            <span>Items: {formatNumber(activeResourceState.items?.length || 0)}</span>
          </div>
        )}
        {renderActiveTab()}
      </div>

      <ActionModal
        modal={modal}
        selectedCount={selectedCountForModal}
        busy={modalBusy}
        onClose={() => { setModal(null); setModalBusy(''); }}
        onSyncAll={() => modal?.resource && handleSyncResource(modal.resource, 'all', null, 'all')}
        onSyncSelected={() => modal?.resource && handleSyncResource(modal.resource, 'selected', null, 'selected')}
        onSyncCurrent={() => modal?.resource && modal?.item && handleSyncResource(modal.resource, 'current', modal.item, 'current')}
      />
    </div>
  );
}
