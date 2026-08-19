# BI Platform

Nền tảng **Self-Service BI & Data Analytics** — người dùng nghiệp vụ tự tải dữ
liệu lên, định nghĩa mô hình ngữ nghĩa, kéo-thả ra biểu đồ và chia sẻ dashboard
mà **không cần viết SQL**.

Đồ án tốt nghiệp, tài liệu kiến trúc theo chuẩn **arc42**.

---

## Trạng thái hiện tại

| Phần                                                                                      | Trạng thái                        |
| ----------------------------------------------------------------------------------------- | --------------------------------- |
| Hạ tầng dev — 8 container (MySQL, Redis, MinIO, ClickHouse, Cube.js, Kafka, Connect, dbt) | ✅ chạy được                      |
| Backend (Express) + Frontend (React + Vite + Tailwind v4)                                 | ✅ chạy được                      |
| **Xác thực** — đăng ký, đăng nhập, JWT, đổi mật khẩu                                      | ✅ xong — xem mục _Xác thực_      |
| **Console vận hành hệ thống** (`/admin`) — nhìn xuyên mọi tổ chức                         | ✅ xong                           |
| **Khu người dùng** — trang chủ, project, workspace, thành viên, hồ sơ                     | ✅ xong                           |
| **Phân quyền Casbin** — 8 tài nguyên × 4 hành động, policy trong database                 | ✅ xong                           |
| **Kết nối CSDL & Kho dữ liệu** (§8) — MySQL, ClickHouse (SSL/TLS, xem trước dữ liệu)      | ✅ xong                           |
| **Nạp dữ liệu vào ClickHouse** (§9) — bảng `raw_*`, nạp nền, nạp lại nguyên tử            | ✅ xong                           |
| **Mô hình dữ liệu** (§10) — Cube schema, quan hệ, thước đo, Explorer                      | ✅ xong — xem mục _Mô hình dữ liệu_ |
| Phân tích tự phục vụ / trình dựng biểu đồ                                                 | ⏳ chưa làm                       |

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

| Lệnh                    | Thêm gì                | Bật khi bắt đầu làm                                             |
| ----------------------- | ---------------------- | --------------------------------------------------------------- |
| `npm run infra:up`      | MySQL, Redis, MinIO, ClickHouse | **luôn luôn** — đăng nhập, tải file, nạp vào kho phân tích |
| `npm run infra:up:data` | (đã nằm trong lõi)     | không còn thêm gì so với `infra:up`                             |
| `npm run infra:up:bi`   | Cube.js (+ ClickHouse) | **tầng ngữ nghĩa**: DataModel, Explore kéo-thả, chart           |
| `npm run infra:up:all`  | + Kafka, Connect, dbt  | **dbt / CDC realtime**, hoặc demo toàn hệ thống                 |

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

| Vai trò              | Email                     | Mật khẩu      |
| -------------------- | ------------------------- | ------------- |
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

| Điểm | Cách làm |
|---|---|
| Để trống | **Hợp lệ** — nghĩa là "mọi database". `listTables` quét cả máy chủ trừ schema hệ thống |
| Không cần migration | `database_name` là `VARCHAR(255) NOT NULL`; chuỗi rỗng vẫn hợp lệ. Cố ý **không** dùng `NULL`: hai cách viết cho cùng một ý nghĩa là một chỗ sẽ có người quên kiểm |
| Nút, không tự nạp | Mỗi lần liệt kê là một kết nối THẬT tới máy khách hàng. Nạp theo phím gõ là hàng chục kết nối cho một lần điền form, và `connectionProbeLimit` sẽ chặn đúng lúc gõ xong |
| Vẫn giữ "Nhập tay" | Tài khoản bị khoá chặt có thể `SELECT` được trên đúng một database mà không có quyền liệt kê. Bỏ hẳn là khoá đúng những khách hàng cẩn thận nhất ra ngoài |
| Giá trị lạ vẫn hiện | Kết nối cũ trỏ tới database đã bị xoá thì nó xuất hiện kèm `(không còn thấy)`, không bị lặng lẽ đổi sang cái khác |

Hai endpoint, cùng gác `connection:modify` + `connectionProbeLimit` như
`/connections/test` — chúng mở kết nối ra ngoài, nên không được gác bằng quyền
đọc, kẻo thành công cụ quét cổng cho bất kỳ ai xem được danh sách kết nối:

| Endpoint | Dùng khi |
|---|---|
| `POST /v1/connections/databases` | Tạo mới — thông tin chưa lưu, có mật khẩu trong body |
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
tải file vẫn báo thành công (vì nó *đã* thành công), còn lần nạp hiện `failed`
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
  như MySQL: `` a`b `` → `` `a\`b` ``. Đã kiểm bằng `CREATE TABLE` thật rồi đọc
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

