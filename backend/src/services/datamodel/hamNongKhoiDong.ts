import { mysqlPool } from '../../config/mysql';
import * as datamodelsRepo from '../../repositories/datamodels';
import { hamNongNguCanh, pingCube } from './cubeClient';

/**
 * Hâm nóng ngữ cảnh biên dịch của Cube MỘT LẦN sau khi khởi động.
 *
 * ═══ Nó bịt chỗ hở nào ═════════════════════════════════════════════════════
 *
 * Ngữ cảnh đã biên dịch chỉ nguội vì ĐÚNG HAI nguyên nhân — đo được, không phải
 * suy luận (xem bảng số ở `hamNongNguCanh` và §2 README):
 *
 *   1. `schemaVersion` đổi, tức là có người LƯU mô hình.
 *   2. Tiến trình Cube khởi động lại.
 *
 * Nguyên nhân (1) đã có người lo: `regenerateTenant` hâm ngay sau khi lưu, nên
 * người vừa bấm Lưu là người trả tiền biên dịch — và họ đang ngồi chờ sẵn.
 *
 * Nguyên nhân (2) thì KHÔNG ai lo, và đó là file này. Trước đây giá đó rơi vào
 * người mở biểu đồ đầu tiên sau mỗi lần dựng lại hạ tầng: 2,7–4,5 giây, và với
 * một khung 12 ô thì cả 12 ô xếp hàng sau đúng một lần biên dịch đó.
 *
 * ⚠️ KHÔNG có nguyên nhân thứ ba — đừng thêm một vòng ping định kỳ. Ngồi im
 * không làm nguội ngữ cảnh: đo ngày 25/11/2026, cùng `schemaVersion` và không
 * có ai chen vào, nghỉ 150 giây mất 531ms và nghỉ 5 phút mất 351ms, so với
 * 1702–2972ms của một lần biên dịch thật. Phần vài trăm ms đó là kết nối và
 * cache của driver, một vòng ping không mua lại được.
 *
 * ═══ Vì sao PHẢI có trần số tổ chức ════════════════════════════════════════
 *
 * `regenerateAllTenants` cố ý truyền `hamNong: false` và lý do nó ghi ở đó vẫn
 * đúng ở đây: hâm MỌI tổ chức lúc boot (đã đo: 63 tổ chức có file cube) là bắn
 * 63 lần biên dịch, mỗi lần 2,7–4,5 giây, vào một Cube vừa mở — tự dựng lại
 * đúng cái chậm mà việc hâm nóng sinh ra để tránh, vì truy vấn của người dùng
 * thật sẽ xếp hàng sau đống đó.
 *
 * Nên bản này KHÁC bản đã bị loại ở hai điểm, và cả hai đều bắt buộc:
 *
 *   • CÓ TRẦN (`TRAN_TO_CHUC`), sắp theo tổ chức sửa gần nhất trước. Tổ chức
 *     ngoài trần không mất gì so với trước — vẫn hâm ở lần mở đầu, y như cũ.
 *   • TUẦN TỰ. Nhiều nhất một lần biên dịch đang bay, nên một người dùng tới
 *     giữa lúc hâm chỉ chờ hết lượt đang chạy, không chờ cả hàng.
 *
 * Gỡ một trong hai là quay về đúng giả thuyết đã bị số đo loại. Đừng gỡ.
 *
 * ═══ Nó KHÔNG chữa được gì — đọc trước khi tin ═════════════════════════════
 *
 * File này gỡ chi phí BIÊN DỊCH khỏi request của người dùng, đo trên một Cube
 * đã chạy ổn định, mỗi dòng là một `schemaVersion` mới tinh:
 *
 *     `/load` đầu tiên, CÓ `/meta` hâm trước:    264 / 169 /  71ms
 *     `/load` đầu tiên, KHÔNG hâm:               903 / 1438 / 820ms
 *
 * Nhưng ngay sau `docker restart bi-cube` còn một cái chậm THỨ HAI, nằm trong
 * đường chạy truy vấn của Cube (hàng đợi Cube Store), và `/meta` không chạm tới
 * nó. Đo cùng ngày, ở phút thứ 2 sau restart, cả hai nhánh đều ~5–6 giây dù
 * ngữ cảnh đã hâm xong; tới khoảng phút thứ 5 mới về bảng số trên.
 *
 * Nên đừng hứa "biểu đồ đầu tiên sau khi dựng lại hạ tầng là nhanh". Đúng hơn:
 * trong vài phút đầu sau khi Cube khởi động lại thì vẫn chậm, và phần backend
 * làm được đã làm xong — phần còn lại nằm trong Cube.
 */

/**
 * Hâm nhiều nhất bao nhiêu tổ chức.
 *
 * Năm, không phải "tất cả": xem khối trên. Con số này đổi được, nhưng đổi lên
 * thì phải đo lại thời gian một người dùng tới giữa lúc hâm phải chờ — đó là
 * đại lượng mà trần này bảo vệ, không phải thời gian boot.
 */
const TRAN_TO_CHUC = 5;

/** Nhịp hỏi lại đầu tiên khi Cube chưa trả lời được. Gấp đôi sau mỗi lần hỏng. */
const NHIP_DAU_MS = 3_000;

/** Trần khi lùi nhịp — đủ thưa để không gõ cửa vô ích, đủ dày để không bỏ sót. */
const NHIP_TOI_DA_MS = 30_000;

