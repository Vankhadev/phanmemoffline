# Bộ kiểm thử API đăng nhập hiện tại

## 1. Phạm vi và căn cứ mã nguồn

Tài liệu này chỉ mô tả kiểm thử dạng văn bản cho API đăng nhập hiện tại, không sửa mã nguồn và không giả định tính năng chưa tồn tại.

Các file đã dùng làm căn cứ:

- [`backend/src/routes/users.js`](../backend/src/routes/users.js): định nghĩa API công khai trong nhóm người dùng, gồm đăng nhập, đăng ký, bootstrap admin, profile, logout và logout all.
- [`backend/src/middleware/auth.js`](../backend/src/middleware/auth.js): tạo phiên server-side, sinh bearer token, xác thực bearer token, revoke session, cập nhật last_seen.
- [`backend/src/server.js`](../backend/src/server.js): cấu hình Express, Helmet, CORS, JSON body parser và mount route.
- [`backend/src/utils/password.js`](../backend/src/utils/password.js): hash PBKDF2 SHA-256, verify mật khẩu, tương thích mật khẩu plain text cũ.
- [`frontend/src/utils/apiClient.js`](../frontend/src/utils/apiClient.js): client gọi API đăng nhập, tự gắn Authorization cho API cần xác thực, xử lý lỗi 401.
- [`frontend/src/utils/authStorage.js`](../frontend/src/utils/authStorage.js): lưu token, user và auth snapshot trong localStorage.
- [`frontend/src/pages/Login.jsx`](../frontend/src/pages/Login.jsx): validation phía UI và luồng đăng nhập/thiết lập admin đầu tiên.

Endpoint chính trong phạm vi kiểm thử:

- `POST /api/users/login`
- `GET /api/users/profile`
- `POST /api/users/logout`
- `POST /api/users/logout-all`
- `GET /api/users/bootstrap-status` chỉ dùng để thiết lập dữ liệu ngữ cảnh.
- `POST /api/users/bootstrap-admin` hoặc `POST /api/users/register` chỉ dùng để chuẩn bị user test nếu môi trường trống.

Không có refresh token trong hành vi hiện tại. Token đăng nhập là bearer token ngẫu nhiên, lưu phía client trong localStorage và hash token được lưu trong bảng sessions phía server.

## 2. Tóm tắt hành vi thực tế cần kiểm thử

### 2.1 Login thành công

`POST /api/users/login` nhận body JSON gồm `email` và `password`. Backend chuẩn hóa email bằng cách trim và lowercase, tìm user active theo email, verify mật khẩu, tạo session mới, cập nhật last_login và trả payload:

- `ok: true`
- `token`
- `user`
- `account`
- `permissions`
- `session`
- `syncVersions`
- `bootstrap`

### 2.2 Login thất bại

- Thiếu email hoặc password: HTTP 400, body `{ ok: false, message: 'Vui lòng nhập email và mật khẩu' }`.
- Sai email, sai password, user inactive hoặc không tồn tại: HTTP 401, body `{ ok: false, message: 'Email hoặc mật khẩu không đúng' }`.
- Body JSON lỗi cú pháp: HTTP 400 với thông điệp chung của JSON body parser hiện tại.

### 2.3 Session và token

- Token lấy từ `Authorization: Bearer <token>`.
- `GET /api/users/profile` yêu cầu token hợp lệ, session chưa hết hạn, user active và account tồn tại.
- Session TTL mặc định 30 ngày, có thể cấu hình bằng env `KHA_SESSION_TTL_DAYS`.
- `POST /api/users/logout` revoke session hiện tại.
- `POST /api/users/logout-all` revoke mọi session của user trong account hiện tại.
- Không có refresh token.
- Không dùng cookie auth server-side cho login hiện tại; CORS cho phép credentials nhưng client dùng bearer token.

### 2.4 Rate limit hiện tại

- Public auth limiter mặc định: 60 request / 15 phút.
- Sensitive auth limiter cho login/register/bootstrap-admin mặc định: 20 request / 15 phút.
- Rate limit dựa trên express-rate-limit ở route auth, có header chuẩn RateLimit.
- Không thấy cơ chế lockout theo tài khoản, CAPTCHA, exponential backoff hay phát hiện brute force theo email.

### 2.5 CORS/HTTPS/cookie

- CORS mặc định cho localhost, 127.0.0.1, ::1 và origin null; env có thể mở rộng hoặc đặt wildcard.
- `credentials: true` được bật.
- Không thấy ép HTTPS trong server.
- Không thấy cookie httpOnly/secure/sameSite cho auth; token lưu localStorage.
- Helmet được bật.

## 3. Dữ liệu kiểm thử đề xuất

### 3.1 Biến môi trường và base URL

