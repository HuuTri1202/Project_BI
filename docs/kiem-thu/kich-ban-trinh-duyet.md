# Kịch bản kiểm thử trình duyệt — BI Platform

> Sinh tự động từ `kich-ban-trinh-duyet.html`. **Đừng sửa tay** —
> sửa file HTML rồi chạy lại `xuat-kich-ban-md.py`.

Tổng cộng **52 kịch bản**. Hai ô cuối mỗi mục để người kiểm điền.


## §0 · Chuẩn bị


## §1 · Đăng nhập và tài khoản


### A1 · Đăng nhập đúng

*Đường vào cơ bản nhất — hỏng cái này thì không thử được gì nữa*

- **Tài khoản:** mai@anhduong.vn / Matkhau@123

**Các bước:**

1. Mở http://localhost:5173
2. Nhập email và mật khẩu, bấm đăng nhập

**Kết quả mong đợi:**

- Vào thẳng Trang chủ, không nhảy vào /admin
- Sidebar hiện đủ: Trang chủ · Kho dữ liệu · Mô hình dữ liệu · Quản lý tổ chức
- Chân sidebar hiện tên Lê Thị Mai và tổ chức Công ty Ánh Dương

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### A2 · Sai mật khẩu và email không tồn tại phải giống hệt nhau

*Nếu hai câu khác nhau, kẻ tấn công dò được email nào đã đăng ký*

**Các bước:**

1. Đăng xuất. Nhập mai@anhduong.vn với mật khẩu SaiBet@999 → ghi lại câu báo lỗi
2. Nhập khongtontai@vidu.vn với cùng mật khẩu sai → ghi lại câu báo lỗi

**Kết quả mong đợi:**

- Hai câu giống nhau từng chữ: “Email hoặc mật khẩu không đúng.”
- Không có câu nào kiểu “email này chưa đăng ký”

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### A3 · Chặn dò mật khẩu

*Sai liên tục thì phải bị khoá tạm*

**Các bước:**

1. Nhập sai mật khẩu 11 lần liên tiếp cho cùng một email

**Kết quả mong đợi:**

- Từ lần thứ 11, câu báo đổi thành “Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.”
- Đăng nhập đúng lúc này cũng bị chặn — bộ đếm tính theo địa chỉ máy, không theo tài khoản

> ⚠️ Sau khi thử xong, chờ 15 phút hoặc chạy lệnh này để mở khoá ngay, nếu không các kịch bản sau sẽ không đăng nhập được:

> ⚠️ docker exec bi-redis redis-cli -a redispassword --no-auth-warning KEYS "ratelimit:login:*" rồi DEL khoá vừa thấy.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### A4 · Luật mật khẩu khi đăng ký

*Form phải nói rõ sai chỗ nào*

**Các bước:**

1. Mở trang đăng ký, điền đủ thông tin
2. Thử lần lượt ba mật khẩu: matkhau123 (không chữ hoa) · Ab1 (quá ngắn) · Matkhau@123 nhưng ô nhập lại gõ Matkhau@456

**Kết quả mong đợi:**

- Lỗi hiện ngay dưới đúng ô sai, không phải một câu chung ở đầu form
- Ba câu khác nhau: thiếu chữ hoa · tối thiểu 8 ký tự · mật khẩu nhập lại không khớp

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### A5 · Đăng ký tài khoản mới tạo luôn một tổ chức

*Người tự đăng ký là quản trị viên công ty mình vừa lập*

**Các bước:**

1. Đăng ký với email chưa từng dùng, tên công ty Công ty Kiểm Thử
2. Sau khi đăng ký xong, đăng nhập bằng chính tài khoản đó

**Kết quả mong đợi:**

- Đăng ký xong không tự đăng nhập — về trang đăng nhập
- Đăng nhập vào thấy tổ chức Công ty Kiểm Thử, và có quyền quản trị trong đó

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


## §2 · Phân quyền


### B1 · Người xem không thấy nút hành động

*Ẩn nút, chứ không phải cho bấm rồi mới báo lỗi*

- **Tài khoản:** viewer@bi-platform.local

**Các bước:**

1. Đăng nhập, vào Kho dữ liệu
2. Vào Quản lý tổ chức
3. Vào Mô hình dữ liệu

**Kết quả mong đợi:**

- Kho dữ liệu: không có nút “+ Tạo bộ dữ liệu” lẫn “Đồng bộ từ CSDL”
- Quản lý tổ chức: tab Kết nối biến mất
- Mô hình dữ liệu: không có nút “+ Tạo mô hình”
- Danh sách vẫn xem được bình thường — chỉ mất quyền sửa

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### B2 · Quản trị tổ chức không vào được console hệ thống

*Hai trục vai trò độc lập nhau*

- **Tài khoản:** mai@anhduong.vn — quản trị viên của tổ chức mình

**Các bước:**

1. Gõ thẳng http://localhost:5173/admin vào thanh địa chỉ

**Kết quả mong đợi:**

- Bị chặn — chuyển sang trang báo không đủ quyền, không phải trang trắng
- Sidebar của Mai chưa bao giờ có mục dẫn tới /admin

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### B3 · Bộ chuyển tổ chức đổi cả quyền

