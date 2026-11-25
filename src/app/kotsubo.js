// 「小壺」タブのミニゲーム：小壺を叩いてマークをためる（オリジナルの放置系ゲーム）。
// - 叩く：マークが入る。遺物で叩く力が上がる
// - 夜渡りを雇う：自動でマークが入る（雇うほど値段が上がる。10人・25人で強化の遺物が出る）
// - 夜の王に挑む：30秒のうちに体力を削り切れば討伐。討伐するたびに、すべての稼ぎが永久に1.25倍
// - 深き壺に潜る：10体すべて討伐すると、深度を1つ上げて周回できる（強くてニューゲーム）。マークと雇った夜渡りは最初に戻り、
//   夜の王の討伐ボーナス（bank に貯める）と遺物はすべて残る（頑張った分は消さず、どんどん数字が大きくなる方向）。深度は5まで。
//   難易度は2つ（夜の王の欄の下で切り替える。効くのは深度1から。戦い中は不可）。深き壺・難易度は、潜れるようになるまで画面にも遊び方にも出さない（たどり着いた人だけが知る）。体力の倍率は試算（使い捨ての計算）で決めた：
//   稼ぎの倍率（DEPTH_GAIN）を深度ごとに大きく上げて、数字がどんどん大きくなるようにしている（深度5のナメレスは澗＝10の36乗の桁）。
//   普通＝放置が多い人（1秒に2回叩き、アイテムなし）で、各深度が約1日。よく叩く人・アイテムを使う人にはかなり易しい
//   高難易度＝6本指で叩く人（ふだん1秒に8回、戦いで25回、アイテムも使う）で、各深度が約1日。1本指の人にはとても硬い
//   （いずれも小壺を開いて遊び続けた場合の試算。留守の稼ぎ・常夜の王・消えぬ爪痕・時間で弱るしくみは入れていない）
//   合わない遊び方だとナメレスで止まりやすい。深度3までは下の「詰み防止」で、止まっても時間とともに抜けられる。深度4・5は詰み防止なし（本気の深さ）
// - 常夜の小壺：ときどき紫の小壺が出る。すぐ叩くとボーナス
// - 戦果ボーナス：記録タブで記録した勝ち負けが、マークになる
// - 留守の間も、ゆっくり稼ぐ（最大8時間）
// 進み具合は prefs().kotsubo に入る（自動バックアップにも入る）。画面の数字は render せずに、ここで直接書き換える（叩くたびに作り直すと重いため）

