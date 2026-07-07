export const MAX_GAUGE = 100
export const MAX_RESOURCE = 10
export const MAX_FIELD_CARDS_PER_LANE = 2

export type Faction = "dark" | "government"
export type Phase = "dark" | "government" | "resolution" | "ended"
export type Winner = Faction | "draw"
export type Lane = "earthquake" | "flood" | "information"
export type CardPlayType = "instant" | "ongoingThreat" | "defenseUnit"

export const LANES: readonly Lane[] = ["earthquake", "flood", "information"] as const

export const laneLabel = (lane: Lane): string =>
  ({
    earthquake: "地震・建物",
    flood: "水害・気象",
    information: "情報・社会",
  })[lane]

export type EmergencyTrigger = {
  flatMitigation?: number
  damageMultiplier?: number
  countermeasure?: number
  draw?: number
  nextBudgetRecoveryBonus?: number
}

export type CardDefinition = {
  id: string
  faction: Faction
  name: string
  cost: number
  category: "disaster" | "scheme" | "countermeasure" | "education"
  summary: string
  tips: string
  lane?: Lane | "general"
  playType?: CardPlayType
  effect: {
    damage?: number
    nextBudgetRecoveryPenalty?: number
    flatMitigation?: number
    damageMultiplier?: number
    countermeasure?: number
  }
  emergencyTrigger?: EmergencyTrigger
}

export type CardInstance = CardDefinition & {
  instanceId: string
}

export type PlayerState = {
  resource: number
  deck: CardInstance[]
  hand: CardInstance[]
  discard: CardInstance[]
  foundation: CardInstance[]
  chargedThisTurn: boolean
}

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

export type PlayedCard = {
  card: CardInstance
  lane?: Lane
}

export type GameLog = {
  id: string
  turn: number
  message: string
  tone: "neutral" | "dark" | "government" | "result"
}

export type GameState = {
  version: 2
  revision: number
  turn: number
  phase: Phase
  damage: number
  countermeasures: number
  dark: PlayerState
  government: PlayerState
  pendingThreat?: PlayedCard
  pendingResponse?: PlayedCard
  nextGovernmentRecoveryPenalty: number
  nextGovernmentRecoveryBonus: number
  civicShields: CardInstance[]
  revealedShields: PublicCard[]
  field: FieldState
  activeTips: Array<{ cardName: string; text: string }>
  lastResolution?: LastResolution
  log: GameLog[]
  winner?: Winner
}

export type PublicCard = Omit<CardInstance, "instanceId">

export type PublicFieldCard = Omit<FieldCard, "instanceId">

export type PublicLaneState = {
  threats: PublicFieldCard[]
  defenses: PublicFieldCard[]
}

export type PublicFieldState = {
  lanes: Record<Lane, PublicLaneState>
}

export type PublicPlayedCard = {
  card: PublicCard
  lane?: Lane
}

export type LastResolution = {
  rawDamage: number
  persistentDamage: number
  mitigation: number
  triggerMitigation: number
  remainingDamageBeforeShield: number
  shieldAbsorbed: number
  damageToGauge: number
  countermeasureGain: number
  threatLane?: Lane
  responseLane?: Lane
  responseMatched: boolean
  revealedShield?: PublicCard
  emergencyTriggered: boolean
}

export type PlayerView = {
  resource: number
  nextRecovery: number
  handCount: number
  deckCount: number
  discardCount: number
  foundationCount: number
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
  pendingThreat?: PublicPlayedCard
  pendingResponse?: PublicPlayedCard
  shieldCount: number
  revealedShields: PublicCard[]
  field: PublicFieldState
  activeTips: GameState["activeTips"]
  lastResolution?: GameState["lastResolution"]
  log: GameLog[]
  winner?: Winner
  canAct: boolean
  canCharge: boolean
}

