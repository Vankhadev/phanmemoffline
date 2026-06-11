import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, SYNC_UPDATED_EVENT, apiJsonChecked, getApiErrorMessage, resolveApiUrl, resolveBackendAssetUrl } from '../utils/apiClient';
import {
  Search, Plus, Trash2, ChevronDown, ChevronRight, Filter, UserPlus, Users, FileText, ReceiptText, X, Image as ImageIcon, Minus, Package
} from 'lucide-react';
import { buildCategoriesById, filterProductTree, normalizeSearchText, getProductDisplayName, getProductVariants, getVariantIdentity } from '../utils/productSearch';
import { attachClientOrderMetadata, generateClientOrderId } from '../utils/clientOrderId';
import { broadcastSyncUpdate } from '../utils/crossTabSync';
import {
  buildSaleStockValidation,
  formatStockValue,
  getNegativeStockLimitLabel,
  getNegativeStockLimitMessage,
  getNegativeStockNearLimitLabel,
  getSaleStockStateForLine,
  getStockDisplayMeta,
} from '../utils/negativeStock';
import useNegativeStockSettings from '../utils/useNegativeStockSettings';
import QuantityStepper from '../components/QuantityStepper';

const PRICE_LABELS = { retail: 'Lẻ', wholesale: 'Sỉ', vip: 'VIP' };
const COMBO_REFRESH_STALE_MS = 30 * 1000;
const PRICE_TYPE_KEYS = new Set(['retail', 'wholesale', 'vip']);

// Map customer_type → priceType key
const customerTypeToPriceType = (ct) => {
  const t = normalizeSearchText(ct || '');
  if (t.includes(' si') || t.endsWith('si') || t.includes('wholesale') || t.includes('buon')) return 'wholesale';
  if (t.includes('vip')) return 'vip';
  return 'retail';
};

function normalizePriceType(value) {
  const key = String(value || '').trim().toLowerCase();
  return PRICE_TYPE_KEYS.has(key) ? key : 'retail';
}

function readPriceField(source, key) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return null;
  const raw = source[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const number = Number(raw);
  return Number.isFinite(number) ? Math.max(0, number) : null;
}

function getPriceValueByType(source, currentPriceType = 'retail') {
  const activeType = normalizePriceType(currentPriceType);
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
function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n || 0);
}

function formatPickerStockNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return (Math.round((number + Number.EPSILON) * 10) / 10).toLocaleString('vi-VN');
}

const QUANTITY_STEP = 0.1;
const MIN_QUANTITY = 0.1;

function getOrderPickerKey(item, kind = 'product') {
  if (kind === 'combo') return `combo:${item?.id}`;
  return `product:${item?.id}`;
}

function isValidQuantityInput(value) {
  const text = String(value ?? '').trim();
  if (!text || !/^\d+(?:[.,]\d*)?$/.test(text)) return false;
  return parseDecimalQuantity(text, 0) > 0;
}

function parseDecimalQuantity(value, fallback = MIN_QUANTITY) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDecimalQuantity(value, fallback = MIN_QUANTITY) {
  const quantity = parseDecimalQuantity(value, fallback);
  if (!Number.isFinite(quantity)) return fallback;
  return Math.max(MIN_QUANTITY, Math.round((quantity + Number.EPSILON) * 10) / 10);
}

function clampDecimalQuantity(value, max = Infinity, fallback = 1) {
  const quantity = normalizeDecimalQuantity(value, fallback);
  const upper = Number.isFinite(Number(max)) ? Number(max) : Infinity;
  return Math.min(upper, quantity);
}

function getComboPriceValue(combo, currentPriceType = 'retail') {
  return getPriceValueByType(combo, currentPriceType);
}

function getComboLineItems(combo) {
  const candidateLists = [
    combo?.items,
    combo?.combo_items,
    combo?.details,
    combo?.metadata?.items,
    combo?.metadata?.combo_items,
  ];
  return candidateLists.find(list => Array.isArray(list)) || [];
}

