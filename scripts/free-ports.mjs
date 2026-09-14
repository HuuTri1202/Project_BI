#!/usr/bin/env node
/**
 * Dọn sạch tiến trình dev còn sót lại, rồi mới trả cổng về trạng thái trống.
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
 * ─── Vì sao "giết theo cổng" là chưa đủ ─────────────────────────────────────
 *
 * Bản đầu tiên của script này chỉ giết tiến trình đang NGHE cổng. Nó bỏ sót
 * đúng tầng nguy hiểm nhất: `tsx watch` KHÔNG nghe cổng nào cả. Nó là tầng
 * GIÁM SÁT — con nó chết thì nó đẻ con mới.
 *
 * Nên chuỗi sự kiện thật là thế này, và nó lặp đi lặp lại:
 *
 *     1. Ta giết `node src/index.ts` (kẻ đang giữ cổng 4000).
 *     2. Script in ra "đã giải phóng cổng 4000" — đúng, trong khoảng 200ms.
 *     3. `tsx watch` thấy con chết, lập tức đẻ lại. Cổng 4000 bị chiếm lần nữa.
 *     4. Backend mới của `npm run dev` đâm vào EADDRINUSE rồi chết.
 *     5. `concurrently -k` hạ luôn tiến trình web -> Vite tắt theo.
 *
 * Triệu chứng người dùng nhìn thấy là thứ trông chẳng liên quan gì tới backend:
 * mở `localhost:5173` và nhận `ERR_CONNECTION_REFUSED`, trong khi cổng 4000 vẫn
 * đang trả lời bình thường. Giết cái đang nghe cổng mà bỏ sống kẻ giám sát nó
 * thì không phải là dọn dẹp — chỉ là bấm nút restart hộ nó.
 *
 * Vậy nên thứ tự dưới đây là bắt buộc: **hạ tầng giám sát TRƯỚC, tầng nghe cổng
 * SAU**. Đảo lại là quay về đúng vòng lặp trên.
 *
 * ─── Giới hạn tự đặt ra ─────────────────────────────────────────────────────
 *
 * Script này giết tiến trình của người khác, nên nó tự trói vào bốn luật:
 *
 *   1. CHỈ giết hai nhóm, không nhóm nào khác:
 *      a. Tiến trình chạy một công cụ nằm trong `node_modules` của CHÍNH repo
 *         này — và CHỈ khi được bật bằng cờ `--reap-stale`. Xem khối "Vì sao
 *         quét toàn repo phải xin phép" ngay dưới đây.
 *      b. Tiến trình đang NGHE đúng cổng được truyền vào.
 *   2. Với nhóm (b), CHỈ giết nếu tên tiến trình nằm trong `KILLABLE`. Cổng
 *      4000 mà đang bị một dịch vụ hệ thống hay ứng dụng khác chiếm thì nó báo
 *      rồi dừng — dọn hộ quá tay còn tệ hơn cái lỗi ban đầu. Nhóm (a) không cần
 *      luật này: một tiến trình đang chạy file trong `node_modules` của repo
 *      này thì không thể là việc của ai khác.
 *   3. Không giết chính mình hay tổ tiên của mình.
 *   4. LUÔN in ra đã giết cái gì. Một script lặng lẽ giết tiến trình là thứ
 *      không ai gỡ được khi nó làm sai.
 *
 * ─── Vì sao quét toàn repo phải xin phép (`--reap-stale`) ───────────────────
 *
 * `backend/package.json` có `predev` RIÊNG. Nên khi chạy `npm run dev` ở gốc,
 * script này chạy hai lần, và lần thứ hai rơi vào đúng thời điểm tệ nhất: sau
 * khi Vite và trình biên dịch của `shared` đã lên. Một bản trước của script
 * quét toàn repo ở cả hai lần, và lần thứ hai giết sạch hai tiến trình vừa
 * khởi động — chúng chạy từ `node_modules` của repo nên khớp luật 1a, còn quan
 * hệ "anh em" thì không có luật nào che. `concurrently -k` thấy một tiến trình
 * chết liền hạ nốt phần còn lại: cả `npm run dev` sập trong khoảng hai giây.
 *
 * Đã thử vá bằng cách dò cây tiến trình để nhận ra anh em — leo ngược lên tìm
 * mắt xích `npm` cao nhất rồi bảo vệ cả cây con. Cách đó SAI, và sai theo kiểu
 * tệ nhất: nó phụ thuộc vào hình dạng cây tiến trình, thứ thay đổi theo shell,
 * theo `script-shell` của npm, theo cách IDE khởi chạy lệnh. Nó chạy đúng trên
 * lý thuyết rồi hỏng ngay lần chạy thật đầu tiên.
 *
 * Nên cách hiện tại không dò gì cả. Việc quét toàn repo chỉ xảy ra ở `predev`
 * của GỐC, nơi npm bảo đảm chạy xong TRƯỚC khi `dev` bắt đầu — tức là trước
 * khi tồn tại bất kỳ tiến trình anh em nào. An toàn vì cấu trúc, không phải vì
 * đoán đúng. `predev` của backend giữ nguyên hành vi cũ: chỉ dọn theo cổng.
 *
 * Hệ quả cần biết: chạy tay `npm run ports:free` trong lúc `npm run dev` đang
 * chạy sẽ TẮT nó. Đó đúng là ý định của người gõ lệnh đó, và script in ra từng
 * tiến trình nó hạ.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Chỉ những tiến trình do chính bộ công cụ này sinh ra. */
