# Release Notes v2.3.7

## Khôi phục dữ liệu an toàn toàn diện

- Thêm RecoveryEngine để tự động quét backup, giải nén file nén và merge dữ liệu vào database hiện tại.
- Không còn ghi đè database hiện tại bằng 1 file backup mới nhất; dữ liệu được gom từ nhiều backup theo thứ tự cũ → mới.
- Tự tạo backup `recovery_pre_restore_YYYYMMDD_HHmmss` trước khi khôi phục và rollback nếu restore lỗi hoặc validation giảm dữ liệu.
- Chống trùng đơn hàng, chi tiết đơn, sản phẩm, khách hàng, nhà cung cấp, nhập hàng, chi tiết nhập hàng.
- Giữ nguyên giá bán, giá nhập, tổng tiền, lợi nhuận lịch sử của đơn/phiếu nhập cũ; chỉ bổ sung field bị thiếu.
- Cho phép khôi phục đơn hàng có item không còn tồn tại trong bảng sản phẩm, phù hợp với dịch vụ khác hoặc hàng hóa đã xóa.
- Ghi log chi tiết vào `logs/recovery/recovery_YYYYMMDD_HHmmss.json`.

## Giao diện

- Thêm mục `Cài đặt → Khôi phục DL`.
- Thêm nút quét/khôi phục toàn bộ backup, xem file tìm thấy, xem log, xuất báo cáo và rollback bản trước restore.
- Recovery chạy nền khi mở app để tránh treo giao diện.

## Kiểm thử

- Thêm script `scripts/test-recovery.js`.
- Đã kiểm tra các luồng chính: nhiều backup, trùng đơn, đơn thiếu, productId không tồn tại, dữ liệu null/rỗng, không nhân đôi khi mở lại.
