# Sổ tay bảo vệ — Open Insight

Tài liệu này viết để **trả lời được khi bị hỏi**, không phải để mô tả cho đẹp.
Mỗi chức năng gồm bốn phần: _làm gì_ → _đường đi trong hệ thống_ → _vì sao làm
vậy_ → _câu hay bị hỏi_. Con số trong đây đều lấy từ mã nguồn, có ghi chỗ lấy.

Chi tiết kỹ thuật sâu hơn nằm ở `README.md` (3.284 dòng, chia theo §). Sổ tay
này là bản rút gọn theo thứ tự một hội đồng sẽ hỏi.

---

## 1. Hệ thống trong một trang

**Một câu:** Open Insight là nền tảng phân tích dữ liệu tự phục vụ, nhiều doanh
nghiệp dùng chung một bản cài, người nghiệp vụ tự đưa dữ liệu lên rồi tự dựng
báo cáo trên trình duyệt mà không viết SQL.

**Bốn loại người dùng** — nhớ kỹ vì đây là chỗ dễ bị vặn:

| Trục     | Cột trong CSDL     | Giá trị                          | Nghĩa                                               |
| -------- | ------------------ | -------------------------------- | --------------------------------------------------- |
| Hệ thống | `users.role`       | `superadmin` \| `user`           | Người vận hành nền tảng, đứng **ngoài** mọi tổ chức |
| Tổ chức  | `memberships.role` | `admin` \| `creator` \| `viewer` | Quyền thật khi làm việc, **theo từng tổ chức**      |

Một người có thể là `admin` ở công ty A và `viewer` ở công ty B. `superadmin`
**không** đi tắt qua quyền tổ chức — muốn làm việc trong một tổ chức thì phải
được cấp membership thật. Lý do: cho phép đi tắt là biến mọi câu kiểm quyền
thành "trừ khi là superadmin", và một tài khoản vận hành bị chiếm là mất sạch
dữ liệu của mọi khách hàng.

**Đường đi một câu:** dữ liệu vào bằng **hai cửa** (tệp Excel/CSV, hoặc nối thẳng
CSDL doanh nghiệp) → gặp nhau ở **một đường nạp** vào kho ClickHouse → khai
**mô hình ngữ nghĩa** (chiều, thước đo, khoá nối) → Cube.js sinh SQL → **biểu đồ
và báo cáo** → xuất PNG/PDF/Excel. Song song là **gói dịch vụ**: mua gói bằng
VietQR, gói quyết định hạn mức.

---

## 2. Bản đồ kiến trúc — tắt cái nào thì hỏng gì

```
React + Vega-Lite  ──►  Express (BFF)  ──►  Cube.js  ──►  ClickHouse
                             │                                 ▲
                             ├── Casbin   (phân quyền)         │
                             ├── MySQL    (toàn bộ metadata)   │
                             ├── Redis    (cache, chống dò)    │
                             └── MinIO    (tệp gốc)  ──────────┘
                                    backend nạp vào kho
```

| Thành phần     | Giữ gì                                                                                                                      | Tắt nó thì mất gì                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MySQL**      | Người dùng, tổ chức, quyền (`casbin_rule`), kết nối, bộ dữ liệu, lược đồ cột, mô hình, báo cáo, hàng đợi nạp, đơn hàng, gói | Hỏng toàn bộ — không đăng nhập được                                                                                                                      |
| **ClickHouse** | Dữ liệu phân tích thật, bảng `raw_t{tổ chức}_d{bộ dữ liệu}`                                                                 | Báo cáo không có số; nạp kho thất bại                                                                                                                    |
| **Cube.js**    | Không giữ gì — chỉ sinh SQL từ mô hình                                                                                      | **Mọi biểu đồ mất số**, kể cả báo cáo đã lưu: trang vẫn mở nhưng từng ô báo lỗi riêng. Mọi số liệu đều đi qua Cube (`runExplorerQuery` → `loadFromCube`) |
| **MinIO**      | Tệp gốc người dùng tải lên                                                                                                  | Không tải tệp mới; không nạp lại được bộ dữ liệu nguồn tệp                                                                                               |
| **Redis**      | Cache phân tích tệp 30 phút, bộ đếm chống dò mật khẩu                                                                       | Wizard tải tệp chậm lại (phải phân tích lại); mất lớp chặn dò mật khẩu                                                                                   |
| **Express**    | API, hai luồng nạp, vòng lặp nạp kho, sinh chuỗi VietQR                                                                     | Mất tất cả                                                                                                                                               |

