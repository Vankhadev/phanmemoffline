import { useState, useEffect, useRef } from 'react';
import { API } from '../App';
import HelpModal from '../components/HelpModal';
import { getDefaultPrintTemplate } from '../utils/printTemplateService';
import { createInvoicePrintData } from '../utils/invoicePrintData';
import { printInvoice, writePrintWindowMessage } from '../utils/printInvoice';
import { getProductDisplayName } from '../utils/productSearch';

const PRICE_LABELS = { retail: 'Lẻ', wholesale: 'Sỉ', vip: 'VIP' };
const PAYMENT_METHODS = [
  { value: 'cash', label: '💵 Tiền mặt' },
  { value: 'bank', label: '🏦 Chuyển khoản' },
  { value: 'debt', label: '📝 Công nợ' },
];
const PAYMENT_LABELS = { cash: 'Tiền mặt', bank: 'Chuyển khoản', debt: 'Công nợ' };

const BANK_MAP = {
  'Vietcombank': 'VCB',
  'VietinBank': 'CTG',
  'TPBank': 'TPB',
  'MBBank': 'MB',
  'ACB': 'ACB',
  'VPBank': 'VPB',
  'Sacombank': 'SACBOM',
  'Agribank': 'VBA',
  'BIDV': 'BIDV',
  'Techcombank': 'TCB',
  'Default': 'ICB',
};

function buildVietQRUrl(store, amount, invoiceCode) {
  const bankName = (store.bank_name || '').trim();
  const bankCode = BANK_MAP[bankName] || BANK_MAP['Default'];
  const account = (store.bank_account || '').replace(/\s/g, '');
  const addInfo = encodeURIComponent(`Thanh toan don hang ${invoiceCode}`);
  const accountName = encodeURIComponent(store.name || '');
  return `https://img.vietqr.io/image/${bankCode}-${account}-compact2.png?amount=${amount}&addInfo=${addInfo}&accountName=${accountName}`;
}

