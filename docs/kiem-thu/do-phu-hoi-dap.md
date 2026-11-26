# Độ phủ của trợ lý dữ liệu — đo, chứ không vá

## Vấn đề mà tài liệu này tồn tại để giải

Trợ lý trả lời sai một câu → sửa câu đó. Người dùng khác hỏi câu khác → lại sửa.
Hệ thống hướng tới **nhiều ngành**, nên danh sách câu hỏi có thể gặp là vô hạn,
và vá từng ca là một vòng lặp **không có điểm dừng**.

Lối thoát không phải là liệt kê nhiều ca hơn. Nó là ba thứ:

1. danh sách trả lời được **sinh từ dữ liệu**, không chép cứng theo ngành;
2. lớp so khớp **chịu được diễn đạt lạ**;
3. một **con số** nói hôm nay phủ tới đâu, và một **nguồn ca mới** nằm ngoài
   trí tưởng tượng của người viết test.

Mục 1 và 2 là kiến trúc. Mục 3 là tài liệu này.

---

## 1. Bốn lớp, và vì sao không lớp nào biết "ngành" là gì

| Lớp                        | Nằm ở                                          | Cơ chế                                                          |
| -------------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| 1. Dựng lựa chọn           | `features/chat/traLoi.ts` · `duKienTrang.ts`   | Sinh từ `duKien` + nhãn chiều/thước đo của chính bảng đang hiện |
| 2. So từ khoá              | `traLoi.ts` (`traLoiKhung`)                    | Chạy trong trình duyệt, không cần mạng                          |
| 3. Mô hình chọn một chỉ số | `POST /chat/hieu-y` → `services/chat/hieuY.ts` | Mô hình **chỉ thấy tên trường, không thấy số liệu**             |
| 4. Từ chối trung thực      | `HoiDapPanel` (`hetDuong`)                     | Nói "chưa hiểu" + gợi ý, không bịa                              |

Lớp 1 là lý do độ phủ **không** tỉ lệ với số ngành: mô hình bán hàng và mô hình
kho vận đều tự sinh ra lựa chọn của mình. Lớp 3 là lý do nó chịu được từ đồng
nghĩa và câu nói vòng. Lớp 4 là lý do một câu trượt không trở thành một con số
sai.

⚠️ **Lớp 3 trả về đúng MỘT chỉ số.** Câu nào mà đáp án là _nhiều dữ kiện ghép
lại_ ("báo cáo này nói về gì") thì không mô hình nào cứu được — danh sách không
có mục tương ứng. Muốn phủ nhóm đó thì thêm một **luật sinh** ở lớp 1 (mỗi nguồn
tự sinh thêm một lựa chọn tổng hợp), chứ không thêm ca.

---

## 2. Bảng điểm

```bash
npm --workspace frontend run danh-gia
```

Chạy ngoại tuyến, không cần server, không gọi mô hình. Nó đẩy một danh sách câu
hỏi thật qua đúng chuỗi thật của lớp 1 + lớp 2 rồi đếm.

### Ba kết cục, không phải hai

|               | Nghĩa                                                                                 |
| ------------- | ------------------------------------------------------------------------------------- |
| **ĐÚNG**      | Trả lời, và con số/cái tên trong đó đúng                                              |
| **CHƯA HIỂU** | Trả `null`. Trượt, nhưng **trung thực** — người dùng biết ngay phải hỏi lại cách khác |
| **SAI**       | Trả lời, mà con số hoặc cái tên sai                                                   |

**SAI là kết cục nguy hiểm duy nhất**: một con số có thật, định dạng đẹp, trả
lời cho một câu hỏi khác — không có dấu hiệu nào để nhận ra. Gộp "chưa hiểu" vào
"sai" thành một con số "độ chính xác" là xoá mất đúng phần đáng sợ.

### Rãnh răng — chỉ được sửa LÊN

`danhGia.test.ts` chốt hai ngưỡng: số câu ĐÚNG không được tụt, và số câu SAI
phải bằng **0**. Thấy một ngưỡng bị sửa xuống trong diff nghĩa là thay đổi đó
đang đổi câu này lấy câu kia mà không nói ra.

### ⚠️ 100 % KHÔNG có nghĩa là xong

Hôm nay bảng điểm là **281/281**. Con số đó nói:

> trên 281 câu **do chính người viết nghĩ ra**, lớp ngoại tuyến không trượt câu nào.

Nó **không** nói:

- người dùng ngành khác hỏi kiểu khác thì sao — chưa có ca nào của họ ở đây;
- đường HTTP có chạy không — bộ này gọi thẳng hàm, không đi qua API. Một lỗi
  400 ở `/chat/hieu-y` vẫn để bảng điểm xanh 100 % (và đã từng, xem §4);
