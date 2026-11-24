// 夜渡り
// このファイルの名前（name の部分や文字列）は自由に書き換えられます。
// id は記録データとのつながりに使うので、変えないでください。

export const CHARS = [
  { id: 'wylder', name: '追跡者' }, { id: 'guardian', name: '守護者' }, { id: 'ironeye', name: '鉄の目' },
  { id: 'duchess', name: 'レディ' }, { id: 'raider', name: '無頼漢' }, { id: 'revenant', name: '復讐者' },
  { id: 'recluse', name: '隠者' }, { id: 'executor', name: '執行者' }, { id: 'scholar', name: '学者' },
  { id: 'undertaker', name: '葬儀屋' },
];

// 夜渡りの得意武器（神攻略wiki の各夜渡りのページ「得意武器」より、2026-11-24）。復讐者・隠者は「なし」
export const FAV_WEAPONS = {
  wylder: ['大剣'], guardian: ['斧槍'], ironeye: ['弓'], duchess: ['短剣'], raider: ['大斧', '大槌', '特大武器'],
  revenant: [], recluse: [], executor: ['刀'], scholar: ['刺剣'], undertaker: ['槌'],
};
