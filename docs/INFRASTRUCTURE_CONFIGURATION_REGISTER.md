# SBIZ.APP — HỒ SƠ CẤU HÌNH HẠ TẦNG

**Ngày cập nhật:** 2026-10-23  
**Trạng thái hiện tại đã kiểm tra:** Cloudflare Workers & Pages có một Worker tên `sbiz`, gắn với `sbiz.app`. `wrangler.jsonc` trên branch `feature/mod01-cloudflare-access-admin` đã được chỉnh để nhắm đúng tên `sbiz`. Cloudflare Access app `sbiz.app` và policy `SBiz Admin Owner` đã được tạo; Production có `CF_ACCESS_TEAM_DOMAIN` và `CF_ACCESS_AUD`. Đăng nhập Access chuyển hướng và quay lại hoạt động trong trình duyệt. Tuy nhiên, `/admin` và `/api/v1/admin/businesses` trên Production trả `{"error":"Not Found"}`; chưa xác nhận mã branch hiện tại đã được deploy lên Worker. Không coi production là đã hoàn tất cho tới khi owner deploy có chủ đích và xác minh runtime.

## 1. Thông tin đã xác nhận

- Repository: https://github.com/sbizapp/sbiz
- Domain: `sbiz.app` (chủ sản phẩm xác nhận đã mua domain trên Cloudflare).
- Domain registration status: `Active`.
- Ngày hết hạn đăng ký: `2027-10-19`.
- DNS: chủ sản phẩm xác nhận đang dùng cấu hình mặc định của Cloudflare; chưa có danh sách bản ghi DNS được kiểm tra.
- Nhà cung cấp email: Yandex Mail; chủ sản phẩm xác nhận hạ tầng đã thiết lập và sẵn sàng gửi email qua SMTP. Việc gửi thư từ Cloudflare Workers vẫn cần kiểm thử trong runtime thực tế.
- Các mailbox do chủ sản phẩm xác nhận:
  - Admin: `admin@sbiz.app`
  - Billing: `billing@sbiz.app`
  - Support: `support@sbiz.app`
  - Automated notifications: `no-reply@sbiz.app`
  - Contact: `contact@sbiz.app`
- Chủ sản phẩm xác nhận ban đầu chưa có ứng dụng Worker, D1 database hoặc R2 bucket; trạng thái hiện tại được cập nhật theo tiến độ tạo tài nguyên.
- KV namespace đã tạo: `SBIZ_APP_KV`.
- KV Namespace ID: `f5c12871f3204a7588cd18b3dfca689a` (do chủ sản phẩm cung cấp từ Instance details; chưa xác minh qua API).
- Email đăng nhập/tài khoản Cloudflare được cung cấp: `admin@vinarubber.com`.
- Cloudflare Account ID: `7568b3c0e09d949e021c486fa8199b63`.
- Workers.dev subdomain hiển thị trong Account details: `sbizapp.workers.dev`.
- Zone ID của `sbiz.app`: `e2b836a598a4e275aeaa000ece31bc28` (do chủ sản phẩm cung cấp; chưa xác minh trực tiếp qua API).
- Account ID: `7568b3c0e09d949e021c486fa8199b63` (do chủ sản phẩm cung cấp; chưa xác minh trực tiếp qua API).
- Nameservers cụ thể và trạng thái zone trong Cloudflare Dashboard: chưa được cung cấp; ghi nhận riêng rằng domain đang theo cấu hình DNS mặc định Cloudflare.
- Giá thuê bao đã chốt: USD 5/tháng hoặc USD 50/năm.
- Hướng nền tảng ứng dụng: Cloudflare Workers, D1, R2; Cloudflare for SaaS cho custom domains; Paddle cho subscription billing quốc tế (theo kế hoạch tổng thể).
- Chưa có bằng chứng trong hồ sơ này rằng Worker ứng dụng, Paddle hoặc môi trường production đã được tạo/cấu hình. KV, R2 và D1 đã được chủ sản phẩm xác nhận tạo.