- Base URL local mặc định: `http://127.0.0.1:3001`
- API login: `http://127.0.0.1:3001/api/users/login`
- API profile: `http://127.0.0.1:3001/api/users/profile`

### 3.2 Tài khoản test

Chuẩn bị các tài khoản sau trên môi trường kiểm thử riêng, không dùng dữ liệu thật:

| Mã dữ liệu | Email | Password | Trạng thái | Vai trò | Mục đích |
|---|---|---|---|---|---|
| U_ADMIN_OK | `admin.test@example.com` | `Admin@123456` | active = 1 | admin | Happy path, profile, logout |
| U_USER_OK | `user.test@example.com` | `User@123456` | active = 1 | user | Happy path user thường |
| U_INACTIVE | `inactive.test@example.com` | `Inactive@123456` | active = 0 | user | Kiểm tra user bị khóa |
| U_LEGACY_PLAIN | `legacy.test@example.com` | `legacy123` | active = 1 | user | Kiểm tra mật khẩu plain text cũ được migrate sau login |

Nếu DB trống, tạo admin đầu tiên bằng `POST /api/users/bootstrap-admin` với dữ liệu:

```json
{
  "name": "Admin Test",
  "email": "admin.test@example.com",
  "phone": "0909123456",
  "password": "Admin@123456"
}
```

### 3.3 Payload kiểm thử chính

| Mã payload | Body JSON |
|---|---|
| P_LOGIN_OK_ADMIN | `{ "email": "admin.test@example.com", "password": "Admin@123456" }` |
| P_LOGIN_OK_CASE_SPACE | `{ "email": "  ADMIN.TEST@EXAMPLE.COM  ", "password": "Admin@123456" }` |
| P_LOGIN_OK_USER | `{ "email": "user.test@example.com", "password": "User@123456" }` |
| P_MISSING_EMAIL | `{ "password": "Admin@123456" }` |
| P_MISSING_PASSWORD | `{ "email": "admin.test@example.com" }` |
| P_EMPTY_EMAIL | `{ "email": "", "password": "Admin@123456" }` |
| P_EMPTY_PASSWORD | `{ "email": "admin.test@example.com", "password": "" }` |
| P_INVALID_EMAIL_FORMAT | `{ "email": "not-an-email", "password": "Admin@123456" }` |
| P_UNKNOWN_EMAIL | `{ "email": "unknown@example.com", "password": "Admin@123456" }` |
| P_WRONG_PASSWORD | `{ "email": "admin.test@example.com", "password": "Wrong@123456" }` |
| P_INACTIVE_USER | `{ "email": "inactive.test@example.com", "password": "Inactive@123456" }` |
| P_SQL_INJECTION_EMAIL | `{ "email": "admin.test@example.com' OR '1'='1", "password": "anything" }` |
| P_SQL_INJECTION_PASSWORD | `{ "email": "admin.test@example.com", "password": "' OR '1'='1" }` |
| P_XSS_EMAIL | `{ "email": "<script>alert(1)</script>@example.com", "password": "Admin@123456" }` |
| P_OBJECT_EMAIL | `{ "email": { "toString": "admin.test@example.com" }, "password": "Admin@123456" }` |
| P_ARRAY_PASSWORD | `{ "email": "admin.test@example.com", "password": ["Admin@123456"] }` |
| P_EXTRA_FIELDS | `{ "email": "admin.test@example.com", "password": "Admin@123456", "role": "admin", "active": 0 }` |
| P_DEVICE_METADATA | `{ "email": "admin.test@example.com", "password": "Admin@123456", "device_id": "qa-device-001", "device_name": "QA Browser", "platform": "web", "app_version": "test" }` |

## 4. Danh sách test case chi tiết

### 4.1 Nhóm happy path

