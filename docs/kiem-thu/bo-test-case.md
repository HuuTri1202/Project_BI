# Bộ test case kiểm thử tay — Open Insight

Bộ này để **một người ngồi trước trình duyệt** bấm hết từ đầu tới cuối. Không
cần cài gì thêm, không cần đọc mã nguồn.

Mỗi ca có ba phần: **các bước**, **kết quả mong đợi**, và một ô trống để ghi
**kết quả thực tế**. Kết quả mong đợi là con số và câu chữ cụ thể — không có ca
nào ghi "hiển thị đúng", vì một câu như thế thì ai đọc cũng tự diễn giải một
kiểu rồi đánh dấu Đạt.

Mọi con số trong tài liệu được tính bằng máy trên chính các tệp trong
`du-lieu-thu/` (xem `§0.4`), nên **màn hình cho số khác là lỗi thật**, không
phải tôi ghi sai.

| Mức | Nghĩa |
|---|---|
| ⭐ | **Bắt buộc đạt** trước khi demo hoặc nộp. Hỏng là hỏng thứ người xem sẽ bấm vào. |
| ◻ | Nên kiểm. Hỏng thì ghi lại, không chặn demo. |

## Mục lục

| § | Phần | Số ca | ⭐ |
|---|---|---|---|
| §1 | Xác thực và tài khoản | 13 | 6 |
| §2 | Phân quyền và cách ly tổ chức | 8 | 5 |
| §3 | Tải tệp lên và đọc dữ liệu | 13 | 7 |
| §4 | Kho dữ liệu và cập nhật dữ liệu | 10 | 5 |
| §5 | Kết nối cơ sở dữ liệu | 6 | 2 |
| §6 | Nạp vào kho phân tích | 5 | 3 |
| §7 | Mô hình dữ liệu và Khám phá | 12 | 5 |
| §8 | Trình dựng báo cáo | 18 | 12 |
| §9 | Xem, chia sẻ, xuất tệp | 10 | 6 |
| §10 | Trợ lý dữ liệu | 17 | 12 |
| §11 | Thanh toán và hạn mức | 9 | 5 |
| §12 | Quản lý tổ chức | 9 | 5 |
| §13 | Console vận hành hệ thống | 8 | 4 |
| §14 | Điện thoại và ca biên | 10 | 5 |
| | **Tổng** | **148** | **82** |

Chạy hết cả bộ mất khoảng 5–7 giờ. Chỉ chạy 82 ca ⭐ thì khoảng 2,5 giờ, và đó
là bộ tối thiểu tôi khuyên chạy lại sau mỗi lần sửa mã.

---

## §0 · Chuẩn bị

### §0.1 Dựng hạ tầng và chạy server

```bash
npm run infra:up:all     # 5 container: MySQL, Redis, MinIO, ClickHouse, Cube
npm run infra:ps         # cả 5 phải "healthy" — chờ tới khi healthy mới chạy bước sau
npm run dev              # backend :4000 + frontend :5173
```

Mở `http://localhost:5173`. Nếu trang trắng hoặc xoay mãi, xem log của
`npm run dev` trước khi kết luận lỗi sản phẩm.

> **Cube cần thời gian.** Lần đầu mở một mô hình dữ liệu sau khi khởi động,
> container Cube phải đọc lại thư mục schema. Một ô biểu đồ xoay 5–10 giây ở lần
> đầu là bình thường; xoay mãi không dứt thì mới là lỗi.

### §0.2 Tài khoản

| Dùng cho | Email | Mật khẩu |
|---|---|---|
| **Sân kiểm thử chính** — admin của *Công ty Ánh Dương* | `mai@anhduong.vn` | `Matkhau@123` |
| Người xem — kiểm ẩn nút hành động | `viewer@bi-platform.local` | `Matkhau@123` |
| Thuộc nhiều tổ chức — kiểm bộ chuyển tổ chức | `hanh@saomai.vn` | `Matkhau@123` |
| Người xem của Sao Mai | `nam@saomai.vn` | `Matkhau@123` |
| **Console vận hành** `/admin` — superadmin | `admin@bi-platform.local` | `Admin@12345` |

Tài khoản `dang@gmail.com` (tổ chức NASA) là tài khoản thật của bạn, mật khẩu
không nằm trong tài liệu này. Bộ test **không dùng tới nó** — NASA còn 142 bộ dữ
liệu và 30 báo cáo thật, đừng lấy nó làm sân thử.

### §0.3 Trạng thái xuất phát — đọc kỹ ba dòng này

Kiểm vào **ngày 20/11/2026**, ngay sau một lượt dọn dữ liệu test. Ba điều kiện
dưới đây quyết định thứ tự chạy:

1. **Công ty Ánh Dương đang RỖNG** — 0 bộ dữ liệu, 0 mô hình, 0 báo cáo, 1
   workspace. Đó là lý do nó làm sân kiểm thử: mọi con số bạn thấy đều do bộ test
   này tạo ra.
2. **Ánh Dương đang ở gói Miễn phí**: tối đa **1 workspace · 3 báo cáo · 3 thành
   viên · 100 MB**. Vì vậy §8 cố ý chỉ lưu **2** báo cáo, còn ca `TT-04` tạo báo
   cáo thứ tư để kiểm chốt hạn mức. Đừng lưu thêm báo cáo ngoài kịch bản, không
   thì ca đó mất ý nghĩa.
3. **§12 phải chạy SAU §11.** Tạo workspace thứ hai vượt hạn mức gói Miễn phí,
   nên ca `TC-01` cần gói đã được nâng ở `TT-07`.

### §0.4 Tệp dữ liệu và đáp án đã tính sẵn

Mọi tệp nằm trong `docs/kiem-thu/du-lieu-thu/`. UTF-8, không BOM.

| Tệp | Hình dạng | Dùng ở |
|---|---|---|
| `ban-hang-thang-10.csv` | 85 dòng · 8 cột | §3, §6, §7, §8, §9, §10 |
| `ban-hang-thang-11.csv` | 45 dòng · 8 cột, cùng cột với tệp trên | §4 — cập nhật dữ liệu |
| `ban-hang-thang-11-thieu-cot.csv` | 45 dòng · 6 cột, **thiếu** `Chi nhánh` và `Thành tiền` | §4 — ca từ chối |
| `bao-cao-doanh-thu.xlsx` | 2 sheet, có dòng tên báo cáo ở trên | §3 — dò hàng tiêu đề |
| `hoa-hong-kieu-viet.csv` | 6 dòng, cột tiền viết `750.000` | §3 — quy ước số Việt |
| `loi-nhuan-so-am.csv` | 5 dòng, số âm và thập phân | §3 — số mơ hồ |
| `khong-hop-le.txt` | tệp văn bản thường | §3 — từ chối định dạng |

**Đáp án của `ban-hang-thang-10.csv`** — tính bằng máy trên chính tệp đó:

| Phép | Giá trị |
|---|---|
| Số dòng · số cột | 85 · 8 |
| `Tổng` của `Thành tiền` | **33.687.000** |
| `Tổng` của `Số lượng` | **1.068** |
| `Trung bình` của `Thành tiền` | **396.318** |
| `Nhỏ nhất` / `Lớn nhất` của `Thành tiền` | 35.000 / 1.080.000 |
| `Đếm giá trị khác nhau` của `Mã đơn` | 85 |
| Số ngày khác nhau | 26 (01/10/2026 → 31/10/2026) |

`Thành tiền` theo `Chi nhánh`:

| Chi nhánh | Thành tiền | Số lượng |
|---|---|---|
| Gò Vấp | 10.833.000 | 340 |
| Thủ Đức | 8.610.000 | 257 |
| Quận 1 | 8.025.000 | 259 |
| Quận 7 | 6.219.000 | 212 |

> Hai cột cuối **xếp hạng khác nhau**: theo tiền thì Thủ Đức đứng nhì, theo số
> lượng thì Quận 1. Ca `BC-06` dùng đúng chỗ lệch này.

`Thành tiền` theo `Nhóm hàng`: Bánh **12.635.000** · Trà **10.830.000** · Cà phê
**10.222.000**.

`Thành tiền` theo `Sản phẩm`: Bánh bông lan **9.415.000** · Trà sữa trân châu
**5.655.000** · Cà phê sữa **5.597.000** · Trà đào cam sả **5.175.000** · Cà phê
đen **4.625.000** · Bánh mì que **3.220.000**.

`Thành tiền` theo `Ngày bán` — những mốc bộ test dùng tới:

| Mốc | Giá trị |
|---|---|
| Ngày đầu tiên 01/10/2026 | 2.088.000 |
| Ngày cuối cùng 31/10/2026 | 609.000 |
| Ba ngày cao nhất | 26/10 = 3.305.000 · 13/10 = 2.120.000 · 09/10 = 2.118.000 |
| Ngày thứ 20 theo thứ tự thời gian | 23/10/2026 |
| Ngày thứ 21 (đầu trang 2) | 24/10/2026 |
| Số ngày ở trang 2 | 6 |

**Đáp án của `ban-hang-thang-11.csv`**: 45 dòng · `Tổng` của `Thành tiền` =
**22.607.000** · `Số lượng` = **634**. Theo chi nhánh: Quận 1 **8.519.000** ·
Quận 7 **6.391.000** · Gò Vấp **4.174.000** · Thủ Đức **3.523.000**.

**Đáp án của `bao-cao-doanh-thu.xlsx`**: sheet `Thang 10` có 24 dòng dữ liệu, 8
cột, `Tổng` của `Thành tiền` = **9.369.000**. Sheet `Tong hop` có 5 dòng, trong
đó dòng cuối là `TỔNG CỘNG`.

**Đáp án của `hoa-hong-kieu-viet.csv`**: đọc kiểu Việt (dấu chấm là phân cách
nghìn) → `Tổng` = **2.659.000**. Đọc kiểu thập phân → **2.659**. Lệch đúng 1000
lần, nên không thể nhìn nhầm.

### §0.5 Cách ghi kết quả

Điền trực tiếp vào bảng hai cột dưới mỗi ca. Khi **Không đạt**, ghi đủ ba thứ —
thiếu một thứ là ca đó không sửa lại được:

1. Bạn thấy gì (số nào, câu nào, chụp màn hình nếu lệch bố cục).
2. Bạn đã bấm đúng những bước nào tới lúc đó.
3. Có gì trong log `npm run dev` ngay lúc đó không.

---

## §1 · Xác thực và tài khoản

### XT-01 ⭐ · Đăng nhập đúng

*Hỏng ca này thì không kiểm được ca nào khác.*

- **Tài khoản:** `mai@anhduong.vn` / `Matkhau@123`

**Các bước**

1. Mở `http://localhost:5173`.
2. Nhập email và mật khẩu, bấm nút đăng nhập.

**Kết quả mong đợi**

- Vào thẳng Trang chủ, địa chỉ là `/home`, **không** nhảy sang `/admin`.
- Sidebar có đủ: Trang chủ · Kho dữ liệu · Mô hình dữ liệu · Báo cáo · Quản lý tổ chức.
- Chân sidebar hiện tên **Lê Thị Mai** và tổ chức **Công ty Ánh Dương**.
- Trang chủ nói tổ chức chưa có dữ liệu (0 bộ dữ liệu, 0 báo cáo) — đúng với §0.3.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XT-02 ⭐ · Sai mật khẩu và email không tồn tại phải báo giống hệt nhau

*Hai câu khác nhau là một lỗ dò: kẻ tấn công biết được email nào đã đăng ký.*

**Các bước**

1. Đăng xuất. Nhập `mai@anhduong.vn` với mật khẩu `SaiBet@999` → ghi lại nguyên văn câu lỗi.
2. Nhập `khongtontai@vidu.vn` với cùng mật khẩu sai → ghi lại nguyên văn câu lỗi.

**Kết quả mong đợi**

- Hai câu **giống nhau từng chữ**.
- Không có câu nào kiểu "email này chưa đăng ký" hay "tài khoản không tồn tại".
- Thời gian trả lời của hai lần xấp xỉ nhau (không phải một lần tức thì, một lần chờ lâu).

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XT-03 ⭐ · Chặn dò mật khẩu

*Sai liên tục thì phải bị khoá tạm — và đăng nhập ĐÚNG không được tính vào quota.*

**Các bước**

1. Nhập `mai@anhduong.vn` với mật khẩu sai, bấm đăng nhập **11 lần liên tiếp**.
2. Ghi lại câu lỗi ở lần bị chặn.
3. Ngay sau đó, nhập mật khẩu **đúng** → ghi lại điều xảy ra.

**Kết quả mong đợi**

- Tới khoảng lần thứ 10–11 câu lỗi đổi thành thông báo bị chặn tạm, có nói tới thời gian chờ (~15 phút).
- Lần nhập đúng ở bước 3 **vẫn bị chặn** (bộ đếm theo IP, chưa hết hạn).
- Sau khi chờ hết hạn (hoặc khởi động lại Redis) thì đăng nhập đúng vào được bình thường.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XT-04 ◻ · Luật mật khẩu khi đăng ký

**Các bước**

1. Mở `/register`. Thử lần lượt các mật khẩu: `123456`, `matkhau123`, `Matkhauxx`.
2. Rồi thử `Matkhau@123`.

**Kết quả mong đợi**

- Ba mật khẩu đầu bị từ chối, và câu báo nói **thiếu gì** — lần lượt: quá ngắn, thiếu chữ hoa, thiếu chữ số — chứ không chỉ "mật khẩu không hợp lệ".
- Mật khẩu cuối được nhận. Hệ thống **không** đòi ký tự đặc biệt, nên `Matkhau123` cũng phải được nhận.
- Nút gửi bị khoá trong lúc đang xử lý, không bấm được hai lần.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XT-05 ⭐ · Đăng ký mới phải xác minh email mới vào được

*Đây là chỗ dễ tưởng là lỗi nhất khi demo: đăng ký xong, đăng nhập lại, bị chặn.*

**Các bước**

1. Mở `/register`. Đếm số ô trên form.
2. Điền đúng bốn ô bắt buộc — họ tên `Thử Nghiệm Một`, email
   `thu-nghiem-01@vidu.vn`, mật khẩu `Matkhau@123` (hai lần) — **để trống ô tên
   công ty** rồi bấm Đăng ký.
3. Thử đăng nhập ngay bằng tài khoản đó.
4. Mở log của `npm run dev`, tìm lá thư xác minh được in ra, copy liên kết dạng
   `http://localhost:5173/xac-minh-email?token=…` và dán vào trình duyệt.
5. Đăng nhập lại.

**Kết quả mong đợi**

- Bước 1: form có **năm ô**, trong đó ô *Tên công ty* ghi rõ "(không bắt buộc)".
  Không có ô số điện thoại và không có ô chức danh — hai thứ đó nay sửa ở trang
  Hồ sơ (`XT-10`).
- Bước 2: nút Đăng ký **bật sáng** dù ô tên công ty còn trống, và câu "Còn
  thiếu: …" dưới nút **không** nhắc tên công ty.
