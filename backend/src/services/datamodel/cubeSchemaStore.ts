import { mkdir, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DATAMODEL_ERROR_CODES } from '@bi/shared';

import { env } from '../../config/env';
import { HttpError } from '../../utils/httpError';

/**
 * Ghi file cube schema xuống đĩa — §10, ADR-08.
 *
 * ─── TOÀN BỘ hiểu biết về hệ thống file của §10 nằm trong file này ──────────
 *
 * Cố ý gom lại một chỗ. Express ghi vào `infrastructure/cube/model/tenants/`
 * trên host, Cube đọc chính thư mục đó qua bind mount `./cube:/cube/conf`. Cách
 * này chạy đúng vì cả hai nằm trên MỘT máy dev.
 *
 * ⚠️ NỢ KIẾN TRÚC, ghi ra chứ không giấu: nó HỎNG ngày Express được đóng gói
 * thành container riêng không chia sẻ volume đó, và hỏng với nhiều bản sao
 * Express cùng ghi vào một thư mục. Đường đi đúng lâu dài là `repositoryFactory`
 * của Cube gọi ngược về Express xin schema qua HTTP — khi đó chỉ file này và
 * `infrastructure/cube/cube.js` phải đổi, không nơi nào khác.
 *
 * Giữ cách ghi file cho tới lúc đó vì một lý do cụ thể: file trên đĩa ĐỌC ĐƯỢC.
 * Khi Explorer trả số lạ, `cat dm12.js` là thấy ngay sai ở đâu. Một schema phục
 * vụ qua HTTP thì không có gì để mở ra xem.
 *
 * ─── Mỗi tổ chức một thư mục ────────────────────────────────────────────────
 *
 *     model/tenants/{tenantId}/dm{dataModelId}.js
 *
 * Không phải để cho gọn: `cube.js` khai `contextToAppId` theo tổ chức và
 * `repositoryFactory` chỉ đọc thư mục của tổ chức đang hỏi. Nhờ vậy cube của tổ
 * chức khác KHÔNG TỒN TẠI trong ngữ cảnh đã biên dịch — một truy vấn gọi tên nó
 * hỏng ở trình biên dịch của Cube, chứ không phải chỉ bị Express từ chối.
 */

function tenantDir(tenantId: number): string {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error(`tenantId phải là số nguyên dương, nhận được: ${String(tenantId)}`);
  }
  return path.resolve(process.cwd(), env.CUBE_SCHEMA_DIR, String(tenantId));
}

export interface GeneratedCubeFile {
  /** `dm12.js` — do `cubeFileNameFor` sinh, thuần từ số nguyên. */
  fileName: string;
  content: string;
}

/**
 * Ghi TOÀN BỘ schema của một tổ chức, và dọn những gì không còn trong danh sách.
 *
 * ─── Đối chiếu, không nối thêm ──────────────────────────────────────────────
 *
 * Hàm này nhận tập file ĐẦY ĐỦ của tổ chức, ghi hết, rồi xoá mọi `dm*.js` không
 * nằm trong tập đó. Nhờ luật này, "file còn sót của một mô hình đã xoá" trở
 * thành chuyện KHÔNG XẢY RA ĐƯỢC — không có đường xoá riêng để mà quên gọi.
 *
 * ─── Ghi nguyên tử ──────────────────────────────────────────────────────────
 *
 * Ghi ra file tạm rồi `rename`. Cube theo dõi thư mục này, và trên một bind
 * mount nó sẽ vui vẻ đọc một file đang ghi dở rồi báo lỗi cú pháp không tài nào
 * tái hiện được. `rename` trong cùng một thư mục là thao tác nguyên tử ở mọi hệ
 * thống file thực tế.
 */
export async function writeTenantSchema(
  tenantId: number,
  files: readonly GeneratedCubeFile[],
): Promise<void> {
  const dir = tenantDir(tenantId);

  try {
    await mkdir(dir, { recursive: true });

    for (const file of files) {
      const target = path.join(dir, file.fileName);
      const temp = `${target}.tmp`;
      await writeFile(temp, file.content, 'utf8');
      await rename(temp, target);
    }

    const keep = new Set(files.map((f) => f.fileName));
    const existing = await readdir(dir);
    for (const name of existing) {
      // Dọn cả file `.tmp` bỏ lại từ một lần ghi hỏng giữa chừng.
      if (name.endsWith('.tmp') || (name.endsWith('.js') && !keep.has(name))) {
        await unlink(path.join(dir, name));
      }
    }
  } catch (cause) {
    throw unwritable(cause, dir);
  }
}

/** Tổ chức không còn mô hình nào — xoá cả thư mục thay vì để lại một thư mục rỗng. */
export async function removeTenantSchema(tenantId: number): Promise<void> {
  try {
    await rm(tenantDir(tenantId), { recursive: true, force: true });
  } catch (cause) {
    throw unwritable(cause, tenantDir(tenantId));
  }
}

/**
 * Kiểm thư mục ghi được, gọi một lần lúc boot.
 *
 * Cùng lý do với `pingClickhouse`: khi hạ tầng phía sau sai, thứ người dùng
 * thấy là "Có lỗi không xác định" — một câu không dẫn tới hành động nào. Kiểm
 * sớm thì lỗi được đặt tên ngay tại chỗ biết rõ nhất chuyện gì đang xảy ra.
 *
 * KHÔNG ném: một máy dev chưa dùng tới §10 vẫn phải boot được. Chỉ cảnh báo,
 * kèm đúng tên biến phải sửa.
 */
export async function checkSchemaDir(): Promise<void> {
  const dir = path.resolve(process.cwd(), env.CUBE_SCHEMA_DIR);
  try {
    await mkdir(dir, { recursive: true });
  } catch (cause) {
    console.warn(
      `[datamodel] không ghi được thư mục cube schema: ${dir}\n` +
        `           Sửa CUBE_SCHEMA_DIR trong backend/.env. Mô hình dữ liệu (§10) sẽ không lưu được.\n` +
        `           Nguyên nhân: ${String(cause)}`,
    );
  }
}

/**
 * Không ghi được thì THẤT BẠI, không cảnh báo rồi đi tiếp.
 *
 * Một mô hình lưu thành công nhưng không bao giờ tới được Cube là một sự lệch
 * pha người dùng không nhìn thấy và không tự sửa được: giao diện báo đã lưu,
 * Explorer thì trả số của schema cũ.
 */
function unwritable(cause: unknown, dir: string): HttpError {
  console.error('[datamodel] không ghi được cube schema:', cause);
  return new HttpError(
    503,
    DATAMODEL_ERROR_CODES.SCHEMA_UNWRITABLE,
    `Không ghi được file mô hình cho Cube.js tại "${dir}". Kiểm tra biến CUBE_SCHEMA_DIR trong backend/.env.`,
  );
}