let H = null;  // app.js から渡されるもの（prefs, save, toast, render, liveRuns, ico, esc, CHAR, LORD）
export function initKotsubo(helpers) {
  H = helpers;
  // 開発用の画面だけ：アドレスの最後に #kotsubo-all を付けて開くと、遺物（夜渡りの心得・極意も）をすべて持った状態にする（所持遺物の確かめ用）
  if (window.__DEV__ && location.hash === '#kotsubo-all') {
    const k = st();
    RELICS.forEach(([id]) => { k.ups[id] = 1; });
    HIRE.forEach(([id]) => { k.ups[`h10:${id}`] = 1; k.ups[`h25:${id}`] = 1; });
    ITEMS.forEach(([id]) => giveItem(k, id, 10));  // アイテムも10個ずつ
    history.replaceState(null, '', location.pathname); H.save();
    setTimeout(() => H.toast('開発用：遺物をすべて持った状態にしました'), 500);
  }
}

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
// 遺物のフレーバーテキスト（「所持遺物」で遺物を押すと出る）。\n で改行
const FLAVOR = {
  tap1: '壺を叩き続けた者の指先。\n爪は削れ、皮は石のように硬い。\n\n流れの商人は言う。\n叩けぬ指に、マークは宿らぬと',
  tap2: '拳に鉛を握り込む、古い壺打ちの作法。\n\n一打ごとに骨が軋むが、壺はよく鳴る。\n鳴る壺は、よく稼ぐ',
  tap3: '夜ごと研ぎ澄まされた、商人の勘。\n叩いた音の重さで、壺の中身が分かるという。\n\nすなわち稼ぎとは、耳で聞くものなのだ',
  jar1: '常夜の小壺は、甘く湿った匂いをまとう。\n\nそれを嗅ぎ分けた者は少なく\n捕らえた者は、さらに少ない。\n逃げた壺がどこへ行くのか、誰も知らない',
  tap4: '黄金に鍍金された打ち手。かつての大商人の遺品。\n\nその者は壺を叩きすぎ\nついには壺の中へ消えたという。\n壺は今も、ときおり内側から鳴る',
  off1: '主の帰りを待ち続ける、小さな壺。\n誰もいない夜にも、律儀にマークを数えている。\n\n待つことだけが、この壺の取り柄である',
  tap5: '夜の終わりに放たれた、ただ一度の打撃の記憶。\nその一打で、ある夜は明けたという。\n\nならば明けぬ夜とは\n叩き足りぬ夜のことなのだろう',
};
// 夜渡りの強化の遺物：[心得, 極意]
const CHAR_FLAVOR = {
  wylder: ['追跡者が、鉤縄とともに覚えた壺の引き寄せ方。\n\n遠くの壺ほど、よく稼ぐ。\n追う者は、いつも獲物の重さを知っている', '鉤縄が届く前に、壺の方から寄ってくるようになった。\n\nそれを極意と呼ぶか、呪いと呼ぶか。\n答えは、追跡者だけが知っている'],
  guardian: ['守護者の盾は、壺を割らぬためにある。\n\n守られた壺は、割れた壺より多くを残す。\nそれだけの、古い教えである', '盾の陰で眠る壺は、夢の中でもマークを数える。\n\n守護者は、その寝息を聞き分ける。\n一つたりとも、取りこぼさぬように'],
  ironeye: ['鉄の目は、闇の底の壺をも見逃さない。\n\n見えた壺は、もう半ば手の内にある。\n狩人の理とは、そういうものだ', '射抜くのは壺ではない。\n壺の中の、まだ生まれぬマークである。\n\n鉄の目が瞬きをしないのは、そのためだ'],
  duchess: ['レディは、一度叩いた壺をもう一度叩く。\n\n過ぎた打撃は、裏切らぬ記憶となる。\n少なくとも、壺の中では', '過去は繰り返せる。\nレディはそれを知っていて、微笑みで隠す。\n\n二度鳴った壺は、三度目も鳴るのだ'],
  raider: ['無頼漢は壺を叩かない。持ち上げて、揺さぶる。\n\n作法などない。\nだが、よく出る', '揺さぶりすぎた壺から\nついには、壺そのものが転がり出た。\n\n無頼漢は、それも売った'],
  revenant: ['復讐者の呼び声に、名もなき者たちが応える。\n\n彼らは何も求めず、ただ叩く。\nかつて自分が叩かれたように', '呼ばれた者の数は、もう誰にも数えられない。\n\nただ壺の鳴る音だけが\n彼らがそこにいることを証している'],
  recluse: ['隠者の魔術は、散らばったマークを一つに束ねる。\n\n魔術とは、つまるところ\n集めることなのだ', '束ねられたマークは\nやがて隠者自身をも引き寄せはじめた。\n\nそれでも隠者は、集めることをやめない'],
  executor: ['執行者の打撃は、音より先に届く。\n\n壺は、叩かれたことに\nあとから気づくのだという', '刃を納める音がしたとき\nすでに百度、叩き終えている。\n\nそれが執行者の作法である'],
  scholar: ['学者は、壺を叩く前に壺を測る。\n\n数えること。比べること。\nそして、増やすこと', '学者の手帳の、最後の頁。\nそこには、ただ一行だけが残されていた。\n\n「マークは、マークを生む」'],
  undertaker: ['葬儀屋は、眠ったマークの在処を知っている。\n\n土の下にも、稼ぎはある。\n弔いとは、掘り起こすことでもある', '弔われたものは、ふたたび掘り起こされる。\n\nそれが慈悲か、冒涜か。\n葬儀屋は、問わない'],
};
// アイテム（使うとなくなる）：[id, 絵, 名前, 使うと, フレーバーテキスト]
// 手に入れ方（ITEM_DROP）：夜の王を討伐したとき・常夜の小壺を叩いたときに、それぞれの確率で。買うことはできない。持てるのは種類ごとに99個まで
// scar（消えぬ爪痕）：使うと、次の夜の王との戦い（戦い中に使えばその戦い）で削った体力が、逃げられても残る。倒すか潜るまで残り、普通の戦いで逃げられても戻らない
const ITEMS = [
  ['rush', '🕯️', '常夜の香', 'すぐに常夜ラッシュ（12秒間、叩く力が7倍）', '常夜の小壺の欠片を練り込んだ香。\n火を灯せば、ひととき夜が深くなる。\n\n深い夜ほど、壺はよく鳴く。\nそれを知る者は、香を絶やさない'],
  ['scar', '🩸', '消えぬ爪痕', '使ってから夜の王に挑むと、逃げられても削った体力がそのまま残る', '夜の王に刻まれた、ひとすじの傷。\n血は乾いても、その痛みは消えない。\n\n王は逃げる。だが傷は残る。\n次に相まみえるとき、王はそれを思い出すだろう'],
];
const ITEM_DROP = { rush: { lord: 1, jar: .1 }, scar: { lord: 0, jar: 0 } };  // 討伐したとき・常夜の小壺のときに手に入る確率（消えぬ爪痕は、深き壺の常夜の王を倒したときだけ。必ず手に入る）
const ITEM = Object.fromEntries(ITEMS.map(x => [x[0], x])), ITEM_MAX = 8;
// アイテムは1種類につき8個まで（上限を決める前に多く持っていた人も、8個に揃える）
const itemsOf = k => { const it = (k.items ||= {}); for (const id in it) if (it[id] > ITEM_MAX) it[id] = ITEM_MAX; return it; };
// アイテムの行（持っている数・使えるか）だけを書き換える
function paintItem(k, id) {
  const c = $(`k-item-${id}`); if (!c) return;
  const n = itemsOf(k)[id] || 0, row = c.closest('.k-item'); c.textContent = n; row?.classList.toggle('none', !n);
  const b = row?.querySelector('.k-use'); if (b) b.disabled = !n || itemOff(k, id);
}
// 1回の夜の王との戦いで使えるアイテムは1つまで（挑む前に刻んだ爪痕・挑む時に燃えている香も1つと数える）
const ITEM_PER_FIGHT = 1;
const itemOff = (k, id) => fight ? (fight.items || 0) >= ITEM_PER_FIGHT : id === 'scar' && !!k.scarReady;
// 消えぬ爪痕の印（使ったあと・戦い中）と、残っている傷（削った体力）の表示
const scarText = k => fight ? (fight.scar ? '🩸 爪痕を刻んだ：この戦いで削った体力は、逃げられても残る' : '')
  : [k.scarReady ? '🩸 爪痕を刻んだ：次の戦いで削った体力は、逃げられても残る' : '', k.scarHp && k.scarHp.i === (k.lords || 0) ? `🩸 王には傷が残っている（残り体力 ${Math.ceil(k.scarHp.frac * 100)}%）` : ''].filter(Boolean).join('<br>');
