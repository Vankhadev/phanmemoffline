# Changelog

## v1.7.5 - 2026-06-13

### Fixed

- Báo cáo đơn hàng theo khách hàng: Cải thiện tìm kiếm gợi ý tên khách hàng, hiển thị danh sách tất cả khách hàng.
- Sửa đơn hàng: Cập nhật giá sản phẩm thêm mới và sản phẩm trong giỏ hàng theo đúng nhóm/loại giá của khách hàng (Sỉ, VIP, Lẻ).

## v1.7.4 - 2026-06-13

### Fixed

- Sửa lỗi không gõ được dấu cách (phím Space) tại ô nhập dịch vụ khác ở màn hình tạo đơn hàng.

## v1.7.3 - 2026-06-13

### Fixed

- Sửa lỗi trắng màn hình và `ReferenceError: Cannot access variable before initialization` trong `Settings` và `ProductReport` do Temporal Dead Zone (TDZ).

## v1.7.2 - 2026-06-13

### Thay doi chinh

- Đồng bộ dữ liệu realtime giữa các tab (Realtime Multi Tab Sync).
- Hệ thống backup đa tầng và tự khôi phục sau mất điện.
- Nâng cấp hệ thống báo cáo và bảo trì tự động 15h.

## v1.6.7 - 2026-06-12

### Thay doi chinh

- Xac nhan luong tao don khong con bao loi "Ma SKU da ton tai".
- SKU san pham tiep tuc duoc phep lap lai tren nhieu don hang; chi kiem tra ton tai trong danh muc san pham.
- Bo sung kiem tra lai bang 1000 don cung mot SKU de dam bao khong phat sinh duplicate SKU.

### Phat hanh

- Dong bo version 1.6.4 cho ung dung desktop, frontend, backend va lockfile.
- Tao tag GitHub `v1.6.4` va release GitHub theo workflow hien tai.

## v1.6.3 - 2026-06-11

### Thay doi chinh

- Sua luong tao don de SKU chi duoc kiem tra trong danh muc san pham, khong chan SKU da tung xuat hien trong hoa don hoac dong hoa don.
- Cho phep mot SKU xuat hien trong nhieu don hang; giu `invoice_code` la ma duy nhat cua tung don.
- Chuan hoa thong bao SKU khong ton tai va bo sung migration SQL xoa UNIQUE INDEX sai tren SKU cua bang don hang, thay bang INDEX thuong.
- Bo sung test hoi quy tao 1000 don hang cung mot SKU va xac nhan tat ca don deu tao thanh cong.

### Phat hanh

- Dong bo version 1.6.3 cho ung dung desktop, frontend, backend va cac lockfile.
- Tao tag GitHub `v1.6.3`; GitHub Actions se build/publish cac goi phat hanh theo workflow hien tai.

## v1.6.0 - 2026-06-10

### Thay doi chinh

- Chuan hoa sinh ma chung tu toan he thong: don ban hang `HD`, phieu nhap `PN`, san pham `SP`; moi loai dung bo dem rieng va chan trung ma o lop backend.
- Cho phep nhap tay ma phieu nhap nha cung cap khi tao phieu nhap; neu de trong he thong tu sinh ma `PN`, ma da cap khong duoc doi va khong tai su dung.
- Bo sung dong dich vu khac trong man hinh tao don, cho nhap ten dich vu, so luong, don gia, chiet khau va tinh thanh tien truc tiep trong bang.
- Khi bam vao o tim san pham o trang tao don, hien ngay danh sach san pham de chon nhanh ke ca khi chua nhap tu khoa.
- Dong bo hien thi ten san pham/combo/dich vu va cac luong import/export lien quan den ma san pham.

### Phat hanh

- Dong bo version phat hanh 1.6.0 cho ung dung desktop, frontend, backend va cac lockfile tuong ung.
- Tao tag GitHub `v1.6.0`; GitHub Actions se build/publish installer Windows x64 va ia32 kem latest.yml/update-manifest.json.

## v1.5.9 - 2026-06-10

### Thay doi chinh

- Chan trung ma phieu nhap va ma don hang; bo sung migration tu dong sua cac ma hoa don bi lap trong du lieu cu va dong bo lai bo dem `invoice_seq`.
- Cai thien bao cao theo don hang: tim/goi y khach hang bang o tim kiem, chon khach tu dropdown va xu ly loi API an toan hon.
- Sua cau hinh API frontend/development proxy de bo qua placeholder env chua duoc resolve nhu `%KHA_BACKEND_PORT%` va fallback ve backend local `3001`.
- Dong bo cac thay doi ung dung/mobile hien co, icon va cau hinh build phuc vu phat hanh.

