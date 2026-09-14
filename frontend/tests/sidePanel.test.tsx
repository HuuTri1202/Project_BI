import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SidePanel } from '../src/features/reports/builder/SidePanel';

/**
 * Hai cột bên của trình dựng GẤP LẠI được — §10.15.
 *
 * ─── Lời than của người dùng ────────────────────────────────────────────────
 *
 *   "thêm các nút thu gọn mục chỉnh biểu đồ và mục mô hình dữ liệu để trang
 *    hiển thị biểu đồ báo cáo được rộng hơn, hiện tại đang hơi bé"
 *
 * ─── Vì sao mấy ca này đáng khoá ────────────────────────────────────────────
 *
 * Một cái nút gấp thì khó hỏng. Thứ dễ hỏng là hai chuyện quanh nó, và cả hai
 * đều hỏng LẶNG LẼ:
 *
 *   nhớ nhầm khoá   hai cột dùng chung một khoá thì gấp cột này là gấp luôn
 *                   cột kia — trông y như một lỗi vẽ lại.
 *   localStorage    trình duyệt chặn (Safari riêng tư) thì ĐỌC cũng ném lỗi,
 *                   và một lỗi lúc render là cả trình dựng trắng màn.
 */
describe('SidePanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const cot = (key = 'visual', title = 'Chỉnh biểu đồ'): React.ReactElement => (
    <SidePanel title={title} storageKey={key} width="w-72">
      <p>Nội dung cột</p>
    </SidePanel>
  );

  it('mặc định MỞ — người mở trình dựng lần đầu phải thấy đủ cả hai cột', () => {
    render(cot());

    expect(screen.getByText('Nội dung cột')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thu gọn Chỉnh biểu đồ' })).toBeTruthy();
  });

  it('gấp lại thì còn một thanh ray mở lại được, không biến mất hẳn', () => {
    // Biến mất hẳn thì đường mở lại cũng biến mất theo, và người dùng còn không
    // biết mình vừa đóng cái gì.
    render(cot());
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn Chỉnh biểu đồ' }));

    expect(screen.queryByText('Nội dung cột')).toBeNull();
    const ray = screen.getByRole('button', { name: 'Mở lại Chỉnh biểu đồ' });
    expect(ray).toBeTruthy();

    fireEvent.click(ray);
    expect(screen.getByText('Nội dung cột')).toBeTruthy();
  });

  it('nhớ qua lần mở sau', () => {
    const dau = render(cot());
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn Chỉnh biểu đồ' }));
    dau.unmount();

    render(cot());
    expect(screen.queryByText('Nội dung cột')).toBeNull();
  });

  it('mỗi cột một khoá — gấp cột này KHÔNG gấp cột kia', () => {
    render(
      <>
        {cot('visual', 'Chỉnh biểu đồ')}
        {cot('fields', 'Mô hình dữ liệu')}
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn Chỉnh biểu đồ' }));

    expect(screen.getByRole('button', { name: 'Mở lại Chỉnh biểu đồ' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thu gọn Mô hình dữ liệu' })).toBeTruthy();
  });

  it('localStorage bị chặn thì cột vẫn MỞ, không ném lỗi lúc render', () => {
    const doc = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const ghi = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    try {
      render(cot());
      expect(screen.getByText('Nội dung cột')).toBeTruthy();

      // Và gấp vẫn phải gấp được — chỉ là lần sau không nhớ.
      fireEvent.click(screen.getByRole('button', { name: 'Thu gọn Chỉnh biểu đồ' }));
      expect(screen.queryByText('Nội dung cột')).toBeNull();
    } finally {
      doc.mockRestore();
      ghi.mockRestore();
    }
  });
});
