# dbt + adapter ClickHouse.
#
# Không dùng image dbt dựng sẵn nào vì chúng không kèm dbt-clickhouse; cài bằng
# pip lại đơn giản và kiểm soát được phiên bản.
FROM python:3.11-slim

# git: dbt cần cho `dbt deps` (kéo package từ repo).
# Xoá apt cache ngay trong cùng layer để image không phình.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Pin theo dòng 1.8 — dbt-clickhouse kéo theo dbt-core tương thích.
# Không dùng bản không pin: hai máy build ở hai thời điểm sẽ ra hai phiên bản.
RUN pip install --no-cache-dir "dbt-clickhouse~=1.8.0"

WORKDIR /usr/app

# DBT_PROFILES_DIR trỏ vào đây (đặt trong docker-compose.yml) nên không cần
# ~/.dbt/profiles.yml.
ENV DBT_PROFILES_DIR=/usr/app \
    PYTHONUNBUFFERED=1

CMD ["sleep", "infinity"]
