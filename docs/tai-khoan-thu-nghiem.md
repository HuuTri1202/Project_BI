# Tài khoản thử nghiệm

> **CHỈ DÙNG CHO MÔI TRƯỜNG DEV TRÊN MÁY CÁ NHÂN.**
>
> Toàn bộ tài khoản dưới đây nằm trong database `bi_platform` của container
> `bi-mysql` chạy ở localhost. Chúng là dữ liệu giả để thử giao diện, **không**
> phải tài khoản thật và **không bao giờ** được dùng lại mật khẩu này ở bất kỳ
> nơi nào chạm tới dữ liệu thật hay Internet.
>
> Khi triển khai thật: đổi `Admin@12345` trong `backend/.env` trước khi chạy
> `npm run db:seed` lần đầu, và xoá mọi tài khoản trong file này.

Cập nhật lần cuối: 11/08/2026 — bổ sung phần **Không gian cá nhân**.

---

## Đăng nhập nhanh

| Muốn thử gì | Dùng tài khoản |
|---|---|
| Console vận hành hệ thống `/admin` | `admin@bi-platform.local` |
| **Bộ chuyển tổ chức** trên sidebar (§5.1) | `hanh@saomai.vn` — thuộc 3 tổ chức |
| **Quản lý tổ chức** — 3 tab: Tổ chức · Workspace · Thành viên | `hanh@saomai.vn` hoặc `mai@anhduong.vn` |
| **Đổi tên tổ chức** (`PATCH /v1/tenant`, mới) | `mai@anhduong.vn` → Quản lý tổ chức → tab Tổ chức |
| **Kết nối CSDL + Kho dữ liệu** (§8) | `mai@anhduong.vn` — xem mục dưới |
| Người xem — bị ẩn hết nút hành động (§5.9) | `viewer@bi-platform.local` |
| **Cấp lại mật khẩu tạm** khi lỡ quên chép | `mai@anhduong.vn` — mời một người mới rồi thử |
| **Không gian cá nhân** cấp kèm tài khoản mới | `mai@anhduong.vn` — mời người mới, rồi đăng nhập bằng họ |

---

## Toàn bộ tài khoản

Mật khẩu chia làm hai nhóm: tài khoản seed dùng `Admin@12345` (lấy từ
`backend/.env`), còn lại đều là `Matkhau@123`.

| # | Email | Mật khẩu | Vai trò nền tảng | Tổ chức · vai trò trong đó |
|---|---|---|---|---|
| 1 | `admin@bi-platform.local` | `Admin@12345` | **superadmin** | BI Platform · admin |
| 2 | `mai@anhduong.vn` | `Matkhau@123` | user | Công ty Ánh Dương · admin |
| 3 | `viewer@bi-platform.local` | `Matkhau@123` | user | BI Platform · **viewer** |
| 4 | `hanh@saomai.vn` | `Matkhau@123` | user | **Công ty Sao Mai · admin**<br>BI Platform · viewer |
| 5 | `nam@saomai.vn` | `Matkhau@123` | user | Công ty Sao Mai · viewer<br>BI Platform · viewer |
| 6 | `dang@gmail.com` | *(mật khẩu của bạn — tôi không đặt lại)* | user | NASA · admin |

Tài khoản số 6 do bạn tự đăng ký qua trình duyệt. Tôi cố ý **không** đụng tới nó.

### Hai trục vai trò — đọc bảng trên cho đúng

Cột "vai trò nền tảng" là `users.role`, cột bên phải là `memberships.role`. Đây
là hai trục **độc lập** và rất dễ đọc nhầm:

- `superadmin` mở được `/admin` — console nhìn xuyên **mọi** tổ chức.
- `admin` trong một tổ chức mở được `/workspaces` và `/members` của **riêng** tổ
  chức đó, và **không** vào được `/admin`.

