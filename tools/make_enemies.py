"""「敵」タブのデータ（src/data/enemies.js）を、英語の表から作る。
使い方：python tools/make_enemies.py
元の表：Recycle氏の「Elden Ring Nightreign - PvE Stats (Calibrations Ver 1.02.3)」（デスクトップの Nightreign フォルダ）
名前の日本語は tools/enemy_names_ja.py（神攻略wikiの表記）。"""
import json, os, re, sys
from collections import defaultdict, OrderedDict
import openpyxl
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from enemy_names_ja import BASE, SPECIAL, VARIANT, TAG
from enemy_kinds import KINDS, NAMES as KIND_NAMES
from enemy_overrides import OVERRIDES
KIND_OF = {n: KINDS.index(k) for k, ns in KIND_NAMES.items() for n in ns}

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(os.path.expanduser('~'), 'Desktop', 'Nightreign', 'Elden Ring Nightreign - PvE Stats (Calibrations Ver 1.02.3).xlsx')
OUT = os.path.join(ROOT, 'src', 'data', 'enemies.js')

PARTY = ['solo', 'duo', 'trio']
SHEETS = {'solo': ('Solo Scaling Data', 'New Nightlords'), 'duo': ('Duos Scaling Data', 'New Nightlords (Duos)'), 'trio': ('Trios Scaling Data', 'New Nightlords (Trios)')}
# 列の位置（0始まり）。通常の表と、夜の王（DLC前の新しい王）の表で並びが違う
COLS = {
    'scaling': dict(hp1=3, hp2=4, neg=range(6, 14), res=range(15, 22), poise=30),
    'lords': dict(hp1=3, hp2=3, neg=range(5, 13), res=range(14, 21), poise=24),
}
LORD_ICON = {  # 夜の王の名前 → アプリのアイコンの id
    'Gladius - Beast of Night': 'gladius', 'Adel - Baron of Night': 'adel', 'Gnoster - Wisdom of Night': 'gnoster',
    'Maris - Fathom of Night': 'maris', 'Augur': 'maris', 'Libra - Creature of Night': 'libra',
    'Fulghor - Champion of Nightglow': 'fulghor', 'Caligo - Miasma of Night': 'caligo', 'Heolstor the Nightlord': 'final',
    'The Shape of Night': 'final', 'Weapon-Bequeathed Harmonia': 'harmonia', "Salvation's Standard-Bearers": 'harmonia',
    'Traitorous Straghess': 'strages', 'Pure Impulse Straghess': 'strages', 'Dreglord': 'strages',
    'Animus - Ascendant Light': 'gnoster',  # グノスターの常夜（Enhanced Boss）
}
LORD_ORDER = list(OrderedDict.fromkeys(LORD_ICON.values())) + [None]
# 「○○ Night Boss」の ○○ → 日本語（夜の強敵の戦いの名前）
NIGHT_FIGHT = {
    'Demi-Human Queen & Sword Master': '亜人の女王＆亜人の剣聖', "Night's Cavalry Duo": '夜の騎兵×2', 'Godskin Duo': '神肌のふたり',
    'Godskins': '神肌のふたり', 'Godskin': '神肌', 'Sentinel': 'ツリーガード', 'Sentinels': 'ツリーガード', 'Tree Spirit': '爛れた樹霊',
    'Dancer': '冷たい谷の踊り子', 'Dragonkin': 'ノクスの竜人兵', 'Dragonkin Soldier': 'ノクスの竜人兵',
    'Crucible Knight Golden Hippo': '坩堝の騎士＆黄金カバ', 'Demi-Human Queen': '亜人の女王',
}
CATS = ['lord', 'night', 'field', 'base', 'mob']
CAT_JA = ['夜の王', '夜の強敵', 'フィールド', '拠点', '雑魚']
# フィールドのうち「恐るべき強敵」（神攻略wiki フィールドボスのページより。飛竜＝丘陵の飛竜として扱う）
FIELD_DREAD = {'黄金樹の化身', 'カーリアの親衛騎士', '丘陵の飛竜', '飛竜', '黒き剣の眷属', '死儀礼の鳥', '鈴玉狩り', '祖霊', '爛れた樹霊', 'ツリーガード', '溶岩土竜', '竜のツリーガード'}
# 拠点の見出し → 場所・場面の表記
BASE_TYPES = [('大教会', ['大教会']), ('大野営地', ['大野営地']), ('大遺跡', ['大遺跡', '大遺跡（山嶺）']), ('小砦', ['小砦', '小砦（結晶人）']),
              ('砦(屋上)', ['砦（屋上）']), ('砦(地下)', ['砦（地下）'])]
SIZE = {'Large', 'Medium', 'Small'}  # ( ) の中の大きさは、場所ではなく名前の違いとして扱う


