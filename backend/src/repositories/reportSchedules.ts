import type { TanSuat } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import type { Db } from './db';

/**
 * Lịch gửi báo cáo định kỳ — mong muốn D6.
 *
 * `toiHan` là câu DUY NHẤT không lọc `tenant_id`: nó là câu của vòng lặp nền,
 * chạy cho mọi tổ chức. Mọi câu khác đều lọc, và nơi gọi phải dùng `tenant_id`
 * của phiên đăng nhập.
 */

export interface ScheduleRow {
  id: number;
  tenantId: number;
  reportId: number;
  createdBy: number;
  tanSuat: TanSuat;
  gio: number;
  thu: number | null;
  ngay: number | null;
  nguoiNhan: string[];
  isActive: boolean;
  nextRunAt: Date;
  lastSentAt: Date | null;
  lastError: string | null;
}

function docNguoiNhan(raw: unknown): string[] {
  const value = typeof raw === 'string' ? thu(raw) : raw;
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

function thu(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function toRow(r: RowDataPacket): ScheduleRow {
  return {
    id: Number(r['id']),
    tenantId: Number(r['tenant_id']),
    reportId: Number(r['report_id']),
    createdBy: Number(r['created_by']),
    tanSuat: r['tan_suat'] as TanSuat,
    gio: Number(r['gio']),
    thu: r['thu'] === null ? null : Number(r['thu']),
    ngay: r['ngay'] === null ? null : Number(r['ngay']),
    nguoiNhan: docNguoiNhan(r['nguoi_nhan']),
    isActive: Number(r['is_active']) === 1,
    nextRunAt: r['next_run_at'] as Date,
    lastSentAt: (r['last_sent_at'] as Date | null) ?? null,
    lastError: (r['last_error'] as string | null) ?? null,
  };
}

const CHON = `SELECT id, tenant_id, report_id, created_by, tan_suat, gio, thu, ngay,
                     nguoi_nhan, is_active, next_run_at, last_sent_at, last_error
                FROM report_schedules`;

export async function tao(
  db: Db,
  input: {
    tenantId: number;
    reportId: number;
    createdBy: number;
    tanSuat: TanSuat;
    gio: number;
    thu: number | null;
    ngay: number | null;
    nguoiNhan: string[];
    nextRunAt: Date;
  },
): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    `INSERT INTO report_schedules
       (tenant_id, report_id, created_by, tan_suat, gio, thu, ngay, nguoi_nhan, next_run_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenantId,
      input.reportId,
      input.createdBy,
      input.tanSuat,
      input.gio,
      input.thu,
      input.ngay,
      JSON.stringify(input.nguoiNhan),
      input.nextRunAt,
    ],
  );
  return res.insertId;
}

export async function theoBaoCao(
  db: Db,
  tenantId: number,
  reportId: number,
): Promise<ScheduleRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `${CHON} WHERE tenant_id = ? AND report_id = ? ORDER BY id DESC`,
    [tenantId, reportId],
  );
  return rows.map(toRow);
}

export async function doiTrangThai(
  db: Db,
  tenantId: number,
  id: number,
  isActive: boolean,
): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    'UPDATE report_schedules SET is_active = ? WHERE id = ? AND tenant_id = ?',
    [isActive ? 1 : 0, id, tenantId],
  );
  return res.affectedRows;
}

export async function xoa(db: Db, tenantId: number, id: number): Promise<number> {
  const [res] = await db.query<ResultSetHeader>(
    'DELETE FROM report_schedules WHERE id = ? AND tenant_id = ?',
    [id, tenantId],
  );
  return res.affectedRows;
}

/**
 * Những lịch ĐANG BẬT và đã tới hạn — câu của vòng lặp nền.
 *
 * Có trần `gioiHan` để một lần chạy không bao giờ nhận một lô vô hạn: nếu máy
 * chủ tắt ba ngày thì mọi lịch đều quá hạn cùng lúc, và gửi tất cả trong một
 * nhịp là một đợt thư dồn mà không ai muốn nhận.
 */
export async function toiHan(db: Db, bayGio: Date, gioiHan: number): Promise<ScheduleRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `${CHON} WHERE is_active = 1 AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT ?`,
    [bayGio, gioiHan],
  );
  return rows.map(toRow);
}

/**
 * Đẩy mốc kế tiếp — gọi NGAY khi nhận lô, trước khi gửi.
 *
 * Thứ tự đó là chủ đích: nếu đẩy mốc sau khi gửi xong, một lần gửi chậm (SMTP
 * treo 30 giây) hoặc một lần tiến trình chết giữa đường sẽ để lại một lịch vẫn
 * "tới hạn", và nhịp kế tiếp của vòng lặp gửi lại lá thư ấy. Đẩy trước thì tệ
 * nhất là MẤT một lần gửi — và một lần mất thì người dùng còn đọc được
 * `last_error`, còn một trận thư trùng thì không có đường lùi.
 */
export async function datLanKeTiep(db: Db, id: number, nextRunAt: Date): Promise<void> {
  await db.query('UPDATE report_schedules SET next_run_at = ? WHERE id = ?', [nextRunAt, id]);
}

export async function ghiKetQua(db: Db, id: number, loi: string | null): Promise<void> {
  await db.query(
    `UPDATE report_schedules
        SET last_sent_at = CURRENT_TIMESTAMP(3), last_error = ?
      WHERE id = ?`,
    [loi, id],
  );
}
