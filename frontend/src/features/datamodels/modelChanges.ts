import type { QueryClient } from '@tanstack/react-query';

import { dataModelKeys } from './keys';

/**
 * Báo cho các TAB KHÁC biết một mô hình dữ liệu vừa đổi — §10.19.
 *
 *   "ở phần mục mô hình dữ liệu này nên có nút bấm để đi đến datamodel để
 *    người dùng có thể chỉnh sửa"
 *
 * Nút đó mở trang mô hình ở TAB MỚI, vì đi ngay trong tab thì mất cả khung chưa
 * lưu. Nhưng mỗi tab có cache react-query riêng: sửa vai trò cột ở tab mô hình
 * rồi quay lại, bảng trường của trình dựng vẫn là bản cũ — và người dùng tưởng
 * lần sửa không ăn.
 *
 * Nên mọi lần ghi mô hình, sau khi dọn cache của chính tab đó, còn phát một tin
 * qua kênh này. Tab nào đang mở app thì dọn cây `datamodels` của mình theo.
 *
 * ═══ Vì sao phát khi GHI, không phải làm mới khi QUAY LẠI tab ═══════════════
 *
 * Làm mới mỗi lần tab được nhìn thấy lại thì cứ alt-tab là mọi ô biểu đồ đang
 * mở bắn lại một lượt quét ClickHouse, cho một mô hình gần như chắc chắn không
 * đổi. Tin chỉ đi khi có một lần ghi thật, nên không có gì phải đoán.
 *
 * ⚠️ Tin KHÔNG mang dữ liệu nào, kể cả mã mô hình. Nhận tin là hỏi lại server
 * bằng token của chính tab nhận, nên không có đường nào để một tab đọc được thứ
 * nó không có quyền đọc.
 *
 * ⚠️ MỘT đối tượng kênh cho cả phát lẫn nghe. `BroadcastChannel` không gửi tin
 * về chính đối tượng đã phát, nhưng VẪN gửi tới một đối tượng khác cùng tên
 * trong cùng tab — hai đối tượng thì tab tự nhận tin của mình và dọn cache hai
 * lần cho mỗi lần lưu.
 */

const CHANNEL_NAME = 'bi.datamodels.changed';

interface ModelChannel {
  postMessage: (message: unknown) => void;
  addEventListener: (type: 'message', listener: () => void) => void;
  removeEventListener: (type: 'message', listener: () => void) => void;
  close: () => void;
}

/** `undefined` = chưa mở; `null` = trình duyệt không có `BroadcastChannel`. */
let channel: ModelChannel | null | undefined;

function openChannel(): ModelChannel | null {
  if (channel === undefined) {
    try {
      channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;
    } catch {
      channel = null;
    }
  }
  return channel;
}

/**
 * Phát tin "mô hình vừa đổi". Không có kênh thì im lặng: tab khác chỉ thấy
 * thay đổi sau khi tải lại, đúng như trước khi có file này.
 */
export function announceModelChanged(): void {
  try {
    openChannel()?.postMessage({ type: 'changed' });
  } catch {
    // Kênh đã đóng — không đáng làm hỏng một lần lưu vừa thành công.
  }
}

/** Nghe tin từ tab khác. Trả về hàm huỷ nghe. */
export function onModelChangedElsewhere(listener: () => void): () => void {
  const ch = openChannel();
  if (ch === null) return () => {};
  const handle = (): void => listener();
  ch.addEventListener('message', handle);
  return () => ch.removeEventListener('message', handle);
}

/**
 * Dọn cây `datamodels` của TAB NÀY mỗi khi một tab khác ghi mô hình.
 *
 * Gọi đúng một lần, cạnh chỗ dựng `QueryClient` — tuổi thọ của việc nghe bằng
 * tuổi thọ của cache nó dọn. Không để trong một component: trình dựng không
 * phải chỗ duy nhất đọc mô hình (hai tab cùng mở trang mô hình cũng cần), và
 * StrictMode gắn effect hai lần.
 *
 * ⚠️ Gọi `invalidateQueries` TRỰC TIẾP, không qua `useInvalidateDataModel`:
 * cái đó phát tin, và tab nhận tin mà phát lại thì hai tab đá tin qua lại mãi.
 *
 * Chỉ query ĐANG GẮN mới hỏi lại ngay — trong trình dựng là bảng trường, trạng
 * thái Cube và số liệu các ô đang hiện. Phần còn lại chỉ bị đánh dấu cũ.
 */
export function syncModelChangesAcrossTabs(queryClient: QueryClient): () => void {
  return onModelChangedElsewhere(() => {
    void queryClient.invalidateQueries({ queryKey: dataModelKeys.all });
  });
}

/** Chỉ cho test: đóng kênh đang giữ để lần gọi sau mở một kênh mới. */
export function resetModelChannelForTest(): void {
  channel?.close();
  channel = undefined;
}
