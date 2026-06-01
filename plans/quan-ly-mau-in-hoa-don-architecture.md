# Kiến trúc module quản lý mẫu in hóa đơn

## 1. Phạm vi subtask

Subtask này chỉ chốt thiết kế và kế hoạch triển khai cho module quản lý mẫu in hóa đơn, không triển khai code sản phẩm.

Mục tiêu chính:
- Giữ nguyên phần lớn backend hiện tại đang chạy trên JSON DB.
- Tách riêng module `print_templates` sang MySQL thật ngay từ đầu.
- Tận dụng tối đa luồng in hóa đơn A5 đã có để tránh làm vỡ layout hiện tại.
- Chuẩn bị rõ danh sách file cần tạo sửa cho subtask code tiếp theo.

## 2. Hiện trạng codebase đã xác nhận

### 2.1 Backend

- Backend entry đang ở [backend/src/server.js](backend/src/server.js).
- Route hiện tại được mount trực tiếp trong [backend/src/server.js](backend/src/server.js) bằng [`app.use()`](backend/src/server.js:188).
- Lớp dữ liệu chính hiện tại là JSON DB trong [backend/src/db/database.js](backend/src/db/database.js).
- Quyền truy cập hiện được resolve từ JSON DB qua [backend/src/middleware/auth.js](backend/src/middleware/auth.js).
- Endpoint dữ liệu in hóa đơn hiện tại là [`router.get('/:idOrCode/print')`](backend/src/routes/invoices.js:520) trong [backend/src/routes/invoices.js](backend/src/routes/invoices.js).
- Payload in hóa đơn hiện được build bởi [`buildInvoicePrintPayload()`](backend/src/routes/invoices.js:301).
- Thông tin cửa hàng hiện lấy từ bảng JSON `store_info` qua [backend/src/routes/store.js](backend/src/routes/store.js).
- Dependency `multer` đã có trong [backend/package.json](backend/package.json) nhưng chưa được dùng ở bất kỳ route nào.
- Chưa có `express.static` cho thư mục upload trong [backend/src/server.js](backend/src/server.js:122).
- Chưa có dependency MySQL trong [backend/package.json](backend/package.json).
- Có package `dotenv` trong [backend/package.json](backend/package.json) nhưng chưa thấy nơi nào gọi `dotenv.config`, nghĩa là env file chưa được bootstrap ở runtime hiện tại.

### 2.2 Frontend

- Frontend entry đang ở [frontend/src/App.jsx](frontend/src/App.jsx) và [frontend/src/main.jsx](frontend/src/main.jsx).
- Route in hóa đơn hiện tại là `/hoa-don-in/:idOrCode` trong [`<Route />`](frontend/src/App.jsx:442).
- Trang in hóa đơn hiện tại nằm ở [frontend/src/pages/InvoicePrint.jsx](frontend/src/pages/InvoicePrint.jsx).
- Trang này đang fetch dữ liệu thật từ [`invoicesApi.printData()`](frontend/src/utils/apiClient.js:635).
- UI cài đặt hiện đã có cấu trúc tab trong [frontend/src/pages/Settings.jsx](frontend/src/pages/Settings.jsx), rất phù hợp để đặt thêm tab quản lý mẫu in thay vì tạo menu top-level mới.
- CSS in A5 hiện tại nằm trong [frontend/src/index.css](frontend/src/index.css), đã có nhiều quy tắc quan trọng để chống lệch vỡ bảng:
  - [`table-layout: fixed`](frontend/src/index.css:664)
  - [`display: table-header-group`](frontend/src/index.css:670)
  - [`page-break-inside: avoid`](frontend/src/index.css:675)
  - kích thước cột theo `mm` như [`.invoice-col-no`](frontend/src/index.css:695) và [`.invoice-col-money`](frontend/src/index.css:705)
- [frontend/src/utils/apiClient.js](frontend/src/utils/apiClient.js) đã hỗ trợ `FormData` trong lớp fetch dùng chung, nên upload logo không đòi hỏi thay đổi lớn ở transport layer.
- Chưa thấy hạ tầng dark mode toàn cục như lớp `dark` hoặc Tailwind `dark:` trong mã hiện tại.

