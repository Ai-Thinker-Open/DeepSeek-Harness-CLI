#!/usr/bin/env python3
"""Render a captured ANSI terminal session into a PNG screenshot.

Usage: python3 scripts/ansi2png.py <capture.txt> <out.png> [cols] [rows]
Handles: CSI cursor positioning (H/f), erase (J/K), SGR colors (24-bit +
16-color + bold/underline/inverse), and skips OSC/other escapes.
"""
import sys
import re
from PIL import Image, ImageDraw, ImageFont

ANSI16_FG = [
    (0, 0, 0), (205, 49, 49), (13, 188, 121), (229, 229, 16),
    (36, 114, 200), (188, 63, 188), (17, 168, 205), (229, 229, 229),
    (102, 102, 102), (241, 76, 76), (35, 209, 139), (245, 245, 67),
    (59, 142, 234), (214, 112, 214), (41, 184, 219), (255, 255, 255),
]
ANSI16_BG = [c for c in ANSI16_FG]

def xterm256(n):
    if n < 16:
        return ANSI16_FG[n]
    if n < 232:
        n -= 16
        r = n // 36
        g = (n % 36) // 6
        b = n % 6
        vals = [0, 95, 135, 175, 215, 255]
        return (vals[r], vals[g], vals[b])
    v = 8 + (n - 232) * 10
    return (v, v, v)

def parse_sgr(params, state):
    i = 0
    p = [int(x) if x else 0 for x in params.split(';')]
    while i < len(p):
        c = p[i]
        if c == 0:
            state['fg'] = None
            state['bg'] = None
            state['bold'] = False
            state['inv'] = False
        elif c == 1:
            state['bold'] = True
        elif c == 4:
            state['underline'] = True
        elif c == 7:
            state['inv'] = True
        elif 30 <= c <= 37:
            state['fg'] = ANSI16_FG[c - 30]
        elif 90 <= c <= 97:
            state['fg'] = ANSI16_FG[c - 90 + 8]
        elif 40 <= c <= 47:
            state['bg'] = ANSI16_BG[c - 40]
        elif 100 <= c <= 107:
            state['bg'] = ANSI16_BG[c - 100 + 8]
        elif c == 38 and i + 1 < len(p) and p[i + 1] == 2:
            state['fg'] = (p[i + 2], p[i + 3], p[i + 4])
            i += 4
        elif c == 48 and i + 1 < len(p) and p[i + 1] == 2:
            state['bg'] = (p[i + 2], p[i + 3], p[i + 4])
            i += 4
        elif c == 38 and i + 1 < len(p) and p[i + 1] == 5:
            state['fg'] = xterm256(p[i + 2])
            i += 2
        elif c == 48 and i + 1 < len(p) and p[i + 1] == 5:
            state['bg'] = xterm256(p[i + 2])
            i += 2
        i += 1

