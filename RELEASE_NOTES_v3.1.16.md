# Bán Hàng Pos v3.1.16

## Báo cáo đơn hàng theo khách hàng

- Quét dữ liệu trọn vẹn cả tháng: mặc định từ ngày đầu tháng (01) đến ngày cuối tháng (30/31).
- Bổ sung nút chọn nhanh khoảng thời gian: "Tháng này (cả tháng)" và "Tháng trước".
- Chỉ lọc các đơn hàng chưa thanh toán (còn nợ tiền), loại bỏ hoàn toàn các đơn đã thanh toán xong hoặc đơn hủy.
- Giữ nguyên 100% mẫu Excel có sẵn theo đúng bảng biểu đối soát công nợ khách hàng (STT, Thời gian, Hóa đơn, Tiền còn phải trả).
- Sửa sạch toàn bộ các ký tự lỗi hiển thị tiếng Việt và dấu hỏi `?` rác trên toàn bộ giao diện báo cáo và modal chi tiết hóa đơn.

## An toàn dữ liệu & Triển khai máy khách

- Đảm bảo an toàn dữ liệu 100% khi chạy trên máy khách độc lập: cô lập đường dẫn database theo `%APPDATA%\Bán Hàng Pos\phanmienoffline.db.json`.
- Bổ sung kiểm tra `fs.existsSync` cho đường dẫn cấu hình trong `database.js` để tránh dùng nhầm đường dẫn ổ đĩa máy dev.
- Cơ chế ghi nguyên tử (Atomic Write) kết hợp `fsyncSync` ép ghi phần cứng SSD/HDD, bảo vệ cơ sở dữ liệu không bị hỏng khi máy tính tắt nguồn hoặc mất điện đột ngột.
- Bổ sung cảnh báo phát hiện chạy trực tiếp từ thư mục nén Temp trong `start-web.bat`.

## Giao diện & Kiểm thử hệ thống

- Chuẩn hóa tiếng Việt có dấu toàn bộ màn hình Cài đặt, Báo cáo thuế, Thống kê, Báo cáo công nợ.
- Kiểm tra toàn diện hệ thống: 18/18 bài kiểm tra healthcheck đạt kết quả PASS.
- Frontend build tối ưu hóa và tương thích production.
