# Bán hàng offline - by Van kha mmo
## Phiên bản hiện tại: 1.1.8

Phiên bản ứng dụng được đồng bộ trong `package.json`, `package-lock.json`, `frontend/package.json` và `backend/package.json`.

---

## 🚀 Cách 1: Chạy Development (cần Node.js)

### Bước 1: Cài đặt Node.js
Tải Node.js từ https://nodejs.org (chọn LTS)

### Bước 2: Cài đặt dependencies
```bash
# Cài backend
cd backend
npm install

# Cài frontend
cd ../frontend
npm install
```

### Bước 3: Chạy ứng dụng
```bash
# Từ thư mục gốc (root)
npm run dev
```
- Backend chạy: http://localhost:3001
- Frontend chạy: http://localhost:5173

---

## 📦 Cách 2: Đóng gói file .exe

### Bước 1: Cài đặt tất cả dependencies
```bash
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

### Bước 2: Build frontend
```bash
npm run build:frontend
```

### Bước 3: Đóng gói .exe
```bash
npm run build:electron
```
File .exe sẽ nằm trong thư mục `release/`

### Phát hành bản cập nhật qua GitHub Release

Ứng dụng Windows production dùng `electron-updater` với provider generic để đọc trực tiếp metadata public tại `https://github.com/Vankhadev/phanmemoffline/releases/latest/download/latest.yml`. Cách này tránh phụ thuộc endpoint `releases.atom` của GitHub. File `release/update-manifest.json` vẫn được tạo/upload như manifest legacy, nhưng không phải feed chính của luồng auto-update hiện tại.

Sau khi build installer, tạo manifest legacy bằng:

```bash
npm run generate:update-manifest
```

GitHub Actions workflow `.github/workflows/release-windows.yml` sẽ build Windows installer khi push tag `v*.*.*` như `v1.1.8`, tạo `release/latest.yml` và `release/update-manifest.json`, upload installer/blockmap/metadata lên GitHub Release, rồi kiểm tra các URL update có truy cập ẩn danh được hay không. Nếu repo/release asset đang private và URL trả 401/403/404, client Electron không có token sẽ không thể hiện hộp thoại cập nhật. Xem hướng dẫn chi tiết tại `UPDATE-RELEASE.md` và manifest mẫu tại `release/update-manifest.example.json`.

---

## 📁 Cấu trúc Project

```
phanmienoffline/
├── phanmienoffline.sql       ← Schema database SQLite
├── phanmienoffline.db        ← File database (tự tạo khi chạy)
├── package.json              ← Electron config & scripts
├── backend/
│   ├── package.json
│   └── src/index.js          ← API server (Express + SQLite)
├── frontend/
│   ├── package.json
│   ├── src/
│   │   ├── App.jsx           ← Router + Layout
│   │   └── pages/
│   │       ├── Login.jsx     ← Đăng nhập (chọn User 1/2/3)
│   │       ├── POS.jsx       ← Màn hình Bán hàng
│   │       ├── Imports.jsx   ← Nhập hàng + Combo
│   │       ├── Products.jsx  ← Quản lý sản phẩm
│   │       ├── Customers.jsx ← Quản lý khách hàng
│   │       ├── Stats.jsx     ← Thống kê doanh thu
│   │       └── Settings.jsx  ← Cài đặt cửa hàng
│   └── dist/                 ← Build output (sau khi build)
└── src/
    ├── main.js               ← Electron main process
    └── preload.js            ← Electron preload
```

---

## 🔐 Tài khoản mặc định

| Nhân viên | PIN  | Quyền     |
|-----------|------|-----------|
| User 1    | 1234 | Thu ngân  |
| User 2    | 5678 | Thu ngân  |
| User 3    | 9012 | Quản trị  |

---

## 📌 Tính năng chính

1. **Bán hàng (POS)**: Tạo hóa đơn, chọn giá Sỉ/Lẻ/VIP, in bill
2. **Nhập hàng**: Nhập kho, quản lý nhà cung cấp, tạo combo
3. **Sản phẩm**: CRUD đầy đủ, 4 loại giá (nhập/sỉ/lẻ/VIP)
4. **Khách hàng**: Phân loại khách (lẻ/sỉ/VIP), tự động áp giá
5. **Thống kê**: Doanh thu theo ngày/tuần/tháng/năm, biểu đồ
6. **In hóa đơn**: Tích hợp `react-to-print`, hỗ trợ máy in bill
7. **Cron job**: Tự động quét mỗi 5 phút, cập nhật tồn kho
8. **Chạy offline**: SQLite, không cần cài SQL Server

---

## ⚠️ Lưu ý

- Bản Electron lưu database runtime trong userData với tên `phanmienoffline.db.json`; installer không bundle hoặc xóa file database runtime
- Khi cập nhật, `electron-updater` xác minh metadata/checksum từ `latest.yml`; app backup database vào `userData/backups` trước khi gọi cài đặt
- Để thêm icon .exe: tạo thư mục `build/` và đặt file `icon.ico` vào đó
