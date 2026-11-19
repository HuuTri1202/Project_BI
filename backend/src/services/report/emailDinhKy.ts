import type { ReportDataDto, ReportDto } from '@bi/shared';

import { env } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import type { RowDataPacket } from 'mysql2';
import { HttpError } from '../../utils/httpError';

/**
 * Nội dung lá thư định kỳ, và luật về NGƯỜI NHẬN — mong muốn D6.
 *
 * ═══ Chỉ gửi cho THÀNH VIÊN đang hoạt động của tổ chức ═════════════════════
 *
 * Đây là quyết định an toàn quan trọng nhất của D6. Nhận địa chỉ tuỳ ý nghĩa là
 * bất kỳ ai có một tài khoản dùng thử cũng biến hệ thống thành một trạm chuyển
 * thư: họ tạo một lịch "hằng ngày, 8 giờ" gửi tới một địa chỉ bất kỳ, và từ đó
 * máy chủ SMTP của ta gửi thư thay họ — kèm theo cả uy tín tên miền của ta.
 *
 * Người ngoài tổ chức (kế toán thuê ngoài, chủ đầu tư) đã có đường riêng và
 * đúng hơn: liên kết chia sẻ của mong muốn D5. Nó không cần hộp thư của ai, thu
 * hồi được, và hết hạn được.
 *
 * ═══ Thư mang SỐ, không mang ảnh ═══════════════════════════════════════════
 *
 * Vẽ biểu đồ ra ảnh ở phía máy chủ đòi một trình duyệt không giao diện — một
 * phụ thuộc ~300MB và một tiến trình nữa phải trông. Thứ chủ shop cần lúc 8 giờ
 * sáng thứ Hai là CON SỐ, nên thư chứa bảng số liệu, và một đường dẫn tới báo
 * cáo cho ai muốn xem hình.
 */

/** Trần dòng mỗi bảng trong thư — một lá thư không phải chỗ để đọc 5.000 dòng. */
const DONG_MOI_BANG = 20;

/**
 * Lọc danh sách người nhận: chỉ giữ email của thành viên ĐANG HOẠT ĐỘNG.
 *
 * Trả về danh sách đã lọc, và NÉM nếu không còn ai — một lịch không có người
 * nhận nào là một lịch chạy mỗi tuần để không làm gì, và người tạo nó sẽ không
 * hiểu vì sao không có thư.
 */
export async function locNguoiNhan(tenantId: number, dinhGui: string[]): Promise<string[]> {
  const sach = [...new Set(dinhGui.map((e) => e.trim().toLowerCase()).filter((e) => e !== ''))];
  if (sach.length === 0) {
    throw new HttpError(400, 'NoRecipient', 'Hãy chọn ít nhất một người nhận.');
  }

  const [rows] = await mysqlPool.query<RowDataPacket[]>(
    `SELECT LOWER(u.email) AS email
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ? AND m.is_active = 1 AND m.removed_at IS NULL
        AND u.is_active = 1`,
    [tenantId],
  );
  const choPhep = new Set(rows.map((r) => String(r['email'])));

  const ngoai = sach.filter((e) => !choPhep.has(e));
  if (ngoai.length > 0) {
    /*
     * Nói ĐÍCH DANH địa chỉ bị từ chối, và nói luôn đường đi đúng.
     *
     * Một câu "có địa chỉ không hợp lệ" ở đây làm người dùng thử lại từng dòng
     * một; còn không nói tới liên kết chia sẻ thì họ kết luận là hệ thống không
     * gửi được cho kế toán của họ — trong khi nó gửi được, bằng một cách khác.
     */
    throw new HttpError(
      400,
      'RecipientNotMember',
      `Chỉ gửi được cho thành viên của tổ chức. Những địa chỉ này không phải thành viên: ${ngoai.join(', ')}. ` +
        'Muốn gửi cho người ngoài (kế toán, chủ đầu tư), hãy dùng "Chia sẻ bằng liên kết".',
    );
  }

  return sach;
}

