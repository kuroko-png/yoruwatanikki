// みんなに公開するビルドの名前などで、受け付けない言葉（低俗な言葉・公序良俗に反する言葉）
// 受け取り口（tools/online/apps_script.gs）にも同じ一覧があり、そちらでも確かめる。足したいときは両方に足す。
// NG_ANY：ひらがな・カタカナどちらで書かれても弾く（カタカナはひらがなに直してから照らし合わせる）
// NG_KATA：カタカナで書かれたときだけ弾く（ひらがなだと普通の言葉に含まれやすいもの。例：「活かす」の「かす」）
export const NG_ANY = ['しね', 'ころす', 'ころせ', 'ぶっころ', 'きえろ', 'きちがい', 'がいじ', 'ちんこ', 'ちんぽ', 'まんこ', 'うんこ', 'せっくす', 'れいぷ', 'くそ',
  '死ね', '氏ね', '殺す', '殺せ', '殺害', '池沼', '基地外', '糞', 'fuck', 'shit', 'bitch', 'nigger', 'nigga', 'sex'];
export const NG_KATA = ['カス', 'クズ', 'ゴミ', 'ブス', 'デブ', 'ハゲ', 'ガイジ'];

// ゲーム用語として普通に使われる言い回し（判定の前に取り除く）
export const NG_ALLOW = ['カス当たり', 'カスあたり', 'かすあたり'];

export function ngHit(text) {
  let t = String(text || '').normalize('NFKC').toLowerCase();
  NG_ALLOW.forEach(w => { t = t.split(w.toLowerCase()).join(''); });
  t = t.replace(/[^\p{L}]/gu, '');  // 文字以外（記号・伏せ字の○×＊・数字・空白）を取り除いてから照らし合わせる
  const hira = t.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  return NG_ANY.some(w => hira.includes(w)) || NG_KATA.some(w => t.includes(w.toLowerCase()));
}