- lớp mô hình chọn đúng bao nhiêu — bộ này cố ý chạy ngoại tuyến.

**Một bảng điểm đứng ở 100 % là dấu hiệu bộ câu hỏi đã cạn, không phải dấu hiệu
hệ thống đã xong.** Việc tiếp theo luôn là nạp thêm câu thật, không phải ăn mừng.

---

## 3. Nguồn ca mới: sổ câu người thật hỏi mà khung bó tay

Mỗi lần lớp 2 trượt, `POST /chat/hieu-y` ghi một dòng — xem `ghiTruot` trong
`services/chat/hieuY.ts`:

```
2026-11-26T08:07:24.511Z    CHƯA HIỂU    bạn có hiểu báo cáo này nói về gì không
2026-11-26T08:15:50.102Z    Số dòng của Orders    orders có mấy dòng
```

Cột giữa là nhãn mô hình đã chọn, hoặc `CHƯA HIỂU` khi không chọn được. **Đây là
thứ duy nhất nói được người dùng thật đang hỏi gì mà hệ thống bó tay** — và nó
không phụ thuộc trí tưởng tượng của ai.

Lấy về từ máy chủ:

```bash
gcloud compute ssh open-insight --project=open-insight-65117 \
  --zone=asia-southeast1-a --tunnel-through-iap \
  --command="cat ~/open-insight/infrastructure/so-chat/chua-hieu.tsv" \
  > so-chat-$(date +%F).tsv
```

Xếp theo câu hỏi hay gặp nhất:

```bash
cut -f3 so-chat-*.tsv | sort | uniq -c | sort -rn | head -30
```

---

## 4. Vòng lặp

```
   ┌─ người dùng thật hỏi ─────────────────────────┐
   │                                               │
   ▼                                               │
 lớp 2 trượt ──► ghiTruot ──► chua-hieu.tsv        │
                                   │               │
                                   ▼               │
                      xếp theo tần suất            │
                                   │               │
                                   ▼               │
                     thêm ca vào danhGia.test.ts   │
                                   │               │
                                   ▼               │
                       ca ĐỎ ──► sửa LUẬT, không   │
                                  sửa riêng ca ────┘
```

Quy tắc quan trọng nhất nằm ở mũi tên cuối: **một ca đỏ được sửa bằng một luật
chung, không bằng một nhánh `if` cho đúng câu đó.** Ca là bằng chứng, không phải
đặc tả.

### Chuyện đã xảy ra, để không lặp lại

Ngày 26/11/2026, mọi lượt gọi `/chat/hieu-y` trong production đều nhận **400**:

```
08:07:24  POST /api/v1/chat/hieu-y  400   /datamodels/6/report/new
08:15:50  POST /api/v1/chat/hieu-y  400   /reports/3/edit
```

Nguyên nhân: con số 60 (`TRAN_NHAN`) có ba chỗ đọc mà client không biết, nên nó
gửi nguyên danh sách và `z.max(60)` từ chối cả thân request. Hệ quả kép:

1. **lớp 3 chưa từng chạy một lần nào** trong production;
2. `ghiTruot` đứng **sau** `schema.parse`, nên sổ câu trượt **trống trơn** — máy
   đo bị chính con lỗi này bịt miệng.

Trong suốt thời gian đó bảng điểm vẫn **100 %**. Đó là bài học cụ thể nhất của
tài liệu này: bảng điểm đo lớp 1 + 2, nên nó **không thể** thấy lớp 3 đã tắt.
Kiểm lớp 3 còn sống bằng log thật, không bằng bảng điểm:

```bash
docker logs bi-api 2>&1 | grep -c 'chat/hieu-y.*" 400 '    # phải là 0
docker logs bi-api 2>&1 | grep -c 'trượt lớp ngoại tuyến'  # >0 nghĩa là sổ đang chạy
```

---

## 5. Thứ CỐ Ý nằm ngoài phạm vi

Trợ lý **mô tả và tính** trên dữ liệu đang có. Nó **không diễn giải ý nghĩa kinh
doanh** — hệ thống không có lớp ngữ nghĩa nào mô tả "Mã đơn" nghĩa là gì với
doanh nghiệp, nên mọi câu kiểu "con số này tốt hay xấu", "tôi nên làm gì" đều
phải rơi vào kết cục **CHƯA HIỂU**, không phải một câu trả lời nghe hợp lý.

Đây là ranh giới thiết kế, không phải thiếu sót chờ lấp. Ca kiểm tương ứng đã
nằm trong bộ đánh giá (`vì sao Acco bán ít`, `dự báo số lượng tháng sau`) và
chúng mong đợi `chua-hieu` — trả lời được mới là **SAI**.
