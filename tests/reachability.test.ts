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
import { TARGETS } from '../src/sim/targets'

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

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

  it('空配方够不到正品档及以上（躺赢不可行）', () => {
    // 素色本身就是 (87.75, -2, 8)，与"月白"这类淡釉天然只差 13 —— 落到粗器档、折价 0.45。
    // 要守的不变量是"什么都不调也拿不到正品及以上"，不是"离所有目标都远"。
    for (const target of TARGETS) {
      const raw = fireGlaze(EMPTY, { ...REF_CURVE, tmax: 1150, soak: 0 }, 0)
      const mature = fireGlaze(EMPTY, REF_CURVE, 0)
      const best = Math.min(
        deltaE2000(raw.lab, target.lab),
        deltaE2000(mature.lab, target.lab),
      )
      expect(best).toBeGreaterThan(6)
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