*Cùng một người, hai tổ chức, hai vai trò khác nhau*

- **Tài khoản:** hanh@saomai.vn — quản trị ở Sao Mai, người xem ở BI Platform

**Các bước:**

1. Đăng nhập → đang ở Công ty Sao Mai. Vào Quản lý tổ chức, để ý có nút Thêm thành viên
2. Bấm bộ chuyển tổ chức trên sidebar, chọn BI Platform
3. Vào lại Quản lý tổ chức

**Kết quả mong đợi:**

- Sau khi đổi, nút Thêm thành viên biến mất — vai trò đổi theo tổ chức
- Danh sách workspace, thành viên đổi hẳn sang tổ chức mới
- Trong danh sách còn một dòng ghi Không gian riêng · Quản trị viên

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


## §3 · Tải file lên và tạo báo cáo


### C1 · Tải file bán hàng lên qua trình hướng dẫn

*Luồng chính của cả hệ thống*

- **Tài khoản:** mai@anhduong.vn
- **File:** docs/kiem-thu/du-lieu-thu/kiem-thu-ban-hang.csv

**Các bước:**

1. Vào Kho dữ liệu ở sidebar, bấm + Tạo bộ dữ liệu
2. Bước Tải file lên: kéo thả file vào, hoặc bấm “chọn file từ máy”
3. Bấm Tiếp tục
4. Bước Chọn dữ liệu: xem bảng xem trước, rồi bấm Tạo 1 bộ dữ liệu

**Kết quả mong đợi:**

- Hộp thoại mở ra tên Tạo bộ dữ liệu từ file — không phải “Tạo báo cáo nhanh”
- Bảng xem trước hiện 36 dòng · 6 cột, chữ tiếng Việt có dấu đầy đủ
- Cột Mã đơn hiện 0001 — không bị cắt thành 1
- Chạy tới bước tiến trình rồi báo Đã tạo bộ dữ liệu thành công!

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### C2 · Từ chối file sai định dạng ngay tại chỗ

*Không được tốn một vòng mạng nào*

**Các bước:**

1. Mở lại trình hướng dẫn, thử chọn một file .txt hoặc .png bất kỳ

**Kết quả mong đợi:**

- Bị từ chối ngay, kèm câu nói rõ chỉ nhận .csv và .xlsx
- Không có thanh tiến trình tải nào chạy

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### C3 · Số âm và số thập phân không bị nhân lên nghìn lần

*Đây là lỗi thật đã từng làm sai toàn bộ số liệu*

- **File:** docs/kiem-thu/du-lieu-thu/kiem-thu-so-am.csv

**Các bước:**

1. Tải file này lên theo đúng luồng C1
2. Ở bước Chọn dữ liệu, nhìn kỹ cột Loi nhuan

**Kết quả mong đợi:**

- Dòng đầu là -288.765 — không phải -288765
- Dòng thứ tư là 0.402 — không phải 402
- Cột được nhận là kiểu số, không phải chữ

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### C4 · Bộ dữ liệu mới xuất hiện trong Kho dữ liệu

**Các bước:**

1. Vào Kho dữ liệu ở sidebar
2. Gõ kiem thu vào ô tìm kiếm
3. Bấm nút Xoá lọc

**Kết quả mong đợi:**

- Hai bộ dữ liệu vừa tạo có trong danh sách, cột Nguồn ghi Từ file
- Tìm kiếm lọc đúng; bấm Xoá lọc thì danh sách đầy đủ trở lại

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### C5 · Hai lối vào, một luồng

*Nút mới không được làm hỏng đường cũ*

**Các bước:**

1. Về Trang chủ, bấm Tạo báo cáo → chọn Dùng file Excel/CSV
2. Đóng hộp thoại lại

**Kết quả mong đợi:**

- Mở ra đúng hộp thoại của C1, cùng tiêu đề Tạo bộ dữ liệu từ file
- Ô chọn workspace ở góc phải hộp thoại vẫn có, và khoá lại từ bước 2 trở đi

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


## §4 · Kết nối cơ sở dữ liệu


### D1 · Tạo kết nối tới một CSDL thật

*Trỏ thẳng vào chính MySQL của hệ thống, coi nó như CSDL khách hàng*

**Các bước:**

1. Quản lý tổ chức → tab Kết nối → Thêm kết nối
2. Bước 1 Chuẩn bị: chọn loại MySQL, bấm Tiếp tục
3. Bước 2 Thông tin kết nối: điền theo bảng dưới, rồi Tiếp tục
4. Bước 3: bấm Kiểm tra kết nối
5. Bấm Lưu kết nối

| Ô | Giá trị |
|---|---|
| Tên kết nối | CSDL bán hàng |
| Máy chủ · Cổng | 127.0.0.1 · 3310 |
| SSL/TLS | không bật |
| Database | bi_platform |
| Tài khoản · Mật khẩu | bi_user · bi_password |

**Kết quả mong đợi:**

- Trước khi test: nút Lưu kết nối mờ, không bấm được
- Test xong hiện xanh kèm phiên bản 8.0.46, lúc đó nút Lưu mới mở

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### D2 · Sai mật khẩu CSDL phải báo bằng tiếng người

