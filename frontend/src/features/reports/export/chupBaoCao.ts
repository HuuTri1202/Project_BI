import {
  CHON_DANG_BAN,
  THUOC_TINH_KHONG_XUAT,
  THUOC_TINH_LOI_XUAT,
} from '../../../services/danhDauXuat';
import { PT_MOI_PX, type AnhNen, type TrangPdf } from './pdfAnh';

/**
 * Chụp một vùng báo cáo thành ảnh — dùng cho cả PNG lẫn từng trang PDF.
 *
 * ═══ Vì sao `modern-screenshot`, không phải html2canvas ════════════════════
 *
 * html2canvas VẼ LẠI trang bằng bộ phân tích CSS của riêng nó, và bộ đó không
 * hiểu `oklch(...)` — thứ mọi màu Tailwind 4 trong ứng dụng này dùng. Nó ném lỗi
 * ngay ô đầu tiên. `modern-screenshot` thì bọc bản sao của DOM vào một
 * `<foreignObject>` và để CHÍNH trình duyệt vẽ, nên ảnh ra đúng thứ trên màn
 * hình: cùng màu, cùng font, cùng SVG của Vega.
 */

/** Nền của ảnh — đúng nền `slate-50` của khung báo cáo, để ô trắng nổi lên như trên màn hình. */
const NEN = '#f8fafc';

/** Lề quanh báo cáo và dải tiêu đề, tính bằng điểm ảnh CSS. */
const LE = 24;
const CAO_TIEU_DE = 24;
const CAO_DONG_PHU = 16;
const KHE_TIEU_DE = 4;
const KHE_DUOI_DAU = 16;
const CAO_DAU = CAO_TIEU_DE + KHE_TIEU_DE + CAO_DONG_PHU + KHE_DUOI_DAU;

/**
 * Giới hạn khung vẽ mà trình duyệt nào cũng chịu.
 *
 * Vượt cạnh 16.384 hoặc diện tích ~16,7 triệu điểm ảnh (Safari trên iPad) thì
 * `canvas` không báo lỗi — nó trả về một ảnh TRẮNG. Báo cáo dài mà chụp ở tỉ lệ
 * 2 là chạm ngưỡng này, nên tỉ lệ tự hạ xuống thay vì giao một tệp trống.
 */
export const CANH_TOI_DA = 16_384;
export const DIEN_TICH_TOI_DA = 16_777_216;
/** Tỉ lệ 2: chữ trên trục vẫn sắc khi phóng to PDF hoặc in ra. */
const TI_LE_MONG_MUON = 2;

/** Hết 30 giây mà báo cáo chưa vẽ xong thì dừng và nói ra, không treo nút mãi. */
const HAN_CHO_MS = 30_000;
/**
 * Số khung hình LIÊN TIẾP không còn gì bận mới được chụp.
 *
 * Một khung hình là chưa đủ: giữa lượt render đưa số liệu vào một ô và effect
 * bảo Vega vẽ lại có một khoảng mà ô chưa kịp gắn dấu bận. Ba khung hình phủ
 * được khoảng đó và cả nhịp `ResizeObserver` đo lại ô ngay sau khi vẽ.
 */
const SO_KHUNG_YEN = 3;

export class LoiXuat extends Error {}

export async function choVeXong(vung: HTMLElement, hanMs = HAN_CHO_MS): Promise<void> {
  const han = Date.now() + hanMs;
  await document.fonts?.ready;

  let yen = 0;
  while (yen < SO_KHUNG_YEN) {
    await khungHinhSau();
    if (!vung.isConnected) throw new LoiXuat('Báo cáo đã đóng trước khi xuất xong.');

    const loi = vung.querySelector(`[${THUOC_TINH_LOI_XUAT}]`);
    if (loi !== null) {
      throw new LoiXuat(loi.getAttribute(THUOC_TINH_LOI_XUAT) || 'Báo cáo đang lỗi.');
    }

    yen = vung.querySelector(CHON_DANG_BAN) === null ? yen + 1 : 0;
    if (yen < SO_KHUNG_YEN && Date.now() > han) {
      throw new LoiXuat(
        `Báo cáo vẫn chưa vẽ xong sau ${Math.round(hanMs / 1000)} giây. Hãy thử xuất lại.`,
      );
    }
  }
}