Ai đăng ký qua form đều tự động là `admin` của tổ chức mình vừa lập, nhưng vẫn
là `user` ở cấp nền tảng. `hanh@saomai.vn` là ví dụ rõ nhất: admin ở Sao Mai
nhưng chỉ viewer ở BI Platform — đổi tổ chức thì quyền đổi theo.

---

## Tổ chức và workspace

Bốn **công ty thật** — đây là những gì console `/admin` hiện mặc định:

| Tổ chức | slug | Workspace |
|---|---|---|
| BI Platform | `bi-platform` | Không gian mặc định |
| Công ty Ánh Dương | `cong-ty-anh-duong` | Không gian mặc định |
| Công ty Sao Mai | `cong-ty-sao-mai` | Không gian mặc định · Phòng Kinh doanh |
| NASA | `nasa` | Không gian mặc định |

Ngoài ra còn **8 không gian cá nhân**, mỗi tài khoản một cái — xem mục dưới.

### Không gian cá nhân

Từ migration 5, **tài khoản do Admin tạo qua `/members` được cấp kèm một tổ chức
riêng** tên "Không gian của \<họ tên\>", có sẵn một workspace mặc định, và người
đó là **`admin`** trong đó. Ngang hàng với thứ mà người tự đăng ký có.

Luật gọn trong một câu: **ai chưa làm chủ tổ chức nào thì được cấp một cái.**
Người tự đăng ký đã lập ra công ty của mình và làm admin ở đó — công ty ấy chính
là nơi họ làm chủ, nên họ **không** được cấp thêm. Chỉ người chỉ tồn tại bên
trong tổ chức của người khác (viewer, creator) mới thật sự chưa có chỗ nào.

Đăng nhập lần đầu họ vào **tổ chức được mời**, không phải không gian riêng — đó
là lý do tài khoản được tạo. Chuyển qua lại bằng **bộ chuyển tổ chức** trên
sidebar, dòng của không gian riêng ghi *Không gian riêng · Quản trị viên*.

Hai hệ quả cần biết:

- Người tự đăng ký **không** được cấp thêm — công ty họ vừa lập đã là nơi họ làm
  chủ. Mời một người **đã có tài khoản** (nhánh `attached`) cũng không sinh thêm
  tổ chức nào.
- Tài khoản tạo **trước** thay đổi này chỉ có một membership nên bộ chuyển không
  hiện ra. Cấp bù bằng:

  ```bash
  npm run db:backfill-personal            # xem trước, không ghi gì
  npm run db:backfill-personal -- --apply # thật sự ghi
  ```

  Đã chạy trên máy này ngày 11/08/2026 — **cả 8 tài khoản** trong bảng trên đều
  đã có không gian riêng. Script chạy lại được nhiều lần (chỉ lấy người còn
  thiếu), mỗi người một transaction, và **không đụng** mật khẩu hay membership
  đang có. Membership mới luôn mang id lớn nhất nên **không ai bị đổi chỗ đăng
  nhập mặc định** — `hanh@saomai.vn` vẫn mở ra Sao Mai như trước.

Console `/admin` **mặc định ẩn** loại tổ chức này ở cả hai màn Tổ chức và
Workspace — mỗi người dùng một dòng thì công ty thật sẽ bị chôn. Bộ lọc **Loại**
có "Không gian cá nhân" và "Tất cả"; dòng nào là cá nhân đều gắn nhãn. Thẻ KPI
"Tổ chức" và biểu đồ tăng trưởng cũng chỉ đếm công ty thật.

---

## Dựng lại từ đầu

Xoá volume MySQL hoặc `TRUNCATE` các bảng thì **mất hết** tài khoản ở trên.
Chỉ tài khoản số 1 được tạo lại tự động:

```bash
npm run infra:up     # bi-mysql + bi-redis
npm run dev          # migration tự chạy lúc backend khởi động
npm run db:seed      # tạo lại admin@bi-platform.local + tổ chức + workspace
```

