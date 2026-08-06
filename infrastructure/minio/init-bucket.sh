#!/bin/sh
#
# Tạo bucket cho MinIO. Chạy một lần khi khởi động rồi thoát.
#
# Toàn bộ lệnh đều idempotent: chạy lại nhiều lần không sinh lỗi, vì container
# này khởi động lại mỗi khi bật profile 'data'.
#
set -e

BUCKET="${BI_BUCKET:-bi-datasets}"

echo "[minio-init] Đăng ký alias 'local'..."
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

echo "[minio-init] Tạo bucket '${BUCKET}'..."
mc mb --ignore-existing "local/${BUCKET}"

# Bucket PHẢI ở chế độ private. Dữ liệu upload là dữ liệu nghiệp vụ của người
# dùng; truy cập luôn đi qua presigned URL do backend cấp sau khi kiểm quyền.
mc anonymous set none "local/${BUCKET}"

# CORS: trình duyệt PUT thẳng file lên MinIO qua presigned URL (Uppy ở F5),
# nên origin của frontend phải được phép.
echo "[minio-init] Bucket đã sẵn sàng:"
mc ls local

echo "[minio-init] Xong."
