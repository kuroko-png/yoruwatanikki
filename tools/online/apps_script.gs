/**
 * 「夜の痕跡」のオンライン機能の受け取り口（Google スプレッドシート + Apps Script）。
 *
 * 置き方（スプレッドシートの持ち主が1回だけ行う）：
 *  1. Google ドライブで新しいスプレッドシートを作る（名前は自由。例：夜の痕跡 オンライン）
 *  2. メニューの「拡張機能」→「Apps Script」を開く
 *  3. 最初から入っているコードを全部消して、このファイルの中身を貼り付けて保存する
 *  4. 右上の「デプロイ」→「新しいデプロイ」→ 種類の歯車で「ウェブアプリ」を選ぶ
 *       次のユーザーとして実行：自分　／　アクセスできるユーザー：全員
 *  5. 「デプロイ」を押し、アクセスの承認をする（「このアプリは確認されていません」と出たら「詳細」→「（プロジェクト名）に移動」）
 *  6. 表示された「ウェブアプリ」のURL（https://script.google.com/macros/s/…/exec）をアプリ側に設定する
 * コードを直したときは「デプロイ」→「デプロイを管理」→ 鉛筆 →「バージョン：新バージョン」→「デプロイ」（URLは変わらない）。
 *
 * 受け取るもの：
 *  - 戦績（みんなの勝率）：参加をオンにした人の戦績だけ。名前などは受け取らず、端末ごとのランダムなIDだけ
 *  - 誤植の報告：敵の名前と、書かれた文章
 *  - 自動バックアップ：端末の記録を、アプリ側で暗号化したもの。鍵（引き継ぎコード）は送られてこないので、ここでは中身を読めない
 *  - みんなに公開したビルド（builds）：不適切な言葉を含むものは受け付けない。問題のある行は消してよい
 *  - 機能の実装リクエスト（requests）
 *  - みんなのビルドへのリアクション（votes：👍😂🔥💡🤯。1人が何種類でも付けられ、押し直すと取り消し。新しく付けるのは1端末1日20回まで。前の「いいね」も👍として数える）
 *  - みんなのビルドの通報（build_reports：3つ以上の端末から通報されたビルドは、自動で一覧から外す。行を消せば戻る）
 * 不正対策：1つの端末が同じ日に30戦を超えて送ってきた日の戦績は、集計に入れない（人が遊べる数を超えるため）
 * 受信箱（type=inbox）：機能リクエストと誤りの報告を、合言葉つきで読み出す（持ち主の毎朝の確認用）。
 *   合言葉は「プロジェクトの設定（歯車）→ スクリプト プロパティ」に INBOX_KEY という名前で入れる。合言葉が未設定なら誰にも返さない
 * シートは自動で作られる（runs＝戦績、reports＝誤植の報告、backups＝自動バックアップ）。runs・reports の行は消してよい。
 * backups の行を消すと、その人は引き継ぎコードで戻せなくなるので消さないこと。
 */

const RUN_COLS = ['receivedAt', 'clientId', 'runId', 'date', 'lordId', 'everdark', 'mode', 'depth', 'party', 'charId', 'result', 'lossAt', 'deleted', 'updatedAt', 'style', 'weaponType'];
const REPORT_COLS = ['receivedAt', 'clientId', 'enemy', 'text', 'appVersion'];
const MAX_RUNS_PER_POST = 500;
const BUILD_COLS = ['key', 'presetId', 'updatedAt', 'charId', 'name', 'data'];
const REQUEST_COLS = ['receivedAt', 'clientId', 'text', 'appVersion'];
const VOTE_COLS = ['key', 'presetId', 'value', 'updatedAt'];
const BREPORT_COLS = ['key', 'presetId', 'reason', 'at'];
const MAX_RUNS_PER_DAY = 30, MAX_VOTES_PER_DAY = 20, HIDE_REPORTS = 3;
// みんなのビルドのリアクションの種類（アプリの REACTIONS と同じ順・同じ名前）。前の「いいね」は like として数える
const REACTIONS = ['like', 'lol', 'strong', 'tips', 'wow'];

// 不適切な言葉（アプリ側の src/data/ngwords.js と同じ考え方。ここでも念のため確かめる）
const NG_ANY = ['しね', 'ころす', 'ころせ', 'ぶっころ', 'きえろ', 'きちがい', 'がいじ', 'ちんこ', 'ちんぽ', 'まんこ', 'うんこ', 'せっくす', 'れいぷ', 'くそ',
  '死ね', '氏ね', '殺す', '殺せ', '殺害', '池沼', '基地外', '糞', 'fuck', 'shit', 'bitch', 'nigger', 'nigga', 'sex'];
