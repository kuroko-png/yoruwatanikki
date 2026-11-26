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
 *  - みんなのビルドへの定型文コメント（comments：決まった文の型と言葉の番号だけ。1人が1つのビルドに1つ・送り直すと置き換え・1端末1日20件まで）
 *  - 管理人による非公開（build_bans：A列に presetId を書くと、そのビルドは一覧から消え、公開し直しもできない）
 *  - 管理人によるネタ指定（build_admin：presetId と neta＝yes/no。作った人が公開し直しても、この指定が勝つ）
 *  - 管理人の操作（type=admin）：アプリの管理人モードから、ネタ指定・非公開・削除をする。
 *    合言葉は「スクリプト プロパティ」に ADMIN_KEY という名前で入れる（INBOX_KEY とは別にする）。未設定なら誰も操作できない
 *  - みんなのビルドの通報（build_reports：3つ以上の端末から通報されたビルドは、自動で一覧から外す。行を消せば戻る）
 *  - 壺渡りのランキング（kotsubo2：参加した端末の「Ver.1.2.4 から後に稼いだマーク」だけ。前の kotsubo シートは v59 の不具合の分が入っているので使わない。名前は受け取らない。一覧には端末の番号から作った別の番号 rid だけを出す）
 *    一覧は、参加して数字を送ってきた端末への返事にだけ付ける（参加していない人は見られない。読み出すだけの口は作らない）
 *    不正対策：① 前回から急に増えすぎた数字（1時間あたり1000倍＋余裕100倍を超える。前回が0のときは比べない）は受け付けない ② たどり着いた深度でありえない大きさの数字は受け付けない（はじいた理由は why で返す：fast＝①・big＝②）
 *    ③ 管理人の操作（rank_del＝消す／rank_ban＝消して、その端末はもう載せない。kotsubo_bans に rid が入る）。受け付けなかった回数は flags に数える
 *    depth＝今いる深度（0＝1周目）。maxDepth＝たどり着いた一番深い深度
 *  - 期間ごとのランキング（kotsubo_＋開催の日付：season が SEASON_ID のときは、その期間に稼いだマークをこの表で比べる。期間が終わったら数字を止める）
 *  - 連打王（renda_＋開催の日付：期間中に小壺を叩いた回数。ランキングの送信に一緒に付いてくる）。1秒に30回＋余裕300回を超える増え方は受け付けない
 * 不正対策：1つの端末が同じ日に30戦を超えて送ってきた日の戦績は、集計に入れない（人が遊べる数を超えるため）
 * 受信箱（type=inbox）：機能リクエストと誤りの報告を、合言葉つきで読み出す（持ち主の毎朝の確認用）。
 *   合言葉は「プロジェクトの設定（歯車）→ スクリプト プロパティ」に INBOX_KEY という名前で入れる。合言葉が未設定なら誰にも返さない
 * シートは自動で作られる（runs＝戦績、reports＝誤植の報告、backups＝自動バックアップ）。runs・reports の行は消してよい。
 * backups の行を消すと、その人は引き継ぎコードで戻せなくなるので消さないこと。
 */

