import {
  COLUMN_ROLE_HINTS,
  COLUMN_ROLE_LABELS,
  MEASURE_AGG_HINTS,
  MEASURE_AGG_LABELS,
  moTaThuocDo,
  type DataModelDetailDto,
  type ExplorerFieldDto,
  type ExplorerQueryDto,
  type ExplorerSqlDto,
  type MeasureAgg,
  type MeasureFormat,
} from '@bi/shared';
import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../../components/ui/states';
import {
  useExplorerFields,
  useExplorerStatus,
  useQuerySql,
  useRunQuery,
} from '../../../features/datamodels/hooks';
import { getApiError } from '../../../services/apiClient';
import { doLech, type LechDto } from './lechTrungBinh';

/**
 * Tab Explorer — §10.7.
 *
 * Đây là tab DUY NHẤT của §10 phụ thuộc Cube.js. Ba tab kia chỉ đọc MySQL và
 * ClickHouse, nên chúng vẫn chạy bình thường khi Cube tắt — và màn hình báo lỗi
 * ở dưới NÓI RA điều đó, vì "cái gì vẫn dùng được" đáng giá đúng bằng "lệnh nào
 * phải chạy".
 *
 * Trình duyệt không bao giờ thấy một tên cube: nó gửi ID, Express tra trong
 * phạm vi mô hình đã lọc theo tổ chức rồi tự dựng tên. Xem
 * `services/datamodel/explorer.ts`.
 */

/**
 * Định dạng một ô kết quả.
 *
 * ─── Vì sao phải theo VAI TRÒ CỘT, không theo kiểu của giá trị ──────────────
 *
 * Bản đầu hỏi `typeof cell === 'number'`. Sai cả hai chiều:
 *
 *   - ClickHouse trả số qua JSON dưới dạng **chuỗi**, và Cube chuyển thẳng.
 *     Nên `typeof` ra `'string'`, nhánh định dạng không chạy, và người dùng nhận
 *     `301031712.6019382` — vừa không có dấu phân cách, vừa lộ nguyên rác dấu
 *     phẩy động của phép cộng Float64.
 *   - Ngược lại, một CHIỀU mang giá trị số (mã bưu chính, mã sản phẩm) lại bị
 *     chèn dấu phân cách hàng nghìn, biến `10024` thành `10.024` — một mã định
 *     danh bị bẻ thành một con số.
 *
 * `kind` biết chắc điều mà `typeof` chỉ đoán: thước đo là để đọc như số, chiều
 * là để đọc như nhãn.
 *
 * Hai chữ số thập phân là lựa chọn HIỂN THỊ, không phải làm tròn dữ liệu: nó
 * vừa đủ cho tiền, và nó là thứ cắt đuôi `…6019382` vốn chỉ là sai số dấu phẩy
 * động chứ không mang thông tin nào.
 */
function formatCell(
  cell: string | number,
  measure: boolean,
  format: MeasureFormat | undefined,
): React.ReactNode {
  if (!measure) return String(cell);

  const n = typeof cell === 'number' ? cell : Number(cell);
  if (!Number.isFinite(n)) return String(cell);

  // Phần trăm: con số trong kho là TỈ LỆ (0,283). Nhân 100 ở đây là việc của
  // tầng hiển thị — SQL vẫn trả tỉ lệ, nên câu lệnh bạn chép ra chạy tay cũng
  // cho đúng con số đó.
  if (format === 'percent') {
    return (
      <span className="tabular-nums">
        {(n * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} %
      </span>
    );
  }

  return (
    <span className="tabular-nums">{n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}</span>
  );
}

/**
 * Từ khoá SQL — chỉ những từ Cube thật sự sinh ra, không phải cả từ điển.
 *
 * Danh sách hẹp là có chủ đích: mỗi từ thêm vào là một khả năng tô nhầm một tên
 * cột trùng chữ. Tên trong dấu huyền được xử lý riêng ở `highlight` nên
 * `\`Order\`` không bao giờ bị nhận là từ khoá, nhưng một cột không dấu huyền
 * thì vẫn có thể.
 */
const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP', 'BY', 'ORDER', 'LIMIT', 'OFFSET',
  'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'JOIN', 'ON', 'AS',
  'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'ASC', 'DESC', 'HAVING',
  'UNION', 'ALL', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH',
]);

/**
 * Cắt chuỗi thành các mảnh có màu — thay cho một thư viện tô cú pháp.
 *
 * ─── Vì sao cần, khi đã chuyển sang nền sáng ───────────────────────────────
 *
 * Khối đen cũ đọc được là nhờ TƯƠNG PHẢN. Bỏ nó đi mà không bù gì thì còn lại
 * một mảng chữ đơn sắc cùng độ đậm, và mắt không tách được `LEFT JOIN` khỏi tên
 * bảng — đúng thứ người ta mở khối này ra để tìm.
 *
 * Ba tầng, không hơn: **cấu trúc** (từ khoá) màu nhấn, **nội dung** (tên và giá
 * trị) đậm nhất, **dấu câu** mờ đi. Tô bảy màu như trình soạn thảo sẽ thành ồn
 * trong một khối sáu dòng.
 *
 * ⚠️ Phát ra CẢ phần nằm giữa các match, nếu không câu lệnh sẽ mất ký tự — một
 * lỗi rất dễ mắc và rất khó thấy, vì SQL thiếu một dấu ngoặc vẫn trông như SQL.
 */
