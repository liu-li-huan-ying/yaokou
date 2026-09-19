import {
  FIRING,
  GRADE_BANDS,
  OXIDES,
  type Curve,
  type Recipe,
  type Lab,
} from './balance'

export interface GlazeResult {
  lab: Lab
  /** 玻化度 0..1 */
  melt: number
  /** 乳浊度 0..1，生烧偏粉、足烧偏透 */
  opacity: number
  /** 开片程度 0..1 */
  crackIndex: number
  /** 流釉粘足风险 0..1 */
  runoffRisk: number
  /** 变形风险 0..1 */
  deformRisk: number
  /** 实际生效的还原度 0..1 */
  redox: number
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * 一次烧成的呈色结果。全部为确定性计算，窑位温偏是唯一的外部随机源。
 *
 * 单调性是按构造保证的：每种氧化物只在 0..1 的饱和量上叠加一个固定方向向量，
 * 彩度经 tanh 压缩，因此"加某味料 → 沿该料方向单调移动"恒成立。
 * tests/glaze.test.ts 逐味料守这条线。
 */
export function fireGlaze(recipe: Recipe, curve: Curve, kilnOffset: number): GlazeResult {
  const effT = curve.tmax + kilnOffset
  const melt = clamp01(
    (effT - FIRING.softStart +
      (recipe.flux - FIRING.fluxRef) * FIRING.fluxGain +
      curve.soak * FIRING.soakGain) /
      (FIRING.fullMelt - FIRING.softStart),
  )
  const dissolve = 1 - Math.exp(-FIRING.dissolveK * melt)
  const redox = clamp01((curve.reduction * (effT - curve.reductionStart)) / FIRING.redoxWindow)
  const opacity = clamp01(FIRING.opacityBase - FIRING.opacityMeltGain * melt)
  const desaturate = 1 - FIRING.opacityChromaKill * opacity

  let sumA = 0
  let sumB = 0
  let absorb = 0

  for (const spec of OXIDES) {
    const w = (1 - Math.exp(-recipe[spec.key] / spec.halfSat)) * dissolve
    const dirA = spec.ox.a + (spec.rd.a - spec.ox.a) * redox
    const dirB = spec.ox.b + (spec.rd.b - spec.ox.b) * redox
    sumA += w * spec.strength * dirA
    sumB += w * spec.strength * dirB
    absorb += w * spec.kDark
  }

  const lab: Lab = {
    l: (FIRING.baseL + (opacity - 0.5) * FIRING.opacityLGain) * Math.exp(-absorb),
    a: FIRING.baseA + desaturate * FIRING.chromaCeil * Math.tanh(sumA / FIRING.chromaKnee),
    b: FIRING.baseB + desaturate * FIRING.chromaCeil * Math.tanh(sumB / FIRING.chromaKnee),
  }

  return {
    lab,
    melt,
    opacity,
    redox,
    crackIndex: clamp01(0.55 * (curve.cooling / FIRING.crackCoolRef) * (0.4 + 0.6 * melt)),
    runoffRisk: clamp01(
      (melt - FIRING.runoffMelt) * 2.6 +
        (recipe.flux - FIRING.runoffFlux) * 1.8 +
        curve.soak / 240 -
        0.1,
    ),
    deformRisk: clamp01((effT - FIRING.deformTemp) / 55 + curve.soak / 320 - 0.15),
  }
}

export function gradeOf(deltaE: number): string {
  for (const band of GRADE_BANDS) {
    if (deltaE < band.maxDeltaE) return band.name
  }
  return GRADE_BANDS[GRADE_BANDS.length - 1].name
}
