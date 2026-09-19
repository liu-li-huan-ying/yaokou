import type { Lab } from './deltae'

/** 呈色模型的全部数值。调平只改这里，不改 glaze.ts 的结构。 */
export const FIRING = {
  softStart: 1150,
  fullMelt: 1300,
  fluxGain: 260,
  fluxRef: 0.3,
  soakGain: 1.2,
  dissolveK: 3.2,
  redoxWindow: 120,
  baseL: 90,
  baseA: -2,
  baseB: 8,
  opacityBase: 0.92,
  opacityMeltGain: 0.78,
  opacityLGain: 10,
  opacityChromaKill: 0.35,
  chromaCeil: 52,
  chromaKnee: 400,
  crackCoolRef: 6,
  runoffMelt: 0.78,
  runoffFlux: 0.4,
  deformTemp: 1292,
} as const

export interface OxideSpec {
  /** 配方里对应的键 */
  key: 'fe' | 'cu' | 'co'
  /** 半饱和加入量 wt% */
  halfSat: number
  /** 满量时的 Lab 偏移尺度 */
  strength: number
  /** 指数吸收系数：L = L₀ · exp(-Σ kDark·w) */
  kDark: number
  /** 氧化气氛下的色方向 */
  ox: { a: number; b: number }
  /** 还原气氛下的色方向 */
  rd: { a: number; b: number }
}

export const OXIDES: OxideSpec[] = [
  { key: 'fe', halfSat: 3.5, strength: 26, kDark: 0.9, ox: { a: 4, b: 22 }, rd: { a: -12, b: 9 } },
  { key: 'cu', halfSat: 2.0, strength: 30, kDark: 0.75, ox: { a: -14, b: 14 }, rd: { a: 26, b: -4 } },
  { key: 'co', halfSat: 0.6, strength: 34, kDark: 0.85, ox: { a: 3, b: -30 }, rd: { a: -3, b: -32 } },
]

export interface Recipe {
  /** Fe₂O₃ wt% */
  fe: number
  /** CuO wt% */
  cu: number
  /** CoO wt% */
  co: number
  /** 助熔剂占基质比例 */
  flux: number
}

export interface Curve {
  /** 最高温 ℃ */
  tmax: number
  /** 保温分钟 */
  soak: number
  /** 还原强度 0..1 */
  reduction: number
  /** 还原起始温度 ℃ */
  reductionStart: number
  /** 冷却速率，相对值 */
  cooling: number
}

export interface ParamSpec<T> {
  key: keyof T
  label: string
  min: number
  max: number
  step: number
  unit: string
}

export const RECIPE_PARAMS: Array<ParamSpec<Recipe>> = [
  { key: 'fe', label: '铁 Fe₂O₃', min: 0, max: 8, step: 0.1, unit: '%' },
  { key: 'cu', label: '铜 CuO', min: 0, max: 4, step: 0.05, unit: '%' },
  { key: 'co', label: '钴 CoO', min: 0, max: 2, step: 0.02, unit: '%' },
  { key: 'flux', label: '助熔剂', min: 0.15, max: 0.45, step: 0.01, unit: '' },
]

export const CURVE_PARAMS: Array<ParamSpec<Curve>> = [
  { key: 'tmax', label: '最高温', min: 1150, max: 1330, step: 1, unit: '℃' },
  { key: 'soak', label: '保温', min: 0, max: 60, step: 1, unit: 'min' },
  { key: 'reduction', label: '还原强度', min: 0, max: 1, step: 0.01, unit: '' },
  { key: 'reductionStart', label: '还原起始', min: 900, max: 1250, step: 5, unit: '℃' },
  { key: 'cooling', label: '冷却速率', min: 0.5, max: 10, step: 0.1, unit: '' },
]

export const REF_RECIPE: Recipe = { fe: 1.5, cu: 0, co: 0, flux: 0.3 }
export const REF_CURVE: Curve = {
  tmax: 1250,
  soak: 20,
  reduction: 0.5,
  reductionStart: 1040,
  cooling: 3,
}

/** 窑位温偏的实际范围，M1 起每局按此重掷 */
export const KILN_OFFSET: [number, number] = [-22, 18]

/** 评级阈值，照设计文档 §评级与经济。废品是兜底档。 */
export const GRADE_BANDS: Array<{ name: string; maxDeltaE: number }> = [
  { name: '珍品', maxDeltaE: 2 },
  { name: '正品', maxDeltaE: 6 },
  { name: '粗器', maxDeltaE: 14 },
  { name: '废品', maxDeltaE: Number.POSITIVE_INFINITY },
]

export type { Lab }