| ID | Mục tiêu | Request | Bước thực hiện | Kết quả mong đợi |
|---|---|---|---|---|
| AUTH-HP-001 | Đăng nhập admin thành công | `POST /api/users/login`, P_LOGIN_OK_ADMIN | Gửi payload hợp lệ của admin active | HTTP 200; `ok=true`; có `token`; có `user.id`, `user.email`, `user.role=admin`; có `account`; có `permissions`; có `session.id`; `session.revoked_at=null`; có `syncVersions`; có `bootstrap.defaultRoute` |
| AUTH-HP-002 | Đăng nhập user thường thành công | `POST /api/users/login`, P_LOGIN_OK_USER | Gửi payload hợp lệ user active | HTTP 200; `ok=true`; `user.role=user`; có token và session hợp lệ |
| AUTH-HP-003 | Email được trim và lowercase | `POST /api/users/login`, P_LOGIN_OK_CASE_SPACE | Gửi email có khoảng trắng và chữ hoa | HTTP 200 nếu password đúng; `user.email` trả về dạng lowercase đã lưu |
| AUTH-HP-004 | Login bỏ qua field dư thừa | `POST /api/users/login`, P_EXTRA_FIELDS | Gửi field role, active kèm theo | HTTP 200 nếu email/password đúng; role/active không bị client override trong response; không có dấu hiệu server tin field dư |
| AUTH-HP-005 | Login kèm metadata thiết bị | `POST /api/users/login`, P_DEVICE_METADATA | Gửi device_id, device_name, platform, app_version | HTTP 200; `session.device_id=qa-device-001`; `session.device_name=QA Browser`; `session.platform=web`; `session.app_version=test` |
| AUTH-HP-006 | Login nhiều lần tạo nhiều session | Lặp P_LOGIN_OK_ADMIN 2 lần | Lưu token A và token B; gọi profile với cả hai token | Cả hai token đều dùng được trước logout/logout-all; mỗi lần login trả session id khác nhau |
| AUTH-HP-007 | Password plain text cũ vẫn login được | `POST /api/users/login`, U_LEGACY_PLAIN | Chuẩn bị user có password chưa hash, login bằng mật khẩu đúng | HTTP 200; backend cập nhật password sang PBKDF2 hash sau login; token/session hợp lệ |

### 4.2 Nhóm validation

| ID | Mục tiêu | Request | Kết quả mong đợi |
|---|---|---|---|
| AUTH-VAL-001 | Thiếu email | P_MISSING_EMAIL | HTTP 400; `ok=false`; `message='Vui lòng nhập email và mật khẩu'` |
| AUTH-VAL-002 | Thiếu password | P_MISSING_PASSWORD | HTTP 400; `ok=false`; `message='Vui lòng nhập email và mật khẩu'` |
| AUTH-VAL-003 | Email rỗng | P_EMPTY_EMAIL | HTTP 400; message như trên |
| AUTH-VAL-004 | Password rỗng | P_EMPTY_PASSWORD | HTTP 400; message như trên |
| AUTH-VAL-005 | Email sai format qua API trực tiếp | P_INVALID_EMAIL_FORMAT | Backend hiện không validate format email ở login; kỳ vọng thực tế: HTTP 401 `Email hoặc mật khẩu không đúng`, không phải 400 |
| AUTH-VAL-006 | Body JSON lỗi cú pháp | Body raw `{ "email": "admin.test@example.com", ` | HTTP 400; body có `ok=false`; message/error liên quan body JSON không hợp lệ theo handler hiện tại |
| AUTH-VAL-007 | Content-Type không phải JSON nhưng gửi body JSON | Header `Content-Type: text/plain` | Express JSON parser không parse body; `req.body` rỗng hoặc không như mong đợi; kỳ vọng HTTP 400 thiếu email/password |
| AUTH-VAL-008 | Email là object | P_OBJECT_EMAIL | Backend String hóa object thành `[object Object]`; kỳ vọng HTTP 401, không crash |
| AUTH-VAL-009 | Password là array | P_ARRAY_PASSWORD | Backend String hóa password trong verify; kỳ vọng HTTP 401 hoặc 200 chỉ nếu chuỗi hóa khớp, không crash |
| AUTH-VAL-010 | Body rất lớn | JSON vượt giới hạn mặc định express.json | HTTP 413 hoặc lỗi body parser; không crash process |

### 4.3 Nhóm authentication failure

| ID | Mục tiêu | Request | Kết quả mong đợi |
|---|---|---|---|
| AUTH-FAIL-001 | Email không tồn tại | P_UNKNOWN_EMAIL | HTTP 401; `ok=false`; `message='Email hoặc mật khẩu không đúng'`; không lộ user tồn tại hay không |
| AUTH-FAIL-002 | Password sai | P_WRONG_PASSWORD | HTTP 401; message giống AUTH-FAIL-001 |
| AUTH-FAIL-003 | User inactive không login được | P_INACTIVE_USER | HTTP 401; message giống AUTH-FAIL-001 |
| AUTH-FAIL-004 | Sai bearer token khi gọi profile | `GET /api/users/profile` với `Authorization: Bearer invalid` | HTTP 401; `ok=false`; `message`/`error='Phiên đăng nhập không hợp lệ hoặc đã hết hạn'` |
| AUTH-FAIL-005 | Không có bearer token khi gọi profile | `GET /api/users/profile` không Authorization | HTTP 401; `ok=false`; `message`/`error='Chưa đăng nhập'` |
| AUTH-FAIL-006 | Authorization không đúng scheme | `Authorization: Basic abc` | HTTP 401; `Chưa đăng nhập` do chỉ đọc Bearer |
| AUTH-FAIL-007 | Bearer token rỗng | `Authorization: Bearer ` | HTTP 401; `Chưa đăng nhập` hoặc session invalid, không crash |
| AUTH-FAIL-008 | User bị khóa sau khi có token | Login lấy token, set user active=0 trong DB test, gọi profile | HTTP 401; `Tài khoản không tồn tại hoặc đã bị khóa` |

