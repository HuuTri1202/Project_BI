import { APP_NAME, type BaoCaoChiaSeDto } from '@bi/shared';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { CanvasView } from '../features/reports/CanvasView';
import { docBaoCaoChiaSe } from '../features/reports/share/api';
import { getApiError } from '../services/apiClient';

/**
 * Trang xem báo cáo bằng LIÊN KẾT — mong muốn D5.
 *
 * ═══ Người đọc trang này là ai ═════════════════════════════════════════════
 *
 * Một kế toán hoặc một chủ đầu tư, không có tài khoản, mở một đường dẫn ai đó
 * gửi qua Zalo. Họ không biết "workspace" là gì và sẽ không đăng nhập. Nên trang
 * này không có sidebar, không có thanh điều hướng, không có nút nào dẫn vào
 * phần phải đăng nhập — chỉ có tên tổ chức, tên báo cáo, mốc cập nhật, và các
 * biểu đồ.
 *
 * ═══ Vì sao nó dùng CHÍNH `CanvasView` ═════════════════════════════════════
 *
 * Người gửi liên kết phải biết người nhận đang thấy cái gì. Một bản vẽ thứ hai
 * cho "trang công khai" là hai bố cục sẽ lệch nhau, và cái lệch đó không ai
 * thấy được từ phía người gửi. `congKhai` tắt đúng một thứ: hai nút lật trang
 * nhóm, vì chúng gọi một route có xác thực.
 *
 * ═══ Không có react-query ở đây ════════════════════════════════════════════
 *
 * `QueryClientProvider` nằm ở `main.tsx` nên hook vẫn chạy được, nhưng trang này
 * cố ý chỉ gọi MỘT lần bằng `useEffect`: không có cache nào để dùng lại (mỗi
 * người xem mở đúng một lần), không có invalidate nào, và không có phiên nào để
 * đồng bộ. Thêm một lớp cache cho một lời gọi duy nhất là thêm một chỗ để sai.
 */
export default function XemChiaSePage(): React.ReactElement {
  const { chuoi } = useParams<{ chuoi: string }>();
  const [query] = useSearchParams();
  const trang = query.get('trang') ?? undefined;

  const [data, setData] = useState<BaoCaoChiaSeDto | null>(null);
  const [loi, setLoi] = useState<string | null>(null);

  useEffect(() => {
    if (chuoi === undefined) return;
    let huy = false;

    void docBaoCaoChiaSe(chuoi, trang).then(
      (kq) => {
        if (!huy) setData(kq);
      },
      (err: unknown) => {
        // Câu chữ của máy chủ đi thẳng ra: nó đã phân biệt "không tồn tại",
        // "đã thu hồi" và "đã hết hạn", và ba chuyện đó dẫn tới ba việc khác
        // nhau cho người đọc.
        if (!huy) setLoi(getApiError(err).message);
      },
    );
    return () => {
      huy = true;
    };
  }, [chuoi, trang]);

  if (loi !== null) {
    return (
      <Khung>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <h1 className="text-lg font-semibold text-slate-900">Không mở được báo cáo</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">{loi}</p>
          {/* KHÔNG có nút "Đăng nhập": người đọc trang này không có tài khoản,
              và mời họ đăng nhập là mời vào một con đường không dẫn tới đâu. */}
          <p className="mt-4 text-xs text-slate-400">
            Hãy liên hệ người đã gửi liên kết này cho bạn.
          </p>
        </div>
      </Khung>
    );
  }

  if (data === null) {
    return (
      <Khung>
        <p className="text-center text-sm text-slate-500">Đang mở báo cáo…</p>
      </Khung>
    );
  }

  const trangHienTai = data.canvas.pages.find((p) => p.id === data.pageId) ?? data.canvas.pages[0];

  return (
    <Khung>
      <header className="mb-4">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {data.tenantName}
        </p>
        <h1 className="mt-0.5 text-xl font-bold text-slate-900">{data.name}</h1>
        <p className="mt-1 text-xs text-slate-500">
          Số liệu đọc lúc bạn mở trang · báo cáo cập nhật lần cuối{' '}
          {new Date(data.updatedAt).toLocaleString('vi-VN')}
        </p>
      </header>

      {/*
       * Nhiều trang thì hiện thẻ chọn — bằng LIÊN KẾT, không bằng state.
       *
       * `<a>` chứ không phải `<button>`: mỗi trang có một đường dẫn riêng
       * (`?trang=`), nên người xem chia sẻ lại được đúng trang họ đang đọc, và
       * nút Back của trình duyệt làm đúng việc của nó.
       */}
      {data.canvas.pages.length > 1 && (
        <nav className="mb-3 flex flex-wrap gap-1" aria-label="Trang báo cáo">
          {data.canvas.pages.map((p) => (
            <a
              key={p.id}
              href={`?trang=${encodeURIComponent(p.id)}`}
              aria-current={p.id === data.pageId ? 'page' : undefined}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                p.id === data.pageId
                  ? 'border-brand-300 text-brand-800 bg-brand-50 font-medium'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {p.name}
            </a>
          ))}
        </nav>
      )}

      {trangHienTai !== undefined && (
        <CanvasView
          page={trangHienTai}
          /*
           * `reportId` không dùng tới khi `congKhai`: nó chỉ nuôi hook lật trang
           * nhóm, mà hook đó bị tắt. Truyền 0 thay vì nới kiểu thành `number |
           * null` — nới kiểu là bắt mọi nơi gọi khác phải nghĩ về một giá trị
           * không bao giờ xảy ra ở chúng.
           */
          reportId={0}
          data={data.soLieu}
          congKhai
        />
      )}

      <footer className="mt-6 text-center text-xs text-slate-400">
        Báo cáo được chia sẻ từ {APP_NAME}. Người gửi có thể thu hồi liên kết này bất cứ lúc nào.
      </footer>
    </Khung>
  );
}

/** Khung ngoài dùng chung cho cả ba trạng thái — đang mở, lỗi, và đã có số liệu. */
function Khung({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-5xl">{children}</div>
    </main>
  );
}
