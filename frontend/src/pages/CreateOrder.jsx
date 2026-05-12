import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../App';
import {
  Search, Plus, X, ShoppingCart, Trash2, ChevronDown, ChevronRight, Barcode, Filter, Layers, UserPlus, Users, Package, Settings2
} from 'lucide-react';
import { buildCategoriesById, filterProductTree, normalizeSearchText, getProductDisplayName, getProductVariants, getVariantIdentity } from '../utils/productSearch';
import InvoicePrintPreviewModal from '../components/InvoicePrintPreviewModal';
import { getDefaultPrintTemplate } from '../utils/printTemplateService';
import { createInvoicePrintData } from '../utils/invoicePrintData';
import { attachClientOrderMetadata, generateClientOrderId } from '../utils/clientOrderId';

const PRICE_LABELS = { retail: 'Lẻ', wholesale: 'Sỉ', vip: 'VIP' };
const PAYMENT_LABELS = { cash: 'Tiền mặt', bank: 'Chuyển khoản', debt: 'Công nợ' };
const PRINT_TYPE_OPTIONS = {
  sale_invoice: {
    type: 'sale_invoice',
    label: 'In hóa đơn',
    title: 'Hóa đơn bán hàng',
    description: 'Phiếu bán hàng chính thức, có đầy đủ thông tin thanh toán và tổng kết tiền.',
    paperSize: 'A4',
  },
  temporary_bill: {
    type: 'temporary_bill',
    label: 'In tạm tính',
    title: 'Phiếu tạm tính',
    description: 'Phiếu tạm tính để khách kiểm tra sản phẩm, số lượng và tổng tiền trước khi xác nhận in.',
    paperSize: 'A4',
  },
};
const createEmptyPrintPreviewState = () => ({
  open: false,
  type: '',
  title: '',
  subtitle: '',
  data: null,
  template: null,
  loading: false,
  error: '',
});
const COMBO_REFRESH_STALE_MS = 30 * 1000;

// Tạo 5 số ngẫu nhiên từ 1-9
const random5Digits = () => {
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += Math.floor(Math.random() * 9) + 1;
  }
  return result;
};

// Map customer_type → priceType key
const customerTypeToPriceType = (ct) => {
  const t = (ct || '').toLowerCase();
  if (t.includes('sỉ') || t.includes('wholesale')) return 'wholesale';
  if (t.includes('vip')) return 'vip';
  return 'retail';
};
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
function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n || 0);
}

const QUANTITY_STEP = 0.1;
const MIN_QUANTITY = 0.1;

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
  const preferred = Number(combo?.[`${currentPriceType}_price`]);
  if (Number.isFinite(preferred) && preferred > 0) return preferred;
  const retail = Number(combo?.retail_price);
  if (Number.isFinite(retail) && retail > 0) return retail;
  const wholesale = Number(combo?.wholesale_price);
  if (Number.isFinite(wholesale) && wholesale > 0) return wholesale;
  const vip = Number(combo?.vip_price);
  if (Number.isFinite(vip) && vip > 0) return vip;
  return 0;
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

