import { useState, useEffect } from 'react';
import { API } from '../App';
import { TrendingUp, FileText, AlertTriangle, CheckCircle, XCircle, Calendar, DollarSign, Percent, FileDown, HelpCircle } from 'lucide-react';
import HelpModal from '../components/HelpModal';

const THREE_BILLION = 3_000_000_000;

export default function Reports() {
  const [taxReport, setTaxReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('year');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => { fetchTaxReport(); }, [period]);

  const fetchTaxReport = async () => {
    setLoading(true);
    try {
      let url = `${API}/stats/tax-report`;
      if (period === 'custom' && customRange.from && customRange.to) {
        url += `?from=${customRange.from}&to=${customRange.to}`;
      } else if (period === 'month') {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const from = `${year}-${month}-01`;
        const to = now.toISOString().slice(0, 10);
        url += `?from=${from}&to=${to}`;
      } else if (period === 'quarter') {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
        const from = `${year}-${String(quarterStartMonth).padStart(2, '0')}-01`;
        const to = now.toISOString().slice(0, 10);
        url += `?from=${from}&to=${to}`;
      } else if (period === 'year') {
        const year = new Date().getFullYear();
        url += `?from=${year}-01-01&to=${year}-12-31`;
      }

      const res = await fetch(url);
      const data = await res.json();
      setTaxReport(data);
    } catch (err) {
      console.error('Lỗi tải báo cáo thuế:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatVND = (n) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n || 0);

  const profitBelow3B = taxReport && taxReport.total_profit < THREE_BILLION;
  const isHealthy = profitBelow3B; // Below 3B is considered healthy for this business

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <FileText className="text-purple-600" size={24} />
          Báo cáo Thuế & Lợi nhuận
        </h1>
        <div className="flex items-center gap-2">
          <select
            className="input-field w-36"
            value={period}
            onChange={e => setPeriod(e.target.value)}
          >
            <option value="month">Tháng này</option>
            <option value="quarter">Quý này</option>
            <option value="year">Năm này</option>
            <option value="custom">Tùy chỉnh</option>
          </select>
          {period === 'custom' && (
            <>
              <input
                type="date"
                className="input-field w-36"
                value={customRange.from}
                onChange={e => setCustomRange({ ...customRange, from: e.target.value })}
              />
              <span className="text-gray-500">-</span>
              <input
                type="date"
                className="input-field w-36"
                value={customRange.to}
                onChange={e => setCustomRange({ ...customRange, to: e.target.value })}
              />
            </>
          )}
          <button onClick={fetchTaxReport} className="btn-primary">
            Xem báo cáo
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {loading ? (
        <div className="text-center text-gray-400 py-10">Đang tải...</div>
      ) : taxReport ? (
        <>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="card border-t-4 border-blue-500">
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                <DollarSign size={14} /> DOANH THU CHỊU THUẾ
              </div>
              <div className="text-xl font-bold text-blue-600">{formatVND(taxReport.total_taxable_revenue)}</div>
              <div className="text-xs text-gray-400 mt-1">(subtotal)</div>
            </div>
            <div className="card border-t-4 border-orange-500">
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                <Percent size={14} /> THUẾ GTGT
              </div>
              <div className="text-xl font-bold text-orange-600">{formatVND(taxReport.total_vat)}</div>
              <div className="text-xs text-gray-400 mt-1">VAT amount</div>
            </div>
            <div className={`card border-t-4 ${isHealthy ? 'border-green-500' : 'border-red-500'}`}>
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                <TrendingUp size={14} /> LỢI NHUẬN
              </div>
              <div className={`text-xl font-bold ${isHealthy ? 'text-green-600' : 'text-red-600'}`}>
                {formatVND(taxReport.total_profit)}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {isHealthy ? (
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle size={12} /> Dưới 3 tỷ (an toàn)
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-600">
                    <AlertTriangle size={12} /> Trên 3 tỷ (cần kiểm tra thuế)
                  </span>
                )}
              </div>
            </div>
            <div className="card border-t-4 border-purple-500">
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                <FileText size={14} /> SỐ ĐƠN HÀNG
              </div>
              <div className="text-xl font-bold text-purple-600">{taxReport.invoice_count}</div>
              <div className="text-xs text-gray-400 mt-1">Hóa đơn hoàn tất</div>
            </div>
          </div>

          {/* Alert */}
          {!isHealthy && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
              <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <h4 className="font-bold text-red-700">Cảnh báo thuế</h4>
                <p className="text-sm text-red-600">
                  Lợi nhuận năm <strong>{new Date().getFullYear()}</strong> là <strong>{formatVND(taxReport.total_profit)}</strong>, vượt ngưỡng 3 tỷ.
                  Bạn có thể cần nộp thuế TNDN hoặc kiểm tra lại chi phí.
                </p>
              </div>
            </div>
          )}

          {isHealthy && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-start gap-3">
              <CheckCircle className="text-green-500 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <h4 className="font-bold text-green-700">Đạt yêu cầu</h4>
                <p className="text-sm text-green-600">
                  Lợi nhuận năm <strong>{new Date().getFullYear()}</strong> là <strong>{formatVND(taxReport.total_profit)}</strong>, dưới ngưỡng 3 tỷ.
                  Không cần nộp thuế TNDN theo quy định hiện hành (với doanh nghiệp nhỏ).
                </p>
              </div>
            </div>
          )}

          {/* Details */}
          <div className="card">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <Calendar size={18} className="text-gray-600" />
              Chi tiết báo cáo
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-gray-600">
                  <th className="p-2 text-left">Chỉ tiêu</th>
                  <th className="p-2 text-right">Số tiền (VND)</th>
                  <th className="p-2 text-left">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="p-2 font-medium">Doanh thu chịu thuế</td>
                  <td className="p-2 text-right text-blue-600 font-semibold">{formatVND(taxReport.total_taxable_revenue)}</td>
                  <td className="p-2 text-gray-500 text-xs">Tổng subtotal hóa đơn hoàn tất</td>
                </tr>
                <tr className="border-b">
                  <td className="p-2 font-medium">Thuế GTGT (VAT)</td>
                  <td className="p-2 text-right text-orange-600 font-semibold">{formatVND(taxReport.total_vat)}</td>
                  <td className="p-2 text-gray-500 text-xs">Tổng VAT đã tính trên hóa đơn</td>
                </tr>
                <tr className="border-b">
                  <td className="p-2 font-medium">Lợi nhuận (ước tính)</td>
                  <td className={`p-2 text-right font-semibold ${isHealthy ? 'text-green-600' : 'text-red-600'}`}>
                    {formatVND(taxReport.total_profit)}
                  </td>
                  <td className="p-2 text-gray-500 text-xs">(Giá bán - Giá nhập) × Số lượng</td>
                </tr>
                <tr className="border-b">
                  <td className="p-2 font-medium">Tỷ suất lợi nhuận</td>
                  <td className="p-2 text-right text-gray-700">
                    {taxReport.total_taxable_revenue > 0
                      ? ((taxReport.total_profit / taxReport.total_taxable_revenue) * 100).toFixed(2) + '%'
                      : '0%'}
                  </td>
                  <td className="p-2 text-gray-500 text-xs">Lợi nhuận / Doanh thu</td>
                </tr>
                <tr className="bg-gray-50">
                  <td className="p-2 font-bold">Ngưỡng lợi nhuận (TNDN)</td>
                  <td className="p-2 text-right font-bold">3,000,000,000 ₫</td>
                  <td className="p-2 text-gray-500 text-xs">Mức giới hạn doanh thu tối đa cho DN nhỏ</td>
                </tr>
                <tr className="bg-gray-50">
                  <td className="p-2 font-bold text-red-600">Chênh lệch</td>
                  <td className={`p-2 text-right font-bold ${isHealthy ? 'text-green-600' : 'text-red-600'}`}>
                    {formatVND(THREE_BILLION - taxReport.total_profit)}
                  </td>
                  <td className="p-2 text-gray-500 text-xs">
                    {isHealthy ? 'Dưới ngưỡng - An toàn' : 'Vượt ngưỡng - Cần xem xét'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Export */}
          {taxReport && (
            <div className="mt-4 text-right">
              <button
                onClick={() => {
                  let csv = `BÁO CÁO THUẾ VÀ LỢI NHUẬN\n`;
                  csv += `Khoảng thời gian: ${taxReport.period.from} đến ${taxReport.period.to}\n`;
                  csv += `Số đơn hàng: ${taxReport.invoice_count}\n`;
                  csv += `Doanh thu chịu thuế: ${taxReport.total_taxable_revenue}\n`;
                  csv += `Thuế GTGT: ${taxReport.total_vat}\n`;
                  csv += `Lợi nhuận: ${taxReport.total_profit}\n`;
                  csv += `\nXuất lúc: ${new Date().toLocaleString('vi-VN')}\n`;

                  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `BaoCaoThue_${taxReport.period.from}_den_${taxReport.period.to}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="btn-primary flex items-center gap-1 ml-auto"
              >
                <FileDown size={16} /> Xuất báo cáo
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="text-center text-gray-400 py-10">Không có dữ liệu</div>
      )}

      {/* Help Modal */}
      {showHelp && (
        <HelpModal
          title="Hướng dẫn sử dụng Báo cáo Thuế"
          onClose={() => setShowHelp(false)}
          content={
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-bold text-gray-800 mb-2">📊 Tổng quan</h3>
                <p>Trang báo cáo thuế giúp bạn theo dõi lợi nhuận hàng năm và xác định nghĩa vụ thuế TNDN. Hệ thống tự động cảnh báo khi lợi nhuận vượt ngưỡng 3 tỷ VND.</p>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">⏱ Chọn khoảng thời gian</h3>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li><strong>Tháng này:</strong> Xem báo cáo từ đầu tháng đến hiện tại</li>
                  <li><strong>Quý này:</strong> Xem báo cáo từ đầu quý đến hiện tại</li>
                  <li><strong>Năm này:</strong> Xem toàn bộ năm hiện tại</li>
                  <li><strong>Tùy chỉnh:</strong> Chọn ngày bắt đầu và kết thúc theo nhu cầu</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📈 Các chỉ tiêu báo cáo</h3>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li><strong>Doanh thu chịu thuế:</strong> Tổng subtotal của các hóa đơn đã hoàn tất</li>
                  <li><strong>Thuế GTGT:</strong> Tổng VAT đã tính trên hóa đơn</li>
                  <li><strong>Lợi nhuận:</strong> (Giá bán - Giá nhập) × Số lượng của tất cả sản phẩm</li>
                  <li><strong>Số đơn hàng:</strong> Tổng số hóa đơn hoàn tất trong kỳ</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">🚨 Cảnh báo thuế TNDN</h3>
                <p>Hệ thống so sánh lợi nhuận với ngưỡng 3 tỷ VND (mức giới hạn cho doanh nghiệp nhỏ):</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li><strong className="text-green-600">Dưới 3 tỷ (an toàn):</strong> Không cần nộp thuế TNDN theo quy định hiện hành</li>
                  <li><strong className="text-red-600">Trên 3 tỷ (cần kiểm tra):</strong> Bạn có thể phải nộp thuế TNDN - nên tham khảo cơ quan thuế</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">📋 Bảng chi tiết</h3>
                <p>Bảng dưới đây cung cấp thông tin chi tiết:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Tỷ suất lợi nhuận = Lợi nhuận ÷ Doanh thu</li>
                  <li>Chênh lệch so với ngưỡng 3 tỷ</li>
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-gray-800 mb-2">💾 Xuất báo cáo</h3>
                <p>Nhấn nút "Xuất báo cáo" để tải file CSV chứa toàn bộ dữ liệu báo cáo, có thể dùng để lưu trữ hoặc trình bày.</p>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-bold text-blue-800 mb-2">💡 Lưu ý quan trọng</h3>
                <ul className="list-disc pl-5 space-y-1 text-blue-700">
                  <li>Báo cáo chỉ tính các hóa đơn có trạng thái "Đã thanh toán" (completed)</li>
                  <li>Lợi nhuận được tính dựa trên giá nhập tại thời điểm tạo hóa đơn</li>
                  <li>Kiểm tra báo cáo định kỳ để nắm bắt tình hình kinh doanh</li>
                  <li>Các số liệu mang tính tham khảo, nên tham vấn kế toán/chuyên gia thuế cho các quyết định chính thức</li>
                </ul>
              </div>
            </div>
          }
        />
      )}
    </div>
  );
}