*Không được nhả nguyên chuỗi lỗi của thư viện*

**Các bước:**

1. Làm lại D1 nhưng mật khẩu gõ saibet
2. Bấm Kiểm tra kết nối

**Kết quả mong đợi:**

- Câu tiếng Việt kiểu “Sai tên đăng nhập hoặc mật khẩu…”
- Không thấy ER_ACCESS_DENIED_ERROR hay vết lỗi lập trình
- Nút Lưu kết nối vẫn khoá

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### D3 · Đồng bộ bảng từ CSDL

**Các bước:**

1. Kho dữ liệu → Đồng bộ từ CSDL
2. Chọn kết nối vừa tạo, tích ba bảng: users, tenants, workspaces
3. Xác nhận đồng bộ
4. Làm lại y hệt lần hai với đúng ba bảng đó

**Kết quả mong đợi:**

- Lần một: kết quả ghi Thêm mới 3
- Lần hai: ghi Không đổi 3 — kho không nhân đôi thành 6 bộ dữ liệu

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### D4 · Đổi tên bộ dữ liệu rồi đồng bộ lại — tên bạn đặt phải còn

*Đồng bộ không được giẫm lên thứ người dùng đã sửa*

**Các bước:**

1. Mở bộ dữ liệu users, bấm Đổi tên thành Danh sách người dùng
2. Quay ra Kho dữ liệu, đồng bộ lại đúng ba bảng đó

**Kết quả mong đợi:**

- Tên Danh sách người dùng vẫn còn, không bị đổi ngược về users

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### D5 · Xoá kết nối khi còn bộ dữ liệu phải bị chặn

**Các bước:**

1. Quản lý tổ chức → Kết nối → bấm Xoá ở kết nối vừa tạo

**Kết quả mong đợi:**

- Bị chặn, kèm số lượng bộ dữ liệu phải dọn trước
- Kết nối vẫn còn nguyên trong danh sách

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### D6 · Xem trước dữ liệu đọc thẳng từ nguồn

*Nền tảng không giữ bản sao dòng nào*

**Các bước:**

1. Mở một bộ dữ liệu đồng bộ từ CSDL
2. Xem tab Dữ liệu, rồi tab Cấu trúc

**Kết quả mong đợi:**

- Tab Dữ liệu: 100 dòng đầu, và không có tổng số dòng
- Tab Cấu trúc: danh sách cột kèm kiểu, có ô tìm cột

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


## §5 · Nạp vào kho phân tích


### E1 · Trạng thái nạp tự đổi mà không cần bấm F5

*Nạp chạy nền, giao diện tự hỏi lại*

**Các bước:**

1. Vào Kho dữ liệu, nhìn cột Kho phân tích của bộ kiem-thu-ban-hang
2. Nếu cột đó ghi Chưa nạp, mở bộ dữ liệu ra, sang tab Kho phân tích rồi bấm Nạp vào kho
3. Đứng yên nhìn, không bấm F5

**Kết quả mong đợi:**

- Trạng thái tự chạy Đang chờ → Đang nạp → Đã nạp
- Mỗi trạng thái có cả chữ lẫn màu, không chỉ có màu

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### E2 · Số liệu trong kho khớp đúng với file gốc

*Phép kiểm quan trọng nhất của cả hệ thống*

**Các bước:**

1. Mở bộ kiem-thu-ban-hang, sang tab Kho phân tích
2. Đối chiếu số dòng với đáp án ở §0

**Kết quả mong đợi:**

- 36 dòng
- Cột Ngày bán hiện ra ngày thật, không phải một con số như 45678
- Cột Mã đơn vẫn là 0001

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### E3 · Nạp lại không nhân đôi dữ liệu

**Các bước:**

1. Ở tab Kho phân tích của bộ đã nạp, bấm Nạp lại
2. Chờ tới khi báo đã nạp xong, xem lại số dòng

**Kết quả mong đợi:**

- Vẫn đúng 36 dòng — không thành 72

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### E4 · Kho tắt thì lỗi phải nói rõ cách sửa

*Không được để lại một câu “lỗi không xác định”*

**Các bước:**

1. Chạy docker stop bi-clickhouse
2. Vào giao diện bấm nạp một bộ dữ liệu bất kỳ
3. Chạy lại docker start bi-clickhouse sau khi thử xong

**Kết quả mong đợi:**

- Câu báo lỗi chỉ đích danh việc phải làm — chạy npm run infra:up
- Không phải “Có lỗi xảy ra phía máy chủ”

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


## §6 · Mô hình dữ liệu và Explorer


### F1 · Mô hình KHÔNG tự sinh — người dùng chọn bộ dữ liệu

*Ca này từng khẳng định điều ngược lại*

- **Tiền điều kiện:** Đã làm xong §5 — kiem-thu-ban-hang ở trạng thái Đã nạp

**Các bước:**

1. Vào Mô hình dữ liệu ở sidebar
2. Bấm + Tạo mô hình
3. Đặt tên kiem-thu-ban-hang
4. Tích bộ dữ liệu kiem-thu-ban-hang trong danh sách
5. Bấm Tạo mô hình

**Kết quả mong đợi:**