const KILLABLE = ['node.exe', 'node', 'npm.exe', 'npm', 'tsx.exe', 'tsx', 'bun.exe', 'bun'];

const isWindows = process.platform === 'win32';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Dấu nhận dạng "tiến trình này là công cụ của repo này".
 *
 * Dòng lệnh thật trông như thế này (lấy từ máy đang chạy):
 *
 *     node D:\...\bi-flatform\node_modules\.bin\..\tsx\dist\cli.mjs watch src/index.ts
 *     node --require D:\...\bi-flatform\node_modules\tsx\dist\preflight.cjs ... src/index.ts
 *
 * Cả hai đều nhắc tới `node_modules` của repo. Còn tầng `npm` bọc ngoài thì
 * KHÔNG (nó trỏ vào `node_modules` của npm trong Program Files) — không sao,
 * vì `taskkill /T` hạ cả cây con, và một tiến trình npm mất con sẽ tự thoát.
 */
const repoMarker = normalizePath(path.join(repoRoot, 'node_modules'));

/**
 * Đưa đường dẫn về một dạng so sánh được.
 *
 * Trên Windows cần cả hai bước: đổi `/` thành `\` (dòng lệnh có cả dạng URL
 * `file:///D:/...`) và hạ chữ thường (ổ đĩa lúc là `D:` lúc là `d:`).
 */
function normalizePath(value) {
  return isWindows ? value.replace(/\//g, '\\').toLowerCase() : value;
}

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

/**
 * Toàn bộ tiến trình đang chạy: `[{ pid, ppid, cmd }]`.
 *
 * Cần `cmd` để nhận ra công cụ của repo, và cần `ppid` để dựng chuỗi tổ tiên
 * (luật 3). `tasklist` không in dòng lệnh nên phải hỏi WMI; dùng PowerShell
 * thay cho `wmic` vì `wmic` đã bị gỡ khỏi các bản Windows 11 mới.
 *
 * Hỏng ở đây (không có PowerShell, WMI tắt) trả về mảng rỗng — script tự thu về
 * đúng hành vi của bản cũ là dọn theo cổng, chứ không chết giữa `predev`.
 */
function processTable() {
  const rows = [];

  if (isWindows) {
    // `#|#` chứ không phải khoảng trắng hay dấu phẩy: dòng lệnh chứa cả hai.
    const out = run('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)#|#$($_.ParentProcessId)#|#$($_.CommandLine)" }',
    ]);

    for (const line of out.split(/\r?\n/)) {
      const parts = line.split('#|#');
      if (parts.length < 3) continue;
      const pid = Number(parts[0]);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      // `slice(2).join` chứ không phải `parts[2]`: dòng lệnh có thể chứa `#|#`.
      rows.push({ pid, ppid: Number(parts[1]) || 0, cmd: parts.slice(2).join('#|#') });
    }
    return rows;
  }

  for (const line of run('ps', ['-eo', 'pid=,ppid=,args=']).split(/\n/)) {
    const matched = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (matched === null) continue;
    rows.push({ pid: Number(matched[1]), ppid: Number(matched[2]), cmd: matched[3] });
  }
  return rows;
}

