import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { dangLoc, useListQueryState } from '../src/hooks/useListQueryState';

/**
 * Trạng thái danh sách nằm trong URL. Ba thứ được kiểm ở đây đều là loại lỗi
 * chỉ lộ ra khi người dùng thao tác theo đúng một trình tự cụ thể, nên rất dễ
 * lọt qua khâu thử tay.
 */

interface Query {
  page: number;
  pageSize: number;
  sort: string;
  order: string;
  q: string;
  status: string;
}

const DEFAULTS: Query = {
  page: 1,
  pageSize: 20,
  sort: 'createdAt',
  order: 'desc',
  q: '',
  status: '',
};

const ALLOWED = {
  sort: ['name', 'createdAt'],
  order: ['asc', 'desc'],
  status: ['active', 'locked'],
} as const;

let api: ReturnType<typeof useListQueryState<Query>>;

function Probe(): React.ReactElement {
  api = useListQueryState<Query>({ ...DEFAULTS }, ALLOWED);
  const location = useLocation();
  return (
    <>
      <span data-testid="search">{location.search}</span>
      <span data-testid="state">{JSON.stringify(api.query)}</span>
    </>
  );
}

function setup(initialUrl = '/admin/tenants'): void {
  render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Probe />
    </MemoryRouter>,
  );
}

const state = (): Query => JSON.parse(screen.getByTestId('state').textContent ?? '{}') as Query;

describe('useListQueryState', () => {
  it('đọc mặc định khi URL trống', () => {
    setup();
    expect(state()).toEqual(DEFAULTS);
  });

  it('đổi bộ lọc thì ĐƯA VỀ TRANG 1', () => {
    // Lỗi kinh điển: đang ở trang 5, lọc còn 2 kết quả, bảng trống trơn và
    // người dùng tưởng dữ liệu biến mất.
    setup('/admin/tenants?page=5');
    expect(state().page).toBe(5);

    act(() => api.update({ status: 'locked' }));

    expect(state().page).toBe(1);
    expect(state().status).toBe('locked');
  });

  it('đổi trang thì GIỮ nguyên trang được yêu cầu', () => {
    setup('/admin/tenants?status=locked');
    act(() => api.update({ page: 3 }));

    expect(state().page).toBe(3);
    expect(state().status).toBe('locked');
  });

  it('giá trị ngoài whitelist bị bỏ qua, về mặc định', () => {
    // `sort` đi thẳng vào ORDER BY ở backend, nên whitelist là lớp phòng thủ
    // đầu tiên — kể cả khi backend cũng có lớp của nó.
    setup('/admin/tenants?sort=password_hash&order=sideways&status=hacker');

    expect(state()).toMatchObject({ sort: 'createdAt', order: 'desc', status: '' });
  });

  it('tham số số học hỏng thì thoái lui, không ném lỗi', () => {
    setup('/admin/tenants?page=abc&pageSize=-5');
    expect(state()).toMatchObject({ page: 1, pageSize: 20 });
  });

  it('không ghi vào URL những giá trị đang là mặc định', () => {
    setup();
    act(() => api.update({ q: 'alpha' }));

    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).toContain('q=alpha');
    // URL sạch: không kèm page=1&pageSize=20&sort=createdAt&order=desc thừa thãi.
    expect(search).not.toContain('pageSize=');
    expect(search).not.toContain('sort=');
  });

  it('reset xoá sạch bộ lọc', () => {
    setup('/admin/tenants?q=abc&status=locked&page=4');
    act(() => api.reset());

    expect(state()).toEqual(DEFAULTS);
  });
});

/**
 * `dangLoc` — danh sách có đang bị thu hẹp không.
 *
 * ─── Vì sao nó đáng một bộ ca riêng ─────────────────────────────────────────
 *
 * Khung hỏi đáp khai `total` dưới một nhãn TUYỆT ĐỐI ("Số thành viên của tổ
 * chức"). Khi có bộ lọc, `total` chỉ còn là tổng của phần đã lọc — một con số
 * có thật trả lời cho một câu hỏi khác. Cờ này là thứ duy nhất phân biệt hai
 * trạng thái đó, nên nó nhận nhầm chiều nào cũng hỏng một đầu: nhận thừa thì
 * mọi câu trả lời mọc một vế cảnh báo thừa, nhận thiếu thì con số lại nói dối.
 */
describe('dangLoc', () => {
  const MAC_DINH: Query = {
    page: 1,
    pageSize: 20,
    sort: 'name',
    order: 'asc',
    q: '',
    status: '',
  };

  it('đúng mặc định thì KHÔNG phải đang lọc', () => {
    expect(dangLoc({ ...MAC_DINH }, MAC_DINH)).toBe(false);
  });

  it('phân trang và sắp xếp KHÔNG phải lọc', () => {
    /*
     * Chúng đổi THỨ TỰ và LÁT CẮT, không đổi tập hợp — `total` vẫn là toàn bộ.
     * Phần "mới tải 20 trên 24" đã có `luuYChuaDu` lo, và gộp hai chuyện vào
     * một cờ là dán một câu cảnh báo sai cho mọi người bấm sang trang 2.
     */
    expect(dangLoc({ ...MAC_DINH, page: 3 }, MAC_DINH)).toBe(false);
    expect(dangLoc({ ...MAC_DINH, pageSize: 50 }, MAC_DINH)).toBe(false);
    expect(dangLoc({ ...MAC_DINH, sort: 'createdAt', order: 'desc' }, MAC_DINH)).toBe(false);
  });

  it('ô tìm kiếm và ô lọc thì CÓ', () => {
    expect(dangLoc({ ...MAC_DINH, q: 'an' }, MAC_DINH)).toBe(true);
    expect(dangLoc({ ...MAC_DINH, status: 'locked' }, MAC_DINH)).toBe(true);
  });
});
