import { useEffect, useRef, useState } from 'react';

/**
 * Nút "Đăng nhập bằng Google" — §1.9.
 *
 * ═══ Vì sao nút do Google vẽ, không phải nút của ta ═════════════════════════
 *
 * Google Identity Services tự render nút vào một thẻ `div` rỗng. Tự vẽ một nút
 * cho hợp giao diện rồi gọi API ngầm là vi phạm điều khoản thương hiệu của
 * Google, và quan trọng hơn: luồng lấy ID token nằm trong iframe của chính
 * Google, nên mật khẩu Google của người dùng không bao giờ đi qua trang này.
 * Đó là cả lý do dùng ID token thay vì tự hỏi mật khẩu.
 *
 * ═══ Không có client ID thì KHÔNG hiện gì ═══════════════════════════════════
 *
 * Cùng khuôn với lớp LLM của khung hỏi đáp: tính năng tắt thì biến mất khỏi
 * giao diện, không để lại một nút bấm vào là báo lỗi. Người tự dựng dự án này
 * mà chưa xin client ID vẫn thấy một trang đăng nhập hoàn chỉnh.
 *
 * ⚠️ `VITE_GOOGLE_CLIENT_ID` bị Vite NHÚNG THẲNG vào bundle — ai mở trang cũng
 * đọc được. Điều đó chấp nhận được vì client ID vốn công khai; thứ bảo vệ hệ
 * thống là backend kiểm `aud` của ID token (xem `services/auth/googleIdentity.ts`).
 * Nhưng cũng chính vì vậy, KHÔNG bao giờ đặt client SECRET của Google ở đây.
 */

const GSI_SRC = 'https://accounts.google.com/gsi/client';

/** Chữ trên nút, do Google dịch sẵn theo `locale`. */
type ChuTrenNut = 'signin_with' | 'signup_with';

interface GsiButtonOptions {
  theme: 'outline';
  size: 'large';
  width: number;
  text: ChuTrenNut;
  locale: 'vi';
  shape: 'rectangular';
}

interface GsiId {
  initialize: (config: {
    client_id: string;
    callback: (res: { credential?: string }) => void;
    cancel_on_tap_outside: boolean;
    auto_select: boolean;
  }) => void;
  renderButton: (parent: HTMLElement, options: GsiButtonOptions) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GsiId } };
  }
}

/**
 * Tải thư viện GSI đúng MỘT lần cho cả vòng đời trang.
 *
 * Giữ lại chính `Promise` chứ không giữ một cờ boolean: hai component cùng gắn
 * trong một nhịp render sẽ cùng chờ một lượt tải, thay vì nhồi hai thẻ
 * `<script>` rồi `initialize` hai lần.
 */
let dangTai: Promise<GsiId> | null = null;

function taiGsi(): Promise<GsiId> {
  dangTai ??= new Promise<GsiId>((resolve, reject) => {
    const san = window.google?.accounts?.id;
    if (san !== undefined) {
      resolve(san);
      return;
    }
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => {
      const id = window.google?.accounts?.id;
      if (id === undefined) {
        reject(new Error('Tải được thư viện Google nhưng không tìm thấy API.'));
        return;
      }
      resolve(id);
    };
    script.onerror = () => {
      // Mạng hỏng, hoặc trình duyệt chặn tên miền của Google. Thất bại ở đây
      // KHÔNG được chặn đường đăng nhập bằng mật khẩu ngay bên trên.
      dangTai = null;
      reject(new Error('Không tải được thư viện đăng nhập của Google.'));
    };
    document.head.appendChild(script);
  });
  return dangTai;
}

interface Props {
  /** Nhận ID token của Google. Ném lỗi thì thông báo hiện ngay dưới nút. */
  onCredential: (credential: string) => Promise<void>;
  disabled?: boolean;
  /**
   * 'signup_with' cho trang đăng ký -> Google vẽ "Đăng ký bằng Google".
   *
   * Nhãn do GOOGLE dịch, không phải chữ của ta: nút nằm trong iframe của họ nên
   * ta không ghi được chữ lên đó, chỉ chọn được một trong các nhãn có sẵn. Nhờ
   * vậy chữ trên nút khớp với việc trang đang làm, thay vì mời người ở trang
   * đăng ký "đăng nhập".
   */
  text?: ChuTrenNut;
}

export function NutGoogle({
  onCredential,
  disabled = false,
  text = 'signin_with',
}: Props): React.JSX.Element | null {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const hopRef = useRef<HTMLDivElement>(null);
  const [loi, setLoi] = useState<string | null>(null);

  /*
   * Callback của GSI được đăng ký MỘT lần lúc `initialize`, nên nó giữ mãi bản
   * `onCredential` của lần render đầu. Dùng ref để luôn gọi bản mới nhất —
   * không có nó thì nút vẫn chạy, nhưng nó gọi một closure cũ và mọi state
   * sau đó đều lệch.
   */
  const choiRef = useRef(onCredential);
  choiRef.current = onCredential;
  const khoaRef = useRef(disabled);
  khoaRef.current = disabled;
  const chuRef = useRef(text);
  chuRef.current = text;

  useEffect(() => {
    if (clientId === undefined || clientId === '') return;
    let huy = false;

    void taiGsi()
      .then((id) => {
        const hop = hopRef.current;
        if (huy || hop === null) return;

        id.initialize({
          client_id: clientId,
          callback: (res) => {
            if (khoaRef.current) return;
            const credential = res.credential;
            if (credential === undefined) {
              setLoi('Google không trả về thông tin đăng nhập. Vui lòng thử lại.');
              return;
            }
            setLoi(null);
            void choiRef.current(credential).catch((err: unknown) => {
              setLoi(
                err instanceof Error ? err.message : 'Đăng nhập bằng Google không thành công.',
              );
            });
          },
          // One Tap tự bật lên giữa trang là thứ người dùng không yêu cầu, và nó
          // che mất form đang gõ. Chỉ dùng đúng cái nút.
          cancel_on_tap_outside: true,
          auto_select: false,
        });

        id.renderButton(hop, {
          theme: 'outline',
          size: 'large',
          width: 320,
          text: chuRef.current,
          locale: 'vi',
          shape: 'rectangular',
        });
      })
      .catch((err: unknown) => {
        if (huy) return;
        setLoi(err instanceof Error ? err.message : 'Không tải được đăng nhập Google.');
      });

    return () => {
      huy = true;
    };
  }, [clientId]);

  // Chưa cấu hình: không hiện gì cả — xem khối chú thích đầu tệp.
  if (clientId === undefined || clientId === '') return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-medium tracking-wide text-slate-400 uppercase">hoặc</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      {/* GSI vẽ nút vào đúng thẻ này. Canh giữa vì nút có bề rộng cố định. */}
      <div ref={hopRef} className="flex justify-center" />

      {loi !== null && (
        <p role="alert" className="text-center text-sm text-red-700">
          {loi}
        </p>
      )}
    </div>
  );
}
