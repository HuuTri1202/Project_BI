# BI Platform

Nền tảng **Self-Service BI & Data Analytics** — người dùng nghiệp vụ tự tải dữ
liệu lên, định nghĩa mô hình ngữ nghĩa, kéo-thả ra biểu đồ và chia sẻ dashboard
mà **không cần viết SQL**.

Đồ án tốt nghiệp, tài liệu kiến trúc theo chuẩn **arc42**.

---

## Trạng thái hiện tại

| Phần | Trạng thái |
| --- | --- |
| Hạ tầng dev — 8 container (MySQL, Redis, MinIO, ClickHouse, Cube.js, Kafka, Connect, dbt) | ✅ chạy được |
| Backend skeleton (Express + health check thật) | ✅ chạy được |
| Frontend skeleton (React + Vite) | ✅ chạy được |
| **Xác thực người dùng** | ❌ **chưa có** — xem mục *Xác thực* |
| Phân quyền / ingest / Cube schema / chart | ⏳ chưa làm |

Xem lộ trình đầy đủ và phân công theo tính năng trong tài liệu kế hoạch của nhóm.

---

## Yêu cầu máy

| Công cụ | Phiên bản | Ghi chú |
| --- | --- | --- |
| Node.js | ≥ 20 | Khuyến nghị 20 LTS hoặc 22 LTS |
| Docker Desktop | mới nhất | Phải đang **chạy**, không chỉ cài |
| Git | ≥ 2.40 | |
| Git Bash | (Windows) | Các script `.sh` là bash, không chạy được bằng CMD/PowerShell |

RAM tối thiểu **8 GB**, khuyến nghị **16 GB** (bật đủ profile là 8 container).

---

## Khởi chạy lần đầu

```bash
git clone https://github.com/HuuTri1202/Project_BI.git
cd Project_BI

npm install          # cài concurrently ở thư mục gốc
npm run setup        # tạo 3 file .env + npm install cho backend & frontend
```

`npm run setup` **không bao giờ ghi đè** file `.env` đã có, nên chạy lại lúc nào
cũng an toàn.

### Chạy hằng ngày — 2 lệnh, 2 terminal

```bash
# Terminal 1 — hạ tầng (chỉ cần chạy khi mới bật máy)
npm run infra:up

# Terminal 2 — backend + frontend cùng lúc
npm run dev
```

- `infra:up` kiểm tra Docker → khởi động MySQL + Redis → chờ tới khi **thật sự**
  healthy (không chỉ "đã start") → in thông tin kết nối. Lần đầu mất khoảng
  **1–2 phút** vì MySQL phải khởi tạo data directory.
- `dev` chạy song song backend và frontend, log gắn nhãn `[api]` / `[web]` theo
  màu. **Ctrl+C tắt cả hai.**

| Địa chỉ | |
| --- | --- |
| http://localhost:5173 | Frontend — hiển thị JSON health của backend nếu cả hai chạy đúng |
| http://localhost:4000/health | Backend |

### Profile — chỉ bật phần đang cần

8 container không nên cùng chạy suốt ngày. `npm run infra:up` chỉ khởi động
service lõi; phần còn lại chia theo profile:

| Lệnh | Thêm gì | Bật khi bắt đầu làm |
| --- | --- | --- |
| `npm run infra:up` | MySQL, Redis | **luôn luôn** — đăng ký, đăng nhập, quản trị user, mọi metadata |
| `npm run infra:up:data` | MinIO, ClickHouse | **nạp dữ liệu**: upload CSV, presigned URL, bảng `raw_*` |
| `npm run infra:up:bi` | Cube.js (+ ClickHouse) | **tầng ngữ nghĩa**: DataModel, Explore kéo-thả, chart |
| `npm run infra:up:all` | + Kafka, Connect, dbt | **dbt / CDC realtime**, hoặc demo toàn hệ thống |

Tắt lại phần không dùng để trả RAM:

```bash
npm run infra:down:extra   # tắt MinIO/ClickHouse/Cube/Kafka/Connect/dbt, giữ MySQL + Redis
npm run infra:down         # tắt tất cả
```

