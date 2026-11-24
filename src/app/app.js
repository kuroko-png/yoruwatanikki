// 夜渡り日記 アプリ本体
import { LORDS } from '../data/lords.js';
import { CHARS } from '../data/characters.js';
import { OPT, EFF_NORMAL_ROWS, EFF_DEEP_ROWS, DEMERIT_ROWS } from '../data/effects.js';
import { VESSEL_ROWS } from '../data/vessels.js';
import { SPECIAL_ROWS } from '../data/relics.js';
import { COLORS, SIZES, KINDS, STYLES, SPEC_SORC, SPEC_INC, WEAPON_TYPES, LOSS_AT, MODES, PARTY, DEPTHS, RUN_FLAGS, SHIFTS } from '../data/labels.js';
import { HELP } from '../data/help.js';
import { NIGHT_BOSSES } from '../data/night_bosses.js';
import { load, save, exportJson, exportCsv, readJsonFile } from './store.js';
import { scanRelics } from './scan.js';
import { initKotsubo, viewKotsubo, kotsuboAct, kotsuboSub, startKotsubo } from './kotsubo.js';
import { initKnowledge, viewKnowledge, knowledgeAct, knowledgeSub, knowledgeWheel } from './knowledge.js';
import { ngHit } from '../data/ngwords.js';
import { PRIVACY, PRIVACY_UPDATED } from '../data/privacy.js';
import { CHANGELOG } from '../data/changelog.js';
import { COMMENT_TEMPLATES, COMMENT_GROUPS, COMMENT_WORDS, COMMENT_CONJ, COMMENT_T_START, commentFull } from '../data/comments.js';

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
// 献器は選ばない。入っている遺物の色がすべて収まる献器（夜渡りの献器と共通の聖杯）を自動で探す。
// override：{ k, i, r } を渡すと「その枠をその遺物にしたら」で調べる（置ける色かどうかの判定に使う）
function fitVessel(d, override) {
  if (!d.charId) return null;
  const at = (k, j) => override && override.k === k && override.i === j ? override.r : d[k][j];
  return vesselsFor(d.charId).find(v => ['normal', 'deep'].every(k => [0, 1, 2].every(j => { const r = at(k, j); return !r || fits(v[k][j], r); }))) || null;
}
// 今編集中の枠に、その色の遺物を置いても、どれかの献器に収まるか
const canColor = color => { const { k, i } = S.edit.slot; return !!fitVessel(S.edit.data, { k, i, r: { color } }); };
const specialOk = x => !x.color || canColor(x.color);
const fits = (slotColor, relic) => slotColor === 'any' || !relic.color || slotColor === relic.color;

// 夜の王（常夜含む）の遺物・夜渡りの固有遺物（出典: 神攻略wiki 遺物ページ）
const SPECIALS = SPECIAL_ROWS.map(([type, who, name, color, effects], i) => ({ id: 'sp' + i, type, who, name, color, effects }));
const SPECIAL = byIdEarly(SPECIALS);
const fitsSpecial = (sc, sp) => sc === 'any' || !sp.color || sp.color === sc;
// ビルドの型・メイン武器
const byId = arr => Object.fromEntries(arr.map(x => [x.id, x]));
const RUN_FLAG = byId(RUN_FLAGS), SHIFT = byId(SHIFTS);
// 印の表示名。地変は種類があれば「地変：火口」のように出す
const flagName = (x, r) => x === 'shift' && r.shift ? `地変：${SHIFT[r.shift]?.name ?? r.shift}` : RUN_FLAG[x]?.name ?? x;
const LORD = byId(LORDS), CHAR = byId(CHARS), LOSS = byId(LOSS_AT), MODE = byId(MODES), PARTYM = byId(PARTY);

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Math.random().toString(36).slice(2));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const today = () => ymd(new Date());
function dateLabel(s) {
  if (!s) return '日付なし';
  if (s === today()) return '今日';
  if (s === daysAgo(1)) return '昨日';
  const [y, m, d] = s.split('-').map(Number);
  const wd = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return `${y === new Date().getFullYear() ? '' : `${y}/`}${m}/${d}（${wd}）`;  // 今年以外は年も出す
}
const pct = p => Math.round(p * 100) + '%';
// 夜の王・夜渡りのアイコン（名前の左に置く）。画像は icons/lords, icons/chars（tools/make_unit_icons.py で作る）
const ICON_DIR = { lord: 'lords', char: 'chars' };
// ever：常夜の王のときは紫にする
const ico = (kind, id, ever) => id && ICON_DIR[kind] ? `<img class="ico${ever && kind === 'lord' ? ' ever' : ''}" src="icons/${ICON_DIR[kind]}/${id}.png" alt="" aria-hidden="true" decoding="async">` : '';
const lordName = (id, ever) => `${ico('lord', id, ever)}${LORD[id]?.name ?? id}`;
const charName = id => `${ico('char', id)}${CHAR[id]?.name ?? id}`;
const pressed = b => `aria-pressed="${b ? 'true' : 'false'}"`;

// ---------- sample data ----------
// サンプルデータは、開発用の手元の画面（localhost）でだけ「データ管理」に出す。公開版の利用者には出さない
const DEV_HOST = ['localhost', '127.0.0.1'].includes(location.hostname);
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
// 夜の王は「未選択」にせず、最初はグラディウス。夜渡りは毎回選んでもらうので、最初は「未選択」
const DEFAULT_LORD = 'gladius';
const blankForm = () => ({ dateMode: 'today', date: today(), lordId: DEFAULT_LORD, everdark: null, flags: [], shift: null, mode: prefs().mode || 'normal', depth: prefs().depth || null,
  party: prefs().party || 'trio', charId: null, result: null, lossAt: null, presetId: null, note: '' });
const lastPresetFor = charId => { const id = (prefs().presetByChar || {})[charId]; return id && db.presets.some(p => p.id === id && !p.deleted) ? id : null; };
const S = {
  tab: 'record', form: blankForm(), openRun: null, confirmDel: null,
  stats: { scope: 'mine', period: 'all', mode: 'all', drill: {}, heatBy: 'lord' },
  hist: { result: 'all', lord: '', char: '' },
  enemy: { cat: 0, q: '', party: 'trio', partyOpen: false, lord: '', lordOpen: false, base: '', baseOpen: false, field: '', fieldOpen: false, mob: '', mobOpen: false, closed: {}, open: null, limit: 60 },  // 人数はトリオから。変えたいときだけ開く
  buildView: 'presets', edit: null, sheet: null,
};
// 夜渡りは毎回選んでもらう（前回の夜渡りは自動で入れない）
const liveRuns = () => db.runs.filter(r => !r.deleted);
// 記録した時刻（createdAt）がない前の戦績には、更新時刻を入れておく（ミニゲームの戦果ボーナスを、直した戦績で二重に数えないため）
db.runs.forEach(r => { if (!r.createdAt) r.createdAt = r.updatedAt || 0; });
const relicById = id => db.relics.find(r => r.id === id);
const presetById = id => db.presets.find(p => p.id === id);
// 削除したプリセットは「削除済み」として残し、過去の戦績・統計では使い続ける
const activePresets = () => db.presets.filter(p => !p.deleted);
const presetLabel = p => p.deleted ? `${p.name}（削除済み）` : p.name;
// プリセットは中身を直すたびに版（rev）が上がる。戦績は記録した時点の版を覚えていて、統計ではその版の中身を使う
const presetRev = p => p.rev || 1;
const BUILD_FIELDS = ['charId', 'vesselId', 'style', 'spec', 'weaponType', 'weaponName', 'normal', 'deep'];
const buildSnapshot = p => Object.fromEntries(BUILD_FIELDS.map(k => [k, structuredClone(p[k] ?? null)]));
function runBuild(r) {
  const p = r.presetId && presetById(r.presetId);
  if (!p) return null;
  const want = r.presetRev || 1;
  if (presetRev(p) === want) return p;
  return (p.history || []).find(h => h.rev === want) || p;
}

// ---------- views ----------
let BAR = '';  // 画面下に固定するボタン（各画面が設定する）
const card = (title, body, right = '') => `<section class="card-sec"><div class="sec-head"><h2>${title}</h2>${right}</div>${body}</section>`;

function viewRecord() {
  const f = S.form;
  const dateOk = f.dateMode !== 'pick' || (/^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.date <= today());
  const depthOk = f.mode !== 'deep' || !!f.depth || !!S.editRun;  // 前に深度なしで記録した戦績は、直すときは深度なしでも更新できる
  const canSave = dateOk && f.everdark !== null && f.lordId && f.charId && f.result && depthOk;
  if (f.presetId && !activePresets().some(p => p.id === f.presetId) && !(S.editRun && f.presetId === S.form.origPresetId)) f.presetId = null;
  const presets = db.presets.filter(p => (!p.deleted && p.charId === f.charId) || p.id === f.presetId);
  const lords = lordsFor(f.everdark);
  const missing = recMissing(f);
  const chip = (act, v, label, on, cls = 'chip') => `<button class="${cls}" data-act="${act}" data-v="${v}" ${pressed(on)}>${label}</button>`;
  // 画面の下：新しく記録するときは「勝利」「敗北」を押した時点で記録する（敗北は、どこで倒れたかを押すと記録）。
  // 戦績の編集だけは、勝敗を選んでから「更新する」を押す（押しただけで書き換わらないように）
  if (S.editRun) BAR = `<button class="ghost" data-act="cancelEdit">やめる</button><button class="primary" data-act="save" ${canSave ? '' : 'disabled'}>${canSave ? '更新する' : `<span class="need">あと：${[...missing, !f.result && '結果'].filter(Boolean).join('・')}</span>`}</button>`;
  else if (S.lossPick) BAR = `<div class="rec-bar loss-pick"><span class="rec-q">どこで倒れた？</span>
      <div class="rec-btns">${LOSS_AT.map(x => `<button class="result-btn loss" data-act="recLossAt" data-v="${x.id}">${x.name}</button>`).join('')}</div>
      <button class="link-btn" data-act="recLossBack">戻る</button></div>`;
  else BAR = `<div class="rec-bar">${missing.length ? `<span class="rec-need">あと：${missing.join('・')}</span>` : '<span class="rec-need ok">勝敗を押すと記録します</span>'}
      <div class="rec-btns ${missing.length ? 'not-yet' : ''}"><button class="result-btn win" data-act="recWin">勝利</button><button class="result-btn loss" data-act="recLoss">敗北</button></div></div>`;
  return `<div class="stack-lg">
    ${S.editRun ? `<div class="edit-banner"><b>戦績を編集中</b><span>直したら「更新する」を押してください</span></div>` : ''}
    ${card('日付', dateStrip(f), `<span class="date-now">${dateLabel(recDate(f))}${recDate(f) !== today() ? '<button class="link-btn" data-act="pickDate" data-v="today">今日に戻す</button>' : ''}</span>`)}
    <section class="card-sec pick-card">
      <div class="wheels">
        <div class="wheel-col ${f.everdark === true ? 'ever' : ''}"><div class="wheel-label">夜の王</div>${wheel('lord', lords, f.lordId, lordName)}</div>
        <div class="wheel-col"><div class="wheel-label">夜渡り</div>${wheel('char', CHARS, f.charId, charName, true)}</div>
      </div>
      <div class="pick-build"><div class="label">ビルド</div>
        ${f.charId ? `<div class="chips one-line">${chip('preset', '', 'ビルドなし', !f.presetId)}${presets.map(p => chip('preset', p.id, esc(presetLabel(p)), f.presetId === p.id)).join('')}</div>
          ${presets.length ? '' : `<p class="hint">${CHAR[f.charId].name}のプリセットはまだありません。「ビルド」タブで作れます。</p>`}`
          : '<p class="hint">夜渡りを選ぶと、その夜渡りのビルドを選べます。</p>'}</div>
    </section>
    <section class="card-sec cond-card">
      ${condRow('夜の王', chip('everdark', 'no', '通常', f.everdark === false, 'chip small') + chip('everdark', 'yes', '常夜', f.everdark === true, 'chip small'), f.everdark === null)}
      ${condRow('モード', MODES.map(m => chip('mode', m.id, m.name, f.mode === m.id, 'chip small')).join(''))}
      ${f.mode === 'deep' ? condRow('深度', DEPTHS.map(d => chip('depth', d, d, f.depth === d, 'chip small dchip')).join(''), !depthOk) : ''}
      ${condRow('人数', PARTY.map(m => chip('party', m.id, m.name, f.party === m.id, 'chip small')).join(''))}
      ${condRow('あれば', [RUN_FLAG.mapLoss, RUN_FLAG.bossUnknown, RUN_FLAG.shift].map(x => chip('flag', x.id, x.name, f.flags.includes(x.id), 'chip small')).join(''))}
      ${f.flags.includes('shift') ? condRow('地変', SHIFTS.map(x => chip('shift', x.id, x.name, f.shift === x.id, 'chip small')).join(''), false, 'sub') : ''}
      ${S.noteOpen || f.note ? `<div class="cond-note"><textarea id="f-note" data-field="note" placeholder="メモ（任意）例：最終戦で回復が足りなかった">${esc(f.note)}</textarea></div>`
        : '<button class="link-btn cond-memo" data-act="noteOpen">＋ メモを書く</button>'}
    </section>
    ${S.editRun ? card('結果', `<div class="result-row">
        <button class="result-btn win" data-act="result" data-v="win" ${pressed(f.result === 'win')}>勝利</button>
        <button class="result-btn loss" data-act="result" data-v="loss" ${pressed(f.result === 'loss')}>敗北</button></div>
      ${f.result === 'loss' ? `<div class="subpanel"><div class="label">どこで倒れた？</div>
        <div class="chips">${LOSS_AT.map(x => chip('lossAt', x.id, x.name, f.lossAt === x.id)).join('')}</div></div>` : ''}`) : ''}
  </div>`;
}
// 記録する（新しい戦績）・更新する（編集中の戦績）。勝敗は呼ぶ前に S.form に入れておく
function saveRecord() {
  const f = S.form;
  if (recMissing(f).length || !f.result) return;
  const date = recDate(f);
  const p = f.presetId && presetById(f.presetId);
  const fields = { date, lordId: f.lordId, everdark: f.everdark, flags: f.flags, shift: f.flags.includes('shift') ? f.shift : null, mode: f.mode, depth: f.mode === 'deep' ? f.depth : null, party: f.party,
    charId: f.charId, result: f.result, lossAt: f.result === 'loss' ? f.lossAt : null, presetId: f.presetId, note: f.note.trim() };
  if (S.editRun) {
    const r = db.runs.find(x => x.id === S.editRun);
    const keepRev = r.presetId === f.presetId ? r.presetRev : (p ? presetRev(p) : null);
    Object.assign(r, fields, { presetRev: keepRev, editedAt: Date.now() });
    S.editRun = null; S.form = blankForm();
    S.tab = 'history'; S.openRun = r.id; toast('戦績を更新しました'); return;
  }
  const newId = uid();
  document.querySelectorAll('.wheel').forEach(w => { w._moving = false; clearTimeout(w._t); });  // 記録したら、動いている途中の欄も最初の形に戻す
  db.runs.push({ id: newId, ...fields, presetRev: p ? presetRev(p) : null, createdAt: Date.now(), updatedAt: Date.now(), deleted: false });
  S.undo = { type: 'add', id: newId };
  toast(`${LORD[f.lordId].name}戦の${f.result === 'win' ? '勝利' : '敗北'}を記録しました`, { act: 'undo', label: '取り消す' });
  // 日付は、過去の日を選んでいたら、続けて記録しやすいようにそのまま残す（「今日」のままなら次も今日）
  // 夜の王はグラディウス、夜渡りは「未選択」に戻す（前回のまま記録してしまわないように）。ビルドは夜渡りを選ぶと、その夜渡りで前回使ったものが入る
  S.noteOpen = false;
  Object.assign(f, { lordId: DEFAULT_LORD, everdark: null, flags: [], shift: null, charId: null, presetId: null, result: null, lossAt: null, note: '' });
}
// 記録の「条件」カードの1行（左に項目名、右にボタン）。need＝まだ選んでいない（項目名を目立たせる）
const condRow = (k, body, need = false, cls = '') => `<div class="cond-row ${cls} ${need ? 'need' : ''}"><span class="k">${k}</span><div class="chips">${body}</div></div>`;
// 記録するのに足りないもの（勝敗は別）
function recMissing(f) {
  const dateOk = f.dateMode !== 'pick' || (/^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.date <= today());
  return [!dateOk && '日付', !f.lordId && '夜の王', !f.charId && '夜渡り', f.everdark === null && '通常/常夜', f.mode === 'deep' && !f.depth && !S.editRun && '深度'].filter(Boolean);
}
// 日付：横にスクロールする日付の列（左端が今日、右へ行くほど前の日）。右端のカレンダーから、もっと前の日も選べる
// dateMode が 'today' のときは、記録した時点の今日になる（日をまたいで開きっぱなしでもずれない）。過去の日は記録したあともそのまま残る
const DATE_DAYS = 30;
const recDate = f => f.dateMode === 'today' ? today() : f.date;
function dateStrip(f) {
  const sel = recDate(f), days = Array.from({ length: DATE_DAYS }, (_, i) => daysAgo(i));
  if (!days.includes(sel)) days.push(sel);  // カレンダーで選んだもっと前の日は、列の最後に足す
  const thisYear = new Date().getFullYear();
  const chipD = d => { const [y, m, dd] = d.split('-').map(Number), wd = '日月火水木金土'[new Date(y, m - 1, dd).getDay()];
    const tag = d === today() ? '今日' : d === daysAgo(1) ? '昨日' : y !== thisYear ? `${y}年` : '';
    return `<button class="day-chip ${wd === '日' ? 'sun' : wd === '土' ? 'sat' : ''}" data-act="pickDate" data-v="${d}" ${pressed(d === sel)}><small>${tag || '&nbsp;'}</small><b>${m}/${dd}</b><span>${wd}</span></button>`; };
  return `<div class="date-line"><div class="day-strip" id="day-strip">${days.map(chipD).join('')}</div>
    <label class="cal-btn" title="カレンダーから選ぶ"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg><span>一覧</span>
      <input type="date" id="f-date-pick" value="${sel}" max="${today()}" aria-label="カレンダーから日付を選ぶ"></label></div>`;
}
// 日付の列の位置：作り直しても、スクロールした位置のまま。選んだ日が見えないとき（カレンダーで選んだ・編集を開いた）は、その日が見える所へ
function initDateStrip() {
  const el = document.getElementById('day-strip'); if (!el) return;
  const on = el.querySelector('[aria-pressed="true"]');
  if (S.dayStripX != null) el.scrollLeft = S.dayStripX;
  if (!on) return;
  // 列の中での位置（右端は薄く消えていくので、見えている幅は8割ほどとして考える）
  const x = on.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft, seen = el.clientWidth * .82;
  if (x < el.scrollLeft || x + on.offsetWidth > el.scrollLeft + seen) el.scrollLeft = x - (seen - on.offsetWidth) / 2;
}
document.addEventListener('scroll', e => { if (e.target?.id === 'day-strip') S.dayStripX = e.target.scrollLeft; }, true);
// パソコンのブラウザでも、ボタンのどこを押してもカレンダーが開くように
document.addEventListener('click', e => { if (e.target.id === 'f-date-pick') try { e.target.showPicker?.(); } catch { /* 開けない端末はそのまま */ } });
// 夜の王・夜渡りの縦スクロールの選択欄（ドラム式）。真ん中の枠に止まったものが選ばれる
const WHEEL_H = 40;  // 1行の高さ（style.css の .wheel-item と同じ）
// none＝先頭に「未選択」の行を置く（夜渡りだけ）
function wheel(kind, items, cur, label, none = false) {
  const off = none ? 1 : 0, at = items.findIndex(x => x.id === cur);
  const idx = at < 0 ? 0 : at + off;
  const item = (i, v, html) => `<button class="wheel-item ${i === idx ? 'center' : ''} ${v ? '' : 'none'}" data-act="wheelPick" data-i="${i}" data-v="${v}" role="option" aria-selected="${i === idx}">${html}</button>`;
  return `<div class="wheel-wrap"><div class="wheel" data-wheel="${kind}" data-idx="${idx}" role="listbox" aria-label="${{ lord: '夜の王', char: '夜渡り', bjD1: '1日目の夜ボス', bjD2: '2日目の夜ボス' }[kind]}を選ぶ">
    <div class="wheel-pad"></div>${none ? item(0, '', '未選択') : ''}${items.map((x, i) => item(i + off, x.id, label(x.id))).join('')}<div class="wheel-pad"></div>
  </div><span class="wheel-band" aria-hidden="true"></span></div>`;
}
// 画面を作り直したあと、選んでいるものが真ん中に来るように位置を戻す
// まだ動いている途中だった欄は、作り直す前の位置のまま続ける（止まったときに、そこで選ばれる）
function initWheels(moving = {}) { document.querySelectorAll('.wheel').forEach(w => { const top = moving[w.dataset.wheel] ?? +w.dataset.idx * WHEEL_H; if (w.dataset.wheel in moving) { w._moving = true; w._t = setTimeout(() => commitWheel(w), 150); } else if (top) w._init = true; w.scrollTop = top; }); }
let wheelTouch = false;  // 止まったかどうかを待つタイマーは、欄ごとに別に持つ（w._t）
// 止まったら（指を離して、動きが落ち着いたら）、真ん中のものを選ぶ
function commitWheel(w) {
  if (wheelTouch || !w.isConnected) return;
  w._moving = false; w._target = undefined;
  const i = Math.round(w.scrollTop / WHEEL_H), v = w.querySelectorAll('.wheel-item')[i]?.dataset.v, f = S.form;
  if (v !== undefined && w.dataset.wheel.startsWith('bj')) { if (knowledgeWheel(w.dataset.wheel, v)) render(); return; }  // 知識タブのボス不明チェッカー（1日目・2日目）
  if (v === undefined || (!v && w.dataset.wheel === 'lord')) return;  // 夜の王に「未選択」はない
  // 常夜にいない夜の王（ナメレス・ストラゲス）を選んだら、夜の王の種類は自動で「通常」にする
  if (w.dataset.wheel === 'lord') { if (f.lordId === v) return; f.lordId = v; if (LORD[v]?.everdark === false) f.everdark = false; }
  else { const c = v || null; if (f.charId === c) return; f.presetId = c ? lastPresetFor(c) : null; f.charId = c; }
  render();
}
document.addEventListener('scroll', e => {
  const w = e.target; if (!(w instanceof Element) || !w.matches('.wheel')) return;
  const i = Math.round(w.scrollTop / WHEEL_H);
  w.querySelectorAll('.wheel-item').forEach((b, k) => b.classList.toggle('center', k === i));
  if (w._init) { w._init = false; return; }  // 位置を戻しただけ（指で動かしたのではない）
  w._moving = true;
  clearTimeout(w._t); w._t = setTimeout(() => commitWheel(w), 150);
}, true);
document.addEventListener('touchstart', e => { const w = e.target.closest?.('.wheel'); if (w) { wheelTouch = true; w._target = undefined; } }, { passive: true, capture: true });
document.addEventListener('touchend', e => { if (!wheelTouch) return; wheelTouch = false; const w = e.target.closest?.('.wheel'); if (w) { clearTimeout(w._t); w._t = setTimeout(() => commitWheel(w), 150); } }, { passive: true, capture: true });
// 夜の王の下の印：「地図欠損」or「ボス不明」と、それとは別に「地変」。地変を選んだときだけ、その下に種類を出す
function flagRow(f, chip) {
  const c = x => chip('flag', x.id, x.name, f.flags.includes(x.id), 'chip small');
  const shiftOn = f.flags.includes('shift');
  return `<div class="flag-row"><span class="flag-label">あれば</span><span class="flag-alt">${c(RUN_FLAG.mapLoss)}<span class="flag-or">or</span>${c(RUN_FLAG.bossUnknown)}</span><span class="flag-sep" aria-hidden="true"></span>${c(RUN_FLAG.shift)}</div>
    ${shiftOn ? `<div class="shift-row">${SHIFTS.map(x => chip('shift', x.id, x.name, f.shift === x.id, 'chip mini')).join('')}</div>` : ''}`;
}
// 常夜の王を選んだときは、常夜にいない夜の王を外す（lords.js の everdark: false）
const lordsFor = everdark => LORDS.filter(l => everdark !== true || l.everdark !== false);

