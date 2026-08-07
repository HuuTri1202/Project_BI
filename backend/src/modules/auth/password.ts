import bcrypt from 'bcrypt';

import { env } from '../../config/env';

/**
 * Bọc bcrypt. Chỗ duy nhất trong repo được phép chạm tới thư viện băm.
 *
 * Dùng gói `bcrypt` (native) chứ không phải `bcryptjs`: `bcryptjs` là JS thuần
 * và chặn event loop suốt thời gian băm, kể cả khi gọi qua API "async" của nó —
 * với một API đơn tiến trình thì đó là điều không chấp nhận được.
 *
 * Binding native chạy trên threadpool của libuv (UV_THREADPOOL_SIZE, mặc định 4),
 * nên nhiều lượt đăng ký đồng thời sẽ tranh chỗ với công việc fs và DNS. Ở quy
 * mô hiện tại thì không sao, nhưng đừng ngạc nhiên khi thấy nó về sau.
 *
 * Nếu máy nào đó không có sẵn bản dựng cho phiên bản Node của mình, `npm install`
 * sẽ đòi node-gyp và Visual Studio Build Tools. Phương án thay thế cho riêng máy
 * đó: `@node-rs/bcrypt` (Rust/napi, có sẵn bản dựng, thay thẳng được). Định dạng
 * hash giống hệt nhau nên trộn hai thư viện vẫn an toàn.
 */

/**
 * Hash của một mật khẩu không ai biết, dùng cho nhánh "email không tồn tại" lúc
 * đăng nhập. Cố định trong mã nguồn để không phải băm lại mỗi lần khởi động.
 * Cost 12 để khớp thời gian với hash thật.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.9Xa/ZjyLPzOoNMlbUE0Ie6xqvBTvKGO';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Đốt đúng lượng thời gian mà một lần so mật khẩu thật tiêu tốn.
 *
 * Nói thẳng nó mua được gì: san bằng thành phần ~300ms của bcrypt, để endpoint
 * đăng nhập không trả lời "email này có tồn tại không" bằng 5ms so với 305ms.
 * Nó KHÔNG san bằng thời gian truy vấn database hay serialize JSON, và trong
 * Node thì cân bằng tuyệt đối là bất khả thi.
 *
 * Quan trọng hơn: endpoint ĐĂNG KÝ với mã 409 mới là kênh liệt kê email ồn ào
 * nhất, và không tránh được nếu vẫn muốn UX dùng được. Bù bằng rate limit
 * (middleware/rateLimit.ts) chứ đừng giả vờ là đã kín.
 */
export async function burnPasswordCompareTime(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}
