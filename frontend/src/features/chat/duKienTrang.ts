import type { DataModelDetailDto, DatasetDetailDto, DatasetDto } from '@bi/shared';

import { dinhDangDungLuong } from '../billing/format';
import type { DuKien, Nguon } from './nguCanh';

/**
 * Chuyển DTO của từng trang thành dữ kiện hỏi được.
 *
 * ═══ Vì sao gộp ba hàm vào một file ════════════════════════════════════════
 *
 * Chúng là ba phép ánh xạ THUẦN từ DTO sang `Nguon[]` — không state, không
 * hook, không gọi gì. Để cùng chỗ thì chúng test được bằng một file test không
 * cần DOM, và người sửa thấy ngay ba trang đang hứa những gì để mà giữ cho
 * chúng nói cùng một kiểu. Thêm trang mới = thêm một hàm ở đây.
 *
 * ═══ Luật chung: con số nào có ĐIỀU KIỆN thì mang `luuY` ═══════════════════
 *
 * Mỗi lần một hàm ở đây in ra một con số mà con số đó chưa phải toàn bộ sự
 * thật, nó PHẢI nói ra điều kiện. Màn hình còn có chỗ hiện cảnh báo bên cạnh;
 * một câu trả lời thì chỉ có chính nó.
 */

/** Trạng thái nạp kho, đọc thành câu người dùng hiểu. */
function docTrangThaiNap(ds: DatasetDto): string {
  switch (ds.loadStatus) {
    case 'loaded':
      return `đã nạp vào kho phân tích (${ds.loadedRowCount.toLocaleString('vi-VN')} dòng)`;
    case 'queued':
      return 'đang chờ nạp vào kho phân tích';
    case 'running':
      return 'đang nạp vào kho phân tích';
    case 'failed':
      return 'nạp vào kho phân tích thất bại';
    default:
      return 'chưa nạp vào kho phân tích';
  }
}

/** Một câu nói bộ dữ liệu này từ đâu ra. */
function docNguon(ds: DatasetDto): string {
  if (ds.source === 'file') {
    const ten = ds.originalFilename ?? 'một tệp đã tải lên';
    return ds.sheetName === null ? ten : `${ten}, sheet "${ds.sheetName}"`;
  }
  const bang = [ds.sourceSchema, ds.sourceTable].filter((x) => x !== null).join('.');
  return ds.connectionName === null ? bang : `bảng ${bang} qua kết nối "${ds.connectionName}"`;
}

/** Dữ kiện chung cho cả trang danh sách và trang chi tiết của một bộ dữ liệu. */
function duKienChung(ds: DatasetDto): DuKien[] {
  const d: DuKien[] = [
    {
      nhan: `Số dòng của ${ds.name}`,
      gia: ds.rowCount.toLocaleString('vi-VN'),
      /*
       * ⚠️ `truncated` bật nghĩa là tệp đã bị cắt khi tải lên, và `rowCount` chỉ
       * là số dòng ĐÃ ĐỌC. Doc comment của chính DTO nói thẳng rằng con số đó
       * một mình "nói dối". Bỏ `luuY` ở đây là nói dối to hơn màn hình, vì màn
       * hình còn hiện một cảnh báo ngay cạnh con số.
       */
      ...(ds.truncated ? { luuY: 'tệp đã bị cắt khi tải lên nên đây chưa phải toàn bộ' } : {}),
    },
    { nhan: `Số cột của ${ds.name}`, gia: String(ds.columnCount) },
    { nhan: `Nguồn gốc của ${ds.name}`, gia: docNguon(ds) },
    { nhan: `Trạng thái của ${ds.name}`, gia: docTrangThaiNap(ds) },
    { nhan: `Số mô hình dữ liệu dùng ${ds.name}`, gia: String(ds.datamodelCount) },
  ];

  if (ds.source === 'file') {
    d.push({ nhan: `Dung lượng tệp của ${ds.name}`, gia: dinhDangDungLuong(ds.fileSizeBytes) });
    if (ds.originalFilename !== null) {
      d.push({ nhan: `Tên tệp gốc của ${ds.name}`, gia: ds.originalFilename });
    }
  }
  return d;
}

/** Trang Kho dữ liệu — mỗi bộ dữ liệu trong danh sách là một nguồn. */
export function duKienKhoDuLieu(ds: DatasetDto[]): Nguon[] {
  return ds.map((d) => ({ ten: d.name, duKien: duKienChung(d) }));
}

/**
 * Trang chi tiết một bộ dữ liệu — có thêm KIỂU của từng cột.
 *
 * Đây là thứ trang danh sách không có: ở đó chỉ có `columnCount`. Nên câu "cột
 * X kiểu gì" chỉ trả lời được ở trang này, và ở trang danh sách khung sẽ nói
 * "chưa hiểu" thay vì đoán — xem luật hai-dữ-kiện-bằng-điểm trong `traLoi`.
 */
