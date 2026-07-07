# 災害カードゲーム v1 実装計画

最終更新: 2026-07-07

この文書は [docs/gameDesign.md](./gameDesign.md) のゲームデザイン案を、現在のリポジトリに段階的に実装するための計画です。

対象リポジトリの現状は以下です。

- `packages/game-core`: ゲーム状態・カード効果・フェイズ進行の正本
- `apps/backend`: Hono + Cloudflare Worker + Durable Object。認証、保存、WebSocket同期、ルーム寿命管理を担当
- `apps/frontend`: Next.js UI。`MatchView` を表示し、プレイヤー操作をbackendへ送る

実装方針は、現在のオンライン対戦構成を維持しながら、ゲーム性を段階的に増やすことです。

---

## 1. 実装で守る前提

### GameCoreを正本にする

ゲームルールは `packages/game-core/src/index.ts` に集約します。

backendとfrontendには、以下を持たせません。

- 被害計算
- シールド処理
- 緊急対応トリガー判定
- 基盤ゾーンによる回復量計算
- レーンごとの軽減計算
- 勝敗判定

backendは、プレイヤートークンから役割を確定し、GameCoreへActionを渡し、結果を保存・配信するだけにします。

frontendは、サーバーから返された `MatchView` を表示し、ユーザーが選んだActionを送るだけにします。

### Durable Objectの役割は変えない

現在の「1対戦 = 1 Durable Object」の設計は維持します。

理由:

- ターン制ゲームの状態更新を1箇所に直列化できる
- WebSocket配信先を同じDO内で管理できる
- D1をゲーム状態の正本にしなくて済む
- 現在のTTL、退出、切断猶予の設計をそのまま使える

追加するゲーム状態は、DOのSQLiteテーブル構造ではなく、`game_state.payload` のJSONに入ります。したがって、D1やDO SQLiteのテーブル追加は原則不要です。

### 既存ルームとの互換性

`GameState.version` は現在 `1` です。新しい状態フィールドを追加するため、実装時は `version: 2` に上げます。

backendの `readState()` では、JSONを直接 `GameState` として扱わず、GameCore側の正規化関数を通します。

```ts
normalizeGameState(parsed)
```

この関数で、旧状態に足りないフィールドを補います。

プロトタイプなので、既存の古い対戦ルームについては完全な途中移行を狙いすぎない方がよいです。足りないフィールドは空配列・初期値で補い、新規作成ルームから新ルールが完全に適用される状態にします。

---

## 2. 全体の実装順序

実装は以下の順番で進めます。

| 段階 | 内容 | 主な目的 |
|---:|---|---|
| 0 | 現状固定とテスト整理 | 既存挙動を壊したか検出できる状態にする |
| 1 | 状態モデルv2の土台 | シールド、基盤、レーンを持てる型にする |
| 2 | 防災シールド | 最小変更でゲーム性を増やす |
| 3 | 緊急対応トリガー | シールド公開時の逆転要素を入れる |
| 4 | 基盤ゾーンと基盤化Action | 手札を使うか将来リソースにするかの判断を入れる |
| 5 | 現場レーン | 中央の場を3分類し、効果対象を明確にする |
| 6 | 継続脅威 / 防災ユニット | 場に残るカードで盤面差を作る |
| 7 | frontend UI拡張 | シールド、基盤、レーン、判定内訳を表示する |
| 8 | backend/API追従 | 新Actionと新Viewを安全に通す |
| 9 | バランス調整とQA | 1ゲームとして成立する値へ調整する |

最初に実装するべき実質機能は「防災シールド」です。

理由:

- 現在の `dark -> government -> resolution` 構造を大きく変えない
- カード追加なしでもゲームの駆け引きが増える
- UI追加も比較的小さい
- backendのAction種別を増やさずに始められる

---

## 3. 段階0: 現状固定とテスト整理

### 目的

新ルール実装前に、現状の最低限の挙動をテストで固定します。

### 対象ファイル

- `packages/game-core/src/index.test.ts`

### 作業

既存テストに加えて、以下を追加します。

- 闇の組織がカードを出すと `phase === "government"` になる
- 政府がカードを出すと `phase === "resolution"` になる
- `resolve` 後に勝者がいなければ次ターンへ進む
- 相手の手札が `toMatchView()` に含まれない
- コスト不足時にカードを出せない
- フェイズ違いの操作が拒否される