## 3. Quyết định kiến trúc chính

### 3.1 Tách riêng `print_templates` sang MySQL thật

Khuyến nghị chốt theo hướng:
- Auth, permissions, invoices, store info tiếp tục dùng JSON DB hiện tại.
- Riêng module `print_templates` dùng MySQL thật với pool kết nối riêng.
- Không cố migrate toàn bộ backend sang MySQL trong subtask này.

Lý do:
- Đúng theo phạm vi user đã chốt.
- Tránh đụng sâu vào toàn bộ backend đang ổn định.
- Cho phép subtask code tập trung vào một module độc lập và có rollback rõ ràng.

### 3.2 Không tạo top-level page mới cho quản lý mẫu in

Khuyến nghị:
- Thêm tab mới `print-templates` trong [frontend/src/pages/Settings.jsx](frontend/src/pages/Settings.jsx).
- Không thêm menu sidebar riêng trong giai đoạn đầu.

Lý do:
- Mẫu in là cấu hình hệ thống, phù hợp với khu vực Cài đặt.
- Ít thay đổi nhất tới điều hướng trong [frontend/src/App.jsx](frontend/src/App.jsx).
- Dễ kiểm soát permission theo nhóm settings hoặc permission chuyên biệt.

### 3.3 Tách renderer preview dùng chung

Khuyến nghị:
- Tách phần render A5 hiện đang nằm trực tiếp trong [frontend/src/pages/InvoicePrint.jsx](frontend/src/pages/InvoicePrint.jsx) thành component dùng chung.
- [frontend/src/pages/InvoicePrint.jsx](frontend/src/pages/InvoicePrint.jsx) chỉ còn vai trò container fetch dữ liệu và gọi print download.
- Tab quản lý mẫu in dùng lại đúng renderer này để preview realtime.

Lý do:
- Tránh hai nơi dựng hai layout khác nhau.
- Bảo toàn CSS in hiện có.
- Giảm rủi ro preview đẹp nhưng trang in thực tế lệch.

## 4. Điểm tích hợp chính

## 4.1 Database và khởi tạo schema MySQL

Vì project chưa có migration framework hiện hữu, khuyến nghị dùng mô hình bootstrap cục bộ cho riêng module này:

1. Tạo pool MySQL riêng.
2. Khi backend start, gọi hàm `ensurePrintTemplatesSchema` để chạy `CREATE TABLE IF NOT EXISTS`.
3. Có thêm một script init riêng để deploy production hoặc chạy thủ công khi cần.

Khuyến nghị env riêng cho module:
- `KHA_PRINT_TEMPLATES_MYSQL_URL`
- hoặc bộ biến:
  - `KHA_PRINT_TEMPLATES_MYSQL_HOST`
  - `KHA_PRINT_TEMPLATES_MYSQL_PORT`
  - `KHA_PRINT_TEMPLATES_MYSQL_USER`
  - `KHA_PRINT_TEMPLATES_MYSQL_PASSWORD`
  - `KHA_PRINT_TEMPLATES_MYSQL_DATABASE`

Lưu ý quan trọng:
- Nếu muốn đọc `.env`, cần bootstrap `dotenv` rõ ràng ở startup vì hiện tại chưa có nơi gọi `dotenv.config` trong backend.

## 4.2 Schema đề xuất cho bảng `print_templates`

Khuyến nghị dùng **một bảng chính** là đủ cho phase đầu.

