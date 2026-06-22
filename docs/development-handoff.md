# 災害対策カードゲーム プロトタイプ 引き継ぎ書

最終更新: 2026-06-22

この文書は、途中参加する開発者がローカル起動、ゲームルールの変更、オンライン対戦の保守、Cloudflareへの反映までを一通り行えるようにするための引き継ぎ書です。

## 1. プロダクトの目的

ブラウザで動く、2人用・非対称のターン制カードゲームです。

- **闇の組織**: 被害ゲージを100にする。
- **日本政府**: 対策ゲージを100にする。
- 各カードには防災Tipsがあり、プレイ時に表示する。
- PCを主対象とした教育的な「危機管理ダッシュボード」風のUI。
- オンライン対戦を前提とし、相手の手札はサーバーから送らない。

## 2. 現在の状態（先に読むこと）

### 実装済み

- pnpmモノレポ（frontend / backend / game-core）。
- Cloudflare Durable Objects（以下DO）による部屋ごとのゲーム状態・WebSocket同期。
- D1による空きルーム一覧。
- 作成・参加・カード操作・パス・自動判定・勝敗判定。
- 手札を役割ごとに分離するサーバー側のビュー変換。
- WebSocketの短命・使い捨てチケット。
- 空きルーム一覧からの参加。URL共有・ルームID入力は廃止済み。
- 防災Tipsの全文ダイアログ。
- 退出、接続切断後の席解放、全席解放後のルーム初期化、TTLによる自動削除。

### 2026-06-22 時点の反映状況

- backend WorkerはCloudflare上に `backend` として存在する。
- backendのD1には `0001_match_directory.sql` と `0002_match_directory_vacancies.sql` が適用済み。
- backendの公開コードには `seat_disconnects`、`vacancies`、`/leave` が含まれることを取得済みコードで確認した。
- frontend Workerは存在するが、最新ソースの「ルームを退出」UIは未反映の可能性がある。**この文書の「デプロイ」手順でfrontendを再デプロイすること。**
- backend設定の `FRONTEND_ORIGIN` は末尾スラッシュなしの `https://frontend.tomop0513-maey.workers.dev` にする。末尾の `/` があるとCORSで失敗する。
- TTLの実装は型検査とローカルAPI結合テスト済み。ただし実時間（15分/30分）を待つ本番E2Eは未実施。

## 3. リポジトリ構成

```text
.
├── apps/
│   ├── backend/                 # Hono + Cloudflare Worker + Durable Object
│   │   ├── src/index.ts         # API、GameMatch DO、ルーム寿命管理
│   │   ├── migrations/          # D1マイグレーション
│   │   └── wrangler.jsonc       # D1 / DO / CORS設定
│   └── frontend/                # Next.js + OpenNext Cloudflare Worker
│       ├── src/components/disaster-game.tsx # 主UI
│       ├── src/lib/match-client.ts          # REST/WebSocketクライアント
│       ├── src/lib/match-session.ts         # sessionStorageのトークン管理
│       └── wrangler.jsonc
├── packages/
│   └── game-core/               # 純粋なゲームルールと共有型
│       └── src/index.ts
├── design-qa.md                 # 選択済みUIイメージとの比較記録
└── docs/development-handoff.md  # この文書
```

## 4. ローカル開発

前提:

- Node.js 24.13.0
- pnpm 11.8.0
- Cloudflareへのデプロイ時はWranglerログイン済みであること

```bash
# 依存関係のインストール
pnpm install

# frontend と backend を同時起動
pnpm dev
```

- frontend: `http://127.0.0.1:3000`
- backend: `http://127.0.0.1:8787`

すでにポートが使用中なら、まず親の `pnpm run dev` プロセスを停止する。`workerd` だけをkillしても親のWranglerが再起動するため、親プロセスを止めること。

### 検証コマンド

```bash
# ゲームルールのテスト
pnpm test

# frontend型検査
pnpm --filter frontend exec tsc --noEmit

# backend型検査
pnpm --filter backend exec tsc --noEmit

# Cloudflareバインディング型の再生成（wrangler.jsonc変更時）
pnpm --filter backend run cf-typegen

# frontend本番ビルド
pnpm --filter frontend build
```

## 5. アーキテクチャ

```text
Next.js frontend
  │ REST: create / join / actions / leave / socket-ticket
  │ WebSocket: 役割ごとの状態同期
  ▼
Hono Worker (apps/backend/src/index.ts)
  ├─ D1 MATCH_DIRECTORY
  │    └─ 一覧表示用: room ID / status / vacancies / created_at
  └─ GAME_MATCH Durable Object（部屋ごとに1インスタンス）
       ├─ SQLite: game_state / seats / socket_tickets / seat_disconnects
       ├─ WebSocketの役割別配信
       ├─ 席の解放と再割り当て
       └─ Alarms APIによるTTL処理
```

### なぜD1とDOを分けるか

- **DO**: 1対戦の強整合なゲーム状態、ターン処理、WebSocketを担当する。部屋名 `match:<UUID>` で決定的に取得する。
- **D1**: 全DOを列挙することはできないため、空き部屋一覧だけを保持する。ゲーム本体の正本ではない。