**Ba ranh giới phải thuộc:**

1. **Cube không bao giờ lộ ra trình duyệt.** Trình duyệt gọi
   `POST /api/v1/datamodels/:id/query` của Express; Express kiểm quyền, ký một
   JWT sống **60 giây** mang `securityContext`, rồi mới chuyển tiếp sang Cube.
   Cổng 4100 không mở ra ngoài. (`services/datamodel/cubeClient.ts`)
2. **Tệp không đi qua máy chủ ứng dụng.** Trình duyệt PUT thẳng lên MinIO bằng
   đường dẫn có chữ ký hạn **15 phút**; Express chỉ cấp vé và kiểm quyền.
3. **Docker chỉ đóng gói hạ tầng.** `infrastructure/docker-compose.yml` dựng 5
   dịch vụ (MySQL, Redis, MinIO, ClickHouse, Cube). Backend và frontend chạy
   bằng `npm run dev` — **repo chưa có Dockerfile cho ứng dụng**. Nói đúng như
   vậy, đừng nói "đóng gói toàn bộ bằng Docker".

---

## 3. Đường đi của dữ liệu

### Luồng 1 — tải tệp lên (5 bước)

1. **Xin vé tải lên** — kiểm định dạng, kiểm hạn mức dung lượng của gói, tạo
   bản ghi bộ dữ liệu ở trạng thái chờ, sinh đường dẫn ký sẵn hạn 15 phút.
2. **Trình duyệt tải thẳng lên MinIO** (Uppy), có thanh tiến trình.
3. **Phân tích tệp** — kiểm định dạng bằng **byte đầu tệp** (không tin phần mở
   rộng), tách sheet, đoán kiểu từng cột từ **200 dòng đầu**, cache kết quả
   **30 phút** trong Redis.
4. **Chốt sheet** — xem trước, chọn sheet, đặt tên; ghi lược đồ cột và **1.000
   dòng mẫu** vào MySQL, tất cả trong một giao dịch.
5. **Tự xếp hàng nạp** — thêm một dòng vào hàng đợi; kho tự nạp.

### Luồng 2 — nối cơ sở dữ liệu (6 bước)

1. **Chuẩn bị** — trả về IP cần mở tường lửa, quyền cần cấp, cổng mặc định.
2. **Thử kết nối** — phân giải tên miền → **kiểm IP có thuộc dải nội bộ không**
   → kết nối bằng chính IP đã kiểm (chống SSRF). Không thử thành công thì không
   lưu được.
3. **Lưu kết nối** — mật khẩu mã hoá **AES-256-GCM** trước khi ghi xuống CSDL.
4. **Liệt kê bảng** — đọc danh sách CSDL và bảng, đánh dấu bảng đã nhập.
5. **Đồng bộ** — **chỉ đọc cấu trúc** (tên cột, kiểu, thứ tự), không chép dòng
   nào; ghi lược đồ trong một giao dịch.
6. **Tự xếp hàng nạp** — thêm dòng vào hàng đợi **cả khi cấu trúc không đổi**,
   vì cấu trúc không đổi không có nghĩa dữ liệu không đổi.

> Chỉ hỗ trợ **MySQL và ClickHouse** làm nguồn (`CONNECTION_KINDS`). PostgreSQL,
> SQL Server chưa có driver — nói thẳng nếu bị hỏi.

### Điểm gặp — nạp vào kho phân tích (5 bước)

1. **Nhặt việc** — vòng lặp nền trong chính tiến trình Express, **2 giây** một
   nhịp.
2. **Dựng bảng tạm** bên cạnh bảng đang phục vụ (hậu tố `__new`).
3. **Đổ dữ liệu** theo lô **5.000 dòng**, đọc thẳng từ tệp gốc trên MinIO hoặc
   từ CSDL doanh nghiệp. Ô không ép được kiểu → ghi rỗng, ghi nhật ký lỗi, đi
   tiếp (không bỏ cả lần nạp vì một ô hỏng).
4. **Tráo chỗ** — `EXCHANGE TABLES`, một thao tác nguyên tử.
5. **Dọn** bảng cũ, trả lại dung lượng đĩa ngay.

**Vì sao tráo chỗ thay vì xoá rồi nạp lại:** xoá sạch rồi nạp mới để lộ vài phút
mà **mọi báo cáo đang mở đều trả về 0**. Dựng bảng mới rồi tráo thì người dùng
không thấy khoảnh khắc nào bảng rỗng.

