# BI Platform

Nền tảng **Self-Service BI & Data Analytics** — người dùng nghiệp vụ tự tải dữ
liệu lên, định nghĩa mô hình ngữ nghĩa, kéo-thả ra biểu đồ và chia sẻ dashboard
mà **không cần viết SQL**.

Đồ án tốt nghiệp, tài liệu kiến trúc theo chuẩn **arc42**.

---

## Trạng thái hiện tại

| Phần                                                                                      | Trạng thái                             |
| ----------------------------------------------------------------------------------------- | -------------------------------------- |
| Hạ tầng dev — 8 container (MySQL, Redis, MinIO, ClickHouse, Cube.js, Kafka, Connect, dbt) | ✅ chạy được                           |
| Backend (Express) + Frontend (React + Vite + Tailwind v4)                                 | ✅ chạy được                           |
| **Xác thực** — đăng ký, đăng nhập, JWT, đổi mật khẩu                                      | ✅ xong — xem mục _Xác thực_           |
| **Console vận hành hệ thống** (`/admin`) — nhìn xuyên mọi tổ chức                         | ✅ xong                                |
| **Khu người dùng** — trang chủ, project, workspace, thành viên, hồ sơ                     | ✅ xong                                |
| **Phân quyền Casbin** — 8 tài nguyên × 4 hành động, policy trong database                 | ✅ xong                                |
| **Kết nối CSDL & Kho dữ liệu** (§8) — MySQL, ClickHouse (SSL/TLS, xem trước dữ liệu)      | ✅ xong                                |
| **Nạp dữ liệu vào ClickHouse** (§9) — bảng `raw_*`, nạp nền, nạp lại nguyên tử            | ✅ xong                                |
| **Mô hình dữ liệu** (§10) — Cube schema, quan hệ, thước đo, Explorer                      | ✅ xong — xem mục _Mô hình dữ liệu_    |
| **Trình dựng biểu đồ** (§10.9) — kéo thả chiều/thước đo, 8 loại biểu đồ Vega-Lite         | ✅ xong — xem mục _Trình dựng biểu đồ_ |
| **Khu Báo cáo & khung nhiều biểu đồ** (§10.10) — mục sidebar riêng, tối đa 12 ô một khung | ✅ xong — xem mục _Khu Báo cáo_        |
| Bộ lọc dùng chung cả khung, chia sẻ báo cáo ra ngoài                                      | ⏳ chưa làm                            |

Xem lộ trình đầy đủ và phân công theo tính năng trong tài liệu kế hoạch của nhóm.

---

## Yêu cầu máy

| Công cụ        | Phiên bản | Ghi chú                                                       |
| -------------- | --------- | ------------------------------------------------------------- |
| Node.js        | ≥ 20      | Khuyến nghị 20 LTS hoặc 22 LTS                                |
| Docker Desktop | mới nhất  | Phải đang **chạy**, không chỉ cài                             |
| Git            | ≥ 2.40    |                                                               |
| Git Bash       | (Windows) | Các script `.sh` là bash, không chạy được bằng CMD/PowerShell |

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
cũng an toàn. Lúc tạo mới `backend/.env`, nó **tự sinh** `JWT_SECRET` và
`CONNECTION_ENCRYPTION_KEY` ngẫu nhiên cho riêng máy bạn — không phải chép tay,
và không máy nào trong nhóm dùng chung một bí mật.

> ⚠️ Đổi `CONNECTION_ENCRYPTION_KEY` sau khi đã lưu kết nối CSDL = mọi mật khẩu
> kết nối ngừng giải mã được và phải nhập lại. Không có đường khôi phục.

### Chạy hằng ngày — 2 lệnh, 2 terminal

```bash
# Terminal 1 — hạ tầng (chỉ cần chạy khi mới bật máy)
npm run infra:up

# Terminal 2 — backend + frontend cùng lúc
npm run dev
```

- `infra:up` kiểm tra Docker → khởi động **MySQL + Redis + MinIO + ClickHouse** →
  chờ tới khi **thật sự** healthy (không chỉ "đã start") → in thông tin kết nối.
  Lần đầu mất khoảng **1–2 phút** vì MySQL phải khởi tạo data directory, và thêm
  vài phút nữa nếu image ClickHouse (~1,5 GB) chưa có trong máy.
  MinIO nằm trong nhóm lõi vì mục §7 tải file lên cần nó: trình duyệt PUT file
  **thẳng** lên MinIO bằng URL ký sẵn, nên MinIO tắt thì backend vẫn trả `201`
  cho bước ký URL và log sạch bong, còn người dùng nhận "Có lỗi không xác định".
  ClickHouse vào nhóm lõi từ mục §9 vì nó là nơi dữ liệu phân tích **thật sự
  nằm** — không bật thì nút "Nạp vào kho phân tích" hỏng ở mọi máy.
  > Cái giá phải nói ra: nhóm lõi giờ ăn thêm ~2 GB RAM cho **mọi** người, kể cả
  > người chỉ sửa giao diện. Máy chật thì `docker compose stop clickhouse` —
  > phần còn lại chạy bình thường, chỉ mất chức năng nạp.
- `dev` chạy song song backend và frontend, log gắn nhãn `[api]` / `[web]` theo
  màu. **Ctrl+C tắt cả hai.**

| Địa chỉ                      |                                  |
| ---------------------------- | -------------------------------- |
| http://localhost:5173        | Frontend — mở ra trang đăng nhập |
| http://localhost:4000/health | Backend                          |

### Profile — chỉ bật phần đang cần

8 container không nên cùng chạy suốt ngày. `npm run infra:up` chỉ khởi động
service lõi; phần còn lại chia theo profile:

| Lệnh                    | Thêm gì                         | Bật khi bắt đầu làm                                        |
| ----------------------- | ------------------------------- | ---------------------------------------------------------- |
| `npm run infra:up`      | MySQL, Redis, MinIO, ClickHouse | **luôn luôn** — đăng nhập, tải file, nạp vào kho phân tích |
| `npm run infra:up:data` | (đã nằm trong lõi)              | không còn thêm gì so với `infra:up`                        |
| `npm run infra:up:bi`   | Cube.js (+ ClickHouse)          | **tầng ngữ nghĩa**: DataModel, Explore kéo-thả, chart      |
| `npm run infra:up:all`  | + Kafka, Connect, dbt           | **dbt / CDC realtime**, hoặc demo toàn hệ thống            |

Tắt lại phần không dùng để trả RAM:

```bash
npm run infra:down:extra   # tắt MinIO/ClickHouse/Cube/Kafka/Connect/dbt, giữ MySQL + Redis
npm run infra:down         # tắt tất cả
```

> **Container đã tạo sẽ tự chạy lại mỗi lần bật Docker Desktop** (`restart:
unless-stopped`). Muốn chúng thôi hẳn thì phải xoá container chứ không chỉ
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
│       │   ├── auth/         #   login / me / logout / change-password
│       │   ├── health.ts     #   liveness + readiness
│       │   └── v1/           #   API nghiệp vụ
│       ├── config/           # env, mysql, redis (singleton dùng chung)
│       ├── db/               # migration: schema + runner (KHÔNG dùng mysql/init)
│       ├── middleware/       # errorHandler, authenticate, requireRole
│       ├── repositories/     # truy vấn SQL — mọi hàm nhận tenantId đầu tiên
│       ├── services/auth/    # băm mật khẩu, ký/verify JWT, chống dò mật khẩu
│       ├── scripts/          # migrate, seed-admin
│       ├── app.ts            # dựng Express app (không listen) — để test dùng lại
│       └── index.ts          # bootstrap: migrate + listen + graceful shutdown
├── frontend/                 # React 18 + TypeScript + Vite + Tailwind v4
│   └── src/
│       ├── auth/             # AuthProvider, useAuth, tokenStorage, validators
│       ├── services/         # apiClient (axios + interceptor), authApi
│       ├── routes/           # ProtectedRoute, AdminRoute
│       ├── layouts/          # AdminLayout (sidebar + topbar)
│       ├── components/       # FormField, PasswordInput, FullPageLoader
│       ├── pages/            # Login, ChangePassword, Home, Health, 403, 404
│       └── index.css         # @import 'tailwindcss' + @theme (màu thương hiệu)
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

| Service       | URL                   | Profile     |
| ------------- | --------------------- | ----------- |
| Frontend      | http://localhost:5173 | —           |
| Backend       | http://localhost:4000 | —           |
| MySQL         | `localhost:3310`      | _luôn chạy_ |
| Redis         | `localhost:6379`      | _luôn chạy_ |
| MinIO console | http://localhost:9001 | `data`      |
| ClickHouse    | http://localhost:8123 | `data`      |
| Cube.js       | http://localhost:4100 | `bi`        |
| Kafka Connect | http://localhost:8083 | `stream`    |

> MySQL dùng **3310** thay vì 3306, ClickHouse native dùng **9002** thay vì 9000
> (đụng MinIO), Cube dùng **4100** thay vì 4000 (đụng Express). Đều là chủ ý,
> không phải nhầm lẫn — xem [docs/ports.md](docs/ports.md).

---

## Tài khoản dev

Chỉ dùng ở local.

| Service    | User         | Mật khẩu              |
| ---------- | ------------ | --------------------- |
| MySQL      | `bi_user`    | `bi_password`         |
| Redis      | —            | `redispassword`       |
| MinIO      | `minioadmin` | `minioadmin123`       |
| ClickHouse | `bi_user`    | `clickhouse_password` |

Tài khoản đăng nhập vào ứng dụng (tạo bằng `npm --prefix backend run seed:admin`):

| Vai trò               | Email                     | Mật khẩu      |
| --------------------- | ------------------------- | ------------- |
| Quản trị **hệ thống** | `admin@bi-platform.local` | `Admin@12345` |

Đây là tài khoản DUY NHẤT được tạo tự động. Các tài khoản thử nghiệm còn lại —
gồm cả một tài khoản thuộc hai tổ chức để thử bộ chuyển tổ chức, và một tài
khoản chỉ có quyền xem — được ghi trong
[docs/tai-khoan-thu-nghiem.md](docs/tai-khoan-thu-nghiem.md).

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

| Endpoint            | Ý nghĩa                                                       | Dùng để                  |
| ------------------- | ------------------------------------------------------------- | ------------------------ |
| `GET /health`       | **Liveness** — process còn sống. Không đụng dependency        | `livenessProbe` của K8s  |
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

| Vai trò                              | Sở hữu                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| **Dev A** — Data & Platform          | `infrastructure/`, `cube/`, `dbt/`, `backend/src/services/`                   |
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
- **CSS viết bằng Tailwind v4**, không viết file `.css` riêng cho từng
  component. Tailwind v4 **không có** `tailwind.config.js` — theme khai bằng
  khối `@theme` trong [frontend/src/index.css](frontend/src/index.css). Muốn
  đổi tông màu toàn hệ thống thì sửa các biến `--color-brand-*` ở đó, đừng rải
  mã màu vào từng file.
- **Mọi hàm repository nhận `tenantId` làm tham số đầu tiên.** Quên một
  `WHERE tenant_id` là dữ liệu tổ chức này lọt sang tổ chức khác. Chữ ký hàm là
  thứ duy nhất bắt được lỗi đó lúc biên dịch. Ngoại lệ duy nhất hiện nay là
  `findByEmailForLogin` — có ghi rõ lý do ngay tại chỗ.
- **Dependency được thêm trong chính PR dùng nó**, không cài trước để đó. Khi
  làm tới, cài lại:
  ```bash
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

Keycloak đã bị gỡ bỏ; thay bằng xác thực **tự viết trong Express**: `bcryptjs`
băm mật khẩu, `jsonwebtoken` ký JWT HS256.

### Bốn quyết định đã thống nhất giữa hai người

Đây là nền mà cả hai nhánh phải dựng lên. Đổi bất kỳ mục nào cũng phải bàn lại,
đừng tự sửa trên nhánh riêng.

1. **Khoá chính `BIGINT UNSIGNED AUTO_INCREMENT`.**
2. **Quan hệ user ↔ tổ chức nằm ở bảng nối `memberships`**, không phải cột
   `users.tenant_id`. Một người làm được ở nhiều tổ chức.
3. **Phiên lưu bằng `localStorage` + header `Authorization: Bearer`.**
4. **Vai trò khai bằng `ENUM`**, không dùng bảng tra cứu `roles`.

### Hai trục vai trò — đừng nhầm lẫn

```
users.role        ENUM('superadmin','user')          ← quyền trên HỆ THỐNG
memberships.role  ENUM('admin','creator','viewer')   ← quyền trong TỔ CHỨC
```

`superadmin` là người vận hành nền tảng, đứng ngoài mọi tổ chức. Người dùng
bình thường là `user`, và quyền thật của họ nằm ở `memberships.role` của từng
tổ chức. Một người có thể là `admin` ở công ty A nhưng chỉ `viewer` ở công ty B.

`requireRole('admin')` hỏi trục **tổ chức**. `superadmin` cố ý **không** được đi
tắt qua nó: cho phép thế là biến mọi kiểm tra quyền thành "trừ khi là
superadmin", và một tài khoản vận hành bị chiếm là mất sạch dữ liệu mọi tổ chức.
Muốn superadmin làm việc trong một tổ chức thì cấp cho họ `membership` thật.

### Năm bảng

```
tenants       tổ chức
users         định danh TOÀN CỤC — không có tenant_id, không có vai trò tổ chức
memberships   user_id + tenant_id + role  (UNIQUE user_id, tenant_id)
workspaces    thuộc tenant; UNIQUE (tenant_id, id) làm đích cho khoá ngoại ghép
projects      khoá ngoại GHÉP (tenant_id, workspace_id) → workspaces
```

Khoá ngoại ghép của `projects` khiến việc gắn project vào workspace của tổ chức
khác là **bất khả thi ở tầng database**, bất kể code phía trên làm gì — loại ràng
buộc mạnh hơn mọi lớp kiểm tra trong ứng dụng vì nó không quên được.

### Endpoint

| Method | Đường dẫn                   | Việc                                                                            |
| ------ | --------------------------- | ------------------------------------------------------------------------------- |
| POST   | `/api/auth/login`           | Trả `{ token, expiresIn, mustChangePassword, user, tenant, role, memberships }` |
| GET    | `/api/auth/me`              | Khôi phục phiên khi F5 — đọc lại từ DB, không tin payload token                 |
| POST   | `/api/auth/logout`          | 204 (JWT vô trạng thái, client tự bỏ token)                                     |
| POST   | `/api/auth/change-password` | 204                                                                             |

Mọi lỗi có cùng hình dạng `{ error, message, fields? }`.

### Route phía giao diện

| Đường dẫn          | Ai vào được                                   |
| ------------------ | --------------------------------------------- |
| `/login`           | Công khai; đã đăng nhập thì tự chuyển đi      |
| `/change-password` | Đã đăng nhập (miễn cổng mật khẩu tạm)         |
| `/`                | Đã đăng nhập                                  |
| `/system-health`   | Đã đăng nhập — trang kiểm tra kết nối backend |
| `/admin`           | Chỉ Admin, sai vai trò thì sang `/403`        |

> Trang kiểm tra kết nối đặt ở **`/system-health`**, không phải `/health`:
> Vite proxy `/health` thẳng sang Express nên đường dẫn đó không bao giờ tới
> được SPA.

### Điều hướng sau khi đăng nhập

```
1. mustChangePassword  → /change-password    (cổng cứng, chặn mọi route khác)
2. location.state.from → quay lại trang đang định vào
3. role === 'admin'    → /admin
4. còn lại             → /
```

### Những gì CHƯA có

- **Chưa có form/API đăng ký.** Tài khoản đầu tiên từ `seed:admin`; các tài
  khoản sau sẽ do Admin tạo. Cột `users.role` đã `DEFAULT 'viewer'`.
- **Chưa có refresh token** — hết hạn thì đăng nhập lại.
- **Đăng xuất chưa thu hồi token phía server.** JWT vô trạng thái nên token bị
  lộ vẫn dùng được tới lúc hết hạn. Muốn thu hồi thật cần danh sách chặn trên
  Redis (Redis đang chạy sẵn).
- **Chưa có "quên mật khẩu"** vì chưa có SMTP.
- **Chưa đổi được tổ chức trên giao diện.** Người thuộc nhiều tổ chức sẽ vào tổ
  chức cũ nhất (`ORDER BY memberships.id ASC`) — quy tắc ổn định, không tự đổi
  sau lưng người dùng. API đã trả sẵn mảng `memberships`, nên thêm menu đổi tổ
  chức về sau chỉ là việc của frontend + một endpoint cấp token mới.
- **`users.email` duy nhất toàn cục** vì form đăng nhập không có ô chọn tổ chức.
  Không cản trở việc một người thuộc nhiều tổ chức — đó là việc của `memberships`.
- **Token lưu `localStorage`** nên XSS đọc được. Đánh đổi có ý thức; muốn chắc
  hơn thì chuyển sang cookie `httpOnly`, chỉ phải sửa `apiClient.ts` +
  `tokenStorage.ts` + phần set cookie ở backend.

### Lưu ý về phân quyền

`AdminRoute` ở frontend **không phải là bảo mật** — nó chỉ giúp người dùng khỏi
lạc vào trang không dùng được. Thực thi thật là `authenticate` →
`requireRole('admin')` gắn cho router `/api/admin`; hai middleware đó đã có
nhưng chưa có endpoint `/api/admin` nào để gắn vào.

Casbin và query proxy giờ đã có `sub` để làm việc: `req.auth` mang
`{ userId, role, tenantId }`.

---

## Chọn database khi tạo kết nối (§8.2)

Ô "Database" trong wizard **không còn là ô gõ tay** — nó là danh sách máy chủ trả
về, kèm số bảng mỗi cái:

```
Database
┌──────────────────────────────┐
│ bi_analytics · 4 bảng      ▾ │
└──────────────────────────────┘
   ├─ Tất cả database
   ├─ bi_analytics · 4 bảng
   └─ default · 0 bảng
