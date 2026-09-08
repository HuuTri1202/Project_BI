import { mysqlPool } from '../../src/config/mysql';
import { redis } from '../../src/config/redis';
import { memoryStorage } from '../../src/storage/memoryStorage';

/**
 * Dọn sạch database test trước mỗi ca.
 *
 * Tắt kiểm tra khoá ngoại để không phải xoá đúng thứ tự phụ thuộc — CHỈ làm
 * được vì đây là database dùng riêng cho test (`bi_platform_test`), không bao
 * giờ chạy trên dữ liệu thật.
 */
export async function resetDatabase(): Promise<void> {
  await mysqlPool.query('SET FOREIGN_KEY_CHECKS = 0');
  // Thứ tự từ CON tới CHA. Khoá ngoại đã tắt nên không bắt buộc, nhưng giữ đúng
  // thứ tự để ai đọc còn thấy được cây phụ thuộc.
  for (const table of [
    'reports',
    // §10 — tầng ngữ nghĩa. Quan hệ trỏ vào cột, cột trỏ vào thành phần, thành
    // phần trỏ vào cả mô hình lẫn bộ dữ liệu — nên khối này phải nằm trước
    // `datasets`.
    'datamodel_relationships',
    'datamodel_measures',
    'datamodel_columns',
    'datamodel_datasets',
    'datamodels',
    // Sổ ghi chép của §9. `dataset_load_errors` trỏ vào `dataset_load_runs`, nên
    // nó phải đứng trước — dữ liệu THẬT của §9 nằm bên ClickHouse, không có gì
    // để TRUNCATE ở đây.
    'dataset_load_errors',
    'dataset_load_runs',
    // MỘT bộ `datasets` cho cả hai nguồn — file tải lên (§7) và bảng đồng bộ từ
    // CSDL khách hàng (§8). `dataset_rows` chỉ nguồn `file` dùng tới.
    'dataset_rows',
    'dataset_columns',
    'datasets',
    'connections',
    'workspaces',
    'memberships',
    'users',
    'tenants',
  ]) {
    await mysqlPool.query(`TRUNCATE TABLE ${table}`);
  }

  /*
   * ─── §11 dùng DELETE, KHÔNG dùng TRUNCATE — và đây là chuyện đo được ─────
   *
   * Bản đầu nhét bảy bảng này vào danh sách TRUNCATE ở trên. Hậu quả không phải
   * "hơi chậm" mà là đỏ ngẫu nhiên: hook `beforeEach` vượt trần 10 giây của
   * vitest, và mỗi lần chạy lại một bài KHÁC đỏ — ở `datamodel`, rồi `dataset`,
   * rồi `ingest` — với thông báo chẳng nói gì về nguyên nhân.
   *
   * Đo trên chính máy này, 30 vòng, đúng bảy bảng đó:
   *
   *     TRUNCATE   trung bình 854ms   (max 1594ms)
   *     DELETE     trung bình 4,4ms   (max 13ms)
   *
   * Gần 200 lần. Lý do: TRUNCATE của InnoDB là DDL — nó xoá rồi dựng lại
   * tablespace trên đĩa, và trên Docker chạy Windows thì mỗi lần như vậy là một
   * vòng ra hệ thống file thật. DELETE trên bảng gần như rỗng thì chỉ là một
   * lần quét chỉ mục.
   *
   * Cái TRUNCATE cho mà DELETE không cho là đặt lại AUTO_INCREMENT. §11 không
   * cần: mã đơn sinh ngẫu nhiên, gói tra theo `code`, và không bài nào khẳng
   * định một id cụ thể.
   *
   * ⚠️ Thứ tự CON -> CHA ở đây là BẮT BUỘC chứ không phải cho dễ đọc như khối
   * trên: `SET FOREIGN_KEY_CHECKS = 0` vẫn đang bật, nhưng khi ai đó bỏ dòng
   * đó đi thì DELETE sai thứ tự sẽ đâm vào `fk_..._order` với RESTRICT.
   */
  for (const table of [
    // Hai bảng này KHÔNG có khoá ngoại nào (cố ý — xem migration 30), nên vị
    // trí tự do; đặt đầu khối cho khớp cách đọc "con trước".
    'audit_logs',
    'payment_webhook_events',
    'payment_transactions',
    'subscriptions',
    'orders',
    /*
     * Bảng giá CÓ bị dọn, rồi gieo lại ngay dưới.
     *
     * Bản đầu để chúng nguyên với lý do "dữ liệu cấu trúc, giống `casbin_rule`"
     * — nghe hợp lý và SAI, vì có một khác biệt quyết định: không bài test nào
     * SỬA `casbin_rule`, còn bảng giá thì bị sửa liên tục. Một ca đặt
     * `is_public = 0` cho gói `pro` (để kiểm "gói ẩn thì không mua được") đã
     * làm hỏng mười chín ca sau nó.
     */
    'payment_methods',
    'plans',
  ]) {
    await mysqlPool.query(`DELETE FROM ${table}`);
  }

  await mysqlPool.query('SET FOREIGN_KEY_CHECKS = 1');

  await reseedBillingCatalog();

  // File "đã tải lên" của ca trước sống trong một Map ngoài database, nên
  // TRUNCATE không chạm tới. Không dọn thì một ca vẫn phân tích được file của ca
  // trước dù bản ghi dataset đã biến mất — và ca đó sẽ xanh vì lý do sai.
  memoryStorage.reset();

  // Hai loại khoá Redis sống lâu hơn một ca test và cả hai đều gây đỏ vì lý do
  // sai:
  //
  //   ratelimit:*        bộ đếm có TTL tính bằng phút. Suite này tạo tài khoản
  //                      hàng chục lần từ cùng một IP nên tự đâm vào giới hạn
  //                      của chính nó, và mọi ca sau nhận 429.
  //
  //   dataset:analyze:*  cache kết quả phân tích file, khoá theo id. TRUNCATE
  //                      đặt lại AUTO_INCREMENT về 1, nên bộ dữ liệu số 1 của ca
  //                      này TRÙNG khoá với số 1 của ca trước — và ca này sẽ thấy
  //                      schema của một file nó chưa từng tải lên. Kiểu đỏ tệ
  //                      nhất: nó có thể XANH nhầm.
  const keys = await redis.keys('ratelimit:*');
  const analyzeKeys = await redis.keys('dataset:analyze:*');
  const all = [...keys, ...analyzeKeys];
  if (all.length > 0) await redis.del(...all);
}