function paintScar(k) { const el = $('k-scar'); if (el) { el.innerHTML = scarText(k); el.hidden = !el.innerHTML; } }
function giveItem(k, id, n = 1) { const it = itemsOf(k); const before = it[id] || 0; it[id] = Math.min(ITEM_MAX, before + n); return it[id] - before; }
// 持っている遺物（買った順ではなく、売り場の並び→夜渡りの強化の順）
function ownedRelics(k) {
  const list = RELICS.filter(([id]) => k.ups[id]).map(([id, name, desc]) => ({ id, name, desc, flavor: FLAVOR[id] }));
  HIRE.forEach(([id]) => { const nm = H.CHAR[id]?.name || id;
    if (k.ups[`h10:${id}`]) list.push({ id: `h10:${id}`, name: `${nm}の心得`, desc: `${nm}の稼ぎが2倍`, flavor: CHAR_FLAVOR[id]?.[0], char: id });
    if (k.ups[`h25:${id}`]) list.push({ id: `h25:${id}`, name: `${nm}の極意`, desc: `${nm}の稼ぎがさらに2倍`, flavor: CHAR_FLAVOR[id]?.[1], char: id }); });
  return list;
}
// 夜の王：討伐する順番と体力
const BOSSES = [['gladius', 500], ['adel', 6000], ['gnoster', 6e4], ['maris', 5e5], ['libra', 4e6], ['fulghor', 3.5e7], ['caligo', 3e8], ['harmonia', 2.5e9], ['strages', 2e10], ['final', 2e11]];
// 深き壺：深度0〜5ごとの、夜の王の体力の倍率と稼ぎの倍率
const DEPTH_GAIN = [1, 100, 1e5, 1e9, 1e14, 1e20], DEPTH_MAX = DEPTH_GAIN.length - 1;
const DEPTH_HP = { normal: [1, 780, 7.3e6, 6.8e11, 6.3e17, 5.9e24], hard: [1, 2e4, 2.2e8, 2e13, 1.9e19, 1.7e26] };  // 雇う値段を深度に合わせて上げたうえでの試算
const DIFFS = [['normal', '普通'], ['hard', '高難易度']];
// 深度4からは高難易度でしか挑めない（普通は選べない。壺を叩く者だけが進める深さ）
const HARD_ONLY_DEPTH = 4;
const hardOnly = k => depthOf(k) >= HARD_ONLY_DEPTH;
const diffOf = k => hardOnly(k) || k.diff === 'hard' ? 'hard' : 'normal';
const diffNote = k => hardOnly(k) ? `深度${HARD_ONLY_DEPTH}からは高難易度でしか挑めません。壺を叩かぬ者に、この先はない`
  : `${diffOf(k) === 'hard' ? '高難易度：たくさん叩いて遊ぶ人向け。深き壺の夜の王がずっと硬い' : '普通：放置して遊ぶことが多い人向け'}（いつでも切り替えられます）`;
const depthOf = k => Math.min(k.depth || 0, DEPTH_MAX);
// 詰み防止（深度3まで）：同じ夜の王の前で1日（WEAK_AFTER）たっても倒せなければ、そこから時間とともに弱っていく（12時間ごとに体力が半分）。
// 時刻で数えるので、挑んで逃げられる回数を増やしても早くはならない。アプリを閉じている間も進む。k.lordAt＝今の王に挑めるようになった時刻。
// 深度4・5は、普通でも高難易度でも「本気で挑む深さ」なので、弱らない
const WEAK_AFTER = 24 * 3600e3, WEAK_HALF = 12 * 3600e3, WEAK_MAX_DEPTH = 3;
const weakOf = k => { if (depthOf(k) > WEAK_MAX_DEPTH) return 1; const over = Date.now() - (k.lordAt || Date.now()) - WEAK_AFTER; return over > 0 ? Math.max(1e-9, Math.pow(.5, over / WEAK_HALF)) : 1; };
// 深き壺（深度1から）：夜の王の順番は潜るたびにランダム（k.order）。体力は「何体目か」で決まるので、硬さの上がり方は同じ。
// そのうち一部は常夜の王（EVER_P の確率。常夜のない王は除く）。常夜の王を倒すと、必ず🩸消えぬ爪痕が手に入る
const EVER_P = .12, SCAR_KEEP_DEPTH = 3;
function makeOrder() {
  const ids = BOSSES.map(b => b[0]);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids.map(id => ({ id, ever: H.LORD[id]?.everdark !== false && Math.random() < EVER_P }));
}
function orderOf(k) { if (!depthOf(k)) return null; if (!Array.isArray(k.order) || k.order.length !== BOSSES.length) k.order = makeOrder(); return k.order; }
const foeAt = (k, i) => orderOf(k)?.[i] || { id: BOSSES[i][0], ever: false };
const foeName = f => `${f.ever ? '常夜の' : ''}${H.LORD[f.id]?.name ?? f.id}`;
const foeIco = f => H.ico('lord', f.id, f.ever);
const bossHp = (k, i) => BOSSES[i][1] * DEPTH_HP[diffOf(k)][depthOf(k)] * (i === (k.lords || 0) ? weakOf(k) : 1);
const FIGHT_SEC = 30, FIGHT_TAP = 10;  // 戦いでは、叩く力の10倍のダメージ
// 夜渡りの加勢：戦いで1回叩くたびに、雇った夜渡りの毎秒マークの2%も上乗せ（×10）。1秒に5回叩くと、毎秒マークと同じくらい削れる。
// 夜渡りは自分では戦わない（叩かないと勝てない）が、雇うほど1回の叩きが重くなる
const KASEI = .02;
const hitOf = k => (tapOf(k) + KASEI * prodOf(k)) * FIGHT_TAP;
const LINES = ['まいど！', 'いい壺あるよ', '痛っ…でも稼げる', 'もっと叩いて！', 'マークは裏切らない', '夜は長いよ', '壺は割らないでね', '今日も商売繁盛', 'お客さん、いい腕だね', 'ひと叩き、ひと儲け'];

