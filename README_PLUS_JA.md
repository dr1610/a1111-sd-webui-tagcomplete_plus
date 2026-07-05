# a1111-sd-webui-tagcomplete_plus

ReForge / Forge / AUTOMATIC1111 WebUI 向けのタグ補完拡張です。
`DominikDoom/a1111-sd-webui-tagcomplete` を土台に、ComfyUI-Autocomplete-Plus 風の関連タグパネルを追加しています。

## 使い方

1. このフォルダを WebUI の `extensions/a1111-sd-webui-tagcomplete_plus` に配置します。
2. WebUI を起動または再起動します。
3. プロンプト欄で調べたいタグ付近にカーソルを置き、`Alt+R` を押すと関連タグパネルが開きます。
4. 候補をクリックすると、元のタグの後ろに挿入され、その候補を起点に次の関連タグへ更新されます。
5. 関連タグパネルの `‹` / `›`、または `Alt+←` / `Alt+→` で連想検索の履歴を戻る/進むできます。

`Alt+R only` モードでは、クリックだけでは関連タグ検索を行いません。
プロンプト欄にカーソルがある時は、軽いヒントとして `Alt+Rで関連タグ検索` が表示されます。

## 関連タグデータ

関連タグは `tags` フォルダ内の次の CSV から読み込みます。

- `*cooccurrence*.csv`
- `*co-occurrence*.csv`
- `*related*.csv`

形式は次のようなシンプルな CSV です。

```csv
tag_a,tag_b,count
1girl,solo,1000
1girl,long_hair,920
```

`danbooru_tags_cooccurrence.csv` は GitHub の通常ファイル上限に近いサイズのため、リポジトリには `danbooru_tags_cooccurrence.csv.gz` として同梱しています。
初回起動時に `danbooru_tags_cooccurrence.csv` がない場合は、自動で展開します。

`danbooru_tags.csv` がない場合は、Hugging Face の `newtextdoc1111/danbooru-tag-csv` から自動取得します。

## 日本語ラベル

関連タグ候補には、日本語ラベルがある場合だけ2行目に小さく表示されます。
日本語ラベルがないタグは、英語タグと件数だけの1行表示になります。

同梱している翻訳データ:

- `tags/danbooru-jp.csv`: 手作業翻訳。品質優先。
- `tags/danbooru-machine-jp.csv`: 機械翻訳を含む補完版。カバー率優先。

Settings の `Tag Autocomplete Plus` で次を切り替えられます。

- `Show Japanese labels in related tag panel`
- `Use machine-translated Japanese labels when manual labels are missing`

Plus 版では、関連タグパネル、`Alt+R` 起動、日本語ラベル、機械翻訳補完はいずれも初期状態で有効です。

ユーザー補正を入れたい場合は、`tags/danbooru_ja_user.csv` を作成してください。
形式は次の通りです。

```csv
tag,日本語ラベル
arms_up,腕を上げる
interlocked_fingers,指を絡める
```

読み込み優先順位は `danbooru_ja_user.csv`、`danbooru-jp.csv`、`danbooru-machine-jp.csv` の順です。

## 設定

WebUI の Settings に `Tag Autocomplete Plus` セクションが追加されます。

- `Enable related tag panel`
- `Maximum related tags`
- `Related tag trigger mode`
- `Maximum cached relations per tag`
- `Show Japanese labels in related tag panel`
- `Use machine-translated Japanese labels when manual labels are missing`
- `Download Danbooru CSV automatically when missing`
- `Download/update Danbooru CSV`

## メモ

完全な高速検索インデックスではなく、まず ReForge で自然に使える関連タグ補助を目的にした Plus 版です。
完全一致の共起データがないタグでは、`arms_up` や `bare_arms` のような部分一致候補にフォールバックします。
