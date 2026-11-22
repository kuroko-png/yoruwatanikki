# 夜渡日記

ナイトレインの戦績をスマホで記録して、夜の王・夜渡り・ビルド・遺物効果ごとの勝率を振り返るアプリ（PWA）。

公開URL: https://kuroko-png.github.io/yoruwatanikki/
（スマホで開いて「ホーム画面に追加」すると、アプリのように使えます）

## 動かす（開発）

1. `start.bat` をダブルクリック（または、このフォルダで `python dev.py`）
2. 表示されたアドレスを開く
   - パソコン: `http://localhost:5173`
   - スマホ: `http://192.168.x.x:5173`（パソコンと同じWi-Fiにつなぐ）
3. ファイルを保存すると、開いている画面が自動で更新されます

初回にWindowsのファイアウォールの確認が出たら「プライベートネットワーク」を許可してください（スマホから見るため）。
必要なのは Python だけです。Node.js などのインストールは要りません。

## 表記を直す

画面に出る名前は `src/data/` のファイルにまとめてあります。メモ帳やVS Codeで開いて、名前の部分を書き換えて保存するだけです。

| ファイル | 中身 |
|---|---|
| `src/data/lords.js` | 夜の王 |
| `src/data/characters.js` | 夜渡り |
| `src/data/labels.js` | 型・メイン武器・モード・人数・倒れた場所・遺物の色/大きさの呼び方 |
| `src/data/effects.js` | 遺物効果（通常・深層・デメリット） |
| `src/data/vessels.js` | 献器と枠の色 |
| `src/data/relics.js` | 夜の王の遺物・固有遺物 |

注意
- `id` は記録とのつながりに使っているので変えないでください。
- `effects.js` と `relics.js` は行の順番で管理しています。行の並び替えや削除はせず、追加は末尾にしてください。
- データの出典は神攻略wiki（kamikouryaku.net）です。

## 記録の保存

記録は、使っている端末のブラウザの中に保存されます（サーバーには送りません）。
右上のボタン（データ管理）から、バックアップの保存・復元、CSVの書き出しができます。機種変更の前にはバックアップを保存してください。

## 公開する（GitHub Pages）

1. GitHub で新しいリポジトリを作る
2. このフォルダを push する（`main` ブランチ）
3. リポジトリの Settings → Pages → Source を「GitHub Actions」にする

以後は `main` に push するたびに自動で公開されます（`.github/workflows/pages.yml`）。
公開版で画面やデータを直したときは、`sw.js` の `VERSION` を1つ上げてください。利用者の端末で新しい版に入れ替わります。

## フォルダ構成

```
index.html            画面の土台
manifest.webmanifest  ホーム画面に追加したときの名前・アイコン
sw.js                 オフラインで開くための仕組み
icons/                アイコン（アプリ：tools/make_app_icons.py、夜の王・夜渡り：tools/make_unit_icons.py で Images/ の元画像から作り直せます）
src/css/style.css     見た目
src/app/app.js        画面と操作
src/app/store.js      保存・バックアップ・CSV
src/data/             表記・ゲームのデータ
dev.py, start.bat     開発用サーバー
```