### 4.4 Nhóm token/session

| ID | Mục tiêu | Request/Bước | Kết quả mong đợi |
|---|---|---|---|
| AUTH-SESS-001 | Token dùng được cho profile | Login thành công, gọi `GET /api/users/profile` với bearer token | HTTP 200; `ok=true`; user/account/session khớp payload login |
| AUTH-SESS-002 | Logout revoke session hiện tại | Login lấy token A, gọi `POST /api/users/logout`, sau đó gọi profile bằng token A | Logout HTTP 200 `{ ok: true }`; profile sau logout HTTP 401 session invalid/hết hạn |
| AUTH-SESS-003 | Logout-all revoke tất cả session của user | Login lấy token A và B, gọi logout-all bằng token A, gọi profile bằng A và B | Logout-all HTTP 200 `{ ok: true, revoked: <number> }`; cả A và B không còn dùng được |
| AUTH-SESS-004 | Logout không token | `POST /api/users/logout` không Authorization | HTTP 401 `Chưa đăng nhập` |
| AUTH-SESS-005 | Token cũ vẫn tồn tại nếu login lại nhưng chưa logout | Login A, login B, gọi profile A | HTTP 200; login mới không tự revoke session cũ |
| AUTH-SESS-006 | Session hết hạn | Cấu hình test `KHA_SESSION_TTL_DAYS` rất nhỏ hoặc sửa expires_at trong DB test về quá khứ | Profile trả HTTP 401 `Phiên đăng nhập không hợp lệ hoặc đã hết hạn` |
| AUTH-SESS-007 | Session public không lộ token hash | Login thành công | Response session không chứa `token_hash`; chỉ có metadata public |
| AUTH-SESS-008 | Cập nhật last_seen có kiểm soát | Login, gọi profile nhiều lần | Không lỗi; session `last_seen_at` có thể chỉ cập nhật sau interval cấu hình |
| AUTH-SESS-009 | Token không phải JWT | Kiểm tra chuỗi token response | Token là random base64url, không có cấu trúc JWT bắt buộc; không nên parse như JWT |

### 4.5 Nhóm rate limit

| ID | Mục tiêu | Request/Bước | Kết quả mong đợi |
|---|---|---|---|
| AUTH-RL-001 | Login bị limit sau nhiều lần thử | Gửi 21 request login sai trong cùng window mặc định 15 phút từ cùng IP | Các request đầu trả 401; request vượt ngưỡng trả 429; body `{ ok:false, message:'Quá nhiều lần thử đăng nhập/đăng ký, vui lòng thử lại sau ít phút.' }` |
| AUTH-RL-002 | Login thành công cũng tính vào limit | Gửi nhiều request login đúng/sai tổng vượt 20 | Request vượt ngưỡng trả 429 dù credential đúng |
| AUTH-RL-003 | Header rate limit chuẩn tồn tại | Gửi request login bất kỳ | Response có các header chuẩn RateLimit do `standardHeaders=true`; không có legacy X-RateLimit nếu cấu hình hiện tại giữ `legacyHeaders=false` |
| AUTH-RL-004 | Bootstrap-status dùng limiter khác | Gửi nhiều request `GET /api/users/bootstrap-status` | Ngưỡng mặc định 60/15 phút; quá ngưỡng trả 429 với message public limiter |
| AUTH-RL-005 | Cấu hình env thay đổi ngưỡng | Start server test với `KHA_AUTH_SENSITIVE_RATE_LIMIT_MAX=3` | Request thứ 4 trong window trả 429 |

### 4.6 Nhóm brute force

| ID | Mục tiêu | Request/Bước | Kết quả mong đợi |
|---|---|---|---|
| AUTH-BF-001 | Brute force theo cùng email | Gửi nhiều password sai cho cùng email | Bị chặn bởi IP rate limit sau ngưỡng; không có lockout riêng theo email |
| AUTH-BF-002 | Brute force nhiều email khác nhau | Gửi nhiều email khác nhau từ cùng IP | Bị chặn bởi IP rate limit sau ngưỡng; response 401 đồng nhất trước khi 429 |
| AUTH-BF-003 | Kiểm tra enumeration qua thời gian/phản hồi | So sánh response unknown email và wrong password | Cùng HTTP 401 và cùng message; thời gian có thể khác vì wrong password chạy verify PBKDF2 còn unknown email không verify |
| AUTH-BF-004 | Không có CAPTCHA/step-up | Vượt nhiều lần thử | Chỉ có 429; không có CAPTCHA, cooldown theo tài khoản, cảnh báo UI hoặc lockout account |
| AUTH-BF-005 | Nhiều IP/proxy | Mô phỏng IP khác nhau nếu môi trường test hỗ trợ proxy/trust proxy | Rate limit theo key mặc định của express-rate-limit; cần xác minh cấu hình proxy nếu deploy qua reverse proxy |

