/**
 * Ghi tệp .xlsx bằng tay — không thêm thư viện nào.
 *
 * ═══ Vì sao TỰ VIẾT ═════════════════════════════════════════════════════════
 *
 * Cùng lập luận đã dùng cho `pdfAnh.ts`. `exceljs` nặng khoảng 900KB sau nén và
 * kéo theo cả một bộ đọc xlsx mà ta không cần — ta chỉ GHI, và chỉ ghi đúng một
 * hình dạng: vài sheet phẳng, một dòng tiêu đề, phần còn lại là chữ hoặc số.
 * Phần OOXML cần cho đúng bấy nhiêu là khoảng 60 dòng XML.
 *
 * Cái giá là ta tự chịu trách nhiệm sinh ra tệp Excel MỞ ĐƯỢC, và "trông có vẻ
 * đúng" không đủ — một byte sai trong thư mục trung tâm của ZIP thì Excel báo
 * "tệp bị hỏng" mà không nói ở đâu. Nên bộ test đọc NGƯỢC tệp vừa ghi bằng
 * `exceljs` (đã có sẵn ở backend, dùng được trong test) và so từng ô. Đọc được
 * bằng một bộ đọc thật thì Excel cũng mở được.
 *
 * ═══ .xlsx là một tệp ZIP ═══════════════════════════════════════════════════
 *
 * Bên trong có đúng những phần sau — không thừa phần nào:
 *
 *   [Content_Types].xml        khai kiểu cho từng phần
 *   _rels/.rels                gốc -> workbook
 *   xl/workbook.xml            danh sách sheet
 *   xl/_rels/workbook.xml.rels workbook -> từng sheet, và -> styles
 *   xl/styles.xml              đúng hai kiểu: thường và đậm (dòng tiêu đề)
 *   xl/worksheets/sheetN.xml   dữ liệu
 *
 * KHÔNG có `sharedStrings.xml`: chuỗi được ghi thẳng vào ô dạng `inlineStr`.
 * Bảng chuỗi dùng chung chỉ đáng khi cùng một chuỗi lặp lại rất nhiều lần, còn
 * nó thì thêm một phần nữa phải đánh số cho khớp — thêm một chỗ để sai.
 */

/** Một ô: chữ, số, hoặc trống. */
export type OTinh = string | number | null;