def places(cat, ja, tag, kind):
    """フィールド・拠点・雑魚で、どの見出しに出すか [[種類の番号, 見出し], ...]（tools/enemy_overrides.py で上書きできる）"""
    base = re.sub(r'[(（].*[)）]$', '', ja)
    if cat == 'field':
        return [[2, '封牢' if '封牢' in tag else '恐るべき強敵' if base in FIELD_DREAD else '通常']]
    if cat == 'base':
        return [[3, next((h for h, tags in BASE_TYPES if tag in tags), 'その他')]]
    if cat == 'mob':
        return [[4, KINDS[kind]]]
    return []
# ボスの場所 → フィールド / 拠点（2026-11-23 確認：封牢と山嶺の氷竜はフィールド、城の屋上・地下は拠点）
FIELD_TAGS = {'Field Boss', 'Demi-Human Queen Field Boss', 'Boss',  # Boss＝山嶺の氷竜
              'Evergaol Boss', 'Godskin Duo Evergaol Boss', 'The Oldest Gaol'}
BASE_TAGS = {'Fort Boss', 'Camp Boss', 'Ruins Boss', 'Cathedral Boss', 'Mountaintop Ruins Boss', 'Noklateo Boss', 'Crystalian Alliance; Fort Boss',
             'Castle Rooftop Boss', 'Castle Basement Boss'}
# 夜の強敵：どの戦いに属するか。本体（ボス）と前哨戦（取り巻き・雑魚）に分ける
FIGHT_OF_MAIN = {'亜人の女王': '亜人の女王＆亜人の剣聖', '亜人の剣聖': '亜人の女王＆亜人の剣聖', '坩堝の騎士': '坩堝の騎士＆黄金カバ',
                 '黄金カバ': '坩堝の騎士＆黄金カバ', '竜人兵': 'ノクスの竜人兵', 'ミミズ顔(大)': 'ミミズ顔'}
FIGHT_ALIAS = {'降る星の獣': '降る星の成獣', '神肌': '神肌のふたり', 'ティビアの呼び舟の召喚': 'ティビアの呼び舟', 'ティビアの呼び舟の胴': 'ティビアの呼び舟',
               '夜の強敵の前哨': 'その他の前哨戦'}
BOSS_IN_FIGHT = {'神肌の使徒', '神肌の貴種', '夜の騎兵(グレイブ)', '夜の騎兵(フレイル)', '嵐の竜'}


def fight_of(name, tag):
    """夜の強敵の行が、どの戦いの本体('b')か前哨戦('p')か"""
    if not tag:
        return FIGHT_OF_MAIN.get(name, name), 'b'
    f = tag[:-1] if tag.endswith('戦') else tag
    f = FIGHT_ALIAS.get(f, f)
    return f, 'b' if name in BOSS_IN_FIGHT or f == 'ティビアの呼び舟' and tag.startswith('ティビアの呼び舟の') else 'p'


def parse(name):
    name = str(name).strip()
    if name in SPECIAL:
        ja, tag = SPECIAL[name]
        return name, ja, None, tag
    m = re.match(r'^(.*?)\s*(?:\[(.*?)\])?\s*(?:\((.*?)\))?\s*$', name)
    return m.group(1).strip(), None, m.group(2), m.group(3)


def num(v):
    if v is None or isinstance(v, str):
        return None  # Immune（無効）や「-」
    return v


def read(party):
    """その人数の表を読み、(名前, ID) ごとの数値の一覧を返す"""
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    out = defaultdict(list)
    for sheet, kind in zip(SHEETS[party], ('scaling', 'lords')):
        c = COLS[kind]
        for r in list(wb[sheet].iter_rows(values_only=True))[2:]:
            if not r[0]:
                continue
            out[(str(r[0]).strip(), str(r[1]))].append(dict(
                hp=(num(r[c['hp1']]), num(r[c['hp2']])),
                neg=[num(r[i]) for i in c['neg']],
                res=[num(r[i]) for i in c['res']],
                poise=num(r[c['poise']]) if len(r) > c['poise'] else None,
            ))
    return out


def category(base, tag):
    t = tag or ''
    # 練習用・未使用かもしれないもの・追憶のボス（不要と決めた）は載せない
    if base in ('Training Dummy',) or t in ('Training', 'Tutorial', 'Limveld but maybe unused?', 'Silly Worm'):
        return None
    if 'Remembrance' in base or base.startswith('Revenant:'):
        return None
    if base in LORD_ICON:
        return 'lord'
    if t.endswith('Night Boss') or t in ('Night Boss Enemy', 'Tibia Mariner Summon', 'Tibia Mariner Torso'):
        return 'night'
    if t in FIELD_TAGS:
        return 'field'
    if t in BASE_TAGS:
        return 'base'
    return 'mob'


def tag_ja(base, tag):
    if not tag:
        return ''
    if tag in TAG:
        return TAG[tag]
    for suffix, label in ((' Night Boss', '戦'), (' Field Boss', '戦（フィールド）')):
        if tag.endswith(suffix):
            who = tag[:-len(suffix)]
            if who == base:
                return ''
            ja = NIGHT_FIGHT.get(who) or BASE.get(who)
            return f'{ja}{label}' if ja else tag
    return tag


