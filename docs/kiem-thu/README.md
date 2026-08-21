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

**Không chạy song song với bộ tự động.** Hàm dọn của bộ tự động
(`backend/tests/helpers/db.ts:63`) xoá mọi khoá `ratelimit:*` trước mỗi ca, nên
bộ đếm chặn dò mật khẩu bị xoá liên tục và phép đo mất hết ý nghĩa. Lần chạy đầu
tiên đã mắc đúng bẫy này: XT-21 báo "không thấy bị chặn" suốt 14 lần thử, còn
XT-04 báo lệch thời gian 99%. Cả hai đều sai.

`mod-luongdulieu.mjs` **ghi dữ liệu thật** vào tổ chức id 2 (Công ty Ánh Dương)
rồi tự dọn ở cuối. Nếu nó chết giữa chừng, dọn tay bằng cách xoá bộ dữ liệu và
mô hình còn lại trong tổ chức đó.

### 3. Sinh lại bản Markdown

```bash
python docs/kiem-thu/xuat-markdown.py \
  docs/kiem-thu/bo-test-case.html \
  docs/kiem-thu/bo-test-case.md
```

## Sửa tài liệu

Sửa `bo-test-case.html` rồi chạy lại bước 3. Đừng sửa `bo-test-case.md` — lần
sinh sau sẽ ghi đè, và trước khi bị ghi đè thì hai bản đã nói hai điều khác nhau.
