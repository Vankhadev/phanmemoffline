# Offline-first sync cho mobile Android/iOS

Tài liệu này mô tả kiến trúc đồng bộ hóa đơn mobile theo mô hình offline-first trong workspace hiện tại.

Phạm vi bao gồm:

- cache dữ liệu mobile
- outbox local
- quy trình push/pull
- idempotency server-side
- trạng thái sync
- conflict/retry
- cron reconcile phía backend
- checklist smoke/validation thủ công

## 1. Mục tiêu kiến trúc

Triển khai mobile hiện tại ưu tiên các mục tiêu sau:

1. Nhân viên vẫn tạo được hóa đơn khi mất mạng.
2. Hóa đơn local không bị mất nếu server tạm thời không phản hồi.
3. Khi retry sync, server không tạo trùng hóa đơn.
4. Admin web có thể theo dõi nguồn đơn mobile và trạng thái đồng bộ.
5. Server có cơ chế reconcile định kỳ để dọn link cài đặt hết hạn và đánh dấu event sync bị treo.

## 2. Thành phần chính

### Mobile frontend

Các thành phần mobile chính:

- API client: [`frontend/src/mobile/mobileApi.js`](frontend/src/mobile/mobileApi.js)
- local database/cache: [`frontend/src/mobile/mobileDb.js`](frontend/src/mobile/mobileDb.js)
- sync engine: [`frontend/src/mobile/mobileSyncEngine.js`](frontend/src/mobile/mobileSyncEngine.js)
- mobile UI/routes: [`frontend/src/mobile/MobileApp.jsx`](frontend/src/mobile/MobileApp.jsx)

### Backend

Các thành phần backend chính:

- route mobile: [`backend/src/routes/mobile.js`](backend/src/routes/mobile.js)
- service sync mobile: [`backend/src/services/mobileSyncService.js`](backend/src/services/mobileSyncService.js)
- tạo hóa đơn + idempotency: [`backend/src/services/invoiceCreationService.js`](backend/src/services/invoiceCreationService.js)
- lịch cron tổng: [`backend/src/server.js`](backend/src/server.js)

## 3. Local persistence trên mobile

Mobile app dùng IndexedDB làm storage chính trong [`frontend/src/mobile/mobileDb.js`](frontend/src/mobile/mobileDb.js).

Các object store hiện có:

- `auth`
- `metadata`
- `products`
- `customers`
- `invoices`
- `invoice_details`
- `outbox`
- `devices`

Khai báo store nằm trong [`STORE_DEFINITIONS`](frontend/src/mobile/mobileDb.js:5).

### Fallback khi IndexedDB không sẵn sàng

Nếu WebView không mở được IndexedDB, app fallback sang localStorage. Cơ chế này được xử lý trong [`openMobileDb()`](frontend/src/mobile/mobileDb.js:134) và các helper `fallback*` cùng file.

Ý nghĩa vận hành:

- app vẫn có thể giữ session/cấu hình/cache ở môi trường WebView hạn chế
- nhưng IndexedDB vẫn là storage ưu tiên cho outbox và cache dữ liệu mobile

## 4. Dữ liệu được cache trên mobile

Sau login, app gọi bootstrap/pull để cache:

- thông tin cửa hàng
- sản phẩm
- khách hàng
- hóa đơn gần đây
- chi tiết hóa đơn

Các hàm cache chính:

- [`cacheMobileBootstrapPayload()`](frontend/src/mobile/mobileSyncEngine.js:239)
- [`cacheMobilePullPayload()`](frontend/src/mobile/mobileSyncEngine.js:249)
- [`bootstrapMobileCache()`](frontend/src/mobile/mobileSyncEngine.js:262)
- [`pullMobileCache()`](frontend/src/mobile/mobileSyncEngine.js:268)

Điều này cho phép POS mobile hiển thị dữ liệu cần thiết ngay cả khi thiết bị đang offline.

## 5. Luồng tạo hóa đơn offline-first

Khi nhân viên tạo đơn tại mobile POS, app không gửi ngay sang server rồi mới lưu. Thay vào đó, app thực hiện local-first:

1. sinh `client_order_id`
2. chuẩn hóa chi tiết đơn hàng
3. gắn metadata client
4. tính `payload_hash`
5. tạo `idempotency_key`
6. lưu hóa đơn vào store `invoices`
7. lưu chi tiết vào `invoice_details`
8. tạo 1 outbox item trong store `outbox`

