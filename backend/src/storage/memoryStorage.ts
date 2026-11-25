import type { ObjectStorage } from './index';

/**
 * Bản dựng cho TEST — giữ file trong một Map, không chạm mạng.
 *
 * Nhờ nó, 200+ ca tích hợp hiện có vẫn chạy trên máy chỉ bật MySQL + Redis, và
 * những ca mới của §7 kiểm được toàn bộ luồng upload mà không cần MinIO.
 *
 * `url` trả về là một đường dẫn giả `memory://<key>`. Test không PUT vào đó —
 * chúng gọi thẳng `putForTest` để mô phỏng việc trình duyệt đã tải file lên.
 * Giả vờ dựng một HTTP server chỉ để nhận PUT sẽ kiểm chính đoạn code giả đó,
 * chứ không kiểm thêm được gì về hệ thống thật.
 */
const objects = new Map<string, Buffer>();
/** Thời điểm ghi từng object — chỉ `listObjects` cần, nên để riêng. */
const thoiDiem = new Map<string, Date>();

export const memoryStorage: ObjectStorage & {
  putForTest(key: string, body: Buffer): void;
  reset(): void;
} = {
  presignPut(key, _contentType, _maxBytes) {
    return Promise.resolve({
      url: `memory://${key}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
  },

  putObject(key, body, _contentType) {
    objects.set(key, body);
    thoiDiem.set(key, new Date());
    return Promise.resolve();
  },

  getObject(key) {
    const body = objects.get(key);
    // Ném lỗi thay vì trả Buffer rỗng: một dataset "parse ra 0 cột" là triệu
    // chứng rất khó lần, còn "không tìm thấy object" thì nói thẳng chuyện gì xảy
    // ra. Bản S3 thật cũng ném ở đúng tình huống này.
    if (!body) return Promise.reject(new Error(`Không tìm thấy object: ${key}`));
    return Promise.resolve(body);
  },

  deleteObject(key) {
    objects.delete(key);
    thoiDiem.delete(key);
    return Promise.resolve();
  },

  headObject(key) {
    const body = objects.get(key);
    return Promise.resolve(body ? { size: body.byteLength } : null);
  },

  listObjects() {
    return Promise.resolve(
      [...objects.keys()].map((key) => ({
        key,
        lastModified: thoiDiem.get(key) ?? new Date(0),
      })),
    );
  },

  /** Mô phỏng trình duyệt đã PUT xong file lên S3. */
  putForTest(key, body) {
    objects.set(key, body);
    thoiDiem.set(key, new Date());
  },

  /** Gọi trong `resetDatabase()` để một ca không thấy file của ca trước. */
  reset() {
    objects.clear();
    thoiDiem.clear();
  },
};