- Bước 3 **bị từ chối** vì email chưa xác minh, và hộp lỗi có nút gửi lại thư.
- Bước 4 cho một trang nói đã xác minh xong.
- Bước 5 vào được, và tài khoản mới có **một tổ chức riêng** tên đúng dạng
  "Không gian của Thử Nghiệm Một". Đổi tên được ở trang Tổ chức (`TC-09`).
- Làm lại từ bước 2 với email khác và **có** điền tên công ty: tổ chức mang đúng
  tên công ty vừa khai, không phải "Không gian của …".

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XT-06 ◻ · Gửi lại thư xác minh

**Các bước**

1. Đăng ký `thu-nghiem-02@vidu.vn`, **không** mở liên kết trong log.
2. Thử đăng nhập, rồi bấm nút gửi lại thư xác minh trong hộp lỗi.
3. Xem log lần nữa.

**Kết quả mong đợi**

- Có một lá thư **mới** trong log, token khác lần đầu.
- Token cũ dùng được hoặc báo đã hết hiệu lực — cả hai đều chấp nhận, nhưng phải nói rõ, không trắng trang.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XT-07 ⭐ · Quên mật khẩu và đặt lại

**Các bước**

1. Ở `/login` bấm liên kết quên mật khẩu. Nhập `nam@saomai.vn`.
2. Nhập tiếp một email **không tồn tại** `khongco@vidu.vn`.
3. Lấy liên kết đặt lại từ log, mở, đặt mật khẩu mới `Matkhau@456`.
4. Đăng nhập bằng mật khẩu mới. Rồi thử lại mật khẩu cũ `Matkhau@123`.
5. Mở lại liên kết đặt lại ở bước 3 một lần nữa.

**Kết quả mong đợi**

- Bước 1 và bước 2 cho **cùng một câu trả lời** (không tiết lộ email nào có thật).
- Bước 4: mật khẩu mới vào được, mật khẩu cũ bị từ chối.
- Bước 5: liên kết đã dùng rồi thì **không dùng lại được**, và trang nói rõ vì sao.

> Sau ca này, mật khẩu của `nam@saomai.vn` là `Matkhau@456`. Ghi lại hoặc đổi về.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XT-08 ◻ · Đổi mật khẩu khi đang đăng nhập

**Các bước**

1. Đăng nhập `mai@anhduong.vn`, vào `/change-password`.
2. Nhập mật khẩu hiện tại **sai** → ghi câu lỗi.
3. Nhập đúng, mật khẩu mới `Matkhau@789`, xác nhận.
4. Đổi lại về `Matkhau@123`.

**Kết quả mong đợi**

- Bước 2 bị từ chối, và câu lỗi nói về mật khẩu hiện tại chứ không chung chung.
- Bước 3 thành công; sau đó đăng xuất rồi đăng nhập bằng mật khẩu mới được.
- Bước 4 trả trạng thái về như cũ (các ca sau còn dùng `Matkhau@123`).

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XT-09 ⭐ · Ghi nhớ đăng nhập qua một lần đóng trình duyệt

**Các bước**

1. Đăng xuất. Đăng nhập `mai@anhduong.vn` **có** tích ghi nhớ.
2. Đóng **hẳn** trình duyệt (không chỉ đóng tab), mở lại, vào `http://localhost:5173`.
3. Đăng xuất. Đăng nhập lại **không** tích ghi nhớ.
4. Đóng hẳn trình duyệt, mở lại.

**Kết quả mong đợi**

- Bước 2: vẫn còn đăng nhập, vào thẳng `/home`.
- Bước 4: **đã đăng xuất**, về `/login`.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XT-10 ◻ · Trang cá nhân

*Nay là nơi DUY NHẤT điền số điện thoại và chức danh — hai ô đã rời form đăng ký.*

**Các bước**

1. Vào `/profile`. Đổi họ tên thành `Lê Thị Mai (KT)`, lưu.
2. Xem chân sidebar. Bấm F5.
3. Điền số điện thoại `0901234567` và chọn một chức danh, lưu. Bấm F5.
4. Xoá trống lại cả hai ô đó, lưu. Bấm F5.
5. Đổi lại tên cũ `Lê Thị Mai`.

**Kết quả mong đợi**

- Tên ở chân sidebar đổi theo **ngay**, không cần F5.
- Sau F5 tên mới vẫn còn.
- Bước 3: lưu được, và sau F5 số điện thoại hiện lại dạng `+84901234567`.
- Bước 4: **xoá trống được** — không có câu "Số điện thoại không hợp lệ" cho một
  ô cố ý để rỗng. Đây là ca đáng kiểm vì tài khoản mới nào cũng có hai ô này
  trống từ đầu.
- Email là ô chỉ đọc hoặc có cảnh báo riêng — không đổi lặng lẽ được.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XT-11 ◻ · Đăng xuất dọn sạch phiên

**Các bước**

1. Đang đăng nhập, mở `/datasets`. Bấm đăng xuất.
2. Bấm nút Back của trình duyệt.
3. Gõ thẳng `http://localhost:5173/datasets` vào thanh địa chỉ.

**Kết quả mong đợi**

- Bước 2 và bước 3 đều về `/login`, **không** thấy lại dữ liệu cũ dù chỉ một nhịp.
- Không có lỗi đỏ nào trong Console của trình duyệt.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XT-12 ◻ · Nút Google có ở CẢ hai trang

*Phần nhìn thấy được thì kiểm ở đây; phần bấm thật thì phụ thuộc môi trường.*

**Các bước**

1. Mở `/login`, xem nút Google dưới form.
2. Mở `/register`, xem nút Google dưới form.
3. Bấm nút ở một trong hai trang.

**Kết quả mong đợi**

- Bước 1: nút ghi **"Đăng nhập bằng Google"**.
- Bước 2: nút ghi **"Đăng ký bằng Google"** — hai trang không được dùng chung
  một nhãn. Đây là ca chính của bản vá: trước đây trang đăng ký **không có** nút
  nào, nên ai bấm Google ở trang đăng nhập bằng email chưa có tài khoản sẽ nhận
  "Vui lòng đăng ký trước" rồi gặp một form đòi tên công ty, số điện thoại và
  chức danh — những thứ Google không biết.
- Bước 3 trên `localhost:5173`: Google trả lỗi `The given origin is not allowed
  for the given client ID` — **đúng như dự kiến**, origin này chưa được khai
  trong Google Cloud Console. Đây không phải lỗi mã.
- Quan trọng: trang **không trắng, không treo**, và đăng nhập bằng mật khẩu vẫn
  dùng được ngay sau đó.
- **Chưa kiểm được trên máy này:** việc một email Google chưa có tài khoản sẽ
  được *tạo* tài khoản (kèm không gian riêng, email coi như đã xác minh vì Google
  vừa xác nhận) cần một origin đã khai trong Google Cloud Console. Nhánh tạo tài
  khoản đã được kiểm riêng ở tầng dịch vụ; nhánh bấm nút thì phải chờ môi
  trường.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XT-13 ◻ · Câu báo lỗi nhập liệu phải bằng tiếng Việt

**Các bước**

1. Mở DevTools → Console, chạy:
   ```js
   await fetch('/api/auth/register', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: '{}',
   }).then((r) => r.json());
   ```
2. Chạy tiếp:
   ```js
   await fetch('/api/v1/report-folders', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: '{}',
   }).then((r) => r.json());
   ```

**Kết quả mong đợi**

- Cả hai trả **400**, và **mọi câu trong `fields` đều là tiếng Việt**: "Thiếu
  thông tin này.", "Cần một số hợp lệ.".
- KHÔNG còn câu nào kiểu `Required`, `Expected number, received nan`,
  `Invalid enum value. Expected 'admin' | 'creator' | 'viewer'` — đo được
  24/11/2026: mười một câu tiếng Anh trong mười hai lần thử.
- Câu chữ viết tay vẫn thắng bản dịch chung: `/v1/workspaces` với `name: ""` vẫn
  trả **"Tên công ty phải có ít nhất 2 ký tự"**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

---

## §2 · Phân quyền và cách ly tổ chức

### PQ-01 ⭐ · Người xem không thấy nút hành động

- **Tài khoản:** `viewer@bi-platform.local` / `Matkhau@123` (vai trò *viewer* của Open Insight)

**Các bước**

1. Đăng nhập, đi qua: Trang chủ → Kho dữ liệu → Mô hình dữ liệu → Báo cáo.
2. Mở chi tiết một bộ dữ liệu và một báo cáo có sẵn.

**Kết quả mong đợi**

- Không có nút tạo / sửa / xoá / tải tệp lên ở bất kỳ trang nào trong bốn trang trên.
- Vẫn **xem** được dữ liệu và báo cáo bình thường.
- Không có nút nào hiện ra rồi mới báo lỗi khi bấm — đã ẩn thì ẩn hẳn.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### PQ-02 ⭐ · Quản trị tổ chức không vào được console hệ thống

**Các bước**

1. Đăng nhập `mai@anhduong.vn` (admin của *tổ chức*, không phải superadmin).
2. Gõ thẳng `http://localhost:5173/admin` vào thanh địa chỉ.
3. Thử tiếp `/system-health`.

**Kết quả mong đợi**

- Cả hai cho trang `403` (hoặc chuyển về `/home`), **không** thấy một dòng dữ liệu nào của tổ chức khác.
- Sidebar của tài khoản này không có mục nào dẫn tới console.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### PQ-03 ⭐ · Không đọc được dữ liệu của tổ chức khác dù gõ thẳng địa chỉ

*Ca an toàn quan trọng nhất của cả bộ.*

**Các bước**

1. Đăng nhập `admin@bi-platform.local`, vào Kho dữ liệu của Open Insight, mở một
   bộ dữ liệu, **ghi lại số id** trên thanh địa chỉ (`/datasets/<id>`).
2. Đăng xuất. Đăng nhập `mai@anhduong.vn` (Ánh Dương).
3. Gõ thẳng `/datasets/<id>` của bước 1.
4. Làm lại điều tương tự với một báo cáo: `/reports/<id>`.

**Kết quả mong đợi**

- Cả hai lần: không tìm thấy hoặc không có quyền. **Không** hiện tên, cột, hay một con số nào của bộ dữ liệu đó.
- Câu báo không tiết lộ rằng id đó có tồn tại ở tổ chức khác.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### PQ-04 ⭐ · Bộ chuyển tổ chức đổi cả quyền

- **Tài khoản:** `hanh@saomai.vn` — admin ở *Công ty Sao Mai*, người xem ở *Open Insight*

**Các bước**

1. Đăng nhập. Xem đang ở tổ chức nào, ghi lại các nút hành động đang có.
2. Dùng bộ chuyển tổ chức trên sidebar, sang tổ chức còn lại.
3. So lại danh sách nút hành động.

**Kết quả mong đợi**

- Ở *Sao Mai* (admin): có nút tạo bộ dữ liệu, tạo báo cáo, quản lý tổ chức.
- Ở *Open Insight* (viewer): các nút đó **biến mất**, dữ liệu hiện ra là của Open Insight.
- Không phải F5 mới thấy đổi.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### PQ-05 ⭐ · Không gian cá nhân bị ẩn khỏi danh sách tổ chức

**Các bước**

1. Đăng nhập `admin@bi-platform.local`, vào `/admin` → tab tổ chức.
2. Tìm các tổ chức tên "Không gian của …".

**Kết quả mong đợi**

- Danh sách tổ chức của console **không** liệt kê không gian cá nhân — chúng là chỗ riêng của từng người, không phải khách hàng.
- Tổng số tổ chức hiện ra khớp với số tổ chức "thật".

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### PQ-06 ◻ · Trang 403 và trang không tồn tại

**Các bước**

1. Đang đăng nhập, gõ `/403`.
2. Gõ `/mot-duong-dan-khong-ton-tai`.
3. Gõ `/datasets/999999`.

**Kết quả mong đợi**

- Ba trang đều có **nội dung tiếng Việt** và một lối về (nút hoặc liên kết), không phải trang trắng hay chữ "Not Found" trần.
- Sidebar vẫn còn, vẫn bấm đi nơi khác được.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### PQ-07 ◻ · Người xem bị chặn ở tầng máy chủ, không chỉ ở giao diện

*Ẩn nút chỉ là lớp ngoài; luật thật phải nằm ở máy chủ.*

**Các bước**

1. Đăng nhập `viewer@bi-platform.local`.
2. Mở DevTools → Console, chạy:
   ```js
   await fetch('/api/v1/reports', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'})
     .then(r => r.status)
   ```

**Kết quả mong đợi**

- Trả về **403** (hoặc 401), không phải 200 hay 500.
- Không có báo cáo nào được tạo: F5 lại trang Báo cáo, số lượng không đổi.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### PQ-08 ◻ · Hết phiên thì đưa về đăng nhập, không treo

**Các bước**

1. Đăng nhập, mở `/datasets`.
2. DevTools → Application → xoá token trong Local Storage / Session Storage.
3. Bấm sang một trang khác trong sidebar.

**Kết quả mong đợi**

- Bị đưa về `/login`, không có vòng xoay vô tận và không có hộp lỗi kỹ thuật.
- Sau khi đăng nhập lại, về đúng trang đang muốn vào (hoặc `/home` — cả hai đều chấp nhận).

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

---

## §3 · Tải tệp lên và đọc dữ liệu

Cả phần này đăng nhập bằng `mai@anhduong.vn`, tổ chức **Công ty Ánh Dương**.

Trình hướng dẫn có ba bước, thanh bước ở đầu ghi: **Tải file lên** → **Chọn dữ
liệu** → **Tạo bộ dữ liệu**.

### TF-01 ⭐ · Tải tệp bán hàng lên, ba bước, 85 dòng

*Luồng xương sống. Mọi phần sau đều dựa vào bộ dữ liệu tạo ra ở đây.*

- **Tệp:** `du-lieu-thu/ban-hang-thang-10.csv`

**Các bước**

1. Kho dữ liệu → bấm tạo bộ dữ liệu → chọn tệp trên.
2. Chờ bước **Chọn dữ liệu** hiện ra. Đọc kỹ phần tóm tắt cột.
3. Bấm tiếp sang **Tạo bộ dữ liệu**, giữ tên mặc định, xác nhận.

**Kết quả mong đợi**

- Bước 2 ghi **8 cột** và **85 dòng**.
- Kiểu cột suy ra đúng: `Mã đơn` chữ · `Ngày bán` **ngày** · `Chi nhánh`,
  `Nhóm hàng`, `Sản phẩm` chữ · `Số lượng`, `Đơn giá`, `Thành tiền` **số**.
- Bảng xem trước hiện dòng đầu đúng như trong tệp: `DH0001 · 2026-10-01 · Gò Vấp
  · Bánh · Bánh bông lan · 21 · 35000 · 735000`.
- Sau bước 3 về `/datasets`, bộ dữ liệu `ban-hang-thang-10` có trong danh sách.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TF-02 ⭐ · Từ chối tệp sai định dạng ngay tại chỗ

- **Tệp:** `du-lieu-thu/khong-hop-le.txt`

**Các bước**

1. Mở trình hướng dẫn, chọn tệp `.txt` trên.

**Kết quả mong đợi**

- Bị từ chối **ngay**, không tải lên, không sang bước 2.
- Câu báo nói rõ chỉ nhận `.csv` và `.xlsx`.
- Trình hướng dẫn vẫn mở, chọn lại tệp khác được ngay mà không phải tải lại trang.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TF-03 ◻ · Chặn tệp quá 50 MB

