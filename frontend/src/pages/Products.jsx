import { useState, useEffect, useRef, useMemo } from 'react';
import { API } from '../App';
import { Package, ChevronDown, ChevronRight, Plus, X, Edit2, Trash2, Layers, Upload, Download, CheckSquare, Square, HelpCircle, Tag, ArrowUp, ArrowDown } from 'lucide-react';
import * as XLSX from 'xlsx';
import { buildCategoriesById, filterProductTree, normalizeSearchText, searchFlatProducts } from '../utils/productSearch';

function formatVND(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n || 0);
}

// Tạo 5 số ngẫu nhiên từ 1-9
const random5Digits = () => {
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += Math.floor(Math.random() * 9) + 1;
  }
  return result;
};

export default function Products() {
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const excelInputRef = useRef(null);
  const [combos, setCombos] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showCategorySection, setShowCategorySection] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', group_name: '', keywords: '' });
  const [stockSortDirection, setStockSortDirection] = useState(null);

  // Get supplier name by ID
  const getSupplierName = (supplierId) => {
    if (!supplierId) return '—';
    const supplier = suppliers.find(s => s.id === supplierId);
    return supplier ? supplier.name : '—';
  };
  const [form, setForm] = useState({
    sku: '', name: '', import_price: '', wholesale_price: '',
    retail_price: '', vip_price: '', stock: '', unit: 'cái', category: '',
    supplier_id: '',
  });

  // Combo state
  const [showComboSection, setShowComboSection] = useState(false);
  const [showComboForm, setShowComboForm] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [comboForm, setComboForm] = useState({
    name: '', sku: '', retail_price: '', wholesale_price: '', vip_price: '',
  });
  const [comboItems, setComboItems] = useState([]);
  const [showComboProductSearch, setShowComboProductSearch] = useState(false);
  const [comboProductSearch, setComboProductSearch] = useState('');

  // Variants
  const [expandedParents, setExpandedParents] = useState({});
  const [showVariantModal, setShowVariantModal] = useState(false);
  const [variantParent, setVariantParent] = useState(null);
  const [editingVariant, setEditingVariant] = useState(null);
  const [variantForm, setVariantForm] = useState({
    sku: '', name: '', import_price: '', wholesale_price: '',
    retail_price: '', vip_price: '', stock: '', unit: 'cái',
  });

  // Bulk delete state
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  useEffect(() => { fetchProducts(); fetchCombos(); fetchSuppliers(); fetchCategories(); }, []);

  // ── Refresh khi có đơn mới được tạo ──
  useEffect(() => {
    const onOrderCreated = () => fetchProducts();
    window.addEventListener('kha-order-created', onOrderCreated);
    return () => window.removeEventListener('kha-order-created', onOrderCreated);
  }, []);

  const fetchCombos = () => { fetch(`${API}/combos`).then(r => r.json()).then(setCombos).catch(() => { }); };
  const fetchSuppliers = () => { fetch(`${API}/partners`).then(r => r.json()).then(setSuppliers).catch(() => { }); };
  const normalizeListField = (value) => {
    if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
    return String(value || '').split(/[,;\n]/).map(item => item.trim()).filter(Boolean);
  };
  const isCategoryActive = (category) => {
    const active = category?.active;
    if (active === undefined || active === null || active === '') return true;
    const normalized = String(active).trim().toLowerCase();
    return !(active === 0 || active === false || normalized === '0' || normalized === 'false');
  };
  const normalizeCategoryRecord = (category) => {
    if (!category || typeof category !== 'object') return null;
    return {
      ...category,
      keywords: normalizeListField(category.keywords),
      aliases: normalizeListField(category.aliases),
      active: isCategoryActive(category) ? 1 : 0,
    };
  };
  const extractCategoriesFromResponse = (data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.categories)) return data.categories;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  };
  const fetchCategories = async () => {
    try {
      const data = await fetch(`${API}/product-categories`).then(r => r.json());
      const nextCategories = extractCategoriesFromResponse(data).map(normalizeCategoryRecord).filter(Boolean);
      setCategories(nextCategories);
      return nextCategories;
    } catch (_) {
      return [];
    }
  };
  const sortActiveCategories = (items) => [...(Array.isArray(items) ? items : [])]
    .map(normalizeCategoryRecord)
    .filter(category => category && isCategoryActive(category))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'vi'));
  const upsertCategoryInState = (category) => {
    const normalizedCategory = normalizeCategoryRecord(category);
    if (!normalizedCategory?.id) return;
    setCategories(prev => sortActiveCategories(
      prev.some(item => String(item.id) === String(normalizedCategory.id))
        ? prev.map(item => String(item.id) === String(normalizedCategory.id) ? { ...item, ...normalizedCategory } : item)
        : [...prev, normalizedCategory]
    ));
  };

  const openCategoryAdd = () => {
    setEditingCategory(null);
    setCategoryForm({ name: '', group_name: '', keywords: '', aliases: '' });
  };
  const openCategoryEdit = (category) => {
    setEditingCategory(category);
    setCategoryForm({
      name: category.name || '',
      group_name: category.group_name || '',
      keywords: Array.isArray(category.keywords) ? category.keywords.join(', ') : (category.keywords || ''),
      aliases: Array.isArray(category.aliases) ? category.aliases.join(', ') : (category.aliases || ''),
    });
  };
  const handleCategorySubmit = async (e) => {
    if (e) e.preventDefault();
    if (!categoryForm.name.trim()) { alert('Vui lòng nhập tên danh mục!'); return; }

    const method = editingCategory ? 'PUT' : 'POST';
    const url = editingCategory ? `${API}/product-categories/${editingCategory.id}` : `${API}/product-categories`;

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        alert(`⚠️ Lỗi: ${data.error || data.detail || 'Không lưu được danh mục'}`);
        return;
      }

      const responseList = extractCategoriesFromResponse(data);
      const responseCategory = (data?.category && !Array.isArray(data.category) ? data.category : null)
        || responseList.find(category => editingCategory && String(category.id) === String(editingCategory.id))
        || responseList.find(category => normalizeSearchText(category.name) === normalizeSearchText(categoryForm.name))
        || responseList[0]
        || ((data?.id || data?.name) ? data : null);
      const savedCategory = normalizeCategoryRecord(responseCategory);
      if (savedCategory?.id) {
        upsertCategoryInState(savedCategory);
      } else {
        const refreshedCategories = await fetchCategories();
        const matchedCategory = refreshedCategories.find(category => (
          editingCategory && String(category.id) === String(editingCategory.id)
        ) || normalizeSearchText(category.name) === normalizeSearchText(categoryForm.name));
        if (matchedCategory?.id) upsertCategoryInState(matchedCategory);
      }

      setEditingCategory(null);
      setCategoryForm({ name: '', group_name: '', keywords: '', aliases: '' });
      fetchProducts();
    } catch (err) {
      alert(`📡 Lỗi kết nối khi lưu danh mục: ${err.message}`);
    }
  };
  const handleCategoryDelete = async (category) => {
    if (!confirm(`Vô hiệu danh mục "${category.name}"? Sản phẩm cũ vẫn giữ dữ liệu danh mục đã gán.`)) return;
    await fetch(`${API}/product-categories/${category.id}`, { method: 'DELETE' });
    setCategories(prev => prev.filter(item => String(item.id) !== String(category.id)));
    fetchProducts();
  };
  const getCategoryName = (product) => product?.default_category?.name || categories.find(c => Number(c.id) === Number(product?.default_category_id))?.name || product?.category || '—';
  const getComboItemKey = (item) => item?.variant_id ? `variant-${item.variant_id}` : `product-${item?.product_id}`;
  const normalizeComboItemForForm = (it) => {
    const variantId = it.variant_id || null;
    const productId = it.product_id || it.parent_id || null;
    const productName = it.product_name || (variantId ? (it.parent_name || '') : (it.name || ''));
    const variantName = it.variant_name || (variantId ? (it.name || '') : '');
    return {
      id: it.id || getComboItemKey({ product_id: productId, variant_id: variantId }) || `${Date.now()}-${Math.random()}`,
      item_type: it.item_type || (variantId ? 'variant' : 'product'),
      product_id: productId,
      variant_id: variantId,
      parent_id: it.parent_id || (variantId ? productId : null),
      name: it.name || variantName || productName,
      parent_name: it.parent_name || (variantId ? productName : ''),
      product_name: productName,
      variant_name: variantName,
      sku: it.sku || '',
      stock: it.stock ?? 0,
      retail_price: it.retail_price ?? it.unit_price ?? 0,
      wholesale_price: it.wholesale_price ?? 0,
      unit_price: it.unit_price ?? it.retail_price ?? 0,
      quantity: Math.max(1, parseInt(it.quantity, 10) || 1),
    };
  };
  const openComboAdd = () => {
    setEditingCombo(null);
    setComboForm({ name: '', sku: '', retail_price: '', wholesale_price: '', vip_price: '' });
    setComboItems([]);
    setComboProductSearch('');
    setShowComboProductSearch(false);
    setShowComboForm(true);
  };
  const openComboEdit = (c) => {
    setEditingCombo(c);
    setComboForm({
      name: c.name, sku: c.sku || '',
      retail_price: c.retail_price ?? '', wholesale_price: c.wholesale_price ?? '', vip_price: c.vip_price ?? '',
    });
    setComboItems((c.items || []).map(normalizeComboItemForForm));
    setComboProductSearch('');
    setShowComboProductSearch(false);
    setShowComboForm(true);
  };
  const handleComboSubmit = async () => {
    if (!comboForm.name?.trim()) { alert('Vui lòng nhập tên combo!'); return; }
    if (comboForm.retail_price === '' || comboForm.retail_price === null || comboForm.retail_price === undefined) { alert('Vui lòng nhập giá bán lẻ!'); return; }
    if (comboForm.wholesale_price === '' || comboForm.wholesale_price === null || comboForm.wholesale_price === undefined) { alert('Vui lòng nhập giá bán sỉ!'); return; }
    const payloadItems = comboItems.map(item => ({
      item_type: item.item_type || (item.variant_id ? 'variant' : 'product'),
      product_id: item.product_id || null,
      variant_id: item.variant_id || null,
      parent_id: item.parent_id || (item.variant_id ? item.product_id : null),
      name: item.name || item.variant_name || item.product_name || '',
      parent_name: item.parent_name || '',
      product_name: item.product_name || item.name || '',
      variant_name: item.variant_name || '',
      sku: item.sku || '',
      quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
      unit_price: Number(item.unit_price || item.retail_price || 0),
      retail_price: Number(item.retail_price || item.unit_price || 0),
      wholesale_price: Number(item.wholesale_price || 0),
      stock: Number(item.stock || 0),
    }));
    const method = editingCombo ? 'PUT' : 'POST';
    const url = editingCombo ? `${API}/combos/${editingCombo.id}` : `${API}/combos`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...comboForm, name: comboForm.name.trim(), items: payloadItems }),
    });
    const data = await res.json();
    if (data.ok) {
      setShowComboForm(false);
      fetchCombos();
      const updatedAt = String(Date.now());
      localStorage.setItem('kha_combos_updated_at', updatedAt);
      window.dispatchEvent(new CustomEvent('kha-combos-changed', { detail: { updatedAt, comboId: data.id || editingCombo?.id || null } }));
    }
    else alert(`⚠️ Lỗi: ${data.error || data.detail || 'Không lưu được combo'}`);
  };
  const handleComboDelete = async (id) => {
    if (!confirm('Xóa combo này?')) return;
    await fetch(`${API}/combos/${id}`, { method: 'DELETE' });
    fetchCombos();
    const updatedAt = String(Date.now());
    localStorage.setItem('kha_combos_updated_at', updatedAt);
    window.dispatchEvent(new CustomEvent('kha-combos-changed', { detail: { updatedAt, comboId: id, deleted: true } }));
  };
  const addComboItem = () => {
    setShowComboProductSearch(true);
    setComboProductSearch('');
  };
  const optionToComboItem = (option) => ({
    id: option.key,
    item_type: option.item_type,
    product_id: option.product_id,
    variant_id: option.variant_id,
    parent_id: option.parent_id || null,
    name: option.name || '',
    parent_name: option.parent_name || '',
    product_name: option.item_type === 'variant' ? (option.parent_name || '') : (option.name || ''),
    variant_name: option.item_type === 'variant' ? (option.name || '') : '',
    sku: option.sku || '',
    stock: option.stock ?? 0,
    retail_price: option.retail_price ?? 0,
    wholesale_price: option.wholesale_price ?? 0,
    unit_price: option.retail_price ?? 0,
    quantity: 1,
  });
  const selectComboProduct = (option) => {
    const key = option.key;
    setComboItems(prev => {
      const exists = prev.some(item => getComboItemKey(item) === key || item.id === key);
      if (!exists) return [...prev, optionToComboItem(option)];
      return prev.map(item => (getComboItemKey(item) === key || item.id === key)
        ? { ...item, quantity: Math.max(1, parseInt(item.quantity, 10) || 1) + 1 }
        : item);
    });
    setComboProductSearch('');
  };
  const updateComboItem = (idx, field, val) => {
    const updated = [...comboItems];
    updated[idx] = { ...updated[idx], [field]: field === 'quantity' ? Math.max(1, parseInt(val, 10) || 1) : val };
    setComboItems(updated);
  };
  const removeComboItem = (idx) => setComboItems(comboItems.filter((_, i) => i !== idx));

  const fetchProducts = () => {
    fetch(`${API}/products/all/with-variants`).then(r => r.json()).then(setProducts).catch(() => { });
  };

  // ── CHECKBOX HANDLERS ──
  const toggleSelectProduct = (productId) => {
    setSelectedProducts(prev =>
      prev.includes(productId) ? prev.filter(id => id !== productId) : [...prev, productId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedProducts.length === filtered.length) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(filtered.map(p => p.id));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedProducts.length === 0) return;
    if (!confirm(`Xóa ${selectedProducts.length} sản phẩm đã chọn? Tất cả biến thể cũng sẽ bị xóa.`)) return;

    setIsBulkDeleting(true);
    try {
      const promises = selectedProducts.map(id =>
        fetch(`${API}/products/${id}`, { method: 'DELETE' })
      );
      await Promise.all(promises);
      alert(`✅ Đã xóa ${selectedProducts.length} sản phẩm!`);
      setSelectedProducts([]);
      fetchProducts();
    } catch (err) {
      alert(`📡 Lỗi khi xóa: ${err.message}`);
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const requiredExcelColumns = [
    'Loại dòng',
    'SKU',
    'Parent SKU',
    'Tên sản phẩm',
    'Tên cha',
    'Giá nhập',
    'Giá sỉ',
    'Giá lẻ',
    'Giá VIP',
    'Tồn kho',
    'Đơn vị',
    'Danh mục text',
    'Default category id',
    'Supplier id',
    'Hoạt động',
  ];
  const referenceExcelColumns = [
    'ID',
    'Parent ID',
    'Default category name',
    'Supplier name',
    'Ghi chú',
  ];
  const excelColumns = [...requiredExcelColumns, ...referenceExcelColumns];

  const getSupplierDisplayName = (supplierId) => {
    if (!supplierId) return '';
    const supplier = suppliers.find(s => String(s.id) === String(supplierId));
    return supplier?.name || '';
  };

  const getDefaultCategoryDisplayName = (product, parent = null) => {
    const categoryId = product?.default_category_id ?? parent?.default_category_id ?? '';
    return product?.default_category?.name
      || parent?.default_category?.name
      || categories.find(category => String(category.id) === String(categoryId))?.name
      || '';
  };

  const getProductCategoryText = (product, parent = null) => {
    const ownCategory = product?.category;
    if (ownCategory !== undefined && ownCategory !== null && String(ownCategory).trim() !== '') return ownCategory;
    return parent?.category || '';
  };

  const productToExcelRow = (product, type, parent = null) => {
    const supplierId = product.supplier_id ?? parent?.supplier_id ?? '';
    return {
      'Loại dòng': type,
      'SKU': product.sku || '',
      'Parent SKU': parent?.sku || '',
      'Tên sản phẩm': product.name || '',
      'Tên cha': parent?.name || '',
      'Giá nhập': product.import_price ?? '',
      'Giá sỉ': product.wholesale_price ?? '',
      'Giá lẻ': product.retail_price ?? '',
      'Giá VIP': product.vip_price ?? '',
      'Tồn kho': product.stock ?? '',
      'Đơn vị': product.unit || parent?.unit || 'cái',
      'Danh mục text': getProductCategoryText(product, parent),
      'Default category id': product.default_category_id ?? parent?.default_category_id ?? '',
      'Supplier id': supplierId,
      'Hoạt động': product.active === 0 ? 'Không' : 'Có',
      'ID': product.id ?? '',
      'Parent ID': parent?.id ?? product.parent_id ?? '',
      'Default category name': getDefaultCategoryDisplayName(product, parent),
      'Supplier name': getSupplierDisplayName(supplierId),
      'Ghi chú': type === 'VARIANT'
        ? 'Biến thể: SKU được đồng bộ theo SKU cha; Parent SKU phải trùng SKU của sản phẩm cha'
        : 'Sản phẩm cha: để trống Parent SKU',
    };
  };

  const appendExcelGuideSheet = (wb) => {
    const guideRows = [
      ['Cột', 'Bắt buộc', 'Ý nghĩa / cách nhập'],
      ['Loại dòng', 'Khuyến nghị', 'Nhập PARENT cho sản phẩm cha, VARIANT cho biến thể. Có thể bỏ trống để backend tự suy luận: có Parent SKU là VARIANT, không có Parent SKU là PARENT.'],
      ['SKU', 'Có', 'Sản phẩm cha dùng SKU để thêm mới/cập nhật. Biến thể sẽ được backend lưu trùng SKU cha; khi import biến thể nên nhập SKU trùng Parent SKU, hoặc SKU cũ nếu cần nhận diện dữ liệu legacy.'],
      ['Parent SKU', 'Có với VARIANT', 'SKU của sản phẩm cha. Parent SKU phải tồn tại trong cùng file hoặc đã có trong hệ thống. Dòng PARENT phải để trống cột này.'],
      ['Tên sản phẩm', 'Có với SKU mới', 'Tên sản phẩm cha hoặc tên biến thể. Với biến thể đã đồng bộ SKU theo SKU cha, tên biến thể là dữ liệu phân biệt để cập nhật đúng dòng.'],
      ['Tên cha', 'Tham khảo', 'Chỉ giúp người dùng đọc file; backend liên kết bằng Parent SKU.'],
      ['Giá nhập / Giá sỉ / Giá lẻ / Giá VIP', 'Không', 'Nhập số không âm. Có thể dùng định dạng 100000, 100.000 hoặc 100,000.'],
      ['Tồn kho', 'Không', 'Nhập số nguyên không âm.'],
      ['Đơn vị', 'Không', 'Ví dụ: cái, bộ, hộp. Biến thể bỏ trống sẽ lấy theo sản phẩm cha khi thêm mới.'],
      ['Danh mục text', 'Không', 'Tên/nhóm/từ khóa danh mục. Backend có thể tự khớp danh mục mặc định nếu đã cấu hình.'],
      ['Default category id', 'Không', 'ID danh mục mặc định nếu biết chính xác. Nếu không biết thì để trống và dùng Danh mục text.'],
      ['Supplier id', 'Không', 'ID nhà cung cấp nếu biết chính xác.'],
      ['Hoạt động', 'Không', 'Nhập Có/Không, 1/0 hoặc để trống. Bỏ trống sẽ mặc định là Có khi import.'],
      ['ID / Parent ID / Default category name / Supplier name / Ghi chú', 'Không', 'Cột tham khảo khi xuất file từ hệ thống; backend bỏ qua khi import.'],
      ['Alias được hỗ trợ', 'Không', 'Có thể dùng các cột phổ biến như Mã SKU, Ma SKU, Mã sản phẩm, Tên, SL hàng, So luong, Giá vốn, Giá bán, ĐVT, Danh mục, ParentSKU, SKU cha, Mã cha, Hoạt động, Trạng thái.'],
      ['Lưu ý', 'Có', 'Import validate toàn bộ file trước khi ghi để tránh mất quan hệ cha - con. Nếu có lỗi, dữ liệu chưa được ghi.'],
    ];
    const guideWs = XLSX.utils.aoa_to_sheet(guideRows);
    guideWs['!cols'] = [
      { wch: 28 },
      { wch: 14 },
      { wch: 110 },
    ];
    XLSX.utils.book_append_sheet(wb, guideWs, 'Hướng dẫn');
  };

  const buildProductsWorkbook = (rows) => {
    const ws = XLSX.utils.json_to_sheet(rows, { header: excelColumns });
    ws['!cols'] = excelColumns.map(column => ({ wch: Math.max(14, Math.min(36, column.length + 6)) }));
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: Math.max(rows.length, 1), c: excelColumns.length - 1 },
      }),
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sản phẩm');
    appendExcelGuideSheet(wb);
    return wb;
  };

  // ── XUẤT Excel ──
  const handleExportExcel = () => {
    const rows = [];
    products.forEach(parent => {
      rows.push(productToExcelRow(parent, 'PARENT'));
      (parent.variants || []).forEach(variant => {
        rows.push(productToExcelRow(variant, 'VARIANT', parent));
      });
    });

    const wb = buildProductsWorkbook(rows);
    XLSX.writeFile(wb, `danh_sach_san_pham_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleDownloadExcelTemplate = () => {
    const sampleRows = [
      {
        'Loại dòng': 'PARENT',
        'SKU': 'SP-MAU-001',
        'Parent SKU': '',
        'Tên sản phẩm': 'Áo thun cotton',
        'Tên cha': '',
        'Giá nhập': 80000,
        'Giá sỉ': 110000,
        'Giá lẻ': 150000,
        'Giá VIP': 130000,
        'Tồn kho': 0,
        'Đơn vị': 'cái',
        'Danh mục text': 'Áo thun',
        'Default category id': '',
        'Supplier id': '',
        'Hoạt động': 'Có',
        'ID': '',
        'Parent ID': '',
        'Default category name': '',
        'Supplier name': '',
        'Ghi chú': 'Dòng cha: Parent SKU để trống',
      },
      {
        'Loại dòng': 'VARIANT',
        'SKU': 'SP-MAU-001',
        'Parent SKU': 'SP-MAU-001',
        'Tên sản phẩm': 'Màu đỏ / Size S',
        'Tên cha': 'Áo thun cotton',
        'Giá nhập': 80000,
        'Giá sỉ': 110000,
        'Giá lẻ': 150000,
        'Giá VIP': 130000,
        'Tồn kho': 12,
        'Đơn vị': 'cái',
        'Danh mục text': 'Áo thun',
        'Default category id': '',
        'Supplier id': '',
        'Hoạt động': 'Có',
        'ID': '',
        'Parent ID': '',
        'Default category name': '',
        'Supplier name': '',
        'Ghi chú': 'Dòng biến thể: SKU được backend đồng bộ trùng SKU cha',
      },
      {
        'Loại dòng': 'VARIANT',
        'SKU': 'SP-MAU-001',
        'Parent SKU': 'SP-MAU-001',
        'Tên sản phẩm': 'Màu xanh / Size M',
        'Tên cha': 'Áo thun cotton',
        'Giá nhập': 82000,
        'Giá sỉ': 115000,
        'Giá lẻ': 155000,
        'Giá VIP': 135000,
        'Tồn kho': 8,
        'Đơn vị': 'cái',
        'Danh mục text': 'Áo thun',
        'Default category id': '',
        'Supplier id': '',
        'Hoạt động': 'Có',
        'ID': '',
        'Parent ID': '',
        'Default category name': '',
        'Supplier name': '',
        'Ghi chú': 'Có thể bỏ Loại dòng, backend vẫn suy luận là VARIANT vì có Parent SKU; SKU sau lưu trùng SKU cha',
      },
      {
        'Loại dòng': 'PARENT',
        'SKU': 'SP-MAU-002',
        'Parent SKU': '',
        'Tên sản phẩm': 'Bình giữ nhiệt 500ml',
        'Tên cha': '',
        'Giá nhập': 50000,
        'Giá sỉ': 70000,
        'Giá lẻ': 99000,
        'Giá VIP': 89000,
        'Tồn kho': 25,
        'Đơn vị': 'cái',
        'Danh mục text': 'Gia dụng',
        'Default category id': '',
        'Supplier id': '',
        'Hoạt động': 'Có',
        'ID': '',
        'Parent ID': '',
        'Default category name': '',
        'Supplier name': '',
        'Ghi chú': 'Sản phẩm cha không có biến thể',
      },
    ];
    const wb = buildProductsWorkbook(sampleRows);
    XLSX.writeFile(wb, `mau_import_san_pham_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const isImportMetadataColumn = (key) => ['__line', '_line', 'line', 'rowNumber', '__rowNum__'].includes(String(key));
  const hasExcelValue = (value) => !(value === undefined || value === null || String(value).trim() === '');
  const collectExcelReceivedColumns = (rows) => {
    const receivedColumns = [];
    const seen = new Set();
    rows.forEach(row => {
      Object.keys(row || {}).forEach(key => {
        if (isImportMetadataColumn(key)) return;
        const column = String(key).trim();
        if (!column || seen.has(column)) return;
        seen.add(column);
        receivedColumns.push(column);
      });
    });
    return receivedColumns;
  };
  const getHeaderColumnsFromSheet = (sheet) => {
    const aoaRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
    const headerRow = aoaRows.find(row => Array.isArray(row) && row.some(hasExcelValue));
    if (!headerRow) return [];
    return headerRow.map(value => String(value || '').trim()).filter(Boolean);
  };

  const normalizeExcelImportRows = (rows) => rows.map((row, index) => {
    const rowNumber = Number(row?.__rowNum__);
    const normalized = { __line: Number.isFinite(rowNumber) && rowNumber >= 0 ? rowNumber + 1 : index + 2 };
    Object.entries(row || {}).forEach(([key, value]) => {
      if (key === '__rowNum__') return;
      const column = String(key).trim();
      if (!column) return;
      if (!Object.prototype.hasOwnProperty.call(normalized, column)) {
        normalized[column] = value;
      } else if (column !== key) {
        normalized[key] = value;
      }
    });
    return normalized;
  }).filter(row => Object.entries(row).some(([key, value]) => !isImportMetadataColumn(key) && hasExcelValue(value)));

  const formatImportErrors = (errors = []) => errors.slice(0, 12).map(err => {
    if (typeof err === 'string') return err;
    const line = err.line || err.row || err.rowNumber;
    const field = err.field || err.column || err.col;
    const lineText = line ? `Dòng ${line}` : 'Dòng ?';
    const fieldText = field ? ` · Cột ${field}` : '';
    return `${lineText}${fieldText}: ${err.message || err.error || err.detail || 'Lỗi không xác định'}`;
  }).join('\n');

  const formatColumnList = (columns = []) => columns.filter(Boolean).slice(0, 24).join(', ') + (columns.length > 24 ? ', ...' : '');

  const parseApiResponse = async (res) => {
    const responseText = await res.text().catch(() => '');
    if (!responseText) return { data: {}, responseText: '' };
    try {
      return { data: JSON.parse(responseText), responseText };
    } catch (_) {
      return { data: {}, responseText };
    }
  };

  const formatImportFailureMessage = ({ response, data = {}, responseText = '', endpoint, sheetName, receivedColumns = [] }) => {
    const errors = Array.isArray(data.errors) ? data.errors : [];
    const expectedColumns = Array.isArray(data.expectedColumns) ? data.expectedColumns : requiredExcelColumns;
    const backendReceivedColumns = Array.isArray(data.receivedColumns) && data.receivedColumns.length > 0 ? data.receivedColumns : receivedColumns;
    const title = data.error || (!response?.ok ? `API trả về HTTP ${response?.status || '?'}` : '') || data.detail || 'File không hợp lệ';
    const lines = [`⚠️ Import Excel thất bại: ${title}`];

    if (data.detail && data.detail !== title) lines.push(`Chi tiết: ${data.detail}`);
    if (response) lines.push(`HTTP: ${response.status} ${response.statusText || ''}`.trim());
    if (sheetName) lines.push(`Sheet đã đọc: ${sheetName}`);
    if (backendReceivedColumns.length > 0) lines.push(`Cột nhận được: ${formatColumnList(backendReceivedColumns)}`);
    if (expectedColumns.length > 0) lines.push(`Cột chuẩn gợi ý: ${formatColumnList(expectedColumns)}`);
    if (errors.length > 0) {
      lines.push(`Một số lỗi đầu tiên (${Math.min(errors.length, 12)}/${errors.length}):`);
      lines.push(formatImportErrors(errors));
    }
    if (responseText && Object.keys(data).length === 0) {
      lines.push(`Phản hồi không phải JSON: ${responseText.slice(0, 500)}`);
    }
    if (!response || response.status >= 500 || Object.keys(data).length === 0) {
      lines.push(`Gợi ý: kiểm tra backend đã chạy và endpoint ${endpoint} truy cập được.`);
    }
    return lines.join('\n');
  };

  const formatImportSuccessMessage = (data = {}) => {
    const summary = data.summary || data.results || {};
    const skipped = summary.skipped ?? summary.skippedRows ?? summary.ignoredRows ?? 0;
    return [
      '✅ Nhập Excel thành công!',
      data.detail ? `Chi tiết: ${data.detail}` : '',
      `Tổng dòng có dữ liệu: ${summary.totalRows ?? 0}`,
      `Dòng hợp lệ: ${summary.validRows ?? summary.totalRows ?? 0}`,
      `Tạo mới sản phẩm cha: ${summary.createdParents ?? 0}`,
      `Cập nhật sản phẩm cha: ${summary.updatedParents ?? 0}`,
      `Tạo mới biến thể: ${summary.createdVariants ?? 0}`,
      `Cập nhật biến thể: ${summary.updatedVariants ?? 0}`,
      `Đồng bộ SKU biến thể: ${summary.syncedVariantSkus ?? 0}`,
      `Bỏ qua: ${skipped}`,
      `Số lỗi: ${summary.errors ?? 0}`,
    ].filter(Boolean).join('\n');
  };

  // ── NHẬP Excel ──
  const handleImportExcel = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const endpoint = `${API}/products/import-excel-rows`;
    const reader = new FileReader();

    reader.onerror = () => {
      alert(`⚠️ Không đọc được file "${file.name}". Vui lòng đóng file nếu đang mở và thử lại.`);
    };

    reader.onload = async (evt) => {
      const fileContent = evt.target?.result;
      if (!fileContent) {
        alert(`⚠️ File "${file.name}" không có nội dung đọc được.`);
        return;
      }

      let workbook;
      try {
        workbook = XLSX.read(fileContent, { type: 'array', raw: false });
      } catch (err) {
        alert(`⚠️ Không đọc được workbook Excel "${file.name}": ${err.message}`);
        return;
      }

      if (!workbook?.SheetNames?.length) {
        alert(`⚠️ File "${file.name}" không có sheet nào. Vui lòng dùng file .xlsx/.xls hợp lệ hoặc tải file mẫu.`);
        return;
      }

      const sheetName = workbook.SheetNames.includes('Sản phẩm') ? 'Sản phẩm' : workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      if (!sheet || !sheet['!ref']) {
        alert(`⚠️ Sheet "${sheetName}" trống hoặc không đọc được dữ liệu.`);
        return;
      }

      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
      const headerColumns = getHeaderColumnsFromSheet(sheet);
      const receivedColumns = collectExcelReceivedColumns(rows);
      const displayColumns = receivedColumns.length > 0 ? receivedColumns : headerColumns;
      if (displayColumns.length === 0) {
        alert(`⚠️ Sheet "${sheetName}" không có hàng tiêu đề cột. Vui lòng dùng sheet "Sản phẩm" trong file mẫu.`);
        return;
      }

      const importRows = normalizeExcelImportRows(rows);
      if (importRows.length === 0) {
        alert(`⚠️ Sheet "${sheetName}" có tiêu đề nhưng không có dòng dữ liệu.\nCột nhận được: ${formatColumnList(displayColumns)}`);
        return;
      }

      if (!confirm(`Tìm thấy ${importRows.length} dòng dữ liệu trong sheet "${sheetName}".\nCột nhận được: ${formatColumnList(displayColumns)}\n\nImport sẽ upsert sản phẩm cha theo SKU; biến thể liên kết theo Parent SKU và sẽ được backend đồng bộ SKU trùng SKU cha. Nếu thiếu "Loại dòng", backend sẽ tự suy luận theo Parent SKU. Dữ liệu chỉ ghi khi toàn bộ file hợp lệ. Tiếp tục?`)) return;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: importRows, receivedColumns: displayColumns, sheetName, fileName: file.name }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const { data, responseText } = await parseApiResponse(res);
        if (!res.ok || data.ok === false) {
          alert(formatImportFailureMessage({ response: res, data, responseText, endpoint, sheetName, receivedColumns: displayColumns }));
          return;
        }

        alert(formatImportSuccessMessage(data));
        fetchProducts();
      } catch (err) {
        const detail = err.name === 'AbortError'
          ? 'Backend không phản hồi sau 30 giây.'
          : err.message;
        alert([
          '📡 Không thể gửi dữ liệu import Excel tới backend.',
          `Endpoint: ${endpoint}`,
          `Chi tiết: ${detail}`,
          'Gợi ý: kiểm tra backend đã chạy, đúng cổng API và không bị chặn kết nối.',
        ].join('\n'));
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const openAdd = () => {
    setEditing(null);
    setForm({
      sku: `SP${random5Digits()}`,
      name: '',
      import_price: '',
      wholesale_price: '',
      retail_price: '',
      vip_price: '',
      stock: '',
      unit: 'cái',
      category: '',
      supplier_id: ''
    });
    setShowForm(true);
  };

  const openEdit = (p) => {
    setEditing(p);
    setForm({
      sku: p.sku || '', name: p.name,
      import_price: p.import_price || '', wholesale_price: p.wholesale_price || '',
      retail_price: p.retail_price || '', vip_price: p.vip_price || '',
      stock: p.stock || '', unit: p.unit || 'cái', category: p.category || '',
      supplier_id: p.supplier_id || '',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!form.name?.trim()) { alert('Vui lòng nhập tên sản phẩm!'); return; }
    setSaving(true);
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing ? `${API}/products/${editing.id}` : `${API}/products`;
      const payload = {
        ...form,
        category: String(form.category || '').trim(),
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      if (data.ok) {
        alert(editing ? '✅ Đã cập nhật sản phẩm!' : `✅ Tạo sản phẩm thành công!\nMã: ${data.id}`);
        setShowForm(false);
        setEditing(null);
        setForm({ sku: '', name: '', import_price: '', wholesale_price: '', retail_price: '', vip_price: '', stock: '', unit: 'cái', category: '', supplier_id: '' });
        fetchProducts();
      } else {
        alert(`⚠️ Lỗi: ${data.error || 'Không rõ lỗi!'}`);
      }
    } catch (err) {
      if (err.name === 'AbortError') alert('⏱️ Server không phản hồi sau 10 giây.');
      else alert(`📡 Lỗi kết nối: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Xóa sản phẩm này? Tất cả biến thể sẽ bị xóa.')) return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      await fetch(`${API}/products/${id}`, { method: 'DELETE', signal: controller.signal });
      clearTimeout(timer);
      alert('✅ Đã xóa sản phẩm!');
      fetchProducts();
    } catch (err) {
      if (err.name === 'AbortError') alert('⏱️ Server không phản hồi.');
      else alert(`📡 Lỗi kết nối: ${err.message}`);
    }
  };

  // Variants
  const openAddVariant = (parent) => {
    setVariantParent(parent);
    setEditingVariant(null);
    setVariantForm({ sku: parent.sku || '', name: '', import_price: '', wholesale_price: '', retail_price: '', vip_price: '', stock: '', unit: parent.unit || 'cái' });
    setShowVariantModal(true);
  };

  const openEditVariant = (variant, parent) => {
    setVariantParent(parent);
    setEditingVariant(variant);
    setVariantForm({
      sku: parent.sku || variant.sku || '', name: variant.name,
      import_price: variant.import_price || '', wholesale_price: variant.wholesale_price || '',
      retail_price: variant.retail_price || '', vip_price: variant.vip_price || '',
      stock: variant.stock || '', unit: variant.unit || 'cái',
    });
    setShowVariantModal(true);
  };

  const handleVariantSubmit = async () => {
    if (!variantForm.name?.trim()) { alert('Vui lòng nhập tên biến thể!'); return; }
    if (!variantParent || !variantParent.id) { alert('Lỗi: Không tìm thấy sản phẩm cha!'); return; }
    setSaving(true);
    try {
      const method = editingVariant ? 'PUT' : 'POST';
      const url = editingVariant
        ? `${API}/products/variants/${editingVariant.id}`
        : `${API}/products/${variantParent.id}/variants`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...variantForm, sku: variantParent.sku || variantForm.sku || '' }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await res.json();
      if (data.ok) {
        alert(editingVariant ? '✅ Đã cập nhật biến thể!' : '✅ Tạo biến thể thành công!');
        setShowVariantModal(false);
        fetchProducts();
      } else {
        alert(`⚠️ Lỗi: ${data.error || 'Không rõ lỗi!'}`);
      }
    } catch (err) {
      if (err.name === 'AbortError') alert('⏱️ Server không phản hồi!');
      else alert(`📡 Lỗi kết nối: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteVariant = async (variantId) => {
    if (!confirm('Xóa biến thể này?')) return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      await fetch(`${API}/products/variants/${variantId}`, { method: 'DELETE', signal: controller.signal });
      clearTimeout(timer);
      alert('✅ Đã xóa biến thể!');
      fetchProducts();
    } catch (err) {
      if (err.name === 'AbortError') alert('⏱️ Server không phản hồi.');
      else alert(`📡 Lỗi kết nối: ${err.message}`);
    }
  };

  const toggleExpand = (id) => {
    setExpandedParents(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const activeCategories = useMemo(() => sortActiveCategories(categories), [categories]);
  const categoriesById = useMemo(() => buildCategoriesById(activeCategories), [activeCategories]);
  const comboProductOptions = useMemo(() => searchFlatProducts(products, '', { categoriesById })
    .map(item => {
      const isVariant = Boolean(item.is_variant || item.parent_id);
      const parentId = isVariant ? (item.parent_id || item.parent?.id || null) : item.id;
      return {
        key: isVariant ? `variant-${item.id}` : `product-${item.id}`,
        item_type: isVariant ? 'variant' : 'product',
        product_id: parentId,
        variant_id: isVariant ? item.id : null,
        parent_id: isVariant ? parentId : null,
        parent_name: isVariant ? (item.parent_name || item.parent?.name || '') : '',
        parent_sku: isVariant ? (item.parent_sku || item.parent?.sku || '') : '',
        name: item.name || '',
        sku: item.sku || '',
        stock: item.stock ?? 0,
        retail_price: item.retail_price ?? 0,
        wholesale_price: item.wholesale_price ?? 0,
      };
    }), [products, categoriesById]);
  const filteredComboProductOptions = useMemo(() => {
    const selectedKeys = new Set(comboItems.map(getComboItemKey));
    const rows = searchFlatProducts(products, comboProductSearch, { categoriesById }).map(item => {
      const isVariant = Boolean(item.is_variant || item.parent_id);
      const parentId = isVariant ? (item.parent_id || item.parent?.id || null) : item.id;
      const option = {
        key: isVariant ? `variant-${item.id}` : `product-${item.id}`,
        item_type: isVariant ? 'variant' : 'product',
        product_id: parentId,
        variant_id: isVariant ? item.id : null,
        parent_id: isVariant ? parentId : null,
        parent_name: isVariant ? (item.parent_name || item.parent?.name || '') : '',
        parent_sku: isVariant ? (item.parent_sku || item.parent?.sku || '') : '',
        name: item.name || '',
        sku: item.sku || '',
        stock: item.stock ?? 0,
        retail_price: item.retail_price ?? 0,
        wholesale_price: item.wholesale_price ?? 0,
      };
      return { ...option, selected: selectedKeys.has(option.key) };
    });
    return rows.slice(0, comboProductSearch.trim() ? 80 : 40);
  }, [products, comboProductSearch, categoriesById, comboItems]);
  const normalizedSearch = normalizeSearchText(search);
  const isSearching = Boolean(normalizedSearch);
  const filtered = filterProductTree(products, search, { categoriesById, includeAllVariantsOnParentMatch: true });
  const stockSortButtonClass = (direction) => `inline-flex items-center justify-center w-7 h-7 rounded-full border transition ${stockSortDirection === direction
    ? 'bg-orange-100 border-orange-300 text-orange-700'
    : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-orange-600'
    }`;
  const displayedProducts = useMemo(() => {
    if (!stockSortDirection) return filtered;

    return [...filtered].sort((a, b) => {
      const stockA = Number(a?.stock ?? 0);
      const stockB = Number(b?.stock ?? 0);
      return stockSortDirection === 'desc' ? stockB - stockA : stockA - stockB;
    });
  }, [filtered, stockSortDirection]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Package className="text-blue-600" size={24} /> Quản lý Sản phẩm
        </h1>
        <div className="flex gap-2">
          <button onClick={() => setShowHelp(true)} className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg text-sm font-medium flex items-center gap-1.5">
            <HelpCircle size={16} /> Hướng dẫn
          </button>
          <button onClick={() => setShowComboSection(s => !s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 border transition ${showComboSection ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-purple-700 border-purple-300 hover:bg-purple-50'
              }`}>
            <Layers size={16} /> Combo ({combos.length})
          </button>
          <button onClick={() => excelInputRef.current.click()}
            className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 border border-green-300 bg-white text-green-700 hover:bg-green-50 transition">
            <Upload size={16} /> Nhập Excel
          </button>
          <input ref={excelInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportExcel} />
          <button onClick={handleExportExcel}
            className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 border border-orange-300 bg-white text-orange-700 hover:bg-orange-50 transition">
            <Download size={16} /> Xuất Excel
          </button>
          {selectedProducts.length > 0 && (
            <button onClick={handleBulkDelete} disabled={isBulkDeleting}
              className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 transition disabled:opacity-50">
              <Trash2 size={16} /> Xóa ({selectedProducts.length})
            </button>
          )}
          <button onClick={openAdd} className="btn-primary flex items-center gap-1">
            <Plus size={16} /> Thêm sản phẩm
          </button>
        </div>
      </div>

      {/* ===== CATEGORY SECTION ===== */}
      {showCategorySection && (
        <div className="mb-6 border rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-teal-700 flex items-center gap-2">
              <Tag size={20} /> Danh mục mặc định sản phẩm
            </h2>
            <button onClick={openCategoryAdd} className="px-3 py-1.5 border border-teal-300 text-teal-700 hover:bg-teal-50 rounded-lg text-xs font-medium">
              + Tạo mới
            </button>
          </div>
          <form onSubmit={handleCategorySubmit} className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-4">
            <input className="input-field text-sm" placeholder="Tên: vòng led" value={categoryForm.name} onChange={e => setCategoryForm(f => ({ ...f, name: e.target.value }))} />
            <input className="input-field text-sm" placeholder="Nhóm: vòng" value={categoryForm.group_name} onChange={e => setCategoryForm(f => ({ ...f, group_name: e.target.value }))} />
            <input className="input-field text-sm md:col-span-2" placeholder="Từ khóa: vòng, led, dẻo" value={categoryForm.keywords} onChange={e => setCategoryForm(f => ({ ...f, keywords: e.target.value }))} />
            <input className="input-field text-sm" placeholder="Alias: vong led" value={categoryForm.aliases} onChange={e => setCategoryForm(f => ({ ...f, aliases: e.target.value }))} />
            <button type="submit" className="btn-success text-sm">{editingCategory ? 'Lưu danh mục' : 'Thêm danh mục'}</button>
            {editingCategory && (
              <button type="button" onClick={openCategoryAdd} className="md:col-span-6 text-xs text-gray-500 hover:text-gray-700 text-left">Hủy sửa danh mục đang chọn</button>
            )}
          </form>
          <div className="mb-2 text-xs text-gray-500">
            Danh sách xem lại {activeCategories.length} danh mục đã tạo trong dữ liệu hiện tại.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
            {activeCategories.map(category => (
              <div key={category.id} className="border rounded-lg p-3 bg-gray-50 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-gray-800 truncate">{category.name}</div>
                  <div className="text-xs text-gray-500 truncate">Nhóm: {category.group_name || '—'}</div>
                  <div className="text-[11px] text-teal-600 truncate">{[...(category.keywords || []), ...(category.aliases || [])].join(', ') || 'Chưa có từ khóa'}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openCategoryEdit(category)} className="text-blue-600 hover:text-blue-800 p-1 border border-blue-200 rounded" title="Sửa danh mục"><Edit2 size={12} /></button>
                  <button onClick={() => handleCategoryDelete(category)} className="text-red-500 hover:text-red-700 p-1 border border-red-200 rounded" title="Vô hiệu danh mục"><Trash2 size={12} /></button>
                </div>
              </div>
            ))}
            {activeCategories.length === 0 && <div className="text-sm text-gray-400 border-2 border-dashed rounded-lg p-6 text-center md:col-span-2 xl:col-span-4">Chưa có danh mục mặc định</div>}
          </div>
        </div>
      )}

      {/* ===== COMBO SECTION ===== */}
      {showComboSection && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-purple-700 flex items-center gap-2">
              <Layers size={20} /> Danh sách Combo
            </h2>
            <button onClick={openComboAdd}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium flex items-center gap-1">
              <Plus size={14} /> Tạo Combo
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {combos.length === 0 && (
              <div className="col-span-3 text-center text-gray-400 py-10 border-2 border-dashed rounded-xl">
                Chưa có combo nào — nhấn "Tạo Combo" để bắt đầu
              </div>
            )}
            {combos.map(c => (
              <div key={c.id} className="border rounded-xl p-4 bg-white hover:shadow-md transition">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-base text-gray-800 truncate">{c.name}</div>
                    <div className="text-xs text-gray-400">SKU: {c.sku || '—'}</div>
                  </div>
                  <div className="flex gap-1 ml-2">
                    <button onClick={() => openComboEdit(c)} className="text-blue-500 hover:text-blue-700 p-1.5 rounded border border-blue-300 hover:bg-blue-50" title="Sửa">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleComboDelete(c.id)} className="text-red-400 hover:text-red-600 p-1.5 rounded border border-red-300 hover:bg-red-50" title="Xóa">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Items */}
                <div className="mb-3 space-y-1">
                  {(c.items || []).map((it, idx) => (
                    <div key={it.id || idx} className="text-xs text-gray-600 flex items-center gap-1.5 bg-gray-50 rounded px-2 py-1">
                      <span className="font-semibold text-purple-600">{it.quantity}×</span>
                      <span className="truncate">{it.product_name}{it.variant_name ? ` / ${it.variant_name}` : ''}</span>
                    </div>
                  ))}
                  {(c.items || []).length === 0 && (
                    <div className="text-xs text-gray-400 italic">Chưa thêm sản phẩm nào</div>
                  )}
                </div>

                {/* Prices */}
                <div className="grid grid-cols-3 gap-2 text-center border-t pt-2">
                  <div>
                    <div className="text-[10px] text-gray-400">Lẻ</div>
                    <div className="text-xs font-bold text-blue-600">{c.retail_price ? formatVND(c.retail_price) : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-400">Sỉ</div>
                    <div className="text-xs font-bold text-orange-600">{c.wholesale_price ? formatVND(c.wholesale_price) : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-400">VIP</div>
                    <div className="text-xs font-bold text-purple-600">{c.vip_price ? formatVND(c.vip_price) : '—'}</div>
                  </div>
                </div>
                {!c.retail_price && !c.wholesale_price && !c.vip_price && (
                  <div className="text-xs text-red-400 italic mt-1">Chưa đặt giá</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <input className="input-field mb-4" placeholder="🔍 Tìm tên, SKU, danh mục, nhóm, màu, size... VD: vòng led, dẻo 10cm, xanh nhạt" value={search} onChange={e => setSearch(e.target.value)} />

      {/* Products + Variants Table */}
      <div className="card overflow-x-auto">
        {/* Header row - LUÔN HIỂN THỊ */}
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-xs text-gray-600 font-semibold border-b sticky top-0 z-10">
          <button
            onClick={toggleSelectAll}
            className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-blue-600"
            title={selectedProducts.length === filtered.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
          >
            {selectedProducts.length === filtered.length ? <CheckSquare size={16} /> : <Square size={16} />}
          </button>
          <div className="flex-1">Tên sản phẩm</div>
          <div className="w-20 flex items-center justify-end gap-1">
            <span>Tồn kho</span>
            <span className="inline-flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setStockSortDirection('desc')}
                className={stockSortButtonClass('desc')}
                title="Sắp xếp tồn kho từ nhiều nhất đến ít nhất"
                aria-pressed={stockSortDirection === 'desc'}
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => setStockSortDirection('asc')}
                className={stockSortButtonClass('asc')}
                title="Sắp xếp tồn kho từ ít nhất đến nhiều nhất"
                aria-pressed={stockSortDirection === 'asc'}
              >
                <ArrowDown size={14} />
              </button>
            </span>
          </div>
          <div className="w-24 text-right">Giá nhập</div>
          <div className="w-24 text-right">Giá lẻ</div>
          <div className="w-24 text-right">Giá sỉ</div>
          <div className="w-24 text-right">Giá ký gửi</div>
          <div className="w-40 text-right">Hành động</div>
        </div>

        {filtered.length === 0 && (
          <div className="text-center text-gray-400 py-10">Không có sản phẩm nào</div>
        )}

        {displayedProducts.map(p => {
          const variantRows = p.variants?.filter(v =>
            !isSearching || p._matchesParentSearch || p._matchedVariantIds?.includes(v.id)
          ) || [];

          return (
          <div key={p.id} className="border-b last:border-0">
            {/* Parent Row */}
            <div className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition">
              {/* Checkbox */}
              <button
                onClick={() => toggleSelectProduct(p.id)}
                className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-blue-600"
                title={selectedProducts.includes(p.id) ? 'Bỏ chọn' : 'Chọn'}
              >
                {selectedProducts.includes(p.id) ? <CheckSquare size={16} /> : <Square size={16} />}
              </button>

              {/* Expand button */}
              {p.variants?.length > 0 && (
                <button onClick={() => toggleExpand(p.id)} className="text-gray-400 hover:text-gray-700">
                  {expandedParents[p.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
              )}
              {p.variants?.length === 0 && <div className="w-5" />}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`font-medium text-sm ${p.stock === 0 ? 'text-red-500' : ''}`}>{p.name}</span>
                  {p.variants?.length > 0 && (
                    <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                      {p.variants.length} biến thể
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400">
                  {p.sku} · {getCategoryName(p)} · {getSupplierName(p.supplier_id)}
                </div>
              </div>

              {/* TỒN KHO (đúng vị trí header) */}
              <div className={`text-right font-semibold text-sm w-20 ${p.stock === 0 ? 'text-red-500 font-bold' : p.stock < 10 ? 'text-red-600' : 'text-green-600'}`}>
                {p.stock === 0 ? 'Hết hàng' : p.stock}
              </div>

              {/* Giá nhập */}
              <div className="text-right text-xs text-gray-500 w-24">{formatVND(p.import_price)}</div>

              {/* Giá lẻ */}
              <div className="text-right text-xs text-green-600 font-medium w-24">{formatVND(p.retail_price)}</div>

              {/* Giá sỉ */}
              <div className="text-right text-xs text-red-600 font-medium w-24">{formatVND(p.wholesale_price)}</div>

              {/* Giá VIP (ký gửi) */}
              <div className="text-right text-xs text-blue-600 font-medium w-24">{formatVND(p.vip_price)}</div>

              <div className="flex items-center gap-1 w-40 justify-end">
                <button onClick={() => openAddVariant(p)} className="text-green-600 hover:text-green-800 p-1.5 rounded border border-green-300 hover:bg-green-50" title="Thêm biến thể">
                  <Plus size={14} />
                </button>
                <button onClick={() => openEdit(p)} className="text-blue-600 hover:text-blue-800 p-1.5 rounded border border-blue-300 hover:bg-blue-50" title="Sửa">
                  <Edit2 size={14} />
                </button>
                <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:text-red-700 p-1.5 rounded border border-red-300 hover:bg-red-50" title="Xóa">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {/* Variant Rows */}
            {(expandedParents[p.id] || isSearching) && variantRows.map(v => (
              <div key={v.id} className={`flex items-center gap-2 px-3 py-2 pl-12 bg-gray-50 border-t ${v.stock === 0 ? 'opacity-60' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${v.stock === 0 ? 'text-red-400 line-through' : 'text-gray-700'}`}>{v.name}</div>
                  <div className="text-xs text-gray-400">
                    {v.sku} · {getCategoryName(v) || getCategoryName(p)} · {getSupplierName(v.supplier_id || p.supplier_id)}
                  </div>
                </div>

                {/* Tồn kho */}
                <div className={`text-right font-semibold text-sm w-20 ${v.stock === 0 ? 'text-red-500 font-bold' : v.stock < 10 ? 'text-red-600' : 'text-green-600'}`}>
                  {v.stock === 0 ? 'Hết hàng' : v.stock}
                </div>

                {/* Giá nhập */}
                <div className="text-right text-xs text-gray-500 w-24">{formatVND(v.import_price)}</div>

                {/* Giá lẻ */}
                <div className="text-right text-xs text-green-600 font-medium w-24">{formatVND(v.retail_price)}</div>

                {/* Giá sỉ */}
                <div className="text-right text-xs text-red-600 font-medium w-24">{formatVND(v.wholesale_price)}</div>

                {/* Giá VIP (ký gửi) */}
                <div className="text-right text-xs text-blue-600 font-medium w-24">{formatVND(v.vip_price)}</div>

                <div className="flex items-center gap-1 w-40 justify-end">
                  <button onClick={() => openEditVariant(v, p)} className="text-blue-600 hover:text-blue-800 p-1.5 rounded border border-blue-300 hover:bg-blue-50" title="Sửa">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => handleDeleteVariant(v.id)} className="text-red-500 hover:text-red-700 p-1.5 rounded border border-red-300 hover:bg-red-50" title="Xóa">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          );
        })}
      </div>

      {/* Form Modal - Sản phẩm cha */}
      {showForm && !variantParent && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40">
          <div className="bg-white rounded-xl p-6 w-[600px]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Package size={20} className="text-blue-600" />
                {editing ? 'Sửa sản phẩm' : 'Thêm sản phẩm mới'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3 mb-4">
              <div><label className="text-xs text-gray-500">Tên sản phẩm <span className="text-red-500">*</span></label><input className="input-field w-full" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="tên sản phẩm" autoFocus /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">Giá nhập</label><input type="number" className="input-field" value={form.import_price} onChange={e => setForm({ ...form, import_price: e.target.value })} placeholder="giá nhập" /></div>
                <div><label className="text-xs text-gray-500">Giá lẻ</label><input type="number" className="input-field" value={form.retail_price} onChange={e => setForm({ ...form, retail_price: e.target.value })} placeholder="giá lẻ" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">Giá sỉ</label><input type="number" className="input-field" value={form.wholesale_price} onChange={e => setForm({ ...form, wholesale_price: e.target.value })} placeholder="giá sỉ" /></div>
                <div><label className="text-xs text-gray-500">Giá VIP</label><input type="number" className="input-field" value={form.vip_price} onChange={e => setForm({ ...form, vip_price: e.target.value })} placeholder="giá VIP" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">Tồn kho</label><input type="number" className="input-field" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} placeholder="tồn kho" /></div>
                <div><label className="text-xs text-gray-500">Đơn vị tính</label><input className="input-field" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="đơn vị tính" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">SKU</label><input className="input-field" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="mã sản phẩm" /></div>
                <div><label className="text-xs text-gray-500">Danh mục dạng text</label><input className="input-field w-full" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="nhập tên danh mục nếu cần" /></div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Nhà cung cấp</label>
                <select className="input-field w-full" value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })}>
                  <option value="">-- Chọn nhà cung cấp --</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name} {s.phone ? `(${s.phone})` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={saving}
                  className="btn-success flex-1 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  💾 {saving ? 'Đang lưu...' : (editing ? 'Lưu thay đổi' : 'Lưu')}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-danger flex-1">Hủy</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Form Modal - Biến thể */}
      {showVariantModal && variantParent && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[500px]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Package size={20} className="text-green-600" />
                {editingVariant ? 'Sửa biến thể' : `Biến thể của: ${variantParent.name}`}
              </h2>
              <button onClick={() => setShowVariantModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); handleVariantSubmit(); }} className="space-y-3 mb-4">
              <div><label className="text-xs text-gray-500">Tên biến thể <span className="text-red-500">*</span></label><input className="input-field w-full" value={variantForm.name} onChange={e => setVariantForm({ ...variantForm, name: e.target.value })} placeholder="tên biến thể" autoFocus /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">Giá nhập</label><input type="number" className="input-field" value={variantForm.import_price} onChange={e => setVariantForm({ ...variantForm, import_price: e.target.value })} placeholder="giá nhập" /></div>
                <div><label className="text-xs text-gray-500">Giá lẻ</label><input type="number" className="input-field" value={variantForm.retail_price} onChange={e => setVariantForm({ ...variantForm, retail_price: e.target.value })} placeholder="giá lẻ" /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-xs text-gray-500">Giá sỉ</label><input type="number" className="input-field" value={variantForm.wholesale_price} onChange={e => setVariantForm({ ...variantForm, wholesale_price: e.target.value })} placeholder="giá sỉ" /></div>
                <div><label className="text-xs text-gray-500">Giá VIP</label><input type="number" className="input-field" value={variantForm.vip_price} onChange={e => setVariantForm({ ...variantForm, vip_price: e.target.value })} placeholder="giá VIP" /></div>
                <div><label className="text-xs text-gray-500">Tồn kho</label><input type="number" className="input-field" value={variantForm.stock} onChange={e => setVariantForm({ ...variantForm, stock: e.target.value })} placeholder="tồn kho" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">SKU (tự đồng bộ theo sản phẩm cha)</label>
                  <input className="input-field w-full bg-gray-100 text-gray-500 cursor-not-allowed" value={variantParent?.sku || variantForm.sku || ''} readOnly disabled placeholder="SKU sản phẩm cha" />
                  <span className="text-[10px] text-blue-500">Backend luôn lưu SKU biến thể trùng SKU cha; sửa SKU sản phẩm cha sẽ tự cập nhật tất cả biến thể.</span>
                </div>
                <div><label className="text-xs text-gray-500">Đơn vị tính</label><input className="input-field" value={variantForm.unit} onChange={e => setVariantForm({ ...variantForm, unit: e.target.value })} placeholder="cái" /></div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={saving} className="btn-success flex-1 disabled:opacity-50 disabled:cursor-not-allowed">
                  💾 {saving ? 'Đang lưu...' : 'Lưu biến thể'}
                </button>
                <button type="button" onClick={() => setShowVariantModal(false)} className="btn-danger flex-1">Hủy</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== COMBO FORM MODAL ===== */}
      {showComboForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-[780px] max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b bg-purple-50 rounded-t-xl">
              <div>
                <h2 className="text-lg font-bold text-purple-800 flex items-center gap-2">
                  <Layers size={20} />
                  {editingCombo ? 'Sửa Combo' : 'Tạo Combo mới'}
                </h2>
                <p className="text-xs text-purple-500">{editingCombo ? `Combo: ${editingCombo.name}` : 'Gộp nhiều sản phẩm thành 1 gói'}</p>
              </div>
              <button onClick={() => setShowComboForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="flex-1 overflow-auto p-5 space-y-4">
              {/* Combo info */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-gray-500 block mb-1">Tên Combo <span className="text-red-500">*</span></label>
                  <input className="input-field w-full" value={comboForm.name}
                    onChange={e => setComboForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="VD: Bộ combo kệ sách 3 tầng" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">SKU</label>
                  <input className="input-field w-full" value={comboForm.sku}
                    onChange={e => setComboForm(f => ({ ...f, sku: e.target.value }))} placeholder="COMBO01" />
                </div>
              </div>

              {/* Prices */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Giá lẻ <span className="text-red-500">*</span></label>
                  <input type="number" className="input-field w-full" value={comboForm.retail_price}
                    onChange={e => setComboForm(f => ({ ...f, retail_price: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Giá sỉ <span className="text-red-500">*</span></label>
                  <input type="number" className="input-field w-full" value={comboForm.wholesale_price}
                    onChange={e => setComboForm(f => ({ ...f, wholesale_price: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Giá VIP</label>
                  <input type="number" className="input-field w-full" value={comboForm.vip_price}
                    onChange={e => setComboForm(f => ({ ...f, vip_price: e.target.value }))} placeholder="0" />
                </div>
              </div>

              {/* Combo items */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-gray-100 px-4 py-2 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-sm font-semibold text-gray-700">Sản phẩm trong combo</span>
                    <div className="text-[11px] text-gray-500">Chọn từ {comboProductOptions.length} sản phẩm cha/biến thể hiện có</div>
                  </div>
                  <button type="button" onClick={addComboItem}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium flex items-center gap-1">
                    <Plus size={13} /> Thêm sản phẩm
                  </button>
                </div>

                {showComboProductSearch && (
                  <div className="p-3 border-b bg-blue-50/60">
                    <div className="flex items-center gap-2 mb-2">
                      <input className="input-field flex-1 text-sm" autoFocus
                        placeholder="🔍 Tìm theo tên, SKU sản phẩm cha hoặc biến thể..."
                        value={comboProductSearch}
                        onChange={e => setComboProductSearch(e.target.value)} />
                      <button type="button" onClick={() => setShowComboProductSearch(false)}
                        className="px-3 py-2 border border-gray-300 text-gray-600 hover:bg-white rounded-lg text-xs font-medium">
                        Đóng
                      </button>
                    </div>
                    <div className="max-h-64 overflow-auto space-y-1">
                      {filteredComboProductOptions.length === 0 && (
                        <div className="text-center text-gray-400 text-sm py-5 bg-white rounded-lg border border-dashed">
                          Không tìm thấy sản phẩm phù hợp
                        </div>
                      )}
                      {filteredComboProductOptions.map(option => (
                        <button key={option.key} type="button" onClick={() => selectComboProduct(option)}
                          className={`w-full text-left border rounded-lg px-3 py-2 transition ${option.selected ? 'bg-purple-50 border-purple-200' : 'bg-white hover:bg-blue-50 border-gray-200'}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${option.item_type === 'variant' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                  {option.item_type === 'variant' ? 'Biến thể' : 'Sản phẩm cha'}
                                </span>
                                <span className="font-semibold text-sm text-gray-800 truncate">
                                  {option.item_type === 'variant' ? `${option.parent_name} / ${option.name}` : option.name}
                                </span>
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                SKU: {option.sku || '—'}{option.parent_sku ? ` · SKU cha: ${option.parent_sku}` : ''} · Tồn: {option.stock ?? 0}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-xs font-bold text-green-600">{formatVND(option.retail_price)}</div>
                              <div className="text-[11px] text-orange-600">Sỉ: {formatVND(option.wholesale_price)}</div>
                              {option.selected && <div className="text-[10px] text-purple-600 font-semibold">Đã chọn · bấm để +1 SL</div>}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="p-3 space-y-2 max-h-72 overflow-auto">
                  {comboItems.length === 0 && (
                    <div className="text-center text-gray-400 text-sm py-6 border-2 border-dashed rounded-lg">
                      Nhấn "Thêm sản phẩm" để tìm và chọn sản phẩm cha hoặc biến thể
                    </div>
                  )}
                  {comboItems.map((item, idx) => (
                    <div key={item.id || getComboItemKey(item) || idx} className="flex items-center gap-3 border rounded-lg p-3 bg-gray-50">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${item.variant_id ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                            {item.variant_id ? 'Biến thể' : 'Sản phẩm cha'}
                          </span>
                          <span className="font-semibold text-sm text-gray-800 truncate">
                            {item.variant_id ? `${item.product_name || item.parent_name || 'Sản phẩm'} / ${item.variant_name || item.name || 'Biến thể'}` : (item.product_name || item.name || 'Sản phẩm')}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          SKU: {item.sku || '—'} · Tồn: {item.stock ?? 0} · Giá lẻ: {formatVND(item.retail_price || item.unit_price || 0)} · Giá sỉ: {formatVND(item.wholesale_price || 0)}
                        </div>
                      </div>
                      <div className="w-24">
                        <label className="text-[10px] text-gray-500 block mb-1 text-center">Số lượng</label>
                        <input type="number" min="1"
                          className="w-full text-center border rounded px-2 py-1.5 text-sm font-semibold"
                          value={item.quantity}
                          onChange={e => updateComboItem(idx, 'quantity', e.target.value)}
                          title="Số lượng" />
                      </div>
                      <button type="button" onClick={() => removeComboItem(idx)} className="text-red-400 hover:text-red-600 p-1.5" title="Xóa khỏi combo">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t bg-gray-50 rounded-b-xl flex gap-2">
              <button onClick={() => setShowComboForm(false)}
                className="flex-1 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">
                Hủy
              </button>
              <button onClick={handleComboSubmit}
                className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-bold flex items-center justify-center gap-1">
                💾 {editingCombo ? 'Lưu thay đổi' : 'Tạo Combo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[760px] max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <HelpCircle size={20} className="text-blue-600" />
                Hướng dẫn quản lý Sản phẩm
              </h2>
              <button onClick={() => setShowHelp(false)} className="text-gray-400 hover:text-gray-600">
                <svg size={20} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">📦 Sản phẩm cha & Biến thể</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Sản phẩm cha:</strong> Sản phẩm chính, không có parent_id</li>
                  <li><strong>Biến thể:</strong> Các phiên bản cụ thể của sản phẩm cha (màu sắc, size...)</li>
                  <li>Nhấn vào tên sản phẩm cha có biến thể để mở rộng xem danh sách</li>
                  <li>Tổng tồn kho = tổng tất cả biến thể + tồn kho sản phẩm cha</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">➕ Thêm sản phẩm mới</h3>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Nhấn nút <strong>"Thêm sản phẩm"</strong></li>
                  <li>Điền đầy đủ thông tin: Tên, SKU (tự động), giá các loại, tồn kho, đơn vị, danh mục, nhà cung cấp</li>
                  <li>SKU được tự động tạo: "SP" + 5 số ngẫu nhiên (1-9)</li>
                  <li>Nhấn "Lưu" để hoàn tất</li>
                </ol>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">➕ Thêm biến thể</h3>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Nhấn nút <strong>+</strong> ở cột hành động của sản phẩm cha</li>
                  <li>Nhập tên biến thể (VD: "Màu Đỏ", "Size L")</li>
                  <li>SKU biến thể được backend tự động đồng bộ trùng SKU của sản phẩm cha</li>
                  <li>Điền giá và tồn kho cho biến thể này</li>
                </ol>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📥 Nhập/Xuất Excel sản phẩm</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Nên dùng <strong>"Tải mẫu Excel"</strong> hoặc <strong>"Xuất Excel"</strong> từ hệ thống rồi chỉnh sửa và nhập lại.</li>
                  <li>Sheet chuẩn là <strong>"Sản phẩm"</strong>; nếu file không có sheet này, hệ thống sẽ đọc sheet đầu tiên.</li>
                  <li>Cột chuẩn: <strong>Loại dòng</strong>, <strong>SKU</strong>, <strong>Parent SKU</strong>, <strong>Tên sản phẩm</strong>, các cột giá, <strong>Tồn kho</strong>, <strong>Đơn vị</strong>, <strong>Danh mục text</strong>, <strong>Default category id</strong>, <strong>Supplier id</strong>, <strong>Hoạt động</strong>.</li>
                  <li><strong>Loại dòng</strong>: nhập <strong>PARENT</strong> cho sản phẩm cha, <strong>VARIANT</strong> cho biến thể. Nếu bỏ trống, backend tự suy luận: có Parent SKU là VARIANT, không có Parent SKU là PARENT.</li>
                  <li><strong>Parent SKU</strong> là khóa giữ quan hệ cha-con; SKU này phải trùng SKU của dòng sản phẩm cha trong file hoặc sản phẩm cha đã có trong hệ thống. Sau khi lưu, SKU của biến thể được đồng bộ trùng SKU cha.</li>
                  <li>Có thể nhập file có alias phổ biến như <strong>Mã SKU</strong>, <strong>Ma SKU</strong>, <strong>Mã sản phẩm</strong>, <strong>Tên</strong>, <strong>SL hàng</strong>, <strong>So luong</strong>, <strong>Giá vốn</strong>, <strong>Giá bán</strong>, <strong>ĐVT</strong>, <strong>Danh mục</strong>, <strong>ParentSKU</strong>, <strong>SKU cha</strong>, <strong>Mã cha</strong>.</li>
                  <li>Import sẽ validate toàn bộ file trước khi ghi. Nếu có lỗi, thông báo sẽ chỉ rõ dòng/cột và dữ liệu chưa được cập nhật.</li>
                  <li>Các cột <strong>ID</strong>, <strong>Parent ID</strong>, <strong>Default category name</strong>, <strong>Supplier name</strong>, <strong>Ghi chú</strong> chỉ để tham khảo khi xuất file; backend bỏ qua khi import.</li>
                </ul>
                <div className="mt-3 flex gap-2">
                  <button onClick={handleDownloadExcelTemplate} className="px-3 py-2 rounded-lg text-xs font-medium border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 flex items-center gap-1.5">
                    <Download size={14} /> Tải mẫu Excel
                  </button>
                  <button onClick={handleExportExcel} className="px-3 py-2 rounded-lg text-xs font-medium border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 flex items-center gap-1.5">
                    <Download size={14} /> Xuất danh sách hiện có
                  </button>
                </div>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🗑️ Xóa sản phẩm</h3>
                <p>Nhấn icon 🗑️ để xóa. Nếu là sản phẩm cha, tất cả biến thể con cũng sẽ bị xóa (soft delete).</p>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-800 mb-2">💡 Mẹo</h3>
                <ul className="list-disc pl-5 space-y-1 text-blue-700">
                  <li>Dùng checkbox để chọn nhiều sản phẩm và xóa hàng loạt</li>
                  <li>Nhà cung cấp sẽ hiển thị bên dưới mã SKU</li>
                  <li>Combo là gói sản phẩm, có thể bán với giá khác</li>
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