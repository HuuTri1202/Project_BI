import { AxiosError, AxiosHeaders, CanceledError, type AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLIENT_ERROR_CODES, getApiError } from '../src/services/apiClient';

/**
 * Mọi lỗi phải đi ra khỏi đây với một câu ĐỌC ĐƯỢC và một mã ĐÚNG.
 *
 * ═══ Vì sao file này tồn tại ════════════════════════════════════════════════
 *
 * "Có lỗi không xác định. Vui lòng thử lại." từng là câu người dùng gặp thỉnh
 * thoảng mà không ai lần ra nguồn. Nguyên nhân thật: khi backend khởi động lại
 * (`tsx watch` làm việc đó sau mỗi lần lưu file), proxy của Vite trả
 * `500 text/plain` với thân RỖNG. Axios coi đó là một phản hồi hợp lệ, nên nhánh
 * "có response" chạy, không thấy `message`, và rơi vào câu chung.
 *
 * Nó khó tìm vì nó chỉ trúng những request bay đúng vào khe một hai giây, và vì
 * câu chữ không hề nhắc tới mạng hay máy chủ. Bài test đầu tiên dưới đây tái
 * hiện đúng phản hồi ấy — đo bằng axios thật, không phải dựng lại từ trí nhớ.
 *
 * ⚠️ `getApiError` là chỗ DUY NHẤT frontend đọc lỗi (108 nơi gọi nó, không nơi
 * nào chạm `response.data`). Nên một nhánh sót ở đây là một câu vô nghĩa ở cả
 * trăm màn hình cùng lúc.
 */

/** Dựng AxiosError kèm phản hồi — `headers` bắt buộc, axios không cho thiếu. */
function withResponse(status: number, data: unknown, contentType = 'application/json'): AxiosError {
  const headers = new AxiosHeaders();
  const config = { headers };
  const response = {
    status,
    statusText: '',
    data,
    headers: new AxiosHeaders({ 'content-type': contentType }),
    config,
  } as AxiosResponse;

  return new AxiosError('boom', String(status), config, {}, response);
}

/** Không có phản hồi nào — `code` phân biệt mất mạng với quá hạn chờ. */
function withoutResponse(code: string): AxiosError {
  return new AxiosError('boom', code, { headers: new AxiosHeaders() }, {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getApiError', () => {
  it('proxy Vite trả 500 text/plain rỗng -> nói backend đang khởi động lại', () => {
    // ĐÂY là ca đã sinh ra "Có lỗi không xác định". Hình dạng lấy từ lần đo
    // thật: status 500, content-type text/plain, `data` là chuỗi RỖNG.
    //
    // Sau khi `vite.config.ts` sửa, proxy trả 503 kèm JSON đúng khuôn — nhưng
    // ca này vẫn phải xanh: production không có proxy của Vite, và một gateway
    // khác hoàn toàn có thể trả về đúng hình dạng vô dụng này.
    const result = getApiError(withResponse(500, '', 'text/plain'));

    expect(result.message).not.toContain('không xác định');
    expect(result.message).toContain('500');
    expect(result.error).toBe(CLIENT_ERROR_CODES.SERVER);
  });

  it('proxy đã sửa: 503 kèm JSON đúng khuôn -> trả nguyên câu của nó', () => {
    // Thân này do `configure` trong `vite.config.ts` ghi ra. Nó đi qua nhánh
    // "đúng khuôn", nên người dùng đọc đúng câu hướng dẫn chạy `npm run dev`.
    const body = {
      error: 'BackendUnreachable',
      message: 'Không nối được tới backend ở http://localhost:4000.',
    };
    expect(getApiError(withResponse(503, body))).toEqual(body);
  });

  it('502/503/504 không đọc được thân -> nói tầng trung gian, kèm mã', () => {
    // nginx trả HTML khi không còn upstream nào sống. Phân biệt với 5xx thật
    // là chuyện đáng làm: một bên phải xem log backend, một bên thì không.
    for (const status of [502, 503, 504]) {
      const result = getApiError(withResponse(status, '<html>502 Bad Gateway</html>', 'text/html'));
      expect(result.error).toBe(CLIENT_ERROR_CODES.UNREACHABLE);
      expect(result.message).toContain(String(status));
    }
  });

  it('thân lỗi ĐÚNG KHUÔN của API đi qua nguyên vẹn, kèm cả `fields`', () => {
    const body = {
      error: 'ValidationError',
      message: 'Dữ liệu không hợp lệ.',
      fields: { name: 'Tên báo cáo không được để trống' },
    };
    expect(getApiError(withResponse(400, body))).toEqual(body);
  });

  it('`message` rỗng KHÔNG được coi là đọc được', () => {
    // Một hộp lỗi đỏ trống trơn còn tệ hơn một câu suy từ mã trạng thái.
    const result = getApiError(withResponse(500, { error: 'X', message: '   ' }));
    expect(result.message.trim()).not.toBe('');
    expect(result.message).toContain('500');
  });

  it('quá hạn chờ tách khỏi mất mạng — hai hệ quả khác nhau', () => {
    // Quá hạn: request CÓ THỂ đã tới nơi và đang chạy, nên câu chữ phải cảnh
    // báo trước khi người dùng bấm lại và tạo ra bản ghi thứ hai.
    const timeout = getApiError(withoutResponse('ECONNABORTED'));
    expect(timeout.error).toBe(CLIENT_ERROR_CODES.TIMEOUT);
    expect(timeout.message).toContain('vẫn đang chạy');

    const offline = getApiError(withoutResponse('ERR_NETWORK'));
    expect(offline.error).toBe(CLIENT_ERROR_CODES.NETWORK);
  });

  it('request bị huỷ KHÔNG bị gọi là sự cố', () => {
    // `CanceledError` cũng là một `AxiosError`, nên nhánh `isCancel` phải đứng
    // trước — thiếu thứ tự đó thì nó rơi vào nhánh "không có phản hồi" và người
    // dùng đọc "không kết nối được máy chủ" cho một thao tác họ tự huỷ.
    const result = getApiError(new CanceledError('canceled'));
    expect(result.error).toBe(CLIENT_ERROR_CODES.CANCELED);
    expect(result.message).not.toContain('Không kết nối');
  });

  it('lỗi KHÔNG tới từ mạng được log ra console, không bị nuốt', () => {
    // Một `TypeError` trong `queryFn` là bug của frontend. Người dùng cần một
    // câu đọc được, còn người sửa cần stack — bản trước không cho ai thứ gì.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = getApiError(new TypeError("Cannot read properties of undefined (reading 'id')"));

    expect(result.error).toBe(CLIENT_ERROR_CODES.CLIENT);
    expect(result.message).toContain('Console');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('không nhánh nào trả về câu "không xác định" nữa', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const everything = [
      withResponse(500, ''),
      withResponse(502, '<html/>', 'text/html'),
      withResponse(404, 'Cannot GET /api/v1/x', 'text/plain'),
      withResponse(403, null),
      withResponse(413, undefined),
      withoutResponse('ECONNABORTED'),
      withoutResponse('ERR_NETWORK'),
      new CanceledError('canceled'),
      new TypeError('bug'),
      'một chuỗi bị ném ra',
      undefined,
    ];

    for (const err of everything) {
      const { message } = getApiError(err);
      expect(message.trim(), `với ${String(err)}`).not.toBe('');
      expect(message, `với ${String(err)}`).not.toContain('không xác định');
    }
  });
});
