import { describe, expect, it } from 'vitest'
import { REF_CURVE, type Curve, type Recipe } from '../src/sim/balance'
import { fireGlaze, gradeOf } from '../src/sim/glaze'

const NEUTRAL: Recipe = { fe: 0, cu: 0, co: 0, flux: 0.3 }
const OXIDIZING: Curve = { ...REF_CURVE, reduction: 0 }
const REDUCING: Curve = { ...REF_CURVE, reduction: 1 }

const lab = (r: Partial<Recipe>, c: Curve) => fireGlaze({ ...NEUTRAL, ...r }, c, 0).lab

function expectMonotone(xs: number[], dir: 'up' | 'down', note: string): void {
  for (let i = 1; i < xs.length; i++) {
    const bad = dir === 'up' ? xs[i] < xs[i - 1] - 1e-9 : xs[i] > xs[i - 1] + 1e-9
    if (bad) throw new Error(`${note}: 第 ${i} 步破坏单调性 ${JSON.stringify(xs)}`)
  }
}

describe('呈色模型单调性（设计文档硬约束）', () => {
  const feSteps = [0, 0.5, 1, 2, 3, 5, 8]
  const cuSteps = [0, 0.25, 0.5, 1, 2, 4]
  const coSteps = [0, 0.1, 0.2, 0.5, 1, 2]

  it('铁在氧化气氛下把 b* 推高（黄褐）、把 L* 压低', () => {
    expectMonotone(feSteps.map((fe) => lab({ fe }, OXIDIZING).b), 'up', '铁·氧化 b*')
    expectMonotone(feSteps.map((fe) => lab({ fe }, OXIDIZING).l), 'down', '铁·氧化 L*')
  })

  it('铁在还原气氛下把 a* 压低（青灰）、把 L* 压低', () => {
    expectMonotone(feSteps.map((fe) => lab({ fe }, REDUCING).a), 'down', '铁·还原 a*')
    expectMonotone(feSteps.map((fe) => lab({ fe }, REDUCING).l), 'down', '铁·还原 L*')
  })

  it('同量铁，还原越强 b* 越低（黄褐→青的方向差）', () => {
    const xs = [0, 0.25, 0.5, 0.75, 1].map((reduction) =>
      lab({ fe: 2 }, { ...REF_CURVE, reduction }),
    )
    expectMonotone(xs.map((x) => x.b), 'down', '铁·还原强度 b*')
    expectMonotone(xs.map((x) => x.a), 'down', '铁·还原强度 a*')
  })

  it('铜在氧化下走绿（a* 下降），在还原下走红（a* 上升）', () => {
    expectMonotone(cuSteps.map((cu) => lab({ cu }, OXIDIZING).a), 'down', '铜·氧化 a*')
    expectMonotone(cuSteps.map((cu) => lab({ cu }, REDUCING).a), 'up', '铜·还原 a*')
    expectMonotone(cuSteps.map((cu) => lab({ cu }, OXIDIZING).l), 'down', '铜·氧化 L*')
  })

  it('钴把 b* 压向蓝、把 L* 压低', () => {
    expectMonotone(coSteps.map((co) => lab({ co }, OXIDIZING).b), 'down', '钴 b*')
    expectMonotone(coSteps.map((co) => lab({ co }, OXIDIZING).l), 'down', '钴 L*')
  })

  it('助熔剂与温度抬高玻化度、压低乳浊度', () => {
    const fluxes = [0.15, 0.2, 0.3, 0.4, 0.45]
    expectMonotone(fluxes.map((flux) => fireGlaze({ ...NEUTRAL, flux }, OXIDIZING, 0).melt), 'up', '助熔剂·玻化')
    expectMonotone(
      fluxes.map((flux) => fireGlaze({ ...NEUTRAL, flux }, OXIDIZING, 0).opacity),
      'down',
      '助熔剂·乳浊',
    )
    const temps = [1150, 1200, 1250, 1300, 1330]
    expectMonotone(
      temps.map((tmax) => fireGlaze(NEUTRAL, { ...OXIDIZING, tmax }, 0).melt),
      'up',
      '温度·玻化',
    )
  })

  it('冷却越快开片越重，助熔剂与高温推高流釉与变形风险', () => {
    const coolings = [0.5, 2, 4, 6, 10]
    expectMonotone(
      coolings.map((cooling) => fireGlaze(NEUTRAL, { ...OXIDIZING, cooling }, 0).crackIndex),
      'up',
      '冷却·开片',
    )
    expectMonotone(
      [0.15, 0.3, 0.45].map((flux) => fireGlaze({ ...NEUTRAL, flux }, OXIDIZING, 0).runoffRisk),
      'up',
      '助熔剂·流釉',
    )
    expectMonotone(
      [1200, 1290, 1330].map((tmax) => fireGlaze(NEUTRAL, { ...OXIDIZING, tmax }, 0).deformRisk),
      'up',
      '温度·变形',
    )
  })

  it('窑位温偏沿同一方向移动结果（同一窑不同位不一致）', () => {
    const offsets = [-22, -10, 0, 10, 18]
    const melts = offsets.map((o) => fireGlaze(NEUTRAL, OXIDIZING, o).melt)
    expectMonotone(melts, 'up', '窑位温偏·玻化')
  })
})

