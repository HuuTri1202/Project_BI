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

if [ "$RECREATE" = true ]; then
  warn "--recreate: xoá container cũ (volume dữ liệu vẫn giữ)."
  $DC down --remove-orphans
fi

# -d = detached: containers chạy nền, script tiếp tục chạy.
#
# MinIO nằm trong nhóm LÕI kể từ khi mục §7 (tải file lên) vào nhánh main, dù nó
# vẫn khai `profiles: ["data"]` trong compose. Lý do phải bật mặc định: trình
# duyệt PUT file THẲNG lên MinIO bằng URL ký sẵn, nên khi MinIO không chạy thì
# backend vẫn trả 201 cho bước ký URL và log của nó sạch bong — còn người dùng
# thì nhận "Có lỗi không xác định". Triệu chứng nằm cách nguyên nhân đúng một
# tiến trình, và không có gì trong log dẫn được từ bên này sang bên kia.
#
# `minio-init` tạo bucket `bi-datasets` rồi tự thoát; không có nó thì mọi lần
# PUT đều trả NoSuchBucket.
#
# ClickHouse vào nhóm LÕI kể từ mục §9 (nạp dữ liệu vào kho phân tích), cùng lý
# do với MinIO: nó không còn là hạ tầng tuỳ chọn của một spike mà là nơi dữ liệu
# thật sự nằm. Không bật thì nút "Nạp vào kho phân tích" báo lỗi ở mọi máy.
#
# ⚠️ Cái giá phải nói ra: thêm ~2GB RAM cho MỌI người, kể cả người chỉ sửa giao
# diện. Lần đầu còn kéo ~1,5GB image. Máy chật thì tắt riêng nó bằng
# `docker compose stop clickhouse` — phần còn lại của hệ thống vẫn chạy bình
# thường, chỉ mất chức năng nạp.
#
# Phần còn lại (Cube, Kafka, dbt) vẫn nằm sau profile — xem cuối script.
$DC --profile data up -d mysql redis minio minio-init clickhouse

ok "Đã gửi lệnh khởi động MySQL + Redis + MinIO + ClickHouse."

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
wait_for_health "bi-minio" "MinIO" 60  || FAILED=true
# 120s chứ không 60: lần chạy ĐẦU TIÊN phải kéo ~1,5GB image trước khi container
# tồn tại, và `start_period` của healthcheck còn thêm 30s nữa.
wait_for_health "bi-clickhouse" "ClickHouse" 120 || FAILED=true

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
echo "  ${BOLD}ClickHouse${NC} (kho phân tích - §9)"
echo "    HTTP      : localhost:${CLICKHOUSE_HTTP_PORT:-8123}"
echo "    Database  : ${CLICKHOUSE_DB:-bi_analytics}"
echo "    User      : ${CLICKHOUSE_USER:-bi_user} / ${CLICKHOUSE_PASSWORD:-clickhouse_password}"
echo "    CLI       : docker exec -it bi-clickhouse clickhouse-client --user ${CLICKHOUSE_USER:-bi_user} --password ${CLICKHOUSE_PASSWORD:-clickhouse_password}"
echo
echo "  ${BOLD}Ứng dụng (sau khi chạy ở bước 5)${NC}"
echo "    Backend   : http://localhost:4000"
echo "    Health    : http://localhost:4000/health"
echo "    Frontend  : http://localhost:5173"

# =============================================================================
# BƯỚC 5: Hướng dẫn chạy backend và frontend
# =============================================================================
echo
info "Bước 5/5: Chạy ứng dụng"
echo
echo "  ${BOLD}Lần đầu (ở thư mục gốc của repo)${NC}"
echo "    cd .."
echo "    npm install               # cài concurrently"
echo "    npm run setup             # tạo .env + cài dependency cho backend & frontend"
echo
echo "  ${BOLD}Hằng ngày - một lệnh chạy cả backend lẫn frontend${NC}"
echo "    npm run dev               # log gắn nhãn [api]/[web], Ctrl+C tắt cả hai"
echo
echo "  ${BOLD}Chạy riêng nếu cần${NC}"
echo "    npm run dev:api           # chỉ backend"
echo "    npm run dev:web           # chỉ frontend"
echo
echo "  ${BOLD}Bật thêm hạ tầng theo nhu cầu (profile)${NC}"
echo "    ${DC} --profile bi   up -d      # + Cube.js (kéo theo ClickHouse)"
echo "    ${DC} --profile stream up -d    # + Kafka, Debezium Connect"
echo "    ${DC} --profile tools  up -d    # + dbt"
echo "    (script này chỉ khởi động service lõi - xem README)"
echo
echo "  ${BOLD}Lệnh Docker hữu ích${NC}"
echo "    ${DC} ps                  # xem trạng thái"
echo "    ${DC} logs -f mysql       # xem log MySQL"
echo "    ${DC} stop                # dừng (giữ dữ liệu)"
echo "    ${DC} down                # xoá container (giữ dữ liệu)"
echo "    ${DC} down -v             # xoá cả dữ liệu - cẩn thận!"
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