**Vì sao tên bảng sinh từ số nguyên** (`raw_t4_d17`): định danh bảng không tham
số hoá được trong câu `CREATE TABLE`; tên sheet Excel có dấu tiếng Việt, khoảng
trắng, cả emoji; đổi tên bộ dữ liệu sẽ thành mất bảng; hai bộ trùng tên sẽ đâm
nhau.

---

## 4. Từng chức năng

### 4.1 Đăng ký · đăng nhập · phiên

**Làm gì.** Tự viết trong Express, không dùng Keycloak: `bcryptjs` băm mật khẩu,
`jsonwebtoken` ký JWT **HS256**, hạn mặc định **7 ngày**.

**Đường đi.** `POST /api/auth/login` → token + thông tin người dùng + danh sách
tổ chức. Token lưu ở `localStorage`, gửi kèm header `Authorization: Bearer`.
`GET /api/auth/me` khôi phục phiên khi F5 — **đọc lại từ CSDL, không tin payload
token** (một người vừa bị hạ quyền không được dùng token cũ để giữ quyền cũ).

**Vì sao.** "Đóng app là hết phiên": token sống trong `localStorage` nhưng có
thêm một dấu trong `sessionStorage` đánh dấu "tab này đã chạy app". Mở tab mới
hoàn toàn thì không có dấu đó → bắt đăng nhập lại; F5 thì còn dấu → giữ phiên.

**Hay bị hỏi.**

- _Vì sao không dùng Keycloak/OAuth?_ Một hệ thống một máy chủ, ba vai trò, đăng
  nhập bằng email — Keycloak thêm một dịch vụ phải vận hành và một mô hình dữ
  liệu thứ hai cho người dùng. Đã gỡ, ghi rõ trong README.
- _JWT bị lộ thì sao?_ Hạn 7 ngày, và mọi request đọc lại vai trò từ CSDL nên
  hạ quyền có hiệu lực ngay. Đổi mật khẩu không thu hồi token — đây là giới hạn
  đã biết (xem mục 6).

### 4.2 Tổ chức · không gian làm việc · thành viên

**Làm gì.** Một người thuộc nhiều tổ chức qua bảng nối `memberships`. Mỗi tổ
chức có nhiều **không gian làm việc** (workspace).

**Luật phạm vi — câu này hay bị hỏi:** báo cáo, bộ dữ liệu, mô hình dữ liệu đều
thuộc về **một workspace**, không hiện ở workspace khác. Chỉ ba thứ dùng chung
cấp tổ chức: **thành viên, kết nối CSDL, thông tin tổ chức**.

**Thêm thành viên = tạo tài khoản + mật khẩu tạm**, không phải gửi lời mời qua
email (hệ thống chưa có kênh mail cho việc này). Người được thêm bị buộc đổi mật
khẩu ở lần đăng nhập đầu (`must_change_password`). Nếu email đã tồn tại trên nền
tảng thì **gắn** người đó vào tổ chức chứ không báo lỗi — nếu không thì một
người đang làm ở công ty khác sẽ vĩnh viễn không được mời vào tổ chức thứ hai.

**Đã ghi ra như một cái giá, không giấu:** endpoint này cho phép một Admin biết
một email bất kỳ đã đăng ký trên nền tảng hay chưa (phản hồi `created` hay
`attached`). Giảm nhẹ bằng rate limit 20 lượt/10 phút.

### 4.3 Phân quyền (Casbin)

**Làm gì.** Ma trận `vai trò × tài nguyên × hành động`, lưu trong bảng
`casbin_rule` của MySQL, nạp vào bộ nhớ lúc khởi động.

**Model.** `r = sub, dom, obj, act` — `sub` là **vai trò** (`admin`/`creator`/
`viewer`), `dom` là **`tenantId`**, `obj` là tài nguyên (`report`, `dataset`,
`member`…), `act` là hành động (`read`, `modify`, `delete`, `invite`).

**Ranh giới quan trọng:** Casbin trả lời _"vai trò này được làm gì với LOẠI tài
nguyên này"_. Nó **không** trả lời _"dòng dữ liệu này có thuộc tổ chức của bạn
không"_ — câu đó do `WHERE tenant_id = ?` trong mọi repository trả lời. Nhầm hai
câu này là rò dữ liệu giữa các công ty.

**Vai trò tươi:** middleware đọc vai trò **thật từ CSDL ở mỗi request**
(`requireFreshMembership`) rồi mới truyền vào Casbin, nên một người vừa bị hạ
quyền mất quyền ngay, không đợi nạp lại policy.

**Hay bị hỏi.**

