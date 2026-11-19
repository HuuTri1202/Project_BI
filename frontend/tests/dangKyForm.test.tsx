import { JOB_TITLE_OPTIONS, nhanChucDanh } from '@bi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { RegisterPage } from '../src/features/auth/RegisterPage';

/**
 * Form đăng ký — vá B1, và bảng nhãn chức danh — vá C4.
 *
 * ⚠️ Ba điều đã đo khi dùng hệ thống như người thật:
 *
 *   · form có 7 ô, KHÔNG ô nào đánh dấu bắt buộc;
 *   · điền 6 ô thì nút vẫn xám và không có chữ nào nói vì sao — lỗi của từng ô
 *     chỉ hiện sau khi ô đó được chạm vào, nên ô chưa ai bấm thì im lặng;
 *   · danh sách chức danh bằng tiếng Anh giữa một form tiếng Việt, và một chủ
 *     cửa hàng không có mục nào để chọn ngoài "Other".
 */

function dung(): void {
  render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
}

describe('ô bắt buộc được đánh dấu', () => {
  it('cả 7 ô đều mang aria-required', () => {
    dung();
    // Khẳng định bằng `aria-required`, không đếm dấu hoa thị: dấu sao là phần
    // hiển thị, còn đây là thứ trình đọc màn hình và bộ kiểm tra tiếp cận đọc.
    expect(document.querySelectorAll('[aria-required="true"]')).toHaveLength(7);
  });

  it('nhãn có dấu sao, và dấu đó không đọc lên thành "sao"', () => {
    dung();
    expect(screen.getAllByText('*')).toHaveLength(7);
    expect(screen.getAllByText('(bắt buộc)', { exact: false })).toHaveLength(7);
  });
});

describe('nút xám thì nói vì sao xám', () => {
  it('form trống -> liệt kê đủ 7 ô còn thiếu, theo thứ tự đọc', () => {
    dung();
    const cau = screen.getByRole('status').textContent ?? '';
    expect(cau).toContain('Còn thiếu');
    for (const nhan of [
      'Họ và tên',
      'Email',
      'Mật khẩu',
      'Nhập lại mật khẩu',
      'Số điện thoại',
      'Tên công ty',
      'Chức danh',
    ]) {
      expect(cau, `câu "còn thiếu" phải gọi tên ô ${nhan}`).toContain(nhan);
    }
  });

  it('điền một ô thì ô đó rời khỏi danh sách', () => {
    dung();
    fireEvent.change(screen.getByLabelText(/Họ và tên/), { target: { value: 'Nguyễn Văn A' } });

    const cau = screen.getByRole('status').textContent ?? '';
    expect(cau).not.toContain('Họ và tên');
    expect(cau).toContain('Email');
  });
});

describe('chức danh bằng tiếng Việt, có cả chủ cửa hàng', () => {
  it('thẻ select hiện nhãn Việt, không hiện chuỗi lưu trong DB', () => {
    dung();
    // Mục đầu tiên là chủ doanh nghiệp: đó là khách hàng thật của một nền tảng
    // BI nhỏ, không phải một đội dữ liệu doanh nghiệp.
    expect(screen.getByRole('option', { name: 'Chủ doanh nghiệp / chủ cửa hàng' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Kế toán / tài chính' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Khác' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Data Analyst' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Other' })).toBeNull();
  });

  it('GIÁ TRỊ gửi lên vẫn là chuỗi tiếng Anh đã lưu trong DB', () => {
    // Đây là chốt quan trọng nhất của bản vá: đổi chữ của một mục sẽ làm mọi
    // bản ghi `users.job_title` cũ mang giá trị không còn trong danh sách.
    const chuShop = JOB_TITLE_OPTIONS.find((o) => o.label.includes('chủ cửa hàng'));
    expect(chuShop?.value).toBe('Business Owner');
    expect(JOB_TITLE_OPTIONS.find((o) => o.label === 'Khác')?.value).toBe('Other');
    expect(JOB_TITLE_OPTIONS.find((o) => o.value === 'Data Analyst')?.label).toBe(
      'Chuyên viên phân tích dữ liệu',
    );
  });
});

describe('nhanChucDanh — dùng ở bảng Thành viên và bảng Người dùng', () => {
  it('dịch giá trị đã lưu', () => {
    expect(nhanChucDanh('Other')).toBe('Khác');
    expect(nhanChucDanh('IT Manager / CTO')).toBe('Trưởng phòng IT / CTO');
  });

  it('giá trị KHÔNG còn trong danh sách thì hiện nguyên văn', () => {
    // Database dev có những dòng do seed hoặc bản cũ ghi vào. Hiện nguyên văn
    // vẫn đúng hơn là hiện ô trống hay gán bừa thành "Khác".
    expect(nhanChucDanh('Trưởng phòng dữ liệu')).toBe('Trưởng phòng dữ liệu');
  });

  it('trống thì trả null, để nơi gọi không vẽ dòng rỗng', () => {
    expect(nhanChucDanh(null)).toBeNull();
    expect(nhanChucDanh('')).toBeNull();
  });
});
