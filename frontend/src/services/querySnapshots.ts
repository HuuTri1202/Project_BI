import { hashKey } from '@tanstack/react-query';

/**
 * Câu trả lời CUỐI CÙNG của một query, giữ lại trên đĩa của trình duyệt.
 *
 * ═══ Vấn đề nó giải ═════════════════════════════════════════════════════════
 *
 * Mở một báo cáo ĐÃ LƯU, người dùng thấy "Đang tính…" rồi chờ vài giây mới ra
 * biểu đồ — đúng cái biểu đồ họ đã nhìn thấy lần trước, không khác một nét.
 * Báo cáo chỉ lưu CẤU HÌNH ("gộp thước đo 486 theo chiều 1264"), không lưu con
 * số, nên mỗi lần mở là một lượt tính lại từ đầu qua Cube xuống ClickHouse.
 *
 * Đo trên máy phát triển, cùng một truy vấn:
 *
 *   lần đầu sau khi Cube khởi động / sau khi mô hình đổi   4.638 ms
 *   những lần sau                                          49–175 ms
 *
 * Bốn tới sáu giây đó là Cube BIÊN DỊCH schema của cả tổ chức (`schemaVersion`
 * trong `cubeClient.ts` là `MAX(updated_at)` của mọi mô hình còn sống, nên bất
 * kỳ thay đổi mô hình nào cũng buộc biên dịch lại). Không có cách nào ở tầng
 * ứng dụng làm nó nhanh hơn — nhưng có cách để người dùng không phải NHÌN nó.
 *
 * ═══ Vì sao là đĩa của TRÌNH DUYỆT, không phải một bảng cache ở server ══════
 *
 * Token gửi xuống Cube mang cả `userId`, và `queryRewrite` trong
 * `infrastructure/cube/cube.js` được để dành sẵn cho Row-level Security. Một
 * bảng cache dùng chung, khoá theo (báo cáo, cấu hình), sẽ trả số của người này
 * cho người kia ngay ngày RLS được bật — một lỗi rò dữ liệu ra đời từ một tính
 * năng tăng tốc. `localStorage` thì per-trình-duyệt, per-người, theo cấu tạo.
 *
 * ═══ Ba luật ════════════════════════════════════════════════════════════════
 *
 *   1. LUÔN hỏi lại. Ảnh chụp chỉ để VẼ NGAY, không phải để khỏi hỏi. Nó vào
 *      react-query qua `initialData` + `initialDataUpdatedAt`, nên `staleTime`
 *      xử nó đúng như một câu trả lời cũ: vẽ liền, rồi làm mới ngầm.
 *   2. Khoá là `hashKey` của CHÍNH query key. Cùng một hàm react-query dùng để
 *      băm khoá trong bộ nhớ (đã sắp thứ tự khoá object), nên ảnh chụp trên đĩa
 *      và mục trong bộ nhớ không thể chỉ về hai câu hỏi khác nhau. Đổi cấu
 *      hình biểu đồ là đổi khoá là TRƯỢT cache — chứ không phải vẽ số cũ cho
 *      cấu hình mới.
 *   3. Hỏng thì im lặng bỏ qua. Chế độ riêng tư, trình duyệt chặn cookie, hết
 *      quota — `localStorage` NÉM LỖI chứ không trả null (xem
 *      `workspaceStorage.ts`). Một cái cache làm chết cả trang là một cái cache
 *      tệ hơn không có.
 *
 * ⚠️ `qs1` trong tiền tố là PHIÊN BẢN HÌNH DẠNG. Đổi hình dạng của bất kỳ DTO
 * nào được chụp ở đây thì tăng lên `qs2`: ảnh chụp cũ nằm trong máy người dùng
 * sẽ được đọc bởi code mới, và một trường mới bắt buộc sẽ làm trình vẽ ném lỗi
 * trên một dữ liệu mà không request nào tạo ra được nữa.
 */

const PREFIX = 'bi.qs2.';

