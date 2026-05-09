import { useState, useEffect, useRef } from 'react';
import { API } from '../App';
import { Plus, Edit2, Trash2, Search, Loader, FileDown, Upload, X, HelpCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import HelpModal from '../components/HelpModal';

export default function NhaCungCap() {
  const [suppliers, setSuppliers] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);
  const nameInputRef = useRef(null);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    tax_code: '',
    email: '',
    address: '',
    invoice_type: 'non_electronic',
  });

  useEffect(() => {
    fetchSuppliers();
  }, []);

  useEffect(() => {
    if (!showForm) return undefined;

    const timer = window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [showForm]);

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/partners`);
      const data = await res.json();
      setSuppliers(data);
    } catch (err) {
      console.error('Lỗi tải nhà cung cấp:', err);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm({
      name: '',
      phone: '',
      tax_code: '',
      email: '',
      address: '',
      invoice_type: 'non_electronic',
    });
    setShowForm(true);
  };

  const openEdit = (supplier) => {
    setEditing(supplier);
    setForm({
      name: supplier.name,
      phone: supplier.phone || '',
      tax_code: supplier.tax_code || '',
      email: supplier.email || '',
      address: supplier.address || '',
      invoice_type: supplier.invoice_type || 'non_electronic',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!form.name.trim()) {
      alert('Vui lòng nhập tên nhà cung cấp!');
      return;
    }
    setSaving(true);
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing ? `${API}/partners/${editing.id}` : `${API}/partners`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.ok) {
        alert(editing ? '✅ Đã cập nhật nhà cung cấp!' : '✅ Đã thêm nhà cung cấp thành công!');
        setShowForm(false);
        fetchSuppliers();
      } else {
        alert('Lỗi: ' + (data.error || 'Không rõ lỗi'));
      }
    } catch (err) {
      alert('Lỗi kết nối: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Xóa nhà cung cấp này?')) return;
    try {
      const res = await fetch(`${API}/partners/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        alert('✅ Đã xóa nhà cung cấp!');
        fetchSuppliers();
      } else {
        alert('Xóa thất bại: ' + (data.error || 'Không rõ lỗi'));
      }
    } catch (err) {
      alert('Lỗi kết nối: ' + err.message);
    }
  };

  const normalizeText = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

  const getCellValue = (row, aliases) => {
    const aliasSet = new Set(aliases.map(normalizeText));
    const found = Object.entries(row).find(([header]) => aliasSet.has(normalizeText(header)));
    return found ? String(found[1] ?? '').trim() : '';
  };

  const normalizeInvoiceType = (value) => {
    const normalized = normalizeText(value);
    if (!normalized || normalized.includes('khong') || normalized.includes('non')) {
      return 'non_electronic';
    }

    const electronicValues = [
      'co hoa don dien tu',
      'co hddt',
      'co hd dt',
      'hoa don dien tu',
      'hddt',
      'electronic',
      'electronic invoice',
      'e invoice',
    ];

    return electronicValues.includes(normalized) ? 'electronic' : 'non_electronic';
  };

  const handleImportExcel = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        alert('File Excel không có sheet dữ liệu.');
        return;
      }

      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: '', raw: false });
      const validSuppliers = [];
      let skipped = 0;

      rows.forEach(row => {
        const isEmptyRow = Object.values(row).every(value => String(value ?? '').trim() === '');
        if (isEmptyRow) {
          skipped += 1;
          return;
        }

        const supplier = {
          name: getCellValue(row, ['Tên NCC', 'Tên nhà cung cấp', 'name']),
          phone: getCellValue(row, ['Số điện thoại', 'SĐT', 'phone']),
          tax_code: getCellValue(row, ['Mã số thuế', 'MST', 'tax_code']),
          email: getCellValue(row, ['Email', 'email']),
          address: getCellValue(row, ['Địa chỉ', 'address']),
          invoice_type: normalizeInvoiceType(getCellValue(row, ['Loại hóa đơn', 'invoice_type'])),
        };

        if (!supplier.name) {
          skipped += 1;
          return;
        }

        validSuppliers.push(supplier);
      });

      if (validSuppliers.length === 0) {
        alert(`Không có nhà cung cấp hợp lệ để nhập. Lỗi/bỏ qua: ${skipped}.`);
        return;
      }

      const confirmed = confirm(
        `Tìm thấy ${validSuppliers.length} nhà cung cấp hợp lệ. Lỗi/bỏ qua: ${skipped}.\nBạn có muốn nhập dữ liệu này không?`
      );
      if (!confirmed) return;

      setImporting(true);
      let success = 0;
      let failed = 0;

      for (const supplier of validSuppliers) {
        try {
          const res = await fetch(`${API}/partners`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(supplier),
          });
          const data = await res.json();
          if (res.ok && data.ok) {
            success += 1;
          } else {
            failed += 1;
          }
        } catch (err) {
          console.error('Lỗi nhập nhà cung cấp:', err);
          failed += 1;
        }
      }

      await fetchSuppliers();
      alert(`Nhập Excel hoàn tất!\n- Thành công: ${success}\n- Lỗi/bỏ qua: ${skipped + failed}`);
    } catch (err) {
      console.error('Lỗi đọc file Excel:', err);
      alert('Không thể đọc file Excel: ' + err.message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openImportFilePicker = () => {
    if (importing || !fileInputRef.current) return;
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  const exportExcel = () => {
    if (filtered.length === 0) {
      alert('Không có nhà cung cấp để xuất Excel.');
      return;
    }

    const data = filtered.map(p => ({
      'Tên NCC': p.name,
      'Số điện thoại': p.phone || '',
      'Mã số thuế': p.tax_code || '',
      'Email': p.email || '',
      'Địa chỉ': p.address || '',
      'Loại hóa đơn': p.invoice_type === 'electronic' ? 'Có hóa đơn điện tử' : 'Không hóa đơn điện tử',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 28 },
      { wch: 16 },
      { wch: 16 },
      { wch: 28 },
      { wch: 36 },
      { wch: 22 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Nhà cung cấp');
    XLSX.writeFile(wb, `nha_cung_cap_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const filtered = suppliers.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.phone || '').includes(search) ||
    (p.tax_code || '').includes(search)
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <span className="text-orange-500">🏭</span>
          <span>Quản lý Nhà cung cấp</span>
          <button
            onClick={() => setShowHelp(true)}
            className="ml-2 px-2 py-0.5 border border-gray-300 text-gray-500 hover:bg-gray-50 rounded text-xs font-medium flex items-center gap-1"
          >
            <HelpCircle size={12} /> Hướng dẫn
          </button>
        </h1>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleImportExcel}
            className="absolute left-[-9999px] h-px w-px opacity-0"
            tabIndex={-1}
          />
          <button
            onClick={openImportFilePicker}
            disabled={importing}
            className="px-4 py-2 border border-blue-300 text-blue-600 hover:bg-blue-50 rounded-lg text-sm font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload size={16} /> {importing ? 'Đang nhập...' : 'Nhập Excel'}
          </button>
          <button onClick={exportExcel} className="px-4 py-2 border border-orange-300 text-orange-600 hover:bg-orange-50 rounded-lg text-sm font-medium flex items-center gap-1.5">
            <FileDown size={16} /> Xuất Excel
          </button>
          <button onClick={openAdd} className="btn-primary flex items-center gap-1">
            <Plus size={16} /> Thêm nhà cung cấp
          </button>
        </div>
      </div>

      <input
        className="input-field mb-4"
        placeholder="🔍 Tìm nhà cung cấp theo tên, SĐT hoặc MST..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-orange-50 text-orange-700 text-xs">
              <th className="p-2 text-left w-48">Tên NCC</th>
              <th className="p-2 text-left w-32">SĐT</th>
              <th className="p-2 text-left w-32">MST</th>
              <th className="p-2 text-left w-40">Email</th>
              <th className="p-2 text-left w-24">Loại HĐ</th>
              <th className="p-2 text-left w-64">Địa chỉ</th>
              <th className="p-2 text-center w-24">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-10 flex items-center justify-center gap-2">
                  <Loader size={16} className="animate-spin" /> Đang tải...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-10">
                  {search ? 'Không tìm thấy nhà cung cấp' : 'Chưa có nhà cung cấp nào'}
                </td>
              </tr>
            )}
            {!loading && filtered.map(p => (
              <tr key={p.id} className="border-b hover:bg-orange-50">
                <td className="p-2 font-medium">{p.name}</td>
                <td className="p-2">{p.phone || '—'}</td>
                <td className="p-2 font-mono text-xs">{p.tax_code || '—'}</td>
                <td className="p-2 text-gray-600 text-xs">{p.email || '—'}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.invoice_type === 'electronic' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                    {p.invoice_type === 'electronic' ? 'Có HĐĐT' : 'Không HĐĐT'}
                  </span>
                </td>
                <td className="p-2 text-gray-500 text-xs">{p.address || '—'}</td>
                <td className="p-2 text-center">
                  <button onClick={() => openEdit(p)} className="text-blue-600 hover:text-blue-800 text-xs mr-2 flex items-center gap-1 inline-flex">
                    <Edit2 size={12} /> Sửa
                  </button>
                  <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:text-red-700 text-xs flex items-center gap-1 inline-flex">
                    <Trash2 size={12} /> Xóa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="relative z-10 bg-white rounded-xl shadow-2xl p-6 w-[520px]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2 text-orange-700">
                🏭 {editing ? 'Sửa Nhà cung cấp' : 'Thêm Nhà cung cấp mới'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Tên NCC <span className="text-red-500">*</span></label>
                <input
                  ref={nameInputRef}
                  className="input-field w-full"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="VD: Công ty TNHH ABC"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Số điện thoại</label>
                  <input
                    className="input-field w-full"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="0909 123 456"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Mã số thuế</label>
                  <input
                    className="input-field w-full"
                    value={form.tax_code}
                    onChange={e => setForm({ ...form, tax_code: e.target.value })}
                    placeholder="MST nếu có"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Email</label>
                  <input
                    className="input-field w-full"
                    type="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="ncc@abc.com"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Địa chỉ</label>
                <textarea
                  className="input-field w-full"
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                  placeholder="Địa chỉ đầy đủ..."
                  rows={2}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Loại hóa đơn</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="invoice_type"
                      value="non_electronic"
                      checked={form.invoice_type === 'non_electronic'}
                      onChange={() => setForm({ ...form, invoice_type: 'non_electronic' })}
                      className="accent-blue-600"
                    />
                    <span className="text-sm">Không hóa đơn điện tử</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="invoice_type"
                      value="electronic"
                      checked={form.invoice_type === 'electronic'}
                      onChange={() => setForm({ ...form, invoice_type: 'electronic' })}
                      className="accent-red-600"
                    />
                    <span className="text-sm">Có hóa đơn điện tử</span>
                  </label>
                </div>
              </div>
            </form>
            <div className="flex gap-2 mt-4">
              <button onClick={handleSubmit} disabled={saving} className="btn-success flex-1 disabled:opacity-50">
                💾 {saving ? 'Đang lưu...' : 'Lưu'}
              </button>
              <button onClick={() => setShowForm(false)} className="btn-danger flex-1">Hủy</button>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <HelpModal
          title="Hướng dẫn sử dụng Quản lý Nhà cung cấp"
          onClose={() => setShowHelp(false)}
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">🏭 Tổng quan</h3>
                <p>Trang Nhà cung cấp giúp bạn quản lý thông tin các đối tác cung cấp hàng hóa. Mỗi nhà cung cấp có thể được liên kết với sản phẩm để lưu thông tin giá nhập và loại hóa đơn.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">➕ Thêm nhà cung cấp mới</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Nhấn nút <strong>"Thêm nhà cung cấp"</strong> ở góc trên phải</li>
                  <li>Điền các thông tin bắt buộc: <strong>Tên NCC</strong></li>
                  <li>Các thông tin tùy chọn: SĐT, MST, Email, Địa chỉ</li>
                  <li>Chọn <strong>Loại hóa đơn</strong>: Có HĐĐT hoặc Không HĐĐT</li>
                  <li>Nhấn "Lưu" để hoàn tất</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">✏️ Chỉnh sửa nhà cung cấp</h3>
                <p>Nhấn nút <strong>"Sửa"</strong> ở cột Hành động để cập nhật thông tin nhà cung cấp. Các thông tin có thể thay đổi: SĐT, MST, Email, Địa chỉ, Loại hóa đơn.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🗑️ Xóa nhà cung cấp</h3>
                <p>Nhấn nút <strong>"Xóa"</strong> ở cột Hành động để xóa nhà cung cấp. <strong className="text-red-600">Lưu ý:</strong> Không thể xóa nếu nhà cung cấp đang được sử dụng trong sản phẩm.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🔍 Tìm kiếm</h3>
                <p>Nhập từ khóa vào ô tìm kiếm để lọc danh sách theo:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Tên nhà cung cấp</li>
                  <li>Số điện thoại</li>
                  <li>Mã số thuế (MST)</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📥 Nhập Excel</h3>
                <p>Nhấn nút <strong>"Nhập Excel"</strong>, chọn file .xlsx hoặc .xls, kiểm tra thông báo xác nhận rồi đồng ý để nhập từng nhà cung cấp vào hệ thống.</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Cột bắt buộc: <strong>Tên NCC</strong> hoặc <strong>Tên nhà cung cấp</strong> hoặc <strong>name</strong></li>
                  <li>Cột tùy chọn: <strong>Số điện thoại/SĐT/phone</strong>, <strong>Mã số thuế/MST/tax_code</strong>, <strong>Email/email</strong>, <strong>Địa chỉ/address</strong>, <strong>Loại hóa đơn/invoice_type</strong></li>
                  <li>Dòng trống hoặc dòng thiếu tên nhà cung cấp sẽ được bỏ qua và tính vào số lỗi/bỏ qua</li>
                  <li>Loại hóa đơn nhận các giá trị như "Có hóa đơn điện tử", "Có HĐĐT", "electronic"; giá trị khác sẽ mặc định là không hóa đơn điện tử</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📤 Xuất Excel</h3>
                <p>Nhấn nút <strong>"Xuất Excel"</strong> để tải danh sách nhà cung cấp đang hiển thị theo bộ lọc tìm kiếm ra file .xlsx. File chứa các cột: Tên NCC, Số điện thoại, Mã số thuế, Email, Địa chỉ, Loại hóa đơn.</p>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-800 mb-2">💡 Mẹo & Lưu ý</h3>
                <ul className="list-disc pl-5 space-y-1 text-blue-700">
                  <li><strong>Loại hóa đơn:</strong> Chọn "Có hóa đơn điện tử" nếu nhà cung cấp cung cấp hóa đơn GTGT, chọn "Không hóa đơn điện tử" cho hóa đơn thường</li>
                  <li><strong>MST:</strong> Nhập đầy đủ 10-13 số để dễ tra cứu và xuất hóa đơn</li>
                  <li>Thông tin nhà cung cấp sẽ hiển thị trong trang Sản phẩm khi chọn nhà cung cấp cho sản phẩm mới</li>
                  <li>Giá nhập sản phẩm có thể khác nhau tùy theo nhà cung cấp - nên thêm nhiều nhà cung cấp để có nhiều lựa chọn</li>
                </ul>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
