#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 PWA 图标（纯标准库，无需 Pillow）。
图案：橙色圆角底 + 白色「碗 + 热气」。
python tools/gen_icons.py
"""
import math
import os
import struct
import zlib

ORANGE = (255, 107, 53)
WHITE = (255, 255, 255)


def shape(u, v):
    """u,v 为图案区归一化坐标(0~1)，返回 True 表示白色图案。"""
    # 碗口横线
    if 0.335 <= v <= 0.400 and 0.060 <= u <= 0.940:
        return True

    # 碗体：下半椭圆环
    if v >= 0.380:
        ro = ((u - 0.5) / 0.420) ** 2 + ((v - 0.380) / 0.440) ** 2
        ri = ((u - 0.5) / 0.345) ** 2 + ((v - 0.380) / 0.365) ** 2
        if ri <= 1.0:
            return False          # 碗内掏空
        if ro <= 1.0:
            return True

    # 底座
    if 0.790 <= v <= 0.855 and 0.400 <= u <= 0.600:
        return True

    # 热气：三条正弦波
    if 0.040 <= v <= 0.300:
        for c in (0.32, 0.50, 0.68):
            t = (v - 0.040) / 0.260
            cu = c + 0.060 * math.sin(t * math.pi * 3)
            slope = 0.060 * math.cos(t * math.pi * 3) * (math.pi * 3 / 0.260)
            d = abs(u - cu) / math.sqrt(1 + slope * slope)
            if d <= 0.026:
                return True
    return False


def write_png(path, size, maskable=False):
    pad = 0.30 if maskable else 0.19        # maskable 需留安全区
    radius = 0.0 if maskable else 0.22      # 圆角比例
    span = size * (1 - 2 * pad)
    ss = 3                                   # 超采样倍数
    inv = 1.0 / (ss * ss)

    rows = bytearray()
    for y in range(size):
        rows.append(0)                       # filter type 0
        for x in range(size):
            # 圆角外的角落透明
            if radius > 0:
                cx = min(max(x / size, radius), 1 - radius)
                cy = min(max(y / size, radius), 1 - radius)
                if (x / size - cx) ** 2 + (y / size - cy) ** 2 > radius ** 2:
                    rows += bytes((0, 0, 0, 0))
                    continue

            hit = 0
            for j in range(ss):
                for i in range(ss):
                    px = x + (i + 0.5) / ss
                    py = y + (j + 0.5) / ss
                    u = (px - pad * size) / span
                    v = (py - pad * size) / span
                    if 0.0 <= u <= 1.0 and 0.0 <= v <= 1.0 and shape(u, v):
                        hit += 1
            a = hit * inv
            r = int(round(ORANGE[0] * (1 - a) + WHITE[0] * a))
            g = int(round(ORANGE[1] * (1 - a) + WHITE[1] * a))
            b = int(round(ORANGE[2] * (1 - a) + WHITE[2] * a))
            rows += bytes((r, g, b, 255))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data +
                struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
           chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    print('  %-26s %6d bytes' % (os.path.basename(path), len(png)))


if __name__ == '__main__':
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(here, 'icons')
    os.makedirs(out, exist_ok=True)
    print('生成图标：')
    write_png(os.path.join(out, 'icon-192.png'), 192)
    write_png(os.path.join(out, 'icon-512.png'), 512)
    write_png(os.path.join(out, 'icon-maskable-512.png'), 512, maskable=True)
    print('完成')
