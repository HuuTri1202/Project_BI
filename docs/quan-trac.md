# Quan trắc hiệu năng — OpenTelemetry và SigNoz

Tài liệu này nói hai việc tách biệt nhau, và đó là điểm quan trọng nhất cần nhớ:

| Phần                                         | Ở đâu                    | Đổi được không                                                     |
| -------------------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| **Nhúng** — backend sinh ra vết gọi và số đo | `backend/src/tracing.ts` | Chuẩn OpenTelemetry, không gắn với SigNoz                          |
| **Thu thập** — nơi nhận và vẽ biểu đồ        | SigNoz, chạy riêng       | Đổi sang Jaeger / Grafana Tempo / Datadog chỉ bằng đổi một địa chỉ |

Backend **không biết** SigNoz tồn tại. Nó bắn OTLP vào địa chỉ ghi ở
`OTEL_EXPORTER_OTLP_ENDPOINT`, hết. Chọn như vậy để khi SigNoz không còn hợp,
việc phải làm là sửa một dòng `.env` chứ không phải gỡ mã ra khỏi ứng dụng.

---

## 1. Bật/tắt — chỉ một biến

```bash
# backend/.env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Biến này vừa là địa chỉ vừa là công tắc. **Không khai = tắt hẳn**: không dựng
SDK, không gửi gì, không in cảnh báo. Đó là mặc định của mọi máy dev.

Cố ý không có cờ `OTEL_ENABLED` riêng, vì một cờ riêng tạo ra được trạng thái
"bật nhưng không có chỗ gửi" — và ở trạng thái đó SDK cứ 30 giây lại thử bắn
vào `http://localhost:4318` (mặc định của chuẩn) rồi hỏng, mãi mãi.

> ⚠️ Địa chỉ **gốc**, không kèm `/v1/traces`. SDK tự nối đuôi cho từng loại tín
> hiệu; khai sẵn đuôi sẽ thành `/v1/traces/v1/traces`.

---

## 2. Cài SigNoz

### 2.1. Điều kiện — đọc trước khi cài

SigNoz **mang theo cả kho lưu trữ riêng**: ClickHouse 25.12.5, ClickHouse Keeper,
Postgres 16, bộ thu OTel và giao diện — sáu container. Nó **không** dùng chung
ClickHouse đang chạy cho kho phân tích của Open Insight, và không nên ép nó dùng
chung: hai bên có TTL, lược đồ và nhịp ghi hoàn toàn khác nhau.

Tài liệu SigNoz đòi tối thiểu **4 GB RAM riêng cho Docker**. Con số ĐO ĐƯỢC trên
máy dev ngày 24/11/2026, sau khi cả hai stack cùng chạy và đã nhận dữ liệu thật:

```
RAM cấp cho WSL2 (trần)                        6,0 GB
├─ stack Open Insight (5 container)            1,24 GB
└─ SigNoz (6 container)                        0,82 GB   ← lúc rảnh
                                               ───────
   đang dùng                                   2,8 GB
   còn trống                                   3,0 GB
```

Nhẹ hơn hẳn con số 4 GB trong tài liệu — **nhưng đừng lấy đó làm chuẩn**. 0,82 GB
là lúc kho mới có vài nghìn span. ClickHouse của SigNoz lớn theo lượng dữ liệu
giữ lại, nên 4 GB vẫn là con số đúng để trừ hao khi chạy dài ngày hoặc khi thử
tải nặng.

### 2.2. Trên Windows: WSL2, KHÔNG phải Docker Desktop

Tài liệu SigNoz nói thẳng là **không nên** chạy trên Docker Desktop/Windows —
ClickHouse Keeper sập với mã thoát 139. Đường được khuyến nghị là Docker Engine
cài thẳng trong WSL2.

Máy dev vì vậy chạy **hai Docker Engine tách biệt**, và đó là chủ ý:

```
WSL2 (trần 6 GB, khai ở C:\Users\<bạn>\.wslconfig)
├── distro docker-desktop  → MySQL, ClickHouse, Redis, MinIO, Cube  (ứng dụng)
└── distro Ubuntu          → SigNoz                                 (quan trắc)
```

Hai distro **dùng chung** trần RAM của WSL2. Không khai `.wslconfig` thì WSL2
tự lấy 50% RAM máy (3,9 GB) — không đủ cho cả hai. File cần có:

```ini
# C:\Users\<bạn>\.wslconfig
[wsl2]
memory=6GB
processors=6
swap=2GB
autoMemoryReclaim=gradual
```

> `memory` là **trần**, không phải phần giữ chỗ. Kèm `autoMemoryReclaim=gradual`
> thì WSL trả lại cho Windows phần không dùng, nên lúc SigNoz tắt máy không mất
> 6 GB. Sửa file này xong phải `wsl --shutdown` (container ứng dụng khai
> `restart: unless-stopped` nên tự bật lại).

