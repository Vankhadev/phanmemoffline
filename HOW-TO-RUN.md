# Hướng dẫn chạy Web App (Localhost)

## Các bước để chạy:

### 1. Cài đặt dependencies
```bash
cd backend
npm install

cd ../frontend
npm install
```

### 2. Chạy Backend (API Server)
```bash
cd backend
npm start
```
Backend sẽ chạy tại: **http://localhost:3001**

### 3. Chạy Frontend (Dev Server)
Mở terminal mới:
```bash
cd frontend
npm run dev
```
Frontend sẽ chạy tại: **http://localhost:5173**

---

## Tài khoản mặc định:

**Admin:**
- Email: `admin@gmail.com`
- Mật khẩu: `admin123`

**Nhân viên:**
- Email: `nvana@gmail.com` / `ttb@gmail.com`
- Mật khẩu: `123456`

---

## Lưu ý:
- Database được lưu tại: `D:\phanmienoffline.db.json`
- Dữ liệu sẽ được giữ nguyên khi khởi động lại
- Không cần cài đặt Electron, chỉ cần Node.js

---

## Để dừng servers:
- Nhấn `Ctrl+C` trong terminal chạy backend
- Nhấn `Ctrl+C` trong terminal chạy frontend
