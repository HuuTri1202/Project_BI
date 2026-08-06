-- =============================================================================
-- Spike F1.7 — dữ liệu tối thiểu để chứng minh Cube.js đọc được ClickHouse.
--
-- Đây KHÔNG phải schema thật của hệ thống. Bảng thật sẽ do backend sinh ra ở F5
-- (raw_*) và dbt dựng ở F6 (marts). File này tồn tại để trả lời đúng một câu hỏi
-- ở tuần 1: "driver Cube ↔ ClickHouse có thật sự chạy không?" — mắt xích rủi ro
-- nhất của cả kiến trúc (R2).
--
-- Chạy:
--   docker exec -i bi-clickhouse clickhouse-client --user bi_user \
--     --password clickhouse_password --multiquery < 01-clickhouse-seed.sql
-- =============================================================================

DROP TABLE IF EXISTS bi_analytics.spike_orders;

CREATE TABLE bi_analytics.spike_orders
(
    order_id    UInt64,
    region      LowCardinality(String),
    channel     LowCardinality(String),
    amount      Decimal(18, 2),

    -- DateTime64(3,'UTC') là quy ước BẮT BUỘC của dự án cho mọi cột thời gian.
    -- Dùng DateTime trần (không chỉ định timezone) thì ClickHouse lấy timezone
    -- của server, còn Cube giả định UTC -> lệch nhau đúng 7 tiếng, và biểu hiện
    -- ra ngoài là báo cáo lệch 1 ngày ở các đơn hàng gần nửa đêm. Loại bug này
    -- rất khó truy vì nó chỉ sai với một phần dữ liệu.
    ordered_at  DateTime64(3, 'UTC')
)
ENGINE = MergeTree()
ORDER BY (ordered_at, order_id);

INSERT INTO bi_analytics.spike_orders (order_id, region, channel, amount, ordered_at) VALUES
    (1,  'Hà Nội',        'online',  1500000.00, '2026-07-01 09:15:00.000'),
    (2,  'Hà Nội',        'store',    850000.00, '2026-07-01 14:40:00.000'),
    (3,  'Hồ Chí Minh',   'online',  2300000.00, '2026-07-02 10:05:00.000'),
    (4,  'Hồ Chí Minh',   'online',  1750000.00, '2026-07-02 16:20:00.000'),
    (5,  'Hồ Chí Minh',   'store',    990000.00, '2026-07-03 11:00:00.000'),
    (6,  'Đà Nẵng',       'online',   640000.00, '2026-07-03 08:30:00.000'),
    (7,  'Đà Nẵng',       'store',    420000.00, '2026-07-04 13:10:00.000'),
    (8,  'Hà Nội',        'online',  3100000.00, '2026-07-05 19:45:00.000'),
    (9,  'Cần Thơ',       'store',    280000.00, '2026-07-05 07:55:00.000'),
    (10, 'Hồ Chí Minh',   'online',  4200000.00, '2026-07-06 21:30:00.000');

-- Kết quả mong đợi (dùng để đối chiếu với số Cube trả về):
--   Hồ Chí Minh   9240000.00 / 4 đơn
--   Hà Nội        5450000.00 / 3 đơn
--   Đà Nẵng       1060000.00 / 2 đơn
--   Cần Thơ        280000.00 / 1 đơn
--   TỔNG         16030000.00 / 10 đơn
SELECT region, sum(amount) AS total, count() AS orders
FROM bi_analytics.spike_orders
GROUP BY region
ORDER BY total DESC;