```

Lý do đổi là một chế độ hỏng không lớp kiểm tra nào bắt được: gõ `defualt` thay
vì `default` cho ra một kết nối **lưu được và test XANH** — vì `test()` chỉ đọc
phiên bản máy chủ, nó không đụng tới database. Lỗi chỉ lộ ra ở màn hình khác,
dưới dạng hộp thoại Đồng bộ rỗng, kèm một câu không hề nhắc tới database. Chọn từ
danh sách thì tên sai không còn là trạng thái biểu diễn được, và `default · 0
bảng` nói thẳng điều người dùng cần biết ngay tại chỗ chọn.

| Điểm                | Cách làm                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Để trống            | **Hợp lệ** — nghĩa là "mọi database". `listTables` quét cả máy chủ trừ schema hệ thống                                                                                  |
| Không cần migration | `database_name` là `VARCHAR(255) NOT NULL`; chuỗi rỗng vẫn hợp lệ. Cố ý **không** dùng `NULL`: hai cách viết cho cùng một ý nghĩa là một chỗ sẽ có người quên kiểm      |
| Nút, không tự nạp   | Mỗi lần liệt kê là một kết nối THẬT tới máy khách hàng. Nạp theo phím gõ là hàng chục kết nối cho một lần điền form, và `connectionProbeLimit` sẽ chặn đúng lúc gõ xong |
| Vẫn giữ "Nhập tay"  | Tài khoản bị khoá chặt có thể `SELECT` được trên đúng một database mà không có quyền liệt kê. Bỏ hẳn là khoá đúng những khách hàng cẩn thận nhất ra ngoài               |
| Giá trị lạ vẫn hiện | Kết nối cũ trỏ tới database đã bị xoá thì nó xuất hiện kèm `(không còn thấy)`, không bị lặng lẽ đổi sang cái khác                                                       |

Hai endpoint, cùng gác `connection:modify` + `connectionProbeLimit` như
`/connections/test` — chúng mở kết nối ra ngoài, nên không được gác bằng quyền
đọc, kẻo thành công cụ quét cổng cho bất kỳ ai xem được danh sách kết nối:

| Endpoint                            | Dùng khi                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `POST /v1/connections/databases`    | Tạo mới — thông tin chưa lưu, có mật khẩu trong body                         |
| `GET /v1/connections/:id/databases` | Sửa — ô mật khẩu để trống nghĩa là "giữ nguyên", nên phải dùng bí mật đã lưu |

⚠️ **Bẫy ClickHouse**: đếm bảng phải dùng `countIf(t.name != '')`, không phải
`count(t.name)`. ClickHouse để `join_use_nulls = 0` mặc định nên `LEFT JOIN`
không khớp điền **giá trị mặc định** (chuỗi rỗng) chứ không phải `NULL` — khác
SQL chuẩn, và `count()` đếm luôn chuỗi rỗng đó. Trước khi sửa, mọi database rỗng
hiện ra là "1 bảng".

⚠️ **Bẫy MySQL**: chuỗi rỗng phải quy đổi thành `undefined` trước khi đưa cho
mysql2 — nó gửi chuỗi rỗng đi như `USE ''` và máy chủ từ chối bắt tay. Quy đổi
nằm trong `connectionOptions`, một chỗ duy nhất, để cả `test()` cũng an toàn.

---

## Nạp dữ liệu vào kho phân tích (§9)

Đây là mục đầu tiên nền tảng **giữ dữ liệu thật của khách hàng** — ngược hẳn §8,
nơi chỉ chép cấu trúc. Xong mục này thì **mọi** bộ dữ liệu, dù từ file hay từ
CSDL, đều có một bảng `raw_*` trong ClickHouse — điều kiện cần để §10 dựng mô
hình Cube, vì Cube chỉ đọc được **một** nơi.

### Luồng

Nạp chạy **tự động**, không phải một nút người dùng phải nhớ bấm:

- **Tải file lên xong** (§7 `commitDatasets`) → tự xếp hàng nạp.
- **Đồng bộ bảng xong** (§8 `syncDatasets`) → tự xếp hàng nạp **mọi bảng được
  chọn**, kể cả bảng `unchanged`: "không đổi" ở đó nghĩa là CẤU TRÚC không đổi,
  còn dữ liệu bên trong thì gần như chắc chắn có đổi — và đó mới là thứ người ta
  bấm đồng bộ để lấy.
- Nút **Nạp lại** ở tab "Kho phân tích" vẫn còn, giờ mang đúng nghĩa của nó.

Việc xếp hàng tự động **không bao giờ làm hỏng** luồng gọi nó: ClickHouse tắt thì
tải file vẫn báo thành công (vì nó _đã_ thành công), còn lần nạp hiện `failed`
kèm lý do ở đúng chỗ người dùng đi tìm.

1. Người dùng tải file / đồng bộ bảng — hoặc bấm **Nạp lại**.
2. Một dòng `queued` được ghi vào `dataset_load_runs`, API trả về **ngay**. Nạp
   50.000 dòng mất nhiều phút — một request HTTP treo ngần ấy sẽ bị proxy cắt
   giữa chừng.
3. Vòng lặp nền trong chính tiến trình Express nhặt việc mỗi 2 giây bằng
   `UPDATE … WHERE status='queued' … LIMIT 1` — **database làm trọng tài**, nên
   hai tiến trình `tsx watch` không thể cùng nhận một việc.
4. Nạp vào bảng tạm `raw_t{tenant}_d{dataset}__new`, rồi `EXCHANGE TABLES` để
   tráo tên **nguyên tử**. Không có một mili-giây nào bảng đang phục vụ bị rỗng.
5. Giao diện tự hỏi lại 2 giây một lần **và tự dừng** khi xong
   (`refetchInterval` dạng hàm — chỗ duy nhất trong dự án dùng polling).

### Ba quyết định đáng nhớ

- **Tên bảng sinh hoàn toàn từ hai số nguyên** (`raw_t4_d21`). Không một ký tự
  người dùng đặt nào lọt vào câu `CREATE TABLE` — định danh không tham số hoá
  được, và `datasets.name` thì sửa được ở §8.9 nên tên bảng suy từ nó sẽ thành
  mồ côi ngay lần đổi tên đầu tiên.
- **Escape định danh ClickHouse bằng dấu chéo ngược**, không nhân đôi backtick
  như MySQL: ``a`b`` → `` `a\`b` ``. Đã kiểm bằng `CREATE TABLE` thật rồi đọc
  lại `system.columns`; nhân đôi backtick cho ra lỗi cú pháp.
- **Một ô hỏng không giết cả lần nạp.** Ô không ép được kiểu → ghi `NULL` + một
  dòng `dataset_load_errors`, rồi đi tiếp. Với dữ liệu thật thì luôn có ô rác;
  bắt hỏng cả lần nạp nghĩa là không bao giờ nạp được gì.

⚠️ **Bẫy Excel — `styles` phải là `'cache'` khi đọc luồng.** Trong xlsx, một ô
ngày KHÔNG được lưu như ngày: nó là **số sê-ri** (số ngày kể từ 1899-12-30), và
chỉ định dạng số trong `xl/styles.xml` mới nói đó là ngày. `WorkbookReader` mặc
định `styles: 'ignore'`, nên ô 31/07/2012 trả về đúng số `41121` và cả cột ngày
thành `NULL` trong ClickHouse.

Bẫy nằm ở chỗ **nó không để lại dấu vết nào ở bước tải lên**: nhánh phân tích
dùng `workbook.xlsx.load()` vốn luôn đọc styles, nên giao diện vẫn hiện đúng kiểu
`date`. Chỉ nhánh nạp hỏng. Đã xảy ra thật trên Global-Superstore: 51.290 dòng
vào kho với hai cột ngày rỗng sạch, 102.580 ô lỗi, mà lần nạp vẫn `succeeded`.
Đo lại: `'cache'` **không** đắt hơn (390 ms so với 429 ms trên chính file đó).
Có test hồi quy trong `ingest.integration.test.ts` khẳng định ô ra `2012-07-31`
chứ không phải `'41121'`.

### Trang không cuộn, bảng mới cuộn

Vỏ ngoài (`UserLayout`, `AdminLayout`) là `h-screen overflow-hidden`, và mọi
trang bắt đầu bằng `components/ui/Page.tsx`: phần đầu (`PageHeader`) đứng yên,
phần thân (`PageBody`) nhận hết chỗ còn lại. Danh sách dài cuộn **trong hộp của
chính nó**, với hàng tiêu đề `sticky` nên cuộn tới dòng thứ 60 vẫn đọc được tên
cột. Đo trên 12 trang ở cả 1440×900 lẫn 1366×700: cửa sổ tràn **0px**.

Ba chỗ dễ sai, đều đã gặp:

- **`min-h-0` là bắt buộc** trên mọi flex item chứa vùng cuộn. Mặc định
  `min-height: auto` khiến flex item không chịu co nhỏ hơn nội dung, nên `flex-1`
  vô tác dụng và cửa sổ cuộn lại như cũ.
- **`TableWrap fill` dùng `min-h-0` mà KHÔNG `flex-1`.** `flex-1` bắt hộp căng
  hết chiều cao, nên bảng ba dòng để lại một mảng trắng tới tận đáy màn hình.
- ⚠️ **`sr-only` không co được thẻ `<table>`.** Với `display: table`, CSS coi
  `height`/`width` là kích thước TỐI THIỂU chứ không phải cố định. Bảng phụ đề
  cho trình đọc màn hình trong `VegaChart` vì thế vẫn cao đúng nội dung, và
  `position: absolute` không có tổ tiên định vị làm nó bám vào khối chứa gốc:
  2208px vô hình kéo dài trang Tổng quan. Phải bọc trong một `<div className="sr-only">`.

Thanh cuộn được tạo kiểu ở cuối `index.css`: mảnh, con trượt bo tròn, **nền trong
suốt** — nền xám đặc nằm sát viền bảng đọc ra như một cột rỗng thứ hai. Lớp
`.scrollbar-dark` cho vùng cuộn trên nền tối (sidebar).

⚠️ Khai cả `scrollbar-width`/`scrollbar-color` lẫn `::-webkit-scrollbar` thì
**thuộc tính chuẩn thắng** ở Chrome/Edge 121+. Đo được: hộp cuộn dày 12px (cỡ
"thin" của trình duyệt) chứ không phải 10px khai trong khối `::-webkit-`. Khối đó
giờ chỉ còn phục vụ Safari và Chromium đời cũ — sửa `width` trong đó rồi chờ
Chrome đổi theo là chờ vô ích.

### Ba tab của trang chi tiết đọc từ ba nơi khác nhau

Sau §9, mỗi tab trả lời một câu hỏi khác hẳn — và biết tab nào đọc ở đâu là cách
duy nhất để đối chiếu khi số liệu lệch:

| Tab           | Đọc từ                                                                          | Trả lời                              |
| ------------- | ------------------------------------------------------------------------------- | ------------------------------------ |
| Dữ liệu       | **Nguồn** — `SELECT … LIMIT` sang CSDL khách hàng, hoặc mẫu 1.000 dòng của file | "dữ liệu gốc trông thế nào"          |
| Cấu trúc      | **Kho** — `system.columns` của ClickHouse                                       | "cột này nằm trong kho dưới dạng gì" |
| Kho phân tích | **Kho** — bảng `raw_*`                                                          | "thứ đã nạp trông thế nào"           |

Tab **Cấu trúc** từng đọc `dataset_columns` (kiểu của nguồn). Nó đổi sang đọc kho
vì mọi thứ từ đây trở đi dựng trên kho: báo cáo tổng hợp bằng SQL trên `raw_*`,
và §10 sinh mô hình Cube từ đúng những cột đó. `date` của §7 và
`Nullable(DateTime64(3, 'UTC'))` của ClickHouse là hai thông tin khác nhau, và
chỉ cái sau là thứ đang được truy vấn. Lỗi cột ngày Excel ở trên là ví dụ đắt
giá: giao diện hiện `date` trong khi kho chứa toàn `NULL`, và không tab nào nói
ra điều đó. Chưa nạp thì tab rơi về cấu trúc nguồn, có ghi rõ đang xem cái nào.

**Phân trang** (20/50/100 dòng) có ở cả hai bảng dữ liệu, nhưng khác nhau về bản
chất và khác biệt đó cố ý để lộ ra:

- **Trong kho** — phân trang phía máy chủ, có tổng THẬT ("Hiện 1–20 trong
  51.290"). `count()` trên MergeTree đọc từ metadata của part chứ không quét
  dòng nào, và `OFFSET` nhảy thẳng tới granule vì bảng đã `ORDER BY _row_index`.
- **Từ nguồn** — phân trang phía trình duyệt trên ảnh chụp đã tải về, và **không**
  có tổng. `COUNT(*)` trên bảng vài chục triệu dòng của khách hàng là một lần
  quét toàn bảng; không ai đáng phải trả giá đó để trang hiện được một con số.

### Nợ kỹ thuật — ghi ra, không giấu

- **Job không sống qua restart.** Đang chạy mà backend restart (`tsx watch` khi
  lưu file) thì job bị đánh `failed` lúc boot sau, phải bấm nạp lại. Đây là cái
  giá đã biết của việc không dùng hàng đợi thật.
- **Chỉ một job chạy một lúc** trên toàn hệ thống. Hai tổ chức cùng nạp thì xếp
  hàng.
- **Luôn nạp lại toàn bộ**, không có nạp tăng dần, không có lịch tự động.
- **`dataset_rows` vẫn giữ 1.000 dòng mẫu** cho tab Xem trước — nay là _mẫu_,
  không còn là bản sao đầy đủ. Xem mục _Gỡ nút thắt `dataset_rows`_ ngay dưới.
- **Cách ly tổ chức trong ClickHouse chỉ ở tầng ứng dụng** — một `bi_user` thấy
  mọi bảng. Tới §10, `securityContext` của Cube **phải** mang `tenantId`; quên là
  rò dữ liệu thật.
- **Janitor chỉ quét mỗi giờ và chỉ khi backend đang chạy.** Một máy dev tắt cả
  tuần thì bảng mồ côi nằm nguyên cả tuần — vô hại, nhưng đừng trông nó dọn ngay.
- **`ObjectStorage.getObject` vẫn trả `Buffer`**, nên file được tải trọn vẹn vào
  RAM một lần trước khi parse. Bị chặn ở `UPLOAD_MAX_BYTES` (50 MB) và chỉ sống
  một lần nạp, nhưng thêm một API luồng vào tầng lưu trữ sẽ gỡ nốt phần cuối.
- **Excel không streaming ở bước phân tích**: `workbook.xlsx.load()` dựng cả
  workbook trong RAM. Nhánh nạp thì có (`WorkbookReader`). CSV đã streaming cả
  hai đầu.
- **`dataset_rows` của bộ đã xoá mềm không được dọn.** Janitor chỉ dọn ClickHouse.

### Gỡ nút thắt `dataset_rows`

Trần 50.000 dòng **không đến từ ClickHouse** — 50.000 dòng chỉ tốn 4,57 MiB và
nạp xong dưới 5 giây. Nó đến từ chỗ dữ liệu **đọng lại trên đường đi**:

```
Trước                                    Sau
─────────────────────────────────────    ────────────────────────────────
file → parse TOÀN BỘ vào RAM             file → parse theo LUỒNG
     → 1 khoá Redis  ~29 MB/50k dòng          → Redis chỉ 1.000 dòng mẫu
     → dataset_rows  ~29 MB/50k dòng          → dataset_rows 1.000 dòng mẫu
     → ClickHouse    4,57 MiB/50k             → ClickHouse (đọc THẲNG file)
```

Cùng một dữ liệu bị lưu **ba lần**, và bản đắt nhất lại là bản tạm — JSON lặp
tên cột ở từng dòng nên phình **6,3×** so với chính nó trong ClickHouse. Redis
còn chặn cứng 512 MB mỗi giá trị chuỗi, tức tường ở khoảng 500.000 dòng.

Đo trên máy dev với CSV 500.000 dòng (10,1 MB):

|                | Kết quả                                          |
| -------------- | ------------------------------------------------ |
| `parseFile`    | **1,1 giây**, giữ đúng 1.000 dòng                |
| Cache Redis    | **~0 MB** (trước: ~290 MB ước tính cho 500k)     |
| `readFileRows` | **388.000 dòng/giây**, heap đỉnh 245 MB và phẳng |

Ba thay đổi đi CÙNG NHAU, không tách được:

1. **`readFileRows`** đọc thẳng file từ MinIO theo lô, cùng hình dạng
   `unknown[][]` mà `Driver.readAllRows` phát ra — nhờ vậy `loadDataset` gộp hai
   nhánh file/CSDL thành một vòng lặp.
2. **`dataset_rows` co về `RETAINED_ROWS = 1.000`** dòng mẫu, đúng vai trò còn
   lại của nó: nuôi tab "Dữ liệu".
3. **`aggregateWarehouse`** — §7.6 gom nhóm bằng ClickHouse thay vì RAM Node.
   **Bắt buộc**: bỏ (3) mà làm (2) thì biểu đồ vẽ trên 1/500 dữ liệu, trông hoàn
   toàn hợp lý mà sai số liệu.

Đây cũng là lời hứa của §9 được trả. `aggregate.ts` cũ gom nhóm trong TypeScript
vì lý do **an toàn**, không phải tốc độ: dữ liệu nằm trong cột JSON nên `GROUP BY`
sẽ phải nội suy tên field người dùng đặt vào `data->>'$.<tên>'`. Giờ mỗi bộ dữ
liệu có bảng `raw_*` với **cột thật**, nên `GROUP BY` trở lại là SQL bình thường,
chặn hai lớp: tên cột phải khớp `dataset_columns`, rồi `quoteIdent` bọc nó.

Hai thay đổi hành vi, ghi ra chứ không giấu:

|                  |                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rowCount`       | giờ là số dòng **thật trong file**, không phải số dòng đã lưu. Đi cặp với `loadedRowCount` (số dòng truy vấn được) — trước đây hai số luôn bằng nhau nên một là đủ |
| Báo cáo chưa nạp | trả **409 `DatasetNotLoaded`**, và trang Report hiện "Đang nạp…" rồi tự hỏi lại mỗi 3 giây thay vì một hộp đỏ                                                      |

Ba hàm dùng CHUNG một bản, không chép: `normalizeCell` (ô → giá trị) và
`cellText` (ô Excel → chuỗi). Hai đường đọc cùng một file mà lệch nhau một bản
sao là bảng xem trước và dữ liệu trong kho nói hai điều khác nhau về đúng một ô.
`convert()` của §9 từng đòi số dạng thuần trong khi `parseNumber` hiểu
`1.234,56` kiểu Việt Nam — khác biệt đó bị che chừng nào §9 còn đọc
`dataset_rows`.

- **`decimal` không có `(p,s)`** (dataset đồng bộ trước nhánh này) rơi về
  `String` thay vì đoán bừa — đồng bộ lại một lần là có kiểu đúng.

### Xem dữ liệu đã nạp

Tab **Kho phân tích** có bảng **"Dữ liệu trong kho"** đọc thẳng từ ClickHouse
(`GET /v1/datasets/:id/load/preview`). Nó khác tab **"Dữ liệu"** ở đúng chỗ quan
trọng nhất:

| Tab                               | Đọc từ                                       | Trả lời câu hỏi                   |
| --------------------------------- | -------------------------------------------- | --------------------------------- |
| Dữ liệu                           | **nguồn** (CSDL khách hàng / `dataset_rows`) | dữ liệu gốc trông thế nào         |
| Kho phân tích → Dữ liệu trong kho | **đích** (bảng `raw_*`)                      | thứ _nằm trong kho_ trông thế nào |

Đặt hai bảng cạnh nhau là cách rẻ nhất bắt những lỗi im lặng: ngày lệch múi giờ,
một cột toàn `NULL` vì ánh xạ kiểu sai, số bị làm tròn. Cột `_row_index` cố ý
không bị giấu — nó nối một dòng ở đây với một dòng trong bảng lỗi §9.8.

Muốn truy vấn thẳng thì dùng CLI:

```bash
# Có những bảng nào, bao nhiêu dòng
docker exec bi-clickhouse clickhouse-client --user bi_user --password clickhouse_password \
  --query "SELECT name, total_rows, formatReadableSize(total_bytes) AS size
             FROM system.tables WHERE database='bi_analytics' AND name LIKE 'raw_%'
            FORMAT PrettyCompact"

# Tổng hợp thật bằng SQL — thứ mà `aggregate.ts` phải làm trong bộ nhớ Node
docker exec bi-clickhouse clickhouse-client --user bi_user --password clickhouse_password \
  --query "SELECT \`Country\`, count() AS don, round(sum(\`Sales\`)) AS doanh_thu
             FROM bi_analytics.raw_t4_d21 GROUP BY \`Country\`
            ORDER BY doanh_thu DESC LIMIT 5 FORMAT PrettyCompact"
```

`raw_t{tenantId}_d{datasetId}` — tra `id` và `tenant_id` trong bảng `datasets`,
hoặc đọc cột **Bảng trong ClickHouse** ngay trên giao diện.

### Dọn kho khi xoá bộ dữ liệu

Bảng `raw_*` là **dẫn xuất**, không phải bản gốc: mọi thứ cần để dựng lại nó
(`dataset_rows`, file trong MinIO, hay chính CSDL khách hàng) đều sống sót qua
lần xoá mềm. Nên xoá bộ dữ liệu là **xoá luôn bảng của nó** — giữ lại không bảo
vệ được gì, chỉ chiếm đĩa.

Và nó chiếm nhiều hơn tưởng, vì hai nguồn hành xử khác hẳn nhau:

| Nguồn        | Tải/đồng bộ lại sau khi xoá                                             | Hệ quả                                                  |
| ------------ | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `connection` | trúng `uq_datasets_source` → hồi sinh **đúng id cũ**                    | bảng cũ bị ghi đè, **tự lành**                          |
| `file`       | ba cột khoá đều `NULL`, mà MySQL không coi `NULL` là trùng → **id mới** | bảng cũ mồ côi **vĩnh viễn**, mỗi vòng thêm một bản sao |

Hai lớp, và lớp thứ hai không phải thừa:

1. **Xoá ngay** trong `deleteDataset` — đường nhanh. Cố ý _không_ ném ra nếu
   hỏng: dòng MySQL đã xoá xong, trả lỗi lúc này là báo thất bại cho một thao tác
   đã thành công, và buộc "xoá được một dòng" vào "ClickHouse phải đang sống".
2. **Janitor** trong runner (`sweepOrphanTables`) — lúc khởi động rồi mỗi giờ. Nó
   suy tên bảng từ `raw_t{tenant}_d{dataset}` chứ **không đọc `ch_table`**, nên
   dọn được cả bảng mà MySQL đã quên mất là mình từng có. Ba lỗ mà lớp 1 không
   bịt nổi, cả ba đều có thật:

   - ClickHouse tắt đúng lúc người dùng bấm xoá.
   - Xoá **kết nối** làm dataset của nó khuất khỏi giao diện nhưng
     `datasets.deleted_at` vẫn `NULL` — đường xoá dataset không hề chạy qua.
   - Người dùng xoá **giữa lúc đang nạp**: lần nạp đó chạy tiếp và tạo lại đúng
     cái bảng vừa bị drop, ở bước `CREATE` trước `EXCHANGE TABLES`.

Janitor đi chung `tick()` với việc nạp thay vì có bộ đếm giờ riêng, để một lần
quét không bao giờ chạy song song với một lần nạp trong cùng tiến trình — nó
không thể drop trúng bảng tạm `__new` đang được ghi dở.

⚠️ Regex `^raw_t(\d+)_d(\d+)(?:__new)?$` neo **cả hai đầu**. `bi_analytics` còn
chứa `spike_orders` của spike F1.7 và sẽ chứa view của dbt ở §10; nới nó thành
tiền tố `raw_` là đủ để một tác vụ nền xoá mất thứ nó không hiểu.

### Vào thẳng ClickHouse để tự xem

Ba đường, cùng một dữ liệu. Tài khoản luôn là `bi_user` / `clickhouse_password`.

**a) Giao diện web có sẵn — không cần cài gì.** Mở <http://localhost:8123/play>,
điền user/password ở góc trên, gõ SQL, bấm **Run**. Đây là trang ClickHouse tự
phục vụ, tiện nhất khi chỉ muốn ngó nhanh.

