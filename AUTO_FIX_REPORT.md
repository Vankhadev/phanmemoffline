# AUTO_FIX_REPORT.md

## L?i phát hi?n

### 1) OrderList.jsx - nút "Luu thay d?i" lúc du?c lúc không
**Root cause:**
- `getEditProductStockById()` tru?c dây tr? `0` khi chua load du?c `editProducts`.
- `buildSaleStockValidation()` hi?u `0` là t?n kho th?t, d?n t?i projected stock âm.
- `hasEditStockError` b?t sai trong th?i gian d? li?u s?n ph?m dang loading / error / empty.
- Nút Save b? disable ng?u nhiên theo race gi?a open edit và fetch s?n ph?m.

**S?a g?c:**
- Thêm state `editProductsState` v?i các tr?ng thái: `loading`, `loaded`, `error`, `empty`.
- Ch? ch?y stock validation khi d? li?u s?n ph?m dã s?n sàng d? validate.
- Khi loading/error, không disable Save vì l?i t?n kho gi?.
- Tr? `undefined` thay vì `0` khi không có d? li?u stock th?t.
- Hi?n th? thông báo tr?ng thái t?i d? li?u s?n ph?m trong modal edit.

### 2) Customers - thêm l?i nhung không xu?t hi?n
**Root cause:**
- Lu?ng tru?c dó ch? refetch sau POST/PUT, chua d?m b?o state du?c c?p nh?t ngay t? item v?a t?o/c?p nh?t.
- Backend `POST /customers` tru?c dây ch? tr? `{ id, ok: true }`, frontend ph?i t? fetch l?i ngay sau dó.
- `active` có nguy co b? hi?u sai ki?u d? li?u khi l?c/ghi d?c.

**S?a g?c:**
- Backend tr? luôn `item` v?a t?o/c?p nh?t.
- Normalize `active` v? s? 0/1 ? backend.
- Frontend c?p nh?t state ngay b?ng `data.item` r?i m?i refetch xác nh?n.
- `fetchCustomers()`/`fetchCustomerTypes()` chuy?n sang async rõ ràng d? flow d? ki?m soát.

## File dã s?a
- `G:\phanmienoffline\backend\src\routes\customers.js`
- `G:\phanmienoffline\frontend\src\pages\Customers.jsx`
- `G:\phanmienoffline\frontend\src\pages\OrderList.jsx`

## Diff tóm t?t
- Customers API:
  - Tr? `item` trong response POST/PUT.
  - Normalize `active`.
- Customers UI:
  - Update state ngay t? row v?a t?o/c?p nh?t.
  - V?n refetch d? d?ng b?.
- OrderList UI:
  - Thêm `editProductsState`.
  - Gating validation theo tr?ng thái d? li?u.
  - Không dùng `0` làm fallback cho d? li?u stock chua load.

## K?t qu? test
- Syntax backend `customers.js`: OK
- Verify text-level edit flow: OK
- JSX parse b?ng `new Function` không áp d?ng cho React imports, nên không dùng cho ki?m tra cú pháp frontend.

## Race condition dã lo?i b?
- Race gi?a m? edit và fetch s?n ph?m trong OrderList.
- Race gi?a POST customers và render state danh sách.
- Race gi?a refetch và state cu c?a Customers page.

## L?i còn l?i / c?n xem thêm
- Chua ch?y build/lint chính th?c c?a toàn d? án trong lu?t này.
- C?n ch?y ti?p verify runtime trên app n?u mu?n ch?t hoàn toàn.
