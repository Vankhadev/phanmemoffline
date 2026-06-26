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
  if (['paid', 'da_thanh_toan', 'd? thanh to?n', 'da thanh toan'].includes(value)) return 'paid';
  if (['unpaid', 'chua_thanh_toan', 'chua thanh to?n', 'chua thanh toan'].includes(value)) return 'unpaid';
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
      const data = await apiJson('/partners', {}, 'Kh?ng th? t?i danh s?ch nh? cung c?p.');
      setSuppliers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('L?i t?i nh? cung c?p:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSupplierPaymentSummaries = async () => {
    setPaymentLoading(true);
    try {
      const data = await apiJson('/imports', {}, 'Kh?ng th? t?i lịch sử nh?p h?ng d? t?ng h?p thanh to?n');
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
      console.error('L?i t?i t?ng h?p thanh to?n nh? cung c?p:', err);
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
      alert('Vui l?ng nh?p t?n nh? cung c?p!');
      return;
    }
    setSaving(true);
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing ? resolveApiUrl(`/partners/${editing.id}`) : resolveApiUrl('/partners');
      await apiJsonChecked(url, {
        method,
        body: form,
      }, editing ? 'Kh?ng th? cập nhật nh? cung c?p.' : 'Kh?ng th? th?m nh? cung c?p.');
      alert(editing ? '? ?? cập nhật nh? cung c?p!' : '? ?? th?m nh? cung c?p th?nh c?ng!');
      setShowForm(false);
      fetchSuppliers();
    } catch (err) {
      alert('L?i kết nối: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('X?a nh? cung c?p n?y?')) return;
    try {
      await apiJsonChecked(resolveApiUrl(`/partners/${id}`), { method: 'DELETE' }, 'Kh?ng th? x?a nh? cung c?p.');
      alert('? ?? x?a nh? cung c?p!');
      fetchSuppliers();
    } catch (err) {
      alert('L?i kết nối: ' + err.message);
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
        alert('File Excel kh?ng c? sheet dữ liệu.');
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
          name: getCellValue(row, ['T?n NCC', 'T?n nh? cung c?p', 'name']),
          phone: getCellValue(row, ['S? di?n tho?i', 'S?T', 'phone']),
          tax_code: getCellValue(row, ['M? s? thu?', 'MST', 'tax_code']),
          email: getCellValue(row, ['Email', 'email']),
          address: getCellValue(row, ['??a ch?', 'address']),
          invoice_type: normalizeInvoiceType(getCellValue(row, ['Lo?i h?a don', 'invoice_type'])),
        };

        if (!supplier.name) {
          skipped += 1;
          return;
        }

        validSuppliers.push(supplier);
      });

      if (validSuppliers.length === 0) {
        alert(`Kh?ng c? nh? cung c?p h?p l? d? nh?p. L?i/b? qua: ${skipped}.`);
        return;
      }

      const confirmed = confirm(
        `T?m th?y ${validSuppliers.length} nh? cung c?p h?p l?. L?i/b? qua: ${skipped}.\nB?n c? mu?n nh?p dữ liệu n?y kh?ng?`
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
          }, 'Kh?ng th? nh?p nh? cung c?p t? Excel.');
          success += 1;
        } catch (err) {
          console.error('L?i nh?p nh? cung c?p:', err);
          failed += 1;
        }
      }

      await fetchSuppliers();
      alert(`Nh?p Excel ho?n t?t!\n- Th?nh c?ng: ${success}\n- L?i/b? qua: ${skipped + failed}`);
    } catch (err) {
      console.error('L?i d?c file Excel:', err);
      alert('Kh?ng th? d?c file Excel: ' + err.message);
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
      alert('Kh?ng c? nh? cung c?p d? xu?t Excel.');
      return;
    }

    const data = filtered.map(p => ({
      'T?n NCC': p.name,
      'S? di?n tho?i': p.phone || '',
      'M? s? thu?': p.tax_code || '',
      'Email': p.email || '',
      '??a ch?': p.address || '',
      'Lo?i h?a don': p.invoice_type === 'electronic' ? 'C? h?a don di?n t?' : 'Kh?ng h?a don di?n t?',
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
    XLSX.utils.book_append_sheet(wb, ws, 'Nh? cung c?p');
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
      return { payment_status: 'loading', label: 'đang t?i...', total_amount: 0, paid_amount: 0, remaining_amount: 0, import_count: null };
    }

    if (paymentLoaded) {
      return { payment_status: 'none', label: 'Chua c? phi?u', total_amount: 0, paid_amount: 0, remaining_amount: 0, import_count: 0 };
    }

    return { payment_status: 'unknown', label: 'Chua c? dữ liệu', total_amount: 0, paid_amount: 0, remaining_amount: 0, import_count: null };
  };

  const getSupplierPaymentLabel = (summary) => {
    if (summary.label) return summary.label;
    return summary.payment_status === 'paid' ? '?? thanh to?n' : 'Chua thanh to?n';
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
            {summary.import_count ? <div>{summary.import_count} phi?u nh?p</div> : null}
            {summary.remaining_amount > 0 ? (
              <div>C?n {formatPaymentMoney(summary.remaining_amount)}</div>
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
          <span>Qu?n l? Nh? cung c?p</span>
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
            <Upload size={16} /> {importing ? 'đang nh?p...' : 'Nh?p Excel'}
          </button>
          <button onClick={exportExcel} className="px-4 py-2 border border-orange-300 text-orange-600 hover:bg-orange-50 rounded-lg text-sm font-medium flex items-center gap-1.5">
            <FileDown size={16} /> Xu?t Excel
          </button>
          <button onClick={openAdd} className="btn-primary flex items-center gap-1">
            <Plus size={16} /> Th?m nh? cung c?p
          </button>
        </div>
      </div>

      <input
        className="input-field mb-4"
        placeholder="?? T?m nh? cung c?p theo t?n, S?T ho?c MST..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-orange-50 text-orange-700 text-xs">
              <th className="p-2 text-left w-48">T?n d?i t?c</th>
              <th className="p-2 text-left w-32">S?T</th>
              <th className="p-2 text-left w-32">MST</th>
              <th className="p-2 text-left w-40">Email</th>
              <th className="p-2 text-left w-24">Lo?i H?</th>
              <th className="p-2 text-left w-24">Thanh to?n</th>
              <th className="p-2 text-left w-64">??a ch?</th>
              <th className="p-2 text-center w-24">H?nh d?ng</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="text-center text-gray-400 py-10 flex items-center justify-center gap-2">
                  <Loader size={16} className="animate-spin" /> đang t?i...
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-gray-400 py-10">
                  {search ? 'Kh?ng t?m th?y nh? cung c?p' : 'Chua c? nh? cung c?p n?o'}
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
                    {p.invoice_type === 'electronic' ? 'C? H??T' : 'Kh?ng H??T'}
                  </span>
                </td>
                <td className="p-2">{renderSupplierPayment(p)}</td>
                <td className="p-2 text-gray-500 text-xs">{p.address || '?'}</td>
                <td className="p-2 text-center">
                  <button onClick={() => openEdit(p)} className="text-blue-600 hover:text-blue-800 text-xs mr-2 flex items-center gap-1 inline-flex">
                    <Edit2 size={12} /> S?a
                  </button>
                  <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:text-red-700 text-xs flex items-center gap-1 inline-flex">
                    <Trash2 size={12} /> X?a
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
                ?? {editing ? 'S?a Nh? cung c?p' : 'Th?m Nh? cung c?p m?i'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">?</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">T?n NCC <span className="text-red-500">*</span></label>
                <input
                  ref={nameInputRef}
                  className="input-field w-full"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="VD: C?ng ty TNHH ABC"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">S? di?n tho?i</label>
                  <input
                    className="input-field w-full"
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="0909 123 456"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">M? s? thu?</label>
                  <input
                    className="input-field w-full"
                    value={form.tax_code}
                    onChange={e => setForm({ ...form, tax_code: e.target.value })}
                    placeholder="MST n?u c?"
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
                <label className="text-xs text-gray-500 block mb-1">??a ch?</label>
                <textarea
                  className="input-field w-full"
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                  placeholder="??a ch? d?y d?..."
                  rows={2}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Lo?i h?a don</label>
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
                    <span className="text-sm">Kh?ng h?a don di?n t?</span>
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
                    <span className="text-sm">C? h?a don di?n t?</span>
                  </label>
                </div>
              </div>
            </form>
            <div className="flex gap-2 mt-4">
              <button onClick={handleSubmit} disabled={saving} className="btn-success flex-1 disabled:opacity-50">
                ?? {saving ? 'đang luu...' : 'Luu'}
              </button>
              <button onClick={() => setShowForm(false)} className="btn-danger flex-1">H?y</button>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <HelpModal
          title="Hu?ng d?n s? d?ng Qu?n l? Nh? cung c?p"
          onClose={() => setShowHelp(false)}
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? T?ng quan</h3>
                <p>Trang Nh? cung c?p gi?p b?n qu?n l? th?ng tin c?c d?i t?c cung c?p h?ng h?a. M?i nh? cung c?p c? th? du?c li?n k?t v?i s?n ph?m d? luu th?ng tin gi? nh?p v? lo?i h?a don.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">? Th?m nh? cung c?p m?i</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Nh?n n?t <strong>"Th?m nh? cung c?p"</strong> ? g?c tr?n ph?i</li>
                  <li>?i?n c?c th?ng tin b?t bu?c: <strong>T?n NCC</strong></li>
                  <li>C?c th?ng tin t?y ch?n: S?T, MST, Email, ??a ch?</li>
                  <li>Ch?n <strong>Lo?i h?a don</strong>: C? H??T ho?c Kh?ng H??T</li>
                  <li>Nh?n "Luu" d? ho?n t?t</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? Ch?nh s?a nh? cung c?p</h3>
                <p>Nh?n n?t <strong>"S?a"</strong> ? c?t H?nh d?ng d? cập nhật th?ng tin nh? cung c?p. C?c th?ng tin c? th? thay d?i: S?T, MST, Email, ??a ch?, Lo?i h?a don.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">??? X?a nh? cung c?p</h3>
                <p>Nh?n n?t <strong>"X?a"</strong> ? c?t H?nh d?ng d? x?a nh? cung c?p. <strong className="text-red-600">Luu ?:</strong> Kh?ng th? x?a n?u nh? cung c?p dang du?c s? d?ng trong s?n ph?m.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2"> T?m ki?m</h3>
                <p>Nh?p t? kh?a v?o ? t?m ki?m d? l?c danh s?ch theo:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>T?n nh? cung c?p</li>
                  <li>S? di?n tho?i</li>
                  <li>M? s? thu? (MST)</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? Nh?p Excel</h3>
                <p>Nh?n n?t <strong>"Nh?p Excel"</strong>, ch?n file .xlsx ho?c .xls, ki?m tra thông báo x?c nh?n r?i d?ng ? d? nh?p t?ng nh? cung c?p v?o hệ thống.</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>C?t b?t bu?c: <strong>T?n NCC</strong> ho?c <strong>T?n nh? cung c?p</strong> ho?c <strong>name</strong></li>
                  <li>C?t t?y ch?n: <strong>S? di?n tho?i/S?T/phone</strong>, <strong>M? s? thu?/MST/tax_code</strong>, <strong>Email/email</strong>, <strong>??a ch?/address</strong>, <strong>Lo?i h?a don/invoice_type</strong></li>
                  <li>D?ng tr?ng ho?c d?ng thi?u t?n nh? cung c?p s? du?c b? qua v? t?nh v?o s? l?i/b? qua</li>
                  <li>Lo?i h?a don nh?n c?c gi? tr? nhu "C? h?a don di?n t?", "C? H??T", "electronic"; gi? tr? kh?c s? m?c d?nh l? kh?ng h?a don di?n t?</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? Xu?t Excel</h3>
                <p>Nh?n n?t <strong>"Xu?t Excel"</strong> d? t?i danh s?ch nh? cung c?p dang hi?n th? theo b? l?c t?m ki?m ra file .xlsx. File ch?a c?c c?t: T?n NCC, S? di?n tho?i, M? s? thu?, Email, ??a ch?, Lo?i h?a don.</p>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-800 mb-2">?? M?o & Luu ?</h3>
                <ul className="list-disc pl-5 space-y-1 text-blue-700">
                  <li><strong>Lo?i h?a don:</strong> Ch?n "C? h?a don di?n t?" n?u nh? cung c?p cung c?p h?a don GTGT, ch?n "Kh?ng h?a don di?n t?" cho h?a don thu?ng</li>
                  <li><strong>MST:</strong> Nh?p d?y d? 10-13 s? d? d? tra c?u v? xu?t h?a don</li>
                  <li>Th?ng tin nh? cung c?p s? hi?n th? trong trang S?n ph?m khi ch?n nh? cung c?p cho s?n ph?m m?i</li>
                  <li>Gi? nh?p s?n ph?m c? th? kh?c nhau t?y theo nh? cung c?p - n?n th?m nhi?u nh? cung c?p d? c? nhi?u l?a ch?n</li>
                </ul>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
