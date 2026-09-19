import { describe, expect, it } from 'vitest'
import { REF_CURVE, REF_RECIPE } from '../src/sim/balance'
import { fireGlaze } from '../src/sim/glaze'
import {
  MODIFIERS,
  WEATHERS,
  draftModifiers,
  modifierById,
  weatherFor,
} from '../src/sim/modifiers'
import {
  ECONOMY,
  GRADE_POINTS,
  accept,
  fireKiln,
  gradeWithCracks,
  newRun,
  summarize,
  type Loading,
} from '../src/sim/run'

function findSeedFor(weatherId: string, kiln = 1): number {
  for (let seed = 1; seed <= 2000; seed++) {
    if (weatherFor(seed, kiln).id === weatherId) return seed
  }
  throw new Error(`2000 个 seed 里找不到 ${weatherId}`)
}

function loading(orderIds: number[] = []): Loading {
  return { recipe: { ...REF_RECIPE }, curve: { ...REF_CURVE }, orderIds }
}

describe('天气', () => {
  it('同一 seed 同一窑必得同一天气', () => {
    expect(weatherFor(4242, 3).id).toBe(weatherFor(4242, 3).id)
  })

  it('40 窑里四种天气都出现过', () => {
    const seen = new Set<string>()
    for (let kiln = 1; kiln <= 40; kiln++) seen.add(weatherFor(90210, kiln).id)
    expect(seen.size).toBe(WEATHERS.length)
  })

  it('寒流窑的开片不轻于晴窑（天气真的进到冷却里）', () => {
    const clearSeed = findSeedFor('clear')
    const coldSeed = findSeedFor('cold')
    expect(weatherFor(clearSeed, 1).id).toBe('clear')
    expect(weatherFor(coldSeed, 1).id).toBe('cold')

    const clear = fireKiln(newRun(clearSeed, 'steady'), loading())
    const cold = fireKiln(newRun(coldSeed, 'steady'), loading())
    const clearCrack = fireGlaze(
      REF_RECIPE,
      { ...REF_CURVE, cooling: REF_CURVE.cooling * weatherFor(clearSeed, 1).coolingMult },
      0,
    ).crackIndex
    const coldCrack = fireGlaze(
      REF_RECIPE,
      { ...REF_CURVE, cooling: REF_CURVE.cooling * weatherFor(coldSeed, 1).coolingMult },
      0,
    ).crackIndex
    expect(coldCrack).toBeGreaterThan(clearCrack)
    expect(clear.history.length).toBe(1)
    expect(cold.history.length).toBe(1)
  })
})

describe('开局修饰符', () => {
  it('每局给三张不重复的候选，同一 seed 结果一致', () => {
    const a = draftModifiers(777)
    const b = draftModifiers(777)
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id))
    expect(new Set(a.map((m) => m.id)).size).toBe(3)
  })

  it('窑位温偏落在修饰符给的范围内', () => {
    const wild = newRun(31, 'wild')
    const [lo, hi] = modifierById('wild').offsetSpan
    for (const offset of wild.kilnOffsets) {
      expect(offset).toBeGreaterThanOrEqual(lo)
      expect(offset).toBeLessThanOrEqual(hi)
    }
    const steady = newRun(31, 'steady')
    const [slo, shi] = modifierById('steady').offsetSpan
    for (const offset of steady.kilnOffsets) {
      expect(offset).toBeGreaterThanOrEqual(slo)
      expect(offset).toBeLessThanOrEqual(shi)
    }
  })

  it('野窑出价高于稳火，急单工期短于稳火', () => {
    const priceOf = (id: string): number =>
      newRun(500, id).offers.reduce((s, o) => s + o.pricePerPiece, 0)
    expect(priceOf('wild')).toBeGreaterThan(priceOf('steady'))

    const deadlineOf = (id: string): number =>
      newRun(500, id).offers.reduce((s, o) => s + o.deadlineKiln, 0)
    expect(deadlineOf('rush')).toBeLessThan(deadlineOf('steady'))
  })

  it('还原焰盛让同样强度的还原操作出更多还原效果', () => {
    const curve = { ...REF_CURVE, reduction: 0.4 }
    const normal = fireGlaze(REF_RECIPE, curve, 0).redox
    const boosted = fireGlaze(
      REF_RECIPE,
      { ...curve, reduction: Math.min(1, curve.reduction * modifierById('reducing').redoxMult) },
      0,
    ).redox
    expect(boosted).toBeGreaterThan(normal)
  })

  it('修饰符表没有空描述或重复 id', () => {
    expect(new Set(MODIFIERS.map((m) => m.id)).size).toBe(MODIFIERS.length)
    for (const m of MODIFIERS) expect(m.blurb.length).toBeGreaterThan(6)
  })
})

describe('开片进评级', () => {
  it('小开片加分，重开片降一档', () => {
    expect(gradeWithCracks(1.5, 0.3)).toEqual({ grade: '珍品', crackBonus: ECONOMY.crackBonusPoints })
    expect(gradeWithCracks(1.5, 0.9)).toEqual({ grade: '正品', crackBonus: 0 })
    expect(gradeWithCracks(3.0, 0.9)).toEqual({ grade: '粗器', crackBonus: 0 })
    expect(gradeWithCracks(3.0, 0.05)).toEqual({ grade: '正品', crackBonus: 0 })
    expect(gradeWithCracks(20, 0.9).grade).toBe('废品')
  })

  it('分数把开片加分算进去', () => {
    let state = newRun(findSeedFor('clear'), 'steady')
    state = accept(state, state.offers[0].id)
    const order = state.offers[0]
    const ids = Array.from({ length: order.qty }, () => order.id)
    const after = fireKiln(state, loading(ids))
    const sum = summarize(after)
    const manual =
      after.history[0].reduce((s, p) => s + (GRADE_POINTS[p.grade] ?? 0) + p.crackBonus, 0) -
      ECONOMY.breachPoints * after.breached
    expect(sum.score).toBe(Math.max(0, manual))
  })
})
