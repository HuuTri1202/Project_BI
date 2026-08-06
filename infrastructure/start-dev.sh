#!/usr/bin/env bash
#
# start-dev.sh - Khởi động môi trường dev cho BI Platform (MySQL + Redis)
#
# Cách dùng:
#   ./start-dev.sh            # khởi động và chờ services sẵn sàng
#   ./start-dev.sh --recreate # xoá container cũ rồi tạo lại (giữ nguyên dữ liệu)
#   ./start-dev.sh --logs     # khởi động xong thì theo dõi logs
#
set -euo pipefail

# Luôn chạy trong thư mục chứa script này, dù được gọi từ đâu
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- Màu cho output (tắt nếu không phải terminal, tránh rác khi pipe vào file) ---
if [ -t 1 ]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

info()  { echo "${BLUE}[i]${NC} $*"; }
ok()    { echo "${GREEN}[✓]${NC} $*"; }
warn()  { echo "${YELLOW}[!]${NC} $*"; }
error() { echo "${RED}[✗]${NC} $*" >&2; }

RECREATE=false
FOLLOW_LOGS=false
for arg in "$@"; do
  case "$arg" in
    --recreate) RECREATE=true ;;
    --logs)     FOLLOW_LOGS=true ;;
    -h|--help)  sed -n '2,10p' "$0"; exit 0 ;;
    *) error "Tham số không hợp lệ: $arg"; exit 1 ;;
  esac
done

# =============================================================================
# BƯỚC 1: Kiểm tra Docker
# =============================================================================
echo
echo "${BOLD}=== BI Platform - Dev Environment ===${NC}"
echo
info "Bước 1/5: Kiểm tra Docker..."

if ! command -v docker >/dev/null 2>&1; then
  error "Chưa cài Docker."
  echo "    Tải tại: https://www.docker.com/products/docker-desktop/"
  exit 1
fi

# Docker CLI có thể tồn tại nhưng daemon chưa chạy (Docker Desktop chưa mở)
if ! docker info >/dev/null 2>&1; then
  error "Docker đã cài nhưng daemon chưa chạy."
  echo "    Hãy mở Docker Desktop rồi chạy lại script này."
  exit 1
fi

# Docker Compose V2 (docker compose) hay V1 (docker-compose)?
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  error "Không tìm thấy Docker Compose."
  echo "    Cài Docker Desktop (đã kèm Compose V2) hoặc plugin docker-compose."
  exit 1
fi

ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?') - dùng lệnh '${DC}'"

# =============================================================================
# BƯỚC 2: Chuẩn bị .env rồi khởi động containers
# =============================================================================
echo
info "Bước 2/5: Khởi động containers..."

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  warn "Chưa có .env - đã tạo từ .env.example (nhớ đổi password trước khi deploy)."
fi

# Đọc .env để lấy port/password dùng cho phần kiểm tra và in URL bên dưới.
# 'set -a' làm mọi biến gán sau đó tự động được export.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

MYSQL_PORT="${MYSQL_PORT:-3310}"
REDIS_PORT="${REDIS_PORT:-6379}"
MYSQL_DATABASE="${MYSQL_DATABASE:-bi_platform}"
MYSQL_USER="${MYSQL_USER:-bi_user}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-bi_password}"
MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-rootpassword}"
REDIS_PASSWORD="${REDIS_PASSWORD:-redispassword}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-8081}"
KEYCLOAK_ADMIN="${KEYCLOAK_ADMIN:-admin}"
KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin123}"
KEYCLOAK_DB_NAME="${KEYCLOAK_DB_NAME:-keycloak}"
KEYCLOAK_DB_USER="${KEYCLOAK_DB_USER:-keycloak}"
KEYCLOAK_DB_PASSWORD="${KEYCLOAK_DB_PASSWORD:-keycloak_password}"
KEYCLOAK_REALM="bi-platform"

if [ "$RECREATE" = true ]; then
  warn "--recreate: xoá container cũ (volume dữ liệu vẫn giữ)."
  $DC down --remove-orphans
fi

# -d = detached: containers chạy nền, script tiếp tục chạy.
# Khởi động MySQL/Redis trước; Keycloak chỉ start sau khi đã chắc chắn có database
# của nó (nếu không Keycloak sẽ crash-loop).
$DC up -d mysql redis

ok "Đã gửi lệnh khởi động MySQL + Redis."