Toàn bộ luồng này nằm trong [`createLocalInvoice()`](frontend/src/mobile/mobileSyncEngine.js:287).

### Dữ liệu local được tạo

Một hóa đơn local gồm các đặc điểm chính:

- `local_id = client_order_id`
- `source = mobile`
- `order_source = mobile`
- `mobile_sync_status = queued`
- `sync_status = queued`

Outbox item đi kèm gồm:

- `type = create_invoice`
- `client_order_id`
- `payload`
- `payload_hash`
- `idempotency_key`
- `status = queued`

## 6. Outbox architecture

Outbox là hàng đợi local chứa các hành động cần đẩy lên server. Trong bản hiện tại, outbox chủ yếu phục vụ tạo hóa đơn mobile.

### Trạng thái outbox

Các trạng thái local chính đang được dùng:

- `queued`: đã ghi local, chờ gửi
- `syncing`: đang gửi lên server
- `synced`: đã áp dụng trên server hoặc đã được nhận diện idempotent
- `retry_wait`: tạm hoãn để thử lại
- `failed`: lỗi đồng bộ
- `conflict`: xung đột payload, không tự retry tiếp

Các tập trạng thái được khai báo trong [`RETRYABLE_OUTBOX_STATUSES`](frontend/src/mobile/mobileSyncEngine.js:39) và [`TERMINAL_OUTBOX_STATUSES`](frontend/src/mobile/mobileSyncEngine.js:40).

### Quy tắc retry

Khi push outbox lỗi do mạng hoặc request thất bại toàn batch, app sẽ:

- tăng số lần `attempts`
- ghi `last_error`
- đặt `retry_at`
- chuyển trạng thái sang `retry_wait`

Cơ chế này được xử lý trong [`markBatchRetry()`](frontend/src/mobile/mobileSyncEngine.js:455).

Backoff hiện tại tăng dần và bị chặn trần tối đa 5 phút.

### Trường hợp conflict

Nếu server trả `conflict`, item sẽ bị gắn trạng thái `conflict` và không còn nằm trong nhóm tự retry. Điều này tránh việc push lặp vô hạn với payload đã xung đột.

## 7. Trigger đồng bộ hiện tại

Mobile app **không có background sync liên tục**. Thay vào đó, auto-sync chỉ chạy khi app có điều kiện foreground/online.

Các trigger hiện có:

- thiết bị chuyển sang online
- app được focus
- app resume
- tab/webview chuyển sang visible
- timer ngắn sau khi mount app
- người dùng bấm đồng bộ thủ công

Phần điều phối auto-sync nằm ở:

- [`runAutoSync()`](frontend/src/mobile/MobileApp.jsx:680)
- [`useEffect()` lắng nghe `online`, `focus`, `visibilitychange`, `resume`](frontend/src/mobile/MobileApp.jsx:688)

### Giới hạn nền tảng

Mô tả chính xác cần giữ nguyên:

- iOS chỉ sync khi app foreground, resume, online hoặc người dùng bấm tay
- Android trong triển khai hiện tại cũng sync theo cơ chế foreground/resume/manual
- chưa có background fetch liên tục
- chưa có push notification đánh thức app để sync

## 8. API mobile liên quan đến sync

### Login và bootstrap

- login: [`router.post('/auth/login')`](backend/src/routes/mobile.js:231)
- bootstrap: [`router.get('/bootstrap')`](backend/src/routes/mobile.js:334)

### Pull/push/status

- pull: [`router.post('/sync/pull')`](backend/src/routes/mobile.js:338)
- push: [`router.post('/sync/push')`](backend/src/routes/mobile.js:342)
- status: [`router.get('/sync/status')`](backend/src/routes/mobile.js:393)

### Thiết bị và install links

- danh sách install links: [`router.get('/install-links')`](backend/src/routes/mobile.js:292)
- tạo install link: [`router.post('/install-links')`](backend/src/routes/mobile.js:300)
- danh sách thiết bị: [`router.get('/devices')`](backend/src/routes/mobile.js:309)
- revoke thiết bị: [`router.patch('/devices/:id/revoke')`](backend/src/routes/mobile.js:313)

## 9. Idempotency server-side

Phần cốt lõi để tránh tạo trùng hóa đơn nằm ở backend service mobile sync.

### Tạo khóa idempotency

Backend tính:

- `payload_hash` bằng [`computeInvoicePayloadHash()`](backend/src/services/mobileSyncService.js:84)
- `idempotency_key` bằng [`buildIdempotencyKey()`](backend/src/services/mobileSyncService.js:89)

Trong luồng push, hàm [`processMobileInvoicePush()`](backend/src/services/mobileSyncService.js:399) sẽ:

1. lấy `client_order_id`
2. tính lại `payload_hash`
3. dựng `idempotency_key`
4. ghi event sync ban đầu
5. gọi service tạo hóa đơn

### Ý nghĩa thực tế

Tổ hợp `account_id + client_order_id + payload_hash` cho phép:

- retry nhiều lần cùng payload mà không sinh đơn trùng
- nhận diện trường hợp request cũ đã được áp dụng rồi
- phát hiện trường hợp cùng `client_order_id` nhưng payload khác

### Event sync phía server

Mỗi lần push server có thể tạo/cập nhật bản ghi trong `mobile_sync_events` thông qua [`beginMobileSyncEvent()`](backend/src/services/mobileSyncService.js:336) và [`updateMobileSyncEvent()`](backend/src/services/mobileSyncService.js:383).

Các event này dùng để:

- theo dõi quá trình nhận/xử lý sync
- thống kê status server-side
- hỗ trợ reconcile khi event bị treo

## 10. Cách server xử lý push invoice

Khi backend nhận `/api/mobile/sync/push`, route [`router.post('/sync/push')`](backend/src/routes/mobile.js:342) sẽ:

1. tách danh sách hóa đơn cần push
2. xử lý từng hóa đơn hoặc batch
3. gọi [`processMobileInvoicePush()`](backend/src/services/mobileSyncService.js:399)
4. trả kết quả theo từng order

Kết quả mỗi item thường rơi vào các nhóm:

- `applied`
- `idempotent`
- `retry_later`
- `conflict`
- `failed`

Phía mobile sẽ ánh xạ kết quả này về trạng thái local qua [`classifyResult()`](frontend/src/mobile/mobileSyncEngine.js:418).

## 11. Conflict và retry

### Retry do lỗi mạng hoặc timeout

Nếu `mobilePush()` không trả kết quả thành công do lỗi kết nối, mobile coi đây là lỗi retryable toàn batch:

- outbox items chuyển sang `retry_wait`
- `retry_at` được đặt theo backoff
- hóa đơn local được cập nhật `sync_status = retry_wait`

### Retry do server trả `retry_later`

Nếu server trả trạng thái `retry_later`, mobile giữ item trong outbox và đặt lịch retry ngắn. Trạng thái local sẽ là `retry_wait`.

### Conflict do payload không khớp

Nếu server trả `conflict`:

- outbox item được giữ lại với trạng thái `conflict`
- hóa đơn local cũng nhận `sync_status = conflict`
- app không tự retry item đó nữa
- cần admin/nhân viên kiểm tra lại dữ liệu và đối soát trên web

## 12. Theo dõi trạng thái sync

### Trên mobile app

Màn hình `/mobile/sync` hiển thị:

- số lượng Pending
- số lượng Failed
- số lượng Conflict
- số lượng Syncing
- danh sách Outbox
- log sync gần đây
- status server-side

Phần UI này nằm trong [`MobileSyncCenter()`](frontend/src/mobile/MobileApp.jsx:532).

### Trên backend

Server tổng hợp trạng thái event sync theo thiết bị trong [`buildMobileSyncStatus()`](backend/src/services/mobileSyncService.js:491).

### Trên web admin

Admin có thể đối chiếu:

- nguồn đơn là mobile
- sync status trên danh sách đơn
- danh sách thiết bị trong tab Mobile

## 13. Quản lý thiết bị mobile

Mỗi lần login mobile, backend đăng ký hoặc cập nhật thiết bị bằng [`registerOrUpdateMobileDevice()`](backend/src/services/mobileSyncService.js:219).

Điều này cho phép:

- biết thiết bị nào đang dùng mobile app
- lưu `device_uid`, `device_name`, `platform`, `app_version`
- revoke thiết bị khi cần

Nếu thiết bị bị revoke, server sẽ từ chối các request mobile tiếp theo và có thể thu hồi session liên quan trong [`revokeMobileDevice()`](backend/src/services/mobileSyncService.js:288).

## 14. Install links Android/iOS

Admin có thể tạo install links để phân phối app cho nhân viên.

