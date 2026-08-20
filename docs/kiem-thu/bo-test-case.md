# Bộ test case — Nền tảng BI Platform

> Sinh tự động từ hồ sơ kiểm thử. **Đừng sửa tay** — sửa file
> `bo-test-case.html` rồi chạy lại `xuat-markdown.py`.

| | |
|---|---|
| Ngày chạy | 19/08/2026 |
| Nhánh | `main` @ 8e80985 |
| Môi trường | localhost · MySQL 8.0.46 · ClickHouse 25.8 · Cube.js · MinIO · Redis |
| Tổng số ca | 147 (147 đạt · 0 không đạt) |
| Đối chiếu bộ tự động | 558 ca — lần chạy cuối 558/558 đạt |

Cột **Kết quả thực tế** chép nguyên văn thứ hệ thống trả về khi chạy,
không phải kết quả suy ra từ mã nguồn.


## XT · Xác thực và phiên đăng nhập — 21 ca, gọi API thật

| Mã | Mục tiêu · các bước | Kết quả mong đợi | Kết quả thực tế | KL |
|---|---|---|---|---|
| XT-01 | Đăng nhập bằng email và mật khẩu đúng — POST /auth/login · mai@anhduong.vn | 200, trả token JWT ba phần kèm tổ chức và vai trò | HTTP 200, token JWT 3 phần, tenant="Công ty Ánh Dương", role="admin" | Đạt |
| XT-02 | Đăng nhập sai mật khẩu | 401, thông báo chung không nói sai ở đâu | HTTP 401 "Email hoặc mật khẩu không đúng." | Đạt |
| XT-03 | Đăng nhập bằng email chưa đăng ký — không được lộ ra là email không tồn tại | 401 với đúng thông báo của XT-02 | HTTP 401 "Email hoặc mật khẩu không đúng." — giống hệt XT-02 | Đạt |
| XT-04 | Chênh lệch thời gian phản hồi giữa email có thật và email không có (kênh dò email) — 3 lần mỗi bên, lấy trung bình | Chênh lệch dưới 35% | email có thật 388ms · email không có 374ms · lệch 14ms (4%) | Đạt |
| XT-05 | Email sai định dạng | 400 ở tầng kiểm dữ liệu | HTTP 400 ValidationError · fields.email = "Email không hợp lệ" | Đạt |
| XT-06 | Email viết HOA kèm khoảng trắng thừa: " MAI@ANHDUONG.VN " | 200 — chuẩn hoá trước khi tra cứu | HTTP 200, vào đúng tổ chức "Công ty Ánh Dương" | Đạt |
| XT-07 | Đăng ký với mật khẩu thiếu chữ hoa | 400, thông báo nói rõ thiếu chữ hoa | HTTP 400, thông báo có nhắc "chữ hoa": true | Đạt |
| XT-08 | Đăng ký với mật khẩu dưới 8 ký tự | 400 | HTTP 400 · fields.password = "Mật khẩu tối thiểu 8 ký tự" | Đạt |
| XT-09 | Đăng ký với mật khẩu nhập lại không khớp | 400, thông báo nhắc "nhập lại" | HTTP 400, thông báo nhắc "nhập lại": true | Đạt |
| XT-10 | Đăng ký bằng email đã tồn tại | 409 EmailAlreadyRegistered | HTTP 409 EmailAlreadyRegistered · "Email này đã được đăng ký." | Đạt |
| XT-11 | Đăng ký với số điện thoại sai định dạng | 400 kèm luật cụ thể | HTTP 400 · "Số điện thoại phải gồm 9–10 chữ số (chấp nhận 0…, +84…)" | Đạt |
| XT-12 | Gọi /auth/me khi chưa đăng nhập | 401 | HTTP 401 Unauthorized · "Thiếu token xác thực." | Đạt |
| XT-13 | Gọi /auth/me với token hợp lệ | 200, trả đúng người đang đăng nhập | HTTP 200, user.email="mai@anhduong.vn", role="admin" | Đạt |
| XT-14 | Token bị sửa chữ ký | 401 | HTTP 401 · "Phiên đăng nhập không hợp lệ hoặc đã hết hạn." | Đạt |
| XT-15 | Sửa payload token để tự nâng lên superadmin, giữ nguyên chữ ký cũ | 401 — chữ ký không còn khớp | HTTP 401 · "Phiên đăng nhập không hợp lệ hoặc đã hết hạn." | Đạt |
| XT-16 | Token khai alg: none (tấn công alg confusion) | 401 — thuật toán phải bị ghim HS256 | HTTP 401 · "Phiên đăng nhập không hợp lệ hoặc đã hết hạn." | Đạt |
| XT-17 | Đổi mật khẩu nhưng nhập sai mật khẩu hiện tại | 4xx, nêu đúng ô sai | HTTP 400 · fields.currentPassword = "Mật khẩu hiện tại không đúng" | Đạt |
| XT-18 | Chuyển sang tổ chức mình không thuộc | 403, không cấp token | HTTP 403 NoMembership · "Bạn không còn quyền truy cập tổ chức này." | Đạt |
| XT-19 | Chuyển tổ chức hợp lệ với tài khoản thuộc ba tổ chức — hanh@saomai.vn | 200, vai trò đổi theo tổ chức đích | HTTP 200: "Công ty Sao Mai" (admin) → "BI Platform" (viewer) | Đạt |
| XT-20 | Đăng xuất | 204 — JWT vô trạng thái, client tự bỏ token | HTTP 204, không có Set-Cookie (token nằm ở client) | Đạt |
| XT-21 | Đăng nhập sai 13 lần liên tiếp từ cùng một IP — Ngưỡng cấu hình: 10 lần / 15 phút | 429 từ lần thứ 11 | 10 lần đầu HTTP 401, từ lần 11 trở đi HTTP 429; bộ đếm Redis = 13, TTL 894s | Đạt |