### 2.3. Docker Engine trong Ubuntu

```bash
wsl -d Ubuntu -u root
apt-get update && apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
usermod -aG docker <tên-user-của-bạn>
```

> ⚠️ Trước khi cài, `/usr/bin/docker` trong Ubuntu là **symlink tới CLI của
> Docker Desktop** (`/mnt/wsl/docker-desktop/cli-tools/...`), không phải Engine.
> Gói `docker-ce` thay nó bằng binary thật. Nếu Docker Desktop dựng lại symlink
> đó sau một lần khởi động, hãy tắt **Settings → Resources → WSL Integration**
> cho distro Ubuntu.

### 2.4. Dựng SigNoz

Từ **v0.130.0**, script `install.sh` và các file compose trong `deploy/` của
SigNoz đã **bị khai tử**, không còn được phân phối. Mọi hướng dẫn trên mạng bảo
`git clone` rồi `cd signoz/deploy/docker` đều đang nói về bản cũ. Cách hiện tại
là `foundryctl`:

```bash
curl -fsSL https://signoz.io/foundry.sh | bash   # cài foundryctl vào ~/.local/bin

mkdir -p ~/signoz-openinsight && cd ~/signoz-openinsight
cp /mnt/d/doantotnghiep/bi-flatform/infrastructure/signoz/casting.yaml .

foundryctl gauge -f casting.yaml    # kiểm điều kiện máy
foundryctl cast  -f casting.yaml    # sinh compose vào pours/ rồi chạy
```

Giao diện: **http://localhost:8080** (WSL2 chuyển tiếp cổng về Windows, nên mở
thẳng bằng trình duyệt trên Windows được).

> ### ⚠️ Chưa tạo tài khoản đầu tiên thì KHÔNG nhận được dữ liệu nào
>
> Đây là mắt xích dễ bỏ sót nhất, vì triệu chứng không hề gợi ra nguyên nhân:
> giao diện 8080 vào được bình thường, mọi container đều `healthy`, bộ thu ghi
> `Everything is ready. Begin running and processing data.` — nhưng **cổng 4317
> và 4318 không hề mở**, nên ứng dụng gửi gì cũng rơi vào hư không.
>
> Lý do nằm ở log của `signoz-signoz-0`:
>
> ```
> failed to find or create agent -> cannot create agent without orgId
> ```
>
> Bộ thu nhận cấu hình pipeline từ máy chủ SigNoz qua OpAMP, mà máy chủ từ chối
> đăng ký agent khi **chưa có tổ chức nào**. Nên phải hoàn tất đăng ký tài khoản
> đầu tiên trước, qua giao diện hoặc qua API:
>
> ```bash
> curl -X POST http://localhost:8080/api/v1/register \
>   -H "content-type: application/json" \
>   -d '{"name":"Admin","orgName":"Open Insight","email":"<email-cua-ban>","password":"<mat-khau-cua-ban>"}'
> ```
>
> Kiểm bằng `curl -s http://localhost:8080/api/v1/version` — phải thấy
> `"setupCompleted": true`. Vài chục giây sau, cổng 4318 mới bắt đầu nhận.
>
> ⚠️ Mật khẩu này **không** được viết vào repo. Tự đặt khi cài, và đổi nếu máy
> có người khác dùng chung.

**File duy nhất cần giữ trong Git là `infrastructure/signoz/casting.yaml`.**
`foundryctl` sinh ra `pours/deployment/compose.yaml` từ nó, và tài liệu SigNoz
dặn đừng sửa tay vì lần `forge`/`cast` sau sẽ ghi đè — nên `pours/` nằm trong
`.gitignore`. Muốn tuỳ biến thì sửa `casting.yaml` rồi `cast` lại.

Chạy ở thư mục nhà của WSL chứ không phải trong repo (`/mnt/d/...`): ổ Windows
gắn qua virtiofs chậm hẳn, và `pours/` là đồ sinh ra, không thuộc về mã nguồn.

### 2.5. Tắt khi không đo

```bash
cd ~/signoz-openinsight/pours/deployment && docker compose stop
```

Trả lại ~3 GB cho máy. `autoMemoryReclaim` sẽ đẩy phần đó về Windows.

### 2.6. Lần dựng đầu tiên rất chậm, và có một cái bẫy

Trên máy dev, lượt `cast` đầu mất khoảng **15 phút**: kéo về vài GB image rồi
dựng cả chuỗi phụ thuộc ClickHouse → migration → ingester → signoz. Đừng vội kết
luận là hỏng.

Hai thứ **trông như lỗi nhưng không phải**:

