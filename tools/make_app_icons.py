"""アプリのアイコン（ホーム画面・ブラウザのタブ・画面左上のロゴ）を、元画像 Images/Icon2.png から作る。
使い方：python tools/make_app_icons.py
元画像を差し替えたら、もう一度実行してください。"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'Images', 'Icon2.png')  # 2026-11-23 差し替え（元：Icon.webp）
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


# 画面下のタブのアイコン（元画像のファイル名 → タブの id）
TABS = {'記録.webp': 'record', '履歴.webp': 'history', '統計.webp': 'stats', 'ビルド2.webp': 'builds', '敵.webp': 'enemies'}


def tab_icon(path):
    """白黒の線画を、白い部分だけが形になる「型」にする（色はアプリ側で付ける：普段は淡い色、選ぶと金色）"""
    im = Image.open(path).convert('RGBA')
    gray = im.convert('L')
    alpha = im.getchannel('A').point(lambda v: 0 if v < 40 else v)  # 周りの細かい点を消す
    shape = Image.composite(gray, Image.new('L', im.size, 0), alpha)  # 白いほど濃く、黒い線は抜ける
    box = shape.point(lambda v: 255 if v > 40 else 0).getbbox()  # 背景が黒く塗られた絵でも、絵のある所だけを切り出す
    c0, r0, c1, r1 = box
    side = max(c1 - c0, r1 - r0)
    sq = Image.new('L', (side, side), 0)
    sq.paste(shape.crop(box), ((side - (c1 - c0)) // 2, (side - (r1 - r0)) // 2))
    out = Image.new('RGBA', (side, side), (255, 255, 255, 0))
    out.putalpha(sq)
    return out.resize((96, 96), Image.LANCZOS)


def main():
    os.makedirs(os.path.join(OUT, 'tabs'), exist_ok=True)
    for name, id_ in TABS.items():
        tab_icon(os.path.join(ROOT, 'Images', name)).save(os.path.join(OUT, 'tabs', f'{id_}.png'), optimize=True)
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