const st = () => {
  const p = H.prefs();
  const k = (p.kotsubo ||= { v: 1, mark: 0, total: 0, taps: 0, hires: {}, ups: {}, lords: 0, lastAt: Date.now(), claimAt: 0, jars: 0 });
  k.hires ||= {}; k.ups ||= {}; k.lordAt ||= Date.now();
  return k;
};
// ---------- 数え方 ----------
const hireMult = (k, id) => (k.ups[`h10:${id}`] ? 2 : 1) * (k.ups[`h25:${id}`] ? 2 : 1);
// 夜の王の討伐ボーナス（前の周回の分 bank も含む）×深度の稼ぎ
const globalMult = k => Math.pow(1.25, (k.bank || 0) + (k.lords || 0)) * DEPTH_GAIN[depthOf(k)];
const prodOf = k => HIRE.reduce((a, [id, , base]) => a + (k.hires[id] || 0) * base * hireMult(k, id), 0) * globalMult(k);
const tapOf = k => { const p = prodOf(k); return ((k.ups.tap1 ? 2 : 1) * (k.ups.tap2 ? 2 : 1) * (k.ups.tap5 ? 3 : 1) * globalMult(k) + p * ((k.ups.tap3 ? .01 : 0) + (k.ups.tap4 ? .03 : 0))) * (rushUntil > Date.now() ? 7 : 1); };
// 深き壺では、雇う値段（心得・極意も）を、その深度の稼ぎの倍率（潜る前の討伐ボーナス×深度の倍率）と同じだけ高くする。
// 値段が1周目のままだと、潜った直後から葬儀屋まで一瞬で雇えて、稼ぎが一気に跳ね上がってしまうため（v59 の公開直後に深度5まで1時間で抜けられた）。
// こうすると、深度ごとの「稼ぎ・値段・夜の王の硬さ」の釣り合いが1周目と同じになり、潜るたびに一から積み上げ直す形になる
const priceMult = k => depthOf(k) ? Math.pow(1.25, k.bank || 0) * DEPTH_GAIN[depthOf(k)] : 1;
const priceOf = (i, owned, n = 1, m = 1) => { let s = 0; for (let j = 0; j < n; j++) s += Math.ceil(HIRE[i][1] * m * Math.pow(PRICE_UP, owned + j)); return s; };
// 大きな数は「1.2万」「3.4億」のように
export function fmtM(n) {
  n = Math.floor(n);
  if (n < 1e4) return n.toLocaleString('ja-JP');
  // 大きな数の単位（万・億・兆…無量大数まで。それより上は「無量大数」の何倍かで出す）
  const u = [[1e68, '無量大数'], [1e64, '不可思議'], [1e60, '那由他'], [1e56, '阿僧祇'], [1e52, '恒河沙'], [1e48, '極'], [1e44, '載'], [1e40, '正'], [1e36, '澗'], [1e32, '溝'],
    [1e28, '穣'], [1e24, '秭'], [1e20, '垓'], [1e16, '京'], [1e12, '兆'], [1e8, '億'], [1e4, '万']].find(([v]) => n >= v);
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
    if (n >= 10 && !k.ups[`h10:${id}`]) list.push({ id: `h10:${id}`, name: `${nm}の心得`, desc: `${nm}の稼ぎが2倍`, cost: base * 60 * priceMult(k), char: id });
    if (n >= 25 && !k.ups[`h25:${id}`]) list.push({ id: `h25:${id}`, name: `${nm}の極意`, desc: `${nm}の稼ぎがさらに2倍`, cost: base * 1500 * priceMult(k), char: id });
  });
  return list.sort((a, b) => a.cost - b.cost);
}
// 戦果ボーナス：記録タブで、前に受け取ったあとに記録された勝ち負け（サンプルは数えない）。
// 「最初に記録した時刻」で数えるので、昔の戦績を直したり消して戻したりしても、もう一度は数えない
const madeAt = r => r.createdAt || r.updatedAt || 0;
function warSpoils(k) {
  // はじめて受け取るときは、これまでの記録の新しい50戦まで（記録が多い人が、最初から一気に進みすぎないように）
  const runs = H.liveRuns().filter(r => !r.sample && madeAt(r) > (k.claimAt || 0)).sort((a, b) => madeAt(b) - madeAt(a)).slice(0, k.claimAt ? Infinity : 50);
  const w = runs.filter(r => r.result === 'win').length, l = runs.length - w;
  return { w, l, gain: w * Math.max(100, prodOf(k) * 300) + l * Math.max(20, prodOf(k) * 60) };
}

