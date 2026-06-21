import { useEffect, useMemo, useRef, useState } from 'react';
import { Package, Search, ChevronDown, ChevronRight, HelpCircle, ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';
import HelpModal from '../components/HelpModal';
import {
  buildCategoriesById,
  categoryFields,
  filterProductTree,
  findCategoryForProduct,
  firstNonEmpty,
  flattenProductTree,
  getProductVariants,
  normalizeProductTree,
  normalizeSearchText,
} from '../utils/productSearch';
import { apiJsonChecked } from '../utils/apiClient';
import { globalSyncEmitter } from '../utils/eventEmitter';
import { getNegativeStockLimitLabel, getNegativeStockNearLimitLabel, getStockDisplayMeta } from '../utils/negativeStock';
import useNegativeStockSettings from '../utils/useNegativeStockSettings';

const NEGATIVE_STOCK_PAGE_SIZE = 20;
const NEGATIVE_STOCK_REFRESH_INTERVAL_MS = 45000;
const STOCK_CHANGE_TABLES = ['products', 'import_logs', 'import_details', 'invoices', 'invoice_details'];

const INVENTORY_TABS = [
  { key: 'all', label: 'T?t c? s?n ph?m' },
  { key: 'in-stock', label: 'C?n h?ng' },
  { key: 'low-stock', label: 'S?p h?t h?ng' },
  { key: 'out-of-stock', label: 'H?t h?ng' },
  { key: 'negative', label: '?m kho' },
  { key: 'negative-quantity', label: 'S? lu?ng ?m' },
];

const NEGATIVE_STOCK_TAB_KEYS = new Set(['negative', 'negative-quantity']);

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n || 0);
}

function hasPrice(value) {
  return value !== undefined && value !== null && value !== '' && Number(value) > 0;
}

function formatOptionalVND(value) {
  return hasPrice(value) ? formatVND(value) : '?';
}

function getProductVariantCount(product) {
  const variants = getProductVariants(product);
  if (variants.length > 0) return variants.length;
  const count = Number(product?.variant_count ?? product?.variants_count ?? product?.variantCount ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function compactCategoryText(value) {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function categoryValuesMatch(a, b) {
  const normalizedA = normalizeSearchText(a);
  const normalizedB = normalizeSearchText(b);
  if (!normalizedA || !normalizedB) return false;

  const compactA = normalizedA.replace(/\s+/g, '');
  const compactB = normalizedB.replace(/\s+/g, '');
  return normalizedA === normalizedB
    || compactA === compactB
    || normalizedA.includes(normalizedB)
    || normalizedB.includes(normalizedA)
    || compactA.includes(compactB)
    || compactB.includes(compactA);
}

function isNegativeStockTabKey(key) {
  return NEGATIVE_STOCK_TAB_KEYS.has(key);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getRowStock(row) {
  const stock = Number(row?.stock ?? row?.on_hand ?? row?.inventory_quantity ?? row?.quantity ?? row?.qty);
  if (Number.isFinite(stock)) return stock;
  const negativeQuantity = Number(row?.negative_quantity ?? row?.negative_stock_quantity);
  return Number.isFinite(negativeQuantity) && negativeQuantity > 0 ? -Math.abs(negativeQuantity) : 0;
}

function getRowSku(row) {
  return firstNonEmpty(row?.sku, row?.product_sku, row?.productSku, row?.variant_sku, row?.variantSku, row?.barcode);
}

function getRowCode(row) {
  return firstNonEmpty(
    row?.code,
    row?.product_code,
    row?.productCode,
    row?.ma_san_pham,
    row?.ma_hang,
    row?.item_code,
    getRowSku(row),
  );
}

function getRowWarehouseId(row) {
  return firstNonEmpty(
    row?.warehouse_id,
    row?.warehouseId,
    row?.warehouse_info?.id,
    row?.store_id,
    row?.storeId,
    row?.branch_id,
    row?.branchId,
    row?.location_id,
    row?.locationId,
    row?.kho_id,
    row?.khoId,
  );
}

function getRowWarehouseCode(row) {
  return firstNonEmpty(
    row?.warehouse_code,
    row?.warehouseCode,
    row?.warehouse_info?.code,
    row?.store_code,
    row?.storeCode,
    row?.branch_code,
    row?.branchCode,
    row?.location_code,
    row?.locationCode,
    row?.kho_code,
    row?.khoCode,
  );
}

function getRowWarehouseName(row) {
  return firstNonEmpty(
    row?.warehouse_name,
    row?.warehouseName,
    row?.warehouse_info?.name,
    row?.warehouse,
    row?.store_name,
    row?.storeName,
    row?.branch_name,
    row?.branchName,
    row?.location_name,
    row?.locationName,
    row?.kho_name,
    row?.khoName,
    row?.kho,
  );
}

function getWarehouseDisplayName(row) {
  return getRowWarehouseName(row) || getRowWarehouseCode(row) || (getRowWarehouseId(row) ? `Kho #${getRowWarehouseId(row)}` : '?');
}

function buildWarehouseOption(row) {
  const id = getRowWarehouseId(row);
  const code = getRowWarehouseCode(row);
  const name = getRowWarehouseName(row);
  if (!id && !code && !name) return null;

  const label = name || code || `Kho #${id}`;
  const identity = firstNonEmpty(id, code, label);
  const normalizedIdentity = normalizeSearchText(identity).replace(/\s+/g, '');
  return {
    key: `warehouse:${normalizedIdentity || String(identity)}`,
    id,
    code,
    label,
    value: label,
  };
}

function warehouseMatchesOption(row, option) {
  if (!option || option.key === 'all') return true;

  const rowIds = [getRowWarehouseId(row), row?.warehouse_info?.id, row?.store_id, row?.branch_id, row?.location_id].filter(Boolean);
  const rowCodes = [getRowWarehouseCode(row), row?.warehouse_info?.code, row?.store_code, row?.branch_code, row?.location_code].filter(Boolean);
  if (option.id && rowIds.some(value => String(value).trim().toLowerCase() === String(option.id).trim().toLowerCase())) return true;
  if (option.code && rowCodes.some(value => String(value).trim().toLowerCase() === String(option.code).trim().toLowerCase())) return true;

  const optionText = normalizeSearchText([option.label, option.value, option.code, option.id].filter(Boolean).join(' '));
  const rowText = normalizeSearchText([
    getRowWarehouseId(row),
    getRowWarehouseCode(row),
    getRowWarehouseName(row),
    row?.warehouse_info?.source,
  ].filter(Boolean).join(' '));
  const compactOption = optionText.replace(/\s+/g, '');
  const compactRow = rowText.replace(/\s+/g, '');
  return Boolean(optionText && rowText && (rowText.includes(optionText) || optionText.includes(rowText) || compactRow.includes(compactOption) || compactOption.includes(compactRow)));
}

function normalizeNegativeStockRow(row = {}) {
  const stock = getRowStock(row);
  const isVariant = Boolean(row?.is_variant || row?.variant_id || row?.parent_id || row?.parent_name || row?.parent_sku);
  const sku = getRowSku(row);
  const code = getRowCode(row);
  const name = firstNonEmpty(row?.name, row?.product_name, row?.productName, row?.display_name, row?.displayName, row?.variant_name, row?.variantName, sku, code, 'S?n ph?m ?m kho');

  return {
    ...row,
    id: row?.id ?? row?.product_id ?? row?.variant_id ?? code ?? sku,
    product_id: row?.product_id ?? row?.id ?? null,
    name,
    product_name: firstNonEmpty(row?.product_name, row?.productName, name),
    sku,
    product_sku: firstNonEmpty(row?.product_sku, row?.productSku, sku),
    code,
    product_code: firstNonEmpty(row?.product_code, row?.productCode, code),
    category: firstNonEmpty(row?.category, row?.category_name, row?.categoryName),
    category_name: firstNonEmpty(row?.category_name, row?.categoryName, row?.category),
    warehouse_id: getRowWarehouseId(row),
    warehouse_name: getRowWarehouseName(row),
    warehouse_code: getRowWarehouseCode(row),
    warehouse: getWarehouseDisplayName(row),
    stock,
    negative_quantity: Math.abs(stock),
    negative_stock_quantity: Math.abs(stock),
    import_price: toNumber(row?.import_price ?? row?.cost ?? row?.cost_price, 0),
    retail_price: toNumber(row?.retail_price ?? row?.price ?? row?.sale_price ?? row?.selling_price, 0),
    wholesale_price: toNumber(row?.wholesale_price ?? row?.wholesalePrice ?? row?.price, 0),
    vip_price: toNumber(row?.vip_price ?? row?.vipPrice ?? row?.compare_at_price ?? row?.price, 0),
    status: row?.status || 'negative_stock',
    stock_status: row?.stock_status || 'negative_stock',
    inventory_status: row?.inventory_status || 'negative_stock',
    is_variant: isVariant,
    _isParent: !isVariant,
    parent: isVariant ? {
      id: row?.parent_id || null,
      name: row?.parent_name || '',
      sku: row?.parent_sku || '',
    } : null,
  };
}

function extractListFromResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.categories)) return data.categories;
  return [];
}

function getInventoryStatusKey(row) {
  const stock = getRowStock(row);
  if (stock < 0) return 'negative';
  if (stock === 0) return 'out-of-stock';
  if (stock < 5) return 'low-stock';
  return 'in-stock';
}

function rowMatchesStockTab(row, tabKey) {
  if (tabKey === 'all') return true;
  const hasVariants = row?._isParent && getProductVariantCount(row) > 0;
  if (hasVariants) return false;

  const statusKey = getInventoryStatusKey(row);
  if (tabKey === 'negative-quantity') return statusKey === 'negative';
  if (tabKey === 'in-stock') return getRowStock(row) > 0;
  return statusKey === tabKey;
}

function getInventoryStatusLabel(row, settings) {
  const meta = getStockDisplayMeta(getRowStock(row), settings);
  if (meta.isNegative || meta.isBreached) return '?m kho';
  if (meta.isNearLimit) return meta.extraLabel || 'G?n ngu?ng ?m';
  return meta.label || '?';
}

function sortRowsByStock(rows, direction) {
  if (!direction) return rows;
  const directionMultiplier = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const stockA = getRowStock(a);
    const stockB = getRowStock(b);
    return (stockA - stockB) * directionMultiplier || String(a?.name || '').localeCompare(String(b?.name || ''), 'vi');
  });
}

