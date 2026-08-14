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
 * `CONNECTION_ENCRYPTION_KEY` bắt buộc phải giải base64 ra ĐÚNG 32 byte, nên
 * giá trị mẫu trong `.env.example` không thể vừa là chỗ giữ chỗ đọc được vừa
 * hợp lệ — backend sẽ chết ngay lúc boot với thông báo về độ dài khoá. Sinh
 * thật ở đây thì `npm run setup` xong là chạy được luôn.
 *
 * `JWT_SECRET` thì mẫu vẫn boot được, nhưng để nguyên nghĩa là mọi máy trong
 * nhóm ký token bằng cùng một secret nằm trong Git. Sinh riêng luôn.
 *
 * `bytes` là số byte NGẪU NHIÊN, không phải độ dài chuỗi kết quả.
 */
const GENERATED_SECRETS = [
  { key: 'JWT_SECRET', bytes: 48, encoding: 'base64url' },
  { key: 'CONNECTION_ENCRYPTION_KEY', bytes: 32, encoding: 'base64' },
];

/**
 * Thay giá trị mẫu bằng giá trị ngẫu nhiên, giữ nguyên mọi thứ khác.
 *
 * Khớp theo `^KEY=` ở đầu dòng nên chú thích phía trên biến (kể cả dòng có chứa
 * tên biến đó) không bị đụng tới.
 *
 * `only` giới hạn phạm vi, và nó BẮT BUỘC phải có ở nhánh bổ sung biến thiếu:
 * sinh lại `CONNECTION_ENCRYPTION_KEY` cho một file đã dùng nghĩa là mọi mật
 * khẩu kết nối đã lưu không giải mã được nữa, và không có đường khôi phục.
 */
function fillSecrets(path, only = null) {
  let text = readFileSync(path, 'utf8');
  const filled = [];

  for (const { key, bytes, encoding } of GENERATED_SECRETS) {
    if (only !== null && !only.has(key)) continue;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (!pattern.test(text)) continue;
    text = text.replace(pattern, `${key}=${randomBytes(bytes).toString(encoding)}`);
    filled.push(key);
  }

  if (filled.length > 0) {
    writeFileSync(path, text);
    console.log(`[setup]   ↳ đã sinh bí mật ngẫu nhiên: ${filled.join(', ')}`);
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
    `${current.replace(/\s*$/, '')}\n\n` +
      `# ─── Biến mới, thêm tự động bởi \`npm run setup\` ───\n` +
      `# Giá trị lấy từ .env.example. Kiểm lại nếu máy bạn dùng cấu hình riêng.\n` +
      `${lines.join('\n')}\n`,
  );

  console.log(`[setup]   ↳ đã bổ sung ${missing.length} biến mới: ${missing.join(', ')}`);
  // Chỉ sinh bí mật cho những biến VỪA thêm — xem ghi chú của `fillSecrets`.
  fillSecrets(dest, new Set(missing));
  return missing;
}

/** [file mẫu, file đích] */
const pairs = [
  ['backend/.env.example', 'backend/.env'],
  ['frontend/.env.example', 'frontend/.env'],
  ['infrastructure/.env.example', 'infrastructure/.env'],
];

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
    // File đã có KHÔNG bị ghi đè, nhưng vẫn được đối chiếu để bổ sung biến mới.
    addMissingKeys(src, dest);
    kept++;
    continue;
  }

  copyFileSync(src, dest);
  console.log(`[setup] + tạo ${to}`);
  // Chỉ chạy trên file VỪA TẠO. File đã có thì tuyệt đối không đụng — sinh
  // khoá mới đè lên khoá cũ sẽ khiến mọi mật khẩu kết nối đã lưu không giải mã
  // được nữa, và không có đường khôi phục.
  fillSecrets(dest);
  created++;
}

console.log(`[setup] Xong: tạo mới ${created}, giữ nguyên ${kept}.`);
