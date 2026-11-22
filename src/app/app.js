// 夜渡日記 アプリ本体
import { LORDS } from '../data/lords.js';
import { CHARS } from '../data/characters.js';
import { OPT, EFF_NORMAL_ROWS, EFF_DEEP_ROWS, DEMERIT_ROWS } from '../data/effects.js';
import { VESSEL_ROWS } from '../data/vessels.js';
import { SPECIAL_ROWS } from '../data/relics.js';
import { COLORS, SIZES, KINDS, STYLES, SPEC_SORC, SPEC_INC, WEAPON_TYPES, LOSS_AT, MODES, PARTY, DEPTHS, RUN_FLAGS } from '../data/labels.js';
import { load, save, exportJson, exportCsv, readJsonFile } from './store.js';

// ---------- 遺物効果の組み立て ----------
function optsFor(name) {
  if (!name.includes('○○')) return null;
  if (name.includes('魔術を強化')) return OPT.SORC;
  if (name.includes('祈祷を強化')) return OPT.INC;
  if (name.includes('最大HP上昇')) return OPT.SHIELD;
  if (name.includes('最大FP上昇')) return OPT.CAT;
  if (name.includes('潜在する力')) return OPT.POT;
  return OPT.W;
}

function buildFamilies(rows, prefix) {
  return rows.map(([rawCat, name, lv, dem], fi) => {
    const fid = `${prefix}${fi}`;
    const m = rawCat.match(/^キャラ固有：(.+)$/);
    const cat = m ? 'キャラ固有' : rawCat;
    const charName = m ? m[1] : null;
    const opts = optsFor(name);
    const base = name.replace(/\+$/, '');
    let levels;
    if (opts) levels = opts.map((o, i) => ({ id: `${fid}_v${i}`, fid, lv: 0, variant: o, cat, name: name.replace('○○', o), dem }));
    else if (lv) levels = lv.map(l => ({ id: `${fid}_${l}`, fid, lv: l, cat, name: l ? `${base}+${l}` : base, dem }));
    else levels = [{ id: fid, fid, lv: 0, cat, name, dem }];
    return { fid, cat, charName, name: opts ? name : base, max: lv ? lv[lv.length - 1] : 0, hasLv: !!lv, opts, levels, dem };
  });
}
const catsOf = fams => [...new Set(fams.map(f => f.cat))];
const NORMAL_FAMS = buildFamilies(EFF_NORMAL_ROWS, 'n');
const DEEP_FAMS = buildFamilies(EFF_DEEP_ROWS, 'p');
const DEMERIT_FAMS = buildFamilies(DEMERIT_ROWS.map(([c, n]) => [c, n, null, null]), 'm');
const FAM = Object.fromEntries([...NORMAL_FAMS, ...DEEP_FAMS, ...DEMERIT_FAMS].map(f => [f.fid, f]));
const ALL_EFF = {};
const nameMap = (fams, label) => Object.fromEntries(fams.flatMap(f => f.levels).map(e => { e.label = e.name + label; ALL_EFF[e.id] = e; return [e.name, e.id]; }));
const NAME_N = nameMap(NORMAL_FAMS, ''), NAME_P = nameMap(DEEP_FAMS, '（深層）'), NAME_M = nameMap(DEMERIT_FAMS, '（デメリット）');
// 深層の効果に、その段階でデメリットが付くか
const demeritAllowed = e => !!e && e.dem !== null && e.dem !== undefined && (e.dem <= 0 || e.lv >= e.dem);
const COLOR = byIdEarly(COLORS);
// 遺物の名前は「大きさ＋色＋種類」で決まる。大きさ＝効果スロット数
const SIZE = Object.fromEntries(SIZES.map(x => [x.n, x]));
const KIND = byIdEarly(KINDS);
// 大きさは効果の数で決まる（3=壮大、2=端正、1=繊細）
const relicName = r => { if (r.special) return SPECIAL[r.special].name; const n = r.effects.filter(Boolean).length; return `${n ? SIZE[n].name + 'な' : ''}${COLOR[r.color].word}${KIND[r.kind].word}`; };
function byIdEarly(arr) { return Object.fromEntries(arr.map(x => [x.id, x])); }
// 献器：スロット色（r/b/y/g、* は全色OK）。charId 'common' は全員が使える聖杯
const VC = { r: 'red', b: 'blue', y: 'yellow', g: 'green', '*': 'any' };
const VESSELS = VESSEL_ROWS.map(([charId, name, s, d]) => ({ id: name, charId, name, normal: [...s].map(c => VC[c]), deep: [...d].map(c => VC[c]) }));
const VESSEL = Object.fromEntries(VESSELS.map(v => [v.id, v]));
const vesselsFor = charId => VESSELS.filter(v => v.charId === charId || v.charId === 'common');
const fits = (slotColor, relic) => slotColor === 'any' || !relic.color || slotColor === relic.color;