**Các bước**

1. Sinh một tệp ~54 MB vào thư mục tạm của máy (không để trong repo):
   ```bash
   node -e "const fs=require('fs');const d='DH0001,2026-10-01,Quan 1,Banh,Banh mi que,5,20000,100000\n';fs.writeFileSync(require('os').tmpdir()+'/qua-lon.csv','Ma don,Ngay ban,Chi nhanh,Nhom hang,San pham,So luong,Don gia,Thanh tien\n'+d.repeat(900000))"
   ```
2. Thử tải tệp đó lên.
3. Xoá tệp sau khi kiểm.

**Kết quả mong đợi**

- Bị từ chối **trước khi** tải lên (không có thanh tiến trình chạy tới 100% rồi mới báo lỗi).
- Câu báo có nhắc con số giới hạn **50 MB**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TF-04 ⭐ · Tệp Excel có dòng tên báo cáo ở trên vẫn đọc đúng 8 cột

*Tệp người Việt xuất ra hầu như luôn có một dòng tiêu đề báo cáo. Bản cũ đọc
thành **1 cột · 7 dòng** mà không báo lỗi gì.*

- **Tệp:** `du-lieu-thu/bao-cao-doanh-thu.xlsx`

**Các bước**

1. Mở tệp bằng Excel một lượt để thấy hình dạng: dòng 1 là
   `BÁO CÁO DOANH THU THÁNG 10/2026 — Quán Cà Phê Mẫu`, dòng 2 trống, dòng 3 mới là tiêu đề cột.
2. Tải tệp đó lên. Ở bước **Chọn dữ liệu**, chọn **chỉ** sheet `Thang 10`.

**Kết quả mong đợi**

- Ghi **8 cột**, **24 dòng** — không phải 1 cột, không phải 25 dòng.
- Có một câu nói đã **bỏ 1 dòng** ở đầu sheet.
- Tên cột là `Mã đơn … Thành tiền`, **không** phải cả câu tiêu đề báo cáo.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TF-05 ⭐ · Chọn hai sheet thì ra hai bộ dữ liệu

- **Tệp:** `du-lieu-thu/bao-cao-doanh-thu.xlsx`

**Các bước**

1. Tải tệp lên lần nữa. Ở bước 2, tích **cả hai** sheet `Thang 10` và `Tong hop`.
2. Hoàn tất, về Kho dữ liệu.

**Kết quả mong đợi**

- Có **hai** bộ dữ liệu mới, tên gắn với tên sheet, mỗi bộ có số cột riêng (8 và 2).
- Bộ từ `Tong hop` có **5 dòng**.

> **Giới hạn đã biết, không tính là lỗi:** dòng `TỔNG CỘNG` trong sheet `Tong hop`
> được nạp **như một dòng dữ liệu**. Nên `Tổng` của cột `Thành tiền` ở bộ đó ra
> **18.738.000**, đúng gấp đôi con số thật **9.369.000**. Hệ thống cố ý không tự
> đoán và bỏ dòng tổng — bỏ nhầm một dòng dữ liệu thật tệ hơn là giữ một dòng mà
> người dùng nhìn thấy trong bảng xem trước.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TF-06 ⭐ · Cột tiền kiểu Việt được tích sẵn

*`750.000` là bảy trăm năm mươi nghìn hay bảy trăm năm mươi phẩy không không
không? Hệ thống phải đoán sẵn câu trả lời đúng.*

- **Tệp:** `du-lieu-thu/hoa-hong-kieu-viet.csv`

**Các bước**

1. Tải tệp lên. Ở bước **Chọn dữ liệu**, tìm cảnh báo của cột `Hoa hồng`.

**Kết quả mong đợi**

- Có một ô tích với câu: *Trong cột này, dấu chấm là **phân cách nghìn** — đọc
  "750.000" thành 750000*.
- Ô tích **đã được tích sẵn** (không phải tự đi tìm rồi tích).
- Câu bên trên nói ô `"750.000"` sẽ vào hệ thống thành `750000` theo lựa chọn của bạn.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TF-07 ⭐ · Bỏ tích thì cách đọc đổi thật

*Chứng minh ô tích không phải trang trí.*

**Các bước**

1. Vẫn ở bước 2 của ca trên, **bỏ tích** ô đó. Đọc lại câu cảnh báo.
2. Tích lại, hoàn tất tạo bộ dữ liệu.

**Kết quả mong đợi**

- Bỏ tích: câu chữ đổi, nói cột này đang bị hiểu là số thập phân.
- Tích lại rồi tạo: sau khi nạp vào kho (§6), `Tổng` của `Hoa hồng` là
  **2.659.000**. Nếu ra **2.659** thì ô tích đã không có tác dụng.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TF-08 ⭐ · Số âm và số thập phân không bị nhân lên nghìn lần

*Lỗi thật đã từng làm sai toàn bộ số liệu.*

- **Tệp:** `du-lieu-thu/loi-nhuan-so-am.csv`

**Các bước**

1. Tải tệp lên. Ở bước 2, nhìn kỹ cột `Loi nhuan`.

**Kết quả mong đợi**

- Dòng đầu là **-288.765** — không phải -288765.
- Dòng thứ tư là **0.402** — không phải 402.
- Cột được nhận là kiểu **số**, không phải chữ.
- Ô tích "dấu chấm là phân cách nghìn" **không** được tích sẵn ở cột này — phần
  lẻ biến thiên (`.765`, `.56`, `.402`, `.155`) nên đây là cột thập phân thật.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TF-09 ◻ · Cảnh báo chữ hoa / chữ thường

- **Tệp:** `du-lieu-thu/khu-vuc-hoa-thuong.csv`

**Các bước**

1. Tải tệp lên. Đọc cảnh báo của cột `Khu vực`.
2. Tích ô gộp (nếu có), hoàn tất, nạp vào kho, rồi dựng một biểu đồ cột
   `Khu vực` × `Tổng Doanh thu`.

**Kết quả mong đợi**

- Cảnh báo nói cột `Khu vực` có **2 nhóm** chỉ khác nhau chữ hoa/thường hoặc
  khoảng trắng, và kể ví dụ.
- **Có gộp:** biểu đồ 2 cột — một cột **2.500.000** (Miền Nam), một cột
  **2.300.000** (Miền Bắc). Tên nhóm còn lại là một trong các biến thể, không quan trọng biến thể nào.
- **Không gộp:** biểu đồ 5 cột, cao nhất 2.000.000, thấp nhất 300.000.
- Tổng của cả cột trong cả hai trường hợp đều là **4.800.000**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TF-10 ◻ · Huỷ giữa trình hướng dẫn không để lại rác

**Các bước**

1. Mở trình hướng dẫn, chọn `ban-hang-thang-10.csv`, chờ sang bước 2.
2. Đóng trình hướng dẫn (hoặc bấm huỷ) **không** hoàn tất.
3. Về Kho dữ liệu, bấm F5.

**Kết quả mong đợi**

- Không có bộ dữ liệu nào mới trong danh sách.
- Không có dòng nào ở trạng thái lỡ dở hiện ra cho người dùng.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TF-11 ◻ · Hai lối vào, một luồng

**Các bước**

1. Vào Kho dữ liệu → tạo bộ dữ liệu → ghi lại ba bước thấy trên thanh bước.
2. Vào Báo cáo → menu tạo báo cáo → chọn lối đi từ tệp.

**Kết quả mong đợi**

- Ba bước đầu **giống hệt nhau** ở cả hai lối.
- Chỉ **bước cuối** khác: lối thứ nhất kết thúc ở Kho dữ liệu, lối thứ hai đưa
  tiếp sang trình dựng báo cáo.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TF-12 ◻ · Đổi tên bộ dữ liệu ngay trong trình hướng dẫn

**Các bước**

1. Tải `ban-hang-thang-10.csv` lên. Ở bước 3, sửa tên thành `ban-hang-t10-thu`.
2. Hoàn tất, về Kho dữ liệu.

**Kết quả mong đợi**

- Danh sách hiện đúng tên bạn đặt, không phải tên tệp.
- Xoá bộ dữ liệu này sau khi kiểm (các phần sau dùng bộ ở TF-01).

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TF-13 ◻ · Chọn workspace khi tải lên

**Các bước**

1. Mở trình hướng dẫn, xem phần chọn workspace trên đầu.

**Kết quả mong đợi**

- Hiện đúng **1** workspace của Ánh Dương (gói Miễn phí cho tối đa 1 — xem §0.3).
- Không có ô chọn rỗng hay danh sách trống.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

---

## §4 · Kho dữ liệu và cập nhật dữ liệu

### KD-01 ⭐ · Danh sách kho dữ liệu

**Các bước**

1. Mở Kho dữ liệu sau khi đã làm §3.

**Kết quả mong đợi**

- Mỗi dòng có: tên, nguồn **Từ file**, số cột, số dòng, trạng thái nạp **Chưa nạp**.
- Trạng thái nạp hiện bằng **chữ**, không chỉ bằng màu.
- Bộ `ban-hang-thang-10` ghi 8 cột · 85 dòng.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### KD-02 ⭐ · Trang chi tiết bộ dữ liệu

**Các bước**

1. Mở `ban-hang-thang-10`.

**Kết quả mong đợi**

- Bảng cột liệt kê đủ 8 cột kèm kiểu, đúng như TF-01.
- Có bảng xem trước dữ liệu.
- Có nút **Cập nhật dữ liệu** (vì nguồn là tệp).

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### KD-03 ⭐ · Cập nhật bằng tệp tháng sau

*Đây là thứ phân biệt một nền tảng BI với một lần chụp ảnh dữ liệu.*

- **Tệp:** `du-lieu-thu/ban-hang-thang-11.csv`

**Các bước**

1. Ở trang chi tiết `ban-hang-thang-10`, ghi lại **id** trên thanh địa chỉ.
2. Bấm **Cập nhật dữ liệu** → chọn tệp tháng 11 → đọc bước đối chiếu cột.
3. Bấm **Thay dữ liệu**.
4. Nạp lại vào kho (§6), rồi xem `Tổng` của `Thành tiền`.

**Kết quả mong đợi**

- Bước 2 báo **Đủ 8 cột đang dùng** và nút Thay dữ liệu **bật**.
- Bước 3 xong: **id không đổi** (vẫn `/datasets/<id>` như bước 1), tên bộ dữ liệu không đổi.
- Số dòng đổi từ 85 thành **45**.
- `Tổng` của `Thành tiền` đổi từ 33.687.000 thành **22.607.000**.
- Mô hình và báo cáo trỏ tới bộ này (nếu đã có) **vẫn mở được**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### KD-04 ⭐ · Cập nhật bằng tệp thiếu cột phải bị chặn và gọi tên cột

*"Tệp không hợp lệ" là câu không ai sửa được.*

- **Tệp:** `du-lieu-thu/ban-hang-thang-11-thieu-cot.csv`

**Các bước**

1. Bấm **Cập nhật dữ liệu** trên `ban-hang-thang-10`, chọn tệp thiếu cột.

**Kết quả mong đợi**

- Câu cảnh báo nói **thiếu 2 cột** và **gọi tên** cả hai: `Chi nhánh`, `Thành tiền`.
- Nút **Thay dữ liệu** bị **khoá** — không bấm được.
- Câu cảnh báo nói vì sao điều đó quan trọng (mô hình và báo cáo gọi tên các cột này).
- Đóng hộp thoại: dữ liệu cũ còn nguyên, không mất gì.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### KD-05 ⭐ · Quy ước đọc số được giữ qua lần cập nhật

*Từng hỏng: chốt "dấu chấm là phân cách nghìn" ở lần tải đầu, cập nhật xong thì
hệ thống đoán lại từ đầu và 29.000 thành 29.*

- **Tệp:** `du-lieu-thu/hoa-hong-kieu-viet-thang-11.csv`

**Các bước**

1. Mở bộ dữ liệu `hoa-hong-kieu-viet` đã tạo ở TF-07 (đã chốt kiểu Việt).
2. **Cập nhật dữ liệu** bằng tệp tháng 11 trên, thay.
3. Nạp lại vào kho, xem `Tổng` của `Hoa hồng`.

**Kết quả mong đợi**

- Tổng là **2.993.000**.
- Nếu ra **2.993** thì quy ước đã bị mất khi cập nhật — lỗi.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### KD-06 ◻ · Đổi tên bộ dữ liệu

**Các bước**

1. Đổi tên một bộ dữ liệu thành `ban-hang-t10` rồi F5.
2. Đổi lại tên cũ.

**Kết quả mong đợi**

- Tên mới hiện ngay, còn sau F5.
- Tên trùng với bộ khác thì bị báo, không lặng lẽ tạo hai bộ cùng tên.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### KD-07 ◻ · Thư mục trong Kho dữ liệu

**Các bước**

1. Ở cột thư mục bên trái, bấm **Thêm thư mục**, tạo `Bán hàng 2026`.
2. Chuyển `ban-hang-thang-10` vào thư mục đó (**Chuyển tới thư mục**).
3. Bấm vào thư mục ở cột trái, rồi bấm **Chung**.

**Kết quả mong đợi**

- **Chung** luôn ở đầu danh sách, không bị xếp theo bảng chữ cái cùng các thư mục khác.
- Khi đang xem thư mục, danh sách chỉ còn bộ dữ liệu trong đó.
- Hộp **Chuyển tới thư mục** có dấu **Đang ở đây** ở thư mục hiện tại.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### KD-08 ◻ · Xoá bộ dữ liệu

**Các bước**

1. Tạo một bộ dữ liệu bỏ đi (tải lại `loi-nhuan-so-am.csv`), rồi xoá nó.
2. F5 lại Kho dữ liệu.

**Kết quả mong đợi**

- Có bước xác nhận trước khi xoá.
- Sau khi xoá, bộ đó không còn trong danh sách, kể cả sau F5.
- **Lưu ý thiết kế:** hệ thống xoá *mềm* — bảng trong kho phân tích vẫn còn để
  khôi phục được từ cơ sở dữ liệu. Giao diện **không** có nút khôi phục, nên nếu
  bạn trông đợi một thùng rác thì đó là tính năng chưa có, không phải lỗi.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### KD-09 ◻ · Xoá bộ dữ liệu đang được mô hình dùng

*Ca GHI NHẬN: luật chặn này là nợ có chủ đích, chưa làm.*

**Các bước**

1. Sau khi đã có mô hình ở §7, thử xoá bộ dữ liệu mà mô hình đó đang dùng.
2. Mở lại mô hình và báo cáo dựa trên nó.

**Kết quả mong đợi**

- Việc xoá **không bị chặn** — `deleteDataset.ts` còn để trống chốt chặn này
  (ghi rõ trong mã nguồn là nợ của mục 8.10).
- Điều phải đạt: mô hình và báo cáo **nói ra sự cố bằng tiếng Việt**, không trắng
  trang và **không hiện một con số sai**. Ghi lại chính xác những gì bạn thấy.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### KD-10 ◻ · Tìm kiếm và sắp xếp

**Các bước**