Các tài khoản còn lại phải tạo tay: đăng ký qua `/register` để có tổ chức mới,
hoặc dùng màn **Thành viên** (`/members`) của một admin tổ chức để mời thêm
người. Mời qua `/members` sẽ sinh **mật khẩu tạm hiện đúng một lần** — hệ thống
chỉ lưu hash bcrypt nên không có cách nào xem lại — và cấp kèm một **không gian
cá nhân** (xem mục ở trên).

### Lỡ quên chép mật khẩu tạm

Bảng mật khẩu bây giờ **sống qua F5 và qua việc chuyển sang mục khác** (giữ trong
`sessionStorage`, 30 phút, riêng theo tổ chức và theo người đang đăng nhập), và
nút đóng chỉ mở sau khi bạn tự tích vào ô xác nhận. Nếu vẫn mất — đóng tab, hết
30 phút — thì bấm **Cấp lại mật khẩu** ở dòng của người đó trong `/members`.

Đó là **cấp lại**, không phải xem lại: hệ thống sinh mật khẩu mới và mật khẩu cũ
chết ngay. Ba trường hợp nút này từ chối:

| Tình huống | Kết quả |
|---|---|
| Người đó còn là thành viên của **một công ty khác** | `409 SharedIdentity` |
| Người đó là **superadmin** | `403 PlatformAdminProtected` |
| Chính mình | `403 CannotModifySelf` — dùng `/profile` để đổi |

Trường hợp đầu là lý do `nam@saomai.vn` và `hanh@saomai.vn` **không** cấp lại
được từ Sao Mai: họ còn ở BI Platform, nên tài khoản là danh tính dùng chung và
admin một tổ chức không được đặt lại mật khẩu của nó.

**Không gian cá nhân KHÔNG tính là "công ty khác".** Ai cũng có một cái, nên đếm
trơn thì nút này sẽ trả `409` ở 100% số lần — chết đúng tình huống nó sinh ra để
cứu. Đánh đổi: Admin cấp lại mật khẩu thì vào được cả không gian riêng của người
đó. Chấp nhận được vì đấy là tài khoản chính Admin vừa tạo và vừa đọc mật khẩu
đầu tiên. Không gian riêng của **người khác** thì vẫn tính, và vẫn `409`.

Mật khẩu mới **không** đá phiên đang mở của người đó ra (token còn hạn 7 ngày).
Cần chặn ngay thì dùng nút **Khoá**.

## Thử Kết nối CSDL & Kho dữ liệu (§8)

Không cần dựng thêm CSDL nào: **trỏ thẳng vào chính `bi-mysql`** và coi nó như
CSDL của khách hàng. Vào **Quản lý tổ chức → Kết nối → Thêm kết nối**:

| Ô | Giá trị |
|---|---|
| Loại CSDL | MySQL |
| Địa chỉ · Cổng | `127.0.0.1` · `3310` |
| Dùng SSL/TLS | **không tick** — `bi-mysql` chạy trong máy, không có chứng chỉ |
| Database | `bi_platform` |
| Tài khoản · Mật khẩu | `bi_user` · `bi_password` |

Bước 3 bấm **Kiểm tra kết nối** → hiện `8.0.46` thì nút Lưu mới mở. Sau đó vào
**Kho dữ liệu → Đồng bộ từ CSDL**, tích vài bảng (`users`, `tenants`,
`workspaces`) rồi xác nhận.

Bấm vào tên một tập dữ liệu để mở trang chi tiết, ở đó có hai tab:

- **Dữ liệu** — 100 dòng đầu, đọc **trực tiếp** từ CSDL nguồn mỗi lần mở trang.
  Nền tảng **không giữ bản sao dòng nào**, nên cũng không có tổng số dòng:
  `COUNT(*)` trên một bảng vài chục triệu dòng là một lần quét toàn bảng trên máy
  chủ của khách hàng, mỗi lần ai đó mở trang.
