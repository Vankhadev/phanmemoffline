# Hướng dẫn phát hành và cập nhật ứng dụng Windows

Tài liệu này mô tả quy trình phát hành ứng dụng Electron Windows qua GitHub Release public, dùng installer NSIS do Electron Builder tạo ra và manifest JSON do app tự đọc.

> Cấu hình production hiện tại dùng GitHub repo public `Vankhadev/phanmemoffline`; app mặc định đọc manifest từ GitHub Release latest của repo này.

## Tổng quan cơ chế cập nhật

- Mặc định app đọc manifest tại `https://github.com/Vankhadev/phanmemoffline/releases/latest/download/update-manifest.json`.
- Có thể override feed khi test nội bộ bằng biến môi trường `KHA_UPDATE_MANIFEST_URL`, `KHA_UPDATE_FEED_URL`, hoặc file `update-config.json`/`kha-update-config.json` trong userData. Khi chạy development, có thể đặt file cấu hình ở thư mục gốc repo.
- Main process tải manifest JSON, validate cấu trúc, so sánh version SemVer với version hiện tại và gửi trạng thái qua IPC an toàn cho renderer.
- Renderer chỉ có API hẹp qua preload: lấy thông tin ứng dụng, kiểm tra update, tải, hủy tải, cài đặt và nhận trạng thái/progress. Không expose filesystem hoặc shell tùy ý.
- Installer được tải vào `userData/update-cache`, tính SHA256 và chỉ được chạy khi checksum khớp tuyệt đối.
- Log cập nhật được ghi bền vững tại `userData/logs/update.log`, gồm các bước resolve feed, fetch manifest, download/copy installer, checksum, backup database, spawn installer và lỗi mạng. Log không ghi token/mật khẩu.
- Trước khi chạy installer, ứng dụng backup database runtime `phanmienoffline.db.json` trong userData sang `userData/backups`.
- Bộ cài NSIS chạy ở chế độ assisted mặc định. App không truyền tham số xóa app data và sẽ thoát sau khi spawn installer thành công.

## Manifest update feed GitHub Release

Manifest là JSON object có các trường tối thiểu:

| Trường | Bắt buộc | Mô tả |
|---|---:|---|
| `version` | Có | Phiên bản SemVer hợp lệ, ví dụ `1.1.3`. |
| `url` | Có | URL HTTPS tới installer GitHub Release asset. Test nội bộ vẫn có thể dùng file URL hoặc đường dẫn local tuyệt đối. |
| `sha256` | Có | SHA256 hex 64 ký tự của installer. |
| `releaseNotes` | Có | Ghi chú phát hành dạng chuỗi hoặc mảng chuỗi. |
| `releaseDate` | Có | Thời điểm phát hành dạng ISO 8601. |
| `platform` | Không | Ví dụ `win32`; nếu có thì app chỉ nhận manifest đúng platform. |
| `arch` | Không | Ví dụ `x64`; nếu có thì app chỉ nhận manifest đúng kiến trúc. |
| `size` | Không | Dung lượng installer tính theo byte, dùng để hiển thị UI. |
| `mandatory` | Không | `true` nếu muốn đánh dấu bản cập nhật bắt buộc trên UI. |
| `installerType` | Không | Ví dụ `nsis`. |

Ví dụ production qua GitHub Release:

```json
{
  "version": "1.1.3",
  "url": "https://github.com/Vankhadev/phanmemoffline/releases/download/v1.1.3/BanHangOffline-Setup-v1.1.3.exe",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "releaseNotes": "- Cập nhật ứng dụng lên phiên bản 1.1.3.",
  "releaseDate": "2026-05-09T00:00:00.000Z",
  "platform": "win32",
  "arch": "x64",
  "size": 76817873,
  "mandatory": false,
  "installerType": "nsis"
}
```

Manifest mẫu nằm tại `release/update-manifest.example.json`. Manifest production được tạo bằng script `npm run generate:update-manifest` và được upload lên Release asset với tên `update-manifest.json`.

## Cấu hình GitHub production

