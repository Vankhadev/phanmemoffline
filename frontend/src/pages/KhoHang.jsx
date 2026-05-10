import { useState, useEffect, useMemo } from 'react';
import { API } from '../App';
import { Package, Search, ChevronDown, ChevronRight, HelpCircle, ArrowDown, ArrowUp } from 'lucide-react';
import HelpModal from '../components/HelpModal';
import {
  buildCategoriesById,
  categoryFields,
  filterProductTree,
  findCategoryForProduct,
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
    const nextProducts = Array.isArray(data) ? data : [];
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
      || (product?.variants || []).some(variant => productMatchesCategoryOption({ ...variant, parent: product }, option));
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
      (product.variants || []).forEach(collectLegacy);
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
        (p.variants || []).forEach(v => { oldMap[`v-${v.id}`] = v.stock || 0; });
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
      (p.variants || []).forEach(v => {
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

  const filteredProducts = useMemo(() => {
    if (!showStockSortButtons || !stockSortDirection) return categoryFilteredProducts;

    const directionMultiplier = stockSortDirection === 'asc' ? 1 : -1;
    return [...categoryFilteredProducts].sort((a, b) => {
      const stockA = Number(a?.stock ?? 0);
      const stockB = Number(b?.stock ?? 0);
      return (stockA - stockB) * directionMultiplier;
    });
  }, [categoryFilteredProducts, showStockSortButtons, stockSortDirection]);

  const toggleExpanded = (productId) => {
    setExpandedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  // Tổng sản phẩm cha (không đếm variant)
  const totalParentProducts = filteredProducts.length;

  // Tổng tồn kho của SẢN PHẨM CHA (stock field trên product)
  const totalParentStock = filteredProducts.reduce((sum, p) => sum + (p.stock || 0), 0);

  // Tổng sản phẩm con (variant count)
  const totalChildProducts = filteredProducts.reduce((sum, p) => sum + ((p.variants || []).length), 0);

  // Tổng tồn kho của BIẾN THỂ (chỉ tính variant stock)
  const totalVariantStock = filteredProducts.reduce(
    (sum, p) => sum + (p.variants || []).reduce((variantSum, v) => variantSum + (v.stock || 0), 0),
    0,
  );

  // Tổng tồn kho TỔNG THỂ (product stock + variant stock)
  const totalCombinedStock = totalParentStock + totalVariantStock;

  // Sắp hết hàng: đếm variant có stock < 5; sản phẩm không có variant thì đếm stock cha.
  const lowStock = filteredProducts.reduce((sum, p) => {
    const variants = p.variants || [];
    if (variants.length === 0) return sum + ((p.stock || 0) < 5 ? 1 : 0);
    return sum + variants.reduce((variantSum, v) => variantSum + ((v.stock || 0) < 5 ? 1 : 0), 0);
  }, 0);

  const emptyMessage = selectedCategory?.key !== 'all'
    ? `Danh mục “${selectedCategory.label}” chưa có sản phẩm phù hợp.`
    : 'Không có sản phẩm nào phù hợp.';

  return (
    <div>
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
        <div className="flex items-center gap-3 text-sm flex-wrap justify-end">
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-center">
            <div className="text-xs text-blue-500 font-medium">Tổng sản phẩm cha</div>
            <div className="text-lg font-bold text-blue-700">{totalParentProducts}</div>
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
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm min-w-[280px]">
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
        <span>{filteredProducts.length.toLocaleString()} sản phẩm</span>
      </div>

      {/* ===== TABLE: TT | Chevron | Tên | Danh mục | Tồn kho | Giá nhập | Giá lẻ | Giá sỉ | Giá vip ===== */}
      <div className="card overflow-x-auto">
        <div className="min-w-[980px]">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-xs text-gray-600 font-semibold border-b sticky top-0 z-10">
            <div className="w-8 text-center font-bold">TT</div>
            <div className="w-8 text-center font-bold">CT</div>
            <div className="flex-1 min-w-0">Tên sản phẩm</div>
            <div className="w-36">Danh mục</div>
            <div className="w-20 text-center font-bold">Tồn kho</div>
            <div className="w-28 text-right">Giá nhập</div>
            <div className="w-28 text-right">Giá lẻ</div>
            <div className="w-28 text-right">Giá sỉ</div>
            <div className="w-28 text-right">Giá vip</div>
          </div>

          {filteredProducts.length === 0 && (
            <div className="text-center text-gray-400 py-16">
              <div className="text-5xl mb-3 opacity-20">📦</div>
              <div className="font-medium text-gray-500">{emptyMessage}</div>
              <div className="text-xs mt-2">Hãy chọn danh mục khác hoặc xóa bớt từ khóa tìm kiếm.</div>
            </div>
          )}

          {filteredProducts.map((product, idx) => {
            const variants = product.variants || [];
            const isExpanded = expandedProductIds.has(product.id);
            const categoryName = getCategoryName(product);

            return (
              <div key={`p-${product.id}`} className="border-b last:border-b-0">
                <div className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50">
                  {/* STT */}
                  <div className="w-8 text-center text-xs text-gray-400">{idx + 1}</div>

                  {/* Chevron */}
                  <div className="w-8 text-center">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(product.id)}
                      className={`inline-flex items-center justify-center w-7 h-7 rounded-full border transition ${isExpanded ? 'bg-orange-100 border-orange-300 text-orange-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                      title={isExpanded ? 'Thu gọn chi tiết tồn kho' : 'Mở chi tiết tồn kho'}
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  </div>

                  {/* Tên sản phẩm */}
                  <div className="flex-1 min-w-0">
                    <div className={`font-semibold text-sm truncate ${(product.stock ?? 0) === 0 ? 'text-red-400 line-through' : 'text-gray-800'}`}>{product.name}</div>
                    <div className="text-xs text-gray-400 truncate">{product.sku || 'Không có SKU'} · {variants.length} biến thể</div>
                  </div>

                  {/* Danh mục */}
                  <div className="w-36 text-xs text-gray-500 truncate" title={categoryName}>{categoryName}</div>

                  {/* Tồn kho */}
                  <div className="w-20 text-center"><StockBadge stock={product.stock} /></div>

                  {/* Giá nhập */}
                  <div className="w-28 text-right text-gray-500 text-xs">{formatOptionalVND(product.import_price)}</div>
                  {/* Giá lẻ */}
                  <div className="w-28 text-right text-green-600 text-xs font-medium">{formatOptionalVND(product.retail_price)}</div>
                  {/* Giá sỉ */}
                  <div className="w-28 text-right text-red-600 text-xs font-medium">{formatOptionalVND(product.wholesale_price)}</div>
                  {/* Giá VIP */}
                  <div className="w-28 text-right text-blue-600 font-medium text-xs">{formatOptionalVND(product.vip_price)}</div>
                </div>

                {isExpanded && (
                  <div className="bg-orange-50/40 border-t border-orange-100 px-12 py-4">
                    <div className="bg-white border border-orange-100 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-orange-100/70 text-xs font-semibold text-orange-800 flex items-center justify-between">
                        <span>Biến thể và tồn kho từng biến thể</span>
                        <span>{variants.length} biến thể</span>
                      </div>
                      {variants.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-gray-500">Sản phẩm này chưa có biến thể. Tồn kho hiện tại đang nằm ở dòng sản phẩm cha.</div>
                      ) : (
                        <div>
                          <div className="grid grid-cols-[1fr_150px_110px_120px_120px_120px_120px] gap-2 px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-500 border-b">
                            <div>Tên biến thể</div>
                            <div>SKU</div>
                            <div className="text-center">Tồn kho</div>
                            <div className="text-right">Giá nhập</div>
                            <div className="text-right">Giá lẻ</div>
                            <div className="text-right">Giá sỉ</div>
                            <div className="text-right">Giá VIP</div>
                          </div>
                          {variants.map(variant => (
                            <div key={`v-${variant.id}`} className="grid grid-cols-[1fr_150px_110px_120px_120px_120px_120px] gap-2 px-3 py-2 text-xs border-b last:border-b-0 items-center">
                              <div className={`font-medium ${(variant.stock ?? 0) === 0 ? 'text-red-400 line-through' : 'text-blue-700'}`}>{variant.name}</div>
                              <div className="text-gray-500 truncate" title={variant.sku || ''}>{variant.sku || '—'}</div>
                              <div className="text-center"><StockBadge stock={variant.stock} /></div>
                              <div className="text-right text-gray-500">{formatOptionalVND(variant.import_price)}</div>
                              <div className="text-right text-green-600 font-medium">{formatOptionalVND(variant.retail_price)}</div>
                              <div className="text-right text-red-600 font-medium">{formatOptionalVND(variant.wholesale_price)}</div>
                              <div className="text-right text-blue-600 font-medium">{formatOptionalVND(variant.vip_price)}</div>
                            </div>
                          ))}
                        </div>
                      )}
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
