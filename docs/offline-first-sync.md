# Offline/local sync hiện tại

Tài liệu này phản ánh cơ chế offline/sync thực tế đang có trong source hiện tại của workspace `g:/phanmienoffline`.

Source hiện tại không có các module/route riêng từng được mô tả trong tài liệu cũ.

Do đó tài liệu này không giả định hay khôi phục các module riêng không tồn tại. Phạm vi hiện tại là cơ chế pending/offline trên frontend web và API sync chung của backend.

## 1. Thành phần chính

### Frontend

- `frontend/src/utils/authStorage.js`
  - Lưu session/token.
  - Đọc/xóa pending local data.
  - Các key liên quan:
    - `kha_pending_orders`
    - `kha_offline_customers`
- `frontend/src/utils/apiClient.js`
  - Chuẩn hóa API base.
  - Gọi `authApi.syncPull()` và `authApi.syncPush()`.
  - `pushPendingLocalData()` gom pending orders/customers và gửi lên `/api/sync/push`.
- `frontend/src/App.jsx`
  - Sau đăng nhập/bootstrap và khi online/focus, kích hoạt pull/push sync phù hợp.
- `frontend/src/pages/CreateOrder.jsx`
  - Khi server không sẵn sàng, lưu đơn hoặc khách hàng mới vào localStorage.
- `frontend/src/pages/OrderList.jsx`
  - Hiển thị cả đơn online và đơn offline local nếu backend không phản hồi hoặc còn pending.

### Backend

- `backend/src/routes/sync.js`
  - `GET /api/bootstrap/status`
  - `GET /api/bootstrap`
  - `GET /api/sync/versions`
  - `POST /api/sync/pull`
  - `POST /api/sync/push`
- `backend/src/services/invoiceCreationService.js`
  - Tạo hóa đơn từ payload sync.
  - Có xử lý metadata client order để giảm rủi ro tạo trùng khi payload có `client_order_id`.
- `backend/src/db/database.js`
  - JSON database, sync metadata và các bảng nghiệp vụ.

## 2. API base và môi trường chạy

Frontend lấy API base theo thứ tự chính:

1. Biến Vite `VITE_API_BASE_URL` hoặc `VITE_API_BASE`.
2. API base do Electron preload cung cấp khi chạy desktop.
3. LAN/dev fallback dựa trên `VITE_BACKEND_HOST` và `VITE_BACKEND_PORT`.
4. Dev proxy `/api` khi chạy Vite local.

Mặc định khi chạy root `npm run dev`:

- Backend: `http://127.0.0.1:3001/api`
- Frontend: `http://127.0.0.1:5174`

## 3. Local pending data

Frontend lưu dữ liệu pending trong localStorage:

- `kha_pending_orders`: danh sách đơn tạo/sửa khi backend không sẵn sàng.
- `kha_offline_customers`: danh sách khách hàng tạo khi backend không sẵn sàng.

`getPendingLocalData()` đọc hai key này và trả về:

```json
{
  "orders": [],
  "customers": []
}
```

`clearPendingLocalData()` xóa hai key sau khi sync push thành công.

## 4. Luồng tạo đơn khi backend lỗi/offline

Trong màn tạo đơn:

1. Frontend kiểm tra server bằng endpoint `/store`.
2. Nếu backend online, frontend gửi đơn qua API tạo hóa đơn bình thường.
3. Nếu backend không phản hồi hoặc request tạo đơn thất bại theo nhánh offline, frontend lưu đơn vào `kha_pending_orders`.
4. Danh sách đơn vẫn có thể hiển thị đơn offline local bằng cách merge dữ liệu từ localStorage.

Đơn offline có thể mang các dấu hiệu như:

- `_isOffline` khi được đưa vào danh sách hiển thị.
- `client_order_id` để định danh phía client.
- `client_order_status` mặc định là `pending` khi được chuẩn hóa trước sync.

## 5. Luồng tạo khách hàng offline

Khi tạo khách hàng trong màn tạo đơn:

1. Nếu backend online, frontend tạo khách hàng qua API như bình thường.
2. Nếu backend offline, frontend sinh ID tạm dạng `OFF_CUST_*`.
3. Khách hàng được lưu vào `kha_offline_customers` và thêm vào danh sách chọn khách trong phiên hiện tại.
4. Khi sync push, danh sách khách hàng offline được gửi trong nhóm `customers`.

## 6. Pull bootstrap/sync

Sau đăng nhập hoặc khi cần làm mới dữ liệu, frontend gọi:

- `GET /api/sync/versions` để lấy version metadata.
- `POST /api/sync/pull` để kéo dữ liệu chính.

Backend `sync/pull` hỗ trợ các nhóm dữ liệu chính như:

