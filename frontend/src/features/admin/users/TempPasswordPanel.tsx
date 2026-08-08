import type { CreateAdminUserResultDto } from '@bi/shared';
import { useState } from 'react';
import { Button } from '../../../components/ui/Button';

interface TempPasswordPanelProps {
  result: CreateAdminUserResultDto;
  onDismiss: () => void;
}

/**
 * Bảng hiện mật khẩu tạm sau khi Admin tạo tài khoản.
 *
 * CỐ Ý KHÔNG dùng toast tự tắt. Đây là bản sao DUY NHẤT của mật khẩu — backend
 * không lưu lại, không ghi log, và không có đường lấy lại. Một thông báo tự biến
 * mất sau 5 giây là cách chắc chắn nhất để Admin quay đi pha ly nước rồi mất
 * luôn thông tin, và người được tạo tài khoản không đăng nhập được.
 *
 * Vì vậy: bảng nằm yên cho tới khi người dùng tự bấm đóng, và nút đóng ghi rõ
 * hậu quả.
 */
export function TempPasswordPanel({
  result,
  onDismiss,
}: TempPasswordPanelProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  // Luồng 'attached' là gắn một tài khoản đã tồn tại vào tổ chức — họ đã có mật
  // khẩu riêng, ta không đặt lại và cũng không được biết.
  if (result.mode === 'attached' || !result.tempPassword) {
    return (
      <div
        role="status"
        className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800"
      >
        <p>
          <strong>{result.user.fullName}</strong> đã có tài khoản trên hệ thống và vừa được thêm
          vào tổ chức. Họ đăng nhập bằng mật khẩu sẵn có của mình.
        </p>
        <div className="mt-3">
          <Button size="sm" onClick={onDismiss}>
            Đã hiểu
          </Button>
        </div>
      </div>
    );
  }

  const password = result.tempPassword;

  const copy = (): void => {
    void navigator.clipboard.writeText(password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      role="alert"
      className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4"
    >
      <h2 className="text-sm font-semibold text-amber-900">
        Mật khẩu tạm cho {result.user.fullName}
      </h2>
      <p className="mt-1 text-sm text-amber-800">
        Chỉ hiện <strong>một lần</strong>. Gửi cho họ ngay — hệ thống không lưu lại và không có
        cách xem lại. Họ sẽ bị buộc đổi mật khẩu ở lần đăng nhập đầu tiên.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-base tracking-wide text-slate-900 select-all">
          {password}
        </code>
        <Button size="sm" onClick={copy}>
          {copied ? 'Đã sao chép' : 'Sao chép'}
        </Button>
        <span className="text-sm text-amber-700">·</span>
        <span className="text-sm text-amber-800">{result.user.email}</span>
      </div>

      <div className="mt-4">
        <Button size="sm" variant="secondary" onClick={onDismiss}>
          Tôi đã lưu mật khẩu này
        </Button>
      </div>
    </div>
  );
}
