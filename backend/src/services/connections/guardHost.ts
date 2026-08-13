import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { allowPrivateDbHosts } from '../../config/env';
import { HttpError } from '../../utils/httpError';

/**
 * Chặn SSRF cho các endpoint kết nối tới CSDL của khách hàng.
 *
 * ─── Vì sao lớp này tồn tại ─────────────────────────────────────────────────
 *
 * `POST /v1/connections/test` nhận `host` và `port` DO NGƯỜI DÙNG KHAI rồi bắt
 * chính server đi mở kết nối. Đó đúng là định nghĩa của Server-Side Request
 * Forgery, và nó nguy hiểm hơn vẻ ngoài:
 *
 *   - `169.254.169.254` là endpoint metadata của AWS/GCP/Azure. Trên máy ảo
 *     cloud, nó phát ra credential của chính instance đó.
 *   - `127.0.0.1:6379` là Redis của hệ thống này. `127.0.0.1:3306` là MySQL
 *     chứa toàn bộ dữ liệu của MỌI tổ chức.
 *   - Bất kỳ IP nội bộ nào cũng thành mục tiêu quét cổng, với server của ta làm
 *     bàn đạp — và log của nạn nhân sẽ ghi IP của ta, không phải của kẻ tấn công.
 *
 * Người gọi được endpoint này chỉ cần là admin của MỘT tổ chức bất kỳ, mà ai
 * cũng tự đăng ký thành admin của tổ chức mình được. Nên đây là bề mặt tấn công
 * mở cho bất kỳ ai có email.
 *
 * ─── Vì sao phải TRẢ VỀ IP, không chỉ trả true/false ────────────────────────
 *
 * Kiểm tên miền rồi đưa NGUYÊN TÊN cho driver là để hở một khe: giữa lần ta
 * phân giải và lần driver tự phân giải, bản ghi DNS có thể đổi sang IP nội bộ
 * (DNS rebinding). Hàm này trả về IP đã kiểm để nơi gọi kết nối tới ĐÚNG địa chỉ
 * đó, khép hẳn khe thời gian ấy.
 *
 * ⚠️ Giới hạn còn lại, ghi ra chứ không giấu: một tên miền có nhiều bản ghi A
 * vẫn có thể đưa ta tới IP khác nếu driver tự phân giải lại vì lý do nào đó
 * (chuyển hướng ở tầng giao thức chẳng hạn). Khép kín tuyệt đối cần tự quản
 * socket — nằm ngoài phạm vi mục này và đã ghi vào phần nợ kỹ thuật.
 */

/** Dải IPv4 bị chặn, dạng [địa chỉ mạng, số bit prefix, lý do]. */
const BLOCKED_V4: [string, number, string][] = [
  ['0.0.0.0', 8, 'địa chỉ không xác định'],
  ['10.0.0.0', 8, 'mạng nội bộ'],
  ['100.64.0.0', 10, 'mạng dùng chung của nhà mạng'],
  ['127.0.0.0', 8, 'loopback — chính máy chủ này'],
  ['169.254.0.0', 16, 'link-local — nơi cloud phát credential của máy ảo'],
  ['172.16.0.0', 12, 'mạng nội bộ'],
  ['192.0.0.0', 24, 'dải dành riêng của IETF'],
  ['192.168.0.0', 16, 'mạng nội bộ'],
  ['198.18.0.0', 15, 'dải đo hiệu năng'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'dải dự trữ'],
];

export interface ResolvedHost {
  /** IP đã qua kiểm tra. Truyền CHÍNH nó cho driver, không truyền lại hostname. */
  address: string;
  family: 4 | 6;
}

/**
 * Phân giải và kiểm tra một host trước khi mở kết nối.
 *
 * Ném `HttpError` 400 kèm lý do đọc được — người dùng gõ nhầm tên miền cần biết
 * đó là lỗi tên miền, không phải "kết nối thất bại" chung chung.
 */
export async function resolveAndGuardHost(host: string): Promise<ResolvedHost> {
  const trimmed = host.trim();
  if (!trimmed) {
    throw badHost('Chưa nhập địa chỉ máy chủ.');
  }

  const address = await resolveHost(trimmed);

  // Cờ được kiểm SAU khi phân giải, không phải trước: kể cả khi cho phép host
  // nội bộ, một tên miền không phân giải được vẫn phải báo đúng lỗi đó.
  if (allowPrivateDbHosts) return address;

  const reason = blockedReason(address);
  if (reason) {
    throw badHost(
      `Không cho phép kết nối tới ${address.address} (${reason}). ` +
        'Chỉ dùng được địa chỉ công khai.',
    );
  }

  return address;
}

async function resolveHost(host: string): Promise<ResolvedHost> {
  // Đã là IP thì khỏi hỏi DNS. `isIP` trả 0 / 4 / 6.
  const literal = isIP(host);
  if (literal !== 0) {
    return { address: host, family: literal as 4 | 6 };
  }

  try {
    const result = await lookup(host);
    return { address: result.address, family: result.family as 4 | 6 };
  } catch {
    // Không kèm lỗi gốc của Node (`ENOTFOUND`, `EAI_AGAIN`…): nó không nói thêm
    // được gì cho người đang gõ tên miền vào một cái form.
    throw badHost(`Không phân giải được tên miền '${host}'. Kiểm tra lại địa chỉ máy chủ.`);
  }
}

/** `null` nghĩa là địa chỉ đi được. Chuỗi trả về là lý do bị chặn, tiếng Việt. */
function blockedReason(host: ResolvedHost): string | null {
  if (host.family === 6) return blockedReasonV6(host.address);

  const ip = toUint32(host.address);
  if (ip === null) return 'địa chỉ không hợp lệ';

  for (const [network, bits, reason] of BLOCKED_V4) {
    const base = toUint32(network);
    if (base === null) continue;
    // Dịch phải `32 - bits` để so phần prefix. Dùng `>>>` chứ không `>>`: dịch
    // có dấu sẽ làm hỏng mọi địa chỉ có octet đầu >= 128.
    const shift = 32 - bits;
    if (shift === 0 ? ip === base : ip >>> shift === base >>> shift) return reason;
  }
  return null;
}

/**
 * IPv6 xử lý bằng tiền tố chuỗi, không bằng số học.
 *
 * IPv6 là 128 bit nên không nhét vừa số nguyên của JavaScript, mà kéo `BigInt`
 * vào chỉ để chặn bốn dải thì đắt hơn giá trị nó mang lại. Bốn dải dưới đây có
 * dạng chuẩn tắc cố định nên so tiền tố là đủ và đọc ra ngay được.
 */
function blockedReasonV6(address: string): string | null {
  const ip = address.toLowerCase().split('%')[0] ?? '';

  if (ip === '::1') return 'loopback — chính máy chủ này';
  if (ip === '::') return 'địa chỉ không xác định';
  if (ip.startsWith('fe80:')) return 'link-local';
  if (ip.startsWith('fc') || ip.startsWith('fd')) return 'mạng nội bộ';
  if (ip.startsWith('ff')) return 'multicast';

  // ::ffff:a.b.c.d — IPv4 khoác áo IPv6. Bỏ qua nhánh này là để hở đúng cái cửa
  // vừa đóng: `::ffff:127.0.0.1` sẽ đi thẳng tới loopback.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped?.[1]) return blockedReason({ address: mapped[1], family: 4 });

  return null;
}

function toUint32(ipv4: string): number | null {
  const parts = ipv4.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}

function badHost(message: string): HttpError {
  return new HttpError(400, 'InvalidHost', message, { host: message });
}