function getComboChildQuantity(item) {
  const qty = Number(item?.quantity ?? item?.qty ?? item?.quantity_in_combo ?? item?.combo_quantity);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function getComboChildName(item) {
  const productName = item?.product_name || item?.parent_name || item?.product?.name || item?.name || 'Sản phẩm';
  const variantName = item?.variant_name || item?.variant?.name;
  if (variantName && !String(productName).includes(String(variantName))) {
    return `${productName} / ${variantName}`;
  }
  return productName;
}

function getComboItemSummary(combo) {
  const items = getComboLineItems(combo);
  if (items.length === 0) return 'Chưa có thành phần';
  return items.slice(0, 3).map(item => `${getComboChildQuantity(item)}× ${getComboChildName(item)}`).join(', ') + (items.length > 3 ? ` +${items.length - 3} SP` : '');
}

function isComboOrderItem(item) {
  const type = String(item?.type || item?.item_type || '').trim().toLowerCase();
  return Boolean(type === 'combo' || item?.combo_id);
}

function isServiceOrderItem(item) {
  const type = String(item?.type || item?.item_type || '').trim().toLowerCase();
  return Boolean(type === 'service' || type === 'custom_service' || item?.is_service || item?.isService);
}

function getServiceLineName(item = {}) {
  return String(item.product_name || item.name || item.service_name || '').trim();
}

function comboMatchesSearch(combo, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const haystack = normalizeSearchText([
    combo?.name,
    combo?.sku,
  ].filter(Boolean).join(' '));
  const compactQuery = normalizedQuery.replace(/\s+/g, '');
  const compactHaystack = haystack.replace(/\s+/g, '');
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return haystack.includes(normalizedQuery)
    || compactHaystack.includes(compactQuery)
    || tokens.every(token => haystack.includes(token) || compactHaystack.includes(token.replace(/\s+/g, '')));
}

function isComboProductRecord(product) {
  const type = String(product?.type || product?.item_type || product?.product_type || '').trim().toLowerCase();
  return Boolean(product?.is_combo || product?.isCombo || type === 'combo' || type === 'bundle');
}

export default function CreateOrder({ user, store }) {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [combos, setCombos] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [cart, setCart] = useState([]);
  const [editBaselineCart, setEditBaselineCart] = useState([]);
  const [stockToast, setStockToast] = useState(null);
  const [productSearch, setProductSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [priceType, setPriceType] = useState('retail');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [vatPercent, setVatPercent] = useState(0);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [note, setNote] = useState('');
  const [splitLine, setSplitLine] = useState(false);
  const [creating, setCreating] = useState(false);
  const [lastInvoice, setLastInvoice] = useState(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [showProductPanel, setShowProductPanel] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [saleDate] = useState(() => new Date().toLocaleDateString('vi-VN'));
  const [deliveryFeeMode, setDeliveryFeeMode] = useState('absolute'); // absolute or percent
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [invoiceWriter, setInvoiceWriter] = useState(user?.name || '');
  const [receiverName, setReceiverName] = useState('');
  const [tag, setTag] = useState('');
  const [showVariantPicker, setShowVariantPicker] = useState(null);
  const [variantQty, setVariantQty] = useState({});
  const [productPickerSelections, setProductPickerSelections] = useState([]);
  const [serverOnline, setServerOnline] = useState(true);
  const [pendingOrders, setPendingOrders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kha_pending_orders') || '[]'); }
    catch { return []; }
  });
  const [loadError, setLoadError] = useState({ products: false, customers: false, combos: false });
  const [loading, setLoading] = useState({ products: true, customers: true, combos: true });
  const [productResultFilter, setProductResultFilter] = useState('all');
  const [showProductSearchResults, setShowProductSearchResults] = useState(false);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '', tax_code: '', customer_type: 'Khách lẻ' });
  const [offlineCustomers, setOfflineCustomers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kha_offline_customers') || '[]'); }
    catch { return []; }
  });
  const [expandedParents, setExpandedParents] = useState({});
  const [expandedComboRows, setExpandedComboRows] = useState({});
  const [showNewProductForm, setShowNewProductForm] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: '', sku: '', import_price: '', wholesale_price: '', retail_price: '', vip_price: '',
    stock: '', unit: 'cái', category: '', default_category_id: '', supplier_id: ''
  });
  const customerDropdownRef = useRef();
  const productSearchInputRef = useRef(null);
  const productPickerSearchInputRef = useRef(null);
  const serviceNameInputRefs = useRef({});
  const comboLastFetchedAtRef = useRef(0);
  const comboFetchInFlightRef = useRef(null);
  const lastStockLimitToastRef = useRef('');
  const lastServiceLineAddedAtRef = useRef(0);

  const { settings: negativeStockSettings, error: negativeStockSettingsError } = useNegativeStockSettings();
  const negativeStockLimitMessage = useMemo(() => getNegativeStockLimitMessage(negativeStockSettings), [negativeStockSettings]);
  const negativeStockRuntimeLimitLabel = useMemo(() => getNegativeStockLimitLabel(negativeStockSettings), [negativeStockSettings]);
  const negativeStockNearLimitLabel = useMemo(() => getNegativeStockNearLimitLabel(negativeStockSettings), [negativeStockSettings]);

  useEffect(() => {
    if (!stockToast) return undefined;
    const timer = window.setTimeout(() => setStockToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [stockToast]);

  useEffect(() => {
    if (!showProductPanel) return undefined;
    const timer = window.setTimeout(() => productPickerSearchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [showProductPanel]);

  const showStockLimitToast = (message = negativeStockLimitMessage) => {
    setStockToast({ id: Date.now(), message });
  };

  const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
  const getCartRowKey = (item, idx) => `cart-row-${String(item?.id ?? item?._cartKey ?? item?.combo_id ?? item?.product_id ?? 'item')}-${idx}`;
  const recalculateCartLine = (item) => {
    const quantity = Math.max(MIN_QUANTITY, Number(item.quantity) || MIN_QUANTITY);
    const unitPrice = Math.max(0, Number(item.unit_price) || 0);
    const discountPercent = Math.min(100, Math.max(0, Number(item.discount_percent) || 0));
    const discountAmount = discountPercent > 0
      ? quantity * unitPrice * discountPercent / 100
      : Math.max(0, Number(item.discount_amount) || 0);
    return {
      ...item,
      quantity,
      unit_price: unitPrice,
      discount_percent: discountPercent,
      discount_amount: discountAmount,
      line_total: Math.max(0, quantity * unitPrice - discountAmount),
    };
  };
  const toggleComboRow = (rowKey) => {
    setExpandedComboRows(prev => ({ ...prev, [rowKey]: !prev[rowKey] }));
  };

  const fetchCombos = async ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && comboLastFetchedAtRef.current && now - comboLastFetchedAtRef.current < COMBO_REFRESH_STALE_MS) {
      return combos;
    }
    if (comboFetchInFlightRef.current) return comboFetchInFlightRef.current;

    setLoading(prev => ({ ...prev, combos: true }));
    comboFetchInFlightRef.current = Promise.race([
      fetch(resolveApiUrl('/combos')).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      timeout(8000),
    ]).then(data => {
      const nextCombos = Array.isArray(data) ? data : [];
      setCombos(nextCombos);
      comboLastFetchedAtRef.current = Date.now();
      setLoadError(e => ({ ...e, combos: false }));
      return nextCombos;
    }).catch(() => {
      setLoadError(e => ({ ...e, combos: true }));
      return [];
    }).finally(() => {
      comboFetchInFlightRef.current = null;
      setLoading(prev => ({ ...prev, combos: false }));
    });

    return comboFetchInFlightRef.current;
  };

  useEffect(() => {
    setExpandedComboRows(prev => {
      const activeKeys = new Set(cart.map((item, idx) => getCartRowKey(item, idx)));
      const next = Object.fromEntries(Object.entries(prev).filter(([key]) => activeKeys.has(key)));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [cart]);

  // Ẩn dropdown khi click ra ngoài
  useEffect(() => {
    const handler = (e) => {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(e.target)) {
        setShowCustomerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  // Kiểm tra server online/offline
  const checkServer = () => {
    return fetch(resolveApiUrl('/store'), { signal: AbortSignal.timeout(5000) })
      .then(r => { setServerOnline(true); return true; })
      .catch(() => { setServerOnline(false); return false; });
  };

  // Thêm khách hàng mới từ form trong trang tạo đơn
  const handleAddCustomer = async () => {
    if (!newCustomer.name) { alert('Vui lòng nhập tên khách hàng!'); return; }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const data = await apiJsonChecked('/customers', {
        method: 'POST',
        body: newCustomer,
        signal: controller.signal,
      }, 'Không thể thêm khách hàng.');
      clearTimeout(timer);
      const full = { ...newCustomer, id: data.id };
      setCustomers(prev => [...prev, full]);
      setSelectedCustomer(full);
      applyPriceTypeToCart(customerTypeToPriceType(full.customer_type));
      setCustomerSearch('');
      setShowCustomerForm(false);
      setNewCustomer({ name: '', phone: '', email: '', tax_code: '', customer_type: 'Khách lẻ' });
      broadcastSyncUpdate({
        reason: 'customer-created',
        changedTables: ['customers'],
      });
    } catch (error) {
      if (error instanceof ApiError || error?.name === 'AbortError') {
        alert(error?.name === 'AbortError'
          ? '⏱️ Server không phản hồi khi thêm khách hàng.'
          : getApiErrorMessage(error?.data, error?.message || 'Không thể thêm khách hàng.'));
        return;
      }
      // ── OFFLINE: lưu local ──
      const offlineId = `OFF_CUST_${Date.now().toString(36).toUpperCase()}`;
      const offlineCust = { ...newCustomer, id: offlineId, _isOffline: true };
      const updated = [offlineCust, ...offlineCustomers].slice(0, 50);
      setOfflineCustomers(updated);
      localStorage.setItem('kha_offline_customers', JSON.stringify(updated));
      setCustomers(prev => [...prev, offlineCust]);
      setSelectedCustomer(offlineCust);
      applyPriceTypeToCart(customerTypeToPriceType(offlineCust.customer_type));
      setCustomerSearch('');
      setShowCustomerForm(false);
      setNewCustomer({ name: '', phone: '', email: '', tax_code: '', customer_type: 'Khách lẻ' });
      alert(`📡 Server offline — Khách hàng đã được lưu cục bộ.\nTên: ${newCustomer.name}\nMã tạm: ${offlineId}\n\nSẽ đồng bộ khi server trở lại.`);
    }
  };

  // Load dữ liệu ban đầu với feedback lỗi
  useEffect(() => {
    checkServer();

    const loadJson = async (key, url, setter, fallback = []) => {
      setLoading(prev => ({ ...prev, [key]: true }));
      try {
        const data = await Promise.race([
          fetch(url).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          }),
          timeout(8000),
        ]);
        setter(Array.isArray(data) ? data : fallback);
        setLoadError(e => ({ ...e, [key]: false }));
      } catch (_) {
        setter(fallback);
        setLoadError(e => ({ ...e, [key]: true }));
      } finally {
        setLoading(prev => ({ ...prev, [key]: false }));
      }
    };

    loadJson('products', resolveApiUrl('/products/all/with-variants'), setProducts);
    loadJson('customers', resolveApiUrl('/customers'), setCustomers);
    fetchCombos({ force: true });

    Promise.race([
      fetch(resolveApiUrl('/partners')).then(r => r.json()).then(d => { setSuppliers(Array.isArray(d) ? d : []); }),
      timeout(8000).catch(() => {})
    ]);
    Promise.race([
      fetch(resolveApiUrl('/product-categories')).then(r => r.json()).then(d => { setCategories(Array.isArray(d) ? d : []); }),
      timeout(8000).catch(() => {})
    ]);
  }, []);

  useEffect(() => {
    const refreshCombos = () => fetchCombos({ force: true });
    const refreshCombosIfStale = () => {
      if (document.visibilityState !== 'hidden') fetchCombos();
    };
    const onStorage = (event) => {
      if (event.key === 'kha_combos_updated_at') refreshCombos();
    };

    window.addEventListener('focus', refreshCombosIfStale);
    document.addEventListener('visibilitychange', refreshCombosIfStale);
    window.addEventListener('kha-combos-changed', refreshCombos);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('focus', refreshCombosIfStale);
      document.removeEventListener('visibilitychange', refreshCombosIfStale);
      window.removeEventListener('kha-combos-changed', refreshCombos);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    const refreshProducts = () => {
      fetch(resolveApiUrl('/products/all/with-variants'))
        .then(r => r.json())
        .then(d => setProducts(Array.isArray(d) ? d : []))
        .catch(() => { });
    };
    const refreshCustomers = () => {
      fetch(resolveApiUrl('/customers'))
        .then(r => r.json())
        .then(d => setCustomers(Array.isArray(d) ? d : []))
        .catch(() => { });
    };
    const refreshCategories = () => {
      fetch(resolveApiUrl('/product-categories'))
        .then(r => r.json())
        .then(d => setCategories(Array.isArray(d) ? d : []))
        .catch(() => { });
    };
    const onSyncUpdated = (event) => {
      const changedTables = event.detail?.changedTables || [];
      if (changedTables.some(table => ['products', 'invoices', 'invoice_details', 'imports', 'import_details'].includes(table))) {
        refreshProducts();
      }
      if (changedTables.includes('customers')) refreshCustomers();
      if (changedTables.includes('product_categories')) refreshCategories();
      if (changedTables.includes('combos')) fetchCombos({ force: true });
    };

    window.addEventListener('kha-order-created', refreshProducts);
    window.addEventListener(SYNC_UPDATED_EVENT, onSyncUpdated);
    return () => {
      window.removeEventListener('kha-order-created', refreshProducts);
      window.removeEventListener(SYNC_UPDATED_EVENT, onSyncUpdated);
    };
  }, []);

  const categoriesById = useMemo(() => buildCategoriesById(categories), [categories]);
  const regularProducts = useMemo(
    () => (products || []).filter(product => !isComboProductRecord(product)).map(product => ({
      ...product,
      variants: (product.variants || []).filter(variant => !isComboProductRecord(variant)),
    })),
    [products]
  );
  const filteredProducts = useMemo(
    () => filterProductTree(regularProducts, productSearch, { categoriesById, includeAllVariantsOnParentMatch: true }),
    [regularProducts, productSearch, categoriesById]
  );
  const filteredCombos = useMemo(
    () => (combos || []).filter(combo => comboMatchesSearch(combo, productSearch)),
    [combos, productSearch]
  );
  const visibleFilteredProducts = productResultFilter === 'combo' ? [] : filteredProducts;
  const visibleFilteredCombos = productResultFilter === 'combo' ? filteredCombos : [];
  const selectableProductRows = useMemo(() => {
    const normalizedQuery = normalizeSearchText(productSearch);
    return (visibleFilteredProducts || []).flatMap(parent => {
      const variants = getProductVariants(parent);
      if (variants.length === 0) {
        return [{ ...parent, is_variant: false, _isVariantOption: false, _rowKey: `product-${parent.id || parent.sku || parent.name}` }];
      }

      const visibleVariants = !normalizedQuery || parent._matchesParentSearch
        ? variants
        : variants.filter((variant, index) => {
          const variantId = getVariantIdentity(variant, index);
          return parent._matchedVariantIdSet?.has(variantId) || parent._matchedVariantIds?.includes(variantId);
        });

      return visibleVariants.map((variant, index) => ({
        ...variant,
        is_variant: true,
        _isVariantOption: true,
        _rowKey: `variant-${parent.id || 'parent'}-${getVariantIdentity(variant, index)}`,
        parent_id: variant.parent_id || variant._parentId || parent.id || null,
        parent_name: variant.parent_name || parent.name || '',
        parent_sku: variant.parent_sku || parent.sku || '',
        parent,
        default_category_id: variant.default_category_id || parent.default_category_id || null,
        default_category: variant.default_category || parent.default_category || null,
        category: variant.category || parent.category || '',
        supplier_id: variant.supplier_id || parent.supplier_id || null,
      }));
    });
  }, [visibleFilteredProducts, productSearch]);
  const productResultCount = selectableProductRows.length;
  const comboResultCount = filteredCombos.length;
  const allResultCount = productResultCount;
  const isComboResultMode = productResultFilter === 'combo';
  const resultLoading = isComboResultMode ? loading.combos : loading.products;
  const resultLoadError = isComboResultMode ? loadError.combos : loadError.products;
  const emptyProductResultMessage = resultLoadError
    ? (isComboResultMode ? 'Không tải được dữ liệu combo' : 'Không tải được dữ liệu sản phẩm')
    : (isComboResultMode ? 'Không tìm thấy combo' : 'Không tìm thấy sản phẩm');
  const handleProductResultFilterChange = (filter) => {
    setProductResultFilter(filter);
    if (filter === 'combo') fetchCombos();
  };
  const handleProductSearchFocus = () => {
    setShowProductSearchResults(true);
    if (productResultFilter === 'combo') fetchCombos();
  };
  const handleProductSearchChange = (event) => {
    setProductSearch(event.target.value);
    setShowProductSearchResults(true);
  };
  const handleProductSearchKeyDown = (event) => {
    if (event.key === 'Escape' && !productSearch) setShowProductSearchResults(false);
  };
  const filteredCustomers = customers.filter(c =>
    !customerSearch ||
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.phone || '').includes(customerSearch)
  );

  const subtotal = cart.reduce((s, i) => s + (Number(i.line_total) || 0), 0);

  // Lấy giá đúng theo loại khách hàng đã chọn
  const getPrice = (product) => {
    const activePriceType = selectedCustomer
      ? customerTypeToPriceType(selectedCustomer.customer_type)
      : priceType;
    return getPriceValueByType(product, activePriceType);
  };

  const getComboPrice = (combo) => {
    const activePriceType = selectedCustomer
      ? customerTypeToPriceType(selectedCustomer.customer_type)
      : priceType;
    return getComboPriceValue(combo, activePriceType);
  };

  const getComboById = (id) => (combos || []).find(c => Number(c.id) === Number(id));

  // Lấy tên nhà cung cấp
  const getSupplierName = (supplierId) => {
    if (!supplierId) return '—';
    const supplier = suppliers.find(s => s.id === supplierId);
    return supplier ? supplier.name : '—';
  };
  const getCategoryName = (product) => product?.default_category?.name || categories.find(c => Number(c.id) === Number(product?.default_category_id))?.name || product?.category || '—';

  // Tìm sản phẩm theo id (để cập nhật giỏ khi đổi loại giá)
  const getProductById = (id) => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) return null;
    // Ưu tiên tìm trong biến thể
    for (const p of products) {
      const v = (p.variants || []).find(va => Number(va.id) === numericId);
      if (v) return v;
      if (Number(p.id) === numericId) return p;
    }
    return null;
  };

  const resolveOrderProductRecord = (item) => {
    if (!item || isComboOrderItem(item) || isServiceOrderItem(item)) return null;
    return getProductById(item.variant_id || item.product_id);
  };

  const findMissingOrderProductLine = (lines = cart) => (
    (Array.isArray(lines) ? lines : []).find(line => !isComboOrderItem(line) && !isServiceOrderItem(line) && !resolveOrderProductRecord(line))
  );

  const repriceCartLineForType = (item, nextPriceType = 'retail') => {
    if (isServiceOrderItem(item)) return item;
    if (isComboOrderItem(item)) {
      const combo = getComboById(item.combo_id);
      if (!combo) return item;
      return recalculateCartLine({ ...item, unit_price: getComboPriceValue(combo, nextPriceType) });
    }
    const prod = getProductById(item.variant_id || item.product_id);
    if (!prod) return item;
    return recalculateCartLine({ ...item, unit_price: getPriceValueByType(prod, nextPriceType) });
  };

  const applyPriceTypeToCart = (nextPriceType = 'retail') => {
    const normalizedType = normalizePriceType(nextPriceType);
    setPriceType(normalizedType);
    setCart(prevCart => prevCart.map(item => repriceCartLineForType(item, normalizedType)));
  };

  const getProductStockById = (productId, line = {}) => {
    const product = getProductById(productId);
    if (product && Number.isFinite(Number(product.stock))) return Number(product.stock);
    const fallback = Number(line?.current_stock ?? line?.currentStock ?? line?.max_stock ?? line?.stock);
    return Number.isFinite(fallback) ? fallback : 0;
  };

  const cartStockValidation = useMemo(() => buildSaleStockValidation(cart, {
    baselineLines: editingInvoiceId ? editBaselineCart : [],
    getProductStockById,
    getLineKey: getCartRowKey,
    settings: negativeStockSettings,
  }), [cart, editBaselineCart, editingInvoiceId, negativeStockSettings, products]);

  // Thêm biến thể với số lượng
  const addVariantItem = (v) => {
    const qty = normalizeDecimalQuantity(variantQty[v.id], 1);
    if (qty <= 0) return;
    const unit_price = getPrice(v);
    const displayName = getProductDisplayName({
      ...v,
      is_variant: true,
      parent_id: showVariantPicker?.id || v.parent_id || v._parentId || null,
      parent_name: showVariantPicker?.name || v.parent_name || v.parent?.name || '',
    }, showVariantPicker);
    setCart(prev => {
      const existing = prev.find(c => c.product_id === v.id && c.unit_price === unit_price && !splitLine);
      if (existing) {
        const newQty = normalizeDecimalQuantity(existing.quantity + qty, 1);
        return prev.map(c => c.product_id === v.id && c.unit_price === unit_price
          ? recalculateCartLine({ ...c, quantity: newQty })
          : c);
      }
      return [...prev, {
        id: Date.now() + Math.random(),
        product_id: v.id,
        variant_id: v.id,
        parent_id: showVariantPicker?.id || v.parent_id || v._parentId || null,
        parent_name: showVariantPicker?.name || v.parent_name || v.parent?.name || '',
        variant_name: v.name,
        product_name: displayName,
        name: displayName,
        quantity: qty,
        unit_price,
        discount_amount: 0,
        discount_percent: 0,
        line_total: qty * unit_price,
        max_stock: v.stock,
      }];
    });
    setShowVariantPicker(false);
    setVariantQty({});
  };
  const newProductStockError = useMemo(() => {
    const text = String(newProduct.stock ?? '').trim();
    if (!text) return '';
    const stock = Number(text.replace(',', '.'));
    if (!Number.isFinite(stock)) return 'Số lượng tồn không hợp lệ.';
    if (stock < 0) return 'Tạo đơn không cho nhập tồn âm. Cấu hình xuất âm nằm trong trang Cài đặt và tồn kho âm được backend kiểm soát khi bán hàng.';
    return '';
  }, [newProduct.stock]);

  const getStockTargetProductId = (line = {}) => {
    if (isComboOrderItem(line)) return null;
    const id = Number(line.variant_id || line.product_id);
    return Number.isFinite(id) && id > 0 ? id : null;
  };

  const aggregateCartQuantitiesByProductId = (lines = []) => {
    const map = new Map();
    for (const line of Array.isArray(lines) ? lines : []) {
      const productId = getStockTargetProductId(line);
      if (!productId) continue;
      const quantity = Math.max(0, Number(line.quantity) || 0);
      if (quantity <= 0) continue;
      map.set(productId, (map.get(productId) || 0) + quantity);
    }
    return map;
  };

  const hasCartStockError = cartStockValidation.hasInvalid;
  const guardCartStockBeforeSubmit = () => {
    if (!hasCartStockError) return true;
    showStockLimitToast(cartStockValidation.firstError?.message || negativeStockLimitMessage);
    return false;
  };

  useEffect(() => {
    if (!hasCartStockError) {
      lastStockLimitToastRef.current = '';
      return;
    }
    const message = cartStockValidation.firstError?.message || negativeStockLimitMessage;
    if (lastStockLimitToastRef.current === message) return;
    lastStockLimitToastRef.current = message;
    showStockLimitToast(message);
  }, [
    hasCartStockError,
    cartStockValidation.firstError?.message,
    negativeStockLimitMessage,
  ]);

  const applyProductStockDeltas = (deltaByProductId) => {
    if (!(deltaByProductId instanceof Map) || deltaByProductId.size === 0) return;
    setProducts(currentProducts => (currentProducts || []).map(product => {
      const productId = Number(product.id);
      const productDelta = deltaByProductId.get(productId) || 0;
      const variants = Array.isArray(product.variants)
        ? product.variants.map(variant => {
          const variantId = Number(variant.id);
          const variantDelta = deltaByProductId.get(variantId) || 0;
          if (!variantDelta) return variant;
          const currentStock = Number(variant.stock);
          const safeStock = Number.isFinite(currentStock) ? currentStock : 0;
          return { ...variant, stock: safeStock + variantDelta };
        })
        : product.variants;

      if (!productDelta) return variants === product.variants ? product : { ...product, variants };
      const currentStock = Number(product.stock);
      const safeStock = Number.isFinite(currentStock) ? currentStock : 0;
      return { ...product, stock: safeStock + productDelta, variants };
    }));
  };

  const applyOrderStockRealtime = (currentCart = cart, baselineCart = []) => {
    const requested = aggregateCartQuantitiesByProductId(currentCart);
    const baseline = aggregateCartQuantitiesByProductId(baselineCart);
    const productIds = new Set([...requested.keys(), ...baseline.keys()]);
    const deltas = new Map();
    productIds.forEach(productId => {
      const delta = (baseline.get(productId) || 0) - (requested.get(productId) || 0);
      if (delta !== 0) deltas.set(productId, delta);
    });
    applyProductStockDeltas(deltas);
  };

  const vatAmount = subtotal * (vatPercent / 100);
  const discountVal = deliveryFeeMode === 'percent'
    ? subtotal * (discountAmount / 100)
    : discountAmount;
  const grandTotal = subtotal + vatAmount - discountVal + deliveryFee;
  const remainingAmount = Math.max(0, grandTotal - paidAmount);
  const changeAmount = Math.max(0, paidAmount - grandTotal);

  const buildComboCartLine = (combo, quantity = 1) => {
    const unit_price = getComboPrice(combo);
    const normalizedQuantity = normalizeDecimalQuantity(quantity, 1);
    const comboLineItems = getComboLineItems(combo).map(child => ({ ...child }));
    return {
      id: `combo_${combo.id}_${Date.now()}_${Math.random()}`,
      type: 'combo',
      item_type: 'combo',
      combo_id: combo.id,
      product_id: null,
      variant_id: null,
      product_name: combo.name || 'Combo',
      name: combo.name || 'Combo',
      quantity: normalizedQuantity,
      unit_price,
      discount_amount: 0,
      discount_percent: 0,
      line_total: normalizedQuantity * unit_price,
      max_stock: null,
      items: comboLineItems,
      combo_items: comboLineItems,
    };
  };

  const buildProductCartLine = (product, quantity = 1) => {
    const unit_price = getPrice(product);
    const normalizedQuantity = normalizeDecimalQuantity(quantity, 1);
    const isVariant = Boolean(product.is_variant || product.parent_id || product._parentId || product.parent_name || product.parent?.name);
    const parentId = product.parent_id || product._parentId || product.parent?.id || null;
    const displayName = getProductDisplayName(product, product.parent || null);
    return {
      id: Date.now() + Math.random(),
      product_id: product.id,
      variant_id: isVariant ? product.id : null,
      parent_id: isVariant ? parentId : null,
      parent_name: isVariant ? (product.parent_name || product.parent?.name || '') : '',
      variant_name: isVariant ? product.name : '',
      product_name: displayName,
      name: displayName,
      quantity: normalizedQuantity,
      unit_price,
      discount_amount: 0,
      discount_percent: 0,
      line_total: normalizedQuantity * unit_price,
      max_stock: product.stock,
    };
  };

  const buildServiceCartLine = () => ({
    id: `service_${Date.now()}_${Math.random()}`,
    type: 'service',
    item_type: 'service',
    is_service: true,
    combo_id: null,
    product_id: null,
    variant_id: null,
    product_name: '',
    name: '',
    quantity: 1,
    unit_price: 0,
    discount_amount: 0,
    discount_percent: 0,
    line_total: 0,
    max_stock: null,
  });

  const addServiceLine = () => {
    const timestamp = Date.now();
    if (timestamp - lastServiceLineAddedAtRef.current < 200) return;
    lastServiceLineAddedAtRef.current = timestamp;
    const line = buildServiceCartLine();
    setCart(prev => [...prev, line]);
    window.setTimeout(() => {
      serviceNameInputRefs.current[line.id]?.focus?.();
    }, 0);
  };

  const handleAddServicePointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    addServiceLine();
  };

  const handleAddServiceClick = (event) => {
    if (event.detail === 0) addServiceLine();
  };

  const mergeCartLineQuantity = (currentCart, lineToMerge, quantityDelta) => {
    if (!Number.isFinite(quantityDelta) || quantityDelta === 0) return currentCart;
    if (isServiceOrderItem(lineToMerge)) {
      if (quantityDelta <= 0) return currentCart;
      return [...currentCart, recalculateCartLine({ ...lineToMerge, quantity: quantityDelta })];
    }
    const isCombo = isComboOrderItem(lineToMerge);
    const existing = currentCart.find(line => (
      isCombo
        ? isComboOrderItem(line) && Number(line.combo_id) === Number(lineToMerge.combo_id) && line.unit_price === lineToMerge.unit_price
        : !isComboOrderItem(line) && Number(line.product_id) === Number(lineToMerge.product_id) && line.unit_price === lineToMerge.unit_price
    ));
    if (!existing) {
      if (quantityDelta <= 0) return currentCart;
      return [...currentCart, recalculateCartLine({ ...lineToMerge, quantity: quantityDelta })];
    }
    return currentCart.map(line => {
      if (line.id !== existing.id) return line;
      const nextQuantity = Math.max(MIN_QUANTITY, normalizeDecimalQuantity(Number(line.quantity) + quantityDelta, MIN_QUANTITY));
      return recalculateCartLine({ ...line, quantity: nextQuantity });
    });
  };

  const addCombo = (combo, quantity = 1) => {
    if (!combo?.id) return;
    const line = buildComboCartLine(combo, quantity);
    setCart(prev => mergeCartLineQuantity(prev, line, line.quantity));
  };

  const addProduct = (product, quantity = 1) => {
    if (!product?.id) return;
    const line = buildProductCartLine(product, quantity);
    setCart(prev => mergeCartLineQuantity(prev, line, line.quantity));
  };

  const addSearchResultToOrder = (item, kind = 'product') => {
    if (!item?.id) return;
    if (kind === 'combo') addCombo(item, 1);
    else addProduct(item, 1);
    setProductSearch('');
    setShowProductSearchResults(true);
    window.setTimeout(() => {
      productSearchInputRef.current?.focus();
      productSearchInputRef.current?.select?.();
    }, 0);
  };

  const openOrderProductPicker = () => {
    setShowProductPanel(true);
    if (productResultFilter === 'combo') fetchCombos();
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'F9') return;
      event.preventDefault();
      addServiceLine();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const closeOrderProductPicker = () => {
    setShowProductPanel(false);
  };

  const getProductPickerSelection = (item, kind = 'product') => (
    productPickerSelectionByKey.get(getOrderPickerKey(item, kind))
  );

  const getProductImageUrl = (item) => {
    const parent = item?.parent || {};
    const rawUrl = item?.image_url
      || item?.imageUrl
      || item?.thumbnail_url
      || item?.thumbnail
      || item?.image
      || item?.photo_url
      || item?.photo
      || parent.image_url
      || parent.imageUrl
      || parent.thumbnail_url
      || parent.thumbnail
      || parent.image
      || parent.photo_url
      || parent.photo
      || '';
    return resolveBackendAssetUrl(rawUrl);
  };

  const getPickerStockInfo = (item, selection) => {
    const stock = Number(item?.stock);
    if (!Number.isFinite(stock)) return null;
    const productId = Number(item?.id);
    const selectedQuantity = selection && isValidQuantityInput(selection.quantity)
      ? parseDecimalQuantity(selection.quantity, 0)
      : 0;
    const cartQuantity = cart.reduce((sum, line) => (
      !isComboOrderItem(line) && Number(line.product_id) === productId
        ? sum + (Number(line.quantity) || 0)
        : sum
    ), 0);
    const baselineQuantity = editingInvoiceId ? editBaselineCart.reduce((sum, line) => (
      !isComboOrderItem(line) && Number(line.product_id) === productId
        ? sum + (Number(line.quantity) || 0)
        : sum
    ), 0) : 0;
    const available = stock + baselineQuantity - cartQuantity - selectedQuantity;
    return { stock, available };
  };

  const getPickerMetaText = (item, kind = 'product') => {
    if (kind === 'combo') return getComboItemSummary(item);
    const isVariant = Boolean(item._isVariantOption || item.is_variant);
    const parent = item.parent || null;
    const categoryName = isVariant ? (getCategoryName(item) || getCategoryName(parent)) : getCategoryName(item);
    return categoryName && categoryName !== '—' ? categoryName : 'Mặc định';
  };

  const addOrderPickerSelection = (item, kind = 'product') => {
    if (!item?.id) return;
    const key = getOrderPickerKey(item, kind);
    setProductPickerSelections(prev => {
      if (prev.some(selection => selection.key === key)) {
        return prev.map(selection => (
          selection.key === key
            ? { ...selection, quantity: normalizeDecimalQuantity(parseDecimalQuantity(selection.quantity, 0) + 1, 1) }
            : selection
        ));
      }
      const line = kind === 'combo' ? buildComboCartLine(item, 1) : buildProductCartLine(item, 1);
      return [...prev, {
        key,
        kind,
        item,
        line,
        name: line.product_name,
        quantity: 1,
        appliedQuantity: 0,
      }];
    });
    window.setTimeout(() => {
      const searchInput = showProductPanel ? productPickerSearchInputRef.current : productSearchInputRef.current;
      searchInput?.focus();
      searchInput?.select?.();
    }, 0);
  };

  const updateOrderPickerQuantity = (key, nextValue) => {
    const text = String(nextValue ?? '').replace(',', '.');
    if (text !== '' && !/^\d*(?:\.\d*)?$/.test(text)) return;
    setProductPickerSelections(prev => prev.map(selection => (
      selection.key === key ? { ...selection, quantity: text } : selection
    )));
  };

  const stepOrderPickerQuantity = (key, direction, step = QUANTITY_STEP) => {
    setProductPickerSelections(prev => prev.flatMap(selection => {
      if (selection.key !== key) return selection;
      const current = parseDecimalQuantity(selection.quantity, 1);
      const nextValue = current + direction * step;
      if (direction < 0 && nextValue < MIN_QUANTITY) return [];
      return { ...selection, quantity: normalizeDecimalQuantity(nextValue, 1) };
    }));
  };

  const removeOrderPickerSelection = (key) => {
    setProductPickerSelections(prev => prev.filter(selection => selection.key !== key));
  };

  const orderPickerHasQuantityError = productPickerSelections.some(selection => !isValidQuantityInput(selection.quantity));
  const orderPickerTotalQuantity = productPickerSelections.reduce((sum, selection) => (
    sum + (isValidQuantityInput(selection.quantity) ? parseDecimalQuantity(selection.quantity, 0) : 0)
  ), 0);
  const orderPickerEstimatedTotal = productPickerSelections.reduce((sum, selection) => (
    sum + (isValidQuantityInput(selection.quantity) ? parseDecimalQuantity(selection.quantity, 0) * Number(selection.line.unit_price || 0) : 0)
  ), 0);

  const orderPickerPreviewCart = useMemo(() => {
    let preview = cart;
    productPickerSelections.forEach(selection => {
      if (!isValidQuantityInput(selection.quantity)) return;
      const desiredQuantity = normalizeDecimalQuantity(selection.quantity, 1);
      const appliedQuantity = Number(selection.appliedQuantity) || 0;
      preview = mergeCartLineQuantity(preview, selection.line, desiredQuantity - appliedQuantity);
    });
    return preview;
  }, [cart, productPickerSelections]);

  const orderPickerStockValidation = useMemo(() => buildSaleStockValidation(orderPickerPreviewCart, {
    baselineLines: editingInvoiceId ? editBaselineCart : [],
    getProductStockById,
    getLineKey: getCartRowKey,
    settings: negativeStockSettings,
  }), [orderPickerPreviewCart, editBaselineCart, editingInvoiceId, negativeStockSettings, products]);

  const productPickerSelectionByKey = useMemo(() => (
    new Map(productPickerSelections.map(selection => [selection.key, selection]))
  ), [productPickerSelections]);

  const renderProductPickerQuantityControl = (item, kind = 'product') => {
    const selection = getProductPickerSelection(item, kind);
    if (!selection) {
      return (
        <button
          type="button"
          onClick={() => addOrderPickerSelection(item, kind)}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-white shadow-sm transition hover:bg-sky-600"
          title={kind === 'combo' ? 'Thêm combo' : 'Thêm sản phẩm'}
        >
          <Plus size={15} strokeWidth={3} />
        </button>
      );
    }

    const quantityInvalid = !isValidQuantityInput(selection.quantity);
    return (
      <div className="inline-flex items-center gap-2" onClick={event => event.stopPropagation()}>
        <button
          type="button"
          onClick={() => stepOrderPickerQuantity(selection.key, -1, 1)}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-400 text-white transition hover:bg-slate-500"
          title="Giảm số lượng"
        >
          <Minus size={12} strokeWidth={3} />
        </button>
        <input
          type="text"
          inputMode="decimal"
          value={selection.quantity}
          onChange={event => updateOrderPickerQuantity(selection.key, event.target.value)}
          onFocus={event => event.currentTarget.select()}
          className={`h-7 w-11 border-0 border-b-2 bg-transparent px-1 text-center text-sm font-semibold outline-none focus:ring-0 ${quantityInvalid ? 'border-red-500 text-red-600' : 'border-sky-500 text-slate-700'}`}
          aria-label="Số lượng chọn"
        />
        <button
          type="button"
          onClick={() => stepOrderPickerQuantity(selection.key, 1, 1)}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-400 text-white transition hover:bg-slate-500"
          title="Tăng số lượng"
        >
          <Plus size={12} strokeWidth={3} />
        </button>
      </div>
    );
  };

  const renderProductPickerRow = (item, kind = 'product', keyPrefix = 'picker') => {
    const selection = getProductPickerSelection(item, kind);
    const isVariant = kind === 'product' && Boolean(item._isVariantOption || item.is_variant);
    const parent = item.parent || null;
    const displayName = kind === 'combo'
      ? (item.name || 'Combo')
      : (isVariant ? getProductDisplayName(item, parent) : getProductDisplayName(item));
    const imageUrl = kind === 'product' ? getProductImageUrl(item) : '';
    const price = kind === 'combo' ? getComboPrice(item) : getPrice(item);
    const metaText = getPickerMetaText(item, kind);
    const stockInfo = kind === 'product' ? getPickerStockInfo(item, selection) : null;
    const availableNegative = stockInfo && Number(stockInfo.available) < 0;
    const stockNegative = stockInfo && Number(stockInfo.stock) < 0;
    const rowKey = `${keyPrefix}-${kind}-${item._rowKey || item.id || item.sku || displayName}`;

    return (
      <div
        key={rowKey}
        className={`grid grid-cols-[54px_minmax(0,1fr)_132px] gap-3 border-b border-slate-100 px-5 py-3.5 transition hover:bg-sky-50/50 sm:grid-cols-[56px_minmax(0,1fr)_156px] ${selection ? 'bg-sky-50/40' : 'bg-white'}`}
      >
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded bg-slate-100 text-slate-300 ring-1 ring-slate-100">
          {imageUrl ? (
            <img src={imageUrl} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            <ImageIcon size={23} strokeWidth={1.6} />
          )}
        </div>
        <div className="min-w-0 pt-0.5">
          <div className="line-clamp-2 text-[13px] font-medium leading-5 text-slate-800" title={displayName}>
            {displayName}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] leading-4">
            <span className="max-w-full truncate font-medium text-sky-700">{metaText}</span>
          </div>
          {isVariant && parent?.name && (
            <div className="mt-0.5 truncate text-[11px] text-slate-400">Thuộc: {parent.name}</div>
          )}
        </div>
        <div className="flex min-w-0 flex-col items-end justify-start gap-2 pt-0.5 text-right">
          <div className="max-w-full truncate text-sm font-semibold text-slate-700">{formatVND(price)}</div>
          {stockInfo ? (
            <div className="whitespace-nowrap text-[12px] leading-4 text-slate-400">
              <span>Tồn: <b className={stockNegative ? 'text-red-500' : 'text-slate-500'}>{formatPickerStockNumber(stockInfo.stock)}</b></span>
              <span className="mx-1 text-slate-300">|</span>
              <span>Có thể bán: <b className={availableNegative ? 'text-red-500' : 'text-slate-500'}>{formatPickerStockNumber(stockInfo.available)}</b></span>
            </div>
          ) : (
            <div className="truncate text-[12px] leading-4 text-purple-500">Combo bán hàng</div>
          )}
          {renderProductPickerQuantityControl(item, kind)}
        </div>
      </div>
    );
  };

  const renderProductPickerFilterTabs = () => (
    comboResultCount === 0 && productResultFilter !== 'combo' ? null :
    <div className="flex flex-wrap items-center gap-2 px-6 pb-2 text-xs">
      {[
        ['all', `Tất cả (${allResultCount})`],
        ['product', `Sản phẩm (${productResultCount})`],
        ['combo', `Combo (${comboResultCount})`],
      ].map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => handleProductResultFilterChange(key)}
          className={`rounded-full border px-3 py-1.5 font-medium transition ${productResultFilter === key ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-500 hover:border-sky-300 hover:text-sky-700'}`}
        >
          {label}
        </button>
      ))}
      {resultLoading && <span className="text-sky-600">Đang tải dữ liệu...</span>}
      {resultLoadError && <span className="text-red-500">Có dữ liệu chưa tải được</span>}
    </div>
  );

  const renderOrderProductPickerModal = () => {
    if (!showProductPanel) return null;
    const hasRows = selectableProductRows.length > 0 || visibleFilteredCombos.length > 0;
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-3 sm:p-6" role="presentation">
        <div className="flex max-h-[92dvh] w-full max-w-[750px] flex-col overflow-hidden rounded bg-white text-slate-800 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="quick-product-picker-title">
          <div className="flex items-center justify-between px-6 pb-3 pt-5">
            <h2 id="quick-product-picker-title" className="text-xl font-semibold tracking-normal text-slate-900">
              Chọn sản phẩm để bán hàng
            </h2>
            <button
              type="button"
              onClick={closeOrderProductPicker}
              className="inline-flex h-8 w-8 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              title="Thoát"
            >
              <X size={22} />
            </button>
          </div>
          <div className="px-6 pb-3">
            <div className="relative">
              <Search size={19} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={productPickerSearchInputRef}
                className="h-10 w-full rounded-none border border-slate-300 bg-white pl-11 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                placeholder="Tìm kiếm sản phẩm"
                value={productSearch}
                onFocus={handleProductSearchFocus}
                onChange={event => setProductSearch(event.target.value)}
              />
            </div>
          </div>
          {renderProductPickerFilterTabs()}
          <div className="min-h-[380px] flex-1 overflow-y-auto border-y border-slate-100 bg-white">
            {visibleFilteredCombos.map(combo => renderProductPickerRow(combo, 'combo', 'quick-combo'))}
            {selectableProductRows.map(item => renderProductPickerRow(item, 'product', 'quick-product'))}
            {!hasRows && !resultLoading && (
              <div className="flex h-56 items-center justify-center px-6 text-center text-sm text-slate-400">
                {emptyProductResultMessage}
              </div>
            )}
          </div>
          <div className="border-t border-slate-100 bg-white px-6 py-4">
            {(orderPickerStockValidation.hasInvalid || orderPickerHasQuantityError) && (
              <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                {orderPickerHasQuantityError
                  ? 'Số lượng phải là số dương, không nhập chữ hoặc số âm.'
                  : (orderPickerStockValidation.summaryMessage || negativeStockLimitMessage)}
              </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-semibold text-sky-700">
                Bạn đã chọn {productPickerSelections.length.toLocaleString('vi-VN')} sản phẩm
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeOrderProductPicker}
                  className="inline-flex min-h-10 min-w-20 items-center justify-center rounded border border-sky-600 bg-white px-4 text-sm font-semibold text-sky-700 transition hover:bg-sky-50"
                >
                  Thoát
                </button>
                <button
                  type="button"
                  onClick={finishOrderProductSelection}
                  disabled={productPickerSelections.length === 0 || orderPickerHasQuantityError || orderPickerStockValidation.hasInvalid}
                  className="inline-flex min-h-10 min-w-28 items-center justify-center rounded bg-sky-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Chọn xong
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const finishOrderProductSelection = () => {
    if (productPickerSelections.length === 0 || orderPickerHasQuantityError) return;
    if (orderPickerStockValidation.hasInvalid) {
      showStockLimitToast(orderPickerStockValidation.firstError?.message || negativeStockLimitMessage);
      return;
    }
    setCart(orderPickerPreviewCart);
    setProductPickerSelections([]);
    setProductSearch('');
    setShowProductPanel(false);
  };

  const renderOrderPickerSelections = (className = '') => (
    <div className={`rounded-xl border border-blue-200 bg-white shadow-sm ${className}`.trim()}>
      <div className="border-b border-blue-100 bg-blue-50 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold text-blue-800">Danh sách chọn nhanh</div>
            <div className="text-[11px] text-blue-600">
              {productPickerSelections.length.toLocaleString('vi-VN')} dòng · {orderPickerTotalQuantity.toLocaleString('vi-VN')} sản phẩm · {formatVND(orderPickerEstimatedTotal)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {productPickerSelections.length > 0 && (
              <button
                type="button"
                onClick={() => setProductPickerSelections([])}
                className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
              >
                Xóa chọn
              </button>
            )}
            <button
              type="button"
              onClick={finishOrderProductSelection}
              disabled={productPickerSelections.length === 0 || orderPickerHasQuantityError || orderPickerStockValidation.hasInvalid}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Thêm vào đơn
            </button>
          </div>
        </div>
        {orderPickerStockValidation.hasInvalid && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-700">
            {orderPickerStockValidation.summaryMessage || negativeStockLimitMessage}
          </div>
        )}
        {orderPickerHasQuantityError && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-700">
            Số lượng phải là số dương, không nhập chữ hoặc số âm.
          </div>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto p-2 space-y-2 scroll-smooth">
        {productPickerSelections.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-400">
            Bấm nút + cạnh sản phẩm, nhập số lượng tại đây, rồi bấm Thêm vào đơn để chuyển xuống bảng đơn hàng.
          </div>
        ) : productPickerSelections.map(selection => {
          const stockState = getSaleStockStateForLine(orderPickerStockValidation, selection.line);
          const projectedStock = Number(stockState?.projectedStock);
          const isProjectedNegative = Number.isFinite(projectedStock) && projectedStock < 0;
          const isInvalid = Boolean(stockState?.invalid);
          const isNearLimit = Boolean(stockState?.nearLimit);
          return (
            <div key={selection.key} className={`rounded-lg border p-2 ${isInvalid ? 'border-red-200 bg-red-50' : isNearLimit ? 'border-orange-200 bg-orange-50' : isProjectedNegative ? 'border-red-100 bg-red-50/60' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${selection.kind === 'combo' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                      {selection.kind === 'combo' ? 'Combo' : 'SP'}
                    </span>
                    <span className="truncate text-xs font-semibold text-gray-800" title={selection.name}>{selection.name}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-gray-400">Giá bán: {formatVND(selection.line.unit_price)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => removeOrderPickerSelection(selection.key)}
                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  title="Bỏ khỏi danh sách chọn tạm"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <QuantityStepper
                  value={selection.quantity}
                  min={MIN_QUANTITY}
                  step={QUANTITY_STEP}
                  onChange={(value) => updateOrderPickerQuantity(selection.key, value)}
                  onDecrease={() => stepOrderPickerQuantity(selection.key, -1)}
                  onIncrease={() => stepOrderPickerQuantity(selection.key, 1)}
                  inputClassName={!isValidQuantityInput(selection.quantity) ? 'bg-red-50 text-red-700' : ''}
                />
                <div className="text-right text-xs font-bold text-blue-700">
                  {formatVND((isValidQuantityInput(selection.quantity) ? parseDecimalQuantity(selection.quantity, 0) : 0) * selection.line.unit_price)}
                </div>
              </div>
              {stockState && (
                <div className={`mt-1 text-[11px] font-semibold ${isInvalid ? 'text-red-700' : isNearLimit ? 'text-orange-700' : isProjectedNegative ? 'text-red-600' : 'text-gray-500'}`}>
                  Dự kiến {formatStockValue(stockState.projectedStock)}{isInvalid ? ` · ${stockState.message || negativeStockLimitMessage}` : isNearLimit ? ` · ${negativeStockNearLimitLabel || `gần ngưỡng ${negativeStockRuntimeLimitLabel}`}` : isProjectedNegative ? ' · xuất âm được phép theo cấu hình' : ''}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const updateCartItem = (id, field, value) => {
    setCart(prev => prev.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item };
      if (field === 'quantity') updated.quantity = normalizeDecimalQuantity(value, 1);
      else if (field === 'unit_price') updated.unit_price = Math.max(0, Number(value) || 0);
      else if (field === 'discount_percent') updated.discount_percent = Math.min(100, Math.max(0, Number(value) || 0));
      else if (field === 'service_name') {
        updated.product_name = value;
        updated.name = value;
        updated.service_name = value;
      }
      else updated[field] = value;
      return recalculateCartLine(updated);
    }));
  };

  const removeCartItem = (id) => {
    setCart(prev => prev.filter(i => i.id !== id));
    setExpandedComboRows(prev => {
      const next = { ...prev };
      delete next[String(id)];
      return next;
    });
  };

  const findBlankServiceLine = () => cart.find(item => isServiceOrderItem(item) && !getServiceLineName(item));

  const guardServiceLinesBeforeSubmit = () => {
    const invalid = findBlankServiceLine();
    if (!invalid) return true;
    alert('Vui lòng nhập tên dịch vụ trước khi tạo đơn.');
    window.setTimeout(() => serviceNameInputRefs.current[invalid.id]?.focus?.(), 0);
    return false;
  };

  const buildOrderDetailsPayload = () => cart.map((item) => {
    const serviceLine = isServiceOrderItem(item);
    const type = serviceLine ? 'service' : (item.type || item.item_type || 'product');
    const serviceName = getServiceLineName(item);
    const productRecord = serviceLine ? null : resolveOrderProductRecord(item);
    const parentProduct = productRecord?.parent_id ? getProductById(productRecord.parent_id) : null;
    const canonicalProductName = serviceLine
      ? serviceName
      : getProductDisplayName(productRecord || item, parentProduct);
    return {
      type,
      item_type: type,
      combo_id: serviceLine ? null : (item.combo_id || null),
      product_id: serviceLine ? null : (productRecord?.id || item.product_id || null),
      variant_id: serviceLine ? null : (productRecord?.parent_id ? productRecord.id : (item.variant_id || null)),
      parent_id: serviceLine ? null : (productRecord?.parent_id || item.parent_id || null),
      parent_name: serviceLine ? '' : (productRecord?.parent_id ? (parentProduct?.name || item.parent_name || '') : (item.parent_name || '')),
      variant_name: serviceLine ? '' : (productRecord?.parent_id ? (productRecord?.name || item.variant_name || '') : (item.variant_name || '')),
      product_name: serviceLine ? serviceName : canonicalProductName,
      name: serviceLine ? serviceName : (item.name || canonicalProductName || ''),
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount_amount: item.discount_amount,
      discount_percent: item.discount_percent,
      line_total: item.line_total,
    };
  });

  // Thêm sản phẩm mới (chưa có trong hệ thống) vào giỏ hàng
  const handleAddNewProduct = async () => {
    if (!newProduct.name.trim()) {
      alert('Vui lòng nhập tên sản phẩm!');
      return;
    }
    if (newProductStockError) {
      showStockLimitToast(newProductStockError);
      return;
    }
    const normalizedNewProductStock = Math.max(0, Number(String(newProduct.stock || '0').replace(',', '.')) || 0);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      const data = await apiJsonChecked('/products', {
        method: 'POST',
        body: {
          name: newProduct.name.trim(),
          import_price: parseFloat(newProduct.import_price) || 0,
          wholesale_price: parseFloat(newProduct.wholesale_price) || 0,
          retail_price: parseFloat(newProduct.retail_price) || 0,
          vip_price: parseFloat(newProduct.vip_price) || 0,
          stock: normalizedNewProductStock,
          unit: newProduct.unit || 'cái',
          category: newProduct.category?.trim() || '',
          default_category_id: newProduct.default_category_id || null,
          supplier_id: newProduct.supplier_id ? parseInt(newProduct.supplier_id) : null,
        },
        signal: controller.signal,
      }, 'Không thể tạo sản phẩm mới.');
      clearTimeout(timer);

      const productToAdd = {
        id: data.id,
        name: newProduct.name.trim(),
        sku: data.sku || '',
        import_price: parseFloat(newProduct.import_price) || 0,
        wholesale_price: parseFloat(newProduct.wholesale_price) || 0,
        retail_price: parseFloat(newProduct.retail_price) || 0,
        vip_price: parseFloat(newProduct.vip_price) || 0,
        stock: normalizedNewProductStock,
        unit: newProduct.unit || 'cái',
        category: newProduct.category?.trim() || '',
        default_category_id: newProduct.default_category_id || null,
        default_category: categories.find(c => String(c.id) === String(newProduct.default_category_id)) || null,
        supplier_id: newProduct.supplier_id ? parseInt(newProduct.supplier_id) : null,
      };
      const unit_price = getPrice(productToAdd);
      setCart(prev => [...prev, {
        id: Date.now() + Math.random(),
        product_id: data.id,
        product_name: productToAdd.name,
        quantity: 1,
        unit_price,
        discount_amount: 0,
        discount_percent: 0,
        line_total: unit_price,
        max_stock: productToAdd.stock,
      }]);
      setProducts(prev => [...prev, productToAdd]);
      setShowNewProductForm(false);
      setNewProduct({
        name: '', sku: '', import_price: '', wholesale_price: '', retail_price: '', vip_price: '',
        stock: '', unit: 'cái', category: '', default_category_id: '', supplier_id: ''
      });
      broadcastSyncUpdate({
        reason: 'product-created-from-order',
        changedTables: ['products'],
      });
      alert('✅ Đã thêm sản phẩm mới vào đơn hàng!');
    } catch (err) {
      alert(err?.name === 'AbortError' ? '⏱️ Server không phản hồi khi tạo sản phẩm.' : getApiErrorMessage(err?.data, err?.message || 'Lỗi kết nối khi tạo sản phẩm.'));
    }
  };

  const handleCreateOrder = async () => {
    if (cart.length === 0) { alert('Chưa có sản phẩm hoặc dịch vụ nào!'); return; }
    if (!guardServiceLinesBeforeSubmit()) return;
    const missingProductLine = findMissingOrderProductLine();
    if (missingProductLine) {
      alert(`Sản phẩm "${missingProductLine.product_name || missingProductLine.name || 'đã chọn'}" không tồn tại trong hệ thống. Vui lòng chọn lại sản phẩm từ danh sách.`);
      return;
    }
    if (!guardCartStockBeforeSubmit()) return;
    setCreating(true);
    const clientOrderId = generateClientOrderId();
    const orderPayload = attachClientOrderMetadata({
      customer_id: selectedCustomer?.id || null,
      user_id: user?.id,
      subtotal, vat_percent: vatPercent, vat_amount: vatAmount,
      discount_percent: deliveryFeeMode === 'percent' ? discountAmount : 0,
      discount_amount: discountVal,
      total: grandTotal, payment_method: paymentMethod, note,
      paid_amount: paidAmount,
      change_amount: changeAmount,
      remaining_amount: remainingAmount,
      delivery_fee: deliveryFee,
      invoice_writer: invoiceWriter, receiver_name: receiverName,
      delivery_date: deliveryDate || null,
      details: buildOrderDetailsPayload(),
    }, { client_order_id: clientOrderId });
    const showSuccess = (invoice_code, invoice_id = null, saveToPending = true) => {
      const payloadForStorage = saveToPending
        ? { ...orderPayload, invoice_code, created_at: orderPayload.created_at || new Date().toISOString() }
        : orderPayload;
      const inv = {
        id: invoice_id || orderPayload.client_order_id,
        invoice_code,
        client_order_id: orderPayload.client_order_id,
        payload: payloadForStorage,
        customer_id: selectedCustomer?.id || null,
        customer_name: selectedCustomer?.name || 'Khách lẻ',
        total: grandTotal,
        subtotal,
        vatPercent,
        vatAmount,
        discountAmount: discountVal,
        delivery_date: deliveryDate || null,
        delivery_fee: deliveryFee,
        cart: [...cart],
        selectedCustomer,
        created_at: new Date().toISOString(),
        status: 'pending',
        payment_method: paymentMethod,
        invoice_writer: invoiceWriter,
        receiver_name: receiverName,
        note,
        paid_amount: paidAmount,
        change_amount: changeAmount,
        remaining_amount: remainingAmount,
      };

      try {
        const pending = JSON.parse(localStorage.getItem('kha_pending_orders') || '[]');
        if (saveToPending) {
          const exists = pending.find(o =>
            (inv.client_order_id && o.client_order_id === inv.client_order_id) ||
            (inv.client_order_id && o.payload?.client_order_id === inv.client_order_id) ||
            o.invoice_code === inv.invoice_code
          );
          if (!exists) {
            const updatedPending = [inv, ...pending].slice(0, 50);
            localStorage.setItem('kha_pending_orders', JSON.stringify(updatedPending));
            setPendingOrders(updatedPending);
          }
        } else {
          const cleaned = pending.filter(o =>
            !(
              (inv.client_order_id && (o.client_order_id === inv.client_order_id || o.payload?.client_order_id === inv.client_order_id)) ||
              o.invoice_code === inv.invoice_code
            )
          );
          localStorage.setItem('kha_pending_orders', JSON.stringify(cleaned));
          setPendingOrders(cleaned);
        }
      } catch (_) { }

      window.dispatchEvent(new CustomEvent('kha-order-created', { detail: inv }));
      broadcastSyncUpdate({
        reason: saveToPending ? 'order-created-offline' : 'order-created',
        changedTables: ['invoices', 'invoice_details', 'products'],
      });

      applyOrderStockRealtime(cart, editingInvoiceId ? editBaselineCart : []);
      setLastInvoice(inv);
      setProductPickerSelections([]);
      setEditingInvoiceId(null);
      setEditBaselineCart([]);
      setCreating(false);
    };
    let timeoutId;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 10000);
      const data = await apiJsonChecked('/invoices', {
        method: 'POST',
        body: orderPayload,
        signal: controller.signal,
      }, 'Không thể tạo đơn hàng.');
      showSuccess(data.invoice_code, data.invoice_id || null, false);
    } catch (error) {
      if (error instanceof ApiError) {
        setCreating(false);
        alert(getApiErrorMessage(error.data, error.message || 'Không thể tạo đơn hàng.'));
        return;
      }
      showSuccess(`LOCAL_${Date.now().toString(36).toUpperCase()}`, null, true);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const handleStartEdit = () => {
    if (!lastInvoice) return;
    setEditingInvoiceId(lastInvoice.id || null);
    setSelectedCustomer(lastInvoice.selectedCustomer || null);
    const baselineCart = (lastInvoice.cart || []).map((item, idx) => ({
      ...item,
      id: item.id || `${Date.now()}_${idx}`,
    }));
    setEditBaselineCart(baselineCart);
    setCart(baselineCart.map(item => ({ ...item })));
    setVatPercent(+(lastInvoice.vatPercent || lastInvoice.vat_percent || 0));
    setDiscountAmount(+(lastInvoice.discountAmount || lastInvoice.discount_amount || 0));
    setDeliveryDate(lastInvoice.delivery_date || '');
    setPaymentMethod(lastInvoice.payment_method || 'cash');
    setInvoiceWriter(lastInvoice.invoice_writer || '');
    setReceiverName(lastInvoice.receiver_name || '');
    setNote(lastInvoice.note || '');
    setPaidAmount(+(lastInvoice.paid_amount || 0));
    setLastInvoice(null);
  };

  const handleSaveEdit = async () => {
    if (!editingInvoiceId) { alert('Không tìm thấy đơn hàng để cập nhật!'); return; }
    if (cart.length === 0) { alert('Chưa có sản phẩm hoặc dịch vụ nào!'); return; }
    if (!guardServiceLinesBeforeSubmit()) return;
    const missingProductLine = findMissingOrderProductLine();
    if (missingProductLine) {
      alert(`Sản phẩm "${missingProductLine.product_name || missingProductLine.name || 'đã chọn'}" không tồn tại trong hệ thống. Vui lòng chọn lại sản phẩm từ danh sách.`);
      return;
    }
    if (!guardCartStockBeforeSubmit()) return;
    setCreating(true);
    const payload = {
      customer_id: selectedCustomer?.id || null,
      payment_method: paymentMethod,
      note,
      subtotal,
      vat_percent: vatPercent,
      vat_amount: vatAmount,
      discount_percent: deliveryFeeMode === 'percent' ? discountAmount : 0,
      discount_amount: discountVal,
      total: grandTotal,
      paid_amount: paidAmount,
      change_amount: changeAmount,
      remaining_amount: remainingAmount,
      delivery_fee: deliveryFee,
      delivery_date: deliveryDate || null,
      details: buildOrderDetailsPayload(),
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      await apiJsonChecked(resolveApiUrl(`/invoices/${editingInvoiceId}`), {
        method: 'PUT',
        body: payload,
        signal: controller.signal,
      }, 'Không thể cập nhật đơn hàng.');
      clearTimeout(timeout);

      const updatedInvoice = {
        id: editingInvoiceId,
        invoice_code: lastInvoice?.invoice_code || '',
        customer_name: selectedCustomer?.name || 'Khách lẻ',
        total: grandTotal,
        subtotal,
        vatPercent,
        vatAmount,
        discountAmount: discountVal,
        delivery_date: deliveryDate || null,
        delivery_fee: deliveryFee,
        cart: [...cart],
        selectedCustomer,
        created_at: lastInvoice?.created_at || new Date().toISOString(),
        status: lastInvoice?.status || 'pending',
        payment_method: paymentMethod,
        invoice_writer: invoiceWriter,
        receiver_name: receiverName,
        note,
        paid_amount: paidAmount,
        change_amount: changeAmount,
        remaining_amount: remainingAmount,
      };

      applyOrderStockRealtime(cart, editBaselineCart);
      setLastInvoice(updatedInvoice);
      setProductPickerSelections([]);
      setEditingInvoiceId(null);
      setEditBaselineCart([]);
      setCreating(false);
      window.dispatchEvent(new CustomEvent('kha-order-created', { detail: updatedInvoice }));
      broadcastSyncUpdate({
        reason: 'order-updated',
        changedTables: ['invoices', 'invoice_details', 'products'],
      });
      alert('✅ Đã lưu thay đổi đơn hàng!');
    } catch (err) {
      setCreating(false);
      alert(getApiErrorMessage(err?.data, err?.message || 'Lỗi khi cập nhật đơn hàng'));
    }
  };

  const openLastInvoicePrint = (mode = 'invoice', quick = false) => {
    const target = lastInvoice?.id || lastInvoice?.invoice_code || '';
    if (!lastInvoice || !target || String(lastInvoice.invoice_code || '').startsWith('LOCAL_')) {
      alert('Đơn offline chưa có dữ liệu hóa đơn thật trên server để in. Vui lòng đồng bộ đơn trước khi in.');
      return;
    }
    const params = new URLSearchParams();
    params.set('mode', mode === 'estimate' ? 'estimate' : 'invoice');
    if (quick) params.set('print', '1');
    navigate(`/hoa-don-in/${encodeURIComponent(target)}?${params.toString()}`);
  };

  const resetForm = () => {
    setLastInvoice(null);
    setEditingInvoiceId(null);
    setCart([]);
    setEditBaselineCart([]);
    setStockToast(null);
    setProductSearch('');
    setProductPickerSelections([]);
    setShowProductPanel(false);
    setExpandedParents({});
    setExpandedComboRows({});
    setSelectedCustomer(null);
    setPriceType('retail');
    setVatPercent(0);
    setDiscountAmount(0);
    setDeliveryFee(0);
    setPaidAmount(0);
    setPaymentMethod('cash');
    setTag('');
    setNote('');
    setSplitLine(false);
    setDeliveryDate('');
    setInvoiceWriter(user?.name || '');
    setReceiverName('');
  };

  return (
    <div className="sapo-screen sapo-create-order-page">
      <style>{`@keyframes slideUp{from{transform:translateY(120%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      {stockToast && (
        <div className="toast-stack">
          <div className="toast-card border-red-200 bg-red-50 text-red-700">
            ⚠️ {stockToast.message}
          </div>
        </div>
      )}

      {negativeStockSettingsError && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          {negativeStockSettingsError} Frontend đang dùng cấu hình an toàn: tồn kho không được nhỏ hơn {negativeStockRuntimeLimitLabel}.
        </div>
      )}

      {/* ===== HEADER ===== */}
      <div className="sapo-topbar">
        <h1 className="sapo-page-title">
          {editingInvoiceId ? 'Sửa đơn hàng' : 'Tạo đơn hàng'}
        </h1>
        <div className="sapo-actions">
          {lastInvoice && !editingInvoiceId && !lastInvoice.id && (
            <button
              onClick={handleStartEdit}
              className="sapo-btn">
              Sửa đơn hàng
            </button>
          )}
          {editingInvoiceId && (
            <button
              onClick={resetForm}
              className="sapo-btn">
              Hủy sửa
            </button>
          )}
          <button
            onClick={resetForm}
            className="sapo-btn">
            Thoát
          </button>
          {editingInvoiceId ? (
            <button
              onClick={handleSaveEdit}
              disabled={cart.length === 0 || creating || hasCartStockError}
              className="sapo-btn sapo-btn-primary">
              {creating ? ' Đang lưu...' : 'Lưu thay đổi'}
            </button>
          ) : (
            <button
              onClick={handleCreateOrder}
              disabled={cart.length === 0 || creating || hasCartStockError}
              className="sapo-btn sapo-btn-primary">
              {creating ? ' Đang tạo...' : 'Tạo đơn hàng (F1)'}
            </button>
          )}
        </div>
      </div>

      {/* ===== MAIN LAYOUT ===== */}
      <div className="sapo-shell grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">

        {/* ===== CONTENT: Khách hàng + Sản phẩm ===== */}
        <div className="flex flex-col gap-4 min-w-0">

          {/* Thông tin khách hàng */}
          <div className="sapo-card">
            <div className="sapo-card-header">
              <span>Thông tin khách hàng</span>
            </div>
            <div className="p-3 space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input className="input-field pl-9 w-full text-sm"
                    placeholder="Tìm theo tên, SĐT, mã khách hàng ... (F4)"
                    value={customerSearch}
                    onFocus={() => setShowCustomerDropdown(true)}
                    onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDropdown(true); }} />
                </div>
                <button onClick={() => setShowCustomerForm(true)}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium flex items-center gap-1 shrink-0">
                  <UserPlus size={14} /> + Thêm KH
                </button>
              </div>

              {/* Form thêm khách hàng nhanh */}
              {showCustomerForm && (
                <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-700 flex items-center gap-1"><Users size={13} /> Thêm khách hàng mới</span>
                    <button onClick={() => { setShowCustomerForm(false); setNewCustomer({ name: '', phone: '', email: '', tax_code: '', customer_type: 'Khách lẻ' }); }}
                      className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input className="input-field text-sm" placeholder="Tên khách hàng *" value={newCustomer.name}
                      onChange={e => setNewCustomer(c => ({ ...c, name: e.target.value }))} />
                    <input className="input-field text-sm" placeholder="SĐT" value={newCustomer.phone}
                      onChange={e => setNewCustomer(c => ({ ...c, phone: e.target.value }))} />
                    <input className="input-field text-sm" placeholder="Email" value={newCustomer.email}
                      onChange={e => setNewCustomer(c => ({ ...c, email: e.target.value }))} />
                    <select className="input-field text-sm" value={newCustomer.customer_type}
                      onChange={e => setNewCustomer(c => ({ ...c, customer_type: e.target.value }))}>
                      <option value="Khách lẻ">Khách lẻ</option>
                      <option value="Khách sỉ">Khách sỉ</option>
                      <option value="VIP">VIP</option>
                    </select>
                  </div>
                  <button onClick={handleAddCustomer}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold">
                     Lưu &amp; Chọn
                  </button>
                </div>
              )}

              <div ref={customerDropdownRef}>
                {(customerSearch || showCustomerDropdown) && filteredCustomers.length > 0 && (
                  <div className="mt-1 border rounded-lg shadow-lg max-h-40 overflow-auto text-sm">
                    {filteredCustomers.slice(0, 10).map(c => (
                      <button key={c.id}
                        onClick={() => {
                          setSelectedCustomer(c);
                          setCustomerSearch('');
                          setShowCustomerDropdown(false);
                          // Tự động chọn loại giá theo loại khách hàng
                          const newPriceType = customerTypeToPriceType(c.customer_type);
                          // Cập nhật giá trong giỏ nếu có sản phẩm/combo
                          applyPriceTypeToCart(newPriceType);
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b last:border-b-0">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-gray-400">{c.phone} · {c.customer_type}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedCustomer ? (
                <div className="mt-2 p-3 bg-blue-50 rounded-lg border border-blue-200 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-semibold text-sm">{selectedCustomer.name}</div>
                    <div className="text-xs text-gray-500">{selectedCustomer.phone} | {selectedCustomer.email || '—'}</div>
                    <div className="text-xs text-blue-600 font-medium">{selectedCustomer.customer_type}</div>
                  </div>
                  <button onClick={() => {
                    setSelectedCustomer(null);
                    // Khi bỏ chọn khách → quay về giá lẻ
                    applyPriceTypeToCart('retail');
                  }} className="text-red-400 hover:text-red-600 text-xs">✕ Bỏ chọn</button>
                </div>
              ) : (
                <div className="sapo-muted-empty">
                  <Users size={44} className="text-gray-200" />
                  {loadError.customers ? 'Không tải được khách hàng' : 'Chưa có thông tin khách hàng'}
                </div>
              )}
            </div>
          </div>

          {/* Thông tin sản phẩm */}
          <div className="sapo-card flex-1">
            <div className="sapo-card-header flex-col items-start lg:flex-row lg:items-center">
              <span>Thông tin sản phẩm</span>
              <div className="flex flex-wrap items-center gap-2 lg:gap-3 text-xs text-gray-500">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={splitLine} onChange={e => setSplitLine(e.target.checked)} className="accent-blue-600" />
                  Tách dòng
                </label>
                <button onClick={() => setShowNewProductForm(true)} className="hover:text-blue-600 flex items-center gap-1">
                  <Plus size={13} /> Thêm sản phẩm khác
                </button>
                <button className="hover:text-blue-600 flex items-center gap-1">Kiểm tra tồn kho</button>
              </div>
            </div>

            {/* Search row */}
            <div className="p-3 border-b flex flex-col gap-2 bg-white 2xl:flex-row 2xl:items-center">
              <div className="flex-1 relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input ref={productSearchInputRef} className="input-field pl-9 w-full text-sm"
                  placeholder="Tìm sản phẩm/variant theo tên... Chọn tab Combo để tìm combo (F3)"
                  value={productSearch}
                  onFocus={handleProductSearchFocus}
                  onClick={handleProductSearchFocus}
                  onKeyDown={handleProductSearchKeyDown}
                  onChange={handleProductSearchChange} />
              </div>
              <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 2xl:w-auto 2xl:flex 2xl:flex-wrap 2xl:items-center 2xl:justify-end">
                {selectedCustomer ? (
                  <span className={`order-toolbar-pill border ${customerTypeToPriceType(selectedCustomer.customer_type) === 'wholesale'
                    ? 'bg-orange-100 text-orange-700 border-orange-300'
                    : customerTypeToPriceType(selectedCustomer.customer_type) === 'vip'
                      ? 'bg-purple-100 text-purple-700 border-purple-300'
                      : 'bg-blue-100 text-blue-700 border-blue-300'
                    }`}>
                    {selectedCustomer.customer_type || 'Khách lẻ'}
                  </span>
                ) : (
                  Object.entries(PRICE_LABELS).map(([k, v]) => (
                    <button key={k} onClick={() => applyPriceTypeToCart(k)}
                      className={`order-toolbar-pill border transition ${priceType === k ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-blue-400'}`}>
                      {v}
                    </button>
                  ))
                )}
                <button
                  onClick={openOrderProductPicker}
                  className="order-toolbar-pill bg-blue-600 hover:bg-blue-700 text-white">
                  <Plus size={12} /> Chọn nhanh
                </button>
                <button className="order-toolbar-pill border border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600">
                  <Filter size={12} /> Lọc
                </button>
              </div>
            </div>

            {/* Product grid when searching */}
            {(showProductSearchResults || productSearch) && (
              <div className="p-3 border-b bg-blue-50">
                <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                  {[
                    ['all', `Tất cả sản phẩm thường (${allResultCount})`],
                    ['product', `Sản phẩm (${productResultCount})`],
                    ['combo', `Combo (${comboResultCount})`],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => handleProductResultFilterChange(key)}
                      className={`px-3 py-1.5 rounded-full border font-medium ${productResultFilter === key ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-blue-400'}`}
                    >
                      {label}
                    </button>
                  ))}
                  {resultLoading && <span className="text-blue-500">Đang tải dữ liệu...</span>}
                  {resultLoadError && <span className="text-red-500">Có dữ liệu chưa tải được</span>}
                </div>
                <div className="grid gap-3">
                  <div className="space-y-1 min-h-72 max-h-[62vh] overflow-auto scroll-smooth rounded-lg border border-blue-100 bg-white/70 p-2 pr-1">
                    {visibleFilteredCombos.map(combo => (
                    <div
                      key={`combo-search-${combo.id}`}
                      className="cursor-pointer border rounded-lg p-3 hover:border-purple-500 hover:shadow-sm bg-purple-50"
                      onClick={() => addSearchResultToOrder(combo, 'combo')}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-600 text-white font-bold">Combo</span>
                            <div className="text-xs font-semibold text-purple-900">{combo.name}</div>
                          </div>
                          <div className="text-[10px] text-purple-500 truncate mt-0.5">{getComboItemSummary(combo)}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
                          <div className="text-[10px] text-gray-500">Combo</div>
                          <div className="text-xs font-bold text-purple-700 whitespace-nowrap">{formatVND(getComboPrice(combo))}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {selectableProductRows.map(item => {
                    const isVariant = Boolean(item._isVariantOption || item.is_variant);
                    const parent = item.parent || null;
                    const displayName = isVariant ? getProductDisplayName(item, parent) : getProductDisplayName(item);
                    const categoryName = isVariant ? (getCategoryName(item) || getCategoryName(parent)) : getCategoryName(item);
                    const supplierName = isVariant ? getSupplierName(item.supplier_id || parent?.supplier_id) : getSupplierName(item.supplier_id);
                    const stockMeta = getStockDisplayMeta(item.stock, negativeStockSettings);

                    return (
                      <div
                        key={`search-${item._rowKey}`}
                        className={`cursor-pointer border rounded-lg p-3 ${isVariant ? 'hover:border-blue-500' : 'hover:border-green-500'} hover:shadow-sm ${stockMeta.cardClass}`}
                        onClick={() => addSearchResultToOrder(item, 'product')}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {isVariant && <span className="text-gray-300 shrink-0">⊙</span>}
                            <div className={`flex-1 min-w-0 ${stockMeta.isNegative || stockMeta.isNearLimit ? stockMeta.nameClass : (isVariant ? 'text-blue-600' : 'text-gray-800')}`}>
                              <div className="text-xs font-medium flex items-center gap-2">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${isVariant ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{isVariant ? 'Variant' : 'Sản phẩm'}</span>
                                <span className="min-w-0">{displayName}</span>
                              </div>
                              {isVariant && parent?.name && <div className="text-[10px] text-blue-500 truncate">Thuộc: {parent.name}</div>}
                              <div className="text-[10px] text-gray-400 truncate">{categoryName} · {supplierName}</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
                            <div className={`text-[10px] ${stockMeta.textClass}`}>{stockMeta.display}</div>
                            {stockMeta.isNegative && <div className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${stockMeta.badgeClass}`}>Âm kho</div>}
                            {stockMeta.isNearLimit && <div className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${stockMeta.extraBadgeClass || 'bg-orange-100 text-orange-800 border border-orange-200'}`}>{stockMeta.extraLabel || negativeStockNearLimitLabel}</div>}
                            <div className="text-xs font-bold text-blue-600 whitespace-nowrap">{formatVND(getPrice(item))}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                    {(() => {
                      return selectableProductRows.length === 0 && visibleFilteredCombos.length === 0 && !resultLoading && (
                        <div className="text-center text-gray-400 py-6 text-sm">
                          {emptyProductResultMessage}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* Product table */}
            <div className="border-b bg-white px-3 py-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs font-bold text-gray-700">Danh sách sản phẩm / dịch vụ vừa chọn</div>
                <div className="text-[11px] font-semibold text-gray-500">
                  {cart.length.toLocaleString('vi-VN')} dòng · {cart.reduce((s, i) => s + (Number(i.quantity) || 0), 0).toLocaleString('vi-VN')} số lượng · sửa số lượng, giá và chiết khấu trực tiếp trong bảng
                </div>
              </div>
            </div>
            <div className="system-table-scroll">
              <table className="system-table pos-order-table text-sm">
                <colgroup>
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '42%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '3%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="text-center">STT</th>
                    <th className="text-left">Tên sản phẩm / dịch vụ</th>
                    <th className="text-center">Số lượng</th>
                    <th className="text-right">Đơn giá</th>
                    <th className="text-center">Chiết khấu</th>
                    <th className="text-right">Thành tiền</th>
                    <th className="text-center">Xóa</th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item, idx) => {
                    const rowKey = getCartRowKey(item, idx);
                    const isCombo = isComboOrderItem(item);
                    const isService = isServiceOrderItem(item);
                    const comboItems = getComboLineItems(item);
                    const isExpanded = Boolean(expandedComboRows[rowKey]);
                    const stockState = getSaleStockStateForLine(cartStockValidation, item);
                    const rowProjectedStockValue = Number.isFinite(Number(stockState?.projectedStock)) ? Number(stockState.projectedStock) : NaN;
                    const rowProjectedStockNegative = Number.isFinite(rowProjectedStockValue) && rowProjectedStockValue < 0;
                    const rowStockInvalid = Boolean(stockState?.invalid);
                    const rowNearLimit = Boolean(stockState?.nearLimit);

                    return (
                      <Fragment key={rowKey}>
                        <tr className={`align-middle ${isService ? 'bg-sky-50/40 ring-1 ring-sky-400' : rowStockInvalid ? 'bg-red-50 ring-1 ring-red-200' : rowNearLimit ? 'bg-orange-50' : rowProjectedStockNegative ? 'bg-red-50/60' : ''}`}>
                          <td className="text-center text-gray-500 font-medium">{idx + 1}</td>
                          <td>
                            <div className="font-medium flex items-center gap-1 min-w-0">
                              {isCombo && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleComboRow(rowKey);
                                  }}
                                  className="w-5 h-5 rounded-full border border-purple-200 bg-purple-50 text-purple-600 hover:bg-purple-100 hover:border-purple-300 flex items-center justify-center shrink-0"
                                  title={isExpanded ? 'Thu gọn thành phần combo' : 'Mở thành phần combo'}
                                  aria-label={isExpanded ? 'Thu gọn thành phần combo' : 'Mở thành phần combo'}
                                >
                                  {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                </button>
                              )}
                              {isCombo && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-bold shrink-0">Combo</span>}
                              {isService && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-bold shrink-0">Dịch vụ</span>}
                              {isService ? (
                                <input
                                  type="text"
                                  value={getServiceLineName(item)}
                                  ref={(node) => {
                                    if (node) serviceNameInputRefs.current[item.id] = node;
                                    else delete serviceNameInputRefs.current[item.id];
                                  }}
                                  onChange={e => updateCartItem(item.id, 'service_name', e.target.value)}
                                  className="min-w-[220px] max-w-full flex-1 rounded border border-sky-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                                  placeholder="Tên dịch vụ"
                                />
                              ) : (
                                <span className="pos-product-name-wrap">{getProductDisplayName(item)}</span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-400">{isService ? 'Dịch vụ khác' : 'Sản phẩm đã chọn'}</div>
                            {isCombo && (
                              <div className="text-[10px] text-purple-500 mt-0.5 truncate max-w-xs">{getComboItemSummary(item)}</div>
                            )}
                            {!isCombo && !isService && Number.isFinite(Number(rowProjectedStockValue)) && (
                              <div className={`text-xs font-semibold mt-0.5 ${rowStockInvalid ? 'text-red-600' : rowNearLimit ? 'text-orange-700' : rowProjectedStockNegative ? 'text-red-500' : 'text-gray-500'}`}>
                                Dự kiến {formatStockValue(rowProjectedStockValue)}{rowStockInvalid ? ` · ${stockState?.message || negativeStockLimitMessage}` : rowNearLimit ? ` · ${negativeStockNearLimitLabel || `gần ngưỡng ${negativeStockRuntimeLimitLabel}`}` : rowProjectedStockNegative ? ' · âm kho theo cài đặt backend' : ''}
                              </div>
                            )}
                          </td>
                          <td>
                            <input type="number" min={MIN_QUANTITY} step={QUANTITY_STEP} inputMode="decimal"
                              value={item.quantity}
                              onChange={e => updateCartItem(item.id, 'quantity', e.target.value)}
                              className={`pos-table-input text-center ${rowStockInvalid ? 'bg-red-100 text-red-700 border-red-300' : rowNearLimit ? 'bg-orange-50 text-orange-700 border-orange-300' : rowProjectedStockNegative ? 'bg-red-50 text-red-700 border-red-200' : ''}`} />
                          </td>
                          <td>
                            <input type="number" min="0"
                              value={item.unit_price}
                              onChange={e => updateCartItem(item.id, 'unit_price', +e.target.value)}
                              className="pos-table-input text-right" />
                          </td>
                          <td>
                            <input type="number" min="0" max="100"
                              value={item.discount_percent}
                              onChange={e => updateCartItem(item.id, 'discount_percent', +e.target.value)}
                              className="pos-table-input text-center" />
                          </td>
                          <td className="font-semibold text-blue-700">
                            {formatVND(item.line_total)}
                          </td>
                          <td>
                            <button onClick={() => removeCartItem(item.id)} className="action-icon-btn text-red-500 hover:text-red-700 hover:bg-red-50" title={isService ? 'Xóa dịch vụ' : 'Xóa sản phẩm'}>
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                        {isCombo && isExpanded && (
                          <tr className="bg-purple-50/60 border-b border-purple-100 text-xs">
                            <td colSpan={7}>
                              <div className="border-l-2 border-purple-200 pl-3 space-y-1">
                                {comboItems.length > 0 ? comboItems.map((comboItem, childIdx) => (
                                  <div key={`${rowKey}_child_${comboItem.id || comboItem.product_id || comboItem.variant_id || childIdx}`} className="flex items-center justify-between gap-3 rounded border border-purple-100 bg-white px-3 py-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-[10px] font-bold shrink-0">{childIdx + 1}</span>
                                      <div className="min-w-0">
                                        <div className="font-medium text-gray-700 truncate">{getComboChildName(comboItem)}</div>
                                      </div>
                                    </div>
                                    <div className="text-purple-700 font-semibold whitespace-nowrap">SL combo: {getComboChildQuantity(comboItem)}</div>
                                  </div>
                                )) : (
                                  <div className="rounded border border-dashed border-purple-200 bg-white px-3 py-2 text-purple-500">
                                    Chưa có dữ liệu thành phần combo để hiển thị.
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {cart.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center text-gray-400 py-12">
                        <Package size={46} className="mx-auto mb-3 text-gray-200" />
                        <div className="mb-3">Chưa có thông tin sản phẩm / dịch vụ</div>
                        <button onClick={openOrderProductPicker}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1">
                          <Plus size={13} /> Thêm sản phẩm
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-100 bg-white px-3 py-2">
              <button
                type="button"
                onPointerDown={handleAddServicePointerDown}
                onClick={handleAddServiceClick}
                className="inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-sm font-semibold text-sky-700 hover:bg-sky-50"
              >
                <Plus size={16} /> Thêm dịch vụ khác (F9)
              </button>
            </div>
            {/* Full product panel */}
            {false && showProductPanel && (
              <div className="p-3 border-t bg-blue-50">
                <div className="flex flex-col gap-2 mb-2 lg:flex-row">
                  <div className="flex-1 relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input ref={productSearchInputRef} className="input-field pl-9 w-full text-sm"
                      placeholder="Tìm sản phẩm/variant theo tên... Chọn tab Combo để tìm combo theo tên"
                      value={productSearch}
                      onFocus={handleProductSearchFocus}
                      onChange={e => setProductSearch(e.target.value)} />
                  </div>
                  {Object.entries(PRICE_LABELS).map(([k, v]) => (
                    <button key={k} onClick={() => setPriceType(k)}
                      className={`px-3 py-2 rounded text-xs font-medium border transition ${priceType === k ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                      {v}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                  {[
                    ['all', `Tất cả sản phẩm thường (${allResultCount})`],
                    ['product', `Sản phẩm (${productResultCount})`],
                    ['combo', `Combo (${comboResultCount})`],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => handleProductResultFilterChange(key)}
                      className={`px-3 py-1.5 rounded-full border font-medium ${productResultFilter === key ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-blue-400'}`}
                    >
                      {label}
                    </button>
                  ))}
                  {resultLoading && <span className="text-blue-500">Đang tải dữ liệu...</span>}
                  {resultLoadError && <span className="text-red-500">Có dữ liệu chưa tải được</span>}
                </div>
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-1 min-h-80 max-h-[68vh] overflow-auto scroll-smooth rounded-lg border border-blue-100 bg-white/70 p-2 pr-1">
                  {visibleFilteredCombos.map(combo => (
                    <div
                      key={`combo-panel-${combo.id}`}
                      className="border rounded-lg p-3 hover:border-purple-500 hover:shadow-sm bg-purple-50"
                      onClick={() => addOrderPickerSelection(combo, 'combo')}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-600 text-white font-bold">Combo</span>
                            <div className="text-xs font-semibold text-purple-900 truncate">{combo.name}</div>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                addOrderPickerSelection(combo, 'combo');
                              }}
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow hover:bg-emerald-700"
                              title="Thêm combo vào danh sách tạm"
                            >
                              <Plus size={15} />
                            </button>
                          </div>
                          <div className="text-[10px] text-purple-500 truncate mt-0.5">{getComboItemSummary(combo)}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
                          <div className="text-[10px] text-gray-500">Combo</div>
                          <div className="text-xs font-bold text-purple-700 whitespace-nowrap">{formatVND(getComboPrice(combo))}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {selectableProductRows.map(item => {
                    const isVariant = Boolean(item._isVariantOption || item.is_variant);
                    const parent = item.parent || null;
                    const displayName = isVariant ? getProductDisplayName(item, parent) : getProductDisplayName(item);
                    const categoryName = isVariant ? (getCategoryName(item) || getCategoryName(parent)) : getCategoryName(item);
                    const supplierName = isVariant ? getSupplierName(item.supplier_id || parent?.supplier_id) : getSupplierName(item.supplier_id);
                    const stockMeta = getStockDisplayMeta(item.stock, negativeStockSettings);

                    return (
                      <div
                        key={`panel-${item._rowKey}`}
                        className={`border rounded-lg p-3 ${isVariant ? 'hover:border-blue-500' : 'hover:border-green-500'} hover:shadow-sm ${stockMeta.cardClass}`}
                        onClick={() => addOrderPickerSelection(item, 'product')}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {isVariant && <span className="text-gray-300 shrink-0">⊙</span>}
                            <div className={`flex-1 min-w-0 ${stockMeta.isNegative || stockMeta.isNearLimit ? stockMeta.nameClass : (isVariant ? 'text-blue-600' : 'text-gray-800')}`}>
                              <div className="text-xs font-medium truncate flex items-center gap-2">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${isVariant ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{isVariant ? 'Variant' : 'Sản phẩm'}</span>
                                <span className="truncate">{displayName}</span>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    addOrderPickerSelection(item, 'product');
                                  }}
                                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow hover:bg-emerald-700"
                                  title="Thêm sản phẩm vào danh sách tạm"
                                >
                                  <Plus size={15} />
                                </button>
                              </div>
                              {isVariant && parent?.name && <div className="text-[10px] text-blue-500 truncate">Thuộc: {parent.name}</div>}
                              <div className="text-[10px] text-gray-400 truncate">{categoryName} · {supplierName}</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
                            <div className={`text-[10px] ${stockMeta.textClass}`}>{stockMeta.display}</div>
                            {stockMeta.isNegative && <div className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${stockMeta.badgeClass}`}>Âm kho</div>}
                            {stockMeta.isNearLimit && <div className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${stockMeta.extraBadgeClass || 'bg-orange-100 text-orange-800 border border-orange-200'}`}>{stockMeta.extraLabel || negativeStockNearLimitLabel}</div>}
                            <div className="text-xs font-bold text-blue-600 whitespace-nowrap">{formatVND(getPrice(item))}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                    {(() => {
                      return selectableProductRows.length === 0 && visibleFilteredCombos.length === 0 && !resultLoading && (
                        <div className="text-center text-gray-400 py-6 text-sm">
                          {emptyProductResultMessage}
                        </div>
                      );
                    })()}
                  </div>
                  {renderOrderPickerSelections('lg:sticky lg:top-3 self-start')}
                </div>
              </div>
            )}
          </div>

          {/* Tags + Ghi chú + Tổng tiền */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            {/* Trái: Tags + Ghi chú */}
            <div className="sapo-card p-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Tags</label>
                <input className="input-field w-full text-sm" placeholder="Nhập tag..."
                  value={tag} onChange={e => setTag(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Ghi chú đơn hàng</label>
                <textarea className="input-field w-full text-sm resize-none" rows={4}
                  placeholder="Ghi chú cho đơn hàng..."
                  value={note} onChange={e => setNote(e.target.value)} />
              </div>
            </div>

            {/* Phải: Tổng tiền */}
            <div className="sapo-card sapo-order-summary p-4 space-y-2 text-sm">
              <div className="flex justify-between items-center text-gray-600">
                <span>Tổng tiền ({cart.reduce((s, i) => s + (Number(i.quantity) || 0), 0).toLocaleString('vi-VN')} số lượng)</span>
                <span className="font-medium">{formatVND(subtotal)}</span>
              </div>
              <div className="flex justify-between items-center text-gray-600">
                <span className="flex items-center gap-1">
                  VAT
                  <input type="number" min="0" max="100" value={vatPercent}
                    onChange={e => setVatPercent(+e.target.value)}
                    className="w-12 text-center border rounded px-1 py-0.5 text-xs ml-1" />%
                </span>
                <span>{formatVND(vatAmount)}</span>
              </div>
              <div className="flex justify-between items-center text-gray-600">
                <span className="flex items-center gap-1">
                  Chiết khấu
                  <select value={deliveryFeeMode} onChange={e => setDeliveryFeeMode(e.target.value)}
                    className="border rounded px-1 py-0.5 text-xs ml-1">
                    <option value="absolute">VND</option>
                    <option value="percent">%</option>
                  </select>
                </span>
                <input type="number" min="0" value={discountAmount}
                  onChange={e => setDiscountAmount(+e.target.value)}
                  className="w-24 text-right border rounded px-2 py-0.5 text-xs" />
              </div>
              <div className="flex justify-between items-center text-gray-600">
                <span>Phí giao hàng</span>
                <input type="number" min="0" value={deliveryFee}
                  onChange={e => setDeliveryFee(+e.target.value)}
                  className="w-24 text-right border rounded px-2 py-0.5 text-xs" />
              </div>
              <div className="flex justify-between items-center text-gray-500 text-xs">
                <span>Mã giảm giá</span>
                <input className="w-28 text-right border rounded px-2 py-0.5 text-xs" placeholder="Nhập mã..." disabled />
              </div>
              <div className="border-t pt-2 mt-1">
                <div className="flex justify-between items-center font-bold text-base">
                  <span>Khách phải trả</span>
                  <span className="text-red-600 text-lg">{formatVND(grandTotal)}</span>
                </div>
              </div>
              <div className="flex justify-between items-center text-gray-600">
                <span>Khách đã thanh toán</span>
                <input type="number" min="0" value={paidAmount}
                  onChange={e => setPaidAmount(+e.target.value)}
                  className="w-28 text-right border rounded px-2 py-0.5 text-sm font-medium" />
              </div>
              <div className="flex justify-between items-center text-gray-600">
                <span>Còn phải trả</span>
                <span className={`font-semibold ${remainingAmount > 0 ? 'text-red-500' : 'text-green-600'}`}>
                  {formatVND(Math.max(0, remainingAmount))}
                </span>
              </div>
              {hasCartStockError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                  {cartStockValidation.summaryMessage || negativeStockLimitMessage}
                </div>
              )}
              <button
                onClick={editingInvoiceId ? handleSaveEdit : handleCreateOrder}
                disabled={cart.length === 0 || creating || hasCartStockError}
                className="sapo-btn sapo-btn-primary w-full mt-2">
                {creating ? (editingInvoiceId ? ' Đang lưu...' : ' Đang tạo...') : (editingInvoiceId ? ' Lưu thay đổi' : 'Tạo đơn hàng')}
              </button>
            </div>
          </div>
        </div>

        {/* ===== COL 3: Thông tin đơn hàng ===== */}
        <div className="flex flex-col gap-4 min-w-0">
          <div className="sapo-card h-fit xl:sticky xl:top-20">
            <div className="sapo-card-header">
              <span>Thông tin bổ sung</span>
              <span className="text-gray-400">⚙</span>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Bán tại</label>
                <input className="input-field w-full bg-gray-50" value={store?.name || 'Chi nhánh mặc định'} readOnly />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Bán bởi</label>
                <input className="input-field w-full" value={invoiceWriter} onChange={e => setInvoiceWriter(e.target.value)} placeholder="Tên nhân viên" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Nguồn</label>
                <select className="input-field w-full" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                  <option value="cash">Tại quầy</option>
                  <option value="bank">Chuyển khoản</option>
                  <option value="debt">Công nợ</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Hẹn giao</label>
                <input
                  type="date"
                  className="input-field w-full"
                  value={deliveryDate}
                  onChange={e => setDeliveryDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Ngày bán</label>
                <input className="input-field w-full bg-gray-50" value={saleDate} readOnly />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Người nhận</label>
                <input
                  className="input-field w-full"
                  value={receiverName}
                  onChange={e => setReceiverName(e.target.value)}
                  placeholder="Tên người nhận"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Trạng thái đơn</label>
                <div className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-3 py-2">
                  <span className="text-xs font-medium text-orange-700">{editingInvoiceId ? 'Đang chỉnh sửa' : 'Chờ xác nhận'}</span>
                  <span className="text-[10px] font-bold text-orange-600">{editingInvoiceId ? 'EDITING' : 'PENDING'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {renderOrderProductPickerModal()}

      {lastInvoice && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b bg-blue-50 flex items-center justify-between">
              <div>
                <div className="text-lg font-bold text-blue-800">Xem lại đơn hàng</div>
                <div className="text-xs text-blue-600">Kiểm tra lại thông tin, sau đó chọn in tạm tính hoặc in hóa đơn</div>
              </div>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="p-5 overflow-auto space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg border p-3 bg-gray-50">
                  <div className="text-xs text-gray-500">Mã đơn</div>
                  <div className="font-bold text-gray-800">{lastInvoice.invoice_code}</div>
                </div>
                <div className="rounded-lg border p-3 bg-gray-50">
                  <div className="text-xs text-gray-500">Khách hàng</div>
                  <div className="font-bold text-gray-800">{lastInvoice.customer_name}</div>
                </div>
                <div className="rounded-lg border p-3 bg-gray-50">
                  <div className="text-xs text-gray-500">Khách phải trả</div>
                  <div className="font-bold text-red-600">{formatVND(lastInvoice.total)}</div>
                </div>
              </div>

              <div className="border rounded-xl overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 text-xs border-b">
                      <th className="py-2 px-3 text-center w-12">STT</th>
                      <th className="py-2 px-3 text-left">Tên sản phẩm</th>
                      <th className="py-2 px-3 text-center w-24">Số lượng</th>
                      <th className="py-2 px-3 text-right w-32">Đơn giá</th>
                      <th className="py-2 px-3 text-right w-32">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(lastInvoice.cart || []).map((item, idx) => (
                      <tr key={`${item.id || item.product_id || 'review'}-${idx}`} className="border-b last:border-b-0">
                        <td className="py-2 px-3 text-center text-gray-500">{idx + 1}</td>
                        <td className="py-2 px-3">
                          <div className="font-medium text-gray-800">{getProductDisplayName(item)}</div>
                        </td>
                        <td className="py-2 px-3 text-center">{item.quantity}</td>
                        <td className="py-2 px-3 text-right">{formatVND(item.unit_price)}</td>
                        <td className="py-2 px-3 text-right font-semibold text-blue-700">{formatVND(item.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="px-5 py-4 border-t bg-gray-50 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={resetForm}
                className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium"
              >
                Đóng
              </button>
              <button
                onClick={() => openLastInvoicePrint('estimate')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold inline-flex items-center justify-center gap-2"
              >
                <FileText size={16} /> In tạm tính
              </button>
              <button
                onClick={() => openLastInvoicePrint('invoice')}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-bold inline-flex items-center justify-center gap-2"
              >
                <ReceiptText size={16} /> In hóa đơn
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== VARIANT PICKER MODAL ===== */}
      {
        showVariantPicker && (
          <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 overflow-y-auto p-3 sm:p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90dvh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b bg-gray-50 rounded-t-xl">
                <div>
                  <h3 className="font-bold text-gray-800">Chọn biến thể</h3>
                  <p className="text-xs text-gray-500">{showVariantPicker.name}</p>
                </div>
                <button onClick={() => setShowVariantPicker(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-2">
                {(showVariantPicker.variants || []).map(v => {
                  const stockMeta = getStockDisplayMeta(v.stock, negativeStockSettings);
                  return (
                  <div key={v.id} className={`flex flex-col gap-3 border rounded-lg p-3 hover:border-blue-400 sm:flex-row sm:items-center ${stockMeta.cardClass}`}>
                    <div className="flex-1 min-w-0">
                      <div className={`font-medium text-sm truncate ${stockMeta.isNegative || stockMeta.isNearLimit ? stockMeta.nameClass : 'text-gray-800'}`}>{getProductDisplayName(v, showVariantPicker)}</div>
                      <div className={`text-xs ${stockMeta.textClass}`}>{stockMeta.display}</div>
                      <div className="text-sm font-bold text-blue-600 mt-0.5">{formatVND(getPrice(v))}</div>
                    </div>
                    <div className="flex items-center gap-2 sm:shrink-0">
                      <input type="number" min={MIN_QUANTITY} step={QUANTITY_STEP} inputMode="decimal"
                        value={variantQty[v.id] || 1}
                        onChange={e => setVariantQty(q => ({ ...q, [v.id]: normalizeDecimalQuantity(e.target.value, 1) }))}
                        className="w-16 text-center border rounded px-2 py-1.5 text-sm font-medium" />
                      <button
                        onClick={() => { addVariantItem(v); setShowVariantPicker(null); }}
                        className="px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white">
                        + Thêm
                      </button>
                    </div>
                  </div>
                  );
                })}
                {(showVariantPicker.variants || []).length === 0 && (
                  <div className="text-center text-gray-400 py-8">Sản phẩm này không có biến thể</div>
                )}
              </div>
              <div className="px-5 py-4 border-t bg-gray-50 rounded-b-xl flex gap-2">
                <button onClick={() => setShowVariantPicker(null)}
                  className="flex-1 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* ===== NEW PRODUCT FORM MODAL ===== */}
      {
        showNewProductForm && (
          <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 overflow-y-auto p-3 sm:p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90dvh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-4 border-b bg-blue-50 rounded-t-xl">
                <div>
                  <h3 className="font-bold text-blue-800 flex items-center gap-2">
                    <Plus size={20} /> Thêm sản phẩm mới
                  </h3>
                  <p className="text-xs text-blue-500">Sản phẩm chưa có trong kho hàng</p>
                </div>
                <button onClick={() => { setShowNewProductForm(false); setNewProduct({ name: '', sku: '', import_price: '', wholesale_price: '', retail_price: '', vip_price: '', stock: '', unit: 'cái', category: '', default_category_id: '', supplier_id: '' }); }} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
              <div className="flex-1 overflow-auto p-5 space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Tên sản phẩm <span className="text-red-500">*</span></label>
                  <input className="input-field w-full" value={newProduct.name} onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))} placeholder="VD: Sản phẩm XYZ" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Mã sản phẩm</label>
                    <input className="input-field w-full bg-gray-100 text-gray-500 cursor-not-allowed" value={newProduct.sku} readOnly disabled placeholder="Tự sinh SP00001" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Giá nhập</label>
                    <input className="input-field w-full" type="number" min="0" value={newProduct.import_price} onChange={e => setNewProduct(p => ({ ...p, import_price: e.target.value }))} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Số lượng tồn</label>
                    <input
                      id="order-new-product-stock"
                      className={`input-field w-full ${newProductStockError ? 'border-red-300 bg-red-50 text-red-700' : ''}`}
                      type="number"
                      min="0"
                      step="1"
                      value={newProduct.stock}
                      onChange={e => setNewProduct(p => ({ ...p, stock: e.target.value }))}
                      placeholder="0"
                      aria-invalid={Boolean(newProductStockError)}
                    />
                    <div className={`mt-1 text-xs ${newProductStockError ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                      {newProductStockError || 'Tạo nhanh sản phẩm trong đơn chỉ nhận tồn kho không âm; xuất âm được cấu hình tại trang Cài đặt.'}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Đơn vị</label>
                    <input className="input-field w-full" value={newProduct.unit} onChange={e => setNewProduct(p => ({ ...p, unit: e.target.value }))} placeholder="VD: cái, hộp, thùng..." />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Danh mục mặc định</label>
                    <select className="input-field w-full" value={newProduct.default_category_id} onChange={e => {
                      const category = categories.find(c => String(c.id) === String(e.target.value));
                      setNewProduct(p => ({ ...p, default_category_id: e.target.value, category: category?.name || p.category }));
                    }}>
                      <option value="">-- Chọn danh mục --</option>
                      {categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.group_name ? ` (${c.group_name})` : ''}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Giá lẻ</label>
                    <input className="input-field w-full" type="number" min="0" value={newProduct.retail_price} onChange={e => setNewProduct(p => ({ ...p, retail_price: e.target.value }))} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Giá sỉ</label>
                    <input className="input-field w-full" type="number" min="0" value={newProduct.wholesale_price} onChange={e => setNewProduct(p => ({ ...p, wholesale_price: e.target.value }))} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Giá VIP</label>
                    <input className="input-field w-full" type="number" min="0" value={newProduct.vip_price} onChange={e => setNewProduct(p => ({ ...p, vip_price: e.target.value }))} placeholder="0" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Nhà cung cấp</label>
                  <select className="input-field w-full" value={newProduct.supplier_id} onChange={e => setNewProduct(p => ({ ...p, supplier_id: e.target.value }))}>
                    <option value="">-- Chọn nhà cung cấp --</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name} {s.phone ? `(${s.phone})` : ''}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="px-5 py-4 border-t bg-gray-50 rounded-b-xl flex flex-col sm:flex-row gap-2">
                <button onClick={() => { setShowNewProductForm(false); setNewProduct({ name: '', sku: '', import_price: '', wholesale_price: '', retail_price: '', vip_price: '', stock: '', unit: 'cái', category: '', default_category_id: '', supplier_id: '' }); }}
                  className="flex-1 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">
                  Hủy
                </button>
                <button onClick={handleAddNewProduct}
                  disabled={Boolean(newProductStockError)}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-bold">
                   Thêm vào đơn hàng
                </button>
              </div>
            </div>
          </div>
        )
      }

    </div>
  );
}