### 4.7 Nhóm injection/XSS

| ID | Mục tiêu | Request | Kết quả mong đợi |
|---|---|---|---|
| AUTH-INJ-001 | SQL injection trong email | P_SQL_INJECTION_EMAIL | HTTP 401; không bypass auth; không crash |
| AUTH-INJ-002 | SQL injection trong password | P_SQL_INJECTION_PASSWORD | HTTP 401; không bypass auth; không crash |
| AUTH-INJ-003 | XSS payload trong email | P_XSS_EMAIL | HTTP 401; response không phản chiếu payload email; không có HTML/script trong response |
| AUTH-INJ-004 | CRLF trong email | `{ "email":"admin.test@example.com\r\nX-Test: 1", "password":"Admin@123456" }` | HTTP 401; không tạo header bất thường; không crash |
| AUTH-INJ-005 | Unicode/emoji trong email | `{ "email":"😀@example.com", "password":"Admin@123456" }` | HTTP 401; không crash |
| AUTH-INJ-006 | Prototype pollution field | `{ "email":"admin.test@example.com", "password":"Admin@123456", "__proto__":{"isAdmin":true} }` | Nếu credential đúng vẫn login theo user thật; field lạ không nâng quyền; không ảnh hưởng object global |
| AUTH-INJ-007 | NoSQL-like object | `{ "email": { "$ne": null }, "password": { "$ne": null } }` | HTTP 401 hoặc 400; không bypass do DB dùng predicate JS và String hóa input |

### 4.8 Nhóm CORS/HTTPS/cookie

| ID | Mục tiêu | Request/Bước | Kết quả mong đợi |
|---|---|---|---|
| AUTH-CORS-001 | Origin localhost được phép | Gửi request với `Origin: http://localhost:5173` | Response có `Access-Control-Allow-Origin: http://localhost:5173`; login hoạt động |
| AUTH-CORS-002 | Origin 127.0.0.1 được phép | `Origin: http://127.0.0.1:5173` | Response CORS hợp lệ |
| AUTH-CORS-003 | Origin lạ bị từ chối theo mặc định | `Origin: http://evil.example.com` khi không cấu hình env cho phép | Không có allow-origin phù hợp hoặc browser chặn CORS; API server có thể vẫn trả HTTP ở mức network tool |
| AUTH-CORS-004 | Origin null được cho phép | `Origin: null` | Theo code hiện tại origin null được xem là allowed; cần ghi nhận rủi ro |
| AUTH-CORS-005 | Preflight OPTIONS login | OPTIONS `/api/users/login` với headers content-type | Preflight trả thành công nếu origin allowed; cho phép POST và Content-Type |
| AUTH-CORS-006 | Credentials true nhưng không dùng cookie auth | Login từ browser | Response không set cookie auth; client lưu bearer token ở localStorage |
| AUTH-CORS-007 | Không ép HTTPS | Gọi qua HTTP local | Login hoạt động qua HTTP; không có redirect HTTPS |
| AUTH-CORS-008 | Helmet headers tồn tại | Gọi login/profile | Có một số security headers do Helmet; cần kiểm tra không làm hỏng CORS |
| AUTH-CORS-009 | Cookie flags không áp dụng | Kiểm tra Set-Cookie trong login response | Không có Set-Cookie auth; do đó không có httpOnly/secure/sameSite để kiểm thử cho auth hiện tại |

### 4.9 Nhóm thông báo lỗi và rò rỉ thông tin

| ID | Mục tiêu | Request/Bước | Kết quả mong đợi |
|---|---|---|---|
| AUTH-ERR-001 | Không lộ email tồn tại | So sánh P_UNKNOWN_EMAIL và P_WRONG_PASSWORD | Cùng HTTP 401, cùng message `Email hoặc mật khẩu không đúng` |
| AUTH-ERR-002 | User inactive không bị phân biệt ở login | P_INACTIVE_USER | HTTP 401 cùng message chung, không báo tài khoản bị khóa ở endpoint login |
| AUTH-ERR-003 | Missing field có message rõ ràng | P_MISSING_EMAIL/P_MISSING_PASSWORD | HTTP 400 message rõ ràng cho UX |
| AUTH-ERR-004 | Profile không token báo rõ | `GET /api/users/profile` không token | HTTP 401 `Chưa đăng nhập` |
| AUTH-ERR-005 | Token invalid báo rõ | Profile token sai | HTTP 401 `Phiên đăng nhập không hợp lệ hoặc đã hết hạn` |
| AUTH-ERR-006 | Response login không lộ password/hash/token_hash | Login thành công | Body không chứa `password`, `token_hash`, secret môi trường, đường dẫn DB |
| AUTH-ERR-007 | Rate limit message không lộ nội bộ | Vượt rate limit | HTTP 429 message tiếng Việt, không stack trace |
| AUTH-ERR-008 | JSON parse error không lộ stack trace | Body JSON lỗi | HTTP 400, không stack trace; message hiện hơi thiên về import dù áp dụng global, cần ghi nhận UX/rủi ro |