- **Cấu trúc** — ảnh chụp schema đã đồng bộ, có ô tìm cột theo tên hoặc kiểu.

Vài điều đáng thử để thấy hệ thống cư xử đúng:

- **Đồng bộ lần hai** cùng bộ bảng → báo *"không đổi"*, kho **không** nhân đôi.
- **Đổi tên** một dataset rồi đồng bộ lại → tên bạn đặt **vẫn còn**.
- **Xoá kết nối** khi còn dataset → `409` kèm số lượng phải dọn trước.
- Nhập **sai mật khẩu** ở bước 3 → hiện *"Sai tên đăng nhập hoặc mật khẩu…"*,
  không phải một chuỗi lỗi của thư viện.
- Đăng nhập bằng `viewer@bi-platform.local` → **thấy** Kho dữ liệu nhưng
  **không** thấy nút Đồng bộ, và tab Kết nối biến mất khỏi Quản lý tổ chức.

Mật khẩu CSDL được mã hoá AES-256-GCM bằng `CONNECTION_ENCRYPTION_KEY` trong
`backend/.env`, và **không bao giờ** trả về cho trình duyệt. Kiểm chứng:

```bash
docker exec bi-mysql mysql -uroot -prootpassword bi_platform \
  -e "SELECT LEFT(password_cipher, 40) FROM connections;"
# -> v1.BfbWsVXW0245Rebt.TZsLKqZLHPJrb3HaMAGo...
```

### Thử ClickHouse

Hệ thống nhận **hai loại CSDL: MySQL và ClickHouse**. Hai cách dựng ClickHouse để
thử, và chúng khác nhau ở đúng ô SSL:

| | Cổng | Dùng SSL/TLS |
|---|---|---|
| Tự dựng: `docker compose --profile data up -d clickhouse` | `8123` | **không** tick |
| ClickHouse Cloud | `8443` | **tick** |

Máy chủ tự dựng dùng `bi_analytics` / `bi_user` / `clickhouse_password`.

ClickHouse Cloud **chỉ nhận HTTPS**: gửi HTTP thô vào cổng 8443 thì nó đóng phăng
socket, và thông báo hiện ra là *"Máy chủ đóng kết nối ngay khi vừa mở. Gần như
chắc chắn CSDL này yêu cầu SSL…"*. Tick ô là xong. Lần bấm **Kiểm tra kết nối**
đầu tiên có thể mất tới nửa phút vì Cloud tự ngủ khi không ai dùng và cần thời
gian thức dậy — đó là lý do thời gian chờ của ClickHouse là 30 giây thay vì 10.

**Chỉ nhánh MySQL được test tự động.** ClickHouse có driver nhưng phải thử tay.

## Còn thiếu gì để thử đủ vai trò

Hiện **không có tài khoản nào giữ vai trò `creator`**. Đó là bậc giữa: tạo và
sửa được project/báo cáo, nhưng không quản lý được thành viên và workspace. Muốn
thử §5.9 cho đủ ba bậc thì đăng nhập bằng `hanh@saomai.vn`, vào `/members` và
đổi vai trò của `nam@saomai.vn` thành **Người tạo báo cáo**, rồi đăng nhập lại
bằng Nam.

## Database test

Bộ test tích hợp chạy trên database **riêng** `bi_platform_test` và
`TRUNCATE` sạch trước mỗi ca, nên `npm run test:integration` không bao giờ đụng
tới các tài khoản ở trên. Database đó phải tồn tại và đã migrate:

```bash
docker exec bi-mysql mysql -uroot -prootpassword \
  -e "CREATE DATABASE IF NOT EXISTS bi_platform_test
      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      GRANT ALL PRIVILEGES ON bi_platform_test.* TO 'bi_user'@'%'; FLUSH PRIVILEGES;"

MYSQL_DATABASE=bi_platform_test npm --workspace backend run migrate
```
