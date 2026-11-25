import type { BaoCaoChiaSeDto, ReportShareCreatedDto, ReportShareDto } from '@bi/shared';
import axios from 'axios';

import { apiClient } from '../../../services/apiClient';

/**
 * Chia sẻ báo cáo bằng liên kết — mong muốn D5.
 *
 * Ba lời gọi đầu đi qua `apiClient` (có token, có xử lý 401). Lời gọi CÔNG KHAI
 * thì KHÔNG: xem ghi chú ở `docBaoCaoChiaSe`.
 */

export async function taoLienKet(
  reportId: number,
  soNgay: number | null,
): Promise<ReportShareCreatedDto> {
  const { data } = await apiClient.post<ReportShareCreatedDto>(
    `/v1/reports/${String(reportId)}/shares`,
    { soNgay },
  );
  return data;
}

export async function docLienKet(reportId: number): Promise<ReportShareDto[]> {
  const { data } = await apiClient.get<{ items: ReportShareDto[] }>(
    `/v1/reports/${String(reportId)}/shares`,
  );
  return data.items;
}

export async function thuHoiLienKet(reportId: number, shareId: number): Promise<void> {
  await apiClient.delete(`/v1/reports/${String(reportId)}/shares/${String(shareId)}`);
}

/**
 * Đọc báo cáo bằng CHUỖI chia sẻ — không có phiên đăng nhập nào.
 *
 * ⚠️ `axios` thẳng, KHÔNG dùng `apiClient`, và lý do ĐÃ ĐO được là đúng một
 * điều: `apiClient` gắn header `Authorization` từ token trên đĩa.
 *
 * Trang chia sẻ mở được bởi người không có tài khoản, nhưng cũng được mở bởi
 * người ĐANG đăng nhập — người gửi gần như luôn bấm thử liên kết của mình.
 * Dùng `apiClient` thì lời gọi ấy mang token của họ lên một route công khai:
 * hai danh tính trong một lời gọi, và từ đó không ai biết route ấy có thật sự
 * chạy được mà không có token hay không.
 *
 * Bản đầu của chú thích này còn nêu lý do thứ hai — "interceptor 401 đá người
 * xem về /login". Đã KIỂM và nó KHÔNG đúng: route công khai không bao giờ trả
 * 401, còn 404/410 thì interceptor không chạm tới. Bỏ đi thay vì giữ một lý do
 * nghe hợp lý mà sai.
 *
 * Khẳng định còn lại được canh bằng `e2e/chia-se.spec.ts` (chặn request rồi đọc
 * header). Trước khi có dòng đó, đột biến "đổi sang `apiClient`" đi qua cả bộ
 * e2e — vì trình duyệt sạch không có token nào để gắn.
 */
export async function docBaoCaoChiaSe(chuoi: string, trang?: string): Promise<BaoCaoChiaSeDto> {
  const { data } = await axios.get<BaoCaoChiaSeDto>(
    `${apiClient.defaults.baseURL ?? ''}/public/reports/${encodeURIComponent(chuoi)}`,
    { params: trang === undefined ? undefined : { trang } },
  );
  return data;
}
