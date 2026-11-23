// 「小壺」タブのミニゲーム：小壺を叩いてマークをためる（オリジナルの放置系ゲーム）。
// - 叩く：マークが入る。遺物で叩く力が上がる
// - 夜渡りを雇う：自動でマークが入る（雇うほど値段が上がる。10人・25人で強化の遺物が出る）
// - 夜の王に挑む：30秒のうちに体力を削り切れば討伐。討伐するたびに、すべての稼ぎが永久に1.25倍
// - 常夜の小壺：ときどき紫の小壺が出る。すぐ叩くとボーナス
// - 戦果ボーナス：記録タブで記録した勝ち負けが、マークになる
// - 留守の間も、ゆっくり稼ぐ（最大8時間）
// 進み具合は prefs().kotsubo に入る（自動バックアップにも入る）。画面の数字は render せずに、ここで直接書き換える（叩くたびに作り直すと重いため）

let H = null;  // app.js から渡されるもの（prefs, save, toast, render, liveRuns, ico, esc, CHAR, LORD）
export function initKotsubo(helpers) { H = helpers; }

// 夜渡り：[id, 最初の値段, 1人あたりの毎秒マーク, ひとこと]
const HIRE = [
  ['wylder', 15, 0.2, '鉤縄で小壺を引き寄せてくる'],
  ['guardian', 120, 1.5, '盾で小壺をそっと守る'],
  ['ironeye', 1300, 9, '遠くの小壺も見逃さない'],
  ['duchess', 15000, 55, 'ちょっと前の小壺をもう一度叩く'],
  ['raider', 1.8e5, 320, '小壺ごと持ち上げて揺さぶる'],
  ['revenant', 2.2e6, 1800, '仲間を呼んで叩かせる'],
  ['recluse', 3e7, 1e4, '魔術でマークを集める'],
  ['executor', 4.5e8, 6e4, '目にも止まらぬ速さで叩く'],
  ['scholar', 7e9, 3.5e5, 'マークの増やし方を研究する'],
  ['undertaker', 1.1e11, 2.2e6, '眠ったマークまで掘り起こす'],
];
const PRICE_UP = 1.16;
// 叩く力などの遺物：[id, 名前, 説明, 値段, 出てくる条件（これまでの合計マーク）]
const RELICS = [
  ['tap1', '砥がれた指先', '叩いて入るマークが2倍', 100, 0],
  ['tap2', '重たい握り拳', '叩いて入るマークが2倍', 5000, 1000],
  ['tap3', '商人の勘', '叩くと、毎秒マークの1%も入る', 5e4, 2e4],
  ['jar1', '常夜の嗅覚', '常夜の小壺が出やすくなる', 2e5, 1e5],
  ['tap4', '黄金の壺打ち', '叩くと、さらに毎秒マークの3%も入る', 5e6, 1e6],
  ['off1', '留守番の小壺', '留守の間の稼ぎが半分→9割に', 1e7, 3e6],
  ['tap5', '夜明けの一撃', '叩いて入るマークが3倍', 5e9, 1e9],
];
// 夜の王：討伐する順番と体力
const BOSSES = [['gladius', 500], ['adel', 6000], ['gnoster', 6e4], ['maris', 5e5], ['libra', 4e6], ['fulghor', 3.5e7], ['caligo', 3e8], ['harmonia', 2.5e9], ['strages', 2e10], ['final', 2e11]];
const FIGHT_SEC = 30, FIGHT_TAP = 10;  // 戦いでは、叩く力の10倍のダメージ
const LINES = ['まいど！', 'いい壺あるよ', '痛っ…でも稼げる', 'もっと叩いて！', 'マークは裏切らない', '夜は長いよ', '壺は割らないでね', '今日も商売繁盛', 'お客さん、いい腕だね', 'ひと叩き、ひと儲け'];