### Cấu trúc bảng đề xuất

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | BIGINT UNSIGNED PK AUTO_INCREMENT | khóa chính |
| `account_id` | BIGINT UNSIGNED NOT NULL | scope theo tài khoản đang dùng trong auth hiện tại |
| `code` | VARCHAR 100 NOT NULL | slug kỹ thuật, unique theo account |
| `name` | VARCHAR 150 NOT NULL | tên mẫu in |
| `description` | VARCHAR 255 NULL | mô tả ngắn |
| `paper_size` | ENUM `A5` | hiện chốt A5 |
| `orientation` | ENUM `portrait`,`landscape` | hỗ trợ dọc ngang |
| `status` | ENUM `draft`,`active`,`archived` | quản trị vòng đời |
| `is_default` | TINYINT 1 NOT NULL DEFAULT 0 | mẫu mặc định theo account |
| `logo_mode` | ENUM `inherit_store`,`upload`,`external_url`,`none` | cách lấy logo |
| `logo_url` | VARCHAR 1024 NULL | khi dùng external url hoặc public url đã resolve |
| `logo_path` | VARCHAR 1024 NULL | đường dẫn file upload tương đối trên backend |
| `settings_json` | JSON NOT NULL | toàn bộ cấu hình layout |
| `schema_version` | INT UNSIGNED NOT NULL DEFAULT 1 | version cấu trúc config |
| `created_by` | BIGINT UNSIGNED NULL | user tạo |
| `updated_by` | BIGINT UNSIGNED NULL | user sửa gần nhất |
| `created_at` | DATETIME NOT NULL | thời điểm tạo |
| `updated_at` | DATETIME NOT NULL | thời điểm sửa |
| `deleted_at` | DATETIME NULL | soft delete |

### Index và ràng buộc

- Unique `account_id + code`
- Unique `account_id + name`
- Index `account_id + is_default + deleted_at`
- Index `account_id + status + deleted_at`

### Quy tắc nghiệp vụ

- Mỗi `account_id` chỉ có một mẫu `is_default = 1`.
- Khi set mặc định phải chạy transaction:
  1. clear default của account
  2. set template đích thành default
- Không hard delete ngay logo file khi template bị soft delete trừ khi có cleanup rõ ràng.

## 4.3 Gợi ý cấu trúc `settings_json`

`settings_json` nên là nguồn sự thật cho layout, thay vì tách quá nhiều cột vật lý.

Nhóm cấu hình nên có:
- `page`
  - `size`
  - `orientation`
  - `paddingMm`
- `branding`
  - `showLogo`
  - `logoWidthMm`
  - `storeNameUppercase`
  - `headerBorder`
- `content`
  - `showCustomerTaxCode`
  - `showDeliveryDate`
  - `showCreator`
  - `showQr`
  - `showSignatures`
  - `showFooter`
- `table`
  - `fontSizePt`
  - `headerFontSizePt`
  - `lineClamp`
  - `columns`
    - `no`
    - `name`
    - `qty`
    - `unitPrice`
    - `lineTotal`
  - `columnWidthsMm`
- `totals`
  - `showVat`
  - `showDiscount`
  - `showDeliveryFee`
- `theme`
  - `primaryColor`
  - `mutedColor`
  - `borderColor`
- `print`
  - `forceWhiteBackground`
  - `exactColorAdjust`

Khuyến nghị validate JSON ở backend trước khi lưu để tránh lưu template làm vỡ layout.

## 4.4 Backend API cần thêm

Khuyến nghị route mới: `/api/print-templates`

| Method | Path | Mục đích |
|---|---|---|
| GET | `/api/print-templates` | danh sách mẫu in theo account |
| GET | `/api/print-templates/default` | lấy mẫu mặc định |
| GET | `/api/print-templates/:id` | lấy chi tiết một mẫu |
| POST | `/api/print-templates` | tạo mẫu mới |
| PUT | `/api/print-templates/:id` | cập nhật mẫu |
| POST | `/api/print-templates/:id/set-default` | đặt mặc định |
| POST | `/api/print-templates/:id/logo` | upload hoặc thay logo |
| DELETE | `/api/print-templates/:id/logo` | xóa logo của mẫu |
| DELETE | `/api/print-templates/:id` | soft delete mẫu |

### Permission đề xuất

Thêm 2 permission vào [backend/src/db/database.js](backend/src/db/database.js):
- `print_templates.read`
- `print_templates.manage`