/**
 * Gieo lại bảng giá và phương thức thanh toán về ĐÚNG trạng thái của migration 30.
 *
 * ─── Vì sao phải chép lại thay vì để nguyên dữ liệu gieo ───────────────────
 *
 * `orders.plan_id` là khoá ngoại NOT NULL, nên `plans` rỗng nghĩa là không ca
 * nào tạo được đơn. Nhưng để nguyên bảng qua các ca thì một ca sửa giá hay ẩn
 * gói sẽ làm hỏng mọi ca sau — và chúng đỏ ở một chỗ chẳng liên quan gì tới
 * nguyên nhân. TRUNCATE rồi gieo lại cho cả hai: trạng thái xác định VÀ dữ liệu
 * có mặt.
 *
 * ⚠️ Ba dòng gói dưới đây phải KHỚP với `INSERT IGNORE INTO plans` của
 * migration 30. Đây là chép tay có chủ ý: migration đã đẩy lên remote thì đóng
 * băng, nên không import được từ đó, và một hằng số dùng chung sẽ khiến sửa
 * hằng số đó âm thầm đổi nghĩa của một migration đã chạy trên máy người khác.
 *
 * Bài `billing.integration.test.ts` khẳng định đúng ba giá trị này (ba gói, gói
 * Business hạn mức NULL, phương thức chưa có số tài khoản) — nên lệch với
 * migration thì bộ đó đỏ ngay, và đó là chốt canh cho việc chép tay.
 */
export async function reseedBillingCatalog(): Promise<void> {
  await mysqlPool.query(
    `INSERT INTO plans
       (code, name, description, price_vnd, duration_days,
        max_workspaces, max_reports, max_members, max_storage_bytes,
        is_public, is_featured, sort_order)
     VALUES
       ('free', 'Miễn phí', 'Dùng thử đầy đủ tính năng ở quy mô nhỏ.',
        0, 0, 1, 3, 3, 104857600, 1, 0, 10),
       ('pro', 'Chuyên nghiệp', 'Cho đội ngũ đang vận hành báo cáo hằng ngày.',
        299000, 30, 5, 50, 10, 5368709120, 1, 1, 20),
       ('business', 'Doanh nghiệp', 'Không giới hạn workspace, báo cáo và thành viên.',
        899000, 30, NULL, NULL, NULL, 53687091200, 1, 0, 30)`,
  );

  // Số tài khoản để TRỐNG, đúng như migration: nó là dữ liệu vận hành thật.
  // Ca nào cần tạo đơn phải tự điền — đúng việc người vận hành làm ở lần cài
  // đầu tiên, và nhờ vậy nhánh "chưa cấu hình" được đi qua thật chứ không chỉ
  // được mô tả.
  await mysqlPool.query(
    `INSERT INTO payment_methods
       (code, provider, name, instructions, is_active, sort_order)
     VALUES
       ('vietqr_bank', 'bank_transfer', 'Chuyển khoản ngân hàng (VietQR)',
        'Quét mã QR hoặc chuyển khoản thủ công. Nội dung chuyển khoản phải là mã đơn hàng, giữ nguyên không thêm bớt ký tự nào. Đơn được kích hoạt sau khi quản trị viên đối chiếu sao kê.',
        1, 10),
       ('momo_static', 'momo', 'Ví MoMo',
        'Quét mã QR bằng ứng dụng MoMo. Nhập ĐÚNG số tiền của đơn, và ghi mã đơn hàng vào phần lời nhắn. Đơn được kích hoạt sau khi quản trị viên đối chiếu.',
        0, 20)`,
  );
}
