import { useState, useEffect } from 'react';
import { resolveApiUrl } from '../utils/apiClient';
import { Package, Edit2, Trash2, Eye, X, Loader, Plus, Search, CheckSquare, Square, Printer, HelpCircle, RefreshCw, Receipt, Clock3, Wallet } from 'lucide-react';
import { getDefaultPrintTemplate } from '../utils/printTemplateService';
import { createInvoicePrintData } from '../utils/invoicePrintData';
import InvoicePrintPreviewModal from '../components/InvoicePrintPreviewModal';
import { getProductDisplayName } from '../utils/productSearch';
import ExcelImportPanel from '../components/ExcelImportPanel';
import { SYNC_UPDATED_EVENT, requestSyncCheck } from '../utils/apiClient';

const API = resolveApiUrl('');

const STATUS_LABELS = {
  pending: { text: 'Chờ xác nhận', color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500', icon: '⏳' },
  processing: { text: 'Đang xử lý', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500', icon: '🔄' },
  completed: { text: 'Hoàn thành', color: 'bg-green-100 text-green-700', dot: 'bg-green-500', icon: '✅' },
  cancelled: { text: 'Đã hủy', color: 'bg-red-100 text-red-600', dot: 'bg-red-500', icon: '❌' },
};
const PAYMENT_LABELS = { cash: 'Tiền mặt', bank: 'Chuyển khoản', debt: 'Công nợ' };
const SOURCE_BADGES = {
  app: { text: 'app', color: 'bg-gray-100 text-gray-600' },
  direct: { text: 'app', color: 'bg-gray-100 text-gray-600' },
};
function formatPaymentMethod(method) {
  return PAYMENT_LABELS[method] || method || 'Tiền mặt';
}

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n || 0);
}

// Chuyển mã đơn hàng thành định dạng "DH 00001"
function displayOrderCode(code) {
  if (!code) return '—';
  // Bỏ prefix "HD" hoặc "LOCAL_" rồi pad 5 chữ số
  const numStr = code.replace(/^(HD|LOCAL_)/i, '').replace(/[^0-9]/g, '');
  const num = parseInt(numStr || '0', 10);
  return `DH ${String(num).padStart(5, '0')}`;
}
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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

// Hợp nhất các sản phẩm trùng ID (để tránh duplicate khi edit)
function mergeDuplicateProducts(details) {
  const map = new Map();
  for (const d of details) {
    const key = d.product_id || d.id;
    if (map.has(key)) {
      const existing = map.get(key);
      existing.quantity += d.quantity;
      existing.line_total += d.line_total;
      existing.discount_amount += d.discount_amount || 0;
      // Nếu có discount_percent, lấy weighted average? Đơn giản: giữ nguyên của dòng đầu
    } else {
      map.set(key, { ...d });
    }
  }
  return Array.from(map.values());
}

const BANK_MAP = {
  'Vietcombank': 'VCB', 'VietinBank': 'CTG', 'TPBank': 'TPB',
  'MBBank': 'MB', 'ACB': 'ACB', 'VPBank': 'VPB', 'Sacombank': 'SACBOM',
  'Agribank': 'VBA', 'BIDV': 'BIDV', 'Techcombank': 'TCB', 'Default': 'ICB',
};
function buildVietQRUrl(store, amount, invoiceCode) {
  const bankCode = BANK_MAP[store.bank_name?.trim()] || BANK_MAP['Default'];
  const account = (store.bank_account || '').replace(/\s/g, '');
  const addInfo = encodeURIComponent(`Thanh toan don hang ${invoiceCode}`);
  const accountName = encodeURIComponent(store.name || '');
  return `https://img.vietqr.io/image/${bankCode}-${account}-compact2.png?amount=${amount}&addInfo=${addInfo}&accountName=${accountName}`;
}

function getOrderDedupeKey(order = {}) {
  return order.client_order_id || order.payload?.client_order_id || order.invoice_code || order.id;
}

function sameOrderIdentity(a = {}, b = {}) {
  const aClientId = a.client_order_id || a.payload?.client_order_id;
  const bClientId = b.client_order_id || b.payload?.client_order_id;
  if (aClientId && bClientId && aClientId === bClientId) return true;
  return Boolean(a.invoice_code && b.invoice_code && a.invoice_code === b.invoice_code);
}

function dedupeOrdersByInvoiceCode(orders) {
  const map = new Map();
  for (const order of orders) {
    const key = getOrderDedupeKey(order);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || (existing._isOffline && !order._isOffline)) {
      map.set(key, order);
    }
  }
  return Array.from(map.values());
}

function createEmptyPrintPreviewState() {
  return {
    open: false,
    title: '',
    subtitle: '',
    data: null,
    template: null,
    loading: false,
    error: '',
  };
}

