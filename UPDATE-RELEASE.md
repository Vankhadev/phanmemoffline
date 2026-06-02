# Hướng dẫn phát hành và cập nhật ứng dụng Windows

## Tổng quan cơ chế cập nhật hiện tại

- Ứng dụng production dùng [`electron-builder`](package.json:36) + [`electron-updater`](src/updater.js:6).
- Repo GitHub public: [`Vankhadev/phanmemoffline`](package.json:98).
- Luồng cập nhật chính đọc trực tiếp [`latest.yml`](src/updater.js:740) từ GitHub Release latest download, không phụ thuộc `releases.atom`.
- File manifest legacy [`release/update-manifest.json`](release/update-manifest.json:1) vẫn được giữ để tooling ngoài app có thể đọc SHA256/size theo từng kiến trúc.
- Bản Windows phát hành cả hai kiến trúc: `x64` và `ia32`. Tên asset luôn có hậu tố kiến trúc để tránh người dùng Windows 32-bit tải nhầm bản x64.

## Bảng phát hành chính thức v1.4.4

| Hạng mục | Nội dung |
| --- | --- |
| Phiên bản | 1.4.4 |
| Ngày phát hành | 2026-06-02 |
| Kênh phát hành | GitHub Release latest cho Windows x64 và ia32 |
| Trạng thái | Sẵn sàng công bố cho người dùng |

### Ghi chú thay đổi tổng quan

Bản 1.4.4 là bản phát hành bảo trì, đồng bộ version canonical, tài liệu phát hành, tên asset và tag kiểm tra theo v1.4.4.

### Phát hành

- Đồng bộ version 1.4.4 trong package root, backend, frontend và các lockfile tương ứng.
- Cập nhật changelog, tài liệu release, manifest ví dụ, tên asset và tag kiểm tra theo v1.4.4.
- GitHub Actions build/publish bộ cài riêng cho Windows x64 và ia32 kèm latest.yml/update-manifest.json từ artifact thực tế sau khi push tag.

### QA và build

- Rà soát diff release để chỉ stage các tệp version/tài liệu thuộc phạm vi phát hành.
- Xác minh các tham chiếu version/tag current-release đã chuyển sang v1.4.4.
- Giữ nguyên metadata generated production nếu chưa có installer v1.4.4 để sinh SHA/size chính xác.

### Lưu ý quan trọng cho người dùng

