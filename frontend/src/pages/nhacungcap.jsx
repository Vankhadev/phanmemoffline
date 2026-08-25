import { useState, useEffect, useRef } from 'react';
import { apiJson, apiJsonChecked, resolveApiUrl } from '../utils/apiClient';
import { globalSyncEmitter } from '../utils/eventEmitter';
import { Plus, Edit2, Trash2, Search, Loader, FileDown, Upload, X, HelpCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import HelpModal from '../components/HelpModal';

const hasPaymentValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';

const getFirstPaymentValue = (...values) => values.find(hasPaymentValue);

const toPaymentNumber = (value, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : fallback;
};

const normalizePaymentStatus = (status) => {
  const value = String(status || '').trim().toLowerCase();
  if (['paid', 'da_thanh_toan', 'đã thanh toán', 'da thanh toan'].includes(value)) return 'paid';
  if (['unpaid', 'chưa_thanh_toan', 'chưa thanh toán', 'chưa thanh toan'].includes(value)) return 'unpaid';
  return '';
};

const getSupplierIdKey = (value) => (hasPaymentValue(value) ? String(value).trim() : '');

const formatPaymentMoney = (value) => `${toPaymentNumber(value, 0).toLocaleString('vi-VN')}d`;

const getImportPaymentAmounts = (imp = {}) => {
  const total = toPaymentNumber(imp.total, 0);
  const status = normalizePaymentStatus(imp.payment_status) || 'unpaid';
  const paid = status === 'paid' ? total : Math.min(total, toPaymentNumber(imp.paid_amount, 0));
  const remaining = status === 'paid'
    ? 0
    : (hasPaymentValue(imp.remaining_amount)
      ? Math.min(total, toPaymentNumber(imp.remaining_amount, Math.max(0, total - paid)))
      : Math.max(0, total - paid));

  return { total, paid_amount: paid, remaining_amount: remaining };
};

const getDirectSupplierPaymentSummary = (supplier = {}) => {
  const status = normalizePaymentStatus(supplier.payment_status);
  const totalValue = getFirstPaymentValue(supplier.total, supplier.total_amount, supplier.import_total, supplier.total_import);
  const paidValue = getFirstPaymentValue(supplier.total_paid, supplier.paid_amount, supplier.paid);
  const remainingValue = getFirstPaymentValue(supplier.total_remaining, supplier.remaining_amount, supplier.remaining, supplier.debt, supplier.balance);
  const hasData = Boolean(status) || hasPaymentValue(totalValue) || hasPaymentValue(paidValue) || hasPaymentValue(remainingValue);
  if (!hasData) return null;

  const total = toPaymentNumber(totalValue, 0);
  let paid = toPaymentNumber(paidValue, status === 'paid' && total > 0 ? total : 0);
  let remaining = hasPaymentValue(remainingValue)
    ? toPaymentNumber(remainingValue, 0)
    : (total > 0 ? Math.max(0, total - paid) : 0);

  if (status === 'paid') {
    remaining = 0;
    if (total > 0) paid = total;
  }

  const paymentStatus = status || (remaining > 0 ? 'unpaid' : 'paid');

  return {
    source: 'supplier',
    payment_status: paymentStatus,
    total_amount: total,
    paid_amount: paid,
    remaining_amount: remaining,
    import_count: null,
  };
};

export default function NhaCungCap() {
  const [suppliers, setSuppliers] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [importing, setImporting] = useState(false);
  const [paymentBySupplier, setPaymentBySupplier] = useState({});
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentLoaded, setPaymentLoaded] = useState(false);
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
    fetchSupplierPaymentSummaries();
  }, []);

  useEffect(() => {
    const handleSyncRefresh = () => {
      fetchSuppliers();
      fetchSupplierPaymentSummaries();
      console.log('[SYNC] Partners refreshed');
    };

    const unsubscribeCreated = globalSyncEmitter.on('PARTNER_CREATED', handleSyncRefresh);
    const unsubscribeUpdated = globalSyncEmitter.on('PARTNER_UPDATED', handleSyncRefresh);
    const unsubscribeDeleted = globalSyncEmitter.on('PARTNER_DELETED', handleSyncRefresh);
    const unsubscribeImported = globalSyncEmitter.on('PRODUCT_IMPORTED', handleSyncRefresh);
    // Backward-compatible aliases (some flows still emit CUSTOMER_* for partners).
    const unsubscribeLegacyCreated = globalSyncEmitter.on('CUSTOMER_CREATED', handleSyncRefresh);
    const unsubscribeLegacyUpdated = globalSyncEmitter.on('CUSTOMER_UPDATED', handleSyncRefresh);

    return () => {
      unsubscribeCreated();
      unsubscribeUpdated();
      unsubscribeDeleted();
      unsubscribeImported();
      unsubscribeLegacyCreated();
      unsubscribeLegacyUpdated();
    };
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
      const data = await apiJson('/partners', {}, 'Không thử lại danh sách nhà cung cấp.');
      setSuppliers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Lỗi tđi nhà cung cấp:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSupplierPaymentSummaries = async () => {
    setPaymentLoading(true);
    try {
      const data = await apiJson('/imports', {}, 'Không thử lại lịch sử nhập hàng d? tổng hợp thanh toán');
      const summaries = {};

      (Array.isArray(data) ? data : []).forEach(imp => {
        const importStatus = String(imp.status || '').trim().toLowerCase();
        if (imp.deleted === true || ['cancelled', 'canceled', 'da_huy'].includes(importStatus)) return;

        const partnerKey = getSupplierIdKey(getFirstPaymentValue(imp.partner_id, imp.partnerId, imp.supplier_id));
        if (!partnerKey) return;

        const amounts = getImportPaymentAmounts(imp);
        if (!summaries[partnerKey]) {
          summaries[partnerKey] = {
            source: 'imports',
            payment_status: 'unpaid',
            total_amount: 0,
            paid_amount: 0,
            remaining_amount: 0,
            import_count: 0,
          };
        }

        summaries[partnerKey].total_amount += amounts.total;
        summaries[partnerKey].paid_amount += amounts.paid_amount;
        summaries[partnerKey].remaining_amount += amounts.remaining_amount;
        summaries[partnerKey].import_count += 1;
      });

      Object.values(summaries).forEach(summary => {
        summary.payment_status = summary.remaining_amount > 0 ? 'unpaid' : 'paid';
      });

      setPaymentBySupplier(summaries);
      setPaymentLoaded(true);
    } catch (err) {
      console.error('Lỗi tđi tổng hợp thanh toán nhà cung cấp:', err);
      setPaymentBySupplier({});
      setPaymentLoaded(false);
    } finally {
      setPaymentLoading(false);
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
      alert('Vui lượng nhập tđơn nhà cung cấp!');
      return;
    }
    setSaving(true);
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing ? resolveApiUrl(`/partners/${editing.id}`) : resolveApiUrl('/partners');
      await apiJsonChecked(url, {
        method,
        body: form,
      }, editing ? 'Không th? cập nhật nhà cung cấp.' : 'Không th? thêm nhà cung cấp.');
      alert(editing ? '? ?? cập nhật nhà cung cấp!' : '? ?? thêm nhà cung cấp thành công!');
      setShowForm(false);
      fetchSuppliers();
    } catch (err) {
      alert('Lỗi kết nối: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Xóa nhà cung cấp n?y?')) return;
    try {
      await apiJsonChecked(resolveApiUrl(`/partners/${id}`), { method: 'DELETE' }, 'Không th? xóa nhà cung cấp.');
      alert('? ?? xóa nhà cung cấp!');
      fetchSuppliers();
    } catch (err) {
      alert('Lỗi kết nối: ' + err.message);
    }
  };

  const normalizeText = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/d/g, 'd')
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
          name: getCellValue(row, ['Tồn NCC', 'Tồn nhà cung cấp', 'name']),
          phone: getCellValue(row, ['S? điện thoại', 'S?T', 'phone']),
          tax_code: getCellValue(row, ['M? s? thuế', 'MST', 'tax_code']),
          email: getCellValue(row, ['Email', 'email']),
          address: getCellValue(row, ['?đã ch?', 'address']),
          invoice_type: normalizeInvoiceType(getCellValue(row, ['Loại hóa đơn', 'invoice_type'])),
        };

        if (!supplier.name) {
          skipped += 1;
          return;
        }

        validSuppliers.push(supplier);
      });

      if (validSuppliers.length === 0) {
        alert(`Không có nhà cung cấp hợp lệ đã nhập. Lỗi/b? qua: ${skipped}.`);
        return;
      }

      const confirmed = confirm(
        `Tạm th?y ${validSuppliers.length} nhà cung cấp hợp lệ. Lỗi/b? qua: ${skipped}.\nBđơn c? muđơn nh?p dữ liệu n?y không?`
      );
      if (!confirmed) return;

      setImporting(true);
      let success = 0;
      let failed = 0;

      for (const supplier of validSuppliers) {
        try {
          await apiJsonChecked('/partners', {
            method: 'POST',
            body: supplier,
          }, 'Không th? nh?p nhà cung cấp t? Excel.');
          success += 1;
        } catch (err) {
          console.error('Lỗi nh?p nhà cung cấp:', err);
          failed += 1;
        }
      }

      await fetchSuppliers();
      alert(`Nhập Excel hođơn tốt!\n- Thành công: ${success}\n- Lỗi/b? qua: ${skipped + failed}`);
    } catch (err) {
      console.error('Lỗi d?c file Excel:', err);
      alert('Không th? d?c file Excel: ' + err.message);
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
      alert('Không có nhà cung cấp d? xu?t Excel.');
      return;
    }

    const data = filtered.map(p => ({
      'Tồn NCC': p.name,
      'S? điện thoại': p.phone || '',
      'M? s? thuế': p.tax_code || '',
      'Email': p.email || '',
      '?đã ch?': p.address || '',
      'Loại hóa đơn': p.invoice_type === 'electronic' ? 'C? hóa đơn diđơn t?' : 'Không hóa đơn diđơn t?',
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

  const getSupplierPaymentSummary = (supplier) => {
    const partnerKey = getSupplierIdKey(supplier?.id);
    if (partnerKey && paymentBySupplier[partnerKey]) return paymentBySupplier[partnerKey];

    const directSummary = getDirectSupplierPaymentSummary(supplier);
    if (directSummary) return directSummary;

    if (paymentLoading) {
      return { payment_status: 'loading', label: 'đang tđi...', total_amount: 0, paid_amount: 0, remaining_amount: 0, import_count: null };
    }

    if (paymentLoaded) {
      return { payment_status: 'none', label: 'Chua c? phiếu', total_amount: 0, paid_amount: 0, remaining_amount: 0, import_count: 0 };
    }

    return { payment_status: 'unknown', label: 'Chua c? dữ liệu', total_amount: 0, paid_amount: 0, remaining_amount: 0, import_count: null };
  };

  const getSupplierPaymentLabel = (summary) => {
    if (summary.label) return summary.label;
    return summary.payment_status === 'paid' ? 'Đã thanh toán' : 'Chưa thanh toán';
  };

  const getSupplierPaymentBadgeClass = (status) => {
    if (status === 'paid') return 'bg-green-100 text-green-700 border-green-200';
    if (status === 'unpaid') return 'bg-orange-100 text-orange-700 border-orange-200';
    return 'bg-gray-100 text-gray-600 border-gray-200';
  };

  const renderSupplierPayment = (supplier) => {
    const summary = getSupplierPaymentSummary(supplier);
    const hasMoneyData = ['imports', 'supplier'].includes(summary.source);

    return (
      <div className="space-y-1">
        <span className={`inline-flex px-2 py-0.5 rounded-full border text-xs font-medium ${getSupplierPaymentBadgeClass(summary.payment_status)}`}>
          {getSupplierPaymentLabel(summary)}
        </span>
        {hasMoneyData && (
          <div className="text-[11px] text-gray-500 leading-4">
            {summary.import_count ? <div>{summary.import_count} phiếu nhập</div> : null}
            {summary.remaining_amount > 0 ? (
              <div>Cđơn {formatPaymentMoney(summary.remaining_amount)}</div>
            ) : summary.total_amount > 0 ? (
              <div>?? tr? {formatPaymentMoney(summary.paid_amount)}</div>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <span className="text-orange-500"></span>
          <span>Quản lý Nhà cung cấp</span>
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
            <Upload size={16} /> {importing ? 'đang nh?p...' : 'Nhập Excel'}
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
        placeholder="?? Tạm nhà cung cấp theo tồn, S?T ho?c MST..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-orange-50 text-orange-700 text-xs">
              <th className="p-2 text-left w-48">Tồn dài t?c</th>
              <th className="p-2 text-left w-32">S?T</th>
              <th className="p-2 text-left w-32">MST</th>
              <th className="p-2 text-left w-40">Email</th>
              <th className="p-2 text-left w-24">Loại H?</th>
              <th className="p-2 text-left w-24">Thanh toán</th>
              <th className="p-2 text-left w-64">?đã ch?</th>
              <th className="p-2 text-center w-24">H?nh d?ng</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="text-center text-gray-400 py-10 flex items-center justify-center gap-2">
                  <Loader size={16} className="animate-spin" /> đang tđi...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-gray-400 py-10">
                  {search ? 'Không tâm th?y nhà cung cấp' : 'Chua c? nhà cung cấp n?o'}
                </td>
              </tr>
            )}
            {!loading && filtered.map(p => (
              <tr key={p.id} className="border-b hover:bg-orange-50">
                <td className="p-2 font-medium">{p.name}</td>
                <td className="p-2">{p.phone || '?'}</td>
                <td className="p-2 font-mono text-xs">{p.tax_code || '?'}</td>
                <td className="p-2 text-gray-600 text-xs">{p.email || '?'}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.invoice_type === 'electronic' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                    {p.invoice_type === 'electronic' ? 'C? H??T' : 'Không H??T'}
                  </span>
                </td>
                <td className="p-2">{renderSupplierPayment(p)}</td>
                <td className="p-2 text-gray-500 text-xs">{p.address || '?'}</td>
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
                {editing ? 'Sửa Nhà cung cấp' : 'Thêm Nhà cung cấp mới'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">?</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Tồn NCC <span className="text-red-500">*</span></label>
                <input
                  ref={nameInputRef}
                  className="input-field w-full"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="VD: Cùng ty TNHH ABC"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">S? điện thoại</label>
                  <input
                    className="input-field w-full"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="0909 123 456"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">M? s? thuế</label>
                  <input
                    className="input-field w-full"
                    value={form.tax_code}
                    onChange={e => setForm({ ...form, tax_code: e.target.value })}
                    placeholder="MST nđủ c?"
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
                    placeholder="example@gmail.com"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">?đã ch?</label>
                <textarea
                  className="input-field w-full"
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                  placeholder="?đã ch? đầy đủ..."
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
                    <span className="text-sm">Không hóa đơn diđơn t?</span>
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
                    <span className="text-sm">C? hóa đơn diđơn t?</span>
                  </label>
                </div>
              </div>
            </form>
            <div className="flex gap-2 mt-4">
              <button onClick={handleSubmit} disabled={saving} className="btn-success flex-1 disabled:opacity-50">
                ?? {saving ? 'đang luu...' : 'Luu'}
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
                <h3 className="font-bold text-gray-800 mb-2">?? Tổng quan</h3>
                <p>Trang Nhà cung cấp giúp quản lý thông tin các đối tác cung cấp hàng hóa. Mỗi nhà cung cấp có thể được liên kết với sản phẩm để lưu thông tin giá nhập và loại hóa đơn.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">? Thêm nhà cung cấp mới</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Nhân n?t <strong>"Thêm nhà cung cấp"</strong> ? g?c trđơn phđi</li>
                  <li>điện các thông tin bắt bu?c: <strong>Tồn NCC</strong></li>
                  <li>Các thông tin t?y chọn: S?T, MST, Email, ?đã ch?</li>
                  <li>Chọn <strong>Loại hóa đơn</strong>: C? H??T ho?c Không H??T</li>
                  <li>Nhân "Luu" d? hođơn tốt</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? Chỉnh sửa nhà cung cấp</h3>
                <p>Nhân n?t <strong>"Sửa"</strong> ? c?t H?nh d?ng d? cập nhật thông tin nhà cung cấp. Các thông tin có thể thay đổi: S?T, MST, Email, ?đã ch?, Loại hóa đơn.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">??? Xóa nhà cung cấp</h3>
                <p>Nhân n?t <strong>"Xóa"</strong> ? c?t H?nh d?ng d? xóa nhà cung cấp. <strong className="text-red-600">Luu ?:</strong> Không th? xóa nđủ nhà cung cấp dang được sử dụng trong sản phẩm.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2"> Tìm kiếm</h3>
                <p>Nhập từ khóa vào ? tìm kiếm d? l?c danh sách theo:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Tồn nhà cung cấp</li>
                  <li>S? điện thoại</li>
                  <li>M? s? thuế (MST)</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? Nhập Excel</h3>
                <p>Nhân n?t <strong>"Nhập Excel"</strong>, chọn file .xlsx ho?c .xls, kiểm tra thông báo xác nhận rđi d?ng ? đã nhập tổng nhà cung cấp vào hệ thống.</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>C?t bắt bu?c: <strong>Tồn NCC</strong> ho?c <strong>Tồn nhà cung cấp</strong> ho?c <strong>name</strong></li>
                  <li>C?t t?y chọn: <strong>S? điện thoại/S?T/phone</strong>, <strong>M? s? thuế/MST/tax_code</strong>, <strong>Email/email</strong>, <strong>?đã ch?/address</strong>, <strong>Loại hóa đơn/invoice_type</strong></li>
                  <li>Dùng tr?ng ho?c d?ng thiđủ tđơn nhà cung cấp sẽ được b? qua về t?nh vào s? lỗi/b? qua</li>
                  <li>Loại hóa đơn nhân các giá trị nhu "C? hóa đơn diđơn t?", "C? H??T", "electronic"; giá trị kh?c s? mặc định l? không hóa đơn diđơn t?</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? Xuất Excel</h3>
                <p>Nhân n?t <strong>"Xuất Excel"</strong> đã tải danh sách nhà cung cấp dang hiển thị theo bộ lọc tìm kiếm ra file .xlsx. File chđã các c?t: Tồn NCC, S? điện thoại, M? s? thuế, Email, ?đã ch?, Loại hóa đơn.</p>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-800 mb-2">?? M?o & Luu ?</h3>
                <ul className="list-disc pl-5 space-y-1 text-blue-700">
                  <li><strong>Loại hóa đơn:</strong> Chọn "C? hóa đơn diđơn t?" nđủ nhà cung cấp cung cấp hóa đơn GTGT, chọn "Không hóa đơn diđơn t?" cho hóa đơn thuếng</li>
                  <li><strong>MST:</strong> Nhập đầy đủ 10-13 s? d? d? tra cđủ về xu?t hóa đơn</li>
                  <li>Thông tin nhà cung cấp s? hiển thị trong trang Sản phẩm khi chọn nhà cung cấp cho sản phẩm mới</li>
                  <li>Giá nhập sản phẩm có thể kh?c nhau t?y theo nhà cung cấp - nđơn thêm nhiđủ nhà cung cấp đã có nhiđủ lđã chọn</li>
                </ul>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
