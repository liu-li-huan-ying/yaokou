import { type Curve, type Recipe } from './balance'
import { deltaE2000, type Lab } from './deltae'
import { fireGlaze, gradeOf } from './glaze'
import { makeOffer, openingOffers, type Offer } from './orders'
import { mulberry32 } from './rng'
import { TARGETS } from './targets'

export const ECONOMY = {
  startCash: 110,
  /** 一窑能装几件 */
  capacity: 4,
  maxKilns: 16,
  fuelBase: 14,
  fuelPerDeg: 0.05,
  fuelPerSoakMin: 0.12,
  materialPerPercent: 2.2,
  cobaltPerPercent: 7,
  /** 每件素胎的制胎钱，按装窑件数计 */
  blankCost: 6,
  /** 废品除不付钱还要倒罚的比例 */
  scrapFineRate: 0.3,
  /** 未交付部分按此比例罚 */
  breachFineRate: 0.4,
  /** 窑位温偏范围。上一轮 ±22/+18 太窄：搜索解在四个位上几乎都还落在正品档，风险不真实 */
  offsetMin: -38,
  offsetMax: 32,
  /** 缺陷判定：把流釉/变形风险折算成实际报废概率的系数 */
  defectScale: 0.85,
  /** 同时挂着的订单上限 */
  offerBoard: 6,
  /** 每件违约扣的分 */
  breachPoints: 3,
} as const

export const GRADE_MULT: Record<string, number> = {
  珍品: 1.6,
  正品: 1.0,
  粗器: 0.45,
  废品: 0,
}

/**
 * 结算分。分数只认交付，不认钱包——上一版按剩余现金排名，结果"每窑烧空、
 * 一分不赚但也没亏"的躺平（+10）能在部分种子上赢过玩砸了的破产者（负数）。
 * 破产的人保留他已经烧出来的东西，但一分交付都没有的人必须垫底。
 */
export const GRADE_POINTS: Record<string, number> = {
  珍品: 10,
  正品: 6,
  粗器: 2,
  废品: 0,
}

export interface Loading {
  recipe: Recipe
  curve: Curve
  /** 每个元素是一件坯，值为它所属订单的 id；顺序即窑位顺序 */
  orderIds: number[]
}

export interface PieceResult {
  orderId: number
  position: number
  grade: string
  deltaE: number
  offset: number
  revenue: number
  /** 这一件实际烧出来的 Lab。必须存下来：事后再用当前配方重算会得到另一个颜色 */
  lab: Lab
  /** 同一窑的冷却条件对所有件一致，但 UI 画开片要用 */
  crackIndex: number
  targetIndex: number
}

export interface RunState {
  seed: number
  kiln: number
  cash: number
  offers: Offer[]
  accepted: Offer[]
  /** orderId -> 已交付件数 */
  delivered: Record<number, number>
  /** 每局的窑位温偏图，整局不变（这是"位置知识"的来源） */
  kilnOffsets: number[]
  history: PieceResult[][]
  /** 到期没交齐的件数，计分要扣 */
  breached: number
  over: boolean
  reason: string
}

export function newRun(seed: number): RunState {
  const rnd = mulberry32(seed)
  const span = ECONOMY.offsetMax - ECONOMY.offsetMin
  const kilnOffsets = Array.from(
    { length: ECONOMY.capacity },
    () => ECONOMY.offsetMin + rnd() * span,
  )
  return {
    seed,
    kiln: 1,
    cash: ECONOMY.startCash,
    offers: openingOffers(seed),
    accepted: [],
    delivered: {},
    kilnOffsets,
    history: [],
    breached: 0,
    over: false,
    reason: '',
  }
}

export function fireCost(recipe: Recipe, curve: Curve, pieces = 0): number {
  const fuel =
    ECONOMY.fuelBase +
    Math.max(0, curve.tmax - 1150) * ECONOMY.fuelPerDeg +
    curve.soak * ECONOMY.fuelPerSoakMin
  const materials =
    recipe.fe * ECONOMY.materialPerPercent +
    recipe.cu * ECONOMY.materialPerPercent +
    recipe.co * ECONOMY.cobaltPerPercent
  return Math.round(fuel + materials + pieces * ECONOMY.blankCost)
}

export function accept(state: RunState, orderId: number): RunState {
  const offer = state.offers.find((o) => o.id === orderId)
  if (offer === undefined) return state
  return {
    ...state,
    offers: state.offers.filter((o) => o.id !== orderId),
    accepted: [...state.accepted, offer],
  }
}

export function decline(state: RunState, orderId: number): RunState {
  return { ...state, offers: state.offers.filter((o) => o.id !== orderId) }
}

/** 已接订单里某订单还欠几件 */
export function outstanding(state: RunState, orderId: number): number {
  const order = state.accepted.find((o) => o.id === orderId)
  if (order === undefined) return 0
  return Math.max(0, order.qty - (state.delivered[orderId] ?? 0))
}

