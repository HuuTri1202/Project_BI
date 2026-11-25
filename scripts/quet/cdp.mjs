/**
 * Điều khiển Chrome qua DevTools Protocol — tối giản, KHÔNG phụ thuộc npm.
 *
 * Node ≥ 22 có `WebSocket` sẵn trong global, nên cả tệp này chỉ cần
 * `node:child_process`. Đó là lý do bộ quét không kéo theo Playwright hay
 * Puppeteer: thứ duy nhất cần là "mở trang, chạy một câu JS, nghe console và
 * network", và ba việc đó là ba lời gọi CDP.
 *
 * ⚠️ `timChrome` trả `null` khi không tìm thấy, KHÔNG ném. Máy CI hoặc máy chỉ
 * làm backend có thể không có Chrome, và khi đó mục quét trang phải BỎ QUA có
 * ghi chú — một mục tự tắt vì thiếu công cụ thì khác hẳn một mục đã chạy và đạt.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Tìm Chrome/Chromium/Edge trên cả ba hệ điều hành.
 *
 * Edge nằm trong danh sách vì nó cũng là Chromium và cũng nói CDP: trên máy
 * Windows chưa cài Chrome thì nó là thứ gần nhất có sẵn.
 */
export function timChrome() {
  if (process.env.QUET_CHROME !== undefined) {
    return existsSync(process.env.QUET_CHROME) ? process.env.QUET_CHROME : null;
  }
  const ungVien =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
          ];
  return ungVien.find((d) => d !== '' && existsSync(d)) ?? null;
}

export async function moChrome({ port = 9333, userDir, duongChrome } = {}) {
  const chrome = duongChrome ?? timChrome();
  if (chrome === null) throw new Error('không tìm thấy Chrome');

  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let ws = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      ws = (await r.json()).webSocketDebuggerUrl;
      if (ws !== undefined && ws !== null) break;
    } catch {
      /* chưa lên — thử lại */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (ws === null) {
    proc.kill();
    throw new Error('Chrome không mở được cổng debug');
  }
  return { proc, port, browserWs: ws };
}

export async function moTab(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const t = await r.json();
  return noiTab(t.webSocketDebuggerUrl);
}

export function noiTab(url) {
  const sock = new WebSocket(url);
  let id = 0;
  const dangCho = new Map();
  const nghe = [];

  const san = new Promise((ok, loi) => {
    sock.addEventListener('open', () => ok());
    sock.addEventListener('error', (e) => loi(new Error('WS lỗi: ' + String(e.message ?? e))));
  });

  sock.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== undefined) {
      const p = dangCho.get(m.id);
      if (p !== undefined) {
        dangCho.delete(m.id);
        if (m.error !== undefined) p.loi(new Error(m.error.message));
        else p.ok(m.result);
      }
      return;
    }
    for (const f of nghe) f(m);
  });

  const goi = async (method, params = {}) => {
    await san;
    const n = ++id;
    return new Promise((ok, loi) => {
      dangCho.set(n, { ok, loi });
      sock.send(JSON.stringify({ id: n, method, params }));
      setTimeout(() => {
        if (dangCho.has(n)) {
          dangCho.delete(n);
          loi(new Error('CDP quá hạn: ' + method));
        }
      }, 30_000);
    });
  };

  return {
    goi,
    onSuKien: (f) => nghe.push(f),
    dong: () => sock.close(),
    khungNhin: async (rong = 1440, cao = 900) => {
      await goi('Emulation.setDeviceMetricsOverride', {
        width: rong,
        height: cao,
        deviceScaleFactor: 1,
        mobile: false,
      });
    },
    /** Chạy JS trong trang, trả giá trị thường. Ném nếu JS trong trang ném. */
    chay: async (bieuThuc) => {
      const r = await goi('Runtime.evaluate', {
        expression: bieuThuc,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails !== undefined) {
        throw new Error('JS lỗi: ' + (r.exceptionDetails.exception?.description ?? ''));
      }
      return r.result.value;
    },
    /** Điều hướng rồi chờ một khoảng cho React vẽ xong. */
    di: async (duong, cho = 2500) => {
      await goi('Page.navigate', { url: duong });
      await new Promise((r) => setTimeout(r, cho));
    },
  };
}