function detectChanges(oldList, newList) {
  const changes = [];
  const oldMap = {};
  const buildMap = (list) => {
    (list || []).forEach(p => {
      oldMap[`p-${p.id}`] = getRowStock(p);
      getProductVariants(p).forEach(v => { oldMap[`v-${v.id}`] = getRowStock(v); });
    });
  };
  buildMap(oldList);
  (newList || []).forEach(p => {
    const oldStock = oldMap[`p-${p.id}`] ?? -1;
    const newStock = getRowStock(p);
    if (oldStock >= 0 && newStock !== oldStock) {
      const diff = newStock - oldStock;
      changes.push(`${p.name}: ${oldStock} ? ${newStock} (${diff > 0 ? '+' + diff : diff})`);
    }
    getProductVariants(p).forEach(v => {
      const oldVs = oldMap[`v-${v.id}`] ?? -1;
      const newVs = getRowStock(v);
      if (oldVs >= 0 && newVs !== oldVs) {
        const diff = newVs - oldVs;
        changes.push(`${v.name}: ${oldVs} ? ${newVs} (${diff > 0 ? '+' + diff : diff})`);
      }
    });
  });
  return changes;
}

function StockBadge({ stock, settings }) {
  const meta = getStockDisplayMeta(stock, settings);
  const negativeBadgeClass = meta.isNegative || meta.isBreached
    ? 'bg-red-600 text-white border border-red-700 shadow-sm shadow-red-100'
    : meta.badgeClass;

  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span className={`inline-block font-bold px-2 py-0.5 rounded text-xs ${negativeBadgeClass}`}>{meta.display}</span>
      {(meta.isNegative || meta.isNearLimit || meta.isBreached) && (
        <span className={`inline-block font-extrabold tracking-wide px-2 py-0.5 rounded-full text-[10px] ${meta.isNearLimit && !meta.isBreached ? 'bg-orange-100 text-orange-800 border border-orange-200' : 'bg-red-600 text-white border border-red-700'}`}>
          {meta.isBreached ? 'VU?T NGU?NG' : '?M KHO'}
        </span>
      )}
      {meta.isNearLimit && <span className="text-[10px] font-semibold text-orange-700">{meta.extraLabel || getNegativeStockNearLimitLabel(settings)}</span>}
    </span>
  );
}

function StatusPill({ row, settings }) {
  const meta = getStockDisplayMeta(getRowStock(row), settings);
  const label = getInventoryStatusLabel(row, settings);
  const className = meta.isNegative || meta.isBreached
    ? 'bg-red-600 text-white border-red-700'
    : meta.isNearLimit
      ? 'bg-orange-100 text-orange-800 border-orange-200'
      : meta.badgeClass;

  return <span className={`inline-flex items-center justify-center rounded-full border px-2 py-1 text-[11px] font-bold ${className}`}>{label}</span>;
}

function LoadingSkeleton({ rows = 6 }) {
  return (
    <div className="divide-y divide-gray-100">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2 px-3 py-3 md:flex-nowrap md:py-2">
          <div className="h-4 w-8 rounded bg-gray-100 animate-pulse" />
          <div className="h-7 w-7 rounded-full bg-gray-100 animate-pulse" />
          <div className="min-w-[12rem] flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded bg-gray-100 animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-gray-100 animate-pulse" />
          </div>
          <div className="hidden h-4 w-32 rounded bg-gray-100 animate-pulse lg:block" />
          <div className="hidden h-4 w-36 rounded bg-gray-100 animate-pulse sm:block" />
          <div className="hidden h-4 w-32 rounded bg-gray-100 animate-pulse lg:block" />
          <div className="h-6 w-20 rounded bg-gray-100 animate-pulse" />
          <div className="hidden h-4 w-28 rounded bg-gray-100 animate-pulse md:block" />
          <div className="hidden h-4 w-28 rounded bg-gray-100 animate-pulse md:block" />
          <div className="hidden h-6 w-28 rounded-full bg-gray-100 animate-pulse xl:block" />
        </div>
      ))}
    </div>
  );
}

