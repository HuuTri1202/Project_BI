import { CONNECTION_KIND_LABELS, type SourceTableDto, type SyncResultDto } from '@bi/shared';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { SelectField } from '../../../components/ui/Field';
import { Modal } from '../../../components/ui/Modal';
import { getApiError } from '../../../services/apiClient';
import { useConnections, useSourceTables, useSyncTables } from '../hooks';

/**
 * Hộp thoại Đồng bộ các bảng từ CSDL — §8.6, §8.8.
 *
 * ─── Vì sao có bước chọn bảng, không phải một nút chạy thẳng ────────────────
 *
 * Một CSDL sản xuất thật thường có vài trăm bảng, trong đó phần lớn là bảng
 * trung gian, bảng log và bảng của framework. Đổ hết vào kho là biến Kho dữ liệu
 * thành bãi rác ngay lần bấm đầu tiên, và người dùng sẽ phải tự xoá từng cái.
 *
 * ─── Cơ chế "nhớ lựa chọn" ──────────────────────────────────────────────────
 *
 * Bảng đã có trong kho được backend đánh dấu `imported`, và ta tích sẵn đúng
 * những cái đó. Nên lần đồng bộ thứ hai chỉ cần bấm xác nhận — không cần cột nào
 * lưu lựa chọn, vì chính kho dữ liệu đã là bản ghi nhớ.
 */
