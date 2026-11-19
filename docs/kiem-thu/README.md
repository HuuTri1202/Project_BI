# Kiểm thử

Thư mục này chứa bộ test case của hệ thống và **cách chạy lại nó**. Một tài liệu
kiểm thử mà không ai dựng lại được kết quả thì chỉ là một bảng chữ.

| File | Là gì |
|---|---|
| [bo-test-case.md](bo-test-case.md) | Hồ sơ kiểm thử — bản Markdown để chép vào báo cáo. **Sinh tự động, đừng sửa tay** |
| `bo-test-case.html` | Bản gốc của hồ sơ, cũng là bản duy nhất được sửa |
| [kich-ban-trinh-duyet.md](kich-ban-trinh-duyet.md) | **51 kịch bản bấm tay trên trình duyệt** — cũng sinh tự động |
| `kich-ban-trinh-duyet.html` | Bản gốc của kịch bản. Mở bằng trình duyệt thì có ô đánh dấu Đạt/Không đạt, lưu ngay trong máy |
| `du-lieu-thu/` | Hai file CSV mẫu, đáp án ghi sẵn trong kịch bản |
| `xuat-markdown.py` · `xuat-kich-ban-md.py` | Sinh hai bản Markdown từ hai bản HTML |
| `kich-ban/` | Bộ kịch bản **tự động** gọi thẳng vào API đang chạy |

## Tự kiểm thử trên trình duyệt

Mở `kich-ban-trinh-duyet.html` bằng trình duyệt rồi làm theo từ §0. Mỗi kịch bản
có hai nút Đạt / Không đạt và một ô ghi chú; đánh dấu được lưu trong trình duyệt
nên đóng tab mở lại vẫn còn, và thanh tiến độ ở đầu trang cho biết đã làm tới
đâu. In ra giấy cũng được — bản in tự ẩn các nút bấm.

Hai file trong `du-lieu-thu/` là dữ liệu để tải lên. Con số đáp án trong kịch bản
đã được nạp thật một lượt rồi truy vấn lại từ ClickHouse, nên màn hình cho số
khác nghĩa là lỗi thật.

## Hai nguồn kết quả

Cột *kết quả thực tế* trong tài liệu đến từ hai chỗ, và tài liệu ghi rõ ca nào
thuộc chỗ nào:

- **Gọi API thật** (73 ca) — `kich-ban/` gọi `localhost:4000` bằng tài khoản
  thật, rồi đối chiếu với ClickHouse và Redis. Cột kết quả chép nguyên văn thứ
  server trả về.
- **Đối chiếu bộ tự động** (64 ca) — mỗi ca trỏ tới một ca trong
  `backend/tests/` hoặc `frontend/tests/`.

## Chạy lại

### 1. Bộ tự động

```bash
npm run test              # 137 ca backend + 24 ca frontend, không cần hạ tầng
npm run test:integration  # 417 ca, cần MySQL — BỎ QUA nhánh ClickHouse

# Đầy đủ, gồm cả nhánh chạm ClickHouse thật (cần npm run infra:up):
npm --workspace backend run test:integration:ch
```

> ⚠️ `test:integration` **không** chạy 14 ca ClickHouse — nạp, nạp lại, hoán đổi
> nguyên tử, janitor. Đó là lý do hai ca trong số đó đã mâu thuẫn với thiết kế
> suốt nhiều tháng mà không ai biết (V-01).
>
> Cổng này được giữ tường minh chứ không đổi thành tự dò rồi lặng lẽ bỏ qua —
> skip ngầm khiến một lần chạy bỏ sót phần quan trọng nhất vẫn hiện màu xanh.
> Thay vào đó, suite **in cảnh báo** mỗi lần bỏ qua, kèm đúng câu lệnh cần gõ.

### 2. Bộ gọi API thật

Cần backend đang chạy (`npm run dev`) và đủ 5 container (`npm run infra:up`).

```bash
cd docs/kiem-thu/kich-ban
node mod-xacthuc.mjs      # XT — xác thực, 21 ca
node mod-phanquyen.mjs    # PQ + AT — phân quyền và an toàn, 22 ca
node mod-luongdulieu.mjs  # TF + NA + MH — luồng đầu-cuối, 17 ca
node mod-thuocdo.mjs      # TD — thước đo của mô hình dữ liệu, 19 ca
```

