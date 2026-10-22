# SBiz.app — Kịch bản hành động phân đoạn 1: Tài khoản và hồ sơ doanh nghiệp

**Phiên bản:** Draft 0.1  
**Ngày:** 2026-10-22  
**Trạng thái:** BẢN NHÁP — CHƯA ĐƯỢC CHỦ SẢN PHẨM DUYỆT; KHÔNG ĐƯỢC DÙNG LÀM CĂN CỨ TRIỂN KHAI FRONTEND/BACKEND  
**Nguồn sản phẩm:** `docs/SBIZ_APP_MASTER_PLAN_V1_5.md`  
**Phạm vi:** Đăng ký, đăng nhập, tạo shop, chọn L1, lưu ngày khởi tạo và quản lý hồ sơ cơ bản.

## 1. Mục tiêu và phạm vi

Cho phép người dùng tạo và truy cập tài khoản SBiz, tạo hồ sơ shop/doanh nghiệp ban đầu, chọn L1 (ngôn ngữ chính), và lưu ngày khởi tạo shop/doanh nghiệp.

Không bao gồm trong phân đoạn này: catalog/sản phẩm, AI Training Base, bật L2, quotation/PI, Paddle, custom domain, và quy trình Admin xác minh đầy đủ. Các phần này thuộc những phân đoạn riêng trong master plan.

## 2. Luồng người dùng và trạng thái

### 2.1 Luồng dự kiến cần chủ sản phẩm duyệt

1. Người dùng mở trang đăng ký.
2. Người dùng cung cấp thông tin đăng ký theo bộ trường sẽ được chốt.
3. Hệ thống xác thực dữ liệu và tạo tài khoản nếu hợp lệ.
4. Người dùng đăng nhập và truy cập khu vực quản lý.
5. Người dùng tạo shop/hồ sơ doanh nghiệp ban đầu.
6. Người dùng chọn L1 từ danh sách ngôn ngữ được hỗ trợ.
7. Hệ thống lưu L1 và ngày khởi tạo shop/doanh nghiệp.
8. Người dùng xem/cập nhật các trường hồ sơ cơ bản được phép sửa.

Đây là luồng đề xuất để duyệt, không phải quyết định đã chốt. Chưa xác định đăng ký và tạo shop diễn ra trong một luồng hay hai bước, cũng chưa xác định quy tắc cho một tài khoản sở hữu nhiều shop.

### 2.2 Trạng thái cần phân biệt

- Chưa có tài khoản.
- Tài khoản đã tạo.
- Đã đăng nhập.
- Chưa tạo shop.
- Shop đã tạo và có L1.
- Tài khoản/shop bị vô hiệu hóa hoặc bị hạn chế: CHƯA CÓ QUY TẮC ĐƯỢC DUYỆT.

Không tự suy ra trạng thái xác minh hoặc trạng thái thuê bao chỉ từ việc tài khoản đăng ký thành công.

## 3. Quy tắc nghiệp vụ đã có căn cứ

Các quy tắc dưới đây được ghi trực tiếp trong master plan:

- Khi tạo shop, người dùng tự chọn L1 — ngôn ngữ chính.
- L1 là ngôn ngữ mặc định của website và báo giá.
- L1 được giữ nguyên trong suốt vòng đời tài khoản ở các trạng thái Free, Free Active, trả phí active hoặc inactive.
- L2 không thuộc phạm vi kích hoạt của phân đoạn này; master plan quy định L2 chỉ hoạt động khi thuê bao trả phí active.
- Master plan yêu cầu lưu ngày khởi tạo shop/doanh nghiệp.
- Giá thuê bao đã chốt là USD 5/tháng hoặc USD 50/năm; phân đoạn này không được thay đổi giá.

## 4. Dữ liệu và nguồn dữ liệu có thẩm quyền

### 4.1 Dữ liệu dự kiến