- Trước khi bấm tạo, danh sách mô hình không có mô hình nào tự xuất hiện sau bước nạp ở §5
- Nút Tạo mô hình bị chặn nếu chưa tích bộ nào — báo “Hãy chọn ít nhất một bộ dữ liệu”
- Bộ dữ liệu chưa nạp hiện mờ, tích không được, kèm nhãn lý do
- Tạo xong nhảy thẳng vào mô hình vừa tạo
- Quay lại danh sách: cột Người tạo ghi Lê Thị Mai

> ⚠️ Trước bản này hệ thống tự dựng một mô hình ngay sau mỗi lần nạp. Nếu bạn đang thử trên một tổ chức đã dùng từ trước thì các mô hình cũ vẫn còn — chúng không bị xoá, chỉ là không có cái mới nào tự sinh thêm. Muốn thấy đúng ca này thì nạp một bộ dữ liệu mới ở §5 rồi kiểm.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### F2 · Tab Schemas — vai trò và phép gộp của từng cột

**Các bước:**

1. Mở mô hình vừa tạo ở F1, tab Schemas
2. Xem vai trò hệ thống gán cho từng cột

**Kết quả mong đợi:**

- Doanh thu, Số lượng → thước đo, phép gộp Tổng
- Khu vực, Nhóm hàng, Mã đơn → chiều
- Ngày bán → chiều thời gian

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### F3 · Explorer trả đúng con số đã biết trước

*Đây là chỗ đối chiếu quan trọng nhất*

**Các bước:**

1. Sang tab Explorer
2. Chọn thước đo Doanh thu, không chọn chiều nào
3. Chạy truy vấn
4. Thêm chiều Khu vực, chạy lại

**Kết quả mong đợi:**

- Không chiều: 25.046.000
- Theo Khu vực: Miền Trung 9.482.000 · Miền Nam 8.462.000 · Miền Bắc 7.102.000
- Cộng ba số đó lại đúng bằng tổng ở trên

> ⚠️ Nếu hiện lỗi nhắc tới đồng hồ lệch — quay lại §0 phần chuẩn bị. Đây là lỗi môi trường, không phải lỗi mô hình, và nó làm chết cả tab Explorer trong khi Schemas với Relationship vẫn chạy bình thường.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### F4 · Tự tay gộp nhiều bảng vào một mô hình

**Các bước:**

1. Mô hình dữ liệu → + Tạo mô hình
2. Đặt tên, chọn hai bộ dữ liệu trở lên đã nạp
3. Mở mô hình vừa tạo, sang tab Relationship

**Kết quả mong đợi:**

- Sơ đồ hiện đủ số bảng đã chọn
- Kéo được các bảng, vị trí giữ nguyên sau khi F5
- Nối được hai bảng bằng một cặp cột

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### F5 · Xoá mô hình

*F5*

**Các bước:**

1. Trong danh sách mô hình, mở menu ở dòng của mô hình vừa tạo → Xoá mô hình

**Kết quả mong đợi:**

- Có hộp thoại hỏi lại trước khi xoá
- Xoá xong mô hình biến khỏi danh sách; bộ dữ liệu vẫn còn trong Kho dữ liệu

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### F6 · Đếm giá trị khác nhau trên cột chữ

*Cột chữ và cột ngày trước đây không đặt được thước đo*

- **Tiền điều kiện:** Mô hình dựng trên kiem-thu-ban-hang.csv (36 dòng)

**Các bước:**

1. Mở mô hình, tab Schemas
2. Dòng cột Khu vực, ô Thước đo — chọn Đếm giá trị khác nhau
3. Dòng cột Ngày bán — chọn Nhỏ nhất
4. Lưu thay đổi, sang tab Explorer
5. Chọn thước đo Khu vực, chạy; rồi đổi sang Ngày bán, chạy lại

**Kết quả mong đợi:**

- Ô Thước đo của cột Khu vực có bấm được — chỉ mời đúng một lựa chọn Đếm giá trị khác nhau, không có Tổng hay Trung bình
- Cột Ngày bán mời Nhỏ nhất · Lớn nhất · Đếm giá trị khác nhau
- Khu vực trả 3 — đúng số khu vực, không phải 36 là số dòng
- Ngày bán trả ngày sớm nhất trong file
- Cột Mã đơn chỉ mời hai phép đếm — Đếm ô có dữ liệu và Đếm giá trị khác nhau — vì nó là chuỗi, không cộng được

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### F7 · Đổi cách tính ngay trong Explorer

*Không phải quay về Schemas và Lưu*

- **Tiền điều kiện:** Mô hình dựng trên kiem-thu-ban-hang.csv — tổng Doanh thu 25.046.000 trên 36 dòng

**Các bước:**

1. Tab Explorer, tích thước đo Doanh thu, không chọn chiều nào
2. Nhìn khối Cách tính hiện ra phía trên bảng kết quả
3. Bấm Chạy truy vấn — ghi lại con số
4. Bấm nút Trung bình trong khối Cách tính, rồi Chạy truy vấn lại
5. Sang tab Schemas xem lại dòng cột Doanh thu

**Kết quả mong đợi:**