### Phat hanh

- Dong bo version phat hanh 1.5.9 cho ung dung desktop, frontend, backend va cac lockfile tuong ung.
- Tao tag GitHub `v1.5.9`; GitHub Actions se build/publish installer Windows x64 va ia32 kem latest.yml/update-manifest.json.

## v1.5.7 - 2026-06-09

### Thay doi chinh

- Phat hanh lai ban cap nhat sau khi sua quy trinh release de GitHub Actions build va upload day du installer/metadata truoc khi nguoi dung tai ve.
- Giu nguyen cac cap nhat cua v1.5.6: quan ly san TMDT, dong bo tab, bao cao loi nhuan, mau in hoa don va lich chon khoang ngay bao cao san pham.

### Phat hanh

- Dong bo version phat hanh 1.5.7 cho ung dung desktop, frontend, backend va cac lockfile tuong ung.
- Tao tag GitHub `v1.5.7`; GitHub Actions se build/publish installer Windows x64 va ia32 kem latest.yml/update-manifest.json.

## v1.5.4 - 2026-06-09

### Thay đổi chính

- Thiết kế lại luồng thêm sản phẩm trong trang nhập hàng: khi bấm Thêm sản phẩm/Chọn nhiều sẽ mở modal chọn sản phẩm giống trang tạo đơn hàng.
- Modal nhập hàng hỗ trợ tìm kiếm sản phẩm, ảnh/placeholder, thông tin tồn kho, nút cộng nhanh và chỉnh số lượng trực tiếp bằng nút +/- hoặc ô nhập.
- Khi bấm Chọn xong, danh sách đã chọn được đưa xuống bảng nhập hàng, tự gộp sản phẩm trùng và vẫn cho chỉnh số lượng, giá nhập, chiết khấu, thuế trong bảng.

### Phát hành

- Đồng bộ version phát hành 1.5.4 cho ứng dụng desktop, frontend, backend và các lockfile tương ứng.
- Tạo tag GitHub `v1.5.4`; GitHub Actions sẽ build/publish installer Windows x64 và ia32 kèm latest.yml/update-manifest.json.

## v1.5.3 - 2026-06-09

### Thay đổi chính

- Thiết kế lại trang nhập hàng theo bố cục Sapo: tách thông tin nhà cung cấp và thông tin đơn, đưa bảng sản phẩm ra toàn chiều rộng, bổ sung thanh tìm nhanh/chọn nhiều và khu ghi chú, thanh toán phía dưới.
- Bổ sung công tắc ON/OFF cho từng dòng trong khối tổng tiền của mẫu hóa đơn, gồm Tổng tiền hàng, Chiết khấu, Tổng tiền và Công nợ; trạng thái áp dụng đồng thời cho canvas thiết kế và bản in thật.
- Tối ưu trình chỉnh sửa mẫu in: kéo/resize cập nhật cục bộ theo khung hình, chỉ ghi layout khi thả chuột, tạm dừng preview in thật trong lúc kéo và giữ ổn định vị trí khối tổng tiền tự động.

### Phát hành

- Đồng bộ version phát hành 1.5.3 cho ứng dụng desktop, frontend, backend và các lockfile tương ứng.
- Tạo tag GitHub `v1.5.3`; GitHub Actions sẽ build/publish installer Windows x64 và ia32 kèm latest.yml/update-manifest.json.

## v1.5.2 - 2026-06-09

### Thay đổi chính

- Cải thiện mẫu in hóa đơn: tổng tiền có thể tự bám dưới bảng sản phẩm theo độ dài đơn hàng và phần chữ ký chỉ còn nhãn Khách hàng/Người bán kèm dòng ký tên.
- Thiết kế lại popup chọn nhanh sản phẩm theo phong cách Sapo: tìm kiếm, ảnh/placeholder, tồn kho/có thể bán, nút cộng/trừ số lượng và nút Chọn xong.
- Làm mới giao diện tạo đơn hàng theo bố cục Sapo với topbar hành động, thẻ thông tin khách hàng, thông tin bổ sung, bảng sản phẩm có cột ảnh và khu tổng tiền.
- Làm mới giao diện nhập hàng theo bố cục Sapo với topbar phát hành phiếu, thẻ nhà cung cấp, thông tin đơn nhập hàng, bảng sản phẩm có cột ảnh/đơn vị và empty-state rõ ràng.