/**
 * 烧一窑：扣料钱与燃料，逐件按各自窑位温偏出呈色、判缺陷、按 ΔE2000 结算，
 * 再处理交齐/违约/挂单过期/新单，最后判是否断火。
 */
export function fireKiln(state: RunState, loading: Loading): RunState {
  if (state.over) return state

  /** 先把真正能装进窑的件挑出来：制胎钱按件数算，所以件数要在扣钱之前定下来 */
  const taken: Record<number, number> = {}
  const plan: Array<{ orderId: number; position: number; order: Offer }> = []
  loading.orderIds.slice(0, ECONOMY.capacity).forEach((orderId, position) => {
    const order = state.accepted.find((o) => o.id === orderId)
    if (order === undefined) return
    if ((state.delivered[orderId] ?? 0) + (taken[orderId] ?? 0) >= order.qty) return
    taken[orderId] = (taken[orderId] ?? 0) + 1
    plan.push({ orderId, position, order })
  })

  const cost = fireCost(loading.recipe, loading.curve, plan.length)
  const rnd = mulberry32(state.seed * 1000003 + state.kiln * 7919)
  const delivered: Record<number, number> = { ...state.delivered }
  const pieces: PieceResult[] = []
  let revenue = 0

  for (const { orderId, position, order } of plan) {
    const offset = state.kilnOffsets[position] ?? 0
    const result = fireGlaze(loading.recipe, loading.curve, offset)
    const d = deltaE2000(result.lab, TARGETS[order.targetIndex].lab)
    const risk = Math.max(result.runoffRisk, result.deformRisk) * ECONOMY.defectScale
    const scrapped = rnd() < risk
    const grade = scrapped ? '废品' : gradeOf(d)
    const gross = Math.round(order.pricePerPiece * (GRADE_MULT[grade] ?? 0))
    const fine = grade === '废品' ? Math.round(order.pricePerPiece * ECONOMY.scrapFineRate) : 0
    const money = gross - fine

    revenue += money
    delivered[orderId] = (delivered[orderId] ?? 0) + 1
    pieces.push({
      orderId,
      position,
      grade,
      deltaE: d,
      offset,
      revenue: money,
      lab: result.lab,
      crackIndex: result.crackIndex,
      targetIndex: order.targetIndex,
    })
  }

  let cash = state.cash - cost + revenue
  let breached = state.breached

  const stillOpen: Offer[] = []
  for (const order of state.accepted) {
    const got = delivered[order.id] ?? 0
    if (got >= order.qty) continue
    if (state.kiln >= order.deadlineKiln) {
      const short = order.qty - got
      cash -= Math.round(order.pricePerPiece * short * ECONOMY.breachFineRate)
      breached += short
      continue
    }
    stillOpen.push(order)
  }

  const nextKiln = state.kiln + 1
  const offerRnd = mulberry32(state.seed * 7 + nextKiln * 13)
  const bias = stillOpen.map((o) => o.targetIndex)
  const fresh: Offer[] = [makeOffer(offerRnd, nextKiln, 0, bias)]
  if (offerRnd() < 0.45) fresh.push(makeOffer(offerRnd, nextKiln, 1, bias))
  const offers = [...state.offers.filter((o) => o.deadlineKiln > nextKiln), ...fresh].slice(
    -ECONOMY.offerBoard,
  )

  const broke = cash < ECONOMY.fuelBase
  const outOfKilns = nextKiln > ECONOMY.maxKilns
  const over = broke || outOfKilns

  return {
    ...state,
    kiln: nextKiln,
    cash,
    offers,
    accepted: stillOpen,
    delivered,
    breached,
    history: [...state.history, pieces],
    over,
    reason: over ? (broke ? '断火' : '窑期用尽') : '',
  }
}

export interface RunSummary {
  seed: number
  score: number
  cash: number
  kilns: number
  /** 装窑烧过的件数（含报废） */
  fired: number
  /** 真正交付出去的件数 */
  delivered: number
  breached: number
  grades: Record<string, number>
  bankrupt: boolean
}

export function summarize(state: RunState): RunSummary {
  const grades: Record<string, number> = { 珍品: 0, 正品: 0, 粗器: 0, 废品: 0 }
  let fired = 0
  let points = 0
  for (const kiln of state.history) {
    for (const p of kiln) {
      grades[p.grade] = (grades[p.grade] ?? 0) + 1
      points += GRADE_POINTS[p.grade] ?? 0
      fired += 1
    }
  }
  const deliveredPieces = fired - (grades['废品'] ?? 0)
  return {
    seed: state.seed,
    score: Math.max(0, points - ECONOMY.breachPoints * state.breached),
    cash: state.cash,
    kilns: state.kiln - 1,
    fired,
    delivered: deliveredPieces,
    breached: state.breached,
    grades,
    bankrupt: state.reason === '断火',
  }
}
