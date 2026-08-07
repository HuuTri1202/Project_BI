import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { mysqlPool } from '../config/mysql';

export interface Tenant {
  id: number;
  name: string;
  slug: string;
}

interface TenantRow extends RowDataPacket {
  id: number;
  name: string;
  slug: string;
}

export async function findTenantById(tenantId: number): Promise<Tenant | null> {
  const [rows] = await mysqlPool.query<TenantRow[]>(
    'SELECT id, name, slug FROM tenants WHERE id = ? LIMIT 1',
    [tenantId],
  );
  const row = rows[0];
  return row ? { id: Number(row.id), name: row.name, slug: row.slug } : null;
}

export async function findTenantBySlug(slug: string): Promise<Tenant | null> {
  const [rows] = await mysqlPool.query<TenantRow[]>(
    'SELECT id, name, slug FROM tenants WHERE slug = ? LIMIT 1',
    [slug],
  );
  const row = rows[0];
  return row ? { id: Number(row.id), name: row.name, slug: row.slug } : null;
}

export async function createTenant(name: string, slug: string): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    'INSERT INTO tenants (name, slug) VALUES (?, ?)',
    [name, slug],
  );
  return result.insertId;
}
