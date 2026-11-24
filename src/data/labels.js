// 画面に出る選択肢の表記
// このファイルの名前（name の部分や文字列）は自由に書き換えられます。
// id は記録データとのつながりに使うので、変えないでください。

export const COLORS = [{ id: 'red', name: '赤', word: '燃える' }, { id: 'blue', name: '青', word: '滴る' }, { id: 'yellow', name: '黄', word: '輝く' }, { id: 'green', name: '緑', word: '静まる' }];

export const SIZES = [{ n: 3, name: '壮大' }, { n: 2, name: '端正' }, { n: 1, name: '繊細' }];

export const KINDS = [{ id: 'normal', name: '表', word: '景色' }, { id: 'deep', name: '深層', word: '昏景' }];

// 型。上の3つは前の分け方（old）で、もう選べない（前に作ったプリセットの表示だけに使う）。
// 今の分け方は、近接（ハルハル／片ハル／特定武器）、スペルの魔術（汎用／特化／混成）・祈祷（汎用／特化）、弓（毒／冷気／ナメレス／複合）。
// group：近接 melee／魔術 sorc／祈祷 inc／弓 bow。needWeapon：メイン武器が必須。needSpec：何特化かの選択が必須（sorc＝魔術の系統、inc＝祈祷の系統）
export const STYLES = [{ id: 'melee', name: '近接', old: true }, { id: 'arts', name: '戦技', old: true }, { id: 'caster', name: 'スペル特化', old: true },
  { id: 'm_halhal', name: '近接・ハルハル', short: 'ハルハル', group: 'melee' },
  { id: 'm_kataharu', name: '近接・片ハル', short: '片ハル', group: 'melee' },
  { id: 'm_weapon', name: '近接・特定武器', short: '特定武器', group: 'melee', needWeapon: true },
  { id: 's_gen', name: '魔術・汎用', short: '汎用', group: 'sorc' },
  { id: 's_spec', name: '魔術・特化', short: '特化', group: 'sorc', needSpec: 'sorc' },
  { id: 's_mix', name: '魔術・混成', short: '混成', group: 'sorc' },
  { id: 'i_gen', name: '祈祷・汎用', short: '汎用', group: 'inc' },
  { id: 'i_spec', name: '祈祷・特化', short: '特化', group: 'inc', needSpec: 'inc' },
  { id: 'b_poison', name: '弓・毒', short: '毒', group: 'bow' },
  { id: 'b_frost', name: '弓・冷気', short: '冷気', group: 'bow' },
  { id: 'b_nameless', name: '弓・ナメレス', short: 'ナメレス', group: 'bow' },
  { id: 'b_mix', name: '弓・複合', short: '複合', group: 'bow' }];

export const SPEC_SORC = ['輝剣', '石掘り', 'カーリアの剣', '不可視', '結晶人', '重力', '茨'];

export const SPEC_INC = ['黄金律原理主義', '王都古竜信仰', '巨人の火', '神狩り', '獣', '狂い火', '竜餐'];

export const WEAPON_TYPES = ['短剣', '直剣', '大剣', '特大剣', '刺剣', '重刺剣', '曲剣', '大曲剣', '刀', '両刃剣', '斧', '大斧', '槌', 'フレイル', '大槌', '特大武器',
  '槍', '大槍', '斧槍', '鎌', '鞭', '拳', '爪', '弓', '大弓', 'クロスボウ', 'バリスタ', '松明', '杖', '聖印', '小盾', '中盾', '大盾', 'その他', 'なんでも'];

export const LOSS_AT = [{ id: 'd1', name: '1日目' }, { id: 'd2', name: '2日目' }, { id: 'final', name: '最終戦' }];

export const MODES = [{ id: 'normal', name: '通常' }, { id: 'deep', name: '深き夜' }];

export const PARTY = [{ id: 'solo', name: 'ソロ' }, { id: 'duo', name: 'デュオ' }, { id: 'trio', name: 'トリオ' }];

// 深き夜の深度
export const DEPTHS = [1, 2, 3, 4, 5];

// 夜の王を選んだあとに付けられる印（あれば）
// 「地図欠損」と「ボス不明」はどちらか一方だけ。「地変」はどちらとも一緒に選べる
export const RUN_FLAGS = [{ id: 'mapLoss', name: '地図欠損' }, { id: 'bossUnknown', name: 'ボス不明' }, { id: 'shift', name: '地変' }];

// 地変の種類（地変を選んだときだけ選べる）
export const SHIFTS = [{ id: 'crater', name: '火口' }, { id: 'mountaintop', name: '山嶺' }, { id: 'rotwood', name: '腐れ森' }, { id: 'noklateo', name: 'ノクラテオ' }, { id: 'greathollow', name: '大空洞' }];  // 大空洞はDLC（追加は末尾に）
