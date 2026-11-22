"""アプリのアイコン（ホーム画面・ブラウザのタブ・画面左上のロゴ）を、元画像 Images/Icon.webp から作る。
使い方：python tools/make_app_icons.py
元画像を差し替えたら、もう一度実行してください。"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'Images', 'Icon.webp')
OUT = os.path.join(ROOT, 'icons')

TOP, BOTTOM = (27, 36, 102), (7, 10, 28)  # アプリの夜空と同じ色（上→下）


def orb():
    """元画像の、絵がある部分だけを正方形に切り出す"""
    im = Image.open(SRC).convert('RGBA')
    box = im.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
    c0, r0, c1, r1 = box
    side = max(c1 - c0, r1 - r0)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(im.crop(box), ((side - (c1 - c0)) // 2, (side - (r1 - r0)) // 2))
    return sq


def night(n):
    """上が明るく下が暗い、夜空のグラデーションの正方形"""
    bg = Image.new('RGBA', (n, n))
    d = ImageDraw.Draw(bg)
    for y in range(n):
        t = y / (n - 1)
        d.line([(0, y), (n, y)], fill=tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)) + (255,))
    return bg


def on_night(src, n, scale):
    """夜空の上に、絵を scale（一辺に対する割合）の大きさで真ん中に置く"""
    bg = night(n)
    s = round(n * scale)
    bg.alpha_composite(src.resize((s, s), Image.LANCZOS), ((n - s) // 2, (n - s) // 2))
    return bg.convert('RGB')


def main():
    src = orb()
    on_night(src, 512, .86).save(os.path.join(OUT, 'icon-512.png'), optimize=True)
    on_night(src, 192, .86).save(os.path.join(OUT, 'icon-192.png'), optimize=True)
    on_night(src, 180, .86).save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)   # iPhone のホーム画面
    on_night(src, 512, .72).save(os.path.join(OUT, 'icon-512-maskable.png'), optimize=True)  # Android で丸く切られても欠けない大きさ
    src.resize((64, 64), Image.LANCZOS).save(os.path.join(OUT, 'favicon.png'), optimize=True)  # ブラウザのタブ（背景は透明）
    src.resize((96, 96), Image.LANCZOS).save(os.path.join(OUT, 'logo.png'), optimize=True)     # 画面左上のロゴ（背景は透明）
    print('icons を作りました')


if __name__ == '__main__':
    main()
