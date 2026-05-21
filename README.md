# Phan mem offline

## Phiên bản hiện tại: 1.2.8

### Nghiệp vụ bán hàng
- Quản lý bán hàng offline, khách hàng, công nợ, kho, nhập hàng và báo cáo.
- Đồng bộ dữ liệu với mobile/web theo cấu hình hiện có.

### Mobile Android/iOS
- Có thể build và đồng bộ ứng dụng mobile từ thư mục [`frontend`](frontend/package.json:1).
- Xem thêm tài liệu triển khai trong [`HOW-TO-RUN.md`](HOW-TO-RUN.md:1) và [`UPDATE-RELEASE.md`](UPDATE-RELEASE.md:1).

### 1. Cài đặt dependencies
```cmd
npm install
cd frontend && npm install
cd ..\backend && npm install
```

### 2. Chạy backend + frontend
```cmd
npm run dev
```

### 3. Dùng mobile trên điện thoại thật
- Cấu hình Capacitor trong [`frontend/capacitor.config.json`](frontend/capacitor.config.json:1).
- Build frontend rồi sync mobile theo hướng dẫn trong [`UPDATE-RELEASE.md`](UPDATE-RELEASE.md:1).

### 4. Build web assets cho mobile Capacitor
```cmd
cd frontend && npm run build
cd frontend && npx cap sync
```

## Mobile Android/iOS bằng Capacitor

### 1. Build frontend
```cmd
cd frontend && npm run build
```

### 2. Đóng gói Electron
```cmd
npm run build:installer
```

### 3. Manifest phát hành
- Manifest phát hành được tạo và kiểm tra theo luồng trong [`UPDATE-RELEASE.md`](UPDATE-RELEASE.md:1).

## Tài liệu liên quan
- [`UPDATE-RELEASE.md`](UPDATE-RELEASE.md:1)
- [`docs/offline-first-sync.md`](docs/offline-first-sync.md:1)
- [`plans/license-update-implementation-plan.md`](plans/license-update-implementation-plan.md:1)

## Lưu ý vận hành
- Luôn backup dữ liệu trước khi phát hành bản mới.
- Kiểm tra lại updater sau khi đổi version hoặc artifact name.