const NG_KATA = ['カス', 'クズ', 'ゴミ', 'ブス', 'デブ', 'ハゲ', 'ガイジ'];
const NG_ALLOW = ['カス当たり', 'カスあたり', 'かすあたり'];
function ngHit_(text) {
  let t = String(text || '').normalize('NFKC').toLowerCase();
  NG_ALLOW.forEach(w => { t = t.split(w.toLowerCase()).join(''); });
  t = t.replace(/[^\p{L}]/gu, '');  // 文字以外（記号・伏せ字の○×＊・数字・空白）を取り除く
  const hira = t.replace(/[\u30a1-\u30f6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  return NG_ANY.some(w => hira.includes(w)) || NG_KATA.some(w => t.includes(w.toLowerCase()));
}
const BACKUP_COLS = ['id', 'updatedAt', 'size', 'data（暗号化・長いときは右の列へ続く）'];
const BACKUP_CHUNK = 45000;          // 1つのセルに入れる文字数（セルの上限は5万字）
const BACKUP_MAX = 3000000;          // 1人分の上限（文字数）

// 自動バックアップの行を探す（1列目＝引き継ぎコードから作った番号）
function backupRow_(sh, id) {
  const hit = sh.getRange('A:A').createTextFinder(id).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function sheet_(name, cols) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(cols); sh.setFrozenRows(1); }
  else if (sh.getLastColumn() < cols.length) sh.getRange(1, 1, 1, cols.length).setValues([cols]);  // 列が増えたときは見出しを足す
  return sh;
}
const str_ = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const json_ = obj => ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);

