"""PNG アイコンを作る（追加のライブラリ不要）。 python tools/make_icons.py"""
import math, os, struct, zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def pixel(x, y, n, rounded):
    u, v = x / n, y / n
    # 角丸（maskable では全面塗り）
    if rounded:
        r = .22
        cx = min(max(u, r), 1 - r); cy = min(max(v, r), 1 - r)
        if (u - cx) ** 2 + (v - cy) ** 2 > r * r: return (0, 0, 0, 0)
    c = lerp((27, 36, 102), (7, 10, 28), v)
    mx, my = .5, .49
    d = math.hypot(u - mx, v - my)
    glow = max(0, 1 - d / .37) ** 2 * .45
    c = lerp(c, (236, 201, 124), glow)
    scale = .23 if rounded else .19  # maskable は安全領域に収まるよう小さめ
    if d < scale:
        t = min(1, math.hypot(u - (mx - scale * .3), v - (my - scale * .35)) / (scale * 1.4))
        c = lerp((255, 244, 210), (167, 122, 48), t) if t > .4 else lerp((255, 244, 210), (236, 201, 124), t / .4)
        if math.hypot(u - (mx + scale * .37), v - (my - scale * .24)) < scale * .88:
            c = lerp(c, (15, 22, 64), .9)
    return c + (255,)

def png(n, rounded, name):
    raw = bytearray()
    for y in range(n):
        raw.append(0)
        for x in range(n):
            raw.extend(pixel(x + .5, y + .5, n, rounded))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    open(os.path.join(OUT, name), 'wb').write(data)

png(192, True, 'icon-192.png')
png(512, True, 'icon-512.png')
png(512, False, 'icon-512-maskable.png')
png(180, False, 'apple-touch-icon.png')
print('icons written')
