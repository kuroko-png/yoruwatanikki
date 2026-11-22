// 夜の痕跡 アプリ本体
import { LORDS } from '../data/lords.js';
import { CHARS } from '../data/characters.js';
import { OPT, EFF_NORMAL_ROWS, EFF_DEEP_ROWS, DEMERIT_ROWS } from '../data/effects.js';
import { VESSEL_ROWS } from '../data/vessels.js';
import { SPECIAL_ROWS } from '../data/relics.js';
import { COLORS, SIZES, KINDS, STYLES, SPEC_SORC, SPEC_INC, WEAPON_TYPES, LOSS_AT, MODES, PARTY, DEPTHS, RUN_FLAGS, SHIFTS } from '../data/labels.js';
import { HELP } from '../data/help.js';
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
  return `${m}/${d}（${wd}）`;
}
const pct = p => Math.round(p * 100) + '%';
// 夜の王・夜渡りのアイコン（名前の左に置く）。画像は icons/lords, icons/chars（tools/make_unit_icons.py で作る）
const ICON_DIR = { lord: 'lords', char: 'chars' };
const ico = (kind, id) => id && ICON_DIR[kind] ? `<img class="ico" src="icons/${ICON_DIR[kind]}/${id}.png" alt="" aria-hidden="true" decoding="async">` : '';
const lordName = id => `${ico('lord', id)}${LORD[id]?.name ?? id}`;
const charName = id => `${ico('char', id)}${CHAR[id]?.name ?? id}`;
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
const blankForm = () => ({ dateMode: 'today', date: today(), lordId: null, everdark: null, flags: [], shift: null, mode: prefs().mode || 'normal', depth: prefs().depth || null,
  party: prefs().party || 'trio', charId: null, result: null, lossAt: null, presetId: null, note: '' });