## PQ · Phân quyền theo vai trò — 11 ca, gọi API thật

| Mã | Mục tiêu · các bước | Kết quả mong đợi | Kết quả thực tế | KL |
|---|---|---|---|---|
| PQ-01 | Ma trận quyền của quản trị tổ chức — GET /v1/permissions | Đủ 4 hành động trên mọi tài nguyên | HTTP 200, workspace=[read,modify,invite,delete], member=[read,modify,invite,delete] | Đạt |
| PQ-02 | Ma trận quyền của người xem | Chỉ có read, không có hành động nào khác | HTTP 200, tập hành động xuất hiện = {read}, dataset=[read] | Đạt |
| PQ-03 | Người xem đọc danh sách bộ dữ liệu | 200 — được phép xem | HTTP 200, tổng 0 bộ dữ liệu | Đạt |
| PQ-04 | Người xem tạo workspace | 403 kèm lý do đọc được | HTTP 403 · "Vai trò của bạn không được phép thay đổi workspace." | Đạt |
| PQ-05 | Người xem mời thành viên | 403 | HTTP 403 · "Vai trò của bạn không được phép mời người vào thành viên." | Đạt |
| PQ-06 | Người xem xoá workspace | 403 | HTTP 403 · "Vai trò của bạn không được phép xoá workspace." | Đạt |
| PQ-07 | Người xem tạo kết nối CSDL | 403 | HTTP 403 · "Vai trò của bạn không được phép thay đổi kết nối CSDL." | Đạt |
| PQ-08 | Quản trị tổ chức mở console vận hành hệ thống | 403 — hai trục vai trò độc lập | HTTP 403 · "Chức năng này chỉ dành cho quản trị hệ thống." | Đạt |
| PQ-09 | Quản trị hệ thống mở console vận hành | 200 kèm số liệu xuyên mọi tổ chức | HTTP 200 · activeTenants=6, totalUsers=9, totalWorkspaces=13 | Đạt |
| PQ-10 | Gọi API khi không gửi token | 401, không phải 403 | HTTP 401 Unauthorized · "Thiếu token xác thực." | Đạt |
| PQ-11 | Quản trị hệ thống vẫn mang một vai trò tổ chức riêng, không tự động là admin ở mọi nơi | Trả về vai trò tổ chức cụ thể | HTTP 200, đang ở "BI Platform" với vai trò tổ chức "admin" | Đạt |

## AT · An toàn và cách ly tổ chức — 11 ca, gọi API thật

