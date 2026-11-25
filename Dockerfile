# =============================================================================
# Ảnh cho bản TRIỂN KHAI — một Dockerfile, hai đích.
#
#   --target api   Express đã build, chạy `node dist/index.js`
#   --target web   Caddy phục vụ `frontend/dist` + TLS + proxy sang api
#
# Dùng qua `infrastructure/docker-compose.prod.yml`, không gọi tay.
#
# ═══ Vì sao MỘT file cho cả hai ═════════════════════════════════════════════
#
# `npm ci` trong một monorepo workspaces phải thấy ĐỦ `package-lock.json` và mọi
# `package.json` con, nếu không npm dựng lại cây phụ thuộc khác với cây đã khoá.
# Tách hai Dockerfile là chép khối đó hai lần rồi để chúng lệch nhau.
#
# Hai đích cũng dùng CHUNG một lần `npm ci`: tầng `deps` được cache lại, nên lần
# build thứ hai (và mọi lần build sau khi chỉ sửa mã nguồn) không tải lại gì.
#
# ⚠️ CONTEXT phải là thư mục GỐC của repo, không phải `backend/`. `backend` phụ
# thuộc `@bi/shared` qua symlink của workspace, nên ảnh phải thấy cả `shared/`.
# =============================================================================

# --- Phiên bản Node khớp `engines` ở package.json gốc (>=20). Alpine được vì
# --- không gói nào cần biên dịch native: bcryptjs, mysql2, @clickhouse/client
# --- và casbin đều là JavaScript thuần.
FROM node:22-alpine AS deps
WORKDIR /app
# Chỉ chép MANIFEST trước, không chép mã nguồn: sửa một file .ts thì tầng này
# vẫn còn trong cache và `npm ci` không chạy lại.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci

# =============================================================================
# BUILD — dựng shared, backend, frontend trong cùng một tầng
# =============================================================================
FROM deps AS build
WORKDIR /app

# Biến VITE_* được NHÚNG vào bundle lúc build, không đọc được lúc chạy. Nên nếu
# cần đổi chúng thì phải build lại ảnh `web` — không phải restart container.
#
# `/api` là mặc định đúng khi Caddy phục vụ cả web lẫn API trên MỘT tên miền
# (xem Caddyfile). Đặt URL tuyệt đối chỉ khi tách hẳn hai tên miền, và khi đó
# `CORS_ORIGIN` của backend phải trỏ đúng tên miền của web.
ARG VITE_API_BASE_URL=/api
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

COPY shared/ shared/
COPY backend/ backend/
COPY frontend/ frontend/
COPY tsconfig*.json ./

# `build:shared` TRƯỚC: backend và frontend đều import `@bi/shared` ở dạng đã
# build (`dist/cjs`), không phải mã nguồn.
RUN npm run build:shared \
  && npm --workspace backend run build \
  && npm --workspace frontend run build

# =============================================================================
# PROD-DEPS — node_modules KHÔNG có devDependencies
# =============================================================================
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# `--omit=dev` bỏ typescript, eslint, vitest… Cây `node_modules` của workspace
# vẫn giữ symlink `@bi/shared` -> `../shared`, nên tầng runtime phải chép cả
# `shared/dist` vào, nếu không symlink trỏ vào chỗ trống.
RUN npm ci --omit=dev

# =============================================================================
# API — Express
# =============================================================================
FROM node:22-alpine AS api
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./package.json
# `shared/package.json` phải có mặt: symlink `node_modules/@bi/shared` trỏ vào
# thư mục này, và Node đọc `main` trong đó để tìm `dist/cjs/index.js`.
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist

# `node` chứ không `root`: image node tạo sẵn user này. Một tiến trình web chạy
# bằng root thì một lỗ RCE thành quyền cao nhất trong container.
USER node

# WORKDIR là `backend` vì `CUBE_SCHEMA_DIR` mặc định là đường dẫn TƯƠNG ĐỐI tính
# từ `process.cwd()` (xem config/env.ts). Bản triển khai nên khai tuyệt đối, và
# `docker-compose.prod.yml` làm đúng vậy — nhưng để cwd đúng thì mặc định cũng
# không trỏ ra ngoài ảnh.
WORKDIR /app/backend
EXPOSE 4000

# `node dist/index.js` trực tiếp, KHÔNG qua `npm start`: npm thêm một tiến trình
# cha không làm gì ngoài việc chặn SIGTERM lại. `index.ts` có xử lý shutdown
# đàng hoàng (đóng pool, dừng ba vòng lặp nền) và nó chỉ chạy nếu tín hiệu tới
# được đúng tiến trình Node.
CMD ["node", "dist/index.js"]

# =============================================================================
# WEB — Caddy phục vụ bản tĩnh
# =============================================================================
FROM caddy:2.10-alpine AS web
COPY --from=build /app/frontend/dist /srv
COPY infrastructure/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
