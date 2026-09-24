export * from './admin';
/**
 * `annotation` là văn bản, đường kẻ và hình trên khung báo cáo (§10.18) — thứ
 * không có số liệu nào, chỉ để người dựng báo cáo ghi chú cho người đọc.
 */
export * from './annotation';
export * from './auth';
/**
 * `billing` (§11) là lớp thương mại: gói dịch vụ, đơn hàng, hoá đơn. Nó gắn vào
 * `tenant` chứ không vào `workspace` — người ta mua gói cho cả tổ chức.
 */
export * from './billing';
/** Tên sản phẩm hiển thị — xem `brand.ts` về những định danh CỐ Ý không đổi. */
export * from './brand';
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
/**
 * `datasetFolder` / `reportFolder` chỉ còn phần RIÊNG của mỗi loại; luật chung
 * của thư mục (tên "Chung", trần độ dài, bộ lọc trên URL) nằm ở `folder`.
 */
export * from './datasetFolder';
export * from './dto';
export * from './folder';
export * from './platform';
export * from './rbac';
export * from './report';
export * from './reportFolder';
export * from './workspace';
