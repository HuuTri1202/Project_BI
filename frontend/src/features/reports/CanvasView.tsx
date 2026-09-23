import type {
  ReportAnnotationDto,
  ReportCanvasDataDto,
  ReportDataDto,
  ReportPageDto,
  ReportVisualDto,
} from '@bi/shared';
import { useState } from 'react';

import { useReportVisualData } from '../datasets/hooks';
import { getApiError } from '../../services/apiClient';
import { DANG_TAI } from '../../services/danhDauXuat';
import { AnnotationView } from './annotations/AnnotationView';
import { CANVAS_LAYER_Z } from './annotations/annotationStyle';
import { CanvasGrid } from './CanvasGrid';
import { cellStyle, rowsNeeded } from './canvasLayout';
import { tieuDeTuSoLieu } from './nhanO';
import { ReportChart } from './ReportChart';

/**
 * MỘT trang của khung, ở chế độ XEM — §10.10, thu hẹp phạm vi ở §10.12.
 *
 * Cùng lưới với trình dựng (`CanvasGrid`), khác đúng ở chỗ không kéo được và
 * không sửa được. Số liệu tới từ MỘT request cho cả trang, chứ không phải mỗi ô
 * một request như bên trình dựng — ở đây mọi ô nạp cùng lúc đúng một lần, nên
 * gộp lại tiết kiệm được n-1 lượt khứ hồi.
 *
 * ⚠️ Ghép số liệu vào ô bằng `visualId`, KHÔNG bằng thứ tự mảng. Backend chạy
 * các ô song song và trả về đúng thứ tự đã nhận, nhưng dựa vào điều đó là dựa
 * vào một chi tiết cài đặt: đổi sang gộp trùng hay bỏ bớt ô hỏng là số liệu của
 * ô này lặng lẽ hiện trong ô kia — biểu đồ đúng hình, sai số.
 *
 * ⚠️ Hai chữ "trang" trong file này là hai thứ khác nhau, và đừng để chúng lẫn:
 * `page` là TRANG BÁO CÁO (một sheet, §10.12), còn `groupPage` là TRANG NHÓM
 * bên trong một biểu đồ (hai cái nút ‹ ›).
 */
export function CanvasView({
  page,
  reportId,
  data,
  refreshing = false,
}: {
  page: ReportPageDto;
  /** Để từng ô tự hỏi trang nhóm tiếp theo của mình — xem `useReportVisualData`. */
  reportId: number;
  /** `undefined` = đang nạp. Từng ô tự hiện trạng thái của mình. */
  data: ReportCanvasDataDto | undefined;
  /**
   * `data` là số liệu LẦN TRƯỚC, lượt tính mới còn đang chạy.
   *
   * Phải nói ra. Số cũ không sai — nó là câu trả lời đúng cho đúng cấu hình
   * này, chỉ tính sớm hơn — nhưng người đọc một biểu đồ cần biết mình đang đọc
   * số của lúc nào trước khi kết luận gì từ nó.
   */
  refreshing?: boolean;
}): React.ReactElement {
  const byId = new Map(data?.visuals.map((v) => [v.visualId, v]) ?? []);

  /*
   * Fragment, KHÔNG bọc thêm một thẻ div.
   *
   * Lưới tự đặt `minHeight` của mình theo số hàng; nhét nó vào một hộp nữa là
   * thêm một chỗ chiều cao có thể bị nuốt, và `CanvasView.test.tsx` đọc thẳng
   * `container.firstElementChild` để kiểm đúng con số đó.
   */
  return (
    <>
      {/* `DANG_TAI` ở đây và ở mọi chỗ "đang…" bên dưới: việc xuất ảnh đợi tới
          khi không còn cái nào — xem `danhDauXuat`. Số lần trước là số đúng
          nhưng cũ, và một tệp PDF gửi đi thì không còn dòng chữ nào nói ra
          điều đó. */}
      {refreshing && (
        <p className="mb-2 text-xs text-slate-400" {...DANG_TAI}>
          Số liệu lần trước — đang cập nhật…
        </p>
      )}
      <CanvasGrid minRows={rowsNeeded([...page.visuals, ...page.annotations])}>
        {page.visuals.map((visual) => {
          const cell = byId.get(visual.id);
          return (
            <ViewCard
              /*
               * Khoá mang cả mã TRANG.
               *
               * Không có nó thì đổi sang trang khác mà ô đầu của hai trang tình
               * cờ cùng vị trí sẽ được React tái sử dụng — và cùng với nó là
               * `groupPage` của ô cũ. Người dùng sang trang mới và thấy nó mở
               * sẵn ở "Trang 4" của một biểu đồ họ chưa từng lật.
               */
              key={`${page.id}:${visual.id}`}
              visual={visual}
              reportId={reportId}
              cell={cell}
              loading={data === undefined}
            />
          );
        })}
        {/* Chú thích sau biểu đồ, trong MỘT danh sách: tầng vẽ do `z-index`
            quyết định (`CANVAS_LAYER_Z`), cùng cách với trình dựng. */}
        {page.annotations.map((a) => (
          <AnnotationCell key={`${page.id}:${a.id}`} annotation={a} />
        ))}
      </CanvasGrid>
    </>
  );
}

