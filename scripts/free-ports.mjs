#!/usr/bin/env node
/**
 * Giải phóng cổng dev còn bị tiến trình mồ côi chiếm.
 *
 * ─── Vì sao thứ này cần tồn tại ─────────────────────────────────────────────
 *
 * `npm run dev` dựng một cây tiến trình bốn tầng:
 *
 *     concurrently -> npm -> tsx watch -> node (đây mới là cái mở cổng 4000)
 *
 * Trên Windows, Node KHÔNG gửi được tín hiệu POSIX. `child.kill('SIGTERM')` mà
 * `concurrently --kill-others` dùng thực chất gọi `TerminateProcess`, và lệnh đó
 * chỉ giết đúng tiến trình được trỏ tới — con cháu của nó không nhận được gì cả.
 * Nên đóng terminal hay bấm nút Stop của IDE sẽ hạ ba tầng trên mà để lại tầng
 * dưới cùng sống sót, vẫn giữ nguyên cổng 4000.
 *
 * Bộ xử lý SIGINT/SIGTERM trong `backend/src/index.ts` chỉ cứu được trường hợp
 * tiến trình THẬT SỰ nhận được tín hiệu. Trường hợp mồ côi thì không, và không
 * có cách nào sửa từ bên trong tiến trình đã chết. Phải dọn từ bên ngoài.
 *
 * ─── Giới hạn tự đặt ra ─────────────────────────────────────────────────────
 *
 * Script này giết tiến trình của người khác, nên nó tự trói vào ba luật:
 *
 *   1. CHỈ giết tiến trình đang NGHE đúng cổng được truyền vào.
 *   2. CHỈ giết nếu tên tiến trình nằm trong `KILLABLE`. Cổng 4000 mà đang bị
 *      một dịch vụ hệ thống hay một ứng dụng khác chiếm thì nó báo rồi dừng —
 *      dọn hộ quá tay còn tệ hơn cái lỗi ban đầu.
 *   3. LUÔN in ra đã giết cái gì. Một script lặng lẽ giết tiến trình là thứ
 *      không ai gỡ được khi nó làm sai.
 */
import { execFileSync } from 'node:child_process';

/** Chỉ những tiến trình do chính bộ công cụ này sinh ra. */
const KILLABLE = ['node.exe', 'node', 'npm.exe', 'npm', 'tsx.exe', 'tsx', 'bun.exe', 'bun'];

const isWindows = process.platform === 'win32';

/** Chạy lệnh và trả stdout; lỗi (kể cả "không tìm thấy gì") thành chuỗi rỗng. */
function run(file, args) {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** PID đang LISTEN trên cổng này. Trả về mảng vì IPv4 và IPv6 là hai dòng riêng. */
function listenersOn(port) {
  if (isWindows) {
    // ⚠️ KHÔNG thêm `-p TCP`. Trên Windows, `netstat -p TCP` chỉ liệt kê IPv4 —
    // IPv6 là một giao thức RIÊNG tên `TCPv6`. Mà Vite bind mặc định vào
    // `[::1]:5173`, tức là một listener IPv6 thuần: script này sẽ báo "cổng
    // đang trống" rồi `npm run dev` đâm ngay vào `EADDRINUSE`. Đúng cái lỗi mà
    // nó sinh ra để dọn, và nó im lặng bỏ qua.
    //
    // `netstat -ano` không lọc giao thức nên trả cả hai. Dòng UDP không có chữ
    // LISTENING nên đã bị bộ lọc ngay dưới loại ra.
    //
    // Chỉ nhận dòng LISTENING và địa chỉ cục bộ kết thúc đúng bằng `:<port>`.
    // So khớp phần đuôi chứ không `includes`: `includes(':4000')` sẽ trúng cả
    // `:40001`.
    return run('netstat', ['-ano'])
      .split(/\r?\n/)
      .filter((line) => /\bLISTENING\b/.test(line))
      .map((line) => line.trim().split(/\s+/))
      .filter((cols) => cols[1]?.endsWith(`:${port}`))
      .map((cols) => Number(cols[4]))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  }

  return run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
    .split(/\r?\n/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/** Tên tiến trình, hoặc `null` nếu nó đã biến mất. */
function nameOf(pid) {
  if (isWindows) {
    const csv = run('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV']);
    return /^"([^"]+)"/.exec(csv.trim())?.[1] ?? null;
  }
  return run('ps', ['-p', String(pid), '-o', 'comm=']).trim() || null;
}

