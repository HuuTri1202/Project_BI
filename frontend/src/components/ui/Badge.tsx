import type { ReactNode } from 'react';

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700',
};

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
}

/**
 * Nhãn trạng thái nhỏ trong bảng.
 *
 * Cố ý KHÔNG dùng riêng màu để truyền tin: mỗi badge luôn có chữ. Khoảng 8% nam
 * giới bị mù màu đỏ-lục, và "chấm đỏ nghĩa là bị khoá" là thứ họ không đọc được.
 */
export function Badge({ tone = 'neutral', children }: BadgeProps): React.ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
