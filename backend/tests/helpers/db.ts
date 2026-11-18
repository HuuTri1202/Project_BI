import { mysqlPool } from '../../src/config/mysql';
import { redis } from '../../src/config/redis';
import { memoryStorage } from '../../src/storage/memoryStorage';

/**
 * Dọn sạch database test trước mỗi ca.
 *
 * Tắt kiểm tra khoá ngoại để không phải xoá đúng thứ tự phụ thuộc — CHỈ làm
 * được vì đây là database dùng riêng cho test (`bi_platform_test`), không bao
 * giờ chạy trên dữ liệu thật.
 *
 * ─── Vì sao DELETE chứ KHÔNG phải TRUNCATE — và đây là chuyện đo được ───────
 *
 * Bản trước TRUNCATE 20 bảng đầu rồi DELETE 9 bảng còn lại. Hậu quả không phải
 * "hơi chậm" mà là ĐỎ NGẪU NHIÊN: hook `beforeEach` vượt trần 10 giây của
 * vitest, và mỗi lần chạy lại một bài KHÁC đỏ — ở `admin`, rồi `tenant`, rồi
 * `datamodel` — với thông báo chẳng nói gì về nguyên nhân. Một lần chạy đo được
 * 20 ca đỏ mà trong cả tệp log KHÔNG có một `AssertionError` nào: cả 20 đều là
 * hệ quả của đúng hai hook timeout.
 *
 * Đo trên chính máy này, 10 vòng mỗi bảng, đúng 29 bảng dưới đây:
 *
 *     TRUNCATE   tổng 1447ms
 *     DELETE     tổng   31ms
 *
 * Và đo TẠI CHỖ trong `admin.integration.test.ts`, 114 lượt reset thật:
 *
 *     khối TRUNCATE (20 bảng)   trung bình 941ms   max 1681ms
 *     khối DELETE   ( 9 bảng)   trung bình  21ms   max   37ms
 *     cả hàm                    trung bình 978ms   max 1730ms
 *
 * Tức 96% thời gian dọn nằm ở TRUNCATE. Lý do: TRUNCATE của InnoDB là DDL — nó
 * xoá rồi dựng lại tablespace trên đĩa, và trên Docker chạy Windows thì mỗi lần
 * như vậy là một vòng ra hệ thống file thật. Khi đĩa host đứng một nhịp, 941ms
 * thành hơn 10 giây và hook chết. DELETE trên bảng gần như rỗng chỉ là một lần
 * quét chỉ mục, nên trần 10 giây còn dư hai bậc độ lớn — đỏ ngẫu nhiên không
 * phải được nén lại, nó hết chỗ để xảy ra.
 *
 * Cái TRUNCATE cho mà DELETE không cho là đặt lại AUTO_INCREMENT. Không bài nào
 * trong suite cần: mọi id thật đều lấy từ bộ cố định hoặc từ body phản hồi, và
 * mọi `toBe(1)` trong suite là một con ĐẾM chứ không phải một id. Ngược lại,
 * AUTO_INCREMENT KHÔNG đặt lại còn xoá hẳn một cái bẫy — xem đoạn Redis ở cuối
 * hàm.
 *
 * ⚠️ Thứ tự CON -> CHA dưới đây được kiểm bằng `information_schema` chứ không
 * đọc bằng mắt: đúng cho 28/29 bảng, và chỗ còn lại là một VÒNG thật —
 * `datamodel_columns` trỏ vào `datamodel_datasets` (`fk_dmc_dataset`) còn
 * `datamodel_datasets` trỏ ngược lại (`fk_dmd_primary_column`, migration 12).
 * Không thứ tự thẳng nào thoả được vòng đó. Đó mới là lý do
 * `SET FOREIGN_KEY_CHECKS = 0` là BẮT BUỘC, không phải cho tiện tay.
 */
export async function resetDatabase(): Promise<void> {
  await mysqlPool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of [
    'reports',
    // Thư mục báo cáo — migration 37. Sau `reports` (khoá ngoại SET NULL): bỏ
    // sót nó thì thư mục của ca trước nằm lại, và ca sau đếm ra một con số nó
    // không tạo ra — hoặc đâm vào UNIQUE khi đặt lại đúng cái tên đó.
    'report_folders',
    // §10 — tầng ngữ nghĩa. Quan hệ trỏ vào cột, cột trỏ vào thành phần, thành
    // phần trỏ vào cả mô hình lẫn bộ dữ liệu — nên khối này phải nằm trước
    // `datasets`. Hai dòng giữa là cái vòng đã nói ở trên.
    'datamodel_relationships',
    'datamodel_measures',
    'datamodel_columns',
    'datamodel_datasets',
    'datamodels',
    // Sổ ghi chép của §9. `dataset_load_errors` trỏ vào `dataset_load_runs`, nên
    // nó phải đứng trước — dữ liệu THẬT của §9 nằm bên ClickHouse, không có gì
    // để dọn ở đây.
    'dataset_load_errors',
    'dataset_load_runs',
    // MỘT bộ `datasets` cho cả hai nguồn — file tải lên (§7) và bảng đồng bộ từ
    // CSDL khách hàng (§8). `dataset_rows` chỉ nguồn `file` dùng tới.
    'dataset_rows',
    'dataset_columns',
    'datasets',
    // Thư mục bộ dữ liệu — migration 39. SAU `datasets` (khoá ngoại SET NULL),
    // cùng lý do với `report_folders` ở trên.
    'dataset_folders',
    'connections',
    // Ai vào được workspace nào — migration 40. TRƯỚC 'workspaces' theo khoá
    // ngoại CASCADE; để lại thì ca sau thấy quyền của ca trước.
    'workspace_members',
    'workspaces',
    'memberships',
    // Vé đặt lại mật khẩu — migration 36, vé xác minh email — migration 42,
    // danh tính Google — migration 41. Cả ba là CON của `users`.
    'password_reset_tokens',
    'email_verification_tokens',
    'user_identities',
    // Hai bảng này KHÔNG có khoá ngoại nào (cố ý — xem migration 30), nên vị
    // trí tự do; đặt ở đây cho khớp cách đọc "con trước".
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
    /*
     * ⚠️ `tenants` rồi `users` ở CUỐI, và thứ tự đó do khoá ngoại quyết định
     * chứ không do trực giác "công ty là gốc".
     *
     * `tenants` là CON của `users` (`fk_tenants_owner` — chủ sở hữu công ty), và
     * ba bảng thanh toán ở trên trỏ vào `users` bằng ON DELETE **RESTRICT**
     * (`fk_payment_txn_confirmer`, `fk_subscriptions_granter`). Nên `users` phải
     * là bảng cuối cùng: dọn nó sớm là tự đâm vào RESTRICT ngay khi ai đó bỏ
     * dòng `SET FOREIGN_KEY_CHECKS = 0` đi.
     */
    'tenants',
    'users',
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
  //   dataset:analyze:*  cache kết quả phân tích file, khoá theo id. Hồi còn
  //                      TRUNCATE, AUTO_INCREMENT về 1 làm bộ dữ liệu số 1 của
  //                      ca này TRÙNG khoá với số 1 của ca trước — ca này thấy
  //                      schema của một file nó chưa từng tải lên, và đó là kiểu
  //                      đỏ tệ nhất vì nó XANH nhầm. DELETE không đặt lại
  //                      AUTO_INCREMENT nên id không bao giờ lặp và cái bẫy đó
  //                      hết tồn tại; vẫn dọn, vì cache của ca này rò sang ca
  //                      sau là một đường xanh-nhầm khác, và `keys` đo được 2ms.
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