export default function KhoHang() {
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategoryKey, setSelectedCategoryKey] = useState('all');
  const [selectedWarehouseKey, setSelectedWarehouseKey] = useState('all');
  const [activeStockTab, setActiveStockTab] = useState('all');
  const [expandedProductIds, setExpandedProductIds] = useState(() => new Set());
  const [stockSortDirection, setStockSortDirection] = useState(null);
  const [negativeStockSortOrder, setNegativeStockSortOrder] = useState('asc');
  const [negativeStockRows, setNegativeStockRows] = useState([]);
  const [negativeStockLoading, setNegativeStockLoading] = useState(false);
  const [negativeStockError, setNegativeStockError] = useState('');
  const [negativeStockApiAvailable, setNegativeStockApiAvailable] = useState(false);
  const [negativeStockPage, setNegativeStockPage] = useState(1);
  const [negativeStockPagination, setNegativeStockPagination] = useState({
    page: 1,
    limit: NEGATIVE_STOCK_PAGE_SIZE,
    total: 0,
    total_pages: 0,
    has_next: false,
    has_prev: false,
  });
  const [negativeStockRefreshTick, setNegativeStockRefreshTick] = useState(0);
  const [alertMsg, setAlertMsg] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const { settings: negativeStockSettings } = useNegativeStockSettings();
  const negativeStockLimitLabel = useMemo(() => getNegativeStockLimitLabel(negativeStockSettings), [negativeStockSettings]);
  const negativeStockNearLimitLabel = useMemo(() => getNegativeStockNearLimitLabel(negativeStockSettings), [negativeStockSettings]);
  const productsRef = useRef([]);
  const alertTimeoutRef = useRef(null);
  const lastLocalStockEventAtRef = useRef(0);
  const negativeStockRequestIdRef = useRef(0);
  const previousNegativeFilterSignatureRef = useRef('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const applyProducts = (data, isAutoRefresh = false) => {
    const nextProducts = normalizeProductTree(Array.isArray(data) ? data : []);
    if (isAutoRefresh) {
      const changes = detectChanges(productsRef.current, nextProducts);
      if (changes.length > 0) {
        if (alertTimeoutRef.current) window.clearTimeout(alertTimeoutRef.current);
        setAlertMsg(`?? C?p nh?t kho: ${changes.slice(0, 5).join(', ')}${changes.length > 5 ? '?' : ''}`);
        alertTimeoutRef.current = window.setTimeout(() => {
          setAlertMsg('');
          alertTimeoutRef.current = null;
        }, 5000);
      }
    }
    productsRef.current = nextProducts;
    setProducts(nextProducts);
  };

  const fetchProducts = (isAutoRefresh = false) => {
    if (!isAutoRefresh) setProductsLoading(true);
    return apiJsonChecked('/products/all/with-variants', {}, 'Kh?ng th? t?i danh s?ch t?n kho.')
      .then(data => applyProducts(data, isAutoRefresh))
      .catch(() => { })
      .finally(() => {
        if (!isAutoRefresh) setProductsLoading(false);
      });
  };

  const fetchCategories = () => apiJsonChecked('/product-categories', {}, 'Kh?ng th? t?i danh m?c s?n ph?m.')
    .then(data => setCategories(extractListFromResponse(data)))
    .catch(() => { });

  const categoriesById = useMemo(() => buildCategoriesById(categories), [categories]);

  const getCategoryName = (product) => {
    const category = findCategoryForProduct(product, categoriesById);
    return category?.name
      || categories.find(c => Number(c.id) === Number(product?.default_category_id))?.name
      || product?.category_name
      || product?.category
      || '?';
  };

  const getProductCategoryCandidates = (product) => {
    const candidates = new Set();
    const add = (value) => {
      const text = String(value || '').trim();
      if (text) candidates.add(text);
    };

    const category = findCategoryForProduct(product, categoriesById);
    const categoryById = product?.default_category_id ? categoriesById[Number(product.default_category_id)] : null;
    [category, categoryById, product?.default_category, product?.category_info].filter(Boolean).forEach(cat => {
      categoryFields(cat).forEach(add);
    });
    add(product?.category);
    add(product?.category_name);
    add(product?.categoryName);

    return Array.from(candidates);
  };

  const productMatchesCategoryOption = (product, option) => {
    if (!option || option.key === 'all') return true;
    if (option.type === 'api' && Number(product?.default_category_id) === Number(option.id)) return true;

    const productCandidates = getProductCategoryCandidates(product);
    const optionCandidates = option.type === 'api'
      ? categoryFields(option.category)
      : [option.label, option.value];

    return productCandidates.some(productValue => optionCandidates.some(optionValue => categoryValuesMatch(productValue, optionValue)));
  };

  const categoryMatchesOption = (product, option) => {
    if (!option || option.key === 'all') return true;
    return productMatchesCategoryOption(product, option)
      || getProductVariants(product).some(variant => productMatchesCategoryOption({ ...variant, parent: product }, option));
  };

  const inventoryRowMatchesCategoryOption = (row, option) => {
    if (!option || option.key === 'all') return true;
    if (row?._isParent) return categoryMatchesOption(row, option);
    return productMatchesCategoryOption(row, option);
  };

  const buildLegacyCategoryOption = (label) => ({
    key: `text:${compactCategoryText(label)}`,
    type: 'text',
    label,
    value: label,
  });

  const categoryOptions = useMemo(() => {
    const apiOptions = (categories || []).map(category => ({
      key: `api:${category.id}`,
      type: 'api',
      id: category.id,
      label: category.name || `Danh m?c #${category.id}`,
      category,
    }));

    const legacyOptions = [];
    const legacyKeys = new Set();

    const collectLegacy = (product) => {
      [product?.category, product?.category_name, product?.categoryName].forEach(value => {
        const text = String(value || '').trim();
        if (!text) return;

        const representedByApi = apiOptions.some(option => categoryFields(option.category).some(apiValue => categoryValuesMatch(apiValue, text)));
        if (representedByApi) return;

        const key = compactCategoryText(text);
        if (!key || legacyKeys.has(key)) return;
        legacyKeys.add(key);
        legacyOptions.push(buildLegacyCategoryOption(text));
      });
    };

    (products || []).forEach(product => {
      collectLegacy(product);
      getProductVariants(product).forEach(collectLegacy);
    });
    (negativeStockRows || []).forEach(collectLegacy);

    legacyOptions.sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'vi'));

    return [
      { key: 'all', type: 'all', label: 'T?t c? danh m?c' },
      ...apiOptions,
      ...legacyOptions,
    ];
  }, [categories, products, negativeStockRows]);

  const selectedCategory = useMemo(
    () => categoryOptions.find(option => option.key === selectedCategoryKey) || categoryOptions[0],
    [categoryOptions, selectedCategoryKey],
  );

  const warehouseOptions = useMemo(() => {
    const optionMap = new Map();
    const addOption = (row) => {
      const option = buildWarehouseOption(row);
      if (!option || optionMap.has(option.key)) return;
      optionMap.set(option.key, option);
    };

    (products || []).forEach(product => {
      addOption(product);
      getProductVariants(product).forEach(addOption);
    });
    (negativeStockRows || []).forEach(addOption);

    const options = Array.from(optionMap.values())
      .sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'vi'));

    return [{ key: 'all', label: 'T?t c? kho h?ng', type: 'all' }, ...options];
  }, [products, negativeStockRows]);

  const selectedWarehouse = useMemo(
    () => warehouseOptions.find(option => option.key === selectedWarehouseKey) || warehouseOptions[0],
    [warehouseOptions, selectedWarehouseKey],
  );

  const hasManualSearch = search.trim().length > 0;
  const isNegativeStockTab = isNegativeStockTabKey(activeStockTab);
  const showStockSortButtons = !isNegativeStockTab && (hasManualSearch || selectedCategory?.key !== 'all' || selectedWarehouse?.key !== 'all' || activeStockTab !== 'all');

  const stockSortButtonClass = (direction) => `inline-flex items-center justify-center w-8 h-8 rounded-full border transition ${stockSortDirection === direction
    ? 'bg-orange-100 border-orange-300 text-orange-700'
    : 'border-orange-200 text-orange-600 hover:bg-orange-50'
  }`;

  const searchFilteredProducts = useMemo(
    () => filterProductTree(products, search, { categoriesById, includeAllVariantsOnParentMatch: true }),
    [products, search, categoriesById],
  );

  const categoryFilteredProducts = useMemo(
    () => searchFilteredProducts.filter(product => categoryMatchesOption(product, selectedCategory)),
    [searchFilteredProducts, selectedCategory, categoriesById],
  );

  const filteredProducts = categoryFilteredProducts;

  const baseInventoryRows = useMemo(() => flattenProductTree(categoryFilteredProducts, { onlyMatchedVariants: hasManualSearch })
    .filter(row => inventoryRowMatchesCategoryOption(row, selectedCategory))
    .filter(row => warehouseMatchesOption(row, selectedWarehouse)),
  [categoryFilteredProducts, hasManualSearch, selectedCategory, selectedWarehouse]);

  const localInventoryRows = useMemo(() => {
    const rows = baseInventoryRows.filter(row => rowMatchesStockTab(row, activeStockTab));

    if (!showStockSortButtons || !stockSortDirection) return rows;
    return sortRowsByStock(rows, stockSortDirection);
  }, [baseInventoryRows, activeStockTab, showStockSortButtons, stockSortDirection]);

  const localNegativeStockRows = useMemo(
    () => sortRowsByStock(
      baseInventoryRows
        .filter(row => rowMatchesStockTab(row, 'negative'))
        .map(row => normalizeNegativeStockRow(row)),
      negativeStockSortOrder,
    ),
    [baseInventoryRows, negativeStockSortOrder],
  );

  const fallbackNegativeStockTotalPages = Math.ceil(localNegativeStockRows.length / NEGATIVE_STOCK_PAGE_SIZE) || 0;
  const fallbackNegativeStockRows = useMemo(() => {
    const start = (negativeStockPage - 1) * NEGATIVE_STOCK_PAGE_SIZE;
    return localNegativeStockRows.slice(start, start + NEGATIVE_STOCK_PAGE_SIZE);
  }, [localNegativeStockRows, negativeStockPage]);

  const isUsingNegativeStockFallback = isNegativeStockTab && Boolean(negativeStockError) && !negativeStockApiAvailable;
  const negativeRowsForDisplay = isUsingNegativeStockFallback ? fallbackNegativeStockRows : negativeStockRows.map(normalizeNegativeStockRow);
  const currentInventoryRows = isNegativeStockTab ? negativeRowsForDisplay : localInventoryRows;
  const currentLoading = isNegativeStockTab
    ? negativeStockLoading && currentInventoryRows.length === 0
    : productsLoading && currentInventoryRows.length === 0;

  const tabCounts = useMemo(() => {
    const counts = INVENTORY_TABS.reduce((acc, tab) => ({ ...acc, [tab.key]: 0 }), {});
    counts.all = baseInventoryRows.length;
    baseInventoryRows.forEach(row => {
      const hasVariants = row?._isParent && getProductVariantCount(row) > 0;
      if (hasVariants) return;
      const statusKey = getInventoryStatusKey(row);
      if (statusKey === 'in-stock') counts['in-stock'] += 1;
      if (getRowStock(row) > 0 && statusKey !== 'in-stock') counts['in-stock'] += 1;
      if (statusKey === 'low-stock') counts['low-stock'] += 1;
      if (statusKey === 'out-of-stock') counts['out-of-stock'] += 1;
      if (statusKey === 'negative') {
        counts.negative += 1;
        counts['negative-quantity'] += 1;
      }
    });

    const serverNegativeTotal = Number(negativeStockPagination.total);
    if (Number.isFinite(serverNegativeTotal) && serverNegativeTotal >= 0 && negativeStockApiAvailable) {
      counts.negative = serverNegativeTotal;
      counts['negative-quantity'] = serverNegativeTotal;
    }
    return counts;
  }, [baseInventoryRows, negativeStockPagination.total, negativeStockApiAvailable]);

  const negativeStockTotal = isUsingNegativeStockFallback ? localNegativeStockRows.length : Number(negativeStockPagination.total || negativeRowsForDisplay.length || 0);
  const negativeStockTotalPages = isUsingNegativeStockFallback
    ? fallbackNegativeStockTotalPages
    : Number(negativeStockPagination.total_pages || Math.ceil(negativeStockTotal / NEGATIVE_STOCK_PAGE_SIZE) || 0);
  const negativeStockHasPrev = negativeStockPage > 1;
  const negativeStockHasNext = negativeStockTotalPages > 0 && negativeStockPage < negativeStockTotalPages;

  const totalInventoryRows = currentInventoryRows.length;
  const totalParentProducts = isNegativeStockTab
    ? currentInventoryRows.filter(row => row._isParent).length
    : filteredProducts.length;

  const totalParentStock = currentInventoryRows
    .filter(row => row._isParent)
    .reduce((sum, p) => sum + getRowStock(p), 0);

  const totalChildProducts = isNegativeStockTab
    ? currentInventoryRows.filter(row => !row._isParent).length
    : filteredProducts.reduce((sum, product) => sum + getProductVariantCount(product), 0);

  const totalVariantStock = currentInventoryRows
    .filter(row => !row._isParent)
    .reduce((sum, v) => sum + getRowStock(v), 0);

  const totalCombinedStock = totalParentStock + totalVariantStock;

  const lowStock = currentInventoryRows.reduce((sum, row) => {
    if (row._isParent && getProductVariantCount(row) > 0) return sum;
    const stock = getRowStock(row);
    return sum + (stock >= 0 && stock < 5 ? 1 : 0);
  }, 0);

  const negativeStockCount = isNegativeStockTab ? negativeStockTotal : currentInventoryRows.reduce((sum, row) => {
    if (row._isParent && getProductVariantCount(row) > 0) return sum;
    return sum + (getRowStock(row) < 0 ? 1 : 0);
  }, 0);

  const nearNegativeLimitRows = currentInventoryRows.reduce((sum, row) => {
    if (row._isParent && getProductVariantCount(row) > 0) return sum;
    return sum + (getStockDisplayMeta(getRowStock(row), negativeStockSettings).isNearLimit ? 1 : 0);
  }, 0);

  const emptyMessage = isNegativeStockTab
    ? (negativeStockError && !isUsingNegativeStockFallback
      ? 'Kh?ng th? t?i danh s?ch ?m kho t? API. D? li?u fallback hi?n kh?ng kh? d?ng.'
      : 'Kh?ng c? s?n ph?m ?m kho ph? h?p v?i b? l?c hi?n t?i.')
    : selectedCategory?.key !== 'all'
      ? `Danh m?c ?${selectedCategory.label}? chua c? s?n ph?m ph? h?p.`
      : 'Kh?ng c? s?n ph?m n?o ph? h?p.';

  const negativeStockFilterSignature = useMemo(() => [
    debouncedSearch,
    selectedCategory?.key || 'all',
    selectedWarehouse?.key || 'all',
    negativeStockSortOrder,
    activeStockTab,
  ].join('|'), [debouncedSearch, selectedCategory, selectedWarehouse, negativeStockSortOrder, activeStockTab]);

  const buildNegativeStockQueryString = (page = negativeStockPage) => {
    const query = new URLSearchParams();
    query.set('page', String(page));
    query.set('limit', String(NEGATIVE_STOCK_PAGE_SIZE));
    query.set('sort', 'stock');
    query.set('order', negativeStockSortOrder);

    if (debouncedSearch) query.set('search', debouncedSearch);

    if (selectedCategory?.key && selectedCategory.key !== 'all') {
      if (selectedCategory.type === 'api' && selectedCategory.id) query.set('category_id', String(selectedCategory.id));
      else query.set('category', selectedCategory.label || selectedCategory.value || '');
    }

    if (selectedWarehouse?.key && selectedWarehouse.key !== 'all') {
      if (selectedWarehouse.id) query.set('warehouse_id', String(selectedWarehouse.id));
      else query.set('warehouse', selectedWarehouse.label || selectedWarehouse.value || selectedWarehouse.code || '');
    }

    return query.toString();
  };

  const fetchNegativeStock = async ({ page = negativeStockPage, silent = false } = {}) => {
    const requestId = negativeStockRequestIdRef.current + 1;
    negativeStockRequestIdRef.current = requestId;
    if (!silent) setNegativeStockLoading(true);

    try {
      const query = buildNegativeStockQueryString(page);
      const data = await apiJsonChecked(`/api/inventory/negative-stock?${query}`, {}, 'Kh?ng th? t?i danh s?ch ?m kho.');
      if (requestId !== negativeStockRequestIdRef.current) return;

      const items = extractListFromResponse(data).map(normalizeNegativeStockRow);
      const pagination = data?.pagination && typeof data.pagination === 'object' ? data.pagination : {};
      const total = Number(data?.total ?? pagination.total ?? items.length);
      const limit = Number(data?.limit ?? pagination.limit ?? NEGATIVE_STOCK_PAGE_SIZE);
      const totalPages = Number(data?.total_pages ?? pagination.total_pages ?? pagination.totalPages ?? (total > 0 ? Math.ceil(total / limit) : 0));
      const responsePage = Number(data?.page ?? pagination.page ?? page);

      setNegativeStockRows(items);
      setNegativeStockApiAvailable(true);
      setNegativeStockError('');
      setNegativeStockPagination({
        page: responsePage,
        limit,
        total: Number.isFinite(total) ? total : items.length,
        total_pages: Number.isFinite(totalPages) ? totalPages : 0,
        has_next: Boolean(pagination.has_next ?? pagination.hasNext ?? responsePage < totalPages),
        has_prev: Boolean(pagination.has_prev ?? pagination.hasPrev ?? responsePage > 1),
      });
    } catch (error) {
      if (requestId !== negativeStockRequestIdRef.current) return;
      setNegativeStockApiAvailable(false);
      setNegativeStockError(error?.message || 'Kh?ng th? t?i danh s?ch ?m kho.');
    } finally {
      if (requestId === negativeStockRequestIdRef.current) setNegativeStockLoading(false);
    }
  };

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => () => {
    if (alertTimeoutRef.current) window.clearTimeout(alertTimeoutRef.current);
  }, []);

  useEffect(() => {
    fetchProducts();
    fetchCategories();
  }, []);

  useEffect(() => {
    if (!isNegativeStockTab) return;

    const signatureChanged = previousNegativeFilterSignatureRef.current !== negativeStockFilterSignature;
    previousNegativeFilterSignatureRef.current = negativeStockFilterSignature;

    if (signatureChanged && negativeStockPage !== 1) {
      setNegativeStockPage(1);
      return;
    }

    fetchNegativeStock({ page: negativeStockPage, silent: !signatureChanged && negativeStockRows.length > 0 });
  }, [isNegativeStockTab, negativeStockFilterSignature, negativeStockPage, negativeStockRefreshTick]);

  // -- Refresh khi c? don m?i ho?c sync t? thi?t b? kh?c --
  useEffect(() => {
    const refreshNegativeStockIfNeeded = () => {
      if (isNegativeStockTabKey(activeStockTab)) setNegativeStockRefreshTick(tick => tick + 1);
    };

    const handleSyncRefresh = () => {
      fetchProducts(true);
      refreshNegativeStockIfNeeded();
      console.log('[SYNC] Inventory refreshed');
    };

    const unsubUpdated = globalSyncEmitter.on('PRODUCT_UPDATED', handleSyncRefresh);
    const unsubImported = globalSyncEmitter.on('PRODUCT_IMPORTED', handleSyncRefresh);
    const unsubCreated = globalSyncEmitter.on('ORDER_CREATED', handleSyncRefresh);
    const unsubOrderUpdated = globalSyncEmitter.on('ORDER_UPDATED', handleSyncRefresh);
    const unsubOrderDeleted = globalSyncEmitter.on('ORDER_DELETED', handleSyncRefresh);

    return () => {
      unsubUpdated();
      unsubImported();
      unsubCreated();
      unsubOrderUpdated();
      unsubOrderDeleted();
    };
  }, [activeStockTab]);

  useEffect(() => {
    if (!isNegativeStockTab) return undefined;

    const requestRefresh = () => setNegativeStockRefreshTick(tick => tick + 1);
    const onVisibilityChange = () => {
      if (!document.hidden) requestRefresh();
    };
    const intervalId = window.setInterval(requestRefresh, NEGATIVE_STOCK_REFRESH_INTERVAL_MS);

    window.addEventListener('focus', requestRefresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', requestRefresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isNegativeStockTab]);

  const toggleExpanded = (productId) => {
    setExpandedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const handleTabChange = (tabKey) => {
    setActiveStockTab(tabKey);
    setStockSortDirection(null);
    if (isNegativeStockTabKey(tabKey)) setNegativeStockPage(1);
  };

  const handleSearchChange = (event) => {
    setSearch(event.target.value);
  };

  const handleCategoryChange = (event) => {
    setSelectedCategoryKey(event.target.value);
  };

  const handleWarehouseChange = (event) => {
    setSelectedWarehouseKey(event.target.value);
  };

  const negativeStockSummaryText = isNegativeStockTab
    ? `${negativeStockTotal.toLocaleString('vi-VN')} s?n ph?m ?m kho t? API${isUsingNegativeStockFallback ? ' (fallback local)' : ''}`
    : `${totalInventoryRows.toLocaleString('vi-VN')} d?ng t?n kho (${totalParentProducts.toLocaleString('vi-VN')} cha, ${totalChildProducts.toLocaleString('vi-VN')} bi?n th?)`;

  return (
    <div className="min-w-0">
      {/* ===== ALERT TH?NG B?O THAY ??I ===== */}
      {alertMsg && (
        <div className="fixed top-4 right-4 z-50 bg-orange-100 border border-orange-400 text-orange-800 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-pulse">
          {alertMsg}
        </div>
      )}

      {/* ===== HEADER: Ti?u d? + Legend + Th?ng k? ===== */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        {/* B?N TR?I: Ti?u d? + Legend ngay du?i */}
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Package className="text-orange-500" size={24} />
            <span className="text-gray-800">Kho h?ng</span>
            <button
              onClick={() => setShowHelp(true)}
              className="ml-2 px-2 py-0.5 border border-gray-300 text-gray-500 hover:bg-gray-50 rounded text-xs font-medium flex items-center gap-1"
            >
              <HelpCircle size={12} /> Hu?ng d?n
            </button>
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-red-100 border border-red-200" />
              ?m kho ({negativeStockLimitLabel} d?n -1)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-orange-100 border border-orange-200" />
              {negativeStockNearLimitLabel || 'G?n ngu?ng ?m'}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-yellow-100 border border-yellow-200" />
              C?n ?t (5?30)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-green-100 border border-green-200" />
              C?n nhi?u (=30)
            </span>
          </div>
        </div>

        {/* B?N PH?I: Th?ng k? */}
        <div className="grid w-full grid-cols-2 gap-2 text-sm sm:grid-cols-3 xl:w-auto xl:grid-cols-8 xl:gap-3">
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-blue-500 font-medium">T?ng d?ng t?n kho</div>
            <div className="text-lg font-bold text-blue-700">{totalInventoryRows}</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-green-500 font-medium">T?ng t?n kho SP cha</div>
            <div className="text-lg font-bold text-green-700">{totalParentStock.toLocaleString('vi-VN')}</div>
          </div>
          <div className="bg-pink-50 border border-pink-200 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-pink-500 font-medium">T?ng bi?n th?</div>
            <div className="text-lg font-bold text-pink-700">{totalChildProducts}</div>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-yellow-500 font-medium">T?ng t?n kho bi?n th?</div>
            <div className="text-lg font-bold text-yellow-700">{totalVariantStock.toLocaleString('vi-VN')}</div>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-purple-500 font-medium">T?ng t?n kho</div>
            <div className="text-lg font-bold text-purple-700">{totalCombinedStock.toLocaleString('vi-VN')}</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-red-500 font-medium">?m kho</div>
            <div className="text-lg font-bold text-red-700">{negativeStockCount.toLocaleString('vi-VN')}</div>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-orange-500 font-medium">{negativeStockNearLimitLabel || 'G?n ngu?ng ?m'}</div>
            <div className="text-lg font-bold text-orange-700">{nearNegativeLimitRows}</div>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-yellow-600 font-medium">S?p h?t h?ng</div>
            <div className="text-lg font-bold text-yellow-700">{lowStock}</div>
          </div>
        </div>
      </div>

      {/* ===== TABS ===== */}
      <div className="mb-4 overflow-x-auto pb-1">
        <div className="inline-flex min-w-full gap-2 rounded-2xl border border-orange-100 bg-orange-50/40 p-1 sm:min-w-0">
          {INVENTORY_TABS.map(tab => {
            const isActive = activeStockTab === tab.key;
            const isNegativeTab = isNegativeStockTabKey(tab.key);
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTabChange(tab.key)}
                className={`whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-bold transition sm:text-sm ${isActive
                  ? isNegativeTab
                    ? 'border-red-300 bg-red-600 text-white shadow-sm'
                    : 'border-orange-300 bg-white text-orange-700 shadow-sm'
                  : 'border-transparent bg-transparent text-gray-600 hover:bg-white hover:text-orange-700'}`}
              >
                {tab.label}
                <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${isActive
                  ? isNegativeTab ? 'bg-white/20 text-white' : 'bg-orange-100 text-orange-700'
                  : isNegativeTab ? 'bg-red-100 text-red-700' : 'bg-white text-gray-500'}`}
                >
                  {(tabCounts[tab.key] || 0).toLocaleString('vi-VN')}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ===== FILTERS ===== */}
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input-field w-full pl-9"
              placeholder="?? T?m theo t?n, m? s?n ph?m, SKU, danh m?c, nh?m, size/m?u/variant..."
              value={search}
              onChange={handleSearchChange}
            />
          </div>
          <div className="flex w-full min-w-0 items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm lg:w-[360px]">
            <label htmlFor="kho-category-filter" className="text-xs font-semibold text-gray-500 whitespace-nowrap">Danh m?c</label>
            {showStockSortButtons && (
              <button
                type="button"
                onClick={() => setStockSortDirection('asc')}
                className={stockSortButtonClass('asc')}
                title="S?p x?p t?n kho tang d?n"
                aria-label="S?p x?p t?n kho tang d?n"
              >
                <ArrowUp size={16} />
              </button>
            )}
            <select
              id="kho-category-filter"
              className="input-field py-1.5 text-sm flex-1"
              value={selectedCategoryKey}
              onChange={handleCategoryChange}
            >
              {categoryOptions.map(option => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
            {showStockSortButtons && (
              <button
                type="button"
                onClick={() => setStockSortDirection('desc')}
                className={stockSortButtonClass('desc')}
                title="S?p x?p t?n kho gi?m d?n"
                aria-label="S?p x?p t?n kho gi?m d?n"
              >
                <ArrowDown size={16} />
              </button>
            )}
          </div>
          <div className="flex w-full min-w-0 items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm lg:w-[260px]">
            <label htmlFor="kho-warehouse-filter" className="text-xs font-semibold text-gray-500 whitespace-nowrap">Kho h?ng</label>
            <select
              id="kho-warehouse-filter"
              className="input-field py-1.5 text-sm flex-1"
              value={selectedWarehouseKey}
              onChange={handleWarehouseChange}
            >
              {warehouseOptions.map(option => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </div>
          {isNegativeStockTab && (
            <div className="flex w-full min-w-0 items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 shadow-sm lg:w-[330px]">
              <label htmlFor="negative-stock-sort" className="text-xs font-semibold text-red-600 whitespace-nowrap">S?p x?p</label>
              <select
                id="negative-stock-sort"
                className="input-field py-1.5 text-sm flex-1 border-red-200 focus:border-red-400 focus:ring-red-100"
                value={negativeStockSortOrder}
                onChange={event => setNegativeStockSortOrder(event.target.value)}
              >
                <option value="asc">?m s?u nh?t tru?c</option>
                <option value="desc">G?n 0 tru?c</option>
              </select>
              <button
                type="button"
                onClick={() => setNegativeStockRefreshTick(tick => tick + 1)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-300 bg-white text-red-600 transition hover:bg-red-100 disabled:opacity-60"
                disabled={negativeStockLoading}
                title="L?m m?i danh s?ch ?m kho"
                aria-label="L?m m?i danh s?ch ?m kho"
              >
                <RefreshCw size={15} className={negativeStockLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mb-3 text-xs text-gray-500 flex flex-wrap gap-2 items-center">
        <span className="px-2 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-100">
          ?ang xem: {INVENTORY_TABS.find(tab => tab.key === activeStockTab)?.label || 'T?t c? s?n ph?m'}
        </span>
        <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
          Danh m?c: {selectedCategory?.label || 'T?t c? danh m?c'}
        </span>
        <span className="px-2 py-1 rounded-full bg-slate-50 text-slate-700 border border-slate-100">
          Kho: {selectedWarehouse?.label || 'T?t c? kho h?ng'}
        </span>
        <span>{negativeStockSummaryText}</span>
        {isNegativeStockTab && !isUsingNegativeStockFallback && (
          <span className="px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-100">
            API: /api/inventory/negative-stock ? sort stock {negativeStockSortOrder}
          </span>
        )}
      </div>

      {isUsingNegativeStockFallback && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          Kh?ng g?i du?c API ?m kho ({negativeStockError}). ?ang t?m hi?n th? fallback t? danh s?ch s?n ph?m d? t?i d? tr?nh gi?n do?n UI.
        </div>
      )}

      {/* ===== TABLE: TT | Chevron | T?n | M?/SKU | Danh m?c | Kho | T?n kho | Gi? nh?p | Gi? b?n | Tr?ng th?i ===== */}
      <div className="card overflow-hidden p-0">
        <div className="min-w-0">
          <div className="hidden items-center gap-2 px-3 py-2 bg-gray-100 text-xs text-gray-600 font-semibold border-b sticky top-0 z-10 md:flex">
            <div className="w-8 text-center font-bold">TT</div>
            <div className="w-8 text-center font-bold">CT</div>
            <div className="flex-1 min-w-0">T?n s?n ph?m</div>
            <div className="hidden w-32 lg:block">M? / SKU</div>
            <div className="hidden w-36 sm:block">Danh m?c</div>
            <div className="hidden w-32 lg:block">Kho h?ng</div>
            <div className="w-24 text-center font-bold">S? lu?ng t?n</div>
            <div className="hidden w-28 text-right md:block">Gi? nh?p</div>
            <div className="hidden w-28 text-right md:block">Gi? b?n</div>
            <div className="hidden w-28 text-center xl:block">Tr?ng th?i</div>
          </div>

          {currentLoading && <LoadingSkeleton rows={isNegativeStockTab ? 8 : 6} />}

          {!currentLoading && currentInventoryRows.length === 0 && (
            <div className="text-center text-gray-400 py-16 px-4">
              <div className="text-5xl mb-3 opacity-20">{isNegativeStockTab ? '??' : '??'}</div>
              <div className="font-medium text-gray-500">{emptyMessage}</div>
              <div className="text-xs mt-2">{isNegativeStockTab ? 'H?y th? x?a t? kh?a, d?i danh m?c/kho ho?c ch? d? li?u realtime c?p nh?t.' : 'H?y ch?n tab, danh m?c, kho h?ng kh?c ho?c x?a b?t t? kh?a t?m ki?m.'}</div>
            </div>
          )}

          {!currentLoading && currentInventoryRows.map((row, idx) => {
            const isParentRow = row._isParent;
            const parent = isParentRow ? null : row.parent;
            const variants = isParentRow ? getProductVariants(row) : [];
            const variantCount = isParentRow ? variants.length : 0;
            const hasVariants = isParentRow && variantCount > 0;
            const isExpanded = isParentRow && expandedProductIds.has(row.id);
            const categoryName = getCategoryName(row);
            const warehouseName = getWarehouseDisplayName(row);
            const rowName = firstNonEmpty(row.name, row.display_name, row.displayName, row.product_name, row.productName, row.variant_name, row.variantName, row.option_text, row.sku, 'S?n ph?m');
            const rowSku = getRowSku(row);
            const rowCode = getRowCode(row);
            const stockMeta = getStockDisplayMeta(getRowStock(row), negativeStockSettings);
            const rowKey = isParentRow ? `p-${row.id}` : `v-${row._parentId || row.parent_id || parent?.id || 'parent'}-${row.id || rowSku || idx}`;
            const rowClass = hasVariants ? (isParentRow ? 'bg-white' : 'bg-blue-50/30') : (stockMeta.rowClass || (isParentRow ? 'bg-white' : 'bg-blue-50/30'));
            const isNegativeRow = getRowStock(row) < 0;

            return (
              <div key={rowKey} className={`border-b last:border-b-0 ${rowClass}`}>
                <div className={`flex flex-wrap items-center gap-2 px-3 py-3 transition md:flex-nowrap md:py-2 ${isNegativeRow ? 'hover:bg-red-100/60' : 'hover:bg-gray-50'}`}>
                  {/* STT */}
                  <div className="w-8 text-center text-xs text-gray-400">{isNegativeStockTab ? ((negativeStockPage - 1) * NEGATIVE_STOCK_PAGE_SIZE) + idx + 1 : idx + 1}</div>

                  {/* Chevron / Lo?i d?ng */}
                  <div className="w-8 text-center">
                    {isParentRow && hasVariants ? (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(row.id)}
                        className={`inline-flex items-center justify-center w-7 h-7 rounded-full border transition ${isExpanded ? 'bg-orange-100 border-orange-300 text-orange-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                        title={isExpanded ? 'Thu g?n chi ti?t t?n kho' : 'M? chi ti?t t?n kho'}
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    ) : isParentRow ? (
                      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${isNegativeRow ? 'border-red-200 bg-red-50 text-red-500' : 'border-gray-100 bg-gray-50 text-gray-300'}`} title="S?n ph?m kh?ng c? bi?n th?">?</span>
                    ) : (
                      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${isNegativeRow ? 'border-red-200 bg-red-50 text-red-500' : 'border-blue-100 bg-blue-50 text-blue-500'}`} title="Bi?n th?">?</span>
                    )}
                  </div>

                  {/* T?n s?n ph?m */}
                  <div className="flex-1 min-w-[12rem] md:min-w-0">
                    <div className={`text-sm truncate ${isParentRow ? 'font-semibold' : 'pl-2 font-medium'} ${!hasVariants ? stockMeta.nameClass : (isParentRow ? 'text-gray-800' : 'text-blue-700')}`} title={rowName}>{rowName}</div>
                    <div className="text-xs text-gray-400 truncate" title={`M?: ${rowCode || '?'} ? SKU: ${rowSku || '?'} ? Kho: ${warehouseName}`}>
                      {isParentRow
                        ? `M?: ${rowCode || '?'} ? SKU: ${rowSku || '?'} ? ${variantCount} bi?n th? ? Kho: ${warehouseName}`
                        : `Bi?n th? c?a: ${parent?.name || row.parent_name || 'S?n ph?m cha'} ? M?: ${rowCode || '?'} ? SKU: ${rowSku || '?'}${row.option_text ? ` ? ${row.option_text}` : ''}`}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-gray-500 md:hidden">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5">Danh m?c: {categoryName}</span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5">Kho: {warehouseName}</span>
                      <StatusPill row={row} settings={negativeStockSettings} />
                    </div>
                  </div>

                  {/* M?/SKU */}
                  <div className="hidden w-32 text-xs text-gray-500 lg:block">
                    <div className="truncate font-medium text-gray-700" title={rowCode || '?'}>{rowCode || '?'}</div>
                    <div className="truncate text-gray-400" title={rowSku || '?'}>SKU: {rowSku || '?'}</div>
                  </div>

                  {/* Danh m?c */}
                  <div className="hidden w-36 text-xs text-gray-500 truncate sm:block" title={categoryName}>{categoryName}</div>

                  {/* Kho h?ng */}
                  <div className="hidden w-32 text-xs text-gray-500 truncate lg:block" title={warehouseName}>{warehouseName}</div>

                  {/* T?n kho */}
                  <div className="w-24 text-center" title={hasVariants ? 'T?n kho du?c qu?n l? ? t?ng bi?n th?' : undefined}>{hasVariants ? <span className="text-gray-300 text-xs">?</span> : <StockBadge stock={getRowStock(row)} settings={negativeStockSettings} />}</div>

                  {/* Gi? nh?p */}
                  <div className={`hidden w-28 text-right text-xs md:block ${hasVariants ? 'text-gray-300' : 'text-gray-500'}`} title={hasVariants ? 'Gi? nh?p du?c qu?n l? ? t?ng bi?n th?' : undefined}>{hasVariants ? '?' : formatOptionalVND(row.import_price)}</div>
                  {/* Gi? b?n */}
                  <div className={`hidden w-28 text-right text-xs font-medium md:block ${hasVariants ? 'text-gray-300' : 'text-green-600'}`} title={hasVariants ? 'Gi? b?n du?c qu?n l? ? t?ng bi?n th?' : undefined}>{hasVariants ? '?' : formatOptionalVND(row.retail_price)}</div>
                  {/* Tr?ng th?i */}
                  <div className="hidden w-28 text-center xl:block">{hasVariants ? <span className="text-xs text-gray-300">?</span> : <StatusPill row={row} settings={negativeStockSettings} />}</div>
                </div>

                {isExpanded && hasVariants && (
                  <div className="bg-orange-50/40 border-t border-orange-100 px-3 py-3 sm:px-12 sm:py-4">
                    <div className="bg-white border border-orange-100 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-orange-100/70 text-xs font-semibold text-orange-800 flex items-center justify-between">
                        <span>Bi?n th? v? t?n kho t?ng bi?n th?</span>
                        <span>{variantCount} bi?n th?</span>
                      </div>
                      <div className="divide-y divide-orange-50">
                        {variants.map((variant, variantIndex) => {
                          const variantName = firstNonEmpty(variant.name, variant.display_name, variant.displayName, variant.product_name, variant.productName, variant.variant_name, variant.variantName, variant.option_text, variant.sku, `Bi?n th? ${variantIndex + 1}`);
                          const variantSku = getRowSku(variant);
                          const variantCode = getRowCode(variant);
                          const variantWarehouse = getWarehouseDisplayName(variant) !== '?' ? getWarehouseDisplayName(variant) : warehouseName;
                          const variantKey = `expanded-v-${row.id}-${variant.id || variantSku || variantIndex}`;
                          return (
                            <div key={variantKey} className={`grid grid-cols-1 gap-2 px-3 py-2 text-xs text-gray-600 md:grid-cols-[minmax(0,1fr)_8rem_7rem_7rem_7rem_7rem] md:items-center ${getRowStock(variant) < 0 ? 'bg-red-50/70 hover:bg-red-100/70' : 'hover:bg-orange-50/50'}`}>
                              <div className="min-w-0">
                                <div className={`truncate font-medium ${getRowStock(variant) < 0 ? 'text-red-700' : 'text-blue-700'}`} title={variantName}>? {variantName}</div>
                                <div className="truncate text-gray-400" title={variant.option_text || variantSku || 'Kh?ng c? SKU'}>M?: {variantCode || '?'} ? SKU: {variantSku || '?'} ? Kho: {variantWarehouse}{variant.option_text ? ` ? ${variant.option_text}` : ''}</div>
                              </div>
                              <div className="md:text-center"><StockBadge stock={getRowStock(variant)} settings={negativeStockSettings} /></div>
                              <div className="text-gray-500 md:text-right">Nh?p: {formatOptionalVND(variant.import_price)}</div>
                              <div className="font-medium text-green-600 md:text-right">B?n: {formatOptionalVND(variant.retail_price)}</div>
                              <div className="font-medium text-gray-500 md:text-center"><StatusPill row={variant} settings={negativeStockSettings} /></div>
                              <div className="font-medium text-blue-600 md:text-right">VIP: {formatOptionalVND(variant.vip_price)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {isNegativeStockTab && (negativeStockTotalPages > 1 || negativeStockTotal > NEGATIVE_STOCK_PAGE_SIZE) && (
        <div className="mt-3 flex flex-col items-center justify-between gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 sm:flex-row">
          <div>
            Trang <strong>{negativeStockPage}</strong>/{Math.max(negativeStockTotalPages, 1)} ? T?ng <strong>{negativeStockTotal.toLocaleString('vi-VN')}</strong> s?n ph?m ?m kho
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 font-semibold text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!negativeStockHasPrev || negativeStockLoading}
              onClick={() => setNegativeStockPage(page => Math.max(1, page - 1))}
            >
              Tru?c
            </button>
            <button
              type="button"
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 font-semibold text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!negativeStockHasNext || negativeStockLoading}
              onClick={() => setNegativeStockPage(page => Math.min(Math.max(negativeStockTotalPages, 1), page + 1))}
            >
              Sau
            </button>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <HelpModal
          title="Hu?ng d?n s? d?ng Kho h?ng"
          onClose={() => setShowHelp(false)}
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? T?ng quan</h3>
                <p>Trang Kho h?ng hi?n th? to?n b? s?n ph?m v? t?n kho theo th?i gian th?c. C?c tab gi?p xem nhanh t?n kho theo tr?ng th?i: t?t c?, c?n h?ng, s?p h?t h?ng, h?t h?ng, ?m kho v? s? lu?ng ?m.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? T?m ki?m v? l?c</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Ch?n danh m?c trong ? <strong>Danh m?c</strong> d? xem t?t c? s?n ph?m thu?c danh m?c d?.</li>
                  <li>D?ng ? <strong>Kho h?ng</strong> d? l?c theo kho n?u d? li?u s?n ph?m/API c? th?ng tin kho.</li>
                  <li>C? th? nh?p t? kh?a d? l?c theo <strong>T?n s?n ph?m</strong>, <strong>M? s?n ph?m</strong>, <strong>SKU</strong>, <strong>Danh m?c</strong>, nh?m, size/m?u/variant.</li>
                  <li>? tab <strong>?m kho</strong> ho?c <strong>S? lu?ng ?m</strong>, b? l?c du?c g?i l?n API d? tr?nh t?i/l?c to?n b? d? li?u tr?n tr?nh duy?t.</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? Tab ?m kho / s? lu?ng ?m</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Khi m? tab <strong>?m kho</strong> ho?c <strong>S? lu?ng ?m</strong>, h? th?ng g?i <strong>/api/inventory/negative-stock</strong> v?i page, limit, search, category_id/category, warehouse_id/warehouse v? sort stock.</li>
                  <li>M?c d?nh s?p x?p <strong>?m s?u nh?t tru?c</strong> d? s?n ph?m c? t?n kho ?m n?ng nh?t n?m tr?n d?u danh s?ch.</li>
                  <li>N?u API ?m kho t?m l?i, m?n h?nh d?ng fallback nh? t? danh s?ch s?n ph?m d? t?i d? UI kh?ng b? crash.</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? Th?ng k? nhanh</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>T?ng d?ng t?n kho:</strong> S? d?ng dang hi?n th? theo tab v? b? l?c hi?n t?i.</li>
                  <li><strong>T?ng t?n kho:</strong> T?ng t?n kho s?n ph?m cha c?ng t?n kho bi?n th? dang hi?n th?.</li>
                  <li><strong>S?p h?t:</strong> S? d?ng c? t?n kho t? 0 d?n {'<'} 5; s?n ph?m cha c? bi?n th? s? t?nh theo t?ng bi?n th?.</li>
                  <li><strong>?m kho:</strong> S? s?n ph?m c? stock {'<'} 0, l?y t? API ?m kho khi dang xem tab ?m kho.</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? M?u s?c c?nh b?o</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><span className="text-red-600 font-medium">?? ?m kho:</span> T?n kho t? {negativeStockLimitLabel} d?n -1, hi?n th? d?ng ?T?n: -5? v? badge d? ??M KHO?.</li>
                  <li><span className="text-orange-600 font-medium">?? G?n ngu?ng:</span> T?n kho trong v?ng c?nh b?o g?n {negativeStockLimitLabel} c?n x? l? s?m.</li>
                  <li><span className="text-red-500 font-medium">?? S?p h?t:</span> T?n kho t? 0 d?n {'<'} 5</li>
                  <li><span className="text-yellow-600 font-medium">?? C?n ?t:</span> T?n kho t? 5?30</li>
                  <li><span className="text-green-600 font-medium">?? C?n nhi?u:</span> T?n kho = 30</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? C?ch d?c b?ng</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Mui t?n ? c?t CT:</strong> M?/thu g?n chi ti?t t?n kho c?a t?ng s?n ph?m.</li>
                  <li><strong>Chi ti?t s?n ph?m:</strong> Hi?n th? t?n, m? s?n ph?m, SKU, danh m?c, kho h?ng, t?n kho hi?n t?i, gi? nh?p, gi? b?n v? tr?ng th?i t?n kho.</li>
                  <li><strong>Bi?n th?:</strong> Khi s?n ph?m c? bi?n th?, b?ng chi ti?t hi?n th? t?n kho c?a t?ng bi?n th?.</li>
                  <li><strong>TT:</strong> S? th? t? theo b? l?c hi?n t?i; tab ?m kho c? ph?n trang theo API.</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? C?p nh?t t? d?ng</h3>
                <p>Kho t? c?p nh?t khi c? don h?ng, phi?u nh?p ho?c s? ki?n d?ng b? l?m d?i t?n kho. Ri?ng tab ?m kho c?n t? l?m m?i khi c?a s? du?c focus, khi quay l?i tab tr?nh duy?t v? theo interval nh? trong l?c dang xem tab ?m kho.</p>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-800 mb-2">?? M?o</h3>
                <ul className="list-disc pl-5 space-y-1 text-blue-700">
                  <li>Ch?n danh m?c nhu <strong>K? h?p</strong> d? xem nhanh to?n b? s?n ph?m trong danh m?c d?.</li>
                  <li>D?ng mui t?n m? chi ti?t d? ki?m tra t?n kho t?ng bi?n th? m? kh?ng r?i m?n h?nh Kho h?ng.</li>
                  <li>S?n ph?m ?m kho s? hi?n th? badge d? ??M KHO? v? gi? tr? nhu ?T?n: -5?; gi?i h?n ?m l?y t? c?i d?t hi?n t?i ({negativeStockLimitLabel}).</li>
                </ul>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