## 6. ゲームルールの実装場所

ゲームルールはすべて [packages/game-core/src/index.ts](../packages/game-core/src/index.ts) に置く。

`game-core` はCloudflare、HTTP、WebSocket、Reactを知らない純粋なルール層である。入力の`GameState`と`GameAction`から、次の`GameState`を返す責務だけを持つ。したがって、ルールを変更するときは最初にここを変更し、backendはその結果を保存・配信するだけにする。

### 状態モデル: `GameState` がゲームの正本

各ルームの`GameState`はDOの`game_state`テーブルにJSONで1件だけ保存される。次の表の値をクライアントが直接指定・上書きする経路はない。

| フィールド | 意味 | 主な更新元 |
|---|---|---|
| `turn` | 現在のターン番号。初期値は1。 | `startTurn()` |
| `phase` | `dark` / `government` / `resolution` / `ended`。現在操作できる段階。 | `startTurn()`, `play()`, `pass()`, `checkWinner()` |
| `damage` | 闇の組織が目指す被害ゲージ（0〜100）。 | `resolve()` |
| `countermeasures` | 政府が目指す対策ゲージ（0〜100）。 | `resolve()` |
| `dark`, `government` | 各陣営のリソース、山札、手札、捨て札。 | `createInitialGameState()`, `draw()`, `play()`, `startTurn()` |
| `pendingThreat` | このターンに闇の組織が出した災害・工作カード。 | `play()`, `pass()`, `startTurn()` |
| `pendingResponse` | このターンに政府が出した対策カード。 | `play()`, `pass()`, `startTurn()` |
| `nextGovernmentRecoveryPenalty` | 次の回復フェイズで政府の予算回復を減らす値。 | `resolve()`, `startTurn()` |
| `lastResolution` | 最後の判定の計算結果。演出と結果表示に使う。 | `resolve()` |
| `activeTips` | このターンにプレイされたカードの防災Tipsの配列。 | `play()`, `pass()` |
| `winner` | `dark` / `government` / `draw`。未決着時は`undefined`。 | `checkWinner()` |
| `log` | 新しい順のゲームログ。最大8件。 | `addLog()` |
| `revision` | 保存ごとにbackendが増やす版番号。同期状態の識別用。 | backendの`writeState()` |

`CardInstance`は山札・手札・捨て札で使う内部表現で、同じカード名でも`instanceId`が異なる。これにより、どの手札の1枚をプレイしたかを正確に判別できる。一方、相手に公開する`PublicCard`には`instanceId`を含めない。カード名や効果が分かっても、相手の手札を操作するIDは渡さないためである。

`MatchView.opponentConnected`は名称と異なり、現実装では「相手のWebSocketが開いているか」ではなく「相手の`seats`行が存在するか」を`GameMatch.snapshot()`が渡している。30秒の再接続猶予中も`true`になる。接続表示を厳密にしたい場合は、`hasConnectedSocketForRole(opponentOf(role))`を渡すように変え、再接続猶予中という別状態をUIへ追加する。

### ターン

1. 回復フェイズ: 両者のリソースを+3（上限10）、各1ドロー。
2. 闇の組織フェイズ: カード1枚プレイまたはパス。
3. 政府対応フェイズ: カード1枚プレイまたはパス。
4. 判定: 軽減、残余被害、対策値を計算。勝者がいなければ次ターン。

backendは政府のプレイ/パス直後に内部 `resolve` を実行する。クライアントは判定確定を指示できない。

### ルール関数の役割

以下の関数は同じファイルにある。状態を遷移させる通常操作は`transition()`だけを入口にする。backendは初期化の`createInitialGameState()`と表示変換の`toMatchView()`も呼ぶが、個別の`play()`・`pass()`・`resolve()`を直接呼ばない。これにより、フェイズ確認や勝敗判定を呼び忘れる経路を防ぐ。