// ---------- バックアップの声かけ ----------
// 前回のバックアップから「戦績が20件増えた」または「14日たって1件以上増えた」ら、そっと知らせる
const BACKUP_EVERY_RUNS = 20, BACKUP_EVERY_DAYS = 14;
function backupState() {
  const n = liveRuns().length, last = prefs().lastBackupAt || 0;
  const added = n - (prefs().lastBackupRuns || 0);
  const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
  const auto = prefs().cloud?.on && prefs().cloud.savedAt && !prefs().cloud.failed;  // 自動バックアップが効いていれば、ファイルの保存は急がない
  const due = false && !auto && n > 0 && (added >= BACKUP_EVERY_RUNS || (added > 0 && (days === null ? n >= 5 : days >= BACKUP_EVERY_DAYS)));  // ファイルのバックアップはやめた（自動バックアップに一本化）
  return { n, last, days, added, due };
}
const backupAgo = b => !b.last ? 'まだ一度も保存していません' : b.days === 0 ? '今日' : `${b.days}日前`;
function backupNotice() {
  if (codeNoticeDue()) return codeNotice();
  const b = backupState();
  if (!b.due || (prefs().backupSnoozeUntil || 0) > Date.now()) return '';
  return `<div class="backup-note"><span>${b.last ? `前回のバックアップから戦績が${b.added}件増えています` : `まだバックアップをしていません（戦績${b.n}件）`}</span>
    <button class="ghost small" data-act="exportJson">保存</button><button class="note-x" data-act="backupLater" aria-label="あとで">あとで</button></div>`;
}
function viewHistory() {
  const all = liveRuns().sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
  if (!all.length) return `<div class="empty-state">まだ記録がありません。「記録」タブから1戦目を残しましょう。</div>`;
  // 絞り込み（夜の王・夜渡り・勝敗）
  const h = S.hist;
  const runs = all.filter(r => (!h.lord || r.lordId === h.lord) && (!h.char || r.charId === h.char) && (h.result === 'all' || r.result === h.result));
  const active = h.lord || h.char || h.result !== 'all';
  const opt = (list, cur, allLabel) => `<option value="">${allLabel}</option>${list.map(x => `<option value="${x.id}" ${cur === x.id ? 'selected' : ''}>${x.name}</option>`).join('')}`;
  const usedLords = LORDS.filter(l => all.some(r => r.lordId === l.id)), usedChars = CHARS.filter(c => all.some(r => r.charId === c.id));
  const x = rate(runs);
  const filter = `<div class="hist-filter">
    <div class="chips">${[['all', 'すべて'], ['win', '勝利'], ['loss', '敗北']].map(([v, l]) => `<button class="chip small" data-act="hf" data-v="${v}" ${pressed(h.result === v)}>${l}</button>`).join('')}</div>
    <div class="sel-row">
      <select data-hf="lord" aria-label="夜の王で絞り込む" class="${h.lord ? 'on' : ''}">${opt(usedLords, h.lord, '夜の王：すべて')}</select>
      <select data-hf="char" aria-label="夜渡りで絞り込む" class="${h.char ? 'on' : ''}">${opt(usedChars, h.char, '夜渡り：すべて')}</select>
    </div>
    ${active ? `<div class="hist-sum"><span>${x.n}戦 ${x.w}勝 ${x.n - x.w}敗${x.n ? `・勝率 ${pct(x.p)}` : ''}</span><button class="ghost small" data-act="hfClear">絞り込みを解除</button></div>`
      : `<p class="hint">戦績をタップすると、メモの確認・編集・削除ができます。</p>`}
  </div>`;
  if (!runs.length) return `<div class="stack-lg">${backupNotice()}${filter}<div class="empty-state">この条件の記録はありません</div></div>`;
  const groups = {};
  runs.forEach(r => (groups[r.date] ||= []).push(r));
  return `<div class="stack-lg">${backupNotice()}${filter}` + Object.entries(groups).map(([d, rs]) => {
    const w = rs.filter(r => r.result === 'win').length;
    return `<div class="day"><div class="day-head"><b>${dateLabel(d)}</b><span>${w}勝 ${rs.length - w}敗</span></div>
      ${rs.map(runRow).join('')}</div>`;
  }).join('') + `</div>`;
}
function runRow(r) {
  const p = r.presetId && presetById(r.presetId);
  const open = S.openRun === r.id;
  const pname = p ? presetLabel(p) : r.presetId ? '削除済みのプリセット' : '';
  return `<button class="run ${r.result}" data-act="openRun" data-v="${r.id}" aria-expanded="${open}">
    <span class="stripe"></span>
    <span class="main"><span class="who"><span class="nm-ico">${lordName(r.lordId, r.everdark)}</span><span class="x">×</span><span class="nm-ico">${charName(r.charId)}</span></span>
      <span class="meta">${r.everdark ? '<span class="badge ever">常夜</span>' : ''}${r.mode === 'deep' ? `<span class="badge deep">深き夜${r.depth ? ' 深度' + r.depth : ''}</span>` : ''}${(r.flags || []).map(x => `<span class="badge">${flagName(x, r)}</span>`).join('')}<span>${PARTYM[r.party].name}</span>${pname ? `<span>${esc(pname)}</span>` : ''}</span></span>
    <span class="res">${r.result === 'win' ? '勝利' : '敗北'}${r.lossAt ? `<small>${LOSS[r.lossAt].name}</small>` : ''}</span>
    <span class="more-dots" aria-hidden="true">${open ? '×' : '⋯'}</span>
  </button>
  ${open ? `<div class="run-detail">
    ${r.note ? `<div>${esc(r.note)}</div>` : `<div style="color:var(--dim)">メモなし</div>`}
    <div class="row-actions">
      <button class="ghost" data-act="editRun" data-v="${r.id}">編集</button>
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
    return Object.entries(S.stats.drill).every(([k, id]) => DRILL[k].match(r, id));
  });
}
// 統計の行をタップして絞り込む（深掘り）。種類ごとに「どの戦績が当てはまるか」と「表示名」
const DRILL = {
  lord: { label: '夜の王', match: (r, id) => r.lordId === id, name: id => LORD[id]?.name ?? id },
  char: { label: '夜渡り', match: (r, id) => r.charId === id, name: id => CHAR[id]?.name ?? id },
  preset: { label: 'ビルド', match: (r, id) => id === '__none' ? !r.presetId : id === '__gone' ? !!r.presetId && !presetById(r.presetId) : r.presetId === id,
    name: id => id === '__none' ? 'ビルドなし' : id === '__gone' ? '削除済み（詳細不明）' : presetById(id) ? presetLabel(presetById(id)) : '削除済み' },
  style: { label: '型', match: (r, id) => runBuild(r)?.style === id, name: id => STYLES.find(x => x.id === id)?.name ?? id },
  weapon: { label: 'メイン武器', match: (r, id) => runBuild(r)?.weaponType === id, name: id => id },
  effect: { label: '効果', match: (r, id) => presetHasEffect(r, id), name: id => id.startsWith('sp:') ? `《${SPECIAL[id.slice(3)]?.name ?? '?'}》` : ALL_EFF[id]?.label ?? id },
};
const rate = arr => { const w = arr.filter(r => r.result === 'win').length; return { w, n: arr.length, p: arr.length ? w / arr.length : 0 }; };
const STATS_MIN_RUNS = 5;  // これ未満の試合数は「参考」として下にまとめる
function barRows(items, getRuns, opts = {}) {
  const all = items.map(it => ({ it, ...rate(getRuns(it)) })).filter(x => x.n > 0);
  if (!all.length) return `<p class="hint">この条件の記録はありません</p>`;
  const enough = all.filter(x => x.n >= STATS_MIN_RUNS).sort((a, b) => b.p - a.p || b.n - a.n);
  const few = all.filter(x => x.n < STATS_MIN_RUNS).sort((a, b) => b.n - a.n || b.p - a.p);
  let rows = [...enough, ...few];
  const limit = opts.limit && !(S.statsMore || {})[opts.key] ? opts.limit : Infinity;
  const hidden = Math.max(0, rows.length - limit);
  rows = rows.slice(0, limit);
  const row = x => barRow(x, x.n < STATS_MIN_RUNS, opts.drill);
  const shownEnough = rows.filter(x => x.n >= STATS_MIN_RUNS), shownFew = rows.filter(x => x.n < STATS_MIN_RUNS);
  return `<div class="bars">${shownEnough.map(row).join('')}
    ${shownFew.length ? `<div class="few-label">${STATS_MIN_RUNS}戦未満（参考）</div>${shownFew.map(row).join('')}` : ''}</div>
    ${hidden ? `<button class="more-btn" data-act="statsMore" data-v="${opts.key}">すべて表示（残り${hidden}件）</button>` : ''}`;
}
// 名前を1行目に全部出し、棒グラフは2行目に置く（長い名前が切れないように）。drill を渡すとタップで絞り込める
// ---------- 自動バックアップ（引き継ぎコード＋暗号化） ----------
// 記録・プリセットを、変えるたびに自動で受け取り口（スプレッドシート）へ保存する。最初から全員オン。
// 中身はこの端末で暗号化してから送る。鍵は「引き継ぎコード」で、コード自体は送らない（受け取り口の持ち主にも読めない）。
// 受け取り口で使う番号は、コードから作った別の文字（SHA-256）。機種変更のときは、コードを入れると取り出して戻せる。
const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';  // 見間違えやすい 0/O・1/I は使わない
const newCode = () => [...crypto.getRandomValues(new Uint8Array(16))].map(x => CODE_CHARS[x % 32]).join('').match(/.{4}/g).join('-');
const normCode = str => String(str || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const validCode = str => normCode(str).length === 16 && [...normCode(str)].every(ch => CODE_CHARS.includes(ch));
const fmtCode = str => normCode(str).match(/.{1,4}/g)?.join('-') || '';
const cloud = () => (prefs().cloud ||= { on: true, code: newCode(), confirmed: false, savedAt: 0, sig: '', failed: false });
const te = new TextEncoder();
let keyCache = null;
async function cloudKeys(code) {
  const c = normCode(code);
  if (keyCache?.c === c) return keyCache;
  const idBuf = await crypto.subtle.digest('SHA-256', te.encode('yoru-no-konseki/backup-id/' + c));
  const id = [...new Uint8Array(idBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const base = await crypto.subtle.importKey('raw', te.encode(c), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: te.encode('yoru-no-konseki/backup-key'), iterations: 150000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return (keyCache = { c, id, key });
}
const toB64 = bytes => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const fromB64 = str => Uint8Array.from(atob(str), ch => ch.charCodeAt(0));
// 圧縮（対応している端末だけ。暗号化の前に小さくして、通信とシートの容量を減らす）
async function gzip(bytes, pack) {
  const Stream = pack ? window.CompressionStream : window.DecompressionStream;
  if (!Stream) return null;
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream('gzip'))).arrayBuffer());
}
async function seal(obj, key) {
  let bytes = te.encode(JSON.stringify(obj)), z = false;
  const packed = await gzip(bytes, true).catch(() => null);
  if (packed) { bytes = packed; z = true; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return JSON.stringify({ v: 1, z, iv: toB64(iv), ct: toB64(ct) });
}
async function unseal(text, key) {
  const o = JSON.parse(text);
  let bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(o.iv) }, key, fromB64(o.ct)));
  if (o.z) bytes = await gzip(bytes, false);
  if (!bytes) throw new Error('この端末では読み込めない形式です');
  return JSON.parse(new TextDecoder().decode(bytes));
}
// 保存するもの：戦績・遺物・プリセット・設定（自動バックアップとみんなの戦績の設定は端末ごとなので除く）
const cloudPayload = () => { const { cloud: _c, online: _o, ...rest } = db.prefs; return { runs: db.runs, relics: db.relics, presets: db.presets, prefs: rest }; };
// 送るかどうかは、ミニゲームの進み具合を除いた中身が変わったかで決める（ミニゲームは数秒ごとに変わるので、それだけでは送らない。ほかが変わったときに一緒に送る）
const cloudSig = payload => { const { kotsubo: _k, ...p } = payload.prefs; return sigOf(JSON.stringify({ ...payload, prefs: p })); };
const sigOf = str => { let h = 5381; for (let i = 0; i < str.length; i++) h = (h * 33 + str.charCodeAt(i)) | 0; return `${str.length}:${h}`; };
let cloudTimer = null, cloudDue = 0, cloudBusy = false;
// 予定より遅らせない（変更が続いても、最初の変更から15秒以内には保存する）
const scheduleCloud = (ms = 15000) => { const at = Date.now() + ms; if (cloudTimer && cloudDue <= at) return;
  clearTimeout(cloudTimer); cloudDue = at; cloudTimer = setTimeout(() => { cloudTimer = null; cloudSave(); }, ms); };
async function cloudSave() {
  const cl = cloud();
  if (!cl.on || cloudBusy || !navigator.onLine || !crypto.subtle) return;
  if (!db.runs.length && !db.presets.length) return;  // まだ何もないときは保存しない
  const payload = cloudPayload(), sig = cloudSig(payload);
  if (sig === cl.sig) return;
  cloudBusy = true;
  try {
    const { id, key } = await cloudKeys(cl.code);
    const res = await postOnline({ type: 'backup_put', id, data: await seal(payload, key) });
    if (!res?.ok) throw new Error(res?.error || 'failed');
    Object.assign(cl, { sig, savedAt: Date.now(), failed: false });
  } catch (e) { cl.failed = true; } finally { cloudBusy = false; save(db); if (S.sheet?.type === 'menu') renderSheet(); }
}
// アプリを閉じる・ほかのアプリに切り替えるときは、待たずに保存する
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') cloudSave(); });
// 引き継ぎコードで取り出す
async function cloudFetch(code) {
  const { id, key } = await cloudKeys(code);
  const res = await postOnline({ type: 'backup_get', id });
  if (!res?.ok) throw new Error('通信できませんでした');
  if (!res.found) return null;
  return { updatedAt: res.updatedAt, data: await unseal(res.data, key) };
}
const agoText = t => { if (!t) return 'まだ保存していません'; const m = Math.floor((Date.now() - t) / 60000);
  return m < 1 ? 'たった今' : m < 60 ? `${m}分前` : m < 1440 ? `${Math.floor(m / 60)}時間前` : `${Math.floor(m / 1440)}日前`; };
function restoreSheet() {
  const sh = S.sheet, f = sh.found;
  const body = f
    ? `<div class="card import-preview"><span class="title"><span>見つかりました</span></span>
        <span class="sub">戦績 ${f.data.runs.filter(r => !r.deleted).length}件・プリセット ${f.data.presets.filter(p => !p.deleted).length}件（${esc(new Date(f.updatedAt).toLocaleString('ja-JP'))} に保存）</span></div>
       <p class="hint">戻すと、この端末の今のデータは、このバックアップの内容に置き換わります。これからは、このコードで自動バックアップを続けます。</p>
       <div class="form-actions"><button class="ghost" data-act="sClose">やめる</button><button class="primary" data-act="restoreDo">戻す</button></div>`
    : `<input type="text" id="restore-code" value="${esc(sh.code || '')}" placeholder="例：K7QM-82XP-4HZD-W9TA" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24">
       ${sh.err ? `<p class="hint import-err">${esc(sh.err)}</p>` : ''}
       <p class="hint">前の端末の「データ管理」に出ていた引き継ぎコードを入れてください。小文字やハイフンなしでも大丈夫です。</p>
       <div class="form-actions"><button class="ghost" data-act="sClose">やめる</button><button class="primary" data-act="restoreFind" ${sh.busy ? 'disabled' : ''}>${sh.busy ? '探しています…' : '探す'}</button></div>`;
  return `<div class="scrim" data-act="sClose"></div><div class="sheet" role="dialog" aria-label="引き継ぎコードで戻す">
    <div class="sheet-head"><h2>引き継ぎコードで戻す</h2><button class="ghost" data-act="sClose">閉じる</button></div>
    <div class="sheet-list import-list">${body}</div></div>`;
}
// 引き継ぎコードを控えてもらう案内（戦績が3件以上あって、まだ「控えた」を押していないとき。「あとで」で7日休む）
const codeNoticeDue = () => { const cl = cloud(); return cl.on && !cl.confirmed && liveRuns().length >= 3 && (cl.snoozeUntil || 0) < Date.now(); };
function codeNotice() {
  if (!codeNoticeDue()) return '';
  return `<div class="backup-note"><span>機種変更やアプリを消したときに備えて、引き継ぎコードを控えてください</span>
    <button class="ghost small" data-act="menu">見る</button><button class="note-x" data-act="codeLater" aria-label="あとで">あとで</button></div>`;
}
// ---------- オンライン（みんなの勝率・誤植の報告） ----------
// 受け取り口は持ち主の Google スプレッドシート（tools/online/apps_script.gs をウェブアプリとして公開したもの）
const ONLINE_URL = 'https://script.google.com/macros/s/AKfycbwj1IcWjrrl-Jc12G3IPYp8TTYUJTMeYiZurQqs0eBfib_ltNz1nKZTZB3-FoUJ59ICog/exec';
// join＝みんなの勝率に参加しているか、id＝端末ごとのランダムな番号（名前などは送らない）、sent＝送った戦績とその時点の版
const onlinePrefs = () => (prefs().online ||= { join: false, id: uid(), sent: {} });
const runSig = r => `2|${r.editedAt || r.updatedAt}|${r.deleted ? 1 : 0}`;  // 先頭の 2 は送る中身の版（型・メイン武器を足した）
// 受け取り口（本物のスプレッドシート）への通信。開発用の手元の画面（localhost）では、うっかり本物に書き込まないよう、
// window.__devNet = true にしたときだけ通す（動作確認では、通信を仮のものに差し替えてから true にする）
const net = (url, opt) => DEV_HOST && !window.__devNet ? Promise.reject(new TypeError('開発用の画面では、受け取り口に通信しません')) : fetch(url, opt);
async function postOnline(body) {
  const res = await net(ONLINE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, clientId: onlinePrefs().id }) });
  return res.json();
}
// 送るのは勝率に使う項目だけ（メモ・ビルドは送らない）。サンプルデータは送らない
// 型・メイン武器は「よく使われている武器」を数えるためだけに送る
const runForOnline = r => { const b = runBuild(r);
  return { id: r.id, date: r.date, lordId: r.lordId, everdark: !!r.everdark, mode: r.mode, depth: r.depth, party: r.party, charId: r.charId,
    result: r.result, lossAt: r.lossAt, deleted: !!r.deleted, updatedAt: r.editedAt || r.updatedAt, style: b?.style || '', weaponType: b?.weaponType || '' }; };
