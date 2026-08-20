import { ERROR_CODES } from '@bi/shared';
import type { NextFunction, Request, Response } from 'express';

import { redis } from '../config/redis';
import { HttpError } from '../utils/httpError';

/**
 * Giới hạn tần suất bằng Redis (đã có sẵn trong hạ tầng, không thêm thư viện).
 *
 * Vì sao cần: `POST /auth/register` trả 409 khi email trùng — đó là một kênh
 * liệt kê email rất rõ ràng, và không bỏ được nếu vẫn muốn báo lỗi tử tế cho
 * người dùng thật. `POST /auth/login` thì mở cho credential stuffing. Không có
 * lớp này thì cả hai đều không giới hạn.
 *
 * Thuật toán là cửa sổ cố định (INCR + EXPIRE), không phải sliding window: kém
 * chính xác ở ranh giới cửa sổ (kẻ tấn công có thể dồn 2x giới hạn quanh mốc
 * chuyển), nhưng đúng một round-trip Redis và không cần cấu trúc dữ liệu nào.
 * Đủ cho mục tiêu ở đây là chặn tự động hoá, không phải chặn tuyệt đối.
 */

interface RateLimitOptions {
  /** Số request tối đa trong một cửa sổ. */
  max: number;
  /** Độ dài cửa sổ, tính bằng giây. */
  windowSeconds: number;
  /** Tiền tố key, để hai endpoint không dùng chung hạn mức. */
  bucket: string;
  /**
   * Chỉ đếm request THẤT BẠI, và XOÁ bộ đếm khi thành công.
   *
   * ─── Vì sao cần, và vì sao mặc định là tắt ────────────────────────────────
   *
   * Với `/login`, thứ hạn mức này chặn là dò mật khẩu — mà dò mật khẩu thì
   * LUÔN thất bại. Đếm cả lần đăng nhập đúng không chặn thêm được gì, nhưng nó
   * khoá đúng người dùng thật: mười lần đăng nhập đúng trong mười lăm phút là
   * chuyện bình thường của người đang phát triển hoặc đang thử trên nhiều thiết
   * bị, và họ nhận 429 dù chưa gõ sai lần nào.
   *
   * Xoá bộ đếm khi thành công cũng là chủ ý: người gõ nhầm ba lần rồi vào được
   * đã chứng minh họ là chủ tài khoản, nên ba lần đó không nên treo trên đầu họ
   * thêm mười lăm phút nữa.
   *
   * Mặc định TẮT vì nó KHÔNG đúng cho mọi endpoint. `/register` chẳng hạn: ở đó
   * chính lần THÀNH CÔNG mới là thứ cần chặn — tạo hàng loạt tài khoản. Bật
   * nhầm chỗ là gỡ hẳn hạn mức mà trông như vẫn còn.
   */
  countFailuresOnly?: boolean;
}

/**
 * Redis chết thì CHO QUA thay vì chặn.
 *
 * Đây là một đánh đổi có chủ ý: rate limit là lớp phòng thủ bổ sung, còn đăng
 * nhập là chức năng cốt lõi. Để Redis hỏng kéo sập luôn việc đăng nhập là biến
 * một sự cố nhỏ thành sự cố toàn hệ thống.
 */
async function hitCount(key: string, windowSeconds: number): Promise<number | null> {
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }
    return count;
  } catch (err) {
    console.warn('[rateLimit] Redis lỗi, bỏ qua giới hạn:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Đọc bộ đếm mà KHÔNG tăng. Redis chết -> `null`, và nơi gọi cho qua. */
async function readCount(key: string): Promise<number | null> {
  try {
    const raw = await redis.get(key);
    return raw === null ? 0 : Number(raw);
  } catch (err) {
    console.warn(
      '[rateLimit] Redis lỗi, bỏ qua giới hạn:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Mọi lỗi ở đây đều nuốt: dọn bộ đếm hỏng không được làm hỏng request. */
async function clearCount(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch {
    /* Cùng lý do với `hitCount`: hạn mức là lớp phụ, không phải chức năng chính. */
  }
}

const tooMany = (): HttpError =>
  new HttpError(
    429,
    ERROR_CODES.RATE_LIMITED,
    'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.',
  );

export function rateLimit(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // `req.ip` phụ thuộc `trust proxy`; sau reverse proxy phải bật nó, nếu không
    // mọi request trông như đến từ cùng một IP và hạn mức thành hạn mức chung.
    const ip = req.ip ?? 'unknown';
    const key = `ratelimit:${options.bucket}:${ip}`;

    if (options.countFailuresOnly !== true) {
      void hitCount(key, options.windowSeconds).then(
        (count) => {
          if (count !== null && count > options.max) {
            next(tooMany());
            return;
          }
          next();
        },
        (err: unknown) => next(err),
      );
      return;
    }

    // ─── Nhánh chỉ-đếm-thất-bại ────────────────────────────────────────────
    //
    // Đọc TRƯỚC, ghi SAU khi biết kết quả. Đổi lại là một cửa sổ tranh chấp:
    // nhiều request sai gửi cùng lúc đều đọc được cùng một con số cũ và cùng
    // lọt qua. Chấp nhận được — hạn mức này chặn dò mật khẩu bằng kịch bản, mà
    // một kẻ dò vẫn phải dừng ở lần kế tiếp; nó không phải khoá tuyệt đối.
    void readCount(key).then(
      (count) => {
        if (count !== null && count >= options.max) {
          next(tooMany());
          return;
        }

        // `finish` chứ không phải `close`: `close` bắn cả khi client ngắt giữa
        // chừng, và một người đóng tab lúc đang đăng nhập không phải một lần
        // đăng nhập sai.
        res.once('finish', () => {
          if (res.statusCode >= 400) {
            void hitCount(key, options.windowSeconds);
          } else {
            void clearCount(key);
          }
        });

        next();
      },
      (err: unknown) => next(err),
    );
  };
}