const TOKEN = /(`[^`]*`)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;

function highlight(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const m of text.matchAll(TOKEN)) {
    const at = m.index;
    // Dấu câu, khoảng trắng, xuống dòng — mọi thứ giữa hai match.
    if (at > last) {
      out.push(
        <span key={key++} className="text-slate-400">
          {text.slice(last, at)}
        </span>,
      );
    }
    last = at + m[0].length;

    const cls =
      m[1] !== undefined || m[2] !== undefined || m[3] !== undefined
        ? 'text-slate-900' // tên trong dấu huyền, hoặc chuỗi
        : m[4] !== undefined
          ? 'text-slate-500' // số
          : SQL_KEYWORDS.has(m[0].toUpperCase())
            ? 'font-semibold text-brand-700' // từ khoá
            : 'text-slate-700'; // hàm và mọi từ còn lại

    out.push(
      <span key={key++} className={cls}>
        {m[0]}
      </span>,
    );
  }

  if (last < text.length) {
    out.push(
      <span key={key++} className="text-slate-400">
        {text.slice(last)}
      </span>,
    );
  }
  return out;
}

/**
 * Khối "câu lệnh Cube sinh ra".
 *
 * ─── Vì sao bày SQL ra cho người dùng xem ──────────────────────────────────
 *
 * Tầng ngữ nghĩa là một hộp đen có chủ đích: chọn hai trường, nhận một con số.
 * Nhưng khi con số trông sai — và nó SẼ trông sai, xem cảnh báo khoá trùng ở
 * tab Schemas — thì hộp đen không còn là tiện lợi mà thành bế tắc. Câu SQL là
 * thứ duy nhất phân biệt được "mô hình khai sai" với "dữ liệu vốn thế".
 *
 * Hiện cả hai tầng vì chúng trả lời hai câu khác nhau: truy vấn Cube cho thấy
 * lựa chọn của bạn được dịch thành gì, còn SQL cho thấy phép NỐI nào thực sự
 * chạy — và phép nối mới là chỗ số bị sai.
 */
function SqlPanel({
  // Chỉ nhận PHẦN ĐỌC của mutation, không nhận cả đối tượng: kiểu đầy đủ mang
  // theo kiểu của biến truyền vào `mutate`, thứ khối này không dùng và cũng
  // không nên biết.
  state,
}: {
  state: { isPending: boolean; isError: boolean; error: unknown; data: ExplorerSqlDto | undefined };
}): React.ReactElement {
  const [tab, setTab] = useState<'sql' | 'cube'>('sql');

  if (state.isPending) {
    return (
      <div className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
        Đang hỏi Cube câu lệnh…
      </div>
    );
  }
  if (state.isError) return <ErrorState message={getApiError(state.error).message} />;
  if (state.data === undefined) return <></>;

  const text = tab === 'sql' ? state.data.sql : state.data.cubeQuery;

  return (
    <div className="shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        {/* Nút gạt dạng phân đoạn, cùng kiểu với các chỗ chọn khác trong sản
            phẩm: nền rãnh `slate-100`, mục đang chọn nổi lên bằng nền trắng. */}
        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
          <PanelTab active={tab === 'sql'} onClick={() => setTab('sql')}>
            SQL gửi xuống ClickHouse
          </PanelTab>
          <PanelTab active={tab === 'cube'} onClick={() => setTab('cube')}>
            Truy vấn Cube
          </PanelTab>
        </div>
        <span className="flex-1" />
        {/* Chép được là điều kiện để câu lệnh này DÙNG được: chỗ dùng nó là
            clickhouse-client, để đối chiếu con số ngoài phạm vi ứng dụng. */}
        <CopyButton text={text} />
      </div>

      {/*
       * Nền SÁNG, không phải khối đen như bản đầu.
       *
       * Cả sản phẩm này chỉ dùng bề mặt sáng — mã ở tab Schemas là `bg-slate-100`,
       * khối lệnh khi Cube tắt là `bg-amber-100`. Một khối đen giữa trang trắng
       * không đọc thành "đây là mã", nó đọc thành "chỗ này thuộc về giao diện
       * khác".
       *
       * Đổi sang nền sáng thì mất luôn độ tương phản vốn giúp phân biệt từ khoá
       * với tên cột, nên phải bù lại bằng SẮC ĐỘ — xem `highlight`.
       */}
      <pre className="max-h-72 overflow-auto border-y border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs leading-relaxed">
        {highlight(text)}
      </pre>

      <div className="space-y-1.5 px-4 py-2.5 text-xs text-slate-500">
        {tab === 'sql' && state.data.params.length > 0 && (
          <p>
            <span className="font-medium text-slate-600">Tham số thay vào dấu ?:</span>{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">
              {JSON.stringify(state.data.params)}
            </code>
          </p>
        )}
        <p>
          Câu lệnh này do Cube sinh từ{' '}
          <strong className="font-medium text-slate-600">quan hệ bạn khai ở tab Relationship</strong>{' '}
          và định nghĩa thước đo ở tab Schemas — lựa chọn ở đây chỉ quyết định phần{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">SELECT</code>. Nếu phép{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">JOIN</code> trông không
          đúng, chỗ sửa là tab Relationship.
        </p>
      </div>
    </div>
  );
}

/**
 * Chép kèm PHẢN HỒI.
 *
 * Bản đầu chép xong không đổi gì trên màn hình, nên người dùng bấm lần hai để
 * chắc — mà lần hai cũng không đổi gì. Một thao tác không để lại dấu vết thì
 * không phân biệt được với một thao tác hỏng.
 */
function CopyButton({ text }: { text: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);

  // Dọn hẹn giờ khi component biến mất (người dùng bấm "Ẩn câu lệnh" ngay sau
  // khi chép) — nếu không React cảnh báo cập nhật state trên cây đã gỡ.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
    >
      {copied ? <span className="text-green-700">Đã chép</span> : 'Chép'}
    </Button>
  );
}

function PanelTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-white text-slate-900 shadow-sm'
          : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  );
}

function FieldGroup({
  title,
  fields,
  selected,
  onToggle,
  emptyHint,
  giaiThich,
  moTa,
  chuThich,
}: {
  title: string;
  fields: ExplorerFieldDto[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  emptyHint: string;
  /** Một câu "nhóm này là gì", cho người chưa từng dùng công cụ BI nào. */
  giaiThich?: string;
  /**
   * Câu "con số này tính từ đâu ra", dựng lại mỗi lần render.
   *
   * Hàm chứ không phải chuỗi dựng sẵn: phép gộp đổi được ngay trên màn hình,
   * nên câu mô tả phải đọc `aggs` ở thời điểm render. Trả `null` cho chiều —
   * chiều không gộp gì cả, thêm một dòng chữ dưới nó chỉ tổ ồn.
   */
  moTa?: (field: ExplorerFieldDto) => string | null;
  chuThich?: string;
}): React.ReactElement {
  // Gom theo bảng: một mô hình bốn bảng cho ra vài chục trường, và một danh
  // sách phẳng thì không tìm được gì.
  const byDataset = new Map<string, ExplorerFieldDto[]>();
  for (const field of fields) {
    const list = byDataset.get(field.datasetName) ?? [];
    list.push(field);
    byDataset.set(field.datasetName, list);
  }

  return (
    <section>
      {/* Khoảng cách dưới tiêu đề do câu giải thích gánh khi nó có mặt — nếu
          không thì hai lề cộng lại và tiêu đề trôi hẳn khỏi danh sách nó đặt tên. */}
      <h3
        className={`text-xs font-semibold tracking-wide text-slate-500 uppercase ${
          giaiThich === undefined ? 'mb-1.5' : ''
        }`}
      >
        {title}
      </h3>
      {giaiThich !== undefined && (
        <p className="mt-0.5 mb-1.5 text-xs leading-snug text-slate-400">{giaiThich}</p>
      )}
      {fields.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyHint}</p>
      ) : (
        <div className="space-y-3">
          {[...byDataset.entries()].map(([datasetName, list]) => (
            <div key={datasetName}>
              <div className="mb-1 text-xs font-medium text-slate-600">{datasetName}</div>
              <ul className="space-y-0.5">
                {list.map((field) => {
                  const mota = moTa?.(field) ?? null;
                  return (
                    <li key={field.id}>
                      {/* `items-start` chứ không `items-center`: ô tích phải
                          thẳng hàng với TÊN, không trôi xuống giữa khối hai
                          dòng khi có câu mô tả. */}
                      <label className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={selected.has(field.id)}
                          onChange={() => onToggle(field.id)}
                          className="mt-1 rounded border-slate-300"
                        />
                        <span className="min-w-0">
                          <span className="block text-slate-700">{field.label}</span>
                          {mota !== null && (
                            <span className="block text-xs leading-snug text-slate-500">{mota}</span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {chuThich !== undefined && fields.length > 0 && (
        <p className="mt-2.5 border-t border-slate-100 px-1.5 pt-2 text-xs leading-snug text-slate-400">
          {chuThich}
        </p>
      )}
    </section>
  );
}

/**
 * Bảng chọn PHÉP TÍNH cho từng thước đo đang chọn — §10.7.
 *
 * ─── Vì sao ở đây chứ không chỉ ở tab Schemas ──────────────────────────────
 *
 * Tab Schemas khai phép gộp cho CẢ MÔ HÌNH: đổi ở đó là đổi cho mọi người, và
 * phải Lưu rồi mới quay lại đây xem được. Nhưng "tổng doanh thu" với "doanh thu
 * trung bình mỗi đơn" là hai CÂU HỎI, không phải hai cấu hình — người ta hỏi cả
 * hai trong cùng một buổi, và có khi hai người hỏi hai kiểu cùng lúc.
 *
 * Nên ở đây là lựa chọn TẠM: chỉ áp cho truy vấn sắp chạy, không ghi vào mô
 * hình. Đóng tab là mất, và đó đúng là điều mong đợi.
 *
 * ─── Vì sao là hàng nút, không phải ô sổ xuống ─────────────────────────────
 *
 * Một ô sổ xuống giấu hết lựa chọn sau một cú bấm, nên người dùng không biết là
 * mình đổi được gì nếu không mở ra thử. Hàng nút bày sẵn TẤT CẢ: nhìn một cái
 * là biết cột này hỏi được những gì.
 *
 * Bản trước gom ba phép hay dùng ra ngoài và giấu phần còn lại sau nút "Thêm".
 * Bỏ đi theo yêu cầu: một nút "Thêm" vẫn là một cú bấm chắn giữa người dùng và
 * thứ họ đang tìm, và nó đánh đổi khả năng nhìn thấy lấy sự gọn gàng — đúng cái
 * đánh đổi mà khối này sinh ra để tránh.
 */
function AggBar({
  field,
  value,
  onPick,
}: {
  field: ExplorerFieldDto;
  value: MeasureAgg | undefined;
  onPick: (agg: MeasureAgg) => void;
}): React.ReactElement {
  // `field.agg` là phép mô hình đang khai — nút đó sáng khi người dùng chưa đổi
  // gì. Không có nó thì hàng nút mở ra không nút nào sáng, trong khi con số trên
  // bảng vẫn đang tính bằng một phép cụ thể mà giao diện không nói ra.
  const current = value ?? field.agg;

  function nut(agg: MeasureAgg): React.ReactElement {
    const on = current === agg;
    return (
      <button
        key={agg}
        type="button"
        // Chú thích gốc của trình duyệt: không cần thư viện, không vướng z-index
        // và đọc được bằng trình đọc màn hình.
        title={MEASURE_AGG_HINTS[agg]}
        aria-pressed={on}
        onClick={() => onPick(agg)}
        className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
          on
            ? 'border-brand-500 bg-brand-50 text-brand-800'
            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
        }`}
      >
        {MEASURE_AGG_LABELS[agg]}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-32 text-sm text-slate-700">{field.label}</span>
      <div role="group" aria-label={`Phép tính của ${field.label}`} className="flex flex-wrap gap-1">
        {(field.availableAggs ?? []).map(nut)}
      </div>
    </div>
  );
}