| Mã | Mục tiêu · các bước | Kết quả mong đợi | Kết quả thực tế | KL |
|---|---|---|---|---|
| AT-01 | Đọc 5 bộ dữ liệu thuộc tổ chức khác — id 21–25 thuộc tổ chức NASA | 404 — không được lộ ra là chúng tồn tại | 21:404 22:404 23:404 24:404 25:404 | Đạt |
| AT-02 | Đọc 5 mô hình dữ liệu thuộc tổ chức khác | 404 | 1:404 2:404 3:404 4:404 5:404 | Đạt |
| AT-03 | Truyền cột sắp xếp lạ: sort=(SELECT 1) | 400 — chặn bằng danh sách trắng, không ghép chuỗi vào SQL | HTTP 400 · "Cột sắp xếp không hợp lệ. Chỉ nhận: name, sourceTable, columnCount, syncedAt, rowCount…" | Đạt |
| AT-04 | Truyền order=; DROP TABLE datasets | 400 | HTTP 400 · "Expected 'asc' / 'desc', received '; DROP TABLE datasets'" | Đạt |
| AT-05 | Tìm kiếm với ký tự đại diện LIKE: 100%_' OR 1=1 -- | 200, không lỗi và không trả toàn bảng | HTTP 200, trả 0 kết quả | Đạt |
| AT-06 | Chặn SSRF ở chế độ production: thử 4 địa chỉ nội bộ và 1 địa chỉ công khai — NODE_ENV=production, gọi thẳng resolveAndGuardHost | Chặn cả 4 địa chỉ nội bộ, cho qua địa chỉ công khai | allowPrivateDbHosts=false · 169.254.169.254 → CHẶN (link-local) · 10.0.0.1 → CHẶN (mạng nội bộ) · 127.0.0.1 → CHẶN (loopback) · 192.168.1.5 → CHẶN (mạng nội bộ) · 8.8.8.8 → CHO QUA | Đạt |
| AT-07 | Cùng phép thử ở chế độ phát triển — Tiền điều kiện: ALLOW_PRIVATE_DB_HOSTS mặc định bật ở dev | Cho qua — đúng chủ đích, để nối được 127.0.0.1:3310 như tài liệu hướng dẫn | allowPrivateDbHosts=true · cả 5 địa chỉ đều CHO QUA | Đạt |
| AT-08 | Mật khẩu CSDL nguồn có bị trả về trình duyệt không | Không có trường mật khẩu nào trong phản hồi | HTTP 200, thân phản hồi KHÔNG có trường mật khẩu | Đạt |
| AT-09 | Truyền id không phải số vào đường dẫn | 400 ở tầng kiểm tham số | HTTP 400 · fields.id = "Expected number, received nan" | Đạt |
| AT-10 | Gửi thân request không phải JSON hợp lệ | 400 — đây là lỗi của client | HTTP 400 MalformedBody · "Thân yêu cầu không phải JSON hợp lệ." · (trước bản vá V-02: HTTP 500) | Đạt — đã sửa V-02 |
| AT-12 | Gửi thân JSON vượt trần 1MB — Bổ sung khi vá V-02 | 413 — giữ nguyên mã body-parser đã chọn, không ép về 400 | HTTP 413 PayloadTooLarge · "Thân yêu cầu vượt quá giới hạn 1MB." | Đạt |
| AT-11 | Gửi Origin lạ để thử vượt CORS | Không phản chiếu nguồn lạ, không trả * | Access-Control-Allow-Origin: http://localhost:5173 | Đạt |

## TF · Tải file lên (§7) — 7 ca, gọi API thật

| Mã | Mục tiêu · các bước | Kết quả mong đợi | Kết quả thực tế | KL |
|---|---|---|---|---|
| TF-01 | Xin đường tải lên cho kiem-thu-loi-nhuan.csv | 201, trả URL đã ký; khoá lưu trữ do server sinh | HTTP 201, datasetId=84, uploadUrl do server ký (không chứa tên file người dùng đặt) | Đạt |
| TF-02 | Xin đường tải lên cho virus.exe | 400 — chỉ nhận .csv và .xlsx | HTTP 400 UnsupportedFormat · "Chỉ nhận file .csv hoặc .xlsx." | Đạt |
| TF-03 | Khai kích thước 60MB, vượt trần 50MB | 413 ngay, không bắt tải xong mới báo | HTTP 413 FileTooLarge · "File vượt quá 50MB." | Đạt |
| TF-04 | PUT nội dung file lên MinIO bằng URL đã ký | 200 | HTTP 200 khi PUT 207 byte lên MinIO | Đạt |
| TF-05 | Phân tích file: nhận diện cột và suy kiểu | 4 cột, suy đúng text / text / date / number | HTTP 200, 4 cột → text, text, date, number | Đạt |
| TF-06 | Chốt sheet và nạp dòng vào database | Tạo 1 bộ dữ liệu, 5 dòng | HTTP 200, tạo 1 bộ: {"id":85,"name":"Kiem thu loi nhuan","rowCount":5} | Đạt |
| TF-07 | Xem trước dữ liệu vừa nạp | 200, đúng 5 dòng | HTTP 200, 5 dòng xem trước | Đạt |

## NA · Nạp vào kho phân tích (§9) — 5 ca, gọi API thật