## 5. Ví dụ chạy bằng cURL

> Trên Windows cmd.exe, có thể dùng một dòng. Với PowerShell, nên dùng `curl.exe` để tránh alias `Invoke-WebRequest`.

### 5.1 Bootstrap admin nếu môi trường trống

```bash
curl -i -X POST "http://127.0.0.1:3001/api/users/bootstrap-admin" ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Admin Test\",\"email\":\"admin.test@example.com\",\"phone\":\"0909123456\",\"password\":\"Admin@123456\"}"
```

### 5.2 Login thành công

```bash
curl -i -X POST "http://127.0.0.1:3001/api/users/login" ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"admin.test@example.com\",\"password\":\"Admin@123456\"}"
```

Lưu token trả về vào biến thủ công, ví dụ:

```bash
set TOKEN=PASTE_TOKEN_HERE
```

### 5.3 Gọi profile bằng bearer token

```bash
curl -i "http://127.0.0.1:3001/api/users/profile" ^
  -H "Authorization: Bearer %TOKEN%"
```

### 5.4 Login sai mật khẩu

```bash
curl -i -X POST "http://127.0.0.1:3001/api/users/login" ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"admin.test@example.com\",\"password\":\"Wrong@123456\"}"
```

Kỳ vọng HTTP 401 và body có `message` là `Email hoặc mật khẩu không đúng`.

### 5.5 Thiếu email/password

```bash
curl -i -X POST "http://127.0.0.1:3001/api/users/login" ^
  -H "Content-Type: application/json" ^
  -d "{}"
```

Kỳ vọng HTTP 400 và body có `message` là `Vui lòng nhập email và mật khẩu`.

### 5.6 Injection trong email

```bash
curl -i -X POST "http://127.0.0.1:3001/api/users/login" ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"admin.test@example.com' OR '1'='1\",\"password\":\"anything\"}"
```

Kỳ vọng HTTP 401, không bypass đăng nhập.

### 5.7 Logout session hiện tại

```bash
curl -i -X POST "http://127.0.0.1:3001/api/users/logout" ^
  -H "Authorization: Bearer %TOKEN%"
```

Sau đó gọi lại profile bằng token cũ, kỳ vọng HTTP 401.

### 5.8 Logout all

```bash
curl -i -X POST "http://127.0.0.1:3001/api/users/logout-all" ^
  -H "Authorization: Bearer %TOKEN%"
```

Kỳ vọng `{ "ok": true, "revoked": <number> }`, các token khác của cùng user cũng không dùng được.

### 5.9 Kiểm thử CORS origin allowed

```bash
curl -i -X POST "http://127.0.0.1:3001/api/users/login" ^
  -H "Origin: http://localhost:5173" ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"admin.test@example.com\",\"password\":\"Admin@123456\"}"
```

Kỳ vọng có `Access-Control-Allow-Origin: http://localhost:5173`.

### 5.10 Kiểm thử rate limit nhanh

Windows cmd.exe:

```bat
for /L %i in (1,1,25) do curl -s -o NUL -w "%i %%{http_code}\n" -X POST "http://127.0.0.1:3001/api/users/login" -H "Content-Type: application/json" -d "{\"email\":\"admin.test@example.com\",\"password\":\"Wrong@123456\"}"
```

Kỳ vọng các request đầu là 401, request vượt ngưỡng là 429.

## 6. Ví dụ chạy bằng Postman

### 6.1 Tạo environment

Tạo Postman environment `Local Auth QA`:

| Variable | Initial value | Current value |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:3001` | `http://127.0.0.1:3001` |
| `email` | `admin.test@example.com` | `admin.test@example.com` |
| `password` | `Admin@123456` | `Admin@123456` |
| `token` | để trống | để trống |

### 6.2 Request login

- Method: POST
- URL: `{{baseUrl}}/api/users/login`
- Headers: `Content-Type: application/json`
- Body raw JSON:

```json
{
  "email": "{{email}}",
  "password": "{{password}}",
  "device_id": "postman-qa",
  "device_name": "Postman QA",
  "platform": "postman",
  "app_version": "test"
}
```

Tests tab:

```javascript
pm.test('Login returns 200', function () {
  pm.response.to.have.status(200);
});

pm.test('Login payload has token and user', function () {
  const json = pm.response.json();
  pm.expect(json.ok).to.eql(true);
  pm.expect(json.token).to.be.a('string').and.not.empty;
  pm.expect(json.user).to.be.an('object');
  pm.expect(json.session).to.be.an('object');
  pm.environment.set('token', json.token);
});

pm.test('No sensitive fields leaked', function () {
  const raw = pm.response.text();
  pm.expect(raw).to.not.include('token_hash');
  pm.expect(raw).to.not.include('password');
});
```

### 6.3 Request profile

- Method: GET
- URL: `{{baseUrl}}/api/users/profile`
- Authorization: Bearer Token, token = `{{token}}`

Tests tab:

```javascript
pm.test('Profile returns 200', function () {
  pm.response.to.have.status(200);
});

pm.test('Profile session is active', function () {
  const json = pm.response.json();
  pm.expect(json.ok).to.eql(true);
  pm.expect(json.session.revoked_at).to.eql(null);
});
```

### 6.4 Request login wrong password

- Method: POST
- URL: `{{baseUrl}}/api/users/login`
- Body:

```json
{
  "email": "{{email}}",
  "password": "Wrong@123456"
}
```

Tests tab:

```javascript
pm.test('Wrong password returns 401', function () {
  pm.response.to.have.status(401);
});

pm.test('Generic error message', function () {
  const json = pm.response.json();
  pm.expect(json.ok).to.eql(false);
  pm.expect(json.message).to.eql('Email hoặc mật khẩu không đúng');
});
```

### 6.5 Request logout

- Method: POST
- URL: `{{baseUrl}}/api/users/logout`
- Authorization: Bearer Token, token = `{{token}}`

Tests tab:

```javascript
pm.test('Logout returns ok', function () {
  pm.response.to.have.status(200);
  pm.expect(pm.response.json().ok).to.eql(true);
});
```

Sau logout, chạy lại profile với token cũ, kỳ vọng HTTP 401.

## 7. Lỗi tiềm ẩn và rủi ro hiện tại suy ra từ mã nguồn

| Mức độ | Rủi ro | Căn cứ | Tác động |
|---|---|---|---|
| Cao | Token lưu trong localStorage | [`frontend/src/utils/authStorage.js`](../frontend/src/utils/authStorage.js) lưu `kha_token` trong localStorage | Nếu có XSS, attacker có thể lấy bearer token và chiếm phiên |
| Cao | Không có refresh token nhưng session TTL mặc định dài 30 ngày | [`backend/src/middleware/auth.js`](../backend/src/middleware/auth.js) dùng TTL mặc định 30 ngày | Token bị lộ có thời gian khai thác dài nếu chưa logout/revoke |
| Cao | Không ép HTTPS | [`backend/src/server.js`](../backend/src/server.js) phục vụ HTTP theo cấu hình host/port, không redirect HTTPS | Nếu deploy qua mạng không tin cậy, bearer token có thể bị sniff nếu không có TLS phía reverse proxy |
| Cao | CORS cho phép `Origin: null` và có thể wildcard qua env | [`backend/src/server.js`](../backend/src/server.js) xem origin null là allowed và cho phép `*` nếu cấu hình | Tăng bề mặt rủi ro khi chạy file origin/sandbox hoặc cấu hình sai production |
| Trung bình | Chưa có lockout theo tài khoản/email | [`backend/src/routes/users.js`](../backend/src/routes/users.js) chỉ dùng rate limit theo route | Brute force phân tán IP hoặc theo thời gian vẫn có thể tiếp diễn |
| Trung bình | Không có CAPTCHA hoặc step-up auth | Không thấy logic CAPTCHA trong các file auth | UX/bảo mật chưa có lớp phòng vệ khi login sai liên tục |
| Trung bình | Timing enumeration tiềm ẩn | Unknown email trả sớm, wrong password chạy PBKDF2 verify | Có thể đo thời gian để suy luận email tồn tại nếu network ổn định |
| Trung bình | Login backend không validate format email | [`backend/src/routes/users.js`](../backend/src/routes/users.js) chỉ kiểm tra thiếu email/password ở login | UI validate nhưng API trực tiếp nhận input bất kỳ; chủ yếu là rủi ro chất lượng/abuse |
| Trung bình | Thông báo JSON parse error dùng ngữ cảnh import | [`backend/src/server.js`](../backend/src/server.js) global body error trả `Body JSON import không hợp lệ` cho lỗi parse không thuộc import | UX gây nhầm khi login gửi JSON lỗi |
| Trung bình | Tương thích mật khẩu plain text cũ | [`backend/src/utils/password.js`](../backend/src/utils/password.js) cho phép so sánh plain text nếu stored password chưa hash | Hữu ích để migrate nhưng rủi ro nếu DB còn mật khẩu plain text lâu dài |
| Thấp | Không có cookie auth httpOnly/secure/sameSite | Client dùng bearer token localStorage | Không kiểm thử cookie auth được; cần bảo vệ XSS tốt hơn |
| Thấp | Response profile có ip/user_agent/session metadata | [`backend/src/middleware/auth.js`](../backend/src/middleware/auth.js) publicSession trả ip và user_agent | Có thể không cần thiết cho mọi client; cân nhắc tối thiểu hóa dữ liệu |
| Thấp | Login mới không revoke session cũ | [`backend/src/routes/users.js`](../backend/src/routes/users.js) tạo session mới mỗi login | Hợp lệ cho multi-device nhưng tăng số session hoạt động nếu user quên logout |