// アプリから送られてくる（本文は JSON の文字列）
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  const clientId = str_(body.clientId, 40);
  if (!clientId) return json_({ ok: false, error: 'no client' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const now = new Date();
    if (body.type === 'runs' && Array.isArray(body.runs)) {
      const rows = body.runs.slice(0, MAX_RUNS_PER_POST).map(r => [now, clientId, str_(r.id, 40), str_(r.date, 10), str_(r.lordId, 20), !!r.everdark,
        str_(r.mode, 10), Number(r.depth) || '', str_(r.party, 10), str_(r.charId, 20), r.result === 'win' ? 'win' : 'loss', str_(r.lossAt, 10), !!r.deleted, Number(r.updatedAt) || 0, str_(r.style, 20), str_(r.weaponType, 20)]);
      if (rows.length) { const sh = sheet_('runs', RUN_COLS); sh.getRange(sh.getLastRow() + 1, 1, rows.length, RUN_COLS.length).setValues(rows); }
      CacheService.getScriptCache().remove('stats');
      return json_({ ok: true, received: rows.length });
    }
    if (body.type === 'backup_put' || body.type === 'backup_get') {
      const id = str_(body.id, 64);
      if (!/^[0-9a-f]{64}$/.test(id)) return json_({ ok: false, error: 'bad id' });
      const sh = sheet_('backups', BACKUP_COLS);
      let row = backupRow_(sh, id);
      if (body.type === 'backup_get') {
        if (!row) return json_({ ok: true, found: false });
        const vals = sh.getRange(row, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
        return json_({ ok: true, found: true, updatedAt: vals[1], data: vals.slice(3).join('') });
      }
      const data = typeof body.data === 'string' ? body.data : '';
      if (!data || data.length > BACKUP_MAX) return json_({ ok: false, error: 'bad size' });
      const chunks = data.match(new RegExp('[\\s\\S]{1,' + BACKUP_CHUNK + '}', 'g'));
      if (!row) row = sh.getLastRow() + 1;
      const width = 3 + chunks.length;
      if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
      sh.getRange(row, 1, 1, Math.max(sh.getLastColumn(), width)).clearContent();
      // すべて「文字」として入れる（= や + で始まっても計算式にしない）
      sh.getRange(row, 1, 1, width).setNumberFormat('@').setValues([[id, now.toISOString(), String(data.length), ...chunks]]);
      return json_({ ok: true });
    }
    if (body.type === 'build_put' || body.type === 'build_del') {
      const presetId = str_(body.id, 60);
      if (!presetId) return json_({ ok: false, error: 'no id' });
      const key = clientId + '/' + presetId;
      const sh = sheet_('builds', BUILD_COLS);
      const hit = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
      if (body.type === 'build_del') { if (hit) sh.deleteRow(hit.getRow()); CacheService.getScriptCache().remove('builds'); return json_({ ok: true }); }
      const data = typeof body.data === 'string' ? body.data.slice(0, 30000) : '';
      let parsed; try { parsed = JSON.parse(data); } catch (err) { return json_({ ok: false, error: 'bad data' }); }
      const name = str_(body.name, 60);
      if (ngHit_(name) || ngHit_(parsed.name) || ngHit_(parsed.weaponName) || ngHit_(parsed.pubNote)) return json_({ ok: false, error: 'ng' });
      const row = [key, presetId, now.toISOString(), str_(body.charId, 20), name, data];
      const r = hit ? hit.getRow() : sh.getLastRow() + 1;
      sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
      CacheService.getScriptCache().remove('builds');
      return json_({ ok: true });
    }
    if (body.type === 'vote') {
      const presetId = str_(body.id, 60), value = Number(body.value);
      if (!presetId || ![-1, 0, 1].includes(value)) return json_({ ok: false, error: 'bad vote' });
      const key = clientId + '/' + presetId;
      const sh = sheet_('votes', VOTE_COLS);
      const hit = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
      if (value && !hit) {
        const today = now.toISOString().slice(0, 10);
        const mine = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues().filter(v => v[0].startsWith(clientId + '/') && v[3].startsWith(today)).length : 0;
        if (mine >= MAX_VOTES_PER_DAY) return json_({ ok: false, error: 'limit' });
      }
      if (!value) { if (hit) sh.deleteRow(hit.getRow()); }
      else sh.getRange(hit ? hit.getRow() : sh.getLastRow() + 1, 1, 1, 4).setNumberFormat('@').setValues([[key, presetId, String(value), now.toISOString()]]);
      CacheService.getScriptCache().remove('builds');
      return json_({ ok: true });
    }
    // リアクション（1つのビルドに、1人が何種類でも付けられる。同じものをもう一度押すと取り消し。新しく付けるのは1日20回まで）
    if (body.type === 'react') {
      const presetId = str_(body.id, 60), r = str_(body.r, 20), on = body.on === true;
      if (!presetId || REACTIONS.indexOf(r) < 0) return json_({ ok: false, error: 'bad react' });
      const key = clientId + '/' + presetId + '/' + r;
      const sh = sheet_('votes', VOTE_COLS);
      const hit = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
      if (on && !hit) {
        const today = now.toISOString().slice(0, 10);
        const mine = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 4).getDisplayValues().filter(v => v[0].startsWith(clientId + '/') && v[3].startsWith(today)).length : 0;
        if (mine >= MAX_VOTES_PER_DAY) return json_({ ok: false, error: 'limit' });
        sh.getRange(sh.getLastRow() + 1, 1, 1, 4).setNumberFormat('@').setValues([[key, presetId, 'r:' + r, now.toISOString()]]);
      }
      if (!on && hit) sh.deleteRow(hit.getRow());
      CacheService.getScriptCache().remove('builds');
      return json_({ ok: true });
    }
    if (body.type === 'build_report') {
      const presetId = str_(body.id, 60);
      if (!presetId) return json_({ ok: false, error: 'no id' });
      const key = clientId + '/' + presetId;
      const sh = sheet_('build_reports', BREPORT_COLS);
      if (!sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext()) sh.appendRow([key, presetId, str_(body.reason, 200), now.toISOString()]);
      CacheService.getScriptCache().remove('builds');
      return json_({ ok: true });
    }
    if (body.type === 'request') {
      const text = str_(body.text, 1000).trim();
      if (!text) return json_({ ok: false, error: 'empty' });
      sheet_('requests', REQUEST_COLS).appendRow([now, clientId, text, str_(body.appVersion, 10)]);
      return json_({ ok: true });
    }
    if (body.type === 'report') {
      const text = str_(body.text, 1000).trim();
      if (!text) return json_({ ok: false, error: 'empty' });
      sheet_('reports', REPORT_COLS).appendRow([now, clientId, str_(body.enemy, 100), text, str_(body.appVersion, 10)]);
      return json_({ ok: true });
    }
    return json_({ ok: false, error: 'unknown type' });
  } finally { lock.releaseLock(); }
}

