import {
  CURVE_PARAMS,
  RECIPE_PARAMS,
  type Curve,
  type ParamSpec,
  type Recipe,
} from './balance'
import { fireGlaze } from './glaze'
import { deltaE2000, type Lab } from './deltae'
import { mulberry32 } from './rng'

export interface FiringSolution {
  deltaE: number
  recipe: Recipe
  curve: Curve
}

interface Knob {
  holder: 'recipe' | 'curve'
  key: string
  min: number
  max: number
}

const KNOBS: Knob[] = [
  ...RECIPE_PARAMS.map((p: ParamSpec<Recipe>) => ({
    holder: 'recipe' as const,
    key: p.key as string,
    min: p.min,
    max: p.max,
  })),
  ...CURVE_PARAMS.map((p: ParamSpec<Curve>) => ({
    holder: 'curve' as const,
    key: p.key as string,
    min: p.min,
    max: p.max,
  })),
]

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

function read(point: FiringSolution, knob: Knob): number {
  const box = knob.holder === 'recipe' ? point.recipe : point.curve
  return (box as unknown as Record<string, number>)[knob.key]
}

function withKnob(point: FiringSolution, knob: Knob, value: number): FiringSolution {
  const box = knob.holder === 'recipe' ? point.recipe : point.curve
  return {
    ...point,
    [knob.holder]: { ...box, [knob.key]: value },
  } as FiringSolution
}

function score(point: FiringSolution, target: Lab): number {
  return deltaE2000(fireGlaze(point.recipe, point.curve, 0).lab, target)
}

/**
 * 坐标模式下降：沿每个旋钮试 ±step 的位移，走不通就把步长折半。
 * 只依赖 fireGlaze 的确定性，因此同一 seed 必得同一结果。
 */
function descend(start: FiringSolution, target: Lab): FiringSolution {
  let best: FiringSolution = { ...start, deltaE: score(start, target) }
  let step = 0.25
  while (step > 1 / 512) {
    let improved = false
    for (const knob of KNOBS) {
      const span = knob.max - knob.min
      for (const sign of [1, -1]) {
        const candidate = withKnob(
          best,
          knob,
          clamp(read(best, knob) + sign * step * span, knob.min, knob.max),
        )
        const d = score(candidate, target)
        if (d < best.deltaE - 1e-12) {
          best = { ...candidate, deltaE: d }
          improved = true
        }
      }
    }
    if (!improved) step /= 2
  }
  return best
}

/**
 * 找一窑能烧出目标色的配方与曲线。M1 生成订单前必须用它预检，
 * 否则会出现"目标色根本烧不出来"的死单。
 */
export function searchFiring(target: Lab, restarts = 60, seed = 20260919): FiringSolution {
  const rnd = mulberry32(seed)
  let best: FiringSolution | null = null
  for (let i = 0; i < restarts; i++) {
    const recipe = {} as Recipe
    const curve = {} as Curve
    for (const knob of KNOBS) {
      const v = knob.min + rnd() * (knob.max - knob.min)
      if (knob.holder === 'recipe') (recipe as unknown as Record<string, number>)[knob.key] = v
      else (curve as unknown as Record<string, number>)[knob.key] = v
    }
    const candidate = descend({ deltaE: 0, recipe, curve }, target)
    if (best === null || candidate.deltaE < best.deltaE) best = candidate
    if (best.deltaE < 0.02) break
  }
  return best as FiringSolution
}
