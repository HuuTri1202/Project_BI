import { CHUNG, chungHint, type FolderDto } from '@bi/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FolderRail } from '../src/features/folders/FolderRail';
import { CHUA_BIET, MoveToFolderDialog } from '../src/features/folders/MoveToFolderDialog';

/**
 * Thư mục Kho dữ liệu — §7.9.
 *
 * ═══ Ca này canh gì ═════════════════════════════════════════════════════════
 *
 * Cột thư mục và hộp "Chuyển tới thư mục" giờ là MỘT bản dựng dùng chung cho cả
 * tab Báo cáo lẫn tab Kho dữ liệu. Phần luật chung đã có `thuMucBaoCao.test.tsx`
 * canh; bộ này canh đúng cái mà việc dùng chung đẻ ra:
 *
 *   1. DANH TỪ có thật sự đi xuyên xuống không. Quên một chỗ thì tab Kho dữ liệu
 *      đọc lên là "3 báo cáo" cho một thư mục chứa ba bộ dữ liệu — sai, và im
 *      lặng: mắt thường không thấy gì vì con số vẫn đúng.
 *   2. Hộp chuyển thư mục KHÔNG còn biết gì về báo cáo. Nó nhận một `muc` phẳng,
 *      nên bộ dữ liệu dùng được mà không phải thêm một nhánh nào.
 *
 * Phần backend (schema, số đếm, cách ly tổ chức) có bộ tích hợp riêng chạy trên
 * MySQL thật: `datasetFolders.integration`.
 */

const THU_MUC: FolderDto[] = [
  { id: 21, workspaceId: 1, name: 'Bán hàng', itemCount: 3, createdAt: '', updatedAt: '' },
  { id: 22, workspaceId: 1, name: 'Nhân sự', itemCount: 0, createdAt: '', updatedAt: '' },
];

const DANH_TU = 'bộ dữ liệu';

function veCot(dang: number | null = null, onChon = vi.fn()): { onChon: typeof onChon } {
  render(
    <FolderRail
      danhTu={DANH_TU}
      folders={THU_MUC}
      chungCount={5}
      dang={dang}
      onChon={onChon}
      canEdit
      onThemMoi={vi.fn()}
      onDoiTen={vi.fn()}
      onXoa={vi.fn()}
    />,
  );
  return { onChon };
}

describe('Cột thư mục gọi đúng tên thứ nó đang xếp', () => {
  it('nhãn vùng là "Thư mục bộ dữ liệu", không phải "Thư mục báo cáo"', () => {
    veCot();
    // Đây là thứ trình đọc màn hình đọc ra khi nhảy vào vùng này. Để nguyên
    // "báo cáo" thì người dùng bàn phím được dẫn tới một cột nói sai về mình.
    expect(screen.getByRole('navigation', { name: `Thư mục ${DANH_TU}` })).toBeTruthy();
  });

  it('con số đọc lên là "3 bộ dữ liệu", không phải một số trần', () => {
    /*
     * Con số KHÔNG được vào trong tên đọc được: trình đọc màn hình sẽ đọc liền
     * "Bán hàng 3", nghe như một thư mục tên "Bán hàng 3". `aria-label` tách nó
     * ra — và phải tách ra bằng ĐÚNG danh từ của tab này.
     */
    veCot();
    const nav = screen.getByRole('navigation', { name: `Thư mục ${DANH_TU}` });
    expect(within(nav).getByLabelText(`3 ${DANH_TU}`)).toBeTruthy();
    expect(within(nav).getByLabelText(`5 ${DANH_TU}`)).toBeTruthy();
    expect(within(nav).queryByLabelText('3 báo cáo')).toBeNull();
  });

  it('câu gợi ý dưới Chung nói về bộ dữ liệu', () => {
    veCot();
    const chung = within(screen.getByRole('navigation', { name: `Thư mục ${DANH_TU}` })).getByRole(
      'button',
      { name: new RegExp(`^${CHUNG}`) },
    );
    expect(chung.getAttribute('title')).toBe(chungHint(DANH_TU));
    expect(chungHint(DANH_TU)).toContain(DANH_TU);
  });

  it('Chung vẫn ghim ở đầu và vẫn là dòng duy nhất không có menu ⋮', () => {
    // Luật chung, nhưng kiểm lại ở đây vì nó là thứ dễ mất nhất khi một
    // component được đem đi dùng chỗ thứ hai.
    veCot();
    const nav = screen.getByRole('navigation', { name: `Thư mục ${DANH_TU}` });
    const ten = within(nav)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim() ?? '')
      .filter((t) => t !== '');

    expect(ten[0]).toContain(CHUNG);
    expect(screen.queryByRole('button', { name: `Thao tác trên thư mục ${CHUNG}` })).toBeNull();
    expect(within(nav).getAllByRole('button', { name: /Thao tác trên thư mục/ })).toHaveLength(2);
  });

  it('bấm Chung báo về `null`, bấm một thư mục báo về mã của nó', () => {
    const { onChon } = veCot(21);
    const nav = screen.getByRole('navigation', { name: `Thư mục ${DANH_TU}` });

    fireEvent.click(within(nav).getByRole('button', { name: new RegExp(`^${CHUNG}`) }));
    expect(onChon).toHaveBeenLastCalledWith(null);

    fireEvent.click(within(nav).getByRole('button', { name: /^Bán hàng/ }));
    expect(onChon).toHaveBeenLastCalledWith(21);
  });
});