| Tab | Đọc từ | Trả lời |
|---|---|---|
| Dữ liệu | **Nguồn** — `SELECT … LIMIT` sang CSDL khách hàng, hoặc mẫu 1.000 dòng của file | "dữ liệu gốc trông thế nào" |
| Cấu trúc | **Kho** — `system.columns` của ClickHouse | "cột này nằm trong kho dưới dạng gì" |
| Kho phân tích | **Kho** — bảng `raw_*` | "thứ đã nạp trông thế nào" |

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
- **`dataset_rows` vẫn giữ 1.000 dòng mẫu** cho tab Xem trước — nay là *mẫu*,
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

| | Kết quả |
|---|---|
| `parseFile` | **1,1 giây**, giữ đúng 1.000 dòng |
| Cache Redis | **~0 MB** (trước: ~290 MB ước tính cho 500k) |
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

| | |
|---|---|
| `rowCount` | giờ là số dòng **thật trong file**, không phải số dòng đã lưu. Đi cặp với `loadedRowCount` (số dòng truy vấn được) — trước đây hai số luôn bằng nhau nên một là đủ |
| Báo cáo chưa nạp | trả **409 `DatasetNotLoaded`**, và trang Report hiện "Đang nạp…" rồi tự hỏi lại mỗi 3 giây thay vì một hộp đỏ |

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

| Tab | Đọc từ | Trả lời câu hỏi |
|---|---|---|
| Dữ liệu | **nguồn** (CSDL khách hàng / `dataset_rows`) | dữ liệu gốc trông thế nào |
| Kho phân tích → Dữ liệu trong kho | **đích** (bảng `raw_*`) | thứ *nằm trong kho* trông thế nào |

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

| Nguồn | Tải/đồng bộ lại sau khi xoá | Hệ quả |
|---|---|---|
| `connection` | trúng `uq_datasets_source` → hồi sinh **đúng id cũ** | bảng cũ bị ghi đè, **tự lành** |
| `file` | ba cột khoá đều `NULL`, mà MySQL không coi `NULL` là trùng → **id mới** | bảng cũ mồ côi **vĩnh viễn**, mỗi vòng thêm một bản sao |

Hai lớp, và lớp thứ hai không phải thừa:

1. **Xoá ngay** trong `deleteDataset` — đường nhanh. Cố ý *không* ném ra nếu
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

Bốn tab, đều làm thật: **Schemas** (gắn nhãn cột), **Relationship** (sơ đồ nối
bảng), **Measures** (thước đo), **Explorer** (hỏi thử). Năm tab _sắp có_ trước
đây đã bỏ — chín tab tràn màn hình và đẩy bốn tab dùng được vào một thanh cuộn
ngang, một cái giá quá đắt cho việc phác lộ trình.

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

| | |
|---|---|
| Điền workspace cho dòng đang trống | workspace cũ nhất của tổ chức — cái tạo lúc đăng ký |
| `workspace_id` → `NOT NULL` | ràng buộc nằm ở **database**, không phải ở một quy ước code phải nhớ |
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
2. `explain()` phía Express thấy 5xx → dịch thành *"Tầng ngữ nghĩa không trả lời
   được truy vấn này"*.
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

## Sự cố thường gặp