const st = () => {
  const p = H.prefs();
  const k = (p.kotsubo ||= { v: 1, mark: 0, total: 0, taps: 0, hires: {}, ups: {}, lords: 0, lastAt: Date.now(), claimAt: 0, jars: 0 });
  k.hires ||= {}; k.ups ||= {};
  return k;
};
// ---------- 数え方 ----------
const hireMult = (k, id) => (k.ups[`h10:${id}`] ? 2 : 1) * (k.ups[`h25:${id}`] ? 2 : 1);
const globalMult = k => Math.pow(1.25, k.lords || 0);
const prodOf = k => HIRE.reduce((a, [id, , base]) => a + (k.hires[id] || 0) * base * hireMult(k, id), 0) * globalMult(k);
const tapOf = k => { const p = prodOf(k); return ((k.ups.tap1 ? 2 : 1) * (k.ups.tap2 ? 2 : 1) * (k.ups.tap5 ? 3 : 1) * globalMult(k) + p * ((k.ups.tap3 ? .01 : 0) + (k.ups.tap4 ? .03 : 0))) * (rushUntil > Date.now() ? 7 : 1); };
const priceOf = (i, owned, n = 1) => { let s = 0; for (let j = 0; j < n; j++) s += Math.ceil(HIRE[i][1] * Math.pow(PRICE_UP, owned + j)); return s; };
// 大きな数は「1.2万」「3.4億」のように
export function fmtM(n) {
  n = Math.floor(n);
  if (n < 1e4) return n.toLocaleString('ja-JP');
  const u = [[1e16, '京'], [1e12, '兆'], [1e8, '億'], [1e4, '万']].find(([v]) => n >= v);
  const x = n / u[0];
  return `${x >= 1000 ? Math.floor(x).toLocaleString('ja-JP') : x >= 100 ? x.toFixed(0) : x.toFixed(1)}${u[1]}`;
}
const fmtRate = n => n < 10 ? n.toFixed(1) : fmtM(n);
const fmtX = n => n < 100 ? String(+n.toFixed(2)) : fmtM(n);  // 倍率（1.25倍・1.56倍…）
// 遺物（夜渡りの強化を含む）で、今買えるようになっているもの
function upgradesShown(k) {
  const list = RELICS.filter(([id, , , , need]) => !k.ups[id] && k.total >= need).map(([id, name, desc, cost]) => ({ id, name, desc, cost }));
  HIRE.forEach(([id, base], i) => {
    const n = k.hires[id] || 0, nm = H.CHAR[id]?.name || id;
    if (n >= 10 && !k.ups[`h10:${id}`]) list.push({ id: `h10:${id}`, name: `${nm}の心得`, desc: `${nm}の稼ぎが2倍`, cost: base * 60, char: id });
    if (n >= 25 && !k.ups[`h25:${id}`]) list.push({ id: `h25:${id}`, name: `${nm}の極意`, desc: `${nm}の稼ぎがさらに2倍`, cost: base * 1500, char: id });
  });
  return list.sort((a, b) => a.cost - b.cost);
}
// 戦果ボーナス：記録タブで、前に受け取ったあとに記録された勝ち負け（サンプルは数えない）
function warSpoils(k) {
  // はじめて受け取るときは、これまでの記録の新しい50戦まで（記録が多い人が、最初から一気に進みすぎないように）
  const runs = H.liveRuns().filter(r => !r.sample && (r.updatedAt || 0) > (k.claimAt || 0)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, k.claimAt ? Infinity : 50);
  const w = runs.filter(r => r.result === 'win').length, l = runs.length - w;
  return { w, l, gain: w * Math.max(100, prodOf(k) * 300) + l * Math.max(20, prodOf(k) * 60) };
}

