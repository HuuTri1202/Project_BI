/**
 * Bộ ghi PDF CHỈ CHỨA ẢNH — mỗi trang một ảnh phủ kín trang.
 *
 * ═══ Vì sao tự ghi, không dùng jsPDF ═══════════════════════════════════════
 *
 * Thứ cần ghi ở đây hẹp đến mức cả định dạng rút lại còn vài đối tượng cố
 * định: danh mục, cây trang, thông tin tệp, và với mỗi trang một `Page`, một
 * luồng lệnh vẽ `cm … Do`, một `XObject` ảnh. jsPDF là vài trăm kB để làm chữ, font, bảng,
 * vector — không cái nào được dùng — và `addImage` của nó giải mã lại PNG bằng
 * JavaScript, chậm thấy rõ với một ảnh báo cáo 2800×4000 điểm ảnh.
 *
 * Ảnh ghi ở dạng RGB thô nén `FlateDecode` (zlib). Trình duyệt nén sẵn bằng
 * `CompressionStream('deflate')` — mã máy, không phải JS — và không mất chi
 * tiết như JPEG: chữ nhỏ trên trục và nét kẻ 1px vẫn sắc.
 *
 * ⚠️ Bảng `xref` ghi VỊ TRÍ BYTE của từng đối tượng. Mọi thứ vì vậy được dựng
 * thành các khối byte và đếm bằng `byteLength`, không bao giờ bằng độ dài chuỗi:
 * một ký tự ngoài ASCII lọt vào là lệch cả bảng, và trình đọc PDF sẽ báo tệp
 * hỏng hoặc lặng lẽ tự sửa.
 */

/** Một ảnh RGB 8 bit/kênh, đã nén zlib — xem `nenRgb` trong `chupBaoCao`. */
export interface AnhNen {
  rong: number;
  cao: number;
  duLieu: Uint8Array;
}

export interface TrangPdf {
  /** Kích thước trang tính bằng point (1/72 inch). */
  rongPt: number;
  caoPt: number;
  anh: AnhNen;
}

/**
 * Cạnh trang lớn nhất mà Acrobat chịu mở — 200 inch. Báo cáo dài hơn thì thu
 * nhỏ cả trang theo cùng tỉ lệ thay vì để trình đọc từ chối tệp.
 */
export const CANH_TRANG_TOI_DA_PT = 14_400;

/** Một điểm ảnh CSS là 1/96 inch, một point là 1/72 inch. */
export const PT_MOI_PX = 72 / 96;

const ma = new TextEncoder();

export function taoPdf(trangs: readonly TrangPdf[], tieuDe: string): Blob {
  if (trangs.length === 0) throw new Error('PDF phải có ít nhất một trang');

  const khoi: Uint8Array[] = [];
  const viTri: number[] = [];
  let dem = 0;

  const ghi = (phan: string | Uint8Array): void => {
    const b = typeof phan === 'string' ? ma.encode(phan) : phan;
    khoi.push(b);
    dem += b.byteLength;
  };
  const doiTuong = (so: number, noiDung: string): void => {
    viTri[so] = dem;
    ghi(`${so} 0 obj\n${noiDung}\nendobj\n`);
  };

  // Dòng thứ hai là bốn byte > 127: quy ước để công cụ truyền tệp nhận ra đây
  // là tệp nhị phân và không đổi ký tự xuống dòng bên trong.
  ghi('%PDF-1.4\n');
  ghi(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // 1 danh mục, 2 cây trang, 3 thông tin; mỗi trang thêm ba số liên tiếp.
  const soTrang = (i: number): number => 4 + i * 3;

  doiTuong(1, '<< /Type /Catalog /Pages 2 0 R >>');
  doiTuong(
    2,
    `<< /Type /Pages /Kids [${trangs.map((_, i) => `${soTrang(i)} 0 R`).join(' ')}] /Count ${trangs.length} >>`,
  );
  doiTuong(3, `<< /Title ${chuoiUtf16(tieuDe)} /Producer ${chuoiUtf16('Open Insight')} >>`);

  trangs.forEach((trang, i) => {
    const so = soTrang(i);
    const { rong, cao } = kichThuocTrang(trang);
    const w = soPdf(rong);
    const h = soPdf(cao);

    doiTuong(
      so,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${so + 2} 0 R >> >> /Contents ${so + 1} 0 R >>`,
    );

    // Ma trận `cm` kéo ảnh (vốn là hình vuông 1×1 đơn vị) ra phủ kín trang.
    const lenh = ma.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
    viTri[so + 1] = dem;
    ghi(`${so + 1} 0 obj\n<< /Length ${lenh.byteLength} >>\nstream\n`);
    ghi(lenh);
    ghi('\nendstream\nendobj\n');

    const { anh } = trang;
    viTri[so + 2] = dem;
    ghi(
      `${so + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${anh.rong} /Height ${anh.cao} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${anh.duLieu.byteLength} >>\nstream\n`,
    );
    ghi(anh.duLieu);
    ghi('\nendstream\nendobj\n');
  });

  const tongDoiTuong = soTrang(trangs.length);
  const batDauXref = dem;
  // Mỗi dòng của bảng dài ĐÚNG 20 byte, kể cả hai ký tự cuối dòng — nên là
  // " \n" chứ không phải "\n".
  const dong = ['0000000000 65535 f \n'];
  for (let so = 1; so < tongDoiTuong; so++) {
    dong.push(`${String(viTri[so]).padStart(10, '0')} 00000 n \n`);
  }
  ghi(`xref\n0 ${tongDoiTuong}\n${dong.join('')}`);
  ghi(
    `trailer\n<< /Size ${tongDoiTuong} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${batDauXref}\n%%EOF\n`,
  );

  return new Blob(khoi as BlobPart[], { type: 'application/pdf' });
}

/** Trang quá khổ thì thu cả hai chiều theo cùng một tỉ lệ. */
export function kichThuocTrang(trang: Pick<TrangPdf, 'rongPt' | 'caoPt'>): {
  rong: number;
  cao: number;
} {
  const k = Math.min(1, CANH_TRANG_TOI_DA_PT / Math.max(trang.rongPt, trang.caoPt));
  return { rong: trang.rongPt * k, cao: trang.caoPt * k };
}

/** PDF không đọc được số mũ (`1e-7`), và hai chữ số thập phân là thừa đủ. */
function soPdf(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Chuỗi văn bản của PDF ở dạng UTF-16BE có BOM, viết hex.
 *
 * Tên báo cáo là tiếng Việt. Chuỗi PDF thường chỉ hiểu bảng mã PDFDocEncoding —
 * "Doanh thu quý IV" sẽ thành ký tự rác trong ô Tiêu đề của trình đọc.
 */
export function chuoiUtf16(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) {
    hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}