| Triệu chứng                                                      | Nguyên nhân & cách xử lý                                                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$'\r': command not found` khi chạy `.sh`                        | File bị CRLF. `git rm --cached -r . && git reset --hard`                                                                                                                               |
| Backend thoát ngay, in `[env] Cấu hình môi trường không hợp lệ`  | `.env` thiếu biến mà một nhánh vừa merge thêm vào. Chạy `npm run setup` — nó bổ sung biến mới và **không** đụng giá trị đang có                                                         |
| Đăng nhập/đăng ký báo "Có lỗi không xác định. Vui lòng thử lại." | Backend không chạy nên request không tới đâu cả. Xem log terminal `[api]`; hay gặp nhất là dòng `[env] Cấu hình môi trường không hợp lệ` ở trên                                        |
| Tải file lên thất bại, nhưng log `[api]` chỉ thấy `POST /datasets/uploads 201` | MinIO không chạy. Backend chỉ **ký URL** — trình duyệt mới là bên PUT file, nên lỗi không lọt vào log backend. `npm run infra:up`, hoặc kiểm bằng `docker ps \| grep bi-minio` |
| `/health/ready` trả 503                                          | Container chưa chạy hoặc sai password. `docker compose ps`                                                                                                                             |
| Bấm "Nạp vào kho phân tích" báo *Chưa kết nối được tới kho phân tích* | ClickHouse không chạy. `npm run infra:up`, kiểm bằng `docker ps \| grep bi-clickhouse`. Thông báo cố ý nói thẳng lệnh cần chạy thay vì "lỗi không xác định"                        |
| Trạng thái nạp kẹt ở **Đang nạp** mãi không đổi                  | Backend đã restart giữa chừng (hay gặp: `tsx watch` khi bạn lưu file). Lần boot sau tự đánh `failed` kèm lý do — bấm **Nạp lại**                                                       |
| ClickHouse báo `Directory for table data already exists`         | Thiếu `SYNC` sau `DROP TABLE`. Database engine `Atomic` hoãn xoá thật 480 giây, nên nạp lại trong vòng 8 phút sẽ đâm vào thư mục cũ. Mọi câu `DROP` trong `loadDataset.ts` đều có `SYNC` |
| Cube báo `ECONNREFUSED` tới ClickHouse                           | Mount cả thư mục `config.d` dạng `:ro` chặn image ghi `docker_related_config.xml`, ClickHouse chỉ nghe `127.0.0.1`. Compose đã mount từng file — đừng đổi lại                          |
| Explorer báo *Đồng hồ … lệch nhau quá 60 giây* — **mọi** truy vấn hỏng, kể cả trong một bảng | Đồng hồ máy thật lệch đồng hồ container. Token Express ký cho Cube sống 60s nên nó "hết hạn" ngay khi tới nơi. So bằng `date -u` và `docker exec bi-cube date -u`; Windows hay chậm giờ (`w32tm /query /status` báo `Local CMOS Clock`) — mở PowerShell **quyền quản trị** rồi `w32tm /resync` |
| Kafka client trên host timeout                                   | Phải dùng `localhost:29092` (listener `PLAINTEXT_HOST`), không phải 9092                                                                                                               |
| `port is already allocated` khi `docker compose up`              | Máy đã có service giữ cổng đó (hay gặp: Redis/Memurai giữ 6379). Xem [docs/ports.md](docs/ports.md)                                                                                    |
| `EADDRINUSE :::4000`                                             | Còn tiến trình backend cũ chưa chết hẳn. `npm run ports:free` — xem mục _Cổng bị chiếm_ bên dưới                                                                                       |
| `docker: daemon is not running`                                  | Mở Docker Desktop rồi chạy lại                                                                                                                                                         |
| Đăng nhập trên web trả 404                                       | `VITE_API_BASE_URL` trong `frontend/.env` phải là `/api`, không phải `/api/v1` — router xác thực mount ở `/api/auth`. Sửa xong phải khởi động lại Vite, biến `VITE_*` chỉ đọc lúc boot |
| Mở `localhost:5173/health` ra JSON chứ không ra giao diện        | Đúng như thiết kế: Vite proxy `/health` sang Express. Trang kiểm tra kết nối nằm ở `/system-health`                                                                                    |
| Nhập sai mật khẩu mà bị đá về `/login`, không thấy thông báo lỗi | Interceptor 401 đang xử lý cả `/auth/login`. Endpoint đó phải nằm trong `SESSION_ENDPOINTS` của `apiClient.ts`                                                                         |
| Mỗi lần F5 thấy trang login nháy lên rồi biến mất                | Thiếu trạng thái `loading` — `ProtectedRoute` phải chờ `GET /me` trả lời rồi mới kết luận                                                                                              |
| Tab Network hiện **hai** request `GET /me`                       | `StrictMode` cố tình chạy effect hai lần ở dev. Vô hại, bản build không có                                                                                                             |
| Đăng nhập sai 10 lần rồi bị 429                                  | Bộ đếm chống dò mật khẩu. Xoá bằng `docker exec bi-redis redis-cli -a redispassword --scan --pattern 'login:fail:*'` rồi `DEL`, hoặc chờ 15 phút                                       |

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

Ba lớp xử lý, mỗi lớp lo một tình huống khác nhau:

| Lớp | Ở đâu | Cứu được gì |
| --- | --- | --- |
| Bắt `SIGINT`/`SIGTERM`/`SIGHUP`/`SIGBREAK` | `backend/src/index.ts` | Tiến trình **nhận được** tín hiệu thì trả cổng tử tế |
| `predev` gọi `scripts/free-ports.mjs` | `package.json` | Tiến trình **mồ côi** từ lần chạy trước — không sửa được từ bên trong một tiến trình đã mất liên lạc |
| Bắt `EADDRINUSE` khi `listen` | `backend/src/index.ts` | Cổng bị thứ khác chiếm: in một câu chỉ rõ việc cần làm thay vì 25 dòng stack trace |

Script chỉ giết tiến trình **đang nghe đúng cổng được truyền vào** và **có tên
nằm trong danh sách cho phép** (`node`, `npm`, `tsx`, `bun`). Cổng bị một ứng
dụng khác chiếm thì nó cảnh báo rồi dừng — dọn hộ quá tay còn tệ hơn lỗi ban đầu:

```
[ports] cổng 3310 đang bị "com.docker.backend.exe" (PID 21912) chiếm
        — KHÔNG phải tiến trình của dự án này, nên bỏ qua.
```