1. Gõ `ban-hang` vào ô tìm kiếm của Kho dữ liệu.
2. Bấm tiêu đề cột để sắp xếp theo tên, rồi theo ngày tạo.
3. Bấm F5 khi đang có từ khoá tìm kiếm.

**Kết quả mong đợi**

- Tìm kiếm lọc đúng, không phân biệt chữ hoa/thường.
- Sắp xếp đổi thật thứ tự, và mũi tên chỉ hướng hiện ra.
- Sau F5, từ khoá và thứ tự sắp xếp **vẫn còn** (chúng nằm trên URL).

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

---

## §5 · Kết nối cơ sở dữ liệu

Phần này nối tới chính container MySQL của môi trường dev — đó là cơ sở dữ liệu
thật duy nhất có sẵn trên máy.

| Thông số | Giá trị |
|---|---|
| Loại | MySQL |
| Host | `127.0.0.1` |
| Port | `3310` |
| Database | giá trị của `MYSQL_DATABASE` trong `backend/.env` (mặc định `bi_platform`) |
| User / mật khẩu | giá trị của `MYSQL_USER` / `MYSQL_PASSWORD` trong `backend/.env` |

> Mở `backend/.env` mà lấy, đừng gõ theo tài liệu — máy bạn có thể dùng cấu hình riêng.

### KN-01 ⭐ · Tạo kết nối tới một CSDL thật

**Các bước**

1. Quản lý tổ chức → Kết nối → tạo kết nối mới, điền bảng trên, tên `MySQL dev`.
2. Bấm kiểm tra kết nối (nếu có), rồi lưu.

**Kết quả mong đợi**

- Kiểm tra kết nối **thành công**.
- Kết nối hiện trong danh sách; **mật khẩu không bao giờ hiện lại** ở dạng đọc được.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### KN-02 ◻ · Sai mật khẩu CSDL phải báo bằng tiếng người

**Các bước**

1. Tạo thêm một kết nối với cùng thông số nhưng mật khẩu `SaiBet999`.
2. Bấm kiểm tra kết nối.

**Kết quả mong đợi**

- Câu báo nói về **sai thông tin đăng nhập**, bằng tiếng Việt.
- **Không** hiện nguyên văn lỗi của driver (`ER_ACCESS_DENIED_ERROR`, số cổng, đường dẫn tệp…).
- Không lưu kết nối lỗi đó lại nếu bạn không bấm lưu.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### KN-03 ⭐ · Đồng bộ bảng từ CSDL

**Các bước**

1. Mở kết nối `MySQL dev`, bấm đồng bộ bảng.
2. Chọn bảng `plans`, xác nhận.
3. Về Kho dữ liệu.

**Kết quả mong đợi**

- Danh sách bảng của database hiện ra, có `plans`, `tenants`, `users`…
- Sau khi chọn: có một bộ dữ liệu mới nguồn **Từ CSDL**, **3 dòng** (ba gói dịch vụ).
- Bộ dữ liệu nguồn CSDL **không** có nút Cập nhật dữ liệu bằng tệp — nó có đường nạp lại riêng.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### KN-04 ◻ · Đổi tên bộ dữ liệu rồi đồng bộ lại — tên bạn đặt phải còn

**Các bước**

1. Đổi tên bộ `plans` thành `Gói dịch vụ`.
2. Đồng bộ lại bảng đó một lần nữa.

**Kết quả mong đợi**

- Tên `Gói dịch vụ` **còn nguyên** sau khi đồng bộ.
- Không sinh ra bộ thứ hai trùng bảng.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### KN-05 ◻ · Xoá kết nối khi còn bộ dữ liệu phải bị chặn

**Các bước**

1. Thử xoá kết nối `MySQL dev` trong khi bộ `Gói dịch vụ` vẫn còn.

**Kết quả mong đợi**

- Bị **chặn**, và câu báo nói có bao nhiêu bộ dữ liệu đang dùng nó (kể cả tên vài bộ đầu).
- Sau khi xoá bộ dữ liệu đó thì xoá kết nối được.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### KN-06 ◻ · Xem trước dữ liệu đọc thẳng từ nguồn

**Các bước**

1. Trong trang kết nối, mở xem trước bảng `plans`.

**Kết quả mong đợi**

- Hiện 3 dòng với các cột `code`, `name`, `price_vnd`…
- Giá của `pro` và `business` đang **cùng 200** — đúng với §0.3, không phải lỗi hiển thị.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

---

## §6 · Nạp vào kho phân tích

### NA-01 ⭐ · Nạp bộ dữ liệu vào kho

**Các bước**

1. Mở `ban-hang-thang-10`, bấm **Nạp vào kho**.
2. **Không** bấm F5. Nhìn trạng thái.

**Kết quả mong đợi**

- Trạng thái tự đi qua **Đang chờ** → **Đang nạp** → **Đã nạp** mà không cần F5.
- Số dòng đã nạp là **85**.
- Sau khi xong, nút đổi thành **Nạp lại**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### NA-02 ⭐ · Số trong kho khớp đúng tệp gốc

**Các bước**

1. Sau khi nạp xong, đối chiếu bằng câu truy vấn thẳng vào kho:
   ```bash
   docker exec bi-clickhouse clickhouse-client -q "SELECT count() FROM bi_analytics.raw_t2_d<id>"
   ```
   (`<id>` là id bộ dữ liệu trên thanh địa chỉ; `t2` là tổ chức Ánh Dương.)

**Kết quả mong đợi**

- `count()` trả về **85**.
- Không có cột nào toàn `NULL`:
  ```bash
  docker exec bi-clickhouse clickhouse-client -q "SELECT countIf(\`Thành tiền\` IS NULL) FROM bi_analytics.raw_t2_d<id>"
  ```
  phải ra **0**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### NA-03 ⭐ · Nạp lại không nhân đôi dữ liệu

**Các bước**

1. Bấm **Nạp lại** trên cùng bộ dữ liệu, chờ xong.
2. Chạy lại câu `count()` ở NA-02.

**Kết quả mong đợi**

- Vẫn **85**, không phải 170.
- Trong lúc nạp lại, báo cáo đang mở vẫn đọc được số cũ (hoán đổi nguyên tử), không có khoảng trống báo lỗi.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### NA-04 ◻ · Kho tắt thì lỗi phải nói rõ cách sửa

**Các bước**

1. `docker stop bi-clickhouse`
2. Bấm **Nạp lại** một bộ dữ liệu.
3. `docker start bi-clickhouse`, chờ healthy, bấm lại.

**Kết quả mong đợi**

- Trạng thái thành **Nạp lỗi**, kèm câu nói được **nguyên nhân** (không nối được tới kho) chứ không phải một mã lỗi trần.
- Sau khi bật lại, nạp thành công, trạng thái về **Đã nạp**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### NA-05 ◻ · Lịch sử các lần nạp

**Các bước**

1. Xem phần lịch sử nạp trên trang chi tiết bộ dữ liệu.

**Kết quả mong đợi**

- Có ít nhất 3 dòng (NA-01, NA-03, NA-04) với thời điểm, trạng thái, số dòng.
- Lần lỗi ở NA-04 hiện lý do.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

---

## §7 · Mô hình dữ liệu và Khám phá

### MH-01 ⭐ · Mô hình không tự sinh — người dùng chọn bộ dữ liệu

**Các bước**

1. Mở Mô hình dữ liệu. Tạo mô hình mới tên `Bán hàng`.
2. Chọn bộ dữ liệu `ban-hang-thang-10`, xác nhận.

**Kết quả mong đợi**

- Danh sách bộ dữ liệu để chọn chỉ có những bộ **đã nạp** vào kho.
- Mô hình mới mở ra với ba tab: **Cấu trúc** · **Quan hệ** · **Khám phá**.
- Không có mô hình nào tự xuất hiện mà bạn không tạo.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### MH-02 ⭐ · Tab Cấu trúc — vai trò và phép gộp của từng cột

**Các bước**

1. Mở tab **Cấu trúc**.

**Kết quả mong đợi**

- 8 cột, mỗi cột nói rõ là **chiều** (để nhóm) hay **thước đo** (để đo).
- `Ngày bán` là chiều **thời gian**.
- `Số lượng`, `Đơn giá`, `Thành tiền` là thước đo; `Mã đơn`, `Chi nhánh`,
  `Nhóm hàng`, `Sản phẩm` là chiều.
- Hàng nút phép gộp của một thước đo số có: **Tổng · Trung bình · Đếm ô có dữ
  liệu · Đếm giá trị khác nhau · Ước lượng số khác nhau · Nhỏ nhất · Lớn nhất**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### MH-03 ⭐ · Khám phá trả đúng con số đã biết trước

**Các bước**

1. Mở tab **Khám phá**. Chọn chiều `Chi nhánh`, thước đo `Tổng` của `Thành tiền`.

**Kết quả mong đợi**

- Đúng 4 dòng, đúng giá trị:

  | Chi nhánh | Thành tiền |
  |---|---|
  | Gò Vấp | 10.833.000 |
  | Thủ Đức | 8.610.000 |
  | Quận 1 | 8.025.000 |
  | Quận 7 | 6.219.000 |

- Tổng bốn dòng = **33.687.000**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### MH-04 ⭐ · Đổi phép gộp ngay trong Khám phá

**Các bước**

1. Vẫn chiều `Chi nhánh`, đổi thước đo sang `Tổng` của `Số lượng`.
2. Đổi tiếp sang `Trung bình` của `Thành tiền`.

**Kết quả mong đợi**

- Theo `Số lượng`: Gò Vấp **340** · Quận 1 **259** · Thủ Đức **257** · Quận 7 **212**.
  Chú ý **thứ hạng đổi** so với MH-03 — đó là dấu hiệu phép gộp thật sự được áp dụng.
- Nhãn cột đổi theo phép gộp, ví dụ `Thành tiền (Trung bình)`.
- `Trung bình` của `Thành tiền` trên **toàn bộ** (bỏ chiều đi) là **396.318**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### MH-05 ⭐ · Thước đo tính được: Doanh thu = Số lượng × Đơn giá

*Ca đo thứ tự phép tính. Làm sai thứ tự thì số lệch 85 lần.*

**Các bước**

1. Ở tab **Cấu trúc**, tạo một thước đo mới: `Tổng` của biểu thức
   `Số lượng` × `Đơn giá`, tên `Doanh thu tính`.
2. Sang **Khám phá**, lấy `Tổng` của `Doanh thu tính` trên toàn bộ dữ liệu.

**Kết quả mong đợi**

- Ra đúng **33.687.000** — bằng y hệt `Tổng` của cột `Thành tiền` có sẵn trong tệp.
- Nếu ra **2.865.444.000** thì hệ thống đang tính `SUM(Số lượng) × SUM(Đơn giá)`
  — sai thứ tự, là lỗi.
- Thước đo tự nói ra phép tính của nó ở đâu đó trên giao diện (tên hoặc chú thích).

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### MH-06 ◻ · Đếm giá trị khác nhau trên cột chữ

**Các bước**

1. Khám phá: thước đo `Đếm giá trị khác nhau` của `Mã đơn`, không có chiều.
2. Rồi `Đếm giá trị khác nhau` của `Chi nhánh`, và của `Sản phẩm`.

**Kết quả mong đợi**

- `Mã đơn` → **85** · `Chi nhánh` → **4** · `Sản phẩm` → **6**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### MH-07 ◻ · Đếm ô có dữ liệu nói ra cột nào đang nhập thiếu

*Nhãn là "Đếm ô có dữ liệu", không phải "Đếm dòng" — và khác biệt đó có thật.*

**Các bước**

1. Khám phá: `Đếm ô có dữ liệu` của `Thành tiền`.

**Kết quả mong đợi**

- Ra **85** (tệp này không có ô trống nào).
- Nhãn trên nút đúng là **Đếm ô có dữ liệu**, không phải "Đếm dòng".

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### MH-08 ◻ · Gộp hai bộ dữ liệu vào một mô hình và nối quan hệ

**Các bước**

1. Thêm bộ `hoa-hong-kieu-viet` vào mô hình `Bán hàng`.
2. Sang tab **Quan hệ**, thử nối `Chi nhánh` với `Khu vực`.

**Kết quả mong đợi**

- Thêm được bộ thứ hai mà không mất cấu hình của bộ thứ nhất.
- Giao diện quan hệ cho chọn hai cột và kiểu nối.
- Nếu hai cột không khớp giá trị nào, Khám phá sau khi nối trả về rỗng hoặc nói
  ra điều đó — **không** trả số sai.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### MH-09 ◻ · Từ vựng của mô hình chỉ có một bản

**Các bước**

1. Ở tab **Cấu trúc**, đổi tên cột `Chi nhánh` thành `Cửa hàng`.
2. Sang **Khám phá** (không F5).
3. Mở trình dựng báo cáo trên mô hình này.

**Kết quả mong đợi**

- Cả Khám phá và bảng trường của trình dựng đều gọi là **Cửa hàng**, không nơi nào còn chữ `Chi nhánh`.
- Đổi lại tên cũ trước khi sang §8 (các ca sau gọi tên `Chi nhánh`).

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### MH-10 ◻ · Hạn chế phép gộp theo kiểu cột

**Các bước**

1. Ở **Cấu trúc**, xem hàng nút phép gộp của cột chữ `Sản phẩm` và cột ngày `Ngày bán`.

**Kết quả mong đợi**

- Cột chữ **không** có `Tổng` hay `Trung bình` — chỉ các phép đếm (và nhỏ nhất/lớn nhất nếu Cube làm được).
- Không có nút nào bấm vào rồi mới báo lỗi.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### MH-11 ◻ · Lọc trong Khám phá

**Các bước**

1. Khám phá: chiều `Chi nhánh`, `Tổng` của `Thành tiền`, thêm điều kiện
   `Nhóm hàng` **bằng** `Bánh`.

**Kết quả mong đợi**

- Tổng của cả bốn chi nhánh sau khi lọc = **12.635.000** (bằng đúng dòng `Bánh` ở §0.4).
- Bỏ điều kiện đi thì về lại 33.687.000.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### MH-12 ◻ · Xoá mô hình

**Các bước**

1. Tạo một mô hình bỏ đi tên `Mô hình thử`, rồi xoá nó.
2. Thử xoá mô hình `Bán hàng` **khi đã có báo cáo** dùng nó (làm sau §8).

**Kết quả mong đợi**

- Mô hình không có báo cáo: xoá được, có bước xác nhận.
- Mô hình đang có báo cáo: **bị chặn**, câu báo nói có bao nhiêu báo cáo đang dùng.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

---

## §8 · Trình dựng báo cáo

Cả phần này dựng trên mô hình `Bán hàng` của §7.

Trình dựng có: bảng trường bên trái, khung báo cáo ở giữa, cột phải với các mục
**Loại biểu đồ** · **Ô thả** · **Phép tính** · **Tiêu đề ô** · **Định dạng**.

> **Gói Miễn phí cho tối đa 3 báo cáo.** Phần này chỉ **lưu 2** báo cáo:
> `Doanh thu tháng 10` (BC-16) và `Bảng chi tiết` (BC-18). Mọi ca khác dựng rồi
> bỏ, không lưu. Giữ đúng như vậy thì ca `TT-04` ở §11 mới đo được chốt hạn mức.

