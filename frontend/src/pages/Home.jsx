import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { API } from '../App';
import { SYNC_UPDATED_EVENT } from '../utils/apiClient';
import { BarChart3, ShoppingCart, ShoppingBag, Layers, AlertCircle, TrendingUp, Calendar, FileText, HelpCircle, Store, Package} from 'lucide-react';
import HelpModal from '../components/HelpModal';

export default function Home({ user, store }) {
  const [stats, setStats] = useState({
    todayRevenue: 0,
    todayOrders: 0,
    paidOrders: 0,
    totalProducts: 0,
    outOfStock: 0,
    lowStock: 0,
  });
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    fetchStats();
    // Lắng nghe sự kiện tạo đơn thành công hoặc sync từ thiết bị khác
    const onOrderCreated = () => {
      fetchStats();
    };
    const onSyncUpdated = (event) => {
      const changedTables = event.detail?.changedTables || [];
      if (changedTables.some(table => ['invoices', 'invoice_details', 'products', 'daily_stats'].includes(table))) fetchStats(false);
    };
    window.addEventListener('kha-order-created', onOrderCreated);
    window.addEventListener(SYNC_UPDATED_EVENT, onSyncUpdated);
    return () => {
      window.removeEventListener('kha-order-created', onOrderCreated);
      window.removeEventListener(SYNC_UPDATED_EVENT, onSyncUpdated);
    };
  }, []);

  const fetchStats = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      // Endpoint summary nhẹ: không tải toàn bộ cây sản phẩm chỉ để đếm.
      const res = await fetch(`${API}/dashboard/summary`);
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();
      const summary = data.summary || data;

      setStats({
        todayRevenue: Number(summary.todayRevenue) || 0,
        todayOrders: Number(summary.todayOrders) || 0,
        paidOrders: Number(summary.paidOrders) || 0,
        totalProducts: Number(summary.totalProducts) || 0,
        outOfStock: Number(summary.outOfStock) || 0,
        lowStock: Number(summary.lowStock) || 0,
      });
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  const formatVND = (n) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
  };

  const statCards = [
    {
      title: 'Doanh thu hôm nay',
      value: formatVND(stats.todayRevenue),
      icon: BarChart3,
      color: 'bg-blue-500',
      textColor: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      title: 'Đơn hàng hôm nay',
      value: stats.todayOrders,
      sub: `${stats.paidOrders} đã thanh toán`,
      icon: ShoppingCart,
      color: 'bg-green-500',
      textColor: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      title: 'Tổng sản phẩm',
      value: stats.totalProducts,
      sub: `${stats.outOfStock} hết hàng`,
      icon: Package,
      color: 'bg-purple-500',
      textColor: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      title: 'Cảnh báo tồn kho',
      value: stats.outOfStock + stats.lowStock,
      sub: `${stats.lowStock} sắp hết`,
      icon: AlertCircle,
      color: 'bg-red-500',
      textColor: 'text-red-600',
      bgColor: 'bg-red-50',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Trang chủ</h1>
          <p className="text-gray-500 flex items-center gap-2 mt-1">
            <Calendar size={16} />
            {new Date().toLocaleDateString('vi-VN', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowHelp(true)}
            className="px-3 py-1.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg text-sm font-medium flex items-center gap-1"
          >
            <HelpCircle size={14} /> Hướng dẫn
          </button>
          <div className="text-right">
            <div className="text-sm text-gray-500">Xin chào</div>
            <div className="font-semibold text-gray-800">{user?.name}</div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-400">Đang tải thống kê...</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {statCards.map((card, idx) => (
            <div
              key={idx}
              className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm text-gray-500 font-medium">{card.title}</p>
                  <p className={`text-3xl font-bold mt-2 ${card.textColor}`}>
                    {card.value}
                  </p>
                  {card.sub && (
                    <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
                  )}
                </div>
                <div className={`${card.bgColor} p-3 rounded-lg`}>
                  <card.icon size={24} className={card.textColor} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
          <TrendingUp size={20} className="text-blue-500" />
          Truy cập nhanh
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Link
            to="/san-pham"
            className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-purple-100 hover:border-purple-500 hover:bg-purple-50 transition group"
          >
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center group-hover:bg-purple-500 transition">
              <Layers size={24} className="text-purple-600 group-hover:text-white" />
            </div>
            <span className="text-sm font-medium text-gray-700 group-hover:text-purple-600">Quản lý sản phẩm</span>
          </Link>
          <Link
            to="/danh-sach-don-hang"
            className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-green-100 hover:border-green-500 hover:bg-green-50 transition group"
          >
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center group-hover:bg-green-500 transition">
              <ShoppingCart size={24} className="text-green-600 group-hover:text-white" />
            </div>
            <span className="text-sm font-medium text-gray-700 group-hover:text-green-600">Đơn hàng</span>
          </Link>
          <Link
            to="/thong-ke"
            className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-orange-100 hover:border-orange-500 hover:bg-orange-50 transition group"
          >
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center group-hover:bg-orange-500 transition">
              <TrendingUp size={24} className="text-orange-600 group-hover:text-white" />
            </div>
            <span className="text-sm font-medium text-gray-700 group-hover:text-orange-600">Thống kê</span>
          </Link>
          <Link
            to="/bao-cao-theo-don-hang"
            className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-red-100 hover:border-red-500 hover:bg-red-50 transition group"
          >
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center group-hover:bg-red-500 transition">
              <FileText size={24} className="text-red-600 group-hover:text-white" />
            </div>
            <span className="text-sm font-medium text-gray-700 group-hover:text-red-600">Báo cáo đơn hàng</span>
          </Link>
          <Link
            to="/kho-hang"
            className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-blue-100 hover:border-blue-500 hover:bg-blue-50 transition group"
          >
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center group-hover:bg-blue-500 transition">
              <Package size={24} className="text-blue-600 group-hover:text-white" />
            </div>
            <span className="text-sm font-medium text-gray-700 group-hover:text-blue-600">Kho hàng</span>
          </Link>
          <Link
            to="/nha-cung-cap"
            className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-pink-100 hover:border-pink-500 hover:bg-pink-50 transition group"
          >
            <div className="w-12 h-12 bg-pink-100 rounded-full flex items-center justify-center group-hover:bg-pink-500 transition">
              <Store  size={24} className="text-pink-600 group-hover:text-white" />
            </div>
            <span className="text-sm font-medium text-gray-700 group-hover:text-pink-600">Nhà Cung Cấp</span>
          </Link>
          <Link
            to="/bao-cao-theo-san-pham"
            className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-yellow-100 hover:border-yellow-500 hover:bg-yellow-50 transition group"
          >
            <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center group-hover:bg-yellow-500 transition">
              <Store  size={24} className="text-yellow-600 group-hover:text-white" />
            </div>
            <span className="text-sm font-medium text-gray-700 group-hover:text-yellow-600">Báo cáo sản</span>
          </Link>
        </div>
      </div>

      {/* Help Modal */}
      {showHelp && (
        <HelpModal
          title="Hướng dẫn sử dụng Trang chủ"
          onClose={() => setShowHelp(false)}
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">📊 Thống kê nhanh</h3>
                <p>4 thẻ thống kê hiển thị thông tin quan trọng nhất:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li><strong>Doanh thu hôm nay:</strong> Tổng tiền từ các đơn hàng đã thanh toán trong ngày</li>
                  <li><strong>Đơn hàng hôm nay:</strong> Số lượng đơn tạo trong ngày và số đã thanh toán</li>
                  <li><strong>Tổng sản phẩm:</strong> Tổng số sản phẩm trong kho, cả sản phẩm cha và biến thể</li>
                  <li><strong>Cảnh báo tồn kho:</strong> Số lượng sản phẩm hết hàng hoặc sắp hết (&lt;10)</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🚀 Truy cập nhanh</h3>
                <p>4 nút truy cập nhanh đến các chức năng chính:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li><strong>Quản lý sản phẩm:</strong> Thêm, sửa, xóa sản phẩm và biến thể</li>
                  <li><strong>Đơn hàng:</strong> Xem danh sách đơn hàng, lọc, in hóa đơn</li>
                  <li><strong>Thống kê:</strong> Xem biểu đồ doanh thu theo ngày/tuần/tháng</li>
                  <li><strong>Báo cáo thuế:</strong> Tính lợi nhuận, doanh thu chịu thuế, thuế GTGT</li>
                </ul>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-800 mb-2">💡 Mẹo</h3>
                <ul className="list-disc pl-5 space-y-1 text-blue-700">
                  <li>Kiểm tra trang chủ mỗi ngày để nắm bắt tình hình kinh doanh</li>
                  <li>Click vào các số liệu để xem chi tiết (nếu có link)</li>
                  <li>Sử dụng nút "Làm mới" để cập nhật dữ liệu mới nhất</li>
                </ul>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