### 完了条件

```bash
pnpm test
```

が成功すること。

---

## 4. 段階1: 状態モデルv2の土台

### 目的

実際の効果実装に入る前に、GameCoreの型を拡張できる形にします。

### 対象ファイル

- `packages/game-core/src/index.ts`
- `packages/game-core/src/index.test.ts`
- `apps/backend/src/index.ts`
- `apps/frontend/src/components/disaster-game.tsx`

### 追加する型

```ts
export type Lane = "earthquake" | "flood" | "information"
export type CardPlayType =
  | "instant"
  | "ongoingThreat"
  | "defenseUnit"
```

カード定義には、最低限以下を追加します。

```ts
type CardDefinition = {
  // 既存フィールドは維持
  lane?: Lane | "general"
  playType?: CardPlayType
  emergencyTrigger?: {
    flatMitigation?: number
    damageMultiplier?: number
    countermeasure?: number
    draw?: number
    nextBudgetRecoveryBonus?: number
  }
}
```

`playType` は未指定なら `"instant"` として扱います。

### GameState v2

実装上は、基盤ゾーンを `PlayerState` に持たせる方が扱いやすいです。

`docs/gameDesign.md` では `resourceZones` をトップレベルに置く案を書いていますが、実装では以下を推奨します。

```ts
export type PlayerState = {
  resource: number
  deck: CardInstance[]
  hand: CardInstance[]
  discard: CardInstance[]
  foundation: CardInstance[]
  chargedThisTurn: boolean
}
```

理由:

- `PlayerView` へ自然に変換できる
- 自分の基盤枚数、相手の基盤枚数を同じ構造で扱える
- `startTurn()` で各プレイヤーを処理しやすい

シールドとレーンはトップレベルに置きます。

```ts
export type FieldCard = CardInstance & {
  lane: Lane
  ready: boolean
  exhausted: boolean
  owner: Faction
}

export type LaneState = {
  threats: FieldCard[]
  defenses: FieldCard[]
}

export type FieldState = {
  lanes: Record<Lane, LaneState>
}

export type GameState = {
  version: 2
  // 既存フィールド
  civicShields: CardInstance[]
  revealedShields: PublicCard[]
  field: FieldState
  nextGovernmentRecoveryBonus: number
}
```

### `normalizeGameState()` を追加する

旧JSONや不足フィールドに耐えるため、GameCoreに以下を追加します。

```ts
export const normalizeGameState = (value: unknown): GameState => {
  // parsed JSONを検査し、不足フィールドを補う
}
```

backendの `readState()` は以下のように変更します。

```ts
const parsed = JSON.parse(row.payload)
return normalizeGameState(parsed)
```

### MatchViewの追加フィールド

frontendがゲーム状態を描画できるように、`MatchView` に公開用フィールドを追加します。

```ts
type MatchView = {
  // 既存フィールド
  shieldCount: number
  revealedShields: PublicCard[]
  field: PublicFieldState
  canCharge: boolean
}
```

重要なのは、`civicShields` の中身をどちらのプレイヤーにも送らないことです。防災シールドは裏向きなので、政府側にも中身を送らない前提にします。

### 完了条件

- 新しい型を入れても既存ゲームが動く
- 旧 `GameState.version === 1` 相当のJSONを `normalizeGameState()` で読める
- `MatchView` に相手の手札・未公開シールドの中身が含まれない

---

## 5. 段階2: 防災シールド

### 目的

闇の組織の災害が、いきなり全て被害ゲージへ入らないようにします。

### ルール

ゲーム開始時:

- 政府デッキの上から5枚を `civicShields` に移動する
- その後、初期手札を引く

判定時:

```text
最終被害 > 0 かつ 防災シールドあり:
  防災シールドを1枚公開
  被害ゲージ += floor(最終被害 / 2)

最終被害 > 0 かつ 防災シールドなし:
  被害ゲージ += 最終被害
```

### 変更対象

- `createInitialGameState()`
- `resolve()`
- `lastResolution`
- `toMatchView()`
- `index.test.ts`

### `lastResolution` の拡張

判定の内訳をUIで説明できるようにします。

