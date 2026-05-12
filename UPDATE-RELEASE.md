# Hướng dẫn phát hành và cập nhật ứng dụng Windows

Tài liệu này mô tả quy trình phát hành ứng dụng Electron Windows qua GitHub Releases bằng `electron-builder` + `electron-updater`.

> Cấu hình production hiện tại dùng GitHub repo public `Vankhadev/phanmemoffline`. Cơ chế auto-update chính dùng provider generic của `electron-updater` để đọc trực tiếp `latest.yml` từ GitHub Release latest, không phụ thuộc endpoint `releases.atom`.

## Tổng quan cơ chế cập nhật hiện tại

- Main process dùng `electron-updater` với provider generic trỏ tới `https://github.com/Vankhadev/phanmemoffline/releases/latest/download/`, không còn dùng manifest JSON custom làm cơ chế startup chính và không phụ thuộc `releases.atom`.
- App chỉ tự kiểm tra cập nhật sau khi Electron `app.whenReady()` xong và cửa sổ chính đã hiển thị.
- Bản development/unpacked không tự auto-update. Nếu cần test có chủ đích, bật `KHA_ENABLE_ELECTRON_UPDATER=1` hoặc `KHA_FORCE_AUTO_UPDATE=1`.
- `autoDownload` được tắt mặc định ở updater, nhưng startup check của app sẽ tự tải bản mới sau khi phát hiện update để chuẩn bị sẵn cho người dùng.
- `autoInstallOnAppQuit` bị tắt để tránh tự cài khi người dùng thoát app.
- Khi tải xong, app hiển thị dialog tiếng Việt với hai nút:
  - `Cập nhật ngay`: backup database runtime rồi gọi `autoUpdater.quitAndInstall(false, true)`.
  - `Để sau`: không restart/cài đặt, app tiếp tục chạy bình thường.
- Trạng thái check/download/downloaded/error vẫn được gửi sang renderer qua IPC `kha:update:*` để UI hiện tại tiếp tục hoạt động.
- Log cập nhật được ghi tại `userData/logs/update.log`, gồm các bước cấu hình feed, check, download, dialog, backup, install và lỗi mạng. Log được redacted, không ghi token, cookie, authorization header, query token hoặc response header nhạy cảm.
- Trước khi cài đặt, ứng dụng backup database runtime `phanmienoffline.db.json` trong userData sang `userData/backups`.
- Repo/release asset dùng cho update phải truy cập được ẩn danh. Nếu GitHub repo private, owner/repo sai, thiếu release, thiếu `latest.yml`, token publish sai/thiếu quyền hoặc asset yêu cầu đăng nhập, máy khách không có token thường nhận 401/403/404 và sẽ không có dialog cập nhật. Không hard-code GitHub token vào app; hãy dùng release/feed public hoặc kênh tải public riêng.

## Asset GitHub Release bắt buộc cho electron-updater

Mỗi release production cho Windows cần có các asset do `electron-builder` tạo:

| Asset | Bắt buộc | Mục đích |
|---|---:|---|
| `BanHangOffline-Setup-vVERSION.exe` | Có | Installer NSIS Windows. |
| `BanHangOffline-Setup-vVERSION.exe.blockmap` | Có | Dữ liệu differential download/kiểm tra gói cập nhật. |
| `latest.yml` | Có | Metadata chuẩn để `electron-updater` biết version, file, size, sha512 và releaseDate. |
| `update-manifest.json` | Không bắt buộc cho cơ chế mới | Legacy manifest custom, vẫn upload để tương thích/tự kiểm tra thủ công nếu cần. |

Ví dụ `latest.yml` do `electron-builder` tạo:

```yaml
version: 1.2.2
files:
  - url: BanHangOffline-Setup-v1.2.2.exe
    sha512: BASE64_SHA512
    size: 76845764
path: BanHangOffline-Setup-v1.2.2.exe
sha512: BASE64_SHA512
releaseDate: '2026-05-09T13:52:51.450Z'
```

## Cấu hình production trong package.json

Cấu hình chính nằm trong `package.json`:

```json
{
  "build": {
    "appId": "com.vankhammo.phanmienoffline",
    "productName": "Ban hang offline - Van kha mmo",
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": ["x64"]
        }
      ]
    },
    "nsis": {
      "artifactName": "BanHangOffline-Setup-v${version}.exe",
      "oneClick": false,
      "perMachine": false,
      "allowElevation": true,
      "allowToChangeInstallationDirectory": true
    },
    "publish": [
      {
        "provider": "generic",
        "url": "https://github.com/Vankhadev/phanmemoffline/releases/latest/download/",
        "channel": "latest"
      }
    ]
  },
  "khaUpdate": {
    "provider": "github",
    "owner": "Vankhadev",
    "repo": "phanmemoffline",
    "latestYmlUrl": "https://github.com/Vankhadev/phanmemoffline/releases/latest/download/latest.yml",
    "latestYmlBaseUrl": "https://github.com/Vankhadev/phanmemoffline/releases/latest/download/"
  }
}
```