### BC-01 ⭐ · Tạo báo cáo và vẽ biểu đồ đầu tiên

**Các bước**

1. Báo cáo → tạo báo cáo → chọn mô hình `Bán hàng`.
2. Thả `Chi nhánh` vào ô **Chiều dữ liệu**, `Thành tiền` vào ô **Giá trị**.

**Kết quả mong đợi**

- Biểu đồ cột vẽ ra **4 cột**, cao nhất là **Gò Vấp**.
- Trỏ chuột vào cột Gò Vấp: tooltip hiện **10.833.000**.
- Trục Y có nhãn, trục X ghi tên bốn chi nhánh — không phải `undefined` hay chuỗi rỗng.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-02 ⭐ · Tám loại biểu đồ

**Các bước**

1. Đổi lần lượt sang: Biểu đồ cột · Biểu đồ đường · Biểu đồ miền · Biểu đồ tròn ·
   Bảng số liệu · Biểu đồ thanh ngang · Biểu đồ phân tán · Bản đồ nhiệt.

**Kết quả mong đợi**

- Cả 8 loại **vẽ ra được** với cùng cấu hình (Chi nhánh × Thành tiền), không ô nào trắng.
- Loại nào cần thêm trường (bản đồ nhiệt cần 2 chiều) thì **nói ra cần gì**, không im lặng để ô trống.
- Bảng số liệu hiện đúng 4 dòng với số khớp §0.4.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-03 ◻ · Nhãn ô thả đổi theo loại biểu đồ

**Các bước**

1. Với Biểu đồ cột, đọc tên ba ô thả.
2. Đổi sang Bản đồ nhiệt, đọc lại.

**Kết quả mong đợi**

- Biểu đồ cột: **Chiều dữ liệu** (trục X) · **Giá trị** (trục Y) · **Nhóm màu**.
- Bản đồ nhiệt: tên ô đổi theo đúng nghĩa của loại đó (ví dụ trục Y thay cho Nhóm màu) — không còn chữ nào nói sai việc ô đang làm.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-04 ⭐ · Kéo trường bằng chuột thật

*Ca này từng bắt được một lỗi mà **873 test tự động đều không thấy**: kéo-thả
chết hẳn mà test vẫn xanh, vì cái cổng "ô này nhận thả được" là của trình duyệt.*

**Các bước**

1. **Kéo** (giữ chuột, di, nhả) `Nhóm hàng` từ bảng trường vào ô **Nhóm màu**.
2. Kéo `Sản phẩm` thả vào ô **Chiều dữ liệu** (thay trường đang có).
3. Kéo một trường ra **ngoài** mọi ô rồi nhả.

**Kết quả mong đợi**

- Bước 1 và 2: ô nhận trường, biểu đồ vẽ lại. Trong lúc kéo, ô đích **sáng lên** để biết thả được.
- Bước 3: không có gì đổi, không lỗi.
- Bước 2 thay trường cũ chứ không thêm thành hai.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-05 ⭐ · Đổi phép tính thì số đổi

**Các bước**

1. Về cấu hình `Chi nhánh` × `Thành tiền`, phép tính **Tổng**.
2. Đổi phép tính sang **Trung bình**, rồi **Lớn nhất**, rồi **Đếm ô có dữ liệu**.

**Kết quả mong đợi**

- **Tổng**: Gò Vấp 10.833.000.
- **Lớn nhất** trên toàn bộ: **1.080.000** (ô lớn nhất trong tệp).
- **Đếm ô có dữ liệu** trên toàn bộ: **85**.
- Nhãn trên biểu đồ/tooltip đổi theo phép tính, không giữ chữ của phép cũ.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-06 ⭐ · Đổi thước đo thì thứ hạng đổi

*Nếu thứ hạng không đổi, rất có thể biểu đồ vẫn đang vẽ số của thước đo cũ.*

**Các bước**

1. `Chi nhánh` × `Tổng Thành tiền` → ghi thứ tự 4 cột từ cao xuống thấp.
2. Đổi ô **Giá trị** sang `Số lượng`, vẫn `Tổng` → ghi lại thứ tự.

**Kết quả mong đợi**

- Theo tiền: **Gò Vấp · Thủ Đức · Quận 1 · Quận 7** (10.833.000 · 8.610.000 · 8.025.000 · 6.219.000).
- Theo số lượng: **Gò Vấp · Quận 1 · Thủ Đức · Quận 7** (340 · 259 · 257 · 212).
- Hai thứ tự khác nhau ở vị trí 2 và 3.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-07 ⭐ · Bốn kiểu sắp xếp

**Các bước**

1. `Chi nhánh` × `Tổng Thành tiền`. Thử lần lượt bốn lựa chọn sắp xếp:
   **Theo giá trị (lớn → nhỏ)** · **Theo giá trị (nhỏ → lớn)** ·
   **Theo tên (A → Z)** · **Theo tên (Z → A)**.

**Kết quả mong đợi**

- Lớn → nhỏ: Gò Vấp, Thủ Đức, Quận 1, Quận 7.
- Nhỏ → lớn: đảo lại hoàn toàn.
- A → Z: Gò Vấp, Quận 1, Quận 7, Thủ Đức.
- Z → A: Thủ Đức, Quận 7, Quận 1, Gò Vấp.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-08 ⭐ · Trục thời gian: nhãn ngày và thứ tự cũ → mới

*Hai lỗi đã sửa cùng lúc: nhãn hiện nguyên văn `2026-10-04T00:00:00.000`, và
20 ngày doanh thu cao nhất bị nối thành một đường trông như xu hướng.*

**Các bước**

1. Đổi ô **Chiều dữ liệu** sang `Ngày bán`, loại **Biểu đồ đường**.
2. Đọc danh sách lựa chọn sắp xếp.
3. Đọc nhãn trục X.

**Kết quả mong đợi**

- Lựa chọn sắp xếp đọc bằng lời của trục thời gian: **Theo thời gian (cũ → mới)**
  và **Theo thời gian (mới → cũ)** — không còn "Theo tên (A → Z)".
- Mặc định khi vừa thả một chiều thời gian là **cũ → mới**.
- Nhãn trục X dạng **01/10/2026**, không phải `2026-10-01` và không phải `2026-10-01T00:00:00.000`.
- Điểm đầu là **01/10/2026 = 2.088.000**, điểm cuối là **31/10/2026 = 609.000**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-09 ⭐ · Phân trang nhóm

**Các bước**

1. Giữ cấu hình `Ngày bán` × `Tổng Thành tiền`, sắp xếp **Theo thời gian (cũ → mới)**.
2. Đếm số điểm trên trang 1, bấm nút sang trang.

**Kết quả mong đợi**

- Trang 1: **20 ngày**, từ **01/10/2026** đến **23/10/2026**.
- Trang 2: **6 ngày**, bắt đầu từ **24/10/2026**, kết thúc 31/10/2026.
- Nút sang trang **tự khoá** ở trang cuối.
- Thứ tự thời gian **liền mạch** qua hai trang — không phải trang 1 là 20 ngày cao nhất.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-10 ⭐ · Lọc riêng từng ô biểu đồ

**Các bước**

1. Về `Chi nhánh` × `Tổng Thành tiền`, biểu đồ cột.
2. Ở cột phải, thêm điều kiện: **Trường để lọc** = `Nhóm hàng`,
   **Phép so sánh** = `bằng`, **Giá trị** = `Bánh`.
3. Bấm **+ Thêm điều kiện**, thêm `Chi nhánh` **khác** `Quận 7`.
4. Bỏ điều kiện thứ hai.
5. Thử phép so sánh **có giá trị** và **để trống**.

**Kết quả mong đợi**

- Sau bước 2: tổng bốn cột = **12.635.000** (dòng `Bánh` ở §0.4). Đầu ô có một dòng
  ghi điều kiện đang lọc, đại ý *lọc: Nhóm hàng bằng Bánh*.
- Sau bước 3: chỉ còn 3 cột, không có Quận 7.
- Bước 4: về lại 4 cột.
- Bước 5: hai phép này **không** hiện ô nhập giá trị (chúng không cần giá trị).

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-11 ⭐ · Lọc, phép tính và sắp xếp phải sống sót sau khi lưu

*Từng hỏng âm thầm: lưu được vào database nhưng lúc đọc lại thì bị bỏ, nên mở
trang xem lại thấy tổng toàn bộ.*

**Các bước**

1. Giữ cấu hình của BC-10 (lọc `Nhóm hàng` bằng `Bánh`), đổi phép tính sang
   **Trung bình**, sắp xếp **Theo tên (A → Z)**.
2. Lưu báo cáo tên `Thu lưu cấu hình`.
3. Bấm F5. Rồi mở trang **xem** báo cáo đó.
4. Xoá báo cáo này sau khi kiểm (gói chỉ cho 3 báo cáo).

**Kết quả mong đợi**

- Sau F5 và ở cả trang xem: **vẫn** đang lọc `Bánh`, **vẫn** phép Trung bình,
  **vẫn** thứ tự A → Z.
- Con số ở trang xem **giống hệt** con số trong trình dựng.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-12 ◻ · Tiêu đề ô

**Các bước**

1. Đặt **Tiêu đề ô** là `Doanh thu theo chi nhánh`.
2. Xoá trống tiêu đề.

**Kết quả mong đợi**

- Tiêu đề hiện trên ô biểu đồ, cả trong trình dựng và trang xem.
- Để trống thì ô vẫn vẽ bình thường, không hiện chữ `undefined`.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-13 ◻ · Chèn chú thích

**Các bước**

1. Trên thanh **Chèn**, thêm lần lượt: **Tiêu đề** · **Văn bản** · **Kẻ ngang** ·
   **Kẻ dọc** · **Mũi tên** · **Khung nền** · **Khoanh vùng**.
2. Gõ chữ vào hộp Văn bản, dùng Backspace và mũi tên trong lúc gõ.
3. Chọn một chú thích rồi bấm Delete.

**Kết quả mong đợi**

- Cả 7 loại chèn được và nhìn thấy được.
- Hộp vừa chèn **nhận con trỏ ngay**, gõ được luôn không phải bấm thêm.
- Backspace và mũi tên chỉ sửa chữ, **không** xoá cả hộp.
- Delete xoá được chú thích đang chọn.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-14 ◻ · Kéo và co giãn ô trên khung

**Các bước**

1. Kéo ô biểu đồ sang vị trí khác trên khung.
2. Kéo mép ô để co giãn.
3. Kéo một chú thích đè lên biểu đồ.

**Kết quả mong đợi**

- Ô **đi theo con trỏ**, không lệch khỏi chuột khi kéo nhanh.
- Thả ra thì ô nằm đúng chỗ đã thả, quy về ô lưới.
- Chú thích nằm **trên** biểu đồ, bấm được vào nó.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-15 ◻ · Hoàn tác, làm lại, thu phóng

**Các bước**

1. Chèn một chú thích, rồi bấm hoàn tác (hoặc `Ctrl+Z`), rồi làm lại.
2. Kéo một ô rồi `Ctrl+Z`.
3. Dùng thanh **Thu phóng khung**, rồi bấm **Về 100%**.

**Kết quả mong đợi**

- Hoàn tác xoá chú thích vừa chèn; làm lại đưa nó về.
- Ô bị kéo trở về **đúng vị trí cũ**, không lệch một ô lưới.
- Thu phóng đổi tỉ lệ cả khung, **Về 100%** trả lại nguyên trạng.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-16 ⭐ · Lưu báo cáo và chỉ báo "Chưa lưu"

**Các bước**

1. Dựng lại báo cáo: ô 1 = `Chi nhánh` × `Tổng Thành tiền` (cột), ô 2 =
   `Ngày bán` × `Tổng Thành tiền` (đường, cũ → mới).
2. Nhìn chỉ báo **Chưa lưu**. Bấm **Lưu báo cáo**, tên `Doanh thu tháng 10`.
3. Nhìn lại chỉ báo. Bấm F5.
4. Đổi một thứ nhỏ (ví dụ tiêu đề ô), nhìn chỉ báo lần nữa, rồi **Lưu thay đổi**.

**Kết quả mong đợi**

- Trước khi lưu: có chỉ báo **Chưa lưu**.
- Vừa mở báo cáo mới mà chưa làm gì thì **không** tự nhận là Chưa lưu.
- Sau khi lưu: chỉ báo **tắt**.
- Sau F5: cả hai ô còn nguyên, số không đổi, và vẫn không có chỉ báo Chưa lưu.
- Bước 4: chỉ báo bật lại rồi tắt sau khi lưu.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-17 ◻ · Nút Sửa mô hình không làm mất việc đang làm

**Các bước**

1. Trong trình dựng, gõ dở một tiêu đề ô (**chưa lưu**).
2. Bấm **Sửa mô hình** trên bảng trường.
3. Ở tab mô hình vừa mở, đổi tên cột `Chi nhánh` thành `Cửa hàng`, lưu.
4. Quay lại tab trình dựng.
5. Đổi tên cột về `Chi nhánh`.

**Kết quả mong đợi**

- Bước 2 mở **tab mới** `/datamodels/:id`, **không** về `/login`, và trình dựng
  **không** hỏi "Rời khỏi trang?".
- Bước 4: bảng trường gọi là **Cửa hàng**, nhưng tiêu đề gõ dở **vẫn còn** và chỉ
  báo Chưa lưu vẫn như trước.
- Người xem (`viewer@…`) thấy nút ghi **Xem mô hình** thay vì Sửa mô hình.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### BC-18 ⭐ · Bảng số liệu

**Các bước**

1. Tạo báo cáo thứ hai: loại **Bảng số liệu**, chiều `Sản phẩm`, giá trị
   `Tổng Thành tiền`, sắp xếp **Theo giá trị (lớn → nhỏ)**.
2. Lưu tên `Bảng chi tiết`.

**Kết quả mong đợi**

- Đúng 6 dòng, thứ tự và số: Bánh bông lan **9.415.000** · Trà sữa trân châu
  **5.655.000** · Cà phê sữa **5.597.000** · Trà đào cam sả **5.175.000** · Cà phê
  đen **4.625.000** · Bánh mì que **3.220.000**.
- Số có **phân cách nghìn**, không phải `9415000`.
- Bảng rộng hơn khung thì **bảng** tự cuộn ngang, trang **không** cuộn ngang.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

---

## §9 · Xem, chia sẻ, xuất tệp

### XC-01 ⭐ · Trang xem báo cáo

**Các bước**

1. Báo cáo → mở `Doanh thu tháng 10`.

**Kết quả mong đợi**

- Hai ô vẽ ra, số **giống hệt** trong trình dựng.
- Không có ô thả, không có bảng trường — đây là trang xem.
- Có nút để sang trình dựng (nếu bạn có quyền sửa).

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XC-02 ⭐ · Xuất Ảnh PNG

**Các bước**

1. Ở trang xem (hoặc trình dựng), mở menu xuất → **Ảnh PNG**.
2. Mở tệp vừa tải về.

**Kết quả mong đợi**