/**
 * Khối gợi ý khi trung bình lệch xa trung vị.
 *
 * ═══ Vì sao khối này tồn tại ═══════════════════════════════════════════════
 *
 * Trung vị chỉ có giá trị KHI trung bình đang nói dối. Nhưng để biết trung bình
 * đang nói dối thì phải bấm trung vị trước — một vòng luẩn quẩn khiến người
 * dùng chỉ tìm ra nó nếu đã biết trước mình cần gì, tức là đúng nhóm người
 * không cần được chỉ. Hàng nút và chú thích không gỡ được vòng đó: cả hai đều
 * chờ người dùng chủ động hỏi.
 *
 * Khối này gỡ bằng cách đặt hai con số cạnh nhau TRÊN CHÍNH DỮ LIỆU CỦA HỌ.
 * Không ai phải hiểu định nghĩa trung vị để hiểu "trung bình 65,45 nhưng một
 * nửa số dòng dưới 29,94".
 *
 * ─── Và vì sao nó không phiền ──────────────────────────────────────────────
 *
 * Ba điều kiện cùng lúc: đang dùng `avg`, lệch quá `NGUONG_LECH`, và quá nửa số
 * nhóm cùng lệch. Dữ liệu đều thì cả đời không thấy nó lần nào. Bấm "Bỏ qua"
 * thì im cho tới khi người dùng đổi sang bộ thước đo khác — nghĩa là im với câu
 * hỏi họ vừa từ chối, chứ không im vĩnh viễn với mọi câu hỏi về sau.
 */