| 関数 | 役割 | 状態への影響 |
|---|---|---|
| `deckFor(faction)` | 指定陣営のカード定義を各3枚ずつ`CardInstance`に展開する。 | 新しい配列を返すだけ。 |
| `shuffle(cards)` | Web Cryptoを使ったFisher-Yates法でカード列を複製してシャッフルする。 | 渡された配列は変更しない。 |
| `addLog(state, message, tone)` | 先頭へログを追加し、8件を超えた古いログを捨てる。 | コピー済みの`state.log`を更新する。 |
| `draw(player, count)` | 山札から指定枚数を手札に移す。山札が尽きたら捨て札をシャッフルして1回だけ山札へ戻す。 | `deck`、`hand`、`discard`を更新する。 |
| `startTurn(state)` | 次の通常ターンを開始する。ターン番号、フェイズ、保留カードをリセットし、両者の回復と1ドローを実行する。 | 1ターン分の開始状態へ進める。 |
| `createInitialGameState()` | 両者のデッキを作り、初期手札3枚を引き、`startTurn()`でターン1・各リソース3の開始状態を作る。 | 新規ゲーム専用。 |
| `publicCard(card)` | 内部カードから公開してよい名前・効果・Tipsだけを取り出す。 | 状態は変更しない。 |
| `playerView(player, revealHand)` | 1陣営の表示用状態を作る。`revealHand`が真なら手札の実体、偽なら枚数だけを返す。 | 状態は変更しない。 |
| `toMatchView(state, role, opponentConnected)` | UI向けの`MatchView`を構成する。ゲージ、フェイズ、公開カード、本人の手札、相手の枚数、操作可否を返す。 | 状態は変更しない。 |
| `playerFor(state, faction)` | `dark`または`government`のプレイヤー状態を選ぶ内部ヘルパー。 | 状態は変更しない。 |
| `expectedPhaseFor(faction)` | 各陣営がカードを出せるフェイズを返す。 | 状態は変更しない。 |
| `fail(state, message)` | 不正操作を元の状態と`{ ok: false, error }`として返す。例外にせず、APIが400へ変換できる形にする。 | 状態は変更しない。 |
| `checkWinner(state)` | 両ゲージを確認し、100到達なら`phase: "ended"`と`winner`を設定する。同時到達は`draw`。 | 終了状態にするかを決める。 |
| `play(state, faction, instanceId)` | フェイズ・手札・コストを検証し、カードを手札から捨て札へ移動する。闇なら政府フェイズへ、政府なら判定フェイズへ進める。 | カード使用後の途中状態を作る。 |
| `pass(state, faction)` | 現在の陣営がカードを出さない選択。闇なら政府フェイズ、政府なら判定フェイズへ進める。 | 保留カードを必要に応じて空にする。 |
| `resolve(state)` | 保留中の災害・対策の効果を合成し、ゲージ・次ターンペナルティ・ログを更新する。勝者がいなければ`startTurn()`を呼ぶ。 | 1ターンを確定する。 |
| `transition(state, action)` | `GameAction`に含まれる`faction`を使い、`play` / `pass` / 内部専用`resolve`を振り分ける唯一の公開入口。 | 上記のいずれかを呼ぶ。 |
| `phaseLabel()`, `factionLabel()` | 表示用の日本語ラベルを返す。 | 状態は変更しない。 |

### 操作から次ターンまでの呼び出し順

```text
闇の組織: transition(state, { type: "play", faction: "dark", instanceId })
  └─ play()
      ├─ 手札・コスト・フェイズを検証
      ├─ pendingThreat にカードを置く
      └─ phase = "government"

政府: transition(state, { type: "play", faction: "government", instanceId })
  └─ play()
      ├─ pendingResponse にカードを置く
      └─ phase = "resolution"

backend: transition(result.state, { type: "resolve" })
  └─ resolve()
      ├─ 被害と軽減を計算
      ├─ checkWinner()
      └─ 勝者なしなら startTurn()
```

政府が`pass`した場合も`phase = "resolution"`まで進むため、backendは同じように直ちに`resolve`する。`resolve`は`GameAction`型に含まれているが、HTTPのアクション解析は`play`と`pass`だけを許可する。これは、片方のプレイヤーが相手の対応前や任意のタイミングで判定を確定できないようにするためである。

### `startTurn()` の詳細

`startTurn()`は「前ターンの判定が終わった状態」から、次の闇の組織フェイズを作る。

1. `turn`を1増やし、`phase`を`dark`にする。
2. `pendingThreat`と`pendingResponse`を`undefined`にして、前ターンの場札をクリアする。
3. 闇の組織のCPを`min(10, 現在値 + 3)`にし、1枚引く。
4. 政府の予算を`min(10, 現在値 + max(0, 3 - nextGovernmentRecoveryPenalty))`にし、1枚引く。
5. `nextGovernmentRecoveryPenalty`を0へ戻す。したがって「SNSデマ拡散」は次の回復1回だけに影響する。
6. ターン開始ログを追加する。

初期化時は、先に双方が3枚引かれた後で`startTurn()`が呼ばれる。そのため、開始直後は「手札4枚、CP/予算3、ターン1、闇の組織フェイズ」になる。この仕様を変更する場合は、`createInitialGameState()`とテストをセットで見直す。

### `play()` と `pass()` の検証内容

`play()`は次をすべて満たす場合だけ成功する。

1. ゲームが終了していない。
2. 呼び出した陣営のフェイズである。
3. `instanceId`がその陣営の手札に存在する。
4. そのカードのコスト以下のリソースを持つ。

成功時は、コストを引き、対象のカードを手札から捨て札へ移す。闇の組織のカードは`activeTips`をその1件で置き換え、政府のカードは既存のTipsへ追加する。カードは闇の組織なら`pendingThreat`、政府なら`pendingResponse`に保存する。実際の被害計算はこの時点では行わない。政府が対応する余地を残すためである。

`pass()`もフェイズ検証を行う。闇の組織がパスした場合は発生中の災害と`activeTips`を空にして政府フェイズへ進む。政府がパスした場合は対策を空にして判定フェイズへ進む。カードを持っていない、またはリソースが足りない場合でもパスできる。なお、`startTurn()`は`activeTips`を消さないため、政府の対策Tipsを含む直近のTipsは次に闇の組織がカードを出すかパスするまで表示される。

### `resolve()` の計算順序

