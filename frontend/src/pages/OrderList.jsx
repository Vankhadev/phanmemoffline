import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson, apiJsonChecked, clearApiCache, resolveApiUrl, requestSyncCheck } from '../utils/apiClient';
import { globalSyncEmitter } from '../utils/eventEmitter';
import { Package, Edit2, Trash2, Eye, X, Loader, Plus, Search, CheckSquare, Square, HelpCircle, RefreshCw, Receipt, Clock3, Wallet, UploadCloud, Printer, FileDown } from 'lucide-react';
import { getProductDisplayName, scoreProductMatch } from '../utils/productSearch';
import ExcelImportPanel from '../components/ExcelImportPanel';
import {
  NEGATIVE_STOCK_LIMIT_MESSAGE,
  buildSaleStockValidation,
  formatStockValue,
  getNegativeStockLimitLabel,
  getNegativeStockNearLimitLabel,
  getSaleStockStateForLine,
  getStockDisplayMeta,
} from '../utils/negativeStock';
import useNegativeStockSettings from '../utils/useNegativeStockSettings';
import OrderColumnCustomizer from '../components/OrderColumnCustomizer';
import {
  loadOrderColumnSettings,
  saveOrderColumnSettings,
  normalizeOrderColumnSettings,
} from '../utils/orderColumnSettings';

const API = resolveApiUrl('');

const STATUS_LABELS = {
  pending: { text: 'Chờ xác nhận', color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500', icon: '⏳' },
  processing: { text: 'Đang xử lý', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500', icon: '🔄' },
  completed: { text: 'Hoàn thành', color: 'bg-green-100 text-green-700', dot: 'bg-green-500', icon: '✅' },
  cancelled: { text: 'Đã hủy', color: 'bg-red-100 text-red-600', dot: 'bg-red-500', icon: '❌' },
};
const PAYMENT_LABELS = { cash: 'Tiền mặt', bank: 'Chuyển khoản', debt: 'Công nợ' };
const SOURCE_BADGES = {
  app: { text: 'App', color: 'bg-gray-100 text-gray-600' },
  direct: { text: 'App', color: 'bg-gray-100 text-gray-600' },
  web: { text: 'Web', color: 'bg-blue-50 text-blue-700' },
  sync: { text: 'Sync', color: 'bg-purple-50 text-purple-700' },
  offline: { text: 'Offline', color: 'bg-orange-50 text-orange-700' },
};
function formatPaymentMethod(method) {
  return PAYMENT_LABELS[method] || method || 'Tiền mặt';
}

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n || 0);
}

function formatMoneyInput(value) {
  const amount = Math.max(0, Math.trunc(Number(value) || 0));
  return amount.toLocaleString('vi-VN');
}

function parseMoneyInput(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? Math.max(0, Number(digits)) : 0;
}

function getInvoicePaymentSummary(invoice = {}) {
  const total = Math.max(0, Number(invoice.total) || 0);
  const paid = Math.max(0, Number(invoice.paid_amount) || 0);
  const remaining = Math.max(0, Number.isFinite(Number(invoice.remaining_amount))
    ? Number(invoice.remaining_amount)
    : total - paid);

  if (paid >= total && total > 0) return { total, paid, remaining: 0, status: 'paid', label: 'Đã thanh toán' };
  if (paid > 0) return { total, paid, remaining, status: 'partial', label: 'Thanh toán một phần' };
  return { total, paid: 0, remaining, status: 'unpaid', label: 'Chưa thanh toán' };
}

// Chuyển mã đơn hàng thành định dạng "HD000001"; vẫn đọc được mã DH cũ.
function displayOrderCode(code) {
  if (!code) return '—';
  const raw = String(code).trim();
  if (/^HD\d{6,}$/i.test(raw)) return raw.toUpperCase();
  const numStr = raw.replace(/^(HD|DH|LOCAL_)/i, '').replace(/[^0-9]/g, '');
  const num = parseInt(numStr || '0', 10);
  return `HD${String(num).padStart(6, '0')}`;
}