/** Một bảng số liệu của một ô, dạng HTML đơn giản — không CSS ngoài, không ảnh. */
function bangHtml(tieuDe: string, bang: ReportDataDto): string {
  const dong = bang.rows
    .slice(0, DONG_MOI_BANG)
    .map(
      (r) =>
        `<tr><td style="padding:4px 10px;border-top:1px solid #e2e8f0">${thoat(String(r.label))}</td>` +
        `<td style="padding:4px 10px;border-top:1px solid #e2e8f0;text-align:right">${
          typeof r.value === 'number' ? r.value.toLocaleString('vi-VN') : thoat(String(r.value))
        }</td></tr>`,
    )
    .join('');

  const con = bang.rows.length - DONG_MOI_BANG;
  return (
    `<h3 style="margin:18px 0 6px;font:600 14px sans-serif">${thoat(tieuDe)}</h3>` +
    '<table style="border-collapse:collapse;font:13px sans-serif;min-width:280px">' +
    `<thead><tr><th style="padding:4px 10px;text-align:left">${thoat(bang.dimensionLabel)}</th>` +
    `<th style="padding:4px 10px;text-align:right">${thoat(bang.measureLabel)}</th></tr></thead>` +
    `<tbody>${dong}</tbody></table>` +
    (con > 0
      ? `<p style="margin:4px 0 0;font:12px sans-serif;color:#64748b">…và ${String(con)} dòng nữa — mở báo cáo để xem hết.</p>`
      : '')
  );
}

/** Bản chữ thuần, BẮT BUỘC: nhiều hộp thư doanh nghiệp chặn HTML. */
function bangChu(tieuDe: string, bang: ReportDataDto): string {
  const dong = bang.rows
    .slice(0, DONG_MOI_BANG)
    .map(
      (r) =>
        `  ${String(r.label)}: ${
          typeof r.value === 'number' ? r.value.toLocaleString('vi-VN') : String(r.value)
        }`,
    )
    .join('\n');
  return `${tieuDe} (${bang.dimensionLabel} / ${bang.measureLabel})\n${dong}`;
}

function thoat(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ThuDinhKy {
  subject: string;
  text: string;
  html: string;
}

/**
 * Dựng lá thư từ số liệu đã tính.
 *
 * Ô KHÔNG đọc được số liệu vẫn được nêu tên kèm lý do, không bị bỏ im lặng: một
 * lá thư thiếu một bảng mà không nói gì là một lá thư nói dối về phạm vi của nó.
 */
export function dungThu(input: {
  report: ReportDto;
  tenMoHinhHoacBo: string;
  soLieu: readonly { visualId: string; data: ReportDataDto | null; error?: string | undefined }[];
  tieuDeO: Map<string, string>;
}): ThuDinhKy {
  const ngay = new Date().toLocaleDateString('vi-VN');
  const duongDan = `${env.CORS_ORIGIN.replace(/\/$/, '')}/reports/${String(input.report.id)}`;

  const khoi = input.soLieu.map((o, i) => {
    const ten = input.tieuDeO.get(o.visualId) ?? `Biểu đồ ${String(i + 1)}`;
    if (o.data === null) {
      return {
        html: `<h3 style="margin:18px 0 6px;font:600 14px sans-serif">${thoat(ten)}</h3><p style="font:13px sans-serif;color:#b45309">${thoat(o.error ?? 'Không đọc được số liệu.')}</p>`,
        text: `${ten}: ${o.error ?? 'Không đọc được số liệu.'}`,
      };
    }
    return { html: bangHtml(ten, o.data), text: bangChu(ten, o.data) };
  });

  return {
    subject: `[${input.report.name}] số liệu ngày ${ngay}`,
    text:
      `Báo cáo "${input.report.name}" — ${ngay}\n\n` +
      `${khoi.map((k) => k.text).join('\n\n')}\n\n` +
      `Mở báo cáo: ${duongDan}\n` +
      'Thư này do một lịch gửi định kỳ tạo ra. Mở báo cáo rồi bấm "Gửi định kỳ" để tắt.',
    html:
      `<div style="font:14px sans-serif;color:#0f172a"><p style="margin:0 0 2px">Báo cáo <strong>${thoat(input.report.name)}</strong></p>` +
      `<p style="margin:0;font:12px sans-serif;color:#64748b">Số liệu đọc lúc ${ngay} · nguồn: ${thoat(input.tenMoHinhHoacBo)}</p>` +
      khoi.map((k) => k.html).join('') +
      `<p style="margin:18px 0 0"><a href="${duongDan}">Mở báo cáo trong hệ thống</a></p>` +
      '<p style="margin:6px 0 0;font:12px sans-serif;color:#94a3b8">Thư này do một lịch gửi định kỳ tạo ra. Mở báo cáo rồi bấm “Gửi định kỳ” để tắt.</p></div>',
  };
}
