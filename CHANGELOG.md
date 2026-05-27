# Changelog

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
