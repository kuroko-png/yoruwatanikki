// ゲームの「遺物儀式」画面のスクショから、遺物3つ分（表なら1〜3、深層なら4〜6）の色と効果を読み取る。
// 文字の読み取りは tesseract.js（初回だけネットから読み込む。画像は端末の外へ送らない）。
// 読み取った文字は、アプリにある効果の名前と照らし合わせて一番近いものを選ぶ（多少の読み間違いは吸収できる）。
// 画面の位置は、16:9 のスクショを 2000×1125 に縮めたときの座標（PS5 の 4K・1080p のスクショで確認）。

const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const ROWS = [458, 520, 583, 662, 725, 787, 866, 929, 991];   // 効果の行（遺物1つにつき3行）
const TEXT_X = 148, TEXT_W = 620;                               // 効果の文字の左端と幅
const ICON_X = [167, 272, 379, 485, 592, 698], ICON_Y = 345;    // 上に並ぶ6つの遺物のアイコンの中心

let workerP = null;
function loadScript(src) {
  return new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = rej; document.head.appendChild(el); });
}
// 文字認識の準備（初回は数MBを読み込むので時間がかかる。2回目からは使い回す）
function getWorker() {
  if (!workerP) {
    workerP = (async () => {
      if (!window.Tesseract) await loadScript(TESS_URL);
      const w = await window.Tesseract.createWorker('jpn');
      await w.setParameters({ tessedit_pageseg_mode: '7' });  // 1行ずつ読む
      return w;
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

// 元の画像の大きさのまま使う（縮めると文字がつぶれて読み間違いが増える）。f は 2000幅の座標から元の画像への倍率
async function toCanvas(file) {
  const bmp = await createImageBitmap(file);
  if (Math.abs(bmp.width / bmp.height - 16 / 9) > 0.03) throw new Error('aspect');
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  c.f = bmp.width / 2000;
  return c;
}
// 1行分を元の画質で切り出し、白黒を反転した灰色にして2倍（2000幅の座標で）の大きさにする。明るい点の数と、青っぽさも返す
function cropLine(src, y, h) {
  const f = src.f, scale = 2, c = document.createElement('canvas'); c.width = TEXT_W * scale; c.height = h * scale;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(src, TEXT_X * f, y * f, TEXT_W * f, h * f, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height); let n = 0, rs = 0, bs = 0;
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i], gg = d.data[i + 1], b = d.data[i + 2], v = Math.max(r, gg, b);
    if (v > 140) { n++; rs += r; bs += b; }
    d.data[i] = d.data[i + 1] = d.data[i + 2] = 255 - v;
  }
  g.putImageData(d, 0, 0);
  return { c, n: n / (scale * scale), blue: n ? (bs - rs) / n : 0 };
}
// 左上の見出し（「遺物儀式」）の部分
function cropTitle(src) {
  const f = src.f, c = document.createElement('canvas'); c.width = 260; c.height = 76;
  const g = c.getContext('2d'); g.drawImage(src, 140 * f, 48 * f, 130 * f, 38 * f, 0, 0, 260, 76);
  const d = g.getImageData(0, 0, 260, 76);
  for (let i = 0; i < d.data.length; i += 4) { const v = Math.max(d.data[i], d.data[i + 1], d.data[i + 2]); d.data[i] = d.data[i + 1] = d.data[i + 2] = 255 - v; }
  g.putImageData(d, 0, 0);
  return c;
}
// アイコンの色：彩度のある点の色合いから判断。ほとんど色がなければ「銀色」（固定効果の遺物）
function iconColor(src, idx) {
  const f = src.f, s = Math.round(44 * f);
  const d = src.getContext('2d').getImageData(Math.round((ICON_X[idx] - 22) * f), Math.round((ICON_Y - 22) * f), s, s).data;
  const cnt = { red: 0, yellow: 0, green: 0, blue: 0 }; let colored = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < .3 || (mx - mn) / mx < .4) continue;
    colored++;
    let h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4; h = (h * 60 + 360) % 360;
    if (h < 25 || h >= 330) cnt.red++; else if (h < 70) cnt.yellow++; else if (h < 195) cnt.green++; else if (h < 270) cnt.blue++;  // 緑の遺物は青寄り（170〜190）に見えるので広めに
  }
  if (colored < 40 * f * f) return 'silver';
  return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
}

