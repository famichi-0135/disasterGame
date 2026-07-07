import assert from "node:assert/strict"
import {
  CARD_DEFINITIONS,
  createInitialGameState,
  normalizeGameState,
  toMatchView,
  transition,
  type CardInstance,
  type Faction,
  type GameState,
} from "./index.ts"

const cardInstance = (cardId: string, suffix = "test"): CardInstance => {
  const definition = CARD_DEFINITIONS.find((card) => card.id === cardId)
  assert.ok(definition)
  return { ...definition, instanceId: `${definition.id}-${suffix}` }
}

const moveCardToHand = (state: GameState, faction: Faction, cardId: string): CardInstance => {
  const player = faction === "dark" ? state.dark : state.government
  const card = [...player.hand, ...player.deck, ...player.discard, ...player.foundation, ...state.civicShields].find(
    (item) => item.id === cardId,
  ) as CardInstance | undefined
  assert.ok(card)
  player.hand = player.hand.filter((item) => item.instanceId !== card.instanceId)
  player.deck = player.deck.filter((item) => item.instanceId !== card.instanceId)
  player.discard = player.discard.filter((item) => item.instanceId !== card.instanceId)
  player.foundation = player.foundation.filter((item) => item.instanceId !== card.instanceId)
  state.civicShields = state.civicShields.filter((item) => item.instanceId !== card.instanceId)
  player.hand.push(card)
  return card
}

const playDarkCard = (state: GameState, cardId: string): GameState => {
  const card = moveCardToHand(state, "dark", cardId)
  state.dark.resource = Math.max(state.dark.resource, card.cost)
  const result = transition(state, { type: "play", faction: "dark", instanceId: card.instanceId })
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const playGovernmentCard = (state: GameState, cardId: string): GameState => {
  const card = moveCardToHand(state, "government", cardId)
  state.government.resource = Math.max(state.government.resource, card.cost)
  const result = transition(state, { type: "play", faction: "government", instanceId: card.instanceId })
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.error)
  return result.state
}

{
  const state = createInitialGameState()
  const earthquake = moveCardToHand(state, "dark", "earthquake")
  state.dark.resource = 3

  const threat = transition(state, { type: "play", faction: "dark", instanceId: earthquake.instanceId })
  assert.equal(threat.ok, true)
  if (!threat.ok) throw new Error(threat.error)
  assert.equal(threat.state.phase, "government")

  const pass = transition(threat.state, { type: "pass", faction: "government" })
  assert.equal(pass.ok, true)
  if (!pass.ok) throw new Error(pass.error)
  assert.equal(pass.state.phase, "resolution")

  const resolution = transition(pass.state, { type: "resolve" })
  assert.equal(resolution.ok, true)
  if (!resolution.ok) throw new Error(resolution.error)
  assert.equal(resolution.state.turn, 2)
}

{
  const state = createInitialGameState()
  state.civicShields = []
  const threat = playDarkCard(state, "downpour")
  const response = playGovernmentCard(threat, "seawall")

  const resolution = transition(response, { type: "resolve" })
  assert.equal(resolution.ok, true)
  if (!resolution.ok) throw new Error(resolution.error)
  assert.equal(resolution.state.damage, 0)
  assert.equal(resolution.state.countermeasures, 5)
  assert.equal(resolution.state.lastResolution?.remainingDamageBeforeShield, 0)
  assert.equal(resolution.state.lastResolution?.damageToGauge, 0)
  assert.equal(resolution.state.lastResolution?.threatLane, "flood")
  assert.equal(resolution.state.lastResolution?.responseLane, "flood")
  assert.equal(resolution.state.lastResolution?.responseMatched, true)
}

{
  const state = createInitialGameState()
  state.civicShields = []
  const threat = playDarkCard(state, "earthquake")
  const response = playGovernmentCard(threat, "seawall")

  const resolution = transition(response, { type: "resolve" })
  assert.equal(resolution.ok, true)
  if (!resolution.ok) throw new Error(resolution.error)
  assert.equal(resolution.state.damage, 15)
  assert.equal(resolution.state.countermeasures, 5)
  assert.equal(resolution.state.lastResolution?.remainingDamageBeforeShield, 15)
  assert.equal(resolution.state.lastResolution?.responseMatched, false)
}

