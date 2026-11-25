#!/usr/bin/env node
/**
 * Tạo các file .env từ .env.example — chạy được trên cả Windows lẫn Linux/macOS.
 *
 * Dùng Node thay vì `cp` trong npm script vì trên Windows npm chạy script bằng
 * cmd.exe, ở đó không có lệnh `cp`.
 *
 * KHÔNG BAO GIỜ ghi đè .env đã tồn tại: file đó có thể chứa cấu hình riêng của
 * từng máy (đổi port vì bị trùng, password khác...).
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Bí mật phải SINH RIÊNG cho từng máy, không dùng giá trị mẫu.
 *
 * ═══ Vì sao mọi mật khẩu hạ tầng đều nằm ở đây ══════════════════════════════
 *
 * Trước đây chỉ `JWT_SECRET` và `CONNECTION_ENCRYPTION_KEY` được sinh; sáu cái
 * còn lại chép y nguyên từ `.env.example` — tức là mọi máy đã cài đều dùng
 * `bi_password`, `redispassword`, `minioadmin123`, `cube-api-secret-change-me`,
 * và cả bốn chuỗi đó nằm công khai trong Git. Trên máy dev với cổng chỉ nghe
 * 127.0.0.1 thì không sao. Ngày đem lên một máy có IP công khai thì đó là cả
 * tầng dữ liệu mở sẵn.
 *
 * `CUBEJS_API_SECRET` là cái nặng nhất: ai biết nó thì tự ký được JWT với
 * `tenantId` bất kỳ, và `repositoryFactory` của Cube sẽ phục vụ dữ liệu của tổ
 * chức đó. Toàn bộ cách ly đa tổ chức của §10 đứng trên đúng một chuỗi này.
 *
 * ═══ `keys` — MỘT giá trị, nhiều tên biến ═══════════════════════════════════
 *
 * Mật khẩu hạ tầng xuất hiện ở HAI file và phải khớp nhau: `MYSQL_PASSWORD` có
 * ở cả `backend/.env` (bên kết nối) và `infrastructure/.env` (bên tạo user).
 * Sinh riêng cho từng file là hai giá trị khác nhau, và triệu chứng là
 * "ER_ACCESS_DENIED" ở một chỗ không ai nghĩ tới việc so hai file.
 *
 * Nên mỗi dòng dưới đây là MỘT giá trị được ghi vào MỌI tên biến nó liệt kê.
 * MinIO còn đổi cả tên: ta kết nối bằng `S3_SECRET_KEY`, container tạo tài
 * khoản bằng `MINIO_ROOT_PASSWORD` — cùng một mật khẩu, hai cái tên.
 *
 * ═══ Vì sao `hex` cho hạn tầng, không phải base64 ═══════════════════════════
 *
 * Bốn chuỗi này đi vào DÒNG LỆNH của container, không chỉ vào biến môi trường:
 * `redis-server --requirepass X`, `redis-cli -a X`, `mysqladmin -pX`. base64url
 * sinh ra được chuỗi bắt đầu bằng `-`, và khi đó nó bị đọc thành một CỜ chứ
 * không phải mật khẩu. `hex` chỉ có `0-9a-f` nên an toàn ở mọi chỗ — kể cả XML
 * của ClickHouse. 24 byte = 48 ký tự, thừa sức cho trần `min(16)` của
 * `CUBEJS_API_SECRET`.
 *
 * `bytes` là số byte NGẪU NHIÊN, không phải độ dài chuỗi kết quả.
 */
const GENERATED_SECRETS = [
  // Chỉ backend dùng.
  { keys: ['JWT_SECRET'], bytes: 48, encoding: 'base64url' },
  { keys: ['CONNECTION_ENCRYPTION_KEY'], bytes: 32, encoding: 'base64' },
  // Dùng chéo backend ↔ infrastructure. Lệch nhau là hạ tầng không lên nổi.
  { keys: ['MYSQL_PASSWORD'], bytes: 24, encoding: 'hex' },
  { keys: ['MYSQL_ROOT_PASSWORD'], bytes: 24, encoding: 'hex' },
  { keys: ['REDIS_PASSWORD'], bytes: 24, encoding: 'hex' },
  { keys: ['CLICKHOUSE_PASSWORD'], bytes: 24, encoding: 'hex' },
  { keys: ['CUBEJS_API_SECRET'], bytes: 24, encoding: 'hex' },
  { keys: ['S3_SECRET_KEY', 'MINIO_ROOT_PASSWORD'], bytes: 24, encoding: 'hex' },
];

