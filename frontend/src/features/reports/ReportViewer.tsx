import {
  REPORT_ERROR_CODES,
  type ReportCanvasDataDto,
  type ReportDataDto,
  type ReportDto,
} from '@bi/shared';
import { useEffect, useMemo, useState } from 'react';

import { ErrorState, TableSkeleton } from '../../components/ui/states';
import { dataModelKeys } from '../datamodels/keys';
import { useReportCanvasData, useReportData } from '../datasets/hooks';
import { getApiError } from '../../services/apiClient';
import { readSnapshot, snapshotIdOf, writeSnapshot } from '../../services/querySnapshots';
import { previewConfigOfDto } from './builder/visual';
import { CanvasView } from './CanvasView';
import { PageTabs } from './PageTabs';
import { ReportChart, ReportDataTable } from './ReportChart';

/**
 * Khoá ảnh chụp của MỘT ô — cùng khoá mà trình dựng dùng.
 *
 * Trình dựng hỏi `POST /datamodels/:id/report-preview` cho từng ô; trang này
 * hỏi `GET /reports/:id/canvas-data` cho cả khung. Hai endpoint, một câu hỏi:
 * "gộp thước đo này theo chiều kia trong mô hình đó". Nên hai bên chụp vào
 * CÙNG một chỗ, và ai tính trước thì người sau vẽ ra ngay.
 */
function cellSnapshotId(datamodelId: number, config: Parameters<typeof previewConfigOfDto>[0]) {
  // Trang nhóm 0 — ảnh chụp chỉ tồn tại cho khung hình đầu tiên của một lần mở
  // báo cáo, và một báo cáo mở ra bao giờ cũng ở trang đầu.
  return snapshotIdOf(dataModelKeys.reportPreview(datamodelId, previewConfigOfDto(config), 0));
}

/**
 * Báo cáo ở chế độ CHỈ ĐỌC — phần thân của trang báo cáo toàn màn hình.
 *
 * ═══ Nó từng là cả một trang trong khung dashboard ══════════════════════════
 *
 * Tới bản này có HAI chỗ mở một báo cáo: `/reports/:id` nằm trong sidebar để
 * xem, và `/reports/:id/edit` toàn màn hình để sửa. Người dùng bấm tên báo cáo
 * là vào trang xem, rồi phải bấm thêm một nút nữa mới sửa được — hai bước cho
 * một việc, và hai bố cục khác nhau cho cùng một khung biểu đồ.
 *
 * Giờ chỉ còn MỘT trang. Ai sửa được thì thấy trình dựng, ai không thì thấy
 * đúng component này, trong cùng cái khung toàn màn hình.
 *
 * ═══ Ai rơi vào đây ═════════════════════════════════════════════════════════
 *
 *   viewer                        không có `report:modify`/`datamodel:read`
 *   báo cáo dựng trên BỘ DỮ LIỆU  trình dựng không đọc được cấu hình dạng tên
 *                                 cột, nên trước đây nó chỉ hiện một câu lỗi
 *
 * Trường hợp thứ hai là thứ được lợi nhất: trước bản này, một admin mở báo cáo
 * trên bộ dữ liệu ở trình dựng chỉ nhận được "chưa sửa được nó" và hết. Nay họ
 * xem được nó bình thường.
 *
 * ⚠️ Component này KHÔNG gọi bất kỳ endpoint nào của mô hình dữ liệu. Đó là
 * điều kiện để viewer dùng được: họ không có `datamodel:read`, nên một lần gọi
 * `/datamodels/:id/fields` hay `/report-preview` sẽ trả 403 và làm hỏng cả
 * trang. Số liệu tới từ `GET /reports/:id/canvas-data` và `GET /reports/:id/data`
 * — hai endpoint cố ý chỉ gác `report:read`.
 */