{
  const state = createInitialGameState()
  state.civicShields = [cardInstance("stockpile", "shield")]
  const threat = playDarkCard(state, "earthquake")
  const pass = transition(threat, { type: "pass", faction: "government" })
  assert.equal(pass.ok, true)
  if (!pass.ok) throw new Error(pass.error)

  const resolution = transition(pass.state, { type: "resolve" })
  assert.equal(resolution.ok, true)
  if (!resolution.ok) throw new Error(resolution.error)
  assert.equal(resolution.state.damage, 7)
  assert.equal(resolution.state.countermeasures, 5)
  assert.equal(resolution.state.civicShields.length, 0)
  assert.equal(resolution.state.revealedShields[0]?.id, "stockpile")
  assert.equal(resolution.state.lastResolution?.shieldAbsorbed, 8)
  assert.equal(resolution.state.lastResolution?.emergencyTriggered, true)
}

{
  const state = createInitialGameState()
  state.civicShields = [cardInstance("evacuation", "shield")]
  const threat = playDarkCard(state, "earthquake")
  const pass = transition(threat, { type: "pass", faction: "government" })
  assert.equal(pass.ok, true)
  if (!pass.ok) throw new Error(pass.error)

  const resolution = transition(pass.state, { type: "resolve" })
  assert.equal(resolution.ok, true)
  if (!resolution.ok) throw new Error(resolution.error)
  assert.equal(resolution.state.damage, 3)
  assert.equal(resolution.state.lastResolution?.triggerMitigation, 8)
  assert.equal(resolution.state.lastResolution?.damageToGauge, 3)
}

{
  const state = createInitialGameState()
  const card = moveCardToHand(state, "dark", "downpour")
  const handCount = state.dark.hand.length

  const charged = transition(state, { type: "charge", faction: "dark", instanceId: card.instanceId })
  assert.equal(charged.ok, true)
  if (!charged.ok) throw new Error(charged.error)
  assert.equal(charged.state.phase, "dark")
  assert.equal(charged.state.dark.hand.length, handCount - 1)
  assert.equal(charged.state.dark.foundation.length, 1)
  assert.equal(charged.state.dark.chargedThisTurn, true)

  const secondCard = moveCardToHand(charged.state, "dark", "misinformation")
  const secondCharge = transition(charged.state, {
    type: "charge",
    faction: "dark",
    instanceId: secondCard.instanceId,
  })
  assert.equal(secondCharge.ok, false)
}

{
  const state = createInitialGameState()
  const legacyCard = CARD_DEFINITIONS.find((card) => card.id === "downpour" && card.faction === "dark")
  assert.ok(legacyCard)
  state.dark.hand = [{ ...legacyCard } as CardInstance]

  const normalized = normalizeGameState(state)
  const normalizedCard = normalized.dark.hand[0]
  assert.equal(typeof normalizedCard.instanceId, "string")

  const charged = transition(state, {
    type: "charge",
    faction: "dark",
    instanceId: normalizedCard.instanceId,
  })
  assert.equal(charged.ok, true)
  if (!charged.ok) throw new Error(charged.error)
  assert.equal(charged.state.dark.foundation.length, 1)
}

{
  const state = createInitialGameState()
  const card = moveCardToHand(state, "dark", "downpour")
  state.dark.resource = 0
  state.government.resource = 0

  const charged = transition(state, { type: "charge", faction: "dark", instanceId: card.instanceId })
  assert.equal(charged.ok, true)
  if (!charged.ok) throw new Error(charged.error)
  const darkPass = transition(charged.state, { type: "pass", faction: "dark" })
  assert.equal(darkPass.ok, true)
  if (!darkPass.ok) throw new Error(darkPass.error)
  const governmentPass = transition(darkPass.state, { type: "pass", faction: "government" })
  assert.equal(governmentPass.ok, true)
  if (!governmentPass.ok) throw new Error(governmentPass.error)
  const resolution = transition(governmentPass.state, { type: "resolve" })
  assert.equal(resolution.ok, true)
  if (!resolution.ok) throw new Error(resolution.error)
  assert.equal(resolution.state.dark.resource, 3)
  assert.equal(resolution.state.government.resource, 2)
  assert.equal(resolution.state.dark.chargedThisTurn, false)
}

{
  const state = createInitialGameState()
  const foundation = moveCardToHand(state, "dark", "misinformation")
  const threat = moveCardToHand(state, "dark", "downpour")
  state.dark.resource = threat.cost

  const charged = transition(state, { type: "charge", faction: "dark", instanceId: foundation.instanceId })
  assert.equal(charged.ok, true)
  if (!charged.ok) throw new Error(charged.error)
  const darkView = toMatchView(charged.state, "dark", true)
  assert.equal(darkView.dark.nextRecovery, 3)

  const played = transition(charged.state, { type: "play", faction: "dark", instanceId: threat.instanceId })
  assert.equal(played.ok, true)
  if (!played.ok) throw new Error(played.error)
  assert.equal(played.state.phase, "government")
  assert.equal(played.state.pendingThreat?.card.id, "downpour")
  assert.equal(played.state.dark.foundation[0]?.id, "misinformation")
}

