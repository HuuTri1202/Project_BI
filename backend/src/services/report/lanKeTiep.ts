import type { TanSuat } from '@bi/shared';

/**
 * Mốc GỬI KẾ TIẾP của một lịch định kỳ — mong muốn D6.
 *
 * ═══ Vì sao nó là một file riêng, thuần, không chạm database ════════════════
 *
 * Đây là phần duy nhất của D6 có thể SAI MÀ KHÔNG AI THẤY: một lịch tính lệch
 * một giờ vẫn gửi thư, vẫn trông như đang chạy, chỉ là sai giờ. Nên nó phải
 * kiểm được bằng những ca đọc ra thành câu ("8 giờ sáng thứ Hai, hỏi lúc chiều
 * Chủ nhật") thay vì phải dựng MySQL và chờ một phút.
 *
 * ═══ Múi giờ: +07:00 đóng cứng, và vì sao thế là ĐÚNG ở đây ════════════════
 *
 * "Sáng thứ Hai" là 8 giờ sáng ở Việt Nam, không phải 8 giờ UTC. Việt Nam dùng
 * UTC+7 cố định và KHÔNG có giờ mùa hè — nên phép cộng 7 giờ là chính xác tuyệt
 * đối, không phải một phép xấp xỉ. Kéo cả một thư viện múi giờ về để diễn đạt
 * một hằng số là thêm một phụ thuộc và một bảng dữ liệu phải cập nhật hằng năm,
 * cho một hệ thống mà mọi người dùng ở cùng một múi giờ.
 *
 * Nếu một ngày có khách ngoài Việt Nam: chỗ phải đổi là hằng số này cộng một cột
 * `timezone` trên `report_schedules`. Ghi ra đây để lúc đó không ai phải đi tìm.
 */
export const LECH_GIO_VIET_NAM = 7;

export interface CauHinhLich {
  tanSuat: TanSuat;
  /** 0–23, giờ Việt Nam. */
  gio: number;
  /** 1 = Thứ Hai … 7 = Chủ nhật. Chỉ dùng cho `hang-tuan`. */
  thu?: number | null;
  /** 1–28. Chỉ dùng cho `hang-thang`. */
  ngay?: number | null;
}

/**
 * Mốc gửi kế tiếp SAU `tu` (không bao giờ bằng `tu`).
 *
 * "Sau", không phải "từ": nếu nó trả về đúng mốc hiện tại thì vòng lặp nền vừa
 * gửi xong sẽ thấy lịch ấy vẫn tới hạn và gửi lần nữa — một thư thành một trăm
 * thư trong một phút. Đây là lý do mọi nhánh dưới đây đều bắt đầu bằng "cộng ít
 * nhất một đơn vị".
 */
export function tinhLanKeTiep(tu: Date, cfg: CauHinhLich): Date {
  // Làm việc trong "giờ Việt Nam ảo": dịch mốc UTC lên +7 rồi dùng các hàm UTC
  // của Date. Nhờ vậy không có phép đổi múi giờ nào phụ thuộc máy chạy —
  // `getHours()` của Node đọc theo TZ của hệ điều hành, và máy chủ thật chạy
  // UTC trong khi máy dev chạy +7.
  const vn = new Date(tu.getTime() + LECH_GIO_VIET_NAM * 3_600_000);

  const moc = new Date(
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate(), cfg.gio, 0, 0, 0),
  );

  if (cfg.tanSuat === 'hang-ngay') {
    if (moc.getTime() <= vn.getTime()) moc.setUTCDate(moc.getUTCDate() + 1);
    return veUtc(moc);
  }

  if (cfg.tanSuat === 'hang-tuan') {
    const thuMuon = cfg.thu ?? 1;
    // `getUTCDay()`: 0 = Chủ nhật. Đổi sang ISO (1 = Thứ Hai, 7 = Chủ nhật) để
    // khớp với con số người dùng chọn và với `THU_LABELS`.
    const thuHienTai = moc.getUTCDay() === 0 ? 7 : moc.getUTCDay();
    let cach = thuMuon - thuHienTai;
    if (cach < 0) cach += 7;
    // Đúng ngày nhưng đã qua giờ -> tuần sau.
    if (cach === 0 && moc.getTime() <= vn.getTime()) cach = 7;
    moc.setUTCDate(moc.getUTCDate() + cach);
    return veUtc(moc);
  }

  const ngayMuon = cfg.ngay ?? 1;
  moc.setUTCDate(ngayMuon);
  // Đã qua mốc của tháng này -> tháng sau. `setUTCMonth` tự cuộn sang năm mới.
  if (moc.getTime() <= vn.getTime()) moc.setUTCMonth(moc.getUTCMonth() + 1);
  return veUtc(moc);
}

/** Dịch mốc "giờ Việt Nam ảo" về mốc UTC thật để lưu vào database. */
function veUtc(vn: Date): Date {
  return new Date(vn.getTime() - LECH_GIO_VIET_NAM * 3_600_000);
}
