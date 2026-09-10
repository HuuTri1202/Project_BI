import { BILLING_ERROR_CODES } from '@bi/shared';

import * as billingRepo from '../../repositories/billing';
import type { Db } from '../../repositories/db';
import * as usageRepo from '../../repositories/usage';
import { HttpError } from '../../utils/httpError';

/**
 * Cưỡng chế hạn mức gói — §11.2.
 *
 * ═══ Nguồn hạn mức: ẢNH CHỤP, không phải bảng giá ══════════════════════════
 *
 * Migration 30 chỉ chụp GIÁ vào `subscriptions` và ghi rõ điều kiện: "chấp nhận
 * được khi hạn mức chỉ hiển thị; ngày nó bắt đầu CHẶN thao tác thì quyết định
 * này phải xem lại". Migration 32 là ngày đó — bốn cột `max_*` được chụp lúc
 * kích hoạt, và file này là nơi duy nhất đọc chúng.
 *
 * Không nơi nào khác được đọc `plans.max_*` để quyết định chặn. Bảng giá mô tả
 * thứ đang BÁN; hạn mức của một tổ chức là thứ họ đã MUA.
 *
 * ═══ `null` = KHÔNG GIỚI HẠN, và nó phải đi qua nguyên vẹn ═════════════════
 *
 * Gói Business có `max_workspaces = NULL`. `Number(null)` cho ra `0`, tức là
 * "không được tạo cái nào" — đúng nghĩa ngược lại, và là loại lỗi chỉ lộ ra khi
 * một khách hàng trả tiền cao nhất không tạo được gì.
 *
 * ═══ Vì sao 409 chứ không 403 ══════════════════════════════════════════════
 *
 * Người dùng CÓ đủ quyền; cùng thao tác đó sẽ thành công sau khi nâng gói hoặc
 * xoá bớt. 403 khiến giao diện hiện "bạn không được phép" và dẫn người ta đi hỏi
 * quản trị viên tổ chức thay vì đi nâng gói.
 */

/**
 * Mã gói mặc định. Phải khớp dòng gieo ở migration 30.
 *
 * Sống ở đây chứ không ở `entitlements.ts` để phụ thuộc chỉ đi MỘT chiều
 * (entitlements → limits). Hai chiều thì có vòng import, và vòng import giữa hai
 * module cùng chạy lúc khởi động là loại lỗi hiện ra dưới dạng `undefined` ở một
 * hằng số, cách xa nguyên nhân. `entitlements.ts` xuất lại tên này nên nơi gọi
 * cũ không phải đổi.
 */
export const FREE_PLAN_CODE = 'free';

export type LoaiHanMuc = 'workspaces' | 'reports' | 'members' | 'storageBytes';

export interface HanMucHieuLuc {
  /** Tên gói để đưa vào thông báo — "Gói Miễn phí cho tối đa..." */
  planName: string;
  workspaces: number | null;
  reports: number | null;
  members: number | null;
  storageBytes: number | null;
}

/**
 * Hạn mức đang có hiệu lực với một tổ chức.
 *
 * Ảnh chụp trong subscription `active`; không có subscription nào thì rơi về gói
 * `free` — đúng luật trung tâm "không có dòng nào = đang ở Free" của migration
 * 30, và là lý do nhánh này phải tồn tại dù sao đi nữa.
 */
