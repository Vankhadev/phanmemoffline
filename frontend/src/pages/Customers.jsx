import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveApiUrl } from '../utils/apiClient';
import { Users, FileDown, Plus, X, Edit2, Trash2, Loader, Tag, HelpCircle, UploadCloud, History } from 'lucide-react';
import * as XLSX from 'xlsx';
import HelpModal from '../components/HelpModal';
import { customerTypesApi, customersApi, getApiErrorMessage } from '../utils/apiClient';
import { globalSyncEmitter } from '../utils/eventEmitter';

const API = resolveApiUrl('');

export default function Customers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [historyTarget, setHistoryTarget] = useState(null);

  const handleShowHistory = (id) => {
    setHistoryTarget({ id });
  };
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
  const [selectedCustomerIds, setSelectedCustomerIds] = useState([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [importing, setImporting] = useState(false);
  const customerNameInputRef = useRef(null);
  const typeNameInputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Customer types management
  const [showTypeManager, setShowTypeManager] = useState(false);
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [typeForm, setTypeForm] = useState({ name: '', color: '#3b82f6' });

  useEffect(() => { setLoading(true); Promise.all([fetchCustomers(), fetchCustomerTypes()]).finally(() => setLoading(false)); }, []);

  useEffect(() => {
    const handleSyncRefresh = () => {
      fetchCustomers();
      fetchCustomerTypes();
      console.log('[SYNC] Customers refreshed');
    };

    const unsubscribeCreated = globalSyncEmitter.on('CUSTOMER_CREATED', handleSyncRefresh);
    const unsubscribeUpdated = globalSyncEmitter.on('CUSTOMER_UPDATED', handleSyncRefresh);

    return () => {
      unsubscribeCreated();
      unsubscribeUpdated();
    };
  }, []);

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

  const getErrorMessage = (err, fallback = 'Thao tác thất bại.') => getApiErrorMessage(err?.data || err, err?.message || fallback);

  const fetchCustomers = async () => {
    try {
      const data = await customersApi.list();
      setCustomers(Array.isArray(data) ? data : []);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('Kh�ng th? t?i danh s�ch kh�ch h�ng:', err);
      alert(getErrorMessage(err, 'Kh�ng th? t?i danh s�ch kh�ch h�ng.'));
      return [];
    }
  };

  const fetchCustomerTypes = async () => {
    try {
      const data = await customerTypesApi.list();
      setCustomerTypes(Array.isArray(data) ? data : []);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('Kh�ng th? t?i lo?i kh�ch h�ng:', err);
      return [];
    }
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
    try {
      const payload = { ...form, active: editing?.active ?? 1 };
      const data = editing
        ? await customersApi.update(editing.id, { ...payload, updated_at: editing.updated_at })
        : await customersApi.create(payload);
      if (data.ok) {
        const saved = data.item || { id: data.id, ...payload };
        setCustomers(prev => {
          const next = [...prev];
          const idx = next.findIndex(item => String(item.id) === String(saved.id));
          if (idx >= 0) next[idx] = { ...next[idx], ...saved };
          else next.unshift(saved);
          return next;
        });
        setShowForm(false);
        await fetchCustomers();
        alert(editing ? '? �� c?p nh?t kh�ch h�ng!' : '? �� th�m kh�ch h�ng!');
      }
    } catch (err) {
      alert(getErrorMessage(err, editing ? 'Kh�ng th? c?p nh?t kh�ch h�ng.' : 'Kh�ng th? th�m kh�ch h�ng.'));
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Xóa khách hàng này? Dữ liệu đơn hàng liên quan sẽ được giữ nguyên.')) return;
    try {
      const data = await customersApi.remove(id);
      if (data.ok) {
        setSelectedCustomerIds(prev => prev.filter(selectedId => Number(selectedId) !== Number(id)));
        await fetchCustomers();
        alert(data.message || '✅ Đã xóa khách hàng!');
      }
    } catch (err) {
      alert(getErrorMessage(err, 'Không thể xóa khách hàng.'));
    }
  };

  // Customer types CRUD
  const openTypeAdd = () => { setEditingType(null); setTypeForm({ name: '', color: '#3b82f6' }); setShowTypeForm(true); };
  const openTypeEdit = (t) => { setEditingType(t); setTypeForm({ name: t.name, color: t.color || '#3b82f6' }); setShowTypeForm(true); };
  const handleTypeSubmit = async () => {
    if (!typeForm.name) return;
    try {
      const data = editingType
        ? await customerTypesApi.update(editingType.id, typeForm)
        : await customerTypesApi.create(typeForm);
      if (data.ok) { setShowTypeForm(false); fetchCustomerTypes(); }
    } catch (err) {
      alert(getErrorMessage(err, editingType ? 'Không thể cập nhật loại khách hàng.' : 'Không thể thêm loại khách hàng.'));
    }
  };
  const handleTypeDelete = async (id) => {
    if (!confirm('Xóa loại khách này?')) return;
    try {
      await customerTypesApi.remove(id);
      fetchCustomerTypes();
    } catch (err) {
      alert(getErrorMessage(err, 'Không thể xóa loại khách hàng.'));
    }
  };

  const COLOR_PRESETS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return customers;
    return customers.filter(c =>
      (c.name || '').toLowerCase().includes(keyword) ||
      (c.phone || '').includes(keyword) ||
      (c.email || '').toLowerCase().includes(keyword) ||
      (c.customer_code || '').toLowerCase().includes(keyword) ||
      (c.tax_code || '').toLowerCase().includes(keyword)
    );
  }, [customers, search]);

  const visibleCustomerIds = useMemo(() => filtered.map(c => c.id).filter(id => id !== undefined && id !== null), [filtered]);
  const selectedIdSet = useMemo(() => new Set(selectedCustomerIds.map(id => String(id))), [selectedCustomerIds]);
  const selectedVisibleCount = visibleCustomerIds.filter(id => selectedIdSet.has(String(id))).length;
  const allVisibleSelected = visibleCustomerIds.length > 0 && selectedVisibleCount === visibleCustomerIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  useEffect(() => {
    const validIds = new Set(customers.map(c => String(c.id)));
    setSelectedCustomerIds(prev => prev.filter(id => validIds.has(String(id))));
  }, [customers]);

  const toggleSelectCustomer = (id) => {
    if (id === undefined || id === null) return;
    setSelectedCustomerIds(prev => {
      const idText = String(id);
      return prev.some(selectedId => String(selectedId) === idText)
        ? prev.filter(selectedId => String(selectedId) !== idText)
        : [...prev, id];
    });
  };

  const toggleSelectAllVisible = () => {
    const visibleIdTexts = new Set(visibleCustomerIds.map(id => String(id)));
    setSelectedCustomerIds(prev => {
      const withoutVisible = prev.filter(id => !visibleIdTexts.has(String(id)));
      return allVisibleSelected ? withoutVisible : [...withoutVisible, ...visibleCustomerIds];
    });
  };

  const handleBulkDelete = async () => {
    if (selectedCustomerIds.length === 0 || isBulkDeleting) return;
    const selectedNames = customers
      .filter(c => selectedIdSet.has(String(c.id)))
      .slice(0, 5)
      .map(c => `• ${c.name || `#${c.id}`}`)
      .join('\n');
    const moreText = selectedCustomerIds.length > 5 ? `\n... và ${selectedCustomerIds.length - 5} khách hàng khác` : '';
    if (!confirm(`Xóa ${selectedCustomerIds.length} khách hàng đã chọn?\n\n${selectedNames}${moreText}\n\nDữ liệu đơn hàng liên quan sẽ được giữ nguyên.`)) return;

    setIsBulkDeleting(true);
    try {
      const data = await customersApi.bulkRemove(selectedCustomerIds);
      const deletedCount = Number(data.deleted_count || 0);
      const skippedCount = Number(data.invalid_count || 0) + Number(data.duplicate_count || 0) + Number(data.not_found_count || 0) + Number(data.already_deleted_count || 0);
      setSelectedCustomerIds([]);
      await fetchCustomers();
      alert(`✅ Đã xóa ${deletedCount} khách hàng.${skippedCount > 0 ? `\nĐã bỏ qua ${skippedCount} mục không cần xóa/không hợp lệ.` : ''}`);
    } catch (err) {
      alert(getErrorMessage(err, 'Không thể xóa hàng loạt khách hàng.'));
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const formatExcelDateTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('vi-VN');
  };

  const getExportTimestamp = () => {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  };

  const getExcelCellValue = (row, keys) => {
    if (!row) return '';
    for (const key of keys) {
      const value = row[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return String(value).trim();
      }
    }
    return '';
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
      const validCustomers = [];
      let skipped = 0;

      rows.forEach(row => {
        const isEmptyRow = Object.values(row).every(value => String(value ?? '').trim() === '');
        if (isEmptyRow) {
          skipped += 1;
          return;
        }

        const customer = {
          name: getExcelCellValue(row, ['Tên khách hàng', 'Tên KH', 'Họ tên', 'name']),
          phone: getExcelCellValue(row, ['Số điện thoại', 'SĐT', 'Phone', 'phone']),
          email: getExcelCellValue(row, ['Email', 'email']),
          tax_code: getExcelCellValue(row, ['Mã số thuế', 'MST', 'tax_code']),
          address: getExcelCellValue(row, ['Địa chỉ', 'address']),
          customer_type: getExcelCellValue(row, ['Nhóm/Loại', 'Loại khách hàng', 'Loại KH', 'customer_type']),
          note: getExcelCellValue(row, ['Ghi chú', 'note']),
        };

        if (!customer.name) {
          skipped += 1;
          return;
        }

        if (!customer.customer_type) customer.customer_type = defaultType();

        validCustomers.push(customer);
      });

      if (validCustomers.length === 0) {
        alert(`Không có khách hàng hợp lệ để nhập. Lỗi/bỏ qua: ${skipped}.`);
        return;
      }

      const confirmed = confirm(
        `Tìm thấy ${validCustomers.length} khách hàng hợp lệ. Lỗi/bỏ qua: ${skipped}.\nBạn có muốn nhập dữ liệu này không?`
      );
      if (!confirmed) return;

      setImporting(true);
      let success = 0;
      let failed = 0;

      for (const customer of validCustomers) {
        try {
          await customersApi.create(customer);
          success += 1;
        } catch (err) {
          console.error('Lỗi nhập khách hàng:', err);
          failed += 1;
        }
      }

      await fetchCustomers();
      alert(`Nhập Excel hoàn tất!\n- Thành công: ${success}\n- Lỗi/bỏ qua: ${skipped + failed}`);
    } catch (err) {
      console.error('Lỗi đọc file Excel:', err);
      alert('Không thể đọc file Excel: ' + (err?.message || err));
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

  const exportCustomersList = () => {
    if (filtered.length === 0) {
      alert('Không có khách hàng để xuất Excel.');
      return;
    }

    const rows = filtered.map((customer, index) => ({
      'STT': index + 1,
      'Mã khách hàng': customer.customer_code || customer.id || '',
      'Tên khách hàng': customer.name || '',
      'Số điện thoại': customer.phone || '',
      'Email': customer.email || '',
      'Mã số thuế': customer.tax_code || '',
      'Địa chỉ': customer.address || '',
      'Nhóm/Loại': getTypeLabel(customer.customer_type),
      'Ghi chú': customer.note || '',
      'Ngày tạo': formatExcelDateTime(customer.created_at),
      'Ngày cập nhật': formatExcelDateTime(customer.updated_at),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 6 },
      { wch: 18 },
      { wch: 28 },
      { wch: 16 },
      { wch: 28 },
      { wch: 16 },
      { wch: 36 },
      { wch: 16 },
      { wch: 34 },
      { wch: 22 },
      { wch: 22 },
    ];
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: Math.max(rows.length, 1), c: 10 },
      }),
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Khách hàng');
    XLSX.writeFile(wb, `danh_sach_khach_hang_${getExportTimestamp()}.xlsx`);
  };

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
    <div className="min-w-0">
      <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Users className="text-blue-600" size={24} /> Quản lý Khách hàng
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleImportExcel}
            className="absolute left-[-9999px] h-px w-px opacity-0"
            tabIndex={-1}
          />
          <button type="button" onClick={openImportFilePicker}
            disabled={importing}
            className="px-3 py-2 border border-blue-300 text-blue-600 hover:bg-blue-50 rounded-lg text-xs font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
            <UploadCloud size={13} /> {importing ? 'Đang nhập...' : 'Nhập Excel'}
          </button>
          <button type="button" onClick={exportCustomersList}
            className="px-3 py-2 border border-yellow-300 text-yellow-600 hover:bg-yellow-50 rounded-lg text-xs font-medium flex items-center gap-1">
            <FileDown size={13} /> Xuất Excel
          </button>
          <button type="button" onClick={() => setShowTypeManager(true)}
            className="px-3 py-2 border border-purple-300 text-purple-600 hover:bg-purple-50 rounded-lg text-xs font-medium flex items-center gap-1">
            <Tag size={13} /> Quản lý loại KH
          </button>
          <button type="button" onClick={openAdd} className="btn-primary flex items-center gap-1">
            <Plus size={16} /> Thêm khách hàng
          </button>
        </div>
      </div>

      {/* Xuất Excel */}
      <div className="card mb-4 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 p-4">
        <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <FileDown className="text-blue-600" size={16} /> Xuất báo cáo khách hàng theo tháng
        </h3>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="sm:w-auto">
            <label className="text-xs text-gray-500 block mb-1">Chọn tháng</label>
            <input type="month" className="input-field w-full" value={reportMonth}
              onChange={e => setReportMonth(e.target.value)} />
          </div>
          <button onClick={exportCustomersReport} className="btn-primary flex items-center gap-1">
            <FileDown size={16} /> Xuất Excel
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <input className="input-field md:flex-1" placeholder=" Tìm khách hàng theo tên, SĐT, email, mã KH, MST..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          {selectedCustomerIds.length > 0 && (
            <button onClick={handleBulkDelete} disabled={isBulkDeleting} className="px-4 py-2 border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg text-sm font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
              {isBulkDeleting ? <Loader size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Xóa đã chọn ({selectedCustomerIds.length})
            </button>
          )}
        </div>
      </div>

      {selectedCustomerIds.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>Đã chọn <strong>{selectedCustomerIds.length}</strong> khách hàng. Checkbox chọn tất cả áp dụng cho <strong>{filtered.length}</strong> khách hàng đang hiển thị.</span>
          <button type="button" onClick={() => setSelectedCustomerIds([])} className="text-xs font-medium text-amber-700 underline hover:text-amber-900 self-start sm:self-auto">Bỏ chọn tất cả</button>
        </div>
      )}

      <div className="md:hidden space-y-3">
        {loading && <div className="text-center text-gray-400 py-10 flex items-center justify-center gap-2"><Loader size={16} className="animate-spin" /> Đang tải...</div>}
        {!loading && filtered.length === 0 && <div className="rounded-xl border-2 border-dashed bg-white p-8 text-center text-gray-400">Không có khách hàng nào</div>}
        {!loading && filtered.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-gray-600">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                checked={allVisibleSelected}
                ref={el => { if (el) el.indeterminate = someVisibleSelected; }}
                onChange={toggleSelectAllVisible}
                disabled={visibleCustomerIds.length === 0 || isBulkDeleting}
              />
              Chọn tất cả khách hàng đang hiển thị ({filtered.length})
            </label>
          </div>
        )}
        {!loading && filtered.map(c => {
          const isSelected = selectedIdSet.has(String(c.id));
          return (
            <div key={c.id} className={`rounded-2xl border border-gray-200 bg-white p-3 shadow-sm ${isSelected ? 'ring-2 ring-blue-100 bg-blue-50/40' : ''}`}>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-gray-300 cursor-pointer shrink-0"
                  checked={isSelected}
                  onChange={() => toggleSelectCustomer(c.id)}
                  disabled={isBulkDeleting}
                  aria-label={`Chọn khách hàng ${c.name || c.id}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-900">{c.name}</div>
                  {c.customer_code && <div className="text-[11px] text-gray-400">Mã: {c.customer_code}</div>}
                  <div className="mt-2 grid grid-cols-1 gap-1 text-sm text-gray-600">
                    <div><span className="text-gray-400">SĐT:</span> {c.phone || '—'}</div>
                    <div><span className="text-gray-400">Email:</span> {c.email || '—'}</div>
                    <div><span className="text-gray-400">MST:</span> <span className="font-mono text-xs">{c.tax_code || '—'}</span></div>
                  </div>
                  <div className="mt-2">
                    <span className="px-2 py-0.5 rounded text-xs font-medium" style={getTypeColor(c.customer_type)}>
                      {getTypeLabel(c.customer_type)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3">
                <button onClick={() => handleShowHistory(c.id)} disabled={isBulkDeleting} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 disabled:opacity-50">
                  <History size={12} /> Lịch sử
                </button>
                <button onClick={() => openEdit(c)} disabled={isBulkDeleting} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 disabled:opacity-50">
                  <Edit2 size={12} /> Sửa
                </button>
                <button onClick={() => handleDelete(c.id)} disabled={isBulkDeleting} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-600 disabled:opacity-50">
                  <Trash2 size={12} /> Xóa
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="bg-gray-100 text-gray-600">
              <th className="p-2 text-center w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                  checked={allVisibleSelected}
                  ref={el => { if (el) el.indeterminate = someVisibleSelected; }}
                  onChange={toggleSelectAllVisible}
                  disabled={visibleCustomerIds.length === 0 || isBulkDeleting}
                  title={allVisibleSelected ? 'Bỏ chọn tất cả khách hàng đang hiển thị' : 'Chọn tất cả khách hàng đang hiển thị'}
                />
              </th>
              <th className="p-2 text-left">Tên khách hàng</th>
              <th className="p-2 text-left">SĐT</th>
              <th className="p-2 text-left">Email</th>
              <th className="p-2 text-left">MST</th>
              <th className="p-2 text-left">Loại</th>
              <th className="p-2 text-center">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => {
              const isSelected = selectedIdSet.has(String(c.id));
              return (
                <tr key={c.id} className={`border-b hover:bg-gray-50 ${isSelected ? 'bg-blue-50/70' : ''}`}>
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 cursor-pointer"
                      checked={isSelected}
                      onChange={() => toggleSelectCustomer(c.id)}
                      disabled={isBulkDeleting}
                      aria-label={`Chọn khách hàng ${c.name || c.id}`}
                    />
                  </td>
                  <td className="p-2 font-medium">
                    <div>{c.name}</div>
                    {c.customer_code && <div className="text-[11px] text-gray-400 font-normal">Mã: {c.customer_code}</div>}
                  </td>
                  <td className="p-2">{c.phone || '—'}</td>
                  <td className="p-2 text-gray-600">{c.email || '—'}</td>
                  <td className="p-2 font-mono text-xs">{c.tax_code || '—'}</td>
                  <td className="p-2">
                    <span className="px-2 py-0.5 rounded text-xs font-medium" style={getTypeColor(c.customer_type)}>
                      {getTypeLabel(c.customer_type)}
                    </span>
                  </td>
                  <td className="p-2 text-center">
                    <button onClick={() => handleShowHistory(c.id)} disabled={isBulkDeleting} className="text-gray-600 hover:text-gray-800 text-xs mr-2 flex items-center gap-1 inline-flex disabled:opacity-50">
                      <History size={12} /> Lịch sử
                    </button>
                    <button onClick={() => openEdit(c)} disabled={isBulkDeleting} className="text-blue-600 hover:text-blue-800 text-xs mr-2 flex items-center gap-1 inline-flex disabled:opacity-50">
                      <Edit2 size={12} /> Sửa
                    </button>
                    <button onClick={() => handleDelete(c.id)} disabled={isBulkDeleting} className="text-red-500 hover:text-red-700 text-xs flex items-center gap-1 inline-flex disabled:opacity-50">
                      <Trash2 size={12} /> Xóa
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && <div className="text-center text-gray-400 py-10 flex items-center justify-center gap-2"><Loader size={16} className="animate-spin" /> Đang tải...</div>}
        {!loading && filtered.length === 0 && <div className="text-center text-gray-400 py-10">Không có khách hàng nào</div>}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-start sm:items-center justify-center z-50 overflow-y-auto p-3 sm:p-4">
          <div className="relative z-10 bg-white rounded-xl shadow-2xl p-4 sm:p-6 w-full max-w-lg max-h-[90dvh] overflow-auto">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-500">SĐT</label><input className="input-field" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                <div><label className="text-xs text-gray-500">Email</label><input className="input-field" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={handleSubmit} className="btn-success flex-1">💾 Lưu</button>
              <button onClick={() => setShowForm(false)} className="btn-danger flex-1">Hủy</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== QUẢN LÝ LOẠI KHÁCH HÀNG ===== */}
      {showTypeManager && (
        <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 overflow-y-auto p-3 sm:p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90dvh] flex flex-col">
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
        <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-[60] overflow-y-auto p-3 sm:p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-4 sm:p-6 max-h-[90dvh] overflow-auto">
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
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex flex-wrap gap-2">
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
            <div className="flex flex-col sm:flex-row gap-2 mt-5">
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

      {historyTarget && (
        <ChangeHistoryModal
          isOpen={Boolean(historyTarget)}
          onClose={() => setHistoryTarget(null)}
          tableName="customers"
          recordId={historyTarget.id}
          onRestoreSuccess={fetchCustomers}
        />
      )}
    </div>
  );
}