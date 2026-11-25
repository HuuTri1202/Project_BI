# Triển khai Open Insight lên Google Cloud

Sổ tay này đi từ một máy ảo trắng tới một hệ thống chạy được, có HTTPS. Mọi lệnh
chạy trên máy ảo trừ khi ghi khác.

---

## 1. Vì sao MỘT máy ảo, không phải Cloud Run

Quyết định kiến trúc, và nó không phải vì "đồ án thì làm cho gọn".

**Express GHI file schema của Cube, Cube ĐỌC chúng.** Xem
`backend/src/services/datamodel/cubeSchemaStore.ts`: mỗi mô hình dữ liệu được
sinh ra thành `model/tenants/{tenantId}/dm{id}.js` trên đĩa, và
`infrastructure/cube/cube.js` đọc đúng thư mục đó qua bind mount. Hai tiến trình
**buộc phải nhìn thấy cùng một hệ thống file**.

Tách thành hai service Cloud Run là mất cả §10: mô hình dữ liệu, tab Khám phá,
mọi biểu đồ, và khung hỏi đáp — vì khung hỏi đáp sinh ra truy vấn rồi chạy qua
Cube. Muốn chẻ ra thì phải có Filestore (NFS), khoảng 200 USD/tháng; gcsfuse
**không** dùng được vì Cube theo dõi thư mục bằng inotify và gcsfuse không phát
sự kiện đó.

Thêm hai lý do nữa:

- **Ba vòng lặp nền** (`ingest`, `billing`, `lichGui`) chạy trong chính tiến
  trình API. Cloud Run bóp CPU ngoài lúc có request, nên chúng sẽ không chạy.
- Cả ba đã được làm cho **an toàn với nhiều bản sao** (xem `claimNext` và
  `datLanKeTiep`), nhưng "an toàn" ở đây nghĩa là không chạy trùng — không có
  nghĩa là chúng chạy khi CPU bị bóp.

Nên: một máy ảo, `docker compose`, sáu container. Khi nào cần chẻ thì việc phải
làm trước là cho Cube lấy schema qua HTTP (`repositoryFactory` gọi ngược về
Express) — khi đó chỉ `cubeSchemaStore.ts` và `cube.js` phải đổi.

---

## 2. Dựng máy ảo

### Cấu hình

| Hạng mục     | Chọn                           | Vì sao                                                                                                             |
| ------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Loại máy     | `e2-standard-2` (2 vCPU, 8 GB) | Sáu container ở trạng thái nghỉ đã ~1,7 GB; ClickHouse một mình được cấp trần 2 GB và nó dùng thật khi nạp tệp lớn |
| Hệ điều hành | Ubuntu 24.04 LTS               |                                                                                                                    |
| Đĩa          | 30 GB balanced                 | MySQL + ClickHouse + MinIO + volume Cube Store nằm chung trên đĩa này                                              |
| Vùng         | `asia-southeast1` (Singapore)  | Gần Việt Nam nhất; `asia-south`/`us` thêm 150–250 ms cho mỗi lượt gọi                                              |
| IP           | **Reserve một static IP**      | IP tạm đổi sau mỗi lần tắt máy, và DNS sẽ trỏ sai                                                                  |

`e2-medium` (4 GB) chạy được nhưng chật: phải bật swap 4 GB và ClickHouse sẽ
chậm hẳn khi nạp tệp vài chục nghìn dòng.

> ### ⚠️ Muốn chạy cả SigNoz trên máy này thì `e2-standard-2` KHÔNG đủ
>
> SigNoz mang theo kho lưu trữ riêng — ClickHouse 25.5.6, ClickHouse Keeper,
> Postgres 16, bộ thu OTel và giao diện — và tài liệu của nó đòi **tối thiểu
> 4 GB RAM riêng cho Docker**, cộng thêm vào 1,7 GB của stack ứng dụng. Tổng
> vượt 8 GB.
>
> Ba hướng, theo thứ tự khuyên dùng:
>
> 1. **Không chạy SigNoz ở production.** Dùng nó lúc phát triển và lúc thử tải
>    rồi tắt. Rẻ nhất, và phần cần chứng minh của một đồ án là _đo được_, không
>    phải _giám sát 24/7_.
> 2. **Nâng lên `e2-standard-4`** (4 vCPU, 16 GB) — khoảng gấp đôi tiền máy. Khi
>    đó mở thêm cổng giao diện SigNoz (8080) **chỉ qua đường hầm SSH/IAP**, đừng
>    mở ra Internet: màn hình đó cho xem toàn bộ đường dẫn và tham số truy vấn
>    của hệ thống.
> 3. **SigNoz Cloud** — không tốn RAM máy nào.
>
> Phần nhúng OpenTelemetry trong backend **không đổi một dòng** ở cả ba hướng.
> Chi tiết ở [`quan-trac.md`](quan-trac.md).

