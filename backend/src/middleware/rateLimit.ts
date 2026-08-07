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

export function rateLimit(options: RateLimitOptions) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // `req.ip` phụ thuộc `trust proxy`; sau reverse proxy phải bật nó, nếu không
    // mọi request trông như đến từ cùng một IP và hạn mức thành hạn mức chung.
    const ip = req.ip ?? 'unknown';
    const key = `ratelimit:${options.bucket}:${ip}`;

    void hitCount(key, options.windowSeconds).then(
      (count) => {
        if (count !== null && count > options.max) {
          next(
            new HttpError(
              429,
              ERROR_CODES.RATE_LIMITED,
              'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.',
            ),
          );
          return;
        }
        next();
      },
      (err: unknown) => {
        next(err);
      },
    );
  };
}