Khuyến nghị:
- chỉ admin mặc định có quyền manage
- user thường không tự có quyền này trong `DEFAULT_USER_PERMISSION_KEYS`

## 4.5 Tích hợp route và upload ở backend

### Cần sửa ở [backend/src/server.js](backend/src/server.js)

1. Import route mới `printTemplatesRoutes`.
2. Mount route mới bằng auth middleware và permission middleware.
3. Khởi tạo schema MySQL trước khi `app.listen`.
4. Đăng ký static file cho logo upload.

Khuyến nghị static public:
- URL public: `/static/print-templates`
- Thư mục vật lý: `backend/data/uploads/print-templates`

Lý do chọn public static:
- thẻ `img` trong preview và print không tự gửi Bearer token
- đơn giản hơn cho Chrome Edge Cốc Cốc
- dễ tái sử dụng trong `html2canvas` và `react-to-print`

### Multer

Vì `multer` đã có dependency nhưng chưa dùng, khuyến nghị tạo middleware riêng cho module này:
- giới hạn mime chỉ nhận ảnh phổ biến
- giới hạn dung lượng rõ ràng
- tên file random và sanitize
- cleanup file cũ khi replace logo

## 4.6 Tích hợp với endpoint in hóa đơn hiện có

Khuyến nghị **không tạo endpoint in hoàn toàn mới**.

Thay vào đó, mở rộng [`buildInvoicePrintPayload()`](backend/src/routes/invoices.js:301) và endpoint [`router.get('/:idOrCode/print')`](backend/src/routes/invoices.js:520) để:
- resolve template mặc định theo `req.accountId`
- cho phép override tạm bằng query `template_id` nếu cần QA
- trả thêm `template` vào payload in hóa đơn

Khuyến nghị payload in sau cùng có thêm:
- `template.id`
- `template.name`
- `template.code`
- `template.orientation`
- `template.settings`
- `template.logo_url_resolved`

Lợi ích:
- Trang in chỉ cần một request chính.
- PDF download và print dialog luôn dùng cùng một nguồn dữ liệu.
- Nếu sau này có Electron native print hoặc export server-side thì cùng dùng được payload này.

## 4.7 Frontend route page menu tab

### Khuyến nghị chính

- Không thêm route top-level mới.
- Thêm tab `print-templates` vào [frontend/src/pages/Settings.jsx](frontend/src/pages/Settings.jsx).
- Route vẫn là `/cai-dat`.
- Nếu cần deep-link, dùng query như `#/cai-dat?tab=print-templates`.

### Vì sao không thêm page riêng ngay

- Cấu trúc tab cài đặt đã sẵn có.
- Giảm sửa ở điều hướng sidebar trong [frontend/src/App.jsx](frontend/src/App.jsx).
- Người dùng nhìn nhận đây là cấu hình hệ thống hơn là nghiệp vụ bán hàng hàng ngày.

### Nhưng vẫn cần sửa [frontend/src/App.jsx](frontend/src/App.jsx)

Dù không thêm route mới, vẫn nên sửa:
- `ROUTE_PERMISSIONS` cho `/cai-dat` để nhận thêm `print_templates.read` và `print_templates.manage`
- nếu có logic tab deep-link hoặc tab icon thì giữ thống nhất với settings

## 4.8 Component preview và renderer

Khuyến nghị tách như sau:

### Renderer dùng chung

Tạo component mới, ví dụ:
- `frontend/src/components/invoice-print/InvoiceTemplateRenderer.jsx`

Nó nhận vào:
- `invoicePayload`
- `templateSettings`
- `resolvedAssets`
- `mode` `preview` hoặc `print`

### Container trang in

[frontend/src/pages/InvoicePrint.jsx](frontend/src/pages/InvoicePrint.jsx) sẽ còn trách nhiệm:
- đọc route param
- gọi API in hóa đơn
- gọi print download pdf
- truyền dữ liệu vào renderer dùng chung

### Tab quản lý mẫu in

Tạo component tab mới, ví dụ:
- `frontend/src/components/settings/PrintTemplatesTab.jsx`