// ---------- 動き（叩く・時間がたつ・常夜の小壺・戦い） ----------
let tuckTimer = null;
let loop = null, lastTick = 0, lastSave = 0, rushUntil = 0, jar = null, nextJarAt = 0, fight = null, combo = 0;
const $ = id => document.getElementById(id);
function gain(k, n) { k.mark += n; k.total += n; }
function scheduleJar(k) { nextJarAt = Date.now() + (50 + Math.random() * 100) * 1000 / (k.ups.jar1 ? 2 : 1); }
function tick() {
  const k = st(), now = Date.now(), dt = Math.min(1, (now - (lastTick || now)) / 1000); lastTick = now;
  const p = prodOf(k);
  gain(k, p * dt);
  if (fight) { fight.hp -= p * dt; if (fight.hp <= 0) endFight(true); else if (now >= fight.end) endFight(false); }
  if (!nextJarAt) scheduleJar(k);
  if (!jar && now >= nextJarAt && H.tab() === 'kotsubo') showJar();
  if (jar && now >= jar.until) hideJar(true);
  if (now - lastSave > 5000) { lastSave = now; k.lastAt = now; H.save(); }
  if (H.tab() === 'kotsubo') paint(k);
}
// 画面の数字だけを書き換える
function paint(k) {
  const m = $('k-mark'); if (!m) return;
  m.textContent = fmtM(k.mark);
  $('k-rate').textContent = `毎秒 ${fmtRate(prodOf(k))}・1回 ${fmtRate(tapOf(k))}`;
  const sub = $('appsub'); if (sub) sub.textContent = kotsuboSub();
  document.querySelectorAll('[data-kcost]').forEach(b => b.classList.toggle('cant', k.mark < +b.dataset.kcost));
  const r = $('k-rush'); if (r) r.hidden = !(rushUntil > Date.now());
  if (fight) {
    const bar = $('k-boss-hp'), t = $('k-boss-time');
    if (bar) bar.style.width = `${Math.max(0, fight.hp / fight.max) * 100}%`;
    if (t) t.textContent = `残り ${Math.max(0, Math.ceil((fight.end - Date.now()) / 1000))}秒・体力 ${fmtM(Math.max(0, fight.hp))}`;
  }
}
function floatText(x, y, text, cls = '') {
  const fx = $('k-fx'); if (!fx) return;
  const el = document.createElement('span'); el.className = `k-float ${cls}`; el.textContent = text;
  const box = fx.getBoundingClientRect(); el.style.left = `${x - box.left}px`; el.style.top = `${y - box.top}px`;
  fx.appendChild(el); setTimeout(() => el.remove(), 900);
}
function tapMerchant(e) {
  const k = st(), v = tapOf(k);
  k.taps++; combo++;
  if (fight) { fight.hp -= v * FIGHT_TAP; floatText(e.clientX, e.clientY, `-${fmtM(v * FIGHT_TAP)}`, 'hit'); if (fight.hp <= 0) endFight(true); }
  else { gain(k, v); floatText(e.clientX, e.clientY, `+${fmtM(v)}`); }
  // 叩かれると、ぴょこっと縮んで腕をしまう。叩くのをやめると、また腕を伸ばす
  const art = $('k-art'); if (art) { art.classList.remove('bonk'); void art.offsetWidth; art.classList.add('bonk', 'tuck'); clearTimeout(tuckTimer); tuckTimer = setTimeout(() => $('k-art')?.classList.remove('tuck'), 280); }
  if (combo % 12 === 0) { const s = $('k-say'); if (s) { s.textContent = LINES[Math.floor(Math.random() * LINES.length)]; s.classList.remove('show'); void s.offsetWidth; s.classList.add('show'); } }
  paint(k);
}
function showJar() {
  const area = $('k-stage'); if (!area) return;
  jar = { until: Date.now() + 8000 };
  const el = document.createElement('button'); el.id = 'k-jar'; el.className = 'k-jar'; el.setAttribute('aria-label', '常夜の小壺'); el.textContent = '🏺';
  el.style.left = `${10 + Math.random() * 70}%`; el.style.top = `${10 + Math.random() * 55}%`;
  area.appendChild(el);
}
function hideJar(missed) { $('k-jar')?.remove(); jar = null; scheduleJar(st()); if (missed) H.toast('常夜の小壺は逃げていった…'); }
function tapJar(e) {
  const k = st(); k.jars = (k.jars || 0) + 1;
  if (Math.random() < .3) { rushUntil = Date.now() + 12000; floatText(e.clientX, e.clientY, '常夜ラッシュ！', 'gold'); H.toast('常夜ラッシュ！12秒間、叩く力が7倍'); }
  else { const g = Math.max(prodOf(k) * 90, tapOf(k) * 30, 50); gain(k, g); floatText(e.clientX, e.clientY, `+${fmtM(g)}`, 'gold'); H.toast(`常夜の小壺から ${fmtM(g)} マーク！`); }
  hideJar(false); paint(k);
}
function endFight(win) {
  const k = st(), f = fight; fight = null;
  if (win) { k.lords = Math.max(k.lords || 0, f.i + 1); H.toast(`${H.LORD[BOSSES[f.i][0]]?.name}を討伐！すべての稼ぎが1.25倍に`); }
  else H.toast(`${H.LORD[BOSSES[f.i][0]]?.name}に逃げられた…稼いでから、また挑もう`);
  H.save(); H.render();
}
// 叩く・常夜の小壺は、指が触れた瞬間に反応させる（click を待つと連打が遅れるため）
document.addEventListener('pointerdown', e => {
  if (e.target.closest?.('#k-jar')) { e.preventDefault(); tapJar(e); return; }
  if (e.target.closest?.('#k-tap')) { e.preventDefault(); tapMerchant(e); }
});
// 開発用の画面（localhost）でだけ、動作確認のために常夜の小壺をすぐ出せるようにする
if (window.__DEV__) window.__kotsubo = { jarNow: () => { nextJarAt = 1; } };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && H) { st().lastAt = Date.now(); H.save(); } });

