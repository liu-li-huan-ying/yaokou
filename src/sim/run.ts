import { type Curve, type Recipe } from './balance'
import { deltaE2000, type Lab } from './deltae'
import { fireGlaze, gradeOf } from './glaze'
import { DEFAULT_META, DEFAULT_PLAN, drawGlazePool, shapeOffsets } from './meta'
import { modifierById, weatherFor, type Modifier, type Weather } from './modifiers'
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
  /** 窑位温偏兜底范围（无修饰符时用） */
  offsetMin: -38,
  offsetMax: 32,
  /** 缺陷判定：把流釉/变形风险折算成实际报废概率的系数 */
  defectScale: 0.85,
  /** 同时挂着的订单上限 */
  offerBoard: 6,
  /** 每件违约扣的分 */
  breachPoints: 3,
  /** 小开片是审美加分的区间 */
  crackSweet: [0.2, 0.55] as [number, number],
  crackBonusPoints: 2,
  /** 开片重到这份上降一档 */
  heavyCrack: 0.8,
} as const

export const GRADE_MULT: Record<string, number> = {
  珍品: 1.6,
  正品: 1.0,
  粗器: 0.45,
  废品: 0,
}

/**
 * 局末分数只认交付。`分 = Σ(件分 + 开片加分) − 3 × 违约件数`，下限 0。
 * 先前按剩余现金排过一次名，结果"不接单、每窑烧空、+10"的躺平
 * 能在部分种子上赢过玩砸了的破产者（负数）——那是计分口径的错。
 */
export const GRADE_POINTS: Record<string, number> = {
  珍品: 10,
  正品: 6,
  粗器: 2,
  废品: 0,
}

const GRADE_ORDER = ['珍品', '正品', '粗器', '废品'] as const

/** 开片太重就把评级降一档 */
function downgrade(grade: string): string {
  const i = GRADE_ORDER.indexOf(grade as (typeof GRADE_ORDER)[number])
  return GRADE_ORDER[Math.min(GRADE_ORDER.length - 1, i + 1)]
}

export function gradeWithCracks(
  deltaE: number,
  crackIndex: number,
): { grade: string; crackBonus: number } {
  let grade = gradeOf(deltaE)
  if (crackIndex > ECONOMY.heavyCrack) grade = downgrade(grade)
  const [lo, hi] = ECONOMY.crackSweet
  const crackBonus = crackIndex >= lo && crackIndex <= hi ? ECONOMY.crackBonusPoints : 0
  return { grade, crackBonus }
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
  crackIndex: number
  crackBonus: number
  targetIndex: number
}

