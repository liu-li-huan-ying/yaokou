import { describe, expect, it } from 'vitest'
import {
  CURVE_PARAMS,
  RECIPE_PARAMS,
  REF_CURVE,
  type Curve,
  type Recipe,
} from '../src/sim/balance'
import { fireGlaze } from '../src/sim/glaze'
import { deltaE2000, type Lab } from '../src/sim/deltae'
import { searchFiring } from '../src/sim/search'
import { fillable, fillableTargets, needsOf } from '../src/sim/solutions'
import { TARGETS } from '../src/sim/targets'
import { mulberry32 } from '../src/sim/rng'

interface GridPoint {
  recipe: Recipe
  curve: Curve
  lab: Lab
}

function buildGrid(n: number, seed: number): GridPoint[] {
  const rnd = mulberry32(seed)
  const points: GridPoint[] = []
  for (let i = 0; i < n; i++) {
    const recipe = {} as Recipe
    for (const p of RECIPE_PARAMS) {
      recipe[p.key] = p.min + rnd() * (p.max - p.min)
    }
    const curve = {} as Curve
    for (const p of CURVE_PARAMS) {
      curve[p.key] = p.min + rnd() * (p.max - p.min)
    }
    points.push({ recipe, curve, lab: fireGlaze(recipe, curve, 0).lab })
  }
  return points
}

/** 随机撒点只用来测"分布不退化"；可达性必须靠 searchFiring 判定，
 *  8000 点在 9 维盒子里太稀，会假报不可达。 */
const GRID = buildGrid(8000, 20260919)
const EMPTY: Recipe = { fe: 0, cu: 0, co: 0, flux: 0.3 }

describe('目标釉色可达性（设计文档硬约束）', () => {
  for (const target of TARGETS) {
    it(`${target.name} 存在 ΔE2000 < 3 的烧成解`, () => {
      const s = searchFiring(target.lab)
      console.log(
        `${target.name}: minΔE=${s.deltaE.toFixed(3)} 铁=${s.recipe.fe.toFixed(2)} 铜=${s.recipe.cu.toFixed(2)} ` +
          `钴=${s.recipe.co.toFixed(2)} 助熔=${s.recipe.flux.toFixed(2)} 最高温=${s.curve.tmax.toFixed(0)} ` +
          `保温=${s.curve.soak.toFixed(0)} 还原=${s.curve.reduction.toFixed(2)}@${s.curve.reductionStart.toFixed(0)}`,
      )
      expect(s.deltaE).toBeLessThan(3)
    })
  }

  it('空配方只蒙得住月白，其余六色一律够不到珍品', () => {
    // 月白本就是素釉本色（它的方子就是"不加料"），所以空配方命中它是设计而非漏洞。
    // 躺赢的不可能性因此要这样表述：白烧至多交付最便宜的那一档（22 贯），
    // 其余六色一律出不了珍品。
    const raw = fireGlaze(EMPTY, { ...REF_CURVE, tmax: 1150, soak: 0 }, 0)
    const mature = fireGlaze(EMPTY, REF_CURVE, 0)
    for (const target of TARGETS) {
      const best = Math.min(
        deltaE2000(raw.lab, target.lab),
        deltaE2000(mature.lab, target.lab),
      )
      if (target.name === '月白') continue
      expect(best).toBeGreaterThan(2)
    }
    expect(deltaE2000(mature.lab, TARGETS[3].lab)).toBeLessThan(2)
  })
})

describe('传世方子（釉料池判据的地基）', () => {
  for (const target of TARGETS) {
    it(`${target.name} 的方子按池内用料烧得出珍品`, () => {
      const fired = fireGlaze(target.glaze.recipe, target.glaze.curve, 0)
      expect(deltaE2000(fired.lab, target.lab)).toBeLessThan(2)
    })
  }

  it('一色一方的方子互不通用：烧对一色，其余六色都出不了珍品', () => {
    // 这条是"按色批窑"这个核心决策的前提。若一份方子能同时命中两色，
    // 混单就不亏，窑位与池子都失去意义。
    for (const [i, mine] of TARGETS.entries()) {
      const lab = fireGlaze(mine.glaze.recipe, mine.glaze.curve, 0).lab
      for (const [j, other] of TARGETS.entries()) {
        if (i === j) continue
        expect(deltaE2000(lab, other.lab)).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('池子决定接得了哪几色：白手三色、开铜六色、开钴七色', () => {
    // 这条钉的是元进度的"形状"：解锁不是数字变大，而是订单册真的变宽。
    const names = (pool: string[]): string[] => fillableTargets(pool).map((i) => TARGETS[i].name)
    expect(names(['fe'])).toEqual(['天青', '梅子青', '月白'])
    expect(names(['fe', 'cu'])).toHaveLength(6)
    expect(names(['fe', 'cu', 'co'])).toHaveLength(TARGETS.length)
    for (const [i, t] of TARGETS.entries()) {
      expect(fillable(i, ['fe', 'cu', 'co'])).toBe(true)
      expect(needsOf(i).every((k) => t.glaze.recipe[k as 'fe' | 'cu' | 'co'] > 0)).toBe(true)
    }
  })
})

describe('searchFiring 自身', () => {
  it('能还原一个已知烧成（目标取自模型内部，自反）', () => {
    const known = fireGlaze(
      { fe: 3, cu: 0.5, co: 0, flux: 0.35 },
      { ...REF_CURVE, tmax: 1280, reduction: 0.8, soak: 30 },
      0,
    )
    expect(searchFiring(known.lab).deltaE).toBeLessThan(0.5)
  })

  it('同一目标同一 seed 结果可复现', () => {
    const t = TARGETS[0].lab
    const a = searchFiring(t, 12, 777)
    const b = searchFiring(t, 12, 777)
    expect(a.deltaE).toBe(b.deltaE)
    expect(a.recipe).toEqual(b.recipe)
    expect(a.curve).toEqual(b.curve)
  })

  it('报出的 ΔE 能被模型复现（不是取巧读数）', () => {
    const target = TARGETS[4].lab
    const s = searchFiring(target, 40, 31337)
    const again = fireGlaze(s.recipe, s.curve, 0)
    expect(deltaE2000(again.lab, target)).toBeCloseTo(s.deltaE, 9)
  })
})

describe('模型分布不退化', () => {
  it('随机配方烧出来的是满屏颜色，不是一个色', () => {
    const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length
    const std = (xs: number[]): number => {
      const m = mean(xs)
      return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
    }
    const as = GRID.map((g) => g.lab.a)
    const bs = GRID.map((g) => g.lab.b)
    const ls = GRID.map((g) => g.lab.l)
    console.log(
      `L ${Math.min(...ls).toFixed(1)}..${Math.max(...ls).toFixed(1)}`,
      `std(L)=${std(ls).toFixed(2)} std(a)=${std(as).toFixed(2)} std(b)=${std(bs).toFixed(2)}`,
    )
    expect(std(as)).toBeGreaterThan(6)
    expect(std(bs)).toBeGreaterThan(6)
    expect(Math.max(...ls) - Math.min(...ls)).toBeGreaterThan(40)
  })
})
