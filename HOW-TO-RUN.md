# Hướng dẫn chạy ứng dụng local

Tài liệu này mô tả cách chạy hệ thống hiện tại trong workspace `g:/phanmienoffline`: backend Express, frontend Vite/React và ứng dụng desktop Electron. Tài liệu chỉ phản ánh source hiện có; không khôi phục hay giả định các route/module riêng không còn tồn tại trong cây source.

## 1. Yêu cầu

- Node.js bản LTS.
- `npm` đi kèm Node.js.
- Windows 10/11 nếu chạy các script `.bat` hoặc đóng gói desktop Windows.

---

## 2. Cài dependencies

Từ thư mục root `g:/phanmienoffline`:

```cmd
npm install
cd frontend && npm install
cd ..\backend && npm install
cd ..
```

---

## 3. Chạy nhanh backend + frontend web từ root

```cmd
npm run dev
```

Script này chạy song song:

- backend: `npm --prefix backend start`
- frontend dev server: `npm --prefix frontend run dev -- --host 127.0.0.1 --port 5174 --strictPort`

Địa chỉ mặc định:

- Frontend web: `http://127.0.0.1:5174`
- Backend health: `http://127.0.0.1:3001/api/health`
- Backend API base: `http://127.0.0.1:3001/api`

Nếu đang chạy backend test trên port khác, hãy export `KHA_BACKEND_PORT` trước khi chạy frontend hoặc [`npm run dev`](package.json:15). Ví dụ với backend local trên `3101`:

```cmd
set KHA_BACKEND_PORT=3101
npm run dev
```

Khi đó frontend dev server và Vite proxy sẽ cùng resolve API về `http://127.0.0.1:3101/api` thay vì fallback `3001`.

Có thể dùng `start-web.bat` nếu muốn script Windows tự kiểm tra health và mở các terminal backend/frontend riêng; script này cũng sẽ tôn trọng `KHA_BACKEND_PORT` nếu đã set sẵn.

---

## 4. Chạy từng phần thủ công

### Backend

```cmd
cd backend
npm start
```

Backend mặc định lắng nghe `127.0.0.1:3001`. Có thể cấu hình bằng các biến môi trường:

- `KHA_BACKEND_HOST` hoặc `PHANMEM_HOST` hoặc `HOST`
- `KHA_BACKEND_PORT` hoặc `PHANMEM_PORT` hoặc `PORT`
- `KHA_DB_PATH` để chỉ định file JSON database runtime
- `KHA_SESSION_SECRET` hoặc `SESSION_SECRET` để cấu hình secret phiên đăng nhập cố định
- `KHA_SESSION_SECRET_FILE` nếu muốn chỉ định file lưu secret phiên tự sinh

### Frontend