# =============================================================================
# BƯỚC 3: Chờ MySQL và Redis thực sự sẵn sàng
# =============================================================================
echo
info "Bước 3/5: Chờ services sẵn sàng (MySQL khởi tạo lần đầu có thể mất ~30-60s)..."

# Đọc trạng thái healthcheck đã khai báo trong docker-compose.yml.
# Trả về: healthy | unhealthy | starting | none (container chưa tồn tại)
container_health() {
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo "none"
}

wait_for_health() {
  local name="$1" label="$2" timeout="${3:-120}" elapsed=0 status

  while [ "$elapsed" -lt "$timeout" ]; do
    status="$(container_health "$name")"
    case "$status" in
      healthy)
        printf '\r'
        ok "${label} sẵn sàng (${name})"
        return 0
        ;;
      unhealthy)
        printf '\r'
        error "${label} ở trạng thái unhealthy."
        echo "    Xem log: ${DC} logs ${name#bi-}"
        return 1
        ;;
      none)
        printf '\r'
        error "Không tìm thấy container ${name}."
        echo "    Xem trạng thái: ${DC} ps"
        return 1
        ;;
    esac
    printf '\r    %s: %s (%ss)   ' "$label" "$status" "$elapsed"
    sleep 2
    elapsed=$((elapsed + 2))
  done

  printf '\r'
  error "${label} quá thời gian chờ ${timeout}s."
  echo "    Xem log: ${DC} logs ${name#bi-}"
  return 1
}

FAILED=false
wait_for_health "bi-mysql" "MySQL" 180 || FAILED=true
wait_for_health "bi-redis" "Redis" 60  || FAILED=true

if [ "$FAILED" = true ]; then
  echo
  error "Có service chưa khởi động được. Trạng thái hiện tại:"
  $DC ps
  exit 1
fi

# Kiểm tra thêm bằng truy vấn thật, không chỉ dựa vào healthcheck:
# xác nhận database đã được tạo và Redis trả lời PONG.
if docker exec bi-mysql mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "USE \`$MYSQL_DATABASE\`;" >/dev/null 2>&1; then
  ok "Database '${MYSQL_DATABASE}' truy cập được bằng user '${MYSQL_USER}'"
else
  warn "MySQL đang chạy nhưng chưa truy cập được DB '${MYSQL_DATABASE}' với user '${MYSQL_USER}'."
  warn "Nếu vừa đổi password trong .env, cần xoá volume cũ: ${DC} down -v"
fi

if [ "$(docker exec bi-redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping 2>/dev/null)" = "PONG" ]; then
  ok "Redis trả lời PONG"
else
  warn "Redis đang chạy nhưng không phản hồi PING (kiểm tra REDIS_PASSWORD trong .env)."
fi

