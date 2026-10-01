import type { PlanDto } from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as api from '../src/features/admin/billing/api';
import { PlanModal } from '../src/pages/admin/BillingPlansPage';

/**
 * Ô dung lượng của màn Gói dịch vụ — đơn vị NHẬP LIỆU và luật hạn mức.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Database lưu BYTE; cái ô chỉ là một phép đổi đơn vị cho người đọc. Ba chỗ
 * hỏng ở đây đều KHÔNG ném lỗi nào, nên không có cách nào thấy bằng mắt:
 *
 *   1. Hệ số đổi sai. Gõ 500 mà lưu xuống 500 byte (hoặc 500 GB) thì màn hình
 *      vẫn hiện một con số trông hợp lý, và chỉ lộ ra khi một khách hàng thật
 *      chạm trần sớm hơn hẳn mức họ mua.
 *   2. Mở gói cũ ra sai đơn vị. Gói 5 GB mà mở thành `5` + MB thì bấm Lưu mà
 *      không sửa gì cũng siết hạn mức xuống 1/1024.
 *   3. Gõ sai lặng lẽ thành KHÔNG GIỚI HẠN. Đây là lỗi đắt hơn: nó cấp thêm
 *      quyền chứ không siết, nên không ai đi khiếu nại, và nó nằm lại trong
 *      bảng giá cho tới khi có người đối soát.
 */

vi.mock('../src/features/admin/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
}));

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Gói `pro` như migration 30 gieo nó: 5368709120 byte, tức đúng 5 GB. */
function goiPro(bytes: number | null = 5 * GB): PlanDto {
  return {
    id: 7,
    code: 'pro',
    name: 'Chuyên nghiệp',
    description: null,
    priceVnd: 299000,
    durationDays: 30,
    maxWorkspaces: 5,
    maxReports: 50,
    maxMembers: 10,
    maxStorageBytes: bytes,
    isPublic: true,
    isFeatured: false,
    sortOrder: 1,
  } as PlanDto;
}

function mo(plan: PlanDto | null): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PlanModal open plan={plan} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

function o(nhan: string): HTMLInputElement {
  return screen.getByLabelText(nhan) as HTMLInputElement;
}

function nutDonVi(donVi: 'MB' | 'GB'): HTMLElement {
  return screen.getByRole('button', { name: donVi });
}

/** Đọc `maxStorageBytes` đã gửi lên sau khi bấm Lưu. */
async function daGui(): Promise<api.PlanWriteInput> {
  fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(api.updatePlan).toHaveBeenCalled());
  const [, input] = vi.mocked(api.updatePlan).mock.calls[0] as [number, api.PlanWriteInput];
  return input;
}

afterEach(() => {
  vi.mocked(api.createPlan).mockReset();
  vi.mocked(api.updatePlan).mockReset();
});

