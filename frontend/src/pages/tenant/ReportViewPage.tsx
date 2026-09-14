import { useNavigate, useParams } from 'react-router-dom';

import { usePermissions } from '../../auth/usePermissions';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ErrorState, TableSkeleton } from '../../components/ui/states';
import { useReport, useReportCanvasData } from '../../features/datasets/hooks';
import { ReportShell } from '../../features/reports/ReportShell';
import { ReportViewer } from '../../features/reports/ReportViewer';
import { getApiError } from '../../services/apiClient';

/**
 * Trang XEM một báo cáo — §10.13.
 *
 * ═══ Vì sao nó quay lại ═════════════════════════════════════════════════════
 *
 * §10.10 gộp xem và sửa vào một trang, với lý do "bấm tên báo cáo rồi phải bấm
 * thêm một nút nữa mới sửa được là hai bước cho một việc". Lý do đó nhìn từ
 * phía người DỰNG báo cáo, và nó bỏ sót rằng phần lớn lượt mở một báo cáo là để
 * ĐỌC nó — kể cả bởi chính người đã dựng.
 *
 * Người dùng nói thẳng điều đó:
 *
 *     "khi bấm vào báo cáo sẽ hiển thị 1 trang xem tổng quan như này trước,
 *      nhưng với những role có quyền thì sẽ có nút edit"
 *
 * Và cái giá của việc gộp không nhỏ. Mở thẳng vào trình dựng nghĩa là:
 *
 *   - Ba cột công cụ chiếm hơn một phần ba bề ngang, để đọc một biểu đồ.
 *   - Mỗi ô tự hỏi số liệu của mình (`CanvasBoard`) thay vì một request cho cả
 *     trang — mười hai lượt khứ hồi cho một việc chỉ cần một.
 *   - Mọi cú bấm nhầm vào một ô đều SỬA báo cáo, và trang bắt đầu hỏi "chưa lưu,
 *     rời đi chứ?" với người chỉ vừa liếc qua một biểu đồ.
 *
 * ═══ Ranh giới với trình dựng ═══════════════════════════════════════════════
 *
 *   /reports/:id       trang này — mọi vai trò, chỉ đọc
 *   /reports/:id/edit  trình dựng — cần `report:modify` + `datamodel:read`
 *
 * Trang này KHÔNG gác quyền: `report:read` là quyền của mọi vai trò, và nó cũng
 * là quyền duy nhất mà mọi thứ bên trong cần (xem `ReportViewer` — nó cố ý
 * không gọi endpoint nào của mô hình dữ liệu).
 *
 * Nút "Chỉnh sửa" mới là chỗ hỏi quyền, và nó hỏi CẢ HAI ô. Hôm nay chưa vai
 * trò nào có ô này mà thiếu ô kia, nhưng thiếu một ô là trình dựng mở ra rồi
 * mọi request bên trong ăn 403 — tệ hơn hẳn một trang xem chạy được. Chặn thật
 * vẫn ở backend: `authorize('report','modify')` cho mỗi lần ghi.
 */
export default function ReportViewPage(): React.ReactElement {
  const params = useParams();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const id = toId(params['reportId']);
  const report = useReport(id);
  const loaded = report.data;

  /**
   * Số liệu của TRANG ĐẦU, hỏi NGAY — không chờ báo cáo nạp xong (§10.14).
   *
   * ═══ Vì sao lời gọi này nằm ở đây, không nằm trong `ReportViewer` ═══════════
   *
   * `ReportViewer` chỉ render SAU khi báo cáo về, nên mọi truy vấn bên trong nó
   * bắt buộc xếp sau. Đo trên máy phát triển, một báo cáo 12 ô:
   *
   *     GET /reports/:id      xong ở 360ms
   *     GET canvas-data       xong ở 1109ms   (chỉ bắt đầu lúc 360ms)
   *     biểu đồ hiện ra       1289ms
   *
   * Hai request đó KHÔNG phụ thuộc nhau: endpoint số liệu chỉ cần `id`, thứ đã
   * nằm sẵn trên thanh địa chỉ. Nổ cùng lúc thì phần chờ chỉ còn là cái dài hơn
   * trong hai cái, chứ không phải tổng của chúng.
   *
   * `pageId = null` nghĩa là "trang đầu, trang nào cũng được" — backend tự rơi về
   * `pages[0]` khi không nhận được mã trang. Nhờ vậy ta hỏi được TRƯỚC khi biết
   * báo cáo có những trang nào.
   *
   * ⚠️ Báo cáo MỘT biểu đồ (§7.6) sẽ ăn 409 ở đây, và điều đó chấp nhận được:
   * lỗi 4xx không được thử lại (xem `createQueryClient`), không ai đọc kết quả
   * này, và nhánh một biểu đồ có truy vấn riêng của nó. Một request rẻ đổi lấy
   * 360ms cho nhánh phổ biến hơn hẳn.
   */
  useReportCanvasData(id, null);

  const backToList = (): void => void navigate('/reports');

  /*
   * Mọi lối ra sớm vẫn đi qua `ReportShell`.
   *
   * Một `<ErrorState>` trần trên nền trắng toàn màn hình là ngõ cụt thật sự:
   * không sidebar, không nút nào, chỉ còn nút Back của trình duyệt.
   */
  // `/reports/abc` khớp route nhưng không trỏ tới báo cáo nào. Không có chốt
  // này thì `useReport(null)` tắt hẳn và trang đứng ở khung xương mãi mãi.
  if (id === null) {
    return (
      <ReportShell onExit={backToList}>
        <ErrorState message="Đường dẫn không trỏ tới báo cáo nào." />
      </ReportShell>
    );
  }

  if (report.isError) {
    return (
      <ReportShell onExit={backToList}>
        <ErrorState message={getApiError(report.error).message} />
      </ReportShell>
    );
  }

  if (loaded === undefined) {
    return (
      <ReportShell onExit={backToList}>
        <TableSkeleton rows={6} />
      </ReportShell>
    );
  }

  /**
   * Báo cáo dựng trên BỘ DỮ LIỆU không sửa được, kể cả bởi admin.
   *
   * Trình dựng đọc cấu hình dạng ID trường của một mô hình, còn báo cáo §7.6
   * mang cấu hình dạng TÊN CỘT. Đó là một giới hạn thật, nên nói ra bằng một
   * nhãn thay vì chỉ để nút "Chỉnh sửa" vắng mặt không lời giải thích.
   */
  const canEdit = permissions.can('report', 'modify') && permissions.readDataModels;
  const editable = canEdit && loaded.source === 'datamodel';

  return (
    <ReportShell
      onExit={backToList}
      title={
        <p className="truncate px-2 text-base font-bold text-slate-900" title={loaded.name}>
          {loaded.name}
        </p>
      }
      actions={
        editable ? (
          <Button variant="primary" onClick={() => void navigate('edit')}>
            Chỉnh sửa
          </Button>
        ) : canEdit ? (
          <Badge tone="neutral">Dựng trên bộ dữ liệu — chỉ xem</Badge>
        ) : undefined
      }
    >
      {/* KHÔNG `overflow-y-auto` ở đây: `ReportViewer` tự dựng cột cuộn của nó
          để ghim được thanh thẻ trang ở mép dưới. Cuộn ở cả hai tầng thì thanh
          thẻ trôi theo nội dung và mất tác dụng của việc ghim. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <ReportViewer report={loaded} />
      </div>
    </ReportShell>
  );
}

function toId(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
