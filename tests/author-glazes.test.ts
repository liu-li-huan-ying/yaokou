import { describe, expect, it } from 'vitest'
import { deltaE2000 } from '../src/sim/deltae'
import { fireGlaze } from '../src/sim/glaze'
import { searchFiring } from '../src/sim/search'
import { TARGETS } from '../src/sim/targets'

/**
 * `targets.ts` 里那七份传世方子就是这么来的：给每色限定"只准用这几味料"，
 * 再让搜索器在约束内找最优。改了呈色模型、或把目标色换成 Met 采样真值之后，
 * 跑一次本文件即可把新方子与 ΔE 打出来照抄回 targets.ts。
 *
 * 它不断言任何东西——是推导工具，回归在 reachability.test.ts。
 */
const PLAN: Record<string, string[]> = {
  天青: ['fe'],
  粉青: ['cu'],
  梅子青: ['fe'],
  月白: [],
  窑变朱: ['cu'],
  茶叶末: ['fe', 'cu'],
  霁蓝: ['co'],
}

/**
 * 校准过的目标色：每色都取"它那味料真能烧到的样子"，于是传世方子必定落在
 * 珍品档，而每色的招牌料互相读得出来（铁青、铜绿铜红、钴蓝、素釉）。
 */
const LABS: Record<string, { l: number; a: number; b: number }> = {
  天青: { l: 73, a: -8, b: 13 },
  粉青: { l: 77, a: -10, b: 16 },
  梅子青: { l: 60, a: -16, b: 18 },
  月白: { l: 88, a: -2, b: 8 },
  窑变朱: { l: 51, a: 33, b: 6 },
  茶叶末: { l: 42, a: -2, b: 20 },
  霁蓝: { l: 41, a: 8, b: -37 },
}

describe('author', () => {
  it('prints', () => {
    for (const t of TARGETS) {
      const only = PLAN[t.name] ?? []
      const lab0 = LABS[t.name] ?? t.lab
      const s = searchFiring(lab0, 400, 20260919, only)
      const lab = fireGlaze(s.recipe, s.curve, 0).lab
      console.log(
        `${t.name} ${JSON.stringify(only)} lab=${JSON.stringify(lab0)} ΔE=${deltaE2000(lab, lab0).toFixed(3)} 烧出 Lab={l: ${lab.l.toFixed(
          1,
        )}, a: ${lab.a.toFixed(1)}, b: ${lab.b.toFixed(1)}}\n  ` +
          `glaze: { recipe: { fe: ${s.recipe.fe.toFixed(2)}, cu: ${s.recipe.cu.toFixed(2)}, ` +
          `co: ${s.recipe.co.toFixed(2)}, flux: ${s.recipe.flux.toFixed(2)} }, ` +
          `curve: { tmax: ${Math.round(s.curve.tmax)}, soak: ${Math.round(s.curve.soak)}, ` +
          `reduction: ${s.curve.reduction.toFixed(2)}, reductionStart: ${Math.round(
            s.curve.reductionStart,
          )}, cooling: ${s.curve.cooling.toFixed(1)} } }`,
      )
    }
    expect(true).toBe(true)
  })
})
