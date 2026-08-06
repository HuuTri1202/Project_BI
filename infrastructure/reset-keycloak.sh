#!/usr/bin/env bash
#
# reset-keycloak.sh - Xoá sạch dữ liệu Keycloak để import lại realm từ file JSON
#
# TẠI SAO CẦN SCRIPT NÀY:
#   Cờ --import-realm của Keycloak CHỈ chạy khi realm chưa tồn tại. Sau lần khởi
#   động đầu tiên, mọi thay đổi trong keycloak/realms/*.json đều bị bỏ qua ÂM
#   THẦM — không log, không lỗi, chỉ đơn giản là không có tác dụng. Muốn áp dụng
#   thay đổi thì phải xoá database của Keycloak rồi cho nó import lại.
#
# CẢNH BÁO: script này XOÁ TOÀN BỘ user, session và cấu hình đã chỉnh tay trên
# admin console. Chỉ dùng ở môi trường dev.
#
# Cách dùng:
#   ./reset-keycloak.sh          # hỏi xác nhận trước khi xoá
#   ./reset-keycloak.sh --yes    # xoá luôn, không hỏi (dùng trong script khác)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -t 1 ]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; BOLD=''; NC=''
fi

info()  { echo "${BLUE}[i]${NC} $*"; }
ok()    { echo "${GREEN}[✓]${NC} $*"; }
warn()  { echo "${YELLOW}[!]${NC} $*"; }
error() { echo "${RED}[✗]${NC} $*" >&2; }

ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    -y|--yes)  ASSUME_YES=true ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) error "Tham số không hợp lệ: $arg"; exit 1 ;;
  esac
done

# --- Docker Compose V2 hay V1 ---
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  error "Không tìm thấy Docker Compose."
  exit 1
fi

# --- Đọc .env ---
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-rootpassword}"
KEYCLOAK_DB_NAME="${KEYCLOAK_DB_NAME:-keycloak}"
KEYCLOAK_DB_USER="${KEYCLOAK_DB_USER:-keycloak}"
KEYCLOAK_DB_PASSWORD="${KEYCLOAK_DB_PASSWORD:-keycloak_password}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-8081}"
KEYCLOAK_REALM="bi-platform"

echo
echo "${BOLD}=== Reset Keycloak ===${NC}"
echo
warn "Thao tác này sẽ XOÁ database '${KEYCLOAK_DB_NAME}':"
echo "    - toàn bộ user và session của realm '${KEYCLOAK_REALM}'"
echo "    - mọi chỉnh sửa thực hiện trực tiếp trên admin console"
echo "    - realm sẽ được import lại từ keycloak/realms/*.json"
echo

if [ "$ASSUME_YES" != true ]; then
  printf "Gõ 'yes' để tiếp tục: "
  read -r answer
  if [ "$answer" != "yes" ]; then
    info "Đã huỷ."
    exit 0
  fi
fi

# --- 1. Dừng Keycloak (phải dừng trước khi drop DB đang mở kết nối) ---
info "Dừng container Keycloak..."
$DC stop keycloak >/dev/null 2>&1 || true
$DC rm -f keycloak >/dev/null 2>&1 || true
ok "Đã dừng Keycloak"

# --- 2. MySQL phải đang chạy để drop/create database ---
if ! docker exec bi-mysql mysqladmin ping -uroot -p"$MYSQL_ROOT_PASSWORD" --silent >/dev/null 2>&1; then
  error "MySQL (bi-mysql) chưa chạy. Chạy ./start-dev.sh trước."
  exit 1
fi

# --- 3. Xoá và tạo lại database (idempotent) ---
info "Xoá và tạo lại database '${KEYCLOAK_DB_NAME}'..."
docker exec bi-mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "
  DROP DATABASE IF EXISTS \`${KEYCLOAK_DB_NAME}\`;
  CREATE DATABASE \`${KEYCLOAK_DB_NAME}\`
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER IF NOT EXISTS '${KEYCLOAK_DB_USER}'@'%' IDENTIFIED BY '${KEYCLOAK_DB_PASSWORD}';
  ALTER USER '${KEYCLOAK_DB_USER}'@'%' IDENTIFIED BY '${KEYCLOAK_DB_PASSWORD}';
  GRANT ALL PRIVILEGES ON \`${KEYCLOAK_DB_NAME}\`.* TO '${KEYCLOAK_DB_USER}'@'%';
  FLUSH PRIVILEGES;" >/dev/null 2>&1
ok "Database '${KEYCLOAK_DB_NAME}' đã trống"

# --- 4. Khởi động lại Keycloak, lần này realm sẽ được import ---
info "Khởi động lại Keycloak (import realm có thể mất ~60-120s)..."
$DC up -d keycloak >/dev/null

elapsed=0
timeout=240
while [ "$elapsed" -lt "$timeout" ]; do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' bi-keycloak 2>/dev/null || echo none)"
  if [ "$status" = "healthy" ]; then
    printf '\r'
    ok "Keycloak sẵn sàng"
    break
  fi
  if [ "$status" = "unhealthy" ]; then
    printf '\r'
    error "Keycloak unhealthy. Xem log: ${DC} logs keycloak"
    exit 1
  fi
  printf '\r    Keycloak: %s (%ss)   ' "$status" "$elapsed"
  sleep 3
  elapsed=$((elapsed + 3))
done

if [ "$elapsed" -ge "$timeout" ]; then
  printf '\r'
  error "Keycloak quá thời gian chờ ${timeout}s. Xem log: ${DC} logs keycloak"
  exit 1
fi

# --- 5. Xác nhận realm đã import và role mới đã có ---
if docker exec bi-keycloak bash -c \
     "exec 3<>/dev/tcp/127.0.0.1/8080; \
      echo -e 'GET /realms/${KEYCLOAK_REALM}/.well-known/openid-configuration HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n' >&3; \
      cat <&3" 2>/dev/null | grep -q '"issuer"'; then
  ok "Realm '${KEYCLOAK_REALM}' đã được import lại"
else
  error "Không thấy realm '${KEYCLOAK_REALM}'. Xem log: ${DC} logs keycloak | grep -i import"
  exit 1
fi

echo
echo "  ${BOLD}Kiểm tra lại${NC}"
echo "    Admin console : http://localhost:${KEYCLOAK_PORT}/admin"
echo "    Realm roles   : phải có bi-admin, bi-creator, bi-viewer"
echo "    Users         : bi.admin / bi.creator / bi.viewer"
echo
ok "${BOLD}Xong.${NC}"
echo