Tab này có 2 cột:
- cột trái: danh sách template + form chỉnh sửa + upload logo + nút set default
- cột phải: preview realtime A5 dùng chung renderer

### Dữ liệu preview

Khuyến nghị không gọi API preview riêng.

Dùng một trong hai cách:
- sample invoice payload nội bộ cho preview editor
- hoặc cho chọn một hóa đơn thật làm mẫu preview sau này

Phase đầu nên dùng sample payload nội bộ để editor hoạt động ổn định, không phụ thuộc dữ liệu đơn hàng thực.

## 4.9 Ảnh logo và URL resolve ở frontend

Vì frontend dev thường chạy khác port backend, logo upload không nên được dùng trực tiếp như path tương đối thuần.

Khuyến nghị:
- backend lưu `logo_path` tương đối
- API trả `logo_url` public tương đối như `/static/print-templates/...`
- renderer frontend phải resolve ảnh qua helper URL hiện có trong [frontend/src/utils/apiClient.js](frontend/src/utils/apiClient.js), thay vì gắn raw path trực tiếp

Điểm tốt hiện có:
- lớp fetch chung đã xử lý `FormData`
- helper URL hiện tại có thể tái sử dụng để build absolute URL backend

## 5. Danh sách file cần tạo và sửa

## 5.1 Backend tạo mới

| File | Vai trò |
|---|---|
| `backend/src/db/printTemplatesMySql.js` | pool MySQL, query helper, transaction helper |
| `backend/src/db/printTemplatesSchema.js` | `CREATE TABLE IF NOT EXISTS` và bootstrap schema |
| `backend/src/routes/printTemplates.js` | CRUD API + set default + logo endpoints |
| `backend/src/middleware/printTemplateUpload.js` | cấu hình multer upload logo |
| `backend/scripts/init-print-templates-mysql.js` | script init schema thủ công cho deploy CI production |

## 5.2 Backend cần sửa

| File | Lý do |
|---|---|
| [backend/package.json](backend/package.json) | thêm `mysql2` và script init nếu cần |
| [backend/src/server.js](backend/src/server.js) | bootstrap MySQL schema, mount route, static assets |
| [backend/src/db/database.js](backend/src/db/database.js) | thêm permission `print_templates.read` và `print_templates.manage` |
| [backend/src/routes/invoices.js](backend/src/routes/invoices.js) | ghép template vào payload in hiện có |

## 5.3 Frontend tạo mới

| File | Vai trò |
|---|---|
| `frontend/src/components/invoice-print/InvoiceTemplateRenderer.jsx` | renderer A5 dùng chung cho print và preview |
| `frontend/src/components/invoice-print/templateDefaults.js` | config mặc định và normalizer |
| `frontend/src/components/invoice-print/mockInvoicePayload.js` | dữ liệu preview realtime cho editor |
| `frontend/src/components/settings/PrintTemplatesTab.jsx` | UI CRUD quản lý mẫu in |

## 5.4 Frontend cần sửa

| File | Lý do |
|---|---|
| [frontend/src/utils/apiClient.js](frontend/src/utils/apiClient.js) | thêm `printTemplatesApi` và helper upload logo |
| [frontend/src/pages/Settings.jsx](frontend/src/pages/Settings.jsx) | thêm tab `print-templates` và điều khiển quyền |
| [frontend/src/pages/InvoicePrint.jsx](frontend/src/pages/InvoicePrint.jsx) | chuyển thành container dùng renderer chung |
| [frontend/src/App.jsx](frontend/src/App.jsx) | mở quyền route `/cai-dat` cho permission mới nếu cần |
| [frontend/src/index.css](frontend/src/index.css) hoặc file CSS tách riêng | giữ và mở rộng CSS in A5 cùng preview editor |

## 6. Thứ tự triển khai khuyến nghị

1. **Chuẩn bị backend MySQL riêng cho module**
   - thêm dependency `mysql2`
   - chốt env strategy
   - bootstrap schema riêng cho `print_templates`

