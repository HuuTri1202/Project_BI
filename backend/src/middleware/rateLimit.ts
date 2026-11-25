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
 *
 * ─── Đếm MỌI request, hay chỉ đếm request THẤT BẠI ──────────────────────────
 *
 * Mặc định đếm mọi request, và đó là đúng cho phần lớn bucket ở đây: một lượt
 * `/chat/*` thành công vẫn tốn một lượt gọi mô hình, một lượt `/register` thành
 * công vẫn gửi một lá thư và lập một tổ chức. Cái phải chặn ở đó là KHỐI LƯỢNG.
 *
 * `demMaLoi` đảo luật cho những endpoint chỉ đi KIỂM một bí mật: ở đó thứ phải
 * chặn là số lần ĐOÁN SAI, còn lần đoán đúng không nói gì cho kẻ dò cả. Đây là
 * một lỗi đã đo được trên hệ thống đang chạy, không phải lo xa: bản trước tăng
 * bộ đếm TRƯỚC handler, nên 10 lần đăng nhập ĐÚNG trong 15 phút cũng khoá —
 * và vì đếm theo IP, một văn phòng sau cùng một NAT khoá lẫn nhau. Chính
 * `.env.example` đã ghi luật đúng từ đầu ("Sai quá LOGIN_MAX_ATTEMPTS lần"),
 * chỉ có mã là làm khác.
 */

interface RateLimitOptions {
  /** Số request tối đa trong một cửa sổ. */
  max: number;
  /** Độ dài cửa sổ, tính bằng giây. */
  windowSeconds: number;
  /** Tiền tố key, để hai endpoint không dùng chung hạn mức. */
  bucket: string;
  /**
   * Chỉ đếm phản hồi có mã trạng thái nằm trong tập này; bỏ trống = đếm MỌI
   * request.
   *
   * Liệt kê tường minh chứ không lấy "mọi mã >= 400": `/login` trả 403 khi mật
   * khẩu ĐÚNG mà email chưa xác minh, và khoá một người đã chứng minh biết mật
   * khẩu thì lại đúng là lỗi vừa sửa, chỉ mang bộ mặt khác.
   */
  demMaLoi?: readonly number[] | undefined;
  /**
   * Đếm theo NGƯỜI DÙNG thay vì theo IP.
   *
   * Mặc định theo IP, và với `/auth/*` thì đó là cách duy nhất đúng: ở đó chưa
   * biết người gọi là ai, và thứ cần chặn chính là một máy thử nhiều tài khoản.
   *
   * Sau khi đã đăng nhập thì IP là đơn vị SAI. Đo được 24/11/2026: khung hỏi
   * đáp dùng bucket theo IP, nên một phòng demo sau cùng một NAT — hoặc chỉ hai
   * người ngồi cùng wifi — chia nhau 20 lượt, và người thứ hai bị khoá vì người
   * thứ nhất vừa hỏi. Chỉ bật cho những route nằm SAU `authenticate`; không có
   * `req.auth` thì vẫn rơi về IP, nên bật nhầm không mở toang hạn mức.
   */
  theoNguoiDung?: boolean | undefined;
  /**
   * Câu báo khi hết lượt, nhận số giây còn lại đã diễn giải.
   *
   * Có vì câu mặc định ("Bạn thao tác quá nhanh") đổ lỗi cho người dùng, mà ở
   * khung hỏi đáp thì điều đó vừa sai vừa vô ích: giới hạn ở đó bảo vệ hạn mức
   * gọi mô hình của HỆ THỐNG, không phải trừng phạt ai gõ nhanh. Câu chữ của
   * mỗi route nói đúng việc của route đó.
   */
  thongBao?: ((conLai: string) => string) | undefined;
}

function canhBao(err: unknown): void {
  console.warn('[rateLimit] Redis lỗi, bỏ qua giới hạn:', err instanceof Error ? err.message : err);
}

