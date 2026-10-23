# SBIZ.APP — MODUL 01, PHẦN 1
## Kịch bản nghiệp vụ và quy tắc dữ liệu
**Phiên bản:** 1.6  
**Trạng thái:** Đã được Chủ dự án chấp thuận; có bổ sung trường liên kết giấy đăng ký kinh doanh.  
**Phạm vi:** Trang chủ, đăng ký, xác minh email, định danh doanh nghiệp, đăng nhập, khôi phục quyền truy cập và lưu dấu vết vòng đời doanh nghiệp.  
**Lưu ý:** Đây là đặc tả nghiệp vụ/kỹ thuật. Không có nghĩa mã nguồn đã được triển khai hoặc kiểm thử.

## 1. Trang chủ

Trang chủ `https://sbiz.app` cung cấp năm lựa chọn ngôn ngữ: English 🇺🇸, Tiếng Việt 🇻🇳, Bahasa Indonesia 🇮🇩, Español 🇲🇽 và Português 🇧🇷. English là mặc định ở trang chủ gốc. Người dùng có hai lựa chọn: **Create** và **Login**.

Ngôn ngữ giao diện trang chủ không tự động quyết định ngôn ngữ chính của doanh nghiệp.

## 2. Biểu mẫu đăng ký

Biểu mẫu Create có đúng ba trường:
1. Email.
2. Business slug.
3. Default language.

Default language trở thành L1 ban đầu. L1 là ngôn ngữ chính của doanh nghiệp và ngôn ngữ mặc định ban đầu của giao diện quản trị. L2 được cấu hình riêng và phải khác L1; L2 không mặc định luôn là English.

### 2.1. Business slug
- Độ dài đăng ký thông thường: 13–32 ký tự.
- Chỉ gồm chữ thường `a-z` và số `0-9`.
- Không dấu cách, dấu gạch ngang, dấu gạch dưới, dấu tiếng Việt hoặc ký tự đặc biệt.
- Phải duy nhất và không nằm trong danh sách slug dành riêng.
- Kiểm tra ở phía máy chủ, kể cả khi đã kiểm tra trên trình duyệt.
- Danh sách dành riêng tối thiểu gồm các tên hệ thống/đường dẫn như `admin`, `api`, `login`, `create`, `www`, `assets`, `support`, `help`, `pricing`, `privacy`, `terms`, `status`, `en`, `vi`, `id`, `es`, `pt`; danh sách phải được quản lý tập trung.
- Giới hạn 32 ký tự là quy tắc kỹ thuật được Chủ dự án chấp thuận trong bản này.

### 2.2. Email trùng
Nếu email đã thuộc một tài khoản chính thức, từ chối đăng ký mới. Thông báo: “Email này đã được sử dụng. Vui lòng đăng nhập bằng tài khoản hiện có.” Không tiết lộ slug hoặc thông tin tài khoản khác. Chuẩn hóa email nhất quán trước khi so sánh và có ràng buộc duy nhất ở tầng dữ liệu.

## 3. Xác minh email và thời hạn 30 phút

Sau khi biểu mẫu hợp lệ, hệ thống tạo yêu cầu đăng ký tạm thời và gửi email xác minh. Yêu cầu tạm thời không phải tài khoản chính thức; chưa cấp Business ID chính thức và chưa tạo bản ghi doanh nghiệp chính thức.

- Email xác minh có hiệu lực 30 phút, tính từ lúc hệ thống ghi nhận gửi thành công.
- Token được kiểm tra ở phía máy chủ, chỉ sử dụng một lần.
- Vì biểu mẫu đăng ký chỉ có ba trường và Login dùng email/mật khẩu, liên kết xác minh mở màn hình để người dùng đặt mật khẩu lần đầu. Mật khẩu không được thêm vào biểu mẫu Create. Hồ sơ chính thức chỉ được tạo sau khi token xác minh hợp lệ và người dùng gửi mật khẩu hợp lệ trong bước này.
- Hết hạn thì yêu cầu cũ mất hiệu lực và khách phải đăng ký lại từ đầu.
- Token hết hạn phải bị vô hiệu ngay về mặt nghiệp vụ; dữ liệu tạm được dọn định kỳ.
- Dữ liệu tạm không được dùng để tạo hoặc giả lập hồ sơ doanh nghiệp chính thức.

### 3.1. Email gửi thất bại
Nếu nhà cung cấp email không xác nhận gửi thành công, không báo đã gửi thành công và không tạo tài khoản chính thức. Hiển thị thông báo: “Hiện chưa thể gửi email xác minh. Tài khoản của bạn chưa được tạo. Vui lòng thử lại sau.” Cho phép thử lại có giới hạn; không để nhiều token đăng ký cùng hiệu lực. Với timeout không rõ kết quả, không mặc định rằng email đã được gửi.

### 3.2. Tạo hồ sơ chính thức thất bại
Sau xác minh hợp lệ, kiểm tra lại email và slug rồi tạo hồ sơ bằng giao dịch dữ liệu nhất quán. Nếu bước bắt buộc thất bại, rollback phần tạo hồ sơ; không để dữ liệu nửa chừng hoặc tạo trùng khi thử lại. Chỉ thông báo thành công khi việc ghi dữ liệu chính thức hoàn tất. Token xác minh ban đầu không được chấp nhận sau khi hết 30 phút.