export function ReportViewer({ report }: { report: ReportDto }): React.ReactElement {
  /**
   * Khung nhiều biểu đồ (§10.10) — nhánh này phải hỏi TRƯỚC mọi thứ khác.
   *
   * Một khung cũng có `chartType` khác `null` (backend chép từ ô đầu tiên để
   * mọi thứ viết trước §10.10 vẫn đọc được), nên hỏi `chartType` trước sẽ vẽ
   * đúng MỘT ô rồi dừng — người dùng mất hai biểu đồ còn lại mà không có gì báo.
   */
  const canvas = report.canvas;

  /**
   * Trang báo cáo đang mở — §10.12.
   *
   * `null` = "chưa chọn gì", và nó được suy ra thành trang ĐẦU ngay bên dưới
   * thay vì được một effect gán hộ. Cùng lập luận với `selected` trong trình
   * dựng: một effect gán hộ sẽ tranh chấp với lựa chọn thật của người dùng
   * trong đúng lượt render mà báo cáo vừa nạp xong.
   */
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const pages = canvas?.pages ?? [];
  // `?? pages[0]` cũng là đường lui khi trang đang mở vừa bị người khác xoá.
  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0];

  /**
   * `chartType === null` nghĩa là báo cáo CHƯA được dựng biểu đồ.
   *
   * Đó là trạng thái mọi báo cáo dựng trên BỘ DỮ LIỆU đi qua ngay sau khi wizard
   * tạo ra nó (§7.6) — bình thường, không phải hỏng.
   */
  const chartType = report.chartType;
  const notConfigured = canvas === null && chartType === null;

  /** Trang NHÓM của biểu đồ duy nhất — chỉ nhánh báo cáo một biểu đồ dùng tới. */
  const [groupPage, setGroupPage] = useState(0);

  /**
   * Chỉ hỏi dữ liệu khi báo cáo ĐÃ có biểu đồ.
   *
   * Gọi lúc chưa cấu hình thì backend trả 409 `ReportNotConfigured` — đúng
   * nghiệp vụ, nhưng react-query ghi nó vào trạng thái lỗi và trang hiện một
   * thông báo đỏ cho một tình huống hoàn toàn bình thường.
   */
  const data = useReportData(canvas === null && chartType !== null ? report.id : null, groupPage);

  /**
   * Một request cho cả TRANG ĐANG MỞ — xem route `GET /reports/:id/canvas-data`.
   *
   * Trang ĐẦU cố ý hỏi bằng `null` chứ không bằng mã trang thật, để trùng khoá
   * với lời gọi sớm trong `ReportViewPage` (§10.14). Dùng mã thật ở đây thì hai
   * bên khác khoá, và cái nổ sớm thành ra chỉ hâm nóng một ô cache không ai đọc
   * — mất trắng phần thời gian vừa tiết kiệm được.
   *
   * Chuẩn hoá cả chiều ngược lại: bấm sang trang 2 rồi bấm về trang 1 cũng quy
   * về `null`, nên không sinh thêm một lượt tính cho đúng thứ đã có sẵn.
   */
  const firstPageId = pages[0]?.id;
  const pageKey = activePage !== undefined && activePage.id !== firstPageId ? activePage.id : null;
  const canvasData = useReportCanvasData(canvas !== null ? report.id : null, pageKey);

  const datamodelId = report.datamodelId;

  /**
   * Số liệu lần trước, đọc từ đĩa — để khung có gì vẽ ở khung hình ĐẦU TIÊN.
   *
   * Không có nó thì mở một báo cáo đã lưu là nhìn 12 ô "Đang tải…" trong vài
   * giây, rồi thấy đúng cái khung lần trước. Xem `querySnapshots` để biết vì
   * sao vài giây đó không rút ngắn được ở tầng ứng dụng.
   *
   * Chỉ dựng ô nào CÓ ảnh chụp: một ô mới thêm sẽ tự hiện "Đang tải…" của nó
   * trong lúc phần còn lại của khung đã vẽ xong.
   */
  const saved = useMemo((): ReportCanvasDataDto | undefined => {
    if (activePage === undefined || datamodelId === null) return undefined;

    const visuals = activePage.visuals.flatMap((visual) => {
      const hit = readSnapshot<ReportDataDto>(cellSnapshotId(datamodelId, visual.config));
      return hit === null ? [] : [{ visualId: visual.id, data: hit.data }];
    });

    return visuals.length === 0 ? undefined : { visuals };
  }, [activePage, datamodelId]);

  /**
   * Chụp lại mọi ô vừa tính xong.
   *
   * Trong effect chứ không trong `queryFn`: hàm đó nhận về một mảng theo
   * `visualId` và KHÔNG biết cấu hình của từng ô, mà cấu hình mới là thứ làm nên
   * khoá. Ô lỗi (`data === null`) không được chụp — chụp một ô hỏng là hẹn giờ
   * để lần mở sau vẽ ra một khung trống trông như đã nạp xong.
   */
  useEffect(() => {
    const fresh = canvasData.data;
    if (activePage === undefined || datamodelId === null || fresh === undefined) return;

    const configById = new Map(activePage.visuals.map((v) => [v.id, v.config]));
    for (const cell of fresh.visuals) {
      const config = configById.get(cell.visualId);
      if (config === undefined || cell.data === null) continue;
      writeSnapshot(cellSnapshotId(datamodelId, config), cell.data);
    }
  }, [activePage, datamodelId, canvasData.data]);

  /**
   * Bộ dữ liệu chưa vào kho phân tích — trạng thái bình thường, không phải lỗi.
   */
  const notLoaded =
    data.isError && getApiError(data.error).error === REPORT_ERROR_CODES.DATASET_NOT_LOADED;

  /* ─── Khung nhiều biểu đồ ────────────────────────────────────────────────
     Lỗi của TỪNG ô nằm trong chính ô đó (backend trả `error` riêng cho mỗi ô),
     nên ở đây chỉ còn lỗi của cả request — mất mạng, hoặc báo cáo vừa bị người
     khác xoá. */
  if (canvas !== null && activePage !== undefined) {
    return (
      /* Cột dọc: khung cuộn, thanh thẻ trang GHIM ở mép dưới. Để thanh thẻ nằm
         trong vùng cuộn thì nó trôi mất ngay khi báo cáo dài hơn một màn hình —
         tức là biến mất ở đúng lúc người ta cần nó nhất. */
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {canvasData.isError ? (
            // Lỗi ĐÈ LÊN ảnh chụp, không phải ngược lại: Cube chết mà màn hình
            // vẫn vẽ số của hôm qua là biến một sự cố thành một báo cáo trông
            // bình thường.
            <ErrorState message={getApiError(canvasData.error).message} />
          ) : (
            <CanvasView
              page={activePage}
              reportId={report.id}
              data={canvasData.data ?? saved}
              refreshing={canvasData.data === undefined && saved !== undefined}
            />
          )}
        </div>

        {/* Một trang thì không có gì để chuyển — và một thanh thẻ có đúng một
            thẻ chỉ chiếm chỗ mà không nói thêm điều gì. Mọi báo cáo dựng trước
            §10.12 rơi vào nhánh này, nên chúng trông y hệt như trước. */}
        {pages.length > 1 && (
          <PageTabs pages={pages} activeId={activePage.id} onSelect={setActivePageId} />
        )}
      </div>
    );
  }

  // ─── Báo cáo một biểu đồ ───────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-5xl overflow-y-auto">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        {/* Báo cáo vừa được wizard tạo: chưa có biểu đồ, và đó là trạng thái
            bình thường. Nói rõ bước tiếp theo thay vì để một khung trống. */}
        {notConfigured && <NotConfigured sourceName={report.sourceName} />}

        {!notConfigured && data.isPending && <TableSkeleton rows={4} />}

        {/* Bộ dữ liệu chưa vào kho phân tích — trạng thái BÌNH THƯỜNG kéo dài
            vài giây sau khi tải file lên, không phải sự cố. Hộp đỏ ở đây dạy
            người dùng rằng hệ thống hay hỏng vặt, đúng cái bẫy mà khối
            `notConfigured` ngay trên đã tránh. Hook tự hỏi lại mỗi 3 giây nên
            biểu đồ tự hiện, không cần F5. */}
        {!notConfigured && notLoaded && (
          <p className="py-10 text-center text-sm text-slate-500">
            Đang nạp bộ dữ liệu vào kho phân tích… biểu đồ sẽ tự hiện khi xong.
          </p>
        )}

        {!notConfigured && !notLoaded && data.isError && (
          <ErrorState message={getApiError(data.error).message} />
        )}

        {data.data && chartType !== null && (
          <ReportChart
            chartType={chartType}
            data={data.data}
            options={report.modelConfig?.options}
            onPage={setGroupPage}
          />
        )}
      </section>

      {/* Bảng số liệu chỉ lặp lại khi biểu đồ KHÔNG phải là bảng — `ReportChart`
          đã tự vẽ bảng cho loại đó, và hai bảng giống hệt nhau chồng lên nhau
          đọc ra như một lỗi hiển thị. */}
      {data.data && data.data.rows.length > 0 && chartType !== 'table' && (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Số liệu</h2>
          <ReportDataTable data={data.data} />
        </section>
      )}
    </div>
  );
}

/**
 * Báo cáo chưa có biểu đồ — trạng thái ngay sau khi wizard tạo ra nó (§7.6).
 *
 * Chỉ báo cáo dựng trên BỘ DỮ LIỆU mới đi qua trạng thái này; báo cáo trên mô
 * hình ra đời là đã có biểu đồ (§10.8) và sửa được bằng trình dựng (§10.9).
 *
 * Nói rõ đây là bước tiếp theo chứ không phải lỗi, và nói luôn thứ chưa có.
 */
function NotConfigured({ sourceName }: { sourceName: string }): React.ReactElement {
  return (
    <div className="py-10 text-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mx-auto h-10 w-10 text-slate-300"
        aria-hidden="true"
      >
        <path d="M4 19V5m0 14h16M8 15V11m4 4V9m4 6v-3" />
      </svg>
      <p className="mt-3 text-sm font-medium text-slate-700">Báo cáo chưa có biểu đồ</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
        Bộ dữ liệu <span className="font-medium text-slate-700">{sourceName}</span> đã sẵn sàng
        nhưng chưa chọn cột để vẽ.
      </p>
    </div>
  );
}
