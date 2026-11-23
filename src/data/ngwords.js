// みんなに公開するビルドの名前などで、受け付けない言葉（低俗な言葉・公序良俗に反する言葉）
// 受け取り口（tools/online/apps_script.gs）にも同じ一覧があり、そちらでも確かめる。足したいときは両方に足す。
// NG_ANY：ひらがな・カタカナどちらで書かれても弾く（カタカナはひらがなに直してから照らし合わせる）
// NG_KATA：カタカナで書かれたときだけ弾く（ひらがなだと普通の言葉に含まれやすいもの。例：「活かす」の「かす」）
export const NG_ANY = ['しね', 'ころす', 'ころせ', 'ぶっころ', 'きえろ', 'きちがい', 'がいじ', 'ちんこ', 'ちんぽ', 'まんこ', 'うんこ', 'せっくす', 'れいぷ', 'くそ',
  '死ね', '氏ね', '殺す', '殺せ', '殺害', '池沼', '基地外', '糞', 'fuck', 'shit', 'bitch', 'nigger', 'nigga', 'sex'];
export const NG_KATA = ['カス', 'クズ', 'ゴミ', 'ブス', 'デブ', 'ハゲ', 'ガイジ'];

export function ngHit(text) {
  const t = String(text || '').normalize('NFKC').toLowerCase().replace(/[\s・、。,.!?！？ー〜~_\-]/g, '');
  const hira = t.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  return NG_ANY.some(w => hira.includes(w)) || NG_KATA.some(w => t.includes(w.toLowerCase()));
}
