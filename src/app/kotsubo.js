// 「小壺」タブのミニゲーム：小壺を叩いてマークをためる（オリジナルの放置系ゲーム）。
// - 叩く：マークが入る。遺物で叩く力が上がる
// - 夜渡りを雇う：自動でマークが入る（雇うほど値段が上がる。10人・25人で強化の遺物が出る）
// - 夜の王に挑む：30秒のうちに体力を削り切れば討伐。討伐するたびに、すべての稼ぎが永久に1.25倍
// - 深き壺に潜る：10体すべて討伐すると、深度を1つ上げて周回できる（強くてニューゲーム）。マークと雇った夜渡りは最初に戻り、
//   夜の王の討伐ボーナス（bank に貯める）と遺物はすべて残る（頑張った分は消さず、どんどん数字が大きくなる方向）。深度は5まで。
//   難易度は1つだけ（前は「普通」もあったが、ランキングで有利・不利が出るのでやめた。夜の王の体力は下の DEPTH_HARD）。深き壺は、潜れるようになるまで画面にも遊び方にも出さない（たどり着いた人だけが知る）
//   稼ぎの倍率（DEPTH_GAIN）を深度ごとに大きく上げて、数字がどんどん大きくなるようにしている（深度5のナメレスは澗＝10の36乗の桁）。
//   夜の王の硬さは「1周目の同じ順番の王の何倍か」（DEPTH_HARD）で決める。深度1は2倍・2は4倍・3は8倍・4は9倍・5は10倍（雇う値段の上がり方から、終盤の稼ぎは伸びにくいので、これより硬いと9・10体目が壁になる）。
//   前は全部の深度が約25倍で、ふつうに遊ぶ人には重すぎた
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
    HIRE.forEach(([id]) => { k.ups[`h10:${id}`] = 1; k.ups[`h25:${id}`] = 1; k.ups[`ess:${id}`] = 1; });
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
// 1人雇うごとに、次の値段が何倍になるか。深度1〜3だけゆるくする（潜った人が早く追いつけるように。終盤も稼ぎが伸びて、9・10体目が壁になりにくい）。深度1はいちばんかんたん
const PRICE_UP = 1.16, PRICE_UP_DEPTH = { 1: 1.10, 2: 1.12, 3: 1.12 }, priceUpOf = k => PRICE_UP_DEPTH[depthOf(k)] || PRICE_UP;
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
// 夜渡りの真髄（最終強化の遺物。隠し要素：遊び方・アップデート情報・戦果ボーナスの欄では名前を出さない）：記録タブの記録 ESS_PER_RUNS 戦ごとに、まだ持っていない夜渡りの真髄が1つ、追跡者から順に（安い夜渡りから）手に入る（戦果ボーナスを受け取ったときに数える）。
// 1日（日本時間）に ESS_PER_DAY 個まで。買うことはできない。潜っても、最初からやり直さない限り消えない（k.ups['ess:<夜渡り>']）。
// 効果は「雇ったその夜渡り1人につき、毎秒マーク +ESS_P」。安い夜渡りほどたくさん雇えるので、追跡者や守護者のような下位の夜渡りを雇い足すことにも意味が出る（葬儀屋の真髄は控えめ）。
// 強くなりすぎないように、夜の王の体力も「真髄で上がった倍率の平方根」だけ上げる（essHp）
const ESS_PER_RUNS = 5, ESS_PER_DAY = 1, ESS_P = .002;
const ESS_FLAVOR = {
  wylder: '追跡者が最後にたどり着いた、狩りの理。\n\n獲物は大きさではなく、数で量れ。\n鉤縄が百度鳴れば、夜もまた揺らぐ',
  guardian: '守護者の盾に刻まれた、無数の小さな傷。\nその一つひとつが、守り抜いた壺の数である。\n\n小さきものを守る者だけが、大きく稼ぐ',
  ironeye: '鉄の目が、最後に見据えたもの。\nそれは壺ではなく、壺を叩く仲間の背であった。\n\n狙いは、ひとりでは定まらない',
  duchess: 'レディが残した、最後の記憶。\n繰り返された打撃は、やがて一つの調べとなる。\n\n数多の夜は、ただ一度の夜に似ている',
  raider: '無頼漢の真髄に、作法はない。\nただ、数を頼みとする。\n\n揺さぶる腕が多いほど、壺はよく吐き出すのだ',
  revenant: '呼び声は、ついに夜の果てまで届いた。\n\n応えた者の数だけ、壺は鳴る。\n復讐者は、その音を子守唄と呼ぶ',
  recluse: '隠者の魔術の、最後の頁。\n束ねるべきは、マークではなかった。\n\n集う者そのものが、魔力の源なのだ',
  executor: '執行者の刃は、ついに音を置き去りにした。\n\n残されたのは、静寂と\nいつのまにか満ちた壺だけである',
  scholar: '学者は、最後の式を書き終えた。\n「数は、数を呼ぶ」\n\nそれは研究の終わりであり\n新しい夜の始まりでもあった',
  undertaker: '葬儀屋が、最後に掘り起こしたもの。\nそれは、眠らせたはずの自らの名であった。\n\n弔う者もまた、いつか弔われる',
};
const essOwned = k => HIRE.filter(([id]) => k.ups[`ess:${id}`]).map(([id]) => id);
const essMult = k => 1 + HIRE.reduce((a, [id]) => a + (k.ups[`ess:${id}`] ? ESS_P * (k.hires[id] || 0) : 0), 0);
const essHp = k => Math.sqrt(essMult(k));
const essTodayOf = k => k.essDay?.day === jstDay() ? k.essDay.n || 0 : 0;
// 記録を数えて、たまっていれば真髄を渡す（受け取った名前の一覧を返す）
function giveEss(k, runs) {
  const got = [];
  if (essOwned(k).length >= HIRE.length) return got;
  k.essRuns = (k.essRuns || 0) + runs;
  while (k.essRuns >= ESS_PER_RUNS && essTodayOf(k) < ESS_PER_DAY) {
    const left = HIRE.map(([id]) => id).filter(id => !k.ups[`ess:${id}`]); if (!left.length) break;
    const id = left[0];  // 追跡者から順に（安い夜渡りから。人数が多いほどよく効くので、最初の1つからすぐ役に立つ）
    k.ups[`ess:${id}`] = 1; k.essRuns -= ESS_PER_RUNS; k.essDay = { day: jstDay(), n: essTodayOf(k) + 1 }; got.push(id);
  }
  if (essOwned(k).length >= HIRE.length) k.essRuns = 0;
  return got;
}
const essToast = ids => ids.length ? `　🔥${ids.map(id => `${H.CHAR[id]?.name || id}の真髄`).join('・')}を手に入れた！` : '';
const essNote = (k, pending = 0) => { if (essOwned(k).length >= HIRE.length) return ''; const r = (k.essRuns || 0) + pending;  // pending＝まだ受け取っていない記録の数。真髄の名前は、手に入れるまで出さない（隠し要素）
  return r >= ESS_PER_RUNS && essTodayOf(k) >= ESS_PER_DAY ? '記録の褒美：今日はここまで（明日の受け取りで手に入ります）' : r >= ESS_PER_RUNS ? '受け取ると、何かが手に入ります' : `あと記録${ESS_PER_RUNS - r}戦で、何かが手に入ります（記録${ESS_PER_RUNS}戦ごと・1日1つまで）`; };
