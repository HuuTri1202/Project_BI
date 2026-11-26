# Kiểm thử

Có **hai** bộ, và chúng bù nhau chứ không thay nhau:

| Bộ | Chạy bằng | Mất bao lâu | Bắt loại lỗi nào |
|---|---|---|---|
| **Quét tự động** | `npm run quet` | 3–7 phút | thứ máy kiểm được mà người không kiểm lại nổi: mọi route × mọi vai, 480 payload rác, cách ly giữa các tổ chức |
| **Bấm tay** | [bo-test-case.md](bo-test-case.md) | ~2,5 giờ (82 ca ⭐) | thứ máy không phán được: biểu đồ vẽ có đúng không, câu chữ có dễ hiểu không, luồng có mạch lạc không |

Chạy `npm run quet` sau **mỗi** lần sửa mã. Bộ bấm tay để trước khi demo hoặc nộp.

| File | Là gì |
|---|---|
| [`scripts/quet/`](../../scripts/quet/) | Bộ quét tự động — xem `npm run quet -- --help` |
| [bo-test-case.md](bo-test-case.md) | **148 ca kiểm thử tay**, 82 ca bắt buộc. Các bước · kết quả mong đợi · ô ghi kết quả thực tế |
| `du-lieu-thu/` | 9 tệp dữ liệu để tải lên. Đáp án của từng tệp ghi sẵn ở `§0.4` của tài liệu trên |
| [do-phu-hoi-dap.md](do-phu-hoi-dap.md) | **Bộ đánh giá trợ lý dữ liệu** — `npm --workspace frontend run danh-gia`. Vòng lặp đo độ phủ thay cho vá từng ca |

## Quét tự động — `npm run quet`

Cần `npm run dev` đang chạy; mục `luồng` cần cả `npm run infra:up:bi`.

```
npm run quet              # cả 4 mục
npm run quet -- doc ghi   # chỉ hai mục đó
npm run quet -- --help
```

| Mục | Kiểm gì |
|---|---|
| `doc` | 174 lời gọi đọc × 4 vai: không 5xx, `/admin` chỉ superadmin, tổ chức khác không đọc được dữ liệu của tổ chức này |
| `ghi` | 480 payload rác trên 48 endpoint ghi: không bao giờ 5xx. Cộng 4 mặt không cần đăng nhập |
| `luong` | Một vòng nghiệp vụ thật: nạp tệp → mô hình → báo cáo → hỏi đáp, rồi **tự dọn và kiểm lại là đã sạch** |
| `trang` | 27 trang trong Chrome headless: không exception, không request 5xx, không trang trắng |

Thoát `0` khi tất cả đạt, `1` khi có mục trượt, `2` khi không chạy nổi — nên gắn
được vào CI.

⚠️ **"bỏ qua" không phải "đạt".** Thiếu Chrome, thiếu `LLM_API_KEY`, hay một tài
khoản không đăng nhập được đều làm phép kiểm liên quan BỎ QUA và nói ra lý do.
Một dòng `·` nghĩa là chỗ đó **chưa được kiểm**.

Bộ này chỉ chạy với `localhost` và sẽ tự từ chối nếu `QUET_API` trỏ ra ngoài: mục
`ghi` bơm dữ liệu rác và mục `luồng` tạo rồi xoá dữ liệu thật.

### Một bộ dữ liệu được cố ý để lại

Trong danh sách bộ dữ liệu sẽ có **`QUET-MOC — bo du lieu cua bo quet, dung xoa`**.
Đó không phải rác bỏ quên: mục `luồng` cần một tệp thật để nạp, và xoá bộ dữ liệu
là xoá **mềm** nên dòng ấy cùng bảng `raw_*` của nó nằm lại vĩnh viễn (janitor chỉ
dọn bảng không còn dòng nào trỏ tới — xem `dropTables.ts`). Tạo mới mỗi lần chạy
thì mỗi lần để lại một dòng và một bảng; **đo được: 1,77 KiB mỗi lần, không bao
giờ được thu hồi**.

Nên bộ quét giữ đúng một bộ mốc và **thay tệp** của nó (`capNhat`) ở những lần sau.
Dấu chân kho phân tích không đổi dù chạy bao nhiêu lần — đã kiểm: 9 lần chạy,
số bảng `raw_*` không nhúc nhích. Xoá bộ mốc bằng tay cũng được, lần chạy tới
sẽ tự tạo lại — nhưng chính lần xoá đó mới để lại một bảng mồ côi.

Mỗi lần `capNhat` tải lên một tệp mới và bỏ lại tệp cũ trong kho đối tượng.
Chỗ đó **tự lành**: janitor `sweepOrphanFiles` dọn mọi tệp quá 24 giờ mà MySQL
không còn dòng nào nhận (xem §9 của README gốc). Dấu chân kho đối tượng vì thế
cũng là hằng số, chỉ trễ một ngày.

