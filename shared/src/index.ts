export * from './admin';
export * from './auth';
/**
 * `data` gom CẢ HAI nguồn dữ liệu vào một khái niệm `Dataset`: bảng đồng bộ từ
 * CSDL khách hàng (§8) và sheet trong file Excel/CSV tải lên (§7). Phân biệt
 * bằng trường `source`.
 */
export * from './data';
/**
 * `datamodel` là TẦNG NGỮ NGHĨA (§10) dựng trên `data`: nó không chứa dữ liệu,
 * chỉ chứa lời mô tả về những bảng `raw_*` đã nằm sẵn trong ClickHouse.
 */
export * from './datamodel';
export * from './dto';
export * from './platform';
export * from './rbac';
export * from './report';
export * from './workspace';