- Một tệp `.png` **thật sự rơi xuống đĩa**.
- Mở ra **thấy biểu đồ có màu**, không phải ảnh trắng.
- Chữ trong ảnh đọc được, nhãn trục không bị cắt.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XC-03 ⭐ · Xuất Tệp PDF

**Các bước**

1. Menu xuất → **Tệp PDF**. Mở tệp.

**Kết quả mong đợi**

- Tệp `.pdf` mở được, **mỗi trang báo cáo là một trang PDF**.
- Biểu đồ không bị cắt mất nửa bên phải.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XC-04 ⭐ · Xuất Bảng tính Excel và đối chiếu số

*Ca xuất quan trọng nhất: mở tệp ra và so từng con số.*

**Các bước**

1. Mở báo cáo `Bảng chi tiết`, menu xuất → **Bảng tính Excel**.
2. Mở tệp bằng Excel.

**Kết quả mong đợi**

- Có đúng 6 dòng sản phẩm với 6 con số của BC-18.
- Cột số là **số thật** trong Excel (bấm vào thấy `9415000`, tính `SUM` được),
  không phải chuỗi `"9.415.000"`.
- **Giới hạn đã biết:** cột ngày (nếu có trong báo cáo bạn xuất) được ghi thành
  **chữ**, không phải kiểu Date của Excel. Không tính là lỗi.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XC-05 ◻ · Xuất riêng một ô

**Các bước**

1. Ở báo cáo `Doanh thu tháng 10`, mở menu của **một ô** biểu đồ → xuất ô đó ra PNG.

**Kết quả mong đợi**

- Ảnh chỉ chứa **ô đó**, không chứa ô còn lại.
- Có đủ viền/nền, không bị lẹm nội dung.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XC-06 ⭐ · Chia sẻ: liên kết mở được mà không cần đăng nhập

**Các bước**

1. Mở `Doanh thu tháng 10` → **Chia sẻ** → **Tạo liên kết**, sao chép.
2. Mở **cửa sổ ẩn danh** (hoặc một trình duyệt khác chưa đăng nhập), dán liên kết.

**Kết quả mong đợi**

- Liên kết dạng `http://localhost:5173/xem/<chuỗi>`.
- Ở cửa sổ ẩn danh: báo cáo **vẽ ra đủ hai ô**, số giống bản gốc.
- **Không** có sidebar, **không** có nút sửa, không hỏi đăng nhập.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XC-07 ⭐ · Liên kết công khai không mang theo token của bạn

*Đột biến đã từng đi qua: ca tự động không phát hiện được chỗ này.*

**Các bước**

1. Đang **đăng nhập**, mở DevTools → tab Network, rồi mở chính liên kết `/xem/<chuỗi>`.
2. Tìm các request tới `/api/...` và xem header `Authorization`.

**Kết quả mong đợi**

- Các request của trang xem công khai **không** có header `Authorization`.
- Trang vẫn hiện đủ dữ liệu.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XC-08 ◻ · Thu hồi liên kết chia sẻ

**Các bước**

1. Trong hộp **Chia sẻ**, thu hồi liên kết vừa tạo.
2. Mở lại liên kết đó ở cửa sổ ẩn danh.

**Kết quả mong đợi**

- Liên kết **không còn dùng được**, và trang nói rõ liên kết đã bị thu hồi hoặc không tồn tại.
- **Không** hiện một phần dữ liệu nào.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XC-09 ◻ · Thư mục báo cáo

**Các bước**

1. Ở trang Báo cáo, tạo thư mục `Tháng 10`, chuyển `Doanh thu tháng 10` vào.
2. Bấm **Chung**, rồi bấm thư mục.
3. Tạo một báo cáo mới **khi đang đứng trong thư mục** (rồi bỏ, không lưu).

**Kết quả mong đợi**

- **Chung** luôn ở đầu cột thư mục.
- Lọc theo thư mục đúng.
- Báo cáo tạo khi đang trong thư mục thì mặc định thuộc thư mục đó.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### XC-10 ◻ · Xoá báo cáo

**Các bước**

1. Xoá báo cáo `Thu lưu cấu hình` nếu còn (từ BC-11).
2. F5 lại trang Báo cáo.

**Kết quả mong đợi**

- Có bước xác nhận; sau khi xoá thì không còn trong danh sách, kể cả sau F5.
- Số báo cáo còn lại đúng **2** — điều kiện cho §11.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

---

## §10 · Trợ lý dữ liệu

Khung hỏi đáp nằm ở góc phải dưới, nút ghi **Trợ lý dữ liệu**.

> Lớp mô hình ngôn ngữ chỉ hoạt động khi `LLM_API_KEY`, `LLM_BASE_URL`,
> `LLM_MODEL` có trong `backend/.env`. Thiếu thì khung **vẫn trả lời** bằng lớp
> so khớp từ khoá — kém hơn nhưng không hỏng. Kiểm bằng `npm run llm:kiem` nếu
> muốn biết chắc.

### TL-01 ⭐ · Mở khung hỏi đáp

**Các bước**

1. Đang xem báo cáo `Doanh thu tháng 10`, tìm nút ở góc phải dưới.

**Kết quả mong đợi**

- Nút có **chữ "Trợ lý dữ liệu"** nhìn thấy được, không phải chỉ một hình tròn có con robot.
- Bấm vào thì khung mở ra, có ô gõ câu hỏi và nút thu khung lại.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-02 ⭐ · Hỏi một câu có đáp án trong dữ liệu đang xem

**Các bước**

1. Gõ: `chi nhánh nào doanh thu cao nhất`.

**Kết quả mong đợi**

- Câu trả lời nói tới **Gò Vấp** và/hoặc con số **10.833.000**.
- Nếu nó trả lời bằng một con số **không có trong báo cáo đang xem** (ví dụ số
  lượng báo cáo, số bộ dữ liệu) thì đó là lỗi — đúng loại lỗi đã sửa ở bản A1.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-03 ⭐ · Hỏi một câu dữ liệu KHÔNG trả lời được

*Lỗi nguy hiểm nhất của một trợ lý: trả lời sai mà nghe như thật.*

**Các bước**

1. Gõ: `lợi nhuận cao nhất là bao nhiêu` (dữ liệu không có cột lợi nhuận).
2. Gõ: `có bao nhiêu khách hàng nữ`.

**Kết quả mong đợi**

- Cả hai câu: trợ lý **nói là không biết / không có dữ liệu đó**, hoặc hỏi lại.
- **Tuyệt đối không** được trả về một con số của chủ đề khác (33.687.000, số báo
  cáo, số bộ dữ liệu…) như thể đó là câu trả lời.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-04 ◻ · Hỏi khi tổ chức chưa có dữ liệu

**Các bước**

1. Đăng nhập `hanh@saomai.vn`, chuyển sang **Công ty Sao Mai** (0 bộ dữ liệu).
2. Mở trợ lý, hỏi `doanh thu tháng này bao nhiêu`.

**Kết quả mong đợi**

- Trợ lý nói tổ chức **chưa có dữ liệu** và gợi ý bước tiếp theo (tải tệp lên).
- Không trả về số 0 như thể đó là doanh thu thật.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-05 ◻ · Trợ lý biết đang ở trang nào

**Các bước**

1. Ở trang **Kho dữ liệu**, hỏi `tôi đang có mấy bộ dữ liệu`.
2. Sang trang báo cáo, hỏi `báo cáo này đang xem gì`.

**Kết quả mong đợi**

- Câu 1: số bộ dữ liệu **khớp** với danh sách đang hiện trên màn hình.
- Câu 2: nói được tên báo cáo hoặc các chiều/thước đo của nó.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-06 ◻ · Khung không bao giờ làm hỏng trang

**Các bước**

1. Gõ một câu vô nghĩa: `asdf qwer 1234`.
2. Gõ một câu rất dài (dán 2–3 đoạn văn).
3. Gõ liên tiếp 3 câu không chờ trả lời xong.

**Kết quả mong đợi**

- Không trường hợp nào làm trang trắng, treo, hay hiện lỗi kỹ thuật.
- Khung trả lời hoặc nói không hiểu; các câu hỏi xếp hàng đúng thứ tự.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-07 ⭐ · Hỏi LIÊN TIẾP nhiều câu, khung không được tắt tiếng

*Ca quan trọng nhất của cả phần này: đây đúng là cảnh hội đồng hỏi dồn.*

**Các bước**

1. Mở một mô hình dữ liệu (hoặc trang báo cáo dựng trên mô hình).
2. Hỏi **12 câu khác nhau liên tiếp**, không chờ nghỉ giữa các câu. Dùng đúng
   danh sách này:

   ```
   tổng doanh thu là bao nhiêu
   doanh thu theo chi nhánh
   nhóm hàng nào doanh thu cao nhất
   chi nhánh nào bán được nhiều nhất
   sản phẩm nào bán chạy nhất
   tổng số lượng bán được là bao nhiêu
   doanh thu trung bình là bao nhiêu
   doanh thu theo ngày
   doanh thu theo sản phẩm
   số lượng theo chi nhánh
   tổng đơn giá là bao nhiêu
   đơn giá trung bình là bao nhiêu
   ```

**Kết quả mong đợi**

- **Cả 12 câu đều có câu trả lời.** Trước bản vá 24/11/2026, câu thứ 9 trở đi
  trả về "Tôi chưa hiểu câu này" vì hết hạn mức token/phút của nhà cung cấp —
  và đó là một câu NÓI SAI, vì khung hiểu thừa, nó chỉ không gọi được mô hình.
- Nếu có câu nào bế tắc, đọc kỹ câu khung nói: nó phải nói **"chưa gọi được mô
  hình ngôn ngữ"** hoặc **"đã dùng hết lượt … thử lại sau N phút"**, chứ KHÔNG
  được nói "chưa hiểu câu này". Một câu "chưa hiểu" ở đây là lỗi thật.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-08 ⭐ · Hỏi LẠI câu đã hỏi phải ra ngay

*Chứng minh bộ nhớ đệm đang chạy — đây là thứ giữ cho buổi demo không hết lượt.*

**Các bước**

1. Ngay sau `TL-07`, hỏi lại **đúng ba câu đầu** của danh sách đó.

**Kết quả mong đợi**

- Ba câu trả lời **giống hệt** lần đầu, và ra **gần như tức thì** (dưới 1 giây;
  đo được 0,1–0,2 giây), không có ba chấm chờ lâu như lần đầu.
- Con số vẫn là số **mới**: đệm chỉ nhớ *cách đặt truy vấn*, còn truy vấn thì
  chạy lại trên kho mỗi lần. Kiểm bằng cách cập nhật dữ liệu (`KD-03`) rồi hỏi
  lại — con số phải đổi theo.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-09 ⭐ · Hỏi về LOẠI này không được trả lời bằng số của loại kia

*Lỗi tệ nhất đã đo được: một con số thật, của thứ khác, kèm nhãn nghe rất thật.*

**Các bước**

1. Vào trang **Kho dữ liệu**. Hỏi `có bao nhiêu mô hình dữ liệu`.
2. Vào trang **Mô hình dữ liệu**. Hỏi `có bao nhiêu bộ dữ liệu`.

**Kết quả mong đợi**

- Bước 1: con số trả về là **số mô hình**, và nhãn nói "mô hình". Trước bản vá
  24/11/2026 nó trả về *"Số bộ dữ liệu trong workspace này"* — đúng con số của
  bộ dữ liệu, sai hẳn câu hỏi (đo trên tổ chức có 11 bộ và 3 mô hình: nó nói
  11).
- Bước 2: ngược lại — phải ra **số bộ dữ liệu**, nhãn nói "bộ dữ liệu".
- Hai con số phải **khác nhau** nếu tổ chức có số bộ dữ liệu khác số mô hình.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-10 ⭐ · Hạ tầng vừa dựng: đèn KHÔNG được xanh trước khi hỏi được

Đây là ca quan trọng nhất của §10, vì nó là **hai phút đầu của buổi bảo vệ**.

**Các bước**

1. Chạy `docker restart bi-cube`.
2. Mở ngay trang mô hình dữ liệu, tab Explorer, và **nhìn nhãn trạng thái Cube**.
3. Trong lúc nhãn còn đỏ, hỏi khung một câu số liệu.
4. Ngay khi nhãn chuyển xanh, hỏi lại **câu đầu tiên**.

**Kết quả mong đợi**

- Bước 2: nhãn **đỏ**, và nó tự hỏi lại mỗi 5 giây (không phải bấm F5).
- Bước 3: khung nói **"Chưa kết nối được tới tầng ngữ nghĩa (Cube.js)"** kèm lệnh
  cần chạy, hoặc **"đang khởi động hoặc đang quá tải nên chưa trả kết quả trong
  30 giây"** nếu Cube đã mở cổng mà còn đang biên dịch. KHÔNG được nói "chưa
  hiểu câu này", và KHÔNG được hiện một lỗi JavaScript.
- Bước 4: **trả lời được ngay**. Đây là điểm mấu chốt — đo được 24/11/2026 ở bản
  trước: nhãn xanh ở giây 36 nhưng truy vấn còn hỏng thêm **2 phút 7 giây** nữa
  (503 · 503 · **500** · 503), vì nhãn hỏi `/readyz` còn `/readyz` xanh sớm hơn
  sự thật. Nay nhãn hỏi `/meta`, tức đúng phần việc biên dịch mà truy vấn phải
  chờ. Sau khi vá: nhãn xanh ở giây 9,6 và truy vấn đầu tiên trả về **200 trong
  1,1 giây**.

> **Vẫn nên làm trước khi demo:** dựng hạ tầng rồi tự hỏi một câu số liệu và
> chờ nó trả lời xong. Nhãn xanh là đủ, nhưng câu đầu tiên vẫn tốn 1–12 giây
> (ClickHouse và pool MySQL cũng lạnh); mọi câu sau đó 0,3–3 giây.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-11 ⭐ · Khoảng ngày TỰ DO không được đi tố oan mô hình dữ liệu

**Các bước**

1. Trên mô hình `Ban hang thang 10`, hỏi **"doanh thu từ ngày 1/10 đến 15/10"**.
2. Hỏi **"doanh thu tháng 10"**.

**Kết quả mong đợi**

- Bước 1: khung nói nó **hiểu mốc thời gian có TÊN** (hôm nay, tuần này, tháng 10,
  quý 3, năm 2025) và mời hỏi lại theo tháng/quý/năm, hoặc viết ngày đầy đủ kiểu
  `2026-10-01`.
- Bước 1 **TUYỆT ĐỐI KHÔNG** được hiện câu *"Mô hình chưa truy vấn được. Kiểm tra
  tab Quan hệ — có thể hai bảng chưa được nối, hoặc đang nối vòng."* Đó là câu đo
  được 24/11/2026, và nó sai: mô hình không có vấn đề gì, chỉ là mô hình ngôn ngữ
  đã viết `"1/10"` vào bộ lọc rồi ClickHouse không đọc nổi chuỗi đó.
- Bước 2: trả lời **33.687.000**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-12 ⭐ · Lọc không khớp giá trị nào thì phải nói cột đó ĐANG CÓ gì

**Các bước**

1. Hỏi **"doanh thu của sản phẩm Bánh"** (`Bánh` là một giá trị của cột **Nhóm
   hàng**, còn cột **Sản phẩm** thì ghi `Bánh bông lan`, `Bánh mì que`).