def rng(vals):
    vals = [round(v) for v in vals if v is not None]
    return [min(vals), max(vals)] if vals else None


def main():
    data = {p: read(p) for p in PARTY}
    groups = OrderedDict()
    missing = set()
    for (name, id_), rows in data['solo'].items():
        base, ja, var, tag = parse(name)
        ov = OVERRIDES.get(name, {})
        if ov.get('delete'):
            continue
        # 「(Large)」「(Small; Crater)」の大きさは名前の側へ（例：腐った亡者(大・災域)、飛竜(小)｜火口）
        if tag in SIZE or (tag or '').startswith('Small; '):
            size, tag = (tag, None) if tag in SIZE else ('Small', tag[len('Small; '):])
            var = size + (', ' + var if var else '')
        cat = category(base, tag)
        if not cat:
            continue
        if ja is None:
            ja = BASE.get(base)
            if ja is None:
                missing.add(base)
                continue
        if var:
            ja += '(' + '・'.join(VARIANT.get(v.strip(), v.strip()) for v in var.split(',')) + ')'
        for i, s in enumerate(rows):
            others = {p: (data[p].get((name, id_)) or [None] * (i + 1))[min(i, len(data[p].get((name, id_)) or [None]) - 1)] for p in ('duo', 'trio')}
            key = (cat, ja, ov.get('scene', tag_ja(base, tag)), name if ov.get('place') else '', json.dumps(s['neg']), json.dumps(s['res']), round(s['poise'] or -1))
            g = groups.setdefault(key, dict(cat=cat, name=ja, tag=key[2], en=name, place=ov.get('place'), icon=LORD_ICON.get(base), neg=s['neg'], res=s['res'],
                                            hp={p: [] for p in PARTY}, poise={p: [] for p in PARTY}))
            for p, row in (('solo', s), ('duo', others['duo']), ('trio', others['trio'])):
                if row:
                    g['hp'][p].append(row['hp'])
                    g['poise'][p].append(row['poise'])
    if missing:
        print('日本語名がない敵：', sorted(missing))

    out = []
    for g in groups.values():
        hp = [[*(rng([h[0] for h in g['hp'][p]]) or [None, None]), *(rng([h[1] for h in g['hp'][p]]) or [None, None])] for p in PARTY]
        poise = [rng(g['poise'][p]) for p in PARTY]
        poise = [(x[0] if x and x[0] == x[1] else x) for x in poise]
        neg = [round(v) if v is not None else None for v in g['neg']]
        res = [round(v) if v is not None else None for v in g['res']]
        fight = fight_of(g['name'], g['tag']) if g['cat'] == 'night' else (None, None)
        kind = KIND_OF.get(re.sub(r'[(（].*[)）]$', '', g['name']), len(KINDS) - 1)  # 雑魚の種類（見出し用）
        pl = [[CAT_JA.index(c), h] for c, h in g['place']] if g['place'] else places(g['cat'], g['name'], g['tag'], kind)
        cat = pl[0][0] if pl else CATS.index(g['cat'])  # 手直しで別のカテゴリに移したものは、移した先を主にする
        out.append([cat, g['name'], g['tag'], g['en'], g['icon'], hp, neg, res, poise, *fight, kind, pl])
    # 並び：種類 → 夜の王は王の順 → 名前
    out.sort(key=lambda e: (e[0], LORD_ORDER.index(e[4]) if e[0] == 0 else 0, e[1], e[2]))

    js = ('// 「敵」タブのデータ。tools/make_enemies.py で作る（手で直さないでください）\n'
          '// 出典：Recycle氏「Elden Ring Nightreign - PvE Stats」Calibrations Ver 1.02.3（2025年9月）。DLC（1.03）以降の調整・DLCの敵は含まない\n'
          '// 1行 = [種類(0夜の王 1夜の強敵 2フィールド 3拠点 4雑魚), 名前, 場所・場面, 英語名, 夜の王のアイコンid,\n'
          '//        HP[ソロ/デュオ/トリオ][1日目の最小,最大, 2日目の最小,最大], カット率[標準,斬撃,打撃,刺突,魔力,炎,雷,聖],\n'
          '//        状態異常耐性[毒,腐敗,出血,冷気,睡眠,発狂,死](nullは無効), 崩し値[ソロ,デュオ,トリオ]（数値か[最小,最大]、nullは不明）,\n'
          '//        夜の強敵の戦いの名前, 本体b/前哨戦p, 雑魚の種類, 出す見出し[[種類, 見出し], ...]（フィールド・拠点・雑魚）]\n'
          'export const ENEMIES = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(js)
    print(f'{len(out)}件を書き出しました（{os.path.getsize(OUT) // 1024}KB）', {c: sum(1 for e in out if e[0] == i) for i, c in enumerate(CATS)})


if __name__ == '__main__':
    main()