// 夜の王（常夜含む）の遺物・夜渡りの固有遺物（出典: 神攻略wiki 遺物ページ）
const SPECIALS = SPECIAL_ROWS.map(([type, who, name, color, effects], i) => ({ id: 'sp' + i, type, who, name, color, effects }));
const SPECIAL = byIdEarly(SPECIALS);
const fitsSpecial = (sc, sp) => sc === 'any' || !sp.color || sp.color === sc;
// ビルドの型・メイン武器
const byId = arr => Object.fromEntries(arr.map(x => [x.id, x]));
const RUN_FLAG = byId(RUN_FLAGS);
const LORD = byId(LORDS), CHAR = byId(CHARS), LOSS = byId(LOSS_AT), MODE = byId(MODES), PARTYM = byId(PARTY);

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Math.random().toString(36).slice(2));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const today = () => ymd(new Date());
function dateLabel(s) {
  if (s === today()) return '今日';
  if (s === daysAgo(1)) return '昨日';
  const [y, m, d] = s.split('-').map(Number);
  const wd = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}（${wd}）`;
}
const pct = p => Math.round(p * 100) + '%';
const pressed = b => `aria-pressed="${b ? 'true' : 'false'}"`;

// ---------- sample data ----------
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function seed() {
  const ids = (a, map) => [...a.map(n => { if (n && !map[n]) throw new Error('unknown effect ' + n); return n && map[n]; }), null, null, null].slice(0, 3);
  const R = (size, color, kind, effects, demerits = []) => ({ size, color, kind, effects: ids(effects, kind === 'deep' ? NAME_P : NAME_N), demerits: ids(demerits, NAME_M) });
  const relics = [];
  const presets = [
    { id: 'p1', name: '追跡者・出血型', charId: 'wylder', vesselId: '追跡者の器', style: 'melee', weaponType: '大剣', weaponName: '',
      normal: [R(3, 'red', 'normal', ['出撃時の武器に出血の状態異常を付加', '攻撃連続時、攻撃力上昇', '筋力+3']), R(1, 'red', 'normal', ['物理攻撃力上昇+1']), R(2, 'blue', 'normal', ['攻撃命中時、スタミナ回復', '生命力+2'])],
      deep: [R(2, 'red', 'deep', ['物理攻撃力上昇+3', '致命の一撃強化'], ['回避直後、カット率低下', null]), null, R(2, 'blue', 'deep', ['刺突カウンター発生時、HP回復+1', '物理カット率上昇+1'], ['聖杯瓶の回復量低下', 'すべての状態異常耐性低下'])] },
    { id: 'p2', name: '隠者・魔術型', charId: 'recluse', vesselId: '隠者の器', style: 'caster', spec: ['輝剣', '重力'], weaponType: '杖', weaponName: '',
      normal: [R(2, 'blue', 'normal', ['FP持続回復', '重力の魔術を強化']), null, R(3, 'green', 'normal', ['輝剣の魔術を強化', '魔術/祈祷、効果時間延長', '知力+3'])],
      deep: [R(2, 'blue', 'deep', ['魔術強化+2', '魔力カット率上昇'], ['取得ルーン減少', null]), null, null] },
    { id: 'p3', name: '追跡者・耐久型', charId: 'wylder', vesselId: '追跡者の盃', style: 'melee', weaponType: '直剣', weaponName: '',
      normal: [R(3, 'yellow', 'normal', ['スキルクールタイム軽減+1', 'アーツゲージ自然蓄積+2', '致命の一撃強化+1']), R(3, 'green', 'normal', ['物理カット率上昇', 'HP持続回復', '生命力+3']), null],
      deep: [null, null, null] },
  ];
  const rnd = mulberry32(20261122);
  const pick = a => a[Math.floor(rnd() * a.length)];
  const lordDiff = { gladius: .15, adel: .1, gnoster: 0, maris: .05, libra: -.05, fulghor: -.1, caligo: -.15, final: -.25, harmonia: -.2, strages: -.2 };
  const charBias = { wylder: .08, guardian: .02, ironeye: 0, duchess: -.04, raider: .03, revenant: -.06, recluse: .05, executor: .06, scholar: -.02, undertaker: 0 };
  const runs = [];
  for (let i = 0; i < 64; i++) {
    const ago = Math.floor(Math.pow(rnd(), 1.4) * 45);
    const charId = rnd() < .45 ? 'wylder' : rnd() < .4 ? 'recluse' : pick(CHARS).id;
    const lordId = pick(LORDS).id;
    const mode = rnd() < .25 ? 'deep' : 'normal';
    const everdark = mode === 'normal' && rnd() < .2;
    const presetId = charId === 'wylder' ? (rnd() < .6 ? 'p1' : rnd() < .5 ? 'p3' : null) : charId === 'recluse' && rnd() < .7 ? 'p2' : null;
    const learn = (45 - ago) / 45 * .12;
    let p = .45 + lordDiff[lordId] + charBias[charId] + learn - (everdark ? .15 : 0) - (mode === 'deep' ? .1 : 0) + (presetId === 'p1' ? .08 : 0);
    const win = rnd() < p;
    const lossAt = win ? null : (r => r < .2 ? 'd1' : r < .45 ? 'd2' : 'final')(rnd());
    runs.push({ id: uid(), date: daysAgo(ago), lordId, everdark, mode, party: rnd() < .8 ? 'trio' : rnd() < .5 ? 'duo' : 'solo', charId, result: win ? 'win' : 'loss', lossAt, presetId, note: '', updatedAt: Date.now() - ago * 864e5 - i * 1000, deleted: false });
  }
  return { runs, relics, presets };
}

// ---------- state ----------
const db = load() ?? { runs: [], relics: [], presets: [] };
db.prefs ||= {};
const prefs = () => db.prefs;
const blankForm = () => ({ dateMode: 'today', date: today(), lordId: null, everdark: null, flags: [], mode: prefs().mode || 'normal', depth: prefs().depth || null,
  party: prefs().party || 'trio', charId: null, result: null, lossAt: null, presetId: null, note: '' });
const lastPresetFor = charId => { const id = (prefs().presetByChar || {})[charId]; return id && db.presets.some(p => p.id === id) ? id : null; };
const S = {
  tab: 'record', recOpen: {}, form: blankForm(), openRun: null, confirmDel: null,
  stats: { period: 'all', mode: 'all' },
  buildView: 'presets', edit: null, sheet: null,
};
{ // remember last character / preset as sensible defaults
  const last = [...db.runs].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (last) { S.form.charId = last.charId; S.form.presetId = lastPresetFor(last.charId) ?? last.presetId ?? null; }
}
const liveRuns = () => db.runs.filter(r => !r.deleted);
const relicById = id => db.relics.find(r => r.id === id);
const presetById = id => db.presets.find(p => p.id === id);

// ---------- views ----------
let BAR = '';  // 画面下に固定するボタン（各画面が設定する）
const card = (title, body, right = '') => `<section class="card-sec"><div class="sec-head"><h2>${title}</h2>${right}</div>${body}</section>`;

function viewRecord() {
  const f = S.form;
  const canSave = f.everdark !== null && f.lordId && f.charId && f.result;
  const presets = db.presets.filter(p => p.charId === f.charId);
  const lords = lordsFor(f.everdark);
  const missing = [f.everdark === null && '常夜かどうか', !f.lordId && '夜の王', !f.charId && '夜渡り', !f.result && '結果'].filter(Boolean);
  BAR = `${canSave ? '' : `<div class="msg">${missing.join('・')}を選ぶと記録できます</div>`}<button class="primary" data-act="save" ${canSave ? '' : 'disabled'}>記録する</button>`;
  const chip = (act, v, label, on, cls = 'chip') => `<button class="${cls}" data-act="${act}" data-v="${v}" ${pressed(on)}>${label}</button>`;
  return `<div class="stack-lg">
    ${card('日付', `${f.dateMode === 'pick' ? `<input type="date" id="f-date" data-field="date" value="${f.date}" max="${today()}">` : ''}`,
      `<div class="chips">${[['today', '今日'], ['yesterday', '昨日'], ['pick', '指定']].map(([v, l]) => chip('date', v, l, f.dateMode === v, 'chip small')).join('')}</div>`)}
    ${card('夜の王の種類', '', `<div class="chips">${chip('everdark', 'no', '通常', f.everdark === false, 'chip small')}${chip('everdark', 'yes', '常夜', f.everdark === true, 'chip small')}</div>`)}
    ${recDisc('lord', '夜の王', f.lordId && LORD[f.lordId].name,
      `<div class="grid-btns">${lords.map(l => chip('lord', l.id, l.name, f.lordId === l.id, 'tile-btn')).join('')}</div>`,
      f.lordId ? `<div class="flag-row"><span class="flag-label">あれば</span>${RUN_FLAGS.map(x => chip('flag', x.id, x.name, f.flags.includes(x.id), 'chip small')).join('')}</div>` : '')}
    ${recDisc('char', '夜渡り', f.charId && CHAR[f.charId].name,
      `<div class="grid-btns">${CHARS.map(c => chip('char', c.id, c.name, f.charId === c.id, 'tile-btn')).join('')}</div>`)}
    ${f.charId ? card('ビルド', `<div class="chips one-line">${chip('preset', '', '記録無し', !f.presetId)}${presets.map(p => chip('preset', p.id, esc(p.name), f.presetId === p.id)).join('')}</div>
      ${presets.length ? '' : `<p class="hint">${CHAR[f.charId].name}のプリセットはまだありません。「ビルド」タブで作れます。</p>`}`) : ''}
    ${card('結果', `<div class="result-row">
        <button class="result-btn win" data-act="result" data-v="win" ${pressed(f.result === 'win')}>勝利</button>
        <button class="result-btn loss" data-act="result" data-v="loss" ${pressed(f.result === 'loss')}>敗北</button></div>
      ${f.result === 'loss' ? `<div class="subpanel"><div class="label">どこで倒れた？</div>
        <div class="chips">${LOSS_AT.map(x => chip('lossAt', x.id, x.name, f.lossAt === x.id)).join('')}</div></div>` : ''}`)}
    <details class="opt" ${S.optOpen ? 'open' : ''} data-details="opt">
      <summary><span>詳細</span><span class="tag">${esc(optSummary())}</span></summary>
      <div class="inner">
        <div class="section"><div class="label">モード</div>
          <div class="chips">${MODES.map(m => chip('mode', m.id, m.name, f.mode === m.id)).join('')}</div>
          ${f.mode === 'deep' ? `<div class="subpanel"><div class="label">深度</div>
            <div class="depth-row">${DEPTHS.map(d => chip('depth', d, d, f.depth === d, 'chip depth')).join('')}</div></div>` : ''}</div>
        <div class="section"><div class="label">人数</div>
          <div class="chips">${PARTY.map(m => chip('party', m.id, m.name, f.party === m.id)).join('')}</div></div>
        <div class="section"><div class="label">メモ（任意）</div>
          <textarea id="f-note" data-field="note" placeholder="例：最終戦で回復が足りなかった">${esc(f.note)}</textarea></div>
        <p class="hint">モード・深度・人数は、次の記録でもそのまま使われます。</p>
      </div>
    </details>
  </div>`;
}
// 記録画面の開閉する行。未選択なら開き、選んだら畳む（行をタップで開き直せる）
const recOpen = (key, hasValue) => S.recOpen[key] ?? !hasValue;
function recDisc(key, label, value, body, extra = '') {
  const open = recOpen(key, !!value);
  return `<div class="disc ${open ? 'open' : ''}">
    <button class="disc-head" data-act="rdisc" data-v="${key}" aria-expanded="${open}">
      <span class="k">${label}</span><span class="v ${value ? 'set' : ''}"><span class="txt">${value ? esc(value) : '未選択'}</span></span><span class="chev"></span></button>
    ${open ? `<div class="disc-body">${body}</div>` : ''}
    ${extra ? `<div class="disc-extra">${extra}</div>` : ''}</div>`;
}
// 常夜の王を選んだときは、常夜にいない夜の王を外す（lords.js の everdark: false）
const lordsFor = everdark => LORDS.filter(l => everdark !== true || l.everdark !== false);
function optSummary() {
  const f = S.form;
  const parts = [f.mode === 'deep' && f.depth ? `深き夜 深度${f.depth}` : MODE[f.mode].name, PARTYM[f.party].name];
  return parts.join('・');
}

function viewHistory() {
  const runs = liveRuns().sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
  if (!runs.length) return `<div class="empty-state">まだ記録がありません。「記録」タブから1戦目を残しましょう。</div>`;
  const groups = {};
  runs.forEach(r => (groups[r.date] ||= []).push(r));
  return `<div class="stack-lg">` + Object.entries(groups).map(([d, rs]) => {
    const w = rs.filter(r => r.result === 'win').length;
    return `<div class="day"><div class="day-head"><b>${dateLabel(d)}</b><span>${w}勝 ${rs.length - w}敗</span></div>
      ${rs.map(runRow).join('')}</div>`;
  }).join('') + `</div>`;
}
function runRow(r) {
  const p = r.presetId && presetById(r.presetId);
  const open = S.openRun === r.id;
  return `<button class="run ${r.result}" data-act="openRun" data-v="${r.id}" aria-expanded="${open}">
    <span class="stripe"></span>
    <span class="main"><span class="who">${LORD[r.lordId].name} <span style="color:var(--dim);font-weight:400">×</span> ${CHAR[r.charId].name}</span>
      <span class="meta">${r.everdark ? '<span class="badge ever">常夜</span>' : ''}${r.mode === 'deep' ? `<span class="badge deep">深き夜${r.depth ? ' 深度' + r.depth : ''}</span>` : ''}${(r.flags || []).map(x => `<span class="badge">${RUN_FLAG[x]?.name ?? x}</span>`).join('')}<span>${PARTYM[r.party].name}</span>${p ? `<span>${esc(p.name)}</span>` : ''}</span></span>
    <span class="res">${r.result === 'win' ? '勝利' : '敗北'}${r.lossAt ? `<small>${LOSS[r.lossAt].name}</small>` : ''}</span>
  </button>
  ${open ? `<div class="run-detail">
    ${r.note ? `<div>${esc(r.note)}</div>` : `<div style="color:var(--dim)">メモなし</div>`}
    <div class="row-actions">
      <button class="ghost danger" data-act="delRun" data-v="${r.id}">${S.confirmDel === r.id ? 'もう一度押すと削除' : '削除'}</button>
    </div></div>` : ''}`;
}

function filteredRuns() {
  const { period, mode } = S.stats;
  return liveRuns().filter(r => {
    if (period !== 'all' && r.date < daysAgo(Number(period) - 1)) return false;
    if (mode === 'normal' && r.mode !== 'normal') return false;
    if (mode === 'deep' && r.mode !== 'deep') return false;
    if (mode === 'ever' && !r.everdark) return false;
    return true;
  });
}
const rate = arr => { const w = arr.filter(r => r.result === 'win').length; return { w, n: arr.length, p: arr.length ? w / arr.length : 0 }; };
function barRows(items, getRuns) {
  const rows = items.map(it => ({ it, ...rate(getRuns(it)) })).filter(x => x.n > 0).sort((a, b) => b.p - a.p || b.n - a.n);
  if (!rows.length) return `<p class="hint">この条件の記録はありません</p>`;
  return `<div class="bars">${rows.map(x => `<div class="bar-row"><span class="name" title="${esc(x.it.name)}">${esc(x.it.name)}</span>
    <span class="bar-track"><span class="bar-fill" style="width:${x.p * 100}%;background:${x.p >= .5 ? 'var(--grad-win)' : 'var(--grad-loss)'}"></span></span>
    <span class="num"><b>${pct(x.p)}</b> ${x.w}/${x.n}</span></div>`).join('')}</div>`;
}
function viewStats() {
  const runs = filteredRuns();
  const all = rate(runs);
  const chrono = [...runs].sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt - b.updatedAt);
  let streak = 0; for (let i = chrono.length - 1; i >= 0 && chrono[i].result === 'win'; i--) streak++;
  let best = 0, cur = 0; chrono.forEach(r => { cur = r.result === 'win' ? cur + 1 : 0; best = Math.max(best, cur); });
  const losses = runs.filter(r => r.result === 'loss');
  const lossCounts = LOSS_AT.map(x => ({ ...x, n: losses.filter(r => r.lossAt === x.id).length }));
  const lossColors = { d1: '#f0b46a', d2: '#e3835e', final: '#cf5a55' };
  const lossTotal = lossCounts.reduce((s, x) => s + x.n, 0);
  const filterChips = (key, opts) => opts.map(([v, l]) => `<button class="chip small" data-act="sf" data-k="${key}" data-v="${v}" ${pressed(S.stats[key] === v)}>${l}</button>`).join('');
  return `<div class="stack-lg">
    <div class="filters">
      <div class="chips">${filterChips('period', [['all', '全期間'], ['30', '30日'], ['7', '7日']])}</div>
      <div class="chips">${filterChips('mode', [['all', 'すべて'], ['normal', '通常'], ['deep', '深き夜'], ['ever', '常夜の王']])}</div>
    </div>
    ${runs.length ? `
    <div class="tiles">
      <div class="tile"><div class="k">戦数</div><div class="v">${all.n}</div><div class="s">${all.w}勝 ${all.n - all.w}敗</div></div>
      <div class="tile"><div class="k">勝率</div><div class="v">${pct(all.p)}</div><div class="s">全体</div></div>
      <div class="tile"><div class="k">連勝</div><div class="v">${streak}</div><div class="s">最高 ${best}</div></div>
    </div>
    ${card('勝率の推移', `<p class="hint">直近10戦ごとの勝率。点線は50%</p>${spark(chrono)}`)}
    ${card('夜の王別', barRows(LORDS, l => runs.filter(r => r.lordId === l.id)))}
    ${card('夜渡り別', barRows(CHARS, c => runs.filter(r => r.charId === c.id)))}
    ${card('相性表', `<p class="hint">夜の王 × 夜渡りの勝率。数字は戦数</p>${heat(runs)}`)}
    ${card('どこで倒れたか', lossTotal ? `<div class="stack">${lossCounts.filter(x => x.n).map(x => `<div style="flex:${x.n};background:${lossColors[x.id]}">${x.n >= lossTotal * .12 ? pct(x.n / lossTotal) : ''}</div>`).join('')}</div>
      <div class="legend">${lossCounts.map(x => `<span><i style="background:${lossColors[x.id]}"></i>${x.name} ${x.n}回</span>`).join('')}</div>` : `<p class="hint">敗北の記録はありません</p>`)}
    ${card('ビルド別', barRows([...db.presets, { id: null, name: '記録なし' }], p => runs.filter(r => (r.presetId || null) === p.id)))}
    ${card('型・メイン武器別', `${barRows(STYLES, st => runs.filter(r => r.presetId && presetById(r.presetId)?.style === st.id))}
      ${barRows(WEAPON_TYPES.map(w => ({ id: w, name: w })), w => runs.filter(r => r.presetId && presetById(r.presetId)?.weaponType === w.id))}`)}
    ${card('効果別', `<p class="hint">その効果を積んでいた試合の勝率。プリセットに登録した効果だけが対象です</p>
      <div class="bars-wide">${barRows(usedEffects(), ef => runs.filter(r => presetHasEffect(r.presetId, ef.id)))}</div>`)}` : `<div class="empty-state">この条件の記録はありません</div>`}
  </div>`;
}
function spark(chrono) {
  const W = 320, H = 90, padX = 8, padY = 10, win = 10;
  if (chrono.length < win) return `<p class="hint">10戦以上記録すると表示されます</p>`;
  const pts = [];
  for (let i = win - 1; i < chrono.length; i++) pts.push(rate(chrono.slice(i - win + 1, i + 1)).p);
  const x = i => padX + (pts.length === 1 ? 0 : i / (pts.length - 1)) * (W - padX * 2);
  const y = p => padY + (1 - p) * (H - padY * 2);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const area = `${x(0)},${H - padY} ${line} ${x(pts.length - 1)},${H - padY}`;
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="勝率の推移。最新 ${pct(last)}">
    <line x1="${padX}" x2="${W - padX}" y1="${y(.5)}" y2="${y(.5)}" stroke="#4a5080" stroke-dasharray="3 3"/>
    <polygon points="${area}" fill="var(--accent)" fill-opacity=".12"/>
    <polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${x(pts.length - 1)}" cy="${y(last)}" r="4" fill="var(--accent)"/>
    <text x="${W - padX - 6}" y="${Math.max(14, y(last) - 8)}" fill="var(--fg)" font-size="11" text-anchor="end">${pct(last)}</text>
  </svg>`;
}
function heat(runs) {
  const chars = CHARS.filter(c => runs.some(r => r.charId === c.id));
  const lords = LORDS.filter(l => runs.some(r => r.lordId === l.id));
  return `<div class="scroll-x"><table class="heat"><thead><tr><th></th>${chars.map(c => `<th>${c.name}</th>`).join('')}</tr></thead><tbody>
    ${lords.map(l => `<tr><th>${l.name}</th>${chars.map(c => {
      const x = rate(runs.filter(r => r.lordId === l.id && r.charId === c.id));
      if (!x.n) return `<td class="cell empty">・</td>`;
      const col = x.p >= .5 ? 'var(--win)' : 'var(--loss)';
      const strength = Math.round(18 + Math.abs(x.p - .5) * 2 * 60);
      return `<td class="cell" style="background:color-mix(in srgb, ${col} ${strength}%, var(--panel))" title="${x.w}/${x.n}"><b>${pct(x.p)}</b><br><span style="color:var(--dim)">${x.n}</span></td>`;
    }).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}

function relicSub(r) { if (r.special) return SPECIAL[r.special].effects.join('・'); return r.effects.filter(Boolean).map(e => ALL_EFF[e].name).join('・') || '効果未登録'; }
const presetRelics = p => [...p.normal, ...p.deep].filter(Boolean);
function presetHasEffect(presetId, effId) {
  const p = presetId && presetById(presetId);
  if (effId.startsWith('sp:')) return !!p && presetRelics(p).some(r => r.special === effId.slice(3));
  return !!p && presetRelics(p).some(r => r.effects.includes(effId) || r.demerits.includes(effId));
}
function usedEffects() {
  const ids = new Set();
  db.presets.forEach(p => presetRelics(p).forEach(r => r.special ? ids.add('sp:' + r.special) : [...r.effects, ...r.demerits].forEach(e => e && ids.add(e))));
  return [...ids].map(id => id.startsWith('sp:') ? { id, name: `《${SPECIAL[id.slice(3)].name}》` } : { id, name: ALL_EFF[id].label });
}
function slotDots(p) {
  const v = p.vesselId && VESSEL[p.vesselId];
  const d = (r, deep, i) => {
    const sc = v ? v[deep ? 'deep' : 'normal'][i] : null;
    return `<span class="slot-dot ${deep ? 'deep' : ''} ${r ? 'c-' + r.color : sc ? 'o-' + sc : ''}"></span>`;
  };
  return `<span class="slots">${p.normal.map((r, i) => d(r, false, i)).join('')}<span class="sep"></span>${p.deep.map((r, i) => d(r, true, i)).join('')}</span>`;
}
const vesselCols = (v, which) => `<span class="cols">${v[which].map(c => `<span class="slot-color ${which === 'deep' ? 'deep' : ''} c-${c}"></span>`).join('')}</span>`;
function viewBuilds() {
  if (S.edit) return S.edit.slot ? editSlot() : editPreset();
  return `<div class="stack-lg">
    <p class="hint">ビルドの登録は任意です。登録しなくても戦績は記録できます。遺物の効果まで入れておくと、ビルドや効果ごとの勝率が見られます。</p>
    <button class="btn-add" data-act="newPreset">＋ プリセットを作る</button>
    ${db.presets.map(p => { const x = rate(liveRuns().filter(r => r.presetId === p.id)); return `<button class="card" data-act="editPreset" data-v="${p.id}">
      <span class="title"><span>${esc(p.name)}</span><span class="rate ${x.n ? '' : 'none'}">${x.n ? `${pct(x.p)}<span style="color:var(--dim);font-weight:400"> ・${x.n}戦</span>` : '未使用'}</span></span>
      <span class="sub">${p.charId ? CHAR[p.charId].name : '夜渡り未設定'}${styleText(p) ? '・' + esc(styleText(p)) : ''}</span>${slotDots(p)}</button>`; }).join('')}
  </div>`;
}
// タップで開閉する行。値が決まっていれば右側に表示する
function disc(key, label, value, body, disabled = false) {
  const open = !disabled && !!S.edit.open[key];
  return `<div class="disc ${open ? 'open' : ''}">
    <button class="disc-head" data-act="disc" data-v="${key}" aria-expanded="${open}" ${disabled ? 'disabled' : ''}>
      <span class="k">${label}</span><span class="v ${value.set ? 'set' : ''}">${value.html}</span><span class="chev"></span></button>
    ${open ? `<div class="disc-body">${body}</div>` : ''}</div>`;
}
function editPreset() {
  const p = S.edit.data;
  const v = p.vesselId && VESSEL[p.vesselId];
  const slot = (kind, i) => {
    const r = p[kind][i];
    const sc = v[kind][i];
    return `<button class="slot-btn ${r ? 'filled' : ''}" data-act="openSlot" data-k="${kind}" data-v="${i}">
      <span class="slot-color ${kind === 'deep' ? 'deep' : ''} c-${r ? r.color : sc}" title="${sc === 'any' ? '全色' : COLOR[sc].name}"></span>
      ${r ? `<span class="rname"><span>${relicName(r)}</span><small>${esc(relicSub(r))}</small></span>` : `<span class="empty">空き（${sc === 'any' ? 'どの色でも可' : COLOR[sc].name + 'の枠'}）</span>`}</button>`;
  };
  const vRow = x => `<button class="vessel" data-act="eVessel" data-v="${esc(x.id)}" ${pressed(p.vesselId === x.id)}><span>${esc(x.name)}</span><span class="cols">${vesselCols(x, 'normal')}<span class="sep"></span>${vesselCols(x, 'deep')}</span></button>`;
  const list = p.charId ? vesselsFor(p.charId) : [];
  const vesselBody = `<div class="vessel-list">${list.filter(x => x.charId !== 'common').map(vRow).join('')}
      <div class="sub-group">共通の聖杯</div>${list.filter(x => x.charId === 'common').map(vRow).join('')}</div>
      <p class="hint">左3つが遺物、右3つが深層遺物の枠の色です。虹色の枠はどの色でも装備できます。</p>`;
  const styleName = p.style ? STYLES.find(x => x.id === p.style).name + ((p.spec || []).length ? `・${p.spec.join('/')}` : '') : '';
  const styleBody = `<div class="chips">${STYLES.map(x => `<button class="chip" data-act="eStyle" data-v="${x.id}" ${pressed(p.style === x.id)}>${x.name}</button>`).join('')}</div>
      ${p.style === 'caster' || p.style === 'hybrid' ? `<div class="subpanel"><div class="label">何特化？（複数選べます）</div>
        <div class="sub-group">魔術</div><div class="chips">${SPEC_SORC.map(x => `<button class="chip small" data-act="eSpec" data-v="${x}" ${pressed((p.spec || []).includes(x))}>${x}</button>`).join('')}</div>
        <div class="sub-group">祈祷</div><div class="chips">${SPEC_INC.map(x => `<button class="chip small" data-act="eSpec" data-v="${x}" ${pressed((p.spec || []).includes(x))}>${x}</button>`).join('')}</div></div>` : ''}`;
  const weaponBody = `<input type="text" id="e-wname" data-edit="weaponName" value="${esc(p.weaponName || '')}" placeholder="武器の名前（任意）例：月光の大剣">
      <div class="chips">${WEAPON_TYPES.map(x => `<button class="chip small" data-act="eWeapon" data-v="${x}" ${pressed(p.weaponType === x)}>${x}</button>`).join('')}</div>`;
  const val = (txt, set) => ({ html: `<span class="txt">${esc(txt)}</span>`, set });
  BAR = `<button class="ghost" data-act="eCancel">キャンセル</button><button class="primary" data-act="eSave">保存する</button>`;
  return `<div class="stack-lg">
    <div class="page-title">${S.edit.isNew ? 'プリセットを作る' : 'プリセットを編集'}</div>
    ${card('名前', `<input type="text" id="e-name" data-edit="name" value="${esc(p.name)}" placeholder="例：追跡者・出血型">`)}
    ${disc('char', '夜渡り', p.charId ? val(CHAR[p.charId].name, true) : val('未選択', false),
      `<div class="grid-btns">${CHARS.map(c => `<button class="tile-btn" data-act="eChar" data-v="${c.id}" ${pressed(p.charId === c.id)}>${c.name}</button>`).join('')}</div>`)}
    ${disc('style', '型', styleName ? val(styleName, true) : val('未設定', false), styleBody)}
    ${disc('weapon', 'メイン武器', p.weaponType ? val(p.weaponName ? `${p.weaponName}（${p.weaponType}）` : p.weaponType, true) : val('未設定', false), weaponBody)}
    ${disc('vessel', '献器', !p.charId ? val('先に夜渡りを選択', false) : v ? { html: `<span class="txt">${esc(v.name)}</span>${vesselCols(v, 'normal')}`, set: true } : val('未選択', false), vesselBody, !p.charId)}
    ${v ? card('遺物（景色）', [0, 1, 2].map(i => slot('normal', i)).join(''))
      + card('深層遺物（昏景）', [0, 1, 2].map(i => slot('deep', i)).join(''), '<span class="val">深き夜用</span>')
      + '<p class="hint">枠は空いたままでも保存できます。</p>' : ''}
    ${S.edit.isNew ? '' : `<div class="row-actions" style="justify-content:center"><button class="ghost danger" data-act="eDel">${S.confirmDel === 'edit' ? 'もう一度押すと削除' : 'このプリセットを削除'}</button></div>`}
  </div>`;
}
function editSlot() {
  const { k, i, data: r, existed, mode } = S.edit.slot;
  const sc = VESSEL[S.edit.data.vesselId][k][i];
  const slot = (kind, j) => {
    const e = r[kind][j] && ALL_EFF[r[kind][j]]; const dem = kind === 'demerits';
    return `<button class="slot-btn ${dem ? 'demerit' : ''} ${e ? 'filled' : ''}" data-act="pickEff" data-k="${kind}" data-v="${j}">
      ${dem ? '<span class="n" style="color:var(--loss)">↳</span>' : `<span class="n">${j + 1}</span>`}${e ? `<span>${e.name}</span><span class="badge">${e.cat}</span>` : `<span class="empty">${dem ? 'デメリット（なければ空のまま）' : '効果を選ぶ'}</span>`}</button>`;
  };
  const pairs = [];
  for (let j = 0; j < 3; j++) {
    const e = r.effects[j] && ALL_EFF[r.effects[j]];
    const dem = k === 'deep' && demeritAllowed(e) ? slot('demerits', j) : '';
    pairs.push(`<div class="pair">${slot('effects', j)}${dem}</div>`);
  }
  BAR = `<button class="ghost" data-act="eSlotCancel">戻る</button><button class="primary" data-act="eSlotSave">この遺物で決定</button>`;
  return `<div class="stack-lg">
    <div class="eyebrow">${esc(S.edit.data.name || 'プリセット')} ／ ${k === 'deep' ? '深層遺物' : '遺物'}の${i + 1}枠目（${sc === 'any' ? 'どの色でも可' : COLOR[sc].name + 'の枠'}）</div>
    ${k === 'normal' ? `<div class="seg seg3">${[['normal', '通常の遺物'], ['lord', '夜の王'], ['char', '固有遺物']].map(([m, l]) => `<button data-act="eSlotMode" data-v="${m}" ${pressed(mode === m)}>${l}</button>`).join('')}</div>` : ''}
    ${mode !== 'normal' ? specialPicker(mode, sc, r) : `
    <section class="card-sec">
      <div class="relic-title"><span class="color-dot c-${r.color}"></span>${relicName(r)}</div>
      ${sc === 'any' ? `<div class="chips">${COLORS.map(c => `<button class="chip small" data-act="eColor" data-v="${c.id}" ${pressed(r.color === c.id)}><span class="color-dot c-${c.id}" style="width:10px;height:10px;vertical-align:0;margin-right:6px"></span>${c.word}</button>`).join('')}</div>` : ''}
      <div class="section">${pairs.join('')}</div>
      <p class="hint">大きさ（壮大・端正・繊細）は効果の数で自動で決まります。${k === 'deep' ? 'デメリットは、付く効果・段階を選んだときだけ入力欄が出ます。' : ''}</p>
    </section>`}
    ${existed ? `<div class="row-actions" style="justify-content:center"><button class="ghost danger" data-act="eSlotClear">この枠を空にする</button></div>` : ''}
  </div>`;
}
function styleText(p) {
  const parts = [];
  if (p.style) parts.push(STYLES.find(x => x.id === p.style).name + ((p.spec || []).length ? `（${p.spec.join('・')}特化）` : ''));
  if (p.weaponType) parts.push(p.weaponName ? `${p.weaponName}（${p.weaponType}）` : p.weaponType);
  return parts.join('・');
}
function specialPicker(mode, sc, r) {
  const charId = S.edit.data.charId;
  const list = SPECIALS.filter(x => x.type === mode && (mode === 'lord' || x.who === charId || x.who === 'any'));
  const ok = list.filter(x => fitsSpecial(sc, x)), ng = list.filter(x => !fitsSpecial(sc, x));
  const card = x => `<button class="card special ${r.special === x.id ? 'on' : ''}" data-act="eSpecial" data-v="${x.id}" ${pressed(r.special === x.id)}>
    <span class="title"><span style="display:flex;gap:8px;align-items:center"><span class="color-dot ${x.color ? 'c-' + x.color : 'c-any'}" style="width:14px;height:14px"></span>${x.name}</span>
    <span class="badge">${mode === 'lord' ? LORD[x.who].name : x.who === 'any' ? '共通' : CHAR[x.who].name}</span></span>
    <ul class="eff-list">${x.effects.map(e => `<li>${esc(e)}</li>`).join('')}</ul></button>`;
  return `<div class="section" style="gap:8px">
    ${ok.length ? ok.map(card).join('') : `<p class="hint">この枠の色に合う${mode === 'lord' ? '夜の王の' : '固有'}遺物はありません</p>`}
    ${ng.length ? `<p class="hint">色が合わないため装備できない：${ng.map(x => x.name).join('、')}</p>` : ''}
    <p class="hint">効果は固定なので、選ぶだけで登録できます。</p></div>`;
}
// ---------- sheets ----------
function renderSheet() {
  const el = document.getElementById('sheet');
  const sh = S.sheet;
  if (!sh) { el.innerHTML = ''; return; }
  if (sh.type === 'menu') { el.innerHTML = menuSheet(); return; }
  const isDem = sh.kind === 'demerits';
  const deep = S.edit.slot.k === 'deep';
  const current = S.edit.slot.data[sh.kind][sh.idx];
  const charName = S.edit.data.charId ? CHAR[S.edit.data.charId].name : null;
  // キャラ固有の効果は、プリセットの夜渡りの分だけ出す
  const fams = (isDem ? DEMERIT_FAMS : deep ? DEEP_FAMS : NORMAL_FAMS).filter(f => !f.charName || f.charName === charName);
  const cats = catsOf(fams);
  const q = (sh.q || '').trim();
  const items = fams.filter(f => (!sh.cat || f.cat === sh.cat) && (!q || f.name.includes(q) || f.levels.some(e => e.name.includes(q))));
  const head = isDem ? 'デメリットを選ぶ' : deep ? '深層の効果を選ぶ' : '効果を選ぶ';
  // 大項目は同じ幅のボタンを5列で並べる（スクロールなし）
  const catItems = [['', 'すべて'], ...cats.map(c => [c, c])];
  const tools = `<div class="cat-grid">${catItems.map(([v, l]) => `<button class="cat-btn" data-act="sCat" data-v="${v}" ${pressed((sh.cat || '') === v)}>${l.replace('/', '/<wbr>')}</button>`).join('')}</div>`;
  const demTag = f => !deep || isDem ? '' : f.dem === null ? '' : f.dem === 0 ? '<span class="dem-tag">デメリット有</span>' : f.dem > 0 ? `<span class="dem-tag">+${f.dem}以上でデメリット</span>` : '';
  const row = f => {
    const on = f.levels.some(e => e.id === current);
    if (f.opts) {
      // ○○ は行をタップすると、その場で武器種・系統のチップが開く
      const open = sh.open === f.fid || (q && f.levels.some(e => e.name.includes(q)) && !f.name.includes(q));
      const cur = on ? ALL_EFF[current].variant : null;
      return `<div class="pick-wrap ${on ? 'on' : ''}"><button class="pick" data-act="sOpen" data-v="${f.fid}" aria-expanded="${!!open}"><span>${f.name.replace('○○', cur ? `<b>${cur}</b>` : '○○')}${demTag(f)}</span><span class="cat">${open ? '閉じる' : '選ぶ ›'}</span></button>
        ${open ? `<div class="opt-chips">${f.levels.map(e => `<button class="chip small" data-act="sPickEff" data-v="${e.id}" ${pressed(current === e.id)}>${e.variant}</button>`).join('')}</div>` : ''}</div>`;
    }
    if (!f.hasLv) return `<button class="pick" data-act="sPickEff" data-v="${f.levels[0].id}" ${pressed(current === f.levels[0].id)}><span>${f.name}${demTag(f)}</span><span class="cat">${f.cat}</span></button>`;
    return `<div class="pick fam-row ${on ? 'on' : ''}"><span>${f.name}${demTag(f)}</span><span class="lv-btns">${f.levels.map(e =>
      `<button class="lv ${demeritAllowed(e) && deep && !isDem ? 'has-dem' : ''}" data-act="sPickEff" data-v="${e.id}" ${pressed(current === e.id)} aria-label="${e.name}">+${e.lv}</button>`).join('')}</span></div>`;
  };
  const list = `<button class="pick" data-act="sPickEff" data-v=""><span style="color:var(--dim)">外す</span></button>` +
    (items.length ? items.map(row).join('') : `<p class="hint">見つかりません</p>`);
  el.innerHTML = `<div class="scrim" data-act="sClose"></div><div class="sheet" role="dialog" aria-label="${head}">
    <div class="sheet-head"><h2>${head}</h2><button class="ghost" data-act="sClose">閉じる</button></div>
    ${tools}<div class="sheet-list" id="sheet-list">${list}</div></div>`;
}

function menuSheet() {
  const n = liveRuns().length;
  const item = (act, title, sub, cls = '') => `<button class="pick ${cls}" data-act="${act}"><span><b>${title}</b><br><span class="hint">${sub}</span></span><span class="cat">›</span></button>`;
  return `<div class="scrim" data-act="sClose"></div><div class="sheet" role="dialog" aria-label="データ管理">
    <div class="sheet-head"><h2>データ管理</h2><button class="ghost" data-act="sClose">閉じる</button></div>
    <p class="hint">記録はこの端末のブラウザに保存されています（戦績 ${n}件・プリセット ${db.presets.length}件）。機種変更の前やブラウザのデータを消す前に、バックアップを保存してください。</p>
    <div class="sheet-list">
      ${item('exportJson', 'バックアップを保存', '全データをファイルに書き出します')}
      <label class="pick" for="importFile"><span><b>バックアップから復元</b><br><span class="hint">今のデータは、ファイルの内容に置き換わります</span></span><span class="cat">›</span></label>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
      ${item('exportCsv', 'CSVで書き出す', '戦績をExcelなどで開ける形にします')}
      ${item('loadSample', S.confirmDel === 'sample' ? 'もう一度押すとサンプルに置き換えます' : 'サンプルデータを入れる', '今のデータは消えて、試し用の戦績64件とプリセット3件になります', S.confirmDel === 'sample' ? 'danger' : '')}
      ${item('wipe', S.confirmDel === 'wipe' ? 'もう一度押すとすべて削除します' : 'すべてのデータを削除', '戦績とプリセットをすべて消します。元に戻せません', 'danger')}
    </div></div>`;
}
function replaceDb(next) {
  db.runs = next.runs; db.relics = next.relics; db.presets = next.presets; db.prefs = next.prefs || {};
  S.edit = null; S.openRun = null; S.form = blankForm();
}
function csvRows() {
  const rows = [['日付', '夜の王', '常夜', '地図欠損など', 'モード', '深度', '人数', '夜渡り', '結果', '倒れた場所', 'ビルド', 'メモ']];
  liveRuns().sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt - b.updatedAt).forEach(r => rows.push([
    r.date, LORD[r.lordId]?.name ?? r.lordId, r.everdark ? '常夜' : '', (r.flags || []).map(x => RUN_FLAG[x]?.name ?? x).join('/'), MODE[r.mode]?.name ?? r.mode, r.depth ?? '', PARTYM[r.party]?.name ?? r.party,
    CHAR[r.charId]?.name ?? r.charId, r.result === 'win' ? '勝利' : '敗北', r.lossAt ? LOSS[r.lossAt].name : '', presetById(r.presetId)?.name ?? '', r.note]));
  return rows;
}