describe('Hộp "Chuyển tới thư mục" không biết mình đang chuyển cái gì', () => {
  it('nhận một mục phẳng và tự đánh dấu chỗ nó đang đứng', async () => {
    /*
     * Hộp này từng nhận nguyên một `ReportDto`. Nếu nó còn đọc trường riêng của
     * báo cáo thì bộ dữ liệu truyền vào sẽ hiện "đang ở Chung" cho một bộ nằm
     * trong thư mục — sai mà không có lỗi nào.
     */
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(
      <MoveToFolderDialog
        muc={{ name: 'Đơn hàng 2026', folderId: 21, folderName: 'Bán hàng' }}
        folders={THU_MUC}
        onClose={vi.fn()}
        onMove={onMove}
        loading={false}
      />,
    );

    expect(screen.getByText(/đang ở Bán hàng/)).toBeTruthy();

    // Thư mục ĐANG chứa nó vẫn hiện ra, chỉ bị đánh dấu và không bấm được — bỏ
    // nó đi thì danh sách đổi thứ tự tuỳ mục đang chọn, và người dùng mất luôn
    // câu trả lời cho "nó đang nằm ở đâu?".
    const dangO = screen.getByRole('button', { name: /Bán hàng/ });
    expect(dangO.hasAttribute('disabled')).toBe(true);
    expect(dangO.textContent).toContain('Đang ở đây');

    fireEvent.click(screen.getByRole('button', { name: new RegExp(CHUNG) }));
    expect(onMove).toHaveBeenCalledWith(null);
  });

  it('chuyển CẢ NHÓM thì không mục nào bị đánh dấu, cũng không mục nào bị khoá', async () => {
    /*
     * Ở Kho dữ liệu, lựa chọn sống qua việc đổi thư mục và đổi trang, nên một
     * nhóm đã tích có thể đang nằm rải nhiều chỗ — "đang ở đâu" không có một
     * câu trả lời. Lấy đại thư mục đang mở thì hộp này in ra một điều sai VÀ
     * khoá đúng cái nút người dùng định bấm, để lại một nửa nhóm ở chỗ cũ.
     */
    cleanup();
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(
      <MoveToFolderDialog
        muc={{ name: `4 ${DANH_TU}`, folderId: CHUA_BIET, folderName: null }}
        folders={THU_MUC}
        onClose={vi.fn()}
        onMove={onMove}
        loading={false}
      />,
    );

    expect(screen.queryByText(/đang ở/)).toBeNull();
    expect(screen.queryByText('Đang ở đây')).toBeNull();
    expect(screen.getByText(`Đang chuyển 4 ${DANH_TU}.`)).toBeTruthy();

    // Kể cả Chung — nhóm không chắc đang ở Chung, nên khoá nó là chặn một
    // thao tác hợp lệ.
    for (const nhan of [CHUNG, 'Bán hàng', 'Nhân sự']) {
      const nut = screen.getByRole('button', { name: new RegExp(nhan) });
      expect(nut.hasAttribute('disabled'), nhan).toBe(false);
    }

    fireEvent.click(screen.getByRole('button', { name: /Bán hàng/ }));
    expect(onMove).toHaveBeenCalledWith(21);
  });

  it('chưa có thư mục nào thì chỉ đường tạo, không bỏ người dùng ở một hộp trống', () => {
    cleanup();
    render(
      <MoveToFolderDialog
        muc={{ name: 'Đơn hàng 2026', folderId: null, folderName: null }}
        folders={[]}
        onClose={vi.fn()}
        onMove={vi.fn()}
        loading={false}
      />,
    );
    expect(screen.getByText(/Chưa có thư mục nào/)).toBeTruthy();
  });
});
