import { useState, useEffect, useMemo } from 'react';
import { resolveApiUrl } from '../utils/apiClient';
import { Package, Search, ChevronDown, ChevronRight, HelpCircle, ArrowDown, ArrowUp } from 'lucide-react';
import HelpModal from '../components/HelpModal';

const API = resolveApiUrl('');
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
import { SYNC_UPDATED_EVENT } from '../utils/apiClient';

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n || 0);
}

function hasPrice(value) {
  return value !== undefined && value !== null && value !== '' && Number(value) > 0;
}

function formatOptionalVND(value) {
  return hasPrice(value) ? formatVND(value) : '—';
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

function stockBadgeClass(stock) {
  if ((stock ?? 0) === 0) return 'bg-red-200 text-red-700';
  if ((stock ?? 0) < 5) return 'bg-red-100 text-red-700';
  if ((stock ?? 0) < 10) return 'bg-red-100 text-red-600';
  if ((stock ?? 0) < 30) return 'bg-yellow-100 text-yellow-700';
  return 'bg-green-100 text-green-700';
}

function StockBadge({ stock }) {
  if ((stock ?? 0) === 0) {
    return <span className="inline-block font-bold px-2 py-0.5 rounded text-xs bg-red-200 text-red-700">Hết hàng</span>;
  }
  return <span className={`inline-block font-bold px-2 py-0.5 rounded text-xs ${stockBadgeClass(stock)}`}>{stock ?? 0}</span>;
}

export default function KhoHang() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedCategoryKey, setSelectedCategoryKey] = useState('all');
  const [expandedProductIds, setExpandedProductIds] = useState(() => new Set());
  const [stockSortDirection, setStockSortDirection] = useState(null);
  const [alertMsg, setAlertMsg] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => { fetchProducts(); fetchCategories(); }, []);

  // ── Refresh khi có đơn mới hoặc sync từ thiết bị khác ──
  useEffect(() => {
    const onOrderCreated = () => fetchProducts(true);
    const onSyncUpdated = (event) => {
      const changedTables = event.detail?.changedTables || [];
      const syncData = event.detail?.data || {};
      if (changedTables.some(table => ['products', 'import_logs', 'import_details', 'invoices', 'invoice_details'].includes(table))) {
        fetchProducts(true);
      }
      if (Array.isArray(syncData.product_categories) && changedTables.includes('product_categories')) {
        setCategories(syncData.product_categories);
      }
    };
    window.addEventListener('kha-order-created', onOrderCreated);
    window.addEventListener(SYNC_UPDATED_EVENT, onSyncUpdated);
    return () => {
      window.removeEventListener('kha-order-created', onOrderCreated);
      window.removeEventListener(SYNC_UPDATED_EVENT, onSyncUpdated);
    };
  }, [products]);

  const applyProducts = (data, isAutoRefresh = false) => {
    const nextProducts = normalizeProductTree(Array.isArray(data) ? data : []);
    if (isAutoRefresh) {
      const changes = detectChanges(products, nextProducts);
      if (changes.length > 0) {
        setAlertMsg(`🔔 Cập nhật kho: ${changes.slice(0, 5).join(', ')}${changes.length > 5 ? '…' : ''}`);
        setTimeout(() => setAlertMsg(''), 5000);
      }
    }
    setProducts(nextProducts);
  };

  const fetchProducts = (isAutoRefresh = false) => {
    fetch(`${API}/products/all/with-variants`)
      .then(r => r.json())
      .then(data => applyProducts(data, isAutoRefresh))
      .catch(() => { });
  };

  const fetchCategories = () => {
    fetch(`${API}/product-categories`)
      .then(r => r.json())
      .then(data => setCategories(Array.isArray(data) ? data : []))
      .catch(() => { });
  };

  const categoriesById = useMemo(() => buildCategoriesById(categories), [categories]);

  const getCategoryName = (product) => {
    const category = findCategoryForProduct(product, categoriesById);
    return category?.name
      || categories.find(c => Number(c.id) === Number(product?.default_category_id))?.name
      || product?.category
      || '—';
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
      label: category.name || `Danh mục #${category.id}`,
      category,
    }));

    const legacyOptions = [];
    const legacyKeys = new Set();

    const collectLegacy = (product) => {
      const text = String(product?.category || '').trim();
      if (!text) return;

      const representedByApi = apiOptions.some(option => categoryFields(option.category).some(value => categoryValuesMatch(value, text)));
      if (representedByApi) return;

      const key = compactCategoryText(text);
      if (!key || legacyKeys.has(key)) return;
      legacyKeys.add(key);
      legacyOptions.push(buildLegacyCategoryOption(text));
    };

    (products || []).forEach(product => {
      collectLegacy(product);
      getProductVariants(product).forEach(collectLegacy);
    });

    legacyOptions.sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'vi'));

    return [
      { key: 'all', type: 'all', label: 'Tất cả danh mục' },
      ...apiOptions,
      ...legacyOptions,
    ];
  }, [categories, products]);

  const selectedCategory = useMemo(
    () => categoryOptions.find(option => option.key === selectedCategoryKey) || categoryOptions[0],
    [categoryOptions, selectedCategoryKey],
  );

  const hasManualSearch = search.trim().length > 0;
  const showStockSortButtons = hasManualSearch || selectedCategory?.key !== 'all';

  const stockSortButtonClass = (direction) => `inline-flex items-center justify-center w-8 h-8 rounded-full border transition ${stockSortDirection === direction
    ? 'bg-orange-100 border-orange-300 text-orange-700'
    : 'border-orange-200 text-orange-600 hover:bg-orange-50'
  }`;

  const detectChanges = (oldList, newList) => {
    const changes = [];
    const oldMap = {};
    const buildMap = (list) => {
      (list || []).forEach(p => {
        oldMap[`p-${p.id}`] = p.stock || 0;
        getProductVariants(p).forEach(v => { oldMap[`v-${v.id}`] = v.stock || 0; });
      });
    };
    buildMap(oldList);
    (newList || []).forEach(p => {
      const oldStock = oldMap[`p-${p.id}`] ?? -1;
      const newStock = p.stock || 0;
      if (oldStock >= 0 && newStock !== oldStock) {
        const diff = newStock - oldStock;
        changes.push(`${p.name}: ${oldStock} → ${newStock} (${diff > 0 ? '+' + diff : diff})`);
      }
      getProductVariants(p).forEach(v => {
        const oldVs = oldMap[`v-${v.id}`] ?? -1;
        const newVs = v.stock || 0;
        if (oldVs >= 0 && newVs !== oldVs) {
          const diff = newVs - oldVs;
          changes.push(`${v.name}: ${oldVs} → ${newVs} (${diff > 0 ? '+' + diff : diff})`);
        }
      });
    });
    return changes;
  };

  const searchFilteredProducts = useMemo(
    () => filterProductTree(products, search, { categoriesById, includeAllVariantsOnParentMatch: true }),
    [products, search, categoriesById],
  );

  const categoryFilteredProducts = useMemo(
    () => searchFilteredProducts.filter(product => categoryMatchesOption(product, selectedCategory)),
    [searchFilteredProducts, selectedCategory, categoriesById],
  );

  const filteredProducts = categoryFilteredProducts;

  const filteredInventoryRows = useMemo(() => {
    const rows = flattenProductTree(categoryFilteredProducts, { onlyMatchedVariants: hasManualSearch })
      .filter(row => inventoryRowMatchesCategoryOption(row, selectedCategory));

    if (!showStockSortButtons || !stockSortDirection) return rows;

    const directionMultiplier = stockSortDirection === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const stockA = Number(a?.stock ?? 0);
      const stockB = Number(b?.stock ?? 0);
      return (stockA - stockB) * directionMultiplier;
    });
  }, [categoryFilteredProducts, hasManualSearch, selectedCategory, showStockSortButtons, stockSortDirection]);

  const toggleExpanded = (productId) => {
    setExpandedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  // Tổng dòng tồn kho chính (sản phẩm cha + từng biến thể hiển thị riêng)
  const totalInventoryRows = filteredInventoryRows.length;

  // Tổng sản phẩm cha (không đếm variant)
  const totalParentProducts = filteredProducts.length;

  // Tổng tồn kho của SẢN PHẨM CHA (stock field trên product)
  const totalParentStock = filteredInventoryRows
    .filter(row => row._isParent)
    .reduce((sum, p) => sum + (p.stock || 0), 0);

  // Tổng sản phẩm con theo cây đã lọc, không phụ thuộc trạng thái mở/thu gọn hoặc dòng bị render trong panel.
  const totalChildProducts = filteredProducts.reduce((sum, product) => sum + getProductVariantCount(product), 0);

  // Tổng tồn kho của BIẾN THỂ (chỉ tính variant stock đang hiển thị)
  const totalVariantStock = filteredInventoryRows
    .filter(row => !row._isParent)
    .reduce((sum, v) => sum + (v.stock || 0), 0);

  // Tổng tồn kho TỔNG THỂ (product stock + variant stock)
  const totalCombinedStock = totalParentStock + totalVariantStock;

  // Sắp hết hàng: đếm dòng tồn kho đang hiển thị; dòng cha có biến thể không quản lý tồn trực tiếp thì bỏ qua.
  const lowStock = filteredInventoryRows.reduce((sum, row) => {
    if (row._isParent && getProductVariantCount(row) > 0) return sum;
    return sum + ((row.stock || 0) < 5 ? 1 : 0);
  }, 0);

  const emptyMessage = selectedCategory?.key !== 'all'
    ? `Danh mục “${selectedCategory.label}” chưa có sản phẩm phù hợp.`
    : 'Không có sản phẩm nào phù hợp.';

  return (
    <div className="min-w-0">
      {/* ===== ALERT THÔNG BÁO THAY ĐỔI ===== */}
      {alertMsg && (
        <div className="fixed top-4 right-4 z-50 bg-orange-100 border border-orange-400 text-orange-800 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-pulse">
          {alertMsg}
        </div>
      )}

      {/* ===== HEADER: Tiêu đề + Legend + Thống kê ===== */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        {/* BÊN TRÁI: Tiêu đề + Legend ngay dưới */}
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Package className="text-orange-500" size={24} />
            <span className="text-gray-800">Kho hàng</span>
            <button
              onClick={() => setShowHelp(true)}
              className="ml-2 px-2 py-0.5 border border-gray-300 text-gray-500 hover:bg-gray-50 rounded text-xs font-medium flex items-center gap-1"
            >
              <HelpCircle size={12} /> Hướng dẫn
            </button>
          </h1>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-red-100 border border-red-200" />
              Sắp hết {'<'}5
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-yellow-100 border border-yellow-200" />
              Còn ít (5–30)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-green-100 border border-green-200" />
              Còn nhiều (≥30)
            </span>
          </div>
        </div>

        {/* BÊN PHẢI: Thống kê */}
    <div className="grid w-full grid-cols-2 gap-2 text-sm sm:grid-cols-3 xl:w-auto xl:grid-cols-6 xl:gap-3">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-center">
        <div className="text-xs text-blue-500 font-medium">Tổng dòng tồn kho</div>
        <div className="text-lg font-bold text-blue-700">{totalInventoryRows}</div>
      </div>
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-green-500 font-medium">Tổng tồn kho SP cha</div>
            <div className="text-lg font-bold text-green-700">{totalParentStock.toLocaleString()}</div>
          </div>
          <div className="bg-pink-50 border border-pink-200 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-pink-500 font-medium">Tổng biến thể</div>
            <div className="text-lg font-bold text-pink-700">{totalChildProducts}</div>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-yellow-500 font-medium">Tổng tồn kho biến thể</div>
            <div className="text-lg font-bold text-yellow-700">{totalVariantStock.toLocaleString()}</div>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-purple-500 font-medium">Tổng tồn kho</div>
            <div className="text-lg font-bold text-purple-700">{totalCombinedStock.toLocaleString()}</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-red-500 font-medium">Sắp hết hàng</div>
            <div className="text-lg font-bold text-red-700">{lowStock}</div>
          </div>
        </div>
      </div>

      {/* ===== FILTERS ===== */}
      <div className="mb-4 flex flex-col lg:flex-row gap-2 lg:items-center">
        <div className="relative flex-1 min-w-0">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input-field w-full pl-9"
            placeholder="🔍 Tìm theo tên, SKU, danh mục, nhóm, size/màu/variant..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex w-full min-w-0 items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm lg:w-[360px]">
          <label htmlFor="kho-category-filter" className="text-xs font-semibold text-gray-500 whitespace-nowrap">Danh mục</label>
          {showStockSortButtons && (
            <button
              type="button"
              onClick={() => setStockSortDirection('asc')}
              className={stockSortButtonClass('asc')}
              title="Sắp xếp tồn kho tăng dần"
              aria-label="Sắp xếp tồn kho tăng dần"
            >
              <ArrowUp size={16} />
            </button>
          )}
          <select
            id="kho-category-filter"
            className="input-field py-1.5 text-sm flex-1"
            value={selectedCategoryKey}
            onChange={e => setSelectedCategoryKey(e.target.value)}
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
              title="Sắp xếp tồn kho giảm dần"
              aria-label="Sắp xếp tồn kho giảm dần"
            >
              <ArrowDown size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 text-xs text-gray-500 flex flex-wrap gap-2 items-center">
        <span className="px-2 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-100">
          Đang xem: {selectedCategory?.label || 'Tất cả danh mục'}
        </span>
        <span>{totalInventoryRows.toLocaleString()} dòng tồn kho ({totalParentProducts.toLocaleString()} cha, {totalChildProducts.toLocaleString()} biến thể)</span>
      </div>

      {/* ===== TABLE: TT | Chevron | Tên | Danh mục | Tồn kho | Giá nhập | Giá lẻ | Giá sỉ | Giá vip ===== */}
      <div className="card overflow-hidden p-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-xs text-gray-600 font-semibold border-b sticky top-0 z-10">
            <div className="w-8 text-center font-bold">TT</div>
            <div className="w-8 text-center font-bold">CT</div>
            <div className="flex-1 min-w-0">Tên sản phẩm</div>
            <div className="w-36">Danh mục</div>
            <div className="w-20 text-center font-bold">Tồn kho</div>
            <div className="hidden w-28 text-right md:block">Giá nhập</div>
            <div className="hidden w-28 text-right md:block">Giá lẻ</div>
            <div className="hidden w-28 text-right md:block">Giá sỉ</div>
            <div className="hidden w-28 text-right md:block">Giá vip</div>
          </div>

          {filteredInventoryRows.length === 0 && (
            <div className="text-center text-gray-400 py-16">
              <div className="text-5xl mb-3 opacity-20">📦</div>
              <div className="font-medium text-gray-500">{emptyMessage}</div>
              <div className="text-xs mt-2">  Hãy chọn danh mục khác hoặc xóa bớt từ khóa tìm kiếm.</div>
            </div>
          )}

          {filteredInventoryRows.map((row, idx) => {
            const isParentRow = row._isParent;
            const parent = isParentRow ? null : row.parent;
            const variants = isParentRow ? getProductVariants(row) : [];
            const variantCount = isParentRow ? variants.length : 0;
            const hasVariants = isParentRow && variantCount > 0;
            const isExpanded = isParentRow && expandedProductIds.has(row.id);
            const categoryName = getCategoryName(row);
            const rowName = firstNonEmpty(row.name, row.display_name, row.displayName, row.product_name, row.productName, row.variant_name, row.variantName, row.option_text, row.sku, 'Sản phẩm');
            const rowSku = firstNonEmpty(row.sku, row.product_sku, row.productSku, row.variant_sku, row.variantSku, row.barcode);
            const rowKey = isParentRow ? `p-${row.id}` : `v-${row._parentId || row.parent_id || parent?.id || 'parent'}-${row.id || rowSku || idx}`;

            return (
              <div key={rowKey} className={`border-b last:border-b-0 ${isParentRow ? 'bg-white' : 'bg-blue-50/30'}`}>
                <div className="flex flex-wrap items-center gap-2 px-3 py-3 hover:bg-gray-50 md:flex-nowrap md:py-2">
                  {/* STT */}
                  <div className="w-8 text-center text-xs text-gray-400">{idx + 1}</div>

                  {/* Chevron / Loại dòng */}
                  <div className="w-8 text-center">
                    {isParentRow && hasVariants ? (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(row.id)}
                        className={`inline-flex items-center justify-center w-7 h-7 rounded-full border transition ${isExpanded ? 'bg-orange-100 border-orange-300 text-orange-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                        title={isExpanded ? 'Thu gọn chi tiết tồn kho' : 'Mở chi tiết tồn kho'}
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    ) : isParentRow ? (
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-100 bg-gray-50 text-xs font-bold text-gray-300" title="Sản phẩm không có biến thể">—</span>
                    ) : (
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-xs font-bold text-blue-500" title="Biến thể">↳</span>
                    )}
                  </div>

                  {/* Tên sản phẩm */}
                  <div className="flex-1 min-w-[12rem] md:min-w-0">
                    <div className={`text-sm truncate ${isParentRow ? 'font-semibold' : 'pl-2 font-medium'} ${!hasVariants && (row.stock ?? 0) === 0 ? 'text-red-400 line-through' : (isParentRow ? 'text-gray-800' : 'text-blue-700')}`} title={rowName}>{rowName}</div>
                    <div className="text-xs text-gray-400 truncate" title={isParentRow ? `${rowSku || 'Không có SKU'} · ${variantCount} biến thể` : `Biến thể của: ${parent?.name || row.parent_name || 'Sản phẩm cha'} · SKU: ${rowSku || '—'}${row.option_text ? ` · ${row.option_text}` : ''}`}>
                      {isParentRow
                        ? `${rowSku || 'Không có SKU'} · ${variantCount} biến thể`
                        : `Biến thể của: ${parent?.name || row.parent_name || 'Sản phẩm cha'} · SKU: ${rowSku || '—'}${row.option_text ? ` · ${row.option_text}` : ''}`}
                    </div>
                  </div>

                  {/* Danh mục */}
                  <div className="hidden w-36 text-xs text-gray-500 truncate sm:block" title={categoryName}>{categoryName}</div>

                  {/* Tồn kho */}
                  <div className="w-20 text-center" title={hasVariants ? 'Tồn kho được quản lý ở từng biến thể' : undefined}>{hasVariants ? <span className="text-gray-300 text-xs">—</span> : <StockBadge stock={row.stock} />}</div>

                  {/* Giá nhập */}
                  <div className={`hidden w-28 text-right text-xs md:block ${hasVariants ? 'text-gray-300' : 'text-gray-500'}`} title={hasVariants ? 'Giá nhập được quản lý ở từng biến thể' : undefined}>{hasVariants ? '—' : formatOptionalVND(row.import_price)}</div>
                  {/* Giá lẻ */}
                  <div className={`hidden w-28 text-right text-xs font-medium md:block ${hasVariants ? 'text-gray-300' : 'text-green-600'}`} title={hasVariants ? 'Giá lẻ được quản lý ở từng biến thể' : undefined}>{hasVariants ? '—' : formatOptionalVND(row.retail_price)}</div>
                  {/* Giá sỉ */}
                  <div className={`hidden w-28 text-right text-xs font-medium md:block ${hasVariants ? 'text-gray-300' : 'text-red-600'}`} title={hasVariants ? 'Giá sỉ được quản lý ở từng biến thể' : undefined}>{hasVariants ? '—' : formatOptionalVND(row.wholesale_price)}</div>
                  {/* Giá VIP */}
                  <div className={`hidden w-28 text-right font-medium text-xs md:block ${hasVariants ? 'text-gray-300' : 'text-blue-600'}`} title={hasVariants ? 'Giá VIP được quản lý ở từng biến thể' : undefined}>{hasVariants ? '—' : formatOptionalVND(row.vip_price)}</div>
                </div>

                {isExpanded && hasVariants && (
                  <div className="bg-orange-50/40 border-t border-orange-100 px-3 py-3 sm:px-12 sm:py-4">
                    <div className="bg-white border border-orange-100 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-orange-100/70 text-xs font-semibold text-orange-800 flex items-center justify-between">
                        <span>Biến thể và tồn kho từng biến thể</span>
                        <span>{variantCount} biến thể</span>
                      </div>
                      <div className="divide-y divide-orange-50">
                        {variants.map((variant, variantIndex) => {
                          const variantName = firstNonEmpty(variant.name, variant.display_name, variant.displayName, variant.product_name, variant.productName, variant.variant_name, variant.variantName, variant.option_text, variant.sku, `Biến thể ${variantIndex + 1}`);
                          const variantSku = firstNonEmpty(variant.sku, variant.product_sku, variant.productSku, variant.variant_sku, variant.variantSku, variant.barcode);
                          const variantKey = `expanded-v-${row.id}-${variant.id || variantSku || variantIndex}`;
                          return (
                            <div key={variantKey} className="grid grid-cols-1 gap-2 px-3 py-2 text-xs text-gray-600 md:grid-cols-[minmax(0,1fr)_7rem_6rem_7rem_7rem_7rem] md:items-center">
                              <div className="min-w-0">
                                <div className="truncate font-medium text-blue-700" title={variantName}>↳ {variantName}</div>
                                <div className="truncate text-gray-400" title={variant.option_text || variantSku || 'Không có SKU'}>SKU: {variantSku || '—'}{variant.option_text ? ` · ${variant.option_text}` : ''}</div>
                              </div>
                              <div className="md:text-center"><StockBadge stock={variant.stock} /></div>
                              <div className="text-gray-500 md:text-right">Nhập: {formatOptionalVND(variant.import_price)}</div>
                              <div className="font-medium text-green-600 md:text-right">Lẻ: {formatOptionalVND(variant.retail_price)}</div>
                              <div className="font-medium text-red-600 md:text-right">Sỉ: {formatOptionalVND(variant.wholesale_price)}</div>
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

      {/* Help Modal */}
      {showHelp && (
        <HelpModal
          title="Hướng dẫn sử dụng Kho hàng"
          onClose={() => setShowHelp(false)}
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">📦 Tổng quan</h3>
                <p>Trang Kho hàng hiển thị toàn bộ sản phẩm và tồn kho theo thời gian thực. Số tồn kho được cập nhật tự động sau mỗi 30 giây.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🔍 Tìm kiếm và lọc danh mục</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Chọn danh mục trong ô <strong>Danh mục</strong> để xem tất cả sản phẩm thuộc danh mục đó.</li>
                  <li>Danh mục được lấy từ API danh mục sản phẩm; sản phẩm cũ chỉ có text danh mục vẫn được gom vào lựa chọn phù hợp.</li>
                  <li>Có thể nhập thêm từ khóa để lọc theo <strong>Tên sản phẩm</strong>, <strong>Mã SKU</strong>, <strong>Danh mục</strong>, nhóm, size/màu/variant.</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📊 Thống kê nhanh</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Tổng sản phẩm cha:</strong> Số lượng sản phẩm cha đang khớp bộ lọc.</li>
                  <li><strong>Tổng tồn kho:</strong> Tổng tồn kho sản phẩm cha cộng tồn kho biến thể.</li>
                  <li><strong>Sắp hết:</strong> Số biến thể có tồn kho {'<'} 5; sản phẩm không có biến thể sẽ tính theo tồn kho cha.</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🎨 Màu sắc cảnh báo</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><span className="text-red-600 font-medium">🔴 Hết hàng:</span> Tồn kho = 0 (ghi ngang)</li>
                  <li><span className="text-red-500 font-medium">🔴 Sắp hết:</span> Tồn kho {'<'} 5</li>
                  <li><span className="text-yellow-600 font-medium">🟡 Còn ít:</span> Tồn kho từ 5–30</li>
                  <li><span className="text-green-600 font-medium">🟢 Còn nhiều:</span> Tồn kho ≥ 30</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📋 Cách đọc bảng</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Mũi tên ở cột CT:</strong> Mở/thu gọn chi tiết tồn kho của từng sản phẩm.</li>
                  <li><strong>Chi tiết sản phẩm:</strong> Hiển thị tên, SKU, danh mục, tồn kho hiện tại và các mức giá.</li>
                  <li><strong>Biến thể:</strong> Khi sản phẩm có biến thể, bảng chi tiết hiển thị tồn kho của từng biến thể.</li>
                  <li><strong>TT:</strong> Số thứ tự sản phẩm theo bộ lọc hiện tại.</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🔄 Cập nhật tự động</h3>
                <p>Kho được cập nhật tự động mỗi 30 giây. Khi có đơn hàng mới được tạo, tồn kho sẽ giảm tự động. Bạn sẽ thấy thông báo dạng "🔔 Cập nhật kho: ..." ở góc phải màn hình nếu có thay đổi.</p>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-800 mb-2">💡 Mẹo</h3>
                <ul className="list-disc pl-5 space-y-1 text-blue-700">
                  <li>Chọn danh mục như <strong>Kệ hộp</strong> để xem nhanh toàn bộ sản phẩm trong danh mục đó.</li>
                  <li>Dùng mũi tên mở chi tiết để kiểm tra tồn kho từng biến thể mà không rời màn hình Kho hàng.</li>
                  <li>Sản phẩm hết hàng (tồn = 0) sẽ hiển thị gạch ngang và chữ "Hết hàng".</li>
                </ul>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
