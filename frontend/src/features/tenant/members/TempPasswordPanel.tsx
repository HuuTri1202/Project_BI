import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import type { TempPasswordIssue } from './tempPasswordStore';

interface TempPasswordPanelProps {
  issue: TempPasswordIssue;
  onDismiss: () => void;
}

/**
 * Bảng hiện mật khẩu tạm sau khi Admin tạo tài khoản hoặc cấp lại mật khẩu.
 *
 * CỐ Ý KHÔNG dùng toast tự tắt. Đây là bản sao DUY NHẤT của mật khẩu — backend
 * không lưu lại, không ghi log, và không có đường lấy lại. Một thông báo tự biến
 * mất sau 5 giây là cách chắc chắn nhất để Admin quay đi pha ly nước rồi mất
 * luôn thông tin.
 *
 * Ba lớp giữ nó lại, xếp theo thứ tự mà một lần lỡ tay sẽ gặp:
 *
 *   1. `tempPasswordStore` giữ qua F5 và chuyển trang (sessionStorage, 30 phút)
 *   2. nút đóng chỉ mở sau khi admin tự tay tích vào ô xác nhận
 *   3. nếu vẫn mất — nút "Cấp lại mật khẩu" ở dòng của người đó trong bảng
 *
 * Lớp 3 mới là lối thoát thật. Hai lớp trên chỉ để hiếm khi phải dùng tới nó.
 */
export function TempPasswordPanel({
  issue,
  onDismiss,
}: TempPasswordPanelProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // Luồng 'attached' là gắn một tài khoản đã tồn tại vào tổ chức — họ đã có mật
  // khẩu riêng, ta không đặt lại và cũng không được biết.
  if (issue.kind === 'attached') {
    return (
      <div
        role="status"
        className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800"
      >
        <p>
          <strong>{issue.user.fullName}</strong> đã có tài khoản trên hệ thống và vừa được thêm
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

  const { user, tempPassword } = issue;
  const isReset = issue.kind === 'reset';

  const copy = (): void => {
    void navigator.clipboard
      .writeText(tempPassword)
      .then(() => {
        setCopyFailed(false);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // `navigator.clipboard` chỉ tồn tại trong ngữ cảnh bảo mật, và người
        // dùng có thể từ chối quyền. Nuốt im lặng ở đây là để admin tưởng đã
        // chép được rồi dán ra một chuỗi rỗng — hỏng đúng thứ tính năng này sinh
        // ra để cứu. Nói ra, và chỉ đường chép tay.
        setCopyFailed(true);
      });
  };

  return (
    <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
      <h2 className="text-sm font-semibold text-amber-900">
        {isReset ? 'Mật khẩu tạm MỚI cho ' : 'Mật khẩu tạm cho '}
        {user.fullName}
      </h2>
      <p className="mt-1 text-sm text-amber-800">
        Chỉ hiện <strong>một lần</strong>. Gửi cho họ ngay — hệ thống không lưu lại và không có
        cách xem lại. Họ sẽ bị buộc đổi mật khẩu ở lần đăng nhập đầu tiên.
      </p>
      {isReset && (
        <p className="mt-1 text-sm text-amber-800">
          Mật khẩu cũ của người này đã <strong>hết hiệu lực</strong> ngay khi bảng này hiện ra.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-base tracking-wide text-slate-900 select-all">
          {tempPassword}
        </code>
        <Button size="sm" onClick={copy}>
          {copied ? 'Đã sao chép' : 'Sao chép'}
        </Button>
        <span className="text-sm text-amber-700">·</span>
        <span className="text-sm text-amber-800">{user.email}</span>
      </div>

      {copyFailed && (
        <p className="mt-2 text-sm text-amber-900">
          Trình duyệt không cho sao chép tự động. Hãy bôi đen mật khẩu ở trên rồi chép tay —
          bấm một lần vào ô đó là chọn được cả chuỗi.
        </p>
      )}

      {/* Nút đóng khoá cho tới khi admin tự tích xác nhận. Đây chính là cái bẫy
          cũ: nút đóng nằm sẵn đó, bấm một phát là mất vĩnh viễn, và câu chữ trên
          nút thì tự nhận hộ người dùng rằng "tôi đã lưu mật khẩu này". Giờ họ
          phải tự nói câu đó trước.

          Cố ý KHÔNG mở khoá nút này khi bấm "Sao chép": chép vào clipboard không
          chứng minh được là đã gửi đi, mà clipboard thì lần dán sau là mất. */}
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-amber-900">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="h-4 w-4 rounded border-amber-400"
        />
        Tôi đã gửi mật khẩu này cho {user.fullName}
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" disabled={!acknowledged} onClick={onDismiss}>
          Đóng
        </Button>
        <span className="text-xs text-amber-700">
          Bảng này còn đây kể cả khi bạn tải lại trang hoặc mở mục khác. Lỡ mất thì bấm
          <strong> Cấp lại mật khẩu</strong> ở dòng của người này.
        </span>
      </div>
    </div>
  );
}
