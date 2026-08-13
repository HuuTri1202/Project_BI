import {
  DATASET_ERROR_CODES,
  type FileExt,
  type SemanticType,
} from '@bi/shared';

import { withTransaction } from '../../db/tx';
import * as datasetsRepo from '../../repositories/datasets';
import { HttpError } from '../../utils/httpError';
import { analyzeDataset } from './analyze';
import {
  defaultFieldName,
  defaultFieldRole,
  inferColumnType,
  parseNumber,
} from './inferType';
import type { ParsedSheet } from './parseFile';

/** Chỉ đoán trên vài trăm ô đầu — đọc hết 50.000 dòng chỉ để đoán là phí. */
const SAMPLE_ROWS = 200;

/**
 * Chốt các sheet đã tích và nạp dữ liệu — §7.5 → §7.6.
 *
 * ─── Mỗi sheet là MỘT bộ dữ liệu ────────────────────────────────────────────
 *
 * Người dùng tích N sheet, hệ thống sinh N bản ghi `datasets`, tất cả cùng trỏ
 * vào MỘT object trên S3 (migration 7 gỡ ràng buộc UNIQUE trên `s3_key` để việc
 * đó khả thi).
 *
 * Bản ghi `pending` sinh ra lúc xin presigned URL được DÙNG LẠI cho sheet đầu
 * tiên, không tạo mới rồi bỏ nó lại làm rác.
 *
 * ─── Không còn bước chọn cột ────────────────────────────────────────────────
 *
 * Bản cập nhật của §7.5 bỏ hẳn phần chọn cột và mapping: mọi cột đều được nhập,
 * tên field lấy từ tiêu đề cột đã làm sạch, kiểu do `inferColumnType` suy ra.
 *
 * Đánh đổi đã biết: kiểu đoán sai thì người dùng không sửa được ngay tại wizard.
 * Với cột toàn chữ số, `looksLikeNumber` cố ý từ chối số có 0 đứng đầu nên mã
 * bưu chính và mã sản phẩm vẫn an toàn — nhưng một màn hình sửa lại kiểu ở trang
 * chi tiết bộ dữ liệu là việc còn NỢ.
 */

export interface CommitInput {
  /** Bản ghi `pending` sinh ra lúc xin presigned URL. */
  datasetId: number;
  tenantId: number;
  workspaceId: number;
  s3Key: string;
  ext: FileExt;
  /**
   * Tên file NGƯỜI DÙNG tải lên — dùng chung cho mọi bộ dữ liệu sinh ra từ nó.
   *
   * Phải truyền vào chứ không suy từ sheet: N bộ dữ liệu này đều đến từ MỘT
   * file, và cột "File gốc" ở §7.8 phải nói được người dùng đã tải cái gì lên.
   */
  originalFilename: string;
  createdBy: number;
  /** Tên gốc; nhiều sheet thì nối thêm tên sheet cho phân biệt được. */
  name: string;
  sheetNames: readonly string[];
}

export interface CommittedDataset {
  id: number;
  sheetName: string;
}

export async function commitDatasets(input: CommitInput): Promise<CommittedDataset[]> {
  if (input.sheetNames.length === 0) {
    throw new HttpError(
      400,
      DATASET_ERROR_CODES.NO_COLUMNS_SELECTED,
      'Hãy chọn ít nhất một sheet để nhập.',
    );
  }

  // Dùng lại kết quả đã cache từ bước `analyze`: người dùng vừa xem xong bảng
  // preview cách đây vài giây nên gần như luôn trúng cache. Trượt thì hàm này tự
  // tải và parse lại, không phải xử lý gì thêm ở đây.
  const analyzed = await analyzeDataset(input.datasetId, input.s3Key, input.ext);

  const sheets = input.sheetNames.map((name) => {
    const found = analyzed.sheets.find((s) => s.name === name);
    if (!found) {
      // Xảy ra khi wizard mở qua đêm, cache hết hạn, và file bị thay bằng file
      // khác. Hiếm, nhưng thông báo phải nói đúng chuyện gì xảy ra.
      throw new HttpError(
        400,
        DATASET_ERROR_CODES.CORRUPT_FILE,
        `Không tìm thấy sheet "${name}" trong file.`,
      );
    }
    return found;
  });

  const multi = sheets.length > 1;

  // MỘT transaction cho tất cả: nửa chừng mà hỏng thì để lại vài dataset ở trạng
  // thái `ready` và vài cái còn `pending`, trong khi người dùng tin rằng cả lô
  // đã vào. Hoặc tất cả, hoặc không.
  return withTransaction(async (conn) => {
    const created: CommittedDataset[] = [];

    for (const [index, sheet] of sheets.entries()) {
      const columns = buildColumns(sheet);
      const rows = buildRows(sheet, columns);
      const name = multi ? `${input.name} · ${sheet.name}` : input.name;

      // Sheet đầu tiên dùng lại bản ghi `pending`; những sheet sau tạo mới, cùng
      // trỏ vào một `s3_key`.
      const datasetId =
        index === 0
          ? input.datasetId
          : await datasetsRepo.createFileDataset(conn, input.tenantId, {
              workspaceId: input.workspaceId,
              name,
              originalFilename: input.originalFilename,
              fileExt: input.ext,
              s3Key: input.s3Key,
              createdBy: input.createdBy,
            });

      await datasetsRepo.replaceColumns(conn, datasetId, columns);
      await datasetsRepo.replaceRows(conn, datasetId, rows);
      await datasetsRepo.markReady(conn, datasetId, {
        name,
        sheetName: sheet.name,
        rowCount: rows.length,
        columnCount: columns.length,
        truncated: analyzed.result.truncated,
        fileSize: analyzed.fileSize,
      });

      created.push({ id: datasetId, sheetName: sheet.name });
    }

    return created;
  });
}

