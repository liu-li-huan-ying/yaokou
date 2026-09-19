import { mulberry32 } from './rng'

/** 一窑的天气。它只经一件事：降温有多快 ⇒ 开片有多重 */
export interface Weather {
  id: string
  name: string
  /** 乘在冷却速率上 */
  coolingMult: number
}

export const WEATHERS: Weather[] = [
  { id: 'clear', name: '晴', coolingMult: 0.8 },
  { id: 'wind', name: '风', coolingMult: 1.25 },
  { id: 'rain', name: '雨', coolingMult: 1.6 },
  { id: 'cold', name: '寒流', coolingMult: 2.1 },
]

/** 同一 seed 同一窑必得同一天气 */
export function weatherFor(seed: number, kiln: number): Weather {
  const rnd = mulberry32(seed * 101 + kiln * 977)
  return WEATHERS[Math.floor(rnd() * WEATHERS.length) % WEATHERS.length]
}

export interface Modifier {
  id: string
  name: string
  blurb: string
  /** 窑位温偏范围：越大越赌 */
  offsetSpan: [number, number]
  priceMult: number
  /** 订单工期整体加减 */
  deadlineShift: number
  /** 乘在还原强度上 */
  redoxMult: number
}

export const MODIFIERS: Modifier[] = [
  {
    id: 'steady',
    name: '稳火',
    blurb: '窑位温差小，出价低一成。适合先把节奏跑顺。',
    offsetSpan: [-14, 12],
    priceMult: 0.9,
    deadlineShift: 1,
    redoxMult: 1,
  },
  {
    id: 'wild',
    name: '野窑',
    blurb: '窑位温差拉到 ±45℃，出价高四成。同一窑里可能一半珍品一半废品。',
    offsetSpan: [-45, 40],
    priceMult: 1.4,
    deadlineShift: 0,
    redoxMult: 1,
  },
  {
    id: 'rush',
    name: '急单',
    blurb: '工期普遍压短一窑，出价高两成。接得多就烧不完。',
    offsetSpan: [-38, 32],
    priceMult: 1.2,
    deadlineShift: -1,
    redoxMult: 1,
  },
  {
    id: 'reducing',
    name: '还原焰盛',
    blurb: '同样强度的还原操作出两成的效果，铜红与青灰更容易出。',
    offsetSpan: [-38, 32],
    priceMult: 1.05,
    deadlineShift: 0,
    redoxMult: 1.5,
  },
]

export function modifierById(id: string): Modifier {
  return MODIFIERS.find((m) => m.id === id) ?? MODIFIERS[0]
}

/** 开局从 seed 派生三张候选，玩家挑一张 */
export function draftModifiers(seed: number): Modifier[] {
  const rnd = mulberry32(seed * 31 + 17)
  const pool = MODIFIERS.map((m) => ({ m, k: rnd() })).sort((a, b) => a.k - b.k)
  return pool.slice(0, 3).map((x) => x.m)
}