> **Container đã tạo sẽ tự chạy lại mỗi lần bật Docker Desktop** (`restart:
> unless-stopped`). Muốn chúng thôi hẳn thì phải xoá container chứ không chỉ
> stop — `npm run infra:down:extra` làm đúng việc đó. Volume dữ liệu vẫn giữ
> nguyên, bật lại là có đủ dữ liệu cũ.

Toàn bộ container ở trạng thái nghỉ tốn khoảng **1,7 GB** RAM. Mỗi service đều
có trần bộ nhớ riêng trong `docker-compose.yml`, xem bằng `npm run infra:stats`.

Muốn khỏi gõ cờ profile mỗi lần: đặt `COMPOSE_PROFILES=data,bi` trong
`infrastructure/.env`.

> **Backend và frontend cố ý KHÔNG chạy trong Docker khi dev.** Mã nguồn nằm
> trên ổ Windows, bind mount vào container phải đi qua lớp 9p/drvfs của WSL2 nên
> sự kiện `inotify` không truyền qua được — `tsx watch` và Vite HMR sẽ mù. Chữa
> bằng polling thì HMR trễ 2–5 giây và CPU chạy nền liên tục. Dockerfile cho
> backend/frontend sẽ được thêm ở giai đoạn triển khai K8s, dùng cho **chạy**
> chứ không dùng để **code**.

---

## Cấu trúc thư mục

```
bi-flatform/
├── package.json              # script điều phối (npm run dev chạy cả 2 package)
├── scripts/init-env.mjs      # tạo .env từ .env.example, đa nền tảng
├── backend/                  # Express + TypeScript (API Gateway / BFF)
│   └── src/
│       ├── api/              # Route handler
│       │   ├── health.ts     #   liveness + readiness
│       │   └── v1/           #   API nghiệp vụ
│       ├── config/           # env, mysql, redis (singleton dùng chung)
│       ├── middleware/       # errorHandler, sau này: authenticate, authorize
│       ├── app.ts            # dựng Express app (không listen) — để test dùng lại
│       └── index.ts          # bootstrap: listen + graceful shutdown
├── frontend/                 # React 18 + TypeScript + Vite
├── infrastructure/
│   ├── docker-compose.yml    # ⚠️ Dev A sở hữu độc quyền — xem quy ước bên dưới
│   ├── start-dev.sh          # khởi động môi trường dev (service lõi)
│   ├── mysql/init/           # SQL chạy khi volume MySQL còn rỗng
│   ├── minio/                # script tạo bucket
│   ├── clickhouse/           # config.d (trần RAM) + users.d (trần mỗi query)
│   ├── cube/                 # cube.js + model/cubes/ (F7 sinh file vào đây)
│   ├── dbt/                  # Dockerfile + profiles.yml + dbt_project.yml
│   └── spike/                # chứng minh Cube ↔ ClickHouse chạy (F1.7)
└── docs/
    └── ports.md              # bản đồ cổng — đọc trước khi thêm service
```

---

## Cổng

Bảng đầy đủ ở [docs/ports.md](docs/ports.md). Những cổng đang dùng:

| Service | URL | Profile |
| --- | --- | --- |
| Frontend | http://localhost:5173 | — |
| Backend | http://localhost:4000 | — |
| MySQL | `localhost:3310` | *luôn chạy* |
| Redis | `localhost:6379` | *luôn chạy* |
| MinIO console | http://localhost:9001 | `data` |
| ClickHouse | http://localhost:8123 | `data` |
| Cube.js | http://localhost:4100 | `bi` |
| Kafka Connect | http://localhost:8083 | `stream` |

> MySQL dùng **3310** thay vì 3306, ClickHouse native dùng **9002** thay vì 9000
> (đụng MinIO), Cube dùng **4100** thay vì 4000 (đụng Express). Đều là chủ ý,
> không phải nhầm lẫn — xem [docs/ports.md](docs/ports.md).

---

## Tài khoản dev

Chỉ dùng ở local.

| Service | User | Mật khẩu |
| --- | --- | --- |
| MySQL | `bi_user` | `bi_password` |
| Redis | — | `redispassword` |
| MinIO | `minioadmin` | `minioadmin123` |
| ClickHouse | `bi_user` | `clickhouse_password` |

> **Hệ thống hiện chưa có xác thực người dùng.** Xem mục *Xác thực* bên dưới.

---

## Lệnh thường dùng

