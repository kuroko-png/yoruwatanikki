"""夜の王・夜渡りのアイコンを Images/ の元画像から切り出して、アプリ用の小さな画像にする。
使い方：python tools/make_unit_icons.py
出力：icons/lords/<夜の王のid>.png、icons/chars/<夜渡りのid>.png（96×96、背景は透明）
元画像を差し替えたら、もう一度実行してください。"""
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'Images')
SIZE = 96  # 画面では 24〜32px で表示する（高精細な画面でもにじまないよう大きめに作る）

# 1枚の画像に複数のアイコンが並んでいるものは、左上から右へ、上から下へ読む順に id を並べる
SHEETS = [
    ('Nightfearer.png', 'chars', ['wylder', 'guardian', 'ironeye', 'duchess', 'raider', 'revenant', 'recluse', 'executor', 'scholar']),
    ('葬儀屋.webp', 'chars', ['undertaker']),
    ('グラディウス.png', 'lords', ['gladius']),
    ('エデレ マリス　グノスター.png', 'lords', ['adel', None, 'gnoster']),  # 真ん中のマリスは、単体の マリス.png を使う
    ('マリス.png', 'lords', ['maris']),
    ('ナメレス　リブラ　ストラゲス　ハルモニア.png', 'lords', [None, 'libra', 'strages', 'harmonia']),  # 左上のナメレスは、単体の ナメレス.png を使う
    ('ナメレス.png', 'lords', ['final']),
    ('フルゴール.png', 'lords', ['fulghor']),
    ('カリゴ.png', 'lords', ['caligo']),
]


def runs(profile, thr=3, min_len=40):
    """1列に並んだ濃さの値から、絵がある区間（開始, 終了）を探す"""
    out, start = [], None
    for i, v in enumerate(list(profile) + [0]):
        if v > thr and start is None:
            start = i
        if v <= thr and start is not None:
            if i - start > min_len:
                out.append((start, i))
            start = None
    return out


def boxes(im):
    """透明でない部分のまとまりを、読む順（上の段から、左から）に返す"""
    mask = im.getchannel('A').point(lambda v: 255 if v > 160 else 0)
    W, H = mask.size
    found = []
    for c0, c1 in runs(mask.resize((W, 1), Image.BOX).get_flattened_data()):
        sub = mask.crop((c0, 0, c1, H))
        for r0, r1 in runs(sub.resize((1, H), Image.BOX).get_flattened_data()):
            found.append((c0, r0, c1, r1))
    found.sort(key=lambda b: (round(b[1] / 150), b[0]))  # だいたい同じ高さなら同じ段
    return found


def square_icon(im, box):
    c0, r0, c1, r1 = box
    w, h = c1 - c0, r1 - r0
    side = int(max(w, h) * 1.06)  # 少しだけ余白を付ける
    # 絵の範囲だけを切り取り（隣のアイコンが入り込まないように）、透明な正方形の真ん中に置く
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(im.crop(box), ((side - w) // 2, (side - h) // 2))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    for name, kind, ids in SHEETS:
        im = Image.open(os.path.join(SRC, name)).convert('RGBA')
        found = boxes(im)
        if len(found) != len(ids):
            raise SystemExit(f'{name}: アイコンが{len(ids)}個のはずが{len(found)}個見つかりました')
        out_dir = os.path.join(ROOT, 'icons', kind)
        os.makedirs(out_dir, exist_ok=True)
        for box, id_ in zip(found, ids):
            if id_:
                square_icon(im, box).save(os.path.join(out_dir, f'{id_}.png'), optimize=True)
                print(f'{kind}/{id_}.png')


if __name__ == '__main__':
    main()