`resolve()`だけがゲージを増減させる。今後カードを増やす場合も、効果の組み合わせをこの順序に合わせる。

```text
rawDamage       = pendingThreat.effect.damage ?? 0
multiplier      = pendingResponse.effect.damageMultiplier が設定されていればその値、なければ 1
afterMultiplier = floor(rawDamage * multiplier)
flatMitigation  = pendingResponse.effect.flatMitigation ?? 0
finalDamage     = max(0, afterMultiplier - flatMitigation)

damage          = min(100, damage + finalDamage)
countermeasures = min(100, countermeasures + (pendingResponse.effect.countermeasure ?? 0))
nextGovernmentRecoveryPenalty = max(現在値, threatのペナルティ)  // 脅威にペナルティがある場合のみ
```

つまり、`緊急避難指示`の半減は先に適用され、`防潮堤の強化`の固定軽減はその後に引かれる。現行カードでは政府は1枚しか出せないため、倍率・固定軽減はいずれも最大1つだが、将来複数対策を許す場合も順序を変えない限り同じ考え方を拡張できる。

その後`lastResolution`とログを作り、`checkWinner()`を呼ぶ。勝者がいれば`ended`のまま止め、いなければ`startTurn()`を実行して次ターンへ進む。よって`resolution`は永続的に画面へ残るフェイズではなく、backend内で短時間だけ存在する中間状態である。

### 不変条件とルール変更時の確認

- `damage`と`countermeasures`は常に0〜100、リソースは0〜10に収める。
- カードはプレイ時に必ず「手札から1枚減り、捨て札に1枚増える」。
- `pendingThreat`は闇の組織のカード、`pendingResponse`は政府のカードだけを保持する。
- `phase: "ended"`のゲームに対する`play`と`pass`は失敗する。
- 公開ビューに相手の`hand`または`instanceId`を混入させない。

ルール変更では、まず[packages/game-core/src/index.test.ts](../packages/game-core/src/index.test.ts)に「入力状態・アクション・期待する最終状態」を書く。特に軽減式、同時100到達、デッキ枯渇、次ターンペナルティ、フェイズ外操作は回帰しやすい。

### カードを追加・変更する方法

1. `CARD_DEFINITIONS` にカード定義を追加する。
2. `faction`, `cost`, `summary`, `tips`, `effect` を指定する。
3. `effect` は `damage`, `nextBudgetRecoveryPenalty`, `flatMitigation`, `damageMultiplier`, `countermeasure` を組み合わせる。
4. `packages/game-core/src/index.test.ts` に期待値を追加する。
5. UIのアイコンを増やす場合は `apps/frontend/src/components/disaster-game.tsx` の `cardIcons` を更新する。

デッキは各定義を3枚ずつ複製する。シャッフルはWeb Cryptoを使用する。

## 7. オンライン対戦API

| API | 認証 | 役割 |
|---|---|---|
| `POST /api/matches` | 不要 | ルーム作成。最初のプレイヤーは闇の組織。 |
| `GET /api/matches/open` | 不要 | `waiting` 状態のルームと `vacancies` を返す。 |
| `POST /api/matches/:matchId/join` | 不要 | 空いている陣営を割り当てる。 |
| `GET /api/matches/:matchId` | `X-Player-Token` | 自分の役割で状態を取得。 |
| `POST /api/matches/:matchId/actions` | `X-Player-Token` | `play` または `pass`。 |
| `POST /api/matches/:matchId/socket-ticket` | `X-Player-Token` | 60秒・使い捨てのWebSocketチケットを発行。 |
| `GET /api/matches/:matchId/socket?ticket=...` | ticket | DOにWebSocket接続。 |
| `POST /api/matches/:matchId/leave` | `X-Player-Token` | 明示的に席を即時解放。 |

### 認証と手札秘匿

- 作成・参加時に `crypto.randomUUID()` でプレイヤートークンを発行する。
- DOにはトークンのSHA-256ハッシュだけを保存する。
- frontendはトークンを`sessionStorage`へ保存する。[match-session.ts](../apps/frontend/src/lib/match-session.ts)
- `toMatchView()` が自分の手札だけを返す。相手の `hand` とカードの `instanceId` は返さない。
- WebSocketはトークンそのものではなく、短命・一回限りのチケットをクエリに使う。

**注意:** トークンをURL、ログ、画面、D1へ保存しないこと。新しい認証方式を追加する場合も、ゲーム状態をクライアントの送信値で上書きしないこと。

## 8. ルームの席・TTL仕様

実装の中心は [apps/backend/src/index.ts](../apps/backend/src/index.ts) の `GameMatch`。

ここでは、1ルームにつき1つの`GameMatch` Durable Object（DO）が、席・トークン・ゲーム状態・接続を直列に処理する。WorkerのHTTPハンドラはDOスタブを取得してメソッドを呼ぶだけで、ゲーム状態を直接変更しない。これにより、同じルームに対する「同時参加」「同時カード使用」「切断と再接続」は同一DO内で順番に処理される。

### DOの生成と識別

`POST /api/matches`はUUIDを作り、`env.GAME_MATCH.getByName("match:<UUID>")`で決定的なDOスタブを取得して`GameMatch.create()`を呼ぶ。`getByName()`は名前から同じDO IDを導くため、以後の参加・操作・接続も同じ名前から同じDOへ到達する。

