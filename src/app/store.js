// 記録の保存・書き出し
// データはこの端末のブラウザ（localStorage）に保存されます。
// 端末を変えるとき・ブラウザのデータを消すときは、先に「バックアップを保存」してください。

const KEY = 'yowatari-nikki';
const VERSION = 1;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return normalize(saved.data ?? saved);
  } catch (e) {
    console.warn('記録を読み込めませんでした', e);
    return null;
  }
}

let lastSaved = '';
export function save(data) {
  try {
    const text = JSON.stringify({ version: VERSION, savedAt: Date.now(), data });
    if (text === lastSaved) return;
    localStorage.setItem(KEY, text);
    lastSaved = text;
  } catch (e) {
    console.warn('記録を保存できませんでした', e);
  }
}

// ブラウザが容量不足のときに勝手に消さないようお願いする（対応ブラウザのみ）
navigator.storage?.persist?.().catch(() => {});

function normalize(d) {
  return { runs: Array.isArray(d.runs) ? d.runs : [], relics: Array.isArray(d.relics) ? d.relics : [], presets: Array.isArray(d.presets) ? d.presets : [], prefs: d.prefs && typeof d.prefs === 'object' ? d.prefs : {} };
}

function download(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const stamp = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isPhone = () => /iPhone|iPad|iPod|Android/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// スマホでは共有メニューを開く（「ファイル」アプリ・Googleドライブ・LINE などに保存できる）。
// パソコンや共有に対応していないブラウザでは、ふつうにダウンロードする。
// 戻り値：'shared' | 'downloaded' | 'cancelled'
async function saveFile(filename, blob, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (isPhone() && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; /* 共有できなければダウンロードに切り替える */ }
  }
  download(filename, blob);
  return 'downloaded';
}

export function exportJson(data) {
  const text = JSON.stringify({ app: 'yowatari-nikki', version: VERSION, exportedAt: new Date().toISOString(), data }, null, 2);
  return saveFile(`夜渡り日記_バックアップ_${stamp()}.json`, new Blob([text], { type: 'application/json' }), '夜渡り日記のバックアップ');
}

// rows: 見出し行を含む2次元配列。Excelで文字化けしないよう BOM を付ける
export function exportCsv(rows) {
  // メモやビルド名が「=」などで始まると、Excelが計算式として扱ってしまうので、先頭に ' を付けて文字のままにする
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
  return saveFile(`夜渡り日記_戦績_${stamp()}.csv`, new Blob([text], { type: 'text/csv' }), '夜渡り日記の戦績');
}

export function readJsonFile(file) {
  return file.text().then(t => {
    const j = JSON.parse(t);
    if (!j || (j.app !== 'yowatari-nikki' && !j.data && !j.runs)) throw new Error('夜渡り日記のバックアップではありません');
    return normalize(j.data ?? j);
  });
}