/**
 * Một chú thích ở chế độ XEM — §10.18.
 *
 * Đường kẻ và hình KHÔNG nhận chuột (`pointer-events: none`): một vòng khoanh đỏ
 * đặt đè lên biểu đồ là để CHỈ vào con số, không phải để chặn tooltip của chính
 * con số đó. Hộp văn bản thì nhận — người đọc phải bôi đen chép được một câu
 * ghi chú, và một hộp chữ đè lên biểu đồ là lựa chọn người dựng đã nhìn thấy.
 */
function AnnotationCell({ annotation }: { annotation: ReportAnnotationDto }): React.ReactElement {
  return (
    <div
      style={{ ...cellStyle(annotation), zIndex: CANVAS_LAYER_Z[annotation.layer] }}
      className={annotation.kind === 'text' ? undefined : 'pointer-events-none'}
    >
      <AnnotationView annotation={annotation} />
    </div>
  );
}

function ViewCard({
  visual,
  reportId,
  cell,
  loading,
}: {
  visual: ReportVisualDto;
  reportId: number;
  cell: ReportCanvasDataDto['visuals'][number] | undefined;
  loading: boolean;
}): React.ReactElement {
  /**
   * Trang NHÓM của riêng ô này — trạng thái của một lượt xem, không được lưu.
   *
   * Ở đây chứ không ở `CanvasView`: lật trang một ô không có lý do gì bắt mười
   * một ô kia vẽ lại, và một `Map<visualId, page>` ở tầng trên sẽ làm đúng điều
   * đó mỗi lần nó đổi.
   */
  const [groupPage, setGroupPage] = useState(0);

  /*
   * Trang 0 đã nằm trong câu trả lời của cả khung, nên hook này TẮT ở đó
   * (`enabled: page > 0`). Bật nó là hỏi lại đúng thứ vừa nhận về.
   */
  const paged = useReportVisualData(reportId, visual.id, groupPage);

  const rows: ReportDataDto | null = groupPage === 0 ? (cell?.data ?? null) : (paged.data ?? null);
  const error =
    groupPage === 0 ? cell?.error : paged.isError ? getApiError(paged.error).message : undefined;

  /*
   * Tiêu đề tự sinh lấy nhãn từ SỐ LIỆU, không phải từ cấu hình.
   *
   * Cấu hình chỉ có ID; nhãn đọc được ("Doanh thu", "Khu vực") đi kèm câu trả
   * lời của backend. Nên một ô chưa nạp xong và chưa có tên riêng thì CHƯA có
   * gì để gọi nó — và ở đó tiêu đề để TRỐNG.
   *
   * Không điền "Đang tải…" vào chỗ này: thân ô đã nói đúng câu đó rồi, và lặp
   * lại nó ở tiêu đề chỉ làm một ô đang chờ trông như hai ô đang chờ.
   */
  const title = visual.title ?? (rows !== null ? tieuDeTuSoLieu(rows) : '');

  return (
    <section
      style={{ ...cellStyle(visual), zIndex: CANVAS_LAYER_Z.visual }}
      /* Chọn lẻ vài biểu đồ để xuất (§10.23) thì việc chụp phải tìm lại ĐÚNG ô
         này trong DOM. Qua thuộc tính chứ không qua ref: vùng được chụp có thể
         là trang đang hiển thị hoặc một trang dựng ngoài màn hình, và một
         `querySelector` trả lời được cho cả hai — cùng lý do với `danhDauXuat`. */
      data-visual-id={visual.id}
      className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white"
    >
      {/* Header luôn có mặt kể cả khi trống — mất nó thì ô nhảy cao lên một
          nhịp ngay lúc số liệu về, và cả khung giật một cái. */}
      <header className="flex h-[29px] shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-1.5">
        {title !== '' && (
          <h3
            className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700"
            title={title}
          >
            {title}
          </h3>
        )}
        {/* Lật trang nhóm là một vòng tới Cube. Nói ra, nếu không thì một cú bấm
            không thấy gì đổi trong nửa giây đọc ra như một cú bấm trượt. */}
        {paged.isFetching && (
          <span
            className="ml-auto shrink-0 text-[10px] whitespace-nowrap text-slate-400"
            {...DANG_TAI}
          >
            đang tính…
          </span>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-2">
        {loading ? (
          <p
            className="flex h-full items-center justify-center text-xs text-slate-400"
            {...DANG_TAI}
          >
            Đang tải…
          </p>
        ) : cell === undefined ? (
          /* Ô có trong bố cục nhưng không có trong câu trả lời. Không nên xảy
             ra, và nếu xảy ra thì nói thật thay vì để một khung trắng. */
          <p className="flex h-full items-center justify-center px-3 text-center text-xs text-slate-400">
            Không có số liệu trả về cho ô này.
          </p>
        ) : error !== undefined || rows === null ? (
          <p className="flex h-full items-center justify-center px-3 text-center text-xs leading-snug text-red-600">
            {error ?? 'Không đọc được số liệu cho ô này.'}
          </p>
        ) : (
          <div className="h-full">
            {/* `fit`: ô cao đúng `h` hàng lưới, nên biểu đồ phải vẽ vừa vào đó
                thay vì khai chiều cao của riêng nó rồi bị cắt (§10.13). */}
            <ReportChart
              chartType={visual.chartType}
              data={rows}
              options={visual.config.options}
              onPage={setGroupPage}
              fit
            />
          </div>
        )}
      </div>
    </section>
  );
}
