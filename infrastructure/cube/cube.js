const fs = require('node:fs/promises');
const path = require('node:path');
const jwt = require('jsonwebtoken');

/**
 * Cấu hình gốc của Cube.js — §10.
 *
 * ⚠️ FILE NÀY THUỘC DEV A (xem bảng phân công trong README). Bản này do phần
 * §10 viết và cần Dev A duyệt trước khi vào `main`. Bù lại,
 * `docker-compose.yml` KHÔNG phải sửa một dòng nào: mount `./cube:/cube/conf`,
 * `CUBEJS_API_SECRET` và cổng 4100 đều đã có sẵn từ tuần 1.
 *
 * ═══ Cube KHÔNG BAO GIỜ lộ ra trình duyệt ═══════════════════════════════════
 *
 * Mọi truy vấn phân tích đi qua `POST /api/v1/query` của Express: Express kiểm
 * quyền, ký một JWT ngắn hạn mang `securityContext`, rồi mới chuyển tiếp. Luật
 * này ghi trong README từ đầu và nó không phải hình thức — ClickHouse chỉ có
 * MỘT `bi_user` nhìn thấy bảng của MỌI tổ chức. Cách ly hoàn toàn nằm ở tầng
 * ứng dụng.
 *
 * ─── Ba lớp chặn rò dữ liệu chéo tổ chức ────────────────────────────────────
 *
 * Không lớp nào đủ một mình, và mỗi lớp bắt một loại lỗi khác nhau:
 *
 *   1. Express dựng tên cube.  Trình duyệt chỉ gửi ID của dòng trong MySQL của
 *      ta; Express tra id trong phạm vi mô hình đã lọc theo tổ chức rồi TỰ dựng
 *      chuỗi `dm12_ds77.d341`. Đây là lớp chặn CHÍNH, và nó bắt mọi trường hợp
 *      trong lúc mọi thứ chạy đúng.
 *   2. `checkAuth` đòi `tenantId`.  Bắt lỗi CỦA CHÍNH TA — một nhánh code tương
 *      lai quên đặt `tenantId` vào token. Đó là tình huống dễ xảy ra hơn hẳn
 *      một token bị giả mạo, và là đúng thứ ghi chú §9 trong README cảnh báo.
 *   3. `repositoryFactory` theo tổ chức.  Bắt một lỗi ở lớp 1. Cube của tổ chức
 *      khác KHÔNG TỒN TẠI trong ngữ cảnh đã biên dịch, nên truy vấn gọi tên nó
 *      hỏng ở trình biên dịch chứ không phải chỉ bị Express từ chối.
 *
 * ⚠️ `queryRewrite` KHÔNG dùng để lọc tổ chức, và đó là kết luận sau khi kiểm
 * chứ không phải bỏ sót. `queryRewrite` lọc DÒNG; các tổ chức ở đây tách nhau
 * theo BẢNG (`raw_t1_d77` với `raw_t2_d88`), và bảng `raw_*` không có cột
 * `tenant_id` nào để mà lọc. Thêm một bộ lọc tổ chức vào đó sẽ hoặc báo lỗi
 * "member not found", hoặc tệ hơn là im lặng không làm gì — một lớp bảo vệ giả.
 * Đừng thêm.
 */

/** Khớp `CUBE_SCHEMA_DIR` của Express qua mount `./cube:/cube/conf`. */
const SCHEMA_ROOT = '/cube/conf/model/tenants';

/**
 * Trần số dòng cho mọi truy vấn.
 *
 * Không phải bảo mật — là chuyện vận hành: một truy vấn không LIMIT trên bảng
 * triệu dòng sẽ kéo cả bảng qua HTTP về Express rồi về trình duyệt.
 */
const MAX_ROWS = 5000;

