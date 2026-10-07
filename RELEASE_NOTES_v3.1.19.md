# Bán Hàng Pos v3.1.19 - Ghi chú phát hành

**Ngày phát hành:** 07/10/2026

---

### 🚀 Tính năng mới nổi bật

1. **Xuất Excel Báo cáo Thuế GTGT chuyên sâu:**
   - Bổ sung nút **Xuất Excel** trực tiếp tại trang Báo cáo thuế GTGT (`/tax-report`).
   - Kết xuất file Excel `.xlsx` chuẩn kế toán doanh nghiệp gồm 3 Sheet đầy đủ:
     - **Sheet 1 - Tổng hợp thuế GTGT**: Tóm tắt doanh thu bán ra chịu thuế, thuế GTGT đầu ra, giá trị mua vào, thuế GTGT đầu vào được khấu trừ, và số thuế GTGT phải nộp kỳ này (hoặc còn khấu trừ chuyển kỳ sau).
     - **Sheet 2 - Bảng kê bán ra (Đầu ra)**: Liệt kê chi tiết toàn bộ hóa đơn/chứng từ bán hàng với ngày, số hóa đơn, tên người mua, doanh thu chịu thuế, tiền thuế GTGT và dòng tổng cộng.
     - **Sheet 3 - Bảng kê mua vào (Đầu vào)**: Liệt kê chi tiết toàn bộ phiếu nhập kho/hóa đơn đầu vào với ngày, số hóa đơn, nhà cung cấp, giá trị chịu thuế, thuế GTGT đầu vào và dòng tổng cộng.

2. **Chuẩn hóa Bộ chọn Tháng Báo cáo tiếng Việt (Tháng 1 - Tháng 12):**
   - Thay thế ô input tháng mặc định của trình duyệt (thường hiển thị tiếng Anh như "August 2026") bằng 2 dropdown thuần Việt tiện dụng:
     - Dropdown chọn **Tháng**: Từ **Tháng 1** đến **Tháng 12**.
     - Dropdown chọn **Năm**: 2023 đến 2030.
   - Thao tác chọn tháng tự động cập nhật và nạp lại báo cáo ngay lập tức.

3. **Tích hợp sẵn bản quyền Google Gemini AI & Thị giác Đa phương thức (Vision):**
   - Tích hợp sẵn API Key bản quyền Google Gemini AI vào hệ thống; khách hàng cập nhật phiên bản mới là dùng được ngay toàn bộ tính năng Trợ lý AI Kế toán, Phân tích dòng tiền, Soạn tin nhắc nợ và Hỏi đáp thông minh mà không cần phải tự cấu hình hay nhập key.
   - Trợ lý AI hỗ trợ đa phương thức (Multimodal Vision): Cho phép chụp ảnh màn hình dán trực tiếp (`Ctrl+V`) hoặc kéo thả file ảnh vào khung chat để AI đọc ảnh hóa đơn, biên nhận chuyển khoản và hướng dẫn xử lý.
   - Bot AI được nạp toàn bộ tri thức về các menu, tính năng và nghiệp vụ bán hàng trong phần mềm để chỉ dẫn người dùng một cách chính xác nhất.

4. **Nâng cấp Danh sách Đơn hàng (`/orders`):**
   - Bổ sung tính năng **Xuất Excel** danh sách đơn hàng đầy đủ 17 cột dữ liệu (Mã đơn, Khách hàng, SĐT, Sản phẩm, Tổng tiền, Giảm giá, Nợ cũ, Đã thu, Còn nợ, Phương thức thanh toán, Người bán, Ngày tạo...).
   - Bổ sung bộ lọc ngày nhanh: Hôm nay, Hôm qua, 7 ngày qua, Tháng này, hoặc tùy chọn Từ ngày - Đến ngày.

---
