import { CHUNG, folderFilterValue, parseFolderFilter, type ReportFolderDto } from '@bi/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FolderRail } from '../src/features/folders/FolderRail';

/**
 * Thư mục báo cáo — §10.25.
 *
 * ═══ Ca này canh gì ═════════════════════════════════════════════════════════
 *
 * Backend có bộ tích hợp riêng chạy trên MySQL thật (`reportFolders.integration`)
 * cho phần schema. Ở đây là phần chỉ frontend mới sai được, và cả ba đều hỏng
 * ÂM THẦM — không lỗi, không cảnh báo, chỉ là một danh sách sai:
 *
 *   1. "Chung" và "Tất cả" bị gộp làm một. Chung là `folderId === null`, Tất cả
 *      là `undefined`; viết `if (folderId)` ở bất kỳ mắt xích nào trong chuỗi
 *      là bấm vào Chung nhận nguyên cả danh sách. Đây là chỗ hỏng dễ nhất, vì
 *      `null` và `undefined` đều falsy và TypeScript không ngăn được.
 *   2. Bộ lọc không lên URL, nên chép link gửi đồng nghiệp mở ra một chỗ khác.
 *   3. Cột thư mục nuốt mất thư mục RỖNG — đúng thư mục người dùng vừa tạo và
 *      đang đi tìm.
 */

const THU_MUC: ReportFolderDto[] = [
  { id: 11, workspaceId: 1, name: 'Bán hàng', itemCount: 2, createdAt: '', updatedAt: '' },
  { id: 12, workspaceId: 1, name: 'Nhân sự', itemCount: 0, createdAt: '', updatedAt: '' },
];

function ve(
  dang: number | null,
  onChon = vi.fn(),
  onThemMoi = vi.fn(),
  folders: readonly ReportFolderDto[] = THU_MUC,
): { onChon: typeof onChon; onThemMoi: typeof onThemMoi } {
  render(
    <FolderRail
      danhTu="báo cáo"
      folders={folders}
      chungCount={3}
      dang={dang}
      onChon={onChon}
      canEdit
      onThemMoi={onThemMoi}
      onDoiTen={vi.fn()}
      onXoa={vi.fn()}
    />,
  );
  return { onChon, onThemMoi };
}

/** Dòng trong cột thư mục, tìm theo tên đứng đầu. */
const dong = (ten: string | RegExp): HTMLElement =>
  within(screen.getByRole('navigation', { name: 'Thư mục báo cáo' })).getByRole('button', {
    name: typeof ten === 'string' ? new RegExp(`^${ten}`) : ten,
  });

describe('parseFolderFilter — ba trạng thái, không phải hai', () => {
  it('phân biệt "mọi thư mục" với "Chung"', () => {
    // Đây là luật gốc của cả tính năng. Gộp hai dòng này lại là bấm vào Chung
    // mà nhận nguyên danh sách — và không có lỗi nào để lần ra.
    expect(parseFolderFilter(undefined)).toBeUndefined();
    expect(parseFolderFilter('')).toBeUndefined();
    expect(parseFolderFilter('chung')).toBeNull();
    expect(parseFolderFilter('12')).toBe(12);
  });

  it('giá trị rác rơi về "mọi thư mục", không ném lỗi', () => {
    // `?folder=abc` gõ tay hoặc một link cũ bị cắt không được làm trắng cả trang.
    for (const rac of ['abc', '0', '-3', '1.5']) {
      expect(parseFolderFilter(rac), rac).toBeUndefined();
    }
  });

  it('đi vòng tròn: dựng chuỗi rồi đọc lại ra đúng thứ ban đầu', () => {
    // Backend dùng `parseFolderFilter`, frontend dùng `folderFilterValue` — hai
    // đầu của cùng một chuỗi trên URL. Lệch nhau là link chia sẻ mở ra sai chỗ.
    for (const goc of [undefined, null, 42] as const) {
      expect(parseFolderFilter(folderFilterValue(goc)), String(goc)).toBe(goc);
    }
  });
});