### Phát hành

- Đồng bộ version phát hành 1.5.2 cho ứng dụng desktop, frontend, backend và các lockfile tương ứng.
- Tạo tag GitHub `v1.5.2`; GitHub Actions sẽ build/publish installer Windows x64 và ia32 kèm latest.yml/update-manifest.json.

## v1.5.1 - 2026-06-09

### Thay đổi chính

- Bổ sung trình chỉnh sửa mẫu in hóa đơn kiểu kéo thả/Sapo: resize khung, căn chỉnh bằng ruler/snap grid, autosave draft và publish layout in thật.
- Thêm fallback mẫu in local khi thiếu cấu hình MySQL cho module mẫu in, giúp trang cài đặt và trang in vẫn thao tác được.
- Cải thiện luồng tạo đơn: chọn nhanh sản phẩm qua danh sách tạm, bấm "Thêm vào đơn" rồi chỉnh số lượng, giá, chiết khấu trong bảng đơn hàng.
- Thêm lựa chọn in tạm tính/in hóa đơn, chọn kiểu máy in, khổ K80/K57/A5/A4 và scale nội dung trước khi mở hộp thoại in.
- Cho phép chỉnh kích thước khung bảng sản phẩm trong mẫu in và chỉnh độ đậm font nội dung/header của bảng.

### Phát hành

- Đồng bộ version phát hành 1.5.1 cho ứng dụng desktop, frontend, backend và các lockfile tương ứng.
- Tạo tag GitHub `v1.5.1` cho bản release này.

## v1.5.0 - 2026-06-06

### Thay đổi chính

- Bổ sung nền tảng module kế toán: schema JSON cho ledger, quỹ kế toán, tài khoản ngân hàng, công nợ, hóa đơn điện tử, snapshot báo cáo và nhật ký hoạt động.
- Thêm API/page kế toán cho tổng quan doanh thu/lợi nhuận, báo cáo thuế GTGT, báo cáo tồn kho và nhật ký hoạt động; hỗ trợ phân quyền mới cho kế toán, thu ngân, nhân viên.
- Kết nối luồng bán hàng/nhập hàng với kế toán: ghi bút toán, quỹ, công nợ, hóa đơn điện tử, đảo bút toán khi hủy và log thao tác nghiệp vụ.
- Cải thiện kiểm soát tồn kho và thao tác chọn số lượng: báo cáo tồn kho có cảnh báo sắp hết/hết/âm kho, order/import picker dùng QuantityStepper và kiểm tra âm kho.

### Vận hành và dữ liệu

- Tạo backup database JSON trước migration kế toán và backup định kỳ/startup với retention cấu hình được; tự dọn đơn đã hủy quá 24 giờ khi tải danh sách hoặc theo lịch.
- Mở rộng sync metadata/pull có giới hạn cho các bảng kế toán mới để tránh kéo payload quá lớn.

### Phát hành

- Đồng bộ version phát hành 1.5.0 cho ứng dụng desktop, frontend, backend và các lockfile tương ứng.
- Cập nhật tài liệu release, hướng dẫn tải/cài đặt và manifest ví dụ theo tag v1.5.0.
- GitHub Actions sẽ build/publish installer Windows x64 và ia32 kèm latest.yml/update-manifest.json từ artifact thực tế sau khi push tag.

### Lưu ý quan trọng

- Windows 10/11 64-bit nên dùng `banhangoffline-setup-v1.5.0-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn” nên dùng `banhangoffline-setup-v1.5.0-ia32.exe`.
- Chỉ tải bộ cài từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới, đặc biệt vì bản này có migration schema kế toán và tự tạo backup trước migration.
- Metadata production generated latest.yml/update-manifest.json chỉ sinh lại từ installer thực tế, không chỉnh tay trước publish.

## v1.4.9 - 2026-06-03

### Thay đổi chính

- Bổ sung API tồn kho backend và route inventory để phục vụ nghiệp vụ kho hàng.
- Cải thiện luồng nhập hàng, đồng bộ và điều chỉnh tồn kho giữa backend và frontend.
- Cập nhật giao diện kho hàng/nhập hàng để thao tác tồn kho ổn định hơn trong bản phát hành này.

### Phát hành

- Đồng bộ version phát hành 1.4.9 cho ứng dụng desktop, frontend, backend và các lockfile tương ứng.
- Cập nhật tài liệu release, hướng dẫn tải/cài đặt và manifest ví dụ theo tag v1.4.9.
- GitHub Actions tiếp tục build/publish installer Windows x64 và ia32 kèm latest.yml/update-manifest.json từ artifact thực tế sau khi push tag.

### Lưu ý quan trọng

- Windows 10/11 64-bit nên dùng `banhangoffline-setup-v1.4.9-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn” nên dùng `banhangoffline-setup-v1.4.9-ia32.exe`.
- Chỉ tải bộ cài từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới.