{
  const state = createInitialGameState()
  const shield = cardInstance("stockpile", "hidden")
  state.civicShields = [shield]
  const earthquake = moveCardToHand(state, "dark", "earthquake")
  state.dark.resource = 3
  const threat = transition(state, { type: "play", faction: "dark", instanceId: earthquake.instanceId })
  assert.equal(threat.ok, true)
  if (!threat.ok) throw new Error(threat.error)
  assert.equal(threat.state.pendingThreat?.lane, "earthquake")
  assert.equal(threat.state.pendingThreat?.card.id, "earthquake")
  const darkView = toMatchView(state, "dark", true)
  assert.ok(darkView.dark.hand)
  assert.equal(darkView.government.hand, undefined)
  assert.equal(darkView.shieldCount, 1)
  assert.equal(JSON.stringify(darkView).includes(shield.instanceId), false)
}

{
  const legacy = {
    version: 1,
    turn: 1,
    phase: "dark",
    damage: 0,
    countermeasures: 0,
    dark: { resource: 3, deck: [], hand: [], discard: [] },
    government: { resource: 3, deck: [], hand: [], discard: [] },
    nextGovernmentRecoveryPenalty: 0,
    activeTips: [],
    log: [],
  }
  const normalized = normalizeGameState(legacy)
  assert.equal(normalized.version, 2)
  assert.deepEqual(normalized.dark.foundation, [])
  assert.equal(normalized.dark.chargedThisTurn, false)
  assert.deepEqual(normalized.civicShields, [])
  assert.equal(normalized.field.lanes.earthquake.threats.length, 0)
}

{
  const state = createInitialGameState()
  state.civicShields = []
  const ongoing = moveCardToHand(state, "dark", "aftershock")
  state.dark.resource = ongoing.cost

  const placed = transition(state, { type: "play", faction: "dark", instanceId: ongoing.instanceId })
  assert.equal(placed.ok, true)
  if (!placed.ok) throw new Error(placed.error)
  assert.equal(placed.state.field.lanes.earthquake.threats.length, 1)
  assert.equal(placed.state.field.lanes.earthquake.threats[0].ready, false)

  const governmentPass = transition(placed.state, { type: "pass", faction: "government" })
  assert.equal(governmentPass.ok, true)
  if (!governmentPass.ok) throw new Error(governmentPass.error)
  const firstResolution = transition(governmentPass.state, { type: "resolve" })
  assert.equal(firstResolution.ok, true)
  if (!firstResolution.ok) throw new Error(firstResolution.error)
  assert.equal(firstResolution.state.damage, 0)
  assert.equal(firstResolution.state.field.lanes.earthquake.threats[0].ready, true)

  const darkPass = transition(firstResolution.state, { type: "pass", faction: "dark" })
  assert.equal(darkPass.ok, true)
  if (!darkPass.ok) throw new Error(darkPass.error)
  const secondGovernmentPass = transition(darkPass.state, { type: "pass", faction: "government" })
  assert.equal(secondGovernmentPass.ok, true)
  if (!secondGovernmentPass.ok) throw new Error(secondGovernmentPass.error)
  const secondResolution = transition(secondGovernmentPass.state, { type: "resolve" })
  assert.equal(secondResolution.ok, true)
  if (!secondResolution.ok) throw new Error(secondResolution.error)
  assert.equal(secondResolution.state.damage, 4)
  assert.equal(secondResolution.state.lastResolution?.persistentDamage, 4)
}

{
  const state = createInitialGameState()
  state.civicShields = []
  const ongoing = moveCardToHand(state, "dark", "aftershock")
  state.dark.resource = ongoing.cost
  let next = transition(state, { type: "play", faction: "dark", instanceId: ongoing.instanceId })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)

  const defense = moveCardToHand(next.state, "government", "seismicRetrofit")
  next.state.government.resource = defense.cost
  next = transition(next.state, { type: "play", faction: "government", instanceId: defense.instanceId })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  assert.equal(next.state.field.lanes.earthquake.defenses.length, 1)
  assert.equal(next.state.field.lanes.earthquake.defenses[0].ready, false)

  next = transition(next.state, { type: "resolve" })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  assert.equal(next.state.field.lanes.earthquake.threats[0].ready, true)
  assert.equal(next.state.field.lanes.earthquake.defenses[0].ready, true)

  next = transition(next.state, { type: "pass", faction: "dark" })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  next = transition(next.state, { type: "pass", faction: "government" })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  next = transition(next.state, { type: "resolve" })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  assert.equal(next.state.damage, 0)
  assert.equal(next.state.lastResolution?.persistentDamage, 4)
  assert.equal(next.state.lastResolution?.mitigation, 4)
}