export async function hanMucHieuLuc(
  db: Db,
  tenantId: number,
  now: Date,
): Promise<HanMucHieuLuc> {
  const sub = await billingRepo.findActiveLimits(db, tenantId, now);

  // ─── Nhánh 1: chưa mua gì ⇒ gói Free ───────────────────────────────────
  if (sub === null) {
    const free = await hanMucGoiFree(db);
    return { planName: free.name, ...free.limits };
  }

  // ─── Nhánh 2: có ảnh chụp ⇒ tin nó, không nhìn bảng giá ─────────────────
  if (sub.captured) {
    return {
      planName: sub.planName,
      workspaces: sub.maxWorkspaces,
      reports: sub.maxReports,
      members: sub.maxMembers,
      storageBytes: sub.maxStorageBytes,
    };
  }

  /*
   * ─── Nhánh 3: dòng cũ chưa chụp ảnh ⇒ ĐỌC SỐNG, hành vi trước §11.2 ────
   *
   * Migration 32 đã backfill mọi dòng đang có, nên nhánh này chỉ chạy cho dòng
   * được chèn bởi đường nào đó chưa chụp ảnh — hôm nay là các bài test dựng
   * subscription bằng SQL thô, và ngày mai có thể là một đường mới ai đó thêm
   * mà quên.
   *
   * Rơi về đọc sống chứ không về Free: dòng đó là một gói THẬT khách đang dùng,
   * và hạ họ xuống hạn mức Free vì một cột chưa điền là hỏng nặng hơn nhiều so
   * với việc dùng hạn mức hiện hành của đúng gói đó.
   */
  const live = await billingRepo.findPlanLimits(db, sub.planId);
  if (live !== null) {
    return {
      planName: sub.planName,
      workspaces: live.maxWorkspaces,
      reports: live.maxReports,
      members: live.maxMembers,
      storageBytes: live.maxStorageBytes,
    };
  }

  // Gói biến mất hẳn khỏi bảng — gần như bất khả thi (`fk_subscriptions_plan`
  // là RESTRICT). Free là hướng an toàn và có thể giải thích được.
  const free = await hanMucGoiFree(db);
  return { planName: free.name, ...free.limits };
}

/**
 * Hạn mức gói mặc định.
 *
 * Ném lỗi thay vì bịa một gói rỗng tại chỗ — cùng lập luận với `requireFreePlan`
 * ở `entitlements.ts`, nhưng ở đây hậu quả nặng hơn hẳn: một gói bịa với hạn mức
 * 0 sẽ chặn MỌI thao tác tạo của MỌI tổ chức chưa mua gói, và triệu chứng
 * ("không tạo được workspace") không chỉ về phía bảng `plans` chút nào.
 */
async function hanMucGoiFree(
  db: Db,
): Promise<{ name: string; limits: Omit<HanMucHieuLuc, 'planName'> }> {
  const free = await billingRepo.findPlanByCode(db, FREE_PLAN_CODE);
  if (free === null) {
    throw new Error(
      `Không tìm thấy gói '${FREE_PLAN_CODE}' trong bảng plans. ` +
        'Nó được gieo ở migration 30 — hãy chạy "npm run -w backend migrate".',
    );
  }

  return {
    name: free.name,
    limits: {
      workspaces: free.maxWorkspaces,
      reports: free.maxReports,
      members: free.maxMembers,
      storageBytes: free.maxStorageBytes,
    },
  };
}

interface MoTa {
  /** Danh từ số nhiều, dùng trong "tối đa 3 báo cáo". */
  danhTu: string;
  /** Câu chỉ đường ra khỏi tình huống. */
  loiThoat: string;
}

const MO_TA: Record<LoaiHanMuc, MoTa> = {
  workspaces: {
    danhTu: 'workspace',
    loiThoat: 'Nâng cấp gói hoặc xoá bớt workspace không còn dùng.',
  },
  reports: {
    danhTu: 'báo cáo',
    loiThoat: 'Nâng cấp gói hoặc xoá bớt báo cáo cũ.',
  },
  members: {
    danhTu: 'thành viên',
    loiThoat: 'Nâng cấp gói hoặc gỡ bớt thành viên không còn tham gia.',
  },
  storageBytes: {
    danhTu: 'dung lượng',
    loiThoat: 'Nâng cấp gói hoặc xoá bớt bộ dữ liệu cũ.',
  },
};

