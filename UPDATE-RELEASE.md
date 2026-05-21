# Hướng dẫn phát hành và cập nhật ứng dụng Windows

## Tổng quan cơ chế cập nhật hiện tại

- Ứng dụng production đang dùng [`electron-builder`](package.json:33) + [`electron-updater`](src/updater.js:1).
- Repo GitHub public: [`Vankhadev/phanmemoffline`](package.json:5).
- Luồng cập nhật chính đọc trực tiếp [`latest.yml`](src/updater.js:724) từ GitHub Release latest download, không phụ thuộc `releases.atom`.
- File manifest legacy [`release/update-manifest.json`](release/update-manifest.json:1) vẫn được giữ để tương thích với tooling cũ.

## Asset GitHub Release bắt buộc cho electron-updater

Khi phát hành một bản mới, cần upload tối thiểu các file sau vào GitHub Release:

- installer `banhangoffline-setup-v1.2.8.exe`
- `banhangoffline-setup-v1.2.8.exe.blockmap`
- `latest.yml`
- `update-manifest.json`

## Cấu hình production trong package.json

Cấu hình publish hiện tại trỏ về GitHub Release public download URL trong [`package.json`](package.json:85).

## GitHub Actions release Windows

- Tag release theo version mới, ví dụ `v1.2.8`.
- Job build phải tạo đúng tên artifact để `electron-updater` đọc được metadata.

## Quy trình phát hành version mới qua GitHub Actions

```cmd
git tag v1.2.8
git push origin main --tags
```

Sau đó tạo release/tag `v1.2.8` và upload các asset sau bằng GitHub UI hoặc GitHub CLI đã đăng nhập sẵn:

```cmd
gh release create v1.2.8 release/banhangoffline-setup-v1.2.8.exe release/banhangoffline-setup-v1.2.8.exe.blockmap release/latest.yml release/update-manifest.json --title "BanHangOffline v1.2.8" --generate-notes --latest
```

## Publish từ máy dev nếu cần

- Build installer bằng [`npm run build:installer`](package.json:27).
- Đảm bảo file version khớp với package root: [`package.json`](package.json:3).

## Test cập nhật

- Mở ứng dụng production đã đóng gói.
- Kiểm tra luồng tự động tải metadata từ `latest.yml`.
- Xác nhận không còn báo lỗi version mismatch.

## Legacy custom manifest

- File legacy manifest ở [`release/update-manifest.json`](release/update-manifest.json:1) cần giữ đồng bộ với version và URL release mới.
- Nếu chỉ dùng updater mới, file này vẫn có thể được giữ lại cho tooling ngoài ứng dụng.

## Rollback

- Nếu release lỗi, tạo một tag và release mới thay thế.
- Không chỉnh tay các metadata updater đã public nếu asset đã được cache rộng rãi.

## Lưu ý bảo toàn dữ liệu

- Luôn backup database trước khi cài bản cập nhật.
- Kiểm tra lộ trình update/install trong [`src/updater.js`](src/updater.js:724) trước khi phát hành.

## Kiểm tra khuyến nghị cho mỗi release

- [`package.json`](package.json:3)
- [`package-lock.json`](package-lock.json:3)
- [`frontend/package.json`](frontend/package.json:3)
- [`frontend/package-lock.json`](frontend/package-lock.json:3)
- [`backend/package.json`](backend/package.json:3)
- [`backend/package-lock.json`](backend/package-lock.json:3)
- [`README.md`](README.md:3)
- [`release/update-manifest.json`](release/update-manifest.json:1)
- [`release/update-manifest.example.json`](release/update-manifest.example.json:1)
- [`frontend/src/App.jsx`](frontend/src/App.jsx:434)
- [`frontend/src/pages/Settings.jsx`](frontend/src/pages/Settings.jsx:583)
- [`backend/src/routes/sapoSync.js`](backend/src/routes/sapoSync.js:70)