- Khối Cách tính bày sẵn tất cả phép hợp với cột này — bảy nút cho một cột số — nhìn thấy hết mà không phải mở gì
- Rê chuột lên nút Ước lượng số khác nhau hiện câu giải thích nói ra đánh đổi: có thể lệch vài phần trăm, đổi lại quét bảng rất lớn nhanh hơn nhiều
- Nút Tổng sáng sẵn từ đầu, vì đó là phép mô hình đang khai
- Lần chạy đầu: 25.046.000
- Sau khi đổi: ≈ 695.722,22 (= 25.046.000 / 36), và tiêu đề cột đổi thành Doanh thu (Trung bình)
- Ở tab Schemas, cột Doanh thu vẫn là Tổng — bấm ở Explorer không sửa mô hình
- Thước đo Số dòng nếu tích vào thì không có hàng nút, vì nó không đo cột nào

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### F10 · Đếm ô có dữ liệu nói ra cột nào đang nhập thiếu

*Ba phép đếm, ba con số khác nhau*

- **Tiền điều kiện:** Mô hình dựng trên Global-Superstore — 51.290 dòng, tổ chức 4

**Các bước:**

1. Tab Explorer, tích thước đo Số dòng, không chọn chiều nào → Chạy truy vấn
2. Bỏ tích, tích thước đo Postal Code, chọn Đếm ô có dữ liệu → Chạy truy vấn
3. Đổi sang Đếm giá trị khác nhau → Chạy truy vấn
4. Rê chuột lên nút Đếm ô có dữ liệu

**Kết quả mong đợi:**

- Số dòng: 51.290
- Đếm ô có dữ liệu: 9.994 — không phải 51.290. Hơn 80 % đơn hàng không có mã bưu chính
- Đếm giá trị khác nhau: 631 — số mã bưu chính khác nhau, khác hẳn hai con số trên
- Chú thích khi rê chuột: "Đếm số dòng CÓ ĐIỀN cột này. Ô trống không được tính, nên con số này có thể nhỏ hơn thước đo Số dòng."
- Tiêu đề cột đọc là Postal Code (Đếm ô có dữ liệu), không phải "Đếm dòng"

> ⚠️ Nếu con số ở bước 2 ra đúng 51.290 thì phép đếm đang bám vào khoá chính ẩn chứ không bám vào cột — nghĩa là nó chỉ là bản sao của Số dòng mang tên một cột, và cả kịch bản này mất ý nghĩa. Đây là đúng hình dạng lỗi mà lệnh cấm count ở bản trước lo sợ.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### F11 · Tích chọn bộ dữ liệu ngay ở Kho dữ liệu để dựng mô hình

*Không phải rời trang rồi đi tìm lại chúng*

- **Tiền điều kiện:** Ít nhất hai bộ dữ liệu ở trạng thái Đã nạp, và ít nhất một bộ chưa nạp

**Các bước:**

1. Vào Kho dữ liệu. Nhìn cột ô tích ở đầu bảng
2. Thử bấm ô tích của dòng chưa nạp, rồi rê chuột lên nó
3. Tích hai bộ đã nạp
4. Gõ vào ô tìm kiếm một từ chỉ khớp một trong hai bộ vừa tích
5. Bấm Tạo mô hình từ 2 bộ dữ liệu
6. Đặt tên rồi bấm Tạo mô hình
7. Quay lại Kho dữ liệu, tìm một dòng đã nạp chưa có mô hình, bấm chữ Tạo mô hình ở cột Mô hình dữ liệu

**Kết quả mong đợi:**

- Bước 2: ô tích bấm không được, và chú thích khi rê chuột ghi "Chưa nạp vào kho phân tích nên chưa dựng mô hình lên được"
- Bước 3: thanh xanh hiện lên trên bảng — Đã chọn 2 bộ dữ liệu, kèm nút Bỏ chọn
- Bước 4: thanh vẫn ghi 2 dù bảng chỉ còn một dòng, và có thêm dòng chữ (có bộ nằm ở trang hoặc bộ lọc khác)
- Bước 5: hộp thoại mở ra với cả hai bộ đã tích sẵn — không phải tích lại
- Bước 6: nhảy thẳng vào mô hình vừa tạo, tab Schemas có cột của cả hai bảng
- Bước 7: hộp thoại mở ra với đúng một bộ đã tích — bộ ở dòng vừa bấm
- Ô tích ở hàng tiêu đề chỉ tích những dòng đã nạp của trang đang xem, không đụng lựa chọn ở trang khác

> ⚠️ Đăng nhập lại bằng tài khoản người xem rồi mở Kho dữ liệu: không được có cột ô tích, không có thanh xanh, và cột Mô hình dữ liệu chỉ hiện chữ chứ không có nút bấm. Người xem không tạo được mô hình, nên một ô tích dẫn tới lỗi 403 là cái bẫy chứ không phải tính năng.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### F12 · Doanh thu = số lượng × đơn giá, tính đúng thứ tự

*Hai cách tính cho hai con số khác nhau*

- **Tiền điều kiện:** Một mô hình có bảng dòng hàng — cột số lượng và cột đơn giá trên cùng một bảng

**Các bước:**

