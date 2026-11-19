import { mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { env } from '../src/config/env';
import { pruneUnknownTenants, writeTenantSchema } from '../src/services/datamodel/cubeSchemaStore';

/**
 * Dọn thư mục cube mồ côi — `cubeSchemaStore.pruneUnknownTenants`.
 *
 * Hàm này XOÁ thư mục theo tên, nên nó là loại mã phải có bài kiểm: một lần
 * nhận sai tập "giữ lại" là mất schema của tổ chức thật (dựng lại được, nhưng
 * người dùng trả giá bằng một lượt biên dịch nguội 2,7–4,5 giây), còn một lần
 * nhận sai cái gì là "thư mục của tổ chức" thì `rm -rf` chạy vào thứ người ta
 * đặt tay vào đây.
 *
 * Chạy trong `backend/tmp/cube-schema-test` — xem `CUBE_SCHEMA_DIR` ở
 * `vitest.config.ts`. Nếu biến đó mất, bài test này sẽ dọn thư mục cube của máy
 * dev, nên nó khẳng định luôn đường dẫn trước khi xoá bất cứ gì.
 */
const root = path.resolve(process.cwd(), env.CUBE_SCHEMA_DIR);

describe('pruneUnknownTenants', () => {
  beforeEach(async () => {
    expect(env.CUBE_SCHEMA_DIR).not.toContain('infrastructure');
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
  });

  it('xoá thư mục của tổ chức không còn trong danh sách, giữ tổ chức còn sống', async () => {
    await mkdir(path.join(root, '7'));
    await mkdir(path.join(root, '3330'));
    await writeFile(path.join(root, '7', 'dm1.js'), 'cube(`a`, {});', 'utf8');

    await pruneUnknownTenants([7]);

    expect((await readdir(root)).sort()).toEqual(['7']);
    // Thư mục giữ lại phải còn NGUYÊN nội dung, không phải chỉ còn cái vỏ.
    expect(await readdir(path.join(root, '7'))).toEqual(['dm1.js']);
  });

  it('không chạm thứ không phải thư mục-số', async () => {
    await mkdir(path.join(root, 'views'));
    await writeFile(path.join(root, 'README.md'), 'ghi chú tay', 'utf8');

    await pruneUnknownTenants([]);

    expect((await readdir(root)).sort()).toEqual(['README.md', 'views']);
  });
});

/**
 * `rename` bị một tiến trình khác giữ file — lỗi THẬT, đã đo trên máy này.
 *
 * Triệu chứng gặp 4 lần trong một buổi chạy bộ e2e:
 *
 *     EPERM: operation not permitted, rename '...\dm155.js.tmp' -> '...\dm155.js'
 *
 * rồi 503 kèm câu "Kiểm tra biến CUBE_SCHEMA_DIR" — chỉ sai hẳn chỗ cần sửa.
 * Nguyên nhân: thư mục này nằm trong bind mount của container Cube, Cube theo
 * dõi cả cây `model/`, nên vừa ghi xong là có bộ theo dõi mở file ra đọc đúng
 * lúc ta gọi `rename`.
 *
 * ⚠️ Ca này TÁI HIỆN ĐIỀU KIỆN THẬT ở mức hệ điều hành — giữ một handle đang mở
 * trên file đích — chứ không giả lập `fs`. Cái giá: nó chỉ ĐO được trên Windows,
 * vì POSIX cho `rename` ghi đè một file đang mở. Trên Linux nó vẫn xanh nhưng
 * xanh một cách rỗng, và nói ra ở đây thì không ai đọc nhầm nó là bằng chứng.
 */
describe('writeTenantSchema', () => {
  const tenant = 777;

  beforeEach(async () => {
    expect(env.CUBE_SCHEMA_DIR).not.toContain('infrastructure');
    await rm(path.join(root, String(tenant)), { recursive: true, force: true });
  });

  it('ghi được dù file đích đang bị giữ, miễn là chỗ giữ nhả ra trong trần 200ms', async () => {
    const dir = path.join(root, String(tenant));
    await mkdir(dir, { recursive: true });

    const dich = path.join(dir, 'dm1.js');
    await writeFile(dich, '// bản cũ', 'utf8');

    // Giữ file đích, rồi nhả sau 60ms — tức là trong tầm 5 lần thử (20+40+60+80).
    const giu = await open(dich, 'r');
    const nha = setTimeout(() => void giu.close(), 60);

    try {
      await writeTenantSchema(tenant, [{ fileName: 'dm1.js', content: '// bản mới' }]);
    } finally {
      clearTimeout(nha);
      await giu.close().catch(() => undefined);
    }

    expect(await readdir(dir)).toEqual(['dm1.js']);
  });

  it('vẫn NÉM khi lỗi không phải loại tự hết — không thử lại vô ích', async () => {
    const dir = path.join(root, String(tenant));
    await mkdir(dir, { recursive: true });

    /*
     * Một THƯ MỤC mang đúng tên file đích: `rename` không bao giờ thành công, và
     * đó là loại lỗi phải ném ngay. Nó chứng minh vòng thử lại CÓ HẠN — thiếu
     * khẳng định này thì một vòng lặp vô hạn cũng làm ca trên xanh.
     */
    await mkdir(path.join(dir, 'dm1.js'), { recursive: true });
    await mkdir(path.join(dir, 'dm1.js', 'chan-loi'), { recursive: true });

    await expect(
      writeTenantSchema(tenant, [{ fileName: 'dm1.js', content: '// bản mới' }]),
    ).rejects.toThrow(/Không ghi được file mô hình/);
  });
});
