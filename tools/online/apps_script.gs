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
 * シートは自動で作られる（runs＝戦績、reports＝誤植の報告）。消したい行は、シートから直接消してよい。
 */

const RUN_COLS = ['receivedAt', 'clientId', 'runId', 'date', 'lordId', 'everdark', 'mode', 'depth', 'party', 'charId', 'result', 'lossAt', 'deleted', 'updatedAt', 'style', 'weaponType'];
const REPORT_COLS = ['receivedAt', 'clientId', 'enemy', 'text', 'appVersion'];
const MAX_RUNS_PER_POST = 500;

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
    if (body.type === 'report') {
      const text = str_(body.text, 1000).trim();
      if (!text) return json_({ ok: false, error: 'empty' });
      sheet_('reports', REPORT_COLS).appendRow([now, clientId, str_(body.enemy, 100), text, str_(body.appVersion, 10)]);
      return json_({ ok: true });
    }
    return json_({ ok: false, error: 'unknown type' });
  } finally { lock.releaseLock(); }
}

// みんなの勝率（10分ごとに数え直す）
function doGet(e) {
  if ((e.parameter || {}).type !== 'stats') return json_({ ok: true, app: 'yoru-no-konseki' });
  const cache = CacheService.getScriptCache();
  const hit = cache.get('stats');
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const sh = sheet_('runs', RUN_COLS);
  const values = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, RUN_COLS.length).getValues() : [];
  // 同じ戦績が何度も送られてくるので、端末ID＋戦績IDごとに一番新しいものだけ数える
  const latest = {};
  values.forEach(v => { const k = v[1] + '/' + v[2]; if (!latest[k] || v[13] >= latest[k][13]) latest[k] = v; });
  const add = (map, key, win) => { const x = map[key] || (map[key] = { n: 0, w: 0 }); x.n++; if (win) x.w++; };
  const out = { ok: true, updatedAt: Date.now(), players: 0, total: { n: 0, w: 0 }, lord: {}, char: {}, lordChar: {}, style: {}, weapon: {} };
  const players = {};
  Object.keys(latest).forEach(k => {
    const v = latest[k];
    if (v[12] === true || v[12] === 'TRUE') return;  // 消された戦績
    const win = v[10] === 'win', lord = v[4] + (v[5] === true || v[5] === 'TRUE' ? ':ever' : '');
    players[v[1]] = 1;
    add(out, 'total', win);
    add(out.lord, lord, win); add(out.char, v[9], win); add(out.lordChar, lord + '/' + v[9], win);
    // よく使われている型・武器（使われた数だけ）
    if (v[14]) out.style[v[14]] = (out.style[v[14]] || 0) + 1;
    if (v[15]) out.weapon[v[15]] = (out.weapon[v[15]] || 0) + 1;
  });
  out.players = Object.keys(players).length;
  const text = JSON.stringify(out);
  cache.put('stats', text, 600);
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