// みんなの統計（3分ごとに数え直す）
// from・to（yyyy-MM-dd）を付けると、その期間（両端の日を含む）の戦績だけを数える。付けなければ全期間。
// 返す range に、実際に使った期間を入れる（アプリはこれを見て、期間の絞り込みに対応した版かを確かめる）
function doGet(e) {
  const prm = e.parameter || {};
  const type = prm.type;
  if (type === 'builds') return builds_();
  if (type === 'inbox') return inbox_(prm);
  if (type !== 'stats') return json_({ ok: true, app: 'yoru-no-konseki' });
  const ymd = x => (/^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : '');
  const from = ymd(prm.from), to = ymd(prm.to);
  const cacheKey = 'stats' + (from || to ? ':' + from + ':' + to : '');
  const cache = CacheService.getScriptCache();
  const hit = cache.get(cacheKey);
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const sh = sheet_('runs', RUN_COLS);
  const values = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, RUN_COLS.length).getValues() : [];
  // 同じ戦績が何度も送られてくるので、端末ID＋戦績IDごとに一番新しいものだけ数える
  const latest = {};
  values.forEach(v => { const k = v[1] + '/' + v[2]; if (!latest[k] || v[13] >= latest[k][13]) latest[k] = v; });
  const add = (map, key, win) => { const x = map[key] || (map[key] = { n: 0, w: 0 }); x.n++; if (win) x.w++; };
  const out = { ok: true, updatedAt: Date.now(), range: { from: from, to: to }, players: 0, total: { n: 0, w: 0 }, lord: {}, char: {}, lordChar: {}, style: {}, weapon: {}, depth: {}, party: {},
    byDate: {}, charDepth: {}, charWeapon: {}, charStyle: {},
    // 分析用（勝敗つき）：型・武器・深度・人数ごと、敗北した場所、夜の王／夜渡りごとの深度・人数・武器、日ごとの推移
    styleW: {}, weaponW: {}, depthW: {}, partyW: {}, loss: {}, lordLoss: {}, lordDepth: {}, charDepthW: {}, charWeaponW: {}, charParty: {}, lordParty: {}, trend: {} };
  const add2 = (map, a, b, win) => add(map[a] || (map[a] = {}), b, win);
  // 日ごとの推移：期間を指定したらその期間すべて、全期間なら直近60日
  const trendSince = from || Utilities.formatDate(new Date(Date.now() - 59 * 864e5), 'Asia/Tokyo', 'yyyy-MM-dd');
  const since = Utilities.formatDate(new Date(Date.now() - 14 * 864e5), 'Asia/Tokyo', 'yyyy-MM-dd');
  const inc = (map, a, b) => { const m = map[a] || (map[a] = {}); m[b] = (m[b] || 0) + 1; };
  const players = {};
  const dayKey = v => v[1] + '/' + (v[3] instanceof Date ? Utilities.formatDate(v[3], 'Asia/Tokyo', 'yyyy-MM-dd') : String(v[3]).slice(0, 10));
  const perDay = {};
  Object.keys(latest).forEach(k => { const v = latest[k]; if (!(v[12] === true || v[12] === 'TRUE')) perDay[dayKey(v)] = (perDay[dayKey(v)] || 0) + 1; });
  Object.keys(latest).forEach(k => {
    const v = latest[k];
    if (v[12] === true || v[12] === 'TRUE') return;  // 消された戦績
    if (perDay[dayKey(v)] > MAX_RUNS_PER_DAY) return;  // 1日に人が遊べる数を超える分は数えない
    const day = v[3] instanceof Date ? Utilities.formatDate(v[3], 'Asia/Tokyo', 'yyyy-MM-dd') : String(v[3]).slice(0, 10);
    if ((from && day < from) || (to && day > to)) return;  // 期間の外
    const win = v[10] === 'win', lord = v[4] + (v[5] === true || v[5] === 'TRUE' ? ':ever' : '');
    players[v[1]] = 1;
    add(out, 'total', win);
    add(out.lord, lord, win); add(out.char, v[9], win); add(out.lordChar, lord + '/' + v[9], win);
    // よく使われている型・武器（使われた数だけ）
    if (v[14]) out.style[v[14]] = (out.style[v[14]] || 0) + 1;
    if (v[15]) out.weapon[v[15]] = (out.weapon[v[15]] || 0) + 1;
    // 深度ごと・人数ごとの出撃回数
    const dk = v[6] === 'deep' ? 'deep' + (v[7] || '') : 'normal';
    out.depth[dk] = (out.depth[dk] || 0) + 1;
    if (v[8]) out.party[v[8]] = (out.party[v[8]] || 0) + 1;
    // 夜渡りごとの深度・武器・型（「みんなの統計」の夜渡りの切り替え用）
    inc(out.charDepth, v[9], dk);
    if (v[15]) inc(out.charWeapon, v[9], v[15]);
    if (v[14]) inc(out.charStyle, v[9], v[14]);
    // 日付ごと（直近14日。「今日の出撃数」用）
    const date = v[3] instanceof Date ? Utilities.formatDate(v[3], 'Asia/Tokyo', 'yyyy-MM-dd') : String(v[3]).slice(0, 10);
    if (date >= since) add(out.byDate, date, win);
    // 分析用
    if (v[14]) add(out.styleW, v[14], win);
    if (v[15]) add(out.weaponW, v[15], win);
    add(out.depthW, dk, win);
    if (v[8]) add(out.partyW, v[8], win);
    if (!win) { const la = v[11] || 'unknown'; out.loss[la] = (out.loss[la] || 0) + 1; inc(out.lordLoss, lord, la); }
    add2(out.lordDepth, lord, dk, win);
    add2(out.charDepthW, v[9], dk, win);
    if (v[15]) add2(out.charWeaponW, v[9], v[15], win);
    if (v[8]) { add2(out.charParty, v[9], v[8], win); add2(out.lordParty, lord, v[8], win); }
    if (day >= trendSince) add(out.trend, day, win);
  });
  out.players = Object.keys(players).length;
  const text = JSON.stringify(out);
  cache.put(cacheKey, text, 180);  // 3分ごとに数え直す
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

