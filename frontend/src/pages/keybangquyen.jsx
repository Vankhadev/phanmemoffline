import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCopy, Edit3, Eye, KeyRound, Lock, PlusCircle, RefreshCw, Search, ShieldCheck, Trash2, Unlock, Users } from 'lucide-react';
import { getApiErrorMessage, licenseApi } from '../utils/apiClient';

const emptyCustomerForm = { id: null, name: '', phone: '', zalo: '', email: '', address: '', note: '' };
const emptyKeyForm = { id: null, customer_id: '', customer_name: '', customer_phone: '', customer_zalo: '', customer_email: '', software_name: 'Phần mềm bán hàng offline', package_name: '', durationMode: 'days', durationValue: 30, purchase_date: '', available_until: '', note: '', customKey: '', reusable: false };

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString('vi-VN');
}

function formatDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function statusLabel(status) {
  if (status === 'unused') return 'Chưa kích hoạt';
  if (status === 'active') return 'Còn hạn';
  if (status === 'expired') return 'Hết hạn';
  if (status === 'disabled') return 'Đã khóa';
  if (status === 'deleted') return 'Đã xóa';
  return status || 'Không rõ';
}

function statusClass(status) {
  if (status === 'active') return 'bg-green-100 text-green-700 border-green-200';
  if (status === 'unused') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (status === 'expired') return 'bg-red-100 text-red-700 border-red-200';
  if (status === 'disabled') return 'bg-gray-100 text-gray-700 border-gray-200';
  return 'bg-amber-100 text-amber-700 border-amber-200';
}

function remainingClass(item) {
  if (item.status === 'expired') return 'text-red-700 bg-red-50 border-red-200';
  if (item.status === 'disabled') return 'text-gray-600 bg-gray-50 border-gray-200';
  if (item.is_expiring_soon || (Number(item.days_remaining) > 0 && Number(item.days_remaining) <= 7)) return 'text-amber-700 bg-amber-50 border-amber-200';
  if (item.status === 'active') return 'text-green-700 bg-green-50 border-green-200';
  return 'text-blue-700 bg-blue-50 border-blue-200';
}

function toClipboard(value, onDone) {
  if (!value || typeof navigator === 'undefined') return;
  navigator.clipboard?.writeText(value).then(() => onDone?.()).catch(() => {});
}

function normalizeText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
}

