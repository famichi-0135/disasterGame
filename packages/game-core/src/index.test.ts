import assert from "node:assert/strict"
import { createInitialGameState, toMatchView, transition, type CardInstance } from "./index.ts"

const moveCardToHand = (state: ReturnType<typeof createInitialGameState>, faction: "dark" | "government", cardId: string) => {
  const player = faction === "dark" ? state.dark : state.government
  const card = [...player.hand, ...player.deck].find((item) => item.id === cardId) as CardInstance
  assert.ok(card)
  player.hand = player.hand.filter((item) => item.instanceId !== card.instanceId)
  player.deck = player.deck.filter((item) => item.instanceId !== card.instanceId)
  player.hand.push(card)
  return card
}

const state = createInitialGameState()
const earthquake = moveCardToHand(state, "dark", "earthquake")
const seawall = moveCardToHand(state, "government", "seawall")
state.dark.resource = 3
state.government.resource = 3

const threat = transition(state, { type: "play", faction: "dark", instanceId: earthquake.instanceId })
assert.equal(threat.ok, true)
if (!threat.ok) throw new Error(threat.error)
assert.equal(threat.state.phase, "government")

const response = transition(threat.state, { type: "play", faction: "government", instanceId: seawall.instanceId })
assert.equal(response.ok, true)
if (!response.ok) throw new Error(response.error)

const resolution = transition(response.state, { type: "resolve" })
assert.equal(resolution.ok, true)
if (!resolution.ok) throw new Error(resolution.error)
assert.equal(resolution.state.damage, 5)
assert.equal(resolution.state.countermeasures, 5)

const darkView = toMatchView(resolution.state, "dark", true)
assert.ok(darkView.dark.hand)
assert.equal(darkView.government.hand, undefined)
assert.equal(JSON.stringify(darkView.government).includes("seawall-"), false)
assert.equal(darkView.pendingThreat, undefined)

console.log("game-core tests passed")
