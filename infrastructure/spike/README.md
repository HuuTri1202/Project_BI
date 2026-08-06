# Spike F1.7 — Cube.js ↔ ClickHouse

Thư mục này tồn tại để trả lời **đúng một câu hỏi ở tuần 1**:

> Driver Cube.js ↔ ClickHouse có thật sự chạy không, và cột thời gian có bị lệch
> múi giờ không?

Đây là mắt xích rủi ro nhất của cả kiến trúc (rủi ro **R2**). Nếu nó hỏng, phát
hiện ở tuần 1 thì còn đổi được cách làm; phát hiện ở tuần 4 thì không.

## Chạy lại

```bash
cd infrastructure
docker compose --profile bi up -d

# 1. Nạp dữ liệu mẫu
docker exec -i bi-clickhouse clickhouse-client --user bi_user \
  --password clickhouse_password --multiquery < spike/01-clickhouse-seed.sql

# 2. Nạp cube schema (thư mục này được mount vào container Cube)
cp spike/SpikeOrders.js cube/model/cubes/

# 3. Truy vấn qua Cube
TOKEN=$(cd ../backend && node -e "console.log(require('jsonwebtoken').sign({},'cube-api-secret-change-me',{expiresIn:'10m'}))")
curl -s -H "Authorization: $TOKEN" -H "Content-Type: application/json" \
  -X POST http://localhost:4100/cubejs-api/v1/load \
  -d '{"query":{"measures":["SpikeOrders.total_amount"],"dimensions":["SpikeOrders.region"]}}'
```

## Kết quả đã đạt

| Vùng | Tổng tiền | Số đơn |
| --- | --- | --- |
| Hồ Chí Minh | 9 240 000 | 4 |
| Hà Nội | 5 450 000 | 3 |
| Đà Nẵng | 1 060 000 | 2 |
| Cần Thơ | 280 000 | 1 |

Số Cube trả về **trùng khớp** với `SELECT ... GROUP BY` chạy thẳng trên
ClickHouse. Gom theo `granularity: day` cũng ra đúng 6 ngày với đúng số đơn mỗi
ngày — **không lệch ngày**, tức quy ước `DateTime64(3,'UTC')` hoạt động đúng.

## Quan hệ với F7

Ở F7, file cube schema sẽ do **Express sinh ra** từ định nghĩa DataModel của
người dùng, ghi vào `cube/model/cubes/{dataModelId}.js` (ADR-08). Giữ
`SpikeOrders.js` viết tay ở đây làm **mốc đối chiếu**: khi bộ sinh schema cho ra
kết quả lạ, so với file này là thấy ngay khác chỗ nào.

Xoá thư mục này được sau khi F7 có schema thật và test tự động thay thế vai trò
kiểm chứng.