**b) Phiên dòng lệnh tương tác** — gõ nhiều câu liên tiếp mà không phải lặp lại
mật khẩu:

```bash
docker exec -it bi-clickhouse clickhouse-client \
  --user bi_user --password clickhouse_password --database bi_analytics
```

Rồi trong phiên đó:

```sql
SHOW TABLES;                      -- có những bảng nào
DESCRIBE raw_t4_d22;              -- cột nào, kiểu gì
SELECT count() FROM raw_t4_d22;   -- bao nhiêu dòng
SELECT * FROM raw_t4_d22 ORDER BY _row_index LIMIT 3 FORMAT Vertical;
```

`FORMAT Vertical` là mẹo đáng nhớ nhất: bảng nhiều cột in ngang sẽ vỡ dòng thành
cháo, `Vertical` in mỗi cột một dòng nên đọc được. Thoát bằng `exit` hoặc Ctrl-D.

**c) Một câu lẻ, không vào phiên** — dạng `--query` như các ví dụ ở trên, hợp khi
copy vào script.

Ba câu hay dùng khi nghi ngờ dữ liệu sai:

```sql
-- Cột nào toàn NULL? Dấu hiệu kinh điển của ánh xạ sai khoá hoặc sai kiểu.
SELECT countIf(`Sales` IS NULL) AS thieu, count() AS tong FROM raw_t4_d22;

-- Ngày có bị lệch múi giờ không? So mốc sớm nhất/muộn nhất với nguồn.
SELECT min(`Order Date`), max(`Order Date`) FROM raw_t4_d22;

-- Nạp lại có nhân đôi không? Số này phải bằng count().
SELECT uniqExact(_row_index) FROM raw_t4_d22;
```

### Kiểm chứng

```bash
npm run verify                                   # unit: ánh xạ kiểu, quoteIdent, DDL
npm run test:integration                         # 12 ca chỉ cần MySQL
INGEST_CH_TESTS=1 npm run test:integration       # + 4 ca nạp thật vào ClickHouse
```

Nhánh chạm ClickHouse nằm sau một biến khai **tường minh**, không phải sau một
phép "ping rồi lặng lẽ skip": skip ngầm thì một lần chạy bỏ qua phần quan trọng
nhất vẫn hiện màu xanh, và đó là kiểu hỏng tệ nhất.

Đối chiếu tay:

```bash
docker exec bi-clickhouse clickhouse-client --user bi_user \
  --password clickhouse_password \
  --query "SELECT count() FROM bi_analytics.raw_t4_d21"
```

---

## Mô hình dữ liệu (§10)

Ba tab, đều làm thật: **Schemas** (gắn nhãn cột), **Relationship** (sơ đồ nối
bảng), **Explorer** (hỏi thử). Năm tab _sắp có_ trước đây đã bỏ — chín tab tràn
màn hình và đẩy những tab dùng được vào một thanh cuộn ngang, một cái giá quá
đắt cho việc phác lộ trình. Tab **Measures** bỏ sau đó theo yêu cầu: thước đo
vẫn được §10.2 gieo tự động cho mỗi cột số và vẫn sửa được ở tab Schemas, chúng
chỉ không còn màn quản lý riêng.

Nút **Tạo báo cáo** ở góc phải mở [trình dựng biểu đồ](#trình-dựng-biểu-đồ-109)
dựng ngay trên mô hình đang mở.

### Phạm vi: MỖI WORKSPACE MỘT KHO RIÊNG

Luật của cả nền tảng: project, report, bộ dữ liệu và mô hình dữ liệu đều thuộc
về **một workspace**, và không hiện ở workspace khác. Chỉ những thứ ở cấp tổ
chức mới dùng chung — thành viên, kết nối CSDL, thông tin tổ chức.

Trước đây hai chỗ lệch khỏi luật đó, và cả hai đều cho ra cùng một triệu chứng
khó đoán.

**a) Mô hình rơi nhầm workspace.** `POST /datamodels` không nhận `workspaceId`
từ giao diện nên rơi vào `resolveWorkspace(undefined)` — nhánh này chọn workspace
**đầu tiên theo tên** (`ORDER BY w.name ASC`), không liên quan gì tới nơi người
dùng đang đứng. Mô hình vừa tạo biến mất khỏi danh sách ngay lập tức. Tổ chức
một workspace thì hai thứ đó tình cờ trùng nhau nên lỗi không lộ ra.

Chốt chặn giờ nằm ở **tầng kiểu**: `CreateDataModelInput.workspaceId` là bắt
buộc, nên quên gửi là lỗi biên dịch chứ không phải một lỗi lúc chạy. Hộp thoại
tạo mô hình cũng **nói ra** mô hình sẽ nằm ở workspace nào.

**b) Kho dữ liệu ở phạm vi tổ chức.** `datasets.workspace_id` cho phép NULL, và
`syncDatasets` **cố ý** ghi NULL cho mọi bảng đồng bộ từ kết nối — lý lẽ cũ là
"kết nối là tài sản chung nên bảng lấy từ nó cũng vậy". Kết quả: bảng đồng bộ ở
workspace A hiện luôn trong workspace B.

Migration 11 sửa cả hai mức:

|                                          |                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Điền workspace cho dòng đang trống       | workspace cũ nhất của tổ chức — cái tạo lúc đăng ký                    |
| `workspace_id` → `NOT NULL`              | ràng buộc nằm ở **database**, không phải ở một quy ước code phải nhớ   |
| `uq_datasets_source` thêm `workspace_id` | hai workspace cùng đồng bộ được một bảng nguồn, mỗi bên một dòng riêng |

⚠️ Câu `DROP INDEX` sẽ hỏng với `ER_DROP_INDEX_FK` nếu chạy trước:
`fk_datasets_connection` không có chỉ mục riêng, nó đang **mượn tiền tố** của
`uq_datasets_source`. Migration thêm `idx_datasets_connection` trước, và chỉ mục
đó phải ở lại vĩnh viễn vì khoá duy nhất mới xen `workspace_id` vào giữa.

### Danh sách rỗng phải NÓI RA chỗ dữ liệu đang nằm

Cách ly đúng, nhưng một khung rỗng im lặng thì không phân biệt được "chưa làm
gì" với "đang đứng nhầm workspace" — và người dùng đọc nó thành mất dữ liệu.

Khi workspace đang mở không có mô hình nào, trang hỏi thêm **một** request không
lọc workspace để đếm mô hình ở nơi khác, rồi hiện nút chuyển thẳng sang đó
(`abc (1)`). Request đó `enabled` theo đúng điều kiện rỗng nên nó không chạy ở
trường hợp thường.

Đó là lý do `GET /datamodels` và `GET /datasets` vẫn giữ nhánh "bỏ trống
`workspaceId` = cả tổ chức": không phải để giao diện dùng hằng ngày — giao diện
luôn gửi workspace đang mở — mà để giải thích được một danh sách rỗng.

### Đồng hồ lệch làm hỏng TOÀN BỘ Explorer

Cái bẫy tốn nhiều thời gian nhất của §10, và triệu chứng của nó chỉ vào đúng chỗ
sai. Express ký JWT cho Cube với hạn **60 giây** (cố ý ngắn — token mang quyền
đọc dữ liệu cả một tổ chức). Nếu đồng hồ container đi trước đồng hồ máy ký quá
60 giây thì token vừa ký đã hết hạn khi tới nơi.

Chuỗi khiến nó khó tìm:

1. `checkAuth` trong `cube.js` **ném** lỗi → gateway của Cube trả **500**, không
   phải 401.
2. `explain()` phía Express thấy 5xx → dịch thành _"Tầng ngữ nghĩa không trả lời
   được truy vấn này"_.
3. Người dùng đọc câu đó rồi đi sửa tab **Quan hệ** — hoàn toàn sai hướng, vì
   truy vấn chỉ chạm **một** bảng cũng hỏng y hệt.

Cách phân biệt trong 5 giây: chọn **một chiều + một thước đo trong cùng một
bảng**. Nếu vẫn hỏng thì vấn đề không nằm ở quan hệ.

```bash
date -u                        # máy thật
docker exec bi-cube date -u    # container
```

Cả `cube.js` lẫn `cubeClient.ts` nay gọi thẳng tên nguyên nhân thay vì để nó lẫn
vào lỗi chung — `checkAuth` bắt riêng `TokenExpiredError` và `JsonWebTokenError`,
còn Express soi **thân** phản hồi chứ không chỉ mã trạng thái, vì mã trạng thái
ở đây nói dối. `clockTolerance: 30` chỉ để nuốt dao động vài giây; nó **không**
phải chỗ để dung túng một đồng hồ sai.

### Điều kiện để một khung rỗng được phép hiện

`activeId === null` — tức là **không có gì để mở**, không phải "danh sách rỗng".
Hai thứ đó chỉ trùng nhau khi danh sách và phần thân đọc cùng một phạm vi; lấy
điều kiện từ danh sách trong khi phần thân đọc từ một endpoint khác là cách chắc
chắn để hiện lời mời tạo mới chồng lên nội dung đang có.

---

## Trình dựng biểu đồ (§10.9)

Trang kéo-thả để dựng một báo cáo trên mô hình dữ liệu. Đường vào:

| Từ đâu                                               | Đường dẫn                                                |
| ---------------------------------------------------- | -------------------------------------------------------- |
| Mục **Báo cáo** trên thanh bên → nút **Tạo báo cáo** | `/reports/new` — hỏi mô hình ngay trong trang            |
| Nút **Tạo báo cáo** đứng trong một mô hình           | `/datamodels/:id/report/new` — lối tắt, điền sẵn mô hình |
| Nút **Chỉnh sửa biểu đồ** ở trang xem báo cáo        | `/reports/:id/edit`                                      |

Từ §10.10 trang này KHÔNG còn nằm trong tab Mô hình dữ liệu, và nó dựng được
NHIỀU biểu đồ trên một khung — xem mục _Khu Báo cáo_ bên dưới.

⚠️ Bản này có **migration 33** (nới `reports.chart_type` cho ba loại biểu đồ
mới). Kéo code về xong phải chạy `npm --workspace backend run migrate`, và chạy
thêm một lần nữa với `MYSQL_DATABASE=bi_platform_test` nếu bạn chạy test tích
hợp. Bỏ qua bước này thì lưu một biểu đồ thanh ngang sẽ ra lỗi 500
`Data truncated for column 'chart_type'`.

### Ba cột, xếp theo đường đi của tay

```
khung vẽ  │  Biểu đồ (loại + ô thả + định dạng)  │  Mô hình dữ liệu
```

Bảng trường ở **ngoài cùng bên phải**, ngay cạnh các ô thả — kéo một trường chỉ
phải đi qua vài chục pixel. Đặt bảng trường bên trái (như tab Explorer) thì mỗi
cú kéo phải băng ngang cả khung vẽ.

Kéo thả **không phải đường duy nhất**: mỗi trường cũng là một `<button>`, bấm
vào là nó tự vào ô còn trống hợp lệ. Kéo thả bằng chuột không dùng được bằng bàn
phím, và một trình dựng mà người dùng bàn phím không mở nổi là một trang bị
khoá, không phải một trang thiếu tiện nghi.

### Ba ô thả

| Ô                                        | Nhận                      | Bắt buộc         |
| ---------------------------------------- | ------------------------- | ---------------- |
| **Trục** (biểu đồ tròn gọi là _Lát cắt_) | một chiều                 | có               |
| **Giá trị**                              | một thước đo              | có               |
| **Nhóm màu**                             | một chiều **khác** ô Trục | tuỳ loại biểu đồ |

Ô Nhóm màu là thứ §10.9 thêm vào so với §10.8 — nó tách biểu đồ thành nhiều
chuỗi (cột chồng, nhiều đường, bản đồ nhiệt). Ba trạng thái, khai một lần ở
`CHART_SERIES_SUPPORT` bên `shared` và được cả frontend lẫn backend đọc:

- `no` — biểu đồ tròn. Nó đã dùng màu để phân lát cắt rồi.
- `optional` — sáu loại còn lại.
- `required` — bản đồ nhiệt. Không có chiều thứ hai thì không có ô nào để tô.

### Tám loại biểu đồ

`bar` · `hbar` · `line` · `area` · `pie` · `scatter` · `heatmap` · `table`

Ba loại cuối cùng thêm ở bản này. `hbar` tồn tại vì nhãn nhóm dài
("Office Supplies · Bookcases") bị xoay 35° và cắt cụt ở biểu đồ cột; `heatmap`
là loại duy nhất chứng minh chiều thứ hai đáng có.

⚠️ `CHART_TYPES` trong `shared/src/report.ts` là bản sao của một **ENUM MySQL**,
mà MySQL lưu ENUM theo số thứ tự. Thêm loại mới thì **nối vào cuối** cả hai nơi.
Chèn vào giữa sẽ viết lại nghĩa của mọi dòng đã lưu — báo cáo `line` lặng lẽ
thành `hbar`, không lỗi nào báo. Thứ tự hiển thị do `chartCatalog.tsx` tự sắp,
nên thứ tự trong ENUM không cần đẹp.

### Tuỳ chọn trình bày không đụng tới truy vấn

`stacked`, `showLegend`, `showValues`, `sort`, `palette` nằm trong
`ReportModelConfigDto.options`, cùng cột `config` với hai ID. Ranh giới rất
cứng và đáng giữ: **mọi thứ trong `options` đổi hình mà không đổi số**.

Hệ quả trực tiếp: khoá cache của truy vấn xem trước **không** chứa `options`,
nên đổi bảng màu không tốn một lượt quét ClickHouse nào. Nó cũng không chứa
`chartType` — trang tự quy chiều thứ hai về `null` cho loại không nhận nó, nên
hai loại biểu đồ với cùng một `config` luôn nhận về cùng một câu trả lời.

### Xem trước là chính nó, không phải một bản gần đúng

Đây là điểm thiết kế đáng nhớ nhất của mục này. Hai đầu đi chung một đường:

```
POST /datamodels/:id/report-preview  ─┐
                                      ├─► aggregateFromModel()  ─►  ReportDataDto
GET  /reports/:id/data               ─┘                                   │
                                                                          ▼
                              trang xem  ─┬─►  <ReportChart> ─► buildChartSpec()
                              trình dựng ─┘
```

Không có nhánh nào chỉ dành cho xem trước. Nhãn trục, dòng cảnh báo "đã cắt",
cách một ô trống được đặt tên, thứ tự nhóm — tất cả giống nhau tuyệt đối, vì
chúng đến từ cùng một hàm. Cùng lập luận với việc `modelReportData.ts` gọi
`runExplorerQuery` thay vì tự dựng truy vấn Cube.

### Chiều thứ hai tốn HAI truy vấn, và vì sao đáng

Một truy vấn hai chiều với `limit = 20` trả về 20 **tổ hợp** lớn nhất, không
phải 20 nhóm. Với dữ liệu thật thì cả 20 tổ hợp ấy thường rơi vào ba bốn nhóm
đầu, nên biểu đồ hiện ra bốn cột thay vì hai mươi — và không có gì trên màn hình
nói rằng mười sáu nhóm còn lại vẫn tồn tại.

Nên `aggregateFromModel` hỏi hai lần: lần một xếp hạng nhóm (đúng câu mà biểu đồ
một chuỗi đang hỏi), lần hai lấy phần chia nhỏ rồi lọc về đúng những nhóm đó.

**Không có cột "Khác"** ở nhánh này. Phần bị cắt là một mặt phẳng nhóm × chuỗi,
chia nó cho từng chuỗi thì phải bịa ra tỉ lệ — và một cột "Khác" chồng đủ màu sẽ
trông như một nhóm thật mang cơ cấu do ta nghĩ ra. Cờ `grouped` nói ra là đã
cắt; thà thiếu còn hơn bịa.

### Endpoint

|                                          |                                           |
| ---------------------------------------- | ----------------------------------------- |
| `POST /v1/datamodels/:id/report-preview` | số liệu xem trước — `datamodel:read`      |
| `POST /v1/reports/from-datamodel`        | tạo, đã có sẵn từ §10.8 — `report:modify` |
| `PATCH /v1/reports/:id/from-datamodel`   | **sửa**, mới ở bản này — `report:modify`  |

Đường sửa là đường **riêng**, không nhồi vào `PATCH /reports/:id`. Hai `config`
là hai hình dạng không giao nhau (ID so với tên cột), và ghi nhầm bên nào cũng
làm bên đọc tương ứng phân giải ra `null` — báo cáo mất biểu đồ, không một dòng
lỗi nào. Cả hai route đều từ chối tường minh báo cáo của phía kia, và
`updateModelReport` còn chốt thêm `AND datamodel_id IS NOT NULL` trong câu SQL.

Ba đường dùng chung `assertModelChartConfig`, nên không có cửa sau: cấu hình mà
trình dựng cho xem trước cũng đúng là cấu hình nút Lưu chấp nhận.

### Bài test đáng đọc

| `frontend/tests/chartSpec.test.ts` | mọi spec Vega **biên dịch được** (bắt cả `warn`, không chỉ lỗi ném ra), bốn cách sắp trục cho ra **bốn** spec khác nhau, bảng màu đụng tới mọi loại biểu đồ (§10.15), và ô vừa-khung khai **cả hai chiều** bằng số rồi rút tên trục khi hết chỗ (§10.16) — thiếu một trong hai chiều thì biểu đồ thò ra ngoài ô và không có gì đỏ ở đâu cả |
dựng sinh ra, và bắt cả **cảnh báo** chứ không chỉ lỗi ném ra. Lý do: phần lớn
spec đi qua một phép ép kiểu `as TopLevelSpec` nên trình biên dịch không kiểm gì
cả, còn một spec sai thì `VegaChart` bắt lại và hiện một dòng chữ xám — console
sạch sẽ, không ai biết cấu hình nào vừa hỏng.

---

## Khu Báo cáo & khung nhiều biểu đồ (§10.10)

Tới §10.9, báo cáo **không có nhà**: tạo thì tạo từ trong tab Mô hình dữ liệu,
xem thì xem qua khối "Báo cáo gần đây" trên trang chủ. Ba câu hỏi đơn giản không
có chỗ nào trả lời — có tất cả bao nhiêu báo cáo, cái nào của ai, cái nào bỏ đi
được — và người dùng phải biết TRƯỚC mình sẽ dùng mô hình nào rồi mới tìm được
chỗ bắt đầu.

Bản này thêm hai thứ, và chúng đi cùng nhau:

1. **Khu Báo cáo** — mục riêng trên thanh bên, có trang danh sách của nó.
2. **Khung nhiều biểu đồ** — một báo cáo chứa tới 12 ô trên một lưới 12 cột.

⚠️ Bản này có **migration 34** (`reports.canvas`). Kéo code về xong phải chạy
`npm --workspace backend run migrate`, và chạy thêm một lần nữa với
`MYSQL_DATABASE=bi_platform_test` nếu bạn chạy test tích hợp.

### Mục Báo cáo đứng NGAY SAU Trang chủ, và không gác quyền

Đây là mục nội dung **duy nhất** viewer vào được: bốn mục còn lại đều đòi một ô
quyền mà migration 26 đã lấy đi của họ. Nên nó phải là đích đầu tiên trong danh
sách, không phải một dòng nằm cuối sau ba dòng bị ẩn.

| Đường dẫn                            | Ai vào được                           |
| ------------------------------------ | ------------------------------------- |
| `/reports` — danh sách               | mọi vai trò (`report:read`)           |
| `/reports/:id` — **xem** một báo cáo | mọi vai trò                           |
| `/reports/:id/edit` — trình dựng     | `report:modify` + `datamodel:read`    |
| `/reports/new` — dựng mới            | `readDataModels` **và** `editContent` |

Xem mục _Xem trước, sửa sau_ bên dưới.

`/reports/new` gác **cả hai** ô, lồng nhau, chứ không chọn một: trình dựng vừa
đọc danh sách chiều/thước đo (`datamodel:read`) vừa ghi một báo cáo
(`report:modify`). Hôm nay chưa vai trò nào có ô này mà thiếu ô kia, nhưng route
nên nói đúng thứ nó cần chứ đừng dựa vào một trùng hợp trong bảng phân quyền.

### Trang báo cáo là một trang TOÀN MÀN HÌNH, không có sidebar

Chỉ `/reports` — danh sách — nằm trong `UserLayout`. Mở một báo cáo ra là rời
khỏi khung sidebar: đó là khối route duy nhất của khu người dùng đứng ngoài
layout đó.

Vì nó là một **mặt làm việc**, không phải một trang nội dung:

|                             | có sidebar                     | toàn màn hình       |
| --------------------------- | ------------------------------ | ------------------- |
| bề ngang cho khung 12 cột   | mất 256px                      | dùng hết            |
| bộ chuyển tổ chức/workspace | bấm nhầm là mất khung chưa lưu | không có            |
| người dùng đang ở đâu       | "trong ứng dụng"               | "trong báo cáo này" |

Đổi lại, trang phải tự mang ba thứ mà layout vẫn lo hộ:

1. **Lối ra.** Mũi tên ← góc trái là đường về duy nhất, nên nó có mặt ở **mọi**
   trạng thái — kể cả màn hình lỗi và lúc đang tải. Đó là việc của `Shell`
   trong `ReportBuilderPage`.
2. **Cảnh báo chưa lưu.** Cả nút Thoát lẫn mũi tên ← đều hỏi lại khi còn việc
   chưa lưu; `beforeunload` lo nốt trường hợp đóng tab hay F5. Header hiện một
   chấm "● Chưa lưu" để không ai phải tự nhớ mình đã sửa gì.
3. **Chiều cao.** `h-screen overflow-hidden` bắt đầu lại chuỗi chiều cao mà
   `UserLayout` vẫn giữ hộ; đứt ở đây thì ba cột dài theo nội dung và cả cửa sổ
   cuộn, thay vì mỗi cột cuộn trong hộp của nó.

`WorkspaceProvider` vẫn phải bọc route này: `useDataModels` và
`useExplorerFields` hỏi workspace đang mở, và `useWorkspace` **ném lỗi** khi
thiếu provider chứ không âm thầm trả rỗng.

Nút bên phải header là **"Thoát"**, cố ý không phải "Huỷ": hộp thoại xác nhận
ngay sau đó đã có sẵn một nút "Huỷ" mang nghĩa **ở lại**. Hai nút cùng chữ mà
ngược nghĩa, cách nhau vài chục pixel, là cách chắc chắn để người ta bấm nhầm
đúng cái nút phá huỷ công việc của mình.

#### "Còn việc chưa lưu" tính thế nào

`hasUnsavedWork(baseline, name, drafts)` trong `builder/visual.ts`, và nó phải
đúng theo **cả hai** chiều:

| Sai chiều nào          | Hậu quả                                                    |
| ---------------------- | ---------------------------------------------------------- |
| không hỏi khi đáng hỏi | người dùng mất việc, không một câu cảnh báo                |
| hỏi khi chẳng có gì    | bấm Có theo phản xạ, tới lần cần hỏi thật cũng vô tác dụng |

Nên nó gồm hai vế:

- **ảnh chụp khác mốc** — `snapshotOf(name, readyVisuals(drafts))`. Mốc được đặt
  lại ngay khi nạp xong một báo cáo cũ, nên mở ra rồi thoát ngay thì nó im.
- **có ô dựng dở** — ô đã có một trường nhưng chưa đủ để lưu. Vế này **thiếu
  trong bản đầu**, và lỗi lộ ra khi bấm thử trên trình duyệt chứ không phải khi
  đọc lại code: chọn đúng một chiều rồi bấm Thoát, trang cho đi luôn.
  `readyVisuals` không thấy ô dở dang nên ảnh chụp bằng đúng mốc.

Mốc **không** so thẳng trên `VisualDraft` dù nghe gọn hơn: mỗi ô mang một `id`
sinh ngẫu nhiên, nên ô rỗng của lần dựng mới không khớp với bất kỳ mốc dựng sẵn
nào — trang vừa mở đã tự nhận là đã bị sửa.

### Xem trước, sửa sau: hai trang cho một báo cáo (§10.13)

Bấm tên một báo cáo mở **trang xem**: một thanh trên cùng, cái khung biểu đồ, và
không gì khác. Ai sửa được thì có nút **Chỉnh sửa** ở góc phải thanh đó.

```
┌────────────────────────────────────────────────────────┐
│ ←  Doanh thu quý IV                     [ Chỉnh sửa ]  │
├────────────────────────────────────────────────────────┤
│  (khung biểu đồ, chỉ đọc)                              │
└────────────────────────────────────────────────────────┘
```

#### Đây là ĐẢO lại quyết định của §10.10

§10.10 gộp xem và sửa vào một trang, với lý do "bấm tên báo cáo rồi phải bấm
thêm một nút nữa mới sửa được là hai bước cho một việc". Lý do đó nhìn từ phía
người **dựng** báo cáo. Người dùng nhìn từ phía người **đọc**:

> khi bấm vào báo cáo sẽ hiển thị 1 trang xem tổng quan như này trước, nhưng với
> những role có quyền thì sẽ có nút edit

Và họ đúng. Phần lớn lượt mở một báo cáo là để đọc nó — kể cả bởi chính người đã
dựng. Cái giá của việc mở thẳng vào trình dựng:

|                      | mở vào trình dựng                                      | mở vào trang xem                   |
| -------------------- | ------------------------------------------------------ | ---------------------------------- |
| bề ngang cho biểu đồ | mất hơn ⅓ cho ba cột công cụ                           | trọn màn hình                      |
| số request           | mỗi ô tự hỏi số liệu của mình — 12 lượt khứ hồi        | **một** `canvas-data` cho cả trang |
| bấm nhầm vào một ô   | **sửa** báo cáo, rồi trang hỏi "chưa lưu, rời đi chứ?" | không có gì để sửa                 |

| Đường dẫn                        | Nằm ở đâu         | Ai vào được                                   |
| -------------------------------- | ----------------- | --------------------------------------------- |
| `/reports` — danh sách           | trong sidebar     | mọi vai trò                                   |
| `/reports/:id` — **xem**         | **toàn màn hình** | mọi vai trò                                   |
| `/reports/:id/edit` — trình dựng | **toàn màn hình** | ai sửa được; còn lại bị đẩy về `/reports/:id` |
| `/reports/new` — dựng mới        | toàn màn hình     | `readDataModels` + `editContent`              |

Cả hai trang dùng chung `ReportShell` — cùng chiều cao thanh trên, cùng chỗ đặt
mũi tên ←, cùng chỗ đặt tên báo cáo. Lệch một nhịp thôi thì cú bấm "Chỉnh sửa"
đọc ra như một cú nhảy sang màn hình khác, và người dùng phải tìm lại mọi thứ.

#### Cả hai route đều KHÔNG gác quyền — vì hai lý do ngược nhau

**Trang xem** không gác vì `report:read` là quyền của mọi vai trò, và
`ReportViewer` cố ý **không** gọi bất kỳ endpoint nào của mô hình dữ liệu. Đó là
điều kiện để viewer dùng được: họ không có `datamodel:read` (migration 26). Số
liệu tới từ `GET /reports/:id/canvas-data` và `GET /reports/:id/data` — hai
endpoint cố ý chỉ gác `report:read`.

**Trình dựng** không gác vì ai không sửa được thì bị **đẩy về trang xem**, không
phải rơi vào `/403`. Link `/edit` đã được dán cho nhau suốt từ §10.10, và một
cái link cũ nên dẫn tới thứ người ta định xem.

Nút **Chỉnh sửa** mới là chỗ hỏi quyền, và nó hỏi **cả hai** ô:

```
report:modify && datamodel:read && source === 'datamodel'  ->  hiện nút
```

Hỏi một ô thôi là để lọt một vai trò vào trình dựng rồi mọi request bên trong ăn
403 giữa chừng công việc. Chặn thật vẫn ở backend: mỗi lần ghi đi qua
`authorize('report', 'modify')`.

#### Báo cáo trên BỘ DỮ LIỆU: không có nút, và NÓI vì sao

Trình dựng đọc cấu hình dạng ID trường, còn báo cáo §7.6 mang cấu hình dạng **tên
cột** — admin cũng không sửa được nó. Chỗ đó mang nhãn _"Dựng trên bộ dữ liệu —
chỉ xem"_ thay vì để nút vắng mặt không lời giải thích.

Nhãn ấy **chỉ** hiện với người vốn sửa được. Nói "chỉ xem" với một viewer là nói
về một khả năng họ chưa từng có.

#### Lưu xong thì Ở LẠI

Không còn trang xem để nhảy sang, nên lưu xong trang tự đặt lại mốc `baseline`
và bật nhãn **"✓ Đã lưu"** trong 2,5 giây. Không làm vậy thì chấm _"● Chưa lưu"_
vẫn sáng sau khi đã lưu xong, và bấm Lưu trông y hệt như không bấm.

Luồng **tạo mới** thì khác: nó đổi URL sang `/reports/:id/edit` của báo cáo vừa
tạo (`replace`, để nút Back không quay lại một trang dựng trống). Đường dẫn đổi
nên component mount lại và tự đặt mốc từ bản đã lưu.

Lối ra (mũi tên ← và nút Thoát) về **trang xem** của báo cáo đang sửa, hoặc về
**danh sách** nếu đang dựng mới. Người ta vào trình dựng từ nút "Chỉnh sửa" của
trang xem, nên ← trả họ về đúng chỗ đã đứng; dựng mới thì chưa có trang xem nào
để về, và danh sách là nơi báo cáo vừa lưu sẽ hiện ra.

#### Ô đang chọn được TÍNH RA, không lưu

`const selected = drafts.find((d) => d.id === selectedId) ?? drafts[0] ?? null`

Trước đây một `useEffect` chọn hộ ô đầu tiên khi `selectedId` còn `null`, và nó
hỏng ngay khi trang thôi chờ báo cáo nạp xong mới render: hai effect chạy trong
cùng một lượt — effect nạp báo cáo đặt `selectedId` theo ô vừa nạp, effect
chọn-hộ đọc `selectedId` cũ (vẫn `null`) rồi ghi đè bằng id của ô **rỗng** khởi
tạo. Ô đó không còn trong `drafts`, nên bảng cấu hình đứng im ở câu _"Bấm vào
một ô trên khung"_ và bấm một trường không có tác dụng gì.

Lỗi này chỉ lộ ra khi bấm thử trên trình duyệt — không test nào đỏ, không lỗi
nào trong console, chỉ là một bảng cấu hình không phản ứng.

### Hai đường tạo báo cáo, và mô hình dựng-hộ

Nút **Tạo báo cáo** — ở Trang chủ và ở trang Báo cáo, cùng một component
`CreateReportMenu` — cho hai đường:

|                                   | Người dùng làm gì        | Hệ thống làm gì                                              |
| --------------------------------- | ------------------------ | ------------------------------------------------------------ |
| **Tạo nhanh với file Excel/CSV**  | tải file, tích sheet     | nạp dữ liệu → **dựng hộ một mô hình** → vào thẳng trình dựng |
| **Tạo từ mô hình dữ liệu có sẵn** | chọn mô hình trong trang | vào trình dựng                                               |

Trước bản này nhánh file chỉ mở wizard nạp dữ liệu rồi thả người dùng ở danh
sách bộ dữ liệu — còn đúng hai bước nữa (dựng mô hình, mở trình dựng) mà không
có gì nói ra. Nút hứa "tạo báo cáo" và giao lại một bộ dữ liệu.

#### ⚠️ Đây KHÔNG phải là mang cơ chế tự sinh mô hình trở lại

Đọc **migration 19 và 20** trước khi sửa phần này. Hệ thống đã từng tự dựng mô
hình ở đuôi **mọi** lần nạp, và migration 20 bỏ hẳn nó, với lý do vẫn còn nguyên
giá trị:

> Máy chỉ đoán được [những bảng nào đáng hỏi cùng nhau] bằng chuyện chúng đi
> chung một file hay chung một schema, mà đó là trùng hợp về xuất xứ chứ không
> phải quan hệ về nghĩa.

Đo trên dữ liệu thật khi đó: **15 mô hình tự sinh, không cái nào quá một bảng,
12 cái bị xoá.**

Khác ở đúng một điểm, và điểm đó là điểm quyết định:

|                               | migration 19/20                     | bản này                                      |
| ----------------------------- | ----------------------------------- | -------------------------------------------- |
| ai yêu cầu                    | không ai — máy tự làm ở mọi lần nạp | người dùng bấm "Tạo nhanh với file"          |
| "bảng nào đáng hỏi cùng nhau" | máy đoán từ xuất xứ                 | người dùng vừa tự tích                       |
| mô hình là gì                 | một món quà máy tự tặng             | một bước trung gian của thao tác vừa yêu cầu |

Không có lần nạp nào tạo ra mô hình ngoài lần nạp đi qua đúng nút đó —
`UploadWizard` chỉ dựng mô hình khi `goal === 'report'`.

#### §10.13 đảo lại: mô hình dựng-hộ được LƯU như mọi mô hình khác

§10.11 thêm một cột `datamodels.hidden` và đặt `= 1` cho mô hình dựng-hộ, để
danh sách Mô hình dữ liệu chỉ còn thứ người dùng tự dựng. Người dùng gặp mặt
trái của nó ngay lần dùng đầu:

> tui vẫn thấy nút mở mô hình nhưng khi thoát ra thì lại không thấy trong phần
> mô hình dữ liệu

Một mô hình **mở được** từ trình dựng nhưng **không có mặt** trong danh sách đọc
ra như dữ liệu bị mất, không phải như một chỗ được dọn gọn. Và nó thật sự là mô
hình của họ: họ tích những sheet đó, họ đặt tên đó, và vai trò cột trong đó là
thứ họ sẽ phải sửa.

Nỗi lo cũ — "mỗi lần tải file lại thêm một mô hình một-bảng" — không mất đi,
nhưng nó nhỏ hơn và có thuốc chữa sẵn: danh sách đã có tìm kiếm, sắp xếp và xoá.
Rác thì dọn được; dữ liệu tưởng là mất thì không lấy lại được lòng tin.

**Cột `hidden` không còn tồn tại**, và cũng không để lại migration nào. Nó chưa
bao giờ rời khỏi máy dựng: lúc nhánh này gộp với `main`, hai migration "thêm cột"
và "bỏ cột" của nó bị bỏ hẳn thay vì dời số. Giữ lại chỉ là bắt mọi người trong
nhóm thêm một cột rồi xoá đúng cột đó — và một cột mà mọi dòng đều bằng 0, không
ai ghi vào, là một cột người đọc sau phải mất công tìm hiểu rồi phát hiện nó
không làm gì.

Nút **Mở mô hình** trên thanh công cụ trình dựng vẫn còn, và giờ hiện cho **mọi**
mô hình chứ không riêng mô hình dựng-hộ: vai trò cột và quan hệ giữa các sheet
là hai thứ hay phải sửa ngay giữa lúc dựng biểu đồ, và bắt người dùng đi vòng
qua danh sách là bắt họ bỏ cả khung đang dựng.

#### Phải CHỜ dữ liệu vào kho phân tích

`commitDatasets` trả về ngay khi dòng đã vào MySQL; việc nạp sang ClickHouse
chạy **tiếp sau** đó. Dựng mô hình trước lúc ấy thì backend trả **409
`DatasetNotLoaded`** — và đó chính là lỗi nhận được ở lần chạy thử đầu tiên của
luồng này:

```
--> POST /api/v1/datamodels {"name":"ban-hang-nhanh","datasetIds":[205]}
<-- 409 {"error":"DatasetNotLoaded","message":"Bộ dữ liệu \"ban-hang-nhanh\" chưa
        được nạp vào kho phân tích nên chưa dựng mô hình lên được..."}
```

`waitLoaded` hỏi lại mỗi 1,5 giây, trần 90 giây. Hỏi lại thay vì một
`setTimeout` đủ dài: thời gian nạp phụ thuộc số dòng, nên một con số cố định là
chọn sai cho một trong hai phía — hoặc bắt file nhỏ chờ vô cớ, hoặc bỏ cuộc
trước khi file lớn xong.

#### Lỗi sau bước commit từng bị ẩn hoàn toàn

Lỗi 409 ở trên **không hiện ra trên màn hình**. Bản đầu đánh dấu
`progress = 'done'` ngay sau khi commit rồi mới dựng mô hình, mà `StepProgress`
ở trạng thái `'done'` **return sớm** và không render `error`. Người dùng nhìn một
dấu tích xanh "Đã tạo bộ dữ liệu thành công!" và không hiểu vì sao trang không
chuyển.

Hai chỗ sửa:

- nhánh báo cáo **không** đánh dấu `'done'` — việc chưa xong, và trạng thái đó
  là trạng thái duy nhất giấu lỗi;
- `committedRef` giữ kết quả commit, nên nút **Thử lại** sau khi mô hình hỏng
  không nạp lại file thành một bộ dữ liệu thứ hai. Người dùng bấm Thử lại để
  chữa một lỗi, không phải để nhân đôi dữ liệu.

#### Đã kiểm bằng gì

6 ca tích hợp (`§10.13` trong `datamodel.integration.test.ts`) khoá chiều ngược
lại: mô hình vừa tạo **có** trong danh sách và **được tính** vào
`total`, một client cũ còn gửi cờ `hidden` cũng không giấu được gì, DTO không còn
mang trường đó, đường tạo vẫn y nguyên, và tổ chức khác vẫn 404.

Và một lượt chạy thật trên trình duyệt với một file CSV 8 dòng: menu hai đường →
tải file → nút "Nạp 1 sheet rồi dựng báo cáo" → mô hình ra đời → **thoát ra mục
Mô hình dữ liệu thì thấy nó ở đó** → quay lại dựng biểu đồ → lưu được.

### Bảng trường chia theo BẢNG, không theo vai trò đoán được

Hai khối **"Chiều (Dimension)"** và **"Thước đo (Measure)"** đã bị bỏ. Cột "Mô
hình dữ liệu" giờ liệt kê **mọi** trường, gom theo bảng:

```
MÔ HÌNH DỮ LIỆU
5 bảng · 43 trường
[ Tìm trường… ]

Customers
   #  Customer id        T  Name        T  Phone        📅 Created at
   Σ  Số dòng
Orders
   #  Orders id          T  Status      📅 Orders date
   Σ  Số dòng (2)        Σ  Total amount
Orders_detail
   ...
```

Vì phép đoán vai trò (`classifyColumn.defaultRoleOf`: kiểu cột + từ cuối của
tên, đối chiếu một danh sách từ khoá) sai vừa đủ thường xuyên để gây hại:

- Một cột số bị đoán thành thước đo thì **không** còn nằm trong nhóm "Chiều",
  nên người dùng đi tìm nó để chia nhóm và không thấy ở đâu cả.
- Hai khối tự tin phát biểu "đây là chiều, đây là thước đo" trong khi thứ tự sắp
  xếp thật ra đến từ mười mấy chữ trong `IDENTIFIER_WORDS`.

Bảng chia theo **bảng** — đơn vị người dùng thật sự nhớ, vì họ là người đã nạp
từng bảng vào mô hình. Ai dựng báo cáo thì biết cột nào đo được, và họ chọn.

Thứ tự: bảng theo **thứ tự xuất hiện** trong mô hình (không sắp chữ cái — bảng
chính thường được thêm trước bảng tra cứu, đúng thứ tự người ta sẽ tìm); trong
một bảng thì cột trước, trường đã gộp sẵn sau — không phải để chia lại theo vai
trò mà vì trường gộp _dựng trên_ các cột ấy.

⚠️ Đây là thay đổi **cách hiển thị**. Backend vẫn phân vai trò như cũ, nên một
cột bị đoán thành thước đo vẫn chưa kéo được vào ô Trục. Hai thứ nói ra điều đó:
ký hiệu đầu dòng (`Σ` = trường đã gộp sẵn, `#`/`T`/`📅` = cột) và việc mỗi ô
thả tự in ra loại trường nó nhận rồi sáng lên đúng lúc kéo (`Shelf`). Bỏ hẳn phép
đoán ở backend là việc khác, lớn hơn nhiều: nó đụng bộ sinh schema Cube (`buildCubeSchema`
chỉ phát dimension cho cột `role = 'dimension'`), DTO cấu hình báo cáo, và cả
việc sinh lại schema cho mọi mô hình đã có.

Dòng đếm cũng đổi theo: **"5 bảng · 43 trường"** thay cho "30 chiều · 13 thước
đo". Đếm theo vai trò ngay trên một danh sách đã thôi chia theo vai trò là dựng
lại đúng cái ranh giới vừa bỏ.

### Mỗi ô thả NÓI RA nó nhận loại trường nào

```
Ô THẢ
┌──────────────────────────────┐
│ Trục (Dimension)         Bỏ  │
│   Product Name               │
│   Orders                     │
└──────────────────────────────┘
┌──────────────────────────────┐
│ Giá trị (Measure)        Bỏ  │
│   Quantity                   │
│   Tổng của Quantity          │
└──────────────────────────────┘
┌──────────────────────────────┐
│ Nhóm màu (Dimension)     Bỏ  │
│   Category                   │
│   Orders                     │
└──────────────────────────────┘
```

Tên ba ô — "Trục", "Giá trị", "Nhóm màu" — nói ô đó **vẽ ra cái gì**, không nói
**bỏ cái gì vào**. Câu gợi ý bên dưới có nói ("Chiều để chia nhóm"), nhưng nó
chỉ hiện khi ô còn **trống**: thả xong một trường là chính trường vừa thả chiếm
chỗ dòng chữ đó, và từ lúc ấy màn hình không còn chỗ nào nói ô Trục nhận chiều
còn ô Giá trị nhận thước đo. Người dùng mất thông tin đúng lúc cần nhất — lúc
muốn **đổi** trường đang nằm trong ô.

Chữ trong ngoặc đọc từ `COLUMN_ROLE_TERMS` (`shared/src/datamodel.ts`), và
`COLUMN_ROLE_LABELS` — "Chiều (Dimension)" ở Explorer và ở ô chọn vai trò của
tab Schemas — **dựng trên** map đó. Nên ba chỗ không lệch nhau được: sửa
"Dimension" một lần là sửa cả ba.