const lastPresetFor = charId => { const id = (prefs().presetByChar || {})[charId]; return id && db.presets.some(p => p.id === id && !p.deleted) ? id : null; };
const S = {
  tab: 'record', recOpen: {}, form: blankForm(), openRun: null, confirmDel: null,
  stats: { period: 'all', mode: 'all', drill: {}, heatBy: 'lord' },
  hist: { result: 'all', lord: '', char: '' },
  buildView: 'presets', edit: null, sheet: null,
};
{ // remember last character / preset as sensible defaults
  const last = [...db.runs].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (last) { S.form.charId = last.charId; S.form.presetId = lastPresetFor(last.charId) ?? last.presetId ?? null; }
}
const liveRuns = () => db.runs.filter(r => !r.deleted);
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
  const canSave = dateOk && f.everdark !== null && f.lordId && f.charId && f.result;
  if (f.presetId && !activePresets().some(p => p.id === f.presetId) && !(S.editRun && f.presetId === S.form.origPresetId)) f.presetId = null;
  const presets = db.presets.filter(p => (!p.deleted && p.charId === f.charId) || p.id === f.presetId);
  const lords = lordsFor(f.everdark);
  const missing = [!dateOk && '日付', f.everdark === null && '常夜かどうか', !f.lordId && '夜の王', !f.charId && '夜渡り', !f.result && '結果'].filter(Boolean);
  const label = S.editRun ? '更新する' : '記録する';
  BAR = `${S.editRun ? '<button class="ghost" data-act="cancelEdit">やめる</button>' : ''}<button class="primary" data-act="save" ${canSave ? '' : 'disabled'}>${canSave ? label : `<span class="need">あと：${missing.join('・')}</span>`}</button>`;
  const chip = (act, v, label, on, cls = 'chip') => `<button class="${cls}" data-act="${act}" data-v="${v}" ${pressed(on)}>${label}</button>`;
  return `<div class="stack-lg">
    ${S.editRun ? `<div class="edit-banner"><b>戦績を編集中</b><span>直したら「更新する」を押してください</span></div>` : ''}
    ${card('日付', `${f.dateMode === 'pick' ? `<input type="date" id="f-date" data-field="date" value="${f.date}" max="${today()}">` : ''}`,
      `<div class="chips">${[['today', '今日'], ['yesterday', '昨日'], ['pick', '指定']].map(([v, l]) => chip('date', v, l, f.dateMode === v, 'chip small')).join('')}</div>`)}
    ${card('夜の王の種類', '', `<div class="chips">${chip('everdark', 'no', '通常', f.everdark === false, 'chip small')}${chip('everdark', 'yes', '常夜', f.everdark === true, 'chip small')}</div>`)}
    ${recDisc('lord', '夜の王', f.lordId && LORD[f.lordId].name,
      `<div class="grid-btns">${lords.map(l => chip('lord', l.id, lordName(l.id), f.lordId === l.id, 'tile-btn with-ico')).join('')}</div>`,
      f.lordId ? flagRow(f, chip) : '')}
    ${recDisc('char', '夜渡り', f.charId && CHAR[f.charId].name,
      `<div class="grid-btns">${CHARS.map(c => chip('char', c.id, charName(c.id), f.charId === c.id, 'tile-btn with-ico')).join('')}</div>`)}
    ${f.charId ? card('ビルド', `<div class="chips one-line">${chip('preset', '', '記録無し', !f.presetId)}${presets.map(p => chip('preset', p.id, esc(presetLabel(p)), f.presetId === p.id)).join('')}</div>
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
      <span class="k">${label}</span><span class="v ${value ? 'set' : ''}">${value ? ico(key, key === 'lord' ? S.form.lordId : S.form.charId) : ''}<span class="txt">${value ? esc(value) : '未選択'}</span></span><span class="chev"></span></button>
    ${open ? `<div class="disc-body">${body}</div>` : ''}
    ${extra ? `<div class="disc-extra">${extra}</div>` : ''}</div>`;
}
// 夜の王の下の印：「地図欠損」or「ボス不明」と、それとは別に「地変」。地変を選んだときだけ、その下に種類を出す
function flagRow(f, chip) {
  const c = x => chip('flag', x.id, x.name, f.flags.includes(x.id), 'chip small');
  const shiftOn = f.flags.includes('shift');
  return `<div class="flag-row"><span class="flag-label">あれば</span><span class="flag-alt">${c(RUN_FLAG.mapLoss)}<span class="flag-or">or</span>${c(RUN_FLAG.bossUnknown)}</span><span class="flag-sep" aria-hidden="true"></span>${c(RUN_FLAG.shift)}</div>
    ${shiftOn ? `<div class="shift-row">${SHIFTS.map(x => chip('shift', x.id, x.name, f.shift === x.id, 'chip mini')).join('')}</div>` : ''}`;
}
// 常夜の王を選んだときは、常夜にいない夜の王を外す（lords.js の everdark: false）
const lordsFor = everdark => LORDS.filter(l => everdark !== true || l.everdark !== false);
function optSummary() {
  const f = S.form;
  const parts = [f.mode === 'deep' && f.depth ? `深き夜 深度${f.depth}` : MODE[f.mode].name, PARTYM[f.party].name];
  return parts.join('・');
}

// ---------- バックアップの声かけ ----------
// 前回のバックアップから「戦績が20件増えた」または「14日たって1件以上増えた」ら、そっと知らせる
const BACKUP_EVERY_RUNS = 20, BACKUP_EVERY_DAYS = 14;
function backupState() {
  const n = liveRuns().length, last = prefs().lastBackupAt || 0;
  const added = n - (prefs().lastBackupRuns || 0);
  const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
  const due = n > 0 && (added >= BACKUP_EVERY_RUNS || (added > 0 && (days === null ? n >= 5 : days >= BACKUP_EVERY_DAYS)));
  return { n, last, days, added, due };
}
const backupAgo = b => !b.last ? 'まだ一度も保存していません' : b.days === 0 ? '今日' : `${b.days}日前`;
function backupNotice() {
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
    <span class="main"><span class="who"><span class="nm-ico">${lordName(r.lordId)}</span><span class="x">×</span><span class="nm-ico">${charName(r.charId)}</span></span>
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
    name: id => id === '__none' ? '記録無し' : id === '__gone' ? '削除済み（詳細不明）' : presetById(id) ? presetLabel(presetById(id)) : '削除済み' },
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
function barRow(x, dim, drill) {
  const inner = `<span class="name">${ico(drill, x.it.id)}${esc(x.it.name)}</span><span class="num"><b>${pct(x.p)}</b> ${x.w}/${x.n}</span>
    <span class="bar-track"><span class="bar-fill" style="width:${x.p * 100}%;background:${x.p >= .5 ? 'var(--grad-win)' : 'var(--grad-loss)'}"></span></span>`;
  return drill
    ? `<button class="bar-row tap ${dim ? 'dim' : ''}" data-act="drill" data-k="${drill}" data-v="${esc(x.it.id)}">${inner}<span class="go" aria-hidden="true">›</span></button>`
    : `<div class="bar-row ${dim ? 'dim' : ''}">${inner}</div>`;
}
function drillBanner() {
  const keys = Object.keys(S.stats.drill);
  if (!keys.length) return `<p class="hint">各項目の行をタップすると、その条件に絞って詳しく見られます。</p>`;
  return `<div class="drill-banner"><b>絞り込み中</b><div class="chips">${keys.map(k => `<button class="chip small drill-chip" data-act="undrill" data-v="${k}" aria-label="${DRILL[k].label}の絞り込みを外す">${DRILL[k].label}：${ico(k, S.stats.drill[k])}${esc(DRILL[k].name(S.stats.drill[k]))} <span aria-hidden="true">×</span></button>`).join('')}</div>
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
  return `<div class="stack-lg">
    <div class="filters">
      <div class="chips">${filterChips('period', [['all', '全期間'], ['30', '30日'], ['7', '7日']])}</div>
      <div class="chips">${filterChips('mode', [['all', 'すべて'], ['normal', '通常'], ['deep', '深き夜'], ['ever', '常夜の王']])}</div>
    </div>
    ${drillBanner()}
    ${runs.length ? `
    <div class="tiles">
      <div class="tile"><div class="k">戦数</div><div class="v">${all.n}</div><div class="s">${all.w}勝 ${all.n - all.w}敗</div></div>
      <div class="tile"><div class="k">勝率</div><div class="v">${pct(all.p)}</div><div class="s">全体</div></div>
      <div class="tile"><div class="k">連勝</div><div class="v">${streak}</div><div class="s">最高 ${best}</div></div>
    </div>
    ${card('勝率の推移', `<p class="hint">直近10戦ごとの勝率。点線は50%</p>${spark(chrono)}`)}
    ${dr.lord ? '' : card('夜の王別', barRows(LORDS, l => runs.filter(r => r.lordId === l.id), { drill: 'lord' }))}
    ${dr.char ? '' : card('夜渡り別', barRows(CHARS, c => runs.filter(r => r.charId === c.id), { drill: 'char' }))}
    ${dr.lord || dr.char ? '' : card('相性表', heat(runs), `<div class="chips">${[['lord', '夜の王ごと'], ['char', '夜渡りごと']].map(([v, l]) => `<button class="chip small" data-act="heatBy" data-v="${v}" ${pressed(S.stats.heatBy === v)}>${l}</button>`).join('')}</div>`)}
    ${card('どこで倒れたか', lossTotal ? `<div class="stack">${lossCounts.filter(x => x.n).map(x => `<div style="flex:${x.n};background:${lossColors[x.id]}">${x.n >= lossTotal * .12 ? pct(x.n / lossTotal) : ''}</div>`).join('')}</div>
      <div class="legend">${lossCounts.map(x => `<span><i style="background:${lossColors[x.id]}"></i>${x.name} ${x.n}回</span>`).join('')}</div>` : `<p class="hint">敗北の記録はありません</p>`)}
    ${dr.preset ? '' : card('ビルド別', barRows([...db.presets.map(p => ({ id: p.id, name: presetLabel(p) })), { id: '__none', name: '記録無し' }, { id: '__gone', name: '削除済み（詳細不明）' }],
      p => runs.filter(r => DRILL.preset.match(r, p.id)), { drill: 'preset' }))}
    ${dr.style && dr.weapon ? '' : card('型・メイン武器別', `${dr.style ? '' : barRows(STYLES, st => runs.filter(r => runBuild(r)?.style === st.id), { drill: 'style' })}
      ${dr.weapon ? '' : barRows(WEAPON_TYPES.map(w => ({ id: w, name: w })), w => runs.filter(r => runBuild(r)?.weaponType === w.id), { drill: 'weapon' })}`)}
    ${card('効果別', `<p class="hint">その効果を積んでいた試合の勝率。プリセットに登録した効果だけが対象です</p>
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
    return `<div class="match-group"><div class="match-head"><b>${ico(byLord ? 'lord' : 'char', g.id)}${g.name}</b><span>${rate(mine).n}戦</span></div><div class="match-cells">${cells.map(x => {
      const col = x.p >= .5 ? 'var(--win)' : 'var(--loss)';
      const strength = Math.round(18 + Math.abs(x.p - .5) * 2 * 60);
      return `<span class="match ${x.n < STATS_MIN_RUNS ? 'few' : ''}" style="background:color-mix(in srgb, ${col} ${strength}%, var(--panel))"><span class="nm">${ico(byLord ? 'char' : 'lord', x.o.id)}${x.o.name}</span><b>${pct(x.p)}</b><small>${x.w}/${x.n}</small></span>`;
    }).join('')}</div></div>`;
  });
  return `<p class="hint">${byLord ? '夜の王ごとに、使った夜渡りの勝率' : '夜渡りごとに、戦った夜の王との勝率'}。緑ほど勝ち越し、赤ほど負け越し。点線の札は${STATS_MIN_RUNS}戦未満（参考）です</p><div class="match-list">${rows.join('')}</div>`;
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
    ${activePresets().map(p => { const x = rate(liveRuns().filter(r => r.presetId === p.id)); return `<button class="card" data-act="editPreset" data-v="${p.id}">
      <span class="title"><span>${esc(p.name)}</span><span class="rate ${x.n ? '' : 'none'}">${x.n ? `${pct(x.p)}<span style="color:var(--dim);font-weight:400"> ・${x.n}戦</span>` : '未使用'}</span></span>
      <span class="sub">${p.charId ? charName(p.charId) : '夜渡り未設定'}${styleText(p) ? '・' + esc(styleText(p)) : ''}</span>${slotDots(p)}</button>`; }).join('')}
  </div>`;
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
      <p class="hint">左3つが表の遺物、右3つが深層の遺物の枠の色です。虹色の枠はどの色でも装備できます。</p>`;
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
    return { html: `<span class="txt">${n}/3</span><span class="slots">${p[kind].map((r, i) => `<span class="slot-dot ${kind === 'deep' ? 'deep' : ''} ${r ? 'c-' + r.color : 'o-' + v[kind][i]}"></span>`).join('')}</span>`, set: n > 0 }; };
  const name = presetName(p);
  const nameRow = S.edit.editingName
    ? `<section class="card-sec"><div class="sec-head"><h2>プリセット名</h2></div>
        <input type="text" id="e-name" data-edit="name" value="${esc(p.nameAuto ? '' : p.name)}" placeholder="${esc(autoName(p))}">
        <div class="row-actions">${p.nameAuto ? '' : '<button class="ghost" data-act="nameAuto">自動の名前に戻す</button>'}<button class="ghost" data-act="nameDone">決定</button></div>
        <p class="hint">空のままにすると「型 メイン武器」の名前になります。</p></section>`
    : `<button class="name-row" data-act="nameEdit"><span class="k">プリセット名</span><span class="nm">${esc(name)}</span><span class="pen">${p.nameAuto ? '自動・変更' : '変更'}</span></button>`;
  BAR = '';
  return `<div class="stack-lg">
    <div class="page-title">${S.edit.isNew ? 'プリセットを作る' : 'プリセットを編集'}</div>
    ${disc('char', '夜渡り', p.charId ? { html: `${ico('char', p.charId)}<span class="txt">${CHAR[p.charId].name}</span>`, set: true } : val('未選択', false),
      `<div class="grid-btns">${CHARS.map(c => `<button class="tile-btn with-ico" data-act="eChar" data-v="${c.id}" ${pressed(p.charId === c.id)}>${charName(c.id)}</button>`).join('')}</div>`)}
    ${disc('style', '型', styleName ? val(styleName, true) : val('未設定', false), styleBody)}
    ${disc('weapon', 'メイン武器', p.weaponType ? val(p.weaponName ? `${p.weaponName}（${p.weaponType}）` : p.weaponType, true) : val('未設定', false), weaponBody)}
    ${disc('vessel', '献器', !p.charId ? val('先に夜渡りを選択', false) : v ? { html: `<span class="txt">${esc(v.name)}</span>${vesselCols(v, 'normal')}`, set: true } : val('未選択', false), vesselBody, !p.charId)}
    ${nameRow}
    ${v ? disc('relicNormal', '表の遺物', relicValue('normal'), `<div class="section">${[0, 1, 2].map(i => slot('normal', i)).join('')}</div>`, false, true)
      + disc('relicDeep', '深層の遺物', relicValue('deep'), `<div class="section">${[0, 1, 2].map(i => slot('deep', i)).join('')}</div><p class="hint">深き夜で使う遺物です。</p>`, false, true)
      + '<p class="hint">枠は空いたままでも保存できます。</p>' : ''}
    <div class="form-actions"><button class="ghost" data-act="eCancel">キャンセル</button><button class="primary" data-act="eSave">保存する</button></div>
    ${S.edit.isNew ? '' : `<div class="row-actions" style="justify-content:center"><button class="ghost" data-act="eDup">複製して新しく作る</button><button class="ghost danger" data-act="eDel">${S.confirmDel === 'edit' ? 'もう一度押すと削除' : 'このプリセットを削除'}</button></div>`}
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
    <div class="eyebrow">${esc(S.edit.data.name || 'プリセット')} ／ ${k === 'deep' ? '深層の遺物' : '表の遺物'}の${i + 1}枠目（${sc === 'any' ? 'どの色でも可' : COLOR[sc].name + 'の枠'}）</div>
    ${r.special ? specialCard(r) : `
    <section class="card-sec">
      <div class="relic-title"><span class="color-dot c-${r.color}"></span>${relicName(r)}</div>
      ${sc === 'any' ? `<div class="chips">${COLORS.map(c => `<button class="chip small" data-act="eColor" data-v="${c.id}" ${pressed(r.color === c.id)}><span class="color-dot c-${c.id}" style="width:10px;height:10px;vertical-align:0;margin-right:6px"></span>${c.word}</button>`).join('')}</div>` : ''}
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
  if (sh.type === 'guide') { el.innerHTML = guideSheet(); return; }
  if (sh.type === 'help') { el.innerHTML = helpSheet(); return; }
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
  const sc = VESSEL[S.edit.data.vesselId][k][i];
  const charId = S.edit.data.charId;
  const list = SPECIALS.filter(x => x.type === type && (type === 'lord' || x.who === charId || x.who === 'any'));
  const ok = list.filter(x => fitsSpecial(sc, x)), ng = list.filter(x => !fitsSpecial(sc, x));
  const who = x => type === 'lord' ? LORD[x.who].name : x.who === 'any' ? '共通' : CHAR[x.who].name;
  return (ok.length ? ok.map(x => `<button class="pick special-pick" data-act="sPickSpecial" data-v="${x.id}" ${pressed(r.special === x.id)}>
      <span class="sp-main"><span class="sp-name"><span class="color-dot c-${x.color}"></span>${x.name}<span class="badge">${who(x)}</span></span>
      <small>${x.effects.map(esc).join('・')}</small></span></button>`).join('')
    : `<p class="hint">この枠の色に合う${type === 'lord' ? '夜の王の' : '固有'}遺物はありません</p>`)
    + (ng.length ? `<p class="hint" style="padding:8px">色が合わないため装備できない：${ng.map(x => x.name).join('、')}</p>` : '');
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
    <div class="sheet-head"><h2>夜の痕跡へようこそ</h2></div>
    <div class="sheet-list guide-list">
      <p class="hint">ナイトレインの戦績を記録して、夜の王・夜渡り・ビルドごとの勝率を振り返るアプリです。</p>
      ${install}
      ${step(installed ? 1 : 2, '戦績を記録する', '「記録」タブで、常夜かどうか・夜の王・夜渡り・結果を選んで「記録する」。2戦目からは前回の夜渡りとビルドを覚えています。')}
      ${step(installed ? 2 : 3, 'バックアップを取る', '記録はこのスマホの中だけに保存されます。機種変更の前などは、右上の「データ」→「バックアップを保存」をしてください。')}
    </div>
    <button class="primary" data-act="guideClose">はじめる</button></div>`;
}
// 「このタブの使い方」：今いるタブでできることと、開発者からの一言（文章は src/data/help.js）
function helpSheet() {
  const h = HELP[S.tab];
  return `<div class="scrim" data-act="sClose"></div><div class="sheet help" role="dialog" aria-label="「${h.title}」タブの使い方">
    <div class="sheet-head"><h2>「${h.title}」タブの使い方</h2><button class="ghost" data-act="sClose">閉じる</button></div>
    <div class="sheet-list help-list">
      <ul class="help-points">${h.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
      ${h.dev ? `<div class="dev-note"><b>開発者より</b><p>${esc(h.dev)}</p></div>` : ''}
    </div></div>`;
}
function menuSheet() {
  const n = liveRuns().length;
  const item = (act, title, sub, cls = '') => `<button class="pick ${cls}" data-act="${act}"><span><b>${title}</b><br><span class="hint">${sub}</span></span><span class="cat">›</span></button>`;
  return `<div class="scrim" data-act="sClose"></div><div class="sheet" role="dialog" aria-label="データ管理">
    <div class="sheet-head"><h2>データ管理</h2><button class="ghost" data-act="sClose">閉じる</button></div>
    <p class="hint">記録はこの端末のブラウザに保存されています（戦績 ${n}件・プリセット ${activePresets().length}件）。機種変更の前やブラウザのデータを消す前に、バックアップを保存してください。</p>
    <div class="sheet-list">
      ${item('guide', '使い方・ホーム画面に追加', 'はじめに出た案内をもう一度見る')}
      ${item('exportJson', 'バックアップを保存', `最後のバックアップ：${backupAgo(backupState())}${backupState().due ? '（おすすめ）' : ''}`, backupState().due ? 'recommend' : '')}
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
    r.date, LORD[r.lordId]?.name ?? r.lordId, r.everdark ? '常夜' : '', (r.flags || []).map(x => flagName(x, r)).join('/'), MODE[r.mode]?.name ?? r.mode, r.depth ?? '', PARTYM[r.party]?.name ?? r.party,
    CHAR[r.charId]?.name ?? r.charId, r.result === 'win' ? '勝利' : '敗北', r.lossAt ? LOSS[r.lossAt].name : '', presetById(r.presetId) ? presetLabel(presetById(r.presetId)) : (r.presetId ? '削除済み' : ''), r.note]));
  return rows;
}

// ---------- render ----------
// タブのアイコンは icons/tabs/<id>.png（tools/make_app_icons.py で Images/ の絵から作る）
const TABS = [{ id: 'record', name: '記録' }, { id: 'history', name: '履歴' }, { id: 'stats', name: '統計' }, { id: 'builds', name: 'ビルド' }];
function appSub() {
  const runs = liveRuns();
  if (S.tab === 'record') { const t = rate(runs.filter(r => r.date === today())); return t.n ? `今日 ${t.n}戦 ${t.w}勝 ${t.n - t.w}敗` : '今日の夜を記録する'; }
  if (S.tab === 'history') return `${runs.length}戦の記録`;
  if (S.tab === 'stats') { const a = rate(runs); return `通算 ${a.n}戦・勝率 ${pct(a.p)}`; }
  return `プリセット ${activePresets().length}件`;
}
function render() {
  document.getElementById('tabs').innerHTML = TABS.map(t => `<button data-act="tab" data-v="${t.id}" ${S.tab === t.id ? 'aria-current="page"' : ''}><span class="tab-ico" style="-webkit-mask-image:url('icons/tabs/${t.id}.png');mask-image:url('icons/tabs/${t.id}.png')" aria-hidden="true"></span>${t.name}</button>`).join('');
  BAR = '';
  const v = { record: viewRecord, history: viewHistory, stats: viewStats, builds: viewBuilds }[S.tab];
  document.getElementById('view').innerHTML = v();
  document.getElementById('appsub').textContent = appSub();
  document.querySelector('[data-act=menu]')?.classList.toggle('due', backupState().due);
  document.getElementById('actionbar').innerHTML = BAR ? `<div class="action-bar"><div class="in">${BAR}</div></div>` : '';
  document.querySelector('.app').classList.toggle('has-bar', !!BAR);
  renderSheet();
  save(db);
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
  if (a !== 'delRun' && a !== 'eDel' && a !== 'loadSample' && a !== 'wipe') S.confirmDel = null;
  switch (a) {
    case 'tab': S.tab = v; S.sheet = null; window.scrollTo(0, 0); break;
    case 'menu': S.sheet = { type: 'menu' }; break;
    case 'help': S.sheet = { type: 'help' }; break;
    case 'guide': S.sheet = { type: 'guide' }; break;
    case 'guideClose': prefs().onboarded = true; S.sheet = null; break;
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
      if (S.confirmDel !== 'sample') { S.confirmDel = 'sample'; break; }
      replaceDb(seed()); S.confirmDel = null; S.sheet = null; toast('サンプルデータを入れました'); break;
    case 'wipe':
      if (S.confirmDel !== 'wipe') { S.confirmDel = 'wipe'; break; }
      replaceDb({ runs: [], relics: [], presets: [] }); S.confirmDel = null; S.sheet = null; toast('すべてのデータを削除しました'); break;
    case 'date': f.dateMode = v; if (v === 'today') f.date = today(); if (v === 'yesterday') f.date = daysAgo(1); break;
    case 'lord': f.lordId = f.lordId === v ? null : v; if (!f.lordId) { f.flags = []; f.shift = null; } S.recOpen.lord = !f.lordId; break;
    case 'rdisc': S.recOpen[v] = !recOpen(v, !!(v === 'lord' ? f.lordId : f.charId)); break;
    case 'everdark': f.everdark = v === 'yes'; if (f.lordId && !lordsFor(f.everdark).some(l => l.id === f.lordId)) f.lordId = null; break;
    case 'flag':
      if (f.flags.includes(v)) f.flags = f.flags.filter(x => x !== v);
      // 「地図欠損」と「ボス不明」はどちらか一方だけ。地変はどちらとも一緒に選べる
      else { const rival = { mapLoss: 'bossUnknown', bossUnknown: 'mapLoss' }[v]; f.flags = [...f.flags.filter(x => x !== rival), v]; }
      if (!f.flags.includes('shift')) f.shift = null;
      break;
    case 'shift': f.shift = f.shift === v ? null : v; break;
    case 'char': if (f.charId !== v) f.presetId = lastPresetFor(v); f.charId = v; S.recOpen.char = false; break;
    case 'result': f.result = v; if (v === 'win') f.lossAt = null; break;
    case 'lossAt': f.lossAt = f.lossAt === v ? null : v; break;
    case 'mode': f.mode = v; if (v !== 'deep') f.depth = null; if (!S.editRun) { prefs().mode = v; prefs().depth = f.depth; } break;
    case 'depth': f.depth = f.depth === +v ? null : +v; if (!S.editRun) prefs().depth = f.depth; break;
    case 'party': f.party = v; if (!S.editRun) prefs().party = v; break;
    case 'preset': f.presetId = v || null; if (!S.editRun) (prefs().presetByChar ||= {})[f.charId] = f.presetId; break;
    case 'save': {
      const dateOk = f.dateMode !== 'pick' || (/^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.date <= today());
      if (!(dateOk && f.everdark !== null && f.lordId && f.charId && f.result)) return;
      const date = f.dateMode === 'pick' ? f.date : f.dateMode === 'yesterday' ? daysAgo(1) : today();
      const p = f.presetId && presetById(f.presetId);
      const fields = { date, lordId: f.lordId, everdark: f.everdark, flags: f.flags, shift: f.flags.includes('shift') ? f.shift : null, mode: f.mode, depth: f.mode === 'deep' ? f.depth : null, party: f.party,
        charId: f.charId, result: f.result, lossAt: f.result === 'loss' ? f.lossAt : null, presetId: f.presetId, note: f.note.trim() };
      if (S.editRun) {
        const r = db.runs.find(x => x.id === S.editRun);
        const keepRev = r.presetId === f.presetId ? r.presetRev : (p ? presetRev(p) : null);
        Object.assign(r, fields, { presetRev: keepRev, editedAt: Date.now() });
        S.editRun = null; S.form = blankForm(); S.form.charId = fields.charId; S.form.presetId = lastPresetFor(fields.charId);
        S.recOpen = {}; S.tab = 'history'; S.openRun = r.id; toast('戦績を更新しました'); break;
      }
      const newId = uid();
      S.undo = { id: newId, form: structuredClone(f), recOpen: { ...S.recOpen } };
      db.runs.push({ id: newId, ...fields, presetRev: p ? presetRev(p) : null, updatedAt: Date.now(), deleted: false });
      toast(`${LORD[f.lordId].name}戦の${f.result === 'win' ? '勝利' : '敗北'}を記録しました`, { act: 'undoSave', label: '取り消す' });
      Object.assign(f, { dateMode: 'today', date: today(), lordId: null, everdark: null, flags: [], shift: null, result: null, lossAt: null, note: '' }); S.recOpen = {};
      break;
    }
    case 'editRun': {
      const r = db.runs.find(x => x.id === v);
      S.editRun = r.id;
      S.form = { dateMode: 'pick', date: r.date || today(), lordId: r.lordId, everdark: !!r.everdark, flags: [...(r.flags || [])], shift: r.shift ?? null, mode: r.mode || 'normal', depth: r.depth ?? null,
        party: r.party || 'trio', charId: r.charId, result: r.result, lossAt: r.lossAt ?? null, presetId: r.presetId ?? null, origPresetId: r.presetId ?? null, note: r.note || '' };
      S.recOpen = {}; S.tab = 'record'; S.openRun = null; window.scrollTo(0, 0); break;
    }
    case 'cancelEdit': S.editRun = null; S.form = blankForm(); S.recOpen = {}; S.tab = 'history'; break;
    case 'undoSave': {
      if (!S.undo) return;
      db.runs = db.runs.filter(r => r.id !== S.undo.id);
      S.form = S.undo.form; S.recOpen = S.undo.recOpen; S.undo = null; S.editRun = null; S.tab = 'record';
      toast('記録を取り消しました。内容を直してもう一度記録できます'); break;
    }
    case 'openRun': S.openRun = S.openRun === v ? null : v; break;
    case 'delRun':
      if (S.confirmDel !== v) { S.confirmDel = v; break; }
      { const r = db.runs.find(r => r.id === v); r.deleted = true; r.updatedAt = Date.now(); } S.confirmDel = null; S.openRun = null; toast('削除しました'); break;
    case 'hf': S.hist.result = v; S.openRun = null; break;
    case 'hfClear': S.hist = { result: 'all', lord: '', char: '' }; S.openRun = null; break;
    case 'sf': S.stats[t.dataset.k] = v; break;
    case 'drill': S.stats.drill[t.dataset.k] = v; window.scrollTo(0, 0); break;
    case 'undrill': delete S.stats.drill[v]; break;
    case 'undrillAll': S.stats.drill = {}; break;
    case 'heatBy': S.stats.heatBy = v; break;
    case 'statsMore': (S.statsMore ||= {})[v] = true; break;
    case 'bv': S.buildView = v; break;
    case 'newPreset': S.edit = { type: 'preset', isNew: true, open: { char: true }, data: { id: uid(), name: '', nameAuto: true, charId: null, vesselId: null, normal: [null, null, null], deep: [null, null, null] } }; window.scrollTo(0, 0); break;
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
    case 'disc': S.edit.open[v] = t.dataset.open !== 'true'; break;
    case 'nameEdit': S.edit.editingName = true; render(); document.getElementById('e-name')?.focus(); return;
    case 'nameDone': { const d = S.edit.data; if (!d.name.trim()) d.nameAuto = true; S.edit.editingName = false; break; }
    case 'nameAuto': { const d = S.edit.data; d.nameAuto = true; d.name = ''; S.edit.editingName = false; break; }
    case 'eStyle': { const d = S.edit.data; d.style = d.style === v ? null : v; if (d.style !== 'caster' && d.style !== 'hybrid') d.spec = []; break; }
    case 'eSpec': { const d = S.edit.data; d.spec ||= []; d.spec = d.spec.includes(v) ? d.spec.filter(x => x !== v) : [...d.spec, v]; break; }
    case 'eWeapon': { const d = S.edit.data; d.weaponType = d.weaponType === v ? null : v; S.edit.open.weapon = false; break; }
    case 'eSlotMode': { const sl = S.edit.slot; if (sl.mode !== v) { sl.mode = v; sl.data.special = null; } break; }
    case 'eSpecial': S.edit.slot.data.special = v; break;
    case 'openSlot': {
      const k = t.dataset.k, i = +v, cur = S.edit.data[k][i], sc = VESSEL[S.edit.data.vesselId][k][i];
      S.edit.slot = { k, i, existed: !!cur, fresh: !cur, mode: cur && cur.special ? SPECIAL[cur.special].type : 'normal', data: cur ? structuredClone(cur) : { size: 3, color: sc === 'any' ? 'red' : sc, kind: k, effects: [null, null, null], demerits: [null, null, null] } };
      // 空き枠・固定効果の遺物は、そのまま効果選択を開く（1タップで選べるように）
      if (!cur) S.sheet = { type: 'eff', kind: 'effects', idx: 0, cat: null, q: '', open: null };
      else if (cur.special) S.sheet = { type: 'eff', kind: 'effects', idx: 0, cat: '__' + SPECIAL[cur.special].type, q: '', open: null };
      window.scrollTo(0, 0); break;
    }
    case 'pickSpecial': S.sheet = { type: 'eff', kind: 'effects', idx: 0, cat: '__' + SPECIAL[S.edit.slot.data.special].type, q: '', open: null }; break;
    case 'sPickSpecial': {
      const { k, i } = S.edit.slot; const sp = SPECIAL[v], sc = VESSEL[S.edit.data.vesselId][k][i];
      S.edit.data[k][i] = { special: sp.id, color: sp.color || (sc === 'any' ? 'red' : sc), kind: 'normal', effects: [null, null, null], demerits: [null, null, null], size: sp.effects.length };
      S.edit.slot = null; S.sheet = null; toast(`${sp.name}を入れました`); window.scrollTo(0, 0); break;
    }
    case 'eSize': S.edit.slot.data.size = +v; break;
    case 'eColor': S.edit.slot.data.color = v; break;
    case 'pickEff': { const cur = S.edit.slot.data[t.dataset.k][+v]; const e = cur && ALL_EFF[cur]; S.sheet = { type: 'eff', kind: t.dataset.k, idx: +v, cat: e ? e.cat : null, q: '', open: e && FAM[e.fid].opts ? e.fid : null }; break; }
    case 'sCat': S.sheet.cat = v || null; renderSheet(); return;
    case 'sPickEff': { const sd = S.edit.slot.data; if (sd.special && S.sheet.kind === 'effects') { sd.special = null; S.edit.slot.mode = 'normal'; } S.edit.slot.fresh = false; sd[S.sheet.kind][S.sheet.idx] = v || null; if (S.sheet.kind === 'effects' && !demeritAllowed(ALL_EFF[v])) sd.demerits[S.sheet.idx] = null; S.sheet = null; break; }
    case 'sOpen': S.sheet.open = S.sheet.open === v ? null : v; renderSheet(); return;
    case 'sClose': {
      // 空き枠から開いて何も選ばずに閉じたら、プリセットの画面に戻る
      const sl = S.edit?.slot; if (sl?.fresh && !sl.data.special && !sl.data.effects.some(Boolean)) S.edit.slot = null;
      S.sheet = null; break;
    }
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
      if (d.nameAuto || !d.name.trim()) { d.nameAuto = true; d.name = autoName(d); }
      const old = presetById(d.id);
      if (old && JSON.stringify(buildSnapshot(old)) !== JSON.stringify(buildSnapshot(d)) && db.runs.some(r => r.presetId === d.id && (r.presetRev || 1) === presetRev(old))) {
        d.history = [...(old.history || []), { rev: presetRev(old), ...buildSnapshot(old) }];
        d.rev = presetRev(old) + 1;
      }
      const i = db.presets.findIndex(x => x.id === d.id);
      i >= 0 ? (db.presets[i] = d) : db.presets.push(d);
      toast('保存しました'); S.edit = null; break;
    }
    case 'eDel': {
      if (S.confirmDel !== 'edit') { S.confirmDel = 'edit'; break; }
      const id = S.edit.data.id;
      const target = presetById(id);
      if (db.runs.some(r => r.presetId === id)) target.deleted = true;  // 戦績で使っていれば「削除済み」として残す
      else db.presets = db.presets.filter(p => p.id !== id);
      if (S.form.presetId === id) S.form.presetId = null;
      S.confirmDel = null; S.edit = null; toast('削除しました'); break;
    }
    case 'eDup': {
      // 保存済みの中身をコピーして、新しいプリセットとして作り始める（元のプリセットは変わらない）
      const src = structuredClone(presetById(S.edit.data.id));
      const { rev, history, deleted, ...rest } = src;
      const named = !rest.nameAuto && rest.name?.trim();
      S.edit = { type: 'preset', isNew: true, open: {}, data: { ...rest, id: uid(), name: named ? `${rest.name}（コピー）` : '', nameAuto: !named } };
      window.scrollTo(0, 0); toast('複製しました。直して保存すると新しいプリセットになります'); break;
    }
    case 'eCancel': S.edit = null; break;
    default: return;
  }
  render();
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.field) S.form[t.dataset.field] = t.value;
  // 日付を直したら、記録ボタンを押せるかどうかをすぐ反映する
  if (t.dataset.field === 'date') { render(); document.getElementById('f-date')?.focus(); }
  if (t.dataset.edit) { S.edit.data[t.dataset.edit] = t.value; if (t.dataset.edit === 'name') S.edit.data.nameAuto = !t.value.trim(); }
  if (t.hasAttribute('data-sheetq')) {
    S.sheet.q = t.value;
    const pos = t.selectionStart;
    renderSheet();
    const q = document.getElementById('eff-q'); q.focus(); q.setSelectionRange(pos, pos);
  }
});
document.addEventListener('toggle', e => { if (e.target.dataset?.details === 'opt') S.optOpen = e.target.open; }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) { S.sheet = null; renderSheet(); } });
if (!prefs().onboarded && !db.runs.length) S.sheet = { type: 'guide' };
render();

document.addEventListener('change', e => {
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

document.addEventListener('focusin', e => { if (e.target.matches('input[type=text], input[type=date], textarea')) document.body.classList.add('typing'); });
document.addEventListener('focusout', () => setTimeout(() => { if (!document.activeElement?.matches('input[type=text], input[type=date], textarea')) document.body.classList.remove('typing'); }, 50));