export function duKienChiTietDataset(ds: DatasetDetailDto): Nguon[] {
  const d = duKienChung(ds);

  for (const c of ds.columns) {
    // Kiểu NGUỒN và kiểu NGỮ NGHĨA là hai chuyện: `varchar(255)` là cái
    // ClickHouse/MySQL lưu, còn `text`/`number`/`date` là cách hệ thống hiểu nó.
    // Người hỏi "cột này kiểu gì" thường cần cả hai.
    const kieu = c.semanticType === null ? c.dataType : `${c.dataType} (${c.semanticType})`;
    d.push({ nhan: `Kiểu dữ liệu của cột ${c.name}`, gia: kieu });
  }

  if (ds.file !== null) {
    d.push({
      nhan: `Tệp của ${ds.name} nằm ở đâu`,
      gia: `bucket ${ds.file.bucket}, khoá ${ds.file.key}`,
      // Một tệp Excel 4 sheet sinh ra 4 bộ dữ liệu trỏ vào CÙNG một object.
      // Không nói ra thì người đọc tưởng xoá khoá đó là xoá đúng bộ này.
      luuY: 'nhiều bộ dữ liệu có thể dùng chung một tệp (mỗi sheet một bộ)',
    });
  }

  return [{ ten: ds.name, duKien: d }];
}

/**
 * Trang Mô hình dữ liệu — mỗi BẢNG trong mô hình là một nguồn, cộng một nguồn
 * cho chính mô hình.
 *
 * Câu "mô hình này dựng từ tệp nào" trả lời được nhờ `source`/`originalFilename`
 * vừa thêm vào `DataModelDatasetDto`. Trước đó DTO chỉ có `datasetName` —
 * tên người dùng đặt, không dính gì tới tệp.
 */
export function duKienMoHinh(m: DataModelDetailDto): Nguon[] {
  const tenBang = (i: number): string => {
    const ds = m.datasets[i];
    return ds === undefined ? '' : (ds.displayName ?? ds.datasetName);
  };

  const chung: DuKien[] = [
    { nhan: `Số bảng trong mô hình ${m.name}`, gia: String(m.datasets.length) },
    { nhan: `Số thước đo của mô hình ${m.name}`, gia: String(m.measures.length) },
    { nhan: `Số quan hệ của mô hình ${m.name}`, gia: String(m.relationships.length) },
    {
      nhan: `Mô hình ${m.name} dựng từ tệp nào`,
      gia:
        m.datasets
          .map((ds) =>
            ds.source === 'file'
              ? (ds.originalFilename ?? ds.datasetName)
              : `${[ds.sourceSchema, ds.sourceTable].filter((x) => x !== null).join('.')}${
                  ds.connectionName === null ? '' : ` (kết nối "${ds.connectionName}")`
                }`,
          )
          .join('; ') || 'mô hình này chưa có bảng nào',
    },
    {
      nhan: `Các bảng trong mô hình ${m.name}`,
      gia: m.datasets.map((_, i) => tenBang(i)).join('; ') || 'chưa có bảng nào',
    },
    { nhan: `Người tạo mô hình ${m.name}`, gia: m.creatorName ?? 'không rõ' },
  ];

  if (m.measures.length > 0) {
    chung.push({
      nhan: `Danh sách thước đo của mô hình ${m.name}`,
      gia: m.measures.map((me) => `${me.name} (${me.agg})`).join('; '),
    });
  }

  const bang: Nguon[] = m.datasets.map((ds) => {
    const ten = ds.displayName ?? ds.datasetName;
    const d: DuKien[] = [
      {
        nhan: `Bảng ${ten} dựng từ đâu`,
        gia:
          ds.source === 'file'
            ? `tệp ${ds.originalFilename ?? ds.datasetName}`
            : `bảng ${[ds.sourceSchema, ds.sourceTable].filter((x) => x !== null).join('.')}${
                ds.connectionName === null ? '' : ` qua kết nối "${ds.connectionName}"`
              }`,
      },
      { nhan: `Số cột của bảng ${ten}`, gia: String(ds.columns.length) },
      { nhan: `Bảng ${ten} nằm ở đâu trong kho phân tích`, gia: ds.chTable },
      {
        nhan: `Bộ dữ liệu gốc của bảng ${ten}`,
        gia: ds.datasetName,
        ...(ds.displayName === null
          ? {}
          : { luuY: `trong mô hình này nó được đổi tên thành "${ds.displayName}"` }),
      },
    ];

    for (const c of ds.columns) {
      const nhanCot = c.alias ?? c.columnName;
      d.push({
        nhan: `Kiểu dữ liệu của cột ${nhanCot} trong bảng ${ten}`,
        gia: `${c.chType} — dùng làm ${c.role === 'measure' ? 'thước đo' : 'chiều'}`,
        // `typeChanged` = kiểu bên ClickHouse đã đổi từ lúc mô hình được dựng.
        // Số liệu vẫn chạy, nhưng con số có thể không còn nghĩa như cũ.
        ...(c.typeChanged ? { luuY: 'kiểu ở kho phân tích đã đổi từ khi mô hình được dựng' } : {}),
      });
    }

    return { ten, duKien: d };
  });

  return [{ ten: `Mô hình ${m.name}`, duKien: chung }, ...bang];
}
