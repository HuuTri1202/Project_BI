// @vitest-environment node
import { deflateSync, inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  CANH_TRANG_TOI_DA_PT,
  chuoiUtf16,
  kichThuocTrang,
  taoPdf,
  type TrangPdf,
} from '../src/features/reports/export/pdfAnh';

/**
 * Bộ ghi PDF chỉ chứa ảnh — xem `pdfAnh.ts`.
 *
 * Tệp PDF sai một byte trong bảng `xref` vẫn MỞ được ở nhiều trình đọc (chúng
 * tự quét lại tệp), nên "mở thử thấy được" không chứng minh gì. Các ca dưới đây
 * đọc lại tệp như một trình đọc khắt khe: theo `startxref` tới bảng, theo từng
 * dòng của bảng tới đúng byte bắt đầu đối tượng.
 */

function anh(rong: number, cao: number, mau: number): TrangPdf['anh'] {
  const rgb = new Uint8Array(rong * cao * 3).fill(mau);
  return { rong, cao, duLieu: new Uint8Array(deflateSync(rgb)) };
}

async function doc(blob: Blob): Promise<{ buf: Buffer; s: string }> {
  const buf = Buffer.from(await blob.arrayBuffer());
  // latin1: một ký tự cho mỗi byte, nên chỉ số chuỗi = vị trí byte.
  return { buf, s: buf.toString('latin1') };
}

function bangXref(s: string): number[] {
  const m = s.match(/startxref\n(\d+)\n%%EOF\n$/);
  expect(m).not.toBeNull();
  const batDau = Number(m?.[1]);
  expect(s.startsWith('xref\n', batDau)).toBe(true);

  const dau = s.slice(batDau).match(/^xref\n0 (\d+)\n/);
  const n = Number(dau?.[1]);
  const than = s.slice(batDau + (dau?.[0].length ?? 0));
  return Array.from({ length: n }, (_, i) => {
    const dong = than.slice(i * 20, i * 20 + 20);
    // Mỗi dòng ĐÚNG 20 byte — thiếu khoảng trắng trước "\n" là lệch cả bảng.
    expect(dong).toMatch(/^\d{10} \d{5} [fn] \n$/);
    return Number(dong.slice(0, 10));
  });
}

describe('taoPdf', () => {
  const trangs: TrangPdf[] = [
    { rongPt: 600, caoPt: 400, anh: anh(8, 4, 200) },
    { rongPt: 300.456, caoPt: 900, anh: anh(3, 9, 17) },
  ];

  it('mọi dòng của bảng xref trỏ ĐÚNG byte đầu đối tượng của nó', async () => {
    const { s } = await doc(taoPdf(trangs, 'Báo cáo'));

    expect(s.startsWith('%PDF-1.4\n')).toBe(true);
    const viTri = bangXref(s);
    // 3 đối tượng chung + 3 cho mỗi trang, cộng dòng số 0.
    expect(viTri).toHaveLength(1 + 3 + 3 * trangs.length);
    viTri.slice(1).forEach((o, i) => expect(s.startsWith(`${i + 1} 0 obj\n`, o)).toBe(true));
    expect(s).toMatch(/trailer\n<< \/Size 10 \/Root 1 0 R \/Info 3 0 R >>/);
  });

  it('cây trang đếm đúng, mỗi trang đúng cỡ và vẽ ảnh phủ kín trang', async () => {
    const { s } = await doc(taoPdf(trangs, 'x'));

    expect(s).toContain('<< /Type /Pages /Kids [4 0 R 7 0 R] /Count 2 >>');
    expect(s).toContain('/MediaBox [0 0 600 400]');
    // Hai chữ số thập phân, không bao giờ ở dạng số mũ.
    expect(s).toContain('/MediaBox [0 0 300.46 900]');
    expect(s).toContain('q 600 0 0 400 0 0 cm /Im0 Do Q');
  });

  it('luồng ảnh dài ĐÚNG /Length và giải nén ra đúng điểm ảnh RGB', async () => {
    const { buf, s } = await doc(taoPdf(trangs, 'x'));

    const anhs = [...s.matchAll(/\/Width (\d+) \/Height (\d+) .*?\/Length (\d+) >>\nstream\n/g)];
    expect(anhs).toHaveLength(2);
    anhs.forEach((m, i) => {
      const [rong, cao, dai] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const batDau = (m.index ?? 0) + m[0].length;
      expect(s.startsWith('\nendstream\n', batDau + dai)).toBe(true);

      const rgb = inflateSync(buf.subarray(batDau, batDau + dai));
      expect(rgb.length).toBe(rong * cao * 3);
      expect(rgb.every((b) => b === (i === 0 ? 200 : 17))).toBe(true);
    });
  });

  it('tiêu đề tiếng Việt ghi dạng UTF-16BE, đọc ngược lại ra nguyên văn', async () => {
    const ten = 'Doanh thu quý IV / miền Bắc';
    const { s } = await doc(taoPdf(trangs, ten));

    const hex = s.match(/\/Title <([0-9A-F]+)>/)?.[1] ?? '';
    expect(hex.startsWith('FEFF')).toBe(true);
    const doc16 = Buffer.from(hex.slice(4), 'hex').swap16().toString('utf16le');
    expect(doc16).toBe(ten);
  });

  it('không có trang nào thì từ chối, không ghi ra một tệp hỏng', () => {
    expect(() => taoPdf([], 'x')).toThrow();
  });
});

describe('kichThuocTrang', () => {
  it('trang bình thường giữ nguyên cỡ', () => {
    expect(kichThuocTrang({ rongPt: 1092, caoPt: 618 })).toEqual({ rong: 1092, cao: 618 });
  });

  it('báo cáo quá dài thu cả hai chiều theo CÙNG tỉ lệ về giới hạn của Acrobat', () => {
    const { rong, cao } = kichThuocTrang({ rongPt: 1000, caoPt: 28_800 });
    expect(cao).toBe(CANH_TRANG_TOI_DA_PT);
    expect(rong).toBe(500);
  });
});

describe('chuoiUtf16', () => {
  it('có BOM và mỗi ký tự đúng bốn chữ số hex', () => {
    expect(chuoiUtf16('Aý')).toBe('<FEFF004100FD>');
  });
});
