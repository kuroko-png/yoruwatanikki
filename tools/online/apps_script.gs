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
 * シートは自動で作られる（runs＝戦績、reports＝誤植の報告、backups＝自動バックアップ）。runs・reports の行は消してよい。
 * backups の行を消すと、その人は引き継ぎコードで戻せなくなるので消さないこと。
 */

const RUN_COLS = ['receivedAt', 'clientId', 'runId', 'date', 'lordId', 'everdark', 'mode', 'depth', 'party', 'charId', 'result', 'lossAt', 'deleted', 'updatedAt', 'style', 'weaponType'];
const REPORT_COLS = ['receivedAt', 'clientId', 'enemy', 'text', 'appVersion'];
const MAX_RUNS_PER_POST = 500;
const BUILD_COLS = ['key', 'presetId', 'updatedAt', 'charId', 'name', 'data'];
const REQUEST_COLS = ['receivedAt', 'clientId', 'text', 'appVersion'];

// 不適切な言葉（アプリ側の src/data/ngwords.js と同じ考え方。ここでも念のため確かめる）
const NG_ANY = ['しね', 'ころす', 'ころせ', 'ぶっころ', 'きえろ', 'きちがい', 'がいじ', 'ちんこ', 'ちんぽ', 'まんこ', 'うんこ', 'せっくす', 'れいぷ', 'くそ',
  '死ね', '氏ね', '殺す', '殺せ', '殺害', '池沼', '基地外', '糞', 'fuck', 'shit', 'bitch', 'nigger', 'nigga', 'sex'];
const NG_KATA = ['カス', 'クズ', 'ゴミ', 'ブス', 'デブ', 'ハゲ', 'ガイジ'];
function ngHit_(text) {
  const t = String(text || '').normalize('NFKC').toLowerCase().replace(/[\s・、。,.!?！？ー〜~_\-]/g, '');
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
      if (ngHit_(name) || ngHit_(parsed.name) || ngHit_(parsed.weaponName)) return json_({ ok: false, error: 'ng' });
      const row = [key, presetId, now.toISOString(), str_(body.charId, 20), name, data];
      const r = hit ? hit.getRow() : sh.getLastRow() + 1;
      sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);
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

// みんなの勝率（10分ごとに数え直す）
function doGet(e) {
  const type = (e.parameter || {}).type;
  if (type === 'builds') return builds_();
  if (type !== 'stats') return json_({ ok: true, app: 'yoru-no-konseki' });
  const cache = CacheService.getScriptCache();
  const hit = cache.get('stats');
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const sh = sheet_('runs', RUN_COLS);
  const values = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, RUN_COLS.length).getValues() : [];
  // 同じ戦績が何度も送られてくるので、端末ID＋戦績IDごとに一番新しいものだけ数える
  const latest = {};
  values.forEach(v => { const k = v[1] + '/' + v[2]; if (!latest[k] || v[13] >= latest[k][13]) latest[k] = v; });
  const add = (map, key, win) => { const x = map[key] || (map[key] = { n: 0, w: 0 }); x.n++; if (win) x.w++; };
  const out = { ok: true, updatedAt: Date.now(), players: 0, total: { n: 0, w: 0 }, lord: {}, char: {}, lordChar: {}, style: {}, weapon: {}, depth: {}, party: {},
    byDate: {}, charDepth: {}, charWeapon: {}, charStyle: {} };
  const since = Utilities.formatDate(new Date(Date.now() - 14 * 864e5), 'Asia/Tokyo', 'yyyy-MM-dd');
  const inc = (map, a, b) => { const m = map[a] || (map[a] = {}); m[b] = (m[b] || 0) + 1; };
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
  });
  out.players = Object.keys(players).length;
  const text = JSON.stringify(out);
  cache.put('stats', text, 600);
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

// みんなに公開されたビルド（新しい順に最大300件。2分ごとに読み直す）
function builds_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('builds');
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const sh = sheet_('builds', BUILD_COLS);
  const values = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, BUILD_COLS.length).getDisplayValues() : [];
  const list = values.filter(v => v[0] && !ngHit_(v[4])).map(v => ({ presetId: v[1], updatedAt: v[2], charId: v[3], name: v[4], data: v[5] }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 300);
  const text = JSON.stringify({ ok: true, builds: list });
  try { cache.put('builds', text, 120); } catch (err) { /* 大きすぎるときは作り置きしない */ }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
