import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { env } from '../src/config/env';
import { pruneUnknownTenants } from '../src/services/datamodel/cubeSchemaStore';

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
