import { APP_NAME } from '@bi/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { FullPageLoader } from '../components/FullPageLoader';
import { xacMinhEmail } from '../features/auth/api';
import { getApiError } from '../services/apiClient';

/**
 * Xác minh email — §1.10, đích của liên kết trong thư đăng ký.
 *
 * ═══ Vì sao trang này xác minh NGAY khi mở, không có nút bấm ════════════════
 *
 * Người dùng đã bấm một lần rồi — chính liên kết trong thư. Bắt họ bấm thêm
 * một nút "Xác nhận xác minh" là hỏi lại một câu họ vừa trả lời.
 *
 * ⚠️ Nhưng điều đó buộc một luật cho `useEffect` dưới đây: nó chỉ được GỌI API
 * đúng một lần cho mỗi vé. Vé là dùng-một-lần, nên lần gọi thứ hai luôn trả 410
 * "đã dùng rồi" — và React StrictMode chạy effect hai lần theo thiết kế
 * (setup → cleanup → setup, cùng một instance). Không chặn thì mọi người xác
 * minh THÀNH CÔNG đều nhìn thấy một màn hình báo lỗi ở bản dev.
 *
 * Cờ `daGoi` là một `useRef`, KHÔNG phải biến trong thân effect: biến trong
 * thân effect được dựng lại ở lần setup thứ hai nên không chặn được gì. Một cờ
 * "đã huỷ" kiểu `conHieuLuc` cũng không đủ — nó chỉ bỏ qua KẾT QUẢ của lần gọi
 * thứ nhất, trong khi lần gọi thứ hai vẫn được phát ra và vẫn đốt vé.
 *
 * ═══ Không tự đăng nhập sau khi xác minh ═══════════════════════════════════
 *
 * Cùng lập luận với trang đăng ký và trang đặt lại mật khẩu: lần đăng nhập đầu
 * tiên là lần duy nhất chứng minh mật khẩu người dùng vừa đặt đúng như họ nghĩ.
 * Và backend cố ý không cấp token ở endpoint này.
 */
type TrangThai = 'dang-xac-minh' | 'xong' | 'hong';

export default function VerifyEmailPage(): React.ReactElement {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [trangThai, setTrangThai] = useState<TrangThai>('dang-xac-minh');
  const [loi, setLoi] = useState<string | null>(null);
  const daGoi = useRef(false);

  useEffect(() => {
    if (token === '') {
      setLoi('Liên kết thiếu mã xác minh. Hãy mở lại liên kết trong email.');
      setTrangThai('hong');
      return;
    }
    if (daGoi.current) return;
    daGoi.current = true;

    void xacMinhEmail(token).then(
      () => {
        setTrangThai('xong');
      },
      (err: unknown) => {
        setLoi(getApiError(err).message);
        setTrangThai('hong');
      },
    );
  }, [token]);

  if (trangThai === 'dang-xac-minh') return <FullPageLoader label="Đang xác minh email…" />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <header className="mb-7 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-brand-700">{APP_NAME}</h1>
            <p className="mt-1.5 text-sm text-slate-500">Xác minh email</p>
          </header>

          {trangThai === 'xong' ? (
            <>
              <div
                role="status"
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
              >
                Email đã được xác minh. Bạn có thể đăng nhập ngay bây giờ.
              </div>
              <Link
                to="/login"
                className="mt-6 block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-700"
              >
                Đăng nhập
              </Link>
            </>
          ) : (
            <>
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {loi}
              </div>
              {/*
                Đưa về trang đăng nhập chứ không về một trang "xin liên kết mới"
                riêng: nút gửi lại thư nằm ngay trên trang đăng nhập, đúng chỗ
                người dùng gặp lại vấn đề này. Thêm một trang nữa cho cùng một
                việc là thêm một đường phải bảo trì.
              */}
              <Link
                to="/login"
                className="mt-6 block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-700"
              >
                Về trang đăng nhập
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