```ts
type LastResolution = {
  rawDamage: number
  persistentDamage: number
  mitigation: number
  triggerMitigation: number
  remainingDamageBeforeShield: number
  shieldAbsorbed: number
  damageToGauge: number
  countermeasureGain: number
  revealedShield?: PublicCard
  emergencyTriggered: boolean
}
```

既存の `remainingDamage` は曖昧になるので、UI側では `damageToGauge` を使うようにします。

### テスト例

- シールドありで威力15が通ると、被害ゲージは `floor(15 / 2) = 7`
- シールドが1枚減る
- 公開されたシールドは `revealedShields` に入る
- 未公開のシールド中身は `MatchView` に含まれない
- シールドなしなら威力15がそのまま被害ゲージへ入る

---

## 6. 段階3: 緊急対応トリガー

### 目的

防災シールドが公開されたとき、特定カードの効果を自動発動させます。

### ルール

`emergencyTrigger` を持つカードがシールドから公開された場合、自動発動します。

最初は選択式にしません。

理由:

- 割り込みフェイズが増える
- WebSocket同期が複雑になる
- タイムアウト処理が必要になる
- プロトタイプでは自動発動の方がテンポがよい

### 処理順

```text
1. 闇の組織カードと継続脅威で基本被害を計算
2. 政府カードと防災ユニットで通常軽減
3. remainingDamageBeforeShield を出す
4. remainingDamageBeforeShield > 0 ならシールドを1枚公開
5. 公開カードが emergencyTrigger を持っていれば自動発動
6. trigger適用後の被害に対して、シールドによる半減を行う
7. 被害ゲージと対策ゲージを更新
```

### カード定義の初期案

| カード | 通常効果 | シールド発動時 |
|---|---|---|
| 緊急避難指示 | 被害半減 / 対策+2 | 被害半減 |
| 備蓄キャンペーン | 対策+10 | 対策+5 |
| 防潮堤の強化 | 被害-10 / 対策+5 | 被害-5 |

既存カードだけで成立させるなら、まずは `evacuation` と `stockpile` にだけ `emergencyTrigger` を付けます。

### テスト例

- シールドから `緊急避難指示` が公開されると、被害が半減してからシールド半減される
- シールドから `備蓄キャンペーン` が公開されると、対策ゲージが追加で増える
- `activeTips` に公開シールドのTipsも追加される
- ログに「防災シールドから〇〇が発動」と出る

---

## 7. 段階4: 基盤ゾーンと基盤化Action

### 目的

手札を「今使うか、将来のリソース回復に回すか」の判断を作ります。

### ルール

- 各プレイヤーは自分のフェイズ中、手札から1枚まで基盤化できる
- 基盤化したカードは `foundation` に移動する
- 基盤化はフェイズを終了しない
- 同じターンに基盤化後、カードをプレイまたはパスできる
- 基盤化したカードは原則戻らない

回復量:

```text
回復量 = 2 + foundation.length
上限 = 10
```

政府側は既存の `nextGovernmentRecoveryPenalty` と合算します。

```text
政府回復量 = max(0, 2 + foundation.length - nextGovernmentRecoveryPenalty + nextGovernmentRecoveryBonus)
```

### GameActionの追加

```ts
export type GameAction =
  | { type: "charge"; faction: Faction; instanceId: string }
  | { type: "play"; faction: Faction; instanceId: string; lane?: Lane }
  | { type: "pass"; faction: Faction }
  | { type: "resolve" }
```

`charge` は自分のフェイズ中のみ許可します。

### backendの変更

`apps/backend/src/index.ts`

```ts
type ClientAction =
  | { type: "charge"; instanceId: string }
  | { type: "play"; instanceId: string; lane?: Lane }
  | { type: "pass" }
```

`toGameAction()` は、これまで通りクライアントの `faction` を信用せず、トークンから確定した `role` を使います。

### frontendの変更

`GameCard` に操作を2つ出します。

- プレイ
- 基盤化

ただし、カード内にボタンを増やしすぎると誤操作しやすいので、プロトタイプでは以下のどちらかにします。

案A:

- カードをクリック: プレイ
- 小さい「基盤化」ボタン: 基盤化

案B:

- カードクリックで詳細ポップオーバー
- ポップオーバー内に「プレイ」「基盤化」