/**
 * Khung hình kế tiếp — hoặc 100ms nếu tab đang ẩn.
 *
 * Tab ẩn thì `requestAnimationFrame` ngừng hẳn, và vòng chờ sẽ không bao giờ
 * tới được hạn 30 giây để báo lỗi.
 */
function khungHinhSau(): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 100);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        clearTimeout(t);
        resolve();
      });
    }
  });
}

/** Tỉ lệ chụp cho một ảnh `rong × cao` điểm ảnh CSS — xem `CANH_TOI_DA`. */
export function tiLeChup(rong: number, cao: number): number {
  return Math.min(
    TI_LE_MONG_MUON,
    CANH_TOI_DA / Math.max(rong, cao, 1),
    Math.sqrt(DIEN_TICH_TOI_DA / Math.max(rong * cao, 1)),
  );
}

export interface ThongTinAnh {
  tieuDe: string;
  /** Dòng nhỏ dưới tiêu đề: tên trang, giờ xuất. */
  phu: string;
}

/**
 * Chụp `vung` (đợi nó vẽ xong) rồi đặt vào khung có lề và dải tiêu đề.
 *
 * Kích thước tính bằng điểm ảnh CSS của KHUNG CUỐI, để tỉ lệ được hạ đúng theo
 * ảnh thật sự sẽ tạo ra chứ không theo riêng phần báo cáo bên trong.
 */
export async function chupVung(
  vung: HTMLElement,
  thongTin: ThongTinAnh,
): Promise<{ canvas: HTMLCanvasElement; rongCss: number; caoCss: number }> {
  // Nạp thư viện TRƯỚC khi chờ: để giữa lúc "đã vẽ xong" và lúc chụp không còn
  // một lượt tải mạng nào chen vào.
  const { domToCanvas } = await import('modern-screenshot');
  await choVeXong(vung);

  const rongVung = Math.ceil(vung.scrollWidth);
  const caoVung = Math.ceil(vung.scrollHeight);
  const rongCss = rongVung + LE * 2;
  const caoCss = caoVung + LE * 2 + CAO_DAU;
  const tiLe = tiLeChup(rongCss, caoCss);

  const anh = await domToCanvas(vung, {
    scale: tiLe,
    width: rongVung,
    height: caoVung,
    backgroundColor: NEN,
    filter: (node) => !(node instanceof Element && node.hasAttribute(THUOC_TINH_KHONG_XUAT)),
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(rongCss * tiLe);
  canvas.height = Math.round(caoCss * tiLe);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new LoiXuat('Trình duyệt không cấp được khung vẽ để xuất ảnh.');

  ctx.fillStyle = NEN;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(tiLe, tiLe);

  const font = getComputedStyle(document.body).fontFamily;
  const rongChu = rongCss - LE * 2;
  ctx.textBaseline = 'top';

  ctx.fillStyle = '#0f172a';
  ctx.font = `600 18px ${font}`;
  ctx.fillText(catChu(ctx, thongTin.tieuDe, rongChu), LE, LE + 2);

  ctx.fillStyle = '#64748b';
  ctx.font = `400 12px ${font}`;
  ctx.fillText(catChu(ctx, thongTin.phu, rongChu), LE, LE + CAO_TIEU_DE + KHE_TIEU_DE + 1);

  ctx.drawImage(anh, LE, LE + CAO_DAU, rongVung, caoVung);
  // Khung vẽ trung gian có thể lên tới hàng chục MB; trả lại ngay thay vì đợi
  // bộ gom rác, nhất là khi xuất nhiều trang liên tiếp.
  anh.width = 0;
  anh.height = 0;

  return { canvas, rongCss, caoCss };
}

/** Cắt chữ vừa `rongToiDa`, thêm "…" — tên báo cáo dài không được tràn khỏi ảnh. */
function catChu(ctx: CanvasRenderingContext2D, s: string, rongToiDa: number): string {
  if (ctx.measureText(s).width <= rongToiDa) return s;
  let thap = 0;
  let cao = s.length;
  while (thap < cao) {
    const giua = Math.ceil((thap + cao) / 2);
    if (ctx.measureText(`${s.slice(0, giua)}…`).width <= rongToiDa) thap = giua;
    else cao = giua - 1;
  }
  return `${s.slice(0, thap).trimEnd()}…`;
}

export function canvasSangPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob === null ? reject(new LoiXuat('Trình duyệt không tạo được ảnh PNG.')) : resolve(blob),
      'image/png',
    );
  });
}

