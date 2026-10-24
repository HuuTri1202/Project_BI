import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '../src/services/apiClient';
import { dienDatLai, hieuCauHoi, xoaNhoPhien } from '../src/features/chat/api';

/**
 * NHỚ TRONG PHIÊN — cùng một câu hỏi thì cùng một câu trả lời.
 *
 * ─── Vấn đề đo được ─────────────────────────────────────────────────────────
 *
 * Chạy đúng một bộ 25 câu hai lần, cùng mô hình, cùng `temperature: 0`: một
 * câu đổi đáp án. 4% trôi mà không có gì đổi ở đầu vào.
 *
 * 4% nghe nhỏ, nhưng nó rơi đúng vào thói quen tệ nhất: người dùng không tin
 * một câu trả lời thì họ GÕ LẠI Y HỆT để kiểm — và nhận về câu khác.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Hai chốt, và cái thứ hai mới là chốt khó:
 *
 *   1. Hỏi lại thì KHÔNG gọi mạng nữa, và trả đúng câu cũ.
 *   2. Lượt GỌI HỎNG thì KHÔNG được nhớ. Nhớ nó lại là khoá chặt câu hỏi đó ở
 *      trạng thái hỏng cho tới hết phiên, kể cả sau khi mạng đã về — biến một
 *      trục trặc một phút thành một trục trặc cả buổi.
 */
describe('Nhớ trong phiên', () => {
  beforeEach(() => {
    xoaNhoPhien();
    vi.restoreAllMocks();
  });

  const NHAN = ['Số dòng của Orders', 'Dung lượng của Orders'];

  it('hỏi lại cùng câu, cùng nhãn: KHÔNG gọi mạng lần hai', async () => {
    const goi = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { chon: 1, trangThai: 'da-doc' } } as never);

    const a = await hieuCauHoi({ cauHoi: 'nặng bao nhiêu', nhan: NHAN });
    const b = await hieuCauHoi({ cauHoi: 'nặng bao nhiêu', nhan: NHAN });

    expect(goi).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  /*
   * ⚠️ Khoá phải gồm cả DANH SÁCH NHÃN, không chỉ câu hỏi. Cùng một câu trên
   * hai trang khác nhau là hai câu hỏi khác nhau — "cái này bao nhiêu" ở Kho
   * dữ liệu và ở trang báo cáo không trỏ vào cùng một thứ.
   */
  it('cùng câu nhưng khác danh sách nhãn thì vẫn gọi lại', async () => {
    const goi = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { chon: 0, trangThai: 'da-doc' } } as never);

    await hieuCauHoi({ cauHoi: 'bao nhiêu', nhan: NHAN });
    await hieuCauHoi({ cauHoi: 'bao nhiêu', nhan: ['Số cột của Khách hàng'] });

    expect(goi).toHaveBeenCalledTimes(2);
  });

  it('lượt GỌI HỎNG thì không nhớ — mạng về là hỏi lại được', async () => {
    const goi = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ data: { chon: null, trangThai: 'goi-hong' } } as never)
      .mockResolvedValueOnce({ data: { chon: 1, trangThai: 'da-doc' } } as never);

    const hong = await hieuCauHoi({ cauHoi: 'nặng bao nhiêu', nhan: NHAN });
    const ve = await hieuCauHoi({ cauHoi: 'nặng bao nhiêu', nhan: NHAN });

    expect(hong.trangThai).toBe('goi-hong');
    expect(ve.chon).toBe(1);
    expect(goi).toHaveBeenCalledTimes(2);
  });

  it('câu viết lại cũng nhớ, nên cùng một câu đọc ra cùng một chữ', async () => {
    const goi = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { cau: 'Cao nhất là Miền Nam, 500.' } } as never);
    const vao = { cauHoi: 'cao nhất', cau: 'Miền Nam: 500.', so: ['500'] };

    await dienDatLai(vao);
    const lai = await dienDatLai(vao);

    expect(goi).toHaveBeenCalledTimes(1);
    expect(lai).toBe('Cao nhất là Miền Nam, 500.');
  });

  /*
   * Backend trả nguyên `cau` khi chưa cấu hình, khi gọi hỏng, hoặc khi luật
   * đối chiếu bác bản viết lại. Nhớ mấy trường hợp đó lại nghĩa là câu này
   * vĩnh viễn không được viết lại nữa trong phiên, kể cả sau khi nhà cung cấp
   * đã sống lại.
   */
  it('viết lại KHÔNG đổi gì thì không nhớ', async () => {
    const goi = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { cau: 'Miền Nam: 500.' } } as never);
    const vao = { cauHoi: 'cao nhất', cau: 'Miền Nam: 500.', so: ['500'] };

    await dienDatLai(vao);
    await dienDatLai(vao);

    expect(goi).toHaveBeenCalledTimes(2);
  });
});