PC優先なら案Bの方が安全ですが、実装速度優先なら案Aで十分です。

### テスト例

- 自分のフェイズ中に1枚だけ基盤化できる
- 基盤化後も同じフェイズでプレイできる
- 基盤化したカードは手札から消え、`foundation` に入る
- 次ターンの回復量が増える
- 相手のフェイズでは基盤化できない
- 同じターンに2枚基盤化できない

---

## 8. 段階5: 現場レーン

### 目的

中央の場を「地震・建物」「水害・気象」「情報・社会」に分け、カード効果の対象を分かりやすくします。

### レーン

```ts
type Lane = "earthquake" | "flood" | "information"
```

表示ラベル:

| 値 | 表示 |
|---|---|
| `earthquake` | 地震・建物 |
| `flood` | 水害・気象 |
| `information` | 情報・社会 |

### ルール

- 闇の組織カードは、カード定義の `lane` に配置される
- `lane: "general"` のカードは汎用扱い
- 政府カードは、汎用対策ならレーン不要
- レーン指定対策なら、対象レーンを送る
- 対象レーンが不正ならGameCoreで拒否する

### 最初の実装方針

いきなり場に残るカードまで入れると複雑になるため、まずは「このターンの pendingThreat / pendingResponse に lane を持たせる」だけにします。

```ts
type PlayedCard = {
  card: CardInstance
  lane?: Lane
}
```

既存の:

```ts
pendingThreat?: CardInstance
pendingResponse?: CardInstance
```

を以下に変更します。

```ts
pendingThreat?: PlayedCard
pendingResponse?: PlayedCard
```

### frontendの変更

中央に3レーンを表示します。

- 各レーンに現在の災害カード
- 各レーンに現在の対策カード
- 汎用カードは「共通対応」として表示

プレイ時にレーン選択が必要なカードだけ、レーン選択UIを出します。

### テスト例

- `ゲリラ豪雨` は `flood` レーンに出る
- `直下型地震` は `earthquake` レーンに出る
- `SNSデマ拡散` は `information` レーンに出る
- レーン指定対策が対象レーンにだけ効く
- 汎用対策はどの災害にも効く

---

## 9. 段階6: 継続脅威 / 防災ユニット

### 目的

場に残るカードを追加し、単発の出し合いから盤面管理のゲームへ寄せます。

### 追加カード種別

闇の組織:

- `ongoingThreat`: 継続脅威

政府:

- `defenseUnit`: 防災ユニット

### ルール

継続脅威:

- プレイすると指定レーンの `field.lanes[lane].threats` に置く
- 配置直後は `ready: false`
- 次ターン開始時に `ready: true`
- `ready` な継続脅威は毎判定で被害を追加する

防災ユニット:

- プレイすると指定レーンの `field.lanes[lane].defenses` に置く
- 配置直後は `ready: false`
- 次ターン開始時に `ready: true`
- `ready` な防災ユニットは該当レーンの被害を軽減する

### フィールド上限

UIの破綻を避けるため、最初は上限を入れます。

```text
各レーン:
  継続脅威 最大2枚
  防災ユニット 最大2枚
```

上限を超える場合はGameCoreで拒否します。

### 判定計算

```text
基本威力 = pendingThreat の damage
継続威力 = 対象レーンの ready な継続脅威の合計
通常軽減 = pendingResponse の軽減 + 対象レーンの ready な防災ユニットの合計

remainingDamageBeforeShield = max(0, 基本威力 + 継続威力 - 通常軽減)
```

`SNSデマ拡散` のような工作カードは、被害ではなく補助効果として扱います。

### discard処理

単発カード:

- プレイ後、判定が終わったら `discard` にある状態でよい

継続カード:

- プレイ時に `hand` から `field` に移動する
- `discard` には入れない

将来的に破壊・除去を入れる場合は、その時点で `field` から `discard` へ移動します。

### テスト例

- 継続脅威は配置ターンには被害を出さない
- 次ターン以降に継続威力が加算される
- 防災ユニットは配置ターンには軽減しない
- 次ターン以降に該当レーンだけ軽減する
- レーン上限を超える配置は拒否される
- `toMatchView()` ではフィールドカードは公開されるが、手札IDは漏れない

---

## 10. 段階7: frontend UI拡張

### 目的

新ルールを、1画面で理解できるように表示します。

