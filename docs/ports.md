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
| ClickHouse HTTP | `data` `bi` | 8123 | 8123 | ✅ | `@clickhouse/client` và Cube dùng cổng này |
| ClickHouse native | `data` `bi` | **9002** | 9000 | ✅ | ⚠️ Native mặc định 9000 — **đụng MinIO API** |
| Cube.js | `bi` | **4100** | 4000 | ✅ | ⚠️ Cube mặc định 4000 — **đụng Express** |

Cột **Trạng thái** chỉ nhận ✅ khi có mã nguồn thật sự gọi vào cổng đó. Kafka
(29092), Kafka Connect (8083) và Strapi (1337) từng nằm trong bảng này với dấu ✅
hoặc ⏳; cả ba đã được gỡ khỏi `docker-compose.yml` vì chưa bao giờ có client.
Xem mục *Kiến trúc mục tiêu* trong README.

## Hai vụ đụng cổng phải nhớ

1. **Cube.js mặc định 4000 = cổng Express.** Đã map `4100:4000`.
2. **ClickHouse native mặc định 9000 = cổng MinIO API.** Đã map `9002:9000`.
   Cổng HTTP 8123 không đụng ai nên giữ nguyên.

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
  `localhost:8123`), còn backend chạy trên host thì gọi `localhost:8123`.
