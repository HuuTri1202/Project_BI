/**
 * Hằng số dùng chung của khung hỏi đáp (§chat).
 *
 * ═══ Vì sao `TRAN_NHAN` nằm ở `@bi/shared` ═════════════════════════════════
 *
 * Nó có BA chỗ đọc, và cả ba phải nói cùng một con số:
 *
 *   `frontend/.../chat/HoiDapPanel.tsx`   cắt danh sách TRƯỚC khi gửi đi
 *   `backend/.../api/v1/schemas.ts`       chặn thân request quá khổ
 *   `backend/.../chat/hieuY.ts`           cắt lần nữa trước khi gọi mô hình
 *
 * Trước bản này chỉ hai chỗ sau biết tới con số. Phía client không biết, nên
 * nó gửi nguyên danh sách — mà ở trình dựng báo cáo danh sách ấy vượt 60 rất
 * dễ (`duKienMoHinh` một mình đã đẩy ra hàng trăm nhãn). Zod chặn TRƯỚC khi
 * `hieuY` kịp cắt, nên mọi lượt gọi đều nhận 400:
 *
 *   26/11 08:07  POST /chat/hieu-y  400   /datamodels/6/report/new
 *   26/11 08:15  POST /chat/hieu-y  400   /reports/3/edit
 *
 * LỖI ĐO ĐƯỢC, và nó nuốt trọn lớp mô hình: 100 % lượt gọi `hieu-y` trong
 * production chưa từng tới được `hieuY`. Tệ hơn, `ghiTruot` đứng SAU
 * `schema.parse` nên sổ câu trượt cũng không ghi được dòng nào — cái máy đo
 * độ phủ bị chính con lỗi này bịt miệng.
 *
 * Cùng lý do `chieuSoSanh` và `LATE_PAYMENT_WINDOW_HOURS` nằm ở đây: một luật
 * có nhiều chỗ đọc mà giữ nhiều bản sao thì lệch nhau ở lần sửa đầu tiên.
 *
 * ⚠️ Phép cắt giữ phần ĐẦU danh sách, nên thứ tự dựng danh sách ở client là
 * một quyết định thật, không phải tình cờ — xem khối chú thích ở `HoiDapPanel`
 * về việc xếp cặp VẼ lên trước.
 */
export const TRAN_NHAN = 60;