| Nhóm | Trường/ý nghĩa | Trạng thái |
|---|---|---|
| Tài khoản | Định danh tài khoản | Cần chốt cơ chế |
| Tài khoản | Email đăng nhập/địa chỉ liên hệ | Cần chốt trường bắt buộc và xác minh |
| Tài khoản | Thông tin xác thực | Cần chốt quy trình an toàn; không lưu mật khẩu dạng rõ |
| Shop/doanh nghiệp | Định danh shop | Cần chốt |
| Shop/doanh nghiệp | Tên hiển thị/tên doanh nghiệp | Cần chốt trường và quy tắc sửa |
| Shop/doanh nghiệp | L1 | Được master plan yêu cầu; danh sách giá trị cần chốt/chuẩn hóa |
| Shop/doanh nghiệp | Ngày khởi tạo | Được master plan yêu cầu; cần chốt mốc thời gian và múi giờ |
| Shop/doanh nghiệp | Hồ sơ cơ bản khác | Chưa có danh sách trường được duyệt |

### 4.2 Nguồn dữ liệu có thẩm quyền

- Master plan V1.5 là nguồn cho quy tắc sản phẩm đã được chốt.
- Dữ liệu do người dùng nhập là nguồn đầu vào, không tự động chứng minh danh tính pháp lý hay trạng thái Verified by sbiz.
- Trạng thái xác minh và thuê bao phải do luồng có thẩm quyền riêng quản lý; phân đoạn này không được tự cấp Verified hoặc quyền lợi trả phí.

## 5. Quyền truy cập và bảo mật

Các yêu cầu an toàn cần được xác nhận trong kịch bản:

- Người dùng chỉ được đọc/sửa dữ liệu tài khoản và shop mà họ có quyền quản lý.
- Phải chốt cách xác thực người dùng, quản lý phiên, đăng xuất, khôi phục tài khoản và giới hạn thử đăng nhập.
- Không lưu mật khẩu dạng rõ; không ghi mật khẩu, token phiên hoặc bí mật vào log.
- Phải chốt cách xác minh email và xử lý email đã tồn tại.
- Cần chốt hành vi khi tài khoản bị khóa, yêu cầu xóa tài khoản, hoặc mất quyền truy cập.
- Không công khai hồ sơ pháp lý hay tài liệu nhạy cảm trong phân đoạn này.

Đây là yêu cầu thiết kế cần duyệt, không phải xác nhận rằng các cơ chế trên đã được triển khai.

## 6. UI/UX và responsive

Cần mô tả và duyệt trước khi code:

- Trang đăng ký, đăng nhập, lỗi xác thực và khôi phục tài khoản.
- Luồng tạo shop và lựa chọn L1.
- Trang hồ sơ cơ bản và trạng thái lưu thành công/lỗi.
- Trạng thái loading, dữ liệu không hợp lệ, email đã tồn tại, phiên hết hạn và lỗi mạng.
- Bố cục desktop/mobile, điều hướng và khả năng truy cập.

Chưa có thiết kế màn hình được phê duyệt trong tài liệu nguồn đã đọc; không coi đây là UI specification cuối cùng.

## 7. Backend/API và xử lý lỗi

Trước khi triển khai, cần chốt hợp đồng cho các thao tác đăng ký, đăng nhập, đăng xuất, khôi phục tài khoản, tạo shop, đọc/cập nhật hồ sơ và chọn L1.

Không tạo endpoint hoặc cấu trúc payload cụ thể trong bản nháp này vì master plan chưa quy định API contract. Cần xác định rõ mã lỗi, xác thực đầu vào, tính nhất quán khi tạo tài khoản/shop, và cách tránh tạo dữ liệu trùng khi yêu cầu được gửi lặp lại.

## 8. D1 và lưu trữ

D1 hiện đã được kiểm tra từ xa; kết quả quan sát được chỉ có bảng `_cf_KV`, chưa có bảng nghiệp vụ. Không có schema nào được tạo bởi tài liệu này.

Trước khi thiết kế schema, phải duyệt:
- Quan hệ tài khoản–shop và số lượng shop mỗi tài khoản được phép sở hữu/quản lý.
- Định danh và quy tắc duy nhất của email.
- Bộ trường hồ sơ cơ bản.
- Danh sách mã ngôn ngữ hợp lệ và cách lưu L1.
- Mốc ghi ngày khởi tạo, timezone và quy tắc cập nhật.
- Vòng đời dữ liệu, xóa/khóa tài khoản và nhu cầu audit.

