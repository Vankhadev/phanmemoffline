# Phan mem offline

## Phiên bản hiện tại: 1.4.0

Ứng dụng quản lý bán hàng offline gồm:

- Backend Node.js/Express dùng JSON file database.
- Frontend React/Vite cho nghiệp vụ bán hàng, kho, khách hàng, nhập hàng, báo cáo, sổ quỹ, bảng lương, mẫu in và thiết lập.
- Desktop Electron đóng gói frontend và tự khởi động backend nội bộ khi chạy bản cài đặt.

## Nghiệp vụ chính

- Quản lý bán hàng offline, khách hàng, công nợ, kho, nhập hàng và báo cáo.
- Hỗ trợ dữ liệu pending/offline ở frontend bằng localStorage và đồng bộ lại qua API sync chung khi backend sẵn sàng.
- Đồng bộ/pull/push dữ liệu chính qua backend hiện tại, không phụ thuộc module mobile riêng.

## Cài đặt dependencies

Từ root `g:/phanmienoffline`:

```cmd
npm install
cd frontend && npm install
cd ..\backend && npm install
cd ..
```

## Chạy local web

```cmd
npm run dev
```

Mặc định:

- Frontend web: `http://127.0.0.1:5174`
- Backend API: `http://127.0.0.1:3001/api`
- Backend health: `http://127.0.0.1:3001/api/health`

Có thể dùng thêm `start-web.bat` trên Windows để tự kiểm tra health và mở terminal backend/frontend riêng.

## Chạy desktop Electron dev

Chạy backend + frontend trước:

```cmd
npm run dev
```

Sau đó mở terminal khác ở root:

```cmd
npm run dev:electron
```

Trong bản desktop, Electron khởi động backend nội bộ trước. Nếu backend không health check thành công, ứng dụng dừng và hiển thị lỗi thay vì mở UI không kết nối được dữ liệu.

## Build và đóng gói desktop

```cmd
npm run build:frontend
npm run build:installer
npm run build:portable
npm run build:all
```

Các script `build:installer`, `build:portable` và `build:all` luôn build lại frontend trước khi đóng gói để tránh dùng `frontend/dist` thiếu hoặc stale.

Bản Windows production hiện tạo installer riêng theo kiến trúc:

- `release/banhangoffline-setup-v1.4.0-x64.exe` cho Windows 64-bit.
- `release/banhangoffline-setup-v1.4.0-ia32.exe` cho Windows 32-bit.

Sau khi build installer, script sẽ sinh lại [`latest.yml`](release/latest.yml:1) và [`update-manifest.json`](release/update-manifest.json:1). Có thể kiểm tra local bằng:

```cmd
powershell -ExecutionPolicy Bypass -File scripts/verify-windows-release.ps1 -Mode local -Arch x64,ia32
```

Các script nội bộ `package:installer` và `package:portable` chỉ gọi Electron Builder trực tiếp; chỉ dùng khi đã có `frontend/dist` hợp lệ.

## Tải và cài đặt trên Windows

- Máy Windows 10/11 thông thường: tải file có hậu tố `-x64.exe` từ GitHub Release mới nhất.
- Máy Windows 32-bit hoặc gặp thông báo “Ứng dụng này không thể chạy trên PC của bạn”: tải file có hậu tố `-ia32.exe`.
- Chỉ tải từ release chính thức của [`Vankhadev/phanmemoffline`](package.json:98). Nếu file tải về rất nhỏ, không có đuôi `.exe`, hoặc mở ra trang web/HTML, hãy xóa file và tải lại.
- Nếu SmartScreen/antivirus cảnh báo, kiểm tra đúng tên file và nguồn tải trước khi chọn tiếp tục.

## Cấu hình runtime quan trọng

Backend hỗ trợ các biến môi trường chính:

- `KHA_BACKEND_HOST`, `PHANMEM_HOST`, `HOST`
- `KHA_BACKEND_PORT`, `PHANMEM_PORT`, `PORT`
- `KHA_DB_PATH`, `DB_PATH`, `DATABASE_PATH`
- `KHA_SESSION_SECRET`, `SESSION_SECRET`
- `KHA_SESSION_SECRET_FILE`
- `KHA_SESSION_TTL_DAYS`

Nếu không cấu hình session secret, backend tự sinh secret mạnh và lưu vào `.kha-session-secret` cạnh file database runtime. File này không nên commit lên repository.

## Đồng bộ/offline hiện tại

Source hiện tại không có thư mục `frontend/src/mobile` hoặc route `backend/src/routes/mobile.js`. Tài liệu và vận hành cần dùng cơ chế thực tế đang có:

- Frontend lưu đơn pending/offline ở localStorage key `kha_pending_orders`.
- Frontend lưu khách hàng offline ở localStorage key `kha_offline_customers`.
- API sync chung nằm ở `/api/sync/versions`, `/api/sync/pull`, `/api/sync/push`.
- Backend mount sync trong `backend/src/routes/sync.js`.

Chi tiết xem `docs/offline-first-sync.md`.

## Tài liệu liên quan

- `HOW-TO-RUN.md`
- `UPDATE-RELEASE.md`
- `docs/offline-first-sync.md`
- Tài liệu nội bộ liên quan đến quy trình phát hành và cập nhật

## Lưu ý vận hành

- Luôn backup dữ liệu runtime trước khi phát hành bản mới.
- Không commit database runtime, file secret phiên, hoặc artifact build cá nhân.
- Kiểm tra lại updater sau khi đổi version hoặc artifact name.
