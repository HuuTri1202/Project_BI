import type {
  DataModelDetailDto,
  ExplorerFieldDto,
  ExplorerSqlDto,
  MeasureFormat,
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
}: {
  title: string;
  fields: ExplorerFieldDto[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  emptyHint: string;
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
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {title}
      </h3>
      {fields.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyHint}</p>
      ) : (
        <div className="space-y-3">
          {[...byDataset.entries()].map(([datasetName, list]) => (
            <div key={datasetName}>
              <div className="mb-1 text-xs font-medium text-slate-600">{datasetName}</div>
              <ul className="space-y-0.5">
                {list.map((field) => (
                  <li key={field.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selected.has(field.id)}
                        onChange={() => onToggle(field.id)}
                        className="rounded border-slate-300"
                      />
                      <span className="text-slate-700">{field.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ExplorerTab(): React.ReactElement {
  const model = useOutletContext<DataModelDetailDto>();

  const status = useExplorerStatus(model.id);
  const fields = useExplorerFields(model.id);
  const run = useRunQuery(model.id);

  const [dimensions, setDimensions] = useState<Set<number>>(new Set());
  const [measures, setMeasures] = useState<Set<number>>(new Set());
  const [queryError, setQueryError] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);
  const sql = useQuerySql(model.id);

  /**
   * Tích hoặc bỏ tích một trường.
   *
   * Tính tập MỚI ra biến trước rồi mới `setState`, thay vì dùng dạng hàm cập
   * nhật: khối xem câu lệnh phải hỏi lại NGAY với lựa chọn vừa đổi, mà dạng hàm
   * cập nhật thì giá trị mới chỉ có ở lần render sau. Câu SQL cũ nằm cạnh một
   * lựa chọn mới còn tệ hơn không hiện gì — nó nói sai một cách rất thuyết phục.
   */
  function toggle(kind: 'dimension' | 'measure', id: number): void {
    const next = new Set(kind === 'dimension' ? dimensions : measures);
    if (next.has(id)) next.delete(id);
    else next.add(id);

    if (kind === 'dimension') setDimensions(next);
    else setMeasures(next);

    if (!showSql) return;

    const d = kind === 'dimension' ? next : dimensions;
    const m = kind === 'measure' ? next : measures;
    if (d.size + m.size === 0) setShowSql(false);
    else sql.mutate({ dimensionIds: [...d], measureIds: [...m] });
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

  return (
    <div className="flex h-full min-h-0 gap-5">
      <aside className="w-64 shrink-0 space-y-5 overflow-y-auto border-r border-slate-200 pr-4">
        <FieldGroup
          title="Chiều"
          fields={fields.data?.dimensions ?? []}
          selected={dimensions}
          onToggle={(id) => toggle('dimension', id)}
          emptyHint="Không có chiều nào. Kiểm vai trò cột ở tab Schemas."
        />
        <FieldGroup
          title="Thước đo"
          fields={fields.data?.measures ?? []}
          selected={measures}
          onToggle={(id) => toggle('measure', id)}
          emptyHint="Chưa có thước đo nào. Mô hình không có cột số nào để đo."
        />
      </aside>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={!canRun}
            loading={run.isPending}
            onClick={() => {
              setQueryError(null);
              run.mutate(
                {
                  dimensionIds: [...dimensions],
                  measureIds: [...measures],
                },
                { onError: (err) => setQueryError(getApiError(err).message) },
              );
            }}
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
              sql.mutate({ dimensionIds: [...dimensions], measureIds: [...measures] });
            }}
          >
            {showSql ? 'Ẩn câu lệnh' : 'Xem câu lệnh SQL'}
          </Button>
          <span className="text-sm text-slate-500">
            {dimensions.size} chiều · {measures.size} thước đo
          </span>
        </div>

        {showSql && <SqlPanel state={sql} />}

        {queryError !== null && <ErrorState message={queryError} />}

        {result === undefined && queryError === null && (
          <EmptyState
            title="Chọn chiều và thước đo rồi bấm Chạy"
            hint="Truy vấn chạy trên ClickHouse qua Cube.js — Cube tự sinh câu SQL và tự nối các bảng theo quan hệ bạn đã khai."
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
                    <Th key={`${column.kind}-${column.id}`} align={column.kind === 'measure' ? 'right' : 'left'}>
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