- _Vì sao Casbin chứ không tự viết if-else?_ Ma trận quyền nằm trong **dữ liệu**
  chứ không nằm trong mã: thêm một vai trò hay một tài nguyên là thêm dòng vào
  bảng, không phải sửa hàng chục chỗ kiểm tra rải rác.
- _Workspace có phân quyền riêng không?_ **Không.** Workspace là phạm vi **dữ
  liệu**, chặn bằng `workspace_id` trong truy vấn, không phải phạm vi quyền.

### 4.4 Kết nối CSDL

**Làm gì.** Khai một lần thông tin kết nối tới CSDL của doanh nghiệp, sau đó
chọn bảng để đồng bộ cấu trúc.

**Ba điểm kỹ thuật đáng nói.**

- **Mật khẩu kết nối mã hoá hai chiều (AES-256-GCM), không băm** — vì phải lấy
  lại được để mở kết nối. GCM có mã xác thực: sửa một byte bản mã thì giải mã
  báo lỗi thay vì trả ra chuỗi rác.
- **Chống SSRF**: phân giải tên miền → kiểm IP có thuộc dải nội bộ → kết nối
  bằng chính IP đã kiểm, tránh tên miền đổi IP giữa lúc kiểm và lúc kết nối.
- **Đồng bộ không bao giờ xoá bộ dữ liệu**: lần quét không thấy một bảng thì vẫn
  giữ nguyên. Coi "không thấy" là "đã xoá" sẽ biến một sự cố mạng tạm thời thành
  mất dữ liệu hàng loạt.

### 4.5 Kho dữ liệu

**Làm gì.** Một trang cho **cả hai nguồn** (tệp và CSDL). Cột "Nguồn" nói rõ cái
nào là cái nào.

**Vì sao một bảng chứ không hai tab:** người dùng hỏi "tôi dựng báo cáo lên được
cái gì", không hỏi "tôi đã nạp bằng đường nào".

**Có gì trong đó:** thư mục để gom bộ dữ liệu (mặc định "Chung"), tìm kiếm, lọc
theo nguồn/kết nối, trang chi tiết xem cột và dữ liệu mẫu, nút nạp lại kho, nhật
ký lỗi nạp.

**MySQL chỉ giữ 1.000 dòng mẫu** (`RETAINED_ROWS`) cho tab Xem trước. Dữ liệu
đầy đủ đi thẳng từ MinIO vào ClickHouse. Vì sao: cùng một dữ liệu từng bị lưu
**ba lần** (Redis + `dataset_rows` + ClickHouse), và bản JSON đắt hơn bản trong
ClickHouse **6,3 lần** vì lặp tên cột ở mỗi dòng.

### 4.6 Mô hình dữ liệu

**Làm gì.** Gom nhiều bộ dữ liệu lại, khai **quan hệ** (khoá nối) và **thước
đo**, để Cube biết cách nối bảng và cách tính.

**Quan hệ:** ba kiểu `one_to_many`, `many_to_one`, `one_to_one`; hệ thống chặn
quan hệ tự nối chính nó và chặn **vòng lặp** quan hệ.

**Thước đo:** ba cách ra đời (`MEASURE_KINDS`)

- `column` — gộp một cột sẵn có (SUM, AVG, COUNT…),
- `formula` — công thức từ hai thước đo khác,
- `rowExpr` — biểu thức tính trên từng dòng rồi mới gộp.

**Vì sao cần tầng này:** một mô hình nhiều bảng có hàng trăm tổ hợp câu hỏi,
viết SQL tay dễ ra **số sai mà biểu đồ vẫn trông bình thường** — ví dụ kinh điển:
một đơn có 3 dòng chi tiết, nối bảng rồi cộng tổng đơn sẽ bị nhân ba. Cube chặn
đúng lỗi đó.

### 4.7 Khám phá dữ liệu (Explorer)

**Làm gì.** Màn hình hỏi số liệu trực tiếp trên mô hình: chọn chiều, chọn thước
đo, xem kết quả và xem cả **câu SQL Cube sinh ra** (`/datamodels/:id/query/sql`).

**Đáng nói:** `/datamodels/:id/explorer-status` báo Cube còn sống hay không, để
màn hình nói được "Cube chưa bật, chạy `docker compose up cube`" thay vì hiện
một lỗi mạng trống trơn. Trình dựng báo cáo dùng chung tín hiệu đó: Cube chết
thì nút "Thêm biểu đồ" và thu phóng bị khoá, kèm câu giải thích.

### 4.8 Trình dựng báo cáo