/**
 * Đổi byte sang chuỗi người đọc được.
 *
 * Dùng 1024 chứ không 1000 để khớp với hằng số trong `plans` (100MB =
 * 104857600), nếu không thì thông báo hiện "104,9 MB" cho một hạn mức mà bảng
 * giá gọi là 100MB, và khách sẽ tưởng hệ thống tính sai.
 */
function dinhDangDungLuong(bytes: number): string {
  const donVi = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < donVi.length - 1) {
    n /= 1024;
    i += 1;
  }
  // Số nguyên thì bỏ phần thập phân: "100 MB" đọc tốt hơn "100,0 MB".
  const lam = Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
  return `${lam} ${donVi[i] ?? 'B'}`;
}

async function demHienTai(db: Db, tenantId: number, loai: LoaiHanMuc): Promise<number> {
  switch (loai) {
    case 'workspaces':
      return usageRepo.demWorkspace(db, tenantId);
    case 'reports':
      return usageRepo.demBaoCao(db, tenantId);
    case 'members':
      return usageRepo.demThanhVien(db, tenantId);
    case 'storageBytes':
      return usageRepo.demDungLuong(db, tenantId);
  }
}

/**
 * Chặn nếu thao tác sắp tới làm tổ chức vượt hạn mức.
 *
 * @param them  Số lượng sắp thêm. Mặc định 1 cho các loại ĐẾM; với
 *              `storageBytes` thì đây là SỐ BYTE của tệp sắp tải lên, nên người
 *              gọi luôn phải truyền.
 *
 * ⚠️ Gọi hàm này BÊN TRONG transaction đang tạo, không phải trước nó. Nó nhận
 * `db` đúng vì lý do đó: kiểm ở một connection rồi ghi ở connection khác là
 * kiểm-rồi-ghi có khe hở, và hai request song song sẽ cùng thấy "còn một chỗ".
 *
 * ⚠️ Chỉ chặn TẠO MỚI. Không có đường nào từ hàm này khoá hay ẩn dữ liệu đã có:
 * tổ chức tụt từ Pro về Free với 40 báo cáo vẫn xem và sửa được cả 40, chỉ không
 * tạo thêm. Khoá dữ liệu khách đã làm ra vì họ hết hạn gói là thứ khác hẳn, và
 * không phải thứ được yêu cầu.
 */
export async function kiemHanMuc(
  db: Db,
  tenantId: number,
  loai: LoaiHanMuc,
  now: Date,
  them = 1,
): Promise<void> {
  const hanMuc = await hanMucHieuLuc(db, tenantId, now);
  const gioiHan = hanMuc[loai];

  // Không giới hạn: về ngay, KHÔNG chạy câu đếm. Với gói Business thì đây là
  // đường đi của mọi lần tạo, nên nó đáng được đi trước.
  if (gioiHan === null) return;

  const dangDung = await demHienTai(db, tenantId, loai);
  if (dangDung + them <= gioiHan) return;

  const { danhTu, loiThoat } = MO_TA[loai];
  const laDungLuong = loai === 'storageBytes';
  const soHoa = (n: number): string =>
    laDungLuong ? dinhDangDungLuong(n) : n.toLocaleString('vi-VN');

  /*
   * Thông báo phải nói đủ BA thứ: hạn mức bao nhiêu, đang dùng bao nhiêu, và
   * làm gì tiếp. Thiếu con số "đang dùng" thì khách không biết phải xoá bao
   * nhiêu; thiếu lối thoát thì họ đi mở ticket.
   */
  const dang = laDungLuong
    ? `tổ chức đang dùng ${soHoa(dangDung)} và phần thêm là ${soHoa(them)}`
    : `tổ chức đang có ${soHoa(dangDung)}`;

  throw new HttpError(
    409,
    BILLING_ERROR_CODES.LIMIT_EXCEEDED,
    `Gói ${hanMuc.planName} cho tối đa ${soHoa(gioiHan)} ${danhTu}, ${dang}. ${loiThoat}`,
  );
}