## 2. Cấu hình SMTP Yandex — giá trị không bí mật

Cấu hình gửi thư theo tài liệu trợ giúp Yandex Mail:

- SMTP host: `smtp.yandex.com`
- SMTP port khuyến nghị: `465`
- Security: `SSL` (the Yandex client-setting label for SMTP port 465; this means implicit TLS from connection start, not a recommendation to use obsolete SSL protocol versions).
- Username: địa chỉ email đầy đủ tương ứng với từng mailbox.
- Password: mỗi mailbox có app password riêng; chủ sản phẩm sẽ cung cấp/cấu hình từng password trực tiếp trong secret store an toàn khi cần.
- Không yêu cầu chủ sản phẩm gửi password trong chat. Không lưu password trong Git; chỉ lưu các giá trị cấu hình không bí mật và tên secret.
- Phương án thay thế được Yandex nêu: port `587`; chỉ sử dụng khi client được cấu hình STARTTLS đúng cách.

Nguồn chính thức:
- https://yandex.com/support/yandex-360/business/mail/en/mail-clients/others
- https://yandex.com/support/yandex-360/customers/mail/en/mail-clients/mail-clients-troubleshooting

### 2.1. Email sender và tên secret

Tên hiển thị đề xuất có thể điều chỉnh trong code; địa chỉ email đã được chủ sản phẩm cung cấp.

| Purpose | From address | Secret name |
|---|---|---|
| Admin/system notifications | `admin@sbiz.app` | `SMTP_PASSWORD_ADMIN` |
| Billing/subscription | `billing@sbiz.app` | `SMTP_PASSWORD_BILLING` |
| Customer support | `support@sbiz.app` | `SMTP_PASSWORD_SUPPORT` |
| Automated notifications | `no-reply@sbiz.app` | `SMTP_PASSWORD_NOREPLY` |
| Contact/general inquiries | `contact@sbiz.app` | `SMTP_PASSWORD_CONTACT` |

Cấu hình không bí mật có thể dùng tên biến thống nhất (giá trị `SMTP_SECURITY=SSL` theo nhãn cấu hình Yandex cho port 465; ứng dụng phải dùng chế độ SMTP implicit TLS ngay từ lúc kết nối, không dùng STARTTLS trên port này):
- `SMTP_HOST=smtp.yandex.com`
- `SMTP_PORT=465`
- `SMTP_SECURITY=SSL`
- `SMTP_USER_ADMIN=admin@sbiz.app`
- `SMTP_USER_BILLING=billing@sbiz.app`
- `SMTP_USER_SUPPORT=support@sbiz.app`
- `SMTP_USER_NOREPLY=no-reply@sbiz.app`
- `SMTP_USER_CONTACT=contact@sbiz.app`

Tên hiển thị đề xuất:
- `SBiz Admin`
- `SBiz Billing`
- `SBiz Support`
- `SBiz Notifications`
- `SBiz Contact`

Tên hiển thị là đề xuất kỹ thuật, chưa phải quyết định thương hiệu riêng của chủ sản phẩm.

**Quan trọng:** Yandex app password không được đưa vào Git, README, issue, commit, log, file cấu hình công khai hoặc chat. Chỉ tạo Cloudflare Worker secrets với các tên nêu trên. Không coi việc có app password là bằng chứng SMTP đã được kiểm thử thành công.

## 3. Cloudflare — thông tin cần thu thập trước khi cấu hình

Các ID sau không phải bí mật và có thể ghi vào Git sau khi xác minh:

