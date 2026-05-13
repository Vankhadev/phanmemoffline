# Bán hàng offline - by Van kha mmo

## Phiên bản hiện tại: 1.2.4

Ứng dụng hiện hỗ trợ 3 lớp triển khai chính:

- Web admin/nhân viên chạy bằng backend Express + frontend React/Vite.
- Desktop Windows đóng gói bằng Electron.
- Mobile Android/iOS dùng Capacitor, chạy nhánh route `/mobile/*` và đồng bộ hóa đơn theo mô hình offline-first.

Phiên bản ứng dụng đang được đồng bộ trong `package.json`, `package-lock.json`, `frontend/package.json` và `backend/package.json`.

---

## Tính năng chính

### Nghiệp vụ bán hàng

1. **Bán hàng (POS)**: tạo hóa đơn, chọn giá Sỉ/Lẻ/VIP, in bill.
2. **Nhập hàng**: nhập kho, quản lý nhà cung cấp, tạo combo.
3. **Sản phẩm**: CRUD đầy đủ, nhiều mức giá và đồng bộ dữ liệu hiển thị.
4. **Khách hàng**: phân loại khách, áp giá phù hợp.
5. **Thống kê**: doanh thu theo ngày/tuần/tháng/năm.
6. **In hóa đơn**: hỗ trợ mẫu in và xem trước hóa đơn.
7. **Chạy offline**: backend local + dữ liệu runtime cục bộ.

### Mobile Android/iOS

1. **Route mobile riêng**: `/mobile/login`, `/mobile/pos`, `/mobile/orders`, `/mobile/sync`, `/mobile/settings`.
2. **Đăng nhập mobile qua backend**: backend đã có namespace `/api/mobile` riêng cho login, bootstrap, pull/push sync, thiết bị và install links.
3. **Offline-first hóa đơn**: app mobile lưu hóa đơn local trước, ghi vào outbox IndexedDB rồi push khi có mạng.
4. **Idempotency khi sync**: server xử lý theo tổ hợp `account_id + client_order_id + payload_hash` để tránh tạo trùng hóa đơn khi retry.
5. **Admin quản lý mobile**: tab Mobile trong Settings hỗ trợ quản lý install links và danh sách thiết bị đã đăng nhập.
6. **Theo dõi nguồn đơn hàng**: danh sách đơn web hiển thị nguồn mobile và trạng thái sync.
7. **Cron reconcile phía server**: job nền phía backend dọn link hết hạn và đánh dấu event sync bị treo sang trạng thái thử lại sau.

---

## Chạy development

### 1. Cài đặt dependencies

```bash
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

### 2. Chạy backend + frontend

Chạy nhanh từ root workspace:

```bash
npm run dev
```

Hoặc chạy riêng từng service:

```bash
cd backend
npm start
```

```bash
cd frontend
npm run dev
```

Mặc định:

- Backend: `http://localhost:3001`
- API web: `http://localhost:3001/api`
- API mobile: `http://localhost:3001/api/mobile`
- Frontend dev: `http://localhost:5173`
- Mobile routes trên frontend: `http://localhost:5173/mobile/login` và các route `/mobile/*`

### 3. Dùng mobile trên điện thoại thật

Khi đăng nhập trên điện thoại Android/iPhone hoặc app native Capacitor, **không dùng `localhost`**. Hãy nhập **LAN URL** của máy đang chạy backend, ví dụ:

- `http://192.168.1.10:3001`
- `http://192.168.1.10:3001/api`

Frontend mobile sẽ tự chuẩn hóa về base API `/api` khi lưu cấu hình Server URL.

### 4. Build web assets cho mobile Capacitor

Từ root workspace:

```bash
npm run mobile:build
npm run mobile:sync
```

Tài liệu build Android/iOS chi tiết nằm tại:

- `frontend/MOBILE-CAPACITOR.md`
- `docs/offline-first-sync.md`

---

## Mobile Android/iOS bằng Capacitor

Luồng hiện tại:

1. Admin web tạo hoặc bật nhân viên được phép đăng nhập mobile.
2. Admin vào **Settings > Mobile** để tạo install link và theo dõi thiết bị.
3. Nhân viên mở link cài đặt, cài app Android/iOS phù hợp.
4. Ở màn hình `/mobile/login`, nhân viên nhập Server URL theo LAN rồi đăng nhập.
5. App bootstrap dữ liệu cửa hàng, sản phẩm, khách hàng và hóa đơn gần đây.
6. Khi tạo đơn ở `/mobile/pos`, hóa đơn được lưu local trước và đưa vào outbox.
7. Khi online, foreground/resume hoặc bấm đồng bộ thủ công ở `/mobile/sync`, app sẽ push outbox lên server và pull dữ liệu mới.

Giới hạn hiện tại:

- Chưa triển khai background fetch liên tục.
- iOS **không** đồng bộ nền liên tục; chỉ sync khi app foreground, resume, có mạng hoặc người dùng bấm tay.
- Android hiện cũng đang theo cùng cơ chế foreground/resume/manual trong bản triển khai hiện tại.
- Hiện tại một account/admin tương ứng một store.

---

## Build desktop Windows

### 1. Build frontend

```bash
npm run build:frontend
```

### 2. Đóng gói Electron

```bash
npm run build:electron
```

Artifact sẽ nằm trong thư mục `release/`.

### 3. Manifest phát hành

```bash
npm run generate:update-manifest
```

Luồng auto-update Windows dùng `electron-updater` với provider generic và metadata `release/latest.yml`. Xem thêm tại `UPDATE-RELEASE.md`.

---

## Tài liệu liên quan

- `HOW-TO-RUN.md`: hướng dẫn chạy backend/frontend/mobile theo môi trường local.
- `frontend/MOBILE-CAPACITOR.md`: hướng dẫn build và chạy Android/iOS bằng Capacitor.
- `docs/offline-first-sync.md`: kiến trúc outbox, IndexedDB, idempotency, API sync, cron reconcile và checklist kiểm thử.
- `UPDATE-RELEASE.md`: phát hành bản Windows và auto-update.

---

## Lưu ý vận hành

- Mobile app lưu session/cấu hình và dữ liệu cache trong IndexedDB; có fallback sang localStorage nếu WebView không mở được IndexedDB.
- Install links Android/iOS được backend trả theo cấu hình môi trường server.
- Trạng thái pending sync có thể kiểm tra trực tiếp trong màn hình `/mobile/sync` trên app và trong Order List trên web admin.
- Bản Electron lưu database runtime trong userData; installer không bundle hoặc xóa file database runtime đang dùng.
- Khi cập nhật Electron, `electron-updater` xác minh checksum/metadata từ `latest.yml` trước khi cài đặt.
