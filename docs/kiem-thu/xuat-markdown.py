# -*- coding: utf-8 -*-
"""
Sinh bản Markdown của bộ test case từ chính file HTML đã xuất bản.

Lý do đọc lại HTML thay vì gõ lại: hai bản phải nói cùng một điều. Gõ tay hai
lần là cách chắc chắn nhất để chúng lệch nhau sau lần sửa đầu tiên.
"""
import io
import re
import sys
from html.parser import HTMLParser

SRC, DST = sys.argv[1], sys.argv[2]


class BocBang(HTMLParser):
    """Bóc các <section class="mod"> thành cấu trúc thuần Python."""

    def __init__(self):
        super().__init__()
        self.modules = []      # [{'ten': str, 'hang': [[ô, ...], ...]}]
        self._trong_section = False
        self._trong_h3 = False
        self._trong_o = False
        self._o = []
        self._hang = []
        self._buf = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'section' and 'mod' in (a.get('class') or ''):
            self._trong_section = True
            self.modules.append({'ten': '', 'hang': []})
        elif self._trong_section and tag == 'h3':
            self._trong_h3 = True
            self._buf = []
        elif self._trong_section and tag == 'tr':
            self._hang = []
        elif self._trong_section and tag in ('td', 'th'):
            self._trong_o = True
            self._buf = []
        elif self._trong_o and tag == 'br':
            self._buf.append(' · ')
        elif self._trong_o and tag == 'span' and 'src' in (a.get('class') or ''):
            # Ghi chú nguồn nằm trong <span class="src">. Không chèn dấu ngăn thì
            # nó dính liền vào câu trước và đọc thành một câu vô nghĩa.
            self._buf.append(' — ')

    def handle_endtag(self, tag):
        if tag == 'section' and self._trong_section:
            self._trong_section = False
        elif tag == 'h3' and self._trong_h3:
            self.modules[-1]['ten'] = self._gom()
            self._trong_h3 = False
        elif tag in ('td', 'th') and self._trong_o:
            self._o = self._gom()
            self._hang.append(self._o)
            self._trong_o = False
        elif tag == 'tr' and self._trong_section and self._hang:
            self.modules[-1]['hang'].append(self._hang)
            self._hang = []

    def handle_data(self, d):
        if self._trong_h3 or self._trong_o:
            self._buf.append(d)

    def _gom(self):
        t = ''.join(self._buf)
        t = re.sub(r'\s+', ' ', t).strip()
        # Ống dọc sẽ phá cấu trúc bảng Markdown.
        return t.replace('|', '/')


def main():
    html = io.open(SRC, encoding='utf-8').read()
    b = BocBang()
    b.feed(html)

    # Đếm TRƯỚC khi in phần đầu: số ở đầu tài liệu và số trong bảng phải đến
    # từ cùng một phép đếm. Gõ tay một trong hai là cách chắc chắn nhất để
    # chúng lệch nhau ngay sau lần sửa đầu tiên.
    tong = sum(len(m['hang']) - 1 for m in b.modules if m['hang'])
    dat = sum(
        1
        for m in b.modules
        for h in m['hang'][1:]
        if 'Đạt' in h[-1] and 'Không' not in h[-1]
    )

    ra = []
    ra.append('# Bộ test case — Nền tảng BI Platform\n')
    ra.append('> Sinh tự động từ hồ sơ kiểm thử. **Đừng sửa tay** — sửa file')
    ra.append('> `bo-test-case.html` rồi chạy lại `xuat-markdown.py`.\n')
    ra.append('| | |')
    ra.append('|---|---|')
    ra.append('| Ngày chạy | 19/08/2026 |')
    ra.append('| Nhánh | `main` @ 8e80985 |')
    ra.append('| Môi trường | localhost · MySQL 8.0.46 · ClickHouse 25.8 · Cube.js · MinIO · Redis |')
    ra.append(f'| Tổng số ca | {tong} ({dat} đạt · {tong - dat} không đạt) |')
    ra.append('| Đối chiếu bộ tự động | 558 ca — lần chạy cuối 558/558 đạt |')
    ra.append('')
    ra.append('Cột **Kết quả thực tế** chép nguyên văn thứ hệ thống trả về khi chạy,')
    ra.append('không phải kết quả suy ra từ mã nguồn.\n')

    for m in b.modules:
        if not m['hang']:
            continue
        ra.append(f"\n## {m['ten']}\n")
        dau, than = m['hang'][0], m['hang'][1:]
        ra.append('| ' + ' | '.join(dau) + ' |')
        ra.append('|' + '|'.join(['---'] * len(dau)) + '|')
        for h in than:
            ra.append('| ' + ' | '.join(h) + ' |')

    ra.append(f'\n---\n\n**Tổng cộng: {dat}/{tong} ca đạt.**\n')

    io.open(DST, 'w', encoding='utf-8', newline='\n').write('\n'.join(ra))
    print(f'da ghi {DST}: {len(b.modules)} module, {tong} ca, {dat} dat')


main()
