# SBIZ.APP — KẾ HOẠCH TỔNG THỂ SẢN PHẨM & KỊCH BẢN TRIỂN KHAI

**Phiên bản:** 1.5  
**Ngày:** 22/10/2026  
**Trạng thái:** Kế hoạch tổng thể sản phẩm; chưa phải đặc tả kỹ thuật chi tiết.  
**Quy tắc thực hiện:** Mỗi phân đoạn phải có kịch bản hành động chi tiết được viết và duyệt trước khi xây frontend/backend.

## 1. Mục tiêu sản phẩm

sbiz.app (Smart Business) hướng tới các hộ kinh doanh, cửa hàng nhỏ và nhà sản xuất nhỏ cần một website doanh nghiệp/sản phẩm dễ tạo, có nội dung được tổ chức để các hệ thống AI có thể tiếp cận, cùng công cụ tạo báo giá và Proforma Invoice (PI).

Ba trụ cột sản phẩm:
1. Website/shop doanh nghiệp và catalog sản phẩm.
2. AI Training Base — bộ hướng dẫn/tri thức riêng cho từng doanh nghiệp, sinh từ dữ liệu chuẩn hóa của shop.
3. Báo giá và PI theo ngôn ngữ, sản phẩm, đơn vị tiền tệ và quy tắc được chủ sản phẩm duyệt.

## 2. Giá thuê bao đã chốt

- **USD 5/tháng**
- **USD 50/năm**

Đây là quyết định của chủ sản phẩm. Không tự ý thay đổi giá trong quá trình triển khai.

## 3. Các trạng thái tài khoản

### Free
- Dùng L1 (ngôn ngữ chính).
- Giới hạn công khai tối đa 10 sản phẩm.
- Theo chính sách vòng đời: thời hạn 12 tháng; sau đó có giai đoạn ân hạn 90 ngày trước khi xóa dữ liệu theo quy tắc chi tiết đã được duyệt.

### Free Active
- Admin xác minh thủ công hồ sơ doanh nghiệp; khách hàng có thể gửi PDF giấy đăng ký kinh doanh tới support@sbiz.app để phục vụ quy trình xác minh.
- Dùng L1 và tối đa 10 sản phẩm công khai.
- Không xóa dữ liệu khi hạ cấp từ thuê bao trả phí; chỉ ẩn nội dung không còn thuộc quyền lợi.

### Verified by sbiz / thuê bao trả phí active
- Giá: USD 5/tháng hoặc USD 50/năm.
- L1 và L2 đều hoạt động.
- Quyền lợi chi tiết khác phải được chốt trong kịch bản phân đoạn liên quan.

### Thuê bao trả phí ngừng thanh toán
- Có **7 ngày ân hạn** trước khi chuyển về Free Active.
- Khi hết ân hạn mà thuê bao chưa được khôi phục hợp lệ, chuyển về Free Active.
- Giữ nguyên dữ liệu; không xóa L2 hoặc sản phẩm vượt giới hạn.
- Đóng/ẩn hoàn toàn L2 khỏi website công khai và dữ liệu đào tạo AI được công bố.
- Chỉ công khai tối đa 10 sản phẩm; sắp xếp theo thứ tự của hệ thống, giữ sản phẩm ở vị trí 1–10 và ẩn từ vị trí 11 trở đi.
- Các nội dung bị ẩn không được xuất hiện trong website công khai hoặc AI Training Base được công bố.
- Khi thuê bao được khôi phục hợp lệ, mở lại quyền lợi theo trạng thái thuê bao đã xác minh.

## 4. Quy tắc ngôn ngữ L1/L2

- Khi tạo shop, người dùng tự chọn **L1 — ngôn ngữ chính**. L1 là ngôn ngữ mặc định của website và báo giá.
- L1 được giữ nguyên trong suốt vòng đời tài khoản, ở trạng thái Free, Free Active, trả phí active hoặc inactive.
- **L2 — ngôn ngữ thứ hai** chỉ hoạt động khi thuê bao trả phí active.
- Khi thuê bao chuyển về Free Active, L2 bị đóng/ẩn; chỉ L1 tiếp tục hoạt động. Có thể giữ cấu hình L2 để khôi phục sau.
- L1 và L2 không được trùng nhau. Không bắt buộc tiếng Anh.
- Nhóm 5 ngôn ngữ chiến lược: English, Vietnamese, Indonesian, Spanish, Portuguese.
- Website, AI Training Base, báo giá và PI phải tuân theo cấu hình ngôn ngữ của shop. Mỗi ngôn ngữ có template tài liệu tương ứng.

## 5. AI Training Base