- Cloudflare Account ID: `7568b3c0e09d949e021c486fa8199b63` (do chủ sản phẩm cung cấp; chưa kiểm tra trực tiếp trong dashboard).
- Zone ID của `sbiz.app`: `e2b836a598a4e275aeaa000ece31bc28` (do chủ sản phẩm cung cấp; chưa kiểm tra trực tiếp qua API).
- Workers.dev subdomain hiển thị: `sbizapp.workers.dev`.
- Domain registration status: `Active`; expiry: `2027-10-19`.
- DNS đang theo cấu hình mặc định Cloudflare theo xác nhận của chủ sản phẩm; chưa kiểm tra từng record hoặc nameserver cụ thể.
- KV namespace: `SBIZ_APP_KV`; Namespace ID: `f5c12871f3204a7588cd18b3dfca689a` (do chủ sản phẩm cung cấp).
- Tên Worker thực tế trên Cloudflare Dashboard: `sbiz` (đã xác nhận ngày 2026-10-23). `wrangler.jsonc` phải giữ `name: "sbiz"`; không đổi sang `sbiz-app`.
- Mã nguồn hiện tại: `worker.js` entry point cùng router/module trong branch `feature/mod01-cloudflare-access-admin`. Production endpoint `/health` cần được kiểm tra lại sau lần deploy từ branch này.
- Binding names dự kiến khi cấu hình ứng dụng: `SBIZ_APP_KV` (KV), `SBIZ_APP_R2` (R2 bucket `sbiz-app-assets`), `SBIZ_APP_DB` (D1 database `sbiz-app-db`). Các binding chưa được cấu hình và bootstrap hiện tại chưa sử dụng chúng.
- Môi trường dự kiến: development, staging, production.
- R2 bucket đã tạo: `sbiz-app-assets`; location `Asia-Pacific (APAC)`; default storage class `Standard`.
- S3 API endpoint hiển thị trong Dashboard: `https://7568b3c0e09d949e021c486fa8199b63.r2.cloudflarestorage.com/sbiz-app-assets`.
- Public Development URL đang tắt; chưa gán custom domain; chưa có CORS policy. Giữ bucket private trong giai đoạn này; không bật public access hoặc cấu hình domain khi chưa có quyết định riêng.
- D1 database đã tạo: `sbiz-app-db`.
- D1 Database ID: `8106266b-a132-4ccc-bce8-b386c027a8f7` (do chủ sản phẩm cung cấp từ Dashboard).
- Dashboard cho thấy 0 tables, 0 queries, 0 rows read và 0 rows written; chưa tạo schema hoặc dữ liệu ứng dụng.
- Binding name và migration strategy sẽ được chốt khi chuẩn bị Worker/schema; chưa tự tạo bảng ở bước này.
- Nếu dùng Cloudflare for SaaS: trạng thái subscription/entitlement, fallback origin, custom-hostname design và các hostname cần hỗ trợ.

Không ghi API token vào Git. Nếu cần API token cho CLI/CI, chủ sản phẩm tạo token có quyền tối thiểu cần thiết và lưu trong secret store. Chỉ ghi trong Git tên secret, quyền được cấp, mục đích và ngày xác minh; không ghi token value.

Tên biến CLI phổ biến của Wrangler:
- `CLOUDFLARE_ACCOUNT_ID` — ID tài khoản, không phải token.
- `CLOUDFLARE_API_TOKEN` — secret; không commit.
- `CLOUDFLARE_ZONE_ID` — có thể dùng trong script cần thao tác với zone; xác minh theo từng API/script.
- `CLOUDFLARE_API_TOKEN` không nên được đưa vào runtime Worker nếu ứng dụng không cần gọi Cloudflare API trực tiếp.

Tài liệu chính thức về Worker variables/secrets:
- https://developers.cloudflare.com/workers/configuration/environment-variables/
- https://developers.cloudflare.com/workers/configuration/secrets/

## 4. Các mục cần chủ sản phẩm cung cấp hoặc xác nhận

### A. Cloudflare identity
1. Account ID đã cung cấp: `7568b3c0e09d949e021c486fa8199b63`.
2. Zone ID đã cung cấp: `e2b836a598a4e275aeaa000ece31bc28`.
3. Xác minh trạng thái zone trong Dashboard/API và thu thập nameserver cụ thể nếu cần.
4. Có sẵn Worker, D1 database, R2 bucket hoặc Cloudflare for SaaS configuration nào chưa? Nếu có, cung cấp tên và ID; không tạo trùng tài nguyên.

