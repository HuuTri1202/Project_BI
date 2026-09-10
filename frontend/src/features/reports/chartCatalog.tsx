import { CHART_TYPES, CHART_TYPE_HINTS, CHART_TYPE_LABELS, type ChartType } from '@bi/shared';

/**
 * Danh mục loại biểu đồ cho trình dựng — §10.9.
 *
 * ═══ Vì sao thứ tự ở đây, không phải ở `CHART_TYPES` ════════════════════════
 *
 * `CHART_TYPES` bên `shared` là bản sao của một ENUM trong MySQL, nên thứ tự
 * của nó bị khoá cứng theo thứ tự thêm vào lịch sử: ba loại của §10.9 phải nối
 * vào cuối, sau cả `'table'`. Đó là thứ tự ĐÚNG cho database và SAI cho mắt
 * người — nó đặt bảng số liệu vào giữa đám biểu đồ.
 *
 * Bảng dưới đây gom theo cái người dùng đang định làm: so sánh, rồi diễn biến,
 * rồi tỉ trọng, rồi hai chiều, cuối cùng là con số trần.
 *
 * ⚠️ Là một `Record<ChartType, number>` chứ không phải một mảng, và đó là chủ
 * đích: `Record` bắt buộc có đủ MỌI loại, nên thêm loại thứ chín mà quên xếp
 * chỗ cho nó là lỗi biên dịch. Một mảng thì thiếu cũng không ai biết — loại mới
 * chỉ lặng lẽ vắng mặt trong bảng chọn, và người dùng đi tìm một thứ README nói
 * là có.
 */
const CHART_ORDER: Record<ChartType, number> = {
  bar: 1,
  hbar: 2,
  line: 3,
  area: 4,
  pie: 5,
  scatter: 6,
  heatmap: 7,
  table: 8,
};

export interface ChartChoice {
  type: ChartType;
  label: string;
  hint: string;
  icon: React.ReactElement;
}

/**
 * Hình vẽ 24×24, nét chứ không tô.
 *
 * Cùng bộ với các icon còn lại trong ứng dụng (`stroke="currentColor"`,
 * `strokeWidth` 1.6–1.7), nên nút đang chọn chỉ cần đổi màu chữ là icon đổi
 * theo — không phải khai hai phiên bản sáng/tối cho mỗi hình.
 */
function Icon({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const ICONS: Record<ChartType, React.ReactElement> = {
  bar: (
    <Icon>
      <path d="M3 21h18" />
      <path d="M6 21V11M12 21V4M18 21V15" />
    </Icon>
  ),
  hbar: (
    <Icon>
      <path d="M3 3v18" />
      <path d="M3 7h13M3 12h8M3 17h16" />
    </Icon>
  ),
  line: (
    <Icon>
      <path d="M3 3v18h18" />
      <path d="M6 15l4-5 4 3 5-7" />
    </Icon>
  ),
  area: (
    <Icon>
      <path d="M3 3v18h18" />
      <path d="M6 16l4-5 4 3 5-6v9H6z" />
    </Icon>
  ),
  pie: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9h9" />
    </Icon>
  ),
  scatter: (
    <Icon>
      <path d="M3 3v18h18" />
      <circle cx="8" cy="15" r="1.4" />
      <circle cx="12" cy="9" r="1.4" />
      <circle cx="16" cy="13" r="1.4" />
      <circle cx="19" cy="7" r="1.4" />
    </Icon>
  ),
  heatmap: (
    <Icon>
      <rect x="3" y="3" width="18" height="18" rx="1.5" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </Icon>
  ),
  table: (
    <Icon>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 9h18M9 9v11" />
    </Icon>
  ),
};

export const CHART_CHOICES: readonly ChartChoice[] = [...CHART_TYPES]
  .sort((a, b) => CHART_ORDER[a] - CHART_ORDER[b])
  .map((type) => ({
    type,
    label: CHART_TYPE_LABELS[type],
    hint: CHART_TYPE_HINTS[type],
    icon: ICONS[type],
  }));