| Hiện tượng                                            | Thực tế                                                                                                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signoz-signoz-0` crash-loop mấy phút đầu             | Nó khởi động trước khi Postgres kịp sẵn sàng rồi tự thử lại. Tự hết.                                                                                                                          |
| ClickHouse / Keeper báo `unhealthy` nhưng vẫn trả lời | Healthcheck **hết giờ** (`ExitCode -1`, "timed out starting health check") vì nghẽn I/O, không phải container chết. Kiểm bằng `docker inspect … --format "{{.RestartCount}}"` — bằng 0 là ổn. |

**Cái bẫy thật: khoá migration kẹt.** Nếu `signoz-signoz-0` chết đúng lúc đang
chạy migration — rất dễ xảy ra ở lượt dựng đầu trên máy chậm — nó để lại một
dòng khoá trong Postgres mà không ai gỡ. Từ đó mọi lần khởi động đều dừng ở:

```
migrate: migrations table is already locked
(ERROR: duplicate key value violates unique constraint "migration_lock_table_name_key")
```

Và cổng 8080 **không bao giờ mở** — triệu chứng bên ngoài chỉ là "trang không
vào được", không nói gì về nguyên nhân.

> ### ⚠️ ĐỪNG chỉ xoá dòng khoá
>
> Đã thử trên máy này ngày 24/11/2026 và **nó làm hỏng nặng hơn**. Xoá khoá thì
> SigNoz chạy tiếp migration từ một trạng thái dở dang: migration `066` gặp một
> bảng chưa kịp tạo, bảng `agents` không bao giờ thành hình, và từ đó máy chủ
> OpAMP trả `failed to find or create agent` cho bộ thu. Hậu quả là bộ thu
> **không nhận được cấu hình pipeline nên không mở cổng 4317/4318 nào cả** —
> giao diện 8080 vào được bình thường, mà không một span nào gửi lên được.
>
> Cái giá của việc chẩn đoán sai ở đây rất cao: triệu chứng cuối (không gửi được
> span) nằm cách nguyên nhân gốc (migration dở dang) ba tầng.

Cách đúng cho một bản **vừa cài, chưa có dữ liệu đo**: dựng lại sạch. Lượt này
nhanh hơn hẳn vì image đã nằm trên máy.

```bash
cd ~/signoz-openinsight/pours/deployment
docker compose -f compose.yaml down -v     # -v: xoá cả volume
cd ~/signoz-openinsight
foundryctl cast -f casting.yaml
```

Rồi **để yên cho nó chạy xong** — đừng restart container nào giữa chừng, vì đó
chính là thứ tạo ra khoá kẹt ngay từ đầu.

Nếu SigNoz đã chạy một thời gian và có dữ liệu đo đáng giữ thì không dùng cách
này; lúc đó phải đọc `docker logs signoz-signoz-0` tìm migration nào dừng và xử
lý riêng.

---

## 3. Những gì đang được đo

Đo thật trên backend ngày 24/11/2026, qua một vòng đăng nhập + 3 vòng truy vấn:
**34 loại span** và **17 số đo**.

### Vết gọi (traces)

| Tầng              | Thư viện nhúng            | Ví dụ span                                                      |
| ----------------- | ------------------------- | --------------------------------------------------------------- |
| HTTP vào          | `instrumentation-http`    | `GET /api/v1/datamodels/:id/fields`                             |
| Express           | `instrumentation-express` | `router - /`, `middleware - originGuard`, `request handler - …` |
| MySQL             | `instrumentation-mysql2`  | `SELECT`, `START`, `COMMIT`                                     |
| Redis             | `instrumentation-ioredis` | `get`                                                           |
| ClickHouse / Cube | `instrumentation-undici`  | `POST`                                                          |

Đường dẫn được **tham số hoá** (`/:id`, không phải `/229`), nên SigNoz gom đúng
một nhóm cho một endpoint thay vì sinh ra một nhóm cho mỗi id.

### Số đo (metrics)

Quan trọng nhất với kiến trúc này:

- `nodejs.eventloop.delay.p99` — **con số đáng theo dõi nhất**. Tiến trình này
  vừa phục vụ API vừa chạy hai vòng lặp nền (nạp dữ liệu, thanh toán).
  Độ trễ vòng lặp sự kiện là thứ duy nhất cho thấy một tác vụ nền đang chẹn
  đường của mọi request.
- `http.server.request.duration` — độ trễ theo từng endpoint.
- `http.client.request.duration` — thời gian chờ ClickHouse/Cube trả lời.
- `v8js.memory.heap.used`, `v8js.gc.duration` — rò rỉ bộ nhớ và áp lực GC.

Nhịp xuất số đo là **60 giây** (mặc định của chuẩn là 30). Số đo là chuỗi thời
gian chứ không phải sự kiện, nên một phút một điểm đã đủ vẽ đồ thị mà bớt được
một nửa lưu lượng.

### Những gì CỐ Ý không đo

| Bỏ                            | Vì sao                                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instrumentation-fs`          | Một span cho **mỗi** thao tác tệp. `cubeSchemaStore` ghi schema mỗi lần mô hình đổi, exceljs/jszip đọc ghi khi xuất báo cáo — bật lên thì một vết gọi mười span thành hàng trăm, không đọc nổi.           |
| `instrumentation-net`, `-dns` | Nằm dưới `http` một tầng. Span `http` đã có đường dẫn, mã trạng thái, thời gian; hai cái này chỉ thêm chi tiết mở socket và tra tên miền.                                                                 |
| `GET /health`                 | Docker healthcheck gọi 30 giây một lần, mãi mãi. Để nguyên thì phần lớn vết gọi là mấy cú thăm dò đó, và p95 "toàn hệ thống" bị kéo xuống bởi một đường dẫn trả về một dòng JSON — một con số đẹp mà sai. |