## 4. Business ID bất biến

Business ID có dạng `sbiz-xxxxxxxxx`, trong đó `xxxxxxxxx` là 9 chữ số. Cấp theo nguyên tắc tăng dần +1, bắt đầu từ `sbiz-000000001`.

- Cấp mã an toàn khi có nhiều yêu cầu đồng thời.
- Không trùng, không tái sử dụng mã đã cấp.
- Không phụ thuộc slug hoặc email; không đổi khi doanh nghiệp thay đổi slug/email, gói cước hoặc xóa dữ liệu vận hành.
- Dải `000000001`–`999999999` có tối đa 999.999.999 mã. Phải có kiểm soát giới hạn và phương án trước khi hết dải.
- Các bảng nghiệp vụ tham chiếu định danh nội bộ ổn định, không dùng slug/email làm khóa chính.

## 5. Thay đổi slug và email

### 5.1. Slug
Slug có thể thay đổi mà không tạo doanh nghiệp mới. Slug mới phải hợp lệ và duy nhất. Slug mới dài hơn 12 ký tự được xử lý theo quyền hạn được cấp; slug dài không quá 12 ký tự chỉ admin hệ thống SBiz mới được sửa. Lịch sử slug phải được giữ; URL cũ được ánh xạ hoặc chuyển hướng khi an toàn.

### 5.2. Email
Email có thể thay đổi sau khi xác minh theo quy trình bảo mật. Email mới không được thuộc tài khoản chính thức khác. Lịch sử email được lưu; thay đổi email không đổi Business ID. Phân biệt email xác thực tài khoản với email liên hệ công khai nếu cả hai được hỗ trợ.

## 6. Login và Quên mật khẩu

Người dùng bắt đầu từ trang chủ và chọn Login. Phương thức đăng nhập: email và mật khẩu.

Chức năng **Quên mật khẩu**:
1. Người dùng nhập email.
2. Hệ thống phản hồi trung tính, không tiết lộ email có tài khoản hay không.
3. Nếu tài khoản đủ điều kiện, gửi liên kết đặt lại mật khẩu đến email đã đăng ký.
4. Liên kết đặt lại mật khẩu có thời hạn 30 phút theo quy tắc kỹ thuật riêng, chỉ sử dụng một lần và vô hiệu sau khi dùng thành công.
5. Token ngẫu nhiên an toàn; chỉ lưu dạng không thể dùng trực tiếp để đăng nhập.
6. Sau khi đặt lại mật khẩu, vô hiệu hóa hoặc xử lý các phiên cũ theo chính sách bảo mật.
7. Giới hạn tần suất yêu cầu và số lần thử.

Thời hạn 30 phút của liên kết đặt lại mật khẩu là riêng biệt, không thay đổi thời hạn xác minh đăng ký.

## 7. Custom Domain

Custom Domain sử dụng Cloudflare for SaaS. Quy trình phải xác minh quyền kiểm soát tên miền qua DNS, kiểm tra hostname không bị liên kết với doanh nghiệp khác, theo dõi trạng thái chờ xác minh/đang cấu hình/hoạt động/lỗi/gỡ liên kết và chỉ đánh dấu hoạt động sau khi trạng thái cấu hình thực tế được xác nhận. Gỡ liên kết không xóa Business ID hoặc dữ liệu doanh nghiệp.

## 8. Product slug và URL

Mỗi sản phẩm có `product_id` bất biến. Product slug là thành phần URL có thể thay đổi; đổi tên/slug không tạo sản phẩm mới. Quan hệ báo giá và nghiệp vụ dùng định danh ổn định. Lịch sử slug cũ được lưu và URL cũ được chuyển hướng khi an toàn, không xung đột với sản phẩm khác.

URL L1 không tự động thêm mã ngôn ngữ; URL L2 dùng mã ngôn ngữ tương ứng, ví dụ `/en` nếu L2 là English.

## 9. L1

Default language khi đăng ký là L1 ban đầu. Đề xuất đã được chấp thuận: chủ doanh nghiệp có thể xác nhận hoặc thay đổi L1 trong thiết lập/cài đặt. Thay đổi L1 không tạo doanh nghiệp mới, không đổi Business ID và không tự xóa nội dung hoặc bản dịch. Phải kiểm tra lại định tuyến và URL ngôn ngữ. L2 vẫn phải khác L1.

## 10. Hồ sơ truy vết doanh nghiệp

Hồ sơ truy vết được gắn với Business ID và giữ các mốc/sự kiện vòng đời để đối chiếu về sau.

