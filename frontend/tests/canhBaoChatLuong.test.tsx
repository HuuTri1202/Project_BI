import type { AnalyzeResultDto, CanhBaoCotDto, SheetPreviewDto } from '@bi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { StepChooseData } from '../src/features/datasets/wizard/StepChooseData';
import { quyUocDaChon } from '../src/features/datasets/wizard/quyUocCot';

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
  docThanhKhiVn: '750.000',
};

function dung(
  canhBao: CanhBaoCotDto[],
  gop = true,
  quyUocVn: ReadonlySet<string> = new Set(),
): { onGopChange: (g: boolean) => void; onQuyUocChange: (k: string, v: boolean) => void } {
  const onGopChange = vi.fn();
  const onQuyUocChange = vi.fn();
  render(
    <StepChooseData
      analysis={phanTich(canhBao)}
      selected={['Sheet1']}
      onChange={vi.fn()}
      gopHoaThuong={gop}
      onGopChange={onGopChange}
      quyUocVn={quyUocVn}
      onQuyUocChange={onQuyUocChange}
    />,
  );
  return { onGopChange, onQuyUocChange };
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

describe('người dùng tự chốt quy ước số của một cột (D2)', () => {
  /*
   * Hệ thống vừa nói ra rằng nó KHÔNG phân xử được cột này, nên đây là chỗ duy
   * nhất người cầm tệp nói lại được. Trước bản này họ chỉ có một đường: sửa tệp
   * rồi tải lên lần nữa.
   */
  it('ô tích chỉ hiện ở cột MƠ HỒ, và nói trước con số sau khi đổi', () => {
    dung([SO_MO_HO]);

    const o = screen.getByRole('checkbox', { name: /dấu chấm là.*phân cách nghìn/i });
    expect((o as HTMLInputElement).checked).toBe(false);
    // Xem trước: cả hai con số đều do backend tính bằng `parseNumber`.
    expect(o.closest('label')?.textContent).toContain('750.000');
  });

  it('tích rồi thì câu đổi sang nói con số MỚI, không nhắc lại lo ngại cũ', () => {
    dung([SO_MO_HO], true, new Set(['Sheet1:1']));

    const canhBao = screen.getByRole('status');
    expect(canhBao.textContent).toContain('theo lựa chọn của bạn');
    expect(canhBao.textContent).toContain('thành 750.000');
    // Câu cũ ("sẽ vào hệ thống thành 750") phải đi hẳn, không nằm cạnh câu mới.
    expect(canhBao.textContent).not.toContain('thành 750 ');
  });

  it('bấm thì báo ra ngoài, kèm khoá mang TÊN SHEET', () => {
    // Khoá phải có tên sheet: mỗi sheet thành một bộ dữ liệu với bảng cột
    // riêng, nên `ordinal` một mình sẽ đổi cách đọc của cả sheet khác.
    const { onQuyUocChange } = dung([SO_MO_HO]);
    const o = screen.getByRole('checkbox', { name: /dấu chấm là.*phân cách nghìn/i });

    fireEvent.click(o);
    expect(onQuyUocChange).toHaveBeenCalledWith('Sheet1:1', true);
  });

  it('cột hoa/thường KHÔNG có ô tích quy ước số', () => {
    dung([HOA_THUONG]);
    expect(screen.queryByRole('checkbox', { name: /phân cách nghìn/i })).toBeNull();
  });
});

describe('gửi lên đúng những cột của sheet ĐƯỢC TÍCH', () => {
  it('bỏ tích sheet thì quy ước của nó không đi theo', () => {
    // Người dùng mở xem Sheet2, tích một ô ở đó, rồi bỏ tích chính Sheet2. Gửi
    // kèm thì backend nhận một quy ước cho một bộ dữ liệu không được tạo.
    expect(quyUocDaChon(new Set(['Sheet1:1', 'Sheet2:3']), ['Sheet1'])).toEqual([
      { sheet: 'Sheet1', ordinal: 1, format: 'vn' },
    ]);
  });

  it('tên sheet có dấu hai chấm vẫn cắt đúng', () => {
    expect(quyUocDaChon(new Set(['Q1:2026:4']), ['Q1:2026'])).toEqual([
      { sheet: 'Q1:2026', ordinal: 4, format: 'vn' },
    ]);
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
