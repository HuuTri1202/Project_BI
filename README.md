# BI Platform

Nền tảng **Self-Service BI & Data Analytics** — người dùng nghiệp vụ tự tải dữ
liệu lên, định nghĩa mô hình ngữ nghĩa, kéo-thả ra biểu đồ và chia sẻ dashboard
mà **không cần viết SQL**.

Đồ án tốt nghiệp, tài liệu kiến trúc theo chuẩn **arc42**.

---

## Trạng thái hiện tại

| Phần | Trạng thái |
| --- | --- |
| Hạ tầng dev (MySQL, Redis, Keycloak) | ✅ chạy được |
| Backend skeleton (Express + health check thật) | ✅ chạy được |
| Frontend skeleton (React + Vite) | ✅ chạy được |
| Xác thực / phân quyền / ingest / Cube / chart | ⏳ chưa làm |

Xem lộ trình đầy đủ và phân công theo tính năng trong tài liệu kế hoạch của nhóm.

---

## Yêu cầu máy

| Công cụ | Phiên bản | Ghi chú |
| --- | --- | --- |
| Node.js | ≥ 20 | Khuyến nghị 20 LTS hoặc 22 LTS |
| Docker Desktop | mới nhất | Phải đang **chạy**, không chỉ cài |
| Git | ≥ 2.40 | |
| Git Bash | (Windows) | Các script `.sh` là bash, không chạy được bằng CMD/PowerShell |

RAM tối thiểu **8 GB**, khuyến nghị **16 GB** (giai đoạn sau sẽ có tới 9 container).

---

## Khởi chạy lần đầu

```bash
git clone https://github.com/HuuTri1202/Project_BI.git
cd Project_BI
```

### 1. Hạ tầng (Docker)

```bash
cd infrastructure
cp .env.example .env      # script tự làm nếu quên
./start-dev.sh
```

Script sẽ: kiểm tra Docker → khởi động MySQL + Redis → chờ tới khi **thật sự**
healthy → tạo database cho Keycloak → khởi động Keycloak → xác nhận realm đã
import → in thông tin kết nối.

Lần đầu mất khoảng **2–4 phút** (MySQL khởi tạo + Keycloak dựng schema).

### 2. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

→ http://localhost:4000/health

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

→ http://localhost:5173 — trang này sẽ hiển thị JSON health của backend nếu cả
hai chạy đúng.

---

## Cấu trúc thư mục

```
bi-flatform/
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
│   ├── start-dev.sh          # khởi động toàn bộ môi trường dev
│   ├── reset-keycloak.sh     # import lại realm sau khi sửa file JSON
│   ├── keycloak/realms/      # cấu hình realm (roles, clients, users)
│   └── mysql/init/           # SQL chạy khi volume MySQL còn rỗng
└── docs/
    └── ports.md              # bản đồ cổng — đọc trước khi thêm service
```

---

## Cổng

Bảng đầy đủ ở [docs/ports.md](docs/ports.md). Những cổng đang dùng:

| Service | URL |
| --- | --- |
| Frontend | http://localhost:5173 |
| Backend | http://localhost:4000 |
| Keycloak admin | http://localhost:8081/admin |
| MySQL | `localhost:3310` |
| Redis | `localhost:6379` |

> MySQL dùng **3310** và Keycloak dùng **8081** để tránh đụng service cài sẵn
> trên máy. Đây là chủ ý, không phải nhầm lẫn.

---

## Tài khoản dev

Chỉ dùng ở local. Toàn bộ được định nghĩa trong
`infrastructure/keycloak/realms/bi-platform-realm.json`.

| Nơi đăng nhập | User | Mật khẩu | Vai trò |
| --- | --- | --- | --- |
| Keycloak admin console | `admin` | `admin123` | quản trị Keycloak |
| Ứng dụng | `bi.admin` | `Admin@123` | `bi-admin` |
| Ứng dụng | `bi.creator` | `Creator@123` | `bi-creator` |
| Ứng dụng | `bi.viewer` | `Viewer@123` | `bi-viewer` |

