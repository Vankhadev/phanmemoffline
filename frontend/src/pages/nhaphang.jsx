import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Plus, X, Save, Package, Tag, FileText, LogOut, AlertCircle, CheckCircle, Building, Trash2, CreditCard } from 'lucide-react';
import { API } from '../App';
import { buildCategoriesById, searchFlatProducts } from '../utils/productSearch';

const Nhaphang = () => {
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [supplierSearchQuery, setSupplierSearchQuery] = useState('');
  const [showSupplierResults, setShowSupplierResults] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [note, setNote] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('unpaid');
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [filteredSuppliers, setFilteredSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [currentOrder, setCurrentOrder] = useState(null);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [orderHistory, setOrderHistory] = useState([]);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState([]);
  const [showAllSuppliers, setShowAllSuppliers] = useState(false); // Thêm state để hiển thị full khi focus
  const searchInputRef = useRef(null);
  const searchResultsRef = useRef(null);
  const supplierInputRef = useRef(null);
  const supplierResultsRef = useRef(null);

  const categoriesById = useMemo(() => buildCategoriesById(categories), [categories]);

  // Fetch suppliers/products/categories from API
  useEffect(() => {
    fetchSuppliers();
    fetchAllProducts();
    fetchCategories();
    fetchImportHistory();
  }, []);

  const fetchSuppliers = async () => {
    try {
      const res = await fetch(`${API}/partners`);
      if (res.ok) {
        const data = await res.json();
        setSuppliers(data);
      } else {
        console.error('Failed to fetch suppliers');
      }
    } catch (err) {
      console.error('Lỗi tải nhà cung cấp:', err);
    }
  };

  const fetchAllProducts = async () => {
    try {
      const res = await fetch(`${API}/products/all/with-variants`);
      if (res.ok) setAllProducts(await res.json());
    } catch (err) {
      console.error('Lỗi tải danh sách sản phẩm:', err);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${API}/product-categories`);
      if (res.ok) setCategories(await res.json());
    } catch (err) {
      console.error('Lỗi tải danh mục sản phẩm:', err);
    }
  };

  const fetchImportHistory = async () => {
    try {
      const res = await fetch(`${API}/imports`);
      if (res.ok) {
        const data = await res.json();
        setOrderHistory((Array.isArray(data) ? data : []).map(mapImportToOrder));
      }
    } catch (err) {
      console.error('Lỗi tải lịch sử nhập hàng:', err);
    }
  };

  // Debounced search for products
  const debounceTimeoutRef = useRef(null);

  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    if (searchQuery.trim()) {
      setLoading(true);
      debounceTimeoutRef.current = setTimeout(async () => {
        try {
          const localResults = searchFlatProducts(allProducts, searchQuery, { categoriesById, includeParents: true, includeVariants: true }).slice(0, 80);
          if (localResults.length > 0 || allProducts.length > 0) {
            setFilteredProducts(localResults);
          } else {
            const response = await fetch(`${API}/products/search?q=${encodeURIComponent(searchQuery)}&limit=80`);
            const results = await response.json();
            setFilteredProducts(results || []);
          }
        } catch (err) {
          console.error('Lỗi tìm kiếm sản phẩm:', err);
          try {
            const response = await fetch(`${API}/products?search=${encodeURIComponent(searchQuery)}`);
            const results = await response.json();
            setFilteredProducts(results || []);
          } catch (_) {
            setFilteredProducts([]);
          }
        } finally {
          setLoading(false);
        }
      }, 250);
    } else {
      setFilteredProducts([]);
    }

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [searchQuery, allProducts, categoriesById]);

  // Filter suppliers when search query changes
  useEffect(() => {
    if (supplierSearchQuery.trim()) {
      const filtered = suppliers.filter(s =>
        s.name.toLowerCase().includes(supplierSearchQuery.toLowerCase()) ||
        (s.id && s.id.toString().includes(supplierSearchQuery.toLowerCase())) ||
        (s.phone && s.phone.includes(supplierSearchQuery)) ||
        (s.tax_code && s.tax_code.includes(supplierSearchQuery))
      );
      setFilteredSuppliers(filtered);
    } else {
      setFilteredSuppliers(suppliers);
    }
  }, [supplierSearchQuery, suppliers]);

  // Close search results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        searchResultsRef.current &&
        !searchResultsRef.current.contains(event.target) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target)
      ) {
        setShowSearchResults(false);
      }
      if (
        supplierResultsRef.current &&
        !supplierResultsRef.current.contains(event.target) &&
        supplierInputRef.current &&
        !supplierInputRef.current.contains(event.target)
      ) {
        setShowSupplierResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Validation
  const validateProduct = (product) => {
    const errors = [];
    if (!product.tenSP) errors.push('Tên sản phẩm là bắt buộc');
    if (!product.donVi) errors.push('Đơn vị là bắt buộc');
    if (!product.soLuongNhap || product.soLuongNhap <= 0) {
      errors.push('Số lượng nhập phải lớn hơn 0');
    }
    if (!product.giaNhap || product.giaNhap <= 0) {
      errors.push('Giá nhập phải lớn hơn 0');
    }
    if (product.chietKhau < 0 || product.chietKhau > 100) {
      errors.push('Chiết khấu phải từ 0-100%');
    }
    return errors;
  };

  // Validate entire order
  const validateOrder = () => {
    const errors = [];
    if (products.length === 0) {
      errors.push('Vui lòng thêm ít nhất một sản phẩm');
    }
    if (!selectedSupplier) {
      errors.push('Vui lòng chọn nhà cung cấp');
    }

    products.forEach((product, index) => {
      const productErrors = validateProduct(product);
      if (productErrors.length > 0) {
        errors.push(`Sản phẩm #${index + 1} (${product.tenSP}): ${productErrors.join(', ')}`);
      }
    });

    return errors;
  };

  // Calculate thanhTien for a product
  const calculateThanhTien = (giaNhap, soLuong, chietKhau) => {
    const thanhTien = giaNhap * soLuong;
    return thanhTien - (thanhTien * (chietKhau / 100));
  };

  // Handle product selection from search
  const handleSelectProduct = async (product) => {
    // Check if product already exists in the list
    if (products.find(p => p.id === product.id || p.maSP === product.maSP || p.maSP === product.sku)) {
      setError('Sản phẩm đã tồn tại trong danh sách!');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      setLoading(true);
      // Try to fetch full product details from API
      const productRes = await fetch(`${API}/products/${product.id}`);
      const fullProduct = productRes.ok ? await productRes.json() : product;

      // Map API product fields to local format
      // API trả về: sku, name, retail_price, wholesale_price, import_price, unit, stock...
      // Local cần: maSP, tenSP, donVi, giaNhap
      const mappedProduct = {
        id: fullProduct.id,
        maSP: fullProduct.sku || product.maSP || product.sku || '',
        tenSP: fullProduct.name || product.tenSP || product.name || '',
        donVi: fullProduct.unit || product.donVi || 'cái',
        giaNhap: fullProduct.import_price || fullProduct.retail_price || product.giaNhap || product.retail_price || 0,
        retail_price: fullProduct.retail_price || product.retail_price || 0,
        wholesale_price: fullProduct.wholesale_price || product.wholesale_price || 0,
        default_category_id: fullProduct.default_category_id || product.default_category_id || null,
        default_category: fullProduct.default_category || product.default_category || null,
        parent_name: fullProduct.parent?.name || product.parent_name || product.parent?.name || '',
        // Keep other fields if they exist
        ...(fullProduct.category && { category: fullProduct.category }),
      };

      setSelectedProduct({
        ...mappedProduct,
        stt: products.length + 1,
        soLuongNhap: 1,
        chietKhau: 0,
        thanhTien: mappedProduct.giaNhap
      });
      setShowSearchResults(false);
      setSearchQuery('');
      setError(null);
    } catch (err) {
      // Use the product from search results if API fails
      const mappedProduct = {
        maSP: product.maSP || product.sku || '',
        tenSP: product.tenSP || product.name || '',
        donVi: product.donVi || product.unit || 'cái',
        giaNhap: product.giaNhap || product.import_price || product.retail_price || 0,
        retail_price: product.retail_price || 0,
        wholesale_price: product.wholesale_price || 0,
        default_category_id: product.default_category_id || null,
        default_category: product.default_category || null,
        parent_name: product.parent_name || product.parent?.name || '',
      };
      setSelectedProduct({
        ...mappedProduct,
        stt: products.length + 1,
        soLuongNhap: 1,
        chietKhau: 0,
        thanhTien: mappedProduct.giaNhap
      });
      setShowSearchResults(false);
      setSearchQuery('');
      setError(null);
    } finally {
      setLoading(false);
    }
  };

  // Handle supplier selection from search
  const handleSelectSupplier = async (supplier) => {
    try {
      setLoading(true);
      // Try to fetch full supplier details from API
      const supplierRes = await fetch(`${API}/partners/${supplier.id}`);
      const fullSupplier = supplierRes.ok ? await supplierRes.json() : supplier;

      setSelectedSupplier({
        id: fullSupplier.id,
        maNCC: fullSupplier.id || fullSupplier.maNCC || '',
        tenNCC: fullSupplier.name,
        diaChi: fullSupplier.address || '',
        sdt: fullSupplier.phone || '',
        email: fullSupplier.email || ''
      });
      setShowSupplierResults(false);
      setShowAllSuppliers(false); // Đóng dropdown
      setSupplierSearchQuery('');
      setError(null);
    } catch (err) {
      // Use the supplier from search results if API fails
      setSelectedSupplier({
        id: supplier.id,
        maNCC: supplier.id || supplier.maNCC || '',
        tenNCC: supplier.name,
        diaChi: supplier.address || '',
        sdt: supplier.phone || '',
        email: supplier.email || ''
      });
      setShowSupplierResults(false);
      setShowAllSuppliers(false); // Đóng dropdown
      setSupplierSearchQuery('');
      setError(null);
    } finally {
      setLoading(false);
    }
  };

  // Add product to list
  const handleAddProduct = () => {
    if (!selectedProduct) {
      setError('Vui lòng chọn sản phẩm!');
      setTimeout(() => setError(null), 3000);
      return;
    }

    const productErrors = validateProduct(selectedProduct);
    if (productErrors.length > 0) {
      setError(productErrors.join(', '));
      setTimeout(() => setError(null), 3000);
      return;
    }

    const newProduct = {
      ...selectedProduct,
      // Ensure giaNhap exists
      giaNhap: selectedProduct.giaNhap || selectedProduct.retail_price || selectedProduct.import_price || 0,
      thanhTien: calculateThanhTien(
        selectedProduct.giaNhap || selectedProduct.retail_price || selectedProduct.import_price || 0,
        selectedProduct.soLuongNhap,
        selectedProduct.chietKhau
      )
    };

    setPaymentStatus('unpaid');
    setProducts([...products, newProduct]);
    setSelectedProduct(null);
    setSearchQuery('');
    setError(null);
  };

  // Update product in list
  const handleUpdateProduct = (index, field, value) => {
    const updatedProducts = [...products];
    const product = { ...updatedProducts[index] };

    // Get base price from product (could be giaNhap, retail_price, or import_price)
    const basePrice = product.giaNhap || product.retail_price || product.import_price || 0;

    if (field === 'soLuongNhap' || field === 'chietKhau') {
      const soLuong = field === 'soLuongNhap' ? parseFloat(value) || 0 : product.soLuongNhap;
      const chietKhau = field === 'chietKhau' ? parseFloat(value) || 0 : product.chietKhau;
      product.thanhTien = calculateThanhTien(basePrice, soLuong, chietKhau);
    }

    product[field] = field === 'soLuongNhap' || field === 'chietKhau' ? parseFloat(value) || 0 : value;
    updatedProducts[index] = product;
    setProducts(updatedProducts);
  };

  // Remove product from list
  const handleRemoveProduct = (index) => {
    const updatedProducts = products.filter((_, i) => i !== index);
    // Re-number STT
    const renumbered = updatedProducts.map((p, i) => ({ ...p, stt: i + 1 }));
    setProducts(renumbered);
  };

  // Calculate total
  const totalAmount = useMemo(() => {
    return products.reduce((sum, p) => sum + p.thanhTien, 0);
  }, [products]);

  // Calculate total quantity and discount
  const totalStats = useMemo(() => {
    return products.reduce((acc, p) => ({
      quantity: acc.quantity + p.soLuongNhap,
      discountValue: acc.discountValue + (p.giaNhap * p.soLuongNhap * (p.chietKhau / 100))
    }), { quantity: 0, discountValue: 0 });
  }, [products]);

  const paymentSummary = useMemo(() => {
    const paidAmount = paymentStatus === 'paid' ? totalAmount : 0;
    return {
      payment_status: paymentStatus,
      paid_amount: paidAmount,
      remaining_amount: Math.max(0, totalAmount - paidAmount),
    };
  }, [paymentStatus, totalAmount]);

  const editingImportKey = currentOrder?.maDonHang || currentOrder?.id || null;
  const historySelectionKeys = useMemo(() => orderHistory.map(order => String(order.maDonHang || order.id)), [orderHistory]);
  const isAllHistorySelected = orderHistory.length > 0 && selectedHistoryIds.length === historySelectionKeys.length;

  const getPaymentLabel = (status) => status === 'paid' ? 'Đã thanh toán' : 'Chưa thanh toán';

  const getPaymentBadgeClass = (status) => status === 'paid'
    ? 'bg-green-100 text-green-700 border-green-200'
    : 'bg-orange-100 text-orange-700 border-orange-200';

  const mapImportToOrder = (imp) => {
    const details = Array.isArray(imp.details) ? imp.details : [];
    const status = imp.status || 'draft';
    return {
      id: imp.id,
      maDonHang: imp.import_code,
      ngayLap: imp.created_at || imp.updated_at || new Date().toISOString(),
      nguoiNhap: imp.user_name || 'Người dùng',
      nhaCungCap: {
        id: imp.partner_id,
        maNCC: imp.partner_id,
        tenNCC: imp.partner_name || '—',
        diaChi: '',
        sdt: '',
        email: '',
      },
      chiTiet: details.map((d, index) => ({
        maSP: d.sku || '',
        tenSP: d.product_name || '',
        soLuong: +d.quantity || 0,
        donVi: d.unit || 'cái',
        giaNhap: +d.import_price || 0,
        retail_price: +d.retail_price || 0,
        wholesale_price: +d.wholesale_price || 0,
        chietKhau: 0,
        thanhTien: +d.line_total || 0,
        product_id: d.product_id || null,
        variant_id: d.variant_id || null,
      })),
      soSanPham: imp.detail_count || details.length,
      tongTien: +imp.total || 0,
      tongSoLuong: details.reduce((sum, d) => sum + (+d.quantity || 0), 0),
      tongChietKhau: 0,
      ghiChu: imp.note || '',
      tags: [],
      trangThai: status === 'received' ? 'da_nhap' : status === 'cancelled' ? 'da_huy' : 'cho_nhap',
      payment_status: imp.payment_status || 'unpaid',
      paid_amount: +imp.paid_amount || 0,
      remaining_amount: +imp.remaining_amount || 0,
      stock_applied: imp.stock_applied === true,
      stock_rolled_back: imp.stock_rolled_back === true,
      stock_status: imp.stock_status || '',
      cancelled_at: imp.cancelled_at || null,
    };
  };

  // Add tag
  const handleAddTag = (e) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      const newTag = tagInput.trim();
      if (!tags.includes(newTag)) {
        setTags([...tags, newTag]);
      }
      setTagInput('');
    }
  };

  // Remove tag
  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  // Generate order number for new frontend-created draft code; backend keeps this code on update.
  const generateOrderNumber = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `NH-${year}${month}-${random}`;
  };

  const buildImportPayload = (status, importCode) => ({
    ...(importCode ? { import_code: importCode } : {}),
    partner_id: selectedSupplier?.id || null,
    user_id: null,
    total: totalAmount,
    note: note || '',
    status,
    payment_status: 'unpaid',
    paid_amount: 0,
    remaining_amount: totalAmount,
    details: products.map(p => ({
      product_id: Number(p.id || p.product_id) && Number(p.id || p.product_id) < 1000000000 ? Number(p.id || p.product_id) : null,
      variant_id: Number(p.variant_id) || null,
      product_name: p.tenSP || '',
      sku: p.maSP || '',
      quantity: +p.soLuongNhap || 1,
      import_price: +p.giaNhap || 0,
      retail_price: +p.retail_price || 0,
      wholesale_price: +p.wholesale_price || 0,
      line_total: +p.thanhTien || 0,
    })),
  });

  const buildLocalOrderData = (status, importCode, result = {}) => ({
    id: result.import_id || currentOrder?.id || Date.now(),
    maDonHang: result.import_code || importCode,
    ngayLap: currentOrder?.ngayLap || new Date().toISOString(),
    nguoiNhap: currentOrder?.nguoiNhap || 'Người dùng',
    nhaCungCap: {
      id: selectedSupplier.id,
      maNCC: selectedSupplier.maNCC,
      tenNCC: selectedSupplier.tenNCC,
      diaChi: selectedSupplier.diaChi,
      sdt: selectedSupplier.sdt,
      email: selectedSupplier.email
    },
    chiTiet: products.map(p => ({
      maSP: p.maSP,
      tenSP: p.tenSP,
      soLuong: p.soLuongNhap,
      donVi: p.donVi,
      giaNhap: p.giaNhap,
      chietKhau: p.chietKhau,
      thanhTien: p.thanhTien,
      product_id: p.id || p.product_id || null,
      variant_id: p.variant_id || null,
    })),
    tongTien: totalAmount,
    tongSoLuong: totalStats.quantity,
    tongChietKhau: totalStats.discountValue,
    ghiChu: note,
    tags,
    trangThai: status === 'received' ? 'da_nhap' : 'cho_nhap',
    nguonNhap: currentOrder ? 'cap_nhat' : 'nhap_moi',
    payment_status: result.payment_status || paymentSummary.payment_status,
    paid_amount: result.paid_amount ?? paymentSummary.paid_amount,
    remaining_amount: result.remaining_amount ?? paymentSummary.remaining_amount,
    stock_applied: result.stock_applied === true,
    stock_rolled_back: result.stock_rolled_back === true,
    stock_status: result.stock_status || (status === 'received' ? 'imported' : 'not_imported'),
  });

  const submitImportOrder = async (status) => {
    const errors = validateOrder();
    if (errors.length > 0) {
      setError(errors.join('\n'));
      setTimeout(() => setError(null), 5000);
      return;
    }

    const isEditing = Boolean(isEditingOrder && editingImportKey);
    const nextImportCode = isEditing ? currentOrder.maDonHang : generateOrderNumber();
    const confirmMessage = isEditing
      ? `Cập nhật phiếu nhập ${nextImportCode}? Hệ thống sẽ sửa đúng phiếu hiện tại, không tạo phiếu/mã mới.`
      : status === 'received'
        ? 'Tạo và nhập hàng? Hành động này sẽ cập nhật số lượng tồn kho.'
        : 'Tạo đơn hàng (chưa nhập)? Đơn hàng sẽ được lưu vào hệ thống.';
    if (!window.confirm(confirmMessage)) return;

    setSaving(true);
    setError(null);

    try {
      const endpoint = isEditing ? `${API}/imports/${encodeURIComponent(editingImportKey)}` : `${API}/imports`;
      const response = await fetch(endpoint, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildImportPayload(status, nextImportCode)),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || (isEditing ? 'Không thể cập nhật phiếu nhập' : 'Không thể tạo phiếu nhập'));
      }
      const result = await response.json();
      const savedOrder = buildLocalOrderData(status, nextImportCode, result);
      setOrderHistory(prev => [savedOrder, ...prev.filter(o => o.maDonHang !== savedOrder.maDonHang && o.id !== savedOrder.id)]);

      setSuccess(
        isEditing
          ? `Phiếu ${savedOrder.maDonHang} đã được cập nhật. Trạng thái thanh toán: ${getPaymentLabel(savedOrder.payment_status)}.`
          : `Đơn hàng ${savedOrder.maDonHang} đã được tạo${status === 'received' ? ', nhập kho thành công' : ' và lưu tạm'}; thanh toán: ${getPaymentLabel(savedOrder.payment_status)}.`
      );
      setCurrentOrder(savedOrder);
      setIsEditingOrder(true);
      setPaymentStatus(savedOrder.payment_status || 'unpaid');
      setTimeout(() => {
        if (status === 'received' || result.stock_delta?.length > 0 || result.stock_mode) {
          window.dispatchEvent(new Event('kha-order-created'));
          fetchAllProducts();
        }
        fetchImportHistory();
      }, 1200);
    } catch (err) {
      console.error('Error saving import order:', err);
      setError(err.message || 'Không thể lưu phiếu nhập. Vui lòng thử lại sau.');
    } finally {
      setSaving(false);
    }
  };

  const getCurrentImportStatus = () => currentOrder?.trangThai === 'da_nhap' ? 'received' : 'draft';

  // Create new draft, or update existing import while preserving its current stock status.
  const handleCreateOnly = async () => submitImportOrder(isEditingOrder ? getCurrentImportStatus() : 'draft');

  // Create and receive new order; for existing draft this can be used to receive stock once.
  const handleCreateAndReceive = async () => submitImportOrder('received');

  // Exit/Reset
  const handleExit = () => {
    if (products.length > 0 || note || tags.length > 0) {
      const confirmExit = window.confirm('Bạn có chắc chắn muốn thoát? Dữ liệu chưa lưu sẽ bị mất.');
      if (!confirmExit) return;
    }
    handleReset();
  };

  // Reset form
  const handleReset = () => {
    setProducts([]);
    setSelectedProduct(null);
    setSelectedSupplier(null);
    setSearchQuery('');
    setSupplierSearchQuery('');
    setShowSearchResults(false);
    setShowSupplierResults(false);
    setNote('');
    setPaymentStatus('unpaid');
    setTags([]);
    setTagInput('');
    setError(null);
    setSuccess(null);
    setCurrentOrder(null);
    setIsEditingOrder(false);
  };

  // Load existing order for viewing/editing. edit=true enables PUT on save.
  const handleLoadOrder = async (order, edit = false) => {
    try {
      setSaving(true);
      setError(null);
      const response = await fetch(`${API}/imports/${encodeURIComponent(order.maDonHang || order.id)}`);
      const fullOrder = response.ok ? mapImportToOrder(await response.json()) : order;
      setCurrentOrder(fullOrder);
      setIsEditingOrder(edit);
      setProducts((fullOrder.chiTiet || []).map((item, index) => ({
        ...item,
        stt: index + 1,
        soLuongNhap: item.soLuong,
        chietKhau: item.chietKhau || 0,
        thanhTien: item.thanhTien,
        giaNhap: item.giaNhap,
        retail_price: item.retail_price || 0,
        wholesale_price: item.wholesale_price || 0,
        donVi: item.donVi,
        tenSP: item.tenSP,
        maSP: item.maSP,
        id: item.product_id || item.id || null,
        product_id: item.product_id || null,
        variant_id: item.variant_id || null,
      })));
      setNote(fullOrder.ghiChu || '');
      setPaymentStatus(fullOrder.payment_status || 'unpaid');
      setTags(fullOrder.tags || []);
      if (fullOrder.nhaCungCap) {
        setSelectedSupplier(fullOrder.nhaCungCap);
        setSupplierSearchQuery(fullOrder.nhaCungCap.tenNCC);
      } else {
        setSelectedSupplier(null);
        setSupplierSearchQuery('');
      }
      setSearchQuery('');
      setShowSearchResults(false);
      setSuccess(edit ? `Đang sửa phiếu ${fullOrder.maDonHang}. Khi lưu sẽ gọi API cập nhật, không tạo phiếu mới.` : `Đã tải phiếu ${fullOrder.maDonHang} để xem.`);
    } catch (err) {
      console.error('Error loading import order:', err);
      setError('Không thể tải chi tiết phiếu nhập.');
    } finally {
      setSaving(false);
    }
  };

  // Cancel order and let backend rollback stock exactly once if this import already applied stock
  const handleCancelOrder = async (order) => {
    const reason = prompt('Nhập lý do hủy đơn (không bắt buộc):', '');
    if (reason === null) return; // User cancelled

    const confirmCancel = window.confirm(
      `Hủy đơn hàng ${order.maDonHang}?\n\n` +
      'Nếu phiếu này đã nhập kho, hệ thống sẽ tự động trừ lại đúng số lượng đã cộng và chỉ rollback một lần.\n' +
      'Nếu phiếu chưa từng nhập kho, tồn kho sẽ không bị thay đổi.\n\n' +
      `Lý do: ${reason || 'Không có'}\n\n` +
      'Bạn có chắc chắn?'
    );

    if (!confirmCancel) return;

    try {
      setSaving(true);
      setError(null);

      const response = await fetch(`${API}/imports/${order.maDonHang}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyDo: reason, rollbackStock: true })
      });

      if (!response.ok) {
        throw new Error('Không thể hủy đơn hàng');
      }

      const result = await response.json();
      setSuccess(`Đơn hàng ${order.maDonHang} đã được hủy${result.rollback_stock ? ' và đã rollback tồn kho' : ''}.`);

      // Remove from local history if present
      if (currentOrder?.maDonHang === order.maDonHang) {
        handleReset();
      }

      // Refresh order list if displayed
      setOrderHistory(prev => prev.map(o =>
        o.maDonHang === order.maDonHang
          ? {
            ...o,
            trangThai: 'da_huy',
            ngayHuy: new Date().toISOString(),
            stock_rolled_back: result.stock_rolled_back === true,
            stock_status: result.rollback_stock ? 'rolled_back' : o.stock_status,
          }
          : o
      ));
      fetchAllProducts();

    } catch (err) {
      console.error('Error cancelling order:', err);
      setError('Không thể hủy đơn hàng. Vui lòng thử lại sau.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOrder = async (order) => {
    const confirmDelete = window.confirm(
      `Xóa phiếu nhập ${order.maDonHang}?\n\n` +
      'Nếu phiếu đã nhập kho, backend sẽ rollback tồn kho đúng một lần trước khi ẩn khỏi danh sách.\n' +
      'Thao tác này không tạo phiếu mới và không rollback lặp nếu gọi lại.'
    );
    if (!confirmDelete) return;

    try {
      setSaving(true);
      setError(null);
      const response = await fetch(`${API}/imports/${encodeURIComponent(order.maDonHang || order.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'deleted from import UI' }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Không thể xóa phiếu nhập');
      }
      const result = await response.json();
      setOrderHistory(prev => prev.filter(o => o.maDonHang !== order.maDonHang && o.id !== order.id));
      if (currentOrder?.maDonHang === order.maDonHang || currentOrder?.id === order.id) {
        handleReset();
      }
      setSuccess(`Phiếu ${order.maDonHang} đã được xóa${result.rollback_stock ? ' và đã rollback tồn kho' : ''}.`);
      fetchAllProducts();
    } catch (err) {
      console.error('Error deleting import order:', err);
      setError(err.message || 'Không thể xóa phiếu nhập. Vui lòng thử lại sau.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleHistoryRow = (order) => {
    const key = String(order.maDonHang || order.id);
    setSelectedHistoryIds(prev => prev.includes(key) ? prev.filter(id => id !== key) : [...prev, key]);
  };

  const handleToggleAllHistory = () => {
    setSelectedHistoryIds(isAllHistorySelected ? [] : historySelectionKeys);
  };

  const handleDeleteSelectedOrders = async () => {
    if (selectedHistoryIds.length === 0) return;
    const confirmDelete = window.confirm(
      `Xóa ${selectedHistoryIds.length} phiếu nhập đã chọn?\n\n` +
      'Backend sẽ rollback tồn kho đúng một lần cho từng phiếu đã nhập kho và bỏ qua rollback lặp.'
    );
    if (!confirmDelete) return;

    try {
      setSaving(true);
      setError(null);
      const response = await fetch(`${API}/imports/bulk`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_codes: selectedHistoryIds, reason: 'bulk deleted from import UI' }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Không thể xóa hàng loạt phiếu nhập');
      }
      const result = await response.json();
      setOrderHistory(prev => prev.filter(o => !selectedHistoryIds.includes(String(o.maDonHang || o.id))));
      if (currentOrder && selectedHistoryIds.includes(String(currentOrder.maDonHang || currentOrder.id))) {
        handleReset();
      }
      setSelectedHistoryIds([]);
      setSuccess(`Đã xóa ${result.deleted_count || 0} phiếu nhập${result.rollback_count ? `, rollback tồn kho ${result.rollback_count} phiếu` : ''}.`);
      fetchAllProducts();
    } catch (err) {
      console.error('Error bulk deleting import orders:', err);
      setError(err.message || 'Không thể xóa hàng loạt phiếu nhập. Vui lòng thử lại sau.');
    } finally {
      setSaving(false);
    }
  };

  const handlePayCurrentOrder = async () => {
    if (!editingImportKey) {
      setError('Vui lòng tạo hoặc chọn phiếu nhập trước khi thanh toán.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    if (paymentStatus === 'paid') {
      setSuccess('Phiếu nhập hiện tại đã được thanh toán.');
      setTimeout(() => setSuccess(null), 3000);
      return;
    }

    const confirmPay = window.confirm(
      `Thanh toán phiếu nhập ${currentOrder?.maDonHang || editingImportKey}?\n\n` +
      'Thao tác này chỉ cập nhật phiếu hiện tại sang đã thanh toán và ghi nhận sổ quỹ/công nợ liên quan, không tạo phiếu mới và không thay đổi tồn kho.'
    );
    if (!confirmPay) return;

    try {
      setSaving(true);
      setError(null);
      const response = await fetch(`${API}/imports/${encodeURIComponent(editingImportKey)}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: `Thanh toán phiếu nhập ${currentOrder?.maDonHang || editingImportKey}` }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Không thể thanh toán phiếu nhập');
      }
      const result = await response.json();
      setPaymentStatus('paid');
      setCurrentOrder(prev => prev ? {
        ...prev,
        payment_status: 'paid',
        paid_amount: result.paid_amount ?? prev.tongTien,
        remaining_amount: result.remaining_amount ?? 0,
      } : prev);
      setOrderHistory(prev => prev.map(order => (
        String(order.maDonHang || order.id) === String(editingImportKey)
          ? { ...order, payment_status: 'paid', paid_amount: result.paid_amount ?? order.tongTien, remaining_amount: result.remaining_amount ?? 0 }
          : order
      )));
      setSuccess(`Phiếu ${result.import_code || editingImportKey} đã được thanh toán, không tạo phiếu mới và không đổi tồn kho.`);
    } catch (err) {
      console.error('Error paying import order:', err);
      setError(err.message || 'Không thể thanh toán phiếu nhập. Vui lòng thử lại sau.');
    } finally {
      setSaving(false);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl + Enter to add product when selected
      if (e.ctrlKey && e.key === 'Enter' && selectedProduct) {
        e.preventDefault();
        handleAddProduct();
      }
      // Escape to close search
      if (e.key === 'Escape') {
        if (showSearchResults) setShowSearchResults(false);
        if (showSupplierResults) setShowSupplierResults(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedProduct, showSearchResults, showSupplierResults]);

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header - SAPO style */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">
                <Package className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Nhập hàng</h1>
                {currentOrder && (
                  <p className="text-xs text-gray-500">
                    {isEditingOrder ? 'Đang sửa' : 'Đang xem'} phiếu {currentOrder.maDonHang}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExit}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <LogOut className="w-4 h-4" />
                Thoát
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Alerts */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-400 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-700 whitespace-pre-line">{error}</div>
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-50 border-l-4 border-green-400 flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-green-700">{success}</div>
          </div>
        )}

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Input Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Supplier & Product Search Card */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <Search className="w-4 h-4" />
                  Tìm kiếm
                </h2>
              </div>
              <div className="p-4 space-y-4">
                {/* Supplier Search */}
                <div className="relative" ref={supplierInputRef}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Building className="inline w-4 h-4 mr-1" />
                    Nhà cung cấp
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      ref={supplierInputRef}
                      value={supplierSearchQuery}
                      onChange={(e) => {
                        setSupplierSearchQuery(e.target.value);
                        setShowAllSuppliers(false); // Khi gõ thì chuyển sang mode search
                        setSelectedSupplier(null);
                        setError(null);
                      }}
                      onFocus={() => {
                        setShowSupplierResults(true);
                        setShowAllSuppliers(true); // Hiển thị full khi focus
                      }}
                      placeholder="Tìm kiếm nhà cung cấp..."
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                      disabled={saving}
                    />
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />

                    {/* Loading indicator */}
                    {loading && (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}

                    {/* Supplier Dropdown */}
                    {showSupplierResults && (
                      <div
                        ref={supplierResultsRef}
                        className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto"
                      >
                        {/* Show filtered results if typing or show all if focus without typing */}
                        {(supplierSearchQuery || showAllSuppliers) ? (
                          loading && supplierSearchQuery ? (
                            <div className="p-3 text-center text-sm text-gray-500">Đang tìm kiếm...</div>
                          ) : filteredSuppliers.length > 0 ? (
                            filteredSuppliers.map(supplier => (
                              <div
                                key={supplier.id}
                                onClick={() => handleSelectSupplier(supplier)}
                                className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-medium text-gray-900 text-sm">{supplier.name}</span>
                                  <span className="text-xs text-gray-500">({supplier.id || supplier.maNCC || 'N/A'})</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-0.5">
                                  {supplier.address || '—'}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="p-3 text-sm text-gray-500 text-center">Không tìm thấy</div>
                          )
                        ) : (
                          // Show all suppliers when dropdown opens without typing
                          suppliers.map(supplier => (
                            <div
                              key={supplier.id}
                              onClick={() => handleSelectSupplier(supplier)}
                              className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-gray-900 text-sm">{supplier.name}</span>
                                <span className="text-xs text-gray-500">({supplier.id || supplier.maNCC || 'N/A'})</span>
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {supplier.address || '—'}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Selected Supplier Badge */}
                  {selectedSupplier && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-100 text-green-700 rounded-md text-sm">
                        <Building className="w-3 h-3" />
                        {selectedSupplier.tenNCC}
                      </span>
                      <button
                        onClick={() => setSelectedSupplier(null)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Product Search */}
                <div className="relative" ref={searchInputRef}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Search className="inline w-4 h-4 mr-1" />
                    Sản phẩm <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setShowSearchResults(true);
                        setSelectedProduct(null);
                        setError(null);
                      }}
                      onFocus={() => setShowSearchResults(true)}
                      placeholder="Tìm tên, SKU, danh mục, nhóm, kích thước, màu sắc..."
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                      disabled={saving}
                    />
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />

                    {/* Loading indicator */}
                    {loading && (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      </div>
                    )}

                    {/* Product Dropdown */}
                    {showSearchResults && searchQuery && (
                      <div
                        ref={searchResultsRef}
                        className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto"
                      >
                        {loading ? (
                          <div className="p-3 text-center text-sm text-gray-500">Đang tìm kiếm...</div>
                        ) : filteredProducts.length > 0 ? (
                          filteredProducts.map(product => {
                            // Map price from API field
                            const price = product.retail_price || product.import_price || product.giaNhap || 0;
                            const name = product.name || product.tenSP || '';
                            const sku = product.sku || product.maSP || '';
                            const unit = product.unit || product.donVi || 'cái';
                            const categoryName = product.default_category?.name || product.category || '';
                            const parentName = product.parent_name || product.parent?.name || '';
                            return (
                              <div
                                key={`${product.is_variant ? 'v' : 'p'}-${product.id}`}
                                onClick={() => handleSelectProduct(product)}
                                className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-medium text-gray-900 text-sm">{name}{parentName ? <span className="text-xs text-gray-400"> · {parentName}</span> : null}</span>
                                  <span className="text-xs text-gray-500">({sku})</span>
                                </div>
                                <div className="flex items-center justify-between mt-1">
                                  <span className="text-xs text-gray-500">Đơn vị: {unit}{categoryName ? ` · ${categoryName}` : ''}</span>
                                  <span className="text-sm font-medium text-blue-600">
                                    {price.toLocaleString('vi-VN')}đ
                                  </span>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="p-3 text-sm text-gray-500 text-center">Không tìm thấy sản phẩm</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Selected Product Card */}
            {selectedProduct && (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                <div className="p-4 border-b border-gray-200 bg-blue-50">
                  <h2 className="text-base font-semibold text-blue-900 flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    {selectedProduct.tenSP}
                  </h2>
                  <p className="text-sm text-blue-700 mt-0.5">Mã: {selectedProduct.maSP}</p>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Số lượng</label>
                      <input
                        type="number"
                        min="1"
                        value={selectedProduct.soLuongNhap}
                        onChange={(e) => setSelectedProduct({
                          ...selectedProduct,
                          soLuongNhap: parseInt(e.target.value) || 1,
                          thanhTien: calculateThanhTien(
                            selectedProduct.giaNhap || selectedProduct.retail_price || selectedProduct.import_price || 0,
                            parseInt(e.target.value) || 1,
                            selectedProduct.chietKhau
                          )
                        })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        disabled={saving}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Đơn vị</label>
                      <input
                        type="text"
                        value={selectedProduct.donVi}
                        disabled
                        className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Giá nhập</label>
                      <input
                        type="number"
                        min="0"
                        value={selectedProduct.giaNhap || selectedProduct.retail_price || selectedProduct.import_price || 0}
                        onChange={(e) => setSelectedProduct({
                          ...selectedProduct,
                          giaNhap: parseFloat(e.target.value) || 0,
                          thanhTien: calculateThanhTien(
                            parseFloat(e.target.value) || 0,
                            selectedProduct.soLuongNhap,
                            selectedProduct.chietKhau
                          )
                        })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        disabled={saving}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Chiết khấu (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={selectedProduct.chietKhau}
                        onChange={(e) => setSelectedProduct({
                          ...selectedProduct,
                          chietKhau: parseFloat(e.target.value) || 0,
                          thanhTien: calculateThanhTien(
                            selectedProduct.giaNhap || selectedProduct.retail_price || selectedProduct.import_price || 0,
                            selectedProduct.soLuongNhap,
                            parseFloat(e.target.value) || 0
                          )
                        })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        disabled={saving}
                      />
                    </div>
                  </div>
                  <div className="mb-4">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Thành tiền</label>
                    <div className="w-full px-3 py-2 bg-green-50 border border-green-200 rounded-md font-semibold text-green-700 text-sm">
                      {selectedProduct.thanhTien.toLocaleString('vi-VN')}đ
                    </div>
                  </div>
                  <button
                    onClick={handleAddProduct}
                    disabled={saving}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-md flex items-center justify-center gap-2 text-sm"
                  >
                    <Plus className="w-4 h-4" />
                    Thêm vào danh sách
                  </button>
                </div>
              </div>
            )}

            {/* Product List Table */}
            {products.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                <div className="p-4 border-b border-gray-200">
                  <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Danh sách sản phẩm
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-12">STT</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-16">Ảnh</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Tên sản phẩm</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-20">Đơn vị</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">Số lượng</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-32">Giá nhập</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-24">Chiết khấu</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider w-32">Thành tiền</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider w-16"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {products.map((product, index) => {
                        // Get display price (prefer giaNhap, fallback to retail_price/import_price)
                        const displayPrice = product.giaNhap || product.retail_price || product.import_price || 0;
                        return (
                          <tr key={index} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-600">{product.stt}</td>
                            <td className="px-4 py-3">
                              <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center overflow-hidden border border-gray-200">
                                {product.hinhAnh ? (
                                  <img src={product.hinhAnh} alt={product.tenSP} className="w-full h-full object-cover" />
                                ) : (
                                  <Package className="w-6 h-6 text-gray-400" />
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{product.tenSP}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{product.donVi}</td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                min="1"
                                value={product.soLuongNhap}
                                onChange={(e) => handleUpdateProduct(index, 'soLuongNhap', e.target.value)}
                                className="w-full px-2 py-1 text-right text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                disabled={saving}
                              />
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-right">
                              {displayPrice.toLocaleString('vi-VN')}đ
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.1"
                                  value={product.chietKhau}
                                  onChange={(e) => handleUpdateProduct(index, 'chietKhau', e.target.value)}
                                  className="w-18 px-2 py-1 text-right text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  disabled={saving}
                                />
                                <span className="text-xs text-gray-500">%</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm font-semibold text-green-600 text-right">
                              {product.thanhTien.toLocaleString('vi-VN')}đ
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => handleRemoveProduct(index)}
                                disabled={saving}
                                className="text-gray-400 hover:text-red-600 disabled:text-gray-300 transition-colors p-1"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t border-gray-200">
                      <tr>
                        <td colSpan="4" className="px-4 py-3 text-right text-sm text-gray-600">
                          Tổng ({totalStats.quantity} sản phẩm)
                        </td>
                        <td colSpan="3" className="px-4 py-3 text-right text-sm text-gray-600">
                          Chiết khấu: <span className="font-medium">{totalStats.discountValue.toLocaleString('vi-VN')}đ</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="text-lg font-bold text-green-600">
                            {totalAmount.toLocaleString('vi-VN')}đ
                          </div>
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* Notes & Tags Card */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Thông tin bổ sung
                </h2>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <FileText className="w-4 h-4 text-gray-400" />
                    Ghi chú đơn
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows="3"
                    placeholder="Nhập ghi chú..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm resize-none"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                    <Tag className="w-4 h-4 text-gray-400" />
                    Tags
                  </label>
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    placeholder="Nhấn Enter để thêm tag..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm mb-2"
                    disabled={saving}
                  />
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 rounded-md text-sm"
                        >
                          {tag}
                          <button
                            onClick={() => handleRemoveTag(tag)}
                            disabled={saving}
                            className="hover:text-blue-900 disabled:text-blue-400"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Order History */}
            {orderHistory.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                <div className="p-4 border-b border-gray-200 flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Lịch sử đơn nhập hàng
                  </h2>
                  <button
                    onClick={handleDeleteSelectedOrders}
                    disabled={saving || selectedHistoryIds.length === 0}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                    Xóa đã chọn ({selectedHistoryIds.length})
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase w-10">
                          <input
                            type="checkbox"
                            checked={isAllHistorySelected}
                            onChange={handleToggleAllHistory}
                            disabled={saving || orderHistory.length === 0}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase w-14">STT</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Mã đơn</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Ngày lập</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Sản phẩm</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Tổng tiền</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Trạng thái</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {orderHistory.map((order, index) => (
                        <tr key={order.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={selectedHistoryIds.includes(String(order.maDonHang || order.id))}
                              onChange={() => handleToggleHistoryRow(order)}
                              disabled={saving}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{index + 1}</td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{order.maDonHang}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {new Date(order.ngayLap).toLocaleDateString('vi-VN')}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {order.soSanPham || order.chiTiet?.length || 0} sản phẩm
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-green-600 text-right">
                            {order.tongTien.toLocaleString('vi-VN')}đ
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                              order.trangThai === 'da_nhap'
                                ? 'bg-green-100 text-green-700'
                                : order.trangThai === 'cho_nhap'
                                ? 'bg-yellow-100 text-yellow-700'
                                : order.trangThai === 'da_huy'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-gray-100 text-gray-700'
                            }`}>
                              {order.trangThai === 'da_nhap' ? 'Đã nhập' :
                               order.trangThai === 'cho_nhap' ? 'Chờ nhập' :
                               order.trangThai === 'da_huy' ? 'Đã hủy' : order.trangThai}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex justify-center gap-2">
                              {order.trangThai !== 'da_huy' && (
                                <>
                                  <button
                                    onClick={() => handleLoadOrder(order, true)}
                                    disabled={saving}
                                    className="text-emerald-600 hover:text-emerald-800 text-sm font-medium disabled:text-emerald-300"
                                  >
                                    Sửa
                                  </button>
                                  <button
                                    onClick={() => handleCancelOrder(order)}
                                    disabled={saving}
                                    className="text-orange-600 hover:text-orange-800 text-sm font-medium disabled:text-orange-300"
                                  >
                                    Hủy
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => handleDeleteOrder(order)}
                                disabled={saving}
                                className="text-red-600 hover:text-red-800 text-sm font-medium disabled:text-red-300"
                              >
                                Xóa
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {orderHistory.length > 0 && (
                  <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                    <p className="text-xs text-gray-500">
                      Lưu ý: Khi hủy phiếu đã nhập kho, backend sẽ tự động rollback tồn kho đúng một lần; phiếu lưu tạm chưa nhập kho sẽ không đổi tồn kho.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column - Summary Card */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm sticky top-20">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Tổng quan đơn
                </h2>
              </div>
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-600">Sản phẩm</span>
                  <span className="text-sm font-semibold text-gray-900">{products.length}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-600">Tổng số lượng</span>
                  <span className="text-sm font-semibold text-gray-900">{totalStats.quantity}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-600">Tổng chiết khấu</span>
                  <span className="text-sm font-semibold text-red-600">
                    -{totalStats.discountValue.toLocaleString('vi-VN')}đ
                  </span>
                </div>
                <div className="pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold text-gray-900">Tổng thanh toán</span>
                  </div>
                  <div className="text-2xl font-bold text-green-600 mt-1">
                    {totalAmount.toLocaleString('vi-VN')}đ
                  </div>
                </div>

                {/* Payment Status */}
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase">Thanh toán</h3>
                    <span className={`inline-flex px-2.5 py-1 rounded-full border text-xs font-medium ${getPaymentBadgeClass(paymentStatus)}`}>
                      {getPaymentLabel(paymentStatus)}
                    </span>
                  </div>
                  <button
                    onClick={handlePayCurrentOrder}
                    disabled={saving || !editingImportKey || paymentStatus === 'paid'}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-md flex items-center justify-center gap-2 text-sm shadow-sm"
                  >
                    <CreditCard className="w-4 h-4" />
                    Thanh toán
                  </button>
                  <p className="mt-2 text-xs text-gray-500">
                    {editingImportKey
                      ? 'Nút này chỉ cập nhật phiếu hiện tại, không tạo phiếu mới và không thay đổi tồn kho.'
                      : 'Cần tạo hoặc chọn phiếu nhập trước khi thanh toán.'}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-50 rounded-md p-2">
                      <div className="text-gray-500">Đã trả</div>
                      <div className="font-semibold text-gray-900">{paymentSummary.paid_amount.toLocaleString('vi-VN')}đ</div>
                    </div>
                    <div className="bg-gray-50 rounded-md p-2">
                      <div className="text-gray-500">Còn phải trả</div>
                      <div className="font-semibold text-gray-900">{paymentSummary.remaining_amount.toLocaleString('vi-VN')}đ</div>
                    </div>
                  </div>
                </div>

                {/* Supplier Info Summary */}
                {selectedSupplier && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Nhà cung cấp</h3>
                    <div className="bg-gray-50 rounded-md p-3">
                      <p className="text-sm font-medium text-gray-900">{selectedSupplier.tenNCC}</p>
                      <p className="text-xs text-gray-600 mt-1">Mã: {selectedSupplier.maNCC}</p>
                      <p className="text-xs text-gray-600">{selectedSupplier.diaChi}</p>
                    </div>
                  </div>
                )}

                {/* Quick Actions */}
                <div className="pt-4 space-y-2">
                  {(!isEditingOrder || currentOrder?.trangThai === 'cho_nhap') && (
                    <button
                      onClick={handleCreateAndReceive}
                      disabled={saving || products.length === 0 || !selectedSupplier}
                      className="w-full bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-medium py-2.5 px-4 rounded-md flex items-center justify-center gap-2 text-sm shadow-sm"
                    >
                      <Package className="w-4 h-4" />
                      {isEditingOrder ? 'Cập nhật & Nhập hàng' : 'Tạo & Nhập hàng'}
                    </button>
                  )}
                  <button
                    onClick={handleCreateOnly}
                    disabled={saving || products.length === 0 || !selectedSupplier}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2.5 px-4 rounded-md flex items-center justify-center gap-2 text-sm shadow-sm"
                  >
                    <Save className="w-4 h-4" />
                    {isEditingOrder ? 'Cập nhật phiếu' : 'Tạo & Lưu tạm'}
                  </button>
                </div>

                {(!selectedSupplier || products.length === 0) && (
                  <p className="text-xs text-gray-500 text-center">
                    {!selectedSupplier ? 'Vui lòng chọn nhà cung cấp' : 'Vui lòng thêm sản phẩm'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Nhaphang;
