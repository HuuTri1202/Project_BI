export const CUM_CO_DINH = [
  'hom-nay',
  'hom-qua',
  'tuan-nay',
  'tuan-truoc',
  'thang-nay',
  'thang-truoc',
  'quy-nay',
  'quy-truoc',
  'nam-nay',
  'nam-truoc',
  '7-ngay-qua',
  '30-ngay-qua',
  '90-ngay-qua',
] as const;

export interface KhoangNgay {
  tu: string;
  truocKhi: string;
}

function ngay(d: Date): string {
  const hai = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${hai(d.getMonth() + 1)}-${hai(d.getDate())}`;
}

function dauNgay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function themNgay(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function thuHai(d: Date): Date {
  const thu = d.getDay();
  return themNgay(d, thu === 0 ? -6 : 1 - thu);
}

function thang(nam: number, thangTu0: number): KhoangNgay {
  return {
    tu: ngay(new Date(nam, thangTu0, 1)),
    truocKhi: ngay(new Date(nam, thangTu0 + 1, 1)),
  };
}

function quy(nam: number, quyTu0: number): KhoangNgay {
  return {
    tu: ngay(new Date(nam, quyTu0 * 3, 1)),
    truocKhi: ngay(new Date(nam, quyTu0 * 3 + 3, 1)),
  };
}

function nam(n: number): KhoangNgay {
  return { tu: ngay(new Date(n, 0, 1)), truocKhi: ngay(new Date(n + 1, 0, 1)) };
}

function nNgayQua(moc: Date, n: number): KhoangNgay {
  return { tu: ngay(themNgay(moc, -(n - 1))), truocKhi: ngay(themNgay(moc, 1)) };
}

export function giaiCum(cum: string, moc: Date): KhoangNgay | null {
  const homNay = dauNgay(moc);
  const y = homNay.getFullYear();
  const m = homNay.getMonth();

  switch (cum) {
    case 'hom-nay':
      return { tu: ngay(homNay), truocKhi: ngay(themNgay(homNay, 1)) };
    case 'hom-qua':
      return { tu: ngay(themNgay(homNay, -1)), truocKhi: ngay(homNay) };

    case 'tuan-nay': {
      const d = thuHai(homNay);
      return { tu: ngay(d), truocKhi: ngay(themNgay(d, 7)) };
    }
    case 'tuan-truoc': {
      const d = themNgay(thuHai(homNay), -7);
      return { tu: ngay(d), truocKhi: ngay(themNgay(d, 7)) };
    }

    case 'thang-nay':
      return thang(y, m);
    // `thang(y, m - 1)` chạy đúng cả khi `m === 0`: `new Date(2026, -1, 1)` là
    // tháng 12 năm 2025. Không cần nhánh riêng cho tháng Một.
    case 'thang-truoc':
      return thang(y, m - 1);

    case 'quy-nay':
      return quy(y, Math.floor(m / 3));
    case 'quy-truoc':
      return quy(y, Math.floor(m / 3) - 1);

    case 'nam-nay':
      return nam(y);
    case 'nam-truoc':
      return nam(y - 1);

    case '7-ngay-qua':
      return nNgayQua(homNay, 7);
    case '30-ngay-qua':
      return nNgayQua(homNay, 30);
    case '90-ngay-qua':
      return nNgayQua(homNay, 90);

    default:
      break;
  }

  // Ba khuôn mang số. Phần thay đổi toàn là chữ số, nên không gian vẫn đóng.
  const thangN = /^thang-([1-9]|1[0-2])$/.exec(cum);
  if (thangN?.[1] !== undefined) return thang(y, Number(thangN[1]) - 1);

  const quyN = /^quy-([1-4])$/.exec(cum);
  if (quyN?.[1] !== undefined) return quy(y, Number(quyN[1]) - 1);

  /*
   * Kẹp năm vào 2000–2100.
   *
   * Không phải vì sợ tràn số, mà vì `nam-0` và `nam-99999` là dấu hiệu mô
   * hình đang bịa chứ không phải người dùng đang hỏi — và đoạn dữ liệu nào
   * cũng không nằm ngoài khoảng đó.
   */
  const namN = /^nam-(\d{4})$/.exec(cum);
  if (namN?.[1] !== undefined) {
    const n = Number(namN[1]);
    return n >= 2000 && n <= 2100 ? nam(n) : null;
  }

  return null;
}