// ---------- render ----------
const ICONS = {
  record: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  stats: '<path d="M5 20V11M12 20V5M19 20v-6"/><path d="M3 20h18"/>',
  builds: '<path d="M7 3h10l4 6-9 12L3 9z"/><path d="M3 9h18M12 21 8.5 9 12 3l3.5 6z"/>',
};
const TABS = [{ id: 'record', name: '記録' }, { id: 'history', name: '履歴' }, { id: 'stats', name: '統計' }, { id: 'builds', name: 'ビルド' }];
function appSub() {
  const runs = liveRuns();
  if (S.tab === 'record') { const t = rate(runs.filter(r => r.date === today())); return t.n ? `今日 ${t.n}戦 ${t.w}勝 ${t.n - t.w}敗` : '今日の夜を記録する'; }
  if (S.tab === 'history') return `${runs.length}戦の記録`;
  if (S.tab === 'stats') { const a = rate(runs); return `通算 ${a.n}戦・勝率 ${pct(a.p)}`; }
  return `プリセット ${db.presets.length}件`;
}
function render() {
  document.getElementById('tabs').innerHTML = TABS.map(t => `<button data-act="tab" data-v="${t.id}" ${S.tab === t.id ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[t.id]}</svg>${t.name}</button>`).join('');
  BAR = '';
  const v = { record: viewRecord, history: viewHistory, stats: viewStats, builds: viewBuilds }[S.tab];
  document.getElementById('view').innerHTML = v();
  document.getElementById('appsub').textContent = appSub();
  document.getElementById('actionbar').innerHTML = BAR ? `<div class="action-bar"><div class="in">${BAR}</div></div>` : '';
  document.querySelector('.app').classList.toggle('has-bar', !!BAR);
  renderSheet();
  save(db);
}
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.innerHTML = '', 1800);
}