function CanhBaoLech({
  lech,
  onDoi,
  onBoQua,
}: {
  lech: LechDto;
  onDoi: () => void;
  onBoQua: () => void;
}): React.ReactElement {
  const so = (n: number): React.ReactNode => formatCell(n, true, lech.format);

  return (
    <div
      role="status"
      className="shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
    >
      <h3 className="text-sm font-semibold text-amber-900">Trung bình đang bị kéo lệch</h3>
      <p className="mt-1 text-sm text-amber-900">
        {lech.nhom !== null && (
          <>
            Ở <strong>{lech.nhom}</strong>:{' '}
          </>
        )}
        {lech.label} trung bình <strong>{so(lech.trungBinh)}</strong> — nhưng một nửa số dòng dưới{' '}
        <strong>{so(lech.trungVi)}</strong>.{' '}
        {lech.tongNhom > 1
          ? `${lech.soNhomLech}/${lech.tongNhom} nhóm cũng lệch như vậy.`
          : 'Vài giá trị rất lớn đang kéo con số lên.'}
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <Button onClick={onDoi}>Xem bằng trung vị</Button>
        <button
          type="button"
          onClick={onBoQua}
          className="rounded-lg px-2 py-1 text-sm text-amber-800 underline-offset-2 hover:underline"
        >
          Bỏ qua
        </button>
      </div>
    </div>
  );
}

