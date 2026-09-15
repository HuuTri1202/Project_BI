import type { ReportDto, ReportPageDto } from '@bi/shared';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../../../components/ui/Button';
import { getApiError } from '../../../services/apiClient';
import { loiXuat } from '../../../services/danhDauXuat';
import { useReportCanvasData } from '../../datasets/hooks';
import { CanvasView } from '../CanvasView';
import {
  canvasSangPng,
  canvasSangTrangPdf,
  chupVung,
  LoiXuat,
  taiXuong,
  tenTepXuat,
  type ThongTinAnh,
} from './chupBaoCao';
import { taoPdf, type TrangPdf } from './pdfAnh';

/**
 * Nút "Xuất" trên trang xem báo cáo — ảnh PNG hoặc tệp PDF.
 *
 * ═══ Mọi vai trò, không hỏi quyền ═════════════════════════════════════════
 *
 * Xuất là CHỤP LẠI thứ người dùng đang được xem, không lấy thêm con số nào mà
 * họ chưa có: toàn bộ việc chạy trong trình duyệt, trên đúng số liệu mà
 * `report:read` đã trả về. Quyền đó mọi vai trò đều có (admin, creator, viewer),
 * nên nút không có điều kiện nào — và cũng không cần endpoint mới để chặn.
 *
 * ═══ Trang đang xem chụp TỪ MÀN HÌNH, các trang khác dựng NGOÀI màn hình ════
 *
 * Trang đang xem chụp đúng vùng đang hiển thị: người dùng đã lật một biểu đồ
 * tới nhóm thứ 3 thì ảnh cũng ở nhóm thứ 3 — thứ họ bấm "Xuất" là thứ họ thấy.
 *
 * Với "PDF tất cả trang", các trang còn lại được dựng bằng chính `CanvasView`
 * trong một khung đặt ngoài màn hình, cùng bề ngang với khung thật, rồi chụp
 * từng trang một. Cách khác — lật trang thật trên màn hình rồi chụp — làm màn
 * hình nhảy qua lại trước mắt người dùng, và khi lật về thì mọi biểu đồ đã mất
 * nhóm họ đang xem (ô được dựng lại theo mã trang, xem `CanvasView`).
 */

type Kieu = 'png' | 'pdf' | 'pdf-tat-ca';

