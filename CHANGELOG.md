# Changelog

## v1.4.0 - 2026-06-01

### Tính năng và cải tiến

- Chuẩn hóa luồng in hóa đơn bằng trang in riêng theo mã/ID đơn hàng, hỗ trợ mở nhanh bản in từ tạo đơn và danh sách đơn hàng.
- Cải thiện danh sách đơn hàng với dữ liệu từ API, nhãn nguồn đơn, gộp dòng hàng ổn định hơn và xử lý đơn offline rõ ràng hơn.
- Bổ sung lại nghiệp vụ bảng lương nhân viên theo service/controller riêng, validation đầu vào, tổng hợp lương và thao tác thêm/sửa/xóa mềm.
- Tinh gọn module in legacy, bỏ các route/component mẫu in cũ và cập nhật dependency in/xuất file phù hợp frontend hiện tại.

### Phát hành

- Đồng bộ version phát hành 1.4.0 cho ứng dụng desktop, frontend, backend và các lockfile tương ứng.
- Cập nhật tài liệu phát hành, hướng dẫn tải/cài đặt và manifest ví dụ theo tag v1.4.0.
- GitHub Actions tiếp tục build/publish installer Windows x64 và ia32 kèm latest.yml và update-manifest.json từ artifact thực tế.

### Lưu ý quan trọng

- Windows 10/11 64-bit nên dùng `banhangoffline-setup-v1.4.0-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn” nên dùng `banhangoffline-setup-v1.4.0-ia32.exe`.
- Chỉ tải bộ cài từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới.

## v1.3.9 - 2026-05-30

### Phát hành

- Đồng bộ version phát hành 1.3.9 cho ứng dụng desktop, frontend, backend, lockfile và metadata cập nhật Windows.
- Chuẩn hóa tài liệu release và hướng dẫn tải/cập nhật theo tag v1.3.9.
- Không đưa các thay đổi chưa commit ngoài phạm vi release vào commit phát hành.

### Lưu ý quan trọng

- Windows 10/11 64-bit nên dùng `banhangoffline-setup-v1.3.9-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn” nên dùng `banhangoffline-setup-v1.3.9-ia32.exe`.
- Chỉ tải bộ cài từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới.

## v1.3.8 - 2026-05-30

### Bảng phát hành chính thức

| Hạng mục | Nội dung |
| --- | --- |
| Phiên bản | 1.3.8 |
| Ngày phát hành | 2026-05-30 |
| Trạng thái | Sẵn sàng công bố cho người dùng Windows x64 và ia32 |
| Tổng quan | Bản 1.3.8 tập trung ổn định trải nghiệm in hóa đơn A5, in tem sản phẩm và đồng bộ metadata phát hành Windows. |

### Ghi chú thay đổi tổng quan

- Cải thiện độ chính xác khổ giấy, lề và vị trí trang khi in hóa đơn A5 trong cửa sổ in cũng như silent print.
- Chuẩn hóa luồng in tem sản phẩm cho cả dạng cuộn và dạng tờ A4/A5 để màu in, vùng in và căn trang nhất quán hơn.
- Đồng bộ version phát hành 1.3.8 cho ứng dụng desktop, frontend, backend, metadata auto-update và tài liệu đi kèm.

### Tính năng mới

- Thêm demo hóa đơn A5 độc lập để kiểm tra nhanh layout, iframe in và trạng thái nút in trước khi phát hành.
- Bổ sung đánh dấu trang A5 bằng lớp print-page trong renderer mẫu hóa đơn để hệ thống in nhận diện đúng vùng trang.
- Hoàn thiện ghi chú phát hành và metadata cho bộ cài Windows x64/ia32 của phiên bản 1.3.8.

### Lỗi đã sửa

- Sửa tình trạng in hóa đơn A5 bị lệch lề, sai zoom hoặc không căn từ góc trên trái trong cửa sổ in và silent print.
- Giảm lỗi vỡ bố cục bảng, hình ảnh hoặc nội dung hóa đơn khi renderer mẫu in gặp dữ liệu dài.
- Sửa độ không nhất quán về khổ giấy, lề và màu in giữa in tem dạng cuộn với in tem dạng tờ A4/A5.

### Cải tiến hiệu năng

- Tối ưu CSS print theo đúng khổ 148mm x 210mm và vùng in thực tế để trình in dựng trang ổn định hơn.
- Áp dụng guard bố cục cho bảng/hình ảnh nhằm giảm reflow và hạn chế phải căn chỉnh thủ công trước khi in.
- Chuẩn hóa metadata auto-update để quy trình kiểm tra phiên bản, kích thước và hash installer cho x64/ia32 rõ ràng hơn.

### Lưu ý quan trọng

- Windows 10/11 64-bit nên dùng `banhangoffline-setup-v1.3.8-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn” nên dùng `banhangoffline-setup-v1.3.8-ia32.exe`.
- Chỉ tải bộ cài từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới.

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