describe('FolderRail', () => {
  it('KHÔNG còn dòng "tất cả" — cộng mọi dòng lại đã là tất cả', () => {
    ve(null);
    expect(screen.queryByRole('button', { name: /Tất cả/ })).toBeNull();
  });

  it('bày Chung và từng thư mục, kèm số đếm', () => {
    ve(null);

    expect(dong(CHUNG).textContent).toContain('3');
    // Thư mục RỖNG vẫn phải hiện — nếu không, người vừa tạo nó đi tìm không ra
    // rồi bấm tạo lần nữa, và lần đó đâm vào UNIQUE.
    expect(dong('Nhân sự').textContent).toContain('0');
    expect(dong('Bán hàng').textContent).toContain('2');
  });

  it('Chung được GHIM ở ĐẦU, không xếp theo bảng chữ cái cùng các thư mục', () => {
    /*
     * "Bán hàng" và "Nhân sự" đứng sau Chung dù B < C trong bảng chữ cái. Chung
     * là chỗ hay phải mở nhất; một chỗ hay mở mà mỗi lần lại nằm một vị trí khác
     * — tuỳ tên thư mục người dùng vừa tạo — thì phải đọc lại cả danh sách.
     */
    ve(null);
    const ten = within(screen.getByRole('navigation', { name: 'Thư mục báo cáo' }))
      .getAllByRole('button')
      .map((b) => b.textContent?.trim() ?? '')
      .filter((t) => t !== '');

    expect(ten[0]).toContain(CHUNG);
    expect(ten[1]).toContain('Bán hàng');
  });

  it('bấm Chung báo về `null`, bấm một thư mục báo về mã của nó', () => {
    const { onChon } = ve(11);

    fireEvent.click(dong(CHUNG));
    expect(onChon).toHaveBeenLastCalledWith(null);

    fireEvent.click(dong('Bán hàng'));
    expect(onChon).toHaveBeenLastCalledWith(11);
  });

  it('chỉ MỘT dòng được đánh dấu đang mở, và đúng dòng đó', () => {
    ve(null);
    expect(dong(CHUNG).getAttribute('aria-current')).toBe('true');
    expect(dong('Bán hàng').getAttribute('aria-current')).toBeNull();

    cleanup();
    ve(11);
    // `chon={!dang}` cho dòng Chung — một phản xạ dễ mắc — làm dòng này cũng
    // sáng, và hai dòng cùng sáng thì không đọc được mình đang xem gì.
    expect(dong('Bán hàng').getAttribute('aria-current')).toBe('true');
    expect(dong(CHUNG).getAttribute('aria-current')).toBeNull();
  });

  it('đúng HAI menu ⋮, cho đúng hai thư mục thật', () => {
    ve(null);
    const nav = screen.getByRole('navigation', { name: 'Thư mục báo cáo' });
    const menus = within(nav).getAllByRole('button', { name: /Thao tác trên thư mục/ });
    // Đúng hai cái, cho hai thư mục thật.
    expect(menus).toHaveLength(2);
    expect(menus.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Thao tác trên thư mục Bán hàng',
      'Thao tác trên thư mục Nhân sự',
    ]);
  });

  it('viewer không thấy menu nào, và cũng không thấy nút thêm', () => {
    render(
      <FolderRail
        danhTu="báo cáo"
        folders={THU_MUC}
        chungCount={3}
        dang={null}
        onChon={vi.fn()}
        canEdit={false}
        onThemMoi={vi.fn()}
        onDoiTen={vi.fn()}
        onXoa={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Thao tác trên thư mục/ })).toBeNull();
    // Backend trả 403 cho họ; bày một cái nút chỉ để báo lỗi là một cái bẫy.
    expect(screen.queryByRole('button', { name: 'Thêm thư mục' })).toBeNull();
  });

  it('Chung KHÔNG có menu ⋮ — đổi tên hay xoá nó là thao tác không tồn tại', () => {
    ve(null);
    expect(screen.queryByRole('button', { name: `Thao tác trên thư mục ${CHUNG}` })).toBeNull();
  });

  it('nút "+" nằm NGAY TRONG cột, và còn đó cả khi chưa có thư mục nào', () => {
    /*
     * Đây là chỗ DUY NHẤT tạo được thư mục từ khi nút trên thanh tiêu đề bị bỏ
     * đi. Ẩn nó lúc danh sách rỗng — một phản xạ dễ mắc khi viết nhánh "trống" —
     * là khoá hẳn tính năng đúng vào lúc người dùng cần nó nhất: lần đầu.
     */
    const { onThemMoi } = ve(null, vi.fn(), vi.fn(), []);

    const them = screen.getByRole('button', { name: 'Thêm thư mục' });
    fireEvent.click(them);
    expect(onThemMoi).toHaveBeenCalledTimes(1);

    // Và cột chưa có thư mục nào vẫn nói ra mình dùng để làm gì.
    expect(screen.getByText(/Bấm \+ ở trên để tạo thư mục/)).toBeTruthy();
  });
});