export type GameAction =
  | { type: "charge"; faction: Faction; instanceId: string }
  | { type: "play"; faction: Faction; instanceId: string; lane?: Lane }
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
    lane: "earthquake",
    playType: "instant",
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
    lane: "information",
    playType: "instant",
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
    lane: "flood",
    playType: "instant",
    effect: { damage: 10 },
  },
  {
    id: "aftershock",
    faction: "dark",
    name: "余震連鎖",
    cost: 2,
    category: "disaster",
    summary: "地震レーンに継続脅威 +4",
    tips: "大きな地震の後は余震にも備え、倒れやすい物から離れましょう。",
    lane: "earthquake",
    playType: "ongoingThreat",
    effect: { damage: 4 },
  },
  {
    id: "riverSwelling",
    faction: "dark",
    name: "河川増水",
    cost: 2,
    category: "disaster",
    summary: "水害レーンに継続脅威 +4",
    tips: "河川の水位情報を確認し、危険を感じる前に避難を始めましょう。",
    lane: "flood",
    playType: "ongoingThreat",
    effect: { damage: 4 },
  },
  {
    id: "rumorBots",
    faction: "dark",
    name: "デマ増幅ボット",
    cost: 2,
    category: "scheme",
    summary: "情報レーンに継続脅威 +3",
    tips: "災害時は拡散前に発信元を確認し、公式情報と照合しましょう。",
    lane: "information",
    playType: "ongoingThreat",
    effect: { damage: 3 },
  },
  {
    id: "seawall",
    faction: "government",
    name: "防潮堤の強化",
    cost: 3,
    category: "countermeasure",
    summary: "このターンの災害威力 -10 / 対策 +5",
    tips: "ハード面の対策は、被害を物理的に軽減します。",
    lane: "flood",
    playType: "instant",
    effect: { flatMitigation: 10, countermeasure: 5 },
    emergencyTrigger: { flatMitigation: 5 },
  },
  {
    id: "evacuation",
    faction: "government",
    name: "緊急避難指示",
    cost: 2,
    category: "countermeasure",
    summary: "このターンの災害威力を半減 / 対策 +2",
    tips: "早期の避難行動が命を救います。避難情報を確認しましょう。",
    lane: "general",
    playType: "instant",
    effect: { damageMultiplier: 0.5, countermeasure: 2 },
    emergencyTrigger: { damageMultiplier: 0.5 },
  },
  {
    id: "stockpile",
    faction: "government",
    name: "備蓄キャンペーン",
    cost: 1,
    category: "education",
    summary: "対策ゲージ +10",
    tips: "最低3日分の水と食料を備蓄し、定期的に入れ替えましょう。",
    lane: "general",
    playType: "instant",
    effect: { countermeasure: 10 },
    emergencyTrigger: { countermeasure: 5 },
  },
  {
    id: "furnitureAnchor",
    faction: "government",
    name: "家具固定支援",
    cost: 2,
    category: "countermeasure",
    summary: "地震レーンの災害威力 -6 / 対策 +3",
    tips: "家具や家電を固定し、寝室や避難経路に倒れ込まない配置にしましょう。",
    lane: "earthquake",
    playType: "instant",
    effect: { flatMitigation: 6, countermeasure: 3 },
  },
  {
    id: "rainwaterPumps",
    faction: "government",
    name: "排水ポンプ配備",
    cost: 2,
    category: "countermeasure",
    summary: "水害レーンに防災ユニット -4",
    tips: "排水設備の点検や側溝清掃は、短時間強雨の浸水リスクを下げます。",
    lane: "flood",
    playType: "defenseUnit",
    effect: { flatMitigation: 4 },
  },
  {
    id: "seismicRetrofit",
    faction: "government",
    name: "耐震補強チーム",
    cost: 2,
    category: "countermeasure",
    summary: "地震レーンに防災ユニット -4",
    tips: "耐震補強は建物の倒壊リスクを下げ、避難時間を確保します。",
    lane: "earthquake",
    playType: "defenseUnit",
    effect: { flatMitigation: 4 },
  },
  {
    id: "officialAlert",
    faction: "government",
    name: "公式情報アラート",
    cost: 2,
    category: "education",
    summary: "情報レーンに防災ユニット -4",
    tips: "自治体や気象庁など、信頼できる公式情報を確認しましょう。",
    lane: "information",
    playType: "defenseUnit",
    effect: { flatMitigation: 4 },
  },
  {
    id: "disasterInfoAlert",
    faction: "government",
    name: "災害情報アラート",
    cost: 2,
    category: "education",
    summary: "情報レーンの混乱 -5 / 対策 +4",
    tips: "自治体、防災アプリ、気象庁など複数の公式経路を確認できるようにしましょう。",
    lane: "information",
    playType: "instant",
    effect: { flatMitigation: 5, countermeasure: 4 },
    emergencyTrigger: { nextBudgetRecoveryBonus: 1 },
  },
] as const