/**
 * Redis chết thì CHO QUA thay vì chặn.
 *
 * Đây là một đánh đổi có chủ ý: rate limit là lớp phòng thủ bổ sung, còn đăng
 * nhập là chức năng cốt lõi. Để Redis hỏng kéo sập luôn việc đăng nhập là biến
 * một sự cố nhỏ thành sự cố toàn hệ thống. `null` = "không biết", và nơi gọi
 * hiểu nó là cho qua.
 */
async function daDung(key: string): Promise<number | null> {
  try {
    const raw = await redis.get(key);
    if (raw === null) return 0;
    const so = Number.parseInt(raw, 10);
    return Number.isFinite(so) ? so : 0;
  } catch (err) {
    canhBao(err);
    return null;
  }
}

async function tang(key: string, windowSeconds: number): Promise<number | null> {
  try {
    const count = await redis.incr(key);
    // Chỉ đặt hạn ở lần đầu: đặt lại mỗi lần tăng sẽ biến cửa sổ cố định thành
    // cửa sổ TRƯỢT THEO request, và khi đó một kẻ dò liên tục tự gia hạn khoá
    // của chính mình tới vô hạn — còn người dùng thật sau cùng IP cũng vậy.
    if (count === 1) await redis.expire(key, windowSeconds);
    return count;
  } catch (err) {
    canhBao(err);
    return null;
  }
}

/** Còn bao nhiêu giây nữa thì cửa sổ hết hạn. Không đọc được thì nói cả cửa sổ. */
async function conLaiGiay(key: string, windowSeconds: number): Promise<number> {
  try {
    const ttl = await redis.ttl(key);
    return ttl > 0 ? ttl : windowSeconds;
  } catch (err) {
    canhBao(err);
    return windowSeconds;
  }
}

/**
 * "ít phút" là một câu nói dối khi cửa sổ dài 15 phút: người dùng thử lại sau
 * hai phút, vẫn bị chặn, và kết luận là hệ thống hỏng.
 */
function dienGiai(giay: number): string {
  if (giay < 60) return `${giay} giây`;
  return `${Math.ceil(giay / 60)} phút`;
}

export function rateLimit(options: RateLimitOptions) {
  const maLoi = options.demMaLoi;

  return (req: Request, res: Response, next: NextFunction): void => {
    // `req.ip` phụ thuộc `trust proxy`; sau reverse proxy phải bật nó, nếu không
    // mọi request trông như đến từ cùng một IP và hạn mức thành hạn mức chung.
    const ip = req.ip ?? 'unknown';
    const userId = options.theoNguoiDung === true ? req.auth?.userId : undefined;
    const dinhDanh = userId === undefined ? ip : `u${String(userId)}`;
    const key = `ratelimit:${options.bucket}:${dinhDanh}`;

    void (async () => {
      // Hai chế độ chỉ khác nhau ở THỜI ĐIỂM tăng bộ đếm, không khác ở cách
      // gác: cả hai đều hỏi "trước request này đã dùng bao nhiêu lượt".
      const soDaDung =
        maLoi === undefined
          ? await tang(key, options.windowSeconds).then((c) => (c === null ? null : c - 1))
          : await daDung(key);

      if (soDaDung !== null && soDaDung >= options.max) {
        const conLai = await conLaiGiay(key, options.windowSeconds);
        // Đặt header TRƯỚC khi chuyển lỗi: `errorHandler` chỉ gọi res.status().json(),
        // nên header đã đặt ở đây vẫn đi theo phản hồi 429.
        res.setHeader('Retry-After', String(conLai));
        const cho = dienGiai(conLai);
        next(
          new HttpError(
            429,
            ERROR_CODES.RATE_LIMITED,
            options.thongBao === undefined
              ? `Bạn thao tác quá nhanh. Vui lòng thử lại sau ${cho}.`
              : options.thongBao(cho),
          ),
        );
        return;
      }

      if (maLoi !== undefined) {
        // 'finish' nổ sau khi phản hồi đã gửi, nên tới lúc đó mới biết lần này
        // là đoán sai hay không.
        res.on('finish', () => {
          if (maLoi.includes(res.statusCode)) void tang(key, options.windowSeconds);
        });
      }

      next();
    })().catch((err: unknown) => {
      next(err);
    });
  };
}
