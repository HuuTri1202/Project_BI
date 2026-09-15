import { readFileSync, unwatchFile, utimesSync, watchFile } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'dotenv';

/**
 * Sửa `backend/.env` lúc backend đang chạy thì backend tự khởi động lại — CHỈ khi dev.
 *
 * ═══ Chuyện đã xảy ra ═══════════════════════════════════════════════════════
 *
 * Backend chạy từ 10:30. `.env` được sửa lúc 10:54 (`SEPAY_API_TOKEN` là dòng
 * cuối), 10:58 quét mã chuyển 2.000đ. Tiền về Sepay, Sepay trả đúng giao dịch, mã
 * đơn khớp — mà đơn nằm `pending` mãi, và tiến trình không mở một kết nối nào tới
 * Sepay. Nó chưa từng đọc cái token đó: `env` được đọc MỘT lần lúc import rồi
 * đóng băng, nên vòng tự đọc sao kê không bật. Không lỗi, không log. Lưu lại một
 * file code bất kỳ (tiến trình khởi động lại) là đơn thành `paid` trong vài giây.
 *
 * ═══ Vì sao `tsx watch` không tự lo ═════════════════════════════════════════
 *
 * Nó bỏ qua mọi file bắt đầu bằng dấu chấm, và bỏ CỨNG: `--include .env` không
 * có tác dụng (đã thử — đổi `.env`, không có lần chạy lại nào). Còn
 * `node --watch --env-file` thì có theo dõi `.env` (đã thử trên Node 24), nhưng
 * nghĩa là bỏ `tsx watch` — đổi trình chạy dev của cả nhóm, trong khi `engines`
 * vẫn hứa Node 20 — chỉ vì một file. Đổi quá tay.
 *
 * Nên tiến trình tự canh `.env`, và khi GIÁ TRỊ đổi thì chạm vào CHÍNH FILE NÀY
 * (đổi giờ sửa, không đổi nội dung). File này nằm trong cây import, nên
 * `tsx watch` thấy nó "đổi" và khởi động lại như với mọi lần lưu code. Tiến trình
 * mới đọc `.env` từ đầu.
 *
 * ─── Chi tiết đáng giữ ─────────────────────────────────────────────────────
 *
 *   · So GIÁ TRỊ đã parse, không so giờ sửa file: lưu lại không đổi gì, hay chỉ
 *     sửa một dòng chú thích, thì không đáng cắt ngang các vòng lặp nền.
 *   · `watchFile` (hỏi `stat` mỗi giây) chứ không `fs.watch`: nhiều trình soạn
 *     thảo lưu bằng cách GHI RA FILE TẠM RỒI ĐỔI TÊN, và `fs.watch` trên một file
 *     mất dấu ngay sau lần đổi tên đầu tiên. Một lần `stat` mỗi giây không đáng kể.
 *   · Log chỉ in TÊN biến, không bao giờ in giá trị — đa số là bí mật.
 *   · `unref()`: không được giữ tiến trình sống khi mọi thứ khác đã đóng.
 *
 * ⚠️ Không chạy khi `production` hay `test`. Production nạp cấu hình qua lần
 * triển khai, không qua một file sửa tay; và test thì không được tự khởi động lại.
 */

export function changedKeys(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => before[key] !== after[key]).sort();
}

function readEnvFile(file: string): Record<string, string> | null {
  try {
    return parse(readFileSync(file));
  } catch {
    // Đang bị xoá rồi ghi lại (lưu kiểu đổi tên): lần `stat` sau sẽ thấy file mới.
    return null;
  }
}

/** Trả về hàm dừng canh. Không có `.env` thì không canh gì. */
export function watchEnvFile(): () => void {
  // Cùng đường dẫn mà `dotenv/config` dùng.
  const file = resolve(process.cwd(), '.env');
  let loaded = readEnvFile(file);
  if (loaded === null) return () => undefined;

  const onStat = (): void => {
    const next = readEnvFile(file);
    if (next === null || loaded === null) return;

    const keys = changedKeys(loaded, next);
    if (keys.length === 0) return;
    loaded = next;

    console.log(
      `[env] backend/.env vừa đổi (${keys.join(', ')}) — khởi động lại để nạp giá trị mới`,
    );
    const now = new Date();
    utimesSync(__filename, now, now);
  };

  watchFile(file, { interval: 1_000 }, onStat).unref();
  return () => unwatchFile(file, onStat);
}
