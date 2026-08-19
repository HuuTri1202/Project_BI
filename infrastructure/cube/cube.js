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

/**
 * Dung sai lệch đồng hồ giữa máy ký token và container này, tính bằng giây.
 *
 * ─── Vì sao 30 giây là SAI, và sai theo kiểu khó tìm ───────────────────────
 *
 * Con số cũ (30s) được chọn theo giả định "hai tiến trình trên cùng một máy chỉ
 * dao động vài giây". Giả định đó không đúng với cách dự án này chạy: Express
 * dùng đồng hồ **Windows**, còn Cube dùng đồng hồ **máy ảo Docker** — hai đồng
 * hồ độc lập, và chúng trôi xa nhau mỗi lần máy ngủ hoặc ngủ đông. Lệch vài
 * phút là chuyện thường, không phải sự cố.
 *
 * Hậu quả của dung sai quá chặt không phải "kém an toàn hơn một chút" mà là
 * **Explorer chết hoàn toàn**: token vừa ký đã hết hạn khi tới nơi, mọi truy vấn
 * hỏng, kể cả truy vấn trong đúng một bảng.
 *
 * ─── Vì sao nới ra KHÔNG phải là hạ tiêu chuẩn an toàn ─────────────────────
 *
 * Token này không bao giờ tới trình duyệt. Trình duyệt gọi `POST /api/v1/query`
 * của Express; Express mới ký token rồi tự gọi Cube trong mạng Docker nội bộ.
 * Cửa sổ phơi nhiễm của nó là đúng một lời gọi HTTP giữa hai tiến trình của
 * chính ta — nên chênh lệch giữa 60 giây và 360 giây gần như không đổi gì về
 * rủi ro, trong khi nó là khác biệt giữa "dùng được" và "không dùng được".
 *
 * `clockTolerance` là đúng cái núm vặn sinh ra cho việc này; 5 phút cũng là mức
 * các thư viện OIDC khuyến nghị. Đặt qua biến môi trường để môi trường có đồng
 * hồ đồng bộ đàng hoàng vẫn siết lại được.
 *
 * ⚠️ Nới dung sai là để hệ thống KHÔNG SỤP khi đồng hồ lệch — nó không sửa cái
 * đồng hồ. Máy lệch giờ vẫn ghi sai dấu thời gian ở chỗ khác, nên thông báo lỗi
 * bên dưới vẫn chỉ đúng lệnh `w32tm /resync`.
 */
const CLOCK_TOLERANCE = Number(process.env.CUBEJS_CLOCK_TOLERANCE || 300);

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

    let payload;
    try {
      // Xem `CLOCK_TOLERANCE` ở đầu file: dung sai này là tham số MÔI TRƯỜNG
      // (hai đồng hồ lệch nhau bao nhiêu), không phải tham số an toàn (token
      // sống bao lâu). Gộp hai thứ đó vào một con số là gốc của lỗi cũ.
      payload = jwt.verify(token, process.env.CUBEJS_API_SECRET, {
        clockTolerance: CLOCK_TOLERANCE,
      });
    } catch (err) {
      /*
       * ⚠️ ĐỒNG HỒ LỆCH — cái bẫy đã cắn một lần và mất rất lâu để tìm ra.
       *
       * Express ký token với hạn 60 giây. Nếu đồng hồ của container đi trước
       * đồng hồ máy ký quá 60 giây thì token vừa ký đã "hết hạn" ngay khi tới
       * nơi, và MỌI truy vấn Explorer đều hỏng — kể cả truy vấn trong đúng một
       * bảng, tức là không dính dáng gì tới quan hệ giữa các bảng.
       *
       * Lần gặp thật: máy Windows chưa từng đồng bộ giờ (`w32tm /query /status`
       * báo `Source: Local CMOS Clock`, `not synchronized`) nên chạy chậm hơn
       * giờ thật 2 phút, trong khi container thì đúng giờ.
       *
       * Triệu chứng không hề giống nguyên nhân: `checkAuth` ném lỗi nên gateway
       * của Cube trả 500 (không phải 401), Express dịch 5xx thành "Tầng ngữ
       * nghĩa không trả lời được truy vấn này", và người dùng đi tìm lỗi ở tab
       * Quan hệ suốt buổi. Vì vậy chỗ này phải GỌI TÊN nguyên nhân.
       */
      if (err && err.name === 'TokenExpiredError') {
        const skew = Math.round((Date.now() - err.expiredAt.getTime()) / 1000);
        throw new Error(
          `Token của Express đã hết hạn ${skew}s theo đồng hồ của container này, VƯỢT cả dung ` +
            `sai ${CLOCK_TOLERANCE}s. Gần như chắc chắn là ĐỒNG HỒ LỆCH chứ không phải token ` +
            'cũ — token được ký ngay trước lời gọi này. So bằng: date -u trên máy thật và ' +
            'docker exec bi-cube date -u. Nếu máy Windows chậm giờ, mở PowerShell quyền ' +
            'quản trị rồi chạy: w32tm /resync',
        );
      }
      // Sai chữ ký = `CUBEJS_API_SECRET` lệch giữa backend/.env và
      // infrastructure/.env. Nói thẳng, đừng để nó lẫn vào lỗi chung.
      if (err && err.name === 'JsonWebTokenError') {
        throw new Error(
          'Chữ ký token không hợp lệ — CUBEJS_API_SECRET trong backend/.env phải TRÙNG ' +
            'giá trị cùng tên trong infrastructure/.env.',
        );
      }
      throw err;
    }

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