2. Hỏi **"doanh thu tuần này"** (dữ liệu chỉ có tháng 10/2026).

**Kết quả mong đợi**

- Bước 1: **"Không có dòng nào thoả điều kiện này. Cột Sản phẩm đang có: Bánh bông
  lan, Bánh mì que, Cà phê sữa, Cà phê đen, Trà sữa trân châu, Trà đào cam sả."**
- Bước 2: **"Không có dòng nào thoả điều kiện này."**
- Cả hai bước **KHÔNG** được in ra `Thành tiền (trống).` — đó là câu trả lời của
  7 trong 42 câu thử ngày 24/11/2026, và nó không nói cho người đọc biết chuyện
  gì đã xảy ra.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-13 ⭐ · Hỏi một thứ mô hình KHÔNG CÓ thì phải nói mô hình có gì

**Các bước**

1. Hỏi **"lợi nhuận là bao nhiêu"** (mô hình không có cột nào tên lợi nhuận).
2. Hỏi **"những đơn trên 1 triệu"**.

**Kết quả mong đợi**

- Cả hai bước: khung nói **"Tôi chưa thấy thứ bạn hỏi trong mô hình này. Nó đo
  được: Số dòng, Số lượng, Đơn giá, Thành tiền; và tách được theo: Mã đơn, Ngày
  bán, Chi nhánh, Nhóm hàng, Sản phẩm."**
- KHÔNG được chỉ nói "Tôi chưa hiểu câu này" — 8 trong 42 câu thử ngày 24/11/2026
  dừng ở đúng câu đó, trong khi danh sách trường đang nằm sẵn trong tay backend.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-14 ⭐ · Lời chào trả lời được khi NGẮT MẠNG

**Các bước**

1. Mở DevTools → tab Network → đặt **Offline**.
2. Mở khung hỏi đáp, gõ **"xin chào"**.
3. Gõ **"bạn làm được gì"**.
4. Gõ **"cảm ơn bạn"**.
5. Bỏ Offline, gõ **"xin chào, cho tôi biết doanh thu theo chi nhánh"**.

**Kết quả mong đợi**

- Bước 2–4: trả lời **ngay, không một lượt gọi mạng nào** — lời chào, danh sách
  ba loại câu hỏi khung làm được, và lời đáp cảm ơn.
- Bước 5: trả lời bằng **số liệu doanh thu theo chi nhánh**, KHÔNG phải lời chào.
  Đây là chốt quan trọng: một chữ "chào" lịch sự ở đầu câu không được phép giết
  cả câu hỏi.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-15 ◻ · Mốc quý/năm đọc ra chữ, và câu chưa so sánh được phải nói ra

**Các bước**

1. Hỏi **"doanh thu theo quý"**.
2. Hỏi **"doanh thu năm nay"**.
3. Hỏi **"doanh thu tháng 10 so với tháng 9"**.
4. Hỏi **"trung bình mỗi đơn bao nhiêu tiền"**.

**Kết quả mong đợi**

- Bước 1: **"Quý 4/2026: Thành tiền 33.687.000."** — không phải `01/10/2026`.
- Bước 2: **"Năm 2026: …"** — không phải `01/01/2026`.
- Bước 3: cuối câu trả lời có **"(Lưu ý: tôi chưa đặt hai kỳ cạnh nhau để so
  được…)"**. Con số một mình thì đúng, nhưng nó không trả lời câu hỏi, và người
  đọc phải được biết điều đó.
- Bước 4: **396.318**, không phải `396.317,647`.
- Dòng "Tôi hiểu" không còn chữ tiếng Anh nào (`(month)`, `(quarter)`).

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-16 ⭐ · Hỏi LẠI sau khi bấm F5 phải ra ngay

*Ca này canh bộ đệm phía SERVER. Bản trước chỉ đệm trong bộ nhớ của một tab, nên
F5 là tốn lại toàn bộ lượt gọi mô hình.*

**Các bước**

1. Hỏi **"doanh thu theo chi nhánh"**, chờ trả lời xong.
2. Bấm **F5**, mở lại khung hỏi đáp, hỏi **đúng câu đó**.
3. Mở một **cửa sổ ẩn danh**, đăng nhập lại cùng tài khoản, hỏi đúng câu đó.

**Kết quả mong đợi**

- Bước 2 và bước 3: trả lời **gần như tức thì**, và con số **giống hệt** bước 1.
- Đo được 24/11/2026 trên hai lớp đã thêm đệm: `dien-dat` 1258 ms → 18 ms,
  `hieu-y` 703 ms → 7 ms.
- Con số vẫn phải là số THẬT: đệm chỉ giữ cách đặt truy vấn và câu chữ, còn truy
  vấn thì chạy lại trên kho mỗi lần.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TL-17 ◻ · Câu trả lời nhiều dòng không được thành một khối chữ

**Các bước**

1. Hỏi **"doanh thu theo ngày"** (dữ liệu có 26 ngày).

**Kết quả mong đợi**

- Câu trả lời đọc ra **6 ngày** rồi nói **"… và 20 dòng nữa"**, dài khoảng 240
  ký tự. Bản trước đọc 15 ngày và dài ~900 ký tự — một khối chữ không ai đọc
  trong bong bóng chat, và nó còn là lời nhắc đắt nhất gửi cho mô hình viết lại.
- Con số của 6 dòng đầu khớp §0.4: 26/10 = **3.305.000**, 13/10 = **2.120.000**,
  09/10 = **2.118.000**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

---

## §11 · Thanh toán và hạn mức

> **Đọc §0.3 trước.** Giá gói `pro` và `business` trên máy này **cùng 200 ₫** —
> đặt để chuyển khoản thử cho rẻ, không phải lỗi hiển thị. Số tài khoản nhận tiền
> là tài khoản **cá nhân thật** của chủ dự án, nên **đừng chuyển khoản thật**:
> dùng nút **Giả lập tiền về** ở console (`TT-03`).

### TT-01 ⭐ · Trang gói và mức dùng hiện tại

**Các bước**

1. Đăng nhập `mai@anhduong.vn` → `/billing`.

**Kết quả mong đợi**

- Gói hiện tại là **Miễn phí**.
- Thanh mức dùng cho thấy: **2/3 báo cáo** (sau §9), **1/1 workspace**, số thành viên, dung lượng.
- Ba gói hiện ra: Miễn phí (0 ₫) · Chuyên nghiệp (200 ₫) · Doanh nghiệp (200 ₫), kèm hạn mức từng gói.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TT-02 ⭐ · Tạo đơn hàng và mã QR

**Các bước**

1. Ở `/billing`, chọn gói **Chuyên nghiệp** → **Xác nhận đơn hàng**.
2. Ở trang đơn, **ghi lại mã đơn** (dạng `BIxxxxxxxx`).

**Kết quả mong đợi**

- Có **mã QR vẽ ra thật** (không phải ô xám trống).
- Trang nói đủ: số tiền **200 ₫**, số tài khoản, và yêu cầu **ghi đúng mã đơn vào lời nhắn**.
- Trạng thái đơn là **Chờ thanh toán**, có đồng hồ đếm ngược đang **chạy** (xem 10 giây, số phải giảm).

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TT-03 ⭐ · Tiền về thì màn hình tự đổi, không cần F5

*Hai tiến trình: một bên đổi dữ liệu, một bên đang xem.*

**Các bước**

1. **Giữ nguyên tab** đang mở trang đơn hàng ở TT-02.
2. Mở một cửa sổ khác, đăng nhập `admin@bi-platform.local` → `/admin` → đơn hàng.
3. Tìm đơn vừa tạo, bấm **Giả lập tiền về**.
4. Quay lại tab ở bước 1, **không bấm F5**, đợi tới 15 giây.

**Kết quả mong đợi**

- Tab ở bước 1 **tự** đổi sang **Đã nhận được tiền của bạn** / **Thanh toán thành công**.
- `/billing` của Ánh Dương giờ ghi gói **Chuyên nghiệp**, hạn mức báo cáo thành **50**, workspace thành **5**.
- Ngày hết hạn là 30 ngày kể từ hôm nay.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TT-04 ⭐ · Chốt hạn mức báo cáo của gói Miễn phí

*Phải chạy **trước** TT-03 nếu bạn đã nâng gói — hoặc hạ lại gói về Miễn phí trước
khi chạy ca này.*

**Các bước**

1. Bảo đảm Ánh Dương đang ở gói **Miễn phí** và đang có **2** báo cáo.
2. Tạo và lưu báo cáo thứ **3** (bất kỳ cấu hình nào), tên `Thu han muc`.
3. Mở menu tạo báo cáo lần nữa để tạo cái thứ **4**.
4. Xoá `Thu han muc` sau khi kiểm.

**Kết quả mong đợi**

- Báo cáo thứ 3: lưu được bình thường.
- Bước 3: menu **không còn** hai mục tạo báo cáo, thay vào đó là câu nói tổ chức
  đã dùng hết số báo cáo của gói — **nói ngay tại nút**, không phải để bạn dựng
  xong rồi mới báo khi bấm Lưu.
- Nếu bạn đi đường khác và bấm Lưu được, câu lỗi phải là:
  **"Gói Miễn phí cho tối đa 3 báo cáo, tổ chức đang có 3. Nâng cấp gói hoặc xoá bớt báo cáo cũ."**

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TT-05 ◻ · Huỷ đơn hàng

**Các bước**

1. Tạo một đơn mới (gói Doanh nghiệp), **không** giả lập tiền về.
2. Huỷ đơn đó.

**Kết quả mong đợi**

- Trạng thái thành **Đã huỷ**.
- Gói hiện tại **không đổi**.
- Đơn đã huỷ không thể huỷ lại hay thanh toán tiếp.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TT-06 ◻ · Lịch sử đơn hàng

**Các bước**

1. `/billing` → **Xem lịch sử đơn**.

**Kết quả mong đợi**

- Có cả ba đơn vừa tạo với trạng thái đúng: **Đã thanh toán**, **Đã huỷ**, và đơn nào còn **Chờ thanh toán**.
- Mỗi dòng có mã đơn, gói, số tiền, thời điểm.
- Bấm vào một dòng mở đúng trang đơn đó.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TT-07 ⭐ · Nâng gói để chạy §12

**Các bước**

1. Nếu TT-03 đã nâng gói lên **Chuyên nghiệp** thì bỏ qua ca này.
2. Nếu chưa: tạo đơn gói Chuyên nghiệp rồi **Giả lập tiền về** như TT-03.

**Kết quả mong đợi**

- Ánh Dương ở gói **Chuyên nghiệp**: tối đa **5 workspace · 50 báo cáo · 10 thành viên · 10 GB**.
- `/billing` hiện đúng bốn con số đó.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TT-08 ◻ · Người xem không vào được trang thanh toán

**Các bước**

1. Đăng nhập `viewer@bi-platform.local`, gõ thẳng `/billing`.

**Kết quả mong đợi**

- Bị chặn (403 hoặc chuyển trang), **không** thấy số tiền hay hạn mức của tổ chức.
- Sidebar của họ không có mục thanh toán.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TT-09 ◻ · Vượt hạn mức thì cảnh báo, không khoá

**Các bước**

1. Đọc câu cảnh báo trên thanh mức dùng khi một hạn mức bị vượt (nếu có; bạn có
   thể tạo tình huống bằng cách hạ gói sau khi đã có nhiều báo cáo).

**Kết quả mong đợi**

- Câu cảnh báo đại ý: **"Đã vượt hạn mức của gói. Bạn vẫn dùng được bình thường — nâng gói để có thêm chỗ."**
- Những thứ **đã có** vẫn mở và xem được; chỉ việc **tạo thêm** bị chặn.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

---

## §12 · Quản lý tổ chức

Cần Ánh Dương đã ở gói **Chuyên nghiệp** (xem TT-07).

### TC-01 ⭐ · Tạo, đổi tên, xoá workspace

**Các bước**

1. Quản lý tổ chức → tab Workspace → tạo `Kho miền Nam`.
2. Đổi tên nó thành `Miền Nam`.
3. Xoá nó.

**Kết quả mong đợi**

- Tạo được (gói Chuyên nghiệp cho 5). Ở gói Miễn phí, bước này phải bị chặn kèm
  câu **"Gói Miễn phí cho tối đa 1 workspace…"**.
- Đổi tên hiện ngay, còn sau F5.
- Xoá workspace **rỗng**: được, có bước xác nhận.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TC-02 ⭐ · Không xoá được workspace cuối cùng

**Các bước**

1. Thử xoá workspace duy nhất còn lại của Ánh Dương.

**Kết quả mong đợi**

- Bị **chặn**, câu báo nói tổ chức phải còn ít nhất một workspace.
- Chặn với **mọi** vai trò, kể cả quản trị viên.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TC-03 ◻ · Xoá workspace còn dữ liệu

**Các bước**

1. Tạo workspace `Tạm`, tải một tệp vào đó (qua trình hướng dẫn, chọn workspace `Tạm`).
2. Thử xoá workspace `Tạm`.

**Kết quả mong đợi**

- Bị chặn hoặc hỏi lại rất rõ, kèm **số lượng** bộ dữ liệu/báo cáo bên trong.
- Không có trường hợp xoá xong mới phát hiện mất dữ liệu.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TC-04 ⭐ · Mời thành viên mới và mật khẩu tạm

**Các bước**

1. Tab Thành viên → **Thêm người dùng**: email `thu-ngan@anhduong.vn`, họ tên
   `Nguyễn Thị Thu`, vai trò **Người tạo báo cáo**.
2. **Chép lại mật khẩu tạm** hiện ra.
3. Đăng xuất, đăng nhập bằng tài khoản mới đó.

**Kết quả mong đợi**

- Mật khẩu tạm hiện ra **đúng một lần**, có nút sao chép.
- Tài khoản mới đăng nhập được **ngay**, không cần xác minh email (Admin tự khai email).
- Có thể bị buộc đổi mật khẩu ở lần đầu — đúng thiết kế.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TC-05 ⭐ · Thành viên mới KHÔNG rơi vào màn hình trống

*Lỗi đã sửa: tài khoản vừa tạo đăng nhập vào thì thấy một hệ thống trống trơn,
không hiểu vì sao.*

**Các bước**

1. Vẫn đăng nhập bằng `thu-ngan@anhduong.vn`.
2. Mở Kho dữ liệu và Báo cáo.

**Kết quả mong đợi**

- **Thấy được** dữ liệu của Ánh Dương: bộ `ban-hang-thang-10`, hai báo cáo của §8.
- Vì tổ chức chỉ có **một** workspace, hệ thống tự cấp quyền thấy workspace đó.
- Nếu Ánh Dương đang có **nhiều** workspace thì ngược lại: người mới **không** tự
  thấy gì, Admin phải chọn workspace cho họ trong hộp Thêm người dùng. Cả hai đều đúng.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TC-06 ◻ · Cấp lại mật khẩu khi lỡ quên chép

**Các bước**

1. Về `mai@anhduong.vn`, tab Thành viên, chọn `Nguyễn Thị Thu` → cấp lại mật khẩu.
2. Đăng nhập bằng mật khẩu mới.

