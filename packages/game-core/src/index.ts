export const MAX_GAUGE = 100
export const MAX_RESOURCE = 10

export type Faction = "dark" | "government"
export type Phase = "dark" | "government" | "resolution" | "ended"
export type Winner = Faction | "draw"

export type CardDefinition = {
  id: string
  faction: Faction
  name: string
  cost: number
  category: "disaster" | "scheme" | "countermeasure" | "education"
  summary: string
  tips: string
  effect: {
    damage?: number
    nextBudgetRecoveryPenalty?: number
    flatMitigation?: number
    damageMultiplier?: number
    countermeasure?: number
  }
}

export type CardInstance = CardDefinition & {
  instanceId: string
}

export type PlayerState = {
  resource: number
  deck: CardInstance[]
  hand: CardInstance[]
  discard: CardInstance[]
}

export type GameLog = {
  id: string
  turn: number
  message: string
  tone: "neutral" | "dark" | "government" | "result"
}

export type GameState = {
  version: 1
  revision: number
  turn: number
  phase: Phase
  damage: number
  countermeasures: number
  dark: PlayerState
  government: PlayerState
  pendingThreat?: CardInstance
  pendingResponse?: CardInstance
  nextGovernmentRecoveryPenalty: number
  activeTips: Array<{ cardName: string; text: string }>
  lastResolution?: {
    rawDamage: number
    remainingDamage: number
    countermeasureGain: number
  }
  log: GameLog[]
  winner?: Winner
}

export type PublicCard = Omit<CardInstance, "instanceId">

export type PlayerView = {
  resource: number
  handCount: number
  deckCount: number
  discardCount: number
  hand?: CardInstance[]
}

export type MatchView = {
  revision: number
  role: Faction
  opponentConnected: boolean
  turn: number
  phase: Phase
  damage: number
  countermeasures: number
  dark: PlayerView
  government: PlayerView
  pendingThreat?: PublicCard
  pendingResponse?: PublicCard
  activeTips: GameState["activeTips"]
  lastResolution?: GameState["lastResolution"]
  log: GameLog[]
  winner?: Winner
  canAct: boolean
}

export type GameAction =
  | { type: "play"; faction: Faction; instanceId: string }
  | { type: "pass"; faction: Faction }
  | { type: "resolve" }

export type TransitionResult =
  | { ok: true; state: GameState }
  | { ok: false; state: GameState; error: string }

export const CARD_DEFINITIONS: readonly CardDefinition[] = [
  {
    id: "earthquake",
    faction: "dark",
    name: "直下型地震",
    cost: 3,
    category: "disaster",
    summary: "被害ゲージ +15",
    tips: "家具の固定は必須です。転倒・落下・移動を防ぐ備えをしましょう。",
    effect: { damage: 15 },
  },
  {
    id: "misinformation",
    faction: "dark",
    name: "SNSデマ拡散",
    cost: 2,
    category: "scheme",
    summary: "政府の次回予算回復 -1",
    tips: "災害時の不確かな情報に注意し、公式発表を確認しましょう。",
    effect: { nextBudgetRecoveryPenalty: 1 },
  },
  {
    id: "downpour",
    faction: "dark",
    name: "ゲリラ豪雨",
    cost: 2,
    category: "disaster",
    summary: "被害ゲージ +10",
    tips: "ハザードマップを確認し、危険な場所を事前に把握しましょう。",
    effect: { damage: 10 },
  },
  {
    id: "seawall",
    faction: "government",
    name: "防潮堤の強化",
    cost: 3,
    category: "countermeasure",
    summary: "このターンの災害威力 -10 / 対策 +5",
    tips: "ハード面の対策は、被害を物理的に軽減します。",
    effect: { flatMitigation: 10, countermeasure: 5 },
  },
  {
    id: "evacuation",
    faction: "government",
    name: "緊急避難指示",
    cost: 2,
    category: "countermeasure",
    summary: "このターンの災害威力を半減 / 対策 +2",
    tips: "早期の避難行動が命を救います。避難情報を確認しましょう。",
    effect: { damageMultiplier: 0.5, countermeasure: 2 },
  },
  {
    id: "stockpile",
    faction: "government",
    name: "備蓄キャンペーン",
    cost: 1,
    category: "education",
    summary: "対策ゲージ +10",
    tips: "最低3日分の水と食料を備蓄し、定期的に入れ替えましょう。",
    effect: { countermeasure: 10 },
  },
] as const