## v1.4.8 - 2026-06-03

### Phát hành

- Đồng bộ version phát hành 1.4.8 cho ứng dụng desktop, frontend, backend và các lockfile tương ứng.
- Cập nhật tài liệu release, hướng dẫn tải/cài đặt và manifest ví dụ theo tag v1.4.8.
- GitHub Actions tiếp tục build/publish installer Windows x64 và ia32 kèm latest.yml/update-manifest.json từ artifact thực tế sau khi push tag.

### Lưu ý quan trọng

- Windows 10/11 64-bit nên dùng `banhangoffline-setup-v1.4.8-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn” nên dùng `banhangoffline-setup-v1.4.8-ia32.exe`.
- Chỉ tải bộ cài từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới.


## v1.4.7 - 2026-06-03

### Phát hành

- Đồng bộ version phát hành 1.4.7 cho ứng dụng desktop, frontend, backend và các lockfile tương ứng.
- Cập nhật tài liệu release, hướng dẫn tải/cài đặt và manifest ví dụ theo tag v1.4.7.
- GitHub Actions tiếp tục build/publish installer Windows x64 và ia32 kèm latest.yml/update-manifest.json từ artifact thực tế sau khi push tag.

### Lưu ý quan trọng

- Windows 10/11 64-bit nên dùng `banhangoffline-setup-v1.4.7-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn” nên dùng `banhangoffline-setup-v1.4.7-ia32.exe`.
- Chỉ tải bộ cài từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới.

## v1.4.6 - 2026-06-02

### Phát hành

- Đồng bộ version phát hành 1.4.6 cho ứng dụng desktop, frontend, backend và các lockfile tương ứng.
- Cập nhật tài liệu release, hướng dẫn tải/cài đặt và manifest ví dụ theo tag v1.4.6.
- Giữ nguyên metadata production generated cho tới khi có installer v1.4.6 thực tế để sinh lại SHA/size an toàn.

### Lưu ý quan trọng

- Windows 10/11 64-bit nên dùng `banhangoffline-setup-v1.4.6-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn” nên dùng `banhangoffline-setup-v1.4.6-ia32.exe`.
- Chỉ tải bộ cài từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới.

## v1.4.4 - 2026-06-02

### Phát hành

- Đồng bộ version phát hành 1.4.4 cho ứng dụng desktop, frontend, backend và các lockfile tương ứng.
- Cập nhật tài liệu release, hướng dẫn tải/cài đặt và manifest ví dụ theo tag v1.4.4.
- Giữ nguyên metadata production generated cho tới khi có installer v1.4.4 thực tế để sinh lại SHA/size an toàn.

### Lưu ý quan trọng

- Windows 10/11 64-bit nên dùng `banhangoffline-setup-v1.4.4-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn” nên dùng `banhangoffline-setup-v1.4.4-ia32.exe`.
- Chỉ tải bộ cài từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới.

## v1.4.3 - 2026-06-02

### Phát hành

- Đồng bộ version phát hành 1.4.3 cho ứng dụng desktop, frontend, backend và các lockfile tương ứng.
- Cập nhật changelog, tài liệu release, hướng dẫn tải/cài đặt và manifest ví dụ theo tag v1.4.3.
- Giữ nguyên metadata production generated cho tới khi có installer v1.4.3 thực tế để sinh lại SHA/size an toàn.

### Lưu ý quan trọng