describe('Mở một gói đã có: đơn vị lớn nhất mà con số còn nguyên', () => {
  it('gói 5 GB mở ra là "5" + GB, không phải "5120" + MB', () => {
    // Con số người vận hành đang nghĩ trong đầu là "5 GB". Mở ra `5120` buộc họ
    // chia nhẩm 1024 chỉ để kiểm xem gói này đang là bao nhiêu.
    mo(goiPro(5 * GB));

    expect(o('Dung lượng').value).toBe('5');
    expect(nutDonVi('GB')).toHaveAttribute('aria-pressed', 'true');
    expect(nutDonVi('MB')).toHaveAttribute('aria-pressed', 'false');
  });

  it('gói 100 MB mở ra là "100" + MB — không chia hết cho GB', () => {
    // Đây là gói `free` thật (104857600 byte). Ở GB nó là `0.09765625`, một giá
    // trị mà `docHanMuc` từ chối — nên chọn GB ở đây là làm form không lưu được.
    mo(goiPro(100 * MB));

    expect(o('Dung lượng').value).toBe('100');
    expect(nutDonVi('MB')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Gõ số rồi chọn đơn vị', () => {
  /*
   * ⚠️ Mỗi ca ở đây phải ĐỔI đơn vị thật, nên gói mở ra phải đang ở đơn vị KHÁC
   * với đơn vị được bấm.
   *
   * Bản đầu của bộ test này mở `goiPro()` (5 GB, tức form bật sẵn GB) rồi bấm
   * GB — một cú bấm không làm gì cả. Ba ca vẫn xanh, và chúng vẫn xanh cả khi
   * nút đổi đơn vị được sửa thành quy đổi con số, tức là chúng không canh gì.
   */
  it('500 ở MB lưu xuống 500 MB tính bằng BYTE', async () => {
    mo(goiPro(5 * GB));

    fireEvent.change(o('Dung lượng'), { target: { value: '500' } });
    fireEvent.click(nutDonVi('MB'));

    // 1024 chứ không 1000 — khớp với `dinhDangDungLuong` ở phía hiển thị. Lệch
    // nhau thì gõ 10240 rồi màn hình hiện "10,7 GB".
    expect((await daGui()).maxStorageBytes).toBe(500 * 1024 * 1024);
  });

  it('50 ở GB lưu xuống 50 GB tính bằng BYTE', async () => {
    mo(goiPro(100 * MB));

    fireEvent.change(o('Dung lượng'), { target: { value: '50' } });
    fireEvent.click(nutDonVi('GB'));

    expect((await daGui()).maxStorageBytes).toBe(50 * 1024 * 1024 * 1024);
  });

  it('đổi đơn vị KHÔNG viết lại con số đã gõ', async () => {
    /*
     * Hai nút khai Ý NGHĨA của con số, không phải cách xem nó. Bản "bảo toàn giá
     * trị" (500 MB -> 0.48828125 GB) tự chặn chính nó: số thập phân bị từ chối,
     * nên người muốn chuyển một gói MB sang GB mắc kẹt ở form không lưu được.
     */
    mo(goiPro(100 * MB));

    fireEvent.change(o('Dung lượng'), { target: { value: '500' } });
    fireEvent.click(nutDonVi('GB'));

    expect(o('Dung lượng').value).toBe('500');
    expect((await daGui()).maxStorageBytes).toBe(500 * 1024 * 1024 * 1024);
  });

  it('gợi ý nói kích thước KHÁCH sẽ thấy, nên bấm nhầm đơn vị lộ ra ngay', () => {
    // Chỗ duy nhất mà một cú bấm nhầm MB/GB hiện ra lúc đang điền: con số trong
    // ô không đổi, chỉ dòng này đổi.
    mo(goiPro());

    fireEvent.change(o('Dung lượng'), { target: { value: '10240' } });
    fireEvent.click(nutDonVi('MB'));
    expect(screen.getByText('Khách thấy: 10 GB')).toBeInTheDocument();

    fireEvent.click(nutDonVi('GB'));
    expect(screen.getByText('Khách thấy: 10 TB')).toBeInTheDocument();
  });

  it('để TRỐNG nghĩa là không giới hạn, không phải 0', async () => {
    mo(goiPro());

    fireEvent.change(o('Dung lượng'), { target: { value: '' } });

    // `0` sẽ là "không được dùng gì cả" — nghĩa ngược hẳn.
    expect((await daGui()).maxStorageBytes).toBeNull();
  });
});

describe('Gõ sai KHÔNG được lặng lẽ thành không giới hạn', () => {
  /*
   * Ca quan trọng nhất của cả file.
   *
   * Bản trước đọc mọi ô hạn mức bằng một hàm trả `null` cho CẢ ô trống lẫn giá
   * trị không đọc được — mà `null` nghĩa là không giới hạn. Nên gõ `abc` vào
   * "Workspace tối đa" rồi bấm Lưu sẽ cấp vô hạn workspace, im lặng.
   */
  for (const [nhan, xau] of [
    ['Dung lượng', '12.5'],
    ['Workspace tối đa', 'abc'],
    ['Báo cáo tối đa', '-3'],
    ['Thành viên tối đa', '2,5'],
  ] as const) {
    it(`"${nhan}" nhận "${xau}" -> từ chối kèm lý do, KHÔNG gửi đi`, async () => {
      mo(goiPro());

      fireEvent.change(o(nhan), { target: { value: xau } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));

      // Câu báo phải gọi ĐÚNG TÊN ô: bốn ô nằm cạnh nhau, và một câu chung
      // chung buộc người vận hành thử từng ô để biết mình gõ sai ở đâu.
      expect(await screen.findByRole('alert')).toHaveTextContent(nhan);
      expect(api.updatePlan).not.toHaveBeenCalled();
    });
  }

  it('giá trị hợp lệ thì vẫn đi qua — bộ chặn không chặn nhầm', async () => {
    // Ca đối chứng. Thiếu nó thì một luật chặn SẠCH mọi thứ cũng cho bốn ca
    // trên màu xanh, và màn hình thành ra không lưu được gì.
    mo(goiPro());

    fireEvent.change(o('Workspace tối đa'), { target: { value: '12' } });

    expect((await daGui()).maxWorkspaces).toBe(12);
  });
});