| Mã | Mục tiêu · các bước | Kết quả mong đợi | Kết quả thực tế | KL |
|---|---|---|---|---|
| NA-01 | Nạp tự động chạy sau khi chốt sheet, không cần bấm nút | Lần nạp kết thúc succeeded, bộ dữ liệu chuyển sang loaded | lần nạp "succeeded", bộ dữ liệu ở trạng thái "loaded" | Đạt |
| NA-02 | Bảng raw_* trong ClickHouse — Đối chiếu trực tiếp bằng clickhouse-client | Bảng tồn tại, đúng 5 dòng | bảng raw_t2_d85 có 5 dòng | Đạt |
| NA-03 | Số âm và số thập phân giữ nguyên giá trị — Bẫy: -288.765 và 0.402 từng bị đọc thành -288765 và 402 | Tổng cột Lợi nhuận = 709.352, khớp số tính tay | tổng trong kho = 709.352 · tính tay = 709.352 · lệch 0.0000 · từng dòng: -288.765 / 1234.56 / -1000 / 0.402 / 763.155 | Đạt |
| NA-04 | Bấm nạp lại lần hai | Vẫn 5 dòng, không nhân đôi thành 10 | xếp hàng HTTP 202, nạp xong "succeeded", số dòng = 5 | Đạt |
| NA-05 | Bảng tạm __new dùng cho phép hoán đổi nguyên tử | Không còn bảng tạm nào sau khi nạp xong | 0 bảng tạm còn lại | Đạt |

## MH · Mô hình dữ liệu và tầng ngữ nghĩa (§10) — 5 ca, gọi API thật

| Mã | Mục tiêu · các bước | Kết quả mong đợi | Kết quả thực tế | KL |
|---|---|---|---|---|
| MH-01 | Nạp xong KHÔNG tự sinh mô hình nào — Ca này trước đây khẳng định điều ngược lại — việc tự sinh đã bị bỏ ở migration 20 | Danh sách mô hình vẫn rỗng sau khi nạp xong | 0 mô hình sau khi nạp xong: [] | Đạt |
| MH-02 | Tạo mô hình bắt buộc chọn bộ dữ liệu — Chặn ở backend chứ không chỉ ở giao diện: mô hình không bảng nào sinh ra file Cube rỗng | Danh sách rỗng → 400; chọn một bộ → 201, mô hình có 1 bảng | danh sách rỗng → HTTP 400; chọn 1 bộ → HTTP 201, mô hình id=37 có 1 bảng | Đạt |
| MH-03 | Mọi cột trong schema Cube phải mang tiền tố ${CUBE}. — Thiếu tiền tố gây nối bảng sai theo vị trí dòng | Không dòng sql: nào thiếu tiền tố | file dm37.js có 5 dòng sql:, số dòng THIẾU tiền tố = 0 | Đạt |
| MH-04 | Truy vấn tổng Lợi nhuận qua tầng ngữ nghĩa Cube — Tiền điều kiện: container Cube phải chạy bản cube.js hiện tại — xem V-03 | Trả 709.352, khớp NA-03 và số tính tay | HTTP 200, Cube trả 709.352 · lệch 0.0000 | Đạt |
| MH-05 | Xoá mô hình rồi đọc lại | 204 khi xoá, 404 khi đọc lại | DELETE → HTTP 204, GET lại → HTTP 404 | Đạt |

## TD · Thước đo của mô hình dữ liệu (§10.6, §10.7) — 20 ca, gọi API thật