// アイテム（使うとなくなる）：[id, 絵, 名前, 使うと, フレーバーテキスト]
// 手に入れ方（ITEM_DROP）：夜の王を討伐したとき・常夜の小壺を叩いたときに、それぞれの確率で。買うことはできない。持てるのは種類ごとに99個まで
// scar（消えぬ爪痕）：使うと、次の夜の王との戦い（戦い中に使えばその戦い）で削った体力が、逃げられても残る。倒すか潜るまで残り、普通の戦いで逃げられても戻らない
const ITEMS = [
  ['rush', '🕯️', '常夜の香', '夜の王に挑むときに使うと、戦いの始まりから常夜ラッシュ（12秒間、叩く力が7倍）', '常夜の小壺の欠片を練り込んだ香。\n火を灯せば、ひととき夜が深くなる。\n\n深い夜ほど、壺はよく鳴く。\nそれを知る者は、香を絶やさない'],
  ['scar', '🩸', '消えぬ爪痕', '夜の王に挑むときに使うと、逃げられても削った体力がそのまま残る', '夜の王に刻まれた、ひとすじの傷。\n血は乾いても、その痛みは消えない。\n\n王は逃げる。だが傷は残る。\n次に相まみえるとき、王はそれを思い出すだろう'],
];
const ITEM_DROP = { rush: { lord: 1, jar: .1 }, scar: { lord: 0, jar: 0 } };  // 討伐したとき・常夜の小壺のときに手に入る確率（消えぬ爪痕は、深き壺の常夜の王を倒したときだけ。必ず手に入る）
const ITEM = Object.fromEntries(ITEMS.map(x => [x[0], x])), ITEM_MAX = 8;
// アイテムは1種類につき8個まで（上限を決める前に多く持っていた人も、8個に揃える）
const itemsOf = k => { const it = (k.items ||= {}); for (const id in it) if (it[id] > ITEM_MAX) it[id] = ITEM_MAX; return it; };
// アイテムの行（持っている数・使えるか）だけを書き換える
function paintItem(k, id) {
  const c = $(`k-item-${id}`); if (!c) return;
  const n = itemsOf(k)[id] || 0, row = c.closest('.k-item'); c.innerHTML = `${n}<small>/${ITEM_MAX}</small>`; row?.classList.toggle('none', !n);
  const b = row?.querySelector('.k-use'); if (b) b.disabled = !n || itemOff(k, id);
}
// 1回の夜の王との戦いで使えるアイテムは、種類ごとに1つまで（香と爪痕は一緒に使える）
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
    if (k.ups[`h25:${id}`]) list.push({ id: `h25:${id}`, name: `${nm}の極意`, desc: `${nm}の稼ぎがさらに2倍`, flavor: CHAR_FLAVOR[id]?.[1], char: id });
    if (k.ups[`ess:${id}`]) list.push({ id: `ess:${id}`, name: `${nm}の真髄`, desc: `雇った${nm}1人につき、毎秒マーク+${ESS_P * 100}%（今 +${fmtX((ESS_P * (k.hires[id] || 0)) * 100)}%）`, flavor: ESS_FLAVOR[id], char: id }); });
  return list;
}
// 夜の王：討伐する順番と体力
const BOSSES = [['gladius', 500], ['adel', 6000], ['gnoster', 6e4], ['maris', 5e5], ['libra', 4e6], ['fulghor', 3.5e7], ['caligo', 3e8], ['harmonia', 2.5e9], ['strages', 2e10], ['final', 2e11]];
// 深き壺：深度0〜5ごとの、夜の王の体力の倍率と稼ぎの倍率
const DEPTH_GAIN = [1, 100, 1e5, 1e9, 1e14, 1e20], DEPTH_MAX = DEPTH_GAIN.length - 1;
// 潜った直後の稼ぎ・雇う値段の倍率は「1.25の（それまでに倒した数＝10×深度）乗 × DEPTH_GAIN」。体力はそれに DEPTH_HARD を掛けた分だけ上げる
const DEPTH_HARD = [1, 2, 4, 8, 9, 10];
const DEPTH_HP = DEPTH_GAIN.map((g, d) => DEPTH_HARD[d] * g * Math.pow(1.25, 10 * d));
const depthOf = k => Math.min(k.depth || 0, DEPTH_MAX);
// 詰み防止（深度3まで）：同じ夜の王の前で1日（WEAK_AFTER）たっても倒せなければ、そこから時間とともに弱っていく（12時間ごとに体力が半分）。
// 時刻で数えるので、挑んで逃げられる回数を増やしても早くはならない。アプリを閉じている間も進む。k.lordAt＝今の王に挑めるようになった時刻。
// 深度4・5は「本気で挑む深さ」なので、弱らない
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
const bossHp = (k, i) => BOSSES[i][1] * DEPTH_HP[depthOf(k)] * essHp(k) * Math.sqrt(loopMult(k)) * (i === (k.lords || 0) ? weakOf(k) : 1);
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
// 周回の加護（シーズン2から）：★1つごとに、すべての稼ぎ（叩く力も）が10倍。夜の王の体力は、その平方根だけ上げる（真髄と同じ考え方）
const LOOP_GAIN = 10, loopOn = () => H.devHost || Date.now() >= LORDS_FROM;
const loopMult = k => loopOn() ? Math.pow(LOOP_GAIN, loopsOf(k)) : 1;
const globalMult = k => Math.pow(1.25, (k.bank || 0) + (k.lords || 0)) * DEPTH_GAIN[depthOf(k)] * loopMult(k);
const prodOf = k => HIRE.reduce((a, [id, , base]) => a + (k.hires[id] || 0) * base * hireMult(k, id), 0) * globalMult(k) * essMult(k);
const tapOf = k => { const p = prodOf(k); return ((k.ups.tap1 ? 2 : 1) * (k.ups.tap2 ? 2 : 1) * (k.ups.tap5 ? 3 : 1) * globalMult(k) + p * ((k.ups.tap3 ? .01 : 0) + (k.ups.tap4 ? .03 : 0))) * (rushUntil > Date.now() ? 7 : 1); };
// 深き壺では、雇う値段（心得・極意も）を、その深度の稼ぎの倍率（潜る前の討伐ボーナス×深度の倍率）と同じだけ高くする。
// 値段が1周目のままだと、潜った直後から葬儀屋まで一瞬で雇えて、稼ぎが一気に跳ね上がってしまうため（v59 の公開直後に深度5まで1時間で抜けられた）。
// こうすると、深度ごとの「稼ぎ・値段・夜の王の硬さ」の釣り合いが1周目と同じになり、潜るたびに一から積み上げ直す形になる
const priceMult = k => depthOf(k) ? Math.pow(1.25, k.bank || 0) * DEPTH_GAIN[depthOf(k)] : 1;
const priceOf = (i, owned, n = 1, m = 1, up = PRICE_UP) => { let s = 0; for (let j = 0; j < n; j++) s += Math.ceil(HIRE[i][1] * m * Math.pow(up, owned + j)); return s; };
// 「!」で開く、数の単位の早見表：[10の何乗, 漢字, 読み, ひとこと（たとえは大まかな数）]
const UNIT_INFO = [
  [4, '万', 'まん', '1万戦を記録しようとすると、毎日10戦でも3年かかる。'],
  [8, '億', 'おく', '日本の人口がだいたい1.2億人。全員に1マークずつ配れる。'],
  [12, '兆', 'ちょう', '日本の国の1年の予算が、だいたい100兆円。'],
  [16, '京', 'けい', 'スーパーコンピューター「京」は、1秒に1京回計算できるのが名前の由来。'],
  [20, '垓', 'がい', '地球の海の水が、だいたい13垓リットル。小壺には入りきらない。'],
  [24, '秭', 'じょ', '地球の重さが、だいたい6秭キログラム。'],
  [28, '穣', 'じょう', '太陽の重さが、だいたい200穣キログラム。'],
  [32, '溝', 'こう', 'ここから先は何かに例えるのも難しいくらい大きいので、雑学にします。'],
  [36, '澗', 'かん', '「溝」も「澗」も水の流れの字。マークはもう川になった。'],
  [40, '正', 'せい', '数を数えるときに書く「正」の字と同じ字。5画で5を数えられる。'],
  [44, '載', 'さい', '「載」は、もともと「のせる」という意味の字。'],
  [48, '極', 'ごく', '名前のとおり「極み」。昔は、ここが一番大きな単位だったことも。'],
  [52, '恒河沙', 'ごうがしゃ', '「ガンジス川の砂の数」という意味。ここから仏教の言葉の世界。'],
  [56, '阿僧祇', 'あそうぎ', '「数えられない」という意味。数えられないのに単位がある。'],
  [60, '那由他', 'なゆた', 'インドの古い言葉（サンスクリット語）の「ナユタ」から来ている。'],
  [64, '不可思議', 'ふかしぎ', '「思いはかることもできない」という意味。「不思議」という言葉のもとになったと言われる。'],
  [68, '無量大数', 'むりょうたいすう', 'はかりようがない、いちばん上の単位。この先は「◯◯無量大数」と数える。見える宇宙ぜんぶの原子でも、約1兆無量大数個と言われる。'],
];
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
// マークの数を全部の桁の数字で出す（切り替えは k.fullDigits。とても大きい数は、下の方の桁が正確でなくなる）
const markText = k => k.fullDigits ? Math.floor(k.mark).toLocaleString('ja-JP') : fmtM(k.mark);
const digitsLabel = k => k.fullDigits ? '単位で表示' : 'すべての桁で表示';
const fmtRate = n => n < 10 ? n.toFixed(1) : fmtM(n);
const fmtX = n => n < 100 ? String(+n.toFixed(2)) : fmtM(n);  // 倍率（1.25倍・1.56倍…）
// 遺物（夜渡りの強化を含む）で、今買えるようになっているもの
// 極意の値段＝その夜渡りの元の値段×KIWAMI_X（×深度の倍率）。葬儀屋だけ v64 で1500→60（どの深度でも高すぎて買えなかったため。葬儀屋をあと1人雇うのと同じくらいの値段）
const KIWAMI_X = 1500, KIWAMI_ONE = { undertaker: 60 };
const kiwamiX = (k, id) => KIWAMI_ONE[id] || KIWAMI_X;
function upgradesShown(k) {
  const list = RELICS.filter(([id, , , , need]) => !k.ups[id] && k.total >= need).map(([id, name, desc, cost]) => ({ id, name, desc, cost }));
  HIRE.forEach(([id, base], i) => {
    const n = k.hires[id] || 0, nm = H.CHAR[id]?.name || id;
    if (n >= 10 && !k.ups[`h10:${id}`]) list.push({ id: `h10:${id}`, name: `${nm}の心得`, desc: `${nm}の稼ぎが2倍`, cost: base * 60 * priceMult(k), char: id });
    if (n >= 25 && !k.ups[`h25:${id}`]) list.push({ id: `h25:${id}`, name: `${nm}の極意`, desc: `${nm}の稼ぎがさらに2倍`, cost: base * kiwamiX(k, id) * priceMult(k), char: id });
  });
  return list.sort((a, b) => a.cost - b.cost);
}
// 戦果ボーナス：記録タブで、前に受け取ったあとに記録された勝ち負け（サンプルは数えない）。
// 「最初に記録した時刻」で数えるので、昔の戦績を直したり消して戻したりしても、もう一度は数えない
const madeAt = r => r.createdAt || r.updatedAt || 0;
// 戦果ボーナスは、マークの代わりに🩸消えぬ爪痕でも受け取れる（記録 SCAR_PER_RUNS 戦ごとに1つ。古い記録から使い、余った記録は次に残る）
// 1日（日本時間）に爪痕で受け取れるのは SCAR_PER_DAY 個まで（記録を手早く足して集められないように）。k.scarDay = { day, n }
const SCAR_PER_RUNS = 2, SCAR_PER_DAY = 3;
const jstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const scarTodayOf = k => k.scarDay?.day === jstDay() ? k.scarDay.n || 0 : 0;
// 消えぬ爪痕は、深き壺にたどり着いた人（または持っている人）にだけ見せる（たどり着いた人だけが知る、の決めごと）
const seesScar = k => maxDepthOf(k) > 0 || (itemsOf(k).scar || 0) > 0 || !!k.scarReady;
function warSpoils(k) {
  // はじめて受け取るときは、これまでの記録の新しい50戦まで（記録が多い人が、最初から一気に進みすぎないように）
  const runs = H.liveRuns().filter(r => !r.sample && madeAt(r) > (k.claimAt || 0)).sort((a, b) => madeAt(b) - madeAt(a)).slice(0, k.claimAt ? Infinity : 50);
  const w = runs.filter(r => r.result === 'win').length, l = runs.length - w;
  const room = ITEM_MAX - (itemsOf(k).scar || 0), today = SCAR_PER_DAY - scarTodayOf(k);
  const scars = Math.max(0, Math.min(Math.floor(runs.length / SCAR_PER_RUNS), room, today));
  return { w, l, runs, scars, room, today, gain: w * Math.max(100, prodOf(k) * 300) + l * Math.max(20, prodOf(k) * 60) };
}