// ---------- 動き（叩く・時間がたつ・常夜の小壺・戦い） ----------
let tuckTimer = null;
let loop = null, lastTick = 0, lastSave = 0, rushUntil = 0, itemRushUntil = 0, jar = null, nextJarAt = 0, fight = null, combo = 0, onTab = false;
const $ = id => document.getElementById(id);
function gain(k, n) { k.mark += n; k.total += n; }
function scheduleJar(k) { nextJarAt = Date.now() + (50 + Math.random() * 100) * 1000 / (k.ups.jar1 ? 2 : 1); }
function tick() {
  const now = Date.now();
  // ミニゲームの画面を開いていないときは、何もしない（端末への保存もしない）。
  // 離れた瞬間に、戦いと常夜の小壺はお知らせなしで終わらせ、離れた時刻を残す（稼ぎは、次に開いたときに「留守の間」としてまとめて入れる）
  if (H.tab() !== 'kotsubo') {
    if (onTab) { onTab = false; setLock(false); fight = null; rushUntil = itemRushUntil = 0; if (jar) { $('k-jar')?.remove(); jar = null; nextJarAt = 0; } st().lastAt = now; H.save(); }
    return;
  }
  onTab = true;
  const k = st(), dt = Math.min(1, (now - (lastTick || now)) / 1000); lastTick = now;
  const p = prodOf(k);
  gain(k, p * dt);
  if (fight && now >= fight.end) endFight(false);  // 夜の王は、叩いたダメージでしか削れない（夜渡りは稼ぐ係。叩かずには勝てない）
  if (!nextJarAt) scheduleJar(k);
  if (!jar && now >= nextJarAt) showJar();
  if (jar && !$('k-jar')) { const u = jar.until; showJar(); if (jar) jar.until = u; }  // 画面を作り直して小壺が消えたら、同じ残り時間で出し直す
  if (jar && now >= jar.until) hideJar(true);
  if (now - lastSave > 5000) { lastSave = now; k.lastAt = now; H.save(); }
  paint(k);
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
  if (fight) { const h = hitOf(k); fight.hp -= h; floatText(e.clientX, e.clientY, `-${fmtM(h)}`, 'hit'); if (fight.hp <= 0) endFight(true); }
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
  // ときどき、アイテムを落としていく（画面は作り直さず、持っている数だけ書き換える）
  ITEMS.forEach(([id, icon, name]) => { if (Math.random() < ITEM_DROP[id].jar) { const ok = giveItem(k, id);
    setTimeout(() => H.toast(ok ? `常夜の小壺が${icon}${name}を落としていった` : `${icon}${name}は、もう持ちきれない`), 1600); if (ok) paintItem(k, id); } });
  hideJar(false); paint(k);
}
function endFight(win) {
  const k = st(), f = fight; fight = null;
  if (win) { k.lords = Math.max(k.lords || 0, f.i + 1); k.lordAt = Date.now(); k.scarHp = null;
    // 落ちたアイテム：持ちきれない（8個）ものは、手に入らなかったことだけを添える
    const drop = ITEMS.filter(([id]) => Math.random() < ITEM_DROP[id].lord || (id === 'scar' && foeAt(k, f.i).ever)), got = [], full = [];
    drop.forEach(x => (giveItem(k, x[0]) ? got : full).push(x[1] + x[2]));
    H.toast(`${foeName(foeAt(k, f.i))}を討伐！すべての稼ぎが1.25倍に${got.length ? `（${got.join('・')}を手に入れた）` : ''}${full.length ? `（${full.join('・')}は持ちきれない）` : ''}`); }
  else if (f.scar) { k.scarHp = { i: f.i, frac: Math.max(0, f.hp / f.max) }; H.toast(`${foeName(foeAt(k, f.i))}に逃げられた…だが爪痕は残った（残り体力 ${Math.ceil(f.hp / f.max * 100)}%）`); }
  else H.toast(`${foeName(foeAt(k, f.i))}に逃げられた…稼いでから、また挑もう`);
  H.save(); if (H.tab() === 'kotsubo') H.render();
}
// 叩く・常夜の小壺は、指が触れた瞬間に反応させる（click を待つと連打が遅れるため）
document.addEventListener('pointerdown', e => {
  if (e.target.closest?.('#k-jar')) { e.preventDefault(); tapJar(e); return; }
  if (e.target.closest?.('#k-tap')) { e.preventDefault(); tapMerchant(e); }
});
// 画面ロック（右上の鍵）：オンの間は、叩くときに画面が動かないよう、スクロールを止める。小壺の画面を離れると外れる
let locked = false;
function setLock(on) {
  locked = on; document.documentElement.classList.toggle('k-locked', on);
  const b = document.querySelector('[data-act=kLock]');
  if (b) { b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); b.querySelector('.shackle')?.setAttribute('d', on ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 7.6-1.7'); }
}
const stopMove = e => { if (locked && !e.target.closest?.('.sheet')) e.preventDefault(); };
document.addEventListener('touchmove', stopMove, { passive: false });
document.addEventListener('wheel', stopMove, { passive: false });
// 開発用の画面（localhost）でだけ、動作確認のために常夜の小壺をすぐ出せるようにする
// 戦いの結果もすぐ出せる（win：倒す／hit(割合)：体力をその割合だけ削る／lose：時間切れにする）
if (window.__DEV__) window.__kotsubo = { jarNow: () => { nextJarAt = 1; }, win: () => { if (fight) { fight.hp = 0; endFight(true); } }, hit: x => { if (fight) fight.hp -= fight.max * x; }, lose: () => { if (fight) fight.end = 0; } };
// アプリを閉じる・切り替えるとき（ミニゲームを開いていたときだけ）、閉じた時刻を残す
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && H && H.tab() === 'kotsubo') { st().lastAt = Date.now(); H.save(); } });

// ミニゲームを開いたとき：離れていた間（アプリを閉じていた間・ほかの画面にいた間。最大8時間）の稼ぎを入れて、動かし始める
export function startKotsubo() {
  const k = st(), now = Date.now(), away = Math.min(8 * 3600e3, now - (k.lastAt || now));
  if (away > 1000 && prodOf(k) > 0) { const g = prodOf(k) * away / 1000 * (k.ups.off1 ? .9 : .5); gain(k, g); if (away > 60e3) H.toast(`留守の間に ${fmtM(g)} マーク稼いでいました`); }
  k.lastAt = now; lastTick = now; onTab = true;
  if (!loop) loop = setInterval(tick, 100);
}