/**
 * Bỏ hẳn sau bao lâu.
 *
 * Năm phút vì `pingCube` đã đo được Cube cần tới **2 phút 7 giây** sau khi
 * `/readyz` xanh mới trả lời nổi một truy vấn thật. Một lần thử rồi thôi là
 * gần như chắc chắn trượt, nên hàm này thử lại chứ không bắn một phát.
 *
 * Hết giờ KHÔNG phải sự cố: máy của người làm giao diện thường không bật Cube.
 * Thông báo phải nói ra rằng mọi thứ vẫn chạy, chỉ là trả giá biên dịch ở lần
 * mở biểu đồ đầu tiên như trước khi có file này.
 */
const TRAN_CHO_MS = 5 * 60_000;

let daYeuCauDung = false;
let timer: NodeJS.Timeout | undefined;
let danhThuc: (() => void) | undefined;
let dangChay: Promise<void> | undefined;

/**
 * Bắt đầu hâm nóng — KHÔNG chặn, KHÔNG ném.
 *
 * ⚠️ PHẢI gọi SAU khi `regenerateAllTenants()` đã xong, không phải song song.
 * File cube nằm trong `.gitignore`, nên lúc boot thư mục của một tổ chức hoàn
 * toàn có thể còn trống; `repositoryFactory` trong `cube.js` trả mảng rỗng cho
 * thư mục không có file, và Cube sẽ NHỚ cái ngữ cảnh rỗng đó dưới đúng
 * `schemaVersion` hiện tại. Hậu quả không phải "chậm" mà là mọi truy vấn báo
 * không thấy cube cho tới khi có người lưu lại một mô hình — một lần hâm nóng
 * sai thời điểm còn tệ hơn không hâm.
 */
export function startHamNongKhoiDong(): void {
  // `stop` có thể đã chạy trước: `start` được nối sau một promise, nên tiến
  // trình hoàn toàn có thể nhận SIGTERM trong lúc còn đang sinh lại schema.
  if (daYeuCauDung) return;

  dangChay = chay().catch((err: unknown) => {
    console.error('[datamodel] hâm nóng ngữ cảnh Cube lúc khởi động hỏng:', err);
  });
}

/**
 * Dừng có trật tự.
 *
 * Phải gọi TRƯỚC `closeMysql()` cùng lý do với ba vòng lặp nền kia: hàm này đọc
 * danh sách tổ chức từ chính pool đó.
 */
export async function stopHamNongKhoiDong(): Promise<void> {
  daYeuCauDung = true;

  // Đánh thức luôn chứ không chỉ `clearTimeout`: huỷ timer mà không giải quyết
  // promise thì `await dangChay` dưới đây treo đến hết đời tiến trình.
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  danhThuc?.();

  await dangChay;
}

function nghi(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    danhThuc = resolve;
    timer = setTimeout(resolve, ms);
  });
}

async function chay(): Promise<void> {
  const danhSach = await datamodelsRepo.tenantsDeHamNong(mysqlPool, TRAN_TO_CHUC);

  // Chưa ai dựng mô hình nào là chuyện bình thường — im lặng, không log.
  const dauTien = danhSach[0];
  if (dauTien === undefined) return;

  /*
   * Tổ chức đầu tiên đi qua `pingCube`, và nó làm HAI việc trong một lời gọi:
   * vừa trả lời "Cube đáp được chưa", vừa hâm chính tổ chức đó, vì cả hai đều
   * là `GET /cubejs-api/v1/meta`. Nên vòng chờ dưới đây không có lượt nào bỏ
   * đi: mỗi lần hỏi lại là hâm thêm, kể cả lượt bị cắt vì quá 5 giây — Cube
   * không dừng biên dịch khi ta ngắt kết nối.
   */
  if (!(await choCubeDapDuoc(dauTien))) {
    if (daYeuCauDung) return;
    console.log(
      '[datamodel] bỏ hâm nóng ngữ cảnh Cube: Cube không trả lời trong ' +
        `${TRAN_CHO_MS / 60_000} phút. Mọi thứ vẫn chạy — biểu đồ sẽ trả giá ` +
        'biên dịch ở lần mở đầu tiên, như khi chưa có bước hâm nóng này.',
    );
    return;
  }

  let xong = 1;
  for (const toChuc of danhSach.slice(1)) {
    if (daYeuCauDung) return;
    try {
      await hamNongNguCanh(toChuc);
      xong += 1;
    } catch {
      // Cố hết sức, hỏng thì thôi: tổ chức này chỉ đơn giản là hâm ở lần mở
      // đầu tiên. Không log từng tổ chức — một Cube vừa tắt giữa vòng sẽ sinh
      // ra `TRAN_TO_CHUC` dòng lỗi nói đúng một điều.
    }
  }

  console.log(`[datamodel] đã hâm nóng ngữ cảnh Cube cho ${xong}/${danhSach.length} tổ chức`);
}

async function choCubeDapDuoc(toChuc: datamodelsRepo.TenantSchemaVersion): Promise<boolean> {
  const hetGio = Date.now() + TRAN_CHO_MS;
  let nhip = NHIP_DAU_MS;

  for (;;) {
    if (daYeuCauDung) return false;
    if (await pingCube(toChuc)) return true;
    if (Date.now() >= hetGio) return false;

    await nghi(nhip);
    nhip = Math.min(nhip * 2, NHIP_TOI_DA_MS);
  }
}
