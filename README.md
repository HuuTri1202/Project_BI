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
| **Xác thực người dùng** (đăng ký, đăng nhập, JWT trong cookie httpOnly) | ✅ chạy được — xem mục *Xác thực* |
| Đa tổ chức: Tenant → Workspace → Project | ✅ schema + tự tạo khi đăng ký |
| Xác thực email / quên mật khẩu | ❌ **chưa có** — chưa có kênh gửi mail |
| Phân quyền (Casbin) / ingest / Cube schema / chart | ⏳ chưa làm |

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

npm run setup        # tạo 3 file .env + npm install + build gói shared
npm run infra:up     # bật MySQL + Redis, chờ tới khi healthy
npm run db:migrate   # tạo bảng users/tenants/workspaces/projects/memberships
```

`npm run setup` **không bao giờ ghi đè** file `.env` đã có, nên chạy lại lúc nào
cũng an toàn. Repo dùng **npm workspaces** (`shared`, `backend`, `frontend`) nên
chỉ có **một** `package-lock.json` ở thư mục gốc và chỉ cần `npm install` một
lần ở đó.

> ⚠️ **Nếu bạn đã có `backend/.env` từ trước:** bản này thêm 4 biến bắt buộc và
> `init-env.mjs` cố ý không ghi đè file cũ, nên backend sẽ **thoát ngay lúc
> khởi động** cho tới khi bạn thêm chúng vào:
>
> ```dotenv
> JWT_SECRET=doi-gia-tri-nay-bang-mot-chuoi-ngau-nhien-toi-thieu-32-ky-tu
> JWT_ACCESS_TTL=1h
> AUTH_COOKIE_NAME=bi_session
> BCRYPT_COST=12
> ```

### Chạy hằng ngày — 2 lệnh, 2 terminal

```bash
# Terminal 1 — hạ tầng (chỉ cần chạy khi mới bật máy)
npm run infra:up

# Terminal 2 — shared + backend + frontend cùng lúc
npm run dev
```

`npm run db:migrate` chỉ cần chạy lại khi có file mới trong
`backend/migrations/`. Nó theo dõi bằng bảng `schema_migrations` nên chạy thừa
không gây hại — lần thứ hai chỉ in "Không có migration mới".

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
├── package.json              # npm workspaces + script điều phối
├── scripts/init-env.mjs      # tạo .env từ .env.example, đa nền tảng
├── shared/                   # @bi/shared — code dùng chung backend ↔ frontend
│   └── src/
│       ├── auth.ts           #   rule validate zod (viết MỘT lần, dùng hai phía)
│       └── dto.ts            #   kiểu dữ liệu đi qua dây + mã lỗi
├── backend/                  # Express + TypeScript (API Gateway / BFF)
│   ├── migrations/           # *.sql — schema ứng dụng, chạy bằng npm run db:migrate
│   ├── tests/                # NGOÀI src/ để tsc không gói test vào dist/
│   └── src/
│       ├── api/              # Route handler — chỉ tầng HTTP
│       │   ├── health.ts     #   liveness + readiness
│       │   └── v1/auth/      #   register / login / me / logout
│       ├── modules/auth/     # nghiệp vụ: service, repository, bcrypt, JWT
│       ├── db/               # migrate.ts, tx.ts (transaction), id.ts (UUIDv7)
│       ├── config/           # env, mysql, redis (singleton dùng chung)
│       ├── errors/           # AppError — lỗi có chủ đích, phân biệt với bug
│       ├── middleware/       # errorHandler, asyncHandler, requireAuth, rateLimit
│       ├── app.ts            # dựng Express app (không listen) — để test dùng lại
│       └── index.ts          # bootstrap: listen + graceful shutdown
├── frontend/                 # React 18 + TypeScript + Vite + react-router
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

> Đây là **tài khoản hạ tầng**, không phải tài khoản người dùng ứng dụng. Tài
> khoản người dùng tạo qua `POST /api/v1/auth/register` — xem mục *Xác thực*.

---

## Lệnh thường dùng

Chạy ở **thư mục gốc** — tất cả đều tác động lên cả backend lẫn frontend:

```bash
npm run setup          # tạo .env + cài dependency + build gói shared
npm run dev            # chạy shared + backend + frontend song song (Ctrl+C tắt hết)
npm run dev:api        # chỉ backend
npm run dev:web        # chỉ frontend

npm run db:migrate     # áp dụng backend/migrations/*.sql (idempotent)