Các URL tải app lấy từ [`getMobileDownloadUrls()`](backend/src/services/mobileSyncService.js:93) với env hỗ trợ:

- `KHA_MOBILE_ANDROID_URL`
- `MOBILE_ANDROID_URL`
- `KHA_MOBILE_IOS_URL`
- `MOBILE_IOS_URL`

Endpoint công khai resolve install link là [`router.get('/install/:token')`](backend/src/routes/mobile.js:275).

## 15. Cron reconcile phía backend

Backend có job cron reconcile trạng thái mobile server-side trong [`backend/src/server.js`](backend/src/server.js).

Cron này gọi [`reconcileMobileServerState()`](backend/src/services/mobileSyncService.js:510) theo chu kỳ 15 phút.

### Nhiệm vụ của reconcile

1. Tắt install link đã hết hạn.
2. Đánh dấu `mobile_sync_events` bị treo ở trạng thái `received` quá lâu sang `retry_later`.

Ngưỡng `staleMinutes` hiện lấy từ:

- `KHA_MOBILE_SYNC_STALE_MINUTES`
- hoặc mặc định 15 phút

Ý nghĩa vận hành:

- giảm tình trạng event server-side bị treo mãi ở `received`
- giúp status sync phản ánh trung thực hơn khi có lỗi xử lý hoặc process bị gián đoạn

## 16. Cấu hình Server URL cho điện thoại thật

Mobile app lưu cấu hình server URL bằng [`saveMobileSettings()`](frontend/src/mobile/mobileApi.js:163) và chuẩn hóa qua [`normalizeServerBaseUrl()`](frontend/src/mobile/mobileApi.js:89).

Các biến env frontend hỗ trợ:

- `VITE_MOBILE_API_BASE_URL`
- `VITE_API_BASE_URL`
- `VITE_API_BASE`

Khi dùng điện thoại thật:

- không dùng `localhost`
- phải dùng LAN URL của máy chạy backend
- ví dụ: `http://192.168.1.10:3001` hoặc `http://192.168.1.10:3001/api`

## 17. Smoke/validation cơ bản

### Build frontend

Từ root workspace:

```bash
npm run mobile:build
npm run mobile:sync
```

Hoặc từ thư mục frontend:

```bash
cd frontend
npm run build
npm run mobile:sync
```

### Chạy backend

```bash
cd backend
npm start
```

### Checklist kiểm thử thủ công

1. Web admin đăng nhập và mở tab Mobile.
2. Admin tạo install link Android/iOS.
3. Nhân viên cài app và nhập đúng Server URL LAN.
4. Nhân viên login mobile thành công.
5. App bootstrap dữ liệu thành công.
6. Tạo 1 hóa đơn khi online, xác nhận đơn biến mất khỏi outbox sau sync.
7. Tắt mạng trên điện thoại, tạo 1 hóa đơn offline.
8. Mở route `/mobile/sync`, xác nhận có Pending/Queued.
9. Bật mạng lại, đưa app foreground hoặc bấm `Đồng bộ ngay`.
10. Xác nhận hóa đơn offline chuyển sang `synced` hoặc trạng thái phù hợp.
11. Kiểm tra web admin thấy đơn có nguồn mobile.
12. Kiểm tra `Status server` và danh sách Outbox không còn pending ngoài các case lỗi thật.
13. Nếu revoke thiết bị từ admin, xác nhận request mobile sau đó bị từ chối.

### Smoke script

Trong phạm vi subtask tài liệu hiện tại, **không tạo mới** script `tmp/mobile-sync-smoke-test.js` vì ràng buộc yêu cầu chỉ chỉnh/tạo Markdown. Nếu sau này dự án bổ sung script smoke riêng cho mobile sync, nên cập nhật thêm lệnh chạy tại tài liệu này.

## 18. Ghi chú triển khai hiện tại

- Một account/admin hiện tương ứng một store.
- Mobile app đang tối ưu cho offline-first hóa đơn, chưa phải sync full background realtime.
- Tài liệu này không giả định iOS có khả năng sync nền liên tục.
- Những thay đổi workspace không liên quan không được chỉnh sửa trong subtask tài liệu này.

## 19. Tài liệu liên quan

- [`README.md`](README.md)
- [`HOW-TO-RUN.md`](HOW-TO-RUN.md)
- [`frontend/MOBILE-CAPACITOR.md`](frontend/MOBILE-CAPACITOR.md)
