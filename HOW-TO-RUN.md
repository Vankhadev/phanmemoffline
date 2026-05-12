# Hướng dẫn chạy ứng dụng local

Tài liệu này mô tả cách chạy backend, frontend web admin và frontend mobile route `/mobile/*` trong môi trường local của workspace.

## 1. Yêu cầu

- Node.js bản LTS.
- `npm` đi kèm Node.js.
- Nếu build native mobile:
  - Android: Android Studio + Android SDK.
  - iOS: macOS + Xcode + Apple Developer nếu cần ký app/chạy trên thiết bị thật.

---

## 2. Cài dependencies

Từ thư mục root `g:/phanmienoffline`:

```bash
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

---

## 3. Chạy backend

```bash
cd backend
npm start
```

Backend mặc định chạy tại:

- `http://localhost:3001`
- API web: `http://localhost:3001/api`
- API mobile: `http://localhost:3001/api/mobile`

Backend hiện đã có sẵn:

- namespace mobile `/api/mobile`
- quản lý mobile devices
- install links Android/iOS
- idempotency hóa đơn mobile theo `account_id + client_order_id + payload_hash`
- sync events và cron reconcile server-side

---

## 4. Chạy frontend web

Mở terminal mới:

```bash
cd frontend
npm run dev
```

Frontend dev mặc định chạy tại:

- `http://localhost:5173`

Các route mobile được mount trên cùng frontend:

- `http://localhost:5173/mobile/login`
- `http://localhost:5173/mobile/pos`
- `http://localhost:5173/mobile/orders`
- `http://localhost:5173/mobile/sync`
- `http://localhost:5173/mobile/settings`

---

## 5. Chạy nhanh cả backend + frontend từ root

```bash
npm run dev
```

Script này chạy song song:

- backend `npm start`
- frontend `npm run dev`

---

## 6. Dùng mobile trên điện thoại thật

### Server URL cần nhập trên mobile

Khi mở app mobile tại route [`/mobile/login`](frontend/src/mobile/MobileApp.jsx:722), **không dùng `localhost`** vì trên điện thoại `localhost` sẽ trỏ về chính thiết bị.

Hãy dùng URL LAN của máy đang chạy backend, ví dụ:

- `http://192.168.1.10:3001`
- `http://192.168.1.10:3001/api`

Frontend mobile sẽ chuẩn hóa về API base `/api` khi lưu cấu hình server.

### Điều kiện mạng

- Điện thoại và máy chạy backend phải cùng Wi-Fi/LAN.
- Nếu Windows Firewall đang chặn cổng `3001`, mobile sẽ không kết nối được backend.
- Nếu cần kiểm tra nhanh, mở URL backend LAN trên trình duyệt điện thoại trước khi đăng nhập app.

---

## 7. Luồng vận hành mobile

### Phía admin web

1. Đăng nhập admin trên web.
2. Vào tab Mobile trong Settings.
3. Tạo hoặc quản lý install links Android/iOS.
4. Quản lý danh sách thiết bị đã đăng nhập; có thể revoke thiết bị khi cần.
5. Tạo nhân viên hoặc bật quyền mobile cho nhân viên cần dùng app.

### Phía nhân viên mobile

1. Nhận link cài đặt từ admin.
2. Cài app Android/iOS.
3. Mở app, nhập Server URL LAN.
4. Đăng nhập bằng tài khoản nhân viên đã được bật mobile.
5. App bootstrap dữ liệu cửa hàng, sản phẩm, khách hàng, hóa đơn gần đây.
6. Tạo hóa đơn ở POS mobile.
7. Nếu offline, hóa đơn vẫn được lưu local và nằm trong outbox chờ sync.
8. Khi online, foreground/resume hoặc bấm đồng bộ thủ công, app push outbox lên server.

---

## 8. Build frontend cho mobile Capacitor

Từ root:

```bash
npm run mobile:build
npm run mobile:sync
```

Hoặc từ thư mục [`frontend`](frontend/package.json):

```bash
cd frontend
npm run build
npm run mobile:sync
```

Tài liệu chi tiết Android/iOS xem tại [`frontend/MOBILE-CAPACITOR.md`](frontend/MOBILE-CAPACITOR.md).

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

## 10. Giới hạn đồng bộ mobile hiện tại

- Mobile đang dùng mô hình offline-first với IndexedDB outbox, có fallback localStorage khi WebView không mở được IndexedDB.
- App **không hứa hẹn sync nền liên tục**.
- iOS hiện chỉ sync khi app foreground, resume, online hoặc người dùng bấm đồng bộ thủ công.
- Android trong triển khai hiện tại cũng đang sync theo cơ chế foreground/resume/manual.
- Chưa triển khai background fetch, push notification hay barcode native.

---

## 11. Dừng server

- Nhấn `Ctrl+C` trong terminal backend.
- Nhấn `Ctrl+C` trong terminal frontend.

---

## 12. Tài liệu liên quan

- [`README.md`](README.md)
- [`frontend/MOBILE-CAPACITOR.md`](frontend/MOBILE-CAPACITOR.md)
- [`docs/offline-first-sync.md`](docs/offline-first-sync.md)