```cmd
cd frontend
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Frontend dev proxy các request `/api/*` về backend theo cấu hình trong [`frontend/vite.config.js`](frontend/vite.config.js). Port proxy ưu tiên `VITE_BACKEND_PORT`, sau đó `PHANMEM_PORT`, rồi `KHA_BACKEND_PORT`, và cuối cùng mới fallback `3001`.

Ngoài proxy, frontend hiện ưu tiên xác định API base local theo thứ tự sau:

- `VITE_API_BASE_URL` hoặc `VITE_API_BASE` nếu đã cấu hình.
- API base do Electron preload cung cấp khi chạy desktop.
- Fallback browser/local tới `http://<backend-host>:<backend-port>/api`.
  - Khi chạy local loopback hoặc mở build tĩnh qua `file://`, fallback mặc định là `http://127.0.0.1:3001/api` nếu không có env khác.
  - Khi truy cập qua LAN và không ép `VITE_BACKEND_HOST`, frontend sẽ giữ host hiện tại và chỉ thay port backend.

Nhờ vậy màn đăng nhập local không còn phụ thuộc hoàn toàn vào Vite proxy mới tới đúng backend.

---

## 5. Chạy desktop Electron trong môi trường dev

Chạy backend + frontend trước:

```cmd
npm run dev
```

Mở terminal khác ở root:

```cmd
npm run dev:electron
```

`dev:electron` dùng `ELECTRON_DEV_URL=http://127.0.0.1:5174` để Electron tải UI từ Vite dev server. Trong bản desktop, Electron sẽ tự khởi động backend nội bộ và chỉ mở UI sau khi backend health check thành công.

---

## 6. Build frontend và đóng gói desktop

Các script build desktop hiện luôn build mới frontend trước khi gọi Electron Builder:

```cmd
npm run build:frontend
npm run build:installer
npm run build:portable
npm run build:all
```

Ý nghĩa:

- `build:frontend`: tạo `frontend/dist`.
- `build:installer`: build frontend rồi đóng gói installer NSIS cho cả `x64` và `ia32`, sau đó sinh [`latest.yml`](release/latest.yml:1) và [`update-manifest.json`](release/update-manifest.json:1).
- `build:portable`: build frontend rồi đóng gói portable cho cả `x64` và `ia32`.
- `build:all`: build frontend một lần rồi đóng gói cả portable và NSIS cho cả hai kiến trúc.

File installer production nằm trong thư mục `release`:

- `banhangoffline-setup-v1.4.4-x64.exe`: dùng cho Windows 64-bit.
- `banhangoffline-setup-v1.4.4-ia32.exe`: dùng cho Windows 32-bit hoặc khi máy báo không chạy được bản x64.

Kiểm tra installer/manifest local bằng PowerShell:

```cmd
powershell -ExecutionPolicy Bypass -File scripts/verify-windows-release.ps1 -Mode local -Arch x64,ia32
```

Nếu cần gọi Electron Builder trực tiếp mà không build frontend, chỉ dùng các script nội bộ:

```cmd
npm run package:installer
npm run package:portable
```

Các script `package:*` chỉ nên dùng khi đã chắc chắn `frontend/dist` vừa được build và hợp lệ. Nếu gọi `package:*` trực tiếp, hãy chạy thêm [`npm run generate:latest-yml`](package.json:33) và [`npm run generate:update-manifest`](package.json:34) sau khi build đủ installer.

---

## 7. Cơ chế dữ liệu và phiên đăng nhập local

- Backend mặc định dùng JSON database trong `backend/data/phanmienoffline.db.json` khi chạy web local.
- Electron desktop đặt database runtime trong thư mục userData của ứng dụng bằng biến `KHA_DB_PATH`.
- Nếu không cấu hình `KHA_SESSION_SECRET`/`SESSION_SECRET`, backend tự tạo secret mạnh và lưu cạnh file database với tên `.kha-session-secret` để phiên đăng nhập ổn định qua các lần restart trên cùng môi trường.
- Không commit file database runtime hoặc file `.kha-session-secret` lên repository.
- Nếu DB local đã có sẵn admin hash nhưng không còn biết mật khẩu, có thể reset/seed lại admin local một cách tường minh bằng script dev-only:

```cmd
npm run reset-local-admin -- --yes --email admin.local@example.com --password Admin@123456 --name "Local Admin" --phone 0900000000
```

Hoặc gọi trực tiếp trong backend package:

```cmd
npm --prefix backend run reset-local-admin -- --yes --email admin.local@example.com --password Admin@123456
```

Script này chỉ sửa database local được chỉ định bởi `KHA_DB_PATH` hoặc mặc định `backend/data/phanmienoffline.db.json`, đồng thời revoke toàn bộ session cũ của admin được reset. Script không tự chạy trong runtime production.
- Khi cần chẩn đoán local login, có thể bật log tối thiểu bằng `KHA_DEBUG_AUTH=true` trước khi chạy backend. Backend sẽ log các mốc `bootstrap-status`, `bootstrap-admin-blocked`, `login-attempt`, `login-failed`, `login-succeeded`; frontend sẽ log cách resolve API base khi `VITE_DEBUG_AUTH=true`.

---

## 8. Đồng bộ/offline hiện tại

Source hiện tại không có thư mục module riêng cũ hay route backend chuyên dụng tương ứng. Cơ chế offline/sync đang tồn tại là:

- Frontend lưu đơn offline vào localStorage key `kha_pending_orders`.
- Frontend lưu khách hàng offline vào localStorage key `kha_offline_customers`.
- Khi online/focus hoặc sau đăng nhập, frontend gọi sync chung qua `/api/sync/pull` và `/api/sync/push`.
- Backend xử lý sync trong `backend/src/routes/sync.js` và tạo hóa đơn qua `backend/src/services/invoiceCreationService.js`.

Xem chi tiết tại `docs/offline-first-sync.md`.

---

## 9. Tài khoản local tham khảo

Thông tin tài khoản seed có thể thay đổi theo dữ liệu runtime hiện tại. Nếu đang dùng bộ dữ liệu mặc định cũ, có thể tham khảo:

**Admin:**

- Email: `admin@gmail.com`
- Mật khẩu: `admin123`

**Nhân viên:**

- Email: `nvana@gmail.com`
- Mật khẩu: `123456`

Nếu dữ liệu runtime đã thay đổi, hãy dùng tài khoản thực tế đang có trong database local.

---

## 10. Dừng server

- Nhấn `Ctrl+C` trong terminal backend/frontend.
- Với các terminal mở bởi `start-web.bat`, đóng cửa sổ terminal tương ứng hoặc nhấn `Ctrl+C` trong từng cửa sổ.

---

## 11. Tài liệu liên quan

- `README.md`
- `UPDATE-RELEASE.md`
- `docs/offline-first-sync.md`
