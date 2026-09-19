import { REF_CURVE, REF_RECIPE, type Curve, type Recipe } from './balance'
import { mulberry32 } from './rng'
import { searchFiring } from './search'
import { TARGETS } from './targets'
import { ECONOMY, accept, fireCost, fireKiln, outstanding, type Loading, type RunState } from './run'

/** 7 个目标各预解一次，策略只查表；否则 200 局模拟会卡在搜索器上 */
const SOLUTIONS: Array<{ recipe: Recipe; curve: Curve }> = TARGETS.map((t) => {
  const s = searchFiring(t.lab, 60, 20260919)
  return { recipe: s.recipe, curve: s.curve }
})

const BLANK: Loading = { recipe: { ...REF_RECIPE }, curve: { ...REF_CURVE }, orderIds: [] }

interface Pending {
  orderId: number
  targetIndex: number
  left: number
  price: number
  deadline: number
}

function pending(state: RunState): Pending[] {
  return state.accepted
    .map((o) => ({
      orderId: o.id,
      targetIndex: o.targetIndex,
      left: outstanding(state, o.id),
      price: o.pricePerPiece,
      deadline: o.deadlineKiln,
    }))
    .filter((x) => x.left > 0)
}

/** 按给定顺序把件装进窑，最多 capacity 件 */
function loadFrom(ranked: Pending[]): Loading {
  const orderIds: number[] = []
  for (const p of ranked) {
    for (let i = 0; i < p.left && orderIds.length < ECONOMY.capacity; i++) orderIds.push(p.orderId)
    if (orderIds.length >= ECONOMY.capacity) break
  }
  return { recipe: { ...REF_RECIPE }, curve: { ...REF_CURVE }, orderIds }
}

function acceptAll(state: RunState): RunState {
  return state.offers.reduce((s, o) => accept(s, o.id), state)
}

function withSolution(loading: Loading, targetIndex: number): Loading {
  const sol = SOLUTIONS[targetIndex]
  return { ...loading, recipe: { ...sol.recipe }, curve: { ...sol.curve } }
}

export interface Policy {
  name: string
  /** 走一窑：先决定接哪些单，再决定装窑与烧成 */
  play: (state: RunState) => RunState
}

/** 躺平：不接单，每窑烧空。这是"什么都不调"的下限基线 */
const idle: Policy = {
  name: '躺平',
  play: (s) => fireKiln(s, BLANK),
}

/** 乱烧：来单就接，配方与曲线全随机。这是运气基线 */
const random: Policy = {
  name: '乱烧',
  play: (raw) => {
    const state = acceptAll(raw)
    const rnd = mulberry32(state.seed * 31 + state.kiln)
    const recipe: Recipe = {
      fe: rnd() * 8,
      cu: rnd() * 4,
      co: rnd() * 2,
      flux: 0.15 + rnd() * 0.3,
    }
    const curve: Curve = {
      tmax: 1150 + rnd() * 180,
      soak: rnd() * 60,
      reduction: rnd(),
      reductionStart: 900 + rnd() * 350,
      cooling: 0.5 + rnd() * 9.5,
    }
    const ranked = pending(state).sort((a, b) => a.deadline - b.deadline)
    const loading = loadFrom(ranked)
    return fireKiln(state, { ...loading, recipe, curve })
  },
}

/** 一法到底：只掌握一套配方（天青解），谁来单都烧这个。这是"固定策略"的代表 */
const fixed: Policy = {
  name: '一法到底',
  play: (raw) => {
    const state = acceptAll(raw)
    const ranked = pending(state).sort((a, b) => a.deadline - b.deadline)
    const loading = loadFrom(ranked)
    return fireKiln(state, withSolution(loading, 0))
  },
}

/** 按单求解：最急的订单优先，用它目标的解 */
const solver: Policy = {
  name: '按单求解',
  play: (raw) => {
    const state = acceptAll(raw)
    const queue = pending(state)
    if (queue.length === 0) return fireKiln(state, BLANK)
    const urgent = [...queue].sort((a, b) => a.deadline - b.deadline)[0]
    const group = queue.filter((p) => p.targetIndex === urgent.targetIndex)
    const ranked = group.sort((a, b) => a.deadline - b.deadline)
    return fireKiln(state, withSolution(loadFrom(ranked), urgent.targetIndex))
  },
}

/** 看行情应变：只接付得起料钱且工期赶得上的单，按"单位窑位的预期毛利"选目标；不值当就烧空等下一窑 */
const adaptive: Policy = {
  name: '看行情应变',
  play: (raw) => {
    let state = raw
    for (const o of raw.offers) {
      const cost = fireCost(SOLUTIONS[o.targetIndex].recipe, SOLUTIONS[o.targetIndex].curve)
      const canAfford = state.cash - cost >= ECONOMY.fuelBase
      const feasible = o.deadlineKiln - state.kiln >= Math.ceil(o.qty / ECONOMY.capacity)
      if (canAfford && feasible) state = accept(state, o.id)
    }

    const queue = pending(state)
    if (queue.length === 0) return fireKiln(state, BLANK)

    const byTarget = new Map<number, Pending[]>()
    for (const p of queue) {
      const list = byTarget.get(p.targetIndex) ?? []
      list.push(p)
      byTarget.set(p.targetIndex, list)
    }

    let best: { targetIndex: number; score: number } | null = null
    for (const [targetIndex, list] of byTarget) {
      const positions = Math.min(
        ECONOMY.capacity,
        list.reduce((sum, p) => sum + p.left, 0),
      )
      const revenue = list
        .sort((a, b) => a.deadline - b.deadline)
        .slice(0, positions)
        .reduce((sum, p) => sum + p.price * Math.min(p.left, positions), 0)
      const cost = fireCost(SOLUTIONS[targetIndex].recipe, SOLUTIONS[targetIndex].curve)
      const score = (revenue - cost) / Math.max(1, positions)
      if (best === null || score > best.score) best = { targetIndex, score }
    }

    if (best === null || best.score <= 0) return fireKiln(state, BLANK)

    const chosen = (byTarget.get(best.targetIndex) ?? []).sort((a, b) => a.deadline - b.deadline)
    return fireKiln(state, withSolution(loadFrom(chosen), best.targetIndex))
  },
}

export const POLICIES: Policy[] = [idle, random, fixed, solver, adaptive]
