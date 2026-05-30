# Changelog

## v1.3.8 - 2026-05-30

### Cải thiện in ấn

- Siết CSS in A5 để trang in giữ đúng khổ 148mm x 210mm, bỏ lệch lề/zoom và căn từ góc trên trái trong cửa sổ in cũng như silent print.
- Cập nhật renderer mẫu hóa đơn để đánh dấu trang A5 bằng lớp print-page, áp dụng guard cho bảng/hình ảnh và tránh vỡ bố cục khi in.
- Chuẩn hóa in tem sản phẩm dạng cuộn và dạng tờ A4/A5 với khổ giấy, lề, vị trí trang và màu in nhất quán hơn.
- Thêm demo hóa đơn A5 độc lập để kiểm tra nhanh layout, iframe in và trạng thái nút in trước khi phát hành.

### Phát hành

- Đồng bộ version phát hành 1.3.8 cho ứng dụng desktop, frontend, backend, metadata auto-update và tài liệu đi kèm.

## v1.3.7 - 2026-05-27

### Cải thiện in hóa đơn

- Thêm API backend `/api/invoices/:id/print-data` để chuẩn hóa dữ liệu in hóa đơn A5 cho hóa đơn online, bao gồm khách hàng, người lập, chi tiết hàng và trạng thái thanh toán.
- Cập nhật màn `OrderList` để ưu tiên tải dữ liệu in từ server cho hóa đơn đã lưu và tự fallback về dữ liệu local/offline khi cần.
- Tinh chỉnh renderer mẫu in và silent print Electron để bản xem trước/in A5 giữ đúng kích thước trang, lề và zoom.

### Phát hành

- Đồng bộ version phát hành 1.3.7 cho ứng dụng desktop, metadata auto-update và tài liệu đi kèm.

## v1.3.6 - 2026-05-27

### Phát hành

- Đồng bộ version phát hành 1.3.6 cho ứng dụng desktop, metadata auto-update và tài liệu đi kèm.
- Không thay đổi tính năng; bản này tập trung chuẩn hóa metadata release và hướng dẫn tải/cập nhật.

## v1.3.5 - 2026-05-25

### Sửa lỗi phát hành Windows

- Tạo installer riêng cho Windows 64-bit (`x64`) và Windows 32-bit (`ia32`) với tên asset rõ kiến trúc.
- Sinh lại `latest.yml` và `update-manifest.json` từ installer thực để tránh version/hash/size lệch release.
- Thêm kiểm tra local/remote bằng PowerShell cho HTTP 200, Content-Type, kích thước, header MZ/PE và SHA256.
- Cập nhật màn cập nhật trong ứng dụng để hiển thị kiến trúc runtime, bộ cài khuyến nghị và cảnh báo nếu máy không tương thích.
- Chặn mở link tải thủ công nếu URL trả HTML, HTTP lỗi, tên file không đúng kiến trúc hoặc file quá nhỏ.
- Cập nhật workflow GitHub Actions để build/publish đủ asset x64/ia32 và verify public release.

### Hướng dẫn người dùng

- Windows 10/11 thông thường: dùng `banhangoffline-setup-v1.3.5-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn”: dùng `banhangoffline-setup-v1.3.5-ia32.exe`.
- Chỉ tải từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`.
