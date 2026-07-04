# a1111-sd-webui-tagcomplete_plus

ReForge / Forge / AUTOMATIC1111 系 WebUI 向けのタグ補完拡張です。

この初版は `DominikDoom/a1111-sd-webui-tagcomplete` を土台に、ComfyUI-Autocomplete-Plus 風の関連タグパネルを追加しています。

## 使い方

1. このフォルダを WebUI の `extensions/a1111-sd-webui-tagcomplete_plus` に配置します。
2. WebUI を再起動します。
3. 通常のタグ補完は upstream 版と同じように使えます。
4. プロンプト欄でタグをクリック、または `Ctrl+Shift+Space` を押すと関連タグパネルが開きます。

## 関連タグ CSV

関連タグは `tags` フォルダ内の次の名前に合う CSV から読みます。

- `*cooccurrence*.csv`
- `*co-occurrence*.csv`
- `*related*.csv`

形式はシンプルです。

```csv
tag_a,tag_b,count
1girl,solo,1000
1girl,long_hair,920
```

`count` は大きいほど上に表示されます。ヘッダー行はあってもなくても構いません。

## Danbooru CSV の自動取得

`danbooru_tags_cooccurrence.csv` は GitHub の通常ファイル上限に近いサイズなので、リポジトリには `danbooru_tags_cooccurrence.csv.gz` として同梱しています。

初回起動時に `danbooru_tags_cooccurrence.csv` がない場合、同梱 gzip を自動展開します。

また、`danbooru_tags.csv` がない場合は Hugging Face の `newtextdoc1111/danbooru-tag-csv` から自動で取得します。

取得先:

```text
tags/danbooru_tags.csv
tags/danbooru_tags_cooccurrence.csv
```

関連タグの並び順は、共起数だけではなく `danbooru_tags.csv` のタグ出現数も使い、ComfyUI-Autocomplete-Plus と同じ考え方の Jaccard 類似度で並べます。

手動で再取得したい場合は、WebUI の Settings にある `Tag Autocomplete Plus` セクションで `Download/update Danbooru CSV` を押してください。

取得が終わる前に関連タグを開くと `No related tags` になることがあります。その場合は WebUI のコンソールで `Tag Autocomplete Plus: Danbooru CSV download finished.` が出てからもう一度試してください。

## 設定

WebUI の Settings に `Tag Autocomplete Plus` セクションが追加されます。

- `Enable related tag panel`
- `Maximum related tags`
- `Related tag trigger mode`
- `Maximum cached relations per tag`
- `Download Danbooru CSV automatically when missing`
- `Download/update Danbooru CSV`

## メモ

これは ReForge 向けに「まず動く fork 土台」を作る初期版です。ComfyUI-Autocomplete-Plus と同じ CSV データセットを利用しますが、高速検索インデックスは別実装です。