const deckFor = (faction: Faction): CardInstance[] =>
  CARD_DEFINITIONS.filter((card) => card.faction === faction).flatMap((card) =>
    Array.from({ length: 3 }, (_, copy) => ({ ...card, instanceId: `${card.id}-${copy + 1}` })),
  )

const shuffle = <T,>(items: readonly T[]): T[] => {
  const next = [...items]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    const swapIndex = value[0] % (index + 1)
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
  }
  return next
}

const addLog = (state: GameState, message: string, tone: GameLog["tone"]): void => {
  state.log = [
    { id: `${state.turn}-${state.log.length + 1}`, turn: state.turn, message, tone },
    ...state.log,
  ].slice(0, 8)
}

const draw = (player: PlayerState, count: number): void => {
  for (let index = 0; index < count; index += 1) {
    if (player.deck.length === 0 && player.discard.length > 0) {
      player.deck = shuffle(player.discard)
      player.discard = []
    }

    const card = player.deck.pop()
    if (card) player.hand.push(card)
  }
}

const startTurn = (state: GameState): GameState => {
  const next = structuredClone(state)
  next.turn += 1
  next.phase = "dark"
  next.pendingThreat = undefined
  next.pendingResponse = undefined
  next.dark.resource = Math.min(MAX_RESOURCE, next.dark.resource + 3)
  const governmentRecovery = Math.max(0, 3 - next.nextGovernmentRecoveryPenalty)
  next.government.resource = Math.min(MAX_RESOURCE, next.government.resource + governmentRecovery)
  next.nextGovernmentRecoveryPenalty = 0
  draw(next.dark, 1)
  draw(next.government, 1)
  addLog(next, `第${next.turn}ターン開始。両陣営がリソースを回復し、カードを1枚ドローしました。`, "neutral")
  return next
}

export const createInitialGameState = (): GameState => {
  const state: GameState = {
    version: 1,
    revision: 0,
    turn: 0,
    phase: "dark",
    damage: 0,
    countermeasures: 0,
    dark: { resource: 0, deck: shuffle(deckFor("dark")), hand: [], discard: [] },
    government: { resource: 0, deck: shuffle(deckFor("government")), hand: [], discard: [] },
    nextGovernmentRecoveryPenalty: 0,
    activeTips: [],
    log: [],
  }
  draw(state.dark, 3)
  draw(state.government, 3)
  return startTurn(state)
}

const publicCard = (card?: CardInstance): PublicCard | undefined => {
  if (!card) return undefined
  const { instanceId: _instanceId, ...visible } = card
  return visible
}

const playerView = (player: PlayerState, revealHand: boolean): PlayerView => ({
  resource: player.resource,
  handCount: player.hand.length,
  deckCount: player.deck.length,
  discardCount: player.discard.length,
  ...(revealHand ? { hand: player.hand } : {}),
})

export const toMatchView = (
  state: GameState,
  role: Faction,
  opponentConnected: boolean,
): MatchView => ({
  revision: state.revision,
  role,
  opponentConnected,
  turn: state.turn,
  phase: state.phase,
  damage: state.damage,
  countermeasures: state.countermeasures,
  dark: playerView(state.dark, role === "dark"),
  government: playerView(state.government, role === "government"),
  pendingThreat: publicCard(state.pendingThreat),
  pendingResponse: publicCard(state.pendingResponse),
  activeTips: state.activeTips,
  lastResolution: state.lastResolution,
  log: state.log,
  winner: state.winner,
  canAct: state.phase === role,
})

const playerFor = (state: GameState, faction: Faction): PlayerState =>
  faction === "dark" ? state.dark : state.government

const expectedPhaseFor = (faction: Faction): Phase => (faction === "dark" ? "dark" : "government")

const fail = (state: GameState, error: string): TransitionResult => ({ ok: false, state, error })