- `store_info`
- `products`
- `product_categories`
- `customers`
- `customer_types`
- `partners`
- `import_logs`
- `import_details`
- `invoices`
- `invoice_details`
- `combos`
- `combo_items`
- `print_templates`
- `cash_book`
- `return_logs`
- `return_details`
- `daily_stats`

Nếu không truyền `tables`, backend trả về bộ dữ liệu mặc định. Hóa đơn gần đây được giới hạn bằng `invoiceLimit`/`invoice_limit`, mặc định 200.

## 7. Push pending data

`pushPendingLocalData()` trong frontend:

1. Đọc `kha_pending_orders` và `kha_offline_customers`.
2. Chuẩn hóa từng đơn pending thành payload có `details` và `client_order_id`.
3. Gọi `POST /api/sync/push` với payload dạng:

```json
{
  "pending": {
    "orders": [],
    "customers": []
  }
}
```

Backend `sync/push` hiện hỗ trợ các nhóm:

- `customers`
- `orders`
- `partners`
- `products`
- `product_categories`
- `imports`
- `import_logs`
- `import_details`

Các key chưa hỗ trợ được liệt kê trong `unsupported` và bị bỏ qua để tránh ghi sai dữ liệu.

Sau khi `authApi.syncPush()` trả về thành công, frontend gọi `clearPendingLocalData()` để xóa pending local data.

## 8. Tạo hóa đơn từ sync push

Với mỗi item trong `pending.orders`, backend gọi `createPendingOrderFromSync()` rồi gọi tiếp `createInvoiceFromPayload()`.

Backend bổ sung các thông tin an toàn:

- `user_id` từ user đang đăng nhập nếu payload không có.
- `note` mặc định là `Đơn đồng bộ từ thiết bị` nếu payload không có ghi chú.
- `orderSource` là `sync`.

Kết quả trả về trong nhóm `accepted.orders` gồm các thông tin như:

- `id`
- `invoice_code`
- `client_order_id`
- `action`
- `idempotent`
- `error` nếu tạo đơn lỗi

## 9. Trạng thái hiển thị ở danh sách đơn

`OrderList` đọc đơn từ backend và merge với `kha_pending_orders`.

Khi backend offline hoặc còn đơn local:

- Đơn local được gắn `_isOffline` để UI nhận diện.
- Bộ lọc có thể hiển thị trạng thái `Offline` hoặc nguồn `Offline local`.
- Người dùng có thể chỉnh/sửa/xóa đơn offline local trong localStorage trước khi sync.

## 10. Trigger sync hiện tại

Frontend có các trigger chính:

- Sau đăng nhập/bootstrap thành công.
- Khi trình duyệt chuyển online.
- Khi window focus.
- Poll/check sync định kỳ trong app shell.
- Khi có sự kiện yêu cầu kiểm tra sync nội bộ.

Không có background sync native, push notification hay sync engine IndexedDB riêng trong source hiện tại.

## 11. Giới hạn và lưu ý vận hành

- Pending data nằm trong localStorage nên phụ thuộc trình duyệt/profile người dùng.
- localStorage không phù hợp cho dữ liệu quá lớn; pending chỉ nên là hàng đợi nhỏ để khôi phục khi backend tạm lỗi.
- Nếu người dùng xóa dữ liệu trình duyệt, pending local data sẽ mất.
- Nếu sync push thành công ở cấp HTTP nhưng một số item trong `accepted.orders` có `action: "error"`, cần kiểm tra response trước khi coi toàn bộ nghiệp vụ đã xử lý xong. Source hiện tại xóa pending sau khi request push thành công.
- Không có bảng dữ liệu chuyên dụng, route API riêng đang được mount, hoặc màn quản trị riêng thực sự trong source hiện tại. Các API admin ở frontend có fallback `unsupported` khi backend không hỗ trợ.

## 12. Smoke/validation cơ bản

### Build frontend

```cmd
npm run build:frontend
```

### Chạy backend

```cmd
cd backend
npm start
```

Kiểm tra health:

```cmd
curl http://127.0.0.1:3001/api/health
```

### Chạy frontend dev

```cmd
cd frontend
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

### Checklist thủ công

1. Đăng nhập web.
2. Tạo đơn khi backend online, xác nhận đơn lưu backend.
3. Tạm dừng backend, tạo đơn để frontend lưu vào `kha_pending_orders`.
4. Mở danh sách đơn, xác nhận đơn offline local vẫn hiển thị.
5. Khởi động lại backend.
6. Đưa browser online/focus hoặc đăng nhập lại để kích hoạt push pending.
7. Kiểm tra `/api/sync/push` trả về `ok: true` và đơn xuất hiện từ backend.
8. Kiểm tra localStorage không còn pending nếu push thành công.

## 13. Tài liệu liên quan

- `README.md`
- `HOW-TO-RUN.md`
- `UPDATE-RELEASE.md`