const customerTypeToPriceType = (ct) => {
  const t = String(ct || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').trim();
  if (t.includes(' si') || t.endsWith('si') || t.includes('wholesale') || t.includes('buon')) return 'wholesale';
  if (t.includes('vip')) return 'vip';
  return 'retail';
};

function readPriceField(source, key) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return null;
  const raw = source[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const number = Number(raw);
  return Number.isFinite(number) ? Math.max(0, number) : null;
}

function getPriceValueByType(source, currentPriceType = 'retail') {
  const activeType = ['retail', 'wholesale', 'vip'].includes(String(currentPriceType).trim().toLowerCase()) ? String(currentPriceType).trim().toLowerCase() : 'retail';
  const exact = readPriceField(source, `${activeType}_price`);
  if (exact !== null) return exact;

  const retail = readPriceField(source, 'retail_price');
  if (retail !== null) return retail;

  for (const key of ['price', 'unit_price', 'sale_price', 'selling_price', 'wholesale_price', 'vip_price']) {
    const value = readPriceField(source, key);
    if (value !== null) return value;
  }

  return 0;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const CANCELLED_ORDER_STATUS_VALUES = new Set(['cancelled', 'canceled', 'da_huy', 'da huy', 'd? h?y', 'da~ hu?y', 'huy', 'h?y']);
const CANCELLED_ORDER_RETENTION_MS = 24 * 60 * 60 * 1000;

function normalizeStatusValue(value) {
  return String(value || '').trim().toLowerCase().normalize('NFC').replace(/\s+/g, ' ');
}

function isCancelledOrderStatus(status) {
  return CANCELLED_ORDER_STATUS_VALUES.has(normalizeStatusValue(status));
}

function getOrderStatusMeta(status) {
  if (isCancelledOrderStatus(status)) return STATUS_LABELS.cancelled;
  return STATUS_LABELS[status] || STATUS_LABELS.pending;
}

function parseOrderTimeMs(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function getOrderCancelledAtMs(order = {}) {
  return parseOrderTimeMs(order.cancelled_at || order.cancelledAt);
}

function isOrderVisibleInActiveList(order = {}, nowMs = Date.now()) {
  if (!isCancelledOrderStatus(order.status)) return true;
  const cancelledAtMs = getOrderCancelledAtMs(order);
  if (cancelledAtMs == null) return true;
  return cancelledAtMs + CANCELLED_ORDER_RETENTION_MS > nowMs;
}

function formatCancelAutoDeleteRemaining(order = {}, nowMs = Date.now()) {
  if (!isCancelledOrderStatus(order.status)) return '';
  const cancelledAtMs = getOrderCancelledAtMs(order);
  if (cancelledAtMs == null) return 'Tự động xóa sau: đang chờ thời điểm hủy';
  const remainingMs = cancelledAtMs + CANCELLED_ORDER_RETENTION_MS - nowMs;
  if (remainingMs <= 0) return 'Đang chờ hệ thống tự động xóa';
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} giờ`);
  if (minutes > 0) parts.push(`${minutes} phút`);
  return `Tự động xóa sau: ${parts.join(' ') || 'dưới 1 phút'}`;
}

function normalizeSourceValue(value) {
  return String(value || '').trim().toLowerCase();
}

function getOrderSourceKey(inv = {}) {
  if (inv._isOffline) return 'offline';
  const raw = normalizeSourceValue(inv.order_source || inv.source || inv.created_by_platform || inv.sync_source);
  if (raw.includes('sync')) return 'sync';
  if (raw.includes('direct') || raw.includes('web')) return 'web';
  return raw || 'web';
}

function getOrderSourceBadge(inv = {}) {
  const key = getOrderSourceKey(inv);
  return SOURCE_BADGES[key] || { text: key || 'Web', color: 'bg-gray-100 text-gray-600' };
}

function mergeDuplicateProducts(details = []) {
  const map = new Map();
  details.forEach((detail, index) => {
    const isService = detail.is_service || detail.isService || detail.type === 'service' || detail.type === 'custom_service' || detail.item_type === 'service' || detail.item_type === 'custom_service';
    // Free service lines have no product reference and must stay independent.
    const key = isService
      ? `service:${detail.id || detail.order_item_id || index}`
      : `${detail.type || detail.item_type || 'product'}:${detail.combo_id || detail.product_id || detail.variant_id || detail.id || index}:${Number(detail.unit_price) || 0}`;
    const current = {
      ...detail,
      quantity: Number(detail.quantity) || 1,
      unit_price: Number(detail.unit_price) || 0,
      discount_percent: Number(detail.discount_percent) || 0,
      discount_amount: Number(detail.discount_amount) || 0,
      line_total: Number(detail.line_total) || ((Number(detail.quantity) || 1) * (Number(detail.unit_price) || 0)),
    };
    if (map.has(key)) {
      const existing = map.get(key);
      existing.quantity += current.quantity;
      existing.discount_amount += current.discount_amount;
      existing.line_total += current.line_total;
      return;
    }
    map.set(key, current);
  });
  return Array.from(map.values());
}

function getOrderIdentityKey(order = {}) {
  return String(order.client_order_id || order.payload?.client_order_id || order.invoice_code || order.id || '').trim();
}

function normalizeInvoiceListResponse(data) {
  const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
  const nowMs = Date.now();
  return items
    .filter(Boolean)
    .map(item => ({ ...item, _isOffline: false }))
    .filter(item => isOrderVisibleInActiveList(item, nowMs));
}

function getOrderDedupeKey(order = {}) {
  return getOrderIdentityKey(order);
}

function sameOrderIdentity(a = {}, b = {}) {
  const aClientId = a.client_order_id || a.payload?.client_order_id;
  const bClientId = b.client_order_id || b.payload?.client_order_id;
  if (aClientId && bClientId && aClientId === bClientId) return true;
  return Boolean(a.invoice_code && b.invoice_code && a.invoice_code === b.invoice_code);
}

function dedupeOrdersByInvoiceCode(orders) {
  const map = new Map();
  for (const [index, order] of orders.entries()) {
    if (!order) continue;
    const key = getOrderDedupeKey(order) || `${order._isOffline ? 'offline' : 'db'}-${order.id || order.created_at || index}`;
    const existing = map.get(key);
    if (!existing || (existing._isOffline && !order._isOffline)) {
      map.set(key, order);
    }
  }
  return Array.from(map.values());
}

function getOrderRowKey(order = {}, index = 0) {
  const identity = getOrderIdentityKey(order);
  if (identity) return `${order._isOffline ? 'offline' : 'db'}-${identity}`;
  return `${order._isOffline ? 'offline' : 'db'}-${order.id || order.invoice_code || order.created_at || index}`;
}

export default function OrderList() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [invoiceDetails, setInvoiceDetails] = useState([]);
  const [customers, setCustomers] = useState([]);

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSource, setFilterSource] = useState('all');
  const [loading, setLoading] = useState(true);
  const [serverOnline, setServerOnline] = useState(false);
  const [allOrders, setAllOrders] = useState([]);

  const [showView, setShowView] = useState(null);
  const [showEdit, setShowEdit] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editDetails, setEditDetails] = useState([]);
  const [editProducts, setEditProducts] = useState([]);
  const [editProductsState, setEditProductsState] = useState('idle');
  const [editBaselineDetails, setEditBaselineDetails] = useState([]);
  const [editVisibleColumns, setEditVisibleColumns] = useState(() => loadOrderColumnSettings());
  const [editProductSearch, setEditProductSearch] = useState('');
  const [editCustomerSearch, setEditCustomerSearch] = useState('');
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [stockToast, setStockToast] = useState(null);
  const lastStockLimitToastRef = useRef('');

  // ----- Price memory & suggestion -----
  // Remember last accepted price per customer+product in localStorage.
  const PRICE_MEMORY_KEY = 'kha_price_memory';
  const loadPriceMemory = () => {
    try { return JSON.parse(localStorage.getItem(PRICE_MEMORY_KEY) || '{}'); } catch { return {}; }
  };
  const savePriceMemory = (mem) => {
    try { localStorage.setItem(PRICE_MEMORY_KEY, JSON.stringify(mem)); } catch {}
  };
  const getStoredPrice = (customerId, productId) => {
    const mem = loadPriceMemory();
    return mem[`${customerId || 'null'}_${productId}`];
  };
  const setStoredPrice = (customerId, productId, price) => {
    const mem = loadPriceMemory();
    mem[`${customerId || 'null'}_${productId}`] = price;
    savePriceMemory(mem);
  };
  // UI state for a price suggestion toast
  const [priceSuggestion, setPriceSuggestion] = useState(null); // { lineIndex, productId, price, customerId, oldPrice }
  const priceSuggestionTimerRef = useRef(null);
  useEffect(() => () => {
    if (priceSuggestionTimerRef.current) clearTimeout(priceSuggestionTimerRef.current);
  }, []);
  // Show suggestion when a stored price differs from the current price of a line
  const maybeShowPriceSuggestion = (lineIndex, productId, price, customerId) => {
    const stored = getStoredPrice(customerId, productId);
    if (stored != null && stored !== price) {
      setPriceSuggestion({ lineIndex, productId, price, customerId, oldPrice: stored });
      if (priceSuggestionTimerRef.current) clearTimeout(priceSuggestionTimerRef.current);
      priceSuggestionTimerRef.current = setTimeout(() => {
        setPriceSuggestion(null);
        priceSuggestionTimerRef.current = null;
      }, 10000);
    }
  };
  // Apply the suggested price to the specific line and update memory
  const applySuggestedPrice = () => {
    if (!priceSuggestion) return;
    const { lineIndex, price, productId, customerId } = priceSuggestion;
    setEditDetails(prev => {
      const updated = prev.map((d, i) => {
        if (i !== lineIndex) return d;
        const newItem = { ...d, unit_price: price };
        newItem.line_total = newItem.quantity * price - (newItem.discount_amount || 0);
        // Giữ snapshot giá bán khớp với giá dòng mới để backend lưu đúng.
        newItem.sale_price_at_sale = price;
        const costPrice = newItem.cost_price_at_sale != null
          ? Number(newItem.cost_price_at_sale)
          : (newItem.import_price != null ? Number(newItem.import_price) : 0);
        newItem.profit_at_sale = (Number(price) - costPrice) * (Number(newItem.quantity) || 1);
        return newItem;
      });
      // recalc order totals
      const sub = updated.reduce((s, d) => s + (d.line_total || 0), 0);
      const vat = sub * (editForm.vat_percent / 100);
      const disc = editForm.discount_percent ? sub * editForm.discount_percent / 100 : (editForm.discount_amount || 0);
      const total = sub + vat - disc + (+editForm.delivery_fee || 0);
      const paid = +editForm.paid_amount || 0;
      setEditForm(f => ({ ...f, subtotal: sub, total, remaining_amount: Math.max(0, total - paid), change_amount: Math.max(0, paid - total) }));
      return updated;
    });
    setStoredPrice(customerId, productId, price);
    setPriceSuggestion(null);
  };

  const [selectedOrders, setSelectedOrders] = useState([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [expandedParents, setExpandedParents] = useState({});
  const [showHelp, setShowHelp] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const { settings: negativeStockSettings } = useNegativeStockSettings();
  const negativeStockLimitLabel = useMemo(() => getNegativeStockLimitLabel(negativeStockSettings), [negativeStockSettings]);
  const negativeStockNearLimitLabel = useMemo(() => getNegativeStockNearLimitLabel(negativeStockSettings), [negativeStockSettings]);

  const notifyOrderChanged = (detail = {}) => {
    window.dispatchEvent(new CustomEvent('kha-order-created', {
      detail: { _syncOnly: true, ...detail },
    }));
    requestSyncCheck({
      reason: detail.reason || 'order-mutated',
      tables: ['invoices', 'invoice_details', 'products', 'customers'],
    });
  };

  const readOfflineOrders = useCallback(() => {
    try { return JSON.parse(localStorage.getItem('kha_pending_orders') || '[]'); }
    catch { return []; }
  }, []);

  const mergeOrders = useCallback((serverOrders = [], offlineOrders = readOfflineOrders()) => dedupeOrdersByInvoiceCode([
    ...offlineOrders.map(order => ({ ...order, _isOffline: true })),
    ...serverOrders.map(order => ({ ...order, _isOffline: false })),
  ]), [readOfflineOrders]);

  const refreshOrderState = useCallback((serverOrders, offlineOrders) => {
    const normalizedServerOrders = normalizeInvoiceListResponse(serverOrders);
    setInvoices(normalizedServerOrders);
    setAllOrders(mergeOrders(normalizedServerOrders, offlineOrders));
  }, [mergeOrders]);

  const fetchInvoices = useCallback(async () => {
    const offline = readOfflineOrders();
    try {
      const data = await apiJson('/invoices', {}, 'Không tải được danh sách đơn hàng.');
      refreshOrderState(data, offline);
      setServerOnline(true);
      return data;
    } catch (error) {
      setServerOnline(false);
      setAllOrders(offline.map(order => ({ ...order, _isOffline: true })));
      return [];
    }
  }, [readOfflineOrders, refreshOrderState]);

  // Load products for edit validation/picker
  useEffect(() => {
    if (!showProductPicker && !showEdit) return;
    apiJson('/products/all/with-variants', {}, 'Không tải được sản phẩm.')
      .then(data => setEditProducts(Array.isArray(data) ? data : []))
      .catch(() => setEditProducts([]));
  }, [showProductPicker, showEdit]);

  // Tự động cập nhật danh sách sản phẩm khi có thay đổi (sửa/nhập) ở các tab khác
  useEffect(() => {
    const handleProductChange = () => {
      if (!showProductPicker && !showEdit) return;
      apiJson('/products/all/with-variants', {}, 'Không tải được sản phẩm.')
        .then(data => setEditProducts(Array.isArray(data) ? data : []))
        .catch(() => setEditProducts([]));
    };
    const unsubUpdated = globalSyncEmitter.on('PRODUCT_UPDATED', handleProductChange);
    const unsubImported = globalSyncEmitter.on('PRODUCT_IMPORTED', handleProductChange);
    return () => {
      unsubUpdated();
      unsubImported();
    };
  }, [showProductPicker, showEdit]);

  useEffect(() => {
    if (!stockToast) return undefined;
    const timer = window.setTimeout(() => setStockToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [stockToast]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Kiểm tra server + load dữ liệu
  useEffect(() => {
    const checkAndLoad = async () => {
      setLoading(true);
      const offline = readOfflineOrders();

      try {
        const [invData, custData] = await Promise.all([
          apiJson('/invoices', {}, 'Không tải được danh sách đơn hàng.'),
          apiJson('/customers', {}, 'Không tải được khách hàng.'),
        ]);
        setServerOnline(true);
        refreshOrderState(invData, offline);
        setCustomers(Array.isArray(custData) ? custData : []);
      } catch {
        setServerOnline(false);
        setAllOrders(offline.map(o => ({ ...o, _isOffline: true })));
      } finally {
        setLoading(false);
      }
    };
    checkAndLoad();

    const handleSyncRefresh = () => {
      fetchInvoices();
      console.log('[SYNC] OrderList refreshed');
    };

    const handleCustomerSync = () => {
      apiJson('/customers', {}, 'Không tải được khách hàng.')
        .then(custData => setCustomers(Array.isArray(custData) ? custData : []))
        .catch(() => {});
    };

    const unsubscribeCreated = globalSyncEmitter.on('ORDER_CREATED', handleSyncRefresh);
    const unsubscribeUpdated = globalSyncEmitter.on('ORDER_UPDATED', handleSyncRefresh);
    const unsubscribeDeleted = globalSyncEmitter.on('ORDER_DELETED', handleSyncRefresh);
    const unsubscribeCustomer = globalSyncEmitter.on('CUSTOMER_UPDATED', handleCustomerSync);

    return () => {
      unsubscribeCreated();
      unsubscribeUpdated();
      unsubscribeDeleted();
      unsubscribeCustomer();
    };
  }, []);

  // Lọc danh sách
  const displayOrders = useMemo(() => {
    const sourceOrders = allOrders.length > 0 ? allOrders : invoices;
    return sourceOrders.filter(inv => isOrderVisibleInActiveList(inv, nowMs));
  }, [allOrders, invoices, nowMs]);
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = useMemo(() => displayOrders.filter(inv => {
    const matchSearch =
      (inv.invoice_code || '').toLowerCase().includes(normalizedSearch) ||
      (inv.client_order_id || inv.payload?.client_order_id || '').toLowerCase().includes(normalizedSearch) ||
      displayOrderCode(inv.invoice_code).toLowerCase().includes(normalizedSearch) ||
      (inv.customer_name || '').toLowerCase().includes(normalizedSearch);
    const sourceKey = getOrderSourceKey(inv);
    const matchStatus = filterStatus === 'all' ||
      (filterStatus === 'cancelled' && isCancelledOrderStatus(inv.status)) ||
      inv.status === filterStatus ||
      (filterStatus === 'offline' && inv._isOffline);
    const matchSource = filterSource === 'all' ||
      sourceKey === filterSource ||
      (filterSource === 'sync' && sourceKey === 'sync');
    return matchSearch && matchStatus && matchSource;
  }), [displayOrders, filterSource, filterStatus, normalizedSearch]);

  useEffect(() => {
    const orderIds = new Set(displayOrders.map(inv => getOrderIdentityKey(inv)).filter(Boolean));
    setSelectedOrders(prev => {
      const next = prev.filter(id => orderIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [displayOrders]);

  const summaryCards = [
    {
      key: 'total',
      label: 'Tổng đơn',
      value: displayOrders.length,
      icon: Receipt,
      tone: 'bg-blue-50 text-blue-700 border-blue-100',
    },
    {
      key: 'pending',
      label: 'Cần xử lý',
      value: displayOrders.filter(inv => inv._isOffline || inv.status === 'pending' || inv.status === 'processing').length,
      icon: Clock3,
      tone: 'bg-amber-50 text-amber-700 border-amber-100',
    },
    {
      key: 'completed',
      label: 'Hoàn thành',
      value: displayOrders.filter(inv => inv.status === 'completed').length,
      icon: CheckSquare,
      tone: 'bg-green-50 text-green-700 border-green-100',
    },
    {
      key: 'revenue',
      label: 'Doanh thu',
      value: formatVND(displayOrders.filter(inv => inv.status === 'completed').reduce((sum, inv) => sum + (Number(inv.total) || 0), 0)),
      icon: Wallet,
      tone: 'bg-purple-50 text-purple-700 border-purple-100',
    },
  ];

  const statusTabs = [
    { key: 'all', label: 'Tất cả', count: displayOrders.length },
    { key: 'pending', label: 'Chờ xác nhận', count: displayOrders.filter(inv => inv.status === 'pending').length },
    { key: 'processing', label: 'Đang xử lý', count: displayOrders.filter(inv => inv.status === 'processing').length },
    { key: 'completed', label: 'Hoàn thành', count: displayOrders.filter(inv => inv.status === 'completed').length },
    { key: 'cancelled', label: 'Đã hủy', count: displayOrders.filter(inv => isCancelledOrderStatus(inv.status)).length },
    { key: 'offline', label: 'Offline', count: displayOrders.filter(inv => inv._isOffline).length },
  ];

  const sourceOptions = [
    { key: 'all', label: 'Tất cả nguồn', count: displayOrders.length },
    { key: 'offline', label: 'Offline local', count: displayOrders.filter(inv => getOrderSourceKey(inv) === 'offline').length },
    { key: 'web', label: 'Web', count: displayOrders.filter(inv => getOrderSourceKey(inv) === 'web').length },
    { key: 'sync', label: 'Sync', count: displayOrders.filter(inv => getOrderSourceKey(inv) === 'sync').length },
  ];


  const selectableOrderIds = filtered.map(inv => getOrderIdentityKey(inv)).filter(Boolean);
  const selectedAll = selectableOrderIds.length > 0 && selectableOrderIds.every(id => selectedOrders.includes(id));

  // ── CHECKBOX HANDERS ──
  const toggleSelectOrder = (orderId) => {
    if (!orderId) return;
    setSelectedOrders(prev => (
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    ));
  };

  const toggleSelectAll = () => {
    const allIdentifiers = selectableOrderIds;
    const areAllSelected = allIdentifiers.length > 0 && allIdentifiers.every(id => selectedOrders.includes(id));
    if (areAllSelected) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(allIdentifiers);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedOrders.length === 0) return;
    if (!confirm(`Hủy ${selectedOrders.length} đơn hàng đã chọn?\n\nH?ng sẽ được hođơn về kho.`)) return;

    setIsBulkDeleting(true);
    try {
      // Get selected order objects
      const selectedOrdersData = filtered.filter(inv => selectedOrders.includes(getOrderIdentityKey(inv)));
      const onlineOrders = selectedOrdersData.filter(inv => inv.id && !inv._isOffline);
      const offlineOrders = selectedOrdersData.filter(inv => inv._isOffline);

      // Cancel online orders (backend marks as cancelled, doesn't hard delete)
      const promises = onlineOrders.map(inv =>
        apiJsonChecked(`/invoices/${inv.id}`, { method: 'DELETE' }, 'Không thể hủy đơn hàng.')
      );
      const results = await Promise.allSettled(promises);
      const successCount = results.filter(r => r.status === 'fulfilled').length;

      // Remove offline orders from localStorage (hard delete for offline)
      if (offlineOrders.length > 0) {
        const pending = JSON.parse(localStorage.getItem('kha_pending_orders') || '[]');
        const updatedPending = pending.filter(o => !offlineOrders.some(oo => sameOrderIdentity(oo, o)));
        localStorage.setItem('kha_pending_orders', JSON.stringify(updatedPending));
      }

      const totalAffected = successCount + offlineOrders.length;
      alert(`Đã hủy ${totalAffected} đơn hàng! Đơn đã hủy sẽ tự động xóa sau 24 giờ.`);
      setSelectedOrders([]);
      // Refresh data - cancelled online orders remain visible for 24h before automatic cleanup.
      notifyOrderChanged({ reason: 'orders-cancelled' });
      await fetchInvoices();
      apiJson('/products/all/with-variants').catch(() => { });
    } catch (err) {
      alert(`📡 Lỗi khi hủy: ${err.message}`);
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const getInvoicePrintTarget = (inv = {}) => inv.id || inv.invoice_code || inv.client_order_id || '';

  const openInvoicePrint = (inv, { quick = false } = {}) => {
    if (inv?._isOffline || !getInvoicePrintTarget(inv)) {
      alert('Đơn offline chưa có dữ liệu hóa đơn thật trên server để in. Vui lòng đồng bộ đơn trước khi in.');
      return;
    }
    navigate(`/hoa-don-in/${encodeURIComponent(getInvoicePrintTarget(inv))}${quick ? '?print=1' : ''}`);
  };

  const getEditDetailRowKey = (detail, index) => String(detail?.id ?? `${detail?.product_id || detail?.variant_id || 'line'}:${index}`);

  const getEditProductById = (id) => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) return null;
    for (const product of editProducts || []) {
      if (Number(product?.id) === numericId) return product;
      const variant = (product?.variants || []).find(item => Number(item?.id) === numericId);
      if (variant) return variant;
    }
    return null;
  };

  const getEditProductStockById = (productId, line = {}) => {
    const product = getEditProductById(productId);
    if (product && Number.isFinite(Number(product.stock))) return Number(product.stock);
    const fallback = line?.current_stock ?? line?.currentStock ?? line?.max_stock ?? line?.stock;
    const numericFallback = Number(fallback);
    return Number.isFinite(numericFallback) ? numericFallback : undefined;
  };

  const editProductsReady = showEdit?._isOffline || editProductsState === 'loaded' || editProductsState === 'empty';
  const editProductsValidationEnabled = editProductsReady && editProductsState !== 'error';

  const editStockValidation = useMemo(() => {
    if (!editProductsValidationEnabled) {
      return { hasInvalid: false, errors: [], firstError: null, productStates: new Map(), invalidProductIds: new Set(), invalidLineKeys: new Set(), settings: negativeStockSettings, minimumAllowedStock: 0, warningThreshold: 0, limitMessage: '', summaryMessage: '' };
    }
    return buildSaleStockValidation(editDetails, {
      baselineLines: showEdit?._isOffline ? [] : editBaselineDetails,
      getProductStockById: getEditProductStockById,
      getLineKey: getEditDetailRowKey,
      settings: negativeStockSettings,
    });
  }, [editDetails, editBaselineDetails, editProductsValidationEnabled, negativeStockSettings, showEdit]);
  const hasEditStockError = editProductsValidationEnabled ? editStockValidation.hasInvalid : false;
  const showStockLimitToast = (message = NEGATIVE_STOCK_LIMIT_MESSAGE) => {
    setStockToast({ id: Date.now(), message });
  };
  const guardEditStockBeforeSubmit = () => {
    if (!editProductsValidationEnabled) return true;
    if (!hasEditStockError) return true;
    showStockLimitToast(editStockValidation.firstError?.message || NEGATIVE_STOCK_LIMIT_MESSAGE);
    return false;
  };


  const findCustomerForOrder = useCallback((order = {}) => {
    const customerId = Number(order.customer_id ?? order.customerId ?? order.payload?.customer_id);
    if (Number.isFinite(customerId) && customerId > 0) {
      const byId = customers.find(c => Number(c.id) === customerId);
      if (byId) return byId;
    }
    const orderName = String(order.customer_name || order.payload?.customer_name || '').trim().toLowerCase();
    const orderPhone = String(order.customer_phone || order.phone || order.payload?.customer_phone || order.payload?.phone || '').trim();
    if (orderPhone) {
      const byPhone = customers.find(c => String(c.phone || '').trim() === orderPhone);
      if (byPhone) return byPhone;
    }
    if (orderName && orderName !== 'khách l?' && orderName !== 'khach le') {
      const byName = customers.find(c => String(c.name || '').trim().toLowerCase() === orderName);
      if (byName) return byName;
    }
    return null;
  }, [customers]);

  const getLineProductSource = useCallback((line = {}) => getEditProductById(line.variant_id || line.product_id) || line, [editProducts]);

  const repriceEditDetailsForCustomer = useCallback((details = [], customer = null) => {
    const priceType = customer ? customerTypeToPriceType(customer.customer_type || customer.customer_type_name) : 'retail';
    return details.map(line => {
      const source = getLineProductSource(line);
      const currentUnitPrice = getPriceValueByType(source, priceType);
      const quantity = Number(line.quantity) || 1;
      const discountPercent = Number(line.discount_percent) || 0;
      const discountAmount = discountPercent > 0 ? quantity * currentUnitPrice * discountPercent / 100 : (Number(line.discount_amount) || 0);
      // Ưu tiên unit_price hiện tại của dòng (giá user đang thấy/sửa). sale_price_at_sale
      // (snapshot cũ) KHÔNG được lấn unit_price, nếu không sửa giá sẽ không bao giờ lưu.
      const resolvedUnitPrice = line.unit_price != null ? Number(line.unit_price) : currentUnitPrice;
      // Giá vốn: giữ snapshot cost_price_at_sale/import_price nếu có, nếu không lấy giá vốn product.
      const costPrice = line.cost_price_at_sale != null ? Number(line.cost_price_at_sale) : (line.import_price != null ? Number(line.import_price) : (source && source.import_price != null ? Number(source.import_price) : 0));
      const profit = (resolvedUnitPrice - costPrice) * quantity;
      return {
        ...line,
        unit_price: resolvedUnitPrice,
        cost_price_at_sale: costPrice,
        sale_price_at_sale: resolvedUnitPrice,
        profit_at_sale: profit,
        discount_amount: discountAmount,
        line_total: quantity * resolvedUnitPrice - discountAmount,
      };
    });
  }, [getLineProductSource]);

  const applyEditCustomer = useCallback((customerIdValue) => {
    const customerId = Number(customerIdValue) || null;
    const customer = customerId ? customers.find(c => Number(c.id) === customerId) : null;
    setEditDetails(prev => {
      const updated = repriceEditDetailsForCustomer(prev, customer);
      // Show price suggestions for any lines where stored price differs
      updated.forEach((line, idx) => {
        const prodId = line.product_id || line.variant_id;
        if (prodId) {
          maybeShowPriceSuggestion(idx, prodId, line.unit_price, customerId);
        }
      });
      const sub = updated.reduce((sum, d) => sum + (Number(d.line_total) || 0), 0);
      setEditForm(f => {
        const vat = sub * ((Number(f.vat_percent) || 0) / 100);
        const disc = Number(f.discount_percent) ? sub * Number(f.discount_percent) / 100 : (Number(f.discount_amount) || 0);
        const total = sub + vat - disc + (Number(f.delivery_fee) || 0);
        const paid = Number(f.paid_amount) || 0;
        return { ...f, customer_id: customerId, customer_name: customer?.name || (customerId ? f.customer_name : 'Khách lẻ'), customer_type: customer?.customer_type || customer?.customer_type_name || (customerId ? f.customer_type : 'Khách lẻ'), subtotal: sub, vat_amount: vat, total, remaining_amount: Math.max(0, total - paid), change_amount: Math.max(0, paid - total) };
      });
      return updated;
    });
  }, [customers, repriceEditDetailsForCustomer]);

  const editProductsStateLabel = { loading: 'đang tđi dữ liệu sản phẩm...', loaded: '', empty: 'Không có dữ liệu sản phẩm d? kiểm tra tồn kho.', error: 'Không tải được dữ liệu sản phẩm, vđơn cho phép luu.' }[editProductsState] || '';

  const filteredEditCustomers = useMemo(() => {
    const query = String(editCustomerSearch || '').trim().toLowerCase();
    if (!query) return [];
    const phoneQuery = query.replace(/\\D+/g, '');
    return customers.filter(customer => {
      const haystack = [customer.name, customer.phone, customer.code, customer.email, customer.customer_type].filter(Boolean).join(' ').toLowerCase();
      if (haystack.includes(query)) return true;
      const phone = String(customer.phone || '').replace(/\\D+/g, '');
      return Boolean(phoneQuery && phone.includes(phoneQuery));
    }).slice(0, 8);
  }, [customers, editCustomerSearch]);


  useEffect(() => {
    if (!showEdit || !hasEditStockError) {
      lastStockLimitToastRef.current = '';
      return;
    }
    const message = editStockValidation.firstError?.message || NEGATIVE_STOCK_LIMIT_MESSAGE;
    if (lastStockLimitToastRef.current === message) return;
    lastStockLimitToastRef.current = message;
    showStockLimitToast(message);
  }, [showEdit, hasEditStockError, editStockValidation.firstError?.message]);

  // Mở xem chi tiết
  const openView = async (inv) => {
    if (inv._isOffline) {
      setInvoiceDetails(inv.cart || []);
      setShowView(inv);
      return;
    }

    try {
      const data = await apiJson(`/invoices/${inv.id}`, {}, 'Không tải được chi tiết đơn!');
      setInvoiceDetails(data.details || []);
      setShowView({ ...inv, ...data });
    } catch {
      alert('📡 Không kết nối được server!');
    }
  };

  // Mở sửa
  const openEdit = async (inv) => {
    // ── OFFLINE: lấy chi tiết từ localStorage ──
    if (inv._isOffline) {
      const cartDetails = inv.cart?.map((c, i) => ({
        id: c.id || (`offline_${i}`),
        type: c.type || c.item_type || (c.is_service || c.isService ? 'service' : 'product'),
        item_type: c.item_type || c.type || (c.is_service || c.isService ? 'service' : 'product'),
        is_service: c.is_service || c.isService || false,
        combo_id: c.combo_id || null,
        product_id: c.product_id || null,
        variant_id: c.variant_id || null,
        parent_id: c.parent_id || null,
        parent_name: c.parent_name || '',
        variant_name: c.variant_name || '',
        product_name: c.product_name || c.name || '',
        product_sku: c.product_sku || c.sku || '',
        name: c.name || c.product_name || '',
        sku: c.sku || c.product_sku || '',
        quantity: c.quantity || 1,
        unit_price: c.unit_price || 0,
        discount_percent: c.discount_percent || 0,
        discount_amount: c.discount_amount || 0,
        line_total: c.line_total || 0,
      })) || [];
      const nextDetails = mergeDuplicateProducts(cartDetails);
      setEditDetails(nextDetails);
      setEditBaselineDetails([]);
      setEditProductsState('loaded');
      setEditForm({
        customer_id: inv.customer_id || null,
        customer_name: inv.customer_name || 'Khách lẻ',
        payment_method: inv.payment_method || 'cash',
        note: inv.note || '',
        subtotal: inv.subtotal || 0,
        vat_percent: inv.vat_percent || 0,
        vat_amount: inv.vat_amount || 0,
        discount_percent: inv.discount_percent || 0,
        discount_amount: inv.discount_amount || 0,
        delivery_fee: inv.delivery_fee || 0,
        paid_amount: inv.paid_amount || 0,
        change_amount: inv.change_amount || 0,
        remaining_amount: inv.remaining_amount || 0,
        total: inv.total || 0,
        status: inv.status || 'pending',
        created_at: inv.created_at ? (() => {
          const d = new Date(inv.created_at);
          const pad = n => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        })() : '',
      });
      setShowEdit(inv);
      return;
    }
    // ── ONLINE: fetch từ server ──
    try {
      const data = await apiJson(`/invoices/${inv.id}`, {}, 'Không tải được đơn hàng!');
      const nextDetails = Array.isArray(data.details) ? data.details.map(detail => ({
        ...detail,
        id: detail.id ?? detail.order_item_id ?? null,
        order_item_id: detail.order_item_id ?? detail.id ?? null,
      })) : [];
      setEditDetails(nextDetails);
      setEditBaselineDetails(nextDetails.map(item => ({ ...item })));
      setEditProductsState('loading');
      setEditForm({
        customer_id: (findCustomerForOrder({ ...inv, ...data })?.id ?? data.customer_id ?? inv.customer_id) || null,
        customer_name: findCustomerForOrder({ ...inv, ...data })?.name || data.customer_name || inv.customer_name || 'Khách lẻ',
        customer_type: findCustomerForOrder({ ...inv, ...data })?.customer_type || data.customer_type || inv.customer_type || 'Khách lẻ',
        payment_method: data.payment_method || inv.payment_method || 'cash',
        note: data.note || inv.note || '',
        subtotal: data.subtotal || inv.subtotal || 0,
        vat_percent: data.vat_percent || inv.vat_percent || 0,
        vat_amount: data.vat_amount || inv.vat_amount || 0,
        discount_percent: data.discount_percent || inv.discount_percent || 0,
        discount_amount: data.discount_amount || inv.discount_amount || 0,
        delivery_fee: data.delivery_fee || inv.delivery_fee || 0,
        paid_amount: data.paid_amount || inv.paid_amount || 0,
        change_amount: data.change_amount || inv.change_amount || 0,
        remaining_amount: data.remaining_amount || inv.remaining_amount || 0,
        total: data.total || inv.total || 0,
        status: data.status || inv.status || 'pending',
        created_at: inv.created_at ? (() => {
          const d = new Date(inv.created_at);
          const pad = n => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        })() : '',
      });
      setShowEdit(inv);
    } catch {
      alert('📡 Không kết nối được server!');
    }
  };

  // Tính lại total khi details thay đổi
  const recalcEdit = (details) => {
    const sub = details.reduce((s, d) => s + (d.line_total || 0), 0);
    const vat = sub * (editForm.vat_percent / 100);
    const disc = editForm.discount_percent ? sub * (editForm.discount_percent / 100) : (editForm.discount_amount || 0);
    return sub + vat - disc + (+editForm.delivery_fee || 0);
  };

  // Cập nhật dòng chi tiết
  const updateDetail = (idx, field, val) => {
    setEditDetails(prev => {
      const updated = prev.map((d, i) => {
        if (i !== idx) return d;
        const newItem = { ...d, [field]: val };
        if (field === 'quantity') newItem.quantity = Math.max(1, +val);
        if (field === 'unit_price') newItem.unit_price = Math.max(0, +val);
        if (field === 'discount_percent') {
          newItem.discount_percent = Math.min(100, Math.max(0, +val));
          newItem.discount_amount = newItem.quantity * newItem.unit_price * newItem.discount_percent / 100;
        }
        if (field === 'product_name' && (newItem.is_service || newItem.isService || newItem.type === 'service' || newItem.type === 'custom_service' || newItem.item_type === 'service' || newItem.item_type === 'custom_service')) {
          newItem.name = val;
          newItem.service_name = val;
        }
        newItem.line_total = newItem.quantity * newItem.unit_price - (newItem.discount_amount || 0);
        // Đồng bộ snapshot giá tại thời điểm bán theo giá dòng hiện tại.
        // sale_price_at_sale phải khớp unit_price để backend lưu đúng giá mới
        // (backend ưu tiên unit_price, nhưng giữ snapshot khớp tránh lệch dữ liệu).
        if (field === 'unit_price' || field === 'quantity') {
          newItem.sale_price_at_sale = newItem.unit_price;
          const costPrice = newItem.cost_price_at_sale != null
            ? Number(newItem.cost_price_at_sale)
            : (newItem.import_price != null ? Number(newItem.import_price) : 0);
          newItem.profit_at_sale = (Number(newItem.unit_price) - costPrice) * (Number(newItem.quantity) || 1);
        }
        return newItem;
      });
      const sub = updated.reduce((s, d) => s + (d.line_total || 0), 0);
      const vat = sub * (editForm.vat_percent / 100);
      const disc = editForm.discount_percent ? sub * editForm.discount_percent / 100 : (editForm.discount_amount || 0);
      const total = sub + vat - disc + (+editForm.delivery_fee || 0);
      const paid = +editForm.paid_amount || 0;
      setEditForm(f => ({ ...f, subtotal: sub, total, remaining_amount: Math.max(0, total - paid), change_amount: Math.max(0, paid - total) }));
      return updated;
    });
  };

  // Xóa dòng chi tiết
  const removeDetail = (idx) => {
    setEditDetails(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      const sub = updated.reduce((s, d) => s + (d.line_total || 0), 0);
      const vat = sub * (editForm.vat_percent / 100);
      const disc = editForm.discount_percent ? sub * editForm.discount_percent / 100 : (editForm.discount_amount || 0);
      const total = sub + vat - disc + (+editForm.delivery_fee || 0);
      const paid = +editForm.paid_amount || 0;
      setEditForm(f => ({ ...f, subtotal: sub, total, remaining_amount: Math.max(0, total - paid), change_amount: Math.max(0, paid - total) }));
      return updated;
    });
  };

  // This line deliberately has no product_id, so it is never an inventory item.
  const addCustomServiceDetail = () => {
    const serviceDetail = {
      // The database assigns the persisted ID for an added service row.
      id: null,
      order_item_id: null,
      client_line_id: `custom_service_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type: 'custom_service',
      item_type: 'custom_service',
      is_service: true,
      product_id: null,
      variant_id: null,
      product_name: 'Dịch vụ khác',
      product_sku: '',
      name: 'Dịch vụ khác',
      sku: '',
      quantity: 1,
      unit_price: 0,
      import_price: 0,
      cost_price_at_sale: 0,
      sale_price_at_sale: 0,
      profit_at_sale: 0,
      discount_percent: 0,
      discount_amount: 0,
      line_total: 0,
      _new: true,
    };
    setEditDetails(prev => {
      const updated = [...prev, serviceDetail];
      const subtotal = updated.reduce((sum, detail) => sum + (Number(detail.line_total) || 0), 0);
      const vat = subtotal * (Number(editForm.vat_percent) || 0) / 100;
      const discount = Number(editForm.discount_percent)
        ? subtotal * Number(editForm.discount_percent) / 100
        : (Number(editForm.discount_amount) || 0);
      const total = subtotal + vat - discount + (Number(editForm.delivery_fee) || 0);
      const paid = Number(editForm.paid_amount) || 0;
      setEditForm(form => ({
        ...form,
        subtotal,
        vat_amount: vat,
        total,
        remaining_amount: Math.max(0, total - paid),
        change_amount: Math.max(0, paid - total),
      }));
      return updated;
    });
  };

  // Thêm sản phẩm vào chi tiết sửa
  const addDetailFromPicker = (p) => {
    const isVariant = Boolean(p.is_variant || p.parent_id || p.parent_name || p.parent?.name);
    const isService = Boolean(p.is_service || p.service);
    const displayName = getProductDisplayName(p);
    const customer = editForm.customer_id ? customers.find(c => Number(c.id) === Number(editForm.customer_id)) : null;
    const activePriceType = customer ? customerTypeToPriceType(customer.customer_type) : 'retail';
    const price = getPriceValueByType(p, activePriceType);
    const baseDetail = {
      id: Date.now(),
      quantity: 1,
      unit_price: price,
      discount_amount: 0,
      discount_percent: 0,
      line_total: price,
      _new: true,
    };
    const newDetail = isService
      ? {
          type: 'service',
          item_type: 'service',
          is_service: true,
          ...baseDetail,
          name: displayName,
          sku: p.sku || '',
        }
      : {
          type: 'product',
          item_type: 'product',
          product_id: p.id,
          variant_id: isVariant ? p.id : null,
          parent_id: isVariant ? (p.parent_id || p.parent?.id || null) : null,
          parent_name: isVariant ? (p.parent_name || p.parent?.name || '') : '',
          variant_name: isVariant ? p.name : '',
          product_name: displayName,
          product_sku: p.sku || '',
          name: displayName,
          sku: p.sku || '',
          max_stock: p.stock,
          current_stock: p.stock,
          stock: p.stock,
          ...baseDetail,
        };
    setEditDetails(prev => {
      const lineIdx = prev.length; // index of the new line
      const updated = [...prev, newDetail];
      const sub = updated.reduce((s, d) => s + (d.line_total || 0), 0);
      const vat = sub * (editForm.vat_percent / 100);
      const disc = editForm.discount_percent ? sub * editForm.discount_percent / 100 : (editForm.discount_amount || 0);
      const total = sub + vat - disc + (+editForm.delivery_fee || 0);
      const paid = +editForm.paid_amount || 0;
      setEditForm(f => ({ ...f, subtotal: sub, total, remaining_amount: Math.max(0, total - paid), change_amount: Math.max(0, paid - total) }));
      // Show price suggestion if stored price differs
      maybeShowPriceSuggestion(lineIdx, p.id, price, editForm.customer_id);
      return updated;
    });
    setShowProductPicker(false);
    setEditProductSearch('');
  };

  // Lưu sửa
  const handleSaveEdit = async () => {
    if (editDetails.length === 0) { alert('Chưa có sản phẩm nào!'); return; }
    if (!guardEditStockBeforeSubmit()) return;
    setSaveLoading(true);

    // ── OFFLINE: cập nhật localStorage ──
    if (showEdit._isOffline) {
      try {
        const sub = editDetails.reduce((s, d) => s + (d.line_total || 0), 0);
        const vat = sub * (editForm.vat_percent / 100);
        const disc = editForm.discount_percent ? sub * editForm.discount_percent / 100 : (editForm.discount_amount || 0);
        const deliveryFee = +editForm.delivery_fee || 0;
        const paidAmount = +editForm.paid_amount || 0;
        const newTotal = sub + vat - disc + deliveryFee;
        const remainingAmount = Math.max(0, newTotal - paidAmount);
        const changeAmount = Math.max(0, paidAmount - newTotal);

        const updatedCart = editDetails.map(c => ({
          id: c.id,
          type: c.type || c.item_type || (c.is_service || c.isService ? 'service' : 'product'),
          item_type: c.item_type || c.type || (c.is_service || c.isService ? 'service' : 'product'),
          is_service: Boolean(c.is_service || c.isService),
          product_id: c.product_id,
          variant_id: c.variant_id || null,
          parent_id: c.parent_id || null,
          parent_name: c.parent_name || '',
          variant_name: c.variant_name || '',
          product_name: c.product_name || c.name || '',
          product_sku: c.product_sku || c.sku || '',
          name: c.name || c.product_name || '',
          sku: c.sku || c.product_sku || '',
          quantity: c.quantity,
          unit_price: c.unit_price,
          discount_percent: c.discount_percent,
          discount_amount: c.discount_amount,
          line_total: c.line_total,
        }));
        const updatedPayload = {
          ...(showEdit.payload || {}),
          client_order_id: showEdit.client_order_id || showEdit.payload?.client_order_id || '',
          invoice_code: showEdit.invoice_code || showEdit.payload?.invoice_code || '',
          customer_id: editForm.customer_id || null,
          customer_name: editForm.customer_name || 'Khách lẻ',
          customer_type: editForm.customer_type || 'Khách lẻ',
          payment_method: editForm.payment_method,
          note: editForm.note || '',
          subtotal: sub,
          vat_percent: editForm.vat_percent,
          vat_amount: vat,
          discount_percent: editForm.discount_percent,
          discount_amount: disc,
          delivery_fee: deliveryFee,
          paid_amount: paidAmount,
          change_amount: changeAmount,
          remaining_amount: remainingAmount,
          total: newTotal,
          status: editForm.status || 'pending',
          created_at: editForm.created_at || showEdit.created_at,
          details: updatedCart,
        };
        const updated = {
          ...showEdit,
          id: showEdit.id || updatedPayload.client_order_id || showEdit.invoice_code,
          client_order_id: updatedPayload.client_order_id,
          payload: updatedPayload,
          cart: updatedCart,
          customer_id: editForm.customer_id || null,
          customer_name: editForm.customer_name || 'Khách lẻ',
          payment_method: editForm.payment_method,
          note: editForm.note || '',
          subtotal: sub,
          vat_percent: editForm.vat_percent,
          vat_amount: vat,
          discount_percent: editForm.discount_percent,
          discount_amount: disc,
          delivery_fee: deliveryFee,
          paid_amount: paidAmount,
          change_amount: changeAmount,
          remaining_amount: remainingAmount,
          total: newTotal,
          status: editForm.status || 'pending',
          created_at: editForm.created_at || showEdit.created_at,
        };

        const pending = JSON.parse(localStorage.getItem('kha_pending_orders') || '[]');
        const idx = pending.findIndex(o => sameOrderIdentity(o, showEdit));
        if (idx >= 0) pending[idx] = updated;
        else pending.unshift(updated);
        localStorage.setItem('kha_pending_orders', JSON.stringify(pending));

        // Cập nhật allOrders
        setAllOrders(prev => prev.map(o =>
          sameOrderIdentity(o, showEdit) ? updated : o
        ));
        setShowEdit(null);
        setEditBaselineDetails([]);
        alert('? Don offline đã được cập nhật!');
      } catch {
        alert('⚠️ Lỗi khi lưu đơn offline!');
      } finally {
        setSaveLoading(false);
      }
      return;
    }

    // ── ONLINE: PUT lên server ──
    try {
      const payload = {
        customer_id: editForm.customer_id || null,
        customer_name: editForm.customer_name || 'Khách lẻ',
        customer_type: editForm.customer_type || 'Khách lẻ',
        payment_method: editForm.payment_method,
        note: editForm.note || '',
        subtotal: editForm.subtotal || 0,
        vat_percent: editForm.vat_percent || 0,
        vat_amount: editForm.vat_amount || 0,
        discount_percent: editForm.discount_percent || 0,
        discount_amount: editForm.discount_amount || 0,
        total: editForm.total || 0,
        delivery_fee: editForm.delivery_fee || 0,
        paid_amount: editForm.paid_amount || 0,
        change_amount: editForm.change_amount || 0,
        remaining_amount: editForm.remaining_amount || 0,
        status: editForm.status || 'pending',
        created_at: editForm.created_at || null,
        details: editDetails.map(detail => {
        const {
          type,
          item_type,
          is_service,
          isService,
          combo_id,
          product_id,
          variant_id,
          parent_id,
          parent_name,
          variant_name,
          product_name,
          product_sku,
          name,
          sku,
          quantity,
          unit_price,
          import_price,
          cost_price_at_sale,
          sale_price_at_sale,
          profit_at_sale,
          discount_amount,
          discount_percent,
          line_total,
        } = detail;
        // Nếu sản phẩm không tồn tại trong danh mục hiện tại, bỏ product_id / variant_id để server không trả lỗi
        const persistedRowId = Number(detail.order_item_id ?? detail.id);
        const rowId = Number.isInteger(persistedRowId) && persistedRowId > 0 ? persistedRowId : null;
        // Quy chuẩn giá tại thời điểm bán: sale_price_at_sale phải khớp unit_price hiện tại
        // của dòng đơn hàng (giá user đang thấy/sửa). Đây là giá riêng của dòng đơn, không lấy
        // lại từ bảng products. Backend ưu tiên unit_price, nhưng giữ snapshot khớp để load lại
        // hiển thị đúng và báo cáo lợi nhuận lấy đúng giá đã bán.
        const finalUnitPrice = Math.max(0, Number(unit_price) || 0);
        const finalCostPrice = Math.max(0, Number(cost_price_at_sale != null ? cost_price_at_sale : (import_price != null ? import_price : 0)) || 0);
        const finalQuantity = Number(quantity) || 1;
        const finalLineTotal = Math.max(0, Number(line_total) || (finalQuantity * finalUnitPrice - (Number(discount_amount) || 0)));
        const finalProfit = (finalUnitPrice - finalCostPrice) * finalQuantity;
        const serviceLine = Boolean(is_service || isService || type === 'service' || type === 'custom_service' || item_type === 'service' || item_type === 'custom_service');
        return {
          type: type || item_type || (is_service || isService ? 'service' : undefined),
          item_type: item_type || type || (is_service || isService ? 'service' : undefined),
          is_service: is_service || isService || false,
          combo_id: combo_id || null,
          id: rowId,
          order_item_id: rowId,
          product_id: serviceLine ? null : product_id,
          variant_id: serviceLine ? null : variant_id,
          parent_id: parent_id || null,
          parent_name: parent_name || '',
          variant_name: variant_name || '',
          product_name: product_name || name || '',
          product_sku: product_sku || sku || '',
          name: name || product_name || '',
          sku: sku || product_sku || '',
          quantity: finalQuantity,
          unit_price: finalUnitPrice,
          import_price: finalCostPrice,
          cost_price_at_sale: finalCostPrice,
          sale_price_at_sale: finalUnitPrice,
          profit_at_sale: finalProfit,
          discount_amount: Math.max(0, Number(discount_amount) || 0),
          discount_percent: Math.max(0, Number(discount_percent) || 0),
          line_total: Math.max(0, finalQuantity * finalUnitPrice - Math.max(0, Number(discount_amount) || 0)),
        };
      }),
      };
      await apiJsonChecked(`/invoices/${showEdit.id}`, { method: 'PUT', body: payload }, 'Không thể lưu đơn hàng.');
      // Verify dữ liệu vừa lưu: gọi GET order detail để chắc chắn database đã cập nhật thật.
      try {
        clearApiCache();
        const verified = await apiJson(`/invoices/${showEdit.id}?_verify=${Date.now()}`, {}, 'Không tải lại được đơn hàng để kiểm tra.');
        const sentPrices = (payload.details || []).map(d => ({ key: `${d.type || d.item_type || 'product'}:${d.product_id || d.variant_id || d.combo_id || ''}:${d.product_name || d.name || ''}`, unit_price: Math.max(0, Number(d.unit_price) || 0) }));
        const gotDetails = Array.isArray(verified?.details) ? verified.details : [];
        const mismatches = [];
        for (const sent of sentPrices) {
          const got = gotDetails.find(g => `${g.type || g.item_type || 'product'}:${g.product_id || g.variant_id || g.combo_id || ''}:${g.product_name || g.name || ''}` === sent.key);
          if (!got) { mismatches.push({ key: sent.key, reason: 'dòng không tồn nay sau lưu' }); continue; }
          const gotPrice = Math.max(0, Number(got.unit_price) || 0);
          if (gotPrice !== sent.unit_price) mismatches.push({ key: sent.key, sent: sent.unit_price, got: gotPrice });
        }
        if (mismatches.length > 0) {
          throw new Error('Lưu thất bại: giá đơn hàng chưa được cập nhật vào database. ' + JSON.stringify(mismatches));
        }
      } catch (verifyErr) {
        // Không đóng form, báo lỗi rõ ràng để user biết database chưa cập nhật thật.
        alert(verifyErr?.message || 'Lưu thất bại: giá đơn hàng chưa được cập nhật vào database.');
        return;
      }
      setShowEdit(null);
      setEditBaselineDetails([]);
      notifyOrderChanged({ reason: 'order-updated', invoice_id: showEdit.id });
      clearApiCache();
      await fetchInvoices();
      apiJson('/products/all/with-variants').catch(() => { });
    } catch (err) {
      alert(err.message || '📡 Không thể kết nối server!');
    } finally {
      setSaveLoading(false);
    }
  };

  // Hủy đơn
  const handleCancel = async (inv) => {
    if (!confirm(`Hủy đơn hàng ${inv.invoice_code}?\n\nHàng sẽ được hoàn về kho.`)) return;
    try {
      // Determine order identifier
      const orderId = getOrderIdentityKey(inv);
      const isOffline = inv._isOffline;

      let success = false;

      if (isOffline) {
        // Delete offline order from localStorage
        const pending = JSON.parse(localStorage.getItem('kha_pending_orders') || '[]');
        const updatedPending = pending.filter(o => !sameOrderIdentity(o, inv));
        localStorage.setItem('kha_pending_orders', JSON.stringify(updatedPending));
        success = true;
      } else {
        // Delete online order from server
        await apiJsonChecked(`/invoices/${inv.id}`, { method: 'DELETE' }, 'Không thể hủy đơn!');
        success = true;
      }

      if (success) {
        // Remove from selected if present
        setSelectedOrders(prev => prev.filter(id => id !== orderId));
        notifyOrderChanged({ reason: 'order-cancelled', invoice_id: inv.id || null, invoice_code: inv.invoice_code || '' });
        // Refresh product stock
        await fetchInvoices();
        apiJson('/products/all/with-variants').catch(() => { });
        alert('Đã hủy đơn hàng! Đơn sẽ tự động xóa sau 24 giờ.');
      }
    } catch {
      alert('📡 Không thể kết nối server!');
    }
  };

  // Xác nhận thanh toán (chuyển trạng thái sang completed)
  const handleMarkAsPaid = async (inv) => {
    if (!confirm(`Xác nhận đơn hàng ${inv.invoice_code} đã thanh toán!`)) return;
    try {
      if (inv._isOffline) {
        // Cập nhật offline order trong localStorage
        const pending = JSON.parse(localStorage.getItem('kha_pending_orders') || '[]');
        const idx = pending.findIndex(o => sameOrderIdentity(o, inv));
        if (idx >= 0) {
          pending[idx].status = 'completed';
          pending[idx].payload = { ...(pending[idx].payload || {}), status: 'completed' };
          localStorage.setItem('kha_pending_orders', JSON.stringify(pending));
          // Cập nhật allOrders
          setAllOrders(prev => prev.map(o =>
            sameOrderIdentity(o, inv) ? { ...o, status: 'completed', _isOffline: true } : o
          ));
        }
        alert('? Đã cập nhật trạng thái đơn hàng thành "Đã thanh tóan"!');
      } else {
        // Gọi API xác nhận đơn hàng (PATCH /invoices/:id/confirm)
        await apiJsonChecked(`/invoices/${inv.id}/confirm`, { method: 'PATCH' }, 'Không thể xác nhận thanh toán.');
        alert('? D? xác nhận thanh toán!');
        notifyOrderChanged({ reason: 'order-paid', invoice_id: inv.id || null, invoice_code: inv.invoice_code || '' });
        await fetchInvoices();
        apiJson('/products/all/with-variants').catch(() => { });
      }
    } catch (err) {
      alert(err.message || '📡 Lỗi kết nối!');
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      {stockToast && (
        <div className="toast-stack">
          <div className="toast-card border-red-200 bg-red-50 text-red-700">
            ⚠️ {stockToast.message}
          </div>
        </div>
      )}
      {priceSuggestion && (
        <div className="toast-stack mt-2">
          <div className="toast-card border-blue-200 bg-blue-50 text-blue-700 flex items-center gap-2">
            📊 Giá thay đổi: {priceSuggestion.oldPrice} → {priceSuggestion.price}. Áp dụng?
            <button onClick={applySuggestedPrice} className="ml-auto px-2 py-1 bg-blue-600 text-white rounded">
              Áp dụng
            </button>
            <button onClick={() => setPriceSuggestion(null)} className="px-2 py-1 bg-gray-300 rounded">
              Bỏ qua
            </button>
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900 px-5 py-5 text-white">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-11 w-11 rounded-2xl bg-white/10 flex items-center justify-center border border-white/10">
                  <Package size={22} className="text-blue-200" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.25em] text-blue-200/80">Order Management</div>
                  <h1 className="text-2xl font-bold">Danh sách đơn hàng</h1>
                </div>
              </div>
              <p className="text-sm text-blue-100/80 max-w-2xl">
                Theo dõi đơn đơn hàng, trạng thái xử lý và thao tác nhanh trên cùng một màn hình.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <button
                onClick={() => setShowHelp(true)}
                className="px-3.5 py-2 rounded-xl border border-white/15 bg-white/10 hover:bg-white/15 text-sm font-medium flex items-center gap-2"
              >
                <HelpCircle size={15} /> Hướng dẫn
              </button>
              <button
                onClick={() => setShowExcelImport(s => !s)}
                className={`px-3.5 py-2 rounded-xl border border-white/15 text-sm font-semibold flex items-center gap-2 ${showExcelImport ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-white/10 hover:bg-white/15'}`}
              >
                <UploadCloud size={15} /> Import Excel/CSV
              </button>
              <button
                onClick={() => {
                  setLoading(true);
                  fetchInvoices().finally(() => setLoading(false));
                }}
                className="px-3.5 py-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-sm font-semibold flex items-center gap-2"
              >
                <RefreshCw size={15} /> Làm mới
              </button>
              {selectedOrders.length > 0 && (
                <button
                  onClick={handleBulkDelete}
                  disabled={isBulkDeleting}
                  className="px-3.5 py-2 rounded-xl bg-red-500 hover:bg-red-400 disabled:bg-white/20 text-sm font-semibold flex items-center gap-2"
                >
                  <Trash2 size={15} /> Hủy đã chọn ({selectedOrders.length})
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 bg-gray-50 border-t border-white/10">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map(card => {
              const Icon = card.icon;
              return (
                <div key={card.key} className={`rounded-2xl border px-4 py-3 ${card.tone}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-medium opacity-80">{card.label}</div>
                      <div className="mt-1 text-xl font-bold">{card.value}</div>
                    </div>
                    <div className="h-10 w-10 rounded-xl bg-white/70 flex items-center justify-center">
                      <Icon size={18} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {showExcelImport && (
        <ExcelImportPanel
          dataType="invoices"
          title="Import hóa đơn/đơn hàng từ Excel/CSV"
          description={`Preview/validate đơn hàng về chi tiết sản phẩm trước khi commit; cho phép bđơn khi tđơn 0/âm nđủ tđơn d? kiđơn không th?p hon ${negativeStockLimitLabel}, một don nhiđủ d?ng được gom theo mã don.`}
          negativeStockSettings={negativeStockSettings}
          onCommitted={async () => {
            setLoading(true);
            await fetchInvoices().finally(() => setLoading(false));
          }}
          onClose={() => setShowExcelImport(false)}
        />
      )}

      <div className="min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="px-4 pt-4">
          <div className="flex flex-wrap gap-2">
            {statusTabs.map(tab => {
              const active = filterStatus === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setFilterStatus(tab.key)}
                  className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                >
                  <span>{tab.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${active ? 'bg-white/20 text-white' : 'bg-white text-gray-500'}`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-4 border-t border-gray-100">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_220px_220px_220px]">
          <div className="relative" onClick={() => document.getElementById('order-search')?.focus()}>
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              id="order-search"
              autoFocus
              className="input-field w-full pl-9"
              placeholder="Tìm theo mã đơn, DHXXXXX, tên khách hàng..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
            <select className="input-field" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="pending">⏳ Chờ xác nhận</option>
              <option value="processing">🔄 Đang xử lý</option>
              <option value="completed">✅ Hoàn thành</option>
              <option value="cancelled">❌ Đã hủy</option>
              <option value="offline">📡 Offline</option>
            </select>
            <select className="input-field" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
              {sourceOptions.map(option => (
                <option key={option.key} value={option.key}>{option.label}{option.count !== undefined ? ` (${option.count})` : ''}</option>
              ))}
            </select>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-gray-500">
              <span className="rounded-full bg-blue-50 text-blue-700 px-3 py-1 font-medium">Hiển thị {filtered.length} đơn</span>
              {selectedOrders.length > 0 && (
                <span className="rounded-full bg-amber-50 text-amber-700 px-3 py-1 font-medium">D? chọn {selectedOrders.length} don</span>
              )}
              {!serverOnline && (
                <span className="rounded-full bg-red-50 text-red-600 px-3 py-1 font-medium">Đang ở chế độ offline</span>
              )}
            </div>
            <div className="text-xs text-gray-400">
              Uu tiđơn dữ liệu server khi tr?ng mã don, vđơn giá don local d? thao t?c ti?p.
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 lg:hidden">
          {loading ? (
            <div className="text-center text-gray-400 py-12 flex flex-col items-center justify-center gap-3">
              <Loader size={28} className="animate-spin text-blue-400" />
              <div>
                <div className="font-medium text-gray-600">Đang tải danh sách đơn hàng...</div>
                {!serverOnline && <div className="text-xs text-red-400 mt-1">⚠️ Server đang offline</div>}
              </div>
            </div>
          ) : !serverOnline && filtered.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="text-5xl mb-3 opacity-30">📡</div>
              <div className="font-semibold text-gray-500 mb-1">Server đang offline</div>
              <div className="text-sm text-gray-400 mb-4">Danh sách đang hiển thị từ dữ liệu cục bộ nếu có.</div>
              <button onClick={() => {
                setLoading(true);
                fetchInvoices().finally(() => setLoading(false));
              }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
                🔄 Thử lại
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-gray-400 py-12 px-4">
              <div className="text-5xl mb-3 opacity-20">📦</div>
              <div className="font-medium text-gray-500">Không có đơn phù hợp</div>
              <div className="text-sm mt-1">Thử đổi trạng thái lọc hoặc từ khóa tìm kiếm</div>
            </div>
          ) : (
            <div className="space-y-3 p-3">
              <div className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-sm">
                <button
                  onClick={toggleSelectAll}
                  className="inline-flex min-h-10 items-center gap-2 text-gray-600 hover:text-blue-700"
                  title={selectedAll ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                >
                  {selectedAll ? <CheckSquare size={16} /> : <Square size={16} />}
                  <span>{selectedAll ? 'B? chọn tất cả' : 'Chọn tất cả'}</span>
                </button>
                <span className="text-xs text-gray-400">{filtered.length} đơn</span>
              </div>
              {filtered.map((inv, rowIndex) => {
                const st = getOrderStatusMeta(inv.status);
                const isCancelled = isCancelledOrderStatus(inv.status);
                const cancelRemainingText = formatCancelAutoDeleteRemaining(inv, nowMs);
                const formatDelivery = (d) => {
                  if (!d) return 'Chưa chốt';
                  const [y, mo, day] = d.split('-');
                  return `${day}/${mo}/${y}`;
                };
                const paymentSummary = getInvoicePaymentSummary(inv);
                const orderKey = getOrderIdentityKey(inv);
                const isSelected = selectedOrders.includes(orderKey);
                const sourceBadge = getOrderSourceBadge(inv);
                const creatorName = inv.user_name || inv.invoice_writer || inv.created_by_user_name || '';
                const rowBg = isCancelled
                  ? 'opacity-70 bg-red-50/60'
                  : inv.status === 'pending'
                    ? 'bg-orange-50/70'
                    : inv._isOffline
                      ? 'bg-blue-50/70'
                      : 'bg-white';

                return (
                  <div key={getOrderRowKey(inv, rowIndex)} className={`rounded-2xl border border-gray-200 p-3 shadow-sm ${rowBg}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <button
                          onClick={() => toggleSelectOrder(orderKey)}
                          className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:text-blue-600"
                          title={isSelected ? 'Bỏ chọn' : 'Chọn'}
                        >
                          {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                        <div className="min-w-0">
                          <div className="font-semibold text-blue-700">{displayOrderCode(inv.invoice_code)}</div>
                          <div className="mt-1 truncate text-sm font-medium text-gray-800">{inv.customer_name || 'Khách lẻ'}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                            <span className={`rounded-full px-2 py-0.5 font-medium ${sourceBadge.color}`}>{sourceBadge.text}</span>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${st.color}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`}></span>
                              {st.text}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 font-medium ${paymentSummary.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : paymentSummary.status === 'partial' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>{paymentSummary.label}</span>
                          </div>
                          {isCancelled && cancelRemainingText && (
                            <div className="mt-1 inline-flex rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
                              {cancelRemainingText}
                            </div>
                          )}
                          {creatorName && <div className="mt-1 text-xs text-gray-400">Người tạo: {creatorName}</div>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-bold text-gray-900">{formatVND(paymentSummary.total)}</div>
                        <div className="mt-1 text-xs text-gray-400">{formatDate(inv.created_at)}</div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500">
                      <div className="rounded-xl bg-white/70 p-2">
                        <div className="text-gray-400">Tạm tính</div>
                        <div className="font-semibold text-gray-700">{formatVND(inv.subtotal)}</div>
                      </div>
                      <div className="rounded-xl bg-white/70 p-2">
                        <div className="text-gray-400">Ngày giao</div>
                        <div className="font-semibold text-gray-700">{formatDelivery(inv.delivery_date)}</div>
                      </div>
                      <div className="rounded-xl bg-white/70 p-2">
                        <div className="text-gray-400">Người nhận</div>
                        <div className="truncate font-semibold text-gray-700">{inv.receiver_name || 'Chưa có'}</div>
                      </div>
                      <div className="rounded-xl p-2">
                        <div className="text-gray-400">Thanh toán</div>
                        <div className="font-semibold text-gray-700">{formatPaymentMethod(inv.payment_method)}</div>
                      </div>
                      <div className="col-span-2 grid grid-cols-3 gap-2 rounded-xl border border-slate-100 bg-slate-50 p-2">
                        <div>
                          <div className="text-gray-400">Tổng hóa đơn</div>
                          <div className="mt-0.5 font-semibold text-gray-700">{formatVND(paymentSummary.total)}</div>
                        </div>
                        <div>
                          <div className="text-gray-400">Đã thanh toán</div>
                          <div className="mt-0.5 font-semibold text-emerald-700">{formatVND(paymentSummary.paid)}</div>
                        </div>
                        <div>
                          <div className="text-gray-400">Còn nợ</div>
                          <div className={`mt-0.5 font-semibold ${paymentSummary.remaining > 0 ? 'text-amber-700' : 'text-gray-500'}`}>{formatVND(paymentSummary.remaining)}</div>
                        </div>
                      </div>
                      <div className="rounded-xl bg-white/70 p-2">
                        <div className="text-gray-400">Nguồn tạo</div>
                        <div className="font-semibold text-gray-700">{sourceBadge.text}</div>
                      </div>
                    </div>

                    {inv.note && (
                      <div className="mt-2 rounded-xl bg-gray-100 px-3 py-2 text-xs text-gray-600">
                        {inv.note}
                      </div>
                    )}

                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <button onClick={() => openView(inv)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-gray-600 hover:border-blue-200 hover:text-blue-700" title="Xem chi tiết">
                        <Eye size={14} /> Xem
                      </button>
                      <button onClick={() => openInvoicePrint(inv)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-100" title="Preview/In A5">
                        <Printer size={14} /> In A5
                      </button>
                      <button onClick={() => openInvoicePrint(inv, { quick: true })} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-2 text-xs font-medium text-purple-700 hover:bg-purple-100" title="In nhanh A5">
                        <FileDown size={14} /> In nhanh
                      </button>
                      <button onClick={() => openEdit(inv)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100" title="Sửa">
                        <Edit2 size={14} /> Sửa
                      </button>
                      {!isCancelled && (inv._isOffline || inv.status === 'pending' || inv.status === 'processing') && (
                        <button onClick={() => handleMarkAsPaid(inv)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-2.5 py-2 text-xs font-medium text-green-700 hover:bg-green-100" title="Xác nhận thanh toán">
                          <CheckSquare size={14} /> Thanh toán
                        </button>
                      )}
                      {!isCancelled && (
                        <button onClick={() => handleCancel(inv)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-600 hover:bg-red-100" title="Hủy đơn">
                          <Trash2 size={14} /> Hủy
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="system-table-scroll hidden border-t border-gray-100 lg:block">
          <table className="system-table order-list-table text-sm">
            <colgroup>
              <col style={{ width: '4%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '12%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className="text-center">
                  <button
                    onClick={toggleSelectAll}
                    className="w-5 h-5 inline-flex items-center justify-center text-gray-600 hover:text-blue-600"
                    title={selectedAll ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                  >
                    {selectedAll ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                </th>
                <th className="text-left">Đơn hàng</th>
                <th className="text-left">Nguồn</th>
                <th className="text-left">Khách hàng</th>
                <th className="text-right">Giá trị đơn</th>
                <th className="text-left">Thanh toán</th>
                <th className="text-left">Trạng thái</th>
                <th className="text-left">Ngày tạo</th>
                <th className="text-left">Ngày giao</th>
                <th className="text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv, rowIndex) => {
                const st = getOrderStatusMeta(inv.status);
                const isCancelled = isCancelledOrderStatus(inv.status);
                const cancelRemainingText = formatCancelAutoDeleteRemaining(inv, nowMs);
                const formatDelivery = (d) => {
                  if (!d) return '—';
                  const [y, mo, day] = d.split('-');
                  return `${day}/${mo}/${y}`;
                };
                const paymentSummary = getInvoicePaymentSummary(inv);
                const orderKey = getOrderIdentityKey(inv);
                const isSelected = selectedOrders.includes(orderKey);
                const paymentLabel = paymentSummary.status === 'paid'
                  ? <span className="order-payment-badge bg-emerald-50 text-emerald-700">Đã thanh toán</span>
                  : paymentSummary.status === 'partial'
                    ? <span className="order-payment-badge bg-amber-50 text-amber-700">Thanh toán một phần</span>
                    : <span className="order-payment-badge bg-gray-100 text-gray-500">Chưa thanh toán</span>;
                const sourceBadge = getOrderSourceBadge(inv);
                const creatorName = inv.user_name || inv.invoice_writer || inv.created_by_user_name || '';
                const rowBg = isCancelled
                  ? 'opacity-70 bg-red-50/60'
                  : inv.status === 'pending'
                    ? 'bg-orange-50/60'
                    : inv._isOffline
                      ? 'bg-blue-50/60'
                      : 'bg-white';

                return (
                  <tr key={getOrderRowKey(inv, rowIndex)} className={rowBg}>
                    <td className="text-center">
                      <button
                        onClick={() => toggleSelectOrder(orderKey)}
                        className="w-5 h-5 inline-flex items-center justify-center text-gray-600 hover:text-blue-600"
                        title={isSelected ? 'Bỏ chọn' : 'Chọn'}
                      >
                        {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    </td>
                    <td>
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 h-10 w-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-xs">
                          DH
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-blue-700">{displayOrderCode(inv.invoice_code)}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                            {inv.note && (
                              <span className="rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 max-w-[220px] truncate">{inv.note}</span>
                            )}
                            {isCancelled && cancelRemainingText && (
                              <span className="rounded-full bg-red-50 text-red-600 px-2 py-0.5 font-semibold max-w-[260px] truncate">
                                {cancelRemainingText}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${sourceBadge.color}`}>{sourceBadge.text}</span>
                    </td>
                    <td>
                      <div className="font-medium text-gray-800 table-text-clip">{inv.customer_name || 'Khách lẻ'}</div>
                      <div className="mt-1 text-xs text-gray-400">{inv.receiver_name || 'Chưa có người nhận'}</div>
                    </td>
                    <td className="text-right">
                      <div className="font-bold text-gray-900">{formatVND(paymentSummary.total)}</div>
                      <div className="mt-1 text-xs text-gray-400">Tạm tính: {formatVND(inv.subtotal)}</div>
                    </td>
                    <td>
                      <div className="space-y-1">
                        {paymentLabel}
                        <div className="text-xs text-gray-400">{formatPaymentMethod(inv.payment_method)}</div>
                        <div className="text-xs leading-5">
                          <div className="text-emerald-700">Đã thu: {formatVND(paymentSummary.paid)}</div>
                          <div className={paymentSummary.remaining > 0 ? 'text-amber-700' : 'text-gray-400'}>Còn nợ: {formatVND(paymentSummary.remaining)}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className={`order-status-badge ${st.color}`}>
                        <span className={`h-2 w-2 rounded-full ${st.dot}`}></span>
                        <span>{st.text}</span>
                      </div>
                    </td>
                    <td>
                      <div className="text-sm text-gray-700">{formatDate(inv.created_at)}</div>
                      <div className="mt-1 text-xs text-gray-400">{creatorName || '—'}</div>
                    </td>
                    <td>
                      {inv.delivery_date ? (
                        <span className="inline-flex rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-700">
                          {formatDelivery(inv.delivery_date)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">Chưa chốt</span>
                      )}
                    </td>
                    <td>
                      <div className="order-table-actions">
                        <button onClick={() => openView(inv)} className="order-table-action-btn border border-gray-200 text-gray-600 hover:border-blue-200 hover:text-blue-700" title="Xem chi tiết">
                          <Eye size={14} /> Xem
                        </button>
                        <button onClick={() => openEdit(inv)} className="order-table-action-btn border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" title="Sửa">
                          <Edit2 size={14} /> Sửa
                        </button>
                        <button onClick={() => openInvoicePrint(inv)} className="order-table-action-btn border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100" title="Preview/In hóa đơn A5">
                          <Printer size={14} /> In A5
                        </button>
                        <button onClick={() => openInvoicePrint(inv, { quick: true })} className="order-table-action-btn border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100" title="In nhanh hóa đơn A5">
                          <FileDown size={14} /> In nhanh
                        </button>
                        {!isCancelled && (inv._isOffline || inv.status === 'pending' || inv.status === 'processing') && (
                          <button onClick={() => handleMarkAsPaid(inv)} className="order-table-action-btn border border-green-200 bg-green-50 text-green-700 hover:bg-green-100" title="Xác nhận thanh toán">
                            <CheckSquare size={14} /> Thanh toán
                          </button>
                        )}
                        {!isCancelled && (
                          <button onClick={() => handleCancel(inv)} className="order-table-action-btn border border-red-200 bg-red-50 text-red-600 hover:bg-red-100" title="Hủy đơn">
                            <Trash2 size={14} /> Hủy
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {loading ? (
            <div className="text-center text-gray-400 py-16 flex flex-col items-center justify-center gap-3">
              <Loader size={32} className="animate-spin text-blue-400" />
              <div>
                <div className="font-medium text-gray-600">Đang tải danh sách đơn hàng...</div>
                {!serverOnline && <div className="text-xs text-red-400 mt-1">⚠️ Server đang offline</div>}
              </div>
            </div>
          ) : !serverOnline && filtered.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-5xl mb-3 opacity-30">📡</div>
              <div className="font-semibold text-gray-500 mb-1">Server đang offline</div>
              <div className="text-sm text-gray-400 mb-4">Danh sách đang hiển thị từ dữ liệu cục bộ nếu có.</div>
              <button onClick={() => {
                setLoading(true);
                fetchInvoices().finally(() => setLoading(false));
              }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
                🔄 Thử lại
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-gray-400 py-16">
              <div className="text-5xl mb-3 opacity-20">📦</div>
              <div className="font-medium text-gray-500">Không có đơn phù hợp</div>
              <div className="text-sm mt-1">Thử đổi trạng thái lọc hoặc từ khóa tìm kiếm</div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ===== MODAL XEM CHI TIẾT ===== */}
      {showView && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto p-3 sm:items-center sm:p-4">
          <div className="bg-white rounded-xl p-4 sm:p-6 w-full max-w-3xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Chi tiết đơn hàng <span className="font-mono text-blue-600">{displayOrderCode(showView.invoice_code)}</span></h2>
              <button onClick={() => setShowView(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>

            {/* Thông tin chung */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-sm">
              <div><span className="text-gray-500">Khách hàng:</span> <b>{showView.customer_name || 'Khách lẻ'}</b></div>
              <div><span className="text-gray-500">Ngày tạo:</span> <b>{formatDate(showView.created_at)}</b></div>
              <div><span className="text-gray-500">Thanh toán:</span> <b>{formatPaymentMethod(showView.payment_method)}</b></div>
              <div><span className="text-gray-500">Trạng thái:</span> <b>{getOrderStatusMeta(showView.status)?.text}</b></div>
              {isCancelledOrderStatus(showView.status) && (
                <div><span className="text-gray-500">Tự động xóa:</span> <b className="text-red-600">{formatCancelAutoDeleteRemaining(showView, nowMs)}</b></div>
              )}
              <div><span className="text-gray-500">Nguồn tạo:</span> <b>{getOrderSourceBadge(showView).text}</b></div>
              <div><span className="text-gray-500">Người tạo:</span> <b>{showView.user_name || showView.invoice_writer || '—'}</b></div>
              {showView.note && <div className="sm:col-span-2"><span className="text-gray-500">Ghi chú:</span> {showView.note}</div>}
            </div>

            {/* Bảng sản phẩm */}
            <div className="w-full max-w-full overflow-x-auto mb-4">
              <table className="w-full min-w-[560px] text-sm border">
              <thead>
                <tr className="bg-gray-100 text-gray-600 text-xs">
                  <th className="border p-2 text-center w-8">STT</th>
                  <th className="border p-2 text-left">Sản phẩm</th>
                  <th className="border p-2 text-center">SL</th>
                  <th className="border p-2 text-right">Đơn giá</th>
                  <th className="border p-2 text-right">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {(invoiceDetails || []).map((d, idx) => (
                  <tr key={`${d.id || d.product_id || d.product_sku || 'detail'}-${idx}`} className="border-b">
                    <td className="border p-2 text-center">{idx + 1}</td>
                    <td className="border p-2">{getProductDisplayName(d)}</td>
                    <td className="border p-2 text-center">{d.quantity}</td>
                    <td className="border p-2 text-right">{formatVND(d.unit_price)}</td>
                    <td className="border p-2 text-right font-medium">{formatVND(d.line_total)}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>

            {/* Tổng kết */}
            <div className="border-t pt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span>Tạm tính:</span><span>{formatVND(showView.subtotal)}</span></div>
              {showView.vat_percent > 0 && <div className="flex justify-between"><span>VAT ({showView.vat_percent}%):</span><span>{formatVND(showView.vat_amount)}</span></div>}
              {showView.discount_percent > 0 && <div className="flex justify-between text-red-500"><span>Chiết khấu ({showView.discount_percent}%):</span><span>-{formatVND(showView.discount_amount)}</span></div>}
              <div className="mt-3 grid grid-cols-1 gap-2 border-t pt-3 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Tổng hóa đơn</div>
                  <div className="mt-1 font-bold text-slate-800">{formatVND(getInvoicePaymentSummary(showView).total)}</div>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3">
                  <div className="text-xs text-emerald-700">Đã thu</div>
                  <div className="mt-1 font-bold text-emerald-800">{formatVND(getInvoicePaymentSummary(showView).paid)}</div>
                </div>
                <div className="rounded-lg bg-amber-50 p-3">
                  <div className="text-xs text-amber-700">Còn nợ</div>
                  <div className="mt-1 font-bold text-amber-800">{formatVND(getInvoicePaymentSummary(showView).remaining)}</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 mt-4 sm:flex-row">
              {!showView._isOffline && (
                <button onClick={() => openInvoicePrint(showView)} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold inline-flex items-center justify-center gap-2">
                  <Printer size={16} /> Mở hóa đơn A5
                </button>
              )}
              <button onClick={() => setShowView(null)} className="flex-1 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL SỬA ĐƠN ===== */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto p-3 sm:items-center sm:p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50 rounded-t-xl">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Sửa đơn hàng</h2>
                <p className="text-xs text-gray-500 font-mono">{displayOrderCode(showEdit.invoice_code)}</p>
              </div>
              <button onClick={() => { setShowEdit(null); setEditBaselineDetails([]); }} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="flex-1 overflow-auto p-5 space-y-4">
              {/* Thông tin chung */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <div>
                <div className="relative">
                  <label className="text-xs text-gray-500 block mb-1">Khách hàng</label>
                  <input
                    className="input-field w-full text-sm"
                    value={editCustomerSearch}
                    placeholder="Tạm khách hàng theo tồn, SDT, m?..."
                    onFocus={() => setEditCustomerSearch(editForm.customer_name || "")}
                    onChange={e => {
                      const value = e.target.value;
                      setEditCustomerSearch(value);
                      if (!value.trim()) applyEditCustomer("");
                    }}
                  />
                  {editCustomerSearch.trim() && filteredEditCustomers.length > 0 && (
                    <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-60 overflow-auto rounded-xl border border-gray-200 bg-white shadow-xl">
                      {filteredEditCustomers.map(customer => (
                        <button
                          key={customer.id}
                          type="button"
                          className="w-full border-b border-gray-100 px-3 py-2 text-left text-sm hover:bg-blue-50 last:border-b-0"
                          onClick={() => {
                            setEditCustomerSearch(customer.name + (customer.phone ? " (" + customer.phone + ")" : ""));
                            applyEditCustomer(customer.id);
                          }}
                        >
                          <div className="font-semibold text-gray-800">{customer.name}</div>
                          <div className="text-xs text-gray-500">{customer.phone || ""}{customer.customer_type ? " ? " + customer.customer_type : ""}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                  <label className="text-xs text-gray-500 block mb-1">Thanh toán</label>
                  <select className="input-field w-full text-sm" value={editForm.payment_method}
                    onChange={e => setEditForm({ ...editForm, payment_method: e.target.value })}>
                    <option value="cash">💵 Tiền mặt</option>
                    <option value="bank">🏦 Chuyển khoản</option>
                    <option value="debt">📝 Công nợ</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Ghi chú</label>
                  <input className="input-field w-full text-sm" value={editForm.note || ''}
                    onChange={e => setEditForm({ ...editForm, note: e.target.value })} placeholder="Ghi chú..." />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Trạng thái</label>
                  <select className="input-field w-full text-sm" value={editForm.status || 'pending'}
                    onChange={e => setEditForm({ ...editForm, status: e.target.value })}>
                    <option value="pending">⏳ Chờ xác nhận</option>
                    <option value="processing">🔄 Đang xử lý</option>
                    <option value="completed">✅ Hoàn thành</option>
                    <option value="cancelled">❌ Đã hủy</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Ngày tạo đơn</label>
                  <input type="datetime-local" className="input-field w-full text-sm"
                    value={editForm.created_at || ''}
                    onChange={e => setEditForm({ ...editForm, created_at: e.target.value || null })} />
                </div>
              </div>

              {/* Bảng sản phẩm có thể sửa */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-gray-100 px-4 py-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">Chi tiết sản phẩm</span>
                  <div className="flex items-center gap-2">
                    <OrderColumnCustomizer
                      visibleColumns={editVisibleColumns}
                      onChange={(next) => { setEditVisibleColumns(normalizeOrderColumnSettings(next)); saveOrderColumnSettings(next); }}
                    />
                    <button
                      onClick={() => setShowProductPicker(true)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium flex items-center gap-1">
                      <Plus size={13} /> Thêm sản phẩm
                    </button>
                    <button
                      type="button"
                      onClick={addCustomServiceDetail}
                      className="px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded text-xs font-medium flex items-center gap-1">
                      <Plus size={13} /> Thêm dịch vụ khác
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-xs border-b">
                        {editVisibleColumns.stt && <th className="py-2 px-3 text-center w-8">STT</th>}
                        {editVisibleColumns.productName && <th className="py-2 px-3 text-left">Tên sản phẩm</th>}
                        {editVisibleColumns.quantity && <th className="py-2 px-3 text-center w-20">SL</th>}
                        {editVisibleColumns.unitPrice && <th className="py-2 px-3 text-right w-28">Giá (VND)</th>}
                        {editVisibleColumns.discount && <th className="py-2 px-3 text-center w-16">CK%</th>}
                        {editVisibleColumns.lineTotal && <th className="py-2 px-3 text-right w-28">Tổng (VND)</th>}
                        <th className="py-2 px-3 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editDetails.map((d, idx) => {
                        const stockState = getSaleStockStateForLine(editStockValidation, d);
                        const rowStockInvalid = Boolean(stockState?.invalid);
                        const rowNearLimit = Boolean(stockState?.nearLimit);
                        return (
                        <tr key={`${d.id || d.product_id || d.product_sku || 'edit-detail'}-${idx}`} className={`border-b last:border-b-0 hover:bg-gray-50 text-xs ${rowStockInvalid ? 'bg-red-50 ring-1 ring-red-200' : rowNearLimit ? 'bg-orange-50' : ''}`}>
                          {editVisibleColumns.stt && <td className="py-2 px-3 text-center text-gray-400">{idx + 1}</td>}
{editVisibleColumns.productName && <td className="py-2 px-3">
  {d.is_service || d.isService || d.type === 'service' || d.type === 'custom_service' || d.item_type === 'service' || d.item_type === 'custom_service' ? (
    <>
      <input
        value={d.product_name || d.name || ''}
        onChange={e => updateDetail(idx, 'product_name', e.target.value)}
        placeholder="Tên dịch vụ"
        className="w-full border rounded px-2 py-1 text-sm font-medium" />
      <div className="text-[10px] text-violet-600 mt-1">Dịch vụ khác · không trừ tồn kho</div>
    </>
  ) : (
    <>
      <div className="font-medium text-gray-800">{getProductDisplayName(d)}</div>
      <div className="text-[10px] text-gray-400">{d.product_sku}</div>
    </>
  )}
  {stockState && (
    <div className={`text-[10px] font-semibold mt-0.5 ${rowStockInvalid ? 'text-red-600' : rowNearLimit ? 'text-orange-700' : 'text-gray-500'}`}>
      Dự kiến {formatStockValue(stockState.projectedStock)}{rowStockInvalid ? ` · ${NEGATIVE_STOCK_LIMIT_MESSAGE}` : rowNearLimit ? ` · ${negativeStockNearLimitLabel || `gần ngưỡng ${negativeStockLimitLabel}`}` : ''}
    </div>
  )}
</td>}
{editVisibleColumns.quantity && <td className="py-2 px-3 text-center">
  <input type="number" min="1"
    value={d.quantity}
    onChange={e => updateDetail(idx, 'quantity', +e.target.value)}
    className={`w-16 text-center border rounded px-1 py-1 text-sm ${rowStockInvalid ? 'bg-red-100 text-red-700 border-red-300' : rowNearLimit ? 'bg-orange-50 text-orange-700 border-orange-300' : ''}`} />
</td>}
{editVisibleColumns.unitPrice && <td className="py-2 px-3 text-right">
  <input type="number" min="0"
    value={d.unit_price}
    onChange={e => updateDetail(idx, 'unit_price', +e.target.value)}
    className="w-24 text-right border rounded px-2 py-1 text-sm" />
</td>}
{editVisibleColumns.discount && <td className="py-2 px-3 text-center">
  <input type="number" min="0" max="100"
    value={d.discount_percent}
    onChange={e => updateDetail(idx, 'discount_percent', +e.target.value)}
    className="w-14 text-center border rounded px-1 py-1 text-sm" />
</td>}
{editVisibleColumns.lineTotal && <td className="py-2 px-3 text-right font-semibold text-blue-700">
  {formatVND(d.line_total)}
</td>}
<td className="py-2 px-3 text-center">
  <button onClick={() => removeDetail(idx)} className="text-red-400 hover:text-red-600 p-1">
    <Trash2 size={13} />
  </button>
</td>
                        </tr>
                        );
                      })}
                      {editDetails.length === 0 && (
                        <tr>
                          <td colSpan={[editVisibleColumns.stt, editVisibleColumns.productName, editVisibleColumns.quantity, editVisibleColumns.unitPrice, editVisibleColumns.discount, editVisibleColumns.lineTotal].filter(Boolean).length + 1} className="text-center text-gray-400 py-8">
                            Chưa có sản phẩm nào
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Tổng hợp tiền */}
              <div className="border rounded-lg p-4 bg-gray-50">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4 text-sm">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">VAT (%)</label>
                    <input type="number" min="0" max="100"
                      value={editForm.vat_percent}
                      onChange={e => {
                        const vp = Math.min(100, Math.max(0, +e.target.value));
                        const sub = editDetails.reduce((s, d) => s + (d.line_total || 0), 0);
                        const vat = sub * vp / 100;
                        const disc = editForm.discount_percent ? sub * editForm.discount_percent / 100 : (editForm.discount_amount || 0);
                        const total = sub + vat - disc + (+editForm.delivery_fee || 0);
                        const paid = +editForm.paid_amount || 0;
                        setEditForm(f => ({ ...f, vat_percent: vp, vat_amount: vat, total, remaining_amount: Math.max(0, total - paid), change_amount: Math.max(0, paid - total) }));
                      }}
                      className="input-field w-full text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Chiết khấu (VND)</label>
                    <input type="number" min="0"
                      value={editForm.discount_amount}
                      onChange={e => {
                        const disc = Math.max(0, +e.target.value);
                        const sub = editDetails.reduce((s, d) => s + (d.line_total || 0), 0);
                        const vat = sub * (editForm.vat_percent / 100);
                        const total = sub + vat - disc + (+editForm.delivery_fee || 0);
                        const paid = +editForm.paid_amount || 0;
                        setEditForm(f => ({ ...f, discount_amount: disc, total, remaining_amount: Math.max(0, total - paid), change_amount: Math.max(0, paid - total) }));
                      }}
                      className="input-field w-full text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Tạm tính</label>
                    <div className="font-semibold text-gray-800 pt-1.5">
                      {formatVND(editDetails.reduce((s, d) => s + (d.line_total || 0), 0))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Khách phải trả</label>
                    <div className="font-bold text-red-600 text-lg pt-1.5">
                      {formatVND(editForm.total)}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Đã thu</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatMoneyInput(editForm.paid_amount)}
                      onChange={e => {
                        const paid = parseMoneyInput(e.target.value);
                        const total = Math.max(0, Number(editForm.total) || 0);
                        setEditForm(f => ({
                          ...f,
                          paid_amount: paid,
                          remaining_amount: Math.max(0, total - paid),
                          change_amount: Math.max(0, paid - total),
                        }));
                      }}
                      className="input-field w-full text-right text-sm font-bold text-emerald-700"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Còn nợ</label>
                    <div className={`font-bold text-lg pt-1.5 ${Number(editForm.remaining_amount) > 0 ? 'text-amber-700' : 'text-gray-500'}`}>
                      {formatVND(editForm.remaining_amount)}
                    </div>
                  </div>
                </div>
                {editProductsState === 'loaded' && hasEditStockError && (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                    {editStockValidation.summaryMessage || NEGATIVE_STOCK_LIMIT_MESSAGE}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t bg-gray-50 rounded-b-xl flex flex-col gap-2 sm:flex-row">
              <button onClick={() => { setShowEdit(null); setEditBaselineDetails([]); }} className="flex-1 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">
                Hủy
              </button>
              {showEdit && !editProductsReady && (
                <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  {editProductsStateLabel || 'đang tđi dữ liệu sản phẩm...'}
                </div>
              )}
              <button onClick={handleSaveEdit}
                disabled={editDetails.length === 0 || saveLoading || (editProductsState === 'loaded' && hasEditStockError)}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-bold">
                {saveLoading ? '⏳ Đang lưu...' : '💾 Lưu thay đổi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL CHỌN SẢN PHẨM THÊM VÀO ĐƠN ===== */}
      {showProductPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-[60] overflow-y-auto p-3 sm:items-center sm:p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50 rounded-t-xl">
              <h3 className="font-bold text-gray-800">Thêm sản phẩm vào đơn</h3>
              <button onClick={() => { setShowProductPicker(false); setEditProductSearch(''); }} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="p-4">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input-field pl-9 w-full text-sm"
                  placeholder="Tạm theo tồn, mã SKU..."
                  value={editProductSearch}
                  onChange={e => setEditProductSearch(e.target.value)} autoFocus />
              </div>
            </div>
            <div className="flex-1 overflow-auto px-4 pb-4">
              <div className="space-y-1">
                {(() => {
                  const customer = editForm.customer_id ? customers.find(c => Number(c.id) === Number(editForm.customer_id)) : null;
                  const activePriceType = customer ? customerTypeToPriceType(customer.customer_type) : 'retail';
                  const getDisplayPrice = (prod) => getPriceValueByType(prod, activePriceType);

                  const filteredParents = editProducts.filter(p =>
                    scoreProductMatch(p, editProductSearch).matched ||
                    (p.variants || []).some(v => scoreProductMatch(v, editProductSearch, p).matched)
                  );

                  return filteredParents.map(parent => {
                    const hasVariants = (parent.variants || []).length > 0;
                    const isExpanded = expandedParents[parent.id] || false;

                    return (
                      <div key={parent.id}>
                        {/* Parent Product Row */}
                        <div
                          className={`border rounded-lg p-3 cursor-pointer hover:border-blue-500 hover:shadow-sm ${getStockDisplayMeta(parent.stock, negativeStockSettings).cardClass}`}
                          onClick={() => {
                            if (hasVariants) {
                              setExpandedParents(prev => ({ ...prev, [parent.id]: !prev[parent.id] }));
                            } else {
                              addDetailFromPicker(parent);
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {hasVariants && (
                                <span className="text-gray-400 shrink-0">
                                  {isExpanded ? '▼' : '▶'}
                                </span>
                              )}
                              <div className="text-xs font-medium truncate flex-1">{parent.name}</div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <div className="text-[10px] text-gray-400">{parent.sku || '—'}</div>
                              <div className={`text-[10px] ${getStockDisplayMeta(parent.stock, negativeStockSettings).textClass}`}>{getStockDisplayMeta(parent.stock, negativeStockSettings).display}</div>
                              {getStockDisplayMeta(parent.stock, negativeStockSettings).isNegative && <div className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${getStockDisplayMeta(parent.stock, negativeStockSettings).badgeClass}`}>âm kho</div>}
                              {getStockDisplayMeta(parent.stock, negativeStockSettings).isNearLimit && <div className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-orange-100 text-orange-800 border border-orange-200">{getStockDisplayMeta(parent.stock, negativeStockSettings).extraLabel || negativeStockNearLimitLabel || `Gần ${negativeStockLimitLabel}`}</div>}
                              <div className="text-xs font-bold text-blue-600 whitespace-nowrap">{formatVND(getDisplayPrice(parent))}</div>
                            </div>
                          </div>
                        </div>

                        {/* Variants - shown when expanded */}
                        {hasVariants && isExpanded && (
                          <div className="ml-4 border-l-2 border-blue-200 mt-1 pl-2 space-y-1">
                            {parent.variants.map(variant => (
                              <div
                                key={variant.id}
                                className={`border rounded-lg p-2 cursor-pointer hover:border-blue-500 hover:shadow-sm ${getStockDisplayMeta(variant.stock, negativeStockSettings).cardClass}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addDetailFromPicker({ ...variant, is_variant: true, parent_id: parent.id, parent_name: parent.name, parent });
                                }}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <span className="text-gray-300 shrink-0">⊙</span>
                                    <div className="text-xs font-medium truncate text-blue-600 flex-1">{getProductDisplayName(variant, parent)}</div>
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0">
                                    <div className="text-[10px] text-gray-400">{variant.sku || '—'}</div>
                                    <div className={`text-[10px] ${getStockDisplayMeta(variant.stock, negativeStockSettings).textClass}`}>{getStockDisplayMeta(variant.stock, negativeStockSettings).display}</div>
                                    {getStockDisplayMeta(variant.stock, negativeStockSettings).isNegative && <div className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${getStockDisplayMeta(variant.stock, negativeStockSettings).badgeClass}`}>âm kho</div>}
                                    {getStockDisplayMeta(variant.stock, negativeStockSettings).isNearLimit && <div className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-orange-100 text-orange-800 border border-orange-200">{getStockDisplayMeta(variant.stock, negativeStockSettings).extraLabel || negativeStockNearLimitLabel || `Gần ${negativeStockLimitLabel}`}</div>}
                                    <div className="text-xs font-bold text-blue-600 whitespace-nowrap">{formatVND(getDisplayPrice(variant))}</div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
                {(() => {
                  const filteredParents = editProducts.filter(p =>
                    scoreProductMatch(p, editProductSearch).matched ||
                    (p.variants || []).some(v => scoreProductMatch(v, editProductSearch, p).matched)
                  );
                  return filteredParents.length === 0 && (
                    <div className="text-center text-gray-400 py-8">Không tìm thấy sản phẩm</div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 overflow-y-auto p-3 sm:items-center sm:p-4">
          <div className="bg-white rounded-xl p-4 sm:p-6 w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <HelpCircle size={20} className="text-blue-600" />
                Hướng dẫn Danh sách đơn hàng
              </h2>
              <button onClick={() => setShowHelp(false)} className="text-gray-400 hover:text-gray-600">
                <svg size={20} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">📋 Trạng thái đơn hàng</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs">⏳ Chờ xác nhận</span> - Đơn mới tạo, chờ duyệt</li>
                  <li><span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">🔄 Đang xử lý</span> - Đang chuẩn bị hàng</li>
                  <li><span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">✅ Hoàn thành</span> - Đã thanh toán và giao hàng</li>
                  <li><span className="px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs">❌ Đã hủy</span> - Đơn bị hủy</li>
                  <li><span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs">📡 Offline</span> - Đơn tạo khi server offline</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🔍 Lọc & Tìm kiếm</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Tìm kiếm theo mã don (DH XXXXX) ho?c tđơn khách hàng</li>
                  <li>Lọc theo trạng thái từ dropdown</li>
                  <li>Kết hợp cả hai để tìm nhanh</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">✏️ Chỉnh sửa đơn</h3>
                <p>Nhấn icon "Sửa" để mở modal chỉnh sửa:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Thay đổi thông tin khách hàng, thanh toán, ghi chú</li>
                  <li>Thêm/xóa sản phẩm trong đơn</li>
                  <li>Điều chỉnh số lượng, giá, chiết khấu</li>
                  <li>Thay đổi trạng thái đơn hàng</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">✅ Xác nhận thanh toán</h3>
                <p>Nhấn icon <CheckSquare size={14} className="inline" /> để đánh dấu đơn đã thanh toán. Trạng thái sẽ chuyển sang "Hoàn thành" và hiển thị phương thức thanh toán.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🗑️ Xóa đơn hàng</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Xóa đơn:</strong> Nhấn icon 🗑️ để hủy đơn hàng</li>
                  <li>Hàng trong đơn sẽ được hoàn về kho</li>
                  <li><strong>Xóa hàng loạt:</strong> Chọn nhiều đơn → nhấn "Xóa (số lượng)"</li>
                </ul>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-800 mb-2">💡 Lưu ý</h3>
                <ul className="list-disc pl-5 space-y-1 text-blue-700">
                  <li>Đơn offline được lưu trong localStorage, cần sync khi có mạng</li>
                  <li>Chỉ admin mới có quyền xóa đơn hàng</li>
                  <li>Số lượng đơn hiển thị bao gồm cả offline</li>
                </ul>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button onClick={() => setShowHelp(false)} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