- Windows 10/11 64-bit nên dùng `banhangoffline-setup-v1.4.3-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn” nên dùng `banhangoffline-setup-v1.4.3-ia32.exe`.
- Chỉ tải bộ cài từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới.

## v1.4.2 - 2026-06-01

### Tính năng và cải tiến

- Bổ sung module quản lý mẫu in hóa đơn với API backend, schema MySQL, upload asset an toàn và service CRUD/kích hoạt mẫu in.
- Cập nhật frontend quản lý mẫu in hóa đơn gồm danh sách mẫu, form cấu hình, xem trước renderer và dữ liệu mẫu để kiểm tra bố cục.
- Kết nối điều hướng, thiết lập, API client và dữ liệu in hóa đơn để module mẫu in mới hoạt động ổn định trong luồng hiện tại.

### QA và build

- Đồng bộ version phát hành 1.4.2 cho ứng dụng desktop, frontend, backend và các lockfile tương ứng.
- Kiểm tra cú pháp các file backend quan trọng mới/sửa bằng node --check.
- Kiểm tra khả năng resolve driver mysql2/promise trong backend cho module mẫu in hóa đơn.
- Build frontend production để xác nhận bundle Vite hợp lệ trước khi tạo tag phát hành.

### Lưu ý quan trọng

- Windows 10/11 64-bit nên dùng `banhangoffline-setup-v1.4.2-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn” nên dùng `banhangoffline-setup-v1.4.2-ia32.exe`.
- Chỉ tải bộ cài từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới.

## v1.4.0 - 2026-06-01

### Tính năng và cải tiến

- Chuẩn hóa luồng in hóa đơn bằng trang in riêng theo mã/ID đơn hàng, hỗ trợ mở nhanh bản in từ tạo đơn và danh sách đơn hàng.
- Cải thiện danh sách đơn hàng với dữ liệu từ API, nhãn nguồn đơn, gộp dòng hàng ổn định hơn và xử lý đơn offline rõ ràng hơn.
- Bổ sung lại nghiệp vụ bảng lương nhân viên theo service/controller riêng, validation đầu vào, tổng hợp lương và thao tác thêm/sửa/xóa mềm.
- Tinh gọn module in legacy, bỏ các route/component mẫu in cũ và cập nhật dependency in/xuất file phù hợp frontend hiện tại.

### Phát hành

- Đồng bộ version phát hành 1.4.0 cho ứng dụng desktop, frontend, backend và các lockfile tương ứng.
- Cập nhật tài liệu phát hành, hướng dẫn tải/cài đặt và manifest ví dụ theo tag v1.4.0.
- GitHub Actions tiếp tục build/publish installer Windows x64 và ia32 kèm latest.yml và update-manifest.json từ artifact thực tế.

### Lưu ý quan trọng

- Windows 10/11 64-bit nên dùng `banhangoffline-setup-v1.4.0-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn” nên dùng `banhangoffline-setup-v1.4.0-ia32.exe`.
- Chỉ tải bộ cài từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới.

## v1.3.9 - 2026-05-30

### Phát hành

- Đồng bộ version phát hành 1.3.9 cho ứng dụng desktop, frontend, backend, lockfile và metadata cập nhật Windows.
- Chuẩn hóa tài liệu release và hướng dẫn tải/cập nhật theo tag v1.3.9.
- Không đưa các thay đổi chưa commit ngoài phạm vi release vào commit phát hành.

### Lưu ý quan trọng

- Windows 10/11 64-bit nên dùng `banhangoffline-setup-v1.3.9-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn” nên dùng `banhangoffline-setup-v1.3.9-ia32.exe`.
- Chỉ tải bộ cài từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới.

## v1.3.8 - 2026-05-30

### Bảng phát hành chính thức

| Hạng mục | Nội dung |
| --- | --- |
| Phiên bản | 1.3.8 |
| Ngày phát hành | 2026-05-30 |
| Trạng thái | Sẵn sàng công bố cho người dùng Windows x64 và ia32 |
| Tổng quan | Bản 1.3.8 tập trung ổn định trải nghiệm in hóa đơn A5, in tem sản phẩm và đồng bộ metadata phát hành Windows. |

### Ghi chú thay đổi tổng quan

- Cải thiện độ chính xác khổ giấy, lề và vị trí trang khi in hóa đơn A5 trong cửa sổ in cũng như silent print.
- Chuẩn hóa luồng in tem sản phẩm cho cả dạng cuộn và dạng tờ A4/A5 để màu in, vùng in và căn trang nhất quán hơn.
- Đồng bộ version phát hành 1.3.8 cho ứng dụng desktop, frontend, backend, metadata auto-update và tài liệu đi kèm.

