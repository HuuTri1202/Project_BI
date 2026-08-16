import { isTest } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import * as loadsRepo from '../../repositories/datasetLoads';
import * as datasetsRepo from '../../repositories/datasets';
import { ensureAutoDataModel } from '../datamodel/autoDataModel';
import { sweepOrphanTables } from './dropTables';
import { loadDataset } from './loadDataset';

/**
 * Vòng lặp nạp chạy NỀN, trong chính tiến trình Express (§9.6).
 *
 * ─── Vì sao không dùng BullMQ / một worker riêng ────────────────────────────
 *
 * Đây là tác vụ chạy vài lần một ngày trên một hệ thống mà Redis đã có mặt
 * nhưng chỉ để đếm số lần đăng nhập sai. Thêm một hàng đợi thật là thêm một
 * tiến trình phải khởi động, phải giám sát, phải tắt đúng thứ tự — cho một thứ
 * mà một bảng MySQL và một `setTimeout` làm được.
 *
 * Cái giá đã biết, và nó có thật: job KHÔNG sống qua restart, và cả hệ thống chỉ
 * chạy MỘT job một lúc. Cả hai đều được ghi vào phần nợ kỹ thuật, không giấu.
 */

/** Khoảng nghỉ giữa hai lần ngó hàng đợi. */
const POLL_MS = 2_000;

/**
 * Số vòng giữa hai lần janitor quét bảng mồ côi — 1.800 × 2 giây = một giờ.
 *
 * Janitor đi CHUNG `tick()` với việc nạp thay vì có bộ đếm giờ riêng, và đó là
 * quyết định chứ không phải tiết kiệm: dùng chung nghĩa là một lần quét không
 * bao giờ chạy song song với một lần nạp TRONG CÙNG tiến trình, nên nó không thể
 * drop trúng bảng tạm `__new` mà lần nạp ấy đang ghi dở. `stopIngestRunner` cũng
 * đúng miễn phí — chỉ có một `timer` và một `running` để chờ.
 *
 * Một giờ là đủ thưa: xoá ngay ở `deleteDataset` đã lo trường hợp thường gặp,
 * janitor chỉ là lưới hứng cho ba lỗ hiếm (xem `dropTables.ts`).
 */
const SWEEP_EVERY_TICKS = 1_800;

let timer: NodeJS.Timeout | undefined;
let stopping = false;
let running: Promise<void> | undefined;
/** 0 = quét ngay ở vòng đầu, để một lần khởi động lại dọn luôn tàn dư. */
let ticksUntilSweep = 0;

export function startIngestRunner(): void {
  // Không chạy trong test, và điều này quan trọng hơn vẻ ngoài của nó: test tích
  // hợp gọi thẳng `loadDataset()` rồi `await`, nên mọi khẳng định đều tất định.
  // Một vòng lặp chạy song song sẽ nhặt mất job mà bài test vừa xếp hàng, và bài
  // test đó sẽ đỏ hoặc xanh tuỳ tốc độ máy.
  if (isTest) return;
  if (timer !== undefined) return;

  stopping = false;
  ticksUntilSweep = 0;
  // Dọn tàn dư TRƯỚC vòng đầu tiên. Xem `failStaleRuns`.
  void loadsRepo
    .failStaleRuns(mysqlPool)
    .then((n) => {
      if (n > 0) console.warn(`[ingest] đánh hỏng ${n} lần nạp còn treo từ lần chạy trước`);
    })
    .catch((err: unknown) => {
      console.error('[ingest] không dọn được lần nạp treo:', err);
    });

  schedule();
  console.log('[ingest] vòng lặp nạp đã khởi động');
}

/**
 * Dừng êm, và phải gọi TRƯỚC `closeMysql()`.
 *
 * Vòng lặp đang giữ connection từ chính pool đó. Đóng pool trước là cắt ngang
 * nó, và một lần dừng có trật tự biến thành một trang log "Pool is closed" mà
 * không dòng nào nói được chuyện gì thật sự xảy ra.
 */
export async function stopIngestRunner(): Promise<void> {
  stopping = true;
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  // Chờ job hiện tại tự kết thúc. Không huỷ giữa chừng: bảng tạm `__new` sẽ bị
  // `DROP … SYNC` dọn ở lần nạp sau, còn bảng đang phục vụ thì chưa bị đụng tới.
  await running;
}

/**
 * `setTimeout` nối tiếp, KHÔNG `setInterval`.
 *
 * `setInterval` bắn theo đồng hồ bất kể lần trước xong chưa. Một lần nạp ba phút
 * sẽ tích lại 90 lần gọi chồng lên nhau, và tất cả cùng bung ra một lúc khi nó
 * xong.
 */
function schedule(): void {
  if (stopping) return;
  timer = setTimeout(() => {
    running = tick().finally(() => {
      running = undefined;
      schedule();
    });
  }, POLL_MS);
}

async function tick(): Promise<void> {
  if (stopping) return;

  if (ticksUntilSweep <= 0) {
    // Đặt lại bộ đếm TRƯỚC khi quét, không phải sau. Quét hỏng thì cũng phải chờ
    // đủ một giờ nữa — ngược lại, ClickHouse tắt sẽ thành một lần thử mỗi 2 giây
    // kèm một dòng log lỗi mỗi 2 giây.
    ticksUntilSweep = SWEEP_EVERY_TICKS;
    try {
      const dropped = await sweepOrphanTables();
      if (dropped > 0) console.log(`[ingest] janitor: đã dọn ${dropped} bảng mồ côi`);
    } catch (err) {
      console.error('[ingest] janitor: không quét được kho:', err);
    }
  } else {
    ticksUntilSweep -= 1;
  }

  let claimed;
  try {
    claimed = await loadsRepo.claimNext(mysqlPool);
  } catch (err) {
    // Database chưa sẵn sàng hoặc vừa mất kết nối. Ghi log rồi thử lại ở vòng
    // sau — không được để một lỗi ở đây giết cả vòng lặp.
    console.error('[ingest] không nhặt được việc:', err);
    return;
  }
  if (!claimed) return;

  const { runId, tenantId, datasetId } = claimed;
  await datasetsRepo.markLoadStatus(mysqlPool, datasetId, 'running');

  try {
    const outcome = await loadDataset(runId, tenantId, datasetId);
    await loadsRepo.updateProgress(mysqlPool, runId, outcome);
    await loadsRepo.finish(mysqlPool, runId, 'succeeded', null);
    await datasetsRepo.markLoadStatus(mysqlPool, datasetId, 'loaded', {
      chTable: outcome.chTable,
      rowCount: outcome.rowsLoaded,
    });
    console.log(
      `[ingest] dataset ${datasetId}: nạp xong ${outcome.rowsLoaded}/${outcome.rowsRead} dòng` +
        (outcome.rowsFailed > 0 ? `, ${outcome.rowsFailed} ô lỗi` : ''),
    );

    // Nạp xong -> có ngay một mô hình dùng được (§10). SAU khi đã đánh dấu
    // `loaded`, vì hàm này đọc lại trạng thái đó để biết có nên tạo hay không.
    // Nó tự nuốt mọi lỗi: sinh mô hình hỏng không được phép biến một lần nạp
    // thành công thành thất bại.
    await ensureAutoDataModel(tenantId, datasetId, null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingest] dataset ${datasetId}: nạp hỏng —`, err);
    await loadsRepo.finish(mysqlPool, runId, 'failed', message).catch(() => undefined);
    await datasetsRepo.markLoadStatus(mysqlPool, datasetId, 'failed').catch(() => undefined);
  }
}