# --- Đảm bảo database của Keycloak tồn tại ---
# File mysql/init/*.sql chỉ chạy khi volume mysql_data còn rỗng. Nếu MySQL đã được
# tạo từ trước (volume cũ), database 'keycloak' sẽ không có -> tạo lại ở đây.
# Các lệnh đều idempotent nên chạy lại nhiều lần không sao.
info "Kiểm tra database cho Keycloak..."
if docker exec bi-mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "
      CREATE DATABASE IF NOT EXISTS \`${KEYCLOAK_DB_NAME}\`
        CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
      CREATE USER IF NOT EXISTS '${KEYCLOAK_DB_USER}'@'%' IDENTIFIED BY '${KEYCLOAK_DB_PASSWORD}';
      ALTER USER '${KEYCLOAK_DB_USER}'@'%' IDENTIFIED BY '${KEYCLOAK_DB_PASSWORD}';
      GRANT ALL PRIVILEGES ON \`${KEYCLOAK_DB_NAME}\`.* TO '${KEYCLOAK_DB_USER}'@'%';
      FLUSH PRIVILEGES;" >/dev/null 2>&1; then
  ok "Database '${KEYCLOAK_DB_NAME}' và user '${KEYCLOAK_DB_USER}' đã sẵn sàng"
else
  error "Không tạo được database cho Keycloak (kiểm tra MYSQL_ROOT_PASSWORD trong .env)."
  exit 1
fi

# --- Khởi động Keycloak ---
info "Khởi động Keycloak..."
$DC up -d keycloak
wait_for_health "bi-keycloak" "Keycloak" 240 || {
  echo
  error "Keycloak chưa khởi động được. Xem log: ${DC} logs keycloak"
  exit 1
}

# Xác nhận realm đã được import thành công
if docker exec bi-keycloak bash -c \
     "exec 3<>/dev/tcp/127.0.0.1/8080; \
      echo -e 'GET /realms/${KEYCLOAK_REALM}/.well-known/openid-configuration HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n' >&3; \
      cat <&3" 2>/dev/null | grep -q "\"issuer\""; then
  ok "Realm '${KEYCLOAK_REALM}' đã được import"
else
  warn "Keycloak chạy nhưng chưa thấy realm '${KEYCLOAK_REALM}'."
  warn "Realm chỉ được import lần đầu (khi DB Keycloak còn rỗng). Xem: ${DC} logs keycloak | grep -i import"
fi

# =============================================================================
# BƯỚC 4: In thông tin kết nối
# =============================================================================
echo
info "Bước 4/5: Thông tin kết nối"
echo
echo "  ${BOLD}MySQL${NC}"
echo "    Host      : localhost:${MYSQL_PORT}"
echo "    Database  : ${MYSQL_DATABASE}"
echo "    User      : ${MYSQL_USER} / ${MYSQL_PASSWORD}"
echo "    CLI       : docker exec -it bi-mysql mysql -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE}"
echo
echo "  ${BOLD}Redis${NC}"
echo "    Host      : localhost:${REDIS_PORT}"
echo "    Password  : ${REDIS_PASSWORD}"
echo "    CLI       : docker exec -it bi-redis redis-cli -a ${REDIS_PASSWORD}"
echo
echo "  ${BOLD}Keycloak${NC}"
echo "    Admin console : http://localhost:${KEYCLOAK_PORT}/admin"
echo "    Admin login   : ${KEYCLOAK_ADMIN} / ${KEYCLOAK_ADMIN_PASSWORD}"
echo "    Realm         : http://localhost:${KEYCLOAK_PORT}/realms/${KEYCLOAK_REALM}"
echo "    OIDC config   : http://localhost:${KEYCLOAK_PORT}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration"
echo "    User thử      : bi.admin   / Admin@123   (role bi-admin)"
echo "                    bi.creator / Creator@123 (role bi-creator)"
echo "                    bi.viewer  / Viewer@123  (role bi-viewer)"
echo
echo "  ${BOLD}Ứng dụng (sau khi chạy ở bước 5)${NC}"
echo "    Backend   : http://localhost:4000"
echo "    Health    : http://localhost:4000/health"
echo "    Frontend  : http://localhost:5173"

# =============================================================================
# BƯỚC 5: Hướng dẫn chạy backend và frontend
# =============================================================================
echo
info "Bước 5/5: Chạy ứng dụng - mở 2 terminal riêng"
echo
echo "  ${BOLD}Terminal 1 - Backend${NC}"
echo "    cd ../backend"
echo "    cp .env.example .env      # chỉ cần làm lần đầu"
echo "    npm install               # chỉ cần làm lần đầu"
echo "    npm run dev"
echo
echo "  ${BOLD}Terminal 2 - Frontend${NC}"
echo "    cd ../frontend"
echo "    cp .env.example .env      # chỉ cần làm lần đầu"
echo "    npm install               # chỉ cần làm lần đầu"
echo "    npm run dev"
echo
echo "  ${BOLD}Lệnh Docker hữu ích${NC}"
echo "    ${DC} ps                  # xem trạng thái"
echo "    ${DC} logs -f mysql       # xem log MySQL"
echo "    ${DC} stop                # dừng (giữ dữ liệu)"
echo "    ${DC} down                # xoá container (giữ dữ liệu)"
echo "    ${DC} down -v             # xoá cả dữ liệu - cẩn thận!"
echo "    ./reset-keycloak.sh       # import lại realm sau khi sửa file realm JSON"
echo

if [ "$MYSQL_PORT" != "3306" ]; then
  warn "MySQL đang map ra cổng ${MYSQL_PORT} (không phải 3306) - đặt MYSQL_PORT=${MYSQL_PORT} trong backend/.env."
fi

ok "${BOLD}Môi trường dev đã sẵn sàng.${NC}"
echo

if [ "$FOLLOW_LOGS" = true ]; then
  info "Đang theo dõi logs (Ctrl+C để thoát, containers vẫn chạy nền)..."
  $DC logs -f
fi
