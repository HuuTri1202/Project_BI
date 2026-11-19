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
 *
 * ⚠️ Nguyên tử KHÔNG có nghĩa là luôn thực hiện được — xem `doiTenCoThuLai`.
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
      await doiTenCoThuLai(temp, target);
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

/**
 * Mã lỗi nghĩa là "một tiến trình khác đang giữ file, thử lại sau" — xem dưới.
 *
 * `EPERM` là mã Windows trả về cho chuyện này; `EACCES` và `EBUSY` cùng họ và đã
 * được báo ở các dự án khác với cùng nguyên nhân. Mọi mã khác (`ENOENT`,
 * `ENOSPC`, `EROFS`) là lỗi THẬT và phải ném ngay — thử lại chỉ làm chậm một lỗi
 * sẽ không bao giờ tự hết.
 */
const LOI_GIU_FILE = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Năm lần, giãn dần 20/40/60/80ms — tổng xấu nhất 200ms trước khi ném. */
const SO_LAN_DOI_TEN = 5;

/**
 * `rename` có THỬ LẠI — và đây là lỗi thật đã đo được, không phải đề phòng.
 *
 * ═══ Triệu chứng ════════════════════════════════════════════════════════════
 *
 *     EPERM: operation not permitted,
 *     rename '...	enants\dm155.js.tmp' -> '...	enants\dm155.js'
 *
 * Người dùng nhận 503 kèm câu "Kiểm tra biến CUBE_SCHEMA_DIR trong backend/.env"
 * — chỉ sai hoàn toàn chỗ cần sửa, vì biến đó đúng và thư mục ghi được. Lần tạo
 * mô hình ngay sau đó thành công. Đã gặp 4 lần trong một buổi chạy bộ e2e.
 *
 * ═══ Nguyên nhân ════════════════════════════════════════════════════════════
 *
 * Trên Windows, `rename` thất bại khi tiến trình khác đang GIỮ handle của file
 * nguồn hoặc file đích. Thư mục này nằm trong bind mount `./cube:/cube/conf` của
 * container Cube, và Cube theo dõi cả cây `model/` — nên cứ ghi xong một file là
 * có một bộ theo dõi mở nó ra đọc, đúng vào khoảnh khắc ta gọi `rename`. Trình
 * quét virus của Windows làm y như vậy với mọi file mới tạo.
 *
 * Tức là: CÀNG ĐÚNG về mặt nguyên tử thì càng dễ gặp: chính cái file tạm mà ta
 * tạo ra để tránh đọc dở là cái bị bộ theo dõi chộp lấy.
 *
 * ═══ Vì sao thử lại là cách ĐÚNG ở đây, không phải vá tạm ══════════════════
 *
 * Điều kiện gây lỗi tự hết sau vài mili giây, và không có API nào để xin hệ điều
 * hành đợi: Win32 không cho mở file với "đợi tới khi hết tranh chấp". Mọi lựa
 * chọn khác đều tệ hơn — ghi thẳng vào file đích thì bỏ mất tính nguyên tử (Cube
 * đọc file ghi dở, đúng cái mà `.tmp` sinh ra để tránh), còn khoá riêng thì
 * không ràng buộc được tiến trình nằm ngoài ứng dụng.
 *
 * Trần 200ms là CÓ HẠN có chủ ý: một lỗi quyền thật vẫn phải ném, chỉ chậm thêm
 * một nhịp — chứ không treo một request vô hạn.
 */
async function doiTenCoThuLai(tu: string, den: string): Promise<void> {
  for (let lan = 1; ; lan += 1) {
    try {
      await rename(tu, den);
      return;
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      if (lan >= SO_LAN_DOI_TEN || code === undefined || !LOI_GIU_FILE.has(code)) throw cause;
      await new Promise((xong) => setTimeout(xong, lan * 20));
    }
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
 * Xoá thư mục của những tổ chức KHÔNG còn trong danh sách — gọi một lần lúc boot.
 *
 * Thư mục mồ côi không vô hại. `repositoryFactory` không đọc nó, nên không truy
 * vấn nào sai; nhưng Cube theo dõi cả cây `model/`, và chu kỳ làm mới của nó cứ
 * thế thử biên dịch lại một schema trỏ tới bảng đã bị DROP — lặp vô hạn trong
 * log và đốt CPU cho tới khi ai đó xoá tay.
 *
 * Chỉ xoá thư mục có tên là SỐ NGUYÊN. Thứ gì người ta đặt tay vào đây thì để
 * nguyên — một lần `rm -rf` chạy theo tên lạ là chuyện không sửa lại được.
 */
export async function pruneUnknownTenants(tenantIds: readonly number[]): Promise<void> {
  const root = path.resolve(process.cwd(), env.CUBE_SCHEMA_DIR);
  const keep = new Set(tenantIds.map(String));

  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory() && /^\d+$/.test(entry.name) && !keep.has(entry.name)) {
      await rm(path.join(root, entry.name), { recursive: true, force: true });
    }
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