// ---------- 画面 ----------
// 小壺の絵（icons/kotsubo/jar.svg）は、腕を動かすために画面の中へそのまま入れる。読み込むまでは画像として出す
let JAR = null;
const jarArt = () => JAR || '<img src="icons/kotsubo/jar.svg" alt="小壺" draggable="false">';
fetch('icons/kotsubo/jar.svg').then(r => r.ok ? r.text() : Promise.reject()).then(t => { JAR = t.replace(/<!--[\s\S]*?-->/g, ''); const a = $('k-art'); if (a) a.innerHTML = JAR; }).catch(() => {});
export function viewKotsubo() {
  const k = st(), esc = H.esc, n = S().buyN || 1;
  const nextBoss = BOSSES[k.lords || 0], d = depthOf(k), dTag = d ? `<span class="k-depth">深度${d}</span>` : '', spoils = warSpoils(k), ups = upgradesShown(k);
  const bossCard = fight ? `<div class="k-boss fighting"><div class="k-boss-h">${foeIco(foeAt(k, fight.i))}${dTag}<b>${esc(foeName(foeAt(k, fight.i)))}と戦闘中</b></div>
      <div class="k-hp"><span id="k-boss-hp" style="width:${fight.hp / fight.max * 100}%"></span></div><div class="hint" id="k-boss-time"></div>
      <p class="hint">小壺を叩くと、叩く力の${FIGHT_TAP}倍のダメージ。叩くたびに、雇った夜渡りが稼ぎ（毎秒マーク）に応じて加勢します（加勢 +${fmtM(KASEI * prodOf(k) * FIGHT_TAP)}・1回 ${fmtM(hitOf(k))}）。</p></div>`
    : nextBoss ? `<div class="k-boss"><div class="k-boss-h">${foeIco(foeAt(k, k.lords || 0))}${dTag}<b>${esc(foeName(foeAt(k, k.lords || 0)))}</b><span class="hint" id="k-boss-max">体力 ${fmtM(bossHp(k, k.lords || 0))}</span></div>${weakOf(k) < 1 ? `<p class="hint k-weak">長く戦い続けて、王は弱っている（体力 -${Math.round((1 - weakOf(k)) * 100)}%）</p>` : d > WEAK_MAX_DEPTH ? '<p class="hint k-weak">この深さの王は、時がたっても弱らない</p>' : ''}
      <p class="hint">${FIGHT_SEC}秒のうちに削り切れば討伐。討伐するたびに、すべての稼ぎが永久に1.25倍（今 ${fmtX(globalMult(k))}倍）</p>
      <button class="primary small-primary" data-act="kFight">挑む</button></div>`
    : d < DEPTH_MAX ? `<div class="k-boss done"><b>🌅 ${d ? `深度${d}の` : ''}すべての夜の王を討伐しました</b><p class="hint">稼ぎは今 ${fmtX(globalMult(k))}倍です。</p>
      <p class="hint">深き壺に潜ると、深度${d + 1}で最初から周回できます。マークと雇った夜渡りは最初に戻りますが、夜の王の討伐ボーナスと遺物はそのまま。深度${d + 1}では稼ぎが${fmtX(DEPTH_GAIN[d + 1])}倍になり、そのぶん夜の王も硬くなります（深度${DEPTH_MAX}まで）。${d + 1 >= HARD_ONLY_DEPTH ? `深度${HARD_ONLY_DEPTH}からは、高難易度でしか挑めません。` : ''}${d + 1 > SCAR_KEEP_DEPTH && (itemsOf(k).scar || itemsOf(k).rush) ? 'アイテムは、この先へは持っていけない。' : ''}</p>
      <button class="primary small-primary ${S().confirmDive ? 'danger' : ''}" data-act="kDive">${S().confirmDive ? 'もう一度押すと潜ります' : `深き壺に潜る（深度${d + 1}へ）`}</button></div>`
    : `<div class="k-boss done"><b>🌌 深度${DEPTH_MAX}のすべての夜の王を討伐しました</b><p class="hint">深き壺の底にたどり着きました。稼ぎは今 ${fmtX(globalMult(k))}倍です。</p>
      <p class="hint">壺の底から、深度1へ戻ることができます。マークと雇った夜渡りは最初に戻り、討伐のボーナスも1周目を終えたときの分に戻ります。遺物とアイテムはそのまま。</p>
      <button class="ghost small-primary ${S().confirmReturn ? 'danger' : ''}" data-act="kReturn">${S().confirmReturn ? 'もう一度押すと深度1へ戻ります' : '深度1に戻す'}</button></div>`;
  const hireRows = HIRE.map(([id, , base, say], i) => {
    const own = k.hires[id] || 0, cost = priceOf(i, own, n, priceMult(k)), visible = i === 0 || (k.hires[HIRE[i - 1][0]] || 0) > 0 || k.total >= HIRE[i][1] / 2;
    if (!visible) return `<div class="k-row locked"><span class="k-ico">？</span><span class="k-main"><b>？？？</b><small>もっと稼ぐと現れる</small></span></div>`;
    return `<button class="k-row" data-act="kHire" data-v="${id}" data-kcost="${cost}">${H.ico('char', id)}<span class="k-main"><b>${esc(H.CHAR[id]?.name)}<i>${own}人</i></b><small>${esc(say)}・1人 毎秒${fmtRate(base * hireMult(k, id) * globalMult(k))}</small></span><span class="k-cost">${fmtM(cost)}</span></button>`;
  }).join('');
  const upRows = ups.length ? ups.map(u => `<button class="k-row up" data-act="kUp" data-v="${u.id}" data-kcost="${u.cost}">${u.char ? H.ico('char', u.char) : '<span class="k-ico">💎</span>'}<span class="k-main"><b>${esc(u.name)}</b><small>${esc(u.desc)}</small></span><span class="k-cost">${fmtM(u.cost)}</span></button>`).join('')
    : '<p class="hint">もっと稼ぐと、新しい遺物が並びます。</p>';
  // 所持遺物：押すと効果とフレーバーテキストが開く
  const owned = ownedRelics(k), ownOpen = !!S().ownView;
  const ownRows = owned.length ? owned.map(u => { const open = S().relicOpen === u.id;
    return `<button class="k-row own ${open ? 'open' : ''}" data-act="kRelic" data-v="${esc(u.id)}" aria-expanded="${open}">${u.char ? H.ico('char', u.char) : '<span class="k-ico">💎</span>'}<span class="k-main"><b>${esc(u.name)}</b><small>${esc(u.desc)}</small></span><span class="go" aria-hidden="true">${open ? '−' : '+'}</span></button>
      <div class="k-flavor" data-flv="${esc(u.id)}" ${open ? '' : 'hidden'}>${esc(u.flavor || '').replace(/\n/g, '<br>')}</div>`; }).join('')
    : '<p class="hint">まだ遺物を持っていません。</p>';
  const ownBtn = `<button class="chip mini" data-act="kOwned" aria-pressed="${ownOpen}">${ownOpen ? '売り場へ' : `所持遺物 ${owned.length}`}</button>`;
  // アイテム：絵・名前・数と「使う」だけ。名前を押すと、効果とフレーバーテキストが開く（説明は開いたときだけ）
  const items = itemsOf(k), itemRows = ITEMS.map(([id, icon, name, desc, flavor]) => { const n = items[id] || 0, open = S().itemOpen === id;
    return `<div class="k-item ${open ? 'open' : ''} ${n ? '' : 'none'}"><button class="k-item-main" data-act="kItemInfo" data-v="${id}" aria-expanded="${open}"><span class="k-ico">${icon}</span><b>${esc(name)}</b><i id="k-item-${id}">${n}</i></button>
      <button class="ghost small k-use" data-act="kItemUse" data-v="${id}" ${n && !itemOff(k, id) ? '' : 'disabled'}>使う</button></div>
      <div class="k-flavor" data-flv="${id}" ${open ? '' : 'hidden'}><span class="k-eff">${esc(desc)}</span>${esc(flavor).replace(/\n/g, '<br>')}</div>`; }).join('');
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
    <section class="card-sec">${bossCard}<p class="hint k-scar" id="k-scar" ${scarText(k) ? '' : 'hidden'}>${scarText(k)}</p>${d || (k.lords || 0) >= BOSSES.length ? `<div class="k-diff"><span>難易度</span><div class="seg">${DIFFS.map(([v, l]) => `<button data-act="kDiff" data-v="${v}" aria-pressed="${diffOf(k) === v}" ${fight || (hardOnly(k) && v === 'normal') ? 'disabled' : ''}>${l}</button>`).join('')}</div></div>
      <p class="hint k-diff-note" id="k-diff-note">${diffNote(k)}</p>` : ''}</section>
    <section class="card-sec k-items"><div class="sec-head"><h2>アイテム</h2></div><div class="k-item-list">${itemRows}</div></section>
    <section class="card-sec"><div class="sec-head"><h2 id="k-relic-h">${ownOpen ? '所持遺物' : '遺物'}</h2>${ownBtn}</div><div class="k-list" id="k-own" ${ownOpen ? '' : 'hidden'}>${ownRows}</div><div class="k-list" id="k-shop" ${ownOpen ? 'hidden' : ''}>${upRows}</div></section>
    <section class="card-sec"><div class="sec-head"><h2>夜渡りを雇う</h2><div class="chips">${[1, 10].map(x => `<button class="chip mini" data-act="kBuyN" data-v="${x}" aria-pressed="${n === x}">×${x}</button>`).join('')}</div></div>
      <div class="k-list">${hireRows}</div></section>
    <p class="hint k-stats">これまで：${fmtM(k.total)} マーク・${fmtM(k.taps)} 回叩いた・常夜の小壺 ${k.jars || 0} 回・討伐 ${k.lords || 0}/${BOSSES.length}${d ? `・深度${d}` : ''}</p>
    <button class="link-btn dim-link k-reset ${S().confirmReset ? 'danger-text' : ''}" data-act="kReset">${S().confirmReset ? 'もう一度押すと、小壺のデータを最初からにします' : '最初からやり直す'}</button>
  </div>`;
}
// フレーバーテキストの開け閉め：画面を作り直さず、その場で出し入れする（作り直すと画面全体がカクつくため）
function showFlavor(act, openId) {
  document.querySelectorAll(`[data-act="${act}"]`).forEach(b => {
    const on = b.dataset.v === openId, row = b.closest('.k-item') || b;
    b.setAttribute('aria-expanded', String(on)); row.classList.toggle('open', on);
    const go = b.querySelector('.go'); if (go) go.textContent = on ? '−' : '+';
    const f = row.parentElement.querySelector(`.k-flavor[data-flv="${CSS.escape(b.dataset.v)}"]`); if (f) f.hidden = !on;
  });
}
const S = () => H.ui();  // 画面だけの一時的な状態（まとめ買いの数・やり直しの確認）

// ボタンを押したとき（app.js の click から呼ばれる）。true を返すと画面を作り直す
export function kotsuboAct(a, v) {
  const k = st(), ui = S();
  if (a !== 'kReset') ui.confirmReset = false;
  if (a !== 'kDive') ui.confirmDive = false;
  if (a !== 'kReturn') ui.confirmReturn = false;
  if (a === 'kLock') { setLock(!locked); H.toast(locked ? '画面をロックしました（もう一度押すと解除）' : '画面のロックを解除しました'); return false; }
  if (a === 'kItemInfo') { ui.itemOpen = ui.itemOpen === v ? null : v; showFlavor('kItemInfo', ui.itemOpen); return false; }
  if (a === 'kItemUse') {
    const it = itemsOf(k); if (!ITEM[v] || !(it[v] > 0)) return false;
    if (fight && (fight.items || 0) >= ITEM_PER_FIGHT) { H.toast('この戦いでは、もうアイテムを使った'); return false; }
    if (v === 'rush') {
      // 香は重ねて焚けない（燃えている間は使えない。続けて焚いて長いラッシュを作れないように）
      if (rushUntil > Date.now()) { H.toast('🕯️常夜の香は、まだ燃えている'); return false; }
      it.rush--; rushUntil = itemRushUntil = Date.now() + 12000; if (fight) fight.items = (fight.items || 0) + 1;
      H.toast('🕯️常夜の香を焚いた…常夜ラッシュ！12秒間、叩く力が7倍');
    }
    if (v === 'scar') {
      if (fight ? fight.scar : k.scarReady) { H.toast('🩸爪痕は、もう刻まれている'); return false; }
      if (!fight && !BOSSES[k.lords || 0]) { H.toast('挑む夜の王がいません'); return false; }
      it.scar--; if (fight) { fight.scar = true; fight.items = (fight.items || 0) + 1; } else k.scarReady = true;
      H.toast(fight ? '🩸爪痕を刻んだ…この戦いで削った体力は、逃げられても残る' : '🩸爪痕を刻んだ…次の戦いで削った体力は、逃げられても残る');
    }
    // 画面は作り直さず、持っている数・「使う」ボタン・効果中の印だけをその場で書き換える（作り直すとカクつくため）
    ITEMS.forEach(([id]) => paintItem(k, id)); paintScar(k);
    H.save(); paint(k); return false;
  }
  if (a === 'kOwned') {
    // 売り場と所持遺物は両方とも画面に入れておき、出し入れだけする（作り直すとカクつくため）
    ui.ownView = !ui.ownView; ui.relicOpen = null; showFlavor('kRelic', null);
    const on = ui.ownView, own = ownedRelics(k).length;
    $('k-shop')?.toggleAttribute('hidden', on); $('k-own')?.toggleAttribute('hidden', !on);
    const h = $('k-relic-h'); if (h) h.textContent = on ? '所持遺物' : '遺物';
    document.querySelectorAll('[data-act="kOwned"]').forEach(b => { b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '売り場へ' : `所持遺物 ${own}`; });
    return false;
  }
  if (a === 'kRelic') { ui.relicOpen = ui.relicOpen === v ? null : v; showFlavor('kRelic', ui.relicOpen); return false; }
  if (a === 'kBuyN') { ui.buyN = +v; return true; }
  if (a === 'kHire') {
    const i = HIRE.findIndex(([id]) => id === v); if (i < 0) return false;
    const n = ui.buyN || 1, cost = priceOf(i, k.hires[v] || 0, n, priceMult(k));
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
    // 消えぬ爪痕の傷が残っていれば、その分だけ削れた体力から始める。爪痕を刻んでいれば、この戦いで削った分も残る
    const full = bossHp(k, i), frac = k.scarHp && k.scarHp.i === i ? k.scarHp.frac : 1;
    fight = { i, hp: full * frac, max: full, end: Date.now() + FIGHT_SEC * 1000, scar: !!k.scarReady,
      items: (k.scarReady ? 1 : 0) + (itemRushUntil > Date.now() ? 1 : 0) }; k.scarReady = false; return true;
  }
  // 深き壺に潜る：討伐した数を bank に移して、マーク・雇った夜渡り・討伐の進み具合を最初に戻し、深度を1つ上げる
  if (a === 'kDiff') {
    if (fight || !DIFFS.some(([x]) => x === v) || diffOf(k) === v || (hardOnly(k) && v === 'normal')) return false;
    // 画面は作り直さず、ボタン・説明・夜の王の体力だけをその場で書き換える（作り直すとカクつくため）
    k.diff = v; H.save();
    document.querySelectorAll('[data-act="kDiff"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    const note = $('k-diff-note'); if (note) note.textContent = diffNote(k);
    const mx = $('k-boss-max'); if (mx && BOSSES[k.lords || 0]) mx.textContent = `体力 ${fmtM(bossHp(k, k.lords || 0))}`;
    return false;
  }
  // 深度5を抜けた人だけ：深度1へ戻ってやり直す（v59 の公開直後に深度5まで抜けた人が、直したあとの数値で遊び直せるように）。
  // 討伐ボーナスは1周目を終えた分（10体）に戻す（深度5の分まで残すと、深度1の王が弱すぎるため）。遺物・アイテムは残す
  if (a === 'kReturn') {
    if (depthOf(k) < DEPTH_MAX || (k.lords || 0) < BOSSES.length || fight) return false;
    if (!ui.confirmReturn) { ui.confirmReturn = true; return true; }
    ui.confirmReturn = false; rushUntil = itemRushUntil = 0;
    Object.assign(k, { bank: BOSSES.length, lords: 0, lordAt: Date.now(), scarHp: null, scarReady: false, depth: 1, order: makeOrder(), mark: 0, hires: {} });
    H.toast('壺の底から、深度1へ戻った'); H.save(); return true;
  }
  if (a === 'kDive') {
    if ((k.lords || 0) < BOSSES.length || depthOf(k) >= DEPTH_MAX || fight) return false;
    if (!ui.confirmDive) { ui.confirmDive = true; return true; }
    ui.confirmDive = false; rushUntil = itemRushUntil = 0;
    k.bank = (k.bank || 0) + k.lords; k.lords = 0; k.lordAt = Date.now(); k.scarHp = null; k.scarReady = false; k.depth = depthOf(k) + 1; k.order = makeOrder();
    k.mark = 0; k.hires = {};
    if (k.depth > SCAR_KEEP_DEPTH) { itemsOf(k).scar = 0; itemsOf(k).rush = 0; }  // 消えぬ爪痕・常夜の香は深度3までしか持ち越せない（深度4・5へ潜るときに消える）
    H.toast(`深き壺に潜った…深度${k.depth}。稼ぎは${fmtX(globalMult(k))}倍から`); H.save(); return true;
  }
  if (a === 'kClaim') { const s = warSpoils(k); gain(k, s.gain); k.claimAt = Date.now(); H.toast(`戦果ボーナス ${fmtM(s.gain)} マーク！`); return true; }
  if (a === 'kReset') {
    if (!ui.confirmReset) { ui.confirmReset = true; return true; }
    ui.confirmReset = false; fight = null; delete H.prefs().kotsubo; H.toast('小壺のデータを最初からにしました'); return true;
  }
  return false;
}
// 上の小さな文字（タブを開いているとき）
// 左上の小見出し：深度は夜の王の欄に出ているので入れない（入れると長くなって右上のロックのボタンとかぶる）
export const kotsuboSub = () => { const k = st(); return `${fmtM(k.mark)} マーク・毎秒 ${fmtRate(prodOf(k))}`; };