Bốn lệnh trên chạy được **theo đúng thứ tự này**, và trước đây thì không: `XT-21`
cố ý đăng nhập sai 13 lần để chứng minh chốt chặn dò mật khẩu có thật, rồi để lại
bộ đếm ở mức 13 với TTL ~15 phút. Ba module sau không dọn bộ đếm đó nên module
thứ hai chết ngay ở lời gọi `login` đầu tiên với HTTP 429. Giờ `login` trong
`kiemchung.mjs` tự dọn bộ đếm trước khi lấy token — và `XT-21` vẫn đo nguyên vẹn,
vì nó gọi `/auth/login` trực tiếp chứ không qua `login`.

Hai ca `AT-06`/`AT-07` nói ra **trạng thái môi trường** chứ không phán xét:
`ALLOW_PRIVATE_DB_HOSTS` mặc định BẬT ở dev (máy dev nối MySQL qua dải riêng),
nên chốt SSRF không chặn ở đây và chúng chỉ khẳng định "không nối được tới địa
chỉ nội bộ". Bản thân LUẬT chặn được chứng minh ở
`backend/tests/guardHost.test.ts` — 33 ca, kiểm thẳng hàm thuần `blockedReason`
nên không phụ thuộc cờ môi trường.

**Không chạy song song với bộ tự động.** Hàm dọn của bộ tự động
(`backend/tests/helpers/db.ts:63`) xoá mọi khoá `ratelimit:*` trước mỗi ca, nên
bộ đếm chặn dò mật khẩu bị xoá liên tục và phép đo mất hết ý nghĩa. Lần chạy đầu
tiên đã mắc đúng bẫy này: XT-21 báo "không thấy bị chặn" suốt 14 lần thử, còn
XT-04 báo lệch thời gian 99%. Cả hai đều sai.

`mod-luongdulieu.mjs` **ghi dữ liệu thật** vào tổ chức id 2 (Công ty Ánh Dương)
rồi tự dọn ở cuối. Nếu nó chết giữa chừng, dọn tay bằng cách xoá bộ dữ liệu và
mô hình còn lại trong tổ chức đó.

### 3. Bộ trình duyệt thật (Playwright)

```bash
npm run e2e          # chạy ngầm
npm run e2e:ui       # mở bảng điều khiển, xem từng bước
```

Tự khởi động cả hai server (`npm run dev:api`, `npm run dev:web`) nếu chúng chưa
chạy, và dùng lại nếu đã chạy. Cần 5 container (`npm run infra:up`).

**Nó bù vào chỗ nào.** Frontend đã có 873 ca React Testing Library trên jsdom —
đừng viết lại chúng ở đây. Chỗ duy nhất đáng dùng trình duyệt thật là những việc
jsdom không làm được: Vega-Lite vẽ thật, tải tệp qua Uppy lên S3, xuất PDF/Excel
ra tệp, kéo thả trên canvas, và **chia chunk** — `React.lazy` có thật sự tách và
tải được qua HTTP hay không.

Điểm cuối không phải lý thuyết. Ca đầu tiên (`e2e/dang-nhap.spec.ts`) tìm ra ngay
một lỗi mà cả 873 ca jsdom lẫn 777 ca backend đều không thấy: khung hỏi đáp xin
`pageSize=200` trong khi máy chủ chặn ở 100, nên **cả ba** truy vấn ngữ cảnh của
nó trả 400 và nó trả lời như thể tổ chức chưa có dữ liệu gì. Test frontend mock
API nên không thấy; test backend không mở màn hình nên cũng không thấy.

**Chạy trên database dev.** `webServer` khởi động chính `npm run dev:api`, nên nó
đọc `backend/.env`. Ca nào GHI dữ liệu thì phải tự dọn, đúng như bộ kịch bản ở
mục 2. `workers: 1` vì các ca dùng chung một database.

**Quan sát cần biết:** trên `http://localhost:5173`, nút đăng nhập Google (§1.9)
trả 403 kèm `[GSI_LOGGER]: The given origin is not allowed for the given client
ID` — origin này chưa nằm trong danh sách cho phép của client ID ở Google Cloud
Console. Không phải lỗi mã, và đăng nhập bằng mật khẩu không bị ảnh hưởng.

### 4. Sinh lại bản Markdown

```bash
python docs/kiem-thu/xuat-markdown.py \
  docs/kiem-thu/bo-test-case.html \
  docs/kiem-thu/bo-test-case.md
```

## Sửa tài liệu

Sửa `bo-test-case.html` rồi chạy lại bước 3. Đừng sửa `bo-test-case.md` — lần
sinh sau sẽ ghi đè, và trước khi bị ghi đè thì hai bản đã nói hai điều khác nhau.