export function SyncTablesModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const { data: connections } = useConnections();
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<SyncResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tables = useSourceTables(open ? connectionId : null);
  const sync = useSyncTables();

  // Mở hộp thoại -> chọn sẵn kết nối đầu tiên. Bắt người dùng chọn thủ công khi
  // họ chỉ có một kết nối là thêm một cú bấm không mang thông tin nào.
  useEffect(() => {
    if (!open) return;
    setConnectionId(connections?.[0]?.id ?? null);
    setResult(null);
    setError(null);
    setSearch('');
  }, [open, connections]);

  // Tích sẵn những bảng ĐÃ nhập mỗi khi danh sách về. Đây là toàn bộ cơ chế nhớ
  // lựa chọn giữa hai lần đồng bộ.
  useEffect(() => {
    if (!tables.data) return;
    setSelected(new Set(tables.data.filter((t) => t.imported).map(key)));
  }, [tables.data]);

  const selectedConnection = connections?.find((c) => c.id === connectionId) ?? null;

  /** Danh sách có bảng từ nhiều database không — quyết định có hiện tiền tố. */
  const multiSchema = useMemo(
    () => new Set((tables.data ?? []).map((t) => t.schema)).size > 1,
    [tables.data],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tables.data ?? [];
    // Tìm cả trong tên database: khi kết nối mở ra mọi database, "tìm bảng của
    // qr_ordering" là cách lọc tự nhiên nhất mà người dùng sẽ thử đầu tiên.
    return (tables.data ?? []).filter(
      (t) => t.table.toLowerCase().includes(q) || t.schema.toLowerCase().includes(q),
    );
  }, [tables.data, search]);

  function toggle(table: SourceTableDto): void {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = key(table);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  /** Chọn / bỏ chọn tất cả trong PHẠM VI ĐANG LỌC, không phải toàn bộ danh sách. */
  function toggleAll(): void {
    const visible = filtered.map(key);
    const allOn = visible.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      // Bấm "chọn tất cả" khi đang lọc mà lại tích cả những bảng không nhìn thấy
      // là làm một việc người dùng không nhìn thấy — kiểu bất ngờ tệ nhất trong
      // một hộp thoại sắp ghi dữ liệu.
      for (const k of visible) {
        if (allOn) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  function run(): void {
    if (connectionId === null) return;
    setError(null);
    sync.mutate(
      {
        id: connectionId,
        tables: [...selected].map((k) => {
          const [schema = '', table = ''] = splitKey(k);
          return { schema, table };
        }),
      },
      { onSuccess: setResult, onError: (err) => setError(getApiError(err).message) },
    );
  }

  const allVisibleOn = filtered.length > 0 && filtered.every((t) => selected.has(key(t)));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Đồng bộ bảng từ CSDL"
      description={result ? 'Kết quả' : 'Chọn những bảng muốn đưa vào Kho dữ liệu'}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Xong
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Huỷ</Button>
            <Button
              variant="primary"
              onClick={run}
              loading={sync.isPending}
              disabled={selected.size === 0 || connectionId === null}
            >
              Đồng bộ {selected.size > 0 ? `${selected.size} bảng` : ''}
            </Button>
          </>
        )
      }
    >
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      {result ? (
        <SyncSummary result={result} />
      ) : (
        <div className="space-y-4">
          <SelectField
            label="Kết nối"
            options={(connections ?? []).map((c) => ({
              value: String(c.id),
              label: `${c.name} · ${CONNECTION_KIND_LABELS[c.kind]}`,
            }))}
            value={connectionId === null ? '' : String(connectionId)}
            onChange={(e) => setConnectionId(Number(e.target.value))}
          />

          {connections?.length === 0 && (
            <p className="text-sm text-slate-500">
              Chưa có kết nối nào. Thêm một kết nối ở <strong>Quản lý tổ chức → Kết nối</strong>{' '}
              trước.
            </p>
          )}

          {tables.isError && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
            >
              {getApiError(tables.error).message}
            </p>
          )}

          {tables.isFetching && <p className="text-sm text-slate-500">Đang đọc danh sách bảng…</p>}

          {tables.data && tables.data.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm bảng…"
                  aria-label="Tìm bảng"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
                />
                <Button size="sm" onClick={toggleAll}>
                  {allVisibleOn ? 'Bỏ chọn' : 'Chọn tất cả'}
                </Button>
              </div>

              {/* Cuộn trong khung thay vì để hộp thoại dài vô tận: 300 bảng thì
                  nút xác nhận nằm ngoài màn hình và không ai tới được nó. */}
              <ul className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                {filtered.map((table) => (
                  <li key={key(table)} className="border-b border-slate-100 last:border-0">
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selected.has(key(table))}
                        onChange={() => toggle(table)}
                      />
                      <span className="flex-1 text-sm text-slate-800">
                        {/* Tên database chỉ hiện khi danh sách TRẢI NHIỀU nơi.
                            Kết nối đã thu hẹp vào một database thì lặp lại tên
                            đó ở cả trăm dòng là nhiễu thuần tuý; còn khi chọn
                            "tất cả" thì hai bảng `orders` ở hai database trông y
                            hệt nhau, và tích nhầm là đồng bộ nhầm nguồn. */}
                        {multiSchema && (
                          <span className="text-slate-400">{table.schema}.</span>
                        )}
                        {table.table}
                      </span>
                      {table.imported && <Badge tone="neutral">Đã có</Badge>}
                    </label>
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className="px-3 py-6 text-center text-sm text-slate-500">
                    Không có bảng nào khớp “{search}”.
                  </li>
                )}
              </ul>
            </>
          )}

          {/* Câu này phải GỌI TÊN database, và đó không phải chuyện chữ nghĩa.
              Nguyên nhân thường gặp nhất của danh sách rỗng là chọn nhầm CSDL
              lúc tạo kết nối — ClickHouse mặc định là `default`, và `default`
              thì rỗng trong gần như mọi cài đặt. Câu cũ chỉ nói "tài khoản kết
              nối đọc được", tức là chỉ thẳng người dùng sang phía phân quyền và
              để họ đi tìm một vấn đề không tồn tại. Nêu đúng tên CSDL và tên tài
              khoản thì cả hai giả thuyết đều tự kiểm được ngay tại chỗ. */}
          {tables.data?.length === 0 && selectedConnection && (
            <p className="text-sm text-slate-500">
              Tài khoản <strong>{selectedConnection.username}</strong> không thấy bảng nào{' '}
              {selectedConnection.databaseName === '' ? (
                // Đã mở ra mọi database mà vẫn rỗng thì tên CSDL không còn là
                // nghi phạm nữa — chỉ còn quyền. Nói đúng một giả thuyết còn lại
                // thay vì lặp lại cả hai.
                <>
                  trong <strong>bất kỳ database nào</strong> trên máy chủ này. Tài khoản cần quyền{' '}
                  <code>SELECT</code> trên các bảng muốn lấy.
                </>
              ) : (
                <>
                  trong CSDL <strong>{selectedConnection.databaseName}</strong>. Kiểm tra xem đã
                  chọn đúng CSDL chưa (sửa ở <strong>Quản lý tổ chức → Kết nối</strong>), hoặc tài
                  khoản này còn thiếu quyền <code>SELECT</code>.
                </>
              )}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Bảng tổng kết sau khi chạy — §8.8. */
function SyncSummary({ result }: { result: SyncResultDto }): React.ReactElement {
  const groups = [
    { label: 'Thêm mới', items: result.added, tone: 'success' as const },
    { label: 'Cập nhật', items: result.updated, tone: 'brand' as const },
    { label: 'Không đổi', items: result.unchanged, tone: 'neutral' as const },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {groups.map((group) => (
          <Badge key={group.label} tone={group.tone}>
            {group.label}: {group.items.length}
          </Badge>
        ))}
        {result.failed.length > 0 && <Badge tone="danger">Lỗi: {result.failed.length}</Badge>}
      </div>

      {result.failed.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3">
          <p className="text-sm font-medium text-red-800">Những bảng không đồng bộ được</p>
          <ul className="mt-1.5 space-y-1">
            {result.failed.map((f) => (
              <li key={f.table} className="text-sm text-red-700">
                <code className="text-xs">{f.table}</code> — {f.reason}
              </li>
            ))}
          </ul>
          {/* Nói rõ hậu quả: người dùng thấy chữ "lỗi" sẽ lo mất dữ liệu cũ. */}
          <p className="mt-2 text-xs text-red-600">
            Những tập dữ liệu đã có trong kho vẫn còn nguyên — hệ thống không bao giờ xoá chúng vì
            một lần quét không thấy bảng.
          </p>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.label}>
          <p className="text-sm font-medium text-slate-700">{group.label}</p>
          <p className="mt-1 text-sm text-slate-500">{group.items.join(', ')}</p>
        </div>
      ))}
    </div>
  );
}

const SEP = '\u0000';

function key(table: { schema: string; table: string }): string {
  return `${table.schema}${SEP}${table.table}`;
}

/**
 * Tách khoá ghép.
 *
 * Ngăn cách bằng ký tự NUL chứ không phải dấu chấm: tên bảng và tên schema hoàn
 * toàn có thể chứa dấu chấm, và khi đó `split('.')` sẽ tách sai chỗ rồi gửi lên
 * server một cặp (schema, table) không tồn tại. NUL không xuất hiện trong định
 * danh của bất kỳ CSDL nào.
 */
function splitKey(k: string): [string, string] {
  const i = k.indexOf(SEP);
  return [k.slice(0, i), k.slice(i + 1)];
}