1. Mở mô hình → Thước đo tính toán
2. Đặt tên Doanh thu
3. Bấm phép × và nhìn khối Cách tính ở trên
4. Chọn cột thứ nhất số lượng, cột thứ hai đơn giá, phép gộp Tổng → Thêm thước đo
5. Sang tab Explorer, tích Doanh thu → Chạy truy vấn
6. Đối chiếu bằng ClickHouse: SELECT sum("số lượng" * "đơn giá") FROM bi_analytics."raw_t…"
7. Quay lại hộp thoại, đổi phép sang ÷ và nhìn lại khối Cách tính

**Kết quả mong đợi:**

- Bước 3: bấm × thì ô Tính từng dòng rồi gộp tự sáng lên, và hai ô ghi rõ hai công thức khác nhau — Tổng( số lượng × đơn giá ) so với số lượng × đơn giá
- Ô Phép gộp chỉ hiện ở chế độ tính-từng-dòng; chế độ kia không có, vì hai vế đã gộp xong rồi
- Bước 5 và 6: hai con số khớp nhau
- Bước 7: bấm ÷ thì tự chuyển về Gộp trước rồi tính — nhưng nếu bạn đã tự bấm chọn một ô thì lựa chọn đó được giữ, không bị kéo đi
- Trong bảng danh sách ở đầu hộp thoại, thước đo mới hiện công thức Tổng( số lượng × đơn giá ), khác hẳn dòng công thức thường

> ⚠️ Thử luôn cách sai để thấy vì sao khối này tồn tại: chọn Gộp trước rồi tính với cùng hai vế. Con số ra sẽ gần đúng chứ không lệch lộ liễu — trên dữ liệu thật của tổ chức 4 nó lệch 0,047 % (39,40 tỷ so với 39,38 tỷ). Đó chính là lý do hai công thức phải bày cạnh nhau: sai kiểu này không ai phát hiện bằng mắt.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### F13 · Thước đo tự nói ra phép tính của nó

*Vì tên thước đo trùng đúng tên cột*

- **Tiền điều kiện:** Một mô hình có bảng chứa cột tiền — ví dụ Total amount trên bảng đơn hàng

**Các bước:**

1. Mở mô hình → tab Explorer
2. Nhìn cột trái, nhóm Thước đo (Measure), KHÔNG tích gì cả
3. Tích Total amount → Chạy truy vấn
4. Rê chuột lên tiêu đề cột trong bảng kết quả
5. Ở khối Cách tính, bấm sang Trung bình rồi nhìn lại cột trái
6. Tích thêm một thước đo Số dòng và một thước đo tính từng dòng nếu có

**Kết quả mong đợi:**

- Bước 2: dưới mỗi tên thước đo có một dòng chữ nhỏ ghi phép tính — Tổng của Total amount, Trung bình của Unit price
- Thước đo Số dòng ghi Đếm số dòng của bảng …, không ghi tên cột nào
- Thước đo tính từng dòng ghi Tổng của (Quantity × Unit price) — có ngoặc
- Bước 4: chú thích của tiêu đề cột nói đúng phép tính đã chạy
- Bước 5: dòng chữ nhỏ đổi theo thành Trung bình của Total amount ngay, không cần chạy lại
- Cuối nhóm có một câu nói rõ thước đo từ đâu ra: tạo sẵn lúc thêm bảng, sửa ở tab Schemas

> ⚠️ Đây là chỗ chữa một hiểu nhầm khó thấy: trong dữ liệu, Total amount là số tiền của một đơn; trong Explorer, Total amount là tổng tiền của cả nhóm. Hai thứ mang y hệt một cái tên. Người dùng nhìn thấy con số hàng tỉ ở chỗ họ chờ hàng trăm nghìn, và trước bản này không có gì trên màn hình giải thích khoảng cách đó — con số vẫn đúng, chỉ nghĩa của nó bị đọc sai.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### F14 · Từ vựng của mô hình chỉ có MỘT bản

*Đổi ở shared thì cả ba màn hình đổi theo*

- **Tiền điều kiện:** Một mô hình bất kỳ đã có bảng

**Các bước:**

1. Tab Explorer → nhìn hai tiêu đề nhóm ở cột trái
2. Tab Schemas → mở một bảng → nhìn hai tiêu đề cột cuối và ô sổ xuống Vai trò
3. Tạo báo cáo từ mô hình → nhìn nhãn hai ô chọn

**Kết quả mong đợi:**

- Cả ba màn hình dùng đúng một cặp chữ: Chiều (Dimension) và Thước đo (Measure)
- Explorer: dưới mỗi tiêu đề nhóm có một câu nói nhóm đó là gì — "Cột để chia nhóm — theo khu vực, theo tháng, theo sản phẩm."
- Schemas: cột cuối tên Phép gộp (Aggregation), KHÔNG còn tên "Thước đo"
- Ô sổ xuống Vai trò có ba lựa chọn, cả ba đều kèm từ tiếng Anh

