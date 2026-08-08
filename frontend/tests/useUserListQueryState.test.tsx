import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useUserListQueryState } from '../src/features/admin/useUserListQueryState';

/**
 * Trạng thái danh sách nằm trong URL. Hai thứ được kiểm ở đây đều là loại lỗi
 * chỉ lộ ra khi người dùng thao tác đúng một trình tự cụ thể, nên rất dễ lọt.
 */

let api: ReturnType<typeof useUserListQueryState>;

function Probe(): React.ReactElement {
  api = useUserListQueryState();
  const location = useLocation();
  return (
    <>
      <span data-testid="search">{location.search}</span>
      <span data-testid="state">{JSON.stringify(api.query)}</span>
    </>
  );
}

function setup(initialUrl = '/admin/users'): void {
  render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Probe />
    </MemoryRouter>,
  );
}

const state = (): ReturnType<typeof useUserListQueryState>['query'] =>
  JSON.parse(screen.getByTestId('state').textContent ?? '{}');

describe('useUserListQueryState', () => {
  it('đọc mặc định khi URL trống', () => {
    setup();
    expect(state()).toMatchObject({ page: 1, pageSize: 20, sort: 'fullName', order: 'asc', q: '' });
  });

  it('đổi bộ lọc thì ĐƯA VỀ TRANG 1', () => {
    // Đây là lỗi kinh điển: đang ở trang 5, lọc còn 2 kết quả, bảng trống trơn
    // và người dùng tưởng dữ liệu biến mất.
    setup('/admin/users?page=5');
    expect(state().page).toBe(5);

    act(() => api.update({ role: 'admin' }));

    expect(state().page).toBe(1);
    expect(state().role).toBe('admin');
  });

  it('đổi trang thì GIỮ nguyên trang được yêu cầu', () => {
    setup('/admin/users?role=admin');
    act(() => api.update({ page: 3 }));

    expect(state().page).toBe(3);
    expect(state().role).toBe('admin');
  });

  it('tham số hỏng trong URL thì thoái lui về mặc định, không ném lỗi', () => {
    // `?page=abc` gõ tay hoặc link cũ bị cắt — không được làm vỡ lúc render.
    setup('/admin/users?page=abc&pageSize=-5&sort=password_hash&order=sideways&role=hacker');

    expect(state()).toMatchObject({
      page: 1,
      pageSize: 20,
      sort: 'fullName',
      order: 'asc',
      role: '',
    });
  });

  it('chặn pageSize vượt trần', () => {
    setup('/admin/users?pageSize=9999');
    expect(state().pageSize).toBe(100);
  });

  it('không ghi vào URL những giá trị đang là mặc định', () => {
    setup();
    act(() => api.update({ q: 'nguyen' }));

    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).toContain('q=nguyen');
    // URL sạch: không có page=1&pageSize=20&sort=fullName&order=asc thừa thãi.
    expect(search).not.toContain('page=');
    expect(search).not.toContain('sort=');
  });

  it('reset xoá sạch bộ lọc', () => {
    setup('/admin/users?q=abc&role=admin&page=4');
    act(() => api.reset());

    expect(state()).toMatchObject({ q: '', role: '', page: 1 });
  });
});