export function XuatBaoCao({
  report,
  activePageId,
  vungRef,
}: {
  report: ReportDto;
  /** Trang báo cáo đang mở — cùng quy ước với `ReportViewer` (`null` = trang đầu). */
  activePageId: string | null;
  /** Vùng báo cáo đang hiển thị trên màn hình — thứ được chụp cho trang đang xem. */
  vungRef: RefObject<HTMLElement>;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [tienDo, setTienDo] = useState<string | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [ngoai, setNgoai] = useState<{ page: ReportPageDto; rong: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * Người đang chờ khung ngoài màn hình của MỘT trang gắn vào DOM — xem
   * `dungNgoaiManHinh`.
   *
   * Mang theo mã trang: khung của trang trước có thể render thêm một lượt (số
   * liệu của nó vừa về) sau khi đã đặt chờ trang sau, và nếu không so mã thì
   * trang sau nhận nhầm vùng của trang trước — PDF ra hai trang giống hệt nhau.
   */
  const choNgoai = useRef<{ pageId: string; resolve: (el: HTMLElement) => void } | null>(null);
  const conSong = useRef(true);

  useEffect(() => {
    conSong.current = true;
    return () => {
      conSong.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open && loi === null) return;
    const dong = (): void => {
      setOpen(false);
      setLoi(null);
    };
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) dong();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dong();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, loi]);

  const pages = report.canvas?.pages ?? [];
  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0];
  const nhieuTrang = pages.length > 1;

  const thongTin = (page: ReportPageDto | undefined): ThongTinAnh => ({
    tieuDe: report.name,
    phu: [
      nhieuTrang && page !== undefined ? `Trang: ${page.name}` : null,
      `Xuất lúc ${new Date().toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })}`,
    ]
      .filter((p) => p !== null)
      .join(' · '),
  });

  /** Dựng `page` ngoài màn hình và trả về vùng của nó khi đã gắn vào DOM. */
  const dungNgoaiManHinh = (page: ReportPageDto, rong: number): Promise<HTMLElement> =>
    new Promise((resolve) => {
      choNgoai.current = { pageId: page.id, resolve };
      setNgoai({ page, rong });
    });

  const vungDangXem = (): HTMLElement => {
    const vung = vungRef.current;
    if (vung === null) throw new LoiXuat('Báo cáo chưa hiển thị xong, chưa xuất được.');
    return vung;
  };

  const xuat = async (kieu: Kieu): Promise<void> => {
    setOpen(false);
    setLoi(null);
    setTienDo('Đang xuất…');

    try {
      const tenTrang = nhieuTrang ? (activePage?.name ?? null) : null;

      if (kieu === 'png') {
        const { canvas } = await chupVung(vungDangXem(), thongTin(activePage));
        const blob = await canvasSangPng(canvas);
        if (conSong.current) taiXuong(blob, tenTepXuat([report.name, tenTrang], 'png'));
        return;
      }

      if (kieu === 'pdf') {
        const { canvas, rongCss, caoCss } = await chupVung(vungDangXem(), thongTin(activePage));
        const trang = await canvasSangTrangPdf(canvas, rongCss, caoCss);
        if (conSong.current) {
          taiXuong(taoPdf([trang], report.name), tenTepXuat([report.name, tenTrang], 'pdf'));
        }
        return;
      }

      // Bề ngang của khung thật: ô lưới co theo bề ngang, nên dựng hẹp hơn là
      // ra một báo cáo khác với cái người dùng đang nhìn.
      const rong = vungDangXem().clientWidth;
      const trangs: TrangPdf[] = [];
      for (const [i, page] of pages.entries()) {
        setTienDo(`Đang xuất trang ${i + 1}/${pages.length}…`);
        const dangXem = page.id === activePage?.id;
        // Trang đang xem không cần khung ngoài — gỡ khung của trang trước đi
        // thay vì để nó tiếp tục vẽ lại vô ích trong lúc chụp.
        if (dangXem) setNgoai(null);
        const vung = dangXem ? vungDangXem() : await dungNgoaiManHinh(page, rong);
        const { canvas, rongCss, caoCss } = await chupVung(vung, thongTin(page));
        trangs.push(await canvasSangTrangPdf(canvas, rongCss, caoCss));
        canvas.width = 0;
        canvas.height = 0;
        if (!conSong.current) return;
      }
      setNgoai(null);
      taiXuong(taoPdf(trangs, report.name), tenTepXuat([report.name], 'pdf'));
    } catch (e) {
      if (!conSong.current) return;
      setLoi(
        e instanceof LoiXuat
          ? e.message
          : 'Không xuất được báo cáo. Hãy thử lại, hoặc dùng trình duyệt Chrome/Edge bản mới.',
      );
      // Lỗi không phải của ta thì vẫn phải để lại dấu vết cho người sửa.
      if (!(e instanceof LoiXuat)) console.error(e);
    } finally {
      if (conSong.current) {
        setTienDo(null);
        setNgoai(null);
        choNgoai.current = null;
      }
    }
  };

  const dangXuat = tienDo !== null;

  const muc: { kieu: Kieu; nhan: string; goiY: string; icon: string }[] = [
    {
      kieu: 'png',
      nhan: 'Ảnh PNG',
      goiY: nhieuTrang ? 'Trang đang xem' : 'Toàn bộ báo cáo',
      icon: 'M4 16l4.6-4.6a2 2 0 0 1 2.8 0L16 16m-2-2 1.6-1.6a2 2 0 0 1 2.8 0L20 14M14 8h.01M6 20h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z',
    },
    {
      kieu: 'pdf',
      nhan: 'Tệp PDF',
      goiY: nhieuTrang ? 'Trang đang xem' : 'Toàn bộ báo cáo',
      icon: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6m-6 4h6',
    },
    ...(nhieuTrang
      ? [
          {
            kieu: 'pdf-tat-ca' as const,
            nhan: `Tệp PDF — tất cả ${pages.length} trang`,
            goiY: 'Mỗi trang báo cáo là một trang PDF',
            icon: 'M8 7V5a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2h-2M4 9a2 2 0 0 1 2-2h6l4 4v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Z',
          },
        ]
      : []),
  ];

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="secondary"
        onClick={() => {
          setLoi(null);
          setOpen((v) => !v);
        }}
        loading={dangXuat}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {dangXuat ? (
          <span aria-live="polite">{tienDo}</span>
        ) : (
          <>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
            </svg>
            Xuất
          </>
        )}
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
        >
          {muc.map((m) => (
            <button
              key={m.kieu}
              type="button"
              role="menuitem"
              onClick={() => void xuat(m.kieu)}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 h-5 w-5 shrink-0 text-brand-600"
                aria-hidden="true"
              >
                <path d={m.icon} />
              </svg>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-900">{m.nhan}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{m.goiY}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {loi !== null && (
        <div
          role="alert"
          className="absolute right-0 z-40 mt-1.5 w-72 rounded-xl border border-red-200 bg-white p-3 text-sm shadow-lg"
        >
          <p className="font-medium text-red-700">Chưa xuất được báo cáo</p>
          <p className="mt-1 text-slate-600">{loi}</p>
        </div>
      )}

      {ngoai !== null &&
        createPortal(
          /* Ngoài màn hình nhưng VẪN được dàn trang: `display: none` hay
             `visibility: hidden` thì ô đo ra 0×0 và biểu đồ vẽ vào 0×0, còn
             `visibility` thì bị sao chép sang ảnh chụp và ra ảnh trống. */
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              top: 0,
              left: -100_000,
              width: ngoai.rong,
              pointerEvents: 'none',
            }}
          >
            <TrangNgoaiManHinh
              key={ngoai.page.id}
              report={report}
              page={ngoai.page}
              laTrangDau={ngoai.page.id === pages[0]?.id}
              onSan={(el, pageId) => {
                if (choNgoai.current?.pageId !== pageId) return;
                choNgoai.current.resolve(el);
                choNgoai.current = null;
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

function TrangNgoaiManHinh({
  report,
  page,
  laTrangDau,
  onSan,
}: {
  report: ReportDto;
  page: ReportPageDto;
  laTrangDau: boolean;
  onSan: (el: HTMLElement, pageId: string) => void;
}): React.ReactElement {
  /*
   * Trang đầu hỏi bằng `null`, cùng khoá với `ReportViewer` — để trang đã xem
   * rồi thì lấy ngay từ cache, và trang xuất xong thì lần mở sau cũng có sẵn.
   */
  const data = useReportCanvasData(report.id, laTrangDau ? null : page.id);

  return (
    <div
      ref={(el) => {
        if (el !== null) onSan(el, page.id);
      }}
    >
      {data.isError ? (
        <div {...loiXuat(`Trang "${page.name}": ${getApiError(data.error).message}`)} />
      ) : (
        <CanvasView page={page} reportId={report.id} data={data.data} />
      )}
    </div>
  );
}