AI Training Base là một lớp nội dung/hướng dẫn máy có thể truy cập, được tạo riêng cho từng shop từ dữ liệu có thẩm quyền trong sbiz: thông tin doanh nghiệp, địa chỉ, sản phẩm, thông số, giá, quy tắc bán hàng, ngôn ngữ và hành vi tư vấn.

Mỗi website có hai lớp nội dung:
1. Nội dung giao diện hiển thị cho con người.
2. Nội dung/hướng dẫn AI được tổ chức trong nguồn có thể truy cập/crawl bởi hệ thống máy, không hiển thị như nội dung giao diện thông thường.

AI Training Base phải được sinh theo template chuẩn, đồng bộ với dữ liệu nguồn và nội dung được phép công khai. Khi L2 hoặc sản phẩm bị ẩn do hạ cấp, nội dung tương ứng phải bị loại khỏi phần AI Training Base công khai. Sitemap và structured data là lớp hỗ trợ, không thay thế AI Training Base. Không cam kết rằng mọi hệ thống AI đều sẽ thu thập hoặc tuân thủ nội dung.

## 6. Báo giá và Proforma Invoice

- Ngôn ngữ mặc định của báo giá là L1.
- Thuê bao trả phí active có thể dùng L1 và L2.
- Mỗi ngôn ngữ có template tài liệu riêng.
- Đơn vị tiền tệ được cấu hình ở cấp sản phẩm; không suy ra tiền tệ chỉ từ ngôn ngữ.
- Trường bắt buộc, thuế, chiết khấu, độ chính xác, làm tròn, ngày tháng, số báo giá và thời hạn hiệu lực phải được chốt trong kịch bản chi tiết trước khi xây dựng phân đoạn này.
- Phân biệt rõ báo giá (quotation) và Proforma Invoice (PI).

## 7. Paddle — thanh toán quốc tế

Tích hợp Paddle cho gói thuê bao USD 5/tháng và USD 50/năm. Kịch bản chi tiết phải xác định:
- Checkout và liên kết tài khoản với customer/subscription trên Paddle.
- Trạng thái thanh toán thành công/thất bại, gia hạn, hủy, hết hạn và khôi phục.
- Quy tắc ân hạn 7 ngày và thời điểm chuyển về Free Active.
- Webhook, xác minh chữ ký, chống xử lý trùng lặp/sai thứ tự, đối soát và kiểm thử sandbox.
- Hoàn tiền/chargeback và thuế/phí nếu áp dụng.
- Không cấp quyền chỉ dựa vào việc trình duyệt quay về trang thành công; phải xác minh trạng thái từ nguồn tin cậy của Paddle.

## 8. Tick xanh Verified by sbiz và hồ sơ doanh nghiệp

Tick xanh Verified by sbiz phải liên kết tới trang thông tin doanh nghiệp. Trang này thể hiện:
- Ngày khởi tạo shop/doanh nghiệp trên sbiz.app.
- Ngày Admin xác minh và chấp thuận thành Free Active.
- Ngày chuyển sang trạng thái trả phí hợp lệ.
- Giấy đăng ký kinh doanh được đính kèm trong quy trình xác minh.

Cách công khai giấy đăng ký kinh doanh, bảo vệ thông tin nhạy cảm và quyền truy cập bản gốc phải được xác định trong kịch bản chi tiết; không mặc định công khai toàn bộ bản scan nếu chưa có quyết định.

## 9. Hạ tầng và nền tảng

Hướng công nghệ dự kiến: Cloudflare Workers, D1, R2 và Cloudflare for SaaS cho custom domain. Cần xác minh hiện trạng domain, DNS, dịch vụ email và tài khoản Cloudflare trước khi cấu hình. Không tự ý thay đổi nameserver/DNS, tạo tài nguyên tính phí hoặc triển khai production khi chưa được chủ sản phẩm cho phép.

Email nghiệp vụ dự kiến:
- support@sbiz.app
- admin@sbiz.app
- billing@sbiz.app
- noreply@sbiz.app

Các địa chỉ trên là danh sách dự kiến; việc tạo mailbox, chọn nhà cung cấp và cấu hình DNS email phải chờ chỉ đạo của chủ sản phẩm.

## 10. Các phân đoạn cấp cao

### Phân đoạn 1 — Tài khoản và hồ sơ doanh nghiệp
Đăng ký, đăng nhập, tạo shop, chọn L1, lưu ngày khởi tạo và quản lý hồ sơ cơ bản.

### Phân đoạn 2 — Catalog và sản phẩm
Tạo/sửa/quản lý sản phẩm, thứ tự sản phẩm, đơn vị tiền tệ cấp sản phẩm và quy tắc giới hạn công khai.

