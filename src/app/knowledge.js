// 「知識」タブ（下のタブの id は昔のまま 'enemies'）。開くと項目の一覧が1行ずつ並び、押すとその項目の画面になる
// 項目を足すとき：KNOW_TOPICS に1行足し、viewKnowledge の topics に画面を作る関数を足す（ボタンの data-act は know〜 で始める）
import { LORDS } from '../data/lords.js';
import { NIGHT_PAIRS, NAMELESS_PAIRS, DAY1_ORDER, DLC_BOSSES, CLUE_EVENTS, CLUE_SHIFTS, NOT_NAMELESS_SHIFT } from '../data/boss_clues.js';

let H;  // app.js から受け取る道具（ico, esc, pressed, wheel, viewEnemies, ui）
export function initKnowledge(helpers) { H = helpers; }

// icon：白い型の絵（色はアプリ側で付ける）
export const KNOW_TOPICS = [
  { id: 'enemies', name: '敵詳細データ', icon: 'icons/tabs/enemies.png', sub: '敵のデータを調べる' },
  { id: 'boss', name: 'ボス不明チェッカー', icon: 'icons/know/unknown.png', sub: 'ボス不明の夜の王を絞り込む' },
];
const topicOf = () => KNOW_TOPICS.find(t => t.id === H.ui().topic);
export const knowledgeSub = () => topicOf()?.sub || 'ゲームの知識を調べる';

export function viewKnowledge() {
  const t = topicOf();
  if (!t) return viewMenu();
  const topics = { enemies: H.viewEnemies, boss: viewBossChecker };
  return `<div class="stack-lg"><button class="know-back" data-act="knowTopic" data-v="">知識</button>${topics[t.id]()}</div>`;
}
const mask = src => `<span class="know-ico" style="-webkit-mask-image:url('${src}');mask-image:url('${src}')" aria-hidden="true"></span>`;
function viewMenu() {
  return `<div class="know-menu">
    ${KNOW_TOPICS.map(t => `<button class="know-row" data-act="knowTopic" data-v="${t.id}">${mask(t.icon)}<b>${t.name}</b><span class="chev"></span></button>`).join('')}
    <p class="know-soon">今後の追加をお楽しみに</p>
  </div>`;
}

// ボタンが押されたとき。画面を描き直すなら true
export function knowledgeAct(a, v) {
  const ui = H.ui(), c = (ui.boss ||= {});
  if (a === 'knowTopic') { ui.topic = v; return true; }
  if (a === 'knowReset') { ui.boss = { detail: c.detail }; return true; }
  if (a === 'knowDetail') { c.detail = !c.detail; return true; }
  const key = { knowEv: 'ev', knowShift: 'shift' }[a];
  if (!key) return false;
  c[key] = c[key] === v ? '' : v;  // もう一度押すと外す
  return true;
}
// 1日目・2日目の欄（ドラム式）が止まったとき。変わったら true
export function knowledgeWheel(kind, v) {
  const c = (H.ui().boss ||= {}), key = { bjD1: 'd1', bjD2: 'd2' }[kind];
  if (!key || (c[key] || '') === v) return false;
  c[key] = v;
  if (key === 'd1' && c.d2 && c.d2 !== OTHER && !day2Options(c.d1).includes(c.d2)) c.d2 = '';  // ありえなくなった2日目は外す
  return true;
}

// ---------- ボス不明チェッカー ----------
const DLC = new Set(DLC_BOSSES);
const OTHER = '__other';  // 2日目の欄の「その他」
const d2Of = r => [...r[2], ...(r[3] || [])];
const uniq = xs => [...new Set(xs)];
const dlcLast = xs => [...xs.filter(x => !DLC.has(x)), ...xs.filter(x => DLC.has(x))];
const ALL_D2 = dlcLast(uniq([...NIGHT_PAIRS.flatMap(d2Of), ...NAMELESS_PAIRS.flatMap(([, b]) => b)]));
// 1日目の夜ボスのあとに出る2日目の夜ボス
function day2Options(d1) {
  if (!d1) return ALL_D2;
  return dlcLast(uniq([...NIGHT_PAIRS.filter(r => r[1].includes(d1)).flatMap(d2Of), ...NAMELESS_PAIRS.filter(([a]) => a === d1).flatMap(([, b]) => b)]));
}
// その王でこのイベントが起きるか（新たなる脅威は、大空洞ならほかの王でも起きる）
const evFits = (ev, id, shift) => !ev || ev.lords.includes(id) || (shift === '大空洞' && (ev.caveLords || []).includes(id));