const checkWinner = (state: GameState): void => {
  const darkWins = state.damage >= MAX_GAUGE
  const governmentWins = state.countermeasures >= MAX_GAUGE
  if (!darkWins && !governmentWins) return

  state.phase = "ended"
  state.winner = darkWins && governmentWins ? "draw" : darkWins ? "dark" : "government"
  addLog(
    state,
    state.winner === "draw"
      ? "両ゲージが100に到達しました。対戦は引き分けです。"
      : state.winner === "dark"
        ? "被害ゲージが100に到達。闇の組織の勝利です。"
        : "対策ゲージが100に到達。政府の勝利です。",
    "result",
  )
}

const play = (state: GameState, faction: Faction, instanceId: string): TransitionResult => {
  if (state.phase === "ended") return fail(state, "ゲームは終了しています。")
  if (state.phase !== expectedPhaseFor(faction)) return fail(state, "現在はこの陣営のフェイズではありません。")

  const next = structuredClone(state)
  const player = playerFor(next, faction)
  const cardIndex = player.hand.findIndex((card) => card.instanceId === instanceId)
  if (cardIndex < 0) return fail(state, "そのカードは手札にありません。")

  const card = player.hand[cardIndex]
  if (player.resource < card.cost) return fail(state, "リソースが不足しています。")

  player.resource -= card.cost
  player.hand.splice(cardIndex, 1)
  player.discard.push(card)
  next.activeTips = faction === "dark" ? [{ cardName: card.name, text: card.tips }] : [...next.activeTips, { cardName: card.name, text: card.tips }]

  if (faction === "dark") {
    next.pendingThreat = card
    next.phase = "government"
    addLog(next, `闇の組織が「${card.name}」をプレイしました。`, "dark")
  } else {
    next.pendingResponse = card
    next.phase = "resolution"
    addLog(next, `政府が「${card.name}」で対応します。`, "government")
  }

  return { ok: true, state: next }
}

const pass = (state: GameState, faction: Faction): TransitionResult => {
  if (state.phase === "ended") return fail(state, "ゲームは終了しています。")
  if (state.phase !== expectedPhaseFor(faction)) return fail(state, "現在はこの陣営のフェイズではありません。")

  const next = structuredClone(state)
  if (faction === "dark") {
    next.pendingThreat = undefined
    next.activeTips = []
    next.phase = "government"
    addLog(next, "闇の組織はパスしました。", "dark")
  } else {
    next.pendingResponse = undefined
    next.phase = "resolution"
    addLog(next, "政府はパスしました。", "government")
  }
  return { ok: true, state: next }
}

const resolve = (state: GameState): TransitionResult => {
  if (state.phase !== "resolution") return fail(state, "判定フェイズではありません。")

  const next = structuredClone(state)
  const threat = next.pendingThreat
  const response = next.pendingResponse
  const rawDamage = threat?.effect.damage ?? 0
  const multipliedDamage = response?.effect.damageMultiplier
    ? Math.floor(rawDamage * response.effect.damageMultiplier)
    : rawDamage
  const remainingDamage = Math.max(0, multipliedDamage - (response?.effect.flatMitigation ?? 0))
  const countermeasureGain = response?.effect.countermeasure ?? 0

  if (threat?.effect.nextBudgetRecoveryPenalty) {
    next.nextGovernmentRecoveryPenalty = Math.max(
      next.nextGovernmentRecoveryPenalty,
      threat.effect.nextBudgetRecoveryPenalty,
    )
  }

  next.damage = Math.min(MAX_GAUGE, next.damage + remainingDamage)
  next.countermeasures = Math.min(MAX_GAUGE, next.countermeasures + countermeasureGain)
  next.lastResolution = { rawDamage, remainingDamage, countermeasureGain }
  addLog(next, `判定: 被害 +${remainingDamage} / 対策 +${countermeasureGain}`, "result")
  checkWinner(next)
  return next.winner ? { ok: true, state: next } : { ok: true, state: startTurn(next) }
}

export const transition = (state: GameState, action: GameAction): TransitionResult => {
  switch (action.type) {
    case "play":
      return play(state, action.faction, action.instanceId)
    case "pass":
      return pass(state, action.faction)
    case "resolve":
      return resolve(state)
  }
}

export const phaseLabel = (phase: Phase): string =>
  ({
    dark: "闇の組織フェイズ",
    government: "政府対応フェイズ",
    resolution: "判定・処理フェイズ",
    ended: "ゲーム終了",
  })[phase]

export const factionLabel = (faction: Faction): string => (faction === "dark" ? "闇の組織" : "日本政府")