**Làm gì.** Kéo thả chiều và thước đo vào ba ô: **Trục · Giá trị · Nhóm màu**.

- **8 loại biểu đồ**: cột, thanh ngang, đường, miền, tròn, phân tán, bảng số
  liệu, bản đồ nhiệt. (Không có "thẻ số", không có "pivot table" — nhớ kỹ, slide
  cũ ghi sai.)
- **Khung 12 cột**, tối đa **12 biểu đồ mỗi trang**, tối đa **10 trang** một báo
  cáo.
- **Chú thích** trên khung: văn bản, đường kẻ/mũi tên, hình khoanh vùng.
- **Hoàn tác/làm lại**, thu phóng, kéo thả tự do (ô được phép đè nhau — như
  Power BI, dễ đoán hơn kiểu tự đẩy nhau ra).

**Vì sao trần 12 ô một trang:** mỗi ô là một truy vấn; 20 biểu đồ trên một trang
vừa chậm vừa không ai đọc nổi. Trần là **của một trang**, không phải của cả báo
cáo — muốn nhiều hơn thì thêm trang.

**Số liệu lấy thế nào:** trình dựng hỏi **theo từng ô** (đang sửa ô nào thì hỏi
ô đó), trang xem hỏi **một lần cho cả trang** (`/reports/:id/canvas-data`).

### 4.9 Xem và xuất báo cáo

**Xem và sửa là hai trang riêng**: `/reports/:id` (mọi vai trò, một request cho
cả trang) và `/reports/:id/edit` (chỉ người sửa được). Viewer mở nhầm link
`/edit` thì bị **đẩy về trang xem**, không rơi vào màn hình 403 — cái họ muốn là
đọc báo cáo.

**Xuất:** PNG, PDF (một trang hoặc tất cả các trang), **Excel**. Có thể chọn xuất
một phần biểu đồ. Trang đang xem được chụp đúng thứ đang hiển thị; các trang
khác được dựng **ngoài màn hình** rồi chụp, để màn hình không nhảy qua lại.

> **Chưa có:** xuất CSV, và chia sẻ báo cáo bằng link. "Chia sẻ" hiện nay =
> người cùng workspace có quyền đọc thì thấy.

### 4.10 Gói dịch vụ và hạn mức

**Bốn hạn mức:** số **không gian làm việc**, số **báo cáo**, số **thành viên**,
**dung lượng lưu trữ**.

**Dung lượng đo bằng chỗ chiếm trong kho phân tích (ClickHouse), không đo kích
thước tệp.** Hai lý do đo được bằng số thật trên máy dev:

- bộ dữ liệu nguồn `connection` không có tệp nào → kích thước tệp luôn bằng 0,
  tức đồng bộ CSDL là miễn phí vô hạn;
- tệp nén: 519 MB tệp chỉ thành 43 MB trong kho, nên tính theo tệp là **thu tiền
  cho chỗ mà hệ thống không hề chiếm**.

**Hạn mức là ẢNH CHỤP lúc mua**, không đọc sống từ bảng giá: người vận hành sửa
bảng giá không được phép cắt hạn mức của người đã trả tiền giữa kỳ.

**Không có dòng subscription = đang ở gói Free.** Đó là luật cố ý, thay cho việc
phải chèn một dòng Free ở mọi đường tạo tổ chức (đăng ký, tổ chức cá nhân, seed,
test) — đường nào quên là hỏng.

### 4.11 Thanh toán VietQR

**Làm gì.** Bán gói theo tháng/năm, **không qua cổng thanh toán**.

**Mã QR do hệ thống tự dựng** theo chuẩn **EMVCo/NAPAS** (chuỗi TLV + mã kiểm
CRC), lưu vào `orders.qr_payload`; trình duyệt vẽ chuỗi đó thành ảnh.
**Vì sao không nhúng `img.vietqr.io`:** nó gửi số tài khoản, số tiền và mã đơn
sang máy chủ bên thứ ba ở mỗi lần mở trang; trang thanh toán chết khi dịch vụ đó
chết; và chuỗi tự dựng lưu được nên đơn cũ vẫn hiện đúng tài khoản đã quét.

**Mã đơn:** `BI` + 10 ký tự Crockford Base32 (bỏ I, L, O, U) — đọc được qua điện
thoại, qua được bộ lọc ký tự của ngân hàng, không đoán được đơn của người khác.

**Nhận tiền:** dịch vụ đọc sao kê SePay, hai chiều — **kéo** (hỏi mỗi **5 giây**,
và chỉ gọi ra Internet khi trong CSDL có đơn đang chờ) và **đẩy** (webhook, xác
thực **HMAC-SHA256** trên raw body).