module.exports = {
  /**
   * Xác thực JWT ngắn hạn do Express ký.
   *
   * Ném khi thiếu `tenantId` thay vì rơi về một giá trị mặc định: một mặc định
   * ở đây nghĩa là lỗi hiện ra dưới dạng "tổ chức A nhìn thấy doanh thu của tổ
   * chức B", còn ném thì nó hiện ra dưới dạng một endpoint trả 403. Chỉ một
   * trong hai là thứ phát hiện được.
   */
  checkAuth: (req, auth) => {
    const raw = auth || req.headers.authorization || '';
    const token = String(raw).replace(/^Bearer\s+/i, '');
    const payload = jwt.verify(token, process.env.CUBEJS_API_SECRET);

    if (!Number.isInteger(payload.tenantId) || payload.tenantId <= 0) {
      throw new Error(
        'securityContext thiếu tenantId — từ chối để không lộ dữ liệu của tổ chức khác',
      );
    }

    req.securityContext = payload;
  },

  /**
   * Mỗi tổ chức một ngữ cảnh biên dịch riêng.
   *
   * Đây là thứ khiến lớp chặn thứ 3 có thật: cube của tổ chức khác không nằm
   * trong ngữ cảnh này nên nó KHÔNG TỒN TẠI, chứ không phải "tồn tại nhưng bị
   * cấm".
   */
  contextToAppId: ({ securityContext }) => `t${securityContext.tenantId}`,
  contextToOrchestratorId: ({ securityContext }) => `t${securityContext.tenantId}`,

  /**
   * Phiên bản schema lấy từ JWT, KHÔNG dò thời gian sửa file.
   *
   * Cube nhớ schema đã biên dịch theo cặp (tổ chức, phiên bản). Express tính
   * `MAX(updated_at)` của mọi mô hình còn sống rồi ký vào token, nên truy vấn
   * đầu tiên sau BẤT KỲ thay đổi nào cũng buộc biên dịch lại — một cách xác
   * định.
   *
   * Vì sao không trông vào bộ theo dõi file của Cube: thư mục này là một bind
   * mount trên Windows, và sự kiện thay đổi file qua đó không đáng tin. Đó đúng
   * là loại thứ chạy được trên máy người viết mà không chạy trên máy người
   * review.
   */
  schemaVersion: ({ securityContext }) => String(securityContext.schemaVersion ?? '0'),

  /**
   * Đọc file schema của ĐÚNG tổ chức đang hỏi.
   *
   * Tự viết thay vì dùng `FileRepository` của `@cubejs-backend/server-core`:
   * hợp đồng `dataSchemaFiles()` trả `{fileName, content}[]` là phần ổn định,
   * còn cách `FileRepository` phân giải đường dẫn tương đối phụ thuộc vào thư
   * mục làm việc của image và vào nội bộ vốn đổi giữa các phiên bản Cube.
   *
   * Thư mục không tồn tại -> trả mảng rỗng, không ném: một tổ chức chưa dựng mô
   * hình nào là chuyện bình thường.
   */
  repositoryFactory: ({ securityContext }) => ({
    dataSchemaFiles: async () => {
      const dir = path.join(SCHEMA_ROOT, String(securityContext.tenantId));

      let names;
      try {
        names = await fs.readdir(dir);
      } catch {
        return [];
      }

      return Promise.all(
        names
          .filter((name) => name.endsWith('.js'))
          .map(async (fileName) => ({
            fileName,
            content: await fs.readFile(path.join(dir, fileName), 'utf8'),
          })),
      );
    },
  }),

  /**
   * Chỗ dành cho Row-level Security (tab 9, hiện để "sắp có").
   *
   * Hiện chỉ chặn trần số dòng. Khi có RLS thật, bộ lọc theo `securityContext`
   * sẽ chèn ở ĐÂY — và đó mới là công dụng đúng của `queryRewrite`: lọc dòng
   * bên trong một bảng mà người gọi vốn đã có quyền chạm tới.
   */
  queryRewrite: (query) => {
    query.limit = Math.min(query.limit ?? MAX_ROWS, MAX_ROWS);
    return query;
  },
};
