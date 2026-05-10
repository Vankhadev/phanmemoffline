import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../App';
import { Users, FileDown, Plus, X, Edit2, Trash2, Loader, Tag, HelpCircle, UploadCloud } from 'lucide-react';
import HelpModal from '../components/HelpModal';

export default function Customers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [customerTypes, setCustomerTypes] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', phone: '', email: '', tax_code: '', customer_type: '' });
  const [reportMonth, setReportMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [showHelp, setShowHelp] = useState(false);
  const customerNameInputRef = useRef(null);
  const typeNameInputRef = useRef(null);

  // Customer types management
  const [showTypeManager, setShowTypeManager] = useState(false);
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [typeForm, setTypeForm] = useState({ name: '', color: '#3b82f6' });

  useEffect(() => { setLoading(true); Promise.all([fetchCustomers(), fetchCustomerTypes()]).finally(() => setLoading(false)); }, []);

  useEffect(() => {
    if (!showForm) return undefined;

    const timer = window.setTimeout(() => {
      customerNameInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [showForm]);

  useEffect(() => {
    if (!showTypeForm) return undefined;

    const timer = window.setTimeout(() => {
      typeNameInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [showTypeForm]);

  const fetchCustomers = () => fetch(`${API}/customers`).then(r => r.json()).then(setCustomers).catch(() => {});
  const fetchCustomerTypes = () => fetch(`${API}/customer-types`).then(r => r.json()).then(setCustomerTypes).catch(() => {});

  const getTypeLabel = (typeId) => {
    if (!typeId) return 'Khách lẻ';
    const ct = customerTypes.find(t => t.name?.toLowerCase() === String(typeId).toLowerCase());
    return ct ? ct.name : String(typeId);
  };
  const getTypeColor = (typeId) => {
    if (!typeId) return { backgroundColor: '#f3f4f6', color: '#374151' };
    const ct = customerTypes.find(t => t.name?.toLowerCase() === String(typeId).toLowerCase());
    return ct ? { backgroundColor: ct.color + '20', color: ct.color, border: `1px solid ${ct.color}40` } : { backgroundColor: '#f3f4f6', color: '#374151' };
  };
  const defaultType = () => customerTypes[0]?.name || 'Khách lẻ';
  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', phone: '', email: '', tax_code: '', customer_type: defaultType() });
    setShowForm(true);
  };
  const openEdit = (c) => {
    const ctName = c.customer_type || defaultType();
    setEditing(c);
    setForm({
      name: c.name, phone: c.phone || '', email: c.email || '',
      tax_code: c.tax_code || '', customer_type: ctName
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.name) return;
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/customers/${editing.id}` : `${API}/customers`;
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const data = await res.json();
    if (data.ok) { setShowForm(false); fetchCustomers(); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Xóa khách hàng này?')) return;
    const res = await fetch(`${API}/customers/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) fetchCustomers();
  };

  // Customer types CRUD
  const openTypeAdd = () => { setEditingType(null); setTypeForm({ name: '', color: '#3b82f6' }); setShowTypeForm(true); };
  const openTypeEdit = (t) => { setEditingType(t); setTypeForm({ name: t.name, color: t.color || '#3b82f6' }); setShowTypeForm(true); };
  const handleTypeSubmit = async () => {
    if (!typeForm.name) return;
    const method = editingType ? 'PUT' : 'POST';
    const url = editingType ? `${API}/customer-types/${editingType.id}` : `${API}/customer-types`;
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(typeForm) });
    const data = await res.json();
    if (data.ok) { setShowTypeForm(false); fetchCustomerTypes(); }
  };
  const handleTypeDelete = async (id) => {
    if (!confirm('Xóa loại khách này?')) return;
    await fetch(`${API}/customer-types/${id}`, { method: 'DELETE' });
    fetchCustomerTypes();
  };

  const COLOR_PRESETS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone || '').includes(search)
  );

  // ===== Xuất Excel báo cáo khách hàng =====
  const exportCustomersReport = async () => {
    const [year, month] = reportMonth.split('-');

    // Lấy hóa đơn tháng đó
    const res = await fetch(`${API}/invoices`);
    const invoices = await res.json();

    const monthInvoices = invoices.filter(inv => {
      const d = new Date(inv.created_at);
      return d.getFullYear() === +year && d.getMonth() + 1 === +month;
    });

    const customerStats = {};
    monthInvoices.forEach(inv => {
      if (!inv.customer_id) return;
      if (!customerStats[inv.customer_id]) {
        customerStats[inv.customer_id] = { name: inv.customer_name || 'Khách lẻ', phone: '', total_orders: 0, total_revenue: 0 };
      }
      customerStats[inv.customer_id].total_orders += 1;
      customerStats[inv.customer_id].total_revenue += inv.total || 0;
    });

    let csv = '\uFEFF';
    csv += `BÁO CÁO KHÁCH HÀNG THÁNG ${month}/${year}\n`;
    csv += `STT, Tên khách hàng, SĐT, Số đơn hàng, Tổng tiền (VND)\n`;

    let stt = 1;
    let totalRevenue = 0;
    const rows = Object.values(customerStats).sort((a, b) => b.total_revenue - a.total_revenue);
    rows.forEach(c => {
      csv += `${stt}, "${c.name}", "${c.phone}", ${c.total_orders}, ${Math.round(c.total_revenue)}\n`;
      totalRevenue += c.total_revenue;
      stt++;
    });

    csv += `\nTỔNG CỘNG, ${rows.length} khách, , ${rows.reduce((s, c) => s + c.total_orders, 0)}, ${Math.round(totalRevenue)}\n`;
    csv += `Ngày xuất: ${new Date().toLocaleString('vi-VN')}\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BaoCaoKhachHang_${month}_${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Users className="text-blue-600" size={24} /> Quản lý Khách hàng
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowHelp(true)} className="px-3 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg text-xs font-medium flex items-center gap-1">
            <HelpCircle size={13} /> Hướng dẫn
          </button>
          <button onClick={() => navigate('/dong-bo-san-pham?tab=customers&import=1')}
            className="px-3 py-2 border border-blue-300 text-blue-600 hover:bg-blue-50 rounded-lg text-xs font-medium flex items-center gap-1">
            <UploadCloud size={13} /> Import Excel/Sapo
          </button>
          <button onClick={() => setShowTypeManager(true)}
            className="px-3 py-2 border border-purple-300 text-purple-600 hover:bg-purple-50 rounded-lg text-xs font-medium flex items-center gap-1">
            <Tag size={13} /> Quản lý loại KH
          </button>
          <button onClick={openAdd} className="btn-primary flex items-center gap-1">
            <Plus size={16} /> Thêm khách hàng
          </button>
        </div>
      </div>

      {/* Xuất Excel */}
      <div className="card mb-4 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 p-4">
        <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <FileDown className="text-blue-600" size={16} /> Xuất báo cáo khách hàng theo tháng
        </h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Chọn tháng</label>
            <input type="month" className="input-field" value={reportMonth}
              onChange={e => setReportMonth(e.target.value)} />
          </div>
          <button onClick={exportCustomersReport} className="btn-primary flex items-center gap-1">
            <FileDown size={16} /> Xuất Excel
          </button>
        </div>
      </div>

      <input className="input-field mb-4" placeholder="🔍 Tìm khách hàng..." value={search} onChange={e => setSearch(e.target.value)} />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-gray-600">
              <th className="p-2 text-left">Tên khách hàng</th>
              <th className="p-2 text-left">SĐT</th>
              <th className="p-2 text-left">Email</th>
              <th className="p-2 text-left">MST</th>
              <th className="p-2 text-left">Loại</th>
              <th className="p-2 text-center">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className="border-b hover:bg-gray-50">
                <td className="p-2 font-medium">{c.name}</td>
                <td className="p-2">{c.phone || '—'}</td>
                <td className="p-2 text-gray-600">{c.email || '—'}</td>
                <td className="p-2 font-mono text-xs">{c.tax_code || '—'}</td>
                <td className="p-2">
                  <span className="px-2 py-0.5 rounded text-xs font-medium" style={getTypeColor(c.customer_type)}>
                    {getTypeLabel(c.customer_type)}
                  </span>
                </td>
                <td className="p-2 text-center">
                  <button onClick={() => openEdit(c)} className="text-blue-600 hover:text-blue-800 text-xs mr-2 flex items-center gap-1 inline-flex">
                    <Edit2 size={12} /> Sửa
                  </button>
                  <button onClick={() => handleDelete(c.id)} className="text-red-500 hover:text-red-700 text-xs flex items-center gap-1 inline-flex">
                    <Trash2 size={12} /> Xóa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="text-center text-gray-400 py-10 flex items-center justify-center gap-2"><Loader size={16} className="animate-spin" /> Đang tải...</div>}
        {!loading && filtered.length === 0 && <div className="text-center text-gray-400 py-10">Không có khách hàng nào</div>}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="relative z-10 bg-white rounded-xl shadow-2xl p-6 w-[500px]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Users size={20} className="text-blue-600" />
                {editing ? 'Sửa khách hàng' : 'Thêm khách hàng'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3 mb-4">
              <div><label className="text-xs text-gray-500">Tên KH</label><input ref={customerNameInputRef} className="input-field w-full" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Tên..." /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">SĐT</label><input className="input-field" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                <div><label className="text-xs text-gray-500">Email</label><input className="input-field" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">Mã số thuế</label><input className="input-field" value={form.tax_code} onChange={e => setForm({ ...form, tax_code: e.target.value })} /></div>
                <div><label className="text-xs text-gray-500">Loại KH</label>
                  <select className="input-field" value={form.customer_type || ''} onChange={e => setForm({ ...form, customer_type: e.target.value })}>
                    {customerTypes.length > 0 ? customerTypes.map(t => (
                      <option key={t.id} value={t.name}>{t.name}</option>
                    )) : (
                      <option value="Khách lẻ">Khách lẻ</option>
                    )}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSubmit} className="btn-success flex-1">💾 Lưu</button>
              <button onClick={() => setShowForm(false)} className="btn-danger flex-1">Hủy</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== QUẢN LÝ LOẠI KHÁCH HÀNG ===== */}
      {showTypeManager && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b bg-purple-50 rounded-t-xl">
              <div>
                <h2 className="text-lg font-bold text-purple-800 flex items-center gap-2">
                  <Tag size={20} /> Quản lý loại khách hàng
                </h2>
                <p className="text-xs text-purple-500">Thêm, sửa, xóa nhóm khách hàng</p>
              </div>
              <button onClick={() => setShowTypeManager(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-2">
              {customerTypes.map(t => (
                <div key={t.id} className="flex items-center gap-3 border rounded-lg p-3 hover:shadow-sm transition">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ backgroundColor: t.color || '#3b82f6' }}>
                    {t.name[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-800">{t.name}</div>
                    <div className="text-xs text-gray-400">Mã màu: <span className="font-mono">{t.color || '#3b82f6'}</span></div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => openTypeEdit(t)}
                      className="text-blue-500 hover:text-blue-700 p-1.5 rounded border border-blue-300 hover:bg-blue-50" title="Sửa">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleTypeDelete(t.id)}
                      className="text-red-400 hover:text-red-600 p-1.5 rounded border border-red-300 hover:bg-red-50" title="Xóa">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {customerTypes.length === 0 && (
                <div className="text-center text-gray-400 py-8">Chưa có loại khách hàng nào</div>
              )}
            </div>

            <div className="px-4 py-3 border-t bg-gray-50 rounded-b-xl">
              <button onClick={openTypeAdd}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-1">
                <Plus size={15} /> Thêm loại khách hàng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== FORM THÊM/SỬA LOẠI KH ===== */}
      {showTypeForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl shadow-2xl w-[400px] p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-purple-800">
                {editingType ? 'Sửa loại khách' : 'Thêm loại khách hàng'}
              </h2>
              <button onClick={() => setShowTypeForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Tên loại khách hàng <span className="text-red-500">*</span></label>
                <input ref={typeNameInputRef} className="input-field w-full" value={typeForm.name}
                  onChange={e => setTypeForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="VD: Khách gửi, Cộng tác viên, Đại lý..." />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Màu nhóm</label>
                <div className="flex items-center gap-3">
                  <div className="flex gap-2">
                    {COLOR_PRESETS.map(c => (
                      <button key={c}
                        onClick={() => setTypeForm(f => ({ ...f, color: c }))}
                        className={`w-7 h-7 rounded-full border-2 transition ${typeForm.color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                        title={c} />
                    ))}
                  </div>
                  <input type="color" className="w-8 h-8 rounded cursor-pointer border"
                    value={typeForm.color || '#3b82f6'}
                    onChange={e => setTypeForm(f => ({ ...f, color: e.target.value }))} />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <div className="w-8 h-8 rounded-full border" style={{ backgroundColor: typeForm.color || '#3b82f6' }} />
                  <span className="text-xs text-gray-500">Xem trước: <span className="font-medium px-2 py-0.5 rounded text-white text-xs" style={{ backgroundColor: typeForm.color || '#3b82f6' }}>
                    {typeForm.name || 'Tên loại'}
                  </span></span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowTypeForm(false)}
                className="flex-1 py-2 border border-gray-300 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">Hủy</button>
              <button onClick={handleTypeSubmit}
                className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-bold">💾 Lưu</button>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <HelpModal
          show={showHelp}
          title="Hướng dẫn sử dụng Quản lý Khách hàng"
          onClose={() => setShowHelp(false)}
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">👥 Tổng quan</h3>
                <p>Trang Quản lý Khách hàng giúp bạn lưu trữ thông tin khách hàng, phân loại theo nhóm, và theo dõi lịch sử mua hàng. Thông tin khách hàng sẽ xuất hiện khi tạo đơn hàng.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">➕ Thêm khách hàng mới</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Nhấn nút <strong>"Thêm khách hàng"</strong> ở góc trên phải</li>
                  <li>Điền các thông tin bắt buộc: <strong>Tên</strong></li>
                  <li>Các thông tin tùy chọn: SĐT, Email, MST</li>
                  <li>Chọn <strong>Loại khách hàng</strong> (nếu có)</li>
                  <li>Nhấn "Lưu" để hoàn tất</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">✏️ Chỉnh sửa khách hàng</h3>
                <p>Nhấn nút <strong>"Sửa"</strong> ở cột Hành động để cập nhật thông tin khách hàng. Có thể thay đổi: SĐT, Email, MST, Loại khách hàng.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🗑️ Xóa khách hàng</h3>
                <p>Nhấn nút <strong>"Xóa"</strong> ở cột Hành động để xóa khách hàng. <strong className="text-red-600">Lưu ý:</strong> Không thể xóa nếu khách hàng đã có đơn hàng.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🏷️ Quản lý loại khách hàng</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Nhấn nút <strong>"Quản lý loại KH"</strong> để mở cửa sổ quản lý</li>
                  <li><strong>Thêm loại:</strong> Nhập tên và chọn màu sắc</li>
                  <li><strong>Sửa loại:</strong> Nhấn vào tên loại để đổi tên/màu</li>
                  <li><strong>Xóa loại:</strong> Nhấn icon 🗑️ (chỉ xóa được nếu không có khách thuộc loại này)</li>
                  <li>Màu loại sẽ hiển thị khi chọn khách hàng trong đơn hàng</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🔍 Tìm kiếm</h3>
                <p>Nhập từ khóa vào ô tìm kiếm để lọc theo:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Tên khách hàng</li>
                  <li>Số điện thoại</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📤 Xuất báo cáo khách hàng</h3>
                <p>Chọn tháng và nhấn "Xuất Excel" để tải báo cáo khách hàng với thống kê số đơn hàng và tổng chi tiêu trong tháng.</p>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-800 mb-2">💡 Mẹo & Lưu ý</h3>
                <ul className="list-disc pl-5 space-y-1 text-blue-700">
                  <li><strong>Loại khách hàng:</strong> Dùng để phân nhóm (VIP, Sỉ, Lẻ...), mỗi loại có màu riêng</li>
                  <li><strong>MST:</strong> Nhập đầy đủ cho khách doanh nghiệp để xuất hóa đơn</li>
                  <li>Khách hàng sẽ hiển thị trong trang POS khi tạo đơn hàng</li>
                  <li>Có thể thêm khách hàng trực tiếp trong trang POS nếu chưa có</li>
                </ul>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}