Cấu hình hiện tại nằm trong `package.json`:

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Vankhadev/phanmemoffline.git"
  },
  "khaUpdate": {
    "provider": "github",
    "owner": "Vankhadev",
    "repo": "phanmemoffline",
    "manifestUrl": "https://github.com/Vankhadev/phanmemoffline/releases/latest/download/update-manifest.json",
    "assetBaseUrl": "https://github.com/Vankhadev/phanmemoffline/releases/download"
  }
}
```

Nếu cần test repo khác, chỉ override bằng biến môi trường hoặc file cấu hình local; cấu hình production mặc định phải tiếp tục trỏ tới `Vankhadev/phanmemoffline`.

## Override feed để test nội bộ

Ví dụ file `update-config.json` trong userData hoặc thư mục gốc khi development:

```json
{
  "manifestUrl": "https://github.com/Vankhadev/phanmemoffline/releases/latest/download/update-manifest.json"
}
```

Test local bằng file URL hoặc đường dẫn tuyệt đối tới manifest JSON:

```json
{
  "manifestUrl": "file:///G:/phanmienoffline/release/update-manifest.json"
}
```

Có thể dùng biến môi trường trên Windows cmd:

```cmd
set KHA_UPDATE_MANIFEST_URL=file:///G:/phanmienoffline/release/update-manifest.json&& npm run dev:electron
```

## Script tạo manifest production

Script `scripts/generate-update-manifest.js` đọc version từ `package.json`, tìm installer `release/BanHangOffline-Setup-vVERSION.exe`, tính SHA256, lấy size và ghi `release/update-manifest.json`.

Chạy sau khi build installer:

```cmd
npm run generate:update-manifest
```

Các biến môi trường có thể dùng khi cần:

| Biến | Mục đích |
|---|---|
| `KHA_UPDATE_OWNER` | Override GitHub owner. |
| `KHA_UPDATE_REPO` | Override GitHub repo. |
| `KHA_UPDATE_REPOSITORY` | Override dạng `owner/repo`. |
| `KHA_RELEASE_TAG` | Override tag release, mặc định `vVERSION`. |
| `KHA_RELEASE_NOTES` | Ghi chú phát hành đưa vào manifest. |
| `KHA_RELEASE_DATE` | ISO release date, mặc định thời điểm chạy script. |
| `KHA_UPDATE_INSTALLER` | Đường dẫn installer khác mặc định. |
| `KHA_UPDATE_ASSET_URL` | Override URL asset đầy đủ. |
| `KHA_UPDATE_MANDATORY` | `true`/`false` cho trường mandatory. |

Script sẽ fail rõ nếu installer không tồn tại hoặc version không hợp lệ.

## GitHub Actions release Windows

Workflow nằm tại `.github/workflows/release-windows.yml`.

Trigger:

- Push tag dạng `v*.*.*`.
- `workflow_dispatch` để chạy thủ công.

Workflow thực hiện:

1. Checkout source.
2. Setup Node.js trên `windows-latest`.
3. Chạy `npm ci` ở root và frontend.
4. Kiểm tra tag `vX.Y.Z` khớp `package.json.version`.
5. Chạy `npm run build` để build frontend và NSIS installer.
6. Chạy `npm run generate:update-manifest`.
7. Kiểm tra tồn tại installer, blockmap và manifest; in SHA256.
8. Upload các asset lên GitHub Release bằng `GITHUB_TOKEN` mặc định:
   - `BanHangOffline-Setup-vVERSION.exe`
   - `BanHangOffline-Setup-vVERSION.exe.blockmap`
   - `update-manifest.json`

Không đưa token GitHub vào source. Workflow chỉ dùng `secrets.GITHUB_TOKEN` mặc định của GitHub Actions.

## Quy trình phát hành version mới

1. Đảm bảo cấu hình production vẫn trỏ tới repo thật `Vankhadev/phanmemoffline`.
2. Cập nhật version SemVer ở các package liên quan:
   - `package.json`
   - `package-lock.json`
   - `frontend/package.json`
   - `frontend/package-lock.json`
   - `backend/package.json`
   - `backend/package-lock.json`
3. Cập nhật ghi chú phát hành hoặc chuẩn bị biến `KHA_RELEASE_NOTES` cho script.
4. Commit thay đổi code/version.
5. Tạo tag khớp version root package:

```cmd
git tag v1.1.3
git push origin main --tags
```

6. GitHub Actions sẽ tự build và tạo/upload GitHub Release assets.
7. Sau khi workflow xong, mở Release trên GitHub và kiểm tra đủ asset:
   - Installer `.exe`
   - File `.exe.blockmap`
   - `update-manifest.json`
8. Tải `update-manifest.json` từ Release, kiểm tra:
   - `version` đúng.
   - `url` trỏ tới asset `.exe` cùng tag.
   - `sha256` khớp installer.
   - `size` đúng dung lượng installer.
9. Kiểm tra SHA256 độc lập nếu cần:

```powershell
Get-FileHash .\release\BanHangOffline-Setup-v1.1.3.exe -Algorithm SHA256
```

10. Test cập nhật từ máy/VM đang cài version cũ:
    - Mở app bản cũ.
    - Đợi startup check hoặc vào Cài đặt > Cập nhật > Kiểm tra cập nhật.
    - Xác nhận UI hiển thị GitHub Release feed mặc định hoặc feed override đang dùng.
    - Xác nhận UI hiển thị bản mới, release notes, dung lượng và SHA256.
    - Tải update, theo dõi progress.
    - Xác nhận checksum pass và nút cài đặt khả dụng.
    - Bấm cài đặt, xác nhận app backup database rồi mở installer.
    - Cài xong, mở lại app và kiểm tra version mới, database, cấu hình người dùng và localStorage vẫn còn.

## Rollback

- Nếu release bị lỗi trước khi nhiều máy cập nhật: đánh dấu Release cũ là latest hoặc publish release mới có version cao hơn để app nhận bản sửa.
- Nếu manifest sai SHA256/URL: upload lại `update-manifest.json` đúng vào Release latest. App sẽ không chạy installer nếu checksum không khớp.
- Không phát hành lại cùng version cho installer khác nội dung nếu người dùng đã tải trước đó; nên tăng patch version để tránh cache và nhầm checksum.
- Nếu cần khôi phục dữ liệu local trên máy người dùng, dùng backup trong `userData/backups` được tạo trước khi mở installer.

## Lưu ý bảo toàn dữ liệu

- Không đổi rule Electron Builder đang loại trừ `*.db`, `*.db.json`, `*.sql` khỏi installer.
- Không bundle database runtime vào installer.
- Runtime database của bản Electron nằm trong userData theo biến `KHA_DB_PATH` và file `phanmienoffline.db.json`.
- Cập nhật qua NSIS không truyền tham số xóa dữ liệu ứng dụng.
- Trước khi spawn installer, app tạo bản sao database trong `userData/backups` nếu file database tồn tại.
- localStorage và cấu hình renderer nằm trong userData/session data của Electron; installer assisted không được xóa userData.
- Nếu cần migration dữ liệu trong tương lai, migration phải chạy idempotent và backup trước khi sửa dữ liệu.

## Kiểm tra khuyến nghị cho mỗi release

- Kiểm tra cú pháp main process/updater/preload và script manifest bằng Node.
- Chạy `npm run generate:update-manifest` sau khi build installer.
- Chạy `npm run build:frontend` nếu có thay đổi frontend.
- Test manifest local bằng file URL hoặc đường dẫn tuyệt đối.
- Test URL GitHub Release latest download khi Release public đã có manifest.
- Test checksum sai: sửa một ký tự `sha256` trong manifest và xác nhận app xóa installer, không chạy bộ cài.
- Test mất mạng hoặc URL sai: UI phải hiển thị lỗi nhưng startup không bị block.
- Test hủy tải khi đang downloading.
- Test nâng cấp từ version cũ lên version mới trên máy thật/VM Windows.
- Kiểm tra `userData/logs/update.log` khi cần debug.
