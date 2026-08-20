# -*- coding: utf-8 -*-
"""
Sinh bản Markdown của kịch bản kiểm thử trình duyệt từ chính file HTML.

Cùng lý do với `xuat-markdown.py`: gõ tay hai lần là cách chắc chắn nhất để hai
bản nói hai điều khác nhau sau lần sửa đầu tiên.

Chạy:
    python docs/kiem-thu/xuat-kich-ban-md.py \
        docs/kiem-thu/kich-ban-trinh-duyet.html \
        docs/kiem-thu/kich-ban-trinh-duyet.md
"""
import io
import re
import sys
from html.parser import HTMLParser

SRC, DST = sys.argv[1], sys.argv[2]


class BocKichBan(HTMLParser):
    """
    Bóc các <h2> và các thẻ `.kb` thành cấu trúc thuần Python.

    ⚠️ Vùng văn bản được đóng bằng ĐÚNG thẻ đã mở nó, đếm theo độ sâu. Bản đầu
    đóng vùng ở bất kỳ thẻ inline nào, nên một `<b>` nằm giữa câu là cắt cụt cả
    bước — "Quản lý tổ chức → tab Kết nối → Thêm kết nối" chỉ còn ba chữ đầu.
    """

    # Thẻ mở ra một vùng văn bản, kèm tên vùng.
    VUNG = {'h2': 'muc', 'dt': 'dt', 'dd': 'dd', 'li': 'li', 'th': 'o', 'td': 'o'}

    def __init__(self):
        super().__init__()
        self.khoi = []          # [('muc', str) | ('kb', dict)]
        self._kb = None
        self._sau_div = 0       # độ sâu <div> tính từ thẻ .kb
        self._vung = None       # (tên vùng, thẻ mở, độ sâu)
        self._buf = []
        self._trong_mongdoi = False
        self._trong_canhbao = False
        self._cho_ten = False
        self._cho_mo_ta = False
        self._hang = []

    # ── mở thẻ ────────────────────────────────────────────────────────────
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        lop = (a.get('class') or '').split()

        # Đang đọc một vùng: chỉ cần đếm độ sâu, nội dung do handle_data gom.
        if self._vung is not None:
            if tag == self._vung[1]:
                self._vung = (self._vung[0], self._vung[1], self._vung[2] + 1)
            elif tag == 'br':
                self._buf.append(' · ')
            return

        if tag == 'div':
            if 'kb' in lop and 'data-ma' in a:
                self._kb = {'ma': a['data-ma'], 'ten': '', 'mo_ta': '', 'meta': [],
                            'buoc': [], 'mongdoi': [], 'canhbao': [], 'bang': []}
                self._sau_div = 1
                self._cho_ten = True
                return
            if self._kb is not None:
                self._sau_div += 1
                if 'mongdoi' in lop:
                    self._trong_mongdoi = True
                elif 'canhbao' in lop:
                    self._trong_canhbao = True
            return

        if tag in self.VUNG:
            # <li> chỉ có nghĩa khi đang ở trong một thẻ kb.
            if tag != 'h2' and self._kb is None:
                return
            self._mo(self.VUNG[tag], tag)
            return

        if self._kb is not None and tag == 'b' and self._cho_ten:
            self._mo('ten', 'b')
        elif self._kb is not None and tag == 'span' and self._cho_mo_ta:
            self._mo('mo_ta', 'span')
        elif self._kb is not None and tag == 'p' and self._trong_canhbao:
            self._mo('canhbao', 'p')

    # ── đóng thẻ ──────────────────────────────────────────────────────────
    def handle_endtag(self, tag):
        if self._vung is not None and tag == self._vung[1]:
            ten, the, sau = self._vung
            if sau > 1:
                self._vung = (ten, the, sau - 1)
                return
            self._dong(ten)
            return

        if tag == 'tr' and self._kb is not None and self._hang:
            self._kb['bang'].append(self._hang)
            self._hang = []
            return

        if tag == 'div' and self._kb is not None:
            self._sau_div -= 1
            if self._trong_mongdoi and self._sau_div == 1:
                self._trong_mongdoi = False
            if self._trong_canhbao and self._sau_div == 1:
                self._trong_canhbao = False
            if self._sau_div == 0:
                self.khoi.append(('kb', self._kb))
                self._kb = None

    def handle_data(self, d):
        if self._vung is not None:
            self._buf.append(d)

    # ── tiện ích ──────────────────────────────────────────────────────────
    def _mo(self, ten, the):
        self._vung = (ten, the, 1)
        self._buf = []

    def _dong(self, ten):
        t = re.sub(r'\s+', ' ', ''.join(self._buf)).strip().replace('|', '/')
        self._vung = None
        self._buf = []
        if not t:
            # Ô rỗng trong bảng vẫn phải giữ chỗ, không thì các cột lệch nhau.
            if ten == 'o' and self._kb is not None:
                self._hang.append('')
            return

        if ten == 'muc':
            # `<span class="num">§4</span>` dính liền tiêu đề vì HTML không có
            # khoảng trắng giữa hai thẻ — thêm dấu ngăn khi chuyển sang văn bản.
            self.khoi.append(('muc', re.sub(r'^(§\d+)\s*', r'\1 · ', t)))
        elif ten == 'ten':
            self._kb['ten'] = t
            self._cho_ten = False
            self._cho_mo_ta = True
        elif ten == 'mo_ta':
            self._kb['mo_ta'] = t
            self._cho_mo_ta = False
        elif ten == 'dt':
            self._kb['meta'].append([t, ''])
        elif ten == 'dd' and self._kb['meta']:
            self._kb['meta'][-1][1] = t
        elif ten == 'canhbao':
            self._kb['canhbao'].append(t)
        elif ten == 'o':
            self._hang.append(t)
        elif ten == 'li':
            if self._trong_mongdoi:
                self._kb['mongdoi'].append(t)
            elif self._trong_canhbao:
                self._kb['canhbao'].append(t)
            else:
                self._kb['buoc'].append(t)


