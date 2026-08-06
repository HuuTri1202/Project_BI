# Bản đồ cổng (port map)

Chốt **trước** khi thêm service, vì hai vụ đụng cổng dưới đây chắc chắn xảy ra
nếu để mặc định. Mọi thay đổi cổng phải cập nhật file này **và**
`infrastructure/.env.example` trong cùng một PR.

| Service | Profile | Cổng host | Cổng container | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| Frontend (Vite dev) | — | 5173 | — | ✅ | `strictPort: true` để lỗi ngay nếu bị chiếm |
| Backend (Express) | — | 4000 | — | ✅ | |
| MySQL | *luôn chạy* | **3310** | 3306 | ✅ | Không dùng 3306 để tránh đụng MySQL cài sẵn |
| Redis | *luôn chạy* | 6379 | 6379 | ✅ | ⚠️ xem cảnh báo bên dưới |
| MinIO API | `data` | 9000 | 9000 | ✅ | `@aws-sdk/client-s3` gọi vào đây |
| MinIO Console | `data` | 9001 | 9001 | ✅ | Giao diện web |
| ClickHouse HTTP | `data` `bi` `tools` | 8123 | 8123 | ✅ | dbt và `@clickhouse/client` dùng cổng này |
| ClickHouse native | `data` `bi` `tools` | **9002** | 9000 | ✅ | ⚠️ Native mặc định 9000 — **đụng MinIO API** |
| Cube.js | `bi` | **4100** | 4000 | ✅ | ⚠️ Cube mặc định 4000 — **đụng Express** |
| Kafka (host) | `stream` | **29092** | 29092 | ✅ | Listener riêng cho client trên host — xem bên dưới |
| Kafka (nội bộ) | `stream` | — | 9092 | ✅ | Container khác gọi `kafka:9092` |
| Kafka Connect | `stream` | 8083 | 8083 | ✅ | Debezium chạy trong đây |
| Strapi | `bi` | 1337 | 1337 | ⏳ chưa thêm (F4) | |

## Ba vụ đụng cổng phải nhớ

1. **Cube.js mặc định 4000 = cổng Express.** Đã map `4100:4000`.
2. **ClickHouse native mặc định 9000 = cổng MinIO API.** Đã map `9002:9000`.
   Cổng HTTP 8123 không đụng ai nên giữ nguyên.
3. **Kafka cần HAI listener.** Client trong `bi-network` và client trên máy host
   nhìn thấy hai địa chỉ khác nhau:
   - container khác → `kafka:9092`
   - máy host → `localhost:29092`

   Chỉ khai một listener thì client trên host sẽ nhận advertised address
   `kafka:9092` và không phân giải được tên đó — triệu chứng là "kết nối được
   rồi timeout khi gửi", rất khó đoán.

## ⚠️ Cổng dễ bị service cài sẵn trên máy chiếm

**Redis vẫn dùng 6379.** Nếu máy đã có Redis chạy nền (service Windows, Memurai,
hoặc `redis-server` **trong WSL**), `docker compose up` sẽ báo
`port is already allocated` — hoặc tệ hơn: backend kết nối được nhưng **nói
chuyện với nhầm Redis**, và `/health/ready` vẫn báo xanh.

```powershell
# Windows: xem tiến trình nào đang giữ 6379
Get-NetTCPConnection -LocalPort 6379 -State Listen | ForEach-Object { Get-Process -Id $_.OwningProcess }
Get-Service Redis        # service Windows
```
```bash
# WSL cũng tự forward cổng sang localhost của Windows
wsl -e sudo service redis-server stop
wsl -e sudo systemctl disable redis-server
```

Kiểm tra chắc chắn đang nói chuyện với Redis của Docker:
```bash
docker exec bi-redis redis-cli -a redispassword --no-auth-warning info server | grep -E "redis_version|^os:"
# phải ra redis_version:7.x  /  os:Linux ... (từ image alpine)
```

Nếu không muốn đụng vào Redis kia, đặt `REDIS_PORT=6380` trong **cả**
`infrastructure/.env` và `backend/.env`.

## Kiểm tra cổng đang bị chiếm

```powershell
# Windows (PowerShell)
Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
```
```bash
# Linux / macOS / Git Bash
lsof -i :4000
```

## Nguyên tắc

- **Cổng bên trong container giữ nguyên mặc định của image.** Chỉ đổi cổng map
  ra host. Nhờ vậy giao tiếp service-to-service qua `bi-network` không cần biết
  host đã map thế nào.
- Ví dụ: Cube kết nối ClickHouse bằng `clickhouse:8123` (**không phải**
  `localhost:8123`), Connect kết nối Kafka bằng `kafka:9092` (**không phải**
  `localhost:29092`).