// ---------- 動き（叩く・時間がたつ・常夜の小壺・戦い） ----------
let tuckTimer = null;
let loop = null, lastTick = 0, lastSave = 0, rushUntil = 0, itemRushUntil = 0, jar = null, nextJarAt = 0, fight = null, combo = 0, onTab = false;
// 夜の王に挑むとき：先に確かめる画面（prep：使うアイテム・画面のロック）→「3・2・1」（countdown）→ 戦いが始まる。アイテムは戦いが始まった瞬間に使う
let prep = null, countdown = null, lastTick0 = 0;
// 常夜の小壺から出た常夜ラッシュは、すぐには始めず、ためておく（1つまで）。「始める」を押すと「3・2・1」のあとに始まる（戦い中はすぐ）。壺渡りの画面を離れると消える
let rushHeld = false;
const $ = id => document.getElementById(id);
function gain(k, n) { k.mark += n; k.total += n; }
// 常夜の小壺：次に出るまで100〜300秒（v62 で前の2倍に。多すぎたため）。常夜の嗅覚で半分
function scheduleJar(k) { nextJarAt = Date.now() + (100 + Math.random() * 200) * 1000 / (k.ups.jar1 ? 2 : 1); }
function tick() {
  const now = Date.now();
  // ミニゲームの画面を開いていないときは、何もしない（端末への保存もしない）。
  // 離れた瞬間に、戦いと常夜の小壺はお知らせなしで終わらせ、離れた時刻を残す（稼ぎは、次に開いたときに「留守の間」としてまとめて入れる）
  if (H.tab() !== 'kotsubo') {
    if (onTab) { onTab = false; closePrep(); closeUnits(); stopCountdown(); rushHeld = false; setLock(false); fight = null; rushUntil = itemRushUntil = 0; if (jar) { $('k-jar')?.remove(); jar = null; nextJarAt = 0; } st().lastAt = now; H.save(); rankSend(true); }
    return;
  }
  rankSend(false);  // ランキングに参加していれば、5分に1回送る
  onTab = true;
  const k = st(), dt = Math.min(1, (now - (lastTick || now)) / 1000); lastTick = now;
  const p = prodOf(k);
  gain(k, p * dt);
  if (fight && now >= fight.end) endFight(false);  // 夜の王は、叩いたダメージでしか削れない（夜渡りは稼ぐ係。叩かずには勝てない）
  if (countdown) { if (jar) jar.until += now - (lastTick0 || now); if (nextJarAt) nextJarAt += now - (lastTick0 || now); }  // 「3・2・1」の間は、常夜の小壺の時間も止める
  lastTick0 = now;
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
  m.textContent = markText(k); m.classList.toggle('full', !!k.fullDigits);
  $('k-rate').textContent = rateText(k); const tc = $('k-taps'); if (tc) tc.textContent = tapsText(k);
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
  if (countdown) return;  // 挑む前のカウントダウン中は叩けない
  const k = st(), v = tapOf(k);
  k.taps++; combo++;
  { const tc = $('k-taps'); if (tc) queueMicrotask(() => { tc.textContent = tapsText(k); }); }  // 叩いた回数はすぐ数字を変える
  if (rendaOn()) { if (!k.renda || k.renda.id !== RENDA.id) k.renda = { id: RENDA.id, n: 0 }; k.renda.n++; const r = $('k-renda-n'); if (r) r.textContent = k.renda.n.toLocaleString('ja-JP'); }
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
  if (countdown) return;  // 「3・2・1」の間は叩けない
  const k = st(); k.jars = (k.jars || 0) + 1;
  if (Math.random() < .3 && !rushHeld) { rushHeld = true; floatText(e.clientX, e.clientY, '常夜ラッシュ！', 'gold'); H.toast('常夜ラッシュを手に入れた！好きなときに始められる（この画面を離れると消える）'); paintRushBtn(); }
  else { const g = Math.max(prodOf(k) * 90, tapOf(k) * 30, 50); gain(k, g); floatText(e.clientX, e.clientY, `+${fmtM(g)}`, 'gold'); H.toast(`常夜の小壺から ${fmtM(g)} マーク！`); }
  // ときどき、アイテムを落としていく（画面は作り直さず、持っている数だけ書き換える）
  ITEMS.forEach(([id, icon, name]) => { if (Math.random() < ITEM_DROP[id].jar) { const ok = giveItem(k, id);
    setTimeout(() => H.toast(ok ? `常夜の小壺が${icon}${name}を落としていった` : `${icon}${name}は、もう持ちきれない`), 1600); if (ok) paintItem(k, id); } });
  hideJar(false); paint(k);
}
function endFight(win) {
  const k = st(), f = fight; fight = null;
  if (win) { k.lords = Math.max(k.lords || 0, f.i + 1); k.lordAt = Date.now(); k.scarHp = null; addKillPts(k);
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

// ---------- ランキング（これまでのマーク） ----------
// 参加した人だけ（k.rankJoin）、これまでのマークと、たどり着いた一番深い深度を送る（名前は送らない。端末ごとのランダムな番号は app.js の postOnline が付ける）。
// 受け取り口が、急に増えすぎた数字・深度にくらべて大きすぎる数字をはじく（tools/online/apps_script.gs）。送るのは5分に1回まで
const maxDepthOf = k => Math.max(k.maxDepth || 0, depthOf(k));
// 周回の印（★）：深度5を抜けて深度1へ戻った回数（k.loops）。数え始める前に戻った人は、深度5まで行って今は浅い所にいれば1回と数える。ランキングにも出す（強さは変わらない）
const loopsOf = k => k.loops != null ? k.loops : (k.maxDepth || 0) >= DEPTH_MAX && depthOf(k) < DEPTH_MAX ? 1 : 0;
const loopTag = n => n > 0 ? `<span class="k-loop" title="周回">★${n}</span>` : '';
// ランキングで比べるのは「Ver.1.2.4 から後に稼いだマーク」：この版で初めて壺渡りを開いたときの「これまでのマーク」を起点（k.rankBase）にして、そこから増えた分だけを送る
// （v59 の公開直後の不具合で一気に稼いだ分を入れないため。最初からやり直すと、起点も0に戻る）
const rankValue = k => Math.max(0, Math.floor((k.total || 0) - (k.rankBase || 0)));
const RANK_SEND_GAP = 5 * 60e3, RANK_LIST_TTL = 3 * 60e3;
let rankSentAt = 0, rankList = null, rankListAt = 0, rankLoading = false, rankFailed = false;
// 連打王（期間限定のおまけのランキング）：期間中に小壺を叩いた回数（戦いの中も数える。常夜の小壺は数えない）。参加はランキングと同じ。
// 期間の前から知らせて、終わったあとも1週間は結果を出す。数えるのは期間中だけ（送るのは期間のあとでもよい。受け取り口も同じ期間で数える）
// シーズン：開催ごとに1行足す（受け取り口 tools/online/apps_script.gs の SEASONS と同じにする）。今のシーズン＝始まりが今より前のうち、いちばん新しいもの。
// 終わったシーズンの結果は、壺渡りの「シーズンの結果」のボタンから見られる（受け取り口の season_result）
const SEASONS = [
  { id: '2026-11-26', name: 'シーズン1', label: '11/26（木）12:00〜11/29（日）23:59', start: Date.parse('2026-11-26T12:00:00+09:00'), end: Date.parse('2026-11-29T23:59:00+09:00') },
  { id: '2026-11-30', name: 'シーズン2', label: '11/30（月）0:00〜12/6（日）23:59', start: Date.parse('2026-11-30T00:00:00+09:00'), end: Date.parse('2026-12-06T23:59:00+09:00') },
];
const curSeason = () => SEASONS.filter(x => x.start <= Date.now()).pop() || SEASONS[0];
let RENDA = curSeason(), RENDA_SHOW = RENDA.end + 7 * 86400e3;
// アプリを開いたままシーズンが変わったときは、今のシーズンに切り替えて、前のシーズンの一覧は捨てる
function syncSeason() { const c = curSeason(); if (c.id === RENDA.id) return; RENDA = SEASON = c; RENDA_SHOW = c.end + 7 * 86400e3; rankList = rendaList = null; rankListAt = 0; }
const rendaOn = (t = Date.now()) => t >= RENDA.start && t < RENDA.end;
const rendaOf = k => k.renda && k.renda.id === RENDA.id ? k.renda.n : 0;
let rendaList = null;
// 連打王の3位まで：1位は金の王冠、2位は銀・3位は銅のメダル（どれも真ん中に「連」）。行も金・銀・銅の色にする（期間中、そのときの順位で入れ替わる）
const RENDA_PRIZE = ['王冠（1位）', '銀のメダル（2位）', '銅のメダル（3位）'];
const rendaIco = i => i === 0
  ? `<svg class="k-prize" viewBox="0 0 30 26" role="img" aria-label="${RENDA_PRIZE[0]}"><path d="M3 9l6 5 6-10 6 10 6-5-2.5 13h-19z" fill="url(#k-gold)" stroke="#8a5a12" stroke-width="1.2" stroke-linejoin="round"/><circle cx="3" cy="8" r="2" fill="#ffe08a"/><circle cx="15" cy="3.5" r="2" fill="#ffe08a"/><circle cx="27" cy="8" r="2" fill="#ffe08a"/><rect x="5.5" y="21" width="19" height="3.5" rx="1" fill="#c8891c" stroke="#8a5a12" stroke-width="1"/><text x="15" y="19.3" text-anchor="middle" font-size="9.5" font-weight="900" fill="#5a3606">連</text><defs><linearGradient id="k-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a3"/><stop offset="1" stop-color="#e0a62a"/></linearGradient></defs></svg>`
  : `<svg class="k-prize" viewBox="0 0 24 28" role="img" aria-label="${RENDA_PRIZE[i]}"><path d="M6 1h5l3 8h-5zM18 1h-5l-3 8h5z" fill="${i === 1 ? '#5b7bd6' : '#c0573a'}"/><circle cx="12" cy="17" r="9" fill="${i === 1 ? '#e6ebf2' : '#e0a374'}" stroke="${i === 1 ? '#8b96a8' : '#8a4f24'}" stroke-width="1.4"/><circle cx="12" cy="17" r="6.6" fill="none" stroke="${i === 1 ? '#aab4c3' : '#b06d3a'}" stroke-width=".8"/><text x="12" y="20.6" text-anchor="middle" font-size="9.5" font-weight="900" fill="${i === 1 ? '#4a5262' : '#5a2e10'}">連</text></svg>`;
// マークのランキングも、連打王と同じ期間で比べる（期間中に稼いだマーク）。期間が始まってから最初に数えたときの「これまでのマーク」を起点にする。
// 期間が終わったら、受け取り口がそのときの数字で止める（結果は連打王と同じく1週間出す）
let SEASON = RENDA;
function seasonBase(k) { if (Date.now() >= SEASON.start && k.rankSeason !== SEASON.id) { k.rankSeason = SEASON.id; k.rankBase = k.total || 0; } }
// ── 壺の主（シーズン2から）：総合の「壺の主」と、その下の「マーク王」「連打王」「周回王」 ──
// 周回王＝そのシーズンに倒した夜の王の点数（1体10点。深度1つにつき＋2点、★1つにつき＋5点）
// 壺の主＝決まった点数の足し算：夜の王の点（周回王と同じ）＋ 小壺1万回で4点 ＋ マークの桁1つで6点（全員を足すと、周回45%・連打30%・マーク25%くらい。ずれてきたらシーズンの終わりに見直す）
// 🔰＝まだ深き壺を開けていない人（1周目の夜の王を倒しきっていない）。🔰だけの順位も見られる
// 周回王で数える討伐は1日10体まで（★が増えるほど速く倒せるので、何周もして点が青天井にならないように）
// 受け取り口が一覧（boards）を返してきたときだけ、この形で出す（返さない間は、今までのランキングのまま）。開発用の画面では見本を出す
const LORDS_FROM = Date.parse('2026-11-30T00:00:00+09:00');
const KILL_PT = 10, KILL_DEPTH = 2, KILL_LOOP = 5, KILL_PER_DAY = 10, MASTER_TAPS = 2500, MASTER_DIGIT = 6;
const killPt = (d, loops) => KILL_PT + KILL_DEPTH * d + KILL_LOOP * loops;
const seasonPts = k => k.sp && k.sp.id === SEASON.id ? k.sp : { id: SEASON.id, pts: 0, kills: 0 };
function addKillPts(k) {
  const t = Date.now(); if (!H.devHost && (t < SEASON.start || t >= SEASON.end)) return;
  const sp = seasonPts(k), day = jstDay(), today = sp.day === day ? sp.today || 0 : 0;
  if (today >= KILL_PER_DAY) return;  // 今日はもう10体数えた
  k.sp = { id: SEASON.id, pts: Math.round((sp.pts + killPt(depthOf(k), loopsOf(k))) * 10) / 10, kills: sp.kills + 1, day, today: today + 1 };
}
const digitsOf = n => n >= 1 ? Math.floor(Math.log10(n)) + 1 : 0;
// 壺の主の点（ppl＝{ mark, taps, pts } の一覧。受け取り口でも同じ数え方をする）
function masterPts(ppl) { ppl.forEach(x => { x.master = Math.round((x.pts + x.taps / MASTER_TAPS + MASTER_DIGIT * digitsOf(x.mark)) * 10) / 10; }); }
const isNewbie = k => maxDepthOf(k) === 0 && (k.lords || 0) < BOSSES.length;  // 🔰：まだ深き壺を開けていない
const BOARDS = [
  ['master', '👑 壺の主', '総合の王。夜の王を1体倒すと10点（深度1つにつき＋2点、★1つにつき＋5点）／小壺を1万回叩くと4点／マークの桁が1つ増えると6点'],
  ['mark', '💰 マーク王', 'シーズンの間に稼いだマーク'],
  ['renda', '🥊 連打王', 'シーズンの間に小壺を叩いた回数（夜の王との戦いの中も数えます）'],
  ['loop', '🔁 周回王', '夜の王を1体倒すと10点（深度1つにつき＋2点、★1つにつき＋5点）。数えるのは1日10体まで'],
];
const PAGE = 10;
// 開発用：20人が参加している想定の見本（自分は、この端末の本当の数字で入る）。[★, 深度, マーク, 連打, 倒した夜の王]
function devBoards(k) {
  const ppl = [[3, 5, 1e44, 480000, 30], [2, 5, 3e40, 260000, 24], [1, 5, 8e37, 520000, 18], [1, 4, 2e33, 150000, 14], [0, 5, 6e31, 90000, 6], [0, 4, 9e29, 310000, 9],
    [0, 4, 3e28, 60000, 7], [0, 3, 5e24, 210000, 12], [0, 3, 7e22, 40000, 10], [0, 2, 1e19, 180000, 15], [0, 2, 4e17, 20000, 9], [0, 1, 9e13, 330000, 18],
    [0, 1, 2e12, 12000, 11], [0, 0, 5e9, 260000, 10], [0, 0, 8e8, 70000, 10], [0, 0, 3e7, 5000, 8], [0, 0, 9e5, 120000, 5], [0, 0, 4e4, 800, 3], [0, 0, 2e3, 30, 1]]
    .map(([loops, d, mark, taps, kills], i) => ({ rid: `dev-${i}`, loops, nb: !loops && !d && kills < 10, mark, taps, pts: Math.round(kills * killPt(d, loops) * 10) / 10 }));
  const sp = seasonPts(k); ppl.push({ rid: 'dev-me', loops: loopsOf(k), nb: isNewbie(k), mark: rankValue(k), taps: rendaOf(k), pts: sp.pts });
  masterPts(ppl);
  const by = key => ppl.map(x => ({ rid: x.rid, loops: x.loops, nb: x.nb, v: x[key] })).filter(x => x.v > 0 || x.rid === 'dev-me').sort((a, b) => b.v - a.v);
  return { master: by('master'), mark: by('mark'), renda: by('taps'), loop: by('pts') };
}
const boardsOn = () => !!(rankList && rankList.boards);
// 別の「連打王」の欄をしまうか（壺の主の一覧が来たとき。シーズン2からは、参加する前も「ランキングに参加する」1つにまとめる）
const rendaBoxOff = k => boardsOn() || (loopOn() && !k.rankJoin);
const boardId = () => BOARDS.some(b => b[0] === S().board) ? S().board : 'master';
function lordsBody(k) {
  const ui = S(), id = boardId(), b = BOARDS.find(x => x[0] === id), all = rankList.boards[id] || [], nbOnly = !!ui.nbOnly, list = nbOnly ? all.filter(x => x.nb) : all;
  const me = k.rankMe?.rid, idx = list.findIndex(x => x.rid === me), pages = Math.max(1, Math.ceil(list.length / PAGE));
  const page = Math.min(pages - 1, Math.max(0, ui.page ?? (idx >= 0 ? Math.floor(idx / PAGE) : 0)));
  const fmt = n => k.fullDigits ? Math.floor(n).toLocaleString('ja-JP') : fmtM(n);
  const val = v => id === 'mark' ? `${fmt(v)} マーク` : id === 'renda' ? `${Math.floor(v).toLocaleString('ja-JP')} 回` : `${(+v).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} 点`;
  const sp = seasonPts(k), mineV = id === 'master' ? all.find(x => x.rid === me)?.v ?? 0 : { mark: rankValue(k), renda: rendaOf(k), loop: sp.pts }[id];
  const admin = !!H.adminKey?.();
  const adm = x => admin && x.rid !== me ? ['rank_del', 'rank_ban'].map(op => { const key = `${op}:${x.rid}`; return `<button class="link-btn k-rank-adm" data-act="kRankAdmin" data-v="${key}">${ui.rankConfirm === key ? 'もう一度押す' : op === 'rank_del' ? '消す' : '締め出す'}</button>`; }).join('') : '';
  const rows = list.slice(page * PAGE, page * PAGE + PAGE).map((x, j) => { const i = page * PAGE + j, self = x.rid === me;
    return `<li class="${[self ? 'me' : '', i < 3 ? `top${i + 1}` : ''].join(' ').trim()}"><b>${id === 'renda' && i < 3 ? rendaIco(i) : ''}${i + 1}位</b><span>${val(x.v)}</span>${loopTag(x.loops)}${x.nb ? '<span class="k-nb" title="まだ深き壺を開けていない人">🔰</span>' : ''}${self ? '<span class="badge">あなた</span>' : ''}${adm(x)}</li>`; }).join('');
  const pager = pages > 1 ? `<div class="k-pager"><button class="chip mini" data-act="kPage" data-v="prev" ${page ? '' : 'disabled'}>‹ 前の10人</button><span>${page * PAGE + 1}〜${Math.min(list.length, page * PAGE + PAGE)}位</span><button class="chip mini" data-act="kPage" data-v="next" ${page < pages - 1 ? '' : 'disabled'}>次の10人 ›</button></div>`
    + (idx >= 0 && Math.floor(idx / PAGE) !== page ? '<button class="link-btn k-pager-me" data-act="kPage" data-v="me">自分の順位へ</button>' : '') : '';
  const now = Date.now();
  return `<div class="k-boards" role="tablist">${BOARDS.map(([bid, label]) => `<button role="tab" data-act="kBoard" data-v="${bid}" aria-selected="${bid === id}" class="${bid === 'master' ? 'k-board-master' : ''}">${label}</button>`).join('')}</div>
    <div class="k-nb-row"><button class="chip mini" data-act="kNbOnly" aria-pressed="${nbOnly}">🔰だけ見る</button><button class="k-info" data-act="kBoardInfo" aria-expanded="${!!ui.boardInfo}" aria-label="点数の説明" title="説明">!</button></div>
    ${ui.boardInfo ? `<p class="hint k-board-info">${b[2].replace(/／/g, '<br>')}<br>${SEASON.name}（${SEASON.label}）${now >= SEASON.end ? '。終わりました。おつかれさまでした！' : ''}<br>🔰＝まだ深き壺を開けていない人</p>` : ''}
    ${now >= SEASON.end ? '<p class="hint">このシーズンは終わりました。おつかれさまでした！</p>' : ''}
    <p class="k-rank-me">${nbOnly ? '🔰の中で、' : ''}あなたは <b>${idx >= 0 ? `${idx + 1}位` : nbOnly ? '（🔰ではありません）' : '-'}</b>${idx >= 0 ? `（${val(mineV)}）` : ''}</p>
    ${list.length ? `<ol class="k-rank-list">${rows}</ol>${pager}` : `<p class="hint">${nbOnly ? '🔰の人は、まだいません。' : 'まだ誰も参加していません。'}</p>`}
    ${id === 'renda' ? '<p class="k-renda-note">連打ツールに縋るなかれ。<br>絡繰の指で玉座に就こうとも、誰も汝を王とは認めぬ。<br>鍛え上げし己が指で、壺を叩け。</p>' : ''}
    <button class="link-btn dim-link k-rank-leave" data-act="kRankLeave">${ui.rankConfirm === 'leave' ? 'もう一度押すと、ランキングから抜けます' : 'ランキングから抜ける'}</button>`;
}
// 開発用の画面では本物に送らず、見本の順位・一覧を出す
const DEV_RANK = () => ({ top: [9.1e33, 4.2e30, 7.7e27, 3.3e24, 8e20, 5.5e17, 2.1e15, 6e12, 9e10, 3e9].map((t, i) => ({ rid: i === 2 ? 'dev-me' : `dev-${i}`, total: t, loops: [3, 1][i] || 0 })) });
const DEV_RENDA = () => ({ rank: 4, accepted: true, top: [98765, 54321, 32100, 20480, 12000, 8800, 5000, 3210, 1500, 900].map((n, i) => ({ rid: i === 3 ? 'dev-me' : `dev-${i}`, taps: n })) });
// 上位の一覧は、送った返事にだけ付いてくる（参加した人だけが見られる。受け取り口に、読み出すだけの口はない）
function rankSend(force) {
  syncSeason(); const k = st(); seasonBase(k); if (!k.rankJoin || rankLoading) return;
  if (!force && Date.now() - rankSentAt < RANK_SEND_GAP) return;
  rankSentAt = Date.now();
  if (H.devHost) { k.rankMe = { rank: 3, rid: 'dev-me', accepted: true, at: Date.now() }; rankList = DEV_RANK(); rankList.boards = devBoards(k); rankListAt = Date.now();
    if (Date.now() >= RENDA.start) { const d = DEV_RENDA(); k.rendaMe = { rank: d.rank, accepted: true }; rendaList = { top: d.top }; } paintRank(); return; }
  if (!navigator.onLine) { rankFailed = true; paintRank(); return; }
  rankLoading = true; rankFailed = false;
  const now = Date.now(), renda = now >= RENDA.start && now < RENDA_SHOW ? { rendaId: RENDA.id, renda: rendaOf(k) } : {};
  const season = k.rankSeason === SEASON.id ? { season: SEASON.id, pts: seasonPts(k).pts, nb: isNewbie(k) } : {};  // pts＝周回王の点・nb＝🔰（受け取り口はシーズン2から使う）
  H.postOnline({ type: 'kotsubo2', total: rankValue(k), maxDepth: maxDepthOf(k), depth: depthOf(k), loops: loopsOf(k), ...season, ...renda }).then(r => {
    if (!r?.ok) { if (r?.error === 'banned') { k.rankJoin = false; k.rankMe = null; rankList = null; H.save(); } else rankFailed = true; return; }
    k.rankMe = { rank: r.rank, rid: r.rid, accepted: r.accepted !== false, why: r.why === 'big' ? 'big' : 'fast', at: Date.now() }; H.save();
    if (Array.isArray(r.top)) { rankList = { top: r.top.slice(0, 10), boards: r.boards && typeof r.boards === 'object' ? r.boards : null }; rankListAt = Date.now(); }
    if (r.renda && Array.isArray(r.renda.top)) { k.rendaMe = { rank: r.renda.rank, accepted: r.renda.accepted !== false }; rendaList = { top: r.renda.top.slice(0, 10) };
      // 受け取り口の回数のほうが多いとき（最初からにした・別の端末から戻したなど）は、そちらに合わせて続きから数える
      const srv = Math.floor(Number(r.renda.taps)) || 0; if (srv > rendaOf(k)) k.renda = { id: RENDA.id, n: srv };
      H.save(); }
  }).catch(() => { rankFailed = true; }).finally(() => { rankLoading = false; paintRank(); });
}
// ランキングを開いたとき：一覧が古ければ（3分）、送り直して新しい一覧をもらう
function loadRank(force) { if (force || !rankList || Date.now() - rankListAt >= RANK_LIST_TTL) rankSend(true); }
function rankBody(k) {
  const now = Date.now(), inSeason = now >= SEASON.start;
  const what = inSeason ? `${SEASON.label} の間に稼いだマーク` : 'Ver.1.2.4 から後に稼いだマーク';
  if (!k.rankJoin && loopOn()) return `<p class="hint">シーズンごとに「👑 壺の主」（総合）と「💰 マーク王」「🥊 連打王」「🔁 周回王」で、みんなと順位を比べます。名前は出ません（送るのは、マーク・叩いた回数・倒した夜の王の点数・進み具合と、端末ごとのランダムな番号だけ）。</p>
    <button class="ghost small" data-act="kRankJoin">ランキングに参加する</button>`;
  if (!k.rankJoin) return `<p class="hint">${what}の多さで、みんなと順位を比べます。名前は出ません（送るのは、そのマークの数・進み具合と、端末ごとのランダムな番号だけ）。</p>
    <button class="ghost small" data-act="kRankJoin">ランキングに参加する</button>`;
  if (boardsOn()) return lordsBody(k);
  const me = k.rankMe, ui = S(), admin = !!H.adminKey?.();
  const head = `<p class="hint">${what}のランキング${!inSeason ? `（${SEASON.label} は、その間に稼いだマークで数え直します）` : now >= SEASON.end ? '。終わりました。おつかれさまでした！' : ''}</p>`;
  const meLine = me ? `<p class="k-rank-me">あなたは <b>${me.rank || '-'}位</b>です</p>${me.accepted ? '' : me.why === 'big' ? '<p class="hint">今の記録は、たどり着いた深度にくらべて大きすぎるため、ランキングに入れていません（前の記録で順位を出しています）。おかしいと思ったら、おたよりで知らせてください。</p>' : '<p class="hint">急に増えた記録は、まだランキングに入れていません（前の記録で順位を出しています）。時間がたつと入ります。</p>'}`
    : '<p class="hint">順位を調べています…（通信できる所で開いてください）</p>';
  const fmt = n => k.fullDigits ? Math.floor(n).toLocaleString('ja-JP') : fmtM(n);
  const rows = rankList ? (rankList.top || []).map((x, i) => `<li class="${me && x.rid === me.rid ? 'me' : ''}"><b>${i + 1}位</b><span>${fmt(x.total)} マーク</span>${loopTag(x.loops)}${me && x.rid === me.rid ? '<span class="badge">あなた</span>' : ''}${admin ? ['rank_del', 'rank_ban'].map(op => { const key = `${op}:${x.rid}`; return `<button class="link-btn k-rank-adm" data-act="kRankAdmin" data-v="${key}">${ui.rankConfirm === key ? 'もう一度押す' : op === 'rank_del' ? '消す' : '締め出す'}</button>`; }).join('') : ''}</li>`).join('') : '';
  const list = rankList ? (rows ? `<ol class="k-rank-list">${rows}</ol>` : '<p class="hint">まだ誰も参加していません。</p>')
    : `<p class="hint">${rankFailed ? '読み込めませんでした。通信できる所で、もう一度開いてください。' : '読み込んでいます…'}</p>`;
  return `${head}${meLine}${list}<button class="link-btn dim-link k-rank-leave" data-act="kRankLeave">${ui.rankConfirm === 'leave' ? 'もう一度押すと、ランキングから抜けます' : 'ランキングから抜ける'}</button>`;
}
// 連打王の欄（期間の前は予告、期間中と終わってから1週間は、自分の回数・順位と上位10人）
function rendaBody(k) {
  const now = Date.now(), me = k.rendaMe, ui = S(), admin = !!H.adminKey?.();
  const head = `<p class="hint">${RENDA.label} の期間限定。<br>小壺を叩いた回数のランキング（夜の王との戦いの中も数えます）</p>`;
  const note = '<p class="k-renda-note">連打ツールに縋るなかれ。<br>絡繰の指で玉座に就こうとも、誰も汝を王とは認めぬ。<br>鍛え上げし己が指で、壺を叩け。</p>';
  if (now < RENDA.start) return `${head}<p class="k-rank-me">もうすぐ始まります</p>${k.rankJoin ? '' : '<p class="hint">ランキングに参加すると、連打王にも参加できます。</p><button class="ghost small" data-act="kRankJoin">ランキングに参加する</button>'}${note}`;
  if (!k.rankJoin) return `${head}<p class="hint">ランキングに参加すると、連打王にも参加できます。</p><button class="ghost small" data-act="kRankJoin">ランキングに参加する</button>${note}`;
  const mine = `<p class="k-rank-me">${now < RENDA.end ? 'あなたの連打' : '結果：あなたの連打'}　<b id="k-renda-n">${rendaOf(k).toLocaleString('ja-JP')}</b> 回${me && me.rank ? `・<b>${me.rank}位</b>` : ''}</p>${me && !me.accepted ? '<p class="hint">急に増えた回数は、入れていません。</p>' : ''}`;
  const rows = rendaList ? (rendaList.top || []).map((x, i) => { const self = k.rankMe && x.rid === k.rankMe.rid;
    return `<li class="${[self ? 'me' : '', i < 3 ? `top${i + 1}` : ''].join(' ').trim()}"><b>${i < 3 ? rendaIco(i) : ''}${i + 1}位</b><span>${Number(x.taps).toLocaleString('ja-JP')} 回</span>${self ? '<span class="badge">あなた</span>' : ''}${admin ? ['rank_del', 'rank_ban'].map(op => { const key = `${op}:${x.rid}`; return `<button class="link-btn k-rank-adm" data-act="kRankAdmin" data-v="${key}">${ui.rankConfirm === key ? 'もう一度押す' : op === 'rank_del' ? '消す' : '締め出す'}</button>`; }).join('') : ''}</li>`; }).join('') : '';
  const list = rendaList ? (rows ? `<ol class="k-rank-list">${rows}</ol>` : '<p class="hint">まだ誰も叩いていません。</p>')
    : `<p class="hint">${rankFailed ? '読み込めませんでした。通信できる所で、もう一度開いてください。' : '読み込んでいます…（順位は5分ごとに新しくなります）'}</p>`;
  return `${head}${now >= RENDA.end ? '<p class="hint">連打王は終わりました。おつかれさまでした！</p>' : ''}${mine}${list}${note}`;
}
// ランキングの欄だけを書き換える（画面全体は作り直さない）
// 終わったシーズンの結果（マークと連打王の上位10人・自分の順位）。ボタンを押したときに受け取り口から読む（開発用の画面では見本）
// 開発用の画面では、今のシーズンも「終わった」ものとして結果のボタンを出す（見た目の確かめ用）
const pastSeasons = () => SEASONS.filter(x => x.end <= Date.now() || (H.devHost && x.start <= Date.now())).reverse();
const seasonRes = {};
function loadSeason(id) {
  const r = seasonRes[id];
  if (r && (r.loading || r.data)) return;
  if (H.devHost) { seasonRes[id] = { data: { rid: 'dev-me', mark: { rank: 3, top: DEV_RANK().top }, renda: { rank: 4, top: DEV_RENDA().top } } }; paintSeason(); return; }
  seasonRes[id] = { loading: true }; paintSeason();
  H.postOnline({ type: 'season_result', season: id }).then(x => { seasonRes[id] = x?.ok ? { data: x } : { failed: true }; })
    .catch(() => { seasonRes[id] = { failed: true }; }).finally(paintSeason);
}
function seasonBody(k) {
  const id = S().seasonOpen, ss = SEASONS.find(x => x.id === id); if (!ss) return '';
  const r = seasonRes[id] || {}, fmt = n => k.fullDigits ? Math.floor(n).toLocaleString('ja-JP') : fmtM(n);
  if (!r.data) return `<p class="hint">${r.failed ? '読み込めませんでした。通信できる所で、もう一度押してください。' : '読み込んでいます…'}</p>`;
  const d = r.data, me = d.rid;
  const list = (top, val, medal) => top?.length ? `<ol class="k-rank-list">${top.map((x, i) => `<li class="${[x.rid === me ? 'me' : '', i < 3 ? `top${i + 1}` : ''].join(' ').trim()}"><b>${medal && i < 3 ? rendaIco(i) : ''}${i + 1}位</b><span>${val(x)}</span>${x.loops ? loopTag(x.loops) : ''}${x.rid === me ? '<span class="badge">あなた</span>' : ''}</li>`).join('')}</ol>` : '<p class="hint">参加した人はいませんでした。</p>';
  const mine = n => n ? `<p class="k-rank-me">あなたは <b>${n}位</b>でした</p>` : '';
  return `<p class="hint">${ss.name}（${ss.label}）の結果です。おつかれさまでした！</p>
    <h3 class="k-season-h">マークのランキング<small>期間中に稼いだマーク</small></h3>${mine(d.mark?.rank)}${list(d.mark?.top, x => `${fmt(x.total)} マーク`)}
    <h3 class="k-season-h">🥊 連打王<small>期間中に小壺を叩いた回数</small></h3>${mine(d.renda?.rank)}${list(d.renda?.top, x => `${Number(x.taps).toLocaleString('ja-JP')} 回`, true)}`;
}
function paintSeason() { const b = $('k-season-body'); if (b) { b.innerHTML = seasonBody(st()); b.hidden = !S().seasonOpen; } }
function paintRank() { const k = st(), b = $('k-rank-body'); if (b && !b.hidden) b.innerHTML = rankBody(k); const r = $('k-renda-body'); if (r) r.innerHTML = rendaBody(k);
  // 壺の主の一覧が届いたら、見出しを変えて、別の連打王の欄はしまう（中身は壺の主の「連打王」へ）
  const h = b?.closest('.k-rank')?.querySelector('.sec-head h2'); if (h) h.textContent = rendaBoxOff(k) ? '👑 壺の主（ランキング）' : 'ランキング'; const rs = r?.closest('.k-renda'); if (rs) rs.style.display = rendaBoxOff(k) ? 'none' : ''; }

// ミニゲームを開いたとき：離れていた間（アプリを閉じていた間・ほかの画面にいた間。最大8時間）の稼ぎを入れて、動かし始める
export function startKotsubo() {
  syncSeason();
  const k = st(), now = Date.now(), away = Math.min(8 * 3600e3, now - (k.lastAt || now));
  if (k.rankBase == null) k.rankBase = k.total || 0;  // ランキングの起点（この版で初めて開いたとき。留守の稼ぎより前）
  if (k.loops == null) k.loops = loopsOf(k);  // 周回の印：数え始める前に戻った人の★1を、ここで残しておく（このあと深度5まで潜っても消えないように）
  if (away > 1000 && prodOf(k) > 0) { const g = prodOf(k) * away / 1000 * (k.ups.off1 ? .9 : .5); gain(k, g); if (away > 60e3) H.toast(`留守の間に ${fmtM(g)} マーク稼いでいました`); }
  seasonBase(k);  // 期間が始まって初めて開いたときは、留守の稼ぎを入れたあとを起点にする（期間の前の留守の分を入れないため）
  k.lastAt = now; lastTick = now; onTab = true;
  if (!loop) loop = setInterval(tick, 100);
  rankSend(!rankList && Date.now() >= RENDA.start && Date.now() < RENDA_SHOW);
}

// ---------- 画面 ----------
// 小壺の絵（icons/kotsubo/jar.svg）は、腕を動かすために画面の中へそのまま入れる。読み込むまでは画像として出す
let JAR = null;
const jarArt = () => JAR || '<img src="icons/kotsubo/jar.svg" alt="小壺" draggable="false">';
fetch('icons/kotsubo/jar.svg').then(r => r.ok ? r.text() : Promise.reject()).then(t => { JAR = t.replace(/<!--[\s\S]*?-->/g, ''); const a = $('k-art'); if (a) a.innerHTML = JAR; }).catch(() => {});
export function viewKotsubo() {
  syncSeason();
  const k = st(), esc = H.esc, n = S().buyN || 1;
  const nextBoss = BOSSES[k.lords || 0], d = depthOf(k), dTag = (d ? `<span class="k-depth">深度${d}</span>` : '') + loopTag(loopsOf(k)), spoils = warSpoils(k), ups = upgradesShown(k);
  const bossCard = fight ? `<div class="k-boss fighting"><div class="k-boss-h">${foeIco(foeAt(k, fight.i))}${dTag}<b>${esc(foeName(foeAt(k, fight.i)))}と戦闘中</b></div>
      <div class="k-hp"><span id="k-boss-hp" style="width:${fight.hp / fight.max * 100}%"></span></div><div class="hint" id="k-boss-time"></div>
      <p class="hint">小壺を叩くと、叩く力の${FIGHT_TAP}倍のダメージ。叩くたびに、雇った夜渡りが稼ぎ（毎秒マーク）に応じて加勢します（加勢 +${fmtM(KASEI * prodOf(k) * FIGHT_TAP)}・1回 ${fmtM(hitOf(k))}）。</p></div>`
    : nextBoss ? `<div class="k-boss"><div class="k-boss-h">${foeIco(foeAt(k, k.lords || 0))}${dTag}<b>${esc(foeName(foeAt(k, k.lords || 0)))}</b><span class="hint k-boss-max" id="k-boss-max">体力 ${fmtM(bossHp(k, k.lords || 0))}</span><button class="k-info" data-act="kBossInfo" aria-label="夜の王の説明" title="説明">!</button><button class="primary small-primary k-boss-go" data-act="kFight">挑む</button></div>${weakOf(k) < 1 ? `<p class="hint k-weak">長く戦い続けて、王は弱っている（体力 -${Math.round((1 - weakOf(k)) * 100)}%）</p>` : d > WEAK_MAX_DEPTH ? '<p class="hint k-weak">この深さの王は、時がたっても弱らない</p>' : ''}
</div>`
    : d < DEPTH_MAX ? `<div class="k-boss done"><b>🌅 ${d ? `深度${d}の` : ''}すべての夜の王を討伐しました</b><p class="hint">稼ぎは今 ${fmtX(globalMult(k))}倍です。</p>
      <p class="hint">深き壺に潜ると、深度${d + 1}で最初から周回できます。マークと雇った夜渡りは最初に戻りますが、夜の王の討伐ボーナスと遺物はそのまま。深度${d + 1}では稼ぎが${fmtX(DEPTH_GAIN[d + 1])}倍になり、そのぶん夜の王も硬くなります（深度${DEPTH_MAX}まで）。${d + 1 > SCAR_KEEP_DEPTH && (itemsOf(k).scar || itemsOf(k).rush) ? 'アイテムは、この先へは持っていけない。' : ''}</p>
      <button class="primary small-primary ${S().confirmDive ? 'danger' : ''}" data-act="kDive">${S().confirmDive ? 'もう一度押すと潜ります' : `深き壺に潜る（深度${d + 1}へ）`}</button></div>`
    : `<div class="k-boss done"><b>🌌 深度${DEPTH_MAX}のすべての夜の王を討伐しました</b><p class="hint">深き壺の底にたどり着きました。稼ぎは今 ${fmtX(globalMult(k))}倍です。</p>
      <p class="hint">壺の底から、深度1へ戻ることができます。マークと雇った夜渡りは最初に戻り、討伐のボーナスも1周目を終えたときの分に戻ります。遺物とアイテムはそのまま。</p>
      <button class="ghost small-primary ${S().confirmReturn ? 'danger' : ''}" data-act="kReturn">${S().confirmReturn ? 'もう一度押すと深度1へ戻ります' : '深度1に戻す'}</button></div>`;
  const hireRows = HIRE.map(([id, , base, say], i) => {
    const own = k.hires[id] || 0, cost = priceOf(i, own, n, priceMult(k), priceUpOf(k)), visible = i === 0 || (k.hires[HIRE[i - 1][0]] || 0) > 0 || k.total >= HIRE[i][1] / 2;
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
  // アイテム：絵・名前・数だけ（使うのは、夜の王に挑むときの確かめる画面から）。名前を押すと、効果とフレーバーテキストが開く（説明は開いたときだけ）
  const items = itemsOf(k), itemRows = ITEMS.filter(([id]) => id !== 'scar' || seesScar(k)).map(([id, icon, name, desc, flavor]) => { const n = items[id] || 0, open = S().itemOpen === id;
    return `<div class="k-item ${open ? 'open' : ''} ${n ? '' : 'none'}"><button class="k-item-main" data-act="kItemInfo" data-v="${id}" aria-expanded="${open}"><span class="k-ico">${icon}</span><b>${esc(name)}</b><i id="k-item-${id}">${n}<small>/${ITEM_MAX}</small></i></button></div>
      <div class="k-flavor" data-flv="${id}" ${open ? '' : 'hidden'}><span class="k-eff">${esc(desc)}</span>${esc(flavor).replace(/\n/g, '<br>')}</div>`; }).join('');
  return `<div class="stack-lg kotsubo">
    <button class="ghost back-btn" data-act="kotsuboBack">‹ もどる</button>
    <section class="card-sec k-top">
      <div class="k-mark"><span id="k-mark" class="${k.fullDigits ? 'full' : ''}">${markText(k)}</span><small>マーク</small><button class="k-info" data-act="kUnits" aria-label="数の単位の読み方" title="数の単位">!</button></div>
      <div class="hint k-rate" id="k-rate">${rateText(k)}</div>
      <div class="k-taps" id="k-taps">${tapsText(k)}</div>
      <button class="link-btn k-digits" data-act="kDigits" aria-pressed="${!!k.fullDigits}">${digitsLabel(k)}</button>
      <div class="k-stage" id="k-stage">
        <button class="k-tap" id="k-tap" aria-label="小壺を叩く"><span class="k-art" id="k-art">${jarArt()}</span></button>
        <span class="k-say" id="k-say"></span><span class="k-rush" id="k-rush" hidden>常夜ラッシュ中！×7</span><div class="k-fx" id="k-fx" aria-hidden="true"></div>
      </div>
      <button class="primary small-primary k-rush-go" id="k-rush-go" data-act="kRushGo" ${rushHeld && !countdown ? '' : 'hidden'}>🔥 常夜ラッシュを始める</button>
      <p class="hint k-hint">小壺を叩くとマークがたまる。ときどき出る🏺（常夜の小壺）は、すぐ叩くとボーナス</p>
    </section>
    ${spoils.w + spoils.l ? `<div class="k-spoils"><span>⚔️ 戦果ボーナス：記録した勝利${spoils.w}・敗北${spoils.l}<small>${[seesScar(k) ? `どちらかで受け取れます（爪痕は記録${SCAR_PER_RUNS}戦ごとに1つ・1日${SCAR_PER_DAY}つまで。余った記録は次に残ります）` : '', essNote(k, spoils.runs.length)].filter(Boolean).join('<br>')}</small></span>
      <div class="k-spoils-btns"><button class="primary small-primary" data-act="kClaim">${fmtM(spoils.gain)} マーク</button>${seesScar(k) ? `<button class="ghost small-primary" data-act="kClaimScar" ${spoils.scars ? '' : 'disabled'}>${spoils.scars ? `🩸消えぬ爪痕 ×${spoils.scars}` : !spoils.room ? '🩸爪痕（持ちきれない）' : spoils.today <= 0 ? '🩸爪痕（今日はここまで）' : `🩸爪痕（あと${SCAR_PER_RUNS - spoils.runs.length % SCAR_PER_RUNS}戦）`}</button>` : ''}</div></div>` : ''}
    <section class="card-sec">${bossCard}<p class="hint k-scar" id="k-scar" ${scarText(k) ? '' : 'hidden'}>${scarText(k)}</p></section>
    <section class="card-sec k-items"><div class="sec-head"><h2>アイテム</h2></div><div class="k-item-list">${itemRows}</div></section>
    <section class="card-sec"><div class="sec-head"><h2 id="k-relic-h">${ownOpen ? '所持遺物' : '遺物'}</h2>${ownBtn}</div><div class="k-list" id="k-own" ${ownOpen ? '' : 'hidden'}>${ownRows}</div><div class="k-list" id="k-shop" ${ownOpen ? 'hidden' : ''}>${upRows}</div></section>
    <section class="card-sec"><div class="sec-head"><h2>夜渡りを雇う</h2><div class="chips">${[1, 10].map(x => `<button class="chip mini" data-act="kBuyN" data-v="${x}" aria-pressed="${n === x}">×${x}</button>`).join('')}</div></div>
      <div class="k-list">${hireRows}</div></section>
    <section class="card-sec k-rank"><div class="sec-head"><h2>${rendaBoxOff(k) ? '👑 壺の主（ランキング）' : 'ランキング'}</h2><button class="chip mini" data-act="kRank" aria-pressed="${!!S().rankOpen}">${S().rankOpen ? '閉じる' : '見る'}</button></div>
      <div id="k-rank-body" ${S().rankOpen ? '' : 'hidden'}>${rankBody(k)}</div></section>
    ${Date.now() < RENDA_SHOW && !rendaBoxOff(k) ? `<section class="card-sec k-rank k-renda"><div class="sec-head"><h2>🥊 連打王</h2></div><div id="k-renda-body">${rendaBody(k)}</div></section>` : ''}
    ${pastSeasons().length ? `<section class="card-sec k-rank k-season"><div class="sec-head"><h2>🏆 シーズンの結果</h2><div class="chips">${pastSeasons().map(x => `<button class="chip mini" data-act="kSeason" data-v="${x.id}" aria-pressed="${S().seasonOpen === x.id}">${x.name}</button>`).join('')}</div></div><div id="k-season-body" ${S().seasonOpen ? '' : 'hidden'}>${seasonBody(k)}</div></section>` : ''}
    <p class="hint k-stats">これまで<br>${[`${fmtM(k.total)} マーク`, `${fmtM(k.taps)} 回叩いた`, `常夜の小壺 ${k.jars || 0} 回`, `討伐 ${k.lords || 0}/${BOSSES.length}`, d ? `深度${d}` : ''].filter(Boolean).join('<br>')}</p>
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

// 挑む前に確かめる画面（画面の作り直しで消えないよう、body の直下に置く）
function paintPrep(k) {
  let box = $('k-prep');
  if (!prep) { box?.remove(); return; }
  if (!box) { box = document.createElement('div'); box.id = 'k-prep'; document.body.appendChild(box); }
  const esc = H.esc, it = itemsOf(k), foe = foeAt(k, k.lords || 0);
  const on = v => v === 'none' ? !prep.items.size : prep.items.has(v);
  const opt = (v, label, n, ok) => `<button data-act="kPrepItem" data-v="${v}" aria-pressed="${on(v)}" ${ok ? '' : 'disabled'}>${label}${n == null ? '' : `<small>×${n}</small>`}</button>`;
  const scarN = (it.scar || 0) + (k.scarReady ? 1 : 0);
  box.innerHTML = `<div class="scrim" data-act="kPrepClose"></div><div class="sheet k-prep" role="dialog" aria-label="夜の王に挑む">
    <div class="sheet-head"><h2>${esc(foeName(foe))}に挑む</h2><button class="ghost" data-act="kPrepClose">やめる</button></div>
    <div class="k-prep-body">
      <p class="k-prep-q">アイテムを使用しますか？<small>${seesScar(k) ? '（香と爪痕は一緒に使えます。1回の戦いで、それぞれ1つまで）' : '（1回の戦いで1つまで）'}</small></p>
      <div class="k-prep-items ${seesScar(k) ? '' : 'two'}">${opt('none', '使わない', null, true)}${opt('rush', '🕯️ 常夜の香', it.rush || 0, (it.rush || 0) > 0)}${seesScar(k) ? opt('scar', '🩸 消えぬ爪痕', scarN, scarN > 0) : ''}</div>
      ${[...prep.items].map(id => `<p class="hint">${ITEM[id][1]} ${esc(ITEM[id][3])}</p>`).join('')}
      ${locked ? '' : `<p class="k-prep-q">画面をロックしますか？<small>（本気で叩いても、画面が動かなくなります）</small></p>
      <div class="seg">${[['on', 'ロックする'], ['off', 'しない']].map(([v, l]) => `<button data-act="kPrepLock" data-v="${v}" aria-pressed="${prep.lock === (v === 'on')}">${l}</button>`).join('')}</div>`}
      <button class="primary k-prep-go" data-act="kPrepGo">挑む</button>
    </div></div>`;
}
// 「毎秒・1回」の行（画面を作り直すときも最初から入れておく。空だと一瞬で1行ぶん縮んで、下の欄がガクッと動くため）
const rateText = k => `毎秒 ${fmtRate(prodOf(k))}・1回 ${fmtRate(tapOf(k))}`;
// 叩いた回数（シーズン中は、そのシーズンに叩いた回数＝連打王の数）
const tapsText = k => rendaOn() ? `今シーズン叩いた回数 ${rendaOf(k).toLocaleString('ja-JP')}回` : `叩いた回数 ${(k.taps || 0).toLocaleString('ja-JP')}回`;
function closePrep() { prep = null; $('k-prep')?.remove(); }
// 数の単位の早見表（「!」から開く）。今のマークの単位に印を付ける
function openUnits(k) {
  closeUnits(); const box = document.createElement('div'); box.id = 'k-units'; document.body.appendChild(box);
  const m = Math.floor(k.mark || 0), cur = [...UNIT_INFO].reverse().find(([e]) => m >= Math.pow(10, e));
  box.innerHTML = `<div class="scrim" data-act="kUnitsClose"></div><div class="sheet k-prep k-units" role="dialog" aria-label="数の単位の読み方">
    <div class="sheet-head"><h2>数の単位の読み方</h2><button class="ghost" data-act="kUnitsClose">閉じる</button></div>
    <div class="k-prep-body"><p class="hint">単位は4桁ごとに変わります。<br>1万は1の後ろに0が4個（10の4乗）、1億は0が8個（10の8乗）。</p>
      <ol class="k-unit-list">${UNIT_INFO.map(u => `<li class="${u === cur ? 'now' : ''}"><div class="k-unit-h"><b>${u[1]}</b><span class="k-unit-yomi">${u[2]}</span><span class="k-unit-e">10の${u[0]}乗</span>${u === cur ? '<span class="badge">今ここ</span>' : ''}</div><p>${u[3]}</p></li>`).join('')}</ol>
    </div></div>`;
  box.querySelector('.now')?.scrollIntoView({ block: 'center' });
}
function closeUnits() { $('k-units')?.remove(); }
// 「3・2・1」：数字を大きく出してから、戦いを始める。カウントダウン中は叩けない
function startCountdown(onGo, goText = '挑め！') {
  stopCountdown();
  const el = document.createElement('div'); el.id = 'k-count'; el.className = 'k-count'; el.setAttribute('aria-live', 'assertive'); document.body.appendChild(el);
  let n = 3;
  const step = () => {
    if (!countdown) return;
    if (n > 0) { el.innerHTML = `<b>${n}</b>`; el.firstChild.classList.add('pop'); n--; countdown.timer = setTimeout(step, 800); return; }
    el.innerHTML = `<b class="go">${goText}</b>`; countdown.timer = setTimeout(() => { el.remove(); }, 600);
    countdown = null; onGo();
  };
  countdown = { timer: 0 }; paintRushBtn(); step();
}
function stopCountdown() { if (countdown) clearTimeout(countdown.timer); countdown = null; $('k-count')?.remove(); }
// ためている常夜ラッシュの「始める」ボタンの出し入れ（カウントダウン中は隠す）
function paintRushBtn() { const b = $('k-rush-go'); if (b) b.hidden = !rushHeld || !!countdown; }
function goRush() { rushHeld = false; rushUntil = Date.now() + 12000; H.toast('常夜ラッシュ！12秒間、叩く力が7倍'); paintRushBtn(); paint(st()); }
// 戦いを始める。アイテムはここで使う（数が減る）
function beginFight(items) {
  const k = st(), i = k.lords || 0; if (!BOSSES[i] || fight || H.tab() !== 'kotsubo') return;
  // 消えぬ爪痕の傷が残っていれば、その分だけ削れた体力から始める。爪痕を使えば、この戦いで削った分も残る
  const full = bossHp(k, i), frac = k.scarHp && k.scarHp.i === i ? k.scarHp.frac : 1, it = itemsOf(k), now = Date.now();
  let scar = false, rush = false;
  if (items.has('scar') && (k.scarReady || it.scar > 0)) { if (!k.scarReady) it.scar--; scar = true; }
  if (items.has('rush') && it.rush > 0) { it.rush--; rushUntil = itemRushUntil = now + 12000; rush = true; }
  if (k.scarReady && !scar) giveItem(k, 'scar');  // 前の版で刻んでいた爪痕を使わなかったときは、持ち物に戻す
  k.scarReady = false;
  fight = { i, hp: full * frac, max: full, end: now + FIGHT_SEC * 1000, scar, items: (scar ? 1 : 0) + (rush ? 1 : 0) };
  const msg = [rush ? '🕯️常夜の香を焚いた…12秒間、叩く力が7倍' : '', scar ? '🩸爪痕を刻んだ…削った体力は、逃げられても残る' : ''].filter(Boolean).join('／');
  if (msg) H.toast(msg);
  H.save(); H.render();
}

// ボタンを押したとき（app.js の click から呼ばれる）。true を返すと画面を作り直す
// 雇ったあと、画面を作り直しても、押したボタンが同じ位置に見えるようにする（上の遺物の欄に心得が増えて、下へずれるため）。app.js が作り直したあとに使う
let kAnchor = null;
export const takeKAnchor = () => { const x = kAnchor; kAnchor = null; return x; };
export function kotsuboAct(a, v) {
  const k = st(), ui = S();
  if (a !== 'kReset') ui.confirmReset = false;
  if (a !== 'kDive') ui.confirmDive = false;
  if (a !== 'kReturn') ui.confirmReturn = false;
  if (a === 'kLock') { setLock(!locked); H.toast(locked ? '画面をロックしました（もう一度押すと解除）' : '画面のロックを解除しました'); return false; }
  // マークの数の出し方（単位／すべての桁）：画面は作り直さず、数とボタンだけ書き換える
  if (a === 'kDigits') { k.fullDigits = !k.fullDigits; H.save(); paint(k); document.querySelectorAll('[data-act="kDigits"]').forEach(b => { b.textContent = digitsLabel(k); b.setAttribute('aria-pressed', String(!!k.fullDigits)); }); return false; }
  // ランキング：開け閉め・参加・抜ける・管理人の操作（画面全体は作り直さず、ランキングの欄だけ書き換える）
  if (a !== 'kRankAdmin' && a !== 'kRankLeave') ui.rankConfirm = null;
  if (a === 'kRank') {
    ui.rankOpen = !ui.rankOpen; const b = $('k-rank-body'); if (b) b.hidden = !ui.rankOpen;
    document.querySelectorAll('[data-act="kRank"]').forEach(x => { x.textContent = ui.rankOpen ? '閉じる' : '見る'; x.setAttribute('aria-pressed', String(!!ui.rankOpen)); });
    if (ui.rankOpen) { paintRank(); loadRank(false); }
    return false;
  }
  if (a === 'kSeason') { const ui = S(); ui.seasonOpen = ui.seasonOpen === v ? null : v;
    document.querySelectorAll('[data-act="kSeason"]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === ui.seasonOpen)));
    if (ui.seasonOpen) loadSeason(ui.seasonOpen); paintSeason(); return false; }
  if (a === 'kRankJoin') { k.rankJoin = true; H.save(); paintRank(); rankSend(true); return false; }
  if (a === 'kRankLeave') {
    if (ui.rankConfirm !== 'leave') { ui.rankConfirm = 'leave'; paintRank(); return false; }
    ui.rankConfirm = null; k.rankJoin = false; k.rankMe = null; rankList = null; H.save();
    if (!H.devHost) H.postOnline({ type: 'kotsubo2_leave' }).catch(() => {});
    H.toast('ランキングから抜けました'); paintRank(); return false;
  }
  if (a === 'kRankAdmin') {
    const [op, rid] = String(v).split(':'); if (!rid || !['rank_del', 'rank_ban'].includes(op)) return false;
    if (ui.rankConfirm !== v) { ui.rankConfirm = v; paintRank(); return false; }  // 消す・締め出すは2回押す
    ui.rankConfirm = null;
    if (H.devHost) { if (rankList) rankList.top = rankList.top.filter(x => x.rid !== rid); H.toast('（開発用）一覧から外しました'); paintRank(); return false; }
    H.postOnline({ type: 'admin', key: H.adminKey(), op, id: rid }).then(r => {
      if (!r?.ok) { H.toast(r?.error === 'forbidden' ? '合言葉が通りませんでした。管理人モードを入れ直してください' : 'うまくいきませんでした'); return; }
      H.toast(op === 'rank_ban' ? '消して、締め出しました' : '消しました'); loadRank(true);
    }).catch(() => H.toast('通信できる所で、もう一度お試しください'));
    paintRank(); return false;
  }
  if (a === 'kItemInfo') { ui.itemOpen = ui.itemOpen === v ? null : v; showFlavor('kItemInfo', ui.itemOpen); return false; }
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
    const n = ui.buyN || 1, cost = priceOf(i, k.hires[v] || 0, n, priceMult(k), priceUpOf(k));
    if (k.mark < cost) { H.toast('マークが足りません'); return false; }
    const sel = `[data-act="kHire"][data-v="${v}"]`, b = document.querySelector(sel); kAnchor = b ? { sel, top: b.getBoundingClientRect().top } : null;
    k.mark -= cost; k.hires[v] = (k.hires[v] || 0) + n; return true;
  }
  if (a === 'kUp') {
    const u = upgradesShown(k).find(x => x.id === v); if (!u) return false;
    if (k.mark < u.cost) { H.toast('マークが足りません'); return false; }
    k.mark -= u.cost; k.ups[v] = 1; H.toast(`「${u.name}」を手に入れた`); return true;
  }
  // 挑む：すぐには始めず、使うアイテムと画面のロックを確かめる画面を出す
  if (a === 'kFight') {
    if (!BOSSES[k.lords || 0] || fight || countdown) return false;
    // 前の版で、挑む前に爪痕を刻んでいた人は、爪痕を使う形で始める（もう1つは減らない）
    // 画面のロックは、前に選んだほうから始める（初めては「しない」）
    prep = { items: new Set(k.scarReady ? ['scar'] : []), lock: !locked && !!k.prepLock };
    // 選ぶものがない（アイテムを1つも持っていなくて、画面もロック済み）ときは、確かめる画面を出さずに「3・2・1」へ
    const it = itemsOf(k);
    if (locked && !(it.rush > 0) && !(it.scar > 0) && !k.scarReady) { const p = prep; prep = null; paintRushBtn(); startCountdown(() => { beginFight(p.items); paintRushBtn(); }); return false; }
    paintPrep(k); return false;
  }
  // 使うアイテム：香・爪痕は押すたびに付け外し（一緒に選べる）。「使わない」で全部外す
  if (a === 'kPrepItem') {
    if (!prep) return false;
    if (v === 'none') prep.items.clear();
    else { if (!ITEM[v] || (!(itemsOf(k)[v] > 0) && !(v === 'scar' && k.scarReady))) return false; prep.items.has(v) ? prep.items.delete(v) : prep.items.add(v); }
    paintPrep(k); return false;
  }
  if (a === 'kPrepLock') { if (!prep) return false; prep.lock = v === 'on'; paintPrep(k); return false; }
  if (a === 'kPrepClose') { closePrep(); return false; }
  if (a === 'kUnits') { openUnits(k); return false; }
  if (a === 'kBoard') { ui.board = v; ui.page = null; paintRank(); return false; }
  if (a === 'kBoardInfo') { ui.boardInfo = !ui.boardInfo; paintRank(); return false; }
  if (a === 'kNbOnly') { ui.nbOnly = !ui.nbOnly; ui.page = null; paintRank(); return false; }
  if (a === 'kPage') { const all = rankList?.boards?.[boardId()] || [], list = ui.nbOnly ? all.filter(x => x.nb) : all, idx = list.findIndex(x => x.rid === k.rankMe?.rid);
    const cur = ui.page ?? (idx >= 0 ? Math.floor(idx / PAGE) : 0); ui.page = v === 'me' ? null : Math.max(0, cur + (v === 'next' ? 1 : -1)); paintRank(); return false; }
  if (a === 'kUnitsClose') { closeUnits(); return false; }
  // 夜の王の欄の「!」：説明を出す
  if (a === 'kBossInfo') { H.toast(`${FIGHT_SEC}秒のうちに削り切れば討伐。討伐するたびに、すべての稼ぎが永久に1.25倍（今 ${fmtX(globalMult(k))}倍）`); return false; }
  if (a === 'kRushGo') {
    if (!rushHeld || countdown) return false;
    if (fight) { goRush(); return false; }  // 戦い中は、時間が減らないよう、すぐ始める
    paintRushBtn(); startCountdown(goRush, 'ラッシュ！'); paintRushBtn(); return false;
  }
  if (a === 'kPrepGo') {
    if (!prep || fight || countdown) return false;
    const p = prep; closePrep();
    if (!locked) k.prepLock = p.lock;  // 次に挑むときのために、選んだほうを覚えておく
    if (p.lock && !locked) setLock(true);
    paintRushBtn(); startCountdown(() => { beginFight(p.items); paintRushBtn(); }); return false;
  }
  // 深き壺に潜る：討伐した数を bank に移して、マーク・雇った夜渡り・討伐の進み具合を最初に戻し、深度を1つ上げる
  // 深度5を抜けた人だけ：深度1へ戻ってやり直す（v59 の公開直後に深度5まで抜けた人が、直したあとの数値で遊び直せるように）。
  // 討伐ボーナスは1周目を終えた分（10体）に戻す（深度5の分まで残すと、深度1の王が弱すぎるため）。遺物・アイテムは残す
  if (a === 'kReturn') {
    if (depthOf(k) < DEPTH_MAX || (k.lords || 0) < BOSSES.length || fight) return false;
    if (!ui.confirmReturn) { ui.confirmReturn = true; return true; }
    ui.confirmReturn = false; rushUntil = itemRushUntil = 0;
    k.loops = loopsOf(k) + 1;  // 周回の印を1つ増やす
    Object.assign(k, { bank: BOSSES.length, lords: 0, lordAt: Date.now(), scarHp: null, scarReady: false, depth: 1, order: makeOrder(), mark: 0, hires: {}, maxDepth: DEPTH_MAX });
    H.toast('壺の底から、深度1へ戻った'); H.save(); return true;
  }
  if (a === 'kDive') {
    if ((k.lords || 0) < BOSSES.length || depthOf(k) >= DEPTH_MAX || fight) return false;
    if (!ui.confirmDive) { ui.confirmDive = true; return true; }
    ui.confirmDive = false; rushUntil = itemRushUntil = 0;
    k.bank = (k.bank || 0) + k.lords; k.lords = 0; k.lordAt = Date.now(); k.scarHp = null; k.scarReady = false; k.depth = depthOf(k) + 1; k.maxDepth = Math.max(k.maxDepth || 0, k.depth); k.order = makeOrder();
    k.mark = 0; k.hires = {};
    if (k.depth > SCAR_KEEP_DEPTH) { itemsOf(k).scar = 0; itemsOf(k).rush = 0; }  // 消えぬ爪痕・常夜の香は深度3までしか持ち越せない（深度4・5へ潜るときに消える）
    H.toast(`深き壺に潜った…深度${k.depth}。稼ぎは${fmtX(globalMult(k))}倍から`); H.save(); return true;
  }
  if (a === 'kClaim') { const s = warSpoils(k); gain(k, s.gain); k.claimAt = Date.now(); const e = giveEss(k, s.runs.length); H.toast(`戦果ボーナス ${fmtM(s.gain)} マーク！${essToast(e)}`); H.save(); return true; }
  // 爪痕で受け取る：古い記録から（爪痕の数×SCAR_PER_RUNS）戦ぶんを使い、使った最後の記録の時刻までを受け取り済みにする
  if (a === 'kClaimScar') {
    const s = warSpoils(k); if (!s.scars || !seesScar(k)) return false;
    const used = s.runs.slice().reverse().slice(0, s.scars * SCAR_PER_RUNS);
    const got = giveItem(k, 'scar', s.scars); k.claimAt = madeAt(used[used.length - 1]);
    k.scarDay = { day: jstDay(), n: scarTodayOf(k) + s.scars }; const e = giveEss(k, used.length);
    H.toast(`戦果ボーナス：🩸消えぬ爪痕を${got}つ手に入れた${essToast(e)}`); H.save(); return true;
  }
  if (a === 'kReset') {
    if (!ui.confirmReset) { ui.confirmReset = true; return true; }
    ui.confirmReset = false; fight = null;
    if (k.rankJoin && !H.devHost) H.postOnline({ type: 'kotsubo2_leave', keepRenda: true }).catch(() => {});  // マークのランキングからは抜ける（最初からの数字で参加し直せる）。連打王の回数は残す
    delete H.prefs().kotsubo; H.toast('小壺のデータを最初からにしました'); return true;
  }
  return false;
}
// 上の小さな文字（タブを開いているとき）
// 左上の小見出しは空にする（マーク・毎秒は叩く壺の上に出ているので要らない。長いと右上のボタンとかぶる）
export const kotsuboSub = () => '';
// 夜の王との戦い・3・2・1・挑む前の画面・常夜ラッシュ（ためている間も）のあいだは true（app.js の「下に引いて更新」を止める）
export const kotsuboBusy = () => !!(fight || countdown || prep || rushHeld || rushUntil > Date.now());
