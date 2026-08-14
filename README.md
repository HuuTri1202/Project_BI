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
| Mô hình dữ liệu (Cube schema) / phân tích tự phục vụ / biểu đồ                            | ⏳ chưa làm                       |

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

- `infra:up` kiểm tra Docker → khởi động **MySQL + Redis + MinIO** → chờ tới khi
  **thật sự** healthy (không chỉ "đã start") → in thông tin kết nối. Lần đầu mất
  khoảng **1–2 phút** vì MySQL phải khởi tạo data directory.
  MinIO nằm trong nhóm lõi vì mục §7 tải file lên cần nó: trình duyệt PUT file
  **thẳng** lên MinIO bằng URL ký sẵn, nên MinIO tắt thì backend vẫn trả `201`
  cho bước ký URL và log sạch bong, còn người dùng nhận "Có lỗi không xác định".
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
| `npm run infra:up`      | MySQL, Redis           | **luôn luôn** — đăng ký, đăng nhập, quản trị user, mọi metadata |
| `npm run infra:up:data` | MinIO, ClickHouse      | **nạp dữ liệu**: upload CSV, presigned URL, bảng `raw_*`        |
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

## Sự cố thường gặp

| Triệu chứng                                                      | Nguyên nhân & cách xử lý                                                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$'\r': command not found` khi chạy `.sh`                        | File bị CRLF. `git rm --cached -r . && git reset --hard`                                                                                                                               |
| Backend thoát ngay, in `[env] Cấu hình môi trường không hợp lệ`  | `.env` thiếu biến mà một nhánh vừa merge thêm vào. Chạy `npm run setup` — nó bổ sung biến mới và **không** đụng giá trị đang có                                                         |
| Đăng nhập/đăng ký báo "Có lỗi không xác định. Vui lòng thử lại." | Backend không chạy nên request không tới đâu cả. Xem log terminal `[api]`; hay gặp nhất là dòng `[env] Cấu hình môi trường không hợp lệ` ở trên                                        |
| Tải file lên thất bại, nhưng log `[api]` chỉ thấy `POST /datasets/uploads 201` | MinIO không chạy. Backend chỉ **ký URL** — trình duyệt mới là bên PUT file, nên lỗi không lọt vào log backend. `npm run infra:up`, hoặc kiểm bằng `docker ps \| grep bi-minio` |
| `/health/ready` trả 503                                          | Container chưa chạy hoặc sai password. `docker compose ps`                                                                                                                             |
| Cube báo `ECONNREFUSED` tới ClickHouse                           | Mount cả thư mục `config.d` dạng `:ro` chặn image ghi `docker_related_config.xml`, ClickHouse chỉ nghe `127.0.0.1`. Compose đã mount từng file — đừng đổi lại                          |
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