**Ba lớp bảo vệ tiền:**

1. **Chống trùng bằng hai ràng buộc UNIQUE ở tầng CSDL**, không ở mã lệnh — một
   giao dịch ngân hàng chỉ khớp được một lần, kể cả khi webhook và luồng kéo
   chạy song song.
2. **Luật số tiền** — chuyển thiếu thì không bật gói, đơn chuyển sang chờ đối
   chiếu.
3. **Tiền về muộn** — vẫn tìm tiền cho đơn đã hết hạn trong **24 giờ**
   (`LATE_PAYMENT_WINDOW_HOURS`), vì khách chuyển khoản lúc 17h05 cho đơn hết
   hạn lúc 17h00 là chuyện thật.

**Thành phần duy nhất không mã nguồn mở:** dịch vụ đọc sao kê (rào cản nằm ở phía
ngân hàng). Sinh QR, khớp đơn, chống trùng, kích hoạt gói đều tự làm.

### 4.12 Khu quản trị nền tảng (`/admin`)

Phân hệ dành cho `superadmin`, **không có trong bộ slide hiện tại** nhưng có thật
và khá lớn:

- Tổng quan nền tảng (`/overview`)
- Quản lý **tổ chức**, **người dùng**, **không gian làm việc** (xem, khoá/mở)
- **Bảng giá**: tạo/sửa gói và hạn mức
- **Phương thức thanh toán**: tài khoản ngân hàng, ảnh QR tĩnh (MoMo)
- **Đơn hàng**: danh sách, xác nhận tay, danh sách đơn "cần chú ý"
- **Ghi đè gói** cho một tổ chức
- Nạp lại ma trận quyền (`/authz/reload`)

### 4.13 Email và quên mật khẩu

**Chỗ duy nhất hệ thống gửi email** là luồng quên mật khẩu: nhập email → nhận
link đặt lại → đặt mật khẩu mới. Gửi bằng Nodemailer qua SMTP khai trong
`backend/.env`.

Thêm thành viên **không** gửi mail (xem 4.2).

### 4.14 Chống lạm dụng và sức khoẻ hệ thống

- **Rate limit bằng Redis** ở 7 chỗ: đăng nhập, tải tệp lên, mời thành viên, đặt
  lại mật khẩu, thử kết nối CSDL, tạo đơn hàng, webhook thanh toán.
- Trang `/system-health` kiểm tra backend còn sống và ping **MySQL + Redis**.
  (Chưa ping ClickHouse, MinIO, Cube — nếu bị hỏi thì nói đúng phạm vi này.)
- Mọi lỗi API có cùng hình dạng `{ error, message, fields? }`.

---

## 5. Những con số phải thuộc

| Con số          | Nghĩa                                 | Lấy ở                                    |
| --------------- | ------------------------------------- | ---------------------------------------- |
| **50 MB**       | Trần một tệp tải lên                  | `UPLOAD_MAX_BYTES`                       |
| **15 phút**     | Hạn đường dẫn ký sẵn lên MinIO        | `s3Storage.ts`                           |
| **200 dòng**    | Mẫu để đoán kiểu cột                  | `SAMPLE_ROWS`                            |
| **1.000 dòng**  | Dữ liệu mẫu giữ trong MySQL           | `RETAINED_ROWS`                          |
| **30 phút**     | Cache kết quả phân tích tệp (Redis)   | `analyze.ts`                             |
| **5.000 dòng**  | Một lô nạp vào ClickHouse             | `BATCH_ROWS`                             |
| **2 giây**      | Nhịp vòng lặp nạp kho                 | `POLL_MS`                                |
| **1 giờ**       | Nhịp janitor dọn bảng mồ côi          | `runner.ts`                              |
| **8**           | Số loại biểu đồ                       | `CHART_TYPES`                            |
| **12 / 10**     | Biểu đồ mỗi trang / trang mỗi báo cáo | `CANVAS_MAX_VISUALS`, `CANVAS_MAX_PAGES` |
| **12 cột**      | Lưới khung báo cáo                    | `CANVAS_COLUMNS`                         |
| **60 giây**     | Hạn JWT nội bộ gửi sang Cube          | `cubeClient.ts`                          |
| **7 ngày**      | Hạn JWT đăng nhập                     | `JWT_EXPIRES_IN`                         |
| **5 giây**      | Nhịp hỏi sao kê ngân hàng             | `SEPAY_MS`                               |
| **24 giờ**      | Cửa sổ nhận tiền về muộn              | `LATE_PAYMENT_WINDOW_HOURS`              |
| **AES-256-GCM** | Mã hoá mật khẩu kết nối CSDL          | `secretBox.ts`                           |
| **HMAC-SHA256** | Xác thực webhook thanh toán           | `webhookSignature.ts`                    |