- Windows 10/11 64-bit: dùng `banhangoffline-setup-v1.4.4-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn”: dùng `banhangoffline-setup-v1.4.4-ia32.exe`.
- Chỉ tải từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên file, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới.

## Asset GitHub Release bắt buộc

Khi phát hành version `1.4.4`, release cần tối thiểu các asset:

- `banhangoffline-setup-v1.4.4-x64.exe`
- `banhangoffline-setup-v1.4.4-x64.exe.blockmap`
- `banhangoffline-setup-v1.4.4-ia32.exe`
- `banhangoffline-setup-v1.4.4-ia32.exe.blockmap`
- `latest.yml`
- `update-manifest.json`

[`latest.yml`](release/latest.yml:1) là feed chính cho [`electron-updater`](src/updater.js:740). [`update-manifest.json`](release/update-manifest.json:1) chứa URL/SHA256/size cho cả `x64` và `ia32`.

## Build local trước khi publish

```cmd
npm ci
npm ci --prefix frontend
npm ci --prefix backend
npm run build:installer
```

Script [`build:installer`](package.json:29) sẽ:

1. Build frontend.
2. Đồng bộ icon desktop.
3. Build NSIS `x64` và `ia32`.
4. Sinh lại [`latest.yml`](scripts/generate-latest-yml.js:1).
5. Sinh lại [`update-manifest.json`](scripts/generate-update-manifest.js:1).

Nếu chỉ muốn build một kiến trúc để debug nội bộ:

```cmd
npm run package:installer:x64
npm run package:installer:ia32
```

Sau khi build một kiến trúc riêng, không publish release production cho tới khi đã build đủ cả `x64` và `ia32` rồi sinh metadata lại.

## Kiểm tra local bằng PowerShell

Chạy sau khi build đủ installer:

```cmd
powershell -ExecutionPolicy Bypass -File scripts/verify-windows-release.ps1 -Mode local -Arch x64,ia32
```

Script [`verify-windows-release.ps1`](scripts/verify-windows-release.ps1:1) kiểm tra:

- File installer và `.blockmap` tồn tại.
- [`latest.yml`](release/latest.yml:1) và [`update-manifest.json`](release/update-manifest.json:1) cùng version.
- Tên asset có hậu tố `-x64.exe` hoặc `-ia32.exe`.
- Kích thước không rỗng/truncate.
- Header `MZ` và signature `PE` hợp lệ.
- Machine type PE khớp `ia32` cho bản 32-bit.
- SHA256 khớp manifest.

## Publish qua GitHub Actions

Tag release theo version trong [`package.json`](package.json:3):

```cmd
git tag v1.4.4
git push origin main --tags
```

Workflow [`release-windows.yml`](.github/workflows/release-windows.yml:1) sẽ build/publish các asset `x64`, `ia32`, [`latest.yml`](release/latest.yml:1) và [`update-manifest.json`](release/update-manifest.json:1), sau đó verify anonymous access.

## Publish thủ công bằng GitHub CLI nếu cần

Chỉ chạy sau khi local verify thành công:

```cmd
gh release create v1.4.4 release/banhangoffline-setup-v1.4.4-x64.exe release/banhangoffline-setup-v1.4.4-x64.exe.blockmap release/banhangoffline-setup-v1.4.4-ia32.exe release/banhangoffline-setup-v1.4.4-ia32.exe.blockmap release/latest.yml release/update-manifest.json --title "BanHangOffline v1.4.4" --generate-notes --latest
```

Nếu release đã tồn tại, dùng `gh release upload v1.4.4 ... --clobber` có chủ đích sau khi kiểm tra file đúng.

## Kiểm tra remote sau khi publish

```cmd
powershell -ExecutionPolicy Bypass -File scripts/verify-windows-release.ps1 -Mode remote -Version 1.4.4 -Tag v1.4.4 -Arch x64,ia32
```

Remote verify cần xác nhận:

- HTTP `200` cho [`latest.yml`](release/latest.yml:1), [`update-manifest.json`](release/update-manifest.json:1) và hai installer.
- `Content-Type` không phải HTML.
- `Content-Length` khớp manifest nếu server trả header.
- File tải về có header `MZ/PE` và SHA256 khớp manifest.

## Hướng dẫn cho người dùng phổ thông

- Máy Windows 10/11 thông thường: tải `banhangoffline-setup-v1.4.4-x64.exe`.
- Máy Windows 32-bit hoặc báo lỗi “Ứng dụng này không thể chạy trên PC của bạn”: tải `banhangoffline-setup-v1.4.4-ia32.exe`.
- Chỉ tải từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`.
- Nếu trình duyệt/SmartScreen/antivirus cảnh báo, kiểm tra tên file và nguồn tải trước. Không chạy file nếu tên không đúng `banhangoffline-setup-v1.4.4-x64.exe` hoặc `banhangoffline-setup-v1.4.4-ia32.exe`.
- Nếu tải được file rất nhỏ hoặc mở ra trang HTML, hãy xóa file đó và tải lại từ nút/link release chính thức.

## Test cập nhật trong app

- Mở ứng dụng production đã cài bằng NSIS.
- Vào màn [`Settings`](frontend/src/pages/Settings.jsx:1202) → tab cập nhật.
- Kiểm tra app hiển thị đúng nền tảng/kiến trúc runtime và bộ cài khuyến nghị.
- Bấm kiểm tra cập nhật để xác nhận feed [`latest.yml`](release/latest.yml:1) public hoạt động.
- Bấm tải/cài đặt và xác nhận app backup database trước khi restart.

## Rollback

- Nếu release lỗi, tạo tag và release mới thay thế, ví dụ `v1.4.4`.
- Không chỉnh tay metadata updater đã public nếu asset đã được cache rộng rãi.
- Nếu bắt buộc thay asset trong cùng tag, phải upload lại đồng bộ installer, blockmap, [`latest.yml`](release/latest.yml:1) và [`update-manifest.json`](release/update-manifest.json:1), rồi chạy remote verify lại.

## Checklist trước khi release

- [ ] `package.json`, `package-lock.json`, `backend/package.json`, `backend/package-lock.json`, `frontend/package.json`, `frontend/package-lock.json` cùng version.
- [ ] `npm run build:frontend` thành công.
- [ ] Build đủ installer x64 và ia32.
- [ ] `release/latest.yml` và `release/update-manifest.json` sinh từ artifact thực tế.
- [ ] `scripts/verify-windows-release.ps1 -Mode local -Arch x64,ia32` thành công.
- [ ] Tag Git khớp version trong package root.
- [ ] GitHub Actions publish đủ asset và remote verify thành công.