**Kết quả mong đợi**

- Mật khẩu mới hiện ra một lần.
- Mật khẩu **cũ không còn dùng được**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TC-07 ⭐ · Đổi vai trò, và không tự hạ quyền chính mình

**Các bước**

1. Đổi vai trò của `Nguyễn Thị Thu` sang **Người xem**, rồi sang **Quản trị viên**.
2. Thử đổi vai trò của **chính bạn** (`mai@anhduong.vn`) xuống Người xem.
3. Thử gỡ chính mình khỏi tổ chức.

**Kết quả mong đợi**

- Bước 1 đổi được; đăng nhập bằng Thu để xác nhận quyền đổi thật (Người xem thì mất nút hành động).
- Bước 2 và 3: **bị chặn** — không tự hạ quyền, không gỡ quản trị viên cuối cùng.
- Câu báo nói rõ **vì sao**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TC-08 ◻ · Gỡ thành viên

**Các bước**

1. Gỡ `Nguyễn Thị Thu` khỏi Ánh Dương.
2. Thử đăng nhập bằng tài khoản đó.

**Kết quả mong đợi**

- Họ không còn trong danh sách thành viên.
- Họ **vẫn đăng nhập được**, nhưng vào **không gian cá nhân** của riêng họ (tổ
  chức "Không gian của Nguyễn Thị Thu"), không thấy dữ liệu của Ánh Dương nữa.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### TC-09 ◻ · Đổi tên tổ chức

**Các bước**

1. Tab Tổ chức → đổi tên thành `Công ty Ánh Dương (KT)`.
2. Xem chân sidebar, rồi F5.
3. Đổi lại tên cũ.

**Kết quả mong đợi**

- Tên mới hiện ngay ở chân sidebar, còn sau F5.
- Tên hiện cả ở bộ chuyển tổ chức.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

---

## §13 · Console vận hành hệ thống

Đăng nhập `admin@bi-platform.local` / `Admin@12345`, vào `/admin`.

### HT-01 ⭐ · Tổng quan nhìn xuyên mọi tổ chức

**Các bước**

1. Mở `/admin`.

**Kết quả mong đợi**

- Thấy số tổng của **cả nền tảng**: số tổ chức, người dùng, bộ dữ liệu, báo cáo.
- Số tổ chức **không đếm** các không gian cá nhân (xem PQ-05).
- Có chuông/đếm số đơn hàng đang cần người vận hành nhìn.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### HT-02 ⭐ · Quản lý gói dịch vụ

**Các bước**

1. `/admin` → Gói dịch vụ. Xem giá ba gói.
2. Đổi giá gói **Chuyên nghiệp** thành `299000`, lưu, rồi xem lại `/billing` của Ánh Dương.
3. **Đổi về `200`** để các ca thanh toán sau còn chạy rẻ được.

**Kết quả mong đợi**

- Ba gói hiện với giá **0 / 200 / 200** như §0.3 (đây là chỗ sửa trước khi demo).
- Sau khi đổi giá, trang gói của tổ chức hiện giá mới.
- Hạn mức của **subscription đang chạy không bị đổi theo** — hạn mức được chốt lúc mua.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### HT-03 ⭐ · Phương thức thanh toán

**Các bước**

1. `/admin` → Phương thức thanh toán.

**Kết quả mong đợi**

- Thấy số tài khoản và tên chủ tài khoản đang dùng.
- **Trước khi demo cho người khác xem:** đổi hai giá trị này — hiện tại là tài
  khoản cá nhân thật của chủ dự án, và nó hiện nguyên văn trên trang thanh toán
  của **mọi** tổ chức.
- Sửa được và lưu được ngay tại đây, không phải sửa trong mã nguồn.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### HT-04 ◻ · Danh sách đơn hàng và xác nhận tay

**Các bước**

1. `/admin` → Đơn hàng. Lọc theo trạng thái **Chờ đối chiếu**.
2. Với một đơn đang chờ, bấm **Xác nhận** (xác nhận đã nhận tiền).

**Kết quả mong đợi**

- Bộ lọc theo trạng thái, theo phương thức, và ô tìm theo mã đơn đều hoạt động.
- Sau khi xác nhận: đơn thành **Đã thanh toán**, và subscription của tổ chức đó bật lên.
- Trang của tổ chức (nếu đang mở) tự nhận trạng thái mới.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### HT-05 ◻ · Danh sách tổ chức và người dùng

**Các bước**

1. `/admin` → Tổ chức: tìm `Ánh Dương`, mở chi tiết.
2. `/admin` → Người dùng: tìm `mai@anhduong.vn`.

**Kết quả mong đợi**

- Chi tiết tổ chức cho biết gói, số thành viên, số workspace.
- Trang người dùng cho biết họ thuộc tổ chức nào với vai trò gì.
- Tìm kiếm, phân trang, sắp xếp đều hoạt động và **còn sau F5**.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### HT-06 ⭐ · Khoá một tổ chức thì thành viên mất phiên

**Các bước**

1. Mở một cửa sổ khác, đăng nhập `hanh@saomai.vn`, đứng ở **Công ty Sao Mai**.
2. Ở console, **khoá** tổ chức Công ty Sao Mai.
3. Ở cửa sổ kia, bấm sang một trang khác.
4. **Mở khoá** lại tổ chức đó.

**Kết quả mong đợi**

- Bước 3: bị đưa ra khỏi tổ chức đã khoá — về `/login` hoặc sang tổ chức khác mà họ còn quyền.
- **Không** còn đọc được dữ liệu của tổ chức bị khoá.
- Sau bước 4: họ vào lại được bình thường.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### HT-07 ◻ · Không tự khoá và không tự xoá chính mình

**Các bước**

1. Ở `/admin` → Người dùng, thử khoá tài khoản `admin@bi-platform.local` (chính bạn).
2. Thử khoá tổ chức **Open Insight** (tổ chức của chính bạn).

**Kết quả mong đợi**

- Cả hai **bị chặn**, câu báo nói rõ không tự khoá chính mình.
- Không có đường nào tự đẩy mình ra khỏi console.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### HT-08 ◻ · Trang tình trạng hệ thống

**Các bước**

1. Mở `/system-health`.
2. `docker stop bi-redis`, F5 trang đó, rồi `docker start bi-redis`.

**Kết quả mong đợi**

- Liệt kê các thành phần (MySQL, Redis, ClickHouse, MinIO, Cube) với trạng thái.
- Sau khi tắt Redis: thành phần đó báo **lỗi**, bằng chữ, và trang **vẫn mở được**.
- Sau khi bật lại: về xanh.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

---

## §14 · Điện thoại và các ca biên

### CB-01 ⭐ · Bố cục trên màn 390 px

*Lỗi đã sửa: ô biểu đồ **lớn dần vô hạn** — đo được 684 → 1.128 → 1.740 → 2.370
→ 3.318 px — vì biểu đồ cao theo hộp chứa, hộp chứa cao theo nội dung.*

**Các bước**

1. DevTools → chế độ thiết bị, chọn iPhone (bề rộng **390 px**).
2. Mở báo cáo `Doanh thu tháng 10`.
3. Cuộn xuống rồi cuộn lên, **ba lần**. Nhìn chiều cao ô biểu đồ.

**Kết quả mong đợi**

- Ô biểu đồ cao **không quá 60% chiều cao màn hình**, và **đứng yên** qua cả ba
  lần cuộn — không lớn thêm sau mỗi lần.
- Trang **không** cuộn ngang.
- Hai ô nằm trên nhau (một cột), không bị ép ngang thành dải mỏng.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### CB-02 ⭐ · Nút trên thanh tiêu đề báo cáo không lọt ra ngoài màn hình

*Lỗi đã sửa: nút "Chỉnh sửa" nằm ở toạ độ x = 366…461 trên màn rộng 390 px.*

**Các bước**

1. Vẫn ở 390 px, mở trang xem báo cáo.
2. Thử **bấm** từng nút trên thanh tiêu đề (chỉnh sửa, chia sẻ, xuất…).

**Kết quả mong đợi**

- **Mọi** nút nhìn thấy được và bấm được, không nút nào bị cắt ở mép phải.
- Thanh tiêu đề xuống dòng nếu cần, chiều cao tự giãn.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### CB-03 ⭐ · Trợ lý dữ liệu trên điện thoại

**Các bước**

1. Vẫn 390 px, tìm nút **Trợ lý dữ liệu** ở góc phải dưới. Mở ra, gõ một câu.

**Kết quả mong đợi**

- Nút vẫn có **chữ** (không chỉ hình tròn) và nằm trong màn hình.
- Khung mở ra không che hết trang, thu lại được.
- Bàn phím ảo hiện ra không làm ô gõ bị đẩy ra ngoài.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### CB-04 ◻ · Trình hướng dẫn tải tệp trên điện thoại

**Các bước**

1. Vẫn 390 px, mở trình hướng dẫn, tải `ban-hang-thang-10.csv`.
2. Đi qua cả ba bước.

**Kết quả mong đợi**

- Thanh ba bước đọc được, không chồng chữ.
- Bảng cột ở bước 2 cuộn ngang **trong khung của nó**, trang không cuộn ngang.
- Nút ở bước 3 bấm được.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### CB-05 ⭐ · Bảng rộng thì bảng cuộn, trang không cuộn

**Các bước**

1. Ở màn 390 px, mở báo cáo `Bảng chi tiết` và trang chi tiết bộ dữ liệu (8 cột).

**Kết quả mong đợi**

- Bảng có thanh cuộn ngang **riêng**.
- Trang (`body`) **không** cuộn ngang — mép phải không có khoảng trắng kéo được.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### CB-06 ⭐ · F5 giữa chừng không mất bộ lọc

**Các bước**

1. Về màn hình máy tính. Ở Kho dữ liệu: gõ từ khoá tìm kiếm, đổi sắp xếp, sang trang 2 (nếu có).
2. Bấm **F5**.
3. Bấm **Back** của trình duyệt.

**Kết quả mong đợi**

- Sau F5: từ khoá, thứ tự sắp xếp, số trang **vẫn còn** (chúng nằm trên URL).
- Back trở về trạng thái trước đó, không về trang trắng.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### CB-07 ◻ · Mất mạng giữa chừng

**Các bước**

1. DevTools → Network → **Offline**.
2. Bấm sang một trang khác, rồi thử lưu một thay đổi.
3. Bật mạng lại, thử lại.

**Kết quả mong đợi**

- Có câu báo **bằng tiếng Việt** nói mất kết nối, kèm cách làm lại.
- **Không** trang trắng, không vòng xoay vĩnh viễn, không mất nội dung đang gõ.
- Sau khi có mạng, thao tác lại thành công.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### CB-08 ◻ · Bấm hai lần liên tiếp không tạo hai bản

**Các bước**

1. Ở một hộp thoại tạo (thư mục, workspace, thành viên), bấm nút xác nhận **hai lần rất nhanh**.

**Kết quả mong đợi**

- Chỉ **một** bản được tạo.
- Nút tự khoá trong lúc đang gửi.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### CB-09 ◻ · Chữ tiếng Việt và dấu

**Các bước**

1. Đặt tên một báo cáo là `Báo cáo doanh thu — Quý 4/2026 (đã duyệt)`.
2. Đặt tên một thư mục có dấu và khoảng trắng: `Kho dữ liệu cũ`.
3. Xuất báo cáo đó ra Excel và PNG.

**Kết quả mong đợi**

- Dấu tiếng Việt hiện đúng ở mọi nơi: danh sách, tiêu đề trang, tên tệp tải về.
- Trong tệp Excel và ảnh PNG, chữ có dấu **không** thành ô vuông hay dấu hỏi.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

### CB-10 ◻ · Phím Tab đi hết được một trang

**Các bước**

1. Ở trang đăng nhập, rồi ở trình dựng báo cáo: chỉ dùng **Tab** và **Enter**, không dùng chuột.

**Kết quả mong đợi**

- Mọi ô nhập và nút đều **tới được** bằng Tab.
- Luôn thấy được **viền tiêu điểm** (focus) ở phần tử đang chọn.
- Đăng nhập được mà không cần chuột.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |

---

## §15 · Sau khi kiểm xong

### Dọn lại sân kiểm thử

Nếu muốn trả Ánh Dương về trạng thái rỗng như §0.3:

```bash
# Xem đang còn gì
# Mật khẩu lấy từ biến môi trường CỦA container, không gõ vào lệnh.
docker exec bi-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -t bi_platform -e "
  SELECT (SELECT COUNT(*) FROM datasets   WHERE tenant_id=2) bo_dl,
         (SELECT COUNT(*) FROM reports    WHERE tenant_id=2) bao_cao,
         (SELECT COUNT(*) FROM datamodels WHERE tenant_id=2) mo_hinh"'
```

Xoá bằng **giao diện** (xoá báo cáo → mô hình → bộ dữ liệu) chứ không xoá thẳng
trong database: đường qua giao diện cũng là đường dọn các bảng trong kho phân
tích và các tệp trên MinIO.

Tài khoản `thu-nghiem-01@vidu.vn`, `thu-nghiem-02@vidu.vn`, `thu-ngan@anhduong.vn`
do bộ test tạo ra — gỡ chúng ở `/admin` → Người dùng nếu không cần nữa.

### Những giới hạn ĐÃ BIẾT — gặp thì không tính là lỗi

| Hiện tượng | Vì sao |
|---|---|
| Dòng `TỔNG CỘNG` trong tệp Excel được nạp như một dòng dữ liệu, làm tổng gấp đôi | Nhận diện dòng tổng cần đoán nhiều; bỏ nhầm một dòng dữ liệu thật tệ hơn giữ thừa một dòng người dùng nhìn thấy trong bảng xem trước |
| Cột ngày trong tệp Excel xuất ra là **chữ**, không phải kiểu Date | Chưa làm |
| Cột tiền kiểu Việt **không** tròn nghìn (ví dụ `12.180`) vẫn phải tự tích tay | Tín hiệu `.000` mới đủ mạnh để đoán sẵn |
| Xoá bộ dữ liệu đang được mô hình dùng **không bị chặn** | Nợ có chủ đích, ghi trong `deleteDataset.ts` (mục 8.10) |
| Không có nút khôi phục bộ dữ liệu đã xoá | Xoá mềm có ở tầng dữ liệu, chưa có ở giao diện |
| Nút đăng nhập Google trả lỗi origin trên `localhost:5173` | Origin chưa khai trong Google Cloud Console |
| Gói `pro` và `business` cùng giá 200 ₫ | Giá đặt để thử chuyển khoản; sửa ở `/admin` → Gói dịch vụ trước khi demo |
| Đồng nghiệp sửa mô hình ở máy khác thì trình dựng chỉ biết khi một ô **hỏi lại** | Thiết kế hiện tại |

### Ghi lại kết quả

| | |
|---|---|
| Người kiểm | |
| Ngày kiểm | |
| Phiên bản / commit | |
| Số ca Đạt / Tổng | |
| Số ca ⭐ không đạt | |

**Một ca ⭐ không đạt là một việc phải sửa trước khi demo.** Ghi lại theo đúng ba
mục ở §0.5 thì mỗi ca không đạt đã là một báo cáo lỗi dùng được ngay.