{
  const state = createInitialGameState()
  state.civicShields = []
  const threat = playDarkCard(state, "earthquake")
  const response = playGovernmentCard(threat, "furnitureAnchor")

  const resolution = transition(response, { type: "resolve" })
  assert.equal(resolution.ok, true)
  if (!resolution.ok) throw new Error(resolution.error)
  assert.equal(resolution.state.damage, 9)
  assert.equal(resolution.state.countermeasures, 3)
  assert.equal(resolution.state.lastResolution?.threatLane, "earthquake")
  assert.equal(resolution.state.lastResolution?.responseLane, "earthquake")
  assert.equal(resolution.state.lastResolution?.responseMatched, true)
  assert.equal(resolution.state.lastResolution?.mitigation, 6)
}

{
  const state = createInitialGameState()
  state.civicShields = []
  const ongoing = moveCardToHand(state, "dark", "rumorBots")
  state.dark.resource = ongoing.cost
  let next = transition(state, { type: "play", faction: "dark", instanceId: ongoing.instanceId })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  assert.equal(next.state.field.lanes.information.threats.length, 1)

  next = transition(next.state, { type: "pass", faction: "government" })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  next = transition(next.state, { type: "resolve" })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  assert.equal(next.state.field.lanes.information.threats[0].ready, true)

  next = transition(next.state, { type: "pass", faction: "dark" })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  const alert = moveCardToHand(next.state, "government", "disasterInfoAlert")
  next.state.government.resource = alert.cost
  next = transition(next.state, { type: "play", faction: "government", instanceId: alert.instanceId })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  next = transition(next.state, { type: "resolve" })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  assert.equal(next.state.damage, 0)
  assert.equal(next.state.countermeasures, 4)
  assert.equal(next.state.lastResolution?.persistentDamage, 3)
  assert.equal(next.state.lastResolution?.mitigation, 3)
  assert.equal(next.state.lastResolution?.responseMatched, true)
}

{
  const state = createInitialGameState()
  state.civicShields = []
  const ongoing = moveCardToHand(state, "dark", "riverSwelling")
  state.dark.resource = ongoing.cost
  let next = transition(state, { type: "play", faction: "dark", instanceId: ongoing.instanceId })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)

  const pumps = moveCardToHand(next.state, "government", "rainwaterPumps")
  next.state.government.resource = pumps.cost
  next = transition(next.state, { type: "play", faction: "government", instanceId: pumps.instanceId })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  assert.equal(next.state.field.lanes.flood.defenses.length, 1)

  next = transition(next.state, { type: "resolve" })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  next = transition(next.state, { type: "pass", faction: "dark" })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  next = transition(next.state, { type: "pass", faction: "government" })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  next = transition(next.state, { type: "resolve" })
  assert.equal(next.ok, true)
  if (!next.ok) throw new Error(next.error)
  assert.equal(next.state.lastResolution?.persistentDamage, 4)
  assert.equal(next.state.lastResolution?.mitigation, 4)
  assert.equal(next.state.damage, 0)
}

{
  let state = createInitialGameState()
  state.civicShields = []
  const first = moveCardToHand(state, "dark", "aftershock")
  state.dark.resource = first.cost
  let placed = transition(state, { type: "play", faction: "dark", instanceId: first.instanceId })
  assert.equal(placed.ok, true)
  if (!placed.ok) throw new Error(placed.error)
  const placedInstanceId = placed.state.field.lanes.earthquake.threats[0].instanceId
  const governmentView = toMatchView(placed.state, "government", true)
  assert.equal(JSON.stringify(governmentView.field).includes(placedInstanceId), false)
  assert.equal(JSON.stringify(governmentView.pendingThreat).includes(placedInstanceId), false)

  state = placed.state
  state.phase = "dark"
  const second = moveCardToHand(state, "dark", "aftershock")
  state.dark.resource = second.cost
  placed = transition(state, { type: "play", faction: "dark", instanceId: second.instanceId })
  assert.equal(placed.ok, true)
  if (!placed.ok) throw new Error(placed.error)
  assert.equal(placed.state.field.lanes.earthquake.threats.length, 2)

  state = placed.state
  state.phase = "dark"
  const third = moveCardToHand(state, "dark", "aftershock")
  state.dark.resource = third.cost
  const rejected = transition(state, { type: "play", faction: "dark", instanceId: third.instanceId })
  assert.equal(rejected.ok, false)
}

{
  const state = createInitialGameState()
  const card = moveCardToHand(state, "government", "stockpile")
  const result = transition(state, { type: "play", faction: "government", instanceId: card.instanceId })
  assert.equal(result.ok, false)
}

console.log("game-core tests passed")