> ⚠️ Chỗ dễ sai nhất đã được sửa cùng lượt: trước đây cột Vai trò nhận giá trị Thước đo, còn cột ngay bên phải nó cũng mang tiêu đề Thước đo — hai thứ khác nhau, một cái tên, nằm cạnh nhau trên cùng một hàng. Cột bên phải chọn phép gộp, và aria-label của chính ô select luôn đọc là "Phép gộp của cột …", tức hai nhãn vẫn đang nói hai đằng.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### F15 · Hàng nút Cách tính bám đúng những gì Cube làm được

*Bảy phép, không hơn không kém*

- **Tiền điều kiện:** Một mô hình có ít nhất một cột số và một cột chữ

**Các bước:**

1. Tab Explorer, tích một thước đo dựng trên cột số → nhìn khối Cách tính
2. Đếm số nút và đọc tên từng nút
3. Bấm Ước lượng số khác nhau → Chạy truy vấn → nhìn tiêu đề cột
4. Bấm Đếm giá trị khác nhau → Chạy truy vấn → so hai con số
5. Tích một thước đo dựng trên cột chữ và xem hàng nút của nó

**Kết quả mong đợi:**

- Cột số: bảy nút — Tổng · Trung bình · Nhỏ nhất · Lớn nhất · Đếm ô có dữ liệu · Đếm giá trị khác nhau · Ước lượng số khác nhau
- Không còn Trung vị và Ngưỡng top 10%
- Cột chữ: ba nút — chỉ ba phép đếm; cộng hay trung bình một cột chữ là câu SQL không chạy
- Tiêu đề cột đọc là Doanh thu (Ước lượng số khác nhau) — một lớp ngoặc, không phải ngoặc lồng ngoặc
- Ở quy mô nhỏ, hai phép đếm cho cùng một số: dưới khoảng 65 nghìn giá trị khác nhau, uniq() của ClickHouse vẫn chính xác tuyệt đối

> ⚠️ Danh sách bảy phép này là tập con của những kiểu Cube nhận, và danh sách đó đọc từ chính bộ kiểm định của phiên bản đang chạy chứ không từ tài liệu — CubeValidator.js. Một kiểu lạ không hỏng lúc sinh file; nó hỏng lúc Cube biên dịch schema, và một schema hỏng chặn luôn mọi mô hình của cùng tổ chức. Đó cũng là lý do running_total không có mặt: Cube đã bỏ hẳn nó, thứ thay thế là rolling_window — một cấu trúc khác, cần chiều thời gian, không đặt được vào một ô type.

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


## §7 · Quản lý tổ chức


### G1 · Tạo, đổi tên và xoá workspace

*Đổi tên không được đổi đường dẫn*

**Các bước:**

1. Quản lý tổ chức → tab Workspace → Tạo workspace, tên Phòng Kinh doanh
2. Ghi lại cột Đường dẫn
3. Đổi tên thành Phòng Kinh doanh 2026
4. Xoá workspace đó

**Kết quả mong đợi:**

- Sau khi đổi tên, cột Đường dẫn không đổi — link cũ ai đó đã lưu vẫn dùng được
- Xoá được vì nó rỗng

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### G2 · Không xoá được workspace cuối cùng

**Các bước:**

1. Xoá cho tới khi tổ chức chỉ còn một workspace
2. Thử xoá nốt cái cuối

**Kết quả mong đợi:**

- Bị chặn kèm lý do — tổ chức không được phép không có workspace nào

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### G3 · Mời thành viên mới và mật khẩu tạm

*Mật khẩu chỉ hiện đúng một lần*

**Các bước:**

1. Tab Thành viên → Thêm thành viên
2. Điền email chưa từng có, họ tên, vai trò Người xem
3. Chép mật khẩu tạm hiện ra, rồi bấm F5
4. Đăng xuất, đăng nhập bằng tài khoản mới đó

**Kết quả mong đợi:**

- Bảng mật khẩu sống qua F5, và nút đóng chỉ mở sau khi tự tích ô xác nhận
- Đăng nhập lần đầu bị bắt đổi mật khẩu trước khi vào được đâu
- Đổi xong vào đúng tổ chức được mời, không phải không gian riêng

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### G4 · Cấp lại mật khẩu khi lỡ quên chép

*Là cấp lại, không phải xem lại*

**Các bước:**

1. Ở dòng của người vừa mời, chọn Cấp lại mật khẩu tạm
2. Thử làm điều đó với chính mình

**Kết quả mong đợi:**

- Sinh mật khẩu mới; mật khẩu cũ chết ngay
- Với chính mình: bị từ chối, kèm gợi ý dùng trang hồ sơ cá nhân

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### G5 · Không tự hạ quyền và không bỏ được admin cuối cùng

**Các bước:**

1. Thử đổi vai trò của chính mình xuống Người xem
2. Thử khoá hoặc gỡ chính mình

**Kết quả mong đợi:**

- Cả ba thao tác bị chặn, mỗi cái kèm lý do đọc được
- Tổ chức không bao giờ rơi vào cảnh không còn quản trị viên nào

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### G6 · Đổi tên tổ chức

*G6*

**Các bước:**

1. Tab Tổ chức → đổi tên thành Công ty Ánh Dương 2026
2. Nhìn tên trên sidebar
3. Đổi trả lại tên cũ

**Kết quả mong đợi:**

- Tên trên sidebar đổi theo ngay
- Đường dẫn định danh của tổ chức không đổi

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