const RUN_COLS = ['receivedAt', 'clientId', 'runId', 'date', 'lordId', 'everdark', 'mode', 'depth', 'party', 'charId', 'result', 'lossAt', 'deleted', 'updatedAt', 'style', 'weaponType', 'lossBy'];  // lossBy＝1日目・2日目に倒された夜の強敵の名前
const REPORT_COLS = ['receivedAt', 'clientId', 'enemy', 'text', 'appVersion'];
const MAX_RUNS_PER_POST = 500;
const BUILD_COLS = ['key', 'presetId', 'updatedAt', 'charId', 'name', 'data'];
const REQUEST_COLS = ['receivedAt', 'clientId', 'text', 'appVersion'];
const VOTE_COLS = ['key', 'presetId', 'value', 'updatedAt'];
const BREPORT_COLS = ['key', 'presetId', 'reason', 'at'];
// 管理人が非公開にしたビルド（build_bans）。A列に presetId（builds シートのB列）を入れると、一覧から消え、同じビルドは公開し直せなくなる。行を消せば元に戻る
const BAN_COLS = ['presetId', 'memo', 'at'];
// 管理人のネタ指定（build_admin）。neta が yes ならネタ、no ならネタではない、として一覧に出す
const ADMIN_COLS = ['presetId', 'neta', 'at'];
const adminNeta_ = () => { const sh = sheet_('build_admin', ADMIN_COLS); const n = sh.getLastRow() - 1; const m = {}; (n > 0 ? sh.getRange(2, 1, n, 2).getDisplayValues() : []).forEach(v => { if (v[0] && (v[1] === 'yes' || v[1] === 'no')) m[String(v[0]).trim()] = v[1] === 'yes'; }); return m; };
const banned_ = () => { const sh = sheet_('build_bans', BAN_COLS); const n = sh.getLastRow() - 1; const set = {}; (n > 0 ? sh.getRange(2, 1, n, 1).getDisplayValues() : []).forEach(v => { if (v[0]) set[String(v[0]).trim()] = 1; }); return set; };
const MAX_RUNS_PER_DAY = 30, MAX_VOTES_PER_DAY = 20, HIDE_REPORTS = 3;
// 壺渡りのランキング
const KOTSUBO_COLS = ['clientId', 'rid', 'total', 'maxDepth', 'updatedAt', 'firstAt', 'flags', 'depth', 'loops'];  // loops＝深度5を抜けて深度1へ戻った回数（周回の印★）
const KSHEET = 'kotsubo2';  // Ver.1.2.4 から数え直した表（前の kotsubo は使わない）
const KBAN_COLS = ['rid', 'memo', 'at'];
// たどり着いた深度（0〜5）ごとの「これまでのマーク」の上限（10の何乗か）。高難易度の最後の夜の王の体力のおよそ1億倍（遊び続けても届かない大きさ）
// v62：数字が伸びきった人がはじかれたとのおたよりで、どの深度も10万倍ゆるくした
const KOTSUBO_CAP_LOG10 = [25, 29, 33, 38, 44, 51];
const KOTSUBO_FLOOR = 1e9, KOTSUBO_SLACK_LOG10 = 2, KOTSUBO_RATE_LOG10_PER_H = 3;  // この数までは自由。それより上は「前回×100×（1時間ごとに1000倍）」まで
// 連打王（期間限定）：開催ごとに RENDA_ID と期間を変える（表も別になる）
const RENDA_ID = '2026-11-26', RENDA_START = new Date('2026-11-26T12:00:00+09:00').getTime(), RENDA_END = new Date('2026-12-03T11:59:00+09:00').getTime();
const RENDA_SHEET = 'renda_' + RENDA_ID.replace(/-/g, ''), RENDA_COLS = ['clientId', 'rid', 'taps', 'updatedAt', 'flags'];
const RENDA_MAX_PER_SEC = 30, RENDA_SLACK = 300, RENDA_SHOW_MS = 7 * 86400e3;
// マークのランキングも同じ期間で比べる（開催ごとに表が別になる）
const SEASON_ID = RENDA_ID, SEASON_END = RENDA_END, SEASON_SHEET = 'kotsubo_' + SEASON_ID.replace(/-/g, '');
const KOTSUBO_TOP = 10;  // 上位10人だけ返す。参加している人数は返さない（分母は見せない）
const ridOf_ = clientId => Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'kotsubo:' + clientId).slice(0, 6).map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
const kbanned_ = () => { const sh = sheet_('kotsubo_bans', KBAN_COLS); const n = sh.getLastRow() - 1; const set = {}; (n > 0 ? sh.getRange(2, 1, n, 1).getDisplayValues() : []).forEach(v => { if (v[0]) set[String(v[0]).trim()] = 1; }); return set; };
// みんなのビルドのリアクションの種類（アプリの REACTIONS と同じ順・同じ名前）。前の「いいね」は like として数える
const REACTIONS = ['like', 'lol', 'strong', 'tips', 'wow'];
// 定型文コメント（comments：1人が1つのビルドに1つ。送り直すと置き換え）。文の型と言葉はアプリ側の src/data/comments.js の「何番目か」だけを受け取る
// （自由な文章は受け付けない）。番号の上限は余裕をもたせてあるので、アプリ側で言葉を足しても、ここは直さなくてよい
// c・t2・w2 は2つ目の文（c＝つなぐ言葉の番号。-1 なら1文だけ）
const COMMENT_COLS = ['key', 'presetId', 't', 'w', 'at', 'c', 't2', 'w2'];
const MAX_COMMENT_C = 50;
const MAX_COMMENT_T = 100, MAX_COMMENT_W = 1000, MAX_COMMENTS_PER_DAY = 20;

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
        str_(r.mode, 10), Number(r.depth) || '', str_(r.party, 10), str_(r.charId, 20), r.result === 'win' ? 'win' : 'loss', str_(r.lossAt, 10), !!r.deleted, Number(r.updatedAt) || 0, str_(r.style, 20), str_(r.weaponType, 20), ngHit_(str_(r.lossBy, 40)) ? '' : str_(r.lossBy, 40)]);
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
    // 管理人の操作：合言葉（ADMIN_KEY）が合うときだけ。op＝check（合言葉の確認）／neta（value：yes・no・空で指定を外す）／ban（非公開）／del（削除）
    if (body.type === 'admin') {
      const ak = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
      if (!ak || String(body.key || '') !== ak) return json_({ ok: false, error: 'forbidden' });
      if (body.op === 'check') return json_({ ok: true });
      const id = str_(body.id, 60);
      if (!id) return json_({ ok: false, error: 'no id' });
      const findRow = (sh, col) => sh.getRange(col + ':' + col).createTextFinder(id).matchEntireCell(true).findNext();
      if (body.op === 'neta') {
        const sh = sheet_('build_admin', ADMIN_COLS), hit = findRow(sh, 'A'), v = body.value === 'yes' || body.value === 'no' ? body.value : '';
        if (!v) { if (hit) sh.deleteRow(hit.getRow()); }
        else { const row = [id, v, now.toISOString()]; sh.getRange(hit ? hit.getRow() : sh.getLastRow() + 1, 1, 1, 3).setNumberFormat('@').setValues([row]); }
      } else if (body.op === 'ban') {
        const sh = sheet_('build_bans', BAN_COLS); if (!findRow(sh, 'A')) sh.appendRow([id, 'アプリの管理人モードから', now.toISOString()]);
      } else if (body.op === 'del') {
        const sh = sheet_('builds', BUILD_COLS); let hit; while ((hit = findRow(sh, 'B'))) sh.deleteRow(hit.getRow());
      } else if (body.op === 'rank_del' || body.op === 'rank_ban') {
        // 壺渡りのランキング：id は rid。消す（rank_ban は、その端末をもう載せない）
        const sh = sheet_(KSHEET, KOTSUBO_COLS); let hit; while ((hit = findRow(sh, 'B'))) sh.deleteRow(hit.getRow());
        const ss2 = sheet_(SEASON_SHEET, KOTSUBO_COLS); while ((hit = findRow(ss2, 'B'))) ss2.deleteRow(hit.getRow());
        CacheService.getScriptCache().remove('kotsubo_rank_' + SEASON_ID);
        const rs = sheet_(RENDA_SHEET, RENDA_COLS); while ((hit = findRow(rs, 'B'))) rs.deleteRow(hit.getRow());
        CacheService.getScriptCache().remove('renda_rank_' + RENDA_ID);
        if (body.op === 'rank_ban') { const bs = sheet_('kotsubo_bans', KBAN_COLS); if (!findRow(bs, 'A')) bs.appendRow([id, 'アプリの管理人モードから', now.toISOString()]); }
        CacheService.getScriptCache().remove('kotsubo_rank2');
        return json_({ ok: true });
      } else return json_({ ok: false, error: 'bad op' });
      CacheService.getScriptCache().remove('builds');
      return json_({ ok: true });
    }
    // 壺渡りのランキング：これまでのマーク（total）と、たどり着いた深度（maxDepth）を受け取る。返すのは順位と人数と自分の rid
    // 前の版のアプリ（これまでのマーク全部を送ってくる）は受け付けない
    if (body.type === 'kotsubo' || body.type === 'kotsubo_leave') return json_({ ok: false, error: 'old' });
    if (body.type === 'kotsubo2' || body.type === 'kotsubo2_leave') {
      const season = body.season === SEASON_ID, sheetName = season ? SEASON_SHEET : KSHEET;
      const sh = sheet_(sheetName, KOTSUBO_COLS), rid = ridOf_(clientId);
      const hit = sh.getRange('A:A').createTextFinder(clientId).matchEntireCell(true).findNext();
      if (body.type === 'kotsubo2_leave') {
        [KSHEET, SEASON_SHEET].forEach(n => { const s2 = sheet_(n, KOTSUBO_COLS), h2 = s2.getRange('A:A').createTextFinder(clientId).matchEntireCell(true).findNext(); if (h2) s2.deleteRow(h2.getRow()); });
        const rs = sheet_(RENDA_SHEET, RENDA_COLS), rh = rs.getRange('A:A').createTextFinder(clientId).matchEntireCell(true).findNext(); if (rh) rs.deleteRow(rh.getRow());
        CacheService.getScriptCache().removeAll(['kotsubo_rank2', 'kotsubo_rank_' + SEASON_ID, 'renda_rank_' + RENDA_ID]); return json_({ ok: true });
      }
      if (kbanned_()[rid]) { if (hit) sh.deleteRow(hit.getRow()); return json_({ ok: false, error: 'banned' }); }
      const total = Math.floor(Number(body.total)), maxDepth = Math.floor(Number(body.maxDepth)), depth = Math.min(5, Math.max(0, Math.floor(Number(body.depth)) || 0));
      const loops = maxDepth >= 5 ? Math.min(99, Math.max(0, Math.floor(Number(body.loops)) || 0)) : 0;
      if (!isFinite(total) || total < 0 || !(maxDepth >= 0 && maxDepth <= 5)) return json_({ ok: false, error: 'bad data' });
      const prev = hit ? sh.getRange(hit.getRow(), 1, 1, KOTSUBO_COLS.length).getValues()[0] : null;
      const prevTotal = prev ? Number(prev[2]) || 0 : 0, prevAt = prev ? Date.parse(prev[4]) || now.getTime() : now.getTime();
      const hours = Math.max(0, (now.getTime() - prevAt) / 3600e3);
      const lg = x => Math.log10(Math.max(1, x));
      // ① 急に増えすぎていないか（前回の記録があるときだけ）② 深度にくらべて大きすぎないか
      // 前回の記録が0（はじかれた行だけある）ときは、①では比べない
      const tooFast = prev && prevTotal > 0 && total > Math.max(prevTotal, KOTSUBO_FLOOR) && lg(total) > lg(Math.max(prevTotal, KOTSUBO_FLOOR)) + KOTSUBO_SLACK_LOG10 + KOTSUBO_RATE_LOG10_PER_H * hours;
      const tooBig = lg(total) > KOTSUBO_CAP_LOG10[maxDepth];
      let accepted = true;
      const frozen = season && now.getTime() >= SEASON_END;  // 期間が終わったら、数字はそのまま（順位と一覧だけ返す）
      if (frozen) { /* 書き込まない */ }
      else if (tooFast || tooBig) {
        accepted = false;
        if (hit) sh.getRange(hit.getRow(), 7).setValue((Number(prev[6]) || 0) + 1);
        else sh.getRange(sh.getLastRow() + 1, 1, 1, KOTSUBO_COLS.length).setNumberFormat('@').setValues([[clientId, rid, '0', String(maxDepth), now.toISOString(), now.toISOString(), '1', String(depth), String(loops)]]);
      } else {
        const row = [clientId, rid, String(total), String(maxDepth), now.toISOString(), prev ? String(prev[5]) : now.toISOString(), prev ? String(prev[6] || 0) : '0', String(depth), String(loops)];
        sh.getRange(hit ? hit.getRow() : sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
      }
      // 自分の順位（受け付けなかったときは、前の記録で数える）。人数は返さない
      const mine = accepted && !frozen ? total : prevTotal, bans = kbanned_();
      const all = sh.getLastRow() > 1 ? sh.getRange(2, 2, sh.getLastRow() - 1, 2).getValues().filter(v => v[0] && !bans[v[0]] && Number(v[1]) > 0) : [];
      const rank = mine > 0 ? all.filter(v => Number(v[1]) > mine).length + 1 : 0;
      // 上位の一覧は、ここ（参加して数字を送ってきた端末への返事）でだけ返す。参加していない人は見られない
      // 連打王：期間の始まりから、終わって1週間までは、叩いた回数も受け取って順位と上位を返す
      const renda = body.rendaId === RENDA_ID && now.getTime() >= RENDA_START && now.getTime() < RENDA_END + RENDA_SHOW_MS ? renda_(clientId, rid, body.renda, now, bans) : undefined;
      return json_({ ok: true, accepted: accepted, why: accepted ? undefined : tooBig ? 'big' : 'fast', rank: rank, rid: rid, top: kotsuboTop_(sheetName, season ? 'kotsubo_rank_' + SEASON_ID : 'kotsubo_rank2'), renda: renda });
    }
    if (body.type === 'build_put' || body.type === 'build_del') {
      const presetId = str_(body.id, 60);
      if (!presetId) return json_({ ok: false, error: 'no id' });
      const key = clientId + '/' + presetId;
      const sh = sheet_('builds', BUILD_COLS);
      const hit = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
      if (body.type === 'build_del') { if (hit) sh.deleteRow(hit.getRow()); CacheService.getScriptCache().remove('builds'); return json_({ ok: true }); }
      if (banned_()[presetId]) { if (hit) sh.deleteRow(hit.getRow()); CacheService.getScriptCache().remove('builds'); return json_({ ok: false, error: 'banned' }); }
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
    // 定型文コメント：t＝文の型の番号、w＝言葉の番号。t が -1 なら取り消し
    if (body.type === 'comment') {
      const presetId = str_(body.id, 60), t = Number(body.t), w = Number(body.w);
      const c = body.c === undefined ? -1 : Number(body.c), t2 = Number(body.t2), w2 = Number(body.w2);
      const del = t === -1;
      const okT = x => Number.isInteger(x) && x >= 0 && x < MAX_COMMENT_T, okW = x => Number.isInteger(x) && x >= 0 && x < MAX_COMMENT_W;
      const two = Number.isInteger(c) && c >= 0;
      if (!presetId || (!del && !(okT(t) && okW(w) && (c === -1 || (two && c < MAX_COMMENT_C && okT(t2) && okW(w2)))))) return json_({ ok: false, error: 'bad comment' });
      const key = clientId + '/' + presetId;
      const sh = sheet_('comments', COMMENT_COLS);
      const hit = sh.getRange('A:A').createTextFinder(key).matchEntireCell(true).findNext();
      if (del) { if (hit) sh.deleteRow(hit.getRow()); }
      else {
        const today = now.toISOString().slice(0, 10);
        const mine = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 5).getDisplayValues().filter(v => v[0].startsWith(clientId + '/') && v[4].startsWith(today)).length : 0;
        if (!hit && mine >= MAX_COMMENTS_PER_DAY) return json_({ ok: false, error: 'limit' });
        sh.getRange(hit ? hit.getRow() : sh.getLastRow() + 1, 1, 1, 8).setNumberFormat('@').setValues([[key, presetId, String(t), String(w), now.toISOString(), String(two ? c : -1), two ? String(t2) : '', two ? String(w2) : '']]);
      }
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
  // 夜の種類と深度で絞る（ランキング用）：mode＝deep（深き）／normal（浅き）／空（両方）。depth＝1〜5（深き夜のうち、その深度だけ。両方のときは浅き夜＋その深度の深き夜）
  const fMode = prm.mode === 'deep' || prm.mode === 'normal' ? prm.mode : '', fDepth = /^[1-5]$/.test(String(prm.depth || '')) ? Number(prm.depth) : 0;
  const cacheKey = 'stats' + (from || to ? ':' + from + ':' + to : '') + (fMode || fDepth ? '|' + fMode + ':' + fDepth : '');
  const cache = CacheService.getScriptCache();
  const hit = cache.get(cacheKey);
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const sh = sheet_('runs', RUN_COLS);
  const values = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, RUN_COLS.length).getValues() : [];
  // 同じ戦績が何度も送られてくるので、端末ID＋戦績IDごとに一番新しいものだけ数える
  const latest = {};
  values.forEach(v => { const k = v[1] + '/' + v[2]; if (!latest[k] || v[13] >= latest[k][13]) latest[k] = v; });
  const add = (map, key, win) => { const x = map[key] || (map[key] = { n: 0, w: 0 }); x.n++; if (win) x.w++; };
  const out = { ok: true, updatedAt: Date.now(), range: { from: from, to: to }, filter: { mode: fMode, depth: fDepth }, players: 0, total: { n: 0, w: 0 }, lord: {}, char: {}, lordChar: {}, style: {}, weapon: {}, depth: {}, party: {},
    byDate: {}, charDepth: {}, charWeapon: {}, charStyle: {},
    // 分析用（勝敗つき）：型・武器・深度・人数ごと、敗北した場所、夜の王／夜渡りごとの深度・人数・武器、日ごとの推移
    styleW: {}, weaponW: {}, depthW: {}, partyW: {}, loss: {}, lordLoss: {}, lordDepth: {}, charDepthW: {}, charWeaponW: {}, charParty: {}, lordParty: {}, trend: {}, lordCharM: {}, lossBy: { d1: {}, d2: {} }, foeChar: {}, foeStyle: {} };  // foeChar・foeStyle＝倒された夜の強敵ごとの、負けた夜渡り・型
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
    if (fMode && v[6] !== fMode) return;  // 夜の種類の外
    if (fDepth && fMode !== 'normal' && v[6] === 'deep' && Number(v[7]) !== fDepth) return;  // 深度の外（浅き夜は深度で絞らない）
    const win = v[10] === 'win', lord = v[4] + (v[5] === true || v[5] === 'TRUE' ? ':ever' : '');
    players[v[1]] = 1;
    add(out, 'total', win);
    add(out.lord, lord, win); add(out.char, v[9], win); add(out.lordChar, lord + '/' + v[9], win);
    add(out.lordCharM, lord + '/' + v[9] + '/' + (v[6] === 'deep' ? 'deep' : 'normal'), win);  // 相性の表の「深き／浅き」用
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
    if (!win) { const la = v[11] || 'unknown'; out.loss[la] = (out.loss[la] || 0) + 1; inc(out.lordLoss, lord, la);
      if ((la === 'd1' || la === 'd2') && v[16]) { inc(out.lossBy, la, String(v[16]));  // 倒された夜の強敵（記録した戦績だけ）
        inc(out.foeChar, String(v[16]), v[9]); if (v[14]) inc(out.foeStyle, String(v[16]), v[14]); } }
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

// 壺渡りのランキングの上位10人（rid と「これまでのマーク」だけ。3分ごとに数え直す）。参加した端末からの送信の返事にだけ付ける
function kotsuboTop_(sheetName, key) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const sh = sheet_(sheetName, KOTSUBO_COLS), bans = kbanned_();
  const all = sh.getLastRow() > 1 ? sh.getRange(2, 2, sh.getLastRow() - 1, 8).getValues().filter(v => v[0] && !bans[v[0]] && Number(v[1]) > 0) : [];
  const top = all.map(v => ({ rid: String(v[0]), total: Number(v[1]), loops: Number(v[7]) || 0 })).sort((a, b) => b.total - a.total).slice(0, KOTSUBO_TOP);
  cache.put(key, JSON.stringify(top), 180);
  return top;
}