### 対象ファイル

- `apps/frontend/src/components/disaster-game.tsx`
- `apps/frontend/src/app/globals.css`
- `apps/frontend/src/lib/match-client.ts`

### 追加表示

上部:

- 被害ゲージ
- 対策ゲージ
- ターン
- フェイズ
- WebSocket接続状態

中央:

- 防災シールド残数
- 公開済みシールド
- 3つの現場レーン
- 継続脅威
- 防災ユニット
- 判定内訳
- 防災Tips

下部:

- 闇の組織手札
- 政府手札
- CP / 予算
- 基盤ゾーン枚数
- 次回回復見込み

### UIで優先すること

- 怖すぎる表現にしない
- 「攻撃」ではなく「災害発生」「対応」「軽減」「防災シールド」を使う
- 未公開情報を表示しない
- 防災Tipsはカード内で詰め込まず、ポップオーバーまたはモーダルで全文表示する
- PC幅を前提にし、モバイルは非対応表示でよい

### UIコンポーネント分割案

現在は `disaster-game.tsx` が大きいため、拡張時に分割します。

```text
apps/frontend/src/components/
├── disaster-game.tsx          # 画面全体と状態管理
├── lobby.tsx                  # ルーム一覧
├── player-area.tsx            # 各陣営の手札・リソース
├── game-card.tsx              # カード表示
├── field-lanes.tsx            # 中央の3レーン
├── shield-row.tsx             # 防災シールド
├── resolution-summary.tsx     # 判定内訳
└── tips-modal.tsx             # Tips全文表示
```

分割は必須ではありませんが、レーンと基盤ゾーンまで入れるなら実施した方が保守しやすいです。

### 完了条件

- 自分の手札だけ実体表示される
- 相手の手札は枚数だけ表示される
- 防災シールドの中身は未公開
- 公開済みシールドだけ表示される
- レーンごとにカードが整理される
- 判定の内訳が説明できる

---

## 11. 段階8: backend/API追従

### 目的

新しいGameActionをオンライン対戦で安全に通します。

### 対象ファイル

- `apps/backend/src/index.ts`
- `apps/frontend/src/lib/match-client.ts`
- `apps/backend/worker-configuration.d.ts`

### 変更点

`ClientAction` を拡張します。

```ts
type ClientAction =
  | { type: "charge"; instanceId: string }
  | { type: "play"; instanceId: string; lane?: Lane }
  | { type: "pass" }
```

`parseClientAction()` では以下を検証します。

- `type` が許可された値である
- `instanceId` が必要なActionで文字列である
- `lane` がある場合、許可された値である
- 余計な `faction` は無視する

`toGameAction()` では、必ずDO側で確定した `role` を `faction` に入れます。

```ts
private toGameAction(role: PlayerRole, action: ClientAction): GameAction {
  switch (action.type) {
    case "charge":
      return { type: "charge", faction: role, instanceId: action.instanceId }
    case "pass":
      return { type: "pass", faction: role }
    case "play":
      return { type: "play", faction: role, instanceId: action.instanceId, lane: action.lane }
  }
}
```

### 判定確定ルール

現在と同じく、クライアントから `resolve` は送らせません。

政府の `play` または `pass` の結果、`phase === "resolution"` になった場合だけ、backendが内部的に `transition(state, { type: "resolve" })` を呼びます。

### Durable Object上の注意

- 重要状態は必ず `writeState()` してから `broadcast()` する
- ゲーム状態は `game_state.payload` に保存する
- D1は空きルーム一覧だけに使う
- `setAlarm()` は1 DOにつき1つなので、TTLと切断猶予の再スケジュール方針を変えない
- `blockConcurrencyWhile()` はコンストラクタのテーブル作成だけに留める

この計画では、DOのテーブル追加は不要です。

---

## 12. 段階9: バランス調整とQA

### 目的

ルールが動くだけでなく、1ゲームとして破綻しない値に調整します。

### 初期バランス案

| 項目 | 値 |
|---|---:|
| 初期手札 | 3枚 |
| ターン開始ドロー | 1枚 |
| 最大リソース | 10 |
| 基本回復 | 2 |
| 基盤1枚あたり追加回復 | +1 |
| 防災シールド | 5枚 |
| シールドあり被害 | `floor(被害 / 2)` |
| 各レーンの継続脅威上限 | 2枚 |
| 各レーンの防災ユニット上限 | 2枚 |

