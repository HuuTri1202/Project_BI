import type { AnalyzeResultDto, CanhBaoCotDto, SheetPreviewDto } from '@bi/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { StepChooseData } from '../src/features/datasets/wizard/StepChooseData';

/**
 * Cảnh báo chất lượng dữ liệu ở bước 2 của wizard — vá A2 và C3.
 *
 * ⚠️ Hai lỗi đã đo khi dùng hệ thống như người thật, cả hai đều IM LẶNG:
 *
 *   · biểu đồ "doanh thu theo khu vực" hiện 5 cột cho 3 khu vực, vì `MIỀN NAM`
 *     và `Miền Nam` là hai nhóm riêng — tệp bán hàng gõ tay luôn có kiểu này;
 *   · ô `750.000` vào kho thành `750`, mà bảng xem trước vẫn hiện `750.000`.
 *
 * Bộ này canh phần người dùng THẤY: câu cảnh báo có ví dụ thật, và ô tích cho
 * phép gộp chỉ xuất hiện khi có nhóm trùng — vì nó là chỗ người dùng cho phép
 * hệ thống biến đổi dữ liệu của họ.
 */

function sheet(canhBao: CanhBaoCotDto[]): SheetPreviewDto {
  return {
    name: 'Sheet1',
    rowCount: 120,
    previewRows: [['Miền Nam', '750.000']],
    columns: [
      { columnIndex: 0, sourceName: 'Khu vực', semanticType: 'text', samples: ['Miền Nam'] },
      { columnIndex: 1, sourceName: 'Doanh thu', semanticType: 'number', samples: ['750.000'] },
    ],
    canhBao,
  };
}

function phanTich(canhBao: CanhBaoCotDto[]): AnalyzeResultDto {
  return { sheets: [sheet(canhBao)], truncated: false, maxRows: 50_000, previewRowLimit: 100 };
}

const HOA_THUONG: CanhBaoCotDto = {
  columnIndex: 0,
  sourceName: 'Khu vực',
  loai: 'hoa-thuong',
  soNhom: 2,
  viDu: ['Miền Nam', 'MIỀN NAM'],
};

const SO_MO_HO: CanhBaoCotDto = {
  columnIndex: 1,
  sourceName: 'Doanh thu',
  loai: 'so-mo-ho',
  viDu: ['750.000'],
  docThanh: '750',
};

function dung(canhBao: CanhBaoCotDto[], gop = true): { onGopChange: (g: boolean) => void } {
  const onGopChange = vi.fn();
  render(
    <StepChooseData
      analysis={phanTich(canhBao)}
      selected={['Sheet1']}
      onChange={vi.fn()}
      gopHoaThuong={gop}
      onGopChange={onGopChange}
    />,
  );
  return { onGopChange };
}

describe('cảnh báo hoa/thường', () => {
  it('nói rõ cột nào, mấy nhóm, và nêu CHÍNH chữ trong tệp', () => {
    dung([HOA_THUONG]);
    const canhBao = screen.getByRole('status');
    expect(canhBao.textContent).toContain('Khu vực');
    expect(canhBao.textContent).toContain('2 nhóm');
    // Ví dụ thật là thứ khiến người dùng tìm được chỗ cần sửa.
    expect(canhBao.textContent).toContain('MIỀN NAM');
    // Và nói hậu quả, chứ không chỉ nói có chuyện gì.
    expect(canhBao.textContent).toContain('cột riêng');
  });

  it('ô tích gộp xuất hiện, và bấm thì báo ra ngoài', async () => {
    const { onGopChange } = dung([HOA_THUONG]);
    const o = screen.getByRole('checkbox', { name: /Gộp các nhóm chỉ khác nhau chữ hoa\/thường/ });
    expect((o as HTMLInputElement).checked).toBe(true);

    await userEvent.click(o);
    expect(onGopChange).toHaveBeenCalledWith(false);
  });
});

describe('cảnh báo số mơ hồ', () => {
  it('nói CON SỐ sẽ vào hệ thống, không nói chung chung', () => {
    dung([SO_MO_HO]);
    const canhBao = screen.getByRole('status');
    expect(canhBao.textContent).toContain('750.000');
    expect(canhBao.textContent).toContain('thành 750');
  });

  it('KHÔNG hiện ô tích gộp — nó không gộp được gì ở đây', () => {
    // Ô tích là chỗ cho phép biến đổi dữ liệu chữ. Hiện nó cạnh một cảnh báo về
    // số là hứa một thứ nó không làm.
    dung([SO_MO_HO]);
    expect(screen.queryByRole('checkbox', { name: /Gộp các nhóm/ })).toBeNull();
  });
});

describe('cảnh báo gần giống (chỉ khác dấu)', () => {
  const GAN_GIONG: CanhBaoCotDto = {
    columnIndex: 0,
    sourceName: 'Khu vực',
    loai: 'gan-giong',
    soNhom: 1,
    viDu: ['Miền Nam', 'Mien Nam'],
  };

  it('nói rõ là hệ thống KHÔNG tự gộp, và việc cần làm', () => {
    dung([GAN_GIONG]);
    const canhBao = screen.getByRole('status');
    expect(canhBao.textContent).toContain('Mien Nam');
    expect(canhBao.textContent).toContain('khác nhau ở DẤU');
    // Phải nói việc cần làm: hệ thống không có cơ sở nào để chọn hộ một dạng.
    expect(canhBao.textContent).toContain('sửa cho thống nhất trong tệp');
  });

  it('KHÔNG hiện ô tích gộp — ô tích chỉ gộp hoa/thường', () => {
    dung([GAN_GIONG]);
    expect(screen.queryByRole('checkbox', { name: /Gộp các nhóm/ })).toBeNull();
  });
});

describe('tệp sạch', () => {
  it('không có cảnh báo nào và không có ô tích nào', () => {
    dung([]);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Gộp các nhóm/ })).toBeNull();
  });
});