Trong `Shelf` nó lấy theo `accepts`, **chính** biến quyết định ô có nhận cú thả
hay không (`nhanDuoc`). Một prop `kindLabel` truyền từ ngoài vào thì lệch được:
đổi `accepts` mà quên đổi nhãn là ô mời người dùng thả đúng thứ nó từ chối.

Ô **bị khoá** vẫn in loại trường của mình — ô Nhóm màu của biểu đồ tròn chẳng
hạn. Người dùng cần biết cái ô xám đó là chỗ của một chiều, không phải chỗ của
một thước đo thứ hai.

⚠️ Không mâu thuẫn với việc bảng trường thôi chia theo vai trò. Ở đó vai trò là
thứ backend **đoán** cho từng cột; ở đây nó là ràng buộc **cứng** của chính ô
đó: ô Trục nhận chiều, hết, không có gì để đoán.

### Trần nhóm nói ra LUẬT của nó, và cho chọn đầu hay cuối bảng

> ⚠️ **§10.15 bỏ ô chọn "Giữ lại nhóm nào".** Việc nó làm không mất — nó gộp
> vào ô "Sắp xếp" ngay bên dưới. Phần dưới đây giữ lại vì nó giải thích vì sao
> "20 nhóm" phải nói ra luật chọn của mình.

```
Số nhóm tối đa      [ 20 nhóm        ]
Giữ lại nhóm nào    [ Nhóm lớn nhất  ]
                    Xếp hạng theo Doanh thu; phần còn lại gộp thành "Khác"
                    — chỉ khi phép tính cộng được.
```

Trước bản này màn hình chỉ nói **"Số nhóm tối đa: 20"** và không một chữ nào về
việc 20 nhóm đó được chọn ra sao. Người dùng đọc nó thành "hai mươi nhóm ngẫu
nhiên nào đó" — và đó là phản hồi thật, không phải giả định.

Nó chưa bao giờ ngẫu nhiên: `buildQuery` sắp giảm dần theo thước đo đầu tiên
rồi cắt. Nhưng một luật không nói ra thì cũng như không có.

#### Chọn nhóm nào là việc của TRUY VẤN

`pick` nằm trong `ReportModelConfigDto`, **không** trong
`ReportChartOptionsDto`, và ranh giới đó là ranh giới thật: `options` chỉ đổi
hình, `config` đổi số. Đặt nhầm chỗ thì nó không vào khoá cache — đổi từ "lớn
nhất" sang "nhỏ nhất" sẽ là một lần **trúng** cache: biểu đồ đứng yên, không
request, không lỗi, một ô chọn không làm gì cả.

`'bottom'` hỏi Cube bằng `ORDER BY … ASC`, chứ không đảo ngược tập đã cắt. Đo
trên tám khu vực với trần 5 nhóm:

|               | nhóm hiện trên trục                                      |
| ------------- | -------------------------------------------------------- |
| Nhóm lớn nhất | An Giang, Binh Duong, Can Tho, Da Nang, Ea Kar, **Khác** |
| Nhóm nhỏ nhất | Da Nang, Ea Kar, Gia Lai, Ha Noi, Hue, **Khác**          |

Hai tập KHÁC nhau — nếu "nhỏ nhất" chỉ là đảo thứ tự thì dòng dưới sẽ là dòng
trên viết ngược.

#### Backend luôn trả về GIẢM DẦN, kể cả khi lấy cuối bảng

`aggregateFromModel` đảo lại kết quả của truy vấn `asc`. Không đảo thì
`options.sort = 'value'` — nhãn của nó là "lớn → nhỏ" — sẽ vẽ ra một biểu đồ
tăng dần, và ô sắp xếp nói dối mà không ai sửa được. **`pick` chọn nhóm nào,
`sort` chọn thứ tự**; hai việc tách hẳn nhau.

Phép đảo nằm TRƯỚC bước cắt dòng thừa: `limit + 1` dòng đang xếp tăng dần thì
dòng thừa nằm ở cuối, nên đảo sau khi cắt sẽ bỏ mất nhóm nhỏ nhất và giữ lại
đúng cái dòng chỉ dùng để đếm.

Ở biểu đồ nhiều chuỗi, `pick` chỉ đụng truy vấn xếp hạng **nhóm**. Trần chuỗi
vẫn luôn giữ những chuỗi lớn nhất: "năm khu vực nhỏ nhất" là một câu hỏi, còn
"năm khu vực nhỏ nhất, tách theo ba dòng sản phẩm ít bán nhất" thì không ai hỏi.

#### Câu cảnh báo của "nhỏ → lớn" nay có đường ra

Trước đó nó chỉ nói rằng sắp tăng dần không cho ra các nhóm nhỏ nhất. Giờ nó
chỉ luôn chỗ sửa, và **tự tắt** khi người dùng đã thật sự lấy nhóm nhỏ nhất.

### Sắp xếp trục: bốn cách, và một câu cảnh báo

```
Sắp xếp trục
  Theo giá trị (lớn → nhỏ)      ← mặc định
  Theo giá trị (nhỏ → lớn)
  Theo tên (A → Z)
  Theo tên (Z → A)
```

Danh sách và nhãn đọc từ `CHART_SORTS` / `CHART_SORT_LABELS` ở
`shared/src/report.ts`; `reportChartOptionsSchema` phía backend cũng dùng chính
`CHART_SORTS` cho `z.enum`. Thêm một cách sắp là sửa đúng một chỗ — ô chọn và
bộ kiểm không lệch nhau được.

#### "Nhỏ → lớn" KHÔNG phải "các nhóm nhỏ nhất" — cho tới §10.15

> ⚠️ Từ §10.15 nó ĐÚNG là các nhóm nhỏ nhất: lựa chọn này suy ra
> `config.pick = 'bottom'` và đổi hẳn câu hỏi gửi xuống Cube. Câu cảnh báo bên
> dưới đã được gỡ khỏi giao diện.

Backend sắp giảm dần rồi mới cắt top-N. Nên sắp tăng dần trên tập đã cắt cho ra
**N nhóm lớn nhất, xếp ngược** — một biểu đồ trông hoàn toàn hợp lý và đọc ra
một điều sai. Muốn nhóm nhỏ nhất thì phải đổi **truy vấn**, không phải đổi cách
sắp.

Đó là lý do lựa chọn này từng bị bỏ ra ngoài. Nay nó có mặt vì mọi công cụ BI
đều làm thế và người dùng cần nó thật — nhưng kèm một câu ngay dưới ô chọn, chỉ
hiện ở đúng lựa chọn đó:

> Chỉ sắp lại những nhóm đang hiện. "Số nhóm tối đa" vẫn cắt theo giá trị lớn
> nhất, nên đây là các nhóm lớn nhất xếp ngược — không phải các nhóm nhỏ nhất.

#### Mặc định phải là `null`, không phải một phép sắp tương đương

`sortOf` trả `null` cho `'value'` — **giữ nguyên** thứ tự backend trả về, chứ
không khai một phép sắp giảm dần trông có vẻ giống hệt. Hai thứ đó khác nhau ở
dòng **"Khác"**: nó là _phần còn lại_, không phải một nhóm, nên ở thứ tự mặc
định nó phải nằm cuối thay vì trôi theo giá trị của mình.

Ba lựa chọn kia thì sắp lại cả "Khác" theo đúng luật của chúng. Không phải bỏ
sót: `'label'` đã làm vậy từ §10.9, và mọi công cụ BI cũng thế — khi người dùng
**ra lệnh** sắp, một cái cột đứng yên một chỗ mới là thứ khó hiểu.

`'value-asc'` sắp bằng `{ field: 'value', op: 'sum', order: 'ascending' }` chứ
không đảo ngược mảng: biểu đồ nhiều chuỗi có nhiều dòng cùng một nhãn, nên thứ
tự phải tính trên **tổng** của nhãn đó — đảo mảng sẽ xếp theo dòng đầu tiên bắt
gặp, đúng với một chuỗi và sai với nhiều chuỗi.

#### Biểu đồ tròn nay cũng nghe ô này

Trước bản này nó bỏ qua hoàn toàn — kể cả `'label'` vốn đã có từ §10.9. Ô chọn
hiện ra cho mọi loại biểu đồ mà bấm mãi không thấy gì đổi, đúng chỗ người dùng
kết luận trang bị hỏng. Vòng tròn không sắp bằng `sort` trên một trục mà bằng
kênh `order`, nên `pieOrder` trỏ kênh đó vào `label` hay `value` tuỳ lựa chọn.
Mặc định `'value'` giữ nguyên hành vi cũ, nên không báo cáo tròn nào đã lưu bị
đổi hình.

### Bảng màu: NHÌN THẤY được, và đã qua máy kiểm

```
Bảng màu
  ████████   Tươi sáng             ← đang chọn
             Màu mạnh, nổi trên màn hình.
  ████████   Trầm dịu
             Cùng tám hướng màu nhưng dịu hơn, đỡ chói khi nhìn lâu.
```

Bản trước là một ô chọn với bốn dòng chữ: "Phân loại 10 màu", "Phân loại 20
màu", "Pastel dịu", "Đậm tương phản". Người dùng chọn **màu** bằng cách đọc
**tên**, rồi bấm, rồi nhìn biểu đồ, rồi quay lại đổi. Nay mỗi bảng là một dãy ô
vuông tô đúng màu Vega sẽ dùng, theo đúng thứ tự gán cho chuỗi thứ 1, 2, 3.

Đổi được điều đó là nhờ `CHART_PALETTE_COLORS`: bảng màu giờ là một **danh sách
hex** chứ không phải một cái tên scheme mà chỉ Vega hiểu — cùng một danh sách
vừa đi vào `scale.range`, vừa được bộ chọn tô ra.

#### Ba cái tên phải đi, và không một pixel nào được đổi theo (§10.12)

Bộ chọn từng có ba dòng, và cả ba đều nói sai một điều:

| dòng cũ                           | vấn đề                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------- |
| **Một màu thương hiệu** (`brand`) | trông y hệt dòng dưới nó — cả hai bắt đầu bằng một ô xanh dương              |
| **Power BI** (`powerbi`)          | mượn tên một sản phẩm khác ngay trong ứng dụng của người dùng                |
| **Xanh ngọc** (`teal`)            | đặt tên cho đúng MỘT ô trong tám, nên hàng chữ nằm cạnh cam, đỏ, tím và vàng |

`brand` giống dòng dưới vì nó **thật sự không làm gì cả**: biểu đồ một chuỗi tô
bằng màu thương hiệu bất kể bảng nào đang chọn (`mark.color` trong
`chartSpec`), còn biểu đồ nhiều chuỗi thì `brand` rơi về đúng bảng mặc định.
Một lựa chọn không đổi được một pixel nào là một lựa chọn nên **biến mất**,
không phải một lựa chọn nên giải thích thêm.

Cả ba xuống `CHART_PALETTES_LEGACY` — vẫn nhận được, vẫn vẽ y hệt, chỉ không
được mời nữa. Hai trong ba còn được `normalizePalette` **quy về tên mới ngay
lúc nạp**, và điều đó chỉ an toàn vì chúng vẽ ra không khác một mã màu nào:

| lưu trong `config` | bộ chọn tô sáng                 | dãy màu                                    |
| ------------------ | ------------------------------- | ------------------------------------------ |
| `brand`            | Tươi sáng                       | bảng mặc định (đúng thứ nó vẫn vẽ)         |
| `powerbi`          | Tươi sáng                       | **cùng một mảng**, không phải bản chép tay |
| `teal`             | _Xanh ngọc (cũ)_, thêm một dòng | dãy cũ, giữ nguyên                         |

`teal` **không** được quy đổi: "Trầm dịu" là một dãy màu khác hẳn, không phải
`teal` đổi tên. Gộp nó vào là lặng lẽ vẽ lại mọi báo cáo đang dùng nó.

#### "Chuẩn Power BI" và bộ kiểm không hoàn toàn đồng ý với nhau

Bảng mặc định của Power BI, chạy qua bộ kiểm màu (dải sáng, sàn sắc độ, ΔE giữa
các cặp liền kề với cả ba kiểu loạn sắc, tương phản với nền):

```
[FAIL] Lightness band    #12239E 0.354 · #6B007B 0.382 · #D9B300 0.778
[WARN] Contrast          #D9B300 chỉ 1,97:1 với nền
```

Xanh đậm và tím đậm nằm **dưới** dải sáng an toàn — trên nền trắng chúng đọc ra
gần như cùng một vệt tối. Vàng gốc thì không đạt 3:1 với nền.

Nên bảng **Tươi sáng** (`bright`) là bảng của Power BI với **ba màu được kéo vào
dải** và thứ tự xếp lại cho hai màu cạnh nhau cách nhau xa nhất:

| gốc       | thành     | vì sao            |
| --------- | --------- | ----------------- |
| `#12239E` | `#2F4BBF` | dưới dải sáng     |
| `#6B007B` | `#8E2A9E` | dưới dải sáng     |
| `#D9B300` | `#B08A00` | tương phản 1,97:1 |

**Trầm dịu** (`muted`) thì dựng từ đầu trong OKLCH với sắc độ 0,11–0,13 — thấp
hơn hẳn `bright`, và đó là thứ làm nó "dịu". Chỗ khó nằm ở chỗ khác: sắc độ
thấp kéo mọi cặp lại gần nhau dưới mắt loạn sắc. Bản đầu tiên trượt ngay ở cặp
hồng ↔ lục (ΔE 3,9 deutan).

Cách chữa là **xen kẽ độ sáng**: L 0,52 / 0,66 luân phiên, nên hai màu cạnh nhau
luôn lệch nhau một bậc sáng. Độ sáng là chiều duy nhất mắt loạn sắc vẫn đọc
được. Thêm một lần đảo thứ tự để đỏ và lục không nằm cạnh nhau, và:

```
[PASS] Dải sáng      cả 8 trong L 0.43–0.77
[PASS] Sàn sắc độ    cả 8 >= 0.1
[PASS] Khoảng cách loạn sắc   cặp tệ nhất ΔE 9.2 (deutan) · tritan 14.8
[PASS] Mắt thường    cặp tệ nhất ΔE 18.9
[PASS] Tương phản    cả 8 >= 3:1
```

Cả hai bảng PASS cả năm phép, **không một cảnh báo**.

⚠️ **Thứ tự trong mảng không phải để cho đẹp** — hai màu cạnh nhau là hai màu dễ
bị đem so nhất. Đổi thứ tự cũng là đổi bảng màu. Đổi một mã màu trong
`CHART_PALETTE_COLORS` thì **chạy lại bộ kiểm**, đừng ước lượng bằng mắt.

#### Không có bảng "pastel" nữa, và đó là kết quả đo được

Pastel thật thì trượt cả tương phản lẫn khoảng cách loạn sắc — thử vài biến thể
đều `FAIL`. Một bảng màu dịu mà người loạn sắc không phân biệt nổi hai chuỗi
cạnh nhau không phải một lựa chọn, nó là một cái bẫy.

#### Bảng màu CŨ không biến mất, chỉ thôi được mời

`CHART_PALETTES` là danh sách bộ chọn **mời**; `CHART_PALETTES_ALL` thêm bảy
bảng cũ và đó mới là thứ `z.enum` dùng. Hai lý do, cả hai đều cứng:

- Báo cáo đã lưu mang `palette: 'pastel'` trong `config`, và mở ra rồi bấm Lưu
  là gửi lại chính nó. Hẹp `z.enum` lại thì mọi báo cáo cũ vẫn mở được, vẫn cho
  bấm Lưu, và Lưu luôn trả **400**.
- Chúng vẫn vẽ bằng **tên scheme của Vega**, không phải hex chép tay. Chép lại
  dãy màu của `tableau10` vào mã nguồn thì chỉ cần sai một mã là mọi báo cáo
  đang dùng nó đổi màu — lặng lẽ, không ai đối chiếu được với cái gì.

Bộ chọn vẫn **hiện** bảng màu cũ mà báo cáo đang dùng, thêm một dòng. Lọc nó đi
thì mở một báo cáo cũ sẽ thấy bộ chọn tô sáng một bảng màu không phải bảng đang
vẽ, và người dùng bấm Lưu là lặng lẽ đổi màu biểu đồ của mình.

#### Nói ra khi bảng màu KHÔNG đổi được gì

Biểu đồ một chuỗi tô đúng một màu; bản đồ nhiệt tô theo độ đậm của con số. Ở hai
trường hợp đó, chọn bảng nào cũng ra hình y hệt — nên ô chọn nói thẳng, thay vì
để người dùng bấm thử ba dòng rồi kết luận nó hỏng.

### Chia trang thay cho cột "Khác": hai cái nút ‹ › (§10.12)

> ⚠️ **§10.15 bỏ ô chọn `overflow`** và giữ lại vế chia trang cho mọi biểu đồ.
> Hai cái nút, `offset` và cách `hasMore` được tính thì vẫn đúng như mô tả ở đây.

```
Số nhóm mỗi trang      [ 5 nhóm                          ]
Khi còn nhóm chưa hiện [ Chia trang — bấm ‹ › để xem hết ]   ← §10.15 bỏ
Trang đầu bắt đầu từ   [ Nhóm lớn nhất                   ]   ← §10.15 bỏ
```

Trần nhóm luôn phải có — một chiều ba nghìn giá trị mà vẽ hết thì không đọc được
gì. Nhưng tới §10.10 cái trần đó là một **bức tường**: phần vượt quá gộp thành
một cột "Khác" và không có đường nào nhìn vào bên trong nó.

Nay đó là một lựa chọn, và hai vế loại trừ nhau:

|                              |                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------- |
| **Gộp thành một cột "Khác"** | mặc định, và là hành vi từ §10.8 — mọi báo cáo đã lưu giữ nguyên từng con số |
| **Chia trang**               | mỗi trang `limit` nhóm, biểu đồ mọc hai nút ‹ › ở góc dưới phải              |

#### Vì sao không giữ được cả hai

Một cột "Khác" ở trang 2 sẽ có nghĩa là "phần còn lại **bên dưới** trang này" —
không tính những nhóm ở trang 1. Nó trông y hệt cột "Khác" của trang 1 mà mang
một con số khác hẳn. Nên chọn chia trang là bỏ hẳn cột "Khác", **ở mọi trang kể
cả trang đầu**, và `grouped` cũng tắt theo: câu "chỉ hiện các nhóm lớn nhất" nằm
dưới một biểu đồ có nút xem tiếp là nói sai ở đúng chỗ dễ tin nhất.

#### Trang là một phép của TRUY VẤN, không phải của cách vẽ

Mỗi lần bấm là một truy vấn Cube với `offset` khác, không phải một lát cắt của
tập đã tải về. Đo trên tám khu vực, trần 5 nhóm:

|         | nhóm trên trục                                 |
| ------- | ---------------------------------------------- |
| Trang 1 | An Giang, Binh Duong, Can Tho, Da Nang, Ea Kar |
| Trang 2 | Gia Lai, Ha Noi, Hue                           |

Không có cột "Khác" ở đâu cả, và trang 2 **không** lặp lại trang 1.

#### Không có "Trang N/M", và đó là một phép đo chứ không phải sự lười

Biết M đòi đếm toàn bộ giá trị phân biệt của chiều — thêm một lượt quét
ClickHouse cho **mỗi lần vẽ**, để in ra một con số. `hasMore` thì đến miễn phí
từ mẹo hỏi thừa một dòng đã có sẵn, và nó trả lời đúng câu hỏi mà hai cái nút
cần: còn nữa hay hết rồi. Nút `›` tự khoá khi hết.

#### Trang đang xem KHÔNG được lưu

`overflow` nằm trong `config` (nó đổi số liệu, cùng lập luận với `pick`); còn
**số trang đang xem thì không nằm ở đâu trong DTO cả** — nó đi như một tham số
riêng của một lần đọc. Lưu nó nghĩa là bấm ‹ › một cái rồi bấm Lưu sẽ ghi lại
"báo cáo này mở ra ở trang 4".

Đổi cấu hình cũng **về trang đầu**: trang 6 của câu hỏi cũ gần như chắc chắn
không tồn tại trong câu hỏi mới, và người dùng sẽ nhận một ô trống ngay sau một
cú thả trường.

#### Viewer cũng phải bấm được

Trình dựng hỏi `POST /datamodels/:id/report-preview`, nhưng endpoint đó gác
`datamodel:read` — thứ viewer không có (migration 26). Nên có đường riêng:
`GET /reports/:id/visuals/:visualId/data?page=`, gác `report:read`, và **không
nhận cấu hình nào từ client** — nó đọc cấu hình từ chính báo cáo đã lưu.

Hai cái nút hỏng ở đúng người cần chúng nhất thì thà đừng có.

#### Hai cái nút không bao giờ bị biểu đồ nuốt

Ô trên khung cao theo lưới và `overflow-hidden`. Phần thò ra luôn bị cắt, và thứ
bị cắt luôn là phần **dưới cùng** — trước đây là nhãn trục, từ §10.12 sẽ là hai
cái nút.