function SummaryCard({ label, value, className }) {
  return (
    <div className={`rounded-2xl p-4 shadow-sm ${className}`}>
      <div className="text-sm opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

export default function KeyBangQuyen() {
  const [keys, setKeys] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [keyForm, setKeyForm] = useState(emptyKeyForm);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [softwareFilter, setSoftwareFilter] = useState('all');
  const [sortBy, setSortBy] = useState('expires_at');
  const [selectedKey, setSelectedKey] = useState(null);

  const summary = useMemo(() => {
    return keys.reduce((acc, item) => {
      const status = item.status || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      acc.total += 1;
      if (item.is_expiring_soon) acc.expiringSoon += 1;
      return acc;
    }, { total: 0, unused: 0, active: 0, expired: 0, disabled: 0, expiringSoon: 0 });
  }, [keys]);

  const softwareOptions = useMemo(() => Array.from(new Set(keys.map(item => item.software_name || '').filter(Boolean))).sort(), [keys]);

  const filteredKeys = useMemo(() => {
    const needle = normalizeText(query);
    return keys
      .filter(item => statusFilter === 'all' || item.status === statusFilter)
      .filter(item => softwareFilter === 'all' || item.software_name === softwareFilter)
      .filter(item => {
        if (!needle) return true;
        return normalizeText([item.license_key, item.customer_name, item.customer_phone, item.customer_zalo, item.customer_email, item.software_name, item.package_name, item.note].join(' ')).includes(needle);
      })
      .sort((a, b) => {
        if (sortBy === 'customer_name') return String(a.customer_name || '').localeCompare(String(b.customer_name || ''), 'vi');
        if (sortBy === 'purchase_date') return new Date(b.purchase_date || 0) - new Date(a.purchase_date || 0);
        if (sortBy === 'created_at') return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        if (sortBy === 'status') return String(a.status || '').localeCompare(String(b.status || ''));
        return new Date(a.expires_at || '2999-12-31') - new Date(b.expires_at || '2999-12-31');
      });
  }, [keys, query, softwareFilter, sortBy, statusFilter]);

  const filteredCustomers = useMemo(() => {
    const needle = normalizeText(query);
    return customers.filter(item => !needle || normalizeText([item.name, item.phone, item.zalo, item.email, item.note].join(' ')).includes(needle));
  }, [customers, query]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [keyData, customerData] = await Promise.all([licenseApi.list(), licenseApi.listCustomers()]);
      setKeys(Array.isArray(keyData.keys) ? keyData.keys : []);
      setCustomers(Array.isArray(customerData.customers) ? customerData.customers : []);
    } catch (err) {
      setMessage({ tone: 'error', text: getApiErrorMessage(err?.data, err?.message || 'Không thể tải dữ liệu bản quyền.') });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const resetKeyForm = () => setKeyForm(emptyKeyForm);
  const resetCustomerForm = () => setCustomerForm(emptyCustomerForm);

  const handleCustomerSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload = { ...customerForm };
      if (customerForm.id) await licenseApi.updateCustomer(customerForm.id, payload);
      else await licenseApi.createCustomer(payload);
      setMessage({ tone: 'success', text: customerForm.id ? 'Đã cập nhật khách hàng.' : 'Đã tạo khách hàng mua phần mềm.' });
      resetCustomerForm();
      await loadAll();
    } catch (err) {
      setMessage({ tone: 'error', text: getApiErrorMessage(err?.data, err?.message || 'Không thể lưu khách hàng.') });
    } finally {
      setSaving(false);
    }
  };

  const buildKeyPayload = () => {
    const value = Math.max(1, Number.parseInt(keyForm.durationValue, 10) || 1);
    const payload = {
      customer_id: keyForm.customer_id ? Number(keyForm.customer_id) : undefined,
      customer_name: keyForm.customer_name,
      customer_phone: keyForm.customer_phone,
      customer_zalo: keyForm.customer_zalo,
      customer_email: keyForm.customer_email,
      software_name: keyForm.software_name,
      package_name: keyForm.package_name,
      purchase_date: keyForm.purchase_date,
      available_until: keyForm.available_until,
      note: keyForm.note,
      reusable: keyForm.reusable,
    };
    if (!keyForm.id && keyForm.customKey.trim()) payload.key = keyForm.customKey.trim();
    if (keyForm.durationMode === 'months') payload.months = value;
    else if (keyForm.durationMode === 'years') payload.years = value;
    else payload.days = value;
    return payload;
  };

  const handleKeySubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload = buildKeyPayload();
      const data = keyForm.id ? await licenseApi.update(keyForm.id, payload) : await licenseApi.create(payload);
      const saved = data.key || data.item;
      setMessage({ tone: 'success', text: keyForm.id ? 'Đã cập nhật key.' : `Đã tạo key ${saved?.license_key || ''}`.trim() });
      resetKeyForm();
      await loadAll();
    } catch (err) {
      setMessage({ tone: 'error', text: getApiErrorMessage(err?.data, err?.message || 'Không thể lưu key.') });
    } finally {
      setSaving(false);
    }
  };

  const selectCustomerForKey = (customer) => {
    setKeyForm(current => ({
      ...current,
      customer_id: customer.id,
      customer_name: customer.name || '',
      customer_phone: customer.phone || '',
      customer_zalo: customer.zalo || customer.phone || '',
      customer_email: customer.email || '',
    }));
  };

  const editCustomer = (customer) => setCustomerForm({
    id: customer.id,
    name: customer.name || '',
    phone: customer.phone || '',
    zalo: customer.zalo || '',
    email: customer.email || '',
    address: customer.address || '',
    note: customer.note || '',
  });

  const editKey = (item) => setKeyForm({
    id: item.id,
    customer_id: item.customer_id || '',
    customer_name: item.customer_name || '',
    customer_phone: item.customer_phone || '',
    customer_zalo: item.customer_zalo || '',
    customer_email: item.customer_email || '',
    software_name: item.software_name || 'Phần mềm bán hàng offline',
    package_name: item.package_name || '',
    durationMode: 'days',
    durationValue: item.validity_days || 30,
    purchase_date: formatDateInput(item.purchase_date),
    available_until: formatDateInput(item.available_until),
    note: item.note || '',
    customKey: item.license_key || '',
    reusable: item.reusable === true,
  });

  const runKeyAction = async (action, item, confirmText, successText) => {
    if (!item?.id) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setMessage(null);
    try {
      if (action === 'disable') await licenseApi.disable(item.id, { reason: 'Admin khóa key' });
      if (action === 'enable') await licenseApi.enable(item.id, { note: 'Admin mở khóa key' });
      if (action === 'delete') await licenseApi.remove(item.id);
      if (action === 'renew') await licenseApi.renew(item.id, { days: 30, note: 'Gia hạn nhanh 30 ngày' });
      setMessage({ tone: 'success', text: successText });
      await loadAll();
    } catch (err) {
      setMessage({ tone: 'error', text: getApiErrorMessage(err?.data, err?.message || 'Thao tác key thất bại.') });
    }
  };

  const loadKeyDetail = async (item) => {
    if (!item?.id) return;
    setSelectedKey(item);
    setEvents([]);
    try {
      const data = await licenseApi.detail(item.id);
      setSelectedKey(data.key || item);
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (err) {
      setMessage({ tone: 'error', text: getApiErrorMessage(err?.data, err?.message || 'Không thể tải chi tiết key.') });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
        <section className="rounded-3xl bg-gradient-to-r from-blue-700 to-indigo-700 px-6 py-6 text-white shadow-lg">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-2xl font-bold"><ShieldCheck className="h-7 w-7" /> Quản trị bản quyền & khách hàng</div>
              <p className="mt-1 text-sm text-blue-100">Khu vực quản trị hệ thống theo quyền backend để quản lý khách hàng, key, trạng thái, gán key và lịch sử thao tác.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <button type="button" onClick={loadAll} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 font-medium hover:bg-white/20"><RefreshCw className="h-4 w-4" /> Tải lại</button>
              <button type="button" onClick={() => { resetCustomerForm(); resetKeyForm(); setSelectedKey(null); setEvents([]); }} className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 font-medium hover:bg-white/20"><PlusCircle className="h-4 w-4" /> Tạo mới</button>
            </div>
          </div>
          {message ? <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${message.tone === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{message.text}</div> : null}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryCard label="Tổng key" value={summary.total} className="bg-white" />
          <SummaryCard label="Đang hoạt động" value={summary.active} className="bg-green-50 text-green-800" />
          <SummaryCard label="Chưa kích hoạt" value={summary.unused} className="bg-blue-50 text-blue-800" />
          <SummaryCard label="Hết hạn / Đã khóa" value={summary.expired + summary.disabled} className="bg-amber-50 text-amber-800" />
          <SummaryCard label="Sắp hết hạn" value={summary.expiringSoon} className="bg-red-50 text-red-800" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Khách hàng</h2>
                <p className="text-sm text-slate-500">Quản lý thông tin khách hàng mua phần mềm và gán nhanh key.</p>
              </div>
              <div className="text-sm text-slate-500">{filteredCustomers.length} khách hàng</div>
            </div>

            <form onSubmit={handleCustomerSubmit} className="grid gap-3 md:grid-cols-2">
              <input value={customerForm.name} onChange={event => setCustomerForm(current => ({ ...current, name: event.target.value }))} placeholder="Tên khách hàng" className="rounded-2xl border border-slate-200 px-4 py-3" />
              <input value={customerForm.phone} onChange={event => setCustomerForm(current => ({ ...current, phone: event.target.value }))} placeholder="Số điện thoại" className="rounded-2xl border border-slate-200 px-4 py-3" />
              <input value={customerForm.zalo} onChange={event => setCustomerForm(current => ({ ...current, zalo: event.target.value }))} placeholder="Zalo" className="rounded-2xl border border-slate-200 px-4 py-3" />
              <input value={customerForm.email} onChange={event => setCustomerForm(current => ({ ...current, email: event.target.value }))} placeholder="Email" className="rounded-2xl border border-slate-200 px-4 py-3" />
              <input value={customerForm.address} onChange={event => setCustomerForm(current => ({ ...current, address: event.target.value }))} placeholder="Địa chỉ" className="md:col-span-2 rounded-2xl border border-slate-200 px-4 py-3" />
              <textarea value={customerForm.note} onChange={event => setCustomerForm(current => ({ ...current, note: event.target.value }))} placeholder="Ghi chú" className="md:col-span-2 rounded-2xl border border-slate-200 px-4 py-3" rows={3} />
              <div className="md:col-span-2 flex gap-2">
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 font-medium text-white disabled:opacity-60">{saving ? 'Đang lưu...' : 'Lưu khách hàng'}</button>
                <button type="button" onClick={resetCustomerForm} className="rounded-2xl border border-slate-200 px-4 py-3 font-medium text-slate-700">Xóa form</button>
              </div>
            </form>

            <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Khách hàng</th>
                    <th className="px-4 py-3 text-left font-medium">Liên hệ</th>
                    <th className="px-4 py-3 text-right font-medium">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredCustomers.map(customer => (
                    <tr key={customer.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{customer.name || '—'}</div>
                        <div className="text-xs text-slate-500">{customer.note || 'Không có ghi chú'}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{customer.phone || customer.email || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-2">
                          <button type="button" onClick={() => selectCustomerForKey(customer)} className="rounded-xl border border-blue-200 px-3 py-2 text-blue-700"><KeyRound className="h-4 w-4" /></button>
                          <button type="button" onClick={() => editCustomer(customer)} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700"><Edit3 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Cấp / cập nhật key</h2>
            <p className="text-sm text-slate-500">Tạo key, gán khách hàng, cấu hình thời hạn và ghi chú quản trị.</p>
            <form onSubmit={handleKeySubmit} className="mt-4 grid gap-3 md:grid-cols-2">
              <input value={keyForm.customer_name} onChange={event => setKeyForm(current => ({ ...current, customer_name: event.target.value }))} placeholder="Tên khách hàng" className="rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" />
              <input value={keyForm.customer_phone} onChange={event => setKeyForm(current => ({ ...current, customer_phone: event.target.value }))} placeholder="Số điện thoại" className="rounded-2xl border border-slate-200 px-4 py-3" />
              <input value={keyForm.customer_email} onChange={event => setKeyForm(current => ({ ...current, customer_email: event.target.value }))} placeholder="Email" className="rounded-2xl border border-slate-200 px-4 py-3" />
              <input value={keyForm.software_name} onChange={event => setKeyForm(current => ({ ...current, software_name: event.target.value }))} placeholder="Tên phần mềm" className="rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" />
              <input value={keyForm.package_name} onChange={event => setKeyForm(current => ({ ...current, package_name: event.target.value }))} placeholder="Gói / phiên bản" className="rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" />
              <select value={keyForm.durationMode} onChange={event => setKeyForm(current => ({ ...current, durationMode: event.target.value }))} className="rounded-2xl border border-slate-200 px-4 py-3">
                <option value="days">Ngày</option>
                <option value="months">Tháng</option>
                <option value="years">Năm</option>
              </select>
              <input type="number" min="1" value={keyForm.durationValue} onChange={event => setKeyForm(current => ({ ...current, durationValue: event.target.value }))} className="rounded-2xl border border-slate-200 px-4 py-3" />
              <input type="date" value={keyForm.purchase_date} onChange={event => setKeyForm(current => ({ ...current, purchase_date: event.target.value }))} className="rounded-2xl border border-slate-200 px-4 py-3" />
              <input type="date" value={keyForm.available_until} onChange={event => setKeyForm(current => ({ ...current, available_until: event.target.value }))} className="rounded-2xl border border-slate-200 px-4 py-3" />
              <input value={keyForm.customKey} onChange={event => setKeyForm(current => ({ ...current, customKey: event.target.value }))} placeholder="Key tùy chỉnh (khi tạo mới)" className="rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" />
              <textarea value={keyForm.note} onChange={event => setKeyForm(current => ({ ...current, note: event.target.value }))} placeholder="Ghi chú" className="rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2" rows={3} />
              <label className="md:col-span-2 inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={keyForm.reusable} onChange={event => setKeyForm(current => ({ ...current, reusable: event.target.checked }))} /> Key dùng lại được</label>
              <div className="md:col-span-2 flex gap-2">
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 font-medium text-white disabled:opacity-60">{saving ? 'Đang lưu...' : keyForm.id ? 'Cập nhật key' : 'Tạo key'}</button>
                <button type="button" onClick={resetKeyForm} className="rounded-2xl border border-slate-200 px-4 py-3 font-medium text-slate-700">Xóa form</button>
              </div>
            </form>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Danh sách key</h2>
              <p className="text-sm text-slate-500">Tìm kiếm, lọc trạng thái, lọc theo phần mềm và sắp xếp.</p>
            </div>
            <div className="grid gap-2 md:grid-cols-4 lg:w-[68%]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm kiếm key / khách hàng" className="w-full rounded-2xl border border-slate-200 py-3 pl-10 pr-4" />
              </div>
              <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="rounded-2xl border border-slate-200 px-4 py-3">
                <option value="all">Tất cả trạng thái</option>
                <option value="unused">Chưa kích hoạt</option>
                <option value="active">Còn hạn</option>
                <option value="expired">Hết hạn</option>
                <option value="disabled">Đã khóa</option>
              </select>
              <select value={softwareFilter} onChange={event => setSoftwareFilter(event.target.value)} className="rounded-2xl border border-slate-200 px-4 py-3">
                <option value="all">Tất cả phần mềm</option>
                {softwareOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
              <select value={sortBy} onChange={event => setSortBy(event.target.value)} className="rounded-2xl border border-slate-200 px-4 py-3">
                <option value="expires_at">Hết hạn sớm</option>
                <option value="customer_name">Khách hàng</option>
                <option value="purchase_date">Ngày mua</option>
                <option value="created_at">Ngày tạo</option>
                <option value="status">Trạng thái</option>
              </select>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Key</th>
                  <th className="px-4 py-3 text-left font-medium">Khách hàng</th>
                  <th className="px-4 py-3 text-left font-medium">Trạng thái</th>
                  <th className="px-4 py-3 text-left font-medium">Thời hạn</th>
                  <th className="px-4 py-3 text-right font-medium">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {filteredKeys.map(item => (
                  <tr key={item.id} className={selectedKey?.id === item.id ? 'bg-blue-50/50' : ''}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{item.license_key}</div>
                      <div className="text-xs text-slate-500">{item.software_name || '—'}{item.package_name ? ` · ${item.package_name}` : ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{item.customer_name || 'Chưa gán'}</div>
                      <div className="text-xs text-slate-500">{item.customer_phone || item.customer_email || '—'}</div>
                    </td>
                    <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${statusClass(item.status)}`}>{statusLabel(item.status)}</span></td>
                    <td className="px-4 py-3">
                      <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${remainingClass(item)}`}>{item.days_remaining ?? '—'} ngày</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDate(item.expires_at)}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => loadKeyDetail(item)} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700"><Eye className="h-4 w-4" /></button>
                        <button type="button" onClick={() => toClipboard(item.license_key, () => setMessage({ tone: 'success', text: 'Đã sao chép key.' }))} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700"><ClipboardCopy className="h-4 w-4" /></button>
                        <button type="button" onClick={() => editKey(item)} className="rounded-xl border border-slate-200 px-3 py-2 text-slate-700"><Edit3 className="h-4 w-4" /></button>
                        {item.status === 'disabled' ? <button type="button" onClick={() => runKeyAction('enable', item, 'Mở khóa key này?', 'Đã mở khóa key.')} className="rounded-xl border border-green-200 px-3 py-2 text-green-700"><Unlock className="h-4 w-4" /></button> : <button type="button" onClick={() => runKeyAction('disable', item, 'Khóa key này?', 'Đã khóa key.')} className="rounded-xl border border-amber-200 px-3 py-2 text-amber-700"><Lock className="h-4 w-4" /></button>}
                        <button type="button" onClick={() => runKeyAction('renew', item, 'Gia hạn key thêm 30 ngày?', 'Đã gia hạn key 30 ngày.')} className="rounded-xl border border-blue-200 px-3 py-2 text-blue-700"><RefreshCw className="h-4 w-4" /></button>
                        <button type="button" onClick={() => runKeyAction('delete', item, 'Xóa key này?', 'Đã xóa key.')} className="rounded-xl border border-red-200 px-3 py-2 text-red-700"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {selectedKey ? (
          <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Chi tiết key</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">License key</div>
                  <div className="mt-1 font-medium text-slate-900">{selectedKey.license_key || '—'}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Trạng thái</div>
                  <div className={`mt-1 inline-flex rounded-full border px-3 py-1 text-xs font-medium ${statusClass(selectedKey.status)}`}>{statusLabel(selectedKey.status)}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Khách hàng</div>
                  <div className="mt-1 font-medium text-slate-900">{selectedKey.customer_name || '—'}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Hết hạn</div>
                  <div className="mt-1 font-medium text-slate-900">{formatDate(selectedKey.expires_at)}</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => runKeyAction('renew', selectedKey, 'Gia hạn key thêm 30 ngày?', 'Đã gia hạn key 30 ngày.')} className="rounded-2xl bg-blue-600 px-4 py-3 font-medium text-white">Gia hạn nhanh</button>
                <button type="button" onClick={() => editKey(selectedKey)} className="rounded-2xl border border-slate-200 px-4 py-3 font-medium text-slate-700">Chỉnh sửa</button>
              </div>
            </div>
            <div className="rounded-3xl bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Lịch sử thao tác</h2>
              <div className="mt-3 space-y-3">
                {events.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">Chưa có lịch sử.</div> : events.map((event, index) => (
                  <div key={event.id || `${index}-${event.action || 'event'}`} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-slate-900">{event.action || 'Thao tác'}</div>
                      <div className="text-xs text-slate-500">{formatDate(event.created_at || event.createdAt)}</div>
                    </div>
                    <div className="mt-1 text-sm text-slate-600">{event.note || event.message || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
