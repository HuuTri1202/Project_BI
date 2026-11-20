# Kiểm thử

Thư mục này chứa **một** thứ: bộ test case để một người ngồi bấm tay trên trình
duyệt, cùng dữ liệu để chạy nó.

| File | Là gì |
|---|---|
| [bo-test-case.md](bo-test-case.md) | **137 ca kiểm thử tay**, 73 ca bắt buộc. Các bước · kết quả mong đợi · ô ghi kết quả thực tế |
| `du-lieu-thu/` | 9 tệp dữ liệu để tải lên. Đáp án của từng tệp ghi sẵn ở `§0.4` của tài liệu trên |

## Bản bấm được

Cùng 137 ca đó, dựng thành một trang để mở trên màn hình thứ hai trong lúc test:

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

Không đủ thời gian chạy hết? Chạy riêng 73 ca đánh dấu ⭐ (khoảng 2,5 giờ) — đó
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
