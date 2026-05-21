import { useState, useEffect } from 'react';
import { resolveApiUrl } from '../utils/apiClient';
import { FileDown, TrendingUp, Package, Calendar, HelpCircle } from 'lucide-react';
import HelpModal from '../components/HelpModal';

const API = resolveApiUrl('');

export default function Stats() {
  const [summary, setSummary] = useState({ today: {}, month: {}, allTime: {} });
  const [dailyStats, setDailyStats] = useState([]);
  const [period, setPeriod] = useState('month');
  const [loading, setLoading] = useState(true);
  const [monthExport, setMonthExport] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => { fetchSummary(); }, []);

  const fetchSummary = () => {
    setLoading(true);
    fetch(`${API}/stats/summary`).then(r => r.json()).then(data => {
      setSummary(data);
      fetchStats();
    }).catch(() => setLoading(false));
  };

  const fetchStats = () => {
    const now = new Date();
    let from, to;
    if (period === 'day') {
      from = to = now.toISOString().slice(0, 10);
    } else if (period === 'week') {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      from = d.toISOString().slice(0, 10);
      to = now.toISOString().slice(0, 10);
    } else if (period === 'month') {
      from = now.getFullYear() + '-' + (now.getMonth() + 1).toString().padStart(2, '0') + '-01';
      to = now.toISOString().slice(0, 10);
    } else {
      from = now.getFullYear() + '-01-01';
      to = now.toISOString().slice(0, 10);
    }
    fetch(`${API}/stats?from=${from}&to=${to}`).then(r => r.json()).then(data => {
      setDailyStats(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { fetchStats(); }, [period]);

  const formatVND = (n) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n || 0);

  const chartData = dailyStats.slice().reverse();
  const maxRevenue = Math.max(...chartData.map(d => d.total_revenue || 0), 1);

  // ===== Xuất Excel =====
  const exportMonthlyReport = () => {
    const [year, month] = monthExport.split('-');
    const rows = chartData.filter(d => {
      const [y, m] = (d.stat_date || '').split('-');
      return y === year && m === month;
    });

    if (rows.length === 0) {
      alert('Không có dữ liệu tháng này!');
      return;
    }

    let csv = '\uFEFF'; // BOM for Excel UTF-8
    csv += `BÁO CÁO DOANH THU THÁNG ${month}/${year}\n`;
    csv += `Ngày, Số đơn hàng, Doanh thu (VND), Lợi nhuận ước tính (VND)\n`;

    let totalOrders = 0;
    let totalRevenue = 0;
    let totalProfit = 0;

    rows.forEach(d => {
      const date = d.stat_date ? new Date(d.stat_date).toLocaleDateString('vi-VN') : '';
      const orders = d.total_orders || 0;
      const revenue = d.total_revenue || 0;
      const profit = revenue * 0.2; // 20% profit estimate
      totalOrders += orders;
      totalRevenue += revenue;
      totalProfit += profit;
      csv += `${date}, ${orders}, ${revenue}, ${Math.round(profit)}\n`;
    });

    csv += `\nTỔNG CỘNG, ${totalOrders}, ${totalRevenue}, ${Math.round(totalProfit)}\n`;
    csv += `Ngày xuất: ${new Date().toLocaleString('vi-VN')}\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BaoCaoDoanhThu_${month}_${year}.excel`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAllTimeReport = () => {
    if (chartData.length === 0) {
      alert('Không có dữ liệu!');
      return;
    }

    let csv = '\uFEFF';
    csv += `BÁO CÁO DOANH THU TỔNG HỢP\n`;
    csv += `Ngày, Số đơn hàng, Doanh thu (VND), Lợi nhuận ước tính (VND)\n`;

    let totalOrders = 0;
    let totalRevenue = 0;

    chartData.forEach(d => {
      const date = d.stat_date ? new Date(d.stat_date).toLocaleDateString('vi-VN') : '';
      const orders = d.total_orders || 0;
      const revenue = d.total_revenue || 0;
      const profit = revenue * 0.2;
      totalOrders += orders;
      totalRevenue += revenue;
      csv += `${date}, ${orders}, ${revenue}, ${Math.round(profit)}\n`;
    });

    csv += `\nTỔNG CỘNG, ${totalOrders}, ${totalRevenue}, ${Math.round(totalRevenue * 0.2)}\n`;
    csv += `Ngày xuất: ${new Date().toLocaleString('vi-VN')}\n`;

    const blob = new Blob([excel], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BaoCaoDoanhThu_ToanThoiGian.excel`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <TrendingUp className="text-green-600" size={24} /> Thống kê Doanh thu
        </h1>
        <div className="flex items-center gap-2">
          <div className="flex gap-2">
            {[['day', 'Hôm nay'], ['week', 'Tuần'], ['month', 'Tháng'], ['year', 'Năm']].map(([k, v]) => (
              <button key={k} onClick={() => setPeriod(k)}
                className={`px-4 py-2 rounded font-medium text-sm transition ${period === k ? 'btn-primary' : 'bg-gray-200 text-gray-700'}`}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card text-center border-t-4 border-blue-500">
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mb-1">
            <Calendar size={14} /> HÔM NAY
          </div>
          <div className="text-2xl font-bold text-blue-600">{formatVND(summary.today?.total_revenue)}</div>
          <div className="text-xs text-gray-400 mt-1">{summary.today?.total_orders || 0} đơn</div>
        </div>
        <div className="card text-center border-t-4 border-green-500">
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mb-1">
            <Calendar size={14} /> THÁNG NÀY
          </div>
          <div className="text-2xl font-bold text-green-600">{formatVND(summary.month?.revenue)}</div>
          <div className="text-xs text-gray-400 mt-1">{summary.month?.orders || 0} đơn</div>
        </div>
        <div className="card text-center border-t-4 border-purple-500">
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mb-1">
            <TrendingUp size={14} /> TỔNG QUAN
          </div>
          <div className="text-2xl font-bold text-purple-600">{formatVND(summary.allTime?.revenue)}</div>
          <div className="text-xs text-gray-400 mt-1">{summary.allTime?.orders || 0} đơn</div>
        </div>
      </div>

      {/* Export Excel */}
      <div className="card mb-4 bg-gradient-to-r from-green-50 to-blue-50 border border-green-200">
        <h3 className="font-bold mb-3 flex items-center gap-2">
          <FileDown className="text-green-600" size={18} /> Xuất Báo cáo Excel
        </h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Chọn tháng</label>
            <input type="month" className="input-field" value={monthExport}
              onChange={e => setMonthExport(e.target.value)} />
          </div>
          <button onClick={exportMonthlyReport} className="btn-success flex items-center gap-1">
            <FileDown size={16} /> Xuất Excel Tháng
          </button>
          <button onClick={exportAllTimeReport} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-medium text-sm flex items-center gap-1 transition">
            <FileDown size={16} /> Xuất Tất cả
          </button>
        </div>
      </div>

      {/* Simple bar chart */}
      {chartData.length > 0 && (
        <div className="card mb-4">
          <h3 className="font-bold mb-4 flex items-center gap-2">
            <TrendingUp className="text-blue-600" size={18} /> Biểu đồ Doanh thu
          </h3>
          <div className="flex items-end gap-1 h-48">
            {chartData.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center group">
                <div className="w-full bg-blue-400 rounded-t relative group-hover:bg-blue-600 transition" style={{ height: `${Math.max(2, (d.total_revenue / maxRevenue) * 100)}%` }}>
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs bg-black text-white rounded px-1 opacity-0 group-hover:opacity-100 whitespace-nowrap">
                    {formatVND(d.total_revenue)}
                  </div>
                </div>
                <div className="text-xs text-gray-400 mt-1">{d.stat_date?.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card">
        <h3 className="font-bold mb-4 flex items-center gap-2">
          <Package className="text-gray-600" size={18} /> Báo cáo chi tiết
        </h3>
        {loading ? (
          <div className="text-center text-gray-400 py-8">Đang tải...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-600">
                <th className="p-2 text-left">Ngày</th>
                <th className="p-2 text-right">Số đơn</th>
                <th className="p-2 text-right">Doanh thu</th>
                <th className="p-2 text-right">Lợi nhuận ước tính</th>
              </tr>
            </thead>
            <tbody>
              {chartData.map((d, i) => {
                const profit = (d.total_revenue || 0) * 0.2;
                return (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="p-2">{new Date(d.stat_date).toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</td>
                    <td className="p-2 text-right">{d.total_orders || 0}</td>
                    <td className="p-2 text-right font-semibold text-blue-600">{formatVND(d.total_revenue)}</td>
                    <td className="p-2 text-right text-green-600">{formatVND(profit)}</td>
                  </tr>
                );
              })}
              {chartData.length === 0 && (
                <tr><td colSpan={4} className="text-center text-gray-400 py-10">Chưa có dữ liệu</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Help Modal */}
      {showHelp && (
        <HelpModal
          title="Hướng dẫn sử dụng Thống kê Doanh thu"
          onClose={() => setShowHelp(false)}
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">📊 Tổng quan</h3>
                <p>Trang thống kê hiển thị doanh thu theo thời gian với biểu đồ và bảng chi tiết. Bạn có thể lọc theo ngày, tuần, tháng, năm hoặc xuất báo cáo Excel.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">⏱ Chọn khoảng thời gian</h3>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li><strong>Hôm nay:</strong> Xem doanh thu trong ngày hiện tại</li>
                  <li><strong>Tuần:</strong> Xem doanh thu 7 ngày gần đây</li>
                  <li><strong>Tháng:</strong> Xem doanh thu từ đầu tháng đến hiện tại</li>
                  <li><strong>Năm:</strong> Xem doanh thu toàn bộ năm hiện tại</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📈 Các thẻ tổng hợp</h3>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li><strong>HÔM NAY:</strong> Doanh thu và số đơn trong ngày</li>
                  <li><strong>THÁNG NÀY:</strong> Doanh thu và số đơn từ đầu tháng</li>
                  <li><strong>TỔNG QUAN:</strong> Doanh thu và số đơn từ đầu năm</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📊 Biểu đồ</h3>
                <p>Biểu đồ cột hiển thị doanh thu theo từng ngày. Di chuột qua cột để xem số tiền cụ thể.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📋 Bảng chi tiết</h3>
                <p>Bảng dưới đây liệt kê từng ngày với:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Ngày tháng</li>
                  <li>Số đơn hàng</li>
                  <li>Doanh thu</li>
                  <li>Lợi nhuận ước tính (20% doanh thu)</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">💾 Xuất báo cáo Excel</h3>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li><strong>Xuất Excel Tháng:</strong> Chọn tháng và xuất báo cáo chi tiết theo tháng</li>
                  <li><strong>Xuất Tất cả:</strong> Xuất toàn bộ dữ liệu có sẵn</li>
                  <li>File xuất ra có định dạng CSV, mở được bằng Excel</li>
                </ul>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-800 mb-2">💡 Lưu ý</h3>
                <ul className="list-disc pl-5 space-y-1 text-blue-700">
                  <li>Lợi nhuận ước tính được tính theo công thức: Doanh thu × 20%</li>
                  <li>Số liệu thống kê dựa trên hóa đơn đã thanh toán (completed)</li>
                  <li>Dữ liệu được cập nhật tự động mỗi 30 giây</li>
                  <li>Biểu đồ chỉ hiển thị khi có dữ liệu</li>
                </ul>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