Chạy ở **thư mục gốc** — tất cả đều tác động lên cả backend lẫn frontend:

```bash
npm run setup          # tạo .env + cài dependency cho cả 2 package
npm run dev            # chạy backend + frontend song song (Ctrl+C tắt cả hai)
npm run dev:api        # chỉ backend
npm run dev:web        # chỉ frontend

npm run lint           # ESLint cả 2
npm run typecheck      # tsc --noEmit cả 2
npm run format         # Prettier ghi đè cả 2
npm run build          # build production cả 2
npm test               # Vitest (backend)
npm run verify         # lint + typecheck + build — CHẠY TRƯỚC KHI MỞ PR

npm run infra:up       # service lõi: MySQL + Redis
npm run infra:up:data  # + MinIO, ClickHouse
npm run infra:up:bi    # + Cube.js (kéo theo ClickHouse)
npm run infra:up:all   # cả 8 container
npm run infra:ps       # trạng thái container
npm run infra:stats    # RAM/CPU từng container
npm run infra:logs     # theo dõi log
npm run infra:down     # dừng container, giữ dữ liệu
```

Vẫn chạy được trực tiếp trong từng thư mục nếu muốn (`cd backend && npm run dev`).

Các lệnh Docker ít dùng hơn:

```bash
cd infrastructure
./start-dev.sh --recreate   # tạo lại container, giữ dữ liệu
./start-dev.sh --logs       # khởi động xong thì theo dõi log
docker compose down -v      # xoá cả dữ liệu — cẩn thận
```

---

## Kiểm tra sức khoẻ hệ thống

| Endpoint | Ý nghĩa | Dùng để |
| --- | --- | --- |
| `GET /health` | **Liveness** — process còn sống. Không đụng dependency | `livenessProbe` của K8s |
| `GET /health/ready` | **Readiness** — ping thật MySQL + Redis, trả **503** nếu hỏng | `readinessProbe` của K8s |

Cách kiểm chứng `/health/ready` hoạt động thật:

```bash
curl -s localhost:4000/health/ready               # 200, mysql/redis đều "ok"
docker compose stop redis
curl -i localhost:4000/health/ready               # 503, redis báo lỗi
docker compose start redis
```

---

## Quy ước làm việc

### Nhánh và Pull Request

```bash
git switch -c feat/f5-ingest-clickhouse
# ... code ...
git push -u origin feat/f5-ingest-clickhouse
# mở PR -> người còn lại review -> squash merge vào main
```

- Đặt tên nhánh: `feat/f{số}-{mô-tả}`, `fix/{mô-tả}`, `docs/{mô-tả}`
- **Không push thẳng vào `main`.**
- Trước khi mở PR, chạy `npm run lint && npm run typecheck && npm run build` ở
  package bạn đã sửa.

### Phân chia sở hữu file

| Vai trò | Sở hữu |
| --- | --- |
| **Dev A** — Data & Platform | `infrastructure/`, `cube/`, `dbt/`, `backend/src/services/` |
| **Dev B** — Application & Experience | `backend/src/api/`, `backend/src/middleware/`, `strapi/`, toàn bộ `frontend/` |

> **`infrastructure/docker-compose.yml` do Dev A sở hữu ĐỘC QUYỀN.** Đây là file
> dễ conflict nhất repo. Cần thêm service thì nhắn Dev A, đừng tự sửa.

### Quy ước code

- **Backend không dùng alias `@/`.** `tsx` hiểu alias nhưng `tsc` không viết lại
  đường dẫn khi build → `node dist/index.js` sẽ chết với
  `Cannot find module '@/config/env'`. Backend dùng import tương đối.
  Frontend **được** dùng `@/` vì Vite xử lý lúc bundle.
- **Không đọc `process.env` trực tiếp.** Import `env` từ `src/config/env.ts` —
  nó validate bằng zod lúc boot và có kiểu đầy đủ.
- **Dependency được thêm trong chính PR dùng nó**, không cài trước để đó. Repo
  hiện chỉ có đúng những gói đang được import. Khi làm tới, cài lại:
  ```bash
  # đăng ký / đăng nhập
  npm --prefix backend  install bcryptjs jsonwebtoken
  npm --prefix backend  install -D @types/jsonwebtoken
  npm --prefix frontend install react-router-dom axios
  # gọi API có cache/retry (khi thật sự cần)
  npm --prefix frontend install @tanstack/react-query
  ```
