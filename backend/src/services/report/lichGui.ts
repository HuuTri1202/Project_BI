import { isTest } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import * as reportsRepo from '../../repositories/reports';
import * as schedulesRepo from '../../repositories/reportSchedules';
import { guiMail } from '../mail/mailer';
import { soLieuTrangKhung } from './canvasData';
import { dungThu } from './emailDinhKy';
import { tinhLanKeTiep } from './lanKeTiep';

/**
 * Vòng lặp gửi báo cáo định kỳ — mong muốn D6.
 *
 * ═══ Khuôn giống `services/billing/runner.ts`, và cố ý ═════════════════════
 *
 * `setTimeout` NỐI TIẾP chứ không `setInterval`: `setInterval` bắn theo đồng hồ
 * bất kể lần trước xong chưa, nên một lần gửi chậm (SMTP treo) sẽ tích lại
 * nhiều lượt chồng lên nhau rồi bung ra cùng lúc — ở đây hậu quả của chuyện đó
 * là một trận thư trùng.
 *
 * ⚠️ KHÔNG chạy trong test, cùng lý do đã ghi ở hai runner kia: một vòng lặp
 * chạy song song sẽ gửi thư cho dữ liệu mà bài test vừa dựng, và bài đó đỏ hay
 * xanh tuỳ tốc độ máy.
 *
 * ═══ Nhịp một phút, và vì sao không dày hơn ════════════════════════════════
 *
 * Lịch gửi tính theo GIỜ (`gio` là 0–23), nên độ chính xác cần thiết là phút.
 * Dày hơn chỉ thêm một câu SELECT mỗi lần mà không ai nhận thư sớm hơn.
 */
const POLL_MS = 60_000;

/**
 * Trần số lịch gửi trong MỘT nhịp.
 *
 * Máy chủ tắt ba ngày thì mọi lịch đều quá hạn cùng lúc. Gửi tất cả trong một
 * nhịp là một đợt thư dồn mà không ai muốn nhận — và cũng là cách nhanh nhất để
 * máy chủ SMTP coi ta là nguồn spam.
 */
const MOI_NHIP = 20;

let timer: NodeJS.Timeout | undefined;
let stopping = false;
let running: Promise<void> | undefined;

export function startScheduleRunner(): void {
  if (isTest) return;
  stopping = false;
  schedule(0);
}

/**
 * Dừng có trật tự — phải gọi TRƯỚC `closeMysql()`.
 *
 * Vòng lặp đang giữ connection từ chính pool đó; đóng pool trước là cắt ngang
 * nó, và một lần dừng êm biến thành một dòng log "Pool is closed".
 */
export async function stopScheduleRunner(): Promise<void> {
  stopping = true;
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  await running;
}

function schedule(delay: number): void {
  if (stopping) return;
  timer = setTimeout(() => {
    running = tick().finally(() => {
      schedule(POLL_MS);
    });
  }, delay);
}

async function tick(): Promise<void> {
  try {
    const lo = await schedulesRepo.toiHan(mysqlPool, new Date(), MOI_NHIP);
    for (const lich of lo) {
      if (stopping) return;
      await chayMotLich(lich);
    }
  } catch (err) {
    // Một nhịp hỏng KHÔNG được làm chết vòng lặp: nhịp sau vẫn phải chạy.
    console.error('[lichGui] nhịp lỗi:', err instanceof Error ? err.message : err);
  }
}

/**
 * Gửi MỘT lịch.
 *
 * ⚠️ Đẩy mốc kế tiếp TRƯỚC khi gửi — xem `datLanKeTiep`. Tệ nhất là mất một lần
 * gửi (và `last_error` nói ra), còn gửi trùng thì không có đường lùi.
 */
export async function chayMotLich(lich: schedulesRepo.ScheduleRow): Promise<void> {
  await schedulesRepo.datLanKeTiep(
    mysqlPool,
    lich.id,
    tinhLanKeTiep(new Date(), {
      tanSuat: lich.tanSuat,
      gio: lich.gio,
      thu: lich.thu,
      ngay: lich.ngay,
    }),
  );

  try {
    const report = await reportsRepo.findById(
      mysqlPool,
      { tenantId: lich.tenantId, userId: lich.createdBy, allWorkspaces: true },
      lich.reportId,
    );
    if (report === null) {
      // Báo cáo bị xoá mềm. Không xoá lịch: `ON DELETE CASCADE` lo trường hợp
      // xoá cứng, còn xoá mềm thì người dùng có thể đang phục hồi.
      await schedulesRepo.ghiKetQua(mysqlPool, lich.id, 'Báo cáo không còn tồn tại.');
      return;
    }
    if (report.canvas === null) {
      await schedulesRepo.ghiKetQua(
        mysqlPool,
        lich.id,
        'Báo cáo này không phải khung nhiều biểu đồ nên chưa gửi được.',
      );
      return;
    }

    const soLieu = await soLieuTrangKhung({
      tenantId: lich.tenantId,
      userId: lich.createdBy,
      report,
    });

    const trang = report.canvas.pages[0];
    const thu = dungThu({
      report,
      tenMoHinhHoacBo: report.sourceName,
      soLieu: soLieu.visuals,
      tieuDeO: new Map(
        (trang?.visuals ?? []).map((v, i) => [v.id, v.title ?? `Biểu đồ ${String(i + 1)}`]),
      ),
    });

    /*
     * Gửi TỪNG người một, không gộp vào một `to`.
     *
     * Gộp thì mọi người nhận thấy địa chỉ của nhau — với một báo cáo nội bộ thì
     * thường không sao, nhưng đó là quyết định của người tạo lịch, không phải
     * của ta. Và một địa chỉ hỏng trong danh sách gộp làm cả lá thư bị trả về.
     */
    const loi: string[] = [];
    for (const to of lich.nguoiNhan) {
      try {
        await guiMail({ to, subject: thu.subject, text: thu.text, html: thu.html });
      } catch (err) {
        loi.push(`${to}: ${err instanceof Error ? err.message : 'không gửi được'}`);
      }
    }

    await schedulesRepo.ghiKetQua(
      mysqlPool,
      lich.id,
      loi.length === 0 ? null : loi.join('; ').slice(0, 500),
    );
  } catch (err) {
    await schedulesRepo.ghiKetQua(
      mysqlPool,
      lich.id,
      (err instanceof Error ? err.message : 'Lỗi không rõ').slice(0, 500),
    );
  }
}