| Mã | Mục tiêu · các bước | Kết quả mong đợi | Kết quả thực tế | KL |
|---|---|---|---|---|
| TD-01 | Cột chữ nhận được phép đếm giá trị khác nhau — Trước bản này chỉ cột số mới đặt được phép gộp | Lưu được, HTTP 200 | cột "Khu vuc" kiểu Nullable(String) → HTTP 200 khi đặt countDistinct | Đạt |
| TD-02 | Cube trả đúng số giá trị khác nhau, không phải số dòng — File thử có 5 dòng nhưng chỉ 3 khu vực — đây là khác biệt duy nhất phân biệt count_distinct với count từ bên ngoài | 3, không phải 5 | HTTP 200, Cube trả 3 trên 5 dòng | Đạt |
| TD-03 | Cột ngày nhận min/max — "đơn đầu tiên" và "đơn gần nhất" | min trả 2026-01-15 | Nullable(DateTime64(3,'UTC')) → HTTP 200; Cube trả 2026-01-15T00:00:00.000 | Đạt |
| TD-04 | Phép gộp không hợp kiểu bị backend chặn, không chỉ giao diện — sum trên cột String không phải lựa chọn tồi — nó là câu SQL không chạy | 400 kèm câu nói rõ kiểu và các phép hợp lệ | HTTP 400 ValidationError: «Cột "Khu vuc" kiểu Nullable(String) không nhận phép gộp "Tổng". Chỉ nhận: "Đếm giá trị khác nhau".» | Đạt |
| TD-05 | Cột số vẫn nhận đủ phép gộp cũ — Canh cửa: bảng tra mới không được cắt mất đường cũ | Tổng Lợi nhuận vẫn 709.352 | HTTP 200; tổng = 709.352 · lệch 0.0000 | Đạt |
| TD-06 | Cột boolean không còn tự thành thước đo cộng — Trước bản này 7 trên 14 thước đo tự gieo của tổ chức 4 là phép cộng vô nghĩa | Vai trò là chiều; không có mặt trong danh sách thước đo | "Da tra hang" kiểu Nullable(UInt8), vai trò "dimension"; thước đo tự gieo chỉ còn [Số dòng, Loi nhuan] | Đạt |
| TD-07 | Bộ chọn Explorer nói rõ đổi được sang những phép nào — Danh sách phải khớp đúng các biến thể đã phát ra trong file cube | Kèm phép đang khai và danh sách phép thay thế | "Loi nhuan": phép đang khai = "sum", đổi được sang [sum, avg, min, max, countDistinct] | Đạt |
| TD-08 | Đổi phép ngay trong truy vấn cho ra con số của phép mới — So SỐ chứ không so mã trạng thái: nếu backend lặng lẽ lùi về sum thì HTTP vẫn 200 | 709.352 / 5 = 141.8704 | HTTP 200, Cube trả 141.8704 · lệch 0.0000; nhãn cột = "Loi nhuan (Trung bình)" | Đạt |
| TD-09 | Mô hình không bị đổi theo — lựa chọn chỉ áp cho truy vấn đó — Một cú bấm ở Explorer sửa cấu hình chung là thứ người thứ hai không có cách nào biết | Phép trong mô hình vẫn là sum; hỏi lại ra tổng cũ | phép trong mô hình vẫn "sum"; hỏi lại không kèm gì → 709.352 | Đạt |
| TD-10 | Phép không hợp kiểu bị từ chối kể cả khi gửi thẳng vào truy vấn — Bỏ qua giao diện, gọi API trực tiếp | 400, không âm thầm lùi về phép mặc định | HTTP 400 DataModelFieldUnknown: «Thước đo "Khu vuc" không nhận phép gộp "Tổng".» | Đạt |
| TD-11 | Trung vị và phân vị 90 có trong danh sách phép đổi được — Cube không có kiểu cho chúng — phải phát ra bằng biểu thức quantileExact | Cột số mời đủ 7 phép | "Loi nhuan" đổi được sang [sum, avg, median, p90, min, max, countDistinct] | Đạt |
| TD-12 | Trung vị trên mô hình một bảng khớp ClickHouse — Đối chiếu với quantileExact chạy thẳng trên kho, không với số tính tay — để biết lệch nằm ở tầng Cube hay ở chính phép của ClickHouse | Hai bên ra cùng một số | Cube trả 0.402; ClickHouse quantileExact(0.5) = 0.402; lệch 0.0000 | Đạt |
| TD-13 | Trung vị KHÔNG bị nhân dòng qua quan hệ one_to_many — Rủi ro lớn nhất của bản này: cơ chế khử trùng lặp của Cube có tài liệu cho kiểu dựng sẵn, không nói gì về biểu thức tự viết. Bàn thử lệch có chủ đích — 3 khách Diem 10/20/30, khách đầu có 5 đơn, gộp theo một cột hằng | Tổng 60 (không phải 100); trung vị 20 (không phải 10) | tổng = 60 · trung vị = 20 — biểu thức tự viết ĐƯỢC hưởng cùng cơ chế khử trùng lặp | Đạt |
| TD-14 | Nhãn cột nói tên người dùng đọc được, không phải tên thống kê — "Phân vị 90" là tên đúng và là tên vô dụng với người đọc báo cáo bán hàng — ghim cái tên đi hết đường từ shared qua explorer.ts ra tới phản hồi API | Nhãn cột là "Loi nhuan (Ngưỡng top 10%)" | nhãn cột = "Loi nhuan (Ngưỡng top 10%)" | Đạt |
| TD-15 | Hai truy vấn mà khối cảnh báo lệch đem ra so — Phần so sánh chạy ở trình duyệt nên không tới được từ đây, nhưng nếu hai con số này sai thì mọi thứ dựng trên chúng sai theo | Trung bình 141,8704 và trung vị 0,402 — lệch quá ngưỡng 50 % | trung bình = 141.8704, trung vị = 0.402, lệch 351,9 lần | Đạt |
| TD-16 | Đếm ô có dữ liệu khác đếm dòng — lý do phép này được mở lại — Bản trước cấm hẳn count trên cột vì tin nó chỉ đẻ ra bản sao của "Số dòng". Tiền đề đó sai: count(<cột>) bỏ qua NULL | Trên bàn thử 5 dòng có 2 ô trống: Số dòng 5, đếm ô có dữ liệu 3, tổng 90 | Số dòng = 5 · đếm ô có dữ liệu = 3 · tổng = 90 | Đạt |
| TD-17 | Gộp trên biểu thức dòng: nhân TRƯỚC rồi cộng — Ca canh cửa cho V-07 — đối chiếu tới tận ClickHouse | 860 (công thức gộp-trước cho 1265) | Cube trả 860 · ClickHouse sum(sl × đơn giá) = 860 | Đạt |
| TD-18 | Biểu thức dòng KHÔNG bị nhân bản qua quan hệ one_to_many — Câu để ngỏ từ TD-13: biểu thức TỰ VIẾT có được Cube khử trùng lặp không | 410 — mặt hàng H1 nằm trong 4 đơn, không được đếm 4 lần | gộp theo Kenh (1 nhóm, 5 dòng đã nối): 410 (nhân dòng sẽ là 1010) | Đạt |
| TD-19 | Bộ chọn Explorer nói ra phép tính thay vì để người dùng đoán từ cái tên — Thước đo gieo sẵn trùng tên với cột nó gộp — hai dòng chữ y hệt, hai nghĩa khác nhau | nguon = cột "Loi nhuan"; tiêu đề cột kết quả ghi "Trung vị của Loi nhuan" khi truy vấn hỏi bằng trung vị | nguon = {"kind":"column","expr":"Loi nhuan"} · mô tả cột kết quả = "Trung vị của Loi nhuan" · "Số dòng" có kind = rows | Đạt |
| TD-20 | Tên thước đo đã xoá dùng lại được — tên đang sống thì không — Ca canh cửa cho V-08, đi CẢ HAI chiều | tạo lại cùng tên → 201; trùng tên đang sống → 409 (không phải 500) | tạo lần 1 = 201 · xoá = 204 · tạo lại cùng tên = 201 (trước bản vá: 500) · trùng tên đang sống = 409 | Đạt |