npm run lint           # ESLint cả 3 workspace
npm run typecheck      # tsc --noEmit cả 3
npm run format         # Prettier ghi đè cả 3
npm run build          # build production cả 3
npm test               # Vitest — test đơn vị backend + frontend, không cần container
npm run test:integration  # test cần MySQL + Redis, chạy trên bi_platform_test
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

Vẫn chạy được trực tiếp trong từng thư mục nếu muốn (`cd backend && npm run dev`),
hoặc nhắm vào một workspace từ gốc: `npm --workspace backend run dev`.

> **`shared` phải được build trước `backend` và `frontend`.** Cả hai import
> `@bi/shared` như một package thật (đọc `dist/`), không phải import file `.ts`
> chéo thư mục — nếu import chéo, `tsc` của backend sẽ báo TS6059 vì
> `rootDir: "src"`. `npm run build`, `typecheck`, `test` và `verify` đều đã tự
> chạy `build:shared` trước, còn `npm run dev` thì mở kèm một tiến trình
> `tsc --watch` cho nó.

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
  chỉ có đúng những gói đang được import. Cài từ thư mục gốc, nhắm workspace:
  ```bash
  npm --workspace frontend install @tanstack/react-query   # khi thật sự cần cache/retry
  ```
- **Luật validate viết một lần trong `shared/src/auth.ts`.** Backend `.extend()`
  thêm phần chuẩn hoá (hạ chữ thường, đổi SĐT về `+84`), frontend dùng nguyên
  bản. Đừng chép luật sang phía kia — frontend chặt hơn backend nghĩa là người
  dùng bị chặn bởi một luật server không hề có.
- **Repository nhận `conn` làm tham số đầu tiên.** Hàm nào tự gọi `mysqlPool` sẽ
  lấy một connection khác, chạy ngoài transaction của caller, và `ROLLBACK` sẽ âm
  thầm để lại dữ liệu mồ côi. Xem `src/db/tx.ts`.
- **Mọi route `async` phải bọc `asyncHandler`.** Express 4 không chuyển promise
  reject sang error handler — thiếu nó thì request treo im lặng.
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

Keycloak đã bị gỡ ở `0f9e89d`. Thay thế nó là phần xác thực tự viết trong
Express: `bcrypt` + JWT đặt trong **cookie httpOnly**.

### Endpoint

| Method | Đường dẫn | Mô tả |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | Tạo user + tenant + workspace + membership trong **một transaction**, rồi đăng nhập luôn. `201` |
| POST | `/api/v1/auth/login` | `200` kèm tenant + workspace đang hoạt động |
| GET | `/api/v1/auth/me` | Khôi phục phiên sau khi F5 — trả user, role, tenant, workspaces |
| POST | `/api/v1/auth/logout` | Xoá cookie. `204` |

### Mô hình dữ liệu

```
tenants ──< workspaces ──< projects
   │
   └──< memberships >── users        memberships cũng CHÍNH LÀ bảng gán vai trò
              │
              └── roles: tenant_admin | creator | viewer
```

Một lần đăng ký tạo ra:

| Bảng | Nội dung | Nguồn |
| --- | --- | --- |
| `users` | thông tin người dùng | form đăng ký |
| `tenants` | **công ty** | ô *Tên công ty* trên form |
| `workspaces` | `Không gian làm việc mặc định` | cố định, người dùng đổi sau |
| `memberships` | gắn user vào tenant với vai trò `tenant_admin` | suy ra |

`tenants.name` **không unique**: hai người khai trùng tên công ty vẫn ra hai tổ
chức riêng biệt. Đây là chủ ý — "FPT Software" ở hai nơi hoàn toàn có thể là hai
tổ chức khác nhau, còn gộp nhầm hai công ty thành một là để lộ dữ liệu giữa các
khách hàng. Muốn vào chung một công ty thì phải qua **lời mời** (chưa làm), không
phải qua việc gõ trùng tên.

`users` **không có `tenant_id`** và email là unique **toàn cục** — một người là
một định danh, một mật khẩu. Việc thuộc tổ chức nào nằm ở `memberships`. Kiểu
unique-theo-tenant (một người ở hai tổ chức = hai dòng, hai mật khẩu) làm việc
đăng nhập bằng email trở nên nhập nhằng và là kiểu khó đảo ngược nhất khi đã có
dữ liệu thật.

Người đăng ký là người tạo ra tenant nên nhận vai trò `tenant_admin`. Người được
mời về sau sẽ mặc định `viewer` (đặc quyền tối thiểu) — phần mời chưa làm.

