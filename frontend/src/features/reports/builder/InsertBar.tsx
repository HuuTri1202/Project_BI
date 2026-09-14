import { Fragment } from 'react';

import { presetOf, type AnnotationPresetKey } from './annotation';

/**
 * Thanh "Chèn" của trình dựng — §10.18.
 *
 * Ba nhóm, xếp theo việc người dựng báo cáo muốn làm: VIẾT (tiêu đề, đoạn giải
 * thích), CHỈ (đường kẻ, mũi tên), GOM (khung nền, vòng khoanh).
 *
 * Nút "Ghi chú" (tờ ghi chú vàng) bị bỏ theo yêu cầu. Nó chỉ là một hộp văn bản
 * có sẵn nền vàng — hộp Văn bản vẫn đặt được đúng màu nền đó ở cột bên phải, và
 * báo cáo cũ có ghi chú vàng vẫn mở ra y nguyên.
 *
 * Nút có cả hình LẪN chữ, không phải một dãy biểu tượng trần. Tám biểu tượng
 * nhỏ đứng cạnh nhau thì "ghi chú" với "văn bản", "khung nền" với "khoanh
 * vùng" chỉ phân biệt được bằng cách rê chuột lên từng cái — và một tính năng
 * phải rê chuột mới biết là có là một tính năng không ai dùng.
 */
const GROUPS: readonly (readonly AnnotationPresetKey[])[] = [
  ['title', 'text'],
  ['hline', 'vline', 'arrow'],
  ['panel', 'circle'],
];

export function InsertBar({
  onInsert,
  disabledReason,
}: {
  onInsert: (key: AnnotationPresetKey) => void;
  /** Có mặt = không chèn thêm được, và đây là câu nói vì sao. */
  disabledReason?: string | undefined;
}): React.ReactElement {
  const disabled = disabledReason !== undefined;

  return (
    <div
      role="toolbar"
      aria-label="Chèn chú thích"
      className="flex flex-wrap items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-1.5 py-1"
    >
      <span className="mr-1 pl-1 text-xs font-semibold text-slate-500">Chèn</span>
      {GROUPS.map((group, i) => (
        <Fragment key={group.join()}>
          {i > 0 && <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-200" />}
          {group.map((key) => {
            const preset = presetOf(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onInsert(key)}
                disabled={disabled}
                title={disabledReason ?? `${preset.label} — ${preset.hint}`}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <PresetIcon preset={key} />
                {preset.label}
              </button>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

function PresetIcon({ preset }: { preset: AnnotationPresetKey }): React.ReactElement {
  const common = {
    viewBox: '0 0 24 24',
    className: 'h-4 w-4 shrink-0',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (preset) {
    case 'title':
      return (
        <svg {...common}>
          <path d="M5 6h14M12 6v13" />
        </svg>
      );
    case 'text':
      return (
        <svg {...common}>
          <path d="M4 6h16M4 11h16M4 16h10" />
        </svg>
      );
    case 'hline':
      return (
        <svg {...common}>
          <path d="M3 12h18" />
        </svg>
      );
    case 'vline':
      return (
        <svg {...common}>
          <path d="M12 3v18" />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...common} stroke="#B91C1C">
          <path d="M5 5l13 13M18 9v9H9" />
        </svg>
      );
    case 'panel':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="3" fill="#F1F5F9" />
        </svg>
      );
    case 'circle':
      return (
        <svg {...common} stroke="#B91C1C">
          <ellipse cx="12" cy="12" rx="9" ry="7" />
        </svg>
      );
  }
}