/** Giá trị của một biến trong nội dung .env; `null` khi chưa khai hoặc để trống. */
function readValue(text, key) {
  const found = new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim();
  return found === undefined || found === '' ? null : found;
}

/**
 * Ghi bí mật vào những chỗ ĐƯỢC PHÉP ghi.
 *
 * ─── Luật một dòng ──────────────────────────────────────────────────────────
 *
 * Một giá trị đang dùng ở chỗ KHÔNG được phép ghi là chân lý; mọi chỗ được phép
 * ghi phải chép theo nó. Chỉ khi không tìm thấy ở đâu cả thì mới sinh ngẫu
 * nhiên.
 *
 * Một luật đó phủ cả ba tình huống, nên không có nhánh nào phải nhớ riêng:
 *
 *   - Cài mới toàn bộ: không file nào có giá trị cũ -> sinh ngẫu nhiên, ghi vào
 *     cả hai file nên chúng khớp nhau ngay từ đầu.
 *   - Đã có `backend/.env`, mất `infrastructure/.env`: lấy mật khẩu từ file còn
 *     lại chứ KHÔNG sinh mới — sinh mới là container MySQL dựng user bằng mật
 *     khẩu mà backend không biết.
 *   - `.env.example` thêm một biến bí mật mới: chỉ chỗ VỪA được bổ sung là được
 *     phép ghi, nên file đang dùng không bị đụng tới.
 *
 * ⚠️ Vì sao luật "không được phép ghi thì tuyệt đối không đụng" quan trọng hơn
 * mọi thứ khác ở đây: sinh lại `CONNECTION_ENCRYPTION_KEY` cho một file đã dùng
 * nghĩa là MỌI mật khẩu kết nối CSDL khách hàng đã lưu không giải mã được nữa,
 * và không có đường khôi phục.
 *
 * ⚠️ MySQL chỉ đọc `MYSQL_PASSWORD` LÚC KHỞI TẠO volume. Xoá
 * `infrastructure/.env` trong khi volume `mysql_data` vẫn còn, rồi để file này
 * sinh mật khẩu mới, thì container lên nhưng user cũ giữ mật khẩu cũ. Luật trên
 * đã tránh được chuyện đó khi `backend/.env` còn sống; mất cả hai file thì phải
 * `docker compose down -v`.
 */
function fillSecrets(targets) {
  const noiDung = new Map(targets.map((t) => [t.path, readFileSync(t.path, 'utf8')]));
  const sinhMoi = [];
  const dongBo = [];

  for (const { keys, bytes, encoding } of GENERATED_SECRETS) {
    let giaTri = null;
    for (const t of targets) {
      for (const key of keys) {
        if (t.replaceable.has(key)) continue;
        giaTri ??= readValue(noiDung.get(t.path), key);
      }
    }

    const laGiaTriCu = giaTri !== null;
    giaTri ??= randomBytes(bytes).toString(encoding);

    const daGhi = [];
    for (const t of targets) {
      for (const key of keys) {
        if (!t.replaceable.has(key)) continue;
        const text = noiDung.get(t.path);
        const pattern = new RegExp(`^${key}=.*$`, 'm');
        if (!pattern.test(text)) continue;
        noiDung.set(t.path, text.replace(pattern, `${key}=${giaTri}`));
        daGhi.push(key);
      }
    }

    if (daGhi.length === 0) continue;
    (laGiaTriCu ? dongBo : sinhMoi).push([...new Set(daGhi)].join(' = '));
  }

  for (const t of targets) writeFileSync(t.path, noiDung.get(t.path));

  if (sinhMoi.length > 0) {
    console.log(`[setup]   ↳ đã sinh bí mật ngẫu nhiên: ${sinhMoi.join(', ')}`);
  }
  if (dongBo.length > 0) {
    console.log(`[setup]   ↳ đã chép lại giá trị đang dùng: ${dongBo.join(', ')}`);
  }
}