// タブを開いたとき：留守の間の稼ぎを入れて、動かし始める
// （ほかのタブを開いているときは、お知らせは小壺タブを開くまで取っておく）
let awayMsg = 0;
export function startKotsubo() {
  const k = st(), now = Date.now(), away = Math.min(8 * 3600e3, now - (k.lastAt || now));
  if (away > 60e3 && prodOf(k) > 0) { const g = prodOf(k) * away / 1000 * (k.ups.off1 ? .9 : .5); gain(k, g); awayMsg += g; }
  if (awayMsg && H.tab() === 'kotsubo') { H.toast(`留守の間に ${fmtM(awayMsg)} マーク稼いでいました`); awayMsg = 0; }
  k.lastAt = now; lastTick = now;
  if (!loop) loop = setInterval(tick, 100);
}

// ---------- 画面 ----------
// 小壺の絵（icons/kotsubo/jar.svg）は、腕を動かすために画面の中へそのまま入れる。読み込むまでは画像として出す
let JAR = null;
const jarArt = () => JAR || '<img src="icons/kotsubo/jar.svg" alt="小壺" draggable="false">';
fetch('icons/kotsubo/jar.svg').then(r => r.ok ? r.text() : Promise.reject()).then(t => { JAR = t.replace(/<!--[\s\S]*?-->/g, ''); const a = $('k-art'); if (a) a.innerHTML = JAR; }).catch(() => {});
export function viewKotsubo() {
  const k = st(), esc = H.esc, n = S().buyN || 1;
  const nextBoss = BOSSES[k.lords || 0], spoils = warSpoils(k), ups = upgradesShown(k);
  const bossCard = fight ? `<div class="k-boss fighting"><div class="k-boss-h">${H.ico('lord', BOSSES[fight.i][0])}<b>${esc(H.LORD[BOSSES[fight.i][0]]?.name)}と戦闘中</b></div>
      <div class="k-hp"><span id="k-boss-hp" style="width:${fight.hp / fight.max * 100}%"></span></div><div class="hint" id="k-boss-time"></div>
      <p class="hint">小壺を叩くと、叩く力の${FIGHT_TAP}倍のダメージ。雇った夜渡りも毎秒削ります。</p></div>`
    : nextBoss ? `<div class="k-boss"><div class="k-boss-h">${H.ico('lord', nextBoss[0])}<b>${esc(H.LORD[nextBoss[0]]?.name)}</b><span class="hint">体力 ${fmtM(nextBoss[1])}</span></div>
      <p class="hint">${FIGHT_SEC}秒のうちに削り切れば討伐。討伐するたびに、すべての稼ぎが永久に1.25倍（今 ${fmtX(globalMult(k))}倍）</p>
      <button class="primary small-primary" data-act="kFight">挑む</button></div>`
    : `<div class="k-boss done"><b>🌅 すべての夜の王を討伐しました</b><p class="hint">夜明けの小壺。稼ぎは今 ${fmtX(globalMult(k))}倍です。</p></div>`;
  const hireRows = HIRE.map(([id, , base, say], i) => {
    const own = k.hires[id] || 0, cost = priceOf(i, own, n), visible = i === 0 || (k.hires[HIRE[i - 1][0]] || 0) > 0 || k.total >= HIRE[i][1] / 2;
    if (!visible) return `<div class="k-row locked"><span class="k-ico">？</span><span class="k-main"><b>？？？</b><small>もっと稼ぐと現れる</small></span></div>`;
    return `<button class="k-row" data-act="kHire" data-v="${id}" data-kcost="${cost}">${H.ico('char', id)}<span class="k-main"><b>${esc(H.CHAR[id]?.name)}<i>${own}人</i></b><small>${esc(say)}・1人 毎秒${fmtRate(base * hireMult(k, id) * globalMult(k))}</small></span><span class="k-cost">${fmtM(cost)}</span></button>`;
  }).join('');
  const upRows = ups.length ? ups.map(u => `<button class="k-row up" data-act="kUp" data-v="${u.id}" data-kcost="${u.cost}">${u.char ? H.ico('char', u.char) : '<span class="k-ico">💎</span>'}<span class="k-main"><b>${esc(u.name)}</b><small>${esc(u.desc)}</small></span><span class="k-cost">${fmtM(u.cost)}</span></button>`).join('')
    : '<p class="hint">もっと稼ぐと、新しい遺物が並びます。</p>';
  return `<div class="stack-lg kotsubo">
    <button class="ghost back-btn" data-act="kotsuboBack">‹ もどる</button>
    <section class="card-sec k-top">
      <div class="k-mark"><span id="k-mark">${fmtM(k.mark)}</span><small>マーク</small></div>
      <div class="hint k-rate" id="k-rate"></div>
      <div class="k-stage" id="k-stage">
        <button class="k-tap" id="k-tap" aria-label="小壺を叩く"><span class="k-art" id="k-art">${jarArt()}</span></button>
        <span class="k-say" id="k-say"></span><span class="k-rush" id="k-rush" hidden>常夜ラッシュ中！×7</span><div class="k-fx" id="k-fx" aria-hidden="true"></div>
      </div>
      <p class="hint k-hint">小壺を叩くとマークがたまる。ときどき出る🏺（常夜の小壺）は、すぐ叩くとボーナス</p>
    </section>
    ${spoils.w + spoils.l ? `<div class="k-spoils"><span>⚔️ 戦果ボーナス：記録した勝利${spoils.w}・敗北${spoils.l}<small>→ ${fmtM(spoils.gain)} マーク</small></span><button class="primary small-primary" data-act="kClaim">受け取る</button></div>` : ''}
    <section class="card-sec">${bossCard}</section>
    <section class="card-sec"><div class="sec-head"><h2>遺物</h2></div><div class="k-list">${upRows}</div></section>
    <section class="card-sec"><div class="sec-head"><h2>夜渡りを雇う</h2><div class="chips">${[1, 10].map(x => `<button class="chip mini" data-act="kBuyN" data-v="${x}" aria-pressed="${n === x}">×${x}</button>`).join('')}</div></div>
      <div class="k-list">${hireRows}</div></section>
    <p class="hint k-stats">これまで：${fmtM(k.total)} マーク・${fmtM(k.taps)} 回叩いた・常夜の小壺 ${k.jars || 0} 回・討伐 ${k.lords || 0}/${BOSSES.length}</p>
    <button class="link-btn dim-link k-reset ${S().confirmReset ? 'danger-text' : ''}" data-act="kReset">${S().confirmReset ? 'もう一度押すと、小壺のデータを最初からにします' : '最初からやり直す'}</button>
  </div>`;
}
const S = () => H.ui();  // 画面だけの一時的な状態（まとめ買いの数・やり直しの確認）