**Cái còn lại, nói thẳng:** mỗi lần chạy để lại **2 dòng xoá mềm** trong MySQL
(một `datamodels`, một `reports`) vì mục `luồng` tạo rồi xoá chúng để kiểm cả
đường tạo lẫn chốt "xoá mô hình còn báo cáo". Chúng không hiện trên giao diện,
không chiếm dung lượng kho, và đúng bằng thứ một người dùng tạo-rồi-xoá cũng để
lại — nhưng chúng tăng, một chiều.

Vì sao không gỡ nốt bằng cách dùng mô hình/báo cáo mốc như với bộ dữ liệu: xoá ở
hệ này là xoá MỀM, nên **mọi** lần xoá đều để lại một dòng. Không còn dòng nào
nghĩa là không bao giờ xoá, tức mất luôn phép kiểm `POST /datamodels`,
`POST /reports/from-datamodel` và chốt 409 — đổi một trong những phép kiểm giá
trị nhất lấy chừng một kilobyte mỗi lần chạy. Dọn được bằng tay nếu thấy nhiều:

```sql
DELETE FROM reports    WHERE name LIKE 'QUET-%' AND deleted_at IS NOT NULL;
DELETE FROM datamodels WHERE name LIKE 'QUET-%' AND deleted_at IS NOT NULL;
```

### Khi máy hết RAM thì bộ quét báo đỏ thật

Đã gặp: chạy đồng thời app + SigNoz + Chrome headless làm WSL2 cạn RAM, `SELECT 1`
trên ClickHouse mất **38 giây**, healthcheck 5 giây trượt nên container thành
`unhealthy`, lần nạp dữ liệu `failed` và 6 phép kiểm đỏ. Không có gì sai trong mã
nguồn. Tắt SigNoz (`docs/quan-trac.md` §2.5) là ClickHouse về `healthy` ngay.

Nên khi thấy mục `luồng` hoặc `trang` đỏ hàng loạt, xem `npm run infra:ps` trước
khi đi tìm lỗi trong code.

Nó kiểm **bất biến**, không so với một bảng mã trả về chốt sẵn — lý do ghi ở đầu
[`scripts/quet/lib.mjs`](../../scripts/quet/lib.mjs), cùng hai lần chính bất biến
bị đặt sai và đã phải sửa.

## Bản bấm được

Cùng 148 ca đó, dựng thành một trang để mở trên màn hình thứ hai trong lúc test:

**https://claude.ai/artifact/VSomCtDa3JrJc5C6H5fpm1**

Mỗi ca có hai nút Đạt / Không đạt và một ô ghi chú; kết quả lưu ngoài trang nên
đóng tab hay đổi máy vẫn còn. Thanh đầu trang đếm số ca đã đạt và số ca ⭐ chưa
đạt, lọc được theo "chỉ ca ⭐" / "chưa làm" / "không đạt", và nút **Sao chép kết
quả** sinh ra một bảng Markdown của các ca chưa đạt để dán vào báo cáo.

Trang đọc nội dung từ chính `bo-test-case.md`, nên **sửa tài liệu thì phải dựng
lại trang** — hai bản không tự đồng bộ.

## Cách dùng

Mở `bo-test-case.md`, làm theo `§0 · Chuẩn bị`, rồi đi từ §1 tới §14 **theo đúng
thứ tự** — các phần sau dùng dữ liệu do phần trước tạo ra, và §12 cần gói đã
được nâng ở §11.

Điền kết quả trực tiếp vào bảng hai cột dưới mỗi ca. In ra giấy cũng được.

Không đủ thời gian chạy hết? Chạy riêng 82 ca đánh dấu ⭐ (khoảng 2,5 giờ) — đó
là bộ tối thiểu nên chạy lại sau mỗi lần sửa mã.

## Đáp án đến từ đâu

Mọi con số trong phần "kết quả mong đợi" được **tính bằng máy** trên chính các
tệp trong `du-lieu-thu/`, không phải ghi theo trí nhớ. Nên màn hình cho số khác
là lỗi thật, không phải tài liệu sai.

Dữ liệu được sinh bằng một script có hạt giống cố định (`20261120`): chạy lại
cho ra đúng bộ số đó. Nếu phải sinh lại hoặc đổi dữ liệu, sinh lại **cả** đáp án
trong `§0.4` cùng lúc — hai thứ đó chỉ đúng khi đi cùng nhau.

## Không còn bộ kiểm thử tự động

Toàn bộ tầng test tự động (vitest, Playwright, các script gọi API) đã được gỡ
khỏi mã nguồn ngày 20/11/2026 theo yêu cầu dọn dẹp — xem commit
`chore(kiem-thu): gỡ toàn bộ tầng test khỏi mã nguồn`. Lịch sử git còn đủ: lấy
lại bằng `git show <commit>^:backend/tests/...`.

Cổng kiểm tra còn lại trong repo là:

```bash
npm run verify     # lint + typecheck + build
```

Nó bắt được lỗi kiểu và lỗi cú pháp, **không** bắt được lỗi hành vi. Bộ test case
trong thư mục này là lớp duy nhất còn lại làm việc đó, nên một ca ⭐ không đạt
nghĩa là có thứ cần sửa trước khi demo.