// 選んだ手がかりで、夜の王ごとに「ありえる」か（決まりは boss_clues.js の上の説明のとおり）
export function judgeBoss(c) {
  const ev = CLUE_EVENTS.find(e => e.id === c.ev);
  const fits = r => (!c.d1 || r[1].includes(c.d1)) && (!c.d2 || d2Of(r).includes(c.d2));
  const res = {};
  LORDS.forEach(l => { res[l.id] = l.id !== 'final' && NIGHT_PAIRS.some(r => r[0] === l.id && fits(r)) && evFits(ev, l.id, c.shift); });
  // ナメレス：DLCの夜ボスは出ない。発生イベントは起きない（大空洞の新たなる脅威だけ例外）。
  // 1日目・2日目がほかの王の組み合わせにあって、ナメレスの組み合わせにないなら外す。どの王の組み合わせにもないならナメレス
  let nm = !DLC.has(c.d1) && !DLC.has(c.d2) && evFits(ev, 'final', c.shift) && !(NOT_NAMELESS_SHIFT[c.d1] || []).includes(c.shift);
  if (nm && c.d1 && c.d2) {
    const known = NAMELESS_PAIRS.some(([a, b]) => a === c.d1 && b.includes(c.d2));
    const inLordTable = NIGHT_PAIRS.some(r => r[1].includes(c.d1) && d2Of(r).includes(c.d2));
    if (!known && inLordTable) nm = false;
  }
  res.final = nm;
  return res;
}

function viewBossChecker() {
  const { ico, esc, pressed, wheel } = H;
  const c = (H.ui().boss ||= {});
  const res = judgeBoss(c);
  const left = LORDS.filter(l => res[l.id]);
  const chip = (act, v, label, on) => `<button class="chip small" data-act="${act}" data-v="${esc(v)}" ${pressed(on)}>${label}</button>`;
  const opt = names => names.map(n => ({ id: n }));
  const name = n => n === OTHER ? 'その他' : esc(n).replace('＆', '＆<wbr>');
  const d1s = opt(DAY1_ORDER), d2s = opt([...day2Options(c.d1), ...(c.d1 ? [OTHER] : [])]);
  const ev = CLUE_EVENTS.find(e => e.id === c.ev);
  const picked = [ev?.name, c.shift].filter(Boolean);
  const evChips = kind => CLUE_EVENTS.filter(e => e.kind === kind).map(e => chip('knowEv', e.id, esc(e.name), c.ev === e.id)).join('');
  return `<div class="card-sec bj-card">
      <div class="wheels bj-wheels">
        <div class="wheel-col"><div class="wheel-label">1日目</div>${wheel('bjD1', d1s, c.d1 || '', name, true)}</div>
        <div class="wheel-col"><div class="wheel-label">2日目</div>${wheel('bjD2', d2s, c.d2 || '', name, true)}</div>
      </div>
      <div class="bj-detail ${c.detail ? 'open' : ''}">
        <button class="sec-toggle" data-act="knowDetail" aria-expanded="${!!c.detail}"><span>詳細</span>${picked.length ? `<small>${picked.map(esc).join('・')}</small>` : ''}<span class="chev"></span></button>
        ${c.detail ? `<div class="bj-detail-body">
          <p class="flag-label">襲撃イベント</p><div class="chips">${evChips('raid')}</div>
          <p class="flag-label">発生イベント</p><div class="chips">${evChips('occur')}</div>
          <p class="flag-label">地変</p><div class="chips">${CLUE_SHIFTS.map(s => chip('knowShift', s, s, c.shift === s)).join('')}</div>
        </div>` : ''}
      </div>
    </div>
    <div class="card-sec bj-result">
      <div class="bj-result-head"><p class="flag-label">${left.length === 1 ? '夜の王' : `可能性のある夜の王（${left.length}）`}</p>
        ${c.d1 || c.d2 || c.ev || c.shift ? '<button class="ghost small" data-act="knowReset">リセット</button>' : ''}</div>
      ${left.length ? `<div class="bj-lords ${left.length === 1 ? 'one' : ''}">${left.map(l => `<span class="bj-lord">${ico('lord', l.id)}${esc(l.name)}</span>`).join('')}</div>`
        : '<p class="hint">該当なし</p>'}
    </div>`;
}
