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
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

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
    kept++;
    continue;
  }

  copyFileSync(src, dest);
  console.log(`[setup] + tạo ${to}`);
  created++;
}

console.log(`[setup] Xong: tạo mới ${created}, giữ nguyên ${kept}.`);