Nên `ReportChart` là một cột dọc: phần vẽ ở trên, hai cái nút và dòng cảnh báo
neo ở đáy ô. Chúng không bao giờ nằm trong vùng có thể bị cắt.

### Nhiều TRANG trên một báo cáo, như sheet của Excel (§10.12)

```
┌──────────────────────────────────────────────┐
│  (khung biểu đồ của trang đang mở)           │
├──────────────────────────────────────────────┤
│ [ Tổng quan ] [ Chi tiết ✕ ] [ + ]           │
└──────────────────────────────────────────────┘
```

§10.10 cho một báo cáo nhiều biểu đồ trên **một** khung, và điều đó đủ cho tới
lúc câu chuyện dài hơn một màn hình. "Tổng quan" và "Chi tiết theo khu vực" là
hai thứ đọc **nối tiếp** nhau, không phải cạnh nhau.

Thẻ ở dưới cùng, bấm để đổi trang, bấm đúp để đổi tên, dấu + để thêm. Cố ý
không bịa ra cách khác: người dùng báo cáo đã biết cái thanh đó làm gì trước khi
mở ứng dụng lần đầu.

#### Không có migration nào

`reports.canvas` là cột JSON. Hình dạng cũ là `{ visuals: [...] }`, hình dạng mới
là `{ pages: [{ id, name, visuals }] }`, và **cả đường đọc lẫn đường ghi nhận cả
hai**:

- `parseCanvas` quy hình dạng cũ về một trang tên "Trang 1", mã `p1`. Mã là
  **hằng**, không sinh ngẫu nhiên — nó đi vào khoá cache của trang xem, và một
  mã đổi sau mỗi lần đọc là một lần trượt cache sau mỗi lần đọc.
- `reportCanvasSchema` có một bước `preprocess` làm đúng việc đó ở đường ghi.
  Không phải để chiều một client tưởng tượng: một tab đang mở từ trước lúc triển
  khai vẫn gửi hình dạng cũ, và câu trả lời cho nó phải là "đã lưu".

Một câu `UPDATE` chạy trên mọi báo cáo của mọi tổ chức để đổi đúng một tầng lồng
nhau là rủi ro đổi lấy con số không.

#### Mỗi lần chỉ tính MỘT trang

`GET /reports/:id/canvas-data?pageId=` tính số liệu cho đúng một trang. Đó là lý
do trần 12 ô là trần **mỗi trang** mà lập luận chi phí của §10.10 vẫn đứng: mở
một báo cáo mười trang vẫn tốn đúng một trang truy vấn.

`pageId` lạ **rơi về trang đầu**, không 404. Nó xảy ra thật khi hai người mở
cùng một báo cáo và một người xoá một trang — rơi về trang đầu thì người kia
hiểu ngay, một màn hình lỗi thì không.

#### Ba luật của cả khung, và vì sao chúng ở tầng đó

| luật          | phạm vi        | vì sao không hẹp hơn                                                                                                                                            |
| ------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mã ô duy nhất | **cả báo cáo** | chuyển ô sang trang khác là thao tác bình thường và nó mang mã cũ đi theo; trùng mã thì `canvas-data` trả hai bản ghi cùng khoá và trình vẽ ghép nhầm số liệu   |
| ít nhất một ô | **cả báo cáo** | trang rỗng là hợp lệ — người ta thêm trang trước rồi mới dựng biểu đồ, và bắt trang phải có sẵn một ô nghĩa là bấm Lưu giữa chừng sẽ làm biến mất trang vừa tạo |
| tối đa 12 ô   | **mỗi trang**  | trần chi phí, mà chi phí tính theo trang đang mở                                                                                                                |

`mirrorOfFirst` soi ô đầu tiên của **trang đầu tiên có ô**, không phải
`pages[0].visuals[0]`: một trang đầu để trống là chuyện bình thường từ §10.12,
và soi cứng sẽ ghi `NULL` vào `chart_type` — báo cáo vừa lưu xong hiện ra là
"Chưa có biểu đồ" ở trang danh sách.

#### Chấm "Chưa lưu" phải thấy được cả trang

`snapshotOf` mang cả **tên** lẫn **thứ tự** trang. Đổi tên một trang hay kéo nó
lên trước cũng là việc phải lưu, và nếu ảnh chụp không thấy thì người dùng thoát
ra mất luôn mà không một câu hỏi.

Mốc khởi tạo dựng từ **chính** trang khởi tạo (`initialPages`), không phải từ
`snapshotOf('', [])`: gọi `emptyPage()` hai lần sinh hai mã trang khác nhau, và
một trình dựng vừa mở ra đã tự nhận là "Chưa lưu". Hỏi thừa vài lần là người
dùng học được cách bấm "Rời đi" mà không đọc.

### Biểu đồ co theo Ô, không co theo dữ liệu (§10.13)

> ⚠️ Khối này chữa CHIỀU CAO và để sót chiều ngang — xem §10.16 bên dưới. Lập
> luận thì vẫn nguyên: nó chỉ được áp cho cả hai chiều thay vì một.

> điều chỉnh khung biểu đồ co giãn theo khung hiện tại, chứ ko phải là biểu đồ
> 100% nhưng khung 70% thì lại bị thiếu dữ liệu như hiện tại

Tới §10.12, chiều cao biểu đồ và chiều cao ô là **hai con số không liên quan gì
nhau**:

|              | chiều cao lấy từ đâu                                               |
| ------------ | ------------------------------------------------------------------ |
| ô trên khung | lưới — `h` hàng × 44px, do người dùng kéo                          |
| spec Vega    | dữ liệu — 340px cho mọi loại, và thanh ngang thì 24px **một nhóm** |

Nên một biểu đồ 20 nhóm cao 480px nằm trong một ô 300px, và 7 nhóm cuối biến mất
sau mép ô mà không có gì báo là chúng đã biến mất. Đúng cái ảnh người dùng gửi.

Giờ `ReportChart` **đo** vùng vẽ của mình rồi truyền số đo đó vào spec, và Vega
chia lại chỗ: thanh mảnh đi, không nhóm nào rời khỏi biểu đồ.

```
ô 492px → header 29 + đệm 16 → vùng vẽ 445px → svg 445px, thò 0px
bóp ô xuống nhỏ nhất        → vùng vẽ 109px → svg 109px, thò 0px
```

#### Ba chỗ dễ sai

**1. `height` KHÔNG phải chiều cao SVG** — chỗ này đã sai thật một lần. Truyền
đúng số đo vào vẫn ra một SVG
cao hơn ô — đo được **487px trong một vùng vẽ 445px**, thò đúng 42px của trục
dưới. Vì `width: 'container'` chỉ bật `autosize` cho chiều **ngang**; chiều dọc
giữ nghĩa mặc định, ở đó `height` là hình chữ nhật **dữ liệu** và trục được cộng
thêm bên ngoài. Phải khai thẳng `autosize: { type: 'fit', contains: 'padding' }`.

**2. Đo ở đâu cũng được thì phép đo chạy vòng.** Trang xem một biểu đồ có khung
chứa cao **theo nội dung**: đo nó là đo chính thứ mình sắp quyết định. Nên chế độ
vừa-khung là một **cờ do nơi gọi bật** (`fit`), không phải một phép đoán tại chỗ
— chỉ nơi gọi mới biết hộp của mình cao theo lưới hay cao theo nội dung.

**3. Thanh cuộn tự nuôi chính nó.** Vùng vẽ phải `overflow-hidden` ở chế độ này:
một thanh cuộn hiện ra sẽ đổi chiều cao vùng đo → đổi chiều cao biểu đồ →
hiện/mất thanh cuộn. Vòng đó nhấp nháy vĩnh viễn.

#### Nhãn trục tự nhường nhau chỗ

Trục nhóm là thang band, mà mặc định của Vega-Lite ở đó là `labelOverlap: false`
— **mọi** nhãn đều được vẽ, kể cả khi chúng đè lên nhau thành một vệt xám. Trước
§10.13 điều đó vô hại vì trục dài ra theo số nhóm; giờ trục bị nhốt trong ô nên
20 nhãn có thể phải chen vào 200px. `greedy` chỉ bỏ đúng những nhãn **đang** đè
lên nhau, nên nơi còn chỗ thì không mất gì.

Chỉ bật ở chế độ vừa-khung. Bật sẵn ở chế độ cũ là đổi hình mọi biểu đồ đã lưu
để chữa một chuyện chưa xảy ra ở đó.

#### Chế độ cũ vẫn còn, và vẫn đúng

`fit` vắng mặt thì mọi thứ y như trước: 340px, thanh ngang dài theo số nhóm,
vùng vẽ cuộn được. Trang xem một biểu đồ nằm ở nhánh đó — nó cuộn cả trang, nên
một biểu đồ dài không mất gì.

### Bỏ dữ liệu là lựa chọn tệ nhất — nên nó không còn được chọn (§10.14)

> ⚠️ §10.15 đi hết nốt đoạn đường này: cột "Khác" cũng không còn được chọn
> nữa, nên `overflowOf` và `laCongDuoc` nhắc bên dưới đã bị xoá cùng ô chọn.
> Bảng ba lựa chọn thì vẫn là cách gọn nhất để thấy vì sao.

> với các biểu đồ dữ liệu quá lớn … sẽ có nút bấm qua bên để xem biểu đồ trên
> cùng 1 dim vs measure đó

Hai cái nút ‹ › đã có từ §10.12, nhưng chúng nằm sau một ô chọn mà người dùng
phải tự tìm ra. Mặc định thì phần vượt trần gộp vào cột **"Khác"** — và cột đó
chỉ dựng được khi phép tính **cộng được**. Gặp trung bình hay tỉ lệ, phần vượt
bị **bỏ hẳn** khỏi biểu đồ, kèm một dòng chữ nói rằng nó đã bị bỏ.

Ba lựa chọn cho phần vượt trần, xếp theo mức tệ:

|            | người xem nhận được gì                                                |
| ---------- | --------------------------------------------------------------------- |
| gộp "Khác" | một cột mang toàn bộ phần còn lại — không mất thông tin tổng          |
| chia trang | mọi nhóm đều mở ra được, chỉ không cùng lúc                           |
| **bỏ hẳn** | **một biểu đồ trông đầy đủ nhưng thiếu, và một dòng chữ nhỏ báo tin** |

§10.14 bỏ vế thứ ba. Luật gọn lại thành một câu:

```
cộng được   ->  gộp phần vượt thành cột "Khác"
không cộng  ->  CHIA TRANG
```

Trang 1 vẫn đúng những nhóm cũ — chỉ mọc thêm hai cái nút thay cho một dòng chữ
báo mất mát. Biểu đồ có **chiều thứ hai** cũng luôn chia trang: ở đó phần bị cắt
là một mặt phẳng, chia nó cho từng chuỗi là bịa ra số.

Ô chọn vẫn còn, và giờ nó nói đúng thứ nó làm: _"Gộp thành cột 'Khác' nếu cộng
được"_ / _"Luôn chia trang"_. Vế thứ hai là để ai muốn xem hết ngay cả trên một
thước đo tổng.

⚠️ Quyết định này đọc từ **định nghĩa thước đo**, không từ dữ liệu — nên nó nằm
ở `overflowOf`, chạy **trước** khi hỏi Cube. Phải vậy: `offset` của trang là một
phép của truy vấn, nên "có chia trang không" phải biết trước khi dựng truy vấn.

⚠️ `rowExpr` (§F9) cố ý **vẫn** không cộng được, dù tổng của một biểu thức dòng
về lý thuyết vẫn là một tổng. Đổi ranh giới đó sẽ làm mọi báo cáo đang dùng
thước đo biểu thức dòng lặng lẽ mọc thêm một cột "Khác" mà không ai xin.

### Mở một báo cáo đã lưu: 1289ms xuống 1112ms, và phần server xuống 3 lần (§10.14)

Người dùng nói biểu đồ hiện ra quá lâu ở lần mở đầu. Đo trước khi sửa, báo cáo
12 ô trên 51.000 dòng:

|                                    |                         |
| ---------------------------------- | ----------------------- |
| Cube lần đầu (biên dịch schema)    | 2785ms, sau đó 45–170ms |
| `GET /reports/:id/canvas-data`     | 391–775ms               |
| App khởi động + `GET /reports/:id` | 360ms                   |
| **biểu đồ hiện ra**                | **1289ms**              |

Hai chỗ thắt, và cả hai là chuyện cấu trúc chứ không phải chuyện tinh chỉnh.

#### 1. Mười hai ô nạp lại cùng một chỉ mục mô hình

Mỗi ô gọi `runExplorerQuery`, mà hàm đó tự nạp chỉ mục: `findOne` + ba truy vấn
danh sách + một truy vấn `schemaVersion`. Mười hai ô là **60 vòng MySQL** cho
một thứ không đổi giữa chúng — và pool 10 kết nối biến chúng thành một hàng đợi.

`loadModelContext` nạp một lần, route `canvas-data` gọi nó **trước**
`Promise.allSettled` rồi truyền xuống. Nạp trong ô đầu tiên thì không ăn thua:
mười hai ô xuất phát cùng lúc, không ô nào kịp nạp hộ ô nào.

    canvas-data 12 ô:  391–775ms  ->  117–165ms

Chỉ mục đó cũng đã chứa `agg` và loại nguồn của mọi thước đo, nên `overflowOf`
đọc thẳng từ đấy thay vì hỏi `listMeasures` thêm một lần cho mỗi ô.

#### 2. Hai request nối đuôi nhau mà lẽ ra không cần

`ReportViewer` chỉ render **sau** khi báo cáo về, nên truy vấn số liệu bên trong
nó bắt buộc xếp sau — mất trắng 360ms. Nhưng endpoint số liệu chỉ cần `id`, thứ
đã nằm sẵn trên thanh địa chỉ.

`ReportViewPage` gọi `useReportCanvasData(id, null)` ngay từ lượt render đầu.
`pageId = null` nghĩa là "trang đầu, trang nào cũng được" — backend tự rơi về
`pages[0]`, nên hỏi được **trước khi biết báo cáo có những trang nào**. Đo bằng
waterfall thật:

```
   328ms  bắt đầu  /reports/36            ─┐  cùng khởi hành
   328ms  bắt đầu  /reports/36/canvas-data ─┘
   365ms  xong     /reports/36
   952ms  xong     /reports/36/canvas-data
  1112ms  BIỂU ĐỒ HIỆN RA
```

⚠️ `ReportViewer` phải hỏi trang đầu bằng `null` chứ **không** bằng mã trang
thật, nếu không hai bên khác khoá cache và lời gọi sớm chỉ hâm nóng một ô không
ai đọc — mất trắng đúng phần vừa tiết kiệm được.

#### Đã thử và đã BỎ: nới trần đồng thời của Cube

Đo 1/2/4/8/12 truy vấn song song qua `report-preview` thấy độ trễ phẳng tới 4
rồi tăng tuyến tính — hình dạng của một hàng đợi. Đặt `CUBEJS_CONCURRENCY: 12`,
khởi động lại Cube, đo lại: `canvas-data` **giữ nguyên trung vị 162ms**.

Phép đo dẫn tới giả thuyết đó gọi `report-preview` mười hai lần, mà đường ấy nạp
lại chỉ mục cho **mỗi** lần gọi. Thứ đo được là hàng đợi **pool MySQL**, không
phải hàng đợi Cube. Biến môi trường đã được gỡ; chú thích ở
`infrastructure/docker-compose.yml` giữ lại kết quả để người sau khỏi thử lại.

#### Cái KHÔNG chữa được ở tầng này

Lần mở **đầu tiên sau khi Cube khởi động** vẫn tốn 2785ms cho việc biên dịch
schema. Đó là một lần cho mỗi vòng đời của container, không phải mỗi lần mở báo
cáo. Ảnh chụp số liệu trên đĩa (`querySnapshots`) lo những lần mở **sau**; lần
đầu thì theo định nghĩa là chưa có gì để chụp.

### Bốn ô chọn xuống hai, một bảng màu có tác dụng, hai cột gấp được (§10.15)

Ba lời than, cùng một màn hình.

#### 1. "Bỏ cột khi còn nhóm chưa hiện và giữ lại nhóm nào đi"

> vì mặc định sẽ tạo ra nhiều biểu đồ báo cáo và người dùng sẽ bấm sang trang
> từ từ để xem nó

Bảng "Định dạng" có bốn ô chọn nói về cùng một chuyện, đọc từ trên xuống:

```
Số nhóm tối đa          [ 20 nhóm                            ]
Khi còn nhóm chưa hiện  [ Gộp thành cột "Khác" nếu cộng được ]  ← bỏ
Giữ lại nhóm nào        [ Nhóm lớn nhất                      ]  ← bỏ
Sắp xếp trục            [ Theo giá trị (lớn → nhỏ)           ]
```

Cả hai ô ở giữa đều bị bỏ, nhưng vì hai lý do khác nhau.

**`overflow` biến mất khỏi cả hệ thống.** Cột "Khác" trả lời được đúng một câu —
"phần còn lại lớn cỡ nào" — và không bao giờ trả lời được câu người ta hỏi tiếp,
"trong đó có gì". Trên một chiều 1800 giá trị nó còn nuốt cả biểu đồ: một cái
cột 48 triệu đứng cạnh hai mươi cái cột li ti. Chia trang trả lời được cả hai
câu, nên nó ở lại một mình. Bỏ **hẳn** ô chọn thay vì đổi mặc định: hai lựa chọn
loại trừ nhau mà một trong hai luôn tốt hơn thì cái ô ấy chỉ đang bắt người dùng
học một khái niệm để rồi chọn đúng cái mặc định.

**`pick` thì gộp vào ô "Sắp xếp", không mất.** Hai ô này vốn nói về cùng một
chuyện, và ba trong bốn tổ hợp của chúng đọc lên nghe giống nhau — người dùng
chọn "nhỏ → lớn" rồi tưởng mình đang xem các nhóm nhỏ nhất, trong khi thứ hiện
ra vẫn là hai mươi nhóm **lớn nhất xếp ngược**. Giao diện phải in một dòng chú
thích để đính chính chính nó (xem §10.12 ở trên). Nay:

```
sort = 'value-asc'  ->  pick = 'bottom'   xin Cube đúng các nhóm NHỎ NHẤT
mọi cách sắp khác   ->  pick = 'top'
```

Phép suy ra nằm ở `pickOf` trong `builder/visual.ts` — **cạnh** hai hàm dựng khoá
cache, không phải trong `VisualPanel`. Bảng cấu hình chỉ tồn tại khi màn hình
đang mở; khoá cache thì được dựng cả ở trang xem, nơi không có bảng cấu hình
nào.

⚠️ `pick` vẫn được **lưu** vào `config` chứ không chuyển sang `options`. Backend
đọc `config` và không bao giờ đọc `options` — ranh giới "options không đổi số"
còn nguyên, và `pick` vẫn nằm trong khoá cache như từ §10.11.

⚠️ `fromDto` đọc `pick: 'bottom'` của bản ghi cũ ra thành `sort: 'value-asc'`.
Thiếu bước đó thì mở một báo cáo "20 nhóm nhỏ nhất" rồi bấm Lưu là nó lặng lẽ
thành "20 nhóm lớn nhất" — người dùng không đụng vào ô nào cả.

⚠️ `reportModelConfigSchema` **không** `.strict()`, nên một tab đang mở từ trước
bản này vẫn gửi `overflow` lên và chỉ bị bỏ qua, không nhận 400. Có một ca
integration khoá đúng chuyện đó.

Nhánh **bộ dữ liệu** (`aggregateWarehouse`) không đổi: nó không có `offset`, không
có trình dựng, và không còn báo cáo mới nào đi qua đó. Cột "Khác" vẫn còn ở đấy.

#### 2. Bảng màu bấm được, tô sáng được, lưu được — mà biểu đồ đứng yên

> phần bảng màu chỉ hiển thị bấm được với các biểu đồ có thể điều chỉnh biểu đồ
> thôi, chứ như biểu đồ cột lại ko thể thay đổi bảng màu

Đúng, và lý do nằm ở hai hằng số:

|                           | trước §10.15        | sau                                 |
| ------------------------- | ------------------- | ----------------------------------- |
| biểu đồ MỘT chuỗi         | `--color-brand-600` | màu **đầu tiên** của bảng đang chọn |
| bản đồ nhiệt              | `scheme: 'blues'`   | thang nhạt → màu đầu tiên của bảng  |
| nhiều chuỗi, biểu đồ tròn | cả dãy              | không đổi                           |

Bảng cấu hình thôi xin lỗi cho một ô chọn không làm gì, và chuyển sang nói nó
làm gì: _"Biểu đồ một chuỗi dùng MÀU ĐẦU TIÊN của bảng."_

Màu đầu tiên là lựa chọn đúng chứ không phải lựa chọn tiện: nó cũng là màu Vega
gán cho chuỗi thứ nhất, nên thả thêm một chiều vào ô Nhóm màu thì CHUỖI ĐẦU
**giữ nguyên** màu cũ thay vì cả biểu đồ nhảy sang một dãy màu khác.