## §8 · Console vận hành hệ thống


### H1 · Tổng quan nhìn xuyên mọi tổ chức

*H1*

- **Tài khoản:** admin@bi-platform.local / Admin@12345

**Các bước:**

1. Đăng nhập rồi vào /admin
2. Xem trang Tổng quan

**Kết quả mong đợi:**

- Thẻ số đếm tổ chức, người dùng, workspace của toàn hệ thống
- Biểu đồ tăng trưởng không nhảy cóc ngày — ngày trống vẫn có cột 0
- Đăng nhập xong vào Trang chủ trước, không nhảy thẳng vào /admin

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### H2 · Không gian cá nhân bị ẩn khỏi danh sách tổ chức

*Mỗi người một dòng thì công ty thật bị chôn*

**Các bước:**

1. Vào mục Tổ chức
2. Đổi bộ lọc Loại sang Không gian cá nhân, rồi sang Tất cả

**Kết quả mong đợi:**

- Mặc định chỉ hiện công ty thật
- Chọn Tất cả thì hiện thêm các không gian cá nhân, mỗi dòng có nhãn riêng

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### H3 · Khoá một tổ chức thì thành viên của nó mất phiên

**Các bước:**

1. Mở một trình duyệt thứ hai (hoặc cửa sổ ẩn danh), đăng nhập bằng mai@anhduong.vn
2. Ở cửa sổ admin, khoá tổ chức Công ty Ánh Dương
3. Quay lại cửa sổ của Mai, bấm sang một trang bất kỳ
4. Mở khoá lại sau khi thử xong

**Kết quả mong đợi:**

- Mai bị đá ra, không phải đợi token hết hạn

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### H4 · Không tự khoá và không tự xoá chính mình

*H4*

**Các bước:**

1. Vào mục Người dùng, tìm chính tài khoản admin đang đăng nhập
2. Thử khoá, rồi thử xoá

**Kết quả mong đợi:**

- Cả hai bị chặn — hệ thống không được phép rơi vào cảnh không còn quản trị viên

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


## §9 · Các ca biên đáng thử


### I1 · Không xem được dữ liệu của tổ chức khác dù gõ thẳng địa chỉ

*Đây là lỗi nghiêm trọng nhất có thể xảy ra*

**Các bước:**

1. Đăng nhập bằng mai@anhduong.vn
2. Gõ thẳng vào thanh địa chỉ: /datasets/21, /datasets/22, /datamodels/1

**Kết quả mong đợi:**

- Cả ba đều báo không tìm thấy
- Không được báo “bạn không có quyền” — câu đó tự nó xác nhận rằng dữ liệu đó tồn tại

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### I2 · Địa chỉ không tồn tại

**Các bước:**

1. Gõ /khong-co-trang-nay

**Kết quả mong đợi:**

- Trang báo không tìm thấy có thiết kế đàng hoàng, kèm đường về trang chủ
- Không phải trang trắng hay chuỗi lỗi thô

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### I3 · Bấm F5 giữa chừng không mất bộ lọc

*Trạng thái danh sách nằm trên URL*

**Các bước:**

1. Vào Kho dữ liệu, gõ từ khoá tìm kiếm, đổi bộ lọc Nguồn, sang trang 2
2. Bấm F5
3. Bấm nút quay lại của trình duyệt

**Kết quả mong đợi:**

- Sau F5, tìm kiếm và bộ lọc vẫn nguyên
- Nút quay lại đưa về đúng trạng thái lọc trước đó
- Đổi bộ lọc thì tự về trang 1 — không đứng lại ở trang 2 rỗng

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### I4 · Bảng rộng thì bảng tự cuộn, trang không cuộn ngang

**Các bước:**

1. Mở một bộ dữ liệu nhiều cột, xem tab Dữ liệu
2. Thu hẹp cửa sổ trình duyệt còn khoảng nửa màn hình

**Kết quả mong đợi:**

- Chỉ vùng bảng cuộn ngang; sidebar và tiêu đề đứng yên
- Cả trang không bị đẩy lệch sang phải

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### I5 · Xoá bộ dữ liệu đang có báo cáo dùng

*Không được xoá lan sang nội dung của người khác*

**Các bước:**

1. Tạo một báo cáo từ một bộ dữ liệu
2. Quay ra Kho dữ liệu, thử xoá chính bộ đó

**Kết quả mong đợi:**

- Bị chặn kèm số lượng báo cáo đang dùng
- Báo cáo không bị xoá theo

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


### I6 · Mất mạng giữa chừng

*Giao diện phải nói được là đang mất kết nối*

**Các bước:**

1. Mở DevTools bằng F12 → tab Network → đặt chế độ Offline
2. Bấm sang một trang khác trong ứng dụng
3. Bỏ Offline, bấm thử lại

**Kết quả mong đợi:**

- Có thông báo lỗi rõ ràng, không phải màn hình trắng hay quay vòng vĩnh viễn
- Bỏ Offline rồi thao tác lại thì chạy bình thường, không phải tải lại cả trang

| Kết quả thực tế | Đạt / Không đạt |
|---|---|
|  |  |


## §10 · Sau khi kiểm xong