`electron-builder` dùng cấu hình `publish` để tạo `resources/app-update.yml` trong app đã đóng gói. Với provider generic, `electron-updater` đọc trực tiếp `latest.yml` ở URL public và resolve installer/blockmap tương đối theo cùng thư mục `/releases/latest/download/`, nhờ đó tránh lỗi từ endpoint `releases.atom`.

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
5. Chạy build frontend và NSIS installer; `electron-builder` tạo `latest.yml` với version hiện tại.
6. Chạy `npm run generate:update-manifest` để tạo legacy `update-manifest.json`.
7. Kiểm tra tồn tại installer, blockmap, `latest.yml` và manifest legacy; in SHA256.
8. Upload asset lên GitHub Release bằng `secrets.GITHUB_TOKEN` mặc định:
   - `BanHangOffline-Setup-vVERSION.exe`
   - `BanHangOffline-Setup-vVERSION.exe.blockmap`
   - `latest.yml`
   - `update-manifest.json`
9. Kiểm tra truy cập ẩn danh tới `latest.yml`, installer và `.blockmap`. Bước này cố tình fail nếu URL public trả 401/403/404, vì client `electron-updater` trên máy khách không có `GITHUB_TOKEN` và không được nhúng token.

Không đưa token GitHub vào source. Workflow chỉ dùng `secrets.GITHUB_TOKEN` của GitHub Actions để upload release, không dùng cho máy khách.

## Quy trình phát hành version mới qua GitHub Actions

1. Đảm bảo cấu hình production vẫn trỏ tới repo thật `Vankhadev/phanmemoffline`.
2. Cập nhật version SemVer ở root:
   - `package.json`
   - `package-lock.json`
3. Nếu các package frontend/backend cũng đang duy trì version riêng, cập nhật tương ứng:
   - `frontend/package.json`
   - `frontend/package-lock.json`
   - `backend/package.json`
   - `backend/package-lock.json`
4. Commit thay đổi code/version.
5. Tạo tag khớp version root package:

```cmd
git tag v1.2.2
git push origin main --tags
```

6. GitHub Actions sẽ tự build và tạo/upload GitHub Release assets.
7. Sau khi workflow xong, mở Release trên GitHub và kiểm tra đủ asset:
   - Installer `.exe`
   - File `.exe.blockmap`
   - `latest.yml`
   - `update-manifest.json` nếu vẫn muốn giữ legacy manifest
8. Tải `latest.yml` từ Release và kiểm tra:
   - `version` đúng.
   - `path`/`files[0].url` trỏ tới installer cùng release.
   - `sha512` có giá trị.
   - `size` đúng dung lượng installer.
9. Mở các URL sau trong cửa sổ ẩn danh, không đăng nhập GitHub:
   - `https://github.com/Vankhadev/phanmemoffline/releases/latest/download/latest.yml`
   - `https://github.com/Vankhadev/phanmemoffline/releases/download/vVERSION/latest.yml`
   - `https://github.com/Vankhadev/phanmemoffline/releases/download/vVERSION/BanHangOffline-Setup-vVERSION.exe`
   Nếu một trong các URL trả 401/403/404 thì bản cũ sẽ không tải được metadata/gói update và dialog cập nhật sẽ không xuất hiện. 404 có thể là repo private, owner/repo sai, release latest chưa có, release draft/prerelease không phù hợp, thiếu asset hoặc URL/feed sai.

## Publish từ máy dev nếu cần

Chỉ dùng khi thật sự cần publish thủ công từ máy dev. Không hard-code token vào source và không ghi token ra log.

Trên Windows cmd, build local trước:

```cmd
npm run build:frontend
npm run build:installer
npm run generate:update-manifest
```

Sau đó tạo release/tag `v1.2.2` và upload các asset sau bằng GitHub UI hoặc GitHub CLI đã đăng nhập sẵn:

```cmd
gh release create v1.2.2 release/BanHangOffline-Setup-v1.2.2.exe release/BanHangOffline-Setup-v1.2.2.exe.blockmap release/latest.yml release/update-manifest.json --title "BanHangOffline v1.2.2" --generate-notes --latest
```

Lưu ý:

- GitHub CLI/token cục bộ cần có quyền tạo/cập nhật GitHub Release trong repo `Vankhadev/phanmemoffline`, nhưng token không được commit vào source.
- Không chạy publish thủ công nếu chưa chắc version/tag đúng.
- Nếu chỉ cần build local để test installer, dùng `npm run build` hoặc `npm run build:installer`, không cần token GitHub.