### ⚠️ Sửa file realm JSON thì phải reset Keycloak

Cờ `--import-realm` **chỉ chạy khi realm chưa tồn tại**. Sau lần khởi động đầu
tiên, mọi thay đổi trong file JSON đều bị bỏ qua **âm thầm** — không log, không
lỗi, chỉ là không có tác dụng.

```bash
cd infrastructure
./reset-keycloak.sh          # xoá DB keycloak rồi import lại
```

---

## Lệnh thường dùng

```bash
# --- backend / frontend (chạy trong thư mục tương ứng) ---
npm run dev            # dev server, tự reload
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run format         # Prettier ghi đè
npm run build          # build production
npm test               # Vitest (chỉ backend)

# --- hạ tầng (chạy trong infrastructure/) ---
./start-dev.sh              # khởi động tất cả
./start-dev.sh --recreate   # tạo lại container, giữ dữ liệu
./start-dev.sh --logs       # khởi động xong thì theo dõi log
./reset-keycloak.sh         # import lại realm Keycloak
docker compose ps           # trạng thái container
docker compose logs -f mysql
docker compose stop         # dừng, giữ dữ liệu
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
git switch -c feat/f2-keycloak-auth
# ... code ...
git push -u origin feat/f2-keycloak-auth
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
      │                      │                                 ▲
      │                      ├── Keycloak (OIDC, RS256 + JWKS) │
   Keycloak JS               ├── Casbin  (RBAC theo domain)    │
   (PKCE S256)               ├── Strapi  (metadata BI)         │
                             ├── MySQL   (metadata vận hành)   │
                             ├── Redis   (cache phân quyền)    │
                             └── S3/MinIO ──► dbt ─────────────┤
                                                               │
                             MySQL binlog ──► Debezium ──► Kafka
```

**Ranh giới cần nhớ:**

- **Cube.js không bao giờ lộ ra trình duyệt.** Mọi truy vấn phân tích đi qua
  `POST /api/v1/query`: Express kiểm quyền bằng Casbin, ký một JWT Cube ngắn hạn
  mang `securityContext`, rồi mới forward.
- **Strapi là nơi ghi metadata BI duy nhất.** Express chỉ gọi REST và cache đọc
  vào Redis; database `bi_platform` của Express chỉ chứa dữ liệu vận hành
  (ingest job, `casbin_rule`, audit log).
- **Backend không tự ký JWT.** Chỉ verify token do Keycloak ký bằng RS256 +
  JWKS. Vì vậy không có `JWT_SECRET` ở bất kỳ đâu.

---

## Sự cố thường gặp

| Triệu chứng | Nguyên nhân & cách xử lý |
| --- | --- |
| `$'\r': command not found` khi chạy `.sh` | File bị CRLF. `git rm --cached -r . && git reset --hard` |
| Backend thoát ngay, in `[env] Cấu hình môi trường không hợp lệ` | Thiếu biến trong `.env`. Đối chiếu với `.env.example` |
| `/health/ready` trả 503 | Container chưa chạy hoặc sai password. `docker compose ps` |
| Keycloak crash-loop | Chưa có database `keycloak`. Chạy `./start-dev.sh` (script tự tạo) |
| Sửa realm JSON nhưng không thấy đổi | `--import-realm` chỉ chạy một lần. Chạy `./reset-keycloak.sh` |
| `port is already allocated` khi `docker compose up` | Máy đã có service giữ cổng đó (hay gặp: Redis/Memurai giữ 6379). Xem [docs/ports.md](docs/ports.md) |
| `EADDRINUSE :::4000` | Còn tiến trình backend cũ. Windows: `Get-NetTCPConnection -LocalPort 4000 -State Listen` rồi `Stop-Process` |
| `docker: daemon is not running` | Mở Docker Desktop rồi chạy lại |