DOのコンストラクタで`ctx.blockConcurrencyWhile()`を使い、最初のリクエストを処理する前に内部SQLiteテーブルを作成する。これにより初期化途中で別の参加処理が走ることを避ける。これらはDO内のSQLiteテーブルであり、D1マイグレーションには含めない。`wrangler.jsonc`の`new_sqlite_classes: ["GameMatch"]`はDOのSQLiteを有効にするための一度きりのDurable Objectマイグレーションである。

### DO内部テーブル

| テーブル | 1行が表すもの | 使う関数 | なぜ必要か |
|---|---|---|---|
| `game_state` | ルーム全体の`GameState` JSON。常に1件。 | `readState()`, `writeState()` | GameCoreの正本を永続化する。 |
| `seats` | `dark`または`government`の席とSHA-256化したプレイヤートークン。 | `hasSeat()`, `roleForTokenHash()`, `join()`, `removeSeat()` | トークンから役割を検証し、空席を決める。平文トークンは置かない。 |
| `socket_tickets` | WebSocket接続用の使い捨てUUID、役割、有効期限。 | `issueSocketTicket()`, `consumeSocketTicket()` | URL上で長期トークンを渡さず、接続の認可を一回限りにする。 |
| `seat_disconnects` | 切断した役割と再接続猶予の期限。 | `markDisconnected()`, `clearDisconnectDeadline()`, `releaseExpiredSeats()` | タブ再読み込みなどで即座に席を他人へ渡さない。 |

### `GameMatch` の公開メソッド

Workerから直接呼ばれるメソッドと、WebSocketイベントとしてDOランタイムから呼ばれるメソッドを分けている。

| 関数 | 呼び出し元 | 処理内容 | 永続状態への影響 |
|---|---|---|---|
| `constructor(ctx, env)` | DOの初期化 | テーブル作成を直列化し、`ctx`と`env`を保持する。 | 初回のみテーブル定義を作る。 |
| `create(token)` | `POST /api/matches` | 既存ゲームがないことを確認し、初期ゲームと闇の組織の席を作る。作成者のトークンはハッシュ化して保存する。 | `game_state`、`seats`を作成し、TTLアラームを設定する。 |
| `join(token)` | `POST /join` | 期限切れの切断席を先に解放する。同じトークンなら既存の役割を返し、新規なら空席の役割を割り当てる。 | `seats`を追加、猶予を削除、D1一覧とアラームを更新する。 |
| `getState(token)` | `GET /api/matches/:id` | トークンから役割を検証し、その役割用の`MatchView`を返す。 | ゲームは変更しない。TTLは更新する。 |
| `act(token, action)` | `POST /actions` | トークンの役割だけで`GameCore.transition()`を呼ぶ。政府のプレイ/パスで`resolution`になれば、続けて内部`resolve`を呼ぶ。 | 新しい`GameState`を書き、D1、TTL、接続中クライアントを更新する。 |
| `issueSocketTicket(token)` | `POST /socket-ticket` | 認証済みの役割に60秒の使い捨てチケットを発行する。古い期限切れチケットも掃除する。 | `socket_tickets`を追加・削除する。 |
| `leave(token)` | `POST /leave` | 明示的に退出した役割のWebSocketを閉じ、その席をすぐ削除する。 | 席、チケット、切断猶予を削除し、D1とTTLを更新する。 |
| `fetch(request)` | `GET /socket?ticket=...` のDO転送 | Upgradeリクエストか確認し、チケットを消費してWebSocketを受理する。ソケットの添付情報に役割を保存して、その役割専用ビューを送る。 | チケットを削除、切断猶予を解除、TTLを更新する。 |
| `webSocketMessage(ws)` | 接続済みクライアントからのメッセージ | 添付された役割を検証し、最新の役割別ビューを送り直す。現状クライアントはゲーム操作をWebSocketで送らない。 | 状態は変更しない。 |
| `webSocketClose(ws)` | 正常なWebSocket切断 | `markDisconnected()`を呼び、必要なら30秒の猶予を開始する。 | `seat_disconnects`を更新する。 |
| `webSocketError(ws)` | WebSocketエラー | `webSocketClose()`と同じ扱いで切断猶予を開始する。 | `seat_disconnects`を更新する。 |
| `alarm()` | Cloudflare Alarms API | 再接続猶予の満了、無接続TTL、最終削除を順に判定する。 | 期限切れ席の削除、D1行削除、DOストレージ削除を行う。 |

`create()`が闇の組織を先に割り当てるのはルールで固定している。一方`join()`は空席を見て決めるため、元の闇の組織が離脱していれば参加者は闇の組織として入り直せる。既存トークンでの`join()`は役割を変えずに返すため、同じプレイヤーが二重に席を取ることはない。

### 状態読み書きと認可の補助関数