### B. SMTP
1. Xác nhận domain suffix và địa chỉ chính xác của từng mailbox; không gửi app password vào chat.
2. Xác nhận app password đã được tạo riêng cho từng mailbox hay có mailbox nào dùng chung credential.
3. Xác nhận tên hiển thị của từng địa chỉ nếu khác các tên đề xuất.
4. Xác nhận địa chỉ nào được phép gửi email giao dịch và địa chỉ nào chỉ dùng nhận thư.
5. Chưa gửi app password vào chat hoặc Git.

### C. CI/CD và secrets
1. Chọn cách triển khai ban đầu: deploy thủ công bằng Wrangler hay GitHub Actions.
2. Nếu dùng GitHub Actions, cấu hình secrets trực tiếp trong GitHub repository/environment; chỉ ghi tên secret trong tài liệu.
3. Xác nhận ai là người được phép kích hoạt production deployment.

### D. Dịch vụ và credentials theo phân đoạn
- Paddle vendor/authentication keys và webhook secret: thu thập khi viết/duyệt kịch bản phân đoạn thanh toán; không commit giá trị bí mật.
- Các API key AI hoặc dịch vụ ngoài khác: chỉ tạo khi có phân đoạn cụ thể cần dùng, không thu thập trước khi có nhu cầu.
- Không đưa credential production vào môi trường development; tách secret theo môi trường.

## 5. Ranh giới an toàn khi triển khai

- Không thay đổi nameserver hoặc DNS records nếu chưa có chỉ đạo rõ ràng và kế hoạch kiểm tra tác động.
- Không tạo tài nguyên có phí hoặc bật dịch vụ tính phí mà chưa xác nhận.
- Không đưa API token, app password, private key, webhook secret hoặc dữ liệu xác thực vào Git.
- Không tuyên bố email gửi thành công cho tới khi có bằng chứng kiểm thử thực tế: xác thực SMTP, gửi thư thử, nhận thư đích và kiểm tra lỗi/log đã che thông tin nhạy cảm.
- Trước khi code SMTP trên Cloudflare Workers, phải kiểm tra khả năng kết nối SMTP/TLS trong runtime và thư viện tương thích; không mặc định mọi thư viện Node.js SMTP hoạt động nguyên trạng trên Workers.
- Mọi ID/resource name phải được đọc từ tài khoản hoặc cung cấp bởi chủ sản phẩm; không tự bịa ID.
- Tài liệu này là sổ đăng ký cấu hình. Nó không đồng nghĩa với việc đã tạo Worker, database, bucket, token, DNS records hoặc triển khai ứng dụng.

## 6. Quy trình triển khai do chủ sản phẩm quyết định

- Builder hướng dẫn chủ sản phẩm tự tạo các tài nguyên cần thiết trong Cloudflare Dashboard: KV namespace, R2 bucket, D1 database.
- Builder viết và bàn giao mã ứng dụng trong file `worker.js` để chủ sản phẩm tự đưa thủ công vào Cloudflare Workers và bấm Deploy.
- Khi cần sửa lỗi/nâng cấp, Builder phải xác định đúng phiên bản nguồn đã bàn giao, cung cấp file đầy đủ đã sửa hoặc file mới; chủ sản phẩm thay nội dung trong Cloudflare Workers và tự bấm Deploy.
- Không tự kích hoạt deployment, không dùng GitHub Actions để deploy thay chủ sản phẩm.
- Trước khi code sử dụng KV/R2/D1, phải chỉ rõ bindings tương ứng trong Worker Settings và dùng đúng binding names trong code. Không được giả định tài nguyên đã tồn tại.
- Sau mỗi lần deploy, cần hướng dẫn kiểm thử có thể quan sát được và ghi lại kết quả/evidence; không khẳng định “chạy ngon” nếu chưa có bằng chứng.
- Cách triển khai bằng Dashboard editor phải được kiểm tra về khả năng quản lý source/version và giới hạn kích thước; giữ bản nguồn `worker.js` có phiên bản trong GitHub để có thể khôi phục. GitHub là nơi lưu mã nguồn, không phải nơi tự động deploy.
- SMTP: không giả định TCP SMTP/TLS hoặc thư viện Node.js SMTP chạy trực tiếp trong Workers. Phải kiểm tra tương thích runtime và chọn giải pháp được hỗ trợ trước khi triển khai chức năng gửi email.