/**
 * PID của chính script này và mọi tổ tiên của nó (luật 3).
 *
 * Rẻ và không phụ thuộc hình dạng cây: chỉ đi lên theo quan hệ cha-con, không
 * suy diễn gì về shell hay về npm. Nó KHÔNG che anh em — và không cần che, vì
 * việc quét toàn repo chỉ chạy ở `predev` của gốc, lúc chưa có anh em nào.
 */
function selfChain(table) {
  const parentOf = new Map(table.map((row) => [row.pid, row.ppid]));
  const chain = new Set();

  let current = process.pid;
  // Chặn 64 tầng: PID bị hệ điều hành dùng lại có thể tạo vòng cha-con.
  for (let depth = 0; depth < 64 && current > 0 && !chain.has(current); depth++) {
    chain.add(current);
    current = parentOf.get(current) ?? 0;
  }
  return chain;
}

/** Tên tiến trình, hoặc `null` nếu nó đã biến mất. */
function nameOf(pid) {
  if (isWindows) {
    const csv = run('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV']);
    return /^"([^"]+)"/.exec(csv.trim())?.[1] ?? null;
  }
  return run('ps', ['-p', String(pid), '-o', 'comm=']).trim() || null;
}

/** Dòng lệnh rút gọn, đủ để người đọc log nhận ra đã giết nhầm hay chưa. */
function shortCmd(cmd) {
  const cleaned = cmd
    .split(/\s+/)
    .map((token) => token.replace(new RegExp(escapeRegExp(repoRoot), 'gi'), '.'))
    .join(' ')
    .trim();
  return cleaned.length > 88 ? `${cleaned.slice(0, 88)}…` : cleaned;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

const argv = process.argv.slice(2);
/** Bật bước 1 (quét toàn repo). Chỉ `predev` của GỐC được truyền cờ này. */
const reapStale = argv.includes('--reap-stale');
const ports = argv.filter((arg) => !arg.startsWith('--')).map(Number).filter(Boolean);
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

// ─── Bước 1: hạ tầng giám sát (chỉ khi có `--reap-stale`) ───────────
//
// Phải chạy TRƯỚC bước 2. `tsx watch` và `vite` không nghe cổng nào nên bước 2
// không bao giờ thấy chúng, mà để chúng sống thì chúng đẻ lại đúng cái tiến
// trình bước 2 vừa giết.
const table = reapStale ? processTable() : [];
const untouchable = selfChain(table);

for (const row of table) {
  if (untouchable.has(row.pid)) continue;
  if (!normalizePath(row.cmd).includes(repoMarker)) continue;
  if (handled.has(row.pid)) continue;
  handled.add(row.pid);

  seen++;
  freed++;
  kill(row.pid);
  console.log(`[ports] đã dọn tiến trình dev cũ của repo — PID ${row.pid}: ${shortCmd(row.cmd)}`);
}

// ─── Bước 2: hạ tầng đang nghe cổng ─────────────────────────────────────────
//
// Vẫn cần, kể cả sau bước 1: cổng có thể đang bị một tiến trình KHÔNG chạy từ
// `node_modules` của repo chiếm (một `node server.js` gõ tay, một dự án khác).
for (const port of ports) {
  for (const pid of listenersOn(port)) {
    if (untouchable.has(pid)) continue;
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

if (seen === 0) console.log(`[ports] cổng ${ports.join(', ')} đang trống, không có tiến trình dev nào sót lại.`);
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
