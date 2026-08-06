# Bản đồ cổng (port map)

Chốt **trước** khi thêm service, vì hai vụ đụng cổng dưới đây chắc chắn xảy ra
nếu để mặc định. Mọi thay đổi cổng phải cập nhật file này **và** `.env.example`
tương ứng trong cùng một PR.

| Service | Cổng host | Cổng container | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- |
| Frontend (Vite dev) | 5173 | — | ✅ đang chạy | `strictPort: true` để lỗi ngay nếu bị chiếm |
| Backend (Express) | 4000 | — | ✅ đang chạy | |
| MySQL | **3310** | 3306 | ✅ đang chạy | Không dùng 3306 để tránh đụng MySQL cài sẵn trên máy |
| Redis | 6379 | 6379 | ✅ đang chạy | |
| Keycloak | **8081** | 8080 | ✅ đang chạy | 8080 hay bị chiếm bởi Tomcat/Jenkins/service khác |
| Strapi | 1337 | 1337 | ⏳ chưa thêm | |
| MinIO API | 9000 | 9000 | ⏳ chưa thêm | |
| MinIO Console | 9001 | 9001 | ⏳ chưa thêm | |
| ClickHouse HTTP | 8123 | 8123 | ⏳ chưa thêm | Cổng mà `@clickhouse/client` và dbt dùng |
| ClickHouse native | **9002** | 9000 | ⏳ chưa thêm | ⚠️ Native mặc định là 9000 — **đụng MinIO API** |
| Cube.js | **4100** | 4000 | ⏳ chưa thêm | ⚠️ Cube mặc định là 4000 — **đụng Express** |
| Kafka | 9092 | 9092 | ⏳ chưa thêm | KRaft, 1 broker, không ZooKeeper |
| Kafka Connect | 8083 | 8083 | ⏳ chưa thêm | Debezium chạy trong đây |

## Hai vụ đụng cổng phải nhớ

1. **Cube.js mặc định 4000 = cổng Express.** Đặt `CUBEJS_PORT=4100` trong
   docker-compose, map `4100:4000`.
2. **ClickHouse native mặc định 9000 = cổng MinIO API.** Map ra `9002:9000`.
   Cổng HTTP 8123 không đụng ai nên giữ nguyên.

## Cổng dễ bị service cài sẵn trên máy chiếm

Đây là lý do MySQL và Keycloak được map ra cổng khác mặc định. **Redis vẫn dùng
6379** nên nếu máy bạn đã có Redis/Memurai chạy nền, `docker compose up` sẽ báo
`port is already allocated`. Cách xử lý:

```bash
# Windows: xem tiến trình nào đang giữ 6379
Get-NetTCPConnection -LocalPort 6379 -State Listen | ForEach-Object { Get-Process -Id $_.OwningProcess }
```

Rồi hoặc dừng service đó, hoặc đặt `REDIS_PORT=6380` trong **cả**
`infrastructure/.env` và `backend/.env`.

## Kiểm tra cổng đang bị chiếm

```bash
# Windows (PowerShell)
Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue

# Linux / macOS / Git Bash
lsof -i :4000
```

## Nguyên tắc

- **Cổng bên trong container giữ nguyên mặc định của image.** Chỉ đổi cổng map
  ra host. Như vậy cấu hình nội bộ (service-to-service qua `bi-network`) không
  cần biết gì về việc host đã map thế nào.
- Ví dụ: Keycloak kết nối MySQL bằng `mysql:3306`, **không phải** `localhost:3310`.