### Tường lửa

Chỉ mở **80** và **443**. Gắn hai tag `http-server`, `https-server` cho máy ảo.

```bash
# Trên máy của bạn, không phải trên VM
gcloud compute instances add-tags open-insight --tags=http-server,https-server
```

**Không mở 3310, 6379, 8123, 9000, 9001, 4100.** `docker-compose.yml` đã bind
chúng vào `127.0.0.1`, nên kể cả khi tường lửa mở thì bên ngoài vẫn không tới
được — nhưng đừng dựa vào một lớp duy nhất.

SSH: dùng **IAP tunnel** thay vì mở cổng 22 ra Internet.

```bash
gcloud compute ssh open-insight --tunnel-through-iap
```

### DNS

Trỏ hai bản ghi A về static IP:

```
open-insight.vn       A    <IP>
s3.open-insight.vn    A    <IP>
```

Bản ghi `s3.` là **bắt buộc**, không phải tuỳ chọn — xem mục 5.

---

## 3. Cài phần mềm nền

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker
```

Không cần cài Node: API build và chạy trong container.

---

## 4. Lấy mã nguồn và sinh cấu hình

```bash
git clone <repo> open-insight && cd open-insight
node --version   # nếu chưa có Node, xem ghi chú dưới
npm run setup    # hoặc: docker run --rm -v "$PWD:/w" -w /w node:22-alpine node scripts/init-env.mjs
```

`npm run setup` tạo ba file `.env` và **sinh mật khẩu ngẫu nhiên riêng cho máy
này**: `JWT_SECRET`, `CONNECTION_ENCRYPTION_KEY`, mật khẩu MySQL/Redis/
ClickHouse/MinIO và `CUBEJS_API_SECRET`. Cùng một giá trị được ghi vào cả
`backend/.env` và `infrastructure/.env` để hai bên khớp nhau.

> ⚠️ **Đừng chép `.env` từ máy dev sang.** Làm vậy là mang nguyên bộ mật khẩu dev
> lên máy có IP công khai, và `CUBEJS_API_SECRET` thì ai biết cũng ký được JWT
> đọc dữ liệu của mọi tổ chức.

---

## 5. Sửa `backend/.env` cho môi trường production

`npm run setup` sinh ra cấu hình **cho máy dev**. Mười giá trị dưới đây phải đổi.
Container không có MySQL nào ở `127.0.0.1` của chính nó — nó phải gọi theo **tên
service** trong mạng docker, và theo **cổng bên trong**, không phải cổng đã
publish.

```ini
NODE_ENV=production
CORS_ORIGIN=https://open-insight.vn

# Tên service + cổng TRONG mạng docker (không phải 3310 / 4100)
MYSQL_HOST=mysql
MYSQL_PORT=3306
REDIS_HOST=redis
REDIS_PORT=6379
CLICKHOUSE_HOST=clickhouse
CLICKHOUSE_PORT=8123
CUBEJS_URL=http://cube:4000

# Tên miền con, KHÔNG phải localhost: chính TRÌNH DUYỆT của người dùng mở URL này
S3_ENDPOINT=https://s3.open-insight.vn
S3_FORCE_PATH_STYLE=true