## HT · Console vận hành hệ thống — 14 ca, đối chiếu bộ tự động

| Mã | Mục tiêu | Kết quả mong đợi | Kết quả thực tế | KL |
|---|---|---|---|---|
| HT-01 | Token tự xưng superadmin nhưng database nói không — admin.integration.test.ts | 403 — đọc lại quyền từ database mỗi lần | Đạt trong lần chạy 19/08 | Đạt |
| HT-02 | Superadmin vừa bị hạ quyền, token còn hạn | 403 ngay, không đợi token hết hạn | Đạt | Đạt |
| HT-03 | Tài khoản bị khoá gọi console | 401, không phải 403 | Đạt | Đạt |
| HT-04 | Tổng quan hệ thống đếm xuyên mọi tổ chức, tách riêng phần đã khoá | Số liệu đúng, phần khoá đếm riêng | Đạt | Đạt |
| HT-05 | Biểu đồ tăng trưởng lấp đủ ngày trống | Không nhảy cóc ngày | Đạt | Đạt |
| HT-06 | Không gian cá nhân bị ẩn khỏi danh sách mặc định | Mặc định chỉ hiện công ty thật; kind=all hiện cả hai | Đạt (5 ca con) | Đạt |
| HT-07 | kind ngoài danh sách cho phép | 400, không lặng lẽ về mặc định | Đạt | Đạt |
| HT-08 | Ký tự đại diện LIKE trong ô tìm kiếm | Bị thoát, không lọt qua nguyên vẹn | Đạt | Đạt |
| HT-09 | Phân trang danh sách tổ chức | Không lặp và không bỏ sót dòng nào | Đạt | Đạt |
| HT-10 | Không khoá và không xoá được chính tổ chức đang đăng nhập | Từ chối | Đạt | Đạt |
| HT-11 | Xoá công ty còn workspace | 409 kèm số lượng phải dọn trước | Đạt | Đạt |
| HT-12 | Khoá công ty thì thành viên của nó mất phiên | Phiên bị chặn ngay | Đạt | Đạt |
| HT-13 | Hệ thống không bao giờ còn 0 quản trị viên hoạt động — 4 ca con về luật superadmin cuối cùng | Chặn thao tác cuối cùng làm mất hết quản trị | Đạt | Đạt |
| HT-14 | Xoá mềm người dùng: email vẫn bị giữ chỗ, và họ bị gỡ khỏi mọi tổ chức | Biến khỏi danh sách nhưng email không tái sử dụng được | Đạt | Đạt |

## TO · Tổ chức, workspace và thành viên — 18 ca, đối chiếu bộ tự động