// 連打王：叩いた回数を受け取る。前回からの増え方が、その間の時間（期間の中だけ）×1秒30回＋余裕300回を超えたら受け付けない。減ったときは前の回数のまま
function renda_(clientId, rid, v, now, bans) {
  const sh = sheet_(RENDA_SHEET, RENDA_COLS), taps = Math.floor(Number(v));
  const hit = sh.getRange('A:A').createTextFinder(clientId).matchEntireCell(true).findNext();
  const prev = hit ? sh.getRange(hit.getRow(), 1, 1, RENDA_COLS.length).getValues()[0] : null;
  const prevTaps = prev ? Number(prev[2]) || 0 : 0;
  let accepted = true, mine = prevTaps;
  if (isFinite(taps) && taps > prevTaps) {
    const to = Math.min(now.getTime(), RENDA_END), from = prev ? Math.max(RENDA_START, Date.parse(prev[3]) || RENDA_START) : RENDA_START;
    if (taps > prevTaps + RENDA_SLACK + RENDA_MAX_PER_SEC * Math.max(0, (to - from) / 1000)) {
      accepted = false;
      if (hit) sh.getRange(hit.getRow(), 5).setValue((Number(prev[4]) || 0) + 1);
    } else {
      mine = taps;
      const row = [clientId, rid, String(taps), now.toISOString(), prev ? String(prev[4] || 0) : '0'];
      sh.getRange(hit ? hit.getRow() : sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    }
  }
  const all = sh.getLastRow() > 1 ? sh.getRange(2, 2, sh.getLastRow() - 1, 2).getValues().filter(x => x[0] && !bans[x[0]] && Number(x[1]) > 0) : [];
  const rank = mine > 0 ? all.filter(x => Number(x[1]) > mine).length + 1 : 0;
  return { accepted: accepted, rank: rank, top: rendaTop_(bans) };
}
// 連打王の上位10人（1分ごとに数え直す）
function rendaTop_(bans) {
  const cache = CacheService.getScriptCache(), key = 'renda_rank_' + RENDA_ID, hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const sh = sheet_(RENDA_SHEET, RENDA_COLS);
  const all = sh.getLastRow() > 1 ? sh.getRange(2, 2, sh.getLastRow() - 1, 2).getValues().filter(x => x[0] && !bans[x[0]] && Number(x[1]) > 0) : [];
  const top = all.map(x => ({ rid: String(x[0]), taps: Number(x[1]) })).sort((a, b) => b.taps - a.taps).slice(0, KOTSUBO_TOP);
  cache.put(key, JSON.stringify(top), 60);
  return top;
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
  // 定型文コメントの数（同じ文はまとめて数える。多い順に12個まで）
  const cs = sheet_('comments', COMMENT_COLS);
  const cm = {};
  // 列：B=presetId, C=t, D=w, F=c, G=t2, H=w2（前の行は F〜H が空＝1文だけ）
  (cs.getLastRow() > 1 ? cs.getRange(2, 1, cs.getLastRow() - 1, 8).getDisplayValues() : []).forEach(v => { const m = cm[v[1]] || (cm[v[1]] = {});
    const c = v[5] === '' ? -1 : Number(v[5]); const k = [v[2], v[3], c, c >= 0 ? v[6] : -1, c >= 0 ? v[7] : -1].join('/'); m[k] = (m[k] || 0) + 1; });
  // 返す形：[t, w, 数, c, t2, w2]（c が -1 なら1文だけ）
  const commentsOf = id => Object.keys(cm[id] || {}).map(k => { const x = k.split('/').map(Number); return [x[0], x[1], cm[id][k], x[2], x[3], x[4]]; }).sort((a, b) => b[2] - a[2]).slice(0, 12);
  const rs = sheet_('build_reports', BREPORT_COLS);
  const reps = {};
  (rs.getLastRow() > 1 ? rs.getRange(2, 2, rs.getLastRow() - 1, 1).getDisplayValues() : []).forEach(v => { reps[v[0]] = (reps[v[0]] || 0) + 1; });
  const bans = banned_(), netaFix = adminNeta_();
  // 管理人のネタ指定があるビルドは、中身（data）の neta を書き換えて返す
  const fixNeta = (id, data) => { if (!(id in netaFix)) return data; try { const o = JSON.parse(data); o.neta = netaFix[id]; return JSON.stringify(o); } catch (err) { return data; } };
  const list = values.filter(v => v[0] && !ngHit_(v[4]) && (reps[v[1]] || 0) < HIDE_REPORTS && !bans[v[1]]).map(v => ({ presetId: v[1], updatedAt: v[2], charId: v[3], name: v[4], data: fixNeta(v[1], v[5]), adminNeta: v[1] in netaFix, ...(tally[v[1]] || { likes: 0, dislikes: 0, reactions: {} }), comments: commentsOf(v[1]) }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 300);
  const text = JSON.stringify({ ok: true, builds: list });
  try { cache.put('builds', text, 120); } catch (err) { /* 大きすぎるときは作り置きしない */ }
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
