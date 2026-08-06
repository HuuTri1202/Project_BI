/**
 * Spike F1.7 — cube schema VIẾT TAY để kiểm chứng driver Cube ↔ ClickHouse.
 *
 * Chép file này vào ../cube/model/cubes/ (thư mục đang mount vào container Cube)
 * rồi Cube sẽ tự hot-reload.
 *
 * Ở F7, những file như thế này sẽ do Express SINH RA từ định nghĩa DataModel của
 * người dùng chứ không viết tay (ADR-08). Giữ bản viết tay ở đây làm mốc đối
 * chiếu: khi bộ sinh schema hỏng, so với file này là thấy ngay khác chỗ nào.
 */
cube(`SpikeOrders`, {
  sql_table: `bi_analytics.spike_orders`,

  measures: {
    count: {
      type: `count`,
    },
    total_amount: {
      sql: `amount`,
      type: `sum`,
    },
    avg_amount: {
      sql: `amount`,
      type: `avg`,
    },
  },

  dimensions: {
    order_id: {
      sql: `order_id`,
      type: `number`,
      primary_key: true,
    },
    region: {
      sql: `region`,
      type: `string`,
    },
    channel: {
      sql: `channel`,
      type: `string`,
    },
    // Cột time là chỗ dễ sai nhất: Cube giả định giá trị đã ở UTC.
    // Nguồn phải là DateTime64(3,'UTC') thì granularity day/week/month mới đúng.
    ordered_at: {
      sql: `ordered_at`,
      type: `time`,
    },
  },
});