def render(data, cols, rows, font_path, font_size, cell_w, cell_h):
    import sys as _sys
    grid = [[{'ch': ' ', 'fg': None, 'bg': None, 'bold': False, 'inv': False} for _ in range(cols)] for _ in range(rows)]
    state = {'fg': None, 'bg': None, 'bold': False, 'inv': False, 'underline': False}
    r = c = 0

    i = 0
    n = len(data)
    while i < n:
        ch = data[i]
        if ch == '\x1b':
            if i + 1 < n and data[i + 1] == '[':
                # consume a CSI: ESC [ params? letter
                t = i + 2
                while t < n and (data[t].isdigit() or data[t] in ';?'):
                    t += 1
                if t < n and 'A' <= data[t] <= 'z':
                    params = data[i + 2:t]
                    term = data[t]
                    if term == 'm':
                        parse_sgr(params, state)
                    elif term in ('H', 'f'):
                        parts = params.split(';')
                        rr = int(parts[0]) if parts[0] else 1
                        cc = int(parts[1]) if len(parts) > 1 and parts[1] else 1
                        r = max(0, rr - 1)
                        c = max(0, cc - 1)
                    elif term == 'J':
                        code = int(params) if params else 0
                        if code == 2 or code == 3:
                            for rr in range(rows):
                                for cc in range(cols):
                                    grid[rr][cc] = {'ch': ' ', 'fg': None, 'bg': None, 'bold': False, 'inv': False}
                    elif term == 'K':
                        code = int(params) if params else 0
                        if code == 0 or code == 2:
                            for cc in range(c, cols):
                                grid[r][cc] = {'ch': ' ', 'fg': None, 'bg': None, 'bold': False, 'inv': False}
                    elif term == 'A':  # cursor up
                        r = max(0, r - (int(params) if params else 1))
                    elif term == 'B':  # cursor down
                        r = min(rows - 1, r + (int(params) if params else 1))
                    elif term == 'C':  # cursor forward
                        c = min(cols - 1, c + (int(params) if params else 1))
                    elif term == 'D':  # cursor back
                        c = max(0, c - (int(params) if params else 1))
                    elif term == 'G':  # horizontal position
                        c = max(0, (int(params) if params else 1) - 1)
                    i = t + 1
                    continue
            # OSC or other escape: bounded terminator search, else skip 2
            window = data[i + 1:i + 4097]
            j = window.find('\x07')
            k = window.find('\x1b\\')
            if j != -1 and (k == -1 or j < k):
                i += 1 + j + 1
                continue
            if k != -1:
                i += 1 + k + 2
                continue
            i += 2
            continue
        elif ch == '\n':
            r += 1
            c = 0
            i += 1
            continue
        elif ch == '\r':
            c = 0
            i += 1
            continue
        elif ch == '\b':
            c = max(0, c - 1)
            i += 1
            continue
        else:
            if 0 <= r < rows and 0 <= c < cols:
                grid[r][c] = {
                    'ch': ch, 'fg': state['fg'], 'bg': state['bg'],
                    'bold': state['bold'], 'inv': state['inv'],
                }
            c += 1
        i += 1

    print('parse done', file=_sys.stderr)
    # background color of the app: base surface #151517
    bg_base = (21, 21, 23)
    img = Image.new('RGB', (cols * cell_w, rows * cell_h), bg_base)
    print('img created', file=_sys.stderr)
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(font_path, font_size)

    for rr in range(rows):
        for cc in range(cols):
            cell = grid[rr][cc]
            if cell['bg'] is not None:
                draw.rectangle([cc * cell_w, rr * cell_h, (cc + 1) * cell_w - 1, (rr + 1) * cell_h - 1], fill=cell['bg'])
            ch = cell['ch']
            if ch == ' ':
                continue
            fg = cell['fg'] if cell['fg'] is not None else (249, 250, 251)
            if cell['inv']:
                bg = cell['bg'] if cell['bg'] is not None else (21, 21, 23)
                fg, bg = bg, fg
                draw.rectangle([cc * cell_w, rr * cell_h, (cc + 1) * cell_w - 1, (rr + 1) * cell_h - 1], fill=bg)
            try:
                draw.text((cc * cell_w + 1, rr * cell_h), ch, font=font, fill=fg)
            except Exception:
                pass
    print('pil done', file=_sys.stderr)
    return img

def main():
    src, out = sys.argv[1], sys.argv[2]
    cols = int(sys.argv[3]) if len(sys.argv) > 3 else 100
    rows = int(sys.argv[4]) if len(sys.argv) > 4 else 28
    data = open(src, 'rb').read().decode('utf-8', errors='replace')
    font_size = 18
    cell_w, cell_h = 11, 22  # DejaVu Sans Mono 18px metrics
    img = render(data, cols, rows, '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', font_size, cell_w, cell_h)
    img = img.resize((img.width * 2, img.height * 2), Image.NEAREST)
    img.save(out)
    print(f'saved {out} {img.width}x{img.height}')

if __name__ == '__main__':
    main()