function getComboChildSku(item) {
  return item?.sku || item?.product_sku || item?.variant_sku || item?.product?.sku || item?.variant?.sku || '';
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
  const [printChoiceOpen, setPrintChoiceOpen] = useState(false);
  const [printPreview, setPrintPreview] = useState(() => createEmptyPrintPreviewState());
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
  const [serverOnline, setServerOnline] = useState(true);
  const [pendingOrders, setPendingOrders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kha_pending_orders') || '[]'); }
    catch { return []; }
  });
  const [loadError, setLoadError] = useState({ products: false, customers: false, combos: false });
  const [loading, setLoading] = useState({ products: true, customers: true, combos: true });
  const [productResultFilter, setProductResultFilter] = useState('all');
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
  const comboLastFetchedAtRef = useRef(0);
  const comboFetchInFlightRef = useRef(null);

  const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
  const getCartRowKey = (item, idx) => String(item?.id ?? `${item?.combo_id || item?.product_id || 'row'}_${idx}`);
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
      fetch(`${API}/combos`).then(r => {
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
    return fetch(`${API}/store`, { signal: AbortSignal.timeout(5000) })
      .then(r => { setServerOnline(true); return true; })
      .catch(() => { setServerOnline(false); return false; });
  };

  // Thêm khách hàng mới từ form trong trang tạo đơn
  const handleAddCustomer = async () => {
    if (!newCustomer.name) { alert('Vui lòng nhập tên khách hàng!'); return; }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${API}/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCustomer),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      if (data.ok) {
        const full = { ...newCustomer, id: data.id };
        setCustomers(prev => [...prev, full]);
        setSelectedCustomer(full);
        setCustomerSearch('');
        setShowCustomerForm(false);
        setNewCustomer({ name: '', phone: '', email: '', tax_code: '', customer_type: 'Khách lẻ' });
      } else {
        alert(data.message || data.error || 'Lỗi khi thêm khách hàng!');
      }
    } catch {
      // ── OFFLINE: lưu local ──
      const offlineId = `OFF_CUST_${Date.now().toString(36).toUpperCase()}`;
      const offlineCust = { ...newCustomer, id: offlineId, _isOffline: true };
      const updated = [offlineCust, ...offlineCustomers].slice(0, 50);
      setOfflineCustomers(updated);
      localStorage.setItem('kha_offline_customers', JSON.stringify(updated));
      setCustomers(prev => [...prev, offlineCust]);
      setSelectedCustomer(offlineCust);
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

    loadJson('products', `${API}/products/all/with-variants`, setProducts);
    loadJson('customers', `${API}/customers`, setCustomers);
    fetchCombos({ force: true });

    Promise.race([
      fetch(`${API}/partners`).then(r => r.json()).then(d => { setSuppliers(Array.isArray(d) ? d : []); }),
      timeout(8000).catch(() => {})
    ]);
    Promise.race([
      fetch(`${API}/product-categories`).then(r => r.json()).then(d => { setCategories(Array.isArray(d) ? d : []); }),
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
    if (productResultFilter === 'combo') fetchCombos();
  };
  const filteredCustomers = customers.filter(c =>
    !customerSearch ||
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.phone || '').includes(customerSearch)
  );

  const subtotal = cart.reduce((s, i) => s + i.line_total, 0);

  // Lấy giá đúng theo loại khách hàng đã chọn
  const getPrice = (product) => {
    if (selectedCustomer) {
      const ct = (selectedCustomer.customer_type || 'Khách lẻ').toLowerCase();
      if (ct.includes('sỉ') || ct.includes('wholesale')) return product.wholesale_price || product.retail_price;
      if (ct.includes('vip')) return product.vip_price || product.retail_price;
    }
    // Mặc định theo priceType đang chọn
    return product[`${priceType}_price`] || product.retail_price;
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
    // Ưu tiên tìm trong biến thể
    for (const p of products) {
      const v = (p.variants || []).find(va => va.id === id);
      if (v) return v;
      if (p.id === id) return p;
    }
    return null;
  };

  // Thêm biến thể với số lượng
  const addVariantItem = (v) => {
    if (v.stock <= 0) return;
    const qty = clampDecimalQuantity(variantQty[v.id], v.stock, 1);
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
        if (newQty > v.stock) {
          alert(`Không đủ hàng!`);
          return prev;
        }
        return prev.map(c => c.product_id === v.id && c.unit_price === unit_price
          ? { ...c, quantity: newQty, line_total: newQty * c.unit_price - c.discount_amount }
          : c);
      } else {
        return [...prev, {
          id: Date.now() + Math.random(),
          product_id: v.id,
          variant_id: v.id,
          parent_id: showVariantPicker?.id || v.parent_id || v._parentId || null,
          parent_name: showVariantPicker?.name || v.parent_name || v.parent?.name || '',
          variant_name: v.name,
          product_name: displayName,
          product_sku: v.sku,
          name: displayName,
          sku: v.sku,
          quantity: qty, unit_price, discount_amount: 0, discount_percent: 0,
          line_total: qty * unit_price, max_stock: v.stock,
        }];
      }
    });
    setShowVariantPicker(false);
    setVariantQty({});
  };
  const vatAmount = subtotal * (vatPercent / 100);
  const discountVal = deliveryFeeMode === 'percent'
    ? subtotal * (discountAmount / 100)
    : discountAmount;
  const grandTotal = subtotal + vatAmount - discountVal + deliveryFee;
  const remainingAmount = Math.max(0, grandTotal - paidAmount);
  const changeAmount = Math.max(0, paidAmount - grandTotal);

  const addCombo = (combo) => {
    if (!combo?.id) return;
    const unit_price = getComboPrice(combo);
    const comboLineItems = getComboLineItems(combo).map(child => ({ ...child }));
    setCart(prev => {
      const existing = prev.find(c => c.type === 'combo' && Number(c.combo_id) === Number(combo.id) && c.unit_price === unit_price && !splitLine);
      if (existing) {
        const newQty = normalizeDecimalQuantity(existing.quantity + 1, 1);
        return prev.map(c => c.id === existing.id
          ? { ...c, quantity: newQty, line_total: newQty * c.unit_price - (c.discount_amount || 0) }
          : c);
      }
      return [...prev, {
        id: `combo_${combo.id}_${Date.now()}_${Math.random()}`,
        type: 'combo',
        item_type: 'combo',
        combo_id: combo.id,
        product_id: null,
        variant_id: null,
        product_name: combo.name || 'Combo',
        product_sku: combo.sku || '',
        name: combo.name || 'Combo',
        sku: combo.sku || '',
        quantity: 1,
        unit_price,
        discount_amount: 0,
        discount_percent: 0,
        line_total: unit_price,
        max_stock: null,
        items: comboLineItems,
        combo_items: comboLineItems,
      }];
    });
  };

  const addProduct = (product) => {
    if (product.stock <= 0) return;
    const unit_price = getPrice(product);
    const isVariant = Boolean(product.is_variant || product.parent_id || product._parentId || product.parent_name || product.parent?.name);
    const parentId = product.parent_id || product._parentId || product.parent?.id || null;
    const displayName = getProductDisplayName(product);
    setCart(prev => {
      const existing = prev.find(c => c.product_id === product.id && c.unit_price === unit_price && !splitLine);
      if (existing) {
        const newQty = normalizeDecimalQuantity(existing.quantity + 1, 1);
        if (newQty > product.stock) {
          alert(`Không đủ hàng! "${product.name}" chỉ còn ${product.stock}.`);
          return prev;
        }
        return prev.map(c => c.product_id === product.id && c.unit_price === unit_price && !splitLine
          ? { ...c, quantity: newQty, line_total: newQty * c.unit_price - c.discount_amount }
          : c);
      } else {
        return [...prev, {
          id: Date.now() + Math.random(),
          product_id: product.id,
          variant_id: isVariant ? product.id : null,
          parent_id: isVariant ? parentId : null,
          parent_name: isVariant ? (product.parent_name || product.parent?.name || '') : '',
          variant_name: isVariant ? product.name : '',
          product_name: displayName,
          product_sku: product.sku,
          name: displayName,
          sku: product.sku,
          quantity: 1,
          unit_price,
          discount_amount: 0,
          discount_percent: 0,
          line_total: unit_price,
          max_stock: product.stock,
        }];
      }
    });
  };

  const updateCartItem = (id, field, value) => {
    setCart(prev => prev.map(item => {
      if (item.id !== id) return item;
      if (field === 'quantity') {
        if (!isComboOrderItem(item) && item.max_stock !== null && item.max_stock !== undefined && value > (item.max_stock || 0)) {
          alert(`Số lượng vượt quá tồn kho! Tối đa: ${item.max_stock || 0}`);
          return item;
        }
        const newQty = normalizeDecimalQuantity(value, 1);
        return { ...item, quantity: newQty, line_total: newQty * item.unit_price - (item.discount_amount || 0) };
      }
      const updated = { ...item, [field]: value };
      if (field === 'unit_price') updated.unit_price = Math.max(0, value);
      if (field === 'discount_percent') {
        updated.discount_percent = Math.min(100, Math.max(0, value));
        updated.discount_amount = updated.quantity * updated.unit_price * updated.discount_percent / 100;
      }
      updated.line_total = updated.quantity * updated.unit_price - (updated.discount_amount || 0);
      return updated;
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

  // Thêm sản phẩm mới (chưa có trong hệ thống) vào giỏ hàng
  const handleAddNewProduct = async () => {
    if (!newProduct.name.trim()) {
      alert('Vui lòng nhập tên sản phẩm!');
      return;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);

      // Tạo sản phẩm mới qua API
      const res = await fetch(`${API}/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProduct.name.trim(),
          sku: newProduct.sku?.trim() || '',
          import_price: parseFloat(newProduct.import_price) || 0,
          wholesale_price: parseFloat(newProduct.wholesale_price) || 0,
          retail_price: parseFloat(newProduct.retail_price) || 0,
          vip_price: parseFloat(newProduct.vip_price) || 0,
          stock: parseInt(newProduct.stock) || 0,
          unit: newProduct.unit || 'cái',
          category: newProduct.category?.trim() || '',
          default_category_id: newProduct.default_category_id || null,
          supplier_id: newProduct.supplier_id ? parseInt(newProduct.supplier_id) : null,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json();

      if (data.ok) {
        // Thêm vào giỏ hàng ngay
        const productToAdd = {
          id: data.id,
          name: newProduct.name.trim(),
          sku: newProduct.sku?.trim() || '',
          import_price: parseFloat(newProduct.import_price) || 0,
          wholesale_price: parseFloat(newProduct.wholesale_price) || 0,
          retail_price: parseFloat(newProduct.retail_price) || 0,
          vip_price: parseFloat(newProduct.vip_price) || 0,
          stock: parseInt(newProduct.stock) || 0,
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
          product_sku: productToAdd.sku,
          quantity: 1,
          unit_price,
          discount_amount: 0,
          discount_percent: 0,
          line_total: unit_price,
          max_stock: productToAdd.stock,
        }]);
        // Reset form và đóng modal
        setShowNewProductForm(false);
        setNewProduct({
          name: '', sku: '', import_price: '', wholesale_price: '', retail_price: '', vip_price: '',
          stock: '', unit: 'cái', category: '', default_category_id: '', supplier_id: ''
        });
        alert('✅ Đã thêm sản phẩm mới vào đơn hàng!');
      } else {
        alert('Lỗi: ' + (data.error || 'Không rõ lỗi'));
      }
    } catch (err) {
      alert('Lỗi kết nối: ' + err.message);
    }
  };

  const handleCreateOrder = async () => {
    if (cart.length === 0) { alert('Chưa có sản phẩm nào!'); return; }
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
      details: cart.map(({ type, item_type, combo_id, product_id, variant_id, product_name, product_sku, name, sku, quantity, unit_price, discount_amount, discount_percent, line_total }) =>
        ({ type: type || item_type || 'product', item_type: item_type || type || 'product', combo_id: combo_id || null, product_id: product_id || null, variant_id: variant_id || null, product_name: product_name || name || '', product_sku: product_sku || sku || '', name: name || product_name || '', sku: sku || product_sku || '', quantity, unit_price, discount_amount, discount_percent, line_total })),
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

      setLastInvoice(inv);
      setEditingInvoiceId(null);
      setCreating(false);
      fetch(`${API}/products/all/with-variants`).then(r => r.json()).then(d => setProducts(d)).catch(() => { });
    };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${API}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (data.ok) {
        showSuccess(data.invoice_code, data.invoice_id || null, false);
        fetch(`${API}/products/all/with-variants`).then(r => r.json()).then(d => setProducts(d)).catch(() => { });
      } else {
        showSuccess(`LOCAL_${Date.now().toString(36).toUpperCase()}`, null, true);
      }
    } catch {
      showSuccess(`LOCAL_${Date.now().toString(36).toUpperCase()}`, null, true);
    }
  };

  const handleStartEdit = () => {
    if (!lastInvoice) return;
    setEditingInvoiceId(lastInvoice.id || null);
    setSelectedCustomer(lastInvoice.selectedCustomer || null);
    setCart((lastInvoice.cart || []).map((item, idx) => ({
      ...item,
      id: item.id || `${Date.now()}_${idx}`,
    })));
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
    if (cart.length === 0) { alert('Chưa có sản phẩm nào!'); return; }
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
      details: cart.map(({ type, item_type, combo_id, product_id, variant_id, product_name, product_sku, name, sku, quantity, unit_price, discount_amount, discount_percent, line_total }) => ({
        type: type || item_type || 'product',
        item_type: item_type || type || 'product',
        combo_id: combo_id || null,
        product_id: product_id || null,
        variant_id: variant_id || null,
        product_name: product_name || name || '',
        product_sku: product_sku || sku || '',
        name: name || product_name || '',
        sku: sku || product_sku || '',
        quantity,
        unit_price,
        discount_amount,
        discount_percent,
        line_total,
      })),
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${API}/invoices/${editingInvoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Không thể cập nhật đơn hàng');
      }

      const updatedInvoice = {
        id: editingInvoiceId,
        invoice_code: lastInvoice?.invoice_code || `HD-${editingInvoiceId}`,
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

      setLastInvoice(updatedInvoice);
      setEditingInvoiceId(null);
      setCreating(false);
      fetch(`${API}/products/all/with-variants`).then(r => r.json()).then(d => setProducts(d)).catch(() => { });
      window.dispatchEvent(new CustomEvent('kha-order-created', { detail: updatedInvoice }));
      alert('✅ Đã lưu thay đổi đơn hàng!');
    } catch (err) {
      setCreating(false);
      alert(err.message || 'Lỗi khi cập nhật đơn hàng');
    }
  };

  const resetForm = () => {
    setLastInvoice(null);
    setPrintChoiceOpen(false);
    setPrintPreview(createEmptyPrintPreviewState());
    setEditingInvoiceId(null);
    setCart([]);
    setProductSearch('');
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

  const handlePrint = () => {
    if (!lastInvoice) {
      alert('Không có dữ liệu hóa đơn để in.');
      return;
    }
    setPrintChoiceOpen(true);
  };

  const closePrintPreview = () => {
    setPrintPreview(createEmptyPrintPreviewState());
  };

  const handleSelectPrintType = async (type) => {
    if (!lastInvoice) {
      alert('Không có dữ liệu hóa đơn để in.');
      return;
    }

    const option = PRINT_TYPE_OPTIONS[type] || PRINT_TYPE_OPTIONS.sale_invoice;
    const invoiceSnapshot = lastInvoice;
    const previewTitle = `${option.title} ${invoiceSnapshot.invoice_code || ''}`.trim();

    setPrintChoiceOpen(false);
    setPrintPreview({
      ...createEmptyPrintPreviewState(),
      open: true,
      type: option.type,
      title: previewTitle,
      subtitle: option.description,
      loading: true,
    });

    try {
      const template = await getDefaultPrintTemplate({
        apiBase: API,
        type: option.type,
        paperSize: option.paperSize,
        fallbackPaperSize: option.paperSize,
      });
      const printData = createInvoicePrintData({
        store,
        invoice: invoiceSnapshot,
        customer: invoiceSnapshot.selectedCustomer,
        user: { id: user?.id, name: invoiceSnapshot.invoice_writer || user?.name || '' },
        items: invoiceSnapshot.cart,
        type: option.type,
      });
      setPrintPreview({
        open: true,
        type: option.type,
        title: previewTitle,
        subtitle: `${option.description} Kiểm tra đầy đủ thông tin đơn hàng, sản phẩm và tổng tiền trước khi bấm In.`,
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
    <div className="min-h-screen bg-gray-100 p-3 sm:p-4 pb-36 lg:pb-4">
      <style>{`@keyframes slideUp{from{transform:translateY(120%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>

      {/* ===== HEADER ===== */}
      <div className="flex flex-col gap-3 mb-3 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2 min-w-0">
          <ShoppingCart className="text-blue-600" size={24} />
          <span className="text-gray-800">Sản phẩm:</span>
          <span className="text-blue-600">{editingInvoiceId ? 'Sửa đơn hàng' : 'Tạo đơn hàng'}</span>
        </h1>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
          {lastInvoice && !editingInvoiceId && !lastInvoice.id && (
            <button
              onClick={handleStartEdit}
              className="px-3 sm:px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium">
              Sửa đơn hàng
            </button>
          )}
          {editingInvoiceId && (
            <button
              onClick={resetForm}
              className="px-3 sm:px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-medium">
              Hủy sửa
            </button>
          )}
          <button
            onClick={resetForm}
            className="px-3 sm:px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium">
            Thoát
          </button>
          {editingInvoiceId ? (
            <button
              onClick={handleSaveEdit}
              disabled={cart.length === 0 || creating}
              className="px-3 sm:px-5 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2">
              {creating ? '⏳ Đang lưu...' : 'Lưu thay đổi'}
            </button>
          ) : (
            <button
              onClick={handleCreateOrder}
              disabled={cart.length === 0 || creating}
              className="px-3 sm:px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2">
              {creating ? '⏳ Đang tạo...' : 'Tạo Đơn Hàng'}
            </button>
          )}
        </div>
      </div>

      {/* ===== MAIN LAYOUT ===== */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">

        {/* ===== CONTENT: Khách hàng + Sản phẩm ===== */}
        <div className="xl:col-span-2 flex flex-col gap-3 min-w-0">

          {/* Thông tin khách hàng */}
          <div className="bg-white rounded-lg shadow-sm border">
            <div className="px-4 py-3 border-b bg-gray-50 rounded-t-lg">
              <span className="font-semibold text-sm text-gray-700">Thông tin khách hàng</span>
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
                    💾 Lưu &amp; Chọn
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
                          setPriceType(newPriceType);
                          // Cập nhật giá trong giỏ nếu có sản phẩm/combo
                          setCart(prevCart => prevCart.map(item => {
                            if (item.type === 'combo') {
                              const combo = getComboById(item.combo_id);
                              if (!combo) return item;
                              const newPrice = getComboPriceValue(combo, newPriceType);
                              return {
                                ...item,
                                unit_price: newPrice,
                                line_total: item.quantity * newPrice - (item.discount_amount || 0)
                              };
                            }
                            const prod = getProductById(item.product_id);
                            if (!prod) return item;
                            const newPrice = prod[`${newPriceType}_price`] || prod.retail_price || 0;
                            return {
                              ...item,
                              unit_price: newPrice,
                              line_total: item.quantity * newPrice - (item.discount_amount || 0)
                            };
                          }));
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
                    setPriceType('retail');
                    setCart(prevCart => prevCart.map(item => {
                      if (item.type === 'combo') {
                        const combo = getComboById(item.combo_id);
                        if (!combo) return item;
                        const newPrice = getComboPriceValue(combo, 'retail');
                        return {
                          ...item,
                          unit_price: newPrice,
                          line_total: item.quantity * newPrice - (item.discount_amount || 0)
                        };
                      }
                      const prod = getProductById(item.product_id);
                      if (!prod) return item;
                      const newPrice = prod.retail_price || 0;
                      return {
                        ...item,
                        unit_price: newPrice,
                        line_total: item.quantity * newPrice - (item.discount_amount || 0)
                      };
                    }));
                  }} className="text-red-400 hover:text-red-600 text-xs">✕ Bỏ chọn</button>
                </div>
              ) : (
                <div className="mt-2 text-center text-gray-400 text-sm py-4">
                  <div className="text-3xl mb-1 opacity-30">👤</div>
                  {loadError.customers ? 'Không tải được khách hàng' : 'Chưa có thông tin khách hàng'}
                </div>
              )}
            </div>
          </div>

          {/* Thông tin sản phẩm */}
          <div className="bg-white rounded-lg shadow-sm border flex-1">
            <div className="px-4 py-3 border-b bg-gray-50 rounded-t-lg flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <span className="font-semibold text-sm text-gray-700">Thông tin sản phẩm</span>
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
            <div className="p-3 border-b flex flex-col gap-2 bg-gray-50 lg:flex-row lg:items-center">
              <div className="flex-1 relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input-field pl-9 w-full text-sm"
                  placeholder="Tìm sản phẩm/variant theo tên/SKU... Chọn tab Combo để tìm combo (F3)"
                  value={productSearch}
                  onFocus={handleProductSearchFocus}
                  onChange={e => setProductSearch(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-1">
                {selectedCustomer ? (
                  <span className={`px-3 py-2 rounded text-xs font-bold border ${(selectedCustomer.customer_type || '').toLowerCase().includes('sỉ') || (selectedCustomer.customer_type || '').toLowerCase().includes('wholesale')
                    ? 'bg-orange-100 text-orange-700 border-orange-300'
                    : (selectedCustomer.customer_type || '').toLowerCase().includes('vip')
                      ? 'bg-purple-100 text-purple-700 border-purple-300'
                      : 'bg-blue-100 text-blue-700 border-blue-300'
                    }`}>
                    {selectedCustomer.customer_type || 'Khách lẻ'}
                  </span>
                ) : (
                  Object.entries(PRICE_LABELS).map(([k, v]) => (
                    <button key={k} onClick={() => setPriceType(k)}
                      className={`px-3 py-2 rounded text-xs font-medium border transition ${priceType === k ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-blue-400'}`}>
                      {v}
                    </button>
                  ))
                )}
              </div>
              <button
                onClick={() => {
                  const nextShowProductPanel = !showProductPanel;
                  setShowProductPanel(nextShowProductPanel);
                  if (nextShowProductPanel && productResultFilter === 'combo') fetchCombos();
                }}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium flex items-center gap-1">
                <Plus size={12} /> Chọn nhanh
              </button>
              <button className="px-3 py-2 border border-gray-300 rounded text-xs text-gray-600 hover:border-blue-400 hover:text-blue-600 flex items-center gap-1">
                <Filter size={12} /> Lọc
              </button>
            </div>

            {/* Product grid when searching */}
            {productSearch && (
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
                <div className="space-y-1 min-h-72 max-h-[62vh] overflow-auto rounded-lg border border-blue-100 bg-white/70 p-2 pr-1">
                  {visibleFilteredCombos.map(combo => (
                    <div
                      key={`combo-search-${combo.id}`}
                      className="border rounded-lg p-3 cursor-pointer hover:border-purple-500 hover:shadow-sm bg-purple-50"
                      onClick={() => {
                        addCombo(combo);
                        setProductSearch('');
                      }}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-600 text-white font-bold">Combo</span>
                            <div className="text-xs font-semibold text-purple-900 truncate">{combo.name}</div>
                          </div>
                          <div className="text-[10px] text-purple-500 truncate mt-0.5">{getComboItemSummary(combo)}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
                          <div className="text-[10px] text-gray-500">{combo.sku || '—'}</div>
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

                    return (
                      <div
                        key={`search-${item._rowKey}`}
                        className={`border rounded-lg p-3 cursor-pointer ${isVariant ? 'hover:border-blue-500' : 'hover:border-green-500'} hover:shadow-sm ${item.stock <= 0 ? 'opacity-50 bg-gray-50' : 'bg-white'}`}
                        onClick={() => {
                          if (item.stock > 0) {
                            addProduct(item);
                            setProductSearch('');
                          }
                        }}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {isVariant && <span className="text-gray-300 shrink-0">⊙</span>}
                            <div className={`flex-1 min-w-0 ${item.stock <= 0 ? 'text-red-500' : isVariant ? 'text-blue-600' : 'text-gray-800'}`}>
                              <div className="text-xs font-medium truncate flex items-center gap-2">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${isVariant ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{isVariant ? 'Variant' : 'Sản phẩm'}</span>
                                <span className="truncate">{displayName}</span>
                              </div>
                              {isVariant && parent?.name && <div className="text-[10px] text-blue-500 truncate">Thuộc: {parent.name}</div>}
                              <div className="text-[10px] text-gray-400 truncate">{categoryName} · {supplierName}</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
                            <div className="text-[10px] text-gray-400">SKU: {item.sku || '—'}</div>
                            {item.stock <= 0 ? (
                              <div className="text-[10px] text-red-500 font-bold">Hết hàng</div>
                            ) : (
                              <div className={`text-[10px] ${item.stock <= 3 ? 'text-red-500 font-bold' : 'text-gray-500'}`}>Còn: {item.stock}</div>
                            )}
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
            )}

            {/* Product table */}
            <div className="overflow-x-auto -mx-3 sm:mx-0">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="bg-gray-100 text-gray-600 text-xs border-b">
                    <th className="py-2 px-3 text-center w-10">STT</th>
                    <th className="py-2 px-3 text-center w-10">Ảnh</th>
                    <th className="py-2 px-3 text-left">Tên sản phẩm</th>
                    <th className="py-2 px-3 text-center w-16">Số lượng</th>
                    <th className="py-2 px-3 text-right w-28">Đơn giá</th>
                    <th className="py-2 px-3 text-center w-20">Chiết khấu</th>
                    <th className="py-2 px-3 text-right w-28">Thành tiền</th>
                    <th className="py-2 px-3 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item, idx) => {
                    const rowKey = getCartRowKey(item, idx);
                    const isCombo = isComboOrderItem(item);
                    const comboItems = getComboLineItems(item);
                    const isExpanded = Boolean(expandedComboRows[rowKey]);

                    return (
                      <Fragment key={rowKey}>
                        <tr className={`border-b hover:bg-gray-50 text-xs ${!isCombo && item.max_stock <= 0 ? 'bg-red-50' : ''}`}>
                          <td className="py-2 px-3 text-center text-gray-400">{idx + 1}</td>
                          <td className="py-2 px-3">
                            <div className="w-10 h-10 mx-auto rounded border bg-gray-50 text-gray-400 flex items-center justify-center">
                              <Package size={16} />
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-medium flex items-center gap-1">
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
                              {isCombo && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-bold">Combo</span>}
                              <span>{getProductDisplayName(item)}</span>
                            </div>
                            <div className="text-[10px] text-gray-400">{item.product_sku}</div>
                            {isCombo && (
                              <div className="text-[10px] text-purple-500 mt-0.5 truncate max-w-xs">{getComboItemSummary(item)}</div>
                            )}
                            {!isCombo && item.max_stock <= 0 && (
                              <div className="text-xs font-bold text-red-600 mt-0.5">⚠️ Hết hàng</div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input type="number" min={MIN_QUANTITY} step={QUANTITY_STEP} inputMode="decimal" max={isCombo ? undefined : item.max_stock}
                              value={item.quantity}
                              disabled={!isCombo && item.max_stock <= 0}
                              onChange={e => updateCartItem(item.id, 'quantity', e.target.value)}
                              className={`w-14 text-center border rounded px-1 py-1 text-sm ${!isCombo && item.max_stock <= 0 ? 'bg-red-100 text-red-400 border-red-200' : ''}`} />
                          </td>
                          <td className="py-2 px-3 text-right">
                            <input type="number" min="0"
                              value={item.unit_price}
                              onChange={e => updateCartItem(item.id, 'unit_price', +e.target.value)}
                              className="w-24 text-right border rounded px-2 py-1 text-sm" />
                          </td>
                          <td className="py-2 px-3 text-center">
                            <input type="number" min="0" max="100"
                              value={item.discount_percent}
                              onChange={e => updateCartItem(item.id, 'discount_percent', +e.target.value)}
                              className="w-14 text-center border rounded px-1 py-1 text-sm" />
                          </td>
                          <td className="py-2 px-3 text-right font-semibold text-blue-700">
                            {formatVND(item.line_total)}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button onClick={() => removeCartItem(item.id)} className="text-red-400 hover:text-red-600 p-1">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                        {isCombo && isExpanded && (
                          <tr className="bg-purple-50/60 border-b border-purple-100 text-xs">
                            <td colSpan={8} className="py-2 px-3">
                              <div className="ml-[104px] border-l-2 border-purple-200 pl-3 space-y-1">
                                {comboItems.length > 0 ? comboItems.map((comboItem, childIdx) => {
                                  const childSku = getComboChildSku(comboItem);
                                  return (
                                    <div key={`${rowKey}_child_${comboItem.id || comboItem.product_id || comboItem.variant_id || childIdx}`} className="flex items-center justify-between gap-3 rounded border border-purple-100 bg-white px-3 py-2">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-[10px] font-bold shrink-0">{childIdx + 1}</span>
                                        <div className="min-w-0">
                                          <div className="font-medium text-gray-700 truncate">{getComboChildName(comboItem)}</div>
                                          <div className="text-[10px] text-gray-400">{childSku ? `SKU: ${childSku}` : 'SKU: —'}</div>
                                        </div>
                                      </div>
                                      <div className="text-purple-700 font-semibold whitespace-nowrap">SL combo: {getComboChildQuantity(comboItem)}</div>
                                    </div>
                                  );
                                }) : (
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
                      <td colSpan={8} className="text-center text-gray-400 py-10">
                        <div className="text-4xl mb-2 opacity-20">📦</div>
                        <div className="mb-3">Chưa có thông tin sản phẩm</div>
                        <button onClick={() => setShowProductPanel(true)}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1">
                          <Plus size={13} /> Thêm sản phẩm
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Full product panel */}
            {showProductPanel && (
              <div className="p-3 border-t bg-blue-50">
                <div className="flex flex-col gap-2 mb-2 lg:flex-row">
                  <div className="flex-1 relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input className="input-field pl-9 w-full text-sm"
                      placeholder="Tìm sản phẩm/variant theo tên/SKU... Chọn tab Combo để tìm combo theo tên/SKU"
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
                <div className="space-y-1 min-h-80 max-h-[68vh] overflow-auto rounded-lg border border-blue-100 bg-white/70 p-2 pr-1">
                  {visibleFilteredCombos.map(combo => (
                    <div
                      key={`combo-panel-${combo.id}`}
                      className="border rounded-lg p-3 cursor-pointer hover:border-purple-500 hover:shadow-sm bg-purple-50"
                      onClick={() => {
                        addCombo(combo);
                        setShowProductPanel(false);
                        setProductSearch('');
                      }}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-600 text-white font-bold">Combo</span>
                            <div className="text-xs font-semibold text-purple-900 truncate">{combo.name}</div>
                          </div>
                          <div className="text-[10px] text-purple-500 truncate mt-0.5">{getComboItemSummary(combo)}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
                          <div className="text-[10px] text-gray-500">{combo.sku || '—'}</div>
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

                    return (
                      <div
                        key={`panel-${item._rowKey}`}
                        className={`border rounded-lg p-3 cursor-pointer ${isVariant ? 'hover:border-blue-500' : 'hover:border-green-500'} hover:shadow-sm ${item.stock <= 0 ? 'opacity-50 bg-gray-50' : 'bg-white'}`}
                        onClick={() => {
                          if (item.stock > 0) {
                            addProduct(item);
                            setShowProductPanel(false);
                            setProductSearch('');
                          }
                        }}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {isVariant && <span className="text-gray-300 shrink-0">⊙</span>}
                            <div className={`flex-1 min-w-0 ${item.stock <= 0 ? 'text-red-500' : isVariant ? 'text-blue-600' : 'text-gray-800'}`}>
                              <div className="text-xs font-medium truncate flex items-center gap-2">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0 ${isVariant ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{isVariant ? 'Variant' : 'Sản phẩm'}</span>
                                <span className="truncate">{displayName}</span>
                              </div>
                              {isVariant && parent?.name && <div className="text-[10px] text-blue-500 truncate">Thuộc: {parent.name}</div>}
                              <div className="text-[10px] text-gray-400 truncate">{categoryName} · {supplierName}</div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:gap-3 shrink-0">
                            <div className="text-[10px] text-gray-400">SKU: {item.sku || '—'}</div>
                            {item.stock <= 0 ? (
                              <div className="text-[10px] text-red-500 font-bold">Hết hàng</div>
                            ) : (
                              <div className={`text-[10px] ${item.stock <= 3 ? 'text-red-500 font-bold' : 'text-gray-500'}`}>Còn: {item.stock}</div>
                            )}
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
            )}
          </div>

          {/* Tags + Ghi chú + Tổng tiền */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* Trái: Tags + Ghi chú */}
            <div className="bg-white rounded-lg shadow-sm border p-4 space-y-3">
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
            <div className="bg-white rounded-lg shadow-sm border p-4 space-y-2 text-sm lg:static fixed inset-x-0 bottom-0 z-30 max-h-[48dvh] overflow-auto rounded-b-none lg:rounded-b-lg">
              <div className="flex justify-between items-center text-gray-600">
                <span>Tổng tiền ({cart.reduce((s, i) => s + i.quantity, 0)} sp)</span>
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
              <button
                onClick={editingInvoiceId ? handleSaveEdit : handleCreateOrder}
                disabled={cart.length === 0 || creating}
                className={`w-full mt-2 py-2.5 disabled:bg-gray-300 text-white rounded-lg font-bold text-sm flex items-center justify-center gap-2 ${editingInvoiceId ? 'bg-green-600 hover:bg-green-700' : 'bg-green-600 hover:bg-green-700'}`}>
                {creating ? (editingInvoiceId ? '⏳ Đang lưu...' : '⏳ Đang tạo...') : (editingInvoiceId ? '💾 Lưu thay đổi' : '🖨️ Tạo đơn hàng')}
              </button>
              {lastInvoice && (
                <button
                  onClick={handlePrint}
                  className="w-full mt-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm flex items-center justify-center gap-2">
                  In
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ===== COL 3: Thông tin đơn hàng ===== */}
        <div className="flex flex-col gap-3 min-w-0">
          <div className="bg-white rounded-lg shadow-sm border h-fit xl:sticky xl:top-4">
            <div className="px-4 py-3 border-b bg-gray-50 rounded-t-lg">
              <span className="font-semibold text-sm text-gray-700">Thông tin đơn hàng</span>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Ngày bán</label>
                <input className="input-field w-full bg-gray-50" value={saleDate} readOnly />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Ngày giao hàng</label>
                <input
                  type="date"
                  className="input-field w-full"
                  value={deliveryDate}
                  onChange={e => setDeliveryDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">Phương thức thanh toán</label>
                <select className="input-field w-full" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                  <option value="cash">Tiền mặt</option>
                  <option value="bank">Chuyển khoản</option>
                  <option value="debt">Công nợ</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Người nhập hàng</label>
                  <div className="text-[10px] text-gray-400 italic mb-1">(Ký và ghi rõ họ tên)</div>
                  <input className="input-field w-full" value={receiverName} onChange={e => setReceiverName(e.target.value)} placeholder="Tên người nhập hàng" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1">Bên giao hàng</label>
                  <div className="text-[10px] text-gray-400 italic mb-1">(Ký và ghi rõ họ tên)</div>
                  <input className="input-field w-full" value={invoiceWriter} onChange={e => setInvoiceWriter(e.target.value)} placeholder="Tên bên giao hàng" />
                </div>
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

      {lastInvoice && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b bg-blue-50 flex items-center justify-between">
              <div>
                <div className="text-lg font-bold text-blue-800">Xem lại đơn hàng</div>
                <div className="text-xs text-blue-600">Kiểm tra lại trước khi in hóa đơn</div>
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
                    {lastInvoice.cart.map((item, idx) => (
                      <tr key={item.id || idx} className="border-b last:border-b-0">
                        <td className="py-2 px-3 text-center text-gray-500">{idx + 1}</td>
                        <td className="py-2 px-3">
                          <div className="font-medium text-gray-800">{getProductDisplayName(item)}</div>
                          <div className="text-xs text-gray-400">{item.product_sku || '—'}</div>
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
                onClick={handlePrint}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold"
              >
                In
              </button>
            </div>
          </div>
        </div>
      )}

      {printChoiceOpen && lastInvoice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden">
            <div className="px-5 py-4 border-b bg-blue-50 flex items-center justify-between">
              <div>
                <div className="text-lg font-bold text-blue-800">Chọn loại phiếu cần in</div>
                <div className="text-xs text-blue-600">Bấm một lựa chọn để mở bản xem trước, chưa gọi in trình duyệt ở bước này.</div>
              </div>
              <button onClick={() => setPrintChoiceOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="p-5 grid grid-cols-1 gap-3">
              {Object.values(PRINT_TYPE_OPTIONS).map(option => (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => handleSelectPrintType(option.type)}
                  className="text-left rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 p-4 transition shadow-sm"
                >
                  <div className="font-bold text-gray-900">{option.label}</div>
                  <div className="text-sm text-gray-500 mt-1">{option.description}</div>
                  <div className="text-xs text-blue-600 font-medium mt-2">Mở màn hình xem trước trước khi in</div>
                </button>
              ))}
            </div>
            <div className="px-5 py-4 border-t bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={() => setPrintChoiceOpen(false)}
                className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium"
              >
                Hủy in
              </button>
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
        onBack={() => {
          closePrintPreview();
          if (lastInvoice) setPrintChoiceOpen(true);
        }}
        onClose={closePrintPreview}
      />

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
                {(showVariantPicker.variants || []).map(v => (
                  <div key={v.id} className={`flex flex-col gap-3 border rounded-lg p-3 hover:border-blue-400 bg-white sm:flex-row sm:items-center ${v.stock <= 0 ? 'opacity-50' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className={`font-medium text-sm truncate ${v.stock <= 0 ? 'text-red-500' : 'text-gray-800'}`}>{getProductDisplayName(v, showVariantPicker)}</div>
                      {v.stock <= 0 ? (
                        <div className="text-xs text-red-500 font-bold">Hết hàng</div>
                      ) : (
                        <div className={`text-xs ${v.stock <= 3 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>SKU: {v.sku || '—'} · Còn: {v.stock}</div>
                      )}
                      <div className="text-sm font-bold text-blue-600 mt-0.5">{formatVND(getPrice(v))}</div>
                    </div>
                    <div className="flex items-center gap-2 sm:shrink-0">
                      <input type="number" min={MIN_QUANTITY} step={QUANTITY_STEP} inputMode="decimal" max={v.stock}
                        value={variantQty[v.id] || 1}
                        onChange={e => setVariantQty(q => ({ ...q, [v.id]: clampDecimalQuantity(e.target.value, v.stock, 1) }))}
                        className="w-16 text-center border rounded px-2 py-1.5 text-sm font-medium" />
                      <button
                        onClick={() => { addVariantItem(v); setShowVariantPicker(null); }}
                        disabled={v.stock <= 0}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium ${v.stock <= 0 ? 'bg-gray-300 text-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                        {v.stock <= 0 ? 'Hết hàng' : '+ Thêm'}
                      </button>
                    </div>
                  </div>
                ))}
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
                    <label className="text-xs text-gray-500 block mb-1">Mã SKU</label>
                    <input className="input-field w-full" value={newProduct.sku} onChange={e => setNewProduct(p => ({ ...p, sku: e.target.value }))} placeholder="SP001" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Giá nhập</label>
                    <input className="input-field w-full" type="number" min="0" value={newProduct.import_price} onChange={e => setNewProduct(p => ({ ...p, import_price: e.target.value }))} placeholder="0" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Số lượng tồn</label>
                    <input className="input-field w-full" type="number" min="0" value={newProduct.stock} onChange={e => setNewProduct(p => ({ ...p, stock: e.target.value }))} placeholder="0" />
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
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold">
                  💾 Thêm vào đơn hàng
                </button>
              </div>
            </div>
          </div>
        )
      }

    </div>
  );
}
