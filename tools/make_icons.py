"""Render the extension icons (no third-party deps): a blue squircle with two
caption lines. Run: python3 tools/make_icons.py"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
SS = 4  # supersampling


def png(path, w, h, rgba):
    raw = b''.join(b'\x00' + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h))

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))


def in_rrect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def render(size):
    n = size * SS
    acc = [[0.0] * 4 for _ in range(size * size)]
    m = 0.06  # margin
    for py in range(n):
        for px in range(n):
            u = (px + 0.5) / n
            v = (py + 0.5) / n
            if not in_rrect(u, v, m, m, 1 - m, 1 - m, 0.23):
                continue
            # diagonal gradient #3a9bff -> #5e5ce6
            t = (u + v) / 2
            col = [0x3a + (0x5e - 0x3a) * t, 0x9b + (0x5c - 0x9b) * t, 0xff + (0xe6 - 0xff) * t, 255]
            # caption lines
            if in_rrect(u, v, 0.22, 0.43, 0.78, 0.53, 0.05):
                col = [255, 255, 255, 255]
            elif in_rrect(u, v, 0.30, 0.61, 0.70, 0.69, 0.04):
                a = 0.7
                col = [col[0] * (1 - a) + 255 * a, col[1] * (1 - a) + 255 * a, col[2] * (1 - a) + 255 * a, 255]
            cell = acc[(py // SS) * size + (px // SS)]
            for i in range(3):
                cell[i] += col[i] * col[3] / 255
            cell[3] += col[3]
    out = []
    for r, g, b, a in acc:
        cov = a / (SS * SS)
        if a:
            out += [round(r * 255 / a), round(g * 255 / a), round(b * 255 / a), round(cov)]
        else:
            out += [0, 0, 0, 0]
    return out


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for s in (16, 32, 48, 128):
        png(os.path.join(OUT, f'icon{s}.png'), s, s, render(s))
        print('icon', s)