| 関数 | 詳細 |
|---|---|
| `readState()` | `game_state`のJSONを読み、なければ`undefined`を返す。削除済みのDOを検出する基点。 |
| `requireState()` | `readState()`が`undefined`なら「ルームが見つかりません」の`Error`を投げる。HTTPルート側の`errorResponse()`が400応答へ変換する。以後のメソッドは必ず実ゲームを対象にする。 |
| `writeState(state)` | 直前の保存値を見て`revision`を1増やし、JSONを書き戻す。APIとWebSocketが同じ保存済み状態を読むようにする。 |
| `hashToken(token)` | SHA-256でプレイヤートークンをハッシュ化する。DBには平文を残さない。 |
| `hasSeat(faction)` | 指定陣営の席が存在するか返す。接続中かではなく「トークンを持つプレイヤーがいるか」を表す。 |
| `roleForTokenHash(hash)` | トークンハッシュから`dark`または`government`を引く。 |
| `requireRole(token)` | トークンをハッシュ化し、席がなければ認可エラー、あれば役割を返す。`getState`、`act`、`leave`、チケット発行の共通入口。 |
| `consumeSocketTicket(ticket)` | 有効期限と存在を確認してから、チケットを先に削除して役割を返す。二重接続・再利用を防ぐ。 |
| `matchId()` | `ctx.id.name`の`match:<UUID>`からUUID部分を取り出す。DOとD1の同じルームを結び付ける。 |
| `toGameAction(role, clientAction)` | HTTPで受けた役割なしの`ClientAction`へ、認証済みの`role`を追加してGameCoreの`GameAction`にする。クライアントが`faction`を詐称する経路を作らない。 |
| `snapshot(state, role)` | `toMatchView()`を呼び、RESTの戻り値`{ role, view }`を組み立てる。相手席の有無もここで渡す。 |

`writeState()`にだけ`revision`の採番を置くため、GameCoreは通信・保存の都合を持たない。`GameCore`のテストでは`revision`を意識せず、DOのテストでは保存後に更新されることだけを確認すればよい。

### 操作処理 `act()` の詳細

`act()`はオンライン対戦の最重要境界である。クライアントが送るのは`{ type: "play", instanceId }`または`{ type: "pass" }`だけで、フェイズ、コスト、効果量、ゲージ値は送らない。

1. `requireRole()`で送信者の役割を確定する。
2. `requireState()`で現在状態を読み込む。
3. `toGameAction(role, action)`で認証済み役割を付与してから、`transition(state, gameAction)`へ検証と更新を委譲する。
4. 失敗なら状態を保存せずエラーを返す。たとえば政府が闇の組織フェイズにカードを出すことはできない。
5. 成功し、フェイズが`resolution`ならbackendだけが`transition(nextState, { type: "resolve" })`を追加実行する。
6. 完成した状態を`writeState()`し、`syncDirectory()`、`scheduleExpiry()`、`broadcast()`を実行する。
7. 操作した本人には役割別スナップショットを返し、接続中の両者にはそれぞれ別のWebSocketメッセージを送る。

DOは1インスタンス内の処理を直列化するため、同じフェイズで2つのアクションが同時到着しても、一方の保存後にもう一方が検証される。後から来た操作はフェイズ不一致または手札不一致で失敗する。クライアント側のボタン無効化はUXのためであり、このサーバー側検証の代わりにはならない。

### WebSocketと再接続の補助関数

| 関数 | 詳細 |
|---|---|
| `hasConnectedSockets()` | DOにWebSocketが1本でも残るかを確認する。TTLで部屋全体を消してよいかの判定に使う。 |
| `hasConnectedSocketForRole(role)` | 同じ役割の別タブ・再接続ソケットがあるかを確認する。片方が閉じても席を誤って解放しないために使う。 |
| `markDisconnected(ws)` | ソケット添付情報から役割を取り出す。席があり、同じ役割の接続が他にない場合だけ`now + 30秒`を`seat_disconnects`へ保存する。 |
| `clearDisconnectDeadline(role)` | 再接続・参加時にその役割の切断期限を消す。 |
| `nextDisconnectDeadline()` | 全役割の猶予期限のうち最も早い時刻を返す。アラームを1本にまとめるために必要。 |
| `closeSocketsForRole(role)` | 明示退出時にその役割の全ソケットを閉じる。退出後も古いタブが表示更新を受けないようにする。 |
| `sendState(socket, state, role)` | 1本のソケット専用に`{ type: "state", view }`をJSON送信する。必ず`role`を指定して`toMatchView()`を通す。 |
| `broadcast(state)` | 接続中の各ソケットから役割を読み、`toMatchView(state, role, ...)`を個別に作って送る。両者に同じJSONを送らないことが手札秘匿の要点。 |

WebSocketの添付情報には`{ role }`だけを入れ、トークンを保持しない。接続成立時のチケットはすでに消費済みなので、以後の配信先識別に長期認証情報は不要である。

### 席を解放する関数と再募集

| 関数 | 詳細 |
|---|---|
| `openRole()` | 空いている役割を返す。両方空なら`dark`を先に返す。満席なら`null`。 |
| `openSeats()` | `seats`にない役割の数を0〜2で返す。D1の`vacancies`の元データ。 |
| `removeSeat(role)` | 指定役割の席、未使用チケット、切断期限をまとめて削除する。トークンだけを残さない。 |
| `releaseExpiredSeats(state)` | 期限切れの切断行だけを取得する。対応するソケットが残っていれば期限だけ消し、なければ`removeSeat()`する。席を変えた後は`applyVacancies()`を呼ぶ。 |
| `applyVacancies(state)` | 両席が空なら`createInitialGameState()`で盤面を初期化する。その後、D1同期とTTL設定を必ず実行する。 |