// ---------- events ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act, v = t.dataset.v, f = S.form;
  if (a !== 'delRun' && a !== 'eDel' && a !== 'loadSample' && a !== 'wipe') S.confirmDel = null;
  switch (a) {
    case 'tab': S.tab = v; S.sheet = null; window.scrollTo(0, 0); break;
    case 'menu': S.sheet = { type: 'menu' }; break;
    case 'exportJson': exportJson(db); toast('バックアップを保存しました'); return;
    case 'exportCsv': exportCsv(csvRows()); toast('CSVを書き出しました'); return;
    case 'loadSample':
      if (S.confirmDel !== 'sample') { S.confirmDel = 'sample'; break; }
      replaceDb(seed()); S.confirmDel = null; S.sheet = null; toast('サンプルデータを入れました'); break;
    case 'wipe':
      if (S.confirmDel !== 'wipe') { S.confirmDel = 'wipe'; break; }
      replaceDb({ runs: [], relics: [], presets: [] }); S.confirmDel = null; S.sheet = null; toast('すべてのデータを削除しました'); break;
    case 'date': f.dateMode = v; if (v === 'today') f.date = today(); if (v === 'yesterday') f.date = daysAgo(1); break;
    case 'lord': f.lordId = f.lordId === v ? null : v; if (!f.lordId) f.flags = []; S.recOpen.lord = !f.lordId; break;
    case 'rdisc': S.recOpen[v] = !recOpen(v, !!(v === 'lord' ? f.lordId : f.charId)); break;
    case 'everdark': f.everdark = v === 'yes'; if (f.lordId && !lordsFor(f.everdark).some(l => l.id === f.lordId)) f.lordId = null; break;
    case 'flag': f.flags = f.flags.includes(v) ? f.flags.filter(x => x !== v) : [...f.flags, v]; break;
    case 'char': f.charId = v; f.presetId = lastPresetFor(v); S.recOpen.char = false; break;
    case 'result': f.result = v; if (v === 'win') f.lossAt = null; break;
    case 'lossAt': f.lossAt = f.lossAt === v ? null : v; break;
    case 'mode': f.mode = v; prefs().mode = v; if (v !== 'deep') { f.depth = null; prefs().depth = null; } break;
    case 'depth': f.depth = f.depth === +v ? null : +v; prefs().depth = f.depth; break;
    case 'party': f.party = v; prefs().party = v; break;
    case 'preset': f.presetId = v || null; (prefs().presetByChar ||= {})[f.charId] = f.presetId; break;
    case 'save': {
      if (!(f.everdark !== null && f.lordId && f.charId && f.result)) return;
      db.runs.push({ id: uid(), date: f.dateMode === 'pick' ? f.date : f.dateMode === 'yesterday' ? daysAgo(1) : today(), lordId: f.lordId, everdark: f.everdark, flags: f.flags, mode: f.mode, depth: f.mode === 'deep' ? f.depth : null, party: f.party, charId: f.charId, result: f.result, lossAt: f.lossAt, presetId: f.presetId, note: f.note.trim(), updatedAt: Date.now(), deleted: false });
      toast(`${LORD[f.lordId].name}戦の${f.result === 'win' ? '勝利' : '敗北'}を記録しました`);
      Object.assign(f, { lordId: null, everdark: null, flags: [], result: null, lossAt: null, note: '' }); S.recOpen = {};
      break;
    }
    case 'openRun': S.openRun = S.openRun === v ? null : v; break;
    case 'delRun':
      if (S.confirmDel !== v) { S.confirmDel = v; break; }
      { const r = db.runs.find(r => r.id === v); r.deleted = true; r.updatedAt = Date.now(); } S.confirmDel = null; S.openRun = null; toast('削除しました'); break;
    case 'sf': S.stats[t.dataset.k] = v; break;
    case 'bv': S.buildView = v; break;
    case 'newPreset': S.edit = { type: 'preset', isNew: true, open: { char: true }, data: { id: uid(), name: '', charId: null, vesselId: null, normal: [null, null, null], deep: [null, null, null] } }; window.scrollTo(0, 0); break;
    case 'editPreset': S.edit = { type: 'preset', open: {}, data: structuredClone(presetById(v)) }; window.scrollTo(0, 0); break;
    case 'eChar': {
      const d = S.edit.data; d.charId = v; S.edit.open.char = false;
      if (d.vesselId && !vesselsFor(v).some(x => x.id === d.vesselId)) { d.vesselId = null; d.normal = [null, null, null]; d.deep = [null, null, null]; }
      if (!d.vesselId) S.edit.open.vessel = true;
      break;
    }
    case 'eVessel': {
      const d = S.edit.data; d.vesselId = v; S.edit.open.vessel = false;
      let removed = 0;
      ['normal', 'deep'].forEach(k => { d[k] = d[k].map((r, i) => { if (r && !fits(VESSEL[v][k][i], r)) { removed++; return null; } return r; }); });
      if (removed) toast(`枠の色が合わない遺物を${removed}つ外しました`);
      break;
    }
    case 'disc': S.edit.open[v] = !S.edit.open[v]; break;
    case 'eStyle': { const d = S.edit.data; d.style = d.style === v ? null : v; if (d.style !== 'caster' && d.style !== 'hybrid') d.spec = []; break; }
    case 'eSpec': { const d = S.edit.data; d.spec ||= []; d.spec = d.spec.includes(v) ? d.spec.filter(x => x !== v) : [...d.spec, v]; break; }
    case 'eWeapon': { const d = S.edit.data; d.weaponType = d.weaponType === v ? null : v; S.edit.open.weapon = false; break; }
    case 'eSlotMode': { const sl = S.edit.slot; if (sl.mode !== v) { sl.mode = v; sl.data.special = null; } break; }
    case 'eSpecial': S.edit.slot.data.special = v; break;
    case 'openSlot': {
      const k = t.dataset.k, i = +v, cur = S.edit.data[k][i], sc = VESSEL[S.edit.data.vesselId][k][i];
      S.edit.slot = { k, i, existed: !!cur, mode: cur && cur.special ? SPECIAL[cur.special].type : 'normal', data: cur ? structuredClone(cur) : { size: 3, color: sc === 'any' ? 'red' : sc, kind: k, effects: [null, null, null], demerits: [null, null, null] } };
      window.scrollTo(0, 0); break;
    }
    case 'eSize': S.edit.slot.data.size = +v; break;
    case 'eColor': S.edit.slot.data.color = v; break;
    case 'pickEff': { const cur = S.edit.slot.data[t.dataset.k][+v]; const e = cur && ALL_EFF[cur]; S.sheet = { type: 'eff', kind: t.dataset.k, idx: +v, cat: e ? e.cat : null, q: '', open: e && FAM[e.fid].opts ? e.fid : null }; break; }
    case 'sCat': S.sheet.cat = v || null; renderSheet(); return;
    case 'sPickEff': { const sd = S.edit.slot.data; sd[S.sheet.kind][S.sheet.idx] = v || null; if (S.sheet.kind === 'effects' && !demeritAllowed(ALL_EFF[v])) sd.demerits[S.sheet.idx] = null; S.sheet = null; break; }
    case 'sOpen': S.sheet.open = S.sheet.open === v ? null : v; renderSheet(); return;
    case 'sClose': S.sheet = null; break;
    case 'eSlotSave': {
      const { k, i, data: r, mode } = S.edit.slot;
      if (mode !== 'normal') {
        if (!r.special) { toast('遺物を選んでください'); break; }
        const sp = SPECIAL[r.special], sc = VESSEL[S.edit.data.vesselId][k][i];
        S.edit.data[k][i] = { special: sp.id, color: sp.color || (sc === 'any' ? 'red' : sc), kind: 'normal', effects: [null, null, null], demerits: [null, null, null], size: sp.effects.length };
        S.edit.slot = null; window.scrollTo(0, 0); break;
      }
      r.special = null;
      // 効果のある行だけを詰めて保存し、大きさは効果の数から決める
      const rows = [0, 1, 2].filter(j => r.effects[j]).map(j => [r.effects[j], k === 'deep' && demeritAllowed(ALL_EFF[r.effects[j]]) ? r.demerits[j] : null]);
      r.effects = [0, 1, 2].map(j => rows[j] ? rows[j][0] : null);
      r.demerits = [0, 1, 2].map(j => rows[j] ? rows[j][1] : null);
      r.size = rows.length;
      S.edit.data[k][i] = rows.length ? r : null;
      if (!rows.length) toast('効果が空なので、枠を空にしました');
      S.edit.slot = null; window.scrollTo(0, 0); break;
    }
    case 'eSlotClear': { const { k, i } = S.edit.slot; S.edit.data[k][i] = null; S.edit.slot = null; break; }
    case 'eSlotCancel': S.edit.slot = null; break;
    case 'eSave': {
      const d = S.edit.data;
      if (!d.name.trim()) d.name = d.charId ? CHAR[d.charId].name + 'のビルド' : '名前なしのビルド';
      const i = db.presets.findIndex(x => x.id === d.id);
      i >= 0 ? (db.presets[i] = d) : db.presets.push(d);
      toast('保存しました'); S.edit = null; break;
    }
    case 'eDel': {
      if (S.confirmDel !== 'edit') { S.confirmDel = 'edit'; break; }
      const id = S.edit.data.id;
      db.presets = db.presets.filter(p => p.id !== id);
      S.confirmDel = null; S.edit = null; toast('削除しました'); break;
    }
    case 'eCancel': S.edit = null; break;
    default: return;
  }
  render();
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.field) S.form[t.dataset.field] = t.value;
  if (t.dataset.edit) S.edit.data[t.dataset.edit] = t.value;
  if (t.hasAttribute('data-sheetq')) {
    S.sheet.q = t.value;
    const pos = t.selectionStart;
    renderSheet();
    const q = document.getElementById('eff-q'); q.focus(); q.setSelectionRange(pos, pos);
  }
});
document.addEventListener('toggle', e => { if (e.target.dataset?.details === 'opt') S.optOpen = e.target.open; }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) { S.sheet = null; renderSheet(); } });
render();

document.addEventListener('change', e => {
  if (e.target.id !== 'importFile' || !e.target.files[0]) return;
  readJsonFile(e.target.files[0])
    .then(next => { replaceDb(next); S.sheet = null; render(); toast(`復元しました（戦績 ${next.runs.filter(r => !r.deleted).length}件）`); })
    .catch(err => toast('復元できませんでした：' + err.message));
});

// オフラインでも開けるようにする（開発サーバーでは使わない）
if ('serviceWorker' in navigator && !window.__DEV__) {
  navigator.serviceWorker.register('./sw.js').catch(e => console.warn('service worker', e));
}
