import type { CanhBaoCotDto, SemanticType } from '@bi/shared';

import { doanQuyUocSo, isBlank, laOMoHoPhanCach, parseNumber } from './inferType';

/**
 * Soi chất lượng dữ liệu của một CỘT, ở bước xem trước — vá A2 và C3.
 *
 * ═══ Lỗi đã đo trên hệ thống đang chạy ═════════════════════════════════════
 *
 * Một tệp bán hàng thật (chữ do người gõ tay) cho ra biểu đồ "doanh thu theo
 * khu vực" có NĂM cột cho BA khu vực:
 *
 *     Miền Trung  15.980.000
 *     Miền Nam     6.340.000
 *     Miền Bắc     2.050.000
 *     MIỀN NAM       560.000   <- cùng là Miền Nam
 *     miền bắc           750   <- cùng là Miền Bắc
 *
 * Hệ thống không gộp, không gợi ý gộp, và không nói một câu nào. Người dùng chỉ
 * thấy một biểu đồ sai mà trông vẫn hợp lý.
 *
 * ═══ Vì sao PHÁT HIỆN tách khỏi SỬA ════════════════════════════════════════
 *
 * Cùng một phép đo phục vụ hai việc khác nhau, và chúng phải nói y hệt nhau:
 *
 *   - bước 2 của wizard hiện CẢNH BÁO kèm ví dụ lấy từ chính tệp của người dùng;
 *   - nếu người dùng đồng ý gộp, `commit` dựng BẢN ĐỒ GỘP từ cùng những nhóm đó.
 *
 * Hai bản sao của luật "thế nào là cùng một nhóm" sẽ lệch nhau ở lần sửa đầu
 * tiên, và khi đó cảnh báo nói một chuyện còn dữ liệu làm một chuyện khác.
 *
 * ═══ Vì sao KHÔNG tự gộp ═══════════════════════════════════════════════════
 *
 * Gộp là BIẾN ĐỔI dữ liệu của người dùng, và `aB12`/`Ab12` trong một cột mã
 * phân biệt chữ hoa thường thì là hai thứ khác nhau thật. Nên luật ở đây là
 * cùng luật của cả tệp `inferType.ts`: nghi ngờ thì đừng biến đổi — hệ thống
 * NÓI ra chỗ nghi ngờ, người dùng tích một ô để đồng ý.
 */

/**
 * Khoá nhóm: bỏ khoảng trắng hai đầu, co mọi chuỗi trắng thành một dấu cách,
 * rồi hạ chữ thường.
 *
 * `toLowerCase` của JavaScript đúng với Unicode nên `MIỀN` hạ thành `miền` —
 * không cần bảng dấu tiếng Việt riêng. Co khoảng trắng vì `Miền  Nam` (hai dấu
 * cách, lỗi gõ rất thường gặp) cũng là một nhóm riêng trong biểu đồ.
 */