Không chạy migration, không tạo bảng và không viết schema chỉ dựa trên các giả định trong bản nháp này.

## 9. Kiểm thử và tiêu chí nghiệm thu dự kiến

Sau khi kịch bản và hợp đồng được duyệt, tiêu chí tối thiểu cần xác nhận gồm:

- Đăng ký hợp lệ tạo được đúng một tài khoản.
- Đầu vào không hợp lệ bị từ chối với lỗi rõ ràng.
- Quy tắc email trùng được thực thi nhất quán.
- Đăng nhập/đăng xuất và khôi phục tài khoản tuân theo quy tắc đã duyệt.
- Người dùng không thể truy cập hồ sơ không thuộc quyền của mình.
- Tạo shop lưu L1 đã chọn và ngày khởi tạo theo quy tắc đã duyệt.
- L1 không tự đổi khi trạng thái tài khoản/thuê bao thay đổi.
- Lỗi backend không làm lộ bí mật hoặc dữ liệu cá nhân không cần thiết.
- Hành vi thực tế được chủ sản phẩm xác nhận sau khi triển khai thủ công; build thành công không đồng nghĩa với nghiệm thu sản phẩm.

Đây là tiêu chí dự kiến, chưa phải kết quả kiểm thử.

## 10. Phụ thuộc và các quyết định cần chủ sản phẩm chốt

Các điểm dưới đây chưa được master plan giải quyết đầy đủ; không tự chọn thay chủ sản phẩm:

1. **Tài khoản–shop:** Một tài khoản có thể sở hữu/quản lý một hay nhiều shop?
2. **Đăng ký:** Trường bắt buộc chính xác là gì? Email có phải định danh đăng nhập duy nhất không?
3. **Xác minh email:** Có bắt buộc trước khi đăng nhập hoặc tạo shop không?
4. **Tạo shop:** Tạo ngay sau đăng ký hay người dùng chủ động tạo sau khi đăng nhập?
5. **Hồ sơ cơ bản:** Danh sách trường bắt buộc/tùy chọn nào được phép có trong MVP?
6. **L1:** Danh sách ngôn ngữ được phép chọn ở giai đoạn đầu; có cho phép đổi L1 sau khi tạo shop không? Master plan nói L1 được giữ nguyên suốt vòng đời nhưng chưa mô tả quy trình xử lý yêu cầu đổi.
7. **Ngày khởi tạo:** Lưu thời điểm UTC hay ngày theo múi giờ shop? Ngày có được chỉnh sửa không?
8. **Khôi phục/khóa/xóa tài khoản:** Quy tắc và quyền hạn nào được áp dụng trong MVP?
9. **Quản lý phiên:** Thời hạn phiên, đăng xuất các phiên khác và xử lý phiên hết hạn.
10. **Nghiệm thu MVP:** Các luồng nào bắt buộc phải được chủ sản phẩm thử trực tiếp trước khi mở phân đoạn tiếp theo?

## 11. Điều kiện để chuyển sang triển khai

Chỉ chuyển sang thiết kế schema/API và frontend/backend sau khi:

- Chủ sản phẩm duyệt các quyết định còn mở ở Mục 10.
- Kịch bản này được cập nhật thành bản đã duyệt.
- Ranh giới với Phân đoạn 2 (Catalog và sản phẩm) được xác nhận.
- Có tiêu chí nghiệm thu cụ thể và các trường dữ liệu đã chốt.

## 12. Bằng chứng hiện có

- Master plan: `docs/SBIZ_APP_MASTER_PLAN_V1_5.md` trên nhánh `main`.
- Code organization/deployment standard: `docs/CODE_ORGANIZATION_AND_DEPLOYMENT_STANDARD.md`.
- Kết quả truy vấn D1 từ xa do chủ sản phẩm cung cấp ngày 2026-10-22: chỉ có bảng `_cf_KV`.
- Chưa có schema nghiệp vụ, frontend/backend sản phẩm hoặc bằng chứng nghiệm thu cho phân đoạn này.