// ---- 照らし合わせ ----
const norm = s => String(s).replace(/\s+/g, '').replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
const grams = (s, n) => { const a = []; for (let i = 0; i <= s.length - n; i++) a.push(s.slice(i, i + n)); return a; };
function dice(a, b, n) {
  const A = grams(a, n), B = grams(b, n); if (!A.length || !B.length) return 0;
  const m = new Map(); B.forEach(x => m.set(x, (m.get(x) || 0) + 1)); let hit = 0;
  A.forEach(x => { const k = m.get(x); if (k) { hit++; m.set(x, k - 1); } });
  return 2 * hit / (A.length + B.length);
}
const sim = (a, b) => 0.6 * dice(a, b, 2) + 0.4 * dice(a, b, 1);
// 末尾の「＋数字」（＋は別の字に化けやすいので、数字だけを拾う）
const splitNum = s => { const m = s.match(/^(.*?)\D?(\d)$/); return m && m[1].length > 3 ? { text: m[1], num: +m[2] } : { text: s, num: null }; };
// pool：{ id, base（＋数字を除いた名前）, lv（段階。なければ 0） }
// 候補の中で珍しい文字ほど重く数える（「被ダメージ時、○○を蓄積」のように、違いが1〜2文字だけの効果を見分けるため）
const rareCache = new WeakMap();
function rareWeights(pool) {
  if (!rareCache.has(pool)) {
    const df = new Map(); pool.forEach(c => new Set(c.base).forEach(ch => df.set(ch, (df.get(ch) || 0) + 1)));
    rareCache.set(pool, ch => Math.log((pool.length + 1) / ((df.get(ch) || 0) + 1)));
  }
  return rareCache.get(pool);
}
function rareSim(a, b, w) {
  const A = new Set(a), B = new Set(b); let hit = 0, all = 0;
  new Set([...A, ...B]).forEach(ch => { const x = w(ch); all += x; if (A.has(ch) && B.has(ch)) hit += x; });
  return all ? hit / all : 0;
}
export function matchEffect(raw, pool) {
  const { text, num } = splitNum(norm(raw));
  const w = rareWeights(pool);
  let best = null;
  for (const c of pool) { const s = 0.7 * sim(text, c.base) + 0.3 * rareSim(text, c.base, w); if (!best || s > best.s + 1e-9) best = { c, s }; }
  if (!best) return null;
  // 同じ名前で段階が違うもの（＋1〜＋4）は、読み取った数字で選ぶ。読めなければ一番小さい段階
  const same = pool.filter(c => c.base === best.c.base);
  const pick = same.find(c => c.lv === num) || same.sort((a, b) => a.lv - b.lv)[0];
  return { id: pick.id, score: best.s, numOk: !same.some(c => c.lv) || same.some(c => c.lv === num) };
}

// 読み取り本体。kind：'normal'（表）か 'deep'（深層）。
// pools：{ effects, demerits } と specials（{ id, color, effects:[名前...] }。表のときだけ使う）
// 返り値：遺物3つ（なければ null）。check が付いた遺物は、読み取りに自信がないもの
export async function scanRelics(file, kind, { effects, demerits, specials }) {
  const src = await toCanvas(file);
  const w = await getWorker();
  // 画面の確認：左上の見出し「遺物儀式」が読めなければ、違う画面として止める（読み間違いを避けるため、1文字でも合えば通す）
  const head = norm((await w.recognize(cropTitle(src))).data.text);
  if (![...'遺物儀式'].some(ch => head.includes(ch))) throw new Error('screen');
  const relics = [];
  for (let j = 0; j < 3; j++) {
    const lines = [];
    for (let k = 0; k < 3; k++) {
      const y = ROWS[j * 3 + k];
      const l1 = cropLine(src, y - 16, 32), l2 = cropLine(src, y + 10, 30);
      const t1 = l1.n > 6 ? norm((await w.recognize(l1.c)).data.text) : '';
      const t2 = l2.n > 6 ? norm((await w.recognize(l2.c)).data.text) : '';
      if (!t1) continue;
      // 2行目：青い文字は深層のデメリット。白い文字は続き（※の注意書きは読まない）
      const demerit = t2 && l2.blue > 25 ? t2 : '';
      const text = t2 && !demerit && !t2.startsWith('※') ? t1 + t2 : t1;
      lines.push({ text, demerit });
    }
    if (!lines.length) { relics.push(null); continue; }
    const color = iconColor(src, (kind === 'deep' ? 3 : 0) + j);
    // 固定効果の遺物（夜の王の遺物・固有遺物）：効果の並びがまるごと一致するものを探す
    if (kind === 'normal' && specials.length) {
      const scored = specials.filter(sp => sp.effects.length === lines.length)
        .map(sp => ({ sp, s: sp.effects.reduce((a, e, i) => a + sim(splitNum(norm(lines[i].text)).text, norm(e).replace(/\+\d$/, '')), 0) / lines.length }))
        .sort((a, b) => b.s - a.s);
      if (scored[0] && scored[0].s >= .55) { const sp = scored[0].sp;
        relics.push({ special: sp.id, color: sp.color || (color === 'silver' ? 'red' : color), kind: 'normal', effects: [null, null, null], demerits: [null, null, null], size: sp.effects.length, ...(scored[0].s < .7 ? { check: true } : {}) });
        continue; }
    }
    const fx = lines.map(l => matchEffect(l.text, effects));
    const dm = lines.map(l => (kind === 'deep' && l.demerit ? matchEffect(l.demerit, demerits) : null));
    const unsure = fx.some(m => !m || m.score < .5 || !m.numOk) || dm.some(m => m && m.score < .45);
    relics.push({ size: lines.length, color: color === 'silver' ? 'red' : color, kind,
      effects: [0, 1, 2].map(i => fx[i]?.id ?? null), demerits: [0, 1, 2].map(i => dm[i]?.id ?? null), ...(unsure ? { check: true } : {}) });
  }
  return relics;
}