### Tính năng mới

- Thêm demo hóa đơn A5 độc lập để kiểm tra nhanh layout, iframe in và trạng thái nút in trước khi phát hành.
- Bổ sung đánh dấu trang A5 bằng lớp print-page trong renderer mẫu hóa đơn để hệ thống in nhận diện đúng vùng trang.
- Hoàn thiện ghi chú phát hành và metadata cho bộ cài Windows x64/ia32 của phiên bản 1.3.8.

### Lỗi đã sửa

- Sửa tình trạng in hóa đơn A5 bị lệch lề, sai zoom hoặc không căn từ góc trên trái trong cửa sổ in và silent print.
- Giảm lỗi vỡ bố cục bảng, hình ảnh hoặc nội dung hóa đơn khi renderer mẫu in gặp dữ liệu dài.
- Sửa độ không nhất quán về khổ giấy, lề và màu in giữa in tem dạng cuộn với in tem dạng tờ A4/A5.

### Cải tiến hiệu năng

- Tối ưu CSS print theo đúng khổ 148mm x 210mm và vùng in thực tế để trình in dựng trang ổn định hơn.
- Áp dụng guard bố cục cho bảng/hình ảnh nhằm giảm reflow và hạn chế phải căn chỉnh thủ công trước khi in.
- Chuẩn hóa metadata auto-update để quy trình kiểm tra phiên bản, kích thước và hash installer cho x64/ia32 rõ ràng hơn.

### Lưu ý quan trọng

- Windows 10/11 64-bit nên dùng `banhangoffline-setup-v1.3.8-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn” nên dùng `banhangoffline-setup-v1.3.8-ia32.exe`.
- Chỉ tải bộ cài từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`; không chạy file nếu tên, nguồn tải, SHA256 hoặc kích thước không khớp manifest phát hành.
- Nên backup dữ liệu runtime trước khi cập nhật/cài đặt phiên bản mới.

## v1.3.7 - 2026-05-27

### Cải thiện in hóa đơn

- Thêm API backend `/api/invoices/:id/print-data` để chuẩn hóa dữ liệu in hóa đơn A5 cho hóa đơn online, bao gồm khách hàng, người lập, chi tiết hàng và trạng thái thanh toán.
- Cập nhật màn `OrderList` để ưu tiên tải dữ liệu in từ server cho hóa đơn đã lưu và tự fallback về dữ liệu local/offline khi cần.
- Tinh chỉnh renderer mẫu in và silent print Electron để bản xem trước/in A5 giữ đúng kích thước trang, lề và zoom.

### Phát hành

- Đồng bộ version phát hành 1.3.7 cho ứng dụng desktop, metadata auto-update và tài liệu đi kèm.

## v1.3.6 - 2026-05-27

### Phát hành

- Đồng bộ version phát hành 1.3.6 cho ứng dụng desktop, metadata auto-update và tài liệu đi kèm.
- Không thay đổi tính năng; bản này tập trung chuẩn hóa metadata release và hướng dẫn tải/cập nhật.

## v1.3.5 - 2026-05-25

### Sửa lỗi phát hành Windows

- Tạo installer riêng cho Windows 64-bit (`x64`) và Windows 32-bit (`ia32`) với tên asset rõ kiến trúc.
- Sinh lại `latest.yml` và `update-manifest.json` từ installer thực để tránh version/hash/size lệch release.
- Thêm kiểm tra local/remote bằng PowerShell cho HTTP 200, Content-Type, kích thước, header MZ/PE và SHA256.
- Cập nhật màn cập nhật trong ứng dụng để hiển thị kiến trúc runtime, bộ cài khuyến nghị và cảnh báo nếu máy không tương thích.
- Chặn mở link tải thủ công nếu URL trả HTML, HTTP lỗi, tên file không đúng kiến trúc hoặc file quá nhỏ.
- Cập nhật workflow GitHub Actions để build/publish đủ asset x64/ia32 và verify public release.

### Hướng dẫn người dùng

- Windows 10/11 thông thường: dùng `banhangoffline-setup-v1.3.5-x64.exe`.
- Windows 32-bit hoặc máy báo “Ứng dụng này không thể chạy trên PC của bạn”: dùng `banhangoffline-setup-v1.3.5-ia32.exe`.
- Chỉ tải từ GitHub Release chính thức của repo `Vankhadev/phanmemoffline`.