---

## 4. `tracing.ts` phải nạp TRƯỚC mọi thứ

`backend/src/index.ts` mở đầu bằng `import './tracing';` và dòng đó **bắt buộc
đứng trước mọi import khác**.

OpenTelemetry không đọc mã nguồn — nó **vá đè** thư viện ngay lúc chúng được
`require`. Express, mysql2, ioredis chỉ sinh span nếu `sdk.start()` đã chạy
trước lúc chúng được nạp.

Việc này chạy được là nhờ backend biên dịch ra **CommonJS** (`tsconfig` dùng
`module: NodeNext`, `package.json` không khai `"type": "module"`): tsc giữ
nguyên thứ tự và sinh `require("./tracing")` đứng trước `require("./app")`.

> ⚠️ Nếu một ngày dự án chuyển sang ESM thì dòng import này **không còn đủ** —
> ESM nâng toàn bộ import lên và nạp theo thứ tự phụ thuộc. Lúc đó phải đổi lệnh
> chạy thành `node --import ./dist/tracing.js dist/index.js`.

Đổi chỗ dòng đó xuống dưới thì hệ thống **vẫn chạy bình thường** — chỉ là SigNoz
không còn thấy một span nào của Express. Đây là kiểu hỏng im lặng, nên nếu màn
hình Services trống thì hãy kiểm tra dòng này đầu tiên.

---

## 5. Ở production

`docs/trien-khai.md` chọn **một máy ảo e2-standard-2 (2 vCPU, 8 GB)**. Con số đó
tính cho stack ứng dụng, **chưa tính SigNoz**. Muốn chạy SigNoz trên cùng máy thì
phải nâng lên **e2-standard-4 (4 vCPU, 16 GB)** — xem §1 của tài liệu đó.

Ba hướng, theo thứ tự tôi khuyên:

1. **Không chạy SigNoz ở production.** Dùng nó như công cụ đo lúc phát triển và
   lúc thử tải, rồi tắt. Rẻ nhất, và với một đồ án thì phần cần chứng minh là
   _đo được_, không phải _giám sát 24/7_.
2. **Nâng VM lên e2-standard-4.** Tốn khoảng gấp đôi tiền máy.
3. **SigNoz Cloud.** Không tốn RAM máy nào; đổi `OTEL_EXPORTER_OTLP_ENDPOINT`
   sang địa chỉ của họ và thêm `OTEL_EXPORTER_OTLP_HEADERS=signoz-ingestion-key=…`.
   Khoá đó **là bí mật**: chỉ nằm trong `backend/.env`, không bao giờ commit.

Dù chọn hướng nào thì **phần nhúng không đổi một dòng** — đó là lý do nó được
viết theo chuẩn OpenTelemetry chứ không theo SDK riêng của SigNoz.

---

## 6. Chưa làm

- **Log.** Backend đang ghi bằng `console.log`. Nối chúng vào OTel cần một cầu
  log (`@opentelemetry/sdk-logs`) hoặc đọc log container bằng bộ thu. Vết gọi và
  số đo trả lời được "chậm ở đâu" và "có khoẻ không"; log trả lời "vì sao", và
  đó là bước tiếp theo đáng làm nhất.
- **Trình duyệt.** Hiện chỉ đo phía máy chủ. Thời gian tải trang, Core Web
  Vitals và lỗi JS của người dùng thật thì chưa có.
- **Cảnh báo.** SigNoz đặt được ngưỡng cảnh báo (p99 vượt mốc, tỉ lệ lỗi tăng),
  nhưng chưa cấu hình cái nào.