### Phân đoạn 3 — AI Training Base
Template chuẩn, sinh nội dung AI theo dữ liệu shop, quy tắc công khai và đồng bộ trạng thái hiển thị.

### Phân đoạn 4 — Ngôn ngữ và bản địa hóa
L1/L2, lựa chọn ngôn ngữ, nội dung đa ngôn ngữ và template tài liệu; L2 chỉ hoạt động khi trả phí active.

### Phân đoạn 5 — Báo giá và PI
Luồng tạo tài liệu, dữ liệu nguồn, template theo ngôn ngữ và quy tắc tài chính được duyệt.

### Phân đoạn 6 — Vòng đời Free, Free Active và Verified
Admin xác minh, trạng thái tài khoản, thời hạn, ân hạn 7 ngày, hạ cấp, giới hạn 10 sản phẩm, ẩn L2 và trang hồ sơ doanh nghiệp gắn với tick xanh.

### Phân đoạn 7 — Tích hợp Paddle
Checkout, subscription, webhook, xác minh trạng thái, gia hạn/hủy/thất bại, ân hạn và chuyển quyền lợi.

### Phân đoạn 8 — Slug, custom domain và định tuyến
Quy tắc slug, định tuyến shop/sản phẩm và Cloudflare for SaaS. Cấu hình chi tiết phải được duyệt trước khi thực hiện.

### Phân đoạn 9 — Vận hành, QA và phát hành
Quản trị, bảo mật, giám sát, sao lưu, kiểm thử xuyên luồng và phát hành có bằng chứng.

Thứ tự trên là nhóm phân đoạn cấp cao; thứ tự triển khai cuối cùng phải được xác nhận qua dependency và kịch bản chi tiết.

## 11. Mẫu bắt buộc cho kịch bản hành động từng phân đoạn

Trước khi bắt đầu frontend/backend của bất kỳ phân đoạn nào, phải viết và duyệt một kịch bản riêng gồm:
1. Mục tiêu và phạm vi.
2. Luồng người dùng và các trạng thái.
3. Quy tắc nghiệp vụ đã chốt.
4. Dữ liệu, nguồn dữ liệu có thẩm quyền và quyền truy cập.
5. UI/UX và responsive.
6. Backend/API, tích hợp và xử lý lỗi.
7. Bảo mật, quyền riêng tư và vòng đời dữ liệu.
8. Kiểm thử, tình huống biên và tiêu chí nghiệm thu.
9. Phụ thuộc, vấn đề còn mở và các quyết định cần chủ sản phẩm chốt.
10. Bằng chứng cần có để xác nhận hoàn thành.

Không tự ý biến đề xuất thành quyết định sản phẩm. Không tuyên bố PASS khi chưa có bằng chứng.

## 12. Các nội dung còn mở — chốt trong kịch bản phân đoạn

- Mốc tính 12 tháng, thời điểm gửi cảnh báo và chi tiết thời hạn kích hoạt Free Active.
- Quyền lợi Verified đầy đủ, giới hạn sản phẩm và hành vi khi thuê bao đổi trạng thái.
- Chi tiết Paddle: sản phẩm/gói, checkout, webhook, gia hạn, hủy, thanh toán thất bại, hoàn tiền/chargeback và đối soát.
- Các trường bắt buộc của quotation/PI; thuế, chiết khấu, độ chính xác, làm tròn, ngày tháng, số tài liệu và hiệu lực.
- Quy trình dữ liệu hết hạn, thông báo cuối cùng, khả năng xuất dữ liệu và xóa dữ liệu theo nghĩa vụ áp dụng.
- Chính sách truy cập/công khai giấy đăng ký kinh doanh.
- Quy tắc slug, chi tiết cấu hình Cloudflare for SaaS và quản lý DNS.
- Nhà cung cấp email, mailbox thực, định tuyến, SPF/DKIM/DMARC và quy trình gửi email.
- Phạm vi MVP và dependency cuối cùng giữa các phân đoạn.

## 13. Trạng thái thực hiện hiện tại

- Repository GitHub: https://github.com/sbizapp/sbiz
- README cơ bản đã được ghi lên nhánh main.
- Kế hoạch tổng thể này là định hướng sản phẩm; chưa có nghĩa là chức năng ứng dụng đã được xây dựng.
- Chủ sản phẩm yêu cầu **chỉ lưu kế hoạch tổng thể lên Git ở thời điểm hiện tại**. Các thiết lập domain, DNS, email, Cloudflare và những tài nguyên khác phải chờ chỉ đạo tiếp theo.