### 10.1. Các trường và mốc thời gian bắt buộc
- `business_id`: Business ID bất biến.
- `current_slug`: slug hiện tại.
- `current_email`: email hiện tại.
- `created_at`: ngày khởi tạo hồ sơ doanh nghiệp chính thức.
- `verified_at`: ngày email được xác minh thành công.
- `subscription_started_at`: ngày ghi nhận mua gói cước thành công.
- `subscription_expires_at`: ngày gói cước hết hiệu lực hiện hành.
- `data_deleted_at`: ngày xóa dữ liệu vận hành; chỉ ghi khi sự kiện tương ứng thực sự xảy ra.
- `business_registration_document_url`: đường link giấy đăng ký kinh doanh dùng làm tài liệu tham chiếu khi admin xác minh/phê duyệt doanh nghiệp.
- `verification_status`: trạng thái xác minh doanh nghiệp (`unverified`, `verified`, `rejected`).
- `admin_verified_at`: thời điểm admin phê duyệt/xác minh doanh nghiệp.

### 10.2. Đường link giấy đăng ký kinh doanh
Trường `business_registration_document_url` được admin hệ thống SBiz điền thủ công khi phê duyệt/xác minh hồ sơ doanh nghiệp. Khi admin lưu đường link hợp lệ, hệ thống chuyển `verification_status` sang `verified`, ghi `admin_verified_at` và tạo sự kiện truy vết. Đây là trường liên kết đến tài liệu tham chiếu; không phải bằng chứng tự động rằng tài liệu hợp lệ. Cần lưu dấu vết ai nhập hoặc sửa đường link và thời điểm thay đổi. Chỉ admin có quyền mới được chỉnh sửa trường này. Không yêu cầu người dùng nhập trường này trong biểu mẫu đăng ký ba trường.

### 10.3. Lịch sử sự kiện
Ngoài các trường hiện hành, lưu sự kiện riêng cho:
- Tạo hồ sơ chính thức.
- Xác minh email.
- Admin phê duyệt/xác minh doanh nghiệp và thêm/sửa đường link giấy đăng ký kinh doanh.
- Thay đổi slug.
- Thay đổi email.
- Mua, gia hạn và hết hạn gói cước.
- Xóa dữ liệu vận hành.

Mỗi sự kiện gắn với Business ID và ghi thời điểm. Với thay đổi, lưu giá trị trước/sau khi cần thiết cho truy vết; phân biệt sự kiện thành công và thất bại. Lịch sử không được ghi đè làm mất dấu vết cũ. Email cũ, URL tài liệu và dữ liệu nhạy cảm chỉ được truy cập theo quyền hạn phù hợp.

Ngày hết hạn hiện hành không thay thế lịch sử từng kỳ gói cước. Mỗi lần mua/gia hạn phải có bản ghi lịch sử riêng.

### 10.4. Xóa dữ liệu vận hành
Khi xóa dữ liệu vận hành để tối ưu tài nguyên:
- Giữ Business ID.
- Giữ hồ sơ định danh cơ bản, slug/email hiện tại và lịch sử theo chính sách lưu trữ.
- Giữ năm mốc thời gian và lịch sử sự kiện cần thiết.
- Giữ đường link giấy đăng ký kinh doanh theo chính sách lưu trữ và phân quyền.
- Xóa dữ liệu vận hành trong phạm vi đã xác định.
- Không tái sử dụng Business ID.

Trạng thái xóa phải phản ánh đúng phạm vi thực tế, bao gồm các bản sao lưu hoặc bản lưu trữ còn tồn tại. Việc giữ hồ sơ truy vết không có nghĩa mọi người dùng đều được xem thông tin nhạy cảm.

## 11. Tiêu chí nghiệm thu

Phần 1 chỉ được coi là hoàn tất khi có bằng chứng kiểm thử cho:
- Trang chủ có năm ngôn ngữ và hai luồng Create/Login.
- Biểu mẫu đăng ký đúng ba trường.
- Slug đúng định dạng, độ dài, tính duy nhất và danh sách dành riêng.
- Email trùng bị từ chối.
- Token xác minh hết hạn sau 30 phút và không dùng lại được.
- Gửi email thất bại không tạo hồ sơ chính thức.
- Chỉ xác minh thành công mới cho phép tạo hồ sơ chính thức.
- Business ID tăng dần, duy nhất, bất biến và không tái sử dụng.
- Đổi slug/email không tạo doanh nghiệp mới.
- Slug dài không quá 12 ký tự chỉ admin hệ thống SBiz được sửa.
- Login và Quên mật khẩu xử lý token an toàn.
- Custom Domain chỉ hoạt động sau khi xác minh/cấu hình được xác nhận.
- Đổi product slug không làm mất định danh nội bộ.
- Năm mốc thời gian, lịch sử sự kiện và trường URL giấy đăng ký kinh doanh được lưu đúng; chỉ admin được sửa URL tài liệu.
- Xóa dữ liệu vận hành không xóa hồ sơ truy vết cần giữ.
- Các lỗi/thử lại không tạo dữ liệu trùng hoặc hồ sơ nửa chừng.

Không tuyên bố PASS nếu chưa có bằng chứng.

## 12. Trạng thái

Kịch bản MODUL 01 — Phần 1 phiên bản 1.4 được cập nhật theo nội dung đã được Chủ dự án chấp thuận và bổ sung trường URL giấy đăng ký kinh doanh. Đây là tài liệu đặc tả; chưa triển khai mã nguồn và chưa nghiệm thu chức năng.