| Mã | Mục tiêu | Kết quả mong đợi | Kết quả thực tế | KL |
|---|---|---|---|---|
| TO-01 | Mọi endpoint đều có lớp gác quyền — tenant.integration.test.ts · bảng route | Không endpoint nào lọt lưới | Đạt | Đạt |
| TO-02 | Superadmin làm viewer trong một tổ chức | Vẫn bị chặn như viewer, không đi tắt | Đạt | Đạt |
| TO-03 | Token ghi admin nhưng database đã hạ xuống viewer | 403 — đọc lại vai trò từ database | Đạt | Đạt |
| TO-04 | Đã bị gỡ khỏi tổ chức | 401, không phải 403 | Đạt | Đạt |
| TO-05 | Chỉ thấy workspace và thành viên của tổ chức mình | Danh sách bị cắt theo tổ chức | Đạt | Đạt |
| TO-06 | Sửa workspace của tổ chức khác | 404, không phải 403 | Đạt | Đạt |
| TO-07 | Trang chủ không truyền workspaceId | Backend tự chọn cái đầu tiên và trả về cho client biết | Đạt | Đạt |
| TO-08 | Workspace bị quản trị hệ thống khoá | 403, không lặng lẽ đổi sang workspace khác | Đạt | Đạt |
| TO-09 | Không còn workspace nào dùng được | 409 NoWorkspace | Đạt | Đạt |
| TO-10 | Đổi tên tổ chức | Đổi được tên, slug không đổi theo | Đạt | Đạt |
| TO-11 | Xoá workspace cuối cùng, hoặc workspace còn báo cáo | 409, không xoá lan sang nội dung | Đạt | Đạt |
| TO-12 | Mời người bằng email chưa có tài khoản | Tạo tài khoản kèm mật khẩu tạm, hiện đúng một lần | Đạt | Đạt |
| TO-13 | Mời người đã có tài khoản ở tổ chức khác | Gắn vào, không cấp mật khẩu mới, không đụng vai trò bên kia | Đạt | Đạt |
| TO-14 | Tài khoản mới được cấp kèm một không gian cá nhân — 7 ca con | Hai membership; đăng nhập lần đầu vào tổ chức được mời | Đạt | Đạt |
| TO-15 | Không tự đổi vai trò, tự khoá hay tự gỡ chính mình; không hạ cấp admin cuối cùng | Chặn cả bốn thao tác | Đạt | Đạt |
| TO-16 | Khoá thành viên chỉ đụng memberships.is_active, không đụng users.is_active | Phạm vi khoá đúng một tổ chức | Đạt | Đạt |
| TO-17 | Cấp lại mật khẩu tạm — 8 ca con | Mật khẩu cũ chết ngay; từ chối với danh tính dùng chung (409), với quản trị hệ thống (403), với chính mình (403) | Đạt | Đạt |
| TO-18 | Đổi tổ chức — 11 ca con | Token mới chỉ mở tổ chức mới; vai trò mới được thực thi chứ không chỉ hiển thị | Đạt | Đạt |

## KN · Kết nối CSDL và kho dữ liệu (§8) — 12 ca, đối chiếu bộ tự động

| Mã | Mục tiêu | Kết quả mong đợi | Kết quả thực tế | KL |
|---|---|---|---|---|
| KN-01 | Kiểm tra kết nối tới MySQL thật — datasets.integration.test.ts | Trả phiên bản máy chủ, mở nút Lưu | Đạt | Đạt |
| KN-02 | Nhập sai mật khẩu CSDL nguồn | Thông báo tiếng Việt đọc được, không phải chuỗi lỗi thư viện | Đạt | Đạt |
| KN-03 | Tên miền không phân giải được | 400 kèm lý do, không phải 500 | Đạt | Đạt |
| KN-04 | Host chứa ký tự lạ | Bị chặn ngay ở tầng schema | Đạt | Đạt |
| KN-05 | Để trống ô database | Nghĩa là "mọi database", không phải thiếu dữ liệu | Đạt | Đạt |
| KN-06 | Cờ SSL nhận chuỗi "false" | Từ chối — Boolean("false") là true, đây là bẫy đã biết | Đạt | Đạt |
| KN-07 | Mật khẩu CSDL được mã hoá AES-256-GCM khi lưu | Cột trong database là bản mã, không phải bản rõ | Đạt | Đạt |
| KN-08 | Đồng bộ lần hai cùng bộ bảng | Báo "không đổi", kho không nhân đôi | Đạt | Đạt |
| KN-09 | Đổi tên một bộ dữ liệu rồi đồng bộ lại | Tên người dùng đặt vẫn còn | Đạt | Đạt |
| KN-10 | Xoá kết nối khi còn bộ dữ liệu | 409 kèm số lượng phải dọn trước | Đạt | Đạt |
| KN-11 | Xem trước dữ liệu đọc thẳng từ CSDL nguồn | 100 dòng đầu, nền tảng không giữ bản sao | Đạt | Đạt |
| KN-12 | Xoá bộ dữ liệu không đụng tới bảng trong ClickHouse — Điều kiện để xoá mềm hoàn tác được | listKnownIds vẫn giữ bộ đã xoá mềm | Đạt — và xác nhận lại bằng tay: bảng raw_t2_d83 còn nguyên sau khi xoá | Đạt |

## DL · Đọc file và suy kiểu dữ liệu — 12 ca, đối chiếu bộ tự động

