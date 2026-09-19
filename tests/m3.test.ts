import { describe, expect, it } from 'vitest'
import { REF_CURVE, REF_RECIPE } from '../src/sim/balance'
import { DEFAULT_PLAN } from '../src/sim/meta'
import { accept, ECONOMY, fireKiln, gradeWithCracks, newRun, type RunOptions } from '../src/sim/run'

const SEED = 20260919

/** 把所有挂单都接下来，凑出比窑位数更多的坯，好测"装不装得下" */
function stocked(opts: RunOptions) {
  let state = newRun(SEED, 'steady', opts)
  for (const offer of state.offers) state = accept(state, offer.id)
  const orderIds = state.accepted.flatMap((o) => Array.from({ length: o.qty }, () => o.id))
  expect(orderIds.length).toBeGreaterThanOrEqual(ECONOMY.capacity)
  return { state, orderIds }
}

/** 烧到顶温、保温拉满、助熔给到量程上限：流釉与变形风险都顶得住，缺陷这条路一定活着 */
const runny = (orderIds: number[]) => ({
  recipe: { ...REF_RECIPE, flux: 0.45 },
  curve: { ...REF_CURVE, tmax: 1330, soak: 60 },
  orderIds,
})

describe('图纸进本局', () => {
  it('不点图纸就是拱窑，窑位数与温偏图都是默认那份', () => {
    const plain = newRun(SEED)
    expect(plain.planId).toBe(DEFAULT_PLAN)
    expect(plain.capacity).toBe(ECONOMY.capacity)
    expect(plain.kilnOffsets).toHaveLength(ECONOMY.capacity)
    expect(plain.runoffMult).toBe(1)
    expect(plain.deformMult).toBe(1)
  })

  it('同一 seed 同一图纸必得同一张温偏图', () => {
    expect(newRun(SEED, 'steady', { planId: 'plan-straight' }).kilnOffsets).toEqual(
      newRun(SEED, 'steady', { planId: 'plan-straight' }).kilnOffsets,
    )
  })

  it('换图纸改的是形状，不是幅度量程', () => {
    const arch = newRun(SEED, 'wild').kilnOffsets
    const straight = newRun(SEED, 'wild', { planId: 'plan-straight' }).kilnOffsets
    for (const offsets of [arch, straight]) {
      for (const v of offsets) {
        expect(v).toBeGreaterThanOrEqual(-45)
        expect(v).toBeLessThanOrEqual(40)
      }
    }
    for (let i = 1; i < straight.length; i++) expect(straight[i]).toBeLessThan(straight[i - 1])
  })

  it('密檐窑图少一位，第 4 件的坯就真装不进窑', () => {
    const wide = stocked({})
    const tight = stocked({ planId: 'plan-tight' })
    expect(tight.state.capacity).toBe(ECONOMY.capacity - 1)
    expect(fireKiln(wide.state, runny(wide.orderIds)).history[0]).toHaveLength(ECONOMY.capacity)
    expect(fireKiln(tight.state, runny(tight.orderIds)).history[0]).toHaveLength(
      ECONOMY.capacity - 1,
    )
  })
})

describe('窑具进本局', () => {
  it('倍率归零时没有一件是因缺陷报废的', () => {
    const { state, orderIds } = stocked({ runoffMult: 0, deformMult: 0 })
    const pieces = fireKiln(state, runny(orderIds)).history[0]
    expect(pieces.length).toBeGreaterThan(0)
    for (const p of pieces) {
      expect(p.grade).toBe(gradeWithCracks(p.deltaE, p.crackIndex).grade)
    }
  })

  it('倍率拉满时装进去的每一件都逃不掉', () => {
    const { state, orderIds } = stocked({ runoffMult: 1e6, deformMult: 1e6 })
    const pieces = fireKiln(state, runny(orderIds)).history[0]
    expect(pieces.length).toBeGreaterThan(0)
    for (const p of pieces) expect(p.grade).toBe('废品')
  })
})