let syncing = false, syncTimer = null;
const scheduleSync = () => { clearTimeout(syncTimer); syncTimer = setTimeout(syncRuns, 1500); };
async function syncRuns() {
  const o = onlinePrefs();
  if ((!o.join && !o.pendingDelete?.length) || syncing || !navigator.onLine) return;
  // サンプルの戦績は送らない。前に送ってしまったサンプルは「消した」扱いで送り直して、集計から外す
  const SAMPLE_GONE = 'sample-removed';
  const todo = !o.join ? [] : db.runs.filter(r => r.sample ? o.sent[r.id] && o.sent[r.id] !== SAMPLE_GONE
    : o.sent[r.id] !== runSig(r) && !(r.deleted && !o.sent[r.id]));
  if (!todo.length && !o.pendingDelete?.length) return;
  syncing = true;
  try {
    // データを全部消したり復元したりして、なくなった戦績を集計から外す
    if (o.pendingDelete?.length) {
      const ids = o.pendingDelete.slice(0, 500), now = Date.now();
      const res = await postOnline({ type: 'runs', runs: ids.map(id => ({ id, deleted: true, updatedAt: now })) });
      if (res?.ok) { o.pendingDelete = o.pendingDelete.slice(ids.length); save(db); }
    }
    for (let i = 0; i < todo.length; i += 200) {
      const part = todo.slice(i, i + 200);
      const res = await postOnline({ type: 'runs', runs: part.map(r => r.sample ? { id: r.id, deleted: true, updatedAt: Date.now() } : runForOnline(r)) });
      if (!res?.ok) break;
      part.forEach(r => { o.sent[r.id] = r.sample ? SAMPLE_GONE : runSig(r); });
      save(db);
    }
    resetGlobal();  // 次に統計を開いたときは取り直す
  } catch (e) { /* 通信できなければ、次に開いたときにまた送る */ } finally { syncing = false; }
}
// みんなの統計（受け取り口で3分ごとに数え直したもの）。期間（全期間・30日・7日・今日・指定）ごとに別々に持つ
const CACHE_KEY = 'yowatari-nikki-online-cache';
const readCache = k => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')[k] || null; } catch { return null; } };
const writeCache = (k, v) => { try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); c[k] = v; localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* 保存できなくても動く */ } };
const GLOBALS = {};
const G_PERIODS = [['all', '全期間'], ['30', '30日'], ['7', '7日'], ['1', '今日'], ['custom', '指定']];
// 今選んでいる期間（from・to は yyyy-MM-dd。全期間は空）
function gRange() {
  const p = S.stats.gPeriod || 'all';
  if (p === 'all') return { from: '', to: '' };
  if (p === 'custom') return { from: S.stats.gFrom || '', to: S.stats.gTo || today() };
  return { from: daysAgo(+p - 1), to: today() };
}
const gKeyOf = r => r.from || r.to ? `${r.from}:${r.to}` : 'all';
const gState = k => (GLOBALS[k] ||= { data: k === 'all' ? readCache('stats') : null, at: 0, loading: false, failed: false, unsupported: false });  // 全期間は前回の結果をすぐ出す
const resetGlobal = () => Object.values(GLOBALS).forEach(x => { x.at = 0; });  // 次に開いたときは取り直す
const gRangeOk = r => S.stats.gPeriod !== 'custom' || (!!r.from && !!r.to && r.from <= r.to && r.to <= today());
function loadGlobal() {
  const r = gRange(), k = gKeyOf(r), G = gState(k);
  if (G.loading || !gRangeOk(r) || Date.now() - G.at < 3 * 60e3) return G;
  G.loading = true;
  // 失敗したときは1分あけてからやり直す（すぐにやり直すと、通信できないときに読み込みが止まらず画面が固まるため）
  net(`${ONLINE_URL}?type=stats${k === 'all' ? '' : `&from=${r.from}&to=${r.to}`}`).then(res => res.json()).then(d => { if (!d.ok) throw new Error('bad');
      // 期間の絞り込みに対応していない受け取り口（古い版）は、期間を無視して全期間を返すので、使わない
      G.unsupported = k !== 'all' && !(d.range && d.range.from === r.from && d.range.to === r.to);
      G.data = G.unsupported ? null : d; G.failed = false; G.at = Date.now(); if (k === 'all') writeCache('stats', d); },
    () => { G.failed = true; G.at = Date.now() - 2 * 60e3; })
    .finally(() => { G.loading = false; if (S.tab === 'stats') render(); });
  return G;
}
// 期間の表示名（例：11/17〜11/23）
const gPeriodLabel = () => { const r = gRange(), md = d => d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : ''; return r.from === r.to ? md(r.from) : `${md(r.from)}〜${md(r.to)}`; };
// 期間のボタン（指定のときは、開始日と終了日をカレンダーで選ぶ）
function gPeriodBar() {
  const p = S.stats.gPeriod || 'all', r = gRange();
  return `<div class="g-period"><div class="chips">${G_PERIODS.map(([v, l]) => `<button class="chip small" data-act="gPeriod" data-v="${v}" ${pressed(p === v)}>${l}</button>`).join('')}</div>
    ${p === 'custom' ? `<div class="g-dates"><input type="date" data-gdate="gFrom" value="${r.from}" max="${today()}" aria-label="集計の開始日"><span>〜</span><input type="date" data-gdate="gTo" value="${r.to}" max="${today()}" aria-label="集計の終了日"></div>
      ${gRangeOk(r) ? '' : `<p class="hint">${!r.from ? '開始日を選んでください。' : '開始日は終了日より前にしてください。'}</p>`}` : ''}</div>`;
}
// 統計の項目は、上のボタンで表示・非表示を切り替えられる（端末に覚えておく）
const STATS_MINE = ['勝率の推移', '夜の王別', '夜渡り別', '相性表', 'どこで倒れたか', 'ビルド別', '型・メイン武器別', '効果別'];
const statHidden = () => (prefs().statsHidden ||= {});
const cardIf = (title, ...rest) => statHidden()[title] ? '' : card(title, ...rest);
const secToggles = list => `<div class="stats-toc" aria-label="表示する項目">${list.map(t => `<button class="chip mini" data-act="statToggle" data-v="${t}" ${pressed(!statHidden()[t])}>${t}</button>`).join('')}</div>`;
// みんなの統計：参加・概要のカードと、項目ごとのカード
function globalStats() {
  const o = onlinePrefs(), G = loadGlobal(), g = G.data, period = S.stats.gPeriod && S.stats.gPeriod !== 'all';
  const fewNote = g && g.total.n && (g.total.n < 300 || g.players < 20)
    ? `<p class="hint caution">⚠ まだ集まった戦績が少ない（${g.players}人・${g.total.n}戦）ので、割合や勝率は参考程度に見てください。5戦未満の行は薄く表示しています。匿名で集計しているため、正確さは保証できません。</p>` : '';
  const join = o.join
    ? `<div class="online-join on"><span>参加中：あなたの戦績も集計に入っています</span><button class="ghost small-btn ${S.confirmDel === 'onlineLeave' ? 'danger' : ''}" data-act="onlineLeave">${S.confirmDel === 'onlineLeave' ? 'もう一度押すとやめる' : 'やめる'}</button></div>`
    : `<div class="online-join"><p class="hint">参加すると、あなたの戦績（夜の王・夜渡り・勝敗など）を名前なしで送り、みんなの統計に加えます。メモや遺物は送りません。これまでの戦績も送ります。</p>
       <button class="primary" data-act="onlineJoin">参加する</button></div>`;
  if (!g || !g.total.n) return gPeriodBar() + card('みんなの統計', `<p class="hint">${!gRangeOk(gRange()) ? '期間を選ぶと表示されます。'
      : G.unsupported ? '期間の絞り込みは、スプレッドシート側の更新後に使えます。今は「全期間」だけ見られます。'
      : G.loading || !G.at ? '読み込んでいます…' : G.failed ? '読み込めませんでした。通信できる所で「もう一度読み込む」を押してください。'
      : period ? 'この期間の戦績はありません。' : 'まだ集まった戦績がありません。'}</p>${G.failed && !G.loading ? '<button class="ghost small" data-act="globalRetry">もう一度読み込む</button>' : ''}${join}`);
  const total = g.total.n, td = (g.byDate || {})[today()] || { n: 0, w: 0 };
  // ダッシュボード：今日の出撃・これまでの出撃・勝率・参加者
  // 期間を絞っているときは「その期間の出撃」と「参加者」にする（今日の数は全期間のときだけ）
  const dash = `${gPeriodBar()}<div class="tiles dash">
      ${period ? `<div class="tile"><div class="k">期間の出撃</div><div class="v">${total}</div><div class="s">${esc(gPeriodLabel())}</div></div>
      <div class="tile"><div class="k">参加者</div><div class="v">${g.players}</div><div class="s">人</div></div>`
      : `<div class="tile"><div class="k">今日の出撃</div><div class="v">${td.n}</div><div class="s">${td.n ? `勝率 ${pct(td.w / td.n)}` : 'まだなし'}</div></div>
      <div class="tile"><div class="k">これまでの出撃</div><div class="v">${total}</div><div class="s">${g.players}人の合計</div></div>`}
      <div class="tile"><div class="k">勝率</div><div class="v">${pct(g.total.w / total)}</div><div class="s">${g.total.w}勝 ${total - g.total.w}敗</div></div>
    </div>`;
  // ---------- ここから下：分析（タブで切り替え） ----------
  const zero = { n: 0, w: 0 };
  const T = S.stats.gTab || 'char', sortBy = S.stats.gSort || 'lb', minN = +(S.stats.gMin || 0), ever = !!S.stats.gEver;
  const fresh = !!g.weaponW;  // 分析用の集計がある新しい受け取り口か
  const wait = '<p class="hint">この分析は、スプレッドシート側の更新後に表示されます。</p>';
  const lordKey = id => id + (ever ? ':ever' : '');
  const lordList = lordsFor(ever ? true : false);
  const DK = [['normal', '通常'], ['deep1', '深度1'], ['deep2', '深度2'], ['deep3', '深度3'], ['deep4', '深度4'], ['deep5', '深度5']];
  const PT = [['solo', 'ソロ'], ['duo', 'デュオ'], ['trio', 'トリオ']];
  const LS = [['d1', '1日目', '#f0b46a'], ['d2', '2日目', '#e3835e'], ['final', '最終戦', '#cf5a55']];
  // 1行：名前と数字、その下に勝率の棒（濃い部分＝ありそうな範囲、丸＝勝率、真ん中の線＝50%）
  const rateLine = (icon, name, x, extra = '', act = '', open = false) => {
    const p = x.n ? x.w / x.n : 0, [lo, hi] = wilson(x.w, x.n), few = x.n < STATS_MIN_RUNS;
    const inner = `<span class="name">${icon}${esc(name)}</span><span class="num">${x.n ? `<b>${pct(p)}</b><small>${x.w}/${x.n}</small>` : '<span class="none">まだなし</span>'}${extra}</span>
      <span class="ci-track">${x.n ? `<span class="ci-band ${p >= .5 ? 'win' : 'loss'}" style="left:${lo * 100}%;width:${Math.max(1, (hi - lo) * 100)}%"></span><span class="ci-dot" style="left:${p * 100}%"></span>` : ''}</span>`;
    return act ? `<button class="bar-row ci-row tap ${few ? 'dim' : ''} ${open ? 'open' : ''}" data-act="gOpen" data-v="${act}" aria-expanded="${open}">${inner}<span class="go" aria-hidden="true">${open ? '−' : '+'}</span></button>`
      : `<div class="bar-row ci-row ${few ? 'dim' : ''}">${inner}</div>`;
  };
  // 並べ替え：信頼度（ありそうな範囲の下の端）・勝率・試合数
  const sorter = (a, b) => sortBy === 'n' ? b.x.n - a.x.n : sortBy === 'rate' ? (b.x.n ? b.x.w / b.x.n : -1) - (a.x.n ? a.x.w / a.x.n : -1) || b.x.n - a.x.n
    : wilson(b.x.w, b.x.n)[0] - wilson(a.x.w, a.x.n)[0] || b.x.n - a.x.n;
  const share = (n, sum) => sum ? `<em>${pct(n / sum)}</em>` : '';
  const listOf = (items, sum, drillKey) => { const shown = items.filter(it => it.x.n >= minN).sort(sorter);
    return shown.length ? shown.map(it => { const key = drillKey ? `${drillKey}:${it.id}` : '', open = !!key && S.stats.gOpen === key;
      return rateLine(it.icon || '', it.name, it.x, share(it.x.n, sum), key, open) + (open ? `<div class="g-drill">${it.drill()}</div>` : ''); }).join('')
      : `<p class="hint">${minN ? `${minN}戦以上のものはありません。` : 'まだデータがありません。'}</p>`; };
  const mini = (title, items, sum) => { const rows = items.filter(it => it.x.n).sort((a, b) => b.x.n - a.x.n);
    return `<div class="g-mini"><div class="g-mini-h">${title}</div>${rows.length ? rows.map(it => rateLine(it.icon || '', it.name, it.x, share(it.x.n, sum))).join('') : '<p class="hint">まだデータがありません。</p>'}</div>`; };
  const lossBar = obj => { obj = obj || {}; const sum = LS.reduce((a, [k]) => a + (obj[k] || 0), 0);
    return sum ? `<div class="stack">${LS.filter(([k]) => obj[k]).map(([k, , c]) => `<div style="flex:${obj[k]};background:${c}">${obj[k] / sum >= .14 ? pct(obj[k] / sum) : ''}</div>`).join('')}</div>
      <div class="legend">${LS.map(([k, l, c]) => `<span><i style="background:${c}"></i>${l} ${obj[k] || 0}</span>`).join('')}</div>` : '<p class="hint">敗北の記録はまだありません。</p>'; };
  const lc = g.lordChar || {};
  // 夜渡りを開いたとき：夜の王別・深度別・人数別・武器別
  const charDrill = id => () => {
    const vsLord = LORDS.flatMap(l => [['', ''], [':ever', '（常夜）']].map(([s, lab]) => ({ icon: ico('lord', l.id, s === ':ever'), name: LORD[l.id].name + lab, x: lc[`${l.id}${s}/${id}`] || zero })));
    const cx = (g.char || {})[id] || zero;
    return mini('夜の王別', vsLord, cx.n) + (fresh ? mini('深度別', DK.map(([k, l]) => ({ name: l, x: ((g.charDepthW || {})[id] || {})[k] || zero })), cx.n)
      + mini('人数別', PT.map(([k, l]) => ({ name: l, x: ((g.charParty || {})[id] || {})[k] || zero })), cx.n)
      + mini('メイン武器別', Object.entries((g.charWeaponW || {})[id] || {}).map(([k, x]) => ({ name: k, x })), cx.n) : wait);
  };
  // 夜の王を開いたとき：夜渡り別・深度別・人数別・どこで倒れたか
  const lordDrill = id => () => { const k = lordKey(id), lx = (g.lord || {})[k] || zero;
    return mini('夜渡り別', CHARS.map(c => ({ icon: ico('char', c.id), name: c.name, x: lc[`${k}/${c.id}`] || zero })), lx.n)
      + (fresh ? mini('深度別', DK.map(([d, l]) => ({ name: l, x: ((g.lordDepth || {})[k] || {})[d] || zero })), lx.n)
      + mini('人数別', PT.map(([p, l]) => ({ name: l, x: ((g.lordParty || {})[k] || {})[p] || zero })), lx.n)
      + `<div class="g-mini"><div class="g-mini-h">どこで倒れたか</div>${lossBar((g.lordLoss || {})[k])}</div>` : wait); };
  let body = '', tools = '';
  const sortTools = `<div class="g-tools"><span class="grp"><span class="k">並び</span>${[['lb', '信頼度'], ['rate', '勝率'], ['n', '試合数']].map(([v, l]) => `<button class="chip mini" data-act="gSort" data-v="${v}" ${pressed(sortBy === v)}>${l}</button>`).join('')}</span>
    <span class="grp"><span class="k">対象</span>${[['0', 'すべて'], ['5', '5戦〜'], ['20', '20戦〜']].map(([v, l]) => `<button class="chip mini" data-act="gMin" data-v="${v}" ${pressed(String(minN) === v)}>${l}</button>`).join('')}</span></div>`;
  const everTool = `<button class="ever-switch ${ever ? 'on' : ''}" data-act="gEver" aria-pressed="${ever}">常夜</button>`;
  if (T === 'char') { tools = sortTools;
    body = `<p class="hint">右の％は使用率。行をタップすると、夜の王別・深度別・人数別・武器別の勝率が見られます。</p>`
      + listOf(CHARS.map(c => ({ id: c.id, icon: ico('char', c.id), name: c.name, x: (g.char || {})[c.id] || zero, drill: charDrill(c.id) })), total, 'c'); }
  if (T === 'lord') { tools = sortTools + `<div class="g-tools">${everTool}<span class="hint">右の％は出現率。勝率＝討伐率</span></div>`;
    const sum = lordList.reduce((a, l) => a + (((g.lord || {})[lordKey(l.id)] || zero).n), 0);
    body = listOf(lordList.map(l => ({ id: l.id, icon: ico('lord', l.id, ever), name: LORD[l.id].name, x: (g.lord || {})[lordKey(l.id)] || zero, drill: lordDrill(l.id) })), sum, 'l'); }
  if (T === 'match') { tools = `<div class="g-tools">${everTool}<span class="hint">夜の王（縦）×夜渡り（横）の勝率（%）。薄いマスは5戦未満</span></div>`;
    const sel = S.stats.gCell;
    const cell = (l, c) => { const x = lc[`${lordKey(l.id)}/${c.id}`] || zero, p = x.n ? x.w / x.n : null;
      const col = p == null ? 'transparent' : `color-mix(in srgb, ${p >= .5 ? 'var(--win)' : 'var(--loss)'} ${x.n < STATS_MIN_RUNS ? 16 : Math.round(22 + Math.abs(p - .5) * 2 * 60)}%, var(--panel))`;
      return `<button class="mx-cell ${x.n && x.n < STATS_MIN_RUNS ? 'few' : ''} ${sel === `${l.id}/${c.id}` ? 'on' : ''}" style="background:${col}" data-act="gCell" data-v="${l.id}/${c.id}" aria-label="${LORD[l.id].name}×${c.name}">${p == null ? '' : Math.round(p * 100)}</button>`; };
    const [sl, sc] = (sel || '/').split('/'), sx = sel && LORD[sl] ? lc[`${lordKey(sl)}/${sc}`] || zero : null;
    body = `<div class="mx"><span class="mx-corner"></span>${CHARS.map(c => `<span class="mx-h">${ico('char', c.id)}</span>`).join('')}
      ${lordList.map(l => `<span class="mx-r">${ico('lord', l.id, ever)}</span>${CHARS.map(c => cell(l, c)).join('')}`).join('')}</div>
      <p class="hint mx-note">${sx ? `${LORD[sl].name}${ever ? '（常夜）' : ''} × ${CHAR[sc].name}：${sx.n ? `<b>${pct(sx.w / sx.n)}</b>（${sx.w}勝 ${sx.n - sx.w}敗）` : 'まだなし'}` : 'マスをタップすると、組み合わせの名前と勝敗数が出ます。'}</p>`; }
  if (T === 'gear') { tools = sortTools;
    const ws = Object.entries(g.weaponW || {}).filter(([k]) => WEAPON_TYPES.includes(k)), wsum = ws.reduce((a, [, x]) => a + x.n, 0);
    const ss = Object.entries(g.styleW || {}), ssum = ss.reduce((a, [, x]) => a + x.n, 0);
    body = !fresh ? wait : `<div class="g-mini-h">メイン武器</div><p class="hint">ビルドを登録して記録された戦績が対象。右の％は使用率</p>${listOf(ws.map(([k, x]) => ({ id: k, name: k, x })), wsum)}
      <div class="g-mini-h">型</div>${listOf(ss.map(([k, x]) => ({ id: k, name: STYLES.find(st => st.id === k)?.name || k, x })), ssum)}`; }
  if (T === 'mode') body = !fresh ? wait : mini('深度別', DK.map(([k, l]) => ({ name: l, x: (g.depthW || {})[k] || zero })), total) + mini('人数別', PT.map(([k, l]) => ({ name: l, x: (g.partyW || {})[k] || zero })), total);
  if (T === 'trend') body = !fresh ? wait : trendChart(g.trend || {}, gRange());
  if (T === 'loss') { tools = `<div class="g-tools">${everTool}<span class="hint">負けた試合が、どこで倒れたか</span></div>`;
    body = !fresh ? wait : `<div class="g-mini"><div class="g-mini-h">全体</div>${lossBar(g.loss)}</div>
      ${lordList.map(l => { const o = (g.lordLoss || {})[lordKey(l.id)] || {}, n = LS.reduce((a, [k]) => a + (o[k] || 0), 0);
        return n ? `<div class="g-mini"><div class="g-mini-h">${ico('lord', l.id, ever)}${LORD[l.id].name}<small>${n}敗</small></div>${lossBar(o)}</div>` : ''; }).join('')}`; }
  const TABS_G = [['char', '夜渡り'], ['lord', '夜の王'], ['match', '相性'], ['gear', '武器・型'], ['mode', '深度・人数'], ['trend', '推移'], ['loss', '敗北']];
  return `${dash}
    ${fewNote}
    <div class="join-wrap">${join}</div>
    <section class="card-sec g-ana">
      <div class="g-tabs" role="tablist">${TABS_G.map(([v, l]) => `<button role="tab" data-act="gTab" data-v="${v}" aria-selected="${T === v}">${l}</button>`).join('')}</div>
      ${tools}
      <div class="bars g-body">${body}</div>
      ${['char', 'lord', 'gear'].includes(T) ? '<p class="hint g-legend">棒の濃い部分は「本当の勝率はたぶんこの範囲」（95%）。試合が少ないほど広くなります。「信頼度」順は、この範囲の下の端で並べるので、試合が少ないのにたまたま勝率が高いものは上に来ません。</p>' : ''}
    </section>`;
}
// 勝率の「ありそうな範囲」（ウィルソンの95%信頼区間）。試合が少ないほど広い
function wilson(w, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = w / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}
// 推移：日ごとの出撃数（棒）と勝率（線・その日までの7日間の平均）
function trendChart(tr, r) {
  const end = r.to || today(), start = r.from || daysAgo(59);
  const days = []; for (let d = new Date(start + 'T00:00:00'); ymd(d) <= end && days.length < 400; d.setDate(d.getDate() + 1)) days.push(ymd(d));
  if (!days.length || !days.some(d => tr[d])) return '<p class="hint">この期間の戦績はまだありません。</p>';
  const W = 320, H = 150, pl = 26, pr = 30, pt = 10, pb = 22, iw = W - pl - pr, ih = H - pt - pb;
  const maxN = Math.max(1, ...days.map(d => (tr[d] || {}).n || 0)), bw = iw / days.length;
  const roll = days.map((d, i) => { const win7 = days.slice(Math.max(0, i - 6), i + 1).map(x => tr[x] || { n: 0, w: 0 }); const n = win7.reduce((a, x) => a + x.n, 0); return n >= 5 ? win7.reduce((a, x) => a + x.w, 0) / n : null; });  // 7日間で5戦未満のところは線を引かない（ぶれが大きいため）
  const x = i => pl + i * bw + bw / 2, y = p => pt + (1 - p) * ih;
  const pts = roll.map((p, i) => p == null ? null : `${x(i).toFixed(1)},${y(p).toFixed(1)}`).filter(Boolean).join(' ');
  const md = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
  const tot = days.reduce((a, d) => a + ((tr[d] || {}).n || 0), 0), wins = days.reduce((a, d) => a + ((tr[d] || {}).w || 0), 0);
  const best = days.reduce((b, d) => ((tr[d] || {}).n || 0) > ((tr[b] || {}).n || 0) ? d : b, days[0]);
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="日ごとの出撃数と勝率の推移">
    <line x1="${pl}" x2="${W - pr}" y1="${y(.5)}" y2="${y(.5)}" stroke="#4a5080" stroke-dasharray="3 3"/>
    ${days.map((d, i) => { const n = (tr[d] || {}).n || 0; return n ? `<rect x="${(pl + i * bw + bw * .15).toFixed(1)}" y="${(pt + ih - n / maxN * ih).toFixed(1)}" width="${Math.max(1, bw * .7).toFixed(1)}" height="${(n / maxN * ih).toFixed(1)}" fill="var(--accent)" opacity=".35"/>` : ''; }).join('')}
    ${pts ? `<polyline points="${pts}" fill="none" stroke="var(--win)" stroke-width="2" stroke-linejoin="round"/>` : ''}
    <text x="${pl - 4}" y="${pt + 8}" fill="var(--dim)" font-size="9" text-anchor="end">${maxN}</text><text x="${pl - 4}" y="${pt + ih}" fill="var(--dim)" font-size="9" text-anchor="end">0</text>
    <text x="${W - pr + 4}" y="${y(1) + 8}" fill="var(--win)" font-size="9">100%</text><text x="${W - pr + 4}" y="${y(.5) + 3}" fill="var(--dim)" font-size="9">50%</text>
    <text x="${pl}" y="${H - 6}" fill="var(--dim)" font-size="9">${md(days[0])}</text><text x="${W - pr}" y="${H - 6}" fill="var(--dim)" font-size="9" text-anchor="end">${md(days[days.length - 1])}</text>
  </svg>
  <div class="legend"><span><i style="background:var(--accent);opacity:.5"></i>出撃数（左の目盛り）</span><span><i style="background:var(--win)"></i>勝率（7日間の平均・右。5戦未満の所は線なし）</span></div>
  <p class="hint">${days.length}日間で${tot}戦・勝率 ${tot ? pct(wins / tot) : '–'}。いちばん多かった日：${md(best)}（${(tr[best] || {}).n || 0}戦）</p>`;
}
// アップデート情報：新しい版がまだ見ていないものなら「NEW」（はじめて使う人には出さない）
const newsUnseen = () => !!CHANGELOG[0] && (prefs().onboarded || liveRuns().length > 0) && prefs().seenNews !== CHANGELOG[0].v;  // 案内を閉じた人か、戦績がある人
function newsSheet() {
  // 公開した日時（例：11/24 0:17）。時刻がないものは日付だけ
  const md = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}${d.length > 10 ? ` ${+d.slice(11, 13)}:${d.slice(14, 16)}` : ''}`;
  return `<div class="scrim" data-act="sClose"></div><div class="sheet help" role="dialog" aria-label="アップデート情報">
    <div class="sheet-head"><h2>アップデート情報</h2><button class="ghost" data-act="sClose">閉じる</button></div>
    <div class="sheet-list help-list news">${CHANGELOG.map((c, i) => `<section><h3>${esc(c.v)}<small>${md(c.date)}</small>${i === 0 ? '<span class="badge new">最新</span>' : ''}</h3><ul class="help-points">${c.items.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>`).join('')}</div></div>`;
}
// ビルドガチャ：次の試合で使うビルドを、今の一覧（夜渡りで絞り込んでいればその中）からランダムに1つ選ぶ
function gachaSheet() {
  const p = presetById(S.sheet.id); if (!p) return '';
  const n = shownPresets().length;
  return `<div class="scrim" data-act="sClose"></div><div class="sheet" role="dialog" aria-label="ビルドガチャ">
    <div class="sheet-head"><h2>🎲 ビルドガチャ</h2><button class="ghost" data-act="sClose">閉じる</button></div>
    <div class="sheet-list import-list">
      <div class="gacha-result" style="animation-delay:0s" data-spin="${S.sheet.spin}">
        <div class="gacha-char">${p.charId ? ico('char', p.charId) : ''}<span>${p.charId ? CHAR[p.charId].name : '夜渡り未設定'}</span></div>
        <div class="gacha-name">${esc(presetName(p))}${p.imported ? '<span class="badge">取り込んだビルド</span>' : ''}</div>
        ${styleText(p) ? `<div class="hint">${esc(styleText(p))}</div>` : ''}
        ${relicDetail(p)}
      </div>
      <p class="hint">${n}個のビルドから選びました。</p>
      <div class="form-actions"><button class="ghost" data-act="gacha">もう一回</button><button class="primary" data-act="gachaUse" ${p.charId ? '' : 'disabled'}>これで記録する</button></div>
    </div></div>`;
}
function privacySheet() {
  return `<div class="scrim" data-act="sClose"></div><div class="sheet help" role="dialog" aria-label="プライバシーについて">
    <div class="sheet-head"><h2>プライバシーについて</h2><button class="ghost" data-act="sClose">閉じる</button></div>
    <div class="sheet-list help-list privacy">
      ${PRIVACY.map(sec => `<section><h3>${esc(sec.title)}</h3>${sec.body.map(t => `<p>${esc(t)}</p>`).join('')}</section>`).join('')}
      <p class="hint">最終更新：${PRIVACY_UPDATED}</p>
    </div></div>`;
}
function requestSheet() {
  const sh = S.sheet;
  return `<div class="scrim" data-act="sClose"></div><div class="sheet" role="dialog" aria-label="機能の実装リクエスト">
    <div class="sheet-head"><h2>機能の実装リクエスト</h2><button class="ghost" data-act="sClose">閉じる</button></div>
    <div class="sheet-list import-list">
      <label class="label" for="request-text">ほしい機能・直してほしいところ</label>
      <textarea id="request-text" placeholder="例：統計で、人数ごとの勝率も見たい" maxlength="1000"></textarea>
      <p class="hint">名前などは送られません。すべてに対応できるとは限らず、返事もできないので、ご了承ください。</p>
      <div class="form-actions"><button class="ghost" data-act="sClose">やめる</button><button class="primary" data-act="requestSend" ${sh.sending ? 'disabled' : ''}>${sh.sending ? '送っています…' : '送る'}</button></div>
    </div></div>`;
}
function reportSheet() {
  const sh = S.sheet;
  return `<div class="scrim" data-act="sClose"></div><div class="sheet" role="dialog" aria-label="誤りを知らせる">
    <div class="sheet-head"><h2>誤りを知らせる</h2><button class="ghost" data-act="sClose">閉じる</button></div>
    <div class="sheet-list import-list">
      <label class="label" for="report-enemy">敵の名前</label>
      <input type="text" id="report-enemy" value="${esc(sh.enemy || '')}" placeholder="例：夜の獣、グラディウス" maxlength="100">
      <label class="label" for="report-text">内容</label>
      <textarea id="report-text" placeholder="例：トリオのHPが違う。正しくは〇〇（どこで確かめたかも書いてもらえると助かります）" maxlength="1000"></textarea>
      <p class="hint">名前などは送られません。返事はできないので、ご了承ください。</p>
      <div class="form-actions"><button class="ghost" data-act="sClose">やめる</button><button class="primary" data-act="reportSend" ${sh.sending ? 'disabled' : ''}>${sh.sending ? '送っています…' : '送る'}</button></div>
    </div></div>`;
}
// 自分の統計で「常夜の王」に絞っているときは、夜の王のアイコンを紫にする
const myEver = () => S.stats.scope !== 'all' && S.stats.mode === 'ever';
function barRow(x, dim, drill) {
  const inner = `<span class="name">${ico(drill, x.it.id, myEver())}${esc(x.it.name)}</span><span class="num"><b>${pct(x.p)}</b> ${x.w}/${x.n}</span>
    <span class="bar-track"><span class="bar-fill" style="width:${x.p * 100}%;background:${x.p >= .5 ? 'var(--grad-win)' : 'var(--grad-loss)'}"></span></span>`;
  return drill
    ? `<button class="bar-row tap ${dim ? 'dim' : ''}" data-act="drill" data-k="${drill}" data-v="${esc(x.it.id)}">${inner}<span class="go" aria-hidden="true">›</span></button>`
    : `<div class="bar-row ${dim ? 'dim' : ''}">${inner}</div>`;
}
function drillBanner() {
  const keys = Object.keys(S.stats.drill);
  if (!keys.length) return `<p class="hint">各項目の行をタップすると、その条件に絞って詳しく見られます。</p>`;
  return `<div class="drill-banner"><b>絞り込み中</b><div class="chips">${keys.map(k => `<button class="chip small drill-chip" data-act="undrill" data-v="${k}" aria-label="${DRILL[k].label}の絞り込みを外す">${DRILL[k].label}：${ico(k, S.stats.drill[k], myEver())}${esc(DRILL[k].name(S.stats.drill[k]))} <span aria-hidden="true">×</span></button>`).join('')}</div>
    ${keys.length > 1 ? '<button class="ghost small" data-act="undrillAll">すべて外す</button>' : ''}</div>`;
}
function viewStats() {
  const runs = filteredRuns();
  const dr = S.stats.drill;
  const all = rate(runs);
  const chrono = [...runs].sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt - b.updatedAt);
  let streak = 0; for (let i = chrono.length - 1; i >= 0 && chrono[i].result === 'win'; i--) streak++;
  let best = 0, cur = 0; chrono.forEach(r => { cur = r.result === 'win' ? cur + 1 : 0; best = Math.max(best, cur); });
  const losses = runs.filter(r => r.result === 'loss');
  const lossCounts = LOSS_AT.map(x => ({ ...x, n: losses.filter(r => r.lossAt === x.id).length }));
  const lossColors = { d1: '#f0b46a', d2: '#e3835e', final: '#cf5a55' };
  const lossTotal = lossCounts.reduce((s, x) => s + x.n, 0);
  const filterChips = (key, opts) => opts.map(([v, l]) => `<button class="chip small" data-act="sf" data-k="${key}" data-v="${v}" ${pressed(S.stats[key] === v)}>${l}</button>`).join('');
  const scopeSeg = `<div class="seg scope-seg">${[['mine', '自分の統計'], ['all', 'みんなの統計']].map(([v, l]) => `<button data-act="statsScope" data-v="${v}" ${pressed(S.stats.scope === v)}>${l}</button>`).join('')}</div>`;
  if (S.stats.scope === 'all') return `<div class="stack-lg">${scopeSeg}${globalStats()}</div>`;
  return `<div class="stack-lg">
    ${scopeSeg}
    <div class="filters">
      <div class="chips">${filterChips('period', [['all', '全期間'], ['30', '30日'], ['7', '7日']])}</div>
      <div class="chips">${filterChips('mode', [['all', 'すべて'], ['normal', '通常'], ['deep', '深き夜'], ['ever', '常夜の王']])}</div>
    </div>
    ${drillBanner()}
    ${runs.length ? `
    ${secToggles(STATS_MINE)}
    <div class="tiles">
      <div class="tile"><div class="k">戦数</div><div class="v">${all.n}</div><div class="s">${all.w}勝 ${all.n - all.w}敗</div></div>
      <div class="tile"><div class="k">勝率</div><div class="v">${pct(all.p)}</div><div class="s">${{ all: '全期間', 30: '直近30日', 7: '直近7日' }[S.stats.period]}</div></div>
      <div class="tile"><div class="k">連勝</div><div class="v">${streak}</div><div class="s">最高 ${best}</div></div>
    </div>
    ${cardIf('勝率の推移', `<p class="hint">直近10戦ごとの勝率。点線は50%</p>${spark(chrono)}`)}
    ${dr.lord ? '' : cardIf('夜の王別', barRows(LORDS, l => runs.filter(r => r.lordId === l.id), { drill: 'lord' }))}
    ${dr.char ? '' : cardIf('夜渡り別', barRows(CHARS, c => runs.filter(r => r.charId === c.id), { drill: 'char' }))}
    ${dr.lord || dr.char ? '' : cardIf('相性表', heat(runs), `<div class="chips">${[['lord', '夜の王ごと'], ['char', '夜渡りごと']].map(([v, l]) => `<button class="chip small" data-act="heatBy" data-v="${v}" ${pressed(S.stats.heatBy === v)}>${l}</button>`).join('')}</div>`)}
    ${cardIf('どこで倒れたか', lossTotal ? `<div class="stack">${lossCounts.filter(x => x.n).map(x => `<div style="flex:${x.n};background:${lossColors[x.id]}">${x.n >= lossTotal * .12 ? pct(x.n / lossTotal) : ''}</div>`).join('')}</div>
      <div class="legend">${lossCounts.map(x => `<span><i style="background:${lossColors[x.id]}"></i>${x.name} ${x.n}回</span>`).join('')}</div>` : `<p class="hint">敗北の記録はありません</p>`)}
    ${dr.preset ? '' : cardIf('ビルド別', barRows([...db.presets.map(p => ({ id: p.id, name: presetLabel(p) })), { id: '__none', name: 'ビルドなし' }, { id: '__gone', name: '削除済み（詳細不明）' }],
      p => runs.filter(r => DRILL.preset.match(r, p.id)), { drill: 'preset' }))}
    ${dr.style && dr.weapon ? '' : cardIf('型・メイン武器別', `${dr.style ? '' : barRows(STYLES, st => runs.filter(r => runBuild(r)?.style === st.id), { drill: 'style' })}
      ${dr.weapon ? '' : barRows(WEAPON_TYPES.map(w => ({ id: w, name: w })), w => runs.filter(r => runBuild(r)?.weaponType === w.id), { drill: 'weapon' })}`)}
    ${cardIf('効果別', `<p class="hint">その効果を積んでいた試合の勝率。プリセットに登録した効果だけが対象です</p>
      ${barRows(usedEffects(runs).filter(ef => ef.id !== dr.effect), ef => runs.filter(r => presetHasEffect(r, ef.id)), { limit: 10, key: 'effects', drill: 'effect' })}`)}` : `<div class="empty-state">この条件の記録はありません</div>`}
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
// 相性表：横に広い表をやめて、夜の王（または夜渡り）ごとに、相手との勝率を色付きの札で並べる
function heat(runs) {
  const byLord = S.stats.heatBy !== 'char';
  const groups = byLord ? LORDS : CHARS, others = byLord ? CHARS : LORDS;
  const gKey = byLord ? 'lordId' : 'charId', oKey = byLord ? 'charId' : 'lordId';
  const rows = groups.filter(g => runs.some(r => r[gKey] === g.id)).map(g => {
    const mine = runs.filter(r => r[gKey] === g.id);
    const cells = others.map(o => ({ o, ...rate(mine.filter(r => r[oKey] === o.id)) })).filter(x => x.n).sort((a, b) => b.n - a.n || b.p - a.p);
    return `<div class="match-group"><div class="match-head"><b>${ico(byLord ? 'lord' : 'char', g.id, myEver())}${g.name}</b><span>${rate(mine).n}戦</span></div><div class="match-cells">${cells.map(x => {
      const col = x.p >= .5 ? 'var(--win)' : 'var(--loss)';
      const strength = x.n < STATS_MIN_RUNS ? 14 : Math.round(18 + Math.abs(x.p - .5) * 2 * 60);  // 戦数が少ないものは、色を薄くして目立たせない
      return `<span class="match ${x.n < STATS_MIN_RUNS ? 'few' : ''}" style="background:color-mix(in srgb, ${col} ${strength}%, var(--panel))"><span class="nm">${ico(byLord ? 'char' : 'lord', x.o.id, myEver())}${x.o.name}</span><b>${pct(x.p)}</b><small>${x.w}/${x.n}</small></span>`;
    }).join('')}</div></div>`;
  });
  return `<p class="hint">${byLord ? '夜の王ごとに、使った夜渡りの勝率' : '夜渡りごとに、戦った夜の王との勝率'}。緑ほど勝ち越し、赤ほど負け越し。点線で色の薄い札は${STATS_MIN_RUNS}戦未満（参考）です</p><div class="match-list">${rows.join('')}</div>`;
}

function relicSub(r) { if (r.special) return SPECIAL[r.special].effects.join('・'); return r.effects.filter(Boolean).map(e => ALL_EFF[e].name).join('・') || '効果未登録'; }
const presetRelics = p => [...p.normal, ...p.deep].filter(Boolean);
function presetHasEffect(run, effId) {
  const p = runBuild(run);
  if (effId.startsWith('sp:')) return !!p && presetRelics(p).some(r => r.special === effId.slice(3));
  return !!p && presetRelics(p).some(r => r.effects.includes(effId) || r.demerits.includes(effId));
}
function usedEffects(runs) {
  const ids = new Set();
  new Set(runs.map(runBuild).filter(Boolean)).forEach(p => presetRelics(p).forEach(r => r.special ? ids.add('sp:' + r.special) : [...r.effects, ...r.demerits].forEach(e => e && ids.add(e))));
  return [...ids].map(id => id.startsWith('sp:') ? { id, name: `《${SPECIAL[id.slice(3)].name}》` } : { id, name: ALL_EFF[id].label });
}
// ---------- ビルドの共有（サーバーなし）：プリセットの中身を文字にしてリンクに入れる ----------
// リンクの形：（アプリのURL）#build=（中身）。受け取った人はリンクを開くか、アプリの「共有されたビルドを取り込む」に貼り付ける
const SHARE_FIELDS = ['name', 'nameAuto', ...BUILD_FIELDS, 'pubNote', 'neta'];  // neta＝ネタビルドの印
const b64u = str => { let bin = ''; new TextEncoder().encode(str).forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = str => new TextDecoder().decode(Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
const shareUrl = p => `${location.origin}${location.pathname}#build=${b64u(JSON.stringify({ v: 1, ...Object.fromEntries(SHARE_FIELDS.map(k => [k, p[k] ?? null])) }))}`;
// 貼り付けられた文字（リンクでも中身だけでも可）からプリセットの中身を取り出す。読めなければ null
function parseShare(text) {
  const m = String(text || '').match(/build=([A-Za-z0-9_-]+)/) || String(text || '').trim().match(/^([A-Za-z0-9_-]{16,})$/);
  if (!m) return null;
  try {
    const o = JSON.parse(unb64u(m[1]));
    if (!o || o.v !== 1) return null;
    const slots = a => Array.isArray(a) && a.length === 3 ? a.map(r => (r && typeof r === 'object' ? r : null)) : [null, null, null];
    const str = x => (typeof x === 'string' ? x.slice(0, 60) : null);
    const charId = CHAR[o.charId] ? o.charId : null;
    const vesselId = VESSEL[o.vesselId] && charId ? o.vesselId : null;
    return { name: str(o.name) || '', nameAuto: o.nameAuto !== false || !str(o.name), charId, vesselId,
      style: STYLES.some(x => x.id === o.style) ? o.style : null, spec: Array.isArray(o.spec) ? o.spec.filter(x => typeof x === 'string') : [],
      weaponType: WEAPON_TYPES.includes(o.weaponType) ? o.weaponType : null, weaponName: str(o.weaponName) || '',
      normal: vesselId ? slots(o.normal) : [null, null, null], deep: vesselId ? slots(o.deep) : [null, null, null],
      pubNote: typeof o.pubNote === 'string' ? o.pubNote.slice(0, 200) : '', neta: o.neta === true };
  } catch { return null; }
}
// 遺物の中身（表・深層それぞれの遺物の名前と効果）
function relicDetail(d) {
  const part = (kind, label) => { const rs = d[kind].filter(Boolean);
    // 効果は1つずつ行を分ける（深層のデメリットは、その効果のすぐ下に「↳」で）
    const lines = r => r.special ? SPECIAL[r.special].effects.map(e => `<li>${esc(e)}</li>`).join('')
      : r.effects.map((e, j) => !e ? '' : `<li>${esc(ALL_EFF[e]?.name || '')}</li>${r.demerits?.[j] ? `<li class="dem">↳ ${esc(ALL_EFF[r.demerits[j]]?.name || '')}</li>` : ''}`).join('') || '<li>効果未登録</li>';
    return rs.length ? `<div class="relic-detail"><div class="label">${label}</div>${rs.map(r => `<div class="rd-row"><span class="color-dot c-${r.color}"></span><div><b>${esc(relicName(r))}</b><ul class="rd-effs">${lines(r)}</ul></div></div>`).join('')}</div>` : ''; };
  return part('normal', '表の遺物') + part('deep', '深層の遺物') || '<p class="hint">遺物の登録はありません。</p>';
}
// みんなのビルドのリアクション（受け取り口の REACTIONS と同じ名前）。1人が何種類でも付けられ、もう一度押すと取り消し
const REACTIONS = [['like', '👍', 'いいね'], ['lol', '😂', '笑った'], ['strong', '🔥', '強そう'], ['tips', '💡', '参考'], ['wow', '🤯', 'すごい']];
// 自分が付けたリアクション。前の「いいね」（prefs().votes が 1）は 👍 を付けたものとして扱う
const myReacts = id => { const m = { ...((prefs().reacts || {})[id] || {}) }; if ((prefs().votes || {})[id] === 1) m.like = true; return m; };
const reactCounts = b => { const r = { ...(b.reactions || {}) }; if (!b.reactions && b.likes) r.like = b.likes; return r; };  // 古い受け取り口は likes だけ
const reactSummary = b => { const r = reactCounts(b); return REACTIONS.filter(([k]) => r[k]).map(([k, e]) => `${e} ${r[k]}`).join('　'); };
function voteRow(pub) {
  const mine = myReacts(pub.presetId), cnt = reactCounts(pub);
  const rep = (prefs().reported || {})[pub.presetId];
  return `<p class="hint">リアクションは何種類でも付けられます。もう一度押すと取り消し（新しく付けるのは1日20回まで）。</p>
    <div class="react-row">${REACTIONS.map(([k, e, l]) => `<button class="react ${mine[k] ? 'on' : ''}" data-act="react" data-v="${k}" aria-pressed="${!!mine[k]}" aria-label="${l}"><span class="e">${e}</span><span class="l">${l}</span><b>${cnt[k] || 0}</b></button>`).join('')}</div>
    ${commentBox(pub)}
    <button class="link-btn report-link ${S.confirmDel === 'buildReport' ? 'danger-text' : 'dim-link'}" data-act="buildReport" ${rep ? 'disabled' : ''}>${rep ? '通報済み' : S.confirmDel === 'buildReport' ? 'もう一度押すと通報します' : '⚑ 不適切な内容を通報する'}</button>`;
}
// 定型文コメント：決まった「文の型」と「言葉」を組み合わせて送る。本編と同じように、つなぐ言葉で2つ目の文も付けられる
// （1人が1つのビルドに1つ。送り直すと置き換え）。一覧の1件は [t, w, 数, c, t2, w2]（c が -1 なら1文だけ）
const cmtParts = x => ({ t: x[0], w: x[1], c: x[3] ?? -1, t2: x[4] ?? -1, w2: x[5] ?? -1 });
const validCmt = x => { const p = Array.isArray(x) ? cmtParts(x) : x; return !!COMMENT_TEMPLATES[p.t] && !!COMMENT_WORDS[p.w] && (!(p.c >= 0) || (!!COMMENT_CONJ[p.c] && !!COMMENT_TEMPLATES[p.t2] && !!COMMENT_WORDS[p.w2])); };
const cmtTextOf = p => commentFull(p.t, p.w, p.c ?? -1, p.t2 ?? -1, p.w2 ?? -1);
const sameCmt = (a, b) => !!a && !!b && a.t === b.t && a.w === b.w && (a.c ?? -1) === (b.c ?? -1) && ((a.c ?? -1) < 0 || (a.t2 === b.t2 && a.w2 === b.w2));
const cmtCount = b => (b.comments || []).filter(validCmt).reduce((a, c) => a + (c[2] || 0), 0);
function commentBox(pub) {
  const list = (pub.comments || []).filter(validCmt);
  const mine = (prefs().comments || {})[pub.presetId], c = S.sheet?.compose;
  const rows = list.length ? list.map(x => `<li class="${sameCmt(mine, cmtParts(x)) ? 'mine' : ''}"><span>「${esc(cmtTextOf(cmtParts(x)))}」</span>${x[2] > 1 ? `<b>×${x[2]}</b>` : ''}</li>`).join('')
    : '<li class="none">まだコメントはありません</li>';
  let compose = '';
  if (c) {
    const chip = (act, v, label, on) => `<button class="chip small" data-act="${act}" data-v="${v}" ${pressed(on)}>${esc(label)}</button>`;
    const tChips = (act, cur) => COMMENT_TEMPLATES.map((x, i) => i >= COMMENT_T_START ? chip(act, i, x, cur === i) : '').join('');
    const groups = (act, cur) => `<div class="cmt-groups">${COMMENT_GROUPS.map(g => `<button class="${cur === g ? 'on' : ''}" data-act="${act}" data-v="${esc(g)}">${esc(g)}</button>`).join('')}</div>`;
    const wChips = (act, g, cur) => COMMENT_WORDS.map(([x, gg], i) => gg === g ? chip(act, i, x, cur === i) : '').join('');
    const ready = c.t != null && c.w != null && (!c.two || (c.c != null && c.t2 != null && c.w2 != null));
    const preview = c.t != null && c.w != null ? cmtTextOf(c.two && c.c != null && c.t2 != null && c.w2 != null ? c : { t: c.t, w: c.w, c: -1 }) : '';
    compose = `<div class="cmt-compose">
      <div class="cmt-preview">${preview ? `「${esc(preview)}」` : '<span class="hint">文の型と言葉を選ぶと、ここに出ます</span>'}</div>
      <div class="label">① 文の型</div><div class="chips">${tChips('cmtT', c.t)}</div>
      <div class="label">② ◯◯に入れる言葉</div>${groups('cmtG', c.g)}<div class="chips">${wChips('cmtW', c.g, c.w)}</div>
      ${c.two ? `<div class="cmt-two">
        <div class="label">③ つなぐ言葉<button class="link-btn" data-act="cmtTwo">1文に戻す</button></div><div class="chips">${COMMENT_CONJ.map((x, i) => chip('cmtC', i, x, c.c === i)).join('')}</div>
        <div class="label">④ 2つ目の文の型</div><div class="chips">${tChips('cmtT2', c.t2)}</div>
        <div class="label">⑤ 2つ目の◯◯に入れる言葉</div>${groups('cmtG2', c.g2)}<div class="chips">${wChips('cmtW2', c.g2, c.w2)}</div></div>`
        : '<button class="ghost small cmt-add" data-act="cmtTwo">＋ もう1文つなげる</button>'}
      <div class="form-actions"><button class="ghost" data-act="cmtClose">やめる</button><button class="primary" data-act="cmtSend" ${ready && !c.sending ? '' : 'disabled'}>${c.sending ? '送っています…' : '送る'}</button></div>
    </div>`;
  }
  return `<div class="cmt"><div class="cmt-h">💬 定型文コメント</div><ul class="cmt-list">${rows}</ul>
    ${mine && validCmt(mine) ? `<p class="hint cmt-mine">あなたのコメント：「${esc(cmtTextOf(mine))}」<button class="link-btn" data-act="cmtDel">取り消す</button></p>` : ''}
    ${c ? compose : `<button class="ghost small cmt-open" data-act="cmtOpen">${mine ? '💬 送り直す' : '💬 定型文を送る'}</button>`}</div>`;
}
function importSheet() {
  const sh = S.sheet, d = sh.data;
  const body = d
    ? `<div class="card import-preview"><span class="title"><span>${esc(presetName(d))}${d.neta ? '<span class="badge neta">ネタ</span>' : ''}</span></span>
        <span class="sub">${d.charId ? charName(d.charId) : '夜渡り未設定'}${styleText(d) ? '・' + esc(styleText(d)) : ''}</span>
        ${d.pubNote ? `<p class="pub-note">${esc(d.pubNote)}</p>` : ''}
        ${relicDetail(d)}</div>
       ${sh.pub ? voteRow(sh.pub) : ''}
       <p class="hint">取り込むと、ビルド一覧の「取り込んだビルド」に入ります（今あるプリセットはそのままです）。</p>
       <div class="form-actions"><button class="ghost" data-act="sClose">やめる</button><button class="primary" data-act="importDo">取り込む</button></div>`
    : `<textarea id="import-text" placeholder="共有されたリンクを貼り付け"></textarea>
       ${sh.err ? '<p class="hint import-err">読み込めませんでした。リンクを最後までコピーできているか確かめてください。</p>' : ''}
       <p class="hint">ホーム画面のアプリで使っている場合、リンクを開くとSafariなど別の場所で開いてしまいます。リンクをコピーして、ここに貼り付けてください。</p>
       <div class="form-actions"><button class="ghost" data-act="sClose">やめる</button><button class="primary" data-act="importRead">読み込む</button></div>`;
  return `<div class="scrim" data-act="sClose"></div><div class="sheet" role="dialog" aria-label="ビルドを取り込む">
    <div class="sheet-head"><h2>ビルドを取り込む</h2><button class="ghost" data-act="sClose">閉じる</button></div>
    <div class="sheet-list import-list">${body}</div></div>`;
}
// スクショの読み取り：読み取った遺物を枠に入れる（献器は遺物の色から自動で決まる）
async function runScan(kind, file) {
  const ed = S.edit, d = ed.data;
  ed.scanning = kind; render();
  if (!scanReady) toast('初回は読み取りの準備に少し時間がかかります');
  try {
    const famsFor = fams => fams.filter(f => !f.charName || f.charName === CHAR[d.charId]?.name)
      .flatMap(f => f.levels.map(e => ({ id: e.id, base: f.opts ? e.name : f.name, lv: e.lv || 0 })));
    const specials = kind === 'normal' ? SPECIALS.filter(x => x.type === 'lord' || x.who === d.charId || x.who === 'any') : [];
    const relics = await scanRelics(file, kind, { effects: famsFor(kind === 'deep' ? DEEP_FAMS : NORMAL_FAMS), demerits: famsFor(DEMERIT_FAMS), specials });
    scanReady = true;
    if (!relics.some(Boolean)) { toast('遺物を読み取れませんでした。「遺物儀式」の画面のスクショか確かめてください'); return; }
    d[kind] = relics;
    if (!fitVessel(d)) { ed.open[kind === 'deep' ? 'relicDeep' : 'relicNormal'] = true; toast('読み取りましたが、この色の組み合わせに適合する献器がありません。遺物を見直してください'); return; }
    ed.open[kind === 'deep' ? 'relicDeep' : 'relicNormal'] = true;
    const unsure = d[kind].filter(r => r?.check).length;
    toast(`${kind === 'deep' ? '深層' : '表'}の遺物を読み取りました。${unsure ? `「要確認」の${unsure}つは、とくに見直してください` : 'ゲームの画面と見比べて確かめてください'}`);
  } catch (err) {
    toast(err.message === 'aspect' ? 'ゲームのスクショ（横長16:9）を、切り取らずにそのまま選んでください'
      : err.message === 'screen' ? '「遺物儀式」の画面ではないようです。「この画面です！」の見本と同じ画面のスクショを選んでください'
      : '読み取れませんでした。通信できる所で、もう一度お試しください');
  } finally { ed.scanning = null; if (S.edit === ed) render(); }
}
let scanReady = false;
// ---------- みんなのビルド（みんなに公開されたプリセット） ----------
const PUB = { list: null, at: 0, loading: false, failed: false };
function loadPublic(force) {
  if (!PUB.list) PUB.list = readCache('builds');  // 前回の一覧をすぐ出す
  if (PUB.loading || (!force && PUB.at && Date.now() - PUB.at < 120e3)) return;
  PUB.loading = true;
  // 失敗したときも時刻を残し、すぐにはやり直さない（通信できないときに読み込みが止まらず画面が固まるため）
  net(`${ONLINE_URL}?type=builds`).then(r => r.json()).then(d => { if (!d.ok) throw new Error(); PUB.list = d.builds || []; PUB.failed = false; PUB.at = Date.now(); writeCache('builds', PUB.list); },
    () => { PUB.failed = true; PUB.at = Date.now() - 60e3; }).finally(() => { PUB.loading = false; if (S.buildView === 'public') render(); });
}
// 公開用の中身（共有リンクと同じ形）
const publicPayload = p => JSON.stringify({ v: 1, ...Object.fromEntries(SHARE_FIELDS.map(k => [k, p[k] ?? null])) });
const parsePublic = data => { try { return parseShare('build=' + b64u(data)); } catch { return null; } };
function publicBuilds() {
  loadPublic();
  const f = S.pubChar || '';
  const mine = new Set(db.presets.map(p => p.id));
  // 「ネタビルドだけ」のスイッチ：オンのときは、ネタビルドだけを並べる（オフはすべて）
  const onlyNeta = !!prefs().pubOnlyNeta;
  const all = (PUB.list || []).map(b => ({ ...b, p: parsePublic(b.data) })).filter(b => b.p && (!f || b.p.charId === f));
  const items = all.filter(b => !onlyNeta || b.p.neta), netaN = all.filter(b => b.p.neta).length;
  const chips = charGrid('pubChar', f, id => (PUB.list || []).filter(b => parsePublic(b.data)?.charId === id).length);
  const body = !PUB.list ? `<div class="empty-state">${PUB.failed && !PUB.loading ? '読み込めませんでした。通信できる所で、もう一度読み込んでください。<br><button class="ghost small" data-act="publicOpen" style="margin-top:8px">もう一度読み込む</button>' : '読み込んでいます…'}</div>`
    : items.length ? items.map((b, i) => `<button class="card" data-act="pubPick" data-v="${(PUB.list || []).indexOf(PUB.list.find(x => x.data === b.data))}">
        <span class="title"><span>${esc(presetName(b.p))}${b.p.neta ? '<span class="badge neta">ネタ</span>' : ''}${mine.has(b.presetId) ? '<span class="badge pub">あなた</span>' : ''}</span><span class="rate none">取り込む ›</span></span>
        <span class="sub">${b.p.charId ? charName(b.p.charId) : '夜渡り未設定'}${styleText(b.p) ? '・' + esc(styleText(b.p)) : ''}</span>
        ${b.p.pubNote ? `<span class="pub-note one">${esc(b.p.pubNote)}</span>` : ''}
        <span class="vote-count">${[reactSummary(b), cmtCount(b) ? `💬 ${cmtCount(b)}` : ''].filter(Boolean).join('　') || 'リアクションはまだありません'}</span></button>`).join('')
    : `<div class="empty-state">${onlyNeta ? `${f ? 'この夜渡りの' : ''}ネタビルドはまだありません。` : `${f ? 'この夜渡りの' : ''}公開されたビルドはまだありません。`}</div>`;
  return `<div class="stack-lg">
    <button class="ghost back-btn" data-act="pubClose">‹ 自分のビルドに戻る</button>
    <div class="page-title">みんなのビルド</div>
    <p class="hint">みんなが「みんなに公開」にしたプリセットです。タップすると中身（遺物）を見て、取り込めます。作った人の名前などは表示されません。</p>
    ${chips}
    <button class="neta-filter" role="switch" aria-checked="${onlyNeta}" data-act="pubNeta"><span>ネタビルドだけ表示${netaN ? `<small>（${netaN}件）</small>` : ''}</span><i class="tgl ${onlyNeta ? 'on' : ''}" aria-hidden="true"></i></button>
    ${body}</div>`;
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
// 夜渡りのアイコンの四角いボタン（5列×2行）。押すとその夜渡りに絞り込み、もう一度押すと解除。count を渡すと右上に件数を出す
function charGrid(act, cur, count) {
  return `<div class="char-grid" role="group" aria-label="夜渡りで絞り込む">${CHARS.map(c => { const n = count ? count(c.id) : null;
    return `<button class="char-sq" data-act="${act}" data-v="${c.id}" ${pressed(cur === c.id)} aria-label="${c.name}で絞り込む">${ico('char', c.id)}<span>${c.name}</span>${n ? `<i>${n}</i>` : ''}</button>`; }).join('')}</div>
    ${cur ? `<p class="hint char-grid-note">${CHAR[cur].name}だけを表示中<button class="link-btn" data-act="${act}" data-v="${cur}">すべて表示</button></p>` : ''}`;
}
const shownPresets = () => activePresets().filter(p => !S.buildChar || p.charId === S.buildChar);
function viewBuilds() {
  if (S.edit) return S.edit.slot ? editSlot() : editPreset();
  if (S.buildView === 'public') return publicBuilds();
  const dr = prefs().draft;
  const draftCard = dr ? `<div class="card draft-card"><button class="draft-main" data-act="draftResume">
      <span class="title"><span><span class="badge draft">${dr.isNew ? '未完成' : '編集途中'}</span>${esc(presetName(dr.data))}</span><span class="rate none">続きから ›</span></span>
      <span class="sub">${dr.data.charId ? charName(dr.data.charId) : '夜渡り未設定'}${styleText(dr.data) ? '・' + esc(styleText(dr.data)) : ''}</span></button>
      <button class="ghost draft-del ${S.confirmDel === 'draft' ? 'danger' : ''}" data-act="draftDel">${S.confirmDel === 'draft' ? 'もう一度押すと破棄' : '破棄'}</button></div>` : '';
  return `<div class="stack-lg">
    <p class="hint">ビルドの登録は任意です。登録しなくても戦績は記録できます。遺物の効果まで入れておくと、ビルドや効果ごとの勝率が見られます。</p>
    ${draftCard}
    <button class="btn-add ${S.confirmDel === 'newPreset' ? 'danger' : ''}" data-act="newPreset">${S.confirmDel === 'newPreset' ? 'もう一度押すと、未完成のものを破棄して新しく作ります' : '＋ プリセットを作る'}</button>
    ${charGrid('buildChar', S.buildChar || '', id => activePresets().filter(p => p.charId === id).length)}
    ${shownPresets().length ? `<button class="gacha-btn" data-act="gacha">🎲 ビルドガチャ<small>${S.buildChar ? `${CHAR[S.buildChar].name}のビルドから` : 'すべてのビルドから'}1つ選ぶ</small></button>` : ''}
    <div class="build-actions"><button class="ghost import-btn" data-act="publicOpen">みんなのビルドを見る</button><button class="ghost import-btn" data-act="importOpen">共有リンクから取り込む</button></div>
    ${S.buildChar && !shownPresets().length ? `<div class="empty-state">${CHAR[S.buildChar].name}のプリセットはまだありません。</div>` : ''}
    ${(() => { const mine = shownPresets().filter(p => !p.imported), got = shownPresets().filter(p => p.imported), row = p => { const x = rate(liveRuns().filter(r => r.presetId === p.id)); return `<button class="card" data-act="editPreset" data-v="${p.id}">
      <span class="title"><span>${esc(p.name)}${p.public ? '<span class="badge pub">公開中</span>' : ''}</span><span class="rate ${x.n ? '' : 'none'}">${x.n ? `勝率 ${pct(x.p)}` : '未使用'}</span></span>
      <span class="sub">${p.charId ? charName(p.charId) : '夜渡り未設定'}${styleText(p) ? '・' + esc(styleText(p)) : ''}</span>
      <span class="preset-use">${x.n ? `使用 <b>${x.n}</b>戦（${x.w}勝 ${x.n - x.w}敗）` : 'まだ戦績で使っていません'}</span></button>`; };
      return (got.length ? `<div class="sub-head">マイプリセット<span>${mine.length}</span></div>` : '') + mine.map(row).join('')
        + (got.length ? `<div class="sub-head">取り込んだビルド<span>${got.length}</span></div>${got.map(row).join('')}` : ''); })()}
  </div>`;
}
// ---------- 敵（耐性・カット率・崩し値） ----------
// データ（src/data/enemies.js、約140KB）は「敵」タブを開いたときに初めて読み込む
let ENEMY_DATA = null;
const ENEMY_CATS = ['夜の王', '夜の強敵', 'フィールド', '拠点', '雑魚'];
const NEG_LABELS = ['標準', '斬撃', '打撃', '刺突', '魔力', '炎', '雷', '聖'];
const RES_LABELS = ['毒', '腐敗', '出血', '冷気', '睡眠', '発狂', '死'];
const PARTY_IDX = { solo: 0, duo: 1, trio: 2 };
const ENEMY_PAGE = 60;  // 一度に並べる数（多いと重くなるので「もっと見る」で増やす）
// 隠しコマンド：名前で探すに「ワサガキ」（ひらがな可）と入れたときだけ出る遊びの夜の王。敵データ（enemies.js）とは別に持つ
// アイコン・画像は tools/make_glibra.py で Images/Glibra.webp から作る
const SECRET_WORD = 'ワサガキ';
const SECRET_ENEMY = [0, 'ゲーミングリブラ', '', '', 'glibra', [0, 1, 2].map(() => Array(4).fill(999999999)),
  Array(8).fill(700000000), [13e9, 13e9, 13e9, 13e9, 13e9, -1e8, 13e9], Array(3).fill(20000000), null, null];
const SECRET_IMAGE = 'icons/secret/glibra.webp';
function loadEnemies() {
  if (S.enemy.loading) return;
  S.enemy.loading = true;
  // 読み込みに失敗したときだけ「読み込めませんでした」を出す（画面を作るときのエラーとは分ける）
  // やり直しのときは名前に印を付ける（一度失敗した読み込みを、ブラウザが覚えていて再び失敗するのを避ける）
  import(S.enemy.retry ? `../data/enemies.js?r=${S.enemy.retry}` : '../data/enemies.js').then(m => { ENEMY_DATA = m.ENEMIES; }, err => { console.error(err); S.enemy.loading = false; S.enemy.failed = true; })
    .then(() => render());
}
const fmtN = n => n == null ? '–' : n.toLocaleString('ja-JP');
const fmtR = (a, b) => a == null ? '–' : a === b ? fmtN(a) : `${fmtN(a)}〜${fmtN(b)}`;
const fmtPoise = p => p == null ? '–' : Array.isArray(p) ? `${p[0]}〜${p[1]}` : String(p);
function viewEnemies() {
  const E = S.enemy;
  if (!ENEMY_DATA) {
    if (!E.failed) loadEnemies();
    return `<div class="empty-state">${E.failed ? '読み込めませんでした。通信できる所で、もう一度読み込んでください。<br><button class="ghost small" data-act="enemyRetry" style="margin-top:8px">もう一度読み込む</button>' : '敵のデータを読み込んでいます…'}</div>`;
  }
  const q = E.q.trim();
  const p = PARTY_IDX[E.party] ?? 0;
  const chip = (act, v, label, on) => `<button class="chip small" data-act="${act}" data-v="${v}" ${pressed(on)}>${label}</button>`;
  const all = ENEMY_DATA.map((e, i) => [e, i]);
  // どの種類も「まとめた1行 → 開くと切り替えスイッチ・小さなボタン → 詳しい数値」の形
  const group = g => {
    const open = E.open === `g:${g.key}`;
    const head = `<button class="enemy-head" data-act="enemyOpen" data-v="g:${esc(g.key)}" aria-expanded="${open}">
      <span class="enemy-name">${g.icon ? ico('lord', g.icon) : ''}<span><b>${esc(g.title)}</b>${g.sub ? `<small>${esc(g.sub)}</small>` : ''}</span></span><span class="chev"></span></button>`;
    if (!open) return `<div class="enemy">${head}</div>`;
    const modes = g.modes.filter(m => g.items.some(m.test));
    const mode = modes.find(m => m.id === E.mode) || modes[0];
    const inMode = g.items.filter(mode.test);
    // 最初に選ぶもの：見出しと同じ名前の「通常／常夜」→「合計HP」→ 同じ名前の「第1形態」→ ほかの通常 → 先頭
    const plain = ([e]) => !e[2] || e[2] === '常夜' || e[2] === '災域';
    const own = x => x[0][1] === g.title, first = ([e]) => e[2].includes('第1形態');
    const sel = inMode.find(([, i]) => i === E.sub) || inMode.find(x => own(x) && plain(x)) || inMode.find(([e]) => e[2] === '合計HP')
      || inMode.find(x => own(x) && first(x)) || inMode.find(plain) || inMode.find(first) || inMode[0];
    // 名前も場所も同じで数値だけ少し違う個体は、1つのボタンにまとめる（違う数値は「84〜112」のように幅で出す）
    const byLabel = new Map();
    inMode.forEach(x => { const l = g.label(x[0], mode); (byLabel.get(l) || byLabel.set(l, []).get(l)).push(x); });
    const uniq = [...byLabel.values()].map(xs => xs.length === 1 ? xs[0] : [mergeRows(xs.map(x => x[0])), xs[0][1], xs]);
    const labels = [...byLabel.keys()];
    const selU = uniq.find(u => u[1] === sel[1] || (u[2] || []).some(x => x[1] === sel[1])) || uniq[0];
    return `<div class="enemy open">${head}
      <div class="lord-body">
        ${modes.length > 1 ? `<div class="seg mode-seg">${modes.map(m => `<button data-act="enemyMode" data-v="${m.id}" ${pressed(m === mode)}>${m.label}</button>`).join('')}</div>` : ''}
        ${uniq.length > 1 ? `<div class="chips">${uniq.map((x, k) => `<button class="chip small" data-act="enemySub" data-v="${x[1]}" ${pressed(x === selU)}>${esc(labels[k])}</button>`).join('')}</div>` : ''}
      </div>${enemyDetail(selU[0], p, !!selU[2])}</div>`;
  };
  // 見出し（タップで中身を開閉する）
  const sec = (id, cls, title, list, note = '') => {
    const closed = !!E.closed[id];
    return `<div class="field-sec ${cls} ${closed ? 'closed' : ''}">
      <button class="sec-toggle" data-act="enemySec" data-v="${id}" aria-expanded="${!closed}"><span>${title}</span><small>${list.length}</small><span class="chev"></span></button>
      ${closed ? '' : note + (list.length ? `<div class="enemy-list">${list.map(group).join('')}</div>` : '')}</div>`;
  };
  // 名前で探す：ひらがなでもカタカナでも見つかる。同じ名前はまとめて1行にし、中で種類・場所を選ぶ
  if (q) {
    const key = toKata(q.toLowerCase());
    const hits = key === SECRET_WORD ? [[SECRET_ENEMY, -1]]
      : all.filter(([e]) => toKata((e[1] + e[2] + e[3] + (e[9] || '')).toLowerCase()).includes(key));
    const groups = searchGroups(hits);
    const shown = groups.slice(0, E.limit);
    return enemyPage(`${shown.length ? `<div class="enemy-list">${shown.map(group).join('')}</div>` : `<div class="empty-state">見つかりませんでした</div>`}
      ${groups.length > shown.length ? `<button class="more-btn" data-act="enemyMore">もっと見る（残り${groups.length - shown.length}件）</button>` : ''}`, chip, q, groups);
  }
  // 場所などで行を先に分けてから、名前ごとにまとめる（同じ敵が複数の場所にいることがあるため）
  const rowsOf = test => enemyGroups(E.cat, all.filter(([e]) => e[0] === E.cat && test(e)));
  const groups = rowsOf(() => true);
  if (E.cat === 1) {  // 夜の強敵：1日目と2日目に分ける。夜の王で絞り込むと、その王の遠征に出るものだけ
    const pools = Object.values(NIGHT_BOSSES).filter(Boolean);
    const pick = day => new Set(E.lord && NIGHT_BOSSES[E.lord] ? NIGHT_BOSSES[E.lord][day] : pools.flatMap(x => x[day]));
    const d1 = pick('d1'), d2 = pick('d2');
    const missing = day => [...(day === 'd1' ? d1 : d2)].filter(n => !groups.some(g => g.key === n));
    const dlcNote = day => E.lord && missing(day).length ? `<p class="hint dlc-note">DLCの敵のためデータなし：${missing(day).map(esc).join('、')}</p>` : '';
    const rest = groups.filter(g => !d1.has(g.key) && !d2.has(g.key));
    return enemyPage(sec('n-d1', 'day1', '1日目の夜', groups.filter(g => d1.has(g.key)), dlcNote('d1'))
      + sec('n-d2', 'day2', '2日目の夜', groups.filter(g => d2.has(g.key)), dlcNote('d2'))
      + (E.lord || !rest.length ? '' : sec('n-rest', 'rest', 'その他', rest)), chip, q, groups);
  }
  // フィールド・拠点・雑魚：敵データに書いた見出し（e[12]、tools/make_enemies.py で決める）ごとに分ける。
  // 同じ敵が2つの見出しに入っていれば、どちらにも出す。フィールドは種類、拠点は型で絞り込める
  if (E.cat >= 2) {
    const inCat = all.filter(([e]) => inHead(e, E.cat));
    const pick = E.cat === 2 ? E.field : E.cat === 3 ? E.base : E.mob;
    const secOf = h => {
      const id = `${E.cat}-${h}`;
      const list = enemyGroups(E.cat, inCat.filter(([e]) => inHead(e, E.cat, h))).map(g => ({ ...g, key: `${id}|${g.key}` }));
      return sec(`h-${id}`, headClass(E.cat, h), h, list);
    };
    return enemyPage(headsOf(E.cat).filter(h => !pick || h === pick).map(secOf).join(''), chip, q, groups);
  }
  return enemyPage(`<div class="enemy-list">${groups.map(group).join('')}</div>`, chip, q, groups);  // 夜の王
}
// 数値だけ少し違う個体をまとめた1件を作る。違う数値は [最小, 最大]（耐性で「無効」が混ざるときは [最小, null]）
function mergeRows(es) {
  const span = vals => { const nums = vals.filter(v => v != null); const hasNull = nums.length < vals.length;
    if (!nums.length) return null; const lo = Math.min(...nums), hi = Math.max(...nums);
    return hasNull ? [lo, null] : lo === hi ? lo : [lo, hi]; };
  const flat = v => v == null ? [] : Array.isArray(v) ? v : [v];
  const m = [...es[0]];
  m[5] = [0, 1, 2].map(p => { const hs = es.map(e => e[5][p]).filter(h => h[0] != null);
    return hs.length ? [Math.min(...hs.map(h => h[0])), Math.max(...hs.map(h => h[1])), Math.min(...hs.map(h => h[2])), Math.max(...hs.map(h => h[3]))] : es[0][5][p]; });
  m[6] = es[0][6].map((_, i) => { const v = span(es.map(e => e[6][i])); return Array.isArray(v) && v[1] == null ? v[0] : v; });
  m[7] = es[0][7].map((_, i) => span(es.map(e => e[7][i])));
  m[8] = [0, 1, 2].map(p => { const vs = es.flatMap(e => flat(e[8][p])); if (!vs.length) return null;
    const lo = Math.min(...vs), hi = Math.max(...vs); return lo === hi ? lo : [lo, hi]; });
  return m;
}
// フィールド・拠点・雑魚の見出しの並び順（ここにない見出しは後ろに並ぶ）。雑魚の種類は tools/enemy_kinds.py の KINDS と同じ
const HEAD_ORDER = {
  2: ['通常', '恐るべき強敵', '封牢', '山嶺', '火口', '腐れ森', 'ノクラテオ', '大空洞', '坑道', 'その他'],
  3: ['大教会', '大野営地', '大遺跡', '小砦', '砦(屋上)', '砦(地下)', 'その他'],
  4: ['人間（兵士・騎士）', '人間（その他）', '亜人・異形', '動物・生き物', 'アンデッド', '無機物', '砦', '火口', '山嶺', '腐れ森', 'ノクラテオ', '夜の侵入者', 'その他'],
};
// その敵が、このカテゴリ（と見出し）に入っているか
const inHead = (e, cat, h) => (e[12] || []).some(([c, x]) => c === cat && (h === undefined || x === h));
// そのカテゴリにある見出しを、決まった順に
function headsOf(cat) {
  const hs = [...new Set(ENEMY_DATA.flatMap(e => (e[12] || []).filter(([c]) => c === cat).map(([, h]) => h)))];
  const rank = h => { const i = HEAD_ORDER[cat].indexOf(h); return i < 0 ? HEAD_ORDER[cat].length - 0.5 : i; };
  return hs.sort((a, b) => rank(a) - rank(b));
}
// 見出しの色：フィールドの通常＝青、恐るべき強敵＝赤。拠点の砦は別の色
const headClass = (cat, h) => cat === 2 ? ({ 通常: 'normal', 恐るべき強敵: 'dread', 封牢: 'gaol' }[h] || 'rest') : cat === 3 ? (h.startsWith('砦(') ? 'roof' : 'base') : 'mob';
// ひらがなをカタカナにそろえる（検索用）
// 半角カナ・全角英数・空白の違いもそろえる（例：ｶﾞｰｺﾞｲﾙ、「夜の 獣」でも見つかる）
const toKata = s => s.normalize('NFKC').replace(/\s+/g, '').replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
const jaSort = new Intl.Collator('ja');
const byKey = (rows, keyOf) => [...rows.reduce((m, x) => { const k = keyOf(x[0]); (m.get(k) || m.set(k, []).get(k)).push(x); return m; }, new Map())];
const baseName = name => name.replace(/[(（].*[)）]$/, '');
// 名前の違い（見出しと同じなら空、見出しの続きならその部分だけ）と場所を「・」でつなぐ。場所が名前に含まれるときは省く
const shortName = (name, title, drop) => name === title ? '' : (name.startsWith(title) ? name.slice(title.length).replace(/^[(（]|[)）]$/g, '') : name).replace(drop, '').replace(/^・|・$/g, '');
const labelOf = (title, dropScene, dropName = /$^/, fallbackName = false) => (e, mode) => {
  const who = shortName(e[1], title, dropName);
  const scene = e[2].replace(dropScene, '').replace(/^・|・$/g, '');
  return [who, scene && e[1].includes(scene) ? '' : scene].filter(Boolean).join('・') || (fallbackName ? e[1] : mode.label);
};
// 種類ごとのまとめ方。modes は開いたときの切り替えスイッチ（中身があるものだけ出す）、label は小さなボタンの文字
function enemyGroups(cat, rows) {
  if (cat === 0) {  // 夜の王：王ごと。通常／常夜
    const isEver = ([e]) => e[2].includes('常夜') || e[1] === '救いの旗手';
    return byKey(rows, e => e[4] || e[1]).map(([icon, items]) => {
      const named = items.filter(([e]) => LORD[icon] && e[1].includes(LORD[icon].name));
      const title = ((named.length ? named : items).find(([e]) => !e[2]) || (named.length ? named : items)[0])[0][1];
      return { key: icon, icon: LORD[icon] ? icon : null, title, items, label: labelOf(title, /^常夜・?/),
        modes: [{ id: 'normal', label: '通常', test: x => !isEver(x) }, { id: 'ever', label: '常夜', test: isEver }] };
    });
  }
  if (cat === 1) {  // 夜の強敵：戦いごと。本体／前哨戦。ボタンの文字が空になるときは敵の名前（例：無名の王）
    return byKey(rows, e => e[9]).map(([fight, items]) => ({ key: fight, title: fight, items, label: labelOf(fight, /.*戦$|^ティビアの呼び舟の/, /$^/, true),
      modes: [{ id: 'b', label: '夜の強敵', test: ([e]) => e[10] === 'b' }, { id: 'p', label: '前哨戦', test: ([e]) => e[10] === 'p' }] }))
      .sort((a, b) => (a.key === 'その他の前哨戦') - (b.key === 'その他の前哨戦'));
  }
  // フィールド・拠点・雑魚：名前ごと（武器などの違いはまとめる）。通常／災域（拠点の敵が強化される状態）。名前の五十音順
  const isShift = ([e]) => /災域/.test(e[1]) || e[2].includes('災域');
  return byKey(rows, e => baseName(e[1])).map(([title, items]) => ({ key: title, title, items, label: labelOf(title, /災域・?|・?災域/, /災域・?|・?災域/),
    modes: [{ id: 'normal', label: '通常', test: x => !isShift(x) }, { id: 'shift', label: '災域', test: isShift }] }))
    .sort((a, b) => jaSort.compare(a.title, b.title));
}
// 検索結果：同じ名前を1行にまとめ、中のボタンで「種類・場所」を選ぶ
function searchGroups(rows) {
  return byKey(rows, e => e[0] === 0 && e[4] ? 'lord:' + e[4] : baseName(e[1])).map(([key, items]) => {
    const lord = key.startsWith('lord:') ? key.slice(5) : null;
    const title = lord ? (items.find(([e]) => LORD[lord] && e[1].includes(LORD[lord].name)) || items[0])[0][1] : key;
    const cats = [...new Set(items.flatMap(([e]) => e[12]?.length ? e[12].map(([c]) => ENEMY_CATS[c]) : [ENEMY_CATS[e[0]]]))];
    return { key: 'q:' + key, title, icon: lord, sub: cats.join('・'), items,
      label: (e) => [cats.length > 1 ? ENEMY_CATS[e[0]] : '', shortName(e[1], title, /$^/), e[2]].filter(Boolean).join('・') || '通常',
      modes: [{ id: 'all', label: '', test: () => true }] };
  }).sort((a, b) => jaSort.compare(a.title, b.title));
}
function enemyPage(body, chip, q, list) {
  const E = S.enemy;
  return `<div class="stack-lg">
    <p class="hint data-src">数値は参考値です（Ver 1.02.3時点の有志の解析・DLC未対応）。</p>
    <div class="enemy-tools">
      <input type="search" id="enemy-q" data-enemyq value="${esc(E.q)}" placeholder="名前で探す（例：ガーゴイル）" enterkeyhint="search">
      ${q ? '' : `<div class="cat-tabs">${ENEMY_CATS.map((c, i) => chip('enemyCat', i, c, E.cat === i)).join('')}</div>`}
      <div class="filter-row">
        ${E.partyOpen
          ? `<div class="party-row"><span class="flag-label">人数</span>${[['solo', 'ソロ'], ['duo', 'デュオ'], ['trio', 'トリオ']].map(([v, l]) => chip('enemyParty', v, l, E.party === v)).join('')}</div>`
          : `<button class="party-toggle" data-act="enemyPartyOpen">人数：<b>${{ solo: 'ソロ', duo: 'デュオ', trio: 'トリオ' }[E.party]}</b><span class="chev"></span></button>`}
        ${!q && E.cat === 4 && !E.mobOpen ? `<button class="party-toggle" data-act="enemyMobOpen">種類：<b>${E.mob || 'すべて'}</b><span class="chev"></span></button>` : ''}
        ${!q && E.cat === 2 && !E.fieldOpen ? `<button class="party-toggle" data-act="enemyFieldOpen">種類：<b>${E.field || 'すべて'}</b><span class="chev"></span></button>` : ''}
        ${!q && E.cat === 3 && !E.baseOpen ? `<button class="party-toggle" data-act="enemyBaseOpen">拠点：<b>${E.base || 'すべて'}</b><span class="chev"></span></button>` : ''}
        ${!q && E.cat === 1 && !E.lordOpen ? `<button class="party-toggle" data-act="enemyLordOpen">夜の王：<b>${E.lord ? ico('lord', E.lord) + LORD[E.lord].name : 'すべて'}</b><span class="chev"></span></button>` : ''}
      </div>
      ${!q && E.cat === 4 && E.mobOpen ? `<div class="chips lord-filter">${['', ...headsOf(4)].map(t => chip('enemyMob', t, t || 'すべて', E.mob === t)).join('')}</div>` : ''}
      ${!q && E.cat === 2 && E.fieldOpen ? `<div class="chips lord-filter">${['', ...headsOf(2)].map(t => chip('enemyField', t, t || 'すべて', E.field === t)).join('')}</div>` : ''}
      ${!q && E.cat === 3 && E.baseOpen ? `<div class="chips lord-filter">${chip('enemyBase', '', 'すべて', !E.base)}${headsOf(3).map(t => chip('enemyBase', t, t, E.base === t)).join('')}</div>` : ''}
      ${!q && E.cat === 1 && E.lordOpen ? `<div class="chips lord-filter">${chip('enemyLord', '', 'すべて', !E.lord)}${LORDS.map(l => chip('enemyLord', l.id, ico('lord', l.id) + l.name, E.lord === l.id)).join('')}</div>` : ''}
    </div>
    ${q ? `<p class="hint">「${esc(q)}」の検索結果：${list.length}件</p>` : ''}
    ${body}
    <div class="hint source-note"><p>「Elden Ring Nightreign - PvE Stats（Calibrations Ver 1.02.3）」を参照。DLC未対応。更新をお待ちください。</p>
      <p>HPや崩し値の数値は不正確の可能性があります。参考程度としてください。</p>
      <p>数値や名前の誤りは<button class="link-btn" data-act="reportOpen">こちら</button>からお知らせください。</p></div>
  </div>`;
}
// 色分け（数値の色だけ変える）
// カット率：マイナス＝緑（弱点）、+1〜40%＝黄、41%以上＝赤、0%は白
const negTone = v => v == null || v === 0 ? '' : v < 0 ? 'good' : v <= 40 ? 'mid' : 'bad';
// 状態異常の耐性：154未満＝緑、154〜251＝黄、252〜539＝オレンジ、540以上＝赤、無効＝灰
const resTone = v => v == null ? 'immune' : v < 154 ? 'good' : v < 252 ? 'mid' : v < 540 ? 'orange' : 'bad';
// 1億以上のちょうどの数は「7億」のように短く書く（隠しの夜の王用。普通の敵の数値はそのまま）
const oku = v => typeof v === 'number' && Math.abs(v) >= 1e8 && v % 1e8 === 0 ? `${v / 1e8}億` : v;
function enemyDetail(e, p, merged = false) {
  const [, , , , , hp, neg, res, poise] = e;
  const h = hp[p];
  const secret = e === SECRET_ENEMY;
  // カット率：マイナスは弱点（よく効く）、高いほど効きにくい
  const negCell = (v, i) => { const lo = Array.isArray(v) ? v[0] : v;
    return `<div class="stat ${negTone(lo)}"><span>${NEG_LABELS[i]}</span><b>${v == null ? '–' : Array.isArray(v) ? `${v[0]}〜${v[1]}%` : oku(v) + '%'}</b></div>`; };
  // 状態異常耐性：低いほど早くかかる。null は無効
  const resCell = (v, i) => { const lo = Array.isArray(v) ? v[0] : v;
    return `<div class="stat ${resTone(lo)}"><span>${RES_LABELS[i]}</span><b>${v == null ? '無効' : Array.isArray(v) ? `${v[0]}〜${v[1] == null ? '無効' : v[1]}` : oku(v)}</b></div>`; };
  return `<div class="enemy-detail">
    <div class="enemy-kv"><span>HP</span><b>${e[0] === 0 ? fmtR(h[0], h[1]) : `1日目 ${fmtR(h[0], h[1])}${h[2] != null && (h[2] !== h[0] || h[3] !== h[1]) ? `／2日目 ${fmtR(h[2], h[3])}` : ''}`}</b></div>
    <div class="enemy-kv"><span>崩し値</span><b>${poise[p] == null ? '<span class="unknown">不明（データなし）</span>' : fmtPoise(poise[p])}</b></div>
    <div class="label">カット率<span class="hint">低いほど通りやすい（マイナスは弱点）</span></div>
    <div class="stat-grid g4">${neg.map(negCell).join('')}</div>
    <div class="label">状態異常の耐性<span class="hint">低いほどかかりやすい</span></div>
    <div class="stat-grid g4">${res.map(resCell).join('')}</div>
    ${secret ? '<button class="secret-img-btn" data-act="secretImage">画像を見る</button>' : ''}
    ${merged ? '<p class="hint merged-note">同じ名前・場所で数値が少し違う個体をまとめています。違う数値は「〜」の幅で表示しています。</p>' : ''}</div>`;
}

// タップで開閉する行。値が決まっていれば右側に表示する
function disc(key, label, value, body, disabled = false, defOpen = false) {
  const open = !disabled && (S.edit.open[key] ?? defOpen);
  return `<div class="disc ${open ? 'open' : ''}">
    <button class="disc-head" data-act="disc" data-v="${key}" data-open="${open}" aria-expanded="${open}" ${disabled ? 'disabled' : ''}>
      <span class="k">${label}</span><span class="v ${value.set ? 'set' : ''}">${value.html}</span><span class="chev"></span></button>
    ${open ? `<div class="disc-body">${body}</div>` : ''}</div>`;
}
function editPreset() {
  const p = S.edit.data;
  const fv = fitVessel(p);
  p.vesselId = fv?.id || null;  // 献器は遺物の色から自動で決める
  // 遺物の枠。効果は1行ずつ並べ、右端の×で、その効果だけをすぐ消せる（読み取りの間違いを直しやすく）
  const slot = (kind, i) => {
    const r = p[kind][i];
    const head = `<button class="slot-btn ${r ? 'filled' : ''}" data-act="openSlot" data-k="${kind}" data-v="${i}">
      <span class="slot-color ${kind === 'deep' ? 'deep' : ''} ${r ? 'c-' + r.color : 'c-none'}"></span>
      ${r ? `<span class="rname"><span>${relicName(r)}${r.check ? '<span class="badge check">要確認</span>' : ''}</span></span>` : `<span class="empty">空き（タップして遺物を入れる）</span>`}</button>`;
    if (!r) return head;
    const x = (j, w, label) => `<button class="eff-x" data-act="effX" data-k="${kind}" data-i="${i}" data-j="${j}" data-w="${w}" aria-label="${esc(label)}を消す">×</button>`;
    const line = (text, xBtn, cls = '') => `<li class="${cls}"><button class="eff-txt" data-act="openSlot" data-k="${kind}" data-v="${i}">${esc(text)}</button>${xBtn}</li>`;
    // 夜の王の遺物・固有遺物は効果が決まっているので、遺物の名前の右に「遺物ごと外す×」を1つだけ付ける
    const lines = r.special
      ? SPECIAL[r.special].effects.map(e => line(e, '')).join('')
      : r.effects.map((e, j) => !e ? '' : line(ALL_EFF[e]?.name ?? '', x(j, 'eff', ALL_EFF[e]?.name ?? '効果'))
        + (r.demerits?.[j] ? line(`↳ ${ALL_EFF[r.demerits[j]]?.name ?? ''}`, x(j, 'dem', ALL_EFF[r.demerits[j]]?.name ?? 'デメリット'), 'dem') : '')).join('');
    return `<div class="relic-box"><div class="relic-head">${head}${r.special ? x(0, 'relic', SPECIAL[r.special].name) : ''}</div><ul class="eff-lines">${lines || '<li class="none">効果未登録</li>'}</ul></div>`;
  };
  // スクショから読み取る（表・深層を1枚ずつ）
  const scanBtn = (kind, label) => S.edit.scanning === kind
    ? `<span class="ghost scan-btn busy">${label}を読み取り中…</span>`
    : `<label class="ghost scan-btn ${p.charId && !S.edit.scanning ? '' : 'disabled'}">${label}のスクショ<input type="file" accept="image/*" data-scan="${kind}" hidden ${p.charId && !S.edit.scanning ? '' : 'disabled'}></label>`;
  const scanCard = `<section class="card-sec scan-card"><div class="sec-head"><h2>スクショから読み取る</h2></div>
    <div class="scan-btns">${scanBtn('normal', '表')}${scanBtn('deep', '深層')}</div>
    <p class="hint">${p.charId ? 'ゲームの「遺物儀式」画面のスクショを、表（スロット1〜3を選んだ画面）と深層（スロット4〜6を選んだ画面）で1枚ずつ選ぶと、遺物を自動で入れます。' : '先に夜渡りを選んでください。'}</p>
    <button class="link-btn scan-sample" data-act="scanSample">📷 この画面です！（見本を見る）</button>
    <p class="hint scan-note">※ 端末の中で文字を読み取るので、とくに「＋」のあとの数字は間違っていることがあります。読み取ったあとは、ゲームの画面と見比べて確かめてください。</p></section>`;
  const styleName = p.style ? STYLES.find(x => x.id === p.style).name + ((p.spec || []).length ? `・${p.spec.join('/')}` : '') : '';
  const styleBody = `<div class="chips">${STYLES.map(x => `<button class="chip" data-act="eStyle" data-v="${x.id}" ${pressed(p.style === x.id)}>${x.name}</button>`).join('')}</div>
      ${p.style === 'caster' || p.style === 'hybrid' ? `<div class="subpanel"><div class="label">何特化？（複数選べます）</div>
        <div class="sub-group">魔術</div><div class="chips">${SPEC_SORC.map(x => `<button class="chip small" data-act="eSpec" data-v="${x}" ${pressed((p.spec || []).includes(x))}>${x}</button>`).join('')}</div>
        <div class="sub-group">祈祷</div><div class="chips">${SPEC_INC.map(x => `<button class="chip small" data-act="eSpec" data-v="${x}" ${pressed((p.spec || []).includes(x))}>${x}</button>`).join('')}</div></div>` : ''}`;
  const weaponBody = `<input type="text" id="e-wname" data-edit="weaponName" value="${esc(p.weaponName || '')}" placeholder="武器の名前（任意）例：月光の大剣">
      <div class="chips">${WEAPON_TYPES.map(x => `<button class="chip small" data-act="eWeapon" data-v="${x}" ${pressed(p.weaponType === x)}>${x}</button>`).join('')}</div>`;
  const val = (txt, set) => ({ html: `<span class="txt">${esc(txt)}</span>`, set });
  // 遺物の枠：埋まっている数と色を、畳んだ行の右側に出す
  const relicValue = kind => { const n = p[kind].filter(Boolean).length;
    return { html: `<span class="txt">${n}/3</span><span class="slots">${p[kind].map(r => `<span class="slot-dot ${kind === 'deep' ? 'deep' : ''} ${r ? 'c-' + r.color : ''}"></span>`).join('')}</span>`, set: n > 0 }; };
  const name = presetName(p);
  const nameRow = S.edit.editingName
    ? `<section class="card-sec"><div class="sec-head"><h2>プリセット名</h2></div>
        <input type="text" id="e-name" data-edit="name" value="${esc(name)}" placeholder="${esc(autoName(p))}">
        <div class="row-actions">${p.nameAuto ? '' : '<button class="ghost" data-act="nameAuto">自動の名前に戻す</button>'}<button class="ghost" data-act="nameDone">決定</button></div>
        <p class="hint">今の名前が入っています。消して空にすると「型 メイン武器」の自動の名前になります。</p></section>`
    : `<button class="name-row" data-act="nameEdit"><span class="k">プリセット名</span><span class="nm">${esc(name)}</span><span class="pen">${p.nameAuto ? '自動・変更' : '変更'}</span></button>`;
  BAR = '';
  return `<div class="stack-lg">
    <div class="page-title">${S.edit.isNew ? 'プリセットを作る' : 'プリセットを編集'}</div>
    ${disc('char', '夜渡り', p.charId ? { html: `${ico('char', p.charId)}<span class="txt">${CHAR[p.charId].name}</span>`, set: true } : val('未選択', false),
      `<div class="grid-btns">${CHARS.map(c => `<button class="tile-btn with-ico" data-act="eChar" data-v="${c.id}" ${pressed(p.charId === c.id)}>${charName(c.id)}</button>`).join('')}</div>`)}
    ${scanCard}
    ${p.charId ? disc('relicNormal', '表の遺物', relicValue('normal'), `<div class="section">${[0, 1, 2].map(i => slot('normal', i)).join('')}</div>`, false, true)
      + disc('relicDeep', '深層の遺物', relicValue('deep'), `<div class="section">${[0, 1, 2].map(i => slot('deep', i)).join('')}</div><p class="hint">深き夜で使う遺物です。</p>`, false, true)
      + `<p class="hint vessel-note">${[...p.normal, ...p.deep].some(Boolean) ? (fv ? `適合する献器：<b>${esc(fv.name)}</b>（遺物の色から自動で判定）` : '<span class="bad">この色の組み合わせに適合する献器がありません。遺物を見直してください。</span>') : '読み取らずに、枠をタップして手で入れることもできます。枠は空いたままでも保存できます。'}</p>` : ''}
    ${disc('style', '型', styleName ? val(styleName, true) : val('未設定', false), styleBody)}
    ${disc('weapon', 'メイン武器', p.weaponType ? val(p.weaponName ? `${p.weaponName}（${p.weaponType}）` : p.weaponType, true) : val('未設定', false), weaponBody)}
    ${nameRow}
    <section class="card-sec pub-card"><div class="sec-head"><h2>みんなに公開</h2><button class="ever-switch ${p.public ? 'on' : ''}" data-act="ePublic" aria-pressed="${!!p.public}">${p.public ? '公開する' : '公開しない'}</button></div>
      <p class="hint">公開すると、保存したときに「みんなのビルド」に載り、ほかの人が取り込めるようになります。作った人の名前などは出ません。不適切な言葉を含む名前・メモは公開できません。</p>
      ${p.public ? `<div class="neta-line"><span><b>ネタビルド</b><small>笑い・縛り・ロマン重視のビルドなら</small></span><button class="ever-switch ${p.neta ? 'on' : ''}" data-act="eNeta" aria-pressed="${!!p.neta}">${p.neta ? 'ネタ' : 'ふつう'}</button></div>
        <label class="label" for="e-pubnote">公開用のメモ（任意・200文字まで）</label>
        <textarea id="e-pubnote" data-edit="pubNote" maxlength="200" placeholder="例：出血で押し切る近接ビルド。深度3くらいまで安定">${esc(p.pubNote || '')}</textarea>` : ''}</section>
    <div class="form-actions"><button class="ghost" data-act="eCancel">キャンセル</button><button class="primary" data-act="eSave">保存する</button></div>
    ${S.edit.isNew ? '' : `<div class="row-actions" style="justify-content:center"><button class="ghost" data-act="eShare">共有する</button><button class="ghost" data-act="eDup">複製して新しく作る</button>${presetById(S.edit.data.id)?.imported ? '<button class="ghost" data-act="eMine">マイプリセットに移す</button>' : ''}<button class="ghost danger" data-act="eDel">${S.confirmDel === 'edit' ? 'もう一度押すと削除' : 'このプリセットを削除'}</button></div>`}
  </div>`;
}
function editSlot() {
  const { k, i, data: r, existed, mode } = S.edit.slot;
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
    <div class="eyebrow">${esc(S.edit.data.name || 'プリセット')} ／ ${k === 'deep' ? '深層の遺物' : '表の遺物'}の${i + 1}枠目</div>
    ${r.special ? specialCard(r) : `
    <section class="card-sec">
      <div class="relic-title"><span class="color-dot c-${r.color}"></span>${relicName(r)}</div>
      <div class="chips">${COLORS.map(c => canColor(c.id)
        ? `<button class="chip small" data-act="eColor" data-v="${c.id}" ${pressed(r.color === c.id)}><span class="color-dot c-${c.id}" style="width:10px;height:10px;vertical-align:0;margin-right:6px"></span>${c.word}</button>`
        : `<button class="chip small" disabled title="適合する献器がありません"><span class="color-dot c-${c.id}" style="width:10px;height:10px;vertical-align:0;margin-right:6px;opacity:.4"></span>${c.word}（適合する献器なし）</button>`).join('')}</div>
      <div class="section">${pairs.join('')}</div>
      <p class="hint">大きさ（壮大・端正・繊細）は効果の数で自動で決まります。${k === 'deep' ? 'デメリットは、付く効果・段階を選んだときだけ入力欄が出ます。' : ''}</p>
    </section>`}
    ${existed ? `<div class="row-actions" style="justify-content:center"><button class="ghost danger" data-act="eSlotClear">この枠を空にする</button></div>` : ''}
  </div>`;
}
// プリセット名は、自分で付けなければ「型 メイン武器」になる
function autoName(p) {
  const parts = [p.style && STYLES.find(x => x.id === p.style)?.name, p.weaponType].filter(Boolean);
  return parts.length ? parts.join(' ') : p.charId ? `${CHAR[p.charId].name}のビルド` : '名前なしのビルド';
}
const presetName = p => (p.nameAuto || !p.name?.trim()) ? autoName(p) : p.name;
function styleText(p) {
  const parts = [];
  if (p.style) parts.push(STYLES.find(x => x.id === p.style).name + ((p.spec || []).length ? `（${p.spec.join('・')}特化）` : ''));
  if (p.weaponType) parts.push(p.weaponName ? `${p.weaponName}（${p.weaponType}）` : p.weaponType);
  return parts.join('・');
}
function specialCard(r) {
  const x = SPECIAL[r.special];
  return `<section class="card-sec">
    <div class="relic-title"><span class="color-dot c-${x.color}"></span>${x.name}</div>
    <ul class="eff-list">${x.effects.map(e => `<li>${esc(e)}</li>`).join('')}</ul>
    <button class="ghost" data-act="pickSpecial">別の遺物・効果にする</button></section>`;
}
function specialPicker(mode, sc, r) {
  const charId = S.edit.data.charId;
  const list = SPECIALS.filter(x => x.type === mode && (mode === 'lord' || x.who === charId || x.who === 'any'));
  const ok = list.filter(specialOk), ng = list.filter(x => !specialOk(x));
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
// 下から出る画面（使い方・データ・効果選択など）を開いている間は、後ろの画面を固定してスクロールさせない
let lockY = null;
function lockScroll(on) {
  const b = document.body;
  if (on && lockY === null) {
    lockY = window.scrollY;
    Object.assign(b.style, { position: 'fixed', top: `-${lockY}px`, left: '0', right: '0', width: '100%' });
  } else if (!on && lockY !== null) {
    const y = lockY; lockY = null;
    Object.assign(b.style, { position: '', top: '', left: '', right: '', width: '' });
    window.scrollTo(0, y);
  }
}
// 画面の一番上へ（後ろを固定している間は、閉じたときに一番上へ戻す）
function scrollTop() { if (lockY !== null) lockY = 0; else window.scrollTo(0, 0); }
// 遺物の編集を閉じて、プリセットの画面の「開く前にいた位置」へ戻す（一番上に戻らないように）。画面を描き直したあとに動かす
let pendingY = null;
function leaveSlot() { const y = S.edit.slotY ?? 0; S.edit.slot = null; if (lockY !== null) lockY = y; else pendingY = y; }
function renderSheet() {
  const el = document.getElementById('sheet'), keep = S.sheet?.type === 'import' && el.dataset.type === 'import' ? el.querySelector('.sheet-list')?.scrollTop : null;
  renderSheetInner();
  if (keep != null) { const l = el.querySelector('.sheet-list'); if (l) l.scrollTop = keep; }
  el.dataset.type = S.sheet?.type || '';
}
function renderSheetInner() {
  const el = document.getElementById('sheet');
  const sh = S.sheet;
  lockScroll(!!sh);
  if (!sh) { el.innerHTML = ''; return; }
  if (sh.type === 'menu') { el.innerHTML = menuSheet(); return; }
  if (sh.type === 'guide') { el.innerHTML = guideSheet(); return; }
  if (sh.type === 'help') { el.innerHTML = helpSheet(); return; }
  if (sh.type === 'import') { el.innerHTML = importSheet(); return; }
  if (sh.type === 'report') { el.innerHTML = reportSheet(); return; }
  if (sh.type === 'request') { el.innerHTML = requestSheet(); return; }
  if (sh.type === 'privacy') { el.innerHTML = privacySheet(); return; }
  if (sh.type === 'news') { el.innerHTML = newsSheet(); return; }
  if (sh.type === 'gacha') { el.innerHTML = gachaSheet(); return; }
  if (sh.type === 'restore') { el.innerHTML = restoreSheet(); return; }
  // 隠しの夜の王の画像を画面いっぱいに出す（どこをタップしても閉じる）
  if (sh.type === 'scanSample') { el.innerHTML = `<div class="img-view sample-view" data-act="sClose" role="dialog" aria-label="スクショの見本">
    <div class="sample-list">
      <figure><figcaption>表（スロット1〜3のどれかを選んだ画面）</figcaption><img src="icons/scan/sample-normal.webp" alt="表のスクショの見本"></figure>
      <figure><figcaption>深層（スロット4〜6のどれかを選んだ画面）</figcaption><img src="icons/scan/sample-deep.webp" alt="深層のスクショの見本"></figure>
      <p class="hint">ゲームのスクショ機能で撮った画像を、切り取らずにそのまま選んでください。</p>
    </div><span>タップで閉じる</span></div>`; return; }
  if (sh.type === 'image') { el.innerHTML = `<div class="img-view" data-act="sClose" role="dialog" aria-label="ゲーミングリブラの画像"><img src="${SECRET_IMAGE}" alt="ゲーミングリブラ"><span>タップで閉じる</span></div>`; return; }
  const isDem = sh.kind === 'demerits';
  const deep = S.edit.slot.k === 'deep';
  const specialCats = !isDem && !deep ? [['__lord', '夜の王の遺物'], ['__char', '固有遺物']] : [];
  const current = S.edit.slot.data[sh.kind][sh.idx];
  const charName = S.edit.data.charId ? CHAR[S.edit.data.charId].name : null;
  // キャラ固有の効果は、プリセットの夜渡りの分だけ出す
  const fams = (isDem ? DEMERIT_FAMS : deep ? DEEP_FAMS : NORMAL_FAMS).filter(f => !f.charName || f.charName === charName);
  const cats = catsOf(fams);
  const q = (sh.q || '').trim();
  const items = fams.filter(f => (!sh.cat || f.cat === sh.cat) && (!q || f.name.includes(q) || f.levels.some(e => e.name.includes(q))));
  const head = isDem ? 'デメリットを選ぶ' : deep ? '深層の効果を選ぶ' : '表の効果を選ぶ';
  // 大項目は同じ幅のボタンを5列で並べる（スクロールなし）
  const catItems = [['', 'すべて'], ...cats.map(c => [c, c]), ...specialCats];
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
  const list = sh.cat && sh.cat.startsWith('__') ? specialRows(sh.cat === '__lord' ? 'lord' : 'char') :
    `<button class="pick" data-act="sPickEff" data-v=""><span style="color:var(--dim)">外す</span></button>` +
    (items.length ? items.map(row).join('') : `<p class="hint">見つかりません</p>`);
  el.innerHTML = `<div class="scrim" data-act="sClose"></div><div class="sheet" role="dialog" aria-label="${head}">
    <div class="sheet-head"><h2>${head}</h2><button class="ghost" data-act="sClose">閉じる</button></div>
    ${tools}<div class="sheet-list" id="sheet-list">${list}</div></div>`;
}

// 夜の王の遺物・固有遺物は、選ぶだけでその枠に決まる
function specialRows(type) {
  const { k, i, data: r } = S.edit.slot;
  const charId = S.edit.data.charId;
  const list = SPECIALS.filter(x => x.type === type && (type === 'lord' || x.who === charId || x.who === 'any'));
  const ok = list.filter(specialOk), ng = list.filter(x => !specialOk(x));
  const who = x => type === 'lord' ? LORD[x.who].name : x.who === 'any' ? '共通' : CHAR[x.who].name;
  return (ok.length ? ok.map(x => `<button class="pick special-pick" data-act="sPickSpecial" data-v="${x.id}" ${pressed(r.special === x.id)}>
      <span class="sp-main"><span class="sp-name"><span class="color-dot c-${x.color}"></span>${x.name}<span class="badge">${who(x)}</span></span>
      <small>${x.effects.map(esc).join('・')}</small></span></button>`).join('')
    : `<p class="hint">適合する献器がある${type === 'lord' ? '夜の王の' : '固有'}遺物はありません</p>`)
    + (ng.length ? `<p class="hint" style="padding:8px">適合する献器がないため選べない：${ng.map(x => x.name).join('、')}</p>` : '');
}
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null;  // Android Chrome の「インストール」ボタン用
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (S.sheet?.type === 'guide') renderSheet(); });
function guideSheet() {
  const installed = isStandalone();
  const step = (n, title, body) => `<div class="guide-step"><span class="num">${n}</span><div><b>${title}</b><p class="hint">${body}</p></div></div>`;
  const install = installed
    ? `<div class="guide-ok">✓ ホーム画面から開いています</div>`
    : isIOS
      ? step(1, 'ホーム画面に追加する', 'Safariの下にある共有ボタン（□に↑）→「ホーム画面に追加」。<br><b>追加しないと、しばらく開かなかったときに記録が消えることがあります。</b>Safariとホーム画面のアプリは記録が別々なので、追加したあとはホーム画面から開いてください。')
      : step(1, 'ホーム画面に追加する', `ブラウザのメニュー →「ホーム画面に追加」または「アプリをインストール」。アプリのように全画面で使えます。${installPrompt ? '<br><button class="ghost" data-act="install" style="margin-top:6px">今すぐ追加する</button>' : ''}`);
  return `<div class="scrim" data-act="guideClose"></div><div class="sheet guide" role="dialog" aria-label="はじめに">
    <div class="sheet-head"><h2>夜渡り日記へようこそ</h2></div>
    <div class="sheet-list guide-list">
      <p class="hint">ナイトレインの戦績を記録して、夜の王・夜渡り・ビルドごとの勝率を振り返るアプリです。<b>まずは「記録」タブだけ使えばOK</b>。ビルド・敵・みんなの統計は、気になったときにどうぞ。</p>
      ${install}
      ${step(installed ? 1 : 2, '戦績を記録する', '「記録」タブで、夜の王と夜渡り（スクロールして真ん中に合わせる。夜の王は最初グラディウス）・通常か常夜かを選んで、画面の下の「勝利」か「敗北」を押すだけ。ビルドは、夜渡りごとに前回使ったものが自動で選ばれます。')}
      ${step(installed ? 2 : 3, '記録は自動でバックアップ', '記録は自動で暗号化して、ネット上にも保存されます。機種変更のときは、右上の円柱の絵のボタン（データ）に出ている「引き継ぎコード」で戻せます。')}
      <button class="ghost" data-act="restoreOpen">機種変更した方：引き継ぎコードで戻す</button>
    </div>
    <button class="primary" data-act="guideClose">はじめる</button></div>`;
}
// 「このタブの使い方」：今いるタブでできることと、開発者からの一言（文章は src/data/help.js）
function helpSheet() {
  const h = HELP[S.tab], head = S.tab === 'kotsubo' ? `「${h.title}」の遊び方` : `「${h.title}」タブの使い方`;
  return `<div class="scrim" data-act="sClose"></div><div class="sheet help" role="dialog" aria-label="${head}">
    <div class="sheet-head"><h2>${head}</h2><button class="ghost" data-act="sClose">閉じる</button></div>
    <div class="sheet-list help-list">
      <ul class="help-points">${h.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
      ${h.dev ? `<div class="dev-note"><b>開発者より</b><p>${esc(h.dev)}</p></div>` : ''}
    </div></div>`;
}
function cloudBox() {
  const cl = cloud();
  if (!cl.on) return `<div class="cloud-box off"><b>自動バックアップ：オフ</b><p class="hint">オンにすると、記録が自動でネット上に保存され、機種変更のときに引き継ぎコードで戻せます。</p>
    <button class="primary" data-act="cloudOn">オンにする</button></div>`;
  const status = cl.failed ? '<span class="bad">保存できませんでした（自動でやり直します）</span>' : `最後の保存：${agoText(cl.savedAt)}`;
  return `<div class="cloud-box compact"><div class="cloud-head"><b>自動バックアップ：オン</b><span class="hint">${status}</span></div>
    <div class="code-row"><span class="code" aria-label="引き継ぎコード">${esc(cl.code)}</span><button class="ghost small" data-act="codeCopy">${navigator.share ? '送る' : 'コピー'}</button></div>
    <div class="cloud-foot"><span class="hint">機種変更のときはこのコードで戻せます（なくすと戻せません）</span>
      ${cl.confirmed ? '<span class="hint ok">✓ 控え済み</span>' : '<button class="link-btn" data-act="codeConfirm">控えた</button>'}
      <button class="link-btn ${S.confirmDel === 'cloudOff' ? 'danger-text' : 'dim-link'}" data-act="cloudOff">${S.confirmDel === 'cloudOff' ? 'もう一度押すとオフ' : 'オフにする'}</button></div></div>`;
}
function menuSheet() {
  const n = liveRuns().length;
  const item = (act, title, sub, cls = '') => `<button class="pick ${cls}" data-act="${act}"><span><b>${title}</b><br><span class="hint">${sub}</span></span><span class="cat">›</span></button>`;
  return `<div class="scrim" data-act="sClose"></div><div class="sheet" role="dialog" aria-label="データ管理">
    <div class="sheet-head"><h2>データ管理</h2><button class="ghost" data-act="sClose">閉じる</button></div>
    <div class="sheet-list">
      <div class="sub-group">バックアップ</div>
      ${cloudBox()}
      ${item('restoreOpen', '引き継ぎコードで戻す', '機種変更した・アプリを入れ直したときに、前のデータを戻します')}
      <details class="spare"><summary>予備のバックアップ（ファイル）</summary>
        <p class="hint">念のため、ファイルでも手元に残せます。引き継ぎコードをなくしたときの備えです。</p>
        ${item('exportJson', 'ファイルに保存', `最後に保存：${backupAgo(backupState())}`)}
        <label class="pick" for="importFile"><span><b>ファイルから戻す</b><br><span class="hint">今のデータは、ファイルの内容に置き換わります</span></span><span class="cat">›</span></label>
        <input type="file" id="importFile" accept="application/json,.json" hidden></details>
      <div class="sub-group">共有・連絡</div>
      ${item('shareApp', '夜渡り日記を共有する', 'アプリのURLをコピーして、友だちに送れます')}
      ${item('requestOpen', '機能の実装リクエスト', '「こんな機能がほしい」を開発者に送れます')}
      <div class="sub-group">その他</div>
      ${item('guide', '使い方・ホーム画面に追加', 'はじめに出た案内をもう一度見る')}
      ${item('newsOpen', `アップデート情報${newsUnseen() ? '<span class="badge new">NEW</span>' : ''}`, `いつ、どんな機能が増えたか（最新：${CHANGELOG[0]?.v || ''}）`)}
      ${item('privacyOpen', 'プライバシーについて', '何を保存・送信しているか、消し方など')}
      <p class="hint" style="padding:0 4px">この端末の記録：戦績 ${n}件・プリセット ${activePresets().length}件</p>
      ${item('exportCsv', 'CSVで書き出す', '戦績をExcelなどで開ける形にします')}
      ${DEV_HOST ? item('loadSample', S.confirmDel === 'sample' ? 'もう一度押すとサンプルに置き換えます' : 'サンプルデータを入れる', '（開発用）今のデータは消えて、試し用の戦績64件とプリセット3件になります', S.confirmDel === 'sample' ? 'danger' : '') : ''}
      ${item('wipe', S.confirmDel === 'wipe' ? 'もう一度押すとすべて削除します' : 'すべてのデータを削除', '戦績とプリセットをすべて消します。元に戻せません', 'danger')}
    </div></div>`;
}
function replaceDb(next) {
  const was = db.prefs.online, wasCloud = db.prefs.cloud;
  db.runs = next.runs; db.relics = next.relics; db.presets = next.presets; db.prefs = next.prefs || {};
  if (was) {  // 参加の状態と端末の番号はこの端末のものを引き継ぎ、なくなった戦績は「消した」扱いで送る
    const keep = new Set(db.runs.map(r => r.id));
    const gone = Object.keys(was.sent || {}).filter(id => !keep.has(id));
    db.prefs.online = { join: was.join, id: was.id, sent: {}, pendingDelete: [...new Set([...(was.pendingDelete || []), ...gone])] };
  }
  if (wasCloud) db.prefs.cloud = { ...wasCloud, sig: '' };  // 引き継ぎコードは端末のもの。中身が変わったので次の機会に保存し直す
  S.edit = null; S.openRun = null; S.form = blankForm();
}
function csvRows() {
  const rows = [['日付', '夜の王', '常夜', '地図欠損など', 'モード', '深度', '人数', '夜渡り', '結果', '倒れた場所', 'ビルド', 'メモ']];
  liveRuns().sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt - b.updatedAt).forEach(r => rows.push([
    r.date, LORD[r.lordId]?.name ?? r.lordId, r.everdark ? '常夜' : '', (r.flags || []).map(x => flagName(x, r)).join('/'), MODE[r.mode]?.name ?? r.mode, r.depth ?? '', PARTYM[r.party]?.name ?? r.party,
    CHAR[r.charId]?.name ?? r.charId, r.result === 'win' ? '勝利' : '敗北', r.lossAt ? LOSS[r.lossAt].name : '', presetById(r.presetId) ? presetLabel(presetById(r.presetId)) : (r.presetId ? '削除済み' : ''),
    r.note]));
  return rows;
}

// ---------- render ----------
// タブのアイコンは icons/tabs/<id>.png（tools/make_app_icons.py で Images/ の絵から作る）
const TABS = [{ id: 'record', name: '記録' }, { id: 'history', name: '履歴' }, { id: 'stats', name: '統計' }, { id: 'builds', name: 'ビルド' }, { id: 'enemies', name: '知識', icon: 'knowledge' }];  // 「知識」タブ（中身は knowledge.js。id は昔の「敵」タブのまま）
// ミニゲーム「遺物を求める者」は、下のタブには出さない。タイトルの右の小壺を押した人だけが入れる（S.tab が 'kotsubo'）
function appSub() {
  const runs = liveRuns();
  if (S.tab === 'enemies') return knowledgeSub();
  if (S.tab === 'kotsubo') return kotsuboSub();
  if (S.tab === 'record') { const t = rate(runs.filter(r => r.date === today())); return t.n ? `今日 ${t.n}戦 ${t.w}勝 ${t.n - t.w}敗` : '今日の夜を記録する'; }
  if (S.tab === 'history') return runs.length ? `${runs.length}戦の記録` : 'まだ記録がありません';
  if (S.tab === 'stats') { const a = rate(runs); return a.n ? `通算 ${a.n}戦・勝率 ${pct(a.p)}` : 'まだ記録がありません'; }
  return `プリセット ${activePresets().length}件`;
}
// 画面を作り直すときに、入力中の欄（keepId）だけはそのまま残し、周りだけ入れ替える。
// iPhone の日本語キーボードは、変換中に入力欄が入れ替わると文字が二重になったり順番が崩れたりするため
function patchKeeping(root, html, keepId) {
  const tpl = document.createElement('template'); tpl.innerHTML = html;
  const live = document.getElementById(keepId), fresh = tpl.content.getElementById(keepId);
  const depth = (n, top) => { let d = 0; while (n && n !== top) { n = n.parentNode; d++; } return n === top ? d : -1; };
  if (!live || !fresh || depth(live, root) < 0 || depth(live, root) !== depth(fresh, tpl.content)) { root.innerHTML = html; return; }
  let l = live, f = fresh;
  while (l !== root) {
    const lp = l.parentNode, fp = f.parentNode;
    const before = [], after = [];
    for (let n = fp.firstChild; n !== f; n = n.nextSibling) before.push(n);
    for (let n = f.nextSibling; n; n = n.nextSibling) after.push(n);
    while (l.previousSibling) l.previousSibling.remove();
    while (l.nextSibling) l.nextSibling.remove();
    l.before(...before); l.after(...after);
    if (lp !== root) {
      [...lp.attributes].forEach(a => { if (!fp.hasAttribute(a.name)) lp.removeAttribute(a.name); });
      [...fp.attributes].forEach(a => lp.setAttribute(a.name, a.value));
    }
    l = lp; f = fp;
  }
}
function render(keepId) {
  document.getElementById('tabs').innerHTML = TABS.map(t => `<button data-act="tab" data-v="${t.id}" ${S.tab === t.id ? 'aria-current="page"' : ''}><span class="tab-ico" style="-webkit-mask-image:url('icons/tabs/${t.icon || t.id}.png');mask-image:url('icons/tabs/${t.icon || t.id}.png')" aria-hidden="true"></span>${t.name}</button>`).join('');
  BAR = '';
  const moving = Object.fromEntries([...document.querySelectorAll('.wheel')].filter(w => w._moving).map(w => [w.dataset.wheel, w._target ?? w.scrollTop]));  // タップで動かしている途中なら、行き先へ
  const v = { record: viewRecord, history: viewHistory, stats: viewStats, builds: viewBuilds, enemies: viewKnowledge, kotsubo: viewKotsubo }[S.tab];
  if (keepId) patchKeeping(document.getElementById('view'), v(), keepId);
  else document.getElementById('view').innerHTML = v();
  if (S.tab === 'record') { initWheels(moving); initDateStrip(); }
  if (S.tab === 'enemies') initWheels(moving);  // 知識タブのボス不明チェッカー
  // みんなの統計：選んでいる分析のタブが見える位置まで、タブの列を横に動かす
  { const tb = document.querySelector('.g-tabs'), on = tb?.querySelector('[aria-selected="true"]');
    if (on) { const x = on.getBoundingClientRect().left - tb.getBoundingClientRect().left + tb.scrollLeft; if (x < tb.scrollLeft || x + on.offsetWidth > tb.scrollLeft + tb.clientWidth) tb.scrollLeft = x - (tb.clientWidth - on.offsetWidth) / 2; } }
  document.getElementById('appsub').textContent = appSub();
  // 右上のボタンは「（今のタブ名）の使い方」
  const helpLabel = document.querySelector('[data-act=help] span');
  // 幅の狭いスマホでは「使い方」だけにして、タイトル横の小壺の場所をあける
  if (helpLabel) helpLabel.textContent = S.tab === 'kotsubo' ? '遊び方' : innerWidth < 400 ? '使い方' : `${TABS.find(t => t.id === S.tab)?.name ?? ''}の使い方`;
  document.querySelector('[data-act=menu]')?.classList.toggle('due', backupState().due || codeNoticeDue() || newsUnseen());
  document.getElementById('actionbar').innerHTML = BAR ? `<div class="action-bar"><div class="in">${BAR}</div></div>` : '';
  document.querySelector('.app').classList.toggle('has-bar', !!BAR);
  renderSheet();
  if (pendingY !== null && lockY === null) { window.scrollTo(0, pendingY); pendingY = null; }
  syncDraft();
  save(db);
  if (prefs().online?.join || prefs().online?.pendingDelete?.length) scheduleSync();
  if (cloud().on) scheduleCloud();
}
// プリセットの作りかけ（編集中のもの）は、操作のたびに prefs().draft に残す。別のタブへ行ったり、アプリが閉じたりしても、
// ビルドタブの「未完成」から続きを再開できる。何も選んでいない新規や、保存済みから何も変えていない編集は残さない
function syncDraft() {
  const ed = S.edit;
  if (!ed || ed.type !== 'preset') return;
  const d = ed.data;
  const worth = ed.isNew ? !!(d.charId || d.style || d.weaponType || d.weaponName || (!d.nameAuto && d.name)) : JSON.stringify(d) !== JSON.stringify(presetById(d.id));
  if (worth) prefs().draft = ed; else if (prefs().draft?.data.id === d.id) delete prefs().draft;
}
let toastTimer;
// action を渡すと、通知の右側にボタンが付く（例：取り消す）
function toast(msg, action) {
  const el = document.getElementById('toast');
  el.innerHTML = `<div class="toast ${action ? 'with-action' : ''}" role="status"><span>${esc(msg)}</span>${action ? `<button class="toast-btn" data-act="${action.act}">${action.label}</button>` : ''}</div>`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.innerHTML = ''; if (action) S.undo = null; }, action ? 6000 : 1800);
}

// ---------- events ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act, v = t.dataset.v, f = S.form;
  if (a !== 'delRun' && a !== 'eDel' && a !== 'loadSample' && a !== 'wipe' && a !== 'draftDel' && a !== 'newPreset' && a !== 'onlineLeave' && a !== 'cloudOff' && a !== 'buildReport') S.confirmDel = null;
  switch (a) {
    case 'tab': if (v === 'enemies' && S.tab === v && S.know) S.know.topic = '';  // 知識タブを開いているときにもう一度押すと、項目の一覧に戻る
      if (S.edit && v !== 'builds') S.edit = null; S.tab = v; S.sheet = null; S.lossPick = false; scrollTop(); break;  // 作りかけは prefs().draft に残っている
    case 'kotsuboOpen': if (S.tab === 'kotsubo') return; if (S.edit) S.edit = null; S.kotsuboFrom = S.tab; S.tab = 'kotsubo'; S.sheet = null; startKotsubo(); scrollTop(); break;
    case 'kotsuboBack': S.tab = S.kotsuboFrom || 'record'; scrollTop(); break;
    case 'menu': S.sheet = { type: 'menu' }; break;
    case 'help': S.sheet = { type: 'help' }; break;
    case 'secretImage': S.sheet = { type: 'image' }; break;
    case 'scanSample': S.sheet = { type: 'scanSample' }; break;
    case 'guide': S.sheet = { type: 'guide' }; break;
    case 'guideClose': prefs().onboarded = true; if (CHANGELOG[0]) prefs().seenNews = CHANGELOG[0].v; S.sheet = null; break;  // はじめての人には、今の版をもう見たことにする
    case 'install': installPrompt?.prompt(); installPrompt = null; return;
    case 'exportJson':
      exportJson(db).then(res => {
        if (res === 'cancelled') { toast('保存をやめました'); return; }
        prefs().lastBackupAt = Date.now(); prefs().lastBackupRuns = liveRuns().length; prefs().backupSnoozeUntil = 0;
        render(); toast(res === 'shared' ? 'バックアップを渡しました' : 'バックアップを保存しました');
      });
      return;
    case 'backupLater': prefs().backupSnoozeUntil = Date.now() + 7 * 864e5; toast('7日後にまたお知らせします'); break;
    case 'exportCsv': exportCsv(csvRows()).then(res => toast(res === 'cancelled' ? '書き出しをやめました' : 'CSVを書き出しました')); return;
    case 'loadSample':
      if (!DEV_HOST) return;
      if (S.confirmDel !== 'sample') { S.confirmDel = 'sample'; break; }
      replaceDb(seed()); db.runs.forEach(r => { r.sample = true; }); S.confirmDel = null; S.sheet = null; toast('サンプルデータを入れました'); break;
    case 'wipe':
      if (S.confirmDel !== 'wipe') { S.confirmDel = 'wipe'; break; }
      replaceDb({ runs: [], relics: [], presets: [] }); S.confirmDel = null; S.sheet = null; toast('すべてのデータを削除しました'); break;
    case 'pickDate': { const d = v === 'today' ? today() : v; f.date = d; f.dateMode = d === today() ? 'today' : 'pick'; if (v === 'today') S.dayStripX = 0; break; }
    case 'wheelPick': { const w = t.closest('.wheel'); if (w) w._target = +t.dataset.i * WHEEL_H; if (w) w.scrollTo({ top: +t.dataset.i * WHEEL_H, behavior: 'smooth' }); return; }  // タップしたものを真ん中へ（止まったら選ばれる）
    case 'everdark': f.everdark = v === 'yes'; if (!lordsFor(f.everdark).some(l => l.id === f.lordId)) f.lordId = DEFAULT_LORD; break;  // 常夜にいない夜の王を選んでいたら、グラディウスに戻す
    case 'flag':
      if (f.flags.includes(v)) f.flags = f.flags.filter(x => x !== v);
      // 「地図欠損」と「ボス不明」はどちらか一方だけ。地変はどちらとも一緒に選べる
      else { const rival = { mapLoss: 'bossUnknown', bossUnknown: 'mapLoss' }[v]; f.flags = [...f.flags.filter(x => x !== rival), v]; }
      if (!f.flags.includes('shift')) f.shift = null;
      break;
    case 'shift': f.shift = f.shift === v ? null : v; break;
    case 'result': f.result = v; if (v === 'win') f.lossAt = null; break;
    case 'lossAt': f.lossAt = f.lossAt === v ? null : v; break;
    case 'mode': f.mode = v; f.depth = v === 'deep' ? (f.depth || prefs().lastDepth || null) : null; if (!S.editRun) { prefs().mode = v; prefs().depth = f.depth; } break;
    case 'depth': f.depth = +v; if (!S.editRun) { prefs().depth = f.depth; prefs().lastDepth = f.depth; } break;
    case 'party': f.party = v; if (!S.editRun) prefs().party = v; break;
    case 'preset': f.presetId = v || null; if (!S.editRun) (prefs().presetByChar ||= {})[f.charId] = f.presetId; break;
    case 'recWin': case 'recLoss': {
      const miss = recMissing(f);
      if (miss.length) { toast(`先に「${miss.join('・')}」を選んでください`); return; }
      if (a === 'recLoss') { S.lossPick = true; break; }
      f.result = 'win'; f.lossAt = null; saveRecord(); break;
    }
    case 'recLossAt': f.result = 'loss'; f.lossAt = v; S.lossPick = false; saveRecord(); break;
    case 'recLossBack': S.lossPick = false; break;
    case 'noteOpen': S.noteOpen = true; render(); document.getElementById('f-note')?.focus(); return;
    case 'save': saveRecord(); break;
    case 'editRun': {
      const r = db.runs.find(x => x.id === v);
      S.editRun = r.id;
      S.form = { dateMode: 'pick', date: r.date || today(), lordId: r.lordId, everdark: !!r.everdark, flags: [...(r.flags || [])], shift: r.shift ?? null, mode: r.mode || 'normal', depth: r.depth ?? null,
        party: r.party || 'trio', charId: r.charId, result: r.result, lossAt: r.lossAt ?? null, presetId: r.presetId ?? null, origPresetId: r.presetId ?? null, note: r.note || '' };
      S.tab = 'record'; S.openRun = null; S.dayStripX = null; scrollTop(); break;
    }
    case 'cancelEdit': S.editRun = null; S.form = blankForm(); S.tab = 'history'; break;
    case 'openRun': S.openRun = S.openRun === v ? null : v; break;
    case 'delRun':
      if (S.confirmDel !== v) { S.confirmDel = v; break; }
      { const r = db.runs.find(r => r.id === v); r.deleted = true; r.updatedAt = Date.now(); } S.confirmDel = null; S.openRun = null;
      S.undo = { type: 'del', id: v }; toast('削除しました', { act: 'undo', label: '元に戻す' }); break;
    case 'hf': S.hist.result = v; S.openRun = null; break;
    case 'hfClear': S.hist = { result: 'all', lord: '', char: '' }; S.openRun = null; break;
    case 'sf': S.stats[t.dataset.k] = v; break;
    case 'drill': S.stats.drill[t.dataset.k] = v; scrollTop(); break;
    case 'undrill': delete S.stats.drill[v]; break;
    case 'undrillAll': S.stats.drill = {}; break;
    case 'heatBy': S.stats.heatBy = v; break;
    case 'statsScope': S.stats.scope = v; scrollTop(); break;
    case 'statToggle': { const h = statHidden(); if (h[v]) delete h[v]; else h[v] = true; break; }
    case 'lordSort': S.stats.lordSort = v; break;
    case 'gEver': S.stats.gEver = !S.stats.gEver; S.stats.gOpen = null; S.stats.gCell = null; break;
    case 'gTab': S.stats.gTab = v; S.stats.gOpen = null; break;
    case 'gSort': S.stats.gSort = v; break;
    case 'gMin': S.stats.gMin = v; break;
    case 'gOpen': S.stats.gOpen = S.stats.gOpen === v ? null : v; break;
    case 'gCell': S.stats.gCell = S.stats.gCell === v ? null : v; break;
    case 'statJump': { const h = [...document.querySelectorAll('.card-sec h2')].find(x => x.textContent === v); if (h) window.scrollTo({ top: h.closest('.card-sec').getBoundingClientRect().top + window.scrollY - 76, behavior: 'smooth' }); if (!h) toast('この条件では、その表はありません'); return; }
    case 'enemyRetry': S.enemy.failed = false; S.enemy.retry = (S.enemy.retry || 0) + 1; break;
    case 'globalRetry': resetGlobal(); Object.values(GLOBALS).forEach(x => { x.failed = false; }); break;
    case 'gPeriod': S.stats.gPeriod = v; if (v === 'custom' && !S.stats.gTo) S.stats.gTo = today(); break;
    case 'undo': { const u = S.undo; S.undo = null; document.getElementById('toast').innerHTML = ''; clearTimeout(toastTimer);
      const r = u && db.runs.find(x => x.id === u.id); if (!r) return;
      r.deleted = u.type === 'add'; r.updatedAt = Date.now(); if (u.type === 'del') r.editedAt = Date.now();
      toast(u.type === 'add' ? '記録を取り消しました' : '戦績を元に戻しました'); break; }
    case 'enemyCat': S.enemy.cat = +v; S.enemy.open = null; S.enemy.limit = ENEMY_PAGE; break;
    case 'enemyParty': S.enemy.party = v; S.enemy.partyOpen = false; break;
    case 'enemyPartyOpen': S.enemy.partyOpen = true; break;
    case 'enemyLordOpen': S.enemy.lordOpen = true; break;
    case 'enemyBaseOpen': S.enemy.baseOpen = true; break;
    case 'enemyFieldOpen': S.enemy.fieldOpen = true; break;
    case 'enemyMobOpen': S.enemy.mobOpen = true; break;
    case 'enemyMob': S.enemy.mob = v; S.enemy.mobOpen = false; S.enemy.open = null; break;
    case 'enemyField': S.enemy.field = v; S.enemy.fieldOpen = false; S.enemy.open = null; break;
    case 'enemyBase': S.enemy.base = v; S.enemy.baseOpen = false; S.enemy.open = null; break;
    case 'enemyLord': S.enemy.lord = v; S.enemy.lordOpen = false; S.enemy.open = null; break;
    case 'enemySec': S.enemy.closed[v] = !S.enemy.closed[v]; break;
    case 'enemyOpen': { S.enemy.anchor = { v, top: t.getBoundingClientRect().top }; const k = v.startsWith('g:') ? v : +v; S.enemy.open = S.enemy.open === k ? null : k; S.enemy.sub = null; S.enemy.mode = 'normal'; break; }
    case 'enemySub': S.enemy.sub = +v; break;
    case 'enemyMode': S.enemy.mode = v; S.enemy.sub = null; break;
    case 'enemyMore': S.enemy.limit += ENEMY_PAGE; break;
    case 'statsMore': (S.statsMore ||= {})[v] = true; break;
    case 'bv': S.buildView = v; break;
    case 'draftResume': S.edit = prefs().draft; S.confirmDel = null; scrollTop(); break;
    case 'draftDel': if (S.confirmDel !== 'draft') { S.confirmDel = 'draft'; break; } delete prefs().draft; S.confirmDel = null; toast('未完成のプリセットを破棄しました'); break;
    case 'newPreset': if (prefs().draft && S.confirmDel !== 'newPreset') { S.confirmDel = 'newPreset'; break; } S.confirmDel = null; S.edit = { type: 'preset', isNew: true, open: { char: true }, data: { id: uid(), name: '', nameAuto: true, charId: null, vesselId: null, normal: [null, null, null], deep: [null, null, null] } }; scrollTop(); break;
    case 'editPreset': S.edit = { type: 'preset', open: {}, data: structuredClone(presetById(v)) }; scrollTop(); break;
    case 'eChar': {
      const d = S.edit.data; d.charId = v; S.edit.open.char = false;  // 遺物はそのまま。献器は遺物の色から自動で決め直す
      break;
    }
    case 'eVessel': {
      const d = S.edit.data; d.vesselId = v; S.edit.open.vessel = false;
      let removed = 0;
      ['normal', 'deep'].forEach(k => { d[k] = d[k].map((r, i) => { if (r && !fits(VESSEL[v][k][i], r)) { removed++; return null; } return r; }); });
      if (removed) toast(`枠の色が合わない遺物を${removed}つ外しました`);
      break;
    }
    case 'disc': S.edit.open[v] = t.dataset.open !== 'true'; break;
    case 'nameEdit': { S.edit.editingName = true; render(); const el = document.getElementById('e-name'); el?.focus(); el?.select(); return; }
    case 'nameDone': { const d = S.edit.data; if (!d.name.trim()) d.nameAuto = true; S.edit.editingName = false; break; }
    case 'nameAuto': { const d = S.edit.data; d.nameAuto = true; d.name = ''; S.edit.editingName = false; break; }
    case 'eStyle': { const d = S.edit.data; d.style = d.style === v ? null : v; if (d.style !== 'caster' && d.style !== 'hybrid') d.spec = []; break; }
    case 'eSpec': { const d = S.edit.data; d.spec ||= []; d.spec = d.spec.includes(v) ? d.spec.filter(x => x !== v) : [...d.spec, v]; break; }
    case 'eWeapon': { const d = S.edit.data; d.weaponType = d.weaponType === v ? null : v; S.edit.open.weapon = false; break; }
    case 'eSlotMode': { const sl = S.edit.slot; if (sl.mode !== v) { sl.mode = v; sl.data.special = null; } break; }
    case 'eSpecial': S.edit.slot.data.special = v; break;
    case 'openSlot': {
      const k = t.dataset.k, i = +v, cur = S.edit.data[k][i];
      S.edit.slotY = lockY ?? window.scrollY;  // 閉じたらこの位置に戻る
      S.edit.slot = { k, i, existed: !!cur, fresh: !cur, mode: cur && cur.special ? SPECIAL[cur.special].type : 'normal', data: cur ? structuredClone(cur) : { size: 3, color: 'red', kind: k, effects: [null, null, null], demerits: [null, null, null] } };
      // 新しい枠は、適合する献器がある色から始める
      if (!cur) S.edit.slot.data.color = COLORS.map(c => c.id).find(canColor) || 'red';
      // 空き枠・固定効果の遺物は、そのまま効果選択を開く（1タップで選べるように）
      if (!cur) S.sheet = { type: 'eff', kind: 'effects', idx: 0, cat: null, q: '', open: null };
      else if (cur.special) S.sheet = { type: 'eff', kind: 'effects', idx: 0, cat: '__' + SPECIAL[cur.special].type, q: '', open: null };
      scrollTop(); break;
    }
    case 'pickSpecial': S.sheet = { type: 'eff', kind: 'effects', idx: 0, cat: '__' + SPECIAL[S.edit.slot.data.special].type, q: '', open: null }; break;
    case 'sPickSpecial': {
      const { k, i } = S.edit.slot; const sp = SPECIAL[v];
      if (!specialOk(sp)) { toast('適合する献器がないため選べません'); return; }
      S.edit.data[k][i] = { special: sp.id, color: sp.color || S.edit.slot.data.color || 'red', kind: 'normal', effects: [null, null, null], demerits: [null, null, null], size: sp.effects.length };
      leaveSlot(); S.sheet = null; toast(`${sp.name}を入れました`); break;
    }
    case 'eSize': S.edit.slot.data.size = +v; break;
    case 'eColor': if (canColor(v)) S.edit.slot.data.color = v; break;
    case 'pickEff': { const cur = S.edit.slot.data[t.dataset.k][+v]; const e = cur && ALL_EFF[cur]; S.sheet = { type: 'eff', kind: t.dataset.k, idx: +v, cat: e ? e.cat : null, q: '', open: e && FAM[e.fid].opts ? e.fid : null }; break; }
    case 'sCat': S.sheet.cat = v || null; renderSheet(); return;
    case 'sPickEff': { const sd = S.edit.slot.data; if (sd.special && S.sheet.kind === 'effects') { sd.special = null; S.edit.slot.mode = 'normal'; } S.edit.slot.fresh = false; sd[S.sheet.kind][S.sheet.idx] = v || null; if (S.sheet.kind === 'effects' && !demeritAllowed(ALL_EFF[v])) sd.demerits[S.sheet.idx] = null; S.sheet = null; break; }
    case 'sOpen': S.sheet.open = S.sheet.open === v ? null : v; renderSheet(); return;
    case 'sClose': {
      // 空き枠から開いて何も選ばずに閉じたら、プリセットの画面に戻る
      const sl = S.edit?.slot; if (sl?.fresh && !sl.data.special && !sl.data.effects.some(Boolean)) leaveSlot();
      S.sheet = null; break;
    }
    case 'eSlotSave': {
      const { k, i, data: r, mode } = S.edit.slot;
      if (mode !== 'normal') {
        if (!r.special) { toast('遺物を選んでください'); break; }
        const sp = SPECIAL[r.special];
        if (!specialOk(sp)) { toast('適合する献器がないため選べません'); break; }
        S.edit.data[k][i] = { special: sp.id, color: sp.color || r.color || 'red', kind: 'normal', effects: [null, null, null], demerits: [null, null, null], size: sp.effects.length };
        leaveSlot(); break;  // 置き換えたので「要確認」も外れる
      }
      r.special = null; delete r.check;
      if (!canColor(r.color)) { toast('この色だと適合する献器がありません。色を選び直してください'); break; }
      // 効果のある行だけを詰めて保存し、大きさは効果の数から決める
      const rows = [0, 1, 2].filter(j => r.effects[j]).map(j => [r.effects[j], k === 'deep' && demeritAllowed(ALL_EFF[r.effects[j]]) ? r.demerits[j] : null]);
      r.effects = [0, 1, 2].map(j => rows[j] ? rows[j][0] : null);
      r.demerits = [0, 1, 2].map(j => rows[j] ? rows[j][1] : null);
      r.size = rows.length;
      S.edit.data[k][i] = rows.length ? r : null;
      if (!rows.length) toast('効果が空なので、枠を空にしました');
      leaveSlot(); break;
    }
    case 'effX': {
      // プリセットの画面で、遺物の効果を1つだけすぐ消す（デメリットだけ・遺物ごと、も可）。残った効果は上に詰める
      const k = t.dataset.k, i = +t.dataset.i, j = +t.dataset.j, w = t.dataset.w, d = S.edit.data, r = d[k][i];
      if (!r) return;
      S.undoRelic = { k, i, r: structuredClone(r), id: d.id };
      let msg;
      if (w === 'relic') { d[k][i] = null; msg = '遺物を外しました'; }
      else if (w === 'dem') { r.demerits[j] = null; msg = 'デメリットを消しました'; }
      else {
        const rows = [0, 1, 2].filter(x => x !== j && r.effects[x]).map(x => [r.effects[x], r.demerits?.[x] ?? null]);
        r.effects = [0, 1, 2].map(x => rows[x]?.[0] ?? null); r.demerits = [0, 1, 2].map(x => rows[x]?.[1] ?? null); r.size = rows.length;
        if (!rows.length) d[k][i] = null;
        msg = rows.length ? '効果を消しました' : '効果がなくなったので、枠を空にしました';
      }
      toast(msg, { act: 'undoEffX', label: '元に戻す' }); break;
    }
    case 'undoEffX': { const u = S.undoRelic; S.undoRelic = null; document.getElementById('toast').innerHTML = ''; clearTimeout(toastTimer);
      if (!u || S.edit?.data?.id !== u.id) return; S.edit.data[u.k][u.i] = u.r; toast('元に戻しました'); break; }
    case 'eSlotClear': { const { k, i } = S.edit.slot; S.edit.data[k][i] = null; leaveSlot(); break; }
    case 'eSlotCancel': leaveSlot(); break;
    case 'eSave': {
      const d = S.edit.data;
      if (d.public && (ngHit(d.nameAuto ? '' : d.name) || ngHit(d.weaponName) || ngHit(d.pubNote))) { toast('名前・武器名・メモに不適切な言葉が含まれているため、公開できません。直してから保存してください'); return; }
      if (d.nameAuto || !d.name.trim()) { d.nameAuto = true; d.name = autoName(d); }
      const wasPublic = !!presetById(d.id)?.public;
      const old = presetById(d.id);
      if (old && JSON.stringify(buildSnapshot(old)) !== JSON.stringify(buildSnapshot(d)) && db.runs.some(r => r.presetId === d.id && (r.presetRev || 1) === presetRev(old))) {
        d.history = [...(old.history || []), { rev: presetRev(old), ...buildSnapshot(old) }];
        d.rev = presetRev(old) + 1;
      }
      const i = db.presets.findIndex(x => x.id === d.id);
      i >= 0 ? (db.presets[i] = d) : db.presets.push(d);
      toast('保存しました'); S.edit = null; delete prefs().draft;
      // みんなに公開：載せる・更新する・取り下げる
      if (d.public) postOnline({ type: 'build_put', id: d.id, name: presetName(d), charId: d.charId || '', data: publicPayload(d) })
        .then(res => { if (res?.error === 'banned') { d.public = false; toast('このビルドは、管理人の判断で公開できなくなっています'); render(); return; } if (res?.error === 'ng') { d.public = false; toast('不適切な言葉が含まれているため、公開できませんでした'); render(); } else if (!res?.ok) throw new Error(); else { PUB.at = 0; toast('保存して、みんなに公開しました'); } })
        .catch(() => toast('公開できませんでした。通信できる所で、もう一度保存してください'));
      else if (wasPublic) postOnline({ type: 'build_del', id: d.id }).then(() => { PUB.at = 0; toast('公開を取り下げました'); }, () => {});
      break;
    }
    case 'eDel': {
      if (S.confirmDel !== 'edit') { S.confirmDel = 'edit'; break; }
      const id = S.edit.data.id;
      if (presetById(id)?.public) postOnline({ type: 'build_del', id }).then(() => { PUB.at = 0; }, () => {});
      const target = presetById(id);
      if (db.runs.some(r => r.presetId === id)) target.deleted = true;  // 戦績で使っていれば「削除済み」として残す
      else db.presets = db.presets.filter(p => p.id !== id);
      if (S.form.presetId === id) S.form.presetId = null;
      S.confirmDel = null; S.edit = null; delete prefs().draft; toast('削除しました'); break;
    }
    case 'eDup': {
      // 保存済みの中身をコピーして、新しいプリセットとして作り始める（元のプリセットは変わらない）
      const src = structuredClone(presetById(S.edit.data.id));
      const { rev, history, deleted, imported, importedAt, ...rest } = src;  // 複製したものは自分のプリセットになる
      const named = !rest.nameAuto && rest.name?.trim();
      S.edit = { type: 'preset', isNew: true, open: {}, data: { ...rest, id: uid(), name: named ? `${rest.name}（コピー）` : '', nameAuto: !named, public: false } };
      scrollTop(); toast('複製しました。直して保存すると新しいプリセットになります'); break;
    }
    case 'eMine': { const t = presetById(S.edit.data.id); if (t) { delete t.imported; delete t.importedAt; } delete S.edit.data.imported; delete S.edit.data.importedAt; toast('マイプリセットに移しました'); break; }
    case 'eCancel': S.edit = null; delete prefs().draft; break;
    case 'eShare': {
      // 保存済みの内容を共有する（直している途中の内容は、保存してから）
      const sp = presetById(S.edit.data.id);
      const url = shareUrl(sp);
      const changed = JSON.stringify(buildSnapshot(sp)) !== JSON.stringify(buildSnapshot(S.edit.data));
      if (navigator.share) navigator.share({ title: `ビルド「${presetName(sp)}」`, text: `夜渡り日記のビルド「${presetName(sp)}」`, url }).catch(() => {});
      else navigator.clipboard?.writeText(url).then(() => toast('共有リンクをコピーしました'), () => toast('コピーできませんでした'));
      if (changed) toast('保存済みの内容を共有します（直した分は、保存してから共有してください）');
      return;
    }
    case 'importOpen': S.sheet = { type: 'import' }; break;
    case 'publicOpen': S.buildView = 'public'; loadPublic(true); scrollTop(); break;
    case 'pubClose': S.buildView = 'presets'; scrollTop(); break;
    case 'pubChar': S.pubChar = S.pubChar === v ? '' : v; break;
    case 'buildChar': S.buildChar = S.buildChar === v ? '' : v; break;
    case 'pubPick': { const b = PUB.list?.[+v], d = b && parsePublic(b.data); if (!d) return; S.sheet = { type: 'import', data: d, pub: b }; break; }
    case 'buildReport': {
      const b = S.sheet?.pub; if (!b) return;
      if (S.confirmDel !== 'buildReport') { S.confirmDel = 'buildReport'; renderSheet(); return; }
      S.confirmDel = null;
      postOnline({ type: 'build_report', id: b.presetId, reason: 'inappropriate' }).then(res => { if (!res?.ok) throw new Error();
        (prefs().reported ||= {})[b.presetId] = 1; save(db); PUB.at = 0; toast('通報しました。ご協力ありがとうございます'); renderSheet(); },
        () => toast('送れませんでした。通信できる所でもう一度お試しください'));
      return;
    }
    case 'react': {
      const b = S.sheet?.pub; if (!b || !REACTIONS.some(([k]) => k === v)) return;
      const id = b.presetId, rs = ((prefs().reacts ||= {})[id] ||= {}), oldLike = v === 'like' && (prefs().votes || {})[id] === 1;
      const on = !myReacts(id)[v];
      // 先に画面へ反映し、送れなかったら元に戻す
      const apply = turnOn => { b.reactions = reactCounts(b); b.reactions[v] = Math.max(0, (b.reactions[v] || 0) + (turnOn ? 1 : -1)); if (turnOn) rs[v] = true; else delete rs[v]; };
      apply(on); if (oldLike && !on) delete prefs().votes[id];
      renderSheet(); render();
      // 前の「いいね」を取り消すときは、前の形（vote）でも取り消す
      const send = oldLike && !on ? postOnline({ type: 'vote', id, value: 0 }) : postOnline({ type: 'react', id, r: v, on });
      send.then(res => { if (!res?.ok) throw new Error(res?.error); })
        .catch(err => { apply(!on); if (oldLike && !on) (prefs().votes ||= {})[id] = 1; renderSheet(); render(); toast(err?.message === 'limit' ? '今日はもうリアクションできません（1日20回まで）' : '送れませんでした。通信できる所でもう一度お試しください'); });
      return;
    }
    case 'ePublic': { const d = S.edit.data; d.public = !d.public; break; }
    case 'eNeta': { const d = S.edit.data; d.neta = !d.neta; break; }
    case 'pubNeta': prefs().pubOnlyNeta = !prefs().pubOnlyNeta; delete prefs().pubHideNeta; break;
    case 'restoreOpen': prefs().onboarded = true; S.sheet = { type: 'restore' }; break;
    case 'restoreFind': {
      const code = document.getElementById('restore-code')?.value || '';
      if (!validCode(code)) { S.sheet = { type: 'restore', code, err: '引き継ぎコードは、英数字16文字です（例：K7QM-82XP-4HZD-W9TA）。' }; break; }
      S.sheet = { type: 'restore', code, busy: true }; renderSheet();
      cloudFetch(code).then(found => { S.sheet = found ? { type: 'restore', code, found } : { type: 'restore', code, err: 'このコードのバックアップは見つかりませんでした。コードをもう一度確かめてください。' }; },
        e => { S.sheet = { type: 'restore', code, err: `戻せませんでした（${e.message || '通信できませんでした'}）。通信できる所でもう一度お試しください。` }; })
        .finally(() => renderSheet());
      return;
    }
    case 'restoreDo': {
      const { found, code } = S.sheet || {}; if (!found) return;
      replaceDb({ runs: found.data.runs || [], relics: found.data.relics || [], presets: found.data.presets || [], prefs: { ...(found.data.prefs || {}), onboarded: true } });
      prefs().cloud = { on: true, code: fmtCode(code), confirmed: true, savedAt: Date.now(), sig: cloudSig(cloudPayload()), failed: false };
      S.sheet = null; S.tab = 'record'; scrollTop(); toast(`戻しました（戦績 ${liveRuns().length}件）`); break;
    }
    case 'codeCopy': {
      const code = cloud().code, text = `夜渡り日記の引き継ぎコード：${code}`;
      if (navigator.share) navigator.share({ title: '夜渡り日記の引き継ぎコード', text }).catch(() => {});
      else navigator.clipboard?.writeText(code).then(() => toast('コピーしました'), () => toast('コピーできませんでした'));
      return;
    }
    case 'codeConfirm': cloud().confirmed = true; toast('ありがとうございます。コードは大切に保管してください'); break;
    case 'codeLater': cloud().snoozeUntil = Date.now() + 7 * 864e5; toast('7日後にまたお知らせします'); break;
    case 'cloudOn': Object.assign(cloud(), { on: true, sig: '' }); scheduleCloud(500); toast('自動バックアップをオンにしました'); break;
    case 'cloudOff': if (S.confirmDel !== 'cloudOff') { S.confirmDel = 'cloudOff'; break; } S.confirmDel = null; cloud().on = false; toast('自動バックアップをオフにしました'); break;
    case 'onlineJoin': onlinePrefs().join = true; toast('参加しました。戦績を送ります'); scheduleSync(); break;
    case 'onlineLeave': {
      if (S.confirmDel !== 'onlineLeave') { S.confirmDel = 'onlineLeave'; break; }
      S.confirmDel = null;
      // やめるときは、送った戦績を「消した」扱いで送り直して、集計から外す
      const o = onlinePrefs(), ids = Object.keys(o.sent), now = Date.now();
      const done = () => { o.join = false; o.sent = {}; resetGlobal(); toast('参加をやめました。送った戦績は集計から外れます'); render(); };
      if (!ids.length) { done(); return; }
      postOnline({ type: 'runs', runs: ids.map(id => ({ id, deleted: true, updatedAt: now })) })
        .then(res => res?.ok ? done() : Promise.reject(), () => toast('通信できませんでした。通信できる所でもう一度押してください'));
      return;
    }
    case 'requestOpen': S.sheet = { type: 'request' }; break;
    case 'privacyOpen': S.sheet = { type: 'privacy' }; break;
    case 'gacha': {
      // 前と同じものが続けて出ないようにする（2つ以上あるとき）
      const list = shownPresets(); if (!list.length) return;
      const last = S.sheet?.type === 'gacha' ? S.sheet.id : S.gachaLast;
      const pool = list.length > 1 ? list.filter(p => p.id !== last) : list;
      const p = pool[Math.floor(Math.random() * pool.length)];
      S.gachaLast = p.id; S.sheet = { type: 'gacha', id: p.id, spin: (S.sheet?.spin || 0) + 1 }; break;
    }
    case 'gachaUse': {
      const p = presetById(S.sheet?.id); if (!p?.charId) return;
      // 記録タブへ：夜渡りとビルドを入れた状態にする（ビルドは、その夜渡りの「前回使ったもの」としても覚える）
      Object.assign(S.form, { charId: p.charId, presetId: p.id }); (prefs().presetByChar ||= {})[p.charId] = p.id;
      S.sheet = null; S.edit = null; S.tab = 'record'; scrollTop(); toast(`「${presetName(p)}」で記録します`); break;
    }
    case 'cmtOpen': {
      // 前に送ったコメントがあれば、それを選んだ状態から始める（前に作った12個の文の型・言葉は、選び直してもらう）
      const m = (prefs().comments || {})[S.sheet?.pub?.presetId], okT = t => t >= COMMENT_T_START, okG = w => COMMENT_GROUPS.includes(COMMENT_WORDS[w]?.[1]);
      const two = !!m && m.c >= 0;
      S.sheet.compose = { t: m && okT(m.t) ? m.t : null, w: m && okG(m.w) ? m.w : null, g: m && okG(m.w) ? COMMENT_WORDS[m.w][1] : COMMENT_GROUPS[0],
        two, c: two ? m.c : null, t2: two && okT(m.t2) ? m.t2 : null, w2: two && okG(m.w2) ? m.w2 : null, g2: two && okG(m.w2) ? COMMENT_WORDS[m.w2][1] : COMMENT_GROUPS[0] };
      renderSheet(); return;
    }
    case 'cmtClose': if (S.sheet) delete S.sheet.compose; renderSheet(); return;
    case 'cmtT': S.sheet.compose.t = +v; renderSheet(); return;
    case 'cmtG': S.sheet.compose.g = v; renderSheet(); return;
    case 'cmtW': S.sheet.compose.w = +v; renderSheet(); return;
    case 'cmtTwo': { const c = S.sheet.compose; c.two = !c.two; if (!c.two) { c.c = null; c.t2 = null; c.w2 = null; } renderSheet(); return; }
    case 'cmtC': S.sheet.compose.c = +v; renderSheet(); return;
    case 'cmtT2': S.sheet.compose.t2 = +v; renderSheet(); return;
    case 'cmtG2': S.sheet.compose.g2 = v; renderSheet(); return;
    case 'cmtW2': S.sheet.compose.w2 = +v; renderSheet(); return;
    case 'cmtSend': case 'cmtDel': {
      const b = S.sheet?.pub; if (!b) return;
      const id = b.presetId, all = (prefs().comments ||= {}), was = all[id] ? { ...all[id] } : null;
      const cp = S.sheet.compose;
      const next = a === 'cmtDel' ? null : cp.two ? { t: cp.t, w: cp.w, c: cp.c, t2: cp.t2, w2: cp.w2 } : { t: cp.t, w: cp.w, c: -1 };
      if (next && !validCmt(next)) return;
      const before = JSON.stringify(b.comments || []);
      // 先に画面へ反映し、送れなかったら元に戻す
      const bump = (p, d) => { if (!p) return; const list = b.comments = (b.comments || []).map(x => [...x]); const hit = list.find(x => sameCmt(cmtParts(x), p));
        if (hit) hit[2] = Math.max(0, hit[2] + d); else if (d > 0) list.push([p.t, p.w, 1, p.c ?? -1, p.c >= 0 ? p.t2 : -1, p.c >= 0 ? p.w2 : -1]); b.comments = list.filter(x => x[2] > 0).sort((x, y) => y[2] - x[2]); };
      bump(was, -1); bump(next, 1); if (next) all[id] = next; else delete all[id];
      if (cp) cp.sending = true; renderSheet();
      const body = next ? { type: 'comment', id, t: next.t, w: next.w, ...(next.c >= 0 ? { c: next.c, t2: next.t2, w2: next.w2 } : {}) } : { type: 'comment', id, t: -1, w: 0 };
      postOnline(body).then(res => { if (!res?.ok) throw new Error(res?.error);
          if (S.sheet?.pub === b) { delete S.sheet.compose; renderSheet(); } render(); toast(next ? 'コメントを送りました' : 'コメントを取り消しました'); })
        .catch(err => { b.comments = JSON.parse(before); if (was) all[id] = was; else delete all[id];
          if (S.sheet?.compose) S.sheet.compose.sending = false; renderSheet(); render();
          toast(err?.message === 'limit' ? '今日はもうコメントできません（1日20件まで）' : '送れませんでした。通信できる所でもう一度お試しください'); });
      return;
    }
    case 'newsOpen': S.sheet = { type: 'news' }; if (CHANGELOG[0]) prefs().seenNews = CHANGELOG[0].v; break;
    case 'shareApp': {
      // アプリのURL（開いているページのアドレスから # などを除いたもの）をコピーする
      const url = location.origin + location.pathname;
      const done = () => toast('URLをコピーしました。LINEなどに貼り付けて送ってください');
      const fallback = () => { const ta = document.createElement('textarea'); ta.value = url; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:-100px;opacity:0';
        document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove(); ok ? done() : toast(`コピーできませんでした。このURLを送ってください：${url}`); };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, fallback); else fallback();
      return;
    }
    case 'requestSend': {
      const sh = S.sheet, text = document.getElementById('request-text')?.value.trim();
      if (!text) { toast('内容を書いてください'); return; }
      if (ngHit(text)) { toast('不適切な言葉が含まれているため送れません'); return; }
      sh.sending = true; renderSheet(); document.getElementById('request-text').value = text;
      postOnline({ type: 'request', text })
        .then(res => { if (!res?.ok) throw new Error(); S.sheet = null; render(); toast('送りました。ありがとうございます'); })
        .catch(() => { sh.sending = false; renderSheet(); const b = document.getElementById('request-text'); if (b) b.value = text; toast('送れませんでした。通信できる所でもう一度お試しください'); });
      return;
    }
    case 'reportOpen': S.sheet = { type: 'report', enemy: document.querySelector('.enemy.open .enemy-head b')?.textContent || '' }; break;
    case 'reportSend': {
      const sh = S.sheet, text = document.getElementById('report-text')?.value.trim(), enemy = document.getElementById('report-enemy')?.value.trim();
      if (!text) { toast('内容を書いてください'); return; }
      if (ngHit(text) || ngHit(enemy)) { toast('不適切な言葉が含まれているため送れません'); return; }
      sh.enemy = enemy; sh.sending = true; renderSheet();
      const box = document.getElementById('report-text'); if (box) box.value = text;
      postOnline({ type: 'report', enemy, text })
        .then(res => { if (!res?.ok) throw new Error(); S.sheet = null; toast('送りました。ありがとうございます'); }, () => { sh.sending = false; toast('送れませんでした。通信できる所でもう一度お試しください'); })
        .catch(() => { sh.sending = false; toast('送れませんでした。通信できる所でもう一度お試しください'); })
        .finally(() => { if (S.sheet?.type === 'report') { renderSheet(); const b = document.getElementById('report-text'); if (b) b.value = text; } else render(); });
      return;
    }
    case 'importRead': { const d = parseShare(document.getElementById('import-text')?.value); S.sheet = d ? { type: 'import', data: d } : { type: 'import', err: true }; break; }
    case 'importDo': {
      const d = S.sheet?.data; if (!d) return;
      const { pubNote, ...rest } = d;
      // 取り込んだビルドは、自分のプリセットとは別の枠（「取り込んだビルド」）に入れる。戦績の記録ではふつうに選べる
      db.presets.push({ id: uid(), ...rest, public: false, imported: true, importedAt: Date.now() });
      S.sheet = null; S.edit = null; S.tab = 'builds'; S.buildView = 'presets'; scrollTop(); toast(`「${presetName(d)}」を「取り込んだビルド」に入れました`); break;
    }
    default: if (/^know[A-Z]/.test(a)) { if (!knowledgeAct(a, v)) return; break; }  // 知識タブのボタン（knowTopic など）
      if (a.startsWith('k') && /^k[A-Z]/.test(a)) { if (!kotsuboAct(a, v)) return; break; } return;  // 小壺タブのボタン（kHire など）
  }
  render();
  // 敵の行を開いたとき：上の行が閉じても、タップした行が同じ位置に見えるようにスクロールを合わせる
  const anc = S.enemy.anchor; S.enemy.anchor = null;
  if (anc) { const el = [...document.querySelectorAll('[data-act=enemyOpen]')].find(b => b.dataset.v === anc.v); if (el) window.scrollBy(0, el.getBoundingClientRect().top - anc.top); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.field) S.form[t.dataset.field] = t.value;
  // 日付を直したら、記録ボタンを押せるかどうかをすぐ反映する
  if (t.dataset.edit) { S.edit.data[t.dataset.edit] = t.value; if (t.dataset.edit === 'name') S.edit.data.nameAuto = !t.value.trim(); syncDraft(); save(db); }
  if (t.hasAttribute('data-enemyq')) {
    // 名前で探す：入力のたびに一覧を作り直す。入力欄そのものは入れ替えない（変換中の文字を壊さないため）
    S.enemy.q = t.value; S.enemy.open = null; S.enemy.limit = ENEMY_PAGE;
    render('enemy-q');
  }
  if (t.hasAttribute('data-sheetq')) {
    S.sheet.q = t.value;
    const pos = t.selectionStart;
    renderSheet();
    const q = document.getElementById('eff-q'); q.focus(); q.setSelectionRange(pos, pos);
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) { if (S.sheet.type === 'guide') prefs().onboarded = true; S.sheet = null; renderSheet(); save(db); } });
if (!prefs().onboarded && !db.runs.length) S.sheet = { type: 'guide' };
// v32 より前に入れたサンプルデータには印がないので、見分けて印を付け直す。
// サンプルの戦績は一度に作るので、記録時刻の「ミリ秒の端数」が全部そろう（本物の記録はばらばら）。サンプルのプリセット（p1〜p3）がある端末だけ調べる
(function markOldSample() {
  if (!db.presets.some(p => ['p1', 'p2', 'p3'].includes(p.id))) return;
  const count = {};
  db.runs.forEach(r => { if (!r.sample && !r.editedAt) { const k = r.updatedAt % 1000; count[k] = (count[k] || 0) + 1; } });
  const [ms, n] = Object.entries(count).sort((a, b) => b[1] - a[1])[0] || [];
  if (n >= 30) db.runs.forEach(r => { if (!r.sample && !r.editedAt && r.updatedAt % 1000 === +ms) r.sample = true; });
})();
// 共有リンク（#build=…）で開いたときは、ビルドの取り込み画面を出す。アドレスの #build=… は消しておく
if (location.hash.startsWith('#build=')) {
  const d = parseShare(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  S.tab = 'builds'; S.sheet = d ? { type: 'import', data: d } : { type: 'import', err: true };
}
// ミニゲームに、使う道具を渡す（動き出すのは、タイトル横の小壺から開いたとき）
initKotsubo({ prefs, save: () => save(db), toast, render: () => render(), liveRuns, ico, esc, CHAR, LORD, tab: () => S.tab, ui: () => (S.kui ||= {}) });
// 知識タブ（敵の情報・ボス判別など）に、使う道具を渡す
initKnowledge({ ico, esc, pressed, wheel, viewEnemies, ui: () => (S.know ||= {}) });
render();

document.addEventListener('change', e => {
  // 日付をカレンダー（一覧）から選んだとき。未来の日は選べない
  if (e.target.id === 'f-date-pick') { const d = e.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today()) { S.form.date = d; S.form.dateMode = d === today() ? 'today' : 'pick'; S.dayStripX = null; render(); } return; }
  if (e.target.dataset?.gdate) { S.stats[e.target.dataset.gdate] = e.target.value; render(); return; }
  if (e.target.dataset?.gsel) { S.stats[e.target.dataset.gsel] = e.target.value; render(); return; }
  if (e.target.dataset?.scan && e.target.files[0] && S.edit?.type === 'preset') { runScan(e.target.dataset.scan, e.target.files[0]); return; }
  if (e.target.dataset?.hf) { S.hist[e.target.dataset.hf] = e.target.value; S.openRun = null; render(); return; }
  if (e.target.id !== 'importFile' || !e.target.files[0]) return;
  readJsonFile(e.target.files[0])
    .then(next => { replaceDb(next); S.sheet = null; render(); toast(`復元しました（戦績 ${next.runs.filter(r => !r.deleted).length}件）`); })
    .catch(err => toast('復元できませんでした：' + err.message));
});

// iPhone の Safari は「拡大させない」設定を無視するので、2本指の拡大縮小（ピンチ）もここで止める
['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

// オフラインでも開けるようにする（開発サーバーでは使わない）
if ('serviceWorker' in navigator && !window.__DEV__) {
  navigator.serviceWorker.register('./sw.js').catch(e => console.warn('service worker', e));
}

document.addEventListener('focusin', e => { if (e.target.matches('input[type=text], input[type=search], input[type=date], textarea')) document.body.classList.add('typing'); });
document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement?.matches('input[type=text], input[type=search], input[type=date], textarea')) document.body.classList.remove('typing'); }, 50));