/** Một trang PDF từ ảnh đã ghép — trang đúng cỡ báo cáo, không ép vào khổ A4. */
export async function canvasSangTrangPdf(
  canvas: HTMLCanvasElement,
  rongCss: number,
  caoCss: number,
): Promise<TrangPdf> {
  const anh = await nenRgb(canvas);
  return { rongPt: rongCss * PT_MOI_PX, caoPt: caoCss * PT_MOI_PX, anh };
}

/**
 * Điểm ảnh của `canvas` ở dạng RGB, nén zlib cho `FlateDecode`.
 *
 * Đọc từng dải 256 hàng thay vì cả ảnh một lần: `getImageData` của ảnh
 * 2800×6000 là 67 MB, cộng thêm bản RGB 50 MB — hai khối đó cùng sống một lúc
 * là đủ làm một tab trên máy yếu bị trình duyệt giết.
 */
export async function nenRgb(canvas: HTMLCanvasElement): Promise<AnhNen> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new LoiXuat('Trình duyệt không đọc được ảnh vừa chụp.');

  const { width: rong, height: cao } = canvas;
  const nen = new CompressionStream('deflate');
  const ghi = nen.writable.getWriter();
  // Bắt đầu ĐỌC trước khi ghi: luồng nén có áp lực ngược, và không ai đọc thì
  // lần ghi thứ hai treo mãi.
  const ketQua = new Response(nen.readable).arrayBuffer();

  const DAI = 256;
  for (let y = 0; y < cao; y += DAI) {
    const h = Math.min(DAI, cao - y);
    await ghi.write(rgbaSangRgb(ctx.getImageData(0, y, rong, h).data));
  }
  await ghi.close();

  return { rong, cao, duLieu: new Uint8Array(await ketQua) };
}

/**
 * Bỏ kênh alpha, trộn lên nền trắng.
 *
 * Ảnh chụp có nền đặc nên alpha thực tế luôn là 255, nhưng PDF `DeviceRGB` không
 * có alpha: một điểm ảnh trong suốt mà cắt thẳng kênh đi sẽ thành ô ĐEN.
 */
export function rgbaSangRgb(rgba: Uint8ClampedArray): Uint8Array<ArrayBuffer> {
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const a = rgba[i + 3] as number;
    const nen = 255 - a;
    rgb[j] = ((rgba[i] as number) * a + 255 * nen + 127) / 255;
    rgb[j + 1] = ((rgba[i + 1] as number) * a + 255 * nen + 127) / 255;
    rgb[j + 2] = ((rgba[i + 2] as number) * a + 255 * nen + 127) / 255;
  }
  return rgb;
}

/**
 * Tên tệp tải về từ tên báo cáo.
 *
 * Giữ nguyên tiếng Việt có dấu — hệ điều hành nào hiện nay cũng đọc được — và
 * chỉ thay những ký tự Windows cấm trong tên tệp. Không thay thì trình duyệt tự
 * đổi chúng thành "_" theo cách của riêng nó, hoặc bỏ luôn tên và lưu thành
 * "download".
 */
export function tenTepXuat(phan: readonly (string | null)[], duoi: 'png' | 'pdf'): string {
  const ten = phan
    .filter((p): p is string => p !== null && p.trim() !== '')
    .join(' - ')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    // Windows bỏ dấu chấm và khoảng trắng ở cuối tên — "Báo cáo." thành "Báo cáo".
    .replace(/[.\s]+$/, '');
  return `${ten === '' ? 'bao-cao' : ten}.${duoi}`;
}

/**
 * Tải `blob` xuống với tên `ten`.
 *
 * Thu hồi URL SAU một nhịp chứ không ngay sau `click()`: Firefox bắt đầu đọc
 * blob bất đồng bộ, thu hồi sớm là tệp tải về rỗng.
 */
export function taiXuong(blob: Blob, ten: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = ten;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