describe('呈色模型值域与退化', () => {
  it('空配方只有基质本色（无呈色偏移）', () => {
    const r = fireGlaze(NEUTRAL, OXIDIZING, 0)
    expect(r.lab.a).toBeCloseTo(-2, 6)
    expect(r.lab.b).toBeCloseTo(8, 6)
    expect(r.melt).toBeGreaterThan(0)
  })

  it('生烧出粉釉（高乳浊），足烧出透明釉', () => {
    // 参考曲线是 1250℃/保温 20min 的足烧，本就应当透明；乳浊要在低温短时那一端测。
    const raw = fireGlaze(
      { ...NEUTRAL, flux: 0.15 },
      { ...OXIDIZING, tmax: 1150, soak: 0 },
      0,
    )
    expect(raw.melt).toBe(0)
    expect(raw.opacity).toBeGreaterThan(0.85)
    const mature = fireGlaze(NEUTRAL, OXIDIZING, 0)
    expect(mature.opacity).toBeLessThan(raw.opacity)
  })

  it('全域参数扫描不出界、不出 NaN', () => {
    const scan = (
      amounts: Recipe,
      curve: Curve,
    ): void => {
      const r = fireGlaze(amounts, curve, 0)
      const { l, a, b } = r.lab
      expect(Number.isFinite(l) && Number.isFinite(a) && Number.isFinite(b)).toBe(true)
      expect(l).toBeGreaterThanOrEqual(0)
      expect(l).toBeLessThanOrEqual(100)
      expect(Math.abs(a)).toBeLessThanOrEqual(50)
      expect(Math.abs(b)).toBeLessThanOrEqual(60)
      for (const v of [r.melt, r.opacity, r.crackIndex, r.runoffRisk, r.deformRisk, r.redox]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }

    for (const fe of [0, 4, 8]) {
      for (const cu of [0, 2, 4]) {
        for (const co of [0, 1, 2]) {
          for (const flux of [0.15, 0.3, 0.45]) {
            for (const tmax of [1150, 1250, 1330]) {
              for (const reduction of [0, 1]) {
                scan({ fe, cu, co, flux }, { ...REF_CURVE, tmax, reduction })
              }
            }
          }
        }
      }
    }
  })

  it('还原强度受还原起始温度门控', () => {
    const hot = fireGlaze(NEUTRAL, { ...REDUCING, reductionStart: 900 }, 0).redox
    const cold = fireGlaze(NEUTRAL, { ...REDUCING, reductionStart: 1250 }, 0).redox
    expect(hot).toBeGreaterThan(cold)
  })
})

describe('评级', () => {
  it('按 ΔE2000 分档', () => {
    expect(gradeOf(0)).toBe('珍品')
    expect(gradeOf(1.999)).toBe('珍品')
    expect(gradeOf(2)).toBe('正品')
    expect(gradeOf(6)).toBe('粗器')
    expect(gradeOf(14)).toBe('废品')
    expect(gradeOf(900)).toBe('废品')
  })
})