export interface RunState {
  seed: number
  modifier: Modifier
  /** 本局图纸 id。存下来是为了让界面说实话：中途解锁的图纸要下一局才上身 */
  planId: string
  /** 本局窑位数：密檐窑图会少一位 */
  capacity: number
  /** 本局罐里有的料（fe/cu/co）。池外的料在 sim 里就不算数 */
  pool: string[]
  /** 窑具对缺陷概率的倍率（匣钵只管流釉、支钉只管变形） */
  runoffMult: number
  deformMult: number
  /** 本窑天气，由 seed 与窑序决定 */
  weather: Weather
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

export interface RunOptions {
  planId?: string
  /** 本局罐里有的料。默认就是白手起家那一份：只有铁 */
  pool?: string[]
  runoffMult?: number
  deformMult?: number
}

/**
 * 釉料池是本局的硬约束。界面只是不让点，这里兜底：锁住的料绝不该
 * 影响呈色，也不该算料钱——"照这单调方"这类绕开料罐直接写配方的
 * 入口，靠这一层才真正堵死。
 */
export function inPool(recipe: Recipe, pool: string[]): Recipe {
  const on = (key: 'fe' | 'cu' | 'co'): number => (pool.includes(key) ? recipe[key] : 0)
  return { fe: on('fe'), cu: on('cu'), co: on('co'), flux: recipe.flux }
}

export function newRun(seed: number, modifierId = 'steady', opts: RunOptions = {}): RunState {
  const modifier = modifierById(modifierId)
  const rnd = mulberry32(seed)
  const [lo, hi] = modifier.offsetSpan
  const raw = Array.from({ length: ECONOMY.capacity }, () => lo + rnd() * (hi - lo))
  const kilnOffsets = shapeOffsets(opts.planId, raw, lo, hi)
  const pool = opts.pool ?? drawGlazePool(seed, DEFAULT_META)
  return {
    seed,
    modifier,
    planId: opts.planId ?? DEFAULT_PLAN,
    capacity: kilnOffsets.length,
    pool,
    runoffMult: opts.runoffMult ?? 1,
    deformMult: opts.deformMult ?? 1,
    weather: weatherFor(seed, 1),
    kiln: 1,
    cash: ECONOMY.startCash,
    offers: openingOffers(seed, {
      priceMult: modifier.priceMult,
      deadlineShift: modifier.deadlineShift,
    }, pool),
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
 * 烧一窑：天气与修饰符先折进曲线，再扣料钱与燃料，逐件按各自窑位温偏出呈色、
 * 判缺陷、按 ΔE2000 与开片定级结算，然后处理交齐/违约/挂单过期/新单，最后判是否断火。
 */
export function fireKiln(state: RunState, loading: Loading): RunState {
  if (state.over) return state

  const weather = weatherFor(state.seed, state.kiln)
  const curve: Curve = {
    ...loading.curve,
    cooling: loading.curve.cooling * weather.coolingMult,
    reduction: Math.min(1, loading.curve.reduction * state.modifier.redoxMult),
  }

  /** 先把真正能装进窑的件挑出来：制胎钱按件数算，所以件数要在扣钱之前定下来 */
  const recipe = inPool(loading.recipe, state.pool)
  const taken: Record<number, number> = {}
  const plan: Array<{ orderId: number; position: number; order: Offer }> = []
  loading.orderIds.slice(0, state.capacity).forEach((orderId, position) => {
    const order = state.accepted.find((o) => o.id === orderId)
    if (order === undefined) return
    if ((state.delivered[orderId] ?? 0) + (taken[orderId] ?? 0) >= order.qty) return
    taken[orderId] = (taken[orderId] ?? 0) + 1
    plan.push({ orderId, position, order })
  })

  const cost = fireCost(recipe, curve, plan.length)
  const rnd = mulberry32(state.seed * 1000003 + state.kiln * 7919)
  const delivered: Record<number, number> = { ...state.delivered }
  const pieces: PieceResult[] = []
  let revenue = 0

  for (const { orderId, position, order } of plan) {
    const offset = state.kilnOffsets[position] ?? 0
    const result = fireGlaze(recipe, curve, offset)
    const d = deltaE2000(result.lab, TARGETS[order.targetIndex].lab)
    const risk =
      Math.max(result.runoffRisk * state.runoffMult, result.deformRisk * state.deformMult) *
      ECONOMY.defectScale
    const scrapped = rnd() < risk
    const graded = scrapped
      ? { grade: '废品', crackBonus: 0 }
      : gradeWithCracks(d, result.crackIndex)
    const gross = Math.round(order.pricePerPiece * (GRADE_MULT[graded.grade] ?? 0))
    const fine = graded.grade === '废品' ? Math.round(order.pricePerPiece * ECONOMY.scrapFineRate) : 0
    const money = gross - fine

    revenue += money
    delivered[orderId] = (delivered[orderId] ?? 0) + 1
    pieces.push({
      orderId,
      position,
      grade: graded.grade,
      deltaE: d,
      offset,
      revenue: money,
      lab: result.lab,
      crackIndex: result.crackIndex,
      crackBonus: graded.crackBonus,
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
  const rules = {
    priceMult: state.modifier.priceMult,
    deadlineShift: state.modifier.deadlineShift,
  }
  const fresh: Offer[] = [makeOffer(offerRnd, nextKiln, 0, bias, rules, state.pool)]
  if (offerRnd() < 0.45) fresh.push(makeOffer(offerRnd, nextKiln, 1, bias, rules, state.pool))
  const offers = [...state.offers.filter((o) => o.deadlineKiln > nextKiln), ...fresh].slice(
    -ECONOMY.offerBoard,
  )

  const broke = cash < ECONOMY.fuelBase
  const outOfKilns = nextKiln > ECONOMY.maxKilns
  const over = broke || outOfKilns

  return {
    ...state,
    weather,
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
  modifier: string
  weatherSeen: number
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
      points += (GRADE_POINTS[p.grade] ?? 0) + p.crackBonus
      fired += 1
    }
  }
  const deliveredPieces = fired - (grades['废品'] ?? 0)
  return {
    seed: state.seed,
    modifier: state.modifier.name,
    weatherSeen: state.history.length,
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