export function khoaNhom(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Nhóm các cách viết khác nhau của cùng một giá trị.
 *
 * Trả về map `khoá -> các cách viết, nhiều lần xuất hiện nhất đứng trước`. Chỉ
 * giữ khoá có TỪ HAI cách viết: khoá một cách viết thì không có gì để gộp và
 * không có gì để cảnh báo.
 */
export function nhomCachViet(values: Iterable<string>): Map<string, string[]> {
  // Đếm theo từng cách viết, rồi mới gom theo khoá — cần số đếm để chọn cách
  // viết ĐẠI DIỆN, xem `banDoGop`.
  const dem = new Map<string, Map<string, number>>();

  for (const raw of values) {
    const s = raw.trim().replace(/\s+/g, ' ');
    if (s === '') continue;
    const khoa = khoaNhom(s);
    const theoKhoa = dem.get(khoa) ?? new Map<string, number>();
    theoKhoa.set(s, (theoKhoa.get(s) ?? 0) + 1);
    dem.set(khoa, theoKhoa);
  }

  const ketQua = new Map<string, string[]>();
  for (const [khoa, theoKhoa] of dem) {
    if (theoKhoa.size < 2) continue;
    const cachViet = [...theoKhoa.entries()]
      .sort(
        (a, b) =>
          // Nhiều nhất trước. Đây là luật chính, và nó nói bằng dữ liệu.
          b[1] - a[1] ||
          // Bằng nhau thì dữ liệu không trả lời được, nên mới tới hình thức.
          diemHinhThuc(b[0]) - diemHinhThuc(a[0]) ||
          // Và cuối cùng là thứ tự chữ cái, để kết quả KHÔNG phụ thuộc thứ tự
          // đọc tệp — bản đồ gộp được LƯU, nhãn biểu đồ dựa vào nó.
          a[0].localeCompare(b[0], 'vi'),
      )
      .map(([viet]) => viet);
    ketQua.set(khoa, cachViet);
  }
  return ketQua;
}

/**
 * Bản đồ gộp của một cột: `khoá nhóm -> cách viết đại diện`.
 *
 * Đại diện là cách viết XUẤT HIỆN NHIỀU NHẤT, không phải một dạng do hệ thống
 * sinh ra. Nhãn trên biểu đồ nhờ vậy vẫn là chữ của người dùng: `Miền Nam`, chứ
 * không phải `MIỀN NAM` hay `miền nam` hay một kiểu Title Case máy móc biến
 * `iPhone` thành `Iphone`.
 *
 * `null` khi không có nhóm nào trùng — không lưu một map rỗng để rồi mọi ô đều
 * phải tra một bảng không bao giờ trả về gì.
 */
export function banDoGop(values: Iterable<string>): Record<string, string> | null {
  const nhom = nhomCachViet(values);
  if (nhom.size === 0) return null;

  const map: Record<string, string> = {};
  for (const [khoa, cachViet] of nhom) {
    const daiDien = cachViet[0];
    if (daiDien !== undefined) map[khoa] = daiDien;
  }
  return Object.keys(map).length === 0 ? null : map;
}

/**
 * Phá thế HOÀ giữa các cách viết xuất hiện bằng nhau.
 *
 * Chỉ dùng khi dữ liệu không trả lời được, và ở đó lựa chọn duy nhất còn lại là
 * chọn bừa. Đã đo trên tệp thật: `Miền Bắc` và `miền bắc` mỗi bên một lần, và
 * thứ tự chữ cái tiếng Việt đưa dạng chữ thường lên trước — nhãn biểu đồ thành
 * "miền bắc" trong một tệp mà người dùng viết hoa đầu chữ ở mọi dòng khác.
 *
 * Thứ bậc: viết hoa đầu chữ > VIẾT HOA HẾT > viết thường hết. Đó là thứ tự một
 * người Việt chọn cho tên riêng, và nó cho cùng một kết quả ở mọi lần chạy.
 */
function diemHinhThuc(s: string): number {
  const hoaDau = /^\p{Lu}/u.test(s);
  const toanHoa = s === s.toUpperCase() && s !== s.toLowerCase();
  return (hoaDau ? 2 : 0) + (toanHoa ? 0 : 1);
}

/**
 * Khoá SO SÁNH GẦN: khoá nhóm, bỏ hết dấu tiếng Việt.
 *
 * `normalize('NFD')` tách chữ thành ký tự gốc + dấu kết hợp, rồi xoá dải dấu
 * kết hợp (U+0300–U+036F). Thêm `đ` -> `d` bằng tay, vì `đ` là một chữ CÁI
 * riêng trong Unicode chứ không phải `d` cộng dấu — không có dòng đó thì
 * "Đà Nẵng" và "Da Nang" vẫn là hai khoá khác nhau.
 */
function khoaBoDau(raw: string): string {
  return khoaNhom(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

/**
 * Những nhóm GẦN GIỐNG nhau — chỉ khác nhau ở DẤU — vá một phần mong muốn D1.
 *
 * ═══ Vì sao CHỈ cảnh báo, không gộp ════════════════════════════════════════
 *
 * `MIỀN NAM` và `Miền Nam` khác nhau ở chữ hoa thường, và đó là một phép biến
 * đổi KHÔNG MẤT THÔNG TIN: hạ cả hai về chữ thường vẫn cho ra cùng một từ, nên
 * gộp được (xem `banDoGop`).
 *
 * `Miền Nam` và `Mien Nam` thì khác: bỏ dấu là MẤT thông tin, và không có cách
 * nào biết dạng nào mới là dạng người dùng muốn. Tệ hơn, hai chuỗi khác dấu có
 * thể là hai thứ khác nhau thật — "Miền" với "Miên", "Hoà" với "Hóa". Nên ở đây
 * hệ thống chỉ NÓI RA, và để người dùng sửa trong tệp của họ.
 *
 * Trả về từng cặp nhóm trùng khoá-bỏ-dấu, mỗi cặp là các cách viết tiêu biểu.
 */
export function nhomGanGiong(values: Iterable<string>): string[][] {
  // Đại diện của mỗi nhóm CHÍNH XÁC trước, rồi mới gom theo khoá bỏ dấu: so
  // sánh trên giá trị thô sẽ coi `MIỀN NAM` và `Miền Nam` là "gần giống", trong
  // khi chúng là cùng một nhóm và đã có đường xử lý riêng.
  const daiDien = new Map<string, string>();
  for (const raw of values) {
    const s = raw.trim().replace(/\s+/g, ' ');
    if (s === '') continue;
    const khoa = khoaNhom(s);
    if (!daiDien.has(khoa)) daiDien.set(khoa, s);
  }

  const theoBoDau = new Map<string, string[]>();
  for (const [khoa, viet] of daiDien) {
    const k = khoaBoDau(khoa);
    theoBoDau.set(k, [...(theoBoDau.get(k) ?? []), viet]);
  }

  return [...theoBoDau.values()].filter((nhom) => nhom.length > 1);
}

/** Bao nhiêu cách viết được nêu trong câu cảnh báo — đủ để nhận ra, không tràn dòng. */
const SO_VI_DU = 4;

/**
 * Cảnh báo của MỘT cột, hoặc `null` nếu cột không có gì đáng nói.
 *
 * Một cột có thể vướng cả hai chuyện, nên trả về mảng chứ không trả về một.
 */
export function canhBaoCot(
  sourceName: string,
  columnIndex: number,
  values: readonly string[],
  semanticType: SemanticType,
): CanhBaoCotDto[] {
  const ra: CanhBaoCotDto[] = [];

  if (semanticType === 'text') {
    const nhom = nhomCachViet(values);
    if (nhom.size > 0) {
      ra.push({
        columnIndex,
        sourceName,
        loai: 'hoa-thuong',
        soNhom: nhom.size,
        viDu: [...nhom.values()].flat().slice(0, SO_VI_DU),
      });
    }

    const ganGiong = nhomGanGiong(values);
    if (ganGiong.length > 0) {
      ra.push({
        columnIndex,
        sourceName,
        loai: 'gan-giong',
        soNhom: ganGiong.length,
        // Một cặp là đủ để người dùng hiểu loại vấn đề và đi tìm phần còn lại.
        viDu: (ganGiong[0] ?? []).slice(0, SO_VI_DU),
      });
    }
  }

  if (semanticType === 'number') {
    const canhBaoSo = canhBaoSoMoHo(sourceName, columnIndex, values);
    if (canhBaoSo !== null) ra.push(canhBaoSo);
  }

  return ra;
}

/**
 * Cột có ô MƠ HỒ mà hệ thống sắp đọc chúng thành THẬP PHÂN — vá C3.
 *
 * ═══ Vì sao luật là thế này, chứ không phải "cột lẫn hai quy ước" ══════════
 *
 * Báo cáo QA nêu ví dụ `1,250,000` + `750.000` + `980000` trong cùng một cột và
 * gọi đó là "lẫn nhiều quy ước". Khi đi viết ca kiểm chứng thì đo được rằng
 * cách diễn đạt ấy bắt không đúng chỗ đau: `750.000` KHÔNG phải bằng chứng của
 * quy ước nào cả — nó nằm trong tập mơ hồ, còn `1,250,000` là bằng chứng kiểu
 * Anh rõ ràng. Nên theo luật "lẫn hai quy ước" thì cột này im lặng, đúng cái ta
 * muốn tránh.
 *
 * Chỗ đau THẬT là: có ô mơ hồ, và quy ước của cột không phải `'vn'`, nên
 * `parseNumber` đọc `750.000` thành 750. Đó chính là lỗi A1, chỉ khác là lần
 * này cách đọc ấy có thể ĐÚNG — cột có bằng chứng kiểu Anh thật. Hệ thống không
 * đoán hộ, nó NÓI RA con số nó sắp ghi vào kho.
 *
 * Cột kết luận được là `'vn'` thì không cảnh báo: ở đó `750.000` đã được đọc
 * thành 750.000 rồi, không còn gì để người dùng phải quyết.
 */
function canhBaoSoMoHo(
  sourceName: string,
  columnIndex: number,
  values: readonly string[],
): CanhBaoCotDto | null {
  if (doanQuyUocSo(values) === 'vn') return null;

  const moHo: string[] = [];
  for (const raw of values) {
    if (isBlank(raw)) continue;
    const s = raw.trim();
    if (laOMoHoPhanCach(s) && !moHo.includes(s)) moHo.push(s);
    if (moHo.length === SO_VI_DU) break;
  }
  if (moHo.length === 0) return null;

  const dau = moHo[0] ?? '';
  const doc = parseNumber(dau, doanQuyUocSo(values));
  // Con số NẾU người dùng nói dấu chấm là phân cách nghìn — xem trước của D2.
  // Tính ở đây bằng chính `parseNumber` để không có bản sao luật nào ở frontend.
  const docVn = parseNumber(dau, 'vn');

  const viet = (x: number | null): string => (x === null ? '' : x.toLocaleString('vi-VN'));

  return {
    columnIndex,
    sourceName,
    loai: 'so-mo-ho',
    viDu: moHo,
    // Con số THẬT sẽ vào kho, định dạng theo quy ước Việt để người dùng đối
    // chiếu được bằng mắt với ô trong tệp.
    docThanh: viet(doc),
    docThanhKhiVn: viet(docVn),
    ...(deuTronNghin(values) ? { goiYVn: true } : {}),
  };
}

/**
 * Mọi ô mơ hồ của cột đều kết thúc bằng `.000` — §B3.
 *
 * ═══ Vì sao một tín hiệu nữa, khi đã có `doanQuyUocSo` ════════════════════
 *
 * `doanQuyUocSo` trả `null` cho cột TOÀN ô mơ hồ, và `parseNumber(null)` đọc
 * `29.000` thành 29. Với một tệp của người Việt thì đó là sai 1000 lần, im
 * lặng: giá niêm yết 29.000 ₫ vào kho thành 29, và biểu đồ vẫn vẽ ra một hình
 * trông hợp lý. Đo được ngày 20/11/2026 trên một tệp danh mục sản phẩm.
 *
 * Nhưng KHÔNG thể đổi thẳng kết luận của `doanQuyUocSo`: cột `-288.765` /
 * `763.155` của Global-Superstore cũng toàn ô mơ hồ, và ở đó cách đọc thập
 * phân mới đúng. Hai cột cùng hình dạng, hai nghĩa — nên thứ phân biệt chúng
 * phải là một tín hiệu KHÁC, không phải một mặc định khác.
 *
 * Tín hiệu đó là đuôi `.000`. Một cột thập phân thật thì phần lẻ phải BIẾN
 * THIÊN (`.765`, `.155`, `.402`); một cột mà MỌI giá trị đều tròn nghìn chỉ là
 * một cột tiền viết theo lối Việt. Nó không đủ chắc để đổi cách đọc sau lưng
 * người dùng — nên nó chỉ đi ra giao diện để TÍCH SẴN ô chọn, nơi người dùng
 * nhìn thấy cả hai cách đọc rồi bấm.
 */
function deuTronNghin(values: readonly string[]): boolean {
  let co = false;
  for (const raw of values) {
    if (isBlank(raw)) continue;
    const s = raw.trim();
    if (!laOMoHoPhanCach(s)) continue;
    co = true;
    if (!s.endsWith('.000')) return false;
  }
  return co;
}