const deckFor = (faction: Faction): CardInstance[] =>
  CARD_DEFINITIONS.filter((card) => card.faction === faction).flatMap((card) =>
    Array.from({ length: 3 }, (_, copy) => ({ ...card, instanceId: `${card.id}-${copy + 1}` })),
  )

const createEmptyField = (): FieldState => ({
  lanes: {
    earthquake: { threats: [], defenses: [] },
    flood: { threats: [], defenses: [] },
    information: { threats: [], defenses: [] },
  },
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object"

const isLane = (value: unknown): value is Lane =>
  value === "earthquake" || value === "flood" || value === "information"

const laneFromCard = (card: { lane?: Lane | "general" }): Lane | undefined =>
  isLane(card.lane) ? card.lane : undefined

const arrayOrEmpty = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

const cardDefinitionFor = (id: string): CardDefinition | undefined =>
  CARD_DEFINITIONS.find((card) => card.id === id)

const normalizeCardInstance = (value: unknown, fallbackInstanceId: string): CardInstance | undefined => {
  if (!isRecord(value)) return undefined
  const id = typeof value.id === "string" ? value.id : undefined
  if (!id) return undefined

  const definition = cardDefinitionFor(id)
  const instanceId =
    typeof value.instanceId === "string" && value.instanceId.length > 0
      ? value.instanceId
      : fallbackInstanceId

  return {
    ...(definition ?? (value as CardDefinition)),
    ...value,
    instanceId,
  } as CardInstance
}

const normalizeCardInstances = (value: unknown, scope: string): CardInstance[] =>
  arrayOrEmpty<unknown>(value).flatMap((item, index) => {
    const card = normalizeCardInstance(item, `${scope}-${index + 1}`)
    return card ? [card] : []
  })

const normalizePlayedCard = (value: unknown, scope: string): PlayedCard | undefined => {
  if (!isRecord(value)) return undefined

  if (isRecord(value.card)) {
    const card = normalizeCardInstance(value.card, `${scope}-card`)
    if (!card) return undefined
    return { card, lane: isLane(value.lane) ? value.lane : laneFromCard(card) }
  }

  const legacyCard = normalizeCardInstance(value, `${scope}-legacy`)
  if (!legacyCard) return undefined
  return { card: legacyCard, lane: laneFromCard(legacyCard) }
}

const normalizePlayer = (value: unknown, scope: string): PlayerState => {
  const player = isRecord(value) ? value : {}
  return {
    resource: typeof player.resource === "number" ? player.resource : 0,
    deck: normalizeCardInstances(player.deck, `${scope}-deck`),
    hand: normalizeCardInstances(player.hand, `${scope}-hand`),
    discard: normalizeCardInstances(player.discard, `${scope}-discard`),
    foundation: normalizeCardInstances(player.foundation, `${scope}-foundation`),
    chargedThisTurn: player.chargedThisTurn === true,
  }
}

const normalizeFieldCard = (
  value: unknown,
  lane: Lane,
  owner: Faction,
  scope: string,
): FieldCard | undefined => {
  const card = normalizeCardInstance(value, scope)
  if (!card) return undefined
  const fieldCard = isRecord(value) ? value : {}
  return {
    ...card,
    lane,
    owner,
    ready: fieldCard.ready === true,
    exhausted: fieldCard.exhausted === true,
  }
}

const normalizeField = (value: unknown): FieldState => {
  const field = isRecord(value) ? value : {}
  const lanes = isRecord(field.lanes) ? field.lanes : {}
  const next = createEmptyField()

  for (const lane of LANES) {
    const laneValue = isRecord(lanes[lane]) ? lanes[lane] : {}
    next.lanes[lane] = {
      threats: arrayOrEmpty<unknown>(laneValue.threats).flatMap((card, index) => {
        const normalized = normalizeFieldCard(card, lane, "dark", `field-${lane}-threat-${index + 1}`)
        return normalized ? [normalized] : []
      }),
      defenses: arrayOrEmpty<unknown>(laneValue.defenses).flatMap((card, index) => {
        const normalized = normalizeFieldCard(card, lane, "government", `field-${lane}-defense-${index + 1}`)
        return normalized ? [normalized] : []
      }),
    }
  }

  return next
}

const normalizeLastResolution = (value: unknown): LastResolution | undefined => {
  if (!isRecord(value)) return undefined
  const rawDamage = typeof value.rawDamage === "number" ? value.rawDamage : 0
  const legacyRemainingDamage =
    typeof value.remainingDamage === "number" ? value.remainingDamage : undefined
  const damageToGauge =
    typeof value.damageToGauge === "number" ? value.damageToGauge : (legacyRemainingDamage ?? 0)
  const remainingDamageBeforeShield =
    typeof value.remainingDamageBeforeShield === "number"
      ? value.remainingDamageBeforeShield
      : (legacyRemainingDamage ?? damageToGauge)

  return {
    rawDamage,
    persistentDamage: typeof value.persistentDamage === "number" ? value.persistentDamage : 0,
    mitigation:
      typeof value.mitigation === "number"
        ? value.mitigation
        : Math.max(0, rawDamage - remainingDamageBeforeShield),
    triggerMitigation: typeof value.triggerMitigation === "number" ? value.triggerMitigation : 0,
    remainingDamageBeforeShield,
    shieldAbsorbed: typeof value.shieldAbsorbed === "number" ? value.shieldAbsorbed : 0,
    damageToGauge,
    countermeasureGain: typeof value.countermeasureGain === "number" ? value.countermeasureGain : 0,
    threatLane: isLane(value.threatLane) ? value.threatLane : undefined,
    responseLane: isLane(value.responseLane) ? value.responseLane : undefined,
    responseMatched: value.responseMatched === true,
    revealedShield: isRecord(value.revealedShield) ? (value.revealedShield as PublicCard) : undefined,
    emergencyTriggered: value.emergencyTriggered === true,
  }
}

export const normalizeGameState = (value: unknown): GameState => {
  const state = isRecord(value) ? value : {}
  const phase =
    state.phase === "dark" || state.phase === "government" || state.phase === "resolution" || state.phase === "ended"
      ? state.phase
      : "dark"
  const winner =
    state.winner === "dark" || state.winner === "government" || state.winner === "draw"
      ? state.winner
      : undefined

  return {
    version: 2,
    revision: typeof state.revision === "number" ? state.revision : 0,
    turn: typeof state.turn === "number" ? state.turn : 0,
    phase,
    damage: typeof state.damage === "number" ? state.damage : 0,
    countermeasures: typeof state.countermeasures === "number" ? state.countermeasures : 0,
    dark: normalizePlayer(state.dark, "dark"),
    government: normalizePlayer(state.government, "government"),
    pendingThreat: normalizePlayedCard(state.pendingThreat, "pending-threat"),
    pendingResponse: normalizePlayedCard(state.pendingResponse, "pending-response"),
    nextGovernmentRecoveryPenalty:
      typeof state.nextGovernmentRecoveryPenalty === "number" ? state.nextGovernmentRecoveryPenalty : 0,
    nextGovernmentRecoveryBonus:
      typeof state.nextGovernmentRecoveryBonus === "number" ? state.nextGovernmentRecoveryBonus : 0,
    civicShields: normalizeCardInstances(state.civicShields, "civic-shield"),
    revealedShields: arrayOrEmpty<PublicCard>(state.revealedShields),
    field: normalizeField(state.field),
    activeTips: arrayOrEmpty<{ cardName: string; text: string }>(state.activeTips),
    lastResolution: normalizeLastResolution(state.lastResolution),
    log: arrayOrEmpty<GameLog>(state.log),
    winner,
  }
}

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

const rawResourceRecoveryFor = (state: GameState, faction: Faction): number => {
  const player = faction === "dark" ? state.dark : state.government
  const baseRecovery = 2 + player.foundation.length
  if (faction === "dark") return baseRecovery
  return Math.max(
    0,
    baseRecovery - state.nextGovernmentRecoveryPenalty + state.nextGovernmentRecoveryBonus,
  )
}

const nextResourceGainFor = (state: GameState, faction: Faction): number => {
  const player = faction === "dark" ? state.dark : state.government
  return Math.max(0, Math.min(MAX_RESOURCE - player.resource, rawResourceRecoveryFor(state, faction)))
}

const readyFieldCards = (field: FieldState): void => {
  for (const lane of LANES) {
    for (const card of [...field.lanes[lane].threats, ...field.lanes[lane].defenses]) {
      card.ready = true
      card.exhausted = false
    }
  }
}

const startTurn = (state: GameState): GameState => {
  const next = structuredClone(normalizeGameState(state))
  next.turn += 1
  next.phase = "dark"
  next.pendingThreat = undefined
  next.pendingResponse = undefined
  readyFieldCards(next.field)
  next.dark.chargedThisTurn = false
  next.government.chargedThisTurn = false
  const darkRecovery = rawResourceRecoveryFor(next, "dark")
  const governmentRecovery = rawResourceRecoveryFor(next, "government")
  next.dark.resource = Math.min(MAX_RESOURCE, next.dark.resource + darkRecovery)
  next.government.resource = Math.min(MAX_RESOURCE, next.government.resource + governmentRecovery)
  next.nextGovernmentRecoveryPenalty = 0
  next.nextGovernmentRecoveryBonus = 0
  draw(next.dark, 1)
  draw(next.government, 1)
  addLog(next, `第${next.turn}ターン開始。両陣営がリソースを回復し、カードを1枚ドローしました。`, "neutral")
  return next
}

export const createInitialGameState = (): GameState => {
  const governmentDeck = shuffle(deckFor("government"))
  const civicShields = Array.from({ length: 5 }, () => governmentDeck.pop()).filter(
    (card): card is CardInstance => Boolean(card),
  )
  const state: GameState = {
    version: 2,
    revision: 0,
    turn: 0,
    phase: "dark",
    damage: 0,
    countermeasures: 0,
    dark: { resource: 0, deck: shuffle(deckFor("dark")), hand: [], discard: [], foundation: [], chargedThisTurn: false },
    government: { resource: 0, deck: governmentDeck, hand: [], discard: [], foundation: [], chargedThisTurn: false },
    nextGovernmentRecoveryPenalty: 0,
    nextGovernmentRecoveryBonus: 0,
    civicShields,
    revealedShields: [],
    field: createEmptyField(),
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

const publicPlayedCard = (played?: PlayedCard): PublicPlayedCard | undefined => {
  const card = publicCard(played?.card)
  if (!card) return undefined
  return { card, lane: played?.lane }
}

const publicFieldCard = (card: FieldCard): PublicFieldCard => {
  const { instanceId: _instanceId, ...visible } = card
  return visible
}

const publicField = (field: FieldState): PublicFieldState => ({
  lanes: {
    earthquake: {
      threats: field.lanes.earthquake.threats.map(publicFieldCard),
      defenses: field.lanes.earthquake.defenses.map(publicFieldCard),
    },
    flood: {
      threats: field.lanes.flood.threats.map(publicFieldCard),
      defenses: field.lanes.flood.defenses.map(publicFieldCard),
    },
    information: {
      threats: field.lanes.information.threats.map(publicFieldCard),
      defenses: field.lanes.information.defenses.map(publicFieldCard),
    },
  },
})

const playerView = (
  state: GameState,
  faction: Faction,
  revealHand: boolean,
): PlayerView => {
  const player = playerFor(state, faction)
  return {
  resource: player.resource,
  nextRecovery: nextResourceGainFor(state, faction),
  handCount: player.hand.length,
  deckCount: player.deck.length,
  discardCount: player.discard.length,
  foundationCount: player.foundation.length,
  ...(revealHand ? { hand: player.hand } : {}),
  }
}

export const toMatchView = (
  state: GameState,
  role: Faction,
  opponentConnected: boolean,
): MatchView => {
  const normalized = normalizeGameState(state)
  return {
    revision: normalized.revision,
    role,
    opponentConnected,
    turn: normalized.turn,
    phase: normalized.phase,
    damage: normalized.damage,
    countermeasures: normalized.countermeasures,
    dark: playerView(normalized, "dark", role === "dark"),
    government: playerView(normalized, "government", role === "government"),
    pendingThreat: publicPlayedCard(normalized.pendingThreat),
    pendingResponse: publicPlayedCard(normalized.pendingResponse),
    shieldCount: normalized.civicShields.length,
    revealedShields: normalized.revealedShields,
    field: publicField(normalized.field),
    activeTips: normalized.activeTips,
    lastResolution: normalized.lastResolution,
    log: normalized.log,
    winner: normalized.winner,
    canAct: normalized.phase === role,
    canCharge: normalized.phase === role && !playerFor(normalized, role).chargedThisTurn,
  }
}

const playerFor = (state: GameState, faction: Faction): PlayerState =>
  faction === "dark" ? state.dark : state.government

const expectedPhaseFor = (faction: Faction): Phase => (faction === "dark" ? "dark" : "government")

const fail = (state: GameState, error: string): TransitionResult => ({ ok: false, state, error })

const playTypeOf = (card: CardDefinition): CardPlayType => card.playType ?? "instant"

const resolvePlayLane = (card: CardInstance, requestedLane?: Lane): Lane | undefined => {
  const definitionLane = laneFromCard(card)
  if (definitionLane) return definitionLane
  return requestedLane
}

const fieldCardFrom = (card: CardInstance, lane: Lane, owner: Faction): FieldCard => ({
  ...card,
  lane,
  owner,
  ready: false,
  exhausted: false,
})

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

const charge = (state: GameState, faction: Faction, instanceId: string): TransitionResult => {
  const base = normalizeGameState(state)
  if (base.phase === "ended") return fail(base, "ゲームは終了しています。")
  if (base.phase !== expectedPhaseFor(faction)) return fail(base, "現在はこの陣営のフェイズではありません。")

  const next = structuredClone(base)
  const player = playerFor(next, faction)
  if (player.chargedThisTurn) return fail(base, "このターンはすでに基盤化しています。")

  const cardIndex = player.hand.findIndex((card) => card.instanceId === instanceId)
  if (cardIndex < 0) return fail(base, "そのカードは手札にありません。")

  const [card] = player.hand.splice(cardIndex, 1)
  player.foundation.push(card)
  player.chargedThisTurn = true
  addLog(next, `${factionLabel(faction)}が「${card.name}」を基盤化しました。`, faction)
  return { ok: true, state: next }
}

const play = (state: GameState, faction: Faction, instanceId: string, requestedLane?: Lane): TransitionResult => {
  const base = normalizeGameState(state)
  if (base.phase === "ended") return fail(base, "ゲームは終了しています。")
  if (base.phase !== expectedPhaseFor(faction)) return fail(base, "現在はこの陣営のフェイズではありません。")

  const next = structuredClone(base)
  const player = playerFor(next, faction)
  const cardIndex = player.hand.findIndex((card) => card.instanceId === instanceId)
  if (cardIndex < 0) return fail(base, "そのカードは手札にありません。")

  const card = player.hand[cardIndex]
  if (player.resource < card.cost) return fail(base, "リソースが不足しています。")
  const definitionLane = laneFromCard(card)
  if (requestedLane && definitionLane && requestedLane !== definitionLane) {
    return fail(base, `「${card.name}」は${laneLabel(definitionLane)}レーンのカードです。`)
  }

  const playType = playTypeOf(card)
  const resolvedLane = resolvePlayLane(card, requestedLane)
  if ((playType === "ongoingThreat" || playType === "defenseUnit") && !resolvedLane) {
    return fail(base, "場に残るカードには対象レーンが必要です。")
  }
  if (playType === "ongoingThreat" && faction !== "dark") {
    return fail(base, "継続脅威は闇の組織だけが配置できます。")
  }
  if (playType === "defenseUnit" && faction !== "government") {
    return fail(base, "防災ユニットは政府だけが配置できます。")
  }
  if (playType === "ongoingThreat" && resolvedLane) {
    const laneState = next.field.lanes[resolvedLane]
    if (laneState.threats.length >= MAX_FIELD_CARDS_PER_LANE) {
      return fail(base, `${laneLabel(resolvedLane)}レーンの継続脅威は上限です。`)
    }
  }
  if (playType === "defenseUnit" && resolvedLane) {
    const laneState = next.field.lanes[resolvedLane]
    if (laneState.defenses.length >= MAX_FIELD_CARDS_PER_LANE) {
      return fail(base, `${laneLabel(resolvedLane)}レーンの防災ユニットは上限です。`)
    }
  }

  player.resource -= card.cost
  player.hand.splice(cardIndex, 1)
  next.activeTips = faction === "dark" ? [{ cardName: card.name, text: card.tips }] : [...next.activeTips, { cardName: card.name, text: card.tips }]

  if (faction === "dark") {
    if (playType === "ongoingThreat" && resolvedLane) {
      next.field.lanes[resolvedLane].threats.push(fieldCardFrom(card, resolvedLane, faction))
      next.pendingThreat = { card, lane: resolvedLane }
    } else {
      player.discard.push(card)
      next.pendingThreat = { card, lane: resolvedLane }
    }
    next.phase = "government"
    addLog(
      next,
      playType === "ongoingThreat" && resolvedLane
        ? `闇の組織が${laneLabel(resolvedLane)}レーンに「${card.name}」を配置しました。`
        : `闇の組織が「${card.name}」をプレイしました。`,
      "dark",
    )
  } else {
    if (playType === "defenseUnit" && resolvedLane) {
      next.field.lanes[resolvedLane].defenses.push(fieldCardFrom(card, resolvedLane, faction))
      next.pendingResponse = { card, lane: resolvedLane }
    } else {
      player.discard.push(card)
      next.pendingResponse = { card, lane: resolvedLane }
    }
    next.phase = "resolution"
    addLog(
      next,
      playType === "defenseUnit" && resolvedLane
        ? `政府が${laneLabel(resolvedLane)}レーンに「${card.name}」を配置しました。`
        : `政府が「${card.name}」で対応します。`,
      "government",
    )
  }

  return { ok: true, state: next }
}

const pass = (state: GameState, faction: Faction): TransitionResult => {
  const base = normalizeGameState(state)
  if (base.phase === "ended") return fail(base, "ゲームは終了しています。")
  if (base.phase !== expectedPhaseFor(faction)) return fail(base, "現在はこの陣営のフェイズではありません。")

  const next = structuredClone(base)
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

const applyDamageMultiplier = (damage: number, multiplier?: number): number =>
  typeof multiplier === "number" ? Math.floor(damage * multiplier) : damage

const applyFlatMitigation = (damage: number, mitigation?: number): number =>
  Math.max(0, damage - (mitigation ?? 0))

const emptyLaneValues = (): Record<Lane, number> => ({
  earthquake: 0,
  flood: 0,
  information: 0,
})

const sumLaneValues = (values: Record<Lane, number>): number =>
  LANES.reduce((total, lane) => total + values[lane], 0)

const readyThreatDamageByLane = (field: FieldState): Record<Lane, number> => {
  const values = emptyLaneValues()
  for (const lane of LANES) {
    values[lane] = field.lanes[lane].threats
      .filter((card) => card.ready)
      .reduce((total, card) => total + (card.effect.damage ?? 0), 0)
  }
  return values
}

const readyDefenseMitigationByLane = (field: FieldState): Record<Lane, number> => {
  const values = emptyLaneValues()
  for (const lane of LANES) {
    values[lane] = field.lanes[lane].defenses
      .filter((card) => card.ready)
      .reduce((total, card) => total + (card.effect.flatMitigation ?? 0), 0)
  }
  return values
}

const resolve = (state: GameState): TransitionResult => {
  const base = normalizeGameState(state)
  if (base.phase !== "resolution") return fail(base, "判定フェイズではありません。")

  const next = structuredClone(base)
  const threatPlay = next.pendingThreat
  const responsePlay = next.pendingResponse
  const threat = threatPlay?.card
  const response = responsePlay?.card
  const threatLane = threatPlay?.lane
  const responseLane = responsePlay?.lane
  const laneDamage = readyThreatDamageByLane(next.field)
  const persistentDamage = sumLaneValues(laneDamage)
  let globalDamage = 0

  if (threat && playTypeOf(threat) === "instant") {
    const threatDamage = threat.effect.damage ?? 0
    if (threatLane) laneDamage[threatLane] += threatDamage
    else globalDamage += threatDamage
  }

  const rawDamage = globalDamage + sumLaneValues(laneDamage)
  let responseMitigation = 0
  let responseMatched = false
  const isInstantResponse = Boolean(response && playTypeOf(response) === "instant")

  if (response && isInstantResponse && responseLane) {
    const before = laneDamage[responseLane]
    let after = applyDamageMultiplier(before, response.effect.damageMultiplier)
    after = applyFlatMitigation(after, response.effect.flatMitigation)
    responseMitigation += before - after
    responseMatched = before > 0
    laneDamage[responseLane] = after
  }

  const fieldMitigationByLane = readyDefenseMitigationByLane(next.field)
  let fieldMitigation = 0
  for (const lane of LANES) {
    const before = laneDamage[lane]
    laneDamage[lane] = applyFlatMitigation(laneDamage[lane], fieldMitigationByLane[lane])
    fieldMitigation += before - laneDamage[lane]
  }

  let remainingDamageBeforeShield = globalDamage + sumLaneValues(laneDamage)
  if (response && isInstantResponse && !responseLane) {
    const before = remainingDamageBeforeShield
    let after = applyDamageMultiplier(before, response.effect.damageMultiplier)
    after = applyFlatMitigation(after, response.effect.flatMitigation)
    responseMitigation += before - after
    responseMatched = before > 0
    remainingDamageBeforeShield = after
  }

  const mitigation = Math.max(0, responseMitigation + fieldMitigation)
  let countermeasureGain = response?.effect.countermeasure ?? 0
  let triggerMitigation = 0
  let damageAfterTrigger = remainingDamageBeforeShield
  let revealedShield: PublicCard | undefined
  let emergencyTriggered = false
  let shieldAbsorbed = 0
  let damageToGauge = remainingDamageBeforeShield

  if (threat && playTypeOf(threat) === "instant" && threat.effect.nextBudgetRecoveryPenalty) {
    next.nextGovernmentRecoveryPenalty = Math.max(
      next.nextGovernmentRecoveryPenalty,
      threat.effect.nextBudgetRecoveryPenalty,
    )
  }

  if (remainingDamageBeforeShield > 0 && next.civicShields.length > 0) {
    const shield = next.civicShields.shift()
    if (shield) {
      const visibleShield = publicCard(shield)
      if (!visibleShield) return fail(base, "防災シールドの公開に失敗しました。")
      revealedShield = visibleShield
      next.revealedShields = [revealedShield, ...next.revealedShields].slice(0, 5)
      next.government.discard.push(shield)

      const trigger = shield.emergencyTrigger
      if (trigger) {
        emergencyTriggered = true
        const beforeMultiplier = damageAfterTrigger
        damageAfterTrigger = applyDamageMultiplier(damageAfterTrigger, trigger.damageMultiplier)
        triggerMitigation += beforeMultiplier - damageAfterTrigger

        const beforeFlat = damageAfterTrigger
        damageAfterTrigger = applyFlatMitigation(damageAfterTrigger, trigger.flatMitigation)
        triggerMitigation += beforeFlat - damageAfterTrigger

        countermeasureGain += trigger.countermeasure ?? 0
        next.nextGovernmentRecoveryBonus = Math.max(
          next.nextGovernmentRecoveryBonus,
          trigger.nextBudgetRecoveryBonus ?? 0,
        )
        if (trigger.draw) draw(next.government, trigger.draw)
        next.activeTips = [...next.activeTips, { cardName: shield.name, text: shield.tips }]
        addLog(next, `防災シールドから「${shield.name}」が発動しました。`, "government")
      } else {
        next.activeTips = [...next.activeTips, { cardName: shield.name, text: shield.tips }]
        addLog(next, `防災シールド「${shield.name}」を公開しました。`, "government")
      }
    }
  }

  if (revealedShield) {
    damageToGauge = Math.floor(damageAfterTrigger / 2)
    shieldAbsorbed = damageAfterTrigger - damageToGauge
  } else {
    damageToGauge = damageAfterTrigger
  }

  next.damage = Math.min(MAX_GAUGE, next.damage + damageToGauge)
  next.countermeasures = Math.min(MAX_GAUGE, next.countermeasures + countermeasureGain)
  next.lastResolution = {
    rawDamage,
    persistentDamage,
    mitigation,
    triggerMitigation,
    remainingDamageBeforeShield,
    shieldAbsorbed,
    damageToGauge,
    countermeasureGain,
    threatLane,
    responseLane,
    responseMatched,
    revealedShield,
    emergencyTriggered,
  }
  addLog(next, `判定: 被害 +${damageToGauge} / 対策 +${countermeasureGain}`, "result")
  checkWinner(next)
  return next.winner ? { ok: true, state: next } : { ok: true, state: startTurn(next) }
}

export const transition = (state: GameState, action: GameAction): TransitionResult => {
  switch (action.type) {
    case "charge":
      return charge(state, action.faction, action.instanceId)
    case "play":
      return play(state, action.faction, action.instanceId, action.lane)
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
