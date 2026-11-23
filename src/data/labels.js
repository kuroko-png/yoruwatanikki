// 画面に出る選択肢の表記
// このファイルの名前（name の部分や文字列）は自由に書き換えられます。
// id は記録データとのつながりに使うので、変えないでください。

export const COLORS = [{ id: 'red', name: '赤', word: '燃える' }, { id: 'blue', name: '青', word: '滴る' }, { id: 'yellow', name: '黄', word: '輝く' }, { id: 'green', name: '緑', word: '静まる' }];

export const SIZES = [{ n: 3, name: '壮大' }, { n: 2, name: '端正' }, { n: 1, name: '繊細' }];

export const KINDS = [{ id: 'normal', name: '表', word: '景色' }, { id: 'deep', name: '深層', word: '昏景' }];

export const STYLES = [{ id: 'melee', name: '近接' }, { id: 'arts', name: '戦技' }, { id: 'caster', name: 'スペル特化' }];

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