## 8. Đề xuất cải thiện bảo mật và UX theo ưu tiên

### Ưu tiên P0 - Nên xử lý trước khi triển khai môi trường không tin cậy

1. Bắt buộc HTTPS ở tầng triển khai production, hoặc cấu hình reverse proxy TLS và chỉ cho phép HTTP loopback nội bộ.
2. Thu hẹp CORS production: không dùng wildcard, cân nhắc không cho `Origin: null` ngoài môi trường desktop/local đã kiểm soát.
3. Giảm rủi ro token trong localStorage: cân nhắc chuyển sang cookie httpOnly/secure/sameSite nếu phù hợp kiến trúc, hoặc bổ sung CSP mạnh và rà soát XSS toàn frontend.
4. Thiết lập secret session cố định qua env `KHA_SESSION_SECRET`, không dùng default dựa trên process cwd trong môi trường production.

### Ưu tiên P1 - Nâng khả năng chống brute force và quản trị phiên

1. Bổ sung lockout/cooldown theo email hoặc user id sau nhiều lần sai, nhưng vẫn giữ thông báo chung để tránh enumeration.
2. Ghi nhận số lần login thất bại và audit event cho thất bại, không chỉ login/register/logout thành công.
3. Bổ sung cảnh báo UX khi gần/vượt rate limit, hướng dẫn thử lại sau.
4. Cho phép admin/user xem danh sách phiên đang hoạt động và revoke từng phiên.
5. Cân nhắc rút ngắn TTL hoặc cấu hình TTL theo môi trường; thêm chính sách idle timeout nếu phù hợp.

### Ưu tiên P2 - Cải thiện validation và thông báo lỗi

1. Validate email format ở backend login để đồng nhất với UI, hoặc chủ động giữ message 401 chung nhưng reject input quá bất thường bằng 400 có kiểm soát.
2. Chuẩn hóa lỗi JSON parse cho mọi endpoint, tránh thông điệp `import` khi request login bị JSON lỗi.
3. Xử lý input type nghiêm hơn cho email/password để object/array trả 400 thay vì String hóa ngầm.
4. Bổ sung test tự động cho contract response login/profile/logout.
5. Không trả ip/user_agent trong session nếu UI không cần; hoặc chỉ trả trong màn quản lý phiên.

### Ưu tiên P3 - UX đăng nhập

1. Hiển thị trạng thái rate limit thân thiện, ví dụ `Bạn thử quá nhiều lần, vui lòng thử lại sau ít phút`.
2. Thêm hướng dẫn khi hệ thống chưa setup admin đầu tiên và khi server không kết nối được.
3. Cân nhắc thông báo phiên hết hạn thống nhất giữa API client và màn login.
4. Thêm lựa chọn `đăng xuất khỏi thiết bị khác` sau khi đổi mật khẩu hoặc nghi ngờ lộ tài khoản.

## 9. Checklist thực thi kiểm thử

- [ ] Chuẩn bị môi trường test riêng và base URL.
- [ ] Backup hoặc reset DB test trước khi chạy các case mutate session/logout.
- [ ] Tạo user admin/user/inactive/legacy theo bảng dữ liệu kiểm thử.
- [ ] Chạy nhóm happy path và lưu token/session id để đối chiếu.
- [ ] Chạy nhóm validation và authentication failure.
- [ ] Chạy nhóm token/session, đặc biệt logout và logout-all.
- [ ] Chạy nhóm rate limit trong cửa sổ riêng hoặc giảm env limit để test nhanh.
- [ ] Chạy nhóm brute force và ghi nhận thiếu lockout theo email là hành vi hiện tại.
- [ ] Chạy nhóm injection/XSS bằng cURL/Postman, xác nhận không bypass và không phản chiếu payload.
- [ ] Chạy nhóm CORS/HTTPS/cookie theo origin khác nhau.
- [ ] Kiểm tra response không lộ password, token_hash, stack trace, secret hoặc đường dẫn nhạy cảm.
- [ ] Tổng hợp kết quả pass/fail và map fail vào rủi ro/đề xuất ưu tiên.
