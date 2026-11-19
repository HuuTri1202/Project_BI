import { describe, expect, it } from 'vitest';

import { blockedReason } from '../src/services/connections/guardHost';

/**
 * Chốt chặn SSRF — luật "địa chỉ nào KHÔNG được mở kết nối tới".
 *
 * ═══ Vì sao bài test này phải tồn tại, và vì sao nó ở tầng đơn vị ═══════════
 *
 * `datasets.integration.test.ts` đã ghi thẳng: "ở đây chỉ kiểm được nhánh định
 * dạng host sai — nhánh chặn IP nội bộ phải thử tay với cờ tắt. Ghi ra chứ
 * không giấu: đây là lỗ hổng che phủ thật của bộ test."
 *
 * Không kiểm được qua HTTP vì `allowPrivateDbHosts` mặc định BẬT ở mọi môi
 * trường không phải production — và chính bộ test tích hợp dựa vào đó để nối
 * tới MySQL trên localhost. Nên `resolveAndGuardHost` trả về sớm, không bao giờ
 * tới `blockedReason`.
 *
 * Hai ca AT-06/AT-07 của bộ kiểm thử tay cũng không lấp được chỗ này: chúng
 * chạy vào API thật của máy dev, nơi cờ đang bật. Việc của chúng là nói ra sự
 * thật về MÔI TRƯỜNG; việc của tệp này là chứng minh LUẬT.
 *
 * `blockedReason` là hàm thuần, nên ở đây không có DNS, không có env, không có
 * socket — chỉ còn đúng quyết định chặn-hay-không.
 */

/** Phải CHẶN. Mỗi dòng là một địa chỉ có đường tới một thứ không nên tới. */
const PHAI_CHAN: [string, 4 | 6, string][] = [
  // Dải cloud phát credential của máy ảo — đích SSRF kinh điển nhất.
  ['169.254.169.254', 4, 'link-local'],
  ['169.254.0.1', 4, 'link-local'],

  ['10.0.0.1', 4, 'mạng nội bộ'],
  ['10.255.255.255', 4, 'mạng nội bộ'],
  ['172.16.0.1', 4, 'mạng nội bộ'],
  ['172.31.255.254', 4, 'mạng nội bộ'],
  ['192.168.1.1', 4, 'mạng nội bộ'],

  ['127.0.0.1', 4, 'loopback'],
  // Cả dải 127/8, không riêng 127.0.0.1 — `127.1` kiểu cũ cũng về loopback.
  ['127.255.255.254', 4, 'loopback'],
  ['0.0.0.0', 4, 'không xác định'],

  ['100.64.0.1', 4, 'nhà mạng'],
  ['192.0.0.1', 4, 'IETF'],
  ['198.18.0.1', 4, 'đo hiệu năng'],
  ['224.0.0.1', 4, 'multicast'],
  ['240.0.0.1', 4, 'dự trữ'],

  ['::1', 6, 'loopback'],
  ['::', 6, 'không xác định'],
  ['fe80::1', 6, 'link-local'],
  ['fc00::1', 6, 'mạng nội bộ'],
  ['fd12:3456::1', 6, 'mạng nội bộ'],
  ['ff02::1', 6, 'multicast'],

  // IPv4 khoác áo IPv6 — đúng cái cửa mà một chốt chỉ xét IPv6 sẽ để hở.
  ['::ffff:127.0.0.1', 6, 'loopback'],
  ['::ffff:169.254.169.254', 6, 'link-local'],
  ['::ffff:10.0.0.1', 6, 'mạng nội bộ'],
];

/** Phải CHO ĐI. Chặn quá tay cũng là lỗi: khách có database trên IP công khai. */
const PHAI_CHO_DI: [string, 4 | 6][] = [
  ['8.8.8.8', 4],
  ['1.1.1.1', 4],
  ['13.228.225.19', 4],
  // 172.32+ nằm NGOÀI 172.16/12 — ranh giới hay bị cài sai thành 172.16–172.32.
  ['172.32.0.1', 4],
  // 192.0.2.x là dải tài liệu, không nằm trong 192.0.0.0/24 bị chặn.
  ['192.0.2.1', 4],
  ['2606:4700:4700::1111', 6],
  ['2001:4860:4860::8888', 6],
];

describe('chốt SSRF: blockedReason', () => {
  it.each(PHAI_CHAN)('CHẶN %s (%s) — %s', (address, family, vi) => {
    const reason = blockedReason({ address, family });
    expect(reason, `${address} phải bị chặn vì ${vi}`).not.toBeNull();
  });

  it.each(PHAI_CHO_DI)('CHO ĐI %s (%s)', (address, family) => {
    expect(blockedReason({ address, family }), `${address} là địa chỉ công khai`).toBeNull();
  });

  /**
   * Octet đầu >= 128 — và một ghi chú trong mã nguồn mà SỐ ĐO đã bác bỏ.
   *
   * `guardHost.ts` viết: dùng `>>` có dấu thay cho `>>>` "sẽ làm hỏng mọi địa
   * chỉ có octet đầu >= 128". Thử thật: đổi `>>>` thành `>>` rồi chạy cả tệp
   * này -> 33/33 VẪN XANH.
   *
   * Lý do câu đó không đúng: phép so là `ip >> shift === base >> shift`, hai vế
   * cùng được mở rộng dấu y như nhau, nên đẳng thức không đổi. `>>>` ở đây là
   * thói quen tốt, không phải thứ chặn một lỗi.
   *
   * Nên ba dòng dưới KHÔNG được gọi là ca hồi quy cho cái bẫy đó — chúng phủ
   * thứ khác và có thật: ranh giới của các dải octet cao. Bỏ sót `192.168/16`
   * hay cài sai `240/4` thì chúng đỏ.
   */
  it('dải có octet đầu >= 128 vẫn phân loại đúng', () => {
    expect(blockedReason({ address: '192.168.0.1', family: 4 })).not.toBeNull();
    expect(blockedReason({ address: '240.0.0.1', family: 4 })).not.toBeNull();
    expect(blockedReason({ address: '128.0.0.1', family: 4 })).toBeNull();
  });

  it('địa chỉ IPv4 không hợp lệ bị coi là không đi được', () => {
    // Không rơi về "cho đi": một chuỗi lạ tới được đây nghĩa là đã có gì sai ở
    // tầng phân giải, và đoán ý hộ nó là cách mở cửa mà không ai thấy.
    expect(blockedReason({ address: '999.1.1.1', family: 4 })).not.toBeNull();
    expect(blockedReason({ address: 'khong-phai-ip', family: 4 })).not.toBeNull();
  });
});