2. **Bổ sung permission và route backend**
   - thêm permission mới vào JSON auth layer
   - tạo route CRUD và set default
   - thêm upload logo và static serving

3. **Mở rộng endpoint in hóa đơn hiện tại**
   - resolve template mặc định
   - merge `template` vào payload in
   - giữ backward compatibility nếu template chưa có

4. **Tách renderer in A5 dùng chung ở frontend**
   - rút markup từ [frontend/src/pages/InvoicePrint.jsx](frontend/src/pages/InvoicePrint.jsx)
   - giữ nguyên các CSS chống lệch bảng đang hoạt động

5. **Thêm API client và tab quản lý mẫu in**
   - thêm `printTemplatesApi`
   - thêm tab `print-templates` trong Settings
   - CRUD, set default, upload logo, preview realtime

6. **Hoàn thiện trải nghiệm production**
   - validate config đầu vào
   - cleanup logo cũ
   - fallback khi MySQL lỗi
   - kiểm thử Chrome Edge Cốc Cốc và PDF download

## 7. Rủi ro và điểm lưu ý cho subtask code

### 7.1 JSON DB và MySQL sẽ cùng tồn tại

Đây là quyết định chủ động, nhưng cần tránh để lỗi MySQL làm sập backend bán hàng hiện có.

Khuyến nghị:
- nếu MySQL module lỗi, route `/api/print-templates` trả `503`
- route in hóa đơn vẫn có fallback template mặc định trong code để không chặn bán hàng

### 7.2 Chưa có bootstrap env rõ ràng

Vì chưa thấy `dotenv.config`, nếu dev chỉ thêm biến vào `.env` nhưng không bootstrap thì MySQL sẽ không kết nối được.

### 7.3 Static logo dễ lỗi khác origin

Nếu logo trả path tương đối mà renderer không resolve đúng base backend, preview ảnh sẽ hỏng khi frontend chạy port khác backend.

### 7.4 Chỉ một template mặc định

Phải dùng transaction khi set mặc định để tránh hai record cùng `is_default = 1` khi có thao tác đồng thời.

### 7.5 Cleanup file logo

Khi thay logo hoặc xóa template phải dọn file cũ đúng lúc, nhưng không xóa nhầm file đang được template khác dùng lại.

### 7.6 Không có dark mode infra toàn cục

Hiện tại chưa thấy hệ thống dark mode thật sự trong app, nên subtask code chỉ nên bảo đảm:
- phần editor quản lý mẫu in dùng màu trung tính và tương phản đủ tốt
- vùng preview giấy in luôn nền trắng cố định
- không phụ thuộc vào class `dark` chưa tồn tại

### 7.7 Không nên viết lại CSS in từ đầu

CSS in hiện tại đã có nhiều tinh chỉnh đúng hướng cho A5 và bảng sản phẩm. Nên tái sử dụng nền tảng đang có thay vì thay toàn bộ.

## 8. Mermaid tổng quan

```mermaid
flowchart LR
A[Settings tab print templates] --> B[printTemplatesApi]
B --> C[/api/print-templates]
C --> D[MySQL print_templates]
C --> E[logo upload storage]
F[InvoicePrint page] --> G[/api/invoices id print]
G --> H[JSON DB invoices store auth]
G --> D
F --> I[shared invoice renderer]
A --> I
```

## 9. Kết luận chốt cho subtask code tiếp theo

Hướng triển khai nên là:
- giữ backend hiện hữu trên JSON DB
- thêm một module MySQL độc lập chỉ cho `print_templates`
- quản lý mẫu in dưới tab mới trong [frontend/src/pages/Settings.jsx](frontend/src/pages/Settings.jsx)
- tách renderer A5 dùng chung để preview realtime và trang in thật dùng cùng một layout
- mở rộng payload từ [backend/src/routes/invoices.js](backend/src/routes/invoices.js) để trang in lấy luôn template đã resolve

Đây là phương án ít rủi ro nhất, đúng phạm vi user yêu cầu, và phù hợp cấu trúc codebase hiện tại.