export default function ExplorerTab(): React.ReactElement {
  const model = useOutletContext<DataModelDetailDto>();

  const status = useExplorerStatus(model.id);
  const fields = useExplorerFields(model.id);
  const run = useRunQuery(model.id);

  const [dimensions, setDimensions] = useState<Set<number>>(new Set());
  const [measures, setMeasures] = useState<Set<number>>(new Set());
  /**
   * Phép tính người dùng chọn tại chỗ, theo id thước đo.
   *
   * Bỏ tích một thước đo KHÔNG xoá mục của nó ở đây: tích lại thì lựa chọn cũ
   * còn nguyên, mà đó là điều người ta mong đợi khi bật tắt vài cột để so. Việc
   * lọc bỏ id không được chọn diễn ra lúc dựng payload.
   */
  const [aggs, setAggs] = useState<Map<number, MeasureAgg>>(new Map());
  const [queryError, setQueryError] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);
  const sql = useQuerySql(model.id);

  /**
   * Truy vấn ĐỐI CHỨNG bằng trung vị — chạy nền, không bao giờ lên bảng.
   *
   * Phải là một `useMutation` thứ hai chứ không dùng lại `run`: kết quả của nó
   * chỉ để so, và ghi đè `run.data` sẽ đổi con số dưới mắt người dùng ngay sau
   * khi họ vừa đọc xong.
   *
   * Chỉ chạy khi truy vấn chính có thước đo đang dùng `avg`, nên phần lớn lượt
   * bấm Chạy không tốn thêm gì.
   */
  const doiChung = useRunQuery(model.id);
  /** Các thước đo đã bị đổi sang trung vị trong lượt đối chứng gần nhất. */
  const [idDoiChung, setIdDoiChung] = useState<ReadonlySet<number>>(new Set());
  /**
   * Bộ thước đo mà người dùng đã bấm "Bỏ qua".
   *
   * Ghi lại BỘ THƯỚC ĐO chứ không phải một cờ đúng/sai: bỏ qua một lần rồi im
   * mãi mãi thì gợi ý này chết ngay lần đầu ai đó thấy phiền, còn hiện lại sau
   * mỗi lần bấm Chạy thì đúng là phiền. Ghi theo bộ thước đo nghĩa là im với
   * câu hỏi họ vừa từ chối, và nói lại khi họ chuyển sang câu hỏi khác.
   */
  const [boQuaLech, setBoQuaLech] = useState<string | null>(null);

  /**
   * Tích hoặc bỏ tích một trường.
   *
   * Tính tập MỚI ra biến trước rồi mới `setState`, thay vì dùng dạng hàm cập
   * nhật: khối xem câu lệnh phải hỏi lại NGAY với lựa chọn vừa đổi, mà dạng hàm
   * cập nhật thì giá trị mới chỉ có ở lần render sau. Câu SQL cũ nằm cạnh một
   * lựa chọn mới còn tệ hơn không hiện gì — nó nói sai một cách rất thuyết phục.
   */
  /**
   * Payload gửi đi — MỘT chỗ duy nhất dựng nó.
   *
   * Chạy truy vấn và xem câu lệnh SQL phải gửi y hệt nhau, nếu không thì câu
   * lệnh hiện ra không phải câu lệnh sẽ chạy. Lỗi đó không báo gì cả, nó chỉ
   * khiến màn "xem câu lệnh" nói sai một cách rất thuyết phục.
   */
  function payload(d: Set<number>, m: Set<number>): ExplorerQueryDto {
    return {
      dimensionIds: [...d],
      measureIds: [...m],
      measureAggs: [...m].flatMap((id) => {
        const agg = aggs.get(id);
        return agg === undefined ? [] : [{ id, agg }];
      }),
    };
  }

  /** Khoá nhận dạng một bộ thước đo, để nhớ người dùng đã bỏ qua câu hỏi nào. */
  function khoaThuocDo(m: Set<number>): string {
    return [...m].sort((a, b) => a - b).join(',');
  }

  /**
   * Chạy lại đúng câu hỏi vừa rồi bằng trung vị, để có cái mà so.
   *
   * Nhận bảng phép gộp qua tham số chứ không đọc từ `aggs`: hàm này được gọi
   * ngay sau một `setAggs`, mà giá trị mới chỉ có ở lần render sau — cùng cái
   * bẫy mà `toggle` và `pickAgg` đã phải né.
   */
  function chayDoiChung(
    p: ExplorerQueryDto,
    m: Set<number>,
    bang: Map<number, MeasureAgg>,
  ): void {
    const dungTrungBinh = (fields.data?.measures ?? []).filter(
      (f) =>
        m.has(f.id) &&
        (bang.get(f.id) ?? f.agg) === 'avg' &&
        (f.availableAggs ?? []).includes('median'),
    );
    if (dungTrungBinh.length === 0) {
      setIdDoiChung(new Set());
      doiChung.reset();
      return;
    }

    const doi = new Set(dungTrungBinh.map((f) => f.id));
    setIdDoiChung(doi);
    doiChung.mutate({
      ...p,
      measureAggs: [...m].flatMap((id) => {
        if (doi.has(id)) return [{ id, agg: 'median' as const }];
        const a = bang.get(id);
        return a === undefined ? [] : [{ id, agg: a }];
      }),
    });
  }

  /** Chạy truy vấn chính, rồi tự đối chứng bằng trung vị nếu có gì để so. */
  function chay(p: ExplorerQueryDto, m: Set<number>, bang: Map<number, MeasureAgg>): void {
    setQueryError(null);
    doiChung.reset();
    run.mutate(p, {
      onError: (err) => setQueryError(getApiError(err).message),
      onSuccess: () => chayDoiChung(p, m, bang),
    });
  }

  function toggle(kind: 'dimension' | 'measure', id: number): void {
    const next = new Set(kind === 'dimension' ? dimensions : measures);
    if (next.has(id)) next.delete(id);
    else next.add(id);

    if (kind === 'dimension') setDimensions(next);
    else setMeasures(next);

    // Lựa chọn vừa đổi thì kết quả đối chứng không còn nói về câu hỏi này nữa.
    // Bảng kết quả cũ vẫn nằm đó cho tới lần Chạy sau, nhưng một lời cảnh báo
    // cũ thì tệ hơn một bảng cũ — nó khẳng định một điều về dữ liệu.
    doiChung.reset();

    if (!showSql) return;

    const d = kind === 'dimension' ? next : dimensions;
    const m = kind === 'measure' ? next : measures;
    if (d.size + m.size === 0) setShowSql(false);
    else sql.mutate(payload(d, m));
  }

  /**
   * Đổi phép tính của một thước đo.
   *
   * Cố ý KHÔNG tự chạy lại truy vấn — cùng lý do `useRunQuery` là mutation chứ
   * không phải query: mỗi lần bấm là một lượt quét ClickHouse, và người dùng
   * hay bấm thử vài phép liền nhau trước khi thật sự muốn xem kết quả.
   *
   * Câu lệnh SQL thì cập nhật ngay nếu khối đó đang mở, vì nó rẻ và vì một câu
   * lệnh cũ nằm cạnh một lựa chọn mới là thứ đọc ra sai.
   */
  function pickAgg(measureId: number, agg: MeasureAgg): void {
    const next = new Map(aggs);
    next.set(measureId, agg);
    setAggs(next);
    doiChung.reset();

    if (!showSql) return;
    sql.mutate({
      dimensionIds: [...dimensions],
      measureIds: [...measures],
      measureAggs: [...measures].flatMap((id) => {
        const a = id === measureId ? agg : next.get(id);
        return a === undefined ? [] : [{ id, agg: a }];
      }),
    });
  }

  /**
   * Nhận lời gợi ý: đổi các thước đo đang lệch sang trung vị rồi chạy lại.
   *
   * Kết quả trung vị thật ra đã nằm sẵn trong `doiChung.data`, nhưng chạy lại
   * vẫn đáng hơn là bê nó sang: `run.data` phải là kết quả của đúng bộ phép mà
   * hàng nút đang hiện, nếu không thì bảng và hàng nút nói hai chuyện khác nhau
   * ngay lúc người dùng vừa được bảo là hãy tin cái bảng.
   */
  function xemBangTrungVi(): void {
    const next = new Map(aggs);
    for (const id of idDoiChung) next.set(id, 'median');
    setAggs(next);

    chay(
      {
        dimensionIds: [...dimensions],
        measureIds: [...measures],
        measureAggs: [...measures].flatMap((id) => {
          const a = next.get(id);
          return a === undefined ? [] : [{ id, agg: a }];
        }),
      },
      measures,
      next,
    );
  }

  // Cube chưa chạy — nói đúng lệnh phải gõ, và nói cả những gì vẫn dùng được.
  // Cùng tiền lệ `pingClickhouse` của §9, vốn tồn tại vì bài học MinIO: khi một
  // service phía sau tắt, thứ người dùng thấy là "Có lỗi không xác định" — một
  // câu không dẫn tới bất kỳ hành động nào.
  if (status.data !== undefined && !status.data.cubeReady) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4" role="alert">
        <h2 className="text-sm font-semibold text-amber-900">
          Chưa kết nối được tới tầng ngữ nghĩa (Cube.js)
        </h2>
        <p className="mt-1.5 text-sm text-amber-900">
          Chạy lệnh sau ở thư mục gốc rồi bấm Thử lại:
        </p>
        <code className="mt-2 block rounded-lg bg-amber-100 px-3 py-2 font-mono text-sm text-amber-900">
          {status.data.command}
        </code>
        <p className="mt-2.5 text-sm text-amber-800">
          Hai tab <strong>Schemas</strong> và <strong>Relationship</strong> vẫn dùng được bình
          thường — chúng không cần Cube.
        </p>
        <div className="mt-3">
          <Button onClick={() => void status.refetch()} loading={status.isFetching}>
            Thử lại
          </Button>
        </div>
      </div>
    );
  }

  if (fields.isError) return <ErrorState message={getApiError(fields.error).message} />;
  if (fields.isPending) return <TableSkeleton rows={6} />;

  const canRun = dimensions.size + measures.size > 0;
  const result = run.data;

  // Thước đo ĐANG CHỌN và đổi được phép. Lọc theo `fields` chứ không theo `aggs`
  // để giữ đúng thứ tự của bộ chọn bên trái — thứ tự bấm thì đổi mỗi lần.
  const doiPhepDuoc = (fields.data?.measures ?? []).filter(
    (m) => measures.has(m.id) && (m.availableAggs?.length ?? 0) > 0,
  );

  // Chỉ so khi CẢ HAI kết quả cùng có mặt, và người dùng chưa bỏ qua đúng bộ
  // thước đo này. `doLech` trả `null` khi không có gì đáng nói — đó là đường
  // thường gặp nhất, và nó im lặng.
  const khoaHienTai = khoaThuocDo(measures);
  const lech =
    result !== undefined && doiChung.data !== undefined && boQuaLech !== khoaHienTai
      ? doLech(result, doiChung.data, idDoiChung)
      : null;

  return (
    <div className="flex h-full min-h-0 gap-5">
      <aside className="w-64 shrink-0 space-y-5 overflow-y-auto border-r border-slate-200 pr-4">
        {/* Nhãn đọc từ `COLUMN_ROLE_LABELS` chứ không viết lại chuỗi ở đây:
            cùng hai từ đó còn hiện ở ô chọn vai trò của tab Schemas và ở hộp
            thoại báo cáo, và ba bản sao sẽ lệch nhau ngay lần sửa đầu tiên. */}
        <FieldGroup
          title={COLUMN_ROLE_LABELS.dimension}
          giaiThich={COLUMN_ROLE_HINTS.dimension}
          fields={fields.data?.dimensions ?? []}
          selected={dimensions}
          onToggle={(id) => toggle('dimension', id)}
          emptyHint="Không có chiều nào. Kiểm vai trò cột ở tab Schemas."
          /*
           * Câu người dựng mô hình viết ở tab Schemas — §8.3.1.
           *
           * Ô `moTa` của nhóm thước đo đã bị PHÉP TÍNH chiếm chỗ, và đó là lựa
           * chọn đúng ở đó: hai dòng "Doanh thu" cạnh nhau mà một cái là tiền
           * một đơn còn cái kia là tổng cả nhóm thì phép tính là thứ phải nói
           * trước. Chiều không có phép tính nào, nên ô đó đang trống — và câu
           * hỏi người dùng mang tới đây ("cột này có gồm hàng trả lại không")
           * chính là câu mô tả trả lời.
           */
          moTa={(field) => field.description}
        />
        {/*
         * Mỗi thước đo mang theo PHÉP TÍNH của nó ngay dưới tên.
         *
         * Thước đo gieo sẵn trùng tên với cột nó gộp, nên nếu không có dòng
         * này thì "Total amount" trong bộ chọn và "Total amount" trong dữ liệu
         * là hai dòng chữ y hệt — một cái là tiền của MỘT đơn, cái kia là tổng
         * tiền của cả nhóm. Xem `MeasureSourceDto`.
         */}
        <FieldGroup
          title={COLUMN_ROLE_LABELS.measure}
          giaiThich={COLUMN_ROLE_HINTS.measure}
          fields={fields.data?.measures ?? []}
          selected={measures}
          onToggle={(id) => toggle('measure', id)}
          emptyHint="Chưa có thước đo nào. Mô hình không có cột số nào để đo."
          moTa={(field) =>
            field.nguon === undefined || field.agg === undefined
              ? null
              : moTaThuocDo(field.nguon, aggs.get(field.id) ?? field.agg, field.datasetName)
          }
          chuThich="Thước đo được tạo sẵn lúc thêm bảng vào mô hình: mỗi cột số một phép gộp, mỗi bảng một phép đếm dòng. Đổi phép cho riêng truy vấn này ở khối Cách tính, hoặc sửa hẳn ở tab Schemas."
        />
      </aside>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={!canRun}
            loading={run.isPending}
            onClick={() => chay(payload(dimensions, measures), measures, aggs)}
          >
            Chạy truy vấn
          </Button>
          {/* Xem câu lệnh KHÔNG đòi phải chạy truy vấn trước: khi một truy vấn
              nặng đang làm bạn nghi ngờ mô hình, thứ cần xem là câu lệnh, và bắt
              chạy nó xong mới được xem là bắt trả giá hai lần. */}
          <Button
            disabled={!canRun}
            loading={sql.isPending}
            onClick={() => {
              if (showSql) {
                setShowSql(false);
                return;
              }
              setShowSql(true);
              sql.mutate(payload(dimensions, measures));
            }}
          >
            {showSql ? 'Ẩn câu lệnh' : 'Xem câu lệnh SQL'}
          </Button>
          <span className="text-sm text-slate-500">
            {dimensions.size} chiều · {measures.size} thước đo
          </span>
        </div>

        {/* Bảng chọn phép tính — chỉ hiện khi có thứ để chọn.
            Thước đo tính toán và thước đo đếm dòng có `availableAggs` rỗng, nên
            một truy vấn chỉ gồm chúng sẽ không thấy khối này thay vì thấy một
            khối trống không giải thích được. */}
        {doiPhepDuoc.length > 0 && (
          <div className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Cách tính
            </h3>
            <div className="space-y-2">
              {doiPhepDuoc.map((field) => (
                <AggBar
                  key={field.id}
                  field={field}
                  value={aggs.get(field.id)}
                  onPick={(agg) => pickAgg(field.id, agg)}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Chỉ áp cho truy vấn này. Muốn đổi cho cả mô hình thì sửa ở tab{' '}
              <strong>Schemas</strong>.
            </p>
          </div>
        )}

        {showSql && <SqlPanel state={sql} />}

        {queryError !== null && <ErrorState message={queryError} />}

        {result === undefined && queryError === null && (
          <EmptyState
            title="Chọn chiều và thước đo rồi bấm Chạy"
            hint="Truy vấn chạy trên ClickHouse qua Cube.js — Cube tự sinh câu SQL và tự nối các bảng theo quan hệ bạn đã khai."
          />
        )}

        {/* Ngay TRÊN bảng, vì nó nói về hai con số cụ thể trong bảng đó. Đặt ở
            đầu trang thì người đọc phải nhớ lời cảnh báo rồi mới cuộn xuống dò. */}
        {lech !== null && (
          <CanhBaoLech
            lech={lech}
            onDoi={xemBangTrungVi}
            onBoQua={() => setBoQuaLech(khoaHienTai)}
          />
        )}

        {result !== undefined && (
          // `flex ... min-h-0` để bảng bên trong nhận đúng chỗ còn lại và tự
          // cuộn, thay vì hộp này cuộn lồng thêm một tầng nữa.
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            {result.truncated && (
              <div className="shrink-0">
                {/* Chạm trần nghĩa là RẤT CÓ THỂ còn dữ liệu. Nói ra chứ không
                    để người dùng tin rằng họ đang nhìn toàn bộ. */}
                <Badge tone="warning">đã cắt bớt — còn dữ liệu chưa lấy hết</Badge>
              </div>
            )}
            <TableWrap fill>
              <THead>
                <Tr>
                  {result.columns.map((column) => (
                    <Th
                      key={`${column.kind}-${column.id}`}
                      align={column.kind === 'measure' ? 'right' : 'left'}
                      // Phép tính đã tạo ra cột này, do backend dựng với phép
                      // THẬT SỰ chạy. Tiêu đề "Total amount" trên một cột tổng
                      // là chỗ dễ đọc thành "tiền của một đơn" nhất.
                      {...(column.mota === undefined ? {} : { title: column.mota })}
                    >
                      {column.label}
                    </Th>
                  ))}
                </Tr>
              </THead>
              <TBody>
                {result.rows.map((row, rowIndex) => (
                  // Chỉ số làm khoá: kết quả tổng hợp không có định danh tự
                  // nhiên nào, và bảng được vẽ lại toàn bộ mỗi lần chạy.
                  <Tr key={rowIndex}>
                    {row.map((cell, cellIndex) => {
                      const column = result.columns[cellIndex];
                      const measure = column?.kind === 'measure';
                      return (
                        <Td key={cellIndex} align={measure ? 'right' : 'left'}>
                          {cell === null ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            formatCell(cell, measure, column?.format)
                          )}
                        </Td>
                      );
                    })}
                  </Tr>
                ))}
              </TBody>
            </TableWrap>
            {result.rows.length === 0 && (
              <p className="shrink-0 text-sm text-slate-500">
                Truy vấn chạy được nhưng không có dòng nào khớp.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