/**
 * Trần số ảnh chụp giữ lại.
 *
 * Một khung tối đa 12 ô, và người dùng thường xoay quanh vài báo cáo — 40 phủ
 * hết chỗ đó mà vẫn còn xa giới hạn ~5 MB của `localStorage`.
 */
const MAX_ENTRIES = 40;

/**
 * Trần cỡ MỘT ảnh chụp.
 *
 * `MAX_GROUPS` phía backend là 100 nhóm × 12 chuỗi, nên một câu trả lời to nhất
 * vẫn dưới ngưỡng này. Trần ở đây để một dữ liệu bất thường không một mình ăn
 * hết quota rồi đẩy 39 ảnh chụp còn lại ra ngoài.
 */
const MAX_BYTES = 64 * 1024;

export interface QuerySnapshot<T> {
  /** Lúc con số này được TÍNH (nhận về), tính bằng epoch ms. */
  at: number;
  data: T;
}

/** Định danh ảnh chụp của một query key — dùng làm dep của `useMemo`. */
export function snapshotIdOf(queryKey: readonly unknown[]): string {
  return hashKey(queryKey);
}

export function readSnapshot<T>(id: string): QuerySnapshot<T> | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + id);
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const { at, data } = parsed as Partial<QuerySnapshot<T>>;
    // `data === undefined` cũng bị loại: đưa `undefined` vào `initialData` của
    // react-query nghĩa là "không có initialData", nhưng nó lại đi kèm một
    // `initialDataUpdatedAt` cũ — query sẽ tưởng mình đã có dữ liệu cũ.
    if (typeof at !== 'number' || data === undefined) return null;

    return { at, data };
  } catch {
    return null;
  }
}

export function writeSnapshot(id: string, data: unknown): void {
  let body: string;
  try {
    body = JSON.stringify({ at: Date.now(), data });
  } catch {
    return;
  }
  if (body.length > MAX_BYTES) return;

  try {
    window.localStorage.setItem(PREFIX + id, body);
  } catch {
    // Gần như luôn là hết quota. Dọn rồi thử LẠI ĐÚNG MỘT LẦN: thử lại vòng
    // lặp trên một quota đã đầy vì thứ khác (token, workspace…) là treo trang.
    prune(0);
    try {
      window.localStorage.setItem(PREFIX + id, body);
    } catch {
      return;
    }
  }

  prune(MAX_ENTRIES);
}

/**
 * Xoá sạch — gọi khi ĐỔI PHIÊN.
 *
 * Cùng lý do `queryClient.clear()` có mặt trong `AuthProvider`: cache không gắn
 * với tài khoản nào cả. Khác một điểm khiến chỗ này còn cần hơn: cache của
 * react-query chết theo tab, còn cái này sống qua cả lần đóng trình duyệt. Trên
 * máy dùng chung, số liệu của người trước sẽ hiện ra cho người sau — chớp một
 * cái rồi bị số mới đè lên, nhưng nó đã hiện ra rồi.
 */
export function clearSnapshots(): void {
  try {
    for (const key of ownKeys()) window.localStorage.removeItem(key);
  } catch {
    /* không đọc được kho thì cũng không có gì để xoá */
  }
}

function ownKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key !== null && key.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

/** Giữ lại `keep` ảnh chụp mới nhất, xoá phần còn lại. */
function prune(keep: number): void {
  try {
    const keys = ownKeys();
    if (keys.length <= keep) return;

    const aged = keys
      .map((key) => {
        // Ảnh chụp hỏng không đọc được `at` bị coi là cũ nhất, nên nó ra đi
        // trước — đằng nào `readSnapshot` cũng từ chối nó.
        let at = 0;
        try {
          at = (JSON.parse(window.localStorage.getItem(key) ?? '{}') as { at?: number }).at ?? 0;
        } catch {
          at = 0;
        }
        return { key, at };
      })
      .sort((a, b) => b.at - a.at);

    for (const entry of aged.slice(keep)) window.localStorage.removeItem(entry.key);
  } catch {
    /* xem luật 3 */
  }
}