/**
 * Mọi cột của sheet đều được nhập, kiểu và vai trò suy ra từ nội dung.
 *
 * Cột trùng tên được đánh số cho khác nhau: khoá của document JSON là
 * `fieldName`, nên hai cột cùng tên thì cột sau đè cột trước và dữ liệu biến mất
 * trong im lặng. File thật rất hay có hai cột "Ghi chú".
 */
function buildColumns(sheet: ParsedSheet): datasetsRepo.ColumnInput[] {
  const used = new Set<string>();

  return sheet.header.map((sourceName, columnIndex) => {
    const values = sheet.rows.slice(0, SAMPLE_ROWS).map((row) => row[columnIndex] ?? '');
    const semanticType = inferColumnType(values);

    let fieldName = defaultFieldName(sourceName, columnIndex);
    if (used.has(fieldName)) {
      let suffix = 2;
      while (used.has(`${fieldName} (${suffix})`)) suffix += 1;
      fieldName = `${fieldName} (${suffix})`;
    }
    used.add(fieldName);

    return {
      // `name`/`ordinal`/`dataType` là những trường DÙNG CHUNG với nguồn
      // `connection`: ở đó chúng là tên cột và kiểu do CSDL khai báo, ở đây là
      // tiêu đề trong file và kiểu ta suy ra. Cùng một ý nghĩa, nên cùng một cột.
      name: sourceName,
      ordinal: columnIndex,
      dataType: semanticType,
      // Ô trống trong file là chuyện thường, nên mọi cột đều cho phép null.
      isNullable: true,
      fieldName,
      semanticType,
      fieldRole: defaultFieldRole(semanticType),
      included: true,
    };
  });
}

/**
 * Chuyển bảng chuỗi thành các document JSON, khoá là TÊN FIELD.
 *
 * Dùng `fieldName` chứ không phải `sourceName`: biểu đồ, cấu hình báo cáo và
 * nhãn trục đều nói bằng ngôn ngữ người dùng. Lưu theo tên cột gốc rồi dịch mỗi
 * lần đọc là thêm một phép ánh xạ ở mọi nơi chạm tới dữ liệu.
 *
 * ─── Giá trị được chuẩn hoá theo kiểu, không lưu chuỗi thô ──────────────────
 *
 * Cột số lưu thành số JSON. Lưu chuỗi thì mỗi lần vẽ biểu đồ phải parse lại
 * 50.000 lần, và tệ hơn: `'10' > '9'` là `false` trong so sánh chuỗi, nên mọi
 * phép sắp xếp và min/max đều sai theo cách trông rất hợp lý.
 */
function buildRows(
  sheet: ParsedSheet,
  columns: readonly datasetsRepo.ColumnInput[],
): Record<string, unknown>[] {
  return sheet.rows.map((row) => {
    const doc: Record<string, unknown> = {};
    for (const column of columns) {
      // `fieldName`/`semanticType` là tuỳ chọn trên `ColumnInput` vì nguồn
      // `connection` không điền; `buildColumns` luôn điền cả hai.
      doc[column.fieldName ?? column.name] = normalize(
        row[column.ordinal] ?? '',
        column.semanticType ?? 'text',
      );
    }
    return doc;
  });
}

function normalize(raw: string, semanticType: SemanticType): unknown {
  const trimmed = raw.trim();
  // Ô trống lưu thành `null` chứ không phải chuỗi rỗng: `null` phân biệt được
  // với "giá trị là chuỗi rỗng", và `aggregate` bỏ qua nó đúng cách.
  if (trimmed === '') return null;

  switch (semanticType) {
    case 'number':
      return parseNumber(trimmed);
    case 'boolean':
      return ['true', 'yes', 'có', 'x'].includes(trimmed.toLowerCase());
    case 'date':
    case 'text':
      return trimmed;
  }
}