⚠️ **Không** tô mỗi nhóm một màu. Màu khi đó mã hoá đúng thứ trục ngang đã mã
hoá, và với hai mươi nhóm thì dãy tám màu phải quay vòng — hai nhóm khác hẳn
nhau mang cùng một màu, thứ mắt đọc thành "hai nhóm này cùng loại".

⚠️ Đây là một lần **vẽ lại có chủ ý**: mọi biểu đồ một chuỗi đã lưu đổi từ tím
chàm sang màu đầu của bảng nó đang mang. Không tránh được nếu muốn ô chọn có tác
dụng, và cái mất đi chỉ là một màu chưa từng ai chọn.

⚠️ Thang bản đồ nhiệt nội suy trong không gian `lab`, không phải `rgb`: `rgb`
trộn thẳng ba kênh nên khúc giữa xám và tối hơn hai đầu — hai ô giá trị khác
nhau lại trông đậm ngang nhau.

Đo trên trình duyệt thật, cùng một biểu đồ cột, chỉ đổi bảng màu:

```
Tươi sáng  #118dff   (10 mark)
Trầm dịu   #2e69b2   (10 mark)
```

#### 3. Hai cột bên gấp lại được

> thêm các nút thu gọn mục chỉnh biểu đồ và mục mô hình dữ liệu để trang hiển
> thị biểu đồ báo cáo được rộng hơn, hiện tại đang hơi bé

Hai cột bên chiếm 288 + 256 = **544px cố định**. Trên một màn 1500px thì khung
biểu đồ — thứ duy nhất người ta đang thật sự nhìn — còn 892px, và mười hai ô
chia nhau chỗ đó.

Nhưng cả hai cột đều **có lúc** cần: bảng trường lúc kéo thả, bảng cấu hình lúc
chỉnh. Nên câu trả lời không phải bỏ bớt một cột mà là cho người dùng gấp nó
lại. Đo được:

```
khung biểu đồ:  892px  ->  1372px   (+480px, đúng 544 trừ hai thanh ray 32px)
```

Ba chi tiết trong `SidePanel` không được bỏ:

1. Gấp thành một **thanh ray** còn thấy được, không biến mất. Một cột biến mất
   hẳn thì đường mở lại nó cũng biến mất theo.
2. Cả thanh ray **là** cái nút. Một nút 20px trong một thanh 32px là ba phần tư
   diện tích bấm vào không có tác dụng.
3. Nhớ trong `localStorage`, **mỗi cột một khoá**. Dùng chung một khoá thì gấp
   cột này là gấp luôn cột kia, trông y như một lỗi vẽ lại.

⚠️ Chiều rộng đi vào bằng **lớp Tailwind** (`"w-72"`) chứ không bằng số pixel:
Tailwind quét mã nguồn để sinh CSS, nên một lớp dựng lúc chạy sẽ không có CSS
nào và cột rơi về rộng-theo-nội-dung.

### Kéo ô hẹp lại thì biểu đồ hẹp theo — nốt nửa còn lại của §10.13 (§10.16)

> đang bị lỗi kéo nhỏ biểu đồ thì lại bị cắt mất dữ liệu, tui đang muốn khi kéo
> nhỏ khung biểu đồ thì biểu đồ cũng thu nhỏ theo

§10.13 đo chiều cao của ô rồi truyền vào spec, và giao chiều ngang cho
`width: 'container'`. Đó là chỗ hở, vì hai chiều KHÔNG được lo bởi cùng một cơ
chế: `'container'` bảo vega-embed tự đo thẻ bọc, mà nó chỉ đo lại khi `window`
phát sự kiện `resize`. Kéo một cái ô hẹp lại thì cửa sổ không đổi một pixel nào.

Đo trên trình duyệt thật, kéo tay nắm co giãn của một ô:

```
kéo THẤP xuống:  vùng vẽ 870×221  ->  svg 870×221   thò 0px    ✔
kéo HẸP lại:     vùng vẽ 195×109  ->  svg 870×109   thò 675px  ✘
```

675px biểu đồ nằm ngoài ô, và `overflow-hidden` cắt đúng phần đó đi. Cùng một
lỗi còn xảy ra ở một chỗ nữa mà không ai nghĩ tới: **gấp một cột bên (§10.15)**
làm cả hàng ô rộng thêm 480px, cũng không qua `window.resize`.

#### Phép chữa: một ResizeObserver, hai con số

`ReportChart` vốn đã quan sát đúng thẻ div ấy để lấy chiều cao. Giờ nó đọc cả
`contentRect.width` và truyền vào spec bằng một SỐ. `'container'` vẫn là đường lui
khi nơi gọi không đo được — trang xem một biểu đồ, nơi bề ngang chỉ đổi khi cửa
sổ đổi.

⚠️ State là MỘT object `{w, h}` và chỉ đổi khi một trong hai chiều thật sự đổi.
Trả về object mới cho mỗi lần quan sát là dựng lại toàn bộ view Vega cho một
kích thước y hệt — mà một cú kéo ngang bắn ra hàng chục lần quan sát.

#### Ô nhỏ thì tên trục nhường chỗ cho dữ liệu

Vừa khung rồi vẫn còn một câu hỏi: trong 109px chiều cao ấy, bao nhiêu phần
trăm là **dữ liệu**? Đo ở ô nhỏ nhất lưới cho phép (vẽ 195×109):

|              | vùng vẽ dữ liệu                |
| ------------ | ------------------------------ |
| còn tên trục | 122×28 — một phần tư chiều cao |
| bỏ tên trục  | **136×43** — cao thêm 54%      |

Nên từ §10.16, tên trục tự rút khi ô nhỏ: dưới **200px cao** thì mất tên trục
nằm ngang, dưới **320px ngang** thì mất tên trục nằm dọc. Hai ngưỡng riêng vì
tên trục ăn chỗ theo phương **vuông góc** với trục nó đặt tên — và biểu đồ
thanh ngang đảo cả hai, vì ở đó hai trục đổi chỗ cho nhau.

Mất mát gần bằng không: tiêu đề ô ngay bên trên đã nói "Quantity theo Category".
Ô lớn thì giữ nguyên, vì ở đó người dùng có thể đã đổi tên ô thành một câu không
nhắc tới trường nào.

#### Cái KHÔNG tự bỏ: chú giải

Ô hẹp hết cỡ mà có chiều thứ hai thì chú giải ăn quá nửa bề ngang (đo được: vẽ
195×221, phần dữ liệu còn 90×184). Vẫn không tự tắt nó, vì với biểu đồ nhiều
chuỗi thì chú giải là thứ DUY NHẤT nói màu nào là chuỗi nào — tắt đi là còn
một mớ đường màu không đọc được. Công tắc "Hiện chú giải" nằm sẵn trong bảng
cấu hình cho ai muốn.

### Báo cáo đã lưu vẽ NGAY, rồi mới làm mới ngầm

Báo cáo lưu **cấu hình**, không lưu con số. Nên mỗi lần mở là một lượt tính lại
từ đầu — và người dùng ngồi nhìn "Đang tính…" để cuối cùng nhận về đúng cái
biểu đồ lần trước, không khác một nét.

Đo trên máy phát triển, cùng một truy vấn qua Cube xuống ClickHouse:

|                                                                                     | thời gian    |
| ----------------------------------------------------------------------------------- | ------------ |
| lần đầu sau khi Cube khởi động, **hoặc sau khi bất kỳ mô hình nào của tổ chức đổi** | **4.638 ms** |
| những lần sau                                                                       | 49–175 ms    |

Vài giây đó là Cube **biên dịch schema của cả tổ chức**. `schemaVersion` mà
Express ký vào token là `MAX(updated_at)` của mọi mô hình còn sống (xem
`repositories/datamodels.ts`), nên sửa một mô hình là hạ nhiệt cache của **tất
cả** mô hình trong tổ chức đó. Cố ý — "sai theo hướng biên dịch thừa thì chỉ
chậm, sai theo hướng dùng lại schema cũ thì trả số sai" — và không rút ngắn
được ở tầng ứng dụng.

Nên thay vì làm nó nhanh hơn, ta thôi bắt người dùng **nhìn** nó:
`services/querySnapshots.ts` giữ câu trả lời cuối của mỗi ô trên đĩa trình
duyệt và nạp lại qua `initialData` + `initialDataUpdatedAt` của react-query.

Đo lại bằng trình duyệt thật, bấm vào tên báo cáo trong danh sách, Cube vừa bị
làm nguội:

|                               | biểu đồ hiện sau | thấy "Đang tính…" |
| ----------------------------- | ---------------- | ----------------- |
| chưa có ảnh chụp (hành vi cũ) | 2.137 ms         | có                |
| đã có ảnh chụp                | **284 ms**       | **không**         |

#### Ba luật của ảnh chụp

1. **Luôn hỏi lại.** `initialDataUpdatedAt` mang đúng lúc con số được tính, nên
   `staleTime` xử nó như một câu trả lời cũ: vẽ liền, rồi làm mới ngầm. Ảnh
   chụp để **vẽ ngay**, không phải để khỏi hỏi.
2. **Khoá là `hashKey` của chính query key** — cùng hàm react-query dùng cho
   cache trong bộ nhớ, đã sắp thứ tự khoá object. Đổi chiều, thước đo, trần
   nhóm hay mô hình là **trượt**, chứ không phải vẽ số cũ cho cấu hình mới.
   `previewConfigOfDraft` và `previewConfigOfDto` (trong `builder/visual.ts`)
   quy ô-đang-soạn và ô-đã-lưu về cùng một hình dạng, nên trình dựng và trang
   xem dùng lại được số liệu của nhau.
3. **Hỏng thì im lặng bỏ qua.** Chế độ riêng tư và cài đặt chặn cookie làm
   `localStorage` _ném lỗi_ chứ không trả null. Một cái cache làm chết cả trang
   là một cái cache tệ hơn không có.

#### Vì sao là đĩa của TRÌNH DUYỆT, không phải một bảng cache ở server

Token gửi xuống Cube mang cả `userId`, và `queryRewrite` trong
`infrastructure/cube/cube.js` đang để dành sẵn cho Row-level Security. Một bảng
cache dùng chung, khoá theo (báo cáo, cấu hình), sẽ trả số của người này cho
người kia đúng ngày RLS được bật — một lỗi rò dữ liệu sinh ra từ một tính năng
tăng tốc. `localStorage` thì per-trình-duyệt, per-người, theo cấu tạo. Nó cũng
được xoá cùng `queryClient.clear()` ở `AuthProvider` khi đăng xuất hoặc đổi tổ
chức — cần hơn cả cache trong bộ nhớ, vì nó sống qua lần đóng trình duyệt.

#### Nó KHÔNG làm gì

- **Không che lỗi.** `isError` vẫn thắng ở cả hai màn hình: Cube chết là hiện
  câu lỗi, không phải một biểu đồ cũ trông như còn sống.
- **Không giấu việc mình là số cũ.** Ô trong trình dựng ghi "đang cập nhật…" và
  làm mờ biểu đồ; trang xem ghi "Số liệu lần trước — đang cập nhật…" trên đầu
  khung. Vẽ ngay mà không nói gì thì thành nói dối.
- **Không đụng báo cáo một-biểu-đồ dựng trên BỘ DỮ LIỆU.** Đường đó
  (`useReportData`) khoá theo id báo cáo chứ không theo cấu hình, nên một ảnh
  chụp ở đó sẽ sống sót qua cả lần sửa biểu đồ. Nó cũng không đi qua Cube nên
  không có chi phí biên dịch để mà tránh.
- **Không hỏi lại trong 30 giây đầu.** Đó là `staleTime` mặc định của cả ứng
  dụng, không phải luật riêng của chỗ này.

⚠️ `qs1` trong tiền tố khoá là **phiên bản hình dạng**. Đổi hình dạng
`ReportDataDto` thì tăng lên `qs2`: ảnh chụp cũ nằm trong máy người dùng sẽ
được đọc bởi code mới, và một trường mới bắt buộc sẽ làm trình vẽ ném lỗi trên
một dữ liệu mà không request nào tạo ra được nữa.

### Lưới 12 cột, lưu bằng ĐƠN VỊ LƯỚI chứ không phải pixel

Người dựng báo cáo trên màn 27 inch, người xem mở trên laptop 13 inch. Lưu pixel
nghĩa là mọi ô lệch chỗ ở mọi màn hình khác màn hình đã dựng. Lưới co giãn theo
bề rộng thật nên bố cục giữ nguyên **tỉ lệ** ở mọi khổ.

12 vì nó chia hết cho 2, 3, 4 và 6 — bốn cách chia mà người ta thật sự dùng.

Hằng số dùng chung ở `shared/src/report.ts`, nên trình dựng và trang xem không
thể lệch nhau: `CANVAS_COLUMNS`, `CANVAS_ROW_HEIGHT`, `CANVAS_MIN_W/H`,
`CANVAS_MAX_VISUALS`.

**Các ô ĐƯỢC PHÉP đè lên nhau.** Không có bước tự đẩy nhau ra như
`react-grid-layout`: đẩy tự động nghĩa là kéo một ô làm ba ô khác nhảy chỗ, và
người dùng mất luôn bố cục vừa sắp.

### Kéo ô bằng Pointer Events, kéo TRƯỜNG bằng HTML5 drag-and-drop

Hai cơ chế khác nhau trong cùng một trang, và đó là cố ý:

| Việc                                         | Cơ chế                | Vì sao                                                                                     |
| -------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| Kéo một **trường** từ bảng mô hình vào ô thả | `draggable` của HTML5 | cú kéo mang một **mẩu dữ liệu** từ chỗ này sang chỗ khác — đúng việc API đó sinh ra để làm |
| Di chuyển / co giãn một **ô** trên khung     | Pointer Events        | thao tác hình học **liên tục**, cần toạ độ ở từng khung hình                               |

`dragover` chỉ bắn khi con trỏ đi qua một vùng thả, **không cho đọc dữ liệu đã
set**, và trên phần lớn trình duyệt còn kéo theo một ảnh ma nửa trong suốt không
tắt được. `setPointerCapture` thì giữ được sự kiện cả khi con trỏ chạy ra ngoài
cửa sổ — thứ mà thả tay ngoài mép màn hình cần tới.

**Bàn phím là đường đi đầy đủ, không phải lối phụ:** mũi tên di chuyển ô,
Shift+mũi tên co giãn, Delete xoá.

### Số liệu: trình dựng hỏi theo TỪNG ô, trang xem hỏi MỘT lần

Hai nhịp khác nhau nên hai cách hỏi khác nhau:

|             | Cách hỏi                                        | Vì sao                                                                                                                                                          |
| ----------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trình dựng  | mỗi ô một `POST /datamodels/:id/report-preview` | kéo một trường vào ô số 3 không có lý do gì bắt ba ô kia quét lại ClickHouse. react-query gộp theo khoá `config`, nên hai ô cấu hình y hệt vẫn chỉ tốn một lượt |
| Bản chỉ đọc | một `GET /reports/:id/canvas-data`              | mọi ô nạp cùng lúc đúng một lần; tách ra thành n request là hai lượt khứ hồi trước khi thấy biểu đồ đầu tiên                                                    |

**Một ô hỏng KHÔNG làm hỏng cả khung.** Backend dùng `Promise.allSettled`, và mỗi
ô mang `error` của riêng nó. `Promise.all` sẽ biến một ô trỏ vào thước đo vừa bị
xoá thành một request 500 — bảy ô còn lại hoàn toàn đọc được cũng biến mất theo.
Đã kiểm bằng tay trên dữ liệu thật: một ô báo _"Có trường không còn trong mô
hình"_, ô cạnh nó vẫn vẽ đủ 6 dòng.

⚠️ Ghép số liệu vào ô bằng `visualId`, **không** bằng thứ tự mảng. Backend trả
đúng thứ tự đã nhận, nhưng dựa vào điều đó là dựa vào một chi tiết cài đặt —
đổi sang gộp trùng hay bỏ bớt ô hỏng là số liệu của ô này lặng lẽ hiện trong ô
kia: biểu đồ đúng hình, sai số, không ai nhìn ra bằng mắt.

### Cột `canvas` và bản sao của ô đầu tiên

`reports.canvas` là JSON, `NULL` mang nghĩa thật:

```
canvas IS NULL      báo cáo MỘT biểu đồ — mọi bản ghi có từ trước §10.10
canvas IS NOT NULL  khung nhiều biểu đồ, và ĐÂY là bản gốc
```

Nhờ vậy **không phải migrate một dòng dữ liệu nào**.

Khi ghi một khung, backend còn chép ô đầu tiên sang `chart_type` + `config`. Bản
sao đó tồn tại vì đúng một lý do: mọi thứ viết trước §10.10 vẫn đang đọc hai cột
ấy — `GET /reports/:id/data`, huy hiệu loại biểu đồ, và bất kỳ client cũ nào. Để
chúng `NULL` nghĩa là một khung vừa lưu xong hiện ra là _"Chưa có biểu đồ"_.

Bản sao đi **một chiều**. Sửa `chart_type`/`config` mà không sửa `canvas` là tạo
ra hai sự thật, nên mọi đường ghi của khung phải đi qua `createCanvasReport` /
`updateCanvasReport`.

**Chuyển đổi một chiều:** gọi `PATCH /reports/:id/canvas` trên một báo cáo
một-biểu-đồ sẽ biến nó thành khung. Cố ý — đó là cách một báo cáo dựng ở §10.9
thêm được ô thứ hai mà không phải tạo lại. Không mất gì, vì ô đầu tiên giữ nguyên
cấu hình cũ và bản sao vẫn được cập nhật.

### Endpoint

|                                                    |                                                     |
| -------------------------------------------------- | --------------------------------------------------- |
| `POST /v1/reports/canvas`                          | tạo khung — `report:modify`                         |
| `PATCH /v1/reports/:id/canvas`                     | lưu khung, và là đường chuyển đổi — `report:modify` |
| `GET /v1/reports/:id/canvas-data?pageId=`          | số liệu mọi ô của MỘT trang — `report:read`         |
| `GET /v1/reports/:id/visuals/:visualId/data?page=` | số liệu một ô ở một trang nhóm — `report:read`      |
| `GET /v1/reports/:id/data?page=`                   | báo cáo một biểu đồ, có trang nhóm — `report:read`  |

⚠️ `canvas-data` **không** gắn `datamodel:read`, cùng lý do đã ghi ở
`GET /reports/:id/data`: viewer không có ô đó nhưng vẫn phải xem được báo cáo
người khác dựng cho họ. Gắn nhầm vào là làm trắng mọi khung của viewer — và
không ca test nào khác bắt được, vì viewer vẫn 200 ở mọi đường còn lại. Có một
ca riêng gác đúng chuyện này.

Cả 12 ô được kiểm bằng **một** bảng trường (`assertChartConfigAgainst`): chúng
cùng thuộc một mô hình, nên dựng chỉ mục 12 lần là trả giá cho thứ đã có sẵn.

**Một ô sai làm hỏng cả lần lưu.** Lưu ô hợp lệ rồi lặng lẽ bỏ ô sai sẽ cho người
dùng một khung khác thứ họ vừa dựng, mà không nói gì.

### Bài test đáng đọc