// 受信箱：機能リクエストと誤りの報告を読み出す（持ち主の毎朝の確認用）。
// 合言葉（key）が「プロジェクトの設定 → スクリプト プロパティ」の INBOX_KEY と同じときだけ返す。合言葉はこのファイルに書かない（GitHubで誰でも見られるため）。
// since（ミリ秒）より後に届いたものだけ。端末の番号は返さない
function inbox_(prm) {
  const key = PropertiesService.getScriptProperties().getProperty('INBOX_KEY');
  if (!key || String(prm.key || '') !== key) return json_({ ok: false, error: 'forbidden' });
  const since = Number(prm.since) || 0;
  const t = v => (v instanceof Date ? v.getTime() : Date.parse(v) || 0);
  const rows = (name, cols) => { const sh = sheet_(name, cols); const n = sh.getLastRow() - 1; return n > 0 ? sh.getRange(2, 1, n, cols.length).getValues() : []; };
  const iso = v => new Date(t(v)).toISOString();
  const requests = rows('requests', REQUEST_COLS).filter(v => t(v[0]) > since).slice(-200).map(v => ({ at: iso(v[0]), text: String(v[2]), appVersion: String(v[3] || '') }));
  const reports = rows('reports', REPORT_COLS).filter(v => t(v[0]) > since).slice(-200).map(v => ({ at: iso(v[0]), enemy: String(v[2]), text: String(v[3]), appVersion: String(v[4] || '') }));
  return json_({ ok: true, now: Date.now(), requests: requests, reports: reports });
}

// みんなに公開されたビルド（新しい順に最大300件。2分ごとに読み直す）
function builds_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('builds');
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const sh = sheet_('builds', BUILD_COLS);
  const values = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, BUILD_COLS.length).getDisplayValues() : [];
  // リアクションの数（前の「いいね」(1) は like に入れる。「よくないね」(-1) はもう数えない）。古いアプリのために likes・dislikes も残す
  const vs = sheet_('votes', VOTE_COLS);
  const votes = vs.getLastRow() > 1 ? vs.getRange(2, 1, vs.getLastRow() - 1, 3).getDisplayValues() : [];
  const tally = {};
  votes.forEach(v => { const t = tally[v[1]] || (tally[v[1]] = { likes: 0, dislikes: 0, reactions: {} });
    const r = v[2] === '1' ? 'like' : v[2].indexOf('r:') === 0 ? v[2].slice(2) : '';
    if (v[2] === '-1') t.dislikes++;
    if (r && REACTIONS.indexOf(r) >= 0) { t.reactions[r] = (t.reactions[r] || 0) + 1; if (r === 'like') t.likes++; } });
  const rs = sheet_('build_reports', BREPORT_COLS);
  const reps = {};
  (rs.getLastRow() > 1 ? rs.getRange(2, 2, rs.getLastRow() - 1, 1).getDisplayValues() : []).forEach(v => { reps[v[0]] = (reps[v[0]] || 0) + 1; });
  const list = values.filter(v => v[0] && !ngHit_(v[4]) && (reps[v[1]] || 0) < HIDE_REPORTS).map(v => ({ presetId: v[1], updatedAt: v[2], charId: v[3], name: v[4], data: v[5], ...(tally[v[1]] || { likes: 0, dislikes: 0, reactions: {} }) }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 300);
  const text = JSON.stringify({ ok: true, builds: list });
  try { cache.put('builds', text, 120); } catch (err) { /* 大きすぎるときは作り置きしない */ }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
