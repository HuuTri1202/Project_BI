import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
} from '@opentelemetry/semantic-conventions';

import { env } from './config/env';

/**
 * Quan trắc hiệu năng — OpenTelemetry bắn sang SigNoz.
 *
 * ═══ ⚠️ FILE NÀY PHẢI ĐƯỢC NẠP TRƯỚC MỌI FILE KHÁC ════════════════════════
 *
 * `index.ts` mở đầu bằng `import './tracing';` và dòng đó BẮT BUỘC đứng trước
 * mọi import khác. Lý do nằm ở cách OpenTelemetry làm việc: nó không đọc mã
 * nguồn của bạn mà VÁ ĐÈ các thư viện ngay lúc chúng được `require`. Express,
 * mysql2, ioredis chỉ sinh ra span nếu `sdk.start()` chạy TRƯỚC lúc chúng được
 * nạp vào tiến trình.
 *
 * Việc này chạy được là nhờ backend biên dịch ra CommonJS (`tsconfig` dùng
 * `module: NodeNext` và `package.json` KHÔNG khai `"type": "module"`): tsc giữ
 * nguyên thứ tự và sinh ra `require("./tracing")` đứng trước `require("./app")`,
 * mà `require` thì chạy ngay tại chỗ. Nếu một ngày nào đó dự án chuyển sang ESM
 * thì dòng import này KHÔNG còn đủ — ESM nâng toàn bộ import lên và nạp chúng
 * theo thứ tự phụ thuộc, nên lúc ấy phải đổi sang `node --import ./dist/tracing.js`.
 *
 * ═══ Vì sao không dùng đường "không cần code" ══════════════════════════════
 *
 * Tài liệu SigNoz mời dùng `NODE_OPTIONS=--require @opentelemetry/auto-
 * instrumentations-node/register`, tức không viết file nào cả. Đã cân nhắc và
 * bỏ, vì ba thứ dưới đây không khai được bằng biến môi trường:
 *
 *   1. TẮT HẲN khi chưa khai địa chỉ. Đường kia luôn dựng SDK và mặc định bắn
 *      vào `http://localhost:4318`; trên máy dev không chạy SigNoz thì cứ 30
 *      giây lại một lần gửi hỏng.
 *   2. Tắt `instrumentation-fs`. Xem khối chú thích ở dưới — để bật thì mỗi
 *      request sinh ra hàng trăm span đọc file.
 *   3. Xả nốt span đang chờ lúc tắt máy, nối vào `shutdown()` sẵn có.
 */

/**
 * Chưa khai địa chỉ = TẮT, và tắt một cách im lặng.
 *
 * Đây là trạng thái mặc định của mọi máy dev: `.env.example` để trống biến này.
 * Không in cảnh báo gì — quan trắc là thứ bật thêm, không phải thứ thiếu.
 */
const diaChi = env.OTEL_EXPORTER_OTLP_ENDPOINT;

let sdk: NodeSDK | undefined;

if (diaChi !== undefined) {
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME,
      /*
       * Môi trường đi kèm mỗi span, vì một bảng SigNoz gom chung dev và
       * production sẽ cho ra con số p95 không nói lên điều gì: máy dev chạy
       * `tsx watch` với dữ liệu mẫu, máy thật chạy mã đã biên dịch với dữ liệu
       * thật. Có thuộc tính này thì lọc chúng ra khỏi nhau bằng một cú bấm.
       */
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: env.NODE_ENV,
    }),

    traceExporter: new OTLPTraceExporter({ url: `${diaChi}/v1/traces` }),

    /*
     * Số đo — thứ trả lời "hệ thống có khoẻ không", khác hẳn vết gọi vốn trả
     * lời "request này chậm ở đâu".
     *
     * Bộ tự động nạp sẵn số đo thời gian chạy của Node: độ trễ vòng lặp sự
     * kiện, thời gian GC, kích thước heap. Với một tiến trình vừa phục vụ API
     * vừa chạy hai vòng lặp nền (nạp dữ liệu, thanh toán) thì ĐỘ TRỄ
     * VÒNG LẶP SỰ KIỆN là con số đáng theo dõi nhất: nó là thứ duy nhất cho
     * thấy một tác vụ nền đang chẹn đường của mọi request.
     *
     * 60 giây thay vì 30 mặc định: số đo là chuỗi thời gian, không phải sự
     * kiện, nên một phút một điểm đã đủ vẽ đồ thị mà bớt được một nửa lưu
     * lượng — đáng kể khi SigNoz chạy chung một máy với chính ứng dụng.
     */
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${diaChi}/v1/metrics` }),
        exportIntervalMillis: 60_000,
      }),
    ],

    instrumentations: [
      getNodeAutoInstrumentations({
        /*
         * TẮT `fs`, và đây không phải chuyện tiết kiệm vặt.
         *
         * Nó sinh một span cho MỖI thao tác hệ thống tệp. Tiến trình này đọc
         * ghi tệp liên tục ngoài tầm mắt: `cubeSchemaStore` ghi lại schema
         * Cube mỗi lần mô hình đổi, exceljs/jszip đọc ghi khi xuất báo cáo, và
         * bản thân Node đọc tệp lúc nạp module. Bật lên thì một vết gọi đáng ra
         * có mười span sẽ có hàng trăm — vết gọi thành không đọc nổi, còn kho
         * ClickHouse của SigNoz thì phình lên vì thứ không ai nhìn.
         */
        '@opentelemetry/instrumentation-fs': { enabled: false },

        /*
         * TẮT `net` và `dns` vì chúng nằm DƯỚI `http` một tầng.
         *
         * Mỗi lời gọi HTTP tới ClickHouse hay Cube đã có một span `http` mang
         * đủ thứ cần biết (đường dẫn, mã trạng thái, thời gian). Hai cái này
         * thêm vào đó hai span con nói về việc mở socket và tra tên miền —
         * đúng, nhưng chưa lần nào là câu trả lời cho "vì sao chậm".
         */
        '@opentelemetry/instrumentation-net': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },

        /*
         * `/health` KHÔNG vào vết gọi.
         *
         * Docker healthcheck gọi nó 30 giây một lần, mãi mãi. Để nguyên thì
         * phần lớn vết gọi trong SigNoz là mấy cú thăm dò đó, và biểu đồ p95
         * của "toàn hệ thống" bị kéo xuống bởi một đường dẫn chỉ trả về một
         * dòng JSON — tức là một con số đẹp mà sai.
         */
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => (req.url ?? '').startsWith('/health'),
        },
      }),
    ],
  });

  sdk.start();
}

/**
 * Xả nốt span còn trong bộ đệm rồi mới cho tiến trình thoát.
 *
 * Bộ xuất gom span theo lô và gửi mỗi vài giây. Thoát ngang là mất lô cuối —
 * mà lô cuối chính là phần thú vị nhất khi đi tìm nguyên nhân một lần sập.
 *
 * `index.ts` gọi hàm này trong `shutdown()` chứ không tự đăng ký
 * `process.on('SIGTERM')` ở đây: file kia đã có một trình tự tắt máy có thứ tự
 * (ngừng các việc nền → đóng MySQL/Redis/ClickHouse), và thêm một trình
 * nghe nữa ở đây là tạo ra một đường tắt máy thứ hai chạy song song với nó.
 */
export async function dongQuanTrac(): Promise<void> {
  if (sdk === undefined) return;
  await sdk.shutdown();
}
