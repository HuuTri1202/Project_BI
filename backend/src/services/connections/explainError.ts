import type { ConnectionKind } from './drivers';

/**
 * Dịch lỗi của hai thư viện CSDL sang một câu tiếng Việt nói được PHẢI SỬA GÌ.
 *
 * ─── Vì sao không ném thẳng lỗi gốc ra giao diện ────────────────────────────
 *
 * Người đang đứng ở bước 3 của wizard là quản trị viên của một công ty, không
 * phải lập trình viên. `ER_ACCESS_DENIED_ERROR: Access denied for user 'bi'@
 * '10.2.0.7' (using password: YES)` không giúp họ, mà còn tiện thể để lộ IP nội
 * bộ của hệ thống ta.
 *
 * Chuỗi trả về của hàm này đi thẳng ra màn hình, nên nó KHÔNG được chứa: tên
 * host nội bộ, đường dẫn file, hay stack trace.
 *
 * ─── Khớp theo MÃ lỗi, không theo lời văn ───────────────────────────────────
 *
 * `code` và `errno` ổn định giữa các phiên bản thư viện; `message` thì đổi theo
 * phiên bản và theo ngôn ngữ của máy chủ. Chỉ dùng `message` cho ClickHouse, vì
 * client của nó trả lỗi HTTP kèm mã lỗi nằm trong thân chuỗi.
 *
 * ─── Vì sao hàm này cần biết `useSsl` ───────────────────────────────────────
 *
 * Nhóm lỗi tốn thời gian nhất của cả mục là "nhầm lớp giao vận", và triệu chứng
 * của hai chiều nhầm gần như giống hệt nhau: socket đứt ngang, không có mã lỗi
 * nào của CSDL. Nhưng CÁCH SỬA thì ngược nhau hoàn toàn — một bên phải bật SSL,
 * bên kia phải tắt. Không biết cờ hiện tại thì câu duy nhất viết được là "kiểm
 * tra lại cấu hình SSL", tức là đẩy việc đoán về phía người dùng.
 */

const FALLBACK = 'Không kết nối được. Kiểm tra lại địa chỉ, cổng và thông tin đăng nhập.';

export function explainConnectionError(
  err: unknown,
  kind: ConnectionKind,
  useSsl = false,
): string {
  const code = readCode(err);
  const message = err instanceof Error ? err.message : String(err);

  const tls = explainTls(code, message, useSsl);
  if (tls) return tls;

  // --- Lỗi tầng mạng của Node, chung cho mọi driver ---
  switch (code) {
    case 'ECONNREFUSED':
      return 'Máy chủ từ chối kết nối. Kiểm tra cổng có đúng không và CSDL có đang chạy không.';
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return 'Hết thời gian chờ. Nhiều khả năng tường lửa đang chặn — thêm IP hệ thống ở bước 1 vào danh sách cho phép.';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Không tìm thấy máy chủ. Kiểm tra lại địa chỉ.';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'Không có đường tới máy chủ. Kiểm tra địa chỉ và cấu hình mạng.';
  }

  if (kind === 'mysql') return explainMysql(code) ?? FALLBACK;
  return explainClickhouse(message) ?? FALLBACK;
}

/**
 * Nhóm lỗi TLS — đặt TRƯỚC nhóm mạng vì nó cướp mã của nhóm kia.
 *
 * Gửi HTTP thô vào một cổng chỉ nói TLS thì máy chủ đóng socket, và Node báo
 * `ECONNRESET` — cùng mã với "mất mạng giữa chừng". Nếu để nhóm mạng bắt trước
 * thì người dùng ClickHouse Cloud nhận câu "máy chủ đóng kết nối giữa chừng" và
 * đi kiểm tra đường truyền, trong khi việc cần làm là tick một ô.
 */
