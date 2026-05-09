# Hướng dẫn phát hành và cập nhật ứng dụng Windows

Tài liệu này mô tả quy trình phát hành ứng dụng Electron Windows qua GitHub Releases bằng `electron-builder` + `electron-updater`.

> Cấu hình production hiện tại dùng GitHub repo public `Vankhadev/phanmemoffline`. Cơ chế auto-update chính đọc `latest.yml` từ GitHub Release latest của repo này.

## Tổng quan cơ chế cập nhật hiện tại

- Main process dùng `electron-updater`, không còn dùng manifest JSON custom làm cơ chế startup chính.
- App chỉ tự kiểm tra cập nhật sau khi Electron `app.whenReady()` xong và cửa sổ chính đã hiển thị.
- Bản development/unpacked không tự auto-update. Nếu cần test có chủ đích, bật `KHA_ENABLE_ELECTRON_UPDATER=1` hoặc `KHA_FORCE_AUTO_UPDATE=1`.
- `autoDownload` được tắt mặc định ở updater, nhưng startup check của app sẽ tự tải bản mới sau khi phát hiện update để chuẩn bị sẵn cho người dùng.
- `autoInstallOnAppQuit` bị tắt để tránh tự cài khi người dùng thoát app.
- Khi tải xong, app hiển thị dialog tiếng Việt với hai nút:
  - `Cập nhật ngay`: backup database runtime rồi gọi `autoUpdater.quitAndInstall(false, true)`.
  - `Để sau`: không restart/cài đặt, app tiếp tục chạy bình thường.
- Trạng thái check/download/downloaded/error vẫn được gửi sang renderer qua IPC `kha:update:*` để UI hiện tại tiếp tục hoạt động.
- Log cập nhật được ghi tại `userData/logs/update.log`, gồm các bước cấu hình feed, check, download, dialog, backup, install và lỗi mạng. Log không ghi token/mật khẩu.
- Trước khi cài đặt, ứng dụng backup database runtime `phanmienoffline.db.json` trong userData sang `userData/backups`.

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
version: 1.1.3
files:
  - url: BanHangOffline-Setup-v1.1.3.exe
    sha512: BASE64_SHA512
    size: 76845764
path: BanHangOffline-Setup-v1.1.3.exe
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
        "provider": "github",
        "owner": "Vankhadev",
        "repo": "phanmemoffline",
        "releaseType": "release"
      }
    ]
  }
}
```

`electron-builder` dùng cấu hình `publish` để tạo `resources/app-update.yml` trong app đã đóng gói và để `electron-updater` biết GitHub owner/repo.

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
6. Chạy `npm run generate:update-manifest` để tạo legacy `update-manifest.json`.
7. Kiểm tra tồn tại installer, blockmap, `latest.yml` và manifest legacy; in SHA256.
8. Upload asset lên GitHub Release bằng `secrets.GITHUB_TOKEN` mặc định:
   - `BanHangOffline-Setup-vVERSION.exe`
   - `BanHangOffline-Setup-vVERSION.exe.blockmap`
   - `latest.yml`
   - `update-manifest.json`

Không đưa token GitHub vào source. Workflow chỉ dùng `secrets.GITHUB_TOKEN` của GitHub Actions.

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
git tag v1.1.4
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

## Publish từ máy dev nếu cần

Chỉ dùng khi thật sự cần publish thủ công từ máy dev. Không hard-code token vào source.

Trên Windows cmd:

```cmd
set GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
npm run build:frontend
npx electron-builder --win nsis --publish always
```

Lưu ý:

- `GH_TOKEN` cần có quyền tạo/cập nhật GitHub Release trong repo `Vankhadev/phanmemoffline`.
- Lệnh `--publish always` sẽ upload asset lên GitHub Release theo tag/version hiện tại; không chạy nếu chưa chắc version/tag đúng.
- Không commit token, không ghi token vào file cấu hình.
- Nếu chỉ cần build local để test installer, dùng `npm run build` hoặc `npm run build:installer`, không cần `GH_TOKEN`.

## Test cập nhật

Test nên thực hiện trên máy thật/VM Windows đang cài phiên bản cũ, không test bằng bản development/unpacked.

1. Cài version cũ bằng installer NSIS.
2. Publish GitHub Release version mới có đủ `.exe`, `.blockmap`, `latest.yml`.
3. Mở app version cũ.
4. Đợi startup check hoặc vào `Cài đặt > Cập nhật > Kiểm tra cập nhật`.
5. Xác nhận UI hiển thị feed GitHub Releases `latest.yml`.
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