| Mã | Mục tiêu | Kết quả mong đợi | Kết quả thực tế | KL |
|---|---|---|---|---|
| DL-01 | Hai quy ước dấu phân cách hàng nghìn — inferType.test.ts | 1.234.567 → 1234567 · 1.234,56 → 1234.56 · 1.234 → 1.234 | Đạt | Đạt |
| DL-02 | -288.765 phải đọc thành −288.765, không phải −288765 | Giữ nguyên giá trị | Đạt — và xác nhận lại đầu-cuối ở NA-03 | Đạt |
| DL-03 | Số 0 đứng đầu (mã bưu chính, mã đơn) | Giữ nguyên là text, không cắt số 0 | Đạt | Đạt |
| DL-04 | Một ô lệch kiểu trong cột số | Cả cột thành text — không âm thầm bỏ ô đó | Đạt | Đạt |
| DL-05 | Cột boolean chỉ nhận chữ, không nhận 0/1 | 0/1 vẫn là số | Đạt | Đạt |
| DL-06 | Ô trống và ô ngày | Ô trống không làm hỏng suy kiểu; ngày nhận cả ISO và d/m/y | Đạt | Đạt |
| DL-07 | Kiểm định dạng file bằng magic bytes — dataset.integration.test.ts §7.3 | Không tin phần mở rộng do client khai | Đạt | Đạt |
| DL-08 | Đọc CSV khó: dấu phẩy trong ô, xuống dòng trong ô | Tách cột đúng | Đạt | Đạt |
| DL-09 | File vượt trần số dòng | Cắt và báo rõ đã cắt, không im lặng | Đạt | Đạt |
| DL-10 | Ánh xạ kiểu MySQL và kiểu ngữ nghĩa sang kiểu ClickHouse — ingestTypeMap.test.ts · 25 ca | Đọc đúng độ chính xác của decimal(p,s); ngày dùng DateTime64(3,'UTC') | Đạt | Đạt |
| DL-11 | Thoát tên định danh khi sinh DDL: tên cột chứa dấu backtick | Backtick bên trong được nhân đôi | Đạt | Đạt |
| DL-12 | Đọc dòng từ file Excel bằng bộ đọc dạng dòng — ingest.integration.test.ts | Ô ngày ra đúng ngày, không phải số sê-ri Excel | Đạt ổn định sau bản vá V-04 — bộ đọc dòng hỏng thì lùi về đọc cả file | Đạt — đã sửa V-04 |
| DL-13 | Sheet vẫn tìm ra khi quan hệ ghi đường dẫn tuyệt đối — Ca canh cửa cho V-06 — file kiểu openpyxl | Đọc đúng sheet thứ hai theo TÊN, không phải sheet đầu | Đọc đúng dòng của sheet "Don" | Đạt |
| DL-14 | Bộ đọc dòng ném lỗi thì lùi về đọc cả file — Ca canh cửa cho V-04 — workbook toàn số, tái hiện CHẮC CHẮN | Lần nạp vẫn ra đúng dữ liệu, không hỏng | Đọc đúng dòng của sheet "Tra hang"; gỡ đường lùi ra thì đỏ ngay lần chạy đầu | Đạt |

## GD · Giao diện người dùng — 8 ca, đối chiếu bộ tự động

| Mã | Mục tiêu | Kết quả mong đợi | Kết quả thực tế | KL |
|---|---|---|---|---|
| GD-01 | Chặn quản trị tổ chức vào route /admin — AdminRoute.test.tsx — lỗ hổng đã từng có | Bị chặn ở tầng giao diện | Đạt | Đạt |
| GD-02 | Quản trị hệ thống vào /admin dù vai trò tổ chức thấp | Cho vào | Đạt | Đạt |
| GD-03 | Bắt buộc đổi mật khẩu tạm | Chặn tất cả, kể cả tham số from và quyền hệ thống | Đạt | Đạt |
| GD-04 | Điều hướng sau đăng nhập — redirectTarget.test.ts | Mọi vai trò về trang chủ; vẫn tôn trọng from khi đó là trang cụ thể | Đạt | Đạt |
| GD-05 | Đổi bộ lọc danh sách — useListQueryState.test.tsx | Đưa về trang 1; đổi trang thì giữ nguyên trang | Đạt | Đạt |
| GD-06 | Giá trị lọc ngoài danh sách trắng trên URL | Bỏ qua, về mặc định, không ném lỗi | Đạt | Đạt |
| GD-07 | Trình tải file dưới StrictMode của React | Instance vẫn sống và thật sự bắt đầu tải sau khi gắn lại | Đạt | Đạt |
| GD-08 | Chọn file sai đuôi ở trình tải | Chặn tại chỗ, không tốn một vòng mạng nào | Đạt | Đạt |

---

**Tổng cộng: 147/147 ca đạt.**