def main():
    b = BocKichBan()
    b.feed(io.open(SRC, encoding='utf-8').read())

    so_kb = sum(1 for loai, _ in b.khoi if loai == 'kb')

    ra = ['# Kịch bản kiểm thử trình duyệt — BI Platform\n']
    ra.append('> Sinh tự động từ `kich-ban-trinh-duyet.html`. **Đừng sửa tay** —')
    ra.append('> sửa file HTML rồi chạy lại `xuat-kich-ban-md.py`.\n')
    ra.append(f'Tổng cộng **{so_kb} kịch bản**. Hai ô cuối mỗi mục để người kiểm điền.\n')

    for loai, x in b.khoi:
        if loai == 'muc':
            ra.append(f'\n## {x}\n')
            continue

        ra.append(f"\n### {x['ma']} · {x['ten']}\n")
        if x['mo_ta']:
            ra.append(f"*{x['mo_ta']}*\n")
        for ten, gt in x['meta']:
            if gt:
                ra.append(f'- **{ten}:** {gt}')
        if x['meta']:
            ra.append('')

        if x['buoc']:
            ra.append('**Các bước:**\n')
            for i, s in enumerate(x['buoc'], 1):
                ra.append(f'{i}. {s}')
            ra.append('')

        if x['bang']:
            dau, than = x['bang'][0], x['bang'][1:]
            ra.append('| ' + ' | '.join(dau) + ' |')
            ra.append('|' + '|'.join(['---'] * len(dau)) + '|')
            for h in than:
                ra.append('| ' + ' | '.join(h) + ' |')
            ra.append('')

        if x['mongdoi']:
            ra.append('**Kết quả mong đợi:**\n')
            for s in x['mongdoi']:
                ra.append(f'- {s}')
            ra.append('')

        for s in x['canhbao']:
            ra.append(f'> ⚠️ {s}\n')

        ra.append('| Kết quả thực tế | Đạt / Không đạt |')
        ra.append('|---|---|')
        ra.append('|  |  |')
        ra.append('')

    io.open(DST, 'w', encoding='utf-8', newline='\n').write('\n'.join(ra))
    print(f'da ghi {DST}: {so_kb} kich ban, {sum(1 for l, _ in b.khoi if l == "muc")} muc')


main()
