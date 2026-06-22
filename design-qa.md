# Design QA

- Source visual truth: `/home/tomop/.codex/generated_images/019ee031-f477-7fc0-91c9-a2edf36c6455/exec-b4b39b06-8a02-4f80-8d30-63acedcba1c7.png`
- Implementation screenshots:
  - `/tmp/disaster-game-main-threat.png`
  - `/tmp/disaster-game-open-rooms.png`
  - `/tmp/disaster-game-tips-modal.png`
- Viewport: 1487 x 1058 desktop
- States: 脅威カード選択後、空きルーム一覧、Tips詳細ダイアログ
- Full-view comparison evidence: `/tmp/disaster-game-room-list-visual-comparison.png`
- Focused region evidence: `/tmp/disaster-game-tips-modal.png` — 参照画像にない追加状態のため、ダイアログ単体で全Tipsの可読性・操作性を確認。

## Findings

- [P3] カードの災害イラストは、選択した参照画像の水彩風サムネイルではなく既存のPhosphorアイコンを使用している。
  - Location: メイン画面のカード群。
  - Evidence: 参照画像は各カードに固有のイラストを使用し、実装は一貫した線画アイコンを使用。
  - Impact: ゲームの視覚的な温度感は参照より簡素になるが、指令卓としての情報階層とカード識別は保たれている。
  - Fix: 必要ならカード種別ごとの正式なイラストアセットを用意して置き換える。

## Required Fidelity Surfaces

- Fonts and typography: 日本語UIの見出し・本文・小ラベルに十分な階層があり、ルーム一覧とTips本文で切れや重なりはない。
- Spacing and layout rhythm: メイン3列の指令卓レイアウトを維持。追加したロビーは同じ青・白・細罫線のリズムで、空き部屋はスクロール可能な一覧に収まる。
- Colors and visual tokens: 危機側のえんじ、政府側の青、Tipsの黄褐色を既存トークンに揃えた。モーダル背景のオーバーレイも十分なコントラストを確保。
- Image quality and asset fidelity: 既存のアイコンライブラリを使用。参照のカードイラストとの差は上記P3として記録。
- Copy and content: URL共有・ID入力の表現を除去し、「参加待ちの対戦」「あと1人」「参加」に統一。Tipsはプレビューと詳細表示の両方で読める。

## Interaction Checks

- 新規ルーム作成後、別ブラウザ文脈の空き部屋一覧に表示されることを確認。
- 一覧から参加すると政府ロールになり、該当ルームが一覧から除外されることを確認。
- URL入力欄が存在しないことを確認。
- 災害カードのTips詳細を開き、全文「家具の固定は必須です。転倒・落下・移動を防ぐ備えをしましょう。」が表示されることを確認。
- モーダルは閉じるボタンおよび背景クリックで閉じられる。

## Patches Made Since Previous QA Pass

- D1の待機ルーム一覧と、作成・参加・終了に追従するステータス更新を追加。
- ロビーをURL/ルームID入力から空き部屋一覧への参加導線に置換。
- Tipsパネルを要約表示にし、全件を確認できるモーダルを追加。

## Implementation Checklist

- [x] 空きルーム一覧から参加できる。
- [x] URL共有・ルームID入力を削除。
- [x] Tips全文をダイアログで確認できる。
- [x] デスクトップの既存指令卓レイアウトを維持。

## Follow-up Polish

- [P3] 参照に寄せる場合は、カード用の正式な防災イラストを追加する。

final result: passed
