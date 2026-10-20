# Designer Skills

[English](README.md) | [한국어](README.ko.md) | **日本語** | [中文](README.zh-CN.md)

デザイナーのマルチモーダル制作手順を、インストールして使えるエージェントスキルにまとめました。

参考資料やブリーフから、編集を続けられる成果物を作ります。Blenderシーン、After Effectsプロジェクト、インタラクティブな試作、納品フォルダーまで、各スキルに成果物、編集箇所、実際の結果を確認する手順を定義しています。

**プレビュー · 0.2.0-alpha.1** — 最初の構成は4つです。付属ツールと手順の検証範囲は異なります。[検証記録](docs/validation.md)をご覧ください。

![付属のBlenderテンプレートで生成した製品シーン](docs/images/blender-product.png)

## ワークフローを選ぶ

| スキル | 依頼する作業 | 追加するもの | 必要な環境 |
|---|---|---|---|
| [blender-production](skills/blender-production/SKILL.md) | 製品レンダーと編集可能な`.blend` | デバイスのひな型、生成スクリプト、別プロセスでの再読込検査 | Blender、CPUまたは対応GPU |
| [after-effects-production](skills/after-effects-production/SKILL.md) | 編集を続けられるモーショングラフィックス | ネイティブレイヤー、コンポジション構造、プレビューと編集ガイド | After Effectsとスクリプト／ブリッジ環境 |
| [reference-to-web-toy](skills/reference-to-web-toy/SKILL.md) | 参考資料から動くインタラクションを再現 | 動き・操作の一覧、ブラウザー比較、成果物検査 | ブラウザー自動化、検査用Python |
| [asset-delivery](skills/asset-delivery/SKILL.md) | 納品フォルダー・ZIPの不足確認 | ファイル数、SHA-256、アーカイブ検査、基準版との比較 | Python 3.12+ |

4つのスキルは個別にインストールできます。アプリとアカウントは別途必要です。リポジトリにはローカルMCPサーバーとオプションのAE CEP接続も含まれ、スキルとは別にインストール・登録します。

4つの小さな[制作ツール](docs/tools.md)をスキルフォルダーに同梱しています。[Designer Tools MCP](docs/mcp.md)はファイル検査、Blender生成・検査、オプションのAE接続を提供します。

## インストール

Node.js 22.20以上で[Skills CLI](https://github.com/vercel-labs/skills)を使います。作業プロジェクトで実行してください。

```bash
npx skills@latest add Bum-Boo/designer-skills
```

スキルとエージェントを選択します。1つだけ指定する場合:

```bash
npx skills@latest add Bum-Boo/designer-skills --skill blender-production -a codex
```

`codex`を`claude-code`、`hermes-agent`などに変更できます。ユーザー全体へのインストールは`-g`を追加します。同名の既存スキルを置き換える前に確認してください。Blender、Adobeアプリ、MCPサーバーはインストールされません。

手動の場合はリポジトリを取得し、選択した**スキルフォルダー全体**を`LICENSE`と一緒にエージェントのスキル保存先へコピーします。スクリプトと参照ファイルを一緒に保ってください。[インストール詳細](docs/installation.md)に保存先を記載しています。

## オプションのMCPサーバー

同じリポジトリからサーバーをインストールし、実行コマンドと作業プロジェクトのパスをエージェントに登録します。Node.js 22.20以上が必要で、PythonとBlenderは各ツールにのみ必要です。AEは同梱CEPパネルの別途設定が必要です。[インストール・設定例・制限](docs/mcp.md)。

```bash
git clone https://github.com/Bum-Boo/designer-skills.git
cd designer-skills
npm ci --ignore-scripts
```

## 使用例

依頼文にインストールしたスキル名を含めます。スラッシュやドル記号の呼び出し方はエージェントによって異なります。自動検出に対応する場合は通常の文章でも利用できます。

```text
blender-productionで付属例の編集可能な製品シーンを作ってください。
試験レンダー後、保存したシーンを開き直し、編集箇所も示してください。

after-effects-productionでこのタイトル映像を編集可能なAEPにしてください。
文言とタイミングを変えやすくし、プレビューと編集ガイドを付けてください。

reference-to-web-toyで参考資料に見える操作と動きを再現してください。
実際のブラウザー動作を参考資料と比較してください。

asset-deliveryで納品ZIPを承認済みフォルダーと比較してください。
元ファイルを変更せず、不足・追加・変更を報告してください。
```

## 収録方針

編集可能な成果物、実際の画面観察、検証できる納品を中心に改善した制作手順を収録します。現在は3D、モーション、インタラクション、納品が対象です。画像・動画生成や他のデザイナーツールは、依存関係と実際の出力を確認してから拡張します。

未変更のベンダースキルや汎用開発スキルは配布元を利用してください。インストール済みスキルすべての再配布ではありません。[範囲と次の候補](docs/scope.md)、[出典](docs/provenance.md)をご覧ください。

## パッケージ検査

```bash
python scripts/validate.py
python skills/asset-delivery/scripts/test_delivery_manifest.py
python skills/reference-to-web-toy/scripts/test_verify_static_artifact.py
```

Blenderの検査は、スキル記載のコマンドをBlenderで実行します。ファイル検査やテストだけで、見た目の品質や自動呼び出しは証明できません。[検証記録](docs/validation.md)に確認済みの範囲と制限を記載しています。

## ライセンス

[MIT](LICENSE)。付属の著作権表示を保持してください。アプリの契約、プラグイン、フォント、ユーザー提供素材には各自の利用条件が適用されます。日本語・中国語の文書はネイティブチェック前です。