export default function POS({ user, store }) {
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedUser, setSelectedUser] = useState(user);
  const [priceType, setPriceType] = useState('retail');
  const [cart, setCart] = useState([]);
  const [vatPercent, setVatPercent] = useState(0);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [showVariantPicker, setShowVariantPicker] = useState(null);
  const [variantQty, setVariantQty] = useState({});
  const [mainQty, setMainQty] = useState({});
  const [serverOnline, setServerOnline] = useState(true);
  const [pendingOrders, setPendingOrders] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kha_pending_orders') || '[]'); }
    catch { return []; }
  });
  const [loadError, setLoadError] = useState({ products: false, customers: false });
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastInvoice, setLastInvoice] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const variantInitQty = useRef({}); // Lưu số lượng ban đầu khi mở modal
  // Kiểm tra server
  const checkServer = () => {
    return fetch(`${API}/store`, { signal: AbortSignal.timeout(5000) })
      .then(() => { setServerOnline(true); return true; })
      .catch(() => { setServerOnline(false); return false; });
  };

  useEffect(() => {
    checkServer();
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

    Promise.all([
      Promise.race([
        fetch(`${API}/products/all/with-variants`).then(r => r.json()).then(d => { setProducts(d); setLoadError(e => ({ ...e, products: false })); }),
        timeout(8000).catch(() => { setLoadError(e => ({ ...e, products: true })); })
      ]),
      Promise.race([
        fetch(`${API}/customers`).then(r => r.json()).then(d => { setCustomers(d); setLoadError(e => ({ ...e, customers: false })); }),
        timeout(8000).catch(() => { setLoadError(e => ({ ...e, customers: true })); })
      ]),
      Promise.race([
        fetch(`${API}/users`).then(r => r.json()).then(setUsers).catch(() => { }),
        timeout(5000).catch(() => { })
      ]),
    ]);
  }, []);

  // Đồng bộ đơn offline
  useEffect(() => {
    if (!serverOnline || pendingOrders.length === 0) return;
    const syncPending = async () => {
      for (const order of [...pendingOrders]) {
        try {
          const res = await fetch(`${API}/invoices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(order.payload),
          });
          const data = await res.json();
          if (data.ok) {
            const remaining = pendingOrders.filter(o => o.id !== order.id);
            setPendingOrders(remaining);
            localStorage.setItem('kha_pending_orders', JSON.stringify(remaining));
            alert(`📦 Đơn offline đã đồng bộ! Mã: ${data.invoice_code}`);
          }
        } catch { /* chờ */ }
      }
    };
    syncPending();
  }, [serverOnline]);

  // Thêm biến thể với số lượng
  const addVariantWithQty = (v) => {
    if (v.stock <= 0) return;
    const qty = variantQty[v.id] || 1;
    if (qty <= 0) return;
    if (qty > v.stock) {
      alert(`Không đủ hàng! "${v.name}" chỉ còn ${v.stock} sản phẩm.`);
      return;
    }
    const unit_price = v[`${priceType}_price`] || v.retail_price;
    const displayName = getProductDisplayName({
      ...v,
      is_variant: true,
      parent_id: showVariantPicker?.id || v.parent_id || null,
      parent_name: showVariantPicker?.name || v.parent_name || v.parent?.name || '',
    }, showVariantPicker);
    const existing = cart.find(c => c.product_id === v.id && c.unit_price === unit_price);
    if (existing) {
      if (existing.quantity + qty > v.stock) {
        alert(`Không đủ hàng! Tổng sẽ vượt tồn kho (${v.stock}).`);
        return;
      }
      setCart(cart.map(c => c.product_id === v.id && c.unit_price === unit_price
        ? { ...c, quantity: c.quantity + qty, line_total: (c.quantity + qty) * c.unit_price - c.discount_amount }
        : c));
    } else {
      setCart([...cart, {
        id: Date.now(),
        product_id: v.id,
        variant_id: v.id,
        parent_id: showVariantPicker?.id || v.parent_id || null,
        parent_name: showVariantPicker?.name || v.parent_name || v.parent?.name || '',
        variant_name: v.name,
        product_name: displayName,
        product_sku: v.sku,
        name: displayName,
        sku: v.sku,
        quantity: qty,
        unit_price,
        discount_amount: 0,
        discount_percent: 0,
        line_total: qty * unit_price,
        max_stock: v.stock,
      }]);
    }
    setVariantQty({});
    setShowVariantPicker(null);
  };
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '', tax_code: '' });
  const printRef = useRef();

  // Computed
  const subtotal = cart.reduce((s, i) => s + i.line_total, 0);
  const vatAmount = subtotal * (vatPercent / 100);
  const afterVat = subtotal + vatAmount;
  const discountAmount = afterVat * (discountPercent / 100);
  const total = afterVat - discountAmount;

  const addProduct = (product) => {
    // Chặn sản phẩm hết hàng
    if (product.stock <= 0) {
      alert(`Sản phẩm "${product.name}" đã hết hàng!`);
      return;
    }
    const unit_price = product[`${priceType}_price`] || product.retail_price;
    const existing = cart.find(c => c.product_id === product.id && c.unit_price === unit_price);
    if (existing) {
      // Kiểm tra không vượt quá tồn kho
      if (existing.quantity + 1 > product.stock) {
        alert(`Không đủ hàng! "${product.name}" chỉ còn ${product.stock} sản phẩm.`);
        return;
      }
      setCart(cart.map(c => c.product_id === product.id && c.unit_price === unit_price
        ? { ...c, quantity: c.quantity + 1, line_total: (c.quantity + 1) * c.unit_price - c.discount_amount }
        : c));
    } else {
      setCart([...cart, {
        id: Date.now(),
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku,
        quantity: 1,
        unit_price,
        discount_amount: 0,
        discount_percent: 0,
        line_total: unit_price,
        max_stock: product.stock,
      }]);
    }
  };

  const updateCartItem = (id, field, value) => {
    setCart(cart.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, [field]: value };
      if (field === 'quantity' && value > item.max_stock) {
        updated.quantity = item.max_stock;
      }
      updated.line_total = updated.quantity * updated.unit_price - updated.discount_amount;
      return updated;
    }));
  };

  const removeCartItem = (id) => setCart(cart.filter(i => i.id !== id));

  const addNewCustomer = async () => {
    if (!newCustomer.name) return;
    const res = await fetch(`${API}/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newCustomer, customer_type: 'retail' }),
    });
    const data = await res.json();
    if (data.ok) {
      const full = { ...newCustomer, id: data.id };
      setCustomers([...customers, full]);
      setSelectedCustomer(full);
      setShowCustomerForm(false);
      setNewCustomer({ name: '', phone: '', email: '', tax_code: '' });
    }
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    const orderPayload = {
      customer_id: selectedCustomer?.id || null,
      user_id: selectedUser?.id,
      subtotal,
      vat_percent: vatPercent,
      vat_amount: vatAmount,
      discount_amount: discountAmount,
      discount_percent: discountPercent,
      total,
      paid_amount: paymentMethod === 'debt' ? 0 : total,
      change_amount: 0,
      remaining_amount: paymentMethod === 'debt' ? total : 0,
      delivery_fee: 0,
      payment_method: paymentMethod,
      note,
      details: cart.map(({ id, product_id, variant_id, parent_id, parent_name, variant_name, product_name, product_sku, name, sku, quantity, unit_price, discount_amount, discount_percent, line_total }) =>
        ({ product_id, variant_id: variant_id || null, parent_id: parent_id || null, parent_name: parent_name || '', variant_name: variant_name || '', product_name: product_name || name || '', product_sku: product_sku || sku || '', name: name || product_name || '', sku: sku || product_sku || '', quantity, unit_price, discount_amount, discount_percent, line_total })),
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
        setLastInvoice({ ...data, customer: selectedCustomer, user: selectedUser, cart, subtotal, vatAmount, vatPercent, discountAmount, discountPercent, total, paid_amount: orderPayload.paid_amount, change_amount: orderPayload.change_amount, remaining_amount: orderPayload.remaining_amount, delivery_fee: orderPayload.delivery_fee, note, paymentMethod });
        setShowSuccess(true);
        // Reset
        setCart([]);
        setSelectedCustomer(null);
        setVatPercent(0);
        setDiscountPercent(0);
        setNote('');
        // Refresh products
        fetch(`${API}/products/all/with-variants`).then(r => r.json()).then(setProducts).catch(() => { });
      } else {
        alert(data.error || 'Tạo đơn thất bại!');
      }
    } catch {
      // ===== LƯU ĐƠN OFFLINE =====
      const offlineOrder = {
        id: Date.now().toString(),
        payload: orderPayload,
        created_at: new Date().toISOString(),
        total,
        customer_name: selectedCustomer?.name || 'Khách lẻ',
        item_count: cart.reduce((s, i) => s + i.quantity, 0),
      };
      const updated = [offlineOrder, ...pendingOrders].slice(0, 50);
      setPendingOrders(updated);
      localStorage.setItem('kha_pending_orders', JSON.stringify(updated));
      setCart([]);
      setSelectedCustomer(null);
      setVatPercent(0);
      setDiscountPercent(0);
      setNote('');
      alert(`📡 Không kết nối được server!\n\nĐơn đã được lưu offline.\nMã tạm: OFFLINE_${offlineOrder.id.slice(-6)}\nTổng: ${formatVND(total)}\n\nSẽ đồng bộ tự động khi server trở lại.`);
    }
  };

  const handlePrint = async () => {
    if (!lastInvoice) {
      alert('Không có dữ liệu hóa đơn để in.');
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Trình duyệt đã chặn cửa sổ in. Vui lòng cho phép popup và thử lại.');
      return;
    }

    try {
      writePrintWindowMessage(printWindow, { title: 'Đang chuẩn bị in hóa đơn', message: 'Đang tải mẫu in mặc định và dữ liệu hóa đơn...' });
      const template = await getDefaultPrintTemplate({
        apiBase: API,
        type: 'sale_invoice',
        paperSize: 'A4',
        fallbackPaperSize: 'A4',
      });
      const printData = createInvoicePrintData({
        store,
        invoice: lastInvoice,
        customer: lastInvoice.customer,
        user: lastInvoice.user,
        items: lastInvoice.cart,
      });
      printInvoice({
        data: printData,
        template,
        title: `Hóa đơn ${lastInvoice.invoice_code || ''}`.trim(),
        targetWindow: printWindow,
      });
    } catch (err) {
      writePrintWindowMessage(printWindow, { title: 'Không thể in hóa đơn', message: err.message || 'Không thể render hóa đơn. Vui lòng thử lại.', tone: 'error' });
      alert(err.message || 'Không thể in hóa đơn.');
    }
  };

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.sku || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.variants || []).some(v => v.name.toLowerCase().includes(search.toLowerCase()))
  );

  const formatVND = (n) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
  const formatDate = (d) => new Date(d).toLocaleString('vi-VN');

  return (
    <div className="flex gap-4 h-full">
      {/* ===== LEFT: Product list ===== */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Server status + Pending */}
        <div className="mb-3 flex items-center gap-3">
          {pendingOrders.length > 0 && (
            <button
              onClick={() => {
                const msg = pendingOrders.map(o => `• ${o.customer_name} — ${formatVND(o.total)} (${o.item_count} SP) — ${new Date(o.created_at).toLocaleString('vi-VN')}`).join('\n');
                alert(`📋 Đơn chờ đồng bộ (${pendingOrders.length}):\n\n${msg}\n\nServer sẽ tự đồng bộ khi kết nối lại.`);
              }}
              className="px-3 py-1.5 bg-orange-500 border border-orange-600 text-white rounded-lg text-xs font-bold shadow-sm hover:bg-orange-600">
              ⏳ {pendingOrders.length} đơn chờ sync
            </button>
          )}
          <button
            onClick={() => setShowHelp(true)}
            className="ml-auto px-3 py-1.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg text-xs font-medium flex items-center gap-1"
          >
            ❓ Hướng dẫn
          </button>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${serverOnline ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-600'
            }`}>
            <span className={`w-2 h-2 rounded-full ${serverOnline ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
            {serverOnline ? '🟢 Online' : '🔴 Offline'}
          </div>
        </div>

        {/* Search - ĐẦU TIÊN */}
        <div className="mb-3">
          <input className="input-field" placeholder="🔍 Tìm theo tên sản phẩm hoặc mã SP (VD: SP001)..." value={search} onChange={e => setSearch(e.target.value)} autoFocus />
        </div>

        {/* Form: Loại khách + Khách hàng + Nhân viên - THỨ HAI */}
        <div className="card mb-3 flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-gray-500">Loại khách hàng / Giá</label>
            <div className="flex gap-2 mt-1">
              {Object.entries(PRICE_LABELS).map(([k, v]) => (
                <button key={k} onClick={() => setPriceType(k)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition border ${priceType === k ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-blue-400'}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-500">Khách hàng</label>
            <div className="flex mt-1">
              <select className="input-field flex-1" value={selectedCustomer?.id || ''} onChange={e => {
                const c = customers.find(c => c.id === +e.target.value);
                setSelectedCustomer(c || null);
                if (c) setPriceType(c.customer_type || 'retail');
              }}>
                <option value="">-- Khách lẻ --</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>)}
              </select>
              <button onClick={() => setShowCustomerForm(!showCustomerForm)} className="ml-2 btn-primary text-sm px-3">+</button>
            </div>
          </div>
          <div className="flex-1">
            <label className="text-xs text-gray-500">Nhân viên</label>
            <select className="input-field mt-1" value={selectedUser?.id || user.id} onChange={e => {
              const u = users.find(u => u.id === +e.target.value);
              if (u) setSelectedUser(u);
            }}>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>

        {/* New customer form */}
        {showCustomerForm && (
          <div className="card mb-3 border-l-4 border-blue-500">
            <h3 className="font-semibold text-sm mb-2">Thêm khách hàng mới</h3>
            <div className="grid grid-cols-4 gap-2 mb-2">
              <input className="input-field" placeholder="Tên KH" value={newCustomer.name} onChange={e => setNewCustomer({ ...newCustomer, name: e.target.value })} />
              <input className="input-field" placeholder="SĐT" value={newCustomer.phone} onChange={e => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
              <input className="input-field" placeholder="Email" value={newCustomer.email} onChange={e => setNewCustomer({ ...newCustomer, email: e.target.value })} />
              <input className="input-field" placeholder="MST" value={newCustomer.tax_code} onChange={e => setNewCustomer({ ...newCustomer, tax_code: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button onClick={addNewCustomer} className="btn-success text-sm">💾 Lưu</button>
              <button onClick={() => setShowCustomerForm(false)} className="btn-danger text-sm">Hủy</button>
            </div>
          </div>
        )}

        {/* Products grid */}
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-3 xl:grid-cols-4 gap-2">
            {filteredProducts.map(p => (
              p.variants && p.variants.length > 0 ? (
                <div key={p.id}
                  className={`rounded border text-left p-3 transition relative ${p.stock <= 0 ? 'bg-gray-100 border-red-300 opacity-60' : 'bg-white hover:border-green-500 hover:shadow'}`}>
                  {p.stock <= 0 && (
                    <span className="absolute top-2 right-2 bg-red-600 text-white text-xs px-2 py-0.5 rounded font-bold">HẾT HÀNG</span>
                  )}
                  <div className={`text-sm font-medium truncate ${p.stock <= 0 ? 'text-red-600 line-through' : 'text-gray-800'}`}>{p.name}</div>
                  <div className="text-xs text-gray-400">{p.sku}</div>
                  <div className="text-xs text-green-600 mt-1">Có {p.variants.length} biến thể</div>
                  <div className={`text-xs mt-1 ${p.stock < 10 && p.stock > 0 ? 'text-red-500' : 'text-gray-400'}`}>Còn: {p.stock}</div>
                  {/* Thêm số lượng + nút */}
                  {p.stock > 0 && (
                    <div className="flex items-center gap-1 mt-2">
                      <input type="number" min="1" max={p.stock}
                        value={mainQty[p.id] || 1}
                        onChange={e => setMainQty({ ...mainQty, [p.id]: Math.min(p.stock, Math.max(1, +e.target.value)) })}
                        onClick={e => e.stopPropagation()}
                        className="w-14 border rounded px-2 py-1 text-xs text-center" />
                      <button onClick={e => {
                        e.stopPropagation();
                        const qty = mainQty[p.id] || 1;
                        // Lưu số lượng vào ref để modal dùng
                        const initQty = {};
                        p.variants.forEach(v => { initQty[v.id] = qty; });
                        variantInitQty.current = initQty;
                        // Reset variantQty theo ref
                        setVariantQty({ ...initQty });
                        setShowVariantPicker({ ...p });
                      }} className="flex-1 btn-success text-xs py-1">+ Thêm</button>
                      <button onClick={e => { e.stopPropagation(); setShowVariantPicker(p); }} className="text-xs text-green-600 hover:text-green-800 border border-green-300 rounded px-1 py-1">↓</button>
                    </div>
                  )}
                </div>
              ) : (
                <button key={p.id} onClick={() => addProduct(p)}
                  disabled={p.stock <= 0}
                  className={`rounded border text-left p-3 transition relative ${p.stock <= 0
                    ? 'bg-gray-100 border-red-300 opacity-60 cursor-not-allowed'
                    : 'bg-white hover:border-blue-500 hover:shadow'
                    }`}>
                  {p.stock <= 0 && (
                    <span className="absolute top-2 right-2 bg-red-600 text-white text-xs px-2 py-0.5 rounded font-bold">HẾT HÀNG</span>
                  )}
                  <div className={`text-sm font-medium truncate ${p.stock <= 0 ? 'text-red-600 line-through' : 'text-gray-800'}`}>{p.name}</div>
                  <div className="text-xs text-gray-400">{p.sku}</div>
                  {p.stock > 0 && (
                    <div className="text-sm font-bold text-blue-600 mt-1">{formatVND(p[`${priceType}_price`] || p.retail_price)}</div>
                  )}
                  <div className={`text-xs mt-1 ${p.stock < 10 && p.stock > 0 ? 'text-red-500' : 'text-gray-400'}`}>Sản Phẩm Còn Hàng: {p.stock}</div>
                </button>
              )
            ))}
          </div>
          {filteredProducts.length === 0 && (
            <div className="text-center text-gray-400 mt-10">Không tìm thấy sản phẩm</div>
          )}
        </div>

        {/* Variant Picker Modal */}
        {showVariantPicker && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-[520px] max-h-[80vh] overflow-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">Chọn biến thể: {showVariantPicker.name}</h2>
                <button onClick={() => { setShowVariantPicker(null); setVariantQty({}); }} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {showVariantPicker.variants.map(v => {
                  const qty = variantQty[v.id] || 1;
                  const overStock = qty > v.stock && v.stock > 0;
                  return (
                    <div key={v.id} className={`border rounded-lg p-3 text-left transition ${v.stock <= 0 ? 'border-red-300 bg-gray-100 opacity-60' : 'border-gray-200 hover:border-blue-500'}`}>
                      {v.stock <= 0 && (
                        <span className="bg-red-600 text-white text-xs px-1 py-0.5 rounded font-bold">HẾT HÀNG</span>
                      )}
                      <div className={`text-sm font-medium mt-1 ${v.stock <= 0 ? 'text-red-600 line-through' : ''}`}>{getProductDisplayName(v, showVariantPicker)}</div>
                      <div className="text-xs text-gray-400">{v.sku}</div>
                      <div className="text-sm font-bold text-blue-600 mt-1">{formatVND(v[`${priceType}_price`] || v.retail_price)}</div>
                      <div className={`text-xs ${v.stock < 10 && v.stock > 0 ? 'text-red-500' : 'text-gray-400'}`}>Tồn: {v.stock}</div>

                      {v.stock > 0 && (
                        <div className="mt-2 flex items-center gap-1">
                          <label className="text-xs text-gray-500">SL:</label>
                          <input type="number" min="1" max={v.stock}
                            value={qty}
                            onChange={e => setVariantQty({ ...variantQty, [v.id]: Math.min(v.stock, Math.max(1, +e.target.value)) })}
                            className={`w-16 border rounded px-2 py-1 text-xs text-center ${overStock ? 'border-red-500 bg-red-50' : ''}`}
                          />
                          {overStock && <span className="text-xs text-red-500">max {v.stock}</span>}
                          <button onClick={() => {
                            const vi = { ...v };
                            setVariantQty(prev => ({ ...prev, [v.id]: 1 }));
                            addVariantWithQty(vi);
                          }} className="ml-auto btn-success text-xs px-2 py-1">+ Thêm</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    showVariantPicker.variants.forEach(v => {
                      if (v.stock <= 0) return;
                      const qty = variantQty[v.id] || 1;
                      if (qty <= 0) return;
                      const unit_price = v[`${priceType}_price`] || v.retail_price;
                      const displayName = getProductDisplayName({
                        ...v,
                        is_variant: true,
                        parent_id: showVariantPicker?.id || v.parent_id || null,
                        parent_name: showVariantPicker?.name || v.parent_name || v.parent?.name || '',
                      }, showVariantPicker);
                      const existing = cart.find(c => c.product_id === v.id && c.unit_price === unit_price);
                      if (existing) {
                        if (existing.quantity + qty > v.stock) return;
                        setCart(prev => prev.map(c => c.product_id === v.id && c.unit_price === unit_price
                          ? { ...c, quantity: c.quantity + qty, line_total: (c.quantity + qty) * c.unit_price - c.discount_amount }
                          : c));
                      } else {
                        setCart(prev => [...prev, {
                          id: Date.now() + Math.random(),
                          product_id: v.id,
                          variant_id: v.id,
                          parent_id: showVariantPicker?.id || v.parent_id || null,
                          parent_name: showVariantPicker?.name || v.parent_name || v.parent?.name || '',
                          variant_name: v.name,
                          product_name: displayName,
                          product_sku: v.sku,
                          name: displayName,
                          sku: v.sku,
                          quantity: qty,
                          unit_price,
                          discount_amount: 0,
                          discount_percent: 0,
                          line_total: qty * unit_price,
                          max_stock: v.stock,
                        }]);
                      }
                    });
                    setShowVariantPicker(null);
                    setVariantQty({});
                  }}
                  className="flex-1 btn-success py-2">
                  ✅ Thêm vào đơn
                </button>
                <button onClick={() => { setShowVariantPicker(null); setVariantQty({}); }} className="btn-danger px-4">Đóng</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== RIGHT: Cart ===== */}
      <div className="w-[380px] flex flex-col">
        <div className="card flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg">🛒 Đơn hàng</h2>
            <span className="text-sm text-gray-500">{cart.length} món</span>
          </div>

          {/* Cart table: STT | Tên SP | CK% | Thành tiền | ✕ */}
          <div className="flex-1 overflow-auto border rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-blue-600 text-white text-[10px]">
                  <th className="py-1.5 px-2 text-center w-8">STT</th>
                  <th className="py-1.5 px-2 text-left">Tên sản phẩm</th>
                  <th className="py-1.5 px-2 text-center w-10">SL</th>
                  <th className="py-1.5 px-2 text-right w-16">Chiết khấu</th>
                  <th className="py-1.5 px-2 text-right w-20">Thành tiền</th>
                  <th className="py-1.5 px-2 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((item, idx) => (
                  <tr key={item.id} className={`border-b border-gray-100 hover:bg-gray-50 ${item.quantity > item.max_stock ? 'bg-red-50' : ''}`}>
                    <td className="py-1.5 px-2 text-center font-medium text-gray-500">{idx + 1}</td>
                    <td className="py-1.5 px-2">
                      <div className={`font-medium text-gray-800 ${item.quantity > item.max_stock ? 'text-red-600' : ''}`}>
                        {getProductDisplayName(item)}
                      </div>
                      <div className="text-[10px] text-gray-400">{formatVND(item.unit_price)} × {item.quantity}</div>
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <input type="number" min="1" value={item.quantity}
                        onChange={e => updateCartItem(item.id, 'quantity', Math.max(1, +e.target.value))}
                        className={`w-10 text-center border rounded px-1 py-0.5 text-xs ${item.quantity > item.max_stock ? 'border-red-500 bg-red-100' : ''}`} />
                    </td>
                    <td className="py-1.5 px-2 text-right text-red-500">
                      {item.discount_percent > 0 ? `${item.discount_percent}%` : '—'}
                    </td>
                    <td className={`py-1.5 px-2 text-right font-semibold ${item.quantity > item.max_stock ? 'text-red-600' : 'text-blue-700'}`}>
                      {formatVND(item.line_total)}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <button onClick={() => removeCartItem(item.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                    </td>
                  </tr>
                ))}
                {cart.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-gray-400 py-8">Chưa có sản phẩm nào</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          <div className="border-t mt-2 pt-2 text-xs space-y-1">
            <div className="flex justify-between"><span>Tạm tính:</span><span className="font-semibold">{formatVND(subtotal)}</span></div>
            <div className="flex items-center gap-2">
              <span>Thuế VAT:</span>
              <input type="number" min="0" max="100" value={vatPercent}
                onChange={e => setVatPercent(Math.min(100, Math.max(0, +e.target.value)))}
                className="w-12 text-right border rounded px-1 py-0.5 text-xs" />%
              <span className="ml-auto">{formatVND(vatAmount)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span>Chiết khấu:</span>
              <input type="number" min="0" max="100" value={discountPercent}
                onChange={e => setDiscountPercent(Math.min(100, Math.max(0, +e.target.value)))}
                className="w-12 text-right border rounded px-1 py-0.5 text-xs" />%
              <span className="ml-auto text-red-500">-{formatVND(discountAmount)}</span>
            </div>
            <div className="flex justify-between items-center bg-blue-50 rounded px-3 py-2 border border-blue-200">
              <span className="font-bold text-sm">Thành tiền:</span>
              <span className="text-blue-700 text-base font-bold">{formatVND(total)}</span>
            </div>
          </div>

          {/* Note + Payment */}
          <div className="mt-2 space-y-2">
            <input className="input-field text-xs" placeholder="Ghi chú đơn hàng..." value={note} onChange={e => setNote(e.target.value)} />
            <div className="flex gap-2">
              {PAYMENT_METHODS.map(({ value, label }) => (
                <button key={value} onClick={() => setPaymentMethod(value)}
                  className={`flex-1 py-2 rounded text-sm font-medium border transition ${paymentMethod === value ? 'bg-green-600 text-white border-green-600' : 'border-gray-300 text-gray-600'}`}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={handleCheckout} disabled={cart.length === 0}
              className="w-full btn-success py-3 text-lg disabled:opacity-40 disabled:cursor-not-allowed">
              ✅ Thanh toán
            </button>
          </div>
        </div>
      </div>

      {/* ===== SUCCESS / PRINT MODAL ===== */}
      {(showSuccess && lastInvoice) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[700px] max-h-[90vh] overflow-auto">
            <div className="text-center mb-4">
              <div className="text-5xl mb-2">✅</div>
              <h2 className="text-xl font-bold text-green-600">Thanh toán thành công!</h2>
              <p className="text-gray-500 text-sm">Mã hóa đơn: <strong>{lastInvoice.invoice_code}</strong></p>
            </div>

            {/* Hidden printable area */}
            <div ref={printRef} className="hidden print:block" style={{ display: 'none', fontFamily: 'Arial, sans-serif', background: '#fff' }}>
              <style>{`
                @page {
                  size: A5 portrait;
                  margin: 8mm;
                }
                * {
                  box-sizing: border-box;
                  margin: 0;
                  padding: 0;
                }
                body {
                  font-size: 10px;
                  line-height: 1.3;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                }
                table {
                  width: 100%;
                  border-collapse: collapse;
                  font-size: 9px;
                  margin-bottom: 4px;
                }
                th, td {
                  border: 1px solid #ccc;
                  padding: 2px 3px;
                  vertical-align: top;
                }
                th {
                  background: #333 !important;
                  color: #fff !important;
                  font-weight: bold;
                  text-align: center;
                }
                .header {
                  text-align: center;
                  margin-bottom: 4px;
                }
                .shop-name {
                  font-size: 12px;
                  font-weight: bold;
                  text-transform: uppercase;
                  margin-bottom: 2px;
                }
                .shop-info {
                  font-size: 8px;
                  color: #666;
                }
                .invoice-title {
                  font-size: 14px;
                  font-weight: bold;
                  margin: 3px 0;
                  text-transform: uppercase;
                }
                .info-grid {
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: 1px;
                  font-size: 8px;
                  margin-bottom: 3px;
                }
                .info-grid div {
                  background: #f5f5f5;
                  padding: 1px 3px;
                }
                .totals {
                  width: 100%;
                  margin-top: 3px;
                  font-size: 9px;
                }
                .totals tr td {
                  border: none;
                  padding: 1px 2px;
                }
                .totals tr td:last-child {
                  text-align: right;
                  font-weight: bold;
                }
                .grand td {
                  font-weight: bold;
                  font-size: 11px;
                  border-top: 1px solid #000;
                  padding-top: 2px;
                  color: #d00;
                }
                .signatures {
                  display: flex;
                  justify-content: space-between;
                  margin-top: 8px;
                  font-size: 8px;
                }
                .sig-box {
                  text-align: center;
                  width: 48%;
                }
                .sig-title {
                  font-weight: bold;
                  margin-bottom: 2px;
                }
                .sig-note {
                  font-style: italic;
                  font-size: 7px;
                  color: #666;
                }
                .sig-space {
                  height: 20px;
                }
                .footer {
                  text-align: center;
                  font-size: 8px;
                  margin-top: 4px;
                  border-top: 1px dashed #999;
                  padding-top: 2px;
                  color: #555;
                }
                .text-right { text-align: right; }
                .text-center { text-align: center; }
              `}</style>

              {/* ===== HEADER: Tên cửa hàng ===== */}
              <div className="text-center mb-1">
                <div className="font-bold text-base uppercase">{store.name || 'Cửa hàng'}</div>
                <div className="text-[10px] text-gray-600">Địa chỉ: {store.address || '—'} | MST: {store.tax_code || '—'} | {store.phone || ''}</div>
              </div>

              {/* ===== TIÊU ĐỀ ===== */}
              <div className="border-t border-b border-dashed border-gray-400 py-1 mb-2 text-center">
                <div className="font-bold text-sm uppercase">Hóa đơn bán hàng</div>
              </div>

              {/* ===== THÔNG TIN ĐƠN HÀNG ===== */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] mb-2">
                <div><span className="font-semibold">Mã hóa đơn:</span> <b>{lastInvoice.invoice_code}</b></div>
                <div><span className="font-semibold">Ngày:</span> {formatDate(new Date())}</div>
                <div><span className="font-semibold">Khách hàng:</span> {lastInvoice.customer?.name || 'Khách lẻ'}</div>
                <div><span className="font-semibold">SĐT:</span> {lastInvoice.customer?.phone || '—'}</div>
                <div><span className="font-semibold">NV xuất hàng:</span> {lastInvoice.user?.name}</div>
                <div><span className="font-semibold">Giờ xuất:</span> {new Date().toLocaleTimeString('vi-VN')}</div>
              </div>

              {/* ===== BẢNG HÀNG HÓA ===== */}
              <table className="w-full text-[10px] border-collapse mb-2">
                <thead>
                  <tr className="bg-gray-800 text-white">
                    <th className="border border-gray-400 p-1 text-center w-6">STT</th>
                    <th className="border border-gray-400 p-1 text-left">Tên sản phẩm</th>
                    <th className="border border-gray-400 p-1 text-center w-8">SL</th>
                    <th className="border border-gray-400 p-1 text-right w-18">Đơn giá</th>
                    <th className="border border-gray-400 p-1 text-center w-8">CK%</th>
                    <th className="border border-gray-400 p-1 text-right w-18">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {lastInvoice.cart.map((item, idx) => (
                    <tr key={idx}>
                      <td className="border border-gray-400 p-1 text-center">{idx + 1}</td>
                      <td className="border border-gray-400 p-1">{getProductDisplayName(item)}</td>
                      <td className="border border-gray-400 p-1 text-center">{item.quantity}</td>
                      <td className="border border-gray-400 p-1 text-right">{formatVND(item.unit_price)}</td>
                      <td className="border border-gray-400 p-1 text-center">{item.discount_percent > 0 ? `${item.discount_percent}%` : '—'}</td>
                      <td className="border border-gray-400 p-1 text-right font-medium">{formatVND(item.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* ===== TỔNG KẾT ===== */}
              <div className="border-t border-dashed border-gray-400 pt-1.5 mb-2 text-[10px] space-y-0.5">
                <div className="flex justify-between"><span>Tạm tính:</span><span>{formatVND(lastInvoice.subtotal)}</span></div>
                {lastInvoice.vatPercent > 0 && (
                  <div className="flex justify-between"><span>Thuế VAT ({lastInvoice.vatPercent}%):</span><span>{formatVND(lastInvoice.vatAmount)}</span></div>
                )}
                {lastInvoice.discountPercent > 0 && (
                  <div className="flex justify-between text-red-500"><span>Chiết khấu ({lastInvoice.discountPercent}%):</span><span>-{formatVND(lastInvoice.discountAmount)}</span></div>
                )}
                <div className="flex justify-between font-bold text-sm border-t border-dashed border-gray-400 pt-1 mt-1">
                  <span>Khách phải trả:</span><span className="text-red-600">{formatVND(lastInvoice.total)}</span>
                </div>
                <div className="flex justify-between mt-0.5">
                  <span>Thanh toán:</span><span className="font-semibold">{PAYMENT_LABELS[lastInvoice.paymentMethod] || lastInvoice.paymentMethod}</span>
                </div>
                {lastInvoice.note && (
                  <div className="flex justify-between"><span>Ghi chú:</span><span className="italic">{lastInvoice.note}</span></div>
                )}
              </div>

              {/* ===== QR THANH TOÁN ===== */}
              {store.bank_account && lastInvoice.paymentMethod === 'bank' && (
                <div className="border-t border-dashed border-gray-400 pt-1.5 mb-1 text-center">
                  <div className="text-[9px] text-gray-500 mb-1">Quét mã QR để thanh toán</div>
                  <img src={buildVietQRUrl(store, Math.round(lastInvoice.total), lastInvoice.invoice_code)} width="110" className="mx-auto mb-1" alt="QR" onError={e => { e.target.style.display = 'none'; }} />
                  {store.invoice_vietqr_logo && <img src={store.invoice_vietqr_logo} alt="brand" className="mx-auto h-6 object-contain mb-0.5" onError={e => { e.target.style.display = 'none'; }} />}
                  <div className="text-[9px] font-semibold text-gray-700">STK: {store.bank_account} | {store.bank_name || ''}</div>
                </div>
              )}
              {store.invoice_slogan && <div className="text-center text-[9px] italic text-gray-500 mb-0.5">{store.invoice_slogan}</div>}
              {store.invoice_note && <div className="text-center text-[9px] text-gray-600 mb-0.5">{store.invoice_note}</div>}
              <div className="text-center text-[9px] font-medium">Cảm ơn quý khách! Hẹn gặp lại!</div>
            </div>

            <div className="flex gap-2">
              <button onClick={handlePrint} className="flex-1 btn-primary py-2">🖨️ In hóa đơn</button>
              <button onClick={() => { setShowSuccess(false); setLastInvoice(null); }} className="flex-1 btn-success py-2">Tiếp tục bán</button>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <HelpModal
          title="Hướng dẫn sử dụng Trang bán hàng (POS)"
          onClose={() => setShowHelp(false)}
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">🛒 Tổng quan</h3>
                <p>Trang POS (Point of Sale) giúp bạn bán hàng nhanh chóng với các tính năng: tìm kiếm sản phẩm, chọn khách hàng, thêm vào giỏ, áp dụng VAT/chiết khấu, và tạo hóa đơn.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🔍 Tìm kiếm sản phẩm</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Nhập tên sản phẩm hoặc mã SKU vào ô tìm kiếm</li>
                  <li>Kết quả sẽ lọc tự động khi gõ</li>
                  <li>Nhấn vào sản phẩm để thêm vào giỏ hàng</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📦 Thêm sản phẩm vào giỏ</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Sản phẩm đơn giản:</strong> Nhấn trực tiếp vào tên sản phẩm để thêm 1 cái</li>
                  <li><strong>Sản phẩm có biến thể:</strong> Nhấn vào để mở popup chọn biến thể (màu, size...)</li>
                  <li>Nhập số lượng trong popup, sau đó nhấn "Thêm"</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">💰 Chọn loại giá</h3>
                <p>Có 3 mức giá bán:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li><strong>Lẻ:</strong> Giá bán lẻ cho khách mua lẻ</li>
                  <li><strong>Sỉ:</strong> Giá sỉ cho khách mua số lượng lớn</li>
                  <li><strong>VIP:</strong> Giá đặc biệt cho khách VIP</li>
                </ul>
                <p className="mt-2">Chọn loại giá trước khi thêm sản phẩm vào giỏ để áp dụng đúng giá.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📋 Quản lý giỏ hàng</h3>
                <p>Phần bên phải hiển thị giỏ hàng với các thông tin:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Tên sản phẩm, số lượng, đơn giá, thành tiền</li>
                  <li>Tạm tính (subtotal)</li>
                  <li>Thuế VAT (nếu có)</li>
                  <li>Chiết khấu toàn đơn</li>
                  <li>Tổng cộng (total)</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📝 Thông tin đơn hàng</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Khách hàng:</strong> Chọn khách hàng có sẵn hoặc thêm mới</li>
                  <li><strong>Nhân viên:</strong> Chọn nhân viên bán hàng (mặc định là user đang đăng nhập)</li>
                  <li><strong>Ghi chú:</strong> Thêm ghi chú cho đơn hàng nếu cần</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🏧 Thanh toán</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Tiền mặt:</strong> Chọn để in hóa đơn tiền mặt</li>
                  <li><strong>Chuyển khoản:</strong> Hiển thị QR code VietQR để khách quét</li>
                  <li><strong>Công nợ:</strong> Ghi nhận đơn khách còn nợ để theo dõi sau</li>
                  <li>Nhập % VAT (nếu cần)</li>
                  <li>Nhập % chiết khấu toàn đơn</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🖨️ Tạo và in hóa đơn</h3>
                <p>Khi giỏ hàng đã đủ, nhấn nút <strong>"Tạo hóa đơn"</strong>:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Hệ thống sẽ tạo hóa đơn mới</li>
                  <li>Tự động trừ tồn kho</li>
                  <li>Hiển thị màn hình in hóa đơn với QR code (nếu chuyển khoản)</li>
                  <li>Có thể in trực tiếp hoặc lưu PDF</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📡 Chế độ Offline</h3>
                <p>Nếu server không kết nối được:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Đơn hàng sẽ được lưu vào localStorage</li>
                  <li>Hiển thị cảnh báo "🔴 Offline"</li>
                  <li>Khi server online lại, đơn sẽ tự động đồng bộ</li>
                </ul>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-800 mb-2">💡 Mẹo</h3>
                <ul className="list-disc pl-5 space-y-1 text-blue-700">
                  <li>Luôn kiểm tra tồn kho trước khi bán</li>
                  <li>Sử dụng loại giá phù hợp với khách hàng</li>
                  <li>Ghi chú đơn hàng để dễ theo dõi sau này</li>
                  <li>Đơn hàng tạo thành công sẽ tự động xuất hiện trong "Danh sách đơn hàng"</li>
                </ul>
              </div>
            </div>
          }
        />
      )}

      {/* ===== OFFLINE ORDER SAVED ===== */}
      {/* (Modal removed — orders auto-save to localStorage and show in OrderList) */}
    </div>
  );
}
