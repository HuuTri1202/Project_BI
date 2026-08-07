import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JOB_TITLES } from '@bi/shared';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RegisterPage } from '../src/features/auth/RegisterPage';

/**
 * Khoá lại đúng hành vi mà yêu cầu 1.1 và 1.2 mô tả.
 *
 * Vì sao đáng viết test cho một cái nút: `isValid` của react-hook-form CHỈ được
 * duy trì khi `useForm` có cả resolver lẫn `mode: 'onChange'`, và chỉ khi
 * `formState.isValid` được ĐỌC LÚC RENDER (formState là Proxy, nó theo dõi thứ
 * bạn đọc để quyết định có re-render hay không). Sai một trong hai điều đó thì
 * nút disable vĩnh viễn và form không bao giờ gửi được — mà `tsc` với ESLint đều
 * không thấy gì bất thường.
 */

/** Các ô gõ chữ. "Chức danh" giờ là <select> nên phải điền theo cách khác. */
const TYPED_FIELDS = {
  'Họ và tên': 'Nguyễn Thái Hiền',
  'Tên công ty': 'Công ty Cổ phần ABC',
  Email: 'hien@example.com',
  'Mật khẩu': 'Matkhau123',
  'Nhập lại mật khẩu': 'Matkhau123',
  'Số điện thoại': '0901234567',
};

const JOB_TITLE = 'Data Analyst';

function renderPage() {
  return render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );
}

const submitButton = () => screen.getByRole('button', { name: /đăng ký/i });

async function fillAll(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  for (const [label, value] of Object.entries(TYPED_FIELDS)) {
    await user.type(screen.getByLabelText(label), value);
  }
  await user.selectOptions(screen.getByLabelText('Chức danh'), JOB_TITLE);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('RegisterPage — yêu cầu 1.1', () => {
  it('hiển thị đủ 7 ô nhập', () => {
    renderPage();
    for (const label of [...Object.keys(TYPED_FIELDS), 'Chức danh']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('Chức danh là danh sách chọn, không phải ô gõ tự do', () => {
    renderPage();
    const select = screen.getByLabelText('Chức danh');

    expect(select.tagName).toBe('SELECT');
    // 10 chức danh + 1 dòng placeholder
    expect(screen.getAllByRole('option')).toHaveLength(JOB_TITLES.length + 1);
    for (const title of JOB_TITLES) {
      expect(screen.getByRole('option', { name: title })).toBeInTheDocument();
    }
  });

  it('mặc định chưa chọn chức danh nào', () => {
    renderPage();
    expect(screen.getByLabelText('Chức danh')).toHaveValue('');
  });

  it('nút Submit bị disable ngay khi vừa mở trang', () => {
    renderPage();
    expect(submitButton()).toBeDisabled();
  });

  it('nút Submit BẬT LÊN khi cả 7 ô đều hợp lệ', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillAll(user);

    await waitFor(() => {
      expect(submitButton()).toBeEnabled();
    });
  });

  it('vẫn disable khi mới điền một phần', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Họ và tên'), 'Nguyễn Thái Hiền');
    await user.type(screen.getByLabelText('Email'), 'hien@example.com');

    expect(submitButton()).toBeDisabled();
  });
});

describe('RegisterPage — yêu cầu 1.2', () => {
  it('không báo lỗi trước khi người dùng chạm vào ô', () => {
    renderPage();
    expect(screen.queryByText(/Vui lòng nhập họ và tên/)).not.toBeInTheDocument();
  });

  it('báo lỗi mật khẩu thiếu chữ hoa', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Mật khẩu'), 'matkhau123');
    await user.tab();

    expect(await screen.findByText(/ít nhất 1 chữ hoa/)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it('báo mật khẩu nhập lại không khớp NGAY, không đợi điền xong cả form', async () => {
    // Luật so khớp nằm ở superRefine cấp object, mà zod chỉ chạy nó sau khi mọi
    // trường con hợp lệ. Người dùng thường điền mật khẩu trước chức danh, nên
    // RegisterPage có thêm một lớp cảnh báo riêng — test này canh đúng chỗ đó.
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Mật khẩu'), 'Matkhau123');
    await user.type(screen.getByLabelText('Nhập lại mật khẩu'), 'Matkhau999');
    await user.tab();

    expect(await screen.findByText(/Mật khẩu nhập lại không khớp/)).toBeInTheDocument();
  });

  it('lỗi không khớp biến mất khi sửa lại cho đúng, và nút bật lên', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillAll(user);
    await user.clear(screen.getByLabelText('Nhập lại mật khẩu'));
    await user.type(screen.getByLabelText('Nhập lại mật khẩu'), 'Matkhau999');

    expect(await screen.findByText(/Mật khẩu nhập lại không khớp/)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    await user.clear(screen.getByLabelText('Nhập lại mật khẩu'));
    await user.type(screen.getByLabelText('Nhập lại mật khẩu'), 'Matkhau123');

    await waitFor(() => {
      expect(submitButton()).toBeEnabled();
    });
    expect(screen.queryByText(/Mật khẩu nhập lại không khớp/)).not.toBeInTheDocument();
  });

  it('báo lỗi số điện thoại sai định dạng', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('Số điện thoại'), '123');
    await user.tab();

    expect(await screen.findByText(/9–10 chữ số/)).toBeInTheDocument();
  });
});

describe('RegisterPage — lỗi từ server', () => {
  it('gắn lỗi 409 vào ô email chứ không phải banner chung', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'Email đã được đăng ký' },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderPage();
    await fillAll(user);
    await waitFor(() => {
      expect(submitButton()).toBeEnabled();
    });
    await user.click(submitButton());

    expect(await screen.findByText('Email đã được đăng ký')).toBeInTheDocument();

    // `setError` kéo `isValid` xuống false nên nút bị khoá — đúng ý muốn: không
    // cho gửi lại y nguyên bộ dữ liệu vừa bị từ chối.
    expect(submitButton()).toBeDisabled();

    // Nhưng người dùng phải sửa được. `mode: 'onChange'` khiến resolver chạy lại
    // ngay khi gõ, lỗi biến mất và nút bật lên. Không có phần này thì form kẹt
    // vĩnh viễn sau một lần trùng email.
    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'email-khac@example.com');

    await waitFor(() => {
      expect(submitButton()).toBeEnabled();
    });
    expect(screen.queryByText('Email đã được đăng ký')).not.toBeInTheDocument();
  });

  it('gửi số điện thoại nguyên văn, để backend chuẩn hoá', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ user: {}, tenant: {}, workspace: {}, role: 'tenant_admin' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    renderPage();
    await fillAll(user);
    await waitFor(() => {
      expect(submitButton()).toBeEnabled();
    });
    await user.click(submitButton());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      phone: string;
      email: string;
      companyName: string;
    };
    expect(body.phone).toBe('0901234567');
    expect(body.email).toBe('hien@example.com');
    expect(body.companyName).toBe('Công ty Cổ phần ABC');
  });
});
