import { describe, expect, it } from 'vitest'
import {
  DEFAULT_META,
  META_KEY,
  MIN_POOL,
  UNLOCKABLES,
  buy,
  canBuy,
  drawGlazePool,
  loadMeta,
  renownEarned,
  saveMeta,
  shapeOffsets,
  type MetaState,
} from '../src/sim/meta'

const NOTE = { label: '试出的青', fe: 1.5, cu: 0, co: 0, flux: 0.3, tmax: 1250, reduction: 0.5 }

function storeWith(raw: string | null) {
  const map = new Map<string, string>()
  if (raw !== null) map.set(META_KEY, raw)
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
  }
}

function rich(): MetaState {
  return { ...DEFAULT_META, renown: 500 }
}

function withGlaze(): MetaState {
  return { ...DEFAULT_META, unlocked: ['cu', 'co'] }
}

describe('口碑结算', () => {
  it('只认交付：珍品 4 分、正品 2 分、粗器 1 分、废品 0 分', () => {
    expect(renownEarned({ 珍品: 1 }, 0)).toBe(4)
    expect(renownEarned({ 正品: 1 }, 0)).toBe(2)
    expect(renownEarned({ 粗器: 1 }, 0)).toBe(1)
    expect(renownEarned({ 废品: 9 }, 0)).toBe(0)
    expect(renownEarned({ 珍品: 3, 正品: 4, 粗器: 2, 废品: 1 }, 0)).toBe(22)
  })

  it('违约要扣，但不会扣成负数', () => {
    expect(renownEarned({ 正品: 3 }, 1)).toBe(4)
    expect(renownEarned({ 正品: 1 }, 9)).toBe(0)
  })
})

describe('解锁', () => {
  it('买得起才扣钱，买过不能再买', () => {
    const after = buy(rich(), 'cu')
    expect(after.renown).toBe(460)
    expect(after.unlocked).toEqual(['cu'])
    expect(canBuy(after, 'cu')).toBe(false)
    expect(buy(after, 'cu')).toBe(after)
  })

  it('钱不够或 id 不存在都不动状态', () => {
    const poor: MetaState = { ...DEFAULT_META, renown: 10 }
    expect(buy(poor, 'co')).toBe(poor)
    expect(buy(rich(), 'nope')).toEqual(rich())
  })

  it('解锁目录不重复、成本为正、每项都有说明', () => {
    expect(new Set(UNLOCKABLES.map((u) => u.id)).size).toBe(UNLOCKABLES.length)
    for (const u of UNLOCKABLES) {
      expect(u.cost).toBeGreaterThan(0)
      expect(u.blurb.length).toBeGreaterThan(6)
    }
  })
})

describe('每局釉料池', () => {
  it('铁永远在池里，池子不小于保底数，且不会冒出没解锁的料', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const pool = drawGlazePool(seed, withGlaze())
      expect(pool).toContain('fe')
      expect(pool.length).toBeGreaterThanOrEqual(Math.min(MIN_POOL, 3))
      for (const id of pool) expect(['fe', 'cu', 'co']).toContain(id)
    }
  })

  it('同一 seed 同一池；不同 seed 会换池子', () => {
    const meta = withGlaze()
    expect(drawGlazePool(7, meta)).toEqual(drawGlazePool(7, meta))
    const seen = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) seen.add(drawGlazePool(seed, meta).join('+'))
    expect(seen.size).toBeGreaterThan(1)
  })

  it('没解锁时只有铁，不会凭空多出料', () => {
    expect(drawGlazePool(5, DEFAULT_META)).toEqual(['fe'])
  })
})

describe('窑炉图纸', () => {
  const raw = [-40, 12, -5, 30]
  const LO = -45
  const HI = 40

  it('默认图纸原样返回', () => {
    expect(shapeOffsets(undefined, raw, LO, HI)).toEqual(raw)
  })

  it('直焰窑图是单调梯度且落在量程内', () => {
    const out = shapeOffsets('plan-straight', raw, LO, HI)
    expect(out.length).toBe(raw.length)
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeLessThan(out[i - 1])
    for (const v of out) {
      expect(v).toBeGreaterThan(LO)
      expect(v).toBeLessThan(HI)
    }
  })

  it('密檐窑图收窄温差并少一个窑位', () => {
    const out = shapeOffsets('plan-tight', raw, LO, HI)
    expect(out.length).toBe(raw.length - 1)
    const spread = (xs: number[]): number => Math.max(...xs) - Math.min(...xs)
    expect(spread(out)).toBeLessThan(spread(raw))
  })
})

describe('存档', () => {
  it('存进去读得回来', () => {
    const store = storeWith(null)
    const meta: MetaState = {
      renown: 42,
      unlocked: ['cu'],
      runs: 3,
      bestScore: 120,
      notes: [NOTE],
    }
    saveMeta(store, meta)
    expect(loadMeta(store)).toEqual(meta)
  })

  it('坏档、缺字段、未知解锁项都不崩', () => {
    expect(loadMeta(storeWith('{ 这不是 json'))).toEqual(DEFAULT_META)
    expect(loadMeta(storeWith('null'))).toEqual(DEFAULT_META)
    const partial = loadMeta(storeWith('{"renown":-5,"unlocked":["cu","银河"],"runs":2}'))
    expect(partial.renown).toBe(0)
    expect(partial.unlocked).toEqual(['cu'])
    expect(partial.notes).toEqual([])
  })

  it('没有 localStorage（如隐私模式）也不炸', () => {
    expect(loadMeta(null)).toEqual(DEFAULT_META)
    expect(() => saveMeta(null, DEFAULT_META)).not.toThrow()
  })
})
