import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '../config/env';
import type { ObjectStorage, PresignedUpload } from './index';

/**
 * Bản dựng thật — nói chuyện với MinIO ở dev và AWS S3 ở production.
 *
 * Cùng một đoạn code cho cả hai: MinIO cài đặt đúng giao thức S3, nên khác biệt
 * duy nhất nằm ở `S3_ENDPOINT` và `S3_FORCE_PATH_STYLE`.
 */
const client = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  // MinIO phân biệt bucket bằng đường dẫn (localhost:9000/bi-datasets), AWS dùng
  // tên miền con. Đặt sai thì SDK ký URL cho một host không tồn tại, và lỗi hiện
  // ra dưới dạng DNS chứ không phải S3 — mất thời gian tìm nhầm chỗ.
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});

/**
 * 15 phút.
 *
 * Đủ dài để tải xong 50MB trên đường truyền chậm, đủ ngắn để một URL rò rỉ qua
 * log hay lịch sử trình duyệt không còn giá trị khi ai đó tìm thấy nó.
 */
const EXPIRES_SECONDS = 15 * 60;

export const s3Storage: ObjectStorage = {
  async presignPut(key, contentType, _maxBytes): Promise<PresignedUpload> {
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: EXPIRES_SECONDS },
    );

    return {
      url,
      expiresAt: new Date(Date.now() + EXPIRES_SECONDS * 1000).toISOString(),
    };
  },

  async getObject(key) {
    const res = await client.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    );
    if (!res.Body) throw new Error(`Object rỗng: ${key}`);

    // `transformToByteArray` gom cả stream vào bộ nhớ. Chấp nhận được vì trần
    // đã là 50MB và ta cần toàn bộ file để parse — thư viện đọc xlsx phải đọc
    // được central directory ở CUỐI file ZIP, nên không stream tuần tự được.
    return Buffer.from(await res.Body.transformToByteArray());
  },

  async deleteObject(key) {
    await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  },

  async headObject(key) {
    try {
      const res = await client.send(
        new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
      );
      return { size: Number(res.ContentLength ?? 0) };
    } catch (err) {
      // Bucket private trả 403 thay vì 404 cho object không tồn tại, tuỳ cấu hình
      // quyền. Cả hai đều có nghĩa "không dùng được", nên gộp thành `null` thay
      // vì để hai mã lỗi khác nhau rò lên tầng trên.
      if (isNotFound(err)) return null;
      throw err;
    }
  },
};

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string }).name;
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404 || status === 403;
}

/*
 * ─── Trần dung lượng được thực thi ở đâu ────────────────────────────────────
 *
 * `presignPut` nhận `maxBytes` nhưng KHÔNG dùng, và đó là chuyện phải nói rõ chứ
 * không phải một tham số bị bỏ quên.
 *
 * Presigned PUT ký một tập tham số cố định. Ký luôn `ContentLength` sẽ buộc
 * client gửi ĐÚNG số byte đó — nhưng lúc cấp URL ta chưa biết file nặng bao
 * nhiêu, chỉ biết trần. Không có cách nào diễn đạt "tối đa N byte" trong một
 * presigned PUT.
 *
 * Nên trần được thực thi bằng hai lớp khác:
 *
 *   1. Trình duyệt từ chối trước khi gửi (§7.3 phía client).
 *   2. `headObject` SAU khi upload: file vượt trần thì xoá object và trả lỗi,
 *      trước khi một dòng nào được nạp vào database.
 *
 * Lớp (2) mới là lớp đáng tin, vì lớp (1) chạy trên máy người dùng.
 *
 * ⚠️ Presigned POST (`createPresignedPost`) có điều kiện `content-length-range`
 * do chính S3 thực thi, và đó là công cụ đúng hơn. Không dùng vì nó đòi gửi
 * multipart/form-data với một tập field đã ký, làm luồng phức tạp hơn hẳn để đổi
 * lấy việc bỏ đi một lần gọi `headObject`. Đây là lựa chọn có cân nhắc, không
 * phải thiếu sót — người sau muốn siết chặt hơn thì đây là chỗ để đổi.
 *
 * Tham số vẫn nằm trong interface để bản memory (test) kiểm được trần, và để
 * ngày nào chuyển sang presigned POST thì không phải sửa mọi nơi gọi.
 */