# Hiện ở bước 1 của wizard kết nối, để khách thêm vào tường lửa của họ
EGRESS_IP=<static IP của máy ảo>
```

### Vì sao `S3_ENDPOINT` là tên miền con

Trình duyệt tải tệp **thẳng** lên object storage bằng presigned URL (§7.4) — tệp
không đi qua Express. Nghĩa là URL đó phải mở được từ máy người dùng.

Và nó phải là **tên miền con**, không phải đường dẫn con kiểu `/s3/*`: chữ ký
SigV4 ký cả đường dẫn, nên proxy theo đường dẫn làm SDK ký `/s3/bucket/key`
trong khi MinIO kiểm `/bucket/key`, và mọi lần tải lên trả `SignatureDoesNotMatch`
— một lỗi trông như sai khoá chứ không như sai cấu hình proxy.

Chính backend cũng đọc tệp từ object storage ở **phía server**, không chỉ ký URL
cho trình duyệt: `services/ingest/readFileRows.ts` gọi `storage.getObject` để nạp
vào ClickHouse. Nên container `api` cũng phải tới được `https://s3.<tên miền>` —
và đó là **IP công khai của chính máy ảo này**, thứ mà một máy ảo GCE không gọi
được (không có hairpin NAT).

Chỗ này đã được xử trong `docker-compose.prod.yml`: service `caddy` mang thêm
**network alias** `s3.${DOMAIN}`, nên DNS nội bộ của Docker phân giải cái tên đó
thành IP container của Caddy. Không cần làm gì thêm, nhưng đừng xoá dòng alias
ấy — triệu chứng khi mất nó là tải tệp lên **thành công** rồi vòng lặp nạp báo
lỗi kết nối, một cặp triệu chứng rất dễ đi tìm sai chỗ.

### SMTP là bắt buộc ở production

Từ §1.10, tài khoản chưa xác minh email **không đăng nhập được**. Ở dev, thiếu
SMTP thì `mailer.ts` in thư ra log và vẫn dùng được. Ở production nó **từ chối
gửi** (log production nhiều người đọc, một vé đặt lại mật khẩu nằm trong đó là
một tài khoản bị chiếm). Không cấu hình SMTP nghĩa là **không ai đăng ký mới vào
được hệ thống**.

Nên đây **không còn là một bước phải nhớ**: `NODE_ENV=production` mà thiếu
`SMTP_HOST` thì máy chủ API **từ chối mở cổng** và in ra lý do kèm tên biến.
Container sẽ dừng với mã thoát 1 thay vì lên xanh rồi âm thầm chặn mọi người
đăng ký. `migrate` và `seed-admin` KHÔNG bị chặn — chúng là đường sửa chữa.

```ini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...        # Gmail: dùng App Password, không phải mật khẩu tài khoản
MAIL_FROM=Open Insight <no-reply@open-insight.vn>
```

### `infrastructure/.env`

```ini
COMPOSE_PROFILES=data,bi
DOMAIN=open-insight.vn
ACME_EMAIL=ban@open-insight.vn
```

`CUBEJS_DEV_MODE` **không cần khai nữa**: `docker-compose.prod.yml` ép nó về
`false` ngay trên service `cube`, nên dòng `CUBEJS_DEV_MODE=true` mà
`npm run setup` ghi sẵn cũng không bật được Playground ở bản triển khai. Trước
đây đây là một bước phải nhớ, và một bước phải nhớ thì không phải một chốt an
toàn — xem khối chú thích trong file đó.

---

## 6. Thư mục schema của Cube — làm TRƯỚC khi `up`

```bash
mkdir -p infrastructure/cube/model/tenants
sudo chown -R 1000:1000 infrastructure/cube/model/tenants
```

Hai dòng này không bỏ được. Docker tự tạo thư mục bind mount còn thiếu nhưng để
nó thuộc `root`, còn tiến trình API chạy bằng user `node` (uid 1000). Thiếu
`chown` thì mọi lần lưu mô hình dữ liệu trả **503 SchemaUnwritable**, và câu báo
lỗi sẽ chỉ bạn đi kiểm `CUBE_SCHEMA_DIR` — một biến hoàn toàn đúng.

---

## 7. Khởi động

```bash
cd infrastructure
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --profile data --profile bi up -d --build
```

Lần đầu mất 5–10 phút: `npm ci` cho cả monorepo rồi build ba package.

`docker-compose.prod.yml` thêm vào stack gốc:

| Service     | Việc                                                            |
| ----------- | --------------------------------------------------------------- |
| `api`       | Express đã build, chạy migration lúc boot                       |
| `caddy`     | TLS tự động, phục vụ `frontend/dist`, proxy `/api` và `/health` |
| `cubestore` | **Bắt buộc** khi `CUBEJS_DEV_MODE=false` — xem dưới             |

### Vì sao cần `cubestore`

Tắt dev mode thì Cube đòi một Cube Store chạy riêng. **Đã đo:** dựng lại
container cube với `CUBEJS_DEV_MODE=false` mà không có gì thêm thì `/meta` vẫn
trả 200 với đủ 11 cube, trong khi **mọi** `/cubejs-api/v1/load` trả 400:

```
Error: Cube Store was specified as queue/cache driver.
Please set CUBEJS_CUBESTORE_HOST and CUBEJS_CUBESTORE_PORT
```

Ở dev mode Cube tự chạy Cube Store bên trong tiến trình của nó, nên trên máy dev
không ai thấy thiếu gì — đó là lý do lỗi này chỉ hiện ra đúng lúc triển khai, và
hiện ra dưới dạng "mọi biểu đồ đều lỗi 400" chứ không nói gì về một service còn
thiếu.

---

## 8. Tài khoản quản trị đầu tiên

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  exec -e SEED_ADMIN_PASSWORD="$(openssl rand -base64 18)" \
  -e SEED_ADMIN_EMAIL=ban@open-insight.vn \
  api node dist/scripts/seed-admin.js
```

Lưu mật khẩu đó vào nơi quản lý bí mật của bạn trước khi đóng terminal.

Chạy mà không đặt `SEED_ADMIN_PASSWORD` thì script **từ chối** ở production, vì
mặc định của nó nằm công khai trong mã nguồn và tài khoản này là `superadmin` của
cả nền tảng.

---

## 9. Kiểm tra sau khi lên

```bash
curl -s https://open-insight.vn/health | jq        # liveness
curl -s https://open-insight.vn/health/ready | jq  # MySQL + Redis
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

**Header an toàn — kiểm trên TRANG, không phải trên API.** Đây là chỗ dễ nhầm
nhất: `helmet()` ở backend gắn header cho phản hồi JSON của Express, còn thứ bị
nhúng vào iframe là trang HTML do Caddy phục vụ. Hai tầng khác nhau.

```bash
# Phải thấy: frame-ancestors 'none'  VÀ  X-Frame-Options: DENY
curl -sI https://open-insight.vn/ | grep -iE "content-security-policy|x-frame-options"

# Route sâu cũng phải có (SPA trả index.html, nhưng header phải đi kèm)
curl -sI https://open-insight.vn/reports/1/edit | grep -ci "frame-ancestors 'none'"
```

Thiếu hai dòng đó thì bất kỳ trang web nào cũng nhúng được app vào iframe của
họ, phủ một nút mồi lên ô mật khẩu, và mọi cú bấm của nạn nhân rơi vào app thật.

Rồi bằng tay, theo thứ tự này — mỗi bước chạm một tầng khác nhau:

1. Mở `https://open-insight.vn`, đăng nhập bằng tài khoản vừa seed.
2. **F5 ở một trang con** (ví dụ `/bao-cao`). Ra 404 nghĩa là `try_files` trong
   Caddyfile không chạy.
3. Tải lên một tệp CSV → chạm MinIO qua `s3.` (presigned URL) và ClickHouse.
4. Tạo một mô hình dữ liệu → chạm thư mục schema và quyền uid 1000 ở mục 6.
5. Mở tab Khám phá, kéo một thước đo → chạm Cube **và** Cube Store.
6. Hỏi khung chat một câu có số → chạm cả chuỗi trên, cộng LLM nếu đã khai khoá.

Bước 5 là bước duy nhất chứng minh `cubestore` đã nối đúng. Đừng bỏ.

---

## 10. Sao lưu

Dữ liệu nằm trong bốn volume Docker. Không có cái nào tự sao lưu.

```bash
# MySQL — toàn bộ metadata: người dùng, báo cáo, mô hình, đơn hàng
docker exec bi-mysql sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" \
  --single-transaction --routines bi_platform' | gzip > ~/sao-luu/mysql-$(date +%F).sql.gz
```

Thêm vào `crontab` rồi đẩy lên một bucket GCS ở vùng khác. Snapshot đĩa của GCE
cũng đủ cho cả bốn volume cùng lúc và dễ hơn hẳn — đặt một lịch snapshot hằng
ngày cho đĩa của máy ảo.

> ⚠️ **`CONNECTION_ENCRYPTION_KEY` phải được sao lưu riêng**, ngoài database.
> Mọi mật khẩu kết nối CSDL khách hàng được mã hoá bằng khoá này. Có bản dump mà
> mất khoá thì phần §8 không khôi phục được — không có đường lùi.

---

## 11. Những gì sổ tay này KHÔNG làm

Ghi ra để không ai tưởng là đã có:

- **Không có CI/CD.** Cập nhật là `git pull && docker compose ... up -d --build`,
  và trong lúc build thì API vẫn chạy bản cũ (`up -d` chỉ thay container khi ảnh
  mới xong), nhưng vẫn có vài giây gián đoạn khi container đổi.
- **Không có nhiều bản sao.** Một container `api`. Hai bugs chạy trùng đã được
  sửa nên nhân bản sẽ không gây hỏng dữ liệu, nhưng thư mục schema của Cube thì
  vẫn là tài nguyên dùng chung không có khoá.
- **Không có giám sát.** Không Prometheus, không cảnh báo. `docker compose logs`
  và `/health/ready` là tất cả.
- **Không tự khôi phục sau khi máy ảo chết.** `restart: unless-stopped` lo
  container chết, không lo máy chết.
- **Chưa đo tải.** Mọi con số hiệu năng trong README đo trên máy dev Windows,
  không phải trên `e2-standard-2`.