## Test cập nhật

Test nên thực hiện trên máy thật/VM Windows đang cài phiên bản cũ, không test bằng bản development/unpacked.

1. Cài version cũ bằng installer NSIS. Nếu máy đang chạy bản `1.1.1`, cần nhớ bản đó dùng luồng updater đã được build vào `1.1.1`; các sửa đổi trong bản mới chỉ có hiệu lực sau khi người dùng cài installer/bản update mới hơn.
2. Publish GitHub Release version mới có đủ `.exe`, `.blockmap`, `latest.yml` và các asset truy cập ẩn danh được.
3. Mở app version cũ.
4. Đợi startup check hoặc vào `Cài đặt > Cập nhật > Kiểm tra cập nhật`.
5. Xác nhận UI hiển thị feed GitHub Release `latest.yml` trực tiếp, không còn gọi `releases.atom`.
6. Xác nhận UI hiển thị bản mới, release notes nếu có và dung lượng.
7. Theo dõi tiến trình tải.
8. Khi tải xong, xác nhận dialog hiển thị nút `Cập nhật ngay` và `Để sau`.
9. Chọn `Để sau`: app phải tiếp tục chạy, không restart/cài đặt.
10. Mở lại thao tác cài đặt hoặc tải lại nếu cần, chọn `Cập nhật ngay`: app backup database rồi restart/cài đặt qua `electron-updater`.
11. Sau khi cập nhật xong, mở app và kiểm tra version mới, database, cấu hình người dùng và localStorage vẫn còn.

## Legacy custom manifest

Dự án vẫn giữ script `scripts/generate-update-manifest.js` và asset `update-manifest.json` để tương thích tài liệu/tooling cũ. Cơ chế startup chính hiện tại không đọc manifest JSON này.

Nếu cần dùng legacy manifest cho test nội bộ/tự động hóa cũ:

```cmd
npm run generate:update-manifest
```

Manifest legacy vẫn gồm `version`, `url`, `sha256`, `releaseNotes`, `releaseDate`, `platform`, `arch`, `size`, `mandatory`, `installerType`. Không dùng manifest legacy để thay thế `latest.yml` cho `electron-updater` production.

## Rollback

- Nếu release bị lỗi trước khi nhiều máy cập nhật: đánh dấu Release cũ là latest hoặc publish release mới có version cao hơn để app nhận bản sửa.
- Nếu `latest.yml` sai hoặc thiếu asset: upload lại đúng `latest.yml`, `.exe`, `.blockmap` vào GitHub Release latest.
- Không phát hành lại cùng version cho installer khác nội dung nếu người dùng đã tải trước đó; nên tăng patch version để tránh cache và nhầm checksum.
- Nếu cần khôi phục dữ liệu local trên máy người dùng, dùng backup trong `userData/backups` được tạo trước khi cài đặt cập nhật.

## Lưu ý bảo toàn dữ liệu

- Không đổi rule `electron-builder` đang loại trừ `*.db`, `*.db.json`, `*.sql` khỏi installer.
- Không bundle database runtime vào installer.
- Runtime database của bản Electron nằm trong userData theo biến `KHA_DB_PATH` và file `phanmienoffline.db.json`.
- Cập nhật qua NSIS/electron-updater không truyền tham số xóa dữ liệu ứng dụng.
- Trước khi gọi `quitAndInstall`, app tạo bản sao database trong `userData/backups` nếu file database tồn tại.
- localStorage và cấu hình renderer nằm trong userData/session data của Electron; installer/update không được xóa userData.
- Nếu cần migration dữ liệu trong tương lai, migration phải chạy idempotent và backup trước khi sửa dữ liệu.

## Kiểm tra khuyến nghị cho mỗi release

- Kiểm tra cú pháp main process/updater/preload và script manifest bằng Node.
- Chạy `npm run build:frontend` nếu có thay đổi renderer/preload liên quan UI.
- Chạy `npm run build:installer` hoặc `npm run build` để xác nhận `electron-builder` tạo installer, `.blockmap`, `latest.yml`.
- Chạy `npm run generate:update-manifest` nếu vẫn upload legacy manifest.
- Test mất mạng hoặc GitHub Release thiếu `latest.yml`: UI/log phải báo lỗi nhưng app không crash.
- Test hủy tải khi đang downloading.
- Test lựa chọn `Để sau`: app không restart/cài đặt.
- Test lựa chọn `Cập nhật ngay`: app backup database rồi cài đặt/restart.
- Kiểm tra `userData/logs/update.log` khi cần debug.
