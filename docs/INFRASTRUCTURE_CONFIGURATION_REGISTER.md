# SBIZ.COM — HỒ SƠ CẤU HÌNH HẠ TẦNG

**Ngày cập nhật:** 2026-10-22  
**Trạng thái:** Ghi nhận thông tin do chủ sản phẩm xác nhận và danh sách cần thu thập. Chưa xác nhận triển khai tài nguyên Cloudflare.

## 1. Thông tin đã xác nhận

- Repository: https://github.com/sbizapp/sbiz
- Domain: `sbiz.com` (chủ sản phẩm xác nhận đã mua domain trên Cloudflare).
- Email đã được thiết lập theo xác nhận của chủ sản phẩm; domain suffix và danh sách địa chỉ mailbox thực tế cần xác minh, không suy ra từ domain website.
- Email đăng nhập/tài khoản Cloudflare được cung cấp: `admin@vinarubber.com`.
- Cloudflare Account ID: `7568b3c0e09d949e021c486fa8199b63`.
- Workers.dev subdomain hiển thị trong Account details: `sbizapp.workers.dev` (chỉ ghi nhận; chưa khẳng định đã tạo Worker ứng dụng).
- Zone ID, trạng thái zone và nameservers của `sbiz.com`: chưa được cung cấp/xác minh.
- Giá thuê bao đã chốt: USD 5/tháng hoặc USD 50/năm.
- Hướng nền tảng ứng dụng: Cloudflare Workers, D1, R2; Cloudflare for SaaS cho custom domains; Paddle cho subscription billing quốc tế (theo kế hoạch tổng thể).
- Chưa có bằng chứng trong hồ sơ này rằng Worker, D1, R2, Paddle hoặc môi trường production đã được tạo/cấu hình.

## 2. Cấu hình SMTP Yandex — giá trị không bí mật

Cấu hình gửi thư theo tài liệu trợ giúp Yandex Mail:

- SMTP host: `smtp.yandex.com`
- SMTP port khuyến nghị: `465`
- Security: implicit TLS / SSL
- Username: địa chỉ email đầy đủ, theo địa chỉ mailbox thực tế (chưa xác minh)
- Password: app password riêng tương ứng với mailbox.
- Phương án thay thế được Yandex nêu: port `587`; chỉ sử dụng khi client được cấu hình STARTTLS đúng cách.

Nguồn chính thức:
- https://yandex.com/support/yandex-360/business/mail/en/mail-clients/others
- https://yandex.com/support/yandex-360/customers/mail/en/mail-clients/mail-clients-troubleshooting

### 2.1. Email sender và tên secret

Tên hiển thị đề xuất có thể điều chỉnh trong code; địa chỉ email đã được chủ sản phẩm cung cấp.

| Purpose | From address | Secret name |
|---|---|---|
| Admin/system notifications | `[mailbox admin — địa chỉ cần xác minh]` | `SMTP_PASSWORD_ADMIN` |
| Billing/subscription | `[mailbox billing — địa chỉ cần xác minh]` | `SMTP_PASSWORD_BILLING` |
| Customer support | `[mailbox support — địa chỉ cần xác minh]` | `SMTP_PASSWORD_SUPPORT` |
| Automated notifications | `[mailbox noreply — địa chỉ cần xác minh]` | `SMTP_PASSWORD_NOREPLY` |
| Contact/general inquiries | `[mailbox contact — địa chỉ cần xác minh]` | `SMTP_PASSWORD_CONTACT` |

Cấu hình không bí mật có thể dùng tên biến thống nhất:
- `SMTP_HOST=smtp.yandex.com`
- `SMTP_PORT=465`
- `SMTP_SECURITY=TLS`
- `SMTP_USER_ADMIN=<địa chỉ mailbox admin cần xác minh>`
- `SMTP_USER_BILLING=<địa chỉ mailbox billing cần xác minh>`
- `SMTP_USER_SUPPORT=<địa chỉ mailbox support cần xác minh>`
- `SMTP_USER_NOREPLY=<địa chỉ mailbox noreply cần xác minh>`
- `SMTP_USER_CONTACT=<địa chỉ mailbox contact cần xác minh>`

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
- Workers.dev subdomain hiển thị: `sbizapp.workers.dev`.
- Zone ID của `sbiz.com`: chưa có.
- Trạng thái zone và nameserver hiện tại: chưa có.
- Worker/service name được chọn.
- Môi trường dự kiến: development, staging, production.
- Nếu dùng R2: tên bucket, region/hint nếu có, và mục đích bucket.
- Nếu dùng D1: database name, database ID, binding name và migration strategy.
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
2. Zone ID cho `sbiz.com`.
3. Trạng thái zone: Active hay còn chờ nameserver/verification.
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

## 6. Trạng thái

- [x] Chủ sản phẩm xác nhận đã mua domain `sbiz.com` trên Cloudflare.
- [x] Ghi nhận Account ID và workers.dev subdomain do chủ sản phẩm cung cấp (chưa xác minh trực tiếp trên dashboard).
- [x] Chủ sản phẩm xác nhận đã thiết lập email; địa chỉ mailbox/domain suffix và app password theo từng mailbox cần xác minh.
- [x] Ghi nhận cấu hình SMTP tiêu chuẩn từ tài liệu Yandex.
- [ ] Cloudflare Account ID được xác minh trực tiếp trên dashboard và Zone ID được thu thập.
- [ ] Tài nguyên Worker/D1/R2 hiện có được kiểm kê.
- [ ] Cấu hình secret được thiết lập an toàn theo từng môi trường.
- [ ] SMTP được kiểm thử trong runtime thực tế.
- [ ] Quy trình triển khai và phân quyền production được xác nhận.
