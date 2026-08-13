import { useState, useEffect, useCallback, useRef } from 'react';
import { apiJson, apiJsonChecked, resolveApiUrl } from '../utils/apiClient';
import { globalSyncEmitter } from '../utils/eventEmitter';
import { Plus, Edit2, Trash2, TrendingUp, TrendingDown, Calendar, Filter, Upload, Download, X, DollarSign } from 'lucide-react';
import * as XLSX from 'xlsx';
import HelpModal from '../components/HelpModal';

const API = resolveApiUrl('');

export default function CashBook() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState({ type: '', from: '', to: '' });
  const excelInputRef = useRef(null);
  const [showHelp, setShowHelp] = useState(false);

  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toTimeString().slice(0, 8),
    type: 'income',
    category: '',
    amount: '',
    note: '',
    reference_id: '',
    reference_type: '',
  });

  const fetchTransactions = useCallback(async (nextFilter = filter) => {
    const activeFilter = nextFilter && typeof nextFilter === 'object' ? nextFilter : filter;
    setLoading(true);
    try {
      let url = `${API}/cash-book`;
      const params = new URLSearchParams();
      if (activeFilter.type) params.append('type', activeFilter.type);
      if (activeFilter.from) params.append('from', activeFilter.from);
      if (activeFilter.to) params.append('to', activeFilter.to);
      if (params.toString()) url += `?${params.toString()}`;

      const data = await apiJson(url, {}, 'Không thử lại s? qu?.');
      setTransactions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Lỗi tđi s? qu?:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  useEffect(() => {
    const handleSyncRefresh = () => {
      fetchTransactions();
      console.log('[SYNC] CashBook refreshed');
    };

    const unsubscribeDebt = globalSyncEmitter.on('DEBT_UPDATED', handleSyncRefresh);

    return () => {
      unsubscribeDebt();
    };
  }, [fetchTransactions]);

  const fetchSummary = async () => {
    try {
      let url = `${API}/cash-book/summary`;
      if (filter.from || filter.to) {
        const params = new URLSearchParams();
        if (filter.from) params.append('from', filter.from);
        if (filter.to) params.append('to', filter.to);
        url += `?${params.toString()}`;
      }
      return await apiJson(url, {}, 'Không thử lại tổng hợp s? qu?.');
    } catch (err) {
      console.error('Lỗi tđi tổng hợp:', err);
      return null;
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm({
      date: new Date().toISOString().slice(0, 10),
      time: new Date().toTimeString().slice(0, 8),
      type: 'income',
      category: '',
      amount: '',
      note: '',
      reference_id: '',
      reference_type: '',
    });
    setShowForm(true);
  };

  const openEdit = (tx) => {
    setEditing(tx);
    setForm({
      date: tx.date,
      time: tx.time || '00:00:00',
      type: tx.type,
      category: tx.category || '',
      amount: tx.amount,
      note: tx.note || '',
      reference_id: tx.reference_id || '',
      reference_type: tx.reference_type || '',
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!form.amount || parseFloat(form.amount) <= 0) {
      alert('Vui lượng nhập s? tiđơn hợp lệ!');
      return;
    }
    setSaving(true);
    try {
      const method = editing ? 'PUT' : 'POST';
      const url = editing ? `${API}/cash-book/${editing.id}` : `${API}/cash-book`;
      await apiJsonChecked(url, {
        method,
        body: form,
      }, editing ? 'Không th? cập nhật giao dịch.' : 'Không th? thêm giao dịch.');
      alert(editing ? '? ?? cập nhật!' : '? ?? thêm giao dịch!');
      setShowForm(false);
      fetchTransactions();
    } catch (err) {
      alert('Lỗi kết nối: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAll = async () => {
    if (transactions.length === 0) { alert('Không có giao dịch để xóa.'); return; }
    if (!confirm('Xóa TẤT CẢ giao dịch trong sổ quỹ? Hành động này không thể hoàn tác!')) return;
    if (!confirm('Bạn có chắc chắn? Tất cả dữ liệu thu chi sẽ bị xóa vĩnh viễn!')) return;
    try {
      let deleted = 0;
      for (const t of transactions) {
        try {
          await apiJsonChecked(`${API}/cash-book/${t.id}`, { method: 'DELETE' }, 'Không thể xóa giao dịch.');
          deleted++;
        } catch (err) { /* skip individual errors */ }
      }
      alert(`Đã xóa ${deleted} giao dịch.`);
      fetchTransactions();
    } catch (err) {
      alert('Lỗi kết nối: ' + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Xóa giao dịch n?y?')) return;
    try {
      await apiJsonChecked(`${API}/cash-book/${id}`, { method: 'DELETE' }, 'Không th? xóa giao dịch.');
      alert('? ?? xóa!');
      fetchTransactions();
    } catch (err) {
      alert('Lỗi kết nối: ' + err.message);
    }
  };

  const applyFilter = () => {
    fetchTransactions(filter);
  };

  const clearFilter = () => {
    const emptyFilter = { type: '', from: '', to: '' };
    setFilter(emptyFilter);
    fetchTransactions(emptyFilter);
  };

  const exportExcel = () => {
    const data = transactions.map(t => ({
      'Ngày': t.date,
      'Gi?': t.time || '',
      'Loại': t.type === 'income' ? 'Thu' : 'Chi',
      'Danh mục': t.category || '',
      'S? tiđơn': t.amount,
      'Ghi ch?': t.note || '',
      'M? tham chiđủ': t.reference_id || '',
      'Loại tham chiđủ': t.reference_type || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S? qu?');
    XLSX.writeFile(wb, `so_quy_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const formatVND = (n) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);

  // T?nh tổng hợp trđơn filtered data
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0);
  const balance = totalIncome - totalExpense;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <DollarSign className="text-green-600" size={24} />
          S? qu?
        </h1>
        <div className="flex gap-2">
          <button onClick={exportExcel} className="px-4 py-2 border border-green-300 text-green-600 hover:bg-green-50 rounded-lg text-sm font-medium flex items-center gap-1.5">
            <Upload size={16} /> Xuất Excel
          </button>
          <button onClick={openAdd} className="btn-primary flex items-center gap-1">
            <Plus size={16} /> Thêm giao dịch
          </button>
          <button onClick={handleDeleteAll} className="px-4 py-2 border border-red-300 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium flex items-center gap-1.5">
            <Trash2 size={16} /> Xóa tất cả
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card border-t-4 border-green-500">
          <div className="text-xs text-gray-500 mb-1">T?NG THU</div>
          <div className="text-2xl font-bold text-green-600">{formatVND(totalIncome)}</div>
        </div>
        <div className="card border-t-4 border-red-500">
          <div className="text-xs text-gray-500 mb-1">T?NG CHI</div>
          <div className="text-2xl font-bold text-red-600">{formatVND(totalExpense)}</div>
        </div>
        <div className={`card border-t-4 ${balance >= 0 ? 'border-blue-500' : 'border-orange-500'}`}>
          <div className="text-xs text-gray-500 mb-1">S? DU</div>
          <div className={`text-2xl font-bold ${balance >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
            {formatVND(balance)}
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="card mb-4 bg-gray-50">
        <div className="flex items-center gap-3 flex-wrap">
          <select className="input-field w-32" value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })}>
            <option value="">Tất cả</option>
            <option value="income">Thu</option>
            <option value="expense">Chi</option>
          </select>
          <input type="date" className="input-field w-36" value={filter.from} onChange={e => setFilter({ ...filter, from: e.target.value })} />
          <span className="text-gray-500">-</span>
          <input type="date" className="input-field w-36" value={filter.to} onChange={e => setFilter({ ...filter, to: e.target.value })} />
          <button onClick={applyFilter} className="px-4 py-2 bg-blue-600 text-white rounded text-sm flex items-center gap-1">
            <Filter size={14} /> Lực
          </button>
          <button onClick={clearFilter} className="px-4 py-2 bg-gray-300 text-gray-700 rounded text-sm">
            Xóa bộ lọc
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-gray-600">
              <th className="p-2 text-left">Ngày</th>
              <th className="p-2 text-left">Gi?</th>
              <th className="p-2 text-left">Loại</th>
              <th className="p-2 text-left">Danh mục</th>
              <th className="p-2 text-right">S? tiđơn</th>
              <th className="p-2 text-left">Ghi ch?</th>
              <th className="p-2 text-center">H?nh d?ng</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center text-gray-400 py-10">đang tđi...</td></tr>
            ) : transactions.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-gray-400 py-10">Chua c? giao dịch</td></tr>
            ) : (
              transactions.map(t => (
                <tr key={t.id} className="border-b hover:bg-gray-50">
                  <td className="p-2">{t.date}</td>
                  <td className="p-2 text-gray-500">{t.time || '?'}</td>
                  <td className="p-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${t.type === 'income' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {t.type === 'income' ? 'Thu' : 'Chi'}
                    </span>
                  </td>
                  <td className="p-2 text-gray-600">{t.category || '?'}</td>
                  <td className={`p-2 text-right font-semibold ${t.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                    {formatVND(t.amount)}
                  </td>
                  <td className="p-2 text-gray-500 text-xs">{t.note || '?'}</td>
                  <td className="p-2 text-center">
                    <button onClick={() => openEdit(t)} className="text-blue-600 hover:text-blue-800 text-xs mr-2">
                      <Edit2 size={12} />
                    </button>
                    <button onClick={() => handleDelete(t.id)} className="text-red-500 hover:text-red-700 text-xs">
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-[500px]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <DollarSign size={20} className="text-green-600" />
                {editing ? 'Sửa giao dịch' : 'Thêm giao dịch mới'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Ngày <span className="text-red-500">*</span></label>
                  <input type="date" className="input-field w-full" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Gi?</label>
                  <input type="time" className="input-field w-full" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Loại <span className="text-red-500">*</span></label>
                  <select className="input-field w-full" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                    <option value="income">Thu</option>
                    <option value="expense">Chi</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Danh mục</label>
                  <input className="input-field w-full" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="VD: Bản h?ng, Mua h?ng..." />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">S? tiđơn <span className="text-red-500">*</span></label>
                <input type="number" className="input-field w-full" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" required />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Ghi ch?</label>
                <textarea className="input-field w-full" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Ghi ch?..." rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">M? tham chiđủ</label>
                  <input className="input-field w-full" value={form.reference_id} onChange={e => setForm({ ...form, reference_id: e.target.value })} placeholder="VD: HD001" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Loại tham chiđủ</label>
                  <input className="input-field w-full" value={form.reference_type} onChange={e => setForm({ ...form, reference_type: e.target.value })} placeholder="invoice, return..." />
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
          title="Hướng dẫn sử dụng S? qu?"
          onClose={() => setShowHelp(false)}
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? Tổng quan</h3>
                <p>S? qu? giáp bđơn ghi nhân về theo dài các khođơn thu chi của cửa hàng. Dữ liệu được luu tự động về không một khi tốt mãy.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? Thu nh?p tự động t? đơn hàng</h3>
                <p className="text-blue-600">Khi bđơn xác nhận đơn hàng (trạng thái "?? thanh toán"), hệ thống s? tự động tạo giao dịch thu vào s? qu? vđi:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Danh mục: "Doanh thu t? đơn hàng"</li>
                  <li>S? tiđơn: Tổng giá trị hóa đơn</li>
                  <li>Ghi ch?: Chđã mã hóa đơn (về d?: "Hóa don HD00001")</li>
                  <li>Liđơn kỳt: C? th? trace về đơn hàng g?c qua mã tham chiđủ</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">? Thêm giao dịch th? c?ng</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Nhân n?t <strong>"Thêm giao dịch"</strong> ? g?c trđơn phđi</li>
                  <li>Chọn loại: <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">Thu</span> ho?c <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs">Chi</span></li>
                  <li>Nhập ngày, giá (mặc định l? hiện tại)</li>
                  <li>Nhập s? tiđơn về danh mục (VD: "Bản h?ng", "Mua h?ng", "Tiền diđơn"...)</li>
                  <li>C? th? thêm ghi ch? về mã tham chiđủ (HD001...)</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? Các số liệu hiển thị</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Tổng thu:</strong> Tất cả khođơn thu (loại income)</li>
                  <li><strong>Tổng chi:</strong> Tất cả khođơn chi (loại expense)</li>
                  <li><strong>S? du:</strong> Tổng thu - Tổng chi</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? Lực danh sách</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Chọn loại (Thu/Chi) d? l?c</li>
                  <li>Chọn kho?ng ngày d? xem giao dịch trong thời gian có thể</li>
                  <li>Nhân "Lực" d? ?p d?ng, "Xóa bộ lọc" d? xem tất cả</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? Chỉnh sửa & Xóa</h3>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Nhân icon <strong>?? Sửa</strong> d? chỉnh sửa giao dịch</li>
                  <li>Nhân icon <strong>??? Xóa</strong> d? xóa giao dịch</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">?? Xuất Excel</h3>
                <p>Nhân n?t "Xuất Excel" đã tải tođơn b? danh sách giao dịch ra file .xlsx. File chđã các c?t: Ngày, Gi?, Loại, Danh mục, S? tiđơn, Ghi ch?...</p>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-800 mb-2">?? M?o hay</h3>
                <ul className="list-disc pl-5 space-y-1 text-blue-700">
                  <li>Tạo quy d?nh: Nhập chi ph? vđi danh mục r? r?ng (Tiền diđơn, Tiền nu?c, Thu? một bằng...)</li>
                  <li>Ghi ch? mã hóa đơn vào "M? tham chiđủ" d? d? theo dài</li>
                  <li>Kiểm tra s? qu? h?ng tuđơn d? dài chiđủ</li>
                </ul>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