Một dòng `memberships(user_id, tenant_id, role_code)` ánh xạ đúng 1:1 sang dòng
`g, <user>, <role>, <domain>` của Casbin với domain = tenant. Khi Casbin về,
bảng `casbin_rule` chỉ chứa các dòng `p`; schema này không phải đổi gì.

### Hai token, đừng nhầm

- **Cookie phiên** (`bi_session`, HS256, mặc định 1 giờ) chỉ mang `sub`, `tid`,
  `role`. Cố ý **không** mang `projectIds`: chúng đổi ngay khi tạo project mới,
  không giới hạn số lượng, và là dữ liệu phân quyền chứ không phải xác thực.
- **Token Cube** do `POST /api/v1/query` tự ký, sống ~2 phút, dùng
  `CUBEJS_API_SECRET`, và `securityContext` của nó mới là chỗ mang `projectIds`
  tra từ database. Phần này chưa làm.

### Chưa có, và biết là chưa có

- **Xác thực email và quên mật khẩu.** Chưa có kênh gửi mail nào trong hạ tầng.
  Hệ quả trực tiếp: **quên mật khẩu là mất tài khoản**, chỉ reset được bằng SQL
  tay. Cột `users.email_verified_at` và giá trị `status='pending_verification'`
  đã có sẵn để bật lên sau mà không cần migration phá vỡ.
- **CSRF chỉ được chặn ở mức tối thiểu:** `SameSite=Lax`, API chỉ nhận JSON (cố
  ý không mount `express.urlencoded`), mọi mutation là POST, cộng một lớp kiểm
  `Origin`. Chưa có double-submit token — sẽ cần khi có subdomain anh em.
- **Chưa có refresh token.** Hết 1 giờ là phải đăng nhập lại.

### Chạy test tích hợp

Cần MySQL + Redis đang chạy. Dùng database riêng để không đụng dữ liệu dev:

```powershell
docker exec bi-mysql mysql -uroot -prootpassword -e "CREATE DATABASE IF NOT EXISTS bi_platform_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; GRANT ALL ON bi_platform_test.* TO 'bi_user'@'%'; FLUSH PRIVILEGES;"
$env:MYSQL_DATABASE='bi_platform_test'; npm --workspace backend run migrate; Remove-Item Env:\MYSQL_DATABASE
npm run test:integration
```

---

## Sự cố thường gặp

| Triệu chứng | Nguyên nhân & cách xử lý |
| --- | --- |
| `$'\r': command not found` khi chạy `.sh` | File bị CRLF. `git rm --cached -r . && git reset --hard` |
| Backend thoát ngay, in `[env] Cấu hình môi trường không hợp lệ` | Thiếu biến trong `.env`. Đối chiếu với `.env.example` — bản này thêm `JWT_SECRET`, `JWT_ACCESS_TTL`, `AUTH_COOKIE_NAME`, `BCRYPT_COST` |
| API trả 500, log `Table 'bi_platform.users' doesn't exist` | Chưa chạy `npm run db:migrate` |
| `/auth/me` luôn trả 401 dù login trả 200 | Trình duyệt từ chối cookie. Kiểm `NODE_ENV` — `secure: true` không dùng được trên `http://` |
| Frontend build báo `"loginSchema" is not exported by shared/dist/...` | Gói `shared` chưa build lại sau khi sửa. `npm run build:shared` |
| `npm install` ở `backend/` báo lạ | Repo dùng workspaces — chạy `npm install` ở **thư mục gốc** |
| `/health/ready` trả 503 | Container chưa chạy hoặc sai password. `docker compose ps` |
| Cube báo `ECONNREFUSED` tới ClickHouse | Mount cả thư mục `config.d` dạng `:ro` chặn image ghi `docker_related_config.xml`, ClickHouse chỉ nghe `127.0.0.1`. Compose đã mount từng file — đừng đổi lại |
| Kafka client trên host timeout | Phải dùng `localhost:29092` (listener `PLAINTEXT_HOST`), không phải 9092 |
| `port is already allocated` khi `docker compose up` | Máy đã có service giữ cổng đó (hay gặp: Redis/Memurai giữ 6379). Xem [docs/ports.md](docs/ports.md) |
| `EADDRINUSE :::4000` | Còn tiến trình backend cũ. Windows: `Get-NetTCPConnection -LocalPort 4000 -State Listen` rồi `Stop-Process` |
| `docker: daemon is not running` | Mở Docker Desktop rồi chạy lại |