### 重点確認

- 闇の組織が早すぎず遅すぎず勝てるか
- 政府が啓発カードだけで簡単に勝ちすぎないか
- 基盤化が強すぎて序盤に何もしないゲームにならないか
- 防災シールドで被害が止まりすぎないか
- 緊急対応トリガーが強すぎて闇の組織が萎える展開にならないか
- Tips表示がゲームテンポを邪魔しないか

### 手動QA

最低限、以下を確認します。

1. 2つのブラウザまたは通常/プライベートウィンドウで別プレイヤーとして参加
2. 闇の組織側の手札が政府側に見えない
3. 政府側の手札が闇の組織側に見えない
4. 防災シールドの中身が未公開時に見えない
5. シールド公開時だけカード名とTipsが見える
6. 基盤化後、同じターンにプレイまたはパスできる
7. レーン指定カードが正しいレーンに出る
8. WebSocketで相手側画面も更新される
9. 退出・タブ閉じ・再参加で席状態が破綻しない
10. どちらかのゲージ100到達で終了画面が出る

### 実行コマンド

```bash
pnpm test
pnpm --filter frontend exec tsc --noEmit
pnpm --filter backend exec tsc --noEmit
pnpm --filter frontend build
```

backendのCloudflare型を再生成した場合:

```bash
pnpm --filter backend run cf-typegen
```

---

## 13. 推奨PR分割

作業単位は小さく分けます。

### PR 1: GameCore v2土台

内容:

- `Lane` 型追加
- `foundation` / `civicShields` / `field` の型追加
- `normalizeGameState()` 追加
- `MatchView` の公開フィールド追加
- 既存テスト維持

このPRでは、実際の新ルール効果は最小限にします。

### PR 2: 防災シールド

内容:

- 初期シールド生成
- 判定時のシールド公開
- 被害半減
- `lastResolution` 拡張
- シールド表示

### PR 3: 緊急対応トリガー

内容:

- `emergencyTrigger` 定義
- シールド公開時の自動発動
- Tips / ログ / 判定内訳表示

### PR 4: 基盤ゾーン

内容:

- `charge` Action
- `chargedThisTurn`
- 回復式変更
- 基盤ゾーンUI
- backend/client Action追従

### PR 5: レーン

内容:

- `pendingThreat` / `pendingResponse` のレーン対応
- レーンごとの表示
- レーン指定対策

### PR 6: 継続カード

内容:

- `ongoingThreat`
- `defenseUnit`
- `field.lanes`
- `ready` / `exhausted`
- レーン上限

### PR 7: UI整理とQA

内容:

- コンポーネント分割
- 判定内訳の見直し
- Tipsモーダル調整
- Playwrightキャプチャ比較
- バランス調整

---

## 14. 最初に着手する具体タスク

最初の実装着手は、以下の順番がよいです。

1. `packages/game-core/src/index.test.ts` に現状固定テストを追加
2. `packages/game-core/src/index.ts` に `Lane` と `normalizeGameState()` を追加
3. `PlayerState` に `foundation` と `chargedThisTurn` を追加するが、まだUIには出さない
4. `GameState` に `civicShields` / `revealedShields` / `field` を追加する
5. `createInitialGameState()` で政府デッキから5枚を `civicShields` に移す
6. `resolve()` でシールドあり被害を半減する
7. `toMatchView()` で `shieldCount` と `revealedShields` を返す
8. frontendで中央エリアに防災シールド残数を表示する
9. `pnpm test` と型検査を通す

ここまでで、ゲームデザイン案の中心要素である「防災シールド」が入ります。

その後に、緊急対応トリガー、基盤化、レーン、継続カードの順で追加します。

---

## 15. 実装時の判断基準

迷った場合は、以下を優先します。

1. ゲームルールはGameCoreに置く
2. backendは役割確定と永続化に徹する
3. frontendは表示とAction送信に徹する
4. 未公開情報を `MatchView` に含めない
5. フェイズを増やしすぎない
6. 割り込み選択を増やしすぎない
7. 1画面で理解できるUIを維持する
8. まず動くプロトタイプを優先し、細かいバランスは後で調整する