export interface Sheet {
  /** Tên tab trong Excel. Sẽ được làm sạch theo luật của Excel. */
  ten: string;
  /** Dòng tiêu đề. */
  cot: readonly string[];
  dong: readonly (readonly OTinh[])[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tên sheet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Luật của Excel, không phải luật của ta: tối đa 31 ký tự, và cấm : \ / ? * [ ]
 *
 * Vượt luật thì Excel từ chối mở cả tệp chứ không chỉ bỏ qua một tab — nên phải
 * cắt ở đây, không thể để người dùng đặt tên ô báo cáo quyết định.
 */
const CAM = /[:\\/?*[\]]/g;

export function tenSheetHopLe(ten: string, daDung: Set<string>): string {
  let s = ten.replace(CAM, ' ').replace(/\s+/g, ' ').trim();
  if (s === '') s = 'Sheet';
  s = s.slice(0, 31);

  // Trùng tên thì Excel cũng từ chối. Thêm hậu tố ' (2)', ' (3)'… và cắt lại cho
  // vừa 31 ký tự — cắt SAU khi nối thì hậu tố mới là thứ bị mất, tức lại trùng.
  if (!daDung.has(s)) {
    daDung.add(s);
    return s;
  }
  for (let i = 2; ; i += 1) {
    const hau = ` (${i})`;
    const thu = `${s.slice(0, 31 - hau.length)}${hau}`;
    if (!daDung.has(thu)) {
      daDung.add(thu);
      return thu;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// XML
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thoát ký tự cho XML, và BỎ ký tự điều khiển.
 *
 * `&`, `<`, `>` là bắt buộc. Nhưng thứ thật sự hay cắn là nhóm sau: dữ liệu thật
 * từ kho có thể mang ký tự điều khiển (một tệp CSV cũ, một trường bị dán nhầm),
 * và XML 1.0 KHÔNG cho phép chúng kể cả khi đã thoát bằng `&#x1;`. Excel sẽ báo
 * tệp hỏng. Bỏ đi là lựa chọn duy nhất còn lại.
 */
function xml(s: string): string {
  return (
    s
      // Cố ý khớp ký tự điều khiển — đó là toàn bộ việc của dòng này.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  );
}

/** 0 -> A, 25 -> Z, 26 -> AA. Excel đánh cột theo hệ 26 KHÔNG có chữ số 0. */
export function tenCot(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const du = (n - 1) % 26;
    s = String.fromCharCode(65 + du) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function o(cot: number, hang: number, v: OTinh, dam: boolean): string {
  const ref = `${tenCot(cot)}${hang}`;
  const style = dam ? ' s="1"' : '';

  if (v === null || v === '') return '';
  if (typeof v === 'number') {
    // NaN/Infinity không có cách biểu diễn nào trong ô số; ghi ra chuỗi còn hơn
    // sinh một tệp Excel từ chối mở.
    if (!Number.isFinite(v)) {
      return `<c r="${ref}"${style} t="inlineStr"><is><t>${xml(String(v))}</t></is></c>`;
    }
    return `<c r="${ref}"${style}><v>${v}</v></c>`;
  }
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
}

function sheetXml(s: Sheet): string {
  const hang: string[] = [];

  hang.push(`<row r="1">${s.cot.map((c, i) => o(i, 1, c, true)).join('')}</row>`);
  s.dong.forEach((d, i) => {
    const r = i + 2;
    hang.push(`<row r="${r}">${d.map((v, c) => o(c, r, v, false)).join('')}</row>`);
  });

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    // Đóng băng dòng tiêu đề: bảng vài trăm dòng mà cuộn xuống là mất tên cột.
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetData>${hang.join('')}</sheetData>` +
    `</worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
  `<borders count="1"><border/></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  // xf 0 = thường, xf 1 = đậm. `o()` ở trên dùng s="1" cho dòng tiêu đề.
  `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

// ─────────────────────────────────────────────────────────────────────────────
// ZIP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bảng CRC-32 (đa thức đảo 0xEDB88320) — ZIP bắt buộc có, không bỏ qua được.
 *
 * Dựng một lần lúc nạp module: 256 phần tử, rẻ hơn nhiều so với tính lại cho
 * từng byte của từng tệp.
 */
const BANG_CRC = (() => {
  const b = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    b[i] = c >>> 0;
  }
  return b;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c = BANG_CRC[(c ^ (data[i] as number)) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface PhanZip {
  ten: string;
  tho: Uint8Array;
  nen: Uint8Array;
  crc: number;
  /** 8 = deflate, 0 = để nguyên. */
  pp: number;
}

/**
 * Nén raw deflate — ĐÚNG thứ ZIP cần, khác với `deflate` của `pdfAnh.ts`.
 *
 * `CompressionStream('deflate')` gói thêm 2 byte đầu và 4 byte Adler-32 cuối
 * theo zlib (RFC 1950); PDF cần đúng dạng đó cho `/FlateDecode`. ZIP phương
 * thức 8 thì cần deflate TRẦN (RFC 1951) — đưa nhầm bản zlib vào thì Excel báo
 * tệp hỏng. Hai chỗ trong cùng repo cần hai dạng khác nhau của cùng một thuật
 * toán, nên chỗ này ghi rõ ra.
 *
 * Trình duyệt không có `deflate-raw` thì rơi về "để nguyên" (phương thức 0) —
 * tệp to hơn nhưng vẫn mở được. Không bao giờ đánh đổi tệp mở được lấy dung
 * lượng.
 */
async function nenRaw(tho: Uint8Array): Promise<{ nen: Uint8Array; pp: number }> {
  if (typeof CompressionStream !== 'function') return { nen: tho, pp: 0 };
  try {
    const cs = new CompressionStream('deflate-raw');
    const buf = await new Response(
      new Blob([tho as BlobPart]).stream().pipeThrough(cs),
    ).arrayBuffer();
    return { nen: new Uint8Array(buf), pp: 8 };
  } catch {
    return { nen: tho, pp: 0 };
  }
}

function ghiSo(v: DataView, o: number, gt: number, byte: 2 | 4): void {
  if (byte === 2) v.setUint16(o, gt, true);
  else v.setUint32(o, gt, true);
}

/**
 * Gói các phần thành một tệp ZIP.
 *
 * Bố cục: [local header + dữ liệu] × n, rồi [central directory] × n, rồi EOCD.
 * `offset` trong central directory phải là vị trí BYTE của local header tương
 * ứng — sai một byte ở đây là "tệp bị hỏng", nên vị trí được ghi lại trong lúc
 * xếp chứ không tính lại sau.
 */
function dongGoiZip(phan: readonly PhanZip[]): Blob {
  const te = new TextEncoder();
  const khuc: BlobPart[] = [];
  const viTri: number[] = [];
  let o = 0;

  for (const p of phan) {
    const ten = te.encode(p.ten);
    viTri.push(o);

    const h = new Uint8Array(30 + ten.length);
    const v = new DataView(h.buffer);
    ghiSo(v, 0, 0x04034b50, 4); // chữ ký local header
    ghiSo(v, 4, 20, 2); // cần phiên bản 2.0
    ghiSo(v, 6, 0x0800, 2); // cờ: tên tệp là UTF-8
    ghiSo(v, 8, p.pp, 2);
    ghiSo(v, 10, 0, 2); // giờ — cố định để hai lần xuất cùng dữ liệu ra cùng byte
    ghiSo(v, 12, 0x21, 2); // ngày: 1980-01-01, giá trị nhỏ nhất ZIP cho phép
    ghiSo(v, 14, p.crc, 4);
    ghiSo(v, 18, p.nen.length, 4);
    ghiSo(v, 22, p.tho.length, 4);
    ghiSo(v, 26, ten.length, 2);
    ghiSo(v, 28, 0, 2);
    h.set(ten, 30);

    khuc.push(h as BlobPart, p.nen as BlobPart);
    o += h.length + p.nen.length;
  }

  const batDauCD = o;
  for (let i = 0; i < phan.length; i += 1) {
    const p = phan[i] as PhanZip;
    const ten = te.encode(p.ten);
    const c = new Uint8Array(46 + ten.length);
    const v = new DataView(c.buffer);
    ghiSo(v, 0, 0x02014b50, 4);
    ghiSo(v, 4, 20, 2);
    ghiSo(v, 6, 20, 2);
    ghiSo(v, 8, 0x0800, 2);
    ghiSo(v, 10, p.pp, 2);
    ghiSo(v, 12, 0, 2);
    ghiSo(v, 14, 0x21, 2);
    ghiSo(v, 16, p.crc, 4);
    ghiSo(v, 20, p.nen.length, 4);
    ghiSo(v, 24, p.tho.length, 4);
    ghiSo(v, 28, ten.length, 2);
    ghiSo(v, 30, 0, 2);
    ghiSo(v, 32, 0, 2);
    ghiSo(v, 34, 0, 2);
    ghiSo(v, 36, 0, 2);
    ghiSo(v, 38, 0, 4);
    ghiSo(v, 42, viTri[i] as number, 4);
    c.set(ten, 46);
    khuc.push(c as BlobPart);
    o += c.length;
  }

  const eocd = new Uint8Array(22);
  const v = new DataView(eocd.buffer);
  ghiSo(v, 0, 0x06054b50, 4);
  ghiSo(v, 8, phan.length, 2);
  ghiSo(v, 10, phan.length, 2);
  ghiSo(v, 12, o - batDauCD, 4);
  ghiSo(v, 16, batDauCD, 4);
  khuc.push(eocd as BlobPart);

  return new Blob(khuc, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cửa duy nhất
// ─────────────────────────────────────────────────────────────────────────────

export async function taoXlsx(sheets: readonly Sheet[]): Promise<Blob> {
  if (sheets.length === 0) {
    // Excel từ chối một workbook không có sheet nào. Ném ở đây, nơi còn nói được
    // lý do, thay vì giao cho người dùng một tệp không mở được.
    throw new Error('Không có dữ liệu nào để xuất.');
  }

  const te = new TextEncoder();
  const tep: { ten: string; noiDung: string }[] = [];

  const idSheet = sheets.map((_, i) => i + 1);

  tep.push({
    ten: '[Content_Types].xml',
    noiDung:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      idSheet
        .map(
          (n) =>
            `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('') +
      `</Types>`,
  });

  tep.push({
    ten: '_rels/.rels',
    noiDung:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  });

  const daDung = new Set<string>();
  const tenThat = sheets.map((s) => tenSheetHopLe(s.ten, daDung));

  tep.push({
    ten: 'xl/workbook.xml',
    noiDung:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
      tenThat
        .map((t, i) => `<sheet name="${xml(t)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('') +
      `</sheets></workbook>`,
  });

  tep.push({
    ten: 'xl/_rels/workbook.xml.rels',
    noiDung:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      idSheet
        .map(
          (n) =>
            `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`,
        )
        .join('') +
      // Styles lấy id NGAY SAU các sheet — trùng id với một sheet thì workbook
      // trỏ nhầm và Excel báo hỏng.
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  });

  tep.push({ ten: 'xl/styles.xml', noiDung: STYLES_XML });

  sheets.forEach((s, i) => {
    tep.push({ ten: `xl/worksheets/sheet${i + 1}.xml`, noiDung: sheetXml(s) });
  });

  const phan: PhanZip[] = [];
  for (const t of tep) {
    const tho = te.encode(t.noiDung);
    const { nen, pp } = await nenRaw(tho);
    phan.push({ ten: t.ten, tho, nen, crc: crc32(tho), pp });
  }

  return dongGoiZip(phan);
}