// ボタンを押したとき（app.js の click から呼ばれる）。true を返すと画面を作り直す
export function kotsuboAct(a, v) {
  const k = st(), ui = S();
  if (a !== 'kReset') ui.confirmReset = false;
  if (a === 'kBuyN') { ui.buyN = +v; return true; }
  if (a === 'kHire') {
    const i = HIRE.findIndex(([id]) => id === v); if (i < 0) return false;
    const n = ui.buyN || 1, cost = priceOf(i, k.hires[v] || 0, n);
    if (k.mark < cost) { H.toast('マークが足りません'); return false; }
    k.mark -= cost; k.hires[v] = (k.hires[v] || 0) + n; return true;
  }
  if (a === 'kUp') {
    const u = upgradesShown(k).find(x => x.id === v); if (!u) return false;
    if (k.mark < u.cost) { H.toast('マークが足りません'); return false; }
    k.mark -= u.cost; k.ups[v] = 1; H.toast(`「${u.name}」を手に入れた`); return true;
  }
  if (a === 'kFight') {
    const i = k.lords || 0; if (!BOSSES[i] || fight) return false;
    fight = { i, hp: BOSSES[i][1], max: BOSSES[i][1], end: Date.now() + FIGHT_SEC * 1000 }; return true;
  }
  if (a === 'kClaim') { const s = warSpoils(k); gain(k, s.gain); k.claimAt = Date.now(); H.toast(`戦果ボーナス ${fmtM(s.gain)} マーク！`); return true; }
  if (a === 'kReset') {
    if (!ui.confirmReset) { ui.confirmReset = true; return true; }
    ui.confirmReset = false; fight = null; delete H.prefs().kotsubo; H.toast('小壺のデータを最初からにしました'); return true;
  }
  return false;
}
// 上の小さな文字（タブを開いているとき）
export const kotsuboSub = () => { const k = st(); return `${fmtM(k.mark)} マーク・毎秒 ${fmtRate(prodOf(k))}`; };
