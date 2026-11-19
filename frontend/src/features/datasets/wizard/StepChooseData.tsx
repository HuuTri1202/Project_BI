import type { AnalyzeResultDto, CanhBaoCotDto, SheetPreviewDto } from '@bi/shared';
import { useMemo, useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { khoaQuyUoc } from './quyUocCot';
import { Button } from '../../../components/ui/Button';

/**
 * Bước 2 — chọn dữ liệu cần nhập (§7.5).
 *
 * ─── Mỗi sheet được tích là MỘT bộ dữ liệu riêng ────────────────────────────
 *
 * Đây là điều khiến màn hình này không phải một ô chọn sheet thông thường:
 * người dùng đang chọn sẽ sinh ra bao nhiêu bộ dữ liệu, chứ không phải đang xem
 * sheet nào. Nhãn nút ở chân wizard nói rõ con số đó.
 *
 * ─── Hai vai trò tách bạch của một dòng ─────────────────────────────────────
 *
 *   Ô tích      quyết định sheet có được NHẬP không.
 *   Bấm tên     chỉ mở bảng XEM TRƯỚC ở dưới, không đổi lựa chọn.
 *
 * Gộp hai việc vào một cú bấm thì xem thử một sheet là vô tình tích nó, và
 * người dùng không có cách nào xem mà không chọn.
 */

interface Props {
  analysis: AnalyzeResultDto;
  selected: string[];
  onChange: (sheets: string[]) => void;
  /** Gộp các nhóm chỉ khác chữ hoa/thường — vá A2. */
  gopHoaThuong: boolean;
  onGopChange: (gop: boolean) => void;
  /**
   * Những cột người dùng đã chốt là "dấu chấm là phân cách nghìn" — mong muốn
   * D2. Khoá là tên sheet + ordinal, vì mỗi sheet có bảng cột riêng.
   */
  quyUocVn: ReadonlySet<string>;
  onQuyUocChange: (khoa: string, laVn: boolean) => void;
}


export function StepChooseData({
  analysis,
  selected,
  onChange,
  gopHoaThuong,
  onGopChange,
  quyUocVn,
  onQuyUocChange,
}: Props): React.ReactElement {
  const [search, setSearch] = useState('');
  const [focused, setFocused] = useState(analysis.sheets[0]?.name ?? '');

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term === '') return analysis.sheets;
    return analysis.sheets.filter((s) => s.name.toLowerCase().includes(term));
  }, [analysis.sheets, search]);

  const preview = analysis.sheets.find((s) => s.name === focused) ?? visible[0];

  function toggle(name: string): void {
    onChange(
      selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name],
    );
  }

  /**
   * "Chọn tất cả" chỉ tác động lên những sheet ĐANG HIỆN.
   *
   * Đang lọc còn 3 sheet mà bấm rồi tích luôn 40 sheet khuất là một bất ngờ khó
   * chịu, và người dùng sẽ không nhận ra cho tới khi thấy 40 bộ dữ liệu.
   */
  function toggleVisible(check: boolean): void {
    const names = visible.map((s) => s.name);
    onChange(
      check
        ? [...new Set([...selected, ...names])]
        : selected.filter((s) => !names.includes(s)),
    );
  }

  const allVisibleChecked =
    visible.length > 0 && visible.every((s) => selected.includes(s.name));

  /*
   * Ô tích gộp đọc TOÀN BỘ các sheet, không chỉ sheet đang xem trước: cờ gửi
   * lên là cờ của cả lần nhập, nên hỏi theo từng sheet sẽ hứa một thứ mà API
   * không làm được.
   */
  const coNhomTrung = analysis.sheets.some((s) =>
    s.canhBao.some((c) => c.loai === 'hoa-thuong'),
  );

  return (
    <div>
      {analysis.truncated && (
        // Cắt âm thầm rồi để người ta tin vào một biểu đồ thiếu phần lớn dữ liệu
        // là kiểu sai tệ nhất trong sản phẩm BI. Nói ngay từ đây.
        <p className="mb-4 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
          File có nhiều hơn {analysis.maxRows.toLocaleString('vi-VN')} dòng. Hệ thống chỉ nhập{' '}
          {analysis.maxRows.toLocaleString('vi-VN')} dòng đầu của mỗi sheet.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        <div className="min-w-0">
          <label htmlFor="sheet-search" className="mb-1.5 block text-sm font-medium text-slate-700">
            Tìm sheet
          </label>
          <input
            id="sheet-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tên sheet…"
            className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />

          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {selected.length}/{analysis.sheets.length} sheet được chọn
            </span>
            {visible.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => toggleVisible(!allVisibleChecked)}>
                {allVisibleChecked ? 'Bỏ chọn' : 'Chọn tất cả'}
              </Button>
            )}
          </div>

          <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1.5">
            {visible.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-slate-500">
                Không có sheet nào khớp “{search}”.
              </li>
            )}

            {visible.map((sheet) => {
              const checked = selected.includes(sheet.name);
              const isFocused = preview?.name === sheet.name;

              return (
                <li key={sheet.name}>
                  <div
                    className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                      isFocused ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      id={`sheet-${sheet.name}`}
                      checked={checked}
                      onChange={() => toggle(sheet.name)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <label htmlFor={`sheet-${sheet.name}`} className="sr-only">
                      Nhập sheet {sheet.name}
                    </label>
                    <button
                      type="button"
                      onClick={() => setFocused(sheet.name)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {sheet.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {sheet.columns.length} cột · {sheet.rowCount.toLocaleString('vi-VN')} dòng
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="min-w-0">
          {preview ? (
            <SheetPreview
              sheet={preview}
              previewRowLimit={analysis.previewRowLimit}
              quyUocVn={quyUocVn}
              onQuyUocChange={onQuyUocChange}
            />
          ) : (
            <p className="text-sm text-slate-500">Chọn một sheet để xem trước.</p>
          )}
        </div>
      </div>

      {coNhomTrung && (
        /*
         * Ô tích này là chỗ người dùng CHO PHÉP biến đổi dữ liệu, nên nó chỉ
         * xuất hiện khi hệ thống đã thật sự tìm thấy nhóm trùng, và luôn đứng
         * cạnh câu nói rõ sẽ gộp cái gì. Một ô tích "làm sạch dữ liệu" hiện
         * thường trực thì không ai biết nó sẽ làm gì với tệp của mình.
         */
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
          <label className="flex items-start gap-2.5 text-sm text-amber-900">
            <input
              type="checkbox"
              checked={gopHoaThuong}
              onChange={(e) => onGopChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-300 text-brand-600 focus:ring-brand-500"
            />
            <span>
              <span className="font-medium">
                Gộp các nhóm chỉ khác nhau chữ hoa/thường khi nhập
              </span>
              <span className="mt-0.5 block text-amber-800">
                Áp dụng cho mọi sheet được chọn. Cách viết xuất hiện nhiều nhất được giữ làm
                nhãn, nên biểu đồ vẫn hiện đúng chữ trong tệp của bạn. Bỏ tích nếu cột của bạn
                phân biệt chữ hoa thường (mã hàng, mã phiếu).
              </span>
            </span>
          </label>
        </div>
      )}

      {selected.length === 0 && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          Hãy tích ít nhất một sheet để nhập.
        </p>
      )}
    </div>
  );
}

/**
 * Cảnh báo chất lượng dữ liệu của một sheet — vá A2 và C3.
 *
 * ⚠️ Hai lỗi đã đo khi dùng hệ thống như người thật, và cả hai đều IM LẶNG
 * tuyệt đối trước bản vá này:
 *
 *   · biểu đồ "doanh thu theo khu vực" hiện 5 cột cho 3 khu vực, vì `MIỀN NAM`
 *     và `Miền Nam` là hai nhóm riêng — tệp bán hàng thật luôn có kiểu này;
 *   · một ô `750.000` vào kho thành `750`, và bảng xem trước vẫn hiện nguyên
 *     văn `750.000` nên không có cách nào phát hiện bằng mắt.
 *
 * Ví dụ luôn lấy từ CHÍNH tệp của người dùng. Một câu cảnh báo chung chung
 * ("dữ liệu có thể không nhất quán") thì không ai đi tìm được chỗ nào.
 */
function CanhBaoChatLuong({
  canhBao,
  sheet,
  quyUocVn,
  onQuyUocChange,
}: {
  canhBao: readonly CanhBaoCotDto[];
  sheet: string;
  quyUocVn: ReadonlySet<string>;
  onQuyUocChange: (khoa: string, laVn: boolean) => void;
}): React.ReactElement {
  return (
    <ul
      role="status"
      className="mb-2 space-y-1.5 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800"
    >
      {canhBao.map((c) => {
        const khoa = khoaQuyUoc(sheet, c.columnIndex);
        const laVn = quyUocVn.has(khoa);

        return (
          <li key={`${String(c.columnIndex)}-${c.loai}`}>
            {c.loai === 'so-mo-ho' && laVn ? cauDaChonVn(c) : cauCanhBao(c)}

            {/*
             * Ô tích CỦA TỪNG CỘT — mong muốn D2.
             *
             * Chỉ hiện ở cột `so-mo-ho`, tức đúng những cột hệ thống vừa nói ra
             * rằng nó không phân xử được. Ở đó người cầm tệp biết rõ hơn mọi quy
             * tắc, mà trước bản này họ không có cách nào nói ra ngoài việc sửa
             * tệp rồi tải lại.
             *
             * Hai con số trong nhãn đều do BACKEND tính bằng `parseNumber`
             * (`docThanh` / `docThanhKhiVn`), nên xem trước không bao giờ nói
             * khác thứ sẽ được ghi vào kho.
             */}
            {c.loai === 'so-mo-ho' && (
              <label className="mt-1 flex items-start gap-2 text-amber-900">
                <input
                  type="checkbox"
                  checked={laVn}
                  onChange={(e) => onQuyUocChange(khoa, e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-300 text-brand-600 focus:ring-brand-500"
                />
                <span>
                  Trong cột này, dấu chấm là <strong>phân cách nghìn</strong> — đọc{' '}
                  {nhayKep(c.viDu.slice(0, 1))} thành {c.docThanhKhiVn ?? ''}
                </span>
              </label>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Câu khi người dùng ĐÃ chốt kiểu Việt — nói con số mới, không nhắc lại lo ngại cũ. */
function cauDaChonVn(c: CanhBaoCotDto): string {
  const ten = c.sourceName === '' ? 'Cột ' + String(c.columnIndex + 1) : c.sourceName;
  const so = c.docThanhKhiVn ?? '';
  return 'Cột ' + nhayKep([ten]) + ': ô ' + nhayKep(c.viDu) + ' sẽ vào hệ thống thành ' + so + ' theo lựa chọn của bạn.';
}

const nhayKep = (viDu: readonly string[]): string => viDu.map((v) => `“${v}”`).join(', ');

function cauCanhBao(c: CanhBaoCotDto): string {
  const ten = c.sourceName === '' ? `Cột ${String(c.columnIndex + 1)}` : c.sourceName;
  if (c.loai === 'hoa-thuong') {
    return `Cột “${ten}” có ${String(c.soNhom ?? 0)} nhóm chỉ khác nhau chữ hoa/thường hoặc khoảng trắng: ${nhayKep(c.viDu)}. Không gộp thì biểu đồ vẽ chúng thành những cột riêng.`;
  }
  if (c.loai === 'gan-giong') {
    /*
     * Loại này CHỈ cảnh báo — ô tích gộp không chạm tới nó, và câu chữ phải nói
     * rõ việc cần làm là sửa trong tệp.
     *
     * Bỏ dấu là phép biến đổi MẤT thông tin: "Miền" với "Miên", "Hoà" với
     * "Hóa" có thể là hai thứ khác nhau thật, nên hệ thống không có cơ sở nào
     * để chọn hộ một dạng.
     */
    return `Cột “${ten}” có ${String(c.soNhom ?? 0)} cặp giá trị chỉ khác nhau ở DẤU: ${nhayKep(c.viDu)}. Nếu là cùng một thứ, hãy sửa cho thống nhất trong tệp rồi tải lại — hệ thống không tự gộp, vì bỏ dấu thì “Miền” và “Miên” thành một.`;
  }
  return `Cột “${ten}” có ô ${nhayKep(c.viDu)} sẽ vào hệ thống thành ${c.docThanh ?? ''} — dấu chấm ở đây được hiểu là dấu thập phân. Nếu bạn muốn nó là ${c.viDu[0] ?? ''} thì hãy viết một giá trị không thể hiểu lẫn trong cột, ví dụ 1.250.000, rồi tải lại.`;
}

function SheetPreview({
  sheet,
  previewRowLimit,
  quyUocVn,
  onQuyUocChange,
}: {
  sheet: SheetPreviewDto;
  previewRowLimit: number;
  quyUocVn: ReadonlySet<string>;
  onQuyUocChange: (khoa: string, laVn: boolean) => void;
}): React.ReactElement {
  const shown = Math.min(sheet.previewRows.length, previewRowLimit);

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{sheet.name}</h3>
        {/* Dòng tóm tắt của §7.5. Câu "đang xem N dòng đầu" là phần bắt buộc:
            không có nó, người dùng thấy 100 dòng rồi tin rằng hệ thống chỉ nhập
            chừng đó, trong khi thực tế nhập tới 50.000. */}
        <p className="text-xs text-slate-500">
          {sheet.columns.length} cột · {sheet.rowCount.toLocaleString('vi-VN')} dòng · đang xem{' '}
          {shown.toLocaleString('vi-VN')} dòng đầu
        </p>
      </div>

      {sheet.canhBao.length > 0 && (
        <CanhBaoChatLuong
          canhBao={sheet.canhBao}
          sheet={sheet.name}
          quyUocVn={quyUocVn}
          onQuyUocChange={onQuyUocChange}
        />
      )}

      <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left">
            <tr className="border-b border-slate-200">
              {sheet.columns.map((column) => (
                <th
                  key={column.columnIndex}
                  scope="col"
                  className="px-3 py-2 whitespace-nowrap"
                >
                  <span className="block font-medium text-slate-700">
                    {column.sourceName || `Cột ${column.columnIndex + 1}`}
                  </span>
                  <span className="mt-0.5 block">
                    <Badge tone="neutral">{TYPE_LABELS[column.semanticType]}</Badge>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sheet.previewRows.slice(0, previewRowLimit).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {sheet.columns.map((column) => (
                  <td
                    key={column.columnIndex}
                    className="max-w-[16rem] truncate px-3 py-1.5 text-slate-600"
                  >
                    {row[column.columnIndex] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TYPE_LABELS: Record<string, string> = {
  text: 'Chữ',
  number: 'Số',
  date: 'Ngày',
  boolean: 'Đúng/Sai',
};