**Kiểm thử:** 25 tệp test backend (trong đó **15 tệp chạy tích hợp trên MySQL và
ClickHouse thật**), 41 tệp test frontend. Tổng ~697 ca backend + 496 ca frontend.

> ⚠️ Hiện có **1 ca đỏ** ở `billingApi.integration` — nguyên nhân là **đồng hồ
> container MySQL chạy nhanh hơn máy thật vài phút**, không phải lỗi mã. Khởi
> động lại container `bi-mysql` là xanh. Nếu định chạy test trước hội đồng thì
> restart trước cho chắc.

---

## 6. Giới hạn đã biết — nói thật thế nào

Hội đồng đánh giá cao việc biết rõ giới hạn của chính mình. Nói theo mẫu:
_"chỗ này chúng em biết, đây là cái giá, và đây là lý do chấp nhận nó ở quy mô
hiện tại."_

| Giới hạn                                             | Nói thế nào                                                                                                                                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Job nạp không sống qua restart**                   | Hàng đợi là một bảng MySQL + `setTimeout`, không phải hàng đợi thật. Ở quy mô vài lần nạp một ngày, thêm BullMQ là thêm một tiến trình phải vận hành. Backend restart giữa chừng thì job bị đánh `failed`, bấm nạp lại. |
| **Chỉ một job nạp một lúc**                          | Hai tổ chức cùng nạp thì xếp hàng. Đổi được bằng cách cho chạy song song theo tổ chức, chưa cần.                                                                                                                        |
| **Luôn nạp lại toàn bộ**                             | Chưa có nạp tăng dần, chưa có lịch tự động.                                                                                                                                                                             |
| **Cách ly ClickHouse ở tầng ứng dụng**               | Một `bi_user` thấy mọi bảng; cách ly thật nằm ở `securityContext` của Cube và `WHERE tenant_id` của Express. Đúng nhưng là **một lớp**, không phải hai.                                                                 |
| **Chưa đóng gói ứng dụng bằng Docker**               | Hạ tầng có Compose; backend/frontend chạy bằng npm. Đây là việc còn lại của phần triển khai.                                                                                                                            |
| **Chưa có chia sẻ báo cáo bằng link, chưa xuất CSV** | Chia sẻ hiện nay dựa trên quyền trong workspace.                                                                                                                                                                        |
| **Thêm thành viên chưa qua email**                   | Admin đọc mật khẩu tạm cho người kia; hệ thống buộc đổi ngay lần đăng nhập đầu.                                                                                                                                         |
| **Đổi mật khẩu không thu hồi token cũ**              | JWT vô trạng thái, hạn 7 ngày.                                                                                                                                                                                          |
| **Excel chưa streaming ở bước phân tích**            | Bước nạp thì có; bước phân tích dựng cả workbook trong RAM, bị chặn bởi trần 50 MB.                                                                                                                                     |
| **Luồng 2 chỉ hỗ trợ MySQL và ClickHouse**           | Thêm PostgreSQL chỉ là thêm một driver, kiến trúc không đổi.                                                                                                                                                            |
| **MoMo đang tắt**                                    | Đã cấu hình, chỉ bật khi có cách đối chiếu tự động.                                                                                                                                                                     |
| **Redis 7.4+ không còn giấy phép OSI**               | Nếu cần câu "toàn bộ mã nguồn mở" tuyệt đối chuẩn thì ghim `redis:7.2-alpine` hoặc đổi sang Valkey.                                                                                                                     |
| **Cube đang chạy `CUBEJS_DEV_MODE=true`**            | Đúng cho môi trường phát triển; production phải tắt.                                                                                                                                                                    |

---

## 7. Hai mươi câu hay bị hỏi

1. **Khác gì Power BI/Tableau?** Chạy trên trình duyệt, không tính phí theo đầu
   người, tự vận hành trên một máy chủ, dữ liệu không rời khỏi doanh nghiệp.
   Đổi lại: ít loại biểu đồ hơn, chưa có tính năng cộng tác nâng cao.
2. **Vì sao cần ClickHouse, MySQL không đủ à?** MySQL lưu theo dòng: tổng hợp
   trên hàng triệu dòng phải đọc cả dòng. ClickHouse lưu theo cột, chỉ đọc đúng
   cột cần. Và `EXCHANGE TABLES` cho phép tráo bảng nguyên tử.