## 7. Trạng thái

- [x] Chủ sản phẩm xác nhận domain `sbiz.app` đã mua trên Cloudflare, registration status Active, hết hạn 2027-10-19.
- [x] Chủ sản phẩm xác nhận DNS đang theo cấu hình mặc định của Cloudflare.
- [x] Ghi nhận Account ID và workers.dev subdomain do chủ sản phẩm cung cấp (chưa xác minh trực tiếp trên dashboard).
- [x] Chủ sản phẩm xác nhận Yandex Mail là nhà cung cấp email và SMTP sending đã sẵn sàng ở phía hạ tầng email.
- [x] Mỗi mailbox có app password riêng; chủ sản phẩm sẽ tự cấu hình/cung cấp từng password qua secret store an toàn, không qua chat/Git.
- [x] Chủ sản phẩm xác nhận năm mailbox: admin, billing, support, no-reply, contact @sbiz.app.
- [x] Ghi nhận kiểm kê ban đầu: chưa có Worker ứng dụng, D1 database hoặc R2 bucket; trạng thái hiện tại được cập nhật theo các mục bên dưới.
- [x] Ghi nhận cấu hình SMTP tiêu chuẩn từ tài liệu Yandex.
- [x] Account ID và Zone ID được chủ sản phẩm cung cấp.
- [ ] Account ID, Zone ID và trạng thái zone được xác minh trực tiếp trên dashboard/API.
- [x] Ghi nhận trạng thái ban đầu: chưa có ứng dụng Worker.
- [x] Mã nguồn bootstrap `worker.js` đã được lưu trong GitHub; chưa triển khai trên Cloudflare.
- [x] Worker `sbiz` đã tồn tại trên Cloudflare Dashboard; Wrangler deployment history đã được đọc bằng `npx wrangler deployments list --name sbiz`.
- [ ] Sau khi owner deploy branch đã đồng bộ, kiểm thử `GET /health`, `/admin`, và `/api/v1/admin/businesses`; lưu kết quả runtime.
- [ ] Cấu hình bindings KV/R2/D1 sau khi Worker bootstrap được xác minh.
- [x] D1 database `sbiz-app-db` đã được chủ sản phẩm xác nhận tạo; ID `8106266b-a132-4ccc-bce8-b386c027a8f7`.
- [x] Dashboard D1 hiển thị 0 tables và chưa có dữ liệu ứng dụng.
- [x] R2 bucket `sbiz-app-assets` đã được chủ sản phẩm xác nhận tạo; xem thông tin chi tiết ở mục R2.
- [ ] Cấu hình secret được thiết lập an toàn theo từng môi trường.
- [ ] SMTP được kiểm thử trong runtime thực tế.
- [x] Chủ sản phẩm chọn quy trình deploy thủ công: Builder bàn giao `worker.js`; chủ sản phẩm cập nhật trong Cloudflare Workers và tự bấm Deploy.
- [x] KV namespace `SBIZ_APP_KV` đã được chủ sản phẩm tạo; Namespace ID đã ghi nhận.
- [x] R2 bucket `sbiz-app-assets` được chủ sản phẩm xác nhận đã tạo ngày 2026-10-22; location APAC, storage class Standard.
- [x] Public Development URL đang tắt; chưa có custom domain và chưa có CORS policy.
- [ ] Chưa tạo schema/bảng và chưa có dữ liệu ứng dụng trong D1.
- [ ] Quy trình kiểm thử sau deploy và khôi phục phiên bản được xác nhận.