function kill(pid) {
  if (isWindows) {
    // `/T` giết cả cây con — chính thứ mà `child.kill()` của Node không làm
    // được, và là lý do tiến trình mồ côi tồn tại ngay từ đầu.
    run('taskkill', ['/PID', String(pid), '/T', '/F']);
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* đã tự thoát trong lúc ta đang xử lý */
  }
}

const ports = process.argv.slice(2).map(Number).filter(Boolean);
if (ports.length === 0) {
  console.error('[ports] cần ít nhất một số cổng, ví dụ: node scripts/free-ports.mjs 4000 5173');
  process.exit(1);
}

// Đếm riêng "thấy ai đó đang nghe" với "đã dọn": gộp hai thứ này làm một sẽ cho
// ra dòng tổng kết tự mâu thuẫn — báo cổng đang bị chiếm rồi ngay dòng sau báo
// cổng đang trống.
let seen = 0;
let freed = 0;
// `Set` vì một tiến trình nghe cả IPv4 lẫn IPv6 sẽ hiện hai dòng cùng một PID.
const handled = new Set();

for (const port of ports) {
  for (const pid of listenersOn(port)) {
    if (handled.has(pid)) continue;
    handled.add(pid);

    const name = nameOf(pid);
    // Tiến trình vừa tự thoát giữa lúc ta đang tra tên — không còn gì để dọn.
    if (name === null) continue;
    seen++;

    if (!KILLABLE.includes(name)) {
      console.warn(
        `[ports] cổng ${port} đang bị "${name}" (PID ${pid}) chiếm — KHÔNG phải tiến trình của dự án này, nên bỏ qua.`,
      );
      continue;
    }

    kill(pid);
    freed++;
    console.log(`[ports] đã giải phóng cổng ${port} — ${name}, PID ${pid} (tiến trình dev cũ).`);
  }
}

if (seen === 0) console.log(`[ports] cổng ${ports.join(', ')} đang trống.`);
else if (freed === 0) console.warn('[ports] không dọn được cổng nào — xem cảnh báo phía trên.');
else waitUntilFree(ports);

/**
 * Chờ hệ điều hành THẬT SỰ nhả cổng ra.
 *
 * `taskkill /F` (và `SIGKILL`) trả về ngay khi đã YÊU CẦU kết thúc tiến trình,
 * không phải khi socket đã được thu hồi. Quãng giữa hai thời điểm đó chỉ dài
 * vài trăm mili-giây — vừa đủ để `npm run dev` chạy tiếp rồi đâm vào
 * `EADDRINUSE` với chính cái cổng script này vừa dọn xong.
 *
 * Triệu chứng của lỗi đó đặc biệt khó tin: log in ra "đã giải phóng cổng 5173"
 * rồi ngay dòng sau là "Port 5173 is already in use".
 *
 * Vòng chờ ĐỒNG BỘ vì script này chạy ở `predev` — nó phải kết thúc muộn hơn
 * thời điểm cổng trống, không phải chỉ hứa hẹn điều đó.
 */
function waitUntilFree(portList) {
  const deadline = Date.now() + 3_000;

  while (Date.now() < deadline) {
    const busy = portList.filter((port) => listenersOn(port).length > 0);
    if (busy.length === 0) return;
    // Ngủ đồng bộ 100ms. `Atomics.wait` là cách duy nhất làm việc này mà không
    // cần async — và ở đây async sẽ không giúp gì, vì không có việc nào khác để
    // làm trong lúc chờ.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }

  console.warn('[ports] đã giết tiến trình nhưng cổng chưa được nhả sau 3 giây — thử lại lệnh.');
}