「席がある」と「WebSocketが接続されている」は別である。切断後30秒は席とトークンを残すが、接続はない。この差を持たせることで、再読み込み時には同じプレイヤーが戻れ、30秒を超えれば第三者が空いた役割へ参加できる。

両席が空いたときに初期ゲームへ戻すのは、古いターン・手札・ゲージを次の募集に引き継がないためである。この状態はD1では`waiting / vacancies=2`となり、ロビーから新しい2人が参加できる。

### D1一覧同期 `syncDirectory()`

`syncDirectory(state)`はDOの正本からD1の検索用コピーを更新する。状態は次のように決まる。

| 条件 | D1 `status` | `vacancies` |
|---|---|---:|
| `state.phase === "ended"` | `ended` | 現在の空席数 |
| 終了しておらず空席が1以上 | `waiting` | 1または2 |
| 終了しておらず空席なし | `active` | 0 |

ロビーの`GET /api/matches/open`は`waiting`だけを取得する。D1の値が多少遅れても、参加可否の最終判定は必ずDOの`join()`が行うので、一覧から同時に参加を試みても満席に入り込むことはない。

### TTLと `scheduleExpiry()`

`scheduleExpiry(state)`は、次に必要な処理時刻を`ctx.storage.setAlarm()`へ設定する。DOにはアラームを1つしか持てないため、次の候補のうち最も早い時刻を選ぶ。

| 候補 | 設定値 |
|---|---:|
| 終了済みルームの無接続TTL | 5分後 |
| 空席が1つあるルームの無接続TTL | 30分後 |
| 両席が空いている待機ルームの無接続TTL | 15分後 |
| 再接続猶予がある場合 | その期限（通常TTLより早ければ優先） |

`expiryTtl(state)`は上表の通常TTLを選ぶ関数である。ここでの「対戦中」はフェイズではなく、空席が1つのルームを指す。接続中のソケットがある限り、アラーム発火時に削除せず再設定するため、プレイ中のルームが時間だけで消えることはない。

### `alarm()` の詳細な分岐

アラームは次の順序で動く。順序を変えると、再接続猶予中の席を部屋TTLで先に消すなどの不具合につながる。

```text
alarm()
  ├─ game_state がない → 何もしない（すでに削除済み）
  ├─ 切断猶予が期限切れ → releaseExpiredSeats(state) → 終了
  ├─ 切断猶予がまだ残る → scheduleExpiry(state) → 終了
  ├─ 接続中WebSocketが1本以上ある → scheduleExpiry(state) → 終了
  └─ 無接続で通常TTLを迎えた
       ├─ D1のmatch_directory行を削除
       └─ ctx.storage.deleteAll() でDOの全状態とアラームを消す
```

`releaseExpiredSeats()`は内部で`applyVacancies()`を呼び、そこから`syncDirectory()`と`scheduleExpiry()`まで実施する。そのためアラーム側で二重にD1更新やアラーム設定をしない。`ctx.storage.deleteAll()`後はDO IDの名前自体が予約解除されるわけではないが、状態がないのでAPIは「ルームが見つかりません」と返す。同じ名前を新規ルームに再利用しないUUID設計のため、古いURLが別ゲームを指すこともない。

### 席の状態

- `seats`: 役割 (`dark` / `government`) とトークンハッシュ。
- `seat_disconnects`: 切断した役割と、再接続猶予の終了時刻。
- `socket_tickets`: WebSocket接続用の短命チケット。

### 切断・再参加のルール

1. WebSocketが閉じると、同じ役割の接続が残っていなければ30秒の再接続猶予を開始する。
2. 30秒以内に同じ役割が再接続すると、猶予を取り消す。
3. 猶予後も接続がなければ、その役割のトークンとチケットを削除して席を解放する。
4. 空席が1つなら、次の参加者は空いた役割を受け取る。
5. 両席が空くと `createInitialGameState()` でゲームを初期化し、D1上で `waiting / vacancies=2` に戻す。
6. 明示的な退出は猶予を待たずに席を解放する。

### TTL

| 状態 | 無接続での削除まで |
|---|---:|
| 誰もいない待機ルーム | 15分 |
| 対戦中のルーム | 30分 |
| 終了済みルーム | 5分 |

DOのアラームは1インスタンスにつき1つだけなので、席の再接続猶予とTTLのうち早い時刻をセットする。アラーム発火時にD1の一覧行を削除し、`ctx.storage.deleteAll()` でDO内のデータとアラームを消す。

DOのID自体を削除するAPIは使わない。保存データを消した後、DOは自然に非アクティブ化され、同じIDへのアクセスは「ルームが見つかりません」となる。

### D1の`match_directory`