3. **Vì sao cần Cube, sao không tự sinh SQL?** Vì lỗi đếm trùng khi nối bảng —
   xem 4.6. Cube cũng cho phép khai một lần, dùng lại ở mọi câu hỏi.
4. **Cube có lưu dữ liệu không?** Không. Nó chỉ dịch câu hỏi thành SQL và chạy
   trên ClickHouse.
5. **Dữ liệu các công ty tách nhau thế nào?** Ba lớp: `WHERE tenant_id` trong
   mọi truy vấn, bảng kho riêng theo tổ chức (`raw_t{tenant}_d{dataset}`), và
   `securityContext` trong JWT gửi sang Cube.
6. **Tệp 50 MB có làm sập máy chủ không?** Không đi qua máy chủ ứng dụng — trình
   duyệt PUT thẳng lên MinIO bằng vé ký sẵn.
7. **Sao biết tệp là Excel thật?** Đọc **byte đầu tệp**, không tin phần mở rộng.
8. **Người dùng đổi tên bộ dữ liệu thì bảng trong kho có đổi không?** Không —
   tên bảng sinh từ số nguyên, đổi tên không đụng tới kho.
9. **Đang xem báo cáo mà có người nạp lại dữ liệu thì sao?** Không thấy gì bất
   thường: bảng mới dựng bên cạnh rồi tráo nguyên tử.
10. **Một ô dữ liệu sai kiểu thì mất cả lần nạp?** Không — ghi rỗng, ghi nhật ký
    lỗi, đi tiếp. Người dùng xem được danh sách lỗi.
11. **Vì sao phân quyền bằng Casbin?** Ma trận quyền nằm trong dữ liệu, không
    nằm trong mã. Thêm vai trò = thêm dòng.
12. **Superadmin có đọc được dữ liệu của mọi tổ chức không?** Không, trừ khi
    được cấp membership thật. Đây là quyết định cố ý.
13. **Mật khẩu CSDL của khách lưu thế nào?** AES-256-GCM (mã hoá hai chiều, vì
    phải dùng lại), khoá trong biến môi trường, không có giá trị mặc định.
14. **SSRF là gì và chặn thế nào?** Kiểm IP sau khi phân giải tên miền, rồi kết
    nối bằng chính IP đã kiểm.
15. **Vì sao QR tự dựng mà không gọi dịch vụ sẵn có?** Không gửi số tài khoản và
    mã đơn của khách sang bên thứ ba; trang thanh toán không chết theo dịch vụ
    ngoài.
16. **Hai người chuyển khoản cùng lúc, hoặc webhook gọi hai lần?** Hai ràng buộc
    UNIQUE ở tầng CSDL chặn trùng — không dựa vào mã lệnh.
17. **Khách chuyển thiếu tiền?** Không bật gói; đơn sang trạng thái chờ đối
    chiếu; người vận hành xử lý trong khu quản trị.
18. **Hệ thống chịu được bao nhiêu dữ liệu?** Đã đo: CSV 500.000 dòng phân tích
    trong 1,1 giây; nạp 388.000 dòng/giây, bộ nhớ đỉnh 245 MB và phẳng.
19. **Test thế nào?** 15 tệp kiểm thử tích hợp chạy trên MySQL và ClickHouse
    thật (không phải mock), cộng test giao diện bằng Vitest + Testing Library.
20. **Còn thiếu gì và làm tiếp thế nào?** Xem mục 6 — nói đúng ba việc gần nhất:
    đóng gói ứng dụng bằng Docker, bật MoMo khi có đối chiếu, xuất CSV và chia
    sẻ báo cáo bằng link.

---

## 8. Nếu chỉ kịp nhớ năm điều

1. **Hai cửa vào, một đường nạp, tráo bảng nguyên tử** — báo cáo không bao giờ
   thấy bảng rỗng.
2. **Cube là tầng ngữ nghĩa, không phải kho** — nó chặn lỗi đếm trùng khi nối
   bảng.
3. **Phân quyền hai trục** — hệ thống (`superadmin`) và tổ chức
   (`admin`/`creator`/`viewer`); Casbin trả lời "được làm gì", `WHERE tenant_id`
   trả lời "của ai".
4. **Tệp không đi qua máy chủ ứng dụng** — vé ký sẵn 15 phút lên MinIO.
5. **Hạn mức dung lượng đo chỗ thật trong kho**, không đo kích thước tệp.