export default function OrderList({ store = {} }) {
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
  const [printPreview, setPrintPreview] = useState(() => createEmptyPrintPreviewState());
  const [editDetails, setEditDetails] = useState([]);
  const [editProducts, setEditProducts] = useState([]);
  const [editProductSearch, setEditProductSearch] = useState('');
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  const [selectedOrders, setSelectedOrders] = useState([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [expandedParents, setExpandedParents] = useState({});
  const [showHelp, setShowHelp] = useState(false);
  const [showExcelImport, setShowExcelImport] = useState(false);

  const notifyOrderChanged = (detail = {}) => {
    window.dispatchEvent(new CustomEvent('kha-order-created', {
      detail: { _syncOnly: true, ...detail },
    }));
    requestSyncCheck({
      reason: detail.reason || 'order-mutated',
      tables: ['invoices', 'invoice_details', 'products', 'customers'],
    });
  };

  const closePrintPreview = () => {
    setPrintPreview(createEmptyPrintPreviewState());
  };

  // Load products for picker
  useEffect(() => {
    if (showProductPicker) {
      fetch(`${API}/products/all/with-variants`).then(r => r.json()).then(setEditProducts).catch(() => { });
    }
  }, [showProductPicker]);

  // Kiểm tra server + load dữ liệu
  useEffect(() => {
    const checkAndLoad = async () => {
      setLoading(true);
      const offline = (() => {
        try { return JSON.parse(localStorage.getItem('kha_pending_orders') || '[]'); }
        catch { return []; }
      })();

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const r = await fetch(`${API}/store`, { signal: controller.signal });
        clearTimeout(timer);
        if (r.ok) {
          setServerOnline(true);
          const [invData, custData] = await Promise.all([
            fetch(`${API}/invoices`).then(x => x.json()),
            fetch(`${API}/customers`).then(x => x.json()),
          ]);
          setInvoices(invData);
          setCustomers(custData);
          const merged = dedupeOrdersByInvoiceCode([
            ...offline.map(o => ({ ...o, _isOffline: true })),
            ...invData.map(i => ({ ...i, _isOffline: false })),
          ]);
          setAllOrders(merged);
        }
      } catch {
        setServerOnline(false);
        setAllOrders(offline.map(o => ({ ...o, _isOffline: true })));
      } finally {
        setLoading(false);
      }
    };
    checkAndLoad();

    // ── Lắng nghe sự kiện tạo/cập nhật/hủy/thanh toán đơn trong thiết bị hiện tại ──
    const onOrderCreated = (e) => {
      const inv = e.detail;
      if (!inv || inv._syncOnly || !(inv.invoice_code || inv.client_order_id || inv.id)) {
        fetchInvoices();
        return;
      }
      setAllOrders(prev => dedupeOrdersByInvoiceCode([
        { ...inv, _isOffline: !inv.invoice_code?.startsWith('HD') },
        ...prev.filter(o => !sameOrderIdentity(o, inv)),
      ]));
      setInvoices(prev => {
        if (prev.find(i => sameOrderIdentity(i, inv))) return prev;
        return [{ ...inv, _isOffline: false }, ...prev];
      });
    };
    const onSyncUpdated = (event) => {
      const changedTables = event.detail?.changedTables || [];
      const syncData = event.detail?.data || {};
      if (changedTables.includes('invoices') || changedTables.includes('invoice_details')) {
        fetchInvoices();
      }
      if (Array.isArray(syncData.customers) && changedTables.includes('customers')) setCustomers(syncData.customers);
    };

    window.addEventListener('kha-order-created', onOrderCreated);
    window.addEventListener(SYNC_UPDATED_EVENT, onSyncUpdated);

    return () => {
      window.removeEventListener('kha-order-created', onOrderCreated);
      window.removeEventListener(SYNC_UPDATED_EVENT, onSyncUpdated);
    };
  }, []);

  const fetchInvoices = () => {
    const offline = (() => {
      try { return JSON.parse(localStorage.getItem('kha_pending_orders') || '[]'); }
      catch { return []; }
    })();

    return fetch(`${API}/invoices`)
      .then(r => r.json())
      .then(data => {
        setInvoices(data);
        setAllOrders(dedupeOrdersByInvoiceCode([
          ...offline.map(o => ({ ...o, _isOffline: true })),
          ...data.map(i => ({ ...i, _isOffline: false })),
        ]));
        setServerOnline(true);
      })
      .catch(() => {
        setServerOnline(false);
        setAllOrders(offline.map(o => ({ ...o, _isOffline: true })));
      });
  };

  // Lọc danh sách
  const displayOrders = allOrders.length > 0 ? allOrders : invoices;
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = displayOrders.filter(inv => {
    const matchSearch =
      (inv.invoice_code || '').toLowerCase().includes(normalizedSearch) ||
      (inv.client_order_id || inv.payload?.client_order_id || '').toLowerCase().includes(normalizedSearch) ||
      displayOrderCode(inv.invoice_code).toLowerCase().includes(normalizedSearch) ||
      (inv.customer_name || '').toLowerCase().includes(normalizedSearch);
    const sourceKey = getOrderSourceKey(inv);
    const matchStatus = filterStatus === 'all' ||
      inv.status === filterStatus ||
      (filterStatus === 'offline' && inv._isOffline);
    const matchSource = filterSource === 'all' ||
      sourceKey === filterSource ||
      (filterSource === 'sync' && sourceKey === 'sync');
    return matchSearch && matchStatus && matchSource;
  });

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
    { key: 'cancelled', label: 'Đã hủy', count: displayOrders.filter(inv => inv.status === 'cancelled').length },
    { key: 'offline', label: 'Offline', count: displayOrders.filter(inv => inv._isOffline).length },
  ];

  const sourceOptions = [
    { key: 'all', label: 'Tất cả nguồn', count: displayOrders.length },
    { key: 'offline', label: 'Offline local', count: displayOrders.filter(inv => getOrderSourceKey(inv) === 'offline').length },
    { key: 'web', label: 'Web', count: displayOrders.filter(inv => getOrderSourceKey(inv) === 'web').length },
    { key: 'sync', label: 'Sync', count: displayOrders.filter(inv => getOrderSourceKey(inv) === 'sync').length },
  ];


  const selectedAll = filtered.length > 0 && filtered.every(inv => selectedOrders.includes(inv.id || inv.invoice_code));

  // ── CHECKBOX HANDERS ──
  const toggleSelectOrder = (orderId) => {
    if (!orderId) return;
    setSelectedOrders(prev =>
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    );
  };

  const toggleSelectAll = () => {
    const allIdentifiers = filtered.map(inv => inv.id || inv.invoice_code).filter(id => id != null);
    if (selectedOrders.length === allIdentifiers.length) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(allIdentifiers);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedOrders.length === 0) return;
    if (!confirm(`Hủy ${selectedOrders.length} đơn hàng đã chọn?\n\nHàng sẽ được hoàn về kho.`)) return;

    setIsBulkDeleting(true);
    try {
      // Get selected order objects
      const selectedOrdersData = filtered.filter(inv => selectedOrders.includes(inv.id || inv.invoice_code));
      const onlineOrders = selectedOrdersData.filter(inv => inv.id && !inv._isOffline);
      const offlineOrders = selectedOrdersData.filter(inv => inv._isOffline);

      // Cancel online orders (backend marks as cancelled, doesn't hard delete)
      const promises = onlineOrders.map(inv =>
        fetch(`${API}/invoices/${inv.id}`, { method: 'DELETE' })
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
      alert(`✅ Đã hủy ${totalAffected} đơn hàng!`);
      setSelectedOrders([]);
      // Refresh data - cancelled orders will disappear from list
      notifyOrderChanged({ reason: 'orders-cancelled' });
      fetch(`${API}/products/all/with-variants`).catch(() => { });
    } catch (err) {
      alert(`📡 Lỗi khi hủy: ${err.message}`);
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // Mở xem chi tiết
  const openView = async (inv) => {
    if (inv._isOffline) {
      setInvoiceDetails(inv.cart || []);
      setShowView(inv);
      return;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${API}/invoices/${inv.id}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) { alert('Không tải được chi tiết đơn!'); return; }
      const data = await res.json();
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
      setEditDetails(mergeDuplicateProducts(cartDetails));
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${API}/invoices/${inv.id}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) { alert('Không tải được đơn hàng!'); return; }
      const data = await res.json();
      setEditDetails(mergeDuplicateProducts(data.details || []));
      setEditForm({
        customer_id: data.customer_id || inv.customer_id || null,
        customer_name: data.customer_name || inv.customer_name || '',
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
        newItem.line_total = newItem.quantity * newItem.unit_price - (newItem.discount_amount || 0);
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

  // Thêm sản phẩm vào chi tiết sửa
  const addDetailFromPicker = (p) => {
    const isVariant = Boolean(p.is_variant || p.parent_id || p.parent_name || p.parent?.name);
    const displayName = getProductDisplayName(p);
    const newDetail = {
      id: Date.now(),
      product_id: p.id,
      variant_id: isVariant ? p.id : null,
      parent_id: isVariant ? (p.parent_id || p.parent?.id || null) : null,
      parent_name: isVariant ? (p.parent_name || p.parent?.name || '') : '',
      variant_name: isVariant ? p.name : '',
      product_name: displayName,
      product_sku: p.sku || '',
      name: displayName,
      sku: p.sku || '',
      quantity: 1,
      unit_price: p.retail_price || 0,
      discount_amount: 0,
      discount_percent: 0,
      line_total: p.retail_price || 0,
      _new: true,
    };
    setEditDetails(prev => {
      const updated = [...prev, newDetail];
      const sub = updated.reduce((s, d) => s + (d.line_total || 0), 0);
      const vat = sub * (editForm.vat_percent / 100);
      const disc = editForm.discount_percent ? sub * editForm.discount_percent / 100 : (editForm.discount_amount || 0);
      const total = sub + vat - disc + (+editForm.delivery_fee || 0);
      const paid = +editForm.paid_amount || 0;
      setEditForm(f => ({ ...f, subtotal: sub, total, remaining_amount: Math.max(0, total - paid), change_amount: Math.max(0, paid - total) }));
      return updated;
    });
    setShowProductPicker(false);
    setEditProductSearch('');
  };

  // Lưu sửa
  const handleSaveEdit = async () => {
    if (editDetails.length === 0) { alert('Chưa có sản phẩm nào!'); return; }
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
        alert('✅ Đơn offline đã được cập nhật!');
      } catch {
        alert('⚠️ Lỗi khi lưu đơn offline!');
      } finally {
        setSaveLoading(false);
      }
      return;
    }

    // ── ONLINE: PUT lên server ──
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${API}/invoices/${showEdit.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: editForm.customer_id || null,
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
          details: editDetails.map(({ product_id, variant_id, parent_id, parent_name, variant_name, product_name, product_sku, name, sku, quantity, unit_price, discount_amount, discount_percent, line_total }) =>
            ({ product_id, variant_id: variant_id || null, parent_id: parent_id || null, parent_name: parent_name || '', variant_name: variant_name || '', product_name: product_name || name || '', product_sku: product_sku || sku || '', name: name || product_name || '', sku: sku || product_sku || '', quantity, unit_price, discount_amount, discount_percent, line_total })),
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      if (data.ok) {
        setShowEdit(null);
        notifyOrderChanged({ reason: 'order-updated', invoice_id: showEdit.id });
        fetch(`${API}/products/all/with-variants`).catch(() => { });
      } else {
        alert(`⚠️ Lỗi khi lưu!\n\nCode: HTTP ${res.status}\nLý do: ${data.error || 'Không rõ'}`);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        alert('⏱️ Yêu cầu bị timeout! Server phản hồi quá chậm.');
      } else {
        alert('📡 Không thể kết nối server!');
      }
    } finally {
      setSaveLoading(false);
    }
  };

  // Hủy đơn
  const handleCancel = async (inv) => {
    if (!confirm(`Hủy đơn hàng ${inv.invoice_code}?\n\nHàng sẽ được hoàn về kho.`)) return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      // Determine order identifier
      const orderId = inv.id || inv.invoice_code;
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
        const res = await fetch(`${API}/invoices/${inv.id}`, {
          method: 'DELETE',
          signal: controller.signal,
        });
        clearTimeout(timer);
        const data = await res.json();
        if (data.ok) {
          success = true;
        } else {
          alert(data.error || 'Không thể hủy đơn!');
          return;
        }
      }

      if (success) {
        // Remove from selected if present
        setSelectedOrders(prev => prev.filter(id => id !== orderId));
        notifyOrderChanged({ reason: 'order-cancelled', invoice_id: inv.id || null, invoice_code: inv.invoice_code || '' });
        // Refresh product stock
        fetch(`${API}/products/all/with-variants`).catch(() => { });
        alert('✅ Đã hủy đơn hàng!');
      }
    } catch {
      alert('📡 Không thể kết nối server!');
    }
  };

  // Xác nhận thanh toán (chuyển trạng thái sang completed)
  const handleMarkAsPaid = async (inv) => {
    if (!confirm(`Xác nhận đơn hàng ${inv.invoice_code} đã thanh toán?`)) return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

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
        alert('✅ Đã cập nhật trạng thái đơn offline thành "Đã thanh toán"!');
      } else {
        // Gọi API xác nhận đơn hàng (PATCH /invoices/:id/confirm)
        const res = await fetch(`${API}/invoices/${inv.id}/confirm`, {
          method: 'PATCH',
          signal: controller.signal,
        });
        clearTimeout(timer);
        const data = await res.json();
        if (data.ok) {
          alert('✅ Đã xác nhận thanh toán!');
          notifyOrderChanged({ reason: 'order-paid', invoice_id: inv.id || null, invoice_code: inv.invoice_code || '' });
          fetch(`${API}/products/all/with-variants`).catch(() => { });
        } else {
          alert('Lỗi: ' + (data.error || 'Không thể xác nhận'));
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        alert('⏱️ Timeout!');
      } else {
        alert('📡 Lỗi kết nối!');
      }
    }
  };

  const ensureInvoiceForPrint = async (invoice) => {
    if (!invoice) throw new Error('Không có dữ liệu hóa đơn để in.');
    if (invoice._isOffline) return { ...invoice, details: invoice.cart || invoice.details || [] };
    if ((invoice.details && invoice.details.length > 0) || (invoice.cart && invoice.cart.length > 0)) return invoice;
    if (!invoice.id) return invoice;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${API}/invoices/${invoice.id}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Không tải được chi tiết hóa đơn.');
      const data = await res.json();
      return { ...invoice, ...data, details: data.details || invoice.details || [] };
    } finally {
      clearTimeout(timer);
    }
  };

  const handlePrint = async (invoice) => {
    if (!invoice) {
      alert('Không có dữ liệu hóa đơn để in.');
      return;
    }

    const inv = invoice._isOffline ? { ...invoice, details: invoice.cart || invoice.details || [] } : invoice;
    const items = inv.cart || inv.details || [];
    if (!Array.isArray(items) || items.length === 0) {
      alert('Hóa đơn chưa có chi tiết sản phẩm để in.');
      return;
    }

    const customer = inv.customer
      || inv.selectedCustomer
      || customers.find(c => String(c.id) === String(inv.customer_id))
      || { name: inv.customer_name, phone: inv.customer_phone, address: inv.customer_address };
    const user = { id: inv.user_id || null, name: inv.user_name || inv.invoice_writer || '' };
    const previewTitle = `Hóa đơn bán hàng ${inv.invoice_code || ''}`.trim();

    setPrintPreview({
      ...createEmptyPrintPreviewState(),
      open: true,
      title: previewTitle,
      subtitle: 'Kiểm tra đầy đủ thông tin đơn hàng, sản phẩm và tổng tiền trước khi bấm In.',
      loading: true,
    });

    try {
      const template = await getDefaultPrintTemplate({
        apiBase: inv._isOffline ? '' : resolveApiUrl(''),
        type: 'sale_invoice',
        paperSize: 'A4',
        fallbackPaperSize: 'A4',
      });
      const printData = createInvoicePrintData({
        store,
        invoice: inv,
        customer,
        user,
        items,
        type: 'sale_invoice',
      });
      setPrintPreview({
        open: true,
        subtitle: 'Xem trước hóa đơn, kiểm tra thông tin và điều chỉnh thiết lập in trước khi gửi lệnh in hệ thống.',
        title: previewTitle,
        data: printData,
        template,
        loading: false,
        error: '',
      });
    } catch (err) {
      setPrintPreview(prev => ({
        ...prev,
        loading: false,
        error: err.message || 'Không thể dựng bản xem trước phiếu in. Vui lòng thử lại.',
      }));
    }
  };
  return (
    <div className="min-w-0 space-y-4">
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
                Theo dõi đơn online, đơn offline, trạng thái xử lý và thao tác nhanh trên cùng một màn hình.
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
          description="Preview/validate đơn hàng và chi tiết sản phẩm trước khi commit; khách hàng và sản phẩm phải tồn tại, một đơn nhiều dòng được gom theo mã đơn."
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
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input-field w-full pl-9"
                placeholder="Tìm theo mã đơn, DH XXXXX, tên khách hàng..."
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
                <span className="rounded-full bg-amber-50 text-amber-700 px-3 py-1 font-medium">Đã chọn {selectedOrders.length} đơn</span>
              )}
              {!serverOnline && (
                <span className="rounded-full bg-red-50 text-red-600 px-3 py-1 font-medium">Đang ở chế độ offline</span>
              )}
            </div>
            <div className="text-xs text-gray-400">
              Ưu tiên dữ liệu server khi trùng mã đơn, vẫn giữ đơn local để thao tác tiếp.
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
                  <span>{selectedAll ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</span>
                </button>
                <span className="text-xs text-gray-400">{filtered.length} đơn</span>
              </div>
              {filtered.map(inv => {
                const st = STATUS_LABELS[inv.status] || STATUS_LABELS.pending;
                const formatDelivery = (d) => {
                  if (!d) return 'Chưa chốt';
                  const [y, mo, day] = d.split('-');
                  return `${day}/${mo}/${y}`;
                };
                const isUnpaid = inv._isOffline || inv.status === 'pending';
                const orderKey = inv.id || inv.invoice_code;
                const isSelected = selectedOrders.includes(orderKey);
                const sourceBadge = getOrderSourceBadge(inv);
                const creatorName = inv.user_name || inv.invoice_writer || inv.created_by_user_name || '';
                const rowBg = inv.status === 'cancelled'
                  ? 'opacity-70 bg-gray-50'
                  : inv.status === 'pending'
                    ? 'bg-orange-50/70'
                    : inv._isOffline
                      ? 'bg-blue-50/70'
                      : 'bg-white';

                return (
                  <div key={orderKey} className={`rounded-2xl border border-gray-200 p-3 shadow-sm ${rowBg}`}>
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
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500">{isUnpaid ? 'Chưa thanh toán' : formatPaymentMethod(inv.payment_method)}</span>
                          </div>
                          {creatorName && <div className="mt-1 text-xs text-gray-400">Người tạo: {creatorName}</div>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-bold text-gray-900">{formatVND(inv.total)}</div>
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
                      <div className="rounded-xl bg-white/70 p-2">
                        <div className="text-gray-400">Thanh toán</div>
                        <div className="font-semibold text-gray-700">{formatPaymentMethod(inv.payment_method)}</div>
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

                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <button onClick={() => openView(inv)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-gray-600 hover:border-blue-200 hover:text-blue-700" title="Xem chi tiết">
                        <Eye size={14} /> Xem
                      </button>
                      <button onClick={() => openEdit(inv)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100" title="Sửa">
                        <Edit2 size={14} /> Sửa
                      </button>
                      {(inv._isOffline || inv.status === 'pending' || inv.status === 'processing') && (
                        <button onClick={() => handleMarkAsPaid(inv)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-2.5 py-2 text-xs font-medium text-green-700 hover:bg-green-100" title="Xác nhận thanh toán">
                          <CheckSquare size={14} /> Thanh toán
                        </button>
                      )}
                      <button onClick={() => handleCancel(inv)} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-600 hover:bg-red-100" title="Hủy đơn">
                        <Trash2 size={14} /> Hủy
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="hidden w-full max-w-full overflow-x-auto border-t border-gray-100 lg:block">
          <table className="w-full min-w-[1320px] text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 text-center w-12">
                  <button
                    onClick={toggleSelectAll}
                    className="w-5 h-5 inline-flex items-center justify-center text-gray-600 hover:text-blue-600"
                    title={selectedAll ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                  >
                    {selectedAll ? <CheckSquare size={16} /> : <Square size={16} />}
                  </button>
                </th>
                <th className="px-4 py-3 text-left">Đơn hàng</th>
                <th className="px-4 py-3 text-left">Nguồn</th>
                <th className="px-4 py-3 text-left">Khách hàng</th>
                <th className="px-4 py-3 text-right">Giá trị đơn</th>
                <th className="px-4 py-3 text-left">Thanh toán</th>
                <th className="px-4 py-3 text-left">Trạng thái</th>
                <th className="px-4 py-3 text-left">Ngày tạo</th>
                <th className="px-4 py-3 text-left">Ngày giao</th>
                <th className="px-4 py-3 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const st = STATUS_LABELS[inv.status] || STATUS_LABELS.pending;
                const formatDelivery = (d) => {
                  if (!d) return '—';
                  const [y, mo, day] = d.split('-');
                  return `${day}/${mo}/${y}`;
                };
                const isUnpaid = inv._isOffline || inv.status === 'pending';
                const orderKey = inv.id || inv.invoice_code;
                const isSelected = selectedOrders.includes(orderKey);
                const paymentLabel = isUnpaid
                  ? <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">Chưa thanh toán</span>
                  : <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">{formatPaymentMethod(inv.payment_method)}</span>;
                const sourceBadge = getOrderSourceBadge(inv);
                const creatorName = inv.user_name || inv.invoice_writer || inv.created_by_user_name || '';
                const rowBg = inv.status === 'cancelled'
                  ? 'opacity-60 bg-gray-50'
                  : inv.status === 'pending'
                    ? 'bg-orange-50/60'
                    : inv._isOffline
                      ? 'bg-blue-50/60'
                      : 'bg-white';

                return (
                  <tr key={orderKey} className={`border-t border-gray-100 align-top transition hover:bg-slate-50 ${rowBg}`}>
                    <td className="px-4 py-4 text-center">
                      <button
                        onClick={() => toggleSelectOrder(orderKey)}
                        className="w-5 h-5 inline-flex items-center justify-center text-gray-600 hover:text-blue-600"
                        title={isSelected ? 'Bỏ chọn' : 'Chọn'}
                      >
                        {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 h-10 w-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-xs">
                          DH
                        </div>
                        <div>
                          <div className="font-semibold text-blue-700">{displayOrderCode(inv.invoice_code)}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                            {inv.note && (
                              <span className="rounded-full bg-gray-100 text-gray-600 px-2 py-0.5 max-w-[220px] truncate">{inv.note}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${sourceBadge.color}`}>{sourceBadge.text}</span>
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-xs text-gray-300">—</span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-gray-800">{inv.customer_name || 'Khách lẻ'}</div>
                      <div className="mt-1 text-xs text-gray-400">{inv.receiver_name || 'Chưa có người nhận'}</div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-bold text-gray-900">{formatVND(inv.total)}</div>
                      <div className="mt-1 text-xs text-gray-400">Tạm tính: {formatVND(inv.subtotal)}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        {paymentLabel}
                        <div className="text-xs text-gray-400">{formatPaymentMethod(inv.payment_method)}</div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${st.color}`}>
                        <span className={`h-2 w-2 rounded-full ${st.dot}`}></span>
                        <span>{st.text}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-sm text-gray-700">{formatDate(inv.created_at)}</div>
                      <div className="mt-1 text-xs text-gray-400">{creatorName || '—'}</div>
                    </td>
                    <td className="px-4 py-4">
                      {inv.delivery_date ? (
                        <span className="inline-flex rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-700">
                          {formatDelivery(inv.delivery_date)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">Chưa chốt</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button onClick={() => openView(inv)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-blue-200 hover:text-blue-700" title="Xem chi tiết">
                          <Eye size={14} /> Xem
                        </button>
                        <button onClick={() => openEdit(inv)} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100" title="Sửa">
                          <Edit2 size={14} /> Sửa
                        </button>
                        {(inv._isOffline || inv.status === 'pending' || inv.status === 'processing') && (
                          <button onClick={() => handleMarkAsPaid(inv)} className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100" title="Xác nhận thanh toán">
                            <CheckSquare size={14} /> Thanh toán
                          </button>
                        )}
                        <button onClick={() => handleCancel(inv)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100" title="Hủy đơn">
                          <Trash2 size={14} /> Hủy
                        </button>
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
              <div><span className="text-gray-500">Trạng thái:</span> <b>{STATUS_LABELS[showView.status]?.text}</b></div>
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
                  <tr key={d.id} className="border-b">
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
              <div className="flex justify-between font-bold text-base border-t pt-1"><span>Khách phải trả:</span><span className="text-blue-700">{formatVND(showView.total)}</span></div>
            </div>

            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowView(null)} className="flex-1 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">
                Đóng
              </button>
              <button onClick={() => handlePrint(showView)} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2">
                <Printer size={16} /> In hóa đơn
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
              <button onClick={() => setShowEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="flex-1 overflow-auto p-5 space-y-4">
              {/* Thông tin chung */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Khách hàng</label>
                  <select className="input-field w-full text-sm" value={editForm.customer_id || ''}
                    onChange={e => {
                      const c = customers.find(x => x.id === +e.target.value);
                      setEditForm({ ...editForm, customer_id: +e.target.value || null, customer_name: c?.name || '' });
                    }}>
                    <option value="">-- Khách lẻ --</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>)}
                  </select>
                </div>
                <div>
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
                  <button
                    onClick={() => setShowProductPicker(true)}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium flex items-center gap-1">
                    <Plus size={13} /> Thêm sản phẩm
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-xs border-b">
                        <th className="py-2 px-3 text-center w-8">STT</th>
                        <th className="py-2 px-3 text-left">Tên sản phẩm</th>
                        <th className="py-2 px-3 text-center w-20">SL</th>
                        <th className="py-2 px-3 text-right w-28">Giá (VND)</th>
                        <th className="py-2 px-3 text-center w-16">CK%</th>
                        <th className="py-2 px-3 text-right w-28">Tổng (VND)</th>
                        <th className="py-2 px-3 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editDetails.map((d, idx) => (
                        <tr key={d.id} className="border-b last:border-b-0 hover:bg-gray-50 text-xs">
                          <td className="py-2 px-3 text-center text-gray-400">{idx + 1}</td>
                          <td className="py-2 px-3">
                            <div className="font-medium text-gray-800">{getProductDisplayName(d)}</div>
                            <div className="text-[10px] text-gray-400">{d.product_sku}</div>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input type="number" min="1"
                              value={d.quantity}
                              onChange={e => updateDetail(idx, 'quantity', +e.target.value)}
                              className="w-16 text-center border rounded px-1 py-1 text-sm" />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input type="number" min="0"
                              value={d.unit_price}
                              onChange={e => updateDetail(idx, 'unit_price', +e.target.value)}
                              className="w-24 text-right border rounded px-2 py-1 text-sm" />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input type="number" min="0" max="100"
                              value={d.discount_percent}
                              onChange={e => updateDetail(idx, 'discount_percent', +e.target.value)}
                              className="w-14 text-center border rounded px-1 py-1 text-sm" />
                          </td>
                          <td className="py-2 px-3 text-right font-semibold text-blue-700">
                            {formatVND(d.line_total)}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button onClick={() => removeDetail(idx)} className="text-red-400 hover:text-red-600 p-1">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {editDetails.length === 0 && (
                        <tr>
                          <td colSpan={7} className="text-center text-gray-400 py-8">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 text-sm">
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
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t bg-gray-50 rounded-b-xl flex flex-col gap-2 sm:flex-row">
              <button onClick={() => setShowEdit(null)} className="flex-1 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">
                Hủy
              </button>
              <button onClick={() => handlePrint({
                ...showEdit,
                cart: editDetails,
                subtotal: editForm.subtotal,
                total: editForm.total,
                vat_percent: editForm.vat_percent,
                vat_amount: editForm.vat_amount,
                discount_percent: editForm.discount_percent,
                discount_amount: editForm.discount_amount,
                delivery_fee: editForm.delivery_fee,
                paid_amount: editForm.paid_amount,
                change_amount: editForm.change_amount,
                remaining_amount: editForm.remaining_amount,
                payment_method: editForm.payment_method,
                customer_name: editForm.customer_name,
                note: editForm.note,
                created_at: editForm.created_at || showEdit.created_at,
                invoice_code: showEdit.invoice_code,
              })} className="flex-1 py-2.5 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2">
                <Printer size={16} /> In
              </button>
              <button onClick={handleSaveEdit}
                disabled={editDetails.length === 0 || saveLoading}
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
                  placeholder="Tìm theo tên, mã SKU..."
                  value={editProductSearch}
                  onChange={e => setEditProductSearch(e.target.value)} autoFocus />
              </div>
            </div>
            <div className="flex-1 overflow-auto px-4 pb-4">
              <div className="space-y-1">
                {(() => {
                  const searchLower = editProductSearch.toLowerCase();
                  const filteredParents = editProducts.filter(p =>
                    !editProductSearch ||
                    p.name.toLowerCase().includes(searchLower) ||
                    (p.sku || '').toLowerCase().includes(searchLower) ||
                    (p.variants || []).some(v =>
                      String(getProductDisplayName(v, p)).toLowerCase().includes(searchLower) ||
                      (v.sku || '').toLowerCase().includes(searchLower)
                    )
                  );

                  return filteredParents.map(parent => {
                    const hasVariants = (parent.variants || []).length > 0;
                    const isExpanded = expandedParents[parent.id] || false;

                    return (
                      <div key={parent.id}>
                        {/* Parent Product Row */}
                        <div
                          className={`border rounded-lg p-3 cursor-pointer hover:border-blue-500 hover:shadow-sm ${parent.stock <= 0 ? 'opacity-50 bg-gray-50' : 'bg-white'}`}
                          onClick={() => {
                            if (hasVariants) {
                              setExpandedParents(prev => ({ ...prev, [parent.id]: !prev[parent.id] }));
                            } else if (parent.stock > 0) {
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
                              {parent.stock <= 0 ? (
                                <div className="text-[10px] text-red-500 font-bold">Hết hàng</div>
                              ) : (
                                <div className={`text-[10px] ${parent.stock <= 3 ? 'text-red-500 font-bold' : 'text-gray-500'}`}>Còn: {parent.stock}</div>
                              )}
                              <div className="text-xs font-bold text-blue-600 whitespace-nowrap">{formatVND(parent.retail_price)}</div>
                            </div>
                          </div>
                        </div>

                        {/* Variants - shown when expanded */}
                        {hasVariants && isExpanded && (
                          <div className="ml-4 border-l-2 border-blue-200 mt-1 pl-2 space-y-1">
                            {parent.variants.map(variant => (
                              <div
                                key={variant.id}
                                className={`border rounded-lg p-2 cursor-pointer hover:border-blue-500 hover:shadow-sm ${variant.stock <= 0 ? 'opacity-50 bg-gray-50' : 'bg-white'}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (variant.stock > 0) addDetailFromPicker({ ...variant, is_variant: true, parent_id: parent.id, parent_name: parent.name, parent });
                                }}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <span className="text-gray-300 shrink-0">⊙</span>
                                    <div className="text-xs font-medium truncate text-blue-600 flex-1">{getProductDisplayName(variant, parent)}</div>
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0">
                                    <div className="text-[10px] text-gray-400">{variant.sku || '—'}</div>
                                    {variant.stock <= 0 ? (
                                      <div className="text-[10px] text-red-500 font-bold">Hết hàng</div>
                                    ) : (
                                      <div className={`text-[10px] ${variant.stock <= 3 ? 'text-red-500 font-bold' : 'text-gray-500'}`}>Còn: {variant.stock}</div>
                                    )}
                                    <div className="text-xs font-bold text-blue-600 whitespace-nowrap">{formatVND(variant.retail_price)}</div>
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
                  const searchLower = editProductSearch.toLowerCase();
                  const filteredParents = editProducts.filter(p =>
                    !editProductSearch ||
                    p.name.toLowerCase().includes(searchLower) ||
                    (p.sku || '').toLowerCase().includes(searchLower) ||
                    (p.variants || []).some(v =>
                      String(getProductDisplayName(v, p)).toLowerCase().includes(searchLower) ||
                      (v.sku || '').toLowerCase().includes(searchLower)
                    )
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

      <InvoicePrintPreviewModal
        open={printPreview.open}
        data={printPreview.data}
        template={printPreview.template}
        title={printPreview.title}
        subtitle={printPreview.subtitle}
        loading={printPreview.loading}
        error={printPreview.error}
        onBack={closePrintPreview}
        onClose={closePrintPreview}
      />

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
                  <li>Tìm kiếm theo mã đơn (DH XXXXX) hoặc tên khách hàng</li>
                  <li>Lọc theo trạng thái từ dropdown</li>
                  <li>Kết hợp cả hai để tìm nhanh</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📤 Xuất & In</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Xem chi tiết:</strong> Nhấn icon mắt để xem thông tin đơn hàng</li>
                  <li><strong>In hóa đơn:</strong> Nhấn nút "In" trong modal xem chi tiết</li>
                  <li>Hóa đơn in định dạng A4, chuyên nghiệp</li>
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
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