| 列 | 用途 |
|---|---|
| `match_id` | DO名のUUID部分。 |
| `status` | `waiting` / `active` / `ended`。 |
| `vacancies` | 空席数（0〜2）。一覧表示用。 |
| `created_at`, `updated_at` | エポックミリ秒。 |

`0001_match_directory.sql` がテーブルと一覧用インデックスを作成し、`0002_match_directory_vacancies.sql` が`vacancies`を追加する。

## 9. frontendの責務

主UIは [apps/frontend/src/components/disaster-game.tsx](../apps/frontend/src/components/disaster-game.tsx)。

- ロビー: 空きルームを取得・更新し、`vacancies`を表示する。
- ゲーム画面: 自分の手札だけを表示し、相手の手札は枚数だけ表示する。
- `ルームを退出`: `POST /leave` 後にsessionStorageを削除してロビーへ戻る。
- Tips: 中央の短縮表示と、全文を確認できるモーダルを提供する。
- WebSocket: 接続が切れたら1.5秒後に再接続する。

APIクライアントは [apps/frontend/src/lib/match-client.ts](../apps/frontend/src/lib/match-client.ts)。本番ビルドでは `NEXT_PUBLIC_API_BASE_URL` を指定する。未指定のローカル開発時だけ `http://127.0.0.1:8787` を使用する。

## 10. Cloudflare設定・デプロイ

### backend

- Worker名: `backend`
- URL: `https://backend.tomop0513-maey.workers.dev`
- D1 binding: `MATCH_DIRECTORY`
- DO binding: `GAME_MATCH`
- CORS許可origin: `https://frontend.tomop0513-maey.workers.dev`（末尾スラッシュなし）

```bash
# D1マイグレーションを確認・適用
pnpm --filter backend exec wrangler d1 migrations apply MATCH_DIRECTORY --remote

# backendをデプロイ
pnpm --filter backend deploy
```

### frontend

- Worker名: `frontend`
- URL: `https://frontend.tomop0513-maey.workers.dev`
- OpenNext Cloudflareを使用する。

```bash
NEXT_PUBLIC_API_BASE_URL=https://backend.tomop0513-maey.workers.dev pnpm --filter frontend deploy
```

### CORSトラブルシューティング

`Access-Control-Allow-Origin` がない場合は、backendに登録した`FRONTEND_ORIGIN`を確認する。

```text
正: https://frontend.tomop0513-maey.workers.dev
誤: https://frontend.tomop0513-maey.workers.dev/
```

ブラウザの`Origin`ヘッダーは末尾スラッシュを含まない。backendの判定は文字列完全一致であるため、末尾スラッシュがあるとCORSヘッダーは返らない。

## 11. 直近の検証結果

- `pnpm --filter backend exec tsc --noEmit`: 通過。
- `pnpm --filter frontend exec tsc --noEmit`: 通過。
- ローカルD1へ`0002_match_directory_vacancies.sql`を適用済み。
- 本番D1へ`0002_match_directory_vacancies.sql`を適用済み。
- ローカルAPI結合テストで以下を確認済み。
  1. 作成直後は空席1。
  2. 政府として参加。
  3. 作成者が退出すると闇の組織席が空く。
  4. 次の参加者が闇の組織として割り当てられる。
  5. 両者が退出すると初期化され、空席2になる。
- `design-qa.md` はTips・空き部屋一覧までのQA記録。最新の退出ボタン・空席2表示は未反映のため、frontend再デプロイ前後に更新する。

## 12. 既知の制約と次の改善候補

優先度順:

1. **frontendの再デプロイ**: 最新の空席数表示と退出UIを公開する。
2. **本番スモークテスト**: 別ブラウザ2つで作成、参加、退出、再参加を確認する。
3. **TTL実時間テスト**: 30秒の再接続猶予、15分の空ルーム削除を確認する。検証中だけTTL値を短くしたブランチを使うとよい。
4. **レート制限**: 公開prototypeとして広く公開する場合、`POST /api/matches`と`POST /join`へCloudflare Rate Limitingを追加する。
5. **終了後のUX**: 片方だけが終了画面に残った場合、新規参加を許可するか、全員退出まで終了ルームとして保持するかを要件化する。
6. **カードイラスト**: `design-qa.md`でP3。現在はPhosphorアイコンで代替している。

## 13. 変更時のチェックリスト

- [ ] ゲームルールなら`packages/game-core`を変更し、`pnpm test`を通す。
- [ ] APIレスポンスを変えたら`match-client.ts`とUI型を同時に変える。
- [ ] D1スキーマ変更なら新しい連番SQLを`apps/backend/migrations/`へ追加する。既存マイグレーションを編集しない。
- [ ] `wrangler.jsonc`のbinding変更後は`pnpm --filter backend run cf-typegen`を実行する。
- [ ] frontendの`NEXT_PUBLIC_*`はブラウザへ公開される。秘密値を入れない。
- [ ] CORSの本番originには末尾スラッシュを付けない。
- [ ] backendとfrontendを再デプロイし、実ブラウザ2つで役割・手札秘匿・切断後の再参加を確認する。

## 14. 参考資料

- [Cloudflare Durable Objects Alarms](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Cloudflare D1 Migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare Workers Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [UI比較QA](../design-qa.md)