function explainTls(code: string | null, message: string, useSsl: boolean): string | null {
  const m = message.toLowerCase();

  // --- Bật SSL nhưng đầu bên kia nói HTTP/giao thức thô ---
  if (
    code === 'ERR_SSL_WRONG_VERSION_NUMBER' ||
    code === 'EPROTO' ||
    m.includes('wrong version number')
  ) {
    return useSsl
      ? 'Cổng này không dùng SSL. Bỏ tick "Dùng SSL/TLS", hoặc đổi sang cổng SSL của máy chủ.'
      : 'Không thoả thuận được giao thức với máy chủ. Kiểm tra lại cổng.';
  }

  // --- Chưa bật SSL nhưng đầu bên kia đòi TLS ---
  if (code === 'ECONNRESET' || m.includes('socket hang up')) {
    return useSsl
      ? 'Máy chủ đóng kết nối giữa chừng. Thử lại; nếu vẫn lỗi thì kiểm tra giới hạn kết nối phía máy chủ.'
      : 'Máy chủ đóng kết nối ngay khi vừa mở. Gần như chắc chắn CSDL này yêu cầu SSL — tick "Dùng SSL/TLS" rồi thử lại.';
  }

  // --- Bắt tay TLS chạy được nhưng chứng chỉ không qua ---
  switch (code) {
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'Chứng chỉ của máy chủ không khớp với địa chỉ đã nhập. Dùng đúng tên miền ghi trên chứng chỉ thay vì địa chỉ IP.';
    case 'CERT_HAS_EXPIRED':
      return 'Chứng chỉ SSL của máy chủ đã hết hạn. Phía quản trị CSDL cần gia hạn chứng chỉ.';
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return 'Chứng chỉ SSL của máy chủ tự ký nên không xác minh được. Hệ thống chỉ chấp nhận chứng chỉ do một tổ chức phát hành công khai cấp.';
  }

  return null;
}

function explainMysql(code: string | null): string | null {
  switch (code) {
    case 'ER_ACCESS_DENIED_ERROR':
    case 'ER_DBACCESS_DENIED_ERROR':
      return 'Sai tên đăng nhập hoặc mật khẩu, hoặc tài khoản không được phép truy cập từ địa chỉ này.';
    case 'ER_BAD_DB_ERROR':
      return 'Database không tồn tại. Kiểm tra lại tên database.';
    case 'ER_HOST_NOT_PRIVILEGED':
      return 'Máy chủ MySQL không cho phép kết nối từ IP của hệ thống. Cấp quyền cho IP ở bước 1.';
    case 'ER_TABLEACCESS_DENIED_ERROR':
      return 'Tài khoản thiếu quyền SELECT trên bảng cần đọc.';
    case 'PROTOCOL_CONNECTION_LOST':
      return 'Mất kết nối giữa chừng. Thử lại; nếu vẫn lỗi thì kiểm tra giới hạn kết nối của máy chủ.';
    default:
      return null;
  }
}

/**
 * ClickHouse trả lỗi qua HTTP nên không có `code` như hai loại kia — mã lỗi nằm
 * trong thân thông báo dưới dạng `Code: 516. DB::Exception: ...`.
 */
function explainClickhouse(message: string): string | null {
  const m = message.toLowerCase();

  if (m.includes('code: 516') || m.includes('authentication failed')) {
    return 'Sai tên đăng nhập hoặc mật khẩu.';
  }
  if (m.includes('code: 81') || m.includes('unknown database')) {
    return 'Database không tồn tại. Kiểm tra lại tên database.';
  }
  if (m.includes('code: 497') || m.includes('not enough privileges')) {
    return 'Tài khoản thiếu quyền. Cần SELECT trên bảng và quyền đọc system.tables.';
  }
  if (m.includes('code: 192') || m.includes('unknown user')) {
    return 'Tài khoản không tồn tại trên máy chủ ClickHouse.';
  }
  if (m.includes('timeout')) {
    return 'Hết thời gian chờ. Nhiều khả năng tường lửa đang chặn cổng của ClickHouse.';
  }
  // ClickHouse Cloud trả 404 kèm trang HTML khi gọi HTTP thô vào cổng HTTPS ở
  // một số cấu hình proxy — không rơi vào nhánh ECONNRESET ở trên.
  if (m.includes('unexpected token') || m.includes('<!doctype')) {
    return 'Máy chủ trả về nội dung không phải của ClickHouse. Kiểm tra lại cổng và ô "Dùng SSL/TLS".';
  }
  return null;
}

/**
 * Đọc mã lỗi từ cả hai quy ước.
 *
 * `mysql2` đặt ở `code` (chuỗi như 'ER_ACCESS_DENIED_ERROR') và Node cũng đặt ở
 * `code` (chuỗi như 'ECONNREFUSED') — may mắn là chúng dùng chung một tên thuộc
 * tính, kể cả với nhóm mã của OpenSSL.
 */
function readCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