| File                                                 | Khoá lại điều gì                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/tests/datamodel.integration.test.ts` §10.13 | 6 ca khoá chiều ngược của §10.11: mô hình dựng-hộ **có** trong danh sách, được tính vào `total`, và một client cũ còn gửi cờ `hidden` cũng không giấu được gì                                                                                                                     |
| `frontend/tests/fieldSheets.test.ts`                 | gom trường theo bảng và lọc theo từ khoá. Sau khi bỏ hai khối "Chiều"/"Thước đo", thứ tự và cách gom là thứ duy nhất còn giúp người dùng tìm được một trường                                                                                                                      |
| `frontend/tests/chartSpec.test.ts`                   | mọi spec Vega **biên dịch được** (bắt cả `warn`, không chỉ lỗi ném ra), bốn cách sắp trục cho ra **bốn** spec khác nhau, và chế độ vừa-khung (§10.13) khai đúng `autosize: fit` — thiếu nó thì trục vẫn thò ra 42px và không có gì đỏ ở đâu cả                                    |
| `frontend/tests/querySnapshots.test.ts`              | ảnh chụp số liệu trên đĩa. Phần lớn ca kiểm chuyện **trượt** — đổi cấu hình, đổi mô hình, mục hỏng, `localStorage` bị chặn — vì một cache sai không hỏng ra mặt, nó vẽ một biểu đồ trông bình thường bằng số của câu hỏi khác                                                     |
| `frontend/tests/savedReportInstant.test.tsx`         | mở báo cáo đã lưu thì có biểu đồ ở **khung hình đầu tiên**, và màn hình **nói ra** đó là số cũ đang cập nhật. Request cố ý không bao giờ trả lời — đây là bài kiểm về đúng khoảnh khắc chờ                                                                                        |
| `frontend/tests/shelfKind.test.tsx`                  | ô thả có in ra loại trường nó nhận không, và có in ĐÚNG cái `accepts` của nó không. Kiểm ở trạng thái ĐÃ ĐIỀN — trạng thái trống chưa bao giờ là chỗ thiếu thông tin — và trên cả `VisualPanel` thật, nên bắt được cả tên ô đổi theo loại biểu đồ ("Lát cắt") lẫn ô bị khoá       |
| `frontend/tests/canvasVisual.test.ts`                | phép tính bố cục và luật của một ô — `findSlot`, `clampBox`, `assignField`, `toDto`, và `hasUnsavedWork`. Sai ở đây không hiện ra như lỗi: một ô lệch cột trông y hệt một ô người dùng tự đặt lệch, còn `hasUnsavedWork` sai là mất việc của người dùng mà không một câu cảnh báo |
| `frontend/tests/CanvasView.test.tsx`                 | render thật trong DOM: ghép số liệu theo `visualId` (ca này **đảo thứ tự** mảng trả về), và một ô hỏng không kéo theo ô khác                                                                                                                                                      |
| `backend/tests/datamodel.integration.test.ts` §10.10 | 20 ca ở tầng cấu hình — trùng mã ô, khung rỗng, tràn lưới, quá trần, trường lạ, chuyển đổi, ranh giới với báo cáo trên bộ dữ liệu, và **hình dạng cũ `{visuals}` vẫn ghi được rồi đọc ra một trang**                                                                              |
| `backend/tests/datamodel.integration.test.ts` §10.12 | `?page=` có trần, `canvas-data?pageId=` tính đúng trang được hỏi (mã lạ rơi về trang đầu, không 404), và `overflow` của một client CHƯA cập nhật được nhận rồi bỏ qua thay vì 400 — lỗi kiểu đó chỉ hiện ra sau khi deploy, và chỉ với người chưa tải lại trang                   |
| `frontend/tests/groupPaging.test.tsx`                | hai cái nút ‹ › và thanh thẻ trang. Phần lớn ca kiểm chuyện **không** bày ra nút: cấu hình không chia trang, dữ liệu vừa một trang, không có `onPage`. Một cặp nút chết chỉ nói với người dùng rằng có gì đó hỏng                                                                 |
| `frontend/tests/sidePanel.test.tsx`                  | hai cột bên gấp lại được (§10.15). Phần lớn ca kiểm hai thứ hỏng LẶNG LẼ quanh cái nút: hai cột dùng chung một khoá thì gấp cột này gấp luôn cột kia, và `localStorage` bị chặn thì ĐỌC cũng ném lỗi — một lỗi lúc render là cả trình dựng trắng màn                              |
| `frontend/tests/reportViewPage.test.tsx`             | trang xem mở được cho **mọi** vai trò, và nút "Chỉnh sửa" chỉ có mặt khi nó thật sự dẫn tới một trình dựng dùng được — không phải bảo mật, mà là đừng bày ra một cái nút dẫn tới 403                                                                                              |

Không ca nào cần ClickHouse trả số thật. Việc đó đã được chứng minh bằng tay
trên dữ liệu thật; buộc nó vào CI sẽ biến một bộ test cấu hình thành một bộ test
hạ tầng.

---

## Sự cố thường gặp

| Triệu chứng                                                                                  | Nguyên nhân & cách xử lý                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$'\r': command not found` khi chạy `.sh`                                                    | File bị CRLF. `git rm --cached -r . && git reset --hard`                                                                                                                                                                                                                                       |
| Backend thoát ngay, in `[env] Cấu hình môi trường không hợp lệ`                              | `.env` thiếu biến mà một nhánh vừa merge thêm vào. Chạy `npm run setup` — nó bổ sung biến mới và **không** đụng giá trị đang có                                                                                                                                                                |
| Màn hình báo _Không nối được tới backend ở http://localhost:4000_                            | Backend không chạy, hoặc đang khởi động lại. Xem log terminal `[api]`; hay gặp nhất là dòng `[env] Cấu hình môi trường không hợp lệ` ở trên. Câu này do proxy của Vite trả về — xem mục _Câu "Có lỗi không xác định" đã bị xoá sổ_                                                             |
| Câu "Có lỗi không xác định. Vui lòng thử lại." xuất hiện lại                                 | Nó **không được phép** tồn tại nữa. Nếu thấy, đó là một nhánh lỗi chưa được phân loại — mở `getApiError` trong `apiClient.ts` và thêm nhánh, đừng thêm một câu chung thứ hai                                                                                                                   |
| Tải file lên thất bại, nhưng log `[api]` chỉ thấy `POST /datasets/uploads 201`               | MinIO không chạy. Backend chỉ **ký URL** — trình duyệt mới là bên PUT file, nên lỗi không lọt vào log backend. `npm run infra:up`, hoặc kiểm bằng `docker ps \| grep bi-minio`                                                                                                                 |
| `/health/ready` trả 503                                                                      | Container chưa chạy hoặc sai password. `docker compose ps`                                                                                                                                                                                                                                     |
| Bấm "Nạp vào kho phân tích" báo _Chưa kết nối được tới kho phân tích_                        | ClickHouse không chạy. `npm run infra:up`, kiểm bằng `docker ps \| grep bi-clickhouse`. Thông báo cố ý nói thẳng lệnh cần chạy thay vì "lỗi không xác định"                                                                                                                                    |
| Trạng thái nạp kẹt ở **Đang nạp** mãi không đổi                                              | Backend đã restart giữa chừng (hay gặp: `tsx watch` khi bạn lưu file). Lần boot sau tự đánh `failed` kèm lý do — bấm **Nạp lại**                                                                                                                                                               |
| ClickHouse báo `Directory for table data already exists`                                     | Thiếu `SYNC` sau `DROP TABLE`. Database engine `Atomic` hoãn xoá thật 480 giây, nên nạp lại trong vòng 8 phút sẽ đâm vào thư mục cũ. Mọi câu `DROP` trong `loadDataset.ts` đều có `SYNC`                                                                                                       |
| Cube báo `ECONNREFUSED` tới ClickHouse                                                       | Mount cả thư mục `config.d` dạng `:ro` chặn image ghi `docker_related_config.xml`, ClickHouse chỉ nghe `127.0.0.1`. Compose đã mount từng file — đừng đổi lại                                                                                                                                  |
| Explorer báo _Đồng hồ … lệch nhau quá 60 giây_ — **mọi** truy vấn hỏng, kể cả trong một bảng | Đồng hồ máy thật lệch đồng hồ container. Token Express ký cho Cube sống 60s nên nó "hết hạn" ngay khi tới nơi. So bằng `date -u` và `docker exec bi-cube date -u`; Windows hay chậm giờ (`w32tm /query /status` báo `Local CMOS Clock`) — mở PowerShell **quyền quản trị** rồi `w32tm /resync` |
| Kafka client trên host timeout                                                               | Phải dùng `localhost:29092` (listener `PLAINTEXT_HOST`), không phải 9092                                                                                                                                                                                                                       |
| `port is already allocated` khi `docker compose up`                                          | Máy đã có service giữ cổng đó (hay gặp: Redis/Memurai giữ 6379). Xem [docs/ports.md](docs/ports.md)                                                                                                                                                                                            |
| `Duplicate column name …` / `Table … already exists` lúc backend khởi động                   | Migration bị hai tiến trình chạy chồng, hoặc bị giết giữa chừng. Runner nay tự chặn và tự nói ra cách gỡ — xem mục _Migration nửa vời_ bên dưới                                                                                                                                                |
| `EADDRINUSE :::4000`                                                                         | Còn tiến trình backend cũ chưa chết hẳn. `npm run ports:free` — xem mục _Cổng bị chiếm_ bên dưới                                                                                                                                                                                               |
| `docker: daemon is not running`                                                              | Mở Docker Desktop rồi chạy lại                                                                                                                                                                                                                                                                 |
| Đăng nhập trên web trả 404                                                                   | `VITE_API_BASE_URL` trong `frontend/.env` phải là `/api`, không phải `/api/v1` — router xác thực mount ở `/api/auth`. Sửa xong phải khởi động lại Vite, biến `VITE_*` chỉ đọc lúc boot                                                                                                         |
| Mở `localhost:5173/health` ra JSON chứ không ra giao diện                                    | Đúng như thiết kế: Vite proxy `/health` sang Express. Trang kiểm tra kết nối nằm ở `/system-health`                                                                                                                                                                                            |
| Nhập sai mật khẩu mà bị đá về `/login`, không thấy thông báo lỗi                             | Interceptor 401 đang xử lý cả `/auth/login`. Endpoint đó phải nằm trong `SESSION_ENDPOINTS` của `apiClient.ts`                                                                                                                                                                                 |
| Mỗi lần F5 thấy trang login nháy lên rồi biến mất                                            | Thiếu trạng thái `loading` — `ProtectedRoute` phải chờ `GET /me` trả lời rồi mới kết luận                                                                                                                                                                                                      |
| Tab Network hiện **hai** request `GET /me`                                                   | `StrictMode` cố tình chạy effect hai lần ở dev. Vô hại, bản build không có                                                                                                                                                                                                                     |
| Đăng nhập sai 10 lần rồi bị 429                                                              | Bộ đếm chống dò mật khẩu. Xoá bằng `docker exec bi-redis redis-cli -a redispassword --scan --pattern 'login:fail:*'` rồi `DEL`, hoặc chờ 15 phút                                                                                                                                               |

### Câu "Có lỗi không xác định" đã bị xoá sổ

Câu **"Có lỗi không xác định. Vui lòng thử lại."** từng xuất hiện _thỉnh thoảng_
ở bất kỳ màn hình nào, và không ai lần ra nguồn vì bản thân câu chữ không nhắc
tới mạng, máy chủ hay quyền — nó không dẫn tới bất kỳ hướng nào để đi tìm.

**Nguyên nhân thật**, đo được chứ không phải suy đoán: khi backend chưa chạy
hoặc **đang khởi động lại** — việc `tsx watch` làm sau MỖI lần lưu file —
http-proxy của Vite không nối được và tự trả lời thay:

```
HTTP/1.1 500 Internal Server Error
Content-Type: text/plain
(thân RỖNG)
```

Với axios đó là một phản hồi hợp lệ. Nên `getApiError` đi vào nhánh "có
response", tìm `message` không thấy, rồi rơi vào câu chung. Nó _thỉnh thoảng_
vì nó chỉ trúng những request bay đúng vào khe một hai giây ấy — đo trên máy:
khoảng 0,75 giây và 5 request mỗi lần restart.

Sửa ở **hai tầng**, và cần cả hai:

| Tầng      | File                                 | Làm gì                                                                                                                       |
| --------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Proxy dev | `frontend/vite.config.ts`            | Bắt sự kiện `error` của http-proxy, trả **503 + JSON đúng khuôn** kèm câu hướng dẫn chạy `npm run dev`                       |
| Đọc lỗi   | `frontend/src/services/apiClient.ts` | `getApiError` **phân loại hết**: huỷ · không phải lỗi mạng · quá hạn chờ · mất mạng · thân đúng khuôn · suy từ mã trạng thái |

⚠️ Tầng thứ hai mới là tầng bắt buộc. Production **không có** proxy của Vite —
ở đó nginx trả HTML, gateway trả khuôn của riêng nó, và chỉ có mã trạng thái là
còn đáng tin. Sửa mỗi `vite.config.ts` là sửa một chỗ dev nhìn thấy và để
nguyên chỗ người dùng thật nhìn thấy.

Hai điểm trong `getApiError` đáng nhớ:

- **`isCancel` phải đứng trước `isAxiosError`.** `CanceledError` cũng là một
  `AxiosError`, nên đảo thứ tự là một thao tác người dùng tự huỷ sẽ hiện ra
  "không kết nối được máy chủ".
- **Lỗi không phải AxiosError được `console.error`.** Đó là bug của chính
  frontend (một `TypeError` trong `queryFn`). Bản trước nuốt nó vào câu chung,
  nên loại bug này biến mất không dấu vết.

Mọi câu suy từ mã trạng thái đều **kèm con số**. Đó là khác biệt thật so với
câu chung cũ: `502` chỉ về tầng trung gian, `500` chỉ vào backend, `403` chỉ về
quyền — ba hướng sửa khác nhau mà một câu không có số thì trông y hệt nhau.

`frontend/tests/getApiError.test.ts` khoá lại cả chín nhánh, trong đó có một ca
tái hiện đúng phản hồi `500 text/plain` rỗng. Ca cuối cùng quét mọi hình dạng
lỗi và khẳng định **không nhánh nào** còn trả về chữ "không xác định".

**Còn lại có chủ đích:** mutation vẫn `retry: false`. Một request bị ngắt giữa
chừng _có thể_ đã kịp ghi vào database trước khi tiến trình chết, nên tự chạy
lại một lệnh tạo là chấp nhận rủi ro tạo hai bản ghi. Query thì có `retry` sẵn
và thường tự vượt qua khe restart mà không hiện lỗi nào.

---

### Migration nửa vời (`Duplicate column name …`)

Triệu chứng: backend không lên, và lỗi duy nhất trên màn hình là một câu của
MySQL kiểu `Duplicate column name 'canvas'` — cột **đã có** trong schema nhưng
`schema_migrations` thì trống chỗ đó, nên mọi lần chạy sau đều đâm vào đúng nó.

Hai đường dẫn tới trạng thái đó, và bản đầu của runner không chặn đường nào:

1. **Hai tiến trình cùng migrate.** `tsx watch` khởi động lại backend trong lúc
   bản cũ đang chạy migration, hoặc `npm run migrate` gõ tay song song với dev
   server. Cả hai đọc bảng ghi nhận, cả hai thấy migration 34 chưa có, cả hai
   chạy `ALTER TABLE`. Người thua nhận lỗi trùng — và vì lỗi nổ **trước** câu
   `INSERT`, không ai ghi nhận gì cả.
2. **Bị giết giữa chừng** một migration nhiều câu lệnh.

Đã bịt, mỗi đường một chốt:

| Chốt                                                       | Chặn đường nào                                |
| ---------------------------------------------------------- | --------------------------------------------- |
| `GET_LOCK('bi_platform:migrate:<database>', 60)`           | (1) — mỗi lúc chỉ một tiến trình migrate được |
| dòng ghi nhận INSERT **trước**, đóng `finished_at` **sau** | (2) — lần chạy kế biết ngay là dở dang        |

Khoá dùng `GET_LOCK` chứ không phải một dòng trong bảng: khoá bằng dòng nghe
đơn giản hơn cho tới lúc tiến trình giữ khoá bị giết — dòng đó nằm lại vĩnh
viễn và không ai migrate được nữa, trừ khi tự viết thêm phần dò khoá chết bằng
timestamp (tức là tự chọn một ngưỡng hết hạn, tức là chọn sai). `GET_LOCK` gắn
với **phiên kết nối**: tiến trình chết là MySQL tự nhả. Đúng cái tình huống đã
gây ra lỗi.

Tên khoá kèm `DATABASE()` vì phạm vi của `GET_LOCK` là **toàn máy chủ** — một
tên cố định sẽ bắt `bi_platform` và `bi_platform_test` chờ nhau, mà dev server
và bộ test tích hợp chạy cùng lúc là chuyện thường.

Runner **không tự chữa** một migration dở dang: nó không biết câu lệnh dang dở
đã kịp làm gì, và đoán sai thì hỏng theo cách khó gỡ hơn hẳn. Nhưng nó biết đã
xong mấy câu và còn câu nào, nên nó nói ra đủ để xử trong một phút:

```
[migrate] migration 34 (reports_canvas) đang DỞ DANG — lần chạy trước dừng giữa chừng.
Đã chạy xong 0/1 câu lệnh, nên schema đang ở trạng thái nửa vời và
runner không chạy tiếp (chạy tiếp trên schema sai còn khó gỡ hơn).

Câu lệnh CÓ THỂ còn thiếu:
  [1] ALTER TABLE reports ADD COLUMN canvas JSON NULL AFTER config

Kiểm tra schema thật rồi chọn một trong hai:
  a) đã đủ / chạy tay nốt phần thiếu  ->  UPDATE schema_migrations SET finished_at = NOW(3), done_statements = 1 WHERE id = 30;
  b) hoàn tác phần đã chạy            ->  DELETE FROM schema_migrations WHERE id = 30;
```

Một ngoại lệ có chủ ý: nếu **câu đầu tiên** hỏng thì dòng chờ bị xoá luôn và
lần sau thử lại sạch sẽ. MySQL 8 có atomic DDL — một câu lệnh hoặc xong hẳn
hoặc quay lui hẳn — nên câu đầu hỏng nghĩa là schema chưa bị đụng gì, và một lỗi
nhất thời không đáng biến thành "phải vào sửa tay database".

Bảng `schema_migrations` được nâng cấp **tại chỗ** (thêm `finished_at` và
`done_statements`, backfill mọi dòng cũ thành "đã xong"). Nó không thể là một
migration bình thường: chính nó là thứ quyết định migration nào đã chạy, nên nó
phải đúng hình dạng trước khi đọc được dòng đầu tiên.

### Cổng bị chiếm (`EADDRINUSE`)

`npm run dev` đã **tự dọn** cổng 4000 và 5173 trước khi khởi động, nên lỗi này
gần như không còn gặp. Dọn tay khi cần:

```bash
npm run ports:free
```

**Vì sao nó hay xảy ra trên Windows.** `npm run dev` dựng một cây bốn tầng —
`concurrently → npm → tsx watch → node` — mà tầng cuối mới là tầng mở cổng.
Windows không có tín hiệu POSIX, nên `child.kill()` mà `concurrently --kill-others`
dùng thực chất là `TerminateProcess`: nó chỉ hạ đúng tiến trình được trỏ tới, con
cháu không nhận được gì. Đóng terminal hay bấm Stop của IDE sẽ giết ba tầng trên
và để tầng dưới cùng sống sót, vẫn ôm cổng 4000.

**Vì sao "giết theo cổng" là chưa đủ.** `tsx watch` KHÔNG nghe cổng nào — nó là
tầng **giám sát**, con nó chết thì nó đẻ con mới. Nên một bản trước của script
chỉ dọn theo cổng đã tạo ra vòng lặp này:

1. Giết `node src/index.ts` (kẻ đang giữ cổng 4000) — script in "đã giải phóng".
2. Khoảng 200ms sau, `tsx watch` đẻ lại. Cổng 4000 bị chiếm lần nữa.
3. Backend mới đâm vào `EADDRINUSE` rồi chết.
4. `concurrently -k` hạ luôn tiến trình web → **Vite tắt theo**.

Triệu chứng nhìn thấy lại chẳng liên quan gì tới backend: mở `localhost:5173`
ra `ERR_CONNECTION_REFUSED`, trong khi cổng 4000 vẫn trả lời bình thường. Vì
vậy script chạy **hai bước, đúng thứ tự này**: hạ tầng giám sát trước, tầng
nghe cổng sau.

Ba lớp xử lý, mỗi lớp lo một tình huống khác nhau:

| Lớp                                                | Ở đâu                  | Cứu được gì                                                                                                                               |
| -------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Bắt `SIGINT`/`SIGTERM`/`SIGHUP`/`SIGBREAK`         | `backend/src/index.ts` | Tiến trình **nhận được** tín hiệu thì trả cổng tử tế                                                                                      |
| `predev` gọi `scripts/free-ports.mjs --reap-stale` | `package.json` (gốc)   | Tiến trình **mồ côi** từ lần chạy trước, kể cả tầng giám sát không nghe cổng — không sửa được từ bên trong một tiến trình đã mất liên lạc |
| Bắt `EADDRINUSE` khi `listen`                      | `backend/src/index.ts` | Cổng bị thứ khác chiếm: in một câu chỉ rõ việc cần làm thay vì 25 dòng stack trace                                                        |

Script giết đúng hai nhóm, không nhóm nào khác:

| Nhóm           | Điều kiện                                                                    | Bật khi nào                  |
| -------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| Tầng giám sát  | Dòng lệnh trỏ vào `node_modules` của **chính repo này**                      | Chỉ khi có cờ `--reap-stale` |
| Tầng nghe cổng | Đang nghe đúng cổng truyền vào **và** tên nằm trong `node`/`npm`/`tsx`/`bun` | Luôn luôn                    |

⚠️ Cờ `--reap-stale` **chỉ** được truyền ở `predev` của **gốc**, nơi npm bảo
đảm chạy xong trước khi `dev` bắt đầu — tức là trước khi tồn tại tiến trình anh
em nào. `backend/package.json` có `predev` riêng chạy giữa lúc Vite đã lên; quét
toàn repo ở đó sẽ giết chính những tiến trình vừa khởi động, và `concurrently -k`
hạ nốt phần còn lại. Đó không phải giả thuyết — nó đã xảy ra, và sập trong hai
giây. Đừng thêm cờ này vào `predev` của workspace.

Hệ quả cần biết: gõ tay `npm run ports:free` trong lúc `npm run dev` đang chạy
sẽ **tắt** nó. Đó đúng là ý định của người gõ lệnh đó.

Cổng bị một ứng dụng khác chiếm thì script cảnh báo rồi dừng — dọn hộ quá tay
còn tệ hơn lỗi ban đầu:

```
[ports] cổng 3310 đang bị "com.docker.backend.exe" (PID 21912) chiếm
        — KHÔNG phải tiến trình của dự án này, nên bỏ qua.
```
