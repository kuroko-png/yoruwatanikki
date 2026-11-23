"""隠しの夜の王「ゲーミングリブラ」の画像を Images/Glibra.webp から作る。
元画像は背景に灰色の市松模様（透明に見せる模様）が焼き込まれている。
アイコンは模様を消して背景を透明にする（小さく出すので、体に残る跡は目立たない）。
「画像を見る」の大きい画像は、模様を消すと体に跡が残るため、元画像をそのまま使う。
使い方：python tools/make_glibra.py
出力：icons/lords/glibra.png（96×96 のアイコン）、icons/secret/glibra.webp（「画像を見る」で出す大きい画像）"""
import os
import shutil
from PIL import Image, ImageChops, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'Images', 'Glibra.webp')
# 市松模様のマスの境目（元画像で測った値）。横は x=12 から 12.82 ごと、縦は y=13 から 12.85 ごとに色が入れ替わる
X0, CX = 12, (512 - 12) / 39
Y0, CY = 13, (1015 - 13) / 78
DARK, LIGHT = 35, 93  # 市松模様の2色の明るさ
FULL, SOLID = 40, 90  # 模様との差が FULL までは「光（模様に足された明るさ）」、SOLID 以上は「絵そのもの」


def checker(w, h):
    cell = lambda v, v0, c: int((v + 0.5 - v0) // c) + 1
    im = Image.new('L', (w, h))
    im.putdata([LIGHT if (cell(x, X0, CX) + cell(y, Y0, CY)) % 2 else DARK for y in range(h) for x in range(w)])
    return im.filter(ImageFilter.GaussianBlur(0.7)).convert('RGB')  # 元画像のマスの境目のにじみに合わせる


def cutout(src):
    rgb = src.convert('RGB')
    w, h = rgb.size
    P = list(rgb.get_flattened_data()); C = list(checker(w, h).get_flattened_data())
    out = []
    for (r, g, b), (c, _, _) in zip(P, C):
        d = max(abs(r - c), abs(g - c), abs(b - c))
        # 光の部分：模様の上に足された明るさだけを取り出す（黒の上に光が乗った形）
        G = (max(0, r - c), max(0, g - c), max(0, b - c))
        m = max(G)
        a = min(1.0, m / FULL)
        t = 0.0 if d <= FULL else 1.0 if d >= SOLID else (d - FULL) / (SOLID - FULL)
        # 絵そのもの（体や杖）はそのままの色で不透明
        A = a + (1 - a) * t
        if A <= 0.004:
            out.append((0, 0, 0, 0)); continue
        pre = [Gi * (1 - t) + Pi * t for Gi, Pi in zip(G, (r, g, b))]
        out.append(tuple(min(255, int(v / A + 0.5)) for v in pre) + (int(A * 255 + 0.5),))
    img = Image.new('RGBA', (w, h))
    img.putdata(out)
    return img


def main():
    os.makedirs(os.path.join(ROOT, 'icons', 'secret'), exist_ok=True)
    shutil.copyfile(SRC, os.path.join(ROOT, 'icons', 'secret', 'glibra.webp'))
    img = cutout(Image.open(SRC))
    # アイコンは顔（角と目）のあたりを正方形に切り抜く
    icon = img.crop((180, 130, 560, 510)).resize((96, 96), Image.LANCZOS)
    icon.save(os.path.join(ROOT, 'icons', 'lords', 'glibra.png'))
    print('作成しました：icons/secret/glibra.webp, icons/lords/glibra.png')


if __name__ == '__main__':
    main()