/** Mọi tên biến khai ở đầu dòng trong một file .env. */
function keysIn(text) {
  return new Set([...text.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
}

/**
 * Bổ sung vào `.env` đã có những biến MỚI xuất hiện trong `.env.example`.
 *
 * ─── Vì sao cần ─────────────────────────────────────────────────────────────
 *
 * `.env` không nằm trong Git, nên nó đứng yên trong khi `.env.example` đi tiếp
 * cùng mã nguồn. Mỗi lần một nhánh thêm biến bắt buộc (mục §7 thêm bốn biến S3
 * chẳng hạn), người đã có `.env` từ trước sẽ `git pull` xong rồi gặp backend
 * chết ngay lúc boot — mà triệu chứng ở giao diện lại là "đăng nhập lỗi", cách
 * xa nguyên nhân thật vài tầng.
 *
 * ─── Luật ───────────────────────────────────────────────────────────────────
 *
 * CHỈ THÊM, không bao giờ sửa và không bao giờ xoá. Biến đã có trong `.env` giữ
 * nguyên giá trị dù `.env.example` có ghi khác — đó là chỗ người dùng để cấu
 * hình riêng của máy mình (đổi cổng vì bị trùng, mật khẩu khác…), và ghi đè lên
 * nó là làm hỏng đúng thứ file này sinh ra để giữ.
 *
 * Trả về danh sách biến vừa thêm: đó chính là tập được phép ghi bí mật — xem
 * `fillSecrets`.
 */
function addMissingKeys(src, dest) {
  const example = readFileSync(src, 'utf8');
  const current = readFileSync(dest, 'utf8');

  const have = keysIn(current);
  const missing = [...keysIn(example)].filter((key) => !have.has(key));
  if (missing.length === 0) return [];

  const lines = missing.map(
    (key) => new RegExp(`^${key}=.*$`, 'm').exec(example)?.[0] ?? `${key}=`,
  );

  writeFileSync(
    dest,
    `${current.trimEnd()}\n\n` +
      '# ─── Biến mới, thêm tự động bởi `npm run setup` ───\n' +
      '# Giá trị lấy từ .env.example. Kiểm lại nếu máy bạn dùng cấu hình riêng.\n' +
      `${lines.join('\n')}\n`,
  );

  console.log(`[setup]   ↳ đã bổ sung ${missing.length} biến mới: ${missing.join(', ')}`);
  return missing;
}

/** [file mẫu, file đích] */
const pairs = [
  ['backend/.env.example', 'backend/.env'],
  ['frontend/.env.example', 'frontend/.env'],
  ['infrastructure/.env.example', 'infrastructure/.env'],
];

/**
 * `replaceable` = những biến mà `fillSecrets` ĐƯỢC PHÉP ghi lên.
 *
 * File vừa tạo: tất cả, vì mọi giá trị trong đó là giá trị mẫu lấy từ Git.
 * File đã có: chỉ những biến vừa được bổ sung ở lượt này.
 */
const targets = [];
let created = 0;
let kept = 0;

for (const [from, to] of pairs) {
  const src = join(root, from);
  const dest = join(root, to);

  if (!existsSync(src)) {
    console.warn(`[setup] ! không thấy ${from} — bỏ qua`);
    continue;
  }
  if (existsSync(dest)) {
    console.log(`[setup] = giữ nguyên ${to} (đã có)`);
    targets.push({ path: dest, replaceable: new Set(addMissingKeys(src, dest)) });
    kept++;
    continue;
  }

  copyFileSync(src, dest);
  console.log(`[setup] + tạo ${to}`);
  targets.push({ path: dest, replaceable: keysIn(readFileSync(dest, 'utf8')) });
  created++;
}

// MỘT lượt cho cả ba file, không phải mỗi file một lượt: một giá trị bí mật có
// thể phải ghi vào hai file, nên quyết định phải nhìn thấy đủ cả ba.
fillSecrets(targets);

console.log(`[setup] Xong: tạo mới ${created}, giữ nguyên ${kept}.`);