- **Không commit file `.env`.** Đổi biến môi trường thì phải cập nhật
  `.env.example` trong cùng PR, nếu không máy người kia sẽ hỏng.
- Line ending do `.gitattributes` quản lý. Nếu script bash báo
  `$'\r': command not found` nghĩa là file bị CRLF — đừng sửa tay, chạy:
  ```bash
  git rm --cached -r . && git reset --hard
  ```

---

## Kiến trúc mục tiêu

```
React + Vega-Lite  ──►  Express (BFF)  ──►  Cube.js  ──►  ClickHouse
                             │                                 ▲
                             ├── Casbin  (RBAC theo domain)    │
                             ├── Strapi  (metadata BI)         │
                             ├── MySQL   (metadata vận hành)   │
                             ├── Redis   (cache phân quyền)    │
                             └── S3/MinIO ──► dbt ─────────────┤
                                                               │
                             MySQL binlog ──► Debezium ──► Kafka
```

**Ranh giới cần nhớ:**

- **Cube.js không bao giờ lộ ra trình duyệt.** Mọi truy vấn phân tích đi qua
  `POST /api/v1/query`: Express kiểm quyền, ký một JWT Cube ngắn hạn mang
  `securityContext`, rồi mới forward. Secret ký nằm ở `CUBEJS_API_SECRET`.
- **Strapi là nơi ghi metadata BI duy nhất.** Express chỉ gọi REST và cache đọc
  vào Redis; database `bi_platform` của Express chỉ chứa dữ liệu vận hành
  (ingest job, `casbin_rule`, audit log).

---

## Xác thực

**Hiện tại hệ thống KHÔNG có xác thực người dùng.** Keycloak đã được gỡ bỏ hoàn
toàn khỏi codebase; chưa có gì thay thế.

Hệ quả cần biết trước khi làm tiếp:

- Mọi endpoint `/api/v1/*` đang mở, ai gọi cũng được.
- **Casbin chưa làm được.** Phân quyền cần một `sub` (định danh người dùng) để
  quyết định; không có nguồn định danh thì không có gì để enforce.
- **Query proxy `POST /api/v1/query` chưa an toàn được.** `securityContext` gửi
  cho Cube phải mang `userId` + `projectIds` thì row-level security mới có ý
  nghĩa.

Vì vậy cần chốt phương án xác thực **trước** khi bắt đầu phân quyền và query
proxy. Ứng viên: tự viết trong Express (`bcrypt` + `jsonwebtoken`, bảng `users`
trong `bi_platform`), hoặc một IdP khác.

`jsonwebtoken` vẫn nằm trong dependency vì Cube query proxy cần nó để ký token
ngắn hạn — việc này độc lập với xác thực người dùng.

---

## Sự cố thường gặp

| Triệu chứng | Nguyên nhân & cách xử lý |
| --- | --- |
| `$'\r': command not found` khi chạy `.sh` | File bị CRLF. `git rm --cached -r . && git reset --hard` |
| Backend thoát ngay, in `[env] Cấu hình môi trường không hợp lệ` | Thiếu biến trong `.env`. Đối chiếu với `.env.example` |
| `/health/ready` trả 503 | Container chưa chạy hoặc sai password. `docker compose ps` |
| Cube báo `ECONNREFUSED` tới ClickHouse | Mount cả thư mục `config.d` dạng `:ro` chặn image ghi `docker_related_config.xml`, ClickHouse chỉ nghe `127.0.0.1`. Compose đã mount từng file — đừng đổi lại |
| Kafka client trên host timeout | Phải dùng `localhost:29092` (listener `PLAINTEXT_HOST`), không phải 9092 |
| `port is already allocated` khi `docker compose up` | Máy đã có service giữ cổng đó (hay gặp: Redis/Memurai giữ 6379). Xem [docs/ports.md](docs/ports.md) |
| `EADDRINUSE :::4000` | Còn tiến trình backend cũ. Windows: `Get-NetTCPConnection -LocalPort 4000 -State Listen` rồi `Stop-Process` |
| `docker: daemon is not running` | Mở Docker Desktop rồi chạy lại |
