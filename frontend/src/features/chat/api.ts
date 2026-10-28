import type { ExplorerQueryDto } from '@bi/shared';

import { apiClient } from '../../services/apiClient';

const TRAN_NHO = 200;
const nho = new Map<string, unknown>();

function doc<T>(khoa: string): T | undefined {
  return nho.get(khoa) as T | undefined;
}

function ghi(khoa: string, gia: unknown): void {
  // Map giữ thứ tự chèn, nên khoá cũ nhất luôn đứng đầu — xoá nó là FIFO mà
  // không phải nuôi thêm một cấu trúc nào. Một phiên thật không bao giờ chạm
  // trần này; nó chỉ chặn một tab mở cả tuần phình mãi.
  if (nho.size >= TRAN_NHO) {
    const cu = nho.keys().next().value;
    if (cu !== undefined) nho.delete(cu);
  }
  nho.set(khoa, gia);
}

export function xoaNhoPhien(): void {
  nho.clear();
}

export async function dienDatLai(input: {
  cauHoi: string;
  cau: string;
  so: string[];
}): Promise<string> {
  const khoa = `dd:${JSON.stringify(input)}`;
  const da = doc<string>(khoa);
  if (da !== undefined) return da;

  const { data } = await apiClient.post<{ cau: string }>('/v1/chat/dien-dat', input);

  /*
   * Chỉ nhớ khi mô hình THẬT SỰ viết lại được.
   *
   * Backend trả nguyên `cau` khi chưa cấu hình, khi gọi hỏng, hoặc khi luật
   * đối chiếu bác bản viết lại. Nhớ mấy trường hợp đó lại nghĩa là câu này
   * vĩnh viễn không bao giờ được viết lại nữa trong phiên, kể cả sau khi nhà
   * cung cấp đã sống lại.
   */
  if (data.cau !== input.cau) ghi(khoa, data.cau);
  return data.cau;
}

export interface HieuCauHoiKetQua {
  chon: number | null;
  trangThai: 'chua-cau-hinh' | 'da-doc' | 'goi-hong';
}

export async function hieuCauHoi(input: {
  cauHoi: string;
  nhan: string[];
}): Promise<HieuCauHoiKetQua> {
  const khoa = `hy:${JSON.stringify(input)}`;
  const da = doc<HieuCauHoiKetQua>(khoa);
  if (da !== undefined) return da;

  const { data } = await apiClient.post<HieuCauHoiKetQua>('/v1/chat/hieu-y', input);

  // Chỉ nhớ khi mô hình đã đọc thật. Nhớ một lượt GỌI HỎNG lại là khoá chặt
  // câu hỏi đó ở trạng thái hỏng cho tới hết phiên, kể cả khi mạng đã về.
  if (data.trangThai === 'da-doc') ghi(khoa, data);
  return data;
}

export interface HoiTrenMoHinhKetQua {
  cau: string | null;
  so: string[];
  hieuLa: string | null;
  daHoi: boolean;
  lyDo: string | null;
  goiY: string[];
  truyVan: ExplorerQueryDto | null;
}

export async function hoiTrenMoHinh(
  moHinhId: number,
  cauHoi: string,
  boiCanh?: { cauHoi: string; truyVan: ExplorerQueryDto },
): Promise<HoiTrenMoHinhKetQua> {
  const { data } = await apiClient.post<HoiTrenMoHinhKetQua>(
    `/v1/datamodels/${String(moHinhId)}/chat/cau-hoi`,
    boiCanh === undefined ? { cauHoi } : { cauHoi, boiCanh },
  );
  return data;
}

export interface CotChon {
  id: number;
  nhan: string;
  loai: 'chieu' | 'thuoc do';
}

export interface ChonCotKetQua {
  chieu: number | null;
  thuocDo: number | null;
  daHoi: boolean;
}

export async function chonCot(input: { cauHoi: string; cot: CotChon[] }): Promise<ChonCotKetQua> {
  const khoa = `cc:${JSON.stringify(input)}`;
  const da = doc<ChonCotKetQua>(khoa);
  if (da !== undefined) return da;

  const { data } = await apiClient.post<ChonCotKetQua>('/v1/chat/chon-cot', input);
  if (data.daHoi) ghi(khoa, data);
  return data;
}
