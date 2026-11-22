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
const stamp = () => new Date().toISOString().slice(0, 10);

export function exportJson(data) {
  const text = JSON.stringify({ app: 'yowatari-nikki', version: VERSION, exportedAt: new Date().toISOString(), data }, null, 2);
  download(`夜渡日記_バックアップ_${stamp()}.json`, new Blob([text], { type: 'application/json' }));
}

// rows: 見出し行を含む2次元配列。Excelで文字化けしないよう BOM を付ける
export function exportCsv(rows) {
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
  download(`夜渡日記_戦績_${stamp()}.csv`, new Blob([text], { type: 'text/csv' }));
}

export function readJsonFile(file) {
  return file.text().then(t => {
    const j = JSON.parse(t);
    if (!j || (j.app !== 'yowatari-nikki' && !j.data && !j.runs)) throw new Error('夜渡日記のバックアップではありません');
    return normalize(j.data ?? j);
  });
}
