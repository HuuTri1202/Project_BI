import { DATASET_ERROR_CODES, type AnalyzeResultDto, type FileExt } from '@bi/shared';

import { env } from '../../config/env';
import { redis } from '../../config/redis';
import { storage } from '../../storage';
import { HttpError } from '../../utils/httpError';
import { checkFormat } from './detectFormat';
import { PREVIEW_ROWS, ParseError, parseFile, toPreview, type ParsedSheet } from './parseFile';

/**
 * Phân tích file đã tải lên và trả về schema — bước 1 → 2 của wizard (§7.5).
 *
 * KHÔNG ghi gì vào database. Người dùng còn đang xem, đổi sheet, bỏ chọn cột —
 * nạp dữ liệu ở đây nghĩa là mỗi lần họ đổi ý là một lần ghi rồi xoá 50.000
 * dòng. Việc ghi để dành cho `commit`.
 *
 * ─── Vì sao cache vào Redis ─────────────────────────────────────────────────
 *
 * Bước 2 cho đổi sheet, và mỗi lần đổi mà không cache là một lần tải lại file
 * 50MB từ S3 rồi parse lại từ đầu. Cache 30 phút, khoá theo `datasetId`.
 *
 * Cache chứa dữ liệu nghiệp vụ của người dùng, nên khoá phải mang `datasetId` —
 * thứ đã được kiểm `tenant_id` trước khi hàm này được gọi. Không bao giờ dùng
 * một khoá do client đặt tên.
 */

/** 30 phút — dài hơn thời gian một người ngồi làm xong wizard, ngắn hơn một ca làm việc. */
const CACHE_TTL_SECONDS = 30 * 60;

const cacheKey = (datasetId: number): string => `dataset:analyze:${datasetId}`;

export interface AnalyzeOutput {
  result: AnalyzeResultDto;
  /** Bảng đã parse, dùng lại ở `commit` mà không phải tải file lần nữa. */
  sheets: ParsedSheet[];
  fileSize: number;
}

export async function analyzeDataset(
  datasetId: number,
  s3Key: string,
  ext: FileExt,
): Promise<AnalyzeOutput> {
  const cached = await readCache(datasetId);
  if (cached) return cached;

  // Xác nhận file đã lên tới nơi TRƯỚC khi tải về. Người dùng có thể gọi bước
  // này khi upload còn dang dở hoặc đã bị huỷ, và một lỗi "không tìm thấy
  // object" từ SDK thì không nói được cho họ phải làm gì.
  const head = await storage.headObject(s3Key);
  if (!head) {
    throw new HttpError(
      409,
      DATASET_ERROR_CODES.UPLOAD_NOT_FINISHED,
      'File chưa được tải lên xong. Hãy thử tải lại.',
    );
  }

  // Trần dung lượng kiểm ở ĐÂY, sau khi file đã nằm trên S3. Presigned PUT không
  // diễn đạt được "tối đa N byte" (xem ghi chú trong `storage/s3Storage.ts`), nên
  // đây là lớp thực thi thật — lớp phía trình duyệt chạy trên máy người dùng.
  if (head.size > env.UPLOAD_MAX_BYTES) {
    await storage.deleteObject(s3Key);
    throw new HttpError(
      413,
      DATASET_ERROR_CODES.FILE_TOO_LARGE,
      `File vượt quá ${Math.round(env.UPLOAD_MAX_BYTES / 1_048_576)}MB.`,
    );
  }

  const buffer = await storage.getObject(s3Key);

  const format = checkFormat(buffer, ext);
  if (!format.ok) {
    throw new HttpError(
      400,
      DATASET_ERROR_CODES.UNSUPPORTED_FORMAT,
      format.reason ?? 'Định dạng file không được hỗ trợ.',
    );
  }

  let parsed;
  try {
    parsed = await parseFile(buffer, ext);
  } catch (err) {
    // `ParseError` mang thông báo viết cho người dùng đọc. Lỗi khác thì không —
    // để nó đi tiếp lên `errorHandler` thành 500, đúng bản chất của nó.
    if (err instanceof ParseError) {
      throw new HttpError(400, DATASET_ERROR_CODES.CORRUPT_FILE, err.message);
    }
    throw err;
  }

  const usable = parsed.sheets.filter((s) => s.header.length > 0);
  if (usable.length === 0) {
    throw new HttpError(
      400,
      DATASET_ERROR_CODES.CORRUPT_FILE,
      'File không có hàng tiêu đề nên không xác định được tên cột.',
    );
  }

  const output: AnalyzeOutput = {
    result: {
      sheets: usable.map(toPreview),
      truncated: parsed.truncated,
      maxRows: env.DATASET_MAX_ROWS,
      previewRowLimit: PREVIEW_ROWS,
    },
    sheets: usable,
    fileSize: head.size,
  };

  await writeCache(datasetId, output);
  return output;
}

/** Dọn cache khi dataset bị xoá, để bộ nhớ Redis không giữ dữ liệu đã bỏ. */
export async function clearAnalyzeCache(datasetId: number): Promise<void> {
  await redis.del(cacheKey(datasetId));
}

async function readCache(datasetId: number): Promise<AnalyzeOutput | null> {
  const raw = await redis.get(cacheKey(datasetId));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as AnalyzeOutput;
  } catch {
    // Cache hỏng thì coi như chưa có. Không ném lỗi: một chuỗi JSON lỗi trong
    // Redis không đáng để chặn người dùng làm việc.
    return null;
  }
}

async function writeCache(datasetId: number, output: AnalyzeOutput): Promise<void> {
  try {
    await redis.set(cacheKey(datasetId), JSON.stringify(output), 'EX', CACHE_TTL_SECONDS);
  } catch {
    // Redis đầy hoặc mất kết nối thì bỏ qua — cache là thứ tăng tốc, không phải
    // thứ luồng này phụ thuộc vào. Lần sau chỉ đơn giản là parse lại.
  }
}
